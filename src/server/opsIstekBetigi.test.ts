// @vitest-environment node
/**
 * scripts/ops-istek.sh davranış testleri (delta 2026-09-28): çıktı yolu ön denetimi (64, istek YOK), curl çıkış kodunun
 * 7 (ağ / sunucu tarafı) ya da 8 (yerel) diye ayrılması, 503 metni. Gerçek ağ ve Anahtar Zinciri KULLANILMAZ: PATH'in
 * başına sahte `security` (sabit test jetonu) ve sahte `curl` (çağrıyı iz dosyasına yazar, istenen kodla çıkar) konur.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync, rmSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const BETIK = resolve(process.cwd(), 'scripts/ops-istek.sh');
let kok = '';
let bin = '';

beforeAll(() => {
  kok = mkdtempSync(join(tmpdir(), 'ops-istek-test-'));
  bin = join(kok, 'bin');
  mkdirSync(bin);
  // Sahte security: -w → düz test jetonu; -g → yazdırılabilir biçim (`password: "…"`, stderr'e — gerçek aracın davranışı).
  writeFileSync(join(bin, 'security'), '#!/bin/sh\nfor a; do son="$a"; done\ncase "$son" in -w) printf \'testjeton123\' ;; -g) echo \'password: "testjeton123"\' >&2 ;; esac\nexit 0\n');
  // Sahte curl: çağrıyı iz dosyasına yazar; SAHTE_RC ≠ 0 ise -w kodunu basıp o kodla çıkar, yoksa gövdeyi -o dosyasına yazar.
  writeFileSync(join(bin, 'curl'), '#!/bin/sh\necho cagrildi >> "$CURL_IZ"\ncikti=""\nwhile [ $# -gt 0 ]; do case "$1" in -o) cikti="$2"; shift 2 ;; *) shift ;; esac; done\nif [ "${SAHTE_RC:-0}" != 0 ]; then printf \'%s\' "${SAHTE_KOD:-000}"; exit "$SAHTE_RC"; fi\n[ -n "$cikti" ] && printf \'{"ok":true}\' > "$cikti"\nprintf \'%s\' "${SAHTE_KOD:-200}"\n');
  // GNU mktemp taklidi (CI Ubuntu): şablonda en az üç X yoksa reddeder. Mac'te BSD `mktemp -t ad` çalıştığı için bu fark
  // yalnız CI'da görünüyordu (2026-09-28, 22 test) — test düzeneği artık yerelde de aynı katılıkta.
  writeFileSync(join(bin, 'mktemp'), '#!/bin/sh\nfor a; do son="$a"; done\ncase "$son" in *XXX*) exec /usr/bin/mktemp "$@" ;; esac\necho "mktemp: too few X\'s in template \'$son\'" >&2\nexit 1\n');
  chmodSync(join(bin, 'mktemp'), 0o755);
  chmodSync(join(bin, 'security'), 0o755);
  chmodSync(join(bin, 'curl'), 0o755);
});
afterAll(() => { if (kok) rmSync(kok, { recursive: true, force: true }); });

function kos(args: string[], env: Record<string, string> = {}) {
  const iz = join(kok, `iz-${Math.random().toString(36).slice(2)}`);
  const r = spawnSync('bash', [BETIK, ...args], {
    cwd: kok, encoding: 'utf8',
    env: { PATH: `${bin}:/usr/bin:/bin`, USER: 'test', HOME: kok, CURL_IZ: iz, CETPA_TABAN: 'http://127.0.0.1:9', ...env },
  });
  return { kod: r.status, hata: r.stderr, cikti: r.stdout, curlCagrildi: existsSync(iz) };
}

describe('ops-istek.sh — çıktı yolu istekten ÖNCE denetlenir (64, istek yok)', () => {
  it('var olan DİZİN → 64, curl çağrılmaz', () => {
    const d = join(kok, 'var-olan-dizin');
    mkdirSync(d, { recursive: true });
    const r = kos(['/api/ops/summary', d]);
    expect(r.kod).toBe(64);
    expect(r.curlCagrildi).toBe(false);
    expect(r.hata).toContain('DİZİN');
  });
  it("'/' ile biten yol (dizin yok) → 64, curl çağrılmaz", () => {
    const r = kos(['/api/ops/summary', join(kok, 'yok-dizin') + '/']);
    expect(r.kod).toBe(64);
    expect(r.curlCagrildi).toBe(false);
  });
  it("'.' → 64 (var olan dizin)", () => {
    const r = kos(['/api/ops/summary', '.']);
    expect(r.kod).toBe(64);
    expect(r.curlCagrildi).toBe(false);
  });
  it('üst dizini olmayan dosya → 64, curl çağrılmaz', () => {
    const r = kos(['/api/ops/summary', join(kok, 'yok', 'sonuc.json')]);
    expect(r.kod).toBe(64);
    expect(r.curlCagrildi).toBe(false);
  });
  it("delta 2: '-' (curl'de stdout) → 64, curl çağrılmaz — gövde KOD değişkenine karışmaz", () => {
    const r = kos(['/api/ops/summary', '-']);
    expect(r.kod).toBe(64);
    expect(r.curlCagrildi).toBe(false);
    expect(r.hata).toContain("'-'");
    expect(r.cikti).not.toContain('"ok"');
  });
  // root'ta `-w` her zaman doğru döner → bu iki bacak orada sınanamaz.
  const rootMu = typeof process.getuid === 'function' && process.getuid() === 0;
  it.skipIf(rootMu)('delta 2: salt okunur MEVCUT dosya → 64, curl çağrılmaz', () => {
    const f = join(kok, 'salt-okunur.json');
    writeFileSync(f, 'x');
    chmodSync(f, 0o444);
    try {
      const r = kos(['/api/mikro/iskonto-tutarsizlik', f]);
      expect(r.kod).toBe(64);
      expect(r.curlCagrildi).toBe(false);
      expect(r.hata).toMatch(/yazma izni yok/);
    } finally { chmodSync(f, 0o644); }
  });
  it.skipIf(rootMu)('delta 2: yazılamayan üst dizin → 64, curl çağrılmaz', () => {
    const d = join(kok, 'salt-okunur-dizin');
    mkdirSync(d, { recursive: true });
    chmodSync(d, 0o555);
    try {
      const r = kos(['/api/ops/summary', join(d, 'sonuc.json')]);
      expect(r.kod).toBe(64);
      expect(r.curlCagrildi).toBe(false);
      expect(r.hata).toMatch(/yazma izni yok/);
    } finally { chmodSync(d, 0o755); }
  });
  // Son kontrol 2026-09-28: meşru yollar reddedilmemeli (eskiden üst dizine yazma izni koşulsuz isteniyordu).
  it('göreli dosya adı → istek gider, gövde yazılır, 0', () => {
    const r = kos(['/api/ops/summary', 'goreli-sonuc.json']);
    expect(r.kod).toBe(0);
    expect(r.curlCagrildi).toBe(true);
    expect(readFileSync(join(kok, 'goreli-sonuc.json'), 'utf8')).toBe('{"ok":true}');
  });
  it('/dev/null (var olan yazılabilir dosya, üst dizin yazılamaz) → istek gider, 0', () => {
    const r = kos(['/api/ops/summary', '/dev/null']);
    expect(r.kod).toBe(0);
    expect(r.curlCagrildi).toBe(true);
  });
  it.skipIf(process.getuid?.() === 0)('salt okunur dizindeki YAZILABİLİR mevcut dosya → istek gider, 0', () => {
    const d = join(kok, 'salt-okunur-var');
    mkdirSync(d, { recursive: true });
    const f = join(d, 'mevcut.json');
    writeFileSync(f, 'eski'); chmodSync(f, 0o666); chmodSync(d, 0o555);
    try {
      const r = kos(['/api/ops/summary', f]);
      expect(r.kod).toBe(0);
      expect(r.curlCagrildi).toBe(true);
    } finally { chmodSync(d, 0o755); }
  });
  it('USER ve LOGNAME tanımsız → id -un ile çözülür, "jeton yok" diye YANLIŞ teşhis edilmez', () => {
    const r = spawnSync('bash', [BETIK, '/api/ops/summary'], {
      cwd: kok, encoding: 'utf8',
      env: { PATH: `${bin}:/usr/bin:/bin`, HOME: kok, CURL_IZ: join(kok, 'iz-user'), CETPA_TABAN: 'http://127.0.0.1:9' },
    });
    expect(r.status).toBe(0);
    expect(r.stderr).not.toMatch(/unbound variable|jeton.*yok/i);
  });
  it('geçerli dosya yolu → istek gider, gövde yazılır, 0', () => {
    const f = join(kok, 'sonuc.json');
    const r = kos(['/api/ops/summary', f]);
    expect(r.kod).toBe(0);
    expect(r.curlCagrildi).toBe(true);
    expect(readFileSync(f, 'utf8')).toBe('{"ok":true}');
  });
});

describe('ops-istek.sh — curl çıkış kodu ayrımı: yerel kodlar beyaz listede (8), gerisi ağ/sunucu tarafı (7)', () => {
  // Delta 2: betiğin AĞ mesajında adıyla geçen kodların HEPSİ (5/6 proxy/DNS, 35/60 TLS, 52/55 bağlantı koptu dahil).
  it.each([[5], [6], [7], [28], [35], [47], [52], [55], [56], [60]])('curl %i → 7 (AĞ)', (rc) => {
    const r = kos(['/api/ops/summary'], { SAHTE_RC: String(rc) });
    expect(r.kod).toBe(7);
    expect(r.hata).toContain('AĞ HATASI');
    expect(r.hata).not.toContain('YEREL');
  });
  it.each([[18], [8]])('curl %i (yanıt yarıda kesildi / bozuk) → 7, "YANIT YARIM/BOZUK", yerel DEĞİL', (rc) => {
    const r = kos(['/api/ops/summary'], { SAHTE_RC: String(rc), SAHTE_KOD: '200' });
    expect(r.kod).toBe(7);
    expect(r.hata).toContain('YANIT YARIM/BOZUK');
    expect(r.hata).toContain('HTTP 200');
    expect(r.hata).not.toContain('YEREL HATA');
  });
  it.each([[77], [58], [53], [37]])('curl %i (CA paketi / istemci sertifikası / SSL motoru / dosya) → 8 (YEREL), istek gönderilmedi', (rc) => {
    const r = kos(['/api/ops/summary'], { SAHTE_RC: String(rc) });
    expect(r.kod).toBe(8);
    expect(r.hata).toContain('YEREL HATA');
    expect(r.hata).not.toContain('AĞ HATASI');
  });
  it.each([[23], [26], [3]])('curl %i → 8 (YEREL)', (rc) => {
    const r = kos(['/api/ops/summary'], { SAHTE_RC: String(rc) });
    expect(r.kod).toBe(8);
    expect(r.hata).toContain('YEREL HATA');
  });
  it('HTTP 503 → 6, metin notConfigured gövdesini işaret eder', () => {
    const r = kos(['/api/ops/summary'], { SAHTE_KOD: '503' });
    expect(r.kod).toBe(6);
    expect(r.hata).toContain('notConfigured');
  });
  it('HTTP 401 → 5', () => {
    expect(kos(['/api/ops/summary'], { SAHTE_KOD: '401' }).kod).toBe(5);
  });
});
