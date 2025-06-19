import re
import os
import json
import builtins
import unicodedata
from typing import Tuple, Optional, Dict, List, Set, Union, Any
from functools import lru_cache
from MediaHub.utils.logging_utils import log_message
from MediaHub.config.config import *
from MediaHub.utils.parser.extractor import extract_all_metadata
from MediaHub.utils.parser.parse_anime import is_anime_filename

# ============================================================================
# MAIN STRUCTURED PARSING FUNCTIONS
# ============================================================================

def parse_media_file(filename: str) -> Dict[str, Any]:
    """
    Parse a media filename and return comprehensive structured information.
    This is the main function to use for new code.

    Args:
        filename: The filename to parse

    Returns:
        Dictionary with parsed information including:
        - title: Cleaned title
        - year: Release year
        - resolution: Video resolution (1080p, 720p, etc.)
        - quality_source: Source quality (BluRay, WEB-DL, etc.)
        - video_codec: Video codec (x264, x265, etc.)
        - audio_codecs: List of audio codecs
        - audio_channels: List of audio channels
        - release_group: Release group
        - is_dubbed: Whether it's dubbed
        - season: Season number (for TV shows)
        - episode: Episode number (for TV shows)
        - episode_title: Episode title (for TV shows)
        - languages: List of languages
        - is_repack: Whether it's a repack
        - is_anime: Whether it's anime content
        - container: File container format
        - hdr: HDR information
        - is_proper: Whether it's a proper release

    Examples:
        >>> parse_media_file("1923.S02E05.Only.Gunshots.to.GuideUs.1080p.Webrip.10bit.DDP5.1.x265-HODL.mkv")
        {
            "title": "1923",
            "year": None,
            "season": 2,
            "episode": 5,
            "episode_title": "Only Gunshots to GuideUs",
            "resolution": "1080p",
            "quality_source": "Webrip",
            "video_codec": "X265",
            "audio_codecs": ["DDP"],
            "audio_channels": ["5.1"],
            "release_group": "HODL",
            "container": "mkv",
            "is_anime": false
        }
    """
    try:
        # Use the unified parser
        metadata = extract_all_metadata(filename)
        result = metadata.to_dict()

        # Normalize Unicode characters in the title for better API compatibility
        if 'title' in result and result['title']:
            result['title'] = normalize_unicode_characters(result['title'])

        return result
    except Exception as e:
        log_message(f"Error parsing media file '{filename}': {e}", "ERROR")
        return {"title": filename, "error": str(e)}

def parse_media_file_json(filename: str, indent: int = 2) -> str:
    """
    Parse a media filename and return JSON string with structured information.

    Args:
        filename: The filename to parse
        indent: JSON indentation (None for compact)

    Returns:
        JSON string with parsed information
    """
    try:
        result = parse_media_file(filename)
        return json.dumps(result, indent=indent, default=str)
    except Exception as e:
        log_message(f"Error parsing media file to JSON '{filename}': {e}", "ERROR")
        return json.dumps({"title": filename, "error": str(e)}, indent=indent)

# ============================================================================
# LEGACY COMPATIBILITY FUNCTIONS (Updated to use structured parser)
# ============================================================================

def extract_year(query: str) -> Optional[int]:
    """Extract year from query string using the unified parser."""
    if not isinstance(query, str):
        return None
    try:
        metadata = extract_all_metadata(query)
        return metadata.year
    except Exception:
        return None

def extract_movie_name_and_year(filename: str) -> Tuple[Optional[str], Optional[str]]:
    """Extract movie name and year from filename using the unified parser."""
    if not isinstance(filename, str) or not filename.strip():
        return None, None
    try:
        metadata = extract_all_metadata(filename)
        title = metadata.title
        year = metadata.year
        return title, str(year) if year else None
    except Exception:
        return None, None

def extract_resolution_from_filename(filename: str) -> Optional[str]:
    """Extract resolution from filename using the unified parser."""
    if not isinstance(filename, str) or not filename.strip():
        return None
    try:
        metadata = extract_all_metadata(filename)
        return metadata.resolution
    except Exception:
        return None

def extract_title(filename: str) -> str:
    """Extract title from filename using the unified parser with Unicode normalization."""
    if not isinstance(filename, str) or not filename.strip():
        return ""
    try:
        metadata = extract_all_metadata(filename)
        title = metadata.title
        if title:
            # Normalize Unicode characters for better API compatibility
            title = normalize_unicode_characters(title)
            return title
        return "Unknown Title"
    except Exception:
        return "Unknown Title"

def _is_clean_title(query: str) -> bool:
    """
    Check if a query string appears to be already a clean title.

    A clean title typically:
    - Contains only letters, numbers, spaces, and basic punctuation
    - Has no file extensions
    - Has no technical terms like resolution, codecs, etc.
    - Has no years in parentheses or brackets
    - Has no dots used as separators (except in abbreviations)
    """
    if not query or not query.strip():
        return False

    query = query.strip()

    # Check for file extensions
    if re.search(r'\.(mkv|mp4|avi|mov|wmv|flv|webm|m4v|mpg|mpeg|ts|m2ts)$', query, re.IGNORECASE):
        return False

    # Check for technical terms that indicate it's a filename
    technical_terms = [
        r'\b\d{3,4}p\b',  # Resolution like 1080p, 720p
        r'\b(BluRay|WEB-DL|WEBRip|HDTV|x264|x265|H264|H265|HEVC|AAC|AC3|DTS)\b',  # Technical terms
        r'\b(MULTI|DUAL|REPACK|PROPER|EXTENDED|UNCUT|DIRECTORS|THEATRICAL)\b',  # Release terms
        r'\b[A-Z]{2,}-[A-Z0-9]+\b',  # Release group patterns like "RARBG", "LOST"
        r'\bS\d{1,2}\.E\d{1,2}\b',  # Season/episode patterns like S01.E01
        r'\bS\d{1,2}E\d{1,2}\b',    # Season/episode patterns like S01E01
        r'\bS\d{1,2}\b',            # Season patterns like S01, S02, S03
        r'\bE\d{1,3}\b',            # Episode patterns like E01, E02
        r'\bSeason\s+\d+\b',        # Season patterns like "Season 1"
    ]

    for pattern in technical_terms:
        if re.search(pattern, query, re.IGNORECASE):
            return False

    # Check for years in brackets/parentheses (common in filenames)
    if re.search(r'[\[\(]\d{4}[\]\)]', query):
        return False

    # Check for excessive dots (indicating dot-separated filename format)
    if query.count('.') > 2:  # Allow some dots for abbreviations like "U.S.A."
        return False

    # Check for patterns that look like filename separators
    if re.search(r'[._-]{2,}', query):  # Multiple consecutive separators
        return False

    # If none of the filename indicators are found, it's likely a clean title
    return True

def clean_query(query: str) -> Dict[str, Any]:
    """
    Parse media filename and return comprehensive structured information.

    Returns:
        Dictionary with complete parsing results including:
        - title: Cleaned title
        - year: Release year
        - resolution: Video resolution
        - quality_source: Source quality
        - video_codec: Video codec
        - audio_codecs: Audio codecs
        - audio_channels: Audio channels
        - languages: Languages
        - season: Season number (for TV shows)
        - episode: Episode number (for TV shows)
        - episode_title: Episode title (for TV shows)
        - release_group: Release group
        - And all other attributes from the unified parser
    """
    if not isinstance(query, str):
        log_message(f"Invalid query type: {type(query)}. Expected string.", "ERROR", "stderr")
        return {"title": "", "error": "Invalid input type"}

    log_message(f"Original query: '{query}'", "DEBUG", "stdout")

    # Check if the query is already a clean title (no file extensions, technical terms, or complex patterns)
    # If it looks like a clean title, return it as-is to avoid unnecessary parsing
    if _is_clean_title(query):
        log_message(f"Query appears to be already clean, returning as-is: '{query}'", level="DEBUG")
        return {"title": query, "episodes": [], "seasons": [], "episode_identifier": None}

    try:
        # Use the unified parser
        metadata = extract_all_metadata(query)
        result = metadata.to_dict()

        # Normalize Unicode characters in the title for better API compatibility
        if 'title' in result and result['title']:
            result['title'] = normalize_unicode_characters(result['title'])

        # Add legacy compatibility fields
        result['episodes'] = [metadata.episode] if metadata.episode else []
        result['seasons'] = [metadata.season] if metadata.season else []

        # For episode_identifier, only create if we have actual season info
        if metadata.episode and metadata.season:
            result['episode_identifier'] = f"S{metadata.season:02d}E{metadata.episode:02d}"
        elif metadata.episode:
            # For anime files without season info, don't create episode_identifier
            # This prevents defaulting to S01 when there's no actual season information
            result['episode_identifier'] = None
        else:
            result['episode_identifier'] = None

        result['show_name'] = result['title'] if metadata.season or metadata.episode else None
        result['create_season_folder'] = bool(metadata.season or metadata.episode)
        result['is_extra'] = False
        result['dubbed'] = metadata.is_dubbed
        result['subbed'] = metadata.is_subbed
        result['repack'] = metadata.is_repack
        result['proper'] = metadata.is_proper
        result['quality'] = metadata.quality_source  # Legacy field name
        result['codec'] = metadata.video_codec  # Legacy field name
        result['audio'] = metadata.audio_codecs  # Legacy field name
        result['channels'] = metadata.audio_channels  # Legacy field name
        result['group'] = metadata.release_group  # Legacy field name

        # Add season/episode numbers as strings for compatibility
        if metadata.season:
            result['season_number'] = f"{metadata.season:02d}"
        # Don't default to season 1 if there's no actual season information

        if metadata.episode:
            result['episode_number'] = f"{metadata.episode:02d}"

        log_message(f"Final parsed result: title='{result.get('title')}', episode='{result.get('episode_identifier')}'", level="DEBUG")
        return result

    except Exception as e:
        log_message(f"Error using parser for query cleaning: {e}", "ERROR")
        return {"title": query, "error": str(e), "episodes": [], "seasons": []}





# ============================================================================
# UNICODE AND CHARACTER NORMALIZATION FUNCTIONS
# ============================================================================

def normalize_unicode_characters(text: str) -> str:
    """
    Normalize Unicode characters to their ASCII equivalents for better TMDB matching.

    This function handles special Unicode characters that might appear in filenames
    but cause issues with API searches, such as:
    - Modifier Letter Colon (꞉) -> Regular Colon (:)
    - Various Unicode punctuation -> ASCII equivalents

    Args:
        text: Text containing potentially problematic Unicode characters

    Returns:
        Text with normalized characters
    """
    if not isinstance(text, str):
        return ""

    # First, handle specific problematic characters
    character_replacements = {
        '\ua789': ':',  # MODIFIER LETTER COLON -> COLON
        '\u02d0': ':',  # MODIFIER LETTER TRIANGULAR COLON -> COLON
        '\uff1a': ':',  # FULLWIDTH COLON -> COLON
        '\u2236': ':',  # RATIO -> COLON
        '\u2237': ':',  # PROPORTION -> COLON
        '\u205a': ':',  # TWO DOT PUNCTUATION -> COLON
        '\u2009': ' ',  # THIN SPACE -> REGULAR SPACE
        '\u00a0': ' ',  # NON-BREAKING SPACE -> REGULAR SPACE
        '\u2013': '-',  # EN DASH -> HYPHEN
        '\u2014': '-',  # EM DASH -> HYPHEN
        '\u2015': '-',  # HORIZONTAL BAR -> HYPHEN
        '\u2212': '-',  # MINUS SIGN -> HYPHEN
    }

    # Apply specific character replacements
    for unicode_char, replacement in character_replacements.items():
        text = text.replace(unicode_char, replacement)

    # Apply Unicode normalization (NFD = decomposed form)
    # This separates combined characters into base + combining characters
    text = unicodedata.normalize('NFD', text)

    # Remove combining characters (accents, etc.) and keep only ASCII
    # This converts characters like é -> e, ñ -> n, etc.
    ascii_text = ''.join(
        char for char in text
        if unicodedata.category(char) != 'Mn'  # Mn = Nonspacing_Mark (combining chars)
    )

    # Final cleanup: ensure we have clean ASCII
    try:
        # Try to encode as ASCII to catch any remaining problematic characters
        ascii_text.encode('ascii')
        return ascii_text
    except UnicodeEncodeError:
        # If there are still non-ASCII characters, use transliteration
        # This is a more aggressive approach for stubborn characters
        return unicodedata.normalize('NFKD', ascii_text).encode('ascii', 'ignore').decode('ascii')

# ============================================================================
# UTILITY FUNCTIONS (Keep these as they are utility functions)
# ============================================================================

def sanitize_windows_filename(filename: str) -> str:
    """Sanitize a filename to be compatible with Windows filesystem."""
    if not isinstance(filename, str):
        return ""

    if not filename.strip():
        return "sanitized_filename"

    # Windows filename restrictions: \ / : * ? " < > |
    replacements = {
        ':': ' -', '/': '-', '\\': '-', '*': 'x', '?': '',
        '"': "'", '<': '(', '>': ')', '|': '-'
    }

    for char, replacement in replacements.items():
        filename = filename.replace(char, replacement)

    filename = re.sub(r'[\\/:*?"<>|]', '', filename)
    filename = filename.strip(' .')

    if not filename:
        filename = "sanitized_filename"

    return filename



def normalize_query(query: str) -> str:
    """Normalize query string for comparison purposes."""
    if not isinstance(query, str):
        log_message(f"Invalid query type: {type(query)}. Expected string.", "ERROR", "stderr")
        return ""

    normalized_query = re.sub(r'[._-]', ' ', query)
    normalized_query = re.sub(r'[^\w\s\(\)-]', '', normalized_query)
    normalized_query = re.sub(r'\s+', ' ', normalized_query).strip()

    return normalized_query

def is_junk_file(file: str, file_path: str) -> bool:
    """Determine if the file is junk based on size and type."""
    if not isinstance(file, str) or not isinstance(file_path, str):
        return False

    if not os.path.exists(file_path):
        return False

    if os.path.islink(file_path):
        return False

    if file.lower().endswith(('.srt', '.strm', '.sub', '.idx', '.vtt')):
        return False

    try:
        file_size_mb = os.path.getsize(file_path) / (1024 * 1024)
        junk_max_size_mb = get_junk_max_size_mb()
        return file_size_mb <= junk_max_size_mb
    except (OSError, IOError) as e:
        log_message(f"Error checking file size for {file_path}: {e}", level="ERROR")
        return False

# ============================================================================
# ADDITIONAL UTILITY FUNCTIONS (Previously missing)
# ============================================================================

def standardize_title(title: str, check_word_count: bool = True) -> str:
    """
    Standardize title by replacing special characters with alternatives.

    Args:
        title: Title to standardize
        check_word_count: Whether to check word count before standardizing

    Returns:
        Standardized title
    """
    if not isinstance(title, str):
        return ""

    replacements = {
        '0': 'o', '1': 'i', '4': 'a', '5': 's', '7': 't', '9': 'g',
        '@': 'a', '#': 'h', '$': 's', '%': 'p', '&': 'and', '*': 'x',
        '3': 'e', '8': 'b', '6': 'u'
    }

    def replacement_func(match):
        char = match.group(0)
        return replacements.get(char, char)

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

def remove_genre_names(query: str) -> str:
    """
    Remove common genre names from query string.

    Args:
        query: Query string to clean

    Returns:
        Query with genre names removed
    """
    if not isinstance(query, str):
        return ""

    genre_names = [
        'Action', 'Comedy', 'Drama', 'Thriller', 'Horror', 'Romance', 'Adventure', 'Sci-Fi',
        'Fantasy', 'Mystery', 'Crime', 'Documentary', 'Animation', 'Family', 'Music', 'War',
        'Western', 'History', 'Biography'
    ]

    for genre in genre_names:
        query = re.sub(r'\b' + re.escape(genre) + r'\b', '', query, flags=re.IGNORECASE)

    query = re.sub(r'\s+', ' ', query).strip()
    return query



def check_existing_variations(name: str, year: Optional[int], dest_dir: str) -> Optional[str]:
    """
    Check for existing variations of a media title in the destination directory.

    Args:
        name: Media title to search for
        year: Optional year for better matching
        dest_dir: Destination directory to search in

    Returns:
        Matching directory name if found, None otherwise
    """
    if not isinstance(name, str) or not name.strip():
        return None

    if not os.path.exists(dest_dir):
        log_message(f"Destination directory does not exist: {dest_dir}", level="WARNING")
        return None

    normalized_query = normalize_query(name)
    log_message(f"Checking existing variations for: {name} ({year})", level="DEBUG")

    partial_matches = []

    try:
        # Define MAX_WORD_LENGTH_DIFF if not available from config
        MAX_WORD_LENGTH_DIFF = getattr(builtins, 'MAX_WORD_LENGTH_DIFF', 10)

        for root, dirs, _ in os.walk(dest_dir):
            for d in dirs:
                normalized_d = normalize_query(d)
                d_year = extract_year(d)

                # Prioritize exact matches
                if normalized_query == normalized_d and (d_year == year or not year or not d_year):
                    log_message(f"Found exact matching variation: {d}", level="DEBUG")
                    return d

                # Collect partial matches with stricter criteria
                length_diff = abs(len(normalized_query) - len(normalized_d))
                if (normalized_query in normalized_d or normalized_d in normalized_query) and length_diff < MAX_WORD_LENGTH_DIFF:
                    partial_matches.append((d, d_year))

        if partial_matches:
            # Select the best partial match based on length and year
            closest_match = min(partial_matches, key=lambda x: (len(x[0]), x[1] != year if year else 0))
            log_message(f"Found closest matching variation: {closest_match[0]}", level="DEBUG")
            return closest_match[0]

    except Exception as e:
        log_message(f"Error checking existing variations: {e}", level="ERROR")
        return None

    log_message(f"No matching variations found for: {name} ({year})", level="DEBUG")
    return None

def build_dest_index(dest_dir: str) -> Set[str]:
    """
    Build an index of all files and directories in the destination directory.

    Args:
        dest_dir: Directory to index

    Returns:
        Set of all file and directory paths
    """
    if not isinstance(dest_dir, str) or not os.path.exists(dest_dir):
        log_message(f"Invalid destination directory: {dest_dir}", level="WARNING")
        return set()

    dest_index = set()
    try:
        for root, dirs, files in os.walk(dest_dir):
            for name in dirs + files:
                dest_index.add(os.path.join(root, name))
    except Exception as e:
        log_message(f"Error building destination index: {e}", level="ERROR")

    return dest_index



def extract_resolution_from_folder(folder_path: str) -> Optional[str]:
    """
    Extract resolution from folder path using the unified parser.

    Args:
        folder_path: Folder path to extract resolution from

    Returns:
        Resolution string if found, None otherwise
    """
    if not isinstance(folder_path, str):
        return None

    # Try to extract from the folder name itself
    folder_name = os.path.basename(folder_path)
    try:
        metadata = extract_all_metadata(folder_name)
        if metadata.resolution:
            return metadata.resolution
    except Exception:
        pass

    # Try to extract from parent folder names
    path_parts = folder_path.split(os.sep)
    for part in reversed(path_parts):
        try:
            metadata = extract_all_metadata(part)
            if metadata.resolution:
                return metadata.resolution
        except Exception:
            continue

    return None

def fetch_json(url: str, timeout: int = 10) -> Optional[Dict[str, Any]]:
    """
    Fetch JSON data from a URL.

    Args:
        url: URL to fetch from
        timeout: Request timeout in seconds

    Returns:
        JSON data as dictionary, None on error
    """
    try:
        import requests
        response = requests.get(url, timeout=timeout)
        response.raise_for_status()
        return response.json()
    except Exception as e:
        log_message(f"Error fetching JSON from {url}: {e}", level="ERROR")
        return None

def is_anime_file(filename):
    """
    Detect if the file is likely an anime file using intelligent pattern-based detection.

    This function uses the new anime detection logic that doesn't rely on hardcoded
    release group lists, but instead uses pattern-based detection for any group
    in brackets that doesn't match common non-anime patterns.

    Args:
        filename (str): The filename to check

    Returns:
        bool: True if the file appears to be anime content, False otherwise
    """
    return is_anime_filename(filename)


@lru_cache(maxsize=1)
def get_anime_patterns():
    """
    Legacy function for backward compatibility.

    This function is deprecated. Use is_anime_file() instead for intelligent
    pattern-based anime detection without hardcoded release group lists.

    Returns:
        Compiled regex pattern that matches nothing (deprecated)
    """
    # Return a pattern that matches nothing since this function is deprecated
    # Any code still using this should migrate to is_anime_file()
    log_message("Warning: get_anime_patterns() is deprecated. Use is_anime_file() instead.", "WARNING")
    return re.compile(r'(?!.*)', re.IGNORECASE)  # Pattern that never matches
