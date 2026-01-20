import re
import os
import json
import builtins
import unicodedata
import platform
from typing import Tuple, Optional, Dict, List, Set, Union, Any
from functools import lru_cache
from MediaHub.utils.logging_utils import log_message
from MediaHub.utils.parser.extractor import extract_all_metadata
from MediaHub.utils.parser.parse_anime import is_anime_filename

# ============================================================================
# OS Detection
# ============================================================================
IS_WINDOWS = platform.system() == 'Windows'

# ============================================================================
# Country code normalization
# ============================================================================
def normalize_country_code(code: Optional[str]) -> Optional[str]:
    """
    Normalize country codes/names to ISO alpha-2 with common aliases.
    Handles legacy/variant entries (e.g., SU -> RU).
    """
    if not code:
        return None
    name_to_iso = {
        'UNITED STATES': 'US', 'USA': 'US', 'US': 'US',
        'UNITED KINGDOM': 'GB', 'UK': 'GB', 'GREAT BRITAIN': 'GB', 'BRITAIN': 'GB', 'ENGLAND': 'GB',
        'CANADA': 'CA', 'AUSTRALIA': 'AU',
        'GERMANY': 'DE', 'FRANCE': 'FR', 'SPAIN': 'ES', 'ITALY': 'IT',
        'RUSSIA': 'RU', 'RUSSIAN FEDERATION': 'RU', 'SOVIET UNION': 'RU', 'SU': 'RU',
        'INDIA': 'IN', 'CHINA': 'CN', 'JAPAN': 'JP',
        'SOUTH KOREA': 'KR', 'KOREA': 'KR', 'NORTH KOREA': 'KP',
        'BRAZIL': 'BR', 'MEXICO': 'MX',
    }
    val = str(code).strip().upper()
    if len(val) == 2:
        return name_to_iso.get(val, val)
    return name_to_iso.get(val, val)

def map_lang_to_locale(lang_code_or_locale: Optional[str]) -> Optional[str]:
    """
    Map short language codes to TMDB-friendly locales when possible (e.g., ru -> ru-RU).
    Falls back to the provided value if no mapping exists.
    """
    if not lang_code_or_locale:
        return None
    val = str(lang_code_or_locale).strip()
    if len(val) <= 2:
        lc = val.lower()
        mapping = {
            'en': 'en-US', 'es': 'es-ES', 'fr': 'fr-FR', 'de': 'de-DE',
            'it': 'it-IT', 'pt': 'pt-PT', 'pt-br': 'pt-BR',
            'ru': 'ru-RU', 'ja': 'ja-JP', 'ko': 'ko-KR', 'zh': 'zh-CN',
            'ar': 'ar-SA', 'hi': 'hi-IN', 'pl': 'pl-PL', 'cs': 'cs-CZ',
            'tr': 'tr-TR', 'el': 'el-GR', 'he': 'he-IL', 'nl': 'nl-NL',
            'sv': 'sv-SE', 'no': 'no-NO', 'da': 'da-DK', 'fi': 'fi-FI',
            'id': 'id-ID', 'vi': 'vi-VN', 'ro': 'ro-RO', 'ms': 'ms-MY',
            'th': 'th-TH', 'hu': 'hu-HU',
        }
        return mapping.get(lc, val)
    return val

# Cache for parsed metadata to avoid redundant parsing
_metadata_cache = {}

# Cache for keywords dataz
_keywords_cache = None

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
        r'\bS\d{1,2}-S\d{1,2}\b',   # Season ranges like S01-S08
        r'\bS\d{1,2}-\d{1,2}\b',    # Season ranges like S1-25, S01-25
        r'\b\d{1,2}-\d{1,2}\b',     # Plain number ranges like 1-25, 01-25 (season ranges)
        r'\b\d{1,2}x\d{1,2}\b',     # Season x Episode patterns like 1x02
        r'\bS\d{1,2}\b',            # Season patterns like S01, S02, S03
        r'\bE\d{1,3}\b',            # Episode patterns like E01, E02
        r'\bSeason\s+\d+\b',        # Season patterns like "Season 1"
        r'\b[Ss]eason\d+\b',         # Season patterns like "season09", "Season09"
        r'\bS\s+\d+\b',             # Season patterns like "S 09"
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

    # Check cache first to avoid redundant parsing
    if query in _metadata_cache:
        return _metadata_cache[query]

    # Check if the query is already a clean title (no file extensions, technical terms, or complex patterns)
    # If it looks like a clean title, return it as-is to avoid unnecessary parsing
    if _is_clean_title(query):
        log_message(f"Query appears to be already clean, returning as-is: '{query}'", level="DEBUG")
        result = {"title": query, "episodes": [], "seasons": [], "episode_identifier": None}
        _metadata_cache[query] = result
        return result

    try:
        # Use the unified parser
        metadata = extract_all_metadata(query)
        result = metadata.to_dict()

        # Normalize Unicode characters in the title for better API compatibility
        if 'title' in result and result['title']:
            result['title'] = normalize_unicode_characters(result['title'])

        # Add alternative title if available
        if metadata.alternative_title:
            result['alternative_title'] = normalize_unicode_characters(metadata.alternative_title)

        # Add legacy compatibility fields
        result['episodes'] = [metadata.episode] if metadata.episode else []
        result['seasons'] = [metadata.season] if metadata.season else []

        # For episode_identifier, create if we have episode info
        if metadata.episode and metadata.season:
            result['episode_identifier'] = f"S{metadata.season:02d}E{metadata.episode:02d}"
        elif metadata.episode:
            # If we have episode but no season, just use episode number
            result['episode_identifier'] = f"E{metadata.episode:02d}"
        elif metadata.air_date:
            # Date-based (daily) episodes use air-date as identifier
            result['episode_identifier'] = metadata.air_date
        else:
            result['episode_identifier'] = None

        result['show_name'] = result['title'] if metadata.season or metadata.episode or metadata.is_daily else None
        result['create_season_folder'] = bool(metadata.season or metadata.episode or metadata.is_daily)
        result['is_extra'] = metadata.is_extra
        result['dubbed'] = metadata.is_dubbed
        result['subbed'] = metadata.is_subbed
        result['repack'] = metadata.is_repack
        result['proper'] = metadata.is_proper
        result['quality'] = metadata.quality_source
        result['codec'] = metadata.video_codec
        result['audio'] = metadata.audio_codecs
        result['channels'] = metadata.audio_channels
        result['group'] = metadata.release_group

        # Add season/episode numbers as strings for compatibility
        if metadata.season:
            result['season_number'] = f"{metadata.season:02d}"

        if metadata.episode:
            result['episode_number'] = f"{metadata.episode:02d}"

        # Reduce logging overhead for performance
        log_message(f"Final parsed result: title='{result.get('title')}', episode='{result.get('episode_identifier')}'", level="DEBUG")

        # Cache the result to avoid redundant parsing
        _metadata_cache[query] = result

        # Limit cache size to prevent memory issues
        if len(_metadata_cache) > 1000:
            # Remove oldest entries (simple FIFO approach)
            oldest_keys = list(_metadata_cache.keys())[:100]
            for key in oldest_keys:
                del _metadata_cache[key]

        return result

    except Exception as e:
        log_message(f"Error using parser for query cleaning: {e}", "ERROR")
        error_result = {"title": query, "error": str(e), "episodes": [], "seasons": []}
        _metadata_cache[query] = error_result
        return error_result

# ============================================================================
# UNICODE AND CHARACTER NORMALIZATION FUNCTIONS
# ============================================================================

def remove_accents(input_str: str) -> str:
    """
    Removes accented characters from a string by normalizing it to NFD form
    and then filtering out combining characters.

    Args:
        input_str: The string from which to remove accents.

    Returns:
        The string with accents removed.
    """
    if not isinstance(input_str, str):
        return input_str

    # Normalize the string to NFD (Normalization Form Canonical Decomposition).
    # This separates base characters from their diacritical marks (accents).
    nfkd_form = unicodedata.normalize('NFD', input_str)
    return "".join([char for char in nfkd_form if not unicodedata.combining(char)])

def normalize_unicode_characters(text: str) -> str:
    """
    Normalize Unicode characters to their ASCII equivalents for better TMDB matching and logging.

    This function handles special Unicode characters that might appear in filenames
    but cause issues with API searches or console output, such as:
    - Modifier Letter Colon (꞉) -> Regular Colon (:)
    - Various Unicode punctuation -> ASCII equivalents
    - Accented characters -> Base characters (é -> e, ñ -> n)

    Args:
        text: Text containing potentially problematic Unicode characters

    Returns:
        Text with normalized characters, safe for ASCII output
    """
    if not isinstance(text, str):
        return ""

    # Handle None or empty strings gracefully
    if not text:
        return ""

    # First, handle specific problematic characters
    character_replacements = {
        # Colon variants
        '\ua789': ':',  # MODIFIER LETTER COLON -> COLON
        '\u02d0': ':',  # MODIFIER LETTER TRIANGULAR COLON -> COLON
        '\uff1a': ':',  # FULLWIDTH COLON -> COLON
        '\u2236': ':',  # RATIO -> COLON
        '\u2237': ':',  # PROPORTION -> COLON
        '\u205a': ':',  # TWO DOT PUNCTUATION -> COLON
        '\u02f8': ':',  # MODIFIER LETTER RAISED COLON -> COLON

        # Space variants
        '\u2009': ' ',  # THIN SPACE -> REGULAR SPACE
        '\u00a0': ' ',  # NON-BREAKING SPACE -> REGULAR SPACE
        '\u2000': ' ',  # EN QUAD -> REGULAR SPACE
        '\u2001': ' ',  # EM QUAD -> REGULAR SPACE
        '\u2002': ' ',  # EN SPACE -> REGULAR SPACE
        '\u2003': ' ',  # EM SPACE -> REGULAR SPACE
        '\u2004': ' ',  # THREE-PER-EM SPACE -> REGULAR SPACE
        '\u2005': ' ',  # FOUR-PER-EM SPACE -> REGULAR SPACE
        '\u2006': ' ',  # SIX-PER-EM SPACE -> REGULAR SPACE
        '\u2007': ' ',  # FIGURE SPACE -> REGULAR SPACE
        '\u2008': ' ',  # PUNCTUATION SPACE -> REGULAR SPACE
        '\u200a': ' ',  # HAIR SPACE -> REGULAR SPACE
        '\u202f': ' ',  # NARROW NO-BREAK SPACE -> REGULAR SPACE
        '\u205f': ' ',  # MEDIUM MATHEMATICAL SPACE -> REGULAR SPACE

        # Dash/hyphen variants
        '\u2013': '-',  # EN DASH -> HYPHEN
        '\u2014': '-',  # EM DASH -> HYPHEN
        '\u2015': '-',  # HORIZONTAL BAR -> HYPHEN
        '\u2212': '-',  # MINUS SIGN -> HYPHEN
        '\u2010': '-',  # HYPHEN -> HYPHEN-MINUS
        '\u2011': '-',  # NON-BREAKING HYPHEN -> HYPHEN

        # Quote variants
        '\u2018': "'",  # LEFT SINGLE QUOTATION MARK -> APOSTROPHE
        '\u2019': "'",  # RIGHT SINGLE QUOTATION MARK -> APOSTROPHE
        '\u201c': '"',  # LEFT DOUBLE QUOTATION MARK -> QUOTATION MARK
        '\u201d': '"',  # RIGHT DOUBLE QUOTATION MARK -> QUOTATION MARK
        '\u2032': "'",  # PRIME -> APOSTROPHE
        '\u2033': '"',  # DOUBLE PRIME -> QUOTATION MARK

        # Fraction characters
        '\u00bc': '1/4',  # FRACTION ONE QUARTER -> 1/4
        '\u00bd': '1/2',  # FRACTION ONE HALF -> 1/2
        '\u00be': '3/4',  # FRACTION THREE QUARTERS -> 3/4
        '\u2153': '1/3',  # FRACTION ONE THIRD -> 1/3
        '\u2154': '2/3',  # FRACTION TWO THIRDS -> 2/3
        '\u2155': '1/5',  # FRACTION ONE FIFTH -> 1/5
        '\u2156': '2/5',  # FRACTION TWO FIFTHS -> 2/5
        '\u2157': '3/5',  # FRACTION THREE FIFTHS -> 3/5
        '\u2158': '4/5',  # FRACTION FOUR FIFTHS -> 4/5
        '\u2159': '1/6',  # FRACTION ONE SIXTH -> 1/6
        '\u215a': '5/6',  # FRACTION FIVE SIXTHS -> 5/6
        '\u215b': '1/8',  # FRACTION ONE EIGHTH -> 1/8
        '\u215c': '3/8',  # FRACTION THREE EIGHTHS -> 3/8
        '\u215d': '5/8',  # FRACTION FIVE EIGHTHS -> 5/8
        '\u215e': '7/8',  # FRACTION SEVEN EIGHTHS -> 7/8
        '\u2150': '1/7',  # FRACTION ONE SEVENTH -> 1/7
        '\u2151': '1/9',  # FRACTION ONE NINTH -> 1/9
        '\u2152': '1/10', # FRACTION ONE TENTH -> 1/10
        '\u2189': '0/3',  # FRACTION ZERO THIRDS -> 0/3

        # Other common problematic characters
        '\u2026': '...',  # HORIZONTAL ELLIPSIS -> THREE DOTS
        '\u00b7': '.',    # MIDDLE DOT -> PERIOD
        '\u2022': '*',    # BULLET -> ASTERISK
        '\u00d7': 'x',    # MULTIPLICATION SIGN -> x
    }

    # Apply specific character replacements with proper spacing for fractions
    for unicode_char, replacement in character_replacements.items():
        if unicode_char in ['\u00bc', '\u00bd', '\u00be', '\u2153', '\u2154', '\u2155',
                           '\u2156', '\u2157', '\u2158', '\u2159', '\u215a', '\u215b',
                           '\u215c', '\u215d', '\u215e', '\u2150', '\u2151', '\u2152', '\u2189']:
            # For fraction characters, add space before if preceded by a digit
            import re
            pattern = r'(\d)(' + re.escape(unicode_char) + r')'
            text = re.sub(pattern, r'\1 ' + replacement, text)
            # Handle any remaining fraction characters without preceding digits
            text = text.replace(unicode_char, replacement)
        else:
            text = text.replace(unicode_char, replacement)

    # Use the improved remove_accents function for accent removal
    text = remove_accents(text)

    try:
        text.encode('ascii')
        return text
    except UnicodeEncodeError:
        unicode_letters_digits = sum(1 for c in text if c.isalnum() and not c.isascii())
        total_non_ascii = sum(1 for c in text if not c.isascii())

        if unicode_letters_digits > 0 and unicode_letters_digits >= (total_non_ascii * 0.8):
            return text
        else:
            text = unicodedata.normalize('NFKD', text).encode('ascii', 'ignore').decode('ascii')

    # Remove empty parentheses that result from removing non-ASCII content
    import re
    text = re.sub(r'\(\s*\)', '', text)  # Remove empty parentheses
    text = re.sub(r'\[\s*\]', '', text)  # Remove empty brackets
    text = re.sub(r'\{\s*\}', '', text)  # Remove empty braces
    text = re.sub(r'\s+', ' ', text)     # Clean up multiple spaces
    text = text.strip()                  # Remove leading/trailing spaces

    return text

# ============================================================================
# SYMLINK RESOLUTION FUNCTIONS
# ============================================================================

def resolve_symlink_to_source(file_path: str) -> str:
    """
    Resolve a symlinked file to its actual source path.

    Args:
        file_path: Path to the file (may be a symlink)

    Returns:
        The actual source path if it's a symlink, otherwise the original path
    """
    if not isinstance(file_path, str) or not file_path.strip():
        return file_path

    try:
        # Check if the path exists and is a symlink
        if os.path.islink(file_path):
            # Resolve the symlink to get the actual source path
            resolved_path = os.path.realpath(file_path)
            log_message(f"Resolved symlink: {file_path} -> {resolved_path}", level="DEBUG")
            return resolved_path
        else:
            # Not a symlink, return original path
            return file_path
    except (OSError, IOError) as e:
        log_message(f"Error resolving symlink {file_path}: {e}", level="WARNING")
        return file_path

def get_symlink_target_path(link_path: str) -> str:
    """
    Return an absolute, normalized target path for a symlink, resolving relative targets.
    """
    if not link_path:
        return ""

    try:
        target = os.readlink(link_path)

        if not os.path.isabs(target):
            target = os.path.abspath(os.path.join(os.path.dirname(link_path), target))
        else:
            target = os.path.abspath(target)

        target = os.path.normpath(target)

        if platform.system() == "Windows":
            if len(target) >= 2 and target[1] == ':':
                target = target[0].upper() + target[1:]

        return target
    except (OSError, IOError) as e:
        log_message(f"Failed to read symlink target for {link_path}: {e}", level="DEBUG")
        return ""

def get_source_directory_from_symlink(file_path: str) -> str:
    """
    Get the source directory from a symlinked file.

    Args:
        file_path: Path to the file (may be a symlink)

    Returns:
        The source directory path if it's a symlink, otherwise the directory of the original path
    """
    if not isinstance(file_path, str) or not file_path.strip():
        return ""

    try:
        # Resolve the symlink to get the actual source path
        resolved_path = resolve_symlink_to_source(file_path)

        # Get the directory of the resolved path
        source_dir = os.path.dirname(resolved_path)

        if os.path.islink(file_path):
            log_message(f"Source directory for symlink {file_path}: {source_dir}", level="DEBUG")

        return source_dir
    except Exception as e:
        log_message(f"Error getting source directory from {file_path}: {e}", level="WARNING")
        return os.path.dirname(file_path) if file_path else ""

# ============================================================================
# UTILITY FUNCTIONS (Keep these as they are utility functions)
# ============================================================================

def sanitize_windows_filename(filename: str) -> str:
    """Sanitize a filename to be compatible with the current OS filesystem."""
    if not isinstance(filename, str):
        return ""

    if not filename.strip():
        return "sanitized_filename"

    from MediaHub.config.config import is_replace_illegal_characters_enabled, get_colon_replacement_mode

    replace_enabled = is_replace_illegal_characters_enabled()
    colon_mode = get_colon_replacement_mode()

    if replace_enabled:
        if colon_mode == 'Delete':
            colon_replacement = ''
        elif colon_mode == 'Replace with Dash':
            colon_replacement = '-'
        elif colon_mode == 'Replace with Space Dash':
            colon_replacement = ' -'
        elif colon_mode == 'Replace with Space Dash Space':
            colon_replacement = ' - '
        elif colon_mode == 'Smart Replace':
            colon_replacement = None
        else:
            colon_replacement = ' - '
    else:
        if not IS_WINDOWS:
            return filename
        colon_replacement = ''

    if replace_enabled:
        replacements = {
            '/': '-', '\\': '-', '*': 'x', '?': '',
            '"': "'", '<': '(', '>': ')', '|': '-'
        }
    else:
        replacements = {
            '/': '', '\\': '', '*': '', '?': '',
            '"': '', '<': '', '>': '', '|': ''
        }

    invalid_chars_pattern = r'[\\/:*?"<>|]'

    if colon_mode == 'Smart Replace' and replace_enabled:
        def smart_colon_replace(match):
            before = match.group(1) if match.group(1) else ''
            after = match.group(2) if match.group(2) else ''
            has_space_before = before.endswith(' ') if before else True
            has_space_after = after.startswith(' ') if after else True
            if has_space_before or has_space_after:
                return before.rstrip() + ' - ' + after.lstrip()
            else:
                return before + '-' + after
        filename = re.sub(r'(.?):(.)?' , smart_colon_replace, filename)
    elif colon_replacement is not None:
        if colon_mode == 'Replace with Dash':
            filename = re.sub(r'\s*:\s*', colon_replacement, filename)
        elif colon_mode == 'Replace with Space Dash':
            filename = re.sub(r'\s*:\s*', colon_replacement, filename)
        elif colon_mode == 'Replace with Space Dash Space':
            filename = re.sub(r'\s*:\s*', colon_replacement, filename)
        elif colon_mode == 'Delete':
            filename = re.sub(r'\s*:\s*', ' ', filename)
        else:
            replacements[':'] = colon_replacement

    for char, replacement in replacements.items():
        filename = filename.replace(char, replacement)

    filename = re.sub(invalid_chars_pattern, '', filename)
    filename = re.sub(r'\s+', ' ', filename)
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

def should_skip_processing(filename: str) -> bool:
    """
    Determine if a file should be skipped from MediaHub processing.
    Returns True if the file should be skipped (metadata files)
    """
    if not isinstance(filename, str):
        return False

    # Skip only metadata files - allow .srt and .strm to be processed
    return filename.lower().endswith(('.sub', '.idx', '.vtt'))

def _load_keywords():
    """Load keywords from keywords.json file."""
    global _keywords_cache
    if _keywords_cache is not None:
        return _keywords_cache

    try:
        keywords_path = os.path.join(os.path.dirname(__file__), 'keywords.json')
        with open(keywords_path, 'r', encoding='utf-8') as f:
            _keywords_cache = json.load(f)
            return _keywords_cache
    except Exception as e:
        log_message(f"Error loading keywords from keywords.json: {e}", level="ERROR")
        _keywords_cache = {'extras_patterns': []}
        return _keywords_cache

def _is_extras_by_name(filename: str, file_path: str = None) -> bool:
    """
    Check if a file should be considered an extra based on its name patterns.

    Args:
        filename: The filename to check
        file_path: Optional full file path to also check

    Returns:
        bool: True if the file matches extras patterns
    """
    try:
        keywords_data = _load_keywords()
        extras_patterns = keywords_data.get('extras_patterns', [])

        # Check filename
        filename_lower = filename.lower()
        for pattern in extras_patterns:
            if pattern.lower() in filename_lower:
                return True

        if file_path:
            file_path_lower = file_path.lower()
            for pattern in extras_patterns:
                if pattern.lower() in file_path_lower:
                    return True

        return False

    except Exception as e:
        log_message(f"Error checking extras patterns: {e}", level="ERROR")
        return False

def is_extras_file(file: str, file_path: str, is_movie: bool = False) -> bool:
    """
    Determine if the file is an extra based on size limits and name patterns.

    Args:
        file: Filename to check
        file_path: Full path to the file
        is_movie: True if processing movie files, False for show files

    Returns:
        bool: True if file should be skipped based on size limits or name patterns
    """
    if not isinstance(file, str) or not isinstance(file_path, str):
        return False

    if not os.path.exists(file_path):
        return False

    if os.path.islink(file_path):
        return False

    # Use centralized function to check if file should be skipped
    if should_skip_processing(file):
        return False

    # Never consider .srt and .strm files as extras regardless of size
    # These files are legitimately small and should always be processed
    if file.lower().endswith(('.srt', '.strm')):
        return False

    if _is_extras_by_name(file, file_path):
        log_message(f"File identified as extra by name pattern: {file}", level="DEBUG")
        return True

    try:
        from MediaHub.config.config import get_4k_movie_extras_size_limit, get_movie_extras_size_limit, get_4k_show_extras_size_limit, get_show_extras_size_limit
        file_size_mb = os.path.getsize(file_path) / (1024 * 1024)

        is_4k = ('2160' in file or
                 re.search(r'\b4k\b', file, re.IGNORECASE) or
                 'UHD' in file.upper() or
                 'UltraHD' in file)

        if not is_4k:
            try:
                parent_dir = os.path.dirname(file_path)
                folder_name = os.path.basename(parent_dir)

                if (
                    '2160' in folder_name or
                    re.search(r'\b4k\b', folder_name, re.IGNORECASE) or
                    'UHD' in folder_name.upper() or
                    'UltraHD' in folder_name
                ):
                    is_4k = True
                else:
                    folder_resolution = extract_resolution_from_folder(parent_dir)
                    if isinstance(folder_resolution, str):
                        if (
                            '2160' in folder_resolution or
                            re.search(r'\b4k\b', folder_resolution, re.IGNORECASE) or
                            'UHD' in folder_resolution.upper() or
                            'UltraHD' in folder_resolution
                        ):
                            is_4k = True
            except Exception:
                pass

        if is_movie:
            if is_4k:
                size_limit = get_4k_movie_extras_size_limit()
            else:
                size_limit = get_movie_extras_size_limit()
        else:
            if is_4k:
                size_limit = get_4k_show_extras_size_limit()
            else:
                size_limit = get_show_extras_size_limit()

        return file_size_mb <= size_limit

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
