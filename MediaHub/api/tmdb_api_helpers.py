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

def calculate_score(result, query, year=None):
    """
    Calculate a match score between a search result and the query.
    Higher scores indicate better matches.

    Parameters:
    result (dict): TMDB API search result
    query (str): Original search query
    year (str): Optional year to match against

    Returns:
    float: Match score between 0 and 100
    """
    score = 0

    query = query.lower().strip()
    title = result.get('name', '').lower().strip()
    original_title = result.get('original_name', '').lower().strip()

    # Title exact match (40 points)
    if query == title or query == original_title:
        score += 40
    # Title contains query or vice versa (20 points)
    elif query in title or title in query or query in original_title or original_title in query:
        score += 20

    # Year match (30 points)
    if year:
        first_air_date = result.get('first_air_date', '')
        if first_air_date:
            result_year = first_air_date.split('-')[0]
            if result_year == str(year):
                score += 30
            # Partial year match (within 1 year) (15 points)
            elif abs(int(result_year) - int(year)) <= 1:
                score += 15

    # Language and country bonus (15 points)
    if result.get('original_language') == 'en':
        score += 10
    if result.get('origin_country') and any(country in ['GB', 'US', 'CA', 'AU', 'NZ']
                                          for country in result.get('origin_country')):
        score += 5

    # Popularity bonus (up to 15 points)
    popularity = result.get('popularity', 0)
    if popularity > 0:
        # Normalize popularity score (0-15 points)
        popularity_score = min(15, (popularity / 100) * 15)
        score += popularity_score

    return score

def get_show_seasons(tmdb_id):
    """
    Fetch all seasons for a given TV show using TMDB API
    """
    if not check_api_key():
        return None

    url = f"https://api.themoviedb.org/3/tv/{tmdb_id}"
    params = {'api_key': api_key}

    try:
        response = requests.get(url, params=params)
        response.raise_for_status()
        show_data = response.json()
        return show_data.get('seasons', [])
    except requests.exceptions.RequestException as e:
        log_message(f"Error fetching season data: {e}", level="ERROR")
        return None

def select_season(seasons, auto_select=False):
    """
    Display and handle season selection, prioritizing standard seasons over Season 0
    """
    if not seasons:
        return None

    # Re-organize seasons to deprioritize Season 0 when appropriate
    standard_seasons = []
    special_seasons = []

    for season in seasons:
        season_number = season.get('season_number', 0)
        if season_number == 0:
            special_seasons.append(season)
        else:
            standard_seasons.append(season)

    if auto_select and standard_seasons:
        return standard_seasons[0].get('season_number')

    # For display purposes, put regular seasons first, then Specials
    display_seasons = standard_seasons + special_seasons

    if not display_seasons:
        return None

    if auto_select:
        return display_seasons[0].get('season_number', None)

    while True:
        log_message("Available seasons:", level="INFO")
        for idx, season in enumerate(display_seasons, 1):
            season_number = season.get('season_number', 0)
            episode_count = season.get('episode_count', 0)
            air_date = season.get('air_date', 'Unknown Date')

            # Add note for Season 0
            if season_number == 0:
                log_message(f"{idx}: Season {season_number} - {episode_count} episodes (Air Date: {air_date}) [Contains special episodes]", level="INFO")
            else:
                log_message(f"{idx}: Season {season_number} - {episode_count} episodes (Air Date: {air_date})", level="INFO")

        log_message("Options:", level="INFO")
        log_message("- Enter 1-{} to select a season".format(len(display_seasons)), level="INFO")
        log_message("- Press Enter to skip season selection", level="INFO")

        choice = input("Enter your choice: ").strip()

        if not choice:
            return None
        elif choice.isdigit() and 1 <= int(choice) <= len(display_seasons):
            selected_season = display_seasons[int(choice) - 1]
            season_number = selected_season.get('season_number', None)
            return season_number
        else:
            log_message("Invalid selection. Please try again.", level="WARNING")
