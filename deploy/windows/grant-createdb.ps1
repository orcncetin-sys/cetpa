#requires -RunAsAdministrator
# Cetpa - uygulama kullanicisina CREATEDB yetkisi ver (staging kurulumu icin).
#
# NEDEN VAR: staging AYRI bir veritabani ister (cetpa_staging) - ayni DB'yi
# paylasmak, bir testin gercek musteri verisini silmesi demektir. Ama uygulama
# kullanicisinin CREATEDB yetkisi YOK (dogru ve istenen varsayilan) ve
# 'postgres' super kullanici parolasi bilinmiyor.
#
# BU YUZDEN pg_hba.conf GECICI olarak 'trust'a alinir. Bu, uretim
# veritabaninin kimlik dogrulamasina dokunan bir islemdir - o yuzden ELLE
# ADIM ADIM YAPILMAZ. En riskli kisim GERI ALMAYI UNUTMAK oldugundan, geri
# alma try/finally icinde: script'in nasil biterse bitsin (hata, Ctrl+C,
# psql cokmesi) pg_hba ESKI HALINE DONER.
#
# GUVENLIK PENCERESI: 'trust' YALNIZ localhost (127.0.0.1 / ::1) satirlarinda
# ve YALNIZ birkac saniye acik kalir. 5432 disariya KAPALI (olculdu
# 2026-08-24), yani pencere boyunca disaridan erisim yok. Yine de gerekli
# olandan uzun tutulmaz.
#
# NE YAPMAZ: parola DEGISTIRMEZ, veri SILMEZ, uygulama .env'ine DOKUNMAZ.
# Tek yaptigi 'ALTER ROLE <kullanici> CREATEDB'.
#
# ASCII-only (PowerShell 5.1 + Windows-1252).

param(
  [string]$EnvPath = 'C:\cetpa\.env',
  # Bos birakilirsa PostgreSQL kurulumu otomatik bulunur.
  [string]$DataDir = '',
  [string]$ServiceName = ''
)

$ErrorActionPreference = 'Stop'
function Info($m){ Write-Host "==> $m" -ForegroundColor Cyan }
function Ok($m){ Write-Host "    $m" -ForegroundColor Green }
function Warn($m){ Write-Host "    $m" -ForegroundColor Yellow }

# -- 1) Uygulama kullanicisini .env'den oku --------------------------------
if (-not (Test-Path $EnvPath)) { throw ".env bulunamadi: $EnvPath" }
$satirlar = [System.IO.File]::ReadAllLines($EnvPath, [System.Text.UTF8Encoding]::new($false))
$dbSatir  = $satirlar | Where-Object { $_ -match '^DATABASE_URL=' } | Select-Object -First 1
if (-not $dbSatir) { throw "DATABASE_URL bulunamadi: $EnvPath" }
$url = ($dbSatir -replace '^DATABASE_URL=', '').Trim().Trim('"').Trim("'")
$m = [regex]::Match($url, '^postgres(?:ql)?://([^:/@]+):([^@]*)@([^:/]+)(?::(\d+))?/(.+?)(?:\?.*)?$')
if (-not $m.Success) { throw 'DATABASE_URL ayristirilamadi.' }
$pgUser = $m.Groups[1].Value
$pgHost = $m.Groups[3].Value
$pgPort = if ($m.Groups[4].Success) { $m.Groups[4].Value } else { '5432' }
Info "Uygulama kullanicisi: '$pgUser' (${pgHost}:$pgPort)"

# -- 2) PostgreSQL kurulumunu bul ------------------------------------------
if (-not $DataDir) {
  $DataDir = (Get-ChildItem 'C:\Program Files\PostgreSQL' -Directory -ErrorAction SilentlyContinue |
              ForEach-Object { Join-Path $_.FullName 'data' } |
              Where-Object { Test-Path (Join-Path $_ 'pg_hba.conf') } | Select-Object -First 1)
}
if (-not $DataDir) { throw 'PostgreSQL veri dizini bulunamadi. -DataDir ile ver.' }
$hba = Join-Path $DataDir 'pg_hba.conf'
if (-not (Test-Path $hba)) { throw "pg_hba.conf bulunamadi: $hba" }

if (-not $ServiceName) {
  $ServiceName = (Get-Service -Name 'postgresql*' -ErrorAction SilentlyContinue |
                  Where-Object { $_.Status -eq 'Running' } | Select-Object -First 1 -ExpandProperty Name)
}
if (-not $ServiceName) { throw 'Calisan PostgreSQL servisi bulunamadi. -ServiceName ile ver.' }
Info "Veri dizini: $DataDir"
Info "Servis: $ServiceName"

$psql = (Get-ChildItem 'C:\Program Files\PostgreSQL\*\bin\psql.exe' -ErrorAction SilentlyContinue | Select-Object -First 1)
if (-not $psql) { throw 'psql.exe bulunamadi.' }

# -- 3) YEDEK (geri almanin dayanagi) --------------------------------------
$yedek = "$hba.bak-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
Copy-Item $hba $yedek -Force
Ok "pg_hba yedegi: $yedek"

$orijinal = [System.IO.File]::ReadAllLines($hba, [System.Text.UTF8Encoding]::new($false))
$geriAlindi = $false

try {
  # -- 4) YALNIZ localhost satirlarini 'trust' yap -------------------------
  # Uzak satirlara (varsa) DOKUNULMAZ - pencere yalniz yerel erisimde acilir.
  $yeni = foreach ($l in $orijinal) {
    if ($l -match '^\s*local\s+' -or $l -match '^\s*host\s+.*\s(127\.0\.0\.1/32|::1/128)\s') {
      $l -replace '(scram-sha-256|md5|password)\s*$', 'trust'
    } else { $l }
  }
  $degisen = (Compare-Object $orijinal $yeni | Measure-Object).Count
  if ($degisen -eq 0) { throw 'pg_hba.conf icinde degistirilecek yerel satir bulunamadi - beklenmedik bicim, DOKUNULMADI.' }
  [System.IO.File]::WriteAllLines($hba, [string[]]$yeni, (New-Object System.Text.UTF8Encoding($false)))
  Ok "$degisen satir gecici olarak 'trust' yapildi"

  Info 'PostgreSQL yeniden baslatiliyor (trust uygulansin)'
  Restart-Service $ServiceName -Force
  Start-Sleep -Seconds 5

  # -- 5) TEK IS: CREATEDB yetkisi ---------------------------------------
  $env:PGPASSWORD = ''
  Info "ALTER ROLE $pgUser CREATEDB"
  & $psql.FullName -U postgres -h $pgHost -p $pgPort -d postgres -v ON_ERROR_STOP=1 `
    -c "ALTER ROLE $pgUser CREATEDB;" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "ALTER ROLE basarisiz (exit $LASTEXITCODE)." }
  Ok "'$pgUser' artik veritabani olusturabilir"
}
finally {
  # -- 6) GERI AL - HER DURUMDA -------------------------------------------
  # Buranin `finally` icinde olmasi bu script'in tum amaci: hata, Ctrl+C ya da
  # psql cokmesi olsa bile uretim veritabani PAROLASIZ BIRAKILMAZ.
  Warn 'pg_hba.conf geri aliniyor...'
  Copy-Item $yedek $hba -Force
  Restart-Service $ServiceName -Force
  Start-Sleep -Seconds 5
  $geriAlindi = $true

  # DOGRULA: trust GERCEKTEN kapandi mi? Parolasiz baglanti BASARISIZ olmali.
  #
  # DIKKAT (2026-08-25'te yasandi): psql basarisiz baglantida stderr'e yazar ve
  # $ErrorActionPreference='Stop' bunu OLUMCUL hataya cevirir. Yani BEKLENEN
  # sonuc (baglanti reddedildi) kirmizi bir NativeCommandError olarak patliyor
  # ve script basari mesajini basmadan oluyordu - islem aslinda BASARILIYDI.
  # Cozum: bu blok icin gecici olarak 'Continue', stderr dosyaya, PGPASSWORD
  # bos yerine gecersiz bir deger (bos olunca psql ETKILESIMLI istem aciyor ve
  # script bir kullaniciyi bekliyordu).
  $eskiEAP = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $env:PGPASSWORD = 'trust-kapali-mi-kontrolu'
  $null = & $psql.FullName -U postgres -h $pgHost -p $pgPort -d postgres `
            -w -c 'SELECT 1' 2>&1
  $kod = $LASTEXITCODE
  $ErrorActionPreference = $eskiEAP
  if ($kod -eq 0) {
    Write-Host ''
    Write-Host 'KRITIK: parolasiz baglanti HALA CALISIYOR - trust kapanmamis!' -ForegroundColor Red
    Write-Host "  Elle geri al:  Copy-Item '$yedek' '$hba' -Force ; Restart-Service $ServiceName" -ForegroundColor Red
  } else {
    Ok 'Dogrulandi: parolasiz baglanti artik REDDEDILIYOR (trust kapali)'
  }
  # Ek kanit: dosyada 'trust' satiri kalmadigini da goster (yalniz sayi).
  $kalanTrust = @(Select-String -Path $hba -Pattern '\btrust\s*$').Count
  if ($kalanTrust -eq 0) { Ok "pg_hba'da 'trust' satiri kalmadi" }
  else { Write-Host "KRITIK: pg_hba'da hala $kalanTrust 'trust' satiri var!" -ForegroundColor Red }
}

# -- 7) Uygulama hala saglikli mi? -----------------------------------------
Info 'Uygulama sagligi kontrol ediliyor'
$saglikli = $false
for ($i = 1; $i -le 12; $i++) {
  try {
    if ((Invoke-WebRequest -UseBasicParsing -TimeoutSec 10 'http://localhost:5173/api/health').StatusCode -eq 200) {
      $saglikli = $true; break
    }
  } catch { Start-Sleep -Seconds 5 }
}
if ($saglikli) { Ok 'Uygulama saglikli (HTTP 200)' }
else { Warn 'Uygulama saglik yoklamasina yanit vermedi - PG yeniden baslatildi, havuz toparlanmasi birkac saniye surebilir. Tekrar dene: curl http://localhost:5173/api/health' }

Write-Host ''
Ok 'Bitti. Simdi staging kurulumunu calistir:'
Write-Host '  powershell -ExecutionPolicy Bypass -File C:\cetpa\deploy\windows\setup-staging.ps1' -ForegroundColor Cyan
