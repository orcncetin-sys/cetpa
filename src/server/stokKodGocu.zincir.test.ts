// @vitest-environment node
/**
 * stokKodGocu.zincir.test.ts — stok kodu göçünün KURU KOŞU uçları, GERÇEK `server.ts` + GERÇEK express zinciri (şartname
 * «Mikro bağlantı D» D1 + DH16 / DH17; düzenek `geceFaturadanSiparis.zincir.test.ts` ile AYNI kalıp).
 *
 * NEDEN GERÇEK ZİNCİR: «yazıldı ama bağlanmadı» sınıfı — rota kayıtlı mı, gövde ayrıştırıcısı genel ayrıştırıcıdan ÖNCE mi (100 KB
 * sınırını aşan onay listesi, bozuk JSON → 400), kapılar sırasıyla mı (kimlik → MFA → yalnız Yönetici), ops ucu jetonsuz 401 mi,
 * kiracı Mikro işlerinin kiracısı mı. Saf karar ve motor: `mikro/stokKodGocu.test.ts`, `mikro/stokKodGocuKuru.pglite.test.ts`.
 *
 * SAHTE OLANLAR (yalnız süreç dışına çıkan her şey): Firebase belirteç doğrulayıcısı (belirteç = "<uid>|<e-posta>|<1|0>"), `pg`
 * havuzu (süreç içi PGlite), pg-boss, node-cron, vite, `dotenv` (hiçbir ortam dosyası YÜKLENMEZ) ve dışarı giden `fetch`: Mikro
 * LOKAL modda sahte bir uca konuşur (SQL metninden tanınan SELECT'ler). Canlıya, Firebase'e, Mikro'ya istek YOK.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

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
  g.__stokKodGocuPg = db;
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
const pg = (): Pg => G.__stokKodGocuPg as Pg;

interface Katman { name?: string; method?: string; handle: (...a: unknown[]) => unknown; route?: { path: unknown; methods: Record<string, boolean>; stack: Katman[] } }
interface Uygulama { router: { stack: Katman[] } }
let sunucu: http.Server | undefined;
let uygulama: Uygulama | undefined;
let kapiNo = 0;
let yuklemeDizini = '';
const gercekFetch = globalThis.fetch;
/** Sunucunun dışarı yapmaya çalıştığı her istek (hiçbiri gitmez). */
const disari: string[] = [];

const KIRACI = 'CETPA', BASKA = 'BASKA-FIRMA';
const OPS_JETONU = 'sinama-ops-jetonu-stok-kod-0123456789';
const OPS = { 'X-Ops-Token': OPS_JETONU };
const MIKRO_TABAN = 'http://mikro.ornek.test:8094/Api/APIMethods';
const eposta = (uid: string): string => `${uid.toLowerCase()}@example.test`;
const belirtec = (uid: string): Record<string, string> => ({ Authorization: `Bearer ${uid}|${eposta(uid)}|1` });

// Sahte Mikro: STOKLAR güncel kodları + hareket GUID'leri. Kolon adları şema sorgusundan döner (motor tahmin etmez).
const MIKRO_KOLONLARI: Record<string, string[]> = {
  STOKLAR: ['sto_Guid', 'sto_kod'],
  STOK_HAREKETLERI: ['sth_Guid', 'sth_stok_kod', 'sth_iptal', 'sth_evrakno_seri', 'sth_evrakno_sira', 'sth_satir_no', 'sth_evraktip'],
  STOK_SATIS_FIYAT_LISTELERI: ['sfiyat_Guid', 'sfiyat_stokkod'],
  BARKOD_TANIMLARI: ['bar_Guid', 'bar_stokkodu'],
};
const H1 = '00000101-0000-1111-2222-333333333333';
const MIKRO_STOKLAR = [{ kod: 'AKCALI-00312', guid: '00000001-0000-1111-2222-333333333333' }, { kod: 'MIKRODA-1', guid: '00000002-0000-1111-2222-333333333333' }];
const MIKRO_HAREKET = [{ guid: H1, kod: 'AKCALI-00312' }];
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
/** `govde` dize ise OLDUĞU GİBİ gönderilir (bozuk JSON sınaması), değilse JSON'a çevrilir. */
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
  while (Date.now() < son) { if (await kosul()) return; await new Promise(r => setTimeout(r, 20)); }
  throw new Error(`beklenen olmadı (${ms} ms): ${ne}`);
};
const belgeKoy = (coll: string, id: string, data: Record<string, unknown>): Promise<unknown> =>
  pg().query('INSERT INTO docs (coll, id, data) VALUES ($1, $2, $3::jsonb) ON CONFLICT (coll, id) DO UPDATE SET data = EXCLUDED.data', [coll, id, JSON.stringify(data)]);
/** İş verisi koleksiyonlarının içerik + damga dökümü (kuru koşu YAZMAZ kanıtı; `users` önbelleği / denetim dışarıda). */
const isVerisi = async (): Promise<string> => JSON.stringify((await pg().query(
  "SELECT coll, id, data::text AS d, updated_at FROM docs WHERE coll IN ('inventory', 'orders', 'inventoryMovements', 'warehouseItems', 'magazaTalepleri') ORDER BY coll, id")).rows);

const GOVDE = { ciftler: ['onayli1010', 'aktarim0930', 'revize0930'].map(kaynak => ({ eski: 'AKCALI-AKÇ.00312', yeni: 'AKCALI-00312', kaynak })) };

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

beforeAll(async () => {
  yuklemeDizini = fs.mkdtempSync(path.join(os.tmpdir(), 'stok-kod-gocu-'));
  process.env.PORT = '0';
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgres://sinama/yok';      // yalnız «PG var» dalını açar; havuz PGlite
  process.env.SESSION_TOKEN_SECRET = 'sinama-sirri';
  process.env.UPLOAD_DIR = yuklemeDizini;
  for (const ad of Object.keys(process.env)) {
    if (/^(STRIPE|RESEND|LUCA|SHOPIFY|SMTP|GEMINI|ANTHROPIC|MIKRO|IYZICO|TRENDYOL|HEPSIBURADA|DHL|UPS|FEDEX|YURTICI|MNG|ARAS|WHATSAPP|FIREBASE|GOOGLE_APPLICATION|OPS_|SERVER_TENANT_|SUPER_ADMIN)/.test(ad)) delete process.env[ad];
  }
  // Mikro işlerinin kiracısı ortamdan; gece işleri KAYDEDİLMEZ (MIKRO_CRON_SYNC yok). Mikro LOKAL mod: belirteç adımı yok.
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
    const r = await pg().query("SELECT to_regclass('docs') AS d, to_regclass('mfa_secrets') AS m, to_regclass('mikro_stoklar') AS s");
    return !!(r.rows[0].d && r.rows[0].m && r.rows[0].s);
  }, 60_000, 'tablolar hazır');

  await belgeKoy('users', 'ic-Admin', { email: eposta('ic-Admin'), role: 'Admin', companyId: KIRACI });
  await belgeKoy('users', 'ic-Sales', { email: eposta('ic-Sales'), role: 'Sales', companyId: KIRACI });
  await belgeKoy('users', 'baska-Admin', { email: eposta('baska-Admin'), role: 'Admin', companyId: BASKA });
  await belgeKoy('inventory', 'k-eski', { sku: 'AKCALI-AKÇ.00312', name: 'GİZLİ AD', source: 'mikro_import', companyId: KIRACI, stockLevel: 0 });
  await belgeKoy('inventory', 'k-yeni', { sku: 'AKCALI-00312', name: 'GİZLİ AD', source: 'mikro_cron', companyId: KIRACI, stockLevel: 4 });
  await belgeKoy('inventory', 'k-kars', { sku: 'RENKLENDİRME15LT', source: 'mikro_import', companyId: KIRACI });
  await belgeKoy('inventory', 'b-eski', { sku: 'AKCALI-AKÇ.00312', source: 'mikro_import', companyId: BASKA });
  await belgeKoy('inventoryMovements', H1, { sth_stok_kod: 'AKCALI-AKÇ.00312', source: 'mikro_sql', companyId: KIRACI });
  await belgeKoy('orders', 'mf-1', { source: 'mikro_fatura', companyId: KIRACI, lineItems: [{ sku: 'AKCALI-AKÇ.00312', name: 'GİZLİ' }] });
  await belgeKoy('orders', 'mf-b', { source: 'mikro_fatura', companyId: BASKA, lineItems: [{ sku: 'AKCALI-AKÇ.00312' }] });
}, 240_000);

afterAll(async () => {
  globalThis.fetch = gercekFetch;
  const s = sunucu;
  if (s) { s.closeAllConnections(); await new Promise<void>(r => s.close(() => r())); }
  if (yuklemeDizini) fs.rmSync(yuklemeDizini, { recursive: true, force: true });
}, 30_000);

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('kayıt ve zincir (yazıldı ama bağlanmadı çiti)', () => {
  it('iki uç TAM bir kez kayıtlı; ops ucu kapısız (ilk satırı jeton), Yönetici ucu kimlik → MFA → yalnız Yönetici', () => {
    expect(rotaZinciri('POST', '/api/ops/stok-kod-gocu/kuru')).toHaveLength(1);
    expect(rotaZinciri('POST', '/api/stok-kod-gocu/kuru').slice(0, 3)).toEqual(['requireAuth', 'requireMfaVerified', 'yalnizYonetici']);
  });
});

describe('POST /api/ops/stok-kod-gocu/kuru (ops jetonu)', () => {
  it('jetonsuz / yanlış jetonla 401; Mikro\'ya istek gitmez', async () => {
    const once = disari.length;
    expect((await istek('POST', '/api/ops/stok-kod-gocu/kuru', {}, GOVDE)).s).toBe(401);
    expect((await istek('POST', '/api/ops/stok-kod-gocu/kuru', { 'X-Ops-Token': 'yanlis' }, GOVDE)).s).toBe(401);
    expect(disari.slice(once)).toEqual([]);
  });

  it('bozuk JSON → 400 (ayrıştırıcı rotadan ÖNCE zincirde; 401 DEĞİL), bilinmeyen alan → 400', async () => {
    const bozuk = await istek('POST', '/api/ops/stok-kod-gocu/kuru', OPS, '{"ciftler": [');
    expect([bozuk.s, bozuk.j.error]).toEqual([400, 'Gövde JSON olarak okunamadı.']);
    expect((await istek('POST', '/api/ops/stok-kod-gocu/kuru', {}, '{bozuk')).s).toBe(400);
    const fazla = await istek('POST', '/api/ops/stok-kod-gocu/kuru', OPS, { ciftler: [], planImza: 'x' });
    expect([fazla.s, fazla.j.error]).toEqual([400, 'Tanınmayan alan: planImza.']);
  });

  it('jetonla 200: kiracı Mikro kiracısı (B\'nin kartı / siparişi sayılmaz), sınıflar, bağlı kayıt, imza; YAZIM YOK, ad YOK', async () => {
    const once = await isVerisi();
    const mikroOnce = disari.length;
    const r = await istek('POST', '/api/ops/stok-kod-gocu/kuru', OPS, GOVDE);
    expect(r.s, r.metin).toBe(200);
    expect(r.j.siniflar).toEqual({ kesin: 1, dogrula: 0, cok_anlamli: 0, karsiliksiz: 1, degismemis: 0 });
    expect(r.j.evren).toMatchObject({ kart: 2, kod: 2, etiketsizKart: 0 });
    const bagli = r.j.bagliKayit as Record<string, { bagliBelge: number }>;
    expect([bagli.orders.bagliBelge, bagli.inventoryMovements.bagliBelge]).toEqual([1, 1]);
    expect(r.j.kiraci).toEqual({ aynaKanitiKullanildi: true });
    expect(r.j.planImza).toMatch(/^[0-9a-f]{64}$/);
    expect(r.metin).not.toMatch(/GİZLİ/);
    expect(await isVerisi()).toBe(once);
    const mikroya = disari.slice(mikroOnce);
    expect(mikroya.length).toBeGreaterThan(0);
    expect(mikroya.every(u => u === `POST ${MIKRO_TABAN}/SqlVeriOkuV2`), mikroya.join('\n')).toBe(true);
  });

  it('100 KB genel sınırını aşan onay listesi (1.500 satır) kabul edilir — yolun kendi ayrıştırıcısı bağlı', async () => {
    const ciftler = [...GOVDE.ciftler, ...Array.from({ length: 1500 }, (_, i) => ({ eski: `TABLO-ESKI-KODU-${String(i).padStart(6, '0')}`, yeni: `TABLO-YENI-KODU-${String(i).padStart(6, '0')}`, kaynak: 'revize0930' }))];
    expect(Buffer.byteLength(JSON.stringify({ ciftler }))).toBeGreaterThan(100 * 1024);
    const r = await istek('POST', '/api/ops/stok-kod-gocu/kuru', OPS, { ciftler });
    expect(r.s, r.metin.slice(0, 200)).toBe(200);
    expect((r.j.girdi as { tabloSatiri: number }).tabloSatiri).toBe(1503);
    expect((r.j.tablo as { kartsizEski: number }).kartsizEski).toBe(1500);
  });

  it('tablo dosyası OLDUĞU GİBİ (çıplak dizi; şartname D1 / DH16 biçimi) `{ ciftler }` ile AYNI sınıf ve imzayı verir', async () => {
    const nesne = await istek('POST', '/api/ops/stok-kod-gocu/kuru', OPS, GOVDE);
    const dizi = await istek('POST', '/api/ops/stok-kod-gocu/kuru', OPS, GOVDE.ciftler);
    expect(dizi.s, dizi.metin).toBe(200);
    expect([dizi.j.siniflar, dizi.j.planImza]).toEqual([nesne.j.siniflar, nesne.j.planImza]);
  });

  it('Mikro kiracısı çözülemezse (ortam değeri yok + iki rollü kiracı) 503', async () => {
    const yedek = process.env.MIKRO_CRON_COMPANY_ID;
    delete process.env.MIKRO_CRON_COMPANY_ID;
    try {
      const r = await istek('POST', '/api/ops/stok-kod-gocu/kuru', OPS, GOVDE);
      expect(r.s, r.metin).toBe(503);
    } finally { process.env.MIKRO_CRON_COMPANY_ID = yedek; }
  });
});

describe('POST /api/stok-kod-gocu/kuru (Yönetici)', () => {
  it('kimliksiz 401; Satış rolü 403 (`YONETICI_GEREKLI`), Mikro\'ya istek gitmez', async () => {
    const once = disari.length;
    expect((await istek('POST', '/api/stok-kod-gocu/kuru', {}, GOVDE)).s).toBe(401);
    const satis = await istek('POST', '/api/stok-kod-gocu/kuru', belirtec('ic-Sales'), GOVDE);
    expect([satis.s, satis.j.code]).toEqual([403, 'YONETICI_GEREKLI']);
    expect(disari.slice(once)).toEqual([]);
  });

  it('Mikro kiracısının Yöneticisi: ops ucuyla AYNI gövde (aynı imza), ayna kanıtı açık', async () => {
    const ops = await istek('POST', '/api/ops/stok-kod-gocu/kuru', OPS, GOVDE);
    const yon = await istek('POST', '/api/stok-kod-gocu/kuru', belirtec('ic-Admin'), GOVDE);
    expect(yon.s, yon.metin).toBe(200);
    expect(yon.j.planImza).toBe(ops.j.planImza);
    expect(yon.j.siniflar).toEqual(ops.j.siniflar);
    expect(yon.j.kiraci).toEqual({ aynaKanitiKullanildi: true });
  });

  it('başka kiracının Yöneticisi: yalnız KENDİ kartı ve siparişi; ayna kanıtı kapalı (DH13)', async () => {
    const r = await istek('POST', '/api/stok-kod-gocu/kuru', belirtec('baska-Admin'), GOVDE);
    expect(r.s, r.metin).toBe(200);
    expect(r.j.evren).toMatchObject({ kart: 1, kod: 1 });
    const satirlar = r.j.satirlar as Record<string, Array<{ eski: string; kartlar: string[] }>>;
    expect([...satirlar.kesin, ...satirlar.dogrula].map(x => x.kartlar)).toEqual([['b-eski']]);
    expect((r.j.bagliKayit as Record<string, { bagliBelge: number }>).orders.bagliBelge).toBe(1);
    expect((r.j.bagliKayit as Record<string, { bagliBelge: number }>).inventoryMovements.bagliBelge).toBe(0);
    expect(r.j.kiraci).toEqual({ aynaKanitiKullanildi: false });
  });
});
