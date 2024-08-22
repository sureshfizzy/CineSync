import re
import requests
from bs4 import BeautifulSoup
from functools import lru_cache
import urllib.parse
from utils.logging_utils import log_message
from config.config import get_api_key
from utils.file_utils import clean_query, normalize_query, standardize_title

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

@lru_cache(maxsize=None)
def search_tv_show(query, year=None, auto_select=False):
    global api_key
    if not check_api_key():
        return query

    cache_key = (query, year)
    if cache_key in _api_cache:
        return _api_cache[cache_key]

    url = "https://api.themoviedb.org/3/search/tv"

    params = {
        'api_key': api_key,
        'query': query
    }
    if year:
        params['first_air_date_year'] = year

    try:
        response = requests.get(url, params=params)
        response.raise_for_status()
        results = response.json().get('results', [])

        if results:
            chosen_show = results[0] if auto_select else None

            if not auto_select and len(results) == 1:
                chosen_show = results[0]

            if not chosen_show:
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

            if chosen_show:
                show_name = chosen_show.get('name')
                first_air_date = chosen_show.get('first_air_date')
                show_year = first_air_date.split('-')[0] if first_air_date else "Unknown Year"
                tmdb_id = chosen_show.get('id')
                proper_name = f"{show_name} ({show_year}) {{tmdb-{tmdb_id}}}"
                _api_cache[cache_key] = proper_name
                return proper_name
            else:
                log_message(f"No valid selection made for query '{query}', skipping.", level="WARNING")
                _api_cache[cache_key] = f"{query}"
                return f"{query}"
        else:
            _api_cache[cache_key] = f"{query}"
            return f"{query}"

    except requests.exceptions.RequestException as e:
       log_message(f"Error fetching data: {e}", level="ERROR")
       return f"{query}"

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
        # Use the simplified query for the fallback search
        simplified_query = re.sub(r'[^\w\s]', '', standardized_query)
        encoded_simplified_query = urllib.parse.quote_plus(simplified_query)
        results = perform_fallback_search(simplified_query)

    if not results and year_from_query:
        # Perform fallback search using year alone
        year_query = year_from_query
        year_encoded_query = urllib.parse.quote_plus(year_query)
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

                    # Fetch movie details using the movie ID
                    details_url = f"https://api.themoviedb.org/3/movie/{tmdb_id}"
                    params = {'api_key': api_key}
                    details_response = requests.get(details_url, params=params)
                    details_response.raise_for_status()
                    movie_details = details_response.json()

                    if movie_details:
                        movie_name = movie_details.get('title')
                        release_date = movie_details.get('release_date')
                        movie_year = release_date.split('-')[0] if release_date else "Unknown Year"
                        return {'id': tmdb_id, 'title': movie_name, 'release_date': release_date}
        except requests.RequestException as e:
            log_message(f"Error fetching data: {e}", level="ERROR")

    if results:
        if auto_select:
            chosen_movie = results[0]
        else:
            if len(results) == 1:
                chosen_movie = results[0]
            else:
                log_message(f"Multiple movies found for query '{query}':", level="INFO")
                for idx, movie in enumerate(results[:3]):
                    movie_name = movie.get('title')
                    movie_id = movie.get('id')
                    release_date = movie.get('release_date')
                    movie_year = release_date.split('-')[0] if release_date else "Unknown Year"
                    log_message(f"{idx + 1}: {movie_name} ({movie_year}) [tmdb-{movie_id}]", level="INFO")

                choice = input("Choose a movie (1-3) or press Enter to skip: ").strip()
                if choice.isdigit() and 1 <= int(choice) <= 3:
                    chosen_movie = results[int(choice) - 1]
                else:
                    chosen_movie = None

        if chosen_movie:
            movie_name = chosen_movie.get('title')
            release_date = chosen_movie.get('release_date')
            movie_year = release_date.split('-')[0] if release_date else "Unknown Year"
            tmdb_id = chosen_movie.get('id')
            return {'id': tmdb_id, 'title': movie_name, 'release_date': release_date}
        else:
            log_message(f"No valid selection for '{query}', skipping.")
            return None
    else:
        log_message(f"No results for '{query}'.")
        return None

def remove_genre_names(query):
    genre_names = [
        'Action', 'Comedy', 'Drama', 'Thriller', 'Horror', 'Romance', 'Adventure', 'Sci-Fi',
        'Fantasy', 'Mystery', 'Crime', 'Documentary', 'Animation', 'Family', 'Music', 'War',
        'Western', 'History', 'Biography'
    ]
    for genre in genre_names:
        query = re.sub(r'\b' + re.escape(genre) + r'\b', '', query, flags=re.IGNORECASE)
    query = re.sub(r'\s+', ' ', query).strip()
    return query

def perform_fallback_search(query):
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

                # Fetch movie details using the movie ID
                details_url = f"https://api.themoviedb.org/3/movie/{tmdb_id}"
                params = {'api_key': get_api_key()}
                details_response = requests.get(details_url, params=params)
                details_response.raise_for_status()
                movie_details = details_response.json()

                if movie_details:
                    movie_name = movie_details.get('title')
                    release_date = movie_details.get('release_date')
                    movie_year = release_date.split('-')[0] if release_date else "Unknown Year"
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
        return episode_data.get('name')
    except requests.exceptions.RequestException as e:
        log_message(f"Error fetching episode data: {e}", level="ERROR")
        return None

def get_movie_collection(movie_id):
    api_key = get_api_key()
    if not api_key:
        return None

    url = f"https://api.themoviedb.org/3/movie/{movie_id}"
    params = {'api_key': api_key, 'append_to_response': 'belongs_to_collection'}

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
