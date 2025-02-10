import os
import platform
import sqlite3
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
        log_message(f"Database initialization error: {e}", level="ERROR")
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
                if removed_path.endswith(']') or os.path.isdir(removed_path):
                    log_message(f"Detected folder removal: {removed_path}", level="DEBUG")
                    search_path = f"{removed_path}/%"

                    # Query processed_files table
                    cursor1.execute("""
                        SELECT file_path, destination_path
                        FROM processed_files
                        WHERE file_path LIKE ?
                    """, (search_path,))
                    results = cursor1.fetchall()

                    # Query file_index table
                    cursor2.execute("""
                        SELECT path, target_path
                        FROM file_index
                        WHERE target_path LIKE ?
                    """, (search_path,))
                    file_index_results = cursor2.fetchall()

                    # Combine results from both tables
                    all_paths = set()
                    for source_path, symlink_path in results:
                        all_paths.add((source_path, symlink_path))
                    for symlink_path, source_path in file_index_results:
                        all_paths.add((source_path, symlink_path))

                    for source_path, symlink_path in all_paths:
                        if os.path.islink(symlink_path):
                            try:
                                target = os.readlink(symlink_path)
                                log_message(f"Found symlink pointing to: {target}", level="DEBUG")

                                log_message(f"Deleting symlink: {symlink_path}", level="INFO")
                                os.remove(symlink_path)
                                symlinks_deleted = True

                                # Remove from both databases
                                cursor1.execute("DELETE FROM processed_files WHERE destination_path = ?", (symlink_path,))
                                cursor2.execute("DELETE FROM file_index WHERE path = ?", (symlink_path,))

                                _cleanup_empty_dirs(os.path.dirname(symlink_path))
                            except OSError as e:
                                log_message(f"Error handling symlink {symlink_path}: {e}", level="ERROR")

                else:
                    # Handle single file removal
                    cursor1.execute("SELECT destination_path FROM processed_files WHERE file_path = ?", (removed_path,))
                    result1 = cursor1.fetchone()

                    cursor2.execute("SELECT path FROM file_index WHERE target_path = ?", (removed_path,))
                    result2 = cursor2.fetchone()

                    symlink_paths = set()
                    if result1:
                        symlink_paths.add(result1[0])
                    if result2:
                        symlink_paths.add(result2[0])

                    if not symlink_paths:
                        # Try alternative matching methods
                        filename = os.path.basename(removed_path)
                        alternative_path = os.path.join(removed_path, filename)
                        pattern = f"%{filename}"

                        cursor1.execute("SELECT destination_path FROM processed_files WHERE file_path = ?", (alternative_path,))
                        alt_result1 = cursor1.fetchone()
                        if alt_result1:
                            symlink_paths.add(alt_result1[0])

                        cursor2.execute("SELECT path FROM file_index WHERE target_path LIKE ?", (pattern,))
                        alt_results2 = cursor2.fetchall()
                        symlink_paths.update(path[0] for path in alt_results2)

                    for symlink_path in symlink_paths:
                        if os.path.islink(symlink_path):
                            try:
                                target = os.readlink(symlink_path)
                                log_message(f"Deleting symlink: {symlink_path}", level="INFO")
                                os.remove(symlink_path)
                                symlinks_deleted = True

                                # Remove from both databases
                                cursor1.execute("DELETE FROM processed_files WHERE destination_path = ?", (symlink_path,))
                                cursor2.execute("DELETE FROM file_index WHERE path = ?", (symlink_path,))

                                _cleanup_empty_dirs(os.path.dirname(symlink_path))
                            except OSError as e:
                                log_message(f"Error handling symlink {symlink_path}: {e}", level="ERROR")

                conn1.commit()
                conn2.commit()

        except sqlite3.Error as e:
            log_message(f"Database error: {e}", level="ERROR")
            return False
        except Exception as e:
            log_message(f"Unexpected error: {e}", level="ERROR")
            return False

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
