import os
import re
import shutil
from logging_utils import log_message
from tmdb_api import search_tv_show, search_movie, get_episode_name
from file_utils import extract_year, extract_resolution, extract_folder_year, extract_movie_name_and_year

def create_symlinks(src_dirs, dest_dir, config, auto_select=False):
    os.makedirs(dest_dir, exist_ok=True)
    tmdb_folder_id_enabled = config['TMDB_FOLDER_ID']
    rename_enabled = config['RENAME_ENABLED']
    override_structure_enabled = config['OVERRIDE_STRUCTURE']

    for src_dir in src_dirs:
        actual_dir = os.path.basename(os.path.normpath(src_dir))
        log_message(f"Scanning source directory: {src_dir} (actual: {actual_dir})", level="INFO")

        for root, dirs, files in os.walk(src_dir):
            for file in files:
                src_file = os.path.join(root, file)
                
                if symlink_exists(dest_dir, src_file):
                    continue
                
                episode_match = re.search(r'(.*?)(S\d{2}E\d{2})', file, re.IGNORECASE)
                if episode_match:
                    handle_tv_show(file, root, src_file, dest_dir, actual_dir, config, episode_match, auto_select)
                else:
                    handle_movie(file, root, src_file, dest_dir, actual_dir, config, auto_select)

def symlink_exists(dest_dir, src_file):
    for dirpath, _, filenames in os.walk(dest_dir):
        for filename in filenames:
            full_dest_file = os.path.join(dirpath, filename)
            if os.path.islink(full_dest_file) and os.readlink(full_dest_file) == src_file:
                log_message(f"Symlink already exists for {os.path.basename(filename)}", level="INFO")
                return True
    return False

def handle_tv_show(file, root, src_file, dest_dir, actual_dir, config, episode_match, auto_select):
    episode_identifier = episode_match.group(2)
    parent_folder_name = os.path.basename(root)
    
    show_name, season_number = get_show_name_and_season(episode_identifier, parent_folder_name, file)
    season_folder = f"Season {int(season_number)}"
    
    show_folder = re.sub(r'\s+$|_+$|-+$|(\()$', '', show_name).rstrip()
    year = extract_folder_year(parent_folder_name) or extract_year(show_folder)
    if year:
        show_folder = re.sub(r'\(\d{4}\)$', '', show_folder).strip()
        show_folder = re.sub(r'\d{4}$', '', show_folder).strip()
    
    proper_show_name = search_tv_show(show_folder, year, auto_select=auto_select, api_key=config['TMDB_API_KEY'])
    if config['TMDB_FOLDER_ID']:
        show_folder = proper_show_name
    else:
        show_folder = re.sub(r' \{tmdb-\d+\}$', '', proper_show_name)

    show_folder = show_folder.replace('/', '')

    dest_path = get_dest_path(dest_dir, actual_dir, show_folder, season_folder, config)
    os.makedirs(dest_path, exist_ok=True)

    new_name = get_new_name(file, show_name, episode_identifier, proper_show_name, config)
    create_symlink(src_file, dest_path, new_name)

def get_show_name_and_season(episode_identifier, parent_folder_name, file):
    if re.match(r'S\d{2}E\d{2}', file, re.IGNORECASE):
        show_name = re.sub(r'\s*(S\d{2}.*|Season \d+).*', '', parent_folder_name).replace('-', ' ').replace('.', ' ').strip()
    else:
        show_name = re.sub(r'\s*(S\d{2}.*|Season \d+).*', '', file).replace('.', ' ').strip()
    season_number = re.search(r'S(\d{2})E\d{2}', episode_identifier, re.IGNORECASE).group(1)
    return show_name, season_number

def get_dest_path(dest_dir, actual_dir, show_folder, season_folder, config):
    if config['OVERRIDE_STRUCTURE']:
        return os.path.join(dest_dir, show_folder, season_folder)
    return os.path.join(dest_dir, actual_dir, show_folder, season_folder)

def get_new_name(file, show_name, episode_identifier, proper_show_name, config):
    if config['RENAME_ENABLED']:
        tmdb_id_match = re.search(r'\{tmdb-(\d+)\}$', proper_show_name)
        if tmdb_id_match:
            show_id = tmdb_id_match.group(1)
            episode_number_match = re.search(r'E(\d{2})', episode_identifier, re.IGNORECASE)
            if episode_number_match:
                episode_number = int(episode_number_match.group(1))
                episode_name = get_episode_name(show_id, int(season_number), episode_number, api_key=config['TMDB_API_KEY'])
                if episode_name:
                    new_name = f"{show_name} - {episode_identifier} - {episode_name}{os.path.splitext(file)[1]}"
                    log_message(f"Renaming {file} to {new_name} based on episode name {episode_name}", level="INFO")
                else:
                    new_name = f"{show_name} - {episode_identifier}{os.path.splitext(file)[1]}"
                    log_message(f"Episode name not found for {file}, renaming to {new_name}", level="WARNING")
            else:
                new_name = f"{show_name} - {episode_identifier}{os.path.splitext(file)[1]}"
        else:
            new_name = f"{show_name} - {episode_identifier}{os.path.splitext(file)[1]}"
        return re.sub(r' - - ', ' - ', new_name)
    return file

def handle_movie(file, root, src_file, dest_dir, actual_dir, config, auto_select):
    parent_folder_name = os.path.basename(root)
    movie_name, year = extract_movie_name_and_year(parent_folder_name)

    if not movie_name:
        log_message(f"Unable to extract movie name and year from: {parent_folder_name}", level="ERROR")
        return

    log_message(f"Searching for movie: {movie_name} ({year})", level="DEBUG")
    
    proper_movie_name = search_movie(movie_name, year, auto_select=auto_select, api_key=config['TMDB_API_KEY'])
    if proper_movie_name == movie_name:
        log_message(f"Could not find movie in TMDb: {movie_name} ({year})", level="ERROR")
        return

    log_message(f"Found movie: {proper_movie_name}", level="INFO")

    if config['TMDB_FOLDER_ID']:
        movie_folder = proper_movie_name
    else:
        movie_folder = re.sub(r' \{tmdb-\d+\}$', '', proper_movie_name)

    movie_folder = movie_folder.replace('/', '')
    dest_path = get_dest_path(dest_dir, actual_dir, movie_folder, '', config)
    os.makedirs(dest_path, exist_ok=True)

    new_name = f"{movie_folder}{os.path.splitext(file)[1]}" if config['RENAME_ENABLED'] else file
    create_symlink(src_file, dest_path, new_name)

def create_symlink(src_file, dest_path, new_name):
    dest_file = os.path.join(dest_path, new_name)
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
