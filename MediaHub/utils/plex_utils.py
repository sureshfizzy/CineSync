import os
import time
import logging
import requests
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from typing import List, Optional
from urllib.parse import quote
from logging.handlers import RotatingFileHandler
from MediaHub.utils.logging_utils import log_message
from MediaHub.config.config import *

def get_plex_library_sections() -> List[dict]:
    """Fetch Plex library sections."""
    try:
        token = plex_token()
        url = plex_url()
        
        if not token or not url:
            log_message("Plex token or URL not configured", "WARNING")
            return []
            
        headers = {'X-Plex-Token': token}
        response = requests.get(f"{url}/library/sections", headers=headers, timeout=10)
        response.raise_for_status()
        root = ET.fromstring(response.content)
        return [{'key': d.get('key'), 'type': d.get('type')} for d in root.findall('.//Directory')]
    except requests.exceptions.Timeout:
        log_message("Plex request timed out after 10 seconds", "ERROR")
        return []
    except requests.exceptions.HTTPError as e:
        if e.response and e.response.status_code == 401:
            log_message("Plex authentication failed (401 Unauthorized). Check PLEX_TOKEN in settings.", "ERROR")
        else:
            log_message(f"Plex HTTP error: {e}", "ERROR")
        return []
    except Exception as e:
        log_message(f"Error fetching sections: {e}", "ERROR")
        return []

def refresh_section(section_id: str, path: str, headers: dict = None) -> bool:
    """Attempt a section refresh for a given path."""
    if headers is None:
        token = plex_token()
        if not token:
            return False
        headers = {'X-Plex-Token': token}
    
    url = plex_url()
    if not url:
        return False
        
    refresh_url = f"{url}/library/sections/{section_id}/refresh?path={quote(path)}"
    try:
        response = requests.get(refresh_url, headers=headers, timeout=10)
        response.raise_for_status()
        return True
    except requests.exceptions.Timeout:
        log_message(f"Plex refresh timeout for section {section_id}", "DEBUG")
        return False
    except requests.exceptions.HTTPError as e:
        if e.response and e.response.status_code == 401:
            log_message(f"Plex refresh unauthorized (401) for section {section_id}. Token may be invalid.", "WARNING")
        else:
            log_message(f"Plex refresh HTTP error for section {section_id}: {e}", "DEBUG")
        return False
    except Exception as e:
        log_message(f"Refresh failed for section {section_id}: {e}", "DEBUG")
        return False

def refresh_plex_for_file(file_path: str) -> None:
    """Refresh Plex library for a specific file."""
    if not plex_update() or not plex_token():
        return

    sections = get_plex_library_sections()
    relevant_sections = [s for s in sections if s['type'] in ['movie', 'show']]

    file_dir = os.path.dirname(file_path)
    tasks = []

    max_workers = get_max_processes()
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        for section in relevant_sections:
            tasks.append(executor.submit(refresh_section, section['key'], file_path, None))
            tasks.append(executor.submit(refresh_section, section['key'], file_dir, None))

    results = [task.result() for task in tasks]
    if any(results):
        log_message(f"Plex refresh successful for: {file_path}", "INFO")
    else:
        log_message(f"Failed to refresh Plex for: {file_path}", "WARNING")

def update_plex_after_symlink(dest_file: str) -> None:
    """Wrapper function to trigger Plex refresh after symlink creation."""
    try:
        if os.path.exists(dest_file):
            refresh_plex_for_file(dest_file)
        else:
            log_message(f"File does not exist: {dest_file}", "ERROR")
    except Exception as e:
        log_message(f"Error updating Plex: {e}", "ERROR")

def update_plex_after_deletion(dest_file: str) -> None:
    """Wrapper function to trigger Plex refresh after symlink deletion."""
    try:
        if not plex_update() or not plex_token():
            return

        if dest_file:
            parent_dir = os.path.dirname(dest_file)
            if parent_dir and os.path.exists(parent_dir):
                refresh_plex_for_file(parent_dir)
                log_message(f"Plex refresh triggered for deletion: {dest_file} (refreshed parent: {parent_dir})", "INFO")
            else:
                log_message(f"Parent directory does not exist for deleted file: {dest_file}", "WARNING")
    except Exception as e:
        log_message(f"Error updating Plex after deletion: {e}", "ERROR")
