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
# Yayın adımının BAŞLANGICI (ISO, gh'den; `ci_denetimi` doldurur). `post`un uptime kuralı buna göre ölçer: süreç yayın
# adımı başladıktan SONRA başlamış olmalı. Sabit 600 sn kuralı 2026-10-09'da sahte alarm verdi — `gh run watch` iş akışının
# TAMAMINI (hazırlık yayını dâhil) beklediği için health sondası yayından ~14 dk sonra koşmuştu (uptime 844 s, kod canlıdaydı).
CI_YAYIN_BASLANGIC=""
CI_ARAMA_DENEME="${CI_ARAMA_DENEME:-18}"
CI_ARAMA_ARALIK="${CI_ARAMA_ARALIK:-5}"
# $1 = kip (ci | post). Aralığa dayalı kontroller yalnız `post`ta koşar: bayat yerel ref orada FAIL, `ci`de bilgi.
# uptime_kurali <uptime sn> <şimdi epoch> <yayın adımı başlangıcı ISO ya da boş> → "pass|ileti" / "fail|ileti" (saf; test eder)
# Başlangıç biliniyorsa: uptime ≤ (şimdi − başlangıç) + 60 → süreç yayın adımı içinde / sonrasında başlamış. Bilinmiyorsa 600 sn.
uptime_kurali() {
  local up="$1" simdi="$2" bas="$3" bas_epoch=""
  if [ -n "$bas" ]; then
    bas_epoch=$(python3 -c 'import sys,datetime; print(int(datetime.datetime.fromisoformat(sys.argv[1].replace("Z", "+00:00")).timestamp()))' "$bas" 2>/dev/null) || bas_epoch=""
  fi
  if [ -n "$bas_epoch" ]; then
    local gecen=$((simdi - bas_epoch))
    if [ "$up" -le $((gecen + 60)) ]; then echo "pass|taze restart (uptime ${up}s; yayın adımı ${gecen}s önce başladı)"
    else echo "fail|uptime ${up}s, yayın adımından beri geçen ${gecen}s — deploy restart etmemiş"; fi
  else
    if [ "$up" -lt 600 ]; then echo "pass|taze restart (uptime ${up}s; yayın adımı zamanı okunamadı, 600 sn kuralı)"
    else echo "fail|uptime ${up}s — deploy restart etmemiş olabilir (yayın adımı zamanı okunamadı, 600 sn kuralı)"; fi
  fi
}

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
      CI_YAYIN_BASLANGIC=$(gh run view "$is" --json jobs -q ".jobs[] | select(.name == \"$CI_YAYIN_ISI\") | .steps[] | select(.name == \"$CI_YAYIN_ADIMI\") | .startedAt" 2>/dev/null) || CI_YAYIN_BASLANGIC=""
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
    K=$(uptime_kurali "${UP:-999999}" "$(date +%s)" "$CI_YAYIN_BASLANGIC")
    case "${K%%|*}" in pass) pass "${K#*|}" ;; *) fail "${K#*|}" ;; esac
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
  BODY_PROBES="${VERIFY_BODY_PROBE:-/api/mikro/gelen-fatura/kabul /api/tracking/fedex /api/ops/watchdog/run /api/dynamics/export/siparis /api/superadmin/tenants/test/status /api/parasut/import/stok /api/ai/lead-score /api/shopify/sync /api/shopify/baglanti /api/iyzico/payment-link /api/email/send /api/magaza-panel/yetki-kodu /api/magaza-talepleri/mt-00000000000000000000000000000000/durum /api/magaza-talepleri/mt-00000000000000000000000000000000/kalem-teslim /api/magaza-talepleri/mt-00000000000000000000000000000000/bildirim-gonder /api/magaza-talepleri /api/magaza-talepleri/mt-00000000000000000000000000000000/icerik /api/magaza-talepleri/mt-00000000000000000000000000000000/sil}"
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

  # 4b) MAĞAZA ERP UÇLARI KAYITLI MI? (mağaza dilim 2a + 2b — «yazıldı ama bağlanmadı» sondası)
  #
  # Yukarıdaki bozuk JSON sondası rotanın VARLIĞINI göremez: gövde hatası rota eşleşmesinden
  # ÖNCE fırlar, kayıtlı olmayan yol da 400/500 döner. Bu yüzden aynı yedi yola GEÇERLİ JSON,
  # Authorization'sız gönderilir:
  #   401 = rota kayıtlı ve kimlik kapısı arkasında · 404 = rota deploy'da YOK
  # (magazaErpRoutes(app, …) çağrısı server.ts'te yok ya da uç adı değişmiş).
  # Son üç yol dilim 2b'dir (elle talep, içerik düzenleme, yumuşak silme / geri alma): 404 = 2b sunucusu
  # canlıda değil. Hiçbiri kayıt okumaz / yazmaz (kimlik kapısı gövdeden ve veritabanından ÖNCE reddeder).
  MAGAZA_ERP_PROBES="/api/magaza-panel/yetki-kodu /api/magaza-talepleri/mt-00000000000000000000000000000000/durum /api/magaza-talepleri/mt-00000000000000000000000000000000/kalem-teslim /api/magaza-talepleri/mt-00000000000000000000000000000000/bildirim-gonder /api/magaza-talepleri /api/magaza-talepleri/mt-00000000000000000000000000000000/icerik /api/magaza-talepleri/mt-00000000000000000000000000000000/sil"
  for ERP_PROBE in $MAGAZA_ERP_PROBES; do
    ECODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 25 \
      -X POST -H 'Content-Type: application/json' --data-binary '{}' \
      "$BASE_URL$ERP_PROBE" 2>/dev/null || echo 000)
    case "$ECODE" in
      401) pass "mağaza ERP ucu kayıtlı ve kimlik kapısı arkasında: $ERP_PROBE (kimliksiz {} -> 401)" ;;
      404) fail "MAĞAZA ERP UCU KAYITLI DEĞİL: $ERP_PROBE -> 404 (server.ts: magazaErpRoutes(app, …) çağrısı / uç adı)" ;;
      429) fail "$ERP_PROBE -> 429 (hız sınırı: bu IP kimliksiz tavanı doldurdu — bekleyip yeniden çalıştırın)" ;;
      *)   fail "mağaza ERP ucu sondası beklenmedik yanıt: $ECODE ($ERP_PROBE; 200/400/403 = kimlik kapısı zincirde değil)" ;;
    esac
  done

  # 4c) REVİZE BİLDİRİMİNİ YENİDEN GÖNDER (mağaza dilim 2b): bildirim-gonder?tur=revize
  #
  # Aynı ucun sorgu dizeli varyantı; geçerli JSON, Authorization'sız:
  #   401 = sorgu dizesi kimlik kapısından SONRA ayrıştırılıyor (doğru sıra)
  #   400 = `tur` ayrıştırması kapıdan ÖNCE koşuyor: kimliksiz istek şema yanıtı alıyor (sıra bozuk)
  # Adres tırnak içinde ve listeden AYRI verilir: `?` kabukta dosya adı kalıbıdır.
  REVIZE_PROBE="/api/magaza-talepleri/mt-00000000000000000000000000000000/bildirim-gonder?tur=revize"
  RCODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 25 \
    -X POST -H 'Content-Type: application/json' --data-binary '{}' \
    "$BASE_URL$REVIZE_PROBE" 2>/dev/null || echo 000)
  case "$RCODE" in
    401) pass "mağaza ERP ucu revize bildirimi kimlik kapısı arkasında: $REVIZE_PROBE (kimliksiz {} -> 401)" ;;
    400) fail "REVİZE BİLDİRİMİ UCUNDA SIRA BOZUK: $REVIZE_PROBE -> 400 (sorgu dizesi kimlik kapısından ÖNCE ayrıştırılıyor; kimliksiz istek 401 almalı)" ;;
    404) fail "MAĞAZA ERP UCU KAYITLI DEĞİL: $REVIZE_PROBE -> 404 (server.ts: magazaErpRoutes(app, …) çağrısı / uç adı)" ;;
    429) fail "$REVIZE_PROBE -> 429 (hız sınırı: bu IP kimliksiz tavanı doldurdu — bekleyip yeniden çalıştırın)" ;;
    *)   fail "revize bildirimi sondası beklenmedik yanıt: $RCODE ($REVIZE_PROBE; 200/403 = kimlik kapısı zincirde değil)" ;;
  esac

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
  #   takip ucu (var olmayan sabit talep no) -> 404 + "bulunamadi" (dilim 2a: uç gerçek
  #                               yanıt veriyor, havuz var, kiracı çözülüyor)
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
  # Takip ucu (dilim 2a): sabit sahte talep no hiç var olmadı — kayıt okumaz / yazmaz, kişisel veri taşımaz. Gövde
  # src/server/routes/magazaRoutes.test.ts'teki sabitle BİREBİR bağlıdır (biri değişirse test kırılır).
  #   404 + bulunamadi = uç canlı, havuz var, kiracı çözülüyor · 503 = havuz / kiracı yok ·
  #   kod'suz 404 = rota kayıtlı değil · 503 + hazir-degil = dilim 1 hâlâ canlıda.
  # Dilim 2b: SİLİNMİŞ talep bu uçta 404 + kod 'silindi' alır. O yanıt sonda ile ÜRETİLEMEZ (canlıda yapay silinmiş kayıt
  # açılmaz): hiç var olmamış sabit talep no 2b'de de 'bulunamadi' döner. 'silindi' ayrımı rota testindedir; canlıda ilk
  # gerçek silmeden sonra elle doğrulanır (RUNBOOK [14]).
  M3=$(curl -s --max-time 20 -w '\n%{http_code}' -X POST -H "Origin: $MK" -H "Content-Type: application/json" -d '{"no":"T000000-AAAA","telefon":"0000000000"}' "$MU/siparis-durumu" 2>/dev/null)
  M3KOD=$(printf '%s\n' "$M3" | tail -n 1)
  if [ "$M3KOD" = "404" ] && printf '%s' "$M3" | grep -q 'bulunamadi'; then
    pass "mağaza takip ucu: 404 bulunamadi (uç canlı; havuz var, kiracı çözülüyor)"
  elif [ "$M3KOD" = "429" ]; then
    fail "mağaza takip ucu ÖLÇÜLEMEDİ: 429 (IP başına 20 / 15 dk — bekleyip yeniden çalıştırın)"
  elif [ "$M3KOD" = "503" ] && printf '%s' "$M3" | grep -q 'hazir-degil'; then
    fail "mağaza takip ucu: 503 hazir-degil — dilim 1 hâlâ canlıda (dilim 2a sunucusu yayında değil)"
  elif [ "$M3KOD" = "503" ]; then
    fail "MAĞAZA TAKİP UCU ÇALIŞMIYOR: 503 — pg havuzu yok (DATABASE_URL) ya da kiracı çözülemiyor (SERVER_TENANT_COMPANY_ID)"
  elif [ "$M3KOD" = "404" ]; then
    fail "mağaza takip ucu: kod'suz 404 — rota kayıtlı değil (zincirin rota-yok yanıtı)"
  else
    fail "mağaza takip ucu: beklenen 404 + bulunamadi, gelen $M3KOD"
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

  # 7) SİTE PANELİ ALT ZİNCİRİ (www.cetpa.com.tr/panel.html → /api/magaza/panel/*) — mağaza dilim 2a
  #
  # Hepsi belirteçsiz (kimliksiz) ölçülür; hiçbiri kayıt okumaz / yazmaz. Başlıklar satırın
  # TAMAMINDA aranır (grep -i): değer virgüllü listedir, yalnız ilk sözcüğe bakmak yetmez.
  #   503 + panel-yapilandirilmamis = panel HİÇ çalışmıyor: MAGAZA_PANEL_DONUS kökeni izinli
  #   listede değil / https değil ya da oturum sırrı yok (bekçi de kırmızı gösterir).
  PU="$MU/panel"
  PANEL_SIFIR="mt-00000000000000000000000000000000"
  panel_sonda() {  # $1 = ad, $2 = beklenen kod, $3.. = curl bağımsız değişkenleri
    PAD="$1"; PBEK="$2"; shift 2
    PY=$(curl -s --max-time 20 -w '\n%{http_code}' -H "Origin: $MK" "$@" 2>/dev/null)
    PKOD=$(printf '%s\n' "$PY" | tail -n 1)
    if [ "$PKOD" = "$PBEK" ]; then
      pass "site paneli $PAD: $PKOD"
    elif [ "$PKOD" = "503" ] && printf '%s' "$PY" | grep -q 'panel-yapilandirilmamis'; then
      fail "SİTE PANELİ YAPILANDIRILMAMIŞ ($PAD -> 503 panel-yapilandirilmamis): MAGAZA_PANEL_DONUS kökeni
      MAGAZA_IZINLI_KOKENLER listesinde değil / https değil ya da SESSION_TOKEN_SECRET ve FIREBASE_PRIVATE_KEY yok."
    elif [ "$PKOD" = "404" ]; then
      fail "site paneli $PAD: 404 — alt zincir bağlı değil ya da uç kayıtlı değil (magazaRoutes: r.use('/panel', …); magazaPanelZinciri kayıt sırası)"
    elif [ "$PKOD" = "400" ] || [ "$PKOD" = "415" ]; then
      fail "site paneli $PAD: $PKOD — belirteç kapısı gövdeden SONRA çalışıyor (kayıt sırası bozuk; belirteçsiz istek 401 almalı)"
    elif [ "$PKOD" = "403" ]; then
      fail "site paneli $PAD: 403 — '$MK' sunucuda izinli köken değil (MAGAZA_IZINLI_KOKENLER); MAGAZA_KOKEN ile doğru kökeni verin"
    elif [ "$PKOD" = "429" ]; then
      fail "site paneli $PAD ÖLÇÜLEMEDİ: 429 (bekleyip yeniden çalıştırın)"
    else
      fail "site paneli $PAD: beklenen $PBEK, gelen $PKOD"
    fi
  }
  panel_sonda "liste (belirteçsiz)" 401 "$PU/siparisler"
  panel_sonda "oturum (geçersiz kod)" 401 -X POST -H "Content-Type: application/json" \
    -d '{"kod":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","dogrulayici":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"}' "$PU/oturum"
  panel_sonda "kalem teslim (belirteçsiz)" 401 -X POST -H "Content-Type: application/json" -d '{}' "$PU/siparisler/$PANEL_SIFIR/kalem-teslim"
  panel_sonda "etiket basıldı (belirteçsiz)" 401 -X POST -H "Content-Type: application/json" -d '{}' "$PU/siparisler/$PANEL_SIFIR/etiket-basildi"
  # Dilim 2b: yumuşak silme ucu (yalnız Yönetici). Belirteçsiz 401 = kapı gövdeden ÖNCE; kayıt okunmaz / yazılmaz.
  panel_sonda "silme (belirteçsiz)" 401 -X POST -H "Content-Type: application/json" -d '{}' "$PU/siparisler/$PANEL_SIFIR/sil"
  # Panel ön uçuşu: GET + Authorization izinli olmalı (IIS'in bu ön uçuşu Node'a ilettiği burada ölçülür).
  POPT=$(curl -s -o /dev/null -D - --max-time 20 -X OPTIONS -H "Origin: $MK" \
    -H "Access-Control-Request-Method: GET" -H "Access-Control-Request-Headers: authorization,content-type" \
    "$PU/siparisler" 2>/dev/null | tr -d '\r')
  POPTKOD=$(printf '%s\n' "$POPT" | awk '/^HTTP\//{k=$2} END{print k}')
  if [ "$POPTKOD" = "204" ] && printf '%s\n' "$POPT" | grep -i '^access-control-allow-methods:' | grep -qi 'GET' \
     && printf '%s\n' "$POPT" | grep -i '^access-control-allow-headers:' | grep -qi 'authorization'; then
    pass "site paneli ön uçuşu: 204 + Allow-Methods GET + Allow-Headers Authorization"
  elif [ "$POPTKOD" = "429" ]; then
    fail "site paneli ön uçuşu ÖLÇÜLEMEDİ: 429 (bekleyip yeniden çalıştırın)"
  else
    fail "site paneli ön uçuşu: beklenen 204 + Allow-Methods GET + Allow-Headers Authorization — gelen kod '${POPTKOD:-yok}'.
      Tarayıcı belirteçli isteği HİÇ göndermez. Başlıklar yoksa OPTIONS'ı IIS yanıtlıyor ya da alt zincir bağlı değil."
  fi
  # Dış zincirin ön uçuşu DEĞİŞMEDİ: aynı istek başlığıyla Authorization İZİNLİ DEĞİL (ret tarayıcıda, başlık değerinden olur).
  DOPT=$(curl -s -o /dev/null -D - --max-time 20 -X OPTIONS -H "Origin: $MK" \
    -H "Access-Control-Request-Method: GET" -H "Access-Control-Request-Headers: authorization,content-type" \
    "$MU/siparis-talebi" 2>/dev/null | tr -d '\r')
  DOPTKOD=$(printf '%s\n' "$DOPT" | awk '/^HTTP\//{k=$2} END{print k}')
  if [ "$DOPTKOD" = "204" ] && ! printf '%s\n' "$DOPT" | grep -i '^access-control-allow-headers:' | grep -qi 'authorization'; then
    pass "mağaza dış zinciri ön uçuşu: 204, Allow-Headers Authorization TAŞIMIYOR (panel izni dış uçlara sızmamış)"
  elif [ "$DOPTKOD" = "429" ]; then
    fail "mağaza dış zinciri ön uçuşu ÖLÇÜLEMEDİ: 429 (bekleyip yeniden çalıştırın)"
  else
    fail "mağaza dış zinciri ön uçuşu: beklenen 204 ve Allow-Headers'ta Authorization YOK — gelen kod '${DOPTKOD:-yok}' (panel köken kapısı dış zincire uygulanmış olabilir)"
  fi

  # 8) İSTEMCİ DERLEMESİ «ERP ile bağlan» SAYFASINI TAŞIYOR MU? — mağaza dilim 2a («yazıldı ama bağlanmadı» sondası)
  #
  # Site paneli kullanıcıyı app.cetpa.com.tr/magaza-panel-baglan adresine gönderir; onay sayfası istemci derlemesindedir.
  # `GET /magaza-panel-baglan` -> 200 + text/html KANIT DEĞİLDİR: SPA yedeği her yola index.html verir (sayfa App.tsx'e
  # hiç bağlanmamış olsa da). Ayırt edici: ana sayfanın gösterdiği ana betikte (/assets/index-….js) yol METNİ aranır —
  # yol sabiti App.tsx'tedir, sayfa bağlıysa ana betiğe girer. Yalnız iki GET; oturum açmaz, kayıt yazmaz.
  ISAYFA=$(curl -s --compressed --max-time 20 "$BASE_URL/" 2>/dev/null)
  IBETIK=$(printf '%s' "$ISAYFA" | grep -oE '/assets/index-[A-Za-z0-9_-]+\.js' | head -n 1)
  if [ -z "$IBETIK" ]; then
    fail "istemci derlemesi sondası ÖLÇÜLEMEDİ: GET / yanıtında ana betik adresi (/assets/index-….js) bulunamadı"
  else
    # Dosyaya iner (ana betik yüzlerce KB; değişkende tutulmaz), aranır, silinir.
    IDOSYA=$(mktemp "${TMPDIR:-/tmp}/verify-istemci.XXXXXX")
    IKOD=$(curl -s --compressed --max-time 40 -o "$IDOSYA" -w '%{http_code}' "$BASE_URL$IBETIK" 2>/dev/null)
    if [ "$IKOD" != "200" ] || [ ! -s "$IDOSYA" ]; then
      fail "istemci derlemesi sondası ÖLÇÜLEMEDİ: ana betik indirilemedi ($IBETIK -> ${IKOD:-yanıt yok})"
    elif grep -q '/magaza-panel-baglan' "$IDOSYA"; then
      pass "istemci derlemesi «ERP ile bağlan» sayfasının yolunu taşıyor ($IBETIK içinde /magaza-panel-baglan)"
    else
      fail "İSTEMCİ DERLEMESİNDE /magaza-panel-baglan YOK ($IBETIK): dilim 2 istemcisi yayında değil ya da onay sayfası
      App.tsx'e bağlanmamış — site panelindeki «ERP ile giriş yap» boş sayfaya düşer."
    fi
    rm -f "$IDOSYA"
  fi

  # 9) «YENİ SÜRÜM VAR» UCU: sunucunun sürüm kimliği = yayındaki istemci paketinin kimliği (şartname yeni-sürüm-bildirimi S2)
  #
  # `GET /api/surum` kimliksizdir: 200 + `Cache-Control: no-store` + gövde YALNIZ `{"surum":"<16 onaltılık>"}`. Kimlik, aynı
  # yayının index.html'indeki `<meta name="cetpa-surum">` ile AYNI olmalı (8. adımda indirilen sayfa). Ayrışırsa sunucu başka
  # derlemenin surum.json'unu okuyor (dist.new / dist karışıklığı): açık sekmeler ya hiç uyarılmaz ya da yanlış uyarılır.
  # `{"surum":null}` = derlemede surum.json üretilmemiş (derleme eklentisi vite.config.ts'ten çıkmış) — şerit sessizce kapalı.
  # Ana betikte `/api/surum` metni yoksa şerit istemciye bağlanmamış («yazıldı ama bağlanmadı» sondası). Yalnız GET; kayıt yazmaz.
  SMETA=$(printf '%s' "$ISAYFA" | grep -oE '<meta name="cetpa-surum" content="[0-9a-f]{16}"' | head -n 1 | grep -oE '[0-9a-f]{16}')
  SDOSYA=$(mktemp "${TMPDIR:-/tmp}/verify-surum.XXXXXX")
  SBASLIK=$(curl -s --max-time 20 -D - -o "$SDOSYA" "$BASE_URL/api/surum" 2>/dev/null | tr -d '\r')
  SGOVDE=$(cat "$SDOSYA" 2>/dev/null)
  rm -f "$SDOSYA"
  SKOD=$(printf '%s\n' "$SBASLIK" | awk '/^HTTP\//{k=$2} END{print k}')
  SCC=$(printf '%s\n' "$SBASLIK" | grep -i '^cache-control:' | tail -n 1 | sed 's/^[^:]*:[[:space:]]*//')
  SSURUM=$(printf '%s' "$SGOVDE" | grep -E '^\{"surum":"[0-9a-f]{16}"\}$' | grep -oE '[0-9a-f]{16}')
  if [ "$SKOD" = "429" ]; then
    fail "sürüm ucu sondası ÖLÇÜLEMEDİ: 429 (bekleyip yeniden çalıştırın)"
  elif [ "$SKOD" != "200" ]; then
    fail "sürüm ucu: GET /api/surum beklenen 200, gelen '${SKOD:-yanıt yok}' (rota kayıtlı değil ya da bir kimlik kapısının arkasında)"
  elif [ "$SCC" != "no-store" ]; then
    fail "sürüm ucu: Cache-Control 'no-store' değil ('${SCC:-yok}') — eski yanıt saklanırsa açık sekmeler yeni sürümü göremez"
  elif [ -z "$SSURUM" ]; then
    fail "sürüm ucu: gövde '{\"surum\":\"<16 onaltılık>\"}' biçiminde değil: ${SGOVDE:-boş} (null = derlemede surum.json yok)"
  elif [ -z "$SMETA" ]; then
    fail "sürüm ucu: GET / yanıtında <meta name=\"cetpa-surum\"> yok — istemci paketi kimliksiz, şerit kapalı"
  elif [ "$SSURUM" != "$SMETA" ]; then
    fail "sürüm ucu AYRIŞIYOR: sunucu $SSURUM, istemci paketi $SMETA — sunucu başka derlemenin surum.json'unu okuyor (dist / dist.new)"
  else
    SBETIK=$(mktemp "${TMPDIR:-/tmp}/verify-surum-betik.XXXXXX")
    SBKOD=$(curl -s --compressed --max-time 40 -o "$SBETIK" -w '%{http_code}' "$BASE_URL$IBETIK" 2>/dev/null)
    if [ -z "$IBETIK" ] || [ "$SBKOD" != "200" ]; then
      fail "sürüm ucu: kimlik aynı ($SSURUM) ama ana betik indirilemedi (${IBETIK:-adres yok} -> ${SBKOD:-yanıt yok}) — şeridin bağı ÖLÇÜLEMEDİ"
    elif grep -q '/api/surum' "$SBETIK"; then
      pass "sürüm ucu: 200 + no-store, sunucu = istemci paketi ($SSURUM); ana betik /api/surum'u soruyor (şerit bağlı)"
    else
      fail "sürüm ucu: kimlik aynı ($SSURUM) ama ana betikte /api/surum YOK — «yeni sürüm» şeridi istemciye bağlanmamış"
    fi
    rm -f "$SBETIK"
  fi
fi

echo
if [ "$FAIL" = 0 ]; then
  echo "== verify-deploy $PHASE: TUM KONTROLLER GECTI =="
else
  echo "== verify-deploy $PHASE: BASARISIZ KONTROL VAR =="
fi
exit "$FAIL"
