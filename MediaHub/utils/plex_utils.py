import os
import time
import logging
import requests
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from typing import List, Optional
from dotenv import load_dotenv
from urllib.parse import quote
from logging.handlers import RotatingFileHandler
from MediaHub.utils.logging_utils import log_message
from MediaHub.config.config import *

# Load environment variables
load_dotenv()

def get_plex_library_sections() -> List[dict]:
    """Fetch Plex library sections."""
    try:
        headers = {'X-Plex-Token': plex_token()}
        response = requests.get(f"{plex_url()}/library/sections", headers=headers)
        response.raise_for_status()
        root = ET.fromstring(response.content)
        return [{'key': d.get('key'), 'type': d.get('type')} for d in root.findall('.//Directory')]
    except Exception as e:
        log_message(f"Error fetching sections: {e}", "ERROR")
        return []

def refresh_section(section_id: str, path: str, headers: dict) -> bool:
    """Attempt a section refresh for a given path."""
    refresh_url = f"{plex_url()}/library/sections/{section_id}/refresh?path={quote(path)}"
    try:
        response = requests.get(refresh_url, headers=headers)
        response.raise_for_status()
        return True
    except Exception as e:
        log_message(f"Refresh failed: {e}", "DEBUG")
        return False

def refresh_plex_for_file(file_path: str) -> None:
    """Refresh Plex library for a specific file."""
    if not plex_update() or not plex_token():
        return

    headers = {'X-Plex-Token': plex_token()}
    sections = get_plex_library_sections()
    relevant_sections = [s for s in sections if s['type'] in ['movie', 'show']]

    file_dir = os.path.dirname(file_path)
    tasks = []

    with ThreadPoolExecutor() as executor:
        for section in relevant_sections:
            tasks.append(executor.submit(refresh_section, section['key'], file_path, headers))
            tasks.append(executor.submit(refresh_section, section['key'], file_dir, headers))

    results = [task.result() for task in tasks]
    if any(results):
        log_message(f"Plex refresh successful for: {file_path}", "INFO")
    else:
        log_message(f"Failed to refresh Plex for: {file_path}", "WARNING")

def update_plex_after_symlink(dest_file: str) -> None:
    """Wrapper function to trigger Plex refresh after symlink creation."""
    try:
        if not logging.getLogger().handlers:
            setup_logging()

        if os.path.exists(dest_file):
            refresh_plex_for_file(dest_file)
        else:
            log_message(f"File does not exist: {dest_file}", "ERROR")
    except Exception as e:
        log_message(f"Error updating Plex: {e}", "ERROR")
