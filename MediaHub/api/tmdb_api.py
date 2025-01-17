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

@lru_cache(maxsize=None)
def search_tv_show(query, year=None, auto_select=False, actual_dir=None, file=None, root=None):
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

    def display_results(results, start_idx=0):
        for idx, show in enumerate(results[start_idx:start_idx + 3], start=start_idx + 1):
            show_name = show.get('name')
            show_id = show.get('id')
            first_air_date = show.get('first_air_date')
            show_year = first_air_date.split('-')[0] if first_air_date else "Unknown Year"
            log_message(f"{idx}: {show_name} ({show_year}) [tmdb-{show_id}]", level="INFO")

    results = fetch_results(query, year)

    if not results:
        results = search_with_extracted_title(query, year)
        log_message(f"Primary search failed, attempting with extracted title", "DEBUG", "stdout")

    if not results:
        results = perform_fallback_tv_search(query, year)

    if not results and year:
        results = search_fallback(query, year)

    if not results:
        log_message(f"Searching with Cleaned Query", "DEBUG", "stdout")
        title = clean_query(file)
        results = fetch_results(title, year)

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
        dir_based_query = os.path.basename(root)
        log_message(f"Attempting search with directory name: '{dir_based_query}'", "DEBUG", "stdout")
        cleaned_dir_query, dir_year = clean_query(dir_based_query)
        results = fetch_results(cleaned_dir_query, year or dir_year)

    if not results:
        log_message(f"Searching with Advanced Query", "DEBUG", "stdout")
        dir_based_query = os.path.basename(root)
        title = advanced_clean_query(dir_based_query)
        results = fetch_results(title, year)

    if not results:
        log_message(f"No results found for query '{query}' with year '{year}'.", level="WARNING")
        _api_cache[cache_key] = f"{query}"
        return f"{query}"

    if auto_select:
        chosen_show = results[0]
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
                break
            elif choice.strip():
                new_results = fetch_results(choice, year)
                if new_results:
                    results = new_results
                    continue
                else:
                    log_message(f"No results found for '{choice}'", level="WARNING")
                    continue
            else:
                chosen_show = None
                break

    if chosen_show:
        show_name = chosen_show.get('name')
        first_air_date = chosen_show.get('first_air_date')
        show_year = first_air_date.split('-')[0] if first_air_date else "Unknown Year"
        tmdb_id = chosen_show.get('id')

        external_ids = get_external_ids(tmdb_id, 'tv')
        genre_info = get_show_genres(tmdb_id)
        is_anime_genre = genre_info['is_anime_genre']

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

        _api_cache[cache_key] = proper_name
        return proper_name, show_name, is_anime_genre
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
        query = params['query']
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

        exact_matches = [
            r for r in results
            if r.get('name', '').lower() == query or
            r.get('original_name', '').lower() == query
        ]
        if exact_matches:
            return exact_matches

        def normalize_string(s):
            if not isinstance(s, str):
                return ''
            return ''.join(
                c for c in unicodedata.normalize('NFKD', s.lower())
                if not unicodedata.combining(c)
            )

        normalized_query = normalize_string(query)
        close_matches = [
            r for r in results
            if (normalize_string(r.get('name', '')) == normalized_query or
                normalize_string(r.get('original_name', '')) == normalized_query)
        ]
        if close_matches:
            return close_matches

        english_results = [
            r for r in results
            if (r.get('original_language') == 'en' or
                (r.get('origin_country') and any(country in ['GB', 'US', 'CA', 'AU', 'NZ']
                     for country in r.get('origin_country'))))
        ]

        if english_results:
            return english_results

        return sorted(results, key=lambda x: x.get('popularity', 0), reverse=True)

    except requests.exceptions.RequestException as e:
        log_message(f"Error fetching data: {e}", level="ERROR")
        return []

@lru_cache(maxsize=None)
def search_movie(query, year=None, auto_select=False, actual_dir=None, file=None):
    global api_key
    if not check_api_key():
        return query

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
                chosen_movie = None
                break

    if chosen_movie:
        movie_name = chosen_movie.get('title')
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
