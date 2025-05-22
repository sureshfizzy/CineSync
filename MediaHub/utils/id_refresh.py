import os
import platform
import ctypes
import sqlite3
from MediaHub.config.config import get_directories
from MediaHub.processors.db_utils import DB_FILE
from MediaHub.utils.logging_utils import log_message

def refresh_tmdb_files():
    log_message("Starting .tmdb id-refresh process", level="INFO")
    _, dest_dir = get_directories()
    count = 0
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    for root, dirs, files in os.walk(dest_dir):
        for file in files:
            file_path = os.path.join(root, file)
            if os.path.islink(file_path):
                norm_file_path = os.path.normpath(file_path)
                cursor.execute("SELECT tmdb_id FROM processed_files WHERE destination_path = ?", (norm_file_path,))
                row = cursor.fetchone()
                tmdb_id = row[0] if row and row[0] else None
                if not tmdb_id:
                    log_message(f"No tmdb_id in DB for {norm_file_path}, skipping .tmdb creation.", level="WARNING")
                    continue
                parts = os.path.normpath(file_path).split(os.sep)
                if any(part.lower().startswith('season ') for part in parts):
                    for i, part in enumerate(parts):
                        if part.lower().startswith('season '):
                            show_root = os.sep.join(parts[:i])
                            break
                    tmdb_file_path = os.path.join(show_root, ".tmdb")
                else:
                    tmdb_file_path = os.path.join(os.path.dirname(file_path), ".tmdb")
                if not os.path.exists(tmdb_file_path):
                    try:
                        with open(tmdb_file_path, "w") as tmdb_file:
                            tmdb_file.write(str(tmdb_id))
                        if platform.system() == "Windows":
                            FILE_ATTRIBUTE_HIDDEN = 0x02
                            ctypes.windll.kernel32.SetFileAttributesW(tmdb_file_path, FILE_ATTRIBUTE_HIDDEN)
                        count += 1
                        log_message(f"Created .tmdb file for {file_path}", level="INFO")
                    except Exception as e:
                        log_message(f"Error creating .tmdb file for {file_path}: {e}", level="WARNING")
    conn.close()
    log_message(f".tmdb refresh complete. {count} .tmdb files created.", level="INFO")