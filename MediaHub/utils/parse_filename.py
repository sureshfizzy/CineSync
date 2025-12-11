#!/usr/bin/env python3
"""
Enhanced API script to parse filenames using MediaHub's clean_query function.
Supports both TV shows and movies with comprehensive metadata extraction.
Usage: python parse_filename.py "filename.mkv"
"""

import sys
import json
import os
import re
import traceback
from concurrent.futures import ThreadPoolExecutor, as_completed
from multiprocessing import cpu_count

script_path = os.path.abspath(__file__)
utils_dir = os.path.dirname(script_path)
mediahub_dir = os.path.dirname(utils_dir)
cinesync_dir = os.path.dirname(mediahub_dir)

if cinesync_dir not in sys.path:
    sys.path.insert(0, cinesync_dir)

from MediaHub.utils.file_utils import clean_query
from MediaHub.api.tmdb_api_helpers import get_episode_name
from MediaHub.api.tmdb_api import search_tv_show, search_movie
from MediaHub.api.tmdb_api import cached_get
from MediaHub.api.api_key_manager import get_api_key
from MediaHub.config.config import tmdb_api_language, get_max_processes
from MediaHub.api.language_iso_codes import get_iso_code
from MediaHub.utils.parser.extractor import extract_all_metadata

def get_max_processes():
    """Get the maximum number of processes for parallel processing"""
    # Import here to avoid circular imports
    from MediaHub.config.config import get_max_processes as config_get_max_processes
    return config_get_max_processes()

def get_media_ids_from_tmdb(title, media_type, year=None, season=None, episode=None):
    """
    Get TMDB, IMDB, and TVDB IDs for a given title.
    
    Args:
        title: Movie or series title
        media_type: 'tv' or 'movie'
        year: Release year (optional)
        season: Season number (for TV shows)
        episode: Episode number (for TV shows)
        
    Returns:
        dict: Dictionary containing tmdb_id, imdb_id, tvdb_id
    """
    ids = {
        'tmdb_id': None,
        'imdb_id': None,
        'tvdb_id': None
    }
    
    if not title:
        return ids
    
    try:
        api_key = get_api_key()
        if not api_key:
            return ids
        
        preferred_language = tmdb_api_language()
        language_iso = get_iso_code(preferred_language)
        
        # Search for the media
        if media_type == 'tv':
            search_url = "https://api.themoviedb.org/3/search/tv"
        else:
            search_url = "https://api.themoviedb.org/3/search/movie"
        
        search_params = {
            'api_key': api_key,
            'query': title,
            'language': language_iso
        }
        
        if year and media_type == 'movie':
            search_params['year'] = year
        elif year and media_type == 'tv':
            search_params['first_air_date_year'] = year
        
        search_response = cached_get(search_url, params=search_params)
        
        # If it's a Response object, get the JSON
        if hasattr(search_response, 'json'):
            search_data = search_response.json()
        else:
            search_data = search_response
        
        if not search_data or 'results' not in search_data:
            return ids
        
        results = search_data['results']
        if not results:
            return ids
        
        # Use the first (best) result
        best_match = results[0]
        tmdb_id = best_match.get('id')

        if tmdb_id:
            ids['tmdb_id'] = tmdb_id
            
            # Get external IDs
            if media_type == 'tv':
                external_ids_url = f"https://api.themoviedb.org/3/tv/{tmdb_id}/external_ids"
            else:
                external_ids_url = f"https://api.themoviedb.org/3/movie/{tmdb_id}/external_ids"
            
            external_ids_params = {
                'api_key': api_key
            }

            external_ids_response = cached_get(external_ids_url, params=external_ids_params)

            if hasattr(external_ids_response, 'json'):
                external_ids_data = external_ids_response.json()
            else:
                external_ids_data = external_ids_response
            
            if external_ids_data:
                ids['imdb_id'] = external_ids_data.get('imdb_id')
                ids['tvdb_id'] = external_ids_data.get('tvdb_id')
                
    except Exception as e:
        print(f"DEBUG: Error getting media IDs for {title}: {e}", file=sys.stderr)
    
    return ids

def get_episode_title_from_tmdb(title, season, episode):
    """
    Get episode title from TMDB using MediaHub's get_episode_name function.
    
    Args:
        title: Series title
        season: Season number
        episode: Episode number
        
    Returns:
        str: Episode title or None if not found
    """
    if not title or not season or not episode:
        return None
    
    try:        
        api_key = get_api_key()
        if not api_key:
            return None
        
        preferred_language = tmdb_api_language()
        language_iso = get_iso_code(preferred_language)
        
        # Search for the TV show directly using TMDB API
        search_url = "https://api.themoviedb.org/3/search/tv"
        search_params = {
            'api_key': api_key,
            'query': title,
            'language': language_iso
        }
        
        search_response = cached_get(search_url, params=search_params)
        
        # If it's a Response object, get the JSON
        if hasattr(search_response, 'json'):
            search_data = search_response.json()
        else:
            search_data = search_response
        
        if not search_data or 'results' not in search_data:
            return None
        
        results = search_data['results']
        if not results:
            return None
        
        # Use the first (best) result
        tmdb_id = results[0].get('id')
        if not tmdb_id:
            return None
        
        # Get episode name using MediaHub's function
        episode_info = get_episode_name(tmdb_id, season, episode)
        
        if episode_info and len(episode_info) >= 4 and episode_info[3]:
            return episode_info[3]
            
    except Exception:
        pass
    
    return None

def detect_media_type(parsed_result, filename):
    """
    Detect if the filename is a TV show or movie using file_utils' existing capabilities.
    The clean_query function already returns is_tv_show and is_movie fields from the parser.
    
    Args:
        parsed_result: The result from clean_query function which contains media type info
        filename: The filename to analyze (used as fallback)
        
    Returns:
        str: 'tv' for TV shows, 'movie' for movies
    """
    if parsed_result:
        if (parsed_result.get('is_tv_show') or 
            parsed_result.get('season') or 
            parsed_result.get('episode') or 
            parsed_result.get('episode_identifier')):
            return 'tv'
        
        # Check for movie indicators from the parser
        if parsed_result.get('is_movie'):
            return 'movie'

    try:
        metadata = extract_all_metadata(filename)
        
        if metadata.is_tv_show:
            return 'tv'
        elif metadata.is_movie:
            return 'movie'
    except Exception:
        pass

    return 'movie'

def parse_filename(filename, include_tmdb_lookup=True):
    """Parse a filename using MediaHub's clean_query function with enhanced movie/TV detection."""
    try:
        result = clean_query(filename)

        media_type = detect_media_type(result, filename)
        result['media_type'] = media_type
        
        # For movies, ensure we don't have season/episode data
        if media_type == 'movie':
            # Clear TV-specific fields for movies
            result['season'] = None
            result['episode'] = None
            result['episode_title'] = None
            result['episode_identifier'] = None
            result['show_name'] = None
            result['create_season_folder'] = False
            result['episodes'] = []
            result['seasons'] = []

        title = result.get('title')
        year = result.get('year')
        
        if title:
            media_ids = get_media_ids_from_tmdb(title, media_type, year)
            result.update(media_ids)
        
        # For TV shows, try to get episode title from TMDB if missing
        if media_type == 'tv':
            season = result.get('season')
            episode = result.get('episode')
            episode_title = result.get('episode_title')
            
            # If we have season/episode but no episode title, try to get it from TMDB
            if season and episode and not episode_title and title:
                tmdb_episode_title = get_episode_title_from_tmdb(title, season, episode)
                if tmdb_episode_title:
                    result['episode_title'] = tmdb_episode_title
        
        # Ensure we have all expected fields
        default_fields = {
            "title": filename,
            "year": None,
            "season": None,
            "episode": None,
            "episode_title": None,
            "resolution": "Unknown",
            "quality_source": "Unknown", 
            "release_group": "Unknown",
            "languages": ["English"],
            "is_anime": False,
            "container": "",
            "episodes": [],
            "seasons": [],
            "episode_identifier": None,
            "media_type": media_type,
            "video_codec": None,
            "audio_codecs": [],
            "audio_channels": [],
            "is_dubbed": False,
            "is_subbed": False,
            "is_repack": False,
            "is_proper": False,
            "hdr": None,
            "air_date": None,
            "is_daily": False,
            "tmdb_id": None,
            "imdb_id": None,
            "tvdb_id": None
        }

        for key, default_value in default_fields.items():
            if key not in result:
                result[key] = default_value
        
        return result

    except Exception as e:
        media_type = detect_media_type(None, filename)
        return {
            "title": filename,
            "error": str(e),
            "traceback": traceback.format_exc(),
            "media_type": media_type,
            "year": None,
            "season": None if media_type == 'movie' else 0,
            "episode": None if media_type == 'movie' else 0,
            "episode_title": None,
            "resolution": "Unknown",
            "quality_source": "Unknown", 
            "release_group": "Unknown",
            "languages": ["English"],
            "is_anime": False,
            "container": "",
            "episodes": [],
            "seasons": [],
            "episode_identifier": None,
            "video_codec": None,
            "audio_codecs": [],
            "audio_channels": [],
            "is_dubbed": False,
            "is_subbed": False,
            "is_repack": False,
            "is_proper": False,
            "hdr": None,
            "tmdb_id": None,
            "imdb_id": None,
            "tvdb_id": None,
            "air_date": None,
            "is_daily": False
        }

def parse_multiple_files(filenames, include_tmdb_lookup=True, max_workers=None):
    """Parse multiple filenames in parallel using ThreadPoolExecutor"""
    if max_workers is None:
        max_workers = get_max_processes()

    if len(filenames) == 1:
        return [parse_filename(filenames[0], include_tmdb_lookup)]

    results = []
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        future_to_filename = {
            executor.submit(parse_filename, filename, include_tmdb_lookup): filename 
            for filename in filenames
        }

        for future in as_completed(future_to_filename):
            filename = future_to_filename[future]
            try:
                result = future.result()
                results.append(result)
            except Exception as e:
                error_result = {
                    "title": filename,
                    "error": str(e),
                    "traceback": traceback.format_exc(),
                    "media_type": "movie",
                    "year": None,
                    "season": None,
                    "episode": None,
                    "episode_title": None,
                    "resolution": "Unknown",
                    "quality_source": "Unknown",
                    "release_group": "Unknown",
                    "languages": ["English"],
                    "is_anime": False,
                    "container": "",
                    "episodes": [],
                    "seasons": [],
                    "episode_identifier": None,
                    "video_codec": None,
                    "audio_codecs": [],
                    "audio_channels": [],
                    "is_dubbed": False,
                    "is_subbed": False,
                    "is_repack": False,
                    "is_proper": False,
                    "hdr": None,
                    "tmdb_id": None,
                    "imdb_id": None,
                    "tvdb_id": None,
                    "air_date": None,
                    "is_daily": False
                }
                results.append(error_result)

    return results

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: python parse_filename.py 'filename' [filename2] [filename3] ..."}))
        sys.exit(1)
    
    filenames = sys.argv[1:]
    
    if len(filenames) == 1:
        result = parse_filename(filenames[0], include_tmdb_lookup=True)
        print(json.dumps(result, default=str))
    else:
        results = parse_multiple_files(filenames, include_tmdb_lookup=True)
        print(json.dumps(results, default=str))

if __name__ == "__main__":
    main()