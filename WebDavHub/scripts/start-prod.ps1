#!/usr/bin/env pwsh
# PowerShell script to start WebDavHub production server

param(
    [switch]$Help
)

if ($Help) {
    Write-Host "WebDavHub Production Start Script"
    Write-Host "================================="
    Write-Host ""
    Write-Host "This script starts the WebDavHub production server:"
    Write-Host "- Serves both frontend and backend on port 8082"
    Write-Host "- Frontend is served from built dist files"
    Write-Host "- Backend API is available at /api/"
    Write-Host ""
    Write-Host "Usage: .\start-prod.ps1"
    Write-Host "       .\start-prod.ps1 -Help"
    Write-Host ""
    Write-Host "Note: Run .\build-prod.ps1 first to build the project"
    exit 0
}

Write-Host "Starting WebDavHub Production Server..." -ForegroundColor Cyan
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

# Check if production build exists
if (-not (Test-Path "cinesync.exe")) {
    Write-Host "Error: cinesync.exe not found. Please run .\build-prod.ps1 first." -ForegroundColor Red
    exit 1
}

# Check if frontend dist exists
if (-not (Test-Path "frontend/dist")) {
    Write-Host "Error: frontend/dist not found. Please run .\build-prod.ps1 first." -ForegroundColor Red
    exit 1
}

Write-Host "Starting production servers..." -ForegroundColor Yellow
Write-Host ""

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

# Start backend server first in background
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

# Start frontend server second
Write-Host "Starting React frontend server on port $uiPort..." -ForegroundColor Yellow
try {
    Write-Host "Using package manager: pnpm" -ForegroundColor Cyan

    # Start pnpm in background using Start-Job with explicit frontend directory
    $frontendPath = Join-Path $PWD "frontend"
    $frontendJob = Start-Job -ScriptBlock {
        Set-Location $using:frontendPath
        & pnpm run preview
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

    # Get network interfaces and show all available IPs
    Write-Host ""
    Write-Host "Servers will be available at:" -ForegroundColor Cyan
    Write-Host "Frontend (Vite Preview):" -ForegroundColor Yellow
    Write-Host "  Local:   http://localhost:$uiPort/" -ForegroundColor Green

    # Get all network interfaces
    $networkInterfaces = Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -ne "127.0.0.1" -and $_.PrefixOrigin -eq "Dhcp" -or $_.PrefixOrigin -eq "Manual" }
    foreach ($interface in $networkInterfaces) {
        if ($interface.IPAddress -match "^(10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.|169\.254\.)" -or $interface.IPAddress -notmatch "^(10\.|172\.|192\.168\.|169\.254\.)") {
            Write-Host "  Network: http://$($interface.IPAddress):$uiPort/" -ForegroundColor Green
        }
    }

    Write-Host ""
    Write-Host "Backend (Go API):" -ForegroundColor Yellow
    Write-Host "- API: http://localhost:$apiPort/api/"
    Write-Host "- WebDAV: http://localhost:$apiPort/webdav/"
    Write-Host ""
    Write-Host "Press Ctrl+C to stop all servers" -ForegroundColor Yellow
    Write-Host ""

    # Wait for frontend job to finish (blocking)
    Wait-Job $frontendJob | Out-Null
    Receive-Job $frontendJob
    Remove-Job $frontendJob

} catch {
    Write-Host "❌ Failed to start servers: $_" -ForegroundColor Red
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

Write-Host ""
Write-Host "Production server stopped." -ForegroundColor Green
