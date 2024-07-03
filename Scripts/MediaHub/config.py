import os
from dotenv import load_dotenv

def load_config():
    dotenv_path = os.path.join(os.path.dirname(__file__), '../..', '.env')
    load_dotenv(dotenv_path)

    config = {
        'LOG_LEVEL': os.getenv('LOG_LEVEL', 'INFO').upper(),
        'TMDB_API_KEY': os.getenv('TMDB_API_KEY'),
        'SOURCE_DIR': os.getenv('SOURCE_DIR'),
        'DESTINATION_DIR': os.getenv('DESTINATION_DIR'),
        'TMDB_FOLDER_ID': os.getenv('TMDB_FOLDER_ID', 'true').lower() in ['true', '1', 'yes'],
        'RENAME_ENABLED': os.getenv('RENAME_ENABLED', 'false').lower() in ['true', '1', 'yes'],
        'OVERRIDE_STRUCTURE': os.getenv('OVERRIDE_STRUCTURE', 'true').lower() in ['true', '1', 'yes']
    }
    return config

def get_directories(config):
    src_dirs = config['SOURCE_DIR']
    dest_dir = config['DESTINATION_DIR']
    if not src_dirs or not dest_dir:
        return None, None
    return src_dirs.split(','), dest_dir
