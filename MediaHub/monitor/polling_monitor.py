import os
import time
import subprocess
import logging
import sys
from dotenv import load_dotenv, find_dotenv

# Append the parent directory to the system path
base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '../..'))
sys.path.append(base_dir)

# Local imports from MediaHub
from MediaHub.processors.db_utils import initialize_db, load_processed_files, save_processed_file, delete_broken_symlinks, check_file_in_db
from MediaHub.config.config import *
from MediaHub.processors.symlink_creator import delete_broken_symlinks
from MediaHub.utils.logging_utils import log_message

# Load .env file from the parent directory
dotenv_path = find_dotenv('../.env')
if not dotenv_path:
    print(RED_COLOR + "Error: .env file not found in the parent directory." + RESET_COLOR)
    exit(1)

load_dotenv(dotenv_path)

# Add state variables for mount status tracking
mount_state = None
previous_file_counts = {}
last_scan_time = None

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

def scan_directories(dirs_to_watch, current_files):
    """Scans directories for new or removed files."""
    new_files = {}
    has_changes = False

    for directory in dirs_to_watch:
        if not os.path.exists(directory):
            log_message(f"Watch directory not found: {directory}", level="ERROR")
            continue

        try:
            dir_files = set(os.listdir(directory))
            new_files[directory] = dir_files

            # Check if there are any changes compared to current_files
            if directory in current_files and dir_files != current_files[directory]:
                has_changes = True
        except Exception as e:
            log_message(f"Failed to scan directory {directory}: {str(e)}", level="ERROR")
            continue

    return new_files, has_changes

def process_changes(current_files, new_files, dest_dir):
    """Processes changes by detecting added or removed files and triggering actions."""
    changes_detected = False

    for directory, files in new_files.items():
        old_files = current_files.get(directory, set())
        added_files = files - old_files
        removed_files = old_files - files

        if added_files:
            changes_detected = True
            log_message(f"New files detected in {directory}: {added_files}", level="INFO")
            for file in added_files:
                if file != 'version.txt':  # Skip processing version.txt file
                    full_path = os.path.join(directory, file)
                    log_message(f"Processing new file: {full_path}", level="INFO")
                    process_file(full_path)
                else:
                    log_message("Skipping version.txt file processing", level="DEBUG")

        if removed_files:
            changes_detected = True
            log_message(f"Detected {len(removed_files)} removed files from {directory}: {removed_files}", level="INFO")
            delete_broken_symlinks(dest_dir)

    return changes_detected

def process_file(file_path):
    """Processes individual files by checking the database and invoking media processing."""
    log_message(f"Processing file: {file_path}", level="INFO")
    if not check_file_in_db(file_path):
        log_message(f"File not found in database. Initiating processing for: {file_path}", level="DEBUG")
        try:
            subprocess.run(['python3', 'MediaHub/main.py', file_path, '--auto-select'], check=True)
        except subprocess.CalledProcessError as e:
            log_message(f"Failed to process file: {e}", level="ERROR")
    else:
        log_message(f"File already exists in the database: {file_path}", level="DEBUG")

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
    global mount_state
    log_message("Starting MediaHub directory monitor service", level="INFO")

    # Initialize the database
    initialize_db()

    # Load previously processed files from the database
    load_processed_files()

    src_dirs, dest_dir = get_directories()
    if not src_dirs or not dest_dir:
        log_message("Source or destination directory not set in environment variables", level="ERROR")
        exit(1)

    sleep_time = int(os.getenv('SLEEP_TIME', 60))
    current_files = {}

    while True:
        try:
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
                log_message(f"Looking for Changes...", level="DEBUG")
            else:
                # Scan for changes
                new_files, has_changes = scan_directories(src_dirs, current_files)

                # Process changes if any were detected
                if has_changes:
                    changes_processed = process_changes(current_files, new_files, dest_dir)
                    current_files = new_files

                    if changes_processed:
                        log_message(f"Looking for Changes...", level="DEBUG")

            time.sleep(sleep_time)

        except KeyboardInterrupt:
            log_message("Received shutdown signal, exiting gracefully", level="INFO")
            break
        except Exception as e:
            log_message(f"Unexpected error in main loop: {str(e)}", level="ERROR")
            time.sleep(sleep_time)

if __name__ == "__main__":
    main()
