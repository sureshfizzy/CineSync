import requests
from functools import lru_cache
from logging_utils import log_message

_api_cache = {}

@lru_cache(maxsize=None)
def search_tv_show(query, year=None, auto_select=False, api_key=None):
    cache_key = (query, year)
    if cache_key in _api_cache:
        return _api_cache[cache_key]

    if not api_key:
        log_message("TMDb API key not found in environment variables.", level="ERROR")
        return query

    url = "https://api.themoviedb.org/3/search/tv"
    params = {'api_key': api_key, 'query': query}
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

@lru_cache(maxsize=None)
def search_movie(query, year=None, auto_select=False, api_key=None):
    cache_key = (query, year)
    if cache_key in _api_cache:
        return _api_cache[cache_key]

    if not api_key:
        log_message("TMDb API key not found in environment variables.", level="ERROR")
        return query

    url = "https://api.themoviedb.org/3/search/movie"
    params = {'api_key': api_key, 'query': query}
    if year:
        params['year'] = year

    try:
        response = requests.get(url, params=params)
        response.raise_for_status()
        results = response.json().get('results', [])

        if results:
            chosen_movie = results[0] if auto_select else None

            if not auto_select and len(results) == 1:
                chosen_movie = results[0]

            if not chosen_movie:
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

            if chosen_movie:
                movie_name = chosen_movie.get('title')
                release_date = chosen_movie.get('release_date')
                movie_year = release_date.split('-')[0] if release_date else "Unknown Year"
                tmdb_id = chosen_movie.get('id')
                proper_name = f"{movie_name} ({movie_year}) {{tmdb-{tmdb_id}}}"
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

def get_episode_name(show_id, season_number, episode_number, api_key):
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
