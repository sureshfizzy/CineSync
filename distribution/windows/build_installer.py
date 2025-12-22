#!/usr/bin/env python3
"""
CineSync Installer Build Script

Builds all components and prepares them for Windows installer creation.
Automatically downloads required utilities (NSSM, rclone, ffprobe).

Usage:
    python build_installer.py
    python build_installer.py --clean
"""

import os
import sys
import subprocess
import shutil
import argparse
import urllib.request
import zipfile
from pathlib import Path
from datetime import datetime


class CineSyncInstallerBuilder:
    VERSION = "3.2.1-alpha"
    
    def __init__(self, clean_build=False):
        self.root_dir = Path(__file__).parent.parent.parent.absolute()
        self.webdavhub_dir = self.root_dir / "WebDavHub"
        self.mediahub_dir = self.root_dir / "MediaHub"
        self.dist_dir = self.root_dir / "distribution" / "windows"
        self.build_dir = self.dist_dir / "build"
        self.output_dir = self.dist_dir / "output"
        self.clean_build = clean_build
        
    def print_header(self, message: str):
        """Print a formatted header"""
        print("\n" + "="*70)
        print(f"  {message}")
        print("="*70 + "\n")
        
    def print_step(self, message: str):
        """Print a build step"""
        print(f"🔧 {message}")
        
    def print_success(self, message: str):
        """Print a success message"""
        print(f"✅ {message}")
        
    def print_error(self, message: str):
        """Print an error message"""
        print(f"❌ {message}")
        
    def print_warning(self, message: str):
        """Print a warning message"""
        print(f"⚠️  {message}")
        
    def check_prerequisites(self):
        """Check if all required tools are installed"""
        self.print_step("Checking prerequisites...")
        
        prerequisites = {
            "Python": ["python", "--version"],
            "PyInstaller": ["pyinstaller", "--version"],
            "Go": ["go", "version"],
            "Node.js": ["node", "--version"],
            "pnpm": ["pnpm", "--version"],
        }
        
        # Check for Inno Setup
        inno_paths = [
            Path(r"C:\Program Files (x86)\Inno Setup 6\ISCC.exe"),
            Path(r"C:\Program Files\Inno Setup 6\ISCC.exe"),
        ]
        self.inno_compiler = None
        for inno_path in inno_paths:
            if inno_path.exists():
                self.inno_compiler = inno_path
                break
        
        missing = []
        
        for tool, command in prerequisites.items():
            try:
                result = subprocess.run(
                    command,
                    capture_output=True,
                    text=True,
                    check=True,
                    shell=True
                )
                version = result.stdout.strip().split('\n')[0]
                print(f"   ✓ {tool}: {version}")
            except (subprocess.CalledProcessError, FileNotFoundError):
                missing.append(tool)
                print(f"   ✗ {tool}: Not found")
        
        if missing:
            self.print_error(f"Missing prerequisites: {', '.join(missing)}")
            print("\nPlease install missing tools:")
            if "PyInstaller" in missing:
                print("  - PyInstaller: pip install pyinstaller")
            if "Go" in missing:
                print("  - Go: https://go.dev/dl/")
            if "Node.js" in missing:
                print("  - Node.js: https://nodejs.org/")
            if "pnpm" in missing:
                print("  - pnpm: npm install -g pnpm")
            sys.exit(1)
        
        # Check Inno Setup
        if self.inno_compiler:
            print(f"   ✓ Inno Setup: {self.inno_compiler}")
        else:
            self.print_warning("Inno Setup not found - installer compilation will be skipped")
            print("     Download from: https://jrsoftware.org/isdl.php")
        
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
        
        directories = [
            self.build_dir,
            self.build_dir / "frontend",
            self.build_dir / "db",
            self.output_dir,  # Ensure output directory exists for Inno Setup
        ]
        
        for directory in directories:
            directory.mkdir(parents=True, exist_ok=True)
            
        self.print_success("Build directory structure created")
        
    def build_webdavhub_and_frontend(self):
        """Build WebDavHub and Frontend using existing build script"""
        self.print_header("Building WebDavHub & Frontend")
        
        build_script = self.webdavhub_dir / "scripts" / "build-prod.py"
        
        if not build_script.exists():
            self.print_error(f"Build script not found: {build_script}")
            sys.exit(1)
            
        self.print_step("Running WebDavHub build-prod.py...")
        
        try:
            result = subprocess.run(
                [sys.executable, str(build_script)],
                cwd=self.webdavhub_dir,
                check=True
            )
            self.print_success("WebDavHub and Frontend built successfully")
            
        except subprocess.CalledProcessError as e:
            self.print_error("Failed to build WebDavHub/Frontend")
            sys.exit(1)
            
    def copy_webdavhub_binary(self):
        self.print_step("Copying WebDavHub binary...")
        
        source_exe = self.webdavhub_dir / "cinesync.exe"
        source_bin = self.webdavhub_dir / "cinesync"
        
        if source_exe.exists():
            dest = self.build_dir / "CineSync.exe"
            shutil.copy2(source_exe, dest)
            self.print_success(f"Copied: {source_exe.name} -> {dest.name}")
        elif source_bin.exists():
            dest = self.build_dir / "CineSync.exe"
            shutil.copy2(source_bin, dest)
            self.print_success(f"Copied: {source_bin.name} -> {dest.name}")
        else:
            self.print_error("WebDavHub binary not found (cinesync.exe or cinesync)")
            sys.exit(1)
            
    def copy_frontend_build(self):
        self.print_step("Copying frontend build...")
        
        frontend_dist = self.webdavhub_dir / "frontend" / "dist"
        
        if not frontend_dist.exists():
            self.print_error(f"Frontend build not found: {frontend_dist}")
            sys.exit(1)
            
        dest = self.build_dir / "frontend" / "dist"
        
        if dest.exists():
            shutil.rmtree(dest)
            
        shutil.copytree(frontend_dist, dest)
        self.print_success(f"Copied: frontend/dist -> {dest}")
        
    def build_mediahub(self):
        """Build MediaHub using PyInstaller"""
        self.print_header("Building MediaHub Python Backend")
        
        spec_file = self.mediahub_dir / "MediaHub.spec"
        
        if not spec_file.exists():
            self.print_error(f"MediaHub.spec not found: {spec_file}")
            sys.exit(1)
            
        self.print_step("Building MediaHub with PyInstaller...")
        
        try:
            # Run PyInstaller with the spec file
            result = subprocess.run(
                ["pyinstaller", "--clean", "--noconfirm", str(spec_file)],
                cwd=self.mediahub_dir,
                check=True
            )
            self.print_success("MediaHub built successfully")
            
            # Clean up PyInstaller artifacts
            build_folder = self.mediahub_dir / "build"
            dist_folder = self.mediahub_dir / "dist"
            
            if build_folder.exists():
                shutil.rmtree(build_folder)
                print(f"   ✓ Cleaned up build folder")
            
            if dist_folder.exists():
                shutil.rmtree(dist_folder)
                print(f"   ✓ Cleaned up dist folder")
            
        except subprocess.CalledProcessError:
            self.print_error("Failed to build MediaHub with PyInstaller")
            sys.exit(1)
            
    def copy_mediahub_binary(self):
        """Copy MediaHub binary to build directory (in MediaHub subfolder)"""
        self.print_step("Copying MediaHub binary...")
        
        # MediaHub.exe is built directly in MediaHub/ folder (spec file moves it there)
        source = self.mediahub_dir / "MediaHub.exe"
        
        if not source.exists():
            self.print_error(f"MediaHub binary not found: {source}")
            self.print_error("Make sure PyInstaller build completed successfully")
            sys.exit(1)
        
        mediahub_dest_dir = self.build_dir / "MediaHub"
        mediahub_dest_dir.mkdir(parents=True, exist_ok=True)
        
        dest = mediahub_dest_dir / "MediaHub.exe"
        shutil.copy2(source, dest)
        
        size_mb = source.stat().st_size / (1024 * 1024)
        self.print_success(f"Copied: MediaHub/MediaHub.exe ({size_mb:.1f} MB)")
        
        ffprobe_source = self.dist_dir / "ffprobe.exe"
        if not ffprobe_source.exists():
            print("   ⬇ Downloading ffprobe.exe...")
            self.download_ffprobe(ffprobe_source)
        
        if ffprobe_source.exists():
            ffprobe_dest = mediahub_dest_dir / "ffprobe.exe"
            shutil.copy2(ffprobe_source, ffprobe_dest)
            ffprobe_size_mb = ffprobe_source.stat().st_size / (1024 * 1024)
            self.print_success(f"Copied: MediaHub/ffprobe.exe ({ffprobe_size_mb:.1f} MB)")
        else:
            self.print_warning("ffprobe.exe not found - Media metadata extraction may be limited")
        
    def copy_additional_files(self):
        self.print_step("Copying additional files...")
        
        nssm_source = self.dist_dir / "nssm.exe"
        if not nssm_source.exists():
            print("   ⬇ Downloading nssm.exe...")
            self.download_nssm(nssm_source)
        
        if nssm_source.exists():
            dest = self.build_dir / "nssm.exe"
            shutil.copy2(nssm_source, dest)
            print(f"   ✓ Copied: nssm.exe")
        else:
            self.print_warning("nssm.exe not found - Windows service functionality may be limited")
        
        rclone_source = self.dist_dir / "rclone.exe"
        if not rclone_source.exists():
            print("   ⬇ Downloading rclone.exe...")
            self.download_rclone(rclone_source)
        
        if rclone_source.exists():
            utils_dir = self.build_dir / "utils"
            utils_dir.mkdir(parents=True, exist_ok=True)
            dest = utils_dir / "rclone.exe"
            shutil.copy2(rclone_source, dest)
            rclone_size_mb = rclone_source.stat().st_size / (1024 * 1024)
            print(f"   ✓ Copied: utils/rclone.exe ({rclone_size_mb:.1f} MB)")
        else:
            self.print_warning("rclone.exe not found - Real-Debrid mounting functionality may be limited")
            
        readme_source = self.root_dir / "README.md"
        if readme_source.exists():
            dest = self.build_dir / "README.md"
            shutil.copy2(readme_source, dest)
            print(f"   ✓ Copied: README.md")
            
        license_source = self.root_dir / "LICENSE"
        if license_source.exists():
            dest = self.build_dir / "LICENSE"
            shutil.copy2(license_source, dest)
            print(f"   ✓ Copied: LICENSE")
            
        self.print_success("Additional files copied")
        
    def create_build_info(self):
        """Create a build info file"""
        self.print_step("Creating build info...")
        
        build_info = {
            "version": self.VERSION,
            "build_date": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "components": {
                "CineSync.exe": "WebDavHub Go Backend",
                "MediaHub.exe": "MediaHub Python Backend",
                "frontend/dist": "React Frontend"
            }
        }
        
        info_file = self.build_dir / "BUILD_INFO.txt"
        
        with open(info_file, 'w') as f:
            f.write(f"CineSync Installer Build Information\n")
            f.write(f"{'='*50}\n\n")
            f.write(f"Version: {build_info['version']}\n")
            f.write(f"Build Date: {build_info['build_date']}\n\n")
            f.write(f"Components:\n")
            for component, description in build_info['components'].items():
                f.write(f"  - {component}: {description}\n")
                
        self.print_success(f"Build info created: {info_file.name}")
        
    def display_summary(self, installer_compiled=False):
        """Display build summary"""
        self.print_header("Build Summary")
        
        print("Build completed successfully!")
        print(f"\nOutput directory: {self.build_dir}")
        print(f"\nContents:")
        
        # List all files in build directory
        for item in sorted(self.build_dir.rglob("*")):
            if item.is_file():
                rel_path = item.relative_to(self.build_dir)
                size_mb = item.stat().st_size / (1024 * 1024)
                print(f"  📄 {rel_path} ({size_mb:.1f} MB)")
                
        print(f"\n{'='*70}")
        
        if installer_compiled:
            print("✅ Windows Installer Ready!")
            print(f"   Location: installer/output/CineSync-Setup-{self.VERSION}.exe")
            print("\nYou can now install CineSync on Windows systems.")
        else:
            print("Next steps:")
            print("  1. Review the build output in installer/build/")
            if self.inno_compiler:
                print("  2. Installer compilation in progress...")
            else:
                print("  2. Install Inno Setup: https://jrsoftware.org/isdl.php")
                print("  3. Run BUILD_INSTALLER.bat to create the Windows installer")
                print("  4. The installer will be created in installer/output/")
        
        print(f"{'='*70}\n")
        
    def run(self):
        """Main build process"""
        try:
            self.print_header(f"CineSync Installer Builder v{self.VERSION}")
            
            self.check_prerequisites()
            
            if self.clean_build:
                self.clean_build_directory()
                
            self.create_build_directory()
            
            self.build_webdavhub_and_frontend()
            self.copy_webdavhub_binary()
            self.copy_frontend_build()
            
            self.build_mediahub()
            self.copy_mediahub_binary()
            
            self.copy_additional_files()
            self.create_build_info()
            self.cleanup_temp_files()
            
            installer_compiled = self.compile_installer()
            
            if installer_compiled:
                self.print_step("Cleaning up build directory...")
                shutil.rmtree(self.build_dir)
                self.print_success("Build directory cleaned")
            
            self.display_summary(installer_compiled)
            
            return 0
            
        except KeyboardInterrupt:
            self.print_error("\nBuild cancelled by user")
            return 1
        except Exception as e:
            self.print_error(f"Unexpected error: {e}")
            import traceback
            traceback.print_exc()
            return 1
    
    def cleanup_temp_files(self):
        """Clean up temporary download files"""
        self.print_step("Cleaning up temporary files...")
        
        temp_files = [
            self.dist_dir / "nssm_temp.zip",
            self.dist_dir / "ffmpeg_temp.zip",
            self.dist_dir / "rclone_temp.zip",
        ]
        
        cleaned = 0
        for temp_file in temp_files:
            if temp_file.exists():
                temp_file.unlink()
                cleaned += 1
        
        # Also clean up any extracted directories
        for item in self.dist_dir.glob("nssm-*"):
            if item.is_dir():
                shutil.rmtree(item)
                cleaned += 1
        
        for item in self.dist_dir.glob("ffmpeg-*"):
            if item.is_dir():
                shutil.rmtree(item)
                cleaned += 1
        
        for item in self.dist_dir.glob("rclone-*"):
            if item.is_dir():
                shutil.rmtree(item)
                cleaned += 1
        
        if cleaned > 0:
            print(f"   ✓ Cleaned up {cleaned} temporary file(s)")
        else:
            print(f"   ✓ No temporary files to clean")
    
    def compile_installer(self):
        """Compile the installer with Inno Setup"""
        if not self.inno_compiler:
            self.print_warning("Skipping installer compilation - Inno Setup not found")
            print("  To compile manually:")
            print("  1. Install Inno Setup from https://jrsoftware.org/isdl.php")
            print("  2. Open installer/CineSync-Installer.iss in Inno Setup")
            print("  3. Click Build > Compile")
            return False
        
        self.print_header("Compiling Windows Installer")
        self.print_step("Running Inno Setup compiler...")
        
        iss_file = self.dist_dir / "CineSync-Installer.iss"
        
        if not iss_file.exists():
            self.print_error(f"Inno Setup script not found: {iss_file}")
            return False
        
        try:
            result = subprocess.run(
                [str(self.inno_compiler), str(iss_file)],
                capture_output=True,
                text=True,
                check=True,
                cwd=str(self.dist_dir)
            )
            
            # Check if installer was created
            expected_output = self.output_dir / f"CineSync-Setup-{self.VERSION}.exe"
            if expected_output.exists():
                size_mb = expected_output.stat().st_size / (1024 * 1024)
                self.print_success(f"Installer created: {expected_output.name} ({size_mb:.1f} MB)")
                return True
            else:
                self.print_warning("Installer compilation completed but output file not found")
                return False
                
        except subprocess.CalledProcessError as e:
            self.print_error("Failed to compile installer")
            if e.stdout:
                print(f"\nOutput:\n{e.stdout}")
            if e.stderr:
                print(f"\nErrors:\n{e.stderr}")
            return False
    
    def download_nssm(self, dest_path):
        """Download nssm.exe with fallback mirrors"""
        urls = [
            ("https://nssm.cc/ci/nssm-2.24-101-g897c7ad.zip", "official site"),
            ("https://github.com/CineSync/binaries/releases/download/v1.0/nssm-2.24-101-g897c7ad.zip", "CineSync mirror")
        ]
        
        for url, source in urls:
            try:
                temp_zip = self.dist_dir / "nssm_temp.zip"
                
                print(f"      Downloading from {source}...")
                
                req = urllib.request.Request(
                    url,
                    headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}
                )
                
                with urllib.request.urlopen(req, timeout=30) as response:
                    with open(temp_zip, 'wb') as out_file:
                        out_file.write(response.read())
                
                with zipfile.ZipFile(temp_zip, 'r') as zip_ref:
                    nssm_path = "nssm-2.24-101-g897c7ad/win64/nssm.exe"
                    zip_ref.extract(nssm_path, self.dist_dir)
                    
                    extracted = self.dist_dir / nssm_path
                    shutil.move(str(extracted), str(dest_path))
                
                temp_zip.unlink()
                temp_dir = self.dist_dir / "nssm-2.24-101-g897c7ad"
                if temp_dir.exists():
                    shutil.rmtree(temp_dir)
                
                print(f"      ✓ Downloaded nssm.exe successfully")
                return
                
            except Exception as e:
                print(f"      ✗ Failed to download from {source}: {e}")
                if temp_zip.exists():
                    temp_zip.unlink()
                continue
        
        print(f"      ✗ All download sources failed")
        print(f"      Manual options:")
        print(f"         1. winget install nssm (recommended)")
        print(f"         2. Download from: https://nssm.cc/download")
        print(f"      Then place nssm.exe in: {self.dist_dir}")
    
    def download_ffprobe(self, dest_path):
        """Download ffprobe.exe from GitHub releases"""
        try:
            # FFmpeg essentials build - STATIC VERSION (all dependencies included)
            url = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip"
            temp_zip = self.dist_dir / "ffmpeg_temp.zip"
            
            print(f"      Downloading ffmpeg static build from GitHub...")
            print(f"      This may take a moment (~150MB download)...")
            
            # Download with progress indication
            def download_progress(block_num, block_size, total_size):
                downloaded = block_num * block_size
                if total_size > 0:
                    percent = min(downloaded * 100.0 / total_size, 100)
                    if block_num % 50 == 0:  # Update every 50 blocks
                        print(f"      Progress: {percent:.1f}%", end='\r')
            
            urllib.request.urlretrieve(url, temp_zip, reporthook=download_progress)
            print(f"      Progress: 100.0%")
            
            # Extract only ffprobe.exe from the zip
            print(f"      Extracting ffprobe.exe...")
            with zipfile.ZipFile(temp_zip, 'r') as zip_ref:
                # Find ffprobe.exe in the bin folder
                ffprobe_found = False
                for file in zip_ref.namelist():
                    if file.endswith('bin/ffprobe.exe'):
                        zip_ref.extract(file, self.dist_dir)
                        extracted = self.dist_dir / file
                        shutil.move(str(extracted), str(dest_path))
                        ffprobe_found = True
                        break
                
                if not ffprobe_found:
                    raise Exception("ffprobe.exe not found in archive")
            
            # Verify the extracted file size
            if dest_path.exists():
                size_mb = dest_path.stat().st_size / (1024 * 1024)
                if size_mb < 10:
                    raise Exception(f"Downloaded file too small ({size_mb:.1f} MB) - expected ~50MB")
                print(f"      ✓ Downloaded ffprobe.exe successfully ({size_mb:.1f} MB)")
            
            # Clean up temp files
            if temp_zip.exists():
                temp_zip.unlink()
            # Remove extracted folder structure
            for item in self.dist_dir.glob("ffmpeg-*"):
                if item.is_dir():
                    shutil.rmtree(item)
            
        except Exception as e:
            print(f"      ✗ Failed to download ffprobe.exe: {e}")
            print(f"      Please download manually from: https://github.com/BtbN/FFmpeg-Builds/releases")
            print(f"      Extract ffprobe.exe from the bin folder to: {dest_path}")

    def download_rclone(self, dest_path):
        """Download rclone.exe from official rclone.org"""
        try:
            # Rclone official Windows 64-bit build
            url = "https://downloads.rclone.org/rclone-current-windows-amd64.zip"
            temp_zip = self.dist_dir / "rclone_temp.zip"
            
            print(f"      Downloading rclone from rclone.org...")
            print(f"      This may take a moment (~15MB download)...")
            
            # Download with progress indication
            def download_progress(block_num, block_size, total_size):
                downloaded = block_num * block_size
                if total_size > 0:
                    percent = min(downloaded * 100.0 / total_size, 100)
                    if block_num % 50 == 0:  # Update every 50 blocks
                        print(f"      Progress: {percent:.1f}%", end='\r')
            
            urllib.request.urlretrieve(url, temp_zip, reporthook=download_progress)
            print(f"      Progress: 100.0%")
            
            # Extract rclone.exe from the zip
            print(f"      Extracting rclone.exe...")
            with zipfile.ZipFile(temp_zip, 'r') as zip_ref:
                # Find rclone.exe in the archive
                rclone_found = False
                for file in zip_ref.namelist():
                    if file.endswith('rclone.exe'):
                        zip_ref.extract(file, self.dist_dir)
                        extracted = self.dist_dir / file
                        shutil.move(str(extracted), str(dest_path))
                        rclone_found = True
                        break
                
                if not rclone_found:
                    raise Exception("rclone.exe not found in archive")
            
            # Clean up temp files
            if temp_zip.exists():
                temp_zip.unlink()
            # Remove extracted folder structure
            for item in self.dist_dir.glob("rclone-*"):
                if item.is_dir():
                    shutil.rmtree(item)
            
        except Exception as e:
            print(f"      ✗ Failed to download rclone.exe: {e}")
            print(f"      Please download manually from: https://rclone.org/downloads/")
            print(f"      Extract rclone.exe to: {dest_path}")


def main():
    """Main entry point"""
    parser = argparse.ArgumentParser(
        description="CineSync Installer Build Script",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__
    )
    
    parser.add_argument(
        "--clean",
        action="store_true",
        help="Clean build directory before building"
    )
    
    args = parser.parse_args()
    
    builder = CineSyncInstallerBuilder(clean_build=args.clean)
    sys.exit(builder.run())


if __name__ == "__main__":
    main()
