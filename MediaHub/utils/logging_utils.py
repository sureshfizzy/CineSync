from datetime import datetime
import sys
import os
from dotenv import load_dotenv

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
api_warning_logged = False

def log_message(message, level="INFO", output="stdout"):
    if LOG_LEVELS.get(level, 20) >= LOG_LEVEL:
        timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        log_entry = f"{timestamp} [{level}] {message}\n"
        if output == "stdout":
            sys.stdout.write(log_entry)
            sys.stdout.flush()
        elif output == "stderr":
            sys.stderr.write(log_entry)
            sys.stderr.flush()
        else:
            with open(output, 'a') as log_file:
                log_file.write(log_entry)
