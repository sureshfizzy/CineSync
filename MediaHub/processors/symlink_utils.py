import os
import platform
import sqlite3
import subprocess
import json
import sys
import time
from MediaHub.utils.logging_utils import log_message
from MediaHub.config.config import *
from MediaHub.processors.db_utils import *
from MediaHub.processors.process_db import *
from MediaHub.utils.webdav_api import send_structured_message

def delete_broken_symlinks(dest_dir, removed_path=None):
    """Delete broken symlinks in the destination directory and update databases.

    Args:
        dest_dir: The destination directory containing symlinks
        removed_path: Optional path of the removed file/folder to check
    """
    # Ensure database tables exist
    try:
        with sqlite3.connect(PROCESS_DB) as conn:
            cursor = conn.cursor()
            # Create file_index table if it doesn't exist
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS file_index (
                    path TEXT PRIMARY KEY,
                    is_symlink BOOLEAN,
                    target_path TEXT,
                    last_modified TIMESTAMP
                )
            ''')
            conn.commit()
    except sqlite3.Error as e:
        return False

    symlinks_deleted = False

    if removed_path:
        # Normalize the removed path and handle spaces
        removed_path = os.path.normpath(removed_path)
        log_message(f"Processing removed path: {removed_path}", level="DEBUG")

        try:
            # Handle both databases in a single transaction
            with sqlite3.connect(DB_FILE) as conn1, sqlite3.connect(PROCESS_DB) as conn2:
                cursor1 = conn1.cursor()
                cursor2 = conn2.cursor()

                # Check if this is a directory
                is_directory = removed_path.endswith(']') or os.path.isdir(removed_path)

                if is_directory:
                    log_message(f"Processing directory removal: {removed_path}", level="INFO")

                    # Find the exact path to search for
                    exact_path = removed_path
                    # Also search for paths that might be inside this directory
                    directory_path = f"{removed_path}/%"

                    log_message(f"Using search patterns: exact={exact_path}, directory={directory_path}", level="DEBUG")

                    # Query file_index table ONLY
                    log_message("Querying file_index table for matching paths", level="DEBUG")
                    cursor2.execute("""
                        SELECT path, target_path
                        FROM file_index
                        WHERE target_path = ? OR target_path LIKE ?
                    """, (exact_path, directory_path))
                    file_index_results = cursor2.fetchall()
                    log_message(f"Found {len(file_index_results)} matching entries in file_index", level="DEBUG")

                    # Process only file_index results
                    all_paths = set()
                    for symlink_path, source_path in file_index_results:
                        if symlink_path:
                            if search_database_silent and callable(search_database_silent):
                                is_valid = search_database_silent(symlink_path)
                                if not is_valid:
                                    log_message(f"Skipping non-symlink entry: {symlink_path}", level="DEBUG")
                                    continue

                            cursor1.execute("""
                                SELECT tmdb_id, season_number
                                FROM processed_files
                                WHERE file_path = ?
                            """, (source_path,))
                            meta_result = cursor1.fetchone()
                            tmdb_id = meta_result[0] if meta_result and meta_result[0] else None
                            season_number = meta_result[1] if meta_result and len(meta_result) > 1 else None

                            all_paths.add((source_path, symlink_path, tmdb_id, season_number))
                            log_message(f"Added from file_index: source={source_path}, symlink={symlink_path}, tmdb_id={tmdb_id}, season_number={season_number}", level="DEBUG")

                    if not all_paths:
                        log_message(f"No symlinks found for directory: {removed_path}", level="WARNING")
                        # Try to find by searching file contents in the directory
                        log_message("Searching for files inside the directory that might have symlinks", level="INFO")

                        # Try to list contents if directory still exists
                        try:
                            if os.path.exists(removed_path) and os.path.isdir(removed_path):
                                for root, _, files in os.walk(removed_path):
                                    for file in files:
                                        file_path = os.path.join(root, file)
                                        log_message(f"Checking for symlinks for file: {file_path}", level="DEBUG")

                                        # Query only file_index for symlinks
                                        cursor2.execute("""
                                            SELECT path, target_path
                                            FROM file_index
                                            WHERE target_path = ?
                                        """, (file_path,))
                                        file_results = cursor2.fetchall()

                                        for symlink_path, source_path in file_results:
                                            # Verify if this is a valid symlink entry
                                            if search_database_silent and callable(search_database_silent):
                                                is_valid = search_database_silent(symlink_path)
                                                if not is_valid:
                                                    continue

                                            cursor1.execute("""
                                                SELECT tmdb_id, season_number
                                                FROM processed_files
                                                WHERE file_path = ?
                                            """, (source_path,))
                                            meta_result = cursor1.fetchone()
                                            tmdb_id = meta_result[0] if meta_result and meta_result[0] else None
                                            season_number = meta_result[1] if meta_result and len(meta_result) > 1 else None

                                            if symlink_path:
                                                all_paths.add((source_path, symlink_path, tmdb_id, season_number))
                                                log_message(f"Found symlink for file: source={source_path}, symlink={symlink_path}, tmdb_id={tmdb_id}, season_number={season_number}", level="INFO")
                        except Exception as e:
                            log_message(f"Error exploring directory contents: {e}", level="WARNING")

                    for item in all_paths:
                        source_path, symlink_path = item[0], item[1]
                        tmdb_id = item[2] if len(item) > 2 else None
                        season_number = item[3] if len(item) > 3 else None

                        log_message(f"Processing symlink pair: source={source_path}, symlink={symlink_path}, tmdb_id={tmdb_id}, season_number={season_number}", level="INFO")

                        if symlink_path is None or not symlink_path:
                            log_message(f"Skipping empty symlink path for source: {source_path}", level="WARNING")
                            continue

                        # Check if the symlink exists by using proper shell-compatible path
                        safe_path = symlink_path
                        try:
                            if os.path.lexists(safe_path):
                                if os.path.islink(safe_path):
                                    try:
                                        target = os.readlink(safe_path)
                                        log_message(f"Found symlink {safe_path} pointing to: {target}", level="DEBUG")

                                        log_message(f"Deleting symlink: {safe_path}, tmdb_id={tmdb_id}, season_number={season_number}", level="INFO")
                                        os.remove(safe_path)
                                        symlinks_deleted = True

                                        # Remove from both databases
                                        log_message(f"Removing entry from processed_files: {symlink_path}", level="DEBUG")
                                        cursor1.execute("DELETE FROM processed_files WHERE destination_path = ?", (symlink_path,))

                                        log_message(f"Removing entry from file_index: {symlink_path}", level="DEBUG")
                                        cursor2.execute("DELETE FROM file_index WHERE path = ?", (symlink_path,))

                                        _cleanup_empty_dirs(os.path.dirname(safe_path))
                                    except OSError as e:
                                        log_message(f"Error handling symlink {safe_path}: {e}", level="ERROR")
                                else:
                                    log_message(f"Path exists but is not a symlink: {safe_path}", level="WARNING")

                                    log_message(f"Cleaning up non-symlink entry from databases: {symlink_path}", level="INFO")
                                    cursor1.execute("DELETE FROM processed_files WHERE destination_path = ?", (symlink_path,))
                                    cursor2.execute("DELETE FROM file_index WHERE path = ?", (symlink_path,))
                            else:
                                # Second attempt: Try running an external command to check if file exists
                                log_message(f"Path not found with os.path.lexists, trying alternative check for: {safe_path}", level="DEBUG")

                                try:
                                    result = subprocess.run(['ls', safe_path], stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
                                    if result.returncode == 0:
                                        log_message(f"File found with ls command: {safe_path}", level="INFO")
                                        log_message(f"Trying to delete symlink using rm command: {safe_path}, tmdb_id={tmdb_id}, season_number={season_number}", level="INFO")
                                        rm_result = subprocess.run(['rm', safe_path], stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)

                                        if rm_result.returncode == 0:
                                            log_message(f"Successfully deleted symlink using rm command: {safe_path}", level="INFO")
                                            symlinks_deleted = True

                                            # Remove from both databases
                                            log_message(f"Removing entry from processed_files: {symlink_path}", level="DEBUG")
                                            cursor1.execute("DELETE FROM processed_files WHERE destination_path = ?", (symlink_path,))

                                            log_message(f"Removing entry from file_index: {symlink_path}", level="DEBUG")
                                            cursor2.execute("DELETE FROM file_index WHERE path = ?", (symlink_path,))

                                            # Clean up empty directories
                                            try:
                                                _cleanup_empty_dirs(os.path.dirname(safe_path))
                                            except Exception as e:
                                                log_message(f"Error cleaning up directories: {e}", level="WARNING")
                                        else:
                                            log_message(f"Failed to delete symlink using rm command: {safe_path}. Error: {rm_result.stderr.decode()}", level="ERROR")
                                    else:
                                        log_message(f"File not found with ls command either: {safe_path}", level="WARNING")
                                        log_message(f"Cleaning up non-existent path from databases: {symlink_path}", level="INFO")
                                        cursor1.execute("SELECT file_path, tmdb_id, season_number FROM processed_files WHERE destination_path = ?", (symlink_path,))
                                        result = cursor1.fetchone()
                                        if result:
                                            source_path, tmdb_id, season_number = result
                                            track_file_deletion(source_path, symlink_path, tmdb_id, season_number, "Symlink path not found")
                                        cursor1.execute("DELETE FROM processed_files WHERE destination_path = ?", (symlink_path,))
                                        cursor2.execute("DELETE FROM file_index WHERE path = ?", (symlink_path,))
                                except Exception as e:
                                    log_message(f"Error checking file with subprocess: {e}", level="ERROR")
                        except Exception as e:
                            log_message(f"Error checking path existence: {e}", level="ERROR")

                else:
                    # Handle single file removal
                    log_message(f"Processing single file removal: {removed_path}", level="DEBUG")

                    # Query only file_index
                    cursor2.execute("SELECT path, target_path FROM file_index WHERE target_path = ?", (removed_path,))
                    file_index_results = cursor2.fetchall()

                    if not file_index_results:
                        pattern = f"{removed_path}%"
                        cursor2.execute("SELECT path, target_path FROM file_index WHERE target_path LIKE ?", (pattern,))
                        file_index_pattern_results = cursor2.fetchall()
                        file_index_results = file_index_pattern_results

                    # Process database-tracked symlinks
                    all_paths = set()
                    for symlink_path, target_path in file_index_results:
                        if symlink_path:
                            if search_database_silent and callable(search_database_silent):
                                is_valid = search_database_silent(symlink_path)
                                if not is_valid:
                                        continue

                            cursor1.execute("""
                                SELECT tmdb_id, season_number
                                FROM processed_files
                                WHERE file_path = ?
                            """, (target_path,))
                            meta_result = cursor1.fetchone()
                            tmdb_id = meta_result[0] if meta_result and meta_result[0] else None
                            season_number = meta_result[1] if meta_result and len(meta_result) > 1 else None

                            all_paths.add((target_path, symlink_path, tmdb_id, season_number))
                            log_message(f"Found in file_index: target={target_path}, symlink={symlink_path}, tmdb_id={tmdb_id}, season_number={season_number}", level="DEBUG")

                    # If no symlinks found in database, check if destination file exists and should be removed
                    if not all_paths:

                        cursor1.execute("SELECT destination_path FROM processed_files WHERE file_path = ?", (removed_path,))
                        processed_file_result = cursor1.fetchone()

                        if processed_file_result and processed_file_result[0]:
                            possible_dest_path = processed_file_result[0]
                            log_message(f"Found destination in processed_files: {possible_dest_path}", level="DEBUG")
                        else:
                            # If not in processed_files, use search_database_silent if available
                            if search_database_silent and callable(search_database_silent):
                                try:
                                    # Call search_database_silent with the correct parameters
                                    search_results = search_database_silent(removed_path)

                                    possible_dest_paths = []
                                    for result in search_results:
                                        if len(result) >= 2 and result[1]:
                                            possible_dest_paths.append(result[1])

                                    if possible_dest_paths:
                                        for possible_dest_path in possible_dest_paths:
                                            if os.path.lexists(possible_dest_path):
                                                break
                                        else:
                                            # If no valid path found, use the first one
                                            possible_dest_path = possible_dest_paths[0]
                                            log_message(f"Using first destination path: {possible_dest_path}", level="DEBUG")
                                    else:
                                        log_message(f"No destination paths found in search results", level="DEBUG")
                                        possible_dest_path = None
                                except Exception as e:
                                    log_message(f"Error using Database search: {e}", level="ERROR")
                                    possible_dest_path = None
                            else:
                                log_message("Searching Database function not available", level="WARNING")
                                possible_dest_path = None

                        # If we found a possible destination, try to delete it if it's a broken symlink
                        if possible_dest_path:
                            try:
                                if os.path.lexists(possible_dest_path):
                                    if os.path.islink(possible_dest_path):
                                        # It's a symlink - check if it's broken
                                        target = os.readlink(possible_dest_path)
                                        if not os.path.exists(target) or target == removed_path:
                                            os.remove(possible_dest_path)
                                            symlinks_deleted = True
                                            log_message(f"Deleted broken symlink: {possible_dest_path}", level="INFO")
                                            cursor1.execute("SELECT file_path, tmdb_id, season_number FROM processed_files WHERE destination_path = ?", (possible_dest_path,))
                                            result = cursor1.fetchone()
                                            if result:
                                                source_path, tmdb_id, season_number = result
                                                track_file_deletion(source_path, possible_dest_path, tmdb_id, season_number, "Source file removed, cleaned up broken symlink")
                                            cursor1.execute("DELETE FROM processed_files WHERE destination_path = ?", (possible_dest_path,))
                                            cursor2.execute("DELETE FROM file_index WHERE path = ?", (possible_dest_path,))
                                            _cleanup_empty_dirs(os.path.dirname(possible_dest_path))
                                        else:
                                            log_message(f"Symlink exists but target still exists: {target}", level="INFO")
                                    else:
                                        log_message(f"Destination path exists but is not a symlink: {possible_dest_path}", level="INFO")
                                else:
                                    log_message(f"Destination file does not exist: {possible_dest_path}", level="INFO")
                            except Exception as e:
                                log_message(f"Error checking destination path: {e}", level="ERROR")
                        else:
                            # If no destination found from database queries, try to find it in the filesystem
                            log_message(f"No destination path found in databases, searching filesystem", level="DEBUG")

                            # Extract the base name of the file to search for in the destination directory
                            file_basename = os.path.basename(removed_path)
                            log_message(f"Searching for symlinks with basename: {file_basename}", level="DEBUG")

                            # Search for symlinks in the destination directory
                            symlinks_found = False
                            for root, _, files in os.walk(dest_dir):
                                for file in files:
                                    if file_basename in file or file_basename.replace(" ", ".") in file:
                                        file_path = os.path.join(root, file)
                                        log_message(f"Found potential match: {file_path}", level="DEBUG")

                                        if os.path.islink(file_path):
                                            try:
                                                target = os.readlink(file_path)
                                                if target == removed_path or (not os.path.exists(target) and removed_path in target):
                                                    log_message(f"Found broken symlink pointing to removed file: {file_path}", level="INFO")
                                                    os.remove(file_path)
                                                    symlinks_deleted = True
                                                    symlinks_found = True
                                                    log_message(f"Deleted broken symlink: {file_path}", level="INFO")
                                                    cursor1.execute("DELETE FROM processed_files WHERE destination_path = ?", (file_path,))
                                                    cursor2.execute("DELETE FROM file_index WHERE path = ?", (file_path,))
                                                    _cleanup_empty_dirs(os.path.dirname(file_path))
                                            except OSError as e:
                                                log_message(f"Error reading symlink {file_path}: {e}", level="ERROR")

                            if not symlinks_found:
                                log_message(f"No symlinks found for {file_basename}", level="WARNING")

                                # Search for the destination path in the processed_files table of DB_FILE
                                cursor1.execute("""
                                    SELECT destination_path, tmdb_id, season_number
                                    FROM processed_files
                                    WHERE file_path LIKE ?
                                """, (f"%{file_basename}",))
                                db_results = cursor1.fetchall()

                                if db_results:
                                    log_message(f"Found {len(db_results)} possible matches in processed_files", level="INFO")
                                    for dest_path, tmdb_id, season_number in db_results:
                                        log_message(f"Checking possible destination: {dest_path}, tmdb_id={tmdb_id}, season_number={season_number}", level="INFO")
                                        if os.path.lexists(dest_path):
                                            if os.path.islink(dest_path):
                                                target = os.readlink(dest_path)
                                                if not os.path.exists(target):
                                                    log_message(f"Found broken symlink: {dest_path}", level="INFO")
                                                    os.remove(dest_path)
                                                    symlinks_deleted = True
                                                    log_message(f"Deleted broken symlink: {dest_path}", level="INFO")
                                                    track_file_deletion(removed_path, dest_path, tmdb_id, season_number, "Source file removed, cleaned up broken symlink")
                                                    cursor1.execute("DELETE FROM processed_files WHERE destination_path = ?", (dest_path,))
                                                    cursor2.execute("DELETE FROM file_index WHERE path = ?", (dest_path,))
                                                    _cleanup_empty_dirs(os.path.dirname(dest_path))

                    # Process database-tracked symlinks
                    for item in all_paths:
                        source_path, symlink_path = item[0], item[1]
                        tmdb_id = item[2] if len(item) > 2 else None
                        season_number = item[3] if len(item) > 3 else None

                        if symlink_path is None or not symlink_path:
                            log_message("Skipping None/empty symlink path", level="WARNING")
                            continue

                        # Check if the symlink exists by using proper shell-compatible path
                        safe_path = symlink_path
                        try:
                            # First attempt: check if the path exists directly
                            if os.path.lexists(safe_path):
                                if os.path.islink(safe_path):
                                    try:
                                        target = os.readlink(safe_path)
                                        log_message(f"Deleting symlink: {safe_path}, tmdb_id={tmdb_id}, season_number={season_number}", level="INFO")
                                        os.remove(safe_path)
                                        symlinks_deleted = True

                                        cursor1.execute("SELECT file_path, tmdb_id, season_number FROM processed_files WHERE destination_path = ?", (symlink_path,))
                                        result = cursor1.fetchone()
                                        if result:
                                            source_path, tmdb_id_db, season_number_db = result
                                            track_file_deletion(source_path, symlink_path, tmdb_id_db, season_number_db, "Source file removed, cleaned up symlink")

                                        # Remove from both databases
                                        cursor1.execute("DELETE FROM processed_files WHERE destination_path = ?", (symlink_path,))
                                        cursor2.execute("DELETE FROM file_index WHERE path = ?", (symlink_path,))

                                        _cleanup_empty_dirs(os.path.dirname(safe_path))
                                    except OSError as e:
                                        log_message(f"Error handling symlink {safe_path}: {e}", level="ERROR")
                                else:
                                    log_message(f"Path exists but is not a symlink: {safe_path}", level="WARNING")
                                    log_message(f"Cleaning up non-symlink entry from databases: {symlink_path}", level="INFO")
                                    cursor1.execute("DELETE FROM processed_files WHERE destination_path = ?", (symlink_path,))
                                    cursor2.execute("DELETE FROM file_index WHERE path = ?", (symlink_path,))
                            else:
                                # Second attempt: Try running an external command to check if file exists
                                log_message(f"Path not found with os.path.lexists, trying alternative check for: {safe_path}", level="DEBUG")

                                # Try executing a command to check if the file exists
                                try:
                                    result = subprocess.run(['ls', safe_path], stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
                                    if result.returncode == 0:
                                        log_message(f"File found with ls command: {safe_path}", level="INFO")

                                        # Try to delete the symlink using subprocess
                                        log_message(f"Trying to delete symlink using rm command: {safe_path}, tmdb_id={tmdb_id}, season_number={season_number}", level="INFO")
                                        rm_result = subprocess.run(['rm', safe_path], stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)

                                        if rm_result.returncode == 0:
                                            log_message(f"Successfully deleted symlink using rm command: {safe_path}", level="INFO")
                                            symlinks_deleted = True

                                            # Remove from both databases
                                            log_message(f"Removing from processed_files: {symlink_path}", level="DEBUG")
                                            cursor1.execute("DELETE FROM processed_files WHERE destination_path = ?", (symlink_path,))

                                            log_message(f"Removing from file_index: {symlink_path}", level="DEBUG")
                                            cursor2.execute("DELETE FROM file_index WHERE path = ?", (symlink_path,))

                                            # Clean up empty directories
                                            try:
                                                _cleanup_empty_dirs(os.path.dirname(safe_path))
                                            except Exception as e:
                                                log_message(f"Error cleaning up directories: {e}", level="WARNING")
                                        else:
                                            log_message(f"Failed to delete symlink using rm command: {safe_path}. Error: {rm_result.stderr.decode()}", level="ERROR")
                                    else:
                                        log_message(f"File not found with ls command either: {safe_path}", level="WARNING")
                                        log_message(f"Cleaning up non-existent path from databases: {symlink_path}", level="INFO")
                                        cursor1.execute("SELECT file_path, tmdb_id, season_number FROM processed_files WHERE destination_path = ?", (symlink_path,))
                                        result = cursor1.fetchone()
                                        if result:
                                            source_path, tmdb_id_db, season_number_db = result
                                            track_file_deletion(source_path, symlink_path, tmdb_id_db, season_number_db, "Symlink path not found")
                                        cursor1.execute("DELETE FROM processed_files WHERE destination_path = ?", (symlink_path,))
                                        cursor2.execute("DELETE FROM file_index WHERE path = ?", (symlink_path,))
                                except Exception as e:
                                    log_message(f"Error checking file with subprocess: {e}", level="ERROR")
                        except Exception as e:
                            log_message(f"Error checking path existence: {e}", level="ERROR")

                conn1.commit()
                conn2.commit()

        except sqlite3.Error as e:
            log_message(f"Database error: {e}", level="ERROR")
            return False
        except Exception as e:
            log_message(f"Unexpected error in delete_broken_symlinks: {e}", level="ERROR")
            import traceback
            log_message(f"Traceback: {traceback.format_exc()}", level="ERROR")
            return False

    else:
        log_message(f"No specific path provided, checking all symlinks in {dest_dir}", level="INFO")
        _check_all_symlinks(dest_dir)

    return symlinks_deleted

def _cleanup_empty_dirs(dir_path):
    """Helper function to clean up empty directories and associated .tmdb files."""
    while dir_path and os.path.isdir(dir_path):
        try:
            # Get directory contents
            dir_contents = os.listdir(dir_path)
            tmdb_files = [f for f in dir_contents if f.endswith('.tmdb')]
            non_tmdb_files = [f for f in dir_contents if not f.endswith('.tmdb')]

            # Only proceed with cleanup if directory is empty except for .tmdb files
            if not non_tmdb_files:
                # Directory is empty except for .tmdb files, safe to remove everything

                # Remove any .tmdb files found
                for tmdb_file in tmdb_files:
                    tmdb_path = os.path.join(dir_path, tmdb_file)
                    try:
                        # On Windows, remove hidden attribute if present
                        if platform.system() == "Windows":
                            try:
                                import ctypes
                                FILE_ATTRIBUTE_NORMAL = 0x80
                                ctypes.windll.kernel32.SetFileAttributesW(tmdb_path, FILE_ATTRIBUTE_NORMAL)
                            except Exception:
                                pass

                        os.remove(tmdb_path)
                    except Exception as e:
                        log_message(f"Error deleting .tmdb file {tmdb_path}: {e}", level="WARNING")

                # Now delete the empty directory
                log_message(f"Deleting empty folder: {dir_path}", level="INFO")
                os.rmdir(dir_path)
                dir_path = os.path.dirname(dir_path)
            else:
                break

        except OSError as e:
            log_message(f"Error during directory cleanup for {dir_path}: {e}", level="WARNING")
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

                with sqlite3.connect(DB_FILE) as conn1, sqlite3.connect(PROCESS_DB) as conn2:
                    cursor1 = conn1.cursor()
                    cursor2 = conn2.cursor()

                    cursor1.execute("SELECT file_path, tmdb_id, season_number FROM processed_files WHERE destination_path = ?", (file_path,))
                    result = cursor1.fetchone()
                    if result:
                        source_path, tmdb_id, season_number = result
                        track_file_deletion(source_path, file_path, tmdb_id, season_number, "Broken symlink detected and removed")

                    cursor1.execute("DELETE FROM processed_files WHERE destination_path = ?", (file_path,))
                    cursor2.execute("DELETE FROM file_index WHERE path = ?", (file_path,))
                    affected_rows = cursor1.rowcount
                    conn1.commit()
                    conn2.commit()
                    log_message(f"Removed {affected_rows} database entries", level="DEBUG")

                _cleanup_empty_dirs(os.path.dirname(file_path))

def normalize_path(path):
    """
    Normalizes a file path to ensure consistent formatting for comparison.
    Only applies normalization specific to Windows

    Args:
        path (str): The file path to normalize.

    Returns:
        str: The normalized file path.
    """
    if platform.system() == "Windows":
        if path.startswith("\\\\?\\"):
            path = path[4:]
        path = os.path.abspath(path)
    return path

def get_existing_symlink_info(src_file):
    """Get information about existing symlink for a source file."""
    existing_dest_path = get_destination_path(src_file)
    if existing_dest_path and os.path.exists(os.path.dirname(existing_dest_path)):
        dir_path = os.path.dirname(existing_dest_path)
        for filename in os.listdir(dir_path):
            full_path = os.path.join(dir_path, filename)
            if os.path.islink(full_path):
                target_path = os.readlink(full_path)

                # Normalize paths only on Windows
                normalized_src_file = normalize_path(src_file)
                normalized_target_path = normalize_path(target_path)

                if normalized_target_path == normalized_src_file:
                    return full_path
    return None

def load_skip_patterns():
    """Load skip patterns from keywords.json in utils folder"""
    try:
        current_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        keywords_path = os.path.join(current_dir, 'utils', 'keywords.json')

        with open(keywords_path, 'r') as f:
            data = json.load(f)
            return data.get('skip_patterns', [])
    except Exception as e:
        log_message(f"Error loading skip patterns from keywords.json: {str(e)}", level="ERROR")
        return []

SKIP_PATTERNS = load_skip_patterns()

def should_skip_file(filename):
    """
    Check if the file should be skipped based on patterns from keywords.json
    """
    if not is_skip_patterns_enabled():
        return False

    for pattern in SKIP_PATTERNS:
        try:
            if re.match(pattern, filename, re.IGNORECASE):
                log_message(f"Skipping file due to pattern match in Adult Content {filename}", level="INFO")
                return True
        except re.error as e:
            log_message(f"Invalid regex pattern '{pattern}': {str(e)}", level="ERROR")
            continue
    return False
