from datetime import datetime
import sys
import os
import platform
import urllib3
import warnings
import logging
from dotenv import load_dotenv

# Suppress urllib3 connection pool warnings
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
warnings.filterwarnings("ignore", message="Connection pool is full, discarding connection")

# Suppress specific urllib3 logging
logging.getLogger("urllib3.connectionpool").setLevel(logging.ERROR)

# Load environment variables from .env file
load_dotenv()

# Define log levels
LOG_LEVELS = {
    "DEBUG": 10,
    "INFO": 20,
    "WARNING": 30,
    "ERROR": 40,
    "CRITICAL": 50
}

# Load log level from .env
LOG_LEVEL = os.getenv('LOG_LEVEL', 'INFO')
LOG_LEVEL = LOG_LEVELS.get(LOG_LEVEL.upper(), 20)

# Set up logs directory
BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
LOG_DIR = os.path.join(BASE_DIR, "logs")

if not os.path.exists(LOG_DIR):
    os.makedirs(LOG_DIR)

# Set up log file
UTC_NOW = datetime.utcnow().strftime('%Y-%m-%d_%H-%M-%S')
LOG_FILE = os.path.join(LOG_DIR, f"{UTC_NOW}.log")

# Remove old logs
for file in os.listdir(LOG_DIR):
    if file.endswith('.log') and file != os.path.basename(LOG_FILE):
        os.remove(os.path.join(LOG_DIR, file))

# Check if running on Windows
IS_WINDOWS = platform.system().lower() == 'windows'

# Color codes - empty strings for Windows
if IS_WINDOWS:
    COLOR_CODES = {
        "DEFAULT": "",
        "RED_BOLD": "",
        "RED": "",
        "YELLOW": "",
        "BLUE": "",
        "END": ""
    }
else:
    COLOR_CODES = {
        "DEFAULT": "\033[0m",  # Default black
        "RED_BOLD": "\033[1;31m",  # Red and bold
        "RED": "\033[31m",  # Red
        "YELLOW": "\033[93m",  # Yellow
        "BLUE": "\033[94m",  # Blue
        "END": "\033[0m",  # Reset
        "MAGENTA": "\033[35m",  # Magenta
        "GREEN": "\033[92m" # Greem
    }

def get_color(message):
    """
    Determines the appropriate color for the log message based on its content.
    Returns empty string on Windows.
    """
    if IS_WINDOWS:
        return ""

    if "CRITICAL" in message:
        return COLOR_CODES["RED_BOLD"]
    elif "ERROR" in message:
        return COLOR_CODES["RED"]
    elif "WARNING" in message:
        return COLOR_CODES["YELLOW"]
    elif "Skipping unsupported file type" in message:
        return COLOR_CODES["BLUE"]
    elif "DEBUG" in message:
        return COLOR_CODES["MAGENTA"]
    elif "Created symlink" in message:
        return COLOR_CODES["GREEN"]
    return COLOR_CODES["DEFAULT"]

def log_message(message, level="INFO", output="stdout"):
    """
    Logs messages to the console and optionally to a log file.
    Colors are disabled on Windows.
    """
    if LOG_LEVELS.get(level, 20) >= LOG_LEVEL:
        timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        log_entry = f"{timestamp} [{level}] {message}\n"

        # Only apply colors if not on Windows
        colored_message = log_entry if IS_WINDOWS else f"{get_color(log_entry)}{log_entry}{COLOR_CODES['END']}"

        if output == "stdout":
            sys.stdout.write(colored_message)
            sys.stdout.flush()
        elif output == "stderr":
            sys.stderr.write(colored_message)
            sys.stderr.flush()

        # Always write to the log file without color codes
        with open(LOG_FILE, 'a', encoding='utf-8') as log_file:
            log_file.write(log_entry)

def log_unsupported_file_type(file_type):
    """
    Logs a message indicating an unsupported file type.
    """
    log_message(f"Skipping unsupported file type: {file_type}", level="INFO")

def log_critical_error(error_message):
    """
    Logs a critical error.
    """
    log_message(f"CRITICAL error: {error_message}", level="CRITICAL")

def log_error(error_message):
    """
    Logs an error.
    """
    log_message(f"ERROR: {error_message}", level="ERROR")
