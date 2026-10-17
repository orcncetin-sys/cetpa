// @vitest-environment node
/**
 * surum.zincir.test.ts — `GET /api/surum`, GERÇEK `server.ts` + GERÇEK express zinciriyle (şartname
 * `.wf/SARTNAME-yeni-surum-bildirimi.md` S2, T2). Düzenek `kucukKapanislar.zincir.test.ts` ile AYNI kalıptır.
 *
 * NEDEN GERÇEK ZİNCİR: uç «bir rota + bir sınırlayıcı»dır; asıl risk bağlamadadır — rota kaydedilmedi, genel sınırlayıcının
 * arkasına düştü (sekmeler genel kimliksiz kovayı doldurur), bir kimlik kapısının arkasına girdi (giriş ekranı ve dış rol
 * sayfası soramaz). Modülün kendisi src/server/routes/surumRoutes.test.ts'te; burada server.ts olduğu gibi içe aktarılır.
 *
 * `dist/surum.json`: sunucu çalışma dizinindeki `dist/`ten okur. Bu sınama çalışma ağacına YAZMAZ: beklenen değer aynı dosyanın
 * aynı okuyucuyla okunmasıdır (derleme yoksa `null`). Dosya varken / yokken davranış modül sınamasında.
 *
 * SAHTE OLANLAR (yalnız süreç dışına çıkanlar): Firebase belirteç doğrulayıcısı, `pg` (süreç içi PGlite), pg-boss, node-cron, vite,
 * `dotenv` (hiçbir ortam dosyası YÜKLENMEZ), dışarı giden `fetch`. Canlıya, Firebase'e, Mikro'ya istek YOK; sunucu `PORT=0`.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { SURUM_DOSYASI, SURUM_UCU } from '../lib/surumKimligi';
import { surumDosyasiniOku } from './routes/surumRoutes';

vi.mock('dotenv', () => ({ default: { config: () => ({ parsed: {} }) }, config: () => ({ parsed: {} }) }));
vi.mock('firebase-admin/auth', () => ({
  getAuth: () => ({
    // Belirteç biçimi: "<uid>|<e-posta>|<1|0>" — imza yok; yalnız bu sınamada.
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
  g.__surumZincirPg = db;
  const q = async (text: unknown, params?: unknown[]) => {
    let sql = String(text); let p = params;
    if (text && typeof text === 'object') { const o = text as { text: string; values?: unknown[] }; sql = o.text; p = o.values; }
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

interface Pg { query: (sql: string, p?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> }
const pg = (): Pg => (globalThis as Record<string, unknown>).__surumZincirPg as Pg;
interface Katman { name?: string; handle: (...a: unknown[]) => unknown; route?: { path: unknown; methods: Record<string, boolean>; stack: Katman[] } }
interface Uygulama { router: { stack: Katman[] } }

let sunucu: http.Server | undefined;
let uygulama: Uygulama | undefined;
let kapiNo = 0;
let yuklemeDizini = '';
const gercekFetch = globalThis.fetch;

interface Yanit { s: number; j: Record<string, unknown>; metin: string; basliklar: http.IncomingHttpHeaders }
function istek(yontem: string, yol: string, basliklar: Record<string, string>): Promise<Yanit> {
  return new Promise((coz, reddet) => {
    const q = http.request({ host: '127.0.0.1', port: kapiNo, method: yontem, path: yol, agent: false, headers: basliklar }, r => {
      const durum = r.statusCode;
      if (durum === undefined) { reddet(new Error(`durum kodu yok: ${yontem} ${yol}`)); return; }
      const parcalar: Buffer[] = [];
      r.on('data', (p: Buffer) => parcalar.push(p));
      r.on('end', () => {
        const metin = Buffer.concat(parcalar).toString('utf8');
        let j: Record<string, unknown> = {};
        try { const o: unknown = JSON.parse(metin); if (o && typeof o === 'object' && !Array.isArray(o)) j = o as Record<string, unknown>; } catch { /* düz metin */ }
        coz({ s: durum, j, metin, basliklar: r.headers });
      });
    });
    q.setTimeout(20_000, () => q.destroy(new Error(`zaman aşımı: ${yontem} ${yol}`)));
    q.on('error', reddet);
    q.end();
  });
}
const bekle = async (kosul: () => boolean | Promise<boolean>, ms: number, ne: string): Promise<void> => {
  const son = Date.now() + ms;
  while (Date.now() < son) { if (await kosul()) return; await new Promise(r => setTimeout(r, 50)); }
  throw new Error(`beklenen olmadı (${ms} ms): ${ne}`);
};
/** Vekilin yazdığı istemci IP'si (her bölüm kendi IP'siyle, kovalar karışmasın). */
const ip = (n: number): Record<string, string> => ({ 'X-Forwarded-For': `10.77.0.${n}` });

beforeAll(async () => {
  yuklemeDizini = fs.mkdtempSync(path.join(os.tmpdir(), 'surum-zincir-'));
  process.env.PORT = '0';
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgres://sinama/yok';      // yalnız «PG var» dalını açar; havuz PGlite
  process.env.SESSION_TOKEN_SECRET = 'sinama-sirri';
  process.env.UPLOAD_DIR = yuklemeDizini;
  for (const ad of Object.keys(process.env)) {
    if (/^(STRIPE|RESEND|LUCA|SHOPIFY|SMTP|GEMINI|ANTHROPIC|MIKRO|IYZICO|TRENDYOL|HEPSIBURADA|DHL|UPS|FEDEX|YURTICI|MNG|ARAS|WHATSAPP|FIREBASE|GOOGLE_APPLICATION|OPS_|SERVER_TENANT_|SUPER_ADMIN)/.test(ad)) delete process.env[ad];
  }
  globalThis.fetch = (async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch;

  const dinleyiciCasusu = vi.spyOn(http, 'createServer');
  await import('../../server.ts');
  await bekle(() => dinleyiciCasusu.mock.results.some(r => r.type === 'return'), 150_000, 'sunucu dinleyicisi kuruldu');
  const cagri = dinleyiciCasusu.mock.calls.findIndex(a => typeof a[0] === 'function');
  uygulama = dinleyiciCasusu.mock.calls[cagri][0] as unknown as Uygulama;
  sunucu = dinleyiciCasusu.mock.results[cagri].value as http.Server;
  dinleyiciCasusu.mockRestore();
  await bekle(() => sunucu?.listening === true, 30_000, 'sunucu dinliyor');
  kapiNo = (sunucu.address() as AddressInfo).port;
  await bekle(async () => !!(await pg().query("SELECT to_regclass('docs') AS d")).rows[0]?.d, 60_000, 'tablolar hazır');
}, 240_000);

afterAll(async () => {
  globalThis.fetch = gercekFetch;
  const s = sunucu;
  if (s) { s.closeAllConnections(); await new Promise<void>(r => s.close(() => r())); }
  if (yuklemeDizini) fs.rmSync(yuklemeDizini, { recursive: true, force: true });
}, 30_000);

describe('GET /api/surum — gerçek server.ts zinciri', () => {
  it('rota TAM BİR KEZ kayıtlı, yalnız GET; zincir = kendi sınırlayıcısı + işleyici (kimlik kapısı YOK)', () => {
    if (!uygulama) throw new Error('uygulama yakalanmadı');
    const bulunan = uygulama.router.stack.filter(k => k.route && k.route.path === SURUM_UCU);
    expect(bulunan).toHaveLength(1);
    const rota = bulunan[0].route;
    if (!rota) throw new Error('rota yok');
    expect(Object.keys(rota.methods).filter(m => rota.methods[m])).toEqual(['get']);
    expect(rota.stack).toHaveLength(2);
    expect(typeof (rota.stack[0].handle as unknown as { resetKey?: unknown }).resetKey).toBe('function');   // express-rate-limit örneği
    expect(rota.stack.map(k => k.name)).not.toContain('requireAuth');
  });

  it('kimliksiz 200 `{ surum }`, no-store, gövdede başka alan yok; değer `dist/surum.json`la aynı (derleme yoksa null)', async () => {
    const beklenen = await surumDosyasiniOku(path.join(process.cwd(), 'dist', SURUM_DOSYASI));
    const r = await istek('GET', SURUM_UCU, ip(1));
    expect(r.s, r.metin).toBe(200);
    expect(r.basliklar['cache-control']).toBe('no-store');
    expect(Object.keys(r.j)).toEqual(['surum']);
    expect(r.j.surum).toBe(beklenen);
  });

  it('belirteç ne olursa olsun aynı yanıt: geçersiz belirteç, rolsüz hesap → 200 (giriş ekranı ve dış rol sayfası da sorar)', async () => {
    for (const b of [{ Authorization: 'Bearer gecersiz.token.degeri' }, { Authorization: 'Bearer rolsuz-1|rolsuz-1@example.test|1' }]) {
      const r = await istek('GET', SURUM_UCU, { ...ip(2), ...b });
      expect(r.s, r.metin).toBe(200);
      expect(Object.keys(r.j)).toEqual(['surum']);
    }
  });

  it('KENDİ kovası (IP başına 120 / dk): genel kimliksiz kova (300 / 15 dk) bu uçtan SAYILMAZ; tavan aşılınca 429', async () => {
    const ilk = await istek('GET', SURUM_UCU, ip(3));
    expect(ilk.basliklar['ratelimit-limit']).toBe('120');
    for (let i = 0; i < 119; i++) await istek('GET', SURUM_UCU, ip(3));
    expect((await istek('GET', SURUM_UCU, ip(3))).s).toBe(429);
    // Aynı IP'nin genel kovası el değmemiş: kimliksiz bir /api ucunda kalan hak tam tavanın bir eksiği.
    const genel = await istek('GET', '/api/settings/exchange-rates', ip(3));
    expect(genel.basliklar['ratelimit-limit']).toBe('300');
    expect(genel.basliklar['ratelimit-remaining']).toBe('299');
  });

  it('yalnız GET: POST aynı yolda işleyiciye ulaşmaz (sürüm kimliği dönmez)', async () => {
    const r = await istek('POST', SURUM_UCU, { ...ip(4), 'Content-Type': 'application/json' });
    expect(r.s).not.toBe(200);
    expect(r.j).not.toHaveProperty('surum');
  });
});
