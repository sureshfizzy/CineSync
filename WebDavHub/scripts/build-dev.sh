#!/bin/bash
# Bash script to build WebDavHub for development

set -e

# Setup environment and PATH
setup_environment() {
    # Add common paths for Node.js and Go
    export PATH="$PATH:/usr/local/bin:/usr/local/go/bin"

    # Add npm global bin to PATH if it exists
    if command -v npm &> /dev/null; then
        NPM_PREFIX=$(npm config get prefix 2>/dev/null || echo "")
        if [[ -n "$NPM_PREFIX" && -d "$NPM_PREFIX/bin" ]]; then
            export PATH="$PATH:$NPM_PREFIX/bin"
        fi
    fi

    # Add Go bin to PATH if GOPATH is set
    if [[ -n "$GOPATH" && -d "$GOPATH/bin" ]]; then
        export PATH="$PATH:$GOPATH/bin"
    fi

    # Add user's Go bin directory
    if [[ -d "$HOME/go/bin" ]]; then
        export PATH="$PATH:$HOME/go/bin"
    fi
}

# Setup environment
setup_environment

show_help() {
    echo "WebDavHub Development Build Script"
    echo "=================================="
    echo ""
    echo "This script builds the WebDavHub project for development:"
    echo "- Installs frontend dependencies (if needed)"
    echo "- Builds Go backend"
    echo "- Does NOT start servers (use start-dev.sh for that)"
    echo ""
    echo "Usage: ./build-dev.sh"
    echo "       ./build-dev.sh --help"
    exit 0
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --help|-h)
            show_help
            ;;
        *)
            echo "Unknown option: $1"
            echo "Use --help for usage information"
            exit 1
            ;;
    esac
    shift
done

echo "Building WebDavHub for Development..."
echo ""

# Auto-detect and change to WebDavHub directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEBDAVHUB_DIR="$(dirname "$SCRIPT_DIR")"

# Check if we're already in the WebDavHub directory
if [[ ! -f "main.go" ]]; then
    # Try to find WebDavHub directory
    if [[ -f "$WEBDAVHUB_DIR/main.go" ]]; then
        echo "Changing to WebDavHub directory: $WEBDAVHUB_DIR"
        cd "$WEBDAVHUB_DIR"
    else
        echo "Error: Could not find WebDavHub directory with main.go"
        echo "Please run this script from the WebDavHub directory or its scripts subdirectory."
        exit 1
    fi
fi

# Verify we have the required files
if [[ ! -f "main.go" ]]; then
    echo "Error: main.go not found in current directory."
    exit 1
fi

if [[ ! -d "frontend" ]]; then
    echo "Error: frontend directory not found."
    exit 1
fi

# Ensure Go dependencies are up to date
echo "Updating Go dependencies..."
if go mod tidy; then
    echo "Go dependencies updated"
else
    echo "Failed to update Go dependencies"
    exit 1
fi

# Build Go backend
echo "Building Go backend..."
if go build -o cinesync .; then
    echo "Go backend built successfully"
else
    echo "Failed to build Go backend"
    exit 1
fi

# Install frontend dependencies
echo "Installing frontend dependencies..."
cd frontend

# Check if pnpm is available, install if not
if ! command -v pnpm &> /dev/null && [[ ! -f "$HOME/.local/bin/pnpm" ]]; then
    echo "pnpm not found. Installing pnpm..."
    # Ensure npm is available
    if ! command -v npm &> /dev/null; then
        echo "npm not found. Please install Node.js and npm first."
        exit 1
    fi

    # Try different installation methods
    echo "Trying to install pnpm using corepack..."
    if command -v corepack &> /dev/null; then
        if corepack enable && corepack prepare pnpm@latest --activate; then
            echo "pnpm installed successfully using corepack"
        else
            echo "Corepack installation failed (permission denied)."
            echo "WARNING: If you encounter permission issues, try running with sudo:"
            echo "  sudo bash scripts/build-dev.sh"
            echo ""
            echo "Trying npm with --prefix..."
            # Try installing to user directory instead of global
            NPM_PREFIX="$HOME/.local"
            mkdir -p "$NPM_PREFIX"
            if npm install --prefix "$NPM_PREFIX" pnpm; then
                export PATH="$NPM_PREFIX/bin:$PATH"
                echo "pnpm installed successfully to user directory"
            else
                echo "Failed to install pnpm. Please install pnpm manually:"
                echo "  Option 1: sudo npm install -g pnpm"
                echo "  Option 2: curl -fsSL https://get.pnpm.io/install.sh | sh -"
                echo "  Option 3: sudo bash scripts/build-dev.sh"
                exit 1
            fi
        fi
    else
        echo "Corepack not available, trying npm with --prefix..."
        # Try installing to user directory instead of global
        NPM_PREFIX="$HOME/.local"
        mkdir -p "$NPM_PREFIX"
        if npm install --prefix "$NPM_PREFIX" pnpm; then
            export PATH="$NPM_PREFIX/bin:$PATH"
            echo "pnpm installed successfully to user directory"
        else
            echo "Failed to install pnpm. Please install pnpm manually:"
            echo "  Option 1: sudo npm install -g pnpm"
            echo "  Option 2: curl -fsSL https://get.pnpm.io/install.sh | sh -"
            echo "  Option 3: sudo bash scripts/build-dev.sh"
            exit 1
        fi
    fi
fi

# Determine which pnpm command to use and verify it works
PNPM_CMD=""
if command -v pnpm &> /dev/null; then
    echo "Using package manager: pnpm"
    PNPM_CMD="pnpm"
elif [[ -f "$HOME/.local/bin/pnpm" ]]; then
    echo "Using package manager: pnpm (from user directory)"
    PNPM_CMD="$HOME/.local/bin/pnpm"
    # Add to PATH for this session
    export PATH="$HOME/.local/bin:$PATH"
else
    echo "Error: pnpm not found after installation attempt"
    echo "Please try one of these options:"
    echo "  1. sudo npm install -g pnpm"
    echo "  2. sudo bash scripts/build-dev.sh"
    echo "  3. curl -fsSL https://get.pnpm.io/install.sh | sh - && source ~/.bashrc"
    exit 1
fi

# Verify pnpm works
if ! $PNPM_CMD --version &> /dev/null; then
    echo "Error: pnpm installed but not working properly"
    echo "Please try: sudo npm install -g pnpm"
    exit 1
fi

INSTALL_CMD="$PNPM_CMD install"

if [[ ! -d "node_modules" ]]; then
    if $INSTALL_CMD; then
        echo "Frontend dependencies installed using pnpm"
    else
        echo "Failed to install frontend dependencies using pnpm"
        exit 1
    fi
else
    echo "Frontend dependencies already installed"
fi

cd ..

echo ""
echo "Development build completed successfully!"
echo ""
echo "Next steps:"
echo "- Run ./start-dev.sh to start development servers"
