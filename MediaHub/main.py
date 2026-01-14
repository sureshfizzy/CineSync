import argparse
import subprocess
import os
import sys
import platform
import time
import psutil
import signal
import socket
import threading
import traceback
import io
import time
import tempfile

# Configure UTF-8 encoding for stdout/stderr to handle Unicode characters
if hasattr(sys.stdout, 'buffer'):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
if hasattr(sys.stderr, 'buffer'):
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

# Setup sys.path
if getattr(sys, 'frozen', False):
    executable_dir = os.path.dirname(sys.executable)
    sys.path.insert(0, executable_dir)
else:
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from MediaHub.utils.system_utils import is_frozen, get_application_path

# Local imports from MediaHub
from MediaHub.config.config import *
from MediaHub.utils.logging_utils import log_message
from MediaHub.processors.db_utils import *
from MediaHub.processors.symlink_creator import *
from MediaHub.monitor.polling_monitor import *
from MediaHub.processors.symlink_utils import *
from MediaHub.utils.file_utils import resolve_symlink_to_source
from MediaHub.utils.dashboard_utils import is_dashboard_available, force_dashboard_recheck
from MediaHub.utils.global_events import *

db_initialized = False

# Polling monitor path
if is_frozen():
    POLLING_MONITOR_PATH = None
else:
    POLLING_MONITOR_PATH = os.path.join(os.path.dirname(__file__), 'monitor', 'polling_monitor.py')
LOCK_FILE = '/tmp/polling_monitor.lock' if platform.system() != 'Windows' else 'C:\\temp\\polling_monitor.lock'
MONITOR_PID_FILE = '/tmp/monitor_pid.txt' if platform.system() != 'Windows' else 'C:\\temp\\monitor_pid.txt'
LOCK_TIMEOUT = 3600

# Set up global variables to track processes
background_processes = []

def wait_for_mount():
    """Wait for the rclone mount to become available with minimal logging."""
    initial_message = True
    while True:
        if check_rclone_mount():
            if initial_message:
                log_message("Mount is now available.", level="INFO")
            return True

        if initial_message:
            log_message(f"Waiting for mount directory to become available...", level="INFO")
            initial_message = False

        time.sleep(is_mount_check_interval())

def check_mount_points():
    """Check if all configured mount points are accessible."""
    try:
        if is_rclone_mount_enabled():
            return check_rclone_mount()
        return True
    except Exception as e:
        log_message(f"Error checking mount points: {e}", level="ERROR")
        return False

def initialize_db_with_mount_check():
    """Initialize database with mount point verification."""
    try:
        # Only initialize if not already initialized
        initialize_db()

        # Check if mount points are accessible
        if is_rclone_mount_enabled() and not check_mount_points():
            log_message("Mount points are not accessible. Please check your configuration.", level="ERROR")
            return False
        return True
    except Exception as e:
        log_message(f"Error during database initialization: {e}", level="ERROR")
        return False

def display_missing_files_with_mount_check(dest_dir):
    """Display missing files after ensuring mount is available."""
    try:
        if not dest_dir:
            log_message("Destination directory not provided", level="ERROR")
            return []

        if is_rclone_mount_enabled():
            try:
                wait_for_mount()
            except Exception as e:
                log_message(f"Error waiting for mount: {str(e)}", level="ERROR")
                return []

        if not os.path.exists(dest_dir):
            log_message(f"Destination directory does not exist: {dest_dir}", level="ERROR")
            return []

        return display_missing_files(dest_dir)
    except Exception as e:
        log_message(f"Error in display_missing_files_with_mount_check: {str(e)}", level="ERROR")
        log_message(traceback.format_exc(), level="DEBUG")
        return []

def ensure_windows_temp_directory():
    """Create a temp directory if it does not exist on Windows."""
    if platform.system() == 'Windows':
        temp_dir = tempfile.gettempdir()
        if not os.path.exists(temp_dir):
            try:
                os.makedirs(temp_dir)
                log_message(f"Created directory: {temp_dir}", level="INFO")
            except OSError as e:
                log_message(f"Error creating directory {temp_dir}: {e}", level="ERROR")
                sys.exit(1)

def is_process_running(pid):
    """Check if a process with a given PID is still running."""
    try:
        return psutil.pid_exists(pid) and psutil.Process(pid).is_running()
    except psutil.NoSuchProcess:
        return False

def create_lock_file():
    """Create the lock file and write the process ID and timestamp."""
    with open(LOCK_FILE, 'w') as lock_file:
        lock_file.write(f"{os.getpid()}\n")
        lock_file.write(f"{time.time()}\n")

def check_lock_file():
    """Check if a lock file exists and whether it's stale or the process is still running."""
    if os.path.exists(LOCK_FILE):
        try:
            with open(LOCK_FILE, 'r') as lock_file:
                pid = int(lock_file.readline().strip())
                lock_time = float(lock_file.readline().strip())

                # Check if the process is still running
                if is_process_running(pid):
                    return True

                # Check if the lock file is too old (stale)
                if time.time() - lock_time > LOCK_TIMEOUT:
                    log_message(f"Stale lock file found. Removing lock.", level="WARNING")
                    os.remove(LOCK_FILE)
                else:
                    log_message(f"Lock file exists but process not running. Removing lock.", level="WARNING")
                    os.remove(LOCK_FILE)
        except (OSError, ValueError):
            log_message(f"Error reading lock file. Removing lock.", level="ERROR")
            os.remove(LOCK_FILE)
    return False

def remove_lock_file():
    """Remove the lock file."""
    if os.path.exists(LOCK_FILE):
        try:
            os.remove(LOCK_FILE)
            log_message("Lock file removed successfully.", level="DEBUG")
        except Exception as e:
            log_message(f"Error removing lock file: {e}", level="ERROR")

    if os.path.exists(MONITOR_PID_FILE):
        try:
            os.remove(MONITOR_PID_FILE)
        except Exception as e:
            log_message(f"Error removing monitor PID file: {e}", level="ERROR")

def terminate_subprocesses():
    """Terminate all subprocesses started by this script."""
    global background_processes
    log_message("Terminating all background processes...", level="INFO")

    # First, check monitor pid file
    if os.path.exists(MONITOR_PID_FILE):
        try:
            with open(MONITOR_PID_FILE, 'r') as f:
                pid = int(f.read().strip())

            if psutil.pid_exists(pid):
                proc = psutil.Process(pid)
                try:
                    log_message(f"Terminating monitor process with PID {pid}", level="INFO")
                    proc.terminate()
                    proc.wait(timeout=3)
                except (psutil.NoSuchProcess, psutil.TimeoutExpired):
                    try:
                        log_message(f"Force killing monitor process with PID {pid}", level="WARNING")
                        proc.kill()
                    except psutil.NoSuchProcess:
                        pass
        except Exception as e:
            log_message(f"Error terminating monitor process: {e}", level="ERROR")

    # Handle tracked processes
    for process in background_processes:
        try:
            if process.poll() is None:
                log_message(f"Terminating process with PID {process.pid}", level="INFO")
                if platform.system() == 'Windows':
                    # On Windows, use taskkill to force terminate the process tree
                    subprocess.run(['taskkill', '/F', '/T', '/PID', str(process.pid)],
                                  stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                else:
                    process.terminate()
                    try:
                        process.wait(timeout=3)
                    except subprocess.TimeoutExpired:
                        process.kill()
        except Exception as e:
            log_message(f"Error terminating process: {e}", level="ERROR")

    # Try to terminate child processes using psutil
    try:
        current_process = psutil.Process(os.getpid())
        children = current_process.children(recursive=True)

        # First try to terminate gracefully
        for child in children:
            try:
                log_message(f"Terminating child process {child.pid}", level="INFO")
                child.terminate()
            except psutil.NoSuchProcess:
                continue

        gone, still_alive = psutil.wait_procs(children, timeout=3)

        for child in still_alive:
            try:
                log_message(f"Force killing child process {child.pid}", level="WARNING")
                child.kill()
            except psutil.NoSuchProcess:
                pass
    except Exception as e:
        log_message(f"Error while terminating child processes: {str(e)}", level="ERROR")

def handle_exit(signum, frame):
    """Handle script termination and clean up."""
    log_message("Received shutdown signal, exiting gracefully", level="INFO")
    log_message("Terminating process and cleaning up lock file.", level="INFO")

    set_shutdown()
    time.sleep(0.5)

    terminate_subprocesses()
    remove_lock_file()

    os._exit(0)

def setup_process_priority():
    """Set process priority to prevent overwhelming the system."""
    try:
        current_process = psutil.Process()
        if platform.system() == 'Windows':
            # Set to below normal priority on Windows
            current_process.nice(psutil.BELOW_NORMAL_PRIORITY_CLASS)
            log_message("Set process priority to BELOW_NORMAL", level="DEBUG")
        else:
            # Set to nice value 10 on Unix (lower priority)
            current_process.nice(10)
            log_message("Set process nice value to 10", level="DEBUG")
    except Exception as e:
        log_message(f"Could not set process priority: {e}", level="WARNING")

def setup_cpu_affinity():
    """Set CPU affinity to limit MediaHub to specific CPU cores."""
    try:
        from MediaHub.config.config import get_max_cores
        max_cores = get_max_cores()
        total_cores = psutil.cpu_count()

        if max_cores < total_cores:
            allowed_cores = list(range(max_cores))
            current_process = psutil.Process()
            current_process.cpu_affinity(allowed_cores)

            log_message(f"CPU affinity set to cores {allowed_cores} (using {max_cores} of {total_cores} cores)", level="INFO")

            for child in current_process.children(recursive=True):
                try:
                    child.cpu_affinity(allowed_cores)
                except (psutil.NoSuchProcess, psutil.AccessDenied):
                    pass
        else:
            log_message(f"Using all {total_cores} CPU cores (MAX_CORES={max_cores})", level="INFO")

    except Exception as e:
        log_message(f"Could not set CPU affinity: {e}", level="WARNING")

def log_system_configuration():
    """Log system configuration at startup."""

    max_processes = get_max_processes()
    log_message(f"MAX_PROCESSES configured to use {max_processes} workers for I/O operations", level="INFO")
    log_message(f"Using {max_processes} worker threads for parallel processing", level="INFO")

    max_cores = get_max_cores()
    cpu_cores = psutil.cpu_count()
    log_message(f"MAX_CORES configured to use {max_cores} cores (CPU cores available: {cpu_cores})", level="INFO")

    # Log dashboard configuration
    dashboard_enabled = is_dashboard_notifications_enabled()

    if dashboard_enabled:
        dashboard_timeout = get_dashboard_timeout()
        dashboard_check_interval = get_dashboard_check_interval()

def start_polling_monitor():
    """Start the polling monitor as a subprocess."""
    global background_processes

    if check_lock_file():
        return

    create_lock_file()

    log_message("Processing complete. Setting up directory monitoring.", level="INFO")

    try:
        if is_frozen():
            log_message("Running polling monitor in thread", level="DEBUG")
            from MediaHub.monitor.polling_monitor import main as monitor_main
            # When running monitor in-process (frozen executable), write a PID file so
            # the Web UI / API can detect that the monitor is running. This mirrors
            # the behavior when the monitor is started as a subprocess.
            try:
                os.makedirs(os.path.dirname(MONITOR_PID_FILE), exist_ok=True)
            except Exception:
                pass
            try:
                with open(MONITOR_PID_FILE, 'w') as f:
                    f.write(str(os.getpid()))
            except Exception as e:
                log_message(f"Failed to write monitor PID file: {e}", level="DEBUG")

            monitor_main()
        else:
            log_message("Running polling monitor as subprocess", level="DEBUG")
            python_command = 'python' if platform.system() == 'Windows' else 'python3'
            process = subprocess.Popen([python_command, POLLING_MONITOR_PATH])

            try:
                current_process = psutil.Process()
                affinity = current_process.cpu_affinity()
                child_process = psutil.Process(process.pid)
                child_process.cpu_affinity(affinity)
                log_message(f"Set CPU affinity for polling monitor to cores {affinity}", level="DEBUG")
            except Exception as e:
                log_message(f"Could not set CPU affinity for polling monitor: {e}", level="DEBUG")

            background_processes.append(process)

            with open(MONITOR_PID_FILE, 'w') as f:
                f.write(str(process.pid))

            log_message(f"Started polling monitor with PID {process.pid}", level="INFO")

            while not terminate_flag.is_set():
                if process.poll() is not None:
                    log_message(f"Polling monitor exited with code {process.returncode}", level="INFO")
                    break
                time.sleep(0.1)

    except Exception as e:
        log_message(f"Error running monitor script: {e}", level="ERROR")
    finally:
        remove_lock_file()

def parse_season_episode(season_episode):
    """Parse season and episode numbers from the format SxxExx."""
    if not season_episode:
        return None, None

    match = re.match(r'S(\d{1,2})E(\d{1,3})', season_episode.upper())
    if match:
        return int(match.group(1)), int(match.group(2))
    return None, None

# CineSync WebDAV
def is_port_in_use(port):
    """Check if a port is already in use using multiple methods."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(1)
            s.bind(('0.0.0.0', port))
            return False
    except socket.error:
        pass

    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(1)
            result = s.connect_ex(('127.0.0.1', port))
            if result == 0:
                return True
    except:
        pass

    try:
        for conn in psutil.net_connections(kind='inet'):
            if conn.laddr.port == port and conn.status == 'LISTEN':
                return True
    except:
        pass

    return False

def check_dashboard_availability():
    """Check dashboard availability and log status."""
    try:

        if not is_dashboard_notifications_enabled():
            log_message("Dashboard notifications are disabled", level="INFO")
            return False

        # Force a fresh check at startup
        force_dashboard_recheck()

        if is_dashboard_available():
            log_message("Dashboard is available for notifications", level="INFO")
            return True
        else:
            log_message("Dashboard is not available - notifications will be cached to avoid delays", level="WARNING")
            return False

    except Exception as e:
        log_message(f"Error checking dashboard availability: {e}", level="ERROR")
        return False

def start_webdav_server():
    """Start WebDavHub server if enabled."""
    global background_processes

    # Always start CineSync server
    if is_frozen():
        executable_dir = get_application_path()
        base_dir = executable_dir.parent
        webdav_dir = base_dir
    else:
        webdav_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'WebDavHub')
    if platform.system() == 'Windows':
        webdav_script = os.path.join(webdav_dir, 'cinesync.exe')
    else:
        webdav_script = os.path.join(webdav_dir, 'cinesync')
    webdav_port = int(os.getenv('CINESYNC_PORT', '8082'))

    # Check if the CineSync server is already running on the specified port
    if is_port_in_use(webdav_port):
        log_message(f"CineSync server is already running on port {webdav_port}", level="INFO")
        # Check dashboard availability after confirming server is running
        check_dashboard_availability()
        return

    if os.path.exists(webdav_script):
        log_message("Starting CineSync server...", level="INFO")

        try:
            # Change to the WebDavHub directory and execute the script
            current_dir = os.getcwd()
            os.chdir(webdav_dir)
            webdav_process = subprocess.Popen(["./" + os.path.basename(webdav_script)])
            background_processes.append(webdav_process)
            os.chdir(current_dir)

            log_message(f"CineSync server started with PID: {webdav_process.pid}", level="INFO")

            # Wait a moment for server to start, then check availability
            time.sleep(2)
            check_dashboard_availability()

        except Exception as e:
            log_message(f"Failed to start CineSync server: {e}", level="ERROR")
    else:
        check_dashboard_availability()

def main(dest_dir):
    parser = argparse.ArgumentParser(description="Create symlinks for files from src_dirs in dest_dir.")
    parser.add_argument("--auto-select", action="store_true", help="Automatically chooses the first option without prompting the user")
    parser.add_argument("--use-source-db", action="store_true", help="Use source files database to find unprocessed files (faster for auto mode)")
    parser.add_argument("single_path", nargs="?", help="Single path to process instead of using SOURCE_DIRS from environment variables")
    parser.add_argument("--force", action="store_true", help="Force recreate symlinks even if they already exist")
    parser.add_argument("--force-show", action="store_true", help="Force process file as a TV show regardless of naming pattern")
    parser.add_argument("--force-movie", action="store_true", help="Force process file as a movie regardless of naming pattern")
    parser.add_argument("--force-extra", action="store_true", help="Force an extra file to be considered as a Movie/Show")
    parser.add_argument("--disable-monitor", action="store_true", help="Disable polling monitor and symlink cleanup processes")
    parser.add_argument("--monitor-only", action="store_true", help="Start only the polling monitor without processing existing files")
    parser.add_argument("--imdb", type=str, help="Direct IMDb ID for the show")
    parser.add_argument("--tmdb", type=int, help="Direct TMDb ID for the show")
    parser.add_argument("--tvdb", type=int, help="Direct TVDb ID for the show")
    parser.add_argument("--season-episode", type=str, help="Specify season and episode numbers in format SxxExx (e.g., S03E15)")
    parser.add_argument("--skip", action="store_true", help="Skip processing the file and mark it as 'Skipped by user' in the database")
    parser.add_argument("--batch-apply", action="store_true", help="Apply the first manual selection to all subsequent files in the batch")
    parser.add_argument("--manual-search", action="store_true", help="Allow manual TMDB search when automatic search fails")

    db_group = parser.add_argument_group('Database Management')
    db_group.add_argument("--reset", action="store_true",
                         help="Reset the database to its initial state")
    db_group.add_argument("--status", action="store_true",
                         help="Display database statistics")
    db_group.add_argument("--vacuum", action="store_true",
                         help="Perform database vacuum to optimize storage and performance")
    db_group.add_argument("--verify", action="store_true",
                         help="Verify database integrity and check for corruption")
    db_group.add_argument("--export", metavar="FILE",
                         help="Export database contents to a CSV file")
    db_group.add_argument("--import", metavar="FILE", dest="import_file",
                         help="Import database contents from a CSV file")
    db_group.add_argument("--search", metavar="PATTERN",
                         help="Search for files in database matching the given pattern")
    db_group.add_argument("--optimize", action="store_true",
                         help="Optimize database indexes and analyze tables")
    db_group.add_argument("--update-database", action="store_true",
                         help="Update database entries using TMDB API calls")

    args = parser.parse_args()

    # Parse season and episode numbers if provided
    season_number, episode_number = parse_season_episode(args.season_episode)

    # Resolve symlink if single_path is provided
    if args.single_path:
        original_path = args.single_path
        resolved_path = resolve_symlink_to_source(args.single_path)
        if resolved_path != original_path:
            log_message(f"Resolved symlink path: {original_path} -> {resolved_path}", level="INFO")
            args.single_path = resolved_path

    # Ensure --force-show and --force-movie aren't used together
    if args.force_show and args.force_movie:
        log_message("Error: Cannot use --force-show and --force-movie together", level="ERROR")
        sys.exit(1)

    if args.vacuum:
        vacuum_database()
        return

    if args.verify:
        verify_database_integrity()
        return

    if args.export:
        export_database(args.export)
        return

    if args.import_file:
        import_database(args.import_file)
        return

    if args.search:
        search_database(args.search)
        return

    if args.optimize:
        optimize_database()
        return

    if args.update_database:
        update_database_to_new_format()
        return

    if args.reset:
        if input("Are you sure you want to reset the database? This will delete all entries. (Y/N): ").lower() == 'y':
            reset_database()
            return

    if args.status:
        stats = get_database_stats()
        if stats:
            log_message("Database Statistics:", level="INFO")
            log_message(f"Total Records: {stats['total_records']}", level="INFO")
            log_message(f"Archived Records: {stats['archived_records']}", level="INFO")
            log_message(f"Main DB Size: {stats['main_db_size']:.2f} MB", level="INFO")
            log_message(f"Archive DB Size: {stats['archive_db_size']:.2f} MB", level="INFO")
        return

    # Handle monitor-only mode
    if args.monitor_only:
        log_message("Starting in monitor-only mode", level="INFO")
        # Check dashboard availability even in monitor-only mode
        check_dashboard_availability()
        # Initialize database
        if not initialize_db_with_mount_check():
            log_message("Failed to initialize database. Exiting.", level="ERROR")
            return
        # Start only the polling monitor
        start_polling_monitor()
        # Note: start_polling_monitor() blocks in frozen mode, so we only reach here if it exits
        log_message("Monitor process has exited", level="INFO")
        return

    if not os.path.exists(LOCK_FILE):
        # Wait for mount if needed and initialize database
        if not initialize_db_with_mount_check():
            log_message("Failed to initialize database. Exiting.", level="ERROR")
            return

        # Skip heavy background processes for single file operations
        is_single_file_operation = args.single_path and os.path.isfile(args.single_path) if args.single_path else False

        if not args.disable_monitor and not is_single_file_operation:
            log_message("Starting background processes...", level="INFO")
            log_message("RealTime-Monitoring is enabled", level="INFO")

            # Define the callback function to be called once the background task finishes
            def on_missing_files_check_done():
                log_message("Database import completed.", level="INFO")

            # Function to run the missing files check and call the callback when done
            def display_missing_files_with_callback(dest_dir, callback):
                try:
                    if not dest_dir or not os.path.exists(dest_dir):
                        log_message(f"Invalid or non-existent destination directory: {dest_dir}", level="ERROR")
                        return
                    missing_files_list = display_missing_files_with_mount_check(dest_dir)

                    if missing_files_list:
                        log_message(f"Found {len(missing_files_list)} missing files. Attempting to recreate symlinks.", level="INFO")
                        # Get source directories for create_symlinks
                        src_dirs_str = get_setting_with_client_lock('SOURCE_DIR', '', 'string')
                        if not src_dirs_str:
                            log_message("Source directories not configured. Cannot recreate symlinks.", level="ERROR")
                            return
                        src_dirs = src_dirs_str.split(',')
                        if not src_dirs:
                            log_message("Source directories not configured. Cannot recreate symlinks.", level="ERROR")
                            return

                        for source_file_path, expected_dest_path in missing_files_list:
                            log_message(f"Attempting to recreate symlink for missing file: {source_file_path}", level="INFO")
                            create_symlinks(src_dirs=src_dirs, dest_dir=dest_dir, single_path=source_file_path, force=True, mode='create', auto_select=True, use_source_db=args.use_source_db
                            )
                    else:
                        log_message("No missing files found.", level="INFO")

                    callback()
                except Exception as e:
                    log_message(f"Error in display_missing_files_with_callback: {str(e)}", level="ERROR")
                    log_message(traceback.format_exc(), level="DEBUG")

            # Run missing files check in a separate thread
            # DISABLED: This blocks activities by checking existence of all files
            # missing_files_thread = threading.Thread(name="missing_files_check", target=display_missing_files_with_callback, args=(dest_dir, on_missing_files_check_done))
            # missing_files_thread.daemon = True
            # missing_files_thread.start()
            log_message("Missing files check disabled at startup for better performance", level="INFO")

            #Symlink cleanup
            cleanup_thread = threading.Thread(target=run_symlink_cleanup, args=(dest_dir,))
            cleanup_thread.daemon = True
            cleanup_thread.start()
        elif is_single_file_operation:
            log_message("Single file operation detected - skipping background processes and dashboard checks for faster startup", level="INFO")
        else:
            log_message("RealTime-Monitoring is disabled", level="INFO")
            # Check dashboard availability even when monitoring is disabled
            check_dashboard_availability()

    src_dirs_str = get_setting_with_client_lock('SOURCE_DIR', '', 'string')
    dest_dir = get_setting_with_client_lock('DESTINATION_DIR', '', 'string')
    if not src_dirs_str or not dest_dir:
        log_message("Source or destination directory not set in environment variables.", level="ERROR")
        sys.exit(1)
    src_dirs = src_dirs_str.split(',')

    # Wait for mount before creating symlinks if needed
    if is_rclone_mount_enabled() and not check_rclone_mount():
        wait_for_mount()
    try:
        # Check if this is a single file operation for optimization
        is_single_file_operation = args.single_path and os.path.isfile(args.single_path) if args.single_path else False

        # Start RealTime-Monitoring in main thread if not disabled and not single file operation
        if not args.disable_monitor and not is_single_file_operation:
            start_webdav_server()
            log_message("Starting RealTime-Monitoring...", level="INFO")
            monitor_thread = threading.Thread(target=start_polling_monitor)
            monitor_thread.daemon = True
            monitor_thread.start()
            time.sleep(2)
            create_symlinks(src_dirs, dest_dir, auto_select=args.auto_select, single_path=args.single_path, force=args.force, mode='create', tmdb_id=args.tmdb, imdb_id=args.imdb, tvdb_id=args.tvdb, force_show=args.force_show, force_movie=args.force_movie, season_number=season_number, episode_number=episode_number, force_extra=args.force_extra, skip=args.skip, batch_apply=args.batch_apply, manual_search=args.manual_search, use_source_db=args.use_source_db)

            while monitor_thread.is_alive() and not terminate_flag.is_set():
                time.sleep(0.1)

            if terminate_flag.is_set():
                log_message("Termination requested, stopping monitor thread", level="INFO")
        else:
            if is_single_file_operation:
                log_message("Single file operation - skipping monitoring services for faster processing", level="INFO")
            create_symlinks(src_dirs, dest_dir, auto_select=args.auto_select, single_path=args.single_path, force=args.force, mode='create', tmdb_id=args.tmdb, imdb_id=args.imdb, tvdb_id=args.tvdb, force_show=args.force_show, force_movie=args.force_movie, season_number=season_number, episode_number=episode_number, force_extra=args.force_extra, skip=args.skip, batch_apply=args.batch_apply, manual_search=args.manual_search, use_source_db=args.use_source_db)
    except KeyboardInterrupt:
        log_message("Keyboard interrupt received, cleaning up and exiting...", level="INFO")
        set_shutdown()
        terminate_subprocesses()
        remove_lock_file()
        sys.exit(0)

if __name__ == "__main__":
    # Make sure temp directory exists on Windows
    ensure_windows_temp_directory()

    # Set up signal handlers before anything else
    setup_signal_handlers()

    # Set process priority to be system-friendly
    setup_process_priority()

    # Set CPU affinity to limit core usage
    setup_cpu_affinity()

    # Log system configuration at startup
    log_system_configuration()

    # Get directories and start main process
    src_dirs_str = get_setting_with_client_lock('SOURCE_DIR', '', 'string')
    dest_dir = get_setting_with_client_lock('DESTINATION_DIR', '', 'string')
    if not src_dirs_str or not dest_dir:
        log_message("Source or destination directory not set.", level="ERROR")
        sys.exit(1)
    src_dirs = src_dirs_str.split(',')

    try:
        main(dest_dir)
    except KeyboardInterrupt:
        log_message("Keyboard interrupt received, cleaning up and exiting...", level="INFO")
        set_shutdown()
        terminate_subprocesses()
        remove_lock_file()
        sys.exit(0)
    except BrokenPipeError:
        log_message("Broken pipe error detected, cleaning up and exiting...", level="INFO")
        set_shutdown()
        terminate_subprocesses()
        remove_lock_file()
        sys.exit(0)
    except Exception as e:
        log_message(f"Unhandled exception: {str(e)}", level="ERROR")
        log_message(traceback.format_exc(), level="DEBUG")
        set_shutdown()
        terminate_subprocesses()
        remove_lock_file()
        sys.exit(1)
