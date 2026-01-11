import re
import os
import sys
from datetime import datetime

# Add paths for imports
current_dir = os.path.dirname(__file__)
sys.path.append(os.path.join(current_dir, '..', '..'))

from MediaHub.utils.logging_utils import log_message
from MediaHub.config.config import get_sonarr_daily_episode_format, mediainfo_parser
from MediaHub.utils.meta_extraction_engine import get_ffprobe_media_info
from MediaHub.utils.mediainfo_extractor import extract_media_info, keywords
from sonarr_utils import (
    BaseSonarrTokenParser, extract_show_data, map_ffprobe_to_sonarr_tokens,
    parse_sonarr_conditional_tokens, parse_sonarr_media_tokens, parse_series_tokens
)

class DailyEpisodeTokenParser(BaseSonarrTokenParser):
    """
    Token parser for daily episode format
    """

    def parse_air_date_tokens(self, result, episode_data):
        """
        Parse Air Date tokens with daily episode specific logic

        Args:
            result: Current result string
            episode_data: Dictionary containing episode information

        Returns:
            String with Air Date tokens replaced
        """
        air_date = episode_data.get('air_date', '')
        if air_date:
            try:
                date_obj = datetime.strptime(air_date, '%Y-%m-%d')
                result = result.replace('{Air-Date}', air_date)
                result = result.replace('{Air Date}', date_obj.strftime('%Y %m %d'))
            except:
                # Fallback to current date if air_date parsing fails
                current_date = datetime.now()
                result = result.replace('{Air-Date}', current_date.strftime('%Y-%m-%d'))
                result = result.replace('{Air Date}', current_date.strftime('%Y %m %d'))
        else:
            # Use current date as fallback for daily episodes
            current_date = datetime.now()
            result = result.replace('{Air-Date}', current_date.strftime('%Y-%m-%d'))
            result = result.replace('{Air Date}', current_date.strftime('%Y %m %d'))

        return result

    def parse_sonarr_daily_tokens(self, format_string, show_data, episode_data, media_info):
        """
        Parse Sonarr naming tokens for daily episodes and replace them with actual values

        Args:
            format_string: The Sonarr format string with tokens
            show_data: Dictionary containing show information
            episode_data: Dictionary containing episode information
            media_info: Dictionary containing media information from ffprobe

        Returns:
            Formatted filename string for daily episodes
        """
        result = format_string

        # Use shared utility functions for common token parsing
        result = parse_series_tokens(result, show_data)
        result = self.parse_air_date_tokens(result, episode_data)  # Use daily-specific air date logic
        result = self.parse_episode_title_tokens(result, episode_data)
        result = self.parse_quality_tokens(result, media_info)

        return result

# Create parser instance
daily_parser = DailyEpisodeTokenParser()

def build_sonarr_daily_episode_filename(file_path, root_path, proper_show_name, show_name,
                                       air_date=None, episode_title=None):
    """
    Build daily episode filename using Sonarr naming schema when MEDIAINFO_PARSER is enabled

    Args:
        file_path: Original file path
        root_path: Root directory path
        proper_show_name: Proper show name from TMDB (may include ID)
        show_name: Clean show name
        air_date: Air date of the episode (YYYY-MM-DD format)
        episode_title: Episode title from TMDB

    Returns:
        Formatted filename according to Sonarr daily schema if MEDIAINFO_PARSER enabled, else legacy format
    """
    try:
        # Only use Sonarr naming if MEDIAINFO_PARSER is enabled
        if mediainfo_parser():
            # Get media info using ffprobe
            raw_media_info = get_ffprobe_media_info(os.path.join(root_path, file_path))

            # Map to Sonarr-compatible tokens
            media_info = map_ffprobe_to_sonarr_tokens(raw_media_info, file_path, "daily")

            # Extract show data
            show_data = extract_show_data(proper_show_name, show_name)

            # Extract episode data for daily episodes
            episode_data = {
                'episode_title': episode_title or '',
                'air_date': air_date or datetime.now().strftime('%Y-%m-%d')  # Use current date as fallback
            }

            # Get Sonarr daily format string
            format_string = get_sonarr_daily_episode_format()

            # Parse all tokens using the parser
            result = daily_parser.parse_sonarr_daily_tokens(format_string, show_data, episode_data, media_info)
            result = parse_sonarr_media_tokens(result, media_info)
            result = parse_sonarr_conditional_tokens(result)

            # Add file extension
            file_ext = os.path.splitext(file_path)[1]
            result = f"{result}{file_ext}"

            log_message(f"Sonarr daily naming: {file_path} -> {result}", level="DEBUG")
            return result
        else:
            return build_legacy_daily_filename(file_path, show_name, air_date, episode_title)

    except Exception as e:
        log_message(f"Error in Sonarr daily naming: {str(e)}, falling back to legacy naming", level="ERROR")
        return build_legacy_daily_filename(file_path, show_name, air_date, episode_title)

def build_legacy_daily_filename(file_path, show_name, air_date, episode_title):
    """
    Build filename using legacy naming logic for daily episodes (fallback)

    Args:
        file_path: Original file path
        show_name: Show name
        air_date: Air date of the episode
        episode_title: Episode title

    Returns:
        Legacy formatted filename for daily episodes
    """
    if episode_title:
        if air_date:
            base_name = f"{show_name} - {air_date} - {episode_title}"
        else:
            base_name = f"{show_name} - {episode_title}"
    else:
        if air_date:
            base_name = f"{show_name} - {air_date}"
        else:
            base_name = f"{show_name} - {datetime.now().strftime('%Y-%m-%d')}"

    file_ext = os.path.splitext(file_path)[1]
    return f"{base_name}{file_ext}"