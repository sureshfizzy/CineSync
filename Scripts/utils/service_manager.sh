#!/bin/bash

# Define logger function
logger() {
    echo "$(date +'%Y-%m-%d %H:%M:%S') - $1"
}

# Define execute_command function
execute_command() {
    "$@"
    local status=$?
    if [ $status -ne 0 ]; then
        logger "Command '$*' failed with error: $status"
        exit $status
    fi
}

# Define create_monitor_service function
create_monitor_service() {
    local monitor_script_path=$1
    local service_content="[Unit]
Description=Real-Time Monitor Service
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/python3 $monitor_script_path
Restart=always

[Install]
WantedBy=multi-user.target
"

    echo "$service_content" | sudo tee /etc/systemd/system/cinesync-monitor.service > /dev/null
    logger "Monitor service file created."
}

# Define enable_real_time_monitoring function
enable_real_time_monitoring() {
    if [ ! -f "/etc/systemd/system/cinesync-monitor.service" ]; then
        current_dir=$(dirname "$(realpath "$0")")
        monitor_script_path="$current_dir/RealTime-Monitor.py"
        create_monitor_service "$monitor_script_path"
    fi

    execute_command sudo systemctl enable cinesync-monitor.service
    execute_command sudo systemctl daemon-reload
    execute_command sudo systemctl start cinesync-monitor.service
    logger "Monitor service has been enabled and started."
}

# Define disable_real_time_monitoring function
disable_real_time_monitoring() {
    execute_command sudo systemctl stop cinesync-monitor.service
    execute_command sudo systemctl disable cinesync-monitor.service
    sudo rm /etc/systemd/system/cinesync-monitor.service
    logger "RealTime Monitor service has been disabled and removed."
}

# Define start_real_time_monitoring function
start_real_time_monitoring() {
    logger "Start RealTime Monitoring."
    execute_command sudo systemctl start cinesync-monitor.service
    logger "RealTime Monitor service has been started successfully."
}

# Main script
case "$1" in
    "enable")
        enable_real_time_monitoring
        ;;
    "disable")
        disable_real_time_monitoring
        ;;
    "start")
        start_real_time_monitoring
        ;;
    *)
        echo "Usage: $0 {enable|disable|start}"
        exit 1
        ;;
esac