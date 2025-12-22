#!/usr/bin/env python3
"""CineSync Linux Installer Builder"""

import os
import sys
import shutil
import subprocess
import platform
from pathlib import Path
from datetime import datetime
import urllib.request
import tarfile
import zipfile

class LinuxInstallerBuilder:
    VERSION = "3.2.1-alpha"
    
    def __init__(self, architecture="amd64", package_type="both", clean_build=False):
        self.architecture = architecture
        self.package_type = package_type
        self.clean_build = clean_build
        
        self.root_dir = Path(__file__).parent.parent.parent.absolute()
        self.dist_dir = self.root_dir / "distribution" / "linux"
        self.build_dir = self.dist_dir / "build"
        self.output_dir = self.dist_dir / "output"
        self.webdavhub_dir = self.root_dir / "WebDavHub"
        self.mediahub_dir = self.root_dir / "MediaHub"
        
        self.GREEN = '\033[92m'
        self.RED = '\033[91m'
        self.YELLOW = '\033[93m'
        self.BLUE = '\033[94m'
        self.CYAN = '\033[96m'
        self.RESET = '\033[0m'
        self.BOLD = '\033[1m'
    
    def print_header(self, message):
        print(f"\n{self.CYAN}{'='*70}")
        print(f"  {message}")
        print(f"{'='*70}{self.RESET}\n")
    
    def print_step(self, message):
        print(f"{self.BLUE}🔧 {message}{self.RESET}")
    
    def print_success(self, message):
        print(f"{self.GREEN}✅ {message}{self.RESET}")
    
    def print_error(self, message):
        print(f"{self.RED}❌ {message}{self.RESET}")
    
    def print_warning(self, message):
        print(f"{self.YELLOW}⚠️  {message}{self.RESET}")
    
    def check_prerequisites(self):
        self.print_step("Checking prerequisites...")
        
        is_windows = platform.system() == "Windows"
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
                    print("  - Python 3: sudo apt install python3 python3-pip")
            if "Go" in missing:
                print("  - Go: https://go.dev/dl/")
            if "Node.js" in missing:
                print("  - Node.js: https://nodejs.org/")
            if "pnpm" in missing:
                print("  - pnpm: npm install -g pnpm")
            sys.exit(1)
        
        if self.package_type in ["deb", "both"]:
            if is_windows:
                self.print_warning("Building on Windows - .deb packaging requires WSL or Linux")
                self.print_warning("Creating .tar.gz packages only")
                if self.package_type == "deb":
                    self.package_type = "tar"
                elif self.package_type == "both":
                    self.package_type = "tar"
            else:
                try:
                    subprocess.run(["dpkg-deb", "--version"], capture_output=True, check=True)
                    print(f"   ✓ dpkg-deb: Available")
                except (subprocess.CalledProcessError, FileNotFoundError):
                    self.print_warning("dpkg-deb not found - .deb packaging will be skipped")
                    if self.package_type == "deb":
                        self.package_type = "tar"
                    elif self.package_type == "both":
                        self.package_type = "tar"
        
        self.print_success("All prerequisites found")
    
    def clean_build_directory(self):
        if self.build_dir.exists():
            self.print_step(f"Cleaning build directory: {self.build_dir}")
            shutil.rmtree(self.build_dir)
            self.print_success("Build directory cleaned")
    
    def create_build_directory(self, arch):
        self.print_step(f"Creating build directory structure for {arch}...")
        
        build_arch_dir = self.build_dir / arch
        
        directories = [
            build_arch_dir,
            build_arch_dir / "opt" / "cinesync",
            build_arch_dir / "opt" / "cinesync" / "WebDavHub",
            build_arch_dir / "opt" / "cinesync" / "MediaHub",
            build_arch_dir / "opt" / "cinesync" / "db",
            build_arch_dir / "opt" / "cinesync" / "logs",
            build_arch_dir / "etc" / "systemd" / "system",
            build_arch_dir / "usr" / "local" / "bin",
            self.output_dir,
        ]
        
        for directory in directories:
            directory.mkdir(parents=True, exist_ok=True)
        
        self.print_success(f"Build directory structure created for {arch}")
    
    def build_webdavhub(self, arch):
        self.print_header(f"Building WebDavHub for {arch}")
        
        is_windows = platform.system() == "Windows"
        go_arch = "amd64" if arch == "amd64" else "arm64"
        
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
        
        self.print_step(f"Building Go backend for {arch}...")
        try:
            env = os.environ.copy()
            env["GOOS"] = "linux"
            env["GOARCH"] = go_arch
            env["CGO_ENABLED"] = "0"
            
            output_binary = self.webdavhub_dir / f"cinesync-{arch}"
            
            subprocess.run(
                ["go", "build", "-ldflags", "-s -w", "-o", str(output_binary), "."],
                cwd=self.webdavhub_dir,
                env=env,
                check=True,
                shell=is_windows
            )
            self.print_success(f"Go backend built successfully for {arch}")
            
            return output_binary
        except subprocess.CalledProcessError:
            self.print_error(f"Failed to build Go backend for {arch}")
            sys.exit(1)
    
    def build_mediahub(self):
        self.print_header("Building MediaHub Python Backend")
        
        spec_file = self.mediahub_dir / "MediaHub.spec"
        
        if not spec_file.exists():
            self.print_error(f"MediaHub.spec not found: {spec_file}")
            self.print_error("This spec file is required for building MediaHub")
            sys.exit(1)
            
        is_windows = platform.system() == "Windows"
        
        if is_windows:
            self.print_warning("PyInstaller cannot cross-compile from Windows to Linux")
            self.print_warning("Falling back to Python source distribution (requires Python runtime on target)")
            self.print_warning("To create a standalone binary, build on Linux with: pyinstaller MediaHub.spec")
            return None
        
        self.print_step("Building MediaHub with PyInstaller...")
        
        try:
            result = subprocess.run(
                ["pyinstaller", "--clean", "--noconfirm", str(spec_file)],
                cwd=self.mediahub_dir,
                check=True
            )
            self.print_success("MediaHub built successfully")
            
            mediahub_binary = self.mediahub_dir / "MediaHub"
            
            if not mediahub_binary.exists():
                self.print_error(f"MediaHub binary not found: {mediahub_binary}")
                return None
            
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
    
    def copy_files(self, arch, webdavhub_binary, mediahub_binary=None):
        self.print_step(f"Copying files for {arch}...")
        
        build_arch_dir = self.build_dir / arch
        cinesync_dir = build_arch_dir / "opt" / "cinesync"
        
        dest_binary = cinesync_dir / "WebDavHub" / "cinesync"
        shutil.copy2(webdavhub_binary, dest_binary)
        os.chmod(dest_binary, 0o755)
        print(f"   ✓ Copied: WebDavHub/cinesync")
        
        frontend_dist = self.webdavhub_dir / "frontend" / "dist"
        if frontend_dist.exists():
            shutil.copytree(
                frontend_dist,
                cinesync_dir / "WebDavHub" / "frontend" / "dist",
                dirs_exist_ok=True
            )
            print(f"   ✓ Copied: WebDavHub/frontend/dist")
        
        mediahub_dest = cinesync_dir / "MediaHub"
        
        if mediahub_binary and mediahub_binary.exists():
            dest_mediahub = mediahub_dest / "MediaHub"
            shutil.copy2(mediahub_binary, dest_mediahub)
            os.chmod(dest_mediahub, 0o755)
            print(f"   ✓ Copied: MediaHub/MediaHub (compiled binary)")
        else:
            for item in ["main.py", "api", "config", "monitor", "processors", "utils"]:
                src = self.mediahub_dir / item
                if src.exists():
                    if src.is_dir():
                        shutil.copytree(src, mediahub_dest / item, dirs_exist_ok=True)
                    else:
                        shutil.copy2(src, mediahub_dest / item)
                    print(f"   ✓ Copied: MediaHub/{item}")
            
            requirements_src = self.root_dir / "requirements.txt"
            if requirements_src.exists():
                shutil.copy2(requirements_src, mediahub_dest / "requirements.txt")
                print(f"   ✓ Copied: MediaHub/requirements.txt (source mode)")
        
        for doc in ["README.md", "LICENSE"]:
            src = self.root_dir / doc
            if src.exists():
                shutil.copy2(src, cinesync_dir / doc)
                print(f"   ✓ Copied: {doc}")
        
        self.print_success(f"Files copied for {arch}")
    
    def create_systemd_service(self, arch, use_binary=False):
        self.print_step(f"Creating systemd service file for {arch}...")
        
        build_arch_dir = self.build_dir / arch
        systemd_dir = build_arch_dir / "etc" / "systemd" / "system"
        
        cinesync_service = systemd_dir / "cinesync.service"
        with open(cinesync_service, 'w', encoding='utf-8', newline='\n') as f:
            f.write(f"""[Unit]
Description=CineSync Service
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/cinesync/WebDavHub
ExecStart=/opt/cinesync/WebDavHub/cinesync
Restart=always
RestartSec=10
Environment="PORT=8082"
StandardOutput=append:/opt/cinesync/logs/cinesync.log
StandardError=append:/opt/cinesync/logs/cinesync.log

[Install]
WantedBy=multi-user.target
""")
        
        self.print_success(f"Systemd service file created for {arch}")
    
    def create_install_script(self, arch):
        """Create installation script"""
        self.print_step(f"Creating install script for {arch}...")
        
        build_arch_dir = self.build_dir / arch
        install_script = build_arch_dir / "install.sh"
        
        with open(install_script, 'w', encoding='utf-8', newline='\n') as f:
            f.write(f"""#!/bin/bash
# CineSync Installation Script v{self.VERSION}

set -e

echo "Installing CineSync {self.VERSION}..."

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    echo "Please run as root (sudo ./install.sh)"
    exit 1
fi

# Copy files
echo "Copying files..."
cp -r opt/cinesync /opt/

# Ensure logs and db directories exist with proper permissions
mkdir -p /opt/cinesync/logs
mkdir -p /opt/cinesync/db

# Set permissions (755 allows read/execute for all users)
chmod -R 755 /opt/cinesync
chmod 777 /opt/cinesync/logs
chmod 777 /opt/cinesync/db

# Check if MediaHub is a binary or source
if [ -f "/opt/cinesync/MediaHub/MediaHub" ]; then
    # Binary mode
    chmod +x /opt/cinesync/MediaHub/MediaHub
    echo "✓ MediaHub binary installed"
elif [ -f "/opt/cinesync/MediaHub/main.py" ]; then
    # Source mode - need to install Python dependencies
    echo "Installing MediaHub dependencies..."
    
    # Check if python3-venv is installed
    if ! dpkg -l | grep -q python3-venv; then
        echo "Installing python3-venv..."
        apt-get update -qq
        apt-get install -y python3-venv python3-pip
    fi
    
    # Create virtual environment for MediaHub
    if [ ! -d "/opt/cinesync/MediaHub/venv" ]; then
        echo "Creating Python virtual environment..."
        python3 -m venv /opt/cinesync/MediaHub/venv
    fi
    
    # Install dependencies in virtual environment
    echo "Installing Python packages (this may take a minute)..."
    if /opt/cinesync/MediaHub/venv/bin/pip install --upgrade pip setuptools wheel -q; then
        echo "✓ pip upgraded"
    else
        echo "⚠ Warning: pip upgrade failed, continuing..."
    fi
    
    if /opt/cinesync/MediaHub/venv/bin/pip install -r /opt/cinesync/MediaHub/requirements.txt; then
        echo "✓ Python dependencies installed"
    else
        echo "❌ ERROR: Failed to install Python dependencies"
        echo "Please run manually: /opt/cinesync/MediaHub/venv/bin/pip install -r /opt/cinesync/MediaHub/requirements.txt"
        exit 1
    fi
    
    echo "✓ MediaHub dependencies installed"
fi

# Install systemd services
echo "Installing systemd services..."
cp etc/systemd/system/*.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable cinesync.service

# Start services
echo "Starting services..."
systemctl start cinesync.service

echo ""
echo "✅ CineSync installed successfully!"
echo ""
echo "Access CineSync at: http://localhost:8082"
echo ""
echo "Note: CineSync runs as root to access all your media folders."
echo "      The service will have full access to your filesystem."
echo ""
echo "Useful commands:"
echo "  sudo systemctl status cinesync"
echo "  sudo systemctl restart cinesync"
echo "  sudo journalctl -u cinesync -f"
echo "  sudo tail -f /opt/cinesync/logs/cinesync.log"
""")
        
        os.chmod(install_script, 0o755)
        
        # Create uninstall script
        uninstall_script = build_arch_dir / "uninstall.sh"
        with open(uninstall_script, 'w', encoding='utf-8', newline='\n') as f:
            f.write(f"""#!/bin/bash
# CineSync Uninstallation Script

set -e

echo "Uninstalling CineSync..."

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    echo "Please run as root (sudo ./uninstall.sh)"
    exit 1
fi

# Stop and disable services
systemctl stop cinesync.service || true
systemctl disable cinesync.service || true

# Remove service files
rm -f /etc/systemd/system/cinesync.service
systemctl daemon-reload

# Remove files (keep db and logs by default)
read -p "Remove database and logs? (y/N): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    rm -rf /opt/cinesync
    echo "✓ All files removed"
else
    rm -rf /opt/cinesync/WebDavHub
    rm -rf /opt/cinesync/MediaHub
    rm -rf /opt/cinesync/utils
    echo "✓ Application removed (kept /opt/cinesync/db)"
fi

echo "✅ CineSync uninstalled successfully!"
""")
        
        os.chmod(uninstall_script, 0o755)
        
        self.print_success(f"Install/uninstall scripts created for {arch}")
    
    def create_tarball(self, arch):
        """Create .tar.gz package"""
        self.print_step(f"Creating .tar.gz package for {arch}...")
        
        build_arch_dir = self.build_dir / arch
        output_file = self.output_dir / f"cinesync-{self.VERSION}-linux-{arch}.tar.gz"
        
        with tarfile.open(output_file, "w:gz") as tar:
            tar.add(build_arch_dir, arcname=f"cinesync-{self.VERSION}")
        
        size_mb = output_file.stat().st_size / (1024 * 1024)
        self.print_success(f"Created: {output_file.name} ({size_mb:.1f} MB)")
        
        return output_file
    
    def create_deb_package(self, arch):
        """Create .deb package"""
        self.print_step(f"Creating .deb package for {arch}...")
        
        build_arch_dir = self.build_dir / arch
        deb_dir = self.build_dir / f"deb-{arch}"
        
        if deb_dir.exists():
            shutil.rmtree(deb_dir)
        
        # Create DEBIAN control directory
        control_dir = deb_dir / "DEBIAN"
        control_dir.mkdir(parents=True, exist_ok=True)
        
        # Map architecture
        deb_arch = "amd64" if arch == "amd64" else "arm64"
        
        # Create control file
        control_file = control_dir / "control"
        with open(control_file, 'w', encoding='utf-8', newline='\n') as f:
            f.write(f"""Package: cinesync
Version: {self.VERSION}
Section: web
Priority: optional
Architecture: {deb_arch}
Depends: systemd
Maintainer: CineSync Team <support@cinesync.com>
Description: CineSync Media Management and Streaming Server
 CineSync is a comprehensive media management and streaming solution
 that provides WebDAV access, Real-Debrid integration, and automated
 media organization with Sonarr/Radarr compatibility.
""")
        
        # Create postinst script
        postinst_file = control_dir / "postinst"
        with open(postinst_file, 'w', encoding='utf-8', newline='\n') as f:
            f.write(f"""#!/bin/bash
set -e

# Ensure logs and db directories exist with proper permissions
mkdir -p /opt/cinesync/logs
mkdir -p /opt/cinesync/db

# Set permissions (755 allows read/execute for all users)
chmod -R 755 /opt/cinesync
chmod 777 /opt/cinesync/logs
chmod 777 /opt/cinesync/db

# Check if MediaHub is a binary or source
if [ -f "/opt/cinesync/MediaHub/MediaHub" ]; then
    # Binary mode
    chmod +x /opt/cinesync/MediaHub/MediaHub
elif [ -f "/opt/cinesync/MediaHub/main.py" ]; then
    # Source mode - install Python dependencies
    cd /opt/cinesync/MediaHub
    
    # Check if python3-venv is installed
    if ! dpkg -l | grep -q python3-venv; then
        apt-get update -qq
        apt-get install -y python3-venv python3-pip
    fi
    
    # Create virtual environment for MediaHub
    if [ ! -d "/opt/cinesync/MediaHub/venv" ]; then
        python3 -m venv /opt/cinesync/MediaHub/venv
    fi
    
    # Install dependencies in virtual environment
    /opt/cinesync/MediaHub/venv/bin/pip install --upgrade pip setuptools wheel -q || true
    /opt/cinesync/MediaHub/venv/bin/pip install -r requirements.txt || echo "Warning: Some Python packages may have failed to install"
fi

# Enable and start services
systemctl daemon-reload
systemctl enable cinesync.service
systemctl start cinesync.service

echo "CineSync installed successfully!"
echo "Access at: http://localhost:8082"

exit 0
""")
        os.chmod(postinst_file, 0o755)
        
        # Create prerm script
        prerm_file = control_dir / "prerm"
        with open(prerm_file, 'w', encoding='utf-8', newline='\n') as f:
            f.write("""#!/bin/bash
set -e

systemctl stop cinesync.service || true
systemctl disable cinesync.service || true

exit 0
""")
        os.chmod(prerm_file, 0o755)
        
        # Copy files
        for item in ["opt", "etc"]:
            src = build_arch_dir / item
            if src.exists():
                dest = deb_dir / item
                shutil.copytree(src, dest, dirs_exist_ok=True)
        
        # Build .deb
        output_file = self.output_dir / f"cinesync_{self.VERSION}_linux_{deb_arch}.deb"
        
        try:
            subprocess.run(
                ["dpkg-deb", "--build", str(deb_dir), str(output_file)],
                check=True,
                capture_output=True
            )
            
            size_mb = output_file.stat().st_size / (1024 * 1024)
            self.print_success(f"Created: {output_file.name} ({size_mb:.1f} MB)")
            
            # Clean up
            shutil.rmtree(deb_dir)
            
            return output_file
        except subprocess.CalledProcessError as e:
            self.print_error(f"Failed to create .deb package: {e}")
            return None
    
    def build_for_architecture(self, arch):
        """Build packages for specific architecture"""
        self.print_header(f"Building for {arch}")
        
        self.create_build_directory(arch)
        
        webdavhub_binary = self.build_webdavhub(arch)
        mediahub_binary = self.build_mediahub()
        
        # Determine if we're using binary or source mode
        use_binary = mediahub_binary is not None
        
        self.copy_files(arch, webdavhub_binary, mediahub_binary)
        self.create_systemd_service(arch, use_binary)
        self.create_install_script(arch)
        
        packages = []
        
        if self.package_type in ["tar", "both"]:
            tar_file = self.create_tarball(arch)
            packages.append(tar_file)
        
        if self.package_type in ["deb", "both"]:
            deb_file = self.create_deb_package(arch)
            if deb_file:
                packages.append(deb_file)
        
        return packages
    
    def display_summary(self, all_packages):
        """Display build summary"""
        self.print_header("Build Summary")
        
        print("✅ Build completed successfully!\n")
        print(f"Output directory: {self.output_dir}\n")
        print("Created packages:")
        
        for package in all_packages:
            if package and package.exists():
                size_mb = package.stat().st_size / (1024 * 1024)
                print(f"  📦 {package.name} ({size_mb:.1f} MB)")
        
        print(f"\n{'='*70}")
        print("\nInstallation instructions:")
        print("\n  For .deb packages:")
        print("    sudo dpkg -i cinesync_*.deb")
        print("\n  For .tar.gz packages:")
        print("    tar -xzf cinesync-*.tar.gz")
        print("    cd cinesync-*/")
        print("    sudo ./install.sh")
        print(f"\n{'='*70}\n")
    
    def run(self):
        """Main build process"""
        try:
            self.print_header(f"CineSync Linux Installer Builder v{self.VERSION}")
            
            self.check_prerequisites()
            
            if self.clean_build:
                self.clean_build_directory()
            
            # Determine which architectures to build
            if self.architecture == "both":
                architectures = ["amd64", "arm64"]
            else:
                architectures = [self.architecture]
            
            all_packages = []
            
            for arch in architectures:
                packages = self.build_for_architecture(arch)
                all_packages.extend(packages)
            
            self.display_summary(all_packages)
            
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
    
    parser = argparse.ArgumentParser(description="Build CineSync Linux installer")
    parser.add_argument(
        "--arch",
        choices=["amd64", "arm64", "both"],
        default="amd64",
        help="Target architecture (default: amd64)"
    )
    parser.add_argument(
        "--type",
        choices=["deb", "tar", "both"],
        default="both",
        help="Package type (default: both)"
    )
    parser.add_argument(
        "--clean",
        action="store_true",
        help="Clean build directory before building"
    )
    
    args = parser.parse_args()
    
    builder = LinuxInstallerBuilder(
        architecture=args.arch,
        package_type=args.type,
        clean_build=args.clean
    )
    
    sys.exit(builder.run())

if __name__ == "__main__":
    main()
