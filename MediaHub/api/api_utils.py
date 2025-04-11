import time
import requests
from functools import wraps
from MediaHub.utils.logging_utils import log_message

def api_retry(max_retries=3, delay=3):
    """
    Decorator to retry API calls on failure (when result is False or None)
    """
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            retries = 0
            last_exception = None

            while retries < max_retries:
                try:
                    result = func(*args, **kwargs)

                    if result:
                        return result

                    retries += 1
                    if retries < max_retries:
                        log_message(f"Attempt {retries}/{max_retries} failed. Retrying in {delay} seconds...", level="WARNING")
                        time.sleep(delay)
                    else:
                        log_message(f"All {max_retries} retry attempts failed.", level="ERROR")
                        return False

                except requests.exceptions.RequestException as e:
                    last_exception = e
                    retries += 1
                    if retries < max_retries:
                        log_message(f"API request error: {str(e)}. Retry {retries}/{max_retries} in {delay} seconds...", level="WARNING")
                        time.sleep(delay)
                    else:
                        log_message(f"All {max_retries} retry attempts failed with error: {str(e)}", level="ERROR")
                        return False

            return False
        return wrapper
    return decorator
