# PowerShell script to build WebDavHub for production

param(
    [switch]$Help
)

if ($Help) {
    Write-Host "WebDavHub Production Build Script"
    Write-Host "================================="
    Write-Host ""
    Write-Host "This script builds the WebDavHub project for production:"
    Write-Host "- Installs frontend dependencies (if needed)"
    Write-Host "- Builds React frontend for production"
    Write-Host "- Builds Go backend with optimizations"
    Write-Host "- Creates a single binary with embedded frontend"
    Write-Host ""
    Write-Host "Usage: .\build-prod.ps1"
    Write-Host "       .\build-prod.ps1 -Help"
    exit 0
}

Write-Host "Building WebDavHub for Production..." -ForegroundColor Cyan
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
        Write-Host "Installing dependencies..." -ForegroundColor Yellow
        & pnpm install
        if ($LASTEXITCODE -ne 0) {
            throw "Package installation failed"
        }
    }
    Write-Host "Frontend dependencies ready" -ForegroundColor Green
} catch {
    Write-Host "Failed to install frontend dependencies: $_" -ForegroundColor Red
    Pop-Location
    exit 1
}

# Build React frontend for production
Write-Host "Building React frontend for production..." -ForegroundColor Yellow
try {
    Write-Host "Running build command..." -ForegroundColor Yellow
    & pnpm run build
    if ($LASTEXITCODE -ne 0) {
        throw "Frontend build failed"
    }
    Write-Host "Frontend built successfully" -ForegroundColor Green
} catch {
    Write-Host "Failed to build frontend: $_" -ForegroundColor Red
    Pop-Location
    exit 1
} finally {
    Pop-Location
}

# Build Go backend with optimizations
Write-Host "Building Go backend for production..." -ForegroundColor Yellow
try {
    go build -ldflags="-s -w" -o cinesync.exe .
    if ($LASTEXITCODE -ne 0) {
        throw "Go build failed"
    }
    Write-Host "Go backend built successfully" -ForegroundColor Green
} catch {
    Write-Host "Failed to build Go backend: $_" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Production build completed successfully!" -ForegroundColor Green
Write-Host ""
Write-Host "Output files:" -ForegroundColor Cyan
Write-Host "- cinesync.exe (Production binary)"
Write-Host "- frontend/dist/ (Built React app)"
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "- Run .\scripts\start-prod.ps1 to start production servers"
