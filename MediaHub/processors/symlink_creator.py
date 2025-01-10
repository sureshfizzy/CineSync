import os
import re
import traceback
import sqlite3
from concurrent.futures import ThreadPoolExecutor, as_completed
from multiprocessing import cpu_count
from threading import Event
from MediaHub.processors.movie_processor import process_movie
from MediaHub.processors.show_processor import process_show
from MediaHub.utils.logging_utils import log_message
from MediaHub.utils.file_utils import build_dest_index, get_anime_patterns, is_file_extra, skip_files
from MediaHub.monitor.symlink_cleanup import run_symlink_cleanup
from MediaHub.config.config import *
from MediaHub.processors.db_utils import *
from MediaHub.utils.plex_utils import *

error_event = Event()
log_imported_db = False
db_initialized = False

def delete_broken_symlinks(dest_dir, removed_path=None):
    """Delete broken symlinks in the destination directory.

    Args:
        dest_dir: The destination directory containing symlinks
        removed_path: Optional path of the removed file/folder to check
    """
    symlinks_deleted = False

    if removed_path:
        # Normalize the removed path and handle spaces
        removed_path = os.path.normpath(removed_path)
        log_message(f"Processing removed path: {removed_path}", level="DEBUG")
        with sqlite3.connect(DB_FILE) as conn:
            cursor = conn.cursor()

            # Check if this is a directory
            if removed_path.endswith(']') or os.path.isdir(removed_path):
                log_message(f"Detected folder removal: {removed_path}", level="DEBUG")
                search_path = f"{removed_path}/%"
                log_message(f"Searching for all files under: {search_path}", level="DEBUG")

                cursor.execute("""
                    SELECT file_path, destination_path
                    FROM processed_files
                    WHERE file_path LIKE ?
                """, (search_path,))

                results = cursor.fetchall()
                log_message(f"Found {len(results)} matching files in database", level="INFO")

                for source_path, symlink_path in results:
                    log_message(f"Processing database entry - Source: {source_path}", level="DEBUG")
                    log_message(f"Symlink path: {symlink_path}", level="DEBUG")

                    if os.path.islink(symlink_path):
                        target = os.readlink(symlink_path)
                        log_message(f"Found symlink pointing to: {target}", level="DEBUG")

                        log_message(f"Deleting symlink: {symlink_path}", level="INFO")
                        os.remove(symlink_path)
                        symlinks_deleted = True

                        cursor.execute("DELETE FROM processed_files WHERE destination_path = ?", (symlink_path,))
                        log_message(f"Removed database entry for: {symlink_path}", level="DEBUG")

                        _cleanup_empty_dirs(os.path.dirname(symlink_path))

            else:
                log_message(f"Trying exact match for: {removed_path}", level="DEBUG")
                cursor.execute("SELECT destination_path FROM processed_files WHERE file_path = ?", (removed_path,))
                result = cursor.fetchone()

                # If no match, try with the file duplicated in path (common pattern)
                if not result:
                    filename = os.path.basename(removed_path)
                    alternative_path = os.path.join(removed_path, filename)
                    log_message(f"Trying alternative path: {alternative_path}", level="DEBUG")
                    cursor.execute("SELECT destination_path FROM processed_files WHERE file_path = ?", (alternative_path,))
                    result = cursor.fetchone()

                    # If still no match, try with SQL LIKE for partial matches
                    if not result:
                        pattern = f"%{filename}"
                        log_message(f"Trying partial match with pattern: {pattern}", level="DEBUG")
                        cursor.execute("SELECT file_path, destination_path FROM processed_files WHERE file_path LIKE ?", (pattern,))
                        results = cursor.fetchall()

                        if results:
                            log_message(f"Found {len(results)} potential matches:", level="DEBUG")
                            for src, dest in results:
                                log_message(f"Potential match - Source: {src}", level="DEBUG")
                                log_message(f"Destination: {dest}", level="DEBUG")

                            result = (results[0][1],)

                if result:
                    symlink_path = result[0]
                    log_message(f"Found matching database entry: {symlink_path}", level="INFO")

                    if os.path.islink(symlink_path):
                        target = os.readlink(symlink_path)
                        log_message(f"Symlink target: {target}", level="DEBUG")
                        log_message(f"Deleting symlink: {symlink_path}", level="INFO")
                        os.remove(symlink_path)
                        symlinks_deleted = True

                        cursor.execute("DELETE FROM processed_files WHERE destination_path = ?", (symlink_path,))
                        log_message(f"Removed database entry for: {symlink_path}", level="DEBUG")
                        _cleanup_empty_dirs(os.path.dirname(symlink_path))
                    else:
                        log_message(f"Database entry found but symlink doesn't exist: {symlink_path}", level="WARNING")
                else:
                    log_message(f"No database entry found for file: {removed_path}", level="DEBUG")
            conn.commit()
    else:
        _check_all_symlinks(dest_dir)

    return symlinks_deleted

def _cleanup_empty_dirs(dir_path):
    """Helper function to clean up empty directories."""
    while dir_path and os.path.isdir(dir_path) and not os.listdir(dir_path):
        log_message(f"Deleting empty folder: {dir_path}", level="INFO")
        try:
            os.rmdir(dir_path)
            dir_path = os.path.dirname(dir_path)
        except OSError:
            break

def _check_all_symlinks(dest_dir):
    """Helper function to check all symlinks in a directory."""
    log_message(f"Checking all symlinks in: {dest_dir}", level="INFO")
    files = os.listdir(dest_dir)
    for file in files:
        file_path = os.path.join(dest_dir, file)
        if os.path.islink(file_path):
            target = os.readlink(file_path)
            log_message(f"Checking symlink: {file_path} -> {target}", level="DEBUG")

            if not os.path.exists(target):
                log_message(f"Deleting broken symlink: {file_path}", level="INFO")
                os.remove(file_path)

                with sqlite3.connect(DB_FILE) as conn:
                    cursor = conn.cursor()
                    cursor.execute("DELETE FROM processed_files WHERE destination_path = ?", (file_path,))
                    affected_rows = cursor.rowcount
                    conn.commit()
                    log_message(f"Removed {affected_rows} database entries", level="DEBUG")

                _cleanup_empty_dirs(os.path.dirname(file_path))

def get_existing_symlink_info(src_file):
    """Get information about existing symlink for a source file."""
    existing_dest_path = get_destination_path(src_file)
    if existing_dest_path and os.path.exists(os.path.dirname(existing_dest_path)):
        dir_path = os.path.dirname(existing_dest_path)
        for filename in os.listdir(dir_path):
            full_path = os.path.join(dir_path, filename)
            if os.path.islink(full_path) and os.readlink(full_path) == src_file:
                return full_path
    return None

def process_file(args, processed_files_log, force=False):
    src_file, root, file, dest_dir, actual_dir, tmdb_folder_id_enabled, rename_enabled, auto_select, dest_index = args

    if error_event.is_set():
        return

    skip_extras_folder = is_skip_extras_folder_enabled()

    # Handle force mode
    if force:
        existing_symlink_path = get_existing_symlink_info(src_file)
        if existing_symlink_path:
            log_message(f"Force mode: Found existing symlink at {existing_symlink_path}", level="DEBUG")
            os.remove(existing_symlink_path)
            log_message(f"Force mode: Initiating reprocessing of {file}", level="INFO")

    existing_dest_path = get_destination_path(src_file)
    if existing_dest_path and not force:
        if not os.path.exists(existing_dest_path):
            dir_path = os.path.dirname(existing_dest_path)
            if os.path.exists(dir_path):
                for filename in os.listdir(dir_path):
                    potential_new_path = os.path.join(dir_path, filename)
                    if os.path.islink(potential_new_path) and os.readlink(potential_new_path) == src_file:
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

    if existing_symlink and not force:
        log_message(f"Symlink already exists for {os.path.basename(file)}", level="INFO")
        save_processed_file(src_file, existing_symlink)
        return

    # Show detection logic
    is_show = False
    episode_match = re.search(r'(.*?)(S\d{1,2}\.?E\d{2}|S\d{1,2}\s*\d{2}|S\d{2}E\d{2}|S\d{2}e\d{2}|[0-9]+x[0-9]+|[0-9]+e[0-9]+|\bep\.?\s*\d{1,2}\b|\bEp\.?\s*\d{1,2}\b|\bEP\.?\s*\d{1,2}\b|S\d{2}\sE\d{2}|MINI[- ]SERIES|MINISERIES|\s-\s(?!1080p|720p|480p|2160p|\d+Kbps)\d{2,3}(?!Kbps)|\s-(?!1080p|720p|480p|2160p|\d+Kbps)\d{2,3}(?!Kbps)|\s-\s*(?!1080p|720p|480p|2160p|\d+Kbps)\d{2,3}(?!Kbps)|[Ee]pisode\s*\d{2}|[Ee]p\s*\d{2}|Season_-\d{2}|\bSeason\d+\b|\bE\d+\b|series\.\d+\.\d+of\d+)', file, re.IGNORECASE)
    mini_series_match = re.search(r'(MINI[- ]SERIES|MINISERIES)', file, re.IGNORECASE)
    anime_episode_pattern = re.compile(r'\s-\s\d{2,3}\s', re.IGNORECASE)
    anime_patterns = get_anime_patterns()
    season_pattern = re.compile(r'\b(s\d{2})\b', re.IGNORECASE)

    # Check file path and name for show patterns
    if season_pattern.search(src_file):
        is_show = True
        log_message(f"Processing as show based on directory structure: {src_file}", level="DEBUG")
    elif episode_match or mini_series_match:
        is_show = True
        log_message(f"Processing as show based on file pattern: {src_file}", level="DEBUG")
    elif anime_episode_pattern.search(file) or anime_patterns.search(file):
        is_show = True
        log_message(f"Processing as show based on anime pattern: {src_file}", level="DEBUG")

    # Determine whether to process as show or movie
    if is_show:
        dest_file = process_show(src_file, root, file, dest_dir, actual_dir, tmdb_folder_id_enabled, rename_enabled, auto_select, dest_index, episode_match)
    else:
        dest_file = process_movie(src_file, root, file, dest_dir, actual_dir, tmdb_folder_id_enabled, rename_enabled, auto_select, dest_index)

    # Check if the file should be considered an extra based on size
    if skip_extras_folder and is_file_extra(file, src_file):
        log_message(f"Skipping extras file: {file} based on size", level="DEBUG")
        return

    if dest_file is None:
        log_message(f"Destination file path is None for {file}. Skipping.", level="WARNING")
        return

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
        log_message(f"Created symlink: {dest_file} -> {src_file}", level="INFO")
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

def create_symlinks(src_dirs, dest_dir, auto_select=False, single_path=None, force=False):
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

    tasks = []
    with ThreadPoolExecutor(max_workers=cpu_count()) as executor:
        for src_dir in src_dirs:
            if os.path.isfile(src_dir):
                src_file = src_dir
                root = os.path.dirname(src_file)
                file = os.path.basename(src_file)
                actual_dir = os.path.basename(root)
                args = (src_file, root, file, dest_dir, actual_dir, tmdb_folder_id_enabled, rename_enabled, auto_select, build_dest_index(dest_dir))
                tasks.append(executor.submit(process_file, args, processed_files_log, force))
            else:
                # Handle directory
                actual_dir = os.path.basename(os.path.normpath(src_dir))
                log_message(f"Scanning source directory: {src_dir} (actual: {actual_dir})", level="INFO")

                files_to_process = []
                dest_index = build_dest_index(dest_dir)

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

                        if src_file in processed_files_log and not force:
                            continue

                        args = (src_file, root, file, dest_dir, actual_dir, tmdb_folder_id_enabled, rename_enabled, auto_select, dest_index)
                        tasks.append(executor.submit(process_file, args, processed_files_log, force))

    # Wait for all tasks to complete
    for task in as_completed(tasks):
        if error_event.is_set():
            log_message("Error detected during task execution. Stopping all tasks.", level="WARNING")
            return

        try:
            task.result()
        except Exception as e:
            log_message(f"Error processing task: {str(e)}", level="ERROR")
