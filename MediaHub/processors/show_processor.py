import os
import re
import requests
from dotenv import load_dotenv, find_dotenv
from MediaHub.utils.file_utils import extract_resolution_from_filename, clean_query, extract_year, extract_resolution_from_folder

from MediaHub.api.tmdb_api import search_tv_show
from MediaHub.utils.logging_utils import log_message
from MediaHub.config.config import *
from MediaHub.processors.anime_processor import is_anime_file, process_anime_show
from MediaHub.utils.file_utils import *
from MediaHub.utils.mediainfo import *
from MediaHub.api.tmdb_api_helpers import get_episode_name
from MediaHub.processors.db_utils import track_file_failure

# Retrieve base_dir from environment variables
source_dirs = os.getenv('SOURCE_DIR', '').split(',')

def process_show(src_file, root, file, dest_dir, actual_dir, tmdb_folder_id_enabled, rename_enabled, auto_select, dest_index, episode_match, tmdb_id=None, imdb_id=None, tvdb_id=None, season_number=None, episode_number=None, is_anime_show=False, force_extra=False, file_metadata=None):

    if any(root == source_dir.strip() for source_dir in source_dirs):
        parent_folder_name = os.path.basename(root)
        source_folder = next(source_dir.strip() for source_dir in source_dirs if root == source_dir.strip())
    else:
        parent_folder_name = os.path.basename(root)
        source_folder = os.path.basename(os.path.dirname(root))

    source_folder = os.path.basename(source_folder)

    # Use passed metadata if available, otherwise parse
    if file_metadata:
        file_result = file_metadata
    else:
        file_result = clean_query(file)

    # Store original parameters before they get overwritten by file parsing
    original_season_number = season_number
    original_episode_number = episode_number

    # Use file result if it has episode info OR season info, otherwise try folder
    if file_result.get('episode_identifier') or file_result.get('season_number'):
        show_name = file_result.get('title', '')
        episode_identifier = file_result.get('episode_identifier')
        # Only use parsed values if no original parameters were provided
        if original_season_number is None:
            season_number = file_result.get('season_number')
        if original_episode_number is None:
            episode_number = file_result.get('episode_number')
        create_season_folder = file_result.get('create_season_folder', False)
        is_extra = file_result.get('is_extra', False)

        if episode_identifier:
            log_message(f"Using file-based extraction: {show_name} - {episode_identifier}", level="DEBUG")
        elif season_number:
            log_message(f"Using file-based extraction for season pack: {show_name} - Season {season_number}", level="DEBUG")
        else:
            log_message(f"Using file-based extraction: {show_name}", level="DEBUG")
    else:
        # Fallback to folder only if file doesn't have episode OR season info
        folder_result = clean_query(parent_folder_name)
        log_message(f"Folder query result: {folder_result}", level="DEBUG")

        show_name = folder_result.get('title', '')
        episode_identifier = folder_result.get('episode_identifier')
        # Only use parsed values if no original parameters were provided
        if original_season_number is None:
            season_number = folder_result.get('season_number')
        if original_episode_number is None:
            episode_number = folder_result.get('episode_number')
        create_season_folder = folder_result.get('create_season_folder', False)
        is_extra = folder_result.get('is_extra', False)

        # Check if file metadata has is_extra flag set
        if file_result and file_result.get('is_extra'):
            is_extra = True

        if episode_identifier:
            log_message(f"Using folder-based extraction: {show_name} - {episode_identifier}", level="DEBUG")
        else:
            log_message(f"No episode info found, using folder name: {show_name}", level="DEBUG")

    # Restore original parameters if they were provided
    if original_season_number is not None:
        season_number = original_season_number
    if original_episode_number is not None:
        episode_number = original_episode_number

    # Initialize remaining variables
    new_name = file
    year = None
    show_id = None
    episode_title = None
    proper_show_name = None
    anime_result = None
    create_extras_folder = False
    resolution = None
    is_anime_genre = False
    season_folder = None

    # Override with function parameters if provided
    if season_number is not None:
        season_number = str(season_number).zfill(2)
    if episode_number is not None:
        episode_number = str(episode_number).zfill(2)

    # If we have both season and episode numbers from command line, create episode_identifier
    if season_number is not None and episode_number is not None and not episode_identifier:
        episode_identifier = f"S{season_number}E{episode_number}"
        create_season_folder = True

    if is_anime_show or is_anime_scan() and is_anime_file(file):
        anime_result = process_anime_show(src_file, root, file, dest_dir, actual_dir,
                                        tmdb_folder_id_enabled, rename_enabled, tmdb_id, imdb_id, tvdb_id, auto_select, season_number, episode_number, file_metadata)

        if anime_result is None:
            log_message(f"API returned None for show: {show_name} ({year}). Skipping show processing.", level="WARNING")
            return None

        if not anime_result:
            log_message(f"Skipping from Anime Check: {file}", level="DEBUG")
            anime_result = {}

    if anime_result:
        show_name = anime_result.get('show_name', '')
        season_number = anime_result.get('season_number', None)
        new_name = anime_result.get('new_name', file)
        year = anime_result.get('year')
        show_id = anime_result.get('show_id')
        episode_title = anime_result.get('episode_title')
        episode_number = anime_result.get('episode_number')
        resolution = anime_result.get('resolution')
        is_anime_genre = anime_result.get('is_anime_genre')
        is_extra = anime_result.get('is_extra')
        tmdb_id = anime_result.get('tmdb_id')

        # Update episode info from anime result if available
        episode_match = re.search(r'S(\d+)E(\d+)', new_name, re.IGNORECASE)
        if episode_match:
            season_number = episode_match.group(1)
            episode_identifier = f"S{season_number}E{episode_match.group(2)}"
            episode_number = episode_match.group(2)
            create_season_folder = True

    # Handle season-only files (like "S01" without episode number)
    if not episode_identifier and season_number and not anime_result:
        log_message(f"Found season info but no episode info for: {file}. Creating season folder.", level="DEBUG")
        create_season_folder = True
        # Don't mark as extra since we have season info

    # If we don't have episode info AND no season info and it's not anime, mark as extra
    elif not episode_identifier and not season_number and not anime_result and not force_extra:
        log_message(f"Unable to determine season and episode info for: {file}", level="DEBUG")
        create_extras_folder = True
        is_extra = True

    # Extract year from parent folder or show name for TMDb search
    year = extract_year(parent_folder_name) or extract_year(show_name)

    # Set initial show_folder for processing
    show_folder = show_name

    # Handle anime result override
    if anime_result:
        show_folder = anime_result.get('show_name', '')
        proper_show_name = show_folder
    else:
        proper_show_name = show_folder
    if not anime_result:
        # Retry logic for show name extraction
        max_retries = 2
        retry_count = 0
        result = None

        while retry_count < max_retries and result is None:
            retry_count += 1
            log_message(f"TMDb show search attempt {retry_count}/{max_retries} for: {show_folder} ({year})", level="DEBUG")

            result = search_tv_show(show_folder, year, auto_select=auto_select, actual_dir=actual_dir, file=file, root=root, episode_match=episode_match, tmdb_id=tmdb_id, imdb_id=imdb_id, tvdb_id=tvdb_id, season_number=season_number, episode_number=episode_number, is_extra=is_extra, force_extra=force_extra)

            if result is None and retry_count < max_retries:
                import time
                wait_time = 2
                log_message(f"TMDb search failed, retrying in {wait_time} seconds...", level="WARNING")
                time.sleep(wait_time)

        # Check final result after all retries
        if result is None:
            log_message(f"TMDb API failed after {max_retries} attempts for show: {show_name} ({year}). Skipping show processing.", level="ERROR")
            track_file_failure(src_file, None, None, "TMDb API failure", f"TMDb API failed after {max_retries} attempts for show: {show_name} ({year})")
            return None
        elif isinstance(result, tuple) and len(result) == 6:
            proper_show_name, show_name, is_anime_genre, season_number, episode_number, tmdb_id = result
            episode_identifier = f"S{season_number}E{episode_number}"
        else:
            log_message(f"TMDb returned invalid data for show: {show_folder} ({year}). Skipping show processing.", level="ERROR")
            track_file_failure(src_file, None, None, "TMDb invalid data", f"TMDb returned invalid data for show: {show_folder} ({year})")
            return None

        # Validate that we got a proper show name from TMDb
        if not proper_show_name or proper_show_name.strip() == "" or "TMDb API error" in str(proper_show_name):
            log_message(f"TMDb could not provide valid show name for: {show_folder} ({year}). Skipping show processing.", level="ERROR")
            return None

        if is_tmdb_folder_id_enabled():
            show_folder = proper_show_name
        elif is_imdb_folder_id_enabled():
            show_folder = re.sub(r' \{tmdb-.*?\}$', '', proper_show_name)
        else:
            show_folder = re.sub(r' \{(?:tmdb|imdb)-.*?\}$', '', proper_show_name)
    else:
        show_folder = show_folder

    show_folder = show_folder.replace('/', '')

    # Determine resolution-specific folder for shows
    if anime_result and anime_result.get('resolution'):
        resolution = anime_result['resolution']
    else:
        resolution = extract_resolution_from_filename(file) or extract_resolution_from_folder(root)
        if not resolution:
            log_message(f"Resolution could not be extracted from filename or folder name. Defaulting to 'Shows'.", level="DEBUG")
            resolution = 'Shows'

    # Replace the existing resolution folder determination logic with:
    resolution_folder = get_show_resolution_folder(file, resolution)

    # Check if file is 4K/2160p
    is_4k = '2160' in resolution or '4k' in resolution.lower() or '4K' in resolution

    # Modified destination path determination
    if is_extra:
        if is_cinesync_layout_enabled():
            if custom_show_layout() or custom_4kshow_layout():
                if is_show_resolution_structure_enabled():
                    if is_anime_genre and is_anime_separation_enabled():
                        anime_base = custom_anime_show_layout() if custom_anime_show_layout() else os.path.join('CineSync', 'AnimeShows')
                        base_dest_path = os.path.join(dest_dir, anime_base, resolution_folder, show_folder, 'Extras')
                    else:
                        show_base = custom_show_layout() if custom_show_layout() else os.path.join('CineSync', 'Shows')
                        base_dest_path = os.path.join(dest_dir, show_base, resolution_folder, show_folder, 'Extras')
                else:
                    if is_anime_genre and is_anime_separation_enabled():
                        anime_base = custom_anime_show_layout() if custom_anime_show_layout() else os.path.join('CineSync', 'AnimeShows')
                        base_dest_path = os.path.join(dest_dir, anime_base, show_folder, 'Extras')
                    else:
                        show_base = custom_show_layout() if custom_show_layout() else os.path.join('CineSync', 'Shows')
                        base_dest_path = os.path.join(dest_dir, show_base, show_folder, 'Extras')
            else:
                if is_anime_genre and is_anime_separation_enabled():
                    base_dest_path = os.path.join(dest_dir, 'CineSync', 'AnimeShows', show_folder, 'Extras')
                elif is_4k and is_4k_separation_enabled():
                    base_dest_path = os.path.join(dest_dir, 'CineSync', '4KShows', show_folder, 'Extras')
                else:
                    base_dest_path = os.path.join(dest_dir, 'CineSync', 'Shows', show_folder, 'Extras')
        elif is_source_structure_enabled():
            if is_show_resolution_structure_enabled():
                if is_anime_genre and is_anime_separation_enabled():
                    base_dest_path = os.path.join(dest_dir, 'CineSync', source_folder, 'AnimeShows', resolution_folder, show_folder, 'Extras')
                else:
                    base_dest_path = os.path.join(dest_dir, 'CineSync', source_folder, resolution_folder, show_folder, 'Extras')
            else:
                if is_anime_genre and is_anime_separation_enabled():
                    base_dest_path = os.path.join(dest_dir, 'CineSync', source_folder, 'AnimeShows', show_folder, 'Extras')
                else:
                    base_dest_path = os.path.join(dest_dir, 'CineSync', source_folder, show_folder, 'Extras')
        else:
            if is_anime_genre and is_anime_separation_enabled():
                base_dest_path = os.path.join(dest_dir, 'CineSync', 'AnimeShows', 'Extras', show_folder)
            elif is_4k and is_4k_separation_enabled():
                base_dest_path = os.path.join(dest_dir, 'CineSync', '4KShows', 'Extras', show_folder)
            else:
                base_dest_path = os.path.join(dest_dir, 'CineSync', 'Shows', 'Extras', show_folder)

        season_dest_path = base_dest_path
    else:
        if is_cinesync_layout_enabled():
            if custom_show_layout() or custom_4kshow_layout():
                if is_show_resolution_structure_enabled():
                    if is_anime_genre and is_anime_separation_enabled():
                        anime_base = custom_anime_show_layout() if custom_anime_show_layout() else os.path.join('CineSync', 'AnimeShows')
                        base_dest_path = os.path.join(dest_dir, anime_base, resolution_folder, show_folder)
                        extras_base_dest_path = os.path.join(dest_dir, anime_base, resolution_folder, show_folder)
                    else:
                        show_base = custom_show_layout() if custom_show_layout() else os.path.join('CineSync', 'Shows')
                        base_dest_path = os.path.join(dest_dir, show_base, resolution_folder, show_folder)
                        extras_base_dest_path = os.path.join(dest_dir, show_base, resolution_folder, show_folder)
                else:
                    if is_anime_genre and is_anime_separation_enabled():
                        anime_base = custom_anime_show_layout() if custom_anime_show_layout() else os.path.join('CineSync', 'AnimeShows')
                        base_dest_path = os.path.join(dest_dir, anime_base, show_folder)
                        extras_base_dest_path = os.path.join(dest_dir, anime_base, show_folder)
                    elif is_4k and is_4k_separation_enabled():
                        show_4k_base = custom_4kshow_layout() if custom_4kshow_layout() else os.path.join('CineSync', '4KShows')
                        base_dest_path = os.path.join(dest_dir, show_4k_base, show_folder)
                        extras_base_dest_path = os.path.join(dest_dir, show_4k_base, show_folder)
                    else:
                        show_base = custom_show_layout() if custom_show_layout() else os.path.join('CineSync', 'Shows')
                        base_dest_path = os.path.join(dest_dir, show_base, show_folder)
                        extras_base_dest_path = os.path.join(dest_dir, show_base, show_folder)
            else:
                if is_show_resolution_structure_enabled():
                    if is_anime_genre and is_anime_separation_enabled():
                        base_dest_path = os.path.join(dest_dir, 'CineSync', 'AnimeShows', resolution_folder, show_folder)
                        extras_base_dest_path = os.path.join(dest_dir, 'CineSync', 'AnimeShows', resolution_folder, show_folder)
                    else:
                        base_dest_path = os.path.join(dest_dir, 'CineSync', 'Shows', resolution_folder, show_folder)
                        extras_base_dest_path = os.path.join(dest_dir, 'CineSync', 'Shows', resolution_folder, show_folder)
                else:
                    if is_anime_genre and is_anime_separation_enabled():
                        base_dest_path = os.path.join(dest_dir, 'CineSync', 'AnimeShows', show_folder)
                        extras_base_dest_path = os.path.join(dest_dir, 'CineSync', 'AnimeShows', show_folder)
                    elif is_4k and is_4k_separation_enabled():
                        base_dest_path = os.path.join(dest_dir, 'CineSync', '4KShows', show_folder)
                        extras_base_dest_path = os.path.join(dest_dir, 'CineSync', '4KShows', show_folder)
                    else:
                        base_dest_path = os.path.join(dest_dir, 'CineSync', 'Shows', show_folder)
                        extras_base_dest_path = os.path.join(dest_dir, 'CineSync', 'Shows', show_folder)
        elif is_source_structure_enabled():
            if is_show_resolution_structure_enabled():
                base_dest_path = os.path.join(dest_dir, 'CineSync', source_folder, resolution_folder, show_folder)
                extras_base_dest_path = os.path.join(dest_dir, 'CineSync', source_folder, resolution_folder, show_folder)
            else:
                base_dest_path = os.path.join(dest_dir, 'CineSync', source_folder, show_folder)
                extras_base_dest_path = os.path.join(dest_dir, 'CineSync', source_folder, show_folder)
        else:
            if is_anime_genre and is_anime_separation_enabled():
                base_dest_path = os.path.join(dest_dir, 'CineSync', 'AnimeShows', show_folder)
                extras_base_dest_path = os.path.join(dest_dir, 'CineSync', 'AnimeShows', 'Extras', show_folder)
            elif is_4k and is_4k_separation_enabled():
                base_dest_path = os.path.join(dest_dir, 'CineSync', '4KShows', show_folder)
                extras_base_dest_path = os.path.join(dest_dir, 'CineSync', '4KShows', 'Extras', show_folder)
            else:
                base_dest_path = os.path.join(dest_dir, 'CineSync', 'Shows', show_folder)
                extras_base_dest_path = os.path.join(dest_dir, 'CineSync', 'Shows', 'Extras', show_folder)

        # Use anime season number if available, otherwise use the default season handling
        if anime_result:
            season_dest_path = os.path.join(base_dest_path, f"Season {int(anime_result.get('season_number', '01'))}")
        else:
            season_dest_path = os.path.join(base_dest_path, f"Season {int(season_number)}")

    # Function to check if show folder exists in any resolution folder
    def find_show_folder_in_resolution_folders():
        if is_show_resolution_structure_enabled():
            base_path = os.path.join(dest_dir, custom_show_layout()) if custom_show_layout() else os.path.join(dest_dir, 'CineSync', 'Shows')
            resolution_folders = [get_show_resolution_folder(file, resolution)]
            for res_folder in resolution_folders:
                show_folder_path = os.path.join(base_path, res_folder, show_folder)
                if os.path.isdir(show_folder_path):
                    return show_folder_path
        else:
            resolution_folders = [get_show_resolution_folder(file, resolution)]
            for res_folder in resolution_folders:
                show_folder_path = os.path.join(dest_dir, 'CineSync', 'Shows', res_folder, show_folder)
                if os.path.isdir(show_folder_path):
                    return show_folder_path
        return None

    # Check for existing show folder and update paths
    existing_show_folder_path = find_show_folder_in_resolution_folders()
    if existing_show_folder_path:
        extras_dest_path = os.path.join(existing_show_folder_path, 'Extras')

    # Extract media information and Rename files
    media_info = extract_media_info(file, keywords, root)
    if anime_result and rename_enabled:
        dest_file = os.path.join(season_dest_path, new_name)
    else:
        if episode_identifier and rename_enabled and not is_extra:
            tmdb_id_match = re.search(r'\{tmdb-(\d+)\}$', proper_show_name)
            if tmdb_id_match:
                show_id = tmdb_id_match.group(1)
                episode_number_match = re.search(r'E(\d+)', episode_identifier, re.IGNORECASE)

                if episode_number_match:
                    episode_number = episode_number_match.group(1)
                    episode_name, mapped_season, mapped_episode = get_episode_name(show_id, int(season_number), int(episode_number))

                    if episode_name:
                        base_name = f"{show_name} - {episode_name}".replace(' - -', ' -')
                        log_message(f"Renaming {file}", level="INFO")
                    else:
                        base_name = f"{show_name} - S{season_number}E{episode_number}"
                else:
                    base_name = f"{show_name} - {episode_identifier}"
            else:
                base_name = f"{show_name} - {episode_identifier}"

            if is_rename_enabled() and get_rename_tags():
                media_info = extract_media_info(file, keywords, root)
                details = []

                for tag in get_rename_tags():
                    tag = tag.strip()
                    if tag in media_info:
                        value = media_info[tag]

                        if isinstance(value, list):
                            formatted_value = '+'.join([str(language).upper() for language in value])
                            details.append(f"[{formatted_value}]")
                        else:
                            details.append(f"[{value}]")

                new_name = f"{base_name} {''.join(details)}{os.path.splitext(file)[1]}"
            else:
                new_name = f"{base_name}{os.path.splitext(file)[1]}"

            new_name = re.sub(r'-{2,}', '-', new_name).strip('-')
            dest_file = os.path.join(season_dest_path, new_name)
        else:
            dest_file = os.path.join(season_dest_path, file)

    return dest_file, tmdb_id, season_number, is_extra
