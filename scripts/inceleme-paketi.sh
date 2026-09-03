#!/usr/bin/env bash
# inceleme-paketi.sh — Kod incelemesi ajanları icin BAGLAM PAKETI uretir.
#
# NEDEN VAR (2026-09-04, olculdu):
# 366 ajan transkripti tarandi. Ajanlar dosyalari bastan sona OKUMUYOR (tam dosya
# okumasi tum Bash cagrilarinin %0.4'u) — asil israf KESFIN TEKRARI:
#   - tek bir inceleme kosusunda 29 ajan mikroRoutes.ts'i ayri ayri grepledi
#   - 26 ajan ayni review-diff dosyasini ayri ayri taradi
#   - ajan basina 17.7 arac cagrisi; HER cagri ajanin tum baglamini yeniden okutur
#     (1.1 milyar cache-read'in kaynagi budur, dosya icerigi degil)
#
# CLAUDE.md zaten "diff'i bir kez cikar, prompt'a GOM" diyordu; uygulanmiyordu
# cunku promptlara dosya YOLU veriliyordu, ICERIK degil. Bu betik icerigi
# dogrudan gomulebilir parcalara ayirir, boylece ajan kesif turu harcamaz.
#
# KULLANIM:
#   scripts/inceleme-paketi.sh                    # calisma agaci (push oncesi normal hal)
#   scripts/inceleme-paketi.sh .paket HEAD~1      # belirli bir commit'e karsi
#   scripts/inceleme-paketi.sh .paket main...HEAD # PR araligi
# URETTIKLERI:
#   OZET.md            → prompt'a AYNEN gomulecek dosya+sembol haritasi
#   tam.diff           → butun diff (yalniz gerekirse)
#   hunk/<dosya>.diff  → dosya basina izole hunk (ajana yalniz kendi payini ver)
set -euo pipefail

KOK="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HEDEF="${2:-HEAD}"

# Goreli cikti yolunu `cd "$KOK"`den ONCE cozeriz: aksi halde `. ` gibi bir argüman
# kullanicinin bulundugu dizine degil REPO KOKUNE cozulur ve asagidaki `rm -rf`
# calisma agacini (.git dahil) silerdi (2026-09-04 inceleme bulgusu).
CIKTI="${1:-$KOK/.cetpa-inceleme}"
case "$CIKTI" in /*) ;; *) CIKTI="$PWD/$CIKTI" ;; esac

cd "$KOK"

# rm -rf hedefini dogrula. IZIN LISTESI mantigi (yasak-listesi DEGIL): 2026-09-04
# hakem turu, yasak-listesinin `... src` veya `... scripts` gibi var olan repo
# dizinlerini hala sildigini kanitladi (uyarisiz, exit 0). Kural artik su: hedef
# ya HIC YOK, ya da BIZIM urettigimiz bir pakettir (OZET.md + hunk/ imzasi).
CIKTI_MUTLAK="$(cd "$(dirname "$CIKTI")" 2>/dev/null && pwd)/$(basename "$CIKTI")" || CIKTI_MUTLAK="$CIKTI"
CIKTI="$CIKTI_MUTLAK"
if [ -e "$CIKTI" ]; then
  if [ -f "$CIKTI/OZET.md" ] && [ -d "$CIKTI/hunk" ]; then
    rm -rf "$CIKTI"                      # onceki paket — guvenle degistirilebilir
  else
    echo "HATA: '$CIKTI' var ama bu betigin urettigi bir paket degil (OZET.md + hunk/ yok)." >&2
    echo "      Yanlislikla bir kaynak dizinini silmemek icin duruldu. Bos/yeni bir yol ver." >&2
    exit 2
  fi
fi
mkdir -p "$CIKTI/hunk"

# Calisma agaci + commit'lenmis fark birlikte: inceleme cogu zaman push oncesi kosar.
# (git add -N YALNIZ varsayilan modda: izlenmeyen dosyalar diff'e girsin diye.
#  Bir commit/aralik hedeflendiginde indekse dokunmayiz.)
# `git add -N` izlenmeyen dosyalari diff'e sokar AMA indekste intent-to-add kaydi
# birakir: sonrasinda `git commit -am` o gecici dosyalari da commit'e alir ve
# `git push = deploy` oldugu icin dogrudan canliya gider; `git stash` de kirilir.
# Bu yuzden diff'i aldiktan HEMEN SONRA indeksi eski haline dondururuz.
EKLENEN_YOLLAR=""
if [ "$HEDEF" = "HEAD" ]; then
  EKLENEN_YOLLAR="$(git ls-files --others --exclude-standard)"
  git add -N . >/dev/null 2>&1 || true
fi
geri_al() {
  if [ -n "${EKLENEN_YOLLAR:-}" ]; then
    printf '%s\n' "$EKLENEN_YOLLAR" | tr '\n' '\0' \
      | xargs -0 -r git reset -q -- >/dev/null 2>&1 || true
  fi
}
trap geri_al EXIT INT TERM

# core.quotePath=false: Turkce/aksanli dosya adlari aksi halde `"urun-\303\247.ts"`
# gibi TIRNAKLI ve oktal-kacisli gelir, sonraki `git diff -- "$f"` hicbir seyle
# eslesmez ve git 0 ile cikar → hunk SESSIZCE bos olur (2026-09-04 bulgusu).
git -c core.quotePath=false diff "$HEDEF" > "$CIKTI/tam.diff"

if [ ! -s "$CIKTI/tam.diff" ]; then
  echo "Diff bos — inceleyecek degisiklik yok." >&2
  exit 1
fi

DOSYALAR=$(git -c core.quotePath=false diff "$HEDEF" --name-only)
DOSYA_SAYISI=$(echo "$DOSYALAR" | grep -c . || true)
SATIR=$(wc -l < "$CIKTI/tam.diff" | tr -d ' ')

{
  echo "# Inceleme baglam paketi"
  echo
  echo "$DOSYA_SAYISI dosya, $SATIR satirlik diff. Asagidaki harita KESIF YERINE gecer:"
  echo "ajan bu tabloyu okuyup dogrudan ilgili hunk dosyasina gider, repo taramaz."
  echo
  echo "| Dosya | +/- | Degisen satir araliklari (yeni dosyada) | Hunk dosyasi |"
  echo "|---|---|---|---|"
} > "$CIKTI/OZET.md"

while IFS= read -r f; do
  [ -z "$f" ] && continue
  # DIZIN YAPISINI KORU: `tr '/' '_'` iki farkli yolu (`a/b.ts` ve `a_b.ts`) ayni
  # ada indiriyordu; ikinci hunk ilkini eziyor ve ajan SESSIZCE baska bir dosyanin
  # diff'ini okuyordu (2026-09-04 hakem bulgusu — "sessizce yanlis" arıza sinifi).
  guvenli="$f"
  mkdir -p "$CIKTI/hunk/$(dirname "$f")"
  git -c core.quotePath=false diff "$HEDEF" -- "$f" > "$CIKTI/hunk/$guvenli.diff" 2>/dev/null || continue

  # NOT: `grep -c` eslesme bulamazsa 1 doner; `set -euo pipefail` altinda bu
  # betigi SESSIZCE oldururdu (2026-09-04'te tam bunu yasadik). awk hic fail etmez.
  # SAYIM DESENI — iki kez yanlis yazildi, ucuncude olculdu:
  #   `/^\+[^+]/`            → eklenen BOS satiri ve `++i;` satirini kacirdi
  #   `/^\+/ && !/^\+\+\+/`  → `++i;` diff'te `+++i;` olur, bu desen onu da disladi
  # Dogrusu: git basligi HER ZAMAN "+++ " / "--- " (uc isaret + BOSLUK) bicimindedir;
  # yalnizca onu disla, kalan her +/- satirini say.
  ekle=$(awk '/^\+/ && !/^\+\+\+ /{n++} END{print n+0}' "$CIKTI/hunk/$guvenli.diff")
  sil=$(awk '/^-/ && !/^--- /{n++} END{print n+0}' "$CIKTI/hunk/$guvenli.diff")
  toplam_hunk=$(awk '/^@@ /{n++} END{print n+0}' "$CIKTI/hunk/$guvenli.diff")

  # SEMBOL DEGIL, SATIR ARALIGI: hunk basligindaki "@@ ... @@ <baglam>" React
  # dosyalarinda her zaman dosyanin kok bilesenini ("export default function
  # OrdersPage") gosterdigi icin ise yaramiyordu. Ajanin ihtiyaci olan sey YENI
  # dosyadaki satir araliklari — dogrudan `sed -n 'BAS,SONp'` ile acar.
  araliklar=$(awk '
    /^@@ / {
      if (match($0, /\+[0-9]+(,[0-9]+)?/)) {
        spec = substr($0, RSTART+1, RLENGTH-1)
        split(spec, p, ",")
        uz = (p[2] == "" ? 1 : p[2]); if (uz < 1) uz = 1
        if (++n <= 8) printf "%s%s-%s", (n>1 ? ", " : ""), p[1], p[1]+uz-1
      }
    }' "$CIKTI/hunk/$guvenli.diff")
  [ -z "$araliklar" ] && araliklar='—'
  [ "$toplam_hunk" -gt 8 ] && araliklar="$araliklar … (+$((toplam_hunk-8)) hunk daha)"

  echo "| \`$f\` | +$ekle/-$sil | $araliklar | \`hunk/$guvenli.diff\` |" >> "$CIKTI/OZET.md"
done <<< "$DOSYALAR"

{
  echo
  echo "## Ajana verilecek talimat kalibi"
  echo
  echo "> Kapsam ASAGIDAKI hunk'tir; repoyu tarama, dosyayi bastan sona okuma."
  echo "> Yalniz bir iddiayi DOGRULAMAK icin kaynak dosyanin ilgili araligini ac"
  echo "> (\`sed -n 'BAS,SONp'\`). Kesif turu harcama — harita yukarida."
} >> "$CIKTI/OZET.md"

echo "Paket hazir: $CIKTI"
echo "  OZET.md   : $(wc -l < "$CIKTI/OZET.md" | tr -d ' ') satir (prompt'a gomulecek)"
echo "  hunk/     : $(ls -A "$CIKTI/hunk" | wc -l | tr -d ' ') dosya"   # -A: nokta ile baslayan hunk adlari da sayilsin
echo "  tam.diff  : $SATIR satir"
