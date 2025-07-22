#!/usr/bin/env python3
"""
Database maintenance job that automatically triggers broken symlinks cleanup
when source files no longer exist
"""

import os
import sys
import argparse
import importlib.util

# Calculate paths correctly (now in utils/Jobs subfolder)
script_path = os.path.abspath(__file__)
jobs_dir = os.path.dirname(script_path)
utils_dir = os.path.dirname(jobs_dir)
mediahub_dir = os.path.dirname(utils_dir)
cinesync_dir = os.path.dirname(mediahub_dir)

# Add the parent directory to the system path (same as main.py does)
if cinesync_dir not in sys.path:
    sys.path.insert(0, cinesync_dir)

# Load config module
try:
    config_path = os.path.join(mediahub_dir, "config", "config.py")
    spec = importlib.util.spec_from_file_location("config", config_path)
    config_module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(config_module)
    get_directories = config_module.get_directories
except Exception:
    def get_directories():
        src_dir = os.getenv('SOURCE_DIR', '')
        if src_dir:
            src_dirs = [d.strip() for d in src_dir.split(',') if d.strip()]
        else:
            src_dirs_env = os.getenv('SOURCE_DIRS', '')
            src_dirs = [d.strip() for d in src_dirs_env.split(',') if d.strip()] if src_dirs_env else []
        dest_dir = os.getenv('DESTINATION_DIR', '')
        return src_dirs, dest_dir

# Load database utilities module
try:
    db_utils_path = os.path.join(mediahub_dir, "processors", "db_utils.py")
    spec = importlib.util.spec_from_file_location("db_utils", db_utils_path)
    db_utils_module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(db_utils_module)

    initialize_db = db_utils_module.initialize_db
    reset_database = db_utils_module.reset_database
    vacuum_database = db_utils_module.vacuum_database
    verify_database_integrity = db_utils_module.verify_database_integrity
    optimize_database = db_utils_module.optimize_database
    get_database_stats = db_utils_module.get_database_stats
    display_missing_files = db_utils_module.display_missing_files
    cleanup_missing_destinations = db_utils_module.cleanup_missing_destinations
except Exception as e:
    sys.exit(1)

def run_initialize():
    """Initialize database"""
    initialize_db()

def run_reset():
    """Reset database"""
    reset_database()

def run_vacuum():
    """Vacuum database"""
    vacuum_database()

def run_verify():
    """Verify database integrity"""
    verify_database_integrity()

def run_optimize():
    """Optimize database"""
    optimize_database()

def run_status():
    """Show database status"""
    get_database_stats()

def run_missing_files():
    """Check for missing files and automatically trigger broken symlinks cleanup"""
    # Get destination directory
    _, dest_dir = get_directories()
    if not dest_dir:
        sys.exit(1)

    if not os.path.exists(dest_dir):
        sys.exit(1)

    display_missing_files(dest_dir)

def run_cleanup_missing_destinations():
    """Clean up database entries where destination files are missing but source files still exist"""
    cleanup_missing_destinations()

def main():
    """Main function to run database maintenance using existing MediaHub logic"""
    parser = argparse.ArgumentParser(description='Database maintenance jobs')
    parser.add_argument('action', choices=['initialize', 'reset', 'vacuum', 'verify', 'optimize', 'status', 'missing-files', 'cleanup-missing-destinations'],
                       help='Database maintenance action to perform')

    args = parser.parse_args()

    try:
        if args.action == 'initialize':
            run_initialize()
        elif args.action == 'reset':
            run_reset()
        elif args.action == 'vacuum':
            run_vacuum()
        elif args.action == 'verify':
            run_verify()
        elif args.action == 'optimize':
            run_optimize()
        elif args.action == 'status':
            run_status()
        elif args.action == 'missing-files':
            run_missing_files()
        elif args.action == 'cleanup-missing-destinations':
            run_cleanup_missing_destinations()
        else:
            sys.exit(1)

    except Exception as e:
        sys.exit(1)

if __name__ == "__main__":
    main()
