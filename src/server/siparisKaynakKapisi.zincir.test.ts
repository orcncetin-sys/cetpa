// @vitest-environment node
/**
 * siparisKaynakKapisi.zincir.test.ts — siparişin `source` alanında SUNUCUNUN koruduğu değerler (`MF_KAYNAGI` 'mikro-fatura',
 * `MAGAZA_KAYNAGI` 'shopify_webhook') istemci yazımına KAPALI; `mikrofat__` kimliği iç role de kapalı (şartname
 * `.wf/SARTNAME-siparis-kaynak-kapisi.md` K1–K3, «Kapı sonrası hükümler» H1–H9). GERÇEK `server.ts` + GERÇEK express zinciri +
 * GERÇEK SQL (PGlite; `docs` tablosu canlıyla AYNI DDL'den — server.ts kurar). Düzenek `faturaCiftKesim.zincir.test` kalıbıdır.
 *
 * NEDEN GERÇEK ZİNCİR: kural iki katmanlıdır — JS (`kiraciDamgala` → `kaynakDegeriniUygula`: gelen korunan değer düşer, okunan
 * satırdaki korunan değer taşınır) ve SQL (`sunucuAlanKorumaSql`: YAZIM ANINDAKİ satırın korunan değeri kalır, tek yönlü). Biri
 * bağlanmazsa saf testler yeşil kalır ama MF siparişi Cetpa siparişine döner (raporlar aynı satışı iki kez sayar; e-Fatura talebi
 * ikinci resmî belgeyi geçirir) ya da Cetpa siparişi MF sayılır (gece korumalarından çıkar).
 *
 * SAHTE OLANLAR (yalnız süreç dışına çıkan her şey): Firebase belirteç doğrulayıcısı (belirteç = "<uid>|<e-posta>|<1|0>"), `pg`
 * havuzu (süreç içi PGlite), pg-boss, node-cron, vite, `dotenv` (hiçbir ortam dosyası YÜKLENMEZ) ve dışarı giden `fetch`: Mikro
 * BULUT modunda sahte bir uca konuşur — hiçbir istek makineden çıkmaz. «Mikro 0» = `FaturaKaydetV2` hiç çağrılmadı. Tohumlar
 * doğrudan SQL ile yazılır (sunucunun yazımı gibi). Süper yönetici: `SUPER_ADMIN_EMAILS` modül sabitidir — `server.ts` içe
 * aktarılmadan ÖNCE konur (ölçüm: `faturaCiftKesim` düzeneği bu değişkeni SİLER; varsayılan kurulum sahibinin adresidir).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { MF_KAYNAGI, MF_KIMLIK_ONEKI } from '../lib/mfKaynagi';
import { MAGAZA_KAYNAGI } from '../lib/magazaKaynagi';
import { SUNUCU_KAYNAK_DEGERLERI } from '../lib/collections';
import { sunucuAlanKorumaSql } from '../lib/tenantErisim';
import { SRC_KOK, kodSatirlari, kaynakDosyalari, suclular } from '../test/kaynakTarama';

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
  g.__kaynakPg = db;
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
    const kanca = g.__kaynakPgKanca as ((sql: string, p: unknown[] | undefined) => Promise<void> | void) | undefined;
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
const pg = (): Pg => G.__kaynakPg as Pg;

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
const KORUNANLAR = [MF_KAYNAGI, MAGAZA_KAYNAGI] as const;

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
const kaynakOku = async (id: string): Promise<unknown> => (await belgeOku('orders', id))?.source;

// ── Sahte Mikro (BULUT modu; yalnız e-Fatura talebi — H8) ─────────────────────────────────────────────────────────────────
const json = (govde: unknown, durum = 200): Response => new Response(JSON.stringify(govde), { status: durum, headers: { 'content-type': 'application/json' } });
let mikroSayac = 0;
let numaraSayaci = 0;
/** `fn` koşarken kaç `FaturaKaydetV2` çağrısı yapıldı («Mikro N»). */
const mikroSay = async <T,>(fn: () => Promise<T>): Promise<{ n: number; sonuc: T }> => {
  const once = mikroSayac;
  const sonuc = await fn();
  return { n: mikroSayac - once, sonuc };
};

// ── Sipariş ve istekler ────────────────────────────────────────────────────────────────────────────────────────────────────
const SIPARIS_GOVDESI = {
  mikroCariKod: '120.01.0042', customerName: 'Şirin Yapı Malzemeleri',
  lineItems: [{ sku: 'CIM-50', name: 'ÇİMENTO 50KG', quantity: 40, price: 312.5 }],
  faturaTipi: 'e-arsiv', kdvOran: 20, createdAt: '2026-10-19T09:00:00.000Z',
};
let siparisSayaci = 0;
/** Kiracının siparişini (doğrudan SQL — sunucunun yazımı gibi) kurar ve kimliğini döner. */
const siparisKur = async (ek: Record<string, unknown> = {}, id = `kaynak-${++siparisSayaci}`): Promise<string> => {
  await belgeKoy('orders', id, { customerName: 'Şirin Yapı Malzemeleri', totalPrice: 15000, status: 'Processing', companyId: KIRACI, notes: 'ilk', ...ek });
  return id;
};
/** Mikro faturasından türemiş gibi MF siparişi (kimlik `mikrofat__<kiracı>__<seri>-<sıra>`, eslemeFatura biçimi). */
const mfKur = (ek: Record<string, unknown> = {}): Promise<string> => {
  const n = ++siparisSayaci;
  return siparisKur({ source: MF_KAYNAGI, faturali: true, mikroFaturaNo: `KSK${n}`, mikroEvrak: { seri: 'KSK', sira: n }, ...ek }, `${MF_KIMLIK_ONEKI}${KIRACI}__KSK-${n}`);
};
/** Korunan değerli sipariş: MF için `mfKur`, mağaza için `shopify__…` biçimli kimlik (shopifyEsleme biçimi). */
const korunanKur = (deger: string, ek: Record<string, unknown> = {}): Promise<string> =>
  deger === MF_KAYNAGI ? mfKur(ek) : siparisKur({ source: deger, ...ek }, `shopify__${(++siparisSayaci).toString(16).padStart(32, '0')}`);
const kes = (b: Record<string, string>, firebaseId: string): Promise<Yanit> =>
  istek('POST', '/api/mikro/fatura/kaydet', b, { order: SIPARIS_GOVDESI, firebaseId });
const SECIM = 'SELECT data FROM docs WHERE coll = $1 AND id = $2';

beforeAll(async () => {
  yuklemeDizini = fs.mkdtempSync(path.join(os.tmpdir(), 'siparis-kaynak-kapisi-'));
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
  globalThis.fetch = (async (girdi: unknown) => {
    const url = String(typeof girdi === 'string' ? girdi : (girdi as { url?: string }).url ?? girdi);
    if (url.startsWith('https://onlinekullanici.mikro.com.tr/')) return json({ access_token: 'sinama-belirteci', expires_in: 21600 });
    if (url === `${MIKRO_TABAN}/VergiListesiV2`) {
      return json({ result: [{ IsError: false, Data: { VergiListesi: [
        { vergiSiraNo: 1, vergiOrani: 0, vergiAdi: 'YOK' }, { vergiSiraNo: 3, vergiOrani: 10, vergiAdi: 'KDV %10' }, { vergiSiraNo: 4, vergiOrani: 20, vergiAdi: 'KDV %20' },
      ] } }] });
    }
    if (url === `${MIKRO_TABAN}/FaturaKaydetV2`) {
      mikroSayac++; numaraSayaci++;
      return json({ result: [{ IsError: false, StatusCode: 200, Data: { faturaNo: `CTP2026${String(numaraSayaci).padStart(9, '0')}`, ettn: `ettn-${numaraSayaci}` } }] });
    }
    return json({});
  }) as typeof fetch;

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
it('düzenek: süper yönetici gerçekten süper yönetici (aksi hâlde «süper yönetici de aynı kurala tabi» sınaması boş kalırdı)', async () => {
  const r = await istek('GET', '/api/superadmin/me', SUPER);
  expect([r.s, r.j.isSuperAdmin], r.metin).toEqual([200, true]);
  expect((await istek('GET', '/api/superadmin/me', YONETICI)).j.isSuperAdmin).toBe(false);
});

describe('K1 / H5 / H9 — istemci `/api/db` ile korunan kaynak değerini yazamaz (rolden bağımsız, sessiz)', () => {
  for (const [ad, b] of ROLLER) {
    it(`${ad}: yeni kayıtta ve Cetpa siparişinde MF / mağaza değeri düşer (POST, PUT, PUT?merge=1, PATCH, tünel PATCH, cas); önceki değer ya da yokluk korunur; öteki değer yazılır`, async () => {
      for (const deger of KORUNANLAR) {
        // POST: yeni kayıtta alan YOK (403 değil — sessiz).
        const p = await istek('POST', '/api/db/orders', b, { customerName: 'Yeni', source: deger });
        expect(p.s, p.metin).toBe(200);
        expect(await belgeOku('orders', String(p.j.id))).toMatchObject({ customerName: 'Yeni' });
        expect(await belgeOku('orders', String(p.j.id)), `POST ${deger}`).not.toHaveProperty('source');
        // Cetpa siparişi (önceki değer 'manual') ve kaynaksız Cetpa siparişi (alan yok).
        for (const onceki of ['manual', undefined]) {
          const id = await siparisKur(onceki === undefined ? {} : { source: onceki });
          const korundu = async (adim: string): Promise<void> => {
            const satir = await belgeOku('orders', id);
            if (onceki === undefined) expect(satir, `${adim} (${deger})`).not.toHaveProperty('source');
            else expect(satir?.source, `${adim} (${deger})`).toBe(onceki);
          };
          const put = await istek('PUT', `/api/db/orders/${id}`, b, { customerName: 'Şirin Yapı Malzemeleri', status: 'Processing', source: deger, notes: 'put' });
          expect(put.s, put.metin).toBe(200);
          await korundu('PUT');
          expect((put.j.data as Record<string, unknown>).source, 'PUT yanıtı').toBe(onceki);
          const pm = await istek('PUT', `/api/db/orders/${id}?merge=1`, b, { source: deger, notes: 'merge' });
          expect(pm.s, pm.metin).toBe(200);
          await korundu('PUT?merge=1');
          const pa = await istek('PATCH', `/api/db/orders/${id}`, b, { source: deger, notes: 'patch' });
          expect(pa.s, pa.metin).toBe(200);
          await korundu('PATCH');
          expect((pa.j.data as Record<string, unknown>).source, 'PATCH yanıtı').toBe(onceki);
          const t = await istek('POST', `/api/db/orders/${id}`, { ...b, 'X-Cetpa-Method': 'PATCH' }, { source: deger, notes: 'tunel' });
          expect(t.s, t.metin).toBe(200);
          await korundu('tünel PATCH');
          const c = await istek('PATCH', `/api/db/orders/${id}/cas`, b, { field: 'status', expect: 'Processing', set: { source: deger, notes: 'cas' } });
          expect([c.s, c.j.claimed], c.metin).toEqual([200, true]);
          await korundu('cas');
          // Öteki alanlar her yolda yazıldı.
          expect((await belgeOku('orders', id))?.notes).toBe('cas');
          // Nokta yolu korunan değeri ÜRETEMEZ (birleştirme alanı nesneye çevirir; ham gövdede anahtar düşer).
          const n = await istek('PATCH', `/api/db/orders/${id}`, b, { [`source.alt`]: deger, notes: 'nokta' });
          expect(n.s, n.metin).toBe(200);
          expect(KORUNANLAR as readonly unknown[], 'nokta yolu').not.toContain(await kaynakOku(id));
          const cn = await istek('PATCH', `/api/db/orders/${id}/cas`, b, { field: 'status', expect: 'Processing', set: { [`source.alt`]: deger } });
          expect(cn.s, cn.metin).toBe(200);
          expect(Object.keys((await belgeOku('orders', id)) ?? {}), 'cas nokta yolu anahtarı').not.toContain('source.alt');
        }
      }
      // Meşru öteki değer (Trendyol, manual…) yazılır — alan bütünüyle kapanmadı.
      const id = await siparisKur({ source: 'manual' });
      expect((await istek('PATCH', `/api/db/orders/${id}`, b, { source: 'Trendyol' })).s).toBe(200);
      expect(await kaynakOku(id)).toBe('Trendyol');
      expect((await istek('PUT', `/api/db/orders/${id}?merge=1`, b, { source: 'Hepsiburada' })).s).toBe(200);
      expect(await kaynakOku(id)).toBe('Hepsiburada');
      const c = await istek('PATCH', `/api/db/orders/${id}/cas`, b, { field: 'status', expect: 'Processing', set: { source: 'manual' } });
      expect([c.s, c.j.claimed]).toEqual([200, true]);
      expect(await kaynakOku(id)).toBe('manual');
    });

    it(`${ad}: MF / mağaza siparişinin kaynağı değiştirilemez, silinemez, tam değiştirmede eksik bırakılınca KALIR; notes ve status yazılır; increment 400`, async () => {
      for (const deger of KORUNANLAR) {
        const id = await korunanKur(deger);
        const kaldi = async (adim: string): Promise<void> => expect(await kaynakOku(id), `${adim} (${deger})`).toBe(deger);
        // PUT tam değiştirme, gövdede `source` YOK (ekrandaki eski kopya).
        const put = await istek('PUT', `/api/db/orders/${id}`, b, { customerName: 'Şirin Yapı Malzemeleri', status: 'Processing', notes: 'put' });
        expect(put.s, put.metin).toBe(200);
        await kaldi('PUT kaynaksız');
        expect((put.j.data as Record<string, unknown>).source, 'PUT yanıtı yazılan satırdan').toBe(deger);
        expect(await belgeOku('orders', id)).toMatchObject({ notes: 'put', status: 'Processing' });
        const put2 = await istek('PUT', `/api/db/orders/${id}`, b, { customerName: 'X', status: 'Processing', source: 'manual', notes: 'put2' });
        expect(put2.s, put2.metin).toBe(200);
        await kaldi('PUT başka değer');
        for (const govde of [{ source: null }, { source: 'manual' }]) {
          const r = await istek('PUT', `/api/db/orders/${id}?merge=1`, b, { ...govde, notes: 'merge' });
          expect(r.s, r.metin).toBe(200);
          await kaldi(`PUT?merge=1 ${JSON.stringify(govde)}`);
        }
        for (const [i, yama] of ([{ source: 'manual' }, { source: null }, { source: 'Trendyol' }, { 'source.alt': 'x' }] as Array<Record<string, unknown>>).entries()) {
          const r = await istek('PATCH', `/api/db/orders/${id}`, b, { ...yama, notes: `patch-${i}`, status: i % 2 ? 'Shipped' : 'Processing' });
          expect(r.s, r.metin).toBe(200);
          await kaldi(`PATCH ${JSON.stringify(yama)}`);
          expect((r.j.data as Record<string, unknown>).source, 'PATCH yanıtı').toBe(deger);
          expect(await belgeOku('orders', id)).toMatchObject({ notes: `patch-${i}`, status: i % 2 ? 'Shipped' : 'Processing' });
          const t = await istek('POST', `/api/db/orders/${id}`, { ...b, 'X-Cetpa-Method': 'PATCH' }, { ...yama, notes: `tunel-${i}` });
          expect(t.s, t.metin).toBe(200);
          await kaldi(`tünel PATCH ${JSON.stringify(yama)}`);
        }
        await istek('PATCH', `/api/db/orders/${id}`, b, { status: 'Processing' });
        for (const set of [{ source: 'x' }, { source: null }]) {
          const c = await istek('PATCH', `/api/db/orders/${id}/cas`, b, { field: 'status', expect: 'Processing', set: { ...set, notes: 'cas' } });
          expect([c.s, c.j.claimed], c.metin).toEqual([200, true]);
          await kaldi(`cas ${JSON.stringify(set)}`);
          expect((c.j.data as Record<string, unknown>).source).toBe(deger);
        }
        expect((await belgeOku('orders', id))?.notes).toBe('cas');
        // increment: korunan değer metin — sayıya çevrilemez → 400 (500 DEĞİL), satır değişmez.
        const once = await belgeOku('orders', id);
        const inc = await istek('PATCH', `/api/db/orders/${id}/increment`, b, { field: 'source', delta: 1 });
        expect([inc.s, inc.j.error], inc.metin).toEqual([400, 'Bu alan artırılamaz.']);
        expect(await belgeOku('orders', id)).toEqual(once);
      }
    });
  }

  it('increment `source` — korunansız metin satırında 400 (satır değişmez); alanı olmayan satırda sayı olur (korunan değer bu yoldan ÜRETİLEMEZ)', async () => {
    const id = await siparisKur({ source: 'manual' });
    const inc = await istek('PATCH', `/api/db/orders/${id}/increment`, SATIS, { field: 'source', delta: 1 });
    expect([inc.s, inc.j.error], inc.metin).toEqual([400, 'Bu alan artırılamaz.']);
    expect(await kaynakOku(id)).toBe('manual');
    const bos = await siparisKur();
    const r = await istek('PATCH', `/api/db/orders/${bos}/increment`, SATIS, { field: 'source', delta: 2 });
    expect(r.s, r.metin).toBe(200);
    expect(await kaynakOku(bos)).toBe(2);
    // Sayı alanında artırma bugünkü gibi çalışır.
    const s = await istek('PATCH', `/api/db/orders/${id}/increment`, SATIS, { field: 'totalPrice', delta: 5 });
    expect([s.s, (await belgeOku('orders', id))?.totalPrice]).toEqual([200, 15005]);
  });

  it('yayın (canlı akış) yazılan GERÇEK satırdan: kaynaksız PUT\'un olayı MF\'yi taşır (istemcinin canlı listesinde sipariş Cetpa\'ya dönmez)', async () => {
    const { dbEvents } = await import('./pgShim');
    const id = await mfKur();
    const olaylar: Array<Record<string, unknown> | undefined> = [];
    const dinle = (e: { coll: string; id: string; data?: Record<string, unknown> }): void => { if (e.coll === 'orders' && e.id === id) olaylar.push(e.data); };
    dbEvents.on('change', dinle);
    try {
      const r = await istek('PUT', `/api/db/orders/${id}`, SATIS, { customerName: 'X', status: 'Processing', notes: 'yayin' });
      expect(r.s, r.metin).toBe(200);
      await bekle(() => olaylar.length > 0, 10_000, 'yayın');
    } finally { dbEvents.off('change', dinle); }
    expect(olaylar[olaylar.length - 1]).toMatchObject({ source: MF_KAYNAGI, notes: 'yayin' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// H8 — e-Fatura okuyucusu: MF / mağaza siparişinin `source`'u çevrilip `mikroFaturaNo` silinirse `FATURA_TALEP_SQL` geçiyordu →
// faturası Mikro'da kesilmiş satışa (ya da mağaza siparişine) ikinci resmî belge.
describe('H8 — kaynağı çevrilmeye çalışılan MF / mağaza siparişine e-Fatura kesilemez (Mikro 0)', () => {
  const VARYANTLAR: Array<[ad: string, yaz: (id: string) => Promise<Yanit>]> = [
    ['(a) PATCH {source:\'manual\', mikroFaturaNo:\'\'}', id => istek('PATCH', `/api/db/orders/${id}`, SATIS, { source: 'manual', mikroFaturaNo: '' })],
    ['(b) PUT tam değiştirme, `source` yok, mikroFaturaNo:\'\'', id => istek('PUT', `/api/db/orders/${id}`, SATIS, { customerName: 'Şirin Yapı Malzemeleri', totalPrice: 15000, status: 'Processing', companyId: KIRACI, mikroFaturaNo: '' })],
    ['(c) cas set {source:\'x\', mikroFaturaNo:\'\'}', id => istek('PATCH', `/api/db/orders/${id}/cas`, SATIS, { field: 'status', expect: 'Processing', set: { source: 'x', mikroFaturaNo: '' } })],
  ];
  for (const [deger, neden] of [[MF_KAYNAGI, 'mikro-fatura'], [MAGAZA_KAYNAGI, 'magaza']] as const) {
    for (const [ad, yaz] of VARYANTLAR) {
      it(`${deger} ${ad} → satırda ${deger} kalır; kes → 400 FATURA_KESILEMEZ (${neden}), Mikro 0`, async () => {
        const id = await korunanKur(deger, { mikroFaturaNo: 'MF-383' });
        const y = await yaz(id);
        expect(y.s, y.metin).toBe(200);
        const satir = await belgeOku('orders', id);
        // Önce zararın kendisi (kural kalkarsa ileti `n = 1` — ikinci resmî belge — gösterir), sonra satır.
        const { n, sonuc } = await mikroSay(() => kes(YONETICI, id));
        expect([sonuc.s, sonuc.j.kod, sonuc.j.neden, n], sonuc.metin).toEqual([400, 'FATURA_KESILEMEZ', neden, 0]);
        expect(satir?.source).toBe(deger);
        expect(satir?.mikroFaturaNo, 'öteki alan yazıldı').toBe('');
      });
    }
  }
  it('karşı örnek (sahte geçmesin): kaynaksız Cetpa siparişi, numarasız → talep geçer, Mikro 1', async () => {
    const id = await siparisKur();
    const { n, sonuc } = await mikroSay(() => kes(YONETICI, id));
    expect([sonuc.s, n], sonuc.metin).toEqual([200, 1]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// Yarış (faturaCiftKesim T24 kalıbı): `/api/db` yazımının SELECT'i koştuktan SONRA, yazımı koşmadan ÖNCE satır değişir.
describe('Yarış — «önceki değer» JS\'te okunan bayat satırdan DEĞİL, yazım anındaki satırdan', () => {
  /** `istekFn` koşar; o kimliğin İLK `SELECT`'inden sonra `ara` koşar (yazım ondan sonra). */
  const yarisli = async (id: string, istekFn: () => Promise<Yanit>, ara: () => Promise<unknown>): Promise<Yanit> => {
    let durdu = false;
    G.__kaynakPgKanca = async (sql: string, p: unknown[] | undefined) => {
      if (!durdu && sql === SECIM && p?.[0] === 'orders' && p?.[1] === id) { durdu = true; await ara(); }
    };
    try {
      const y = await istekFn();
      expect(durdu, 'kanca koştu').toBe(true);
      return y;
    } finally { G.__kaynakPgKanca = undefined; }
  };
  const mfYap = (id: string) => () => pg().query(`UPDATE docs SET data = data || jsonb_build_object('source', $3::text) WHERE coll = $1 AND id = $2`, ['orders', id, MF_KAYNAGI]);
  const sil = (id: string) => () => pg().query('DELETE FROM docs WHERE coll = $1 AND id = $2', ['orders', id]);

  const YAZIMLAR: Array<[ad: string, yaz: (id: string) => Promise<Yanit>]> = [
    ['PUT (kaynaksız tam değiştirme)', id => istek('PUT', `/api/db/orders/${id}`, SATIS, { customerName: 'Şirin Yapı Malzemeleri', status: 'Processing', companyId: KIRACI, notes: 'yaris' })],
    ['PUT?merge=1', id => istek('PUT', `/api/db/orders/${id}?merge=1`, SATIS, { notes: 'yaris' })],
    ['PATCH {notes}', id => istek('PATCH', `/api/db/orders/${id}`, SATIS, { notes: 'yaris' })],
    ['PATCH {notes, source: null}', id => istek('PATCH', `/api/db/orders/${id}`, SATIS, { notes: 'yaris', source: null })],
    ['cas {source: \'manual\', notes}', id => istek('PATCH', `/api/db/orders/${id}/cas`, SATIS, { field: 'status', expect: 'Processing', set: { source: 'manual', notes: 'yaris' } })],
  ];
  for (const [ad, yaz] of YAZIMLAR) {
    it(`T-Y1 — ${ad}: SELECT'ten sonra satır MF olur (sunucunun yazımı) → yazımdan sonra MF KALIR, öteki alan yazılır`, async () => {
      const id = await siparisKur({ source: 'manual' });
      const y = await yarisli(id, () => yaz(id), mfYap(id));
      expect(y.s, y.metin).toBe(200);
      expect(await belgeOku('orders', id)).toMatchObject({ source: MF_KAYNAGI, notes: 'yaris' });
      // Yanıt (yayınla aynı veri) yazılan GERÇEK satırdan: JS verisi bayat okumayı taşır, MF'yi değil (H3 koşulu `sunucuKorumaVar`).
      expect((y.j.data as Record<string, unknown> | null)?.source, 'yanıt yazılan satırdan').toBe(MF_KAYNAGI);
    });
  }
  for (const [ad, yaz] of YAZIMLAR.filter(([a]) => !a.startsWith('cas'))) {
    it(`T-Y2 — ${ad}: MF satırı SELECT'ten sonra silinir → satır ya MF ile geri gelir ya da yok; ASLA kaynaksız \`mikrofat__\` kaydı değil`, async () => {
      const id = await mfKur();
      const y = await yarisli(id, () => yaz(id), sil(id));
      expect(y.s, y.metin).toBe(200);
      const satir = await belgeOku('orders', id);
      // Bugünkü davranış: INSERT dalı satırı yeniden açar (araya düşen silme kaybolur) — kaynağıyla birlikte.
      expect(satir, 'INSERT dalı').toBeDefined();
      expect(satir?.source, 'kaynaksız mikrofat__ kaydı doğmamalı').toBe(MF_KAYNAGI);
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// K3 — sunucunun kendi yazımları değişmez: MF siparişini sunucu pgShim (`adminDb`) ile yazar; pgShim de AYNI ifadeyi kullanır
// ve kural TEK YÖNLÜDÜR (gelen tarafa bakmaz) — sunucunun MF yazımı düşmez.
describe('K3 — pgShim: sunucunun MF yazımı bozulmaz; kaynağı hiçbir sunucu yazıcısı çeviremez', () => {
  const shim = async () => {
    const { PgFirestore } = await import('./pgShim');
    const pgModul = await import('pg');
    return new PgFirestore(new pgModul.default.Pool());
  };
  let faturaSayaci = 900;
  const turet = async (companyId = KIRACI) => {
    const { faturadanSiparis } = await import('./mikro/eslemeFatura');
    const t = faturadanSiparis(
      { cha_evrakno_seri: 'KSK', cha_evrakno_sira: ++faturaSayaci, cha_tarihi: '2026-10-01', cha_kod: '120.01.0042', cha_meblag: 1200 },
      [], { companyId, cariUnvan: 'Şirin Yapı Malzemeleri' });
    if (!t) throw new Error('sipariş türemedi');
    return t;
  };

  it('`faturadanSiparis` + `batch.set` (gece türetmesi) boş tabloda MF siparişi yaratır: kimlik MF önekli, satırda `source: MF_KAYNAGI`', async () => {
    const db = await shim();
    const t = await turet();
    expect(t.id.startsWith(`${MF_KIMLIK_ONEKI}${KIRACI}__`)).toBe(true);
    const b = db.batch();
    b.set(db.collection('orders').doc(t.id), { ...t.doc, createdAt: t.olusturmaTarihi });
    await b.commit();
    expect(await belgeOku('orders', t.id)).toMatchObject({ source: MF_KAYNAGI, faturali: true, companyId: KIRACI });
  });
  it('var olan MF satırına `batch.update({ lineItems })` (kalem dolumu) ve `update({ status })` (iptal eşlemesi) sonrası MF kalır', async () => {
    const db = await shim();
    const id = await mfKur({ lineItems: [] });
    const b = db.batch();
    b.update(db.collection('orders').doc(id), { lineItems: [{ sku: 'CIM-50', quantity: 1 }] });
    await b.commit();
    await db.collection('orders').doc(id).update({ status: 'Cancelled', iptalKaynagi: 'mikro' });
    expect(await belgeOku('orders', id)).toMatchObject({ source: MF_KAYNAGI, status: 'Cancelled', lineItems: [{ sku: 'CIM-50', quantity: 1 }] });
  });
  it('MF OLMAYAN (başka kiracı damgalı, kaynağı `manual`) satıra pgShim `set(t.doc)` → MF YAZILIR (iki yönlü kural yok)', async () => {
    const db = await shim();
    const t = await turet();
    await belgeKoy('orders', t.id, { source: 'manual', companyId: BASKA_KIRACI, notes: 'kapılmış' });
    await db.collection('orders').doc(t.id).set({ ...t.doc });
    expect(await belgeOku('orders', t.id)).toMatchObject({ source: MF_KAYNAGI, companyId: KIRACI });
    expect(await belgeOku('orders', t.id)).not.toHaveProperty('notes');
  });
  it('kanal eşleşmesi gibi `set({ source: \'Trendyol\' }, { merge: true })` MF / mağaza satırının kaynağını çeviremez; korumasız satırda yazar', async () => {
    const db = await shim();
    for (const deger of KORUNANLAR) {
      const id = await korunanKur(deger);
      await db.collection('orders').doc(id).set({ source: 'Trendyol', trendyolOrderNo: 'TY-1' }, { merge: true });
      expect(await belgeOku('orders', id)).toMatchObject({ source: deger, trendyolOrderNo: 'TY-1' });
    }
    const cetpa = await siparisKur({ source: 'manual' });
    await db.collection('orders').doc(cetpa).set({ source: 'Trendyol' }, { merge: true });
    expect(await kaynakOku(cetpa)).toBe('Trendyol');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('K2 / H7 — `mikrofat__` kimliği iç role de kapalı (yalnız YENİ kayıt açma)', () => {
  for (const [ad, b] of ROLLER) {
    it(`${ad}: \`PUT\` / \`PATCH\` \`mikrofat__<kiracı>__X\` → 403 «Bu kimlikle kayıt açılamaz.», satır açılmaz; tohumlanmış MF'ye PATCH / PUT?merge=1 → 200`, async () => {
      const yeni = `${MF_KIMLIK_ONEKI}${KIRACI}__KAP-${++siparisSayaci}`;
      for (const [yontem, yol] of [['PUT', `/api/db/orders/${yeni}`], ['PUT', `/api/db/orders/${yeni}?merge=1`], ['PATCH', `/api/db/orders/${yeni}`]]) {
        const r = await istek(yontem, yol, b, { customerName: 'Kapma', notes: 'x' });
        expect([r.s, r.j.error], `${yontem} ${yol}`).toEqual([403, 'Bu kimlikle kayıt açılamaz.']);
      }
      const t = await istek('POST', `/api/db/orders/${yeni}`, { ...b, 'X-Cetpa-Method': 'PATCH' }, { notes: 'x' });
      expect([t.s, t.j.error], 'tünel PATCH').toEqual([403, 'Bu kimlikle kayıt açılamaz.']);
      expect(await belgeOku('orders', yeni)).toBeUndefined();
      // Başka kiracının var olan MF siparişi: «yok» ile AYNI yanıt (varlık sızmaz).
      const yabanci = `${MF_KIMLIK_ONEKI}${BASKA_KIRACI}__KAP-${++siparisSayaci}`;
      await belgeKoy('orders', yabanci, { source: MF_KAYNAGI, companyId: BASKA_KIRACI, notes: 'yabancı' });
      const y = await istek('PATCH', `/api/db/orders/${yabanci}`, b, { notes: 'x' });
      expect([y.s, y.j.error]).toEqual([403, 'Bu kimlikle kayıt açılamaz.']);
      expect((await belgeOku('orders', yabanci))?.notes).toBe('yabancı');
      // Var olan (görünen) MF siparişine yazım değişmez.
      const mf = await mfKur();
      const p = await istek('PATCH', `/api/db/orders/${mf}`, b, { notes: 'not' });
      expect(p.s, p.metin).toBe(200);
      const m = await istek('PUT', `/api/db/orders/${mf}?merge=1`, b, { status: 'Shipped' });
      expect(m.s, m.metin).toBe(200);
      expect(await belgeOku('orders', mf)).toMatchObject({ source: MF_KAYNAGI, notes: 'not', status: 'Shipped' });
    });
  }
  it('iç rol öteki `__` kimliklerini açabilir (kapsam YALNIZ `mikrofat__` öneki): `x_mikrofat__…`, `a__b`', async () => {
    for (const id of [`x_${MF_KIMLIK_ONEKI}${KIRACI}__1`, `a__b-${++siparisSayaci}`]) {
      const r = await istek('PUT', `/api/db/orders/${id}`, SATIS, { customerName: 'Serbest' });
      expect(r.s, `${id}: ${r.metin}`).toBe(200);
      expect(await belgeOku('orders', id)).toMatchObject({ customerName: 'Serbest' });
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('T25 çiti — bağlantı ve tek kaynak (yazıldı ama bağlanmadı)', () => {
  const SERVER = join(SRC_KOK, '..', 'server.ts');
  const kod = (yol: string): string => kodSatirlari(yol).map(s => s.kod).join('\n');
  it('server.ts: PUT / PATCH yanıt-yayın dalı `sunucuKorumaVar`; cas yazım anında korumalı; düz `SET data = data || $4` YOK; increment 22P02 → 400', () => {
    const s = kod(SERVER);
    expect(s.match(/if \(sunucuKorumaVar\(coll\) && (put|patch)Yazim\.rows\[0\]\?\.data\) data = (put|patch)Yazim\.rows\[0\]\.data as Record<string, unknown>;/g)).toHaveLength(2);
    expect(s).not.toMatch(/sunucuTuretilenAlanlar\(coll\)\.length &&/);
    expect(s.match(/ON CONFLICT \(coll, id\) DO UPDATE SET data = \$\{sunucuAlanKorumaSql\(coll\)\}, updated_at = now\(\) RETURNING data`/g)).toHaveLength(2);
    expect(s).toMatch(/`UPDATE docs SET data = \$\{sunucuAlanKorumaSql\(coll, '\(docs\.data \|\| \$4::jsonb\)'\)\}, updated_at = now\(\)\n\s*WHERE coll = \$1 AND id = \$2 AND data->>\$3 = \$5 RETURNING data`/);
    expect(s).not.toMatch(/SET data = data \|\| \$4/);
    expect(s).toMatch(/if \(\(e as \{ code\?: unknown \} \| null\)\?\.code === '22P02'\) \{ res\.status\(400\)\.json\(\{ error: 'Bu alan artırılamaz\.' \}\); return; \}\n\s*dbErr\(e, res, 'INCREMENT', coll\);/);
  });
  it('pgShim: `set` / `update` koşulu `sunucuKorumaVar` (türetilen alan VEYA kaynak değeri)', () => {
    const s = kod(join(SRC_KOK, 'server', 'pgShim.ts'));
    expect(s.match(/const koru = sunucuKorumaVar\(this\.coll\);/g)).toHaveLength(2);
    expect(s).not.toMatch(/sunucuTuretilenAlanlar/);
  });
  it('JS kuralı `kiraciDamgala`\'da (tek yer); K2 tek satır', () => {
    const s = kod(join(SRC_KOK, 'lib', 'tenantErisim.ts'));
    expect(s.match(/kaynakDegeriniUygula\(/g)).toHaveLength(2);   // tanım + kiraciDamgala çağrısı
    expect(s).toMatch(/const data = kaynakDegeriniUygula\(coll, sunucuAlanlariniDusur\(coll, gelen\), onceki\);/);
    expect(s).toMatch(/return ayrilmisKimlikAdayi\(coll, id, gorunur\) && \(satirAlani\(coll, rol\) !== null \|\| id\.startsWith\(MF_KIMLIK_ONEKI\)\);/);
  });
  it('değer kümesi tek kaynaktan; kural üç biçimde de TEK YÖNLÜ (`docs.data->>\'source\'` var, gelen tarafa bakan `->>\'source\'` yok)', () => {
    expect(SUNUCU_KAYNAK_DEGERLERI.get('orders')).toEqual({ alan: 'source', degerler: [MF_KAYNAGI, MAGAZA_KAYNAGI] });
    for (const yeni of ['EXCLUDED.data', '$3::jsonb', '(docs.data || $4::jsonb)']) {
      const ifade = sunucuAlanKorumaSql('orders', yeni);
      expect(ifade, yeni).toContain(`docs.data->>'source' IN ('${MF_KAYNAGI}', '${MAGAZA_KAYNAGI}')`);
      expect((ifade.match(/->>'source'/g) ?? []).length, yeni).toBe((ifade.match(/docs\.data->>'source'/g) ?? []).length);
    }
  });
  it('MF metni sunucu kodunda yalnız sabitten: `\'mikro-fatura\'` ve `mikrofat__` kod satırlarında YOK (yalnız e-Fatura RET NEDENİ KODU)', () => {
    const dosyalar = [SERVER, ...kaynakDosyalari(join(SRC_KOK, 'server'))];
    const mf = suclular(dosyalar, /['"`]mikro-fatura['"`]/);
    // RET NEDENİ KODU (`FaturaKesilemezNedeni`) — kaynak değeri DEĞİL, sabite bağlanmaz (H1).
    expect(mf.map(x => x.site.replace(/:\d+$/, '')).every(s => s === 'src/server/mikro/faturaGonderimi.ts'), JSON.stringify(mf)).toBe(true);
    for (const x of mf) expect(x.kod, x.site).not.toMatch(/(kaynak|source)\s*[!=]==?\s*['"`]mikro-fatura|source:\s*['"`]mikro-fatura|IN \('mikro-fatura'/);
    expect(suclular(dosyalar, /['"`]mikrofat__/), 'mikrofat__ öneki').toEqual([]);
  });
});
