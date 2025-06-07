#!/usr/bin/env python3
"""
CineSync Development Start Script
==================================

This script starts the CineSync development servers:
- Starts Go backend server for API
- Starts React frontend development server with hot reload
- Both servers run in the same terminal with proper logging

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
from pathlib import Path
from typing import Optional, Dict, List, Tuple


class WebDavHubDevelopmentServer:
    def __init__(self):
        self.backend_process: Optional[subprocess.Popen] = None
        self.frontend_process: Optional[subprocess.Popen] = None
        self.env_vars: Dict[str, str] = {}
        self.api_port = 8082
        self.ui_port = 5173
        
    def parse_arguments(self):
        """Parse command line arguments"""
        parser = argparse.ArgumentParser(
            description="CineSync Development Start Script",
            formatter_class=argparse.RawDescriptionHelpFormatter,
            epilog=__doc__
        )

        args = parser.parse_args()
        
    def setup_signal_handlers(self):
        """Setup signal handlers for graceful shutdown"""
        def signal_handler(signum, frame):
            print(f"\n🛑 Received signal {signum}, shutting down servers...")
            self.cleanup()
            sys.exit(0)
            
        signal.signal(signal.SIGINT, signal_handler)
        signal.signal(signal.SIGTERM, signal_handler)
            
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
            
    def setup_working_directory(self):
        """Change to WebDavHub directory (2 folders back from script location)"""
        script_dir = Path(__file__).parent.absolute()
        webdavhub_dir = script_dir.parent
        os.chdir(webdavhub_dir)
        print(f"Working directory: {webdavhub_dir}")
        
    def check_prerequisites(self):
        """Check if required files and dependencies exist"""
        # Check if Go binary exists
        if not Path("cinesync").exists() and not Path("cinesync.exe").exists():
            print("❌ Go binary not found. Please run 'python scripts/build-dev.py' first.")
            sys.exit(1)
            
        # Check if frontend directory exists
        if not Path("frontend").exists():
            print("❌ Frontend directory not found.")
            sys.exit(1)
            
        # Check if frontend dependencies are installed
        if not Path("frontend/node_modules").exists():
            print("❌ Frontend dependencies not installed. Please run 'python scripts/build-dev.py' first.")
            sys.exit(1)
            
        print("✅ Prerequisites check passed")
        
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
            print("⚠️  Warning: DESTINATION_DIR not set in .env file")
            print("   Some WebDAV functionality may not work properly")
            print("   Consider setting DESTINATION_DIR in your .env file")
            
    def start_backend_server(self):
        """Start the Go backend server"""
        print(f"Starting Go backend server on port {self.api_port}...")

        try:
            # Start backend with all environment variables
            env = os.environ.copy()
            env.update(self.env_vars)

            # Determine the correct executable name
            executable = "./cinesync.exe" if Path("cinesync.exe").exists() else "./cinesync"

            # Start backend process with output visible in terminal
            self.backend_process = subprocess.Popen(
                [executable],
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
        """Start the React frontend development server"""
        print(f"Starting React frontend development server on port {self.ui_port}...")

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

            # Use 'dev' command for development server with hot reload
            self.frontend_process = subprocess.Popen(
                f"pnpm run dev --port {self.ui_port} --host",
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
                print("Frontend development server failed to start")
                self.cleanup()
                sys.exit(1)

            print("Frontend development server started successfully")

        except Exception as e:
            print(f"Error starting frontend development server: {e}")
            self.cleanup()
            sys.exit(1)

    def display_server_info(self):
        """Display information about running servers"""
        print("\n" + "="*60)
        print("🎉 CineSync Development Servers Started Successfully!")
        print("="*60)
        print(f"🔧 Backend API Server:     http://localhost:{self.api_port}")
        print(f"🎨 Frontend Dev Server:    http://localhost:{self.ui_port}")
        print(f"🌐 WebDAV Access:          http://localhost:{self.api_port}/webdav/")
        print("="*60)
        print("🛑 Press Ctrl+C to stop both servers")
        print("="*60 + "\n")

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
                self.backend_process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.backend_process.kill()
            except Exception as e:
                print(f"Error stopping backend server: {e}")

        print("✅ Cleanup completed")

    def wait_for_processes(self):
        """Wait for processes to complete or handle interruption"""
        try:
            while True:
                # Check if both processes are still running
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

            # Parse command line arguments
            self.parse_arguments()

            # Setup signal handlers
            self.setup_signal_handlers()

            # Setup working directory
            self.setup_working_directory()

            # Load environment variables
            self.load_environment_variables()

            # Validate environment
            self.validate_environment()

            # Check prerequisites
            self.check_prerequisites()

            # Check database directory
            self.check_database_directory()

            print("🚀 Starting development servers...\n")

            # Start backend server first
            self.start_backend_server()

            # Start frontend development server second
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
    server = WebDavHubDevelopmentServer()
    server.run()
