#requires -RunAsAdministrator
# Cetpa - uygulama veritabani parolasini GUVENLE dondur.
#
# NEDEN VAR (2026-08-24): bu parola IKINCI kez bir sohbet kanalinda gorundu
# (ilki 2026-07-01, RUNBOOK.md'de kayitli). Dondurmek uc adimli ve SIRASI
# onemli: once DB'de degistir, sonra .env'i guncelle, sonra servisi yeniden
# baslat. Elle yapilinca .env adimi unutuluyor ve uygulama eski parolayla
# baglanmaya calisip DUSUYOR - yani guvenlik islemi kesintiye donusuyor.
#
# Bu script:
#   - mevcut parolayi .env'den KENDI okur (kimse elle yazmaz, kabuk gecmisine
#     ve loglara duz parola dusmez)
#   - yeni parolayi gizli sorar (Read-Host -AsSecureString)
#   - .env'i degistirmeden ONCE yedekler
#   - saglik yoklamasi basarisiz olursa .env'i GERI ALIR ve servisi tekrar
#     baslatir (uygulama parola donusu yuzunden ayakta kalmayan bir sisteme
#     donmesin)
#
# NOT: super kullanici GEREKMEZ. PostgreSQL'de bir rol kendi parolasini
# degistirebilir - bu yuzden 'postgres' parolasi bilinmese de calisir.
#
# ASCII-only (PowerShell 5.1 + Windows-1252).

param(
  [string]$EnvPath     = 'C:\cetpa\.env',
  [string]$ServiceName = 'cetpa',
  [int]   $AppPort     = 5173
)

$ErrorActionPreference = 'Stop'
function Info($m){ Write-Host "==> $m" -ForegroundColor Cyan }
function Ok($m){ Write-Host "    $m" -ForegroundColor Green }
function Warn($m){ Write-Host "    $m" -ForegroundColor Yellow }

if (-not (Test-Path $EnvPath)) { throw ".env bulunamadi: $EnvPath" }

# -- 1) Mevcut baglanti dizesini oku ----------------------------------------
# UTF-8 OKU: PS 5.1'in varsayilani Windows-1252'dir ve UTF-8 Turkce
# karakterleri bozuk okur; sonra ayni bozuk hali geri yazardik.
$satirlar = [System.IO.File]::ReadAllLines($EnvPath, [System.Text.UTF8Encoding]::new($false))
$dbSatir  = $satirlar | Where-Object { $_ -match '^DATABASE_URL=' } | Select-Object -First 1
if (-not $dbSatir) { throw "DATABASE_URL bulunamadi: $EnvPath" }
$url = ($dbSatir -replace '^DATABASE_URL=', '').Trim().Trim('"').Trim("'")

$m = [regex]::Match($url, '^postgres(?:ql)?://([^:/@]+):([^@]*)@([^:/]+)(?::(\d+))?/(.+?)(?:\?.*)?$')
if (-not $m.Success) { throw "DATABASE_URL ayristirilamadi (postgresql://kullanici:parola@host/db bekleniyor)." }
$pgUser = $m.Groups[1].Value
$pgOld  = $m.Groups[2].Value
$pgHost = $m.Groups[3].Value
$pgPort = if ($m.Groups[4].Success) { $m.Groups[4].Value } else { '5432' }
$pgDb   = $m.Groups[5].Value
Info "Kullanici '$pgUser', veritabani '$pgDb' (${pgHost}:$pgPort)"

# -- 2) Yeni parolayi gizli sor ---------------------------------------------
$s1 = Read-Host -Prompt 'Yeni parola' -AsSecureString
$s2 = Read-Host -Prompt 'Yeni parola (tekrar)' -AsSecureString
$p1 = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s1))
$p2 = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s2))
if ($p1 -ne $p2)      { throw 'Parolalar eslesmiyor.' }
if ($p1.Length -lt 12){ throw 'Parola en az 12 karakter olmali.' }
# Tek tirnak SQL literalini, @ ve / ise baglanti dizesini bozar - bastan reddet.
if ($p1 -match "['@/\\ ]") { throw "Parola su karakterleri ICERMEMELI: tek tirnak, @, /, ters bolu, bosluk." }

# -- 3) Veritabaninda degistir ----------------------------------------------
$psql = (Get-ChildItem 'C:\Program Files\PostgreSQL\*\bin\psql.exe' -ErrorAction SilentlyContinue | Select-Object -First 1)
if (-not $psql) { throw 'psql.exe bulunamadi.' }

$env:PGPASSWORD = $pgOld
Info "Veritabaninda parola degistiriliyor"
& $psql.FullName -U $pgUser -h $pgHost -p $pgPort -d $pgDb -v ON_ERROR_STOP=1 `
  -c "ALTER USER $pgUser WITH PASSWORD '$p1';" | Out-Null
if ($LASTEXITCODE -ne 0) { throw "ALTER USER basarisiz (exit $LASTEXITCODE). Eski parola hala gecerli, .env'e DOKUNULMADI." }
Ok 'Veritabani parolasi degisti'

# -- 4) .env guncelle (once yedekle) ----------------------------------------
$yedek = "$EnvPath.bak-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
Copy-Item $EnvPath $yedek -Force
Ok "'.env' yedegi: $yedek"

$yeniUrl = "postgresql://${pgUser}:${p1}@${pgHost}:${pgPort}/$pgDb"
$yeniSatirlar = $satirlar | ForEach-Object {
  if ($_ -match '^DATABASE_URL=') { "DATABASE_URL=$yeniUrl" } else { $_ }
}
# .env UTF-8 (BOM'suz) YAZILIR - ASCII DEGIL (2026-08-24 hatasi).
# `Set-Content -Encoding ASCII` ASCII disi her karakteri '?' yapar. .env icinde
# Turkce metin bulunan degerler (sirket adi, e-posta sablonu, adres) sessizce
# BOZULUR - dosya "calisir" gorunur ama degerler kalicidir sekilde kaybolur.
# PowerShell 5.1'in `-Encoding UTF8`'i BOM YAZAR; BOM ilk satirin anahtarina
# yapisip `KEY` yerine `\ufeffKEY` yapar ve o degisken okunamaz. Bu yuzden
# .NET ile BOM'suz UTF-8 yaziyoruz.
[System.IO.File]::WriteAllLines($EnvPath, [string[]]$yeniSatirlar, (New-Object System.Text.UTF8Encoding($false)))
Ok '.env guncellendi'

# DOGRULA: DATABASE_URL DISINDAKI HER SATIR AYNEN KALMALI.
# Bu kontrol, kodlama hatasiyla veri kaybina karsi son savunma. Bir kez
# `-Encoding ASCII` ile yazip .env'deki Turkce degerleri '?' yapmistik; dosya
# "calisir" gorunuyordu ama degerler kalici olarak kaybolmustu. Artik yazdiktan
# sonra geri okuyup karsilastiriyoruz; sapma varsa YEDEKTEN GERI ALIP duruyoruz.
$geriOkunan = [System.IO.File]::ReadAllLines($EnvPath, [System.Text.UTF8Encoding]::new($false))
$oncekiDigerleri = @($satirlar     | Where-Object { $_ -notmatch '^DATABASE_URL=' })
$sonrakiDigerleri = @($geriOkunan  | Where-Object { $_ -notmatch '^DATABASE_URL=' })
$bozuk = $false
if ($oncekiDigerleri.Count -ne $sonrakiDigerleri.Count) { $bozuk = $true }
else {
  for ($i = 0; $i -lt $oncekiDigerleri.Count; $i++) {
    if ($oncekiDigerleri[$i] -cne $sonrakiDigerleri[$i]) { $bozuk = $true; break }
  }
}
if ($bozuk) {
  Copy-Item $yedek $EnvPath -Force
  throw ".env yazimi diger satirlari DEGISTIRDI (kodlama sorunu) - yedekten geri alindi: $yedek. " +
        "VERITABANI PAROLASI DEGISTI; .env'deki DATABASE_URL'i yeni parolayla elle guncelle."
}
Ok '.env dogrulandi (DATABASE_URL disindaki satirlar aynen korundu)'


# -- 5) Servisi yeniden baslat ve DOGRULA -----------------------------------
Info "Servis yeniden baslatiliyor: $ServiceName"
Restart-Service $ServiceName -Force
Start-Sleep -Seconds 8

$saglikli = $false
for ($i = 1; $i -le 10; $i++) {
  try {
    $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 10 "http://localhost:$AppPort/api/health"
    if ($r.StatusCode -eq 200) { $saglikli = $true; break }
  } catch { Start-Sleep -Seconds 3 }
}

if ($saglikli) {
  Ok "Saglik yoklamasi GECTI - parola donusu tamam."
  Warn "Eski parola artik gecersiz. Yedek .env dosyasinda ESKI parola duruyor:"
  Warn "  $yedek"
  Warn "Dogruladiktan sonra o yedegi SIL."
} else {
  # GERI AL: uygulamayi parola donusu yuzunden ayakta olmayan bir sisteme birakma.
  Warn 'Saglik yoklamasi BASARISIZ - .env geri aliniyor.'
  Copy-Item $yedek $EnvPath -Force
  Restart-Service $ServiceName -Force
  Warn 'DIKKAT: .env eski haline dondu ama VERITABANI PAROLASI DEGISTI.'
  Warn "Uygulamanin tekrar baglanabilmesi icin .env'deki DATABASE_URL'i YENI parolayla elle guncelle."
  throw 'Parola donusu sonrasi uygulama saglikli yanit vermedi - yukaridaki nota bak.'
}
