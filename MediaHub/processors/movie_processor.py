import os
import re
import json
import requests
from dotenv import load_dotenv, find_dotenv
from MediaHub.utils.file_utils import *
from MediaHub.api.tmdb_api import search_movie, determine_tmdb_media_type
from MediaHub.utils.logging_utils import log_message
from MediaHub.config.config import *
from MediaHub.utils.mediainfo import *
from MediaHub.api.tmdb_api_helpers import get_movie_data
from MediaHub.processors.symlink_utils import load_skip_patterns, should_skip_file
from MediaHub.utils.meta_extraction_engine import get_ffprobe_media_info
from MediaHub.processors.db_utils import track_file_failure

# Retrieve base_dir and skip patterns from environment variables
source_dirs = os.getenv('SOURCE_DIR', '').split(',')

def process_movie(src_file, root, file, dest_dir, actual_dir, tmdb_folder_id_enabled, rename_enabled, auto_select, dest_index, tmdb_id=None, imdb_id=None, file_metadata=None, movie_data=None, manual_search=False):

    # Initialize variables
    is_kids_content = False
    is_anime_genre = False
    proper_name = None
    proper_movie_name = None
    collection_info = None

    # Determine source folder for source structure
    if is_source_structure_enabled():
        source_folder = None
        for source_dir in source_dirs:
            source_dir = source_dir.strip()
            if source_dir and root.startswith(source_dir):
                source_folder = os.path.basename(source_dir)
                break
        if not source_folder:
            source_folder = os.path.basename(os.path.dirname(root))
    else:
        source_folder = os.path.basename(os.path.dirname(root))
    parent_folder_name = os.path.basename(src_file)

    if should_skip_file(parent_folder_name):
        track_file_failure(src_file, None, None, "File skipped", f"File skipped based on skip patterns: {parent_folder_name}")
        return None, None

    # Use passed metadata if available, otherwise parse (avoid redundant parsing)
    if file_metadata:
        movie_result = file_metadata
    else:
        movie_result = clean_query(parent_folder_name)

    # Extract movie information
    movie_name = movie_result.get('title', '')
    year = movie_result.get('year') or extract_year(parent_folder_name)
    episode_info = movie_result.get('episode_identifier')

    # Extract language and quality from movie_result
    languages = movie_result.get('languages', [])
    language = ', '.join(languages) if isinstance(languages, list) and languages else None

    resolution_info = movie_result.get('resolution', '')
    quality_source = movie_result.get('quality_source', '')
    quality_parts = [part for part in [resolution_info, quality_source] if part]
    quality = ' '.join(quality_parts) if quality_parts else None

    # If episode_info is found, this might be a TV show misclassified as movie
    if episode_info:
        print(f"DEBUG: WARNING - Movie processor detected episode info: {episode_info}. This might be a TV show!")

    if not movie_name:
        log_message(f"Unable to extract movie name from: {parent_folder_name}", level="ERROR")
        track_file_failure(src_file, None, None, "Name extraction failed", f"Unable to extract movie name from: {parent_folder_name}")
        return None, None

    movie_name = standardize_title(movie_name)
    log_message(f"Searching for movie: {movie_name} ({year})", level="DEBUG")

    collection_info = None
    proper_name = movie_name
    is_anime_genre = False

    # If movie_data is provided from manual search, use it directly
    if movie_data:
        log_message(f"Using pre-selected movie data from manual search: {movie_data.get('title', 'Unknown')}", level="INFO")
        proper_name = movie_data.get('title', movie_name)
        release_date = movie_data.get('release_date', '')
        year = release_date.split('-')[0] if release_date else year
        tmdb_id = movie_data.get('id')

        # Format the proper movie name
        proper_movie_name = f"{proper_name} ({year})"
        if is_tmdb_folder_id_enabled() and tmdb_id:
            proper_movie_name += f" {{tmdb-{tmdb_id}}}"

        # Get collection info if enabled
        if is_movie_collection_enabled() and tmdb_id:
            movie_data = get_movie_data(tmdb_id)
            collection_name = movie_data.get('collection_name')
            collection_info = (collection_name, tmdb_id) if collection_name else None

    elif is_movie_collection_enabled():


        result = search_movie(movie_name, year, auto_select=auto_select, actual_dir=actual_dir, file=file, tmdb_id=tmdb_id, imdb_id=imdb_id, manual_search=manual_search)
        if result is None or isinstance(result, str):
            log_message(f"TMDB search failed for movie: {movie_name} ({year}). Skipping movie processing.", level="WARNING")
            track_file_failure(src_file, None, None, "TMDB search failed", f"No TMDB results found for movie: {movie_name} ({year})")
            return None, None
        if isinstance(result, (tuple, dict)):
            if isinstance(result, tuple):
                tmdb_id, imdb_id, proper_name, movie_year, is_anime_genre = result[:5]
                is_kids_content = result[5] if len(result) > 5 else False
            elif isinstance(result, dict):
                proper_name = result['title']
                year = result.get('release_date', '').split('-')[0]
                tmdb_id = result['id']
                is_kids_content = False

            proper_movie_name = f"{proper_name} ({year})"
            if is_tmdb_folder_id_enabled():
                proper_movie_name += f" {{tmdb-{tmdb_id}}}"

            # Get collection info from optimized movie data
            if tmdb_id:
                movie_data = get_movie_data(tmdb_id)
                collection_name = movie_data.get('collection_name')
                collection_info = (collection_name, tmdb_id) if collection_name else None

                # Use TMDB language as fallback if not available from file metadata
                if not language:
                    language = movie_data.get('original_language')
            else:
                collection_info = None
        else:
            log_message(f"TMDB search returned unexpected result type for movie: {movie_name} ({year}). Skipping movie processing.", level="WARNING")
            track_file_failure(src_file, None, None, "TMDB search failed", f"Unexpected TMDB result type for movie: {movie_name} ({year})")
            return None, None
    else:


        result = search_movie(movie_name, year, auto_select=auto_select, file=file, tmdb_id=tmdb_id, imdb_id=imdb_id, actual_dir=actual_dir, root=root, manual_search=manual_search)
        if result is None or isinstance(result, str):
            log_message(f"TMDB search failed for movie: {movie_name} ({year}). Skipping movie processing.", level="WARNING")
            track_file_failure(src_file, None, None, "TMDB search failed", f"No TMDB results found for movie: {movie_name} ({year})")
            return None, None

        elif isinstance(result, tuple) and len(result) >= 6:
            tmdb_id, imdb_id, proper_name, movie_year, is_anime_genre, is_kids_content = result
            year = result[3] if result[3] is not None else year
            proper_movie_name = f"{proper_name} ({year})"
            if is_tmdb_folder_id_enabled() and tmdb_id:
                proper_movie_name += f" {{tmdb-{tmdb_id}}}"
            if is_imdb_folder_id_enabled() and imdb_id:
                proper_movie_name += f" {{imdb-{imdb_id}}}"

            # Get TMDB language as fallback if not available from file metadata
            if not language and tmdb_id:
                movie_data = get_movie_data(tmdb_id)
                if movie_data:
                    language = movie_data.get('original_language')

        elif isinstance(result, dict):
            proper_movie_name = f"{result['title']} ({result.get('release_date', '').split('-')[0]})"
            # Initialize is_kids_content for dict results
            is_kids_content = False
            if is_imdb_folder_id_enabled() and 'imdb_id' in result:
                proper_movie_name += f" {{imdb-{result['imdb_id']}}}"
            elif is_tmdb_folder_id_enabled():
                proper_movie_name += f" {{tmdb-{result['id']}}}"

            # Get TMDB language as fallback if not available from file metadata
            if not language and result.get('id'):
                movie_data = get_movie_data(result['id'])
                if movie_data:
                    language = movie_data.get('original_language')
        else:
            log_message(f"TMDB search returned unexpected result type for movie: {movie_name} ({year}). Skipping movie processing.", level="WARNING")
            track_file_failure(src_file, None, None, "TMDB search failed", f"Unexpected TMDB result type for movie: {movie_name} ({year})")
            return None, None

    log_message(f"Found movie: {proper_movie_name}", level="INFO")
    movie_folder = proper_movie_name.replace('/', '-')



    # Extract resolution from filename and parent folder
    file_resolution = extract_resolution_from_filename(file)
    folder_resolution = extract_resolution_from_folder(root)
    resolution = file_resolution or folder_resolution

    # Resolution folder determination logic
    resolution_folder = get_movie_resolution_folder(file, resolution)

    # Check if file is 4K/2160p for custom layout selection
    is_4k = ('2160' in file or
             re.search(r'\b4k\b', file, re.IGNORECASE))

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
                if custom_movie_layout() or custom_4kmovie_layout():
                    if is_movie_resolution_structure_enabled():
                        if is_anime_genre and is_anime_separation_enabled():
                            anime_base = custom_anime_movie_layout() if custom_anime_movie_layout() else os.path.join('CineSync', 'AnimeMovies')
                            dest_path = os.path.join(dest_dir, anime_base, resolution_folder, movie_folder)
                        else:
                            movie_base = custom_movie_layout() if custom_movie_layout() else os.path.join('CineSync', 'Movies')
                            dest_path = os.path.join(dest_dir, movie_base, resolution_folder, movie_folder)
                    else:
                        if is_kids_content and is_kids_separation_enabled():
                            kids_base = custom_kids_movie_layout() if custom_kids_movie_layout() else os.path.join('CineSync', 'KidsMovies')
                            dest_path = os.path.join(dest_dir, kids_base, movie_folder)
                        elif is_anime_genre and is_anime_separation_enabled():
                            anime_base = custom_anime_movie_layout() if custom_anime_movie_layout() else os.path.join('CineSync', 'AnimeMovies')
                            dest_path = os.path.join(dest_dir, anime_base, movie_folder)
                        elif is_4k and is_4k_separation_enabled():
                            movie_4k_base = custom_4kmovie_layout() if custom_4kmovie_layout() else os.path.join('CineSync', '4KMovies')
                            dest_path = os.path.join(dest_dir, movie_4k_base, movie_folder)
                        else:
                            movie_base = custom_movie_layout() if custom_movie_layout() else os.path.join('CineSync', 'Movies')
                            dest_path = os.path.join(dest_dir, movie_base, movie_folder)
                else:
                    if is_movie_resolution_structure_enabled():
                        if is_kids_content and is_kids_separation_enabled():
                            dest_path = os.path.join(dest_dir, 'CineSync', 'KidsMovies', resolution_folder, movie_folder)
                        elif is_anime_genre and is_anime_separation_enabled():
                            dest_path = os.path.join(dest_dir, 'CineSync', 'AnimeMovies', resolution_folder, movie_folder)
                        else:
                            dest_path = os.path.join(dest_dir, 'CineSync', 'Movies', resolution_folder, movie_folder)
                    else:
                        if is_kids_content and is_kids_separation_enabled():
                            dest_path = os.path.join(dest_dir, 'CineSync', 'KidsMovies', movie_folder)
                        elif is_anime_genre and is_anime_separation_enabled():
                            dest_path = os.path.join(dest_dir, 'CineSync', 'AnimeMovies', movie_folder)
                        elif is_4k and is_4k_separation_enabled():
                            dest_path = os.path.join(dest_dir, 'CineSync', '4KMovies', movie_folder)
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
                    if is_kids_content and is_kids_separation_enabled():
                        dest_path = os.path.join(dest_dir, 'CineSync', 'KidsMovies', resolution_folder, movie_folder)
                    elif is_anime_genre and is_anime_separation_enabled():
                        dest_path = os.path.join(dest_dir, 'CineSync', 'AnimeMovies', resolution_folder, movie_folder)
                    else:
                        dest_path = os.path.join(dest_dir, 'CineSync', 'Movies', resolution_folder, movie_folder)
                else:
                    if is_kids_content and is_kids_separation_enabled():
                        dest_path = os.path.join(dest_dir, 'CineSync', 'KidsMovies', movie_folder)
                    elif is_anime_genre and is_anime_separation_enabled():
                        dest_path = os.path.join(dest_dir, 'CineSync', 'AnimeMovies', movie_folder)
                    else:
                        dest_path = os.path.join(dest_dir, 'CineSync', 'Movies', movie_folder)
            else:
                if is_kids_content and is_kids_separation_enabled():
                    dest_path = os.path.join(dest_dir, 'CineSync', 'KidsMovies', movie_folder)
                elif is_anime_genre and is_anime_separation_enabled():
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

    if is_rename_enabled():
        use_media_parser = mediainfo_parser()

        # Get media info
        if use_media_parser:
            media_info = get_ffprobe_media_info(os.path.join(root, file))
            tags_to_use = get_mediainfo_tags()
        else:
            # Fall back to filename-based media info extraction
            media_info = extract_media_info(file, keywords)
            # Include folder-based resolution if not already present
            if resolution and 'Resolution' not in media_info:
                media_info['Resolution'] = resolution
            tags_to_use = get_rename_tags()

        # Remove ID tag from the movie name and extract ID tag if needed
        clean_movie_name = re.sub(r' \{(?:tmdb|imdb)-\w+\}$', '', proper_movie_name)
        id_tag = ''

        # Handle ID tags with RENAME_TAGS only (not for MEDIAINFO_TAGS)
        if not use_media_parser:
            if 'TMDB' in tags_to_use:
                id_tag_match = re.search(r'\{tmdb-\w+\}', proper_movie_name)
                id_tag = id_tag_match.group(0) if id_tag_match else ''
            elif 'IMDB' in tags_to_use:
                id_tag_match = re.search(r'\{imdb-\w+\}', proper_movie_name)
                id_tag = id_tag_match.group(0) if id_tag_match else ''

        # Extract media details with appropriate format based on which tags we're using
        details_str = ''

        if use_media_parser:
            tag_strings = []
            quality_info = ""
            custom_formats = media_info.get('Custom Formats', '')
            other_tags = []

            # First, extract specific categories we want to handle separately
            for tag in tags_to_use:
                tag = tag.strip()
                clean_tag = tag.replace('{', '').replace('}', '').strip()

                if clean_tag == 'Quality Full' and 'Quality Full' in media_info:
                    quality_info = media_info['Quality Full']
                elif clean_tag == 'Quality Title' and 'Quality Title' in media_info:
                    quality_info = media_info['Quality Title']
                elif clean_tag == 'Custom Formats' and 'Custom Formats' in media_info:
                    custom_formats = media_info['Custom Formats']
                elif clean_tag in media_info:
                    value = media_info[clean_tag]
                    if isinstance(value, list):
                        formatted_value = '+'.join([str(item).upper() for item in value])
                        other_tags.append(formatted_value)
                    else:
                        other_tags.append(value)
                else:
                    parts = clean_tag.split()
                    if len(parts) > 1 and parts[0] in media_info:
                        compound_key = clean_tag
                        value = media_info.get(compound_key, '')
                        if value:
                            other_tags.append(value)

            # Build the details string with proper ordering - other tags first, then custom formats, then quality
            details_parts = []

            # Add regular media info
            if other_tags:
                details_parts.extend(other_tags)

            combined_info = []

            # Normalize and filter custom formats
            if custom_formats:
                if isinstance(custom_formats, str):
                    formats = custom_formats.split()
                elif isinstance(custom_formats, list):
                    formats = []
                    for fmt in custom_formats:
                        formats.extend(fmt.split())
            else:
                formats = []

            if len(formats) > 1:
                formats = [fmt for fmt in formats if fmt.lower() != 'bluray']

            combined_info.extend(formats)

            if quality_info:
                combined_info.append(quality_info)

            if combined_info:
                combined_str = '-'.join(combined_info)
                details_parts.append(combined_str)

            details_str = ' '.join(details_parts)
            enhanced_movie_folder = f"{clean_movie_name} {details_str}".strip()

        else:
            tag_strings = []
            release_group = ""

            for tag in tags_to_use:
                tag = tag.strip()
                if tag not in ['TMDB', 'IMDB'] and tag in media_info:
                    value = media_info[tag]

                    if tag.lower() in ['releasegroup', 'release group']:
                        release_group = str(value)
                    else:
                        if isinstance(value, list):
                            formatted_value = '+'.join([str(language).upper() for language in value])
                            tag_strings.append(f"[{formatted_value}]")
                        else:
                            tag_strings.append(f"[{value}]")
            if release_group:
                tag_strings.append(f"-{release_group}")

            details_str = ''.join(tag_strings)

            # Construct new filename only if there are details or an ID tag
            if id_tag and details_str:
                enhanced_movie_folder = f"{clean_movie_name} {id_tag} - {details_str}".strip()
            elif id_tag:
                enhanced_movie_folder = f"{clean_movie_name} {id_tag}".strip()
            elif details_str:
                enhanced_movie_folder = f"{clean_movie_name} - {details_str}".strip()
            else:
                enhanced_movie_folder = clean_movie_name

        new_name = f"{enhanced_movie_folder}{os.path.splitext(file)[1]}"
    else:
        new_name = file

    dest_file = os.path.join(dest_path, new_name)

    # Extract clean name from proper_name which may include TMDB/IMDB IDs
    clean_name = proper_name
    extracted_year = movie_year or year

    # Parse proper_name to extract clean name and year
    if proper_name:
        clean_name = re.sub(r'\s*\{[^}]+\}', '', proper_name)

        if not extracted_year:
            year_match = re.search(r'\((\d{4})\)', clean_name)
            if year_match:
                extracted_year = year_match.group(1)

        clean_name = re.sub(r'\s*\(\d{4}\)', '', clean_name).strip()

    # Return all fields including language and quality
    return (dest_file, tmdb_id, 'Movie', clean_name, str(extracted_year) if extracted_year else None,
            None, imdb_id, 1 if is_anime_genre else 0, is_kids_content, language, quality)
