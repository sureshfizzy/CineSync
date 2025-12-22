# CineSync Distribution

This directory contains platform-specific build scripts and installers for CineSync.

## Directory Structure

```
distribution/
├── windows/          # Windows installer
│   ├── build_installer.py
│   ├── CineSync-Installer.iss
│   └── README.md
├── linux/            # Linux package
│   ├── build_installer.py
│   ├── install.sh
│   ├── uninstall.sh
│   ├── cinesync.service
│   └── README.md
└── macos/            # macOS app bundle
    ├── build_installer.py
    ├── install.sh
    ├── uninstall.sh
    ├── com.cinesync.app.plist
    └── README.md
```

## Platform Support

### Windows
- **Installer**: Inno Setup executable (`.exe`)
- **Service**: NSSM Windows Service
- **Location**: `C:\Program Files\CineSync`
- **Build**: Native or cross-compile from any platform

### Linux
- **Package**: Tarball (`.tar.gz`)
- **Service**: systemd service
- **Location**: `/opt/cinesync/`
- **Build**: Native or cross-compile from any platform

### macOS
- **Package**: Tarball with app bundle
- **Service**: LaunchAgent
- **Location**: `/Applications/CineSync.app/`
- **Build**: Native or cross-compile from any platform

## Building

Each platform has its own `build_installer.py` script that can be run from any platform:

### From Windows (CMD)
```cmd/powershell
# Build for Windows
cd distribution\windows
python build_installer.py

# Build for Linux
cd distribution\linux
python build_installer.py

# Build for macOS
cd distribution\macos
python build_installer.py
```

### From Linux/macOS (Bash)
```bash
# Build for Linux
cd distribution/linux
python3 build_installer.py

# Build for macOS
cd distribution/macos
python3 build_installer.py

# Build for Windows
cd distribution/windows
python3 build_installer.py
```

## Build Process

Each build script performs these steps:

1. **Go Build** - Compiles WebDavHub server for target platform
2. **Frontend Build** - Builds React frontend (platform-independent)
3. **MediaHub** - Compiles with PyInstaller (native only) or packages Python source
4. **Utilities** - Downloads platform-specific rclone and ffprobe
5. **Package** - Creates installer/package for target platform

## Cross-Platform Building

### What Works
- ✅ Go server compilation (Windows → Linux/macOS and vice versa)
- ✅ Frontend building (platform-independent)
- ✅ Package creation (all platforms can create packages for all targets)

### What Doesn't Work
- ❌ PyInstaller cross-compilation (must compile MediaHub on target platform)
- **Workaround**: Python source is packaged instead, installed platform uses venv

## Build Outputs

### Windows
- `build/CineSync.exe` - WebDAV server
- `build/MediaHub/MediaHub.exe` - Compiled MediaHub (if built on Windows)
- `installer/output/CineSync-Setup-*.exe` - Inno Setup installer

### Linux
- `build/cinesync` - WebDAV server binary
- `build/cinesync-linux-amd64.tar.gz` - Complete package
- `build/install.sh` - Installation script

### macOS
- `build/cinesync` - WebDAV server binary
- `build/CineSync-macOS.tar.gz` - Complete package with app bundle
- `build/install.sh` - Installation script

## Downloaded Utilities

During build, these utilities are automatically downloaded:

### All Platforms
- **rclone** - Remote filesystem mounting
- **ffprobe** - Media metadata extraction

### Windows Only
- **nssm** - Windows service manager

These are cached in the distribution directory and reused across builds. They are **not** committed to git (see `.gitignore`).

## Installation

See platform-specific README files:
- [Windows Installation Guide](windows/README.md)
- [Linux Installation Guide](linux/README.md)
- [macOS Installation Guide](macos/README.md)

## Architecture

### Single Service Architecture

CineSync uses a single-service architecture on all platforms:

- **Main Process**: WebDavHub (Go server)
- **Subprocess**: MediaHub (Python backend)
- **Frontend**: Embedded React app served by WebDavHub

### Service Management

| Platform | Service Manager | Service Name | User |
|----------|----------------|--------------|------|
| Windows  | NSSM           | CineSync     | LocalSystem |
| Linux    | systemd        | cinesync.service | root |
| macOS    | LaunchAgent    | com.cinesync.app | current user |

### Directory Structure

**Windows**:
```
C:\Program Files\CineSync\
├── WebDavHub\
│   ├── CineSync.exe
│   └── frontend\dist\
├── MediaHub\
│   ├── MediaHub.exe (or Python source)
│   └── ffprobe.exe
└── utils\
    └── rclone.exe
```

**Linux**:
```
/opt/cinesync/
├── WebDavHub\
│   ├── cinesync
│   └── frontend\dist\
├── MediaHub\
│   ├── MediaHub (or Python source)
│   └── ffprobe
├── db\
├── logs\
└── utils\
    └── rclone
```

**macOS**:
```
/Applications/CineSync.app/
└── Contents\
    ├── MacOS\
    │   └── cinesync (launcher script)
    └── Resources\
        ├── WebDavHub\
        ├── MediaHub\
        ├── db\
        └── utils\
```

## Development vs Production

### Development (start-prod)
- Uses relative paths (`./db`, `./logs`)
- Runs from source code directory
- Python runs directly (not compiled)
- No service installation

### Production Environment
- Uses absolute system paths
- Runs as system service
- Auto-starts on boot

## Troubleshooting

### Build Issues

**Go build fails**:
- Ensure Go 1.21+ is installed
- Check `GOOS` and `GOARCH` environment variables for cross-compilation

**Frontend build fails**:
- Ensure Node.js and npm are installed
- Run `pnpm install` in `WebDavHub/frontend` directory

**PyInstaller fails**:
- Only works on native platform
- Cross-platform builds will package Python source instead

### Installation Issues

**Windows service won't start**:
- Check if WinFsp is installed (required for rclone mounting)
- Verify NSSM is properly installed

**Linux service fails**:
- Check systemd logs: `journalctl -u cinesync -f`
- Verify permissions on `/opt/cinesync/`

**macOS LaunchAgent issues**:
- Check logs in `/tmp/cinesync-logs/`
- Verify LaunchAgent is loaded: `launchctl list | grep cinesync`

## Notes

- All builds create self-contained packages with all dependencies
- Utilities (rclone, ffprobe, nssm) are bundled in installers
- Database and configuration persist across updates
- Logs are stored in platform-specific locations

## Contributing

When adding new features:
1. Update all three build scripts if changes affect packaging
2. Test builds on all platforms (or use cross-compilation)
3. Update platform-specific README files
4. Ensure `.gitignore` excludes build artifacts
