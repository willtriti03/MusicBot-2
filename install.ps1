$ErrorActionPreference = "Stop"

Set-Location $PSScriptRoot

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Error "Node.js 22.12 or newer is required."
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Error "npm is required to build MusicBot."
}

$version = & node -p "process.versions.node"
$parts = $version.Trim().Split(".")
if ([int]$parts[0] -lt 22 -or ([int]$parts[0] -eq 22 -and [int]$parts[1] -lt 12)) {
    Write-Error "Node.js 22.12 or newer is required."
}

Write-Host "Installing ts-bot dependencies..."
& npm install --prefix ts-bot

Write-Host "Building ts-bot..."
& npm run build --prefix ts-bot

if (-not (Test-Path ".env")) {
    Copy-Item "config/musicbot.env.example" ".env"
}

Write-Host ""
Write-Host "Install complete."
Write-Host "Configuration:"
Write-Host "  - Edit .env for local development."
Write-Host "  - Edit config/config.json for runtime defaults."
Write-Host ""
Write-Host "Run locally with:"
Write-Host "  node ts-bot/dist/main.js"
Write-Host ""
Write-Host "Production deployment is Linux + systemd only."
