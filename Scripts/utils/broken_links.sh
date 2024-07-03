#!/bin/bash

# Get the directory of the script
SCRIPT_DIR=$(dirname "$(realpath "$0" | sed 's/\\/\//g')")

# Define the BrokenLinkVault folder path relative to the script directory
BROKEN_LINKS_FOLDER="$SCRIPT_DIR/../BrokenLinkVault"
CONFIG_FILE="$BROKEN_LINKS_FOLDER/broken_links_config.txt"
LOGS_FOLDER="logs"

# Create the Broken_links folder if it doesn't exist
mkdir -p "$BROKEN_LINKS_FOLDER"
mkdir -p "$BROKEN_LINKS_FOLDER/$LOGS_FOLDER"

# Read directories from the configuration file
directories=()

# Check if the configuration file exists
if [ -f "$CONFIG_FILE" ]; then
    # Read directories from the configuration file
    while IFS= read -r line; do
        # Replace backslashes with forward slashes
        directory=$(echo "$line" | sed 's/\\/\//g')
        directories+=("$directory")
    done < "$CONFIG_FILE"

    for directory in "${directories[@]}"; do
        cd "$directory" || { echo "Failed to change directory to $directory"; continue; }

        # Find and display broken symlinks, then save to a log file
        broken_links=$(find . -type l -xtype l)
        if [ -n "$broken_links" ]; then
            log_file="$BROKEN_LINKS_FOLDER/$LOGS_FOLDER/$(basename "$directory").log"
            echo "Broken symlinks in $directory:" > "$log_file"
            find . -type l -xtype l -exec ls -l {} + >> "$log_file"
            echo "Broken symlinks in $directory have been logged to $log_file."

            # Delete broken symlinks
            find . -type l -xtype l -delete
        else
            echo "No broken symlinks found in $directory."
        
        fi
    done

else
    echo "Configuration file not found: $CONFIG_FILE"
    exit 1
fi
