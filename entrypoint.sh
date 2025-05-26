#!/bin/bash
set -e

# Default values
PUID=${PUID:-1000}
PGID=${PGID:-1000}

# Function to update group if needed
update_group() {
    local current_gid
    current_gid=$(getent group appuser | cut -d: -f3)

    if [ "$current_gid" != "$PGID" ]; then
        echo "Updating appuser group GID from $current_gid to $PGID"
        groupmod -o -g "$PGID" appuser
    fi
}

# Function to update user if needed
update_user() {
    local current_uid
    current_uid=$(id -u appuser)

    if [ "$current_uid" != "$PUID" ]; then
        echo "Updating appuser UID from $current_uid to $PUID"
        usermod -o -u "$PUID" appuser

        # Fix ownership after UID change
        echo "Fixing file ownership..."
        find /app -user "$current_uid" -exec chown appuser:appuser {} \; 2>/dev/null || true
    fi
}

# Update user and group if needed
update_group
update_user

# Ensure critical directories have correct ownership
chown -R appuser:appuser /app 2>/dev/null || {
    echo "Warning: Could not change ownership of all files in /app"
    echo "This might be expected if mounting volumes"
}

# Change to app directory
cd /app

# Execute command as appuser
echo "Starting application as appuser (UID: $PUID, GID: $PGID)"
exec gosu appuser "$@"
