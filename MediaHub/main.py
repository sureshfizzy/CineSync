import argparse
import subprocess
import os
import platform
import time
import psutil
import signal
from config.config import *
from processors.symlink_creator import create_symlinks
from utils.logging_utils import log_message
from processors.db_utils import *
from processors.symlink_creator import *
from monitor.polling_monitor import *

db_initialized = False

LOCK_FILE = '/tmp/polling_monitor.lock' if platform.system() != 'Windows' else 'C:\\temp\\polling_monitor.lock'
LOCK_TIMEOUT = 3600

# Load .env file from the parent directory
dotenv_path = find_dotenv('../.env')
if not dotenv_path:
    print(RED_COLOR + "Error: .env file not found in the parent directory." + RESET_COLOR)
    exit(1)

load_dotenv(dotenv_path)

def wait_for_mount():
    """Wait for the rclone mount to become available with minimal logging."""
    initial_message = True
    while True:
        if check_rclone_mount():
            if initial_message:
                log_message("Mount is now available.", level="INFO")
            return True

        if initial_message:
            log_message(f"Waiting for mount directory to become available...", level="INFO")
            initial_message = False

        time.sleep(is_mount_check_interval())

def initialize_db_with_mount_check():
    """Initialize database after ensuring mount is available."""
    global db_initialized

    if not db_initialized:

        if is_rclone_mount_enabled():
            wait_for_mount()

        initialize_db()
        db_initialized = True

def display_missing_files_with_mount_check(dest_dir):
    """Display missing files after ensuring mount is available."""

    if is_rclone_mount_enabled():
        wait_for_mount()

    display_missing_files(dest_dir)

def ensure_windows_temp_directory():
    """Create the C:\\temp directory if it does not exist on Windows."""
    if platform.system() == 'Windows':
        temp_dir = 'C:\\temp'
        if not os.path.exists(temp_dir):
            try:
                os.makedirs(temp_dir)
                log_message(f"Created directory: {temp_dir}", level="INFO")
            except OSError as e:
                log_message(f"Error creating directory {temp_dir}: {e}", level="ERROR")
                exit(1)

def is_process_running(pid):
    """Check if a process with a given PID is still running."""
    try:
        return psutil.pid_exists(pid) and psutil.Process(pid).is_running()
    except psutil.NoSuchProcess:
        return False

def create_lock_file():
    """Create the lock file and write the process ID and timestamp."""
    with open(LOCK_FILE, 'w') as lock_file:
        lock_file.write(f"{os.getpid()}\n")
        lock_file.write(f"{time.time()}\n")

def check_lock_file():
    """Check if a lock file exists and whether it's stale or the process is still running."""
    if os.path.exists(LOCK_FILE):
        try:
            with open(LOCK_FILE, 'r') as lock_file:
                pid = int(lock_file.readline().strip())
                lock_time = float(lock_file.readline().strip())

                # Check if the process is still running
                if is_process_running(pid):
                    return True

                # Check if the lock file is too old (stale)
                if time.time() - lock_time > LOCK_TIMEOUT:
                    log_message(f"Stale lock file found. Removing lock.", level="WARNING")
                    os.remove(LOCK_FILE)
                else:
                    log_message(f"Lock file exists but process not running. Removing lock.", level="WARNING")
                    os.remove(LOCK_FILE)
        except (OSError, ValueError):
            log_message(f"Error reading lock file. Removing lock.", level="ERROR")
            os.remove(LOCK_FILE)
    return False

def remove_lock_file():
    """Remove the lock file."""
    if os.path.exists(LOCK_FILE):
        os.remove(LOCK_FILE)

def handle_exit(signum, frame):
    """Handle script termination and clean up the lock file."""
    log_message("Terminating process and cleaning up lock file.", level="INFO")
    remove_lock_file()
    exit(0)

def setup_signal_handlers():
    """Setup signal handlers for Linux and Windows."""
    if platform.system() == 'Windows':
        signal.signal(signal.SIGBREAK, handle_exit)
    else:
        signal.signal(signal.SIGINT, handle_exit)
        signal.signal(signal.SIGTERM, handle_exit)

def start_polling_monitor():
    if check_lock_file():
        return

    create_lock_file()

    log_message("Processing complete. Setting up directory monitoring.", level="INFO")

    try:
        # Use python or python3 depending on the platform
        python_command = 'python' if platform.system() == 'Windows' else 'python3'
        subprocess.run([python_command, 'MediaHub/monitor/polling_monitor.py'], check=True)
    except subprocess.CalledProcessError as e:
        log_message(f"Error running monitor script: {e}", level="ERROR")
    finally:
        remove_lock_file()

def main(dest_dir):
    parser = argparse.ArgumentParser(description="Create symlinks for files from src_dirs in dest_dir.")
    parser.add_argument("--auto-select", action="store_true", help="Automatically chooses the first option without prompting the user")
    parser.add_argument("single_path", nargs="?", help="Single path to process instead of using SOURCE_DIRS from environment variables")
    args = parser.parse_args()

    if not os.path.exists(LOCK_FILE):
        # Wait for mount if needed and initialize database
        initialize_db_with_mount_check()

        # Log database import message
        log_message("Database import completed.", level="INFO")

        # Wait for mount if needed and display missing files
        display_missing_files_with_mount_check(dest_dir)
        log_message("Database import completed.", level="INFO")

    src_dirs, dest_dir = get_directories()
    if not src_dirs or not dest_dir:
        log_message("Source or destination directory not set in environment variables.", level="ERROR")
        exit(1)

    # Wait for mount before creating symlinks if needed
    if is_rclone_mount_enabled() and not check_rclone_mount():
        wait_for_mount()

    create_symlinks(src_dirs, dest_dir, auto_select=args.auto_select, single_path=args.single_path)
    start_polling_monitor()

if __name__ == "__main__":
    setup_signal_handlers()
    src_dirs, dest_dir = get_directories()
    main(dest_dir)
