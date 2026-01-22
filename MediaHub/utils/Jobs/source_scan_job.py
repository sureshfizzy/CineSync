#!/usr/bin/env python3
"""
Source Files Scan Job
Scans source directories and updates the WebDavHub database with file information.
This job runs every 24 hours to keep the source files database synchronized.
"""

import os
import sys
import time
import json
import requests
from pathlib import Path

# Setup sys.path for both frozen and non-frozen execution
if getattr(sys, 'frozen', False):
    executable_dir = os.path.dirname(sys.executable)
    sys.path.insert(0, executable_dir)
else:
    sys.path.insert(0, str(Path(__file__).parent.parent.parent.parent))

from MediaHub.config.config import get_cinesync_ip, get_cinesync_api_port
from MediaHub.utils.logging_utils import log_message

def trigger_source_scan():
    """Trigger a source directory scan via WebDavHub API"""
    try:
        cinesync_ip = get_cinesync_ip()
        cinesync_port = get_cinesync_api_port()
        
        if not cinesync_ip or not cinesync_port:
            log_message("CineSync connection not configured", level="ERROR")
            return False
            
        url = f"http://{cinesync_ip}:{cinesync_port}/api/database/source-files"
        
        payload = {
            "action": "scan",
            "scanType": "scheduled"
        }
        
        log_message("Starting scheduled source files scan...", level="INFO")
        
        response = requests.post(url, json=payload, timeout=30)
        
        if response.status_code == 200:
            result = response.json()
            log_message(f"Source scan triggered successfully: {result.get('message', 'Unknown')}", level="INFO")
            return True
        else:
            log_message(f"Failed to trigger source scan: HTTP {response.status_code}", level="ERROR")
            return False
            
    except requests.exceptions.RequestException as e:
        log_message(f"Network error during source scan: {e}", level="ERROR")
        return False
    except Exception as e:
        log_message(f"Unexpected error during source scan: {e}", level="ERROR")
        return False

def wait_for_scan_completion():
    """Wait for the scan to complete and monitor progress"""
    try:
        cinesync_ip = get_cinesync_ip()
        cinesync_port = get_cinesync_api_port()
        url = f"http://{cinesync_ip}:{cinesync_port}/api/database/source-scans?latest=true"
        
        max_wait_time = 30 * 60  # 30 minutes maximum
        check_interval = 10  # Check every 10 seconds
        start_time = time.time()
        
        while time.time() - start_time < max_wait_time:
            try:
                response = requests.get(url, timeout=10)
                if response.status_code == 200:
                    scan_data = response.json()
                    status = scan_data.get('status', 'unknown')
                    
                    if status == 'completed':
                        files_discovered = scan_data.get('filesDiscovered', 0)
                        files_updated = scan_data.get('filesUpdated', 0)
                        files_removed = scan_data.get('filesRemoved', 0)
                        total_files = scan_data.get('totalFiles', 0)
                        
                        log_message(f"Source scan completed successfully!", level="INFO")
                        log_message(f"Results: {total_files} total files, {files_discovered} discovered, {files_updated} updated, {files_removed} removed", level="INFO")
                        return True
                        
                    elif status == 'failed':
                        error_msg = scan_data.get('errorMessage', 'Unknown error')
                        log_message(f"Source scan failed: {error_msg}", level="ERROR")
                        return False
                        
                    elif status == 'running':
                        log_message("Source scan still running...", level="DEBUG")
                        
                else:
                    log_message(f"Failed to check scan status: HTTP {response.status_code}", level="WARN")
                    
            except requests.exceptions.RequestException as e:
                log_message(f"Error checking scan status: {e}", level="WARN")
                
            time.sleep(check_interval)
        
        log_message("Source scan timed out after 30 minutes", level="ERROR")
        return False
        
    except Exception as e:
        log_message(f"Error monitoring scan progress: {e}", level="ERROR")
        return False

def update_processing_status():
    """Update processing status for files based on existing file operations"""
    try:
        cinesync_ip = get_cinesync_ip()
        cinesync_port = get_cinesync_api_port()
        
        # Get all file operations
        operations_url = f"http://{cinesync_ip}:{cinesync_port}/api/file-operations"
        response = requests.get(operations_url, params={"limit": 10000}, timeout=30)
        
        if response.status_code != 200:
            log_message(f"Failed to fetch file operations: HTTP {response.status_code}", level="ERROR")
            return False
            
        operations_data = response.json()
        operations = operations_data.get('operations', [])
        
        if not operations:
            log_message("No file operations found to sync", level="INFO")
            return True
            
        # Prepare status updates
        status_updates = []
        for op in operations:
            file_path = op.get('filePath')
            status = op.get('status')
            tmdb_id = op.get('tmdbId')
            season_number = op.get('seasonNumber')
            
            if file_path and status:
                update = {
                    "filePath": file_path,
                    "processingStatus": "processed" if status == "created" else status,
                }
                
                if tmdb_id:
                    update["tmdbId"] = tmdb_id
                    
                if season_number:
                    try:
                        update["seasonNumber"] = int(season_number)
                    except (ValueError, TypeError):
                        pass
                        
                status_updates.append(update)
        
        if status_updates:
            # Update source files with processing status
            update_url = f"http://{cinesync_ip}:{cinesync_port}/api/database/source-files"
            update_payload = {
                "action": "update_status",
                "files": status_updates
            }
            
            response = requests.post(update_url, json=update_payload, timeout=60)
            
            if response.status_code == 200:
                result = response.json()
                updated_count = result.get('updated', 0)
                log_message(f"Updated processing status for {updated_count} files", level="INFO")
                return True
            else:
                log_message(f"Failed to update processing status: HTTP {response.status_code}", level="ERROR")
                return False
        else:
            log_message("No status updates needed", level="INFO")
            return True
            
    except Exception as e:
        log_message(f"Error updating processing status: {e}", level="ERROR")
        return False

def main():
    """Main job execution"""
    log_message("=== Source Files Scan Job Started ===", level="INFO")
    
    success = True

    if not trigger_source_scan():
        log_message("Failed to trigger source scan", level="ERROR")
        success = False
    else:
        if not wait_for_scan_completion():
            log_message("Source scan did not complete successfully", level="ERROR")
            success = False
        else:
            if not update_processing_status():
                log_message("Failed to update processing status", level="WARN")
    
    if success:
        log_message("=== Source Files Scan Job Completed Successfully ===", level="INFO")
        sys.exit(0)
    else:
        log_message("=== Source Files Scan Job Failed ===", level="ERROR")
        sys.exit(1)

if __name__ == "__main__":
    main()
