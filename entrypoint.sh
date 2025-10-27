#!/bin/sh
set -e

# Default values
PUID=${PUID:-1000}
PGID=${PGID:-1000}

# Update user/group IDs if they differ from current values
current_uid=$(id -u appuser)
current_gid=$(id -g appuser)

if [ "$PUID" != "$current_uid" ] || [ "$PGID" != "$current_gid" ]; then
    # Update group ID
    groupmod -o -g "$PGID" appuser

    # Update user ID
    usermod -o -u "$PUID" appuser
fi

# Ensure critical directories exist and have proper ownership
mkdir -p /app/db /app/logs /app/db/cache /app/.config 2>/dev/null || true
chown -R appuser:appuser /app/db 2>/dev/null || true
chown -R appuser:appuser /app/logs 2>/dev/null || true
chown -R appuser:appuser /app/.config 2>/dev/null || true

# Ensure .env file can be created by appuser
touch /app/db/.env 2>/dev/null || true
chown appuser:appuser /app/db/.env 2>/dev/null || true
chmod 644 /app/db/.env 2>/dev/null || true

# Ensure config file can be created by appuser
touch /app/db/config.yml 2>/dev/null || true
chown appuser:appuser /app/db/config.yml 2>/dev/null || true
chmod 644 /app/db/config.yml 2>/dev/null || true

# Frontend directory 
if [ -d "/app/WebDavHub/frontend" ]; then
    find /app/WebDavHub/frontend -name "node_modules" -prune -o -type f -exec chown appuser:appuser {} \; 2>/dev/null || true
    find /app/WebDavHub/frontend -name "node_modules" -prune -o -type d -exec chown appuser:appuser {} \; 2>/dev/null || true

    # Ensure the frontend directory itself is owned by appuser
    chown appuser:appuser /app/WebDavHub/frontend 2>/dev/null || true

    # Create only the specific vite temp directory that's needed
    if [ -d "/app/WebDavHub/frontend/node_modules" ]; then
        mkdir -p /app/WebDavHub/frontend/node_modules/.vite-temp 2>/dev/null || true
        chown -R appuser:appuser /app/WebDavHub/frontend/node_modules/.vite-temp 2>/dev/null || true
        chmod 755 /app/WebDavHub/frontend/node_modules/.vite-temp 2>/dev/null || true
    fi
fi

# Execute command as appuser
exec gosu appuser "$@"
