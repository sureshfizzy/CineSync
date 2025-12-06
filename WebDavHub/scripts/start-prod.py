#!/usr/bin/env python3
"""
CineSync Production Start Script
=================================

This script starts the CineSync production server:
- Serves both frontend and backend on configured ports
- Frontend is served from built dist files
- Backend API is available at /api/

Usage: python start-prod.py
       python start-prod.py --help

Note: Run python scripts/build-prod.py first to build the project
"""

import os
import sys
import signal
import subprocess
import time
import argparse
import socket
import psutil
import urllib.request
import urllib.error
import urllib.parse
import json
from pathlib import Path
from typing import Optional, Dict, List, Tuple

# Add MediaHub to path for importing env_creator
sys.path.append(str(Path(__file__).parent.parent.parent / "MediaHub"))
from utils.env_creator import get_env_file_path

class WebDavHubProductionServer:
    def __init__(self):
        self.backend_process: Optional[subprocess.Popen] = None
        self.frontend_process: Optional[subprocess.Popen] = None
        self.env_vars: Dict[str, str] = {}
        self.api_host = "localhost"
        self.api_port = 8082
        self.ui_port = 5173
        self.network_ip = self.get_network_ip()

    def get_network_ip(self) -> str:
        """Get the actual network IP address"""
        try:
            # Connect to a remote address to determine the local IP
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
                s.connect(("8.8.8.8", 80))
                return s.getsockname()[0]
        except Exception:
            return "localhost"

    def parse_arguments(self):
        """Parse command line arguments"""
        parser = argparse.ArgumentParser(
            description="CineSync Production Start Script",
            formatter_class=argparse.RawDescriptionHelpFormatter,
            epilog=__doc__
        )

        args = parser.parse_args()

    def setup_working_directory(self):
        """Change to WebDavHub directory (2 folders back from script location)"""
        script_dir = Path(__file__).parent.absolute()
        webdavhub_dir = script_dir.parent
        os.chdir(webdavhub_dir)
        print(f"Working directory: {webdavhub_dir}")

    def load_environment_variables(self):
        """Load environment variables from .env file"""
        env_file_path = get_env_file_path()
        env_file = Path(env_file_path)

        if env_file.exists():
            self._parse_env_file(env_file)
        else:
            print("Warning: No .env file found. Using default values.")

        # Get host and ports from environment variables with defaults
        # Priority: Docker environment variables > .env file > defaults
        self.api_host = os.environ.get('CINESYNC_IP', self.env_vars.get('CINESYNC_IP', 'localhost'))
        if self.api_host == '0.0.0.0':
            self.api_host = 'localhost'
        
        try:
            api_port_str = os.environ.get('CINESYNC_API_PORT', self.env_vars.get('CINESYNC_API_PORT', '8082'))
            self.api_port = int(api_port_str) if api_port_str and api_port_str.strip() else 8082
        except (ValueError, TypeError):
            self.api_port = 8082

        try:
            ui_port_str = os.environ.get('CINESYNC_UI_PORT', self.env_vars.get('CINESYNC_UI_PORT', '5173'))
            self.ui_port = int(ui_port_str) if ui_port_str and ui_port_str.strip() else 5173
        except (ValueError, TypeError):
            self.ui_port = 5173

    def _parse_env_file(self, env_file: Path):
        """Parse .env file and extract environment variables"""
        try:
            with open(env_file, 'r', encoding='utf-8') as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith('#') and '=' in line:
                        key, value = line.split('=', 1)
                        key = key.strip()
                        value = value.strip().strip('"').strip("'")
                        self.env_vars[key] = value

            print(f"✅ Loaded environment variables from {env_file}")
        except Exception as e:
            print(f"⚠️  Warning: Could not parse .env file {env_file}: {e}")

    def cleanup_rclone_mounts(self):
        """Clean up CineSync rclone processes and mounts"""
        import platform
        import subprocess
        
        mount_paths = []
        
        try:
            for proc in psutil.process_iter(['pid', 'name', 'cmdline']):
                try:
                    if proc.info['name'] and 'rclone' in proc.info['name'].lower():
                        cmdline = proc.info.get('cmdline', [])
                        if cmdline and any('CineSync:' in arg for arg in cmdline):
                            # Extract mount path (argument after "CineSync:")
                            for i, arg in enumerate(cmdline):
                                if 'CineSync:' in arg and i + 1 < len(cmdline):
                                    path = cmdline[i + 1]
                                    if path and not path.startswith('-'):
                                        mount_paths.append(path)
                                    break
                            
                            print(f"Cleaning up CineSync rclone process: PID={proc.pid}")
                            proc.terminate()
                            proc.wait(timeout=3) if proc.is_running() else None
                except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.TimeoutExpired):
                    pass
        except Exception as e:
            print(f"Warning: Error during rclone cleanup: {e}")
        
        # Linux: try fusermount/umount
        if platform.system() == "Linux":
            for path in mount_paths:
                for cmd in [["fusermount3", "-u"], ["fusermount", "-u"], ["umount"], 
                           ["fusermount3", "-uz"], ["fusermount", "-uz"], ["umount", "-l"]]:
                    try:
                        if subprocess.run(cmd + [path], capture_output=True, timeout=5).returncode == 0:
                            print(f"Unmounted {path} using {cmd[0]}")
                            break
                    except:
                        continue

    def cleanup(self, signum=None, frame=None):
        """Cleanup background processes"""
        print("\nStopping all servers...")

        # Stop frontend process if running
        if self.frontend_process and self.frontend_process.poll() is None:
            print("Stopping frontend server...")
            try:
                self.frontend_process.terminate()
                # Wait a moment for graceful shutdown
                try:
                    self.frontend_process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    # Force kill if still running
                    self.frontend_process.kill()
                    self.frontend_process.wait()
            except Exception as e:
                print(f"Warning: Error stopping frontend: {e}")

        # Stop backend process if running
        if self.backend_process and self.backend_process.poll() is None:
            print("Stopping backend server...")
            try:
                self.backend_process.terminate()
                # Wait a moment for graceful shutdown
                try:
                    self.backend_process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    # Force kill if still running
                    print("Backend server did not stop gracefully, force killing...")
                    self.backend_process.kill()
                    self.backend_process.wait()
            except Exception as e:
                print(f"Warning: Error stopping backend: {e}")
        
        # Additional cleanup for rclone mounts
        print("Cleaning up any remaining rclone processes...")
        self.cleanup_rclone_mounts()

        print("All servers stopped.")

    def setup_signal_handlers(self):
        """Set up signal handlers for graceful shutdown"""
        signal.signal(signal.SIGINT, self.cleanup)
        signal.signal(signal.SIGTERM, self.cleanup)

    def check_prerequisites(self):
        """Check if required files and dependencies exist"""
        # Check if Go binary exists
        if not Path("cinesync").exists() and not Path("cinesync.exe").exists():
            print("❌ Go binary not found. Please run 'python scripts/build-prod.py' first.")
            sys.exit(1)

        # Check if frontend directory exists
        if not Path("frontend").exists():
            print("❌ Frontend directory not found.")
            sys.exit(1)

        # Check if frontend dependencies are installed
        if not Path("frontend/node_modules").exists():
            print("❌ Frontend dependencies not installed. Please run 'python scripts/build-prod.py' first.")
            sys.exit(1)

        # Check if frontend build exists
        if not Path("frontend/dist").exists():
            print("❌ Frontend build not found. Please run 'python scripts/build-prod.py' first.")
            sys.exit(1)

        print("✅ Prerequisites check passed")

    def check_database_directory(self):
        """Check database directory status"""
        # Silently check database directory without verbose output
        pass

    def validate_environment(self):
        """Validate environment variables"""
        # Check if DESTINATION_DIR is set (warning only, not fatal)
        if not self.env_vars.get('DESTINATION_DIR'):
            print("⚠️  Warning: DESTINATION_DIR is not set")
            print("   Some CineSync functionality may not work properly")
            print("   Consider setting DESTINATION_DIR in your .env file")

    def validate_docker_environment(self):
        """Validate Docker-specific environment variables if running in Docker"""
        # Check if we're running in Docker (presence of /.dockerenv file)
        if not Path("/.dockerenv").exists():
            return  # Not in Docker, skip validation

        print("🐳 Docker environment detected, validating configuration...")

        # Use the general validation method
        self.validate_environment()

        print("✅ Docker environment validation passed")

    def wait_for_backend_api(self, max_wait: int = 30) -> bool:
        """Wait for backend API to be ready"""
        print("Waiting for backend API to be ready...")
        start_time = time.time()
        
        while time.time() - start_time < max_wait:
            try:
                url = f"http://{self.api_host}:{self.api_port}/api/realdebrid/status"
                with urllib.request.urlopen(url, timeout=2) as response:
                    if response.status == 200:
                        print("✅ Backend API is ready")
                        return True
            except (urllib.error.URLError, socket.timeout, ConnectionRefusedError):
                time.sleep(1)
        
        print("⚠️  Backend API did not become ready in time")
        return False

    def is_auto_start_enabled(self) -> bool:
        """Check if MediaHub or RTM auto-start is enabled"""
        mediahub_auto = self.env_vars.get('MEDIAHUB_AUTO_START', 'true').lower() in ('true', '1', 'yes')
        rtm_auto = self.env_vars.get('RTM_AUTO_START', 'false').lower() in ('true', '1', 'yes')
        return mediahub_auto or rtm_auto

    def get_mount_path_from_config(self) -> Optional[str]:
        """Get mount path from Real-Debrid config API"""
        try:
            url = f"http://{self.api_host}:{self.api_port}/api/realdebrid/config"
            with urllib.request.urlopen(url, timeout=5) as response:
                if response.status == 200:
                    data = json.loads(response.read().decode('utf-8'))
                    config = data.get('config', {})
                    rclone_settings = config.get('rcloneSettings', {})
                    mount_path = rclone_settings.get('mountPath')
                    enabled = rclone_settings.get('enabled', False)
                    auto_mount = rclone_settings.get('autoMountOnStart', False)
                    
                    if enabled and auto_mount and mount_path:
                        return mount_path
        except Exception as e:
            pass
        return None

    def wait_for_mount(self, mount_path: str, max_wait: int = 60) -> bool:
        """Wait for rclone mount to be ready by checking both API status and filesystem access"""
        if not mount_path:
            return False
        
        print(f"⏳ Waiting for mount at {mount_path} to be ready...")
        start_time = time.time()
        last_log = 0
        
        while time.time() - start_time < max_wait:
            # Check API status first
            api_mounted = False
            try:
                encoded_path = urllib.parse.quote(mount_path, safe='')
                url = f"http://{self.api_host}:{self.api_port}/api/realdebrid/rclone/status?path={encoded_path}"
                with urllib.request.urlopen(url, timeout=3) as response:
                    if response.status == 200:
                        data = json.loads(response.read().decode('utf-8'))
                        status = data.get('status', {})
                        if status.get('waiting'):
                            waiting_reason = status.get('waitingReason', '')
                            if time.time() - last_log > 5:
                                print(f"   Mount waiting: {waiting_reason}")
                                last_log = time.time()
                            time.sleep(2)
                            continue
                        if status.get('error'):
                            print(f"❌ Mount error: {status.get('error')}")
                            return False
                        api_mounted = status.get('mounted', False)
            except:
                pass
            
            # Verify mount is actually accessible on filesystem
            if api_mounted:
                try:
                    mount_dir = Path(mount_path)
                    if mount_dir.exists() and mount_dir.is_dir():
                        # Try to access it
                        list(mount_dir.iterdir())
                        print(f"✅ Mount is ready at {mount_path}")
                        return True
                except:
                    pass
            
            time.sleep(2)
        
        print(f"⚠️  Mount not ready after {max_wait}s, continuing anyway...")
        return False

    def start_backend_server(self):
        """Start the Go backend server"""
        print(f"Starting Go backend server on port {self.api_port}...")

        try:
            # Start backend with all environment variables
            env = os.environ.copy()
            env.update(self.env_vars)

            # Start backend process with output visible in terminal
            self.backend_process = subprocess.Popen(
                ["./cinesync"],
                env=env,
                stdout=None,
                stderr=None
            )

            # Wait for backend to start and show its startup messages
            time.sleep(3)

            # Check if backend is still running
            if self.backend_process.poll() is not None:
                print("❌ Backend server failed to start")
                sys.exit(1)

            print("✅ Backend server started successfully")

            # Wait for backend API to be ready
            if not self.wait_for_backend_api():
                print("⚠️  Continuing despite API not being ready...")

            if self.is_auto_start_enabled():
                # Give backend a moment to load config
                time.sleep(2)
                mount_path = self.get_mount_path_from_config()
                if mount_path:
                    print(f"\n🔗 Auto-start enabled - waiting for mount before MediaHub/RTM starts...")
                    self.wait_for_mount(mount_path)
                else:
                    print("ℹ️  Auto-start enabled but no auto-mount configured")

        except Exception as e:
            print(f"Error starting backend server: {e}")
            sys.exit(1)

    def find_pnpm_command(self):
        """Find pnpm command using shell resolution"""
        try:
            # Use shell=True to properly resolve commands on Windows
            subprocess.run("pnpm --version", shell=True, check=True, capture_output=True, text=True)
            return "pnpm"
        except (subprocess.CalledProcessError, FileNotFoundError):
            return None

    def start_frontend_server(self):
        """Start the React frontend server"""
        print(f"Starting React frontend server on port {self.ui_port}...")

        # Find pnpm command
        pnpm_cmd = self.find_pnpm_command()
        if not pnpm_cmd:
            print("❌ pnpm not found. Please install pnpm first:")
            print("  npm install -g pnpm")
            self.cleanup()
            sys.exit(1)

        print(f"Using package manager: {pnpm_cmd}")

        try:
            # Set environment variables for the frontend process
            env = os.environ.copy()
            env.update(self.env_vars)
            # Ensure Docker environment variables take precedence
            env["CINESYNC_UI_PORT"] = str(self.ui_port)
            env["CINESYNC_API_PORT"] = str(self.api_port)

            self.frontend_process = subprocess.Popen(
                "pnpm run preview --host",
                shell=True,
                cwd="frontend",
                env=env,
                stdout=None,
                stderr=None
            )

            # Wait for frontend to start and show its startup messages
            time.sleep(3)

            # Check if frontend is still running
            if self.frontend_process.poll() is not None:
                print("❌ Frontend server failed to start")
                self.cleanup()
                sys.exit(1)

            print("✅ Frontend server started successfully")

        except Exception as e:
            print(f"Error starting frontend server: {e}")
            self.cleanup()
            sys.exit(1)

    def display_server_info(self):
        """Display information about running servers"""
        print("\n" + "="*70)
        print("🏭 CineSync Production Servers Started Successfully!")
        print("="*70)
        print(f"🔧 Backend API Server:")
        print(f"   ➜ Local:    http://localhost:{self.api_port}")
        print(f"   ➜ Network:  http://{self.network_ip}:{self.api_port}")
        print(f"🎨 Frontend Server:")
        print(f"   ➜ Local:    http://localhost:{self.ui_port}")
        print(f"   ➜ Network:  http://{self.network_ip}:{self.ui_port}")
        print(f"🌐 WebDAV Access:")
        print(f"   ➜ Local:    http://localhost:{self.api_port}/webdav/")
        print(f"   ➜ Network:  http://{self.network_ip}:{self.api_port}/webdav/")
        print("="*70)
        print("🛑 Press Ctrl+C to stop both servers")
        print("="*70 + "\n")

    def wait_for_processes(self):
        """Wait for either process to finish"""
        try:
            while (self.backend_process and self.backend_process.poll() is None and
                   self.frontend_process and self.frontend_process.poll() is None):
                time.sleep(1)
        except KeyboardInterrupt:
            pass

        # If we get here, one of the processes died or was interrupted
        self.cleanup()

    def run(self):
        """Main execution method"""
        try:
            print("🏭 Starting CineSync Production Server...\n")

            # Parse command line arguments
            self.parse_arguments()

            # Setup signal handlers
            self.setup_signal_handlers()

            # Setup working directory
            self.setup_working_directory()

            # Check prerequisites
            self.check_prerequisites()

            # Load environment variables
            self.load_environment_variables()

            # Validate environment variables
            if Path("/.dockerenv").exists():
                # Running in Docker - use Docker-specific validation
                self.validate_docker_environment()
            else:
                # Not in Docker - use general validation
                self.validate_environment()

            # Check database directory
            self.check_database_directory()

            print("🚀 Starting production servers...\n")

            # Start backend server first
            self.start_backend_server()

            # Start frontend server second
            self.start_frontend_server()

            # Display server information
            self.display_server_info()

            # Wait for processes
            self.wait_for_processes()

        except Exception as e:
            print(f"Error: {e}")
            self.cleanup()
            sys.exit(1)


if __name__ == "__main__":
    server = WebDavHubProductionServer()
    server.run()