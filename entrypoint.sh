#!/bin/bash
set -e

# Function to create or modify group
create_or_modify_group() {
    if getent group appuser > /dev/null 2>&1; then
        groupmod -o -g "$PGID" appuser > /dev/null 2>&1
    else
        groupadd -o -g "$PGID" appuser > /dev/null 2>&1
    fi
}

# Function to create or modify user
create_or_modify_user() {
    if id appuser > /dev/null 2>&1; then
        usermod -o -u "$PUID" -g appuser appuser > /dev/null 2>&1
    else
        useradd -o -u "$PUID" -g appuser appuser > /dev/null 2>&1
    fi
}

# Create or modify group and user
create_or_modify_group
create_or_modify_user

# Ensure the app directory and its contents are owned by the appuser
chown -R appuser:appuser /app

# Change to the app directory
cd /app

# Run the command as the appuser
exec gosu appuser "$@"
