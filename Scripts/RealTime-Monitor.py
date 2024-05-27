import os
import time
import subprocess
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler
import platform

# ANSI escape code for red color
RED_COLOR = '\033[91m'
RESET_COLOR = '\033[0m'

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
bash_script = "library.sh"

# Function to execute the Bash script with the specified path
def execute_bash_script(path):
    try:
        if platform.system() == "Windows":
            subprocess.run(['bash', '-c', f'source "{bash_script}" "{path}"'], shell=True, check=True)
        elif platform.system() == "Linux":
            subprocess.run([bash_script, path], check=True)
    except subprocess.CalledProcessError as e:
        print(f"{RED_COLOR}Error executing script: {e}{RESET_COLOR}")

# Read the value of watch_dir and destination_dir from the Bash script
def get_dirs():
    watch_dir = None
    destination_dir = None
    try:
        with open(bash_script, 'r') as f:
            for line in f:
                if line.startswith('show_source_dir='):
                    watch_dir = line.split('=')[1].strip().strip('"')
                elif line.startswith('destination_dir='):
                    destination_dir = line.split('=')[1].strip().strip('"')
        if not watch_dir:
            print("Warning: Source path not set in library.sh. Please set the source path.")
        if not destination_dir:
            print(RED_COLOR + "Error: Destination path not set in library.sh. Please set the destination path." + RESET_COLOR)
        return watch_dir, destination_dir
    except FileNotFoundError:
        print(f"Error: {bash_script} not found.")
        return None, None

# Print the watch and destination directories
watch_dir, destination_dir = get_dirs()
if watch_dir:
    print(f"Watching directory: {watch_dir}", flush=True)
else:
    exit(1)  # Exit the script if watch_dir is not set

if destination_dir:
    print(f"Destination directory: {destination_dir}", flush=True)
else:
    exit(1)  # Exit the script if destination_dir is not set

# Initial scan of the directory
def initial_scan(watch_dir, destination_dir):
    try:
        current_files = set(os.listdir(watch_dir))
    except FileNotFoundError:
        print(f"Error: Watch directory '{watch_dir}' not found.")
        print("Please set the correct source path in library.sh.")
        exit(1)

    if not os.listdir(destination_dir):
        print(RED_COLOR + "Error: Destination directory is empty." + RESET_COLOR)
        exit(1)

    return current_files

# Event handler for watchdog
class MyHandler(FileSystemEventHandler):
    def on_created(self, event):
        if not event.is_directory:
            print(f"Detected added file: {event.src_path}", flush=True)
            execute_bash_script(event.src_path)

if __name__ == "__main__":
    current_files = initial_scan(watch_dir, destination_dir)

    # Set up watchdog observer
    event_handler = MyHandler()
    observer = Observer()
    observer.schedule(event_handler, path=watch_dir, recursive=False)
    observer.start()

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        observer.stop()
    observer.join()
