"""
Shared utility functions for media parsers.
"""

import re
import os
import json
from typing import Optional

from MediaHub.utils.parser.patterns import FILE_EXTENSION_PATTERNS

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

    title = re.sub(r'^[^\w\s.]+|[^\w\s.]+$', '', title).strip()

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