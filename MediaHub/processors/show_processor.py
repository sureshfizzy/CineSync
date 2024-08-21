import os
import re
from utils.file_utils import extract_resolution_from_filename, extract_folder_year, clean_query, extract_year
from api.tmdb_api import search_tv_show, get_episode_name
from utils.logging_utils import log_message
from config.config import is_skip_extras_folder_enabled, get_api_key

def process_show(src_file, root, file, dest_dir, actual_dir, tmdb_folder_id_enabled, rename_enabled, auto_select, dest_index, episode_match):
    parent_folder_name = os.path.basename(root)
    clean_folder_name, _ = clean_query(parent_folder_name)

    # Initialize variables
    show_name = ""
    season_number = "01"
    create_season_folder = False
    create_extras_folder = False

    if episode_match:
        episode_identifier = episode_match.group(2)
        if re.match(r'S\d{2}[eE]\d{2}', episode_identifier):
            show_name = re.sub(r'\s*(S\d{2}.*|Season \d+).*', '', clean_folder_name).replace('-', ' ').replace('.', ' ').strip()
            create_season_folder = True
        elif re.match(r'[0-9]+x[0-9]+', episode_identifier):
            show_name = episode_match.group(1).replace('.', ' ').strip()
            season_number = re.search(r'([0-9]+)x', episode_identifier).group(1)
            episode_identifier = f"S{season_number}E{episode_identifier.split('x')[1]}"
            create_season_folder = True
        elif re.match(r'S\d{2}[0-9]+', episode_identifier):
            show_name = episode_match.group(1).replace('.', ' ').strip()
            episode_identifier = f"S{episode_identifier[1:3]}E{episode_identifier[3:]}"
            create_season_folder = True
        elif re.match(r'[0-9]+e[0-9]+', episode_identifier):
            show_name = episode_match.group(1).replace('.', ' ').strip()
            episode_identifier = f"S{episode_identifier[0:2]}E{episode_identifier[2:]}"
            create_season_folder = True
        elif re.match(r'Ep\.?\s*\d+', episode_identifier, re.IGNORECASE):
            show_name = episode_match.group(1).replace('.', ' ').strip()
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
        season_number = re.search(r'S(\d{2})E\d{2}', episode_identifier, re.IGNORECASE)
        if season_number:
            season_number = season_number.group(1)
        else:
            season_number = re.search(r'([0-9]+)', episode_identifier)
            season_number = season_number.group(1) if season_number else "01"
    else:
        # For non-episode files, use the parent folder name as the show name
        show_name = clean_folder_name
        # Try to extract season number from the parent folder name
        season_match = re.search(r'S(\d{2})|Season\s*(\d+)', parent_folder_name, re.IGNORECASE)
        if season_match:
            season_number = season_match.group(1) or season_match.group(2)
        else:
            season_number = "01"
        create_extras_folder = True

    season_folder = f"Season {int(season_number)}"

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

    # Determine resolution-specific folder for shows
    resolution = extract_resolution_from_filename(file)
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
        }.get(resolution, 'Shows')

    # Define paths
    base_dest_path = os.path.join(dest_dir, 'CineSync', 'Shows', resolution_folder, show_folder)
    season_dest_path = os.path.join(base_dest_path, season_folder)
    extras_base_dest_path = os.path.join(dest_dir, 'CineSync', 'Shows', 'Extras', show_folder)
    extras_dest_path = os.path.join(extras_base_dest_path, 'Extras')

    # Function to check if show folder exists in any resolution folder
    def find_show_folder_in_resolution_folders():
        for res_folder in ['UltraHD', 'FullHD', 'SDClassics', 'Retro480p', 'RetroDVD', 'Shows']:
            show_folder_path = os.path.join(dest_dir, 'CineSync', 'Shows', res_folder, show_folder)
            if os.path.isdir(show_folder_path):
                return show_folder_path
        return None

    # Check for existing show folder and update paths
    existing_show_folder_path = find_show_folder_in_resolution_folders()
    if existing_show_folder_path:
        extras_dest_path = os.path.join(existing_show_folder_path, 'Extras')

        # Check if SKIP_EXTRAS_FOLDER is enabled
        if is_skip_extras_folder_enabled() and create_extras_folder:
            log_message(f"Skipping symlinking of extras file: {file} due to SKIP_EXTRAS_FOLDER being enabled.", level="INFO")
            return  # Exit without processing extras folder files
        else:
            # Only create Extras folder if it doesn't exist and is needed
            if create_extras_folder and not os.path.exists(extras_dest_path):
                os.makedirs(extras_dest_path, exist_ok=True)
            dest_file = os.path.join(extras_dest_path, file)
    else:
        # Create Extras folder only if files are being placed inside it and SKIP_EXTRAS_FOLDER is not enabled
        if create_extras_folder and not is_skip_extras_folder_enabled():
            os.makedirs(extras_base_dest_path, exist_ok=True)
            dest_file = os.path.join(extras_dest_path, file)
        else:
            dest_file = os.path.join(base_dest_path, file)

    if episode_match:
        if rename_enabled:
            tmdb_id_match = re.search(r'\{tmdb-(\d+)\}$', proper_show_name)
            if tmdb_id_match:
                show_id = tmdb_id_match.group(1)
                episode_number = re.search(r'E(\d+)', episode_identifier).group(1)
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
            new_name = re.sub(r'-{2,}', '-', new_name).strip('-')
            dest_file = os.path.join(season_dest_path, new_name)
        else:
            dest_file = os.path.join(season_dest_path, file)

    return dest_file
