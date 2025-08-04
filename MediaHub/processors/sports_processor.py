import os
import re
import json
from dotenv import load_dotenv, find_dotenv
from MediaHub.utils.file_utils import *
from MediaHub.api.sportsdb_api import search_sports_content
from MediaHub.utils.logging_utils import log_message
from MediaHub.config.config import *
from MediaHub.utils.mediainfo import extract_media_info, keywords
from MediaHub.utils.file_utils import extract_resolution_from_filename, extract_resolution_from_folder
from MediaHub.processors.db_utils import track_file_failure
from MediaHub.utils.meta_extraction_engine import get_ffprobe_media_info

# Retrieve base_dir from environment variables
source_dirs = os.getenv('SOURCE_DIR', '').split(',')

def process_sports(src_file, root, file, dest_dir, actual_dir, tmdb_folder_id_enabled, rename_enabled, auto_select, dest_index, sports_metadata=None, manual_search=False):
    """
    Process sports content files
    
    Args:
        src_file: Source file path
        root: Root directory
        file: Filename
        dest_dir: Destination directory
        actual_dir: Actual directory name
        tmdb_folder_id_enabled: Whether TMDB folder ID is enabled
        rename_enabled: Whether renaming is enabled
        auto_select: Whether to auto-select results
        dest_index: Destination index
        sports_metadata: Pre-parsed sports metadata
        manual_search: Whether this is a manual search
    
    Returns:
        Tuple with destination file path and metadata
    """
    
    # Initialize variables
    proper_name = None
    sport_name = None
    season_year = None
    event_name = None
    round_number = None
    session_type = None
    venue = None
    date = None
    
    try:
        # Get detailed parsed data from main parsing system
        from MediaHub.utils.file_utils import parse_media_file
        parsed_data = parse_media_file(file)

        # Parse sports information from filename if not provided
        if not sports_metadata or sports_metadata.get('is_sports') == True:
            if parsed_data.get('is_sports'):
                # Unified parser detected sports content
                sports_metadata = {
                    'sport': parsed_data.get('sport_name'),
                    'year': parsed_data.get('sport_year'),
                    'round': parsed_data.get('sport_round'),
                    'location': parsed_data.get('sport_location'),
                    'session_type': parsed_data.get('sport_session'),
                    'is_sports': True
                }
            else:
                # Sports pattern detected it as sports, but unified parser didn't extract details
                # Use the unified parser's general data
                sports_metadata = {
                    'sport': parsed_data.get('title', 'Unknown Sport'),
                    'year': parsed_data.get('year'),
                    'round': parsed_data.get('episode'),
                    'location': parsed_data.get('title', 'Unknown Event'),
                    'session_type': None,
                    'is_sports': True
                }
        
        if not sports_metadata:
            log_message(f"Could not parse sports information from filename: {file}", level="WARNING")
            track_file_failure(src_file, None, None, "Sports parsing failed", f"Unable to parse sports info from: {file}")
            return None
        
        # Extract basic information
        sport_name = sports_metadata.get('sport', 'Unknown Sport')
        season_year = sports_metadata.get('year')
        round_number = sports_metadata.get('round')
        location = sports_metadata.get('location', '')
        session_type = sports_metadata.get('session_type')
        
        log_message(f"Processing sports content: {sport_name} {season_year} Round {round_number} - {location}", level="INFO")
        
        # Try to search for sports content in SportsDB (optional)
        venue = None
        date = None
        sportsdb_event_id = None
        sportsdb_league_id = None

        try:
            log_message(f"Searching SportsDB for: {sport_name} {season_year} - {location}", level="DEBUG")
            sports_result = search_sports_content(
                sport_name=sport_name,
                year=season_year,
                round_number=round_number,
                event_name=location
            )

            if sports_result:
                # Extract metadata from SportsDB result
                league_info = sports_result.get('league', {})
                season_info = sports_result.get('season', {})
                event_info = sports_result.get('event', {})
                metadata = sports_result.get('metadata', {})
                # Extract SportsDB IDs
                sportsdb_event_id = event_info.get('event_id') if event_info else None
                sportsdb_league_id = league_info.get('league_id') if league_info else None

                sport_name = league_info.get('league_name', sport_name)
                season_year = metadata.get('season_year', season_year)
                event_name = metadata.get('event_name', location)
                venue = metadata.get('venue')
                date = metadata.get('date')

                # Update location to use official API event name
                location = event_name

                log_message(f"SportsDB found: {sport_name} - {event_name}", level="INFO")
            else:
                log_message(f"No SportsDB data found for {sport_name}. Using parsed filename data", level="INFO")
                event_name = location
        except Exception as e:
            log_message(f"SportsDB API error for {sport_name}: {e}. Using parsed filename data", level="WARNING")
            event_name = location
        
        # Extract resolution and quality information
        file_resolution = extract_resolution_from_filename(file)
        folder_resolution = extract_resolution_from_folder(root)
        resolution = file_resolution or folder_resolution or "Unknown"
        
        # Extract media info
        media_info = {}
        if actual_dir:
            actual_dir_media_info = extract_media_info(actual_dir, keywords)
            media_info.update(actual_dir_media_info)
        
        file_media_info = extract_media_info(file, keywords)
        media_info.update(file_media_info)
        
        # Get quality and language information
        quality = media_info.get('quality', 'Unknown')
        language = media_info.get('language', 'Unknown')
        
        # Use API event name as proper name when available, otherwise build from parsed data
        if event_name:
            # API provided the event name, use it as-is (it's already complete)
            proper_name = event_name
        else:
            # Fallback to constructed name from parsed data
            if round_number:
                if session_type:
                    proper_name = f"{sport_name} {season_year} R{round_number} {location} {session_type}"
                else:
                    proper_name = f"{sport_name} {season_year} R{round_number} {location}"
            else:
                if session_type:
                    proper_name = f"{sport_name} {location} {session_type} {season_year}"
                else:
                    proper_name = f"{sport_name} {location} {season_year}"
        
        # Create detailed folder structure with all available information
        sport_folder = sanitize_windows_filename(sport_name)
        season_folder = f"Season {season_year}" if season_year else "Unknown Season"

        # Get detailed F1 information from parsed data
        grand_prix_name = parsed_data.get('sport_grand_prix_name')
        venue = parsed_data.get('sport_venue')
        city = parsed_data.get('sport_city')
        country = parsed_data.get('sport_country')

        # Determine if we need resolution-based folder structure
        resolution_folder = get_sports_resolution_folder(file, resolution)

        # Build destination path using configurable sports folder
        sports_base_folder = custom_sports_layout() or 'Sports'

        if is_source_structure_enabled():
            dest_path = os.path.join(dest_dir, sports_base_folder, sport_folder, season_folder)
        else:
            # Use standard layout with resolution folders if enabled
            if is_sports_resolution_structure_enabled():
                dest_path = os.path.join(dest_dir, sports_base_folder, resolution_folder, sport_folder, season_folder)
            else:
                dest_path = os.path.join(dest_dir, sports_base_folder, sport_folder, season_folder)

        # Create event folder using API data (preferred) or parsed data
        if event_name:
            # Use API event name as-is - it's already complete and correct
            official_event_name = event_name
            event_folder = sanitize_windows_filename(official_event_name)
            dest_path = os.path.join(dest_path, event_folder)
        
        if rename_enabled:
            if round_number and location:
                location_name = country if country else location

                if session_type:
                    clean_name = f"{sport_name} {season_year} R{round_number:02d} {location_name} {session_type}"
                else:
                    clean_name = f"{sport_name} {season_year} R{round_number:02d} {location_name}"
            else:
                if session_type:
                    clean_name = f"{sport_name} {season_year} {location} {session_type}"
                else:
                    clean_name = f"{sport_name} {season_year} {location}"

            # Add resolution if available
            if resolution and resolution != 'Unknown':
                clean_name += f" {resolution}"

            # Get file extension
            file_ext = os.path.splitext(file)[1]
            new_filename = sanitize_windows_filename(clean_name) + file_ext
        else:
            new_filename = file
        
        dest_file = os.path.join(dest_path, new_filename)

        # Return data to symlink creator for proper handling (like movies and shows)
        # Extended format for sports: includes sports metadata at the end
        return (
            dest_file,           # dest_file
            sportsdb_league_id,  # tmdb_id (using league_id for sports)
            'Sports',           # media_type
            proper_name,        # proper_name
            str(season_year) if season_year else None,  # year
            str(round_number) if round_number else None,  # episode_number_str (using round for sports)
            None,               # imdb_id (not applicable for sports)
            False,              # is_anime_genre
            False,              # is_kids_content
            language,           # language
            quality,            # quality
            None,               # tvdb_id (not applicable for sports)
            sportsdb_league_id, # league_id
            sportsdb_event_id,  # sportsdb_event_id
            # Sports-specific metadata
            sport_name,         # sport_name
            round_number,       # sport_round
            event_name,         # sport_location (event name)
            session_type,       # sport_session
            venue,              # sport_venue
            date                # sport_date
        )
        
    except Exception as e:
        log_message(f"Error processing sports content {file}: {e}", level="ERROR")
        track_file_failure(src_file, None, None, "Sports processing error", str(e))
        return None

def get_sports_resolution_folder(filename, resolution):
    """Get the appropriate resolution folder for sports content"""
    if not resolution or resolution == 'Unknown':
        return 'Sports'
    
    # Map resolution to folder names
    resolution_mapping = {
        '2160p': '4K Sports',
        '4K': '4K Sports', 
        '1080p': 'HD Sports',
        '720p': 'HD Sports',
        '480p': 'SD Sports',
        '360p': 'SD Sports'
    }
    
    return resolution_mapping.get(resolution, 'Sports')

def is_sports_resolution_structure_enabled():
    """Check if sports resolution structure is enabled"""
    return get_setting_with_client_lock('SPORTS_RESOLUTION_STRUCTURE_ENABLED', False, 'bool')

def is_sports_file(filename):
    """
    Check if a file appears to be sports content based on filename patterns
    """
    from MediaHub.config.sports_patterns import get_sports_patterns

    sports_patterns = get_sports_patterns()

    for pattern in sports_patterns:
        if re.search(pattern, filename, re.IGNORECASE):
            return True

    return False