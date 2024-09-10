import sqlite3
import os
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
    """Recursively search for a file in a directory and its subdirectories."""
    for root, dirs, files in os.walk(directory):
        if file_name in files:
            return os.path.join(root, file_name)
    return None

def display_missing_files(destination_folder):
    """
    Display missing files from the destination folder, remove them from the database,
    and point to their paths in the database.

    Args:
    - destination_folder (str): The folder where the files should be present.
    """
    with sqlite3.connect(DB_FILE) as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT file_path FROM processed_files")
        all_files_in_db = cursor.fetchall()

    destination_folder = os.path.normpath(destination_folder)
    missing_files = []

    with sqlite3.connect(DB_FILE) as conn:
        cursor = conn.cursor()

        for (file_path,) in all_files_in_db:
            file_name = os.path.basename(file_path)

            found_path = find_file_in_directory(file_name, destination_folder)

            if not found_path:
                missing_files.append(file_path)
                log_message(f"Missing file: {file_path} - Expected at: {os.path.join(destination_folder, file_name)}", level="DEBUG")

                try:
                    cursor.execute("DELETE FROM processed_files WHERE file_path = ?", (file_path,))
                    conn.commit()
                    log_message(f"File path removed from the database: {file_path}", level="DEBUG")
                except Exception as e:
                    log_message(f"Error removing file path from database: {e}", level="ERROR")
