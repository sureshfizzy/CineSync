import os
import platform
import ctypes
import sqlite3
from MediaHub.processors.db_utils import DB_FILE
from MediaHub.utils.logging_utils import log_message

def refresh_tmdb_files():
    log_message("Starting .tmdb id-refresh process...", level="INFO")
    # Connect to the processed_files database
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    cursor.execute("SELECT destination_path, tmdb_id FROM processed_files WHERE destination_path IS NOT NULL AND tmdb_id IS NOT NULL")
    rows = cursor.fetchall()
    count = 0
    for dest_path, tmdb_id in rows:
        if not dest_path or not tmdb_id:
            continue
        if os.path.islink(dest_path):
            # Determine if this is a show (has 'Season xx' in path)
            parts = os.path.normpath(dest_path).split(os.sep)
            if any(part.lower().startswith('season ') for part in parts):
                for i, part in enumerate(parts):
                    if part.lower().startswith('season '):
                        show_root = os.sep.join(parts[:i])
                        break
                tmdb_file_path = os.path.join(show_root, ".tmdb")
            else:
                tmdb_file_path = os.path.join(os.path.dirname(dest_path), ".tmdb")
            if not os.path.exists(tmdb_file_path):
                tmdb_id_str = str(tmdb_id)  # Write only the numeric ID
                try:
                    with open(tmdb_file_path, "w") as tmdb_file:
                        tmdb_file.write(tmdb_id_str)
                    if platform.system() == "Windows":
                        FILE_ATTRIBUTE_HIDDEN = 0x02
                        ctypes.windll.kernel32.SetFileAttributesW(tmdb_file_path, FILE_ATTRIBUTE_HIDDEN)
                    count += 1
                    log_message(f"Created .tmdb file for {dest_path}", level="INFO")
                except Exception as e:
                    log_message(f"Error creating .tmdb file for {dest_path}: {e}", level="WARNING")
    log_message(f".tmdb refresh complete. {count} .tmdb files created.", level="INFO")
    conn.close() 