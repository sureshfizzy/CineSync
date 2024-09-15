#!/bin/bash
set -e

# Function to create group if it doesn't exist
create_group_if_not_exists() {
    if ! getent group appuser > /dev/null 2>&1; then
        groupadd -o -g "$PGID" appuser
    else
        groupmod -o -g "$PGID" appuser
    fi
}

# Function to create user if it doesn't exist
create_user_if_not_exists() {
    if ! id -u appuser > /dev/null 2>&1; then
        useradd -o -u "$PUID" -g appuser appuser
    else
        usermod -o -u "$PUID" -g appuser appuser
    fi
}

# Create or modify group and user
create_group_if_not_exists
create_user_if_not_exists

# Ensure the app directory and its contents are owned by the appuser
chown -R appuser:appuser /app

# Change to the app directory
cd /app

# Run the command as the appuser
exec gosu appuser "$@"
