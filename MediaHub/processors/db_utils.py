import sqlite3
import os
import time
from utils.logging_utils import log_message
import threading
from functools import wraps
from dotenv import load_dotenv, find_dotenv
import sys
import concurrent.futures

# Load environment variables
dotenv_path = find_dotenv('../.env')
if not dotenv_path:
    print(RED_COLOR + "Error: .env file not found in the parent directory." + RESET_COLOR)
    exit(1)

load_dotenv(dotenv_path)

DB_DIR = "db"
DB_FILE = os.path.join(DB_DIR, "processed_files.db")
ARCHIVE_DB_FILE = os.path.join(DB_DIR, "processed_files_archive.db")
MAX_RECORDS = 100000
LOCK_FILE = os.path.join(DB_DIR, "db_initialized.lock")

# Get configuration from environment variables
THROTTLE_RATE = float(os.getenv('DB_THROTTLE_RATE', 10))
MAX_RETRIES = int(os.getenv('DB_MAX_RETRIES', 3))
RETRY_DELAY = float(os.getenv('DB_RETRY_DELAY', 1.0))
BATCH_SIZE = int(os.getenv('DB_BATCH_SIZE', 1000))
MAX_WORKERS = int(os.getenv('DB_MAX_WORKERS', 4))

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
            if self.connections:
                return self.connections.pop()
            else:
                conn = sqlite3.connect(self.db_file, check_same_thread=False, timeout=20.0)
                conn.execute("PRAGMA journal_mode=WAL")
                conn.execute("PRAGMA synchronous=NORMAL")
                conn.execute("PRAGMA cache_size=10000")
                return conn

    def return_connection(self, conn):
        with self.lock:
            if len(self.connections) < self.max_connections:
                self.connections.append(conn)
            else:
                conn.close()

# Create connection pools
main_pool = ConnectionPool(DB_FILE)
archive_pool = ConnectionPool(ARCHIVE_DB_FILE)

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
def initialize_db():
    global db_initialized
    """Initialize the SQLite database and create the necessary tables."""
    if os.path.exists(LOCK_FILE):
        log_message("Database already initialized. Checking for updates.", level="INFO")
    else:
        log_message("Initializing database...", level="INFO")
        os.makedirs(DB_DIR, exist_ok=True)

    conn = sqlite3.connect(DB_FILE)
    try:
        cursor = conn.cursor()

        # Create the processed_files table if it doesn't exist
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS processed_files (
                file_path TEXT PRIMARY KEY,
                destination_path TEXT
            )
        """)

        # Check if the destination_path column exists
        cursor.execute("PRAGMA table_info(processed_files)")
        columns = [column[1] for column in cursor.fetchall()]

        if "destination_path" not in columns:
            # Add the destination_path column
            cursor.execute("ALTER TABLE processed_files ADD COLUMN destination_path TEXT")
            log_message("Added destination_path column to processed_files table.", level="INFO")

        # Create indexes
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_file_path ON processed_files(file_path)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_destination_path ON processed_files(destination_path)")

        conn.commit()
        log_message("Database schema is up to date.", level="INFO")

        # Create or update the lock file
        with open(LOCK_FILE, 'w') as lock_file:
            lock_file.write("Database initialized and up to date.")

    except sqlite3.Error as e:
        log_message(f"Failed to initialize or update database: {e}", level="ERROR")
        conn.rollback()
    finally:
        conn.close()

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
def save_processed_file(conn, source_path, dest_path):
    source_path = normalize_file_path(source_path)
    dest_path = normalize_file_path(dest_path)
    try:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT OR REPLACE INTO processed_files (file_path, destination_path)
            VALUES (?, ?)
        """, (source_path, dest_path))
        conn.commit()
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

@throttle
@retry_on_db_lock
@with_connection(main_pool)
def delete_broken_symlinks(conn, file_path):
    file_path = normalize_file_path(file_path)
    log_message(f"Attempting to remove file path from the database: {file_path}", level="DEBUG")
    try:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM processed_files WHERE file_path = ?", (file_path,))
        conn.commit()
        log_message(f"DELETE FROM processed_files WHERE file_path = {file_path}", level="DEBUG")
        log_message(f"File path removed from the database: {file_path}", level="INFO")
    except (sqlite3.Error, DatabaseError) as e:
        log_message(f"Error removing file path from database: {e}", level="ERROR")
        conn.rollback()

def normalize_file_path(file_path):
    return os.path.normpath(file_path)

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
        cursor.execute("SELECT file_path, destination_path FROM processed_files")

        missing_files = []
        for source_path, dest_path in cursor.fetchall():
            if not os.path.exists(dest_path):
                # Check if the file has been renamed
                dir_path = os.path.dirname(dest_path)
                if os.path.exists(dir_path):
                    for filename in os.listdir(dir_path):
                        potential_new_path = os.path.join(dir_path, filename)
                        if os.path.islink(potential_new_path) and os.readlink(potential_new_path) == source_path:
                            # Found the renamed file
                            log_message(f"Detected renamed file: {dest_path} -> {potential_new_path}", level="INFO")
                            update_renamed_file(dest_path, potential_new_path)
                            break
                    else:
                        missing_files.append((source_path, dest_path))
                        log_message(f"Missing file: {source_path} - Expected at: {dest_path}", level="DEBUG")
                else:
                    missing_files.append((source_path, dest_path))
                    log_message(f"Missing file: {source_path} - Expected at: {dest_path}", level="DEBUG")

        # Delete missing files from the database
        cursor.executemany("DELETE FROM processed_files WHERE file_path = ?", [(f[0],) for f in missing_files])
        conn.commit()

        total_duration = time.time() - start_time
        log_message(f"Total time taken for display_missing_files function: {total_duration:.2f} seconds", level="INFO")

        return missing_files

    except (sqlite3.Error, DatabaseError) as e:
        log_message(f"Error in display_missing_files: {e}", level="ERROR")
        conn.rollback()
        return []

@throttle
@retry_on_db_lock
@with_connection(main_pool)
def update_db_schema():
    try:
        conn = sqlite3.connect(DB_FILE)
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
    finally:
        conn.close()

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
