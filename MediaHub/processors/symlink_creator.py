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
from utils.file_utils import build_dest_index, get_anime_patterns, is_file_extra, skip_files
from config.config import *
from processors.db_utils import *
from utils.plex_utils import *

error_event = Event()
log_imported_db = False
db_initialized = False

def delete_broken_symlinks(dest_dir):
    """Delete broken symlinks in the destination directory and recursively delete empty parent folders."""
    symlinks_deleted = False

    for root, _, files in os.walk(dest_dir):
        for file in files:
            file_path = os.path.join(root, file)
            if os.path.islink(file_path):
                target = os.readlink(file_path)

                # Check if the symlink target exists
                if not os.path.exists(target):
                    log_message(f"Deleting broken symlink: {file_path}", level="DEBUG")
                    os.remove(file_path)
                    symlinks_deleted = True

                    # Remove from database if present
                    if check_file_in_db(file_path):
                        log_message(f"Removing {file_path} from database.", level="DEBUG")
                        with sqlite3.connect(DB_FILE) as conn:
                            cursor = conn.cursor()
                            cursor.execute("DELETE FROM processed_files WHERE file_path = ?", (file_path,))
                            conn.commit()

                    # Recursively delete empty parent directories
                    dir_path = os.path.dirname(file_path)
                    while os.path.isdir(dir_path) and not os.listdir(dir_path):
                        log_message(f"Deleting empty folder: {dir_path}", level="DEBUG")
                        os.rmdir(dir_path)
                        dir_path = os.path.dirname(dir_path)

def process_file(args, processed_files_log):
    src_file, root, file, dest_dir, actual_dir, tmdb_folder_id_enabled, rename_enabled, auto_select, dest_index = args

    if error_event.is_set():
        return

    skip_extras_folder = is_skip_extras_folder_enabled()

    existing_dest_path = get_destination_path(src_file)
    if existing_dest_path:
        # Check if the file has been renamed
        if not os.path.exists(existing_dest_path):
            # File might have been renamed, let's check the directory
            dir_path = os.path.dirname(existing_dest_path)
            if os.path.exists(dir_path):
                for filename in os.listdir(dir_path):
                    potential_new_path = os.path.join(dir_path, filename)
                    if os.path.islink(potential_new_path) and os.readlink(potential_new_path) == src_file:
                        # Found the renamed file
                        log_message(f"Detected renamed file: {existing_dest_path} -> {potential_new_path}", level="INFO")
                        update_renamed_file(existing_dest_path, potential_new_path)
                        return

            log_message(f"Destination file missing. Re-processing: {src_file}", level="INFO")
        else:
            log_message(f"File already processed. Source: {src_file}, Existing destination: {existing_dest_path}", level="INFO")
            return

    # Check if a symlink already exists
    existing_symlink = next((full_dest_file for full_dest_file in dest_index
                             if os.path.islink(full_dest_file) and os.readlink(full_dest_file) == src_file), None)

    if existing_symlink:
        log_message(f"Symlink already exists for {os.path.basename(file)}", level="INFO")
        log_message(f"Attempting to save {src_file} to the database.", level="INFO")
        save_processed_file(src_file, existing_symlink)
        return

    # Enhanced Regex Patterns to Identify Shows or Mini-Series
    episode_match = re.search(r'(.*?)(S\d{2}\.E\d{2}|S\d{2}E\d{2}|S\d{2}e\d{2}|[0-9]+x[0-9]+|S\d{2}[0-9]+|[0-9]+e[0-9]+|\bep\.?\s*\d{1,2}\b|\bEp\.?\s*\d{1,2}\b|\bEP\.?\s*\d{1,2}\b|S\d{2}\sE\d{2}|MINI[- ]SERIES|MINISERIES|\s-\s\d{2,3}|\s-\d{2,3}|\s-\s*\d{2,3}|[Ee]pisode\s*\d{2}|[Ee]p\s*\d{2}|Season_-\d{2}|\bSeason\d+\b|\bE\d+\b)', file, re.IGNORECASE)

    mini_series_match = re.search(r'(MINI[- ]SERIES|MINISERIES)', file, re.IGNORECASE)
    anime_episode_pattern = re.compile(r'\s-\s\d{2,3}\s', re.IGNORECASE)

    # Get additional anime patterns
    other_anime_patterns = get_anime_patterns()

    # Check if the file should be considered an extra based on size
    if skip_extras_folder and is_file_extra(file, src_file):
        log_message(f"Skipping extras file: {file} based on size", level="DEBUG")
        return

    if episode_match or mini_series_match:
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
        log_message(f"Destination file path is None for {file}. Skipping.", level="WARNING")
        return

    # Ensure the destination directory exists
    os.makedirs(os.path.dirname(dest_file), exist_ok=True)

    # Check if symlink already exists
    if os.path.islink(dest_file):
        existing_src = os.readlink(dest_file)
        if existing_src == src_file:
            log_message(f"Symlink already exists and is correct: {dest_file} -> {src_file}", level="INFO")
            save_processed_file(src_file, dest_file)
            return
        else:
            log_message(f"Updating existing symlink: {dest_file} -> {src_file} (was: {existing_src})", level="INFO")
            os.remove(dest_file)

    if os.path.exists(dest_file) and not os.path.islink(dest_file):
        log_message(f"File already exists at destination: {os.path.basename(dest_file)}", level="INFO")
        return

    # Create symlink
    try:
        os.symlink(src_file, dest_file)
        log_message(f"Created symlink: {dest_file} -> {src_file}", level="DEBUG")
        log_message(f"Processed file: {src_file} to {dest_file}", level="INFO")
        save_processed_file(src_file, dest_file)

        if plex_update() and plex_token():
            update_plex_after_symlink(dest_file)

    except FileExistsError:
        log_message(f"File already exists: {dest_file}. Skipping symlink creation.", level="WARNING")
    except OSError as e:
        log_message(f"Error creating symlink for {src_file}: {e}", level="ERROR")

    except Exception as e:
        error_message = f"Task failed with exception: {e}\n{traceback.format_exc()}"
        log_message(error_message, level="ERROR")

def create_symlinks(src_dirs, dest_dir, auto_select=False, single_path=None):
    global log_imported_db

    os.makedirs(dest_dir, exist_ok=True)
    tmdb_folder_id_enabled = is_tmdb_folder_id_enabled()
    rename_enabled = is_rename_enabled()
    skip_extras_folder = is_skip_extras_folder_enabled()
    imdb_structure_id_enabled = is_imdb_folder_id_enabled()

    # Use single_path if provided
    if single_path:
        src_dirs = [single_path]

    # Load the record of processed files
    processed_files_log = load_processed_files()

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

                        # Check if the file is an extra based on the size
                        if skip_extras_folder and is_file_extra(file, src_file):
                            log_message(f"Skipping extras file: {file}", level="DEBUG")
                            continue

                        if src_file in processed_files_log:
                            continue

                        args = (src_file, root, file, dest_dir, actual_dir, tmdb_folder_id_enabled, rename_enabled, auto_select, dest_index)
                        tasks.append(executor.submit(process_file, args, processed_files_log))

    # Wait for all tasks to complete
    for task in as_completed(tasks):
        if error_event.is_set():
            log_message("Error detected during task execution. Stopping all tasks.", level="WARNING")
            return
