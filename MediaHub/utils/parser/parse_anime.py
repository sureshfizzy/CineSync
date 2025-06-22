import re
from typing import Optional

from MediaHub.utils.parser.patterns import ANIME_PATTERNS, FILE_EXTENSION_PATTERNS
from MediaHub.utils.parser.utils import clean_title_string
from MediaHub.utils.parser.parse_year import is_valid_year


def is_anime_filename(filename: str) -> bool:
    """Determine if filename appears to be anime content."""
    if not filename:
        return False

    filename_lower = filename.lower()

    # Early exclusion: if filename has season ranges, it's likely Western TV
    if re.search(r'\bS\d{1,2}-S\d{1,2}\b', filename, re.IGNORECASE):
        return False

    # Check for anime release groups in brackets at the start
    bracket_match = ANIME_PATTERNS['release_group_bracket'].match(filename)
    if bracket_match:
        group_name = bracket_match.group(1)

        # Check if the group name is NOT a common non-anime pattern
        is_non_anime = False
        for pattern in ANIME_PATTERNS['non_anime_group_patterns']:
            if pattern.match(group_name):
                is_non_anime = True
                break

        if not is_non_anime:
            # Check for anime episode indicators in the remaining filename
            remaining = filename[bracket_match.end():].strip()
            if remaining:
                for indicator_pattern in ANIME_PATTERNS['anime_episode_indicators']:
                    if indicator_pattern.search(remaining):
                        return True

                return True

    # Check for anime release groups in parentheses at the start
    paren_match = ANIME_PATTERNS['release_group_paren'].match(filename)
    if paren_match:
        group_name = paren_match.group(1)

        # Check if the group name is NOT a common non-anime pattern
        is_non_anime = False
        for pattern in ANIME_PATTERNS['non_anime_group_patterns']:
            if pattern.match(group_name):
                is_non_anime = True
                break

        if not is_non_anime:
            # Check for anime episode indicators in the remaining filename
            remaining = filename[paren_match.end():].strip()
            if remaining:
                for indicator_pattern in ANIME_PATTERNS['anime_episode_indicators']:
                    if indicator_pattern.search(remaining):
                        return True

                return True

    # Pattern 1: Only check for specific anime hash patterns
    if re.search(r'\.[A-F0-9]{8}\]\.mkv$', filename, re.IGNORECASE):
        return True

    # Pattern 2: Underscore-separated anime files with hash patterns only
    if re.search(r'_\d{1,4}_.*\[A-F0-9]{8}\]', filename, re.IGNORECASE):
        return True

    # Pattern 3: Files with multiple brackets (common anime pattern)
    if re.search(r'\[.*\].*\[.*\].*\[A-F0-9]{8}\]', filename, re.IGNORECASE):
        return True

    non_anime_patterns = [
        r'\bComplete\s+.*?TV\s+Series\b',
        r'\bComplete\s+Eng\b',
        r'\b(Criterion|Director|Theatrical|Extended|Unrated|IMAX|Remastered)\b',
        r'\b[a-z]+by[a-z]+\b',
        r'\bBurntodisc\b',
        r'\b[A-Z]{4,}\b.*\b[A-Z]{4,}\b',
    ]

    for pattern in non_anime_patterns:
        if re.search(pattern, filename, re.IGNORECASE):
            return False

    western_tv_patterns = [
        r'\bS\d{1,2}E\d{1,2}\b',
        r'\bSeason\s+\d+\b',
        r'\bStagione\s+\d+\b',
        r'\bS\d{2}EP\d+\b',
        r'\(\d{4}-\d{4}\)',
        r'\bE\d{1,3}\b',
        r'\bS\d{1,2}-S\d{1,2}\b',
    ]

    for pattern in western_tv_patterns:
        if re.search(pattern, filename, re.IGNORECASE):
            if re.search(r'\bS\d{1,2}-S\d{1,2}\b', filename, re.IGNORECASE):
                return False

            western_indicator_patterns = [
                r'\b(Complete|Collection)\b',
                r'\bTV\s+Series\b',
                r'\b[a-z]+by[a-z]+\b',
                r'\b[A-Z]{4,}\b',
            ]

            for indicator_pattern in western_indicator_patterns:
                if re.search(indicator_pattern, filename, re.IGNORECASE):
                    return False

    has_episode_number = ANIME_PATTERNS['episode_number'].search(filename)
    has_raw = ANIME_PATTERNS['raw'].search(filename)

    if has_raw:
        return True

    if has_episode_number:
        western_tv_patterns = [
            r'\bComplete\s+TV\s+Series\b',
            r'\bComplete\s+Collection\s+Season\b',
            r'\bS\d{2,3}\b',
            r'\bS\d{1,2}E\d{1,2}\b',
            r'\bS\d{1,2}-S\d{1,2}\b',
            r'\bStagione\s+\d+\b',
        ]

        has_season_word = re.search(r'\bSeason\s+\d+\b', filename, re.IGNORECASE)
        if has_season_word:
            western_context_patterns = [
                r'\b(Complete|Collection)\b',
                r'\bTV\s+Series\b',
                r'\b[a-z]+by[a-z]+\b',
                r'\b[A-Z]{4,}\b',
                r'\b(Burntodisc|SHORTBREHD)\b',
            ]

            for pattern in western_context_patterns:
                if re.search(pattern, filename, re.IGNORECASE):
                    return False

        for pattern in western_tv_patterns:
            if re.search(pattern, filename, re.IGNORECASE):
                return False

        anime_context_indicators = [
            'BDrip', 'vostfr', 'french', 'breton', 'EMBE', 'EMBER',
            'WEBRip AAC x265'
        ]

        for indicator in anime_context_indicators:
            if indicator.lower() in filename_lower:
                return True

    return False


def extract_anime_title(filename: str) -> str:
    """Extract title from anime filename with improved logic for various patterns."""
    if not filename:
        return ""

    # Remove file extension
    filename = FILE_EXTENSION_PATTERNS['video'].sub('', filename)

    # Handle parentheses-based release groups first (less common)
    paren_match = re.match(r'^\(([^)]+)\)\s*(.+)', filename)
    if paren_match:
        return _extract_title_from_content(paren_match.group(2))

    # Handle bracket-based release groups (most common for anime)
    bracket_match = re.match(r'^\[([^\]]+)\]\s*(.+)', filename)
    if bracket_match:
        return _extract_title_from_content(bracket_match.group(2))

    # Handle files with technical info in parentheses but no leading release group
    paren_tech_match = re.match(r'^(.+?)\s*\([^)]*(?:BDRip|BluRay|WEBRip|HEVC|x264|x265|1080p|720p)[^)]*\)', filename)
    if paren_tech_match:
        return _extract_title_from_content(paren_tech_match.group(1))

    # Fallback: try to extract title from the whole filename
    return _extract_title_from_content(filename)


def _extract_title_from_content(content: str) -> str:
    """Extract clean anime title from content after release group removal."""
    if not content:
        return ""

    content = content.strip()

    # Pattern 0: Handle dot-separated anime files first
    if '.' in content and content.count('.') >= 3:
        # Split by dots and find where technical terms start
        parts = content.split('.')
        title_parts = []
        for i, part in enumerate(parts):
            if '_' in part and re.match(r'^([^_]+)_\d+', part):
                underscore_match = re.match(r'^([^_]+)_\d+', part)
                if underscore_match:
                    clean_title_part = underscore_match.group(1)
                    title_parts.append(clean_title_part)
                    break

            if re.match(r'^\d{3,4}p', part, re.IGNORECASE):
                break
            if re.match(r'^(BluRay|BDRip|WEBRip|HDTV|x264|x265|HEVC|AAC|AC3|DTS|FLAC)$', part, re.IGNORECASE):
                break
            if re.match(r'^(Hi10P|10bit|8bit|HDR|SDR)$', part, re.IGNORECASE):
                break
            if re.match(r'^[A-Z0-9-]+$', part) and len(part) > 3:  # Release group like SOLA
                break
            title_parts.append(part)

        if title_parts:
            title = ' '.join(title_parts)
            return clean_title_string(title)

    underscore_episode_match = re.match(r'^([^_]+)_(\d+)[_.].*', content)
    if underscore_episode_match:
        title = underscore_episode_match.group(1)
        episode = underscore_episode_match.group(2)
        title = re.sub(r'_', ' ', title)
        return clean_title_string(title)

    # Pattern 1b: Handle underscore-separated without dot separator: "Title_Episode_Quality"
    underscore_compact_match = re.match(r'^([^_]+(?:_[^_]+)*)_\d+_\d+', content)
    if underscore_compact_match:
        title = underscore_compact_match.group(1)
        title = re.sub(r'_', ' ', title)
        return clean_title_string(title)

    # Pattern 2: Handle season patterns FIRST (before dash and space patterns)
    season_match = re.match(r'^(.+?)(?:\s*\(\d{4}\))?\s+(?:S\d+(?:E\d+)?(?:-S\d+)?(?:\s+S\d+)*|Season\s+\d+)(?:\s|$|\[)', content, re.IGNORECASE)
    if season_match:
        title = season_match.group(1).strip()
        return clean_title_string(title)

    # Pattern 3: Handle standard anime naming with dash: "Title - Episode/Season [Quality]"
    # Example: "Black Clover - S01E157 [1080p]"
    # Also handle: "Attack on Titan - The Final Season - 87"
    season_dash_match = re.match(r'^(.+?)\s+-\s+(?:The\s+)?(?:Final\s+)?Season(?:\s+\d+)?\s+-\s+(?:\d+|EP?\d+)(?:\s|$|\[)', content, re.IGNORECASE)
    if season_dash_match:
        title = season_dash_match.group(1).strip()
        return clean_title_string(title)

    # Pattern for anime extras: "Title - NCED 01v2" or "Title - NCOP 01" etc.
    # Common anime extra types: NCED, NCOP, PV, CM, SP, OVA, OAD
    anime_extra_match = re.match(r'^(.+?)\s+-\s+(?:NCED|NCOP|NCBD|PV|CM|SP|OVA|OAD|SPECIAL|EXTRA)\s+\d+', content, re.IGNORECASE)
    if anime_extra_match:
        title = anime_extra_match.group(1).strip()
        return clean_title_string(title)

    dot_season_match = re.match(r'^(.+?)\.S\d+(?:\.|$)', content, re.IGNORECASE)
    if dot_season_match:
        title = dot_season_match.group(1).replace('.', ' ')
        return clean_title_string(title)

    # Then try standard episode/season patterns
    dash_match = re.match(r'^(.+?)\s+-\s+(?:S\d+E\d+|S\d+|\d+|EP?\d+)(?:\s|$|\[)', content, re.IGNORECASE)
    if dash_match:
        title = dash_match.group(1).strip()
        return clean_title_string(title)

    # Pattern 4: Handle space-separated episode numbers: "Title Episode [Quality]"
    # Example: "Attack on Titan 25 [1080p]"
    space_episode_match = re.match(r'^(.+?)\s+(?:EP?\s*)?(\d{1,4})(?:\s|$|\[)', content, re.IGNORECASE)
    if space_episode_match:
        title = space_episode_match.group(1).strip()
        episode_num = space_episode_match.group(2)
        if not is_valid_year(int(episode_num)):
            return clean_title_string(title)

    # Pattern 5: Handle titles with quality indicators
    # Remove common quality/technical terms from the end
    quality_patterns = [
        r'\s*\[.*?\].*$',  # Remove anything in brackets at the end
        r'\s*\([^)]*(?:BDRip|BluRay|WEBRip|HEVC|x264|x265|1080p|720p|480p)[^)]*\).*$',  # Remove technical parentheses
        r'\s*\(.*?\).*$',  # Remove any remaining parentheses at the end
        r'\s*(?:1080p|720p|480p|2160p|4K|UHD).*$',  # Remove resolution and everything after
        r'\s*(?:BluRay|BDRip|WEBRip|WEB-DL|HDTV|DVDRip|REMUX).*$',  # Remove source and everything after
        r'\s*(?:x264|x265|H\.?264|H\.?265|HEVC|AVC).*$',  # Remove codec and everything after
        r'\s*(?:AAC|AC3|DTS|FLAC|MP3|Atmos).*$',  # Remove audio codec and everything after
        r'\s*(?:10bit|8bit|Hi10P|HDR|SDR).*$',  # Remove bit depth and everything after
    ]

    title = content
    for pattern in quality_patterns:
        title = re.sub(pattern, '', title, flags=re.IGNORECASE).strip()
        if not title:  # If we removed everything, use the previous version
            title = content
            break

    # Pattern 6: Handle underscore-separated titles (convert to spaces)
    if '_' in title and not re.search(r'\s', title):
        # If title has underscores but no spaces, convert underscores to spaces
        title = re.sub(r'_', ' ', title)

    # Final cleanup: remove any remaining technical terms
    title = re.sub(r'\s*(?:RAW|PROPER|REPACK|REAL|FIX)\s*', ' ', title, flags=re.IGNORECASE)

    # Remove "Season" from anime titles (user preference)
    title = re.sub(r'\s+(?:The\s+)?Final\s+Season\b', ' Final', title, flags=re.IGNORECASE)
    title = re.sub(r'\s+Season\b', '', title, flags=re.IGNORECASE)

    title = re.sub(r'\s+', ' ', title).strip()  # Normalize whitespace

    if title:
        return clean_title_string(title)

    # Last resort: return the original content cleaned
    return clean_title_string(content)
