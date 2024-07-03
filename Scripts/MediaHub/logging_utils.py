import sys
from datetime import datetime

LOG_LEVELS = {
    "DEBUG": 10,
    "INFO": 20,
    "WARNING": 30,
    "ERROR": 40,
    "CRITICAL": 50
}

def setup_logging(config):
    global LOG_LEVEL
    LOG_LEVEL = LOG_LEVELS.get(config['LOG_LEVEL'], 20)

def log_message(message, level="INFO", output="stdout"):
    if LOG_LEVELS.get(level, 20) >= LOG_LEVEL:
        timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        log_entry = f"{timestamp} [{level}] {message}\n"
        if output == "stdout":
            sys.stdout.write(log_entry)
        elif output == "stderr":
            sys.stderr.write(log_entry)
        else:
            with open(output, 'a') as log_file:
                log_file.write(log_entry)
