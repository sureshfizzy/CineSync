import re
from typing import Dict, Any, List, Optional, Tuple
from dataclasses import dataclass

from MediaHub.utils.parser.patterns import FILE_EXTENSION_PATTERNS
from MediaHub.utils.parser.parse_year import is_valid_year, extract_year, find_all_years_in_filename, should_include_year_in_title, _determine_year_context
from MediaHub.utils.parser.utils import clean_title_string
from MediaHub.utils.parser.parse_anime import is_anime_filename, extract_anime_title


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
    episode_title: Optional[str] = None

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

    parsed = _parse_filename_structure(filename)

    # Extract title and year separately
    title = _extract_title_from_parsed(parsed)
    year = _extract_year_from_parsed(parsed)

    # Remove year from title if it's the same as the extracted year
    if title and year:
        # Remove year from end of title if it matches
        year_pattern = rf'\s+{year}$'
        if re.search(year_pattern, title):
            title = re.sub(year_pattern, '', title).strip()

    return MediaMetadata(
        title=title,
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
        episode=_extract_episode_from_parsed(parsed),
        episode_title=_extract_episode_title_from_parsed(parsed),
        hdr=_extract_hdr_from_parsed(parsed),
        is_repack=_extract_repack_flag_from_parsed(parsed),
        is_proper=_extract_proper_flag_from_parsed(parsed),
        container=_extract_container_from_parsed(parsed),
        is_anime=_extract_anime_flag_from_parsed(parsed),
    )


def _remove_website_patterns(filename: str) -> str:
    if not filename:
        return filename

    # Only match filenames that start with www. (actual websites)
    website_pattern = r'^www\.[a-zA-Z0-9.-]+\.[a-zA-Z]{2,6}\s*[-–—|:]*\s*'

    match = re.match(website_pattern, filename, re.IGNORECASE)
    if match:
        cleaned_filename = filename[match.end():].strip()
        cleaned_filename = re.sub(r'^[-–—|:\s.]+', '', cleaned_filename)
        return cleaned_filename

    return filename

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
        r'S\d{1,2}\.E\d{1,2}',  # Dot-separated season/episode format like S01.E01
        r'S\d{1,2}E\d{1,2}',
        r'S\d{1,2}(?!E)',  # Standalone season patterns like S01, S02, etc.
        r'Season\s+\d+',
        r'\bEpisode\s+\d+',
        r'\bEP\d+',
        r'S\d{1,2}\s*-\s*E\d{1,2}',
        r'E\d{1,3}',  # Standalone episode patterns like E01, E02, etc.
        r'\d{1,2}x\d{1,3}',  # Season x Episode format like 1x18
        r'\d{1,2}x\d{1,3}-\d{1,3}',  # Season x Episode range format like 1x18-20
    ]

    for part in parsed.parts:
        for pattern in episode_patterns:
            if re.match(pattern, part, re.IGNORECASE):
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
    if term_upper in ['BLURAY', 'WEB-DL', 'WEBDL', 'WEBRIP', 'WEB', 'HDTV', 'DVDRIP', 'REMUX', 'BD', 'BDRIP']:
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

    # Languages and audio information
    if term_upper in ['MULTI', 'ITA', 'ENG', 'FRENCH', 'GERMAN', 'SPANISH', 'JAPANESE', 'DUAL-AUDIO', 'MULTI-AUDIO', 'DUAL']:
        return 'language'

    # Release flags
    if term_upper in ['REPACK', 'PROPER', 'REAL', 'FIX']:
        return 'release_flag'

    # Edition
    if term_upper in ['EXTENDED', 'UNRATED', 'DIRECTORS', 'THEATRICAL', 'IMAX', 'REMASTERED', 'UNCENSORED']:
        return 'edition'

    # HDR
    if term_upper in ['HDR', 'HDR10', 'DOLBY', 'VISION']:
        return 'hdr'

    # Technical processing terms (AI upscaling, etc.)
    if re.match(r'^AI[_-]?UPSCALE[_-]?\d*$', term_upper) or term_upper in ['AI_UPSCALE', 'UPSCALE', 'FINAL']:
        return 'technical_processing'

    # Technical quality indicators with numbers/dashes (generic pattern for quality codes)
    if re.match(r'^[A-Z]{2,4}[_-]?\d+$', term_upper):  # Generic pattern like "alq-12", "qp-15", etc.
        return 'technical_processing'



    # Hash patterns (like 42A97BA4)
    if re.match(r'^[A-F0-9]{8}$', term_upper):
        return 'hash'

    # Release group (ends with hyphen + group name) - but not resolution-profile patterns or technical terms
    if re.match(r'^[a-z0-9]+-[A-Z0-9]+$', term, re.IGNORECASE):
        # Skip patterns like "1080p-Hi10P" which are resolution-profile combinations
        if not re.match(r'^\d{3,4}p-', term, re.IGNORECASE):
            # Skip technical quality indicators like "alq-12", "qp-15", etc.
            if not re.match(r'^[A-Z]{2,4}[_-]?\d+$', term, re.IGNORECASE):
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

    # For TV shows, use simple title extraction that stops at season/episode info
    if is_tv:
        title_parts = []
        i = 0
        while i < len(parts):
            clean_part = parts[i].strip().rstrip('.')

            # Stop at season/episode patterns
            if (re.match(r'S\d{1,2}\.E\d{1,2}', clean_part, re.IGNORECASE) or
                re.match(r'S\d{1,2}E\d{1,2}', clean_part, re.IGNORECASE) or
                re.match(r'S\d{1,2}(?!E)', clean_part, re.IGNORECASE) or
                re.match(r'E\d{1,3}', clean_part, re.IGNORECASE) or
                re.match(r'Season\s+\d{1,2}', clean_part, re.IGNORECASE) or
                re.match(r'\d{1,2}x\d{1,3}(?:-\d{1,3})?', clean_part, re.IGNORECASE)):
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

            # Include in title
            title_parts.append(clean_part)
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
    underscore_pattern2 = re.match(r'^([^_]+)_\((\d{4})\)_.*', parsed.filename_no_ext)
    if underscore_pattern2:
        title = underscore_pattern2.group(1).replace('_', ' ')
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

    # Pattern 3: "prefix.title.words.year.technical" (wmt-horus.prince pattern)
    if parsed.is_dot_separated and len(parts) > 3:
        # For dot-separated files, use smarter logic to handle title years vs release years
        # Find the end of the title by looking for multiple indicators
        title_end = len(parts)

        for i, part in enumerate(parts):
            clean_part = part.strip().rstrip('.')

            # Check if this is a year using centralized logic
            year_at_position = next((y for y in years if y['position'] == i), None)
            if year_at_position:
                # Use centralized year logic to determine if this should be included in title
                from MediaHub.utils.parser.parse_year import should_include_year_in_title

                remaining_parts = parts[i+1:i+4]
                has_tech_after = any(
                    re.match(r'^\d{3,4}p$', p.strip().rstrip('.'), re.IGNORECASE) or
                    p.strip().rstrip('.').lower() in ['bluray', 'webrip', 'hdtv', 'x264', 'x265', 'hevc', 'blu-ray', 'jpn']
                    for p in remaining_parts
                )

                if not should_include_year_in_title(year_at_position['value'], i, parts, has_tech_after):
                    title_end = i
                    break

            # Check for actual technical terms and edition terms
            elif (re.match(r'^\d{3,4}p$', clean_part, re.IGNORECASE) or  # Resolution
                  re.match(r'^\d{3,4}x\d{3,4}$', clean_part, re.IGNORECASE) or  # Custom resolution
                  clean_part.lower() in ['bluray', 'webrip', 'hdtv', 'x264', 'x265', 'hevc', 'blu-ray', 'jpn', 'uncensored', 'extended', 'unrated', 'directors', 'theatrical', 'bd', 'dual'] or
                  re.match(r'^AI[_-]?UPSCALE', clean_part, re.IGNORECASE) or  # AI upscaling terms
                  re.match(r'^[A-Z]{2,4}[_-]?\d+', clean_part, re.IGNORECASE) or  # Quality indicators like "alq-12"
                  clean_part.lower() in ['final']):  # Final processing indicators
                title_end = i
                break

        if title_end < len(parts):
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

            year_at_position = next((y for y in years if y['position'] == i), None)
            if year_at_position:
                # For parentheses years, stop at them for title extraction
                if year_at_position['part'].startswith('('):
                    tech_start = i
                    break
                # For regular years with 'technical' context, stop at them
                elif year_at_position['context'] == 'technical':
                    tech_start = i
                    break
                # For regular years with 'title' context, continue looking for tech terms
                else:
                    year_position = i
                    continue

            # Check for technical terms and release group patterns
            elif (re.match(r'^\d{3,4}p$', clean_part, re.IGNORECASE) or  # Resolution
                  re.match(r'^\d{3,4}x\d{3,4}$', clean_part, re.IGNORECASE) or  # Custom resolution like 3840x2160
                  clean_part.lower() in ['bluray', 'webrip', 'hdtv', 'x264', 'x265', 'hevc', 'blu-ray', 'jpn', 'dts-hdma', 'web-dl', 'lmhd', 'multi', 'vostfr', 'bd', 'dual'] or
                  re.match(r'^AI[_-]?UPSCALE', clean_part, re.IGNORECASE) or  # AI upscaling terms
                  re.match(r'^[A-Z]{2,4}[_-]?\d+', clean_part, re.IGNORECASE) or  # Quality indicators like "alq-12"
                  clean_part.lower() in ['final'] or  # Final processing indicators
                  re.match(r'^--', clean_part) or  # Double dash patterns
                  re.match(r'^-[A-Z]', clean_part)):  # Release group patterns like "-Punisher694"
                tech_start = i
                break

        # Extract title up to the stopping point
        if tech_start < len(parts):
            title_parts = parts[:tech_start]
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
        if is_tv and (re.match(r'S\d{1,2}\.E\d{1,2}', clean_part, re.IGNORECASE) or
                      re.match(r'S\d{1,2}E\d{1,2}', clean_part, re.IGNORECASE) or
                      re.match(r'S\d{1,2}(?!E)', clean_part, re.IGNORECASE) or
                      re.match(r'E\d{1,3}', clean_part, re.IGNORECASE) or
                      re.match(r'Season\s+\d{1,2}', clean_part, re.IGNORECASE) or
                      re.match(r'\d{1,2}x\d{1,3}(?:-\d{1,3})?', clean_part, re.IGNORECASE) or
                      re.match(r'(MINI-?SERIES|LIMITED-?SERIES|TV-?SERIES)', clean_part, re.IGNORECASE)):
            break

        # Check if this part is a year
        year_at_position = next((y for y in years if y['position'] == i), None)

        if year_at_position:
            year_value = year_at_position['value']

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
                    last_year_position = years[-1]['position']
                    if i != last_year_position:
                        title_parts.append(str(year_value))
                    else:
                        has_tech_after = any(t['position'] > i for t in technical_terms)
                        if has_tech_after:
                            break
                        else:
                            title_parts.append(str(year_value))
                elif len(years) == 1:
                    # Single year - check context and position
                    if year_at_position['context'] == 'title':
                        title_parts.append(str(year_value))
                    else:
                        has_tech_after = any(t['position'] > i for t in technical_terms)
                        if i <= 2 and has_tech_after:
                            title_parts.append(str(year_value))
                        else:
                            break
        else:
            if clean_part.startswith('(') or clean_part.startswith('['):
                break

            tech_at_position = next((t for t in technical_terms if t['position'] == i), None)
            if tech_at_position and tech_at_position['type'] in ['resolution', 'quality', 'video_codec', 'video_profile', 'technical_processing']:
                break

            # Skip series type indicators from title
            if re.match(r'(MINI-?SERIES|LIMITED-?SERIES|TV-?SERIES)', clean_part, re.IGNORECASE):
                continue

            # Skip technical terms that shouldn't be in title
            if re.match(r'^(Hi10P|10bit|8bit|HDR10?\+?|1080p|720p|480p|\d{3,4}x\d{3,4}|BluRay|BD|WEBRip|HDTV|x264|x265|HEVC|FLAC|DTS|AC3|JPN|CUSTOM|MULTi|VOSTFR|Uncensored|RM|AI[_-]?UPSCALE|DUAL|FINAL)$', clean_part, re.IGNORECASE):
                continue

            # Skip generic quality indicators with numbers
            if re.match(r'^[A-Z]{2,4}[_-]?\d+$', clean_part, re.IGNORECASE):
                continue

            # Special handling for "Title - Season XX" pattern
            if clean_part == '-' and i + 1 < len(parts):
                next_part = parts[i + 1].strip().rstrip('.')
                if re.match(r'Season', next_part, re.IGNORECASE):
                    break

            # Also stop if current part is "Season"
            if re.match(r'Season', clean_part, re.IGNORECASE):
                break

            # Handle anime-style episode patterns
            if clean_part == '-' and i + 1 < len(parts):
                next_part = parts[i + 1].strip().rstrip('.')
                if re.match(r'^\d{1,4}$', next_part):
                    episode_num = int(next_part)
                    if 1 <= episode_num <= 999:
                        break

            # Include in title
            title_parts.append(clean_part)

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
            if not re.match(r'^\d{3,4}p-', group_name, re.IGNORECASE):  # Skip "1080p-Hi10P" style
                return group_name
        # If all are technical-looking, return the first one
        return release_groups[0]['term']

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
                return part.split('-')[-1]

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

        # Handle dot-separated season/episode format like S01.E01
        match = re.match(r'S(\d{1,2})\.E\d{1,2}', clean_part, re.IGNORECASE)
        if match:
            return int(match.group(1))

        # Handle standard season/episode format like S01E01
        match = re.match(r'S(\d{1,2})E\d{1,2}', clean_part, re.IGNORECASE)
        if match:
            return int(match.group(1))

        match = re.match(r'^S(\d{1,2})$', clean_part, re.IGNORECASE)
        if match:
            return int(match.group(1))

        match = re.match(r'Season\s+(\d{1,2})', clean_part, re.IGNORECASE)
        if match:
            return int(match.group(1))

        # Handle season x episode format like 1x18 or 1x18-20
        match = re.match(r'^(\d{1,2})x\d{1,3}(?:-\d{1,3})?$', clean_part, re.IGNORECASE)
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
        # Season x episode patterns in the full filename
        r'\b(\d{1,2})x\d{1,3}(?:-\d{1,3})?\b',  # "1x18" or "1x18-20"
    ]

    for pattern in season_patterns:
        match = re.search(pattern, parsed.original, re.IGNORECASE)
        if match:
            return int(match.group(1))

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

        # Handle dot-separated season/episode format like S01.E01
        match = re.match(r'S\d{1,2}\.E(\d{1,2})', clean_part, re.IGNORECASE)
        if match:
            return int(match.group(1))

        # Handle standard season/episode format like S01E01
        match = re.match(r'S\d{1,2}E(\d{1,2})', clean_part, re.IGNORECASE)
        if match:
            return int(match.group(1))

        match = re.match(r'Episode\s+(\d{1,2})', clean_part, re.IGNORECASE)
        if match:
            return int(match.group(1))

        match = re.match(r'EP(\d{1,2})', clean_part, re.IGNORECASE)
        if match:
            return int(match.group(1))

        # Standalone episode patterns like E01, E02, etc.
        match = re.match(r'E(\d{1,3})', clean_part, re.IGNORECASE)
        if match:
            return int(match.group(1))

        # Handle season x episode format like 1x18
        match = re.match(r'^\d{1,2}x(\d{1,3})$', clean_part, re.IGNORECASE)
        if match:
            return int(match.group(1))

        # Handle season x episode range format like 1x18-20 (return first episode)
        match = re.match(r'^\d{1,2}x(\d{1,3})-\d{1,3}$', clean_part, re.IGNORECASE)
        if match:
            return int(match.group(1))

    # Check for season x episode patterns in the original filename
    episode_patterns = [
        r'\b\d{1,2}x(\d{1,3})-\d{1,3}\b',  # "1x18-20" (return first episode)
        r'\b\d{1,2}x(\d{1,3})\b',          # "1x18"
    ]

    for pattern in episode_patterns:
        match = re.search(pattern, parsed.original, re.IGNORECASE)
        if match:
            episode_num = int(match.group(1))
            if 1 <= episode_num <= 999:  # Reasonable episode range
                return episode_num

    # Check for anime-style episode patterns in the original filename
    # Pattern: "Title - Additional Info - 01 - Episode Title"
    anime_episode_patterns = [
        r'\s-\s(\d{1,3})\s-\s',  # " - 01 - "
        r'\s-\s(\d{1,3})\.mkv$', # " - 01.mkv"
        r'\s-\s(\d{1,3})$',      # " - 01" at end
    ]

    for pattern in anime_episode_patterns:
        match = re.search(pattern, parsed.original, re.IGNORECASE)
        if match:
            episode_num = int(match.group(1))
            if 1 <= episode_num <= 999:  # Reasonable episode range
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
        if (re.match(r'S\d{1,2}\.E\d{1,2}', clean_part, re.IGNORECASE) or
            re.match(r'S\d{1,2}E\d{1,2}', clean_part, re.IGNORECASE) or
            re.match(r'E\d{1,3}', clean_part, re.IGNORECASE)):
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
        r'S\d{1,2}\s*-\s*(\d{1,4})',

        # Space-separated episode numbers (common in anime)
        r'\]\s+([A-Za-z\s]+)\s+(\d{1,3})\s+[-\[]',  # "[Group] Title 16 - NCED" pattern
        r'\]\s+([A-Za-z\s]+)\s+(\d{1,3})\s+\[',     # "[Group] Title 02 [Hash]" pattern
        r'\]\s+([A-Za-z\s]+)\s+(\d{1,3})(?:\s|$)',  # "[Group] Title 16" at end

        # Episode indicators
        r'Episode\s+(\d{1,4})',
        r'EP(\d{1,4})',
        r'S\d{1,2}E(\d{1,2})',

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
            if 1 <= episode_num <= 9999:
                return episode_num

    return None
