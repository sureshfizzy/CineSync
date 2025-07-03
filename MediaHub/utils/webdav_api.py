import os
import json
import time
import socket
import requests
from .logging_utils import log_message
from MediaHub.config.config import get_cinesync_ip, get_cinesync_api_port
from MediaHub.utils.dashboard_utils import is_dashboard_available, send_dashboard_notification

def is_server_available(host, port, timeout=0.1):
    """Quick check if server is available on the given host and port."""
    try:
        with socket.create_connection((host, int(port)), timeout=timeout):
            return True
    except (socket.error, socket.timeout):
        return False

def send_structured_message_http(message_type, data):
    """Send structured message via HTTP to WebDavHub API."""
    host = get_cinesync_ip()
    port = get_cinesync_api_port()

    # Quick check if server is available (0.1 second timeout)
    if not is_server_available(host, port):
        return False

    try:
        structured_msg = {
            "type": message_type,
            "timestamp": time.time(),
            "data": data
        }

        # Send to the MediaHub-specific API endpoint
        api_url = f"http://{host}:{port}/api/mediahub/message"
        response = requests.post(
            api_url,
            json=structured_msg,
            timeout=2
        )

        if response.status_code != 200:
            log_message(f"Failed to send structured message via HTTP: {response.status_code}", level="DEBUG")
            return False

        return True

    except requests.exceptions.RequestException as e:
        log_message(f"Error sending structured message via HTTP: {e}", level="DEBUG")
        return False
    except Exception as e:
        log_message(f"Unexpected error sending structured message: {e}", level="DEBUG")
        return False

def send_structured_message(message_type, data):
    """Send structured message to WebDavHub API via HTTP with availability checking."""
    try:
        # Check if dashboard is available before attempting to send
        if not is_dashboard_available():
            return False

        host = get_cinesync_ip()
        port = get_cinesync_api_port()

        structured_msg = {
            "type": message_type,
            "timestamp": time.time(),
            "data": data
        }

        # Send to the MediaHub-specific API endpoint
        api_url = f"http://{host}:{port}/api/mediahub/message"
        return send_dashboard_notification(api_url, structured_msg, f"structured message ({message_type})")

    except Exception as e:
        log_message(f"Error sending structured message: {e}", level="DEBUG")
        return False
