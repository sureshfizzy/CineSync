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
from pathlib import Path
from typing import Optional, Dict, List, Tuple


class WebDavHubProductionServer:
    def __init__(self):
        self.backend_process: Optional[subprocess.Popen] = None
        self.frontend_process: Optional[subprocess.Popen] = None
        self.env_vars: Dict[str, str] = {}
        self.api_port = 8082
        self.ui_port = 5173

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
        env_file_paths = [
            Path("../../.env"),
            Path("../.env"),
            Path("/app/.env"),
            Path(".env")
        ]

        env_file = None
        for path in env_file_paths:
            if path.exists():
                env_file = path
                break

        if env_file:
            self._parse_env_file(env_file)
        else:
            print("Warning: No .env file found. Using default values.")

        # Get ports from environment variables with defaults
        self.api_port = int(self.env_vars.get('CINESYNC_API_PORT', '8082'))
        self.ui_port = int(self.env_vars.get('CINESYNC_UI_PORT', '5173'))

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
                    self.backend_process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    # Force kill if still running
                    self.backend_process.kill()
                    self.backend_process.wait()
            except Exception as e:
                print(f"Warning: Error stopping backend: {e}")

        print("All servers stopped.")

    def setup_signal_handlers(self):
        """Set up signal handlers for graceful shutdown"""
        signal.signal(signal.SIGINT, self.cleanup)
        signal.signal(signal.SIGTERM, self.cleanup)

    def check_database_directory(self):
        """Check database directory status"""
        # Silently check database directory without verbose output
        pass

    def validate_environment(self):
        """Validate environment variables"""
        # Check if WebDAV is enabled
        if self.env_vars.get('CINESYNC_WEBDAV', 'false').lower() != 'true':
            print("⚠️  Warning: CINESYNC_WEBDAV is not set to 'true'")
            print("   WebDavHub will not start properly without this setting")
            print("   Please set CINESYNC_WEBDAV=true in your .env file")

        # Check if DESTINATION_DIR is set (warning only, not fatal)
        if not self.env_vars.get('DESTINATION_DIR'):
            print("⚠️  Warning: DESTINATION_DIR is not set")
            print("   Some WebDAV functionality may not work properly")
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

            # Wait a moment for backend to start
            time.sleep(3)

            # Check if backend is still running
            if self.backend_process.poll() is not None:
                print("Backend server failed to start")
                sys.exit(1)

            print("Backend server started successfully")

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
            env["CINESYNC_UI_PORT"] = str(self.ui_port)
            env["CINESYNC_API_PORT"] = str(self.api_port)

            self.frontend_process = subprocess.Popen(
                f"pnpm run preview --port {self.ui_port} --host",
                shell=True,
                cwd="frontend",
                env=env,
                stdout=None,
                stderr=None
            )

            # Wait a moment for frontend to start
            time.sleep(3)

            # Check if frontend is still running
            if self.frontend_process.poll() is not None:
                print("Frontend server failed to start")
                self.cleanup()
                sys.exit(1)

            print("Frontend server started successfully")

        except Exception as e:
            print(f"Error starting frontend server: {e}")
            self.cleanup()
            sys.exit(1)

    def display_server_info(self):
        """Display information about running servers"""
        print("\n" + "="*60)
        print("🏭 CineSync Production Servers Started Successfully!")
        print("="*60)
        print(f"🔧 Backend API Server:     http://localhost:{self.api_port}")
        print(f"🎨 Frontend Server:        http://localhost:{self.ui_port}")
        print(f"🌐 WebDAV Access:          http://localhost:{self.api_port}/webdav/")
        print("="*60)
        print("🛑 Press Ctrl+C to stop both servers")
        print("="*60 + "\n")

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