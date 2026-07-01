<#
    Cetpa — sürüm deploy scripti (CI/CD veya manuel).
    ci-windows.yml bunu SSH ile çağırır:  powershell -File C:\cetpa\deploy\windows\deploy.ps1
    git pull → npm ci → build → servis restart → health check.
#>
param(
    [string]$AppDir  = 'C:\cetpa',
    [int]   $AppPort = 5173,
    [string]$Branch  = 'main'
)
$ErrorActionPreference = 'Stop'
function Info($m){ Write-Host "==> $m" -ForegroundColor Cyan }

Set-Location $AppDir

Info "git pull origin $Branch"
git fetch origin $Branch --quiet
git reset --hard "origin/$Branch"   # deploy = remote main'e birebir eşitle

Info 'npm ci --legacy-peer-deps'
npm ci --legacy-peer-deps

Info 'npm run build'
npm run build

Info 'servis yeniden başlatılıyor (cetpa)'
Restart-Service cetpa -Force

# ── Health check (yerel — TLS'siz, Caddy'den bağımsız) ────────────────────────
$ok = $false
foreach ($i in 1..10) {
    Start-Sleep 3
    try {
        $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 "http://localhost:$AppPort/api/health"
        if ($r.StatusCode -eq 200) { $ok = $true; break }
    } catch { }
    Write-Host "    health deneme $i/10..."
}
if ($ok) {
    Info 'Health OK (HTTP 200). Deploy başarılı.'
    exit 0
} else {
    Write-Error 'Health check başarısız — servis loglarına bak: C:\cetpa\logs\service-err.log'
    exit 1
}
