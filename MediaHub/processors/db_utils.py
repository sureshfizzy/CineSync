import sqlite3
import os
from utils.logging_utils import log_message

DB_DIR = "db"
DB_FILE = os.path.join(DB_DIR, "processed_files.db")
ARCHIVE_DB_FILE = os.path.join(DB_DIR, "processed_files_archive.db")
MAX_RECORDS = 100000

def initialize_db():
    """Initialize the SQLite database and create the necessary tables."""
    os.makedirs(DB_DIR, exist_ok=True)

    log_message("Initializing the database...", level="INFO")

    with sqlite3.connect(DB_FILE) as conn:
        cursor = conn.cursor()
        log_message("Creating processed_files table if not exists...", level="INFO")
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS processed_files (
                file_path TEXT PRIMARY KEY
            )
        """)
        conn.commit()
        log_message("processed_files table created or already exists.", level="INFO")

    with sqlite3.connect(ARCHIVE_DB_FILE) as conn:
        cursor = conn.cursor()
        log_message("Creating processed_files_archive table if not exists...", level="INFO")
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS processed_files_archive (
                file_path TEXT PRIMARY KEY
            )
        """)
        conn.commit()
        log_message("processed_files_archive table created or already exists.", level="INFO")

def archive_old_records():
    """Archive old records to keep the primary database size manageable."""
    log_message("Archiving old records...", level="INFO")

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
    log_message("Loading processed files from the database...", level="INFO")
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
        cursor.execute("INSERT OR IGNORE INTO processed_files (file_path) VALUES (?)", (file_path,))
        conn.commit()

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
            log_message(f"File path removed from the database: {file_path}", level="DEBUG")
    except Exception as e:
        log_message(f"Error removing file path from database: {e}", level="ERROR")

def normalize_file_path(file_path):
    """Ensure file path is correctly formatted."""
    if file_path.count('/') > 1:
        return file_path.split('/')[-1]
    return file_path

def cleanup_database():
    """Clean up entries with extra segments in the file path."""
    with sqlite3.connect(DB_FILE) as conn:
        cursor = conn.cursor()
        cursor.execute("""
            DELETE FROM processed_files
            WHERE file_path LIKE '%/%'
        """)
        conn.commit()
