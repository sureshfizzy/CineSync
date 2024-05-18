import os
from Scripts import service_manager
import getpass
import subprocess
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

SCRIPTS_FOLDER = "Scripts"

def print_banner():
    banner = """

   a88888b. oo                   .d88888b
  d8'   `88                      88.    "'
  88        dP 88d888b. .d8888b. `Y88888b. dP    dP 88d888b. .d8888b.
  88        88 88'  `88 88ooood8       `8b 88    88 88'  `88 88'  `""
  Y8.   .88 88 88    88 88.  ... d8'   .8P 88.  .88 88    88 88.  ...
   Y88888P' dP dP    dP `88888P'  Y88888P  `8888P88 dP    dP `88888P'
                                                .88
                                            d8888P
    """
    print(banner)

def greet_user():
    username = os.getlogin()
    print(f"\nWelcome, {username}, to Your Library Management System!")

def clear_screen():
    os.system('cls' if os.name == 'nt' else 'clear')

def print_color(text, color):
    colors = {
        "red": "\033[91m",
        "green": "\033[92m",
        "yellow": "\033[93m",
        "blue": "\033[94m",
        "end": "\033[0m"
    }
    print(f"{colors[color]}{text}{colors['end']}")

def real_time_monitoring():
    # Check if the operating system is Linux
    if os.name == 'posix':
        while True:
            clear_screen()
            print_banner()
            print("\nReal-Time Monitoring Options:")
            print("1) Enable Real-Time Monitoring Service")
            print("2) Disable Real-Time Monitoring Service")
            print("3) Exit to Main Menu")

            choice = input("Select an option: ")

            if choice == "1":
                try:
                   service_manager.enable_real_time_monitoring()
                   input("Press Enter to continue...")
                except Exception as e:
                    print_color("Permission denied. You need sudo privileges to perform this action.", "yellow")
                    input("Press Enter to continue...")
            elif choice == "2":
                try:
                    service_manager.disable_real_time_monitoring()
                    input("Press Enter to continue...")
                except Exception as e:
                    print_color("Permission denied. You need sudo privileges to perform this action.", "yellow")
                    input("Press Enter to continue...")
            elif choice == "3":
                break
            else:
                print_color("Invalid option. Please select again.", "red")
                input("Press Enter to continue...")
    else:
        print_color("Warning: Real-Time Monitoring is only available on Linux OS.", "yellow")
        input("Press Enter to return to the main menu...")
        
def execute_full_library_scan():
    script_path = os.path.join(SCRIPTS_FOLDER, "library.sh")
    if os.path.exists(script_path):
        try:
            subprocess.run(["sudo", "bash", script_path], check=True)
        except KeyboardInterrupt:
            print_color("\nScan interrupted by user.", "red")
            input("Press Enter to return to the main menu...")
        except subprocess.CalledProcessError as e:
            print_color(f"Error: {e}", "red")
            input("Press Enter to return to the main menu...")
    else:
        print_color("Error: The library.sh script does not exist.", "red")
        input("Press Enter to return to the main menu...")



def main():
    # Maximize console window
    os.system('mode con: cols=150 lines=50')

    while True:
        clear_screen()
        print_banner()
        greet_user()
        print("\nMain Menu:")
        print("1) Full Library Scan")
        print("2) Real-Time Monitoring")
        print("3) Remove Broken Symlinks")
        print("4) Exit")

        choice = input("Select an option: ")

        if choice == "1":
            execute_full_library_scan()
        elif choice == "2":
            real_time_monitoring()
        elif choice == "3":
            print_color("Coming Soon", "yellow")
            input("Press Enter to return to the main menu...")
        elif choice == "4":
            print_color("Exiting...", "green")
            break
        else:
            print_color("Invalid option. Please select again.", "red")
            input("Press Enter to continue...")

if __name__ == "__main__":
    main()