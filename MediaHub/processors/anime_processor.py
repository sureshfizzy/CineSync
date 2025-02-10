import os
import re
import requests
from MediaHub.utils.logging_utils import log_message
from MediaHub.utils.file_utils import fetch_json, extract_resolution, extract_resolution_from_folder, get_anime_patterns
from MediaHub.api.tmdb_api import search_tv_show
from MediaHub.config.config import *
from MediaHub.utils.mediainfo import *
from MediaHub.api.tmdb_api_helpers import get_episode_name

def is_anime_file(filename):
    """
    Detect if the file is likely an anime file based on naming patterns
    """
    anime_pattern = get_anime_patterns()
    return bool(anime_pattern.search(filename))

def extract_anime_episode_info(filename):
    """
    Extract anime-specific episode information from the provided filename.
    Returns a dictionary with show_name, season_number, episode_number, and episode_title.
    """

    clean_filename = filename
    clean_filename = re.sub(r'^\[(.*?)\]', '', clean_filename)
    clean_filename = re.sub(r'\[[A-F0-9]{8}\](?:\.[^.]+)?$', '', clean_filename)
    clean_filename = re.sub(r'\[.*?\]', '', clean_filename)
    clean_filename = re.sub(r'\(.*?\)', '', clean_filename)
    clean_filename = os.path.splitext(clean_filename)[0]
    clean_filename = re.sub(r'\s+', ' ', clean_filename).strip()

    season_detection_patterns = [
        r'^(.+?)\s*S(\d+)\s*-\s*(\d+)$',
        r'^(.+?)\s*Season\s*(\d+)[-_\s]*(?:-\s*)?(\d+)(?:\s|$)'
    ]

    for pattern in season_detection_patterns:
        match = re.match(pattern, clean_filename, re.IGNORECASE)
        if match:
            show_name = match.group(1).strip()
            season_number = str(int(match.group(2))).zfill(2)
            episode_number = str(int(match.group(3))).zfill(2)

            show_name = re.sub(r'[._-]', ' ', show_name).strip()
            return {
                'show_name': show_name,
                'season_number': season_number,
                'episode_number': episode_number,
                'episode_title': None
            }

    ordinal_season_patterns = [
        r'^(.+?)\s+(\d+)(?:st|nd|rd|th)\s+Season[-_\s]*(?:-\s*)?(\d+)(?:\s|$)',
        r'^(.+?)\s+(\d+)(?:st|nd|rd|th)\s+Season.*?[-_](\d+)(?:\s|$)',
        r'^(.+?)\s*S(\d+)\s*(\d+)(?:\s|$)'
    ]

    for pattern in ordinal_season_patterns:
        match = re.match(pattern, clean_filename, re.IGNORECASE)
        if match:
            show_name = match.group(1).strip()
            season_number = str(int(match.group(2))).zfill(2)
            episode_number = str(int(match.group(3))).zfill(2)

            if len(episode_number) <= 3:
                return {
                    'show_name': show_name,
                    'season_number': season_number,
                    'episode_number': episode_number,
                    'episode_title': None
                }

    # Add new pattern for simple show name + episode number format
    simple_episode_patterns = [
        r'^(.+?)\s+(\d{1,3})(?:\s|$)',
        r'^(.+?)\s*-\s*(\d{1,3})(?:\s|$)',
        r'^(.+?)\s*EP?\.?\s*(\d{1,3})(?:\s|$)',
    ]

    for pattern in simple_episode_patterns:
        match = re.match(pattern, clean_filename, re.IGNORECASE)
        if match:
            show_name = match.group(1).strip()
            episode_number = str(int(match.group(2))).zfill(2)

            show_name = re.sub(r'[._-]', ' ', show_name).strip()
            return {
                'show_name': show_name,
                'season_number': '01',
                'episode_number': episode_number,
                'episode_title': None
            }

    anime_patterns = [
        r'^(.+?)\s*S(\d+)\s*-\s*.*?-\s*(\d+)$',
        r'^(.+?)\s*-\s*(\d+)\s*(?:-\s*(.+))?$',
        r'^(.+?)\s*S(\d{2})E(\d+)\s*(?:-\s*(.+))?$',
        r'^(.+?)\s*(\d+)x(\d+)\s*(?:-\s*(.+))?$',
        r'^(.+?)\s*(?:[Ee]p\.?\s*(\d+)|[Ee]pisode\s*(\d+))\s*(?:-\s*(.+))?$',
        r'^(.+?)\s*\[(\d+)\]\s*(?:-\s*(.+))?$',
    ]

    for pattern_index, pattern in enumerate(anime_patterns, 1):
        match = re.match(pattern, clean_filename, re.IGNORECASE)
        if match:
            if pattern_index == 1:
                show_name = match.group(1).strip()
                season_number = match.group(2).zfill(2)
                episode_number = match.group(3).zfill(2)
                episode_title = None
            elif pattern_index == 2:
                show_name = match.group(1).strip()
                season_number = None
                episode_number = match.group(2).zfill(2)
                episode_title = match.group(3)
            elif pattern_index == 3:
                show_name = match.group(1).strip()
                season_number = match.group(2).zfill(2)
                episode_number = match.group(3).zfill(2)
                episode_title = match.group(4)
            else:
                show_name = match.group(1).strip()
                season_number = None
                episode_number = match.group(2).zfill(2)
                episode_title = match.group(3) if len(match.groups()) > 2 else None

            show_name = re.sub(r'[._-]', ' ', show_name).strip()

            return {
                'show_name': show_name,
                'episode_number': episode_number,
                'season_number': season_number,
                'episode_title': episode_title
            }

    return None

def process_anime_show(src_file, root, file, dest_dir, actual_dir, tmdb_folder_id_enabled, rename_enabled, auto_select):
    anime_info = extract_anime_episode_info(file)
    if not anime_info:
        return None

    # Prepare variables
    show_name = anime_info['show_name']
    episode_number = anime_info['episode_number']
    season_number = anime_info['season_number']
    episode_title = anime_info['episode_title']

    # Extract resolution from filename and parent folder
    file_resolution = extract_resolution(file)
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
    api_key = get_api_key()
    year = None
    proper_show_name = show_name
    original_show_name = show_name
    show_id = None
    is_anime_genre = False

    if api_key and not offline_mode:
        search_result = search_tv_show(show_name, auto_select=auto_select)
        if isinstance(search_result, tuple):
            proper_show_name, original_show_name, is_anime_genre = search_result
        else:
            proper_show_name = original_show_name = search_result

        tmdb_id_match = re.search(r'\{tmdb-(\d+)\}$', proper_show_name)
        if tmdb_id_match:
            show_id = tmdb_id_match.group(1)

    if is_tmdb_folder_id_enabled():
        show_name = proper_show_name
    elif is_imdb_folder_id_enabled():
        show_name = re.sub(r' \{tmdb-.*?\}$', '', proper_show_name)
    else:
        show_name = re.sub(r' \{(?:tmdb|imdb)-.*?\}$', '', proper_show_name)

    if not season_number and show_id and api_key:
        try:
            seasons_url = f"https://api.themoviedb.org/3/tv/{show_id}?api_key={api_key}"
            show_data = fetch_json(seasons_url)
            seasons = show_data.get('seasons', [])

            for season in seasons:
                season_number = season.get('season_number')
                episodes_url = f"https://api.themoviedb.org/3/tv/{show_id}/season/{season_number}?api_key={api_key}"
                episodes_data = fetch_json(episodes_url)
                episodes = episodes_data.get('episodes', [])

                for episode in episodes:
                    if int(episode['episode_number']) == int(episode_number):
                        break
                else:
                    continue
                break
        except Exception as e:
            log_message(f"Error fetching season/episode data from TMDb: {e}", level="ERROR")

    if not season_number:
        season_number = "01"

    if show_id and api_key:
        try:
            show_details_url = f"https://api.themoviedb.org/3/tv/{show_id}?api_key={api_key}"
            show_details = fetch_json(show_details_url)
            first_air_date = show_details.get('first_air_date', '')
            if first_air_date:
                year = first_air_date.split('-')[0]
        except Exception as e:
            log_message(f"Error fetching show year from TMDb: {e}", level="ERROR")

    new_name = file
    episode_name = None

    # Parse the original filename to get the correct episode number
    original_episode_match = re.search(r'S(\d{2})E(\d{2})', file)
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
                episode_name = get_episode_name(show_id, int(season_number), int(actual_episode))
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
        'is_anime_genre': is_anime_genre
    }
