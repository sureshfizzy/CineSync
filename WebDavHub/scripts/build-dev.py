#!/usr/bin/env python3
"""
CineSync Development Build Script
==================================

This script builds the CineSync project for development:
- Installs frontend dependencies (if needed)
- Builds Go backend
- Does NOT start servers (use start-dev.py for that)

Usage: python build-dev.py
       python build-dev.py --help
"""

import os
import sys
import subprocess
import argparse
import shutil
from pathlib import Path


class WebDavHubDevelopmentBuilder:
    def __init__(self):
        self.script_dir = Path(__file__).parent.absolute()
        self.webdavhub_dir = self.script_dir.parent

    def setup_environment(self):
        """Setup environment and PATH for build tools"""
        # Add common paths for Node.js and Go
        paths_to_add = [
            "/usr/local/bin",
            "/usr/local/go/bin"
        ]

        # Add npm global bin to PATH if it exists
        try:
            npm_prefix = subprocess.check_output(
                ["npm", "config", "get", "prefix"],
                stderr=subprocess.DEVNULL,
                text=True
            ).strip()
            if npm_prefix and Path(npm_prefix, "bin").exists():
                paths_to_add.append(str(Path(npm_prefix, "bin")))
        except (subprocess.CalledProcessError, FileNotFoundError):
            pass

        # Add Go bin to PATH if GOPATH is set
        gopath = os.environ.get("GOPATH")
        if gopath and Path(gopath, "bin").exists():
            paths_to_add.append(str(Path(gopath, "bin")))

        # Update PATH
        current_path = os.environ.get("PATH", "")
        new_paths = [p for p in paths_to_add if p not in current_path]
        if new_paths:
            os.environ["PATH"] = os.pathsep.join(new_paths + [current_path])

    def parse_arguments(self):
        """Parse command line arguments"""
        parser = argparse.ArgumentParser(
            description="CineSync Development Build Script",
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

    def update_go_dependencies(self):
        """Update Go dependencies"""
        print("🔧 Updating Go dependencies...")
        try:
            subprocess.run(["go", "mod", "tidy"], check=True)
            print("✅ Go dependencies updated")
        except subprocess.CalledProcessError:
            print("❌ Failed to update Go dependencies")
            sys.exit(1)
        except FileNotFoundError:
            print("❌ Go not found. Please install Go first.")
            sys.exit(1)

    def build_backend(self):
        """Build Go backend"""
        print("🔧 Building Go backend...")
        try:
            subprocess.run(["go", "build", "-o", "cinesync", "."], check=True)
            print("✅ Go backend built successfully")
        except subprocess.CalledProcessError:
            print("❌ Failed to build Go backend")
            sys.exit(1)

    def ensure_pnpm_available(self):
        """Ensure pnpm is available, install if not"""
        # Check if pnpm is available using shell resolution
        try:
            subprocess.run("pnpm --version", shell=True, check=True, capture_output=True, text=True)
            print("Using package manager: pnpm")
            return "pnpm"
        except (subprocess.CalledProcessError, FileNotFoundError):
            pass

        print("pnpm not found. Installing pnpm...")

        # Check if npm is available
        try:
            result = subprocess.run("npm --version", shell=True, check=True, capture_output=True, text=True)
            print(f"Found npm (version {result.stdout.strip()})")
        except (subprocess.CalledProcessError, FileNotFoundError):
            print("❌ npm not found. Please install Node.js and npm first.")
            print("Make sure Node.js is installed and npm is in your PATH.")
            sys.exit(1)

        # Install pnpm globally
        try:
            subprocess.run("npm install -g pnpm", shell=True, check=True)
            print("✅ pnpm installed successfully")
            return "pnpm"
        except subprocess.CalledProcessError:
            print("❌ Failed to install pnpm")
            print("You may need to run this script with administrator/sudo privileges")
            print("Or install pnpm manually: npm install -g pnpm")
            sys.exit(1)

    def install_frontend_dependencies(self):
        """Install frontend dependencies"""
        print("📦 Installing frontend dependencies...")

        frontend_dir = Path("frontend")
        os.chdir(frontend_dir)

        pnpm_cmd = self.ensure_pnpm_available()

        if not (frontend_dir / "node_modules").exists():
            try:
                subprocess.run("pnpm install", shell=True, check=True)
                print("✅ Frontend dependencies installed using pnpm")
            except subprocess.CalledProcessError:
                print("❌ Failed to install frontend dependencies using pnpm")
                sys.exit(1)
        else:
            print("✅ Frontend dependencies already installed")

        # Change back to WebDavHub directory
        os.chdir("..")

    def show_completion_message(self):
        """Show build completion message"""
        print("\n🎉 Development build completed successfully!")
        print("\nNext steps:")
        print("- Run python scripts/start-dev.py to start development servers")

    def run(self):
        """Main execution method"""
        try:
            print("🔧 Building WebDavHub for Development...\n")

            # Parse command line arguments
            self.parse_arguments()

            # Setup environment
            self.setup_environment()

            # Setup working directory
            self.setup_working_directory()

            # Update Go dependencies
            self.update_go_dependencies()

            # Build backend
            self.build_backend()

            # Install frontend dependencies
            self.install_frontend_dependencies()

            # Show completion message
            self.show_completion_message()

        except Exception as e:
            print(f"❌ Build failed: {e}")
            sys.exit(1)


if __name__ == "__main__":
    builder = WebDavHubDevelopmentBuilder()
    builder.run()