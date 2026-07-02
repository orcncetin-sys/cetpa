#requires -RunAsAdministrator
# Cetpa - one-time setup: daily off-server DB backup via Windows Task Scheduler.
# Runs scripts/backup-db-offsite.mjs (pg_dump -> Firebase Storage), independent
# of the VDS provider (ODEA) - protects against a repeat of the 2026-07-02
# "wrong server suspended" incident, where local-only backups would have been
# unreachable for as long as the box itself was down.
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

$scriptPath = Join-Path $AppDir 'scripts\backup-db-offsite.mjs'
if (-not (Test-Path $scriptPath)) { throw "Backup script not found: $scriptPath - deploy the repo first." }

$action    = New-ScheduledTaskAction -Execute $node -Argument "`"$scriptPath`"" -WorkingDirectory $AppDir
$trigger   = New-ScheduledTaskTrigger -Daily -At $RunTime
$settings  = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd -ExecutionTimeLimit (New-TimeSpan -Minutes 30) -RestartCount 2 -RestartInterval (New-TimeSpan -Minutes 5)
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description 'Cetpa: gunluk pg_dump -> Firebase Storage off-server yedek (ODEA disi).' | Out-Null

Ok "Scheduled task '$TaskName' created - runs daily at $RunTime as SYSTEM."
Info "Test it now with: Start-ScheduledTask -TaskName $TaskName"
Info 'Then check C:\cetpa\backups\ and the Firebase Storage db-backups/ path.'
