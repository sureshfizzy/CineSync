import os
import re
import traceback
import sqlite3
from concurrent.futures import ThreadPoolExecutor, as_completed
from multiprocessing import cpu_count
from threading import Event
from processors.movie_processor import process_movie
from processors.show_processor import process_show
from utils.logging_utils import log_message
from utils.file_utils import build_dest_index
from config.config import is_tmdb_folder_id_enabled, is_rename_enabled, is_skip_extras_folder_enabled
from processors.db_utils import *

error_event = Event()
log_imported_db = False

def delete_broken_symlinks(dest_dir):
    """Delete broken symlinks in the destination directory and update the database."""
    for root, _, files in os.walk(dest_dir):
        for file in files:
            file_path = os.path.join(root, file)
            if os.path.islink(file_path):
                target = os.readlink(file_path)
                if not os.path.exists(target):
                    log_message(f"Deleting broken symlink: {file_path}", level="DEBUG")
                    os.remove(file_path)
                    if check_file_in_db(file_path):
                        log_message(f"Removing {file_path} from database.", level="DEBUG")
                        with sqlite3.connect(DB_FILE) as conn:
                            cursor = conn.cursor()
                            cursor.execute("DELETE FROM processed_files WHERE file_path = ?", (file_path,))
                            conn.commit()

def determine_is_show(directory):
    """
    Determine if a directory contains TV shows or mini-series based on episode patterns or keywords.
    If at least 2 or 3 files match common episode patterns or mini-series keywords, return True.
    """
    episode_patterns = re.compile(r'(S\d{2}\.E\d{2}|S\d{2}E\d{2}|S\d{2}e\d{2}|[0-9]+x[0-9]+|S\d{2}[0-9]+|[0-9]+e[0-9]+|\bep\.?\s*\d{1,2}\b|\bEp\.?\s*\d{1,2}\b|\bEP\.?\s*\d{1,2}\b|S\d{2}\sE\d{2}|MINI[- ]SERIES|MINISERIES)', re.IGNORECASE)
    match_count = 0
    threshold = 2  # Minimum number of matches to determine as a TV show

    for root, _, files in os.walk(directory):
        for file in files:
            if episode_patterns.search(file):
                match_count += 1
                if match_count >= threshold:
                    return True
    return False

def process_file(args, processed_files_log):
    src_file, root, file, dest_dir, actual_dir, tmdb_folder_id_enabled, rename_enabled, auto_select, dest_index = args

    if error_event.is_set():
        return

    skip_extras_folder = is_skip_extras_folder_enabled()

    # Skip processing if the file has already been processed
    if src_file in processed_files_log:
        return

    # Check if a symlink already exists
    symlink_exists = any(os.path.islink(full_dest_file) and os.readlink(full_dest_file) == src_file for full_dest_file in dest_index)

    if symlink_exists:
        log_message(f"Symlink already exists for {os.path.basename(file)}", level="INFO")
        return

    # Enhanced Regex Patterns to Identify Shows or Mini-Series
    episode_match = re.search(r'(.*?)(S\d{2}\.E\d{2}|S\d{2}E\d{2}|S\d{2}e\d{2}|[0-9]+x[0-9]+|S\d{2}[0-9]+|[0-9]+e[0-9]+|\bep\.?\s*\d{1,2}\b|\bEp\.?\s*\d{1,2}\b|\bEP\.?\s*\d{1,2}\b|S\d{2}\sE\d{2}|MINI[- ]SERIES|MINISERIES)', file, re.IGNORECASE)
    mini_series_match = re.search(r'(MINI[- ]SERIES|MINISERIES)', file, re.IGNORECASE)
    is_extras = re.search(r'(Behind.the.Scenes|Part\.\d+)', file, re.IGNORECASE)

    # Fallback logic to determine if the folder is a TV show directory
    season_pattern = re.compile(r'\b(s\d{2})\b', re.IGNORECASE)
    is_show_directory = bool(season_pattern.search(root))

    if not is_show_directory and not episode_match and not mini_series_match:
        is_show_directory = determine_is_show(root)

    try:
        if skip_extras_folder and is_extras:
            log_message(f"Skipping extras file: {file}", level="INFO")
            return

        if episode_match or is_show_directory or mini_series_match:
            # Determine if the file is an episode or extra
            if mini_series_match:
                # Handle mini-series
                dest_file = process_show(src_file, root, file, dest_dir, actual_dir, tmdb_folder_id_enabled, rename_enabled, auto_select, dest_index, episode_match)
            else:
                # Handle regular show or episodes
                dest_file = process_show(src_file, root, file, dest_dir, actual_dir, tmdb_folder_id_enabled, rename_enabled, auto_select, dest_index, episode_match)
        else:
            # Handle movies
            dest_file = process_movie(src_file, root, file, dest_dir, actual_dir, tmdb_folder_id_enabled, rename_enabled, auto_select, dest_index)

        # Check if dest_file is None
        if dest_file is None:
            log_message(f"Destination file path is None for {src_file}. Skipping.", level="ERROR")
            return

        # Ensure the destination directory exists
        os.makedirs(os.path.dirname(dest_file), exist_ok=True)

        # Handle existing symlinks or files
        if os.path.islink(dest_file):
            if os.readlink(dest_file) == src_file:
                log_message(f"Symlink already exists for {os.path.basename(dest_file)}", level="INFO")
                return
            else:
                os.remove(dest_file)

        if os.path.exists(dest_file) and not os.path.islink(dest_file):
            log_message(f"File already exists at destination: {os.path.basename(dest_file)}", level="INFO")
            return

        # Create symlink
        os.symlink(src_file, dest_file)

        log_message(f"Created symlink: {dest_file} -> {src_file}", level="DEBUG")
        log_message(f"Processed file: {src_file} to {dest_file}", level="INFO")

        # Mark the file as processed
        save_processed_file(src_file)

    except Exception as e:
        error_message = f"Task failed with exception: {e}\n{traceback.format_exc()}"
        log_message(error_message, level="ERROR")
        error_event.set()

def create_symlinks(src_dirs, dest_dir, auto_select=False, single_path=None):
    global log_imported_db

    os.makedirs(dest_dir, exist_ok=True)
    tmdb_folder_id_enabled = is_tmdb_folder_id_enabled()
    rename_enabled = is_rename_enabled()
    skip_extras_folder = is_skip_extras_folder_enabled()

    # Use single_path if provided
    if single_path:
        src_dirs = [single_path]

    # Initialize the database
    initialize_db()

    # Archive old records if needed
    archive_old_records()

    # Load the record of processed files
    processed_files_log = load_processed_files()

    #Cleanup broken links
    cleanup_database()

    # Log database import message
    log_message("Database import completed.", level="INFO")
    log_imported_db = True

    if not log_imported_db:
        log_message("Database import message was not logged. Aborting scan.", level="ERROR")
        return

    # Delete broken symlinks before starting the scan
    delete_broken_symlinks(dest_dir)

    tasks = []
    with ThreadPoolExecutor(max_workers=cpu_count()) as executor:
        for src_dir in src_dirs:
            if os.path.isfile(src_dir):
                # Handle single file
                src_file = src_dir
                root = os.path.dirname(src_file)
                file = os.path.basename(src_file)
                actual_dir = os.path.basename(root)
                args = (src_file, root, file, dest_dir, actual_dir, tmdb_folder_id_enabled, rename_enabled, auto_select, build_dest_index(dest_dir))
                tasks.append(executor.submit(process_file, args, processed_files_log))
            else:
                # Handle directory
                actual_dir = os.path.basename(os.path.normpath(src_dir))
                log_message(f"Scanning source directory: {src_dir} (actual: {actual_dir})", level="INFO")

                files_to_process = []
                dest_index = build_dest_index(dest_dir)  # Ensure dest_index is properly initialized

                for root, _, files in os.walk(src_dir):
                    for file in files:
                        if error_event.is_set():
                            log_message("Stopping further processing due to an earlier error.", level="WARNING")
                            return

                        src_file = os.path.join(root, file)
                        # Check if the file is an extra and should be skipped
                        if skip_extras_folder and re.search(r'(Behind.the.Scenes|Part\.\d+)', file, re.IGNORECASE):
                            log_message(f"Skipping extras file: {file}", level="INFO")
                            continue

                        if src_file in processed_files_log:
                            #log_message(f"Skipping already processed file: {file}", level="INFO")
                            continue

                        args = (src_file, root, file, dest_dir, actual_dir, tmdb_folder_id_enabled, rename_enabled, auto_select, dest_index)
                        tasks.append(executor.submit(process_file, args, processed_files_log))

    # Wait for all tasks to complete
    for task in as_completed(tasks):
        if error_event.is_set():
            log_message("Error detected during task execution. Stopping all tasks.", level="WARNING")
            return
