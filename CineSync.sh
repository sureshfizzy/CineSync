#!/bin/bash

# Source directory for TV shows
show_source_dir="/path/to/zurg/shows"

# Destination directory
destination_dir="/path/to/destination"

# Check if the target directory exists
if [ ! -d "$destination_dir" ]; then
    echo "Destination directory '$destination_dir' does not exist."
    exit 1
fi

# Function to check all symlinks in the destination directory and save their target paths to a log file
check_symlinks_in_destination() {
    echo "Checking symlinks in destination directory..."
    find "$destination_dir" -type l -exec readlink -f {} + > check.log
    echo "Symlinks in destination directory checked and saved to check.log"
}

# Function to create symlinks for .mkv or .mp4 files in the source directory
create_symlinks_in_source_dir() {
    local folder="$1"
    local series_name
    local season_folder

    # Extract series name and season number from folder name
    if [[ $folder =~ (.*)[Ss]([0-9]+) ]]; then
        series_name=$(basename "${BASH_REMATCH[1]}")  # Extracting just the series name
        # Remove any trailing spaces and hyphens
        series_name=$(echo "$series_name" | sed 's/[[:space:]]*$//;s/-*$//')
        # Remove the year in parentheses
        series_name=$(echo "$series_name" | sed 's/([[:digit:]]{4})//')
        # Remove the 'Season X' part
        series_name=$(echo "$series_name" | sed 's/Season [0-9]\+//')
        # Replace '.' with spaces in series name
        series_name="${series_name//./ }"
        # Convert series name to title case
        series_name="$(echo "$series_name" | awk '{for(i=1;i<=NF;i++)sub(/./,toupper(substr($i,1,1)),$i)}1')"
        season_number="${BASH_REMATCH[2]}"
        # Convert season number to have leading zeros if necessary
        season_folder="Season $(printf %02d "$season_number")"
    else
        echo "Error: Unable to determine series name and season number for $folder."
        return 1
    fi

    # Check if the series name exists without the year and season info
    local destination_series_dir="$destination_dir/$series_name"
    if [ -d "$destination_series_dir" ]; then
        echo "Folder '$series_name' exists. Placing files inside."
    else
        echo "Folder '$series_name' does not exist. Files will be placed in '$series_name'."
        # Remove year from series name for destination directory
        destination_series_dir="$destination_dir/$series_name"
        destination_series_dir=$(echo "$destination_series_dir" | sed 's/ ([[:digit:]]\{4\})//')
        echo "Destination series directory: $destination_series_dir"
    fi

    # Iterate through files in the folder
    shopt -s nullglob
    for file in "$folder"/*.mkv "$folder"/*.mp4; do
        local filename=$(basename "$file")
        local destination_file="$destination_series_dir/$season_folder/$filename"

        # Check if a symlink with the same target exists
        if grep -qF "$file" test.log; then
            echo "Symlink already exists for $filename with the same target."
        else
            echo "No symlink exists with the same target."
            mkdir -p "$(dirname "$destination_file")"
            ln -s "../../$(realpath --relative-to="$(dirname "$destination_file")" "$file")" "$destination_file"
            echo "Symlink created: $file -> $destination_file"
        fi
    done
}

# Call function to check symlinks in destination directory
check_symlinks_in_destination

# Find directories in the source show directory and create symlinks for files within them
echo "Creating symlinks for TV shows from source to destination directory..."
shopt -s nullglob
for folder in "$show_source_dir"/*; do
    if [ -d "$folder" ]; then
        create_symlinks_in_source_dir "$folder"
    fi
done