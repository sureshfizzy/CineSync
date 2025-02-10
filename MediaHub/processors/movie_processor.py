import os
import re
import json
import requests
from dotenv import load_dotenv, find_dotenv
from MediaHub.utils.file_utils import *
from MediaHub.api.tmdb_api import search_movie
from MediaHub.utils.logging_utils import log_message
from MediaHub.config.config import *
from MediaHub.utils.mediainfo import *
from MediaHub.api.tmdb_api_helpers import get_movie_collection

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

def process_movie(src_file, root, file, dest_dir, actual_dir, tmdb_folder_id_enabled, rename_enabled, auto_select, dest_index, tmdb_id=None, imdb_id=None):
    global offline_mode

    source_folder = os.path.basename(os.path.dirname(root))
    parent_folder_name = os.path.basename(src_file)

    # Check if folder should be skipped
    if should_skip_file(parent_folder_name):
        return None

    movie_name, year = extract_movie_name_and_year(parent_folder_name)
    if not movie_name:
        log_message(f"Attempting secondary extraction: {parent_folder_name}", level="DEBUG")
        movie_name, year = clean_query_movie(parent_folder_name)
        if not movie_name:
            log_message(f"Unable to extract movie name and year from: {parent_folder_name}", level="ERROR")
            return

    movie_name = standardize_title(movie_name)
    log_message(f"Searching for movie: {movie_name} ({year})", level="DEBUG")
    movie_name, none = clean_query(movie_name)

    collection_info = None
    api_key = get_api_key()
    proper_name = movie_name
    is_anime_genre = False

    if api_key and is_movie_collection_enabled():
        result = search_movie(movie_name, year, auto_select=auto_select, actual_dir=actual_dir, file=file, tmdb_id=tmdb_id, imdb_id=imdb_id)
        if isinstance(result, (tuple, dict)):
            if isinstance(result, tuple):
                tmdb_id, imdb_id, proper_name, movie_year, is_anime_genre = result
            elif isinstance(result, dict):
                proper_name = result['title']
                year = result.get('release_date', '').split('-')[0]
                tmdb_id = result['id']

            proper_movie_name = f"{proper_name} ({year})"
            if is_tmdb_folder_id_enabled():
                proper_movie_name += f" {{tmdb-{tmdb_id}}}"

            tmdb_id_match = re.search(r'\{tmdb-(\d+)\}$', proper_movie_name)
            if tmdb_id_match:
                movie_id = tmdb_id_match.group(1)
                collection_info = get_movie_collection(movie_id=movie_id)
            else:
                collection_info = get_movie_collection(movie_title=movie_name, year=year)
        else:
            proper_movie_name = f"{movie_name} ({year})"
    elif api_key:
        result = search_movie(movie_name, year, auto_select=auto_select, file=file, tmdb_id=tmdb_id, imdb_id=imdb_id)
        year = result[3] if result[3] is not None else year
        if isinstance(result, tuple) and len(result) == 5:
            tmdb_id, imdb_id, proper_name, movie_year, is_anime_genre = result
            proper_movie_name = f"{proper_name} ({year})"
            if is_tmdb_folder_id_enabled() and tmdb_id:
                proper_movie_name += f" {{tmdb-{tmdb_id}}}"
            if is_imdb_folder_id_enabled() and imdb_id:
                proper_movie_name += f" {{imdb-{imdb_id}}}"
        elif isinstance(result, dict):
            proper_movie_name = f"{result['title']} ({result.get('release_date', '').split('-')[0]})"
            if is_imdb_folder_id_enabled() and 'imdb_id' in result:
                proper_movie_name += f" {{imdb-{result['imdb_id']}}}"
            elif is_tmdb_folder_id_enabled():
                proper_movie_name += f" {{tmdb-{result['id']}}}"
        else:
            proper_movie_name = f"{proper_name} ({year})"
    else:
        proper_movie_name = f"{movie_name} ({year})"

    log_message(f"Found movie: {proper_movie_name}", level="INFO")
    movie_folder = proper_movie_name.replace('/', '-')

    # Determine resolution-specific folder
    resolution = extract_resolution_from_filename(file)

    # Resolution folder determination logic
    resolution_folder = get_movie_resolution_folder(file, resolution)

    # Determine destination path based on various configurations
    if is_source_structure_enabled() or is_cinesync_layout_enabled():
        if collection_info and is_movie_collection_enabled():
            collection_name, collection_id = collection_info
            log_message(f"Movie belongs to collection: {collection_name}", level="INFO")
            resolution_folder = get_movie_collections_folder()
            collection_folder = f"{collection_name} {{tmdb-{collection_id}}}"
            dest_path = os.path.join(dest_dir, 'CineSync', resolution_folder ,collection_folder, movie_folder)
        else:
            if is_cinesync_layout_enabled():
                if custom_movie_layout():
                    if is_movie_resolution_structure_enabled():
                        if is_anime_genre and is_anime_separation_enabled():
                            anime_base = custom_anime_movie_layout() if custom_anime_movie_layout() else os.path.join('CineSync', 'AnimeMovies')
                            dest_path = os.path.join(dest_dir, anime_base, resolution_folder, movie_folder)
                        else:
                            dest_path = os.path.join(dest_dir, custom_movie_layout(), resolution_folder, movie_folder)
                    else:
                        if is_anime_genre and is_anime_separation_enabled():
                            anime_base = custom_anime_movie_layout() if custom_anime_movie_layout() else os.path.join('CineSync', 'AnimeMovies')
                            dest_path = os.path.join(dest_dir, anime_base, movie_folder)
                        else:
                            dest_path = os.path.join(dest_dir, custom_movie_layout(), movie_folder)
                else:
                    if is_movie_resolution_structure_enabled():
                        if is_anime_genre and is_anime_separation_enabled():
                            dest_path = os.path.join(dest_dir, 'CineSync', 'AnimeMovies', resolution_folder, movie_folder)
                        else:
                            dest_path = os.path.join(dest_dir, 'CineSync', 'Movies', resolution_folder, movie_folder)
                    else:
                        if is_anime_genre and is_anime_separation_enabled():
                            dest_path = os.path.join(dest_dir, 'CineSync', 'AnimeMovies', movie_folder)
                        else:
                            dest_path = os.path.join(dest_dir, 'CineSync', 'Movies', movie_folder)
            else:
                if is_movie_resolution_structure_enabled():
                    dest_path = os.path.join(dest_dir, 'CineSync', source_folder, resolution_folder, movie_folder)
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
            if tmdb_folder_id_enabled:
                movie_folder = proper_movie_name
            elif is_imdb_folder_id_enabled():
                movie_folder = re.sub(r' \{tmdb-.*?\}$', '', proper_movie_name)
            else:
                movie_folder = re.sub(r' \{(?:tmdb|imdb)-.*?\}$', '', proper_movie_name)

            movie_folder = movie_folder.replace('/', '')

            # Set destination path for non-collection movies
            if is_cinesync_layout_enabled():
                if is_movie_resolution_structure_enabled():
                    if is_anime_genre and is_anime_separation_enabled():
                        dest_path = os.path.join(dest_dir, 'CineSync', 'AnimeMovies', resolution_folder, movie_folder)
                    else:
                        dest_path = os.path.join(dest_dir, 'CineSync', 'Movies', resolution_folder, movie_folder)
                else:
                    if is_anime_genre and is_anime_separation_enabled():
                        dest_path = os.path.join(dest_dir, 'CineSync', 'AnimeMovies', movie_folder)
                    else:
                        dest_path = os.path.join(dest_dir, 'CineSync', 'Movies', movie_folder)
            else:
                if is_anime_genre and is_anime_separation_enabled():
                    dest_path = os.path.join(dest_dir, 'CineSync', 'AnimeMovies', movie_folder)
                else:
                    dest_path = os.path.join(dest_dir, 'CineSync', 'Movies', movie_folder)

    # Function to check if movie folder exists in any resolution folder
    def find_movie_folder_in_resolution_folders():
        if is_movie_resolution_structure_enabled():
            base_path = os.path.join(dest_dir, custom_movie_layout()) if custom_movie_layout() else os.path.join(dest_dir, 'CineSync', 'Movies')
            resolution_folders = [get_movie_resolution_folder(file, resolution)]
            for res_folder in resolution_folders:
                movie_folder_path = os.path.join(base_path, res_folder, movie_folder)
                if os.path.isdir(movie_folder_path):
                    return movie_folder_path
        return None

    # Check for existing movie in other resolution folders
    existing_folder = find_movie_folder_in_resolution_folders()
    if existing_folder:
        log_message(f"Found existing movie folder in different resolution: {existing_folder}", level="INFO")

    os.makedirs(dest_path, exist_ok=True)

    # Extract media information for renaming
    media_info = extract_media_info(file, keywords)

    # Optionally append extracted media information to movie folder name
    if media_info:
        if 'Resolution' in media_info:
            movie_folder += f" [{media_info['Resolution']}]"
        if 'VideoCodec' in media_info:
            movie_folder += f" [{media_info['VideoCodec']}]"
        if 'AudioCodec' in media_info:
            movie_folder += f" [{media_info['AudioCodec']}]"
        if 'AudioChannels' in media_info:
            movie_folder += f" [{media_info['AudioChannels']}]"
        if 'AudioAtmos' in media_info:
            movie_folder += f" [Atmos]"

    # Initialize 'details' with media info extracted from the filename
    details = extract_media_info(file, keywords)
    details = [detail for detail in details if detail]

    enhanced_movie_folder = f"{proper_movie_name} [{' '.join(details)}]".strip()

    if is_rename_enabled() and get_rename_tags():
        media_info = extract_media_info(file, keywords)
        details = []
        id_tag = ''

        # Extract ID tag only if TMDB or IMDB is in RENAME_TAGS
        rename_tags = get_rename_tags()
        if 'TMDB' in rename_tags:
            id_tag_match = re.search(r'\{tmdb-\w+\}', proper_movie_name)
            id_tag = id_tag_match.group(0) if id_tag_match else ''
        elif 'IMDB' in rename_tags:
            id_tag_match = re.search(r'\{imdb-\w+\}', proper_movie_name)
            id_tag = id_tag_match.group(0) if id_tag_match else ''

        # Remove ID tag from the movie name
        clean_movie_name = re.sub(r' \{(?:tmdb|imdb)-\w+\}$', '', proper_movie_name)

        # Extract media details
        details = []
        for tag in rename_tags:
            tag = tag.strip()
            if tag not in ['TMDB', 'IMDB'] and tag in media_info:
                value = media_info[tag]
                if isinstance(value, list):
                    formatted_value = '+'.join([str(language).upper() for language in value])
                    details.append(f"[{formatted_value}]")
                else:
                    details.append(f"[{value}]")

        details_str = ''.join(details)

        # Construct new filename only if there are details or an ID tag
        if id_tag or details_str:
            if id_tag and details_str:
                enhanced_movie_folder = f"{clean_movie_name} {id_tag} - {details_str}".strip()
            elif id_tag:
                enhanced_movie_folder = f"{clean_movie_name} {id_tag}".strip()
            else:
                enhanced_movie_folder = f"{clean_movie_name} - {details_str}".strip()

        new_name = f"{enhanced_movie_folder}{os.path.splitext(file)[1]}"
    else:
        new_name = file

    dest_file = os.path.join(dest_path, new_name)
    return dest_file
