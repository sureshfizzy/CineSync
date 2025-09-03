import os

def get_env_file_path():
    """Get the path to the .env file, similar to Go implementation."""
    if os.path.exists('/.dockerenv') or os.getenv('CONTAINER') == 'docker':
        return '/app/db/.env'

    cwd = os.getcwd()
    basename = os.path.basename(cwd)

    # Handle both MediaHub and WebDavHub directories (for Python bridge execution)
    if basename == 'MediaHub' or basename == 'WebDavHub':
        parent_dir = os.path.dirname(cwd)
        return os.path.join(parent_dir, 'db', '.env')

    return os.path.join(cwd, 'db', '.env')


def create_env_file_from_environment():
    """Create .env file from current environment variables, similar to Go implementation."""
    env_path = get_env_file_path()
    print(f"Creating .env file from environment variables at: {env_path}")

    # Collect all environment variables
    env_vars = {}
    for key, value in os.environ.items():
        if value:
            env_vars[key] = value

    # Handle Kubernetes-compatible alternative: if _4K_SEPARATION is set but 4K_SEPARATION is not, use _4K_SEPARATION
    if '_4K_SEPARATION' in env_vars and '4K_SEPARATION' not in env_vars:
        env_vars['4K_SEPARATION'] = env_vars['_4K_SEPARATION']

    # If no environment variables found, create with minimal defaults
    if not env_vars:
        print("No environment variables found, creating .env with minimal defaults")
        env_vars = {
            'SOURCE_DIR': '/source',
            'DESTINATION_DIR': '/destination',
            'CINESYNC_LAYOUT': 'true',
            'LOG_LEVEL': 'INFO',
            'CINESYNC_IP': '0.0.0.0',
            'CINESYNC_API_PORT': '8082',
            'CINESYNC_UI_PORT': '5173',
            'CINESYNC_AUTH_ENABLED': 'true',
            'CINESYNC_USERNAME': 'admin',
            'CINESYNC_PASSWORD': 'admin'
        }

    try:
        with open(env_path, 'w') as file:
            file.write("# Configuration file created from Docker environment variables\n\n")

            for key, value in env_vars.items():
                quoted_value = value
                if ' ' in value or '#' in value or '\\' in value or value == '':
                    quoted_value = f'"{value}"'

                file.write(f"{key}={quoted_value}\n")

        print(f"Successfully created .env file with {len(env_vars)} configuration values")
        return True
    except Exception as e:
        print(f"Failed to create .env file: {e}")
        return False


def ensure_env_file_exists():
    """Ensure .env file exists, create it if it doesn't."""
    env_path = get_env_file_path()

    # Check if .env file exists
    if not os.path.exists(env_path):
        print(f".env file not found at {env_path}, creating from environment variables")
        return create_env_file_from_environment()

    # Check if .env file is empty
    if os.path.getsize(env_path) == 0:
        print(f".env file exists but is empty at {env_path}, populating from environment variables")
        return create_env_file_from_environment()

    return True