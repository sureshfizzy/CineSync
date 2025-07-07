import os
import time
import subprocess
import sys
from dotenv import load_dotenv, find_dotenv
from concurrent.futures import ThreadPoolExecutor, as_completed
from threading import Event

# Append the parent directory to the system path
base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '../..'))
sys.path.append(base_dir)

# Local imports from MediaHub
from MediaHub.processors.db_utils import *
from MediaHub.config.config import *
from MediaHub.processors.symlink_creator import *
from MediaHub.processors.symlink_utils import delete_broken_symlinks, delete_broken_symlinks_batch
from MediaHub.utils.logging_utils import log_message

# Load .env file from the parent directory
dotenv_path = find_dotenv('../.env')
if not dotenv_path:
    print("Warning: .env file not found. Using environment variables only.")
else:
    load_dotenv(dotenv_path)

# Add state variables for mount status tracking
mount_state = None

# Global error event for parallel processing
error_event = Event()

def get_mount_point(path):
    """
    Find the mount point of a path by walking up the directory tree.
    Returns tuple (is_mount_point, mount_path)
    """
    global mount_state
    path = os.path.abspath(path)

    # First check if the path exists
    if not os.path.exists(path):
        log_message(f"Path does not exist: {path}", level="DEBUG")
        return False, None

    # Walk up the directory tree to find the mount point
    while not os.path.ismount(path):
        parent = os.path.dirname(path)
        # If we've reached the root directory and it's not a mount point
        if parent == path:
            log_message(f"No mount point found for {path}", level="DEBUG")
            return False, None
        path = parent

    # Don't consider root directory as a valid mount point
    if path == '/':
        log_message("Root directory is not a valid mount point", level="DEBUG")
        return False, None

    return True, path

def verify_mount_health(directory):
    """
    Performs health checks on the mounted directory without requiring write access.
    Returns True if the mount appears healthy, False otherwise.
    """
    try:
        contents = os.listdir(directory)
        if not contents:
            return True

        for item in contents[:1]:
            full_path = os.path.join(directory, item)
            os.stat(full_path)

        os.statvfs(directory)

        return True

    except OSError:
        return False
    except Exception:
        return False

def verify_rclone_mount(directory):
    """
    Verifies if the directory is under a mount and checks mount health.
    Returns tuple: (is_mounted, is_healthy)
    """
    global mount_state

    if not os.path.exists(directory):
        return False, False

    is_mounted, mount_point = get_mount_point(directory)

    if is_mounted and mount_point:
        is_healthy = verify_mount_health(directory)

        if is_healthy:
            if mount_state != True:
                log_message(f"Mount is now available: {mount_point}", level="INFO")
                mount_state = True
            return True, True
        else:
            if mount_state is not False:
                log_message(f"Mount has become unresponsive: {mount_point}", level="WARNING")
                mount_state = False
            return False, False
    else:
        if mount_state is not False:
            log_message(f"Mount is not available: {directory}", level="WARNING")
            mount_state = False
        return False, False

def check_rclone_mount():
    """
    Checks if the mount is available and healthy.
    Returns True if either RCLONE_MOUNT is False or if the mount is verified.
    """
    global mount_state

    if not is_rclone_mount_enabled():
        if mount_state is not False:
            log_message("Mount check is disabled", level="INFO")
            mount_state = False
        return True

    src_dirs, _ = get_directories()
    if not src_dirs:
        log_message("No source directories configured in environment", level="ERROR")
        return False

    directory = src_dirs[0]

    try:
        is_mounted, is_healthy = verify_rclone_mount(directory)
        return is_mounted and is_healthy

    except Exception as e:
        if mount_state is not False:
            log_message(f"Error checking mount: {str(e)}", level="ERROR")
            mount_state = False
        return False

def scan_directories(dirs_to_watch, current_files, last_mod_times=None):
    """
    Scans directories for new or removed files and tracks directory modifications.
    Args:
        dirs_to_watch (list): Directories to monitor
        current_files (dict): Current known files in directories
        last_mod_times (dict, optional): Last known modification times for directories
    Returns:
        tuple: (new_files, modified_dirs, updated_last_mod_times)
    """
    if last_mod_times is None:
        last_mod_times = {}

    new_files = {}
    modified_dirs = {}

    for directory in dirs_to_watch:
        log_message(f"Scanning directory: {directory}", level="DEBUG")

        if not os.path.exists(directory):
            log_message(f"Watch directory not found: {directory}", level="ERROR")
            continue

        try:
            dir_entries = os.listdir(directory)
            new_files[directory] = set(dir_entries)

            for entry in dir_entries:
                full_path = os.path.join(directory, entry)

                if os.path.isdir(full_path):
                    try:
                        dir_stat = os.stat(full_path)
                        current_mod_time = dir_stat.st_mtime

                        mod_key = full_path

                        if mod_key in last_mod_times:
                            if current_mod_time > last_mod_times[mod_key]:
                                log_message(f"Top-level Subdirectory Modified: {full_path}", level="DEBUG")
                                modified_dirs[full_path] = {
                                    'old_mod_time': last_mod_times[mod_key],
                                    'new_mod_time': current_mod_time
                                }

                        last_mod_times[mod_key] = current_mod_time

                    except Exception as e:
                        log_message(f"Error checking subdirectory {full_path}: {str(e)}", level="ERROR")

        except Exception as e:
            log_message(f"Failed to scan directory {directory}: {str(e)}", level="ERROR")
            continue

    return new_files, modified_dirs, last_mod_times

def process_changes(current_files, new_files, dest_dir, modified_dirs=None, max_processes=None, db_max_workers=None, db_batch_size=None):
    """
    Updated process_changes to create symlinks for added files using parallel processing.
    Uses database configurations for optimal performance.
    """
    src_dirs, _ = get_directories()
    # Use passed configuration values or fall back to function calls
    max_processes = max_processes or get_max_processes()
    db_max_workers = db_max_workers or get_db_max_workers()
    max_workers = min(max_processes, db_max_workers)

    # Process modified directories with parallel processing
    if modified_dirs:
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            mod_dir_tasks = []

            for mod_dir, mod_details in modified_dirs.items():
                task = executor.submit(_process_modified_directory, mod_dir, mod_details, src_dirs, dest_dir, db_batch_size)
                mod_dir_tasks.append(task)

            for task in as_completed(mod_dir_tasks):
                if error_event.is_set():
                    log_message("Error detected during modified directory processing. Stopping tasks.", level="WARNING")
                    break
                try:
                    task.result()
                except Exception as e:
                    log_message(f"Error in modified directory task: {str(e)}", level="ERROR")
                    error_event.set()

    # Process new/removed files with parallel processing
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        file_tasks = []
        removal_tasks = []

        for directory, files in new_files.items():
            old_files = current_files.get(directory, set())
            added_files = files - old_files
            removed_files = old_files - files

            if added_files:
                log_message(f"New files detected in {directory}: {added_files}", level="INFO")
                for file in added_files:
                    if file != 'version.txt':
                        full_path = os.path.join(directory, file)
                        task = executor.submit(_process_single_file, full_path)
                        file_tasks.append(task)
                    else:
                        log_message("Skipping version.txt file processing", level="DEBUG")

            if removed_files:
                log_message(f"Detected {len(removed_files)} removed files from {directory}: {removed_files}", level="INFO")
                removed_file_paths = [os.path.join(directory, removed_file) for removed_file in removed_files]
                task = executor.submit(_process_removed_files_batch, dest_dir, removed_file_paths, db_batch_size)
                removal_tasks.append(task)

        # Process all file addition tasks
        for task in as_completed(file_tasks):
            if error_event.is_set():
                log_message("Error detected during file processing. Stopping tasks.", level="WARNING")
                break
            try:
                task.result()
            except Exception as e:
                log_message(f"Error in file processing task: {str(e)}", level="ERROR")
                error_event.set()

        # Process all file removal tasks
        for task in as_completed(removal_tasks):
            if error_event.is_set():
                log_message("Error detected during removal processing. Stopping tasks.", level="WARNING")
                break
            try:
                task.result()
            except Exception as e:
                log_message(f"Error in removal processing task: {str(e)}", level="ERROR")
                error_event.set()

def _process_modified_directory(mod_dir, mod_details, src_dirs, dest_dir, db_batch_size=None):
    """Helper function to process a single modified directory."""
    try:
        current_dir_files = set(os.listdir(mod_dir))
        db_results = search_database_silent(mod_dir)
        db_file_names = set(os.path.basename(result[0]) for result in db_results)

        # Find added and removed files
        added_files = current_dir_files - db_file_names
        removed_files = db_file_names - current_dir_files

        # Process added files
        if added_files:
            for added_file in added_files:
                file_path = os.path.join(mod_dir, added_file)
                log_message(f"Processing new file from modified directory: {file_path}", level="INFO")
                try:
                    create_symlinks(src_dirs=src_dirs, dest_dir=dest_dir, auto_select=True, single_path=file_path, force=False, mode='monitor')
                except Exception as e:
                    log_message(f"Error creating symlink for {file_path}: {str(e)}", level="ERROR")

        if removed_files:
            removed_file_paths = [os.path.join(mod_dir, removed_file) for removed_file in removed_files]
            log_message(f"Processing {len(removed_file_paths)} removed files from modified directory using batch processing", level="INFO")
            delete_broken_symlinks_batch(dest_dir, removed_file_paths)

    except Exception as e:
        log_message(f"Error processing modified directory {mod_dir}: {str(e)}", level="ERROR")
        raise

def _process_single_file(full_path):
    """Helper function to process a single file."""
    log_message(f"Processing new file: {full_path}", level="INFO")
    process_file(full_path)

def _process_removed_files_batch(dest_dir, removed_file_paths, db_batch_size=None):
    """Helper function to process a batch of removed files efficiently using database configurations and parallel processing."""
    log_message(f"Processing batch of {len(removed_file_paths)} removed files using optimized batch processing", level="INFO")

    delete_broken_symlinks_batch(dest_dir, removed_file_paths)

def process_file(file_path):
    """
    Processes individual files by checking the database and creating symlinks.
    Only handles the symlink creation without triggering the full main function.
    """
    if not check_file_in_db(file_path):
        log_message(f"File not found in database. Initiating processing for: {file_path}", level="INFO")

        try:
            # Get source and destination directories
            src_dirs, dest_dir = get_directories()
            if not src_dirs or not dest_dir:
                log_message("Source or destination directory not set in environment variables", level="ERROR")
                return

            # Call create_symlinks with the specific file path
            create_symlinks(src_dirs=src_dirs, dest_dir=dest_dir, auto_select=True, single_path=file_path, force=False, mode='monitor')
            log_message(f"Symlink monitoring completed for {file_path}", level="INFO")

        except Exception as e:
            log_message(f"Failed to process file: {file_path}. Error: {e}", level="ERROR")
            error_event.set()
    else:
        log_message(f"File already exists in the database, skipping processing: {file_path}", level="DEBUG")

def initial_scan(dirs_to_watch):
    """Performs an initial scan of directories to capture the current state of files."""
    log_message("Starting initial directory scan", level="INFO")
    current_files = {}

    for directory in dirs_to_watch:
        log_message(f"Performing initial scan of directory: {directory}", level="DEBUG")

        if os.path.exists(directory):
            try:
                files = set(os.listdir(directory))
                current_files[directory] = files
                log_message(f"Initial scan found {len(files)} files in {directory}", level="INFO")
            except Exception as e:
                log_message(f"Error during initial scan of {directory}: {str(e)}", level="ERROR")
        else:
            log_message(f"Directory not found during initial scan: {directory}", level="ERROR")

    log_message("Initial directory scan completed", level="INFO")
    return current_files

def main():
    """Main function to monitor directories and process file changes in real-time."""
    global mount_state, error_event
    log_message("Starting MediaHub directory monitor service", level="INFO")

    # Load configuration values
    max_processes = get_max_processes()
    db_batch_size = get_db_batch_size()
    db_max_workers = get_db_max_workers()

    # Initialize the database using existing utilities
    initialize_db()

    # Load previously processed files from the database
    load_processed_files()

    # Get source and destination directories
    src_dirs, dest_dir = get_directories()
    if not src_dirs or not dest_dir:
        log_message("Source or destination directory not set in environment variables", level="ERROR")
        exit(1)

    # Get configuration from environment
    sleep_time = get_env_int('SLEEP_TIME', 60)

    current_files = {}
    last_mod_times = {}
    while True:
        try:
            # Reset error event at the start of each cycle
            error_event.clear()

            # Check if rclone mount is available (if enabled)
            if not check_rclone_mount():
                if mount_state is not False:
                    log_message("Mount not available, waiting for rclone mount...", level="INFO")
                    mount_state = False
                time.sleep(is_mount_check_interval())
                continue

            # If this is our first successful mount check, do initial scan
            if not current_files:
                current_files = initial_scan(src_dirs)
                log_message("Initial scan after mount verification completed, Monitor Service is Running", level="INFO")

            # Normal directory monitoring with error handling
            log_message("Performing regular directory scan", level="DEBUG")
            new_files, modified_dirs, last_mod_times = scan_directories(src_dirs, current_files, last_mod_times)

            # Process changes with parallel processing using loaded configuration
            if not error_event.is_set():
                process_changes(current_files, new_files, dest_dir, modified_dirs,
                              max_processes, db_max_workers, db_batch_size)
                current_files = new_files
            else:
                log_message("Skipping file processing due to previous errors", level="WARNING")

            log_message(f"Sleeping for {sleep_time} seconds", level="DEBUG")
            time.sleep(sleep_time)

        except KeyboardInterrupt:
            log_message("Received shutdown signal, exiting gracefully", level="INFO")
            break
        except Exception as e:
            log_message(f"Unexpected error in main loop: {str(e)}", level="ERROR")
            error_event.set()
            time.sleep(sleep_time)

if __name__ == "__main__":
    main()
