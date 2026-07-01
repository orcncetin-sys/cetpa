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

function Test-IisModulePresent($pattern) {
    (& $appCmd list config -section:system.webServer/globalModules) -join "`n" -match $pattern
}

# 1) ARR + URL Rewrite. Plesk for Windows commonly ships these already (it depends on
# them internally) - check first so we don't fight a redundant/conflicting reinstall.
$hasRewrite = Test-IisModulePresent 'RewriteModule'
$hasArr     = Test-IisModulePresent 'ApplicationRequestRouting'
if ($hasRewrite -and $hasArr) {
    Ok 'URL Rewrite + ARR already present in IIS (likely via Plesk) - skipping choco install.'
} else {
    Info 'Installing iis-arr (ARR + URL Rewrite modules)...'
    choco install iis-arr -y --no-progress
    if ($LASTEXITCODE -ne 0) {
        $hasRewrite = Test-IisModulePresent 'RewriteModule'
        $hasArr     = Test-IisModulePresent 'ApplicationRequestRouting'
        if ($hasRewrite -and $hasArr) {
            Ok 'choco install failed (likely "already installed" MSI conflict) but modules ARE present in IIS - continuing.'
        } else {
            throw "choco install failed AND modules are not present in IIS (Rewrite=$hasRewrite, ARR=$hasArr). Check C:\ProgramData\chocolatey\logs\chocolatey.log."
        }
    } else {
        Ok 'ARR/URL Rewrite installed.'
    }
}

# 2) Enable ARR's proxy feature server-wide (off by default after install)
Info 'Enabling ARR proxy feature...'
& $appCmd set config -section:system.webServer/proxy /enabled:"True" /commit:apphost
Ok 'ARR proxy enabled.'

# 3) DO NOT add HTTP_X_FORWARDED_PROTO to allowedServerVariables. Confirmed by A/B
# test on 2026-07-01: Plesk's own control panel site (port 8443) manages this exact
# variable internally; adding it at the apphost (machine) level collides with
# Plesk's handling and breaks the ENTIRE panel with HTTP 500.50 / Win32 183
# (ERROR_ALREADY_EXISTS) on every request, not just our site. web.config no longer
# references it. Actively remove it if a stale/cached run added it previously.
$stillPresent = (& $appCmd list config -section:system.webServer/rewrite/allowedServerVariables) -join "`n" -match 'HTTP_X_FORWARDED_PROTO'
if ($stillPresent) {
    Info 'Removing HTTP_X_FORWARDED_PROTO from allowedServerVariables (breaks Plesk panel)...'
    & $appCmd set config -section:system.webServer/rewrite/allowedServerVariables /-"[name='HTTP_X_FORWARDED_PROTO']" /commit:apphost | Out-Null
    Ok 'Removed.'
} else {
    Ok 'HTTP_X_FORWARDED_PROTO correctly absent from allowedServerVariables.'
}

# 4) Locate the Plesk-created site's physical path. Query IIS directly (source of
# truth) instead of guessing Plesk's on-disk folder layout, which varies.
if (-not $SiteDocRoot) {
    Info 'Looking up app.cetpa.com.tr site in IIS...'
    # EXACT match only - "cetpa" alone would also match the live root site
    # "cetpa.com.tr" and silently redirect production traffic. Never loosen this.
    $siteMatch = (& $appCmd list sites) | Select-String -Pattern 'SITE "(app\.cetpa\.com\.tr)"'
    if ($siteMatch) {
        $siteName = $siteMatch.Matches[0].Groups[1].Value
        Ok "IIS site found: $siteName"
        $physicalPath = ((& $appCmd list vdir "$siteName/" /text:physicalPath) -join '').Trim()
        if ($physicalPath -and (Test-Path $physicalPath)) {
            $SiteDocRoot = $physicalPath
            Ok "Found via IIS config: $SiteDocRoot"
        }
    }
    if (-not $SiteDocRoot) {
        Info 'IIS lookup inconclusive, falling back to filesystem search...'
        # Exact leaf-folder match only (app.cetpa.com.tr or its httpdocs) - never a
        # loose "contains cetpa" match, to avoid ever touching the live root site.
        $candidates = Get-ChildItem -Path 'C:\inetpub' -Recurse -Depth 4 -Directory -ErrorAction SilentlyContinue |
            Where-Object { $_.FullName -match '\\app\.cetpa\.com\.tr(\\httpdocs)?$' }
        if ($candidates.Count -ge 1) {
            $SiteDocRoot = $candidates[0].FullName
            Ok "Found via filesystem: $SiteDocRoot"
        } else {
            throw 'Could not find app.cetpa.com.tr anywhere. Confirm the subdomain exists in Plesk (Websites & Domains), then rerun with -SiteDocRoot "<exact Document root from Plesk Hosting Settings>".'
        }
    }
}
if (-not (Test-Path $SiteDocRoot)) { throw "Path does not exist: $SiteDocRoot" }
# Safety rail: never let this land on the live root site's folder, whatever the
# lookup path was (IIS query, filesystem fallback, or manual -SiteDocRoot).
if ($SiteDocRoot -notmatch 'app\.cetpa\.com\.tr') {
    throw "Refusing to write web.config to '$SiteDocRoot' - path does not contain 'app.cetpa.com.tr'. This guard exists because an earlier version of this script once matched the live root site by mistake."
}

# 5) Drop the reverse-proxy web.config into the site root
Info "Copying web.config to $SiteDocRoot ..."
Copy-Item -Path "$PSScriptRoot\web.config" -Destination (Join-Path $SiteDocRoot 'web.config') -Force
Ok 'web.config deployed.'

Write-Host ''
Info 'Done. Once DNS points app.cetpa.com.tr to this server, enable Let''s Encrypt for it in Plesk (SSL/TLS Certificates tab), then test https://app.cetpa.com.tr/api/health'
Info 'Local test now (bypasses DNS/TLS): curl http://localhost/api/health with Host header, or just verify http://localhost:5173/api/health directly (Node app itself).'
