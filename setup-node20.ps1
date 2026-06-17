# Setup Node.js 20 LTS for AI Brain project
# Run this script as Administrator

Write-Host "=== AI Brain — Node.js 20 LTS Setup ===" -ForegroundColor Cyan

# Check if NVM is installed
$nvmPath = "$env:APPDATA\nvm"
if (-not (Test-Path $nvmPath)) {
    Write-Host "Installing NVM for Windows..." -ForegroundColor Yellow
    Invoke-WebRequest -Uri "https://github.com/coreybutler/nvm-windows/releases/latest/download/nvm-setup.exe" -OutFile "$env:TEMP\nvm-setup.exe"
    Start-Process -FilePath "$env:TEMP\nvm-setup.exe" -Wait
    Write-Host "NVM installed. Please restart your terminal and run this script again." -ForegroundColor Green
    exit
}

# Install Node 20
Write-Host "Installing Node.js 20 LTS..." -ForegroundColor Yellow
nvm install 20
nvm use 20

# Verify
$nodeVersion = node --version
Write-Host "Node version: $nodeVersion" -ForegroundColor Green

# Rebuild native modules
Write-Host "Rebuilding native modules..." -ForegroundColor Yellow
npm rebuild

Write-Host "`n=== Setup complete! ===" -ForegroundColor Green
Write-Host "Run 'node --version' to verify Node 20 is active."
Write-Host "Run 'npm test' to verify all tests pass."
