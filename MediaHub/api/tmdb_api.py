import os
import platform
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
from MediaHub.api.tmdb_api_helpers import *

_api_cache = {}

# Global variables for API key status and warnings
api_key = get_api_key()
api_warning_logged = False

# Disable urllib3 debug logging
logging.getLogger("urllib3").setLevel(logging.WARNING)

@lru_cache(maxsize=None)
def search_tv_show(query, year=None, auto_select=False, actual_dir=None, file=None, root=None, episode_match=None, tmdb_id=None, imdb_id=None, tvdb_id=None, season=None, is_extra=None, season_number=None, episode_number=None, force_extra=None):
    global api_key
    if not check_api_key():
        return query

    # Handle direct ID searches first
    if tmdb_id or imdb_id or tvdb_id:
        try:
            if tmdb_id:
                log_message(f"Using provided TMDB ID: {tmdb_id}", level="INFO")
                url = f"https://api.themoviedb.org/3/tv/{tmdb_id}"
                params = {'api_key': api_key}
                response = requests.get(url, params=params)
                response.raise_for_status()
                show_data = response.json()

            elif imdb_id or tvdb_id:
                external_id_type = 'imdb_id' if imdb_id else 'tvdb_id'
                external_id = imdb_id if imdb_id else str(tvdb_id)

                url = f"https://api.themoviedb.org/3/find/{external_id}"
                params = {
                    'api_key': api_key,
                    'external_source': 'imdb_id' if imdb_id else 'tvdb_id'
                }
                response = requests.get(url, params=params)
                response.raise_for_status()
                results = response.json().get('tv_results', [])

                if not results:
                    log_message(f"No show found for {external_id_type}: {external_id}", level="WARNING")
                    return query

                show_data = results[0]
                tmdb_id = show_data['id']

                # Get full show details
                url = f"https://api.themoviedb.org/3/tv/{tmdb_id}"
                params = {'api_key': api_key}
                response = requests.get(url, params=params)
                response.raise_for_status()
                show_data = response.json()

            # Process show data with the potentially updated season/episode info
            if show_data:
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

                return process_chosen_show(show_data, auto_select, tmdb_id, season_number, episode_number, episode_match, is_extra, file)

        except requests.exceptions.RequestException as e:
            log_message(f"Error fetching show data: {e}", level="ERROR")
            log_message(f"Falling back to search due to API error", level="INFO")

            return proper_name, show_name, is_anime_genre

    cache_key = (query, year)
    if cache_key in _api_cache:
        return _api_cache[cache_key]

    url = "https://api.themoviedb.org/3/search/tv"

    def fetch_results(query, year=None):
        if isinstance(query, tuple):
            query = query[0] if query else ""

        if len(query.strip()) == 1:
            log_message(f"Skipping API search for single-letter query: '{query}'", "DEBUG", "stdout")
            return None

        params = {'api_key': api_key, 'query': query}

        # Include year in primary search if available
        if year:
            params['first_air_date_year'] = year
            full_url = f"{url}?{urllib.parse.urlencode(params)}"
            log_message(f"Primary search URL with year: {full_url}", "DEBUG", "stdout")
            response = perform_search(params, url)

            if response:
                scored_results = []
                for result in response:
                    score = calculate_score(result, query, year)
                    if score >= 40:
                        scored_results.append((score, result))

                scored_results.sort(reverse=True, key=lambda x: x[0])
                if scored_results:
                    return [r[1] for r in scored_results]

        params = {'api_key': api_key, 'query': query}
        full_url = f"{url}?{urllib.parse.urlencode(params)}"
        log_message(f"Secondary search URL (without year): {full_url}", "DEBUG", "stdout")
        response = perform_search(params, url)

        if response:
            scored_results = []
            for result in response:
                score = calculate_score(result, query, year)
                if score >= 40:
                    scored_results.append((score, result))

            scored_results.sort(reverse=True, key=lambda x: x[0])
            if scored_results:
                return [r[1] for r in scored_results]

        return response

    def search_with_extracted_title(query, year=None):
        title = extract_title(query)
        return fetch_results(title, year)

    def search_fallback(query, year=None):
        query = re.sub(r'\s*\(.*$', '', query).strip()
        log_message(f"Fallback search query: '{query}'", "DEBUG", "stdout")
        return fetch_results(query, year)

    def display_results(results, start_idx=0):
        for idx, show in enumerate(results[start_idx:start_idx + 3], start=start_idx + 1):
            show_name = show.get('name')
            show_id = show.get('id')
            first_air_date = show.get('first_air_date')
            show_year = first_air_date.split('-')[0] if first_air_date else "Unknown Year"
            log_message(f"{idx}: {show_name} ({show_year}) [tmdb-{show_id}]", level="INFO")

    results = fetch_results(query, year)

    if not results:
        if len(query.strip()) > 1:
            results = search_with_extracted_title(query, year)
            log_message(f"Primary search failed, attempting with extracted title", "DEBUG", "stdout")
        else:
            log_message(f"Skipping extracted title search for single-letter query: '{query}'", "DEBUG", "stdout")

    if not results:
        if len(query.strip()) > 1:
            results = perform_fallback_tv_search(query, year)
            log_message(f"Primary search failed, attempting fallback TV search", "DEBUG", "stdout")
        else:
            log_message(f"Skipping fallback TV search for single-letter query: '{query}'", "DEBUG", "stdout")

    if not results and year:
        if len(query.strip()) > 1:
            results = search_fallback(query, year)
            log_message(f"TV search fallback failed, attempting final search", "DEBUG", "stdout")
        else:
            log_message(f"Skipping final fallback search for single-letter query: '{query}'", "DEBUG", "stdout")

    if not results:
        if len(query.strip()) > 1:
            # Search with cleaned query only if the episode pattern matches
            if episode_match:
                log_message(f"Searching with Cleaned Query", "DEBUG", "stdout")
                cleaned_title, _ = clean_query(file)
                results = fetch_results(cleaned_title, year)
            else:
                log_message(f"Skipping cleaned query search for non-episode file", "DEBUG", "stdout")
        else:
            log_message(f"Skipping cleaned query search for single-letter query: '{query}'", "DEBUG", "stdout")

    if not results and year:
        fallback_url = f"https://api.themoviedb.org/3/search/tv?api_key={api_key}&query={year}"
        log_message(f"Fallback search URL: {fallback_url}", "DEBUG", "stdout")
        try:
            response = requests.get(fallback_url)
            response.raise_for_status()
            results = response.json().get('results', [])
            if results:
                # Score and filter year-based results
                scored_results = []
                for result in results:
                    score = calculate_score(result, query, year)
                    if score >= 40:
                        scored_results.append((score, result))
                scored_results.sort(reverse=True, key=lambda x: x[0])
                results = [r[1] for r in scored_results]
        except requests.exceptions.RequestException as e:
            log_message(f"Error during fallback search: {e}", level="ERROR")

    if not results:
        log_message(f"Attempting with Search with Cleaned Name", "DEBUG", "stdout")
        cleaned_title, year_from_query = clean_query(query)
        if cleaned_title != query:
            log_message(f"Cleaned query: {cleaned_title}", "DEBUG", "stdout")
            results = fetch_results(cleaned_title, year or year_from_query)

    if not results and actual_dir:
        dir_based_query = os.path.basename(root)
        log_message(f"Attempting search with directory name: '{dir_based_query}'", "DEBUG", "stdout")
        cleaned_dir_query, dir_year = clean_query(dir_based_query)
        results = fetch_results(cleaned_dir_query, year or dir_year)

    if not results:
        log_message(f"Searching with Advanced Query", "DEBUG", "stdout")
        dir_based_query = os.path.basename(root)
        title = advanced_clean_query(dir_based_query, max_words=4)
        results = fetch_results(title, year)

        # If no results found with max_words=4, try again with max_words=2
        if not results:
            log_message(f"No results found. Retrying with more aggressive cleaning", "DEBUG", "stdout")
            title = advanced_clean_query(dir_based_query, max_words=2)
            results = fetch_results(title, year)

    if not results:
        log_message(f"No results found for query '{query}' with year '{year}'.", level="WARNING")
        _api_cache[cache_key] = f"{query}"
        return f"{query}"

    if auto_select:
        chosen_show = results[0]
        result = process_chosen_show(chosen_show, auto_select, tmdb_id, season_number, episode_number, episode_match, is_extra, file, force_extra)
        if isinstance(query, tuple):
            query_str = query[0] if query else ""
        else:
            query_str = str(query)

        cache_key_str = f"{query_str}_{year}"
        _api_cache[cache_key_str] = (tmdb_id, season_number, episode_number)

        return result
    else:
        while True:
            log_message(f"Multiple shows found for query '{query}':", level="INFO")
            display_results(results)

            log_message("Options:", level="INFO")
            log_message("- Enter 1-3 to select a show", level="INFO")
            log_message("- Enter a search term for a new search", level="INFO")

            choice = input("Enter your choice: ").strip()

            if choice.lower() in ['1', '2', '3']:
                chosen_show = results[int(choice) - 1]
                result = process_chosen_show(chosen_show, auto_select, tmdb_id, season_number, episode_number, episode_match, is_extra, file, force_extra)
                _api_cache[cache_key] = result
                return result
            elif choice.strip():
                new_results = fetch_results(choice, year)
                if new_results:
                    results = new_results
                    continue
                else:
                    log_message(f"No results found for '{choice}'", level="WARNING")
                    continue
            else:
                chosen_show = results[0]
                result = process_chosen_show(chosen_show, auto_select, tmdb_id, season_number, episode_number, episode_match, is_extra, file, force_extra)
                if isinstance(query, tuple):
                    query_str = query[0] if query else ""
                else:
                    query_str = str(query)

                cache_key_str = f"{query_str}_{year}"
                _api_cache[cache_key_str] = (tmdb_id, season_number, episode_number)

                return result

    log_message(f"No valid selection made for query '{query}', skipping.", level="WARNING")
    _api_cache[cache_key] = f"{query}"
    return f"{query}"

def perform_fallback_tv_search(query, year=None):
    cleaned_query = remove_genre_names(query)
    search_url = f"https://www.themoviedb.org/search?query={urllib.parse.quote_plus(cleaned_query)}"

    try:
        response = requests.get(search_url)
        response.raise_for_status()
        soup = BeautifulSoup(response.text, 'html.parser')
        tv_show_link = soup.find('a', class_='result')

        if tv_show_link:
            tv_show_id = re.search(r'/tv/(\d+)', tv_show_link['href'])
            if tv_show_id:
                tmdb_id = tv_show_id.group(1)

                # Fetch TV show details using the TV show ID
                details_url = f"https://api.themoviedb.org/3/tv/{tmdb_id}"
                params = {'api_key': api_key}
                details_response = requests.get(details_url, params=params)
                details_response.raise_for_status()
                tv_show_details = details_response.json()

                if tv_show_details:
                    show_name = tv_show_details.get('name')
                    first_air_date = tv_show_details.get('first_air_date')
                    show_year = first_air_date.split('-')[0] if first_air_date else "Unknown Year"
                    return [{'id': tmdb_id, 'name': show_name, 'first_air_date': first_air_date}]
    except requests.RequestException as e:
        log_message(f"Error during web-based fallback search: {e}", level="ERROR")

    return []

def perform_search(params, url):
    try:
        query = params['query']
        year = params.get('first_air_date_year')
        if isinstance(query, tuple):
            query = query[0]
        query = query.lower()

        query = re.sub(r'\b&\b', 'and', query)
        query = re.sub(r'\band\b', '&', query)
        params['query'] = query

        response = requests.get(url, params=params)
        response.raise_for_status()
        results = response.json().get('results', [])

        if not results:
            return []

        # Score all results
        scored_results = []
        for result in results:
            score = calculate_score(result, query, year)
            scored_results.append((score, result))

        scored_results.sort(reverse=True, key=lambda x: x[0])

        MIN_SCORE_THRESHOLD = 50
        filtered_results = [r[1] for r in scored_results if r[0] >= MIN_SCORE_THRESHOLD]

        if filtered_results:
            return filtered_results

        return [r[1] for r in scored_results]

    except requests.exceptions.RequestException as e:
        log_message(f"Error fetching data: {e}", level="ERROR")
        return []

@lru_cache(maxsize=None)
def search_movie(query, year=None, auto_select=False, actual_dir=None, file=None, tmdb_id=None, imdb_id=None, root=None):
    global api_key
    if not check_api_key():
        return query

    # Helper function to format movie name for the OS
    def format_movie_name(name):
        if platform.system().lower() == 'windows' or platform.system().lower() == 'nt':
            return name.replace(':', ' -')
        return name

    # Handle direct ID searches first
    if tmdb_id or imdb_id:
        try:
            if tmdb_id:
                log_message(f"Using provided TMDB ID: {tmdb_id}", level="INFO")
                url = f"https://api.themoviedb.org/3/movie/{tmdb_id}"
                params = {'api_key': api_key}
                response = requests.get(url, params=params)
                response.raise_for_status()
                movie_data = response.json()

            elif imdb_id:
                url = f"https://api.themoviedb.org/3/find/{imdb_id}"
                params = {
                    'api_key': api_key,
                    'external_source': 'imdb_id'
                }
                response = requests.get(url, params=params)
                response.raise_for_status()
                results = response.json().get('movie_results', [])

                if not results:
                    log_message(f"No movie found for IMDb ID: {imdb_id}", level="WARNING")
                    return query

                movie_data = results[0]
                tmdb_id = movie_data['id']

                # Get full movie details
                url = f"https://api.themoviedb.org/3/movie/{tmdb_id}"
                params = {'api_key': api_key}
                response = requests.get(url, params=params)
                response.raise_for_status()
                movie_data = response.json()

            # Process movie data
            original_movie_name = movie_data['title']
            movie_name = format_movie_name(original_movie_name)
            release_date = movie_data.get('release_date', '')
            movie_year = release_date.split('-')[0] if release_date else "Unknown Year"

            # Get external IDs for the movie
            external_ids = get_external_ids(tmdb_id, 'movie')
            imdb_id = external_ids.get('imdb_id', '')
            genre_info = get_movie_genres(tmdb_id)
            is_anime_genre = genre_info['is_anime_genre']

            if is_imdb_folder_id_enabled():
                proper_name = f"{movie_name} ({movie_year}) {{imdb-{imdb_id}}}"
            elif is_tmdb_folder_id_enabled():
                proper_name = f"{movie_name} ({movie_year}) {{tmdb-{tmdb_id}}}"
            else:
                proper_name = f"{movie_name} ({movie_year})"

            log_message(f"Successfully retrieved movie data using ID: {proper_name}", level="INFO")
            return tmdb_id, imdb_id, movie_name, movie_year, is_anime_genre

        except requests.exceptions.RequestException as e:
            log_message(f"Error fetching movie data: {e}", level="ERROR")
            log_message(f"Falling back to search due to API error", level="INFO")

    cache_key = (query, year)
    if cache_key in _api_cache:
        return _api_cache[cache_key]

    url = "https://api.themoviedb.org/3/search/movie"

    def fetch_results(query, year=None):
        params = {'api_key': api_key, 'query': query}
        if year:
            params['primary_release_year'] = year

        full_url = f"{url}?{urllib.parse.urlencode(params)}"
        log_message(f"Fetching results from URL: {full_url}", "DEBUG", "stdout")
        response = perform_search(params, url)

        if not response and year:
            log_message("No results found with year, retrying without year.", "DEBUG", "stdout")
            del params['primary_release_year']
            response = perform_search(params, url)

        return response

    def search_with_extracted_title(query, year=None):
        title = extract_title(query)
        log_message(f"Searching with extracted title: '{title}'", "DEBUG", "stdout")
        return fetch_results(title, year)

    def search_fallback(query, year=None):
        fallback_query = re.sub(r'\s*\(.*$', '', query).strip()
        log_message(f"Primary search failed, attempting with extracted title", "DEBUG", "stdout")
        return fetch_results(fallback_query, year)

    results = fetch_results(query, year)

    if not results:
        log_message("Primary search failed. Attempting extracted title search.", "DEBUG", "stdout")
        results = search_with_extracted_title(query, year)

    if not results and file:
        log_message("Attempting search with cleaned movie name.", "DEBUG", "stdout")
        cleaned_title = clean_query_movie(file)[0]
        results = fetch_results(cleaned_title, year)

    if not results and year:
        log_message("Performing additional fallback search without query.", "DEBUG", "stdout")
        results = search_fallback(query, year)

    if not results and year:
        fallback_url = f"https://api.themoviedb.org/3/search/movie?api_key={api_key}&query={year}"
        log_message(f"Fallback search URL: {fallback_url}", "DEBUG", "stdout")
        try:
            response = requests.get(fallback_url)
            response.raise_for_status()
            results = response.json().get('results', [])
        except requests.exceptions.RequestException as e:
            log_message(f"Error during fallback search: {e}", level="ERROR")

    if not results:
        log_message(f"Attempting Search with Cleaned Name", "DEBUG", "stdout")
        cleaned_title, year_from_query = clean_query(query)
        if cleaned_title != query:
            log_message(f"Cleaned query: {cleaned_title}", "DEBUG", "stdout")
            results = fetch_results(cleaned_title, year or year_from_query)

    if not results and actual_dir:
        dir_based_query = os.path.basename(actual_dir)
        log_message(f"Attempting search with directory name: '{dir_based_query}'", "DEBUG", "stdout")
        cleaned_dir_query, dir_year = clean_query(dir_based_query)
        results = fetch_results(cleaned_dir_query, year or dir_year)

    if not results:
        log_message(f"Searching with Advanced Query", "DEBUG", "stdout")
        dir_based_query = os.path.basename(root)
        title = advanced_clean_query(dir_based_query, max_words=4)
        results = fetch_results(title, year)

        # If no results found with max_words=4, try again with max_words=2
        if not results:
            log_message(f"No results found. Retrying with more aggressive cleaning", "DEBUG", "stdout")
            title = advanced_clean_query(dir_based_query, max_words=2)
            results = fetch_results(title, year)

    if not results:
        log_message(f"No results found for query '{query}' with year '{year}'.", "WARNING", "stdout")
        _api_cache[cache_key] = f"{query}"
        return f"{query}"

    if auto_select:
        chosen_movie = results[0]
    else:
        while True:
            log_message(f"Multiple movies found for query '{query}':", level="INFO")
            display_results(results)
            log_message("Options:", level="INFO")
            log_message("- Enter 1-3 to select a movie", level="INFO")
            log_message("- Enter a search term for a new search", level="INFO")

            choice = input("Enter your choice: ").strip()

            if choice.lower() in ['1', '2', '3']:
                chosen_movie = results[int(choice) - 1]
                break
            elif choice.strip():
                new_query = choice.strip()
                log_message(f"Searching for new query: '{new_query}'", "DEBUG", "stdout")
                new_results = fetch_results(new_query)
                if not new_results and year:
                    new_results = fetch_results(new_query, year)
                if not new_results:
                    new_results = search_with_extracted_title(new_query, year)

                if new_results:
                    results = new_results
                    continue
                else:
                    log_message(f"No results found for '{new_query}'", level="WARNING")
                    continue
            else:
                chosen_movie = results[0]
                break

    if chosen_movie:
        original_movie_name = chosen_movie.get('title')
        movie_name = format_movie_name(original_movie_name)
        release_date = chosen_movie.get('release_date')
        movie_year = release_date.split('-')[0] if release_date else "Unknown Year"
        tmdb_id = chosen_movie.get('id')

        external_ids = get_external_ids(tmdb_id, 'movie')
        imdb_id = external_ids.get('imdb_id', '')
        genre_info = get_movie_genres(tmdb_id)
        is_anime_genre = genre_info['is_anime_genre']

        if is_imdb_folder_id_enabled():
            proper_name = f"{movie_name} ({movie_year}) {{imdb-{imdb_id}}}"
        elif is_tmdb_folder_id_enabled():
            proper_name = f"{movie_name} ({movie_year}) {{tmdb-{tmdb_id}}}"
        else:
            proper_name = f"{movie_name} ({movie_year})"

        _api_cache[cache_key] = proper_name
        return tmdb_id, imdb_id, movie_name, movie_year, is_anime_genre

    log_message(f"No valid movie selected or found for query '{query}'.", "WARNING", "stdout")
    _api_cache[cache_key] = f"{query}"
    return f"{query}"

def display_results(results, start_idx=0):
    for idx, movie in enumerate(results[start_idx:start_idx + 3], start=start_idx + 1):
        movie_name = movie.get('title')
        movie_id = movie.get('id')
        release_date = movie.get('release_date')
        movie_year = release_date.split('-')[0] if release_date else "Unknown Year"
        log_message(f"{idx}: {movie_name} ({movie_year}) [tmdb-{movie_id}]", level="INFO")

def process_chosen_movie(chosen_movie):
    movie_name = chosen_movie.get('title')
    release_date = chosen_movie.get('release_date')
    movie_year = release_date.split('-')[0] if release_date else "Unknown Year"
    tmdb_id = chosen_movie.get('id')

    if is_imdb_folder_id_enabled():
        external_ids = get_external_ids(tmdb_id, 'movie')
        imdb_id = external_ids.get('imdb_id', '')
        log_message(f"Movie: {movie_name}, IMDB ID: {imdb_id}", level="INFO")
        return {'id': imdb_id, 'title': movie_name, 'release_date': release_date, 'imdb_id': imdb_id}
    else:
        return {'id': tmdb_id, 'title': movie_name, 'release_date': release_date}

def perform_fallback_search(query, year=None):
    cleaned_query = remove_genre_names(query)
    search_url = f"https://www.themoviedb.org/search?query={urllib.parse.quote_plus(cleaned_query)}"

    try:
        response = requests.get(search_url)
        response.raise_for_status()
        soup = BeautifulSoup(response.text, 'html.parser')
        movie_link = soup.find('a', class_='result')

        if movie_link:
            movie_id = re.search(r'/movie/(\d+)', movie_link['href'])
            if movie_id:
                tmdb_id = movie_id.group(1)

                details_url = f"https://api.themoviedb.org/3/movie/{tmdb_id}"
                params = {'api_key': api_key}
                details_response = requests.get(details_url, params=params)
                details_response.raise_for_status()
                movie_details = details_response.json()

                if movie_details:
                    movie_name = movie_details.get('title')
                    release_date = movie_details.get('release_date')
                    return [{'id': tmdb_id, 'title': movie_name, 'release_date': release_date}]
    except requests.RequestException as e:
        log_message(f"Error during web-based fallback search: {e}", level="ERROR")

    return []
