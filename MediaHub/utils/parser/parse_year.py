import re
import datetime
from typing import Optional, List, Dict, Any

from MediaHub.utils.parser.patterns import YEAR_PATTERNS, FILE_EXTENSION_PATTERNS


def is_valid_year(year: int) -> bool:
    if not isinstance(year, int):
        return False

    if year < 1000 or year > 9999:
        return False

    current_year = datetime.datetime.now().year

    if year < 1800:
        return False

    if year > current_year + 100:
        return False

    return True


def extract_year(filename: str) -> Optional[int]:
    """
    Extract the most likely release year from a filename.
    Uses context-based logic rather than position-based logic.
    Special handling for TV shows that start with years.
    """
    if not filename:
        return None

    # Check if this is a TV show that starts with a year
    from MediaHub.utils.parser.extractor import _parse_filename_structure, _is_tv_show
    parsed = _parse_filename_structure(filename)
    is_tv = _is_tv_show(parsed)

    # Use centralized year finding
    all_years = find_all_years_in_filename(filename)

    if not all_years:
        return None

    # Special handling for TV shows that start with years (like "1883.S01E01.1883.1080p")
    if is_tv and all_years and all_years[0]['position'] == 0:
        title_year = all_years[0]['value']

        # Filter out all instances of the title year
        non_title_years = [y for y in all_years if y['value'] != title_year]

        # If we have other years after filtering, use those
        if non_title_years:
            all_years = non_title_years
        else:
            # Only the title year exists, don't extract it
            return None

    # Strategy: Prioritize years based on context, not position

    # 1. First priority: Years in parentheses - these are usually release years
    parentheses_years = [y for y in all_years if y['part'].startswith('(') and y['part'].endswith(')')]
    if parentheses_years:
        return parentheses_years[-1]['value']  # Return the last one if multiple

    # 2. Second priority: Years with 'technical' context - these follow technical terms
    technical_years = [y for y in all_years if y['context'] == 'technical']
    if technical_years:
        return technical_years[-1]['value']  # Return the last technical year

    # 3. Third priority: For multiple years, avoid the first one if it's likely a title year
    if len(all_years) > 1:
        # If we have multiple years and the first one is early in the filename,
        # it's likely part of the title (like "Blade Runner 2049")
        # Return the last year instead
        return all_years[-1]['value']

    # 4. Last resort: Single year - check if it's a title year
    single_year = all_years[0]

    # If the year has 'title' context, only skip it for certain cases
    if single_year['context'] == 'title':
        # Skip years at position 0 for TV shows (like "1899.S01E01")
        if single_year['position'] == 0 and is_tv:
            return None

    return single_year['value']


def _is_likely_title_year(year: int, context: str, parts: list) -> bool:
    """
    Determine if a single year is likely part of the title rather than a release year.

    Args:
        year: The year value
        context: The context ("title" or "technical")
        parts: All filename parts

    Returns:
        True if year is likely part of title, False if likely a release year
    """
    # Find the year position in parts
    year_position = -1
    for i, part in enumerate(parts):
        clean_part = part.strip().rstrip('.')
        if clean_part == str(year):
            year_position = i
            break

    if year_position == -1:
        return False

    if year_position == 0:
        return True

    if year_position <= 3:
        if year >= 2030 or year <= 10:
            return True

    if context == "technical":
        return False

    return False


def find_all_years_in_filename(filename: str) -> List[Dict[str, Any]]:
    """
    Find all years in a filename with their positions and contexts.
    This is the centralized function that should be used by extractors.

    Returns:
        List of dictionaries with 'value', 'position', 'context', 'part' keys
    """
    if not filename:
        return []

    filename_no_ext = FILE_EXTENSION_PATTERNS['video'].sub('', filename)

    # Determine separator type and split accordingly
    is_dot_separated = '.' in filename_no_ext and filename_no_ext.count('.') > filename_no_ext.count(' ')
    is_underscore_separated = '_' in filename_no_ext and filename_no_ext.count('_') > 2

    if is_dot_separated:
        parts = filename_no_ext.split('.')
        # Special handling for mixed separators (like "Title with spaces.technical.terms")
        if len(parts) > 0 and ' ' in parts[0] and len(parts[0]) > 20:
            first_part_words = parts[0].split()
            parts = first_part_words + parts[1:]
    elif is_underscore_separated:
        parts = filename_no_ext.split('_')
        new_parts = []
        for part in parts:
            if '.' in part and (any(term in part.lower() for term in ['x264', 'x265', 'bluray', 'webrip', 'hdtv', 'ac3', 'dts', 'bd']) or
                                re.search(r'\b(19|20)\d{2}\b', part)):
                dot_parts = part.split('.')
                new_parts.extend(dot_parts)
            else:
                new_parts.append(part)
        parts = new_parts
    else:
        parts = filename_no_ext.split()
        new_parts = []
        for part in parts:
            if '.' in part and (any(term in part.lower() for term in ['x264', 'x265', 'bluray', 'webrip', 'hdtv', 'ac3', 'dts', 'bd']) or
                                re.search(r'\b(19|20)\d{2}\b', part)):
                dot_parts = part.split('.')
                new_parts.extend(dot_parts)
            else:
                new_parts.append(part)
        parts = new_parts

    years_found = []
    for i, part in enumerate(parts):
        clean_part = part.strip().rstrip('.')

        # Regular year
        if re.match(r'^\d{4}$', clean_part):
            year = int(clean_part)
            if is_valid_year(year):
                context = _determine_year_context(i, parts)
                years_found.append({
                    'value': year,
                    'position': i,
                    'context': context,
                    'part': clean_part
                })

        # Bracketed year (parentheses or square brackets)
        elif re.match(r'^[\[\(](\d{4})(?:-\d{4})?[\]\)]', clean_part):
            year_match = re.search(r'(\d{4})', clean_part)
            if year_match:
                year = int(year_match.group(1))
                if is_valid_year(year):
                    remaining_parts = parts[i+1:i+4] if i+1 < len(parts) else []
                    has_tech_after = any(
                        re.match(r'^\d{3,4}p$', p.strip().rstrip('.'), re.IGNORECASE) or
                        p.strip().rstrip('.').lower() in ['multi', 'vostfr', 'bluray', 'webrip', 'hdtv', 'web-dl', 'lmhd']
                        for p in remaining_parts
                    )

                    # Parentheses years followed by technical terms are usually release years
                    context = 'technical' if has_tech_after else 'title'
                    years_found.append({
                        'value': year,
                        'position': i,
                        'context': context,
                        'part': clean_part
                    })

    return years_found


def should_include_year_in_title(year: int, position: int, parts: List[str], has_tech_after: bool = False) -> bool:
    """
    Determine if a year should be included in the title or treated as release year.

    Args:
        year: The year value
        position: Position of year in filename parts
        parts: All filename parts
        has_tech_after: Whether technical terms follow this year

    Returns:
        True if year should be included in title, False if it's a release year
    """
    if position + 1 < len(parts):
        next_part = parts[position + 1].strip().rstrip('.')
        is_followed_by_year = re.match(r'^\d{4}$', next_part) or re.match(r'^\d{4}$', next_part.split('.')[0])

        if is_followed_by_year and position <= 3:
            return True

    return False


def _determine_year_context(year_position: int, parts: List[str]) -> str:
    """Determine if year is in title or technical context."""
    remaining_parts = parts[year_position + 1:year_position + 6]

    tv_patterns = [r'^S\d{1,2}E\d{1,2}$', r'^Season\s+\d+$']
    has_tv_after = any(
        any(re.match(pattern, part.strip().rstrip('.'), re.IGNORECASE) for pattern in tv_patterns)
        for part in remaining_parts
    )

    if has_tv_after:
        return "title"

    technical_patterns = [
        r'^\d{3,4}p$', r'^(BluRay|WEB-DL|WEBRip|HDTV|DVD|BD)$',
        r'^(x264|x265|H264|H265|HEVC)$', r'^(AAC|AC3|DTS|FLAC)$',
        r'^(MULTI|ITA|ENG|FRENCH)$', r'^(REPACK|PROPER)$',
        r'^(HDR|HDR10|DOLBY|VISION)$',
        r'^[A-Z]+\d+[A-Z]*$',
        r'^\[.*\]$',
        r'^\(.*\)$',
        r'^(rus|jpn|eng)$'
    ]

    has_technical_after = any(
        any(re.match(pattern, part.strip().rstrip('.'), re.IGNORECASE) for pattern in technical_patterns)
        for part in remaining_parts
    )

    is_early_in_filename = year_position <= 2

    next_part_is_year = False
    if year_position + 1 < len(parts):
        next_part = parts[year_position + 1].strip().rstrip('.')
        if re.match(r'^\d{4}$', next_part):
            next_part_is_year = True

    if is_early_in_filename and next_part_is_year:
        return "title"

    if has_technical_after and not has_tv_after and not next_part_is_year:
        return "technical"
    elif is_early_in_filename:
        return "title"
    else:
        return "title"