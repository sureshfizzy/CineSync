#!/usr/bin/env pwsh
# PowerShell script to build WebDavHub for development

param(
    [switch]$Help
)

if ($Help) {
    Write-Host "WebDavHub Development Build Script"
    Write-Host "=================================="
    Write-Host ""
    Write-Host "This script builds the WebDavHub project for development:"
    Write-Host "- Installs frontend dependencies (if needed)"
    Write-Host "- Builds Go backend"
    Write-Host "- Does NOT start servers (use start-dev.ps1 for that)"
    Write-Host ""
    Write-Host "Usage: .\build-dev.ps1"
    Write-Host "       .\build-dev.ps1 -Help"
    exit 0
}

Write-Host "Building WebDavHub for Development..." -ForegroundColor Cyan
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

if (-not (Test-Path "frontend")) {
    Write-Host "Error: frontend directory not found." -ForegroundColor Red
    exit 1
}

# Ensure Go dependencies are up to date
Write-Host "Updating Go dependencies..." -ForegroundColor Yellow
try {
    go mod tidy
    if ($LASTEXITCODE -ne 0) {
        throw "Go mod tidy failed"
    }
    Write-Host "Go dependencies updated" -ForegroundColor Green
} catch {
    Write-Host "Failed to update Go dependencies: $_" -ForegroundColor Red
    exit 1
}

# Build Go backend
Write-Host "Building Go backend..." -ForegroundColor Yellow
try {
    go build -o cinesync.exe .
    if ($LASTEXITCODE -ne 0) {
        throw "Go build failed"
    }
    Write-Host "Go backend built successfully" -ForegroundColor Green
} catch {
    Write-Host "Failed to build Go backend: $_" -ForegroundColor Red
    exit 1
}

# Install frontend dependencies
Write-Host "Installing frontend dependencies..." -ForegroundColor Yellow
Push-Location frontend
try {
    # Check if pnpm is available, install if not
    if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
        Write-Host "pnpm not found. Installing pnpm..." -ForegroundColor Yellow
        npm install -g pnpm
        if ($LASTEXITCODE -ne 0) {
            throw "Failed to install pnpm"
        }
        Write-Host "pnpm installed successfully" -ForegroundColor Green
    }

    Write-Host "Using package manager: pnpm" -ForegroundColor Cyan

    if (-not (Test-Path "node_modules")) {
        & pnpm install
        if ($LASTEXITCODE -ne 0) {
            throw "Package installation failed"
        }
        Write-Host "Frontend dependencies installed" -ForegroundColor Green
    } else {
        Write-Host "Frontend dependencies already installed" -ForegroundColor Green
    }
} catch {
    Write-Host "Failed to install frontend dependencies: $_" -ForegroundColor Red
    Pop-Location
    exit 1
} finally {
    Pop-Location
}

Write-Host ""
Write-Host "Development build completed successfully!" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "- Run .\start-dev.ps1 to start development servers"
