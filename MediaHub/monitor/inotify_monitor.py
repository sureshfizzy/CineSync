import os
import inotify.adapters
import subprocess
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from utils.logging_utils import log_message

def setup_watches(i, dirs_to_watch, watched_paths):
    for directory in dirs_to_watch:
        if directory not in watched_paths:
            i.add_watch(directory, mask=inotify.constants.IN_CREATE | inotify.constants.IN_DELETE | inotify.constants.IN_MODIFY | inotify.constants.IN_MOVED_TO)
            watched_paths.add(directory)
        for subdir, _, _ in os.walk(directory):
            if subdir not in watched_paths:
                i.add_watch(subdir, mask=inotify.constants.IN_CREATE | inotify.constants.IN_DELETE | inotify.constants.IN_MODIFY | inotify.constants.IN_MOVED_TO)
                watched_paths.add(subdir)

def monitor_directories(dirs_to_watch):
    i = inotify.adapters.Inotify()
    watched_paths = set()
    setup_watches(i, dirs_to_watch, watched_paths)

    log_message("Started monitoring directories.", level="INFO")

    for event in i.event_gen(yield_nones=False):
        (_, type_names, path, filename) = event
        full_path = os.path.join(path, filename)

        if os.path.isdir(full_path):
            log_message(f"Detected directory: {full_path}", level="INFO")
            try:
                subprocess.run(['python3', 'MediaHub/main.py', full_path, '--auto-select'], check=True)
            except subprocess.CalledProcessError as e:
                log_message(f"Error running script: {e}", level="ERROR")
        elif os.path.isfile(full_path):
            log_message(f"Detected file: {full_path}", level="INFO")
            process_file(full_path)
        else:
            log_message(f"Detected unknown item: {full_path}", level="INFO")

def process_file(file_path):
    log_message(f"Processing file: {file_path}", level="INFO")
    subprocess.run(['python3', 'MediaHub/main.py', file_path, '--auto-select'], check=True)

def main():
    from config.config import get_directories
    src_dirs, _ = get_directories()
    if not src_dirs:
        log_message("Source directory not set in environment variables.", level="ERROR")
        exit(1)

    monitor_directories(src_dirs)

if __name__ == "__main__":
    main()
