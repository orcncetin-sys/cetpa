# pg-sorgu.ps1 -- READ-ONLY query against the Cetpa app database. Changes NOTHING.
#
# Why: ops questions ("does the syncLog table have rows?", "which products have
# no depoBreakdown?") kept needing psql by hand. This wrapper reads DATABASE_URL
# from the app env file EXACTLY like tasima-oncesi-yedek.ps1 does: the value is
# never printed, the password lives in PGPASSWORD only for the duration of the
# psql call and is removed afterwards, and nothing secret goes on a command line.
#
# Read-only is ENFORCED BY THE SERVER: the psql session runs with
# default_transaction_read_only=on (PGOPTIONS), so any write - however it is
# spelled - is rejected by PostgreSQL itself. The shape check below is only a
# courtesy for typos; a SELECT that calls pg_terminate_backend() is still an
# admin action, so hand this tool to administrators only.
#
# Run (SERVER, any PowerShell):
#   powershell -ExecutionPolicy Bypass -File C:\cetpa\deploy\windows\pg-sorgu.ps1 -Sql "SELECT COUNT(*) FROM docs WHERE coll='syncLog'"
#   powershell -ExecutionPolicy Bypass -File C:\cetpa\deploy\windows\pg-sorgu.ps1 -Sql "SELECT ..." -Csv > C:\luca\cikti.csv
#
# ASCII-only on purpose (PowerShell 5.1 reads BOM-less .ps1 as Windows-1252).

param(
    [Parameter(Mandatory=$true)][string]$Sql,
    [string]$AppDir = 'C:\cetpa',
    [string]$PgBin  = 'C:\Program Files\PostgreSQL\15\bin',
    [switch]$Csv
)
$ErrorActionPreference = 'Stop'

# ---- 1. Read-only guard ------------------------------------------------------
$stmt = $Sql.Trim()
if ($stmt -notmatch '^(select|with)\b') { throw 'Only SELECT / WITH statements are allowed (read-only tool).' }
if ($stmt.TrimEnd(';').Contains(';')) { throw 'One statement only.' }

# ---- 2. Connection from the env file (value never printed) -------------------
$envFile = Join-Path $AppDir '.env'
if (-not (Test-Path $envFile)) { throw "env file not found: $envFile" }
$psql = Join-Path $PgBin 'psql.exe'
if (-not (Test-Path $psql)) {
    $found = Get-ChildItem 'C:\Program Files\PostgreSQL\*\bin\psql.exe' -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1
    if ($found) { $psql = $found.FullName }
}
if (-not (Test-Path $psql)) { throw "psql not found: $psql (pass -PgBin)" }

$lines = [System.IO.File]::ReadAllLines($envFile, [System.Text.UTF8Encoding]::new($false))
$line  = $lines | Where-Object { $_ -match '^\s*DATABASE_URL\s*=' } | Select-Object -First 1
if (-not $line) { throw 'DATABASE_URL not defined in env file' }
$dbUrl = ($line -replace '^\s*DATABASE_URL\s*=\s*', '').Trim().Trim('"').Trim("'")
# user:password@host[:port]/db[?node-only-params]  -- query string is dropped on purpose
$m = [regex]::Match($dbUrl, '^postgres(?:ql)?://([^:/@]+):([^@]*)@([^:/]+)(?::(\d+))?/(.+?)(?:\?.*)?$')  # identical to tasima-oncesi-yedek.ps1
if (-not $m.Success) { throw 'DATABASE_URL could not be parsed (expected postgresql://user:password@host[:port]/db)' }
$dbUser = $m.Groups[1].Value
$dbHost = $m.Groups[3].Value
$dbPort = '5432'
if ($m.Groups[4].Success) { $dbPort = $m.Groups[4].Value }
$dbName = $m.Groups[5].Value

# ---- 3. Run -------------------------------------------------------------------
$psqlArgs = @('-X', '-h', $dbHost, '-p', $dbPort, '-U', $dbUser, '-d', $dbName, '-v', 'ON_ERROR_STOP=1')
if ($Csv) { $psqlArgs += '--csv' } else { $psqlArgs += @('-P', 'pager=off') }
$psqlArgs += @('-c', $stmt)

$env:PGPASSWORD = [uri]::UnescapeDataString($m.Groups[2].Value)
$env:PGOPTIONS  = '-c default_transaction_read_only=on'   # server-side read-only, cannot be bypassed by SQL spelling
$rc = -1
try {
    # Native stderr (NOTICE/WARNING/connection errors) must not abort the script under
    # ErrorActionPreference=Stop before the exit code is read: capture both streams.
    $ErrorActionPreference = 'Continue'
    $out = & $psql @psqlArgs 2>&1
    $rc  = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    $out | ForEach-Object { "$_" }
} finally {
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
    Remove-Item Env:PGOPTIONS  -ErrorAction SilentlyContinue
}
if ($rc -ne 0) { throw "psql exit code $rc" }
