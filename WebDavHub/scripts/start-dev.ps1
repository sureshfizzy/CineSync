#!/usr/bin/env pwsh
# PowerShell script to start WebDavHub development servers

param(
    [switch]$Help,
    [switch]$BackendOnly,
    [switch]$FrontendOnly
)

# Load environment variables from .env file
$envFile = "..\.env"
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        if ($_ -match "^([^#][^=]+)=(.*)$") {
            $key = $matches[1].Trim()
            $value = $matches[2].Trim()
            # Remove quotes if present
            if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
                $value = $value.Substring(1, $value.Length - 2)
            }
            [Environment]::SetEnvironmentVariable($key, $value, "Process")
        }
    }
}

# Get ports from environment variables
$apiPort = $env:CINESYNC_API_PORT
$uiPort = $env:CINESYNC_UI_PORT

if (-not $apiPort) { $apiPort = "8082" }
if (-not $uiPort) { $uiPort = "5173" }

if ($Help) {
    Write-Host "WebDavHub Development Start Script"
    Write-Host "=================================="
    Write-Host ""
    Write-Host "This script starts the WebDavHub development servers:"
    Write-Host "- React development server on port $uiPort"
    Write-Host "- Go backend API server on port $apiPort"
    Write-Host ""
    Write-Host "Usage: .\start-dev.ps1 [options]"
    Write-Host ""
    Write-Host "Options:"
    Write-Host "  -Help          Show this help message"
    Write-Host "  -BackendOnly   Start only the Go backend server"
    Write-Host "  -FrontendOnly  Start only the React frontend server"
    Write-Host ""
    Write-Host "Note: Run .\build-dev.ps1 first to build the project"
    exit 0
}

Write-Host "Starting WebDavHub Development Servers..." -ForegroundColor Cyan
Write-Host ""

# Auto-detect and change to WebDavHub directory
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$webDavHubDir = Split-Path -Parent $scriptDir

# Check if we're already in the WebDavHub directory
if (-not (Test-Path "main.go")) {
    # Try to find WebDavHub directory
    if (Test-Path (Join-Path $webDavHubDir "main.go")) {
        Write-Host "Changing to WebDavHub directory: $webDavHubDir" -ForegroundColor Cyan
        Set-Location $webDavHubDir
    } else {
        Write-Host "Error: Could not find WebDavHub directory with main.go" -ForegroundColor Red
        Write-Host "Please run this script from the WebDavHub directory or its scripts subdirectory." -ForegroundColor Red
        exit 1
    }
}

# Verify we have the required files
if (-not (Test-Path "main.go")) {
    Write-Host "Error: main.go not found in current directory." -ForegroundColor Red
    exit 1
}

# Check if build exists
if (-not $FrontendOnly -and -not (Test-Path "cinesync.exe")) {
    Write-Host "Error: cinesync.exe not found. Please run .\build-dev.ps1 first." -ForegroundColor Red
    exit 1
}

# Function to start frontend server
function Start-Frontend {
    Write-Host "Starting React development server on port $uiPort..." -ForegroundColor Yellow
    Push-Location frontend
    try {
        Write-Host "Using package manager: pnpm" -ForegroundColor Cyan
        & pnpm run dev
    } finally {
        Pop-Location
    }
}

# Function to start backend server
function Start-Backend {
    Write-Host "Starting Go backend server on port $apiPort..." -ForegroundColor Yellow
    .\cinesync.exe
}

# Start servers based on options
if ($FrontendOnly) {
    Start-Frontend
} elseif ($BackendOnly) {
    Start-Backend
} else {
    # Start both servers (same approach as production)
    Write-Host "Starting both frontend and backend servers..." -ForegroundColor Cyan
    Write-Host ""
    Write-Host "IMPORTANT: When stopping, press Ctrl+C and then run:" -ForegroundColor Yellow
    Write-Host "  .\scripts\stop-servers.ps1" -ForegroundColor Cyan
    Write-Host "This ensures both frontend and backend are properly stopped." -ForegroundColor Yellow
    Write-Host ""

    # Start backend server first in background with visible output (same as production)
    Write-Host "Starting Go backend server on port $apiPort..." -ForegroundColor Yellow
    $backendProcess = Start-Process -FilePath ".\cinesync.exe" -PassThru -NoNewWindow

    # Wait a moment for backend to start
    Start-Sleep -Seconds 3

    # Check if backend started successfully
    if ($backendProcess.HasExited) {
        Write-Host "Backend server failed to start" -ForegroundColor Red
        exit 1
    }

    Write-Host "Backend server started successfully" -ForegroundColor Green

    # Start frontend server second (same approach as production)
    Write-Host "Starting React development server on port $uiPort..." -ForegroundColor Yellow
    try {
        Write-Host "Using package manager: pnpm" -ForegroundColor Cyan

        # Start pnpm in background using Start-Job with explicit frontend directory
        $frontendPath = Join-Path $PWD "frontend"
        $frontendJob = Start-Job -ScriptBlock {
            Set-Location $using:frontendPath
            & pnpm run dev
        }

        # Wait a moment for frontend to start
        Start-Sleep -Seconds 3

        # Check if frontend job is still running
        if ($frontendJob.State -eq "Failed" -or $frontendJob.State -eq "Completed") {
            Write-Host "Frontend server failed to start" -ForegroundColor Red
            Receive-Job $frontendJob
            Remove-Job $frontendJob
            # Clean up backend process
            if ($backendProcess -and -not $backendProcess.HasExited) {
                Stop-Process -Id $backendProcess.Id -Force -ErrorAction SilentlyContinue
            }
            exit 1
        }

        Write-Host "Frontend server started successfully" -ForegroundColor Green

        # Show server information
        Write-Host ""
        Write-Host "Servers will be available at:" -ForegroundColor Cyan
        Write-Host "Frontend (Vite Dev Server):" -ForegroundColor Yellow
        Write-Host "  Local:   http://localhost:$uiPort/" -ForegroundColor Green
        Write-Host ""
        Write-Host "Backend (Go API):" -ForegroundColor Yellow
        Write-Host "- API: http://localhost:$apiPort/api/"
        Write-Host "- WebDAV: http://localhost:$apiPort/webdav/"
        Write-Host ""
        Write-Host "Press Ctrl+C to stop all servers" -ForegroundColor Yellow
        Write-Host ""

        # Wait for frontend job to finish (blocking) - this shows frontend logs
        Wait-Job $frontendJob | Out-Null
        Receive-Job $frontendJob
        Remove-Job $frontendJob

    } catch {
        Write-Host "Failed to start servers: $_" -ForegroundColor Red
    } finally {
        # Clean up processes when stopping
        Write-Host "Stopping servers..." -ForegroundColor Yellow
        if ($frontendJob) {
            Stop-Job $frontendJob -ErrorAction SilentlyContinue
            Remove-Job $frontendJob -ErrorAction SilentlyContinue
        }
        if ($backendProcess -and -not $backendProcess.HasExited) {
            Stop-Process -Id $backendProcess.Id -Force -ErrorAction SilentlyContinue
        }
    }
}

Write-Host ""
Write-Host "Development servers stopped." -ForegroundColor Green
