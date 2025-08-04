import re
import os
import json
from typing import Dict, Any, List, Optional, Tuple
from dataclasses import dataclass

from MediaHub.utils.parser.patterns import FILE_EXTENSION_PATTERNS, SPORTS_PATTERNS, SPORTS_SESSION_PATTERNS
from MediaHub.utils.parser.parse_year import is_valid_year, extract_year, find_all_years_in_filename, should_include_year_in_title, _determine_year_context
from MediaHub.utils.parser.utils import clean_title_string
from MediaHub.utils.parser.parse_anime import is_anime_filename, extract_anime_title

# Cache for parsed filename structures to avoid redundant parsing
_filename_cache = {}

# Cache for keywords data
_keywords_cache = None

def _load_keywords():
    """Load keywords from keywords.json file."""
    global _keywords_cache
    if _keywords_cache is not None:
        return _keywords_cache

    try:
        keywords_path = os.path.join(os.path.dirname(__file__), '..', 'keywords.json')
        with open(keywords_path, 'r', encoding='utf-8') as f:
            _keywords_cache = json.load(f)
            return _keywords_cache
    except Exception:
        # Fallback to empty dict if file not found
        _keywords_cache = {'keywords': [], 'release_groups': []}
        return _keywords_cache

def _get_technical_keywords():
    """Get technical keywords that should stop title extraction."""
    keywords_data = _load_keywords()
    keywords = keywords_data.get('keywords', [])
    editions = keywords_data.get('editions', [])

    technical_keywords = [kw.lower() for kw in keywords if isinstance(kw, str)]
    edition_keywords = [ed.lower() for ed in editions if isinstance(ed, str)]

    all_keywords = set(technical_keywords)
    all_keywords.update(edition_keywords)

    return all_keywords

def _get_edition_keywords():
    """Get edition keywords from keywords.json editions section."""
    keywords_data = _load_keywords()
    editions = keywords_data.get('editions', [])
    edition_keywords = [edition.upper() for edition in editions if isinstance(edition, str)]

    return set(edition_keywords)

@dataclass
class ParsedFilename:
    """Structure to hold parsed filename data."""
    original: str
    filename_no_ext: str
    parts: List[str]
    years_found: List[Dict[str, Any]]
    technical_terms: List[Dict[str, Any]]
    brackets: List[Dict[str, Any]]
    is_dot_separated: bool
    is_underscore_separated: bool = False


@dataclass
class MediaMetadata:
    """Complete media metadata structure optimized for Plex."""
    # Core metadata
    title: str
    alternative_title: Optional[str] = None
    year: Optional[int] = None

    # Video specs
    resolution: Optional[str] = None
    video_codec: Optional[str] = None
    video_profile: Optional[str] = None

    # Audio specs
    audio_codecs: List[str] = None
    audio_channels: List[str] = None

    # Quality/Source
    quality_source: Optional[str] = None

    # Languages
    languages: List[str] = None
    is_dubbed: bool = False
    is_subbed: bool = False

    # Release info
    release_group: Optional[str] = None
    edition: Optional[str] = None

    # TV-specific
    season: Optional[int] = None
    episode: Optional[int] = None

    # Sports-specific
    is_sports: bool = False
    sport_name: Optional[str] = None
    sport_year: Optional[int] = None
    sport_round: Optional[int] = None
    sport_location: Optional[str] = None
    sport_session: Optional[str] = None
    # Detailed F1 information
    sport_country: Optional[str] = None
    sport_grand_prix_name: Optional[str] = None
    sport_venue: Optional[str] = None
    sport_city: Optional[str] = None
    episode_title: Optional[str] = None

    # Content type flags
    is_tv_show: bool = False
    is_movie: bool = False

    # Technical flags
    hdr: Optional[str] = None
    is_repack: bool = False
    is_proper: bool = False

    # File info
    container: Optional[str] = None
    is_anime: bool = False

    def __post_init__(self):
        """Initialize list fields if None."""
        if self.audio_codecs is None:
            self.audio_codecs = []
        if self.audio_channels is None:
            self.audio_channels = []
        if self.languages is None:
            self.languages = []

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON serialization."""
        return {k: v for k, v in self.__dict__.items() if v is not None and v != [] and v != False}


def extract_all_metadata(filename: str) -> MediaMetadata:
    """
    Parse filename once and extract all metadata efficiently.

    Args:
        filename: Media filename to parse

    Returns:
        MediaMetadata object with all extracted information
    """
    if not filename:
        return MediaMetadata(title="")

    # Check cache first to avoid redundant parsing
    if filename in _filename_cache:
        return _filename_cache[filename]

    parsed = _parse_filename_structure(filename)

    # Extract alternative title from original filename before any cleaning
    from MediaHub.utils.parser.utils import extract_alternative_title
    alternative_title = extract_alternative_title(filename)

    # Extract title and year separately
    title = _extract_title_from_parsed(parsed)
    year = _extract_year_from_parsed(parsed)

    # Remove year from title if it's the same as the extracted year
    if title and year:
        # Remove year from end of title if it matches
        year_pattern = rf'\s+{year}$'
        if re.search(year_pattern, title):
            title = re.sub(year_pattern, '', title).strip()

    # Check for sports content first
    is_sports, sport_name, sport_year, sport_round, sport_location, sport_session, sport_details = _extract_sports_info_from_parsed(parsed)

    # Determine content type
    if is_sports:
        is_tv = False
        is_movie = False
        episode = None
        # Override title with sports-specific title if detected
        if sport_name:
            title = sport_name
        if sport_year and not year:
            year = sport_year
    else:
        is_tv = _is_tv_show(parsed)
        episode = _extract_episode_from_parsed(parsed)

        # If we found an episode number
        if episode is not None:
            is_tv = True

        is_movie = not is_tv and bool(title)

    metadata = MediaMetadata(
        title=title,
        alternative_title=alternative_title,
        year=year,
        resolution=_extract_resolution_from_parsed(parsed),
        video_codec=_extract_video_codec_from_parsed(parsed),
        video_profile=_extract_video_profile_from_parsed(parsed),
        audio_codecs=_extract_audio_codecs_from_parsed(parsed),
        audio_channels=_extract_audio_channels_from_parsed(parsed),
        quality_source=_extract_quality_source_from_parsed(parsed),
        languages=_extract_languages_from_parsed(parsed),
        is_dubbed=_extract_dubbed_flag_from_parsed(parsed),
        is_subbed=_extract_subbed_flag_from_parsed(parsed),
        release_group=_extract_release_group_from_parsed(parsed),
        edition=_extract_edition_from_parsed(parsed),
        season=_extract_season_from_parsed(parsed),
        episode=episode,
        is_tv_show=is_tv,
        is_movie=is_movie,
        episode_title=_extract_episode_title_from_parsed(parsed),
        hdr=_extract_hdr_from_parsed(parsed),
        is_repack=_extract_repack_flag_from_parsed(parsed),
        is_proper=_extract_proper_flag_from_parsed(parsed),
        container=_extract_container_from_parsed(parsed),
        is_anime=_extract_anime_flag_from_parsed(parsed),
        is_sports=is_sports,
        sport_name=sport_name,
        sport_year=sport_year,
        sport_round=sport_round,
        sport_location=sport_location,
        sport_session=sport_session,
        # Add detailed F1 information
        sport_country=sport_details.get('country') if sport_details else None,
        sport_grand_prix_name=sport_details.get('grand_prix_name') if sport_details else None,
        sport_venue=sport_details.get('venue') if sport_details else None,
        sport_city=sport_details.get('city') if sport_details else None,
    )

    # Cache the result to avoid redundant parsing
    _filename_cache[filename] = metadata

    # Limit cache size to prevent memory issues
    if len(_filename_cache) > 500:
        # Remove oldest entries (simple FIFO approach)
        oldest_keys = list(_filename_cache.keys())[:50]
        for key in oldest_keys:
            del _filename_cache[key]

    return metadata


def _remove_website_patterns(filename: str) -> str:
    if not filename:
        return filename

    # Pattern to match website prefixes
    website_pattern = r'^www\.[a-zA-Z0-9-]+\.[a-zA-Z]{2,6}(?:\s*[-–—|:.\s]+|(?=\s))'

    match = re.match(website_pattern, filename, re.IGNORECASE)
    if match:
        cleaned_filename = filename[match.end():].strip()
        cleaned_filename = re.sub(r'^[-–—|:\s.]+', '', cleaned_filename)
        return cleaned_filename

    return filename

def _normalize_f1_session(session_text):
    """Normalize F1 session names to standard format"""
    if not session_text:
        return None

    session_lower = session_text.lower().replace('.', ' ').replace('_', ' ')

    # Practice sessions
    if 'practice' in session_lower:
        if 'one' in session_lower or '1' in session_lower:
            return 'FP1'
        elif 'two' in session_lower or '2' in session_lower:
            return 'FP2'
        elif 'three' in session_lower or '3' in session_lower:
            return 'FP3'
        else:
            return 'Practice'

    # Qualifying
    if 'qualifying' in session_lower or 'quali' in session_lower:
        return 'Qualifying'

    # Sprint sessions
    if 'sprint' in session_lower:
        if 'qualifying' in session_lower or 'quali' in session_lower:
            return 'Sprint Qualifying'
        else:
            return 'Sprint'

    # Race
    if 'race' in session_lower:
        return 'Race'

    # Warm Up sessions
    if 'warm' in session_lower and 'up' in session_lower:
        return 'Warm Up'

    # Return original if no match
    return session_text

def _extract_sports_info_from_parsed(parsed: ParsedFilename) -> Tuple[bool, Optional[str], Optional[int], Optional[int], Optional[str], Optional[str], Optional[dict]]:
    """
    Extract sports information from parsed filename.

    Returns:
        Tuple of (is_sports, sport_name, year, round_number, location, session_type, detailed_info)
        detailed_info: For F1, contains country, grand_prix_name, venue, city
    """
    filename = parsed.original

    # Check each sports pattern
    for pattern_name, pattern in SPORTS_PATTERNS.items():
        match = pattern.search(filename)
        if match:
            groups = match.groups()

            if pattern_name == 'formula1':
                sport_name = 'Formula 1'
                year = int(groups[1]) if groups[1] else None
                # Handle both round-based and race name formats
                # Pattern: (sport, year, round_number, location, race_name)
                if groups[2]:
                    round_number = int(groups[2])
                    raw_location = groups[3] if len(groups) > 3 and groups[3] else None
                    if raw_location:
                        location = raw_location.replace('.', ' ').replace('_', ' ').title()
                elif len(groups) > 4 and groups[4]:
                    raw_location = groups[4]
                    location = raw_location.replace('.', ' ').replace('_', ' ').title()
                    round_number = None
                else:
                    round_number = None
                    location = None
            elif pattern_name == 'motogp':
                sport_name = 'MotoGP'
                year = int(groups[1]) if groups[1] else None
                round_number = int(groups[2]) if len(groups) > 2 and groups[2] else None
                location = groups[3] if len(groups) > 3 and groups[3] else None
            elif pattern_name == 'ufc':
                sport_name = 'UFC'
                year = None
                round_number = int(groups[1]) if groups[1] else None
                location = groups[2] if len(groups) > 2 and groups[2] else None
            else:
                sport_name = groups[0] if groups[0] else 'Unknown Sport'
                year = int(groups[1]) if len(groups) > 1 and groups[1] and groups[1].isdigit() else None
                round_number = int(groups[2]) if len(groups) > 2 and groups[2] and groups[2].isdigit() else None
                location = groups[3] if len(groups) > 3 and groups[3] else None

            # Extract session type
            session_type = None
            for session_pattern_name, session_pattern in SPORTS_SESSION_PATTERNS.items():
                session_match = session_pattern.search(filename)
                if session_match:
                    session_type = session_match.group(1)
                    break

            # Normalize F1 session types
            if pattern_name == 'formula1' and session_type:
                session_type = _normalize_f1_session(session_type)

            # Clean up location name
            if location:
                location = location.replace('_', ' ').replace('.', ' ').strip()
                # Remove common technical terms from location
                location = re.sub(r'\b(FP[1-3]|Qualifying|Race|Sprint|1080p|720p|WEB-DL|x264|x265)\b', '', location, flags=re.IGNORECASE).strip()
                location = re.sub(r'\s+', ' ', location).strip()

            # For Formula 1, include detailed location information
            f1_details = None
            if pattern_name == 'formula1':
                # Check if we have location info (either from round-based or race name format)
                if (len(groups) > 4 and groups[4]) or (groups[2] and len(groups) > 3 and groups[3]):
                    # Determine which location to use
                    if len(groups) > 4 and groups[4]:
                        # Race name format: formula1.2025.belgian.grand.prix
                        raw_location = groups[4]
                    elif groups[2] and len(groups) > 3 and groups[3]:
                        # Round-based format: Formula1.2025.Round13.Belgium
                        raw_location = groups[3]
                    else:
                        raw_location = None

                    if raw_location:
                        location = raw_location.replace('.', ' ').replace('_', ' ').title()
                        # F1 details will be provided by SportsDB API
                        f1_details = None

            return True, sport_name, year, round_number, location, session_type, f1_details

    return False, None, None, None, None, None, None

def _parse_filename_structure(filename: str) -> ParsedFilename:
    """
    Parse filename structure once to extract all components.

    This is the ONLY place where the filename string is analyzed.
    All other extractors work from this parsed structure.
    """
    # Remove website patterns first
    filename_clean = _remove_website_patterns(filename)

    filename_no_ext = FILE_EXTENSION_PATTERNS['video'].sub('', filename_clean)

    # Determine separator type and split accordingly
    is_dot_separated = '.' in filename_no_ext and filename_no_ext.count('.') > filename_no_ext.count(' ')
    is_underscore_separated = '_' in filename_no_ext and filename_no_ext.count('_') > 2

    # Split into parts
    if is_dot_separated:
        parts = filename_no_ext.split('.')
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
        # Handle mixed separators in space-separated files
        # If any part contains dots and technical terms, split it further
        new_parts = []
        for part in parts:
            if '.' in part and (any(term in part.lower() for term in ['x264', 'x265', 'bluray', 'webrip', 'hdtv', 'ac3', 'dts', 'bd']) or
                                re.search(r'\b(19|20)\d{2}\b', part)):
                # Split by dots and add all parts
                dot_parts = part.split('.')
                new_parts.extend(dot_parts)
            else:
                new_parts.append(part)
        parts = new_parts

    # Use centralized year finding from parse_year.py
    years_found = find_all_years_in_filename(filename)

    # Find technical terms
    technical_terms = []
    skip_next = False

    for i, part in enumerate(parts):
        if skip_next:
            skip_next = False
            continue

        clean_part = part.strip().rstrip('.')

        codec, group = _extract_codec_and_group_from_hyphenated(clean_part)
        if codec and group:
            technical_terms.append({
                'term': codec,
                'position': i,
                'type': 'video_codec',
                'original': part
            })
            technical_terms.append({
                'term': group,
                'position': i,
                'type': 'release_group',
                'original': part
            })
        else:
            if i < len(parts) - 1:
                next_part = parts[i + 1].strip().rstrip('.')
                combined = f"{clean_part}.{next_part}"
                if re.match(r'^(DDP|AC3|DTS|ATMOS)\d+\.\d+$', combined, re.IGNORECASE):
                    technical_terms.append({
                        'term': combined.upper(),
                        'position': i,
                        'type': 'audio_codec_with_channels',
                        'original': f"{part}.{parts[i + 1]}"
                    })
                    skip_next = True
                    continue

            # Special handling for resolution-profile combinations like "1080p-Hi10P"
            resolution_profile_match = re.match(r'^(\d{3,4}p)-(Hi10P|10bit|8bit|HDR10?\+?)$', clean_part, re.IGNORECASE)
            if resolution_profile_match:
                resolution = resolution_profile_match.group(1)
                profile = resolution_profile_match.group(2)
                technical_terms.append({
                    'term': resolution,
                    'position': i,
                    'type': 'resolution',
                    'original': part
                })
                technical_terms.append({
                    'term': profile,
                    'position': i,
                    'type': 'video_profile',
                    'original': part
                })
            else:
                if ' ' in clean_part and re.search(r'\b(AAC|AC3|DTS|FLAC)\d+\s+\d+\s+x\d{3}-', clean_part, re.IGNORECASE):
                    audio_match = re.match(r'^(AAC|AC3|DTS|FLAC)(\d+)\s+(\d+)\s+(x\d{3})-(.+)$', clean_part, re.IGNORECASE)
                    if audio_match:
                        codec = audio_match.group(1)
                        channels = f"{audio_match.group(2)}.{audio_match.group(3)}"
                        video_codec = audio_match.group(4)
                        release_group = audio_match.group(5)

                        # Add audio codec
                        technical_terms.append({
                            'term': codec,
                            'position': i,
                            'type': 'audio_codec',
                            'original': part
                        })

                        # Add audio channels
                        technical_terms.append({
                            'term': channels,
                            'position': i,
                            'type': 'audio_channels',
                            'original': part
                        })

                        # Add video codec
                        technical_terms.append({
                            'term': video_codec.upper(),
                            'position': i,
                            'type': 'video_codec',
                            'original': part
                        })

                        # Add release group
                        technical_terms.append({
                            'term': release_group,
                            'position': i,
                            'type': 'release_group',
                            'original': part
                        })
                        continue

                # Regular term classification
                term_type = _classify_technical_term(clean_part)
                if term_type:
                    technical_terms.append({
                        'term': clean_part,
                        'position': i,
                        'type': term_type,
                        'original': part
                    })

    brackets = []
    for i, part in enumerate(parts):
        if re.match(r'^[\[\(].*[\]\)]$', part):
            content = part[1:-1]
            bracket_type = 'parentheses' if part.startswith('(') else 'brackets'
            brackets.append({
                'content': content,
                'position': i,
                'type': bracket_type,
                'original': part
            })

            term_type = _classify_technical_term(content)
            if term_type:
                technical_terms.append({
                    'term': content,
                    'position': i,
                    'type': term_type,
                    'original': part
                })

        # Handle split bracket content
        elif part.startswith('[') and not part.endswith(']'):
            content = part[1:]
            if content:
                term_type = _classify_technical_term(content)
                if term_type:
                    technical_terms.append({
                        'term': content,
                        'position': i,
                        'type': term_type,
                        'original': part
                    })

        elif part.endswith(']') and not part.startswith('['):
            content = part[:-1]
            if content:
                term_type = _classify_technical_term(content)
                if term_type:
                    technical_terms.append({
                        'term': content,
                        'position': i,
                        'type': term_type,
                        'original': part
                    })

    return ParsedFilename(
        original=filename,
        filename_no_ext=filename_no_ext,
        parts=parts,
        years_found=years_found,
        technical_terms=technical_terms,
        brackets=brackets,
        is_dot_separated=is_dot_separated,
        is_underscore_separated=is_underscore_separated
    )


def _is_tv_show(parsed: ParsedFilename) -> bool:
    """Detect if this appears to be a TV show."""
    episode_patterns = [
        r'^S\d{1,2}\.E\d{1,4}$',  # Dot-separated season/episode format like S01.E01, S01.E1024
        r'^S\d{1,2}E\d{1,4}$',
        r'^S(\d{1,2})(?!E)$',  # Standalone season patterns S01-S99, must be the entire part
        r'^S\d{1,2}-S\d{1,2}$',
        r'Season\s+\d+',
        r'\bEpisode\s+\d+',
        r'\bepisode\.\d+',  # episode.1, episode.2, etc.
        r'\bEP\d+',
        r'S\d{1,2}\s*-\s*E\d{1,4}',
        r'\bE\d{1,4}\b(?![A-Z])',  # Standalone episode patterns like E01, E02, E1024, but not followed by letters (avoid FS100, etc.)
        r'\d{1,2}x\d{1,4}',  # Season x Episode format like 1x18, 1x1024
        r'\d{1,2}x\d{1,4}-\d{1,4}',  # Season x Episode range format like 1x18-20, 1x1024-1026
        r'S\d{1,2}\.E\d{1,4}',  # Embedded dot-separated season/episode format
        r'S\d{1,2}E\d{1,4}',    # Embedded standard season/episode format
    ]

    for part in parsed.parts:
        clean_part = part.strip()
        for pattern in episode_patterns:
            # For patterns that start with ^ and end with $, only use re.match (full string match)
            if pattern.startswith('^') and pattern.endswith('$'):
                if re.match(pattern, clean_part, re.IGNORECASE):
                    return True
            else:
                if re.match(pattern, clean_part, re.IGNORECASE):
                    return True
                if re.search(pattern, clean_part, re.IGNORECASE):
                    return True

    for i, part in enumerate(parsed.parts):
        if part.lower() == 'season' and i + 1 < len(parsed.parts):
            next_part = parsed.parts[i + 1].strip().rstrip('.')
            if re.match(r'^\d{1,2}$', next_part):
                return True

        # Check for "Episode NNNN" pattern across parts
        if part.lower() == 'episode' and i + 1 < len(parsed.parts):
            next_part = parsed.parts[i + 1].strip().rstrip('.')
            if re.match(r'^\d{1,4}$', next_part):
                return True

    # Check for anime episode patterns
    if _extract_anime_flag_from_parsed(parsed):
        filename = parsed.original
        if re.search(r'\s-\s+\d{1,4}(?:\s|$|\[)', filename):
            return True
        if re.search(r'\s+\d{1,4}\s+\[', filename):
            return True

    # Check for general "Title - Episode" patterns
    filename = parsed.original
    dash_episode_patterns = [
        r'\s-\s(?:[1-9]\d{0,2}|1[0-4]\d{2})(?:\.mkv|\.mp4|\.avi|$)',
        r'\s-(?:[1-9]\d{0,2}|1[0-4]\d{2})(?:\.mkv|\.mp4|\.avi|$)',
    ]

    for pattern in dash_episode_patterns:
        if re.search(pattern, filename, re.IGNORECASE):
            return True

    return False


# Year context determination is now handled in parse_year.py


def _classify_technical_term(term: str) -> Optional[str]:
    """Classify a term as a specific type of technical information."""
    term_upper = term.upper()

    # Resolution - standard patterns
    if re.match(r'^\d{3,4}p$', term, re.IGNORECASE):
        return 'resolution'

    # Resolution - custom dimensions like 3840x2160
    if re.match(r'^\d{3,4}x\d{3,4}$', term, re.IGNORECASE):
        return 'resolution'

    # Quality source
    keywords_data = _load_keywords()
    quality_sources = [qs.lower() for qs in keywords_data.get('quality_sources', [])]
    if term_upper.lower() in quality_sources:
        return 'quality'

    # Video codec - check for codec in hyphenated terms first
    if re.match(r'^(X264|X265|H264|H265|HEVC|AVC)', term_upper):
        return 'video_codec'

    # Video profile/encoding (Hi10P, 10bit, etc.)
    if re.match(r'^(HI10P|10BIT|8BIT|HDR10?\+?)', term_upper):
        return 'video_profile'

    # Audio codec with channels - improved pattern for FLAC5.1
    if re.match(r'^(FLAC|DDP|AC3|DTS|ATMOS)[\d\.]+$', term_upper):
        return 'audio_codec_with_channels'

    # Audio codec
    if re.match(r'^(AAC|AC3|DTS|FLAC|MP3|PCM|ATMOS|DDP|OPUS)', term_upper):
        return 'audio_codec'

    # Audio channels
    if re.match(r'^\d\.\d$', term) or term_upper in ['MONO', 'STEREO']:
        return 'audio_channels'

    # Languages and audio information using mediainfo.json
    current_dir = os.path.dirname(__file__)
    mediainfo_path = os.path.join(current_dir, '..', 'mediainfo.json')
    with open(mediainfo_path, 'r', encoding='utf-8') as f:
        mediainfo_data = json.load(f)
        valid_languages = mediainfo_data.get('ValidLanguages', [])

        # Check single language terms
        if term_upper in valid_languages or term_upper in ['MULTI', 'DUAL-AUDIO', 'MULTI-AUDIO', 'DUAL']:
            return 'language'

        # Check language combinations
        if '-' in term and len(term.split('-')) == 2:
            lang_parts = term_upper.split('-')
            if all(lang in valid_languages for lang in lang_parts):
                return 'language'

    # Release flags
    if term_upper in ['REPACK', 'PROPER', 'REAL', 'FIX']:
        return 'release_flag'

    # Edition
    edition_keywords = _get_edition_keywords()
    if term_upper in edition_keywords:
        return 'edition'

    # HDR
    if term_upper in ['HDR', 'HDR10', 'DOLBY', 'VISION']:
        return 'hdr'

    # Technical processing terms (AI upscaling, etc.)
    if re.match(r'^AI[_-]?UPSCALE[_-]?\d*$', term_upper) or term_upper in ['AI_UPSCALE', 'UPSCALE']:
        return 'technical_processing'

    # Technical quality indicators with numbers/dashes (generic pattern for quality codes)
    if re.match(r'^[A-Z]{2,4}[_-]?\d+$', term_upper):  # Generic pattern like "alq-12", "qp-15", etc.
        return 'technical_processing'



    # Hash patterns (like 42A97BA4)
    if re.match(r'^[A-F0-9]{8}$', term_upper):
        return 'hash'

    # Season range patterns (like "1-3", "1-10") - should not be classified as anything
    if re.match(r'^\d{1,2}-\d{1,2}$', term):
        return None

    # Season patterns (like "S01", "S02", etc.) - should not be classified as anything
    if re.match(r'^S\d{1,2}$', term, re.IGNORECASE):
        return None

    # Single numbers that could be season numbers (like "3", "10") - should not be classified as anything
    if re.match(r'^\d{1,2}$', term) and int(term) <= 30:
        return None

    # Release group (ends with hyphen + group name) - but not resolution-profile patterns or technical terms
    if re.match(r'^[a-z0-9]+-[A-Z0-9]+$', term, re.IGNORECASE):
        # Skip patterns like "1080p-Hi10P" which are resolution-profile combinations
        if not re.match(r'^\d{3,4}p-', term, re.IGNORECASE):
            # Skip technical quality indicators like "alq-12", "qp-15", etc.
            if not re.match(r'^[A-Z]{2,4}[_-]?\d+$', term, re.IGNORECASE):
                # Skip season ranges like "S01-S02", "S01-S03", etc.
                if not re.match(r'^S\d{1,2}-S\d{1,2}$', term, re.IGNORECASE):
                    return 'release_group'

    return None


def _extract_codec_and_group_from_hyphenated(term: str) -> tuple:
    """Extract codec and release group from hyphenated terms like 'x265-EXTREME'."""
    if '-' not in term:
        return None, None

    parts = term.split('-', 1)
    codec_part = parts[0].upper()
    group_part = parts[1] if len(parts) > 1 else None

    # Check if first part is a codec
    if codec_part in ['X264', 'X265', 'H264', 'H265', 'HEVC', 'AVC']:
        return codec_part, group_part

    return None, None


# ============================================================================
# EXTRACTION FUNCTIONS - Work from parsed data, no filename re-parsing
# ============================================================================


def _extract_title_from_parsed(parsed: ParsedFilename) -> str:
    """Extract title from parsed filename data."""
    if _extract_anime_flag_from_parsed(parsed):
        from MediaHub.utils.parser.parse_anime import extract_anime_title
        # Use the cleaned filename (without website patterns) for anime title extraction
        cleaned_filename = _remove_website_patterns(parsed.original)
        anime_title = extract_anime_title(cleaned_filename)
        if anime_title:
            return anime_title

    # For non-anime content, use enhanced title extraction
    return _extract_general_title_from_parsed(parsed)


def _extract_general_title_from_parsed(parsed: ParsedFilename) -> str:
    """Extract title from non-anime content with improved handling."""
    years = parsed.years_found
    technical_terms = parsed.technical_terms
    parts = parsed.parts

    if not parts:
        return ""

    # Check if this is a TV show
    is_tv = _is_tv_show(parsed)

    # If we found an episode number
    episode = _extract_episode_from_parsed(parsed)
    if episode is not None:
        is_tv = True

    # For TV shows, use simple title extraction that stops at season/episode info
    if is_tv:
        title_parts = []
        i = 0
        while i < len(parts):
            clean_part = parts[i].strip().rstrip('.')

            # Stop at parentheses years
            if clean_part.startswith('(') and re.match(r'^\(\d{4}\)$', clean_part):
                break

            # Stop at square brackets (technical info)
            if clean_part.startswith('['):
                break

            # Stop at season/episode patterns including ranges
            if (re.match(r'S\d{1,2}\.E\d{1,4}', clean_part, re.IGNORECASE) or
                re.match(r'S\d{1,2}E\d{1,4}', clean_part, re.IGNORECASE) or
                re.match(r'S\d{1,2}(?!E)', clean_part, re.IGNORECASE) or
                re.match(r'S\d{1,2}-S\d{1,2}', clean_part, re.IGNORECASE) or
                re.match(r'E\d{1,4}', clean_part, re.IGNORECASE) or
                re.match(r'Season\s+\d{1,2}', clean_part, re.IGNORECASE) or
                re.match(r'\d{1,2}x\d{1,4}(?:-\d{1,4})?', clean_part, re.IGNORECASE)):
                break

            # Stop at "Episode" followed by number in next part
            if clean_part.lower() == 'episode' and i + 1 < len(parts):
                next_part = parts[i + 1].strip().rstrip('.')
                if re.match(r'^\d{1,4}$', next_part):
                    break

            should_add_part = True

            # Special handling for dashes: don't add if followed by episode number (anime-style)
            if clean_part == '-' and i + 1 < len(parts):
                next_part = parts[i + 1].strip().rstrip('.')
                if re.match(r'^\d{1,4}$', next_part):
                    should_add_part = False
                    break

            # Add the part to title if appropriate
            if should_add_part:
                title_parts.append(clean_part)

            if (re.search(r'S\d{1,2}E\d{1,4}', clean_part, re.IGNORECASE) or
                re.search(r'S\d{1,2}-S\d{1,2}', clean_part, re.IGNORECASE) or
                re.search(r'S\d{1,2}(?!E)', clean_part, re.IGNORECASE) or
                re.search(r'E\d{1,4}', clean_part, re.IGNORECASE) or
                re.search(r'Season\s+\d{1,2}', clean_part, re.IGNORECASE) or
                re.search(r'\d{1,2}x\d{1,4}(?:-\d{1,4})?', clean_part, re.IGNORECASE)):
                season_episode_match = re.search(r'(S\d{1,2}E\d{1,4}|S\d{1,2}-S\d{1,2}|S\d{1,2}(?!E)|E\d{1,4}|Season\s+\d{1,2}|\d{1,2}x\d{1,4}(?:-\d{1,4})?)', clean_part, re.IGNORECASE)
                if season_episode_match:
                    before_season = clean_part[:season_episode_match.start()].strip()
                    if before_season:
                        title_parts.append(before_season)
                break

            # Stop at "Season" keyword only if it's followed by a number (indicating season info)
            if clean_part.lower() == 'season' and i + 1 < len(parts):
                next_part = parts[i + 1].strip().rstrip('.')
                if re.match(r'^\d{1,2}$', next_part):
                    break

            # If this is a single letter and the next parts are also single letters, combine them
            if (len(clean_part) == 1 and clean_part.isalpha() and
                i + 1 < len(parts) and len(parts[i + 1].strip().rstrip('.')) == 1):
                # Look ahead to collect all single letters
                acronym_parts = [clean_part]
                j = i + 1
                while (j < len(parts) and
                       len(parts[j].strip().rstrip('.')) == 1 and
                       parts[j].strip().rstrip('.').isalpha()):
                    acronym_parts.append(parts[j].strip().rstrip('.'))
                    j += 1

                # If we found multiple single letters, combine them with dots
                if len(acronym_parts) > 1:
                    title_parts.append('.'.join(acronym_parts))
                    i = j
                    continue

            # Part already added above, just increment counter
            i += 1

        if title_parts:
            title = ' '.join(title_parts)
            return clean_title_string(title)

    # Handle special patterns for non-TV content

    # Pattern 1: "Title_(Year)_[technical]_-_Group" (Mai_Mai_Miracle pattern)
    underscore_pattern = re.match(r'^([^_]+)_\((\d{4})\)_\[.*?\]_-_(.+)$', parsed.original)
    if underscore_pattern:
        title = underscore_pattern.group(1).replace('_', ' ')
        return clean_title_string(title)

    # Pattern 1b: "Title_(Year)_[technical]_-_Group" without extension (simplified)
    underscore_pattern2 = re.match(r'^(.+?)_\((\d{4})\)_.*', parsed.filename_no_ext)
    if underscore_pattern2:
        title = underscore_pattern2.group(1).replace('_', ' ')
        return clean_title_string(title)

    # Pattern 1c: "Title (Year) [technical]" for space-separated files
    space_pattern = re.match(r'^(.+?)\s+\((\d{4})\)\s+.*', parsed.filename_no_ext)
    if space_pattern:
        title = space_pattern.group(1)
        return clean_title_string(title)

    # Pattern 2: "prefix-title-suffix" (wmt-fullmetalalchemist pattern)
    if len(parts) == 1 and '-' in parts[0]:
        hyphen_parts = parts[0].split('-')
        if len(hyphen_parts) >= 3:
            # Skip first part if it looks like a prefix (short, lowercase)
            start_idx = 0
            if len(hyphen_parts[0]) <= 4 and hyphen_parts[0].islower():
                start_idx = 1

            # Skip last part if it looks like technical info (numbers, resolution)
            end_idx = len(hyphen_parts)
            if hyphen_parts[-1].isdigit() or re.match(r'^\d+p?$', hyphen_parts[-1]):
                end_idx -= 1

            if start_idx < end_idx:
                title_parts = hyphen_parts[start_idx:end_idx]
                title = ' '.join(title_parts)
                return clean_title_string(title)

    # Pattern 3: "prefix.title.words.year.technical" (dot-separated files)
    if parsed.is_dot_separated and len(parts) > 3:
        if len(years) >= 2:
            second_year_position = years[1]['position']
            title_parts = parts[:second_year_position + 1]
            title = ' '.join(title_parts)
            return clean_title_string(title)

        # For single year or no years, find where technical terms start
        title_end = len(parts)

        for i, part in enumerate(parts):
            clean_part = part.strip().rstrip('.')

            year_at_position = next((y for y in years if y['position'] == i), None)
            if year_at_position and not is_tv:
                title_end = i
                break

            # Stop at square brackets (technical info)
            if clean_part.startswith('['):
                title_end = i
                break

            technical_keywords = _get_technical_keywords()
            max_title_words = 3 if is_tv else 8
            is_likely_title_word = (
                i <= max_title_words and
                not re.match(r'^\d{3,4}p$', clean_part, re.IGNORECASE) and
                not clean_part.lower() in technical_keywords
            )

            # Check for resolution patterns (including resolution-release group combinations)
            if (re.match(r'^\d{3,4}p$', clean_part, re.IGNORECASE) or
                re.match(r'^\d{3,4}p-[A-Za-z0-9]+$', clean_part, re.IGNORECASE)):
                title_end = i
                break

            if not is_likely_title_word and (
                re.match(r'^\d{3,4}x\d{3,4}$', clean_part, re.IGNORECASE) or
                clean_part.lower() in technical_keywords or
                re.match(r'^AI[_-]?UPSCALE', clean_part, re.IGNORECASE) or
                re.match(r'^DTS-HD$', clean_part, re.IGNORECASE) or
                re.match(r'^MA$', clean_part, re.IGNORECASE) or
                re.match(r'^[0-9]+\.[0-9]+$', clean_part) or
                re.match(r'^[A-Z0-9]+[_-][A-Z]+$', clean_part, re.IGNORECASE)):
                title_end = i
                break

        if title_end > 0:
            title_parts = parts[:title_end]
            title = ' '.join(title_parts)
            return clean_title_string(title)

    # Pattern 4: Handle space-separated with technical terms (Saga of Tanya pattern)
    # BUT ONLY for non-TV shows (movies) to avoid breaking TV show title extraction
    if (not parsed.is_dot_separated and not parsed.is_underscore_separated and
        len(parts) > 2 and not is_tv):
        tech_start = len(parts)
        year_position = None

        for i, part in enumerate(parts):
            clean_part = part.strip().rstrip('.')

            # Check for years in parentheses
            if clean_part.startswith('(') and re.match(r'^\(\d{4}\)$', clean_part):
                tech_start = i
                break

            # Check for square brackets
            if clean_part.startswith('['):
                tech_start = i
                break

            # Check for standalone years
            year_at_position = next((y for y in years if y['position'] == i), None)
            if year_at_position and re.match(r'^\d{4}$', clean_part):
                from MediaHub.utils.parser.parse_year import extract_year
                extracted_year = extract_year(parsed.original)
                if extracted_year == year_at_position['value']:
                    tech_start = i
                    break

            # Check for technical terms and release group patterns
            if (re.match(r'^\d{3,4}p$', clean_part, re.IGNORECASE) or  # Resolution
                re.match(r'^\d{3,4}x\d{3,4}$', clean_part, re.IGNORECASE) or  # Custom resolution like 3840x2160
                clean_part.lower() in _get_technical_keywords() or  # Use keywords.json
                re.match(r'^AI[_-]?UPSCALE', clean_part, re.IGNORECASE) or  # AI upscaling terms
                re.match(r'^[A-Z]{2,4}[_-]\d{2,}', clean_part, re.IGNORECASE) or  # Quality indicators like "alq-12"
                re.match(r'^--', clean_part) or  # Double dash patterns
                re.match(r'^-[A-Z]', clean_part)):  # Release group patterns like "-Punisher694"
                tech_start = i
                break

        # Extract title up to the stopping point
        if tech_start < len(parts):
            title_parts = []
            for i in range(tech_start):
                part = parts[i].strip().rstrip('.')

                year_at_position = next((y for y in years if y['position'] == i), None)
                if year_at_position and (part.startswith('(') and part.endswith(')')):
                    continue

                # Handle years embedded in other text
                if year_at_position and year_at_position['context'] == 'title':
                    year_str = str(year_at_position['value'])
                    if year_str in part and part != year_str:
                        part = part.replace(year_str, '').strip()
                        if part and len(part) > 1:
                            title_parts.append(part)
                        continue

                title_parts.append(part)

            title = ' '.join(title_parts)
            return clean_title_string(title)

    # Standard title extraction logic
    title_parts = []

    for i, part in enumerate(parts):
        clean_part = part.strip().rstrip('.')

        # Skip collection/playlist numbers at the beginning
        if i == 0 and re.match(r'^\d{1,2}\.$', part.strip()):
            continue

        # For TV shows, stop at episode patterns, season patterns, or series type indicators
        if is_tv and (re.match(r'S\d{1,2}\.E\d{1,4}', clean_part, re.IGNORECASE) or
                      re.match(r'S\d{1,2}E\d{1,4}', clean_part, re.IGNORECASE) or
                      re.match(r'S\d{1,2}(?!E)', clean_part, re.IGNORECASE) or
                      re.match(r'E\d{1,4}', clean_part, re.IGNORECASE) or
                      re.match(r'episode\.\d+', clean_part, re.IGNORECASE) or
                      re.match(r'Season\s+\d{1,2}', clean_part, re.IGNORECASE) or
                      re.match(r'\d{1,2}x\d{1,4}(?:-\d{1,4})?', clean_part, re.IGNORECASE) or
                      re.match(r'(MINI-?SERIES|LIMITED-?SERIES|TV-?SERIES)', clean_part, re.IGNORECASE)):
            break

        # Check for "Episode" followed by number in next part
        if is_tv and clean_part.lower() == 'episode' and i + 1 < len(parts):
            next_part = parts[i + 1].strip().rstrip('.')
            if re.match(r'^\d{1,4}$', next_part):
                break

        # Check if this part is a year
        year_at_position = next((y for y in years if y['position'] == i), None)

        if year_at_position:
            year_value = year_at_position['value']

            if parts[i].startswith('(') and parts[i].endswith(')'):
                break

            if is_tv:
                if len(years) >= 2:
                    year_positions = [y['position'] for y in years if y['value'] == year_value]
                    if len(year_positions) > 1 and i == year_positions[0]:
                        title_parts.append(str(year_value))
                    elif len(year_positions) > 1 and i != year_positions[0]:
                        continue
                    else:
                        title_parts.append(str(year_value))
                else:
                    if i == 0:
                        title_parts.append(str(year_value))
                    else:
                        break
            else:
                if len(years) >= 2:
                    second_year_position = years[1]['position']
                    if i < second_year_position:
                        title_parts.append(str(year_value))
                    else:
                        break
                else:
                    break
        else:
            if clean_part.startswith('(') or clean_part.startswith('['):
                break

            tech_at_position = next((t for t in technical_terms if t['position'] == i), None)
            if tech_at_position and tech_at_position['type'] in ['resolution', 'quality', 'video_codec', 'video_profile', 'technical_processing', 'release_group', 'hdr']:
                break

            # Skip series type indicators from title
            if re.match(r'(MINI-?SERIES|LIMITED-?SERIES|TV-?SERIES)', clean_part, re.IGNORECASE):
                continue

            # Skip technical terms that shouldn't be in title
            technical_keywords = _get_technical_keywords()
            if (re.match(r'^(Hi10P|10bit|8bit|HDR10?\+?|1080p|720p|480p|\d{3,4}x\d{3,4}|AI[_-]?UPSCALE)$', clean_part, re.IGNORECASE) or
                clean_part.lower() in technical_keywords):
                continue

            # Skip generic quality indicators with numbers
            if re.match(r'^[A-Z]{2,4}[_-]?\d+$', clean_part, re.IGNORECASE):
                continue

            # Special handling for "Title - Season XX" pattern
            if clean_part == '-' and i + 1 < len(parts):
                next_part = parts[i + 1].strip().rstrip('.')
                if re.match(r'Season', next_part, re.IGNORECASE):
                    break

            if re.match(r'Season\s+\d+', clean_part, re.IGNORECASE):
                break

            if clean_part.lower() == 'season' and i + 1 < len(parts):
                next_part = parts[i + 1].strip().rstrip('.')
                if re.match(r'^\d{1,2}$', next_part):
                    break

            # Handle anime-style episode patterns
            if clean_part == '-' and i + 1 < len(parts):
                next_part = parts[i + 1].strip().rstrip('.')
                if re.match(r'^\d{1,4}$', next_part):
                    episode_num = int(next_part)
                    if 1 <= episode_num <= 4999:
                        break

            title_part = clean_part

            year_at_position = next((y for y in years if y['position'] == i and y['part'] == clean_part), None)
            if year_at_position and year_at_position['context'] == 'title':
                year_str = str(year_at_position['value'])
                if year_str in title_part and title_part != year_str:
                    title_part = title_part.replace(year_str, '').strip()
                    if title_part and len(title_part) > 1:
                        title_parts.append(title_part)
                    continue

            title_parts.append(title_part)

    if title_parts:
        title = ' '.join(title_parts)
        return clean_title_string(title)

    return clean_title_string(parsed.filename_no_ext)


def _extract_year_from_parsed(parsed: ParsedFilename) -> Optional[int]:
    """Extract year from parsed filename data using centralized parse_year logic."""
    # Use centralized year extraction from parse_year.py
    return extract_year(parsed.original)


def _extract_resolution_from_parsed(parsed: ParsedFilename) -> Optional[str]:
    """Extract resolution from parsed filename data."""
    for term in parsed.technical_terms:
        if term['type'] == 'resolution':
            return term['term']

    # Additional resolution extraction for complex patterns
    resolution_patterns = [
        r'\b(\d{3,4}p)\b',  # Standard resolution patterns
        r'\b(\d{3,4}p)-',   # Resolution followed by dash (like 1080p-Hi10P)
        r'\b(\d{3,4}x\d{3,4})\b',  # Custom dimensions like 3840x2160
    ]

    for pattern in resolution_patterns:
        match = re.search(pattern, parsed.original, re.IGNORECASE)
        if match:
            resolution = match.group(1)
            # Convert common custom resolutions to standard format
            if resolution == '3840x2160':
                return '4K'
            elif resolution == '1920x1080':
                return '1080p'
            elif resolution == '1280x720':
                return '720p'
            return resolution

    return None


def _extract_video_codec_from_parsed(parsed: ParsedFilename) -> Optional[str]:
    """Extract video codec from parsed filename data."""
    for term in parsed.technical_terms:
        if term['type'] == 'video_codec':
            # Clean up codec term to remove brackets
            codec_match = re.match(r'^(x264|x265|h264|h265|hevc|avc)', term['term'], re.IGNORECASE)
            if codec_match:
                return codec_match.group(1).upper()
            return term['term']

    # Additional codec extraction for patterns like "x264[N1C]"
    codec_patterns = [
        r'\b(x264|x265|h264|h265|hevc|avc)(?=\[|$|\s|\.)',  # codec followed by bracket, end, space, or dot
    ]

    for pattern in codec_patterns:
        match = re.search(pattern, parsed.original, re.IGNORECASE)
        if match:
            return match.group(1).upper()

    return None


def _extract_video_profile_from_parsed(parsed: ParsedFilename) -> Optional[str]:
    """Extract video profile/encoding information from parsed filename data."""
    for term in parsed.technical_terms:
        if term['type'] == 'video_profile':
            return term['term']

    # Additional video profile extraction
    profile_patterns = [
        r'\b(Hi10P|10bit|8bit|HDR10?\+?)\b',
    ]

    for pattern in profile_patterns:
        match = re.search(pattern, parsed.original, re.IGNORECASE)
        if match:
            return match.group(1)

    return None


def _extract_quality_source_from_parsed(parsed: ParsedFilename) -> Optional[str]:
    """Extract quality source from parsed filename data."""
    for term in parsed.technical_terms:
        if term['type'] == 'quality':
            return term['term']
    return None


def _extract_audio_codecs_from_parsed(parsed: ParsedFilename) -> List[str]:
    """Extract audio codecs from parsed filename data."""
    codecs = []
    for term in parsed.technical_terms:
        if term['type'] == 'audio_codec':
            codecs.append(term['term'])
        elif term['type'] == 'audio_codec_with_channels':
            codec_match = re.match(r'^([A-Z]+)', term['term'])
            if codec_match:
                codecs.append(codec_match.group(1))

    # Additional audio codec extraction for complex patterns like FLAC5.1
    if not codecs:
        audio_patterns = [
            r'\b(FLAC)[\d\.]+\b',  # FLAC5.1, FLAC2.0, etc.
            r'\b(DTS|AC3|AAC)[\d\.]*\b',  # Other audio codecs with channels
        ]

        for pattern in audio_patterns:
            match = re.search(pattern, parsed.original, re.IGNORECASE)
            if match:
                codecs.append(match.group(1))
                break

    return codecs


def _extract_audio_channels_from_parsed(parsed: ParsedFilename) -> List[str]:
    """Extract audio channels from parsed filename data."""
    channels = []
    for term in parsed.technical_terms:
        if term['type'] == 'audio_channels':
            channels.append(term['term'])
        elif term['type'] == 'audio_codec_with_channels':
            channel_match = re.search(r'(\d\.\d)$', term['term'])
            if channel_match:
                channels.append(channel_match.group(1))

    # Additional channel extraction for patterns like FLAC5.1
    if not channels:
        channel_patterns = [
            r'\b(?:FLAC|DTS|AC3|AAC)(\d\.\d)\b',  # FLAC5.1, DTS5.1, etc.
            r'\b(\d\.\d)\b',  # Standalone channel patterns
        ]

        for pattern in channel_patterns:
            match = re.search(pattern, parsed.original, re.IGNORECASE)
            if match:
                channels.append(match.group(1))
                break

    return channels


def _extract_languages_from_parsed(parsed: ParsedFilename) -> List[str]:
    """Extract languages from parsed filename data."""
    languages = []
    for term in parsed.technical_terms:
        if term['type'] == 'language':
            lang_map = {
                'ENG': 'English', 'ITA': 'Italian', 'FRENCH': 'French',
                'GERMAN': 'German', 'SPANISH': 'Spanish', 'JAPANESE': 'Japanese'
            }
            lang_name = lang_map.get(term['term'].upper(), term['term'])
            if lang_name not in languages:
                languages.append(lang_name)
    return languages


def _extract_dubbed_flag_from_parsed(parsed: ParsedFilename) -> bool:
    """Check if content is dubbed."""
    return any(term['type'] == 'language' and term['term'].upper() == 'MULTI'
               for term in parsed.technical_terms)


def _extract_subbed_flag_from_parsed(parsed: ParsedFilename) -> bool:
    """Check if content has subtitles."""
    return any('SUB' in term['term'].upper() for term in parsed.technical_terms)


def _extract_release_group_from_parsed(parsed: ParsedFilename) -> Optional[str]:
    """Extract release group from parsed filename data."""

    # Look for specific release group patterns first (more reliable than general technical term detection)

    # Pattern 1: codec-group-hash (e.g., "x264-SOLA.[42A97BA4]")
    codec_group_hash_pattern = re.search(r'(?:x264|x265|h264|h265|hevc)-([A-Z0-9]+)\.\[[A-F0-9]{8}\]', parsed.original, re.IGNORECASE)
    if codec_group_hash_pattern:
        group_name = codec_group_hash_pattern.group(1)
        return group_name

    # Pattern 2: group-hash (e.g., "-GROUPNAME.[HASH]")
    group_hash_pattern = re.search(r'-([A-Z0-9]+)\.\[[A-F0-9]{8}\]', parsed.original, re.IGNORECASE)
    if group_hash_pattern:
        group_name = group_hash_pattern.group(1)
        # Verify it's not a technical term
        if group_name.upper() not in ['X264', 'X265', 'H264', 'H265', 'HEVC', 'AVC']:
            return group_name

    # Pattern 3: codec-group at end (e.g., "x265-Flugel")
    codec_group_pattern = re.search(r'(?:x264|x265|h264|h265|hevc)-([A-Za-z0-9]+)(?:\.[a-z0-9]+)?$', parsed.original, re.IGNORECASE)
    if codec_group_pattern:
        group_name = codec_group_pattern.group(1)
        return group_name

    # Pattern 4: HEVC-GROUP[HASH] (e.g., "HEVC-DDR[EtHD]")
    hevc_group_pattern = re.search(r'HEVC-([A-Z0-9]+)\[([A-Z0-9]+)\]', parsed.original, re.IGNORECASE)
    if hevc_group_pattern:
        group_name = hevc_group_pattern.group(1)
        return group_name

    # Pattern 5: codec[GROUP] (e.g., "x264[N1C]")
    codec_bracket_pattern = re.search(r'(?:x264|x265|h264|h265|hevc)\[([A-Za-z0-9]+)\]', parsed.original, re.IGNORECASE)
    if codec_bracket_pattern:
        group_name = codec_bracket_pattern.group(1)
        return group_name

    # Fallback: Check technical terms, but prefer actual release groups over technical misclassifications
    release_groups = [term for term in parsed.technical_terms if term['type'] == 'release_group']
    if release_groups:
        # If multiple release groups found, prefer the one that's not a technical term
        for group_term in release_groups:
            group_name = group_term['term']
            # Skip obvious technical terms that got misclassified as release groups
            if (not re.match(r'^\d{3,4}p-', group_name, re.IGNORECASE) and
                not re.match(r'^S\d{1,2}$', group_name, re.IGNORECASE) and
                not re.match(r'^\d{1,2}-\d{1,2}$', group_name) and
                not re.match(r'^\d{1,2}$', group_name) and
                len(group_name) > 1):
                return group_name

        return None

    # Standard bracket-based release groups - prioritize actual groups over language info
    potential_groups = []
    for bracket in parsed.brackets:
        content = bracket['content']

        # Skip years
        if re.match(r'^\d{4}$', content):
            continue

        # Skip hash patterns
        if re.match(r'^[A-F0-9]{8}$', content, re.IGNORECASE):
            continue

        # Skip technical info in brackets like "1080p,BluRay,flac,x264"
        if ',' in content:
            continue

        # Skip language/audio information
        if re.match(r'^(Dual-Audio|Multi-Audio|English|Japanese|Dubbed|Subbed)$', content, re.IGNORECASE):
            continue

        # Skip season patterns
        if re.match(r'^S\d{1,2}$', content, re.IGNORECASE):
            continue

        # Skip numeric season ranges
        if re.match(r'^\d{1,2}-\d{1,2}$', content):
            continue

        # Valid release group pattern
        if len(content) <= 20 and re.match(r'^[A-Za-z0-9&.-]+$', content):
            potential_groups.append(content)

    # Return the first valid group (usually at the beginning for anime)
    if potential_groups:
        return potential_groups[0]

    # Check for hyphenated release groups at the end
    for i in range(len(parsed.parts) - 1, -1, -1):
        part = parsed.parts[i].strip().rstrip('.')
        if re.match(r'^[a-z0-9]+-[A-Z0-9]+$', part, re.IGNORECASE):
            if '-' in part:
                group_name = part.split('-')[-1]
                # Skip season patterns that might have been misidentified
                if (not re.match(r'^S\d{1,2}$', group_name, re.IGNORECASE) and
                    not re.match(r'^\d{1,2}$', group_name) and
                    len(group_name) > 1):
                    return group_name

    return None


def _extract_edition_from_parsed(parsed: ParsedFilename) -> Optional[str]:
    """Extract edition information from parsed filename data."""
    for term in parsed.technical_terms:
        if term['type'] == 'edition':
            return term['term']

    # Check for multi-word edition patterns in brackets
    edition_patterns = [
        r'\[([^]]*(?:Extended|Director\'?s|Unrated|Theatrical|IMAX|Remastered|Special|Ultimate|Final|Cut)[^]]*)\]',
        r'\(([^)]*(?:Extended|Director\'?s|Unrated|Theatrical|IMAX|Remastered|Special|Ultimate|Final|Cut)[^)]*)\)'
    ]

    for pattern in edition_patterns:
        match = re.search(pattern, parsed.original, re.IGNORECASE)
        if match:
            edition_text = match.group(1).strip()
            edition_text = re.sub(r'\s+', ' ', edition_text)
            return edition_text

    return None


def _extract_hdr_from_parsed(parsed: ParsedFilename) -> Optional[str]:
    """Extract HDR information from parsed filename data."""
    hdr_terms = []
    for term in parsed.technical_terms:
        if term['type'] == 'hdr':
            hdr_terms.append(term['term'])

    if hdr_terms:
        return ' '.join(hdr_terms)
    return None


def _extract_repack_flag_from_parsed(parsed: ParsedFilename) -> bool:
    """Check if this is a repack."""
    return any(term['type'] == 'release_flag' and term['term'].upper() == 'REPACK'
               for term in parsed.technical_terms)


def _extract_proper_flag_from_parsed(parsed: ParsedFilename) -> bool:
    """Check if this is a proper release."""
    return any(term['type'] == 'release_flag' and term['term'].upper() == 'PROPER'
               for term in parsed.technical_terms)


def _extract_container_from_parsed(parsed: ParsedFilename) -> Optional[str]:
    """Extract container format from original filename."""
    match = re.search(r'\.([a-z0-9]+)$', parsed.original, re.IGNORECASE)
    return match.group(1) if match else None


def _extract_season_from_parsed(parsed: ParsedFilename) -> Optional[int]:
    """Extract season number from parsed filename data."""
    for part in parsed.parts:
        clean_part = part.strip().rstrip('.')

        # Handle season ranges like S01-S02, S01-S03, etc. (return first season)
        match = re.match(r'S(\d{1,2})-S\d{1,2}', clean_part, re.IGNORECASE)
        if match:
            return int(match.group(1))

        # Handle dot-separated season/episode format like S01.E01, S01.E1024
        match = re.search(r'S(\d{1,2})\.E\d{1,4}', clean_part, re.IGNORECASE)
        if match:
            return int(match.group(1))

        # Handle standard season/episode format like S01E01, S01E1024
        match = re.search(r'S(\d{1,2})E\d{1,4}', clean_part, re.IGNORECASE)
        if match:
            return int(match.group(1))

        match = re.match(r'^S(\d{1,2})$', clean_part, re.IGNORECASE)
        if match:
            return int(match.group(1))

        match = re.match(r'Season\s+(\d{1,2})', clean_part, re.IGNORECASE)
        if match:
            return int(match.group(1))

        # Handle season x episode format like 1x18, 1x1024, or 1x18-20, 1x1024-1026
        match = re.match(r'^(\d{1,2})x\d{1,4}(?:-\d{1,4})?$', clean_part, re.IGNORECASE)
        if match:
            return int(match.group(1))

    # Enhanced season patterns for anime and general content
    season_patterns = [
        r'\bS(\d{1,2})\s*-\s*\d+',
        r'\bS(\d{1,2})\s+\d+',
        r'\bS(\d{1,2})\s*$',
        # Anime-specific season patterns
        r'\bSeason\s+(\d{1,2})\s*-\s*\d+',  # "Season 2 - 03"
        r'\bSeason\s+(\d{1,2})\b',          # "Season 2" anywhere in filename
        r'\bS(\d{1,2})\s*\[',               # "S2 [quality]"
        r'\bS(\d{1,2})\s*\(',               # "S2 (year)"
        # Ordinal season patterns like "3rd Season", "2nd Season", etc.
        r'\b(\d{1,2})(?:st|nd|rd|th)\s+Season\b',  # "3rd Season", "2nd Season"
        # Season x episode patterns in the full filename
        r'\b(\d{1,2})x\d{1,3}(?:-\d{1,3})?\b',  # "1x18" or "1x18-20"
    ]

    for pattern in season_patterns:
        match = re.search(pattern, parsed.original, re.IGNORECASE)
        if match:
            return int(match.group(1))

    # Check for word-based ordinal season patterns like "Second Season", "Third Season", etc.
    # Use context-aware patterns to avoid false positives
    ordinal_map = {
        'first': 1, 'second': 2, 'third': 3, 'fourth': 4, 'fifth': 5, 'sixth': 6,
        'seventh': 7, 'eighth': 8, 'ninth': 9, 'tenth': 10, 'eleventh': 11, 'twelfth': 12
    }

    # Pattern 1: Ordinal followed by "Season" and then episode/quality info (anime style)
    # Example: "Title Second Season - 02" or "Title Third Season [Quality]"
    ordinal_anime_pattern = r'\b(First|Second|Third|Fourth|Fifth|Sixth|Seventh|Eighth|Ninth|Tenth|Eleventh|Twelfth)\s+Season\s*[-–]\s*\d+(?:\s|$|\[)'
    ordinal_match = re.search(ordinal_anime_pattern, parsed.original, re.IGNORECASE)
    if ordinal_match:
        ordinal_word = ordinal_match.group(1).lower()
        return ordinal_map.get(ordinal_word)

    # Pattern 2: Ordinal preceded by clear separator (Western style)
    # Example: "Title - Second Season"
    ordinal_western_pattern = r'[-–]\s*(First|Second|Third|Fourth|Fifth|Sixth|Seventh|Eighth|Ninth|Tenth|Eleventh|Twelfth)\s+Season\b'
    ordinal_match2 = re.search(ordinal_western_pattern, parsed.original, re.IGNORECASE)
    if ordinal_match2:
        ordinal_word = ordinal_match2.group(1).lower()
        return ordinal_map.get(ordinal_word)

    return None


def _extract_episode_from_parsed(parsed: ParsedFilename) -> Optional[int]:
    """Extract episode number from parsed filename data."""
    if _extract_anime_flag_from_parsed(parsed):
        anime_episode = _extract_anime_episode_from_parsed(parsed)
        if anime_episode:
            return anime_episode

    # Standard TV show episode extraction
    for part in parsed.parts:
        clean_part = part.strip().rstrip('.')

        # Handle dot-separated season/episode format like S01.E01, S01.E1024
        match = re.search(r'S\d{1,2}\.E(\d{1,4})', clean_part, re.IGNORECASE)
        if match:
            return int(match.group(1))

        # Handle standard season/episode format like S01E01, S01E1024
        match = re.search(r'S\d{1,2}E(\d{1,4})', clean_part, re.IGNORECASE)
        if match:
            return int(match.group(1))

        match = re.match(r'Episode\s+(\d{1,4})', clean_part, re.IGNORECASE)
        if match:
            return int(match.group(1))

        # Handle "episode.X" format
        match = re.match(r'episode\.(\d{1,4})', clean_part, re.IGNORECASE)
        if match:
            return int(match.group(1))

        match = re.match(r'EP(\d{1,4})', clean_part, re.IGNORECASE)
        if match:
            return int(match.group(1))

        # Standalone episode patterns like E01, E02, E1024, etc.
        match = re.match(r'E(\d{1,4})', clean_part, re.IGNORECASE)
        if match:
            return int(match.group(1))

        # Handle season x episode format like 1x18, 1x1024
        match = re.match(r'^\d{1,2}x(\d{1,4})$', clean_part, re.IGNORECASE)
        if match:
            return int(match.group(1))

        # Handle season x episode range format like 1x18-20, 1x1024-1026 (return first episode)
        match = re.match(r'^\d{1,2}x(\d{1,4})-\d{1,4}$', clean_part, re.IGNORECASE)
        if match:
            return int(match.group(1))

    # Check for season x episode patterns in the original filename
    episode_patterns = [
        r'\b\d{1,2}x(\d{1,4})-\d{1,4}\b',  # "1x18-20", "1x1024-1026" (return first episode)
        r'\b\d{1,2}x(\d{1,4})\b',          # "1x18", "1x1024"
    ]

    for pattern in episode_patterns:
        match = re.search(pattern, parsed.original, re.IGNORECASE)
        if match:
            episode_num = int(match.group(1))
            if 1 <= episode_num <= 4999:
                return episode_num

    # Check for anime-style episode patterns in the original filename
    # Pattern: "Title - Additional Info - 01 - Episode Title"
    anime_episode_patterns = [
        r'\s-\s(\d{1,4})\s-\s',  # " - 01 - ", " - 1024 - "
        r'\s-\s(\d{1,4})\.mkv$', # " - 01.mkv", " - 1024.mkv"
        r'\s-\s(\d{1,4})$',      # " - 01" at end, " - 1024" at end
    ]

    for pattern in anime_episode_patterns:
        match = re.search(pattern, parsed.original, re.IGNORECASE)
        if match:
            episode_num = int(match.group(1))
            if 1 <= episode_num <= 4999:
                return episode_num

    # Additional fallback: check for multi-part patterns in parts
    parts = parsed.parts
    for i, part in enumerate(parts):
        # Check for "Season X - NN" pattern
        if part.lower() == 'season' and i + 2 < len(parts):
            if (parts[i + 2] == '-' and i + 3 < len(parts) and
                re.match(r'^\d{1,2}$', parts[i + 1]) and
                re.match(r'^\d{1,4}$', parts[i + 3])):
                episode_num = int(parts[i + 3])
                if 1 <= episode_num <= 4999:
                    return episode_num

        # Check for "Episode NNNN" pattern across parts
        if part.lower() == 'episode' and i + 1 < len(parts):
            next_part = parts[i + 1]
            if re.match(r'^\d{1,4}$', next_part):
                episode_num = int(next_part)
                if 1 <= episode_num <= 4999:
                    return episode_num

    return None


def _extract_episode_title_from_parsed(parsed: ParsedFilename) -> Optional[str]:
    """Extract episode title from parsed filename data."""
    if not _is_tv_show(parsed):
        return None

    parts = parsed.parts
    technical_terms = parsed.technical_terms

    episode_position = None
    for i, part in enumerate(parts):
        clean_part = part.strip().rstrip('.')
        if (re.match(r'S\d{1,2}\.E\d{1,3}', clean_part, re.IGNORECASE) or
            re.match(r'S\d{1,2}E\d{1,3}', clean_part, re.IGNORECASE) or
            re.match(r'E\d{1,3}', clean_part, re.IGNORECASE) or
            re.match(r'episode\.\d+', clean_part, re.IGNORECASE)):
            episode_position = i
            break

    if episode_position is None:
        return None

    episode_title_parts = []
    for i in range(episode_position + 1, len(parts)):
        part = parts[i].strip().rstrip('.')

        tech_at_position = next((t for t in technical_terms if t['position'] == i), None)
        if tech_at_position and tech_at_position['type'] in ['resolution', 'quality', 'video_codec', 'audio_codec', 'audio_codec_with_channels']:
            break

        episode_title_parts.append(part)

    if episode_title_parts:
        episode_title = ' '.join(episode_title_parts)
        from MediaHub.utils.parser.utils import clean_title_string
        return clean_title_string(episode_title)

    return None


def _extract_anime_flag_from_parsed(parsed: ParsedFilename) -> bool:
    """Check if this appears to be anime content."""
    return is_anime_filename(parsed.original)


def _extract_anime_episode_from_parsed(parsed: ParsedFilename) -> Optional[int]:
    """Extract anime episode number from parsed filename."""
    if not _extract_anime_flag_from_parsed(parsed):
        return None

    anime_episode_patterns = [
        # Standard anime patterns with dashes
        r'\s-\s(\d{1,4})\s',
        r'\s-\s(\d{1,4})\[',
        r'\s-\s(\d{1,4})$',
        r'\s-(\d{1,4})\.mkv$',
        r'\s-(\d{1,4})$',
        r'S\d{1,2}\s*-\s*(\d{1,4})',

        # Season X - Episode pattern (common in anime)
        r'Season\s+\d+\s*-\s*(\d{1,4})\s*\[',  # "Season 2 - 01 [quality]"
        r'Season\s+\d+\s*-\s*(\d{1,4})\s*$',   # "Season 2 - 01" at end
        r'Season\s+\d+\s*-\s*(\d{1,4})\s',     # "Season 2 - 01 " with space after

        # Space-separated episode numbers (common in anime)
        r'\]\s+([A-Za-z\s]+)\s+(\d{1,3})\s+[-\[]',  # "[Group] Title 16 - NCED" pattern
        r'\]\s+([A-Za-z\s]+)\s+(\d{1,3})\s+\[',     # "[Group] Title 02 [Hash]" pattern
        r'\]\s+([A-Za-z\s]+)\s+(\d{1,3})(?:\s|$)',  # "[Group] Title 16" at end

        # Episode indicators
        r'Episode\s+(\d{1,4})',
        r'EP(\d{1,4})',
        r'S\d{1,2}E(\d{1,3})',

        # Underscore patterns
        r'_(\d{1,4})_\d{3,4}\.', # "Title_24_1080." pattern
        r'_(\d{1,4})\.', # "Title_24." pattern

        # Special anime content patterns
        r'(?:NCED|NCOP|NCBD|PV|CM|SP|OVA|OAD|SPECIAL|EXTRA)\s*(\d{1,4})', # "NCED 01v2" pattern
        r'-\s+(?:NCED|NCOP|NCBD|PV|CM|SP|OVA|OAD|SPECIAL|EXTRA)(\d{1,4})', # "- NCED1a" pattern
    ]

    for pattern in anime_episode_patterns:
        match = re.search(pattern, parsed.original, re.IGNORECASE)
        if match:
            groups = match.groups()
            episode_num = int(groups[-1])
            if 1 <= episode_num <= 4999:
                return episode_num

    # Additional fallback: check for simple numeric episode after "Season X -" in parts
    parts = parsed.parts
    for i, part in enumerate(parts):
        if part.lower() == 'season' and i + 2 < len(parts):
            if (parts[i + 2] == '-' and i + 3 < len(parts) and
                re.match(r'^\d{1,2}$', parts[i + 1]) and
                re.match(r'^\d{1,4}$', parts[i + 3])):
                episode_num = int(parts[i + 3])
                if 1 <= episode_num <= 4999:
                    return episode_num

    return None
