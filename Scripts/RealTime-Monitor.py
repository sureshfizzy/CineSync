import os
import time
import subprocess
import platform
from dotenv import load_dotenv, find_dotenv

# ANSI escape code for red color
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

# Get directories from .env file
watch_dirs = os.getenv('SOURCE_DIR')
destination_dir = os.getenv('DESTINATION_DIR')

# Check if the platform is Windows or Linux and print the OS version
if platform.system() == "Windows":
    print("Running on Windows")
    print("OS Version:", platform.version())
elif platform.system() == "Linux":
    print("Running on Linux")
    print("OS Version:", platform.version())
else:
    print("Unsupported operating system")

# Path to your Bash script
script_dir = os.path.dirname(os.path.abspath(__file__))
bash_script = os.path.join(script_dir, "library.sh")

# Function to execute the Bash script with the specified path
def execute_bash_script(path):
    if platform.system() == "Windows":
        subprocess.run(['bash', '-c', f'source "{bash_script}" "{path}"'], shell=True)
    elif platform.system() == "Linux":
        subprocess.run(['/bin/bash', bash_script, path])

# Split the watch directories string into a list
if watch_dirs:
    watch_dirs = watch_dirs.split(',')
    print(f"Watching directories: {watch_dirs}", flush=True)
else:
    print(RED_COLOR + "Error: SOURCE_DIR not set in .env file." + RESET_COLOR)
    exit(1)  # Exit the script if watch_dirs is not set

if destination_dir:
    print(f"Destination directory: {destination_dir}", flush=True)
else:
    print(RED_COLOR + "Error: DESTINATION_DIR not set in .env file." + RESET_COLOR)
    exit(1)  # Exit the script if destination_dir is not set

# Initial scan of the directories
def initial_scan():
    global current_files
    current_files = {}
    for watch_dir in watch_dirs:
        try:
            current_files[watch_dir] = set(os.listdir(watch_dir))
        except FileNotFoundError:
            print(f"Error: Watch directory '{watch_dir}' not found.")
            print("Please set the correct source path in the .env file.")
            exit(1)

# Periodic scan to check for changes
def periodic_scan():
    global current_files
    while True:
        print("Scanning directories for changes...", flush=True)
        for watch_dir in watch_dirs:
            try:
                new_files = set(os.listdir(watch_dir))
            except FileNotFoundError:
                print(f"Error: Watch directory '{watch_dir}' not found.")
                print("Please set the correct source path in the .env file.")
                exit(1)

            added_files = new_files - current_files[watch_dir]

            if added_files:
                print(f"Detected added files in '{watch_dir}': {added_files}", flush=True)
                for file in added_files:
                    full_path = os.path.join(watch_dir, file)
                    execute_bash_script(full_path)

            current_files[watch_dir] = new_files
        print("Scan complete.", flush=True)
        time.sleep(60)  # Adjust the sleep time as needed

if __name__ == "__main__":
    initial_scan()
    periodic_scan()
