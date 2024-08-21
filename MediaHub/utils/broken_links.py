import os
import sys
import logging

def setup_logging(log_folder):
    if not os.path.exists(log_folder):
        os.makedirs(log_folder)
    log_file = os.path.join(log_folder, 'script.log')
    logging.basicConfig(filename=log_file, level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
    return log_file

def read_directories(config_file):
    directories = []
    if os.path.isfile(config_file):
        with open(config_file, 'r') as file:
            for line in file:
                directory = line.strip().replace('\\', '/')
                directories.append(directory)
    else:
        logging.error(f"Configuration file not found: {config_file}")
        sys.exit(1)
    return directories

def find_broken_symlinks(directory):
    broken_symlinks = []
    for root, dirs, files in os.walk(directory):
        for name in files + dirs:
            path = os.path.join(root, name)
            if os.path.islink(path):
                if not os.path.exists(os.readlink(path)):
                    broken_symlinks.append(path)
    return broken_symlinks

def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    broken_links_folder = os.path.join(script_dir, '..', '..', 'BrokenLinkVault')
    logs_folder = os.path.join(broken_links_folder, 'logs')
    config_file = os.path.join(broken_links_folder, 'broken_links_config.txt')

    # Create directories
    if not os.path.exists(broken_links_folder):
        os.makedirs(broken_links_folder)
    if not os.path.exists(logs_folder):
        os.makedirs(logs_folder)

    # Set up logging
    setup_logging(logs_folder)

    # Read directories from the configuration file
    directories = read_directories(config_file)

    for directory in directories:
        if os.path.isdir(directory):
            logging.info(f"Processing directory: {directory}")

            # Find broken symlinks
            broken_symlinks = find_broken_symlinks(directory)
            if broken_symlinks:
                log_file = os.path.join(logs_folder, f"{os.path.basename(directory)}.log")
                with open(log_file, 'w') as log:
                    log.write(f"Broken symlinks in {directory}:\n")
                    for symlink in broken_symlinks:
                        log.write(f"{symlink}\n")
                logging.info(f"Broken symlinks in {directory} have been logged to {log_file}.")

                # Delete broken symlinks
                for symlink in broken_symlinks:
                    os.remove(symlink)
            else:
                logging.info(f"No broken symlinks found in {directory}.")
        else:
            logging.error(f"Failed to change directory to {directory}")

if __name__ == '__main__':
    main()
