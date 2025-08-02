import re
import os
import sys
from datetime import datetime

# Add paths for imports
current_dir = os.path.dirname(__file__)
sys.path.append(os.path.join(current_dir, '..', '..'))

from MediaHub.utils.logging_utils import log_message
from MediaHub.config.config import get_sonarr_standard_episode_format, mediainfo_parser
from MediaHub.utils.meta_extraction_engine import get_ffprobe_media_info
from MediaHub.utils.mediainfo import extract_media_info, keywords
from sonarr_utils import (
    BaseSonarrTokenParser, extract_show_data, map_ffprobe_to_sonarr_tokens,
    parse_sonarr_conditional_tokens, parse_sonarr_media_tokens, parse_series_tokens
)

class StandardEpisodeTokenParser(BaseSonarrTokenParser):
    """
    Token parser for standard episode format
    """

    def parse_sonarr_tokens(self, format_string, show_data, episode_data, media_info):
        """
        Parse Sonarr naming tokens and replace them with actual values

        Args:
            format_string: The Sonarr format string with tokens
            show_data: Dictionary containing show information
            episode_data: Dictionary containing episode information
            media_info: Dictionary containing media information from ffprobe

        Returns:
            Formatted filename string
        """
        result = format_string

        # Use shared utility functions for common token parsing
        result = parse_series_tokens(result, show_data)
        result = self.parse_season_episode_tokens(result, episode_data)
        result = self.parse_air_date_tokens(result, episode_data)
        result = self.parse_episode_title_tokens(result, episode_data)
        result = self.parse_quality_tokens(result, media_info)

        return result

# Create parser instance
standard_parser = StandardEpisodeTokenParser()

def build_sonarr_episode_filename(file_path, root_path, proper_show_name, show_name,
                                 season_number, episode_number, episode_identifier,
                                 episode_title=None):
    """
    Build episode filename using Sonarr naming schema when MEDIAINFO_PARSER is enabled

    Args:
        file_path: Original file path
        root_path: Root directory path
        proper_show_name: Proper show name from TMDB (may include ID)
        show_name: Clean show name
        season_number: Season number
        episode_number: Episode number
        episode_identifier: Episode identifier (S01E01)
        episode_title: Episode title from TMDB

    Returns:
        Formatted filename according to Sonarr schema if MEDIAINFO_PARSER enabled, else legacy format
    """
    try:
        # Only use Sonarr naming if MEDIAINFO_PARSER is enabled
        if mediainfo_parser():
            # Get media info using ffprobe
            raw_media_info = get_ffprobe_media_info(os.path.join(root_path, file_path))

            # Map to Sonarr-compatible tokens
            media_info = map_ffprobe_to_sonarr_tokens(raw_media_info, file_path, "standard")

            # Extract show data
            show_data = extract_show_data(proper_show_name, show_name)

            # Extract episode data
            episode_data = {
                'season_number': int(season_number) if season_number else 1,
                'episode_number': int(episode_number) if episode_number else 1,
                'episode_title': episode_title or '',
                'air_date': ''
            }

            # Get Sonarr format string
            format_string = get_sonarr_standard_episode_format()

            # Parse all tokens using the parser
            result = standard_parser.parse_sonarr_tokens(format_string, show_data, episode_data, media_info)
            result = parse_sonarr_media_tokens(result, media_info)
            result = parse_sonarr_conditional_tokens(result)

            # Add file extension
            file_ext = os.path.splitext(file_path)[1]
            result = f"{result}{file_ext}"

            return result
        else:
            return build_legacy_filename(file_path, show_name, episode_identifier, episode_title)

    except Exception as e:
        log_message(f"Error in Sonarr naming: {str(e)}, falling back to legacy naming", level="ERROR")
        return build_legacy_filename(file_path, show_name, episode_identifier, episode_title)

def build_legacy_filename(file_path, show_name, episode_identifier, episode_title):
    """
    Build filename using legacy naming logic (fallback)

    Args:
        file_path: Original file path
        show_name: Show name
        episode_identifier: Episode identifier
        episode_title: Episode title

    Returns:
        Legacy formatted filename
    """
    if episode_title:
        base_name = f"{show_name} - {episode_title}".replace(' - -', ' -')
    else:
        base_name = f"{show_name} - {episode_identifier}"

    file_ext = os.path.splitext(file_path)[1]
    return f"{base_name}{file_ext}"