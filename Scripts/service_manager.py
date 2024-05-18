import os
import subprocess
import logging

logger = logging.getLogger(__name__)

def execute_command(command):
    try:
        subprocess.run(command, check=True)
    except subprocess.CalledProcessError as e:
        logger.error(f"Command '{' '.join(command)}' failed with error: {e}")
        raise

def create_monitor_service(monitor_script_path):
    service_content = f"""
    [Unit]
    Description=Real-Time Monitor Service
    After=network.target

    [Service]
    Type=simple
    ExecStart=/usr/bin/python3 {monitor_script_path}
    Restart=always

    [Install]
    WantedBy=multi-user.target
    """

    with open("/etc/systemd/system/cinesync-monitor.service", "w") as service_file:
        service_file.write(service_content)

    logger.info("Monitor service file created.")

def enable_real_time_monitoring():
    # Check if the monitor service exists
    if not os.path.exists("/etc/systemd/system/cinesync-monitor.service"):
        # Get the current script's directory
        current_dir = os.path.dirname(os.path.realpath(__file__))
        # Construct the path to Monitor.py
        monitor_script_path = os.path.join(current_dir, "RealTime-Monitor.py")
        create_monitor_service(monitor_script_path)

    # Enable and start the monitor service
    execute_command(["sudo", "systemctl", "enable", "cinesync-monitor.service"])
    execute_command(["sudo", "systemctl", "daemon-reload"])
    execute_command(["sudo", "systemctl", "start", "cinesync-monitor.service"])
    logger.info("Monitor service has been enabled and started.")

def disable_real_time_monitoring():
    execute_command(["sudo", "systemctl", "stop", "cinesync-monitor.service"])
    execute_command(["sudo", "systemctl", "disable", "cinesync-monitor.service"])
    os.remove("/etc/systemd/system/cinesync-monitor.service")
    logger.info("RealTime Monitor service has been disabled and removed.")

def start_real_time_monitoring():
    logger.info("Start RealTime Monitoring.")
    execute_command(["sudo", "systemctl", "start", "cinesync-monitor.service"])
    logger.info("RealTime Monitor service has been started successfully.")