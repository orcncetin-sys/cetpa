# Cetpa — AlmaLinux → Windows Server 2022 Geçiş Runbook'u

**Hedef sunucu:** `213.238.190.124` (Windows Server 2022, Plesk kurulu)
**Mimari:** Native Node (Windows Service, NSSM) + **Plesk+IIS+ARR reverse proxy** (Caddy DEĞİL — bkz. not) + PostgreSQL 15
**Sebep:** Mikro V17 (Windows-native ERP) aynı box'ta çalışacak.

> ⚠️ **Güvenlik:** RDP/admin şifresi bir sohbet kanalında paylaşıldıysa **yanmış say — bu geçiş bitince değiştir.** Claude sunucuya giremez / şifre giremez / OS ayarı değiştiremez; aşağıdaki sunucu adımlarını **sen** çalıştırırsın, Claude çıktıyı doğrular.

> **Not (mimari değişikliği):** İlk planda Caddy ile 80/443'ü tamamen devralmak vardı. Ama bu box'ta **cetpa.com.tr (kök alan) ve mail zaten Plesk/IIS üzerinden canlı** — Caddy'ye 80/443 verirsek bunları düşürürüz. Bunun yerine: `app.cetpa.com.tr` **Plesk içinde yeni bir subdomain** olarak açılır (kendi Let's Encrypt sertifikası Plesk tarafından yönetilir), IIS bu subdomain için **ARR + URL Rewrite** ile Node uygulamasına (`localhost:5173`) reverse-proxy yapar. Kök site ve mail hiç dokunulmaz, IIS hiç durdurulmaz.

## Geçiş stratejisi — kesintisiz (blue-green)

DNS hâlâ **eski** AlmaLinux box'a bakıyor → eski sistem canlı, kullanıcılar etkilenmez.
Sıra: **yeni box'ı tam kur → test et → EN SON DNS'i çevir.** DNS çevrilmeden Let's Encrypt sertifikası alınamaz (bu yüzden en sona bırakılır).

```
[1] setup.ps1  → Node, NSSM, OpenSSH, PostgreSQL kur (Caddy YOK)
[2] Repo + .env + build + servis (henüz başlatma)
[3] Veritabanı: eski box'tan taşı
[4] Yerel test (port 5173 üzerinden, DNS/proxy'siz)
[5] Plesk'te app.cetpa.com.tr subdomain'i oluştur
[6] setup-iis-proxy.ps1 → ARR/URL Rewrite kur, web.config yerleştir
[7] DNS'i 213.238.190.124'e çevir  ← kesme anı
[8] Plesk'te app.cetpa.com.tr için Let's Encrypt aç → HTTPS canlı
[9] CI/CD'yi Windows'a çevir (ci.yml swap)
[10] Doğrula → eski box'ı emekliye ayır
```

**Durum (bu satırı güncel tut):** [1] ✅ tamamlandı (Node, NSSM, OpenSSH, PostgreSQL 15.18 kuruldu, `cetpa` servisi oluşturuldu — henüz başlamadı). Sırada [2].

---

## [1] Sunucu bootstrap — ✅ TAMAMLANDI

```powershell
cd C:\cetpa
git pull origin main
powershell -ExecutionPolicy Bypass -File .\deploy\windows\setup.ps1
```
Kurulanlar: Node LTS, git, nssm, OpenSSH Server (+firewall), PostgreSQL 15 (yoktu, sıfırdan kuruldu — **veri taşıma zorunlu**, adım [3]), `cetpa` Windows servisi (oluşturuldu, henüz başlatılmadı).

> `vcredist140` bir reboot istiyor (exit 3010) — **acil değil**, iş bitince bir bakım penceresinde reboot at.

---

## [2] Uygulama + .env + build

```powershell
cd C:\cetpa
git pull origin main
npm ci --legacy-peer-deps
```

### 2c. .env taşı
Eski box'taki `/opt/cetpa/.env` içeriğini **birebir** `C:\cetpa\.env` olarak oluştur (dosya olarak kopyala — sohbete yapıştırma, secret içeriyor). Sadece şu satırları Windows'a göre güncelle:
- `DATABASE_URL=postgresql://cetpa:<PAROLA>@localhost:5432/cetpa` (Unix socket değil, TCP localhost)
- `PORT=5173`  · `APP_URL=https://app.cetpa.com.tr`

```powershell
npm run build   # vite build -> dist/
```

---

## [3] Veritabanı taşıma (PostgreSQL yeni kuruldu, BOŞ — taşıma zorunlu)

**Eski box'ta (AlmaLinux, hâlâ canlı)** — veriyi dök:
```bash
pg_dump -Fc -h localhost -U cetpa cetpa > /root/cetpa_$(date +%F).dump
# Yeni box'a kopyala (scp / RDP dosya paylaşımı):
```

**Yeni box'ta** — db/kullanıcı oluştur + geri yükle:
```powershell
& "C:\Program Files\PostgreSQL\15\bin\psql.exe" -U postgres -c "CREATE USER cetpa WITH PASSWORD '<GUCLU_PAROLA>';"
& "C:\Program Files\PostgreSQL\15\bin\psql.exe" -U postgres -c "CREATE DATABASE cetpa OWNER cetpa;"
& "C:\Program Files\PostgreSQL\15\bin\pg_restore.exe" -h localhost -U cetpa -d cetpa --no-owner "C:\cetpa_YYYY-MM-DD.dump"
```
> Bu adımdaki `<GUCLU_PAROLA>`, `.env`'deki `DATABASE_URL`'de kullanılan parolayla **aynı** olmalı. Ayrıca kurulumda geçici verilen `postgres` süper-kullanıcı parolasını da (`postgres/postgres`) burada güçlü bir parolayla değiştir:
```powershell
& "C:\Program Files\PostgreSQL\15\bin\psql.exe" -U postgres -c "ALTER USER postgres WITH PASSWORD '<BASKA_GUCLU_PAROLA>';"
```

---

## [4] Yerel test (port 5173, proxy'siz)

```powershell
Start-Service cetpa    # ilk kez başlatma; sonrasında güncelleme icin: Restart-Service cetpa
Start-Sleep 5
curl.exe -s http://localhost:5173/api/health   # {"status":"ok","postgres":true,...} bekleniyor
Get-Content C:\cetpa\logs\service-err.log -Tail 30 -ErrorAction SilentlyContinue   # hata varsa burada
```

---

## [5] Plesk: app.cetpa.com.tr subdomain'i oluştur

Plesk panelinde:
1. **Websites & Domains** → `cetpa.com.tr` → **Add Subdomain**
2. İsim: `app` → tam alan adı `app.cetpa.com.tr` olacak
3. **Node.js Toolkit'i BU subdomain için AÇMA** — uygulamayı zaten `cetpa` Windows servisi (NSSM, port 5173) çalıştırıyor; Plesk'in kendi Node.js yöneticisini de açarsak aynı uygulamanın **iki kopyası** çakışır.
4. Oluşan subdomain'in **Hosting Settings**'inden **Document root** yolunu not al (genelde `C:\inetpub\vhosts\cetpa.com.tr\app.cetpa.com.tr\httpdocs`) — [6]'da lazım.

---

## [6] IIS reverse proxy kurulumu (ARR + URL Rewrite)

```powershell
cd C:\cetpa
git pull origin main
powershell -ExecutionPolicy Bypass -File .\deploy\windows\setup-iis-proxy.ps1
```
Script `C:\inetpub\vhosts` altında `app.cetpa.com.tr\httpdocs` klasörünü **otomatik bulmayı** dener; bulamazsa `-SiteDocRoot "<[5]'te not aldığın tam yol>"` ile tekrar çalıştır.

Yapılanlar: `iis-arr` (ARR+URL Rewrite) kurulur, ARR proxy özelliği sunucu genelinde açılır (yalnız eklenir, mevcut siteleri etkilemez), `deploy/windows/web.config` (Node'a reverse-proxy kuralı + SSE için `responseBufferLimit=0`) subdomain'in `httpdocs` köküne kopyalanır.

---

## [7] DNS cutover  ← kesme anı

DNS panelinde `app.cetpa.com.tr` **A kaydını** `213.238.190.124`'e çevir. `nslookup app.cetpa.com.tr` yeni IP'yi gösterene kadar bekle.

## [8] Let's Encrypt (Plesk)

Plesk → `app.cetpa.com.tr` → **SSL/TLS Certificates** → **Let's Encrypt ekle** (DNS yeni IP'ye baktığı için doğrulama geçer). Sertifika alınınca:
```powershell
curl.exe -s -o NUL -w "%{http_code}`n" https://app.cetpa.com.tr/api/health   # 200 bekleniyor
```

## [9] CI/CD → Windows

Cutover doğrulandıktan sonra:
1. GitHub repo **Secrets**: `VDS_HOST=213.238.190.124`, `VDS_USER=administrator`, `VDS_SSH_KEY`= yeni box'ta oluşturduğun deploy anahtarının **private** kısmı. Public kısmı yeni box'ta `C:\ProgramData\ssh\administrators_authorized_keys`'e ekle.
2. `deploy/windows/ci-windows.yml` içeriğini `.github/workflows/ci.yml` üzerine al, commit + push.
3. Push artık Windows'a SSH ile `deploy.ps1` çalıştırır (git reset --hard → build → `Restart-Service cetpa` → health).

## [10] Doğrula & emekliye ayır

- `https://app.cetpa.com.tr` tarayıcıda sertifika uyarısı olmadan açılıyor mu? `https://cetpa.com.tr` (kök) ve mail hâlâ çalışıyor mu (regresyon kontrolü)?
- Login, PG'ye bağlı veri, **SSE canlı senkron** (ARR responseBufferLimit fix'i test et — bir sekmede değişiklik yap, başka sekmede anlık görünüyor mu?), Mikro V17 entegrasyonu çalışıyor mu?
- 24-48 saat sorunsuzsa eski AlmaLinux box'ı kapat. **Admin şifresini değiştir** (bu geçişte bir kanalda paylaşıldı).

---

### İş bölümü özeti
| Claude (repo/kod) | Sen (sunucu) |
|---|---|
| setup.ps1, deploy.ps1, setup-iis-proxy.ps1, web.config, ci-windows.yml | PowerShell'de scriptleri çalıştırma |
| CI swap (geçiş anında) | RDP login, .env, Plesk paneli (subdomain+LE), DNS, pg_dump/restore |
| Her adımın çıktısını doğrulama | Secret girişi, parola belirleme |
