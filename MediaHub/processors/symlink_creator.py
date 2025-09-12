import os
import platform
import re
import time
import traceback
import sqlite3
import json
import sys
import ctypes
import hashlib
import signal
import sys
from ctypes import wintypes
from threading import Thread
from queue import Queue, Empty
from threading import Thread, Event
from concurrent.futures import ThreadPoolExecutor, as_completed
from collections import defaultdict
from multiprocessing import cpu_count
from threading import Event
from MediaHub.processors.movie_processor import process_movie
from MediaHub.processors.show_processor import process_show
from MediaHub.utils.logging_utils import log_message
from MediaHub.utils.file_utils import build_dest_index, is_anime_file, should_skip_processing
from MediaHub.monitor.symlink_cleanup import run_symlink_cleanup
from MediaHub.utils.webdav_api import send_structured_message
from MediaHub.config.config import *
from MediaHub.processors.db_utils import *
from MediaHub.utils.plex_utils import *
from MediaHub.processors.process_db import *
from MediaHub.api.media_cover import cleanup_tmdb_covers
from MediaHub.processors.symlink_utils import *
from MediaHub.utils.webdav_api import send_structured_message
from MediaHub.utils.file_utils import clean_query, resolve_symlink_to_source
from MediaHub.utils.global_events import terminate_flag, error_event, shutdown_event, set_shutdown, is_shutdown_requested
from MediaHub.processors.db_utils import track_force_recreation
from MediaHub.processors.source_files_db import *
from MediaHub.processors.sports_processor import process_sports
from MediaHub.utils.file_utils import parse_media_file
from MediaHub.processors.sports_processor import is_sports_file

log_imported_db = False
db_initialized = False

class ProcessingManager:
    """Streaming manager that coordinates file processing with real-time analysis and dispatch"""

    def __init__(self, max_workers):
        self.max_workers = max_workers
        self.seen_destinations = set()
        self.processing_stats = {
            'total_files': 0,
            'files_processed': 0,
            'files_skipped': 0,
            'duplicate_destinations': 0
        }

    def should_process_file(self, task):
        """Quick check if file should be processed (streaming analysis)"""
        src_file, root, file, dest_dir, actual_dir, tmdb_folder_id_enabled, rename_enabled, auto_select, dest_index, tmdb_id, imdb_id, tvdb_id, force_show, force_movie, season_number, episode_number, force_extra, skip, manual_search, reverse_index, processed_files_set = task

        self.processing_stats['total_files'] += 1

        # Generate destination key for this file
        dest_key = self._generate_destination_key(file, dest_dir, force_show, force_movie)

        # Check if we've already seen this destination
        if dest_key in self.seen_destinations:
            self.processing_stats['files_skipped'] += 1
            self.processing_stats['duplicate_destinations'] += 1
            return False

        # Mark this destination as seen
        self.seen_destinations.add(dest_key)
        self.processing_stats['files_processed'] += 1
        return True

    def _generate_destination_key(self, filename, dest_dir, force_show, force_movie):
        """Generate a key that represents the likely destination path"""
        # Extract title and year for grouping
        from MediaHub.utils.file_utils import clean_query

        try:
            parsed = clean_query(filename)
            title = parsed.get('title', filename)
            year = parsed.get('year', '')
            episode_identifier = parsed.get('episode_identifier', '')

            # Create a normalized key
            if force_show or episode_identifier:
                media_type = "show"
                dest_key = f"{media_type}_{title}_{year}_{episode_identifier}".lower()
            elif force_movie:
                media_type = "movie"
                dest_key = f"{media_type}_{title}_{year}".lower()
            else:
                media_type = "movie"
                dest_key = f"{media_type}_{title}_{year}".lower()

            dest_key = re.sub(r'[^\w\s-]', '', dest_key).strip()
            dest_key = re.sub(r'[-\s]+', '_', dest_key)

            return dest_key

        except Exception as e:
            return hashlib.md5(filename.encode()).hexdigest()[:16]

    def process_files_truly_parallel(self, src_dirs, dest_dir, tmdb_folder_id_enabled, rename_enabled, auto_select, tmdb_id, imdb_id, tvdb_id, force_show, force_movie, season_number, episode_number, force_extra, skip, manual_search, mode, force, batch_apply, is_single_file, use_source_db=True):
        """Smart parallel processing: pre-filter unprocessed files only"""
        log_message(f"Manager: Starting smart parallel processing with {self.max_workers} workers", level="INFO")

        if not force:
            try:
                from MediaHub.processors.db_utils import get_dest_index_from_processed_files
                dest_index, reverse_index, processed_files_set = get_dest_index_from_processed_files()
                log_message(f"Loaded database: {len(dest_index)} destinations, {len(reverse_index)} symlinks, {len(processed_files_set)} processed files", level="INFO")
            except Exception as e:
                log_message(f"Failed to load database: {e}", level="WARNING")
                dest_index, reverse_index, processed_files_set = set(), {}, set()
        else:
            dest_index, reverse_index, processed_files_set = set(), {}, set()

        log_message("Pre-filtering: Finding unprocessed files only...", level="INFO")
        unprocessed_files = self._find_unprocessed_files_only(src_dirs, processed_files_set, mode, force, is_single_file, use_source_db)

        if not unprocessed_files:
            log_message("Smart filtering complete: No unprocessed files found. All files are already processed!", level="INFO")
            return []

        log_message(f"Smart filtering complete: Found {len(unprocessed_files)} unprocessed files (skipped {len(processed_files_set)} already processed)", level="INFO")

        results = []
        active_futures = {}

        executor = None
        try:
            executor = ThreadPoolExecutor(max_workers=self.max_workers)

            for src_file in unprocessed_files:
                if is_shutdown_requested():
                    log_message("Manager: Stopping due to shutdown request", level="WARNING")
                    break

                future = executor.submit(self._process_unprocessed_file, src_file, dest_dir, tmdb_folder_id_enabled, rename_enabled, auto_select, tmdb_id, imdb_id, tvdb_id, force_show, force_movie, season_number, episode_number, force_extra, skip, manual_search, mode, force, batch_apply, is_single_file, dest_index, reverse_index)
                active_futures[future] = src_file

            completed_count = 0
            total_futures = len(active_futures)

            while active_futures and not is_shutdown_requested():
                try:
                    done_futures = []
                    for future in list(active_futures.keys()):
                        try:
                            if future.done():
                                done_futures.append(future)
                        except Exception:
                            done_futures.append(future)

                    # Process completed futures
                    for future in done_futures:
                        try:
                            result = future.result(timeout=0.1)
                            if result:
                                results.extend(result if isinstance(result, list) else [result])
                            completed_count += 1
                            if completed_count % 5 == 0:
                                log_message(f"Manager: Completed {completed_count}/{total_futures} tasks", level="INFO")
                        except Exception as e:
                            src_path = active_futures[future]
                            log_message(f"Manager: Worker failed processing {src_path}: {str(e)}", level="ERROR")
                        finally:
                            del active_futures[future]

                    # Short sleep to allow signal handling
                    import time
                    time.sleep(0.1)

                except KeyboardInterrupt:
                    set_shutdown()
                    break

        except KeyboardInterrupt:
            set_shutdown()
        except Exception as e:
            set_shutdown()
        finally:
            if executor:
                try:
                    # Cancel all pending futures
                    for future in active_futures.keys():
                        future.cancel()
                    executor.shutdown(wait=False)
                except Exception:
                    pass

            if is_shutdown_requested():
                log_message("Manager: Processing interrupted by shutdown request", level="INFO")
                return results

        log_message(f"Manager: Smart parallel processing complete. Processed {completed_count} files", level="DEBUG")

        if not is_shutdown_requested():
            missed_files = self._verify_and_find_missed_files(unprocessed_files, mode, force)
            if missed_files:
                log_message(f"Found {len(missed_files)} files missed. Processing them sequentially...", level="DEBUG")
                retry_results = self._process_missed_files_sequentially(missed_files, dest_dir, tmdb_folder_id_enabled, rename_enabled, auto_select, tmdb_id, imdb_id, tvdb_id, force_show, force_movie, season_number, episode_number, force_extra, skip, manual_search, mode, force, batch_apply, is_single_file, dest_index, reverse_index)
                results.extend(retry_results)
                log_message(f"Retry processing complete. Additional {len(retry_results)} files processed", level="DEBUG")

        return results

    def _verify_and_find_missed_files(self, original_unprocessed_files, mode, force):
        from MediaHub.processors.db_utils import load_processed_files, normalize_file_path

        updated_processed_files_set = load_processed_files()

        missed_files = []
        for src_file in original_unprocessed_files:
            if is_shutdown_requested():
                break

            normalized_src = normalize_file_path(src_file)
            if mode == 'create' and not force:
                if normalized_src not in updated_processed_files_set:
                    missed_files.append(src_file)

        return missed_files

    def _process_missed_files_sequentially(self, missed_files, dest_dir, tmdb_folder_id_enabled, rename_enabled, auto_select, tmdb_id, imdb_id, tvdb_id, force_show, force_movie, season_number, episode_number, force_extra, skip, manual_search, mode, force, batch_apply, is_single_file, dest_index, reverse_index):
        results = []

        for src_file in missed_files:
            if is_shutdown_requested():
                break

            try:
                file = os.path.basename(src_file)
                dest_key = self._generate_destination_key(file, dest_dir, force_show, force_movie)
                if dest_key in self.seen_destinations:
                    self.seen_destinations.remove(dest_key)

                result = self._process_unprocessed_file(src_file, dest_dir, tmdb_folder_id_enabled, rename_enabled, auto_select, tmdb_id, imdb_id, tvdb_id, force_show, force_movie, season_number, episode_number, force_extra, skip, manual_search, mode, force, batch_apply, is_single_file, dest_index, reverse_index)

                if result:
                    results.extend(result if isinstance(result, list) else [result])

            except Exception as e:
                log_message(f"Failed to retry process missed file {src_file}: {str(e)}", level="ERROR")

        return results

    def _find_unprocessed_files_only(self, src_dirs, processed_files_set, mode, force, is_single_file, use_source_db=True):
        """Pre-filter to find only unprocessed files - MUCH faster than scanning everything"""
        from MediaHub.processors.db_utils import normalize_file_path

        unprocessed_files = []
        total_scanned = 0
        total_skipped = 0

        if use_source_db and mode == 'create' and not force and not is_single_file:
            try:
                if check_source_db_availability():
                    log_message("Using source files database to find unprocessed files", level="INFO")

                    source_db_files = get_unprocessed_files_from_source_db()

                    if source_db_files:
                        for src_file in source_db_files:
                            if is_shutdown_requested():
                                break

                            file_in_src_dirs = False
                            for src_dir in src_dirs:
                                if src_file.startswith(os.path.normpath(src_dir)):
                                    file_in_src_dirs = True
                                    break

                            if not file_in_src_dirs:
                                continue

                            if not os.path.exists(src_file):
                                continue

                            normalized_src = normalize_file_path(src_file)
                            if processed_files_set and normalized_src in processed_files_set:
                                total_skipped += 1
                                continue

                            if should_skip_processing(os.path.basename(src_file)):
                                continue

                            unprocessed_files.append(src_file)
                            total_scanned += 1

                        log_message(f"Source DB scan complete: {total_scanned} files from source DB, {len(unprocessed_files)} need processing, {total_skipped} already processed", level="INFO")
                        return unprocessed_files
                    else:
                        log_message("No unprocessed files found in source database, falling back to filesystem scan", level="INFO")
                else:
                    log_message("Source files database not available, using filesystem scan", level="DEBUG")
            except Exception as e:
                log_message(f"Error accessing source files database, falling back to filesystem scan: {e}", level="WARNING")

        log_message("Using filesystem scan to find unprocessed files", level="INFO")

        for src_dir in src_dirs:
            if is_shutdown_requested():
                break

            if os.path.isfile(src_dir):
                total_scanned += 1
                file = os.path.basename(src_dir)

                if should_skip_processing(file):
                    continue

                # Check if already processed
                if mode == 'create' and not force:
                    normalized_src = normalize_file_path(src_dir)
                    if processed_files_set and normalized_src in processed_files_set:
                        total_skipped += 1
                        continue

                unprocessed_files.append(src_dir)

            else:
                for root, _, files in os.walk(src_dir):
                    for file in files:
                        if is_shutdown_requested():
                            break

                        total_scanned += 1

                        if should_skip_processing(file):
                            continue

                        src_file = os.path.join(root, file)

                        if mode == 'create' and not force:
                            normalized_src = normalize_file_path(src_file)
                            if processed_files_set and normalized_src in processed_files_set:
                                total_skipped += 1
                                continue

                        unprocessed_files.append(src_file)

                        if total_scanned % BATCH_SIZE == 0:
                            log_message(f"Smart scan progress: {total_scanned} files scanned, {len(unprocessed_files)} need processing, {total_skipped} already processed", level="DEBUG")

        log_message(f"Filesystem scan complete: {total_scanned} files scanned, {len(unprocessed_files)} need processing, {total_skipped} already processed", level="INFO")
        return unprocessed_files

    def _process_unprocessed_file(self, src_file, dest_dir, tmdb_folder_id_enabled, rename_enabled, auto_select, tmdb_id, imdb_id, tvdb_id, force_show, force_movie, season_number, episode_number, force_extra, skip, manual_search, mode, force, batch_apply, is_single_file, dest_index, reverse_index):
        """Process a file that's guaranteed to need processing - no filtering needed!"""
        root = os.path.dirname(src_file)
        file = os.path.basename(src_file)
        actual_dir = os.path.basename(root)

        # Check for early termination
        if is_shutdown_requested():
            return None

        # Quick destination check for duplicate prevention
        dest_key = self._generate_destination_key(file, dest_dir, force_show, force_movie)
        if dest_key in self.seen_destinations:
            return None

        self.seen_destinations.add(dest_key)

        # Process the file directly 
        args = (src_file, root, file, dest_dir, actual_dir, tmdb_folder_id_enabled, rename_enabled, auto_select, dest_index, tmdb_id, imdb_id, tvdb_id, force_show, force_movie, season_number, episode_number, force_extra, skip, manual_search, reverse_index, set())
        return process_file(args, force, batch_apply)

    def _process_single_file(self, src_file, dest_dir, tmdb_folder_id_enabled, rename_enabled, auto_select, tmdb_id, imdb_id, tvdb_id, force_show, force_movie, season_number, episode_number, force_extra, skip, manual_search, mode, force, batch_apply, is_single_file, processed_files_set, dest_index, reverse_index):
        """Process a single file in a worker thread"""
        root = os.path.dirname(src_file)
        file = os.path.basename(src_file)
        actual_dir = os.path.basename(root)

        if is_shutdown_requested():
            return None

        if should_skip_processing(file):
            return None

        if mode == 'create' and not force:
            from MediaHub.processors.db_utils import normalize_file_path
            normalized_src = normalize_file_path(src_file)
            if processed_files_set and normalized_src in processed_files_set:
                return None

        dest_key = self._generate_destination_key(file, dest_dir, force_show, force_movie)
        if dest_key in self.seen_destinations:
            return None

        self.seen_destinations.add(dest_key)

        args = (src_file, root, file, dest_dir, actual_dir, tmdb_folder_id_enabled, rename_enabled, auto_select, dest_index, tmdb_id, imdb_id, tvdb_id, force_show, force_movie, season_number, episode_number, force_extra, skip, manual_search, reverse_index, processed_files_set)
        return process_file(args, force, batch_apply)

    def _process_directory(self, src_dir, dest_dir, tmdb_folder_id_enabled, rename_enabled, auto_select, tmdb_id, imdb_id, tvdb_id, force_show, force_movie, season_number, episode_number, force_extra, skip, manual_search, mode, force, batch_apply, is_single_file, processed_files_set, dest_index, reverse_index):
        """Process all files in a directory in a worker thread"""
        from MediaHub.processors.db_utils import normalize_file_path

        results = []
        actual_dir = os.path.basename(normalize_file_path(src_dir))

        for root, _, files in os.walk(src_dir):
            for file in files:
                if is_shutdown_requested():
                    log_message(f"Worker: Stopping directory scan due to shutdown request", level="DEBUG")
                    break

                # Skip metadata and auxiliary files
                if should_skip_processing(file):
                    continue

                src_file = os.path.join(root, file)

                # Check if file was already processed
                if mode == 'create' and not force:
                    normalized_src = normalize_file_path(src_file)
                    if processed_files_set and normalized_src in processed_files_set:
                        continue

                # Quick destination check
                dest_key = self._generate_destination_key(file, dest_dir, force_show, force_movie)
                if dest_key in self.seen_destinations:
                    continue

                self.seen_destinations.add(dest_key)

                # Process the file with shared data
                args = (src_file, root, file, dest_dir, actual_dir, tmdb_folder_id_enabled, rename_enabled, auto_select, dest_index, tmdb_id, imdb_id, tvdb_id, force_show, force_movie, season_number, episode_number, force_extra, skip, manual_search, reverse_index, processed_files_set)
                result = process_file(args, force, batch_apply)
                if result:
                    results.append(result)

        return results

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

def process_file(args, force=False, batch_apply=False):
    src_file, root, file, dest_dir, actual_dir, tmdb_folder_id_enabled, rename_enabled, auto_select, dest_index, tmdb_id, imdb_id, tvdb_id, force_show, force_movie, season_number, episode_number, force_extra, skip, manual_search, reverse_index, processed_files_set = args

    if is_shutdown_requested():
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

        # Get TMDB ID before removing from database for MediaCover cleanup
        existing_tmdb_id = None
        try:
            with sqlite3.connect(DB_FILE) as conn:
                cursor = conn.cursor()
                cursor.execute("SELECT tmdb_id FROM processed_files WHERE file_path = ?", (src_file,))
                result = cursor.fetchone()
                if result and result[0]:
                    existing_tmdb_id = result[0]
        except Exception as e:
            log_message(f"Error getting TMDB ID for MediaCover cleanup: {e}", level="WARNING")

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

                # Remove the symlink
                os.remove(existing_dest_path)
                log_message(f"Skip mode: Removed existing symlink for {file}", level="INFO")

                # Cleanup MediaCover if TMDB ID exists
                if existing_tmdb_id:
                    try:
                        cleanup_tmdb_covers(int(existing_tmdb_id))
                    except Exception as e:
                        log_message(f"Failed to cleanup MediaCover for TMDB ID {existing_tmdb_id}: {e}", level="WARNING")

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
        save_processed_file(src_file, None, tmdb_id, season_number, reason, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None)
        return

    # Skip metadata and auxiliary files
    if should_skip_processing(file):
        reason = "File skipped - metadata or auxiliary file"
        log_message(f"Skipping metadata/auxiliary file: {file} ({reason})", level="DEBUG")
        log_message(f"Adding metadata/auxiliary file to database: {src_file} (reason: {reason})", level="DEBUG")
        save_processed_file(src_file, None, tmdb_id, season_number, reason, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None)
        return

    # Check for unsupported file type
    if not get_known_types(file):
        reason = "Unsupported file type"
        log_message(f"Skipping file: {file} ({reason})", level="INFO")
        log_message(f"Adding unsupported file to database: {src_file} (reason: {reason})", level="DEBUG")
        save_processed_file(src_file, None, tmdb_id, season_number, reason, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None)
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

    # Check if a symlink already exists using reverse index (O(1) lookup instead of O(n) loop)
    normalized_src_file = normalize_file_path(src_file)
    log_message(f"Checking reverse index for existing symlinks pointing to: {normalized_src_file}", level="DEBUG")

    # Use reverse index if available, otherwise skip this check (for single file/force mode)
    existing_symlink = None
    if reverse_index:
        existing_symlink = reverse_index.get(normalized_src_file)

    if existing_symlink and not force:
        log_message(f"Found existing symlink in reverse index: {existing_symlink}", level="DEBUG")
        log_message(f"Symlink already exists for {os.path.basename(file)}: {existing_symlink}", level="INFO")
        log_message(f"Adding existing symlink to database: {src_file} -> {existing_symlink}", level="DEBUG")
        save_processed_file(src_file, existing_symlink, tmdb_id, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None)
        return

    # Show detection logic
    is_show = False
    is_anime_show = False
    episode_match = None

    # Skip hash filenames unless they have valid media patterns or folder name can be parsed
    hash_pattern = re.compile(r'^[a-f0-9]{32}(\.[^.]+$|\[.+?\]\.)', re.IGNORECASE)
    is_hash_name = hash_pattern.search(file) is not None

    if is_hash_name and not tmdb_id and not imdb_id:
        # Try to extract media information from parent folder name
        folder_name = os.path.basename(os.path.dirname(src_file))
        folder_result = clean_query(folder_name)
        folder_title = folder_result.get('title', '').strip()

        if folder_title and len(folder_title) > 2:
            log_message(f"Hash file {file} will use folder name for identification: {folder_title}", level="INFO")
        else:
            log_message(f"Skipping file with hash lacking media identifiers: {file}", level="INFO")
            reason = "Missing media identifiers on hash file"
            log_message(f"Adding hash file without identifiers to database: {src_file} (reason: {reason})", level="DEBUG")
            save_processed_file(src_file, None, tmdb_id, season_number, reason, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None)
            return

    # Initialize file_result to ensure it's always available
    file_result = None
    parent_result = None

    # Parse file first for TV/Movie detection
    file_result = clean_query(file)

    # For hash files, always parse parent folder and prioritize its results
    if is_hash_name:
        parent_result = clean_query(os.path.basename(os.path.dirname(src_file)))
        log_message(f"Hash file detected, using folder metadata: {os.path.basename(os.path.dirname(src_file))}", level="DEBUG")

    if force_show:
        is_show = True
        log_message(f"Processing as show based on Force Show flag: {file}", level="INFO")
    elif force_movie:
        is_show = False
        log_message(f"Processing as movie based on Force Movie flag: {file}", level="INFO")
    else:
        # Check if file has episode information (standard TV format or anime episode number)
        has_episode_info = file_result.get('episode_identifier') or file_result.get('episode')

        # Parse parent directory if file doesn't have episode info
        if not has_episode_info or is_hash_name:
            if not parent_result:
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
                log_message(f"Processing as show based on TV folder pattern: {file}", level="INFO")
                if file_result:
                    # Check if file has episode info
                    file_has_episode_info = file_result.get('episode_identifier') or (file_result.get('season_number') and file_result.get('episode_number'))
                    if not file_has_episode_info:
                        # Check if folder has episode information that can be inherited
                        folder_result = clean_query(folder_name)
                        folder_has_episode_info = folder_result.get('episode_identifier') or (folder_result.get('season_number') and folder_result.get('episode_number'))
                        if folder_has_episode_info:
                            log_message(f"Inheriting episode info from folder for file: {file}", level="DEBUG")
                            file_result.update({k: v for k, v in folder_result.items()
                                              if k in ['episode_identifier', 'season_number', 'episode_number', 'season', 'episode'] and v})
                            file_result['is_extra'] = False
                        else:
                            file_result['is_extra'] = True
            else:
                # Fallback to legacy regex patterns for edge cases
                episode_match = re.search(r'(.*?)(S\d{1,2}\.?E\d{2}|(?<![A-Z])\bS\d{1,2}\s*\d{2}\b|S\d{2}E\d{2}|S\d{2}e\d{2}|(?<!\d{3})\b[1-9][0-9]?x[0-9]{1,2}\b(?!\d{3})|[0-9]+e[0-9]+|\bep\.?\s*\d{1,2}\b|\bEp\.?\s*\d{1,2}\b|\bEP\.?\s*\d{1,2}\b|S\d{2}\sE\d{2}|MINI[- ]SERIES|MINISERIES|\s-\s(?!1080p|720p|480p|2160p|\d+Kbps|\d{4}|\d+bit|\d+\.?\d*[KMGT]B)\d{2,3}(?![Kbps\.\d]|[KMGT]B)|\s-(?!1080p|720p|480p|2160p|\d+Kbps|\d{4}|\d+bit|\d+\.?\d*[KMGT]B)\d{2,3}(?![Kbps\.\d]|[KMGT]B)|\s-\s*(?!1080p|720p|480p|2160p|\d+Kbps|\d{4}|\d+bit|\d+\.?\d*[KMGT]B)\d{2,3}(?![Kbps\.\d]|[KMGT]B)|[Ee]pisode\s*\d{2}|[Ee]p\s*\d{2}|Season_-\d{2}|\bSeason\d+\b|\bE\d+\b(?![A-Z])|series\.\d+\.\d+of\d+|Episode\s+(\d+)\s+(.*?)\.(\w+)|\b\d{2}x\d{2}\b)|\(S\d{1,2}\)', file, re.IGNORECASE)
                mini_series_match = re.search(r'(MINI[- ]SERIES|MINISERIES)', file, re.IGNORECASE)
                season_pattern = re.compile(r'\b[sS]\d{1,2}[eE]\d{1,2}\b', re.IGNORECASE)

                if season_pattern.search(src_file) or episode_match or mini_series_match:
                    is_show = True
                    log_message(f"Processing as show based on legacy pattern detection: {src_file}", level="DEBUG")


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

    # Check if sports was processed successfully
    if 'is_sports_processed' in locals() and is_sports_processed and result and result[0]:
        if len(result) >= 17:
            dest_file, tmdb_id, media_type, proper_name, year, episode_number_str, imdb_id, is_anime_genre, is_kids_content, language, quality, sport_name, sport_round, sport_location, sport_session, sport_venue, sport_date = result
        else:
            dest_file, tmdb_id, media_type, proper_name, year, episode_number_str, imdb_id, is_anime_genre, is_kids_content, language, quality = result
            sport_name = sport_round = sport_location = sport_session = sport_venue = sport_date = None
    else:
        show_metadata = None
        is_sports_content = False

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
                log_message(f"Show processing failed for {file}. Skipping symlink creation.", level="WARNING")
                if not is_file_processed(src_file):
                    reason = "Show processing failed"
                    log_message(f"Adding failed show processing to database: {src_file} (reason: {reason})", level="DEBUG")
                    save_processed_file(src_file, None, tmdb_id, season_number, reason, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None)
                if force and 'old_symlink_info' in locals():
                    _cleanup_old_symlink(old_symlink_info)
                return
            elif result[0] == "SKIP_EXTRA":
                existing_dest_path = get_destination_path(src_file)
                if existing_dest_path:
                    existing_dest_path = normalize_file_path(existing_dest_path)
                    log_message(f"Found existing symlink for file now classified as extra: {src_file} -> {existing_dest_path}", level="INFO")

                    old_symlink_info = {
                        'path': existing_dest_path,
                        'parent_dir': os.path.dirname(existing_dest_path),
                        'parent_parent_dir': os.path.dirname(os.path.dirname(existing_dest_path))
                    }

                    try:
                        if os.path.exists(existing_dest_path):
                            os.remove(existing_dest_path)
                            log_message(f"Removed existing symlink for file now classified as extra: {existing_dest_path}", level="INFO")

                        if tmdb_id:
                            try:
                                cleanup_tmdb_covers(int(tmdb_id))
                            except Exception as e:
                                log_message(f"Failed to cleanup MediaCover for TMDB ID {tmdb_id}: {e}", level="WARNING")

                        if os.path.exists(old_symlink_info['parent_dir']) and not os.listdir(old_symlink_info['parent_dir']):
                            log_message(f"Deleting empty directory: {old_symlink_info['parent_dir']}", level="INFO")
                            os.rmdir(old_symlink_info['parent_dir'])

                            if os.path.exists(old_symlink_info['parent_parent_dir']) and not os.listdir(old_symlink_info['parent_parent_dir']):
                                log_message(f"Deleting empty directory: {old_symlink_info['parent_parent_dir']}", level="INFO")
                                os.rmdir(old_symlink_info['parent_parent_dir'])
                    except OSError as e:
                        log_message(f"Error during extra file cleanup: {e}", level="WARNING")

                reason = "Extra file skipped - size below limit threshold"
                log_message(f"Adding skipped extra file to database: {src_file} (reason: {reason})", level="DEBUG")
                save_processed_file(src_file, None, tmdb_id, season_number, reason, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None)
                return

            # Handle show processor return format
            if len(result) >= 25:
                dest_file, tmdb_id, season_number, is_extra, media_type, proper_name, year, episode_number_str, imdb_id, is_anime_genre, is_kids_content, language, quality, tvdb_id, original_language, overview, runtime, original_title, status, first_air_date, last_air_date, genres, certification, episode_title, total_episodes = result

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
                save_processed_file(
                    src_file, None, tmdb_id, season_number, reason, None, None,
                    media_type, proper_name, year, episode_number_str, imdb_id, is_anime_genre, 
                    language, quality, tvdb_id,
                    # Sports metadata (None for shows)
                    None, None, None, None, None, None, None, None,
                    # Show/Movie metadata
                    original_language, overview, runtime, original_title, status, None, first_air_date, last_air_date, genres, certification,
                    episode_title, total_episodes
                )
                return

            show_processed = True
        else:
            # Check for sports content before falling back to movie processing
            is_sports_content = is_sports_file(file)
            show_processed = False

        if not show_processed and is_sports_content:
            log_message(f"No TV show patterns found, detected sports content: {file}", level="INFO")
            sports_metadata = {'is_sports': True}
            result = process_sports(src_file, root, file, dest_dir, actual_dir, tmdb_folder_id_enabled, rename_enabled, auto_select, dest_index, sports_metadata=sports_metadata, manual_search=manual_search)

            if result and result[0]:
                if len(result) >= 23:
                    dest_file, tmdb_id, media_type, proper_name, year, episode_number_str, imdb_id, is_anime_genre, is_kids_content, language, quality, tvdb_id, league_id, sportsdb_event_id, sport_name, sport_round, sport_location, sport_session, sport_venue, sport_city, sport_country, sport_time, sport_date = result
                elif len(result) >= 19:
                    dest_file, tmdb_id, media_type, proper_name, year, episode_number_str, imdb_id, is_anime_genre, is_kids_content, language, quality, tvdb_id, league_id, sportsdb_event_id, sport_name, sport_round, sport_location, sport_session, sport_venue, sport_date = result
                    sport_city = sport_country = sport_time = None
                elif len(result) >= 18:
                    dest_file, sportsdb_event_id, media_type, proper_name, year, episode_number_str, imdb_id, is_anime_genre, is_kids_content, language, quality, tvdb_id, sportsdb_event_id_dup, sport_name, sport_round, sport_location, sport_session, sport_venue, sport_date = result
                    # Use sportsdb_event_id as tmdb_id for sports content (legacy format)
                    tmdb_id = sportsdb_event_id
                    league_id = None
                elif len(result) >= 17:
                    dest_file, tmdb_id, media_type, proper_name, year, episode_number_str, imdb_id, is_anime_genre, is_kids_content, language, quality, sport_name, sport_round, sport_location, sport_session, sport_venue, sport_date = result
                    sport_city = sport_country = sport_time = None
                else:
                    dest_file, tmdb_id, media_type, proper_name, year, episode_number_str, imdb_id, is_anime_genre, is_kids_content, language, quality = result
                    sport_name = sport_round = sport_location = sport_session = sport_venue = sport_date = None
                    sport_city = sport_country = sport_time = None
                is_sports_processed = True
            else:
                log_message(f"Sports processing failed for {file}, falling back to movie processing", level="WARNING")
                # Don't pass TV show TMDB ID to movie processor
                metadata_for_movie = parent_result if is_hash_name and parent_result else file_result
                result = process_movie(src_file, root, file, dest_dir, actual_dir, tmdb_folder_id_enabled, rename_enabled, auto_select, dest_index, tmdb_id=None, imdb_id=None, file_metadata=metadata_for_movie, manual_search=manual_search)

                # Check if movie processing failed
                if result is None or result[0] is None:
                    log_message(f"Movie processing failed for {file}. Skipping symlink creation.", level="WARNING")
                    if not is_file_processed(src_file):
                        reason = "Movie processing failed"
                        log_message(f"Adding failed movie processing to database: {src_file} (reason: {reason})", level="DEBUG")
                        save_processed_file(src_file, None, tmdb_id, season_number, reason)
                    if force and 'old_symlink_info' in locals():
                        _cleanup_old_symlink(old_symlink_info)
                    return
                elif result[0] == "SKIP_EXTRA":
                    reason = "Extra file skipped - size below limit threshold"
                    log_message(f"Adding skipped extra file to database: {src_file} (reason: {reason})", level="DEBUG")
                    save_processed_file(src_file, None, tmdb_id, season_number, reason)
                    return
                # Handle movie processor return format
                if len(result) >= 18:
                    dest_file, tmdb_id, media_type, proper_name, year, episode_number_str, imdb_id, is_anime_genre, is_kids_content, language, quality, original_language, overview, runtime, original_title, status, release_date, genres, certification = result[:19]

        elif not show_processed:
            # Not sports content, process as movie
            # For hash files, use parent folder metadata instead of file metadata
            metadata_for_movie = parent_result if is_hash_name and parent_result else file_result
            result = process_movie(src_file, root, file, dest_dir, actual_dir, tmdb_folder_id_enabled, rename_enabled, auto_select, dest_index, tmdb_id=tmdb_id, imdb_id=imdb_id, file_metadata=metadata_for_movie, manual_search=manual_search)

            # Check if result is None or the first item (dest_file) is None
            if result is None or result[0] is None:
                log_message(f"Movie processing failed for {file}. Skipping symlink creation.", level="WARNING")
                if not is_file_processed(src_file):
                    reason = "Movie processing failed"
                    log_message(f"Adding failed movie processing to database: {src_file} (reason: {reason})", level="DEBUG")
                    save_processed_file(src_file, None, tmdb_id, season_number, reason, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None)
                if force and 'old_symlink_info' in locals():
                    _cleanup_old_symlink(old_symlink_info)
                return
            elif result[0] == "SKIP_EXTRA":
                existing_dest_path = get_destination_path(src_file)
                if existing_dest_path:
                    existing_dest_path = normalize_file_path(existing_dest_path)
                    log_message(f"Found existing symlink for file now classified as extra: {src_file} -> {existing_dest_path}", level="INFO")

                    old_symlink_info = {
                        'path': existing_dest_path,
                        'parent_dir': os.path.dirname(existing_dest_path),
                        'parent_parent_dir': os.path.dirname(os.path.dirname(existing_dest_path))
                    }

                    try:
                        if os.path.exists(existing_dest_path):
                            os.remove(existing_dest_path)
                            log_message(f"Removed existing symlink for file now classified as extra: {existing_dest_path}", level="INFO")

                        if tmdb_id:
                            try:
                                cleanup_tmdb_covers(int(tmdb_id))
                            except Exception as e:
                                log_message(f"Failed to cleanup MediaCover for TMDB ID {tmdb_id}: {e}", level="WARNING")

                        if os.path.exists(old_symlink_info['parent_dir']) and not os.listdir(old_symlink_info['parent_dir']):
                            log_message(f"Deleting empty directory: {old_symlink_info['parent_dir']}", level="INFO")
                            os.rmdir(old_symlink_info['parent_dir'])

                            if os.path.exists(old_symlink_info['parent_parent_dir']) and not os.listdir(old_symlink_info['parent_parent_dir']):
                                log_message(f"Deleting empty directory: {old_symlink_info['parent_parent_dir']}", level="INFO")
                                os.rmdir(old_symlink_info['parent_parent_dir'])
                    except OSError as e:
                        log_message(f"Error during extra file cleanup: {e}", level="WARNING")

                reason = "Extra file skipped - size below limit threshold"
                log_message(f"Adding skipped extra file to database: {src_file} (reason: {reason})", level="DEBUG")
                save_processed_file(src_file, None, tmdb_id, season_number, reason, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None)
                return

            # Handle movie processor return format
            if len(result) >= 18:
                dest_file, tmdb_id, media_type, proper_name, year, episode_number_str, imdb_id, is_anime_genre, is_kids_content, language, quality, original_language, overview, runtime, original_title, status, release_date, genres, certification = result[:19]

    if dest_file is None:
        log_message(f"Destination file path is None for {file}. Skipping.", level="WARNING")
        reason = "Missing destination path"
        log_message(f"Adding file with missing destination to database: {src_file} (reason: {reason})", level="DEBUG")
        save_processed_file(src_file, None, tmdb_id, season_number, reason, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None)
        if force and 'old_symlink_info' in locals():
            _cleanup_old_symlink(old_symlink_info)
        return

    os.makedirs(os.path.dirname(dest_file), exist_ok=True)

    # Comprehensive check for existing symlinks in the destination directory
    dest_dir = os.path.dirname(dest_file)
    existing_symlink_for_source = None

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

    # If we found an existing symlink for the same source, handle it first
    if existing_symlink_for_source and existing_symlink_for_source != dest_file:
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
                # For sports content, check SportsDB event ID instead of TMDB ID
                if media_type == 'Sports':
                    has_complete_metadata = bool(tmdb_id and media_type and proper_name and year)  # tmdb_id contains sportsdb_event_id for sports
                else:
                    has_complete_metadata = bool(tmdb_id and media_type and proper_name and year)

                if has_complete_metadata:
                    log_message(f"Symlink already exists for source file: {existing_symlink_for_source}", level="INFO")
                    log_message(f"Adding existing symlink to database (rename disabled): {src_file} -> {existing_symlink_for_source}", level="DEBUG")
                    # Save to database with all available metadata
                    save_processed_file(
                        src_file, existing_symlink_for_source, tmdb_id, season_number, None, None, None,
                        media_type, proper_name, year, episode_number_str, imdb_id, is_anime_genre, 
                        language, quality, tvdb_id,
                        # Sports metadata (None if not sports)
                        league_id if 'league_id' in locals() else None,
                        sportsdb_event_id if 'sportsdb_event_id' in locals() else None,
                        sport_name if 'sport_name' in locals() else None,
                        sport_round if 'sport_round' in locals() else None,
                        sport_location if 'sport_location' in locals() else None,
                        sport_session if 'sport_session' in locals() else None,
                        sport_venue if 'sport_venue' in locals() else None,
                        sport_city if 'sport_city' in locals() else None,
                        sport_country if 'sport_country' in locals() else None,
                        sport_time if 'sport_time' in locals() else None,
                        sport_date if 'sport_date' in locals() else None,
                        # Movie metadata (None if not movie)
                        original_language if 'original_language' in locals() else None,
                        overview if 'overview' in locals() else None,
                        runtime if 'runtime' in locals() else None,
                        original_title if 'original_title' in locals() else None,
                        status if 'status' in locals() else None,
                        release_date if 'release_date' in locals() else None,
                        first_air_date if 'first_air_date' in locals() else None,
                        last_air_date if 'last_air_date' in locals() else None,
                        genres if 'genres' in locals() else None,
                        certification if 'certification' in locals() else None,
                        episode_title if 'episode_title' in locals() else None,
                        total_episodes if 'total_episodes' in locals() else None
                    )
                    return
                else:
                    log_message(f"Existing symlink found but metadata incomplete (rename disabled) - processing to extract metadata: {existing_symlink_for_source}", level="INFO")
        else:
            # In force mode, check if rename is enabled
            if rename_enabled:
                existing_name = os.path.basename(existing_symlink_for_source)
                new_name = os.path.basename(dest_file)
                log_message(f"Force mode with rename enabled: Found existing symlink for source with different name: {existing_name} -> {new_name}", level="INFO")
                os.remove(existing_symlink_for_source)
            else:
                existing_name = os.path.basename(existing_symlink_for_source)
                new_name = os.path.basename(dest_file)
                log_message(f"Force mode with rename disabled: Found existing symlink for source with different name: {existing_name} -> {new_name}", level="INFO")
                os.remove(existing_symlink_for_source)
    elif existing_symlink_for_source == dest_file:
        # For sports content, check SportsDB event ID instead of TMDB ID
        if media_type == 'Sports':
            has_complete_metadata = bool(tmdb_id and media_type and proper_name and year)  # tmdb_id contains sportsdb_event_id for sports
        else:
            has_complete_metadata = bool(tmdb_id and media_type and proper_name and year)

        if has_complete_metadata:
            log_message(f"Symlink already exists and is correct: {dest_file} -> {src_file}", level="INFO")
            log_message(f"Adding correct symlink to database (fallback check): {src_file} -> {dest_file}", level="DEBUG")

            # Save to database with all available metadata
            save_processed_file(
                src_file, dest_file, tmdb_id, season_number, None, None, None,
                media_type, proper_name, year, episode_number_str, imdb_id, is_anime_genre, 
                language, quality, tvdb_id,
                # Sports metadata (None if not sports)
                league_id if 'league_id' in locals() else None,
                sportsdb_event_id if 'sportsdb_event_id' in locals() else None,
                sport_name if 'sport_name' in locals() else None,
                sport_round if 'sport_round' in locals() else None,
                sport_location if 'sport_location' in locals() else None,
                sport_session if 'sport_session' in locals() else None,
                sport_venue if 'sport_venue' in locals() else None,
                sport_city if 'sport_city' in locals() else None,
                sport_country if 'sport_country' in locals() else None,
                sport_time if 'sport_time' in locals() else None,
                sport_date if 'sport_date' in locals() else None,
                # Movie metadata (None if not movie)
                original_language if 'original_language' in locals() else None,
                overview if 'overview' in locals() else None,
                runtime if 'runtime' in locals() else None,
                original_title if 'original_title' in locals() else None,
                status if 'status' in locals() else None,
                release_date if 'release_date' in locals() else None,
                first_air_date if 'first_air_date' in locals() else None,
                last_air_date if 'last_air_date' in locals() else None,
                genres if 'genres' in locals() else None,
                certification if 'certification' in locals() else None,
                episode_title if 'episode_title' in locals() else None,
                total_episodes if 'total_episodes' in locals() else None
            )
            return
        else:
            log_message(f"Symlink exists but metadata incomplete (fallback) - processing to extract metadata: {dest_file} -> {src_file}", level="INFO")

    # Check if symlink already exists at the exact destination path
    if os.path.islink(dest_file):
        existing_src = normalize_file_path(os.readlink(dest_file))
        if existing_src == normalized_src_file:
            # For sports content, check SportsDB event ID instead of TMDB ID
            if media_type == 'Sports':
                last_air_date if 'last_air_date' in locals() else None,
                has_complete_metadata = bool(tmdb_id and media_type and proper_name and year)  # tmdb_id contains sportsdb_event_id for sports
            else:
                has_complete_metadata = bool(tmdb_id and media_type and proper_name and year)

            if has_complete_metadata:
                log_message(f"Symlink already exists and is correct: {dest_file} -> {src_file}", level="INFO")
                log_message(f"Adding correct existing symlink to database: {src_file} -> {dest_file}", level="DEBUG")

                # Save to database with all available metadata  
                save_processed_file(
                    src_file, dest_file, tmdb_id, season_number, None, None, None,
                    media_type, proper_name, year, episode_number_str, imdb_id, is_anime_genre, 
                    language, quality, tvdb_id,
                    # Sports metadata (None if not sports)
                    league_id if 'league_id' in locals() else None,
                    sportsdb_event_id if 'sportsdb_event_id' in locals() else None,
                    sport_name if 'sport_name' in locals() else None,
                    sport_round if 'sport_round' in locals() else None,
                    sport_location if 'sport_location' in locals() else None,
                    sport_session if 'sport_session' in locals() else None,
                    sport_venue if 'sport_venue' in locals() else None,
                    sport_date if 'sport_date' in locals() else None,
                    # Movie metadata (None if not movie)
                    original_language if 'original_language' in locals() else None,
                    overview if 'overview' in locals() else None,
                    runtime if 'runtime' in locals() else None,
                    original_title if 'original_title' in locals() else None,
                    status if 'status' in locals() else None,
                    release_date if 'release_date' in locals() else None,
                    first_air_date if 'first_air_date' in locals() else None,
                    last_air_date if 'last_air_date' in locals() else None,
                    genres if 'genres' in locals() else None,
                    certification if 'certification' in locals() else None,
                    episode_title if 'episode_title' in locals() else None,
                    total_episodes if 'total_episodes' in locals() else None
                )
                return
            else:
                log_message(f"Symlink exists but metadata incomplete - processing to extract metadata: {dest_file} -> {src_file}", level="INFO")
        else:
            # Instead of overwriting, create a versioned name for the new symlink
            log_message(f"Symlink exists but points to different source, creating versioned name", level="INFO")
            # The version numbering will be handled later in the code


    if os.path.exists(dest_file) and not os.path.islink(dest_file):
        log_message(f"File already exists at destination: {os.path.basename(dest_file)}", level="INFO")
        return

    # Check for filename conflicts and generate unique filename if needed
    original_dest_file = dest_file
    dest_file = generate_unique_filename(dest_file, src_file)
    
    if dest_file != original_dest_file:
        log_message(f"Filename conflict detected, using versioned name: {os.path.basename(dest_file)}", level="INFO")

    # Create symlink
    try:
        os.symlink(src_file, dest_file)
        log_message(f"Created symlink: {dest_file} -> {src_file}", level="INFO")
        log_message(f"Processed file: {src_file} to {dest_file}", level="INFO")

        # Extract media information for structured message
        new_folder_name = os.path.basename(os.path.dirname(dest_file))
        new_filename = os.path.basename(dest_file)

        # Determine media type based on folder structures
        if not media_type or media_type == "Unknown":
            media_type = "movie"
            dest_parts = normalize_file_path(dest_file).split(os.sep)
            is_tv_show = ("TV Shows" in dest_file or "Series" in dest_file or
                         season_number is not None or
                         any(part.lower().startswith('season ') for part in dest_parts) or
                         any(part.lower() == 'extras' for part in dest_parts))
            if is_tv_show:
                media_type = "tv"

        # Normalize media_type casing to ensure downstream checks work consistently
        media_type = (media_type or "").lower()

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
                "season_number": show_metadata.get('season_number'),
                "episode_number": show_metadata.get('episode_number'),
                "episode_identifier": show_metadata.get('episode_identifier'),
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

        # Save to database with all available metadata
        save_processed_file(
            src_file, dest_file, tmdb_id, season_number, None, None, None,
            media_type, proper_name, year, episode_number_str, imdb_id, is_anime_genre, 
            language, quality, tvdb_id, 
            # Sports metadata (None if not sports)
            league_id if 'league_id' in locals() else None,
            sportsdb_event_id if 'sportsdb_event_id' in locals() else None,
            sport_name if 'sport_name' in locals() else None,
            sport_round if 'sport_round' in locals() else None,
            sport_location if 'sport_location' in locals() else None,
            sport_session if 'sport_session' in locals() else None,
            sport_venue if 'sport_venue' in locals() else None,
            sport_city if 'sport_city' in locals() else None,
            sport_country if 'sport_country' in locals() else None,
            sport_time if 'sport_time' in locals() else None,
            sport_date if 'sport_date' in locals() else None,
            # Movie metadata (None if not movie)
            original_language if 'original_language' in locals() else None,
            overview if 'overview' in locals() else None,
            runtime if 'runtime' in locals() else None,
            original_title if 'original_title' in locals() else None,
            status if 'status' in locals() else None,
            release_date if 'release_date' in locals() else None,
            first_air_date if 'first_air_date' in locals() else None,
            last_air_date if 'last_air_date' in locals() else None,
            genres if 'genres' in locals() else None,
            certification if 'certification' in locals() else None,
            episode_title if 'episode_title' in locals() else None,
            total_episodes if 'total_episodes' in locals() else None
        )

        # Handle cache updates for force mode vs normal mode
        if force and 'old_symlink_info' in locals() and old_symlink_info:
            try:
                old_dest_path = old_symlink_info.get('path')
                old_proper_name = old_symlink_info.get('proper_name')
                old_year = old_symlink_info.get('year')

                track_force_recreation(
                    source_path=src_file,
                    new_dest_path=dest_file,
                    new_tmdb_id=tmdb_id,
                    new_season_number=season_number,
                    new_proper_name=proper_name,
                    new_year=year,
                    new_media_type=media_type,
                    old_dest_path=old_dest_path,
                    old_proper_name=old_proper_name,
                    old_year=old_year
                )
            except Exception as e:
                log_message(f"Error updating cache for force recreation: {e}", level="DEBUG")

            _cleanup_old_symlink(old_symlink_info, dest_file)
        else:
            try:
                track_file_addition(src_file, dest_file, tmdb_id, season_number)
            except Exception as e:
                log_message(f"Error updating cache for new symlink: {e}", level="DEBUG")

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

def signal_handler(signum, frame):
    """Handle Ctrl+C gracefully"""
    log_message("Received interrupt signal, stopping all processing...", level="WARNING")
    set_shutdown()
    # Don't call sys.exit(0) here - let the main thread handle cleanup

def create_symlinks(src_dirs, dest_dir, auto_select=False, single_path=None, force=False, mode='create', tmdb_id=None, imdb_id=None, tvdb_id=None, force_show=False, force_movie=False, season_number=None, episode_number=None, force_extra=False, skip=False, batch_apply=False, manual_search=False, use_source_db=True):
    """Create symlinks for media files from source directories to destination directory.

    Args:
        use_source_db: If True, use source files database to find unprocessed files (default: True)
    """
    global log_imported_db

    # Only set up signal handlers if we're in the main thread
    # This prevents "signal only works in main thread" errors when called from worker threads
    try:
        import threading
        if threading.current_thread() is threading.main_thread():
            signal.signal(signal.SIGINT, signal_handler)
            if hasattr(signal, 'SIGTERM'):
                signal.signal(signal.SIGTERM, signal_handler)
    except Exception as e:
        log_message(f"Could not set up signal handlers in create_symlinks: {e}", level="DEBUG")

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

    # Log source database status
    if use_source_db:
        if check_source_db_availability():
            unprocessed_count = get_unprocessed_files_count()
            log_message(f"Source files database available with {unprocessed_count} unprocessed files", level="INFO")
        else:
            log_message("Source files database not available, will use filesystem scanning", level="INFO")
    else:
        log_message("Source files database disabled, using filesystem scanning", level="INFO")

    # Use single_path if provided, resolving symlinks first
    if single_path:
        original_single_path = single_path
        resolved_single_path = resolve_symlink_to_source(single_path)
        if resolved_single_path != original_single_path:
            log_message(f"Resolved symlink for single_path: {original_single_path} -> {resolved_single_path}", level="INFO")
        src_dirs = [resolved_single_path]

    # Fast path for single file processing
    is_single_file = single_path and os.path.isfile(single_path)

    if auto_select:
        # Use manager-coordinated parallel processing when auto-select is enabled
        max_workers = get_max_processes()

        # Initialize processing manager
        manager = ProcessingManager(max_workers)
        log_message(f"Initialized ProcessingManager with {max_workers} workers", level="INFO")

        # Initialize destination index
        dest_index = None
        reverse_index = {}
        processed_files_set = set()

        # Manager: Scan and process simultaneously
        try:
            results = manager.process_files_truly_parallel(src_dirs, dest_dir, tmdb_folder_id_enabled, rename_enabled, auto_select, tmdb_id, imdb_id, tvdb_id, force_show, force_movie, season_number, episode_number, force_extra, skip, manual_search, mode, force, batch_apply, is_single_file, use_source_db)

            # Process results
            for result in results:
                if result and isinstance(result, tuple) and len(result) == 3:
                    dest_file, is_symlink, target_path = result
                    if mode == 'monitor':
                        update_single_file_index(dest_file, is_symlink, target_path)

            # Show completion message
            if is_shutdown_requested():
                log_message("Processing interrupted by shutdown request", level="INFO")
            else:
                if is_single_file:
                    log_message("Single file processing completed.", level="INFO")
                else:
                    log_message("All files processed successfully.", level="INFO")

        except KeyboardInterrupt:
            log_message("Processing interrupted by user (Ctrl+C)", level="INFO")
            return

    else:
        dest_index = None

        for src_dir in src_dirs:
            if is_shutdown_requested():
                log_message("Stopping further processing due to shutdown request.", level="WARNING")
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
                            dest_index = set()
                            reverse_index = {}
                            processed_files_set = set()
                        elif force:
                            log_message("Force mode enabled - skipping destination index building for faster startup", level="INFO")
                            dest_index = set()
                            reverse_index = {}
                            processed_files_set = set()
                        else:
                            log_message("Loading destination index from database...", level="INFO")
                            if mode == 'monitor':
                                dest_index = get_dest_index_from_db()
                                reverse_index = {}
                                processed_files_set = set()
                            else:
                                dest_index, reverse_index, processed_files_set = get_dest_index_from_processed_files()

                    args = (src_file, root, file, dest_dir, actual_dir, tmdb_folder_id_enabled, rename_enabled, auto_select, dest_index, tmdb_id, imdb_id, tvdb_id, force_show, force_movie, season_number, episode_number, force_extra, skip, manual_search, reverse_index, processed_files_set)
                    result = process_file(args, force, batch_apply)

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
                            dest_index = set()
                            reverse_index = {}
                            processed_files_set = set()
                        elif force:
                            log_message("Force mode enabled - skipping destination index building for faster startup", level="INFO")
                            dest_index = set()
                            reverse_index = {}
                            processed_files_set = set()
                        else:
                            log_message("Loading destination index from database...", level="INFO")
                            if mode == 'monitor':
                                dest_index = get_dest_index_from_db()
                                reverse_index = {}
                                processed_files_set = set()
                            else:
                                dest_index, reverse_index, processed_files_set = get_dest_index_from_processed_files()

                    for root, _, files in os.walk(src_dir):
                        for file in files:
                            if is_shutdown_requested():
                                log_message("Stopping further processing due to shutdown request.", level="WARNING")
                                return

                            # Skip metadata and auxiliary files
                            if should_skip_processing(file):
                                continue

                            src_file = os.path.join(root, file)

                            # Fast check using processed files set and reverse index
                            if mode == 'create' and not force:
                                if is_single_file:
                                    if is_file_processed(src_file):
                                        continue
                                else:
                                    normalized_src = normalize_file_path(src_file)
                                    if processed_files_set and normalized_src in processed_files_set:
                                        continue
                                    else:
                                        log_message(f"File not in processed files set, will process: {src_file}", level="DEBUG")

                            args = (src_file, root, file, dest_dir, actual_dir, tmdb_folder_id_enabled, rename_enabled, auto_select, dest_index, tmdb_id, imdb_id, tvdb_id, force_show, force_movie, season_number, episode_number, force_extra, skip, manual_search, reverse_index, processed_files_set)
                            result = process_file(args, force, batch_apply)

                            if result and isinstance(result, tuple) and len(result) == 3:
                                dest_file, is_symlink, target_path = result
                                if mode == 'monitor':
                                    update_single_file_index(dest_file, is_symlink, target_path)
            except Exception as e:
                log_message(f"Error processing directory {src_dir}: {str(e)}", level="ERROR")