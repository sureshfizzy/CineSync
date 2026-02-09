import os
import re
import traceback
import sqlite3
import time
import sys

base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '../..'))
sys.path.append(base_dir)

# Local imports from MediaHub
from concurrent.futures import ThreadPoolExecutor, as_completed
from multiprocessing import cpu_count
from threading import Event
from MediaHub.processors.movie_processor import process_movie
from MediaHub.processors.show_processor import process_show
from MediaHub.utils.logging_utils import log_message
from MediaHub.utils.global_events import shutdown_event
from MediaHub.utils.file_utils import build_dest_index, get_anime_patterns, get_symlink_target_path
from MediaHub.config.config import *
from MediaHub.processors.db_utils import *
from MediaHub.utils.plex_utils import *
from MediaHub.processors.symlink_utils import *
from MediaHub.processors.symlink_utils import _get_symlink_delete_behaviour, _safe_delete_symlink

def _should_cleanup_orphans():
    value = os.getenv('SYMLINK_CLEANUP_ORPHANS', 'true')
    return value.lower() in ['true', '1', 'yes']

def _cleanup_orphaned_db_entries():
    removed = 0
    try:
        with sqlite3.connect(DB_FILE) as conn1, sqlite3.connect(PROCESS_DB) as conn2:
            cursor1 = conn1.cursor()
            cursor2 = conn2.cursor()
            cursor1.execute("SELECT destination_path, file_path, tmdb_id, season_number FROM processed_files WHERE destination_path IS NOT NULL")
            rows = cursor1.fetchall()
            for dest_path, file_path, tmdb_id, season_number in rows:
                if not dest_path:
                    continue
                if os.path.lexists(dest_path):
                    continue
                log_message(f"Orphan cleanup: removing DB entry: {dest_path}", level="DEBUG")
                try:
                    send_file_deletion(file_path, dest_path, tmdb_id, season_number, "Destination missing during cleanup")
                except Exception:
                    pass
                if tmdb_id:
                    try:
                        cleanup_tmdb_covers(int(tmdb_id))
                    except Exception as e:
                        log_message(f"Failed to cleanup MediaCover for TMDB ID {tmdb_id}: {e}", level="WARNING")
                cursor1.execute("DELETE FROM processed_files WHERE destination_path = ?", (dest_path,))
                cursor2.execute("DELETE FROM file_index WHERE path = ?", (dest_path,))
                removed += 1
            conn1.commit()
            conn2.commit()
    except Exception as e:
        log_message(f"Error cleaning orphaned DB entries: {e}", level="ERROR")
    return removed

def run_symlink_cleanup(dest_dir):
    log_message(f"Starting broken symlink cleanup in directory: {dest_dir}", level="INFO")

    if not os.path.exists(dest_dir):
        log_message(f"Destination directory {dest_dir} does not exist!", level="ERROR")
        return

    while not shutdown_event.is_set():
        symlinks_deleted = False
        trash_mode = _get_symlink_delete_behaviour() == 'trash'
        for root, _, files in os.walk(dest_dir):
            for file in files:
                file_path = os.path.join(root, file)
                if os.path.islink(file_path):
                    try:
                        target = get_symlink_target_path(file_path)

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
                                        pass
                                except Exception as search_error:
                                    log_message(f"Error searching database: {str(search_error)}", level="ERROR")

                                # Use actual target if found, otherwise use the original target
                                removed_path = actual_target if actual_target else target
                                if trash_mode:
                                    _safe_delete_symlink(file_path)
                                else:
                                    delete_broken_symlinks(dest_dir, removed_path)
                            else:
                                log_message(f"Symlink not found in database, deleting directly: {file_path}", level="DEBUG")
                                try:
                                    _safe_delete_symlink(file_path)
                                    log_message(f"Manually deleted broken symlink: {file_path}", level="INFO")

                                    # Trigger Plex refresh for deletion
                                    try:
                                        update_plex_after_deletion(file_path)
                                    except Exception as plex_error:
                                        log_message(f"Error triggering Plex refresh for deletion: {plex_error}", level="DEBUG")
                                except Exception as rm_error:
                                    log_message(f"Error removing symlink: {str(rm_error)}", level="ERROR")
                    except Exception as e:
                        log_message(f"Error processing symlink {file_path}: {str(e)}", level="ERROR")
                        print(f"Exception details: {traceback.format_exc()}")

        if (not trash_mode) and _should_cleanup_orphans():
            orphaned_removed = _cleanup_orphaned_db_entries()
            if orphaned_removed:
                log_message(f"Removed {orphaned_removed} orphaned DB entries.", level="INFO")
        # Retrieve the cleanup interval
        try:
            cleanup_interval_str = os.getenv("SYMLINK_CLEANUP_INTERVAL", "600")
            cleanup_interval = int(cleanup_interval_str) if cleanup_interval_str and cleanup_interval_str.strip() else 600
        except (ValueError, TypeError):
            cleanup_interval = 600

        log_message(f"Sleeping Full broken symlink deletion for {cleanup_interval} seconds until next cleanup cycle.", level="DEBUG")
        shutdown_event.wait(cleanup_interval)
