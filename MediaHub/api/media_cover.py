import os
import sys
import requests
import sqlite3
from pathlib import Path
from typing import Optional, Dict, Any
from MediaHub.utils.logging_utils import log_message
from MediaHub.utils.system_utils import is_frozen, get_db_directory

# Determine base directory utility
BASE_DIR = str(get_db_directory().parent)
DB_DIR = str(get_db_directory())
MEDIA_COVER_DIR = os.path.join(DB_DIR, "MediaCover")

os.makedirs(MEDIA_COVER_DIR, exist_ok=True)

TMDB_IMAGE_BASE_URL = "https://image.tmdb.org/t/p/"

IMAGE_SIZES = {
    'poster': 'w500',
    'fanart': 'w1280',
    'banner': 'w500'
}

class MediaCoverManager:
    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'MediaHub/1.0'
        })
        
    def get_media_cover_path(self, tmdb_id: int, cover_type: str) -> str:
        media_dir = os.path.join(MEDIA_COVER_DIR, str(tmdb_id))
        os.makedirs(media_dir, exist_ok=True)
        return os.path.join(media_dir, f"{cover_type}.jpg")
    
    def download_image(self, image_url: str, local_path: str) -> bool:
        try:
            response = self.session.get(image_url, timeout=30, stream=True)
            response.raise_for_status()
            
            os.makedirs(os.path.dirname(local_path), exist_ok=True)
            
            with open(local_path, 'wb') as f:
                for chunk in response.iter_content(chunk_size=8192):
                    if chunk:
                        f.write(chunk)
            
            return True
            
        except Exception as e:
            return False
    
    def process_media_covers(self, tmdb_id: int, tmdb_data: Dict[str, Any]) -> Dict[str, str]:
        downloaded_covers = {}
        
        poster_path = tmdb_data.get('poster_path')
        if poster_path:
            poster_url = f"{TMDB_IMAGE_BASE_URL}{IMAGE_SIZES['poster']}{poster_path}"
            local_poster_path = self.get_media_cover_path(tmdb_id, 'poster')
            
            if not os.path.exists(local_poster_path):
                if self.download_image(poster_url, local_poster_path):
                    downloaded_covers['poster'] = local_poster_path
            else:
                downloaded_covers['poster'] = local_poster_path
        
        backdrop_path = tmdb_data.get('backdrop_path')
        if backdrop_path:
            fanart_url = f"{TMDB_IMAGE_BASE_URL}{IMAGE_SIZES['fanart']}{backdrop_path}"
            local_fanart_path = self.get_media_cover_path(tmdb_id, 'fanart')
            
            if not os.path.exists(local_fanart_path):
                if self.download_image(fanart_url, local_fanart_path):
                    downloaded_covers['fanart'] = local_fanart_path
            else:
                downloaded_covers['fanart'] = local_fanart_path
        
        return downloaded_covers
    
    def get_existing_covers(self, tmdb_id: int) -> Dict[str, str]:
        existing_covers = {}
        
        for cover_type in ['poster', 'fanart', 'banner']:
            cover_path = self.get_media_cover_path(tmdb_id, cover_type)
            if os.path.exists(cover_path):
                existing_covers[cover_type] = cover_path
        
        return existing_covers
    
    def cleanup_media_covers(self, tmdb_id: int) -> bool:
        try:
            media_dir = os.path.join(MEDIA_COVER_DIR, str(tmdb_id))
            if os.path.exists(media_dir):
                import shutil
                shutil.rmtree(media_dir)
                log_message(f"Cleaned up MediaCover directory for TMDB ID {tmdb_id}", level="INFO")
                return True
            return True
        except Exception as e:
            log_message(f"Failed to cleanup MediaCover for TMDB ID {tmdb_id}: {e}", level="ERROR")
            return False

media_cover_manager = MediaCoverManager()

def process_tmdb_covers(tmdb_id: int, tmdb_data: Dict[str, Any]) -> Dict[str, str]:
    return media_cover_manager.process_media_covers(tmdb_id, tmdb_data)

def get_media_covers(tmdb_id: int) -> Dict[str, str]:
    return media_cover_manager.get_existing_covers(tmdb_id)

def cleanup_tmdb_covers(tmdb_id: int) -> bool:
    return media_cover_manager.cleanup_media_covers(tmdb_id)
