#requires -RunAsAdministrator
# Cetpa - FULL LOCAL BACKUP before a provider-side server move / IP change.
#
# WHY (2026-09-18): ODEAWEB moves the VM to new hardware with a new IP and offers
# NO snapshot and NO rollback plan. This script is our own rollback: everything
# needed to rebuild the box from zero lands in ONE folder that must then be
# COPIED OFF THE SERVER (a local backup does not survive a failed disk move).
#
# What it takes (each step is independent - one failure does not stop the rest):
#   1. PostgreSQL : pg_dump (custom format) of the app database (URL read from the
#                   app env file; the value is never printed)
#   2. SQL Server : COPY_ONLY + CHECKSUM backup of every user database on
#                   .\SQLEXPRESS (Mikro V17 lives here). COPY_ONLY does not break
#                   Mikro's own backup chain. C:\13082026 is never touched.
#   3. App files  : env file, uploads\ (tahsilat receipts)
#   4. Server cfg : IIS config backup (appcmd), the site's live web.config, SSL cert bindings, IIS bindings,
#                   IP configuration, scheduled tasks list, services list
#   5. Off-site   : triggers the existing daily off-site task (CetpaDbBackupOffsite)
#
# ASCII-only on purpose (PowerShell 5.1 reads BOM-less .ps1 as Windows-1252).
# Run: powershell -ExecutionPolicy Bypass -File C:\cetpa\deploy\windows\tasima-oncesi-yedek.ps1

param(
    [string]$AppDir      = 'C:\cetpa',
    [string]$OutRoot     = 'C:\cetpa-tasima-yedek',
    [string]$SqlInstance = '.\SQLEXPRESS',
    [string]$PgBin       = 'C:\Program Files\PostgreSQL\15\bin',
    [string]$BackupTask  = 'CetpaDbBackupOffsite',
    [string]$SiteName    = 'app.cetpa.com.tr'
)
$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
function Info($m){ Write-Host "==> $m" -ForegroundColor Cyan }
function Ok($m){ Write-Host "    OK    $m" -ForegroundColor Green }
function Warn($m){ Write-Host "    WARN  $m" -ForegroundColor Yellow; $script:Warnings++ }
$script:Warnings = 0

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$Out = Join-Path $OutRoot $stamp
New-Item -ItemType Directory -Force -Path $Out | Out-Null
Info "Backup folder: $Out"
# The folder will hold the env file and full database dumps: lock it down to
# Administrators + SYSTEM (C:\ grants read to local users / IIS app pools by default).
icacls $Out /inheritance:r /grant:r 'BUILTIN\Administrators:(OI)(CI)F' 'NT AUTHORITY\SYSTEM:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { Warn 'could not restrict folder permissions (icacls) - the backup is readable by local users' }
# Every run writes ALL SQL databases again into a new timestamped folder. The
# 2026-07-31 outage was a full disk - warn before filling it (C:\13082026 lives here too).
try {
    $freeGb = [math]::Round((Get-PSDrive ($OutRoot.Substring(0,1))).Free / 1GB, 1)
    Info "Free space on $($OutRoot.Substring(0,2)) $freeGb GB"
    if ($freeGb -lt 15) { Warn "low disk space ($freeGb GB) - SQL backups may fill the drive; delete older $OutRoot\* runs first" }
} catch { Warn "free space could not be read: $($_.Exception.Message)" }

# ---- 1. PostgreSQL ---------------------------------------------------------
Info 'PostgreSQL dump'
try {
    $envFile = Join-Path $AppDir '.env'
    $pgDump  = Join-Path $PgBin 'pg_dump.exe'
    if (-not (Test-Path $envFile)) { throw "env file not found: $envFile" }
    # Same discovery as the live scripts (rotate-db-password.ps1): do not pin the PostgreSQL version.
    if (-not (Test-Path $pgDump)) {
        $found = Get-ChildItem 'C:\Program Files\PostgreSQL\*\bin\pg_dump.exe' -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1
        if ($found) { $pgDump = $found.FullName }
    }
    if (-not (Test-Path $pgDump))  { throw "pg_dump not found: $pgDump (pass -PgBin)" }
    # UTF-8 read (PS 5.1 defaults to Windows-1252). The URL is PARSED so the password travels in
    # PGPASSWORD, never on the pg_dump command line (visible in Task Manager / process audit),
    # and a Node-only query parameter in the URL cannot make pg_dump reject it.
    $lines = [System.IO.File]::ReadAllLines($envFile, [System.Text.UTF8Encoding]::new($false))
    $line = $lines | Where-Object { $_ -match '^\s*DATABASE_URL\s*=' } | Select-Object -First 1
    if (-not $line) { throw 'DATABASE_URL not defined in env file' }
    $dbUrl = ($line -replace '^\s*DATABASE_URL\s*=\s*', '').Trim().Trim('"').Trim("'")
    $m = [regex]::Match($dbUrl, '^postgres(?:ql)?://([^:/@]+):([^@]*)@([^:/]+)(?::(\d+))?/(.+?)(?:\?.*)?$')
    if (-not $m.Success) { throw 'DATABASE_URL could not be parsed (expected postgresql://user:password@host/db)' }
    # Plain variables (same as rotate-db-password.ps1): member/index expressions are fragile as native arguments.
    $pgUser = $m.Groups[1].Value
    $pgHost = $m.Groups[3].Value
    $pgPort = if ($m.Groups[4].Success) { $m.Groups[4].Value } else { '5432' }
    $pgDb   = $m.Groups[5].Value
    $pgOut = Join-Path $Out 'cetpa_db.dump'
    $env:PGPASSWORD = [uri]::UnescapeDataString($m.Groups[2].Value)
    & $pgDump --format=custom --no-owner --file=$pgOut -U $pgUser -h $pgHost -p $pgPort -d $pgDb
    $pgRc = $LASTEXITCODE
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
    if ($pgRc -ne 0) { throw "pg_dump exit code $pgRc" }
    $mb = [math]::Round((Get-Item $pgOut).Length / 1MB, 1)
    if ($mb -lt 0.1) { Warn "pg dump is suspiciously small ($mb MB)" } else { Ok "cetpa_db.dump ($mb MB)" }
} catch { Warn "PostgreSQL dump FAILED: $($_.Exception.Message)" }

# ---- 2. SQL Server (Mikro) -------------------------------------------------
Info "SQL Server backups on $SqlInstance"
try {
    $sqlcmd = (Get-Command sqlcmd.exe -ErrorAction SilentlyContinue).Source
    if (-not $sqlcmd) { throw 'sqlcmd.exe not on PATH (install SQL command line tools or take the backup from SSMS)' }
    $sqlOut = Join-Path $Out 'sql'
    New-Item -ItemType Directory -Force -Path $sqlOut | Out-Null
    # The SQL Server service account must be able to write here.
    icacls $sqlOut /grant 'NT Service\MSSQL$SQLEXPRESS:(OI)(CI)M' | Out-Null
    if ($LASTEXITCODE -ne 0) { Warn 'could not grant the SQL Server service write access to the backup folder - backups below will probably fail' }
    $dbs = & $sqlcmd -S $SqlInstance -E -b -h-1 -W -Q "SET NOCOUNT ON; SELECT name FROM sys.databases WHERE database_id > 4 AND state = 0"
    if ($LASTEXITCODE -ne 0 -or -not $dbs) { throw 'could not list databases (Windows auth as sysadmin required)' }
    foreach ($db in ($dbs | Where-Object { $_ -and $_.Trim() })) {
        $name = $db.Trim()
        $bak  = Join-Path $sqlOut "$name.bak"
        $qName = $name.Replace(']', ']]')
        $o = & $sqlcmd -S $SqlInstance -E -b -Q "BACKUP DATABASE [$qName] TO DISK = N'$bak' WITH INIT, COPY_ONLY, CHECKSUM"
        $bRc = $LASTEXITCODE
        if ($bRc -ne 0 -or -not (Test-Path $bak)) { Warn "backup FAILED: $name - $(($o | Select-Object -Last 2) -join ' ')"; continue }
        $o = & $sqlcmd -S $SqlInstance -E -b -Q "RESTORE VERIFYONLY FROM DISK = N'$bak' WITH CHECKSUM"
        $vRc = $LASTEXITCODE
        $mb = [math]::Round((Get-Item $bak).Length / 1MB, 1)
        if ($vRc -ne 0) { Warn "$name.bak written ($mb MB) but VERIFY failed - $(($o | Select-Object -Last 2) -join ' ')" } else { Ok "$name.bak ($mb MB, verified)" }
    }
} catch { Warn "SQL Server backup FAILED: $($_.Exception.Message)" }

# ---- 3. App files ----------------------------------------------------------
Info 'App files'
try {
    $appOut = Join-Path $Out 'app'
    New-Item -ItemType Directory -Force -Path $appOut | Out-Null
    # -ErrorAction Stop everywhere below: with ErrorActionPreference=Continue a failed cmdlet would
    # print a red error and then STILL report OK.
    $src = Join-Path $AppDir '.env'
    if (Test-Path $src) { Copy-Item $src (Join-Path $appOut 'env.bak') -Force -ErrorAction Stop; Ok 'env file copied' } else { Warn 'env file not found' }
    $up = Join-Path $AppDir 'uploads'
    if (Test-Path $up) {
        robocopy $up (Join-Path $appOut 'uploads') /E /R:1 /W:1 /NFL /NDL /NJH /NJS | Out-Null
        if ($LASTEXITCODE -ge 8) { Warn "uploads copy reported errors (robocopy $LASTEXITCODE)" } else { Ok 'uploads\ copied' }
    } else { Ok 'uploads\ does not exist (nothing to copy)' }
} catch { Warn "App files FAILED: $($_.Exception.Message)" }

# ---- 4. Server configuration ----------------------------------------------
Info 'Server configuration'
try {
    $cfgOut = Join-Path $Out 'config'
    New-Item -ItemType Directory -Force -Path $cfgOut | Out-Null
    $appcmd = Join-Path $env:windir 'system32\inetsrv\appcmd.exe'
    if (Test-Path $appcmd) {
        & $appcmd add backup "cetpa-tasima-$stamp" | Out-Null
        if ($LASTEXITCODE -ne 0) { Warn 'appcmd add backup failed' }
        Copy-Item (Join-Path $env:windir 'system32\inetsrv\config\applicationHost.config') $cfgOut -Force -ErrorAction Stop
        Ok "IIS backup 'cetpa-tasima-$stamp' + applicationHost.config"
        # The LIVE web.config is in the Plesk site root (httpdocs), not in C:\cetpa - same lookup as deploy.ps1.
        $docRoot = ((& $appcmd list vdir "$SiteName/" /text:physicalPath) -join '').Trim()
        if ($docRoot -and (Test-Path (Join-Path $docRoot 'web.config'))) {
            Copy-Item (Join-Path $docRoot 'web.config') (Join-Path $cfgOut 'web.config.bak') -Force -ErrorAction Stop
            Ok "site web.config copied ($docRoot)"
        } else { Warn "site web.config not found (site '$SiteName')" }
    } else { Warn 'appcmd.exe not found (IIS config not backed up)' }
    netsh http show sslcert      | Out-File (Join-Path $cfgOut 'sslcert-bindings.txt') -Encoding ascii
    ipconfig /all                | Out-File (Join-Path $cfgOut 'ipconfig.txt') -Encoding ascii
    route print                  | Out-File (Join-Path $cfgOut 'routes.txt') -Encoding ascii
    Get-ScheduledTask | Where-Object { $_.TaskName -like 'Cetpa*' } | Format-List TaskName, State, Actions | Out-File (Join-Path $cfgOut 'scheduled-tasks.txt') -Encoding ascii
    Get-Service | Where-Object { $_.Name -match 'cetpa|postgres|MSSQL|W3SVC|sshd|ME|Plesk|plesk' } | Format-Table Name, Status, StartType -AutoSize | Out-File (Join-Path $cfgOut 'services.txt') -Encoding ascii
    try { Import-Module WebAdministration -ErrorAction Stop; Get-WebBinding | Format-Table protocol, bindingInformation, sslFlags -AutoSize | Out-File (Join-Path $cfgOut 'iis-bindings.txt') -Encoding ascii } catch { Warn 'IIS bindings could not be listed' }
    Ok 'network / cert / task / service snapshots written'
} catch { Warn "Server configuration FAILED: $($_.Exception.Message)" }

# ---- 5. Off-site task ------------------------------------------------------
Info "Off-site backup task '$BackupTask'"
try {
    if (Get-ScheduledTask -TaskName $BackupTask -ErrorAction SilentlyContinue) {
        Start-ScheduledTask -TaskName $BackupTask -ErrorAction Stop
        Ok 'started (runs in background; check the Ops Watchdog card or the task history in ~10 min)'
    } else { Warn 'task not registered - off-site copy NOT triggered' }
} catch { Warn "Off-site task FAILED: $($_.Exception.Message)" }

# ---- Summary ---------------------------------------------------------------
$total = [math]::Round(((Get-ChildItem $Out -Recurse -File | Measure-Object Length -Sum).Sum) / 1MB, 1)
Write-Host ''
Info "DONE - $total MB in $Out  (warnings: $script:Warnings)"
Write-Host '    NEXT: copy this WHOLE folder OFF the server before the move (RDP drive' -ForegroundColor Yellow
Write-Host '          redirection, or zip + download). It contains secrets (env file):' -ForegroundColor Yellow
Write-Host '          keep it private and delete it from the server after a successful move.' -ForegroundColor Yellow
if ($script:Warnings -gt 0) { exit 1 }
