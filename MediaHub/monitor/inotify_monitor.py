import os
import inotify.adapters
import subprocess
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from utils.logging_utils import log_message
from processors.db_utils import initialize_db, load_processed_files, save_processed_file, delete_broken_symlinks, check_file_in_db
from config.config import get_directories
from processors.symlink_creator import delete_broken_symlinks

def setup_watches(i, dirs_to_watch, watched_paths):
    for directory in dirs_to_watch:
        if directory not in watched_paths:
            i.add_watch(directory, mask=inotify.constants.IN_CREATE | inotify.constants.IN_DELETE | inotify.constants.IN_MODIFY | inotify.constants.IN_MOVED_TO)
            watched_paths.add(directory)
        for subdir, _, _ in os.walk(directory):
            if subdir not in watched_paths:
                i.add_watch(subdir, mask=inotify.constants.IN_CREATE | inotify.constants.IN_DELETE | inotify.constants.IN_MODIFY | inotify.constants.IN_MOVED_TO)
                watched_paths.add(subdir)

def monitor_directories(dirs_to_watch, dest_dir):
    i = inotify.adapters.Inotify()
    watched_paths = set()
    setup_watches(i, dirs_to_watch, watched_paths)

    log_message("Started monitoring directories.", level="INFO")

    for event in i.event_gen(yield_nones=False):
        (_, type_names, path, filename) = event
        full_path = os.path.join(path, filename)

        log_message(f"Detected event types: {type_names} for path: {full_path}", level="DEBUG")

        if 'IN_DELETE' in type_names:
            log_message(f"Detected deletion: {full_path}", level="INFO")
            delete_broken_symlinks(dest_dir)
        elif os.path.isdir(full_path) and ('IN_CREATE' in type_names or 'IN_MOVED_TO' in type_names):
            log_message(f"Detected directory creation or move: {full_path}", level="INFO")
            try:
                subprocess.run(['python3', 'MediaHub/main.py', full_path, '--auto-select'], check=True)
            except subprocess.CalledProcessError as e:
                log_message(f"Error running script: {e}", level="ERROR")
        elif os.path.isfile(full_path) and ('IN_CREATE' in type_names or 'IN_MODIFY' in type_names):
            log_message(f"Detected file creation or modification: {full_path}", level="INFO")
            process_file(full_path)
        else:
            log_message(f"Detected unknown item: {full_path}", level="INFO")

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
