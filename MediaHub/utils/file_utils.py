import re
import os
import inspect
from utils.logging_utils import log_message

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
    resolution_match = re.search(r'(4K|2160p|1080p|720p|1080|2160|480p)', filename, re.IGNORECASE)
    remux_match = re.search(r'(Remux)', filename, re.IGNORECASE)

    if resolution_match:
        resolution = resolution_match.group(1).lower()
        if remux_match:
            resolution += 'Remux'
        return resolution
    return None

def clean_query(query):
    if not isinstance(query, str):
        log_message(f"Invalid query type: {type(query)}. Expected string.", "ERROR", "stderr")
        return ""  # Return an empty string or handle as needed

    log_message(f"Original query: '{query}'", "DEBUG", "stdout")

    # Define keywords to remove including quality and encoding terms
    remove_keywords = [
        'Unrated', 'Remastered', 'IMAX', 'Extended', 'BDRemux', 'ITA', 'ENG', 'x265', 'H265', 'HDR10',
        'WebDl', 'Rip', '4K', 'HDR', 'DV', '2160p', 'BDRip', 'AC3', '5.1', 'Sub', 'NAHOM', 'mkv', 'Complete'
    ]

    for keyword in remove_keywords:
        query = re.sub(r'\b' + re.escape(keyword) + r'\b', '', query, flags=re.IGNORECASE)

    query = re.sub(r'\bS\d{2}\b.*', '', query, flags=re.IGNORECASE)
    query = re.sub(r'\(\s*\)', '', query)
    query = re.sub(r'\s+', ' ', query).strip()

    # Identify the calling file
    caller = inspect.stack()[1].filename
    if 'movie_processor.py' in caller:
        return query

    # Extract year if present for shows or other cases
    match_year = re.search(r'\b(\d{4})\b', query)
    if match_year:
        year = match_year.group(1)
        title = query[:match_year.start()].strip()
        return title, year

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

def standardize_title(title):
    replacements = {
        '0': 'o', '1': 'i', '4': 'a', '5': 's', '7': 't', '9': 'g',
        '@': 'a', '#': 'h', '$': 's', '%': 'p', '&': 'and', '*': 'x',
        '3': 'e'
    }

    def replacement_func(match):
        char = match.group(0)
        standardized_char = replacements.get(char, char)
        return standardized_char

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
