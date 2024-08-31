import os
import re
import requests
from utils.file_utils import extract_movie_name_and_year, extract_resolution_from_filename, check_existing_variations, standardize_title, remove_genre_names, clean_query
from api.tmdb_api import search_movie, get_movie_collection
from utils.logging_utils import log_message
from config.config import is_movie_collection_enabled, is_tmdb_folder_id_enabled, is_rename_enabled, get_api_key, offline_mode

# Global variables to track API key state
global api_key
global api_warning_logged
global offline_mode

def process_movie(src_file, root, file, dest_dir, actual_dir, tmdb_folder_id_enabled, rename_enabled, auto_select, dest_index):
    global offline_mode

    parent_folder_name = os.path.basename(root)
    movie_name, year = extract_movie_name_and_year(parent_folder_name)
    if not movie_name:
        log_message(f"Unable to extract movie name and year from: {parent_folder_name}", level="ERROR")
        return

    movie_name = standardize_title(movie_name)
    log_message(f"Searching for movie: {movie_name} ({year})", level="DEBUG")
    movie_name, none  = clean_query(movie_name)

    collection_info = None
    api_key = get_api_key()
    if api_key and is_movie_collection_enabled():
        result = search_movie(movie_name, year, auto_select=auto_select)
        if isinstance(result, dict):
            proper_movie_name = f"{result['title']} ({result.get('release_date', '').split('-')[0]}) {{tmdb-{result['id']}}}"
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
            proper_movie_name = f"{result['title']} ({result.get('release_date', '').split('-')[0]}) {{tmdb-{result['id']}}}"
        else:
            if not offline_mode:
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

    # Check for existing variations
    existing_variation = check_existing_variations(movie_folder, year, dest_dir)
    if existing_variation:
        log_message(f"Found existing variation for {movie_folder}: {existing_variation}", level="INFO")
        movie_folder = existing_variation

    # Determine resolution-specific folder if not already set (for collections)
    if 'resolution_folder' not in locals():
        resolution = extract_resolution_from_filename(file)

        # Check for remux files first
        resolution = extract_resolution_from_filename(file)
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
                '4k': 'UltraHD',
                '1080p': 'FullHD',
                '720p': 'SDMovies',
                '480p': 'Retro480p',
                'DVD': 'DVDClassics'
            }.get(resolution, 'Movies')

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
