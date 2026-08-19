# Off-site yedek — rclone kurulumu (Windows Server)

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

### 2) Google Drive bağlantısını yetkilendir

Sunucu başsız (headless) olduğu için tarayıcı adımı **kendi bilgisayarınızda**
yapılır:

```powershell
# SUNUCUDA:
rclone config
#   n) New remote
#   name> gdrive
#   Storage> drive
#   client_id / client_secret> (boş bırakın)
#   scope> 1  (full access)
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
