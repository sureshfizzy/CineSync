#!/usr/bin/env python3
"""
Symlink cleanup job.
Runs a single cleanup pass for broken symlinks and orphaned DB entries.
"""

import os
import sys
from pathlib import Path

# Setup sys.path for both frozen and non-frozen execution
if getattr(sys, "frozen", False):
    executable_dir = os.path.dirname(sys.executable)
    sys.path.insert(0, executable_dir)
else:
    sys.path.insert(0, str(Path(__file__).parent.parent.parent.parent))

from MediaHub.config.config import get_directories
from MediaHub.monitor.symlink_cleanup import run_symlink_cleanup_job
from MediaHub.utils.logging_utils import log_message


def main():
    """Run one symlink cleanup cycle."""
    try:
        os.environ["MEDIAHUB_PLAIN_STDOUT"] = "1"

        _, dest_dir = get_directories()
        if not dest_dir:
            log_message("Destination directory is not configured", level="ERROR")
            sys.exit(1)

        if not os.path.exists(dest_dir):
            log_message(f"Destination directory does not exist: {dest_dir}", level="ERROR")
            sys.exit(1)

        removed_links, removed_orphans = run_symlink_cleanup_job(dest_dir)
        log_message(
            f"Symlink cleanup job completed (deleted={removed_links}, orphaned_entries={removed_orphans})",
            level="INFO",
        )
        sys.exit(0)
    except Exception as e:
        log_message(f"Symlink cleanup job failed: {e}", level="ERROR")
        sys.exit(1)


if __name__ == "__main__":
    main()
