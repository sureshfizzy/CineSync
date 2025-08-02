import re
import os
import sys
from datetime import datetime

# Add paths for imports
current_dir = os.path.dirname(__file__)
sys.path.append(os.path.join(current_dir, '..', '..'))

from MediaHub.utils.logging_utils import log_message
from MediaHub.config.config import get_sonarr_anime_episode_format, mediainfo_parser
from MediaHub.utils.meta_extraction_engine import get_ffprobe_media_info
from MediaHub.utils.mediainfo import extract_media_info, keywords
from sonarr_utils import (
    BaseSonarrTokenParser, extract_show_data, map_ffprobe_to_sonarr_tokens,
    parse_sonarr_conditional_tokens, parse_sonarr_media_tokens, parse_series_tokens
)

class AnimeEpisodeTokenParser(BaseSonarrTokenParser):
    """
    Token parser for anime episode format
    """

    def parse_absolute_episode_tokens(self, result, episode_data):
        """
        Parse Absolute Episode Number tokens (important for anime)

        Args:
            result: Current result string
            episode_data: Dictionary containing episode information

        Returns:
            String with Absolute Episode tokens replaced
        """
        episode_num = episode_data.get('episode_number', 1)
        absolute_episode = episode_data.get('absolute_episode', episode_num)

        # Handle absolute episode formatting with padding
        absolute_match = re.search(r'\{absolute:(\d+)\}', result)
        if absolute_match:
            padding = int(absolute_match.group(1))
            result = result.replace(absolute_match.group(0), str(absolute_episode).zfill(padding))
        else:
            result = result.replace('{absolute}', str(absolute_episode))

        # Additional absolute episode formats
        absolute_000_match = re.search(r'\{absolute:000\}', result)
        if absolute_000_match:
            result = result.replace('{absolute:000}', str(absolute_episode).zfill(3))

        result = result.replace('{absolute:0}', str(absolute_episode))
        result = result.replace('{absolute:00}', str(absolute_episode).zfill(2))

        return result

    def parse_sonarr_anime_tokens(self, format_string, show_data, episode_data, media_info):
        """
        Parse Sonarr naming tokens for anime episodes and replace them with actual values

        Args:
            format_string: The Sonarr format string with tokens
            show_data: Dictionary containing show information
            episode_data: Dictionary containing episode information
            media_info: Dictionary containing media information from ffprobe

        Returns:
            Formatted filename string for anime episodes
        """
        result = format_string

        # Use shared utility functions for common token parsing
        result = parse_series_tokens(result, show_data)
        result = self.parse_season_episode_tokens(result, episode_data)
        result = self.parse_absolute_episode_tokens(result, episode_data)
        result = self.parse_air_date_tokens(result, episode_data)
        result = self.parse_episode_title_tokens(result, episode_data)
        result = self.parse_quality_tokens(result, media_info)

        return result

# Create parser instance
anime_parser = AnimeEpisodeTokenParser()

def build_sonarr_anime_episode_filename(file_path, root_path, proper_show_name, show_name,
                                       season_number, episode_number, episode_identifier,
                                       episode_title=None, absolute_episode=None):
    """
    Build anime episode filename using Sonarr naming schema when MEDIAINFO_PARSER is enabled

    Args:
        file_path: Original file path
        root_path: Root directory path
        proper_show_name: Proper show name from TMDB (may include ID)
        show_name: Clean show name
        season_number: Season number
        episode_number: Episode number
        episode_identifier: Episode identifier (S01E01)
        episode_title: Episode title from TMDB
        absolute_episode: Absolute episode number (important for anime)

    Returns:
        Formatted filename according to Sonarr anime schema if MEDIAINFO_PARSER enabled, else legacy format
    """
    try:
        # Only use Sonarr naming if MEDIAINFO_PARSER is enabled
        if mediainfo_parser():
            # Get media info using ffprobe
            raw_media_info = get_ffprobe_media_info(os.path.join(root_path, file_path))

            # Map to Sonarr-compatible tokens
            media_info = map_ffprobe_to_sonarr_tokens(raw_media_info, file_path, "anime")

            # Extract show data
            show_data = extract_show_data(proper_show_name, show_name)

            # Extract episode data for anime episodes
            episode_data = {
                'season_number': int(season_number) if season_number else 1,
                'episode_number': int(episode_number) if episode_number else 1,
                'episode_title': episode_title or '',
                'air_date': '',
                'absolute_episode': int(absolute_episode) if absolute_episode else int(episode_number) if episode_number else 1
            }

            # Get Sonarr anime format string
            format_string = get_sonarr_anime_episode_format()

            # Parse all tokens using the parser
            result = anime_parser.parse_sonarr_anime_tokens(format_string, show_data, episode_data, media_info)
            result = parse_sonarr_media_tokens(result, media_info)
            result = parse_sonarr_conditional_tokens(result)

            # Add file extension
            file_ext = os.path.splitext(file_path)[1]
            result = f"{result}{file_ext}"

            log_message(f"Sonarr anime naming: {file_path} -> {result}", level="DEBUG")
            return result
        else:
            return build_legacy_anime_filename(file_path, show_name, episode_identifier, episode_title, absolute_episode)

    except Exception as e:
        log_message(f"Error in Sonarr anime naming: {str(e)}, falling back to legacy naming", level="ERROR")
        return build_legacy_anime_filename(file_path, show_name, episode_identifier, episode_title, absolute_episode)

def build_legacy_anime_filename(file_path, show_name, episode_identifier, episode_title, absolute_episode):
    """
    Build filename using legacy naming logic for anime episodes (fallback)

    Args:
        file_path: Original file path
        show_name: Show name
        episode_identifier: Episode identifier
        episode_title: Episode title
        absolute_episode: Absolute episode number

    Returns:
        Legacy formatted filename for anime episodes
    """
    if absolute_episode:
        # Use absolute episode number for anime
        if episode_title:
            base_name = f"{show_name} - {str(absolute_episode).zfill(3)} - {episode_title}"
        else:
            base_name = f"{show_name} - {str(absolute_episode).zfill(3)}"
    else:
        # Fall back to standard episode identifier
        if episode_title:
            base_name = f"{show_name} - {episode_identifier} - {episode_title}"
        else:
            base_name = f"{show_name} - {episode_identifier}"

    file_ext = os.path.splitext(file_path)[1]
    return f"{base_name}{file_ext}"