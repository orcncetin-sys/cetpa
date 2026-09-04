#!/usr/bin/env bash
# tasarim-denetimi.sh — Tasarim sistemi disiplini denetimi.
#
# NEDEN VAR (2026-09-04 olcumu):
# Bu projede token sistemi ZATEN var ve calisiyor: `src/index.css` semantik
# degiskenler (--color-brand, --text-primary, --bg-surface ...) tanimlar ve
# `.dark` blogu Tailwind yardimci siniflarini `!important` ile bu tokenlara
# ESLER. Yani `text-gray-900` gibi 1.000+ kullanim karanlik temada kendiliginden
# duzelir — sifirdan uc katmanli bir token mimarisi kurmak bu calisan sistemi
# sokmek olurdu.
#
# GERCEK RISK OLCULDU, iki tane:
#   1. INLINE style ile renk: `.dark` eslemesi CSS SINIFLARINA bakar, inline
#      `style={{color:'#...'}}` en yuksek oncelige sahiptir ve eslesmeye
#      ULASILMAZ — karanlik temada okunmaz metin uretir.
#   2. Marka rengi elle yazimi: `#ff4000` kod tabaninda 400+ yerde geciyordu;
#      marka rengi degisirse hepsi tek tek bulunmali. Inline olanlar
#      `var(--color-brand)`a baglandi.
#
# Bu betik YENI eklenen ihlalleri yakalar; mevcut (sinif tabanli, eslenen)
# kullanimlari SORUN SAYMAZ — onlar tasarim geregi calisiyor.
#
# KULLANIM: scripts/tasarim-denetimi.sh          (calisma agaci)
#           scripts/tasarim-denetimi.sh HEAD~1   (bir commit'e karsi)
set -uo pipefail

KOK="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$KOK"
HEDEF="${1:-}"

if [ -n "$HEDEF" ]; then
  DOSYALAR=$(git diff "$HEDEF" --name-only -- 'src/*.tsx' 'src/**/*.tsx' 2>/dev/null || true)
  KAPSAM="$HEDEF sonrasi degisen dosyalar"
else
  DOSYALAR=$(git diff HEAD --name-only -- 'src/*.tsx' 'src/**/*.tsx' 2>/dev/null || true)
  [ -z "$DOSYALAR" ] && DOSYALAR=$(git ls-files 'src/*.tsx' 'src/**/*.tsx')
  KAPSAM="calisma agaci"
fi

[ -z "$DOSYALAR" ] && { echo "Denetlenecek .tsx dosyasi yok."; exit 0; }

echo "== Tasarim denetimi ($KAPSAM) =="
hata=0

# ── 1) Inline renk: karanlik temada eslesmeye ulasilamaz ──
# YAZDIRMA bilesenleri haric: etiket/fis ciktisi her zaman beyaz kagit uzerinedir,
# temaya gore DEGISMEMELIDIR (LabelSheetModal bilincli boyle).
inline=""
for f in $DOSYALAR; do
  [ -f "$f" ] || continue
  case "$f" in *LabelSheet*|*Print*|*Fis*) continue ;; esac
  bulunan=$(grep -nE "style=\{\{[^}]*(color|backgroundColor|borderColor): *'#[0-9a-fA-F]{3,8}'" "$f" 2>/dev/null || true)
  [ -n "$bulunan" ] && inline="$inline$f:\n$bulunan\n"
done
if [ -n "$inline" ]; then
  echo "FAIL  inline renk (karanlik tema eslemesi ULASAMAZ) — 'var(--token)' kullanin:"
  printf "$inline" | sed 's/^/      /'
  hata=1
else
  echo "PASS  inline renk yok (yazdirma bilesenleri haric tutuldu)"
fi

# ── 2) Marka rengi elle yazimi (yalniz YENI eklenen satirlarda) ──
if [ -n "$HEDEF" ] || ! git diff --quiet HEAD 2>/dev/null; then
  aralik="${HEDEF:-HEAD}"
  yeni_marka=$(git diff "$aralik" -- 'src/*.tsx' 'src/**/*.tsx' 2>/dev/null \
    | grep '^+' | grep -v '^+++' | grep -ciE '#ff4000' || true)
  if [ "${yeni_marka:-0}" -gt 0 ]; then
    echo "WARN  eklenen satirlarda $yeni_marka kez '#ff4000' — 'var(--color-brand)' ya da 'text-brand/bg-brand' tercih edin"
  else
    echo "PASS  eklenen satirlarda elle marka rengi yok"
  fi
fi

# ── 3) Karanlik tema eslemesinde OLMAYAN metin rengi sinifi ──
# index.css'te eslenen siniflar: text-gray-400..900 ve bilinen hex'ler.
eslenmemis=""
for f in $DOSYALAR; do
  [ -f "$f" ] || continue
  b=$(grep -ohE 'text-\[#[0-9a-fA-F]{6}\]' "$f" 2>/dev/null | sort -u || true)
  for sinif in $b; do
    hex=$(echo "$sinif" | grep -oE '#[0-9a-fA-F]{6}')
    grep -qi "$hex" src/index.css || eslenmemis="$eslenmemis  $f: $sinif\n"
  done
done
if [ -n "$eslenmemis" ]; then
  echo "WARN  karanlik tema eslemesinde OLMAYAN metin rengi (index.css .dark blogu):"
  printf "$eslenmemis"
  echo "      → index.css'e ekleyin ya da semantik sinif kullanin (text-gray-*)"
else
  echo "PASS  tum text-[#hex] siniflari karanlik tema eslemesinde"
fi

echo
[ "$hata" -eq 0 ] && echo "== tasarim denetimi: GECTI ==" || echo "== tasarim denetimi: BASARISIZ =="
exit "$hata"
