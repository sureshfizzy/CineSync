import os
import re
import requests
from utils.logging_utils import log_message
from utils.file_utils import fetch_json
from api.tmdb_api import search_tv_show, get_episode_name
from config.config import *

def is_anime_file(filename):
    """
    Detect if the file is likely an anime file based on naming patterns
    """
    anime_patterns = [
        r'\[.+?\]',
        r'\s-\s\d+\s',
        r'(?:(?:Season|S)\s*\d+\s*Episode|Ep\.?\s*\d+)',
        r'\.(mkv|mp4)$'
    ]

    return any(re.search(pattern, filename, re.IGNORECASE) for pattern in anime_patterns)


def extract_anime_episode_info(filename):
    """
    Extract anime-specific episode information from the provided filename.
    """

    clean_filename = re.sub(r'^\[.*?\]\s*', '', filename)
    clean_filename = re.sub(r'\[.*?\]', '', clean_filename)
    clean_filename = re.sub(r'\(.*?\)', '', clean_filename)
    clean_filename = os.path.splitext(clean_filename)[0]
    clean_filename = re.sub(r'\[.*?\]', '', clean_filename)
    clean_filename = re.sub(r'\s+', ' ', clean_filename).strip()

    # Patterns for anime episode extraction
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
                episode_number = match.group(3)
                episode_title = None

            elif pattern_index == 2:
                show_name = match.group(1).strip()
                season_number = None
                episode_number = match.group(2)
                episode_title = match.group(3)

            elif pattern_index == 3:
                show_name = match.group(1).strip()
                season_number = match.group(2).zfill(2)
                episode_number = match.group(3)
                episode_title = match.group(4)

            else:
                show_name = match.group(1).strip()
                season_number = None
                episode_number = match.group(2)
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

    # Clean up show name
    show_name = re.sub(r'[._]', ' ', show_name).strip()

    # Fetch proper show name and ID from TMDb
    api_key = get_api_key()
    year = None
    proper_show_name = show_name
    show_id = None

    if api_key and not offline_mode:
        proper_show_name = search_tv_show(show_name, auto_select=auto_select)
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
    if rename_enabled and show_id:
        try:
            try:
                episode_name = get_episode_name(show_id, int(season_number), int(episode_number))
            except Exception as e:
                log_message(f"Failed to fetch episode name: {e}", level="WARNING")

            episode_name = episode_name or episode_title or ""

            new_name = f"{show_name} - S{str(season_number).zfill(2)}E{str(episode_number).zfill(3)}"
            if episode_name:
                new_name += f" - {episode_name}"
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
        'episode_number': episode_number
    }
