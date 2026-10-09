#!/usr/bin/env bash
# Deploy doğrulama — deploy-verify skill'inin script yarısı.
#
#   scripts/verify-deploy.sh pre             # push ÖNCESİ: tsc + boot + ps1 ASCII
#   scripts/verify-deploy.sh post [range]    # push SONRASI: CI + canlı sağlık + yeni route 401
#   scripts/verify-deploy.sh ci              # yalnız yayın işi (post'un 1. adımı): gönderilen commit'in CI & Deploy işini bekler
#
# range verilmezse <origin/main'in bu makinede bilinen ÖNCEKİ ucu>...origin/main kullanılır
# (fetch'ten ÖNCE SHA'ya çözülür; araya başka push girdiyse o commit'ler de aralığa girer, zararsız).
# Çözülemezse (taze klon) rota denetimi KOŞMAZ ve FAIL verir; aralığı elle ver.
set -u
BASE_URL="${BASE_URL:-https://app.cetpa.com.tr}"
PHASE="${1:-post}"
FAIL=0
pass() { printf 'PASS  %s\n' "$1"; }
fail() { printf 'FAIL  %s\n' "$1"; FAIL=1; }

cd "$(dirname "$0")/.." || exit 1

# ── CI denetimi: doğrulanan commit'in KENDİ yayın işi ────────────────────────
# 2026-10-08'e kadar `gh run list --limit 1` ile depodaki EN SON işe bakılıyordu. O gün aynı gönderimin
# ardından koşan «Dependabot Updates» işi (success) «PASS CI run …» diye yazıldı; yayın işi kırık olsa da
# bu satır yeşil kalırdı (aynı gönderimde CodeQL işi de koşar). Artık iş dört süzgeçle seçilir:
#   iş akışı DOSYASI (ad değil: ad değişebilir) + main dalı + PUSH olayı + hedef commit.
# Hedef commit UZAK main'in ucudur: yerel origin/main bayatsa eski commit'in eski (yeşil) işi bulunurdu. Ayrıca bu
# çalışma ağacının HEAD'i uzak main'de olmalı (eşit ya da atası): gönderim reddedildiyse / yapılmadıysa uzak main bir
# ÖNCEKİ gönderimdir ve onun çoktan bitmiş yeşil işi «PASS» diye yazılırdı (2026-10-08 incelemesi).
# İş kaydı gönderimden birkaç saniye SONRA oluşur; bulunana kadar yoklanır (varsayılan 18 × 5 sn = en çok 90 sn).
# Koşu yeşil olsa da yayın ADIMI atlanmış olabilir: VDS_SSH_KEY yoksa ci.yml yayın adımlarını `if:` ile atlar ve iş yine
# success biter; bu yüzden PASS'ten önce adımın sonucu okunur (adım / iş adları ci.yml ile birebir, testte çitli).
CI_DOSYASI="ci.yml"
CI_YAYIN_ISI="Deploy to Windows VDS"
CI_YAYIN_ADIMI="Deploy (SSH → PowerShell)"
CI_ARAMA_DENEME="${CI_ARAMA_DENEME:-18}"
CI_ARAMA_ARALIK="${CI_ARAMA_ARALIK:-5}"
# $1 = kip (ci | post). Aralığa dayalı kontroller yalnız `post`ta koşar: bayat yerel ref orada FAIL, `ci`de bilgi.
ci_denetimi() {
  local kip="$1" uzak yerel hedef kisa is deneme bas yayin
  # Önce taze ref: karşılaştırma ve `merge-base` fetch'ten SONRA yapılsın (başarısızsa yerel bilgiyle sürer).
  git fetch -q origin main 2>/dev/null || true
  uzak=$(git ls-remote origin refs/heads/main 2>/dev/null | cut -f1)
  yerel=$(git rev-parse --verify -q origin/main 2>/dev/null)
  hedef="${uzak:-$yerel}"
  if [ -z "$hedef" ]; then
    fail "CI: hedef commit çözülemedi (git ls-remote origin ve yerel origin/main ikisi de boş)"
    return
  fi
  kisa="${hedef:0:7}"
  if [ -z "$uzak" ]; then
    # Hedef DOĞRULANAMADI: yerel ref bayatsa eski commit'in eski yeşil işi izlenir; bu yüzden bilgi değil FAIL.
    fail "CI: uzak main okunamadı (git ls-remote origin); hedef doğrulanamadı, yerel origin/main ($kisa) kullanıldı"
  elif [ -n "$yerel" ] && [ "$uzak" != "$yerel" ]; then
    if [ "$kip" = post ]; then
      fail "yerel origin/main (${yerel:0:7}) uzak main ($kisa) ile aynı değil — git fetch origin, sonra yeniden koş"
    else
      echo "  --  CI: yerel origin/main (${yerel:0:7}) uzak main ($kisa) gerisinde; bu kip yalnız uzak ucu kullanır"
    fi
  fi
  bas=$(git rev-parse --verify -q HEAD 2>/dev/null)
  if [ -n "$bas" ] && ! git merge-base --is-ancestor "$bas" "$hedef" 2>/dev/null; then
    fail "HEAD (${bas:0:7}) uzak main'de ($kisa) YOK — gönderim ulaştı mı? (reddedildiyse uzak main önceki gönderimdir)"
  fi
  is=""
  deneme=0
  while [ "$deneme" -lt "$CI_ARAMA_DENEME" ]; do
    # gh'nin KENDİSİ çalışmadıysa (oturum yok, ağ, iş akışı dosyası bulunamadı) boş liste sayılmaz: beklemeden düşer.
    if ! is=$(gh run list --workflow "$CI_DOSYASI" --branch main --event push --commit "$hedef" --limit 1 --json databaseId -q '.[0].databaseId // empty' 2>/dev/null); then
      fail "CI: gh çalışmadı ($CI_DOSYASI, $kisa) — gh auth status ile incele"
      return
    fi
    [ -n "$is" ] && break
    deneme=$((deneme + 1))
    if [ "$deneme" -lt "$CI_ARAMA_DENEME" ]; then sleep "$CI_ARAMA_ARALIK"; fi
  done
  if [ -z "$is" ]; then
    fail "CI: $kisa için $CI_DOSYASI işi bulunamadı — gönderim main'e ulaştı mı? (gh run list --workflow $CI_DOSYASI --commit $hedef)"
  elif gh run watch "$is" --exit-status >/dev/null 2>&1; then
    yayin=$(gh run view "$is" --json jobs -q ".jobs[] | select(.name == \"$CI_YAYIN_ISI\") | .steps[] | select(.name == \"$CI_YAYIN_ADIMI\") | .conclusion" 2>/dev/null)
    if [ "$yayin" = success ]; then
      pass "CI & Deploy işi $is ($kisa): yayın adımı koştu"
    else
      fail "CI & Deploy işi $is ($kisa) yeşil ama yayın adımı KOŞMADI (adım sonucu: ${yayin:-okunamadı}) — sunucuya kod gitmedi"
    fi
  else
    fail "CI & Deploy işi $is ($kisa) başarısız ya da izlenemedi — gh run view $is ile incele"
  fi
}

if [ "$PHASE" = ci ]; then
  ci_denetimi ci

elif [ "$PHASE" = pre ]; then
  # IZLENMEYEN (yeni) DOSYALAR DA DAHIL — 2026-08-24'te bulundu.
  # Eskiden yalnizca `git diff` kullaniliyordu; heniiz `git add` edilmemis YENI
  # bir .ps1 dosyasi listeye HIC girmiyor ve ASCII kapisi sessizce atlaniyordu
  # (PS1_FILES bos -> kontrol calismiyor -> "TUM KONTROLLER GECTI" yaziyor).
  # Yeni dosya, ASCII disi karakterin en cok girdigi yerdir; tam da orada
  # korumasizdik.
  CHANGED=$(
    git diff --name-only origin/main...HEAD 2>/dev/null
    git diff --name-only HEAD 2>/dev/null
    git ls-files --others --exclude-standard 2>/dev/null
  )

  # 1) Tip kontrolü
  if npx tsc --noEmit >/tmp/verify-tsc.log 2>&1; then
    pass "tsc --noEmit"
  else
    fail "tsc --noEmit ($(grep -c 'error TS' /tmp/verify-tsc.log) hata — /tmp/verify-tsc.log)"
  fi

  # 2) .ps1 salt-ASCII (PowerShell 5.1 + Windows-1252: em-dash/Türkçe karakter parse'ı kırar)

# ── Tasarim sistemi disiplini (2026-09-04) ───────────────────────────────────
# Inline renk karanlik tema eslemesine ULASAMAZ; yeni eklenen bir tanesi
# okunmaz metin uretir ve kimse fark etmez. Uyarilar (WARN) deploy'u DURDURMAZ,
# yalniz FAIL durdurur — mevcut kod tabanini yeniden yazmaya zorlamaz.
if [ -x scripts/tasarim-denetimi.sh ]; then
  if scripts/tasarim-denetimi.sh >/tmp/tasarim-denetimi.log 2>&1; then
    pass "tasarim denetimi (inline renk / marka rengi / tema eslemesi)"
  else
    fail "tasarim denetimi — $(grep -c '^FAIL' /tmp/tasarim-denetimi.log) ihlal (/tmp/tasarim-denetimi.log)"
  fi
fi
  PS1_FILES=$(printf '%s\n' "$CHANGED" | grep '\.ps1$' | sort -u)
  if [ -n "$PS1_FILES" ]; then
    # NOT: burada `grep -nP` vardı. -P (PCRE) macOS/BSD grep'te YOK; komut
    # "invalid option -- P" ile hata verip BOŞ çıktı üretiyordu, yani kontrol
    # geliştirici makinesinde HER ZAMAN "PASS" diyordu ve ASCII dışı karakteri
    # asla yakalamazdı (2026-08-11'de bulundu). Bracket ifadesi taşınabilir:
    # BSD ve GNU grep'te aynı çalışır.
    NONASCII=$(printf '%s\n' "$PS1_FILES" | while read -r f; do
      [ -f "$f" ] && LC_ALL=C grep -n '[^ -~	]' "$f" /dev/null
    done)
    if [ -z "$NONASCII" ]; then pass "ps1 salt-ASCII"; else fail "ps1 ASCII dışı karakter:
$NONASCII"; fi
  else
    # SESSIZ ATLAMA YOK: "kontrol edilecek .ps1 yok" ile "kontrol gecti" ayni
    # gorunmemeli. Ozette gorunsun ki bir dahaki sefere kapinin calisip
    # calismadigi belli olsun.
    echo "  --  ps1 salt-ASCII: degisen .ps1 yok, atlandi"
  fi

  # 3) server.ts değiştiyse lokal boot testi (build server'ı derlemez — tek kanıt boot)
  if printf '%s\n' "$CHANGED" | grep -q '^server\.ts$'; then
    PORT=5596 npx tsx server.ts >/tmp/verify-boot.log 2>&1 &
    BOOT_PID=$!
    BOOT_OK=0
    for _ in $(seq 1 30); do
      sleep 1
      if curl -sf "http://localhost:5596/api/health" >/dev/null 2>&1; then BOOT_OK=1; break; fi
    done
    kill "$BOOT_PID" 2>/dev/null; wait "$BOOT_PID" 2>/dev/null
    if [ "$BOOT_OK" = 1 ]; then pass "server.ts lokal boot (/api/health 200)"; else fail "server.ts lokal boot — log: /tmp/verify-boot.log"; fi
  fi

else
  # Eski yazım `${2:-origin/main@{1}...origin/main}`: bash ilk `}`de kapatıyordu, aralık `origin/main@{1...origin/main}`
  # oluyordu (tek revizyon + reflog TARİH seçicisi; çalışma ağacına karşı fark) ve açık aralık verilince sonuna
  # `...origin/main}` yapışıyordu (git 128 → rota denetimi sessizce PASS). 2026-10-08 incelemesi.
  # Varsayılanın SOL ucu fetch'ten ÖNCE SHA'ya çözülür: `ci_denetimi` içindeki fetch, araya yabancı push girdiyse
  # origin/main'i taşır ve reflog'a satır yazar; o zaman `origin/main@{1}` bu makinenin push'u olur ve bu push'un kendi
  # commit'leri aralık dışı kalırdı (2026-10-09 ölçümü). Çözülemezse (taze klon) aralık boş → rota denetimi FAIL.
  if [ -n "${2:-}" ]; then
    RANGE="$2"
  else
    ONCEKI=$(git rev-parse -q --verify 'origin/main@{1}' 2>/dev/null) || ONCEKI=""
    RANGE="${ONCEKI:+$ONCEKI...origin/main}"
  fi

  # 1) CI çalışmasını bekle — gönderilen commit'in KENDİ yayın işi (yukarıda `ci_denetimi`; taze fetch orada)
  ci_denetimi post

  # 2) Canlı sağlık: status ok + postgres (docs tablosundan gerçek okuma) + taze restart.
  #    Yeşil CI tek başına kanıt değil — uptime resetlenmediyse eski kod çalışıyordur.
  H=$(curl -sf --max-time 20 "$BASE_URL/api/health")
  if [ -n "$H" ]; then
    PARSED=$(printf '%s' "$H" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(int(d.get("uptime",10**9)), d.get("status"), d.get("postgres"))' 2>/dev/null)
    read -r UP STATUS PG <<<"$PARSED"
    [ "${STATUS:-}" = ok ] && pass "health status=ok" || fail "health status=${STATUS:-?}"
    [ "${PG:-}" = True ] && pass "postgres canlı okuma (docs)" || fail "postgres=${PG:-?} — docs tablosu okunamıyor"
    if [ "${UP:-999999}" -lt 600 ]; then pass "taze restart (uptime ${UP}s)"; else fail "uptime ${UP}s — deploy restart etmemiş olabilir"; fi
  else
    fail "health erişilemedi: $BASE_URL/api/health"
  fi

  # 2b) KİMLİK DOĞRULAMA ZİNCİRİ CANLI MI? (kimlik bilgisi GEREKTİRMEZ)
  #
  # NEDEN VAR: 2026-08-18'de firebase-admin 13 -> 14 yükseltildi ve v14
  # namespace API'sini kaldırdığı için auth yolu (admin.auth() -> getAuth())
  # baştan yazıldı. verify-deploy bunu HİÇ test etmiyordu — yalnız "401
  # dönüyor mu" bakıyordu, ki bu başlık yokken firebase'e hiç uğramadan da
  # dönüyor. Yükseltmeyi kullanıcıya ELLE doğrulatmak zorunda kaldık.
  #
  # Hile şu: iki farklı 401'in MESAJI farklı.
  #   başlık yok      -> "Missing Authorization header."  (firebase'e uğramaz)
  #   geçersiz token  -> "Invalid or expired token."      (verifyIdToken ÇALIŞTI)
  # İkinci mesaj, Firebase Admin'in gerçekten yüklü ve token doğrulayabilir
  # durumda olduğunun kanıtıdır. Kimlik bilgisi saklamaya gerek yok.
  AUTH_URL="$BASE_URL/api/ops/runtime"
  AUTH_BODY=$(curl -s -k --max-time 20 -H "Authorization: Bearer gecersiz.token.degeri" "$AUTH_URL" 2>/dev/null)
  AUTH_CODE=$(curl -s -k --max-time 20 -o /dev/null -w '%{http_code}' -H "Authorization: Bearer gecersiz.token.degeri" "$AUTH_URL" 2>/dev/null)
  case "$AUTH_BODY" in
    *"Invalid or expired token"*)
      pass "auth zinciri canlı (geçersiz token -> $AUTH_CODE, verifyIdToken çalıştı)" ;;
    *"Missing Authorization"*)
      fail "auth zinciri: token GÖRÜLMEDİ — istek firebase'e hiç ulaşmamış" ;;
    *)
      fail "auth zinciri: beklenmeyen yanıt ($AUTH_CODE) — Firebase Admin bozuk olabilir: ${AUTH_BODY:0:120}" ;;
  esac

  # 3) Bu push'ta EKLENEN requireAuth'lu route'lar auth'suz 401/403 dönmeli.
  #    404 = route deploy'a hiç girmemiş demektir.
  #    Boş fark ile git HATASI aynı şey değil: aralık yazımı bozuksa denetim koşmamıştır, PASS yazılmaz.
  ROUTE_DENETIMI=1
  if [ -z "$RANGE" ]; then
    fail "yeni korumalı route denetimi KOŞMADI: reflog'da origin/main@{1} yok (taze klon?) — aralığı elle ver: post '<önce>...origin/main'"
    ROUTE_DENETIMI=0
    ROUTES=""
  elif ! ROUTE_FARKI=$(git diff "$RANGE" -- server.ts 2>/dev/null); then
    fail "yeni korumalı route denetimi KOŞMADI: git diff '$RANGE' başarısız (aralık yazımı?)"
    ROUTE_DENETIMI=0
    ROUTES=""
  else
    ROUTES=$(printf '%s\n' "$ROUTE_FARKI" | grep '^+' \
      | grep -oE "app\.(get|post|put|delete|patch)\('/api/[^']+'[^)]*requireAuth" \
      | sed -E "s/app\.([a-z]+)\('([^']+)'.*/\1 \2/" | sort -u)
  fi
  if [ "$ROUTE_DENETIMI" = 0 ]; then
    :
  elif [ -z "$ROUTES" ]; then
    pass "yeni korumalı route yok (range: $RANGE)"
  else
    while read -r METHOD RPATH; do
      [ -z "$METHOD" ] && continue
      URL="$BASE_URL$(printf '%s' "$RPATH" | sed 's/:[A-Za-z_]*/test/g')"
      # -d '' : gövdesiz POST/PUT nginx'ten 411 Length Required yer; boş gövde
      # Content-Length: 0 gönderir ve istek requireAuth'a ulaşır.
      if [ "$METHOD" = get ]; then
        CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$URL")
      else
        CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 -X "$(printf '%s' "$METHOD" | tr '[:lower:]' '[:upper:]')" -d '' "$URL")
      fi
      # 000 = baglanti/zaman asimi. 77 ucu pes pese yagdirinca IIS/ARR kuyruguna
      # takilip nadiren 15 sn'yi asiyor; tek tek denendiginde ayni uc 401 donuyor.
      # Bir kez daha dene: gercekten bozuk bir uc iki denemede de 000 verir,
      # ani yuk kaynakli tek seferlik takilma elenir. Kapinin sikiligi korunur.
      if [ "$CODE" = 000 ]; then
        sleep 2
        if [ "$METHOD" = get ]; then
          CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 25 "$URL")
        else
          CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 25 -X "$(printf '%s' "$METHOD" | tr '[:lower:]' '[:upper:]')" -d '' "$URL")
        fi
      fi
      case "$CODE" in
        401|403) pass "route $METHOD $RPATH -> $CODE (korumalı + yüklü)" ;;
        404)     fail "route $METHOD $RPATH -> 404 (deploy'da YOK)" ;;
        429)     fail "route $METHOD $RPATH -> 429 (hız sınırı: bu IP son 15 dk'da kimliksiz tavanı doldurdu — bekleyip yeniden çalıştırın; rota bozuk demek DEĞİL)" ;;
        000)     fail "route $METHOD $RPATH -> yanıt yok (2 denemede de zaman aşımı)" ;;
        *)       fail "route $METHOD $RPATH -> $CODE (401/403 bekleniyordu)" ;;
      esac
    done <<<"$ROUTES"
  fi

  # 4) GÖVDE AYRIŞTIRMA ZİNCİRDE Mİ? (2026-08-24'te CANLIYI KIRAN hata)
  #
  # Rota grupları modüllere taşınırken `mikroRoutes(app, ...)` çağrısı yanlışlıkla
  # `app.use(express.json(...))` ve `app.use([...], mikroLimiter)` SATIRLARINDAN
  # ÖNCE konuldu. Express'te app.use yalnız KENDİNDEN SONRA kaydedilen rotalara
  # uygulanır; sonuçta 21 Mikro rotasının hiçbirinde req.body yoktu (her POST
  # kırık) ve hız sınırlaması da devre dışıydı.
  #
  # Yukarıdaki 401 kontrolü bunu GÖREMEZ: requireAuth gövdeye bakmadan
  # reddediyor, yani 401 yalnızca "auth önde" der — ara katman zinciri hakkında
  # hiçbir şey söylemez.
  #
  # AYIRT EDİCİ (kimlik gerektirmez, ölçüldü):
  #   express.json ZİNCİRDE  -> bozuk JSON gövdesi parse hatası verir (400/500)
  #   express.json ZİNCİRDE DEĞİL -> istek auth'a düşer ve 401 döner
  # Yani korumalı bir POST ucuna BOZUK JSON gönderip 401 alıyorsak zincir kırık.
  # HER AYRILAN GRUP ICIN AYRI SONDA. Tek sonda yetmez: her rota grubu KENDI
  # `xRoutes(app, ...)` cagrisiyla kaydolur ve o cagri zincirde yanlis yere
  # konabilir. 2026-08-24'te kirilan yalniz mikro grubuydu; digerleri dogruydu
  # ve tek sondali kontrol bu farki goremezdi.
  BODY_PROBES="${VERIFY_BODY_PROBE:-/api/mikro/gelen-fatura/kabul /api/tracking/fedex /api/ops/watchdog/run /api/dynamics/export/siparis /api/superadmin/tenants/test/status /api/parasut/import/stok /api/ai/lead-score /api/shopify/sync /api/iyzico/payment-link /api/email/send}"
  for BODY_PROBE in $BODY_PROBES; do
    PCODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 25 \
      -X POST -H 'Content-Type: application/json' --data-binary '{bozuk' \
      "$BASE_URL$BODY_PROBE" 2>/dev/null || echo 000)
    case "$PCODE" in
      400|500) pass "gövde ayrıştırma zincirde: $BODY_PROBE (bozuk JSON -> $PCODE)" ;;
      401|403) fail "GÖVDE AYRIŞTIRMA ZİNCİRDE DEĞİL: $BODY_PROBE bozuk JSON'a $PCODE döndü.
      express.json/rate-limit app.use'ları bu rotadan SONRA kayıtlı olabilir —
      rota kaydı ara katmanlardan ÖNCE yapılmış demektir. req.body undefined
      olacağı için bu grubun TÜM POST uçları kırıktır." ;;
      404)     fail "$BODY_PROBE -> 404: rota deploy'da YOK (grup hiç kaydolmamış olabilir)" ;;
      429)     fail "$BODY_PROBE -> 429 (hız sınırı: bu IP kimliksiz tavanı doldurdu — bekleyip yeniden çalıştırın)" ;;
      *)       fail "gövde ayrıştırma sondası beklenmedik yanıt: $PCODE ($BODY_PROBE)" ;;
    esac
  done

  # 5) HIZ SINIRI IP BAŞINA MI SAYIYOR? (2026-10-08'de canlıda ölçülen arıza)
  #
  # IIS / ARR X-Forwarded-For'a istemciyi 'IP:kapı' diye yazar. Kapı ayıklanmazsa
  # her yeni TCP bağlantısı TAZE kova alır: üç ayrı bağlantıda ratelimit-remaining
  # üçü de 299 çıkıyordu — bağlantıyı yenileyen istemci hiçbir sınıra takılmıyordu.
  #
  # AYIRT EDİCİ (kimlik gerektirmez): üç AYRI curl çağrısı (= üç ayrı bağlantı)
  # aynı IP kovasını tüketmeli, yani kalan hak her çağrıda AZALMALI.
  #   IP başına sayıyor      -> 3 değer kesin azalan (ör. 291 290 289)
  #   bağlantı başına sayıyor -> 3 değer de aynı (299 299 299)
  #   kova DOLU (429 / kalan 0) -> ölçülemedi: kova dolabildiğine göre sayım zaten
  #                               bağlantı başına DEĞİL; 15 dk sonra yeniden çalıştırılır
  RL=""; RLKOD=""
  for _ in 1 2 3; do
    H=$(curl -s -o /dev/null -D - --max-time 20 "$BASE_URL/api/health" 2>/dev/null | tr -d '\r')
    R=$(printf '%s\n' "$H" | awk 'tolower($1)=="ratelimit-remaining:"{print $2}')
    K=$(printf '%s\n' "$H" | awk '/^HTTP\//{k=$2} END{print k}')
    RL="$RL ${R:-yok}"; RLKOD="$RLKOD ${K:-yok}"
  done
  set -- $RL
  RLSAYI=0
  printf '%s%s%s' "${1:-}" "${2:-}" "${3:-}" | grep -Eq '^[0-9]+$' && [ "$#" -eq 3 ] && RLSAYI=1
  if [ "$RLSAYI" = 1 ] && [ "$1" -gt "$2" ] && [ "$2" -gt "$3" ]; then
    pass "hız sınırı IP başına sayıyor (ayrı bağlantılarda kalan hak:$RL)"
  elif printf '%s' "$RLKOD" | grep -q '429' || { [ "$RLSAYI" = 1 ] && [ "$3" -eq 0 ]; }; then
    fail "hız sınırı sondası ÖLÇÜLEMEDİ: bu IP kimliksiz tavanı doldurdu (kalan hak:$RL · yanıt:$RLKOD) —
      15 dk bekleyip yeniden çalıştırın. Kova dolabildiğine göre sayım bağlantı başına DEĞİL
      (öyle olsa taze bağlantı dolu kova görmezdi); bu satır düzeltmenin bozulduğunu GÖSTERMEZ."
  elif [ "$RLSAYI" != 1 ]; then
    fail "hız sınırı sondası ÖLÇÜLEMEDİ: ratelimit-remaining başlığı okunamadı (kalan hak:$RL · yanıt:$RLKOD) —
      /api/health genel sınırlayıcıdan geçmiyor ya da vekil başlığı düşürüyor; sayım hakkında HÜKÜM YOK."
  else
    fail "HIZ SINIRI IP BAŞINA SAYMIYOR: üç ayrı bağlantıda kalan hak:$RL (kesin azalan bekleniyordu).
      Hepsi aynıysa kova bağlantı başına (istemci adresinden kapı ayıklanmıyor —
      server.ts'te temizIstemciIp ara katmanı ve src/server/istemciIp.ts)."
  fi

  # 6) MAĞAZA UÇLARI (www.cetpa.com.tr → POST /api/magaza/*) — zincir doğru yerde mi?
  #
  # Mağaza yanıtı OKUMAZ: uç bozuksa talep sessizce kaybolur, kimse görmez. Zincir
  # kimliksizdir, bu yüzden dışarıdan ölçülebilir. Beş ayırt edici (hiçbiri kayıt
  # YAZMAZ, e-posta göndermez):
  #   ön uçuş (izinli köken)   -> 204 + Access-Control-Allow-Origin
  #                               (başlık yoksa tarayıcı POST'u HİÇ göndermez; IIS'in
  #                               OPTIONS'ı kendisi yanıtlaması da böyle görünür)
  #   kökensiz POST            -> 403 (köken kapısı çalışıyor)
  #   izinli köken + bozuk JSON -> 400 (500 = zincirin hata yakalayıcısı devrede değil,
  #                               gövde genel yakalayıcıya düşüyor; 401/404 = zincir bağlı değil)
  #   durum ucu                -> 503 + "hazir-degil" (dilim 2'ye kadar; mağaza sayfası
  #                               bu yanıtta «WhatsApp'tan sorun» der)
  #   izinli köken + şemaya uyan ama telefonu 10 rakamsız gövde
  #                            -> 400 (pg havuzu var ve kiracı çözülüyor; 503 = uç GERÇEK
  #                               talepleri düşürüyor — öbür dört sonda bu durumda da geçer,
  #                               çünkü hiçbiri kiracı çözümüne kadar ilerlemez)
  # Sunucuda MAGAZA_IZINLI_KOKENLER farklıysa: MAGAZA_KOKEN=<köken> scripts/verify-deploy.sh post
  MK="${MAGAZA_KOKEN:-https://www.cetpa.com.tr}"
  MU="$BASE_URL/api/magaza"
  OPT=$(curl -s -o /dev/null -D - --max-time 20 -X OPTIONS -H "Origin: $MK" \
    -H "Access-Control-Request-Method: POST" -H "Access-Control-Request-Headers: content-type" \
    "$MU/siparis-talebi" 2>/dev/null | tr -d '\r')
  OPTKOD=$(printf '%s\n' "$OPT" | awk '/^HTTP\//{k=$2} END{print k}')
  OPTACAO=$(printf '%s\n' "$OPT" | awk 'tolower($1)=="access-control-allow-origin:"{print $2}')
  if [ "$OPTKOD" = "204" ] && [ "$OPTACAO" = "$MK" ]; then
    pass "mağaza ön uçuşu: 204 + Access-Control-Allow-Origin ($MK)"
  elif [ "$OPTKOD" = "429" ]; then
    fail "mağaza ön uçuşu ÖLÇÜLEMEDİ: 429 (bu IP sel korumasına takıldı — bekleyip yeniden çalıştırın)"
  else
    fail "mağaza ön uçuşu: beklenen 204 + Access-Control-Allow-Origin: $MK — gelen kod '${OPTKOD:-yok}', başlık '${OPTACAO:-yok}'.
      Başlık yoksa tarayıcı talebi HİÇ göndermez. Kod 200/404 ve başlık yoksa OPTIONS'ı IIS yanıtlıyor ya da
      zincir bağlı değil (server.ts: app.use('/api/magaza', magazaZinciri(…)) genel sınırlayıcıdan ÖNCE olmalı)."
  fi
  M1=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 -X POST -H "Content-Type: application/json" -d '{}' "$MU/siparis-talebi" 2>/dev/null)
  case "$M1" in
    403) pass "mağaza köken kapısı: kökensiz POST -> 403" ;;
    429) fail "mağaza köken kapısı ÖLÇÜLEMEDİ: 429 (bekleyip yeniden çalıştırın)" ;;
    *)   fail "mağaza köken kapısı: kökensiz POST beklenen 403, gelen $M1 (201/400 = köken kapısı çalışmıyor; 401/404 = zincir bağlı değil)" ;;
  esac
  M2=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 -X POST -H "Origin: $MK" -H "Content-Type: application/json" -d '{' "$MU/siparis-talebi" 2>/dev/null)
  case "$M2" in
    400) pass "mağaza gövde ayrıştırma: bozuk JSON -> 400 (zincirin kendi ayrıştırıcısı ve hata yakalayıcısı)" ;;
    403) fail "mağaza gövde sondası: 403 — '$MK' sunucuda izinli köken değil (MAGAZA_IZINLI_KOKENLER); MAGAZA_KOKEN ile doğru kökeni verin" ;;
    429) fail "mağaza gövde sondası ÖLÇÜLEMEDİ: 429 (bekleyip yeniden çalıştırın)" ;;
    500) fail "mağaza gövde ayrıştırma: bozuk JSON -> 500. Zincir genel gövde ayrıştırıcıdan SONRA bağlanmış ya da zincirin hata
      yakalayıcısı devrede değil; hata genel yakalayıcıya düşüyor (günlüğe gövde parçası yazar)." ;;
    *)   fail "mağaza gövde sondası beklenmedik yanıt: $M2" ;;
  esac
  M3=$(curl -s --max-time 20 -w '\n%{http_code}' -X POST -H "Origin: $MK" -H "Content-Type: application/json" -d '{}' "$MU/siparis-durumu" 2>/dev/null)
  M3KOD=$(printf '%s\n' "$M3" | tail -n 1)
  if [ "$M3KOD" = "503" ] && printf '%s' "$M3" | grep -q 'hazir-degil'; then
    pass "mağaza durum ucu: 503 hazir-degil (dilim 2'ye kadar beklenen)"
  elif [ "$M3KOD" = "429" ]; then
    fail "mağaza durum ucu ÖLÇÜLEMEDİ: 429 (bekleyip yeniden çalıştırın)"
  else
    fail "mağaza durum ucu: beklenen 503 + hazir-degil, gelen $M3KOD (404 mağaza sayfasında «talep bulunamadı» diye görünür)"
  fi
  # Talep yolu: şemaya uyan ama telefonu 10 rakamsız gövde. Ret kiracı çözümünden SONRA gelir (talepEsle), INSERT'ten ÖNCE:
  #   400 = pg havuzu var ve kiracı çözülüyor · 503 = uç gerçek talepleri düşürüyor. Kayıt YAZMAZ, e-posta göndermez.
  # SINIRI: yalnız «havuz nesnesi var + kiracı çözülüyor»u kanıtlar; INSERT'in çalıştığını (docs tablosu, yetki) kanıtlamaz.
  # Şemaya telefon alt sınırı eklenirse bu sonda kiracıdan ÖNCE 400 alır ve yanlış PASS'e döner — aynı gövdenin kiracı boşken
  # 503, doluyken 400 döndüğünü src/server/routes/magazaRoutes.test.ts kilitler.
  M4=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 -X POST -H "Origin: $MK" -H "Content-Type: application/json" \
    -d '{"no":"T000000-AAAA","musteri":{"ad":"sonda","telefon":"0"},"kalemler":[{"ad":"sonda","adet":1}]}' "$MU/siparis-talebi" 2>/dev/null)
  case "$M4" in
    400) pass "mağaza talep yolu: pg havuzu var, kiracı çözülüyor (10 rakamsız telefon -> 400; kayıt yazılmadı)" ;;
    503) fail "MAĞAZA UCU TALEPLERİ DÜŞÜRÜYOR: şemaya uyan gövde -> 503. Kiracı çözülemiyor (SERVER_TENANT_COMPANY_ID tanımlı mı?)
      ya da pg havuzu yok (DATABASE_URL). Mağaza yanıtı okumadığı için müşteri «talebiniz alındı» görür." ;;
    201) fail "mağaza talep sondası 201 döndü: 10 rakamsız telefon KABUL EDİLDİ — sonda kayıt yazmış olabilir (talepEsle denetimi değişmiş)" ;;
    403) fail "mağaza talep sondası: 403 — '$MK' sunucuda izinli köken değil (MAGAZA_IZINLI_KOKENLER); MAGAZA_KOKEN ile doğru kökeni verin" ;;
    429) fail "mağaza talep sondası ÖLÇÜLEMEDİ: 429 (bekleyip yeniden çalıştırın)" ;;
    *)   fail "mağaza talep sondası beklenmedik yanıt: $M4" ;;
  esac
fi

echo
if [ "$FAIL" = 0 ]; then
  echo "== verify-deploy $PHASE: TUM KONTROLLER GECTI =="
else
  echo "== verify-deploy $PHASE: BASARISIZ KONTROL VAR =="
fi
exit "$FAIL"
