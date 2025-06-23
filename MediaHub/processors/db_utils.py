import sqlite3
import os
import time
import threading
import sys
import concurrent.futures
import csv
import sqlite3
import platform
from typing import List, Tuple, Optional
from sqlite3 import DatabaseError
from functools import wraps
from dotenv import load_dotenv, find_dotenv
from MediaHub.utils.logging_utils import log_message
import traceback
import requests

# Define color constants for terminal output
RED_COLOR = "\033[91m"
RESET_COLOR = "\033[0m"

# Load environment variables
dotenv_path = find_dotenv('../.env')
if not dotenv_path:
    print(RED_COLOR + "Error: .env file not found in the parent directory." + RESET_COLOR)
    exit(1)

load_dotenv(dotenv_path)

BASE_DIR = os.path.abspath(os.path.dirname(os.path.dirname(os.path.dirname(__file__))))
DB_DIR = os.path.join(BASE_DIR, "db")
DB_FILE = os.path.join(DB_DIR, "processed_files.db")
ARCHIVE_DB_FILE = os.path.join(DB_DIR, "processed_files_archive.db")
MAX_RECORDS = 100000
LOCK_FILE = os.path.join(DB_DIR, "db_initialized.lock")

# Ensure database directory exists
os.makedirs(DB_DIR, exist_ok=True)

# Get configuration from environment variables
THROTTLE_RATE = float(os.getenv('DB_THROTTLE_RATE', 10))
MAX_RETRIES = int(os.getenv('DB_MAX_RETRIES', 3))
RETRY_DELAY = float(os.getenv('DB_RETRY_DELAY', 1.0))
BATCH_SIZE = int(os.getenv('DB_BATCH_SIZE', 1000))
MAX_WORKERS = int(os.getenv('DB_MAX_WORKERS', 4))

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
                    conn = sqlite3.connect(self.db_file, check_same_thread=False, timeout=20.0)
                    conn.execute("PRAGMA journal_mode=WAL")
                    conn.execute("PRAGMA synchronous=NORMAL")
                    conn.execute("PRAGMA cache_size=10000")
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

# Create connection pools with single connection for SQLite
main_pool = ConnectionPool(DB_FILE, max_connections=1)
archive_pool = ConnectionPool(ARCHIVE_DB_FILE, max_connections=1)

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
                tmdb_id TEXT,
                season_number TEXT,
                reason TEXT
            )
        """)

        cursor.execute("PRAGMA table_info(processed_files)")
        columns = [column[1] for column in cursor.fetchall()]

        # Add column if it doesn't exist
        if "destination_path" not in columns:
            cursor.execute("ALTER TABLE processed_files ADD COLUMN destination_path TEXT")
            log_message("Added destination_path column to processed_files table.", level="INFO")

        if "tmdb_id" not in columns:
            cursor.execute("ALTER TABLE processed_files ADD COLUMN tmdb_id TEXT")
            log_message("Added tmdb_id column to processed_files table.", level="INFO")

        if "season_number" not in columns:
            cursor.execute("ALTER TABLE processed_files ADD COLUMN season_number TEXT")
            log_message("Added season column to processed_files table.", level="INFO")

        if "reason" not in columns:
            cursor.execute("ALTER TABLE processed_files ADD COLUMN reason TEXT")
            log_message("Added reason column to processed_files table.", level="INFO")

        if "file_size" not in columns:
            cursor.execute("ALTER TABLE processed_files ADD COLUMN file_size INTEGER")
            log_message("Added file_size column to processed_files table.", level="INFO")

        # Create indexes
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_file_path ON processed_files(file_path)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_destination_path ON processed_files(destination_path)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_tmdb_id ON processed_files(tmdb_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_season_number ON processed_files(season_number)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_reason ON processed_files(reason)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_file_size ON processed_files(file_size)")

        conn.commit()
        log_message("Database schema is up to date.", level="INFO")

        # Create or update the lock file
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
def save_processed_file(conn, source_path, dest_path=None, tmdb_id=None, season_number=None, reason=None, file_size=None):
    source_path = normalize_file_path(source_path)
    if dest_path:
        dest_path = normalize_file_path(dest_path)

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
def display_missing_files(conn, destination_folder):
    start_time = time.time()
    log_message("Starting display_missing_files function.", level="INFO")
    destination_folder = os.path.normpath(destination_folder)
    try:
        cursor = conn.cursor()
        # Only select files that aren't marked as skipped (don't have a reason)
        cursor.execute("""
            SELECT file_path, destination_path, reason
            FROM processed_files
            WHERE reason IS NULL
        """)
        missing_files = []

        for source_path, dest_path, reason in cursor.fetchall():
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
            except (OSError, IOError) as e:
                log_message(f"Error accessing file or directory: {e}", level="WARNING")
                continue
            except Exception as e:
                log_message(f"Unexpected error processing paths - Source: {source_path}, Dest: {dest_path} - Error: {str(e)}", level="ERROR")
                continue

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
                destination_path TEXT
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
    """Track file addition in WebDavHub"""
    try:
        from MediaHub.config.config import get_cinesync_ip, get_cinesync_api_port

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

        response = requests.post(url, json=payload, timeout=2)
        if response.status_code != 200:
            log_message(f"Dashboard notification failed with status {response.status_code}", level="DEBUG")

    except requests.exceptions.RequestException as e:
        log_message(f"Dashboard notification unavailable (WebDavHub not running?): {e}", level="DEBUG")
    except Exception as e:
        log_message(f"Error tracking addition: {e}", level="DEBUG")

def track_file_deletion(source_path, dest_path, tmdb_id=None, season_number=None, reason=""):
    """Track file deletion in WebDavHub"""
    try:
        from MediaHub.config.config import get_cinesync_ip, get_cinesync_api_port

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

        response = requests.post(url, json=payload, timeout=2)
        if response.status_code != 200:
            log_message(f"Dashboard notification failed with status {response.status_code}", level="DEBUG")

    except requests.exceptions.RequestException as e:
        log_message(f"Dashboard notification unavailable (WebDavHub not running?): {e}", level="DEBUG")

def track_file_failure(source_path, tmdb_id=None, season_number=None, reason="", error_message=""):
    """Track file processing failure in WebDavHub"""
    try:
        from MediaHub.config.config import get_cinesync_ip, get_cinesync_api_port

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

        response = requests.post(url, json=payload, timeout=2)
        if response.status_code != 200:
            log_message(f"Dashboard notification failed with status {response.status_code}", level="DEBUG")
    except Exception as e:
        log_message(f"Failed to track file failure: {e}", level="DEBUG")
    except Exception as e:
        log_message(f"Error tracking deletion: {e}", level="DEBUG")


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
                file_path, dest_path, tmdb_id, season_number, reason, file_size = row
                log_message(f"TMDB ID: {tmdb_id}", level="INFO")
                if season_number is not None:
                    log_message(f"Season Number: {season_number}", level="INFO")
                log_message(f"Source: {file_path}", level="INFO")
                log_message(f"Destination: {dest_path if dest_path else 'None'}", level="INFO")
                if file_size is not None:
                    # Format file size in human-readable format
                    if file_size >= 1024*1024*1024:  # GB
                        size_str = f"{file_size/(1024*1024*1024):.2f} GB"
                    elif file_size >= 1024*1024:  # MB
                        size_str = f"{file_size/(1024*1024):.2f} MB"
                    elif file_size >= 1024:  # KB
                        size_str = f"{file_size/1024:.2f} KB"
                    else:  # Bytes
                        size_str = f"{file_size} bytes"
                    log_message(f"File Size: {size_str}", level="INFO")
                else:
                    log_message(f"File Size: Not available", level="INFO")
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
