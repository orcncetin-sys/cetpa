#requires -RunAsAdministrator
# Cetpa - OPS_SUMMARY_TOKEN'i dondur.
#
# NE ISE YARAR: OPS_SUMMARY_TOKEN, kimlik dogrulamasi GEREKTIRMEYEN tanilama
# uclarinin tek kapisidir (opsRoutes.ts:63/80, mikroRoutes.ts:1611/1788 ve
# /api/ops/disk-test). Jeton sizarsa o uclar herkese acik hale gelir.
# Bu yuzden dondurulmesi gereken bir sirdir ve 'acik isler'de bekliyordu -
# ama bir araci YOKTU, yani elle .env duzenlemek gerekiyordu.
#
# NEDEN SCRIPT: elle yapinca iki adim unutuluyor - (1) .env'i BOM'suz UTF-8
# yazmak, (2) servisi yeniden baslatmak. .env yalniz ACILISTA okunur; restart
# unutulursa yeni jeton gecerli OLMAZ ve "jeton calismiyor" diye saatler
# harcanir (Resend anahtarinda tam bu yasandi).
#
# GUVENLIK: yeni jeton bu ekranda GOSTERILMEZ (kabuk gecmisine/loga dusmesin).
# Panoya kopyalanir; -Show ile gormek istersen acikca istemelisin.
#
# ASCII-only (PowerShell 5.1 + Windows-1252).

param(
  [string]$EnvPath     = 'C:\cetpa\.env',
  [string]$ServiceName = 'cetpa',
  [int]   $AppPort     = 5173,
  # Yeni jetonu ekrana bas (varsayilan: yalniz panoya kopyala).
  [switch]$Show
)

$ErrorActionPreference = 'Stop'
function Info($m){ Write-Host "==> $m" -ForegroundColor Cyan }
function Ok($m){ Write-Host "    $m" -ForegroundColor Green }
function Warn($m){ Write-Host "    $m" -ForegroundColor Yellow }

if (-not (Test-Path $EnvPath)) { throw ".env bulunamadi: $EnvPath" }

# -- 1) Yeni jeton uret (48 bayt -> URL-guvenli base64) ---------------------
$bytes = New-Object byte[] 48
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$yeni = [Convert]::ToBase64String($bytes).Replace('+','-').Replace('/','_').TrimEnd('=')
Info "Yeni jeton uretildi ($($yeni.Length) karakter)"

# -- 2) .env'i oku ve guncelle ----------------------------------------------
# UTF-8 OKU/YAZ (BOM'suz): PS 5.1 varsayilani Windows-1252'dir ve .env'deki
# Turkce degerleri bozar; `-Encoding UTF8` ise BOM yazip ILK anahtari okunamaz
# hale getirir. Ikisi de daha once yasandi.
$utf8 = New-Object System.Text.UTF8Encoding($false)
$satirlar = [System.IO.File]::ReadAllLines($EnvPath, $utf8)

$yedek = "$EnvPath.bak-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
Copy-Item $EnvPath $yedek -Force
Ok "'.env' yedegi: $yedek"

$bulundu = $false
$yeniSatirlar = $satirlar | ForEach-Object {
  if ($_ -match '^OPS_SUMMARY_TOKEN=') { $bulundu = $true; "OPS_SUMMARY_TOKEN=$yeni" } else { $_ }
}
if (-not $bulundu) {
  Warn 'OPS_SUMMARY_TOKEN .env icinde YOKTU - sona ekleniyor.'
  $yeniSatirlar = @($yeniSatirlar) + "OPS_SUMMARY_TOKEN=$yeni"
}
[System.IO.File]::WriteAllLines($EnvPath, [string[]]$yeniSatirlar, $utf8)

# DOGRULA: OPS_SUMMARY_TOKEN DISINDAKI her satir aynen kalmali.
# Kodlama hatasiyla sessiz veri kaybina karsi son savunma (rotate-db-password
# ile ayni kontrol; orada bir kez ASCII yazip Turkce degerleri '?' yapmistik).
$geriOkunan = [System.IO.File]::ReadAllLines($EnvPath, $utf8)
$onceDiger = @($satirlar    | Where-Object { $_ -notmatch '^OPS_SUMMARY_TOKEN=' })
$sonraDiger = @($geriOkunan | Where-Object { $_ -notmatch '^OPS_SUMMARY_TOKEN=' })
$bozuk = $onceDiger.Count -ne $sonraDiger.Count
if (-not $bozuk) {
  for ($i = 0; $i -lt $onceDiger.Count; $i++) {
    if ($onceDiger[$i] -cne $sonraDiger[$i]) { $bozuk = $true; break }
  }
}
if ($bozuk) {
  Copy-Item $yedek $EnvPath -Force
  throw ".env yazimi diger satirlari DEGISTIRDI (kodlama sorunu) - yedekten geri alindi: $yedek"
}
Ok '.env guncellendi ve dogrulandi (diger satirlar aynen korundu)'

# -- 3) Servisi yeniden baslat (jeton yalniz acilista okunur) ---------------
Info "Servis yeniden baslatiliyor: $ServiceName"
Restart-Service $ServiceName -Force
Start-Sleep -Seconds 8

# -- 4) YENI jetonun GERCEKTEN gecerli oldugunu KANITLA ---------------------
# Sadece "servis ayakta" yetmez: .env okunmamis olabilir. Korumali bir uca
# YENI jetonla vurup 401 DISINDA bir yanit aldigimizi dogruluyoruz.
$saglikli = $false
for ($i = 1; $i -le 10; $i++) {
  try {
    if ((Invoke-WebRequest -UseBasicParsing -TimeoutSec 10 "http://localhost:$AppPort/api/health").StatusCode -eq 200) { $saglikli = $true; break }
  } catch { Start-Sleep -Seconds 3 }
}
if (-not $saglikli) {
  Copy-Item $yedek $EnvPath -Force
  Restart-Service $ServiceName -Force
  throw "Uygulama saglik yoklamasina yanit vermedi - .env GERI ALINDI ($yedek)."
}

$eskiEAP = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
$kod = 0
try {
  $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 15 -Method POST `
        -Headers @{ 'x-ops-token' = $yeni } -ContentType 'application/json' -Body '{}' `
        -Uri "http://localhost:$AppPort/api/ops/disk-test"
  $kod = [int]$r.StatusCode
} catch { if ($_.Exception.Response) { $kod = [int]$_.Exception.Response.StatusCode } }
$ErrorActionPreference = $eskiEAP

if ($kod -eq 401) {
  Copy-Item $yedek $EnvPath -Force
  Restart-Service $ServiceName -Force
  throw "YENI jeton 401 aldi - .env okunmamis olabilir. Yedekten GERI ALINDI ($yedek)."
}
Ok "Dogrulandi: yeni jeton gecerli (/api/ops/disk-test -> HTTP $kod, 401 degil)"

# -- 5) Jetonu teslim et ----------------------------------------------------
try { Set-Clipboard -Value $yeni; Ok 'Yeni jeton PANOYA kopyalandi.' }
catch { Warn 'Pano kullanilamadi.'; $Show = $true }
if ($Show) { Write-Host ''; Write-Host "OPS_SUMMARY_TOKEN=$yeni" -ForegroundColor Yellow }

Write-Host ''
Warn "ESKI jeton artik gecersiz. Yedek dosyada ESKI jeton duruyor: $yedek"
Warn 'Dogruladiktan sonra o yedegi SIL.'
Warn 'Bu jetonu kullanan yerler varsa (kaydedilmis curl/Postman istekleri, izleme'
Warn 'scriptleri) onlari da guncelle.'
