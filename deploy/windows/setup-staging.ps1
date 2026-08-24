#requires -RunAsAdministrator
# Cetpa - STAGING environment on the same Windows Server.
#
# WHY (P3.1): today every fix goes straight to production. `git push origin main`
# deploys live, there is no place to try anything first, and the only proof a
# change works is that customers do not complain. On 2026-08-18 alone several
# features turned out to have NEVER worked since the day they were written -
# nobody could have caught that without a place to click around safely.
#
# WHAT THIS CREATES
#   - a SECOND service (cetpa-staging) on a different port
#   - a SEPARATE database (cetpa_staging) so staging can never touch live data
#   - a SEPARATE checkout directory, tracking whatever branch you point it at
#
# WHAT IT DOES NOT DO ON PURPOSE
#   - no public DNS / no HTTPS binding: staging is reachable only from the
#     server itself or over an SSH tunnel. A publicly reachable staging copy
#     of an ERP is an invitation - it holds real-looking data and gets far
#     less attention than production.
#
# ASCII-only on purpose: Windows PowerShell 5.1 reads BOM-less .ps1 as
# Windows-1252, non-ASCII breaks parsing.

param(
  [string]$StagingDir  = 'C:\cetpa-staging',
  [int]   $StagingPort = 5174,
  [string]$Branch      = 'main',
  [string]$RepoUrl     = 'https://github.com/orcncetin-sys/cetpa.git',
  [string]$DbName      = 'cetpa_staging'
)

$ErrorActionPreference = 'Stop'
function Info($m) { Write-Host "[staging] $m" -ForegroundColor Cyan }
function Ok($m)   { Write-Host "[staging] $m" -ForegroundColor Green }

# 1) Checkout
if (-not (Test-Path $StagingDir)) {
  Info "Cloning $RepoUrl -> $StagingDir"
  git clone $RepoUrl $StagingDir
}
Push-Location $StagingDir
git fetch origin
git checkout $Branch
git reset --hard "origin/$Branch"
Info "Installing dependencies (this takes a few minutes)"
npm ci
npm run build
Pop-Location

# 2) Separate database - staging must NEVER share the live database.
#    A wrong DATABASE_URL here would let a test delete real customer data.
#
# CREDENTIALS COME FROM PRODUCTION'S OWN .env (2026-08-24).
# This block used to do `$env:PGPASSWORD = $env:POSTGRES_PASSWORD` and then
# `psql -U postgres`. POSTGRES_PASSWORD is not set in a normal admin shell, so
# PGPASSWORD ended up EMPTY, psql fell back to an interactive prompt and the
# whole setup died with "password authentication failed for user postgres".
# Worse, step 3 then wrote a staging DATABASE_URL with no password at all, so
# even a manually created database would not have connected at runtime.
# Production already holds a working DATABASE_URL - parse it and reuse the same
# user/host/port, changing ONLY the database name. No new secret, no prompt.
$prodEnvPath = 'C:\cetpa\.env'
if (-not (Test-Path $prodEnvPath)) { throw "Production .env not found at $prodEnvPath - cannot derive DB credentials." }
$prodDbLine = (Get-Content $prodEnvPath | Where-Object { $_ -match '^DATABASE_URL=' } | Select-Object -First 1)
if (-not $prodDbLine) { throw "DATABASE_URL missing from $prodEnvPath - cannot derive DB credentials." }
$prodDbUrl = $prodDbLine -replace '^DATABASE_URL=', ''
$prodDbUrl = $prodDbUrl.Trim().Trim('"').Trim("'")

# postgresql://user:pass@host:port/dbname  (pass/port optional)
$m = [regex]::Match($prodDbUrl, '^postgres(?:ql)?://([^:/@]+)(?::([^@]*))?@([^:/]+)(?::(\d+))?/(.+?)(?:\?.*)?$')
if (-not $m.Success) { throw "Could not parse DATABASE_URL from production .env (expected postgresql://user:pass@host/db)." }
$pgUser = $m.Groups[1].Value
$pgPass = $m.Groups[2].Value
$pgHost = $m.Groups[3].Value
$pgPort = if ($m.Groups[4].Success) { $m.Groups[4].Value } else { '5432' }
Info "Using DB credentials from production .env (user '$pgUser' on ${pgHost}:$pgPort)"

$env:PGPASSWORD = $pgPass
Info "Creating database '$DbName' if missing"
$exists = & psql -U $pgUser -h $pgHost -p $pgPort -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$DbName'" 2>$null
if ($exists -ne '1') {
  & createdb -U $pgUser -h $pgHost -p $pgPort $DbName
  if ($LASTEXITCODE -ne 0) { throw "createdb failed for '$DbName' (exit $LASTEXITCODE). Does user '$pgUser' have CREATEDB?" }
  Ok "Database '$DbName' created (EMPTY - restore a backup into it if you want realistic data)"
} else {
  Ok "Database '$DbName' already exists"
}

# Staging connection string: same credentials, DIFFERENT database.
$stagingDbUrl = if ($pgPass) {
  "postgresql://${pgUser}:${pgPass}@${pgHost}:${pgPort}/$DbName"
} else {
  "postgresql://${pgUser}@${pgHost}:${pgPort}/$DbName"
}

# 3) .env - copied from production but with the DB and port overridden.
#    Secrets are reused so integrations behave the same; if you would rather
#    keep staging fully isolated from Mikro/Resend/Stripe, blank those keys.
$stagingEnv = Join-Path $StagingDir '.env'
if (-not (Test-Path $stagingEnv)) {
  Info 'Deriving staging .env from production .env'
  $lines = Get-Content $prodEnvPath | Where-Object { $_ -notmatch '^(DATABASE_URL|PORT|APP_URL)=' }
  # Parolayi TASIYAN baglanti dizesi - onceki surum parolasiz yaziyordu ve
  # staging servisi veritabanina hic baglanamazdi.
  $lines += "DATABASE_URL=$stagingDbUrl"
  $lines += "PORT=$StagingPort"
  $lines += "APP_URL=http://localhost:$StagingPort"
  # Backups from staging would overwrite real backups - disable outright.
  $lines += 'RCLONE_REMOTE='
  $lines | Set-Content -Encoding ASCII $stagingEnv
  Ok "Wrote $stagingEnv (DATABASE_URL -> $DbName, backups disabled)"
}

# 4) Service
$node = (Get-Command node.exe).Source
if (-not (Get-Service 'cetpa-staging' -ErrorAction SilentlyContinue)) {
  Info 'Registering NSSM service cetpa-staging'
  nssm install cetpa-staging $node
  nssm set cetpa-staging AppParameters "--import tsx `"$StagingDir\server.ts`""
  nssm set cetpa-staging AppDirectory $StagingDir
  nssm set cetpa-staging AppEnvironmentExtra "NODE_ENV=production" "PORT=$StagingPort"
  New-Item -ItemType Directory -Force -Path (Join-Path $StagingDir 'logs') | Out-Null
  nssm set cetpa-staging AppStdout "$StagingDir\logs\service-out.log"
  nssm set cetpa-staging AppStderr "$StagingDir\logs\service-err.log"
  nssm set cetpa-staging AppRotateFiles 1
  nssm set cetpa-staging AppRotateOnline 1
  nssm set cetpa-staging AppRotateBytes 52428800
  nssm set cetpa-staging Start SERVICE_DEMAND_START   # manual: staging need not run 24/7
  Ok 'Service cetpa-staging registered (manual start)'
}

Start-Service cetpa-staging
Start-Sleep -Seconds 8
try {
  $r = Invoke-WebRequest "http://localhost:$StagingPort/api/health" -UseBasicParsing -TimeoutSec 20
  Ok "Staging is UP: http://localhost:$StagingPort (HTTP $($r.StatusCode))"
} catch {
  Write-Host "[staging] health check FAILED - see $StagingDir\logs\service-err.log" -ForegroundColor Red
}

Write-Host ''
Write-Host 'Next steps:' -ForegroundColor Yellow
Write-Host "  Reach it from your Mac:  ssh -L $StagingPort`:localhost:$StagingPort <user>@<server>"
Write-Host "  then open               http://localhost:$StagingPort"
Write-Host "  Deploy a branch here:   cd $StagingDir; git fetch; git reset --hard origin/<branch>; npm ci; npm run build; Restart-Service cetpa-staging"
Write-Host "  Realistic data:         restore a tenant backup into $DbName (see scripts/restore-drill.mjs)"
