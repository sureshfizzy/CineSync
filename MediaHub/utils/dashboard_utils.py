import time
import requests
from threading import Lock
from MediaHub.utils.logging_utils import log_message
from MediaHub.config.config import get_cinesync_ip, get_cinesync_api_port, is_dashboard_notifications_enabled, get_dashboard_check_interval, get_dashboard_timeout, get_dashboard_retry_count

class DashboardAvailabilityChecker:
    """
    Singleton class to check and cache dashboard availability status.
    Prevents repeated connection attempts when dashboard is unavailable.
    """
    _instance = None
    _lock = Lock()
    
    def __new__(cls):
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super(DashboardAvailabilityChecker, cls).__new__(cls)
                    cls._instance._initialized = False
        return cls._instance
    
    def __init__(self):
        if not self._initialized:
            self._available = None
            self._last_check = 0
            self._check_interval = get_dashboard_check_interval()
            self._timeout = get_dashboard_timeout()
            self._retry_count = get_dashboard_retry_count()
            self._consecutive_failures = 0
            self._max_consecutive_failures = 3
            self._initialized = True
    
    def is_available(self):
        """
        Check if dashboard is available with caching and intelligent retry logic.
        Returns True if available, False if not available or disabled.
        """
        # Check if dashboard notifications are disabled
        if not is_dashboard_notifications_enabled():
            return False
        
        current_time = time.time()
        
        # Use cached result if within check interval
        if (self._available is not None and 
            current_time - self._last_check < self._check_interval):
            return self._available
        
        # Increase check interval after consecutive failures
        if self._consecutive_failures >= self._max_consecutive_failures:
            extended_interval = self._check_interval * (2 ** min(self._consecutive_failures - self._max_consecutive_failures, 3))
            if current_time - self._last_check < extended_interval:
                return False
        
        # Perform actual availability check
        self._available = self._check_dashboard_availability()
        self._last_check = current_time
        
        if self._available:
            self._consecutive_failures = 0
        else:
            self._consecutive_failures += 1
            if self._consecutive_failures == 1:
                log_message("Dashboard is unavailable, caching status to avoid repeated connection attempts", level="INFO")
            elif self._consecutive_failures >= self._max_consecutive_failures:
                log_message(f"Dashboard unavailable for {self._consecutive_failures} consecutive checks, extending check interval", level="DEBUG")
        
        return self._available
    
    def _check_dashboard_availability(self):
        """
        Perform actual HTTP request to check dashboard availability.
        Returns True if dashboard responds, False otherwise.
        """
        try:
            cinesync_ip = get_cinesync_ip()
            cinesync_port = get_cinesync_api_port()
            url = f"http://{cinesync_ip}:{cinesync_port}/api/health"
            
            # Try a simple health check endpoint first
            for attempt in range(self._retry_count):
                try:
                    response = requests.get(url, timeout=self._timeout)
                    if response.status_code in [200, 404]:
                        return True
                except requests.exceptions.Timeout:
                    if attempt < self._retry_count - 1:
                        time.sleep(0.1)
                    continue
                except requests.exceptions.ConnectionError:
                    break
            
            return False
            
        except Exception as e:
            log_message(f"Error checking dashboard availability: {e}", level="DEBUG")
            return False
    
    def force_recheck(self):
        """Force a recheck of dashboard availability on next call."""
        self._available = None
        self._last_check = 0
        self._consecutive_failures = 0
    
    def mark_unavailable(self):
        """Mark dashboard as unavailable (called when a request fails)."""
        self._available = False
        self._last_check = time.time()
        self._consecutive_failures += 1

# Global instance
_dashboard_checker = DashboardAvailabilityChecker()

def is_dashboard_available():
    """
    Check if dashboard is available for notifications.
    Uses caching to avoid repeated connection attempts.
    """
    return _dashboard_checker.is_available()

def mark_dashboard_unavailable():
    """Mark dashboard as unavailable after a failed request."""
    _dashboard_checker.mark_unavailable()

def force_dashboard_recheck():
    """Force a recheck of dashboard availability."""
    _dashboard_checker.force_recheck()

def send_dashboard_notification(url, payload, operation_type="notification", max_retries=2):
    """
    Send notification to dashboard with retry logic.
    Returns True if sent successfully, False otherwise.
    """
    if not is_dashboard_available():
        return False

    for attempt in range(max_retries + 1):
        try:
            timeout = get_dashboard_timeout()
            response = requests.post(url, json=payload, timeout=timeout)

            if response.status_code == 200:
                return True
            elif response.status_code >= 500 and attempt < max_retries:
                time.sleep(1)
                continue
            elif response.status_code >= 500:
                mark_dashboard_unavailable()
            return False

        except requests.exceptions.Timeout as e:
            log_message(f"Dashboard {operation_type} timeout (attempt {attempt + 1}): {e}", level="DEBUG")
            if attempt < max_retries:
                time.sleep(2)
                continue
            mark_dashboard_unavailable()
            return False

        except (requests.exceptions.ConnectionError, BrokenPipeError) as e:
            if "broken pipe" in str(e).lower():
                log_message(f"Dashboard {operation_type} broken pipe (attempt {attempt + 1})", level="DEBUG")

            if attempt < max_retries:
                time.sleep(1)
                continue
            mark_dashboard_unavailable()
            return False

        except Exception as e:
            log_message(f"Dashboard {operation_type} error: {e}", level="DEBUG")
            if attempt < max_retries:
                time.sleep(1)
                continue
            mark_dashboard_unavailable()
            return False

    return False
