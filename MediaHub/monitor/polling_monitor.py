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
from MediaHub.processors.symlink_creator import *

# Load .env file from the parent directory
dotenv_path = find_dotenv('../.env')
if not dotenv_path:
    print(RED_COLOR + "Error: .env file not found in the parent directory." + RESET_COLOR)
    exit(1)

# Define the logging level dictionary
LOG_LEVELS = {
    "DEBUG": logging.DEBUG,
    "INFO": logging.INFO,
    "WARNING": logging.WARNING,
    "ERROR": logging.ERROR,
    "CRITICAL": logging.CRITICAL,
}

# Get LOG_LEVEL from environment variable
log_level = LOG_LEVELS.get(os.getenv("LOG_LEVEL", "INFO").upper(), logging.INFO)

# Configure logging
logging.basicConfig(level=log_level, format='%(asctime)s [%(levelname)s] %(message)s', datefmt='%Y-%m-%d %H:%M:%S', stream=sys.stdout)

# Add state variables for mount status tracking
mount_state = None

def log_message(message, level="INFO"):
    """Logs a message at the specified level with additional context."""
    logging.log(LOG_LEVELS.get(level.upper(), logging.INFO), message)

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
    """
    Recursively scans directories for new or removed files.
    Returns a dictionary mapping full file paths to file metadata.
    """
    new_files = {}
    for directory in dirs_to_watch:
        log_message(f"Scanning directory: {directory}", level="DEBUG")

        if not os.path.exists(directory):
            log_message(f"Watch directory not found: {directory}", level="ERROR")
            continue

        try:
            # Use a recursive walk to find all files in all subdirectories
            for root, dirs, files in os.walk(directory):
                for file in files:
                    full_path = os.path.join(root, file)
                    # Store the path relative to the watched directory for easier comparison
                    rel_path = os.path.relpath(full_path, directory)
                    dir_key = os.path.join(directory, rel_path)

                    # Store the full path in our dictionary
                    new_files[dir_key] = {
                        'parent_dir': directory,
                        'rel_path': rel_path,
                        'mtime': os.path.getmtime(full_path)
                    }

            log_message(f"Found {len([k for k in new_files if k.startswith(directory)])} files in {directory} and subdirectories", level="DEBUG")
        except Exception as e:
            log_message(f"Failed to scan directory {directory}: {str(e)}", level="ERROR")
            continue

    return new_files

def process_changes(current_files, new_files, dest_dir):
    """
    Processes changes by detecting added or removed files and triggering actions.
    Works with the new format of file tracking that includes full paths.
    """
    # Find added files (in new_files but not in current_files)
    added_files = set(new_files.keys()) - set(current_files.keys())

    # Find removed files (in current_files but not in new_files)
    removed_files = set(current_files.keys()) - set(new_files.keys())

    added_by_dir = {}
    for file_path in added_files:
        if file_path.endswith('version.txt'):  # Skip processing version.txt file
            continue

        parent_dir = new_files[file_path]['parent_dir']
        if parent_dir not in added_by_dir:
            added_by_dir[parent_dir] = []
        added_by_dir[parent_dir].append(file_path)

    # Group removed files by parent directory for logging
    removed_by_dir = {}
    for file_path in removed_files:
        parent_dir = current_files[file_path]['parent_dir']
        if parent_dir not in removed_by_dir:
            removed_by_dir[parent_dir] = []
        removed_by_dir[parent_dir].append(file_path)

    # Process added files
    for parent_dir, files in added_by_dir.items():
        log_message(f"New files detected in {parent_dir}: {len(files)} files", level="INFO")
        for file_path in files:
            log_message(f"Processing new file: {file_path}", level="INFO")
            process_file(file_path)

    # Process removed files
    for parent_dir, files in removed_by_dir.items():
        log_message(f"Detected {len(files)} removed files from {parent_dir}", level="INFO")
        for file_path in files:
            log_message(f"Checking for broken symlink for removed file: {file_path}", level="DEBUG")
            delete_broken_symlinks(dest_dir, file_path)

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
    else:
        log_message(f"File already exists in the database: {file_path}", level="WARNING")

def initial_scan(dirs_to_watch):
    """
    Performs an initial recursive scan of directories to capture the current state of files.
    Returns a dictionary with full file paths as keys.
    """
    log_message("Starting initial directory scan", level="INFO")
    return scan_directories(dirs_to_watch, {})

def main():
    """Main function to monitor directories and process file changes in real-time."""
    global mount_state
    log_message("Starting MediaHub directory monitor service", level="INFO")

    # Initialize the database
    initialize_db()

    # Load previously processed files from the database
    load_processed_files()

    # Get source and destination directories from environment variables
    src_dirs, dest_dir = get_directories()
    if not src_dirs or not dest_dir:
        log_message("Source or destination directory not set in environment variables", level="ERROR")
        exit(1)

    # Get configuration from environment
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
                log_message(f"Initial scan after mount verification completed, found {len(current_files)} files. Monitor Service is Running", level="INFO")

            # Normal directory monitoring
            log_message("Performing regular directory scan", level="DEBUG")
            new_files = scan_directories(src_dirs, current_files)

            # Compare file counts for debugging
            log_message(f"Previous scan: {len(current_files)} files, Current scan: {len(new_files)} files", level="DEBUG")

            process_changes(current_files, new_files, dest_dir)
            current_files = new_files

            log_message(f"Sleeping for {sleep_time} seconds", level="DEBUG")
            time.sleep(sleep_time)

        except KeyboardInterrupt:
            log_message("Received shutdown signal, exiting gracefully", level="INFO")
            break
        except Exception as e:
            log_message(f"Unexpected error in main loop: {str(e)}", level="ERROR")
            import traceback
            log_message(f"Traceback: {traceback.format_exc()}", level="ERROR")
            time.sleep(sleep_time)

def main():
    """Main function to monitor directories and process file changes in real-time."""
    global mount_state
    log_message("Starting MediaHub directory monitor service", level="INFO")

    # Initialize the database
    initialize_db()

    # Load previously processed files from the database
    load_processed_files()

    # Get source and destination directories from environment variables
    src_dirs, dest_dir = get_directories()
    if not src_dirs or not dest_dir:
        log_message("Source or destination directory not set in environment variables", level="ERROR")
        exit(1)

    # Get configuration from environment
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

            # Normal directory monitoring
            log_message("Performing regular directory scan", level="DEBUG")
            new_files = scan_directories(src_dirs, current_files)
            process_changes(current_files, new_files, dest_dir)
            current_files = new_files

            log_message(f"Sleeping for {sleep_time} seconds", level="DEBUG")
            time.sleep(sleep_time)

        except KeyboardInterrupt:
            log_message("Received shutdown signal, exiting gracefully", level="INFO")
            break
        except Exception as e:
            log_message(f"Unexpected error in main loop: {str(e)}", level="ERROR")
            time.sleep(sleep_time)

if __name__ == "__main__":
    main()
