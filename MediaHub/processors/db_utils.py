import sqlite3
import os
import time
import threading
import sys
import concurrent.futures
import csv
import sqlite3
import platform
import traceback
import requests
import re
from typing import List, Tuple, Optional
from sqlite3 import DatabaseError
from functools import wraps
from dotenv import load_dotenv
from MediaHub.utils.logging_utils import log_message
from MediaHub.utils.env_creator import get_env_file_path
from MediaHub.config.config import (
    get_db_throttle_rate, get_db_max_retries, get_db_retry_delay,
    get_db_batch_size, get_db_max_workers, get_db_max_records,
    get_db_connection_timeout, get_db_cache_size,
    get_cinesync_ip, get_cinesync_api_port
)
from MediaHub.api.tmdb_api_helpers import get_movie_data, get_show_data, get_episode_name

def format_file_size(size):
    """Format file size in human readable format"""
    if not size:
        return "N/A"
    for unit in ['B', 'KB', 'MB', 'GB', 'TB']:
        if size < 1024.0:
            return f"{size:.1f} {unit}"
        size /= 1024.0
    return f"{size:.1f} PB"
from MediaHub.utils.dashboard_utils import send_dashboard_notification

# Load environment variables
db_env_path = get_env_file_path()
load_dotenv(db_env_path)

BASE_DIR = os.path.abspath(os.path.dirname(os.path.dirname(os.path.dirname(__file__))))
DB_DIR = os.path.join(BASE_DIR, "db")
DB_FILE = os.path.join(DB_DIR, "processed_files.db")
ARCHIVE_DB_FILE = os.path.join(DB_DIR, "processed_files_archive.db")
LOCK_FILE = os.path.join(DB_DIR, "db_initialized.lock")

# Ensure database directory exists
os.makedirs(DB_DIR, exist_ok=True)

# Helper functions for safe environment variable conversion
def get_env_int(key, default):
    """Safely get an integer environment variable with a default value."""
    try:
        value = os.getenv(key)
        if value is None or value.strip() == '':
            return default
        return int(value)
    except (ValueError, TypeError):
        return default

def get_env_float(key, default):
    """Safely get a float environment variable with a default value."""
    try:
        value = os.getenv(key)
        if value is None or value.strip() == '':
            return default
        return float(value)
    except (ValueError, TypeError):
        return default

# Get configuration from config.py functions
THROTTLE_RATE = get_db_throttle_rate()
MAX_RETRIES = get_db_max_retries()
RETRY_DELAY = get_db_retry_delay()
BATCH_SIZE = get_db_batch_size()
MAX_WORKERS = get_db_max_workers()
MAX_RECORDS = get_db_max_records()
CONNECTION_TIMEOUT = get_db_connection_timeout()
CACHE_SIZE = get_db_cache_size()

# Add this near the top with other global variables
_db_initialized = False

class DatabaseError(Exception):
    pass

class ConnectionPool:
    def __init__(self, db_file, max_connections=5):
        self.db_file = db_file
        self.max_connections = max_connections
        self.connections = []
        self.lock = threading.Lock()

    def get_connection(self):
        with self.lock:
            if not os.path.exists(self.db_file):
                print(f"[INFO] Database file {self.db_file} not found, creating a new one...")
                db_dir = os.path.dirname(self.db_file)
                os.makedirs(db_dir, exist_ok=True)
                open(self.db_file, 'a').close()  # Create an empty file
                os.chmod(self.db_file, 0o666)  # Ensure proper permissions

            if self.connections:
                return self.connections.pop()
            else:
                try:
                    conn = sqlite3.connect(self.db_file, check_same_thread=False, timeout=CONNECTION_TIMEOUT)
                    conn.execute("PRAGMA journal_mode=WAL")
                    conn.execute("PRAGMA synchronous=NORMAL")
                    conn.execute(f"PRAGMA cache_size={CACHE_SIZE}")
                    conn.execute("PRAGMA wal_autocheckpoint=1000")
                    conn.execute("PRAGMA mmap_size=268435456")
                    conn.execute("PRAGMA read_uncommitted=true")
                    return conn
                except sqlite3.OperationalError as e:
                    print(f"[ERROR] Failed to open database file: {self.db_file}")
                    print(f"[ERROR] Database error: {e}")
                    raise


    def return_connection(self, conn):
        with self.lock:
            if len(self.connections) < self.max_connections:
                self.connections.append(conn)
            else:
                conn.close()

# Create connection pools using database configuration
main_pool = ConnectionPool(DB_FILE, max_connections=max(2, MAX_WORKERS))
archive_pool = ConnectionPool(ARCHIVE_DB_FILE, max_connections=2)

def with_connection(pool):
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            conn = pool.get_connection()
            try:
                return func(conn, *args, **kwargs)
            finally:
                pool.return_connection(conn)
        return wrapper
    return decorator

def throttle(func):
    @wraps(func)
    def wrapper(*args, **kwargs):
        # Only throttle if THROTTLE_RATE > 0
        if THROTTLE_RATE > 0:
            time.sleep(1 / THROTTLE_RATE)
        return func(*args, **kwargs)
    return wrapper

def retry_on_db_lock(func):
    @wraps(func)
    def wrapper(*args, **kwargs):
        for attempt in range(MAX_RETRIES):
            try:
                return func(*args, **kwargs)
            except sqlite3.OperationalError as e:
                if "database is locked" in str(e) and attempt < MAX_RETRIES - 1:
                    log_message(f"Database locked, retrying in {RETRY_DELAY} seconds (attempt {attempt + 1}/{MAX_RETRIES})", level="WARNING")
                    time.sleep(RETRY_DELAY)
                else:
                    raise DatabaseError(f"Database operation failed after {MAX_RETRIES} attempts: {e}")
    return wrapper

@throttle
@retry_on_db_lock
@with_connection(main_pool)
def initialize_db(conn):
    global _db_initialized
    """Initialize the SQLite database and create the necessary tables."""
    if _db_initialized:
        return

    if os.path.exists(LOCK_FILE):
        log_message("Database already initialized. Checking for updates.", level="INFO")
    else:
        log_message("Initializing database...", level="INFO")
        os.makedirs(DB_DIR, exist_ok=True)
        os.makedirs(os.path.join(DB_DIR, 'trash'), exist_ok=True)

    try:
        cursor = conn.cursor()

        # Create the processed_files table if it doesn't exist
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS processed_files (
                file_path TEXT PRIMARY KEY,
                destination_path TEXT,
                base_path TEXT,
                tmdb_id TEXT,
                season_number TEXT,
                reason TEXT,
                media_type TEXT,
                proper_name TEXT,
                year TEXT,
                episode_number TEXT,
                imdb_id TEXT,
                is_anime_genre INTEGER
            )
        """)

        cursor.execute("PRAGMA table_info(processed_files)")
        columns = [column[1] for column in cursor.fetchall()]

        # Define all required columns with their types
        required_columns = {
            "destination_path": "TEXT",
            "base_path": "TEXT",
            "tmdb_id": "TEXT",
            "season_number": "TEXT",
            "reason": "TEXT",
            "file_size": "INTEGER",
            "error_message": "TEXT",
            "processed_at": "TIMESTAMP",
            "media_type": "TEXT",
            "proper_name": "TEXT",
            "year": "TEXT",
            "episode_number": "TEXT",
            "imdb_id": "TEXT",
            "is_anime_genre": "INTEGER",
            "language": "TEXT",
            "quality": "TEXT",
            "tvdb_id": "TEXT",
            "league_id": "TEXT",
            "sportsdb_event_id": "TEXT",
            "sport_name": "TEXT",
            "sport_round": "INTEGER",
            "sport_location": "TEXT",
            "sport_session": "TEXT",
            "sport_venue": "TEXT",
            "sport_city": "TEXT",
            "sport_country": "TEXT",
            "sport_time": "TEXT",
            "sport_date": "TEXT",
            "original_language": "TEXT",
            "overview": "TEXT",
            "runtime": "INTEGER",
            "original_title": "TEXT",
            "status": "TEXT",
            "release_date": "TEXT",
            "first_air_date": "TEXT",
            "last_air_date": "TEXT",
            "genres": "TEXT",
            "certification": "TEXT",
            "episode_title": "TEXT",
            "total_episodes": "INTEGER"
        }

        # Add missing columns
        for column_name, column_type in required_columns.items():
            if column_name not in columns:
                cursor.execute(f"ALTER TABLE processed_files ADD COLUMN {column_name} {column_type}")

                # Special handling for processed_at column
                if column_name == "processed_at":
                    cursor.execute("UPDATE processed_files SET processed_at = datetime('now') WHERE processed_at IS NULL")

        # Create the deleted_files table for tracking deletions
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS deleted_files (
                id INTEGER PRIMARY KEY AUTOINCREMENT, file_path TEXT, destination_path TEXT,
                base_path TEXT, tmdb_id TEXT, season_number TEXT, reason TEXT, media_type TEXT,
                proper_name TEXT, year TEXT, episode_number TEXT, imdb_id TEXT, is_anime_genre INTEGER,
                language TEXT, quality TEXT, tvdb_id TEXT, league_id TEXT, sportsdb_event_id TEXT,
                sport_name TEXT, sport_round INTEGER, sport_location TEXT, sport_session TEXT,
                sport_venue TEXT, sport_date TEXT, file_size INTEGER, processed_at TEXT,
                deleted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, deletion_reason TEXT, trash_file_name TEXT
            )
        """)

        # Create indexes
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_file_path ON processed_files(file_path)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_destination_path ON processed_files(destination_path)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_base_path ON processed_files(base_path)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_tmdb_id ON processed_files(tmdb_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_season_number ON processed_files(season_number)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_reason ON processed_files(reason)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_file_size ON processed_files(file_size)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_error_message ON processed_files(error_message)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_processed_at ON processed_files(processed_at)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_media_type ON processed_files(media_type)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_proper_name ON processed_files(proper_name)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_year ON processed_files(year)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_episode_number ON processed_files(episode_number)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_imdb_id ON processed_files(imdb_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_is_anime_genre ON processed_files(is_anime_genre)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_media_type ON processed_files(media_type)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_proper_name ON processed_files(proper_name)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_year ON processed_files(year)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_episode_number ON processed_files(episode_number)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_imdb_id ON processed_files(imdb_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_is_anime_genre ON processed_files(is_anime_genre)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_tvdb_id ON processed_files(tvdb_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_league_id ON processed_files(league_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_sportsdb_event_id ON processed_files(sportsdb_event_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_sport_name ON processed_files(sport_name)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_sport_round ON processed_files(sport_round)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_sport_location ON processed_files(sport_location)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_sport_session ON processed_files(sport_session)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_sport_venue ON processed_files(sport_venue)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_sport_city ON processed_files(sport_city)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_sport_country ON processed_files(sport_country)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_sport_time ON processed_files(sport_time)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_sport_date ON processed_files(sport_date)")

        # Create indexes for deleted_files table
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_deleted_file_path ON deleted_files(file_path)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_deleted_destination_path ON deleted_files(destination_path)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_deleted_tmdb_id ON deleted_files(tmdb_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_deleted_at ON deleted_files(deleted_at)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_trash_file_name ON deleted_files(trash_file_name)")

        conn.commit()

        # Verify all required columns exist before marking as initialized
        cursor.execute("PRAGMA table_info(processed_files)")
        final_columns = [column[1] for column in cursor.fetchall()]

        expected_columns = {"file_path", "destination_path", "base_path", "tmdb_id", "season_number",
                          "reason", "file_size", "error_message", "processed_at", "media_type",
                          "proper_name", "year", "episode_number", "imdb_id", "is_anime_genre",
                          "language", "quality", "tvdb_id", "league_id", "sportsdb_event_id", "sport_name",
                          "sport_round", "sport_location", "sport_session", "sport_venue", "sport_city", "sport_country", "sport_time", "sport_date",
                          "original_language", "overview", "runtime", "original_title", "status",
                          "release_date", "first_air_date", "last_air_date", "genres", "certification",
                          "episode_title", "total_episodes"}

        missing_columns = expected_columns - set(final_columns)
        if missing_columns:
            log_message(f"Database initialization incomplete. Missing columns: {missing_columns}", level="ERROR")
            return

        log_message("Database schema is up to date.", level="INFO")

        # Create or update the lock file only if all columns exist
        with open(LOCK_FILE, 'w') as lock_file:
            lock_file.write("Database initialized and up to date.")

        _db_initialized = True

    except sqlite3.Error as e:
        log_message(f"Failed to initialize or update database: {e}", level="ERROR")
        conn.rollback()

@throttle
@retry_on_db_lock
@with_connection(main_pool)
def archive_old_records(conn):
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM processed_files")
        record_count = cursor.fetchone()[0]

        if record_count > MAX_RECORDS:
            cursor.execute("""
                INSERT INTO processed_files_archive (file_path)
                SELECT file_path FROM processed_files
                WHERE rowid NOT IN (
                    SELECT rowid FROM processed_files
                    ORDER BY rowid DESC
                    LIMIT ?
                )
            """, (MAX_RECORDS,))
            cursor.execute("DELETE FROM processed_files WHERE rowid NOT IN (SELECT rowid FROM processed_files ORDER BY rowid DESC LIMIT ?)", (MAX_RECORDS,))
            conn.commit()
    except (sqlite3.Error, DatabaseError) as e:
        log_message(f"Error in archive_old_records: {e}", level="ERROR")
        conn.rollback()

@throttle
@retry_on_db_lock
@with_connection(main_pool)
def load_processed_files(conn):
    processed_files = set()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT file_path FROM processed_files")
        while True:
            batch = cursor.fetchmany(BATCH_SIZE)
            if not batch:
                break
            processed_files.update(row[0] for row in batch)
    except (sqlite3.Error, DatabaseError) as e:
        log_message(f"Error in load_processed_files: {e}", level="ERROR")
        conn.rollback()
    return processed_files

@throttle
@retry_on_db_lock
@with_connection(main_pool)
def is_file_processed(conn, file_path):
    """Fast check if a single file is already processed without loading all files."""
    file_path = normalize_file_path(file_path)
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT 1 FROM processed_files WHERE file_path = ? LIMIT 1", (file_path,))
        return cursor.fetchone() is not None
    except (sqlite3.Error, DatabaseError) as e:
        log_message(f"Error in is_file_processed: {e}", level="ERROR")
        conn.rollback()
        return False

def extract_base_path_from_destination_path(dest_path, proper_name=None, media_type=None, sport_name=None):
    """Extract base path - everything between DESTINATION_DIR and the title folder

    Args:
        dest_path: Full destination path
        proper_name: The proper name from database (e.g., "Movie Title (2023)")
                    If provided, will be used to identify the title folder precisely
        media_type: The media type (e.g., 'Sports', 'Movies', 'Shows')
        sport_name: The sport name for sports content (e.g., 'Formula 1', 'UFC')
    """
    if not dest_path:
        return None

    # Get the destination directory from environment
    dest_dir = os.getenv("DESTINATION_DIR", "")
    if not dest_dir:
        return None

    # Normalize paths
    dest_dir = os.path.normpath(dest_dir)
    dest_path = os.path.normpath(dest_path)

    # Remove destination directory prefix to get relative path
    if dest_path.startswith(dest_dir):
        relative_path = dest_path[len(dest_dir):].lstrip(os.sep)
        parts = relative_path.split(os.sep)

        # Special handling for Sports content
        if media_type == 'Sports' and sport_name:
            for i, part in enumerate(parts):
                if sport_name.lower() in part.lower() or part.lower() in sport_name.lower():
                    if i > 0:
                        return os.sep.join(parts[:i])
                    else:
                        return None
            if len(parts) >= 2:
                return parts[0]  # Just return "Sports" as base path

        # Existing logic for non-sports content
        if proper_name:
            for i, part in enumerate(parts[:-1]):
                if part == proper_name or part.startswith(proper_name):
                    if i > 0:
                        return os.sep.join(parts[:i])
                    else:
                        return None

        if len(parts) >= 4:
            extras_keywords = ['extras', 'specials']
            for i, part in enumerate(parts[:-1]):
                if part.lower() in extras_keywords:
                    return parts[0]
            return os.sep.join(parts[:-2])
        elif len(parts) >= 3:
            return os.sep.join(parts[:-2])
        elif len(parts) >= 2:
            return parts[0]
        elif len(parts) >= 1:
            return parts[0]

    return None

@throttle
@retry_on_db_lock
@with_connection(main_pool)
def save_processed_file(conn, source_path, dest_path=None, tmdb_id=None, season_number=None, reason=None, file_size=None, error_message=None, media_type=None, proper_name=None, year=None, episode_number=None, imdb_id=None, is_anime_genre=None, language=None, quality=None, tvdb_id=None, league_id=None, sportsdb_event_id=None, sport_name=None, sport_round=None, sport_location=None, sport_session=None, sport_venue=None, sport_city=None, sport_country=None, sport_time=None, sport_date=None, original_language=None, overview=None, runtime=None, original_title=None, status=None, release_date=None, first_air_date=None, last_air_date=None, genres=None, certification=None, episode_title=None, total_episodes=None):
    source_path = normalize_file_path(source_path)
    if dest_path:
        dest_path = normalize_file_path(dest_path)

    # Extract base path from destination path using proper_name
    base_path = extract_base_path_from_destination_path(dest_path, proper_name, media_type, sport_name)

    # Get file size if not provided and source file exists
    if file_size is None and source_path and os.path.exists(source_path):
        try:
            file_size = os.path.getsize(source_path)
        except (OSError, IOError) as e:
            log_message(f"Could not get file size for {source_path}: {e}", level="WARNING")
            file_size = None

    try:
        cursor = conn.cursor()

        # Check if this is a new file (not an update)
        cursor.execute("SELECT COUNT(*) FROM processed_files WHERE file_path = ?", (source_path,))
        is_new_file = cursor.fetchone()[0] == 0

        # Check if columns exist
        cursor.execute("PRAGMA table_info(processed_files)")
        columns = [column[1] for column in cursor.fetchall()]
        
        # Build dynamic INSERT statement based on available columns
        base_columns = ['file_path', 'destination_path', 'tmdb_id', 'season_number', 'reason', 'file_size']
        base_values = [source_path, dest_path, tmdb_id, season_number, reason, file_size]
        
        # Optional columns and their corresponding values
        optional_data = {
            'base_path': base_path,
            'error_message': error_message,
            'processed_at': 'datetime(\'now\')',  # Special SQL function
            'media_type': media_type,
            'proper_name': proper_name,
            'year': year,
            'episode_number': episode_number,
            'imdb_id': imdb_id,
            'is_anime_genre': is_anime_genre,
            'language': language,
            'quality': quality,
            'tvdb_id': tvdb_id,
            'league_id': league_id,
            'sportsdb_event_id': sportsdb_event_id,
            'sport_name': sport_name,
            'sport_round': sport_round,
            'sport_location': sport_location,
            'sport_session': sport_session,
            'sport_venue': sport_venue,
            'sport_city': sport_city,
            'sport_country': sport_country,
            'sport_time': sport_time,
            'sport_date': sport_date,
            'original_language': original_language,
            'overview': overview,
            'runtime': runtime,
            'original_title': original_title,
            'status': status,
            'release_date': release_date,
            'first_air_date': first_air_date,
            'last_air_date': last_air_date,
            'genres': genres,
            'certification': certification,
            'episode_title': episode_title,
            'total_episodes': total_episodes
        }
        
        # Add available optional columns
        for col_name, col_value in optional_data.items():
            if col_name in columns:
                base_columns.append(col_name)
                if col_name == 'processed_at':
                    continue  # Skip adding to values list for SQL function
                else:
                    base_values.append(col_value)
        
        # Build the SQL statement
        columns_str = ', '.join(base_columns)
        placeholders = ', '.join(['?' if col != 'processed_at' else 'datetime(\'now\')' for col in base_columns])
        
        sql = f"INSERT OR REPLACE INTO processed_files ({columns_str}) VALUES ({placeholders})"
        cursor.execute(sql, base_values)

        conn.commit()

        # Notify WebDavHub about the file addition if it's a new file and not skipped
        if is_new_file and not reason and dest_path:
            track_file_addition(source_path, dest_path, tmdb_id, season_number)

    except (sqlite3.Error, DatabaseError) as e:
        log_message(f"Error in save_processed_file: {e}", level="ERROR")
        conn.rollback()

@throttle
@retry_on_db_lock
@with_connection(main_pool)
def check_file_in_db(conn, file_path):
    file_path = normalize_file_path(file_path)
    try:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT COUNT(*) FROM processed_files
            WHERE file_path = ? OR destination_path = ?
        """, (file_path, file_path))
        count = cursor.fetchone()[0]
        if count > 0:
            log_message(f"File found in database: {file_path}", level="DEBUG")
        return count > 0
    except (sqlite3.Error, DatabaseError) as e:
        log_message(f"Error in check_file_in_db: {e}", level="ERROR")
        conn.rollback()
        return False

def normalize_file_path(file_path, resolve_symlinks=False):
    """
    Normalizes a file path to ensure consistent formatting for comparison.
    Applies platform-specific normalization for better cross-platform compatibility.

    Args:
        file_path: The file path to normalize
        resolve_symlinks: Whether to resolve symlinks to their source paths
    """
    if not file_path:
        return file_path

    # Resolve symlinks if requested
    if resolve_symlinks:
        try:
            if os.path.islink(file_path):
                file_path = os.path.realpath(file_path)
        except (OSError, IOError):
            # If symlink resolution fails, continue with original path
            pass

    # Basic normalization
    normalized = os.path.normpath(file_path)

    # Windows-specific normalization for better path comparison
    if platform.system() == "Windows":
        # Remove \\?\ prefix if present
        if normalized.startswith("\\\\?\\"):
            normalized = normalized[4:]
        normalized = os.path.abspath(normalized)
        if len(normalized) >= 2 and normalized[1] == ':':
            normalized = normalized[0].upper() + normalized[1:]

    return normalized

def find_file_in_directory(file_name, directory):
    for root, dirs, files in os.walk(directory):
        if file_name in files:
            return os.path.join(root, file_name)
    return None

def build_file_set(directory):
    file_set = set()
    for root, dirs, files in os.walk(directory):
        for file in files:
            file_set.add(file)
    return file_set

def process_file_batch(batch, file_set, destination_folder):
    missing_files = []
    for file_path_tuple in batch:
        file_path = file_path_tuple[0]  # Extract the string from the tuple
        file_name = os.path.basename(file_path)
        if file_name not in file_set:
            missing_files.append(file_path)
            log_message(f"Missing file: {file_path} - Expected at: {os.path.join(destination_folder, file_name)}", level="DEBUG")
    return missing_files

@throttle
@retry_on_db_lock
@with_connection(main_pool)
def display_missing_files(conn, destination_folder, cleanup_missing=False):
    start_time = time.time()
    log_message("Starting display_missing_files function.", level="INFO")
    destination_folder = os.path.normpath(destination_folder)
    try:
        cursor = conn.cursor()
        # Only select files that aren't marked as skipped (don't have a reason)
        cursor.execute("""
            SELECT file_path, destination_path, reason, tmdb_id, season_number
            FROM processed_files
            WHERE reason IS NULL
        """)
        missing_files = []
        cleaned_count = 0

        for source_path, dest_path, reason, tmdb_id, season_number in cursor.fetchall():
            if source_path is None:
                log_message("Skipping entry with null source path", level="WARNING")
                continue

            if dest_path is None:
                log_message(f"Entry missing destination path: {source_path}", level="WARNING")
                continue

            try:
                source_path = normalize_file_path(source_path)
                dest_path = normalize_file_path(dest_path)

                if not os.path.exists(dest_path):
                    # Get the original filename
                    original_filename = os.path.basename(source_path)
                    renamed = False

                    # First check if the original source file still exists
                    if not os.path.exists(source_path):
                        log_message(f"Source file no longer exists: {source_path}", level="WARNING")
                        try:
                            from MediaHub.processors.symlink_utils import delete_broken_symlinks
                            log_message(f"Triggering broken symlinks cleanup for missing source: {source_path}", level="INFO")
                            delete_broken_symlinks(destination_folder, source_path)
                        except Exception as cleanup_error:
                            log_message(f"Error during broken symlinks cleanup: {cleanup_error}", level="ERROR")
                        continue

                    # Recursively search the entire destination directory for the file
                    for root, dirs, files in os.walk(destination_folder):
                        for filename in files:
                            potential_new_path = os.path.join(root, filename)

                            # Skip if it's the same path we already checked
                            if normalize_file_path(potential_new_path) == dest_path:
                                continue

                            # Check if this is a symlink
                            if os.path.islink(potential_new_path):
                                try:
                                    # Check if the symlink points to our source file
                                    link_target = os.readlink(potential_new_path)
                                    # Use improved normalization for both paths
                                    normalized_link_target = normalize_file_path(link_target)
                                    normalized_source_path = normalize_file_path(source_path)

                                    if normalized_link_target == normalized_source_path:
                                        # Found the moved/renamed file
                                        log_message(f"Found file moved to: {potential_new_path}", level="INFO")
                                        update_renamed_file(dest_path, potential_new_path)
                                        renamed = True
                                        break
                                except (OSError, IOError) as e:
                                    log_message(f"Error reading symlink {potential_new_path}: {e}", level="WARNING")
                                    continue
                            # If not a symlink, check if the filename matches our source
                            elif filename == original_filename:
                                log_message(f"Found matching file but not a symlink: {potential_new_path}", level="WARNING")

                        if renamed:
                            break

                    if not renamed:
                        missing_files.append((source_path, dest_path))
                        log_message(f"Missing file: {source_path} - Expected at: {dest_path}", level="DEBUG")

                        # Remove the database entry for manually deleted destination files
                        if cleanup_missing and os.path.exists(source_path):
                            log_message(f"Removing database entry for manually deleted destination file: {dest_path}", level="INFO")
                            try:
                                track_file_deletion(source_path, dest_path, tmdb_id, season_number, reason="Destination file manually deleted")
                                cursor.execute("DELETE FROM processed_files WHERE file_path = ?", (source_path,))
                                cleaned_count += 1
                            except Exception as cleanup_error:
                                log_message(f"Error removing database entry for {source_path}: {cleanup_error}", level="ERROR")

            except (OSError, IOError) as e:
                log_message(f"Error accessing file or directory: {e}", level="WARNING")
                continue
            except Exception as e:
                log_message(f"Unexpected error processing paths - Source: {source_path}, Dest: {dest_path} - Error: {str(e)}", level="ERROR")
                continue

        if cleanup_missing and cleaned_count > 0:
            conn.commit()
            log_message(f"Cleaned up {cleaned_count} database entries for manually deleted destination files.", level="INFO")

        total_duration = time.time() - start_time
        log_message(f"Total time taken for display_missing_files function: {total_duration:.2f} seconds", level="INFO")
        return missing_files

    except (sqlite3.Error, DatabaseError) as e:
        log_message(f"Error in display_missing_files: {e}", level="ERROR")
        conn.rollback()
        return []
    except Exception as e:
        log_message(f"Unexpected error in display_missing_files: {str(e)}", level="ERROR")
        log_message(traceback.format_exc(), level="DEBUG")
        return []

@throttle
@retry_on_db_lock
@with_connection(main_pool)
def update_db_schema(conn):
    try:
        cursor = conn.cursor()

        # Check if the destination_path column exists
        cursor.execute("PRAGMA table_info(processed_files)")
        columns = [column[1] for column in cursor.fetchall()]

        if "destination_path" not in columns:
            # Add the destination_path column
            cursor.execute("ALTER TABLE processed_files ADD COLUMN destination_path TEXT")

            # Create an index on the new column
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_destination_path ON processed_files(destination_path)")

            log_message("Database schema updated successfully.", level="INFO")
        else:
            log_message("Database schema is already up to date.", level="INFO")

        conn.commit()
    except sqlite3.Error as e:
        log_message(f"Error updating database schema: {e}", level="ERROR")
        conn.rollback()

@throttle
@retry_on_db_lock
@with_connection(main_pool)
def update_renamed_file(conn, old_dest_path, new_dest_path):
    old_dest_path = normalize_file_path(old_dest_path)
    new_dest_path = normalize_file_path(new_dest_path)
    try:
        cursor = conn.cursor()
        cursor.execute("""
            UPDATE processed_files
            SET destination_path = ?
            WHERE destination_path = ?
        """, (new_dest_path, old_dest_path))
        conn.commit()
        if cursor.rowcount > 0:
            log_message(f"Updated renamed file in database: {old_dest_path} -> {new_dest_path}", level="INFO")
        else:
            log_message(f"No matching record found for renamed file: {old_dest_path}", level="WARNING")
    except (sqlite3.Error, DatabaseError) as e:
        log_message(f"Error updating renamed file in database: {e}", level="ERROR")
        conn.rollback()

@throttle
@retry_on_db_lock
@with_connection(main_pool)
def get_destination_path(conn, source_path):
    source_path = normalize_file_path(source_path)
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT destination_path FROM processed_files WHERE file_path = ?", (source_path,))
        result = cursor.fetchone()
        return result[0] if result else None
    except (sqlite3.Error, DatabaseError) as e:
        log_message(f"Error in get_destination_path: {e}", level="ERROR")
        conn.rollback()
        return None

def _check_path_exists_batch(paths_batch):
    """Check existence of a batch of paths and build reverse index - used for parallel processing"""
    existing_paths = []
    reverse_index = {}

    for path in paths_batch:
        if os.path.exists(path):
            existing_paths.append(path)
            if os.path.islink(path):
                try:
                    link_target = normalize_file_path(os.readlink(path))
                    reverse_index[link_target] = path
                except (OSError, IOError):
                    pass

    return existing_paths, reverse_index

@throttle
@retry_on_db_lock
@with_connection(main_pool)
def get_dest_index_from_processed_files(conn):
    """Get destination index from processed_files table, filtered by actual filesystem existence using parallel workers
    Returns destination paths set, reverse index for symlinks, and processed files set for skip checking"""
    start_time = time.time()
    try:
        cursor = conn.cursor()

        # Get destination paths for symlink checking
        cursor.execute("SELECT destination_path FROM processed_files WHERE destination_path IS NOT NULL AND destination_path != ''")
        all_dest_paths = []
        while True:
            batch = cursor.fetchmany(BATCH_SIZE)
            if not batch:
                break
            all_dest_paths.extend([row[0] for row in batch if row[0]])

        # Get ALL processed files (including failed/skipped) for duplicate checking
        cursor.execute("SELECT file_path FROM processed_files WHERE file_path IS NOT NULL")
        all_processed_files = set()
        while True:
            batch = cursor.fetchmany(BATCH_SIZE)
            if not batch:
                break
            all_processed_files.update(normalize_file_path(row[0]) for row in batch if row[0])

        total_dest_count = len(all_dest_paths)
        total_processed_count = len(all_processed_files)
        log_message(f"Checking existence of {total_dest_count} destination paths using {get_db_max_workers()} workers...", level="INFO")

        # Use parallel workers to check file existence and build reverse index
        dest_paths = set()
        reverse_index = {}
        max_workers = get_db_max_workers()
        batch_size = max(1, total_dest_count // max_workers) if max_workers > 0 else BATCH_SIZE

        with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
            path_batches = [all_dest_paths[i:i + batch_size] for i in range(0, total_dest_count, batch_size)]
            future_to_batch = {executor.submit(_check_path_exists_batch, batch): batch for batch in path_batches}

            # Collect results
            for future in concurrent.futures.as_completed(future_to_batch):
                try:
                    existing_paths, batch_reverse_index = future.result()
                    dest_paths.update(existing_paths)
                    reverse_index.update(batch_reverse_index)
                except Exception as e:
                    log_message(f"Error checking path batch: {e}", level="WARNING")

        existing_count = len(dest_paths)
        reverse_count = len(reverse_index)
        elapsed_time = time.time() - start_time
        log_message(f"Database destination index loaded: {existing_count}/{total_dest_count} existing paths, {reverse_count} symlinks indexed in {elapsed_time:.2f}s using {max_workers} workers", level="INFO")

        if reverse_index:
            sample_entries = list(reverse_index.items())[:3]

        return dest_paths, reverse_index, all_processed_files
    except (sqlite3.Error, DatabaseError) as e:
        log_message(f"Error in get_dest_index_from_processed_files: {e}", level="ERROR")
        conn.rollback()
        return set(), {}, set()

@throttle
@retry_on_db_lock
@with_connection(main_pool)
def reset_database(conn):
    """Reset the database by dropping and recreating all tables and reclaiming space."""
    try:
        cursor = conn.cursor()

        cursor.execute("DROP TABLE IF EXISTS processed_files")
        cursor.execute("DROP TABLE IF EXISTS processed_files_archive")

        cursor.execute("""
            CREATE TABLE processed_files (
                file_path TEXT PRIMARY KEY,
                destination_path TEXT,
                base_path TEXT,
                tmdb_id TEXT,
                season_number TEXT,
                reason TEXT,
                media_type TEXT,
                proper_name TEXT,
                year TEXT,
                episode_number TEXT,
                imdb_id TEXT,
                is_anime_genre INTEGER,
                language TEXT,
                quality TEXT
            )
        """)

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS processed_files_archive (
                file_path TEXT PRIMARY KEY,
                destination_path TEXT,
                archived_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        cursor.execute("CREATE INDEX idx_file_path ON processed_files(file_path)")
        cursor.execute("CREATE INDEX idx_destination_path ON processed_files(destination_path)")
        conn.commit()

        cursor.execute("VACUUM")

        log_message("Database has been reset successfully and disk space reclaimed.", level="INFO")
        return True
    except (sqlite3.Error, DatabaseError) as e:
        log_message(f"Error resetting database: {e}", level="ERROR")
        conn.rollback()
        return False

@throttle
@retry_on_db_lock
@with_connection(main_pool)
def cleanup_database(conn):
    """Clean up the database by removing entries for non-existent files."""
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT file_path, destination_path FROM processed_files")
        rows = cursor.fetchall()

        deleted_count = 0
        for file_path, dest_path in rows:
            if not os.path.exists(file_path) and not os.path.exists(dest_path):
                track_file_deletion(file_path, dest_path, reason="Both source and destination files missing")
                cursor.execute("DELETE FROM processed_files WHERE file_path = ?", (file_path,))
                deleted_count += 1

        conn.commit()
        log_message(f"Database cleanup completed. Removed {deleted_count} invalid entries.", level="INFO")
        return deleted_count
    except (sqlite3.Error, DatabaseError) as e:
        log_message(f"Error during database cleanup: {e}", level="ERROR")
        conn.rollback()
        return None

@throttle
@retry_on_db_lock
@with_connection(main_pool)
def cleanup_missing_destinations(conn):
    """Clean up database entries where destination files are missing but source files still exist."""
    try:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT file_path, destination_path, tmdb_id, season_number
            FROM processed_files
            WHERE reason IS NULL AND destination_path IS NOT NULL
        """)
        rows = cursor.fetchall()

        deleted_count = 0
        for file_path, dest_path, tmdb_id, season_number in rows:
            if file_path and dest_path:
                # Source exists but destination doesn't - this means manually deleted destination
                if os.path.exists(file_path) and not os.path.exists(dest_path):
                    log_message(f"Removing database entry for manually deleted destination: {dest_path}", level="INFO")
                    track_file_deletion(file_path, dest_path, tmdb_id, season_number, reason="Destination file manually deleted")
                    cursor.execute("DELETE FROM processed_files WHERE file_path = ?", (file_path,))
                    deleted_count += 1

        conn.commit()
        log_message(f"Missing destinations cleanup completed. Removed {deleted_count} entries for manually deleted destination files.", level="INFO")
        return deleted_count
    except (sqlite3.Error, DatabaseError) as e:
        log_message(f"Error during missing destinations cleanup: {e}", level="ERROR")
        conn.rollback()
        return None

@throttle
@retry_on_db_lock
@with_connection(main_pool)
def vacuum_database(conn):
    """Perform database vacuum to optimize storage and performance."""
    try:
        cursor = conn.cursor()

        # Set pragma to enable auto vacuum
        cursor.execute("PRAGMA auto_vacuum = FULL")

        # Execute vacuum
        cursor.execute("VACUUM")

        # Analyze tables after vacuum
        cursor.execute("ANALYZE")

        log_message("Database vacuum completed successfully.", level="INFO")
        return True
    except (sqlite3.Error, DatabaseError) as e:
        log_message(f"Error during database vacuum: {e}", level="ERROR")
        return False

def populate_missing_file_sizes(cursor, conn):
    """Populate file_size column for existing records that don't have it - called during initialization"""
    try:
        # Check if we need to populate file sizes
        cursor.execute("SELECT COUNT(*) FROM processed_files WHERE file_size IS NULL AND file_path IS NOT NULL")
        missing_count = cursor.fetchone()[0]

        if missing_count == 0:
            log_message("All records already have file sizes populated.", level="INFO")
            return

        # Get records without file sizes in batches
        cursor.execute("""
            SELECT file_path, destination_path
            FROM processed_files
            WHERE file_size IS NULL AND file_path IS NOT NULL
            LIMIT 1000
        """)

        records = cursor.fetchall()
        updated_count = 0

        for file_path, dest_path in records:
            file_size = None

            # Try to get size from source file first
            if file_path and os.path.exists(file_path):
                try:
                    file_size = os.path.getsize(file_path)
                except (OSError, IOError):
                    pass

            # If source doesn't exist, try destination
            if file_size is None and dest_path and os.path.exists(dest_path):
                try:
                    # For symlinks, get the size of the target file
                    if os.path.islink(dest_path):
                        target = os.readlink(dest_path)
                        if os.path.exists(target):
                            file_size = os.path.getsize(target)
                    else:
                        file_size = os.path.getsize(dest_path)
                except (OSError, IOError):
                    pass

            # Update the record if we got a file size
            if file_size is not None:
                cursor.execute("UPDATE processed_files SET file_size = ? WHERE file_path = ?", (file_size, file_path))
                updated_count += 1

        if updated_count > 0:
            conn.commit()

    except Exception as e:
        log_message(f"Error populating file sizes during initialization: {e}", level="WARNING")

@throttle
@retry_on_db_lock
@with_connection(main_pool)
def populate_all_file_sizes(conn):
    """Populate file_size column for ALL records - command line option"""
    try:
        # Get all records
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM processed_files WHERE file_path IS NOT NULL")
        total_count = cursor.fetchone()[0]

        cursor.execute("SELECT COUNT(*) FROM processed_files WHERE file_size IS NOT NULL")
        existing_count = cursor.fetchone()[0]

        # Process all records in batches
        batch_size = 500
        updated_count = 0
        error_count = 0

        for offset in range(0, total_count, batch_size):
            cursor.execute("""
                SELECT file_path, destination_path
                FROM processed_files
                WHERE file_path IS NOT NULL
                LIMIT ? OFFSET ?
            """, (batch_size, offset))

            records = cursor.fetchall()
            log_message(f"Processing batch {offset//batch_size + 1}/{(total_count + batch_size - 1)//batch_size} ({len(records)} records)", level="INFO")

            for file_path, dest_path in records:
                file_size = None

                # Try to get size from source file first
                if file_path and os.path.exists(file_path):
                    try:
                        file_size = os.path.getsize(file_path)
                    except (OSError, IOError):
                        pass

                # If source doesn't exist, try destination
                if file_size is None and dest_path and os.path.exists(dest_path):
                    try:
                        # For symlinks, get the size of the target file
                        if os.path.islink(dest_path):
                            target = os.readlink(dest_path)
                            if os.path.exists(target):
                                file_size = os.path.getsize(target)
                        else:
                            file_size = os.path.getsize(dest_path)
                    except (OSError, IOError):
                        pass

                # Update the record
                if file_size is not None:
                    cursor.execute("UPDATE processed_files SET file_size = ? WHERE file_path = ?", (file_size, file_path))
                    updated_count += 1

                    if updated_count <= 5:  # Log first few for verification
                        log_message(f"Updated {os.path.basename(file_path)}: {file_size} bytes ({file_size/(1024*1024):.2f} MB)", level="INFO")
                else:
                    error_count += 1

            # Commit batch
            conn.commit()

        log_message(f"File size population completed:", level="INFO")
        log_message(f"  - Total records processed: {total_count}", level="INFO")
        log_message(f"  - Successfully updated: {updated_count}", level="INFO")
        log_message(f"  - Errors/missing files: {error_count}", level="INFO")
        log_message(f"  - Success rate: {(updated_count/total_count)*100:.1f}%", level="INFO")

        # Show storage summary
        cursor.execute("SELECT SUM(file_size) FROM processed_files WHERE file_size IS NOT NULL")
        total_size = cursor.fetchone()[0] or 0
        log_message(f"Total storage calculated: {total_size} bytes ({total_size/(1024*1024*1024):.2f} GB)", level="INFO")

    except Exception as e:
        log_message(f"Error in populate_all_file_sizes: {e}", level="ERROR")
        conn.rollback()

@throttle
@retry_on_db_lock
@with_connection(main_pool)
def get_total_storage_size(conn):
    """Get total storage size from file_size column in database - fast and accurate"""
    try:
        cursor = conn.cursor()

        # Get total size from stored file sizes
        cursor.execute("SELECT SUM(file_size) FROM processed_files WHERE file_size IS NOT NULL")
        result = cursor.fetchone()
        total_size = result[0] if result and result[0] is not None else 0

        # Get count of files with stored sizes
        cursor.execute("SELECT COUNT(*) FROM processed_files WHERE file_size IS NOT NULL")
        files_with_size = cursor.fetchone()[0]

        # Get total file count
        cursor.execute("SELECT COUNT(*) FROM processed_files WHERE destination_path IS NOT NULL AND destination_path != ''")
        total_files = cursor.fetchone()[0]

        log_message(f"Storage calculation: {files_with_size}/{total_files} files have stored sizes, total: {total_size} bytes ({total_size/(1024*1024*1024):.2f} GB)", level="INFO")

        return total_size, files_with_size, total_files

    except (sqlite3.Error, DatabaseError) as e:
        log_message(f"Error in get_total_storage_size: {e}", level="ERROR")
        return 0, 0, 0


def track_file_addition(source_path, dest_path, tmdb_id=None, season_number=None):
    """Track file addition in WebDavHub with availability checking"""
    try:
        payload = {
            'operation': 'add',
            'sourcePath': source_path,
            'destinationPath': dest_path,
            'tmdbId': str(tmdb_id) if tmdb_id else '',
            'seasonNumber': str(season_number) if season_number else ''
        }

        cinesync_ip = get_cinesync_ip()
        cinesync_port = get_cinesync_api_port()
        url = f"http://{cinesync_ip}:{cinesync_port}/api/file-operations"

        send_dashboard_notification(url, payload, "file addition")

    except Exception as e:
        log_message(f"Error tracking file addition: {e}", level="DEBUG")

@throttle
@retry_on_db_lock
@with_connection(main_pool)
def save_deleted_file(conn, source_path, dest_path, tmdb_id=None, season_number=None, deletion_reason="", trash_file_name=None):
    """Save complete file metadata to deleted_files table before deletion"""
    source_path = normalize_file_path(source_path)
    if dest_path:
        dest_path = normalize_file_path(dest_path)
    
    try:
        cursor = conn.cursor()

        cursor.execute("""
            SELECT file_path, destination_path, base_path, tmdb_id, season_number, reason,
                   media_type, proper_name, year, episode_number, imdb_id, is_anime_genre,
                   language, quality, tvdb_id, league_id, sportsdb_event_id, sport_name,
                   sport_round, sport_location, sport_session, sport_venue, sport_date,
                   file_size, processed_at
            FROM processed_files 
            WHERE file_path = ? OR destination_path = ?
        """, (source_path, dest_path))
        
        result = cursor.fetchone()
        
        if result:
            (file_path, destination_path, base_path, tmdb_id_db, season_number_db, reason,
             media_type, proper_name, year, episode_number, imdb_id, is_anime_genre,
             language, quality, tvdb_id, league_id, sportsdb_event_id, sport_name,
             sport_round, sport_location, sport_session, sport_venue, sport_date,
             file_size, processed_at) = result

            final_tmdb_id = tmdb_id if tmdb_id else tmdb_id_db
            final_season_number = season_number if season_number else season_number_db
            
        else:
            file_path = source_path
            destination_path = dest_path
            base_path = None
            final_tmdb_id = tmdb_id
            final_season_number = season_number
            reason = None
            media_type = proper_name = year = episode_number = imdb_id = None
            is_anime_genre = language = quality = tvdb_id = league_id = sportsdb_event_id = None
            sport_name = sport_round = sport_location = sport_session = sport_venue = sport_date = None
            file_size = processed_at = None
        
        # Generate trash file name if not provided
        if not trash_file_name and dest_path:
            trash_file_name = os.path.basename(dest_path)
        
        # Insert into deleted_files table
        cursor.execute("""
            INSERT INTO deleted_files (
                file_path, destination_path, base_path, tmdb_id, season_number, reason,
                media_type, proper_name, year, episode_number, imdb_id, is_anime_genre,
                language, quality, tvdb_id, league_id, sportsdb_event_id, sport_name,
                sport_round, sport_location, sport_session, sport_venue, sport_date,
                file_size, processed_at, deletion_reason, trash_file_name
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            file_path, destination_path, base_path, final_tmdb_id, final_season_number, reason,
            media_type, proper_name, year, episode_number, imdb_id, is_anime_genre,
            language, quality, tvdb_id, league_id, sportsdb_event_id, sport_name,
            sport_round, sport_location, sport_session, sport_venue, sport_date,
            file_size, processed_at, deletion_reason, trash_file_name
        ))
        
        conn.commit()
        log_message(f"Saved deleted file metadata: {dest_path or source_path}", level="DEBUG")
        
    except (sqlite3.Error, DatabaseError) as e:
        log_message(f"Error saving deleted file: {e}", level="ERROR")
        conn.rollback()

def track_file_deletion(source_path, dest_path, tmdb_id=None, season_number=None, reason=""):
    """Track file deletion by saving metadata and notifying WebDavHub"""
    try:
        trash_file_name = os.path.basename(dest_path) if dest_path else None
        save_deleted_file(source_path, dest_path, tmdb_id, season_number, reason, trash_file_name)

        payload = {
            'operation': 'delete',
            'sourcePath': source_path,
            'destinationPath': dest_path,
            'tmdbId': str(tmdb_id) if tmdb_id else '',
            'seasonNumber': str(season_number) if season_number else '',
            'reason': reason
        }

        cinesync_ip = get_cinesync_ip()
        cinesync_port = get_cinesync_api_port()
        url = f"http://{cinesync_ip}:{cinesync_port}/api/file-operations"

        send_dashboard_notification(url, payload, "file deletion")

    except Exception as e:
        log_message(f"Error tracking file deletion: {e}", level="DEBUG")

@throttle
@retry_on_db_lock
@with_connection(main_pool)
def get_deleted_files(conn, limit=None, offset=None, search_query=None):
    """Get deleted files from the deleted_files table"""
    try:
        cursor = conn.cursor()
        query = """
            SELECT id, file_path, destination_path, base_path, tmdb_id, season_number, reason,
                   media_type, proper_name, year, episode_number, imdb_id, is_anime_genre,
                   language, quality, tvdb_id, league_id, sportsdb_event_id, sport_name,
                   sport_round, sport_location, sport_session, sport_venue, sport_date,
                   file_size, processed_at, deleted_at, deletion_reason, trash_file_name
            FROM deleted_files
        """
        
        params = []
        
        # Add search filter if provided
        if search_query:
            query += """ WHERE (proper_name LIKE ? OR file_path LIKE ? OR destination_path LIKE ?)"""
            search_pattern = f"%{search_query}%"
            params.extend([search_pattern, search_pattern, search_pattern])
        
        # Add ordering
        query += " ORDER BY deleted_at DESC"
        
        # Add pagination if provided
        if limit:
            query += " LIMIT ?"
            params.append(limit)
            if offset:
                query += " OFFSET ?"
                params.append(offset)
        
        cursor.execute(query, params)
        return cursor.fetchall()
        
    except (sqlite3.Error, DatabaseError) as e:
        log_message(f"Error getting deleted files: {e}", level="ERROR")
        return []

@throttle
@retry_on_db_lock
@with_connection(main_pool)
def get_deleted_files_count(conn, search_query=None):
    """Get count of deleted files"""
    try:
        cursor = conn.cursor()
        
        query = "SELECT COUNT(*) FROM deleted_files"
        params = []
        
        if search_query:
            query += " WHERE (proper_name LIKE ? OR file_path LIKE ? OR destination_path LIKE ?)"
            search_pattern = f"%{search_query}%"
            params.extend([search_pattern, search_pattern, search_pattern])
        
        cursor.execute(query, params)
        return cursor.fetchone()[0]
        
    except (sqlite3.Error, DatabaseError) as e:
        log_message(f"Error getting deleted files count: {e}", level="ERROR")
        return 0

@throttle
@retry_on_db_lock
@with_connection(main_pool)
def restore_deleted_file(conn, deleted_file_id):
    """Restore a deleted file back to processed_files table"""
    try:
        cursor = conn.cursor()
        
        # Get the deleted file record
        cursor.execute("""
            SELECT file_path, destination_path, base_path, tmdb_id, season_number, reason,
                   media_type, proper_name, year, episode_number, imdb_id, is_anime_genre,
                   language, quality, tvdb_id, league_id, sportsdb_event_id, sport_name,
                   sport_round, sport_location, sport_session, sport_venue, sport_date,
                   file_size, processed_at, trash_file_name
            FROM deleted_files 
            WHERE id = ?
        """, (deleted_file_id,))
        
        result = cursor.fetchone()
        
        if not result:
            log_message(f"Deleted file with ID {deleted_file_id} not found", level="ERROR")
            return False
        
        (file_path, destination_path, base_path, tmdb_id, season_number, reason,
         media_type, proper_name, year, episode_number, imdb_id, is_anime_genre,
         language, quality, tvdb_id, league_id, sportsdb_event_id, sport_name,
         sport_round, sport_location, sport_session, sport_venue, sport_date,
         file_size, processed_at, trash_file_name) = result
        
        # Check if the trash file still exists
        if trash_file_name:
            trash_path = os.path.join(DB_DIR, 'trash', trash_file_name)
            if not os.path.exists(trash_path):
                log_message(f"Trash file not found for restoration: {trash_path}", level="ERROR")
                return False
        
        # Insert back into processed_files (using INSERT OR REPLACE to handle duplicates)
        cursor.execute("""
            INSERT OR REPLACE INTO processed_files (
                file_path, destination_path, base_path, tmdb_id, season_number, reason,
                media_type, proper_name, year, episode_number, imdb_id, is_anime_genre,
                language, quality, tvdb_id, league_id, sportsdb_event_id, sport_name,
                sport_round, sport_location, sport_session, sport_venue, sport_date,
                file_size, processed_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            file_path, destination_path, base_path, tmdb_id, season_number, reason,
            media_type, proper_name, year, episode_number, imdb_id, is_anime_genre,
            language, quality, tvdb_id, league_id, sportsdb_event_id, sport_name,
            sport_round, sport_location, sport_session, sport_venue, sport_date,
            file_size, processed_at
        ))
        
        # Remove from deleted_files table
        cursor.execute("DELETE FROM deleted_files WHERE id = ?", (deleted_file_id,))
        
        conn.commit()
        log_message(f"Restored deleted file: {destination_path or file_path}", level="INFO")
        
        # Notify WebDavHub about the restoration
        if destination_path:
            track_file_addition(file_path, destination_path, tmdb_id, season_number)
        
        return True
        
    except (sqlite3.Error, DatabaseError) as e:
        log_message(f"Error restoring deleted file: {e}", level="ERROR")
        conn.rollback()
        return False

@throttle
@retry_on_db_lock
@with_connection(main_pool)
def permanently_delete_file(conn, deleted_file_id):
    """Permanently delete a file from deleted_files table and remove trash file"""
    try:
        cursor = conn.cursor()
        
        # Get the trash file name
        cursor.execute("SELECT trash_file_name FROM deleted_files WHERE id = ?", (deleted_file_id,))
        result = cursor.fetchone()
        
        if result and result[0]:
            trash_file_name = result[0]
            trash_path = os.path.join(DB_DIR, 'trash', trash_file_name)
            
            # Remove the trash file if it exists
            if os.path.exists(trash_path):
                try:
                    if os.path.isdir(trash_path):
                        for root, dirs, files in os.walk(trash_path, topdown=False):
                            for file in files:
                                file_path = os.path.join(root, file)
                                os.remove(file_path)
                            for dir_name in dirs:
                                dir_path = os.path.join(root, dir_name)
                                os.rmdir(dir_path)
                        os.rmdir(trash_path)
                        log_message(f"Removed trash directory: {trash_path}", level="DEBUG")
                    else:
                        os.remove(trash_path)
                        log_message(f"Removed trash file: {trash_path}", level="DEBUG")
                except (OSError, IOError) as e:
                    log_message(f"Failed to remove trash file {trash_path}: {e}", level="WARNING")
        
        # Remove from deleted_files table
        cursor.execute("DELETE FROM deleted_files WHERE id = ?", (deleted_file_id,))
        
        if cursor.rowcount > 0:
            conn.commit()
            log_message(f"Permanently deleted file with ID {deleted_file_id}", level="INFO")
            return True
        else:
            log_message(f"Deleted file with ID {deleted_file_id} not found", level="ERROR")
            return False
        
    except (sqlite3.Error, DatabaseError) as e:
        log_message(f"Error permanently deleting file: {e}", level="ERROR")
        conn.rollback()
        return False

def track_force_recreation(source_path, new_dest_path, new_tmdb_id, new_season_number, new_proper_name, new_year, new_media_type, old_dest_path=None, old_proper_name=None, old_year=None):
    """Track force recreation in WebDavHub - removes old entry and adds new entry in one operation"""
    try:
        payload = {
            'operation': 'force_recreate',
            'sourcePath': source_path,
            'destinationPath': new_dest_path,
            'tmdbId': str(new_tmdb_id) if new_tmdb_id else '',
            'seasonNumber': str(new_season_number) if new_season_number else '',
            'properName': new_proper_name or '',
            'year': new_year or '',
            'mediaType': new_media_type or '',
            'oldDestinationPath': old_dest_path or '',
            'oldProperName': old_proper_name or '',
            'oldYear': old_year or ''
        }

        cinesync_ip = get_cinesync_ip()
        cinesync_port = get_cinesync_api_port()
        url = f"http://{cinesync_ip}:{cinesync_port}/api/file-operations"

        send_dashboard_notification(url, payload, "force recreation")

    except Exception as e:
        log_message(f"Error tracking force recreation: {e}", level="DEBUG")

def save_file_failure(source_path, tmdb_id=None, season_number=None, reason="", error_message="", media_type=None, proper_name=None, year=None, episode_number=None, imdb_id=None, is_anime_genre=None, language=None, quality=None, tvdb_id=None):
    """Save file processing failure directly to database"""
    try:
        save_processed_file(
            source_path=source_path,
            dest_path=None,
            tmdb_id=tmdb_id,
            season_number=season_number,
            reason=reason,
            error_message=error_message,
            media_type=media_type,
            proper_name=proper_name,
            year=year,
            episode_number=episode_number,
            imdb_id=imdb_id,
            is_anime_genre=is_anime_genre,
            language=language,
            quality=quality,
            tvdb_id=tvdb_id
        )
        log_message(f"Saved failure to database: {source_path} - {reason}", level="DEBUG")
    except Exception as e:
        log_message(f"Failed to save failure to database: {e}", level="DEBUG")

def track_file_failure(source_path, tmdb_id=None, season_number=None, reason="", error_message="", media_type=None, proper_name=None, year=None, episode_number=None, imdb_id=None, is_anime_genre=None, tvdb_id=None):
    """Track file processing failure in both database and WebDavHub"""
    save_file_failure(source_path, tmdb_id, season_number, reason, error_message, media_type, proper_name, year, episode_number, imdb_id, is_anime_genre, None, None, tvdb_id)

    try:
        payload = {
            'operation': 'failed',
            'sourcePath': source_path,
            'tmdbId': str(tmdb_id) if tmdb_id else '',
            'seasonNumber': str(season_number) if season_number else '',
            'reason': reason,
            'error': error_message
        }

        cinesync_ip = get_cinesync_ip()
        cinesync_port = get_cinesync_api_port()
        url = f"http://{cinesync_ip}:{cinesync_port}/api/file-operations"

        send_dashboard_notification(url, payload, "file failure")

    except Exception as e:
        log_message(f"Error tracking file failure: {e}", level="DEBUG")


@throttle
@retry_on_db_lock
@with_connection(main_pool)
def track_and_remove_file_record(conn, file_path, dest_path=None, reason="File no longer exists"):
    """Track file deletion and then remove from processed_files table"""
    try:
        cursor = conn.cursor()

        # If dest_path not provided, try to get it from database
        if not dest_path:
            cursor.execute("SELECT destination_path, tmdb_id, season_number FROM processed_files WHERE file_path = ?", (file_path,))
            result = cursor.fetchone()
            if result:
                dest_path, tmdb_id, season_number = result
            else:
                tmdb_id, season_number = None, None
        else:
            # Get additional metadata if available
            cursor.execute("SELECT tmdb_id, season_number FROM processed_files WHERE file_path = ? OR destination_path = ?", (file_path, dest_path))
            result = cursor.fetchone()
            if result:
                tmdb_id, season_number = result
            else:
                tmdb_id, season_number = None, None

        # Track the deletion before removing from database
        if dest_path:
            track_file_deletion(file_path, dest_path, tmdb_id, season_number, reason)

        # Now remove from database
        cursor.execute("DELETE FROM processed_files WHERE file_path = ?", (file_path,))
        affected_rows = cursor.rowcount

        if affected_rows > 0:
            conn.commit()

        return affected_rows

    except (sqlite3.Error, DatabaseError) as e:
        log_message(f"Error in track_and_remove_file_record: {e}", level="ERROR")
        conn.rollback()
        return 0

@throttle
@retry_on_db_lock
@with_connection(main_pool)
def verify_database_integrity(conn):
    """Verify database integrity and check for corruption."""
    try:
        cursor = conn.cursor()
        cursor.execute("PRAGMA integrity_check")
        result = cursor.fetchone()[0]

        if result == "ok":
            log_message("Database integrity check passed.", level="INFO")
            return True
        else:
            log_message(f"Database integrity check failed: {result}", level="ERROR")
            return False
    except (sqlite3.Error, DatabaseError) as e:
        log_message(f"Error during integrity check: {e}", level="ERROR")
        return False

@throttle
@retry_on_db_lock
@with_connection(main_pool)
def export_database(conn, export_path):
    """Export database contents to a CSV file."""
    try:
        cursor = conn.cursor()

        # Export main table
        with open(export_path, 'w', newline='') as csvfile:
            csv_writer = csv.writer(csvfile)
            csv_writer.writerow(['file_path', 'destination_path'])

            cursor.execute("SELECT file_path, destination_path FROM processed_files")
            while True:
                rows = cursor.fetchmany(BATCH_SIZE)
                if not rows:
                    break
                csv_writer.writerows(rows)

        log_message(f"Database successfully exported to {export_path}", level="INFO")
        return True
    except (sqlite3.Error, DatabaseError, IOError) as e:
        log_message(f"Error exporting database: {e}", level="ERROR")
        return False

@throttle
@retry_on_db_lock
@with_connection(main_pool)
def get_database_stats(conn):
    """Get statistics about the database including all related files, after validating entries."""
    try:
        cursor = conn.cursor()
        stats = {}

        # First, clean up missing files with improved validation
        cursor.execute("SELECT file_path, destination_path FROM processed_files")
        rows = cursor.fetchall()
        deleted_count = 0

        for file_path, dest_path in rows:
            should_delete = False
            if file_path:
                file_path = os.path.normpath(file_path)
            if dest_path:
                dest_path = os.path.normpath(dest_path)

            if (file_path and not os.path.exists(file_path) and
                dest_path and not os.path.exists(dest_path)):
                should_delete = True
                log_message(f"Both paths missing for entry - Source: {file_path}, Dest: {dest_path}", level="DEBUG")

            if should_delete:
                track_file_deletion(file_path, dest_path, reason="Both source and destination paths missing")
                cursor.execute("DELETE FROM processed_files WHERE file_path = ?", (file_path,))
                deleted_count += 1

        if deleted_count > 0:
            conn.commit()
            log_message(f"Removed {deleted_count} entries for missing files", level="INFO")

        cursor.execute("SELECT COUNT(*) FROM processed_files")
        stats['total_records'] = cursor.fetchone()[0]

        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='processed_files_archive'")
        if cursor.fetchone():
            cursor.execute("SELECT COUNT(*) FROM processed_files_archive")
            stats['archived_records'] = cursor.fetchone()[0]
        else:
            stats['archived_records'] = 0

        def get_total_db_size(db_path):
            total_size = 0
            if os.path.exists(db_path):
                total_size += os.path.getsize(db_path)
                # Add WAL file size if exists
                wal_path = db_path + "-wal"
                if os.path.exists(wal_path):
                    total_size += os.path.getsize(wal_path)
                # Add SHM file size if exists
                shm_path = db_path + "-shm"
                if os.path.exists(shm_path):
                    total_size += os.path.getsize(shm_path)
            return total_size / (1024 * 1024)

        stats['main_db_size'] = get_total_db_size(DB_FILE)
        stats['archive_db_size'] = get_total_db_size(ARCHIVE_DB_FILE)

        stats['details'] = {
            'main_db': {
                'db': f"{os.path.getsize(DB_FILE) / (1024 * 1024):.2f} MB" if os.path.exists(DB_FILE) else "0.00 MB",
                'wal': f"{os.path.getsize(DB_FILE + '-wal') / (1024 * 1024):.2f} MB" if os.path.exists(DB_FILE + '-wal') else "0.00 MB",
                'shm': f"{os.path.getsize(DB_FILE + '-shm') / (1024 * 1024):.2f} MB" if os.path.exists(DB_FILE + '-shm') else "0.00 MB"
            }
        }

        return stats
    except (sqlite3.Error, DatabaseError) as e:
        log_message(f"Error getting database stats: {e}", level="ERROR")
        return None

@throttle
@retry_on_db_lock
@with_connection(main_pool)
def import_database(conn, import_path):
    """Import database contents from a CSV file with path validation."""
    try:
        cursor = conn.cursor()
        imported_count = 0

        with open(import_path, 'r', newline='') as csvfile:
            csv_reader = csv.reader(csvfile)
            next(csv_reader)

            # Process in batches
            batch = []
            for row in csv_reader:
                if len(row) >= 2:
                    source_path = os.path.normpath(row[0]) if row[0] else None
                    dest_path = os.path.normpath(row[1]) if row[1] else None

                    if (source_path and os.path.exists(source_path)) or (dest_path and os.path.exists(dest_path)):
                        batch.append((source_path, dest_path))

                if len(batch) >= BATCH_SIZE:
                    cursor.executemany("""
                        INSERT OR REPLACE INTO processed_files (file_path, destination_path)
                        VALUES (?, ?)
                    """, batch)
                    imported_count += len(batch)
                    batch = []

            if batch:
                cursor.executemany("""
                    INSERT OR REPLACE INTO processed_files (file_path, destination_path)
                    VALUES (?, ?)
                """, batch)
                imported_count += len(batch)

        conn.commit()
        log_message(f"Successfully imported {imported_count} records from {import_path}", level="INFO")
        return True
    except (sqlite3.Error, DatabaseError, IOError) as e:
        log_message(f"Error importing database: {e}", level="ERROR")
        conn.rollback()
        return False

@throttle
@retry_on_db_lock
@with_connection(main_pool)
def search_database(conn, pattern):
    """Search for files in database matching the given pattern."""
    try:
        cursor = conn.cursor()
        search_pattern = f"%{pattern}%"

        # Check which columns exist to build appropriate query
        cursor.execute("PRAGMA table_info(processed_files)")
        columns = [column[1] for column in cursor.fetchall()]
        
        # Build column list dynamically based on available columns
        base_columns = ["file_path", "destination_path", "tmdb_id", "season_number", "reason", "file_size"]
        extra_columns = []
        
        if "base_path" in columns:
            extra_columns.append("base_path")
        if all(col in columns for col in ["media_type", "proper_name", "year", "episode_number", "imdb_id", "is_anime_genre"]):
            extra_columns.extend(["media_type", "proper_name", "year", "episode_number", "imdb_id", "is_anime_genre"])
        if "error_message" in columns:
            extra_columns.append("error_message")
        if "processed_at" in columns:
            extra_columns.append("processed_at")
        if all(col in columns for col in ["language", "quality"]):
            extra_columns.extend(["language", "quality"])
        if "tvdb_id" in columns:
            extra_columns.append("tvdb_id")
        if "league_id" in columns:
            extra_columns.append("league_id")
        if "sportsdb_event_id" in columns:
            extra_columns.append("sportsdb_event_id")
        if all(col in columns for col in ["sport_name", "sport_round", "sport_location", "sport_session", "sport_venue", "sport_date"]):
            extra_columns.extend(["sport_name", "sport_round", "sport_location", "sport_session", "sport_venue", "sport_date"])
            # Add new sports fields if they exist
            if "sport_city" in columns:
                extra_columns.append("sport_city")
            if "sport_country" in columns:
                extra_columns.append("sport_country")
            if "sport_time" in columns:
                extra_columns.append("sport_time")
        if all(col in columns for col in ["original_language", "overview", "runtime", "original_title", "status", "release_date", "first_air_date", "last_air_date", "genres", "certification"]):
            extra_columns.extend(["original_language", "overview", "runtime", "original_title", "status", "release_date", "first_air_date", "last_air_date", "genres", "certification"])
        if all(col in columns for col in ["episode_title", "total_episodes"]):
            extra_columns.extend(["episode_title", "total_episodes"])
        
        all_columns = base_columns + extra_columns
        
        # Build WHERE clause dynamically based on searchable columns
        searchable_columns = ["file_path", "destination_path", "tmdb_id", "proper_name", "imdb_id", "language", "quality", "tvdb_id", "league_id", "sportsdb_event_id"]
        if "base_path" in columns:
            searchable_columns.append("base_path")
        if "episode_title" in columns:
            searchable_columns.append("episode_title")
        
        # Filter searchable columns to only include those that actually exist
        searchable_columns = [col for col in searchable_columns if col in columns]
        
        where_clause = " OR ".join([f"{col} LIKE ?" for col in searchable_columns])
        search_params = [search_pattern] * len(searchable_columns)
        
        query = f"SELECT {', '.join(all_columns)} FROM processed_files WHERE {where_clause}"
        cursor.execute(query, search_params)

        results = cursor.fetchall()
        if results:
            log_message("-" * 50, level="INFO")
            log_message(f"Found {len(results)} matches for pattern '{pattern}':", level="INFO")
            log_message("-" * 50, level="INFO")
            
            for row in results:
                # Create a dictionary mapping column names to values
                result_dict = dict(zip(all_columns, row))
                
                # Display basic information
                log_message(f"Source: {result_dict.get('file_path', 'N/A')}", level="INFO")
                log_message(f"Destination: {result_dict.get('destination_path', 'N/A')}", level="INFO")
                
                if result_dict.get('file_size'):
                    log_message(f"File Size: {format_file_size(result_dict['file_size'])}", level="INFO")
                
                if result_dict.get('tmdb_id'):
                    # Display appropriate ID label based on media type
                    if result_dict.get('media_type') == 'Sports':
                        log_message(f"League ID: {result_dict['tmdb_id']}", level="INFO")
                    else:
                        log_message(f"TMDB ID: {result_dict['tmdb_id']}", level="INFO")

                # Display additional metadata if available
                if result_dict.get('imdb_id'):
                    log_message(f"IMDB ID: {result_dict['imdb_id']}", level="INFO")
                if result_dict.get('tvdb_id'):
                    log_message(f"TVDB ID: {result_dict['tvdb_id']}", level="INFO")
                if result_dict.get('sportsdb_event_id'):
                    log_message(f"SportsDB Event ID: {result_dict['sportsdb_event_id']}", level="INFO")
                if result_dict.get('media_type'):
                    log_message(f"Media Type: {result_dict['media_type']}", level="INFO")
                if result_dict.get('proper_name'):
                    log_message(f"Title: {result_dict['proper_name']}", level="INFO")
                if result_dict.get('year'):
                    log_message(f"Year: {result_dict['year']}", level="INFO")
                if result_dict.get('base_path'):
                    log_message(f"Base Path: {result_dict['base_path']}", level="INFO")
                if result_dict.get('season_number') is not None:
                    log_message(f"Season Number: {result_dict['season_number']}", level="INFO")
                if result_dict.get('episode_number') is not None:
                    log_message(f"Episode Number: {result_dict['episode_number']}", level="INFO")
                if result_dict.get('is_anime_genre') is not None:
                    log_message(f"Anime Genre: {'Yes' if result_dict['is_anime_genre'] else 'No'}", level="INFO")
                if result_dict.get('language'):
                    log_message(f"Language: {result_dict['language']}", level="INFO")
                if result_dict.get('quality'):
                    log_message(f"Quality: {result_dict['quality']}", level="INFO")
                if result_dict.get('original_language'):
                    log_message(f"Original Language: {result_dict['original_language']}", level="INFO")
                if result_dict.get('overview'):
                    log_message(f"Overview: {result_dict['overview'][:100]}..." if len(result_dict['overview']) > 100 else f"Overview: {result_dict['overview']}", level="INFO")
                if result_dict.get('runtime'):
                    log_message(f"Runtime: {result_dict['runtime']} minutes", level="INFO")
                if result_dict.get('original_title'):
                    log_message(f"Original Title: {result_dict['original_title']}", level="INFO")
                if result_dict.get('status'):
                    log_message(f"Status: {result_dict['status']}", level="INFO")
                if result_dict.get('release_date'):
                    log_message(f"Release Date: {result_dict['release_date']}", level="INFO")
                if result_dict.get('first_air_date'):
                    log_message(f"First Air Date: {result_dict['first_air_date']}", level="INFO")
                if result_dict.get('last_air_date'):
                    log_message(f"Last Air Date: {result_dict['last_air_date']}", level="INFO")
                if result_dict.get('genres'):
                    log_message(f"Genres: {result_dict['genres']}", level="INFO")
                if result_dict.get('certification'):
                    log_message(f"Certification: {result_dict['certification']}", level="INFO")
                if result_dict.get('episode_title'):
                    log_message(f"Episode Title: {result_dict['episode_title']}", level="INFO")
                if result_dict.get('total_episodes'):
                    log_message(f"Total Episodes: {result_dict['total_episodes']}", level="INFO")
                if result_dict.get('sport_name'):
                    log_message(f"Sport: {result_dict['sport_name']}", level="INFO")
                if result_dict.get('sport_round'):
                    log_message(f"Round: {result_dict['sport_round']}", level="INFO")
                if result_dict.get('sport_location'):
                    log_message(f"Event: {result_dict['sport_location']}", level="INFO")
                if result_dict.get('sport_session'):
                    log_message(f"Session: {result_dict['sport_session']}", level="INFO")
                if result_dict.get('sport_venue'):
                    log_message(f"Venue: {result_dict['sport_venue']}", level="INFO")
                if result_dict.get('sport_city'):
                    log_message(f"City: {result_dict['sport_city']}", level="INFO")
                if result_dict.get('sport_country'):
                    log_message(f"Country: {result_dict['sport_country']}", level="INFO")
                if result_dict.get('sport_time'):
                    log_message(f"Time: {result_dict['sport_time']}", level="INFO")
                if result_dict.get('sport_date'):
                    log_message(f"Date: {result_dict['sport_date']}", level="INFO")

                if result_dict.get('reason'):
                    log_message(f"Skip Reason: {result_dict['reason']}", level="INFO")
                
                log_message("-" * 50, level="INFO")
        else:
            log_message(f"No matches found for pattern '{pattern}'", level="INFO")
        return results
    except (sqlite3.Error, DatabaseError) as e:
        log_message(f"Error searching database: {e}", level="ERROR")
        return []

@throttle
@retry_on_db_lock
@with_connection(main_pool)
def search_database_silent(conn, pattern):
    """Silent version of search_database that never logs results."""
    try:
        cursor = conn.cursor()
        search_pattern = f"%{pattern}%"

        # Check which columns exist to build appropriate query
        cursor.execute("PRAGMA table_info(processed_files)")
        columns = [column[1] for column in cursor.fetchall()]
        
        # Build column list dynamically based on available columns
        base_columns = ["file_path", "destination_path", "tmdb_id", "season_number", "reason", "file_size"]
        extra_columns = []
        
        if "base_path" in columns:
            extra_columns.append("base_path")
        if all(col in columns for col in ["media_type", "proper_name", "year", "episode_number", "imdb_id", "is_anime_genre"]):
            extra_columns.extend(["media_type", "proper_name", "year", "episode_number", "imdb_id", "is_anime_genre"])
        if "error_message" in columns:
            extra_columns.append("error_message")
        if "processed_at" in columns:
            extra_columns.append("processed_at")
        if all(col in columns for col in ["language", "quality"]):
            extra_columns.extend(["language", "quality"])
        if "tvdb_id" in columns:
            extra_columns.append("tvdb_id")
        if "league_id" in columns:
            extra_columns.append("league_id")
        if "sportsdb_event_id" in columns:
            extra_columns.append("sportsdb_event_id")
        if all(col in columns for col in ["sport_name", "sport_round", "sport_location", "sport_session", "sport_venue", "sport_date"]):
            extra_columns.extend(["sport_name", "sport_round", "sport_location", "sport_session", "sport_venue", "sport_date"])
            # Add new sports fields if they exist
            if "sport_city" in columns:
                extra_columns.append("sport_city")
            if "sport_country" in columns:
                extra_columns.append("sport_country")
            if "sport_time" in columns:
                extra_columns.append("sport_time")
        if all(col in columns for col in ["original_language", "overview", "runtime", "original_title", "status", "release_date", "first_air_date", "last_air_date", "genres", "certification"]):
            extra_columns.extend(["original_language", "overview", "runtime", "original_title", "status", "release_date", "first_air_date", "last_air_date", "genres", "certification"])
        if all(col in columns for col in ["episode_title", "total_episodes"]):
            extra_columns.extend(["episode_title", "total_episodes"])
        
        all_columns = base_columns + extra_columns
        
        # Build WHERE clause dynamically based on searchable columns
        searchable_columns = ["file_path", "destination_path", "tmdb_id", "proper_name", "imdb_id", "language", "quality", "tvdb_id", "league_id", "sportsdb_event_id"]
        if "base_path" in columns:
            searchable_columns.append("base_path")
        if "episode_title" in columns:
            searchable_columns.append("episode_title")

        searchable_columns = [col for col in searchable_columns if col in columns]
        
        where_clause = " OR ".join([f"{col} LIKE ?" for col in searchable_columns])
        search_params = [search_pattern] * len(searchable_columns)
        
        query = f"SELECT {', '.join(all_columns)} FROM processed_files WHERE {where_clause}"
        cursor.execute(query, search_params)

        return cursor.fetchall()
    except (sqlite3.Error, DatabaseError):
        return []

@throttle
@retry_on_db_lock
@with_connection(main_pool)
def get_skip_reason(conn, source_path):
    source_path = normalize_file_path(source_path)
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT reason FROM processed_files WHERE file_path = ?", (source_path,))
        result = cursor.fetchone()
        return result[0] if result else None
    except (sqlite3.Error, DatabaseError) as e:
        log_message(f"Error in get_skip_reason: {e}", level="ERROR")
        conn.rollback()
        return None

@throttle
@retry_on_db_lock
@with_connection(main_pool)
def remove_processed_file(conn, source_path):
    """Remove a processed file entry from the database."""
    source_path = normalize_file_path(source_path)
    try:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM processed_files WHERE file_path = ?", (source_path,))
        conn.commit()
        if cursor.rowcount > 0:
            log_message(f"Removed existing database entry for: {source_path}", level="INFO")
        return cursor.rowcount > 0
    except (sqlite3.Error, DatabaseError) as e:
        log_message(f"Error in remove_processed_file: {e}", level="ERROR")
        conn.rollback()
        return False

@throttle
@retry_on_db_lock
@with_connection(main_pool)
def optimize_database(conn):
    """Optimize database indexes and analyze tables."""
    try:
        cursor = conn.cursor()
        cursor.execute("REINDEX")
        cursor.execute("ANALYZE")
        cursor.execute("PRAGMA optimize")
        log_message("Database optimization completed successfully.", level="INFO")
        return True
    except (sqlite3.Error, DatabaseError) as e:
        log_message(f"Error optimizing database: {e}", level="ERROR")
        return False

@throttle
@retry_on_db_lock
@with_connection(main_pool)
def update_database_to_new_format(conn):
    """
    Update database entries by fetching missing metadata from TMDB API.
    First ensures schema is up to date, then populates missing metadata fields.
    """
    try:

        cursor = conn.cursor()
        log_message("Starting database update with TMDB metadata fetch...", level="INFO")
        
        # Get TMDB API key
        from MediaHub.api.api_key_manager import get_api_key
        api_key = get_api_key()
        
        if not api_key:
            log_message("No TMDB API key found. Cannot update metadata.", level="ERROR")
            return False

        cursor.execute("PRAGMA table_info(processed_files)")
        current_columns = [col[1] for col in cursor.fetchall()]
        log_message(f"Current schema has {len(current_columns)} columns", level="INFO")

        new_schema_columns = [
            "file_path TEXT PRIMARY KEY",
            "destination_path TEXT",
            "base_path TEXT",
            "tmdb_id TEXT",
            "season_number TEXT",
            "reason TEXT",
            "media_type TEXT",
            "proper_name TEXT",
            "year TEXT",
            "episode_number TEXT",
            "imdb_id TEXT",
            "is_anime_genre INTEGER",
            "file_size INTEGER",
            "error_message TEXT",
            "processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP",
            "language TEXT",
            "quality TEXT",
            "tvdb_id TEXT",
            "league_id TEXT",
            "sportsdb_event_id TEXT",
            "sport_name TEXT",
            "sport_round INTEGER",
            "sport_location TEXT",
            "sport_session TEXT",
            "sport_venue TEXT",
            "sport_city TEXT",
            "sport_country TEXT",
            "sport_time TEXT",
            "sport_date TEXT",
            "original_language TEXT",
            "overview TEXT",
            "runtime INTEGER",
            "original_title TEXT",
            "status TEXT",
            "release_date TEXT",
            "first_air_date TEXT",
            "last_air_date TEXT",
            "genres TEXT",
            "certification TEXT",
            "episode_title TEXT",
            "total_episodes INTEGER"
        ]
        
        expected_columns = [col.split()[0] for col in new_schema_columns]
        missing_columns = [col for col in expected_columns if col not in current_columns]
        
        # Step 3: Add missing columns to schema if needed
        if missing_columns:
            log_message(f"Adding {len(missing_columns)} missing columns to schema...", level="INFO")
            
            for col_definition in new_schema_columns:
                col_name = col_definition.split()[0]
                if col_name in missing_columns:
                    col_type = col_definition.split()[1]
                    try:
                        cursor.execute(f"ALTER TABLE processed_files ADD COLUMN {col_name} {col_type}")
                        log_message(f"Added column: {col_name} {col_type}", level="DEBUG")
                    except sqlite3.OperationalError as e:
                        if "duplicate column name" not in str(e).lower():
                            log_message(f"Warning: Could not add {col_name}: {e}", level="WARNING")
            
            conn.commit()
            log_message("Schema update completed!", level="INFO")

        log_message("Fetching all entries for metadata updates...", level="INFO")

        try:
            cursor.execute("UPDATE processed_files SET media_type = 'tv' WHERE LOWER(media_type) = 'anime'")
            conn.commit()
        except Exception as e:
            log_message(f"Failed to normalize legacy media_type values: {e}", level="WARNING")

        # Find ALL entries in the database for comprehensive update
        cursor.execute("""
            SELECT file_path, destination_path, tmdb_id, season_number, media_type, episode_number, sport_name
            FROM processed_files 
            ORDER BY file_path
        """)
        
        entries_to_update = cursor.fetchall()
        total_entries = len(entries_to_update)
        
        if total_entries == 0:
            log_message("No entries found in database for update", level="INFO")
            return True
        
        log_message(f"Found {total_entries} entries for metadata update", level="INFO")

        batch_size = get_db_batch_size()
        max_workers = min(get_db_max_workers(), 20)
        updated_count = 0
        failed_count = 0
        
        # Process entries in batches
        for batch_start in range(0, total_entries, batch_size):
            batch_end = min(batch_start + batch_size, total_entries)
            batch = entries_to_update[batch_start:batch_end]
            batch_number = (batch_start // batch_size) + 1
            total_batches = (total_entries + batch_size - 1) // batch_size

            log_message(f"Processing batch {batch_number}/{total_batches} ({len(batch)} entries)", level="INFO")
            batch_updates = []
            with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
                future_to_entry = {
                    executor.submit(_process_single_entry, entry, api_key): entry 
                    for entry in batch
                }

                # Collect results
                for future in concurrent.futures.as_completed(future_to_entry):
                    entry = future_to_entry[future]
                    try:
                        result = future.result()
                        if result:
                            batch_updates.append(result)
                    except Exception as e:
                        failed_count += 1
                        file_path = entry[0] if entry else "Unknown"
                        log_message(f"Error processing entry {file_path}: {e}", level="ERROR")

            try:
                updated_in_batch = 0
                for update_data in batch_updates:
                    file_path = update_data['file_path']
                    updates = update_data['updates']

                    if updates:
                        set_clauses = [f"{key} = ?" for key in updates.keys()]
                        values = list(updates.values()) + [file_path]

                        cursor.execute(f"""
                            UPDATE processed_files
                            SET {', '.join(set_clauses)}
                            WHERE file_path = ?
                        """, values)

                        updated_in_batch += 1
                        if updated_in_batch <= 3:
                            log_message(f"Updated metadata for: {updates.get('proper_name', file_path)}", level="DEBUG")

                conn.commit()
                updated_count += updated_in_batch
                log_message(f"Batch {batch_number} completed: {updated_in_batch} entries updated", level="INFO")

            except Exception as e:
                conn.rollback()
                failed_count += len(batch)
                log_message(f"Error applying batch {batch_number} updates: {e}", level="ERROR")

            # Progress reporting
            processed_so_far = min(batch_end, total_entries)
            log_message(f"Progress: {processed_so_far}/{total_entries} entries processed ({(processed_so_far/total_entries)*100:.1f}%)", level="INFO")
            time.sleep(0.1)

        log_message("Creating database indexes...", level="INFO")
        indexes = [
            "CREATE INDEX IF NOT EXISTS idx_file_path ON processed_files(file_path)",
            "CREATE INDEX IF NOT EXISTS idx_destination_path ON processed_files(destination_path)",
            "CREATE INDEX IF NOT EXISTS idx_tmdb_id ON processed_files(tmdb_id)",
            "CREATE INDEX IF NOT EXISTS idx_media_type ON processed_files(media_type)"
        ]

        for index_sql in indexes:
            try:
                cursor.execute(index_sql)
            except sqlite3.OperationalError:
                pass

        conn.commit()

        log_message(f"Database update completed!", level="INFO")
        log_message(f"Total entries processed: {total_entries}", level="INFO")
        log_message(f"Successfully updated: {updated_count}", level="INFO")
        log_message(f"Failed updates: {failed_count}", level="INFO")
        log_message(f"Success rate: {(updated_count/total_entries)*100:.1f}%" if total_entries > 0 else "Success rate: 100%", level="INFO")

        return True

    except Exception as e:
        log_message(f"Error during database update: {e}", level="ERROR")
        conn.rollback()
        return False

def _process_single_entry(entry, api_key):
    """
    Process a single database entry to fetch and prepare metadata updates.
    This function is designed to be run in parallel threads.
    """
    try:
        file_path, dest_path, tmdb_id, season_number, media_type, episode_number, sport_name = entry

        if media_type and media_type.lower() == 'sports':
            updates = {}

            if file_path and os.path.exists(file_path):
                try:
                    file_size = os.path.getsize(file_path)
                    updates['file_size'] = file_size
                except (OSError, IOError):
                    pass

            if dest_path:
                base_path = extract_base_path_from_destination_path(dest_path, None, media_type, sport_name)
                if base_path:
                    updates['base_path'] = base_path

            return {
                'file_path': file_path,
                'updates': updates
            }

        is_tv_show = False
        if media_type:
            is_tv_show = media_type.lower() in ['tv', 'tv show', 'anime']
        elif dest_path:
            dest_lower = dest_path.lower()
            is_tv_show = 'tv' in dest_lower or 'show' in dest_lower or 'anime' in dest_lower
        elif season_number:
            is_tv_show = True

        # Fetch metadata from TMDB
        metadata = None
        if tmdb_id and tmdb_id != '':
            try:
                if is_tv_show:
                    url = f"https://api.themoviedb.org/3/tv/{tmdb_id}?api_key={api_key}&language=en-US&append_to_response=content_ratings"
                else:
                    url = f"https://api.themoviedb.org/3/movie/{tmdb_id}?api_key={api_key}&language=en-US&append_to_response=release_dates"
                
                response = requests.get(url, timeout=10)
                if response.status_code == 200:
                    metadata = response.json()
                else:
                    log_message(f"TMDB API returned status {response.status_code} for ID {tmdb_id}", level="WARNING")
            except requests.RequestException as e:
                log_message(f"Request failed for TMDB ID {tmdb_id}: {e}", level="WARNING")

        # Prepare update values
        updates = {}

        # Extract metadata fields
        if metadata:
            if metadata.get('title') or metadata.get('name'):
                updates['proper_name'] = metadata.get('title') or metadata.get('name')

            if metadata.get('release_date'):
                release_year = metadata['release_date'][:4] if len(metadata['release_date']) >= 4 else None
                if release_year:
                    updates['year'] = release_year
                    updates['release_date'] = metadata['release_date']
            elif metadata.get('first_air_date'):
                release_year = metadata['first_air_date'][:4] if len(metadata['first_air_date']) >= 4 else None
                if release_year:
                    updates['year'] = release_year
                    updates['first_air_date'] = metadata['first_air_date']

            # Handle last_air_date for TV shows
            if metadata.get('last_air_date'):
                updates['last_air_date'] = metadata['last_air_date']

            if metadata.get('imdb_id'):
                updates['imdb_id'] = metadata['imdb_id']

            if metadata.get('overview'):
                updates['overview'] = metadata['overview']

            if metadata.get('original_language'):
                updates['original_language'] = metadata['original_language']

            if metadata.get('original_title'):
                updates['original_title'] = metadata['original_title']
            elif metadata.get('original_name'):
                updates['original_title'] = metadata['original_name']

            if metadata.get('status'):
                updates['status'] = metadata['status']

            if metadata.get('runtime'):
                updates['runtime'] = metadata['runtime']
            elif metadata.get('episode_run_time') and metadata['episode_run_time']:
                updates['runtime'] = metadata['episode_run_time'][0]

            if metadata.get('genres'):
                genre_names = [g['name'] for g in metadata['genres'] if isinstance(g, dict) and 'name' in g]
                if genre_names:
                    updates['genres'] = ', '.join(genre_names)

            # Set media type if not already set
            if not media_type:
                updates['media_type'] = 'TV Show' if is_tv_show else 'Movie'

            # Check if it's anime based on genres
            if metadata.get('genres'):
                genre_names = [g['name'].lower() for g in metadata['genres'] if isinstance(g, dict) and 'name' in g]
                if 'animation' in genre_names:
                    # Check origin country for anime detection
                    if metadata.get('origin_country') and 'JP' in metadata.get('origin_country'):
                        updates['is_anime_genre'] = 1

            # For TV shows, get total episodes and certification
            if is_tv_show:
                if metadata.get('number_of_episodes'):
                    updates['total_episodes'] = metadata['number_of_episodes']

                # Get content ratings for certification
                content_ratings = metadata.get('content_ratings', {}).get('results', [])
                for rating in content_ratings:
                    if rating.get('iso_3166_1') == 'US':
                        updates['certification'] = rating.get('rating', '')
                        break
                if 'certification' not in updates and content_ratings:
                    updates['certification'] = content_ratings[0].get('rating', '')

                # For TV episodes, get episode title
                if season_number and episode_number and tmdb_id:
                    try:
                        season_num = int(season_number) if season_number and season_number.isdigit() else None
                        episode_num = int(episode_number) if episode_number and episode_number.isdigit() else None

                        if season_num is not None and episode_num is not None:
                            total_episodes_count = metadata.get('number_of_episodes', 0)

                            # Get episode name from TMDB
                            formatted_name, mapped_season, mapped_episode, episode_title, total_episodes = get_episode_name(
                                int(tmdb_id), season_num, episode_num, max_length=60, force_anidb_style=False,
                                total_episodes=total_episodes_count
                            )

                            if episode_title:
                                updates['episode_title'] = episode_title

                            # Use total episodes from API if available and different
                            if total_episodes and total_episodes != total_episodes_count:
                                updates['total_episodes'] = total_episodes

                    except ValueError as e:
                        log_message(f"Could not parse season or episode number for {file_path}: {e}", level="WARNING")
                    except Exception as e:
                        log_message(f"Error fetching episode title for {file_path}: {e}", level="WARNING")

            elif not is_tv_show:
                release_dates = metadata.get('release_dates', {}).get('results', [])
                for release in release_dates:
                    if release.get('iso_3166_1') == 'US':
                        for cert in release.get('release_dates', []):
                            if cert.get('certification'):
                                updates['certification'] = cert.get('certification', '')
                                break
                        if 'certification' in updates:
                            break

                if 'certification' not in updates and release_dates:
                    for release in release_dates:
                        for cert in release.get('release_dates', []):
                            if cert.get('certification'):
                                updates['certification'] = cert.get('certification', '')
                                break
                        if 'certification' in updates:
                            break

        # Add file size and base_path if missing
        if file_path and os.path.exists(file_path):
            try:
                file_size = os.path.getsize(file_path)
                updates['file_size'] = file_size
            except (OSError, IOError):
                pass

        if dest_path:
            base_path = extract_base_path_from_destination_path(dest_path, updates.get('proper_name'), media_type, sport_name)
            if base_path:
                updates['base_path'] = base_path

        return {
            'file_path': file_path,
            'updates': updates
        }

    except Exception as e:
        log_message(f"Error processing single entry: {e}", level="ERROR")
        return None