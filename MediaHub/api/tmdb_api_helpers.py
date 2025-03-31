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

def get_episode_name(show_id, season_number, episode_number, max_length=60, force_anidb_style=False):
    """
    Fetch the episode name from TMDb API for the given show, season, and episode number.
    For anime, use AniDB-style mapping for absolute episode numbers across seasons.

    Parameters:
        show_id (int): TMDb show ID
        season_number (int or None): Season number, can be None to force AniDB-style mapping
        episode_number (int): Episode number
        max_length (int): Maximum length for episode names
        force_anidb_style (bool): Force using AniDB-style mapping regardless of season number

    Returns:
        tuple: (formatted_episode_name, mapped_season_number, mapped_episode_number)
    """
    api_key = get_api_key()
    if not api_key:
        log_message("TMDb API key not found in environment variables.", level="ERROR")
        return None, None, None

    log_message(f"Getting episode name for show ID {show_id}, season {season_number}, episode {episode_number}", level="DEBUG")

    # Check if we need to force AniDB-style mapping
    if season_number is None or force_anidb_style:
        log_message(f"Season number is None or AniDB-style mapping forced - using absolute episode mapping", level="INFO")
        return map_absolute_episode(show_id, episode_number, api_key, max_length)

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
        log_message(f"Direct episode lookup successful: {formatted_name}", level="DEBUG")
        return formatted_name, season_number, episode_number

    except requests.exceptions.HTTPError as e:
        if response.status_code == 404:
            log_message(f"Episode {episode_number} not found for season {season_number}. Using AniDB-style mapping.", level="INFO")
            return map_absolute_episode(show_id, episode_number, api_key, max_length)
        else:
            log_message(f"HTTP error occurred: {e}", level="ERROR")
            return None, None, None

    except requests.exceptions.RequestException as e:
        log_message(f"Error fetching episode data: {e}", level="ERROR")
        return None, None, None

def map_absolute_episode(show_id, absolute_episode, api_key, max_length=60):
    """
    Maps an absolute episode number to season and episode using AniDB-style mapping.
    With additional fallback for direct episode number lookup when mapping fails.

    Parameters:
        show_id (int): TMDb show ID
        absolute_episode (int): Absolute episode number
        api_key (str): TMDb API key
        max_length (int): Maximum length for episode names

    Returns:
        tuple: (formatted_episode_name, mapped_season_number, mapped_episode_number)
    """
    log_message(f"Mapping absolute episode {absolute_episode} for show ID {show_id}", level="DEBUG")

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
        episode_counts_by_season = []
        total_episodes_so_far = 0

        # First pass: collect episode counts for all seasons
        for season in range(1, total_seasons + 1):
            try:
                season_detail_url = f"https://api.themoviedb.org/3/tv/{show_id}/season/{season}"
                season_detail_response = requests.get(season_detail_url, params={'api_key': api_key})
                season_detail_response.raise_for_status()
                season_detail = season_detail_response.json()

                episode_count = len(season_detail.get('episodes', []))
                episode_counts_by_season.append(episode_count)
                total_episodes_so_far += episode_count
            except requests.exceptions.RequestException as e:
                log_message(f"Error getting season {season} details: {e}. Continuing with other seasons.", level="WARNING")
                episode_counts_by_season.append(0)

        log_message(f"Show has {total_episodes_so_far} episodes across all seasons", level="DEBUG")

        # Check if the absolute episode exceeds total episodes
        if total_episodes_so_far > 0 and int(absolute_episode) > total_episodes_so_far:
            log_message(f"Warning: Absolute episode {absolute_episode} exceeds all known episodes ({total_episodes_so_far})", level="WARNING")

        # First try the direct episode search (prioritize this for high episode numbers)
        if int(absolute_episode) > 100:
            log_message(f"High episode number detected ({absolute_episode}). Trying direct episode lookup first...", level="DEBUG")
            # Look through seasons in reverse order (most recent first)
            for season in range(total_seasons, 0, -1):
                try:
                    # Try to get episode with the exact absolute number
                    direct_url = f"https://api.themoviedb.org/3/tv/{show_id}/season/{season}/episode/{absolute_episode}"
                    direct_response = requests.get(direct_url, params={'api_key': api_key})

                    # If successful, we found our episode!
                    if direct_response.status_code == 200:
                        direct_episode_data = direct_response.json()
                        direct_episode_name = direct_episode_data.get('name', 'Unknown Episode')

                        if direct_episode_name and len(direct_episode_name) > max_length:
                            direct_episode_name = direct_episode_name[:max_length].rsplit(' ', 1)[0] + '...'

                        formatted_name = f"S{season:02d}E{absolute_episode:02d} - {direct_episode_name}"
                        log_message(f"Found direct episode match! Episode {absolute_episode} exists in season {season}", level="DEBUG")
                        return formatted_name, season, int(absolute_episode)

                except requests.exceptions.RequestException as e:
                    log_message(f"Direct lookup failed for S{season}E{absolute_episode}: {e}", level="DEBUG")
                    continue

        # Reset for mapping - traditional approach
        current_season = 1
        remaining_episodes = int(absolute_episode)

        # Second pass: map the absolute episode to season/episode using traditional method
        for season in range(1, total_seasons + 1):
            if season - 1 >= len(episode_counts_by_season):
                log_message(f"Season {season} data missing, skipping in mapping", level="WARNING")
                continue

            episode_count = episode_counts_by_season[season - 1]
            if episode_count == 0:
                log_message(f"Season {season} has no episodes, skipping in mapping", level="DEBUG")
                continue

            # If the remaining episodes fit in this season
            if remaining_episodes <= episode_count:
                current_episode = remaining_episodes
                log_message(f"Absolute episode {absolute_episode} maps to S{season:02d}E{current_episode:02d}", level="INFO")

                # Get the episode name
                try:
                    mapped_url = f"https://api.themoviedb.org/3/tv/{show_id}/season/{season}/episode/{current_episode}"
                    mapped_response = requests.get(mapped_url, params={'api_key': api_key})
                    mapped_response.raise_for_status()
                    mapped_episode_data = mapped_response.json()
                    mapped_episode_name = mapped_episode_data.get('name')

                    # Trim long episode names
                    if mapped_episode_name and len(mapped_episode_name) > max_length:
                        mapped_episode_name = mapped_episode_name[:max_length].rsplit(' ', 1)[0] + '...'

                    formatted_name = f"S{season:02d}E{current_episode:02d} - {mapped_episode_name}"
                    log_message(f"Mapped to: {formatted_name}", level="DEBUG")
                    return formatted_name, season, current_episode

                except requests.exceptions.RequestException as e:
                    log_message(f"Error getting episode info for S{season}E{current_episode}: {e}", level="WARNING")

            # Otherwise, subtract this season's episodes and move to next season
            remaining_episodes -= episode_count
            current_season += 1

        # If we've exhausted all mapping approaches, try additional fallbacks
        # Try again with direct episode lookup for any episode number
        log_message(f"Traditional mapping failed. Trying direct episode match for any season...", level="DEBUG")
        for season in range(total_seasons, 0, -1):
            try:
                direct_url = f"https://api.themoviedb.org/3/tv/{show_id}/season/{season}/episode/{absolute_episode}"
                direct_response = requests.get(direct_url, params={'api_key': api_key})

                if direct_response.status_code == 200:
                    direct_episode_data = direct_response.json()
                    direct_episode_name = direct_episode_data.get('name', 'Unknown Episode')

                    if direct_episode_name and len(direct_episode_name) > max_length:
                        direct_episode_name = direct_episode_name[:max_length].rsplit(' ', 1)[0] + '...'

                    formatted_name = f"S{season:02d}E{absolute_episode:02d} - {direct_episode_name}"
                    log_message(f"Second attempt found direct episode match! S{season}E{absolute_episode}", level="DEBUG")
                    return formatted_name, season, int(absolute_episode)
            except:
                continue

        # Fall back to the most popular/latest season with a reasonable episode number
        valid_seasons = [i+1 for i, count in enumerate(episode_counts_by_season) if count > 0]
        if not valid_seasons:
            log_message(f"No valid seasons found, defaulting to season 1", level="WARNING")
            last_season = 1
            fallback_episode = int(absolute_episode)
        else:
            last_season = max(valid_seasons)
            last_season_episodes = episode_counts_by_season[last_season - 1]

            # Use modulo to keep the episode number within range
            fallback_episode = (int(absolute_episode) % last_season_episodes) if last_season_episodes > 0 else int(absolute_episode)
            if fallback_episode == 0:
                fallback_episode = last_season_episodes

        log_message(f"All mapping approaches failed. Final fallback: S{last_season:02d}E{fallback_episode:02d}", level="WARNING")

        # Try to get episode name for final fallback
        try:
            mapped_url = f"https://api.themoviedb.org/3/tv/{show_id}/season/{last_season}/episode/{fallback_episode}"
            mapped_response = requests.get(mapped_url, params={'api_key': api_key})
            mapped_response.raise_for_status()
            mapped_episode_data = mapped_response.json()
            mapped_episode_name = mapped_episode_data.get('name', 'Unknown Episode')

            if mapped_episode_name and len(mapped_episode_name) > max_length:
                mapped_episode_name = mapped_episode_name[:max_length].rsplit(' ', 1)[0] + '...'

            formatted_name = f"S{last_season:02d}E{fallback_episode:02d} - {mapped_episode_name}"
            return formatted_name, last_season, fallback_episode

        except requests.exceptions.RequestException:
            log_message(f"Could not get episode name for final fallback mapping", level="ERROR")
            return f"S{last_season:02d}E{fallback_episode:02d}", last_season, fallback_episode

    except requests.exceptions.RequestException as se:
        log_message(f"Error fetching season data: {se}", level="ERROR")

        # Even if initial season data fetch fails, try direct episode lookup as last resort
        log_message(f"Attempting direct episode lookup as final fallback...", level="DEBUG")
        try:
            # Try with season 1 as default
            direct_url = f"https://api.themoviedb.org/3/tv/{show_id}/season/1/episode/{absolute_episode}"
            direct_response = requests.get(direct_url, params={'api_key': api_key})

            if direct_response.status_code == 200:
                direct_episode_data = direct_response.json()
                direct_episode_name = direct_episode_data.get('name', 'Unknown Episode')
                formatted_name = f"S01E{absolute_episode:02d} - {direct_episode_name}"
                log_message(f"Final attempt found match at S01E{absolute_episode}", level="INFO")
                return formatted_name, 1, int(absolute_episode)
        except:
            pass

        # If everything fails, just return a basic season 1, episode X
        log_message(f"All approaches failed. Using S01E{absolute_episode} as last resort", level="WARNING")
        return f"S01E{absolute_episode:02d}", 1, int(absolute_episode)

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

def process_chosen_show(chosen_show, auto_select, tmdb_id=None, season_number=None, episode_number=None, episode_match=None, is_extra=None, file=None, force_extra=None):
    """
    Process a chosen TV show and extract relevant information.
    Args:
        chosen_show: The selected show data
        auto_select: Whether to automatically select seasons/episodes
        tmdb_id: Optional TMDB ID if already known
        season_number: Optional season number if already identified
        episode_number: Optional episode number if already identified
        episode_match: Optional episode pattern match information
        is_extra: Whether this is extra content
        file: The file being processed
    Returns:
        tuple: (proper_name, show_name, is_anime_genre, new_season_number, new_episode_number, tmdb_id)
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
    is_anime_genre = genre_info.get('is_anime_genre', False)

    # Handle season and episode selection
    new_season_number = None
    new_episode_number = None

    if force_extra:
        is_extra=False
    elif is_extra:
        log_message(f"Processing extra content file: {file}", level="INFO")

    # Check if we already have season_number and episode_number
    if season_number is not None and not is_extra:
        try:
            new_season_number = int(season_number)
            log_message(f"Using identified season number: {new_season_number}", level="DEBUG")
        except (ValueError, TypeError):
            log_message(f"Invalid season number provided: {season_number}", level="ERROR")
            new_season_number = None

    if episode_number is not None:
        try:
            new_episode_number = int(episode_number)
            log_message(f"Using identified episode number: {new_episode_number}", level="DEBUG")
        except (ValueError, TypeError):
            log_message(f"Invalid episode number provided: {episode_number}", level="ERROR")
            new_episode_number = None

    # Special handling for anime when we have episode but no season
    if is_anime_genre and new_episode_number is not None and new_season_number is None:
        log_message(f"Anime show with episode number but no season number - forcing AniDB-style mapping", level="DEBUG")
        if tmdb_id and new_episode_number:
            episode_info, mapped_season, mapped_episode = get_episode_name(
                tmdb_id, None, new_episode_number, force_anidb_style=True
            )
            if mapped_season is not None:
                new_season_number = mapped_season
                log_message(f"AniDB-style mapping: Episode {new_episode_number} -> Season {new_season_number}, Episode {mapped_episode}", level="INFO")
                new_episode_number = mapped_episode
            else:
                log_message(f"AniDB-style mapping failed, proceeding with season selection", level="WARNING")

    # If we don't have season_number but need to select it
    if new_season_number is None and not is_extra and (not episode_match or (episode_match and not season_number)):
        seasons = get_show_seasons(tmdb_id)
        if seasons:
            log_message(f"No season number identified, proceeding with season selection", level="INFO")
            new_season_number = select_season(seasons, auto_select)

    # If we still don't have a season number for anime, default to Season 1
    if is_anime_genre and new_season_number is None and new_episode_number is not None:
        new_season_number = 1
        log_message(f"No season selected for anime - defaulting to Season 1 for organization", level="INFO")
        log_message(f"Note: Episode {new_episode_number} will be treated as absolute episode number", level="INFO")

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

    return proper_name, show_name, is_anime_genre, new_season_number, new_episode_number, tmdb_id
