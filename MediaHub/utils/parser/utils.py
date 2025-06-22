"""
Shared utility functions for media parsers.
"""

import re
from typing import Optional

from MediaHub.utils.parser.patterns import FILE_EXTENSION_PATTERNS


def clean_title_string(title: str) -> str:
    """Clean and normalize a title string."""
    if not title:
        return ""

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

    technical_terms = [
        r'\b\d{3,4}p\b', r'\bx264\b', r'\bx265\b', r'\bHEVC\b', r'\bAAC\b',
        r'\bAC3\b', r'\bDTS\b', r'\bBluRay\b', r'\bWEB-DL\b', r'\bWEBRip\b',
        r'\bHDTV\b', r'\bREMUX\b', r'\bREPACK\b', r'\bPROPER\b'
    ]

    for term in technical_terms:
        title = re.sub(term, '', title, flags=re.IGNORECASE)

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