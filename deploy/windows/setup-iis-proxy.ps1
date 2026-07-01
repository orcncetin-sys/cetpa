#requires -RunAsAdministrator
# Cetpa - IIS reverse proxy setup for app.cetpa.com.tr -> Node app (localhost:5173).
# ASCII-only (PS 5.1 Windows-1252 safe). Does NOT touch the existing cetpa.com.tr
# site or mail - only installs ARR/URL Rewrite modules (server-wide, additive) and
# drops a web.config into the Plesk-created site's httpdocs.
#
# PREREQUISITE (do this first, in Plesk panel):
#   Websites & Domains > cetpa.com.tr > Add Subdomain > name "app" -> app.cetpa.com.tr
#   (Do NOT enable Plesk's Node.js Toolkit for this subdomain - we run Node via the
#   separate NSSM "cetpa" service on port 5173; enabling it would run a second,
#   conflicting copy of the app.)
#
# Run:  powershell -ExecutionPolicy Bypass -File .\deploy\windows\setup-iis-proxy.ps1
# Optional: -SiteDocRoot "C:\inetpub\vhosts\cetpa.com.tr\app.cetpa.com.tr\httpdocs"
#           if auto-detect does not find the Plesk-created folder.

param(
    [string]$SiteDocRoot = ''
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$env:CHOCOLATEY_NO_PROGRESS = 'true'
function Info($m){ Write-Host "==> $m" -ForegroundColor Cyan }
function Ok($m){ Write-Host "    $m" -ForegroundColor Green }

# This script may run in a shell opened before Chocolatey was installed (PATH set
# machine-wide but not yet visible to already-running/newly-spawned sessions in some
# Windows/RDP configurations). Refresh PATH in-process so 'choco' resolves without
# needing to close and reopen the shell.
$env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path','User')
if (-not (Get-Command choco -ErrorAction SilentlyContinue)) {
    $chocoExe = 'C:\ProgramData\chocolatey\bin\choco.exe'
    if (Test-Path $chocoExe) {
        Set-Alias -Name choco -Value $chocoExe -Scope Script
    } else {
        throw 'choco.exe not found. Run setup.ps1 first (it installs Chocolatey).'
    }
}

$appCmd = "$env:windir\System32\inetsrv\appcmd.exe"
if (-not (Test-Path $appCmd)) { throw 'appcmd.exe not found - is IIS installed?' }

# 1) ARR + URL Rewrite (iis-arr pulls in urlrewrite as a dependency)
Info 'Installing iis-arr (ARR + URL Rewrite modules)...'
choco install iis-arr -y --no-progress
Ok 'ARR/URL Rewrite installed.'

# 2) Enable ARR's proxy feature server-wide (off by default after install)
Info 'Enabling ARR proxy feature...'
& $appCmd set config -section:system.webServer/proxy /enabled:"True" /commit:apphost
Ok 'ARR proxy enabled.'

# 3) Allow the HTTP_X_FORWARDED_PROTO server variable used by web.config's rewrite rule
Info 'Allowing HTTP_X_FORWARDED_PROTO server variable for URL Rewrite...'
& $appCmd set config -section:system.webServer/rewrite/allowedServerVariables /+"[name='HTTP_X_FORWARDED_PROTO']" /commit:apphost 2>$null
Ok 'Server variable allowed (or already present).'

# 4) Locate the Plesk-created site folder for app.cetpa.com.tr
if (-not $SiteDocRoot) {
    Info 'Auto-detecting Plesk site folder for app.cetpa.com.tr...'
    $candidates = Get-ChildItem -Path 'C:\inetpub\vhosts' -Recurse -Depth 2 -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -eq 'httpdocs' -and $_.FullName -match 'app\.cetpa\.com\.tr' }
    if ($candidates.Count -eq 1) {
        $SiteDocRoot = $candidates[0].FullName
        Ok "Found: $SiteDocRoot"
    } elseif ($candidates.Count -gt 1) {
        Write-Host 'Multiple matches found:' -ForegroundColor Yellow
        $candidates.FullName | ForEach-Object { Write-Host "  $_" }
        throw 'Ambiguous - rerun with -SiteDocRoot "<exact path>".'
    } else {
        throw 'Could not auto-detect. Create app.cetpa.com.tr in Plesk first (see header comment), then rerun with -SiteDocRoot "C:\inetpub\vhosts\cetpa.com.tr\app.cetpa.com.tr\httpdocs" (adjust to what Plesk shows under Hosting Settings > Document root).'
    }
}
if (-not (Test-Path $SiteDocRoot)) { throw "Path does not exist: $SiteDocRoot" }

# 5) Drop the reverse-proxy web.config into the site root
Info "Copying web.config to $SiteDocRoot ..."
Copy-Item -Path "$PSScriptRoot\web.config" -Destination (Join-Path $SiteDocRoot 'web.config') -Force
Ok 'web.config deployed.'

Write-Host ''
Info 'Done. Once DNS points app.cetpa.com.tr to this server, enable Let''s Encrypt for it in Plesk (SSL/TLS Certificates tab), then test https://app.cetpa.com.tr/api/health'
Info 'Local test now (bypasses DNS/TLS): curl http://localhost/api/health with Host header, or just verify http://localhost:5173/api/health directly (Node app itself).'
