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
from MediaHub.utils.file_utils import build_dest_index, is_anime_file, is_junk_file, should_skip_processing
from MediaHub.monitor.symlink_cleanup import run_symlink_cleanup
from MediaHub.utils.webdav_api import send_structured_message
from MediaHub.config.config import *
from MediaHub.processors.db_utils import *
from MediaHub.utils.plex_utils import *
from MediaHub.processors.process_db import *
from MediaHub.processors.symlink_utils import *
from MediaHub.utils.webdav_api import send_structured_message
from MediaHub.utils.file_utils import clean_query, resolve_symlink_to_source

error_event = Event()
log_imported_db = False
db_initialized = False

def _cleanup_old_symlink(old_symlink_info, new_dest_file=None):
    """Helper function to cleanup old symlinks and associated files."""
    if not old_symlink_info:
        return

    old_path_normalized = normalize_file_path(old_symlink_info['path'])

    if new_dest_file is None or old_path_normalized != normalize_file_path(new_dest_file):
        try:
            if os.path.exists(old_symlink_info['path']):
                os.remove(old_symlink_info['path'])
                log_message(f"Force mode: Removed old symlink at {old_symlink_info['path']}", level="INFO")

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
        log_message(f"Force mode: Skipping cleanup as symlink location unchanged: {new_dest_file}", level="DEBUG")

# Global cache for first selection in batch processing
first_selection_cache = {
    'tmdb_id': None,
    'show_name': None,
    'year': None,
    'is_cached': False
}

def reset_first_selection_cache():
    """Reset the first selection cache for a new batch."""
    global first_selection_cache
    first_selection_cache = {
        'tmdb_id': None,
        'show_name': None,
        'year': None,
        'is_cached': False
    }

def cache_first_selection(tmdb_id, show_name=None, year=None):
    """Cache the first manual selection for subsequent files."""
    global first_selection_cache
    first_selection_cache['tmdb_id'] = tmdb_id
    first_selection_cache['show_name'] = show_name
    first_selection_cache['year'] = year
    first_selection_cache['is_cached'] = True
    log_message(f"Cached first selection: TMDB ID {tmdb_id}, Show: {show_name}, Year: {year}", level="INFO")

def get_cached_selection():
    """Get the cached first selection if available."""
    global first_selection_cache
    if first_selection_cache['is_cached']:
        return first_selection_cache['tmdb_id'], first_selection_cache['show_name'], first_selection_cache['year']
    return None, None, None

def process_file(args, processed_files_log, force=False, batch_apply=False):
    src_file, root, file, dest_dir, actual_dir, tmdb_folder_id_enabled, rename_enabled, auto_select, dest_index, tmdb_id, imdb_id, tvdb_id, force_show, force_movie, season_number, episode_number, force_extra, skip, manual_search = args

    if error_event.is_set():
        return

    log_message(f"Processing file: {file} (force={force}, rename_enabled={rename_enabled})", level="DEBUG")

    # Track if force_extra was set by user
    user_requested_force_extra = force_extra

    # Resolve symlink to source if applicable
    original_src_file = src_file
    src_file = resolve_symlink_to_source(src_file)
    if src_file != original_src_file:
        log_message(f"Resolved symlink in processing: {original_src_file} -> {src_file}", level="INFO")
        file = os.path.basename(src_file)
        root = os.path.dirname(src_file)

    # Normalize path
    src_file = normalize_file_path(src_file)

    # Handle skip flag
    if skip:
        force = True

        # Get existing destination path from database BEFORE removing the entry
        existing_dest_path = get_destination_path(src_file)
        if existing_dest_path:
            existing_dest_path = normalize_file_path(existing_dest_path)

        remove_processed_file(src_file)

        # Clean up existing symlink and directories if they exist
        if existing_dest_path and os.path.exists(existing_dest_path):
            log_message(f"Skip mode: Found existing symlink at {existing_dest_path}", level="INFO")
            try:
                # Store the old symlink info for comprehensive cleanup
                old_symlink_info = {
                    'path': existing_dest_path,
                    'parent_dir': os.path.dirname(existing_dest_path),
                    'parent_parent_dir': os.path.dirname(os.path.dirname(existing_dest_path))
                }
                # .tmdb file handling removed - using database instead

                # Remove the symlink
                os.remove(existing_dest_path)
                log_message(f"Skip mode: Removed existing symlink for {file}", level="INFO")

                # Delete empty directories
                if os.path.exists(old_symlink_info['parent_dir']) and not os.listdir(old_symlink_info['parent_dir']):
                    log_message(f"Skip mode: Deleting empty directory: {old_symlink_info['parent_dir']}", level="INFO")
                    os.rmdir(old_symlink_info['parent_dir'])

                    if os.path.exists(old_symlink_info['parent_parent_dir']) and not os.listdir(old_symlink_info['parent_parent_dir']):
                        log_message(f"Skip mode: Deleting empty directory: {old_symlink_info['parent_parent_dir']}", level="INFO")
                        os.rmdir(old_symlink_info['parent_parent_dir'])

            except OSError as e:
                log_message(f"Error during skip cleanup: {e}", level="WARNING")
        else:
            log_message(f"Skip mode: No existing symlink found for {file}", level="INFO")

        reason = "Skipped by user"
        log_message(f"Adding skipped file to database: {src_file} (reason: {reason})", level="DEBUG")
        save_processed_file(src_file, None, tmdb_id, season_number, reason)
        return

    # Skip metadata and auxiliary files
    if should_skip_processing(file):
        reason = "Metadata or auxiliary file"
        log_message(f"Skipping metadata/auxiliary file: {file} ({reason})", level="DEBUG")
        log_message(f"Adding metadata/auxiliary file to database: {src_file} (reason: {reason})", level="DEBUG")
        save_processed_file(src_file, None, tmdb_id, season_number, reason)
        return

    # Check for unsupported file type
    if not get_known_types(file):
        reason = "Unsupported file type"
        log_message(f"Skipping file: {file} ({reason})", level="INFO")
        log_message(f"Adding unsupported file to database: {src_file} (reason: {reason})", level="DEBUG")
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
                'parent_parent_dir': os.path.dirname(os.path.dirname(existing_symlink_path))
            }

            # .tmdb file handling removed - using database instead

            log_message(f"Force mode: Will process {file} and cleanup old symlink after successful creation", level="INFO")

    existing_dest_path = get_destination_path(src_file)
    if existing_dest_path:
        log_message(f"Found file in database: {src_file} -> {existing_dest_path}", level="DEBUG")
        existing_dest_path = normalize_file_path(existing_dest_path)
    else:
        log_message(f"File not found in database: {src_file}", level="DEBUG")

    if existing_dest_path and not force:
        if not os.path.exists(existing_dest_path):
            dir_path = os.path.dirname(existing_dest_path)
            if os.path.exists(dir_path):
                for filename in os.listdir(dir_path):
                    potential_new_path = os.path.join(dir_path, filename)
                    if os.path.islink(potential_new_path):
                        link_target = normalize_file_path(os.readlink(potential_new_path))
                        if link_target == src_file:
                            log_message(f"Detected renamed file: {existing_dest_path} -> {potential_new_path}", level="INFO")
                            update_renamed_file(existing_dest_path, potential_new_path)
                            return

            log_message(f"Destination file missing. Re-processing: {src_file}", level="INFO")
        else:
            log_message(f"File already processed and exists. Source: {src_file}, Existing destination: {existing_dest_path}", level="INFO")
            return

    else:
        if not force:
            skip_reason = get_skip_reason(src_file)
            if skip_reason:
                return

    # Check if a symlink already exists in dest_index
    normalized_src_file = normalize_file_path(src_file)
    log_message(f"Checking dest_index for existing symlinks pointing to: {normalized_src_file}", level="DEBUG")

    existing_symlink = None
    for full_dest_file in dest_index:
        if os.path.islink(full_dest_file):
            try:
                link_target = normalize_file_path(os.readlink(full_dest_file))
                if link_target == normalized_src_file:
                    existing_symlink = full_dest_file
                    log_message(f"Found existing symlink in dest_index: {existing_symlink}", level="DEBUG")
                    break
            except (OSError, IOError):
                # Skip broken symlinks
                log_message(f"Skipping broken symlink in dest_index: {full_dest_file}", level="DEBUG")
                continue

    if existing_symlink and not force:
        log_message(f"Symlink already exists for {os.path.basename(file)}: {existing_symlink}", level="INFO")
        log_message(f"Adding existing symlink to database: {src_file} -> {existing_symlink}", level="DEBUG")
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
        log_message(f"Adding hash file without identifiers to database: {src_file} (reason: {reason})", level="DEBUG")
        save_processed_file(src_file, None, tmdb_id, season_number, reason)
        return

    # Initialize file_result to ensure it's always available
    file_result = None
    parent_result = None

    if force_show:
        is_show = True
        force_extra = True
        log_message(f"Processing as show based on Force Show flag: {file}", level="INFO")
        file_result = clean_query(file)
    elif force_movie:
        is_show = False
        log_message(f"Processing as movie based on Force Movie flag: {file}", level="INFO")
        file_result = clean_query(file)
    else:
        # Parse file first
        file_result = clean_query(file)

        # Check if file has episode information (standard TV format or anime episode number)
        has_episode_info = file_result.get('episode_identifier') or file_result.get('episode')

        # Only parse parent directory if file doesn't have episode info
        if not has_episode_info:
            parent_result = clean_query(os.path.basename(src_file))
            has_episode_info = parent_result.get('episode_identifier') or parent_result.get('episode')

        # Check for anime patterns using intelligent detection
        is_anime = (file_result.get('is_anime') or
                   (parent_result and parent_result.get('is_anime')) or
                   is_anime_file(file))

        if has_episode_info:
            if is_anime:
                is_anime_show = True
                log_message(f"Processing as anime show based on episode detection: {src_file}", level="DEBUG")
            else:
                is_show = True
                log_message(f"Processing as TV show based on episode detection: {src_file}", level="DEBUG")
        else:
            # No episode info found - check other indicators
            # Enhanced check: if folder name contains TV show indicators OR other files in folder are TV shows
            folder_name = os.path.basename(root)

            # First check folder name patterns
            tv_folder_patterns = [
                r'MINI[- ]?SERIES', r'LIMITED[- ]?SERIES', r'TV[- ]?SERIES',
                r'S\d{1,2}[EX]', r'Season\s+\d+', r'Complete\s+Series',
                r'\bS\d{1,2}\b', r'Season\.\d+', r'Series\s+\d+'
            ]
            is_tv_folder = any(re.search(pattern, folder_name, re.IGNORECASE) for pattern in tv_folder_patterns)

            if is_tv_folder:
                is_show = True
                log_message(f"Processing as show extra based on TV folder pattern: {file}", level="INFO")
                if file_result:
                    if not (file_result.get('episode_identifier') or (file_result.get('season_number') and file_result.get('episode_number'))):
                        file_result['is_extra'] = True
            else:
                # Fallback to legacy regex patterns for edge cases
                episode_match = re.search(r'(.*?)(S\d{1,2}\.?E\d{2}|S\d{1,2}\s*\d{2}|S\d{2}E\d{2}|S\d{2}e\d{2}|(?<!\d{3})\b[1-9][0-9]?x[0-9]{1,2}\b(?!\d{3})|[0-9]+e[0-9]+|\bep\.?\s*\d{1,2}\b|\bEp\.?\s*\d{1,2}\b|\bEP\.?\s*\d{1,2}\b|S\d{2}\sE\d{2}|MINI[- ]SERIES|MINISERIES|\s-\s(?!1080p|720p|480p|2160p|\d+Kbps|\d{4}|\d+bit|\d+\.?\d*[KMGT]B)\d{2,3}(?![Kbps\.\d]|[KMGT]B)|\s-(?!1080p|720p|480p|2160p|\d+Kbps|\d{4}|\d+bit|\d+\.?\d*[KMGT]B)\d{2,3}(?![Kbps\.\d]|[KMGT]B)|\s-\s*(?!1080p|720p|480p|2160p|\d+Kbps|\d{4}|\d+bit|\d+\.?\d*[KMGT]B)\d{2,3}(?![Kbps\.\d]|[KMGT]B)|[Ee]pisode\s*\d{2}|[Ee]p\s*\d{2}|Season_-\d{2}|\bSeason\d+\b|\bE\d+\b|series\.\d+\.\d+of\d+|Episode\s+(\d+)\s+(.*?)\.(\w+)|\b\d{2}x\d{2}\b)|\(S\d{1,2}\)', file, re.IGNORECASE)
                mini_series_match = re.search(r'(MINI[- ]SERIES|MINISERIES)', file, re.IGNORECASE)
                season_pattern = re.compile(r'\b[sS]\d{1,2}[eE]\d{1,2}\b', re.IGNORECASE)

                if season_pattern.search(src_file) or episode_match or mini_series_match:
                    is_show = True
                    log_message(f"Processing as show based on legacy pattern detection: {src_file}", level="DEBUG")

    # Check if the file should be considered an junk based on size
    if is_junk_file(file, src_file):
        log_message(f"Skipping Junk files: {file} based on size", level="DEBUG")
        reason = "File size below minimum threshold"
        log_message(f"Adding junk file to database: {src_file} (reason: {reason})", level="DEBUG")
        save_processed_file(src_file, None, tmdb_id, season_number, reason)
        return

    # Handle batch apply logic
    if not auto_select and not tmdb_id:
        if batch_apply:
            cached_tmdb_id, cached_show_name, cached_year = get_cached_selection()
            if cached_tmdb_id:
                log_message(f"Using cached selection for {file}: TMDB ID {cached_tmdb_id}", level="INFO")
                tmdb_id = cached_tmdb_id
                auto_select = True
        else:
            from MediaHub.api.tmdb_api import _api_cache, _cache_lock
            with _cache_lock:
                _api_cache.clear()
            log_message(f"Cleared TMDB cache for independent selection: {file}", level="DEBUG")

    # Determine whether to process as show or movie
    show_metadata = None
    if is_show or is_anime_show:
        metadata_to_pass = None
        if file_result and file_result.get('episode_identifier'):
            metadata_to_pass = file_result
        elif parent_result:
            metadata_to_pass = parent_result

        if force_extra and metadata_to_pass:
            if not (metadata_to_pass.get('episode_identifier') or (metadata_to_pass.get('season_number') and metadata_to_pass.get('episode_number'))):
                metadata_to_pass['is_extra'] = True

        result = process_show(src_file, root, file, dest_dir, actual_dir, tmdb_folder_id_enabled, rename_enabled, auto_select, dest_index, episode_match, tmdb_id=tmdb_id, imdb_id=imdb_id, tvdb_id=tvdb_id, season_number=season_number, episode_number=episode_number, is_anime_show=is_anime_show, force_extra=force_extra, file_metadata=metadata_to_pass, manual_search=manual_search)

        # Cache the first selection if batch_apply is enabled and this is the first manual selection
        if batch_apply and not first_selection_cache['is_cached'] and result and len(result) >= 2:
            result_tmdb_id = result[1]
            if result_tmdb_id:
                show_name = metadata_to_pass.get('title') if metadata_to_pass else None
                cache_first_selection(result_tmdb_id, show_name)
        if result is None or result[0] is None:
            log_message(f"Show processing failed or was skipped for {file}. Skipping symlink creation.", level="WARNING")
            reason = "Show processing failed or was skipped"
            log_message(f"Adding failed show processing to database: {src_file} (reason: {reason})", level="DEBUG")
            save_processed_file(src_file, None, tmdb_id, season_number, reason)
            if force and 'old_symlink_info' in locals():
                _cleanup_old_symlink(old_symlink_info)
            return

        # Handle show processor return format
        dest_file, tmdb_id, season_number, is_extra, media_type, proper_name, year, episode_number_str, imdb_id, is_anime_genre, is_kids_content = result
        # Convert string episode number back to int if needed
        if episode_number_str:
            try:
                episode_number = int(episode_number_str)
            except (ValueError, TypeError):
                episode_number = None

        # Skip symlink creation for extras unless skipped from env or user explicitly requested force_extra
        if is_extra and not user_requested_force_extra and is_skip_extras_folder_enabled():
            log_message(f"Skipping symlink creation for extra file: {file}", level="INFO")
            reason = "Extra/Special Content"
            log_message(f"Adding extra file to database: {src_file} (reason: {reason})", level="DEBUG")
            save_processed_file(src_file, None, tmdb_id, season_number, reason, None, None,
                              media_type, proper_name, year, episode_number_str, imdb_id, is_anime_genre)
            return
    else:
        result = process_movie(src_file, root, file, dest_dir, actual_dir, tmdb_folder_id_enabled, rename_enabled, auto_select, dest_index, tmdb_id=tmdb_id, imdb_id=imdb_id, file_metadata=file_result, manual_search=manual_search)

        # Check if result is None or the first item (dest_file) is None
        if result is None or result[0] is None:
            log_message(f"Movie processing failed or was skipped for {file}. Skipping symlink creation.", level="WARNING")
            reason = "Movie processing failed or was skipped"
            log_message(f"Adding failed movie processing to database: {src_file} (reason: {reason})", level="DEBUG")
            save_processed_file(src_file, None, tmdb_id, season_number, reason)
            if force and 'old_symlink_info' in locals():
                _cleanup_old_symlink(old_symlink_info)
            return

        # Handle movie processor return format
        dest_file, tmdb_id, media_type, proper_name, year, episode_number_str, imdb_id, is_anime_genre, is_kids_content = result

    if dest_file is None:
        log_message(f"Destination file path is None for {file}. Skipping.", level="WARNING")
        reason = "Missing destination path"
        log_message(f"Adding file with missing destination to database: {src_file} (reason: {reason})", level="DEBUG")
        save_processed_file(src_file, None, tmdb_id, season_number, reason)
        if force and 'old_symlink_info' in locals():
            _cleanup_old_symlink(old_symlink_info)
        return

    os.makedirs(os.path.dirname(dest_file), exist_ok=True)

    # Comprehensive check for existing symlinks in the destination directory
    dest_dir = os.path.dirname(dest_file)
    existing_symlink_for_source = None
    # normalized_src_file already defined above

    if os.path.exists(dest_dir):
        log_message(f"Checking destination directory for existing symlinks: {dest_dir}", level="DEBUG")
        for filename in os.listdir(dest_dir):
            potential_symlink = os.path.join(dest_dir, filename)
            if os.path.islink(potential_symlink):
                try:
                    link_target = normalize_file_path(os.readlink(potential_symlink))
                    log_message(f"Found symlink {potential_symlink} -> {link_target}", level="DEBUG")
                    if link_target == normalized_src_file:
                        existing_symlink_for_source = potential_symlink
                        log_message(f"Found existing symlink for source: {existing_symlink_for_source}", level="DEBUG")
                        break
                except (OSError, IOError):
                    # Skip broken symlinks
                    log_message(f"Skipping broken symlink: {potential_symlink}", level="DEBUG")
                    continue

    # Check if symlink already exists at the exact destination path
    if os.path.islink(dest_file):
        existing_src = normalize_file_path(os.readlink(dest_file))
        if existing_src == normalized_src_file:
            log_message(f"Symlink already exists and is correct: {dest_file} -> {src_file}", level="INFO")
            log_message(f"Adding correct existing symlink to database: {src_file} -> {dest_file}", level="DEBUG")
            save_processed_file(src_file, dest_file, tmdb_id, season_number, None, None, None,
                              media_type, proper_name, year, episode_number_str, imdb_id, is_anime_genre)
            return
        else:
            log_message(f"Updating existing symlink: {dest_file} -> {src_file} (was: {existing_src})", level="INFO")
            os.remove(dest_file)
    elif existing_symlink_for_source and existing_symlink_for_source != dest_file:
        # Found existing symlink for same source but with different name (rename scenario)
        if not force:
            # If not in force mode, check if this is just a rename case
            existing_name = os.path.basename(existing_symlink_for_source)
            new_name = os.path.basename(dest_file)
            log_message(f"Found existing symlink for source with different name: {existing_name} -> {new_name}", level="INFO")

            # If rename is enabled, we should update the symlink
            if rename_enabled:
                log_message(f"Renaming {existing_name}", level="INFO")
                log_message(f"Updating existing symlink: {dest_file} -> {src_file} (was: {existing_symlink_for_source})", level="INFO")
                os.remove(existing_symlink_for_source)
            else:
                # If rename is not enabled, keep the existing symlink
                log_message(f"Symlink already exists for source file: {existing_symlink_for_source}", level="INFO")
                log_message(f"Adding existing symlink to database (rename disabled): {src_file} -> {existing_symlink_for_source}", level="DEBUG")
                save_processed_file(src_file, existing_symlink_for_source, tmdb_id)
                return
        else:
            # In force mode, remove the old symlink
            log_message(f"Force mode: Removing existing symlink {existing_symlink_for_source} to create new one at {dest_file}", level="INFO")
            os.remove(existing_symlink_for_source)
    elif existing_symlink_for_source == dest_file:
        # This should have been caught by the first check, but just in case
        log_message(f"Symlink already exists and is correct: {dest_file} -> {src_file}", level="INFO")
        log_message(f"Adding correct symlink to database (fallback check): {src_file} -> {dest_file}", level="DEBUG")
        save_processed_file(src_file, dest_file, tmdb_id, season_number, None, None, None,
                          media_type, proper_name, year, episode_number_str, imdb_id, is_anime_genre)
        return

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
        dest_parts = normalize_file_path(dest_file).split(os.sep)
        is_tv_show = ("TV Shows" in dest_file or "Series" in dest_file or
                     season_number is not None or
                     any(part.lower().startswith('season ') for part in dest_parts) or
                     any(part.lower() == 'extras' for part in dest_parts))
        if is_tv_show:
            media_type = "tv"

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
        if show_metadata and media_type == "tv":
            structured_data.update({
                "show_name": show_metadata.get('show_name'),
                "proper_show_name": show_metadata.get('proper_show_name'),
                "episode_title": show_metadata.get('episode_title'),
                "year": show_metadata.get('year'),
                "is_anime_genre": show_metadata.get('is_anime_genre', False)
            })

        # Send structured data to WebDavHub API
        try:
            send_structured_message("symlink_created", structured_data)
        except Exception as e:
            log_message(f"Error sending symlink notification: {e}", level="DEBUG")

        log_message(f"Adding newly created symlink to database: {src_file} -> {dest_file}", level="DEBUG")
        save_processed_file(src_file, dest_file, tmdb_id, season_number, None, None, None,
                          media_type, proper_name, year, episode_number_str, imdb_id, is_anime_genre)

        # Cleanup old symlink if it exists (force mode)
        if force and 'old_symlink_info' in locals():
            _cleanup_old_symlink(old_symlink_info, dest_file)

        if plex_update() and plex_token():
            update_plex_after_symlink(dest_file)

        return (dest_file, True, src_file)

    except FileExistsError:
        log_message(f"File already exists: {dest_file}. Skipping symlink creation.", level="DEBUG")
        if force and 'old_symlink_info' in locals():
            _cleanup_old_symlink(old_symlink_info, dest_file)
    except OSError as e:
        log_message(f"Error creating symlink for {src_file}: {e}", level="ERROR")
        track_file_failure(src_file, tmdb_id, season_number, "Symlink creation error", f"Error creating symlink: {e}")
        if force and 'old_symlink_info' in locals():
            _cleanup_old_symlink(old_symlink_info, dest_file)
    except Exception as e:
        error_message = f"Task failed with exception: {e}\n{traceback.format_exc()}"
        log_message(error_message, level="ERROR")
        track_file_failure(src_file, tmdb_id, season_number, "Unexpected error", error_message)
        if force and 'old_symlink_info' in locals():
            _cleanup_old_symlink(old_symlink_info, dest_file)

    return None

def create_symlinks(src_dirs, dest_dir, auto_select=False, single_path=None, force=False, mode='create', tmdb_id=None, imdb_id=None, tvdb_id=None, force_show=False, force_movie=False, season_number=None, episode_number=None, force_extra=False, skip=False, batch_apply=False, manual_search=False):
    global log_imported_db

    if batch_apply:
        reset_first_selection_cache()
        log_message("Batch apply enabled - will cache first manual selection for subsequent files", level="INFO")
    else:
        reset_first_selection_cache()

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

    # Use single_path if provided, resolving symlinks first
    if single_path:
        original_single_path = single_path
        resolved_single_path = resolve_symlink_to_source(single_path)
        if resolved_single_path != original_single_path:
            log_message(f"Resolved symlink for single_path: {original_single_path} -> {resolved_single_path}", level="INFO")
        src_dirs = [resolved_single_path]

    # Fast path for single file processing - defer heavy operations
    is_single_file = single_path and os.path.isfile(single_path)

    # Only load processed files if not single file or if force mode is disabled
    processed_files_log = set() if is_single_file and force else load_processed_files()

    if auto_select:
        # Use thread pool for parallel processing when auto-select is enabled
        max_workers = get_max_processes()

        # Lazy-load destination index only when needed
        dest_index = None

        tasks = []
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            for src_dir in src_dirs:
                if os.path.isfile(src_dir):
                    src_file = src_dir
                    root = os.path.dirname(src_file)
                    file = os.path.basename(src_file)
                    actual_dir = os.path.basename(root)

                    # Skip metadata and auxiliary files
                    if should_skip_processing(file):
                        continue

                    # Skip destination index building for single files or force mode
                    if dest_index is None:
                        if is_single_file:
                            log_message("Single file mode - skipping destination index building for faster startup", level="INFO")
                            dest_index = set()  # Empty set for single file processing
                        elif force:
                            log_message("Force mode enabled - skipping destination index building for faster startup", level="INFO")
                            dest_index = set()  # Empty set when using force mode
                        else:
                            log_message("Building destination index...", level="INFO")
                            dest_index = (get_dest_index_from_db() if mode == 'monitor'
                                        else build_dest_index(dest_dir))

                    args = (src_file, root, file, dest_dir, actual_dir, tmdb_folder_id_enabled, rename_enabled, auto_select, dest_index, tmdb_id, imdb_id, tvdb_id, force_show, force_movie, season_number, episode_number, force_extra, skip, manual_search)
                    tasks.append(executor.submit(process_file, args, processed_files_log, force, batch_apply))
                else:
                    # Handle directory
                    actual_dir = os.path.basename(normalize_file_path(src_dir))
                    log_message(f"Scanning source directory: {src_dir} (actual: {actual_dir})", level="INFO")

                    # Skip destination index building for single files or force mode
                    if dest_index is None:
                        if is_single_file:
                            log_message("Single file mode - skipping destination index building for faster startup", level="INFO")
                            dest_index = set()  # Empty set for single file processing
                        elif force:
                            log_message("Force mode enabled - skipping destination index building for faster startup", level="INFO")
                            dest_index = set()  # Empty set when using force mode
                        else:
                            log_message("Building destination index...", level="INFO")
                            dest_index = (get_dest_index_from_db() if mode == 'monitor'
                                        else build_dest_index(dest_dir))

                    for root, _, files in os.walk(src_dir):
                        for file in files:
                            if error_event.is_set():
                                log_message("Stopping further processing due to an earlier error.", level="WARNING")
                                return

                            # Skip metadata and auxiliary files
                            if should_skip_processing(file):
                                continue

                            src_file = os.path.join(root, file)

                            # Fast database check for single files, use set for batch operations
                            if mode == 'create' and not force:
                                if is_single_file:
                                    if is_file_processed(src_file):
                                        continue
                                elif src_file in processed_files_log:
                                    continue

                            args = (src_file, root, file, dest_dir, actual_dir, tmdb_folder_id_enabled, rename_enabled, auto_select, dest_index, tmdb_id, imdb_id, tvdb_id, force_show, force_movie, season_number, episode_number, force_extra, skip, manual_search)
                            tasks.append(executor.submit(process_file, args, processed_files_log, force, batch_apply))

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
        dest_index = None  # Lazy-load destination index

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

                    # Skip metadata and auxiliary files
                    if should_skip_processing(file):
                        continue

                    # Skip destination index building for single files or force mode
                    if dest_index is None:
                        if is_single_file:
                            log_message("Single file mode - skipping destination index building for faster startup", level="INFO")
                            dest_index = set()  # Empty set for single file processing
                        elif force:
                            log_message("Force mode enabled - skipping destination index building for faster startup", level="INFO")
                            dest_index = set()  # Empty set when using force mode
                        else:
                            log_message("Building destination index...", level="INFO")
                            dest_index = (get_dest_index_from_db() if mode == 'monitor'
                                        else build_dest_index(dest_dir))

                    args = (src_file, root, file, dest_dir, actual_dir, tmdb_folder_id_enabled, rename_enabled, auto_select, dest_index, tmdb_id, imdb_id, tvdb_id, force_show, force_movie, season_number, episode_number, force_extra, skip, manual_search)
                    result = process_file(args, processed_files_log, force, batch_apply)

                    if result and isinstance(result, tuple) and len(result) == 3:
                        dest_file, is_symlink, target_path = result
                        if mode == 'monitor':
                            update_single_file_index(dest_file, is_symlink, target_path)
                else:
                    # Handle directory
                    actual_dir = os.path.basename(normalize_file_path(src_dir))
                    log_message(f"Scanning source directory: {src_dir} (actual: {actual_dir})", level="INFO")

                    # Skip destination index building for single files or force mode
                    if dest_index is None:
                        if is_single_file:
                            log_message("Single file mode - skipping destination index building for faster startup", level="INFO")
                            dest_index = set()  # Empty set for single file processing
                        elif force:
                            log_message("Force mode enabled - skipping destination index building for faster startup", level="INFO")
                            dest_index = set()  # Empty set when using force mode
                        else:
                            log_message("Building destination index...", level="INFO")
                            dest_index = (get_dest_index_from_db() if mode == 'monitor'
                                        else build_dest_index(dest_dir))

                    for root, _, files in os.walk(src_dir):
                        for file in files:
                            if error_event.is_set():
                                log_message("Stopping further processing due to an earlier error.", level="WARNING")
                                return

                            # Skip metadata and auxiliary files
                            if should_skip_processing(file):
                                continue

                            src_file = os.path.join(root, file)

                            # Fast database check for single files, use set for batch operations
                            if mode == 'create' and not force:
                                if is_single_file:
                                    if is_file_processed(src_file):
                                        continue
                                elif src_file in processed_files_log:
                                    continue

                            args = (src_file, root, file, dest_dir, actual_dir, tmdb_folder_id_enabled, rename_enabled, auto_select, dest_index, tmdb_id, imdb_id, tvdb_id, force_show, force_movie, season_number, episode_number, force_extra, skip, manual_search)
                            result = process_file(args, processed_files_log, force, batch_apply)

                            if result and isinstance(result, tuple) and len(result) == 3:
                                dest_file, is_symlink, target_path = result
                                if mode == 'monitor':
                                    update_single_file_index(dest_file, is_symlink, target_path)
            except Exception as e:
                log_message(f"Error processing directory {src_dir}: {str(e)}", level="ERROR")

    # Log completion message
    if is_single_file:
        log_message("Single file processing completed.", level="INFO")
    else:
        log_message("All files processed successfully.", level="INFO")
