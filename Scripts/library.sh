#!/bin/bash

# Check the operating system
os=$(uname -s)

# Load environment variables from .env file
if [ -f "../.env" ]; then
    # Load environment variables, ignoring comments and empty lines
    export $(grep -v '^#' "../.env" | grep -v '^$' | xargs)
else
    echo "Error: .env file not found in the parent directory."
    exit 1
fi

# Determine the Python command based on the OS
if [[ "$(uname -s)" == "MINGW"* || "$(uname -s)" == "MSYS"* ]]; then
    PYTHON_CMD="python"
else
    PYTHON_CMD="python3"
fi

# Configuration
LOG_DIR="logs"
LOG_FILE="$LOG_DIR/script.log"

# Function to log messages
log_message() {
    local message="$1"
    local log_level="$2"
    local destination="$3"  # 'stdout' or 'file'
    local is_movie="$4"     # Flag to indicate if the message is related to movies

    if [[ ("$log_level" == "DEBUG" && "$LOG_LEVEL" == "DEBUG") ||
          "$log_level" == "INFO" || "$log_level" == "WARNING" || "$log_level" == "ERROR" ]]; then
        if [[ "$destination" == "file" ]]; then
            # Create log directory if it doesn't exist
            mkdir -p "$LOG_DIR"

            # Determine log file based on the message content and is_movie flag
            local log_file=""
            if [[ "$is_movie" == "true" ]]; then
                log_file="$LOG_DIR/movies.log"
            else
                log_file="$LOG_DIR/series.log"
            fi

            echo "$(date +'%Y-%m-%d %H:%M:%S') [$log_level] - $message" >> "$log_file"
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
source_dir="$SOURCE_DIR"
log_message "Source directory for TV shows: $source_dir" "DEBUG" "stdout"

# Ensure the source directory is not empty
if [ -z "$source_dir" ]; then
    log_message "Error: SOURCE_DIR is not set or empty." "ERROR" "stdout"
    exit 1
fi

# Split source directories into an array
if [[ "$source_dir" == *","* ]]; then
    IFS=',' read -ra SOURCE_DIRS <<< "$source_dir"
else
    SOURCE_DIRS=("$source_dir")
fi

log_message "Parsed source directories: ${SOURCE_DIRS[*]}" "DEBUG" "stdout"

# Destination directory
destination_dir="$DESTINATION_DIR"
log_message "Destination directory: $destination_dir" "DEBUG" "stdout"

# Log directory
log_dir="logs"
log_message "Log directory: $log_dir" "DEBUG" "stdout"

# Log file for existing folder names in the destination directory
movies_log="$log_dir/movies_folder_names.log"
series_log="$log_dir/series_folder_names.log"

# Check if the target directory exists
if [ ! -d "$destination_dir" ]; then
    log_message "Destination directory '$destination_dir' does not exist." "DEBUG" "stdout"
	mkdir -p $destination_dir
	log_message "Destination directory '$destination_dir' created." "DEBUG" "stdout"
fi

# Function to check all symlinks in the destination directory and save their target paths to appropriate log files
check_symlinks_in_destination() {
    echo "Checking symlinks in destination directory..."
    if [[ "$os" == "MINGW"* || "$os" == "MSYS"* ]]; then
        # Handling for series.log
        while IFS= read -r symlink; do
            target=$(readlink "$symlink")
            windows_path=$(cygpath -w "$target" | sed 's/\\/\//g')
            echo "$windows_path"
        done < <(find "$destination_dir" -type l) > "$log_dir/series.log"

        # Handling for movies.log
        while IFS= read -r symlink; do
            target=$(readlink "$symlink")
            windows_path=$(cygpath -w "$target" | sed 's/\\/\//g')
            echo "$windows_path"
        done < <(find "$destination_dir" -type l) > "$log_dir/movies.log"
    else
        find "$destination_dir" -type l -exec readlink -f {} + > "$log_dir/series.log"
        find "$destination_dir" -type l -exec readlink -f {} + > "$log_dir/movies.log"
    fi
    echo "Symlinks in destination directory checked and saved to $log_dir/series.log and $log_dir/movies.log"
}

# Function to log existing folder names in the destination directory
log_existing_folder_names() {
    local is_movie=false
    log_message "Logging existing folder names in destination directory..." "INFO" "stdout"

    if [[ "$(uname -s)" == "MINGW"* || "$(uname -s)" == "MSYS"* ]]; then
        find "$destination_dir" -mindepth 1 -maxdepth 1 -type d -exec realpath {} + > "$series_log"
    else
        if [ -f "$series_log" ]; then
            # Remove existing log file to regenerate with full paths
            rm "$series_log"
        fi
        # Log all existing folder paths in the destination directory
        find "$destination_dir" -mindepth 1 -maxdepth 1 -type d > "$series_log"
    fi

    if "$is_movie" == true; then
        if [[ "$(uname -s)" == "MINGW"* || "$(uname -s)" == "MSYS"* ]]; then
            find "$destination_dir" -mindepth 1 -maxdepth 1 -type d -exec realpath {} + > "$movies_log"
        else
            if [ -f "$movies_log" ]; then
                # Remove existing log file to regenerate with full paths
                rm "$movies_log"
            fi
            # Log all existing folder paths in the destination directory
            find "$destination_dir" -mindepth 1 -maxdepth 1 -type d > "$movies_log"
        fi
        log_message "Existing movie folder names in destination directory logged to $movies_log" "INFO" "stdout"
    else
        log_message "Existing folder names in destination directory logged to $movies_log" "INFO" "stdout"
    fi
}

# Function to create symlinks for .mkv or .mp4 files in the source directory
organize_media_files() {
    local folder="$1"
    local target_file="$2"
    local target="$3"
    local series_info
    local series_name
    local series_year
    is_movie=false
    local movie_info
    local movie_name
    local movie_year

    folder=$(echo "$folder" | sed 's/\\/\//g')
    target_file=$(echo "$target_file" | sed 's/\\/\//g')

    # Extract the base folder name from the source path if override structure is false
    if [ "$OVERRIDE_STRUCTURE" != "true" ]; then
        base_folder_name=$(basename "$(dirname "$folder")")
    else
        base_folder_name=""
    fi

    #Skip target if a RAR file is detected
    if [[ "${target_file}" =~ \.r[^/]*$ ]]; then
      log_message "Skipping RAR file: $target_file" "WARNING" "stdout"
      if ! grep -qFx "$target_file" "$log_dir/skipped_rar_files.log"; then
        echo "$target_file" >> "$log_dir/skipped_rar_files.log"
      fi
      return 0
    fi

    # Determine if it's a movie or TV series
    if [[ $folder =~ (.*)[Ss]([0-9]+).*[0-9]{3,4}p.* ||
          $folder =~ (.*)[Ss]([0-9]+)[[:space:]].* ||
          $folder =~ (.*)\[([0-9]+)x([0-9]+)\].* ||
          $folder =~ (.*)\.S([0-9]+)E([0-9]+)\. ||
          $folder =~ (.*)[Ss]([0-9]+)[[:space:]]?.* ||
          $folder =~ (.*)\.S([0-9]+)-S([0-9]+)\.[[:alnum:]]+.* ||
          $folder =~ (.*)\.S([0-9]+)\. ||
          $folder =~ (.*)\.Season\.([0-9]+)-([0-9]+)\. ||
          $folder =~ (.*)[[:space:]]Season[[:space:]]([0-9]+)[[:space:]].* ||
          $target_file =~ (.*)[Ss]([0-9]+).*[0-9]{3,4}p.* ||
          $target_file =~ (.*)[Ss]([0-9]+)[[:space:]].* ||
          $target_file =~ (.*)\[([0-9]+)x([0-9]+)\].* ||
          $target_file =~ (.*)\.S([0-9]+)E([0-9]+)\. ||
          $target_file =~ (.*)[Ss]([0-9]+)[[:space:]]?.* ||
          $target_file =~ (.*)\.S([0-9]+)\. ||
          $taregt_file =~ (.*)\.Season\.([0-9]+)-([0-9]+)\. ||
          $target_file =~ (.*)[[:space:]]Season[[:space:]]([0-9]+)[[:space:]].* ||
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
        series_name=$(echo "$series_name" | sed -E 's/\b[Cc][Oo][Mm][Pp][Ll][Ee][Tt][Ee]\b//g')
        series_name="$(echo "$series_name" | awk '{for(i=1;i<=NF;i++)sub(/./,toupper(substr($i,1,1)),$i)}1')"
        log_message "Series detected: $series_name ($series_year)" "INFO" "stdout"

    elif [[ $folder =~ (.*)[.]([0-9]{4})[.].*[0-9]{3,4}p.* ||
            $folder =~ (.*)[.]([0-9]{4})[.].* ||
            $folder =~ (.*)[[:space:]]\(([0-9]{4})\)[[:space:]].* ||
            $folder =~ (.*)\[[0-9]{4}\][[:space:]].* ||
            $folder =~ (.*)[[:space:]]([0-9]{4})[[:space:]].* ||
            $folder =~ (.*)[0-9]{4}[.].* ||
            $folder =~ (.*)[.]\(([0-9]{4})\)[.] ||
            $folder =~ (.*)[.][0-9]{1,2}[.].* ||
            $folder =~ (.*)\(([0-9]{4})\)\(1080p\)\(Hevc\) ||
            $folder =~ (.*)\(([0-9]{4})\)\[PROPER\]\[BDRip.*\] ||
            $folder =~ (.*)\(([0-9]{4})\)[[:space:]].* ||
            $target_file =~ (.*)[.]([0-9]{4})[.].*[0-9]{3,4}p.* ||
            $target_file =~ (.*)[.]([0-9]{4})[.].* ||
            $target_file =~ (.*)[[:space:]]\(([0-9]{4})\)[[:space:]].* ||
            $target_file =~ (.*)\[[0-9]{4}\][[:space:]].* ||
            $target_file =~ (.*)[0-9]{4}[.].* ||
            $target_file =~ (.*)[.]\(([0-9]{4})\)[.] ||
            $target_file =~ (.*)[.][0-9]{1,2}[.].* ||
            $target_file =~ (.*)\(([0-9]{4})\)\(1080p\)\(Hevc\) ||
            $target_file =~ (.*)\(([0-9]{4})\)\[PROPER\]\[BDRip.*\] ||
            $target_file =~ (.*)\(([0-9]{4})\)[[:space:]].* ||
            $target_file =~ (.*)[[:space:]]([0-9]{4})[[:space:]].* ]]; then

        movie_info="${BASH_REMATCH[1]}"
        is_movie=true

        # Extract year from different patterns
        if [[ $folder =~ ([0-9]{4}) ]]; then
            movie_year="${BASH_REMATCH[1]}"
        elif [[ $folder =~ \[([0-9]{4})\] ]]; then
            movie_year="${BASH_REMATCH[1]}"
        elif [[ $folder =~ ([0-9]{4}) ]]; then
            movie_year="${BASH_REMATCH[1]}"
        fi

        movie_name=$(basename "$movie_info")
        movie_name=$(echo "$movie_name" | sed -e 's/[._]/ /g')
        movie_name=$(echo "$movie_name" | sed 's/[[:space:]]*$//;s/-*$//')
        movie_name=$(echo "$movie_name" | sed -e 's/([^)]*)//' -e 's/\[[^]]*\]//g' -e 's/{[^}]*}//g' -e 's/[^a-zA-Z0-9 ]//g')
        movie_name=$(echo "$movie_name" | awk '{for(i=1;i<=NF;i++)sub(/./,toupper(substr($i,1,1)),$i)}1')
        log_message "Movie detected: $movie_name ($movie_year)" "INFO" "stdout"
    else
        log_message "Unable to determine series or movie: $folder" "WARNING" "stdout"
        return
    fi

    # Handling movies
    if [ "$is_movie" = true ]; then
        movie_name=$(echo "$movie_name" | sed 's/\./ /g')

        local destination_movie_dir="$destination_dir"
        if [ "$OVERRIDE_STRUCTURE" != "true" ]; then
            destination_movie_dir="$destination_movie_dir/$base_folder_name"
        fi
        destination_movie_dir="$destination_movie_dir/$movie_name"
        if [ -n "$movie_year" ]; then
            destination_movie_dir="$destination_movie_dir ($movie_year)"
        fi

        local movie_file=$(find "$folder" -maxdepth 1 \( -iname "*.mkv" -o -iname "*.mp4" \) -print -quit)

        if [ -z "$movie_file" ]; then
            log_message "Error: No movie file (*.mkv or *.mp4) found in $folder." "ERROR" "stdout"
            return 1
        fi

        local destination_file="$destination_movie_dir/$(basename "$movie_file")"

        if grep -qF "$movie_file" "$log_dir/movies.log"; then
            log_message "A symlink already exists for $(basename "$movie_file") with the same target." "DEBUG" "stdout"
            if [ "$RENAME_ENABLED" == "true" ]; then
                $PYTHON_CMD tmdb_renamer.py "$destination_file"
            fi
        else
            mkdir -p "$destination_movie_dir"
            echo "$destination_movie_dir" >> "$movies_log"
            ln -s "$movie_file" "$destination_file"
            log_message "Symlink created: $movie_file -> $destination_file" "DEBUG" "stdout"
            if [ "$RENAME_ENABLED" == "true" ]; then
                $PYTHON_CMD tmdb_renamer.py "$destination_file"
            fi
            echo "$movie_file" >> "$log_dir/movies.log"
        fi

    # Handling TV series
    else
        series_name=$(echo "$series_name" | sed 's/\./ /g')
        destination_series_dir="$destination_dir"
        if [ "$OVERRIDE_STRUCTURE" != "true" ]; then
            destination_series_dir="$destination_series_dir/$base_folder_name"
        fi
        destination_series_dir="$destination_series_dir/$series_name"
        destination_series_dir=$(echo "$destination_series_dir" | sed 's/ -[0-9]\+$//' | tr -d '\n')
        found_in_log=$(grep "$series_name" "$series_log" | head -n 1)
        if grep -qF "$destination_series_dir" "$series_log"; then
            destination_series_dir="$found_in_log"
            log_message "Folder '$series_name' exists in $series_log (refers to: $found_in_log). Placing files inside." "INFO" "stdout"
        else
            series_name_pattern=$(echo "$series_name" | sed 's/ / */g')
            series_name_pattern=$(echo "$series_name_pattern" | sed 's/P[[:space:]]*d/P[[:space:]]*d|P[[:space:]]+d/' | sed 's/P[[:space:]]*D/P[[:space:]]*D|P[[:space:]]+D/' | sed 's/[0-9]\{4\}//')
            found_in_log=$(grep -iE "$series_name_pattern" "$series_log" | head -n 1)
            if [ -n "$found_in_log" ]; then
                destination_series_dir="$found_in_log"
                log_message "Folder '$series_name' exists in $names_log (refers to: $found_in_log). Placing files inside." "INFO" "stdout"
            else
                log_message "Folder '$series_name' does not exist in names.log. Files will be placed in '$series_name'." "INFO" "stdout"
                mkdir -p "$destination_series_dir"
                echo "$destination_series_dir" >> "$series_log"
                log_message "New series folder '$series_name' created in the destination directory." "INFO" "stdout"
            fi
        fi

        # Handle episodes
        if [ -z "$target_file" ]; then
            shopt -s nullglob
            for file in "$folder"/*; do
                filename=$(basename "$file")
                season_folders=()
                series_season=""

                if [[ $folder =~ \.S([0-9]{2})\. ]] || [[ $filename =~ [Ss]([0-9]+) ]] || [[ $folder =~ Season\.([0-9]+-[0-9]+) ]]; then
                    series_season="${BASH_REMATCH[1]}"
                    season_folders+=("Season $(echo "$series_season" | awk '{printf "%02d", $1}')")
                fi

                for season_folder in "${season_folders[@]}"; do
                    destination_file="$destination_series_dir/$season_folder/$filename"

                    if grep -qF "$file" "$log_dir/series.log"; then
                        log_message "Symlink already exists for $filename with the same target." "DEBUG" "stdout"
                        if [ "$RENAME_ENABLED" == "true" ]; then
                            $PYTHON_CMD tmdb_renamer.py "$destination_file"
                        fi
                    else
                        log_message "No symlink exists with the same target." "DEBUG" "stdout"
                        mkdir -p "$(dirname "$destination_file")"
                        ln -s "$file" "$destination_file"
                        if [ "$RENAME_ENABLED" == "true" ]; then
                            $PYTHON_CMD tmdb_renamer.py "$destination_file"
                        fi
                        log_message "Symlink created: $file -> $destination_file" "DEBUG" "stdout"
                        echo "$file" >> "$log_dir/series.log"
                    fi
                done
            done
        else
            series_season=""
            episode_number=""
            if [[ $target_file =~ [Ss]([0-9]+)[Ee]([0-9]+) ]]; then
                series_season="${BASH_REMATCH[1]}"
                episode_number="${BASH_REMATCH[2]}"
            else
                log_message "Error: Unable to extract season and episode information from $target_file." "ERROR" "stdout"
                exit 1
            fi

            season_folder="Season $(printf "%02d" "$series_season")"
            destination_file="$destination_series_dir/$season_folder/$target_file"

            if grep -qF "$target_file" "$log_dir/series.log"; then
                log_message "Symlink already exists for $target_file with the same target." "DEBUG" "stdout"
                if [ "$RENAME_ENABLED" == "true" ]; then
                    $PYTHON_CMD tmdb_renamer.py "$destination_file"
                fi
            else
                log_message "No symlink exists with the same target." "DEBUG" "stdout"
                mkdir -p "$(dirname "$destination_file")"
                ln -s "$folder/$target_file" "$destination_file"
                if [ "$RENAME_ENABLED" == "true" ]; then
                    $PYTHON_CMD tmdb_renamer.py "$destination_file"
                fi
                log_message "Symlink created: $folder/$target_file -> $destination_file" "DEBUG" "stdout"
                echo "$folder/$target_file" >> "$log_dir/series.log"
            fi
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
    for src_dir in "${SOURCE_DIRS[@]}"; do
        log_message "Creating symlinks for all files in source directory: $src_dir" "INFO" "stdout"
        for entry in "$src_dir"/*; do
            if [ -d "$entry" ]; then
                organize_media_files "$entry"
            elif [ -f "$entry" ]; then
                symlink_specific_file_or_folder "$entry"
            fi
        done
    done
else
    # If file or folder names are provided as arguments, symlink them
    if [ $# -eq 1 ]; then
        target="$1"
        if [ -d "$target" ]; then
            log_message "The provided argument is a directory. Organizing according to TV show conventions..." "INFO" "stdout"
            organize_media_files "$target"
        elif [ -f "$target" ]; then
            log_message "The provided argument is a file. Organizing it accordingly..." "INFO" "stdout"
            folder=$(dirname "$target")
            organize_media_files "$folder" "$(basename "$target")"
        else
            log_message "Error: The provided argument is neither a file nor a directory." "ERROR" "stdout"
            exit 1
        fi
    else
        # Handle the case where multiple arguments are provided
        for target in "$@"; do
            if [ -d "$target" ]; then
                log_message "The provided argument is a directory. Organizing according to TV show conventions..." "INFO" "stdout"
                organize_media_files "$target"
            elif [ -f "$target" ]; then
                log_message "The provided argument is a file. Organizing it accordingly..." "INFO" "stdout"
                folder=$(dirname "$target")
                organize_media_files "$folder" "$(basename "$target")"
            else
                log_message "Error: The provided argument is neither a file nor a directory." "ERROR" "stdout"
                exit 1
            fi
        done
    fi
fi

# Clean up: Remove empty folders and files with .r extension
cleanup

log_message "Script execution completed." "INFO" "stdout"
