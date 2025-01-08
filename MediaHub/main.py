import argparse
import subprocess
import os
import sys
import platform
import time
import psutil
import signal

# Append the parent directory to the system path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Local imports from MediaHub
from MediaHub.config.config import *
from MediaHub.processors.symlink_creator import create_symlinks
from MediaHub.utils.logging_utils import log_message
from MediaHub.processors.db_utils import *
from MediaHub.processors.symlink_creator import *
from MediaHub.monitor.polling_monitor import *

db_initialized = False

POLLING_MONITOR_PATH = os.path.join(os.path.dirname(__file__), 'monitor', 'polling_monitor.py')
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
        subprocess.run([python_command, POLLING_MONITOR_PATH], check=True)
    except subprocess.CalledProcessError as e:
        log_message(f"Error running monitor script: {e}", level="ERROR")
    finally:
        remove_lock_file()

def main(dest_dir):
    parser = argparse.ArgumentParser(description="Create symlinks for files from src_dirs in dest_dir.")
    parser.add_argument("--auto-select", action="store_true", help="Automatically chooses the first option without prompting the user")
    parser.add_argument("single_path", nargs="?", help="Single path to process instead of using SOURCE_DIRS from environment variables")
    parser.add_argument("--force", action="store_true", help="Force recreate symlinks even if they already exist")

    db_group = parser.add_argument_group('Database Management')
    db_group.add_argument("--reset", action="store_true",
                         help="Reset the database to its initial state")
    db_group.add_argument("--status", action="store_true",
                         help="Display database statistics")
    db_group.add_argument("--vacuum", action="store_true",
                         help="Perform database vacuum to optimize storage and performance")
    db_group.add_argument("--verify", action="store_true",
                         help="Verify database integrity and check for corruption")
    db_group.add_argument("--export", metavar="FILE",
                         help="Export database contents to a CSV file")
    db_group.add_argument("--import", metavar="FILE", dest="import_file",
                         help="Import database contents from a CSV file")
    db_group.add_argument("--search", metavar="PATTERN",
                         help="Search for files in database matching the given pattern")
    db_group.add_argument("--optimize", action="store_true",
                         help="Optimize database indexes and analyze tables")

    args = parser.parse_args()

    if args.vacuum:
        vacuum_database()
        return

    if args.verify:
        verify_database_integrity()
        return

    if args.export:
        export_database(args.export)
        return

    if args.import_file:
        import_database(args.import_file)
        return

    if args.search:
        search_database(args.search)
        return

    if args.optimize:
        optimize_database()
        return

    if args.reset:
        if input("Are you sure you want to reset the database? This will delete all entries. (Y/N): ").lower() == 'y':
            reset_database()
            return

    if args.status:
        stats = get_database_stats()
        if stats:
            log_message("Database Statistics:", level="INFO")
            log_message(f"Total Records: {stats['total_records']}", level="INFO")
            log_message(f"Archived Records: {stats['archived_records']}", level="INFO")
            log_message(f"Main DB Size: {stats['main_db_size']:.2f} MB", level="INFO")
            log_message(f"Archive DB Size: {stats['archive_db_size']:.2f} MB", level="INFO")
        return

    if not os.path.exists(LOCK_FILE):
        # Wait for mount if needed and initialize database
        initialize_db_with_mount_check()

        # Define the callback function to be called once the background task finishes
        def on_missing_files_check_done():
            log_message("Database import completed.", level="INFO")

        # Function to run the missing files check and call the callback when done
        def display_missing_files_with_callback(dest_dir, callback):
            display_missing_files_with_mount_check(dest_dir)
            callback()

        # Run missing files check in a separate thread
        missing_files_thread = threading.Thread(target=display_missing_files_with_callback, args=(dest_dir, on_missing_files_check_done))
        missing_files_thread.daemon = False
        missing_files_thread.start()

        #Symlink cleanup
        cleanup_thread = threading.Thread(target=run_symlink_cleanup, args=(dest_dir,))
        cleanup_thread.daemon = False
        cleanup_thread.start()

    src_dirs, dest_dir = get_directories()
    if not src_dirs or not dest_dir:
        log_message("Source or destination directory not set in environment variables.", level="ERROR")
        exit(1)

    # Wait for mount before creating symlinks if needed
    if is_rclone_mount_enabled() and not check_rclone_mount():
        wait_for_mount()

    # Start polling monitor in main thread
    monitor_thread = threading.Thread(target=start_polling_monitor)
    monitor_thread.daemon = False
    monitor_thread.start()
    time.sleep(2)

    create_symlinks(src_dirs, dest_dir, auto_select=args.auto_select, single_path=args.single_path, force=args.force, mode='create')
    monitor_thread.join()

if __name__ == "__main__":
    setup_signal_handlers()
    src_dirs, dest_dir = get_directories()
    main(dest_dir)
