import argparse
import sys
from config import load_config, get_directories
from media_processor import create_symlinks
from logging_utils import setup_logging, log_message

def main():
    parser = argparse.ArgumentParser(description="Create symlinks for files from src_dirs in dest_dir.")
    parser.add_argument("--auto-select", action="store_true", help="Automatically chooses the first option without prompting the user")
    args = parser.parse_args()
 
    config = load_config()
    setup_logging(config)

    src_dirs, dest_dir = get_directories(config)
    if not src_dirs or not dest_dir:
        log_message("Source or destination directory not set in environment variables.", level="ERROR")
        sys.exit(1)

    create_symlinks(src_dirs, dest_dir, config, auto_select=args.auto_select)

if __name__ == "__main__":
    main()
