import os
import platform
import re
import requests
import urllib.parse
import logging
import unicodedata
import difflib
import time
from functools import wraps
from bs4 import BeautifulSoup
from functools import lru_cache
from MediaHub.utils.logging_utils import log_message
from MediaHub.config.config import is_imdb_folder_id_enabled, is_tvdb_folder_id_enabled, is_tmdb_folder_id_enabled, tmdb_api_language
from MediaHub.utils.file_utils import clean_query, normalize_query, standardize_title, remove_genre_names, extract_title, sanitize_windows_filename
from MediaHub.api.api_key_manager import get_api_key, check_api_key
from MediaHub.api.language_iso_codes import get_iso_code
from MediaHub.api.media_cover import process_tmdb_covers

_api_cache = {}

# Global variables for API key status and warnings
api_key = get_api_key()
api_warning_logged = False

# Disable urllib3 debug logging
logging.getLogger("urllib3").setLevel(logging.WARNING)

# Get API Language
preferred_language = tmdb_api_language()
language_iso = get_iso_code(preferred_language)

# Create a session for connection pooling and better performance
session = requests.Session()
session.headers.update({
    'User-Agent': 'MediaHub/1.0',
    'Accept': 'application/json'
})

from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

adapter = HTTPAdapter(
    pool_connections=50,
    pool_maxsize=50,
    max_retries=Retry(
        total=3,
        backoff_factor=0.1,
        status_forcelist=[500, 502, 503, 504]
    )
)

session.mount('http://', adapter)
session.mount('https://', adapter)

# ============================================================================
# TMDB DATA FETCHING FUNCTIONS
# ============================================================================

def get_movie_data(tmdb_id):
    """Get all movie data (external IDs, genres, keywords, ratings) in one optimized API call."""
    global api_key
    if not api_key:
        api_key = get_api_key()

    if not api_key:
        log_message("API key is missing. Cannot fetch movie data.", level="ERROR")
        return {'imdb_id': '', 'collection_name': None, 'is_anime_genre': False, 'is_kids_content': False, 'original_language': None}

    params = {
        'api_key': api_key,
        'language': language_iso,
        'append_to_response': 'external_ids,keywords,release_dates,belongs_to_collection'
    }

    try:
        url = f"https://api.themoviedb.org/3/movie/{tmdb_id}"
        response = session.get(url, params=params, timeout=10)
        response.raise_for_status()
        data = response.json()

        # Extract external IDs
        external_ids = data.get('external_ids', {})
        imdb_id = external_ids.get('imdb_id', '')

        # Extract collection information
        collection_data = data.get('belongs_to_collection')
        collection_name = collection_data.get('name') if collection_data else None

        # Extract and check genres for anime
        genres = data.get('genres', [])
        language = data.get('original_language', '')
        is_anime_genre = check_anime_genre(genres, language)

        # Extract keywords for family content detection
        keywords_data = data.get('keywords', {})

        # Extract release dates for content rating
        release_dates_data = data.get('release_dates', {})

        # Check for family-friendly content
        has_family_indicators = has_family_content_indicators(data, keywords_data, 'movie')

        # Get content rating from release dates
        us_rating = None
        other_rating = None

        for result in release_dates_data.get('results', []):
            country = result.get('iso_3166_1', '')
            for release in result.get('release_dates', []):
                certification = release.get('certification', '').strip()
                if certification:
                    if country == 'US':
                        us_rating = certification
                        break
                    elif not other_rating:
                        other_rating = certification

            if us_rating:
                break

        rating = us_rating or other_rating
        has_appropriate_rating = is_family_friendly_rating(rating)
        is_kids_content = has_appropriate_rating and has_family_indicators
        process_tmdb_covers(tmdb_id, data)

        # Map language code to full name
        lang_map = {
            'en': 'English', 'es': 'Spanish', 'fr': 'French', 'de': 'German',
            'it': 'Italian', 'ja': 'Japanese', 'ko': 'Korean', 'zh': 'Chinese',
            'ru': 'Russian', 'pt': 'Portuguese', 'ar': 'Arabic', 'hi': 'Hindi'
        }
        original_language_name = lang_map.get(language, language.upper() if language else None)

        return {
            'imdb_id': imdb_id,
            'collection_name': collection_name,
            'is_anime_genre': is_anime_genre,
            'is_kids_content': is_kids_content,
            'original_language': original_language_name
        }

    except requests.exceptions.RequestException as e:
        log_message(f"TMDB movie data fetch failed for movie ID {tmdb_id} - Network error: {e}", level="ERROR")
        return {'imdb_id': '', 'collection_name': None, 'is_anime_genre': False, 'is_kids_content': False, 'original_language': None}

def get_show_data(tmdb_id):
    """Get all TV show data (external IDs, genres, keywords, ratings) in one optimized API call."""
    global api_key
    if not api_key:
        api_key = get_api_key()

    if not api_key:
        log_message("API key is missing. Cannot fetch TV data.", level="ERROR")
        return {'external_ids': {}, 'is_anime_genre': False, 'is_kids_content': False}

    params = {
        'api_key': api_key,
        'language': language_iso,
        'append_to_response': 'external_ids,keywords,content_ratings'
    }

    try:
        url = f"https://api.themoviedb.org/3/tv/{tmdb_id}"
        response = session.get(url, params=params, timeout=10)
        response.raise_for_status()
        data = response.json()

        # Extract external IDs
        external_ids = data.get('external_ids', {})

        # Extract and check genres for anime
        genres = data.get('genres', [])
        language = data.get('original_language', '')
        is_anime_genre = check_anime_genre(genres, language)

        # Extract keywords for family content detection
        keywords_data = data.get('keywords', {})

        # Extract content ratings
        content_ratings_data = data.get('content_ratings', {})

        # Check for family-friendly content
        has_family_indicators = has_family_content_indicators(data, keywords_data, 'tv')

        # Get content rating from content ratings
        us_rating = None
        other_rating = None

        for result in content_ratings_data.get('results', []):
            country = result.get('iso_3166_1', '')
            certification = result.get('rating', '').strip()
            if certification:
                if country == 'US':
                    us_rating = certification
                    break
                elif not other_rating:
                    other_rating = certification

        rating = us_rating or other_rating
        has_appropriate_rating = is_family_friendly_rating(rating)
        is_kids_content = has_appropriate_rating and has_family_indicators
        process_tmdb_covers(tmdb_id, data)

        # Map language code to full name
        lang_map = {
            'en': 'English', 'es': 'Spanish', 'fr': 'French', 'de': 'German',
            'it': 'Italian', 'ja': 'Japanese', 'ko': 'Korean', 'zh': 'Chinese',
            'ru': 'Russian', 'pt': 'Portuguese', 'ar': 'Arabic', 'hi': 'Hindi'
        }
        original_language_name = lang_map.get(language, language.upper() if language else None)

        return {
            'external_ids': external_ids,
            'is_anime_genre': is_anime_genre,
            'is_kids_content': is_kids_content,
            'original_language': original_language_name,
            'seasons': data.get('seasons', []),
            'name': data.get('name', '')
        }

    except requests.exceptions.RequestException as e:
        log_message(f"TMDB TV data fetch failed for TV ID {tmdb_id} - Network error: {e}", level="ERROR")
        return {'external_ids': {}, 'is_anime_genre': False, 'is_kids_content': False, 'original_language': None}

def check_anime_genre(genres, language):
    """Check if content is anime based on genres and language."""
    # Primary anime detection: Animation genre + Japanese language
    is_animation = any(genre.get('id') == 16 for genre in genres)
    is_japanese = language == 'ja'

    if is_animation and is_japanese:
        return True

    # Secondary check: explicit "anime" keyword in genre names (not "animation")
    has_anime_keyword = any(
        'anime' in genre.get('name', '').lower() for genre in genres
    )

    return has_anime_keyword

# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

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
        params = {'api_key': api_key, 'language': language_iso}
        response = session.get(url, params=params, timeout=10)
        response.raise_for_status()
        episode_data = response.json()
        episode_name = episode_data.get('name')

        # Trim long episode names
        if len(episode_name) > max_length:
            episode_name = episode_name[:max_length].rsplit(' ', 1)[0] + '...'

        # Sanitize episode name for Windows compatibility
        if platform.system().lower() == 'windows' or platform.system().lower() == 'nt':
            episode_name = sanitize_windows_filename(episode_name)

        formatted_name = f"S{season_number:02d}E{episode_number:02d} - {episode_name}"
        log_message(f"Direct episode lookup successful: {formatted_name}", level="DEBUG")
        return formatted_name, season_number, episode_number

    except requests.exceptions.HTTPError as e:
        if response.status_code == 404:
            log_message(f"Episode S{season_number}E{episode_number} not found in TMDB, using AniDB-style mapping", level="INFO")
            return map_absolute_episode(show_id, episode_number, api_key, max_length)
        else:
            log_message(f"TMDB episode fetch failed - HTTP {response.status_code}: {e}", level="ERROR")
            return None, None, None

    except requests.exceptions.RequestException as e:
        log_message(f"TMDB episode fetch failed - Network error: {e}", level="ERROR")
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
        show_response = session.get(show_url, params=show_params, timeout=10)
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
                season_detail_response = session.get(season_detail_url, params={'api_key': api_key}, timeout=10)
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
                    direct_response = session.get(direct_url, params={'api_key': api_key}, timeout=10)

                    # If successful, we found our episode!
                    if direct_response.status_code == 200:
                        direct_episode_data = direct_response.json()
                        direct_episode_name = direct_episode_data.get('name', 'Unknown Episode')

                        if direct_episode_name and len(direct_episode_name) > max_length:
                            direct_episode_name = direct_episode_name[:max_length].rsplit(' ', 1)[0] + '...'

                        # Sanitize episode name for Windows compatibility
                        if direct_episode_name and (platform.system().lower() == 'windows' or platform.system().lower() == 'nt'):
                            direct_episode_name = sanitize_windows_filename(direct_episode_name)

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
                    mapped_response = session.get(mapped_url, params={'api_key': api_key}, timeout=10)
                    mapped_response.raise_for_status()
                    mapped_episode_data = mapped_response.json()
                    mapped_episode_name = mapped_episode_data.get('name')

                    # Trim long episode names
                    if mapped_episode_name and len(mapped_episode_name) > max_length:
                        mapped_episode_name = mapped_episode_name[:max_length].rsplit(' ', 1)[0] + '...'

                    # Sanitize episode name for Windows compatibility
                    if mapped_episode_name and (platform.system().lower() == 'windows' or platform.system().lower() == 'nt'):
                        mapped_episode_name = sanitize_windows_filename(mapped_episode_name)

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
                direct_response = session.get(direct_url, params={'api_key': api_key}, timeout=10)

                if direct_response.status_code == 200:
                    direct_episode_data = direct_response.json()
                    direct_episode_name = direct_episode_data.get('name', 'Unknown Episode')

                    if direct_episode_name and len(direct_episode_name) > max_length:
                        direct_episode_name = direct_episode_name[:max_length].rsplit(' ', 1)[0] + '...'

                    # Sanitize episode name for Windows compatibility
                    if direct_episode_name and (platform.system().lower() == 'windows' or platform.system().lower() == 'nt'):
                        direct_episode_name = sanitize_windows_filename(direct_episode_name)

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
            mapped_response = session.get(mapped_url, params={'api_key': api_key}, timeout=10)
            mapped_response.raise_for_status()
            mapped_episode_data = mapped_response.json()
            mapped_episode_name = mapped_episode_data.get('name', 'Unknown Episode')

            if mapped_episode_name and len(mapped_episode_name) > max_length:
                mapped_episode_name = mapped_episode_name[:max_length].rsplit(' ', 1)[0] + '...'

            # Sanitize episode name for Windows compatibility
            if mapped_episode_name and (platform.system().lower() == 'windows' or platform.system().lower() == 'nt'):
                mapped_episode_name = sanitize_windows_filename(mapped_episode_name)

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
            direct_response = session.get(direct_url, params={'api_key': api_key}, timeout=10)

            if direct_response.status_code == 200:
                direct_episode_data = direct_response.json()
                direct_episode_name = direct_episode_data.get('name', 'Unknown Episode')

                # Sanitize episode name for Windows compatibility
                if direct_episode_name and (platform.system().lower() == 'windows' or platform.system().lower() == 'nt'):
                    direct_episode_name = sanitize_windows_filename(direct_episode_name)

                formatted_name = f"S01E{absolute_episode:02d} - {direct_episode_name}"
                log_message(f"Final attempt found match at S01E{absolute_episode}", level="INFO")
                return formatted_name, 1, int(absolute_episode)
        except:
            pass

        # If everything fails, just return a basic season 1, episode X
        log_message(f"All approaches failed. Using S01E{absolute_episode} as last resort", level="WARNING")
        return f"S01E{absolute_episode:02d}", 1, int(absolute_episode)



def calculate_score(result, query, year=None):
    """
    Calculate a match score between a search result and the query.
    Higher scores indicate better matches.

    Parameters:
    result (dict): TMDB API search result
    query (str): Original search query
    year (str): Optional year to match against

    Returns:
    float: Match score between 0 and 150 (increased to accommodate better exact match bonuses)
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

    # Title matching
    exact_match_bonus = 0
    if query == title:
        score += 60
        exact_match_bonus = 25
    elif query == original_title:
        score += 45
        exact_match_bonus = 15
    elif query in title or title in query:
        score += 25
    elif query in original_title or original_title in query:
        score += 30

    # Title similarity calculation (20 points)
    title_similarity = difflib.SequenceMatcher(None, query, title).ratio() * 20
    original_title_similarity = difflib.SequenceMatcher(None, query, original_title).ratio() * 20
    score += max(title_similarity, original_title_similarity)

    # Year match scoring (20 points)
    if year and result_year:
        if result_year == str(year):
            score += 20
        elif abs(int(result_year) - int(year)) <= 1:
            score += 10

    # Language and country bonus
    popular_languages = ['en', 'es', 'fr', 'de', 'ja', 'ko', 'zh', 'hi', 'pt', 'it', 'ru']
    if result.get('original_language') in popular_languages:
        score += 2

    # Popularity bonus
    popularity = result.get('popularity', 0)
    if popularity > 100:
        score += 30 + min((popularity - 100) * 0.1, 20)
    elif popularity > 50:
        score += 25 + (popularity - 50) * 0.2
    elif popularity > 25:
        score += 20 + (popularity - 25) * 0.2
    elif popularity > 15:
        score += 15 + (popularity - 15) * 0.3
    elif popularity > 10:
        score += 10 + (popularity - 10) * 0.6
    elif popularity > 5:
        score += 5 + (popularity - 5) * 0.8
    elif popularity > 1:
        score += popularity * 1.0

    # Penalize shows with 0 votes (suspicious data quality)
    vote_count = result.get('vote_count', 0)
    if vote_count == 0:
        score -= 5

    # Apply exact match bonus
    score += exact_match_bonus

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
        response = session.get(url, params=params, timeout=10)
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
        episodes_response = session.get(episodes_url, params=episodes_params, timeout=10)
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

def process_chosen_show(chosen_show, auto_select, tmdb_id=None, season_number=None, episode_number=None, episode_match=None, is_extra=None, file=None, force_extra=None, original_query=None):
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
        original_query: The original search query for season title matching
    Returns:
        tuple: (proper_name, show_name, is_anime_genre, new_season_number, new_episode_number, tmdb_id)
    """
    # Get the original show name
    original_show_name = chosen_show.get('name')

    # Helper function to format show name for the OS
    if platform.system().lower() == 'windows' or platform.system().lower() == 'nt':
        show_name = sanitize_windows_filename(original_show_name)
    else:
        show_name = original_show_name

    first_air_date = chosen_show.get('first_air_date')
    show_year = first_air_date.split('-')[0] if first_air_date else "Unknown Year"
    tmdb_id = chosen_show.get('id') if not tmdb_id else tmdb_id

    # Get all TV show data in one optimized API call
    tv_data = get_show_data(tmdb_id)
    external_ids = tv_data.get('external_ids', {})
    is_anime_genre = tv_data.get('is_anime_genre', False)
    is_kids_content = tv_data.get('is_kids_content', False)

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

    if episode_number is not None and not is_extra:
        try:
            new_episode_number = int(episode_number)
            log_message(f"Using identified episode number: {new_episode_number}", level="DEBUG")
        except (ValueError, TypeError):
            log_message(f"Invalid episode number provided: {episode_number}", level="ERROR")
            new_episode_number = None

    if new_season_number is None and original_query:
        seasons = tv_data.get('seasons', [])
        if seasons:
            original_query_lower = original_query.lower()
            best_match_season = None
            best_similarity = 0

            for season in seasons:
                season_name = season.get('name', '')
                season_number_candidate = season.get('season_number', 0)

                # Skip Season 0 (specials) unless it's the only option
                if season_number_candidate == 0:
                    continue

                # Calculate similarity between original query and season name
                import difflib
                similarity = difflib.SequenceMatcher(None, original_query_lower, season_name.lower()).ratio()

                # Also check if the season name contains key words from the query
                query_words = set(original_query_lower.split())
                season_words = set(season_name.lower().split())
                word_overlap = len(query_words.intersection(season_words)) / len(query_words) if query_words else 0

                # Combine similarity metrics
                combined_score = (similarity * 0.7) + (word_overlap * 0.3)

                if combined_score > best_similarity and combined_score > 0.6:
                    best_similarity = combined_score
                    best_match_season = season_number_candidate

            if best_match_season:
                new_season_number = best_match_season
                log_message(f"Season title match: '{original_query}' -> Season {new_season_number} (score: {best_similarity:.2f})", level="INFO")

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

    if is_anime_genre and new_season_number is None and new_episode_number is not None:
        # If original_query is available and appears to contain season subtitle info, don't default to Season 1
        should_default_to_season_1 = True
        if original_query:
            words = original_query.split()
            has_potential_season_info = (
                len(words) > 3 or
                any(word.lower() in ['season', 'part', 'cour', 'final', 'vs', 'versus'] for word in words) or
                any(char in original_query for char in ['-', ':', '!', '?']) or
                any(word.isdigit() for word in words[-2:])
            )
            if has_potential_season_info:
                should_default_to_season_1 = False
                log_message(f"Potential season subtitle detected in '{original_query}' but season title matching failed - using AniDB-style mapping", level="INFO")

        if should_default_to_season_1:
            new_season_number = 1
            log_message(f"No season selected for anime - defaulting to Season 1 for organization", level="INFO")
            log_message(f"Note: Episode {new_episode_number} will be treated as absolute episode number", level="INFO")

    # Handle episode selection if we have a season but no episode
    if new_season_number is not None and new_episode_number is None:
        log_message(f"Season {new_season_number} selected", level="INFO")
        new_episode_number = handle_episode_selection(tmdb_id, new_season_number, auto_select, api_key)

    # Build the proper name with all available external IDs
    imdb_id = external_ids.get('imdb_id', '')
    tvdb_id = external_ids.get('tvdb_id', '')

    # Build proper name with all available IDs (for Sonarr naming compatibility)
    id_parts = []
    if imdb_id:
        id_parts.append(f"{{imdb-{imdb_id}}}")
    if tvdb_id:
        id_parts.append(f"{{tvdb-{tvdb_id}}}")
    # Always include TMDB ID
    id_parts.append(f"{{tmdb-{tmdb_id}}}")

    # Combine all IDs
    id_string = " ".join(id_parts)
    proper_name = f"{show_name} ({show_year}) {id_string}"
    imdb_id = external_ids.get('imdb_id', '')
    tvdb_id = external_ids.get('tvdb_id', '')

    return proper_name, show_name, is_anime_genre, new_season_number, new_episode_number, tmdb_id, is_kids_content, imdb_id, tvdb_id

def has_family_content_indicators(details_data, keywords_data, media_type):
    """Check if content has family-related genres, keywords, or other indicators."""

    # Family-related genre IDs from TMDB
    family_genre_ids = [
        10751,  # Family
        16,     # Animation
    ]

    # Check genres
    genres = details_data.get('genres', [])

    # Check if it has explicit Family genre (10751)
    has_family_genre = any(genre.get('id') == 10751 for genre in genres)
    if has_family_genre:
        return True

    # For Animation genre, check if it's anime - if so, don't auto-classify as family
    has_animation_genre = any(genre.get('id') == 16 for genre in genres)
    if has_animation_genre:
        language = details_data.get('original_language', '')
        is_anime = check_anime_genre(genres, language)
        if not is_anime:  # Only non-anime animation gets family treatment
            return True

    # Kids-specific keywords
    kids_keywords = [
        'children', 'kids', 'child', 'children\'s film', 'children\'s movie',
        'children\'s television', 'kids show', 'preschool', 'educational',
        'disney', 'pixar', 'dreamworks', 'nickelodeon', 'cartoon network',
        'talking animals', 'fairy tale', 'bedtime story', 'nursery rhyme'
    ]

    # Check keywords
    if media_type == 'movie':
        keywords_list = keywords_data.get('keywords', [])
    else:
        keywords_list = keywords_data.get('results', [])

    for keyword in keywords_list:
        keyword_name = keyword.get('name', '').lower()
        for kids_keyword in kids_keywords:
            if kids_keyword in keyword_name:
                return True

    # Check if it's an animated movie/show
    for genre in genres:
        if genre.get('id') == 16:
            title = details_data.get('title' if media_type == 'movie' else 'name', '').lower()
            overview = details_data.get('overview', '').lower()

            family_title_indicators = ['kids', 'children', 'family', 'junior', 'little', 'baby']
            for indicator in family_title_indicators:
                if indicator in title or indicator in overview:
                    return True

    return False

def is_family_friendly_rating(rating):
    """Determine if a content rating is suitable for kids/family viewing."""
    if not rating:
        return False

    rating = rating.upper().strip()

    # US Movie ratings that could be family-friendly
    family_movie_ratings = ['G', 'PG']

    # US TV ratings that are reliable for kids content
    family_tv_ratings = ['TV-Y', 'TV-Y7', 'TV-Y7-FV', 'TV-G', 'TV-PG']

    # UK ratings that could be family-friendly
    uk_family_ratings = ['U', 'PG']

    # Other international family-friendly ratings
    other_family_ratings = ['0+', '6+', 'ALL', 'GENERAL', 'FAMILY']

    all_family_ratings = family_movie_ratings + family_tv_ratings + uk_family_ratings + other_family_ratings

    return rating in all_family_ratings