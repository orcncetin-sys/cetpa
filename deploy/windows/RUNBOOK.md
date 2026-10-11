# Cetpa — AlmaLinux → Windows Server 2022 Geçiş Runbook'u

**Hedef sunucu:** `78.111.111.185` (Windows Server 2022, Plesk kurulu)
> IP geçmişi: `213.238.190.124` → `78.111.111.185` (ODEAWEB donanım taşıması, 2026-09-24 gecesi;
> aynı VM/disk, yalnız genel IP değişti). Aşağıdaki adreslerin hepsi güncel IP'yi gösterir.
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
[7] DNS'i 78.111.111.185'e çevir  ← kesme anı
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
Gerçek prod dosyası eski box'ta `/opt/cetpa/.env` DEĞİL, **`/opt/cetpa/.env.production`** (docker-compose `env_file` ile kullanılıyor). Doğrudan eski sunucudan yeni sunucuya (aradan geçmeden) taşı:
```bash
# eski sunucuda (root):
scp /opt/cetpa/.env.production "administrator@78.111.111.185:C:/cetpa/.env"
```
Sonra yeni box'ta `DATABASE_URL` satırını TCP'ye çevir — eski box'ta **Unix domain socket** (`?host=/var/run/postgresql`) kullanılıyordu, Windows'ta bu yol yok:
```powershell
$newLine = "DATABASE_URL=postgresql://<KULLANICI>:<PAROLA>@localhost:5432/<DBADI>"
(Get-Content C:\cetpa\.env) -replace '^DATABASE_URL=.*', $newLine | Set-Content C:\cetpa\.env
```
(KULLANICI/PAROLA/DBADI'yi eski `.env.production`'daki `DATABASE_URL`'den al — parolayı sohbete/repoya yazma.)

```powershell
npm run build   # vite build -> dist/
```

---

## [3] Veritabanı taşıma (PostgreSQL yeni kuruldu, BOŞ — taşıma zorunlu)

**Eski box'ta (AlmaLinux, hâlâ canlı)** — gerçek db adını ve kullanıcıyı `.env.production`'daki `DATABASE_URL`'den al, sonra dök:
```bash
PGPASSWORD='<PAROLA>' pg_dump -Fc -h /var/run/postgresql -U <KULLANICI> <DBADI> > /root/cetpa_db_$(date +%F).dump
scp /root/cetpa_db_*.dump "administrator@78.111.111.185:C:/cetpa/cetpa_db.dump"
```

**Yeni box'ta** — db/kullanıcı oluştur (eski box'takiyle AYNI kullanıcı/parola/db adı — `.env`'i hiç değiştirmemize gerek kalmaz) + geri yükle:
```powershell
& "C:\Program Files\PostgreSQL\15\bin\psql.exe" -U postgres -c "CREATE USER <KULLANICI> WITH PASSWORD '<PAROLA>';"
& "C:\Program Files\PostgreSQL\15\bin\psql.exe" -U postgres -c "CREATE DATABASE <DBADI> OWNER <KULLANICI>;"
& "C:\Program Files\PostgreSQL\15\bin\pg_restore.exe" -h localhost -U <KULLANICI> -d <DBADI> --no-owner "C:\cetpa\cetpa_db.dump"
```
> Kurulumda geçici verilen `postgres` süper-kullanıcı parolasını (`postgres/postgres`) da burada güçlü bir parolayla değiştir:
```powershell
& "C:\Program Files\PostgreSQL\15\bin\psql.exe" -U postgres -c "ALTER USER postgres WITH PASSWORD '<GUCLU_PAROLA>';"
```
> ⚠️ **2026-07-01 geçişinde bir PG uygulama parolası yanlışlıkla bir sohbet kanalında göründü** (PowerShell'in `[Uri]` dönüşüm hata mesajı ham değeri echo etti). Geçiş bitince — [10]'daki temizlikle birlikte — bu parolayı da `ALTER USER <KULLANICI> WITH PASSWORD '<YENI_PAROLA>';` ile değiştir ve `.env`'i güncelle.

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

DNS panelinde `app.cetpa.com.tr` **A kaydını** `78.111.111.185`'e çevir. `nslookup app.cetpa.com.tr` yeni IP'yi gösterene kadar bekle.

## [8] Let's Encrypt (Plesk)

Plesk → `app.cetpa.com.tr` → **SSL/TLS Certificates** → **Let's Encrypt ekle** (DNS yeni IP'ye baktığı için doğrulama geçer). Sertifika alınınca:
```powershell
curl.exe -s -o NUL -w "%{http_code}`n" https://app.cetpa.com.tr/api/health   # 200 bekleniyor
```

## [9] CI/CD → Windows

Cutover doğrulandıktan sonra:
1. GitHub repo **Secrets**: `VDS_HOST=78.111.111.185`, `VDS_USER=administrator`, `VDS_SSH_KEY`= yeni box'ta oluşturduğun deploy anahtarının **private** kısmı. Public kısmı yeni box'ta `C:\ProgramData\ssh\administrators_authorized_keys`'e ekle.
2. `deploy/windows/ci-windows.yml` içeriğini `.github/workflows/ci.yml` üzerine al, commit + push.
3. Push artık Windows'a SSH ile `deploy.ps1` çalıştırır (git reset --hard → build → `Restart-Service cetpa` → health).

## [10] Doğrula & emekliye ayır

- `https://app.cetpa.com.tr` tarayıcıda sertifika uyarısı olmadan açılıyor mu? `https://cetpa.com.tr` (kök) ve mail hâlâ çalışıyor mu (regresyon kontrolü)?
- Login, PG'ye bağlı veri, **SSE canlı senkron** (ARR responseBufferLimit fix'i test et — bir sekmede değişiklik yap, başka sekmede anlık görünüyor mu?), Mikro V17 entegrasyonu çalışıyor mu?
- 24-48 saat sorunsuzsa eski AlmaLinux box'ı kapat. **Admin şifresini değiştir** (bu geçişte bir kanalda paylaşıldı).
- **PG uygulama parolasını değiştir** (bkz. [3]'teki uyarı — bir sohbet kanalında göründü): yeni box'ta `ALTER USER <KULLANICI> WITH PASSWORD '<YENI>'` + `.env`'deki `DATABASE_URL`'i güncelle + `Restart-Service cetpa`.
- `postgres` süper-kullanıcı parolasının geçici `postgres/postgres` DEĞİL, [3]'te belirlediğin güçlü parola olduğunu doğrula.

---

## [11] Sunucu saat dilimi — Pasifik → İstanbul (2026-09-24 bulgusu)

Sunucu Pasifik dilimindeydi (PG damgaları `-07`; gece Mikro senkronu `03:20-07` = 13:20 İstanbul).
Kod artık dilimden bağımsız (`src/server/zamanla.ts`, cron'lar Europe/Istanbul), ama Mikro/SQL Server,
Görev Zamanlayıcı, Windows Update ve PG gösterimi OS dilimine bağlı kalır. Sırayla:

1. **Yalnız DİLİMİ değiştir, saati elle ADIMLAMA** (yönetici PowerShell): `tzutil /s "Turkey Standard Time"` — anında etkili, restart gerekmez. Epoch değişmez; node-cron kaçırılan koşuyu telafi etmediği için saat adımı (elle ayar / `w32tm` step) o günkü işi atlatır — adım olduysa 2. adımı mutlaka yap.
2. `Restart-Service cetpa` — Node dilimi süreç başında önbellekler; restart'sız yerel tarih çağrıları eski dilimde kalır. (Bir deploy da aynı işi görür.)
   **Tetik kayması (tek seferlik):** `zamanla()` sürümünün İLK deploy'u ya da bu restart, tetikleri eski Pasifik saatinden İstanbul'a kaydırır; node-cron geçmiş eşleşmeyi telafi etmez. Restart 08:30–18:30 İstanbul arasına düşerse o gün bekçi (08:30) ve saklama (08:15) bir kez atlanır; 03:20–13:20 arasına düşerse gece SQL senkronu (03:20) ve stok senkronu (04:00) da o gün koşmaz. Restart'ı **18:30 İstanbul'dan sonra** (ya da 03:20'den önce) yap; olmadıysa süper-admin panelindeki Operasyon Bekçisi kartından "Elle çalıştır" (`POST /api/ops/watchdog/run`) ile o günün `opsChecks` kaydını üret, gerekirse ERP Hub'dan SQL senkronunu tetikle.
3. PostgreSQL kendi dilimini kurulumda OS'tan kopyalar, OS'la DEĞİŞMEZ: `C:\Program Files\PostgreSQL\15\data\postgresql.conf` içinde `timezone` ve `log_timezone` → `'Europe/Istanbul'`, sonra psql `SELECT pg_reload_conf();` (restart gerekmez), teyit `SHOW timezone;`. Yapılmazsa `pg-sorgu.ps1` damgaları `-07` görünmeye devam eder ("düzeltme tutmadı" yanılgısı).
4. Görev Zamanlayıcı'daki yedek görevi (`CetpaDbBackupOffsite`, `register-backup-task.ps1`, 03:30 yerel) artık 03:30 İstanbul'da koşar. **Değişikliği o günün yedeği KOŞTUKTAN sonra — 13:30 İstanbul'dan sonra — yap** (o zaman boşluk ~14 saat). Sabah yapıldıysa adım 1'den hemen sonra `Start-ScheduledTask -TaskName CetpaDbBackupOffsite` ile yedeği elle koştur; aksi hâlde ~38 saatlik yedeksiz pencere oluşur ve bekçi (08:30 örneklemesi, 26 sa eşiği) bunu GÖRMEZ. Teyit: `Get-ScheduledTaskInfo -TaskName CetpaDbBackupOffsite | Select LastRunTime,NextRunTime` → NextRunTime ertesi gün 03:30. Plesk zamanlanmış görevleri ve Windows Update etkin saatlerine (08–17 yerel) bir kez bak.
5. Mikro'yu bir kez aç (lisans/tarih); `GETDATE()` damgaları bir kez 10 saat ileri atlar, geri gitme yok.
6. Teyit (ertesi gün): `pg-sorgu.ps1 -Sql "SELECT data->>'operation', updated_at FROM docs WHERE coll='syncLog' AND data->>'userId'='system' ORDER BY updated_at DESC LIMIT 3"` → `03:20:xx+03`.

### İş bölümü özeti
| Claude (repo/kod) | Sen (sunucu) |
|---|---|
| setup.ps1, deploy.ps1, setup-iis-proxy.ps1, web.config, ci-windows.yml | PowerShell'de scriptleri çalıştırma |
| CI swap (geçiş anında) | RDP login, .env, Plesk paneli (subdomain+LE), DNS, pg_dump/restore |
| Her adımın çıktısını doğrulama | Secret girişi, parola belirleme |

## [12] Mağaza talebi bildirimi — hazırlık ve geliştirme ortamı (2026-10-09)

- Bildirim varsayılan olarak YEREL kipte gider: kimlik bilgisi olmadan, bu makinedeki posta sunucusuna (127.0.0.1:25), alıcı ve gönderen `iletisim@cetpa.com.tr`. Ortam anahtarı gerekmez.
- Hazırlık (staging) hizmeti üretimin `.env`'ini kopyalar ve AYNI makinede koşar; deneme talepleri gerçek kutuya gitmesin diye hazırlığın `.env` dosyasına ELLE `MAGAZA_BILDIRIM=kapali` satırı eklenir (`setup-staging.ps1` yalnız dosya yokken yazar; var olan dosyaya işlemez). Geliştirme makinesinde de aynı satır.
- Posta sunucusu kimliksiz yerel teslimi reddederse bekçi `magaza_talep` ayrıntısı nedeni ve yolu yazar: «gönderen reddi» = MailEnable SMTP → Security → Address spoofing («Authorized connections» + Privileged IPs'te 127.0.0.1); «alıcı reddi» = cetpa.com.tr posta hizmeti / `iletisim@` kutusu. Geri dönüş: `.env`'e `SMTP_HOST=mail.cetpa.com.tr`, `SMTP_USER`, `SMTP_PASS` (kimlikli kip; `SMTP_FROM` boş).
- Yeniden başlatmada gitmemiş bildirimler (yapılandırılmamış / 3 saatten eski bekliyor) teslim sondası geçerse kendiliğinden kuyruğa alınır; kanıt `scripts/ops-istek.sh /api/ops/summary` → `magazaBildirim.sayim`.

## [13] Mağaza dilim 2a — site paneli («ERP ile bağlan»), takip ucu, talep aşamaları (2026-10-10)

### Yayın KESİNTİLİDİR — mesai dışında yap
- Bu yayın `package-lock.json`'ı değiştirir (yalnız test bağımlılığı: `@electric-sql/pglite`). `deploy.ps1` kilit dosyası değişince yavaş yola girer: `Stop-Service` → `npm ci --legacy-peer-deps` → `npm run build` → `Restart-Service`. Hizmet `npm ci` + derleme süresince DURUR (1-2 dk 502).
- O aralıkta mağaza (www.cetpa.com.tr) sipariş talebi göndermeye devam eder ve yanıtı OKUMAZ: müşteri «talebiniz alındı» görür, talep ERP'ye yazılmaz. Yayından sonra WhatsApp'tan gelip ERP → Siparişler → Mağaza Talepleri listesinde OLMAYAN talep var mı diye bak.
- Sonraki yayınlar (kilit dosyası değişmeden) yine hızlı yoldan gider.

### Ortam ayarı
- `MAGAZA_PANEL_DONUS`: site panelinin dönüş adresi. Varsayılan `https://www.cetpa.com.tr/panel.html` doğrudur; canlı `.env`'e yazmak GEREKMEZ. Yazılacaksa: https zorunlu, kullanıcı adı / sorgu (`?`) / parça (`#`) taşıyamaz, kökeni `MAGAZA_IZINLI_KOKENLER` listesinde bulunmalı (liste boşsa varsayılan köken `https://www.cetpa.com.tr`).
- Panel belirteci anahtarı `SESSION_TOKEN_SECRET` (o yoksa `FIREBASE_PRIVATE_KEY`), dönüş adresi ve `APP_URL`'den türer: yeni bir sır GEREKMEZ. Üçünden biri değişirse açık panel oturumları düşer (personel panelden yeniden bağlanır). Hazırlık (staging) ortamının `APP_URL`'i farklı olduğu için oradan alınan belirteç canlıda geçmez (bilerek).
- Dönüş adresi geçersizse ya da iki sır da yoksa panel HİÇ çalışmaz: `POST /api/magaza-panel/yetki-kodu` ve bütün `/api/magaza/panel/*` uçları `503 panel-yapilandirilmamis` döner. Üç yerden görünür: bekçi `magaza_talep` ayrıntısında «SİTE PANELİ ÇALIŞMIYOR» (kırmızı), `scripts/verify-deploy.sh post` FAIL, panelin kendi ekranı.
- `SERVER_TENANT_COMPANY_ID` tanımlı olmalı (dilim 1 ön koşulu): kiracı çözülemezse sipariş talebi ucu da panel de 503 verir; bekçi «KİRACI ÇÖZÜLEMİYOR» yazar.

### Yayın sırası
1. ERP dilim 2a canlı + `scripts/verify-deploy.sh post` geçti (aşağıdaki sondalar dâhil).
2. Mağaza YENİ `panel.js`'i yayınlar; AYNI yayında `uclar.durum: true` ve `uclar.panel: true`. Eski `panel.js` ile `uclar.panel` AÇILMAZ (eski sürüm ERP e-posta + şifresini mağaza kökeninde alıp yollar; ERP bunu 400 ile reddeder ama parola ağa çıkmış olur).
3. Adım 2'ye kadar eski takip sayfası kalem listesini rozetsiz gösterir (fiyat / SKU / müşteri alanı sunucudan hiç dönmez); kabul edilen geçici görünümdür — mağaza eki aynı gün ya da ertesi iş günü yayınlanır.

### Yayından sonra doğrulama
- `scripts/verify-deploy.sh post` (hiçbiri kayıt yazmaz, oturum açmaz, e-posta göndermez):
  - takip ucu `POST /api/magaza/siparis-durumu` var olmayan talep no ile → `404 bulunamadi` (`503 hazir-degil` = canlıda hâlâ dilim 1; kodsuz 404 = rota yok; 503 = pg havuzu / kiracı yok);
  - belirteçsiz `GET /api/magaza/panel/siparisler`, verilmemiş kodla `POST …/panel/oturum`, belirteçsiz `POST …/kalem-teslim` ve `…/etiket-basildi` → 401 (404 = panel alt zinciri bağlı değil; `503 panel-yapilandirilmamis` = yukarıdaki ortam ayarı);
  - panel ön uçuşu → 204 + `Allow-Methods` GET + `Allow-Headers` Authorization (IIS'in bu ön uçuşu Node'a ilettiği burada ölçülür); dış zincir ön uçuşunda Authorization YOK;
  - ERP kökenindeki dört mağaza ucu (`/api/magaza-panel/yetki-kodu`, `/api/magaza-talepleri/:id/durum`, `…/kalem-teslim`, `…/bildirim-gonder`): bozuk JSON → 400 / 500 ve geçerli `{}` kimliksiz → 401 (404 = rota kayıtlı değil);
  - istemci derlemesi: ana betikte (`/assets/index-….js`) `/magaza-panel-baglan` metni (yoksa «ERP ile bağlan» onay sayfası yayında değil).
- `scripts/ops-istek.sh /api/ops/summary` → `magaza.acik` (açık talep sayısı, aşama dağılımı, en eski açığın kayıt zamanı) ve `magaza.sayaclar` (`uc` / `panel` / `takip`; süreç başından beri, yeniden başlatmada sıfırlanır). Panelden ilk bağlanmadan sonra `panel.oturum` ve `panel.yetkiKodu` 1 olmalı. Aynı anda `panel.yetkiKoduIptalDenetimsiz` 0 olmalı: «ERP ile bağlan» onayında sunucu Firebase'e «bu oturum iptal edildi mi» diye sorar (ERP'den çıkış yapılmış ama süresi dolmamış kimlik belirteciyle yeni panel oturumu açılmasın). Sayaç 0'dan büyükse o denetim ÇALIŞMIYOR ve kod denetimsiz veriliyor demektir — neden: `.env`'de Firebase hizmet hesabı kimliği (`FIREBASE_CLIENT_EMAIL` + `FIREBASE_PRIVATE_KEY`) yok ya da sunucudan Google'a çıkış yok; günlükte `[magaza-erp] yetki kodu: belirteç iptali denetlenemedi` satırı hata kodunu yazar. Panel yine çalışır; yalnız bu ek koruma devre dışıdır (bekçi de panel sayaçlarında «yetki kodu Firebase iptal denetimi YAPILAMADAN verildi» diye gösterir).
- Bekçi (08:30) `magaza_talep` ayrıntısı artık sekiz parçadır: kiracı · SMTP · site paneli yapılandırması · bildirim sayımı · açık talepler · uç sayaçları · panel sayaçları · takip sayaçları. Açık talep sayısı / yaşı ve üç sayaç kümesi yalnız BİLGİDİR (eşik yok); kırmızı yapanlar: kiracı, SMTP, site paneli yapılandırması, gitmeyen bildirim, okunamayan sayım, dilim 1 ucunun 500'ü.

### Davranış notları
- ERP'den çıkış (`Çıkış yap`) o kullanıcının bütün site paneli oturumlarını da kapatır. Rolü düşen, firması askıya alınan ya da MFA'yı sonradan açan kullanıcının panel oturumu beklemeden düşer.
- Hizmet yeniden başlarsa: verilmiş ama henüz kullanılmamış bağlanma kodları (60 sn ömürlü) düşer — kullanıcı panelden yeniden «ERP ile giriş yap» der; açık panel oturumları (8 saat) YAŞAR; süreç içi sayaçlar sıfırlanır.
- «Yeniden gönder» (ERP → Mağaza Talepleri, gitmeyen bildirim rozeti) talebi yeniden kuyruğa alır; bekçinin gitmeyen bildirim sayımı talebin KAYIT saatinden ölçmeye devam eder (elle gönderim kırmızıyı tek başına söndürmez, bildirim gerçekten gidince söner).

## [14] Mağaza dilim 2b — içerik düzenleme, elle talep, yumuşak silme, revize bildirimi (2026-10-11)

### Yayın
- Kilit dosyası DEĞİŞMEDİ (yeni bağımlılık yok): yayın hızlı yoldan gider, [13]'teki kesinti bu yayında yok.
- Yeni ortam ayarı YOK. Revize bildirimi ilk bildirimle AYNI posta ayarını kullanır ([12]); `MAGAZA_BILDIRIM=kapali` ikisini de kapatır.
- İkinci kuyruk `magaza-talep-revize-bildirimi` açılışta kendiliğinden oluşur. Açılış günlüğündeki `pg-boss ready ✓ (kuyruklar: …)` satırında İKİ mağaza kuyruğu da görünmeli; revize kuyruğu yoksa revize bildirimi kuyruksuz (süreç içi, yeniden denemesiz) gider.
- Sıra: ERP dilim 2b canlı + `scripts/verify-deploy.sh post` geçti → mağaza `panel.js` 2b ekini AYNI GÜN yayınlar. Arada: teyit yazılmış talepte eski panelin kalem kutusu 400 alır ve liste yenilenir (kutu geri döner); teyit yazılmamış taleplerde eski panel tam çalışır.

### Yayından sonra doğrulama
- `scripts/verify-deploy.sh post` — [13]'teki sondalara ek (hiçbiri kayıt açmaz, içerik yazmaz, talep silmez, e-posta göndermez):
  - üç yeni ERP ucu (`POST /api/magaza-talepleri`, `…/:id/icerik`, `…/:id/sil`): bozuk JSON → 400 / 500 ve geçerli `{}` kimliksiz → 401 (404 = canlıda hâlâ dilim 2a);
  - `POST /api/magaza-talepleri/:id/bildirim-gonder?tur=revize` kimliksiz → 401 (400 = sorgu kimlik kapısından önce ayrıştırılıyor, sıra bozuk);
  - belirteçsiz `POST /api/magaza/panel/siparisler/:id/sil` → 401.
- Sonda ile ÜRETİLEMEYEN tek yanıt takip ucunun `404 silindi`sidir (canlıda yapay silinmiş kayıt açılmaz). İlk gerçek silmeden sonra elle: mağaza takip sayfasında o talebin no + telefonu → «Talebiniz silinmiş»; ERP'de geri alınınca aynı sorgu talebi yeniden bulur. Hiç var olmayan talep no «bulunamadı» demeye devam eder.
- `scripts/ops-istek.sh /api/ops/summary`:
  - `magazaBildirim.sayim.revize` — son 7 günde REVİZE edilen taleplerin revize bildirimi (`durum`, `hataSinifi`); ilk bildirim sayıları (`sayim.durum`) son 7 günde GELEN talepleri sayar, ikisi karışmaz;
  - `magaza.sayaclar.panel` yeni sayaçlar: `icerik*` (yazım / değişiklik yok / 409 / 400 / 503 / 429), `silPanel*`, `silErp*`, `geriAl*`, `elleTalep*`, `revizeBildirimIstendi` / `revizeBildirimIstenemedi`, `bildirimGonderRevize*`; `magaza.sayaclar.takip.silindi`.
- İlk gerçek ölçümler (canlıda henüz görülmedi): bir talebin notunu ERP'de düzenle → `iletisim@` kutusuna «Mağaza talebi revize edildi · <talep no>» gelmeli (gövdede yalnız değişen alan adları, revize eden, zaman ve ERP bağlantısı; müşteri bilgisi / kalem / tutar YOK); ERP'den elle talep aç → «Yeni mağaza talebi» postası gelmeli.

### Bekçi (08:30) — `magaza_talep` ayrıntısı on parça
- [13]'teki sekiz parçaya iki ek: bildirim sayımının ardında «revize bildirimi: gönderilemedi N, yapılandırılmamış M, 10 dk+ bekleyen K, 7 günden eski gitmeyen E (bilgi)»; açık taleplerin ardında «silinmiş: N (son 30 gün)».
- Kırmızı yapanlara eklenen: gitmeyen REVİZE bildirimi (son 7 günde revize edilen talepte gönderilemedi / yapılandırılmamış / 10 dk+ bekleyen) ve okunamayan revize / silinmiş sayımı. Yaş revizyonun saatinden ölçülür: işçinin yeniden denemeleri ve «Yeniden gönder» kırmızıyı tek başına söndürmez, bildirim gerçekten gidince söner. Kapalı kipte «yapılandırılmamış» iki bildirimde de bilgidir.
- Bilgi (eşik yok): silinmiş talep sayısı ve yeni sayaçlar. Silinen talep «açık talep» sayısından düşer, geri alınınca döner.
- Kırmızı revize satırını kapatmanın yolu: ERP → Mağaza Talepleri → talebin «Revize bildirimi» rozetindeki «Yeniden gönder». Silinmiş talepte bu düğme çalışmaz (talep donuktur): gitmeyen bildirimi olan talep silinmişse satır 7 gün sonra kendiliğinden bilgiye düşer, ya da talep geri alınıp yeniden gönderilir.

### Davranış notları
- Hizmet yeniden başlarsa gitmemiş revize bildirimleri de (yapılandırılmamış / 3 saatten eski bekliyor) teslim sondası geçerse kendiliğinden revize kuyruğuna alınır ([12]'deki kuralın aynısı; günlük satırı `[magaza-bildirim] revize: kaçanlar: …`).
- Aynı talep art arda revize edilirse ve ilk posta henüz gitmemişse TEK posta gider (değişen alan adları birleşik). İlk posta gittikten sonra gelen revizyon ikinci postayı üretir.
- Silme ve geri alma yalnız Yönetici rolündedir (ERP ve site paneli); panelden geri alma yoktur. Aşama değişimi, kalem teslim, silme ve geri alma bildirim ÜRETMEZ.
