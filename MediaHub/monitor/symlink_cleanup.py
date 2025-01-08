import os
import re
import traceback
import sqlite3
import time
from dotenv import load_dotenv, find_dotenv
from concurrent.futures import ThreadPoolExecutor, as_completed
from multiprocessing import cpu_count
from threading import Event
from MediaHub.processors.movie_processor import process_movie
from MediaHub.processors.show_processor import process_show
from MediaHub.utils.logging_utils import log_message
from MediaHub.utils.file_utils import build_dest_index, get_anime_patterns, is_file_extra
from MediaHub.config.config import *
from MediaHub.processors.db_utils import *
from MediaHub.utils.plex_utils import *

# Load .env file from the parent directory
dotenv_path = find_dotenv('../.env')
if not dotenv_path:
    print(RED_COLOR + "Error: .env file not found in the parent directory." + RESET_COLOR)
    exit(1)

load_dotenv(dotenv_path)

def run_symlink_cleanup(dest_dir):
    symlinks_deleted = False
    log_message(f"Starting broken symlink cleanup in directory: {dest_dir}", level="INFO")

    if not os.path.exists(dest_dir):
        log_message(f"Destination directory {dest_dir} does not exist!", level="ERROR")
        return

    for root, _, files in os.walk(dest_dir):
        for file in files:
            file_path = os.path.join(root, file)
            if os.path.islink(file_path):
                try:
                    target = os.readlink(file_path)

                    # Check if the symlink target exists
                    if not os.path.exists(target):
                        log_message(f"Deleting broken symlink: {file_path}", level="INFO")
                        os.remove(file_path)
                        symlinks_deleted = True

                        # Remove from database if present
                        if check_file_in_db(file_path):
                            log_message(f"Removing {file_path} from database.", level="INFO")
                            with sqlite3.connect(DB_FILE) as conn:
                                cursor = conn.cursor()
                                cursor.execute("DELETE FROM processed_files WHERE file_path = ?", (file_path,))
                                conn.commit()

                        # Recursively delete empty parent directories
                        dir_path = os.path.dirname(file_path)
                        while os.path.isdir(dir_path) and not os.listdir(dir_path):
                            log_message(f"Deleting empty folder: {dir_path}", level="INFO")
                            os.rmdir(dir_path)
                            dir_path = os.path.dirname(dir_path)
                except Exception as e:
                    log_message(f"Error processing symlink {file_path}: {str(e)}", level="ERROR")
                    traceback.print_exc()

    if symlinks_deleted:
        log_message("Broken symlinks deleted successfully.", level="INFO")
    else:
        log_message("No broken symlinks found.", level="INFO")

    # Retrieve the cleanup interval
    cleanup_interval = int(os.getenv("SYMLINK_CLEANUP_INTERVAL", 600))

    log_message(f"Sleeping Full broken symlink deletion for {cleanup_interval} seconds until next cleanup cycle.", level="INFO")
    time.sleep(cleanup_interval)
