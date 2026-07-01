#requires -RunAsAdministrator
# Cetpa - Windows Server 2022 one-time setup (idempotent). ASCII-only on purpose:
# Windows PowerShell 5.1 reads BOM-less .ps1 as Windows-1252, so non-ASCII breaks parsing.
# Native Node (NSSM service) + Caddy + OpenSSH + PostgreSQL (installed only if missing).
# Run:  powershell -ExecutionPolicy Bypass -File .\deploy\windows\setup.ps1

param(
    [string]$AppDir  = 'C:\cetpa',
    [int]   $AppPort = 5173
)
$ErrorActionPreference = 'Stop'
# Non-interactive/web consoles have no console buffer -> Write-Progress throws
# "Access is denied ... reading the console output buffer". Suppress all progress.
$ProgressPreference = 'SilentlyContinue'
$env:CHOCOLATEY_NO_PROGRESS = 'true'
function Info($m){ Write-Host "==> $m" -ForegroundColor Cyan }
function Ok($m){ Write-Host "    $m" -ForegroundColor Green }

# 1) Chocolatey
if (-not (Get-Command choco -ErrorAction SilentlyContinue)) {
    Info 'Installing Chocolatey...'
    Set-ExecutionPolicy Bypass -Scope Process -Force
    [System.Net.ServicePointManager]::SecurityProtocol = 3072
    Invoke-Expression ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))
    $env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine')
} else { Ok 'Chocolatey already installed.' }

# 2) Packages (choco install is idempotent - safe to re-run)
foreach ($pkg in 'nodejs-lts','git','nssm','caddy') {
    Info "Installing/verifying $pkg ..."
    choco install $pkg -y --no-progress
}
$env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine')

# 3) OpenSSH Server (for CI/CD deploy over SSH)
if ((Get-WindowsCapability -Online -Name 'OpenSSH.Server*').State -ne 'Installed') {
    Info 'Installing OpenSSH Server...'
    Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0 | Out-Null
} else { Ok 'OpenSSH Server already installed.' }
Set-Service sshd -StartupType Automatic
Start-Service sshd
# Make "ssh host <cmd>" run under Windows PowerShell:
$psExe = 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
New-Item -Path 'HKLM:\SOFTWARE\OpenSSH' -Force | Out-Null
New-ItemProperty -Path 'HKLM:\SOFTWARE\OpenSSH' -Name DefaultShell -Value $psExe -PropertyType String -Force | Out-Null
if (-not (Get-NetFirewallRule -Name sshd -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -Name sshd -DisplayName 'OpenSSH Server (sshd)' -Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort 22 | Out-Null
}
Ok 'OpenSSH ready. Add the deploy public key to administrators_authorized_keys (RUNBOOK step 8).'

# 4) Firewall for Caddy (HTTP/HTTPS)
foreach ($p in 80,443) {
    $ruleName = "Caddy-$p"
    if (-not (Get-NetFirewallRule -Name $ruleName -ErrorAction SilentlyContinue)) {
        New-NetFirewallRule -Name $ruleName -DisplayName "Caddy TCP $p" -Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort $p | Out-Null
    }
}
Ok 'Firewall 80/443 open.'

# 5) PostgreSQL: detect, install only if missing
$pgSvc = Get-Service -Name 'postgresql*' -ErrorAction SilentlyContinue
if (-not $pgSvc) {
    Info 'PostgreSQL not found - installing (choco postgresql15)...'
    choco install postgresql15 -y --no-progress --params "/Password:postgres"
    Ok 'PostgreSQL installed (superuser postgres / pw postgres). Create app db+user and migrate data: RUNBOOK step 4.'
} else {
    Ok ('PostgreSQL present: ' + $pgSvc.Name + ' [' + $pgSvc.Status + ']. Migrate data: RUNBOOK step 4.')
}

# 6) NSSM service (cetpa): node --import tsx server.ts
$node = (Get-Command node.exe).Source
$svc  = Get-Service -Name cetpa -ErrorAction SilentlyContinue
if (-not $svc) {
    Info 'Creating cetpa Windows service...'
    nssm install cetpa $node
    nssm set cetpa AppParameters "--import tsx `"$AppDir\server.ts`""
    nssm set cetpa AppDirectory $AppDir
    nssm set cetpa AppEnvironmentExtra "NODE_ENV=production" "PORT=$AppPort"
    New-Item -ItemType Directory -Force -Path "$AppDir\logs" | Out-Null
    nssm set cetpa AppStdout "$AppDir\logs\service-out.log"
    nssm set cetpa AppStderr "$AppDir\logs\service-err.log"
    nssm set cetpa Start SERVICE_AUTO_START
    Ok 'Service created (not started). Next: create .env, npm ci, npm run build, then start it.'
} else {
    Ok ('cetpa service already exists [' + $svc.Status + ']. Use deploy.ps1 to update.')
}

Write-Host ''
Info 'Bootstrap done. Next: RUNBOOK step 1a (free IIS 80/443), step 3 (.env + build), step 4 (DB), step 5 (test).'
