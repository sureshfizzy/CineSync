#!/bin/bash

# Check the operating system
os=$(uname -s)

# Configuration
LOG_DIR="logs"
LOG_FILE="$LOG_DIR/script.log"
LOG_LEVEL="INFO"  # Default log level (DEBUG, INFO, WARNING, ERROR)

# Function to log messages
log_message() {
    local message="$1"
    local log_level="$2"
    local destination="$3"  # 'stdout' or 'file'

    if [[ ("$log_level" == "DEBUG" && "$LOG_LEVEL" == "DEBUG") ||
          "$log_level" == "INFO" || "$log_level" == "WARNING" || "$log_level" == "ERROR" ]]; then
        if [[ "$destination" == "file" ]]; then
            # Create log directory if it doesn't exist
            mkdir -p "$LOG_DIR"
            echo "$(date +'%Y-%m-%d %H:%M:%S') [$log_level] - $message" >> "$LOG_FILE"
        elif [[ "$destination" == "stdout" ]]; then
            echo "$(date +'%Y-%m-%d %H:%M:%S') [$log_level] - $message"
        else
            echo "Invalid log destination: $destination"
        fi
    elif [[ "$log_level" != "DEBUG" ]]; then
        echo "Invalid log level: $log_level"
    fi
}

# Function to enable logging based on user preference
enable_logging() {
    local log_level="$1"
    local destination="$2"
    if [[ "$log_level" == "DEBUG" || "$log_level" == "INFO" || "$log_level" == "WARNING" || "$log_level" == "ERROR" ]]; then
        LOG_LEVEL="$log_level"
        log_message "Logging enabled with log level: $LOG_LEVEL" "INFO" "$destination"
    else
        log_message "Invalid log level specified. Logging remains disabled." "ERROR" "stdout"
    fi
}

# Check if logging is enabled
if [[ "$1" == "--enable-logging" ]]; then
    enable_logging "$2" "file"  # Enable logging to file with specified log level
    shift 2  # Shift command-line arguments
else
    log_message "Logging disabled." "INFO" "stdout"
fi

# Source directory for TV shows
show_source_dir="/path/to/zurg/shows"
log_message "Source directory for TV shows: $show_source_dir" "DEBUG" "stdout"

# Destination directory
destination_dir="/path/to/destination"
log_message "Destination directory: $destination_dir" "DEBUG" "stdout"

# Log directory
log_dir="logs"
log_message "Log directory: $log_dir" "DEBUG" "stdout"

# Log file for existing folder names in the destination directory
names_log="$log_dir/folder_names.log"
log_message "Log file for existing folder names: $names_log" "DEBUG" "stdout"

# Check if the target directory exists
if [ ! -d "$destination_dir" ]; then
    log_message "Destination directory '$destination_dir' does not exist." "DEBUG" "stdout"
	mkdir -p $destination_dir
	log_message "Destination directory '$destination_dir' created." "DEBUG" "stdout"
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
    log_message "Symlinks in destination directory checked and saved to $log_dir/symlinks.log" "INFO" "stdout"
}

# Function to log existing folder names in the destination directory
log_existing_folder_names() {
    log_message "Logging existing folder names in destination directory..." "INFO" "stdout"
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
    log_message "Existing folder names in destination directory logged to $names_log" "INFO" "stdout"
}

# Function to create symlinks for .mkv or .mp4 files in the source directory
organize_media_files() {
    local folder="$1"
    local target_file="$2"
    local target="$3"
    local series_info
    local series_name
    local series_year
    folder=$(echo "$folder" | sed 's/\\/\//g')
    target_file=$(echo "$target_file" | sed 's/\\/\//g')

    #Skip target if a RAR file is detected
    if [[ "${target_file}" =~ \.r[^/]*$ ]]; then
      log_message "Skipping RAR file: $target_file" "WARNING" "stdout"
      if ! grep -qFx "$target_file" "$log_dir/skipped_rar_files.log"; then
        echo "$target_file" >> "$log_dir/skipped_rar_files.log"
      fi
      return 0
    fi

    # Extract series name and year from folder name or target file
    if [[ $folder =~ (.*)[Ss]([0-9]+).*[0-9]{3,4}p.* ||
          $folder =~ (.*)[Ss]([0-9]+)[[:space:]].* ||
          $folder =~ (.*)\[([0-9]+)x([0-9]+)\].* ||
          $folder =~ (.*)\.S([0-9]+)E([0-9]+)\. ||
          $folder =~ (.*)\.S([0-9]+)-S([0-9]+)\.[[:alnum:]]+.* ||
          $target_file =~ (.*)[Ss]([0-9]+).*[0-9]{3,4}p.* ||
          $target_file =~ (.*)[Ss]([0-9]+)[[:space:]].* ||
          $target_file =~ (.*)\[([0-9]+)x([0-9]+)\].* ||
          $target_file =~ (.*)\.S([0-9]+)E([0-9]+)\. ||
          $target_file =~ (.*)\.S([0-9]+)-S([0-9]+)\.[[:alnum:]]+.* ]]; then

        series_info="${BASH_REMATCH[1]}"
        series_name="${series_info%%[Ss][0-9]*}"
        series_name=$(echo "$series_info" | sed -E 's/.*\/([^/]+)$/\1/')
        series_name=$(echo "$series_name" | sed -e 's/[0-9]\+[[:space:]]*p.*//' -e 's/[[:space:]]*$//;s/-*$//')
        series_name=$(basename "$series_name")
        series_year=$(echo "$folder" | grep -oE '[0-9]{4}')
        series_year=$(echo "$series_info" | grep -oE '\b[0-9]{4}\b' | tail -1)
        series_name=$(echo "$series_name" | sed -e 's/\[.*//' -e 's/ -[0-9]\+$//')
        series_name=$(echo "$series_name" | sed 's/[[:space:]]*$//;s/-*$//')
        series_name=$(echo "$series_name" | sed 's/Season [0-9]\+//')
        series_name=$(echo "$series_name" | sed -e "s/Season [0-9]\+//" \
                                       -e "s/SEASON [0-9]\+//" \
                                       -e "s/SEASON[.[:digit:]]*//" \
                                       -e "s/\(\b\|[^0-9]\)S\([0-9]\)/\1 S\2/g" \
                                       -e "s/S01\.[[:space:]]*-[[:space:]]*//" \
                                       -e "s/S01//" \
                                       -e "s/English//" \
                                       -e "s/^[[:space:]]*//" \
                                       -e "s/^'\(.*\)'$/\1/" )
        series_name=$(echo "$series_name" | sed "s/'//g; s/[()]//g")
        series_name="${series_name//./ }"
        series_name=$(echo "$series_name" | sed 's/(.*)//')
        series_name="$(echo "$series_name" | awk '{for(i=1;i<=NF;i++)sub(/./,toupper(substr($i,1,1)),$i)}1')"
    else
        log_message "Error: Unable to determine series name for $folder." "ERROR" "stdout"
        return 1
    fi

    # Check if the series name exists without the year and season info
    local destination_series_dir="$destination_dir/$series_name"
    destination_series_dir=$(echo "$destination_series_dir" | sed 's/ -[0-9]\+$//' | tr -d '\n')
    local found_in_log=$(grep "$series_name" "$names_log" | head -n 1)
    if grep -qF "$destination_series_dir" "$names_log"; then
        destination_series_dir="$found_in_log"
        log_message "Folder '$series_name' exists in $names_log (refers to: $found_in_log). Placing files inside." "INFO" "stdout"
    else
        # Search for variations of the series name with different spacings and abbreviations
        local series_name_pattern=$(echo "$series_name" | sed 's/ / */g')
        series_name_pattern=$(echo "$series_name_pattern" | sed 's/P[[:space:]]*d/P[[:space:]]*d|P[[:space:]]+d/' | sed 's/P[[:space:]]*D/P[[:space:]]*D|P[[:space:]]+D/' | sed 's/[0-9]\{4\}//')
        found_in_log=$(grep -iE "$series_name_pattern" "$names_log" | head -n 1)
        if [ -n "$found_in_log" ]; then
            destination_series_dir="$found_in_log"
            log_message "Folder '$series_name' exists in $names_log (refers to: $found_in_log). Placing files inside." "INFO" "stdout"
        else
            log_message "Folder '$series_name' does not exist in names.log. Files will be placed in '$series_name'." "INFO" "stdout"
            # If the series name doesn't exist in the log, create a new folder
            mkdir -p "$destination_series_dir"
            echo "$destination_series_dir" >> "$names_log"
            log_message "New series folder '$series_name' created in the destination directory and added to names.log." "INFO" "stdout"
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
                    log_message "Symlink already exists for $filename with the same target." "DEBUG" "stdout"
                else
                    log_message "No symlink exists with the same target." "DEBUG" "stdout"
                    mkdir -p "$(dirname "$destination_file")"
                    ln -s "$file" "$destination_file"
                    log_message "Symlink created: $file -> $destination_file" "DEBUG" "stdout"
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
            log_message "Error: Unable to extract season and episode information from $target_file." "ERROR" "stdout"
            return 1
        fi

        local season_folder="Season $(printf "%02d" "$series_season")"
        local destination_file="$destination_series_dir/$season_folder/$target_file"

        # Check if a symlink with the same target exists
        if grep -qF "$target_file" "$log_dir/symlinks.log"; then
            log_message "Symlink already exists for $target_file with the same target." "DEBUG" "stdout"
        else
            log_message "No symlink exists with the same target." "DEBUG" "stdout"
            mkdir -p "$(dirname "$destination_file")"
            ln -s "$folder/$target_file" "$destination_file"
            log_message "Symlink created: $folder/$target_file -> $destination_file" "DEBUG" "stdout"
        fi
    fi
}

# Function to symlink a specific file or folder
symlink_specific_file_or_folder() {
    local target="$1"
    if [[ "${target}" =~ \.r[^/]*$ ]]; then
      log_message "Skipping RAR file: $target" "WARNING" "stdout"
      if ! grep -qFx "$target" "$log_dir/skipped_rar_files.log"; then
        echo "$target" >> "$log_dir/skipped_rar_files.log"
      fi
      return 0
    fi

    if [ -e "$target" ]; then
        local filename=$(basename "$target")
        local destination_file="$destination_dir/$filename"
        if [ -L "$destination_file" ]; then
            log_message "A symlink already exists for $filename in the destination directory." "DEBUG" "stdout"
        else
            ln -s "$target" "$destination_file"
            log_message "Symlink created: $target -> $destination_file" "DEBUG" "stdout"
        fi
    else
        log_message "Error: $target does not exist." "ERROR" "stdout"
    fi
}

cleanup() {
    log_message "Removing .r files from the destination directory..." "DEBUG" "stdout"
    find "$destination_dir" -type f -name "*.r*" -exec rm {} +
    log_message "All .r files removed from the destination directory." "DEBUG" "stdout"

    log_message "Removing empty directories from the destination directory..." "INFO" "stdout"
    find "$destination_dir" -mindepth 1 -type d -empty -delete
    log_message "Empty directories removed from the destination directory." "INFO" "stdout"
}

# Call function to check symlinks in destination directory

check_symlinks_in_destination

# Create log directory if it doesn't exist
mkdir -p "$log_dir"

# Log existing folder names in the destination directory
log_existing_folder_names

# If no arguments provided, create symlinks for all files in the source directory
if [ $# -eq 0 ]; then
    log_message "Creating symlinks for all files in source directory..." "INFO" "stdout"
    for entry in "$show_source_dir"/*; do
        if [ -d "$entry" ]; then
            organize_media_files "$entry"
        elif [ -f "$entry" ]; then
            symlink_specific_file_or_folder "$entry"
        fi
    done
else
    # If a file or folder name is provided as an argument, symlink it
    if [ $# -eq 1 ]; then
        target="$1"
        if [ -d "$target" ]; then
            log_message "The provided argument is a directory. Organizing according to TV show conventions..." "INFO" "stdout"
            organize_media_files "$target" ""
        elif [ -f "$target" ]; then
            log_message "The provided argument is a file. Organizing it accordingly..." "INFO" "stdout"
            folder=$(dirname "$target")
            organize_media_files "$folder" "$(basename "$target")"
        else
            log_message "Error: The provided argument is neither a file nor a directory." "ERROR" "stdout"
            exit 1
        fi
    else
        log_message "Error: Too many arguments provided. Please provide only one file or directory name." "ERROR" "stdout"
        exit 1
    fi
fi

# Clean up: Remove empty folders and files with .r extension
cleanup

log_message "Script execution completed." "INFO" "stdout"