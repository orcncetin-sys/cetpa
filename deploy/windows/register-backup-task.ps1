#requires -RunAsAdministrator
# Cetpa - daily off-server backup via Windows Task Scheduler.
# Runs scripts/backup-tenants.mjs: PER-TENANT backup. Each company exports ONLY
# its own rows (companyId filter) + its own uploads folder, and uploads them to
# THAT COMPANY'S OWN rclone remote (configured in the backupConfigs collection).
#
# 2026-08-21: previously a single pg_dump took ALL tenants together - not
# acceptable for multi-tenant SaaS (handing one customer their backup would
# hand them everyone else's data). Companies without a configured remote are
# NOT skipped silently: they are counted, reported, and make the task exit 1.
#
# Off-server by design, independent of the VDS provider (ODEA) - protects
# against a repeat of the 2026-07-02 "wrong server suspended" incident.
#
# NOTE: launched with `node --import tsx` because the planning logic lives in
# src/lib/tenantBackup.ts (unit-tested); plain node cannot import .ts.
#
# NOTE (2026-07-05): deploy.ps1 now registers this SAME task idempotently on
# EVERY deploy, so this standalone script is normally NOT needed - it stays as
# a manual fallback (e.g. to (re)register without a full deploy, or to change
# the run time via -RunTime). deploy.ps1 self-heals the task going forward.
# ASCII-only on purpose: Windows PowerShell 5.1 reads BOM-less .ps1 as
# Windows-1252, non-ASCII breaks parsing.
# Run:  powershell -ExecutionPolicy Bypass -File .\deploy\windows\register-backup-task.ps1

param(
    [string]$AppDir   = 'C:\cetpa',
    [string]$TaskName = 'CetpaDbBackupOffsite',
    [string]$RunTime  = '03:30'
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
function Info($m){ Write-Host "==> $m" -ForegroundColor Cyan }
function Ok($m){ Write-Host "    $m" -ForegroundColor Green }

$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
    Info "Task '$TaskName' already exists - removing to re-register with current settings."
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

$node = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
if (-not $node) { throw 'node.exe not found in PATH - install Node.js first (see setup.ps1).' }

$scriptPath = Join-Path $AppDir 'scripts\backup-tenants.mjs'
if (-not (Test-Path $scriptPath)) { throw "Backup script not found: $scriptPath - deploy the repo first." }

$action    = New-ScheduledTaskAction -Execute $node -Argument "--import tsx `"$scriptPath`"" -WorkingDirectory $AppDir
$trigger   = New-ScheduledTaskTrigger -Daily -At $RunTime
$settings  = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd -ExecutionTimeLimit (New-TimeSpan -Minutes 30) -RestartCount 2 -RestartInterval (New-TimeSpan -Minutes 5)
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description 'Cetpa: gunluk pg_dump -> Firebase Storage off-server yedek (ODEA disi).' | Out-Null

Ok "Scheduled task '$TaskName' created - runs daily at $RunTime as SYSTEM."
Info "Test it now with: Start-ScheduledTask -TaskName $TaskName"
Info 'Then check C:\cetpa\backups\ and the Firebase Storage db-backups/ path.'
