import os
import watchdog
import subprocess
import sys
import logging
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from processors.db_utils import initialize_db, load_processed_files, save_processed_file, delete_broken_symlinks, check_file_in_db
from config.config import get_directories
from processors.symlink_creator import delete_broken_symlinks

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s', stream=sys.stdout)

def log_message(message, level="INFO"):
    levels = {
        "DEBUG": logging.DEBUG,
        "INFO": logging.INFO,
        "WARNING": logging.WARNING,
        "ERROR": logging.ERROR,
        "CRITICAL": logging.CRITICAL,
    }
    logging.log(levels.get(level, logging.INFO), message)


class DirectoryEventHandler(FileSystemEventHandler):
    def __init__(self, dest_dir):
        self.dest_dir = dest_dir

    def on_created(self, event):
        full_path = event.src_path
        log_message(f"Detected creation: {full_path}", level="INFO")
        if event.is_directory:
            log_message(f"Detected directory creation: {full_path}", level="INFO")
            try:
                subprocess.run(['python3', 'MediaHub/main.py', full_path, '--auto-select'], check=True)
            except subprocess.CalledProcessError as e:
                log_message(f"Error running script: {e}", level="ERROR")
        else:
            process_file(full_path)

    def on_modified(self, event):
        if not event.is_directory:
            full_path = event.src_path
            log_message(f"Detected modification: {full_path}", level="INFO")
            process_file(full_path)

    def on_deleted(self, event):
        full_path = event.src_path
        log_message(f"Detected deletion: {full_path}", level="INFO")
        delete_broken_symlinks(self.dest_dir)


def process_file(file_path):
    log_message(f"Processing file: {file_path}", level="INFO")
    if not check_file_in_db(file_path):
        log_message(f"File path not found in database. Saving: {file_path}", level="DEBUG")
        subprocess.run(['python3', 'MediaHub/main.py', file_path, '--auto-select'], check=True)
        save_processed_file(file_path)
    else:
        log_message(f"File path already exists in database: {file_path}", level="DEBUG")
    try:
        subprocess.run(['python3', 'MediaHub/main.py', file_path, '--auto-select'], check=True)
    except subprocess.CalledProcessError as e:
        log_message(f"Error running script: {e}", level="ERROR")


def monitor_directories(dirs_to_watch, dest_dir):
    event_handler = DirectoryEventHandler(dest_dir)
    observer = Observer()

    for directory in dirs_to_watch:
        observer.schedule(event_handler, path=directory, recursive=True)
        log_message(f"Started watching directory: {directory}", level="INFO")

    observer.start()
    try:
        while True:
            pass  # Run indefinitely
    except KeyboardInterrupt:
        observer.stop()

    observer.join()


def main():
    # Initialize the database
    initialize_db()

    # Load existing processed files from the database
    load_processed_files()

    src_dirs, dest_dir = get_directories()
    if not src_dirs or not dest_dir:
        log_message("Source or destination directory not set in environment variables.", level="ERROR")
        exit(1)

    monitor_directories(src_dirs, dest_dir)


if __name__ == "__main__":
    main()
