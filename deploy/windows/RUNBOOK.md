# Cetpa — AlmaLinux → Windows Server 2022 Geçiş Runbook'u

**Hedef sunucu:** `213.238.190.124` (Windows Server 2022)
**Mimari:** Native Node (Windows Service, NSSM) + Caddy (otomatik Let's Encrypt) + PostgreSQL 15
**Sebep:** Mikro V17 (Windows-native ERP) aynı box'ta çalışacak.

> ⚠️ **Güvenlik:** RDP/admin şifresi bir sohbet kanalında paylaşıldıysa **yanmış say — bu geçiş bitince değiştir.** Claude sunucuya giremez / şifre giremez / OS ayarı değiştiremez; aşağıdaki sunucu adımlarını **sen** çalıştırırsın, Claude çıktıyı doğrular.

## Geçiş stratejisi — kesintisiz (blue-green)

DNS hâlâ **eski** AlmaLinux box'a bakıyor → eski sistem canlı, kullanıcılar etkilenmez.
Bu yüzden sıra: **yeni box'ı tam kur → test et → EN SON DNS'i çevir.** DNS çevrilmeden Let's Encrypt sertifikası alınamaz (bu yüzden en sona bırakılır).

```
[1] Ön koşullar (Plesk/IIS port çakışması, secret'lar)
[2] setup.ps1  → Node, Caddy, NSSM, OpenSSH, (gerekirse) PostgreSQL kur
[3] Repo + .env + build + servis
[4] Veritabanı: eski box'tan taşı (durum belirsiz → önce tespit)
[5] Yerel test (DNS'siz, IP/localhost üzerinden)
[6] DNS'i 213.238.190.124'e çevir  ← kesme anı
[7] Caddy LE sertifikasını otomatik alır → HTTPS canlı
[8] CI/CD'yi Windows'a çevir (ci.yml swap)
[9] Doğrula → eski box'ı emekliye ayır
```

---

## [1] Ön koşullar

### 1a. Plesk / IIS port çakışması (ÖNEMLİ)
Yeni box'a **Plesk kurulmuş.** Plesk Windows'ta IIS ile **80/443**'ü tutar; Caddy o portlara bağlanamaz.
Caddy yolunu seçtik, o yüzden bu portları serbest bırak:

```powershell
# IIS'i durdur ve otomatik başlamasını kapat (Plesk web sunucusu)
Stop-Service W3SVC -Force -ErrorAction SilentlyContinue
Set-Service  W3SVC -StartupType Disabled
# 80/443'ü kim tutuyor kontrol:
Get-NetTCPConnection -LocalPort 80,443 -State Listen | Select-Object LocalPort,OwningProcess
Get-Process -Id (Get-NetTCPConnection -LocalPort 443 -State Listen).OwningProcess -ErrorAction SilentlyContinue
```
> Alternatif: Plesk'i tamamen kullanmak istersen Caddy yerine Plesk'in Node.js + Let's Encrypt eklentisiyle de host edilebilir — ama seçim Caddy olduğu için IIS/Plesk web tarafını devre dışı bırakıyoruz. PostgreSQL/Mikro tarafına dokunma.

### 1b. Secret'lar
Uygulama `.env` dosyasını okur (dotenv). Eski box'taki `.env`'i birebir taşıyacağız (aşağıda [3c]). İçindeki kritik anahtarlar: `DATABASE_URL`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`, `GEMINI_API_KEY`, `SESSION_TOKEN_SECRET`, `MFA_COOKIE_SECRET`, `MIKRO_*`, kargo/pazaryeri anahtarları, `APP_URL=https://app.cetpa.com.tr`.

---

## [2] Sunucu bootstrap

Yeni box'ta **elevated (Administrator) PowerShell** aç, repoyu çek ve `setup.ps1`'i çalıştır:

```powershell
# Git yoksa önce Chocolatey+git setup.ps1 içinde geliyor; ama repoyu çekmek için git lazım.
# En kolayı: setup.ps1'i tek satırla indir (repo public değilse önce git kur):
mkdir C:\cetpa -Force; cd C:\cetpa
# git kuruluysa:
git clone https://github.com/orcncetin-sys/cetpa.git .
# Kurulumu çalıştır (idempotent — tekrar çalıştırılabilir):
powershell -ExecutionPolicy Bypass -File .\deploy\windows\setup.ps1
```

`setup.ps1` şunları yapar: Chocolatey → Node LTS, git, nssm, caddy → OpenSSH Server (CI için) + firewall → PostgreSQL **tespit**, yoksa kur → `cetpa` Windows servisi (henüz başlatmaz).

---

## [3] Uygulama + .env + build

```powershell
cd C:\cetpa
git pull origin main
npm ci --legacy-peer-deps
```

### 3c. .env taşı
Eski box'taki `/opt/cetpa/.env` içeriğini **birebir** `C:\cetpa\.env` olarak oluştur. Sadece şu iki satırı Windows'a göre güncelle:
- `DATABASE_URL=postgresql://cetpa:<PAROLA>@localhost:5432/cetpa`  (Unix socket değil, TCP localhost)
- `PORT=5173`  · `APP_URL=https://app.cetpa.com.tr`

```powershell
npm run build   # vite build → dist/
```

---

## [4] Veritabanı taşıma (durum belirsiz → önce tespit)

```powershell
# PG kurulu ve çalışıyor mu?
Get-Service | Where-Object Name -like 'postgresql*'
& "C:\Program Files\PostgreSQL\15\bin\pg_isready.exe" -h localhost -p 5432
```

**Eski box'ta (AlmaLinux, hâlâ canlı)** — veriyi dök:
```bash
# Eski sunucuda DATABASE_URL'deki db adı/kullanıcıyla:
pg_dump -Fc -h localhost -U cetpa cetpa > /root/cetpa_$(date +%F).dump
# Yeni box'a kopyala (scp / RDP paylaşımı / geçici link):
```

**Yeni box'ta** — geri yükle:
```powershell
# DB + kullanıcı yoksa oluştur:
& "C:\Program Files\PostgreSQL\15\bin\psql.exe" -U postgres -c "CREATE USER cetpa WITH PASSWORD '<PAROLA>';"
& "C:\Program Files\PostgreSQL\15\bin\psql.exe" -U postgres -c "CREATE DATABASE cetpa OWNER cetpa;"
& "C:\Program Files\PostgreSQL\15\bin\pg_restore.exe" -h localhost -U cetpa -d cetpa --no-owner "C:\cetpa_YYYY-MM-DD.dump"
```
> Uygulama ilk açılışta eksik tabloları (`docs`, `mfa_secrets`) zaten `CREATE TABLE IF NOT EXISTS` ile kurar — ama **mevcut veriyi** yalnız restore taşır. Boş DB'yle başlarsan geçmiş kaybolur.

---

## [5] Yerel test (DNS'siz)

```powershell
nssm start cetpa            # veya: Restart-Service cetpa
Start-Sleep 5
curl.exe -s http://localhost:5173/api/health   # {"status":"ok","postgres":true,...} bekleniyor
```
Geliştirici makinenden domain'i kandırarak da test edebilirsin (hosts dosyası):
`C:\Windows\System32\drivers\etc\hosts` → `213.238.190.124  app.cetpa.com.tr` (test sonrası geri al). Not: LE sertifikası olmadan HTTPS henüz self-signed olur; `curl -k` ile bak.

---

## [6] DNS cutover  ← kesme anı

DNS panelinde `app.cetpa.com.tr` **A kaydını** `213.238.190.124`'e çevir. TTL düşükse birkaç dk sürer.
`nslookup app.cetpa.com.tr` yeni IP'yi gösterene kadar bekle.

## [7] Caddy + Let's Encrypt

`deploy/windows/Caddyfile`'ı Caddy'nin config yoluna koy ve servisi başlat. DNS yeni IP'ye baktığı an Caddy sertifikayı **otomatik** alır (port 80 açık olmalı — [1a]).
```powershell
Copy-Item C:\cetpa\deploy\windows\Caddyfile "C:\ProgramData\Caddy\Caddyfile" -Force
Restart-Service caddy
Get-Content "C:\ProgramData\Caddy\logs\*" -Tail 30   # sertifika alındı mı
curl.exe -s -o NUL -w "%{http_code}`n" https://app.cetpa.com.tr/api/health   # 200 (artık -k'siz)
```

## [8] CI/CD → Windows

Cutover doğrulandıktan sonra:
1. GitHub repo **Secrets**: `VDS_HOST=213.238.190.124`, `VDS_USER=administrator`, `VDS_SSH_KEY`= yeni box'ta oluşturduğun deploy anahtarının **private** kısmı. Public kısmı yeni box'ta `C:\ProgramData\ssh\administrators_authorized_keys`'e ekle (yetkiyi kısıtla).
2. `deploy/windows/ci-windows.yml` içeriğini `.github/workflows/ci.yml` üzerine al (Claude bu swap'ı geçiş anında yapar), commit + push.
3. Push artık Windows'a SSH ile `deploy.ps1` çalıştırır.

## [9] Doğrula & emekliye ayır

- `https://app.cetpa.com.tr` tarayıcıda sertifika uyarısı olmadan açılıyor mu?
- Login, PG'ye bağlı veri, Mikro V17 entegrasyonu çalışıyor mu?
- 24-48 saat sorunsuzsa eski AlmaLinux box'ı kapat. **Admin şifresini değiştir.**

---

### İş bölümü özeti
| Claude (repo/kod) | Sen (sunucu) |
|---|---|
| setup.ps1, deploy.ps1, Caddyfile, ci-windows.yml | PowerShell'de scriptleri çalıştırma |
| CI swap (geçiş anında) | RDP/SSH login, .env, DNS, firewall onayı |
| Her adımın çıktısını doğrulama | pg_dump/restore, secret girişi |
