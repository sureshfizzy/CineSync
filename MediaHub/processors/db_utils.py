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
from dotenv import load_dotenv, find_dotenv
from MediaHub.utils.logging_utils import log_message
from MediaHub.config.config import (
    get_db_throttle_rate, get_db_max_retries, get_db_retry_delay,
    get_db_batch_size, get_db_max_workers, get_db_max_records,
    get_db_connection_timeout, get_db_cache_size,
    get_cinesync_ip, get_cinesync_api_port
)
from MediaHub.api.tmdb_api_helpers import get_movie_data, get_show_data

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
dotenv_path = find_dotenv('../.env')
if not dotenv_path:
    print("Warning: .env file not found. Using environment variables only.")
else:
    load_dotenv(dotenv_path)

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
            "sport_date": "TEXT"
        }

        # Add missing columns
        for column_name, column_type in required_columns.items():
            if column_name not in columns:
                cursor.execute(f"ALTER TABLE processed_files ADD COLUMN {column_name} {column_type}")

                # Special handling for processed_at column
                if column_name == "processed_at":
                    cursor.execute("UPDATE processed_files SET processed_at = datetime('now') WHERE processed_at IS NULL")

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
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_sport_date ON processed_files(sport_date)")

        conn.commit()

        # Verify all required columns exist before marking as initialized
        cursor.execute("PRAGMA table_info(processed_files)")
        final_columns = [column[1] for column in cursor.fetchall()]

        expected_columns = {"file_path", "destination_path", "base_path", "tmdb_id", "season_number",
                          "reason", "file_size", "error_message", "processed_at", "media_type",
                          "proper_name", "year", "episode_number", "imdb_id", "is_anime_genre",
                          "language", "quality", "tvdb_id", "league_id", "sportsdb_event_id", "sport_name",
                          "sport_round", "sport_location", "sport_session", "sport_venue", "sport_date"}

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

def extract_base_path_from_destination_path(dest_path, proper_name=None):
    """Extract base path - everything between DESTINATION_DIR and the title folder

    Args:
        dest_path: Full destination path
        proper_name: The proper name from database (e.g., "Movie Title (2023)")
                    If provided, will be used to identify the title folder precisely
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
def save_processed_file(conn, source_path, dest_path=None, tmdb_id=None, season_number=None, reason=None, file_size=None, error_message=None, media_type=None, proper_name=None, year=None, episode_number=None, imdb_id=None, is_anime_genre=None, language=None, quality=None, tvdb_id=None, league_id=None, sportsdb_event_id=None, sport_name=None, sport_round=None, sport_location=None, sport_session=None, sport_venue=None, sport_date=None):
    source_path = normalize_file_path(source_path)
    if dest_path:
        dest_path = normalize_file_path(dest_path)

    # Extract base path from destination path using proper_name if available
    base_path = extract_base_path_from_destination_path(dest_path, proper_name)

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
        has_processed_at = "processed_at" in columns
        has_error_message = "error_message" in columns
        has_base_path = "base_path" in columns
        has_new_columns = all(col in columns for col in ["media_type", "proper_name", "year", "episode_number", "imdb_id", "is_anime_genre"])
        has_language_quality = all(col in columns for col in ["language", "quality"])
        has_tvdb_id = "tvdb_id" in columns
        has_league_id = "league_id" in columns
        has_sportsdb_event_id = "sportsdb_event_id" in columns
        has_sports_columns = all(col in columns for col in ["sport_name", "sport_round", "sport_location", "sport_session", "sport_venue", "sport_date"])

        if has_processed_at and has_error_message and has_new_columns and has_base_path and has_language_quality and has_tvdb_id and has_league_id and has_sportsdb_event_id and has_sports_columns:
            cursor.execute("""
                INSERT OR REPLACE INTO processed_files (file_path, destination_path, base_path, tmdb_id, season_number, reason, file_size, error_message, processed_at, media_type, proper_name, year, episode_number, imdb_id, is_anime_genre, language, quality, tvdb_id, league_id, sportsdb_event_id, sport_name, sport_round, sport_location, sport_session, sport_venue, sport_date)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (source_path, dest_path, base_path, tmdb_id, season_number, reason, file_size, error_message, media_type, proper_name, year, episode_number, imdb_id, is_anime_genre, language, quality, tvdb_id, league_id, sportsdb_event_id, sport_name, sport_round, sport_location, sport_session, sport_venue, sport_date))
        elif has_processed_at and has_error_message and has_new_columns and has_base_path and has_language_quality and has_tvdb_id and has_sports_columns:
            cursor.execute("""
                INSERT OR REPLACE INTO processed_files (file_path, destination_path, base_path, tmdb_id, season_number, reason, file_size, error_message, processed_at, media_type, proper_name, year, episode_number, imdb_id, is_anime_genre, language, quality, tvdb_id, sport_name, sport_round, sport_location, sport_session, sport_venue, sport_date)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (source_path, dest_path, base_path, tmdb_id, season_number, reason, file_size, error_message, media_type, proper_name, year, episode_number, imdb_id, is_anime_genre, language, quality, tvdb_id, sport_name, sport_round, sport_location, sport_session, sport_venue, sport_date))
        elif has_processed_at and has_error_message and has_new_columns and has_base_path and has_language_quality and has_tvdb_id:
            cursor.execute("""
                INSERT OR REPLACE INTO processed_files (file_path, destination_path, base_path, tmdb_id, season_number, reason, file_size, error_message, processed_at, media_type, proper_name, year, episode_number, imdb_id, is_anime_genre, language, quality, tvdb_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (source_path, dest_path, base_path, tmdb_id, season_number, reason, file_size, error_message, media_type, proper_name, year, episode_number, imdb_id, is_anime_genre, language, quality, tvdb_id))
        elif has_processed_at and has_error_message and has_new_columns and has_base_path and has_language_quality:
            cursor.execute("""
                INSERT OR REPLACE INTO processed_files (file_path, destination_path, base_path, tmdb_id, season_number, reason, file_size, error_message, processed_at, media_type, proper_name, year, episode_number, imdb_id, is_anime_genre, language, quality)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?)
            """, (source_path, dest_path, base_path, tmdb_id, season_number, reason, file_size, error_message, media_type, proper_name, year, episode_number, imdb_id, is_anime_genre, language, quality))
        elif has_processed_at and has_error_message and has_new_columns and has_base_path:
            cursor.execute("""
                INSERT OR REPLACE INTO processed_files (file_path, destination_path, base_path, tmdb_id, season_number, reason, file_size, error_message, processed_at, media_type, proper_name, year, episode_number, imdb_id, is_anime_genre)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, ?, ?, ?, ?, ?)
            """, (source_path, dest_path, base_path, tmdb_id, season_number, reason, file_size, error_message, media_type, proper_name, year, episode_number, imdb_id, is_anime_genre))
        elif has_processed_at and has_error_message and has_new_columns and has_language_quality:
            cursor.execute("""
                INSERT OR REPLACE INTO processed_files (file_path, destination_path, tmdb_id, season_number, reason, file_size, error_message, processed_at, media_type, proper_name, year, episode_number, imdb_id, is_anime_genre, language, quality)
                VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?)
            """, (source_path, dest_path, tmdb_id, season_number, reason, file_size, error_message, media_type, proper_name, year, episode_number, imdb_id, is_anime_genre, language, quality))
        elif has_processed_at and has_error_message and has_new_columns:
            cursor.execute("""
                INSERT OR REPLACE INTO processed_files (file_path, destination_path, tmdb_id, season_number, reason, file_size, error_message, processed_at, media_type, proper_name, year, episode_number, imdb_id, is_anime_genre)
                VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, ?, ?, ?, ?, ?)
            """, (source_path, dest_path, tmdb_id, season_number, reason, file_size, error_message, media_type, proper_name, year, episode_number, imdb_id, is_anime_genre))
        elif has_error_message and has_new_columns and has_base_path and has_language_quality:
            cursor.execute("""
                INSERT OR REPLACE INTO processed_files (file_path, destination_path, base_path, tmdb_id, season_number, reason, file_size, error_message, media_type, proper_name, year, episode_number, imdb_id, is_anime_genre, language, quality)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (source_path, dest_path, base_path, tmdb_id, season_number, reason, file_size, error_message, media_type, proper_name, year, episode_number, imdb_id, is_anime_genre, language, quality))
        elif has_error_message and has_new_columns and has_base_path:
            cursor.execute("""
                INSERT OR REPLACE INTO processed_files (file_path, destination_path, base_path, tmdb_id, season_number, reason, file_size, error_message, media_type, proper_name, year, episode_number, imdb_id, is_anime_genre)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (source_path, dest_path, base_path, tmdb_id, season_number, reason, file_size, error_message, media_type, proper_name, year, episode_number, imdb_id, is_anime_genre))
        elif has_error_message and has_new_columns and has_language_quality:
            cursor.execute("""
                INSERT OR REPLACE INTO processed_files (file_path, destination_path, tmdb_id, season_number, reason, file_size, error_message, media_type, proper_name, year, episode_number, imdb_id, is_anime_genre, language, quality)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (source_path, dest_path, tmdb_id, season_number, reason, file_size, error_message, media_type, proper_name, year, episode_number, imdb_id, is_anime_genre, language, quality))
        elif has_error_message and has_new_columns:
            cursor.execute("""
                INSERT OR REPLACE INTO processed_files (file_path, destination_path, tmdb_id, season_number, reason, file_size, error_message, media_type, proper_name, year, episode_number, imdb_id, is_anime_genre)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (source_path, dest_path, tmdb_id, season_number, reason, file_size, error_message, media_type, proper_name, year, episode_number, imdb_id, is_anime_genre))
        elif has_new_columns and has_base_path and has_language_quality:
            cursor.execute("""
                INSERT OR REPLACE INTO processed_files (file_path, destination_path, base_path, tmdb_id, season_number, reason, file_size, media_type, proper_name, year, episode_number, imdb_id, is_anime_genre, language, quality)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (source_path, dest_path, base_path, tmdb_id, season_number, reason, file_size, media_type, proper_name, year, episode_number, imdb_id, is_anime_genre, language, quality))
        elif has_new_columns and has_base_path:
            cursor.execute("""
                INSERT OR REPLACE INTO processed_files (file_path, destination_path, base_path, tmdb_id, season_number, reason, file_size, media_type, proper_name, year, episode_number, imdb_id, is_anime_genre)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (source_path, dest_path, base_path, tmdb_id, season_number, reason, file_size, media_type, proper_name, year, episode_number, imdb_id, is_anime_genre))
        elif has_new_columns and has_language_quality:
            cursor.execute("""
                INSERT OR REPLACE INTO processed_files (file_path, destination_path, tmdb_id, season_number, reason, file_size, media_type, proper_name, year, episode_number, imdb_id, is_anime_genre, language, quality)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (source_path, dest_path, tmdb_id, season_number, reason, file_size, media_type, proper_name, year, episode_number, imdb_id, is_anime_genre, language, quality))
        elif has_new_columns:
            cursor.execute("""
                INSERT OR REPLACE INTO processed_files (file_path, destination_path, tmdb_id, season_number, reason, file_size, media_type, proper_name, year, episode_number, imdb_id, is_anime_genre)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (source_path, dest_path, tmdb_id, season_number, reason, file_size, media_type, proper_name, year, episode_number, imdb_id, is_anime_genre))
        elif has_processed_at and has_error_message:
            cursor.execute("""
                INSERT OR REPLACE INTO processed_files (file_path, destination_path, tmdb_id, season_number, reason, file_size, error_message, processed_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
            """, (source_path, dest_path, tmdb_id, season_number, reason, file_size, error_message))
        elif has_error_message:
            cursor.execute("""
                INSERT OR REPLACE INTO processed_files (file_path, destination_path, tmdb_id, season_number, reason, file_size, error_message)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (source_path, dest_path, tmdb_id, season_number, reason, file_size, error_message))
        else:
            cursor.execute("""
                INSERT OR REPLACE INTO processed_files (file_path, destination_path, tmdb_id, season_number, reason, file_size)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (source_path, dest_path, tmdb_id, season_number, reason, file_size))

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

def track_file_deletion(source_path, dest_path, tmdb_id=None, season_number=None, reason=""):
    """Track file deletion in WebDavHub with availability checking"""
    try:
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

        # Check which columns exist
        cursor.execute("PRAGMA table_info(processed_files)")
        columns = [column[1] for column in cursor.fetchall()]
        has_new_columns = all(col in columns for col in ["media_type", "proper_name", "year", "episode_number", "imdb_id", "is_anime_genre"])
        has_base_path = "base_path" in columns
        has_language_quality = all(col in columns for col in ["language", "quality"])
        has_tvdb_id = "tvdb_id" in columns
        has_league_id = "league_id" in columns
        has_sportsdb_event_id = "sportsdb_event_id" in columns
        has_sports_columns = all(col in columns for col in ["sport_name", "sport_round", "sport_location", "sport_session", "sport_venue", "sport_date"])

        if has_new_columns and has_base_path and has_language_quality and has_tvdb_id and has_league_id and has_sportsdb_event_id and has_sports_columns:
            cursor.execute("""
                SELECT file_path, destination_path, base_path, tmdb_id, season_number, reason, file_size,
                       media_type, proper_name, year, episode_number, imdb_id,
                       is_anime_genre, error_message, processed_at, language, quality, tvdb_id, league_id, sportsdb_event_id
                FROM processed_files
                WHERE file_path LIKE ?
                OR destination_path LIKE ?
                OR base_path LIKE ?
                OR tmdb_id LIKE ?
                OR proper_name LIKE ?
                OR imdb_id LIKE ?
                OR language LIKE ?
                OR quality LIKE ?
                OR tvdb_id LIKE ?
                OR league_id LIKE ?
                OR sportsdb_event_id LIKE ?
            """, (search_pattern, search_pattern, search_pattern, search_pattern, search_pattern, search_pattern, search_pattern, search_pattern, search_pattern, search_pattern, search_pattern))
        elif has_new_columns and has_base_path and has_language_quality and has_tvdb_id:
            cursor.execute("""
                SELECT file_path, destination_path, base_path, tmdb_id, season_number, reason, file_size,
                       media_type, proper_name, year, episode_number, imdb_id,
                       is_anime_genre, error_message, processed_at, language, quality, tvdb_id
                FROM processed_files
                WHERE file_path LIKE ?
                OR destination_path LIKE ?
                OR base_path LIKE ?
                OR tmdb_id LIKE ?
                OR proper_name LIKE ?
                OR imdb_id LIKE ?
                OR language LIKE ?
                OR quality LIKE ?
                OR tvdb_id LIKE ?
            """, (search_pattern, search_pattern, search_pattern, search_pattern, search_pattern, search_pattern, search_pattern, search_pattern, search_pattern))
        elif has_new_columns and has_base_path and has_language_quality:
            cursor.execute("""
                SELECT file_path, destination_path, base_path, tmdb_id, season_number, reason, file_size,
                       media_type, proper_name, year, episode_number, imdb_id,
                       is_anime_genre, error_message, processed_at, language, quality
                FROM processed_files
                WHERE file_path LIKE ?
                OR destination_path LIKE ?
                OR base_path LIKE ?
                OR tmdb_id LIKE ?
                OR proper_name LIKE ?
                OR imdb_id LIKE ?
                OR language LIKE ?
                OR quality LIKE ?
            """, (search_pattern, search_pattern, search_pattern, search_pattern, search_pattern, search_pattern, search_pattern, search_pattern))
        elif has_new_columns and has_base_path:
            cursor.execute("""
                SELECT file_path, destination_path, base_path, tmdb_id, season_number, reason, file_size,
                       media_type, proper_name, year, episode_number, imdb_id,
                       is_anime_genre, error_message, processed_at
                FROM processed_files
                WHERE file_path LIKE ?
                OR destination_path LIKE ?
                OR base_path LIKE ?
                OR tmdb_id LIKE ?
                OR proper_name LIKE ?
                OR imdb_id LIKE ?
            """, (search_pattern, search_pattern, search_pattern, search_pattern, search_pattern, search_pattern))
        elif has_new_columns and has_language_quality:
            cursor.execute("""
                SELECT file_path, destination_path, tmdb_id, season_number, reason, file_size,
                       media_type, proper_name, year, episode_number, imdb_id,
                       is_anime_genre, error_message, processed_at, language, quality
                FROM processed_files
                WHERE file_path LIKE ?
                OR destination_path LIKE ?
                OR tmdb_id LIKE ?
                OR proper_name LIKE ?
                OR imdb_id LIKE ?
                OR language LIKE ?
                OR quality LIKE ?
            """, (search_pattern, search_pattern, search_pattern, search_pattern, search_pattern, search_pattern, search_pattern))
        elif has_new_columns:
            cursor.execute("""
                SELECT file_path, destination_path, tmdb_id, season_number, reason, file_size,
                       media_type, proper_name, year, episode_number, imdb_id,
                       is_anime_genre, error_message, processed_at
                FROM processed_files
                WHERE file_path LIKE ?
                OR destination_path LIKE ?
                OR tmdb_id LIKE ?
                OR proper_name LIKE ?
                OR imdb_id LIKE ?
            """, (search_pattern, search_pattern, search_pattern, search_pattern, search_pattern))
        else:
            cursor.execute("""
                SELECT file_path, destination_path, tmdb_id, season_number, reason, file_size
                FROM processed_files
                WHERE file_path LIKE ?
                OR destination_path LIKE ?
                OR tmdb_id LIKE ?
            """, (search_pattern, search_pattern, search_pattern))

        results = cursor.fetchall()
        if results:
            log_message("-" * 50, level="INFO")
            log_message(f"Found {len(results)} matches for pattern '{pattern}':", level="INFO")
            log_message("-" * 50, level="INFO")
            for row in results:


                if has_new_columns and has_base_path and has_language_quality and has_tvdb_id and has_league_id and has_sportsdb_event_id and has_sports_columns:
                    (file_path, dest_path, base_path, tmdb_id, season_number, reason, file_size,
                     media_type, proper_name, year, episode_number, imdb_id,
                     is_anime_genre, error_message, processed_at, language, quality, tvdb_id, league_id, sportsdb_event_id) = row
                elif has_new_columns and has_base_path and has_language_quality and has_tvdb_id:
                    (file_path, dest_path, base_path, tmdb_id, season_number, reason, file_size,
                     media_type, proper_name, year, episode_number, imdb_id,
                     is_anime_genre, error_message, processed_at, language, quality, tvdb_id) = row
                    league_id = sportsdb_event_id = None
                elif has_new_columns and has_base_path and has_language_quality:
                    (file_path, dest_path, base_path, tmdb_id, season_number, reason, file_size,
                     media_type, proper_name, year, episode_number, imdb_id,
                     is_anime_genre, error_message, processed_at, language, quality) = row
                    tvdb_id = None
                elif has_new_columns and has_base_path:
                    (file_path, dest_path, base_path, tmdb_id, season_number, reason, file_size,
                     media_type, proper_name, year, episode_number, imdb_id,
                     is_anime_genre, error_message, processed_at) = row
                    language = quality = tvdb_id = None

                # Display basic information for all formats
                log_message(f"Source: {file_path}", level="INFO")
                log_message(f"Destination: {dest_path}", level="INFO")
                if file_size:
                    log_message(f"File Size: {format_file_size(file_size)}", level="INFO")
                if tmdb_id:
                    # Display appropriate ID label based on media type
                    if 'media_type' in locals() and media_type == 'Sports':
                        log_message(f"League ID: {tmdb_id}", level="INFO")
                    else:
                        log_message(f"TMDB ID: {tmdb_id}", level="INFO")

                # Display additional information if available
                if has_new_columns:
                    if imdb_id:
                        log_message(f"IMDB ID: {imdb_id}", level="INFO")
                    if tvdb_id:
                        log_message(f"TVDB ID: {tvdb_id}", level="INFO")
                    # Display SportsDB Event ID for sports content
                    if 'sportsdb_event_id' in locals() and sportsdb_event_id:
                        log_message(f"SportsDB Event ID: {sportsdb_event_id}", level="INFO")
                    if media_type:
                        log_message(f"Media Type: {media_type}", level="INFO")
                    if proper_name:
                        log_message(f"Title: {proper_name}", level="INFO")
                    if year:
                        log_message(f"Year: {year}", level="INFO")
                    if base_path:
                        log_message(f"Base Path: {base_path}", level="INFO")
                    if season_number is not None:
                        log_message(f"Season Number: {season_number}", level="INFO")
                    if episode_number is not None:
                        log_message(f"Episode Number: {episode_number}", level="INFO")
                    if is_anime_genre is not None:
                        log_message(f"Anime Genre: {'Yes' if is_anime_genre else 'No'}", level="INFO")
                    if language:
                        log_message(f"Language: {language}", level="INFO")
                    if quality:
                        log_message(f"Quality: {quality}", level="INFO")
                elif has_new_columns and has_language_quality:
                    (file_path, dest_path, tmdb_id, season_number, reason, file_size,
                     media_type, proper_name, year, episode_number, imdb_id,
                     is_anime_genre, error_message, processed_at, language, quality) = row
                    base_path = tvdb_id = None
                elif has_new_columns:
                    (file_path, dest_path, tmdb_id, season_number, reason, file_size,
                     media_type, proper_name, year, episode_number, imdb_id,
                     is_anime_genre, error_message, processed_at) = row
                    base_path = language = quality = tvdb_id = None

                    log_message(f"TMDB ID: {tmdb_id}", level="INFO")
                    if imdb_id:
                        log_message(f"IMDB ID: {imdb_id}", level="INFO")
                    if tvdb_id:
                        log_message(f"TVDB ID: {tvdb_id}", level="INFO")
                    if media_type:
                        log_message(f"Media Type: {media_type}", level="INFO")
                    if proper_name:
                        log_message(f"Title: {proper_name}", level="INFO")
                    if year:
                        log_message(f"Year: {year}", level="INFO")
                    if season_number is not None:
                        log_message(f"Season Number: {season_number}", level="INFO")
                    if episode_number is not None:
                        log_message(f"Episode Number: {episode_number}", level="INFO")
                    if is_anime_genre is not None:
                        log_message(f"Anime Genre: {'Yes' if is_anime_genre else 'No'}", level="INFO")
                    if language:
                        log_message(f"Language: {language}", level="INFO")
                    if quality:
                        log_message(f"Quality: {quality}", level="INFO")
                else:
                    file_path, dest_path, tmdb_id, season_number, reason, file_size = row
                    base_path = media_type = proper_name = year = episode_number = imdb_id = None
                    is_anime_genre = error_message = processed_at = language = quality = None
                    if season_number is not None:
                        log_message(f"Season Number: {season_number}", level="INFO")

                if reason:
                    log_message(f"Skip Reason: {reason}", level="INFO")
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

        # Check which columns exist
        cursor.execute("PRAGMA table_info(processed_files)")
        columns = [column[1] for column in cursor.fetchall()]
        has_new_columns = all(col in columns for col in ["media_type", "proper_name", "year", "episode_number", "imdb_id", "is_anime_genre"])
        has_base_path = "base_path" in columns
        has_language_quality = all(col in columns for col in ["language", "quality"])
        has_tvdb_id = "tvdb_id" in columns

        if has_new_columns and has_base_path and has_language_quality and has_tvdb_id:
            cursor.execute("""
                SELECT file_path, destination_path, base_path, tmdb_id, season_number, reason, file_size,
                       media_type, proper_name, year, episode_number, imdb_id,
                       is_anime_genre, error_message, processed_at, language, quality, tvdb_id
                FROM processed_files
                WHERE file_path LIKE ?
                OR destination_path LIKE ?
                OR base_path LIKE ?
                OR tmdb_id LIKE ?
                OR proper_name LIKE ?
                OR imdb_id LIKE ?
                OR language LIKE ?
                OR quality LIKE ?
                OR tvdb_id LIKE ?
            """, (search_pattern, search_pattern, search_pattern, search_pattern, search_pattern, search_pattern, search_pattern, search_pattern, search_pattern))
        elif has_new_columns and has_base_path and has_language_quality:
            cursor.execute("""
                SELECT file_path, destination_path, base_path, tmdb_id, season_number, reason, file_size,
                       media_type, proper_name, year, episode_number, imdb_id,
                       is_anime_genre, error_message, processed_at, language, quality
                FROM processed_files
                WHERE file_path LIKE ?
                OR destination_path LIKE ?
                OR base_path LIKE ?
                OR tmdb_id LIKE ?
                OR proper_name LIKE ?
                OR imdb_id LIKE ?
                OR language LIKE ?
                OR quality LIKE ?
            """, (search_pattern, search_pattern, search_pattern, search_pattern, search_pattern, search_pattern, search_pattern, search_pattern))
        elif has_new_columns and has_base_path:
            cursor.execute("""
                SELECT file_path, destination_path, base_path, tmdb_id, season_number, reason, file_size,
                       media_type, proper_name, year, episode_number, imdb_id,
                       is_anime_genre, error_message, processed_at
                FROM processed_files
                WHERE file_path LIKE ?
                OR destination_path LIKE ?
                OR base_path LIKE ?
                OR tmdb_id LIKE ?
                OR proper_name LIKE ?
                OR imdb_id LIKE ?
            """, (search_pattern, search_pattern, search_pattern, search_pattern, search_pattern, search_pattern))
        elif has_new_columns and has_language_quality:
            cursor.execute("""
                SELECT file_path, destination_path, tmdb_id, season_number, reason, file_size,
                       media_type, proper_name, year, episode_number, imdb_id,
                       is_anime_genre, error_message, processed_at, language, quality
                FROM processed_files
                WHERE file_path LIKE ?
                OR destination_path LIKE ?
                OR tmdb_id LIKE ?
                OR proper_name LIKE ?
                OR imdb_id LIKE ?
                OR language LIKE ?
                OR quality LIKE ?
            """, (search_pattern, search_pattern, search_pattern, search_pattern, search_pattern, search_pattern, search_pattern))
        elif has_new_columns:
            cursor.execute("""
                SELECT file_path, destination_path, tmdb_id, season_number, reason, file_size,
                       media_type, proper_name, year, episode_number, imdb_id,
                       is_anime_genre, error_message, processed_at
                FROM processed_files
                WHERE file_path LIKE ?
                OR destination_path LIKE ?
                OR tmdb_id LIKE ?
                OR proper_name LIKE ?
                OR imdb_id LIKE ?
            """, (search_pattern, search_pattern, search_pattern, search_pattern, search_pattern))
        else:
            cursor.execute("""
                SELECT file_path, destination_path, tmdb_id, season_number, reason, file_size
                FROM processed_files
                WHERE file_path LIKE ?
                OR destination_path LIKE ?
                OR tmdb_id LIKE ?
            """, (search_pattern, search_pattern, search_pattern))

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
    """Update database entries using TMDB API calls with optimized parallel processing."""
    try:
        cursor = conn.cursor()

        # Check if new columns exist
        cursor.execute("PRAGMA table_info(processed_files)")
        columns = [column[1] for column in cursor.fetchall()]
        has_new_columns = all(col in columns for col in ["media_type", "proper_name", "year", "episode_number", "imdb_id", "is_anime_genre"])
        has_base_path = "base_path" in columns
        has_language_quality = all(col in columns for col in ["language", "quality"])
        has_tvdb_id = "tvdb_id" in columns

        if not has_new_columns or not has_base_path or not has_language_quality or not has_tvdb_id:
            log_message("Database schema is missing new columns. Creating them now...", level="INFO")

            # Add missing columns including reason column and tvdb_id
            missing_columns = {
                "reason": "TEXT",
                "base_path": "TEXT",
                "media_type": "TEXT",
                "proper_name": "TEXT",
                "year": "TEXT",
                "episode_number": "TEXT",
                "imdb_id": "TEXT",
                "is_anime_genre": "INTEGER",
                "file_size": "INTEGER",
                "error_message": "TEXT",
                "processed_at": "TIMESTAMP",
                "language": "TEXT",
                "quality": "TEXT",
                "tvdb_id": "TEXT"
            }

            for column_name, column_type in missing_columns.items():
                if column_name not in columns:
                    try:
                        cursor.execute(f"ALTER TABLE processed_files ADD COLUMN {column_name} {column_type}")
                        log_message(f"Added {column_name} column to processed_files table.", level="INFO")
                    except sqlite3.Error as e:
                        log_message(f"Error adding column {column_name}: {e}", level="ERROR")
                        return False

            # Create indexes for new columns
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_base_path ON processed_files(base_path)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_file_size ON processed_files(file_size)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_error_message ON processed_files(error_message)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_processed_at ON processed_files(processed_at)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_language ON processed_files(language)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_quality ON processed_files(quality)")

            conn.commit()
            log_message("Database schema updated successfully.", level="INFO")

        # Update base_path field for existing entries that have destination_path but no base_path
        cursor.execute("""
            SELECT file_path, destination_path
            FROM processed_files
            WHERE base_path IS NULL AND destination_path IS NOT NULL AND destination_path != ''
        """)

        entries_to_update_base_path = cursor.fetchall()
        updated_base_paths = 0

        for file_path, dest_path in entries_to_update_base_path:
            # Get proper_name for this entry to help with base_path extraction
            cursor.execute("SELECT proper_name FROM processed_files WHERE file_path = ?", (file_path,))
            result = cursor.fetchone()
            proper_name = result[0] if result and result[0] else None

            base_path = extract_base_path_from_destination_path(dest_path, proper_name)
            if base_path:
                cursor.execute("""
                    UPDATE processed_files
                    SET base_path = ?
                    WHERE file_path = ?
                """, (base_path, file_path))
                updated_base_paths += 1

        if updated_base_paths > 0:
            log_message(f"Updated base_path field for {updated_base_paths} existing entries.", level="INFO")

        conn.commit()

        # Check if reason column exists after adding missing columns
        cursor.execute("PRAGMA table_info(processed_files)")
        updated_columns = [column[1] for column in cursor.fetchall()]
        has_reason_column = "reason" in updated_columns

        # Find entries that need migration
        # Check for missing core fields OR missing external IDs
        if has_reason_column and has_tvdb_id:
            cursor.execute("""
                SELECT file_path, destination_path, tmdb_id, season_number
                FROM processed_files
                WHERE ((media_type IS NULL OR proper_name IS NULL OR year IS NULL)
                   OR (media_type = 'tv' AND tmdb_id IS NOT NULL AND (imdb_id IS NULL OR imdb_id = '') AND (tvdb_id IS NULL OR tvdb_id = '')))
                AND reason IS NULL
                AND file_path IS NOT NULL
            """)
        elif has_reason_column:
            cursor.execute("""
                SELECT file_path, destination_path, tmdb_id, season_number
                FROM processed_files
                WHERE (media_type IS NULL OR proper_name IS NULL OR year IS NULL)
                AND reason IS NULL
                AND file_path IS NOT NULL
            """)
        elif has_tvdb_id:
            cursor.execute("""
                SELECT file_path, destination_path, tmdb_id, season_number
                FROM processed_files
                WHERE ((media_type IS NULL OR proper_name IS NULL OR year IS NULL)
                   OR (media_type = 'tv' AND tmdb_id IS NOT NULL AND (imdb_id IS NULL OR imdb_id = '') AND (tvdb_id IS NULL OR tvdb_id = '')))
                AND file_path IS NOT NULL
            """)
        else:
            cursor.execute("""
                SELECT file_path, destination_path, tmdb_id, season_number
                FROM processed_files
                WHERE (media_type IS NULL OR proper_name IS NULL OR year IS NULL)
                AND file_path IS NOT NULL
            """)

        entries_to_migrate = cursor.fetchall()
        total_entries = len(entries_to_migrate)

        def cleanup_tmdb_files():
            """Helper function to clean up .tmdb files."""
            tmdb_files_removed = 0
            cursor.execute("""
                SELECT DISTINCT destination_path
                FROM processed_files
                WHERE destination_path IS NOT NULL
                AND destination_path != ''
            """)

            destination_paths = cursor.fetchall()
            processed_dirs = set()

            for (dest_path,) in destination_paths:
                if not dest_path or not os.path.exists(dest_path):
                    continue

                dest_dir = os.path.dirname(dest_path)
                if not os.path.exists(dest_dir):
                    continue

                dirs_to_check = [dest_dir]

                parent_dir = os.path.dirname(dest_dir)
                if parent_dir and os.path.exists(parent_dir):
                    dir_name = os.path.basename(dest_dir).lower()
                    if ('season' in dir_name or 'series' in dir_name or
                        dir_name.startswith('s') and dir_name[1:].isdigit()):
                        dirs_to_check.append(parent_dir)

                for check_dir in dirs_to_check:
                    if check_dir in processed_dirs:
                        continue
                    processed_dirs.add(check_dir)

                    try:
                        for item in os.listdir(check_dir):
                            if item.endswith('.tmdb'):
                                tmdb_file_path = os.path.join(check_dir, item)
                                try:
                                    os.remove(tmdb_file_path)
                                    tmdb_files_removed += 1
                                except (OSError, IOError):
                                    pass
                    except (OSError, IOError):
                        continue

            return tmdb_files_removed

        if total_entries == 0:
            log_message("No entries found that need migration.", level="INFO")
            cleanup_tmdb_files()
            return True

        log_message(f"Found {total_entries} entries that need migration.", level="INFO")
        # Get performance configuration
        from MediaHub.config.config import get_max_processes, get_db_batch_size, get_db_max_workers
        max_workers = min(get_max_processes(), get_db_max_workers(), 32)
        batch_size = get_db_batch_size()

        # Import TMDB functions here to avoid circular imports
        from MediaHub.api.tmdb_api import search_movie, search_tv_show, get_external_ids, get_movie_genres, get_show_genres
        from MediaHub.utils.file_utils import clean_query, extract_year
        from MediaHub.processors.anime_processor import is_anime_file

        def process_single_entry(entry_data):
            """Process a single database entry for migration."""
            file_path, dest_path, existing_tmdb_id, season_number = entry_data

            proper_name = None
            tmdb_id = None
            imdb_id = None
            tvdb_id = None
            media_type = None
            is_anime_genre = 0
            extracted_year = None
            episode_number = None

            try:
                # Parse the filename using the existing parser
                filename = os.path.basename(file_path)
                file_metadata = clean_query(filename)

                # Extract folder name for fallback title extraction
                if dest_path and os.path.exists(dest_path):
                    folder_name = os.path.basename(os.path.dirname(dest_path))
                else:
                    folder_name = os.path.basename(os.path.dirname(file_path))

                # Extract basic info from parser
                title = file_metadata.get('title', '')
                year = file_metadata.get('year') or extract_year(folder_name)
                season_num = file_metadata.get('season')
                ep_num = file_metadata.get('episode')

                # Extract language and quality from file metadata
                languages = file_metadata.get('languages', [])
                language = ', '.join(languages) if isinstance(languages, list) and languages else None

                resolution_info = file_metadata.get('resolution', '')
                quality_source = file_metadata.get('quality_source', '')
                quality_parts = [part for part in [resolution_info, quality_source] if part]
                quality = ' '.join(quality_parts) if quality_parts else None

                # If no title from filename, try folder name
                if not title:
                    folder_metadata = clean_query(folder_name)
                    title = folder_metadata.get('title', '')
                    if not year:
                        year = folder_metadata.get('year')

                if not title:
                    return {
                        'success': False,
                        'file_path': file_path,
                        'error': f"Could not extract title from: {filename} or {folder_name}"
                    }

                # Check if it's anime
                is_anime = is_anime_file(file_path)

                # Perform TMDB search
                tmdb_result = None
                media_type = None
                proper_name = title
                extracted_year = year
                episode_number = None
                imdb_id = None
                tmdb_id = None
                is_anime_genre = 1 if is_anime else 0

                # Try TV show search first if we have season/episode info, otherwise try movie
                if season_num or ep_num:
                    # Search as TV show
                    tmdb_result = search_tv_show(
                        title,
                        year=year,
                        auto_select=True,
                        tmdb_id=existing_tmdb_id if existing_tmdb_id else None,
                        season_number=season_num,
                        episode_number=ep_num
                    )

                    if tmdb_result and isinstance(tmdb_result, tuple):
                        if len(tmdb_result) >= 9:
                            # New format with external IDs
                            proper_name, _, is_anime_genre, season_num, ep_num, tmdb_id, _, imdb_id, tvdb_id = tmdb_result
                        elif len(tmdb_result) >= 6:
                            # Legacy format without external IDs
                            proper_name, _, is_anime_genre, season_num, ep_num, tmdb_id = tmdb_result[:6]
                            imdb_id = None
                            tvdb_id = None
                        else:
                            tmdb_result = None

                        if tmdb_result:
                            media_type = "TV"
                            episode_number = str(ep_num) if ep_num else None

                            # Extract year from proper_name if available
                            year_match = re.search(r'\((\d{4})\)', proper_name)
                            if year_match:
                                extracted_year = year_match.group(1)
                                proper_name = re.sub(r'\s*\(\d{4}\)', '', proper_name).strip()

                            # Remove TMDB/IMDB IDs from proper_name
                            proper_name = re.sub(r'\s*\{[^}]+\}', '', proper_name).strip()

                            # Get language from TMDB as fallback if not available from file metadata
                            if not language and tmdb_id:
                                try:
                                    show_data = get_show_data(tmdb_id)
                                    if show_data:
                                        language = show_data.get('original_language')
                                except Exception:
                                    pass

                if not tmdb_result:
                    # Search as movie
                    tmdb_result = search_movie(
                        title,
                        year=year,
                        auto_select=True,
                        tmdb_id=existing_tmdb_id if existing_tmdb_id else None
                    )

                    if tmdb_result and isinstance(tmdb_result, tuple) and len(tmdb_result) >= 5:
                        tmdb_id, imdb_id, proper_name, movie_year, is_anime_genre = tmdb_result[:5]
                        tvdb_id = None

                        media_type = "Movie"
                        extracted_year = str(movie_year) if movie_year else extracted_year

                        # Remove TMDB/IMDB IDs from proper_name
                        proper_name = re.sub(r'\s*\{[^}]+\}', '', proper_name).strip()
                        proper_name = re.sub(r'\s*\(\d{4}\)', '', proper_name).strip()

                        # Get TMDB language as fallback if not available from file metadata (same as movie processor)
                        if not language and tmdb_id:
                            try:
                                movie_data = get_movie_data(tmdb_id)
                                if movie_data:
                                    language = movie_data.get('original_language')
                            except Exception:
                                pass

                # Return result for batch processing
                if tmdb_result:
                    return {
                        'success': True,
                        'file_path': file_path,
                        'tmdb_id': str(tmdb_id) if tmdb_id else None,
                        'media_type': media_type,
                        'proper_name': proper_name,
                        'year': extracted_year,
                        'season_number': str(season_num) if season_num else None,
                        'episode_number': episode_number,
                        'imdb_id': imdb_id,
                        'is_anime_genre': is_anime_genre,
                        'language': language,
                        'quality': quality,
                        'tvdb_id': tvdb_id
                    }
                else:
                    return {
                        'success': False,
                        'file_path': file_path,
                        'error': f"TMDB search failed for: {title}"
                    }

            except Exception as e:
                return {
                    'success': False,
                    'file_path': file_path,
                    'error': f"Error processing entry: {str(e)}"
                }

        # Process entries in parallel batches
        migrated_count = 0
        failed_count = 0

        # Split entries into batches for processing
        def batch_entries(entries, batch_size):
            for i in range(0, len(entries), batch_size):
                yield entries[i:i + batch_size]

        def update_batch_in_db(results):
            """Update a batch of results in the database."""
            batch_migrated = 0
            batch_failed = 0

            for result in results:
                if result['success']:
                    try:
                        # Extract base_path from destination path if not already set
                        cursor.execute("SELECT destination_path, base_path FROM processed_files WHERE file_path = ?", (result['file_path'],))
                        row = cursor.fetchone()
                        current_base_path = row[1] if row else None
                        dest_path = row[0] if row else None

                        if not current_base_path and dest_path:
                            # Get proper_name for more accurate base_path extraction
                            cursor.execute("SELECT proper_name FROM processed_files WHERE file_path = ?", (result['file_path'],))
                            proper_name_row = cursor.fetchone()
                            proper_name = proper_name_row[0] if proper_name_row and proper_name_row[0] else None
                            current_base_path = extract_base_path_from_destination_path(dest_path, proper_name)

                        # Calculate file size if not already set
                        cursor.execute("SELECT file_size FROM processed_files WHERE file_path = ?", (result['file_path'],))
                        current_file_size = cursor.fetchone()
                        file_size = current_file_size[0] if current_file_size and current_file_size[0] else None

                        if file_size is None:
                            # Try to get file size from the source file
                            try:
                                if os.path.exists(result['file_path']):
                                    file_size = os.path.getsize(result['file_path'])
                                elif dest_path and os.path.exists(dest_path):
                                    file_size = os.path.getsize(dest_path)
                            except (OSError, IOError):
                                file_size = None

                        if has_tvdb_id:
                            cursor.execute("""
                                UPDATE processed_files
                                SET tmdb_id = ?, media_type = ?, proper_name = ?, year = ?, season_number = ?, episode_number = ?,
                                    imdb_id = ?, is_anime_genre = ?, base_path = ?, file_size = ?, language = ?, quality = ?, tvdb_id = ?
                                WHERE file_path = ?
                            """, (result['tmdb_id'], result['media_type'], result['proper_name'], result['year'],
                                  result['season_number'], result['episode_number'], result['imdb_id'],
                                  result['is_anime_genre'], current_base_path, file_size,
                                  result.get('language'), result.get('quality'), result.get('tvdb_id'), result['file_path']))
                        else:
                            cursor.execute("""
                                UPDATE processed_files
                                SET tmdb_id = ?, media_type = ?, proper_name = ?, year = ?, season_number = ?, episode_number = ?,
                                    imdb_id = ?, is_anime_genre = ?, base_path = ?, file_size = ?, language = ?, quality = ?
                                WHERE file_path = ?
                            """, (result['tmdb_id'], result['media_type'], result['proper_name'], result['year'],
                                  result['season_number'], result['episode_number'], result['imdb_id'],
                                  result['is_anime_genre'], current_base_path, file_size,
                                  result.get('language'), result.get('quality'), result['file_path']))
                        batch_migrated += 1
                    except sqlite3.Error as e:
                        log_message(f"Database error updating {result['file_path']}: {e}", level="ERROR")
                        batch_failed += 1
                else:
                    log_message(result['error'], level="WARNING")
                    batch_failed += 1

            conn.commit()
            return batch_migrated, batch_failed

        # Process entries in batches with parallel TMDB API calls
        batch_num = 0
        for batch in batch_entries(entries_to_migrate, batch_size):
            batch_num += 1
            batch_start_time = time.time()

            log_message(f"Processing batch {batch_num}/{(total_entries + batch_size - 1) // batch_size} "
                       f"({len(batch)} entries)...", level="INFO")

            # Process batch in parallel
            with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
                batch_results = list(executor.map(process_single_entry, batch))

            # Update database with batch results
            batch_migrated, batch_failed = update_batch_in_db(batch_results)
            migrated_count += batch_migrated
            failed_count += batch_failed

            batch_time = time.time() - batch_start_time
            processed_so_far = min(batch_num * batch_size, total_entries)

            log_message(f"Batch {batch_num} completed in {batch_time:.1f}s: "
                       f"{batch_migrated} migrated, {batch_failed} failed", level="INFO")
            log_message(f"Overall progress: {processed_so_far}/{total_entries} "
                       f"({migrated_count} migrated, {failed_count} failed)", level="INFO")

        cleanup_tmdb_files()

        log_message(f"Database migration completed!", level="INFO")
        log_message(f"Total entries processed: {total_entries}", level="INFO")
        log_message(f"Successfully migrated: {migrated_count}", level="INFO")
        log_message(f"Failed migrations: {failed_count}", level="INFO")

        return True

    except (sqlite3.Error, DatabaseError) as e:
        log_message(f"Error during database migration: {e}", level="ERROR")
        conn.rollback()
        return False