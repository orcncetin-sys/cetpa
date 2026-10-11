---
name: deploy-verify
description: Cetpa deploy doğrulama — her `git push origin main` ÖNCESİ ve SONRASI çalıştır. Push = production deploy; edit başarılı diye deploy'u tamam ilan etme.
---

# Deploy doğrulama (Cetpa)

Her `git push origin main` bir **production deploy**'dur (GitHub Actions → SSH → Windows Server → app.cetpa.com.tr). Bir deploy'u ancak aşağıdaki İKİ AŞAMA da geçerse "tamam" ilan et.

## 1. Push ÖNCESİ

```bash
scripts/verify-deploy.sh pre
```

Kontroller:
- `tsc --noEmit` temiz
- `.ps1` dosyası değiştiyse salt-ASCII (PowerShell 5.1 + Windows-1252 tuzağı)
- `server.ts` değiştiyse lokal boot testi (`/api/health` 200) — `npm run build` server'ı derlemez, tek boot kanıtı budur

Ayrıca push öncesi `/code-review` kapısı CLAUDE.md'de tanımlı — önce onu uygula.

## 2. Push SONRASI

```bash
scripts/verify-deploy.sh post
```

Kontroller:
- Gönderilen commit'in **kendi** yayın işi (`ci.yml`, main'e push, uzak main'in ucu) `gh run watch --exit-status` ile beklenir. Depodaki en son işe bakılmaz: aynı gönderimde Dependabot ve CodeQL işleri de koşar (2026-10-08'de Dependabot işi «geçti» diye yazılmıştı). Yalnız bu adım: `scripts/verify-deploy.sh ci`
- Canlı `/api/health`: `status=ok` + `postgres=true` (artık `docs` tablosundan **gerçek okuma** — `SELECT 1` ping'i değil) + `uptime ≤ (şimdi − yayın adımının başlangıcı) + 60` (taze restart kanıtı; uptime resetlenmediyse **eski kod çalışıyordur**) Yayın adımının `startedAt`i `ci_denetimi`nden gelir; okunamazsa 600 sn kuralına düşer (2026-10-09: `gh run watch` hazırlık yayınını da beklediğinden sabit 600 sahte alarm vermişti).
- Bu push'ta eklenen `requireAuth`'lu route'lara auth'suz istek → 401/403 beklenir; **404 = route deploy'a girmemiş**
- Mağaza (www.cetpa.com.tr) uçları — hiçbiri kayıt yazmaz, oturum açmaz, e-posta göndermez:
  - dilim 1: ön uçuş 204 + köken başlığı, kökensiz POST 403, bozuk JSON 400, talep yolu 400 (**503 = uç talepleri düşürüyor**)
  - dilim 2a (2026-10-10): takip ucu var olmayan talep no ile `404 bulunamadi` (**`503 hazir-degil` = canlıda hâlâ dilim 1**); site paneli belirteçsiz 401 (liste, verilmemiş kodla oturum, kalem teslim, etiket basıldı — **`503 panel-yapilandirilmamis` = `MAGAZA_PANEL_DONUS` / oturum sırrı**, 404 = alt zincir bağlı değil); panel ön uçuşu 204 + GET + Authorization, dış zincirde Authorization yok; ERP kökenindeki dört mağaza ucu bozuk JSON'a 400/500 **ve** geçerli `{}`'ye kimliksiz 401 (404 = rota kayıtlı değil — bozuk JSON sondası bunu göremez); istemci derlemesinde `/magaza-panel-baglan` metni
  - dilim 2b (2026-10-11): üç yeni ERP ucu (`POST /api/magaza-talepleri`, `…/:id/icerik`, `…/:id/sil`) bozuk JSON'a 400/500 **ve** geçerli `{}`'ye kimliksiz 401 (**404 = canlıda hâlâ dilim 2a**); `…/bildirim-gonder?tur=revize` kimliksiz 401 (400 = sorgu kimlik kapısından önce ayrıştırılıyor); site paneli silme ucu belirteçsiz 401. Takip ucunun `404 silindi` yanıtı sonda ile ÜRETİLEMEZ (canlıda yapay silinmiş kayıt açılmaz) — ilk gerçek silmeden sonra elle doğrulanır; ayrıntı ve bekçinin yeni parçaları (revize bildirimi sayımı, «silinmiş: N») `deploy/windows/RUNBOOK.md` [14]
- Dilim 2a yayını **kesintilidir**: `package-lock.json` değiştiği için `deploy.ps1` hizmeti durdurup `npm ci` koşar (1-2 dk 502) — mesai dışında yayınla; ayrıntı `deploy/windows/RUNBOOK.md` [13]

## Bilinmesi gerekenler

- Varsayılan diff aralığı `origin/main@{1}...origin/main` bu makineden yapılan son push'u kapsar (çok-commit'li push dahil). Farklı aralık gerekirse ikinci argüman: `scripts/verify-deploy.sh post 'abc123..def456'`
- `deploy/windows/deploy.ps1`'in KENDİ değişiklikleri ancak bir SONRAKİ deploy'da etkir (çalışan süreç eski deploy.ps1'i kullanır) — deploy.ps1 değiştiyse doğrulama için ek bir deploy tetikle.
- Bir kontrol FAIL ise: düzelt ve ilgili aşamayı **baştan** çalıştır. Kısmen doğrulanmış deploy raporlama.
- Yeşil CI, uygulamanın ayakta olduğunu kanıtlamaz (health-check adımı geçmişte kırıkken CI yeşil kalmıştır) — kanıt bu skill'in `post` aşamasıdır.
