#!/bin/bash
# Bash script to stop all WebDavHub servers

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
    echo "WebDavHub Server Stop Script"
    echo "============================="
    echo ""
    echo "This script stops all running WebDavHub servers:"
    echo "- Kills processes using ports $UI_PORT and $API_PORT"
    echo "- Stops webdavhub and cinesync processes"
    echo ""
    echo "Usage: ./stop-servers.sh"
    echo "       ./stop-servers.sh --help"
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

echo "🛑 Stopping WebDavHub servers..."
echo ""

# Function to kill processes by port
stop_process_by_port() {
    local port=$1
    echo "Checking port $port..."
    
    local pids=$(lsof -ti:$port 2>/dev/null || true)
    if [[ -n "$pids" ]]; then
        echo "  Found processes using port $port: $pids"
        for pid in $pids; do
            local process_name=$(ps -p $pid -o comm= 2>/dev/null || echo "unknown")
            echo "  Stopping process: $process_name (PID: $pid)"
            kill -TERM $pid 2>/dev/null || true
            sleep 1
            # Force kill if still running
            if kill -0 $pid 2>/dev/null; then
                echo "  Force killing process: $process_name (PID: $pid)"
                kill -KILL $pid 2>/dev/null || true
            fi
        done
    else
        echo "  No processes found using port $port"
    fi
}

# Function to kill processes by name
stop_process_by_name() {
    local process_name=$1
    echo "Checking for $process_name processes..."
    
    local pids=$(pgrep -f "$process_name" 2>/dev/null || true)
    if [[ -n "$pids" ]]; then
        echo "  Found $process_name processes: $pids"
        for pid in $pids; do
            echo "  Stopping process: $process_name (PID: $pid)"
            kill -TERM $pid 2>/dev/null || true
            sleep 1
            # Force kill if still running
            if kill -0 $pid 2>/dev/null; then
                echo "  Force killing process: $process_name (PID: $pid)"
                kill -KILL $pid 2>/dev/null || true
            fi
        done
    else
        echo "  No $process_name processes found"
    fi
}

# Stop processes by port
echo "Checking ports..."
stop_process_by_port $UI_PORT
stop_process_by_port $API_PORT

echo ""
echo "Checking process names..."
stop_process_by_name "webdavhub"
stop_process_by_name "cinesync"
stop_process_by_name "node.*vite"

echo ""
echo "Server stop completed!"
echo ""
echo "You can now run ./start-prod.sh or ./start-dev.sh"
