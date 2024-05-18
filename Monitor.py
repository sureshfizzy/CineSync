import os
import time
import subprocess
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler
import platform

# Check if the platform is Windows or Linux and print the OS version
if platform.system() == "Windows":
    print("Running on Windows")
    print("OS Version:", platform.version())
elif platform.system() == "Linux":
    print("Running on Linux")
    print("OS Version:", platform.version())
else:
    print("Unsupported operating system")

# Path to the directory you want to monitor
watch_dir = "path/to/Shows"

# Path to your Bash script
bash_script = "path/to/CineSync.sh"

# Print the watch directory
print(f"Watching directory: {watch_dir}", flush=True)

# Function to execute the Bash script with the specified path
def execute_bash_script(path):
    if platform.system() == "Windows":
        subprocess.run(['bash', '-c', f'source "{bash_script}" "{path}"'], shell=True)
    elif platform.system() == "Linux":
        subprocess.run([bash_script, path])

# Initial scan of the directory
def initial_scan():
    global current_files
    current_files = set(os.listdir(watch_dir))

# Periodic scan to check for changes
def periodic_scan():
    global current_files
    while True:
        print("Scanning directory for changes...", flush=True)
        new_files = set(os.listdir(watch_dir))
        added_files = new_files - current_files

        if added_files:
            print(f"Detected added files: {added_files}", flush=True)
            for file in added_files:
                full_path = os.path.join(watch_dir, file)
                execute_bash_script(full_path)

        current_files = new_files
        print("Scan complete.", flush=True)
        time.sleep(60)  # Adjust the sleep time as needed

if __name__ == "__main__":
    initial_scan()
    periodic_scan()