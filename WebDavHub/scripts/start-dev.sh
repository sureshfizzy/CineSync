#!/bin/bash
# Bash script to start WebDavHub development servers

set -e

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

show_help() {
    echo "WebDavHub Development Start Script"
    echo "=================================="
    echo ""
    echo "This script starts the WebDavHub development servers:"
    echo "- React development server on port $UI_PORT"
    echo "- Go backend API server on port $API_PORT"
    echo ""
    echo "Usage: ./start-dev.sh [options]"
    echo ""
    echo "Options:"
    echo "  --help         Show this help message"
    echo "  --backend-only Start only the Go backend server"
    echo "  --frontend-only Start only the React frontend server"
    echo ""
    echo "Note: Run ./build-dev.sh first to build the project"
    exit 0
}

BACKEND_ONLY=false
FRONTEND_ONLY=false

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --help|-h)
            show_help
            ;;
        --backend-only)
            BACKEND_ONLY=true
            ;;
        --frontend-only)
            FRONTEND_ONLY=true
            ;;
        *)
            echo "Unknown option: $1"
            echo "Use --help for usage information"
            exit 1
            ;;
    esac
    shift
done

echo "Starting WebDavHub Development Servers..."
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

# Check if build exists
if [[ "$FRONTEND_ONLY" != "true" && ! -f "cinesync" ]]; then
    echo "Error: cinesync binary not found. Please run ./build-dev.sh first."
    exit 1
fi

# Function to start frontend server
start_frontend() {
    echo "Starting React development server on port $UI_PORT..."
    cd frontend

    # Determine which pnpm command to use
    if command -v pnpm &> /dev/null; then
        echo "Using package manager: pnpm"
        pnpm run dev
    elif [[ -f "$HOME/.local/bin/pnpm" ]]; then
        echo "Using package manager: pnpm (from user directory)"
        export PATH="$HOME/.local/bin:$PATH"
        "$HOME/.local/bin/pnpm" run dev
    else
        echo "Error: pnpm not found. Please run ./scripts/build-dev.sh first."
        echo "If that fails, try: sudo npm install -g pnpm"
        exit 1
    fi
}

# Function to start backend server
start_backend() {
    echo "Starting Go backend server on port $API_PORT..."
    ./cinesync
}

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

# Start servers based on options
if [[ "$FRONTEND_ONLY" == "true" ]]; then
    start_frontend
elif [[ "$BACKEND_ONLY" == "true" ]]; then
    start_backend
else
    # Start both servers (same approach as production)
    echo "Starting both frontend and backend servers..."
    echo ""
    echo "IMPORTANT: When stopping, press Ctrl+C and then run:"
    echo "  ./scripts/stop-servers.sh"
    echo "This ensures both frontend and backend are properly stopped."
    echo ""

    # Start backend server first (same as production)
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

    # Start frontend server second (same as production)
    echo "Starting React development server on port $UI_PORT..."
    # Determine which pnpm command to use
    if command -v pnpm &> /dev/null; then
        echo "Using package manager: pnpm"
        (cd frontend && pnpm run dev) &
    elif [[ -f "$HOME/.local/bin/pnpm" ]]; then
        echo "Using package manager: pnpm (from user directory)"
        export PATH="$HOME/.local/bin:$PATH"
        (cd frontend && "$HOME/.local/bin/pnpm" run dev) &
    else
        echo "Error: pnpm not found. Please run ./scripts/build-dev.sh first."
        echo "If that fails, try: sudo npm install -g pnpm"
        cleanup
    fi
    FRONTEND_PID=$!

    # Wait a moment for frontend to start
    sleep 3

    # Check if frontend is still running
    if ! kill -0 $FRONTEND_PID 2>/dev/null; then
        echo "Frontend server failed to start"
        cleanup
    fi

    echo "Frontend server started successfully"

    # Show server information
    echo ""
    echo "Servers will be available at:"
    echo "Frontend (Vite Dev Server):"
    echo "  Local:   http://localhost:$UI_PORT/"
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
fi

echo ""
echo "Development servers stopped."
