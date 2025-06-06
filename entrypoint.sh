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
mkdir -p /app/db /app/logs /app/cache 2>/dev/null || true
chown -R appuser:appuser /app/db 2>/dev/null || true
chown -R appuser:appuser /app/logs 2>/dev/null || true
chown -R appuser:appuser /app/cache 2>/dev/null || true

# Frontend directory
if [ -d "/app/WebDavHub/frontend" ]; then
    find /app/WebDavHub/frontend -path "*/node_modules" -prune -o -type f -exec chown appuser:appuser {} \; 2>/dev/null || true
    find /app/WebDavHub/frontend -path "*/node_modules" -prune -o -type d -exec chown appuser:appuser {} \; 2>/dev/null || true
fi

# Execute command as appuser
exec gosu appuser "$@"
