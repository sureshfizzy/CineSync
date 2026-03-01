#!/usr/bin/env python3
"""
CineSync macOS Installer Builder
Builds .pkg and .dmg installers for macOS (Intel and Apple Silicon)
"""

import os
import sys
import shutil
import subprocess
import platform
from pathlib import Path
from datetime import datetime
import urllib.request
import zipfile
import plistlib

class MacOSInstallerBuilder:
    VERSION = "3.2.2-alpha"
    BUNDLE_ID = "com.cinesync.app"
    
    def __init__(self, architecture="universal", package_type="both", clean_build=False):
        """
        Initialize macOS installer builder
        
        Args:
            architecture: "intel", "arm64", or "universal"
            package_type: "pkg", "dmg", or "both"
            clean_build: Whether to clean before building
        """
        self.architecture = architecture
        self.package_type = package_type
        self.clean_build = clean_build
        
        # Paths
        self.root_dir = Path(__file__).parent.parent.parent.absolute()
        self.dist_dir = self.root_dir / "distribution" / "macos"
        self.build_dir = self.dist_dir / "build"
        self.output_dir = self.dist_dir / "output"
        self.webdavhub_dir = self.root_dir / "WebDavHub"
        self.mediahub_dir = self.root_dir / "MediaHub"
        
        # ANSI color codes
        self.GREEN = '\033[92m'
        self.RED = '\033[91m'
        self.YELLOW = '\033[93m'
        self.BLUE = '\033[94m'
        self.CYAN = '\033[96m'
        self.RESET = '\033[0m'
        self.BOLD = '\033[1m'
    
    def print_header(self, message):
        """Print a header message"""
        print(f"\n{self.CYAN}{'='*70}")
        print(f"  {message}")
        print(f"{'='*70}{self.RESET}\n")
    
    def print_step(self, message):
        """Print a step message"""
        print(f"{self.BLUE}🔧 {message}{self.RESET}")
    
    def print_success(self, message):
        """Print a success message"""
        print(f"{self.GREEN}✅ {message}{self.RESET}")
    
    def print_error(self, message):
        """Print an error message"""
        print(f"{self.RED}❌ {message}{self.RESET}")
    
    def print_warning(self, message):
        """Print a warning message"""
        print(f"{self.YELLOW}⚠️  {message}{self.RESET}")
    
    def check_prerequisites(self):
        """Check if all required tools are installed"""
        self.print_step("Checking prerequisites...")
        
        # Check if running on macOS or Windows
        is_macos = platform.system() == "Darwin"
        is_windows = platform.system() == "Windows"
        
        if not is_macos:
            self.print_warning(f"Building on {platform.system()} - .pkg and .dmg creation requires macOS")
            self.print_warning("App bundle structure will be created, but packaging will be skipped")
        
        # Adjust commands for Windows
        python_cmd = "python" if is_windows else "python3"
        
        required_tools = {
            "Python": [python_cmd, "--version"],
            "Go": ["go", "version"],
            "Node.js": ["node", "--version"],
            "pnpm": ["pnpm", "--version"],
        }
        
        missing = []
        
        for tool, command in required_tools.items():
            try:
                result = subprocess.run(command, capture_output=True, text=True, check=True, shell=is_windows)
                version = result.stdout.strip().split('\n')[0]
                print(f"   ✓ {tool}: {version}")
            except (subprocess.CalledProcessError, FileNotFoundError):
                missing.append(tool)
                print(f"   ✗ {tool}: Not found")
        
        if missing:
            self.print_error("Missing required tools!")
            print("\nPlease install missing tools:")
            if "Python" in missing:
                if is_windows:
                    print("  - Python 3: https://www.python.org/downloads/")
                else:
                    print("  - Python 3: brew install python3")
            if "Go" in missing:
                if is_windows:
                    print("  - Go: https://go.dev/dl/")
                else:
                    print("  - Go: brew install go")
            if "Node.js" in missing:
                if is_windows:
                    print("  - Node.js: https://nodejs.org/")
                else:
                    print("  - Node.js: brew install node")
            if "pnpm" in missing:
                print("  - pnpm: npm install -g pnpm")
            sys.exit(1)
        
        # Check optional tools for packaging (only on macOS)
        if is_macos:
            try:
                subprocess.run(["pkgbuild", "--version"], capture_output=True, check=True)
                print(f"   ✓ pkgbuild: Available")
            except (subprocess.CalledProcessError, FileNotFoundError):
                self.print_warning("pkgbuild not found - .pkg creation may fail")
            
            try:
                subprocess.run(["hdiutil", "version"], capture_output=True, check=True)
                print(f"   ✓ hdiutil: Available")
            except (subprocess.CalledProcessError, FileNotFoundError):
                self.print_warning("hdiutil not found - .dmg creation may fail")
        
        self.print_success("All prerequisites found")
    
    def clean_build_directory(self):
        """Clean the build directory"""
        if self.build_dir.exists():
            self.print_step(f"Cleaning build directory: {self.build_dir}")
            shutil.rmtree(self.build_dir)
            self.print_success("Build directory cleaned")
    
    def create_build_directory(self):
        """Create the build directory structure"""
        self.print_step("Creating build directory structure...")
        
        app_dir = self.build_dir / "CineSync.app"
        contents_dir = app_dir / "Contents"
        
        directories = [
            self.build_dir,
            app_dir,
            contents_dir / "MacOS",
            contents_dir / "Resources",
            contents_dir / "WebDavHub",
            contents_dir / "MediaHub",
            contents_dir / "db",
            contents_dir / "logs",
            self.output_dir,
        ]
        
        for directory in directories:
            directory.mkdir(parents=True, exist_ok=True)
        
        self.print_success("Build directory structure created")
    
    def build_webdavhub(self):
        """Build WebDavHub for macOS"""
        self.print_header("Building WebDavHub")
        
        # Detect if running on Windows
        is_windows = platform.system() == "Windows"
        
        # Build frontend first
        self.print_step("Building frontend...")
        try:
            subprocess.run(
                ["pnpm", "install"],
                cwd=self.webdavhub_dir / "frontend",
                check=True,
                shell=is_windows
            )
            
            subprocess.run(
                ["pnpm", "run", "build"],
                cwd=self.webdavhub_dir / "frontend",
                check=True,
                shell=is_windows
            )
            self.print_success("Frontend built successfully")
        except subprocess.CalledProcessError:
            self.print_error("Failed to build frontend")
            sys.exit(1)
        
        # Build Go backend
        binaries = []
        
        if self.architecture == "universal":
            # Build for both architectures and create universal binary
            self.print_step("Building universal binary...")
            
            for arch in ["amd64", "arm64"]:
                self.print_step(f"Building for {arch}...")
                env = os.environ.copy()
                env["GOOS"] = "darwin"
                env["GOARCH"] = arch
                env["CGO_ENABLED"] = "0"
                
                output = self.webdavhub_dir / f"cinesync-{arch}"
                
                try:
                    subprocess.run(
                        ["go", "build", "-ldflags", "-s -w", "-o", str(output), "."],
                        cwd=self.webdavhub_dir,
                        env=env,
                        check=True,
                        shell=is_windows
                    )
                    binaries.append(output)
                except subprocess.CalledProcessError:
                    self.print_error(f"Failed to build for {arch}")
                    sys.exit(1)
            
            # Create universal binary using lipo
            universal_binary = self.webdavhub_dir / "cinesync-universal"
            
            try:
                subprocess.run(
                    ["lipo", "-create", "-output", str(universal_binary)] + [str(b) for b in binaries],
                    check=True
                )
                
                # Clean up individual binaries
                for binary in binaries:
                    binary.unlink()
                
                self.print_success("Universal binary created")
                return universal_binary
                
            except subprocess.CalledProcessError:
                self.print_error("Failed to create universal binary")
                sys.exit(1)
            except FileNotFoundError:
                self.print_warning("lipo not found, using arm64 binary only")
                return binaries[1] if len(binaries) > 1 else binaries[0]
        
        else:
            # Build for specific architecture
            arch = "amd64" if self.architecture == "intel" else "arm64"
            self.print_step(f"Building for {arch}...")
            
            env = os.environ.copy()
            env["GOOS"] = "darwin"
            env["GOARCH"] = arch
            env["CGO_ENABLED"] = "0"
            
            output = self.webdavhub_dir / f"cinesync-{arch}"
            
            try:
                subprocess.run(
                    ["go", "build", "-ldflags", "-s -w", "-o", str(output), "."],
                    cwd=self.webdavhub_dir,
                    env=env,
                    check=True,
                    shell=is_windows
                )
                self.print_success(f"Binary built for {arch}")
                return output
            except subprocess.CalledProcessError:
                self.print_error(f"Failed to build for {arch}")
                sys.exit(1)
    
    def build_mediahub(self):
        """Build MediaHub using PyInstaller"""
        self.print_header("Building MediaHub Python Backend")
        
        # Use the cross-platform spec file
        spec_file = self.mediahub_dir / "MediaHub.spec"
        
        if not spec_file.exists():
            self.print_error(f"MediaHub.spec not found: {spec_file}")
            self.print_error("This spec file is required for building MediaHub")
            sys.exit(1)
            
        # Check if we're on macOS (required for PyInstaller macOS builds)
        is_macos = platform.system() == "Darwin"
        
        if not is_macos:
            self.print_warning("PyInstaller cannot cross-compile to macOS from other platforms")
            self.print_warning("Falling back to Python source distribution (requires Python runtime on target)")
            self.print_warning("To create a standalone binary, build on macOS with: pyinstaller MediaHub.spec")
            return None
        
        try:
            subprocess.run(["pyinstaller", "--version"], capture_output=True, check=True)
            self.print_step("PyInstaller found, building MediaHub...")
        except (subprocess.CalledProcessError, FileNotFoundError):
            self.print_step("PyInstaller not found, installing...")
            try:
                subprocess.run(
                    ["pip3", "install", "pyinstaller"],
                    check=True,
                    capture_output=False
                )
                self.print_success("PyInstaller installed successfully")
                self.print_step("Building MediaHub with PyInstaller...")
            except subprocess.CalledProcessError:
                self.print_error("Failed to install PyInstaller")
                self.print_warning("Falling back to Python source distribution")
                return None
        
        try:
            # Run PyInstaller with the spec file
            result = subprocess.run(
                ["pyinstaller", "--clean", "--noconfirm", str(spec_file)],
                cwd=self.mediahub_dir,
                check=True
            )
            self.print_success("MediaHub built successfully")
            
            # The binary should be at MediaHub/MediaHub (moved by spec file)
            mediahub_binary = self.mediahub_dir / "MediaHub"
            
            if not mediahub_binary.exists():
                self.print_error(f"MediaHub binary not found: {mediahub_binary}")
                return None
            
            # Clean up PyInstaller artifacts
            build_folder = self.mediahub_dir / "build"
            dist_folder = self.mediahub_dir / "dist"
            
            if build_folder.exists():
                shutil.rmtree(build_folder)
                print(f"   ✓ Cleaned up build folder")
            
            if dist_folder.exists():
                shutil.rmtree(dist_folder)
                print(f"   ✓ Cleaned up dist folder")
            
            return mediahub_binary
            
        except subprocess.CalledProcessError:
            self.print_error("Failed to build MediaHub with PyInstaller")
            self.print_warning("Falling back to Python source distribution")
            return None
        except FileNotFoundError:
            self.print_error("PyInstaller not found")
            self.print_warning("Falling back to Python source distribution")
            return None
    
    def copy_files(self, webdavhub_binary, mediahub_binary=None):
        """Copy all necessary files to app bundle"""
        self.print_step("Copying files to app bundle...")
        
        app_dir = self.build_dir / "CineSync.app"
        contents_dir = app_dir / "Contents"
        
        # Copy WebDavHub binary
        dest_binary = contents_dir / "MacOS" / "cinesync"
        shutil.copy2(webdavhub_binary, dest_binary)
        os.chmod(dest_binary, 0o755)
        print(f"   ✓ Copied: MacOS/cinesync")
        
        # Copy frontend dist
        frontend_dist = self.webdavhub_dir / "frontend" / "dist"
        if frontend_dist.exists():
            shutil.copytree(
                frontend_dist,
                contents_dir / "WebDavHub" / "frontend" / "dist",
                dirs_exist_ok=True
            )
            print(f"   ✓ Copied: WebDavHub/frontend/dist")
        
        # Copy MediaHub - either binary or source
        mediahub_dest = contents_dir / "MediaHub"
        
        if mediahub_binary and mediahub_binary.exists():
            # Copy compiled binary
            dest_mediahub = mediahub_dest / "MediaHub"
            shutil.copy2(mediahub_binary, dest_mediahub)
            os.chmod(dest_mediahub, 0o755)
            print(f"   ✓ Copied: MediaHub/MediaHub (compiled binary)")
        else:
            # Copy Python source files
            for item in ["main.py", "api", "config", "monitor", "processors", "utils"]:
                src = self.mediahub_dir / item
                if src.exists():
                    if src.is_dir():
                        shutil.copytree(src, mediahub_dest / item, dirs_exist_ok=True)
                    else:
                        shutil.copy2(src, mediahub_dest / item)
                    print(f"   ✓ Copied: MediaHub/{item}")
            
            # Copy requirements.txt from root directory
            requirements_src = self.root_dir / "requirements.txt"
            if requirements_src.exists():
                shutil.copy2(requirements_src, mediahub_dest / "requirements.txt")
                print(f"   ✓ Copied: MediaHub/requirements.txt (source mode)")
        
        # Copy documentation
        for doc in ["README.md", "LICENSE"]:
            src = self.root_dir / doc
            if src.exists():
                shutil.copy2(src, contents_dir / "Resources" / doc)
                print(f"   ✓ Copied: {doc}")
        
        # Copy icon file
        icon_src_icns = self.webdavhub_dir / "frontend" / "src" / "assets" / "logo.icns"
        icon_src_png = self.webdavhub_dir / "frontend" / "src" / "assets" / "logo.png"

        if icon_src_icns.exists():
            shutil.copy2(icon_src_icns, contents_dir / "Resources" / "logo.icns")
            print(f"   ✓ Copied: logo.icns")
        elif icon_src_png.exists():
            shutil.copy2(icon_src_png, contents_dir / "Resources" / "logo.icns")
            print(f"   ✓ Copied: logo.png as logo.icns")
            self.print_warning("Using PNG icon. For best results, create a .icns file using 'iconutil' or 'sips'")
        else:
            self.print_warning("No icon file found. App will use default icon.")

        self.print_success("Files copied to app bundle")
    
    def create_info_plist(self):
        """Create Info.plist for app bundle"""
        self.print_step("Creating Info.plist...")
        
        app_dir = self.build_dir / "CineSync.app"
        contents_dir = app_dir / "Contents"
        
        plist = {
            'CFBundleDevelopmentRegion': 'en',
            'CFBundleExecutable': 'cinesync',
            'CFBundleIdentifier': self.BUNDLE_ID,
            'CFBundleInfoDictionaryVersion': '6.0',
            'CFBundleName': 'CineSync',
            'CFBundleDisplayName': 'CineSync',
            'CFBundlePackageType': 'APPL',
            'CFBundleShortVersionString': self.VERSION,
            'CFBundleVersion': self.VERSION,
            'CFBundleIconFile': 'logo.icns',
            'LSMinimumSystemVersion': '10.15',
            'NSHighResolutionCapable': True,
            'NSRequiresAquaSystemAppearance': False,
            'LSUIElement': True,  # Background app
        }
        
        plist_path = contents_dir / "Info.plist"
        with open(plist_path, 'wb') as f:
            plistlib.dump(plist, f)
        
        self.print_success("Info.plist created")
    
    def create_launchd_plist(self):
        """Create LaunchAgent plist for auto-start"""
        self.print_step("Creating LaunchAgent configuration...")
        
        launch_dir = self.build_dir / "LaunchAgents"
        launch_dir.mkdir(exist_ok=True)
        launchd_path = '/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin'
        
        # WebDavHub LaunchAgent
        webdavhub_plist = {
            'Label': f'{self.BUNDLE_ID}.webdavhub',
            'ProgramArguments': ['/Applications/CineSync.app/Contents/MacOS/cinesync'],
            'WorkingDirectory': '/Applications/CineSync.app/Contents/WebDavHub',
            'EnvironmentVariables': {
                'PATH': launchd_path
            },
            'RunAtLoad': True,
            'KeepAlive': True,
            'StandardOutPath': '/tmp/cinesync-webdavhub.log',
            'StandardErrorPath': '/tmp/cinesync-webdavhub.error.log',
        }
        
        webdavhub_plist_path = launch_dir / f"{self.BUNDLE_ID}.webdavhub.plist"
        with open(webdavhub_plist_path, 'wb') as f:
            plistlib.dump(webdavhub_plist, f)
        
        # MediaHub LaunchAgent
        mediahub_plist = {
            'Label': f'{self.BUNDLE_ID}.mediahub',
            'ProgramArguments': ['/Applications/CineSync.app/Contents/MediaHub/venv/bin/python', '/Applications/CineSync.app/Contents/MediaHub/main.py'],
            'WorkingDirectory': '/Applications/CineSync.app/Contents/MediaHub',
            'EnvironmentVariables': {
                'PATH': launchd_path
            },
            'RunAtLoad': True,
            'KeepAlive': True,
            'StandardOutPath': '/tmp/cinesync-mediahub.log',
            'StandardErrorPath': '/tmp/cinesync-mediahub.error.log',
        }
        
        mediahub_plist_path = launch_dir / f"{self.BUNDLE_ID}.mediahub.plist"
        with open(mediahub_plist_path, 'wb') as f:
            plistlib.dump(mediahub_plist, f)
        
        self.print_success("LaunchAgent configuration created")
    
    def create_install_script(self):
        """Create installation script"""
        self.print_step("Creating install script...")
        
        install_script = self.build_dir / "install.sh"
        
        with open(install_script, 'w', encoding='utf-8', newline='\n') as f:
            f.write(f"""#!/bin/bash
# CineSync Installation Script v{self.VERSION}

set -e

echo "Installing CineSync {self.VERSION}..."

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${{BASH_SOURCE[0]}}" )" && pwd )"

# Get the actual user (not root when using sudo)
if [ -n "${{SUDO_USER}}" ]; then
    ACTUAL_USER="$SUDO_USER"
else
    ACTUAL_USER="$(whoami)"
fi
echo "Installing for user: $ACTUAL_USER"

# Copy app bundle
echo "Copying application..."
if [ -d "/Applications/CineSync.app" ]; then
    echo "Removing existing installation..."
    rm -rf "/Applications/CineSync.app"
fi

cp -R "$SCRIPT_DIR/CineSync.app" "/Applications/"
echo "✓ Application installed"

# Fix ownership of the application directory to the actual user
echo "Setting ownership..."
chown -R "$ACTUAL_USER:staff" "/Applications/CineSync.app"
echo "✓ Ownership set correctly"

# Install Python dependencies using virtual environment
echo "Installing MediaHub dependencies..."
cd "/Applications/CineSync.app/Contents/MediaHub"

# Check for Python 3
if ! command -v python3 &> /dev/null; then
    echo "❌ Error: Python 3 is not installed."
    echo "Please install Python 3:"
    echo "  brew install python3"
    exit 1
fi

# Create virtual environment as the actual user (not root)
echo "Creating virtual environment..."
if [ -d "venv" ]; then
    rm -rf venv
fi

# Create venv as the actual user to ensure proper permissions
if [ -n "${{SUDO_USER}}" ]; then
    # Running under sudo, create as the actual user
    sudo -u "$ACTUAL_USER" python3 -m venv venv
else
    python3 -m venv venv
fi
echo "✓ Virtual environment created"

# Activate virtual environment and install dependencies
echo "Installing dependencies in virtual environment..."
if [ -n "${{SUDO_USER}}" ]; then
    # Install as the actual user
    sudo -u "$ACTUAL_USER" bash -c "source venv/bin/activate && pip install --upgrade pip && pip install -r requirements.txt"
else
    source venv/bin/activate
    pip install --upgrade pip
    pip install -r requirements.txt
    deactivate
fi
echo "✓ Dependencies installed"

# Install LaunchAgents
echo "Installing LaunchAgents..."
mkdir -p ~/Library/LaunchAgents

# Copy LaunchAgent plists from the DMG volume
if [ -d "$SCRIPT_DIR/LaunchAgents" ]; then
    cp "$SCRIPT_DIR/LaunchAgents/{self.BUNDLE_ID}.webdavhub.plist" ~/Library/LaunchAgents/
    cp "$SCRIPT_DIR/LaunchAgents/{self.BUNDLE_ID}.mediahub.plist" ~/Library/LaunchAgents/
else
    echo "❌ Error: LaunchAgents directory not found"
    echo "Expected location: $SCRIPT_DIR/LaunchAgents"
    exit 1
fi

# Get the user ID for launchctl commands
USER_ID=$(id -u)

# Unload any existing LaunchAgents first
echo "Stopping any existing services..."
launchctl bootout gui/$USER_ID ~/Library/LaunchAgents/{self.BUNDLE_ID}.webdavhub.plist 2>/dev/null || true
launchctl bootout gui/$USER_ID ~/Library/LaunchAgents/{self.BUNDLE_ID}.mediahub.plist 2>/dev/null || true
launchctl unload ~/Library/LaunchAgents/{self.BUNDLE_ID}.webdavhub.plist 2>/dev/null || true
launchctl unload ~/Library/LaunchAgents/{self.BUNDLE_ID}.mediahub.plist 2>/dev/null || true

# Load the LaunchAgents using bootstrap (modern method) or load (fallback)
echo "Starting services..."
if launchctl bootstrap gui/$USER_ID ~/Library/LaunchAgents/{self.BUNDLE_ID}.webdavhub.plist 2>/dev/null; then
    echo "✓ WebDavHub service started (bootstrap)"
else
    launchctl load ~/Library/LaunchAgents/{self.BUNDLE_ID}.webdavhub.plist 2>/dev/null || true
    echo "✓ WebDavHub service started (load)"
fi

if launchctl bootstrap gui/$USER_ID ~/Library/LaunchAgents/{self.BUNDLE_ID}.mediahub.plist 2>/dev/null; then
    echo "✓ MediaHub service started (bootstrap)"
else
    launchctl load ~/Library/LaunchAgents/{self.BUNDLE_ID}.mediahub.plist 2>/dev/null || true
    echo "✓ MediaHub service started (load)"
fi

echo "✓ Services started"

echo ""
echo "✅ CineSync installed successfully!"
echo ""
echo "Access CineSync at: http://localhost:8082"
echo ""
echo "The application will start automatically on login."
echo ""
echo "To uninstall, run: ./uninstall.sh"
""")
        
        os.chmod(install_script, 0o755)
        
        # Create uninstall script
        uninstall_script = self.build_dir / "uninstall.sh"
        with open(uninstall_script, 'w', encoding='utf-8', newline='\n') as f:
            f.write(f"""#!/bin/bash
# CineSync Uninstallation Script

set -e

echo "Uninstalling CineSync..."

# Get the user ID for launchctl commands
USER_ID=$(id -u)

# Stop and unload LaunchAgents using bootout
echo "Stopping services..."
launchctl bootout gui/$USER_ID ~/Library/LaunchAgents/{self.BUNDLE_ID}.webdavhub.plist 2>/dev/null || true
launchctl bootout gui/$USER_ID ~/Library/LaunchAgents/{self.BUNDLE_ID}.mediahub.plist 2>/dev/null || true
launchctl unload ~/Library/LaunchAgents/{self.BUNDLE_ID}.webdavhub.plist 2>/dev/null || true
launchctl unload ~/Library/LaunchAgents/{self.BUNDLE_ID}.mediahub.plist 2>/dev/null || true

# Kill any running processes
pkill -f "CineSync.app/Contents/MacOS/cinesync" 2>/dev/null || true
pkill -f "CineSync.app/Contents/MediaHub/main.py" 2>/dev/null || true

echo "✓ Services stopped"

# Remove LaunchAgents
echo "Removing LaunchAgents..."
rm -f ~/Library/LaunchAgents/{self.BUNDLE_ID}.webdavhub.plist
rm -f ~/Library/LaunchAgents/{self.BUNDLE_ID}.mediahub.plist
echo "✓ LaunchAgents removed"

# Remove application
echo "Removing application..."
rm -rf "/Applications/CineSync.app"
echo "✓ Application removed"

echo ""
echo "✅ CineSync uninstalled successfully!"
echo ""
echo "Note: If services are still running, log out and log back in."
""")
        
        os.chmod(uninstall_script, 0o755)
        
        self.print_success("Install/uninstall scripts created")
    
    def create_dmg(self):
        """Create .dmg disk image"""
        self.print_step("Creating .dmg disk image...")
        
        if platform.system() != "Darwin":
            self.print_warning("Cannot create .dmg on non-macOS system")
            return None
        
        output_file = self.output_dir / f"CineSync-{self.VERSION}-macOS.dmg"
        
        try:
            # Create temporary DMG
            temp_dmg = self.output_dir / "temp.dmg"
            
            # Calculate size (app bundle size + 50MB buffer)
            app_size = sum(f.stat().st_size for f in (self.build_dir / "CineSync.app").rglob('*') if f.is_file())
            dmg_size_mb = int((app_size / 1024 / 1024) + 50)
            
            subprocess.run([
                "hdiutil", "create",
                "-size", f"{dmg_size_mb}m",
                "-volname", "CineSync",
                "-fs", "HFS+",
                "-srcfolder", str(self.build_dir),
                str(temp_dmg)
            ], check=True, capture_output=True)
            
            # Convert to compressed DMG
            subprocess.run([
                "hdiutil", "convert",
                str(temp_dmg),
                "-format", "UDZO",
                "-o", str(output_file)
            ], check=True, capture_output=True)
            
            temp_dmg.unlink()
            
            size_mb = output_file.stat().st_size / (1024 * 1024)
            self.print_success(f"Created: {output_file.name} ({size_mb:.1f} MB)")
            
            return output_file
            
        except subprocess.CalledProcessError as e:
            self.print_error(f"Failed to create .dmg: {e}")
            return None
    
    def create_pkg(self):
        """Create .pkg installer"""
        self.print_step("Creating .pkg installer...")
        
        if platform.system() != "Darwin":
            self.print_warning("Cannot create .pkg on non-macOS system")
            return None
        
        output_file = self.output_dir / f"CineSync-{self.VERSION}-macOS.pkg"
        
        try:
            subprocess.run([
                "pkgbuild",
                "--root", str(self.build_dir),
                "--identifier", self.BUNDLE_ID,
                "--version", self.VERSION,
                "--install-location", "/Applications",
                str(output_file)
            ], check=True, capture_output=True)
            
            size_mb = output_file.stat().st_size / (1024 * 1024)
            self.print_success(f"Created: {output_file.name} ({size_mb:.1f} MB)")
            
            return output_file
            
        except subprocess.CalledProcessError as e:
            self.print_error(f"Failed to create .pkg: {e}")
            return None
    
    def display_summary(self, packages):
        """Display build summary"""
        self.print_header("Build Summary")
        
        print("✅ Build completed successfully!\n")
        print(f"Output directory: {self.output_dir}\n")
        print("Created packages:")
        
        for package in packages:
            if package and package.exists():
                size_mb = package.stat().st_size / (1024 * 1024)
                print(f"  📦 {package.name} ({size_mb:.1f} MB)")
        
        print(f"\n{'='*70}")
        print("\nInstallation instructions:")
        print("\n  For .dmg:")
        print("    1. Double-click the .dmg file")
        print("    2. Run install.sh from the mounted volume")
        print("\n  For .pkg:")
        print("    Double-click the .pkg file and follow the installer")
        print(f"\n{'='*70}\n")
    
    def run(self):
        """Main build process"""
        try:
            self.print_header(f"CineSync macOS Installer Builder v{self.VERSION}")
            
            self.check_prerequisites()
            
            if self.clean_build:
                self.clean_build_directory()
            
            self.create_build_directory()
            
            webdavhub_binary = self.build_webdavhub()
            mediahub_binary = self.build_mediahub()
            
            self.copy_files(webdavhub_binary, mediahub_binary)
            self.create_info_plist()
            self.create_launchd_plist()
            self.create_install_script()
            
            packages = []
            is_macos = platform.system() == "Darwin"
            
            # Only create packages on macOS
            if is_macos:
                if self.package_type in ["dmg", "both"]:
                    dmg_file = self.create_dmg()
                    if dmg_file:
                        packages.append(dmg_file)
                
                if self.package_type in ["pkg", "both"]:
                    pkg_file = self.create_pkg()
                    if pkg_file:
                        packages.append(pkg_file)
            else:
                self.print_warning("Packaging skipped - requires macOS")
                self.print_success("App bundle structure created successfully")
                app_bundle = self.build_dir / "CineSync.app"
                print(f"\nApp bundle location: {app_bundle}")
            
            if packages:
                self.display_summary(packages)
            
            return 0
            
        except KeyboardInterrupt:
            self.print_error("\nBuild cancelled by user")
            return 1
        except Exception as e:
            self.print_error(f"Unexpected error: {e}")
            import traceback
            traceback.print_exc()
            return 1

def main():
    import argparse
    
    parser = argparse.ArgumentParser(description="Build CineSync macOS installer")
    parser.add_argument(
        "--arch",
        choices=["intel", "arm64", "universal"],
        default="universal",
        help="Target architecture (default: universal)"
    )
    parser.add_argument(
        "--type",
        choices=["pkg", "dmg", "both"],
        default="both",
        help="Package type (default: both)"
    )
    parser.add_argument(
        "--clean",
        action="store_true",
        help="Clean build directory before building"
    )
    
    args = parser.parse_args()
    
    builder = MacOSInstallerBuilder(
        architecture=args.arch,
        package_type=args.type,
        clean_build=args.clean
    )
    
    sys.exit(builder.run())

if __name__ == "__main__":
    main()
