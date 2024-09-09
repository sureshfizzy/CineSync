import argparse
import subprocess
import os
import platform
from config.config import get_directories
from processors.symlink_creator import create_symlinks
from utils.logging_utils import log_message

LOCK_FILE = '/tmp/inotify_monitor.lock' if platform.system() != 'Windows' else 'C:\\temp\\watchdog_monitor.lock'

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

def start_inotify_monitor():
    if os.path.exists(LOCK_FILE):
        return

    with open(LOCK_FILE, 'w') as lock_file:
        lock_file.write("Monitor running\n")

    log_message("Processing complete. Setting up directory monitoring.", level="INFO")

    try:
        if platform.system() == 'Windows':
            subprocess.run(['python', 'MediaHub/monitor/watchdog_monitor.py'], check=True)
        else:
            subprocess.run(['python3', 'MediaHub/monitor/inotify_monitor.py'], check=True)
    except subprocess.CalledProcessError as e:
        log_message(f"Error running monitor script: {e}", level="ERROR")
    finally:
        if os.path.exists(LOCK_FILE):
            os.remove(LOCK_FILE)

def main():
    parser = argparse.ArgumentParser(description="Create symlinks for files from src_dirs in dest_dir.")
    parser.add_argument("--auto-select", action="store_true", help="Automatically chooses the first option without prompting the user")
    parser.add_argument("single_path", nargs="?", help="Single path to process instead of using SOURCE_DIRS from environment variables")
    args = parser.parse_args()

    src_dirs, dest_dir = get_directories()
    if not src_dirs or not dest_dir:
        log_message("Source or destination directory not set in environment variables.", level="ERROR")
        exit(1)

    create_symlinks(src_dirs, dest_dir, auto_select=args.auto_select, single_path=args.single_path)

    start_inotify_monitor()

if __name__ == "__main__":
    main()
