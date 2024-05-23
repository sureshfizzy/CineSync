#!/bin/bash

# Check the operating system
os=$(uname -s)

# Source directory for TV shows
show_source_dir="/path/to/zurg/shows"

# Destination directory
destination_dir="/path/to/destination"

# Log directory
log_dir="logs"

# Log file for existing folder names in the destination directory
names_log="$log_dir/folder_names.log"

# Check if the target directory exists
if [ ! -d "$destination_dir" ]; then
    echo "Destination directory '$destination_dir' does not exist."
    exit 1
fi

# Function to check all symlinks in the destination directory and save their target paths to a log file
check_symlinks_in_destination() {
    echo "Checking symlinks in destination directory..."
    if [[ "$os" == "MINGW"* || "$os" == "MSYS"* ]]; then
        while IFS= read -r symlink; do
            target=$(readlink "$symlink")
            windows_path=$(cygpath -w "$target" | sed 's/\\/\//g')
            echo "$windows_path"
        done < <(find "$destination_dir" -type l) > "$log_dir/symlinks.log"
    else
        find "$destination_dir" -type l -exec readlink -f {} + > "$log_dir/symlinks.log"
    fi
    echo "Symlinks in destination directory checked and saved to $log_dir/symlinks.log"
}

# Function to log existing folder names in the destination directory
log_existing_folder_names() {
    echo "Logging existing folder names in destination directory..."
    if [[ "$(uname -s)" == "MINGW"* || "$(uname -s)" == "MSYS"* ]]; then
        find "$destination_dir" -mindepth 1 -maxdepth 1 -type d -exec realpath {} + > "$names_log"
    else
        if [ -f "$names_log" ]; then
            # Remove existing log file to regenerate with full paths
            rm "$names_log"
        fi
        # Log all existing folder paths in the destination directory
        find "$destination_dir" -mindepth 1 -maxdepth 1 -type d > "$names_log"
    fi
    echo "Existing folder names in destination directory logged to $names_log"
}

# Function to create symlinks for .mkv or .mp4 files in the source directory
create_symlinks_in_source_dir() {
    local folder="$1"
    local target_file="$2"
    local series_info
    local series_name
    local series_year
    folder=$(echo "$folder" | sed 's/\\/\//g')
    target_file=$(echo "$target_file" | sed 's/\\/\//g')

    #Skip target if a RAR file is detected
    if [[ "${target_file}" =~ \.r[^/]*$ ]]; then
      echo "Skipping RAR file: $target_file"
      if ! grep -qFx "$target_file" "$log_dir/skipped_rar_files.log"; then
        echo "$target_file" >> "$log_dir/skipped_rar_files.log"
      fi
      return 0
    fi

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
        series_name=$(echo "$series_name" | sed -e "s/Season [0-9]\+//" -e "s/SEASON [0-9]\+//" -e "s/SEASON[.[:digit:]]*//" -e "s/\(\b\|[^0-9]\)S\([0-9]\)/\1 S\2/g" -e "s/S01\.[[:space:]]*-[[:space:]]*//" -e "s/S01//" -e "s/^[[:space:]]*//" -e "s/\s*-*$//" -e "s/^'\(.*\)'$/\1/")
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
    destination_series_dir=$(echo "$destination_series_dir" | sed 's/ -[0-9]\+$//' | tr -d '\n')
    local found_in_log=$(grep "$series_name" "$names_log" | head -n 1)
    if grep -qF "$destination_series_dir" "$names_log"; then
        destination_series_dir="$found_in_log"
        echo "Folder '$series_name' exists in $names_log (refers to: $found_in_log). Placing files inside."
    else
        # Search for variations of the series name with different spacings and abbreviations
        local series_name_pattern=$(echo "$series_name" | sed 's/ / */g')
        series_name_pattern=$(echo "$series_name_pattern" | sed 's/P[[:space:]]*d/P[[:space:]]*d|P[[:space:]]+d/' | sed 's/P[[:space:]]*D/P[[:space:]]*D|P[[:space:]]+D/' | sed 's/[0-9]\{4\}//')
        found_in_log=$(grep -iE "$series_name_pattern" "$names_log" | head -n 1)
        if [ -n "$found_in_log" ]; then
            destination_series_dir="$found_in_log"
            echo "Folder '$series_name' exists in $names_log (refers to: $found_in_log). Placing files inside."
        else
            echo "Folder '$series_name' does not exist in names.log. Files will be placed in '$series_name'."
            # If the series name doesn't exist in the log, create a new folder
            mkdir -p "$destination_series_dir"
            echo "$destination_series_dir" >> "$names_log"
            echo "New series folder '$series_name' created in the destination directory and added to names.log."
        fi
    fi

    # If the target file is empty, create symlinks for all files in the directory
    if [ -z "$target_file" ]; then
        shopt -s nullglob
        for file in "$folder"/*; do
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
                if grep -qF "$file" "$log_dir/symlinks.log"; then
                    echo "Symlink already exists for $filename with the same target."
                else
                    echo "No symlink exists with the same target."
                    mkdir -p "$(dirname "$destination_file")"
                    ln -s "$file" "$destination_file"
                    echo "Symlink created: $file -> $destination_file"
                fi
            done
        done
    else
        # Extract season number and episode number from the target file name
        local series_season
        local episode_number
        if [[ $target_file =~ [Ss]([0-9]+)[Ee]([0-9]+) ]]; then
            series_season="${BASH_REMATCH[1]}"
            episode_number="${BASH_REMATCH[2]}"
        else
            echo "Error: Unable to extract season and episode information from $target_file."
            return 1
        fi

        local season_folder="Season $(printf "%02d" "$series_season")"
        local destination_file="$destination_series_dir/$season_folder/$target_file"

        # Check if a symlink with the same target exists
        if grep -qF "$target_file" "$log_dir/symlinks.log"; then
            echo "Symlink already exists for $target_file with the same target."
        else
            echo "No symlink exists with the same target."
            mkdir -p "$(dirname "$destination_file")"
            ln -s "$folder/$target_file" "$destination_file"
            echo "Symlink created: $folder/$target_file -> $destination_file"
        fi
    fi
}

# Function to symlink a specific file or folder
symlink_specific_file_or_folder() {
    local target="$1"
    if [[ "${target}" =~ \.r[^/]*$ ]]; then
      echo "Skipping RAR file: $target"
      if ! grep -qFx "$target" "$log_dir/skipped_rar_files.log"; then
        echo "$target" >> "$log_dir/skipped_rar_files.log"
      fi
      return 0
    fi

    if [ -e "$target" ]; then
        local filename=$(basename "$target")
        local destination_file="$destination_dir/$filename"
        if [ -L "$destination_file" ]; then
            echo "A symlink already exists for $filename in the destination directory."
        else
            ln -s "$target" "$destination_file"
            echo "Symlink created: $target -> $destination_file"
        fi
    else
        echo "Error: $target does not exist."
    fi
}

cleanup() {
    echo "Removing .r files from the destination directory..."
    find "$destination_dir" -type f -name "*.r*" -exec rm {} +
    echo "All .r files removed from the destination directory."

    echo "Removing empty directories from the destination directory..."
    find "$destination_dir" -mindepth 1 -type d -empty -delete
    echo "Empty directories removed from the destination directory."
}

# Call function to check symlinks in destination directory

check_symlinks_in_destination

# Create log directory if it doesn't exist
mkdir -p "$log_dir"

# Log existing folder names in the destination directory
log_existing_folder_names

# If no arguments provided, create symlinks for all files in the source directory
if [ $# -eq 0 ]; then
    echo "Creating symlinks for all files in source directory..."
    for entry in "$show_source_dir"/*; do
        if [ -d "$entry" ]; then
            create_symlinks_in_source_dir "$entry"
        elif [ -f "$entry" ]; then
            symlink_specific_file_or_folder "$entry"
        fi
    done
else
    # If a file or folder name is provided as an argument, symlink it
    if [ $# -eq 1 ]; then
        target="$1"
        if [ -d "$target" ]; then
            echo "The provided argument is a directory. Organizing according to TV show conventions..."
            create_symlinks_in_source_dir "$target" ""
        elif [ -f "$target" ]; then
            echo "The provided argument is a file. Organizing it accordingly..."
            folder=$(dirname "$target")
            create_symlinks_in_source_dir "$folder" "$(basename "$target")"
        else
            echo "Error: The provided argument is neither a file nor a directory."
            exit 1
        fi
    else
        echo "Error: Invalid number of arguments. Usage: sudo bash fish.sh [directory/file_path]"
        exit 1
    fi
fi

# Clean up: Remove empty folders and files with .r extension
cleanup