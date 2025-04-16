import os
import sys
import requests
import time
from functools import wraps
from MediaHub.utils.logging_utils import log_message
from MediaHub.api.api_utils import api_retry

# Global variables for API key status
api_key = None
api_warning_logged = False

def get_api_key():
    global api_key, api_warning_logged

    if api_key is not None:
        return api_key

    api_key = os.getenv('TMDB_API_KEY')

    if not is_valid_api_key(api_key):
        log_message("TMDB API key is invalid. Exiting script.", level="ERROR")
        sys.exit(1)

    return api_key

@api_retry(max_retries=3, base_delay=5, max_delay=60)
def is_valid_api_key(api_key):
    test_url = 'https://api.themoviedb.org/3/configuration?api_key=' + api_key
    try:
        response = requests.get(test_url)
        if response.status_code == 200:
            return True
        else:
            log_message(f"API key validation failed with status code: {response.status_code}", level="WARNING")
            return False

    except requests.RequestException as e:
        log_message(f"API key validation error: {str(e)}", level="WARNING")
        return False

def check_api_key():
    """
    Checks if the API key is valid and connection to TMDB is working
    Returns True if API key is valid and connection is working, False otherwise
    """
    global api_key, api_warning_logged

    api_key = get_api_key()

    # Test the API key with a simple request
    try:
        test_url = f"https://api.themoviedb.org/3/configuration?api_key={api_key}"
        response = requests.get(test_url, timeout=5)
        response.raise_for_status()

        # Reset the warning flag if the API key is now working
        if api_warning_logged:
            log_message("TMDB API connection restored", level="INFO")
            api_warning_logged = False

        return True

    except requests.exceptions.RequestException as e:
        if not api_warning_logged:
            if isinstance(e, requests.exceptions.ConnectionError):
                log_message("Unable to connect to TMDB API.", level="ERROR")
            elif isinstance(e, requests.exceptions.Timeout):
                log_message("TMDB API connection timed out. Service may be slow or unavailable.", level="ERROR")
            elif isinstance(e, requests.exceptions.HTTPError) and e.response.status_code == 401:
                log_message("Invalid TMDB API key. Please check your API key and try again.", level="ERROR")
            else:
                log_message(f"TMDB API error: {str(e)}", level="ERROR")

            api_warning_logged = True

        return False
