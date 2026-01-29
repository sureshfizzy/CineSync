import os
import sys
from pathlib import Path
from typing import Optional, Dict
from MediaHub.utils.logging_utils import log_message

_env_cache: Dict[str, str] = {}
_env_file_path: Optional[Path] = None
_last_mtime: Optional[float] = None

def get_env_file_path() -> Path:
    global _env_file_path
    if _env_file_path is None:
        try:
            from MediaHub.utils.system_utils import get_db_directory
            _env_file_path = get_db_directory() / ".env"
        except ImportError:
            if getattr(sys, 'frozen', False):
                base_path = Path(sys.executable).parent
                db_dir = base_path.parent / "db"
            else:
                db_dir = Path(__file__).parent.parent.parent / "db"
            _env_file_path = db_dir / ".env"
            if not _env_file_path.exists():
                _env_file_path = db_dir.parent / ".env"
    return _env_file_path

def should_reload() -> bool:
    global _last_mtime
    env_file = get_env_file_path()
    if not env_file.exists():
        return False
    current_mtime = env_file.stat().st_mtime
    if _last_mtime is None or current_mtime > _last_mtime:
        _last_mtime = current_mtime
        return True
    return False

def reload_env_if_changed() -> bool:
    if not should_reload():
        return False
    try:
        env_file = get_env_file_path()
        if not env_file.exists():
            return False
        with open(env_file, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith('#') or '=' not in line:
                    continue
                key, _, value = line.partition('=')
                key, value = key.strip(), value.strip()
                if value and value[0] in ('"', "'") and value[-1] in ('"', "'"):
                    value = value[1:-1]
                _env_cache[key] = value
                os.environ[key] = value
        return True
    except Exception as e:
        log_message(f"Failed to reload environment variables: {e}", "WARNING")
        return False

def get_env(key: str, default: Optional[str] = None, force_reload: bool = False) -> Optional[str]:
    if force_reload:
        reload_env_if_changed()
    return os.getenv(key, default)
