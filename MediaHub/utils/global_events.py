"""
Global event management for MediaHub application.
This module provides centralized event handling for graceful shutdown across all components.
"""

import threading
import signal
import os
from MediaHub.utils.logging_utils import log_message

# Global events for coordinating shutdown across all components
terminate_flag = threading.Event()
error_event = threading.Event()
shutdown_event = threading.Event()

def set_shutdown():
    """Set all shutdown events to signal graceful termination"""
    terminate_flag.set()
    error_event.set()
    shutdown_event.set()
    log_message("Global shutdown events set", level="DEBUG")

def is_shutdown_requested():
    """Check if any shutdown event has been set"""
    return terminate_flag.is_set() or error_event.is_set() or shutdown_event.is_set()

def reset_events():
    """Reset all events (mainly for testing purposes)"""
    terminate_flag.clear()
    error_event.clear()
    shutdown_event.clear()

def setup_signal_handlers():
    """Setup signal handlers for graceful shutdown"""
    def signal_handler(signum, frame):
        log_message(f"Received signal {signum}, initiating graceful shutdown", level="INFO")
        set_shutdown()

        # Import here to avoid circular imports
        import platform

        # Terminate subprocesses and cleanup
        try:
            from MediaHub.main import terminate_subprocesses, remove_lock_file
            terminate_subprocesses()
            remove_lock_file()
        except ImportError:
            log_message("Could not import cleanup functions", level="WARNING")

        # Give threads a moment to see the shutdown events
        import time
        time.sleep(0.5)

        # Force exit to prevent hanging
        log_message("Forcing exit to prevent hanging", level="DEBUG")
        os._exit(0)

    # Register handlers for both Windows and Unix signals
    signal.signal(signal.SIGINT, signal_handler)
    import platform
    if platform.system() == 'Windows':
        if hasattr(signal, 'SIGBREAK'):
            signal.signal(signal.SIGBREAK, signal_handler)
    else:
        if hasattr(signal, 'SIGTERM'):
            signal.signal(signal.SIGTERM, signal_handler)
