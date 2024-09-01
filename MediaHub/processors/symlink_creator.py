import os
import re
import traceback
from concurrent.futures import ThreadPoolExecutor, as_completed
from multiprocessing import cpu_count
from threading import Event
from processors.movie_processor import process_movie
from processors.show_processor import process_show
from utils.logging_utils import log_message
from utils.file_utils import build_dest_index
from config.config import is_tmdb_folder_id_enabled, is_rename_enabled, is_skip_extras_folder_enabled

error_event = Event()

def determine_is_show(directory):
    """
    Determine if a directory contains TV shows or mini-series based on episode patterns or keywords.
    If at least 2 or 3 files match common episode patterns or mini-series keywords, return True.
    """
    episode_patterns = re.compile(r'(S\d{2}E\d{2}|S\d{2}e\d{2}|[0-9]+x[0-9]+|S\d{2}[0-9]+|[0-9]+e[0-9]+|ep\.?\s*\d+|Ep\.?\s*\d+|EP\.?\s*\d+|MINI[- ]SERIES|MINISERIES)', re.IGNORECASE)
    match_count = 0
    threshold = 2  # Minimum number of matches to determine as a TV show

    for root, _, files in os.walk(directory):
        for file in files:
            if episode_patterns.search(file):
                match_count += 1
                if match_count >= threshold:
                    return True
    return False

def process_file(args):
    if error_event.is_set():
        return

    src_file, root, file, dest_dir, actual_dir, tmdb_folder_id_enabled, rename_enabled, auto_select, dest_index = args

    skip_extras_folder = is_skip_extras_folder_enabled()

    # Check if a symlink already exists
    symlink_exists = any(os.path.islink(full_dest_file) and os.readlink(full_dest_file) == src_file for full_dest_file in dest_index)

    if symlink_exists:
        log_message(f"Symlink already exists for {os.path.basename(file)}", level="INFO")
        return

    # Enhanced Regex Patterns to Identify Shows or Mini-Series
    episode_match = re.search(r'(.*?)(S\d{2}E\d{2}|S\d{2}e\d{2}|[0-9]+x[0-9]+|S\d{2}[0-9]+|[0-9]+e[0-9]+|ep\.?\s*\d+|Ep\.?\s*\d+|EP\.?\s*\d+|MINI[- ]SERIES|MINISERIES)', file, re.IGNORECASE)
    mini_series_match = re.search(r'(MINI[- ]SERIES|MINISERIES)', file, re.IGNORECASE)
    is_extras = re.search(r'(Behind.the.Scenes|Part\.\d+)', file, re.IGNORECASE)

    # Fallback logic to determine if the folder is a TV show directory
    is_show_directory = any(keyword in root.lower() for keyword in ['season', 'episode', 's01', 's02', 's03', 's04', 's05'])

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

    except Exception as e:
        error_message = f"Task failed with exception: {e}\n{traceback.format_exc()}"
        log_message(error_message, level="ERROR")
        error_event.set()

def create_symlinks(src_dirs, dest_dir, auto_select=False, single_path=None):
    os.makedirs(dest_dir, exist_ok=True)
    tmdb_folder_id_enabled = is_tmdb_folder_id_enabled()
    rename_enabled = is_rename_enabled()
    skip_extras_folder = is_skip_extras_folder_enabled()

    if single_path:
        src_dirs = [single_path]

    # Build destination index once
    dest_index = build_dest_index(dest_dir)

    tasks = []
    with ThreadPoolExecutor(max_workers=cpu_count()) as executor:
        for src_dir in src_dirs:
            actual_dir = os.path.basename(os.path.normpath(src_dir))
            log_message(f"Scanning source directory: {src_dir} (actual: {actual_dir})", level="INFO")

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

                    args = (src_file, root, file, dest_dir, actual_dir, tmdb_folder_id_enabled, rename_enabled, auto_select, dest_index)
                    tasks.append(executor.submit(process_file, args))

        # Wait for all tasks to complete
        for task in as_completed(tasks):
            if error_event.is_set():
                break

            task.result()
