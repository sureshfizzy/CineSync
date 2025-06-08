import os
import sys
import re
import requests
from dotenv import load_dotenv
from MediaHub.utils.logging_utils import log_message
from MediaHub.api.api_key_manager import get_api_key

api_key = None
api_warning_logged = False

# Load .env file
dotenv_path = os.path.join(os.path.dirname(__file__), '..', '.env')
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

def is_rename_enabled():
    return os.getenv('RENAME_ENABLED', 'false').lower() in ['true', '1', 'yes']

def is_movie_collection_enabled():
    return os.getenv('MOVIE_COLLECTION_ENABLED', 'false').lower() in ['true', '1', 'yes']

def is_skip_extras_folder_enabled():
    return os.getenv('SKIP_EXTRAS_FOLDER', 'false').lower() in ['true', '1', 'yes']

def get_junk_max_size_mb():
     return int(os.getenv('JUNK_MAX_SIZE_MB', '5'))

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

def get_mediainfo_tags():
    """Get mediainfo tags from environment variable and properly clean them"""
    tags_env = os.getenv('MEDIAINFO_TAGS', '')
    if not tags_env:
        return []

    tags = re.findall(r'\{([^{}]+)\}', tags_env)
    return [tag.strip() for tag in tags]

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

def is_4k_separation_enabled():
    """Check if 4K content separation should be enabled"""
    return os.getenv('4K_SEPARATION', 'true').lower() == 'true'

def tmdb_api_language():
    return os.getenv('LANGUAGE', 'ENGLISH').lower()

def mediainfo_parser():
    """Check if MEDIA PARSER is enabled in configuration"""
    return os.getenv('MEDIAINFO_PARSER', 'false').lower() == 'true'

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
        if '2160' in file or '4k' in file.lower():
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
        if '2160' in file or '4k' in file.lower():
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
