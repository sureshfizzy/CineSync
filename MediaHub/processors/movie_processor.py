import os
import re
import json
import requests
from utils.file_utils import extract_movie_name_and_year, extract_resolution_from_filename, check_existing_variations, standardize_title, remove_genre_names, clean_query
from api.tmdb_api import search_movie, get_movie_collection
from utils.logging_utils import log_message
from config.config import is_movie_collection_enabled, is_tmdb_folder_id_enabled, is_rename_enabled, get_api_key, offline_mode, is_imdb_folder_id_enabled, is_source_structure_enabled, is_skip_patterns_enabled
from dotenv import load_dotenv, find_dotenv

# Global variables to track API key state
global api_key
global api_warning_logged
global offline_mode

# Retrieve base_dir and skip patterns from environment variables
source_dirs = os.getenv('SOURCE_DIR', '').split(',')

def load_skip_patterns():
    """Load skip patterns from keywords.json in utils folder"""
    try:
        current_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        keywords_path = os.path.join(current_dir, 'utils', 'keywords.json')

        with open(keywords_path, 'r') as f:
            data = json.load(f)
            return data.get('skip_patterns', [])
    except Exception as e:
        log_message(f"Error loading skip patterns from keywords.json: {str(e)}", level="ERROR")
        return []

SKIP_PATTERNS = load_skip_patterns()

def should_skip_file(filename):
    """
    Check if the file should be skipped based on patterns from keywords.json
    """
    if not is_skip_patterns_enabled():
        return False

    for pattern in SKIP_PATTERNS:
        try:
            if re.match(pattern, filename, re.IGNORECASE):
                log_message(f"Skipping file due to pattern match in Adult Content {filename}", level="INFO")
                return True
        except re.error as e:
            log_message(f"Invalid regex pattern '{pattern}': {str(e)}", level="ERROR")
            continue
    return False

def process_movie(src_file, root, file, dest_dir, actual_dir, tmdb_folder_id_enabled, rename_enabled, auto_select, dest_index):
    global offline_mode

    if any(root == source_dir.strip() for source_dir in source_dirs):
        parent_folder_name = os.path.basename(src_file)
        source_folder = next(source_dir.strip() for source_dir in source_dirs if root == source_dir.strip())
    else:
        parent_folder_name = os.path.basename(root)
        source_folder = os.path.basename(os.path.dirname(root))

    source_folder = os.path.basename(source_folder)

    # Check if folder should be skipped
    if should_skip_file(parent_folder_name):
        return None

    movie_name, year = extract_movie_name_and_year(parent_folder_name)
    if not movie_name:
        log_message(f"Unable to extract movie name and year from: {parent_folder_name}", level="ERROR")
        return

    movie_name = standardize_title(movie_name)
    log_message(f"Searching for movie: {movie_name} ({year})", level="DEBUG")
    movie_name, none = clean_query(movie_name)

    collection_info = None
    api_key = get_api_key()
    if api_key and is_movie_collection_enabled():
        result = search_movie(movie_name, year, auto_select=auto_select)
        if isinstance(result, dict):
            proper_movie_name = f"{result['title']} ({result.get('release_date', '').split('-')[0]})"
            tmdb_id = result['id']
            if is_tmdb_folder_id_enabled():
                proper_movie_name += f" {{tmdb-{tmdb_id}}}"
            tmdb_id_match = re.search(r'\{tmdb-(\d+)\}$', proper_movie_name)
            if tmdb_id_match:
                movie_id = tmdb_id_match.group(1)
                collection_info = get_movie_collection(movie_id=movie_id)
            else:
                collection_info = get_movie_collection(movie_title=movie_name, year=year)
        else:
            if not offline_mode:
                log_message(f"Could not find movie in TMDb or TMDb API error: {movie_name} ({year})", level="ERROR")
            proper_movie_name = f"{movie_name} ({year})"
    elif api_key:
        result = search_movie(movie_name, year, auto_select=auto_select)
        if isinstance(result, dict):
            proper_movie_name = f"{result['title']} ({result.get('release_date', '').split('-')[0]})"
            if is_imdb_folder_id_enabled() and 'imdb_id' in result:
                proper_movie_name += f" {{imdb-{result['imdb_id']}}}"
            elif is_tmdb_folder_id_enabled():
                proper_movie_name += f" {{tmdb-{result['id']}}}"
        else:
            if not offline_mode:
                log_message(f"Could not find movie in TMDb or TMDb API error: {movie_name} ({year})", level="ERROR")
            proper_movie_name = f"{movie_name} ({year})"
    else:
        proper_movie_name = f"{movie_name} ({year})"

    log_message(f"Found movie: {proper_movie_name}", level="INFO")

    if is_source_structure_enabled():
        movie_folder = proper_movie_name.replace('/', '-')

        if collection_info and is_movie_collection_enabled():
            collection_name, collection_id = collection_info
            log_message(f"Movie belongs to collection: {collection_name}", level="INFO")
            resolution_folder = 'Movie Collections'
            collection_folder = f"{collection_name} {{tmdb-{collection_id}}}"
            dest_path = os.path.join(dest_dir, 'CineSync', resolution_folder ,collection_folder, movie_folder)
        else:
            dest_path = os.path.join(dest_dir, 'CineSync', source_folder, movie_folder)
    else:
        if collection_info and is_movie_collection_enabled():
            collection_name, collection_id = collection_info
            log_message(f"Movie belongs to collection: {collection_name}", level="INFO")
            resolution_folder = 'Movie Collections'
            collection_folder = f"{collection_name} {{tmdb-{collection_id}}}"
            dest_path = os.path.join(dest_dir, 'CineSync', 'Movies', resolution_folder, collection_folder, movie_folder)
        else:
            collection_folder = None
            if tmdb_folder_id_enabled:
                movie_folder = proper_movie_name
            elif is_imdb_folder_id_enabled():
                movie_folder = re.sub(r' \{tmdb-.*?\}$', '', proper_movie_name)
            else:
                movie_folder = re.sub(r' \{(?:tmdb|imdb)-.*?\}$', '', proper_movie_name)

            movie_folder = movie_folder.replace('/', '')

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
                if '2160' in file or '4k' in file.lower():
                    resolution_folder = '4KRemux'
                elif '1080' in file:
                    resolution_folder = '1080pRemux'
                else:
                    resolution_folder = 'MoviesRemux'
            else:
                resolution_folder = {
                    '2160p': 'UltraHD',
                    '1080p': 'FullHD',
                    '720p': 'SDMovies',
                    '480p': 'Retro480p',
                    'DVD': 'DVDClassics'
                }.get(resolution, 'Movies')

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
