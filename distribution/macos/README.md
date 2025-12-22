# CineSync macOS Build

## Prerequisites

- Python 3.8 or higher
- Go 1.21 or higher
- Node.js and npm
- macFUSE (for rclone mounting)

## Building

### On macOS

```bash
python3 build_installer.py
```

### Cross-compile from Windows

```powershell
python build_installer.py
```

This will:
1. Build the Go WebDAV server for macOS
2. Build the React frontend
3. Package MediaHub Python source (PyInstaller only works on native platform)
4. Download rclone for macOS
5. Create application bundle in `build/`

## Build Output

- **Package**: `build/CineSync-macOS.tar.gz` - Complete installation package
- **App Bundle**: `build/CineSync.app/` - macOS application bundle
- **Installer**: `build/install.sh` - Installation script
- **Uninstaller**: `build/uninstall.sh` - Uninstallation script

## Installation

```bash
# Extract package
tar -xzf CineSync-macOS.tar.gz
cd CineSync-macOS

# Run installer
sudo bash install.sh
```

The installer will:
- Install to `/Applications/CineSync.app/`
- Create LaunchAgent for automatic startup
- Start the service
- Create necessary directories

## Service Management

```bash
# Check service status
launchctl list | grep cinesync

# Start service
launchctl load ~/Library/LaunchAgents/com.cinesync.app.plist

# Stop service
launchctl unload ~/Library/LaunchAgents/com.cinesync.app.plist

# View logs
tail -f /tmp/cinesync-logs/cinesync.log
```

## Uninstallation

```bash
cd /Applications/CineSync.app/Contents/Resources
sudo bash uninstall.sh
```

## Directory Structure

```
/Applications/CineSync.app/
└── Contents/
    ├── MacOS/              # Launcher script
    └── Resources/
        ├── WebDavHub/      # Main server binary
        ├── MediaHub/       # Media management service
        ├── db/             # Database and configuration
        └── utils/          # Utilities (rclone, ffprobe)
```

## Notes

- Default port: 8082 (configure in `.env` file)
- Logs stored in `/tmp/cinesync-logs/`
- Database stored in application bundle
- Requires macFUSE for rclone mounting
- Service runs as user (not root)
- MediaHub runs as a subprocess managed by the main service

## macFUSE Installation

Download and install from: https://osxfuse.github.io/

Or using Homebrew:
```bash
brew install --cask macfuse
```
