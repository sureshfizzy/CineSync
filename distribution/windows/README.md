# CineSync Windows Build

## Prerequisites

- Python 3.8 or higher
- Go 1.21 or higher
- Node.js and npm
- Inno Setup 6 (for installer creation)

## Building

Run the build script:

```powershell
python build_installer.py
```

This will:
1. Build the Go WebDAV server (`CineSync.exe`)
2. Build the React frontend
3. Compile MediaHub with PyInstaller
4. Download required utilities (rclone, ffprobe, nssm)
5. Create the Inno Setup installer in `installer/output/`

## Build Output

- **Executable**: `build/CineSync.exe` - Main WebDAV server
- **MediaHub**: `build/MediaHub/MediaHub.exe` - Media management service
- **Installer**: `installer/output/CineSync-Setup-*.exe` - Windows installer

## Installation

Run the generated installer. It will:
- Install to `C:\Program Files\CineSync` by default
- Create a Windows service using NSSM
- Start the service automatically
- Create desktop shortcut to web interface (http://localhost:8082)

## Service Management

```powershell
# Check service status
nssm status CineSync

# Start service
nssm start CineSync

# Stop service
nssm stop CineSync

# Restart service
nssm restart CineSync
```

## Uninstallation

Use Windows "Add or Remove Programs" or run the uninstaller from the installation directory.

## Notes

- Default port: 8082 (configurable via environment variables)
- Database and logs are stored in the installation directory
- MediaHub runs as a subprocess of the main CineSync service
