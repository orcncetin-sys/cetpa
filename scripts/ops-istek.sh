#!/usr/bin/env bash
# ops-istek.sh — OPS_SUMMARY_TOKEN korumalı tanı uçlarını (/api/ops/*, /api/mikro/sema-kesif …) Mac'ten çağırır.
#
# NEDEN VAR (2026-09-28): yerel .env'deki jeton ASCII dışı karakter taşıyordu (kopyala-yapıştır artığı) ve HTTP
# başlığına konamıyordu; jetonu sohbete yapıştırmak da yasak (yapıştırılan sır YANMIŞ sayılır). Jeton artık macOS
# Anahtar Zinciri'nde durur; bu betik onu okur ve DEĞERİ HİÇBİR YERE YAZMAZ: ekrana basılmaz, komut satırına
# (ps çıktısına) girmez — curl başlığı süreç ikamesinden (-H @dosya) okur; `set -x` yok.
#
# KURULUM (bir kez, kullanıcı yapar):
#   1. Sunucuda (RDP, PowerShell) MEVCUT jetonu panoya al — DÖNDÜRME: jeton günlük bulut rutininin talimatına gömülü,
#      rotate-ops-token.ps1 çalışırsa rutin kırılır:
#        (Select-String -Path C:\cetpa\.env -Pattern '^OPS_SUMMARY_TOKEN=').Line.Split('=',2)[1].Trim() | Set-Clipboard
#   2. Mac'te Anahtar Zinciri'ne koy (değer SORULUR, gizli yapıştırılır; ekrana düşmez):
#        security add-generic-password -U -a "$(id -un)" -s cetpa-ops-token -w
#   3. Dene:  scripts/ops-istek.sh /api/ops/summary
#
# KULLANIM: scripts/ops-istek.sh <yol /api/...> [çıktı-dosyası]
#   Çıktı dosyası verilirse gövde oraya yazılır (sema-kesif örnekleri müşteri verisi içerebilir — sohbete yapıştırma).
# ÇIKIŞ KODLARI: 0 = 2xx · 1 = diğer HTTP · 2/3 = Anahtar Zinciri/jeton biçimi · 5 = HTTP 401 · 6 = HTTP 503 ·
#   7 = AĞ / SUNUCU TARAFI (HTTP yanıtı yok: DNS/proxy/bağlantı/TLS/zaman aşımı; ya da yanıt yarıda kesildi/bozuk: 18/8) ·
#   8 = YEREL curl hatası (ağ DEĞİL; ör. 23 çıktı dosyasına yazılamadı, 26 başlık okunamadı, 3 adres bozuk) ·
#   64 = kullanım / çıktı yolu yazılamıyor, dizin ya da '/' ile bitiyor (istek GÖNDERİLMEDİ).
set -euo pipefail
# Hesap adı bir kez çözülür: `set -u` altında USER tanımsızsa "$USER" betiği düşürüyor, hata "jeton yok" diye yanlış
# raporlanıyordu (son kontrol 2026-09-28).
HESAP="${USER:-${LOGNAME:-$(id -un)}}"

YOL="${1:-}"
CIKTI="${2:-}"
TABAN="${CETPA_TABAN:-https://app.cetpa.com.tr}"

case "$YOL" in
  /api/*) ;;
  *) echo "kullanim: $0 /api/... [cikti-dosyasi]" >&2; exit 64 ;;
esac

# Çıktı yolu İSTEKTEN (ve jeton okumaktan) ÖNCE denetlenir (tur 3, 2026-09-28): curl çıktı dosyasını ilk gövde baytında
# açar — dizin yoksa sunucu ağır sorguyu (ör. /api/mikro/iskonto-tutarsizlik: tüm geçmiş SqlVeriOkuV2) ÇALIŞTIRIP 200
# dönmüş olur, curl ANCAK SONRA 23 ile düşerdi; betik bunu "ağ hatası" diye raporluyor, kullanıcı yeniden koşunca Mikro
# üretim veritabanında tam tarama baştan başlıyordu. Burada istek HİÇ gönderilmez.
# Delta (2026-09-28): var olan DİZİN ya da '/' ile biten yol da reddedilir — dirname'leri yazılabilir olduğu için eski
# denetimden geçiyor, curl gövdeyi dizine yazamayınca yine istekten SONRA 23 ile düşüyordu.
if [ -n "$CIKTI" ]; then
  # Delta 2 (2026-09-28): '-' dizin değil, dirname'i '.' ve yazılabilir → eski denetimden geçiyordu; curl '-o -'yu STDOUT
  # sayar, gövde yine KOD değişkenine karışıyordu ("{…}200", durum satırı gövdeyi taşıyor, başarılı istek exit 1).
  case "$CIKTI" in
    -) echo "HATA: çıktı yolu '-' (stdout) desteklenmiyor — gövdeyi ekranda görmek için ikinci argümanı hiç verme; dosya için ad ver (ör. ./sonuc.json). İstek GÖNDERİLMEDİ." >&2
       exit 64 ;;
    */) echo "HATA: çıktı yolu '/' ile bitiyor ($CIKTI) — dizin değil DOSYA adı ver (ör. ${CIKTI}sonuc.json). İstek GÖNDERİLMEDİ." >&2
        exit 64 ;;
  esac
  if [ -d "$CIKTI" ]; then
    echo "HATA: çıktı yolu bir DİZİN ($CIKTI) — dosya adı ver (ör. $CIKTI/sonuc.json). İstek GÖNDERİLMEDİ." >&2
    exit 64
  fi
  # Son kontrol 2026-09-28: dosya ZATEN varsa yalnız dosyanın kendisine yazma izni gerekir (üst dizin salt okunur olabilir:
  # /dev/null, 555 dizinde 666 dosya); yoksa üst dizin var ve yazılabilir olmalı.
  if [ -e "$CIKTI" ]; then
    if [ ! -w "$CIKTI" ]; then
      echo "HATA: çıktı dosyası var ama yazma izni yok ($CIKTI). İstek GÖNDERİLMEDİ." >&2
      exit 64
    fi
  else
    CIKTI_DIZIN="$(dirname -- "$CIKTI")"
    if [ ! -d "$CIKTI_DIZIN" ]; then
      echo "HATA: çıktı dizini yok ($CIKTI_DIZIN). İstek GÖNDERİLMEDİ." >&2
      echo "      Önce: mkdir -p \"$CIKTI_DIZIN\"" >&2
      exit 64
    elif [ ! -w "$CIKTI_DIZIN" ]; then
      echo "HATA: çıktı dizinine yazma izni yok ($CIKTI_DIZIN). İstek GÖNDERİLMEDİ." >&2
      exit 64
    fi
  fi
fi

if ! TOKEN="$(security find-generic-password -a "$HESAP" -s cetpa-ops-token -w 2>/dev/null)"; then
  echo "HATA: Anahtar Zinciri'nde 'cetpa-ops-token' yok — betiğin başındaki KURULUM adımlarını uygula." >&2
  exit 2
fi
# `security -w` yazdırılamayan / ASCII dışı bayt içeren parolayı HAM değil HEX kodlu basar (ör. sonda U+200B → "…e2808b");
# hex yalnız [0-9a-f] olduğu için aşağıdaki ASCII denetiminden GEÇER ve sunucuya hex dizesi gidip 401 dönerdi — kullanıcı
# asıl nedeni (Anahtar Zinciri'ndeki kirli değer) görmez, jetonu döndürmeye yönelirdi (tur 2, 2026-09-28). `-g` biçimi
# kesin işarettir: yazdırılabilir değer `password: "…"`, kodlanmış değer `password: 0x<HEX>`. Satır yalnız boruda kalır
# (ekrana/değişkene düşmez); grep -q KULLANILMAZ (erken çıkış SIGPIPE → pipefail altında yanlış sonuç).
if /usr/bin/env security find-generic-password -a "$HESAP" -s cetpa-ops-token -g 2>&1 >/dev/null | LC_ALL=C grep '^password: 0x' >/dev/null; then
  unset TOKEN
  echo "HATA: Anahtar Zinciri'ndeki jeton yazdırılamayan / ASCII dışı karakter içeriyor (security değeri HEX kodlu veriyor)." >&2
  echo "      Sunucudan temiz kopyalayıp KURULUM 2. adımı yeniden yap (-U mevcut kaydı günceller). Jetonu DÖNDÜRME. Değer YAZDIRILMADI." >&2
  exit 3
fi
# Yalnız yazdırılabilir ASCII (boşluk ve tırnak HARİÇ) — .env'deki eski arıza tam buydu. Değer yazdırılmaz.
if [ -z "$TOKEN" ] || LC_ALL=C printf '%s' "$TOKEN" | LC_ALL=C grep -q "[^!-~]" || LC_ALL=C printf '%s' "$TOKEN" | grep -q "[\"']"; then
  echo "HATA: jeton boş ya da izin verilmeyen karakter içeriyor (ASCII dışı / boşluk / tırnak). Değer YAZDIRILMADI." >&2
  echo "      Sunucudan temiz kopyalayıp KURULUM 2. adımı yeniden yap (-U mevcut kaydı günceller)." >&2
  exit 3
fi

# Gövde HER ZAMAN bir dosyaya yazılır: eskiden dosyasız modda `-o >(cat)` kullanılıyordu; süreç ikamesindeki cat komut
# ikamesinin stdout'unu devralıyor, gövde KOD değişkenine karışıyordu ("{...}200") → 2xx/401/503 dalları hiç eşleşmiyordu.
# Geçici dosya mktemp ile 0600 açılır (gövde müşteri verisi içerebilir) ve çıkışta silinir.
GOVDE="$CIKTI"
if [ -z "$GOVDE" ]; then
  GOVDE="$(mktemp -t ops-istek)"
  trap 'rm -f "$GOVDE"' EXIT
fi
# curl hatası `set -e`'ye BIRAKILMAZ: curl'ün 5/6 çıkış kodları (proxy/DNS çözülemedi) betiğin 401/503 için ayırdığı
# 5/6 ile çakışıyor ve "sunucuda jeton yok" diye okunup sunucu .env'ine yönlendiriyordu. Ağ hatası AYRI kod: 7.
# Tur 3 (2026-09-28): curl'ün sıfır olmayan HER kodu "ağ hatası" değildir — 23 (çıktıya yazılamadı), 26 (başlık dosyası
# okunamadı) gibi YEREL hatalar ayrı kod (8) ve ayrı metinle: istek sunucuya ulaşıp işlenmiş olabilir, "ağı kontrol et"
# demek kullanıcıyı ağır ucu yeniden koşmaya yönlendiriyordu.
RC=0
KOD=$(curl -sS --max-time 180 -o "$GOVDE" -w '%{http_code}' -H @<(printf 'x-ops-token: %s\n' "$TOKEN") "$TABAN$YOL") || RC=$?
if [ "$RC" -ne 0 ]; then
  unset TOKEN
  # Delta (2026-09-28): liste TERSİNE çevrildi — YEREL olduğu kanıtlı kodlar beyaz listede (1 protokol yok, 2 başlatılamadı,
  # 3 URL bozuk, 4 özellik yok, 23 yazma, 26 okuma, 27 bellek, 43 iç hata, 48 bilinmeyen seçenek); geri kalan HER kod ağ /
  # sunucu tarafıdır. Eskiden ağ listesi dışındaki 18 (gövde yarıda kesildi — IIS/ARR), 8 (tuhaf yanıt), 47 (çok fazla
  # yönlendirme) "YEREL HATA" diye etiketlenip kullanıcıyı diske/izne yönlendiriyordu.
  case "$RC" in
    1|2|3|4|23|26|27|43|48)
      echo "YEREL HATA (ağ DEĞİL): curl çıkış $RC — 23: çıktı dosyasına yazılamadı, 26: başlık okunamadı, 3: adres ($TABAN) biçimi bozuk; ayrıntı yukarıdaki curl satırında." >&2
      echo "           İstek sunucuya ULAŞMIŞ ve işlenmiş olabilir: ağır uçları (tüm geçmiş taraması) körü körüne yeniden koşma, önce yerel nedeni gider." >&2
      [ -n "$CIKTI" ] && echo "           $CIKTI yarım/boş olabilir — kullanma." >&2
      exit 8 ;;
    37|53|58|59|66|77)
      echo "YEREL HATA (ağ DEĞİL): curl çıkış $RC — 77: CA paketi okunamadı (CURL_CA_BUNDLE / ~/.curlrc --cacert), 58: istemci sertifikası, 53/66: SSL motoru, 59: şifre listesi, 37: dosya okunamadı. İstek GÖNDERİLMEDİ." >&2
      exit 8 ;;
    8|18)
      echo "YANIT YARIM/BOZUK: sunucu ya da proxy (IIS/ARR) yanıtı gövde bitmeden kesti (18) ya da tanınmayan yanıt döndü (8) — curl çıkış $RC, HTTP ${KOD:-?}." >&2
      echo "           Yerel disk/izin sorunu DEĞİL. İstek sunucuda işlenmiş olabilir: ağır uçları körü körüne yeniden koşma; sunucu/proxy günlüğüne bak." >&2
      [ -n "$CIKTI" ] && echo "           $CIKTI yarım/boş olabilir — kullanma." >&2
      exit 7 ;;
    *)
      echo "AĞ HATASI: HTTP yanıtı alınamadı (curl çıkış $RC — 5/6: proxy/DNS çözülemedi, 7: bağlanamadı, 28: zaman aşımı, 35/60: TLS, 47: çok fazla yönlendirme, 52/55/56: bağlantı koptu)." >&2
      echo "           Sunucu yapılandırması (.env / jeton) bu hatanın nedeni DEĞİL; adresi ($TABAN) ve ağı kontrol et." >&2
      [ -n "$CIKTI" ] && echo "           $CIKTI yarım/boş olabilir — kullanma." >&2
      exit 7 ;;
  esac
fi
unset TOKEN
if [ -n "$CIKTI" ]; then
  echo "HTTP $KOD → $CIKTI ($(wc -c < "$CIKTI" | tr -d ' ') bayt)"
else
  cat "$GOVDE"; echo
  echo "HTTP $KOD" >&2
fi
case "$KOD" in 2*) exit 0 ;; 401) echo "401: jeton sunucudakiyle AYNI değil." >&2; exit 5 ;; 503) echo "503: sunucuda OPS_SUMMARY_TOKEN tanımlı değil YA DA uç Mikro kimlik bilgisine ulaşamadı (gövdede notConfigured) — gövdeyi oku." >&2; exit 6 ;; *) exit 1 ;; esac
