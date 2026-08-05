# Cetpa - release deploy script (CI/CD or manual). ASCII-only (PS 5.1 Windows-1252 safe).
# ci-windows.yml calls this over SSH:  powershell -File C:\cetpa\deploy\windows\deploy.ps1
# git reset to origin/main -> npm ci -> build -> restart service -> local health check.

param(
    [string]$AppDir  = 'C:\cetpa',
    [int]   $AppPort = 5173,
    [string]$Branch  = 'main'
)
$ErrorActionPreference = 'Stop'
# CI/CD runs this over SSH (no console buffer) -> suppress progress bars.
$ProgressPreference = 'SilentlyContinue'
$env:CHOCOLATEY_NO_PROGRESS = 'true'
function Info($m){ Write-Host "==> $m" -ForegroundColor Cyan }

Set-Location $AppDir

Info "git fetch + reset --hard origin/$Branch"
git fetch origin $Branch --quiet
git reset --hard "origin/$Branch"

# Stop the service BEFORE npm ci: the running "cetpa" process (tsx, which uses
# esbuild internally) holds a lock on node_modules/@esbuild/win32-x64/esbuild.exe.
# npm ci tries to unlink/replace it while installing and fails with EPERM if the
# service is still running, which then cascades into a broken build and a
# service that fails to restart. Stop first so the file handle is released.
Info 'Stopping cetpa service (releases node_modules file locks before npm ci)'
Stop-Service cetpa -Force -ErrorAction SilentlyContinue


Start-Sleep 2

Info 'npm ci --legacy-peer-deps'
npm ci --legacy-peer-deps

Info 'npm run build'
npm run build

Info 'Starting cetpa service'
Restart-Service cetpa -Force

# Off-server backup scheduled task - idempotent, registered on every deploy so it
# self-heals if it was never set up or got removed. Runs backup-db-offsite.mjs
# (pg_dump + uploads/ tar.gz -> Firebase Storage) daily at 03:30 as SYSTEM.
# Wrapped in try/catch: this is NOT on the critical deploy path, so a failure
# here (e.g. non-elevated SSH token) must not fail the deploy.
try {
    $bkTask = 'CetpaDbBackupOffsite'
    $bkScript = Join-Path $AppDir 'scripts\backup-db-offsite.mjs'
    $nodeExe = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
    if ($nodeExe -and (Test-Path $bkScript)) {
        if (Get-ScheduledTask -TaskName $bkTask -ErrorAction SilentlyContinue) {
            Unregister-ScheduledTask -TaskName $bkTask -Confirm:$false
        }
        $bkAction    = New-ScheduledTaskAction -Execute $nodeExe -Argument "`"$bkScript`"" -WorkingDirectory $AppDir
        $bkTrigger   = New-ScheduledTaskTrigger -Daily -At '03:30'
        $bkSettings  = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd -ExecutionTimeLimit (New-TimeSpan -Minutes 30) -RestartCount 2 -RestartInterval (New-TimeSpan -Minutes 5)
        $bkPrincipal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
        Register-ScheduledTask -TaskName $bkTask -Action $bkAction -Trigger $bkTrigger -Settings $bkSettings -Principal $bkPrincipal -Description 'Cetpa: gunluk pg_dump + uploads -> Firebase Storage off-server yedek.' | Out-Null
        Info "Backup scheduled task '$bkTask' ensured (daily 03:30, SYSTEM)."

    # ---- NSSM log rotation (idempotent) ---------------------------------
    # Without rotation the service log grows without bound. On 2026-07-31
    # service-err.log hit 1.6 GB from a pg-boss error loop and helped fill
    # the disk, taking the app down. 50 MB per file, rotate while running.
    try {
        nssm set cetpa AppRotateFiles 1  | Out-Null
        nssm set cetpa AppRotateOnline 1 | Out-Null
        nssm set cetpa AppRotateBytes 52428800 | Out-Null
        Info 'Service log rotation ensured (50 MB per file).'
    } catch {
        Info 'WARN: could not set NSSM log rotation - continuing.'
    }

    } else {
        Write-Host "    Backup task skipped: node veya script bulunamadi." -ForegroundColor Yellow
    }
} catch {
    Write-Host "    Backup task kaydedilemedi (deploy etkilenmez): $($_.Exception.Message)" -ForegroundColor Yellow
}

# Reverse-proxy web.config self-heal: copy the repo web.config (which removes the
# WebDAV module) into the app.cetpa.com.tr site root so IIS stops 403-ing
# PUT/PATCH/DELETE. GUARDED with auto-rollback: this box once broke the whole
# Plesk panel with an IIS config change, so after copying we verify the site still
# serves through IIS (https) and restore the previous web.config if it does not.
# Non-fatal (try/catch): the client X-Cetpa-Method tunnel already keeps writes
# working, so a failure here must never fail the deploy.
try {
    $appCmd = "$env:windir\System32\inetsrv\appcmd.exe"
    if (Test-Path $appCmd) {
        # EXACT match only - "cetpa" alone would also match the live root site
        # "cetpa.com.tr". Never loosen this (see setup-iis-proxy.ps1).
        $siteMatch = (& $appCmd list sites) | Select-String -Pattern 'SITE "(app\.cetpa\.com\.tr)"'
        if ($siteMatch) {
            $siteName = $siteMatch.Matches[0].Groups[1].Value
            $docRoot  = ((& $appCmd list vdir "$siteName/" /text:physicalPath) -join '').Trim()
            $srcCfg   = Join-Path $AppDir 'deploy\windows\web.config'
            if ($docRoot -and (Test-Path $docRoot) -and ($docRoot -match 'app\.cetpa\.com\.tr') -and (Test-Path $srcCfg)) {
                $dstCfg = Join-Path $docRoot 'web.config'
                $bakCfg = Join-Path $docRoot 'web.config.prev'
                $same = (Test-Path $dstCfg) -and ((Get-FileHash $dstCfg).Hash -eq (Get-FileHash $srcCfg).Hash)
                if ($same) {
                    Info 'web.config already current (WebDAV fix applied).'
                } else {
                    if (Test-Path $dstCfg) { Copy-Item $dstCfg $bakCfg -Force }
                    Copy-Item $srcCfg $dstCfg -Force
                    Info 'web.config updated (WebDAV removed). Verifying site through IIS...'
                    # Verify through IIS (public https, ignore cert on PS 5.1) with retries.
                    [System.Net.ServicePointManager]::ServerCertificateValidationCallback = { $true }
                    $iisOk = $false
                    foreach ($j in 1..6) {
                        Start-Sleep 3
                        try {
                            $rr = Invoke-WebRequest -UseBasicParsing -TimeoutSec 6 'https://app.cetpa.com.tr/api/health'
                            if ($rr.StatusCode -eq 200) { $iisOk = $true; break }
                        } catch { }
                    }
                    [System.Net.ServicePointManager]::ServerCertificateValidationCallback = $null
                    if ($iisOk) {
                        Info 'IIS serves the site with new web.config (HTTP 200). WebDAV fix live.'
                    } elseif (Test-Path $bakCfg) {
                        Copy-Item $bakCfg $dstCfg -Force
                        Write-Host '    IIS health FAILED after web.config change - reverted to previous web.config (tunnel still works).' -ForegroundColor Yellow
                    } else {
                        Write-Host '    IIS health FAILED and no backup to restore - leaving new web.config (tunnel still works).' -ForegroundColor Yellow
                    }
                }
            } else {
                Write-Host '    web.config self-heal skipped: site doc root not resolved or guard failed.' -ForegroundColor Yellow
            }
        }
    }
} catch {
    Write-Host "    web.config self-heal skipped (deploy unaffected): $($_.Exception.Message)" -ForegroundColor Yellow
}

# Local health check (no TLS - independent of the IIS/Plesk reverse proxy in front)
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
