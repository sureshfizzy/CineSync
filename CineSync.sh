#!/bin/bash

# Define variables
SCRIPTS_FOLDER="Scripts"
BROKEN_LINK_FOLDER="BrokenLinkVault"
MONITOR_SCRIPT="$SCRIPTS_FOLDER/service_manager.sh"

# Function to check if a directory is valid
is_valid_directory() {
    local directory="$1"
    [[ -d "$directory" ]]
}

# Function to print the banner
print_banner() {
    cat << "EOF"
    a88888b. oo                   .d88888b
   d8'   `88                      88.    "'
   88        dP 88d888b. .d8888b. `Y88888b. dP    dP 88d888b. .d8888b.
   88        88 88'  `88 88ooood8       `8b 88    88 88'  `88 88'  `"`
   Y8.   .88 88 88    88 88.  ... d8'   .8P 88.  .88 88    88 88.  ...
    Y88888P' dP dP    dP `88888P'  Y88888P  `8888P88 dP    dP `88888P'
                                                 .88
                                             d8888P
EOF
}

# Function to greet the user
greet_user() {
    local username=$(whoami)
    welcome_messages=(
        "Welcome back, $username! Ready to manage your library?"
        "Hey there, $username! Your library adventure begins now!"
        "Hello, $username! Let's dive into your library management system!"
        "Greetings, $username! Get ready to organize your library!"
    )
    welcome_message=${welcome_messages[$((RANDOM % ${#welcome_messages[@]}))]}
    echo -e "\n$welcome_message"
}

# Function to clear the screen
clear_screen() {
    clear
}

# Function to print text with color
print_color() {
    local text="$1"
    local color="$2"
    case $color in
        "red")    echo -e "\033[91m$text\033[0m" ;;
        "green")  echo -e "\033[92m$text\033[0m" ;;
        "yellow") echo -e "\033[93m$text\033[0m" ;;
        "blue")   echo -e "\033[94m$text\033[0m" ;;
        "end")    echo -e "\033[0m$text\033[0m" ;;
        *)        echo "$text" ;;
    esac
}

real_time_monitoring() {
    # Check if the operating system is Linux
    if [[ $(uname) == "Linux" && $EUID -ne 0 ]]; then
        print_color "Error: This function requires root privileges. Please run the script with sudo." "red"
        read -p "Press Enter to return to the main menu..."
        return 1
    fi
    
    # Main menu for real-time monitoring
    while true; do
        clear_screen
        print_banner
        echo -e "\nReal-Time Monitoring Options:"
        echo "1) Enable Real-Time Monitoring Service"
        echo "2) Disable Real-Time Monitoring Service"
        echo "3) Exit to Main Menu"
        read -p "Select an option: " choice

        case $choice in
            1)
                bash "$MONITOR_SCRIPT" enable
                read -p "Press Enter to continue..."
                ;;
            2)
                bash "$MONITOR_SCRIPT" disable
                read -p "Press Enter to continue..."
                ;;
            3)
                break
                ;;
            *)
                print_color "Invalid option. Please select again." "red"
                read -p "Press Enter to continue..."
                ;;
        esac
    done

    # Warn if not on a Linux system
    if [[ $(uname) != "Linux" ]]; then
        print_color "Warning: Real-Time Monitoring is only available on Linux OS." "yellow"
        read -p "Press Enter to return to the main menu..."
    fi
}

# Function to execute full library scan
execute_full_library_scan() {
    script_path="$SCRIPTS_FOLDER/library.sh"
    if [[ -e "$script_path" ]]; then
        if [[ $(uname -s) == "Linux" ]]; then
            sudo bash "$script_path"
        else
            bash "$script_path"
        fi
        read -p "Scan completed. Press Enter to return to the main menu..."
    else
        print_color "Error: The library.sh script does not exist." "red"
        read -p "Press Enter to return to the main menu..."
    fi
}

# Function to configure broken symlinks
configure_broken_symlinks() {
    broken_links_folder="BrokenLinkVault"
    config_file="$broken_links_folder/broken_links_config.txt"

    # Create the Broken_links folder if it doesn't exist
    mkdir -p "$broken_links_folder"

    # Create the config file if it doesn't exist
    touch "$config_file"

    while true; do
        clear_screen
        print_banner
        echo -e "\nRemove Broken Symlinks:"
        echo "1) Run Scan"
        echo "2) Add Directory"
        echo "3) Remove Directory"
        echo "4) Show Current Directories"
        echo "5) Back to Main Menu"
        read -p "Select an option: " choice

        case $choice in
            1)
                execute_vault_scan
                ;;
            2)
				read -erp "Enter directory path to add: " directory
				directory="${directory//\\//}"

				if [[ -n "$directory" && -d "$directory" ]]; then
					if grep -qF "$directory" "$config_file"; then
						print_color "Directory already exists." "yellow"
					else
						echo "$directory" >> "$config_file"
						print_color "Directory added successfully." "green"
					fi
					read -rp "Press Enter to continue..."
				else
					print_color "Invalid directory path. Please enter a valid directory." "red"
					read -rp "Press Enter to continue..."
				fi
                ;;
            3)
                if [[ ! -s "$config_file" ]]; then
                    print_color "No directories available." "yellow"
                    read -p "Press Enter to continue..."
                    continue
                fi

                echo -e "\nCurrent Directories:"
                nl "$config_file"

                read -p "Select a directory to remove (enter number): " option
                if [[ "$option" =~ ^[0-9]+$ && "$option" -gt 0 && "$option" -le $(wc -l < "$config_file") ]]; then
                    sed -i "${option}d" "$config_file"
                    print_color "Directory removed successfully." "green"
                    read -p "Press Enter to continue..."
                else
                    print_color "Invalid option. Please select a valid directory." "red"
                    read -p "Press Enter to continue..."
                fi
                ;;
            4)
				if [[ ! -s "$config_file" ]]; then
					print_color "No directories available." "yellow"
					read -rp "Press Enter to continue..."
				else
					echo -e "\nCurrent Directories:"
					cat -n "$config_file"
					read -rp "Press Enter to continue..."
				fi
                ;;
            5)
                break
                ;;
            *)
                print_color "Invalid option. Please select again." "red"
                read -p "Press Enter to continue..."
                ;;
        esac
    done
}

# Function to execute vault scan
execute_vault_scan() {
    script_path="$SCRIPTS_FOLDER/broken_links.sh"
    broken_links_folder="BrokenLinkVault"
    config_file="$broken_links_folder/broken_links_config.txt"

    if [[ -e "$script_path" ]]; then
        if [[ $(uname -s) == "Linux" ]]; then
            sudo bash "$script_path" "$config_file"
        else
            bash "$script_path" "$config_file"
        fi
        print_color "Scan completed successfully." "green"
        read -p "Press Enter to return to the menu..."
    else
        print_color "Error: The broken_links.sh script does not exist." "red"
        read -p "Press Enter to return to the menu..."
    fi
}

# Main function
main() {
    # Maximize console window
    mode con: cols=150 lines=50

    while true; do
        clear_screen
        print_banner
        greet_user
        echo -e "\nMain Menu:"
        echo "1) Full Library Scan"
        echo "2) Real-Time Monitoring"
        echo "3) Remove Broken Symlinks"
        echo "4) Exit"
        read -p "Select an option: " choice

        case $choice in
            1)
                execute_full_library_scan
                ;;
            2)
                real_time_monitoring
                ;;
            3)
                configure_broken_symlinks
                ;;
            4)
                print_color "Exiting..." "green"
                break
                ;;
            *)
                print_color "Invalid option. Please select again." "red"
                read -p "Press Enter to continue..."
                ;;
        esac
    done
}

# Call the main function
main