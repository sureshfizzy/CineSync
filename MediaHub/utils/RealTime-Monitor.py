import os
import time
import subprocess
import platform
import logging
from dotenv import load_dotenv, find_dotenv
import sys

# ANSI escape codes for colors
RED_COLOR = '\033[91m'
RESET_COLOR = '\033[0m'

# Load .env file from the parent directory
dotenv_path = find_dotenv('../.env')
if not dotenv_path:
    print(RED_COLOR + "Error: .env file not found in the parent directory." + RESET_COLOR)
    exit(1)
else:
    print(f".env file found at: {dotenv_path}", flush=True)

load_dotenv(dotenv_path)

# Get directories and sleep time from .env file
watch_dirs = os.getenv('SOURCE_DIR')
destination_dir = os.getenv('DESTINATION_DIR')
sleep_time = os.getenv('SLEEP_TIME', '60')

try:
    sleep_time = int(sleep_time)
except ValueError:
    print(RED_COLOR + "Error: SLEEP_TIME must be an integer." + RESET_COLOR)
    exit(1)

if watch_dirs:
    watch_dirs = watch_dirs.split(',')
    print(f"Watching directories: {watch_dirs}", flush=True)
else:
    print(RED_COLOR + "Error: SOURCE_DIR not set in .env file." + RESET_COLOR)
    exit(1)

if destination_dir:
    print(f"Destination directory: {destination_dir}", flush=True)
else:
    print(RED_COLOR + "Error: DESTINATION_DIR not set in .env file." + RESET_COLOR)
    exit(1)

# Setup logging for broken symlinks and script actions in the main directory
main_directory = os.path.abspath(os.path.join(os.path.dirname(__file__), "../.."))
logs_folder = os.path.join(main_directory, 'logs')
if not os.path.exists(logs_folder):
    os.makedirs(logs_folder)

def setup_logging(log_folder):
    log_file = os.path.join(log_folder, 'script.log')
    logging.basicConfig(filename=log_file, level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
    return log_file

setup_logging(logs_folder)

# Function to find broken symlinks
def find_broken_symlinks(directory):
    broken_symlinks = []
    for root, dirs, files in os.walk(directory):
        for name in files + dirs:
            path = os.path.join(root, name)
            if os.path.islink(path) and not os.path.exists(os.readlink(path)):
                broken_symlinks.append(path)
    return broken_symlinks

# Function to execute the Python script with the specified path
def execute_python_script(path):
    python_script = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', "main.py")
    if platform.system() == "Windows":
        subprocess.run(['python', python_script, '--auto-select', path], shell=True)
    elif platform.system() == "Linux":
        subprocess.run(['python3', python_script, '--auto-select', path])

# Initial scan of the directories and broken symlinks
def initial_scan():
    global current_files
    current_files = {}
    for watch_dir in watch_dirs:
        try:
            # Scan for directory content
            current_files[watch_dir] = set(os.listdir(watch_dir))

            # Scan for broken symlinks
            log_broken_symlinks()
        except FileNotFoundError:
            print(f"Error: Watch directory '{watch_dir}' not found.")
            print("Please set the correct source path in the .env file.")
            exit(1)

def log_broken_symlinks():
    broken_symlinks = find_broken_symlinks(destination_dir)
    if broken_symlinks:
        log_file = os.path.join(logs_folder, 'final_broken_symlinks.log')
        with open(log_file, 'w') as log:
            log.write(f"Broken symlinks in {destination_dir}:\n")
            for symlink in broken_symlinks:
                log.write(f"{symlink}\n")

        # Delete broken symlinks and remove empty folders
        for symlink in broken_symlinks:
            os.remove(symlink)
            logging.info(f"Deleted broken symlink: {symlink}")

            # Remove parent folder if it becomes empty
            parent_dir = os.path.dirname(symlink)
            if not os.listdir(parent_dir):
                os.rmdir(parent_dir)
                logging.info(f"Deleted empty folder: {parent_dir}")

# Periodic scan to check for changes and broken symlinks
def periodic_scan():
    global current_files
    while True:
        print("Scanning directories for changes and broken symlinks...", flush=True)
        for watch_dir in watch_dirs:
            try:
                new_files = set(os.listdir(watch_dir))
            except FileNotFoundError:
                print(f"Error: Watch directory '{watch_dir}' not found.")
                print("Please set the correct source path in the .env file.")
                exit(1)

            added_files = new_files - current_files[watch_dir]
            if added_files:
                print(f"Detected added files in {watch_dir}: {added_files}", flush=True)
                logging.info(f"Detected added files in {watch_dir}: {added_files}")
                for file in added_files:
                    full_path = os.path.join(watch_dir, file)
                    execute_python_script(full_path)

            current_files[watch_dir] = new_files

        # Check for broken symlinks in DESTINATION_DIR
        log_broken_symlinks()

        print("Scan complete.", flush=True)
        time.sleep(sleep_time)

def check_terminal():
    if not sys.stdin.isatty():
        print(RED_COLOR + "Warning: The script is not run from a terminal." + RESET_COLOR)
        print("Press any key to continue...")
        sys.stdin.read()

if __name__ == "__main__":
    check_terminal()
    initial_scan()
    periodic_scan()
