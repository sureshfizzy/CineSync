#!/bin/bash
# Bash script to start WebDavHub production server

set -e

show_help() {
    echo "WebDavHub Production Start Script"
    echo "================================="
    echo ""
    echo "This script starts the WebDavHub production server:"
    echo "- Serves both frontend and backend on port 8082"
    echo "- Frontend is served from built dist files"
    echo "- Backend API is available at /api/"
    echo ""
    echo "Usage: ./start-prod.sh"
    echo "       ./start-prod.sh --help"
    echo ""
    echo "Note: Run ./build-prod.sh first to build the project"
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

echo "🏭 Starting WebDavHub Production Server..."
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

# Check if production build exists
if [[ ! -f "cinesync" ]]; then
    echo "❌ Error: cinesync binary not found. Please run ./build-prod.sh first."
    exit 1
fi

# Check if frontend dist exists
if [[ ! -d "frontend/dist" ]]; then
    echo "❌ Error: frontend/dist not found. Please run ./build-prod.sh first."
    exit 1
fi

echo "🚀 Starting production servers..."
echo ""

# Load environment variables from .env file
if [[ -f "../.env" ]]; then
    # Parse .env file properly, handling quotes
    while IFS='=' read -r key value; do
        # Skip comments and empty lines
        [[ $key =~ ^[[:space:]]*# ]] && continue
        [[ -z $key ]] && continue

        # Remove leading/trailing whitespace
        key=$(echo "$key" | xargs)
        value=$(echo "$value" | xargs)

        # Remove quotes if present
        if [[ $value =~ ^\".*\"$ ]] || [[ $value =~ ^\'.*\'$ ]]; then
            value="${value:1:-1}"
        fi

        # Export the variable
        export "$key=$value"
    done < <(grep -v '^[[:space:]]*#' ../.env | grep '=')
fi

# Get ports from environment variables with defaults
API_PORT=${CINESYNC_API_PORT:-8082}
UI_PORT=${CINESYNC_UI_PORT:-5173}

# Function to cleanup background processes
cleanup() {
    echo ""
    echo "Stopping all servers..."

    # Kill frontend process if running
    if [[ -n "$FRONTEND_PID" ]] && kill -0 $FRONTEND_PID 2>/dev/null; then
        echo "Stopping frontend server..."
        kill $FRONTEND_PID 2>/dev/null || true
        # Wait a moment for graceful shutdown
        sleep 1
        # Force kill if still running
        if kill -0 $FRONTEND_PID 2>/dev/null; then
            kill -9 $FRONTEND_PID 2>/dev/null || true
        fi
    fi

    # Kill backend process if running
    if [[ -n "$BACKEND_PID" ]] && kill -0 $BACKEND_PID 2>/dev/null; then
        echo "Stopping backend server..."
        kill $BACKEND_PID 2>/dev/null || true
        # Wait a moment for graceful shutdown
        sleep 1
        # Force kill if still running
        if kill -0 $BACKEND_PID 2>/dev/null; then
            kill -9 $BACKEND_PID 2>/dev/null || true
        fi
    fi

    echo "All servers stopped."
    exit 0
}

# Set up signal handlers
trap cleanup SIGINT SIGTERM EXIT

# Start backend server first
echo "Starting Go backend server on port $API_PORT..."
# Start backend in its own process group so we can kill it properly
setsid ./cinesync &
BACKEND_PID=$!

# Wait a moment for backend to start
sleep 3

# Check if backend is still running
if ! kill -0 $BACKEND_PID 2>/dev/null; then
    echo "Backend server failed to start"
    exit 1
fi

echo "Backend server started successfully"

# Start frontend server second
echo "Starting React frontend server on port $UI_PORT..."
echo "Using package manager: pnpm"
(cd frontend && pnpm run preview) &
FRONTEND_PID=$!

# Wait a moment for frontend to start
sleep 3

# Check if frontend is still running
if ! kill -0 $FRONTEND_PID 2>/dev/null; then
    echo "Frontend server failed to start"
    cleanup
fi

echo "Frontend server started successfully"

# Get network interfaces and show all available IPs
echo ""
echo "Servers will be available at:"
echo "Frontend (Vite Preview):"
echo "  Local:   http://localhost:$UI_PORT/"

# Get all network interfaces (works on both Linux and Windows with WSL)
if command -v ip >/dev/null 2>&1; then
    # Linux/WSL with ip command
    ip route get 1.1.1.1 2>/dev/null | grep -oP 'src \K\S+' | while read -r ip; do
        echo "  Network: http://$ip:$UI_PORT/"
    done
    # Also get other interfaces
    ip addr show 2>/dev/null | grep -oP 'inet \K[^/]+' | grep -v '127.0.0.1' | while read -r ip; do
        if [[ $ip =~ ^(10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.) ]] || [[ ! $ip =~ ^(10\.|172\.|192\.168\.|169\.254\.) ]]; then
            echo "  Network: http://$ip:$UI_PORT/"
        fi
    done | sort -u
elif command -v ifconfig >/dev/null 2>&1; then
    # macOS/BSD with ifconfig
    ifconfig 2>/dev/null | grep -oE 'inet [0-9.]+' | grep -v '127.0.0.1' | awk '{print $2}' | while read -r ip; do
        if [[ $ip =~ ^(10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.) ]] || [[ ! $ip =~ ^(10\.|172\.|192\.168\.|169\.254\.) ]]; then
            echo "  Network: http://$ip:$UI_PORT/"
        fi
    done | sort -u
fi

echo ""
echo "Backend (Go API):"
echo "- API: http://localhost:$API_PORT/api/"
echo "- WebDAV: http://localhost:$API_PORT/webdav/"
echo ""
echo "Press Ctrl+C to stop all servers"
echo ""

# Wait for either process to finish (this allows Ctrl+C to work properly)
while kill -0 $BACKEND_PID 2>/dev/null && kill -0 $FRONTEND_PID 2>/dev/null; do
    sleep 1
done

# If we get here, one of the processes died
cleanup
