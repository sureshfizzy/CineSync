#!/bin/bash

# Check the operating system
os=$(uname -s)

# Source directory for TV shows
show_source_dir="/path/to/zurg/shows"

# Destination directory
destination_dir="/path/to/destination"

# Log file for existing folder names in the destination directory
names_log="names.log"

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

# Function to log existing folder names in the destination directory
log_existing_folder_names() {
    echo "Logging existing folder names in destination directory..."
    # Check if the operating system is Windows
    if [[ "$(uname -s)" == "MINGW"* || "$(uname -s)" == "MSYS"* ]]; then
        find "$destination_dir" -mindepth 1 -maxdepth 1 -type d -exec realpath {} + > "$names_log"
    else
        find "$destination_dir" -mindepth 1 -maxdepth 1 -type d -exec basename {} + > "$names_log"
    fi
    echo "Existing folder names in destination directory logged to $names_log"
}


# Function to create symlinks for .mkv or .mp4 files in the source directory
create_symlinks_in_source_dir() {
    local folder="$1"
    local series_info
    local series_name
    local series_year

    # Extract series name and year from folder name
    if [[ $folder =~ (.*)[Ss]([0-9]+).*[0-9]{3,4}p.* ]]; then

        series_info="${BASH_REMATCH[1]}"
        series_year=$(echo "$series_info" | grep -oE '[[:digit:]]{4}' | tail -1)
        series_name=$(basename "$series_info")  # Extracting just the series name
        series_name=$(basename "$series_info" | tr -d '\n')  # Removing any trailing newline characters
        series_name=$(echo "$series_name" | sed 's/ -[0-9]\+$//') 
        # Remove any trailing spaces and hyphens
        series_name=$(echo "$series_name" | sed 's/[[:space:]]*$//;s/-*$//')
        # Remove the 'Season X' part
        series_name=$(echo "$series_name" | sed 's/Season [0-9]\+//')
        # Remove 'S0X' from the series name
        series_name=$(echo "$series_name" | sed -e "s/Season [0-9]\+//" -e "s/SEASON [0-9]\+//" -e "s/SEASON[.[:digit:]]*//" -e "s/\.S[[:digit:]]*//" -e "s/S01//" -e "s/^[[:space:]]*//" -e "s/^'\(.*\)'$/\1/")

        series_name=$(echo "$series_name" | sed "s/'//g; s/[()]//g")
        # Replace '.' with spaces in series name
        series_name="${series_name//./ }"
        # Convert series name to title case
        series_name="$(echo "$series_name" | awk '{for(i=1;i<=NF;i++)sub(/./,toupper(substr($i,1,1)),$i)}1')"
    else
        echo "Error: Unable to determine series name for $folder."
        return 1
    fi

    # Check if the series name exists without the year and season info
    local destination_series_dir="$destination_dir/$series_name"
    #destination_series_dir=$(echo "$destination_series_dir" | sed 's/ -[0-9]\+$//')
    destination_series_dir=$(echo "$destination_series_dir" | sed 's/ -[0-9]\+$//' | tr -d '\n')
    #local found_in_log=$(grep -F "$destination_series_dir" "$names_log")
    local found_in_log=$(grep "$series_name" "$names_log" | head -n 1)
    #if grep -qF "$destination_series_dir" "$names_log"; then
    if [ -n "$found_in_log" ]; then
        destination_series_dir="$found_in_log"
        echo "Folder '$series_name' exists in names.log (refers to: $found_in_log). Placing files inside."
    else
        # Search for variations of the series name with different spacings and abbreviations
        local series_name_pattern=$(echo "$series_name" | sed 's/ / */g')
        series_name_pattern=$(echo "$series_name_pattern" | sed 's/P[[:space:]]*d/P[[:space:]]*d|P[[:space:]]+d/' | sed 's/P[[:space:]]*D/P[[:space:]]*D|P[[:space:]]+D/' | sed 's/[0-9]\{4\}//')
        found_in_log=$(grep -iE "$series_name_pattern" "$names_log" | head -n 1)
        if [ -n "$found_in_log" ]; then
            destination_series_dir="$found_in_log"
            echo "Folder '$series_name' exists in names.log (refers to: $found_in_log). Placing files inside."
        else
            echo "Folder '$series_name' does not exist in names.log. Files will be placed in '$series_name'."
            # If the series name doesn't exist in the log, create a new folder
            mkdir -p "$destination_series_dir"
            echo "$destination_series_dir" >> "$names_log"
            echo "New series folder '$series_name' created in the destination directory and added to names.log."
        fi
    fi

    # Iterate through files in the folder
    shopt -s nullglob
    for file in "$folder"/*.mkv "$folder"/*.mp4; do
        local filename=$(basename "$file")
        local season_folders=()
        local series_season

        # Extract season number from filename
        if [[ $filename =~ [Ss]([0-9]+) ]]; then
            series_season="${BASH_REMATCH[1]}"
            season_folders+=("Season $(echo "$series_season" | awk '{printf "%02d", $1}')")
        fi

        # Create symlinks for each season found
        for season_folder in "${season_folders[@]}"; do
            local destination_file="$destination_series_dir/$season_folder/$filename"

            # Check if a symlink with the same target exists
            if grep -qF "$file" check.log; then
                echo "Symlink already exists for $filename with the same target."
            else
                echo "No symlink exists with the same target."
                mkdir -p "$(dirname "$destination_file")"
                ln -s "$file" "$destination_file"
                echo "Symlink created: $file -> $destination_file"
            fi
        done
    done
}

# Function to recursively search for folders containing TV show seasons and create symlinks
search_and_create_symlinks() {
    local directory="$1"
    shopt -s nullglob
    for folder in "$directory"/*; do
        if [ -d "$folder" ]; then
            # Check if the folder contains season folders
            if ls "$folder" | grep -q '[Ss][0-9]\{2\}'; then
                create_symlinks_in_source_dir "$folder"
            else
                # Recursively search for subfolders
                search_and_create_symlinks "$folder"
            fi
        fi
    done
}

# Call function to check symlinks in destination directory
if [[ "$(uname -s)" != "MINGW"* && "$(uname -s)" != "MSYS"* ]]; then
    check_symlinks_in_destination
else
    echo "Skipping symlink check on Windows OS."
fi

# Log existing folder names in the destination directory
log_existing_folder_names

# Search for folders containing TV show seasons and create symlinks
echo "Creating symlinks for TV shows from source to destination directory..."
search_and_create_symlinks "$show_source_dir"