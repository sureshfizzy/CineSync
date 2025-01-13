import os
import subprocess
import sys
import logging
from datetime import datetime

# Set up logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(message)s')

def logger(message):
    logging.info(message)

def execute_command(*cmd):
    try:
        result = subprocess.run(cmd, check=True, text=True, capture_output=True)
        logger(f"Command '{' '.join(cmd)}' executed successfully.")
    except subprocess.CalledProcessError as e:
        logger(f"Command '{' '.join(cmd)}' failed with error: {e.returncode}")
        sys.exit(e.returncode)

def check_root_privileges():
    if os.geteuid() != 0:
        print("\033[91mError: This script must be run with root privileges.\033[0m")
        input("Press Enter to exit...")
        sys.exit(1)

def create_monitor_service(monitor_script_path):
    check_root_privileges()
    user = os.getlogin()
    service_content = f"""[Unit]
Description=Real-Time Monitor Service
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/python3 {monitor_script_path}
Restart=always
User={user}
Group={user}

[Install]
WantedBy=multi-user.target
"""

    service_file_path = '/etc/systemd/system/cinesync-monitor.service'
    with open(service_file_path, 'w') as f:
        f.write(service_content)

    logger("Monitor service file created.")

def enable_real_time_monitoring():
    service_file_path = '/etc/systemd/system/cinesync-monitor.service'
    if not os.path.isfile(service_file_path):
        current_dir = os.path.dirname(os.path.realpath(__file__))
        monitor_script_path = os.path.join(current_dir, '../monitor', 'polling_monitor.py')
        create_monitor_service(monitor_script_path)

    execute_command('sudo', 'systemctl', 'enable', 'cinesync-monitor.service')
    execute_command('sudo', 'systemctl', 'daemon-reload')
    execute_command('sudo', 'systemctl', 'start', 'cinesync-monitor.service')
    logger("Monitor service has been enabled and started.")

def disable_real_time_monitoring():
    execute_command('sudo', 'systemctl', 'stop', 'cinesync-monitor.service')
    execute_command('sudo', 'systemctl', 'disable', 'cinesync-monitor.service')
    os.remove('/etc/systemd/system/cinesync-monitor.service')
    logger("RealTime Monitor service has been disabled and removed.")

def start_real_time_monitoring():
    logger("Start RealTime Monitoring.")
    execute_command('sudo', 'systemctl', 'start', 'cinesync-monitor.service')
    logger("RealTime Monitor service has been started successfully.")

def main():
    if len(sys.argv) != 2:
        print("Usage: service_manager.py {enable|disable|start}")
        sys.exit(1)

    action = sys.argv[1]
    if action == 'enable':
        enable_real_time_monitoring()
    elif action == 'disable':
        disable_real_time_monitoring()
    elif action == 'start':
        start_real_time_monitoring()
    else:
        print("Usage: python3 script.py {enable|disable|start}")
        sys.exit(1)

if __name__ == "__main__":
    main()
