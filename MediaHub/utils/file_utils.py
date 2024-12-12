import re
import os
import json
import inspect
import requests
from utils.logging_utils import log_message
from config.config import *

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

    # Attempt to match each pattern
    for pattern in patterns:
        match = re.search(pattern, filename)
        if match:
            name = match.group(1).replace('.', ' ').replace('-', ' ').strip()
            name = re.sub(r'[\[\]]', '', name).strip()
            year = match.group(2)
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

def load_keywords(file_name):
    file_path = os.path.join(os.path.dirname(__file__), file_name)
    with open(file_path, 'r') as file:
        data = json.load(file)
    return data.get("keywords", [])

def clean_query(query, keywords_file='keywords.json'):
    if not isinstance(query, str):
        log_message(f"Invalid query type: {type(query)}. Expected string.", "ERROR", "stderr")
        return "", None

    log_message(f"Original query: '{query}'", "DEBUG", "stdout")

    query = re.sub(r'(?:www\.\S+\.\S+\s*-?)', '', query)

    remove_keywords = load_keywords(keywords_file)

    query = query.replace('.', ' ')

    keywords_pattern = re.compile(r'\b(?:' + '|'.join(map(re.escape, remove_keywords)) + r')\b', re.IGNORECASE)
    query = keywords_pattern.sub('', query)

    query = re.sub(r'\bMINI-SERIES\b.*', '', query, flags=re.IGNORECASE)
    query = re.sub(r'\(\s*\)', '', query)
    query = re.sub(r'\s+', ' ', query).strip()
    query = re.sub(r'\bSeason \d+\b.*|\bS\d{1,2}EP?\d+\b.*', '', query, flags=re.IGNORECASE)
    query = re.sub(r'\[.*?\]', '', query)
    query = re.sub(r'\(\d{4}\)', '', query)
    query = re.sub(r'\.(mkv|mp4|avi)$', '', query, flags=re.IGNORECASE)
    query = re.sub(r'\b(x264|x265|h264|h265|720p|1080p|4K|2160p)\b', '', query, flags=re.IGNORECASE)
    query = re.sub(r'\b\d+MB\b', '', query)
    query = re.sub(r'\b(ESub|Eng Sub)\b', '', query, flags=re.IGNORECASE)

    print(f"Final cleaned query: '{query}'")
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

def get_anime_patterns():
    """
    Returns a compiled regex pattern for detecting anime files.
    Includes patterns for common anime release groups, formats, and naming conventions.
    """
    anime_patterns = [
        r'\[(?:SubsPlease|Erai-raws|HorribleSubs|HorribleRips|Judas|EMBER|ASW|Commie|GJM|SSA|Mezashite|Underwater|Seregorn)\]',
        r'\s-\s\d{2,3}\s',
        r'\[(?:Sub|Dub|Raw)\]',
        r'\[(?:1080p|720p|480p)\]',
        r'\[(?:H264|H\.264|H265|H\.265|x264|x265)\]',
        r'\[(?:AAC|AC3|FLAC)\]',
        r'\[(?:10bit|8bit)\]',
        r'\[(?:BD|BluRay|WEB|WEBRip|HDTV)\]',
        r'\[(?:JAP|JPN|ENG|ITA)(?:-SUB)?\]',
        r'\[(?:SUB-ITA|VOSTFR|Multi-Subs|Dual Audio)\]',
        r'\[(?:COMPLETA|Complete)\]',
        r'\[\d+\.\d+GB\]',
        r'\(V\d+\)',
        r'Season_-\d{2}',
    ]

    combined_pattern = '|'.join(f'(?:{pattern})' for pattern in anime_patterns)
    return re.compile(combined_pattern, re.IGNORECASE)

def skip_files(file):
    """Determine if the file should be skipped based on its extension."""
    extensions = {'.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tiff', '.ping', '.txt'}
    _, ext = os.path.splitext(file.lower())
    return ext in extensions

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

def clean_query_movie(query, keywords_file='keywords.json'):
    if not isinstance(query, str):
        log_message(f"Invalid query type: {type(query)}. Expected string.", "ERROR", "stderr")
        return ""

    log_message(f"Original query: '{query}'", "DEBUG", "stdout")

    # Load keywords to remove
    remove_keywords = load_keywords(keywords_file)

    query = re.sub(r'www\.[^\s]+\s+-\s+', '', query)
    query = query.replace('.', ' ')
    keywords_pattern = re.compile(r'\b(?:' + '|'.join(map(re.escape, remove_keywords)) + r')\b', re.IGNORECASE)
    query = keywords_pattern.sub('', query)
    query = re.sub(r'\b(?:\d{3,4}p|WEB-DL|HDRIP|BLURAY|DVDRIP|UNTOUCHED|AVC|AAC|ESub)\b', '', query, flags=re.IGNORECASE)
    query = re.sub(r'\b\d+(?:\.\d+)?\s*(?:GB|MB)\b', '', query, flags=re.IGNORECASE)
    query = re.sub(r'\(\d{4}\)', '', query)
    query = re.sub(r'\[.*?\]', '', query)
    query = re.sub(r'-+', ' ', query)
    query = re.sub(r'\s+', ' ', query).strip()
    query = re.sub(r'\b\d+\b', '', query).strip()
    query = re.sub(r'\b(?:Telugu|Hindi|Tamil|Malayalam|Kannada|Bengali|Punjabi|Marathi|Gujarati|English)\b', '', query, flags=re.IGNORECASE).strip()
    query = re.sub(r'\b(?:mkv|mp4|avi)\b', '', query, flags=re.IGNORECASE).strip()

    log_message(f"Cleaned movie query: '{query}'", "DEBUG", "stdout")
    return query
