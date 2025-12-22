# CineSync Linux Build

## Prerequisites

- Python 3.8 or higher
- Go 1.21 or higher
- Node.js and npm
- systemd (for service management)
- fuse3 or fuse (for rclone mounting)

## Building

### On Linux

```bash
python3 build_installer.py
```

### Cross-compile from Windows

```powershell
python build_installer.py
```

This will:
1. Build the Go WebDAV server for Linux
2. Build the React frontend
3. Package MediaHub Python source (PyInstaller only works on native platform)
4. Download rclone for Linux
5. Create installation package in `build/`

## Build Output

- **Package**: `build/cinesync-linux-amd64.tar.gz` - Complete installation package
- **Installer**: `build/install.sh` - Installation script
- **Uninstaller**: `build/uninstall.sh` - Uninstallation script

## Installation

```bash
# Extract package
tar -xzf cinesync-linux-amd64.tar.gz
cd cinesync-linux-amd64

# Run installer (requires root/sudo)
sudo bash install.sh
```

The installer will:
- Install to `/opt/cinesync/`
- Create systemd service (`cinesync.service`)
- Enable and start the service
- Create necessary directories with proper permissions

## Service Management

```bash
# Check service status
sudo systemctl status cinesync

# Start service
sudo systemctl start cinesync

# Stop service
sudo systemctl stop cinesync

# Restart service
sudo systemctl restart cinesync

# View logs
sudo journalctl -u cinesync -f
```

## Uninstallation

```bash
cd /opt/cinesync
sudo bash uninstall.sh
```

## Directory Structure

```
/opt/cinesync/
├── WebDavHub/          # Main server binary
├── MediaHub/           # Media management service
├── db/                 # Database and configuration
├── logs/               # Application logs
└── utils/              # Utilities (rclone, ffprobe)
```

## Notes

- Default port: 8082 (configure in `/opt/cinesync/db/.env`)
- Service runs as root for full filesystem access
- MediaHub runs as a subprocess managed by the main service
- Requires rclone for mounting debrid services
- Requires fuse3/fuse for filesystem mounting
