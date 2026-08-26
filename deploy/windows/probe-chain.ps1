# Cetpa - ARA KATMAN ZINCIRI sondasi (bozuk-JSON ayirt edicisi).
#
# NEDEN VAR (2026-08-24 canli kesintisi): bir rota grubu
# `app.use(express.json(...))`'dan ONCE kaydedilirse o grubun TUM POST
# uclarinda req.body undefined olur - ama uygulama saglikli gorunur ve
# /api/health 200 doner. Yani "HTTP 200" bu ariza sinifini KANITLAMAZ.
#
# AYIRT EDICI (kimlik gerektirmez): korumali bir POST ucuna BOZUK JSON gonder.
#   zincir SAGLAM  -> govde ayristirici once calisir, parse hatasi: 400/500
#   zincir KIRIK   -> istek dogrudan requireAuth'a duser: 401/403
#
# GRUP BASINA sondalanir: her rota grubu KENDI `xRoutes(app, ...)` cagrisiyla
# kaydolur, biri yanlis yerdeyken digerleri dogru olabilir.
#
# NEDEN AYRI DOSYA: bu sonda once CI icinde tek satirlik `ssh -> powershell
# -Command "..."` olarak yazilmisti; bash/ssh/PowerShell uc katmanli kacis
# yuzunden istisna dalinda BOS deger dondu ve bes sondanin besi de
# "beklenmedik yanit" verdi. Betik olarak kacis sorunu tamamen ortadan kalkiyor
# ve sonda elle de calistirilabiliyor.
#
# ASCII-only (PowerShell 5.1 + Windows-1252).

param(
  [int]$Port = 5174,
  [string[]]$Paths = @(
    '/api/mikro/gelen-fatura/kabul',
    '/api/tracking/fedex',
    '/api/ops/watchdog/run',
    '/api/dynamics/export/siparis',
    '/api/superadmin/tenants/test/status',
    '/api/parasut/import/stok',
    '/api/ai/lead-score',
    '/api/shopify/sync',
    '/api/iyzico/payment-link',
    '/api/email/send'
  )
)

$hata = 0
foreach ($yol in $Paths) {
  $url = "http://localhost:$Port$yol"
  $kod = $null
  $not = ''
  try {
    $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 30 -Method POST `
           -ContentType 'application/json' -Body '{bozuk' -Uri $url
    $kod = [int]$r.StatusCode
  } catch {
    # HTTP hata yanitlari burada gelir; Response TASIMAYAN istisnalar da olur
    # (baglanti reddi, zaman asimi, parametre baglama hatasi). Onlari sessizce
    # bos birakmak sondayi ise yaramaz hale getirir - tipini RAPORLA.
    $resp = $null
    try { $resp = $_.Exception.Response } catch { }
    if ($resp -ne $null) {
      $kod = [int]$resp.StatusCode
    } else {
      $not = $_.Exception.GetType().Name + ': ' + $_.Exception.Message
    }
  }

  if ($kod -eq $null) {
    Write-Host "  FAIL $yol -> yanit alinamadi. $not"
    $hata = 1
  } elseif ($kod -eq 400 -or $kod -eq 500) {
    Write-Host "  OK   $yol -> $kod (govde ayristirma zincirde)"
  } elseif ($kod -eq 401 -or $kod -eq 403) {
    Write-Host "  FAIL $yol -> $kod ARA KATMAN ZINCIRI KIRIK: bu grup"
    Write-Host "       express.json'dan ONCE kayitli; TUM POST uclari bozuk."
    $hata = 1
  } elseif ($kod -eq 404) {
    Write-Host "  FAIL $yol -> 404 rota deploy'da YOK (grup hic kaydolmamis)"
    $hata = 1
  } else {
    Write-Host "  FAIL $yol -> beklenmedik yanit: $kod"
    $hata = 1
  }
}
exit $hata
