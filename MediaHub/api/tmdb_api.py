import os
import re
import requests
from bs4 import BeautifulSoup
from functools import lru_cache
import urllib.parse
from utils.logging_utils import log_message
from config.config import get_api_key, is_imdb_folder_id_enabled
from utils.file_utils import clean_query, normalize_query, standardize_title, remove_genre_names, extract_title

_api_cache = {}

# Global variables for API key status and warnings
api_key = get_api_key()
api_warning_logged = False

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

@lru_cache(maxsize=None)
def search_tv_show(query, year=None, auto_select=False, actual_dir=None):
    global api_key
    if not check_api_key():
        return query

    cache_key = (query, year)
    if cache_key in _api_cache:
        return _api_cache[cache_key]

    url = "https://api.themoviedb.org/3/search/tv"

    def fetch_results(query, year=None):
        params = {'api_key': api_key, 'query': query}
        full_url = f"{url}?{urllib.parse.urlencode(params)}"
        log_message(f"Primary search URL (without year): {full_url}", "DEBUG", "stdout")
        response = perform_search(params, url)

        if not response and year:
            params['first_air_date_year'] = year
            full_url_with_year = f"{url}?{urllib.parse.urlencode(params)}"
            log_message(f"Secondary search URL (with year): {full_url_with_year}", "DEBUG", "stdout")
            response = perform_search(params, url)

        return response

    def search_with_extracted_title(query, year=None):
        title = extract_title(query)
        return fetch_results(title, year)

    def search_fallback(query, year=None):
        query = re.sub(r'\s*\(.*$', '', query).strip()
        log_message(f"Fallback search query: '{query}'", "DEBUG", "stdout")
        return fetch_results(query, year)

    results = fetch_results(query, year)

    if not results:
        results = search_with_extracted_title(query, year)
        log_message(f"Primary search failed, attempting with extracted title", "DEBUG", "stdout")

    if not results:
        results = perform_fallback_tv_search(query, year)

    if not results and year:
        results = search_fallback(query, year)

    if not results and year:
        fallback_url = f"https://api.themoviedb.org/3/search/tv?api_key={api_key}&query={year}"
        log_message(f"Fallback search URL: {fallback_url}", "DEBUG", "stdout")
        try:
            response = requests.get(fallback_url)
            response.raise_for_status()
            results = response.json().get('results', [])
        except requests.exceptions.RequestException as e:
            log_message(f"Error during fallback search: {e}", level="ERROR")

    if not results:
        log_message(f"Attempting with Search with Cleaned Name", "DEBUG", "stdout")
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
        log_message(f"No results found for query '{query}' with year '{year}'.", level="WARNING")
        _api_cache[cache_key] = f"{query}"
        return f"{query}"

    if auto_select:
        chosen_show = results[0]
    else:
        if len(results) == 1:
            chosen_show = results[0]
        else:
            log_message(f"Multiple shows found for query '{query}':", level="INFO")
            for idx, show in enumerate(results[:3]):
                show_name = show.get('name')
                show_id = show.get('id')
                first_air_date = show.get('first_air_date')
                show_year = first_air_date.split('-')[0] if first_air_date else "Unknown Year"
                log_message(f"{idx + 1}: {show_name} ({show_year}) [tmdb-{show_id}]", level="INFO")

            choice = input("Choose a show (1-3) or press Enter to skip: ").strip()
            if choice.isdigit() and 1 <= int(choice) <= 3:
                chosen_show = results[int(choice) - 1]
            else:
                chosen_show = None

    if chosen_show:
        show_name = chosen_show.get('name')
        first_air_date = chosen_show.get('first_air_date')
        show_year = first_air_date.split('-')[0] if first_air_date else "Unknown Year"
        tmdb_id = chosen_show.get('id')

        if is_imdb_folder_id_enabled():
            external_ids = get_external_ids(tmdb_id, 'tv')
            imdb_id = external_ids.get('imdb_id', '')
            proper_name = f"{show_name} ({show_year}) {{imdb-{imdb_id}}}"
            log_message(f"TV Show: {show_name}, IMDB ID: {imdb_id}", level="INFO")
        else:
            proper_name = f"{show_name} ({show_year}) {{tmdb-{tmdb_id}}}"

        _api_cache[cache_key] = proper_name
        return proper_name
    else:
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
        response = requests.get(url, params=params)
        response.raise_for_status()
        results = response.json().get('results', [])
        return results
    except requests.exceptions.RequestException as e:
        log_message(f"Error fetching data: {e}", level="ERROR")
        return []

@lru_cache(maxsize=None)
def search_movie(query, year=None, auto_select=False):
    global api_key
    if not check_api_key():
        return query

    cache_key = (query, year)
    if cache_key in _api_cache:
        return _api_cache[cache_key]

    url = "https://api.themoviedb.org/3/search/movie"
    title, year_from_query = clean_query(query)
    normalized_query = normalize_query(title)
    standardized_query = standardize_title(normalized_query)
    encoded_query = urllib.parse.quote_plus(standardized_query)

    params = {
        'api_key': api_key,
        'query': encoded_query,
        'page': 1,
        'include_adult': False
    }
    if year:
        params['primary_release_year'] = year

    full_url = f"{url}?{urllib.parse.urlencode(params)}"

    results = perform_search(params, url)

    if not results:
        simplified_query = re.sub(r'[^\w\s]', '', standardized_query)
        results = perform_fallback_search(simplified_query)

    if not results and year_from_query:
        results = perform_year_fallback_search(year_from_query)

    if not results:
        standardized_query = standardize_title(normalized_query, check_word_count=False)
        results = perform_fallback_search(standardized_query)

    chosen_movie = None
    if results:
        if auto_select:
            chosen_movie = results[0]
        else:
            if len(results) == 1:
                chosen_movie = results[0]
            else:
                chosen_movie = present_movie_choices(results, query)

    if chosen_movie:
        return process_chosen_movie(chosen_movie)
    else:
        log_message(f"No valid selection for '{query}', skipping.")
        return None

def present_movie_choices(results, query):
    log_message(f"Multiple movies found for query '{query}':", level="INFO")
    for idx, movie in enumerate(results[:3]):
        movie_name = movie.get('title')
        movie_id = movie.get('id')
        release_date = movie.get('release_date')
        movie_year = release_date.split('-')[0] if release_date else "Unknown Year"
        log_message(f"{idx + 1}: {movie_name} ({movie_year}) [tmdb-{movie_id}]", level="INFO")

    choice = input("Choose a movie (1-3) or press Enter to skip: ").strip()
    if choice.isdigit() and 1 <= int(choice) <= 3:
        return results[int(choice) - 1]
    return None

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

def perform_fallback_search(year):
    year_encoded_query = urllib.parse.quote_plus(year)
    year_url = f"https://www.themoviedb.org/search?query={year_encoded_query}"
    try:
        response = requests.get(year_url)
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
        log_message(f"Error fetching data: {e}", level="ERROR")
    return []

def get_episode_name(show_id, season_number, episode_number):
    api_key = get_api_key()
    if not api_key:
        log_message("TMDb API key not found in environment variables.", level="ERROR")
        return None

    url = f"https://api.themoviedb.org/3/tv/{show_id}/season/{season_number}/episode/{episode_number}"
    params = {'api_key': api_key}

    try:
        response = requests.get(url, params=params)
        response.raise_for_status()
        episode_data = response.json()
        episode_name = episode_data.get('name')

        # Format the episode information
        episode_info = f"S{season_number:02d}E{episode_number:02d} - {episode_name}"

        return episode_name
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
