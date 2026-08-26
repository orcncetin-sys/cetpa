# Cetpa - release deploy script (CI/CD or manual). ASCII-only (PS 5.1 Windows-1252 safe).
# ci-windows.yml calls this over SSH:  powershell -File C:\cetpa\deploy\windows\deploy.ps1
# git reset to origin/main -> npm ci -> build -> restart service -> local health check.

param(
    [string]$AppDir  = 'C:\cetpa',
    [int]   $AppPort = 5173,
    [string]$Branch  = 'main',
    # Servis adi ve IIS adimlari PARAMETRIK (2026-08-24): ayni script hem
    # production hem STAGING icin kullanilsin diye. Staging'de:
    #   -AppDir C:\cetpa-staging -AppPort 5174 -ServiceName cetpa-staging -SkipIis
    # Once servis adi 9 yerde sabit kodluydu ve staging'e deploy edilemiyordu;
    # staging kurulum scripti (setup-staging.ps1) yazilmisti ama CI'a hic
    # baglanamamisti - her degisiklik dogrudan canliya gidiyordu.
    [string]$ServiceName = 'cetpa',
    # IIS ters-proxy self-heal'i YALNIZ production icin anlamli: staging'in
    # public DNS'i / HTTPS binding'i bilerek yok (bkz. setup-staging.ps1).
    [switch]$SkipIis
)
# Log dizini AppDir'den turetilir - boylece staging kendi loguna bakar.
$LogDir = Join-Path $AppDir 'logs'
$ErrorActionPreference = 'Stop'
# CI/CD runs this over SSH (no console buffer) -> suppress progress bars.
$ProgressPreference = 'SilentlyContinue'
$env:CHOCOLATEY_NO_PROGRESS = 'true'
function Info($m){ Write-Host "==> $m" -ForegroundColor Cyan }

Set-Location $AppDir

Info "git fetch + reset --hard origin/$Branch"
git fetch origin $Branch --quiet
git reset --hard "origin/$Branch"

Info 'Cleaning up ROTATED logs (active files are left alone on purpose)...'
# NEVER DELETE THE ACTIVE LOG WHILE THE SERVICE RUNS.
#
# This block used to delete EVERY file in C:\cetpa\logs - and it runs here, ~50
# lines BEFORE 'Stop-Service cetpa'. NSSM opens service-err.log / service-out.log
# with FILE_SHARE_DELETE (it must, for online rotation), so Remove-Item SUCCEEDS:
# the file is unlinked from the directory but NSSM's handle keeps it alive.
# The service then keeps appending to a file that:
#   - does not appear in Get-ChildItem (the logs folder reads as "0 GB"),
#   - still consumes disk space,
#   - NEVER rotates (NSSM rotates by renaming the VISIBLE file; an unlinked file
#     is never found, so AppRotateBytes stops applying),
#   - grows without any bound until the process exits.
# That is how the disk filled to 200/200 GB with nothing large visible anywhere,
# and why a reboot alone freed ~105 GB on 2026-08-24 without deleting a thing.
# It recurred because every deploy re-created the orphaned handle.
#
# Fix: only remove ROTATED files (NSSM appends a timestamp to their name). Those
# are closed, so deleting them actually reclaims space. The two active files stay
# bounded by NSSM rotation (50 MB each) and are pruned hourly by the app's
# donmusLoglariBuda() once rotated.
try {
    if (Test-Path $LogDir) {
        Get-ChildItem -Path $LogDir -File -Recurse -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -ne 'service-err.log' -and $_.Name -ne 'service-out.log' } |
            Remove-Item -Force -ErrorAction SilentlyContinue
    }
} catch {
    Write-Host "    Log cleanup skipped: $($_.Exception.Message)" -ForegroundColor Yellow
}

# ---- Near-zero-downtime deploy ---------------------------------------------
# Old behaviour stopped the service FIRST and only then ran npm ci + build, so
# the site returned 502 for 1-2 minutes on EVERY deploy (2026-08-11: the user
# hit this repeatedly - "Failed to fetch", a stuck "Aktariliyor..." import and
# finally a plain 502 page).
#
# npm ci still REQUIRES a stopped service: the running process (tsx -> esbuild)
# holds a handle on node_modules\@esbuild\win32-x64\esbuild.exe and npm ci fails
# with EPERM while it is up. But dependencies change rarely.
#
# So: if package-lock.json is unchanged since the last SUCCESSFUL deploy, take
# the fast path - build into dist.new while the old process keeps serving, then
# stop, rename the directory (instant on the same volume) and start again.
# Downtime drops from minutes to the service restart alone.
#
# Bonus: on the fast path a FAILED build never stops the service, so a broken
# commit no longer takes the site down - it only fails the deploy.
$stateDir  = Join-Path $AppDir '.deploy-state'
$stampFile = Join-Path $stateDir 'lock.hash'
if (-not (Test-Path $stateDir)) { New-Item -ItemType Directory -Path $stateDir -Force | Out-Null }
$lockFile = Join-Path $AppDir 'package-lock.json'
$lockHash = if (Test-Path $lockFile) { (Get-FileHash $lockFile -Algorithm SHA256).Hash } else { 'NOLOCK' }
$prevHash = if (Test-Path $stampFile) { (Get-Content $stampFile -Raw).Trim() } else { '' }
$depsChanged = ($lockHash -ne $prevHash)

$distPath = Join-Path $AppDir 'dist'
$distNew  = Join-Path $AppDir 'dist.new'
$distOld  = Join-Path $AppDir 'dist.old'
# Leftovers from an interrupted run would break the rename below.
if (Test-Path $distNew) { Remove-Item $distNew -Recurse -Force -ErrorAction SilentlyContinue }
if (Test-Path $distOld) { Remove-Item $distOld -Recurse -Force -ErrorAction SilentlyContinue }

if ($depsChanged) {
    # SLOW PATH - unavoidable downtime. Also taken on the very first run under
    # this script (no stamp yet), which guarantees node_modules matches the lock.
    Info 'package-lock.json changed -> full path (service stops for npm ci)'
    Stop-Service $ServiceName -Force -ErrorAction SilentlyContinue
    Start-Sleep 2
    Info 'npm ci --legacy-peer-deps'
    npm ci --legacy-peer-deps
    Info 'npm run build'
    npm run build
    Info "Starting $ServiceName service"
    Restart-Service $ServiceName -Force
} else {
    Info 'Dependencies unchanged -> fast path (build first, service stays up)'
    Info 'npm run build -> dist.new (current build keeps serving meanwhile)'
    npm run build -- --outDir dist.new --emptyOutDir
    if (-not (Test-Path (Join-Path $distNew 'index.html'))) {
        Write-Error 'Build produced no dist.new\index.html - aborting WITHOUT touching the running service.'
        exit 1
    }
    Info 'Swapping dist (service is down only for the swap + restart)'
    Stop-Service $ServiceName -Force -ErrorAction SilentlyContinue
    Start-Sleep 2
    if (Test-Path $distPath) { Rename-Item $distPath 'dist.old' -Force }
    # If the old dist could not be moved (open handle), renaming dist.new over it
    # fails too and the service would silently come back on the PREVIOUS build
    # while the health check still passes - a green deploy serving old code.
    # Fail loudly instead, after putting the service back up.
    if (Test-Path $distPath) {
        Restart-Service $ServiceName -Force
        Write-Error 'Could not move the old dist aside - service restarted on the PREVIOUS build. Deploy failed.'
        exit 1
    }
    Rename-Item $distNew 'dist' -Force
    Info "Starting $ServiceName service"
    Restart-Service $ServiceName -Force
    Remove-Item $distOld -Recurse -Force -ErrorAction SilentlyContinue
}

# Off-server backup scheduled task - idempotent, registered on every deploy so it
# self-heals if it was never set up or got removed. Runs scripts\backup-tenants.mjs
# (kiraci basina pg_dump -> rclone remote) daily at 03:30 as SYSTEM.
# NOT (2026-08-25): bu yorum eskiden 'backup-db-offsite.mjs (-> Firebase Storage)'
# diyordu ama gorev COKTAN backup-tenants.mjs kaydediyordu. Bir kesintide gorev
# aciklamasina bakan kisi yanlis script'i ve yanlis yedek hedefini arardi.
# Wrapped in try/catch: this is NOT on the critical deploy path, so a failure
# here (e.g. non-elevated SSH token) must not fail the deploy.
try {
    $bkTask = 'CetpaDbBackupOffsite'
    $bkScript = Join-Path $AppDir 'scripts\backup-tenants.mjs'
    $nodeExe = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
    if ($nodeExe -and (Test-Path $bkScript)) {
        if (Get-ScheduledTask -TaskName $bkTask -ErrorAction SilentlyContinue) {
            Unregister-ScheduledTask -TaskName $bkTask -Confirm:$false
        }
        $bkAction    = New-ScheduledTaskAction -Execute $nodeExe -Argument "--import tsx `"$bkScript`"" -WorkingDirectory $AppDir
        $bkTrigger   = New-ScheduledTaskTrigger -Daily -At '03:30'
        $bkSettings  = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd -ExecutionTimeLimit (New-TimeSpan -Minutes 30) -RestartCount 2 -RestartInterval (New-TimeSpan -Minutes 5)
        $bkPrincipal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
        Register-ScheduledTask -TaskName $bkTask -Action $bkAction -Trigger $bkTrigger -Settings $bkSettings -Principal $bkPrincipal -Description 'Cetpa: gunluk kiraci-basina pg_dump -> rclone off-server yedek (backup-tenants.mjs).' | Out-Null
        Info "Backup scheduled task '$bkTask' ensured (daily 03:30, SYSTEM)."

    # ---- NSSM log rotation (idempotent) ---------------------------------
    # Without rotation the service log grows without bound. On 2026-07-31
    # service-err.log hit 1.6 GB from a pg-boss error loop and helped fill
    # the disk, taking the app down. 50 MB per file, rotate while running.
    try {
        nssm set $ServiceName AppRotateFiles 1  | Out-Null
        nssm set $ServiceName AppRotateOnline 1 | Out-Null
        nssm set $ServiceName AppRotateBytes 52428800 | Out-Null
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
    # STAGING'DE ATLA: staging'in public DNS'i ve HTTPS binding'i bilerek yok,
    # dolayisiyla app.cetpa.com.tr'nin IIS yapilandirmasina dokunmasi hem
    # anlamsiz hem tehlikeli olurdu (bu kutu bir kez IIS degisikligiyle tum
    # Plesk panelini kirmisti).
    $appCmd = if ($SkipIis) { $null } else { "$env:windir\System32\inetsrv\appcmd.exe" }
    if ($SkipIis) { Info 'IIS reverse-proxy self-heal atlandi (-SkipIis).' }
    if ($appCmd -and (Test-Path $appCmd)) {
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
    # Record the lock hash ONLY after a healthy deploy. If this deploy failed we
    # must NOT remember it: the next run has to take the slow path and re-run
    # npm ci, otherwise a half-installed node_modules would be skipped forever.
    try {
        Set-Content -Path $stampFile -Value $lockHash -Encoding ASCII
    } catch {
        Write-Host "    Could not write lock stamp (next deploy just runs npm ci): $($_.Exception.Message)" -ForegroundColor Yellow
    }
    Info 'Health OK (HTTP 200). Deploy succeeded.'
    exit 0
} else {
    Write-Error "Health check failed - inspect $LogDir\service-err.log"
    exit 1
}
