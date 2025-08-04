import os
import re
import requests
import urllib.parse
import logging
import threading
import time
from functools import lru_cache
from MediaHub.utils.logging_utils import log_message
from MediaHub.utils.file_utils import normalize_unicode_characters, sanitize_windows_filename
from MediaHub.api.api_utils import api_retry
from MediaHub.api.sportsdb_api_helpers import *

# Thread-safe caches
_api_cache = {}
_cache_lock = threading.RLock()

# Disable urllib3 debug logging
logging.getLogger("urllib3").setLevel(logging.WARNING)

# SportsDB API configuration - using free v1 API
SPORTSDB_API_KEY = '3'
BASE_URL = f"https://www.thesportsdb.com/api/v1/json/{SPORTSDB_API_KEY}"

# Create a session for connection pooling and better performance
session = requests.Session()
session.headers.update({
    'User-Agent': 'MediaHub/1.0',
    'Accept': 'application/json'
})

from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

adapter = HTTPAdapter(
    pool_connections=50,
    pool_maxsize=50,
    max_retries=Retry(
        total=3,
        backoff_factor=0.1,
        status_forcelist=[500, 502, 503, 504]
    )
)

session.mount('http://', adapter)
session.mount('https://', adapter)

# Thread-safe request cache to avoid duplicate API calls within the same session
_request_cache = {}
_request_cache_lock = threading.RLock()

@api_retry(max_retries=3, base_delay=5, max_delay=60)
def cached_get(url, params=None, timeout=10):
    """Thread-safe cached GET request  for SportsDB (50 requests/minute)"""
    cache_key = f"{url}?{urllib.parse.urlencode(params or {})}"

    with _request_cache_lock:
        if cache_key in _request_cache:
            return _request_cache[cache_key]

    # SportsDB free tier: 50 requests per minute
    # Add delay to respect rate limits when actually making API calls
    time.sleep(1.2)

    response = session.get(url, params=params, timeout=timeout)

    # Handle SportsDB specific rate limiting
    if response.status_code == 429:
        log_message("SportsDB rate limit hit (50/minute). Waiting before retry...", level="WARNING")
        raise requests.exceptions.RequestException(f"Rate limited: {response.status_code}")

    with _request_cache_lock:
        _request_cache[cache_key] = response

    return response

def get_cached_result(cache_key):
    """Thread-safe cache retrieval"""
    with _cache_lock:
        return _api_cache.get(cache_key)

def set_cached_result(cache_key, result):
    """Thread-safe cache storage"""
    with _cache_lock:
        _api_cache[cache_key] = result

@api_retry(max_retries=3, base_delay=5, max_delay=60)
def search_sports_league(league_name):
    """
    sports league search using SportsDB helper 

    Args:
        league_name: Name of the league/organization to search for

    Returns:
        Dict with league information or None if not found
    """
    if not league_name:
        return None

    cache_key = f"league_{league_name.lower()}"
    cached_result = get_cached_result(cache_key)
    if cached_result:
        return cached_result

    try:
        # Use helper from sportsdb_api_helpers
        result = get_organization_league(league_name)

        if result:
            set_cached_result(cache_key, result)
            return result
        else:
            return None

    except Exception as e:
        log_message(f"Error searching for league {league_name}: {e}", level="ERROR")
        return None

@api_retry(max_retries=3, base_delay=5, max_delay=60)
def get_league_seasons(league_id):
    """Get all seasons for a specific league using v1 API with free key and rate limiting"""
    cache_key = f"seasons_{league_id}"
    cached_result = get_cached_result(cache_key)
    if cached_result:
        return cached_result

    try:
        url = f"{BASE_URL}/search_all_seasons.php"
        params = {'id': league_id}
        response = cached_get(url, params=params)
        response.raise_for_status()

        data = response.json()
        seasons = data.get('seasons', [])

        if seasons:
            result = []
            for season in seasons:
                result.append({
                    'season_id': season.get('idSeason'),
                    'season_name': season.get('strSeason'),
                    'year': season.get('strSeason'),
                    'description': season.get('strDescriptionEN')
                })
            set_cached_result(cache_key, result)
            return result

        return []

    except Exception as e:
        log_message(f"Error getting seasons for league {league_id}: {e}", level="ERROR")
        return []

@api_retry(max_retries=3, base_delay=5, max_delay=60)
def get_season_events(league_id, season_name):
    """Get all events for a specific season using v1 API with free key and rate limiting"""
    cache_key = f"events_{league_id}_{season_name}"
    cached_result = get_cached_result(cache_key)
    if cached_result:
        return cached_result

    try:
        url = f"{BASE_URL}/eventsseason.php"
        params = {'id': league_id, 's': season_name}

        response = cached_get(url, params=params)
        response.raise_for_status()

        data = response.json()
        events = data.get('events', [])

        if events:
            result = []
            for event in events:
                result.append({
                    'event_id': event.get('idEvent'),
                    'event_name': event.get('strEvent'),
                    'round': event.get('intRound'),
                    'date': event.get('dateEvent'),
                    'time': event.get('strTime'),
                    'venue': event.get('strVenue'),
                    'country': event.get('strCountry'),
                    'city': event.get('strCity'),
                    'description': event.get('strDescriptionEN'),
                    'poster': event.get('strPoster'),
                    'thumb': event.get('strThumb'),
                    'banner': event.get('strBanner')
                })

            set_cached_result(cache_key, result)
            return result

        return []

    except Exception as e:
        log_message(f"Error getting events for league {league_id} season {season_name}: {e}", level="ERROR")
        return []

@api_retry(max_retries=3, base_delay=5, max_delay=60)
def get_event_details(event_id):
    """Get detailed information about a specific event using v1 API with free key and rate limiting"""
    cache_key = f"event_details_{event_id}"
    cached_result = get_cached_result(cache_key)
    if cached_result:
        return cached_result

    try:
        url = f"{BASE_URL}/lookupevent.php"
        params = {'id': event_id}
        response = cached_get(url, params=params)
        response.raise_for_status()

        data = response.json()
        events = data.get('events', [])

        if events:
            event = events[0]
            result = {
                'event_id': event.get('idEvent'),
                'event_name': event.get('strEvent'),
                'filename': event.get('strFilename'),
                'sport': event.get('strSport'),
                'league': event.get('strLeague'),
                'season': event.get('strSeason'),
                'round': event.get('intRound'),
                'date': event.get('dateEvent'),
                'time': event.get('strTime'),
                'venue': event.get('strVenue'),
                'country': event.get('strCountry'),
                'city': event.get('strCity'),
                'description': event.get('strDescriptionEN'),
                'poster': event.get('strPoster'),
                'thumb': event.get('strThumb'),
                'banner': event.get('strBanner'),
                'video': event.get('strVideo')
            }
            set_cached_result(cache_key, result)
            return result

        return None

    except Exception as e:
        log_message(f"Error getting event details for {event_id}: {e}", level="ERROR")
        return None

@api_retry(max_retries=3, base_delay=5, max_delay=60)
def search_sports_content(sport_name, year=None, round_number=None, event_name=None):
    """
    Search for sports content based on parsed filename information

    Args:
        sport_name: Name of the sport (e.g., "Formula 1", "Football")
        year: Year of the event
        round_number: Round number (for series like F1)
        event_name: Specific event name (e.g., "Hungary", "Monaco")

    Returns:
        Dictionary with sports metadata or None if not found
    """
    try:
        league_result = search_sports_league(sport_name)
        if not league_result:
            log_message(f"League not found for sport: {sport_name}", level="WARNING")
            return None

        if not year:
            log_message(f"Year is required for sports content search", level="WARNING")
            return None

        league_id = league_result['league_id']
        season_name = str(year)

        # Get events for the season
        events = get_season_events(league_id, season_name)

        # Find matching event
        target_event = None

        if round_number and events:
            for event in events:
                event_round = event.get('round')
                # Handle both string and integer round comparison
                if str(event_round) == str(round_number):
                    target_event = event
                    break

        if not target_event and event_name and events:
            for event in events:
                event_name_lower = event.get('event_name', '').lower()
                if event_name.lower() in event_name_lower or event_name_lower in event_name.lower():
                    target_event = event
                    break

        # Compile result using API data
        final_event_name = target_event.get('event_name') if target_event else event_name

        result = {
            'league': league_result,
            'season': {'season_name': season_name, 'year': year},
            'event': target_event,
            'sport_type': 'sports',
            'metadata': {
                'sport_name': league_result['league_name'],
                'season_year': str(year),
                'event_name': final_event_name,
                'round_number': target_event.get('round') if target_event else round_number,
                'venue': target_event.get('venue') if target_event else None,
                'date': target_event.get('date') if target_event else None,
                'location': final_event_name
            }
        }

        return result

    except Exception as e:
        log_message(f"Error searching sports content for {sport_name}: {e}", level="ERROR")
        return None