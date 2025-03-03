import os
import platform
import sqlite3
import subprocess
from MediaHub.utils.logging_utils import log_message
from MediaHub.config.config import *
from MediaHub.processors.db_utils import *
from MediaHub.processors.process_db import *

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

                    # Query processed_files table for exact match
                    log_message("Querying processed_files table for exact directory match", level="DEBUG")
                    cursor1.execute("""
                        SELECT file_path, destination_path, tmdb_id, season_number
                        FROM processed_files
                        WHERE file_path = ?
                    """, (exact_path,))
                    exact_results = cursor1.fetchall()
                    log_message(f"Found {len(exact_results)} exact matching entries in processed_files", level="DEBUG")

                    # Query for files inside the directory
                    log_message("Querying processed_files table for files inside directory", level="DEBUG")
                    cursor1.execute("""
                        SELECT file_path, destination_path, tmdb_id, season_number
                        FROM processed_files
                        WHERE file_path LIKE ?
                    """, (directory_path,))
                    directory_results = cursor1.fetchall()
                    log_message(f"Found {len(directory_results)} directory content matches in processed_files", level="DEBUG")

                    # Combine results
                    results = exact_results + directory_results

                    # Query file_index table
                    log_message("Querying file_index table for matching paths", level="DEBUG")
                    cursor2.execute("""
                        SELECT path, target_path
                        FROM file_index
                        WHERE target_path = ? OR target_path LIKE ?
                    """, (exact_path, directory_path))
                    file_index_results = cursor2.fetchall()
                    log_message(f"Found {len(file_index_results)} matching entries in file_index", level="DEBUG")

                    # Combine results from both tables
                    all_paths = set()
                    for result in results:
                        source_path, symlink_path = result[0], result[1]
                        tmdb_id = result[2] if len(result) > 2 else None
                        season_number = result[3] if len(result) > 3 else None

                        if symlink_path:  # Check if symlink_path is not None or empty
                            all_paths.add((source_path, symlink_path, tmdb_id, season_number))
                            log_message(f"Added from processed_files: source={source_path}, symlink={symlink_path}, tmdb_id={tmdb_id}, season_number={season_number}", level="DEBUG")

                    for symlink_path, source_path in file_index_results:
                        if symlink_path:  # Check if symlink_path is not None or empty
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

                                        cursor1.execute("""
                                            SELECT file_path, destination_path, tmdb_id, season_number
                                            FROM processed_files
                                            WHERE file_path = ?
                                        """, (file_path,))
                                        file_results = cursor1.fetchall()

                                        for result in file_results:
                                            source_path, symlink_path = result[0], result[1]
                                            tmdb_id = result[2] if len(result) > 2 else None
                                            season_number = result[3] if len(result) > 3 else None

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
                        # This is important for paths with special characters like colons
                        safe_path = symlink_path
                        try:
                            # First attempt: check if the path exists directly
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
                            else:
                                # Second attempt: Try running an external command to check if file exists
                                log_message(f"Path not found with os.path.lexists, trying alternative check for: {safe_path}", level="DEBUG")

                                # Try executing a command to check if the file exists
                                import subprocess
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
                                except Exception as e:
                                    log_message(f"Error checking file with subprocess: {e}", level="ERROR")
                        except Exception as e:
                            log_message(f"Error checking path existence: {e}", level="ERROR")

                else:
                    # Handle single file removal
                    log_message(f"Processing single file removal: {removed_path}", level="INFO")

                    # First try direct match in processed_files
                    log_message("Querying processed_files for the removed file", level="DEBUG")
                    cursor1.execute("SELECT file_path, destination_path, tmdb_id, season_number FROM processed_files WHERE file_path = ?", (removed_path,))
                    results = cursor1.fetchall()
                    log_message(f"processed_files direct query results: {len(results)}", level="DEBUG")

                    # If no direct match, try different variations
                    if not results:
                        log_message("No direct match found, trying alternative paths", level="DEBUG")

                        # Try with filename appended (common pattern in your data)
                        filename = os.path.basename(removed_path)
                        alt_path = os.path.join(removed_path, filename + ".mkv")  # Common video extension
                        log_message(f"Trying alternative path: {alt_path}", level="DEBUG")

                        cursor1.execute("SELECT file_path, destination_path, tmdb_id, season_number FROM processed_files WHERE file_path = ?", (alt_path,))
                        alt_results = cursor1.fetchall()

                        if alt_results:
                            log_message(f"Found match using alternative path: {alt_path}", level="INFO")
                            results = alt_results
                        else:
                            # Try pattern matching
                            pattern = f"{removed_path}%"
                            log_message(f"Trying pattern matching: {pattern}", level="DEBUG")

                            cursor1.execute("SELECT file_path, destination_path, tmdb_id, season_number FROM processed_files WHERE file_path LIKE ?", (pattern,))
                            pattern_results = cursor1.fetchall()

                            if pattern_results:
                                log_message(f"Found {len(pattern_results)} matches using pattern", level="INFO")
                                results = pattern_results

                    # Check file_index as well
                    log_message("Querying file_index for the removed file", level="DEBUG")
                    cursor2.execute("SELECT path, target_path FROM file_index WHERE target_path = ?", (removed_path,))
                    file_index_results = cursor2.fetchall()

                    if not file_index_results:
                        pattern = f"{removed_path}%"
                        cursor2.execute("SELECT path, target_path FROM file_index WHERE target_path LIKE ?", (pattern,))
                        file_index_pattern_results = cursor2.fetchall()
                        file_index_results = file_index_pattern_results

                    log_message(f"file_index query results: {len(file_index_results)}", level="DEBUG")

                    # Combine all results
                    all_paths = set()
                    for result in results:
                        source_path, symlink_path = result[0], result[1]
                        tmdb_id = result[2] if len(result) > 2 else None
                        season_number = result[3] if len(result) > 3 else None

                        if symlink_path:
                            all_paths.add((source_path, symlink_path, tmdb_id, season_number))
                            log_message(f"Found in processed_files: source={source_path}, symlink={symlink_path}, tmdb_id={tmdb_id}, season_number={season_number}", level="DEBUG")

                    for symlink_path, target_path in file_index_results:
                        if symlink_path:
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

                    log_message(f"Total symlink paths to process: {len(all_paths)}", level="INFO")

                    if not all_paths:
                        log_message(f"No symlinks found for file: {removed_path}", level="WARNING")

                    for item in all_paths:
                        source_path, symlink_path = item[0], item[1]
                        tmdb_id = item[2] if len(item) > 2 else None
                        season_number = item[3] if len(item) > 3 else None

                        if symlink_path is None or not symlink_path:
                            log_message("Skipping None/empty symlink path", level="WARNING")
                            continue

                        log_message(f"Processing symlink: {symlink_path}, tmdb_id={tmdb_id}, season_number={season_number}", level="INFO")

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

                                        # Remove from both databases
                                        cursor1.execute("DELETE FROM processed_files WHERE destination_path = ?", (symlink_path,))
                                        cursor2.execute("DELETE FROM file_index WHERE path = ?", (symlink_path,))

                                        _cleanup_empty_dirs(os.path.dirname(safe_path))
                                    except OSError as e:
                                        log_message(f"Error handling symlink {safe_path}: {e}", level="ERROR")
                                else:
                                    log_message(f"Path exists but is not a symlink: {safe_path}", level="WARNING")
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

                with sqlite3.connect(DB_FILE) as conn1, sqlite3.connect(PROCESS_DB) as conn2:
                    cursor1 = conn1.cursor()
                    cursor2 = conn2.cursor()
                    cursor1.execute("DELETE FROM processed_files WHERE destination_path = ?", (file_path,))
                    cursor2.execute("DELETE FROM file_index WHERE path = ?", (file_path,))
                    affected_rows = cursor.rowcount
                    conn1.commit()
                    conn2.commit()
                    log_message(f"Removed {affected_rows} database entries", level="DEBUG")

                _cleanup_empty_dirs(os.path.dirname(file_path))

def normalize_path(path):
    """
    Normalizes a file path to ensure consistent formatting for comparison.
    Only applies normalization specific to Windows (e.g., removing \\?\).

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
