import time
import requests
from functools import wraps
from MediaHub.utils.logging_utils import log_message

def api_retry(max_retries=3, base_delay=5, max_delay=30):
    """
    Decorator to retry API calls on failure with exponential backoff
    Specifically handles 429 (Too Many Requests) responses with backoff
    Parameters:
    - max_retries: Maximum number of retry attempts
    - base_delay: Initial delay between retries in seconds
    - max_delay: Maximum delay between retries in seconds
    """
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            retries = 0
            current_delay = base_delay

            while retries <= max_retries:
                try:
                    result = func(*args, **kwargs)
                    if result is not None and result is not False:
                        return result

                    retries += 1
                    if retries <= max_retries:
                        log_message(f"Attempt {retries}/{max_retries} failed. Retrying in {current_delay} seconds...", level="WARNING")
                        time.sleep(current_delay)
                        current_delay = min(current_delay * 2, max_delay)
                    else:
                        log_message(f"All {max_retries} retry attempts failed.", level="ERROR")
                        return False

                except requests.exceptions.RequestException as e:
                    retries += 1

                    # Handling for 429 Too Many Requests
                    if hasattr(e, 'response') and e.response is not None and e.response.status_code == 429:
                        retry_after = e.response.headers.get('Retry-After')
                        if retry_after:
                            try:
                                retry_delay = int(retry_after)
                                log_message(f"Rate limited (429). Server requested wait of {retry_delay} seconds.", level="WARNING")
                            except (ValueError, TypeError):
                                retry_delay = current_delay
                                log_message(f"Rate limited (429). Using exponential backoff: {retry_delay} seconds.", level="WARNING")
                        else:
                            retry_delay = current_delay
                            log_message(f"Rate limited (429). No Retry-After header. Waiting {retry_delay} seconds.", level="WARNING")

                        retry_delay = min(retry_delay, max_delay)
                    else:
                        retry_delay = current_delay
                        log_message(f"API request error: {str(e)}. Retry {retries}/{max_retries} in {retry_delay} seconds...", level="WARNING")

                    if retries <= max_retries:
                        time.sleep(retry_delay)
                        current_delay = min(current_delay * 2, max_delay)
                    else:
                        log_message(f"All {max_retries} retry attempts failed with error: {str(e)}", level="ERROR")
                        return False

            return False
        return wrapper
    return decorator
