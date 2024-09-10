import sqlite3
import os
import time
from utils.logging_utils import log_message

DB_DIR = "db"
DB_FILE = os.path.join(DB_DIR, "processed_files.db")
ARCHIVE_DB_FILE = os.path.join(DB_DIR, "processed_files_archive.db")
MAX_RECORDS = 100000
LOCK_FILE = os.path.join(DB_DIR, "db_initialized.lock")

def initialize_db():
    global db_initialized
    """Initialize the SQLite database and create the necessary tables."""
    if os.path.exists(LOCK_FILE):
        log_message("Database already initialized. Skipping initialization.", level="INFO")
        return

    log_message("Initializing database...", level="INFO")
    os.makedirs(DB_DIR, exist_ok=True)

    with sqlite3.connect(DB_FILE) as conn:
        cursor = conn.cursor()
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS processed_files (
                file_path TEXT PRIMARY KEY
            )
        """)
        conn.commit()
        log_message("Processed files table initialized.", level="INFO")

    with sqlite3.connect(ARCHIVE_DB_FILE) as conn:
        cursor = conn.cursor()
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS processed_files_archive (
                file_path TEXT PRIMARY KEY
            )
        """)
        conn.commit()
        log_message("Processed files archive table initialized.", level="INFO")

    with open(LOCK_FILE, 'w') as lock_file:
        lock_file.write("Database initialized.")

def archive_old_records():
    """Archive old records to keep the primary database size manageable."""

    with sqlite3.connect(DB_FILE) as conn:
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

def load_processed_files():
    """Load the processed files from the database."""
    processed_files = set()
    with sqlite3.connect(DB_FILE) as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT file_path FROM processed_files")
        rows = cursor.fetchall()
        processed_files.update(row[0] for row in rows)
    return processed_files

def save_processed_file(file_path):
    """Save a processed file path to the database."""
    file_path = normalize_file_path(file_path)
    with sqlite3.connect(DB_FILE) as conn:
        cursor = conn.cursor()
        try:
            cursor.execute("INSERT OR IGNORE INTO processed_files (file_path) VALUES (?)", (file_path,))
            conn.commit()
        except sqlite3.Error as e:
            log_message(f"Database error: {e}", level="ERROR")
            conn.rollback()

def check_file_in_db(file_path):
    """Check if a file path is present in the database."""
    file_path = normalize_file_path(file_path)
    with sqlite3.connect(DB_FILE) as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM processed_files WHERE file_path = ?", (file_path,))
        count = cursor.fetchone()[0]
        return count > 0

def delete_broken_symlinks(file_path):
    """Remove a processed file path from the database."""
    file_path = normalize_file_path(file_path)
    log_message(f"Attempting to remove file path from the database: {file_path}", level="DEBUG")
    try:
        with sqlite3.connect(DB_FILE) as conn:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM processed_files WHERE file_path = ?", (file_path,))
            conn.commit()
            log_message(f"DELETE FROM processed_files WHERE file_path = {file_path}", level="DEBUG")
            log_message(f"File path removed from the database: {file_path}", level="INFO")
    except Exception as e:
        log_message(f"Error removing file path from database: {e}", level="ERROR")

def normalize_file_path(file_path):
    """Ensure file path is consistently formatted."""
    normalized_path = os.path.normpath(file_path)
    return normalized_path

def find_file_in_directory(file_name, directory):
    """Check if a file is present in the directory set."""
    for root, dirs, files in os.walk(directory):
        if file_name in files:
            return os.path.join(root, file_name)
    return None

def build_file_set(directory):
    """Build a set of file names in the directory."""
    file_set = set()
    for root, dirs, files in os.walk(directory):
        for file in files:
            file_set.add(file)
    return file_set

def display_missing_files(destination_folder):
    """Display missing files from the destination folder, remove them from the database,
    and point to their paths in the database.

    Args:
    - destination_folder (str): The folder where the files should be present.
    """
    start_time = time.time()

    log_message("Starting display_missing_files function.", level="INFO")

    # Fetch all file paths from the database
    db_fetch_start_time = time.time()
    with sqlite3.connect(DB_FILE) as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT file_path FROM processed_files")
        all_files_in_db = cursor.fetchall()
    db_fetch_duration = time.time() - db_fetch_start_time
    log_message(f"Time taken to fetch all file paths from database: {db_fetch_duration:.2f} seconds", level="INFO")

    log_message("Fetched all file paths from the database.", level="INFO")

    destination_folder = os.path.normpath(destination_folder)

    # Build a set of file names in the destination folder
    build_start_time = time.time()
    file_set = build_file_set(destination_folder)
    build_duration = time.time() - build_start_time
    log_message(f"Time taken to build file set: {build_duration:.2f} seconds", level="INFO")

    log_message("Built file set for the destination folder.", level="INFO")

    missing_files = []

    # Check each file from the database against the file set
    check_start_time = time.time()

    with sqlite3.connect(DB_FILE) as conn:
        cursor = conn.cursor()

        for (file_path,) in all_files_in_db:
            file_name = os.path.basename(file_path)

            if file_name not in file_set:
                missing_files.append(file_path)
                log_message(f"Missing file: {file_path} - Expected at: {os.path.join(destination_folder, file_name)}", level="DEBUG")

                try:
                    cursor.execute("DELETE FROM processed_files WHERE file_path = ?", (file_path,))
                    conn.commit()
                    log_message(f"File path removed from the database: {file_path}", level="DEBUG")
                except Exception as e:
                    log_message(f"Error removing file path from database: {e}", level="ERROR")

    check_duration = time.time() - check_start_time
    log_message(f"Time taken to check files against the file set: {check_duration:.2f} seconds", level="INFO")

    total_duration = time.time() - start_time
    log_message(f"Total time taken for display_missing_files function: {total_duration:.2f} seconds", level="INFO")

    return missing_files
