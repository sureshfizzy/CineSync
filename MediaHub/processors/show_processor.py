import os
import re
import requests
from dotenv import load_dotenv, find_dotenv
from MediaHub.utils.file_utils import extract_resolution_from_filename, extract_folder_year, clean_query, extract_year, extract_resolution_from_folder
from MediaHub.api.tmdb_api import search_tv_show, get_episode_name
from MediaHub.utils.logging_utils import log_message
from MediaHub.config.config import *
from MediaHub.processors.anime_processor import is_anime_file, process_anime_show
from MediaHub.utils.file_utils import *
from MediaHub.utils.mediainfo import *

# Retrieve base_dir from environment variables
source_dirs = os.getenv('SOURCE_DIR', '').split(',')

# Global variables to track API key state
global api_key
global api_warning_logged
global offline_mode

def process_show(src_file, root, file, dest_dir, actual_dir, tmdb_folder_id_enabled, rename_enabled, auto_select, dest_index, episode_match):
    global offline_mode

    if any(root == source_dir.strip() for source_dir in source_dirs):
        parent_folder_name = os.path.basename(src_file)
        source_folder = next(source_dir.strip() for source_dir in source_dirs if root == source_dir.strip())
    else:
        parent_folder_name = os.path.basename(src_file)
        source_folder = os.path.basename(os.path.dirname(root))

    source_folder = os.path.basename(source_folder)

    clean_folder_name, _ = clean_query(parent_folder_name)

    is_extra = is_file_extra(file, src_file)

    # Initialize variables
    show_name = ""
    season_number = "01"
    new_name = file
    year = None
    show_id = None
    episode_title = None
    episode_identifier = None
    episode_number = None
    proper_show_name = None
    anime_result = None
    create_season_folder = False
    create_extras_folder = False
    resolution = None
    is_anime_genre = False

    if is_anime_scan()  and is_anime_file(file):
        anime_result = process_anime_show(src_file, root, file, dest_dir, actual_dir,
                                        tmdb_folder_id_enabled, rename_enabled, auto_select)

        if not anime_result:
            log_message(f"Skipping from Anime Check: {file}", level="DEBUG")
            anime_result = {}

    if anime_result:
        show_name = anime_result.get('show_name', '')
        season_number = anime_result.get('season_number', '01')
        new_name = anime_result.get('new_name', file)
        year = anime_result.get('year')
        show_id = anime_result.get('show_id')
        episode_title = anime_result.get('episode_title')
        episode_number = anime_result.get('episode_number')
        resolution = anime_result.get('resolution')
        is_anime_genre = anime_result.get('is_anime_genre')

        episode_match = re.search(r'S(\d+)E(\d+)', new_name)
        if episode_match:
            season_number = episode_match.group(1)
            episode_identifier = f"S{season_number}E{episode_match.group(2)}"
        else:
            episode_identifier = None

    if not anime_result or episode_match:
        if episode_match:
            episode_identifier = episode_match.group(2)
            series_pattern = re.search(r'series\.(\d+)\.(\d+)of\d+', file, re.IGNORECASE)
            if series_pattern:
                season_number = series_pattern.group(1).zfill(2)
                episode_number = series_pattern.group(2).zfill(2)
                episode_identifier = f"S{season_number}E{episode_number}"
                show_name = re.sub(r'\.series\.\d+\.\d+of\d+.*$', '', clean_folder_name, flags=re.IGNORECASE)
                show_name = show_name.replace('.', ' ').strip()
                create_season_folder = True
            elif re.match(r'S\d{2}[eE]\d{2}', episode_identifier, re.IGNORECASE):
                show_name = re.sub(r'\s*(S\d{2}.*|Season \d+).*', '', clean_folder_name).replace('-', ' ').replace('.', ' ').strip()
                create_season_folder = True
            elif re.match(r'[0-9]+x[0-9]+', episode_identifier, re.IGNORECASE):
                show_name = episode_match.group(1).replace('.', ' ').strip()
                season_number = re.search(r'([0-9]+)x', episode_identifier).group(1)
                episode_identifier = f"S{season_number}E{episode_identifier.split('x')[1]}"
                create_season_folder = True
            elif re.match(r'S\d{2}[0-9]+', episode_identifier, re.IGNORECASE):
                show_name = episode_match.group(1).replace('.', ' ').strip()
                episode_identifier = f"S{episode_identifier[1:3]}E{episode_identifier[3:]}"
                create_season_folder = True
            elif re.match(r'[0-9]+e[0-9]+', episode_identifier, re.IGNORECASE):
                show_name = episode_match.group(1).replace('.', ' ').strip()
                episode_identifier = f"S{episode_identifier[0:2]}E{episode_identifier[2:]}"
                create_season_folder = True
            elif re.match(r'Ep\.?\s*\d+', episode_identifier, re.IGNORECASE):
                extracted_filename = episode_match.string
                show_name = re.sub(r'^\[.*?\]\s*', '', extracted_filename).replace('.', ' ').strip()
                episode_number = re.search(r'Ep\.?\s*(\d+)', episode_identifier, re.IGNORECASE).group(1)
                season_number = re.search(r'S(\d{2})', parent_folder_name, re.IGNORECASE)
                season_number = season_number.group(1) if season_number else "01"
                episode_identifier = f"S{season_number}E{episode_number}"
                create_season_folder = True
            else:
                show_name = episode_match.group(1).replace('.', ' ').strip()
                episode_identifier = "S01E01"
                create_extras_folder = True

            # Extract season number
            season_match = re.search(r'(?:S|Season)(\d+)', clean_folder_name, re.IGNORECASE)
            if season_match:
                season_number = season_match.group(1)
            else:
                season_match = re.search(r'([0-9]+)', episode_identifier)
                season_number = season_match.group(1) if season_match else "01"
        else:
            # For non-episode files, use the parent folder name as the show name
            clean_folder_name = os.path.basename(root)
            show_name = clean_folder_name

            # Try to extract season number from the parent folder name
            season_match = re.search(r'S(\d{2})|Season\s*(\d+)', clean_folder_name, re.IGNORECASE)
            if season_match:
                season_number = season_match.group(1) or season_match.group(2)
            else:
                season_number = "01"

            create_extras_folder = True
            episode_identifier = "S01E01"

    anime_episode_pattern = re.search(r'[-\s]E(\d+)\s', file)
    if anime_episode_pattern:
        episode_number = anime_episode_pattern.group(1)
        episode_number = episode_number.zfill(2)
        season_match = re.search(r'Season\s*(\d+)', file, re.IGNORECASE)
        if season_match:
            season_number = season_match.group(1).zfill(2)
        episode_identifier = f"S{season_number}E{episode_number}"

    # Handle invalid show names by using parent folder name
    if not show_name or show_name.lower() in ["invalid name", "unknown"]:
        show_name = clean_folder_name
        show_name = re.sub(r'\s+$|_+$|-+$|(\()$', '', show_name).replace('.', ' ').strip()

    # Handle special cases for show names
    show_folder = re.sub(r'\s+$|_+$|-+$|(\()$', '', show_name).rstrip()

    # Handle year extraction and appending if necessary
    year = extract_folder_year(parent_folder_name) or extract_year(show_folder)
    if year:
        show_folder = re.sub(r'\(\d{4}\)$', '', show_folder).strip()
        show_folder = re.sub(r'\d{4}$', '', show_folder).strip()
    if anime_result:
        show_folder = anime_result.get('show_name', '')
        proper_show_name = show_folder

    # Check if API is available and not in offline mode
    api_key = get_api_key()
    proper_show_name = show_folder
    if api_key and not offline_mode and not anime_result:
        result = search_tv_show(show_folder, year, auto_select=auto_select, actual_dir=actual_dir, file=file, root=root)
        if isinstance(result, tuple) and len(result) == 3:
            proper_show_name, show_name, is_anime_genre = result
        else:
            proper_show_name = result
        if "TMDb API error" in proper_show_name:
            log_message(f"Could not find TV show in TMDb or TMDb API error: {show_folder} ({year})", level="ERROR")
            proper_show_name = show_folder

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
        resolution = extract_resolution_from_filename(file) or extract_resolution_from_folder(parent_folder_name)
        if not resolution:
            log_message(f"Resolution could not be extracted from filename or folder name. Defaulting to 'Shows'.", level="DEBUG")
            resolution = 'Shows'

    # Resolution folder determination logic remains the same as in original code
    if 'remux' in file.lower():
        if '2160' in file or '4k' in file.lower():
            resolution_folder = 'UltraHDRemuxShows'
        elif '1080' in file:
            resolution_folder = '1080pRemuxLibrary'
        else:
            resolution_folder = 'RemuxShows'
    else:
        resolution_folder = {
            '2160p': 'UltraHD',
            '4k': 'UltraHD',
            '1080p': 'FullHD',
            '720p': 'SDClassics',
            '480p': 'Retro480p',
            'DVD': 'RetroDVD'
        }.get(resolution.lower(), 'Shows')

    # Modified destination path determination
    if is_extra:
        if is_cinesync_layout_enabled():
            if custom_show_layout():
                if is_show_resolution_structure_enabled():
                    if is_anime_genre and is_anime_separation_enabled():
                        anime_base = custom_anime_show_layout() if custom_anime_show_layout() else os.path.join('CineSync', 'AnimeShows')
                        base_dest_path = os.path.join(dest_dir, anime_base, resolution_folder, show_folder, 'Extras')
                    else:
                        base_dest_path = os.path.join(dest_dir, custom_show_layout(), resolution_folder, show_folder, 'Extras')
                else:
                    if is_anime_genre and is_anime_separation_enabled():
                        anime_base = custom_anime_show_layout() if custom_anime_show_layout() else os.path.join('CineSync', 'AnimeShows')
                        base_dest_path = os.path.join(dest_dir, anime_base, show_folder, 'Extras')
                    else:
                        base_dest_path = os.path.join(dest_dir, custom_show_layout(), show_folder, 'Extras')
            else:
                if is_anime_genre and is_anime_separation_enabled():
                    base_dest_path = os.path.join(dest_dir, 'CineSync', 'AnimeShows', show_folder, 'Extras')
                else:
                    base_dest_path = os.path.join(dest_dir, 'CineSync', 'Shows', show_folder, 'Extras')
        elif is_show_source_structure_enabled():
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
            else:
                base_dest_path = os.path.join(dest_dir, 'CineSync', 'Shows', 'Extras', show_folder)

        season_dest_path = base_dest_path
    else:
        if is_cinesync_layout_enabled():
            if custom_show_layout():
                if is_show_resolution_structure_enabled():
                    if is_anime_genre and is_anime_separation_enabled():
                        anime_base = custom_anime_show_layout() if custom_anime_show_layout() else os.path.join('CineSync', 'AnimeShows')
                        base_dest_path = os.path.join(dest_dir, anime_base, resolution_folder, show_folder)
                        extras_base_dest_path = os.path.join(dest_dir, anime_base, resolution_folder, show_folder)
                    else:
                        base_dest_path = os.path.join(dest_dir, custom_show_layout(), resolution_folder, show_folder)
                        extras_base_dest_path = os.path.join(dest_dir, custom_show_layout(), resolution_folder, show_folder)
                else:
                    if is_anime_genre and is_anime_separation_enabled():
                        anime_base = custom_anime_show_layout() if custom_anime_show_layout() else os.path.join('CineSync', 'AnimeShows')
                        base_dest_path = os.path.join(dest_dir, anime_base, show_folder)
                        extras_base_dest_path = os.path.join(dest_dir, anime_base, show_folder)
                    else:
                        base_dest_path = os.path.join(dest_dir, custom_show_layout(), show_folder)
                        extras_base_dest_path = os.path.join(dest_dir, custom_show_layout(), show_folder)
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
                base_dest_path = os.path.join(dest_dir, 'CineSync', 'AnimeShows', resolution_folder, show_folder)
                extras_base_dest_path = os.path.join(dest_dir, 'CineSync', 'AnimeShows', 'Extras', show_folder)
            else:
                base_dest_path = os.path.join(dest_dir, 'CineSync', 'Shows', resolution_folder, show_folder)
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
            for res_folder in ['UltraHD', 'FullHD', 'SDClassics', 'Retro480p', 'RetroDVD', 'Shows']:
                show_folder_path = os.path.join(base_path, res_folder, show_folder)
                if os.path.isdir(show_folder_path):
                    return show_folder_path
        else:
            for res_folder in ['UltraHD', 'FullHD', 'SDClassics', 'Retro480p', 'RetroDVD', 'Shows']:
                show_folder_path = os.path.join(dest_dir, 'CineSync', 'Shows', res_folder, show_folder)
                if os.path.isdir(show_folder_path):
                    return show_folder_path
        return None

    # Check for existing show folder and update paths
    existing_show_folder_path = find_show_folder_in_resolution_folders()
    if existing_show_folder_path:
        extras_dest_path = os.path.join(existing_show_folder_path, 'Extras')

    # Check if SKIP_EXTRAS_FOLDER is enabled and handle accordingly
    if is_skip_extras_folder_enabled() and is_file_extra(file, src_file):
        log_message(f"Skipping extras file: {file} based on size and SKIP_EXTRAS_FOLDER setting", level="INFO")
        return None

    # Extract media information and Rename files
    media_info = extract_media_info(file, keywords)
    if anime_result and rename_enabled:
        dest_file = os.path.join(season_dest_path, new_name)
    else:
        if episode_identifier and rename_enabled:
            tmdb_id_match = re.search(r'\{tmdb-(\d+)\}$', proper_show_name)
            if tmdb_id_match:
                show_id = tmdb_id_match.group(1)
                episode_number_match = re.search(r'E(\d+)', episode_identifier, re.IGNORECASE)

                if episode_number_match:
                    episode_number = episode_number_match.group(1)
                    episode_name = get_episode_name(show_id, int(season_number), int(episode_number))

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
                media_info = extract_media_info(file, keywords)
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

    return dest_file
