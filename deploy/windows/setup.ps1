#requires -RunAsAdministrator
<#
    Cetpa — Windows Server 2022 tek seferlik kurulum (idempotent).
    Native Node (NSSM servisi) + Caddy + OpenSSH + PostgreSQL (yoksa).
    Çalıştır:  powershell -ExecutionPolicy Bypass -File .\deploy\windows\setup.ps1
#>
param(
    [string]$AppDir  = 'C:\cetpa',
    [int]   $AppPort = 5173
)
$ErrorActionPreference = 'Stop'
function Info($m){ Write-Host "==> $m" -ForegroundColor Cyan }
function Ok($m){ Write-Host "    $m" -ForegroundColor Green }

# ── 1) Chocolatey ─────────────────────────────────────────────────────────────
if (-not (Get-Command choco -ErrorAction SilentlyContinue)) {
    Info 'Chocolatey kuruluyor...'
    Set-ExecutionPolicy Bypass -Scope Process -Force
    [System.Net.ServicePointManager]::SecurityProtocol = 3072
    Invoke-Expression ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))
    $env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine')
} else { Ok 'Chocolatey zaten kurulu.' }

# ── 2) Paketler ───────────────────────────────────────────────────────────────
foreach ($pkg in 'nodejs-lts','git','nssm','caddy') {
    $installed = (choco list --local-only --limit-output --exact $pkg) -ne $null -and
                 (choco list --local-only --limit-output --exact $pkg).Length -gt 0
    if (-not $installed) { Info "$pkg kuruluyor..."; choco install $pkg -y --no-progress }
    else { Ok "$pkg zaten kurulu." }
}
$env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine')

# ── 3) OpenSSH Server (CI/CD deploy için) ─────────────────────────────────────
if ((Get-WindowsCapability -Online -Name 'OpenSSH.Server*').State -ne 'Installed') {
    Info 'OpenSSH Server kuruluyor...'
    Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0 | Out-Null
} else { Ok 'OpenSSH Server zaten kurulu.' }
Set-Service sshd -StartupType Automatic
Start-Service sshd
# ssh "komut" Windows PowerShell'de koşsun (default shell):
$ps = 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
New-Item -Path 'HKLM:\SOFTWARE\OpenSSH' -Force | Out-Null
New-ItemProperty -Path 'HKLM:\SOFTWARE\OpenSSH' -Name DefaultShell -Value $ps -PropertyType String -Force | Out-Null
if (-not (Get-NetFirewallRule -Name sshd -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -Name sshd -DisplayName 'OpenSSH Server (sshd)' -Enabled True `
        -Direction Inbound -Protocol TCP -Action Allow -LocalPort 22 | Out-Null
}
Ok 'OpenSSH hazır. (deploy public anahtarını administrators_authorized_keys''e ekle — RUNBOOK [8])'

# ── 4) Firewall: HTTP/HTTPS (Caddy) ───────────────────────────────────────────
foreach ($p in 80,443) {
    $name = "Caddy-$p"
    if (-not (Get-NetFirewallRule -Name $name -ErrorAction SilentlyContinue)) {
        New-NetFirewallRule -Name $name -DisplayName "Caddy TCP $p" -Enabled True `
            -Direction Inbound -Protocol TCP -Action Allow -LocalPort $p | Out-Null
    }
}
Ok 'Firewall 80/443 açık.'

# ── 5) PostgreSQL tespit / kurulum ────────────────────────────────────────────
$pgSvc = Get-Service | Where-Object Name -like 'postgresql*'
if (-not $pgSvc) {
    Info 'PostgreSQL bulunamadı — kuruluyor (choco postgresql15)...'
    choco install postgresql15 -y --no-progress --params "/Password:postgres"
    Ok 'PostgreSQL kuruldu. RUNBOOK [4] ile db/kullanıcı oluştur + veri taşı.'
} else {
    Ok "PostgreSQL zaten var: $($pgSvc.Name) [$($pgSvc.Status)]. Veri taşıma için RUNBOOK [4]."
}

# ── 6) NSSM servisi (cetpa) ───────────────────────────────────────────────────
# node --import tsx server.ts  (tsx loader; build ayrı, `npm run build` deploy.ps1'de)
$node = (Get-Command node.exe).Source
$svc  = Get-Service cetpa -ErrorAction SilentlyContinue
if (-not $svc) {
    Info 'cetpa Windows servisi oluşturuluyor...'
    nssm install cetpa $node '--import' 'tsx' "$AppDir\server.ts"
    nssm set cetpa AppDirectory $AppDir
    nssm set cetpa AppEnvironmentExtra "NODE_ENV=production" "PORT=$AppPort"
    nssm set cetpa AppStdout "$AppDir\logs\service-out.log"
    nssm set cetpa AppStderr "$AppDir\logs\service-err.log"
    nssm set cetpa Start SERVICE_AUTO_START
    New-Item -ItemType Directory -Force -Path "$AppDir\logs" | Out-Null
    Ok 'Servis kuruldu. Sırayla: .env oluştur → npm ci → npm run build → nssm start cetpa.'
} else {
    Ok "cetpa servisi zaten var [$($svc.Status)]. Güncelleme için deploy.ps1."
}

Write-Host ""
Info 'Bootstrap tamam. Şimdi RUNBOOK [1a] (IIS/Plesk port), [3] (.env+build), [4] (DB), [5] (test).'
