import os
import re
import argparse
import shutil
import requests
import json
import sys
from requests.exceptions import RequestException
from functools import lru_cache
from datetime import datetime
from dotenv import load_dotenv
from concurrent.futures import ThreadPoolExecutor
from multiprocessing import cpu_count

_api_cache = {}

LOG_LEVELS = {
    "DEBUG": 10,
    "INFO": 20,
    "WARNING": 30,
    "ERROR": 40,
    "CRITICAL": 50
}

def log_message(message, level="INFO", output="stdout"):
    if LOG_LEVELS.get(level, 20) >= LOG_LEVEL:
        timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        log_entry = f"{timestamp} [{level}] {message}\n"
        if output == "stdout":
            sys.stdout.write(log_entry)
        elif output == "stderr":
            sys.stderr.write(log_entry)
        else:
            with open(output, 'a') as log_file:
                log_file.write(log_entry)

# Load .env file
dotenv_path = os.path.join(os.path.dirname(__file__), '..', '.env')
load_dotenv(dotenv_path)

# Load log level from .env
LOG_LEVEL = os.getenv('LOG_LEVEL', 'INFO')
LOG_LEVEL = LOG_LEVELS.get(LOG_LEVEL.upper(), 20)
api_warning_logged = False

def get_api_key():
    global api_warning_logged
    api_key = os.getenv('TMDB_API_KEY')
    if not api_key or api_key == 'your_tmdb_api_key_here':
        if not api_warning_logged:
            log_message("TMDb API key not found or is a placeholder. TMDb functionality is not enabled.", level="WARNING")
            api_warning_logged = True
        return None
    return api_key

def get_directories():
    src_dirs = os.getenv('SOURCE_DIR')
    dest_dir = os.getenv('DESTINATION_DIR')
    if not src_dirs or not dest_dir:
        log_message("SOURCE_DIRS or DESTINATION_DIR not set in environment variables.", level="ERROR")
        sys.exit(1)
    return src_dirs.split(','), dest_dir

def is_tmdb_folder_id_enabled():
    return os.getenv('TMDB_FOLDER_ID', 'true').lower() in ['true', '1', 'yes']

def is_rename_enabled():
    return os.getenv('RENAME_ENABLED', 'false').lower() in ['true', '1', 'yes']

def is_movie_collection_enabled():
    return os.getenv('MOVIE_COLLECTION_ENABLED', 'false').lower() in ['true', '1', 'yes']

@lru_cache(maxsize=None)
def search_tv_show(query, year=None, auto_select=False):
    cache_key = (query, year)
    if cache_key in _api_cache:
        return _api_cache[cache_key]

    api_key = get_api_key()
    if not api_key:
        return query

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

@lru_cache(maxsize=None)
def search_movie(query, year=None, auto_select=False):
    cache_key = (query, year)
    if cache_key in _api_cache:
        return _api_cache[cache_key]

    api_key = get_api_key()
    if not api_key:
        return query

    url = "https://api.themoviedb.org/3/search/movie"

    normalized_query = re.sub(r'[^\w\s]', '', query)

    params = {
        'api_key': api_key,
        'query': normalized_query,
        'page': 1,
        'include_adult': False
    }
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

    except RequestException as e:
        log_message(f"Error fetching data: {e}", level="ERROR")
        return f"{query}"

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

def extract_year(query):
    match = re.search(r'\((\d{4})\)$', query.strip())
    if match:
        return int(match.group(1))
    match = re.search(r'(\d{4})$', query.strip())
    if match:
        return int(match.group(1))
    return None

def extract_resolution(filename):
    patterns = [
        r'(\d{3,4}p)',
        r'(\d{3,4}x\d{3,4})'
    ]
    for pattern in patterns:
        match = re.search(pattern, filename, re.IGNORECASE)
        if match:
            return match.group(1)
    return None

def extract_resolution_from_folder(folder_name):
    patterns = [
        r'(\d{3,4}p)',
        r'(\d{3,4}x\d{3,4})'
    ]
    for pattern in patterns:
        match = re.search(pattern, folder_name, re.IGNORECASE)
        if match:
            return match.group(1)
    return None

def extract_folder_year(folder_name):
    match = re.search(r'\((\d{4})\)', folder_name)
    if match:
        return int(match.group(1))
    match = re.search(r'\.(\d{4})\.', folder_name)
    if match:
        return int(match.group(1))
    return None

def extract_movie_name_and_year(filename):
    if re.match(r'^\d{1,2}\.\s+', filename):
        filename = re.sub(r'^\d{1,2}\.\s*', '', filename)

    patterns = [
        r'(.+?)\s*\[(\d{4})\]',
        r'(.+?)\s*\((\d{4})\)',
        r'(.+?)\s*(\d{4})'
    ]

    # Attempt to match each pattern
    for pattern in patterns:
        match = re.search(pattern, filename)
        if match:
            name = match.group(1).replace('.', ' ').replace('-', ' ').strip()
            name = re.sub(r'[\[\]]', '', name).strip()
            year = match.group(2)
            return name, year
    return None, None

def extract_resolution_from_filename(filename):
    resolution_match = re.search(r'(\d{3,4}p|480|720|1080|2160)', filename, re.IGNORECASE)
    remux_match = re.search(r'(Remux)', filename, re.IGNORECASE)

    if resolution_match:
        resolution = resolution_match.group(1).lower()
        if remux_match:
            resolution += 'Remux'
        return resolution
    return None

def normalize_name(name):
    name = re.sub(r'\(\d{4}\)', '', name).strip()
    name = re.sub(r'[^a-zA-Z0-9\s]', '', name)
    name = re.sub(r'\s+', ' ', name).strip()
    return name.lower()

def check_existing_variations(name, year, dest_dir):
    normalized_name = normalize_name(name)
    log_message(f"Checking existing variations for: {name} ({year})", level="DEBUG")
    exact_match = None
    partial_matches = []

    for root, dirs, _ in os.walk(dest_dir):
        for d in dirs:
            normalized_d = normalize_name(d)
            d_year = extract_year(d)

            # Prioritize exact matches
            if normalized_name == normalized_d and (d_year == year or not year or not d_year):
                log_message(f"Found exact matching variation: {d}", level="DEBUG")
                return d

            # Collect partial matches with stricter criteria
            if (normalized_name in normalized_d or normalized_d in normalized_name) and abs(len(normalized_name) - len(normalized_d)) < 5:
                partial_matches.append((d, d_year))

    if partial_matches:
        # Select the best partial match based on length and year
        closest_match = min(partial_matches, key=lambda x: (len(x[0]), x[1] != year))
        log_message(f"Found closest matching variation: {closest_match[0]}", level="DEBUG")
        return closest_match[0]

    log_message(f"No matching variations found for: {name} ({year})", level="DEBUG")
    return None

def build_dest_index(dest_dir):
    dest_index = set()
    for root, dirs, files in os.walk(dest_dir):
        for name in dirs + files:
            dest_index.add(os.path.join(root, name))
    return dest_index

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

def standardize_title(title):
    replacements = {
        '0': 'o', '1': 'i', '4': 'a', '5': 's', '7': 't', '9': 'g',
        '@': 'a', '#': 'h', '$': 's', '%': 'p', '&': 'and', '*': 'x',
        '3': 'e'
    }

    def replacement_func(match):
        char = match.group(0)
        standardized_char = replacements.get(char, char)
        return standardized_char

    # Count words with non-standard characters
    words = re.findall(r'\b\w+\b', title)
    affected_count = sum(
        1 for word in words if re.search(r'[014579@#$%&*3]', word)
    )

    # Standardize title if more than 4 words are affected
    if affected_count > 4:
        standardized_title = re.sub(r'[0-9@#$%&*3]', replacement_func, title)
    else:
        standardized_title = title

    # Clean up extra spaces
    standardized_title = re.sub(r'\s+', ' ', standardized_title).strip()
    return standardized_title

def process_show(src_file, root, file, dest_dir, actual_dir, tmdb_folder_id_enabled, rename_enabled, auto_select, dest_index):
    episode_match = re.search(r'(.*?)(S\d{2}E\d{2}|S\d{2}e\d{2}|[0-9]+x[0-9]+|S\d{2}[0-9]+|[0-9]+e[0-9]+|ep\.\d+)', file, re.IGNORECASE)
    episode_identifier = episode_match.group(2)
    parent_folder_name = os.path.basename(root)

    # Extract show name and season number
    if re.match(r'S\d{2}[eE]\d{2}', episode_identifier):
        show_name = re.sub(r'\s*(S\d{2}.*|Season \d+).*', '', parent_folder_name).replace('-', ' ').replace('.', ' ').strip()
    elif re.match(r'[0-9]+x[0-9]+', episode_identifier):
        show_name = episode_match.group(1).replace('.', ' ').strip()
        season_number = re.search(r'([0-9]+)x', episode_identifier).group(1)
        episode_identifier = f"S{season_number}E{episode_identifier.split('x')[1]}"
    elif re.match(r'S\d{2}[0-9]+', episode_identifier):
        show_name = episode_match.group(1).replace('.', ' ').strip()
        episode_identifier = f"S{episode_identifier[1:3]}E{episode_identifier[3:]}"
    elif re.match(r'[0-9]+e[0-9]+', episode_identifier):
        show_name = episode_match.group(1).replace('.', ' ').strip()
        episode_identifier = f"S{episode_identifier[0:2]}E{episode_identifier[2:]}"
    elif re.match(r'ep\.\d+', episode_identifier, re.IGNORECASE):
        show_name = episode_match.group(1).replace('.', ' ').strip()
        episode_number = re.search(r'ep\.(\d+)', episode_identifier, re.IGNORECASE).group(1)
        season_number = re.search(r'S(\d{2})', parent_folder_name, re.IGNORECASE)
        season_number = season_number.group(1) if season_number else "01"
        episode_identifier = f"S{season_number}E{episode_number}"
    else:
        show_name = episode_match.group(1).replace('.', ' ').strip()
        season_number = "01"
        episode_identifier = "S01E01"

    # Extract season number
    season_number = re.search(r'S(\d{2})E\d{2}', episode_identifier, re.IGNORECASE)
    if season_number:
        season_number = season_number.group(1)
    else:
        # Attempt to extract season from episode identifier if not found
        season_number = re.search(r'([0-9]+)', episode_identifier)
        season_number = season_number.group(1) if season_number else "01"

    season_folder = f"Season {int(season_number)}"

    show_folder = re.sub(r'\s+$|_+$|-+$|(\()$', '', show_name)
    show_folder = show_folder.rstrip()

    if show_folder.isdigit() and len(show_folder) <= 4:
        year = None
    else:
        year = extract_folder_year(parent_folder_name) or extract_year(show_folder)
        if year:
            show_folder = re.sub(r'\(\d{4}\)$', '', show_folder).strip()
            show_folder = re.sub(r'\d{4}$', '', show_folder).strip()

    api_key = get_api_key()
    if api_key:
        proper_show_name = search_tv_show(show_folder, year, auto_select=auto_select)
        if "TMDb API error" in proper_show_name:
            log_message(f"Could not find TV show in TMDb or TMDb API error: {show_folder} ({year})", level="ERROR")
            proper_show_name = show_folder
        if tmdb_folder_id_enabled:
            show_folder = proper_show_name
        else:
            show_folder = re.sub(r' \{tmdb-\d+\}$', '', proper_show_name)
    else:
        show_folder = show_folder

    show_folder = show_folder.replace('/', '')

    # Add year to show_folder if not present
    if year and f"({year})" not in show_folder:
        show_folder = f"{show_folder} ({year})"

    # Check for existing variations
    existing_variation = check_existing_variations(show_folder, year, dest_dir)
    if existing_variation:
        log_message(f"Found existing variation for {show_folder}: {existing_variation}", level="INFO")
        show_folder = existing_variation

    # Determine resolution-specific folder for shows
    resolution = extract_resolution_from_filename(file)

    # Handle remux files
    if 'remux' in file.lower():
        if '2160' in file or '4k':
            resolution_folder = 'UltraHDRemuxShows'
        elif '1080' in file:
            resolution_folder = '1080pRemuxLibrary'
        else:
            resolution_folder = 'RemuxShows'
    # Handle standard resolutions
    else:
        if resolution in ['2160p', '4k']:
            resolution_folder = 'UltraHD'
        elif resolution == '1080p':
            resolution_folder = 'FullHD'
        elif resolution == '720p':
            resolution_folder = 'SDClassics'
        elif resolution == '480p':
            resolution_folder = 'Retro480p'
        elif resolution == 'DVD':
            resolution_folder = 'RetroDVD'
        else:
            resolution_folder = 'Shows'

    dest_path = os.path.join(dest_dir, 'CineSync', 'Shows', resolution_folder, show_folder, season_folder)

    os.makedirs(dest_path, exist_ok=True)

    if rename_enabled:
        # Fetch and print episode name
        tmdb_id_match = re.search(r'\{tmdb-(\d+)\}$', proper_show_name)
        if tmdb_id_match:
            show_id = tmdb_id_match.group(1)
            if episode_number:
                episode_name = get_episode_name(show_id, int(season_number), int(episode_number))
                if episode_name:
                    new_name = f"{show_name} - S{season_number}E{episode_number} - {episode_name}{os.path.splitext(file)[1]}"
                    log_message(f"Renaming {file} to {new_name} based on episode name {episode_name}", level="INFO")
                else:
                    new_name = f"{show_name} - S{season_number}E{episode_number}{os.path.splitext(file)[1]}"
                    log_message(f"Episode name not found for {file}, renaming to {new_name}", level="WARNING")
            else:
                new_name = f"{show_name} - {episode_identifier}{os.path.splitext(file)[1]}"
        else:
            new_name = f"{show_name} - {episode_identifier}{os.path.splitext(file)[1]}"

        # Ensure no double dashes in the filename
        new_name = re.sub(r' - - ', ' - ', new_name)
    else:
        new_name = file

    dest_file = os.path.join(dest_path, new_name)
    return dest_file

def process_movie(src_file, root, file, dest_dir, actual_dir, tmdb_folder_id_enabled, rename_enabled, auto_select, dest_index):
    parent_folder_name = os.path.basename(root)
    movie_name, year = extract_movie_name_and_year(parent_folder_name)

    if not movie_name:
        log_message(f"Unable to extract movie name and year from: {parent_folder_name}", level="ERROR")
        return

    movie_name = standardize_title(movie_name)
    log_message(f"Searching for movie: {movie_name} ({year})", level="DEBUG")

    collection_info = None
    api_key = get_api_key()
    if api_key and is_movie_collection_enabled():
        proper_movie_name = search_movie(movie_name, year, auto_select=auto_select)
        if "TMDb API error" not in proper_movie_name:
            tmdb_id_match = re.search(r'\{tmdb-(\d+)\}$', proper_movie_name)
            if tmdb_id_match:
                movie_id = tmdb_id_match.group(1)
                collection_info = get_movie_collection(movie_id=movie_id)
            else:
                collection_info = get_movie_collection(movie_title=movie_name, year=year)
        else:
            log_message(f"Could not find movie in TMDb or TMDb API error: {movie_name} ({year})", level="ERROR")
            proper_movie_name = f"{movie_name} ({year})"
    elif api_key:
        proper_movie_name = search_movie(movie_name, year, auto_select=auto_select)
        if "TMDb API error" in proper_movie_name:
            log_message(f"Could not find movie in TMDb or TMDb API error: {movie_name} ({year})", level="ERROR")
            proper_movie_name = f"{movie_name} ({year})"
    else:
        proper_movie_name = f"{movie_name} ({year})"

    log_message(f"Found movie: {proper_movie_name}", level="INFO")

    if collection_info and is_movie_collection_enabled():
        collection_name, collection_id = collection_info
        log_message(f"Movie belongs to collection: {collection_name}", level="INFO")
        resolution_folder = 'Movie Collections'
        collection_folder = f"{collection_name} {{tmdb-{collection_id}}}"
        movie_folder = proper_movie_name
    else:
        collection_folder = None
        if tmdb_folder_id_enabled:
            log_message(f"TMDB_FOLDER_ID enabled: {is_tmdb_folder_id_enabled()}", level="DEBUG")
            movie_folder = proper_movie_name
        else:
            log_message(f"TMDB_FOLDER_ID not enabled: {is_tmdb_folder_id_enabled()}", level="DEBUG")
            movie_folder = re.sub(r' \{tmdb-\d+\}$', '', proper_movie_name)

        movie_folder = movie_folder.replace('/', '')

    # Add year to movie_folder if not present
    if year and f"({year})" not in movie_folder:
        movie_folder = f"{movie_folder} ({year})"

    # Check for existing variations
    existing_variation = check_existing_variations(movie_folder, year, dest_dir)
    if existing_variation:
        log_message(f"Found existing variation for {movie_folder}: {existing_variation}", level="INFO")
        movie_folder = existing_variation

    # Determine resolution-specific folder if not already set (for collections)
    if 'resolution_folder' not in locals():
        resolution = extract_resolution_from_filename(file)

        # Check for remux files first
        if 'remux' in file.lower():
            if resolution in ['2160p', '4k']:
                resolution_folder = '4KRemux'
            elif resolution == '1080p':
                resolution_folder = '1080pRemux'
            else:
                resolution_folder = 'MoviesRemux'
        else:
            # Handle non-remux files
            if resolution in ['2160p', '4k']:
                resolution_folder = 'UltraHD'
            elif resolution == '1080p':
                resolution_folder = 'FullHD'
            elif resolution == '720p':
                resolution_folder = 'SDMovies'
            elif resolution == '480p':
                resolution_folder = 'Retro480p'
            elif resolution == 'DVD':
                resolution_folder = 'DVDClassics'
            else:
                resolution_folder = 'Movies'

        # Check for existing variations
        if collection_info:
            existing_variation = check_existing_variations(collection_folder, None, dest_dir)
        else:
            existing_variation = check_existing_variations(movie_folder, year, dest_dir)

    if existing_variation:
        log_message(f"Found existing variation for {collection_folder if collection_info else movie_folder}: {existing_variation}", level="INFO")
        if collection_info:
            collection_folder = existing_variation
        else:
            movie_folder = existing_variation

    if collection_info:
        dest_path = os.path.join(dest_dir, 'CineSync', 'Movies', resolution_folder, collection_folder, movie_folder)
    else:
        dest_path = os.path.join(dest_dir, 'CineSync', 'Movies', resolution_folder, movie_folder)

    os.makedirs(dest_path, exist_ok=True)

    if rename_enabled:
        new_name = f"{os.path.basename(proper_movie_name)}{os.path.splitext(file)[1]}"
    else:
        new_name = file

    dest_file = os.path.join(dest_path, new_name)
    return dest_file

def process_file(args):
    src_file, root, file, dest_dir, actual_dir, tmdb_folder_id_enabled, rename_enabled, auto_select, dest_index = args

    # Check if symlink already exists
    symlink_exists = any(os.path.islink(full_dest_file) and os.readlink(full_dest_file) == src_file for full_dest_file in dest_index)

    if symlink_exists:
        log_message(f"Symlink already exists for {os.path.basename(file)}", level="INFO")
        return

    # Check for episode format (e.g., S01E01, S01e01, 1x02 ...)
    episode_match = re.search(r'(.*?)(S\d{2}E\d{2}|S\d{2}e\d{2}|[0-9]+x[0-9]+|S\d{2}[0-9]+|[0-9]+e[0-9]+|ep\.\d+)', file, re.IGNORECASE)

    if episode_match:
        dest_file = process_show(src_file, root, file, dest_dir, actual_dir, tmdb_folder_id_enabled, rename_enabled, auto_select, dest_index)
    else:
        dest_file = process_movie(src_file, root, file, dest_dir, actual_dir, tmdb_folder_id_enabled, rename_enabled, auto_select, dest_index)

    # Ensure the destination directory exists
    os.makedirs(os.path.dirname(dest_file), exist_ok=True)

    if os.path.islink(dest_file):
        if os.readlink(dest_file) == src_file:
            log_message(f"Symlink already exists for {os.path.basename(dest_file)}", level="INFO")
            return
        else:
            os.remove(dest_file)

    if os.path.exists(dest_file) and not os.path.islink(dest_file):
        log_message(f"File already exists at destination: {os.path.basename(dest_file)}", level="INFO")
        return

    if os.path.isdir(src_file):
        shutil.copytree(src_file, dest_file, symlinks=True)
    else:
        os.symlink(src_file, dest_file)

    log_message(f"Created symlink: {dest_file} -> {src_file}", level="DEBUG")
    log_message(f"Processed file: {src_file} to {dest_file}", level="INFO")

def create_symlinks(src_dirs, dest_dir, auto_select=False, single_path=None):
    os.makedirs(dest_dir, exist_ok=True)
    tmdb_folder_id_enabled = is_tmdb_folder_id_enabled()
    rename_enabled = is_rename_enabled()

    if single_path:
        src_dirs = [single_path]

    # Build destination index once
    dest_index = build_dest_index(dest_dir)

    tasks = []
    with ThreadPoolExecutor(max_workers=cpu_count()) as executor:
        for src_dir in src_dirs:
            actual_dir = os.path.basename(os.path.normpath(src_dir))
            log_message(f"Scanning source directory: {src_dir} (actual: {actual_dir})", level="INFO")

            for root, _, files in os.walk(src_dir):
                for file in files:
                    src_file = os.path.join(root, file)
                    args = (src_file, root, file, dest_dir, actual_dir, tmdb_folder_id_enabled, rename_enabled, auto_select, dest_index)
                    tasks.append(executor.submit(process_file, args))

        # Wait for all tasks to complete
        for task in tasks:
            task.result()

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Create symlinks for files from src_dirs in dest_dir.")
    parser.add_argument("--auto-select", action="store_true", help="Automatically chooses the first option without prompting the user")
    parser.add_argument("single_path", nargs="?", help="Single path to process instead of using SOURCE_DIRS from environment variables")
    args = parser.parse_args()

    src_dirs, dest_dir = get_directories()
    if not src_dirs or not dest_dir:
        log_message("Source or destination directory not set in environment variables.", level="ERROR")
        exit(1)

    create_symlinks(src_dirs, dest_dir, auto_select=args.auto_select, single_path=args.single_path)
