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
- CI run'ı `gh run watch --exit-status` ile beklenir
- Canlı `/api/health`: `status=ok` + `postgres=true` (artık `docs` tablosundan **gerçek okuma** — `SELECT 1` ping'i değil) + `uptime < 600` (taze restart kanıtı; uptime resetlenmediyse **eski kod çalışıyordur**)
- Bu push'ta eklenen `requireAuth`'lu route'lara auth'suz istek → 401/403 beklenir; **404 = route deploy'a girmemiş**

## Bilinmesi gerekenler

- Varsayılan diff aralığı `origin/main@{1}...origin/main` bu makineden yapılan son push'u kapsar (çok-commit'li push dahil). Farklı aralık gerekirse ikinci argüman: `scripts/verify-deploy.sh post 'abc123..def456'`
- `deploy/windows/deploy.ps1`'in KENDİ değişiklikleri ancak bir SONRAKİ deploy'da etkir (çalışan süreç eski deploy.ps1'i kullanır) — deploy.ps1 değiştiyse doğrulama için ek bir deploy tetikle.
- Bir kontrol FAIL ise: düzelt ve ilgili aşamayı **baştan** çalıştır. Kısmen doğrulanmış deploy raporlama.
- Yeşil CI, uygulamanın ayakta olduğunu kanıtlamaz (health-check adımı geçmişte kırıkken CI yeşil kalmıştır) — kanıt bu skill'in `post` aşamasıdır.
