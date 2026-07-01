# Cetpa - release deploy script (CI/CD or manual). ASCII-only (PS 5.1 Windows-1252 safe).
# ci-windows.yml calls this over SSH:  powershell -File C:\cetpa\deploy\windows\deploy.ps1
# git reset to origin/main -> npm ci -> build -> restart service -> local health check.

param(
    [string]$AppDir  = 'C:\cetpa',
    [int]   $AppPort = 5173,
    [string]$Branch  = 'main'
)
$ErrorActionPreference = 'Stop'
function Info($m){ Write-Host "==> $m" -ForegroundColor Cyan }

Set-Location $AppDir

Info "git fetch + reset --hard origin/$Branch"
git fetch origin $Branch --quiet
git reset --hard "origin/$Branch"

Info 'npm ci --legacy-peer-deps'
npm ci --legacy-peer-deps

Info 'npm run build'
npm run build

Info 'Restarting cetpa service'
Restart-Service cetpa -Force

# Local health check (no TLS - independent of Caddy)
$ok = $false
foreach ($i in 1..10) {
    Start-Sleep 3
    try {
        $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 "http://localhost:$AppPort/api/health"
        if ($r.StatusCode -eq 200) { $ok = $true; break }
    } catch { }
    Write-Host "    health attempt $i/10..."
}
if ($ok) {
    Info 'Health OK (HTTP 200). Deploy succeeded.'
    exit 0
} else {
    Write-Error 'Health check failed - inspect C:\cetpa\logs\service-err.log'
    exit 1
}
