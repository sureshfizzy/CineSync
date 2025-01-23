import re
import os
import json
import inspect
import requests
from typing import Tuple, Optional
from MediaHub.utils.logging_utils import log_message
from MediaHub.config.config import *

def fetch_json(url):
    """Fetch JSON data from the provided URL."""
    try:
        response = requests.get(url)
        response.raise_for_status()
        return response.json()
    except requests.exceptions.RequestException as e:
        log_message(f"HTTP request failed: {e}", level="ERROR")
        return {}

def extract_year(query):
    match = re.search(r'\((\d{4})\)$', query.strip())
    if match:
        return int(match.group(1))
    match = re.search(r'(\d{4})$', query.strip())
    if match:
        return int(match.group(1))
    return None

def extract_resolution(filename):
    patterns = [
        r'(\d{3,4}p)',
        r'(\d{3,4}x\d{3,4})'
    ]
    for pattern in patterns:
        match = re.search(pattern, filename, re.IGNORECASE)
        if match:
            return match.group(1)
    return None

def extract_resolution_from_folder(folder_name):
    patterns = [
        r'(\d{3,4}p)',
        r'(\d{3,4}x\d{3,4})'
    ]
    for pattern in patterns:
        match = re.search(pattern, folder_name, re.IGNORECASE)
        if match:
            return match.group(1)
    return None

def extract_folder_year(folder_name):
    resolutions = {'1080', '480', '720', '2160'}

    match = re.search(r'\((\d{4})\)', folder_name)
    if match:
        year = match.group(1)
        if year not in resolutions:
            return int(year)

    match = re.search(r'\.(\d{4})\.', folder_name)
    if match:
        year = match.group(1)
        if year not in resolutions:
            return int(year)

    return None

def extract_movie_name_and_year(filename):
    if re.match(r'^\d{1,2}\.\s+', filename):
        filename = re.sub(r'^\d{1,2}\.\s*', '', filename)

    patterns = [
        r'(.+?)\s*\[(\d{4})\]',
        r'(.+?)\s*\((\d{4})\)',
        r'(.+?)\s*(\d{4})'
    ]

    resolution_match = re.search(r'(2160p|1080p|720p|480p|2160|1080|720|480)', filename, re.IGNORECASE)
    if resolution_match:
        resolution = resolution_match.group(0)

    # Attempt to match each pattern
    for pattern in patterns:
        match = re.search(pattern, filename)
        if match:
            name = match.group(1).replace('.', ' ').replace('-', ' ').strip()
            name = re.sub(r'[\[\]]', '', name).strip()
            year = match.group(2)

            if resolution_match and year == resolution_match.group(0).split('p')[0]:
                year = None

            return name, year
    return None, None

def extract_resolution_from_filename(filename):
    resolution_match = re.search(r'(2160p|1080p|720p|480p|2160|1080|720|480)', filename, re.IGNORECASE)
    remux_match = re.search(r'(Remux)', filename, re.IGNORECASE)

    if resolution_match:
        resolution = resolution_match.group(1).lower()
        if remux_match:
            resolution += 'Remux'
        return resolution
    return None

def load_keywords(file_name, key="keywords"):
    file_path = os.path.join(os.path.dirname(__file__), file_name)
    with open(file_path, 'r') as file:
        data = json.load(file)
    return data.get(key, [])

def load_mediainfo_terms(file_name: str) -> set:
    """Load and flatten all terms from mediainfo.json into a single set."""
    mediainfo_file = os.path.join(os.path.dirname(__file__), file_name)
    try:
        with open(mediainfo_file, 'r') as file:
            data = json.load(file)

        terms = set()
        for category in data.values():
            terms.update([term.lower() for term in category])

        return terms
    except Exception as e:
        log_message(f"Error loading mediainfo terms: {e}", level="ERROR")
        return set()

def clean_query(query, keywords_file='keywords.json'):
    if not isinstance(query, str):
        log_message(f"Invalid query type: {type(query)}. Expected string.", "ERROR", "stderr")
        return "", None

    log_message(f"Original query: '{query}'", "DEBUG", "stdout")

    query = re.sub(r'(?:www\.\S+\.\S+\s*-?)', '', query)

    remove_keywords = load_keywords(keywords_file, key="keywords")
    remove_countries = load_keywords(keywords_file, key="countries")

    query = query.replace('.', ' ')

    # Combine keywords and countries into a single list
    remove_terms = remove_keywords + remove_countries
    terms_pattern = re.compile(r'\b(?:' + '|'.join(map(re.escape, remove_terms)) + r')\b', re.IGNORECASE)
    query = terms_pattern.sub('', query)

    query = re.sub(r'\bMINI-SERIES\b.*', '', query, flags=re.IGNORECASE)
    query = re.sub(r'\(\s*\)', '', query)
    query = re.sub(r'\s+', ' ', query).strip()
    query = re.sub(r'\bSeason \d+\b.*|\bS\d{1,2}EP?\d+\b.*', '', query, flags=re.IGNORECASE)
    query = re.sub(r'\bS\d{1,2}[EЕP]?\d+\b.*', '', query, flags=re.IGNORECASE)
    query = re.sub(r'\[.*?\]', '', query)
    query = re.sub(r'\(\d{4}\)', '', query)
    query = re.sub(r'\.(mkv|mp4|avi)$', '', query, flags=re.IGNORECASE)
    query = re.sub(r'\b(x264|x265|h264|h265|720p|1080p|4K|2160p)\b', '', query, flags=re.IGNORECASE)
    query = re.sub(r'\b\d+MB\b', '', query)
    query = re.sub(r'\b(ESub|Eng Sub)\b', '', query, flags=re.IGNORECASE)

    log_message(f"Final cleaned query: {query}", level="DEBUG")
    return query, None

def normalize_query(query):
    if not isinstance(query, str):
        log_message(f"Invalid query type: {type(query)}. Expected string.", "ERROR", "stderr")
        return ""

    normalized_query = re.sub(r'[._-]', ' ', query)
    normalized_query = re.sub(r'[^\w\s\(\)-]', '', normalized_query)
    normalized_query = re.sub(r'\s+', ' ', normalized_query).strip()

    return normalized_query

def check_existing_variations(name, year, dest_dir):
    normalized_query = normalize_query(name)
    log_message(f"Checking existing variations for: {name} ({year})", level="DEBUG")
    exact_match = None
    partial_matches = []

    for root, dirs, _ in os.walk(dest_dir):
        for d in dirs:
            normalized_d = normalize_query(d)
            d_year = extract_year(d)

            # Prioritize exact matches
            if normalized_query == normalized_d and (d_year == year or not year or not d_year):
                log_message(f"Found exact matching variation: {d}", level="DEBUG")
                return d

            # Collect partial matches with stricter criteria
            if (normalized_query in normalized_d or normalized_d in normalized_query) and abs(len(normalized_query) - len(normalized_d)) < 5:
                partial_matches.append((d, d_year))

    if partial_matches:
        # Select the best partial match based on length and year
        closest_match = min(partial_matches, key=lambda x: (len(x[0]), x[1] != year))
        log_message(f"Found closest matching variation: {closest_match[0]}", level="DEBUG")
        return closest_match[0]

    log_message(f"No matching variations found for: {name} ({year})", level="DEBUG")
    return None

def build_dest_index(dest_dir):
    dest_index = set()
    for root, dirs, files in os.walk(dest_dir):
        for name in dirs + files:
            dest_index.add(os.path.join(root, name))
    return dest_index

def standardize_title(title, check_word_count=True):
    replacements = {
        '0': 'o', '1': 'i', '4': 'a', '5': 's', '7': 't', '9': 'g',
        '@': 'a', '#': 'h', '$': 's', '%': 'p', '&': 'and', '*': 'x',
        '3': 'e', '8': 'b', '6': 'u'
    }

    def replacement_func(match):
        char = match.group(0)
        standardized_char = replacements.get(char, char)
        return standardized_char

    if check_word_count:
        # Count words with non-standard characters
        words = re.findall(r'\b\w+\b', title)
        affected_count = sum(
            1 for word in words if re.search(r'[014579@#$%&*3]', word)
        )

        # Standardize title if more than 4 words are affected
        if affected_count > 4:
            standardized_title = re.sub(r'[0-9@#$%&*3]', replacement_func, title)
        else:
            standardized_title = title
    else:
        # Always standardize title
        standardized_title = re.sub(r'[0-9@#$%&*3]', replacement_func, title)

    # Clean up extra spaces
    standardized_title = re.sub(r'\s+', ' ', standardized_title).strip()
    return standardized_title

def remove_genre_names(query):
    genre_names = [
        'Action', 'Comedy', 'Drama', 'Thriller', 'Horror', 'Romance', 'Adventure', 'Sci-Fi',
        'Fantasy', 'Mystery', 'Crime', 'Documentary', 'Animation', 'Family', 'Music', 'War',
        'Western', 'History', 'Biography'
    ]
    for genre in genre_names:
        query = re.sub(r'\b' + re.escape(genre) + r'\b', '', query, flags=re.IGNORECASE)
    query = re.sub(r'\s+', ' ', query).strip()
    return query


def extract_title(filename):
    pattern = r'^([^.]*?)\s*(?:[Ss]\d{2}[Ee]\d{2}|S\d{2}|E\d{2}|-\d{2,4}p|\.mkv|\.mp4|\.avi|$)'
    match = re.match(pattern, filename)
    if match:
        title = match.group(1).replace('.', ' ').replace('-', ' ').strip()
        title = re.sub(r'\s*\d{2,4}p|\s*[Ss]\d{2}[Ee]\d{2}.*$', '', title).strip()
        return title
    else:
        return "", None

def get_anime_patterns(keywords_file='keywords.json'):
    """
    Returns a compiled regex pattern for detecting anime files.
    Includes patterns for common anime release groups, formats, and naming conventions.
    """

    release_groups = load_keywords(keywords_file, key="release_groups")

    anime_patterns = [
        r'\[(?:' + '|'.join(map(re.escape, release_groups)) + r')\]',
        r'\s-\s\d{2,3}\s',
        r'\[(?:Sub|Dub|Raw)\]',
        r'\[(?:JAP|JPN|ENG|ITA)(?:-SUB)?\]',
        r'\[(?:SUB-ITA|VOSTFR|Multi-Subs|Dual Audio)\]',
        r'\[(?:COMPLETA|Complete)\]',
        r'\[\d+\.\d+GB\]',
        r'\(V\d+\)',
        r'Season_-\d{2}',
    ]

    combined_pattern = '|'.join(f'(?:{pattern})' for pattern in anime_patterns)
    return re.compile(combined_pattern, re.IGNORECASE)

def is_file_extra(file, file_path):
    """
    Determine if the file is an extra based on size.
    Skip .srt files regardless of size.
    """

    if os.path.islink(file_path):
        return False

    if file.lower().endswith('.srt'):
        return False

    file_size_mb = os.path.getsize(file_path) / (1024 * 1024)

    extras_max_size_mb = get_extras_max_size_mb()

    if file_size_mb <= extras_max_size_mb:
        return True
    else:
        return False

def clean_query_movie(query: str, keywords_file: str = 'keywords.json') -> tuple[str, Optional[int]]:
    if not isinstance(query, str):
        log_message(f"Invalid query type: {type(query)}. Expected string.", "ERROR", "stderr")
        return "", None

    log_message(f"Original query: '{query}'", "DEBUG", "stdout")

    # Load configurable keywords to remove
    remove_keywords = load_keywords(keywords_file)

    year_match = re.search(r'(?:19|20)\d{2}', query)
    year = int(year_match.group(0)) if year_match else None

    query = re.sub(r'^\[[^\]]+\]', '', query)
    query = re.sub(r'-[\w\.]+-?$', '', query)
    query = re.sub(r'^(?:www\.)?\w+\.(?:com|org|net)(?:\s*-\s*|\s+)', '', query)

    query = re.sub(r'\[[^\]]*(?:Audio|字幕|双语|音轨)[^\]]*\]', '', query)

    tech_patterns = [
        r'\b\d{3,4}[pi]\b',
        r'\bWEB-?DL\b',
        r'\b(?:H|x)(?:264|265)\b',
        r'\bBlu-?Ray\b',
        r'\bHDR\d*\b',
        r'\bDDP?\d\.?\d?\b',
        r'\b(?:\d+)?Audio\b',
        r'\b\d+bit\b',
        r'\[\d+\.\d+GB\]',
        r'\b(?:AAC|AC3)\b',
        r'\.\w+$'
    ]
    for pattern in tech_patterns:
        query = re.sub(pattern, '', query, flags=re.IGNORECASE)

    english_match = re.search(r'([A-Za-z][A-Za-z\s\.]+(?:Gone[A-Za-z\s\.]+)?)', query)
    if english_match:
        potential_title = english_match.group(1)
        if not re.search(r'\b(?:WEB|DL|HDR|DDP|AAC)\b', potential_title, re.IGNORECASE):
            final_title = potential_title
        else:
            final_title = query
    else:
        parts = re.split(r'[\[\]\(\)]', query)
        final_title = next((part for part in parts if part and not re.search(r'\b(?:WEB|DL|HDR|DDP|AAC)\b', part, re.IGNORECASE)), parts[0])

    final_title = re.sub(r'\s*\b\d{4}\b\s*', '', final_title)
    final_title = re.sub(r'\s*\[.*?\]\s*', '', final_title)
    final_title = re.sub(r'\s*\(.*?\)\s*', '', final_title)
    final_title = re.sub(r'(?<=\w)\.(?=\w)', ' ', final_title)
    final_title = re.sub(r'^[\W_]+|[\W_]+$', '', final_title)
    final_title = re.sub(r'\s+', ' ', final_title)
    final_title = final_title.strip()

    log_message(f"Cleaned movie title: '{final_title}'", "DEBUG", "stdout")
    return final_title, year

def advanced_clean_query(query: str, max_words: int = 4, keywords_file: str = 'keywords.json', mediainfo_file: str = 'mediainfo.json') -> Tuple[str, Optional[str]]:
    """
    Enhanced query cleaning function that uses advanced pattern recognition
    to clean TV show and movie titles, limiting to specified number of words.

    Args:
        query (str): The input query string to clean
        max_words (int): Maximum number of words to keep in the final output
        keywords_file (str): Path to keywords JSON file

    Returns:
        Tuple[str, Optional[str]]: Cleaned query and episode info if present
    """
    if not isinstance(query, str):
        return "", None

    episode_patterns = [
        r'(?:\d+of\d+)',
        r'(?:S\d{1,2}E\d{1,2})',
        r'(?:Season\s*\d+)',
        r'(?:Series\s*\d+)',
        r'(?:\d{1,2}x\d{1,2})',
        r'(?:E\d{1,2})',
        r'(?:\d{1,2}\s*-\s*\d{1,2})',
        r'\bS\d{1,2}\b',
        r'\bSeason\s*\d{1,2}\b',
        r'\[S\d{1,2}\]',
        r'\(S\d{1,2}\)',
        r'S\d{1,2}$',
        r'S(\d+)E(\d+)',
        r'Episode\s+(\d+)\s+(.*)',
        r'(?i)Episode\s+(\d+)\s+(.*?)\.(\w+)$', 
        r'Episode\s+(\d+)\s+(.*?)\.(\w+)$',
    ]

    technical_patterns = [
        r'\d{3,4}p',
        r'(?:WEB-DL|HDTV|BluRay|BDRip)',
        r'(?:x264|x265|h264|h265)',
        r'(?:AAC|AC3|MP3)',
        r'(?:HEVC|10bit)',
        r'\[.*?\]',
        r'\(.*?\)',
        r'(?:MVGroup|Forum)',
        r'\b\d{4}\b',
        r'(?:mkv|mp4|avi)',
        r'S\d{1,2}E\d{1,2}',
        r'-\s*S\d+E\d+E\d+',
        r'\[\d+\]'
    ]

    channel_pattern = r'^(?:Ch\d+|BBC\d*|ITV\d*|NBC|CBS|ABC|Fox|A&C)\.'
    query = re.sub(channel_pattern, '', query, flags=re.IGNORECASE)

    for pattern in technical_patterns:
        query = re.sub(pattern, '', query, flags=re.IGNORECASE)

    episode_info = None
    for pattern in episode_patterns:
        match = re.search(pattern, query, re.IGNORECASE)
        if match:
            episode_info = match.group(0)
            query = re.sub(pattern, '', query)
            break

    query = query.replace('.', ' ')
    query = query.replace('_', ' ')
    query = query.replace('-', ' ')
    query = re.sub(r'\[.*?\]', '', query)
    query = re.sub(r'\(.*?\)', '', query)
    query = re.sub(r'[^\w\s]', '', query)
    query = re.sub(r'\s+', ' ', query)
    common_words = set(load_keywords(keywords_file, key="keywords"))
    query_words = query.split()
    query_words = [word for word in query_words if word.lower() not in common_words]
    query_words = query_words[:max_words]
    query = ' '.join(query_words)

    media_words = load_mediainfo_terms(mediainfo_file)
    query_words = query.split()
    query_words = [word for word in query_words if word.lower() not in media_words]
    query = ' '.join(query_words)
    query = query.strip()

    return query, None
