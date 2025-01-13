import os
import sys
import requests
from dotenv import load_dotenv
from MediaHub.utils.logging_utils import log_message

api_key = None
api_warning_logged = False
offline_mode = False

# Load .env file
dotenv_path = os.path.join(os.path.dirname(__file__), '..', '.env')
load_dotenv(dotenv_path)

def get_api_key():
    global api_key, api_warning_logged, offline_mode

    if api_key is not None:
        return api_key

    api_key = os.getenv('TMDB_API_KEY')

    if not api_key or api_key == 'your_tmdb_api_key_here':
        if not api_warning_logged:
            log_message("TMDb API key not found or is a placeholder. TMDb functionality is not enabled. Running in offline mode.", level="WARNING")
            offline_mode = True
            api_warning_logged = True
        return None

    # Validate API key
    if not is_valid_api_key(api_key):
        if not api_warning_logged:
            log_message("Invalid TMDb API key. TMDb functionality may not work as expected. Running in offline mode.", level="WARNING")
            offline_mode = True
            api_warning_logged = True
        return None

    return api_key

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

def get_directories():
    src_dirs = os.getenv('SOURCE_DIR')
    dest_dir = os.getenv('DESTINATION_DIR')
    if not src_dirs or not dest_dir:
        log_message("SOURCE_DIRS or DESTINATION_DIR not set in environment variables.", level="ERROR")
        sys.exit(1)
    return src_dirs.split(','), dest_dir

def is_tmdb_folder_id_enabled():
    return os.getenv('TMDB_FOLDER_ID', 'true').lower() in ['true', '1', 'yes']

def is_imdb_folder_id_enabled():
    return os.getenv('IMDB_FOLDER_ID', 'false').lower() == 'true'

def is_tvdb_folder_id_enabled():
    return os.getenv('TVDB_FOLDER_ID', 'false').lower() == 'true'

def is_rename_enabled():
    return os.getenv('RENAME_ENABLED', 'false').lower() in ['true', '1', 'yes']

def is_movie_collection_enabled():
    return os.getenv('MOVIE_COLLECTION_ENABLED', 'false').lower() in ['true', '1', 'yes']

def is_skip_extras_folder_enabled():
    return os.getenv('SKIP_EXTRAS_FOLDER', 'false').lower() in ['true', '1', 'yes']

def get_extras_max_size_mb():
    return int(os.getenv('EXTRAS_MAX_SIZE_MB', '100'))

def is_source_structure_enabled():
    return os.getenv('USE_SOURCE_STRUCTURE', 'false').lower() == 'true'

def is_skip_patterns_enabled():
    return os.getenv('SKIP_ADULT_PATTERNS', 'false').lower() == 'true'

def is_rclone_mount_enabled():
    return os.getenv('RCLONE_MOUNT', 'false').lower() == 'true'

def is_mount_check_interval():
    return int(os.getenv('MOUNT_CHECK_INTERVAL', '30'))

def is_anime_scan():
    return os.getenv('ANIME_SCAN', 'false').lower() == 'true'

def is_cinesync_layout_enabled():
    return os.getenv('CINESYNC_LAYOUT', 'false').lower() == 'true'

def custom_show_layout():
    token = os.getenv('CUSTOM_SHOW_FOLDER', None)
    return token

def custom_movie_layout():
    token = os.getenv('CUSTOM_MOVIE_FOLDER', None)
    return token

def custom_anime_movie_layout():
    token = os.getenv('CUSTOM_ANIME_MOVIE_FOLDER', None)
    return token

def custom_anime_show_layout():
    token = os.getenv('CUSTOM_ANIME_SHOW_FOLDER', None)
    return token

def get_rename_tags():
    tags = os.getenv('RENAME_TAGS', '').split(',')
    return [tag.strip() for tag in tags if tag.strip()]

def plex_update():
    return os.getenv('ENABLE_PLEX_UPDATE', 'false').lower() == 'true'

def plex_token():
    token = os.getenv('PLEX_TOKEN', None)
    return token

def plex_url():
    token = os.getenv('PLEX_URL', None)
    return token

def get_known_types(filename=None):
    known_types = set(ext.strip().lower() for ext in os.getenv('ALLOWED_EXTENSIONS', '.mkv,.mp4').split(','))
    if filename is not None:
        if not filename:
            return False
        _, ext = os.path.splitext(filename.lower())
        return ext in known_types
    return known_types

def is_show_resolution_structure_enabled():
    """Check if resolution structure is enabled in configuration"""
    return os.getenv('SHOW_RESOLUTION_STRUCTURE', 'false').lower() == 'true'

def is_movie_resolution_structure_enabled():
    """Check if resolution structure is enabled in configuration"""
    return os.getenv('MOVIE_RESOLUTION_STRUCTURE', 'false').lower() == 'true'

def is_anime_separation_enabled():
    """Check if anime content should be separated into different folders"""
    return os.getenv('ANIME_SEPARATION', 'false').lower() == 'true'
