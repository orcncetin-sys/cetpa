// @vitest-environment node
/**
 * stokKodGocuUygula.zincir.test.ts — stok kodu göçünün UYGULAMA / GERİ ALMA / DURUM / PASİF uçları, GERÇEK `server.ts` + GERÇEK
 * express zinciri (şartname «Mikro bağlantı D» D4 / D5 + DH8 açılış temizliği, DH10, DH16, DH17; düzenek `stokKodGocu.zincir.test.ts`
 * ile AYNI kalıp).
 *
 * NEDEN GERÇEK ZİNCİR: «yazıldı ama bağlanmadı» — seçilen çağıran (ops jetonu, `ops-istek.sh`; kullanıcı kararı 05.11 Soru 3 → b)
 * rotaya ULAŞIYOR mu (DH17: jetonsuz 401, imzasız 400, yanlış imza 409), gövde ayrıştırıcısı rotadan önce mi (bozuk JSON 400), Yönetici
 * uçları kimlik → MFA → yalnız Yönetici sırasında mı, iki yeni koleksiyon `/api/db`'ye Yönetici'ye de kapalı mı (DH10), açılışta yarım
 * kalmış göç kilidi kaldırılıyor mu (DH8). Motorun ayrıntısı: `mikro/stokKodGocuUygula.pglite.test.ts`.
 *
 * SAHTE OLANLAR (yalnız süreç dışına çıkan her şey): Firebase belirteç doğrulayıcısı, `pg` havuzu (süreç içi PGlite), pg-boss,
 * node-cron, vite, `dotenv` (hiçbir ortam dosyası YÜKLENMEZ) ve dışarı giden `fetch` (Mikro LOKAL modda sahte uç). Canlıya, Firebase'e,
 * Mikro'ya istek YOK.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

const YARIM_CALISMA = 'skg-20261105200000-yarim1';

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
  const { DOCS_TABLOSU_DDL } = await import('./docsSema');
  const db = new PGlite();
  const g = globalThis as Record<string, unknown>;
  g.__stokKodUygulaPg = db;
  // DH8 açılış temizliği sınaması: süreç önceki çalışmada iş sürerken ölmüş — kilit ve «kosuyor» başlığı tablo kurulmadan önce durur.
  await db.exec(DOCS_TABLOSU_DDL);
  await db.query('INSERT INTO docs (coll, id, data) VALUES ($1, $2, $3::jsonb), ($4, $5, $6::jsonb)', [
    'opsLocks', 'bakim', JSON.stringify({ aciklama: 'stok-kod-gocu skg-20261105200000-yarim1', baslangic: '2026-11-05T20:00:00.000Z' }),
    'stokKodGocuKayitlari', 'skg-20261105200000-yarim1', JSON.stringify({ companyId: 'CETPA', calismaId: 'skg-20261105200000-yarim1', durum: 'kosuyor', aktor: { uid: 'ops', email: 'ops' }, ciftler: [] }),
  ]);
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

vi.setConfig({ testTimeout: 120_000 });

// ── Düzenek ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
interface Pg { query: (sql: string, p?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> }
const G = globalThis as Record<string, unknown>;
const pg = (): Pg => G.__stokKodUygulaPg as Pg;

interface Katman { name?: string; method?: string; handle: (...a: unknown[]) => unknown; route?: { path: unknown; methods: Record<string, boolean>; stack: Katman[] } }
interface Uygulama { router: { stack: Katman[] } }
let sunucu: http.Server | undefined;
let uygulama: Uygulama | undefined;
let kapiNo = 0;
let yuklemeDizini = '';
const gercekFetch = globalThis.fetch;
const disari: string[] = [];

const KIRACI = 'CETPA', BASKA = 'BASKA-FIRMA';
const OPS_JETONU = 'sinama-ops-jetonu-stok-kod-uygula-0123';
const OPS = { 'X-Ops-Token': OPS_JETONU };
const MIKRO_TABAN = 'http://mikro.ornek.test:8094/Api/APIMethods';
const eposta = (uid: string): string => `${uid.toLowerCase()}@example.test`;
const belirtec = (uid: string): Record<string, string> => ({ Authorization: `Bearer ${uid}|${eposta(uid)}|1` });

const ESKI = 'AKCALI-AKÇ.00312', YENI = 'AKCALI-00312';
const MIKRO_KOLONLARI: Record<string, string[]> = {
  STOKLAR: ['sto_Guid', 'sto_kod'],
  STOK_HAREKETLERI: ['sth_Guid', 'sth_stok_kod', 'sth_iptal', 'sth_evrakno_seri', 'sth_evrakno_sira', 'sth_satir_no', 'sth_evraktip'],
  STOK_SATIS_FIYAT_LISTELERI: ['sfiyat_Guid', 'sfiyat_stokkod'],
  BARKOD_TANIMLARI: ['bar_Guid', 'bar_stokkodu'],
};
const H1 = '00000101-0000-1111-2222-333333333333';
const MIKRO_STOKLAR = [{ kod: YENI, guid: '00000001-0000-1111-2222-333333333333' }, { kod: 'MIKRODA-1', guid: '00000002-0000-1111-2222-333333333333' }];
const MIKRO_HAREKET = [{ guid: H1, kod: YENI }];
const satirYaniti = (rows: unknown[]): Response =>
  new Response(JSON.stringify({ result: [{ IsError: false, Data: [{ SQLResult1: rows }] }] }), { status: 200, headers: { 'content-type': 'application/json' } });
function mikroYanit(sorgu: string): Response {
  const tablo = /TABLE_NAME = '([A-Z_]+)'/.exec(sorgu);
  if (tablo) return satirYaniti((MIKRO_KOLONLARI[tablo[1]] ?? []).map(c => ({ COLUMN_NAME: c })));
  const sayfa = /OFFSET (\d+) ROWS/.exec(sorgu);
  if (sayfa && Number(sayfa[1]) > 0) return satirYaniti([]);
  if (/FROM STOKLAR/.test(sorgu)) return satirYaniti(MIKRO_STOKLAR);
  if (/WHERE sth_Guid IN/.test(sorgu)) return satirYaniti(MIKRO_HAREKET.filter(h => sorgu.includes(`'${h.guid}'`)));
  return satirYaniti([]);
}

interface Yanit { s: number; j: Record<string, unknown>; metin: string }
let ipSayaci = 0;
const sonrakiIp = (): string => { ipSayaci++; return `10.${(ipSayaci >> 16) & 255}.${(ipSayaci >> 8) & 255}.${ipSayaci & 255}`; };
function istek(yontem: string, yol: string, basliklar: Record<string, string> = {}, govde?: unknown): Promise<Yanit> {
  return new Promise((coz, reddet) => {
    const veri = govde === undefined ? undefined : typeof govde === 'string' ? govde : JSON.stringify(govde);
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
  while (Date.now() < son) { if (await kosul()) return; await new Promise(r => setTimeout(r, 50)); }
  throw new Error(`beklenen olmadı (${ms} ms): ${ne}`);
};
const belgeKoy = (coll: string, id: string, data: Record<string, unknown>): Promise<unknown> =>
  pg().query('INSERT INTO docs (coll, id, data) VALUES ($1, $2, $3::jsonb) ON CONFLICT (coll, id) DO UPDATE SET data = EXCLUDED.data', [coll, id, JSON.stringify(data)]);
const belge = async (coll: string, id: string): Promise<Record<string, unknown> | null> => {
  const r = await pg().query('SELECT data FROM docs WHERE coll = $1 AND id = $2', [coll, id]);
  return r.rows.length ? r.rows[0].data as Record<string, unknown> : null;
};
const isVerisi = async (): Promise<string> => JSON.stringify((await pg().query(
  "SELECT coll, id, data::text AS d FROM docs WHERE coll IN ('inventory', 'orders', 'inventoryMovements', 'warehouseItems', 'stokKodEsleri') ORDER BY coll, id")).rows);

const TABLO = ['onayli1010', 'aktarim0930', 'revize0930'].map(kaynak => ({ eski: ESKI, yeni: YENI, kaynak }));
const ONAYLI = [{ eski: ESKI, yeni: YENI }];
const PASIF = ['RENKLENDİRME15LT'];

function rotaZinciri(yontem: string, yol: string): string[] {
  if (!uygulama) throw new Error('uygulama yakalanmadı');
  const bulunan: string[][] = [];
  for (const k of uygulama.router.stack) {
    if (!k.route || k.route.path !== yol || !k.route.methods[yontem.toLowerCase()]) continue;
    bulunan.push(k.route.stack.map(s => s.name || '(adsız)'));
  }
  expect(bulunan, `${yontem} ${yol} tam bir kez kayıtlı olmalı`).toHaveLength(1);
  return bulunan[0];
}
async function kuruImza(): Promise<string> {
  const r = await istek('POST', '/api/ops/stok-kod-gocu/kuru', OPS, TABLO);
  expect(r.s, r.metin).toBe(200);
  return String(r.j.planImza);
}
async function calismaBitti(calismaId: string, alan: 'durum' | 'geriAlma'): Promise<Record<string, unknown>> {
  let son: Record<string, unknown> = {};
  await bekle(async () => {
    const r = await istek('GET', `/api/ops/stok-kod-gocu/calisma/${calismaId}`, OPS);
    son = (r.j.calisma ?? {}) as Record<string, unknown>;
    if (alan === 'durum') return son.durum !== undefined && son.durum !== 'kosuyor';
    const g = son.geriAlma as { durum?: string } | null | undefined;
    return !!g && g.durum !== 'kosuyor';
  }, 60_000, `${calismaId} ${alan} bitti`);
  return son;
}

beforeAll(async () => {
  yuklemeDizini = fs.mkdtempSync(path.join(os.tmpdir(), 'stok-kod-uygula-'));
  process.env.PORT = '0';
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgres://sinama/yok';
  process.env.SESSION_TOKEN_SECRET = 'sinama-sirri';
  process.env.UPLOAD_DIR = yuklemeDizini;
  for (const ad of Object.keys(process.env)) {
    if (/^(STRIPE|RESEND|LUCA|SHOPIFY|SMTP|GEMINI|ANTHROPIC|MIKRO|IYZICO|TRENDYOL|HEPSIBURADA|DHL|UPS|FEDEX|YURTICI|MNG|ARAS|WHATSAPP|FIREBASE|GOOGLE_APPLICATION|OPS_|SERVER_TENANT_|SUPER_ADMIN)/.test(ad)) delete process.env[ad];
  }
  process.env.MIKRO_CRON_COMPANY_ID = KIRACI;
  process.env.MIKRO_API_URL = MIKRO_TABAN;
  process.env.MIKRO_LOCAL = '1';
  process.env.OPS_SUMMARY_TOKEN = OPS_JETONU;
  globalThis.fetch = (async (girdi: unknown, init?: RequestInit) => {
    const url = String(typeof girdi === 'string' ? girdi : (girdi as { url?: string }).url ?? girdi);
    disari.push(`${init?.method ?? 'GET'} ${url.replace(/\?.*$/, '')}`);
    if (url === `${MIKRO_TABAN}/SqlVeriOkuV2`) {
      const govde = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as { SQLSorgu?: unknown };
      return mikroYanit(String(govde.SQLSorgu ?? ''));
    }
    return new Response(JSON.stringify({ result: [{ IsError: false, Data: [] }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;

  const dinleyiciCasusu = vi.spyOn(http, 'createServer');
  await import('../../server.ts');
  await bekle(() => dinleyiciCasusu.mock.results.some(r => r.type === 'return'), 150_000, 'sunucu dinleyicisi kuruldu');
  const cagri = dinleyiciCasusu.mock.calls.findIndex(a => typeof a[0] === 'function');
  uygulama = dinleyiciCasusu.mock.calls[cagri][0] as unknown as Uygulama;
  sunucu = dinleyiciCasusu.mock.results[cagri].value as http.Server;
  dinleyiciCasusu.mockRestore();
  await bekle(() => sunucu?.listening === true, 30_000, 'sunucu dinliyor');
  kapiNo = (sunucu.address() as AddressInfo).port;
  await bekle(async () => {
    const r = await pg().query("SELECT to_regclass('mfa_secrets') AS m, to_regclass('mikro_stoklar') AS s");
    return !!(r.rows[0].m && r.rows[0].s);
  }, 60_000, 'tablolar hazır');
  // Açılış temizliği `initMfaTable`'dan hemen sonra koşar — kilidin kalkmasını bekle.
  await bekle(async () => (await belge('opsLocks', 'bakim')) === null, 30_000, 'açılış temizliği kilidi kaldırdı');

  await belgeKoy('users', 'ic-Admin', { email: eposta('ic-Admin'), role: 'Admin', companyId: KIRACI });
  await belgeKoy('users', 'ic-Sales', { email: eposta('ic-Sales'), role: 'Sales', companyId: KIRACI });
  await belgeKoy('inventory', 'k-eski', { sku: ESKI, name: 'GİZLİ AD', source: 'mikro_import', companyId: KIRACI, stockLevel: 0, notes: 'eski not' });
  await belgeKoy('inventory', 'k-yeni', { sku: YENI, name: 'GİZLİ AD', source: 'mikro_cron', companyId: KIRACI, stockLevel: 4 });
  await belgeKoy('inventory', 'k-kars', { sku: 'RENKLENDİRME15LT', source: 'mikro_import', companyId: KIRACI });
  await belgeKoy('inventory', 'b-eski', { sku: ESKI, source: 'mikro_import', companyId: BASKA });
  await belgeKoy('inventoryMovements', H1, { sth_stok_kod: ESKI, source: 'mikro_sql', companyId: KIRACI });
  await belgeKoy('orders', 'mf-1', { source: 'mikro-fatura', companyId: KIRACI, updatedAt: '2026-10-02T00:00:00.000Z', lineItems: [{ sku: ESKI, name: 'GİZLİ' }] });
  await belgeKoy('orders', 'mf-b', { source: 'mikro-fatura', companyId: BASKA, lineItems: [{ sku: ESKI }] });
}, 240_000);

afterAll(async () => {
  globalThis.fetch = gercekFetch;
  const s = sunucu;
  if (s) { s.closeAllConnections(); await new Promise<void>(r => s.close(() => r())); }
  if (yuklemeDizini) fs.rmSync(yuklemeDizini, { recursive: true, force: true });
}, 30_000);

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('kayıt ve zincir (yazıldı ama bağlanmadı çiti)', () => {
  it('ops uçları TAM bir kez kayıtlı (kapısız; ilk satırı jeton), Yönetici uçları kimlik → MFA → yalnız Yönetici', () => {
    for (const [y, yol] of [['POST', 'uygula'], ['POST', 'geri-al'], ['GET', 'pasif'], ['GET', 'calisma/:calismaId']] as const) {
      expect(rotaZinciri(y, `/api/ops/stok-kod-gocu/${yol}`), yol).toHaveLength(1);
      expect(rotaZinciri(y, `/api/stok-kod-gocu/${yol}`).slice(0, 3), yol).toEqual(['requireAuth', 'requireMfaVerified', 'yalnizYonetici']);
    }
  });

  it('DH8 · açılışta yarım kalmış göç kilidi kaldırıldı, başlık `yarida`; server.ts denetimi bağlar → TEK «yarıda kaldı» satırı (MKD3 dizin 2)', async () => {
    expect(await belge('opsLocks', 'bakim')).toBeNull();
    expect((await belge('stokKodGocuKayitlari', YARIM_CALISMA))?.durum).toBe('yarida');
    const d = await pg().query("SELECT data FROM docs WHERE coll = 'auditLog' AND data->>'action' = 'Stok kodu göçü yarıda kaldı'");
    expect(d.rows).toHaveLength(1);
    expect(d.rows[0].data).toMatchObject({ userId: 'ops', companyId: 'CETPA' });
    expect(String((d.rows[0].data as Record<string, unknown>).details)).toContain(`${YARIM_CALISMA}: uygulama yarıda kaldı`);
  });

  it('DH10 · iki yeni koleksiyon `/api/db`\'ye Yönetici\'ye de KAPALI (403)', async () => {
    for (const coll of ['stokKodEsleri', 'stokKodGocuKayitlari']) {
      const y = await istek('POST', `/api/db/${coll}`, belirtec('ic-Admin'), { companyId: KIRACI, eski: 'X', yeni: 'Y' });
      expect(y.s, `${coll}: ${y.metin}`).toBe(403);
      expect((await istek('GET', `/api/db/${coll}`, belirtec('ic-Admin'))).s, coll).toBe(403);
    }
  });
});

describe('DH17 · seçilen çağıran (ops jetonu) rotaya ulaşır', () => {
  it('jetonsuz / yanlış jetonla 401 (dört uç); Mikro\'ya istek gitmez', async () => {
    const once = disari.length;
    expect((await istek('POST', '/api/ops/stok-kod-gocu/uygula', {}, { planImza: 'a'.repeat(64), onayli: ONAYLI })).s).toBe(401);
    expect((await istek('POST', '/api/ops/stok-kod-gocu/uygula', { 'X-Ops-Token': 'yanlis' }, { planImza: 'a'.repeat(64), onayli: ONAYLI })).s).toBe(401);
    expect((await istek('POST', '/api/ops/stok-kod-gocu/geri-al', {}, { calismaId: YARIM_CALISMA })).s).toBe(401);
    expect((await istek('GET', '/api/ops/stok-kod-gocu/pasif')).s).toBe(401);
    expect((await istek('GET', `/api/ops/stok-kod-gocu/calisma/${YARIM_CALISMA}`)).s).toBe(401);
    expect(disari.slice(once)).toEqual([]);
  });

  it('jetonlu + imzasız 400; bozuk JSON 400 (ayrıştırıcı rotadan önce); jetonlu + yanlış imza 409 (hiçbir şey yazılmaz)', async () => {
    const once = await isVerisi();
    const imzasiz = await istek('POST', '/api/ops/stok-kod-gocu/uygula', OPS, { ciftler: TABLO, onayli: ONAYLI });
    expect([imzasiz.s, imzasiz.j.error]).toEqual([400, '`planImza` eksik ya da biçimsiz (kuru koşunun 64 haneli imzası).']);
    expect((await istek('POST', '/api/ops/stok-kod-gocu/uygula', OPS, '{"planImza": "')).s).toBe(400);
    const yanlis = await istek('POST', '/api/ops/stok-kod-gocu/uygula', OPS, { planImza: 'b'.repeat(64), ciftler: TABLO, onayli: ONAYLI });
    expect([yanlis.s, yanlis.j.error], yanlis.metin).toEqual([409, 'Veri değişti, kuru koşuyu yenile (plan imzası tutmuyor).']);
    expect(await isVerisi()).toBe(once);
    expect(await belge('opsLocks', 'bakim')).toBeNull();
  });

  it('Yönetici ucu: kimliksiz 401, Satış 403 `YONETICI_GEREKLI`, Yönetici + yanlış imza 409 (rotaya ulaşır)', async () => {
    const g = { planImza: 'b'.repeat(64), ciftler: TABLO, onayli: ONAYLI };
    expect((await istek('POST', '/api/stok-kod-gocu/uygula', {}, g)).s).toBe(401);
    const satis = await istek('POST', '/api/stok-kod-gocu/uygula', belirtec('ic-Sales'), g);
    expect([satis.s, satis.j.code]).toEqual([403, 'YONETICI_GEREKLI']);
    const yon = await istek('POST', '/api/stok-kod-gocu/uygula', belirtec('ic-Admin'), g);
    expect(yon.s, yon.metin).toBe(409);
    expect((await istek('GET', '/api/stok-kod-gocu/pasif', belirtec('ic-Sales'))).s).toBe(403);
  });
});

describe('D4 / D5 uçtan uca (ops jetonuyla): kuru → uygula 202 → durum → pasif → geri al', () => {
  let calismaId = '';
  let once = '';

  it('uygula: 202 + çalışma kimliği; iş bitince kart / sipariş / hareket / depo taşınmış, B\'ye dokunulmamış, kilit yok', async () => {
    once = await isVerisi();
    const imza = await kuruImza();
    const r = await istek('POST', '/api/ops/stok-kod-gocu/uygula', OPS, { planImza: imza, ciftler: TABLO, onayli: ONAYLI, pasif: PASIF });
    expect(r.s, r.metin).toBe(202);
    expect(r.j).toMatchObject({ success: true, durum: 'kosuyor', plan: { tam: 1, referans: 0, atla: 0, pasif: 1 } });
    calismaId = String(r.j.calismaId);
    expect(calismaId).toMatch(/^skg-\d{14}-[a-z0-9]{6}$/);
    const c = await calismaBitti(calismaId, 'durum');
    expect(c, JSON.stringify(c)).toMatchObject({ durum: 'tamam', aktor: { uid: 'ops' }, ozet: { uygulanan: 2, hatali: 0 } });
    expect(JSON.stringify(c)).not.toMatch(/GİZLİ/);
    expect(await belge('inventory', 'k-eski')).toBeNull();
    expect(await belge('inventory', 'k-yeni')).toMatchObject({ sku: YENI, notes: 'eski not', stockLevel: 4 });
    expect((await belge('orders', 'mf-1'))?.lineItems).toEqual([{ sku: YENI, name: 'GİZLİ' }]);
    expect((await belge('inventoryMovements', H1))?.sth_stok_kod).toBe(YENI);
    expect(await belge('inventory', 'b-eski')).toEqual({ sku: ESKI, source: 'mikro_import', companyId: BASKA });
    expect((await belge('orders', 'mf-b'))?.lineItems).toEqual([{ sku: ESKI }]);
    expect(await belge('opsLocks', 'bakim')).toBeNull();
    // Denetim satırı: aktör «ops», ürün adı yok.
    const d = await pg().query("SELECT data FROM docs WHERE coll = 'auditLog' AND data->>'action' = 'Stok kodu göçü uygulandı'");
    expect(d.rows).toHaveLength(1);
    expect(d.rows[0].data).toMatchObject({ userId: 'ops', companyId: KIRACI });
    expect(JSON.stringify(d.rows[0].data)).not.toMatch(/GİZLİ/);
  });

  it('pasif liste (ops): kod + kart kimliği, ad yok; başka kiracının çalışması 404', async () => {
    const p = await istek('GET', '/api/ops/stok-kod-gocu/pasif', OPS);
    expect(p.s, p.metin).toBe(200);
    expect(p.j).toMatchObject({ success: true, sayi: 1, liste: [{ kod: 'RENKLENDİRME15LT', kartId: 'k-kars', neden: 'mikroda_yok', calismaId }] });
    await belgeKoy('stokKodGocuKayitlari', 'skg-20261105200000-baska1', { companyId: BASKA, calismaId: 'skg-20261105200000-baska1', durum: 'tamam' });
    expect((await istek('GET', '/api/ops/stok-kod-gocu/calisma/skg-20261105200000-baska1', OPS)).s).toBe(404);
    expect((await istek('GET', '/api/ops/stok-kod-gocu/calisma/..%2Fusers', OPS)).s).toBe(400);
  });

  it('geri al (ops): 202; iş verisi önceki hâline döner; ikinci geri alma 409', async () => {
    const r = await istek('POST', '/api/ops/stok-kod-gocu/geri-al', OPS, { calismaId });
    expect(r.s, r.metin).toBe(202);
    const c = await calismaBitti(calismaId, 'geriAlma');
    expect(c.geriAlma, JSON.stringify(c.geriAlma)).toMatchObject({ durum: 'tamam', atlanan: [] });
    expect(await isVerisi()).toBe(once);
    expect((await belge('inventory', 'k-kars'))?.mikroPasif).toBeUndefined();
    const ikinci = await istek('POST', '/api/ops/stok-kod-gocu/geri-al', OPS, { calismaId });
    expect([ikinci.s, ikinci.j.error]).toEqual([409, 'Bu çalışma zaten geri alındı.']);
    expect(await belge('opsLocks', 'bakim')).toBeNull();
  });
});

// Y29 son inceleme bulgu 4 (06.11.2026): QR transfer ucu bakım kilidine uyar. Göç sürerken eski kart kimliğiyle konum belgesi açılırsa
// belge kuru koşu görüntüsünde olmadığı için taşınmaz, silinen karta bağlı kalırdı. Mutasyon: server.ts'teki `bakimKilidiVar` denetimi
// kaldırılır → ilk iddia kırmızı (200 + `vehicle__V1__k-eski` belgesi doğar).
describe('Y29 bulgu 4 · /api/logistics/transfer bakım kilidinde 423, yazım yok', () => {
  const govde = { productId: 'k-eski', sku: ESKI, quantity: 1, from: null, to: { type: 'vehicle', id: 'V1', name: 'Araç 1' }, transferId: 'y29-kilit-1' };
  const hareketSayisi = async (): Promise<number> =>
    (await pg().query("SELECT id FROM docs WHERE coll = 'inventoryMovements' AND data->>'idempotencyKey' = $1", [`${KIRACI}:y29-kilit-1`])).rows.length;

  it('kilit varken 423 «Bakım kilidi…» (öteki kilitli uçlarla aynı metin); konum belgesi ve hareket kaydı doğmaz; kilit kalkınca aynı istek 200', async () => {
    await belgeKoy('opsLocks', 'bakim', { aciklama: 'stok-kod-gocu skg-20261106000000-kilit1', baslangic: '2026-11-06T00:00:00.000Z' });
    try {
      const r = await istek('POST', '/api/logistics/transfer', belirtec('ic-Admin'), govde);
      expect([r.s, r.j.success, r.j.error], r.metin).toEqual([423, false, 'Bakım kilidi: stok-kod-gocu skg-20261106000000-kilit1 (2026-11-06T00:00:00.000Z) — veri bakımı bitince tekrar deneyin.']);
      expect(await belge('locationStocks', 'vehicle__V1__k-eski')).toBeNull();
      expect(await hareketSayisi()).toBe(0);
    } finally {
      await pg().query("DELETE FROM docs WHERE coll = 'opsLocks' AND id = 'bakim'");
    }
    const r2 = await istek('POST', '/api/logistics/transfer', belirtec('ic-Admin'), govde);
    expect([r2.s, r2.j.success], r2.metin).toEqual([200, true]);
    expect(await belge('locationStocks', 'vehicle__V1__k-eski')).toMatchObject({ productId: 'k-eski', quantity: 1, companyId: KIRACI });
    expect(await hareketSayisi()).toBe(1);
  });
});
