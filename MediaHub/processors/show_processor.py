import os
import re
import requests
import sys
from MediaHub.utils.file_utils import extract_resolution_from_filename, clean_query, extract_year, extract_resolution_from_folder
from MediaHub.api.tmdb_api import search_tv_show, determine_tmdb_media_type
from MediaHub.processors.movie_processor import process_movie
from MediaHub.utils.logging_utils import log_message
from MediaHub.config.config import *
from MediaHub.processors.anime_processor import is_anime_file, process_anime_show
from MediaHub.utils.file_utils import *
from MediaHub.utils.mediainfo import *
from MediaHub.api.tmdb_api_helpers import get_episode_name, get_show_data
from MediaHub.processors.db_utils import track_file_failure
from MediaHub.utils.meta_extraction_engine import get_ffprobe_media_info

# Add the mediainfo directory to the path
sys.path.append(os.path.join(os.path.dirname(__file__), '..', 'utils', 'mediainfo'))
from sonarr_naming import get_sonarr_episode_filename, get_sonarr_season_folder_name

# Retrieve base_dir from environment variables
source_dirs = os.getenv('SOURCE_DIR', '').split(',')

def process_show(src_file, root, file, dest_dir, actual_dir, tmdb_folder_id_enabled, rename_enabled, auto_select, dest_index, episode_match, tmdb_id=None, imdb_id=None, tvdb_id=None, season_number=None, episode_number=None, is_anime_show=False, force_extra=False, file_metadata=None, manual_search=False):

    # Initialize variables
    is_kids_content = False
    is_anime_genre = False
    proper_show_name = None

    parent_folder_name = os.path.basename(root)
    normalized_root = os.path.normpath(root)
    source_folder = None
    for source_dir in source_dirs:
        source_dir = source_dir.strip()
        if not source_dir:
            continue
        normalized_source = os.path.normpath(source_dir)
        if (normalized_root == normalized_source or
            normalized_root.startswith(normalized_source + os.sep)):
            source_folder = os.path.basename(normalized_source)
            break
    if not source_folder:
        source_folder = os.path.basename(os.path.dirname(normalized_root))

    # Check if this is an extra file and skip if detected as extra
    if is_extras_file(file, src_file, is_movie=False):
        log_message(f"Skipping show extra file: {file}", level="INFO")
        return "SKIP_EXTRA", None

    # Use passed metadata if available, otherwise parse
    if file_metadata:
        file_result = file_metadata
    else:
        file_result = clean_query(file)

    # Check if this is a S00 episode (specials/extras) and skip if detected
    if file_result.get('is_extra', False) and file_result.get('season_number') == '00':
        log_message(f"Skipping S00 special episode: {file}", level="INFO")
        return "SKIP_EXTRA", None

    # Initialize language and quality variables and extract from file_result
    languages = file_result.get('languages', [])
    language = ', '.join(languages) if isinstance(languages, list) and languages else None

    resolution_info = file_result.get('resolution', '')
    quality_source = file_result.get('quality_source', '')
    quality_parts = [part for part in [resolution_info, quality_source] if part]
    quality = ' '.join(quality_parts) if quality_parts else None

    # Store original parameters before they get overwritten by file parsing
    original_season_number = season_number
    original_episode_number = episode_number

    if file_result.get('episode_identifier') or file_result.get('season_number'):
        show_name = file_result.get('title', '')
        episode_identifier = file_result.get('episode_identifier')
        if original_season_number is None:
            season_number = file_result.get('season_number')
        if original_episode_number is None:
            episode_number = file_result.get('episode_number')
        create_season_folder = file_result.get('create_season_folder', False)
        is_extra = file_result.get('is_extra', False)

        # If we have episode info but no season info, check parent folder for season
        if episode_identifier and not season_number and original_season_number is None:
            folder_result = clean_query(parent_folder_name)
            folder_season = folder_result.get('season_number')
            if folder_season:
                season_number = folder_season
                log_message(f"Found season {season_number} in parent folder: {parent_folder_name}", level="DEBUG")
                episode_match = re.search(r'E(\d+)', episode_identifier, re.IGNORECASE)
                if episode_match:
                    episode_number = int(episode_match.group(1))
                    season_num = int(season_number) if isinstance(season_number, str) else season_number
                    episode_identifier = f"S{season_num:02d}E{episode_number:02d}"
                    log_message(f"Updated episode identifier to: {episode_identifier}", level="DEBUG")

        if episode_identifier:
            log_message(f"Using file-based extraction: {show_name} - {episode_identifier}", level="DEBUG")
        elif season_number:
            log_message(f"Using file-based extraction for season pack: {show_name} - Season {season_number}", level="DEBUG")
        else:
            log_message(f"Using file-based extraction: {show_name}", level="DEBUG")
    elif force_extra and file_result.get('title', '').strip():
        # For extra content, always use folder-based extraction to get the correct show name
        folder_result = clean_query(parent_folder_name)
        show_name = folder_result.get('title', '')
        log_message(f"using folder-based extraction for extra: {show_name}", level="DEBUG")

        episode_identifier = file_result.get('episode_identifier')
        if original_season_number is None:
            season_number = file_result.get('season_number')
        if original_episode_number is None:
            episode_number = file_result.get('episode_number')
        create_season_folder = file_result.get('create_season_folder', False)
        is_extra = file_result.get('is_extra', False)
    else:
        folder_result = clean_query(parent_folder_name)
        log_message(f"Folder query result: {folder_result}", level="DEBUG")

        show_name = folder_result.get('title', '')
        episode_identifier = folder_result.get('episode_identifier')
        if original_season_number is None:
            season_number = folder_result.get('season_number')
        if original_episode_number is None:
            episode_number = folder_result.get('episode_number')
        create_season_folder = folder_result.get('create_season_folder', False)
        is_extra = folder_result.get('is_extra', False)

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
    total_episodes = None

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
                                        tmdb_folder_id_enabled, rename_enabled, tmdb_id, imdb_id, tvdb_id, auto_select, season_number, episode_number, file_metadata, manual_search)

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

        # Use language and quality from anime processor if available
        anime_language = anime_result.get('language')
        anime_quality = anime_result.get('quality')
        if anime_language:
            language = anime_language
        if anime_quality:
            quality = anime_quality
        resolution = anime_result.get('resolution')
        is_anime_genre = anime_result.get('is_anime_genre')
        is_extra = anime_result.get('is_extra')
        tmdb_id = anime_result.get('tmdb_id')
        original_language = anime_result.get('original_language')
        overview = anime_result.get('overview', '')
        runtime = anime_result.get('runtime', 0)
        original_title = anime_result.get('original_title', '')
        status = anime_result.get('status', '')
        first_air_date = anime_result.get('first_air_date', '')
        last_air_date = anime_result.get('last_air_date', '')
        genres = anime_result.get('genres', '[]')
        certification = anime_result.get('certification', '')
        total_episodes = anime_result.get('total_episodes', '')

        # Update episode info from anime result if available
        episode_match = re.search(r'S(\d+)E(\d+)', new_name, re.IGNORECASE)
        if episode_match:
            season_number = episode_match.group(1)
            episode_identifier = f"S{season_number}E{episode_match.group(2)}"
            episode_number = episode_match.group(2)
            create_season_folder = True

    if not episode_identifier and season_number and not anime_result:
        log_message(f"Found season info but no episode info for: {file}.", level="DEBUG")
        create_season_folder = True
        if not auto_select:
            is_extra = False

    elif not episode_identifier and not season_number and not anime_result:
        log_message(f"Unable to determine season and episode info for: {file}", level="DEBUG")
        if not manual_search or auto_select:
            create_extras_folder = True
            is_extra = True

    # Extract year from file first, then parent folder or show name for TMDb search
    year = file_result.get('year') or extract_year(parent_folder_name) or extract_year(show_name)

    # Set initial show_folder for processing
    show_folder = show_name

    # Handle anime result override
    if anime_result:
        show_folder = anime_result.get('show_name', '')
        proper_show_name = show_folder
    else:
        proper_show_name = show_folder
    if not anime_result:
        # Check if TMDB ID is provided and determine if it's actually a movie (only with manual search)
        if tmdb_id and manual_search:
            media_type, media_data = determine_tmdb_media_type(tmdb_id)

            if media_type == 'movie':
                log_message(f"TMDB ID {tmdb_id} is a movie. Redirecting to movie processor for: {file}", level="INFO")
                movie_result = process_movie(src_file, root, file, dest_dir, actual_dir, tmdb_folder_id_enabled, rename_enabled, auto_select, dest_index, tmdb_id=tmdb_id, imdb_id=None, file_metadata=None, movie_data=media_data, manual_search=manual_search)

                # Movie processor returns
                if movie_result:
                    dest_file, movie_tmdb_id, media_type, proper_name, year, episode_number, imdb_id, is_anime_genre, movie_is_kids_content, language, quality = movie_result
                    return dest_file, movie_tmdb_id, None, False, media_type, proper_name, year, episode_number, imdb_id, is_anime_genre, movie_is_kids_content
                else:
                    return movie_result
            elif media_type is None:
                log_message(f"TMDB ID {tmdb_id} not found in TMDB database. Skipping processing.", level="ERROR")
                return None

        # Retry logic for show name extraction
        max_retries = 2
        retry_count = 0
        result = None

        while retry_count < max_retries and result is None:
            retry_count += 1
            log_message(f"TMDb show search attempt {retry_count}/{max_retries} for: {show_folder} ({year})", level="DEBUG")

            result = search_tv_show(show_folder, year, auto_select=auto_select, actual_dir=actual_dir, file=file, root=root, episode_match=episode_match, tmdb_id=tmdb_id, imdb_id=imdb_id, tvdb_id=tvdb_id, season_number=season_number, episode_number=episode_number, is_extra=is_extra, force_extra=force_extra, manual_search=manual_search)

            # Check if manual search selected a movie and redirect to movie processing
            if isinstance(result, dict) and result.get('redirect_to_movie'):
                log_message(f"Manual search selected a movie. Redirecting to movie processor for: {file}", level="INFO")
                movie_result = process_movie(src_file, root, file, dest_dir, actual_dir, tmdb_folder_id_enabled, rename_enabled, auto_select, dest_index, tmdb_id=None, imdb_id=None, file_metadata=None, movie_data=result.get('movie_data'), manual_search=manual_search)

                # Movie processor returns
                if movie_result:
                    dest_file, movie_tmdb_id, media_type, proper_name, year, episode_number, imdb_id, is_anime_genre, movie_is_kids_content, language, quality = movie_result
                    return dest_file, movie_tmdb_id, None, False, media_type, proper_name, year, episode_number, imdb_id, is_anime_genre, movie_is_kids_content
                else:
                    return movie_result

            if result is None and retry_count < max_retries:
                import time
                wait_time = 2
                log_message(f"TMDb search failed, retrying in {wait_time} seconds...", level="WARNING")
                time.sleep(wait_time)

        # Check final result after all retries
        if result is None or isinstance(result, str):
            log_message(f"TMDB search failed for show: {show_name} ({year}). Skipping show processing.", level="ERROR")
            track_file_failure(src_file, None, None, "TMDB search failed", f"No TMDB results found for show: {show_name} ({year})")
            return None
        elif isinstance(result, tuple) and len(result) >= 18:
            proper_show_name, show_name, is_anime_genre, season_number, episode_number, tmdb_id, is_kids_content, imdb_id, tvdb_id, original_language, overview, runtime, original_title, status, first_air_date, last_air_date, genres, certification = result

            if season_number is not None:
                season_number = str(season_number).zfill(2)
            if episode_number is not None:
                episode_number = str(episode_number).zfill(2)

            # Handle episode identifier for valid season/episode numbers
            if season_number is not None and episode_number is not None:
                episode_identifier = f"S{season_number}E{episode_number}"
            else:
                episode_identifier = None

            # Get TMDB language as fallback if not available from file metadata
            if not language and tmdb_id:
                show_data = get_show_data(tmdb_id)
                if show_data:
                    language = show_data.get('original_language')

            # Handle extra content logic regardless of season/episode info
            if force_extra:
                # For extra content, ensure it's processed as extra regardless of episode info
                is_extra = True
                create_extras_folder = True
                create_season_folder = False
            elif season_number is not None and episode_number is not None:
                if not is_extra:
                    create_extras_folder = False
                    create_season_folder = True
        else:
            log_message(f"TMDB search returned unexpected result type for show: {show_folder} ({year}). Skipping show processing.", level="ERROR")
            track_file_failure(src_file, None, None, "TMDB search failed", f"Unexpected TMDB result type for show: {show_folder} ({year})")
            return None

        # Validate that we got a proper show name from TMDb
        if not proper_show_name or proper_show_name.strip() == "" or "TMDb API error" in str(proper_show_name):
            log_message(f"TMDb could not provide valid show name for: {show_folder} ({year}). Skipping show processing.", level="ERROR")
            return None

        # Store the original proper_show_name with all IDs
        proper_show_name_with_ids = proper_show_name

        # Convert ID format based on JELLYFIN_ID_FORMAT setting
        if is_jellyfin_id_format_enabled():
            proper_show_name = re.sub(r'\{tmdb-([^}]+)\}', r'[tmdbid-\1]', proper_show_name)
            proper_show_name = re.sub(r'\{imdb-([^}]+)\}', r'[imdbid-\1]', proper_show_name)
            proper_show_name = re.sub(r'\{tvdb-([^}]+)\}', r'[tvdbid-\1]', proper_show_name)
        else:
            pass

        proper_show_name_with_ids = proper_show_name

        show_folder = proper_show_name

        if not is_imdb_folder_id_enabled():
            if is_jellyfin_id_format_enabled():
                show_folder = re.sub(r' \[imdb(?:id)?-[^\]]+\]', '', show_folder)
            else:
                show_folder = re.sub(r' \{imdb-[^}]+\}', '', show_folder)
        if not is_tvdb_folder_id_enabled():
            if is_jellyfin_id_format_enabled():
                show_folder = re.sub(r' \[tvdb(?:id)?-[^\]]+\]', '', show_folder)
            else:
                show_folder = re.sub(r' \{tvdb-[^}]+\}', '', show_folder)
        if not is_tmdb_folder_id_enabled():
            if is_jellyfin_id_format_enabled():
                show_folder = re.sub(r' \[tmdb(?:id)?-[^\]]+\]', '', show_folder)
            else:
                show_folder = re.sub(r' \{tmdb-[^}]+\}', '', show_folder)

    show_folder = show_folder.replace('/', '')

    # Only retrieve episode data if not already provided by anime processor
    if episode_identifier and not is_extra and not (anime_result and anime_result.get('episode_title') and anime_result.get('total_episodes') is not None):
        tmdb_id_match = re.search(r'\[tmdb(?:id)?-(\d+)\]', proper_show_name) or re.search(r'\{tmdb-(\d+)\}', proper_show_name)
        if tmdb_id_match:
            show_id = tmdb_id_match.group(1)
            episode_number_match = re.search(r'E(\d+)', episode_identifier, re.IGNORECASE)
            if episode_number_match:
                episode_num = episode_number_match.group(1)
                show_data = get_show_data(show_id)
                total_episodes_from_show = show_data.get('total_episodes', 0) if show_data else 0
                episode_result = get_episode_name(show_id, int(season_number), int(episode_num), total_episodes=total_episodes_from_show)
                if episode_result and len(episode_result) >= 5:
                    episode_name_result, mapped_season, mapped_episode, episode_title, total_episodes = episode_result
                else:
                    log_message(f"Failed to retrieve episode data or insufficient data returned", level="WARNING")
            else:
                log_message(f"Could not extract episode number from identifier: {episode_identifier}", level="WARNING")
        else:
            log_message(f"Could not extract TMDB ID from show name: {proper_show_name}", level="WARNING")

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
    is_4k = ('2160' in resolution or
             re.search(r'\b4k\b', resolution, re.IGNORECASE) if resolution else False)

    # Modified destination path determination
    if is_extra:
        if is_cinesync_layout_enabled():
            if custom_show_layout() or custom_4kshow_layout():
                if is_show_resolution_structure_enabled():
                    if is_kids_content and is_kids_separation_enabled():
                        kids_base = custom_kids_show_layout() if custom_kids_show_layout() else os.path.join('CineSync', 'KidsShows')
                        base_dest_path = os.path.join(dest_dir, kids_base, resolution_folder, show_folder, 'Extras')
                    elif is_anime_genre and is_anime_separation_enabled():
                        anime_base = custom_anime_show_layout() if custom_anime_show_layout() else os.path.join('CineSync', 'AnimeShows')
                        base_dest_path = os.path.join(dest_dir, anime_base, resolution_folder, show_folder, 'Extras')
                    else:
                        show_base = custom_show_layout() if custom_show_layout() else os.path.join('CineSync', 'Shows')
                        base_dest_path = os.path.join(dest_dir, show_base, resolution_folder, show_folder, 'Extras')
                else:
                    if is_kids_content and is_kids_separation_enabled():
                        kids_base = custom_kids_show_layout() if custom_kids_show_layout() else os.path.join('CineSync', 'KidsShows')
                        base_dest_path = os.path.join(dest_dir, kids_base, show_folder, 'Extras')
                    elif is_anime_genre and is_anime_separation_enabled():
                        anime_base = custom_anime_show_layout() if custom_anime_show_layout() else os.path.join('CineSync', 'AnimeShows')
                        base_dest_path = os.path.join(dest_dir, anime_base, show_folder, 'Extras')
                    else:
                        show_base = custom_show_layout() if custom_show_layout() else os.path.join('CineSync', 'Shows')
                        base_dest_path = os.path.join(dest_dir, show_base, show_folder, 'Extras')
            else:
                if is_kids_content and is_kids_separation_enabled():
                    base_dest_path = os.path.join(dest_dir, 'CineSync', 'KidsShows', show_folder, 'Extras')
                elif is_anime_genre and is_anime_separation_enabled():
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
                base_dest_path = os.path.join(dest_dir, 'CineSync', 'AnimeShows', show_folder, 'Extras')
            elif is_4k and is_4k_separation_enabled():
                base_dest_path = os.path.join(dest_dir, 'CineSync', '4KShows', show_folder, 'Extras')
            else:
                base_dest_path = os.path.join(dest_dir, 'CineSync', 'Shows', show_folder, 'Extras')

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
                    if is_kids_content and is_kids_separation_enabled():
                        kids_base = custom_kids_show_layout() if custom_kids_show_layout() else os.path.join('CineSync', 'KidsShows')
                        base_dest_path = os.path.join(dest_dir, kids_base, show_folder)
                        extras_base_dest_path = os.path.join(dest_dir, kids_base, show_folder)
                    elif is_anime_genre and is_anime_separation_enabled():
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
                    if is_kids_content and is_kids_separation_enabled():
                        base_dest_path = os.path.join(dest_dir, 'CineSync', 'KidsShows', resolution_folder, show_folder)
                        extras_base_dest_path = os.path.join(dest_dir, 'CineSync', 'KidsShows', resolution_folder, show_folder)
                    elif is_anime_genre and is_anime_separation_enabled():
                        base_dest_path = os.path.join(dest_dir, 'CineSync', 'AnimeShows', resolution_folder, show_folder)
                        extras_base_dest_path = os.path.join(dest_dir, 'CineSync', 'AnimeShows', resolution_folder, show_folder)
                    else:
                        base_dest_path = os.path.join(dest_dir, 'CineSync', 'Shows', resolution_folder, show_folder)
                        extras_base_dest_path = os.path.join(dest_dir, 'CineSync', 'Shows', resolution_folder, show_folder)
                else:
                    if is_kids_content and is_kids_separation_enabled():
                        base_dest_path = os.path.join(dest_dir, 'CineSync', 'KidsShows', show_folder)
                        extras_base_dest_path = os.path.join(dest_dir, 'CineSync', 'KidsShows', show_folder)
                    elif is_anime_genre and is_anime_separation_enabled():
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
                extras_base_dest_path = os.path.join(dest_dir, 'CineSync', 'AnimeShows', show_folder, 'Extras')
            elif is_4k and is_4k_separation_enabled():
                base_dest_path = os.path.join(dest_dir, 'CineSync', '4KShows', show_folder)
                extras_base_dest_path = os.path.join(dest_dir, 'CineSync', '4KShows', show_folder, 'Extras')
            else:
                base_dest_path = os.path.join(dest_dir, 'CineSync', 'Shows', show_folder)
                extras_base_dest_path = os.path.join(dest_dir, 'CineSync', 'Shows', show_folder, 'Extras')

        # Use Sonarr season folder naming if enabled, otherwise use default season handling
        if mediainfo_parser():
            show_name_for_sonarr = locals().get('proper_show_name_with_ids', proper_show_name)
            if anime_result:
                season_folder_name = get_sonarr_season_folder_name(show_name_for_sonarr, show_name, anime_result.get('season_number', '01'))
            else:
                season_folder_name = get_sonarr_season_folder_name(show_name_for_sonarr, show_name, season_number)
            season_dest_path = os.path.join(base_dest_path, season_folder_name)
        else:
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
            episode_name = episode_title

            # Check if MEDIAINFO PARSER is enabled to determine naming strategy
            sonarr_naming_failed = False
            if mediainfo_parser():
                # Determine content type for appropriate naming format
                content_type = "standard"  # Default

                # Check if it's anime content
                if is_anime_genre or anime_result:
                    content_type = "anime"
                    # Get absolute episode number if available from anime result
                    absolute_episode = anime_result.get('absolute_episode') if anime_result else None
                    show_name_for_sonarr = locals().get('proper_show_name_with_ids', proper_show_name)
                    new_name = get_sonarr_episode_filename(
                        file, root, show_name_for_sonarr, show_name, season_number,
                        episode_number, episode_identifier, episode_name,
                        content_type=content_type, absolute_episode=absolute_episode
                    )
                else:
                    show_name_for_sonarr = locals().get('proper_show_name_with_ids', proper_show_name)
                    new_name = get_sonarr_episode_filename(
                        file, root, show_name_for_sonarr, show_name, season_number,
                        episode_number, episode_identifier, episode_name,
                        content_type=None
                    )

                # Check if Sonarr naming returned a basic legacy format
                file_ext = os.path.splitext(file)[1]
                legacy_formats = [
                    f"{show_name} - {episode_identifier}{file_ext}",
                    f"{show_name} - {episode_identifier} - {episode_name}{file_ext}" if episode_name else None
                ]
                legacy_formats = [fmt for fmt in legacy_formats if fmt]

                if new_name in legacy_formats:
                    log_message(f"Falling back to processor legacy naming for: {file}", level="WARNING")
                    sonarr_naming_failed = True

            # Use processor legacy naming if mediainfo parser is disabled OR if Sonarr naming failed
            if not mediainfo_parser() or sonarr_naming_failed:
                if episode_name:
                    base_name = f"{show_name} - S{season_number}E{episode_number} - {episode_name}".replace(' - -', ' -')
                    log_message(f"Renaming {file}", level="INFO")
                else:
                    base_name = f"{show_name} - S{season_number}E{episode_number}" if season_number and episode_number else f"{show_name} - {episode_identifier}"

                if is_rename_enabled() and get_rename_tags():
                    media_info = extract_media_info(file, keywords, root)
                    details = []
                    release_group = ""

                    # Extract ID tag if TMDB or IMDB is in RENAME_TAGS
                    id_tag = ""
                    tags_to_use = get_rename_tags()
                    if 'TMDB' in tags_to_use and tmdb_id:
                        tmdb_id_match = re.search(r'\[tmdb(?:id)?-(\d+)\]', proper_show_name_with_ids) or re.search(r'\{tmdb-(\d+)\}', proper_show_name_with_ids)
                        if tmdb_id_match:
                            id_tag = f"[tmdbid-{tmdb_id_match.group(1)}]"
                    elif 'IMDB' in tags_to_use and imdb_id:
                        imdb_id_match = re.search(r'\[imdb(?:id)?-([^\]]+)\]', proper_show_name_with_ids) or re.search(r'\{imdb-([^}]+)\}', proper_show_name_with_ids)
                        if imdb_id_match:
                            id_tag = f"[imdbid-{imdb_id_match.group(1)}]"

                    for tag in tags_to_use:
                        tag = tag.strip()
                        if tag in media_info:
                            value = media_info[tag]

                            if tag.lower() in ['releasegroup', 'release group']:
                                release_group = str(value)
                            else:
                                if isinstance(value, list):
                                    formatted_value = '+'.join([str(language).upper() for language in value])
                                    details.append(f"[{formatted_value}]")
                                else:
                                    details.append(f"[{value}]")

                    # Add ID tag if found
                    if id_tag:
                        details.append(id_tag)

                    if release_group:
                        details.append(f"-{release_group}")

                    new_name = f"{base_name}{''.join(details)}{os.path.splitext(file)[1]}"
                else:
                    new_name = f"{base_name}{os.path.splitext(file)[1]}"

                new_name = re.sub(r'-{2,}', '-', new_name).strip('-')

            dest_file = os.path.join(season_dest_path, new_name)
        else:
            dest_file = os.path.join(season_dest_path, file)

    # Extract clean name and year from proper_show_name which may include TMDB ID
    clean_name = proper_show_name
    extracted_year = year

    # Parse proper_show_name to extract clean name and year
    if proper_show_name:
        if is_jellyfin_id_format_enabled():
            clean_name = re.sub(r'\s*\[[^\]]+\]', '', proper_show_name)
        else:
            clean_name = re.sub(r'\s*\{[^}]+\}', '', proper_show_name)

        year_match = re.search(r'\((\d{4})\)', clean_name)
        if year_match:
            extracted_year = year_match.group(1)
            clean_name = re.sub(r'\s*\(\d{4}\)', '', clean_name).strip()

    # Return all fields
    return (dest_file, tmdb_id, season_number, is_extra, 'TV',
            clean_name, str(extracted_year) if extracted_year else None,
            str(episode_number) if episode_number else None, imdb_id,
            1 if is_anime_genre else 0, is_kids_content, language, quality, tvdb_id,
            original_language, overview, runtime, original_title, status, first_air_date, last_air_date, genres, certification,
            episode_title, total_episodes)