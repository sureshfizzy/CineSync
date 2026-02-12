import os
import platform
import re
import requests
import urllib.parse
import logging
import unicodedata
import threading
from bs4 import BeautifulSoup
from functools import lru_cache
from MediaHub.utils.logging_utils import log_message
from MediaHub.config.config import is_imdb_folder_id_enabled, is_tvdb_folder_id_enabled, is_tmdb_folder_id_enabled, is_jellyfin_id_format_enabled, tmdb_api_language
from MediaHub.utils.file_utils import clean_query, normalize_query, standardize_title, remove_genre_names, extract_title, sanitize_windows_filename
from MediaHub.api.tmdb_api_helpers import *
from MediaHub.api.api_utils import api_retry
from MediaHub.api.api_key_manager import get_api_key, check_api_key
from MediaHub.api.language_iso_codes import get_iso_code
from MediaHub.api.media_cover import process_tmdb_covers
from MediaHub.utils.file_utils import normalize_unicode_characters

# Thread-safe caches
_api_cache = {}
_cache_lock = threading.RLock()

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

# Thread-safe request cache to avoid duplicate API calls within the same session
_request_cache = {}
_request_cache_lock = threading.RLock()

def sanitize_url_for_logging(url):
    """Remove API key from URL for safe logging"""
    if 'api_key=' in url:
        return re.sub(r'api_key=[^&]*', 'api_key=***HIDDEN***', url)
    return url

def cached_get(url, params=None, timeout=10):
    """Thread-safe cached GET request to avoid duplicate API calls"""
    cache_key = f"{url}?{urllib.parse.urlencode(params or {})}"

    with _request_cache_lock:
        if cache_key in _request_cache:
            return _request_cache[cache_key]

    response = session.get(url, params=params, timeout=timeout)

    with _request_cache_lock:
        _request_cache[cache_key] = response

    return response

def get_cached_result(cache_key):
    """Thread-safe cache retrieval"""
    with _cache_lock:
        return _api_cache.get(cache_key)

def set_cached_result(cache_key, result):
    """Thread-safe cache storage"""
    with _cache_lock:
        _api_cache[cache_key] = result

def remove_country_suffix(query):
    """
    Remove country/region suffixes from a query string.
    Examples:
    - "Riverdale US" -> "Riverdale"
    - "Riverdale (US)" -> "Riverdale"
    - "The Office UK" -> "The Office"
    - "Shameless (CA)" -> "Shameless"

    But preserve legitimate title parts like:
    - "A P BIO" -> "A P BIO" (not "A P")
    - "CSI NYC" -> "CSI NYC" (not "CSI")
    """
    query = re.sub(r'\s*\([^)]*\)$', '', query)
    common_country_codes = ['US', 'UK', 'CA', 'AU', 'NZ', 'DE', 'FR', 'IT', 'ES', 'JP', 'KR', 'CN']

    country_pattern = r'\s+(' + '|'.join(common_country_codes) + r')$'
    query = re.sub(country_pattern, '', query, flags=re.IGNORECASE)

    return query.strip()

@lru_cache(maxsize=None)
@api_retry(max_retries=3, base_delay=5, max_delay=60)
def search_tv_show(query, year=None, auto_select=False, actual_dir=None, file=None, root=None, episode_match=None, tmdb_id=None, imdb_id=None, tvdb_id=None, season=None, is_extra=None, season_number=None, episode_number=None, force_extra=None, manual_search=False, anime_priority=False):
    global api_key
    if not check_api_key():
        log_message("API key is missing or invalid. Cannot proceed with search.", level="ERROR")
        return None

    # Handle direct ID searches first
    if tmdb_id or imdb_id or tvdb_id:
        proper_name = None
        show_name = None
        is_anime_genre = False

        try:
            if tmdb_id:
                log_message(f"Using provided TMDB ID: {tmdb_id}", level="INFO")
                url = f"https://api.themoviedb.org/3/tv/{tmdb_id}"
                params = {'api_key': api_key, 'language': language_iso}
                response = cached_get(url, params=params)
                response.raise_for_status()
                show_data = response.json()
                process_tmdb_covers(tmdb_id, show_data)

            elif imdb_id or tvdb_id:
                external_id_type = 'imdb_id' if imdb_id else 'tvdb_id'
                external_id = imdb_id if imdb_id else str(tvdb_id)
                url = f"https://api.themoviedb.org/3/find/{external_id}"
                params = {
                    'api_key': api_key,
                    'external_source': 'imdb_id' if imdb_id else 'tvdb_id',
                    'language': language_iso
                }
                response = cached_get(url, params=params)
                response.raise_for_status()
                results = response.json().get('tv_results', [])

                if not results:
                    log_message(f"No show found for {external_id_type}: {external_id}", level="WARNING")
                    return query

                show_data = results[0]
                tmdb_id = show_data['id']

                # Get full show details
                url = f"https://api.themoviedb.org/3/tv/{tmdb_id}"
                params = {'api_key': api_key, 'language': language_iso}
                response = cached_get(url, params=params)
                response.raise_for_status()
                show_data = response.json()
                process_tmdb_covers(tmdb_id, show_data)

            # Process show data with the potentially updated season/episode info
            if show_data:
                # Check if season/episode info is available
                if season_number is not None and episode_number is not None:
                    log_message(f"Show found by ID with season/episode info: S{season_number}E{episode_number}", level="INFO")
                else:
                    log_message("Show found by ID but missing season/episode info. Attempting to extract...", level="INFO")

                show_name = show_data['name']
                first_air_date = show_data.get('first_air_date', '')
                show_year = first_air_date.split('-')[0] if first_air_date else "Unknown Year"

                # Get external IDs for the show
                external_ids = get_external_ids(tmdb_id, 'tv')
                genre_info = get_show_genres(tmdb_id)
                is_anime_genre = genre_info['is_anime_genre']
                proper_name = f"{show_name} ({show_year})"

                log_message(f"Successfully retrieved show data using ID: {proper_name}", level="INFO")

                return process_chosen_show(show_data, auto_select, tmdb_id, season_number, episode_number, episode_match, is_extra, file, force_extra, query)

        except requests.exceptions.RequestException as e:
            log_message(f"Error fetching show data: {e}", level="ERROR")
            log_message(f"Falling back to search due to API error", level="INFO")

            return proper_name, show_name, is_anime_genre

    cache_key = (query, year)
    cached_result = get_cached_result(cache_key)
    if cached_result is not None:
        return cached_result

    url = "https://api.themoviedb.org/3/search/tv"

    def fetch_results(query, year=None):
        if isinstance(query, tuple):
            query = query[0] if query else ""

        params = {'api_key': api_key, 'query': query, 'language': language_iso}
        if year:
            params['first_air_date_year'] = year

        full_url = f"{url}?{urllib.parse.urlencode(params)}"
        search_type = "with year" if year else "without year"
        log_message(f"Primary search URL ({search_type}): {sanitize_url_for_logging(full_url)}", "DEBUG", "stdout")
        response = perform_search(params, url, anime_priority=anime_priority)

        if response:
            scored_results = []
            for result in response:
                score = calculate_score(result, query, year, anime_priority=anime_priority)
                if score >= 40:
                    scored_results.append((score, result))

            scored_results.sort(reverse=True, key=lambda x: x[0])

            if scored_results and year:
                best_score = scored_results[0][0]
                if best_score < 75:
                    params_no_year = {'api_key': api_key, 'query': query, 'language': language_iso}
                    response_no_year = perform_search(params_no_year, url, anime_priority=anime_priority)

                    if response_no_year:
                        scored_results_no_year = []
                        for result in response_no_year:
                            score = calculate_score(result, query, year, anime_priority=anime_priority)
                            if score >= 40:
                                scored_results_no_year.append((score, result))

                        scored_results_no_year.sort(reverse=True, key=lambda x: x[0])

                        if scored_results_no_year and scored_results_no_year[0][0] > best_score + 10:
                            log_message(f"No-year search found better match (score: {scored_results_no_year[0][0]:.1f} vs {best_score:.1f})", "DEBUG", "stdout")
                            return [r[1] for r in scored_results_no_year]

            if scored_results:
                # Check if we should try fallback even with results if scores are low
                best_score = scored_results[0][0]
                if best_score < 60:
                    fallback_query = remove_country_suffix(query)
                    if fallback_query != query:
                        params_fallback = {'api_key': api_key, 'query': fallback_query, 'language': language_iso}
                        if year:
                            params_fallback['first_air_date_year'] = year

                        response_fallback = perform_search(params_fallback, url, anime_priority=anime_priority)
                        if response_fallback:
                            scored_results_fallback = []
                            for result in response_fallback:
                                score = calculate_score(result, fallback_query, year, anime_priority=anime_priority)
                                if score >= 40:
                                    scored_results_fallback.append((score, result))

                            scored_results_fallback.sort(reverse=True, key=lambda x: x[0])
                            if scored_results_fallback and scored_results_fallback[0][0] > best_score + 15:
                                log_message(f"Fallback search found better match (score: {scored_results_fallback[0][0]:.1f} vs {best_score:.1f})", "DEBUG", "stdout")
                                return [r[1] for r in scored_results_fallback]

                return [r[1] for r in scored_results]


        if not response and year:
            log_message("No results found with year, retrying without year.", "DEBUG", "stdout")
            params = {'api_key': api_key, 'query': query, 'language': language_iso}
            full_url = f"{url}?{urllib.parse.urlencode(params)}"
            log_message(f"Fallback search URL (no year): {sanitize_url_for_logging(full_url)}", "DEBUG", "stdout")
            response = perform_search(params, url, anime_priority=anime_priority)

            if response:
                scored_results = []
                for result in response:
                    score = calculate_score(result, query, year, anime_priority=anime_priority)
                    if score >= 40:
                        scored_results.append((score, result))

                scored_results.sort(reverse=True, key=lambda x: x[0])
                if scored_results:
                    return [r[1] for r in scored_results]

        # Fallback: Try removing country/region suffixes
        fallback_query = remove_country_suffix(query)

        if fallback_query != query:
            log_message(f"Trying fallback search with query: '{fallback_query}'", "DEBUG", "stdout")
            params = {'api_key': api_key, 'query': fallback_query, 'language': language_iso}
            if year:
                params['first_air_date_year'] = year

            full_url = f"{url}?{urllib.parse.urlencode(params)}"
            log_message(f"Fallback search URL: {sanitize_url_for_logging(full_url)}", "DEBUG", "stdout")
            response = perform_search(params, url, anime_priority=anime_priority)

            if response:
                scored_results = []
                for result in response:
                    score = calculate_score(result, fallback_query, year, anime_priority=anime_priority)
                    if score >= 40:
                        scored_results.append((score, result))

                scored_results.sort(reverse=True, key=lambda x: x[0])
                if scored_results:
                    return [r[1] for r in scored_results]

        return response

    def display_results(results, start_idx=0):
        for idx, show in enumerate(results[start_idx:start_idx + 3], start=start_idx + 1):
            show_name = show.get('name')
            show_id = show.get('id')
            first_air_date = show.get('first_air_date')
            show_year = first_air_date.split('-')[0] if first_air_date else "Unknown Year"
            log_message(f"{idx}: {show_name} ({show_year}) [tmdb-{show_id}]", level="INFO")

    results = fetch_results(query, year)

    # Try and/& substitution if no results
    if not results and (' and ' in query.lower() or ' & ' in query):
        and_query = query.replace(' and ', ' & ') if ' and ' in query.lower() else query.replace(' & ', ' and ')
        results = fetch_results(and_query, year)

    if not results and episode_match and file:
        log_message(f"Primary search failed, attempting with cleaned query from filename", "DEBUG", "stdout")
        cleaned_result = clean_query(file)
        cleaned_title = cleaned_result.get('title', '')
        results = fetch_results(cleaned_title, year)

    # AKA fallback: Try alternative title if available
    if not results and (file or root):
        log_message("Primary search failed. Attempting search with alternative title (AKA).", "DEBUG", "stdout")

        alternative_title = None
        if root:
            root_name = os.path.basename(root)
            root_result = clean_query(root_name)
            alternative_title = root_result.get('alternative_title')

        # If no alternative title from root, try the file
        if not alternative_title and file:
            file_result = clean_query(file)
            alternative_title = file_result.get('alternative_title')

        if alternative_title:
            log_message(f"Trying alternative title: '{alternative_title}'", "DEBUG", "stdout")
            results = fetch_results(alternative_title, year)
        else:
            log_message("No alternative title found for AKA fallback.", "DEBUG", "stdout")

    # Directory-based fallback
    if not results and actual_dir and root:
        dir_based_query = os.path.basename(root)
        cleaned_dir_result = clean_query(dir_based_query)
        cleaned_dir_query = cleaned_dir_result.get('title', '')
        dir_year = cleaned_dir_result.get('year')
        log_message(f"Directory fallback: searching with cleaned directory name: '{cleaned_dir_query}' (raw: '{dir_based_query}')", "DEBUG", "stdout")
        results = fetch_results(cleaned_dir_query, year or dir_year)

    if not results:
        log_message(f"No results found for query '{query}' with year '{year}'.", level="WARNING")

        # Manual search option when no results found - use general search
        if manual_search and not auto_select:
            return search_manual_general(query, year, auto_select, actual_dir, file, root, episode_match, season_number, episode_number, is_extra, force_extra)
        else:
            set_cached_result(cache_key, f"{query}")
            return f"{query}"

    if auto_select:
        chosen_show = results[0]
        result = process_chosen_show(chosen_show, auto_select, tmdb_id, season_number, episode_number, episode_match, is_extra, file, force_extra, query)
        if isinstance(query, tuple):
            query_str = query[0] if query else ""
        else:
            query_str = str(query)

        cache_key_str = f"{query_str}_{year}"
        set_cached_result(cache_key_str, (tmdb_id, season_number, episode_number))

        return result
    else:
        current_query = query
        while True:
            log_message(f"Multiple shows found for query '{current_query}':", level="INFO")
            display_results(results)

            log_message("Options:", level="INFO")
            log_message("- Enter 1-3 to select a show", level="INFO")
            log_message("- Enter a search term for a new search", level="INFO")

            choice = input("Enter your choice: ").strip()

            if choice.lower() in ['1', '2', '3']:
                chosen_show = results[int(choice) - 1]
                result = process_chosen_show(chosen_show, auto_select, tmdb_id, season_number, episode_number, episode_match, is_extra, file, force_extra, query)
                set_cached_result(cache_key, result)
                return result
            elif choice.strip():
                current_query = choice.strip()
                new_results = fetch_results(current_query, year)
                if new_results:
                    results = new_results
                    continue
                else:
                    log_message(f"No results found for '{current_query}'", level="WARNING")
                    continue
            else:
                chosen_show = results[0]
                result = process_chosen_show(chosen_show, auto_select, tmdb_id, season_number, episode_number, episode_match, is_extra, file, force_extra, query)
                if isinstance(query, tuple):
                    query_str = query[0] if query else ""
                else:
                    query_str = str(query)

                cache_key_str = f"{query_str}_{year}"
                set_cached_result(cache_key_str, (tmdb_id, season_number, episode_number))

                return result

    log_message(f"No valid selection made for query '{query}', skipping.", level="WARNING")
    set_cached_result(cache_key, f"{query}")
    return f"{query}"

def perform_search(params, url, anime_priority=False):
    try:
        query = params['query']
        year = params.get('first_air_date_year') or params.get('primary_release_year')
        if isinstance(query, tuple):
            query = query[0]

        query = normalize_unicode_characters(query)
        query = query.lower()

        params['query'] = query

        # Use session for connection pooling with optimized timeout
        response = session.get(url, params=params, timeout=3)
        response.raise_for_status()
        results = response.json().get('results', [])

        if not results:
            return []

        # Optimized scoring with early filtering
        MIN_SCORE_THRESHOLD = 40
        scored_results = []

        for result in results:
            score = calculate_score(result, query, year, anime_priority=anime_priority)
            if score >= MIN_SCORE_THRESHOLD:
                scored_results.append((score, result))

        # Sort only the filtered results
        scored_results.sort(reverse=True, key=lambda x: x[0])

        if scored_results:
            return [r[1] for r in scored_results]

        # If no results meet threshold, return top 3 results
        all_scored = [(calculate_score(result, query, year, anime_priority=anime_priority), result) for result in results[:3]]
        all_scored.sort(reverse=True, key=lambda x: x[0])
        return [r[1] for r in all_scored]

    except requests.exceptions.RequestException as e:
        log_message(f"Error fetching data: {e}", level="ERROR")
        return []

@lru_cache(maxsize=None)
@api_retry(max_retries=3, base_delay=5, max_delay=60)
def search_movie(query, year=None, auto_select=False, actual_dir=None, file=None, tmdb_id=None, imdb_id=None, root=None, manual_search=False):
    global api_key
    if not check_api_key():
        log_message("API key is missing or invalid. Cannot proceed with search.", level="ERROR")
        return None

    # Helper function to format movie name for the OS
    def format_movie_name(name):
        if platform.system().lower() == 'windows' or platform.system().lower() == 'nt':
            return sanitize_windows_filename(name)
        return name

    # Handle direct ID searches first
    if tmdb_id or imdb_id:
        try:
            if tmdb_id:
                log_message(f"Using provided TMDB ID: {tmdb_id}", level="INFO")
                url = f"https://api.themoviedb.org/3/movie/{tmdb_id}"
                params = {'api_key': api_key, 'language': language_iso}
                response = session.get(url, params=params, timeout=10)
                response.raise_for_status()
                movie_data = response.json()

            elif imdb_id:
                url = f"https://api.themoviedb.org/3/find/{imdb_id}"
                params = {
                    'api_key': api_key,
                    'external_source': 'imdb_id',
                    'language': language_iso
                }
                response = session.get(url, params=params, timeout=10)
                response.raise_for_status()
                results = response.json().get('movie_results', [])

                if not results:
                    log_message(f"No movie found for IMDb ID: {imdb_id}", level="WARNING")
                    return None

                movie_data = results[0]
                tmdb_id = movie_data['id']

                # Get full movie details
                url = f"https://api.themoviedb.org/3/movie/{tmdb_id}"
                params = {'api_key': api_key, 'language': language_iso}
                response = session.get(url, params=params, timeout=10)
                response.raise_for_status()
                movie_data = response.json()
                process_tmdb_covers(tmdb_id, movie_data)

            # Process movie data
            production_countries = [
                country.get('iso_3166_1')
                for country in movie_data.get('production_countries', [])
                if country.get('iso_3166_1')
            ]
            chosen_name = select_title_by_origin(
                movie_data.get('title'),
                movie_data.get('original_title'),
                production_countries
            )
            movie_name = format_movie_name(chosen_name)
            release_date = movie_data.get('release_date', '')
            movie_year = release_date.split('-')[0] if release_date else "Unknown Year"

            # Get external IDs for the movie
            external_ids = get_external_ids(tmdb_id, 'movie')
            imdb_id = external_ids.get('imdb_id', '')
            genre_info = get_movie_genres(tmdb_id)
            is_anime_genre = genre_info['is_anime_genre']

            if is_imdb_folder_id_enabled():
                if is_jellyfin_id_format_enabled():
                    proper_name = f"{movie_name} ({movie_year}) [imdbid-{imdb_id}]"
                else:
                    proper_name = f"{movie_name} ({movie_year}) {{imdb-{imdb_id}}}"
            elif is_tmdb_folder_id_enabled():
                if is_jellyfin_id_format_enabled():
                    proper_name = f"{movie_name} ({movie_year}) [tmdbid-{tmdb_id}]"
                else:
                    proper_name = f"{movie_name} ({movie_year}) {{tmdb-{tmdb_id}}}"
            else:
                proper_name = f"{movie_name} ({movie_year})"

            log_message(f"Successfully retrieved movie data using ID: {proper_name}", level="INFO")
            return tmdb_id, imdb_id, movie_name, movie_year, is_anime_genre

        except requests.exceptions.RequestException as e:
            log_message(f"TMDB details fetch by ID failed - Network error: {e}", level="ERROR")
            log_message(f"Falling back to search due to API error", level="INFO")

    cache_key = (query, year, language_iso)
    cached_result = get_cached_result(cache_key)
    if cached_result is not None:
        if cached_result == query:
            log_message(f"Previous API lookup for '{query}' failed. Attempting again.", level="INFO")
        else:
            return cached_result

    url = "https://api.themoviedb.org/3/search/movie"

    def fetch_results(query, year=None):
        params = {'api_key': api_key, 'query': query, 'language': language_iso}
        if year:
            params['primary_release_year'] = year

        full_url = f"{url}?{urllib.parse.urlencode(params)}"
        log_message(f"Fetching results from URL: {sanitize_url_for_logging(full_url)}", "DEBUG", "stdout")
        response = perform_search(params, url)

        # Check if we should try adjacent years when scores are low
        if response and year:
            scored_results = []
            for result in response:
                score = calculate_score(result, query, year)
                if score >= 40:
                    scored_results.append((score, result))

            if scored_results:
                best_score = max(scored_results, key=lambda x: x[0])[0]
                if best_score < 60:

                    params_plus = params.copy()
                    params_plus['primary_release_year'] = int(year) + 1
                    response_plus = perform_search(params_plus, url)

                    params_minus = params.copy()
                    params_minus['primary_release_year'] = int(year) - 1
                    response_minus = perform_search(params_minus, url)

                    all_results = response[:]
                    if response_plus:
                        all_results.extend(response_plus)
                    if response_minus:
                        all_results.extend(response_minus)

                    # Remove duplicates based on TMDB ID
                    seen_ids = set()
                    unique_results = []
                    for result in all_results:
                        tmdb_id = result.get('id')
                        if tmdb_id not in seen_ids:
                            seen_ids.add(tmdb_id)
                            unique_results.append(result)

                    # Score all unique results
                    all_scored = []
                    for result in unique_results:
                        score = calculate_score(result, query, year)
                        if score >= 40:
                            all_scored.append((score, result))

                    if all_scored:
                        all_scored.sort(reverse=True, key=lambda x: x[0])
                        new_best_score = all_scored[0][0]
                        if new_best_score > best_score + 10:
                            log_message(f"Adjacent year search found better match (score: {new_best_score:.1f} vs {best_score:.1f})", "DEBUG", "stdout")
                            return [r[1] for r in all_scored]

                # Try character variations if still low score
                if best_score < 50:
                    log_message(f"Score still low ({best_score:.1f}), trying character variations", "DEBUG", "stdout")

                    # Generate character variations
                    variations = []
                    if ' ' in query:
                        variations.append(query.replace(' ', '/'))
                        variations.append(query.replace(' ', '-'))
                        variations.append(query.replace(' ', ''))
                    if '/' in query:
                        variations.append(query.replace('/', ' '))
                        variations.append(query.replace('/', '-'))
                    if '-' in query:
                        variations.append(query.replace('-', ' '))
                        variations.append(query.replace('-', '/'))

                    # Test each variation
                    for variation in variations:
                        if variation != query:
                            params_var = params.copy()
                            params_var['query'] = variation
                            response_var = perform_search(params_var, url)

                            if response_var:
                                var_scored = []
                                for result in response_var:
                                    score = calculate_score(result, variation, year)
                                    if score >= 40:
                                        var_scored.append((score, result))

                                if var_scored:
                                    var_best_score = max(var_scored, key=lambda x: x[0])[0]
                                    if var_best_score > best_score + 15:
                                        log_message(f"Character variation '{variation}' found better match (score: {var_best_score:.1f} vs {best_score:.1f})", "DEBUG", "stdout")
                                        var_scored.sort(reverse=True, key=lambda x: x[0])
                                        return [r[1] for r in var_scored]

        if not response and year:
            log_message("No results found with year, retrying without year.", "DEBUG", "stdout")
            del params['primary_release_year']
            response = perform_search(params, url)

        return response

    results = fetch_results(query, year)

    # Try and/& substitution if no results
    if not results and (' and ' in query.lower() or ' & ' in query):
        and_query = query.replace(' and ', ' & ') if ' and ' in query.lower() else query.replace(' & ', ' and ')
        results = fetch_results(and_query, year)

    if not results and file:
        log_message("Primary search failed. Attempting search with cleaned movie name from filename.", "DEBUG", "stdout")
        cleaned_result = clean_query(file)
        cleaned_title = cleaned_result.get('title', '')
        results = fetch_results(cleaned_title, year)

        # AKA fallback: Try alternative title if available
        if not results:
            alternative_title = cleaned_result.get('alternative_title')

            if not alternative_title and root:
                root_name = os.path.basename(root)
                root_result = clean_query(root_name)
                alternative_title = root_result.get('alternative_title')

            if alternative_title:
                log_message(f"Trying alternative title: '{alternative_title}'", "DEBUG", "stdout")
                results = fetch_results(alternative_title, year)
            else:
                log_message("No alternative title found for AKA fallback.", "DEBUG", "stdout")

    # Directory-based fallback
    if not results and actual_dir and root:
        dir_based_query = os.path.basename(root)
        cleaned_dir_result = clean_query(dir_based_query)
        cleaned_dir_query = cleaned_dir_result.get('title', '')
        dir_year = cleaned_dir_result.get('year')
        log_message(f"Directory fallback: searching with cleaned directory name: '{cleaned_dir_query}' (raw: '{dir_based_query}')", "DEBUG", "stdout")
        results = fetch_results(cleaned_dir_query, year or dir_year)

    if not results:
        log_message(f"No results found for query '{query}' with year '{year}'.", "WARNING", "stdout")

        # Manual search option when no results found - use general search
        if manual_search and not auto_select:
            manual_result = search_manual_general(query, year, auto_select, actual_dir, file, root)
            if isinstance(manual_result, dict) and manual_result.get('redirect_to_movie'):
                chosen_movie = manual_result.get('movie_data')
                if chosen_movie:
                    movie_data = get_movie_data(chosen_movie.get('id'))
                    production_countries = movie_data.get('production_countries', []) if movie_data else []
                    chosen_name = select_title_by_origin(
                        chosen_movie.get('title'),
                        movie_data.get('original_title') if movie_data else None,
                        production_countries
                    )
                    movie_name = format_movie_name(chosen_name)
                    release_date = chosen_movie.get('release_date')
                    movie_year = release_date.split('-')[0] if release_date else "Unknown Year"
                    tmdb_id = chosen_movie.get('id')

                    movie_data = movie_data or get_movie_data(tmdb_id)
                    imdb_id = movie_data.get('imdb_id', '')
                    is_anime_genre = movie_data.get('is_anime_genre', False)
                    is_kids_content = movie_data.get('is_kids_content', False)
                    original_language = movie_data.get('original_language')
                    overview = movie_data.get('overview', '')
                    runtime = movie_data.get('runtime', 0)
                    original_title = movie_data.get('original_title', '')
                    status = movie_data.get('status', '')
                    release_date = movie_data.get('release_date', '')
                    genres = movie_data.get('genres', '[]')
                    certification = movie_data.get('certification', '')

                    set_cached_result(cache_key, (tmdb_id, imdb_id, movie_name, movie_year, is_anime_genre, is_kids_content, original_language, overview, runtime, original_title, status, release_date, genres, certification))
                    return tmdb_id, imdb_id, movie_name, movie_year, is_anime_genre, is_kids_content, original_language, overview, runtime, original_title, status, release_date, genres, certification
            return manual_result
        else:
            set_cached_result(cache_key, f"{query}")
            return f"{query}"

    if auto_select:
        chosen_movie = results[0]
    else:
        current_query = query
        while True:
            log_message(f"Multiple movies found for query '{current_query}':", level="INFO")
            display_results(results)
            log_message("Options:", level="INFO")
            log_message("- Enter 1-3 to select a movie", level="INFO")
            log_message("- Enter a search term for a new search", level="INFO")

            choice = input("Enter your choice: ").strip()

            if choice.lower() in ['1', '2', '3']:
                chosen_movie = results[int(choice) - 1]
                break
            elif choice.strip():
                current_query = choice.strip()
                log_message(f"Searching for new query: '{current_query}'", "DEBUG", "stdout")
                new_results = fetch_results(current_query)
                if not new_results and year:
                    new_results = fetch_results(current_query, year)

                if new_results:
                    results = new_results
                    continue
                else:
                    log_message(f"No results found for '{current_query}'", level="WARNING")
                    continue
            else:
                chosen_movie = results[0]
                break

    if chosen_movie:
        movie_data = get_movie_data(chosen_movie.get('id'))
        production_countries = movie_data.get('production_countries', []) if movie_data else []
        chosen_name = select_title_by_origin(
            chosen_movie.get('title'),
            movie_data.get('original_title') if movie_data else chosen_movie.get('original_title'),
            production_countries
        )
        movie_name = format_movie_name(chosen_name)
        release_date = chosen_movie.get('release_date')
        movie_year = release_date.split('-')[0] if release_date else "Unknown Year"
        tmdb_id = chosen_movie.get('id')
        process_tmdb_covers(tmdb_id, chosen_movie)

        movie_data = movie_data or get_movie_data(tmdb_id)
        imdb_id = movie_data.get('imdb_id', '')
        is_anime_genre = movie_data.get('is_anime_genre', False)
        is_kids_content = movie_data.get('is_kids_content', False)
        original_language = movie_data.get('original_language')
        overview = movie_data.get('overview', '')
        runtime = movie_data.get('runtime', 0)
        original_title = movie_data.get('original_title', '')
        status = movie_data.get('status', '')
        release_date = movie_data.get('release_date', '')
        genres = movie_data.get('genres', '[]')
        certification = movie_data.get('certification', '')

        if is_imdb_folder_id_enabled():
            if is_jellyfin_id_format_enabled():
                proper_name = f"{movie_name} ({movie_year}) [imdbid-{imdb_id}]"
            else:
                proper_name = f"{movie_name} ({movie_year}) {{imdb-{imdb_id}}}"
        elif is_tmdb_folder_id_enabled():
            if is_jellyfin_id_format_enabled():
                proper_name = f"{movie_name} ({movie_year}) [tmdbid-{tmdb_id}]"
            else:
                proper_name = f"{movie_name} ({movie_year}) {{tmdb-{tmdb_id}}}"
        else:
            proper_name = f"{movie_name} ({movie_year})"

        set_cached_result(cache_key, (tmdb_id, imdb_id, movie_name, movie_year, is_anime_genre, is_kids_content, original_language, overview, runtime, original_title, status, release_date, genres, certification))
        return tmdb_id, imdb_id, movie_name, movie_year, is_anime_genre, is_kids_content, original_language, overview, runtime, original_title, status, release_date, genres, certification

    log_message(f"No valid movie selected or found for query '{query}'.", "WARNING", "stdout")
    set_cached_result(cache_key, f"{query}")
    return f"{query}"

def display_results(results, start_idx=0):
    for idx, movie in enumerate(results[start_idx:start_idx + 3], start=start_idx + 1):
        movie_name = movie.get('title')
        movie_id = movie.get('id')
        release_date = movie.get('release_date')
        movie_year = release_date.split('-')[0] if release_date else "Unknown Year"
        log_message(f"{idx}: {movie_name} ({movie_year}) [tmdb-{movie_id}]", level="INFO")

def search_manual_general(query, year=None, auto_select=False, actual_dir=None, file=None, root=None, episode_match=None, season_number=None, episode_number=None, is_extra=None, force_extra=None):
    """
    Special function for manual search that searches both movies and TV shows separately
    and combines the results, letting the user choose the media type.
    """
    global api_key
    if not check_api_key():
        log_message("API key is missing or invalid. Cannot proceed with search.", level="ERROR")
        return None

    def fetch_general_results(query, search_year=None):
        if isinstance(query, tuple):
            query = query[0] if query else ""

        combined_results = []

        movie_url = "https://api.themoviedb.org/3/search/movie"
        movie_params = {'api_key': api_key, 'query': query, 'language': language_iso}

        log_message(f"Manual movie search URL: {sanitize_url_for_logging(f'{movie_url}?{urllib.parse.urlencode(movie_params)}')}", "DEBUG", "stdout")
        movie_response = perform_search(movie_params, movie_url)

        if movie_response:
            for result in movie_response:
                score = calculate_score(result, query, None)
                if score >= 30:
                    result['media_type'] = 'movie'
                    combined_results.append((score, result))

        tv_url = "https://api.themoviedb.org/3/search/tv"
        tv_params = {'api_key': api_key, 'query': query, 'language': language_iso}

        log_message(f"Manual TV search URL: {sanitize_url_for_logging(f'{tv_url}?{urllib.parse.urlencode(tv_params)}')}", "DEBUG", "stdout")
        tv_response = perform_search(tv_params, tv_url)

        if tv_response:
            for result in tv_response:
                score = calculate_score(result, query, None)
                if score >= 30:
                    result['media_type'] = 'tv'
                    combined_results.append((score, result))

        combined_results.sort(reverse=True, key=lambda x: x[0])
        return [r[1] for r in combined_results]

    def display_mixed_results(results, start_idx=0):
        for idx, item in enumerate(results[start_idx:start_idx + 3], start=start_idx + 1):
            media_type = item.get('media_type', 'unknown')
            if media_type == 'tv':
                name = item.get('name', 'Unknown')
                first_air_date = item.get('first_air_date', '')
                year_str = first_air_date.split('-')[0] if first_air_date else "Unknown Year"
                log_message(f"{idx}: {name} ({year_str}) [TV Show - tmdb-{item.get('id')}]", level="INFO")
            elif media_type == 'movie':
                name = item.get('title', 'Unknown')
                release_date = item.get('release_date', '')
                year_str = release_date.split('-')[0] if release_date else "Unknown Year"
                log_message(f"{idx}: {name} ({year_str}) [Movie - tmdb-{item.get('id')}]", level="INFO")

    while True:
        log_message("Manual search enabled. You can enter a custom search term.", level="INFO")
        log_message("Options:", level="INFO")
        log_message("- Enter a custom search term to search TMDB", level="INFO")
        log_message("- Press Enter to skip this file", level="INFO")

        choice = input("Enter your search term (or press Enter to skip): ").strip()

        if not choice:
            log_message("Skipping file due to no manual search term provided.", level="INFO")
            return f"{query}"

        log_message(f"Searching TMDB for: '{choice}'", level="INFO")
        results = fetch_general_results(choice)

        if not results:
            log_message(f"No results found for '{choice}'. Try a different search term.", level="WARNING")
            continue

        current_choice = choice  # Track the current search term for logging
        while True:
            log_message(f"Multiple results found for query '{current_choice}':", level="INFO")
            display_mixed_results(results)

            log_message("Options:", level="INFO")
            log_message("- Enter 1-3 to select an item", level="INFO")
            log_message("- Enter a search term for a new search", level="INFO")
            log_message("- Press Enter to use first result", level="INFO")

            selection = input("Enter your choice: ").strip()

            if selection.lower() in ['1', '2', '3']:
                chosen_item = results[int(selection) - 1]
                media_type = chosen_item.get('media_type')

                if media_type == 'tv':
                    from MediaHub.api.tmdb_api_helpers import process_chosen_show
                    return process_chosen_show(chosen_item, auto_select, chosen_item.get('id'), season_number, episode_number, episode_match, is_extra, file, force_extra, query)
                else:
                    log_message(f"Movie selected during manual search. Redirecting to movie processor.", level="INFO")
                    return {'redirect_to_movie': True, 'movie_data': chosen_item}

            elif selection.strip():
                current_choice = selection.strip()  # Update the current search term for logging
                log_message(f"Searching TMDB for: '{current_choice}'", level="INFO")
                results = fetch_general_results(current_choice)

                if not results:
                    log_message(f"No results found for '{current_choice}'. Try a different search term.", level="WARNING")
                    break
                continue
            else:
                chosen_item = results[0]
                media_type = chosen_item.get('media_type')

                if media_type == 'tv':
                    from MediaHub.api.tmdb_api_helpers import process_chosen_show
                    return process_chosen_show(chosen_item, auto_select, chosen_item.get('id'), season_number, episode_number, episode_match, is_extra, file, force_extra, query)
                else:
                    log_message(f"Movie selected during manual search. Redirecting to movie processor.", level="INFO")
                    return {'redirect_to_movie': True, 'movie_data': chosen_item}

def determine_tmdb_media_type(tmdb_id):
    global api_key
    if not check_api_key():
        log_message("API key is missing or invalid. Cannot determine media type.", level="ERROR")
        return None, None

    log_message(f"Determining media type for TMDB ID: {tmdb_id}", level="DEBUG")

    try:
        movie_url = f"https://api.themoviedb.org/3/movie/{tmdb_id}"
        movie_params = {'api_key': api_key, 'language': language_iso}
        log_message(f"Checking movie endpoint: {movie_url}", level="DEBUG")

        movie_response = session.get(movie_url, params=movie_params, timeout=10)
        log_message(f"Movie endpoint response status: {movie_response.status_code}", level="DEBUG")

        if movie_response.status_code == 200:
            movie_data = movie_response.json()
            log_message(f"Movie endpoint response data: {movie_data.get('title', 'No title')}", level="DEBUG")

            if movie_data.get('title'):
                log_message(f"TMDB ID {tmdb_id} identified as movie: {movie_data.get('title')}", level="INFO")
                return 'movie', movie_data
        else:
            log_message(f"Movie endpoint returned status {movie_response.status_code}", level="DEBUG")

    except requests.exceptions.RequestException as e:
        log_message(f"Error checking movie endpoint for TMDB ID {tmdb_id}: {e}", level="DEBUG")
    except Exception as e:
        log_message(f"Unexpected error checking movie endpoint for TMDB ID {tmdb_id}: {e}", level="DEBUG")

    try:
        tv_url = f"https://api.themoviedb.org/3/tv/{tmdb_id}"
        tv_params = {'api_key': api_key, 'language': language_iso}
        log_message(f"Checking TV endpoint: {tv_url}", level="DEBUG")

        tv_response = session.get(tv_url, params=tv_params, timeout=10)
        log_message(f"TV endpoint response status: {tv_response.status_code}", level="DEBUG")

        if tv_response.status_code == 200:
            tv_data = tv_response.json()
            log_message(f"TV endpoint response data: {tv_data.get('name', 'No name')}", level="DEBUG")

            if tv_data.get('name'):
                log_message(f"TMDB ID {tmdb_id} identified as TV show: {tv_data.get('name')}", level="INFO")
                return 'tv', tv_data
        else:
            log_message(f"TV endpoint returned status {tv_response.status_code}", level="DEBUG")

    except requests.exceptions.RequestException as e:
        log_message(f"Error checking TV endpoint for TMDB ID {tmdb_id}: {e}", level="DEBUG")
    except Exception as e:
        log_message(f"Unexpected error checking TV endpoint for TMDB ID {tmdb_id}: {e}", level="DEBUG")

    log_message(f"TMDB ID {tmdb_id} not found in either movie or TV databases", level="WARNING")
    return None, None

def process_chosen_movie(chosen_movie):
    movie_name = chosen_movie.get('title')
    release_date = chosen_movie.get('release_date')
    movie_year = release_date.split('-')[0] if release_date else "Unknown Year"
    tmdb_id = chosen_movie.get('id')
    process_tmdb_covers(tmdb_id, chosen_movie)

    if is_imdb_folder_id_enabled():
        external_ids = get_external_ids(tmdb_id, 'movie')
        imdb_id = external_ids.get('imdb_id', '')
        log_message(f"Movie: {movie_name}, IMDB ID: {imdb_id}", level="INFO")
        return {'id': imdb_id, 'title': movie_name, 'release_date': release_date, 'imdb_id': imdb_id}
    else:
        return {'id': tmdb_id, 'title': movie_name, 'release_date': release_date}

def get_external_ids(tmdb_id, media_type):
    """Get external IDs for a given TMDB ID and media type."""
    if media_type == 'movie':
        movie_data = get_movie_data(tmdb_id)
        return {'imdb_id': movie_data.get('imdb_id', '')}
    elif media_type == 'tv':
        show_data = get_show_data(tmdb_id)
        return show_data.get('external_ids', {})
    else:
        log_message(f"Unknown media type: {media_type}", level="ERROR")
        return {}

def get_movie_genres(tmdb_id):
    """Get genre information for a movie."""
    movie_data = get_movie_data(tmdb_id)
    return {
        'is_anime_genre': movie_data.get('is_anime_genre', False)
    }

def get_show_genres(tmdb_id):
    """Get genre information for a TV show."""
    show_data = get_show_data(tmdb_id)
    return {
        'is_anime_genre': show_data.get('is_anime_genre', False)
    }
