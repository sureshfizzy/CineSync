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
from MediaHub.processors.symlink_utils import *

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
                        log_message(f"Broken symlink found: {file_path} -> {target}", level="INFO")
                        symlinks_deleted = True

                        # First check if the file is in the database
                        if check_file_in_db(file_path):
                            # Try to get the actual destination using search_database if available
                            actual_target = None
                            try:
                                if 'search_database_quiet' in globals() and callable(globals()['search_database_quiet']):
                                    search_results = search_database(file_path)
                                    if search_results and len(search_results) > 0:
                                        actual_target = search_results[0][0] if search_results[0][0] else target
                                else:
                                    log_message("Using original target path", level="DEBUG")
                            except Exception as search_error:
                                log_message(f"Error searching database: {str(search_error)}", level="ERROR")

                            # Use actual target if found, otherwise use the original target
                            removed_path = actual_target if actual_target else target
                            delete_broken_symlinks(dest_dir, removed_path)
                        else:
                            log_message(f"Symlink not found in database, deleting directly: {file_path}", level="DEBUG")
                            try:
                                os.remove(file_path)
                                log_message(f"Manually deleted broken symlink: {file_path}", level="INFO")
                            except Exception as rm_error:
                                log_message(f"Error removing symlink: {str(rm_error)}", level="ERROR")
                except Exception as e:
                    log_message(f"Error processing symlink {file_path}: {str(e)}", level="ERROR")
                    print(f"Exception details: {traceback.format_exc()}")

    if symlinks_deleted:
        log_message("Broken symlinks deleted successfully.", level="INFO")
    else:
        log_message("No broken symlinks found.", level="INFO")

    # Retrieve the cleanup interval
    cleanup_interval = int(os.getenv("SYMLINK_CLEANUP_INTERVAL", 600))

    log_message(f"Sleeping Full broken symlink deletion for {cleanup_interval} seconds until next cleanup cycle.", level="INFO")
    time.sleep(cleanup_interval)
