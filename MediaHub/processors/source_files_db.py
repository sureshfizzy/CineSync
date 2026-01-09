"""
Source Files Database Utilities

This module provides utilities to interact with the source files database
managed by the WebDavHub service to track unprocessed files.
"""

import os
import sqlite3
import time
from typing import List, Optional, Tuple
from MediaHub.utils.logging_utils import log_message
from MediaHub.processors.db_utils import normalize_file_path
from MediaHub.utils.system_utils import get_db_directory


def get_source_db_path():
    """Get the path to the source files database.
    
    Uses get_db_directory() to properly handle both development and installed environments.
    """
    db_dir = str(get_db_directory())
    db_path = os.path.join(db_dir, "source_files.db")
    return db_path


def get_source_db_connection():
    """Get a connection to the source files database."""
    db_path = get_source_db_path()
    
    if not os.path.exists(db_path):
        log_message(f"Source files database not found at {db_path}", level="WARNING")
        return None
    
    try:
        conn = sqlite3.connect(db_path, timeout=120.0)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        conn.execute("PRAGMA cache_size=20000")
        conn.execute("PRAGMA wal_autocheckpoint=1000")
        conn.execute("PRAGMA mmap_size=268435456")
        conn.execute("PRAGMA read_uncommitted=true")
        return conn
    except sqlite3.Error as e:
        log_message(f"Failed to connect to source files database: {e}", level="ERROR")
        return None


def get_unprocessed_files_from_source_db(limit: Optional[int] = None) -> List[str]:
    """
    Get list of unprocessed files from the source files database.
    
    Args:
        limit: Optional limit on number of files to return
        
    Returns:
        List of file paths that are marked as unprocessed
    """
    conn = get_source_db_connection()
    if not conn:
        return []
    
    try:
        cursor = conn.cursor()
        
        # Query for unprocessed files that are active and are media files
        query = """
            SELECT file_path 
            FROM source_files 
            WHERE processing_status = 'unprocessed' 
            AND is_active = TRUE 
            AND is_media_file = TRUE
            ORDER BY last_seen_at DESC, file_name ASC
        """
        
        if limit:
            query += f" LIMIT {limit}"
        
        cursor.execute(query)
        rows = cursor.fetchall()
        
        file_paths = [row[0] for row in rows if row[0] and os.path.exists(row[0])]

        if file_paths:
            log_message(f"Found {len(file_paths)} unprocessed files in source database", level="INFO")
        return file_paths
        
    except sqlite3.Error as e:
        log_message(f"Error querying source files database: {e}", level="ERROR")
        return []
    finally:
        conn.close()

def get_source_file_info(file_path: str) -> Optional[dict]:
    """
    Get information about a file from the source files database.
    
    Args:
        file_path: Path to the file
        
    Returns:
        Dictionary with file information or None if not found
    """
    conn = get_source_db_connection()
    if not conn:
        return None
    
    try:
        cursor = conn.cursor()
        
        # Normalize the file path for consistent comparison
        normalized_path = normalize_file_path(file_path)
        
        query = """
            SELECT file_path, file_name, file_size, processing_status, 
                   is_media_file, media_type, tmdb_id, season_number, 
                   last_seen_at, last_processed_at
            FROM source_files 
            WHERE file_path = ? OR file_path = ?
        """
        
        cursor.execute(query, (normalized_path, file_path))
        row = cursor.fetchone()
        
        if row:
            return {
                'file_path': row[0],
                'file_name': row[1],
                'file_size': row[2],
                'processing_status': row[3],
                'is_media_file': bool(row[4]),
                'media_type': row[5],
                'tmdb_id': row[6],
                'season_number': row[7],
                'last_seen_at': row[8],
                'last_processed_at': row[9]
            }
        
        return None
        
    except sqlite3.Error as e:
        log_message(f"Error getting source file info: {e}", level="ERROR")
        return None
    finally:
        conn.close()


def check_source_db_availability() -> bool:
    """
    Check if the source files database is available and accessible.
    
    Returns:
        True if database is available, False otherwise
    """
    db_path = get_source_db_path()
    
    if not os.path.exists(db_path):
        return False
    
    conn = get_source_db_connection()
    if not conn:
        return False
    
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM source_files LIMIT 1")
        cursor.fetchone()
        return True
    except sqlite3.Error:
        return False
    finally:
        conn.close()


def get_unprocessed_files_count() -> int:
    """
    Get the count of unprocessed files in the source database.

    Returns:
        Number of unprocessed files
    """
    conn = get_source_db_connection()
    if not conn:
        return 0

    try:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT COUNT(*)
            FROM source_files
            WHERE processing_status = 'unprocessed'
            AND is_active = TRUE
            AND is_media_file = TRUE
        """)

        result = cursor.fetchone()
        return result[0] if result else 0

    except sqlite3.Error as e:
        log_message(f"Error counting unprocessed files: {e}", level="ERROR")
        return 0
    finally:
        conn.close()