import os
import time
import subprocess
import logging
import sys
from dotenv import load_dotenv, find_dotenv

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from processors.db_utils import initialize_db, load_processed_files, save_processed_file, delete_broken_symlinks, check_file_in_db
from config.config import *
from processors.symlink_creator import delete_broken_symlinks

# Load .env file from the parent directory
dotenv_path = find_dotenv('../.env')
if not dotenv_path:
    print(RED_COLOR + "Error: .env file not found in the parent directory." + RESET_COLOR)
    exit(1)

load_dotenv(dotenv_path)

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s', datefmt='%Y-%m-%d %H:%M:%S', stream=sys.stdout)

# Add state variables for mount status tracking
mount_state = None

def log_message(message, level="INFO"):
    """Logs a message at the specified level with additional context."""
    levels = {
        "DEBUG": logging.DEBUG,
        "INFO": logging.INFO,
        "WARNING": logging.WARNING,
        "ERROR": logging.ERROR,
        "CRITICAL": logging.CRITICAL,
    }
    logging.log(levels.get(level, logging.INFO), message)

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

def verify_rclone_mount(directory):
    """
    Verifies if the directory is under a mount and checks mount health.
    Returns tuple: (is_mounted, has_version_file)
    """
    global mount_state
    log_message(f"Verifying mount status for directory: {directory}", level="DEBUG")

    # Check if directory exists
    if not os.path.exists(directory):
        mount_state = False
        return False, False

    # Find the mount point for this directory
    is_mounted, mount_point = get_mount_point(directory)

    if is_mounted and mount_point:
        if mount_state is not True:
            log_message(f"Directory {directory} is under mount point: {mount_point}", level="INFO")
            mount_state = True

        # Perform mount health check
        try:
            # Try to list directory contents to verify mount is responsive
            os.listdir(directory)

            # Simply check if version.txt exists
            version_file = os.path.join(mount_point, 'version.txt')
            has_version_file = os.path.exists(version_file)

            log_message(f"Version file is {'present' if has_version_file else 'missing'} at mount point {mount_point}", level="DEBUG")
            return True, has_version_file

        except Exception as e:
            log_message(f"Mount point appears unresponsive: {str(e)}", level="WARNING")
            mount_state = False
            return False, False
    else:
        mount_state = False
        return False, False

def check_rclone_mount():
    """
    Checks if the mount is available and healthy.
    Returns True if either RCLONE_MOUNT is False or if the mount is verified.
    """
    global mount_state

    if not is_rclone_mount_enabled():
        log_message("Mount check is disabled", level="INFO")
        return True

    src_dirs, _ = get_directories()
    if not src_dirs:
        log_message("No source directories configured in environment", level="ERROR")
        return False

    directory = src_dirs[0]
    current_state = mount_state

    try:
        is_mounted, has_version_file = verify_rclone_mount(directory)

        if is_mounted:
            if not has_version_file:
                log_message(f"Mount detected, creating version file", level="INFO")
                if not create_version_file(directory):
                    log_message("Failed to create version file, mount may be read-only", level="ERROR")
                    return False
            return True
        else:
            if current_state is not False:
                if not os.path.exists(directory):
                    log_message(f"Mount unavailable - Directory does not exist: {directory}", level="WARNING")
                else:
                    log_message(f"Mount unavailable - Directory is not mounted or unresponsive: {directory}", level="WARNING")
                mount_state = False
            return False

    except Exception as e:
        if current_state is not False:
            log_message(f"Error checking mount: {str(e)}", level="ERROR")
            mount_state = False
        return False

def create_version_file(directory):
    """Creates version.txt file if it doesn't exist in the mounted directory."""
    # First find the mount point
    is_mounted, mount_point = get_mount_point(directory)
    if not is_mounted or not mount_point:
        log_message(f"Cannot create version file - no valid mount point found for {directory}", level="ERROR")
        return False

    version_file = os.path.join(mount_point, 'version.txt')
    log_message(f"Checking for version file at mount point: {version_file}", level="DEBUG")

    if not os.path.exists(version_file):
        try:
            timestamp = time.strftime('%Y-%m-%d %H:%M:%S')
            content = (
                f"MediaHub Rclone Mount Verification File\n"
                f"Created: {timestamp}\n"
                f"Mount Point: {mount_point}\n"
                f"Monitored Directory: {directory}"
            )
            with open(version_file, 'w') as f:
                f.write(content)
            log_message(f"Successfully created version.txt in mount point {mount_point}", level="INFO")
            return True
        except Exception as e:
            log_message(f"Failed to create version.txt in mount point {mount_point}: {str(e)}", level="ERROR")
            return False
    else:
        log_message(f"Version file already exists at mount point {mount_point}", level="DEBUG")
    return True

def scan_directories(dirs_to_watch, current_files):
    """Scans directories for new or removed files."""
    new_files = {}
    for directory in dirs_to_watch:
        log_message(f"Scanning directory: {directory}", level="DEBUG")

        if not os.path.exists(directory):
            log_message(f"Watch directory not found: {directory}", level="ERROR")
            continue

        try:
            dir_files = set(os.listdir(directory))
            new_files[directory] = dir_files
            log_message(f"Found {len(dir_files)} files in {directory}", level="DEBUG")
        except Exception as e:
            log_message(f"Failed to scan directory {directory}: {str(e)}", level="ERROR")
            continue

    return new_files

def process_changes(current_files, new_files, dest_dir):
    """Processes changes by detecting added or removed files and triggering actions."""
    for directory, files in new_files.items():
        old_files = current_files.get(directory, set())
        added_files = files - old_files
        removed_files = old_files - files

        if added_files:
            log_message(f"New files detected in {directory}: {added_files}", level="INFO")
            for file in added_files:
                if file != 'version.txt':  # Skip processing version.txt file
                    full_path = os.path.join(directory, file)
                    log_message(f"Processing new file: {full_path}", level="INFO")
                    process_file(full_path)
                else:
                    log_message("Skipping version.txt file processing", level="DEBUG")

        if removed_files:
            log_message(f"Detected {len(removed_files)} removed files from {directory}: {removed_files}", level="INFO")

    log_message(f"Checking for broken symlinks in {dest_dir}", level="DEBUG")
    delete_broken_symlinks(dest_dir)

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

    # Get source and destination directories from environment variables
    src_dirs, dest_dir = get_directories()
    if not src_dirs or not dest_dir:
        log_message("Source or destination directory not set in environment variables", level="ERROR")
        exit(1)

    # Get configuration from environment
    sleep_time = int(os.getenv('SLEEP_TIME', 60))
    #mount_check_interval = int(os.getenv('MOUNT_CHECK_INTERVAL', 30))

    current_files = {}
    while True:
        try:
            # Check if rclone mount is available (if enabled)
            if not check_rclone_mount():
                if mount_state is not False:
                    log_message("Mount not available, waiting for rclone mount...", level="INFO")
                    mount_state = False
                #return False, False
                #time.sleep(mount_check_interval)
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
