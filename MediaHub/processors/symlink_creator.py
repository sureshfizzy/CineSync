import os
import platform
import re
import time
import traceback
import sqlite3
import json
import sys
import ctypes
from ctypes import wintypes
from threading import Thread
from queue import Queue, Empty
from threading import Thread, Event
from concurrent.futures import ThreadPoolExecutor, as_completed
from multiprocessing import cpu_count
from threading import Event
from MediaHub.processors.movie_processor import process_movie
from MediaHub.processors.show_processor import process_show
from MediaHub.utils.logging_utils import log_message
from MediaHub.utils.file_utils import build_dest_index, get_anime_patterns, is_junk_file
from MediaHub.monitor.symlink_cleanup import run_symlink_cleanup
from MediaHub.utils.webdav_api import send_structured_message
from MediaHub.config.config import *
from MediaHub.processors.db_utils import *
from MediaHub.utils.plex_utils import *
from MediaHub.processors.process_db import *
from MediaHub.processors.symlink_utils import *
from MediaHub.utils.webdav_api import send_structured_message

error_event = Event()
log_imported_db = False
db_initialized = False

def process_file(args, processed_files_log, force=False):
    src_file, root, file, dest_dir, actual_dir, tmdb_folder_id_enabled, rename_enabled, auto_select, dest_index, tmdb_id, imdb_id, tvdb_id, force_show, force_movie, season_number, episode_number, force_extra, skip = args

    if error_event.is_set():
        return

    # Normalize path
    src_file = os.path.normpath(src_file)

    # Handle skip flag
    if skip:
        force = True

        existing_symlink_path = get_existing_symlink_info(src_file)
        if existing_symlink_path:
            log_message(f"Skip mode: Found existing symlink at {existing_symlink_path}", level="INFO")
            try:
                os.remove(existing_symlink_path)
                log_message(f"Skip mode: Removed existing symlink for {file}", level="INFO")

                parent_dir = os.path.dirname(existing_symlink_path)
                parent_parent_dir = os.path.dirname(parent_dir)

                if os.path.exists(parent_dir) and not os.listdir(parent_dir):
                    log_message(f"Deleting empty directory: {parent_dir}", level="INFO")
                    os.rmdir(parent_dir)

                    if os.path.exists(parent_parent_dir) and not os.listdir(parent_parent_dir):
                        log_message(f"Deleting empty directory: {parent_parent_dir}", level="INFO")
                        os.rmdir(parent_parent_dir)
            except OSError as e:
                log_message(f"Error during skip cleanup: {e}", level="WARNING")

        reason = "Skipped by user"
        save_processed_file(src_file, None, tmdb_id, season_number, reason)
        return

    # Check for unsupported file type
    if not get_known_types(file):
        reason = "Unsupported file type"
        log_message(f"Skipping file: {file} ({reason})", level="INFO")
        save_processed_file(src_file, None, tmdb_id, season_number, reason)
        return

    skip_extras_folder = is_skip_extras_folder_enabled()

    # Handle force mode
    if force:
        existing_symlink_path = get_existing_symlink_info(src_file)
        if existing_symlink_path:
            log_message(f"Force mode: Found existing symlink at {existing_symlink_path}", level="DEBUG")
            # Store the old symlink info for later cleanup
            old_symlink_info = {
                'path': existing_symlink_path,
                'parent_dir': os.path.dirname(existing_symlink_path),
                'parent_parent_dir': os.path.dirname(os.path.dirname(existing_symlink_path)),
                'tmdb_file_path': None
            }

            # Get .tmdb file path if it exists
            parts = os.path.normpath(existing_symlink_path).split(os.sep)
            if any(part.lower().startswith('season ') for part in parts):
                for i, part in enumerate(parts):
                    if part.lower().startswith('season '):
                        show_root = os.sep.join(parts[:i])
                        break
                old_symlink_info['tmdb_file_path'] = os.path.join(show_root, ".tmdb")
            else:
                old_symlink_info['tmdb_file_path'] = os.path.join(os.path.dirname(existing_symlink_path), ".tmdb")

            log_message(f"Force mode: Will process {file} and cleanup old symlink after successful creation", level="INFO")

    existing_dest_path = get_destination_path(src_file)
    if existing_dest_path and not force:
        return
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

    else:
        if not force:
            skip_reason = get_skip_reason(src_file)
            if skip_reason:
                return

    # Check if a symlink already exists
    existing_symlink = next((full_dest_file for full_dest_file in dest_index
                             if os.path.islink(full_dest_file) and os.readlink(full_dest_file) == src_file), None)

    if existing_symlink and not force:
        log_message(f"Symlink already exists for {os.path.basename(file)}", level="INFO")
        save_processed_file(src_file, existing_symlink, tmdb_id)
        return

    # Show detection logic
    is_show = False
    is_anime_show = False
    episode_match = None


    # Skip hash filenames unless they have valid media patterns
    hash_pattern = re.compile(r'^[a-f0-9]{32}(\.[^.]+$|\[.+?\]\.)', re.IGNORECASE)
    is_hash_name = hash_pattern.search(file) is not None

    if is_hash_name and not tmdb_id and not imdb_id:
        log_message(f"Skipping file with hash lacking media identifiers: {file}", level="INFO")
        reason = "Missing media identifiers on hash file"
        save_processed_file(src_file, None, tmdb_id, season_number, reason)
        return

    if force_show:
        is_show = True
        log_message(f"Processing as show based on Force Show flag: {file}", level="INFO")
    elif force_movie:
        is_show = False
        log_message(f"Processing as movie based on Force Movie flag: {file}", level="INFO")
    else:
        episode_match = re.search(r'(.*?)(S\d{1,2}\.?E\d{2}|S\d{1,2}\s*\d{2}|S\d{2}E\d{2}|S\d{2}e\d{2}|(?<!\d{3})\b[1-9][0-9]?x[0-9]{1,2}\b(?!\d{3})|[0-9]+e[0-9]+|\bep\.?\s*\d{1,2}\b|\bEp\.?\s*\d{1,2}\b|\bEP\.?\s*\d{1,2}\b|S\d{2}\sE\d{2}|MINI[- ]SERIES|MINISERIES|\s-\s(?!1080p|720p|480p|2160p|\d+Kbps|\d{4}|\d+bit)\d{2,3}(?!Kbps)|\s-(?!1080p|720p|480p|2160p|\d+Kbps|\d{4}|\d+bit)\d{2,3}(?!Kbps)|\s-\s*(?!1080p|720p|480p|2160p|\d+Kbps|\d{4}|\d+bit)\d{2,3}(?!Kbps)|[Ee]pisode\s*\d{2}|[Ee]p\s*\d{2}|Season_-\d{2}|\bSeason\d+\b|\bE\d+\b|series\.\d+\.\d+of\d+|Episode\s+(\d+)\s+(.*?)\.(\w+)|\b\d{2}x\d{2}\b)|\(S\d{1,2}\)', file, re.IGNORECASE)
        mini_series_match = re.search(r'(MINI[- ]SERIES|MINISERIES)', file, re.IGNORECASE)
        anime_episode_pattern = re.compile(r'\s-\s\d{2,3}\s|\d{2,3}v\d+', re.IGNORECASE)
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
            is_anime_show = True
            log_message(f"Processing as show based on anime pattern: {src_file}", level="DEBUG")

    # Check if the file should be considered an junk based on size
    if is_junk_file(file, src_file):
        log_message(f"Skipping Junk files: {file} based on size", level="DEBUG")
        reason = "File size below minimum threshold"
        save_processed_file(src_file, None, tmdb_id, season_number, reason)
        return

    # Determine whether to process as show or movie
    show_metadata = None
    if is_show or is_anime_show:
        result = process_show(src_file, root, file, dest_dir, actual_dir, tmdb_folder_id_enabled, rename_enabled, auto_select, dest_index, episode_match, tmdb_id=tmdb_id, imdb_id=imdb_id, tvdb_id=tvdb_id, season_number=season_number, episode_number=episode_number, is_anime_show=is_anime_show, force_extra=force_extra)
        # Check if result is None or the first item (dest_file) is None
        if result is None or result[0] is None:
            log_message(f"Show processing failed or was skipped for {file}. Skipping symlink creation.", level="WARNING")
            return

        # Handle both old and new return formats
        if len(result) == 5:
            dest_file, tmdb_id, season_number, is_extra, show_metadata = result
            # Extract episode number from metadata if available
            if show_metadata and 'episode_number' in show_metadata:
                episode_number = show_metadata['episode_number']
        else:
            # Fallback for old format
            dest_file, tmdb_id, season_number, is_extra = result
            # Extract episode number from filename if not already set
            if episode_number is None and season_number is not None:
                episode_match_result = re.search(r'[Ee](\d{2})', file, re.IGNORECASE)
                if episode_match_result:
                    episode_number = int(episode_match_result.group(1))

        # Skip symlink creation for extras unless skipped from env or force_extra is enabled
        if is_extra and not force_extra and is_skip_extras_folder_enabled():
            log_message(f"Skipping symlink creation for extra file: {file}", level="INFO")
            reason = "Extra/Special Content"
            save_processed_file(src_file, None, tmdb_id, season_number, reason)
            return
    else:
        result = process_movie(src_file, root, file, dest_dir, actual_dir, tmdb_folder_id_enabled, rename_enabled, auto_select, dest_index, tmdb_id=tmdb_id, imdb_id=imdb_id)

        # Check if result is None or the first item (dest_file) is None
        if result is None or result[0] is None:
            log_message(f"Movie processing failed or was skipped for {file}. Skipping symlink creation.", level="WARNING")
            return
        dest_file, tmdb_id = result

    if dest_file is None:
        log_message(f"Destination file path is None for {file}. Skipping.", level="WARNING")
        reason = "Missing destination path"
        save_processed_file(src_file, None, tmdb_id, season_number, reason)
        return

    os.makedirs(os.path.dirname(dest_file), exist_ok=True)

    # Check if symlink already exists
    if os.path.islink(dest_file):
        existing_src = os.readlink(dest_file)
        if existing_src == src_file:
            log_message(f"Symlink already exists and is correct: {dest_file} -> {src_file}", level="INFO")
            save_processed_file(src_file, dest_file, tmdb_id)
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

        # Extract media information for structured message
        new_folder_name = os.path.basename(os.path.dirname(dest_file))
        new_filename = os.path.basename(dest_file)

        # Determine media type based on folder structure
        media_type = "movie"
        if "TV Shows" in dest_file or "Series" in dest_file or season_number is not None:
            media_type = "tvshow"

        # Prepare structured data for WebDavHub API
        structured_data = {
            "source_file": src_file,
            "destination_file": dest_file,
            "media_name": new_folder_name,
            "filename": new_filename,
            "media_type": media_type,
            "tmdb_id": tmdb_id,
            "season_number": season_number,
            "episode_number": episode_number,
            "timestamp": time.time(),
            "force_mode": force if 'force' in locals() else False
        }

        # Add metadata for TV shows
        if show_metadata and media_type == "tvshow":
            structured_data.update({
                "show_name": show_metadata.get('show_name'),
                "proper_show_name": show_metadata.get('proper_show_name'),
                "episode_title": show_metadata.get('episode_title'),
                "year": show_metadata.get('year'),
                "is_anime_genre": show_metadata.get('is_anime_genre', False)
            })

        # Send structured data to WebDavHub API
        send_structured_message("symlink_created", structured_data)

        save_processed_file(src_file, dest_file, tmdb_id, season_number)

        # Cleanup old symlink if it exists (force mode)
        if force and 'old_symlink_info' in locals():
            # Normalize paths for comparison to handle different path separators
            old_path_normalized = os.path.normpath(old_symlink_info['path'])
            new_path_normalized = os.path.normpath(dest_file)

            # Only cleanup if the old symlink path is different from the new one
            if old_path_normalized != new_path_normalized:
                try:
                    if os.path.exists(old_symlink_info['path']):
                        os.remove(old_symlink_info['path'])
                        log_message(f"Force mode: Removed old symlink at {old_symlink_info['path']}", level="INFO")

                    # Delete .tmdb file if it exists
                    if old_symlink_info['tmdb_file_path'] and os.path.exists(old_symlink_info['tmdb_file_path']):
                        try:
                            os.remove(old_symlink_info['tmdb_file_path'])
                            log_message(f"Deleted old .tmdb file at {old_symlink_info['tmdb_file_path']}", level="INFO")
                        except Exception as e:
                            log_message(f"Error deleting old .tmdb file at {old_symlink_info['tmdb_file_path']}: {e}", level="WARNING")

                    # Delete if parent directory is empty
                    if os.path.exists(old_symlink_info['parent_dir']) and not os.listdir(old_symlink_info['parent_dir']):
                        log_message(f"Deleting empty directory: {old_symlink_info['parent_dir']}", level="INFO")
                        os.rmdir(old_symlink_info['parent_dir'])

                        if os.path.exists(old_symlink_info['parent_parent_dir']) and not os.listdir(old_symlink_info['parent_parent_dir']):
                            log_message(f"Deleting empty directory: {old_symlink_info['parent_parent_dir']}", level="INFO")
                            os.rmdir(old_symlink_info['parent_parent_dir'])
                except OSError as e:
                    log_message(f"Error during force mode cleanup: {e}", level="WARNING")
            else:
                log_message(f"Force mode: Skipping cleanup as symlink location unchanged: {dest_file}", level="DEBUG")

        if tmdb_id:
            tmdb_id_str = str(tmdb_id)

            # Determine media type based on whether it was processed as show or movie
            # Check if this is a show by looking at the destination path structure
            parts = os.path.normpath(dest_file).split(os.sep)
            is_tv_show = any(part.lower().startswith('season ') for part in parts)
            media_type = "tv" if is_tv_show else "movie"

            # Create content in format: tmdb_id:media_type
            tmdb_content = f"{tmdb_id_str}:{media_type}"

            # For shows, place .tmdb in the show root (parent of 'Season xx')
            if is_tv_show:
                for i, part in enumerate(parts):
                    if part.lower().startswith('season '):
                        show_root = os.sep.join(parts[:i])
                        break
                tmdb_file_path = os.path.normpath(os.path.join(show_root, ".tmdb"))
            else:
                tmdb_file_path = os.path.normpath(os.path.join(os.path.dirname(dest_file), ".tmdb"))

            try:
                # Ensure the directory exists before creating the file
                tmdb_dir = os.path.dirname(tmdb_file_path)
                os.makedirs(tmdb_dir, exist_ok=True)

                # Check if file already exists and has the same content
                file_needs_update = True
                if os.path.exists(tmdb_file_path):
                    try:
                        with open(tmdb_file_path, "r") as existing_file:
                            existing_content = existing_file.read().strip()
                            if existing_content == tmdb_content or existing_content == tmdb_id_str:
                                if existing_content == tmdb_id_str:
                                    log_message(f"Updating .tmdb file format to include media type: {tmdb_file_path}", level="DEBUG")
                                else:
                                    file_needs_update = False
                                    log_message(f"TMDB file already exists with correct content: {tmdb_file_path}", level="DEBUG")
                    except Exception:
                        pass

                if file_needs_update:
                    # On Windows, handle hidden file attributes properly
                    file_was_hidden = False
                    if platform.system() == "Windows" and os.path.exists(tmdb_file_path):
                        try:
                            # Check if file is currently hidden
                            FILE_ATTRIBUTE_HIDDEN = 0x02
                            current_attrs = ctypes.windll.kernel32.GetFileAttributesW(tmdb_file_path)
                            if current_attrs != -1 and (current_attrs & FILE_ATTRIBUTE_HIDDEN):
                                file_was_hidden = True
                                FILE_ATTRIBUTE_NORMAL = 0x80
                                ctypes.windll.kernel32.SetFileAttributesW(tmdb_file_path, FILE_ATTRIBUTE_NORMAL)
                                log_message(f"Temporarily removed hidden attribute for update: {tmdb_file_path}", level="DEBUG")
                        except Exception as e:
                            log_message(f"Warning: Could not handle hidden attribute before writing: {e}", level="DEBUG")

                    # Write the file content
                    try:
                        with open(tmdb_file_path, "w") as tmdb_file:
                            tmdb_file.write(tmdb_content)
                    except Exception as e:
                        log_message(f"Error writing .tmdb file content: {e}", level="WARNING")
                        raise

                # Set hidden attribute on Windows (always set it, whether it was hidden before or not)
                if platform.system() == "Windows":
                    try:
                        import ctypes
                        FILE_ATTRIBUTE_HIDDEN = 0x02
                        result = ctypes.windll.kernel32.SetFileAttributesW(tmdb_file_path, FILE_ATTRIBUTE_HIDDEN)
                        if result:
                            pass
                        else:
                            log_message(f"Warning: Failed to set hidden attribute on .tmdb file: {tmdb_file_path}", level="DEBUG")
                    except Exception as e:
                        log_message(f"Warning: Could not set hidden attribute on .tmdb file: {e}", level="DEBUG")

            except Exception as e:
                log_message(f"Error creating .tmdb file at {tmdb_file_path}: {e}", level="WARNING")

        if plex_update() and plex_token():
            update_plex_after_symlink(dest_file)

        return (dest_file, True, src_file)

    except FileExistsError:
        log_message(f"File already exists: {dest_file}. Skipping symlink creation.", level="WARNING")
    except OSError as e:
        log_message(f"Error creating symlink for {src_file}: {e}", level="ERROR")
    except Exception as e:
        error_message = f"Task failed with exception: {e}\n{traceback.format_exc()}"
        log_message(error_message, level="ERROR")

    return None

def create_symlinks(src_dirs, dest_dir, auto_select=False, single_path=None, force=False, mode='create', tmdb_id=None, imdb_id=None, tvdb_id=None, force_show=False, force_movie=False, season_number=None, episode_number=None, force_extra=False, skip=False):
    global log_imported_db

    # If skip is true, automatically set force to true for proper cleanup
    if skip:
        force = True
        log_message("Skip flag detected - automatically enabling force mode for proper cleanup", level="INFO")

    os.makedirs(dest_dir, exist_ok=True)
    tmdb_folder_id_enabled = is_tmdb_folder_id_enabled()
    rename_enabled = is_rename_enabled()
    skip_extras_folder = is_skip_extras_folder_enabled()
    imdb_structure_id_enabled = is_imdb_folder_id_enabled()

    # Initialize database if in monitor mode
    if mode == 'monitor' and not os.path.exists(PROCESS_DB):
        initialize_file_database()

    # Use single_path if provided
    if single_path:
        src_dirs = [single_path]

    # Load the record of processed files
    processed_files_log = load_processed_files()

    if auto_select:
        # Use thread pool for parallel processing when auto-select is enabled
        tasks = []
        with ThreadPoolExecutor(max_workers=cpu_count()) as executor:
            for src_dir in src_dirs:
                if os.path.isfile(src_dir):
                    src_file = src_dir
                    root = os.path.dirname(src_file)
                    file = os.path.basename(src_file)
                    actual_dir = os.path.basename(root)

                    # Get appropriate destination index based on mode
                    dest_index = (get_dest_index_from_db() if mode == 'monitor'
                                else build_dest_index(dest_dir))

                    args = (src_file, root, file, dest_dir, actual_dir, tmdb_folder_id_enabled, rename_enabled, auto_select, dest_index, tmdb_id, imdb_id, tvdb_id, force_show, force_movie, season_number, episode_number, force_extra, skip)
                    tasks.append(executor.submit(process_file, args, processed_files_log, force))
                else:
                    # Handle directory
                    actual_dir = os.path.basename(os.path.normpath(src_dir))
                    log_message(f"Scanning source directory: {src_dir} (actual: {actual_dir})", level="INFO")

                    # Get appropriate destination index based on mode
                    dest_index = (get_dest_index_from_db() if mode == 'monitor'
                                else build_dest_index(dest_dir))

                    for root, _, files in os.walk(src_dir):
                        for file in files:
                            if error_event.is_set():
                                log_message("Stopping further processing due to an earlier error.", level="WARNING")
                                return

                            src_file = os.path.join(root, file)

                            if mode == 'create' and src_file in processed_files_log and not force:
                                continue

                            args = (src_file, root, file, dest_dir, actual_dir, tmdb_folder_id_enabled, rename_enabled, auto_select, dest_index, tmdb_id, imdb_id, tvdb_id, force_show, force_movie, season_number, episode_number, force_extra, skip)
                            tasks.append(executor.submit(process_file, args, processed_files_log, force))

            # Process completed tasks
            for task in as_completed(tasks):
                if error_event.is_set():
                    log_message("Error detected during task execution. Stopping all tasks.", level="WARNING")
                    return

                try:
                    result = task.result()
                    if result and isinstance(result, tuple) and len(result) == 3:
                        dest_file, is_symlink, target_path = result
                        if mode == 'monitor':
                            update_single_file_index(dest_file, is_symlink, target_path)
                except Exception as e:
                    log_message(f"Error processing task: {str(e)}", level="ERROR")
    else:
        # Process sequentially when auto-select is disabled
        for src_dir in src_dirs:
            if error_event.is_set():
                log_message("Stopping further processing due to an earlier error.", level="WARNING")
                return

            try:
                if os.path.isfile(src_dir):
                    src_file = src_dir
                    root = os.path.dirname(src_file)
                    file = os.path.basename(src_file)
                    actual_dir = os.path.basename(root)

                    # Get appropriate destination index based on mode
                    dest_index = (get_dest_index_from_db() if mode == 'monitor'
                                else build_dest_index(dest_dir))

                    args = (src_file, root, file, dest_dir, actual_dir, tmdb_folder_id_enabled, rename_enabled, auto_select, dest_index, tmdb_id, imdb_id, tvdb_id, force_show, force_movie, season_number, episode_number, force_extra, skip)
                    result = process_file(args, processed_files_log, force)

                    if result and isinstance(result, tuple) and len(result) == 3:
                        dest_file, is_symlink, target_path = result
                        if mode == 'monitor':
                            update_single_file_index(dest_file, is_symlink, target_path)
                else:
                    # Handle directory
                    actual_dir = os.path.basename(os.path.normpath(src_dir))
                    log_message(f"Scanning source directory: {src_dir} (actual: {actual_dir})", level="INFO")

                    # Get appropriate destination index based on mode
                    dest_index = (get_dest_index_from_db() if mode == 'monitor'
                                else build_dest_index(dest_dir))

                    for root, _, files in os.walk(src_dir):
                        for file in files:
                            if error_event.is_set():
                                log_message("Stopping further processing due to an earlier error.", level="WARNING")
                                return

                            src_file = os.path.join(root, file)

                            if mode == 'create' and src_file in processed_files_log and not force:
                                continue

                            args = (src_file, root, file, dest_dir, actual_dir, tmdb_folder_id_enabled, rename_enabled, auto_select, dest_index, tmdb_id, imdb_id, tvdb_id, force_show, force_movie, season_number, episode_number, force_extra, skip)
                            result = process_file(args, processed_files_log, force)

                            if result and isinstance(result, tuple) and len(result) == 3:
                                dest_file, is_symlink, target_path = result
                                if mode == 'monitor':
                                    update_single_file_index(dest_file, is_symlink, target_path)
            except Exception as e:
                log_message(f"Error processing directory {src_dir}: {str(e)}", level="ERROR")
