import os
import time
import subprocess
import logging
import sys
from dotenv import load_dotenv, find_dotenv

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from processors.db_utils import initialize_db, load_processed_files, save_processed_file, delete_broken_symlinks, check_file_in_db
from config.config import get_directories
from processors.symlink_creator import delete_broken_symlinks

# Load .env file from the parent directory
dotenv_path = find_dotenv('../.env')
if not dotenv_path:
    print(RED_COLOR + "Error: .env file not found in the parent directory." + RESET_COLOR)
    exit(1)

load_dotenv(dotenv_path)

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s', datefmt='%Y-%m-%d %H:%M:%S', stream=sys.stdout)

def log_message(message, level="INFO"):
    levels = {
        "DEBUG": logging.DEBUG,
        "INFO": logging.INFO,
        "WARNING": logging.WARNING,
        "ERROR": logging.ERROR,
        "CRITICAL": logging.CRITICAL,
    }
    logging.log(levels.get(level, logging.INFO), message)

def scan_directories(dirs_to_watch, current_files):
    new_files = {}
    for directory in dirs_to_watch:
        if not os.path.exists(directory):
            log_message(f"Error: Watch directory '{directory}' not found.", level="ERROR")
            continue

        try:
            new_files[directory] = set(os.listdir(directory))
        except Exception as e:
            log_message(f"Error scanning directory '{directory}': {e}", level="ERROR")
            continue

    return new_files

def process_changes(current_files, new_files, dest_dir):
    for directory, files in new_files.items():
        old_files = current_files.get(directory, set())
        added_files = files - old_files
        removed_files = old_files - files

        if added_files:
            log_message(f"Detected added files in {directory}: {added_files}", level="INFO")
            for file in added_files:
                full_path = os.path.join(directory, file)
                log_message(f"Processing added file: {full_path}", level="INFO")
                process_file(full_path)

        if removed_files:
            log_message(f"Detected removed files in {directory}: {removed_files}", level="INFO")

    delete_broken_symlinks(dest_dir)

def process_file(file_path):
    log_message(f"Processing file: {file_path}", level="INFO")
    if not check_file_in_db(file_path):
        log_message(f"File path not found in database. Saving: {file_path}", level="DEBUG")
        try:
            subprocess.run(['python3', 'MediaHub/main.py', file_path, '--auto-select'], check=True)
        except subprocess.CalledProcessError as e:
            log_message(f"Error running script: {e}", level="ERROR")
        save_processed_file(file_path)
    else:
        log_message(f"File path already exists in database: {file_path}", level="DEBUG")

def initial_scan(dirs_to_watch):
    current_files = {}
    for directory in dirs_to_watch:
        if os.path.exists(directory):
            try:
                current_files[directory] = set(os.listdir(directory))
            except Exception as e:
                log_message(f"Error during initial scan of directory '{directory}': {e}", level="ERROR")
        else:
            log_message(f"Error: Watch directory '{directory}' not found during initial scan.", level="ERROR")
    return current_files

def main():
    # Initialize the database
    initialize_db()

    # Load existing processed files from the database
    load_processed_files()

    src_dirs, dest_dir = get_directories()
    if not src_dirs or not dest_dir:
        log_message("Source or destination directory not set in environment variables.", level="ERROR")
        exit(1)

    current_files = initial_scan(src_dirs)

    # Use SLEEP_TIME from environment variables, default to 60 seconds if not set
    sleep_time = int(os.getenv('SLEEP_TIME', 60))
    log_message(f"Scanning directories for changes...", level="INFO")
    while True:
        new_files = scan_directories(src_dirs, current_files)
        process_changes(current_files, new_files, dest_dir)
        current_files = new_files
        time.sleep(sleep_time)

if __name__ == "__main__":
    main()
