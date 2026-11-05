// @vitest-environment node
/**
 * turetilenAlanlar.b.zincir.test.ts: şartname «Mikro bağlantı B» (05.11.2026) sunucunun TÜRETTİĞİ alanlar istemciye KAPALI.
 * GERÇEK `server.ts` + GERÇEK express zinciri + GERÇEK SQL (PGlite; `docs` canlıyla aynı DDL). Düzenek `siparisKaynakKapisi.zincir.test`
 * kalıbıdır (sahte olan yalnız süreç dışına çıkanlar).
 *
 *   • T-B2-3: `orders.mfKaynaksiz` / `mfKaynaksizGoruldu` (kaynaksız MF işareti) istemci PUT / PUT?merge=1 / PATCH / tünel PATCH /
 *     cas ile YAZILAMAZ ve SİLİNEMEZ (rolden bağımsız); sunucunun pgShim `update`'i (ör. iptal eşlemesi) işareti SİLEMEZ.
 *   • BH20: `bankAccounts` / `kasalar` bakiye izi (`bakiyeKaynagi`, `bakiyeZamani`, `bakiyeHareketAdedi`, `bakiyeNotu`) istemciye
 *     kapalı; `balance` / `bakiye` açık kalır (elle hesapta meşru değer).
 * Mutasyon (yapılıp geri alındı, raporda): alanlar `SUNUCU_TURETILEN_ALANLAR`'dan çıkarılırsa ilgili testler kırmızı.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { MF_KAYNAGI, MF_KIMLIK_ONEKI } from '../lib/mfKaynagi';
import { BAKIYE_TURETILEN_ALANLAR } from '../lib/collections';

// ── Sahteler (yalnız süreç dışına çıkanlar) ────────────────────────────────────────────────────────────────────────────────
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
  g.__turetilenPg = db;
  const q = async (text: unknown, params?: unknown[]) => {
    let sql = String(text); let p = params;
    if (text && typeof text === 'object') { const o = text as { text: string; values?: unknown[] }; sql = o.text; p = o.values; }
    let sonuc: { rows: unknown[]; rowCount: number | null };
    if (!p || p.length === 0) {
      const r = await db.exec(sql);
      const son = r[r.length - 1];
      sonuc = son ? { rows: son.rows, rowCount: son.affectedRows ?? son.rows.length } : { rows: [], rowCount: null };
    } else {
      const r = await db.query(sql, p);
      sonuc = { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
    }
    // Yarış kancası (faturaCiftKesim T24 kalıbı): sorgu KOŞTUKTAN sonra, sonucu çağırana vermeden — «SELECT önce, yazım sonra».
    const kanca = g.__turetilenPgKanca as ((sql: string, p: unknown[] | undefined) => Promise<void> | void) | undefined;
    if (kanca) await kanca(sql, p);
    return sonuc;
  };
  class Pool { query = q; async connect() { return { query: q, release() {} }; } on() {} async end() {} }
  class Client { query = q; async connect() {} async end() {} on() {} }
  return { default: { Pool, Client }, Pool, Client };
});

vi.setConfig({ testTimeout: 90_000 });

// ── Düzenek ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
interface Pg { query: (sql: string, p?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> }
const G = globalThis as Record<string, unknown>;
const pg = (): Pg => G.__turetilenPg as Pg;

let sunucu: http.Server | undefined;
let kapiNo = 0;
let yuklemeDizini = '';
const gercekFetch = globalThis.fetch;

const KIRACI = 'CETPA';
const BASKA_KIRACI = 'BASKA-FIRMA';
const MIKRO_TABAN = 'https://mikro.ornek.test:8094/Api/APIMethods';
const SUPER_EPOSTA = 'super@example.test';
const eposta = (uid: string): string => `${uid.toLowerCase()}@example.test`;
const belirtec = (uid: string, ep = eposta(uid)): Record<string, string> => ({ Authorization: `Bearer ${uid}|${ep}|1` });
const YONETICI = belirtec('ic-Admin');
const SATIS = belirtec('ic-Sales');
const SUPER = belirtec('super-1', SUPER_EPOSTA);   // belgesi VAR (Yönetici, bu kiracı) VE doğrulanmış e-postası SUPER_ADMIN_EMAILS'te
const ROLLER: Array<[ad: string, b: Record<string, string>]> = [['Satış', SATIS], ['Yönetici', YONETICI], ['süper yönetici', SUPER]];

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
    q.setTimeout(60_000, () => q.destroy(new Error(`zaman aşımı: ${yontem} ${yol}`)));
    q.on('error', reddet);
    if (veri !== undefined) q.write(veri);
    q.end();
  });
}
const bekle = async (kosul: () => boolean | Promise<boolean>, ms: number, ne: string): Promise<void> => {
  const son = Date.now() + ms;
  while (Date.now() < son) { if (await kosul()) return; await new Promise(r => setTimeout(r, 20)); }
  throw new Error(`beklenen olmadı (${ms} ms): ${ne}`);
};

const belgeKoy = (coll: string, id: string, data: Record<string, unknown>): Promise<unknown> =>
  pg().query('INSERT INTO docs (coll, id, data) VALUES ($1, $2, $3::jsonb) ON CONFLICT (coll, id) DO UPDATE SET data = EXCLUDED.data', [coll, id, JSON.stringify(data)]);
const belgeOku = async (coll: string, id: string): Promise<Record<string, unknown> | undefined> =>
  (await pg().query('SELECT data FROM docs WHERE coll = $1 AND id = $2', [coll, id])).rows[0]?.data as Record<string, unknown> | undefined;

const SECIM_YOK = Symbol('yok');
const alanOku = async (coll: string, id: string, alan: string): Promise<unknown> => {
  const s = await belgeOku(coll, id);
  return s && Object.prototype.hasOwnProperty.call(s, alan) ? s[alan] : SECIM_YOK;
};
let sayac = 0;
const ISARET = { mfKaynaksiz: true, mfKaynaksizGoruldu: '2026-11-06T00:20:00.000Z' };
const mfKur = async (ek: Record<string, unknown> = {}): Promise<string> => {
  const n = ++sayac;
  const id = `${MF_KIMLIK_ONEKI}${KIRACI}__TB-${n}`;
  await belgeKoy('orders', id, { companyId: KIRACI, source: MF_KAYNAGI, status: 'Processing', totalPrice: 1200, faturali: true,
    mikroEvrak: { seri: 'TB', sira: n }, mikroFaturaNo: `TB${n}`, customerName: 'Şirin Yapı Malzemeleri', notes: 'ilk', ...ek });
  return id;
};
const hesapKur = async (coll: 'bankAccounts' | 'kasalar', ek: Record<string, unknown> = {}): Promise<string> => {
  const id = `${coll}-${++sayac}`;
  await belgeKoy(coll, id, { companyId: KIRACI, source: 'mikro', ...(coll === 'bankAccounts' ? { bankName: 'ZİRAAT', balance: null } : { kasaAdi: 'MERKEZ', bakiye: null }), ...ek });
  return id;
};

beforeAll(async () => {
  yuklemeDizini = fs.mkdtempSync(path.join(os.tmpdir(), 'turetilen-alanlar-b-'));
  process.env.PORT = '0';
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgres://sinama/yok';      // yalnız «PG var» dalını açar; havuz PGlite
  process.env.SESSION_TOKEN_SECRET = 'sinama-sirri';
  process.env.UPLOAD_DIR = yuklemeDizini;
  for (const ad of Object.keys(process.env)) {
    if (/^(STRIPE|RESEND|LUCA|SHOPIFY|SMTP|GEMINI|ANTHROPIC|MIKRO|IYZICO|TRENDYOL|HEPSIBURADA|DHL|UPS|FEDEX|YURTICI|MNG|ARAS|WHATSAPP|FIREBASE|GOOGLE_APPLICATION|OPS_|SERVER_TENANT_|SUPER_ADMIN)/.test(ad)) delete process.env[ad];
  }
  process.env.SUPER_ADMIN_EMAILS = SUPER_EPOSTA;          // modül sabiti: server.ts içe aktarılmadan ÖNCE
  process.env.MIKRO_API_URL = MIKRO_TABAN;
  process.env.MIKRO_LOCAL = '0';
  process.env.MIKRO_JUMP_SURUM = '17';
  process.env.MIKRO_IDM_EMAIL = 'srv@example.test';
  process.env.MIKRO_IDM_PASSWORD = 'sinama-parolasi';
  process.env.MIKRO_API_KEY = 'sinama-anahtari';
  process.env.MIKRO_ALIAS = 'sinama';
  // Dışarı giden HİÇBİR istek yok: bu dosya Mikro'yu çağırmaz; olası bir çağrı boş yanıt alır.
  globalThis.fetch = (async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch;

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
    return !!(r.rows[0].d && r.rows[0].m);
  }, 60_000, 'tablolar hazır');

  for (const rol of ['Admin', 'Sales'] as const) await belgeKoy('users', `ic-${rol}`, { email: eposta(`ic-${rol}`), role: rol, companyId: KIRACI });
  await belgeKoy('users', 'super-1', { email: SUPER_EPOSTA, role: 'Admin', companyId: KIRACI });
  await belgeKoy('users', 'yabanci-Admin', { email: eposta('yabanci-Admin'), role: 'Admin', companyId: BASKA_KIRACI });
}, 240_000);

afterAll(async () => {
  globalThis.fetch = gercekFetch;
  G.__kaynakPgKanca = undefined;
  const s = sunucu;
  if (s) { s.closeAllConnections(); await new Promise<void>(r => s.close(() => r())); }
  if (yuklemeDizini) fs.rmSync(yuklemeDizini, { recursive: true, force: true });
}, 30_000);


// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('T-B2-3 · kaynaksız MF işareti istemciye kapalı (rolden bağımsız, sessiz)', () => {
  for (const [ad, b] of ROLLER) {
    it(`${ad}: işaretli siparişte işaret PUT / PUT?merge=1 / PATCH / tünel PATCH / cas ile SİLİNEMEZ ve DEĞİŞMEZ; öteki alanlar yazılır`, async () => {
      const id = await mfKur(ISARET);
      const kaldi = async (adim: string) => {
        expect(await alanOku('orders', id, 'mfKaynaksiz'), adim).toBe(true);
        expect(await alanOku('orders', id, 'mfKaynaksizGoruldu'), adim).toBe(ISARET.mfKaynaksizGoruldu);
      };
      const put = await istek('PUT', `/api/db/orders/${id}`, b, { customerName: 'Şirin Yapı Malzemeleri', status: 'Processing', notes: 'put' });
      expect(put.s, put.metin).toBe(200);
      await kaldi('PUT (alan yok)');
      for (const govde of [{ mfKaynaksiz: false }, { mfKaynaksiz: null, mfKaynaksizGoruldu: null }]) {
        const r = await istek('PUT', `/api/db/orders/${id}?merge=1`, b, { ...govde, notes: 'merge' });
        expect(r.s, r.metin).toBe(200);
        await kaldi(`PUT?merge=1 ${JSON.stringify(govde)}`);
        const p = await istek('PATCH', `/api/db/orders/${id}`, b, { ...govde, notes: 'patch' });
        expect(p.s, p.metin).toBe(200);
        await kaldi(`PATCH ${JSON.stringify(govde)}`);
        const t = await istek('POST', `/api/db/orders/${id}`, { ...b, 'X-Cetpa-Method': 'PATCH' }, { ...govde, notes: 'tunel' });
        expect(t.s, t.metin).toBe(200);
        await kaldi(`tünel PATCH ${JSON.stringify(govde)}`);
      }
      const c = await istek('PATCH', `/api/db/orders/${id}/cas`, b, { field: 'status', expect: 'Processing', set: { mfKaynaksiz: false, notes: 'cas' } });
      expect([c.s, c.j.claimed], c.metin).toEqual([200, true]);
      await kaldi('cas');
      expect((await belgeOku('orders', id))?.notes).toBe('cas');
    });

    it(`${ad}: işaretsiz MF'ye ve yeni kayda işaret YAZILAMAZ (POST, PATCH, PUT?merge=1, cas)`, async () => {
      const id = await mfKur();
      for (const [adim, r] of [
        ['PATCH', await istek('PATCH', `/api/db/orders/${id}`, b, { ...ISARET, notes: 'p' })],
        ['PUT?merge=1', await istek('PUT', `/api/db/orders/${id}?merge=1`, b, { ...ISARET, notes: 'm' })],
        ['cas', await istek('PATCH', `/api/db/orders/${id}/cas`, b, { field: 'status', expect: 'Processing', set: ISARET })],
      ] as const) {
        expect(r.s, `${adim} ${r.metin}`).toBe(200);
        expect(await alanOku('orders', id, 'mfKaynaksiz'), adim).toBe(SECIM_YOK);
        expect(await alanOku('orders', id, 'mfKaynaksizGoruldu'), adim).toBe(SECIM_YOK);
      }
      const p = await istek('POST', '/api/db/orders', b, { customerName: 'Yeni', ...ISARET });
      expect(p.s, p.metin).toBe(200);
      expect(await belgeOku('orders', String(p.j.id))).not.toHaveProperty('mfKaynaksiz');
    });
  }

  it('sunucu içi pgShim `update` / `set(merge)` (iptal eşlemesi, kalem dolumu) işareti SİLEMEZ; `mfKaynaksiz: null` sessizce düşer', async () => {
    const { PgFirestore } = await import('./pgShim');
    const pgModul = await import('pg');
    const db = new PgFirestore(new pgModul.default.Pool());
    const id = await mfKur(ISARET);
    await db.collection('orders').doc(id).update({ status: 'Shipped', mfKaynaksiz: null, mfKaynaksizGoruldu: null });
    await db.collection('orders').doc(id).set({ lineItems: [{ sku: 'CIM-50', quantity: 1 }], mfKaynaksiz: false }, { merge: true });
    expect(await belgeOku('orders', id)).toMatchObject({ status: 'Shipped', ...ISARET, lineItems: [{ sku: 'CIM-50', quantity: 1 }] });
  });
});

describe('BH20 · banka / kasa bakiye izi istemciye kapalı; `balance` / `bakiye` açık', () => {
  const IZ = { bakiyeKaynagi: 'mikro-gece', bakiyeZamani: '2026-11-06T00:20:00.000Z', bakiyeHareketAdedi: 4, bakiyeNotu: null };
  for (const [coll, alan] of [['bankAccounts', 'balance'], ['kasalar', 'bakiye']] as const) {
    it(`${coll}: dört alan PUT / PATCH / cas ile yazılamaz ve silinemez; ${alan} yazılır`, async () => {
      expect([...BAKIYE_TURETILEN_ALANLAR].sort()).toEqual(Object.keys(IZ).sort());
      const izli = await hesapKur(coll, IZ);
      const sahte = { bakiyeKaynagi: 'elle', bakiyeZamani: '2099-01-01T00:00:00.000Z', bakiyeHareketAdedi: 0, bakiyeNotu: 'uydurma' };
      const put = await istek('PUT', `/api/db/${coll}/${izli}`, YONETICI, { companyId: KIRACI, source: 'mikro', [alan]: 5 });
      expect(put.s, put.metin).toBe(200);
      const pa = await istek('PATCH', `/api/db/${coll}/${izli}`, YONETICI, { ...sahte, notlar: 'x' });
      expect(pa.s, pa.metin).toBe(200);
      const nul = await istek('PATCH', `/api/db/${coll}/${izli}`, YONETICI, { bakiyeKaynagi: null, bakiyeZamani: null });
      expect(nul.s, nul.metin).toBe(200);
      const satir = await belgeOku(coll, izli);
      expect(satir).toMatchObject({ ...IZ, [alan]: 5 });
      // İzsiz (henüz gece hesabından geçmemiş) belgeye iz yazılamaz: geçişin `NOT (data ? 'bakiyeZamani')` koşulu istemciyle aşılamaz.
      const izsiz = await hesapKur(coll, { [alan]: 0 });
      const p = await istek('PATCH', `/api/db/${coll}/${izsiz}`, YONETICI, sahte);
      expect(p.s, p.metin).toBe(200);
      const c = await istek('PATCH', `/api/db/${coll}/${izsiz}/cas`, YONETICI, { field: 'source', expect: 'mikro', set: sahte });
      expect(c.s, c.metin).toBe(200);
      const s2 = await belgeOku(coll, izsiz);
      for (const k of BAKIYE_TURETILEN_ALANLAR) expect(s2, k).not.toHaveProperty(k);
      expect(s2?.[alan]).toBe(0);
    });
  }
});
