from datetime import datetime
import sys
import os
import platform
import urllib3
import warnings
import logging
from dotenv import load_dotenv
from MediaHub.utils.env_creator import get_env_file_path

# Import unicodedata for Unicode normalization
import unicodedata

def _normalize_for_logging(text: str) -> str:
    """
    Unicode normalization for logging to prevent encoding errors.
    """
    if not isinstance(text, str) or not text:
        return str(text) if text is not None else ""

    # Handle the most common problematic characters that cause encoding issues
    replacements = {
        '\ua789': ':',  # MODIFIER LETTER COLON -> COLON (the main culprit)
        '\u2013': '-',  # EN DASH -> HYPHEN
        '\u2014': '-',  # EM DASH -> HYPHEN
        '\u2018': "'",  # LEFT SINGLE QUOTATION MARK -> APOSTROPHE
        '\u2019': "'",  # RIGHT SINGLE QUOTATION MARK -> APOSTROPHE
        '\u201c': '"',  # LEFT DOUBLE QUOTATION MARK -> QUOTATION MARK
        '\u201d': '"',  # RIGHT DOUBLE QUOTATION MARK -> QUOTATION MARK
        '\u00a0': ' ',  # NON-BREAKING SPACE -> REGULAR SPACE
        '\u2026': '...',  # HORIZONTAL ELLIPSIS -> THREE DOTS
    }

    for unicode_char, replacement in replacements.items():
        text = text.replace(unicode_char, replacement)

    # Avoid Ciruclar Imports
    from MediaHub.utils.file_utils import remove_accents
    text = remove_accents(text)
    try:
        text.encode('ascii')
        return text
    except UnicodeEncodeError:
        text = unicodedata.normalize('NFKD', text).encode('ascii', 'ignore').decode('ascii')

    # Remove empty parentheses that result from removing non-ASCII content
    import re
    text = re.sub(r'\(\s*\)', '', text)  # Remove empty parentheses
    text = re.sub(r'\[\s*\]', '', text)  # Remove empty brackets
    text = re.sub(r'\{\s*\}', '', text)  # Remove empty braces
    text = re.sub(r'\s+', ' ', text)     # Clean up multiple spaces
    text = text.strip()                  # Remove leading/trailing spaces

    return text

# Suppress urllib3 connection pool warnings
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
warnings.filterwarnings("ignore", message="Connection pool is full, discarding connection")

# Suppress specific urllib3 logging
logging.getLogger("urllib3.connectionpool").setLevel(logging.ERROR)

# Load environment variables from .env file
db_env_path = get_env_file_path()
load_dotenv(db_env_path)

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

        # Normalize Unicode characters upfront to prevent encoding issues
        safe_message = _normalize_for_logging(str(message))

        log_entry = f"{timestamp} [{level}] {safe_message}"

        # Only apply colors if not on Windows
        colored_message = log_entry if IS_WINDOWS else f"{get_color(log_entry)}{log_entry}{COLOR_CODES['END']}"

        # Print to console with immediate flush
        try:
            if output == "stdout":
                print(colored_message, flush=True)
            elif output == "stderr":
                print(colored_message, file=sys.stderr, flush=True)
        except (ValueError, OSError):
            pass

        # Write to log file
        try:
            with open(LOG_FILE, 'a', encoding='utf-8') as log_file:
                log_file.write(log_entry + '\n')
        except (OSError, IOError):
            pass

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
