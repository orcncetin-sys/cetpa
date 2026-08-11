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
  CHANGED=$(git diff --name-only origin/main...HEAD 2>/dev/null; git diff --name-only HEAD 2>/dev/null)

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
fi

echo
if [ "$FAIL" = 0 ]; then
  echo "== verify-deploy $PHASE: TUM KONTROLLER GECTI =="
else
  echo "== verify-deploy $PHASE: BASARISIZ KONTROL VAR =="
fi
exit "$FAIL"
