import os
import sys
import re
import requests
import json
from dotenv import load_dotenv
from MediaHub.utils.logging_utils import log_message
from MediaHub.utils.env_creator import get_env_file_path

# Beta features that are currently disabled (HARDCODED)
BETA_DISABLED_FEATURES = {
}

# Client locked settings - loaded from JSON file if available
def load_client_locked_settings():
    """Load client locked settings from MediaHub/utils folder if available"""

    json_path = os.path.join(os.path.dirname(__file__), '..', 'utils', 'client_locked_settings.json')

    try:
        if os.path.exists(json_path):
            with open(json_path, 'r') as f:
                data = json.load(f)
                return data.get('locked_settings', {})
    except (json.JSONDecodeError, IOError):
        pass

    # No JSON file found or readable, return empty dict
    return {}

def is_beta_feature_disabled(feature_name):
    """Check if a beta feature is disabled and log warning if attempted to use"""
    if feature_name in BETA_DISABLED_FEATURES:
        log_message(f"{BETA_DISABLED_FEATURES[feature_name]} This setting will be ignored.", level="WARNING")
        return True
    return False

def get_setting_with_client_lock(setting_name, default_value, value_type='string'):
    """
    Get a setting value with client lock support.
    Client locks are loaded from MediaHub/utils/client_locked_settings.json if available.
    """
    # Load client locked settings from JSON file
    client_locked_settings = load_client_locked_settings()

    # Check if setting is locked by client (from JSON file)
    if setting_name in client_locked_settings and client_locked_settings[setting_name].get('locked', False):
        locked_value = client_locked_settings[setting_name]['value']
        env_value = os.getenv(setting_name)

        # Log warning if user tries to override locked setting
        if env_value and str(env_value) != str(locked_value):
            log_message(f"{setting_name} is locked by System Administrator. Environment value '{env_value}' ignored, using '{locked_value}'.", level="DEBUG")

        # Convert type if needed
        if value_type == 'int':
            return int(locked_value)
        elif value_type == 'bool':
            if isinstance(locked_value, bool):
                return locked_value
            elif isinstance(locked_value, str):
                return locked_value.lower() in ['true', '1', 'yes']
            else:
                return str(locked_value).lower() in ['true', '1', 'yes']
        else:
            return locked_value

    env_value = os.getenv(setting_name)
    if env_value:
        if value_type == 'int':
            try:
                return int(env_value)
            except ValueError:
                log_message(f"Invalid integer value for {setting_name}: '{env_value}'. Using default.", level="WARNING")
                return default_value
        elif value_type == 'bool':
            return env_value.lower() in ['true', '1', 'yes']
        else:
            return env_value

    # No environment variable, use default
    return default_value

api_key = None
api_warning_logged = False

def get_env_int(key, default):
    """Safely get an integer environment variable with a default value."""
    try:
        value = os.getenv(key)
        if value is None or value.strip() == '':
            return default
        return int(value)
    except (ValueError, TypeError):
        return default

def get_env_float(key, default):
    """Safely get a float environment variable with a default value."""
    try:
        value = os.getenv(key)
        if value is None or value.strip() == '':
            return default
        return float(value)
    except (ValueError, TypeError):
        return default

# Load .env file
dotenv_path = get_env_file_path()
load_dotenv(dotenv_path)

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

def is_jellyfin_id_format_enabled():
    """Check if Jellyfin ID format should be used for ID tags (square brackets vs curly braces)"""
    return os.getenv('JELLYFIN_ID_FORMAT', 'false').lower() in ['true', '1', 'yes']

def is_rename_enabled():
    return os.getenv('RENAME_ENABLED', 'false').lower() in ['true', '1', 'yes']

def is_movie_collection_enabled():
    return os.getenv('MOVIE_COLLECTION_ENABLED', 'false').lower() in ['true', '1', 'yes']

def is_skip_extras_folder_enabled():
    return os.getenv('SKIP_EXTRAS_FOLDER', 'false').lower() in ['true', '1', 'yes']

def get_show_extras_size_limit():
     return get_env_int('SHOW_EXTRAS_SIZE_LIMIT', 5)

def get_movie_extras_size_limit():
    """Get maximum allowed file size for movie extras in MB"""
    return get_env_int('MOVIE_EXTRAS_SIZE_LIMIT', 250)

def get_4k_movie_extras_size_limit():
    """Get maximum allowed file size for 4K movie extras in MB"""
    return get_env_int('4K_MOVIE_EXTRAS_SIZE_LIMIT', 2048)

def get_4k_show_extras_size_limit():
    """Get maximum allowed file size for 4K show extras in MB"""
    return get_env_int('4K_SHOW_EXTRAS_SIZE_LIMIT', 800)

def is_source_structure_enabled():
    return os.getenv('USE_SOURCE_STRUCTURE', 'false').lower() == 'true'

def is_skip_patterns_enabled():
    return os.getenv('SKIP_ADULT_PATTERNS', 'false').lower() == 'true'

def is_rclone_mount_enabled():
    return os.getenv('RCLONE_MOUNT', 'false').lower() == 'true'

def is_mount_check_interval():
    return get_env_int('MOUNT_CHECK_INTERVAL', 30)

def is_anime_scan():
    return os.getenv('ANIME_SCAN', 'false').lower() == 'true'

def is_cinesync_layout_enabled():
    return os.getenv('CINESYNC_LAYOUT', 'false').lower() == 'true'

def custom_show_layout():
    token = os.getenv('CUSTOM_SHOW_FOLDER', None)
    return token

def custom_4kshow_layout():
    token = os.getenv('CUSTOM_4KSHOW_FOLDER', None)
    return token

def custom_movie_layout():
    token = os.getenv('CUSTOM_MOVIE_FOLDER', None)
    return token

def custom_4kmovie_layout():
    token = os.getenv('CUSTOM_4KMOVIE_FOLDER', None)
    return token

def custom_anime_movie_layout():
    token = os.getenv('CUSTOM_ANIME_MOVIE_FOLDER', None)
    return token

def custom_anime_show_layout():
    token = os.getenv('CUSTOM_ANIME_SHOW_FOLDER', None)
    return token

def custom_kids_movie_layout():
    token = os.getenv('CUSTOM_KIDS_MOVIE_FOLDER', None)
    return token

def custom_kids_show_layout():
    token = os.getenv('CUSTOM_KIDS_SHOW_FOLDER', None)
    return token

def custom_sports_layout():
    token = os.getenv('CUSTOM_SPORTS_FOLDER', None)
    return token

def get_mediainfo_radarr_tags():
    """Get mediainfo radarr tags from environment variable and properly clean them"""
    tags_env = os.getenv('MEDIAINFO_RADARR_TAGS', '')
    if not tags_env:
        return []

    tags = re.findall(r'\{([^{}]+)\}', tags_env)
    return [tag.strip() for tag in tags]

def get_sonarr_standard_episode_format():
    """Get Sonarr standard episode format from environment variable"""
    return os.getenv('MEDIAINFO_SONARR_STANDARD_EPISODE_FORMAT',
                    '{Series Title} - S{season:00}E{episode:00} - {Episode Title} {Quality Full}')

def get_sonarr_daily_episode_format():
    """Get Sonarr daily episode format from environment variable"""
    return os.getenv('MEDIAINFO_SONARR_DAILY_EPISODE_FORMAT',
                    '{Series Title} - {Air-Date} - {Episode Title} {Quality Full}')

def get_sonarr_anime_episode_format():
    """Get Sonarr anime episode format from environment variable"""
    return os.getenv('MEDIAINFO_SONARR_ANIME_EPISODE_FORMAT',
                    '{Series Title} - S{season:00}E{episode:00} - {Episode Title} {Quality Full}')

def get_sonarr_season_folder_format():
    """Get Sonarr season folder format from environment variable"""
    return os.getenv('MEDIAINFO_SONARR_SEASON_FOLDER_FORMAT',
                    'Season{season}')

def get_rename_tags():
    """Get rename tags from environment variable and properly clean them"""
    tags_env = os.getenv('RENAME_TAGS', '')
    if not tags_env:
        return []

    tags = []
    for tag in tags_env.split(','):
        tag = tag.strip()
        if (tag.startswith('`') and tag.endswith('`')) or \
           (tag.startswith('"') and tag.endswith('"')) or \
           (tag.startswith("'") and tag.endswith("'")):
            tag = tag[1:-1]
        tag = tag.replace('[', '').replace(']', '')
        if tag:
            tags.append(tag)

    return tags

def plex_update():
    return os.getenv('ENABLE_PLEX_UPDATE', 'false').lower() == 'true'

def plex_token():
    token = os.getenv('PLEX_TOKEN', None)
    return token

def plex_url():
    token = os.getenv('PLEX_URL', None)
    return token

def get_known_types(filename=None):
    known_types = set(ext.strip().lower() for ext in os.getenv('ALLOWED_EXTENSIONS', '.mkv,.mp4,.srt,.strm').split(','))
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

def is_4k_separation_enabled():
    """Check if 4K content separation should be enabled"""
    value = os.getenv('_4K_SEPARATION') or os.getenv('4K_SEPARATION', 'true')
    return value.lower() == 'true'

def is_kids_separation_enabled():
    """Check if kids content separation should be enabled"""
    return get_setting_with_client_lock('KIDS_SEPARATION', False, 'bool')

def tmdb_api_language():
    return os.getenv('LANGUAGE', 'ENGLISH').lower()

def mediainfo_parser():
    """Check if MEDIA PARSER is enabled in configuration"""
    return os.getenv('MEDIAINFO_PARSER', 'false').lower() == 'true'

def get_max_cores():
    """Get the maximum number of CPU cores for CPU-bound operations"""
    try:
        # Use hardcoded client lock system
        max_cores = get_setting_with_client_lock('MAX_CORES', 0, 'int')
        from multiprocessing import cpu_count

        cpu_cores = cpu_count()

        if max_cores <= 0:
            max_cores = cpu_cores
        else:
            max_cores = min(max_cores, cpu_cores)

        return max_cores
    except (ValueError, TypeError):
        from multiprocessing import cpu_count
        return cpu_count()

def get_max_processes():
    """Get the maximum number of processes for I/O-bound parallel processing (API calls, file operations)"""
    try:
        # Use hardcoded client lock system
        max_processes = get_setting_with_client_lock('MAX_PROCESSES', 8, 'int')
        from multiprocessing import cpu_count

        # Respect user's MAX_PROCESSES setting, but ensure it's reasonable
        cpu_cores = cpu_count()
        max_processes = max(1, min(max_processes, 32))

        return max_processes
    except (ValueError, TypeError):
        return 8

def get_movie_resolution_folder(file, resolution):
    """Get movie resolution folder mappings from environment variables and determine the movie resolution folder."""

    default_mappings = {
        'remux_4k': '4KRemux',
        'remux_1080p': '1080pRemux',
        'remux_default': 'MoviesRemux',
        '2160p': 'UltraHD',
        '1080p': 'FullHD',
        '720p': 'SDMovies',
        '480p': 'Retro480p',
        'dvd': 'DVDClassics',
        'default': 'Movies'
    }

    custom_mappings = {}
    for key in default_mappings.keys():
        env_key = f'MOVIE_RESOLUTION_FOLDER_{key.upper()}'
        custom_value = os.getenv(env_key)
        if custom_value:
            custom_mappings[key] = custom_value

    mappings = {**default_mappings, **custom_mappings}

    if 'remux' in file.lower():
        if '2160' in file or re.search(r'\b4k\b', file, re.IGNORECASE):
            return mappings.get('remux_4k', '4KRemux')
        elif '1080' in file:
            return mappings.get('remux_1080p', '1080pRemux')
        else:
            return mappings.get('remux_default', 'MoviesRemux')
    else:
        resolution = resolution.lower() if resolution else 'default'
        if resolution == '2160p' or resolution == '4k':
            return mappings.get('2160p', 'UltraHD')
        elif resolution == '1080p':
            return mappings.get('1080p', 'FullHD')
        elif resolution == '720p':
            return mappings.get('720p', 'SDMovies')
        elif resolution == '480p':
            return mappings.get('480p', 'Retro480p')
        elif resolution == 'dvd':
            return mappings.get('dvd', 'DVDClassics')
        else:
            return mappings.get('default', 'Movies')

def get_movie_collections_folder():
    """Get the movie collections folder name from environment variables"""
    return os.getenv('MOVIE_COLLECTIONS_FOLDER', 'Movie Collections')

def get_show_resolution_folder(file, resolution):
    """Get resolution folder mappings from environment variables and determine the resolution folder."""

    default_mappings = {
        'remux_4k': 'UltraHDRemuxShows',
        'remux_1080p': '1080pRemuxLibrary',
        'remux_default': 'RemuxShows',
        '2160p': 'UltraHD',
        '1080p': 'FullHD',
        '720p': 'SDClassics',
        '480p': 'Retro480p',
        'dvd': 'RetroDVD',
        'default': 'Shows'
    }

    custom_mappings = {}
    for key in default_mappings.keys():
        env_key = f'SHOW_RESOLUTION_FOLDER_{key.upper()}'
        custom_value = os.getenv(env_key)
        if custom_value:
            custom_mappings[key] = custom_value

    mappings = {**default_mappings, **custom_mappings}

    if 'remux' in file.lower():
        if '2160' in file or re.search(r'\b4k\b', file, re.IGNORECASE):
            return mappings.get('remux_4k', 'UltraHDRemuxShows')
        elif '1080' in file:
            return mappings.get('remux_1080p', '1080pRemuxLibrary')
        else:
            return mappings.get('remux_default', 'RemuxShows')
    else:
        resolution = resolution.lower()
        if resolution == '2160p' or resolution == '4k':
            return mappings.get('2160p', 'UltraHD')
        elif resolution == '1080p':
            return mappings.get('1080p', 'FullHD')
        elif resolution == '720p':
            return mappings.get('720p', 'SDClassics')
        elif resolution == '480p':
            return mappings.get('480p', 'Retro480p')
        elif resolution == 'dvd':
            return mappings.get('dvd', 'RetroDVD')
        else:
            return mappings.get('default', 'Shows')

def get_cinesync_ip():
    """Get CineSync IP from environment variable for client connections"""
    ip = os.getenv('CINESYNC_IP', 'localhost')
    # Convert 0.0.0.0 (server bind address) to localhost for client connections
    if ip == '0.0.0.0':
        return 'localhost'
    return ip

def get_cinesync_api_port():
    """Get CineSync API port from environment variable"""
    return os.getenv('CINESYNC_API_PORT', '8082')

def get_tmdb_api_key():
    """
    Get TMDB API key with fallback mechanism.
    First tries to get from environment variable, then falls back to default key
    if the environment key is missing, placeholder, or invalid.
    """
    env_key = os.getenv('TMDB_API_KEY', '').strip()

    # Check if the environment key is missing, empty, or a placeholder
    placeholder_values = [
        '',
        'your_tmdb_api_key_here',
        'your-tmdb-api-key',
        'placeholder',
        'none',
        'null'
    ]

    if not env_key or env_key.lower() in placeholder_values:
        return 'a4f28c50ae81b7529a05b61910d64398'

    return env_key

# Database Configuration Functions
def get_db_throttle_rate():
    """Get database throttle rate for operations per second"""
    return get_env_float('DB_THROTTLE_RATE', 10.0)

def get_db_max_retries():
    """Get maximum number of database operation retries"""
    return get_env_int('DB_MAX_RETRIES', 3)

def get_db_retry_delay():
    """Get delay between database operation retries in seconds"""
    return get_env_float('DB_RETRY_DELAY', 1.0)

def get_db_batch_size():
    """Get database batch size for bulk operations"""
    return get_env_int('DB_BATCH_SIZE', 1000)

def get_db_max_workers():
    """Get maximum number of database workers for parallel operations"""
    return get_env_int('DB_MAX_WORKERS', 20)

def get_db_max_records():
    """Get maximum number of records before archiving"""
    return get_env_int('DB_MAX_RECORDS', 100000)

def get_db_connection_timeout():
    """Get database connection timeout in seconds"""
    return get_env_float('DB_CONNECTION_TIMEOUT', 20.0)

def is_auto_mode_enabled():
    """
    Check if FILE_OPERATIONS_AUTO_MODE is enabled.
    Returns True if auto processing should happen, False otherwise.
    """
    try:
        auto_mode = get_setting_with_client_lock('FILE_OPERATIONS_AUTO_MODE', 'true', 'boolean')
        return auto_mode.lower() == 'true' if isinstance(auto_mode, str) else bool(auto_mode)
    except Exception as e:
        log_message(f"Error checking FILE_OPERATIONS_AUTO_MODE setting: {e}", level="WARNING")
        return False

def get_db_cache_size():
    """Get database cache size"""
    return get_env_int('DB_CACHE_SIZE', 10000)

# Dashboard Configuration Functions
def is_dashboard_notifications_enabled():
    """Check if dashboard notifications should be sent"""
    return os.getenv('ENABLE_DASHBOARD_NOTIFICATIONS', 'true').lower() in ['true', '1', 'yes']

def get_dashboard_check_interval():
    """Get interval in seconds for checking dashboard availability"""
    return get_env_int('DASHBOARD_CHECK_INTERVAL', 300)  # 5 minutes default

def get_dashboard_timeout():
    """Get timeout in seconds for dashboard requests"""
    return get_env_float('DASHBOARD_TIMEOUT', 2.0)

def get_dashboard_retry_count():
    """Get number of retries for dashboard requests"""
    return get_env_int('DASHBOARD_RETRY_COUNT', 1)
