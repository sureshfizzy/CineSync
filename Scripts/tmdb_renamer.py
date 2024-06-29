#!/usr/bin/env python3

import sys
import os
import requests
import re
from guessit import guessit
from dotenv import load_dotenv
from datetime import datetime

# Load .env file
dotenv_path = os.path.join(os.path.dirname(__file__), '..', '.env')
load_dotenv(dotenv_path)

LOG_LEVEL = os.getenv('LOG_LEVEL', 'INFO').upper()
BEARER_TOKEN = os.getenv('BEARER_TOKEN')

LOG_LEVELS = {
    "DEBUG": 10,
    "INFO": 20,
    "WARNING": 30,
    "ERROR": 40,
    "CRITICAL": 50
}

def log_message(message, level="INFO", output="stdout"):
    """ Log a message with a given level to the specified output """
    if LOG_LEVELS.get(level, 20) >= LOG_LEVELS.get(LOG_LEVEL, 20):
        timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        log_entry = f"{timestamp} [{level}] {message}\n"
        if output == "stdout":
            sys.stdout.write(log_entry)
        elif output == "stderr":
            sys.stderr.write(log_entry)
        else:
            with open(output, 'a') as log_file:
                log_file.write(log_entry)

def get_tv_episode_details(title_id, season, episode, bearer_token):
    """ Fetch TV episode details from TMDB """
    url = f"https://api.themoviedb.org/3/tv/{title_id}/season/{season}/episode/{episode}"
    headers = {
        'Authorization': f'Bearer {bearer_token}',
        'Content-Type': 'application/json;charset=utf-8'
    }
    response = requests.get(url, headers=headers)
    if response.status_code == 200:
        episode_details = response.json()
        return episode_details.get('name')
    return None

def get_movie_details(title_id, bearer_token):
    """ Fetch movie details from TMDB """
    url = f"https://api.themoviedb.org/3/movie/{title_id}"
    headers = {
        'Authorization': f'Bearer {bearer_token}',
        'Content-Type': 'application/json;charset=utf-8'
    }
    response = requests.get(url, headers=headers)
    if response.status_code == 200:
        movie_details = response.json()
        return movie_details.get('title'), movie_details.get('release_date')[:4]
    return None, None

def query_tmdb(title_search, bearer_token, content_type):
    """ Query TMDB for the given title and return the show/movie name and ID """
    if content_type == 'episode':
        url = f"https://api.themoviedb.org/3/search/tv?query={title_search}"
    else:
        url = f"https://api.themoviedb.org/3/search/movie?query={title_search}"

    headers = {
        'Authorization': f'Bearer {bearer_token}',
        'Content-Type': 'application/json;charset=utf-8'
    }
    response = requests.get(url, headers=headers)
    if response.status_code == 200 and response.json()['results']:
        first_result = response.json()['results'][0]
        return first_result['id'], first_result['name'] if content_type == 'episode' else first_result['title']
    else:
        return None, None

def sanitize_filename(name):
    """ Sanitize filename to remove or replace invalid characters """
    invalid_chars = r'[\\/*?:"<>|]'
    return re.sub(invalid_chars, '', name)

def ensure_dir_exists(path):
    """ Ensure the directory exists, and if not, create it """
    os.makedirs(path, exist_ok=True)

def process_file(filepath, bearer_token):
    """ Process a single file for renaming """
    filename = os.path.basename(filepath)
    root = os.path.dirname(filepath)
    guessed_info = guessit(filename)
    content_type = guessed_info.get('type')

    if content_type == 'episode':
        title_search = guessed_info['title']
        season = guessed_info['season']
        episode = guessed_info['episode']
        show_id, show_full_name = query_tmdb(title_search, bearer_token, content_type)
        if show_id and show_full_name:
            episode_name = get_tv_episode_details(show_id, season, episode, bearer_token)
            if episode_name:
                episode_name = sanitize_filename(episode_name)
                new_filename = f"{show_full_name} - S{str(season).zfill(2)}E{str(episode).zfill(2)} - {episode_name}{os.path.splitext(filename)[1]}"
                new_filepath = os.path.join(root, new_filename)
                if os.path.exists(new_filepath):
                    log_message(f"File already exists: {new_filename}", "DEBUG", "stdout")
                else:
                    ensure_dir_exists(os.path.dirname(new_filepath))
                    os.rename(filepath, new_filepath)
                    log_message(f"- Renamed '{filename}' to '{new_filename}'", "DEBUG", "stdout")
            else:
                log_message(f"Episode details not found for {filename}", "ERROR", "stdout")
        else:
            log_message(f"No TMDB match found for {filename}", "ERROR", "stdout")
    elif content_type == 'movie':
        title_search = guessed_info['title']
        movie_id, movie_title = query_tmdb(title_search, bearer_token, content_type)
        if movie_id and movie_title:
            release_year = guessed_info.get('year') or get_movie_details(movie_id, bearer_token)[1]
            part = guessed_info.get('part')
            movie_title = sanitize_filename(movie_title)
            new_filename = f"{movie_title} ({release_year})" if release_year else movie_title
            if part:
                new_filename += f" - Part {part}"
            new_filename += os.path.splitext(filename)[1]
            new_filepath = os.path.join(root, new_filename)
            if os.path.exists(new_filepath):
                log_message(f"File already exists: {new_filename}", "DEBUG", "stdout")
            else:
                ensure_dir_exists(os.path.dirname(new_filepath))
                os.rename(filepath, new_filepath)
                log_message(f"- Renamed '{filename}' to '{new_filename}'", "DEBUG", "stdout")
        else:
            log_message(f"No TMDB match found for {filename}", "ERROR", "stdout")
    else:
        log_message(f"Unknown content type for filename {filename}", "ERROR", "stdout")

if __name__ == "__main__":
    # Check if a specific file path is provided
    if len(sys.argv) > 1:
        # Process the specific file provided as an argument
        file_path = sys.argv[1]
        process_file(file_path, BEARER_TOKEN)
    else:
        # Directory containing show files from environment variable
        shows_directory = os.getenv('DESTINATION_DIR', '/default/path/if/not/set')
        # Process each file in the directory
        for root, dirs, files in os.walk(shows_directory):
            for filename in files:
                filepath = os.path.join(root, filename)
                process_file(filepath, BEARER_TOKEN)
