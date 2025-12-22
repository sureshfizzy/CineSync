#!/usr/bin/env python3
"""
CineSync Development Start Script
=================================

This script starts the CineSync development server:
- Serves both frontend and backend on configured ports
- Frontend is served with hot reload via Vite
- Backend API is available at /api/

Usage: python start-dev.py
       python start-dev.py --help

Note: Run python scripts/build-dev.py first to build the project
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

# Local helper: compute env path without env_creator
def get_env_file_path():
    if os.path.exists('/.dockerenv') or os.getenv('CONTAINER') == 'docker':
        return '/app/db/.env'
    cwd = os.getcwd()
    basename = os.path.basename(cwd)
    if basename in ('MediaHub', 'WebDavHub'):
        parent = os.path.dirname(cwd)
        return os.path.join(parent, 'db', '.env')
    return os.path.join(cwd, 'db', '.env')

class WebDavHubDevelopmentServer:
    def __init__(self):
        self.backend_process: Optional[subprocess.Popen] = None
        self.frontend_process: Optional[subprocess.Popen] = None
        self.env_vars: Dict[str, str] = {}
        self.api_host = "localhost"
        self.api_port = 8082
        self.ui_port = 5173
        self.network_ip = self.get_network_ip()
        self.setup_required = False
        self._client_locked_cache: Optional[Dict] = None

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
            description="CineSync Development Start Script",
            formatter_class=argparse.RawDescriptionHelpFormatter,
            epilog=__doc__
        )

        args = parser.parse_args()

    def _load_client_locked_settings(self):
        """Load client locked settings JSON once."""
        if self._client_locked_cache is not None:
            return
        
        script_dir = Path(__file__).parent.absolute()
        webdavhub_dir = script_dir.parent
        path = webdavhub_dir.parent / "MediaHub" / "utils" / "client_locked_settings.json"
        
        if not path.exists():
            cwd = Path.cwd()
            path = cwd.parent / "MediaHub" / "utils" / "client_locked_settings.json"
            if not path.exists():
                path = cwd / ".." / "MediaHub" / "utils" / "client_locked_settings.json"
                path = path.resolve()
        
        if not path.exists():
            self._client_locked_cache = {}
            return
        
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
                self._client_locked_cache = data.get("locked_settings", {}) or {}
        except Exception as e:
            print(f"⚠️  Warning: Could not load client_locked_settings.json from {path}: {e}")
            self._client_locked_cache = {}

    def _get_locked_value(self, key: str) -> Optional[str]:
        """Return locked value from client_locked_settings.json if locked."""
        self._load_client_locked_settings()
        if not self._client_locked_cache:
            return None
        setting = self._client_locked_cache.get(key)
        if setting and setting.get("locked"):
            return str(setting.get("value", ""))
        return None

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
            print("ℹ️  No .env file found. Starting in setup mode.")
            self.setup_required = True

        # Priority: client_locked_settings.json (if locked) > Docker env > .env > defaults
        self.api_host = os.environ.get('CINESYNC_IP', self.env_vars.get('CINESYNC_IP', 'localhost'))
        if self.api_host == '0.0.0.0':
            self.api_host = 'localhost'

        try:
            locked_api_port = self._get_locked_value('CINESYNC_PORT')
            api_port_str = locked_api_port if locked_api_port is not None else os.environ.get('CINESYNC_PORT', self.env_vars.get('CINESYNC_PORT', '8082'))
            self.api_port = int(api_port_str) if api_port_str and api_port_str.strip() else 8082
        except (ValueError, TypeError):
            self.api_port = 8082

        # UI_PORT is only for Vite dev server (hot-reload mode), not used in production
        try:
            ui_port_str = os.environ.get('VITE_DEV_PORT', self.env_vars.get('VITE_DEV_PORT', '5173'))
            self.ui_port = int(ui_port_str) if ui_port_str and ui_port_str.strip() else 5173
        except (ValueError, TypeError):
            self.ui_port = 5173

        self.env_vars['CINESYNC_PORT'] = str(self.api_port)

        if not self.env_vars.get('DESTINATION_DIR'):
            self.setup_required = True
            self.env_vars.setdefault('MEDIAHUB_AUTO_START', 'false')
            self.env_vars.setdefault('RTM_AUTO_START', 'false')

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

    def check_prerequisites(self):
        """Check if required files and dependencies exist"""
        if not Path("cinesync").exists() and not Path("cinesync.exe").exists():
            print("❌ Go binary not found. Please run 'python scripts/build-dev.py' first.")
            sys.exit(1)

        if not Path("frontend").exists():
            print("❌ Frontend directory not found.")
            sys.exit(1)

        if not Path("frontend/node_modules").exists():
            print("❌ Frontend dependencies not installed. Please run 'python scripts/build-dev.py' first.")
            sys.exit(1)

        print("✅ Prerequisites check passed")

    def check_database_directory(self):
        """Check database directory status"""
        pass

    def validate_environment(self):
        """Validate environment variables"""
        if not self.env_vars.get('DESTINATION_DIR'):
            print("⚠️  DESTINATION_DIR not set (setup will prompt for it).")
            print("   Some functionality may be limited until you save settings in /setup.")

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
            env = os.environ.copy()
            env.update(self.env_vars)

            executable = "./cinesync.exe" if Path("cinesync.exe").exists() else "./cinesync"

            self.backend_process = subprocess.Popen(
                [executable],
                env=env,
                stdout=None,
                stderr=None
            )

            time.sleep(3)

            if self.backend_process.poll() is not None:
                print("❌ Backend server failed to start")
                sys.exit(1)

            print("✅ Backend server started successfully")

            if not self.wait_for_backend_api():
                print("⚠️  Continuing despite API not being ready...")

            if self.is_auto_start_enabled():
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
            subprocess.run("pnpm --version", shell=True, check=True, capture_output=True, text=True)
            return "pnpm"
        except (subprocess.CalledProcessError, FileNotFoundError):
            return None

    def start_frontend_server(self):
        """Start the React frontend development server"""
        print(f"Starting React frontend development server on port {self.ui_port}...")

        pnpm_cmd = self.find_pnpm_command()
        if not pnpm_cmd:
            print("❌ pnpm not found. Please install pnpm first:")
            print("  npm install -g pnpm")
            self.cleanup()
            sys.exit(1)

        print(f"Using package manager: {pnpm_cmd}")

        try:
            env = os.environ.copy()
            env.update(self.env_vars)
            # Only set VITE_DEV_PORT for Vite dev server
            env["VITE_DEV_PORT"] = str(self.ui_port)
            env["CINESYNC_PORT"] = str(self.api_port)

            self.frontend_process = subprocess.Popen(
                "pnpm run dev --host",
                shell=True,
                cwd="frontend",
                env=env,
                stdout=None,
                stderr=None
            )

            time.sleep(3)

            if self.frontend_process.poll() is not None:
                print("❌ Frontend development server failed to start")
                self.cleanup()
                sys.exit(1)

            print("✅ Frontend development server started successfully")

        except Exception as e:
            print(f"Error starting frontend development server: {e}")
            self.cleanup()
            sys.exit(1)

    def display_server_info(self):
        """Display information about running servers"""
        print("\n" + "="*70)
        print("🎉 CineSync Development Servers Started Successfully!")
        print("="*70)
        print(f"🔧 Backend API Server (Production Mode):")
        print(f"   ➜ Local:    http://localhost:{self.api_port}")
        print(f"   ➜ Network:  http://{self.network_ip}:{self.api_port}")
        print(f"   ➜ UI:       http://localhost:{self.api_port}  (embedded)")
        print(f"\n🎨 Frontend Dev Server (Hot-Reload Mode):")
        print(f"   ➜ Local:    http://localhost:{self.ui_port}")
        print(f"   ➜ Network:  http://{self.network_ip}:{self.ui_port}")
        print(f"\n💡 Tips:")
        print(f"   • Use http://localhost:{self.ui_port} for frontend development with hot-reload")
        print(f"   • Use http://localhost:{self.api_port} to test production-like single-port setup")
        print(f"\n🌐 WebDAV Access:")
        print(f"   ➜ Local:    http://localhost:{self.api_port}/webdav/")
        print(f"   ➜ Network:  http://{self.network_ip}:{self.api_port}/webdav/")
        print("="*70)
        print("🛑 Press Ctrl+C to stop both servers")
        print("="*70 + "\n")

    def cleanup(self):
        """Clean up running processes"""
        print("\n🧹 Cleaning up processes...")

        if self.frontend_process and self.frontend_process.poll() is None:
            print("Stopping frontend development server...")
            try:
                self.frontend_process.terminate()
                self.frontend_process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.frontend_process.kill()
            except Exception as e:
                print(f"Error stopping frontend server: {e}")

        if self.backend_process and self.backend_process.poll() is None:
            print("Stopping backend server...")
            try:
                self.backend_process.terminate()
                self.backend_process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                print("Backend server did not stop gracefully, force killing...")
                self.backend_process.kill()
            except Exception as e:
                print(f"Error stopping backend server: {e}")

        print("✅ Cleanup completed")

    def wait_for_processes(self):
        """Wait for processes to complete or handle interruption"""
        try:
            while True:
                backend_running = self.backend_process and self.backend_process.poll() is None
                frontend_running = self.frontend_process and self.frontend_process.poll() is None

                if not backend_running:
                    print("❌ Backend server stopped unexpectedly")
                    self.cleanup()
                    sys.exit(1)

                if not frontend_running:
                    print("❌ Frontend development server stopped unexpectedly")
                    self.cleanup()
                    sys.exit(1)

                time.sleep(1)

        except KeyboardInterrupt:
            print("\n🛑 Received interrupt signal")
            self.cleanup()
            sys.exit(0)

    def run(self):
        """Main execution method"""
        try:
            print("🔧 Starting CineSync Development Servers...\n")

            self.parse_arguments()
            self.setup_working_directory()
            self.load_environment_variables()
            self.validate_environment()
            self.check_prerequisites()
            self.check_database_directory()

            print("🚀 Starting development servers...\n")

            self.start_backend_server()
            self.start_frontend_server()
            self.display_server_info()
            self.wait_for_processes()

        except Exception as e:
            print(f"Error: {e}")
            self.cleanup()
            sys.exit(1)


if __name__ == "__main__":
    server = WebDavHubDevelopmentServer()
    server.run()
