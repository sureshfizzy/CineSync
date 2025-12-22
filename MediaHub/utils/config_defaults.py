import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from MediaHub.config import config as cfg


def collect_defaults():
    """
    Collect default values from config.py logic without requiring a .env file.
    Only uses the fallback/defaults embedded in config.py helpers.
    """
    defaults = {
        # Directories and structure
        "SOURCE_DIR": "",
        "DESTINATION_DIR": "",
        "USE_SOURCE_STRUCTURE": "false",
        "CINESYNC_LAYOUT": "true",
        "ANIME_SEPARATION": "true",
        "4K_SEPARATION": "true",
        "KIDS_SEPARATION": "false",
        "CUSTOM_SHOW_FOLDER": "Shows",
        "CUSTOM_4KSHOW_FOLDER": "4KShows",
        "CUSTOM_ANIME_SHOW_FOLDER": "AnimeShows",
        "CUSTOM_MOVIE_FOLDER": "Movies",
        "CUSTOM_4KMOVIE_FOLDER": "4KMovies",
        "CUSTOM_ANIME_MOVIE_FOLDER": "AnimeMovies",
        "CUSTOM_KIDS_MOVIE_FOLDER": "KidsMovies",
        "CUSTOM_KIDS_SHOW_FOLDER": "KidsShows",
        "CUSTOM_SPORTS_FOLDER": "Sports",
        # Resolution mappings
        "SHOW_RESOLUTION_STRUCTURE": "false",
        "SHOW_RESOLUTION_FOLDER_REMUX_4K": "UltraHDRemuxShows",
        "SHOW_RESOLUTION_FOLDER_REMUX_1080P": "1080pRemuxLibrary",
        "SHOW_RESOLUTION_FOLDER_REMUX_DEFAULT": "RemuxShows",
        "SHOW_RESOLUTION_FOLDER_2160P": "UltraHD",
        "SHOW_RESOLUTION_FOLDER_1080P": "FullHD",
        "SHOW_RESOLUTION_FOLDER_720P": "SDClassics",
        "SHOW_RESOLUTION_FOLDER_480P": "Retro480p",
        "SHOW_RESOLUTION_FOLDER_DVD": "RetroDVD",
        "SHOW_RESOLUTION_FOLDER_DEFAULT": "Shows",
        "MOVIE_RESOLUTION_STRUCTURE": "false",
        "MOVIE_RESOLUTION_FOLDER_REMUX_4K": "4KRemux",
        "MOVIE_RESOLUTION_FOLDER_REMUX_1080P": "1080pRemux",
        "MOVIE_RESOLUTION_FOLDER_REMUX_DEFAULT": "MoviesRemux",
        "MOVIE_RESOLUTION_FOLDER_2160P": "UltraHD",
        "MOVIE_RESOLUTION_FOLDER_1080P": "FullHD",
        "MOVIE_RESOLUTION_FOLDER_720P": "SDMovies",
        "MOVIE_RESOLUTION_FOLDER_480P": "Retro480p",
        "MOVIE_RESOLUTION_FOLDER_DVD": "DVDClassics",
        "MOVIE_RESOLUTION_FOLDER_DEFAULT": "Movies",
        # Logging
        "LOG_LEVEL": "INFO",
        # Rclone
        "RCLONE_MOUNT": "false",
        "MOUNT_CHECK_INTERVAL": "30",
        # Metadata / IDs
        "TMDB_API_KEY": "your_tmdb_api_key_here",
        "LANGUAGE": "English",
        "ORIGINAL_TITLE": "false",
        "ORIGINAL_TITLE_COUNTRIES": "",
        "ANIME_SCAN": "false",
        "JELLYFIN_ID_FORMAT": "false",
        "TMDB_FOLDER_ID": "false",
        "IMDB_FOLDER_ID": "false",
        "TVDB_FOLDER_ID": "false",
        # Renaming
        "RENAME_ENABLED": "false",
        "MEDIAINFO_PARSER": "false",
        "RENAME_TAGS": "Resolution",
        "MEDIAINFO_RADARR_TAGS": "{Movie Title} ({Release Year}) - {Quality Full}",
        "MEDIAINFO_SONARR_STANDARD_EPISODE_FORMAT": "{Series Title} - S{season:00}E{episode:00} - {Episode Title} {Quality Full}",
        "MEDIAINFO_SONARR_DAILY_EPISODE_FORMAT": "{Series Title} - {Air-Date} - {Episode Title} {Quality Full}",
        "MEDIAINFO_SONARR_ANIME_EPISODE_FORMAT": "{Series Title} - S{season:00}E{episode:00} - {Episode Title} {Quality Full}",
        "MEDIAINFO_SONARR_SEASON_FOLDER_FORMAT": "Season{season}",
        # Collections
        "MOVIE_COLLECTION_ENABLED": "false",
        # System
        "RELATIVE_SYMLINK": "false",
        "MAX_CORES": "2",
        "MAX_PROCESSES": "8",
        # File handling
        "SKIP_EXTRAS_FOLDER": "true",
        "SHOW_EXTRAS_SIZE_LIMIT": "5",
        "MOVIE_EXTRAS_SIZE_LIMIT": "250",
        "4K_SHOW_EXTRAS_SIZE_LIMIT": "800",
        "4K_MOVIE_EXTRAS_SIZE_LIMIT": "2048",
        "ALLOWED_EXTENSIONS": ".mp4,.mkv,.srt,.avi,.mov,.divx,.strm",
        "SKIP_ADULT_PATTERNS": "true",
        # Monitoring
        "SLEEP_TIME": "60",
        "SYMLINK_CLEANUP_INTERVAL": "600",
        # Plex
        "ENABLE_PLEX_UPDATE": "false",
        "PLEX_URL": "",
        "PLEX_TOKEN": "",
        # Server
        "CINESYNC_IP": "0.0.0.0",
        "CINESYNC_PORT": "8082",
        "CINESYNC_AUTH_ENABLED": "true",
        "CINESYNC_USERNAME": "admin",
        "CINESYNC_PASSWORD": "admin",
        # Services
        "MEDIAHUB_AUTO_START": "true",
        "RTM_AUTO_START": "false",
        "FILE_OPERATIONS_AUTO_MODE": "true",
        # Database
        "DB_THROTTLE_RATE": "10",
        "DB_MAX_RETRIES": "3",
        "DB_RETRY_DELAY": "1.0",
        "DB_BATCH_SIZE": "1000",
        "DB_MAX_WORKERS": "20",
    }

    # Do not override with env here; we want pure defaults.
    return defaults


if __name__ == "__main__":
    defaults = collect_defaults()
    json.dump({"defaults": defaults}, sys.stdout)

