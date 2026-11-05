// @vitest-environment node
/**
 * dekontFaturaKapisi.zincir.test.ts — dekont yolları FATURA evrak tipini yazamaz (şartname `.wf/SARTNAME-q-serisi-v3.md` Q13 +
 * «Kapı sonrası hükümler» QH9, 2026-11-05; test T8 EK; mutasyonlar M7, M39, M40), GERÇEK `server.ts` + GERÇEK express zinciriyle.
 *
 * ANA İDDİA: `POST /api/mikro/evrak/kaydet` + `DekontKaydetV2` gövdesinin HERHANGİ bir `evraklar[i].satirlar[j]` satırı fatura
 * evrakıysa (satış `cha_evrak_tip 63` — metin / ondalık dâhil; alış `0` + `cha_cinsi 6`) ya da `evraklar` / `satirlar` dizi değilse
 * 400 döner; Mikro'ya istek GİTMEZ ve ölçüm kipi `olcum` iken bile ölçüm kaydı AÇILMAZ (kapı ölçüm defterinden ÖNCE). Temiz dekont
 * (29) bugünkü gibi Mikro'ya gider ve ölçüm kaydı açar (M40 karşı örneği). `POST /api/mikro/cari-hareket/kaydet` fatura tipinde 400.
 *
 * Düzenek `mikroGonderimOlcum.zincir.test.ts` ile AYNI kalıp (sahteler yalnız süreç dışına çıkanlar). Canlıya, Firebase'e, Mikro'ya
 * istek YOK; sunucu `PORT=0` ile açılır, `afterAll`'da kapatılır.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { DOCS_TABLOSU_DDL } from './docsSema';

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
  g.__dekontPg = db;
  const q = async (text: unknown, params?: unknown[]) => {
    let sql = String(text); let p = params;
    if (text && typeof text === 'object') { const o = text as { text: string; values?: unknown[] }; sql = o.text; p = o.values; }
    // Sorgu öncesi kanca: defter INSERT'ini yavaşlatmak / düşürmek için (M0.1, M0.7).
    const kanca = g.__dekontPgKanca as ((sql: string, p: unknown[] | undefined) => Promise<void> | void) | undefined;
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
const pg = (): Pg => G.__dekontPg as Pg;
const kancaKur = (k: ((sql: string, p: unknown[] | undefined) => Promise<void> | void) | null): void => { G.__dekontPgKanca = k ?? undefined; };

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
const yanitlayici: Yanitlayici = BASARI;
const belirtecReddi = false;

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
const bekle = async (kosul: () => boolean | Promise<boolean>, ms: number, ne: string): Promise<void> => {
  const son = Date.now() + ms;
  while (Date.now() < son) { if (await kosul()) return; await new Promise(r => setTimeout(r, 25)); }
  throw new Error(`beklenen olmadı (${ms} ms): ${ne}`);
};
const belgeKoy = (coll: string, id: string, data: Record<string, unknown>): Promise<unknown> =>
  pg().query('INSERT INTO docs (coll, id, data) VALUES ($1, $2, $3::jsonb) ON CONFLICT (coll, id) DO UPDATE SET data = EXCLUDED.data', [coll, id, JSON.stringify(data)]);
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
const evrakGonder = (b: Record<string, string>, govde: unknown): Promise<Yanit> => istek('POST', '/api/mikro/evrak/kaydet', b, govde);

/** Önceki süreçten kalmış kayıt: zamanı bu sürecin başlangıcından (şimdi − çalışma süresi) 1 dk önce — 30 günlük ölçüm penceresinde. */
const ONCEKI_AN = Math.floor(Date.now() - process.uptime() * 1000 - 60_000);
const ONCEKI_SUREC_KAYDI = { kayitTuru: 'olcum', companyId: KIRACI, method: 'ZiyaretKaydetV2', durum: 'suruyor', olusturmaAt: ONCEKI_AN, guncellemeAt: ONCEKI_AN };

beforeAll(async () => {
  yuklemeDizini = fs.mkdtempSync(path.join(os.tmpdir(), 'dekont-fatura-'));
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
const DEKONT_SATIRI = (ek: Record<string, unknown> = {}) =>
  ({ cha_kod: '120.01.0042', cha_meblag: 250, cha_tip: 0, cha_tarihi: '01.11.2026', cha_evrak_tip: 29, cha_evrakno_seri: 'D', ...ek });
const DEKONT = (evraklar: unknown) => ({ method: 'DekontKaydetV2', payload: { evraklar }, entityType: 'cariDekont', entityId: 'dekont-sinama' });
const dekontIstegi = (n: number) => mikroIstekleri.filter(x => x.yontem === 'DekontKaydetV2').length - n;

describe('T8 EK — evrak/kaydet + DekontKaydetV2: fatura evrak tipi 400, Mikro 0, ölçüm kaydı 0 (kip `olcum`)', () => {
  it('63 metin / boşluklu / ondalık; iki evraklı gövdenin İKİNCİ evrakında 63; (\'0\', \'6\'); dizi olmayan gövde → hepsi 400', async () => {
    expect((await kipYaz('olcum', 'dekont fatura kapısı')).s).toBe(200);
    const { b } = await yeniYonetici();
    const vakalar: Array<[string, unknown]> = [
      ["'63'", [{ satirlar: [DEKONT_SATIRI({ cha_evrak_tip: '63' })] }]],
      ["' 63'", [{ satirlar: [DEKONT_SATIRI({ cha_evrak_tip: ' 63' })] }]],
      ['63.0', [{ satirlar: [DEKONT_SATIRI({ cha_evrak_tip: 63.0 })] }]],
      ['2. evrak 63', [{ satirlar: [DEKONT_SATIRI()] }, { satirlar: [DEKONT_SATIRI(), DEKONT_SATIRI({ cha_evrak_tip: 63, cha_evrakno_seri: 'Q' })] }]],
      ["('0', '6')", [{ satirlar: [DEKONT_SATIRI({ cha_evrak_tip: '0', cha_cinsi: '6' })] }]],
      ['evraklar dizi değil', { satirlar: [DEKONT_SATIRI()] }],
      ['satirlar dizi değil', [{ satirlar: DEKONT_SATIRI() }]],
    ];
    for (const [ad, evraklar] of vakalar) {
      const onceki = await kimlikler();
      const istekOnce = dekontIstegi(0);
      const r = await evrakGonder(b, DEKONT(evraklar));
      expect(r.s, `${ad}: ${r.metin}`).toBe(400);
      expect(r.j.success, ad).toBe(false);
      expect(dekontIstegi(istekOnce), `${ad}: Mikro'ya gitmemeli`).toBe(0);
      expect(await yeniOlcumler(onceki), `${ad}: ölçüm kaydı açılmamalı`).toEqual([]);
    }
  });

  it('evrak tipi anahtarının başka yazımı (`CHA_EVRAK_TIP:63`, karışık `{cha_evrak_tip:29, CHA_EVRAK_TIP:63}`) ve evrak tipsiz satır → 400, Mikro 0, ölçüm 0 (Q6)', async () => {
    expect((await kipYaz('olcum', 'dekont anahtar yazımı')).s).toBe(200);
    const { b } = await yeniYonetici();
    const { cha_evrak_tip: _t, ...tipsiz } = DEKONT_SATIRI();
    void _t;
    const vakalar: Array<[string, unknown, RegExp]> = [
      ['CHA_EVRAK_TIP:63', [{ satirlar: [{ ...tipsiz, CHA_EVRAK_TIP: 63 }] }], /«CHA_EVRAK_TIP» anahtarı yalnız «cha_evrak_tip» yazımıyla/],
      ['karışık 29 + 63', [{ satirlar: [DEKONT_SATIRI({ CHA_EVRAK_TIP: 63 })] }], /«CHA_EVRAK_TIP» anahtarı/],
      ['Cha_Evrak_Tip', [{ satirlar: [DEKONT_SATIRI({ Cha_Evrak_Tip: 63 })] }], /«Cha_Evrak_Tip» anahtarı/],
      ['CHA_CİNSİ', [{ satirlar: [DEKONT_SATIRI({ cha_evrak_tip: 0, CHA_CİNSİ: 6 })] }], /«CHA_CİNSİ» anahtarı yalnız «cha_cinsi» yazımıyla/],
      ['evrak tipi yok', [{ satirlar: [tipsiz] }], /cha_evrak_tip verilmeli/],
      ['evrak tipi 0', [{ satirlar: [DEKONT_SATIRI({ cha_evrak_tip: 0 })] }], /cha_evrak_tip verilmeli/],
    ];
    for (const [ad, evraklar, metin] of vakalar) {
      const onceki = await kimlikler();
      const istekOnce = dekontIstegi(0);
      const r = await evrakGonder(b, DEKONT(evraklar));
      expect(r.s, `${ad}: ${r.metin}`).toBe(400);
      expect(String(r.j.error), ad).toMatch(metin);
      expect(dekontIstegi(istekOnce), `${ad}: Mikro'ya gitmemeli`).toBe(0);
      expect(await yeniOlcumler(onceki), `${ad}: ölçüm kaydı açılmamalı`).toEqual([]);
    }
    // Normal yazım geçer: `{cha_evrak_tip:29, cha_cinsi:5}` Mikro'ya TEK istekle gider.
    const istekOnce = dekontIstegi(0);
    const ok = await evrakGonder(b, DEKONT([{ satirlar: [DEKONT_SATIRI({ cha_cinsi: 5 })] }]));
    expect(ok.s, ok.metin).toBe(200);
    expect(dekontIstegi(istekOnce)).toBe(1);
  });

  it('karşı örnek: temiz dekont (29) Mikro\'ya TEK istekle gider ve ölçüm kaydı açar (kapı ölçüm defterinden ÖNCE — M40)', async () => {
    expect((await kipYaz('olcum', 'dekont temiz')).s).toBe(200);
    const { b } = await yeniYonetici();
    const onceki = await kimlikler();
    const istekOnce = dekontIstegi(0);
    const r = await evrakGonder(b, DEKONT([{ satirlar: [DEKONT_SATIRI()] }]));
    expect(r.s, r.metin).toBe(200);
    expect(dekontIstegi(istekOnce)).toBe(1);
    await bekle(async () => (await yeniOlcumler(onceki)).length === 1, 5000, 'ölçüm kaydı açıldı');
  });

  it('cari-hareket/kaydet: cha_evrak_tip 63 (metin dâhil) → 400, Mikro 0; 29 geçer', async () => {
    const { b } = await yeniYonetici();
    for (const tip of [63, '63']) {
      const istekOnce = dekontIstegi(0);
      const r = await istek('POST', '/api/mikro/cari-hareket/kaydet', b, { hareket: DEKONT_SATIRI({ cha_evrak_tip: tip }) });
      expect(r.s, r.metin).toBe(400);
      expect(String(r.j.error)).toContain('fatura evrak tipi');
      expect(dekontIstegi(istekOnce)).toBe(0);
    }
    // Anahtarın başka yazımı (Q6): `...hareket` yayılımıyla Mikro'ya gidemez.
    for (const ek of [{ CHA_EVRAK_TIP: 63 }, { Cha_Evrak_Tip: 63 }, { CHA_CİNSİ: 6 }]) {
      const istekOnce = dekontIstegi(0);
      const r = await istek('POST', '/api/mikro/cari-hareket/kaydet', b, { hareket: DEKONT_SATIRI(ek) });
      expect(r.s, `${JSON.stringify(ek)}: ${r.metin}`).toBe(400);
      expect(String(r.j.error)).toMatch(/anahtarı yalnız «cha_(evrak_tip|cinsi)» yazımıyla/);
      expect(dekontIstegi(istekOnce)).toBe(0);
    }
    const istekOnce = dekontIstegi(0);
    const ok = await istek('POST', '/api/mikro/cari-hareket/kaydet', b, { hareket: DEKONT_SATIRI() });
    expect(ok.s, ok.metin).toBe(200);
    expect(dekontIstegi(istekOnce)).toBe(1);
  });
});
