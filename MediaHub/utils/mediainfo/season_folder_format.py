import re
import os
import sys

# Add paths for imports
current_dir = os.path.dirname(__file__)
sys.path.append(os.path.join(current_dir, '..', '..'))

from MediaHub.utils.logging_utils import log_message
from MediaHub.config.config import get_sonarr_season_folder_format, mediainfo_parser
from sonarr_utils import (
    extract_show_data, parse_sonarr_conditional_tokens, parse_series_tokens
)

def parse_season_tokens(result, season_data):
    """
    Parse Season tokens with padding support for season folders

    Args:
        result: Current result string
        season_data: Dictionary containing season information

    Returns:
        String with Season tokens replaced
    """
    season_num = season_data.get('season_number', 1)

    # Handle season formatting with padding (including 00 format)
    season_match = re.search(r'\{season:(0+)\}', result)  # Match {season:00} format
    if season_match:
        padding = len(season_match.group(1))
        formatted_season = str(season_num).zfill(padding)
        result = result.replace(season_match.group(0), formatted_season)
    else:
        # Try numeric padding format like {season:2} or {season:0}
        season_match_num = re.search(r'\{season:(\d+)\}', result)
        if season_match_num:
            padding = int(season_match_num.group(1))
            if padding == 0:
                padding = 2
            formatted_season = str(season_num).zfill(padding)
            result = result.replace(season_match_num.group(0), formatted_season)
        else:
            # Basic {season} token uses single digit (no padding)
            result = result.replace('{season}', str(season_num))

    result = re.sub(r'Season(\d)', r'Season \1', result)

    return result

def parse_sonarr_season_folder_tokens(format_string, show_data, season_data):
    """
    Parse Sonarr naming tokens for season folders and replace them with actual values

    Args:
        format_string: The Sonarr format string with tokens
        show_data: Dictionary containing show information
        season_data: Dictionary containing season information

    Returns:
        Formatted season folder name string
    """
    result = format_string
    result = parse_series_tokens(result, show_data)
    result = parse_season_tokens(result, season_data)

    return result

def build_sonarr_season_folder_name(proper_show_name, show_name, season_number):
    """
    Build season folder name using Sonarr naming schema when MEDIAINFO_PARSER is enabled

    Args:
        proper_show_name: Proper show name from TMDB (may include ID)
        show_name: Clean show name
        season_number: Season number

    Returns:
        Formatted season folder name according to Sonarr schema if MEDIAINFO_PARSER enabled, else legacy format
    """
    try:
        # Only use Sonarr naming if MEDIAINFO_PARSER is enabled
        if mediainfo_parser():
            # Extract show data
            show_data = extract_show_data(proper_show_name, show_name)

            # Extract season data
            season_data = {
                'season_number': int(season_number) if season_number else 1
            }

            # Get Sonarr season folder format string
            format_string = get_sonarr_season_folder_format()

            # Parse all tokens
            result = parse_sonarr_season_folder_tokens(format_string, show_data, season_data)
            result = parse_sonarr_conditional_tokens(result)
            return result
        else:
            return build_legacy_season_folder_name(show_name, season_number)

    except Exception as e:
        log_message(f"Error in Sonarr season folder naming: {str(e)}, falling back to legacy naming", level="ERROR")
        return build_legacy_season_folder_name(show_name, season_number)

def build_legacy_season_folder_name(show_name, season_number):
    """
    Build season folder name using legacy naming logic (fallback)

    Args:
        show_name: Show name
        season_number: Season number

    Returns:
        Legacy formatted season folder name
    """
    if season_number:
        return f"Season {str(season_number).zfill(2)}"
    else:
        return "Season 01"

def get_season_folder_name_for_show(proper_show_name, show_name, season_number):
    """
    Get the appropriate season folder name based on configuration
    
    Args:
        proper_show_name: Proper show name from TMDB (may include ID)
        show_name: Clean show name
        season_number: Season number
    
    Returns:
        Season folder name string
    """
    return build_sonarr_season_folder_name(proper_show_name, show_name, season_number)