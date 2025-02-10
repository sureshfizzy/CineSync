import os
import re
import requests
import urllib.parse
import logging
import unicodedata
from bs4 import BeautifulSoup
from functools import lru_cache
from MediaHub.utils.logging_utils import log_message
from MediaHub.config.config import get_api_key, is_imdb_folder_id_enabled, is_tvdb_folder_id_enabled, is_tmdb_folder_id_enabled
from MediaHub.utils.file_utils import clean_query, normalize_query, standardize_title, remove_genre_names, extract_title, clean_query_movie, advanced_clean_query

_api_cache = {}

# Global variables for API key status and warnings
api_key = get_api_key()
api_warning_logged = False

# Disable urllib3 debug logging
logging.getLogger("urllib3").setLevel(logging.WARNING)

def check_api_key():
    global api_key, api_warning_logged
    if not api_key:
        return False
    url = "https://api.themoviedb.org/3/configuration"
    params = {'api_key': api_key}
    try:
        response = requests.get(url, params=params)
        response.raise_for_status()
        return True
    except requests.exceptions.RequestException as e:
        if not api_warning_logged:
            log_message(f"API key validation failed: {e}", level="ERROR")
            api_warning_logged = True
        return False

def get_external_ids(item_id, media_type):
    url = f"https://api.themoviedb.org/3/{media_type}/{item_id}/external_ids"
    params = {'api_key': api_key}

    try:
        response = requests.get(url, params=params)
        response.raise_for_status()
        return response.json()
    except requests.exceptions.RequestException as e:
        log_message(f"Error fetching external IDs: {e}", level="ERROR")
        return {}

def get_movie_genres(movie_id):
    """
    Fetch genre information and other metadata for a movie from TMDb API.
    Parameters:
    movie_id (int): TMDb movie ID
    Returns:
    dict: Dictionary containing genres, language, and anime status
    """
    api_key = get_api_key()
    if not api_key:
        log_message("TMDb API key not found.", level="ERROR")
        return None

    url = f"https://api.themoviedb.org/3/movie/{movie_id}"
    params = {'api_key': api_key}

    try:
        response = requests.get(url, params=params)
        response.raise_for_status()
        movie_details = response.json()

        genres = [genre['name'] for genre in movie_details.get('genres', [])]
        language = movie_details.get('original_language', '')

        keywords_url = f"https://api.themoviedb.org/3/movie/{movie_id}/keywords"
        keywords_response = requests.get(keywords_url, params=params)
        keywords_response.raise_for_status()
        keywords = [kw['name'].lower() for kw in keywords_response.json().get('keywords', [])]

        is_anime = any([
            'anime' in movie_details.get('title', '').lower(),
            'animation' in genres and language == 'ja',
            'anime' in keywords,
            'japanese animation' in keywords
        ])

        return {
            'genres': genres,
            'language': language,
            'is_anime_genre': is_anime
        }

    except requests.exceptions.RequestException as e:
        log_message(f"Error fetching movie genres: {e}", level="ERROR")
        return None

def get_show_genres(show_id):
    """
    Fetch genre information and other metadata for a TV show from TMDb API.
    Parameters:
    show_id (int): TMDb show ID
    Returns:
    dict: Dictionary containing genres, language, and anime status
    """
    api_key = get_api_key()
    if not api_key:
        log_message("TMDb API key not found.", level="ERROR")
        return None

    url = f"https://api.themoviedb.org/3/tv/{show_id}"
    params = {'api_key': api_key}

    try:
        # Get show details including genres
        response = requests.get(url, params=params)
        response.raise_for_status()
        show_details = response.json()

        genres = [genre['name'] for genre in show_details.get('genres', [])]
        language = show_details.get('original_language', '')

        # Get keywords for the show
        keywords_url = f"https://api.themoviedb.org/3/tv/{show_id}/keywords"
        keywords_response = requests.get(keywords_url, params=params)
        keywords_response.raise_for_status()
        keywords = [kw['name'].lower() for kw in keywords_response.json().get('results', [])]

        # Check if it's an anime based on multiple criteria
        is_anime = any([
            'anime' in show_details.get('name', '').lower(),
            'animation' in genres and language == 'ja',
            'anime' in keywords,
            'japanese animation' in keywords,
            any('anime' in keyword for keyword in keywords)
        ])

        return {
            'genres': genres,
            'language': language,
            'is_anime_genre': is_anime
        }

    except requests.exceptions.RequestException as e:
        log_message(f"Error fetching TV show genres: {e}", level="ERROR")
        return None

def get_episode_name(show_id, season_number, episode_number):
    """
    Fetch the episode name from TMDb API for the given show, season, and episode number.
    Fallback to map absolute episode numbers if an invalid episode is specified.
    """
    api_key = get_api_key()
    if not api_key:
        log_message("TMDb API key not found in environment variables.", level="ERROR")
        return None

    try:
        url = f"https://api.themoviedb.org/3/tv/{show_id}/season/{season_number}/episode/{episode_number}"
        params = {'api_key': api_key}
        response = requests.get(url, params=params)
        response.raise_for_status()
        episode_data = response.json()
        episode_name = episode_data.get('name')
        return f"S{season_number:02d}E{episode_number:02d} - {episode_name}"

    except requests.exceptions.HTTPError as e:
        if response.status_code == 404:
            log_message(f"Episode {episode_number} not found for season {season_number}. Falling back to season data.", level="DEBUG")
            season_url = f"https://api.themoviedb.org/3/tv/{show_id}/season/{season_number}"
            season_params = {'api_key': api_key}
            try:
                season_response = requests.get(season_url, params=season_params)
                season_response.raise_for_status()
                season_details = season_response.json()
                episodes = season_details.get('episodes', [])
                total_season_episodes = len(episodes)

                if total_season_episodes == 0:
                    log_message("No episodes found for the specified season. Ensure the season number is correct.", level="ERROR")
                    return None

                if int(episode_number) > total_season_episodes:
                    mapped_episode_number = str((int(episode_number) % total_season_episodes) or total_season_episodes).zfill(2)
                    log_message(
                        f"Absolute episode {episode_number} exceeds total episodes ({total_season_episodes}) "
                        f"for season {season_number}. Mapped to episode {mapped_episode_number}.",
                        level="DEBUG"
                    )
                    mapped_url = f"https://api.themoviedb.org/3/tv/{show_id}/season/{season_number}/episode/{mapped_episode_number}"
                    mapped_response = requests.get(mapped_url, params=params)
                    mapped_response.raise_for_status()
                    mapped_episode_data = mapped_response.json()
                    mapped_episode_name = mapped_episode_data.get('name')
                    return f"S{season_number:02d}E{mapped_episode_number} - {mapped_episode_name}"
            except requests.exceptions.RequestException as se:
                log_message(f"Error fetching season data: {se}", level="ERROR")
                return None
        else:
            log_message(f"HTTP error occurred: {e}", level="ERROR")
            return None
    except requests.exceptions.RequestException as e:
        log_message(f"Error fetching episode data: {e}", level="ERROR")
        return None

def get_movie_collection(movie_id=None, movie_title=None, year=None):
    api_key = get_api_key()
    if not api_key:
        return None

    if movie_id:
        url = f"https://api.themoviedb.org/3/movie/{movie_id}"
        params = {'api_key': api_key, 'append_to_response': 'belongs_to_collection'}
    elif movie_title and year:
        search_url = "https://api.themoviedb.org/3/search/movie"
        search_params = {
            'api_key': api_key,
            'query': movie_title,
            'primary_release_year': year
        }
        try:
            search_response = requests.get(search_url, params=search_params)
            search_response.raise_for_status()
            search_results = search_response.json().get('results', [])

            if search_results:
                movie_id = search_results[0]['id']
                url = f"https://api.themoviedb.org/3/movie/{movie_id}"
                params = {'api_key': api_key, 'append_to_response': 'belongs_to_collection'}
            else:
                log_message(f"No movie found for {movie_title} ({year})", level="WARNING")
                return None
        except requests.exceptions.RequestException as e:
            log_message(f"Error searching for movie: {e}", level="ERROR")
            return None
    else:
        log_message("Either movie_id or (movie_title and year) must be provided", level="ERROR")
        return None

    try:
        response = requests.get(url, params=params)
        response.raise_for_status()
        movie_data = response.json()
        collection = movie_data.get('belongs_to_collection')
        if collection:
            return collection['name'], collection['id']
    except requests.exceptions.RequestException as e:
        log_message(f"Error fetching movie collection data: {e}", level="ERROR")
    return None
