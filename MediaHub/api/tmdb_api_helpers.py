import os
import platform
import re
import requests
import urllib.parse
import logging
import unicodedata
import difflib
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

def get_episode_name(show_id, season_number, episode_number, max_length=60):
    """
    Fetch the episode name from TMDb API for the given show, season, and episode number.
    For anime, use AniDB-style mapping for absolute episode numbers across seasons.
    Returns:
        tuple: (formatted_episode_name, mapped_season_number, mapped_episode_number)
    """
    api_key = get_api_key()
    if not api_key:
        log_message("TMDb API key not found in environment variables.", level="ERROR")
        return None, None, None

    try:
        # First try direct episode lookup
        url = f"https://api.themoviedb.org/3/tv/{show_id}/season/{season_number}/episode/{episode_number}"
        params = {'api_key': api_key}
        response = requests.get(url, params=params)
        response.raise_for_status()
        episode_data = response.json()
        episode_name = episode_data.get('name')

        # Trim long episode names
        if len(episode_name) > max_length:
            episode_name = episode_name[:max_length].rsplit(' ', 1)[0] + '...'

        formatted_name = f"S{season_number:02d}E{episode_number:02d} - {episode_name}"
        return formatted_name, season_number, episode_number

    except requests.exceptions.HTTPError as e:
        if response.status_code == 404:
            log_message(f"Episode {episode_number} not found for season {season_number}. Using AniDB-style mapping.", level="DEBUG")

            # Get all seasons data
            show_url = f"https://api.themoviedb.org/3/tv/{show_id}"
            show_params = {'api_key': api_key}

            try:
                show_response = requests.get(show_url, params=show_params)
                show_response.raise_for_status()
                show_data = show_response.json()

                # Get number of seasons
                total_seasons = show_data.get('number_of_seasons', 0)

                # Initialize variables to track episode counting
                absolute_episode = int(episode_number)
                current_season = 1
                season_episode = 0

                # Loop through seasons until we find where the absolute episode belongs
                while current_season <= total_seasons:
                    season_detail_url = f"https://api.themoviedb.org/3/tv/{show_id}/season/{current_season}"
                    season_detail_response = requests.get(season_detail_url, params={'api_key': api_key})
                    season_detail_response.raise_for_status()
                    season_detail = season_detail_response.json()

                    episode_count = len(season_detail.get('episodes', []))

                    # If we're checking the first season and the original request was for season 1,
                    # and the episode number is valid, we don't need to map
                    if current_season == 1 and int(season_number) == 1 and absolute_episode <= episode_count:
                        return (f"S01E{absolute_episode:02d} - {season_detail.get('episodes', [])[absolute_episode-1].get('name')}",
                                1, absolute_episode)

                    # If the absolute episode fits in this season
                    if absolute_episode <= episode_count:
                        season_episode = absolute_episode
                        break

                    # Otherwise, subtract this season's episodes and move to next season
                    absolute_episode -= episode_count
                    current_season += 1

                # If we found a proper mapping
                if current_season <= total_seasons:
                    # Get the episode name for the mapped episode
                    mapped_url = f"https://api.themoviedb.org/3/tv/{show_id}/season/{current_season}/episode/{season_episode}"
                    mapped_response = requests.get(mapped_url, params={'api_key': api_key})
                    mapped_response.raise_for_status()
                    mapped_episode_data = mapped_response.json()
                    mapped_episode_name = mapped_episode_data.get('name')

                    log_message(
                        f"Absolute episode {episode_number} for S{season_number} mapped to S{current_season}E{season_episode} using AniDB-style mapping.",
                        level="DEBUG"
                    )
                    return (f"S{current_season:02d}E{season_episode:02d} - {mapped_episode_name}",
                            current_season, season_episode)
                else:
                    # If we exhausted all seasons and still didn't find the episode, fall back to modulo
                    # But with a specific note that this is a less accurate fallback
                    first_season_url = f"https://api.themoviedb.org/3/tv/{show_id}/season/1"
                    first_season_response = requests.get(first_season_url, params={'api_key': api_key})
                    first_season_response.raise_for_status()
                    first_season_detail = first_season_response.json()
                    first_season_episodes = len(first_season_detail.get('episodes', []))

                    log_message(
                        f"Warning: Absolute episode {episode_number} exceeds all known episodes across {total_seasons} seasons. Using fallback mapping.",
                        level="WARNING"
                    )

                    # Reinitialize our calculation with original episode number
                    absolute_episode = int(episode_number)
                    current_season = 1

                    while current_season <= total_seasons:
                        season_url = f"https://api.themoviedb.org/3/tv/{show_id}/season/{current_season}"
                        season_response = requests.get(season_url, params={'api_key': api_key})
                        if season_response.status_code == 200:
                            season_detail = season_response.json()
                            episode_count = len(season_detail.get('episodes', []))
                            if absolute_episode <= episode_count:
                                season_episode = absolute_episode
                                break

                            absolute_episode -= episode_count
                            current_season += 1
                        else:
                            break

                    # If we've gone through all seasons and still have episodes left, use the last season
                    if current_season > total_seasons:
                        current_season = total_seasons
                        # Get the last season's episode count again
                        last_season_url = f"https://api.themoviedb.org/3/tv/{show_id}/season/{current_season}"
                        last_season_response = requests.get(last_season_url, params={'api_key': api_key})
                        last_season_response.raise_for_status()
                        last_season_detail = last_season_response.json()
                        last_season_episodes = len(last_season_detail.get('episodes', []))

                        # Map to an episode in the last season
                        season_episode = (absolute_episode % last_season_episodes) or last_season_episodes

                    # Get the episode name for the mapped episode
                    mapped_url = f"https://api.themoviedb.org/3/tv/{show_id}/season/{current_season}/episode/{season_episode}"
                    mapped_response = requests.get(mapped_url, params={'api_key': api_key})
                    mapped_response.raise_for_status()
                    mapped_episode_data = mapped_response.json()
                    mapped_episode_name = mapped_episode_data.get('name')

                    log_message(
                        f"Absolute episode {episode_number} for S{season_number} mapped to S{current_season}E{season_episode} using cross-season mapping.",
                        level="DEBUG"
                    )

                    return (f"S{current_season:02d}E{season_episode:02d} - {mapped_episode_name}",
                            current_season, season_episode)

            except requests.exceptions.RequestException as se:
                log_message(f"Error fetching season data: {se}", level="ERROR")
                return None, None, None
        else:
            log_message(f"HTTP error occurred: {e}", level="ERROR")
            return None, None, None

    except requests.exceptions.RequestException as e:
        log_message(f"Error fetching episode data: {e}", level="ERROR")
        return None, None, None

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

    # Check if we're dealing with a movie or TV show result
    if 'title' in result:
        title = result.get('title', '').lower().strip()
        original_title = result.get('original_title', '').lower().strip()
        release_date = result.get('release_date', '')
        result_year = release_date.split('-')[0] if release_date else None
    else:
        title = result.get('name', '').lower().strip()
        original_title = result.get('original_name', '').lower().strip()
        first_air_date = result.get('first_air_date', '')
        result_year = first_air_date.split('-')[0] if first_air_date else None

    if query == title:
        score += 50
    elif query == original_title:
        score += 50
    elif query in title or title in query:
        score += 20
    elif query in original_title or original_title in query:
        score += 20

    # Title similarity calculation
    title_similarity = difflib.SequenceMatcher(None, query, title).ratio() * 25
    score += title_similarity

    # Year match scoring
    if year and result_year:
        if result_year == str(year):
            score += 30
        elif abs(int(result_year) - int(year)) <= 1:
            score += 15

    # Language and country bonus (15 points)
    if result.get('original_language') == 'en':
        score += 10

    if result.get('origin_country') and any(country in ['GB', 'US', 'CA', 'AU', 'NZ'] for country in result.get('origin_country')):
        score += 5

    # Popularity bonus (up to 15 points)
    popularity = result.get('popularity', 0)
    if popularity > 0:
        # Normalize popularity score (0-15 points)
        popularity_score = min(15, (popularity / 100) * 15)
        score += popularity_score

    query_words = set(query.split())
    title_words = set(title.split())
    matching_words = query_words.intersection(title_words)
    if matching_words:
        word_match_score = min(10, (len(matching_words) / len(query_words)) * 10)
        score += word_match_score

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

def get_available_episodes(tmdb_id, season_number, api_key):
    """
    Fetch and return available episodes for a given TV show season.

    Args:
        tmdb_id (int): The TMDB ID of the show
        season_number (int): The season number to fetch episodes for
        api_key (str): TMDB API key

    Returns:
        list: List of episode dictionaries containing episode data
              Returns empty list if request fails
    """
    # Ensure tmdb_id and season_number are integers
    try:
        tmdb_id = int(tmdb_id)
        season_number = int(season_number)
    except (ValueError, TypeError):
        log_message(f"Invalid tmdb_id or season_number: {tmdb_id}, {season_number}", level="ERROR")
        return []

    episodes_url = f"https://api.themoviedb.org/3/tv/{tmdb_id}/season/{season_number}"
    episodes_params = {'api_key': api_key}

    try:
        episodes_response = requests.get(episodes_url, params=episodes_params)
        episodes_response.raise_for_status()
        season_data = episodes_response.json()
        return season_data.get('episodes', [])
    except requests.exceptions.RequestException as e:
        log_message(f"Error fetching episode data: {e}", level="ERROR")
        return []

def display_available_episodes(episodes):
    """
    Display available episodes in a formatted manner.

    Args:
        episodes (list): List of episode dictionaries containing episode data
    """
    if not episodes:
        log_message("No episodes available", level="INFO")
        return

    log_message("Available episodes:", level="INFO")
    for i in range(0, len(episodes), 4):
        episode_group = episodes[i:i+4]
        episode_info = []
        for ep in episode_group:
            try:
                ep_num = int(ep.get('episode_number', 0))
                ep_name = str(ep.get('name', 'Unknown'))
                episode_info.append(f"E{ep_num:02d}: {ep_name}")
            except (ValueError, TypeError):
                log_message(f"Invalid episode data: {ep}", level="ERROR")
                continue

        if episode_info:
            log_message(", ".join(episode_info), level="INFO")

    log_message("Options:", level="INFO")
    log_message(f"- Enter episode number (1-{len(episodes)})", level="INFO")
    log_message("- Press Enter to skip episode selection", level="INFO")

def handle_episode_selection(tmdb_id, season_number, auto_select, api_key):
    """
    Handle the episode selection process for a given season.

    Args:
        tmdb_id (int): The TMDB ID of the show
        season_number (int): The season number to handle episodes for
        auto_select (bool): Whether to automatically select the first episode
        api_key (str): TMDB API key

    Returns:
        int or None: Selected episode number or None if no selection made
    """
    try:
        season_number = int(season_number)
    except (ValueError, TypeError):
        log_message(f"Invalid season number: {season_number}", level="ERROR")
        return None

    episodes = get_available_episodes(tmdb_id, season_number, api_key)

    if not episodes:
        return None

    if auto_select:
        new_episode_number = 1
        log_message(f"Auto-selected episode 1 of season {season_number}", level="INFO")

        episode_info = get_episode_name(tmdb_id, season_number, new_episode_number)
        if episode_info:
            log_message(f"Auto-selected: {episode_info}", level="INFO")
        return new_episode_number

    display_available_episodes(episodes)
    ep_choice = input("Enter episode number: ").strip()

    try:
        if ep_choice and int(ep_choice) in range(1, len(episodes) + 1):
            new_episode_number = int(ep_choice)

            episode_info = get_episode_name(tmdb_id, season_number, new_episode_number)
            if episode_info:
                log_message(f"Selected: {episode_info}", level="INFO")
            else:
                log_message(f"Selected: S{season_number:02d}E{new_episode_number:02d}", level="INFO")
            return new_episode_number
    except ValueError:
        pass

    log_message("No valid episode selected, continuing without episode specification", level="INFO")
    return None

def process_chosen_show(chosen_show, auto_select, tmdb_id=None, season_number=None, episode_number=None, episode_match=None, is_extra=None, file=None):
    """
    Process a chosen TV show and extract relevant information.
    Args:
        chosen_show: The selected show data
        auto_select: Whether to automatically select seasons/episodes
        tmdb_id: Optional TMDB ID if already known
        season_number: Optional season number if already identified
        episode_number: Optional episode number if already identified
        episode_match: Optional episode pattern match information
    Returns:
        tuple: (proper_name, show_name, is_anime_genre, new_season_number, new_episode_number)
    """
    # Get the original show name
    original_show_name = chosen_show.get('name')

    # Helper function to format show name for the OS
    if platform.system().lower() == 'windows' or platform.system().lower() == 'nt':
        show_name = original_show_name.replace(':', ' -')
    else:
        show_name = original_show_name

    first_air_date = chosen_show.get('first_air_date')
    show_year = first_air_date.split('-')[0] if first_air_date else "Unknown Year"
    tmdb_id = chosen_show.get('id') if not tmdb_id else tmdb_id

    # Get external IDs and genre information
    external_ids = get_external_ids(tmdb_id, 'tv')
    genre_info = get_show_genres(tmdb_id)
    is_anime_genre = genre_info['is_anime_genre']

    # Handle season and episode selection
    new_season_number = None
    new_episode_number = None

    # Log if this is an extra file
    if is_extra:
        log_message(f"Processing extra content file: {file}", level="INFO")
        log_message("Extra content detected - will be placed in Extras folder", level="INFO")
        log_message("Note: Season/Episode numbers will be ignored for extra content", level="INFO")

    # First, check if we already have season_number and episode_number
    if season_number is not None:
        try:
            new_season_number = int(season_number)
            log_message(f"Using identified season number: {new_season_number}", level="INFO")
        except (ValueError, TypeError):
            log_message(f"Invalid season number provided: {season_number}", level="ERROR")
            new_season_number = None

    if episode_number is not None:
        try:
            new_episode_number = int(episode_number)
            log_message(f"Using identified episode number: {new_episode_number}", level="INFO")
        except (ValueError, TypeError):
            log_message(f"Invalid episode number provided: {episode_number}", level="ERROR")
            new_episode_number = None

    # If we don't have season_number but need to select it
    if new_season_number is None and (not episode_match or (episode_match and not season_number)):
        seasons = get_show_seasons(tmdb_id)
        if seasons:
            log_message(f"No season number identified, proceeding with season selection", level="INFO")
            new_season_number = select_season(seasons, auto_select)

    # Handle episode selection if we have a season but no episode
    if new_season_number is not None and new_episode_number is None:
        log_message(f"Season {new_season_number} selected", level="INFO")
        new_episode_number = handle_episode_selection(tmdb_id, new_season_number, auto_select, api_key)

    # Build the proper name with optional season information
    if is_imdb_folder_id_enabled():
        imdb_id = external_ids.get('imdb_id', '')
        log_message(f"TV Show: {show_name}, IMDB ID: {imdb_id}", level="DEBUG")
        proper_name = f"{show_name} ({show_year}) {{imdb-{imdb_id}}} {{tmdb-{tmdb_id}}}"
    elif is_tvdb_folder_id_enabled():
        tvdb_id = external_ids.get('tvdb_id', '')
        log_message(f"TV Show: {show_name}, TVDB ID: {tvdb_id}", level="DEBUG")
        proper_name = f"{show_name} ({show_year}) {{tvdb-{tvdb_id}}} {{tmdb-{tmdb_id}}}"
    else:
        proper_name = f"{show_name} ({show_year}) {{tmdb-{tmdb_id}}}"

    return proper_name, show_name, is_anime_genre, new_season_number, new_episode_number
