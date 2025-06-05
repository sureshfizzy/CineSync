#!/usr/bin/env pwsh
# PowerShell script to stop all WebDavHub servers

param(
    [switch]$Help
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
    Write-Host "WebDavHub Server Stop Script"
    Write-Host "============================="
    Write-Host ""
    Write-Host "This script stops all running WebDavHub servers:"
    Write-Host "- Kills processes using ports $uiPort and $apiPort"
    Write-Host "- Stops cinesync.exe and cinesync.exe processes"
    Write-Host ""
    Write-Host "Usage: .\stop-servers.ps1"
    Write-Host "       .\stop-servers.ps1 -Help"
    exit 0
}

Write-Host "Stopping WebDavHub servers..." -ForegroundColor Yellow
Write-Host ""

# Function to kill processes by port
function Stop-ProcessByPort {
    param([int]$Port)
    
    try {
        $connections = netstat -ano | Select-String ":$Port "
        if ($connections) {
            Write-Host "Found processes using port $Port" -ForegroundColor Cyan
            foreach ($connection in $connections) {
                $parts = $connection.ToString().Split(' ', [StringSplitOptions]::RemoveEmptyEntries)
                if ($parts.Length -ge 5) {
                    $pid = $parts[-1]
                    try {
                        $process = Get-Process -Id $pid -ErrorAction SilentlyContinue
                        if ($process) {
                            Write-Host "  Stopping process: $($process.ProcessName) (PID: $pid)" -ForegroundColor Yellow
                            Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
                        }
                    } catch {
                        # Process might have already stopped
                    }
                }
            }
        } else {
            Write-Host "No processes found using port $Port" -ForegroundColor Green
        }
    } catch {
        Write-Host "Could not check port $Port" -ForegroundColor Red
    }
}

# Function to kill processes by name
function Stop-ProcessByName {
    param([string]$ProcessName)
    
    try {
        $processes = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue
        if ($processes) {
            Write-Host "Found $($processes.Count) $ProcessName process(es)" -ForegroundColor Cyan
            foreach ($process in $processes) {
                Write-Host "  Stopping process: $($process.ProcessName) (PID: $($process.Id))" -ForegroundColor Yellow
                Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
            }
        } else {
            Write-Host "No $ProcessName processes found" -ForegroundColor Green
        }
    } catch {
        Write-Host "Could not check for $ProcessName processes" -ForegroundColor Red
    }
}

# Stop processes by port
Write-Host "Checking ports..." -ForegroundColor Cyan
Stop-ProcessByPort -Port $uiPort
Stop-ProcessByPort -Port $apiPort

Write-Host ""
Write-Host "Checking process names..." -ForegroundColor Cyan
Stop-ProcessByName -ProcessName "webdavhub"
Stop-ProcessByName -ProcessName "cinesync"
Stop-ProcessByName -ProcessName "node"

Write-Host ""
Write-Host "Server stop completed!" -ForegroundColor Green
Write-Host ""
Write-Host "You can now run .\start-prod.ps1 or .\start-dev.ps1" -ForegroundColor Cyan
