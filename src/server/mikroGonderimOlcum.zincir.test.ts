// @vitest-environment node
/**
 * mikroGonderimOlcum.zincir.test.ts — gönderim defterinin ÖLÇÜM parçası (şartname `.wf/SARTNAME-yeniden-deneme-sunucuda-v3.md`
 * K0b, § 8.2 commit 0-B; v2 T0 zincir vektörleri; M0.1–M0.7, M0.11, M0.12, M0.20), GERÇEK `server.ts` + GERÇEK express zinciriyle.
 *
 * ANA İDDİA: kip `kapali` (varsayılan) iken `POST /api/mikro/evrak/kaydet` bugünküyle BİREBİR — kayıt yok, yanıt aynı. Kip `olcum`
 * iken yanıt YİNE BİREBİR (başarı, Mikro reddi, fırlatma), her istek için TEK gövdesiz ölçüm kaydı açılır; kayıt açılamasa da Mikro'ya
 * istek gider ve yanıt değişmez; kayıt Mikro çağrısını bekletmez. Ops uçları jetonsuz kapalı; çıktıda gövde / uid / `entityId` yok.
 *
 * Açılış işareti GERÇEK açılışta sınanır: sunucu içe aktarılmadan ÖNCE `docs` tablosuna önceki süreçten kalmış `suruyor` bir ölçüm
 * kaydı konur; açılıştan sonra `kesildi` olur (server.ts → `olcumAcilisIsareti` çağıranı).
 *
 * BULUT kipi (`MIKRO_LOCAL=0`): stub sayacının `atlanan` alanı yalnız orada artar. SAHTE OLANLAR (kalıp `mikroCariArama.zincir.test.ts`):
 * Firebase belirteç doğrulayıcısı, `pg` (PGlite + sorgu öncesi kanca), pg-boss, node-cron, vite, `dotenv`, dışarı giden `fetch`.
 * Canlıya, Firebase'e, Mikro'ya istek YOK.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { DOCS_TABLOSU_DDL } from './docsSema';
import { MIKRO_STUB_METNI } from './mikro/yazimSecenegi';

// ── Sahteler ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
vi.mock('dotenv', () => ({ default: { config: () => ({ parsed: {} }) }, config: () => ({ parsed: {} }) }));
vi.mock('firebase-admin/auth', () => ({
  getAuth: () => ({
    verifyIdToken: async (t: string) => {
      const [uid, email, v] = String(t).split('|');
      if (!uid || !email) throw new Error('geçersiz belirteç');
      return { uid, email, email_verified: v === '1' };
    },
    revokeRefreshTokens: async () => undefined,
  }),
}));
vi.mock('pg-boss', () => ({
  PgBoss: class { on() {} async start() {} async createQueue() {} async work() {} async send() { return null; } async stop() {} },
}));
vi.mock('node-cron', () => ({ default: { schedule: () => ({ stop() {}, start() {} }), validate: () => true } }));
vi.mock('vite', () => ({ createServer: async () => ({ middlewares: (_q: unknown, _s: unknown, n: () => void) => n() }) }));
vi.mock('pg', async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();
  const g = globalThis as Record<string, unknown>;
  g.__olcumPg = db;
  const q = async (text: unknown, params?: unknown[]) => {
    let sql = String(text); let p = params;
    if (text && typeof text === 'object') { const o = text as { text: string; values?: unknown[] }; sql = o.text; p = o.values; }
    // Sorgu öncesi kanca: defter INSERT'ini yavaşlatmak / düşürmek için (M0.1, M0.7).
    const kanca = g.__olcumPgKanca as ((sql: string, p: unknown[] | undefined) => Promise<void> | void) | undefined;
    if (kanca) await kanca(sql, p);
    if (!p || p.length === 0) {
      const r = await db.exec(sql);
      const son = r[r.length - 1];
      if (!son) return { rows: [], rowCount: null };
      return { rows: son.rows, rowCount: son.affectedRows ?? son.rows.length };
    }
    const r = await db.query(sql, p);
    return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
  };
  class Pool { query = q; async connect() { return { query: q, release() {} }; } on() {} async end() {} }
  class Client { query = q; async connect() {} async end() {} on() {} }
  return { default: { Pool, Client }, Pool, Client };
});

vi.setConfig({ testTimeout: 90_000 });

// ── Düzenek ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
interface Pg {
  query: (sql: string, p?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
  exec: (sql: string) => Promise<unknown>;
}
const G = globalThis as Record<string, unknown>;
const pg = (): Pg => G.__olcumPg as Pg;
const kancaKur = (k: ((sql: string, p: unknown[] | undefined) => Promise<void> | void) | null): void => { G.__olcumPgKanca = k ?? undefined; };
const defterInsertMi = (sql: string, p: unknown[] | undefined): boolean => /^\s*INSERT/i.test(sql) && p?.[0] === 'mikroGonderimleri';

let sunucu: http.Server | undefined;
let kapiNo = 0;
let yuklemeDizini = '';
const gercekFetch = globalThis.fetch;

const KIRACI = 'CETPA';
const OPS_JETONU = 'olcum-sinama-jetonu';
const OPS = { 'X-Ops-Token': OPS_JETONU };
const TABAN = 'https://mikro.example.test:8094/Api/APIMethods';
const MIKRO_KIMLIK_URL = 'https://onlinekullanici.mikro.com.tr/auth/realms/Mikro/protocol/openid-connect/token';
const eposta = (uid: string): string => `${uid.toLowerCase()}@example.test`;
const jsonYanit = (govde: unknown, kod = 200): Response => new Response(JSON.stringify(govde), { status: kod, headers: { 'content-type': 'application/json' } });

/** Jump API'ye giden her yöntem isteği (zamanıyla — M0.7 gecikme çiti). */
const mikroIstekleri: Array<{ yontem: string; at: number }> = [];
type Yanitlayici = (yontem: string) => Response | Promise<Response>;
const BASARI: Yanitlayici = () => jsonYanit({ result: [{ StatusCode: 200, IsError: false, ErrorMessage: '', Data: { evrakNo: 'IZN-0077' } }] });
const RET: Yanitlayici = () => jsonYanit({ result: [{ StatusCode: 200, IsError: true, ErrorMessage: 'Personel AYŞE YILMAZ bulunamadı' }] });
const FIRLAT: Yanitlayici = () => { throw new TypeError('fetch failed', { cause: Object.assign(new Error('connect ECONNREFUSED 10.9.8.7:8094'), { code: 'ECONNREFUSED' }) }); };
const STUB: Yanitlayici = (yontem) => jsonYanit({ Method: yontem });
let yanitlayici: Yanitlayici = BASARI;
let belirtecReddi = false;
async function mikroIle<T>(y: Yanitlayici, is: () => Promise<T>): Promise<T> {
  yanitlayici = y;
  try { return await is(); } finally { yanitlayici = BASARI; }
}

interface Yanit { s: number; j: Record<string, unknown>; metin: string }
let ipSayaci = 0;
const sonrakiIp = (): string => { ipSayaci++; return `10.${(ipSayaci >> 16) & 255}.${(ipSayaci >> 8) & 255}.${ipSayaci & 255}`; };
function istek(yontem: string, yol: string, basliklar: Record<string, string> = {}, govde?: unknown): Promise<Yanit> {
  return new Promise((coz, reddet) => {
    const veri = govde === undefined ? undefined : JSON.stringify(govde);
    const q = http.request({
      host: '127.0.0.1', port: kapiNo, method: yontem, path: yol, agent: false,
      headers: {
        'X-Forwarded-For': sonrakiIp(), ...basliklar,
        ...(veri !== undefined ? { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(veri)) } : {}),
      },
    }, r => {
      const durum = r.statusCode;
      if (durum === undefined) { reddet(new Error(`durum kodu yok: ${yontem} ${yol}`)); return; }
      const parcalar: Buffer[] = [];
      r.on('data', (p: Buffer) => parcalar.push(p));
      r.on('end', () => {
        const metin = Buffer.concat(parcalar).toString('utf8');
        let j: Record<string, unknown> = {};
        try { const o: unknown = JSON.parse(metin); if (o && typeof o === 'object' && !Array.isArray(o)) j = o as Record<string, unknown>; } catch { /* düz metin */ }
        coz({ s: durum, j, metin });
      });
    });
    q.setTimeout(20_000, () => q.destroy(new Error(`zaman aşımı: ${yontem} ${yol}`)));
    q.on('error', reddet);
    if (veri !== undefined) q.write(veri);
    q.end();
  });
}
function akisAc(yol: string): Promise<{ s: number; govde: () => string; kapat: () => void }> {
  return new Promise((coz, reddet) => {
    const q = http.request({ host: '127.0.0.1', port: kapiNo, method: 'GET', path: yol, agent: false, headers: { 'X-Forwarded-For': sonrakiIp() } }, r => {
      const durum = r.statusCode;
      if (durum === undefined) { reddet(new Error(`durum kodu yok: ${yol}`)); return; }
      let tampon = '';
      r.on('data', (p: Buffer) => { tampon += p.toString('utf8'); });
      r.on('error', () => { /* kapatılınca */ });
      coz({ s: durum, govde: () => tampon, kapat: () => { q.destroy(); } });
    });
    q.on('error', reddet);
    q.end();
  });
}
const bekle = async (kosul: () => boolean | Promise<boolean>, ms: number, ne: string): Promise<void> => {
  const son = Date.now() + ms;
  while (Date.now() < son) { if (await kosul()) return; await new Promise(r => setTimeout(r, 25)); }
  throw new Error(`beklenen olmadı (${ms} ms): ${ne}`);
};
const belgeKoy = (coll: string, id: string, data: Record<string, unknown>): Promise<unknown> =>
  pg().query('INSERT INTO docs (coll, id, data) VALUES ($1, $2, $3::jsonb) ON CONFLICT (coll, id) DO UPDATE SET data = EXCLUDED.data', [coll, id, JSON.stringify(data)]);
const belgeOku = async (coll: string, id: string): Promise<Record<string, unknown> | undefined> =>
  (await pg().query('SELECT data FROM docs WHERE coll = $1 AND id = $2', [coll, id])).rows[0]?.data as Record<string, unknown> | undefined;
const defter = async (): Promise<Array<{ id: string; data: Record<string, unknown> }>> =>
  (await pg().query("SELECT id, data FROM docs WHERE coll = 'mikroGonderimleri' ORDER BY id")).rows as Array<{ id: string; data: Record<string, unknown> }>;
const yeniOlcumler = async (onceki: ReadonlySet<string>): Promise<Array<{ id: string; data: Record<string, unknown> }>> =>
  (await defter()).filter(s => !onceki.has(s.id) && s.id !== 'o_onceki_surec');
const kimlikler = async (): Promise<Set<string>> => new Set((await defter()).map(s => s.id));

let kullaniciSayaci = 0;
/** YENİ bir Yönetici (Mikro sınırlayıcısı kullanıcı başına sayar). `kurucu`: `companyId` alanı OLMAYAN belge → kiracı = uid. */
async function yeniYonetici(kurucu = false): Promise<{ uid: string; b: Record<string, string> }> {
  kullaniciSayaci++;
  const uid = `olcum-yonetici-${kullaniciSayaci}`;
  await belgeKoy('users', uid, { email: eposta(uid), role: 'Admin', ...(kurucu ? {} : { companyId: KIRACI }) });
  return { uid, b: { Authorization: `Bearer ${uid}|${eposta(uid)}|1` } };
}
const kipYaz = (kip: unknown, neden: unknown = 'sınama'): Promise<Yanit> =>
  istek('POST', '/api/ops/mikro-gonderim-kipi', OPS, { kip, neden });
const ozet = async (): Promise<Record<string, unknown>> => {
  const r = await istek('GET', '/api/ops/mikro-gonderim-ozet', OPS);
  expect(r.s, r.metin).toBe(200);
  return r.j;
};
const EVRAK = (entityId: string, payload: Record<string, unknown> = { izin: { personel: 'Ayşe Yılmaz', baslangic: '21.10.2026', gun: 5 } }) =>
  ({ method: 'PersonelizinKaydetV2', payload, entityType: 'leaveRequest', entityId });
const evrakGonder = (b: Record<string, string>, govde: unknown): Promise<Yanit> => istek('POST', '/api/mikro/evrak/kaydet', b, govde);

/** Önceki süreçten kalmış kayıt: zamanı bu sürecin başlangıcından (şimdi − çalışma süresi) 1 dk önce — 30 günlük ölçüm penceresinde. */
const ONCEKI_AN = Math.floor(Date.now() - process.uptime() * 1000 - 60_000);
const ONCEKI_SUREC_KAYDI = { kayitTuru: 'olcum', companyId: KIRACI, method: 'ZiyaretKaydetV2', durum: 'suruyor', olusturmaAt: ONCEKI_AN, guncellemeAt: ONCEKI_AN };

beforeAll(async () => {
  yuklemeDizini = fs.mkdtempSync(path.join(os.tmpdir(), 'gonderim-olcum-'));
  process.env.PORT = '0';
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgres://sinama/yok';
  process.env.SESSION_TOKEN_SECRET = 'sinama-sirri';
  process.env.UPLOAD_DIR = yuklemeDizini;
  for (const ad of Object.keys(process.env)) {
    if (/^(STRIPE|RESEND|LUCA|SHOPIFY|SMTP|GEMINI|ANTHROPIC|MIKRO|IYZICO|TRENDYOL|HEPSIBURADA|DHL|UPS|FEDEX|YURTICI|MNG|ARAS|WHATSAPP|FIREBASE|GOOGLE_APPLICATION|OPS_|SERVER_TENANT_|SUPER_ADMIN)/.test(ad)) delete process.env[ad];
  }
  process.env.OPS_SUMMARY_TOKEN = OPS_JETONU;
  process.env.MIKRO_LOCAL = '0';
  process.env.MIKRO_API_URL = TABAN;
  Object.assign(process.env, { MIKRO_IDM_EMAIL: 'sinama@example.test', MIKRO_IDM_PASSWORD: 'sinama-parolasi', MIKRO_API_KEY: 'sinama-anahtari', MIKRO_ALIAS: 'olcum-takma' });
  globalThis.fetch = (async (girdi: unknown, init?: RequestInit) => {
    const url = String(typeof girdi === 'string' ? girdi : (girdi as { url?: string }).url ?? girdi);
    if (url === MIKRO_KIMLIK_URL) return belirtecReddi ? new Response('IDM kapalı', { status: 503 }) : jsonYanit({ access_token: 'olcum-belirteci', expires_in: 3600 });
    if (url.startsWith(`${TABAN}/`)) {
      const yontem = url.slice(TABAN.length + 1);
      mikroIstekleri.push({ yontem, at: Date.now() });
      return yanitlayici(yontem);
    }
    void init;
    return jsonYanit({});                                  // kur servisleri vb.: hiçbir istek ağa çıkmaz
  }) as typeof fetch;

  // Önceki süreçten kalmış yarım ölçüm kaydı — sunucu içe aktarılmadan ÖNCE (açılış işaretinin GERÇEK çağıranı sınanır).
  await import('pg');
  await pg().exec(DOCS_TABLOSU_DDL);
  await belgeKoy('mikroGonderimleri', 'o_onceki_surec', ONCEKI_SUREC_KAYDI);

  const dinleyiciCasusu = vi.spyOn(http, 'createServer');
  await import('../../server.ts');
  await bekle(() => dinleyiciCasusu.mock.results.some(r => r.type === 'return'), 150_000, 'sunucu dinleyicisi kuruldu');
  const cagri = dinleyiciCasusu.mock.calls.findIndex(a => typeof a[0] === 'function');
  sunucu = dinleyiciCasusu.mock.results[cagri].value as http.Server;
  dinleyiciCasusu.mockRestore();
  await bekle(() => sunucu?.listening === true, 30_000, 'sunucu dinliyor');
  kapiNo = (sunucu.address() as AddressInfo).port;
  await bekle(async () => {
    const r = await pg().query("SELECT to_regclass('docs') AS d, to_regclass('mfa_secrets') AS m");
    const t = r.rows[0]; return !!(t.d && t.m);
  }, 60_000, 'tablolar hazır');
}, 240_000);

afterAll(async () => {
  globalThis.fetch = gercekFetch;
  kancaKur(null);
  const s = sunucu;
  if (s) { s.closeAllConnections(); await new Promise<void>(r => s.close(() => r())); }
  if (yuklemeDizini) fs.rmSync(yuklemeDizini, { recursive: true, force: true });
}, 30_000);

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('açılış işareti — önceki süreçten kalan `suruyor` ölçüm kaydı açılışta `kesildi` (server.ts çağıranı)', () => {
  it('kayıt `kesildi` + `kesenSurec` (bu süreç); ops özetinde yayın başına kesilen 1', async () => {
    await bekle(async () => (await belgeOku('mikroGonderimleri', 'o_onceki_surec'))?.durum === 'kesildi', 10_000, 'açılış işareti');
    const k = await belgeOku('mikroGonderimleri', 'o_onceki_surec');
    expect(typeof k?.kesenSurec).toBe('number');
    expect(Number(k?.kesenSurec)).toBeLessThanOrEqual(Date.now());
    expect(k?.guncellemeAt).not.toBe(ONCEKI_SUREC_KAYDI.guncellemeAt);
    const o = await ozet();
    expect((o.surec as { sonAcilisIsareti: { kesilen: number } | null }).sonAcilisIsareti).toMatchObject({ kesilen: 1 });
    expect((o.olcum as { kesildiSurecBasina: Array<{ sayi: number }> }).kesildiSurecBasina).toEqual([
      { surecBaslangici: new Date(Number(k?.kesenSurec)).toISOString(), sayi: 1 },
    ]);
  });
});

describe('kip `kapali` (varsayılan) — yol ve yanıt bugünküyle BİREBİR; kayıt yok', () => {
  it('kip belgesi yok → ops özeti `kapali`; başarılı evrak → kayıt 0, yanıt bugünkü şekil', async () => {
    expect(await belgeOku('opsLocks', 'mikroGonderim:kip')).toBeUndefined();
    expect((await ozet()).kip).toMatchObject({ kip: 'kapali', gecmis: [] });
    const { b } = await yeniYonetici();
    const once = await kimlikler();
    const r = await evrakGonder(b, EVRAK('izin-kapali-1'));
    expect(r.s).toBe(200);
    expect(r.j).toEqual({ success: true, error: null, data: { evrakNo: 'IZN-0077' } });
    await new Promise(res => setTimeout(res, 100));
    expect(await yeniOlcumler(once)).toEqual([]);
  });

  it('başarı, Mikro reddi, fırlatma: yanıt bugünkü gövdeyle BİREBİR, Mikro\'ya TEK istek; defter koleksiyonuna sorgu YOK, tek ek kip okuması (10 sn\'de en çok 1)', async () => {
    const { b } = await yeniYonetici();
    // Bugünkü (daff960) işleyicinin üç yanıtı: `res.json({ success, error: errorMsg, data: r0?.Data ?? null })` ve `catch` → 500.
    const vektorler: Array<[Yanitlayici, number, Record<string, unknown>]> = [
      [BASARI, 200, { success: true, error: null, data: { evrakNo: 'IZN-0077' } }],
      [RET, 200, { success: false, error: 'Personel AYŞE YILMAZ bulunamadı', data: null }],
      [FIRLAT, 500, { success: false, error: 'fetch failed' }],
    ];
    const sorgular: Array<{ sql: string; p: unknown[] | undefined }> = [];
    kancaKur((sql, p) => { sorgular.push({ sql, p }); });
    const once = await kimlikler();
    try {
      for (const [y, durum, govde] of vektorler) {
        const istekOnce = mikroIstekleri.length;
        const r = await mikroIle(y, () => evrakGonder(b, EVRAK(`izin-kapali-vektor-${durum}-${String(govde.success)}`)));
        expect([r.s, r.j]).toEqual([durum, govde]);
        expect(mikroIstekleri.length - istekOnce, 'Mikro\'ya tek istek').toBe(1);
      }
      await new Promise(res => setTimeout(res, 100));
    } finally { kancaKur(null); }
    const defterSorgusu = sorgular.filter(s => s.sql.includes('mikroGonderimleri') || (s.p ?? []).includes('mikroGonderimleri'));
    expect(defterSorgusu, 'kapali: ölçüm kaydı açılmaz, yazılmaz').toEqual([]);
    const kipOkumasi = sorgular.filter(s => (s.p ?? []).includes('mikroGonderim:kip'));
    expect(kipOkumasi.length, 'kip okuması 10 sn önbellekli: üç istekte en çok 1').toBeLessThanOrEqual(1);
    expect(await yeniOlcumler(once)).toEqual([]);
  });
});

describe('kip `olcum` — yanıt `kapali` ile BİREBİR; her istek TEK gövdesiz ölçüm kaydı', () => {
  const vektorler: Array<[string, Yanitlayici, number]> = [['başarı', BASARI, 200], ['Mikro reddi (IsError)', RET, 200], ['fırlatma (bağlantı reddi)', FIRLAT, 500]];
  it.each(vektorler)('%s', async (_ad, y, durum) => {
    const { uid, b } = await yeniYonetici();
    const govde = EVRAK(`izin-${durum}-${uid}`);
    expect((await kipYaz('kapali', 'karşılaştırma: kapalı')).s).toBe(200);
    const once = await kimlikler();
    const kapali = await mikroIle(y, () => evrakGonder(b, govde));
    await new Promise(res => setTimeout(res, 50));
    expect(await yeniOlcumler(once), 'kapali → kayıt yok').toEqual([]);

    expect((await kipYaz('olcum', 'karşılaştırma: ölçüm')).s).toBe(200);
    const once2 = await kimlikler();
    const istekOnce = mikroIstekleri.length;
    const olcum = await mikroIle(y, () => evrakGonder(b, govde));
    expect(mikroIstekleri.length - istekOnce, 'Mikro\'ya tek istek').toBe(1);
    expect([olcum.s, olcum.metin]).toEqual([kapali.s, kapali.metin]);   // yanıt BİREBİR (M0.2)
    expect(olcum.s).toBe(durum);
    await bekle(async () => (await yeniOlcumler(once2)).some(s => s.data.durum === 'bitti'), 5_000, 'ölçüm sonucu yazıldı');
    const yeni = await yeniOlcumler(once2);
    expect(yeni).toHaveLength(1);
    const k = yeni[0].data;
    expect(k).toMatchObject({ kayitTuru: 'olcum', companyId: KIRACI, uc: '/api/mikro/evrak/kaydet', method: 'PersonelizinKaydetV2', entityType: 'leaveRequest', durum: 'bitti' });
    expect(k).toHaveProperty('gonderilmedi', false);
    expect(k).toHaveProperty('stub', false);
    expect(k.varlikOzeti).toMatch(/^[0-9a-f]{64}$/);
    expect(k.govdeOzeti).toMatch(/^[0-9a-f]{64}$/);
    // Gövde, düz entityId, sahip ve hata METNİ yok (M0.3, M0.11).
    const metin = JSON.stringify(k);
    for (const yasak of [govde.entityId, uid, 'sahipUid', 'Ayşe', 'AYŞE', 'bulunamadı', 'fetch failed', '10.9.8.7', 'IZN-0077']) expect(metin, yasak).not.toContain(yasak);
    expect(k).not.toHaveProperty('govde');
    expect(k).not.toHaveProperty('entityId');
  });

  it('stub yanıtı (`result` anahtarsız 200) → kayıtta `stub: true`, `gonderilmedi: false`; Mikro\'ya TEK istek; yanıt «OLABİLİR»; ops `olcum.stub` +1 (C14)', async () => {
    expect((await kipYaz('olcum', 'stub vektörü')).s).toBe(200);
    const { b } = await yeniYonetici();
    const stubOnce = ((await ozet()).olcum as { stub: number }).stub;
    const once = await kimlikler();
    const istekOnce = mikroIstekleri.length;
    const r = await mikroIle(STUB, () => evrakGonder(b, EVRAK('izin-stub-olcum')));
    expect([r.s, r.j]).toEqual([200, { success: false, error: MIKRO_STUB_METNI, data: null }]);
    expect(mikroIstekleri.length - istekOnce, 'stub — aynı gövde ikinci kez gitmedi').toBe(1);
    await bekle(async () => (await yeniOlcumler(once)).some(s => s.data.durum === 'bitti'), 5_000, 'ölçüm sonucu');
    const [k] = await yeniOlcumler(once);
    expect(k.data).toMatchObject({ stub: true, gonderilmedi: false, sonuc: { httpDurum: 200, jsonMu: true, resultUzunlugu: null, hataliOgeSayisi: null } });
    expect(JSON.stringify(k.data)).not.toContain(MIKRO_STUB_METNI);
    expect(((await ozet()).olcum as { stub: number }).stub - stubOnce).toBe(1);
  });

  it('belirteç alınamadı (`fetch` öncesi düşüş) → kayıtta `gonderilmedi: true`; Mikro yöntem isteği 0; yanıt bugünkü 500', async () => {
    expect((await kipYaz('olcum', 'gönderilmedi vektörü')).s).toBe(200);
    process.env.MIKRO_ALIAS = 'olcum-takma-belirtecsiz';      // önbellekte belirteci olmayan kimlik
    belirtecReddi = true;
    try {
      const { b } = await yeniYonetici();
      const once = await kimlikler();
      const istekOnce = mikroIstekleri.length;
      const r = await evrakGonder(b, EVRAK('izin-belirtecsiz'));
      expect(r.s).toBe(500);
      expect(String(r.j.error)).toMatch(/^Mikro token alınamadı \(503\)/);
      expect(mikroIstekleri.length - istekOnce).toBe(0);
      await bekle(async () => (await yeniOlcumler(once)).some(s => s.data.durum === 'bitti'), 5_000, 'ölçüm sonucu');
      const [k] = await yeniOlcumler(once);
      expect(k.data).toMatchObject({ gonderilmedi: true, stub: false, sonuc: { hataAdi: 'Error', httpDurum: null } });
      expect(JSON.stringify(k.data)).not.toContain('IDM kapalı');
    } finally { belirtecReddi = false; process.env.MIKRO_ALIAS = 'olcum-takma'; }
  });

  it('kayıt AÇILAMAZSA (INSERT hatası): Mikro\'ya yine 1 istek, yanıt birebir, ops sayacı 1 artar (M0.1)', async () => {
    const { b } = await yeniYonetici();
    expect((await kipYaz('olcum', 'insert hatası vektörü')).s).toBe(200);
    const beklenen = await evrakGonder(b, EVRAK('izin-insert-hata-karsilastirma'));
    const sayacOnce = ((await ozet()).surec as { kayitAcmaHatasi: number }).kayitAcmaHatasi;
    kancaKur((sql, p) => { if (defterInsertMi(sql, p)) throw new Error('disk dolu'); });
    try {
      const once = await kimlikler();
      const istekOnce = mikroIstekleri.length;
      const r = await evrakGonder(b, EVRAK('izin-insert-hata-karsilastirma'));
      expect(mikroIstekleri.length - istekOnce).toBe(1);
      expect([r.s, r.metin]).toEqual([beklenen.s, beklenen.metin]);
      await bekle(async () => ((await ozet()).surec as { kayitAcmaHatasi: number }).kayitAcmaHatasi === sayacOnce + 1, 5_000, 'sayaç');
      expect(await yeniOlcumler(once)).toEqual([]);
    } finally { kancaKur(null); }
  });

  it('kayıt Mikro çağrısını BEKLETMEZ: yavaş INSERT (400 ms) bitmeden Mikro isteği başlar ve yanıt döner (M0.7)', async () => {
    const { b } = await yeniYonetici();
    expect((await kipYaz('olcum', 'gecikme vektörü')).s).toBe(200);
    let insertBitti = 0;
    kancaKur(async (sql, p) => { if (defterInsertMi(sql, p)) { await new Promise(res => setTimeout(res, 400)); insertBitti = Date.now(); } });
    try {
      const once = await kimlikler();
      const istekOnce = mikroIstekleri.length;
      const r = await evrakGonder(b, EVRAK('izin-gecikme'));
      const yanitAt = Date.now();
      expect(r.s).toBe(200);
      const mikroAt = mikroIstekleri[istekOnce]?.at;
      expect(mikroAt).toBeDefined();
      expect(insertBitti === 0 || (mikroAt !== undefined && mikroAt < insertBitti), 'Mikro isteği INSERT bitmeden başladı').toBe(true);
      expect(insertBitti === 0 || yanitAt < insertBitti, 'yanıt INSERT\'i beklemedi').toBe(true);
      await bekle(async () => (await yeniOlcumler(once)).some(s => s.data.durum === 'bitti'), 5_000, 'sonuç INSERT\'ten sonra yazıldı');
    } finally { kancaKur(null); }
  });

  it('kurucu hesap (`users` belgesinde companyId yok): kayıt bugünkü okumayla `companyId = uid`; ops çıktısı uid\'i İÇERMEZ (M0.5)', async () => {
    const { uid, b } = await yeniYonetici(true);
    expect((await kipYaz('olcum', 'kurucu vektörü')).s).toBe(200);
    const once = await kimlikler();
    expect((await evrakGonder(b, EVRAK('izin-kurucu-ozel-kimlik'))).s).toBe(200);
    await bekle(async () => (await yeniOlcumler(once)).some(s => s.data.durum === 'bitti'), 5_000, 'ölçüm');
    expect((await yeniOlcumler(once))[0].data.companyId).toBe(uid);
    const metin = (await istek('GET', '/api/ops/mikro-gonderim-ozet', OPS)).metin;
    for (const yasak of [uid, 'izin-kurucu-ozel-kimlik', KIRACI, 'Ayşe', 'olcum-yonetici-']) expect(metin, yasak).not.toContain(yasak);
  });
});

describe('ops uçları — jeton, özet, kip yazımı', () => {
  it('jetonsuz / yanlış jeton → 401 (iki uç); kimlikli kullanıcı da jetonsuz giremez', async () => {
    const { b } = await yeniYonetici();
    for (const bas of [{}, { 'X-Ops-Token': 'yanlis' }, b]) {
      expect((await istek('GET', '/api/ops/mikro-gonderim-ozet', bas)).s).toBe(401);
      expect((await istek('POST', '/api/ops/mikro-gonderim-kipi', bas, { kip: 'olcum', neden: 'x' })).s).toBe(401);
    }
  });

  it('kip POST: `neden`siz 400, 201 karakter 400, `tam` / `durdur` / tanınmayan 400; geçerli yazım 200 ve geçmişe girer (M0.12)', async () => {
    expect((await istek('POST', '/api/ops/mikro-gonderim-kipi', OPS, { kip: 'olcum' })).s).toBe(400);
    expect((await kipYaz('olcum', '')).s).toBe(400);
    expect((await kipYaz('olcum', 'ç'.repeat(201))).s).toBe(400);
    for (const kip of ['tam', 'durdur', 'acik']) {
      const r = await kipYaz(kip);
      expect(r.s, kip).toBe(400);
      expect(String(r.j.error)).toMatch(/kip/);
    }
    const r = await kipYaz('kapali', 'ops geçmiş sınaması');
    expect(r.s).toBe(200);
    expect(r.j).toMatchObject({ success: true, kip: 'kapali' });
    const k = (await ozet()).kip as { kip: string; gecmis: Array<{ neden: string }> };
    expect(k.kip).toBe('kapali');
    expect(k.gecmis.at(-1)?.neden).toBe('ops geçmiş sınaması');
    expect(k.gecmis.length).toBeLessThanOrEqual(10);
  });

  it('`syncJobs` sayıları (C1): durum başına, son 30 günde ölü, en eski createdAt', async () => {
    const simdi = Date.now();
    await belgeKoy('syncJobs', 'j-kuyrukta', { status: 'queued', createdAt: simdi - 3_600_000, updatedAt: simdi - 3_600_000, companyId: KIRACI, payload: { gizli: 'Ayşe' } });
    await belgeKoy('syncJobs', 'j-olu-yeni', { status: 'dead', createdAt: simdi - 10 * 86_400_000, updatedAt: simdi - 2 * 86_400_000, companyId: KIRACI });
    await belgeKoy('syncJobs', 'j-olu-eski', { status: 'dead', createdAt: simdi - 60 * 86_400_000, updatedAt: simdi - 40 * 86_400_000, companyId: KIRACI });
    const o = await ozet();
    expect(o.syncJobs).toEqual({
      toplam: 3, durumBasina: { queued: 1, dead: 2 }, son30GunOlu: 1,
      enEskiCreatedAt: new Date(simdi - 60 * 86_400_000).toISOString(),
    });
    expect(JSON.stringify(o)).not.toContain('Ayşe');
  });

  it('stub sayacı (BULUT): genel evrak stub → `sayi` 1, `atlanan` 1 (ikinci gönderim YOK)', async () => {
    const { b } = await yeniYonetici();
    const once = mikroIstekleri.filter(m => m.yontem === 'BakimSozlesmeKaydetV2').length;
    const r = await mikroIle(STUB, () => evrakGonder(b, { method: 'BakimSozlesmeKaydetV2', payload: { sozlesme: 1 }, entityType: 'bakimSozlesme', entityId: 's-1' }));
    expect(r.j).toMatchObject({ success: false });
    expect(mikroIstekleri.filter(m => m.yontem === 'BakimSozlesmeKaydetV2').length - once).toBe(1);
    const sayac = ((await ozet()).stubSayaci as { yontemler: Record<string, { sayi: number; atlanan: number }> }).yontemler.BakimSozlesmeKaydetV2;
    expect([sayac.sayi, sayac.atlanan]).toEqual([1, 1]);
  });

  it('tekrar ölçüleri (C10): aynı içerik 15 dk içinde ikinci kez; aynı varlık 7 gün içinde ikinci kez, ikincisi başarılı', async () => {
    const { b } = await yeniYonetici();
    expect((await kipYaz('olcum', 'tekrar vektörü')).s).toBe(200);
    const onceki = (await ozet()).olcum as { tekrar: { ayniGovde15dk: number; ayniVarlik7gun: { toplam: number; ikincisiBasarili: number } } };
    const govde = EVRAK('izin-tekrar', { izin: { gun: 3, tekrar: true } });
    const once = await kimlikler();
    await mikroIle(RET, () => evrakGonder(b, govde));
    await evrakGonder(b, govde);
    await bekle(async () => (await yeniOlcumler(once)).filter(s => s.data.durum === 'bitti').length === 2, 5_000, 'iki ölçüm');
    const sonra = (await ozet()).olcum as typeof onceki;
    expect(sonra.tekrar.ayniGovde15dk - onceki.tekrar.ayniGovde15dk).toBe(1);
    expect(sonra.tekrar.ayniVarlik7gun.toplam - onceki.tekrar.ayniVarlik7gun.toplam).toBe(1);
    expect(sonra.tekrar.ayniVarlik7gun.ikincisiBasarili - onceki.tekrar.ayniVarlik7gun.ikincisiBasarili).toBe(1);
  });
});

describe('SERVER_ONLY — defter `/api/db`\'ye ve akışa kapalı (M0.20)', () => {
  it('`GET /api/db/mikroGonderimleri` (Yönetici) → 403; tek belge de 403', async () => {
    const { b } = await yeniYonetici();
    expect((await istek('GET', '/api/db/mikroGonderimleri', b)).s).toBe(403);
    expect((await istek('GET', '/api/db/mikroGonderimleri/o_onceki_surec', b)).s).toBe(403);
  });

  it('akış (SSE): ilk veride ve değişiklik olayında defter satırı YOK', async () => {
    const { b } = await yeniYonetici();
    const tok = encodeURIComponent(b.Authorization.replace(/^Bearer /, ''));
    const akis = await akisAc(`/api/db/stream?colls=inventory,mikroGonderimleri&token=${tok}`);
    expect(akis.s).toBe(200);
    await bekle(() => akis.govde().includes('event: init'), 10_000, 'akış ilk veri');
    expect((await kipYaz('olcum', 'akış vektörü')).s).toBe(200);
    const once = await kimlikler();
    expect((await evrakGonder(b, EVRAK('izin-akis'))).s).toBe(200);
    await bekle(async () => (await yeniOlcumler(once)).some(s => s.data.durum === 'bitti'), 5_000, 'ölçüm');
    await new Promise(res => setTimeout(res, 200));
    const gelen = akis.govde();
    akis.kapat();
    // Akış istenen koleksiyon için boş bir `init` yollar (SERVER_ONLY satırları `rowVisible`'da düşer — `opsLocks` ile aynı); satır YOK.
    const olaylar = gelen.split('\n\n').filter(p => p.includes('mikroGonderimleri'));
    expect(olaylar).toEqual(['event: init\ndata: {"coll":"mikroGonderimleri","docs":[]}']);
    expect(gelen).not.toContain('kayitTuru');
    expect(gelen).not.toContain('o_onceki_surec');
    expect(gelen).not.toContain('"o_');
  });
});
