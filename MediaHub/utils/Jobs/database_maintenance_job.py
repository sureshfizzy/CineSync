#!/usr/bin/env python3
"""
Database maintenance job that automatically triggers broken symlinks cleanup
when source files no longer exist
"""

import os
import sys
import argparse

# Setup sys.path for both frozen and non-frozen execution
if getattr(sys, 'frozen', False):
    executable_dir = os.path.dirname(sys.executable)
    sys.path.insert(0, executable_dir)
else:
    script_path = os.path.abspath(__file__)
    jobs_dir = os.path.dirname(script_path)
    utils_dir = os.path.dirname(jobs_dir)
    mediahub_dir = os.path.dirname(utils_dir)
    cinesync_dir = os.path.dirname(mediahub_dir)
    if cinesync_dir not in sys.path:
        sys.path.insert(0, cinesync_dir)

# Standard imports
from MediaHub.config.config import get_directories
from MediaHub.processors.db_utils import (
    initialize_db,
    reset_database,
    vacuum_database,
    verify_database_integrity,
    optimize_database,
    get_database_stats,
)

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

def main():
    """Main function to run database maintenance using existing MediaHub logic"""
    parser = argparse.ArgumentParser(description='Database maintenance jobs')
    parser.add_argument('action', choices=['initialize', 'reset', 'vacuum', 'verify', 'optimize', 'status'],
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
        else:
            sys.exit(1)

    except Exception as e:
        sys.exit(1)

if __name__ == "__main__":
    main()
