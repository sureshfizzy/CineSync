import os
import re

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
    match = re.search(r'\((\d{4})\)', folder_name)
    if match:
        return int(match.group(1))
    match = re.search(r'\.(\d{4})\.', folder_name)
    if match:
        return int(match.group(1))
    return None

def extract_movie_name_and_year(filename):
    patterns = [
        r'(.+?)\s*\((\d{4})\)',  # Movie Name (2020)
        r'(.+?)\s*(\d{4})'       # Movie Name 2020
    ]
    for pattern in patterns:
        match = re.search(pattern, filename)
        if match:
            name = match.group(1).replace('.', ' ').replace('-', ' ').strip()
            year = match.group(2)
            return name, year
    return None, None
