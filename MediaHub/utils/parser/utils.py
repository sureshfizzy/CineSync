"""
Shared utility functions for media parsers.
"""

import re
import os
import json
from typing import Optional

from MediaHub.utils.parser.patterns import FILE_EXTENSION_PATTERNS

# Cache for keywords and mediainfo data
_keywords_cache = None
_mediainfo_cache = None

def _load_keywords():
    """Load keywords from keywords.json file."""
    global _keywords_cache
    if _keywords_cache is not None:
        return _keywords_cache

    keywords_path = os.path.join(os.path.dirname(__file__), '..', 'keywords.json')
    with open(keywords_path, 'r', encoding='utf-8') as f:
        _keywords_cache = json.load(f)
        return _keywords_cache


def _load_mediainfo():
    """Load mediainfo from mediainfo.json file."""
    global _mediainfo_cache
    if _mediainfo_cache is not None:
        return _mediainfo_cache

    mediainfo_path = os.path.join(os.path.dirname(__file__), '..', 'mediainfo.json')
    with open(mediainfo_path, 'r', encoding='utf-8') as f:
        _mediainfo_cache = json.load(f)
        return _mediainfo_cache

def _get_all_keywords():
    """Get all keywords from keywords.json that should be removed from titles."""
    keywords_data = _load_keywords()
    keywords = keywords_data.get('keywords', [])
    editions = keywords_data.get('editions', [])

    # Combine keywords and editions
    all_keywords = []
    all_keywords.extend(keyword for keyword in keywords if isinstance(keyword, str))
    all_keywords.extend(edition for edition in editions if isinstance(edition, str))

    # Return all keywords as a set for faster lookup
    return set(all_keywords)


def extract_alternative_title(title: str) -> str:
    """Extract alternative title from AKA patterns in title string."""
    if not title:
        return ""

    def _get_technical_stop_terms():
        """Get technical terms that should stop AKA extraction."""
        stop_terms = []

        keywords_data = _load_keywords()
        if keywords_data:
            stop_terms.extend(keywords_data.get('quality_sources', []))
            stop_terms.extend(keywords_data.get('keywords', []))

        mediainfo_data = _load_mediainfo()
        if mediainfo_data:
            stop_terms.extend(mediainfo_data.get('VideoCodecs', []))
            stop_terms.extend(mediainfo_data.get('AudioCodecs', []))
            stop_terms.extend(mediainfo_data.get('Resolutions', []))
            stop_terms.extend(mediainfo_data.get('Sources', []))

        stop_terms.extend(['Miniseries', 'Season', 'Series', 'Complete'])

        escaped_terms = [re.escape(term) for term in stop_terms if term]
        return '|'.join(escaped_terms)

    stop_pattern = _get_technical_stop_terms()

    # Patterns to match AKA and alternative title indicators
    aka_patterns = [
        # Dot-separated patterns (common in filenames)
        rf'\.aka\.([^.]+(?:\.[^.]+)*?)\.(?:\d{{4}}|S\d+|E\d+|{stop_pattern})',
        rf'\.also\.known\.as\.([^.]+(?:\.[^.]+)*?)\.(?:\d{{4}}|S\d+|E\d+|{stop_pattern})',
        rf'\.a\.?k\.?a\.([^.]+(?:\.[^.]+)*?)\.(?:\d{{4}}|S\d+|E\d+|{stop_pattern})',
        rf'\.alias\.([^.]+(?:\.[^.]+)*?)\.(?:\d{{4}}|S\d+|E\d+|{stop_pattern})',

        # Space-separated patterns (traditional)
        r'\s+aka\.?\s+(.+?)(?:\s+\d{4}|\s+S\d+|\s+E\d+|\s+Season|\s*$)',
        r'\s+also\s+known\s+as\s+(.+?)(?:\s+\d{4}|\s+S\d+|\s+E\d+|\s+Season|\s*$)',
        r'\s+a\.?\s*k\.?\s*a\.?\s+(.+?)(?:\s+\d{4}|\s+S\d+|\s+E\d+|\s+Season|\s*$)',
        r'\s+alias\s+(.+?)(?:\s+\d{4}|\s+S\d+|\s+E\d+|\s+Season|\s*$)',
    ]

    for pattern in aka_patterns:
        try:
            match = re.search(pattern, title, re.IGNORECASE)
            if match:
                alternative = match.group(1).strip()
                alternative = re.sub(r'\.', ' ', alternative)
                alternative = re.sub(r'\s+S\d+.*$', '', alternative, flags=re.IGNORECASE)  # Remove S01E01 patterns
                alternative = re.sub(r'\s+Season.*$', '', alternative, flags=re.IGNORECASE)  # Remove Season patterns
                alternative = re.sub(r'\s+E\d+.*$', '', alternative, flags=re.IGNORECASE)  # Remove E01 patterns
                alternative = re.sub(r'\s+\d{4}.*$', '', alternative)  # Remove year and everything after
                alternative = re.sub(r'\s+', ' ', alternative)
                alternative = alternative.strip()
                if alternative and not re.match(r'^\d{4}$', alternative) and len(alternative) > 2:
                    return alternative
        except re.error:
            continue

    return ""


def clean_title_string(title: str) -> str:
    """Clean and normalize a title string."""
    if not title:
        return ""

    # Remove keywords from keywords.json from title
    all_keywords = _get_all_keywords()
    for keyword in all_keywords:
        if keyword.upper() == 'DC':
            pattern = r'(?<![A-Za-z.])DC(?![\w\'.])'
        else:
            pattern = r'\b' + re.escape(keyword) + r'\b'
        title = re.sub(pattern, '', title, flags=re.IGNORECASE)

    protected_dots = []
    abbreviation_patterns = [
        r'\b[A-Z](?:\.[A-Z])+\.?\b',
        r'\b[A-Z]\.[A-Z]\.[A-Za-z]+\b',
    ]

    for pattern in abbreviation_patterns:
        abbreviations = re.findall(pattern, title)
        for i, abbrev in enumerate(abbreviations):
            placeholder = f"XABBREVX{len(protected_dots)}XABBREVX"
            protected_dots.append((placeholder, abbrev))
            title = title.replace(abbrev, placeholder)

    title = re.sub(r'[._]', ' ', title)

    title = re.sub(r'\s+-\s+', ' ', title)
    title = re.sub(r'^-\s+|\s+-$', ' ', title)

    title = re.sub(r'\[.*?\]', '', title)
    title = re.sub(r'\(.*?\)', '', title)

    # Extract alternative titles before removing them
    alternative_title = extract_alternative_title(title)

    alternative_indicators = [
        r'\s+aka\.?\s+.*$',
        r'\s+also\s+known\s+as\s+.*$',
        r'\s+a\.?\s*k\.?\s*a\.?\s+.*$',
        r'\s+alias\s+.*$',
    ]

    for pattern in alternative_indicators:
        title = re.sub(pattern, '', title, flags=re.IGNORECASE)

    for placeholder, abbrev in protected_dots:
        title = title.replace(placeholder, abbrev)

    keywords_data = _load_keywords()
    technical_keywords = keywords_data.get('keywords', [])

    title = re.sub(r'\b\d{3,4}p\b', '', title, flags=re.IGNORECASE)

    for keyword in technical_keywords:
        if isinstance(keyword, str):
            pattern = r'\b' + re.escape(keyword) + r'\b'
            title = re.sub(pattern, '', title, flags=re.IGNORECASE)

    title = re.sub(r'\s+', ' ', title).strip()

    title = re.sub(r'^0\d\s+', '', title).strip()

    title = re.sub(r'^[^\w\s.!?]+|[^\w\s.!?]+$', '', title).strip()

    return title


def should_include_year_in_title(title_so_far: str) -> bool:
    """
    Determine if a title should include a year based on generic patterns.
    Uses heuristics rather than hardcoded title lists.

    Args:
        title_so_far: The title extracted so far

    Returns:
        True if the title likely needs year disambiguation, False otherwise
    """
    if not title_so_far:
        return False

    title_clean = title_so_far.strip()

    from MediaHub.utils.parser.patterns import TITLE_YEAR_INCLUSION_PATTERNS

    for pattern_key, pattern in TITLE_YEAR_INCLUSION_PATTERNS.items():
        if pattern.search(title_clean):
            return True

    words = title_clean.split()

    if len(words) <= 2 and all(len(word) <= 6 for word in words):
        return True

    if len(words) == 1:
        return True

    if len(words) <= 2:
        for word in words:
            if len(word) <= 3:
                return True

    return False