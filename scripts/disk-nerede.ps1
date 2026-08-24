# disk-nerede.ps1 - Diskteki alani NE tutuyor? (salt-okunur, hicbir sey silmez)
#
# 2026-08-24: uculuncu disk kesintisi. Her seferinde kok nedeni TAHMIN ettik.
# Bu script olcer. Sunucuda PowerShell'de calistir:
#     powershell -ExecutionPolicy Bypass -File C:\cetpa\app\scripts\disk-nerede.ps1
#
# ASCII-only (CLAUDE.md: deploy/windows PowerShell 5.1 + Windows-1252).

$ErrorActionPreference = 'Continue'

Write-Host ''
Write-Host '=== 1) SURUCU DURUMU ===' -ForegroundColor Cyan
Get-PSDrive -PSProvider FileSystem | Where-Object { $_.Used -ne $null } |
  Select-Object Name,
    @{n='Used_GB'; e={[math]::Round($_.Used/1GB,1)}},
    @{n='Free_GB'; e={[math]::Round($_.Free/1GB,1)}} | Format-Table -AutoSize

Write-Host '=== 2) C:\ ALTINDAKI EN BUYUK 15 KLASOR ===' -ForegroundColor Cyan
Get-ChildItem 'C:\' -Directory -Force -ErrorAction SilentlyContinue | ForEach-Object {
  $b = (Get-ChildItem $_.FullName -Recurse -File -Force -ErrorAction SilentlyContinue |
        Measure-Object -Property Length -Sum).Sum
  [pscustomobject]@{ Klasor = $_.FullName; GB = [math]::Round(($b/1GB),2) }
} | Sort-Object GB -Descending | Select-Object -First 15 | Format-Table -AutoSize

Write-Host '=== 3) CETPA LOG KLASORU (dondurulmus loglar birikiyor mu?) ===' -ForegroundColor Cyan
if (Test-Path 'C:\cetpa\logs') {
  $lg = Get-ChildItem 'C:\cetpa\logs' -File -Force -ErrorAction SilentlyContinue
  $sum = ($lg | Measure-Object -Property Length -Sum).Sum
  Write-Host ("  dosya sayisi: {0}   toplam: {1} GB" -f $lg.Count, [math]::Round(($sum/1GB),2))
  $lg | Sort-Object Length -Descending | Select-Object -First 10 `
      Name, @{n='MB'; e={[math]::Round($_.Length/1MB,1)}}, LastWriteTime | Format-Table -AutoSize
} else { Write-Host '  C:\cetpa\logs yok' }

Write-Host '=== 4) PAGEFILE (yeniden baslatinca bosalan alanin bir numarali supheli) ===' -ForegroundColor Cyan
Get-CimInstance Win32_PageFileUsage -ErrorAction SilentlyContinue |
  Select-Object Name, @{n='Alloc_GB'; e={[math]::Round($_.AllocatedBaseSize/1024,2)}},
                      @{n='Peak_GB';  e={[math]::Round($_.PeakUsage/1024,2)}} | Format-Table -AutoSize

Write-Host '=== 5) POSTGRESQL VERI DIZINI + EN BUYUK TABLOLAR ===' -ForegroundColor Cyan
$pgData = Get-ChildItem 'C:\Program Files\PostgreSQL' -Directory -ErrorAction SilentlyContinue |
          ForEach-Object { Join-Path $_.FullName 'data' } | Where-Object { Test-Path $_ }
foreach ($d in $pgData) {
  $b = (Get-ChildItem $d -Recurse -File -Force -ErrorAction SilentlyContinue |
        Measure-Object -Property Length -Sum).Sum
  Write-Host ("  {0} -> {1} GB" -f $d, [math]::Round(($b/1GB),2))
  $wal = Join-Path $d 'pg_wal'
  if (Test-Path $wal) {
    $wb = (Get-ChildItem $wal -File -Force -ErrorAction SilentlyContinue |
           Measure-Object -Property Length -Sum).Sum
    Write-Host ("    pg_wal -> {0} GB  (WAL birikmesi = replikasyon slotu/arsiv sorunu)" -f [math]::Round(($wb/1GB),2))
  }
}
Write-Host '  -- en buyuk 15 tablo (psql varsa) --'
$psql = Get-ChildItem 'C:\Program Files\PostgreSQL\*\bin\psql.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
if ($psql -and $env:DATABASE_URL) {
  & $psql.FullName $env:DATABASE_URL -c "SELECT relname, pg_size_pretty(pg_total_relation_size(c.oid)) AS boyut FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' ORDER BY pg_total_relation_size(c.oid) DESC LIMIT 15;"
} else { Write-Host '    psql veya DATABASE_URL yok - atlandi' }

Write-Host '=== 6) WINDOWS TEMP / CRASH DUMP / WINSXS ===' -ForegroundColor Cyan
foreach ($t in @('C:\Windows\Temp', $env:TEMP, 'C:\Windows\Minidump', 'C:\Windows\MEMORY.DMP', 'C:\cetpa\backups')) {
  if ($t -and (Test-Path $t)) {
    $b = (Get-ChildItem $t -Recurse -File -Force -ErrorAction SilentlyContinue |
          Measure-Object -Property Length -Sum).Sum
    Write-Host ("  {0} -> {1} GB" -f $t, [math]::Round(($b/1GB),2))
  }
}

Write-Host ''
Write-Host 'Bitti. En buyuk kalemi bildir - bir dahaki sefere tahmin etmeyelim.' -ForegroundColor Green
