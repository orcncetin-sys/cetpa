# Cetpa - READ-ONLY checklist for a server IP change. Changes NOTHING.
#
# Run it TWICE:
#   BEFORE the move : shows everything that is pinned to the OLD IP (to-do list)
#   AFTER the move  : every line should be OK; FAIL lines are what is still broken
#
# Context (2026-09-18): ODEAWEB moves the same VM/disk to new hardware, only the
# public IP changes; the old IP stays routed in parallel for ~48 h. The app itself
# does not depend on the IP (Mikro API is http://localhost:8094, health checks use
# the domain name). What DOES depend on it: IIS/Plesk bindings, SSL cert bindings,
# firewall rules scoped to the address, DNS (Cloudflare), the GitHub deploy secret.
#
# ASCII-only on purpose (PowerShell 5.1 reads BOM-less .ps1 as Windows-1252).
# Run: powershell -ExecutionPolicy Bypass -File .\ip-degisimi-kontrol.ps1 -YeniIp 1.2.3.4

param(
    [string]$EskiIp   = '213.238.190.124',
    [string]$YeniIp   = '',
    [string]$AppDir   = 'C:\cetpa',
    [string]$AlanAdi  = 'app.cetpa.com.tr',
    [int]   $AppPort  = 5173,
    [int]   $MikroPort = 8094
)
$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
$script:Fail = 0; $script:Warn = 0
function Baslik($m){ Write-Host ''; Write-Host "== $m" -ForegroundColor Cyan }
function Ok($m){   Write-Host "  OK    $m" -ForegroundColor Green }
function Uyar($m){ Write-Host "  WARN  $m" -ForegroundColor Yellow; $script:Warn++ }
function Hata($m){ Write-Host "  FAIL  $m" -ForegroundColor Red; $script:Fail++ }

Baslik '1. IP addresses on this machine'
$ips = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -notmatch '^(127\.|169\.254\.)' } | ForEach-Object { $_.IPAddress })
$ips | ForEach-Object { Write-Host "        $_" }
if ($YeniIp) {
    if ($ips -contains $YeniIp) { Ok "new IP $YeniIp is assigned" } else { Hata "new IP $YeniIp is NOT assigned to any adapter" }
}
if ($ips -contains $EskiIp) { Uyar "old IP $EskiIp is still assigned (expected during the 48 h parallel window)" } else { Ok "old IP $EskiIp is no longer assigned" }

Baslik '2. IIS bindings pinned to a specific IP'
try {
    Import-Module WebAdministration -ErrorAction Stop
    $pinned = @(Get-WebBinding | Where-Object { $_.bindingInformation -notmatch '^\*:' })
    if (-not $pinned.Count) { Ok 'all bindings use * (not pinned to an address)' }
    foreach ($b in $pinned) {
        if ($b.bindingInformation -like "$EskiIp*") { Hata "binding pinned to OLD IP: $($b.protocol) $($b.bindingInformation)  -> remap in Plesk (Tools & Settings > IP Addresses)" }
        else { Ok "binding: $($b.protocol) $($b.bindingInformation)" }
    }
} catch { Uyar "IIS bindings could not be read: $($_.Exception.Message)" }

Baslik '3. SSL certificate bindings (http.sys)'
$ssl = netsh http show sslcert
$sslOld = @($ssl | Select-String -SimpleMatch "${EskiIp}:")
if ($sslOld.Count) { $sslOld | ForEach-Object { Hata "SSL binding on OLD IP: $($_.Line.Trim())" } } else { Ok 'no SSL binding is pinned to the old IP' }

Baslik '4. Plesk IP pool'
$pleskBin = $env:plesk_bin
if ($pleskBin -and (Test-Path (Join-Path $pleskBin 'ipmanage.exe'))) {
    $list = & (Join-Path $pleskBin 'ipmanage.exe') --ip_list 2>&1
    $list | ForEach-Object { Write-Host "        $_" }
    if ($list -match [regex]::Escape($EskiIp)) { Uyar "Plesk still lists the old IP (fine during the parallel window; remove after DNS cutover)" }
    if ($YeniIp -and -not ($list -match [regex]::Escape($YeniIp))) { Hata "Plesk does not know the new IP -> Tools & Settings > IP Addresses > Reread IP, then remap sites" }
} else { Uyar 'plesk_bin not found - check Plesk > Tools & Settings > IP Addresses by hand' }

Baslik '5. Services'
# PostgreSQL by wildcard (the live scripts do the same) - a pinned 'postgresql-x64-15' would only WARN
# "not found" on another version, and a STOPPED database would never show up as FAIL.
$pgSvc = @(Get-Service -Name 'postgresql*' -ErrorAction SilentlyContinue)
if (-not $pgSvc.Count) { Hata 'no PostgreSQL service found (postgresql*)' }
foreach ($p in $pgSvc) { if ($p.Status -eq 'Running') { Ok "$($p.Name) running" } else { Hata "$($p.Name) is $($p.Status)" } }
foreach ($s in @('cetpa', 'MSSQL$SQLEXPRESS', 'W3SVC', 'sshd')) {
    $svc = Get-Service -Name $s -ErrorAction SilentlyContinue
    if (-not $svc) { Uyar "service not found: $s" }
    elseif ($svc.Status -eq 'Running') { Ok "$s running" }
    else { Hata "$s is $($svc.Status)" }
}
$mail = @(Get-Service | Where-Object { $_.Name -like 'ME*' -and $_.DisplayName -like 'MailEnable*' })
foreach ($m in $mail) { if ($m.Status -eq 'Running') { Ok "$($m.Name) running" } else { Uyar "$($m.Name) is $($m.Status)" } }

Baslik '6. Application and Mikro API (both local - must NOT depend on the public IP)'
try {
    $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 20 "http://localhost:$AppPort/api/health"
    if ($r.StatusCode -eq 200) { Ok "app health 200 on localhost:$AppPort" } else { Hata "app health returned $($r.StatusCode)" }
} catch { Hata "app health FAILED on localhost:${AppPort}: $($_.Exception.Message)" }
$t = Test-NetConnection -ComputerName 'localhost' -Port $MikroPort -WarningAction SilentlyContinue
if ($t.TcpTestSucceeded) { Ok "Mikro API port $MikroPort is listening" } else { Hata "Mikro API port $MikroPort is NOT listening (Mikro API service down? license re-activation after the hardware change?)" }

Baslik '7. Public DNS (asked at 1.1.1.1, not the local cache)'
try {
    $a = @(Resolve-DnsName -Name $AlanAdi -Type A -Server 1.1.1.1 -ErrorAction Stop | Where-Object { $_.IPAddress } | ForEach-Object { $_.IPAddress })
    Write-Host "        $AlanAdi -> $($a -join ', ')"
    if ($YeniIp -and ($a -contains $YeniIp)) { Ok 'DNS already points to the new IP' }
    elseif ($a -contains $EskiIp) { Uyar 'DNS still points to the OLD IP (change the A record in Cloudflare - keep it DNS only / grey cloud)' }
    else { Uyar 'DNS points somewhere else - check Cloudflare' }
} catch { Uyar "DNS lookup failed: $($_.Exception.Message)" }
if ($YeniIp) {
    try {
        $ptr = Resolve-DnsName -Name $YeniIp -Type PTR -Server 1.1.1.1 -ErrorAction Stop | Select-Object -First 1
        Ok "PTR for ${YeniIp}: $($ptr.NameHost)"
    } catch { Uyar "no PTR record for $YeniIp yet (outgoing mail will look like spam until ODEAWEB sets it)" }
}

Baslik '8. Public HTTPS through the domain'
try {
    $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 30 "https://$AlanAdi/api/health"
    if ($r.StatusCode -eq 200) { Ok "https://$AlanAdi/api/health -> 200 (valid certificate)" } else { Hata "public health returned $($r.StatusCode)" }
} catch { Hata "public HTTPS FAILED: $($_.Exception.Message)" }

Baslik '9. Windows Firewall rules scoped to the old IP'
try {
    $fw = @(Get-NetFirewallAddressFilter -ErrorAction Stop | Where-Object { $_.LocalAddress -contains $EskiIp -or $_.RemoteAddress -contains $EskiIp })
    if ($fw.Count) { $fw | ForEach-Object { Hata "firewall rule references the old IP: $($_.InstanceID)" } } else { Ok 'no firewall rule references the old IP' }
} catch { Uyar "firewall rules could not be read: $($_.Exception.Message)" }

Baslik '10. hosts file and app env file (key NAMES only - values are never printed)'
$hosts = Join-Path $env:windir 'System32\drivers\etc\hosts'
$hh = @(Get-Content $hosts -ErrorAction SilentlyContinue | Where-Object { $_ -notmatch '^\s*#' -and $_ -match [regex]::Escape($EskiIp) })
if ($hh.Count) { $hh | ForEach-Object { Hata "hosts entry with old IP: $_" } } else { Ok 'hosts file does not mention the old IP' }
$envFile = Join-Path $AppDir '.env'
if (Test-Path $envFile) {
    $keys = @(Get-Content $envFile | Where-Object { $_ -notmatch '^\s*#' -and $_ -match [regex]::Escape($EskiIp) } | ForEach-Object { ($_ -split '=', 2)[0].Trim() })
    if ($keys.Count) { Hata "env keys containing the old IP: $($keys -join ', ')" } else { Ok 'env file does not contain the old IP' }
} else { Uyar "env file not found at $envFile" }

Baslik '11. Licenses that can react to a hardware change'
try {
    $lic = Get-CimInstance SoftwareLicensingProduct -Filter "PartialProductKey IS NOT NULL AND ApplicationID='55c92734-d682-4d71-983e-d6ec3f16059f'" | Select-Object -First 1
    if ($lic.LicenseStatus -eq 1) { Ok "Windows is activated ($($lic.Name))" } else { Uyar "Windows license status = $($lic.LicenseStatus) (1 = licensed) - $($lic.Name)" }
} catch { Uyar 'Windows activation state could not be read' }
Write-Host '        Mikro V17: open Mikro once and confirm it starts without a license prompt.' -ForegroundColor Gray

Write-Host ''
if ($script:Fail -gt 0) { Write-Host "RESULT: $script:Fail FAIL, $script:Warn WARN" -ForegroundColor Red; exit 1 }
Write-Host "RESULT: no FAIL ($script:Warn WARN)" -ForegroundColor Green
