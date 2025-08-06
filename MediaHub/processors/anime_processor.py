import os
import re
import requests
from MediaHub.utils.logging_utils import log_message
from MediaHub.utils.file_utils import fetch_json, extract_resolution_from_filename, extract_resolution_from_folder, is_anime_file

from MediaHub.api.tmdb_api import search_tv_show, determine_tmdb_media_type
from MediaHub.config.config import *
from MediaHub.utils.mediainfo import *
from MediaHub.api.tmdb_api_helpers import get_episode_name
from MediaHub.processors.db_utils import track_file_failure
from MediaHub.utils.file_utils import clean_query

def is_anime_file_legacy(filename):
    """
    Legacy anime detection function - kept for backward compatibility.

    The main is_anime_file function is now imported from file_utils.py
    which uses the new intelligent pattern-based detection.
    """
    return is_anime_file(filename)

def extract_anime_episode_info(filename, file_metadata=None):
    """
    Extract anime-specific episode information using the enhanced clean_query.
    Returns a dictionary with show_name, season_number, episode_number, and episode_title.

    Args:
        filename: The filename to parse
        file_metadata: Optional pre-parsed metadata to avoid redundant parsing
    """

    # Use passed metadata if available, otherwise parse
    if file_metadata:
        anime_result = file_metadata
    else:
        anime_result = clean_query(filename)

    show_name = anime_result.get('title', '')
    episode_identifier = anime_result.get('episode_identifier')

    if not episode_identifier and not show_name:
        return _extract_anime_fallback(filename)

    # Extract season and episode numbers
    season_number = anime_result.get('season_number')
    episode_number = anime_result.get('episode_number')

    if not episode_number and episode_identifier:
        match = re.search(r'S(\d+)E(\d+)', episode_identifier, re.IGNORECASE)
        if match:
            season_number = match.group(1)
            episode_number = match.group(2)

    # Convert to the expected format
    result = {
        'show_name': show_name,
        'season_number': season_number,
        'episode_number': episode_number,
        'episode_title': None,
        'is_extra': anime_result.get('is_extra', False)
    }

    # Clean up show name if available
    if result['show_name']:
        result['show_name'] = re.sub(r'[._-]', ' ', result['show_name']).strip()

    print(f"DEBUG: Anime extraction result: {result}")
    log_message(f"Anime episode info extracted: {result['show_name']} S{result['season_number']}E{result['episode_number']}", level="DEBUG")
    return result


def _extract_anime_fallback(filename):
    """
    Fallback extraction for anime-specific edge cases not handled by the main parser.
    """
    clean_filename = filename
    clean_filename = re.sub(r'^\[(.*?)\]', '', clean_filename)
    clean_filename = re.sub(r'\[[A-F0-9]{8}\](?:\.[^.]+)?$', '', clean_filename)
    clean_filename = re.sub(r'\[.*?\]', '', clean_filename)
    clean_filename = re.sub(r'\(.*?\)', '', clean_filename)
    clean_filename = os.path.splitext(clean_filename)[0]
    clean_filename = re.sub(r'\s+', ' ', clean_filename).strip()

    # Check for special anime pattern S##S## (Season + Special)
    special_pattern = r'^(.+?)\s*-\s*S(\d+)S(\d+)(?:\s|$)'
    match = re.match(special_pattern, clean_filename, re.IGNORECASE)
    if match:
        show_name = match.group(1).strip()
        season_number = str(int(match.group(2))).zfill(2)
        special_number = str(int(match.group(3))).zfill(2)

        show_name = re.sub(r'[._-]', ' ', show_name).strip()
        log_message(f"Identified Special Episode for show: {show_name}, Season: {season_number}, Special: {special_number}.", level="DEBUG")
        return {
            'show_name': show_name,
            'season_number': season_number,
            'episode_number': special_number,
            'episode_title': None,
            'is_extra': True,
        }

    # Try basic anime patterns as fallback
    basic_anime_patterns = [
        r'^(.+?)\s*-\s*(\d+)\s*(?:-\s*(.+))?$',
        r'^(.+?)\s+(\d{1,3})(?:\s|$)',
    ]

    for pattern in basic_anime_patterns:
        match = re.match(pattern, clean_filename, re.IGNORECASE)
        if match:
            show_name = match.group(1).strip()
            episode_number = str(int(match.group(2))).zfill(2)
            episode_title = match.group(3) if len(match.groups()) > 2 else None

            show_name = re.sub(r'[._-]', ' ', show_name).strip()

            return {
                'show_name': show_name,
                'season_number': "01",
                'episode_number': episode_number,
                'episode_title': episode_title,
                'is_extra': False
            }

    return None

def process_anime_show(src_file, root, file, dest_dir, actual_dir, tmdb_folder_id_enabled, rename_enabled, tmdb_id, tvdb_id, imdb_id, auto_select, season_number, episode_number, file_metadata=None, manual_search=False):
    anime_info = extract_anime_episode_info(file, file_metadata)
    if not anime_info:
        track_file_failure(src_file, None, None, "Anime info extraction failed", f"Unable to extract anime episode info from: {file}")
        return None

    # Prepare variables from enhanced extraction
    show_name = anime_info['show_name']
    season_number = season_number or anime_info['season_number']
    episode_number = episode_number or anime_info['episode_number']
    episode_title = anime_info['episode_title']
    is_extra = anime_info.get('is_extra', False)

    # Extract language and quality from file_metadata
    language = None
    quality = None

    if file_metadata:
        # Extract language information
        languages = file_metadata.get('languages', [])
        language = ', '.join(languages) if isinstance(languages, list) and languages else None

        # Extract quality information (resolution + source)
        resolution_info = file_metadata.get('resolution', '')
        quality_source = file_metadata.get('quality_source', '')
        quality_parts = [part for part in [resolution_info, quality_source] if part]
        quality = ' '.join(quality_parts) if quality_parts else None

    log_message(f"Processing anime: {show_name} S{season_number}E{episode_number}", level="DEBUG")

    # Extract resolution from filename and parent folder
    file_resolution = extract_resolution_from_filename(file)
    folder_resolution = extract_resolution_from_folder(os.path.basename(root))
    resolution = file_resolution or folder_resolution
    media_info = {}
    resolution = resolution.lower() if resolution is not None else None

    # Check for media info
    root_folder_name = os.path.basename(os.path.dirname(root))
    if root_folder_name:
        root_media_info = extract_media_info(root_folder_name, keywords)
        media_info.update(root_media_info)

    if actual_dir:
        actual_dir_media_info = extract_media_info(actual_dir, keywords)
        media_info.update(actual_dir_media_info)

    file_media_info = extract_media_info(file, keywords)
    media_info.update(file_media_info)

    # Clean up show name
    show_name = re.sub(r'[._]', ' ', show_name).strip()

    # Fetch proper show name and ID from TMDb
    year = None
    proper_show_name = show_name
    original_show_name = show_name
    show_id = None
    is_anime_genre = False
    imdb_id = None
    tvdb_id = None

    # Retry logic for anime show name extraction
    max_retries = 2
    retry_count = 0
    search_result = None



    while retry_count < max_retries and search_result is None:
        retry_count += 1
        log_message(f"TMDb anime search attempt {retry_count}/{max_retries} for: {show_name} ({year})", level="DEBUG")

        search_result = search_tv_show(show_name, auto_select=auto_select, season_number=season_number, episode_number=episode_number, tmdb_id=tmdb_id, imdb_id=imdb_id, tvdb_id=tvdb_id, is_extra=is_extra, file=file, manual_search=manual_search)

        if search_result is None and retry_count < max_retries:
            import time
            wait_time = 2
            log_message(f"TMDb anime search failed, retrying in {wait_time} seconds...", level="WARNING")
            time.sleep(wait_time)

    # Check final result after all retries
    if search_result is None or isinstance(search_result, str):
        log_message(f"TMDB search failed for anime show: {show_name} ({year}). Skipping anime show processing.", level="ERROR")
        track_file_failure(src_file, None, None, "TMDB search failed", f"No TMDB results found for anime show: {show_name} ({year})")
        return None
    elif isinstance(search_result, tuple) and len(search_result) >= 7:
        if len(search_result) >= 9:
            # New format with external IDs
            proper_show_name, original_show_name, is_anime_genre, season_number, episode_number, tmdb_id, is_kids_content, imdb_id, tvdb_id = search_result
        else:
            # Legacy format without external IDs
            proper_show_name, original_show_name, is_anime_genre, season_number, episode_number, tmdb_id, is_kids_content = search_result
            imdb_id = None
            tvdb_id = None
    else:
        log_message(f"TMDB search returned unexpected result type for anime show: {show_name} ({year}). Skipping anime show processing.", level="ERROR")
        track_file_failure(src_file, None, None, "TMDB search failed", f"Unexpected TMDB result type for anime show: {show_name} ({year})")
        return None

    if not proper_show_name or proper_show_name.strip() == "" or "TMDb API error" in str(proper_show_name):
        log_message(f"TMDb could not provide valid show name for anime: {show_name} ({year}). Skipping anime show processing.", level="ERROR")
        track_file_failure(src_file, None, None, "TMDb invalid show name", f"TMDb could not provide valid show name for anime: {show_name} ({year})")
        return None

    tmdb_id_match = re.search(r'\{tmdb-(\d+)\}$', proper_show_name)
    if tmdb_id_match:
        show_id = tmdb_id_match.group(1)

    show_name = proper_show_name

    if not is_imdb_folder_id_enabled():
        show_name = re.sub(r' \{imdb-[^}]+\}', '', show_name)
    if not is_tvdb_folder_id_enabled():
        show_name = re.sub(r' \{tvdb-[^}]+\}', '', show_name)
    if not is_tmdb_folder_id_enabled():
        show_name = re.sub(r' \{tmdb-[^}]+\}', '', show_name)

    new_name = file
    episode_name = None
    mapped_season = season_number
    mapped_episode = episode_number

    # Parse the original filename to get the correct episode number
    original_episode_match = re.search(r'S(\d{2})E(\d{2,3})', file)
    if original_episode_match:
        season_number = original_episode_match.group(1)
        actual_episode = original_episode_match.group(2)
    else:
        original_episode_match = re.search(r'(\d+)x(\d+)', file)
        if original_episode_match:
            season_number = str(int(original_episode_match.group(1))).zfill(2)
            actual_episode = original_episode_match.group(2)
        else:
            actual_episode = episode_number

    if rename_enabled and show_id:
        try:
            try:
                # Get the episode name and the mapped season/episode numbers
                episode_result = get_episode_name(show_id, int(season_number), int(actual_episode))

                if isinstance(episode_result, tuple) and len(episode_result) == 3:
                    episode_name, mapped_season, mapped_episode = episode_result
                    # Update season_number with the mapped season number
                    if mapped_season is not None:
                        season_number = str(mapped_season).zfill(2)
                    # Update actual_episode with the mapped episode number
                    if mapped_episode is not None:
                        actual_episode = str(mapped_episode).zfill(2)
                else:
                    episode_name = episode_result

                if episode_name and episode_name != episode_title:
                    new_name += f" - {episode_name}"
                elif episode_title:
                    new_name += f" - {episode_title}"
            except Exception as e:
                log_message(f"Failed to fetch episode name: {e}", level="WARNING")

            episode_name = episode_name or episode_title or ""

            new_name = f"{original_show_name}"
            if episode_name:
                new_name += f" - {episode_name}"
            if resolution:
                new_name += f" [{resolution}]"

            # Add media info tags with separate brackets
            media_tags = []

            if media_info.get('VideoCodec'):
                codec = media_info['VideoCodec']
                if '10bit' in actual_dir or '10bit' in file:
                    media_tags.append(f"[{codec} 10bit]")
                else:
                    media_tags.append(f"[{codec}]")
            if media_info.get('AudioCodec'):
                audio_tag = media_info['AudioCodec']
                if media_info.get('AudioChannels'):
                    audio_tag += f" {media_info['AudioChannels']}"
                if media_info.get('AudioAtmos'):
                    audio_tag += f" {media_info['AudioAtmos']}"
                media_tags.append(f"[{audio_tag}]")
            if media_info.get('DynamicRange'):
                media_tags.append(f"[{media_info['DynamicRange']}]")
            if media_info.get('Languages'):
                if 'ENG' in media_info['Languages'] and len(media_info['Languages']) > 1:
                    media_tags.append("[Dual Audio]")

            if media_tags:
                new_name += f" {''.join(media_tags)}"

            new_name += os.path.splitext(file)[1]

        except Exception as e:
            log_message(f"Error processing anime filename: {e}", level="ERROR")
            new_name = file

    # Get TMDB language as fallback if not available from file metadata
    if not language and tmdb_id:
        from MediaHub.api.tmdb_api_helpers import get_show_data
        show_data = get_show_data(tmdb_id)
        if show_data:
            language = show_data.get('original_language')

    # Return necessary information
    return {
        'show_name': show_name,
        'season_number': season_number,
        'new_name': new_name,
        'year': year,
        'is_anime': True,
        'show_id': show_id,
        'episode_title': episode_name or episode_title,
        'episode_number': actual_episode,
        'resolution': resolution,
        'media_info': media_info,
        'is_anime_genre': is_anime_genre,
        'is_extra': is_extra,
        'tmdb_id': tmdb_id,
        'imdb_id': imdb_id,
        'tvdb_id': tvdb_id,
        'language': language,
        'quality': quality
    }
