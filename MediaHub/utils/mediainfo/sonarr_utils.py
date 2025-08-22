"""
Shared Utilities for Sonarr Naming Conventions

This module contains all shared utility functions used across different Sonarr naming format modules.
It eliminates code duplication and provides a central place for common functionality.
"""

import re
import os
from datetime import datetime
from MediaHub.utils.logging_utils import log_message

def clean_title_for_filename(title):
    """
    Clean title for use in filename (remove/replace invalid characters)
    
    Args:
        title: Original title string
    
    Returns:
        Cleaned title safe for filenames
    """
    if not title:
        return ''
    
    # Replace invalid filename characters
    invalid_chars = r'[<>:"/\\|?*]'
    cleaned = re.sub(invalid_chars, '', title)
    
    # Replace multiple spaces with single space
    cleaned = re.sub(r'\s+', ' ', cleaned)
    
    return cleaned.strip()

def move_article_to_end(title):
    """
    Move articles (The, A, An) from beginning to end
    
    Args:
        title: Original title
    
    Returns:
        Title with article moved to end
    """
    if not title:
        return title
    
    articles = ['The ', 'A ', 'An ']
    for article in articles:
        if title.startswith(article):
            return f"{title[len(article):]}, {article.strip()}"
    
    return title

def extract_show_data(proper_show_name, show_name):
    """
    Extract show data from proper show name (unified for all formats)
    
    Args:
        proper_show_name: Show name with potential IDs and year
        show_name: Clean show name
    
    Returns:
        Dictionary with show data
    """
    show_data = {
        'series_title': show_name,
        'series_year': '',
        'tmdb_id': '',
        'imdb_id': '',
        'tvdb_id': ''
    }

    # Extract year
    year_match = re.search(r'\((\d{4})\)', proper_show_name)
    if year_match:
        show_data['series_year'] = year_match.group(1)

    # Extract TMDB ID
    tmdb_match = re.search(r'\{tmdb-(\d+)\}', proper_show_name)
    if tmdb_match:
        show_data['tmdb_id'] = tmdb_match.group(1)

    # Extract IMDB ID
    imdb_match = re.search(r'\{imdb-(tt\d+)\}', proper_show_name)
    if imdb_match:
        show_data['imdb_id'] = imdb_match.group(1)

    # Extract TVDB ID
    tvdb_match = re.search(r'\{tvdb-(\d+)\}', proper_show_name)
    if tvdb_match:
        show_data['tvdb_id'] = tvdb_match.group(1)

    return show_data

def map_ffprobe_to_sonarr_tokens(media_info, file_path, content_type="standard"):
    """
    Map ffprobe media info to Sonarr-compatible tokens (unified for all formats)
    
    Args:
        media_info: Media info from ffprobe
        file_path: Original file path for fallback info
        content_type: Type of content ("standard", "daily", "anime")
    
    Returns:
        Dictionary with Sonarr-compatible token mappings
    """
    sonarr_info = media_info.copy()

    if 'MediaInfo VideoCodec' in sonarr_info:
        video_codec = sonarr_info['MediaInfo VideoCodec']
        if video_codec == 'x265':
            sonarr_info['MediaInfo VideoCodec'] = 'h265'

    if 'MediaInfo Simple' in sonarr_info:
        media_simple = sonarr_info['MediaInfo Simple']
        if 'x265' in media_simple:
            sonarr_info['MediaInfo Simple'] = media_simple.replace('x265', 'h265')
    
    # Map Quality tokens
    if 'Quality Full' not in sonarr_info and 'Quality Title' in media_info:
        sonarr_info['Quality Full'] = media_info['Quality Title']
    
    # Map Release Group from filename if not in media_info
    if 'Release Group' not in sonarr_info:
        filename = os.path.basename(file_path)
        
        if content_type == "anime":
            # Anime often has release groups in brackets or at the end
            release_group_match = re.search(r'\[([^\]]+)\]', filename) or re.search(r'-([A-Za-z0-9]+)(?:\.[a-z0-9]+)?$', filename)
        else:
            # Standard/daily format
            release_group_match = re.search(r'-([A-Za-z0-9]+)(?:\.[a-z0-9]+)?$', filename)
        
        if release_group_match:
            sonarr_info['Release Group'] = release_group_match.group(1)
    
    # Extract Release Hash (common in anime releases)
    if content_type == "anime" and 'Release Hash' not in sonarr_info:
        filename = os.path.basename(file_path)
        # Look for hash patterns in filename
        hash_match = re.search(r'\[([A-F0-9]{8})\]', filename)
        if hash_match:
            sonarr_info['Release Hash'] = hash_match.group(1)
    
    # Set Original Title and Filename
    if 'Original Title' not in sonarr_info:
        # Remove extension for original title
        sonarr_info['Original Title'] = os.path.splitext(os.path.basename(file_path))[0]
    
    if 'Original Filename' not in sonarr_info:
        sonarr_info['Original Filename'] = os.path.basename(file_path)
    
    # Ensure Custom Formats is set
    if 'Custom Formats' not in sonarr_info:
        sonarr_info['Custom Formats'] = ''
    
    return sonarr_info

def parse_sonarr_conditional_tokens(result):
    """
    Parse conditional tokens (tokens in square brackets that are only included if they have values)
    
    Args:
        result: String with potential conditional tokens
    
    Returns:
        String with conditional tokens processed
    """
    # Find all conditional tokens in square brackets
    conditional_pattern = r'\[([^\[\]]*)\]'
    
    def process_conditional(match):
        content = match.group(1)
        if not content.strip() or content.strip() == '{}':
            return ''
        return f'[{content}]'
    
    # Process conditional tokens
    result = re.sub(conditional_pattern, process_conditional, result)
    
    # Clean up multiple spaces and dashes
    result = re.sub(r'\s+', ' ', result)
    result = re.sub(r'-+', '-', result)
    result = result.strip(' -')
    
    return result

def parse_sonarr_media_tokens(result, media_info):
    """
    Parse MediaInfo tokens in Sonarr format with TRaSH guide formatting (unified for all formats)

    Args:
        result: Current result string
        media_info: Media information dictionary

    Returns:
        String with MediaInfo tokens replaced
    """
    import re

    # Find all tokens in the format string
    token_pattern = r'\{([^}]+)\}'
    tokens = re.findall(token_pattern, result)

    for token in tokens:
        field_name = token.strip()
        if field_name.startswith('[') and field_name.endswith(']'):
            field_name = field_name[1:-1]
        elif field_name.startswith('-'):
            field_name = field_name[1:]

        if field_name in ['Series Title', 'Episode Title', 'season', 'episode', 'Air-Date']:
            continue

        # Handle Custom Formats
        if field_name == 'Custom Formats' and 'Custom Formats' in media_info:
            value = media_info['Custom Formats']
            quality_full = media_info.get('Quality Full', '')

            if quality_full and any(source in quality_full.upper() for source in ['WEBDL', 'WEBRIP', 'BLURAY', 'HDTV', 'REMUX']):
                result = result.replace(f'{{{token}}}', '')
            else:
                if value:
                    result = result.replace(f'{{{token}}}', value)
                else:
                    result = result.replace(f'{{{token}}}', '')

        elif field_name == 'Quality Full' and 'Quality Full' in media_info:
            value = media_info['Quality Full']
            if value:
                if '-' in value:
                    parts = value.split('-')
                    if len(parts) == 2:
                        source, resolution = parts
                        sonarr_format = f"{resolution} {source.replace('WEBDL', 'WEB-DL')}"
                        result = result.replace(f'{{{token}}}', sonarr_format)
                    else:
                        result = result.replace(f'{{{token}}}', value)
                else:
                    result = result.replace(f'{{{token}}}', value)
            else:
                result = result.replace(f'{{{token}}}', '')

        elif field_name in ['MediaInfo AudioCodec', 'Mediainfo AudioCodec'] and 'MediaInfo AudioCodec' in media_info:
            value = media_info['MediaInfo AudioCodec']
            if value:
                if value == 'EAC3' and 'MediaInfo AudioChannels' in media_info:
                    channels = media_info['MediaInfo AudioChannels'].replace('.', ' ')
                    result = result.replace(f'{{{token}}}', f"DDP{channels}")
                else:
                    result = result.replace(f'{{{token}}}', value)
            else:
                result = result.replace(f'{{{token}}}', '')

        # Handle MediaInfo AudioChannels - skip if already handled in AudioCodec
        elif field_name in ['MediaInfo AudioChannels', 'Mediainfo AudioChannels'] and 'MediaInfo AudioChannels' in media_info:
            audio_codec = media_info.get('MediaInfo AudioCodec', '')
            if audio_codec != 'EAC3':
                value = media_info['MediaInfo AudioChannels']
                if value:
                    result = result.replace(f'{{{token}}}', value.replace('.', ' '))
                else:
                    result = result.replace(f'{{{token}}}', '')
            else:
                result = result.replace(f'{{{token}}}', '')

        # Handle MediaInfo VideoCodec
        elif field_name in ['MediaInfo VideoCodec', 'Mediainfo VideoCodec'] and 'MediaInfo VideoCodec' in media_info:
            value = media_info['MediaInfo VideoCodec']
            if value:
                if value.lower() == 'x264':
                    result = result.replace(f'{{{token}}}', 'H 264')
                elif value.lower() == 'x265':
                    result = result.replace(f'{{{token}}}', 'H 265')
                else:
                    result = result.replace(f'{{{token}}}', value)
            else:
                result = result.replace(f'{{{token}}}', '')

        # Handle MediaInfo VideoDynamicRangeType
        elif field_name in ['MediaInfo VideoDynamicRangeType', 'Mediainfo VideoDynamicRangeType']:
            value = media_info.get('MediaInfo VideoDynamicRangeType', '')
            if value:
                result = result.replace(f'{{{token}}}', value)
            else:
                result = result.replace(f'{{{token}}}', '')

        # Handle Release Group
        elif field_name == 'Release Group' and 'Release Group' in media_info:
            value = media_info['Release Group']
            if value:
                result = result.replace(f'{{{token}}}', f"-{value}")
            else:
                result = result.replace(f'{{{token}}}', '')

        # Handle other MediaInfo fields
        elif field_name in media_info:
            value = media_info[field_name]
            if value:
                if isinstance(value, list):
                    formatted_value = '+'.join([str(item).upper() for item in value])
                    result = result.replace(f'{{{token}}}', formatted_value)
                else:
                    result = result.replace(f'{{{token}}}', str(value))
            else:
                result = result.replace(f'{{{token}}}', '')

    return result

def parse_series_tokens(result, show_data):
    """
    Parse Series tokens in Sonarr format (unified for all formats)

    Args:
        result: Current result string
        show_data: Dictionary containing show information

    Returns:
        String with Series tokens replaced
    """
    # Series tokens
    series_title = show_data.get('series_title', '')
    series_year = show_data.get('series_year', '')
    series_title_year = f"{series_title} ({series_year})" if series_year else series_title

    # Clean versions (remove special characters for file system compatibility)
    series_clean_title = clean_title_for_filename(series_title)
    series_clean_title_year = f"{series_clean_title} ({series_year})" if series_year else series_clean_title

    # Replace Series tokens
    # Space notation (Sonarr standard)
    result = result.replace('{Series Title}', series_title)
    result = result.replace('{Series TitleYear}', series_title_year)
    result = result.replace('{Series CleanTitle}', series_clean_title)
    result = result.replace('{Series CleanTitleYear}', series_clean_title_year)
    result = result.replace('{Series TitleWithoutYear}', series_title)
    result = result.replace('{Series CleanTitleWithoutYear}', series_clean_title)
    result = result.replace('{Series TitleThe}', move_article_to_end(series_title))
    result = result.replace('{Series CleanTitleThe}', move_article_to_end(series_clean_title))
    result = result.replace('{Series TitleTheYear}', f"{move_article_to_end(series_title)} ({series_year})" if series_year else move_article_to_end(series_title))
    result = result.replace('{Series CleanTitleTheYear}', f"{move_article_to_end(series_clean_title)} ({series_year})" if series_year else move_article_to_end(series_clean_title))
    result = result.replace('{Series TitleFirstCharacter}', series_title[0] if series_title else '')
    result = result.replace('{Series Year}', series_year)

    # Dot notation (alternative format)
    result = result.replace('{Series.Title}', series_title)
    result = result.replace('{Series.TitleYear}', series_title_year)
    result = result.replace('{Series.CleanTitle}', series_clean_title)
    result = result.replace('{Series.CleanTitleYear}', series_clean_title_year)
    result = result.replace('{Series.TitleWithoutYear}', series_title)
    result = result.replace('{Series.CleanTitleWithoutYear}', series_clean_title)
    result = result.replace('{Series.TitleThe}', move_article_to_end(series_title))
    result = result.replace('{Series.CleanTitleThe}', move_article_to_end(series_clean_title))
    result = result.replace('{Series.TitleTheYear}', f"{move_article_to_end(series_title)} ({series_year})" if series_year else move_article_to_end(series_title))
    result = result.replace('{Series.CleanTitleTheYear}', f"{move_article_to_end(series_clean_title)} ({series_year})" if series_year else move_article_to_end(series_clean_title))
    result = result.replace('{Series.TitleFirstCharacter}', series_title[0] if series_title else '')
    result = result.replace('{Series.Year}', series_year)

    # Series ID tokens
    imdb_id = show_data.get('imdb_id', '')
    tmdb_id = str(show_data.get('tmdb_id', ''))
    tvdb_id = str(show_data.get('tvdb_id', ''))

    # Replace ID tokens (with proper formatting)
    result = result.replace('{ImdbId}', f'[{imdb_id}]' if imdb_id else '')
    result = result.replace('{TmdbId}', f'[tmdb-{tmdb_id}]' if tmdb_id else '')
    result = result.replace('{TvdbId}', f'[tvdb-{tvdb_id}]' if tvdb_id else '')

    # Also support simple ID tokens without brackets
    result = result.replace('{ImdbId-Simple}', imdb_id)
    result = result.replace('{TmdbId-Simple}', tmdb_id)
    result = result.replace('{TvdbId-Simple}', tvdb_id)

    return result

class BaseSonarrTokenParser:
    """
    Base class for Sonarr token parsing with common functionality
    """

    def __init__(self):
        pass

    def parse_episode_title_tokens(self, result, episode_data):
        """
        Parse Episode Title tokens with truncation support

        Args:
            result: Current result string
            episode_data: Dictionary containing episode information

        Returns:
            String with Episode Title tokens replaced
        """
        episode_title = episode_data.get('episode_title', '')
        episode_clean_title = clean_title_for_filename(episode_title)

        # Handle episode title truncation
        episode_title_match = re.search(r'\{Episode Title:(\d+)\}', result)
        if episode_title_match:
            max_length = int(episode_title_match.group(1))
            truncated_title = episode_title[:max_length] if len(episode_title) > max_length else episode_title
            result = result.replace(episode_title_match.group(0), truncated_title)

        episode_clean_title_match = re.search(r'\{Episode CleanTitle:(\d+)\}', result)
        if episode_clean_title_match:
            max_length = int(episode_clean_title_match.group(1))
            truncated_clean_title = episode_clean_title[:max_length] if len(episode_clean_title) > max_length else episode_clean_title
            result = result.replace(episode_clean_title_match.group(0), truncated_clean_title)

        # Space notation (Sonarr standard)
        result = result.replace('{Episode Title}', episode_title)
        result = result.replace('{Episode CleanTitle}', episode_clean_title)

        # Dot notation (alternative format)
        result = result.replace('{Episode.Title}', episode_title)
        result = result.replace('{Episode.CleanTitle}', episode_clean_title)

        return result

    def parse_quality_tokens(self, result, media_info):
        """
        Parse Quality tokens

        Args:
            result: Current result string
            media_info: Media information dictionary

        Returns:
            String with Quality tokens replaced
        """
        quality_full = media_info.get('Quality Full', '')
        quality_title = media_info.get('Quality Title', '')

        # Space notation (Sonarr standard)
        result = result.replace('{Quality Full}', quality_full)
        result = result.replace('{Quality Title}', quality_title)

        # Dot notation (alternative format)
        result = result.replace('{Quality.Full}', quality_full)
        result = result.replace('{Quality.Title}', quality_title)

        return result

    def parse_air_date_tokens(self, result, episode_data):
        """
        Parse Air Date tokens

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
                result = result.replace('{Air-Date}', '')
                result = result.replace('{Air Date}', '')
        else:
            result = result.replace('{Air-Date}', '')
            result = result.replace('{Air Date}', '')

        return result

    def parse_season_episode_tokens(self, result, episode_data):
        """
        Parse Season and Episode tokens with padding support

        Args:
            result: Current result string
            episode_data: Dictionary containing episode information

        Returns:
            String with Season/Episode tokens replaced
        """
        season_num = episode_data.get('season_number', 1)
        episode_num = episode_data.get('episode_number', 1)

        # Handle season formatting with padding (including 00 format)
        season_match = re.search(r'\{season:(0+)\}', result)  # Match {season:00} format
        if season_match:
            padding = len(season_match.group(1))  # Count the zeros for padding
            formatted_season = str(season_num).zfill(padding)
            result = result.replace(season_match.group(0), formatted_season)
        else:
            # Try numeric padding format like {season:2}
            season_match_num = re.search(r'\{season:(\d+)\}', result)
            if season_match_num:
                padding = int(season_match_num.group(1))
                formatted_season = str(season_num).zfill(padding)
                result = result.replace(season_match_num.group(0), formatted_season)
            else:
                result = result.replace('{season}', str(season_num))

        # Handle episode formatting with padding (including 00 format)
        episode_match = re.search(r'\{episode:(0+)\}', result)  # Match {episode:00} format
        if episode_match:
            padding = len(episode_match.group(1))  # Count the zeros for padding
            formatted_episode = str(episode_num).zfill(padding)
            result = result.replace(episode_match.group(0), formatted_episode)
        else:
            # Try numeric padding format like {episode:2}
            episode_match_num = re.search(r'\{episode:(\d+)\}', result)
            if episode_match_num:
                padding = int(episode_match_num.group(1))
                formatted_episode = str(episode_num).zfill(padding)
                result = result.replace(episode_match_num.group(0), formatted_episode)
            else:
                result = result.replace('{episode}', str(episode_num))

        return result