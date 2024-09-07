# db_utils.py
import sqlite3
import os

DB_DIR = "db"
DB_FILE = os.path.join(DB_DIR, "processed_files.db")
ARCHIVE_DB_FILE = os.path.join(DB_DIR, "processed_files_archive.db")
MAX_RECORDS = 100000

def initialize_db():
    """Initialize the SQLite database and create the necessary tables."""
    os.makedirs(DB_DIR, exist_ok=True)

    with sqlite3.connect(DB_FILE) as conn:
        cursor = conn.cursor()
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS processed_files (
                file_path TEXT PRIMARY KEY
            )
        """)
        conn.commit()

    with sqlite3.connect(ARCHIVE_DB_FILE) as conn:
        cursor = conn.cursor()
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS processed_files_archive (
                file_path TEXT PRIMARY KEY
            )
        """)
        conn.commit()

def archive_old_records():
    """Archive old records to keep the primary database size manageable."""
    with sqlite3.connect(DB_FILE) as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM processed_files")
        record_count = cursor.fetchone()[0]

        if record_count > MAX_RECORDS:
            # Move old records to archive
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
    with sqlite3.connect(DB_FILE) as conn:
        cursor = conn.cursor()
        cursor.execute("INSERT OR IGNORE INTO processed_files (file_path) VALUES (?)", (file_path,))
        conn.commit()
