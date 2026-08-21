# Off-site yedek — rclone kurulumu (Windows Server)

> **HER ŞİRKET KENDİ SETUP'INI YAPAR (2026-08-21).**
> Zamanlanmış görev `scripts/backup-tenants.mjs` çalıştırır: her kiracı
> **yalnız kendi verisiyle** (`companyId` filtresi) **kendi rclone hedefine**
> yedeklenir. Bir müşteriye yedeğini vermek artık diğerlerinin verisini vermek
> anlamına gelmiyor.
>
> **Yeni müşteri onboarding'i şu adım olmadan tamamlanmış sayılmaz:**
> 1. Sunucuda o firmaya ÖZEL bir rclone remote oluşturun (aşağıdaki adımlar,
>    remote adını firmayla ilişkilendirin: `gdrive-musteri-a`)
> 2. Yönetim → Müşteri Yönetimi → firmayı açın → **Yedek Hedefi** alanına
>    `gdrive-musteri-a:cetpa-yedek` yazıp kaydedin
> 3. Kiracı listesinde o firmanın **Yedek** sütunu kırmızı "KURULUM YOK"
>    olmaktan çıkmalı
>
> Kurulum yapılmamış kiracı Operasyon Bekçisi'nde **FAIL** üretir ve yedek
> görevi `exit 1` ile biter — sessizce atlanmaz.

## Neden rclone

2026-08-19: Firebase Storage bu projede hiç etkinleştirilmemişti (bekçi iki aday
bucket adını da denedi, ikisi de yok) ve yeni projelerde Storage açmak Blaze
planı / kredi kartı istiyor. Kart verilmek istenmediği için yedekler **rclone**
ile mevcut Google hesabına (5 TB alan, 33 GB dolu) gidiyor.

rclone **sağlayıcı-bağımsız** seçildi: Google Drive, Mega, pCloud, OneDrive,
Dropbox aynı komutlarla çalışır. Sağlayıcı değiştirmek = `RCLONE_REMOTE`
değerini değiştirmek. Firebase yolu silinmedi — `RCLONE_REMOTE` boş bırakılıp
Storage açılırsa eski davranış aynen sürer.

## Kurulum

### 1) rclone'u sunucuya kur

```powershell
choco install rclone -y
rclone version
```

### 1.5) Kendi OAuth client_id'nizi oluşturun — ATLAMAYIN

rclone'un paylaşımlı client_id'si **2026 içinde emekliye ayrılıyor** (rclone
config ekranı bunu kendisi uyarıyor). Boş bırakırsanız bugün çalışır, yıl
içinde sessizce durur — aylardır çalışmayan bir yedek sistemini yeni onardık,
aynı tuzağa düşmeyelim.

1. [console.cloud.google.com/apis/credentials](https://console.cloud.google.com/apis/credentials)
   → proje: `gen-lang-client-0628151245`
2. **+ CREATE CREDENTIALS** → **OAuth client ID** → Application type: **Desktop app**
   (Firebase'in otomatik oluşturduğu *Web client* İŞE YARAMAZ — rclone Desktop
   tipi ister)
3. Client ID + Client Secret'i kopyalayın
4. [Google Drive API'yi etkinleştirin](https://console.cloud.google.com/apis/library/drive.googleapis.com)

#### ⚠️ Yayın durumu "In production" olmalı

OAuth consent screen **"Testing"** modundaysa Google refresh token'ı **7 günde
bir geçersiz kılar** — yani yedekleriniz her hafta sessizce durur. Bu, tam da
bu projede tekrar tekrar yaşanan sessiz-başarısızlık sınıfı.

**OAuth consent screen → Publishing status → PUBLISH APP** yapın.

`drive.file` kapsamı hassas sayılmadığı için doğrulama (verification) süreci
gerekmez; "unverified app" uyarısı görürseniz kendi hesabınız için
*Advanced → Go to ... (unsafe)* ile geçebilirsiniz.

### 2) Google Drive bağlantısını yetkilendir

Sunucu başsız (headless) olduğu için tarayıcı adımı **kendi bilgisayarınızda**
yapılır:

```powershell
# SUNUCUDA:
rclone config
#   n) New remote
#   name> gdrive
#   Storage> drive
#   client_id>     <- 1.5'te oluşturduğunuz Client ID
#   client_secret> <- 1.5'te oluşturduğunuz Secret
#   scope> 3       <- drive.file: SADECE rclone'un kendi oluşturduğu dosyalar
#                     (full access DEĞİL — yedek almak için gereksiz geniş yetki;
#                      ayrıca full access "restricted scope" sayılır ve Google
#                      doğrulaması ister)
#   Edit advanced config> n
#   Use auto config?> n        <-- ÖNEMLİ: sunucuda tarayıcı yok
#   -> ekranda bir komut verir, onu KENDİ MAC'İNİZDE çalıştırın:
```

```bash
# KENDİ MAC'İNİZDE (rclone kurulu olmalı: brew install rclone):
rclone authorize "drive"
# tarayıcı açılır, Google hesabıyla giriş yapılır
# terminale uzun bir token basılır -> onu kopyalayıp SUNUCUDAKİ config'e yapıştırın
```

### 3) Hedef klasörü oluştur ve doğrula

```powershell
rclone mkdir gdrive:cetpa-backups
rclone lsd gdrive:
```

> `drive.file` kapsamında rclone **yalnız kendi oluşturduğu** dosya/klasörleri
> görür. Bu yüzden hedef klasörü Drive arayüzünden değil, yukarıdaki gibi
> **rclone ile** oluşturun — aksi halde "klasör yok" der.

### 4) Ortam değişkenini ayarla

Sunucudaki `.env` dosyasına:

```
RCLONE_REMOTE=gdrive:cetpa-backups
```

`rclone` PATH'te değilse ayrıca:

```
RCLONE_PATH=C:\ProgramData\chocolatey\bin\rclone.exe
```

### 5) Elle bir kez çalıştır

```powershell
node C:\cetpa\scripts\backup-db-offsite.mjs
```

Beklenen çıktı:

```
Off-site hedef: rclone -> gdrive:cetpa-backups
pg_dump tamamlandi, boyut: X MB
DB yedegi yuklendi ve DOGRULANDI (X MB uzakta).
```

**"DOGRULANDI"** kritik: script yüklemekle yetinmez, `rclone lsjson` ile dosyanın
uzakta gerçekten var olduğunu ve **boyutunun tuttuğunu** kontrol eder. Yarım
yükleme sessizce "başarılı" sayılmaz.

## Doğrulama

Operasyon Bekçisi (Yönetim → Müşteri Yönetimi) kartındaki iki satır yeşile
dönmelidir:

```
DB yedeği (offsite)   cetpa_db_....dump — 0.5 saat önce, 5120 KB
Uploads yedeği        cetpa_uploads_....tar.gz — 0.5 saat önce, ...
```

## Saklama

| Yer | Süre |
|---|---|
| Sunucu (`C:\cetpa\backups`) | 3 gün |
| Uzak (Drive) | 30 gün |

## ⚠️ Yedek almak ≠ yedek çalışıyor

Bu kurulum yedeğin **alındığını** kanıtlar, **geri yüklenebildiğini** değil.
En az bir kez şu yapılmalı:

```powershell
rclone copy gdrive:cetpa-backups/db-backups/<dosya>.dump .
createdb cetpa_restore_test
pg_restore -d cetpa_restore_test <dosya>.dump
# tablo sayısı / satır sayısı beklenenle uyuşuyor mu?
dropdb cetpa_restore_test
```
