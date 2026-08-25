#!/usr/bin/env bash
# Deploy doğrulama — deploy-verify skill'inin script yarısı.
#
#   scripts/verify-deploy.sh pre             # push ÖNCESİ: tsc + boot + ps1 ASCII
#   scripts/verify-deploy.sh post [range]    # push SONRASI: CI + canlı sağlık + yeni route 401
#
# range verilmezse origin/main@{1}...origin/main kullanılır (bu makineden yapılan
# son push'un tam aralığı — çok-commit'li push'larda da doğrudur).
set -u
BASE_URL="${BASE_URL:-https://app.cetpa.com.tr}"
PHASE="${1:-post}"
FAIL=0
pass() { printf 'PASS  %s\n' "$1"; }
fail() { printf 'FAIL  %s\n' "$1"; FAIL=1; }

cd "$(dirname "$0")/.." || exit 1

if [ "$PHASE" = pre ]; then
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
  RANGE="${2:-origin/main@{1}...origin/main}"

  # 1) CI çalışmasını bekle
  RUN_ID=$(gh run list --limit 1 --json databaseId -q '.[0].databaseId' 2>/dev/null)
  if [ -n "${RUN_ID:-}" ] && gh run watch "$RUN_ID" --exit-status >/dev/null 2>&1; then
    pass "CI run $RUN_ID"
  else
    fail "CI run ${RUN_ID:-bulunamadı} — gh run view ${RUN_ID:-} ile incele"
  fi

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
  git fetch -q origin main 2>/dev/null
  ROUTES=$(git diff "$RANGE" -- server.ts 2>/dev/null | grep '^+' \
    | grep -oE "app\.(get|post|put|delete|patch)\('/api/[^']+'[^)]*requireAuth" \
    | sed -E "s/app\.([a-z]+)\('([^']+)'.*/\1 \2/" | sort -u)
  if [ -z "$ROUTES" ]; then
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
  BODY_PROBE="${VERIFY_BODY_PROBE:-/api/mikro/gelen-fatura/kabul}"
  PCODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 25 \
    -X POST -H 'Content-Type: application/json' --data-binary '{bozuk' \
    "$BASE_URL$BODY_PROBE" 2>/dev/null || echo 000)
  case "$PCODE" in
    400|500) pass "gövde ayrıştırma zincirde (bozuk JSON -> $PCODE)" ;;
    401|403) fail "GÖVDE AYRIŞTIRMA ZİNCİRDE DEĞİL: $BODY_PROBE bozuk JSON'a $PCODE döndü.
      express.json/rate-limit app.use'ları bu rotadan SONRA kayıtlı olabilir —
      rota kaydı ara katmanlardan ÖNCE yapılmış demektir. req.body undefined
      olacağı için bu grubun TÜM POST uçları kırıktır." ;;
    *)       fail "gövde ayrıştırma sondası beklenmedik yanıt: $PCODE ($BODY_PROBE)" ;;
  esac
fi

echo
if [ "$FAIL" = 0 ]; then
  echo "== verify-deploy $PHASE: TUM KONTROLLER GECTI =="
else
  echo "== verify-deploy $PHASE: BASARISIZ KONTROL VAR =="
fi
exit "$FAIL"
