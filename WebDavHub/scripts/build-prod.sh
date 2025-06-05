#!/bin/bash
# Bash script to build WebDavHub for production

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
    echo "WebDavHub Production Build Script"
    echo "================================="
    echo ""
    echo "This script builds the WebDavHub project for production:"
    echo "- Installs frontend dependencies (if needed)"
    echo "- Builds React frontend for production"
    echo "- Builds Go backend with optimizations"
    echo "- Creates a single binary with embedded frontend"
    echo ""
    echo "Usage: ./build-prod.sh"
    echo "       ./build-prod.sh --help"
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

echo "🏭 Building WebDavHub for Production..."
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
        echo "❌ Error: Could not find WebDavHub directory with main.go"
        echo "Please run this script from the WebDavHub directory or its scripts subdirectory."
        exit 1
    fi
fi

# Verify we have the required files
if [[ ! -f "main.go" ]]; then
    echo "❌ Error: main.go not found in current directory."
    exit 1
fi

if [[ ! -d "frontend" ]]; then
    echo "❌ Error: frontend directory not found."
    exit 1
fi

# Ensure Go dependencies are up to date
echo "🔧 Updating Go dependencies..."
if go mod tidy; then
    echo "✅ Go dependencies updated"
else
    echo "❌ Failed to update Go dependencies"
    exit 1
fi

# Install frontend dependencies
echo "📦 Installing frontend dependencies..."
cd frontend

# Check if pnpm is available, install if not
if ! command -v pnpm &> /dev/null; then
    echo "pnpm not found. Installing pnpm..."
    # Ensure npm is available
    if ! command -v npm &> /dev/null; then
        echo "❌ npm not found. Please install Node.js and npm first."
        exit 1
    fi
    if npm install -g pnpm; then
        echo "✅ pnpm installed successfully"
        # Refresh PATH to ensure pnpm is available
        export PATH="$PATH:$(npm config get prefix)/bin"
    else
        echo "❌ Failed to install pnpm"
        exit 1
    fi
fi

echo "Using package manager: pnpm"

if [[ ! -d "node_modules" ]]; then
    if pnpm install; then
        echo "✅ Frontend dependencies installed"
    else
        echo "❌ Failed to install frontend dependencies"
        exit 1
    fi
else
    echo "✅ Frontend dependencies ready"
fi

# Build React frontend for production
echo "⚛️ Building React frontend for production..."
if pnpm run build; then
    echo "✅ Frontend built successfully"
else
    echo "❌ Failed to build frontend"
    exit 1
fi

cd ..

# Build Go backend with optimizations
echo "🔧 Building Go backend for production..."
if go build -ldflags="-s -w" -o cinesync .; then
    echo "✅ Go backend built successfully"
else
    echo "❌ Failed to build Go backend"
    exit 1
fi

echo ""
echo "🎉 Production build completed successfully!"
echo ""
echo "Output files:"
echo "- cinesync (Production binary)"
echo "- frontend/dist/ (Built React app)"
echo ""
echo "Next steps:"
echo "- Run ./start-prod.sh to start production servers"
echo "- Frontend will be available at http://localhost:5173"
echo "- Backend API will be available at http://localhost:8082"
