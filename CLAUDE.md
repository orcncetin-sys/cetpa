# Cetpa Sales & Logistics — Claude çalışma kuralları

## Deploy = production
`git push origin main` doğrudan canlıya deploy tetikler (GitHub Actions → Windows Server → app.cetpa.com.tr). Bu yüzden iki kapı ZORUNLUDUR:

1. **Push öncesi code review:** Her push'tan önce `/code-review` çalıştır (varsayılan medium). Diff şunlara dokunuyorsa `high`'a yükselt: para matematiği (AccountingModule, banka/tahsilat/kur), tenant izolasyonu (`TENANT_COLLECTIONS`, `companyId`, `requireAuth`), deploy zinciri (`deploy/windows/*.ps1`, `.github/workflows/*`). CONFIRMED bulguları push'tan önce uygula.
2. **deploy-verify skill:** Push öncesi `scripts/verify-deploy.sh pre`, push sonrası `scripts/verify-deploy.sh post` (detay: `.claude/skills/deploy-verify/SKILL.md`). İkisi de geçmeden deploy'u tamam ilan etme.

## Tuzaklar
- `deploy.ps1`'in kendi değişikliği ancak bir SONRAKİ deploy'da etkir (çalışan süreç eskisini tutar).
- `deploy/windows/*.ps1` salt-ASCII olmalı (PowerShell 5.1 + Windows-1252; em-dash/Türkçe karakter parse'ı kırar).
- Yeni koleksiyon eklerken: server.ts `TENANT_COLLECTIONS` + `useDataSync`/`dataStore` listener'ları. Unutulursa çok-kiracılı veri sızıntısı olur.
- Yeşil CI, uygulamanın ayakta olduğunu KANITLAMAZ (health-check adımı kırıkken CI yeşil kaldı) — kanıt verify-deploy `post`.
- `npm run build` server.ts'i derlemez; server değişikliğinin tek lokal kanıtı boot testidir.

## Operasyon Bekçisi
Sunucuda her sabah 08:30'da `runOpsWatchdog()` (server.ts) koşar: offsite yedek tazeliği (db-backups/ + uploads-backups/), Mikro sync tazeliği, stok oranı çöküşü, retry kuyruğu (`syncJobs`), kur tazeliği, bant genişliği self-testi (Cloudflare'den 5MB indir + 1MB yükle; eşik ↓512/↑256 KB/sn — 2026-07-20 sağlayıcı hat çöküşü arıza sınıfı). Sonuçlar: `opsChecks` koleksiyonu (global, TENANT dışı), Admin → süper-admin panelindeki kart, `GET /api/ops/watchdog`. FAIL görürsen önce `detail` alanını oku, kök nedeni düzelt — eşik ayarıyla susturma.
