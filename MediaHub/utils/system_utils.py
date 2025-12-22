"""System utilities for detecting runtime environment"""

import sys
import os
from pathlib import Path


def is_frozen():
    """
    Check if running as a frozen executable (PyInstaller/py2exe/etc).
    
    Returns:
        bool: True if running as compiled executable, False if running as Python script
    """
    return getattr(sys, 'frozen', False) and hasattr(sys, '_MEIPASS')


def is_pyinstaller():
    """
    Check if running under PyInstaller.
    
    Returns:
        bool: True if running under PyInstaller
    """
    return getattr(sys, 'frozen', False)


def get_application_path():
    """
    Get the application's base directory.
    
    Returns:
        Path: Application base directory (frozen: exe dir, script: script dir)
    """
    if getattr(sys, 'frozen', False):
        return Path(sys.executable).parent
    else:
        return Path(__file__).parent.parent


def get_resource_path(relative_path=''):
    """
    Get absolute path to resource, works for dev and for PyInstaller.
    
    Args:
        relative_path: Path relative to the application root
        
    Returns:
        Path: Absolute path to the resource
    """
    if getattr(sys, 'frozen', False):
        base_path = Path(sys._MEIPASS)
    else:
        base_path = Path(__file__).parent.parent
    
    if relative_path:
        return base_path / relative_path
    return base_path


def get_data_directory():
    """
    Get the directory for persistent data storage.
    
    Returns:
        Path: Directory where persistent data should be stored
    """
    if getattr(sys, 'frozen', False):
        return Path(sys.executable).parent
    else:
        return Path(__file__).parent.parent


def get_logs_directory():
    """
    Get the directory for log files.
    
    Returns:
        Path: Directory where logs should be stored
    """
    app_path = get_application_path()
    if is_frozen():
        if str(app_path).startswith('/opt/cinesync'):
            return Path('/opt/cinesync/logs')
        elif str(app_path).startswith('/Applications/CineSync.app'):
            return Path('/tmp/cinesync-logs')

    logs_dir = app_path.parent / 'logs'
    logs_dir.mkdir(exist_ok=True)
    return logs_dir


def get_db_directory():
    """
    Get the directory for database files.
    
    Returns:
        Path: Directory where database files should be stored
    """
    app_path = get_application_path()

    if is_frozen():
        if str(app_path).startswith('/opt/cinesync'):
            return Path('/opt/cinesync/db')
        elif str(app_path).startswith('/Applications/CineSync.app'):
            return Path('/Applications/CineSync.app/Contents/db')
    db_dir = app_path.parent / 'db'
    db_dir.mkdir(exist_ok=True)
    return db_dir


# Convenience exports
__all__ = [
    'is_frozen',
    'is_pyinstaller',
    'get_application_path',
    'get_resource_path',
    'get_data_directory',
    'get_logs_directory',
    'get_db_directory',
]
