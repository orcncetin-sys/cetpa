// @vitest-environment node
/**
 * faturaCiftKesim.zincir.test.ts — e-Fatura ÇİFT KESİM koruması, GERÇEK `server.ts` + GERÇEK express zinciri + GERÇEK SQL
 * (şartname `.wf/SARTNAME-efatura-cift-kesim.md` § 2 ve § 7.4: T1–T21, T23–T32, T34–T36; T22 `mikroClient.test.ts`'te, T33
 * `routes/mikroRoutes.rolKapisi.test.ts`'te).
 *
 * NEDEN GERÇEK ZİNCİR: koruma bir kapı DEĞİL, bir SÖZLEŞMEDİR — koşullu tek SQL (talep), atomik geçişler, `/api/db`'nin beş yazma
 * yolundaki alan koruması ve Mikro yanıtının sınıflandırması birlikte çalışmazsa aynı sipariş için ikinci resmî belge kesilir.
 * Saf karar işlevleri tek başına doğru olup bağlanmamış olabilir («yazıldı ama bağlanmadı»). Burada `server.ts` içe aktarılır,
 * gerçek bir kapıda dinler; `docs` tablosu canlıyla AYNI DDL'den (PGlite, `DOCS_TABLOSU_DDL` — server.ts kurar).
 *
 * SAHTE OLANLAR (yalnız süreç dışına çıkan her şey): Firebase belirteç doğrulayıcısı (belirteç = "<uid>|<e-posta>|<1|0>"), `pg`
 * havuzu (süreç içi PGlite), pg-boss, node-cron, vite, `dotenv` (hiçbir ortam dosyası YÜKLENMEZ) ve dışarı giden `fetch`: Mikro
 * BULUT modunda (belirteç adımı ve stub tekrarı yalnız orada var) sahte bir uca konuşur — hiçbir istek makineden çıkmaz.
 * «Mikro 0» = `FaturaKaydetV2` hiç çağrılmadı. İşaret tohumları doğrudan SQL ile yazılır (D3 sonrası `/api/db` yazamaz).
 *
 * SIRA ÖNEMLİ: (1) T12 dosyanın BAŞINDA — vergi tablosu bir kez okununca bir saat önbellekte kalır; (2) T18 stub'ın ilk
 * görüldüğü yerdir (stub tekrarının 5 dk geri çekilmesi süreç geneli — tekrar açıksa bu sınama İKİ çağrı görür).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { FATURA_GONDERIM_ALANI, FATURA_GONDERIM_BAYATLIK_MS } from '../lib/faturaGonderimi';
import { SUNUCU_TURETILEN_ALANLAR } from '../lib/collections';
import { MAGAZA_KAYNAGI } from '../lib/magazaKaynagi';
import { SRC_KOK, kodSatirlari } from '../test/kaynakTarama';
import { cetpaEttnAnahtari } from '../lib/ettn';
import { ETTN_VAKALARI } from '../test/ettnVakalari';

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
  g.__faturaPg = db;
  const q = async (text: unknown, params?: unknown[]) => {
    let sql = String(text); let p = params;
    if (text && typeof text === 'object') { const o = text as { text: string; values?: unknown[] }; sql = o.text; p = o.values; }
    // Ön kanca (T26): sorgu KOŞMADAN önce bekletir — «yazım ifadesi koşmadan araya başka bir yazım girsin».
    const onKanca = g.__faturaPgOnKanca as ((sql: string, p: unknown[] | undefined) => Promise<void> | void) | undefined;
    if (onKanca) await onKanca(sql, p);
    let sonuc: { rows: unknown[]; rowCount: number | null };
    if (!p || p.length === 0) {
      const r = await db.exec(sql);
      const son = r[r.length - 1];
      sonuc = son ? { rows: son.rows, rowCount: son.affectedRows ?? son.rows.length } : { rows: [], rowCount: null };
    } else {
      const r = await db.query(sql, p);
      sonuc = { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
    }
    // Yarış kancası (T24): sorgu KOŞTUKTAN sonra, sonucu çağırana vermeden bekletir — «SELECT talepten önce, yazım sonra».
    const kanca = g.__faturaPgKanca as ((sql: string, p: unknown[] | undefined) => Promise<void> | void) | undefined;
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
const pg = (): Pg => G.__faturaPg as Pg;

let sunucu: http.Server | undefined;
let kapiNo = 0;
let yuklemeDizini = '';
const gercekFetch = globalThis.fetch;

const KIRACI = 'CETPA';
const BASKA_KIRACI = 'BASKA-FIRMA';
const MIKRO_TABAN = 'https://mikro.ornek.test:8094/Api/APIMethods';
const eposta = (uid: string): string => `${uid.toLowerCase()}@example.test`;
const belirtec = (uid: string): Record<string, string> => ({ Authorization: `Bearer ${uid}|${eposta(uid)}|1` });
const YONETICI = belirtec('ic-Admin');
const SATIS = belirtec('ic-Sales');
const BAYI = belirtec('dis-Dealer');
const B2B = belirtec('dis-B2B');
const YABANCI = belirtec('yabanci-Admin');
const MFA_ACIK = belirtec('mfa-Admin');

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
const satirVar = async (coll: string, id: string): Promise<boolean> => (await belgeOku(coll, id)) !== undefined;
const isaretOku = async (id: string): Promise<Record<string, unknown> | undefined> =>
  (await belgeOku('orders', id))?.[FATURA_GONDERIM_ALANI] as Record<string, unknown> | undefined;

// ── Sahte Mikro (BULUT modu) ───────────────────────────────────────────────────────────────────────────────────────────────
const json = (govde: unknown, durum = 200): Response => new Response(JSON.stringify(govde), { status: durum, headers: { 'content-type': 'application/json' } });
const mikroBasari = (veri: Record<string, unknown>): Response => json({ result: [{ IsError: false, StatusCode: 200, Data: veri }] });
interface MikroSahtesi {
  /** `FaturaKaydetV2` çağrı sayısı («Mikro N»). */
  sayac: number;
  govdeler: string[];
  /** Sıradaki `FaturaKaydetV2` yanıtları (bitince `varsayilan`). İşlev fırlatırsa `fetch` fırlatır. */
  sira: Array<() => Response | Promise<Response>>;
  varsayilan: () => Response | Promise<Response>;
  belirtecHatasi: boolean;
  vergiHatasi: boolean;
  /** Bir sonraki IDM belirteç isteğinde yanıttan ÖNCE BİR KEZ koşar (İ1-2 geri alma yarışı: «belirteç alınırken araya giren çözüm»). */
  belirtecKancasi?: () => Promise<void>;
}
const mikro: MikroSahtesi = { sayac: 0, govdeler: [], sira: [], varsayilan: () => mikroBasari({}), belirtecHatasi: false, vergiHatasi: false };
let numaraSayaci = 0;
const yeniNumara = (): string => { numaraSayaci++; return `CTP2026${String(numaraSayaci).padStart(9, '0')}`; };
/** Sıradaki çağrının yanıtı. */
const sonraki = (y: () => Response | Promise<Response>): void => { mikro.sira.push(y); };
/** Mikro sayacını sıfırlayıp `fn`'i koşar ve kaç `FaturaKaydetV2` çağrısı yapıldığını döner. */
const mikroSay = async <T,>(fn: () => Promise<T>): Promise<{ n: number; sonuc: T }> => {
  const once = mikro.sayac;
  const sonuc = await fn();
  return { n: mikro.sayac - once, sonuc };
};

// ── Sipariş ve istekler ────────────────────────────────────────────────────────────────────────────────────────────────────
const SIPARIS_GOVDESI = {
  mikroCariKod: '120.01.0042', customerName: 'Şirin Yapı Malzemeleri',
  lineItems: [{ sku: 'CIM-50', name: 'ÇİMENTO 50KG', quantity: 40, price: 312.5 }],
  faturaTipi: 'e-arsiv', kdvOran: 20, createdAt: '2026-10-17T09:00:00.000Z',
};
let siparisSayaci = 0;
/** Kiracının yeni bir siparişini (doğrudan SQL) kurar ve kimliğini döner. */
const siparisKur = async (ek: Record<string, unknown> = {}, id = `sip-${++siparisSayaci}`): Promise<string> => {
  await belgeKoy('orders', id, { customerName: 'Şirin Yapı Malzemeleri', totalPrice: 15000, status: 'Processing', companyId: KIRACI, ...ek });
  return id;
};
const kes = (b: Record<string, string>, firebaseId: unknown, ek: Record<string, unknown> = {}): Promise<Yanit> =>
  istek('POST', '/api/mikro/fatura/kaydet', b, { order: SIPARIS_GOVDESI, ...(firebaseId === undefined ? {} : { firebaseId }), ...ek });
const coz = (b: Record<string, string>, firebaseId: string, karar: string, numara?: string): Promise<Yanit> =>
  istek('POST', '/api/mikro/fatura/sonuc', b, { firebaseId, karar, ...(numara !== undefined ? { numara } : {}) });
const isaretKoy = async (id: string, isaret: unknown): Promise<void> => {
  const d = await belgeOku('orders', id);
  if (!d) throw new Error(`sipariş yok: ${id}`);
  await belgeKoy('orders', id, { ...d, [FATURA_GONDERIM_ALANI]: isaret });
};
const isaretNesnesi = (durum: string, zamanMs = Date.now(), ek: Record<string, unknown> = {}) =>
  ({ durum, istekNo: `tohum-${durum}-${zamanMs}`, zaman: new Date(zamanMs).toISOString(), kim: 'tohum@example.test', ...ek });
const syncLogSatirlari = async (islem: string, id: string): Promise<Array<Record<string, unknown>>> =>
  (await pg().query("SELECT data FROM docs WHERE coll = 'syncLog' AND data->>'operation' = $1 AND data->>'entityId' = $2", [islem, id])).rows.map(r => r.data as Record<string, unknown>);

beforeAll(async () => {
  yuklemeDizini = fs.mkdtempSync(path.join(os.tmpdir(), 'fatura-cift-kesim-'));
  process.env.PORT = '0';
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgres://sinama/yok';      // yalnız «PG var» dalını açar; havuz PGlite
  process.env.SESSION_TOKEN_SECRET = 'sinama-sirri';
  process.env.UPLOAD_DIR = yuklemeDizini;
  for (const ad of Object.keys(process.env)) {
    if (/^(STRIPE|RESEND|LUCA|SHOPIFY|SMTP|GEMINI|ANTHROPIC|MIKRO|IYZICO|TRENDYOL|HEPSIBURADA|DHL|UPS|FEDEX|YURTICI|MNG|ARAS|WHATSAPP|FIREBASE|GOOGLE_APPLICATION|OPS_|SERVER_TENANT_|SUPER_ADMIN)/.test(ad)) delete process.env[ad];
  }
  // Mikro BULUT modu (belirteç adımı ve stub tekrarı yalnız burada) — adres sahte, istek makineden çıkmaz. Modül sabitleri
  // `server.ts` içe aktarılırken okunur: değerler ÖNCE konur.
  process.env.MIKRO_API_URL = MIKRO_TABAN;
  process.env.MIKRO_LOCAL = '0';
  process.env.MIKRO_JUMP_SURUM = '17';
  process.env.MIKRO_IDM_EMAIL = 'srv@example.test';
  process.env.MIKRO_IDM_PASSWORD = 'sinama-parolasi';
  process.env.MIKRO_API_KEY = 'sinama-anahtari';
  process.env.MIKRO_ALIAS = 'sinama';
  globalThis.fetch = (async (girdi: unknown, init?: RequestInit) => {
    const url = String(typeof girdi === 'string' ? girdi : (girdi as { url?: string }).url ?? girdi);
    if (url.startsWith('https://onlinekullanici.mikro.com.tr/')) {
      const kanca = mikro.belirtecKancasi;
      if (kanca) { mikro.belirtecKancasi = undefined; await kanca(); }
      if (mikro.belirtecHatasi) return new Response('IDM erişilemiyor', { status: 500 });
      return json({ access_token: 'sinama-belirteci', expires_in: 21600 });
    }
    if (url === `${MIKRO_TABAN}/VergiListesiV2`) {
      if (mikro.vergiHatasi) throw new TypeError('fetch failed');
      return json({ result: [{ IsError: false, Data: { VergiListesi: [
        { vergiSiraNo: 1, vergiOrani: 0, vergiAdi: 'YOK' }, { vergiSiraNo: 3, vergiOrani: 10, vergiAdi: 'KDV %10' }, { vergiSiraNo: 4, vergiOrani: 20, vergiAdi: 'KDV %20' },
      ] } }] });
    }
    if (url === `${MIKRO_TABAN}/FaturaKaydetV2`) {
      mikro.sayac++;
      mikro.govdeler.push(typeof init?.body === 'string' ? init.body : '');
      const y = mikro.sira.shift() ?? mikro.varsayilan;
      return await y();
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
  mikro.varsayilan = () => mikroBasari({ faturaNo: yeniNumara(), ettn: `ettn-${numaraSayaci}` });

  for (const rol of ['Admin', 'Sales'] as const) await belgeKoy('users', `ic-${rol}`, { email: eposta(`ic-${rol}`), role: rol, companyId: KIRACI });
  await belgeKoy('users', 'dis-Dealer', { email: eposta('dis-Dealer'), role: 'Dealer', companyId: KIRACI });
  await belgeKoy('users', 'dis-B2B', { email: eposta('dis-B2B'), role: 'B2B', companyId: KIRACI });
  await belgeKoy('users', 'yabanci-Admin', { email: eposta('yabanci-Admin'), role: 'Admin', companyId: BASKA_KIRACI });
  await belgeKoy('users', 'mfa-Admin', { email: eposta('mfa-Admin'), role: 'Admin', companyId: KIRACI });
  await pg().query('INSERT INTO mfa_secrets (uid, secret, enabled) VALUES ($1, $2, true)', ['mfa-Admin', 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP']);
}, 240_000);

afterAll(async () => {
  globalThis.fetch = gercekFetch;
  G.__faturaPgKanca = undefined;
  G.__faturaPgOnKanca = undefined;
  const s = sunucu;
  if (s) { s.closeAllConnections(); await new Promise<void>(r => s.close(() => r())); }
  if (yuklemeDizini) fs.rmSync(yuklemeDizini, { recursive: true, force: true });
}, 30_000);

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('D2 — gönderim başlamadan düşen hata: işaret YOK, «gönderilmedi»', () => {
  it('T12 — Mikro vergi tablosu okunamadı (boş tablo) → 400 FATURA_GONDERILMEDI, işaret yok, Mikro 0', async () => {
    const id = await siparisKur();
    mikro.vergiHatasi = true;
    try {
      const { n, sonuc } = await mikroSay(() => kes(YONETICI, id));
      expect([sonuc.s, sonuc.j.kod], sonuc.metin).toEqual([400, 'FATURA_GONDERILMEDI']);
      expect(String(sonuc.j.error)).toContain('VergiListesiV2');
      expect(n).toBe(0);
      expect(await belgeOku('orders', id)).not.toHaveProperty(FATURA_GONDERIM_ALANI);
    } finally { mikro.vergiHatasi = false; }
  });

  it('T11 — gövde hatası (KDV oranı yok) → 400 FATURA_GONDERILMEDI, işaret yok; düzeltilince ikinci istek Mikro\'ya gider', async () => {
    const id = await siparisKur();
    const { kdvOran: _yok, ...kdvsiz } = SIPARIS_GOVDESI;
    const r1 = await mikroSay(() => istek('POST', '/api/mikro/fatura/kaydet', YONETICI, { order: kdvsiz, firebaseId: id }));
    expect([r1.sonuc.s, r1.sonuc.j.kod, r1.n]).toEqual([400, 'FATURA_GONDERILMEDI', 0]);
    expect(await belgeOku('orders', id)).not.toHaveProperty(FATURA_GONDERIM_ALANI);
    const r2 = await mikroSay(() => kes(YONETICI, id));
    expect([r2.sonuc.s, r2.sonuc.j.success, r2.n], r2.sonuc.metin).toEqual([200, true, 1]);
  });

  it('T13 — belirteç alınamadı (FaturaKaydetV2 fetch\'i başlamaz) → FATURA_GONDERILMEDI, işaret anahtarı YOK (geri alındı); sonraki istek Mikro\'ya gider', async () => {
    const id = await siparisKur();
    const { mikroTokenCacheMap } = await import('./mikroClient');
    mikroTokenCacheMap.clear();
    mikro.belirtecHatasi = true;
    try {
      const { n, sonuc } = await mikroSay(() => kes(YONETICI, id));
      expect([sonuc.s, sonuc.j.kod], sonuc.metin).toEqual([502, 'FATURA_GONDERILMEDI']);
      expect(String(sonuc.j.error)).toContain('token');
      expect(n).toBe(0);
      expect(sonuc.j.mikroFaturaGonderimi).toBeNull();
      const satir = await belgeOku('orders', id);
      expect(satir && FATURA_GONDERIM_ALANI in satir, 'anahtar silinmeli (null yazılmaz)').toBe(false);
    } finally { mikro.belirtecHatasi = false; }
    const r2 = await mikroSay(() => kes(YONETICI, id));
    expect([r2.sonuc.s, r2.sonuc.j.success, r2.n]).toEqual([200, true, 1]);
  });

  it('T14 — kimlik bilgisi yok → 503 notConfigured, işaret yok, Mikro 0', async () => {
    const id = await siparisKur();
    const sakli = process.env.MIKRO_IDM_EMAIL;
    delete process.env.MIKRO_IDM_EMAIL;
    try {
      const { n, sonuc } = await mikroSay(() => kes(YONETICI, id));
      expect([sonuc.s, sonuc.j.notConfigured, sonuc.j.kod, n]).toEqual([503, true, 'FATURA_GONDERILMEDI', 0]);
      expect(await belgeOku('orders', id)).not.toHaveProperty(FATURA_GONDERIM_ALANI);
    } finally { process.env.MIKRO_IDM_EMAIL = sakli; }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('§ 2 — aynı siparişe iki eşzamanlı istek: Mikro\'ya TEK çağrı', () => {
  it('ikinci istek 409 FATURA_GONDERILIYOR; başarıdan sonra üçüncü istek 409 FATURA_GONDERILDI (numarayla), Mikro çağrısı yok', async () => {
    const id = await siparisKur();
    let birak: (r: Response) => void = () => {};
    sonraki(() => new Promise<Response>(c => { birak = c; }));
    const once = mikro.sayac;
    const a = kes(YONETICI, id);
    await bekle(() => mikro.sayac === once + 1, 30_000, 'A Mikro\'ya ulaştı');
    expect(await isaretOku(id)).toMatchObject({ durum: 'gonderiliyor' });
    const b = await kes(SATIS, id);
    expect([b.s, b.j.kod], b.metin).toEqual([409, 'FATURA_GONDERILIYOR']);
    expect(b.j.mikroFaturaGonderimi).toMatchObject({ durum: 'gonderiliyor' });
    expect(mikro.sayac).toBe(once + 1);
    const numara = yeniNumara();
    birak(mikroBasari({ faturaNo: numara, ettn: 'ettn-eszamanli' }));
    const ra = await a;
    expect([ra.s, ra.j.success, ra.j.mikroFaturaNo], ra.metin).toEqual([200, true, numara]);
    expect(ra.j.mikroFaturaGonderimi).toMatchObject({ durum: 'gonderildi', numara });
    const c = await mikroSay(() => kes(YONETICI, id));
    expect([c.sonuc.s, c.sonuc.j.kod, c.sonuc.j.numara, c.sonuc.j.ettn, c.n]).toEqual([409, 'FATURA_GONDERILDI', numara, 'ettn-eszamanli', 0]);
  });

  it('gerçekten AYNI ANDA atılan iki istek (biri ötekini beklemeden) → Mikro\'ya TEK çağrı; biri 200, öteki 409 FATURA_GONDERILIYOR', async () => {
    const id = await siparisKur();
    let birak: (r: Response) => void = () => {};
    sonraki(() => new Promise<Response>(c => { birak = c; }));
    const once = mikro.sayac;
    const ikisi = Promise.all([kes(YONETICI, id), kes(SATIS, id)]);
    await bekle(() => mikro.sayac === once + 1, 30_000, 'biri Mikro\'ya ulaştı');
    birak(mikroBasari({ faturaNo: yeniNumara() }));
    const [a, b] = await ikisi;
    expect(mikro.sayac - once).toBe(1);
    expect([a.s, b.s].sort()).toEqual([200, 409]);
    expect((a.s === 409 ? a : b).j.kod).toBe('FATURA_GONDERILIYOR');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('D1 — talep koşulu: siparişte Mikro faturası YOKSA', () => {
  it('T1 — işaretsiz + `mikroFaturaNo` dolu → 409 FATURA_GONDERILDI, `numara` aynı, Mikro 0', async () => {
    const id = await siparisKur({ mikroFaturaNo: 'CTP2026000000001' });
    const { n, sonuc } = await mikroSay(() => kes(YONETICI, id));
    expect([sonuc.s, sonuc.j.kod, sonuc.j.numara, n]).toEqual([409, 'FATURA_GONDERILDI', 'CTP2026000000001', 0]);
    expect(await belgeOku('orders', id)).not.toHaveProperty(FATURA_GONDERIM_ALANI);
  });

  it('T2 — işaretsiz + yalnız `ettn` dolu → 409 FATURA_GONDERILDI, yanıtta `ettn`, Mikro 0', async () => {
    const id = await siparisKur({ ettn: '8c1f7a54-2c4e-4b7b-9b1a-0d3f5e6a7b8c' });
    const { n, sonuc } = await mikroSay(() => kes(YONETICI, id));
    expect([sonuc.s, sonuc.j.kod, sonuc.j.ettn, n]).toEqual([409, 'FATURA_GONDERILDI', '8c1f7a54-2c4e-4b7b-9b1a-0d3f5e6a7b8c', 0]);
    expect(sonuc.j).not.toHaveProperty('numara');
  });

  it('T3 — `source: mikro-fatura` + numara → 400 FATURA_KESILEMEZ (neden mikro-fatura; öncelik numaradan önce); numarasız MF de 400', async () => {
    const id1 = await siparisKur({ source: 'mikro-fatura', mikroFaturaNo: 'MF-383' });
    const r1 = await mikroSay(() => kes(YONETICI, id1));
    expect([r1.sonuc.s, r1.sonuc.j.kod, r1.sonuc.j.neden, r1.n]).toEqual([400, 'FATURA_KESILEMEZ', 'mikro-fatura', 0]);
    const id2 = await siparisKur({ source: 'mikro-fatura' });
    const r2 = await mikroSay(() => kes(YONETICI, id2));
    expect([r2.sonuc.s, r2.sonuc.j.kod, r2.sonuc.j.neden, r2.n]).toEqual([400, 'FATURA_KESILEMEZ', 'mikro-fatura', 0]);
    expect(await belgeOku('orders', id2)).not.toHaveProperty(FATURA_GONDERIM_ALANI);
  });

  it('T4 — `source: MAGAZA_KAYNAGI` → 400 (neden magaza), Mikro 0', async () => {
    const id = await siparisKur({ source: MAGAZA_KAYNAGI });
    const { n, sonuc } = await mikroSay(() => kes(YONETICI, id));
    expect([sonuc.s, sonuc.j.kod, sonuc.j.neden, n]).toEqual([400, 'FATURA_KESILEMEZ', 'magaza', 0]);
  });

  it('T5 — `faturali: false` → 400 (neden faturasiz); `faturali` alanı YOK → talep geçer, Mikro 1', async () => {
    const id1 = await siparisKur({ faturali: false });
    const r1 = await mikroSay(() => kes(YONETICI, id1));
    expect([r1.sonuc.s, r1.sonuc.j.kod, r1.sonuc.j.neden, r1.n]).toEqual([400, 'FATURA_KESILEMEZ', 'faturasiz', 0]);
    const id2 = await siparisKur();
    expect(await belgeOku('orders', id2)).not.toHaveProperty('faturali');
    const r2 = await mikroSay(() => kes(YONETICI, id2));
    expect([r2.sonuc.s, r2.sonuc.j.success, r2.n]).toEqual([200, true, 1]);
  });

  it('T6 — `hasInvoice: true`, numara / ETTN yok → talep geçer, Mikro 1 (Cetpa-içi fatura kapıya girmez)', async () => {
    const id = await siparisKur({ hasInvoice: true });
    const { n, sonuc } = await mikroSay(() => kes(YONETICI, id));
    expect([sonuc.s, sonuc.j.success, n]).toEqual([200, true, 1]);
  });

  it('T7 — `mikroFaturaNo: \'   \'` → boş sayılır, talep geçer', async () => {
    const id = await siparisKur({ mikroFaturaNo: '   ' });
    const { n, sonuc } = await mikroSay(() => kes(YONETICI, id));
    expect([sonuc.s, sonuc.j.success, n]).toEqual([200, true, 1]);
  });

  it('T8 — işaret JSON `null` → talep geçer; işaret `reddedildi` → talep geçer, `istekNo` yenidir', async () => {
    const id1 = await siparisKur({ [FATURA_GONDERIM_ALANI]: null });
    const r1 = await mikroSay(() => kes(YONETICI, id1));
    expect([r1.sonuc.s, r1.sonuc.j.success, r1.n]).toEqual([200, true, 1]);
    const eski = isaretNesnesi('reddedildi');
    const id2 = await siparisKur({ [FATURA_GONDERIM_ALANI]: eski });
    const r2 = await mikroSay(() => kes(YONETICI, id2));
    expect([r2.sonuc.s, r2.sonuc.j.success, r2.n]).toEqual([200, true, 1]);
    const yeni = await isaretOku(id2);
    expect(yeni).toMatchObject({ durum: 'gonderildi' });
    expect(yeni?.istekNo).not.toBe(eski.istekNo);
  });

  it('T9 — olmayan `firebaseId` → 404, Mikro 0, `orders` satırı YARATILMAZ', async () => {
    const { n, sonuc } = await mikroSay(() => kes(YONETICI, 'boyle-bir-siparis-yok'));
    expect([sonuc.s, sonuc.j.error, n]).toEqual([404, 'Kayıt bulunamadı.', 0]);
    expect(await satirVar('orders', 'boyle-bir-siparis-yok')).toBe(false);
  });

  it('T10 — `firebaseId` yok / \'\' / \'  \' → 400, Mikro 0', async () => {
    for (const firebaseId of [undefined, '', '  ']) {
      const { n, sonuc } = await mikroSay(() => kes(YONETICI, firebaseId));
      expect([sonuc.s, sonuc.j.kod, n], String(firebaseId)).toEqual([400, 'FATURA_GONDERILMEDI', 0]);
    }
  });

  it('T36 (D15) — `companyId`\'siz sipariş → talep geçer, `companyId` damgalanır, Mikro 1; yabancı kiracı → 404, Mikro 0, damga basılmaz', async () => {
    const id1 = await siparisKur({ companyId: undefined });
    await belgeKoy('orders', id1, { customerName: 'Etiketsiz eski kayıt', totalPrice: 100 });
    // Damga TALEBİN kendisinde (D15 «her yazım companyId damgalar»): Mikro uçuştayken — sonraki geçiş yazılmadan — satır etiketli.
    // Talepten sonra süreç düşerse (geçiş hiç yazılmazsa) işaretli ama etiketsiz satır kalmasın.
    let birak: (r: Response) => void = () => {};
    sonraki(() => new Promise<Response>(c => { birak = c; }));
    const once = mikro.sayac;
    const a1 = kes(YONETICI, id1);
    await bekle(() => mikro.sayac === once + 1, 30_000, 'Mikro\'ya ulaştı');
    expect(await belgeOku('orders', id1)).toMatchObject({ companyId: KIRACI, [FATURA_GONDERIM_ALANI]: { durum: 'gonderiliyor' } });
    birak(mikroBasari({ faturaNo: yeniNumara() }));
    const r1 = { sonuc: await a1, n: mikro.sayac - once };
    expect([r1.sonuc.s, r1.sonuc.j.success, r1.n]).toEqual([200, true, 1]);
    expect(await belgeOku('orders', id1)).toMatchObject({ companyId: KIRACI, [FATURA_GONDERIM_ALANI]: { durum: 'gonderildi' } });
    const id2 = await siparisKur();
    const r2 = await mikroSay(() => kes(YABANCI, id2));
    expect([r2.sonuc.s, r2.n], r2.sonuc.metin).toEqual([404, 0]);
    expect(r2.sonuc.j).not.toHaveProperty('mikroFaturaGonderimi');   // varlık sızmaz
    expect(await belgeOku('orders', id2)).toEqual({ customerName: 'Şirin Yapı Malzemeleri', totalPrice: 15000, status: 'Processing', companyId: KIRACI });
  });

  it('Y2 — BOŞ DİZE ve JSON `null` `companyId` etiketsiz sayılır (`belgeSahipligi` / `companyId || \'\'` ile tutarlı): talep geçer, `companyId` damgalanır; `sonuc` da çözer; yabancı kiracı yine 404', async () => {
    for (const [ad, etiket] of [['boş dize', ''], ['JSON null', null]] as const) {
      const id = await siparisKur({ companyId: etiket });
      expect((await belgeOku('orders', id))?.companyId, ad).toBe(etiket);
      // Kendi kiracımızın talebi geçer ve satır KENDİ kiracımıza damgalanır (D15 etiketsiz eski kaydı onarma kalıbı).
      const { n, sonuc } = await mikroSay(() => kes(YONETICI, id));
      expect([sonuc.s, sonuc.j.success, n], `${ad}: ${sonuc.metin}`).toEqual([200, true, 1]);
      expect(await belgeOku('orders', id), ad).toMatchObject({ companyId: KIRACI, [FATURA_GONDERIM_ALANI]: { durum: 'gonderildi' } });
      // Damgalandıktan sonra yabancı kiracıya 404 (varlık sızmaz), Mikro 0.
      const y = await mikroSay(() => kes(YABANCI, id));
      expect([y.sonuc.s, y.n], ad).toEqual([404, 0]);
    }
    // `sonuc` aynı kiracı tanımını kullanır: boş dize etiketli belirsiz sipariş çözülür ve damgalanır.
    const c = await siparisKur({ companyId: '', [FATURA_GONDERIM_ALANI]: isaretNesnesi('belirsiz') });
    const r = await coz(YONETICI, c, 'mikrodaYok');
    expect([r.s, r.j.success], r.metin).toEqual([200, true]);
    expect(await belgeOku('orders', c)).toMatchObject({ companyId: KIRACI });
    // Yabancı kiracının etiketli siparişi yine 404, damga basılmaz.
    const yabanci = await siparisKur({ companyId: BASKA_KIRACI });
    const ry = await mikroSay(() => kes(YONETICI, yabanci));
    expect([ry.sonuc.s, ry.n]).toEqual([404, 0]);
    expect((await belgeOku('orders', yabanci))?.companyId).toBe(BASKA_KIRACI);
  });

  it('T34 (D13) — gövdede `istekNo: \'X\'` → yazılan `istekNo` ≠ \'X\', UUID biçiminde', async () => {
    const id = await siparisKur();
    let birak: (r: Response) => void = () => {};
    sonraki(() => new Promise<Response>(c => { birak = c; }));
    const once = mikro.sayac;
    const a = kes(YONETICI, id, { istekNo: 'X' });
    await bekle(() => mikro.sayac === once + 1, 30_000, 'Mikro\'ya ulaştı');
    const isaret = await isaretOku(id);
    expect(isaret?.istekNo).not.toBe('X');
    expect(String(isaret?.istekNo)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(isaret).toMatchObject({ durum: 'gonderiliyor', kim: eposta('ic-Admin') });
    birak(mikroBasari({ faturaNo: yeniNumara() }));
    expect((await a).s).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('D2 — Mikro yanıtının sınıflandırması', () => {
  it('T18 — stub `{ Method: \'FaturaKaydetV2\' }` → `belirsiz` VE Mikro\'ya TEK çağrı (stub tekrarı bu çağrıda kapalı)', async () => {
    const id = await siparisKur();
    sonraki(() => json({ Method: 'FaturaKaydetV2' }));
    sonraki(() => mikroBasari({ faturaNo: 'IKINCI-GONDERIM' }));   // tekrar açıksa ikinci gövde buraya düşerdi
    const { n, sonuc } = await mikroSay(() => kes(YONETICI, id));
    expect([sonuc.s, sonuc.j.kod, n], sonuc.metin).toEqual([502, 'FATURA_SONUCU_BILINMIYOR', 1]);
    expect(await isaretOku(id)).toMatchObject({ durum: 'belirsiz' });
    mikro.sira.length = 0;
  });

  it('T15 — Mikro 200 + `IsError: true` → `reddedildi`, yanıt FATURA_REDDEDILDI (Mikro iletisiyle); yeniden gönderim Mikro\'ya gider', async () => {
    const id = await siparisKur();
    sonraki(() => json({ result: [{ IsError: true, ErrorMessage: 'X' }] }));
    const r1 = await mikroSay(() => kes(YONETICI, id));
    expect([r1.sonuc.s, r1.sonuc.j.success, r1.sonuc.j.kod, r1.sonuc.j.error, r1.n]).toEqual([200, false, 'FATURA_REDDEDILDI', 'X', 1]);
    expect(await isaretOku(id)).toMatchObject({ durum: 'reddedildi' });
    expect(r1.sonuc.j.mikroFaturaGonderimi).toMatchObject({ durum: 'reddedildi' });
    const r2 = await mikroSay(() => kes(YONETICI, id));
    expect([r2.sonuc.s, r2.sonuc.j.success, r2.n]).toEqual([200, true, 1]);
  });

  it('T16 — Mikro HTTP 502 + HTML gövde → `belirsiz`, 502 FATURA_SONUCU_BILINMIYOR; sonraki istek 409 FATURA_SONUCU_BILINMIYOR, Mikro 0', async () => {
    const id = await siparisKur();
    sonraki(() => new Response('<html><body>502 Bad Gateway (ARR)</body></html>', { status: 502, headers: { 'content-type': 'text/html' } }));
    const r1 = await mikroSay(() => kes(YONETICI, id));
    expect([r1.sonuc.s, r1.sonuc.j.kod, r1.n]).toEqual([502, 'FATURA_SONUCU_BILINMIYOR', 1]);
    expect(await isaretOku(id)).toMatchObject({ durum: 'belirsiz' });
    const r2 = await mikroSay(() => kes(SATIS, id));
    expect([r2.sonuc.s, r2.sonuc.j.kod, r2.n]).toEqual([409, 'FATURA_SONUCU_BILINMIYOR', 0]);
  });

  it('T17 — Mikro HTTP 400 ve HTTP 500 (JSON gövde, IsError dâhil) → `belirsiz` (ret DEĞİL)', async () => {
    for (const durum of [400, 500]) {
      const id = await siparisKur();
      sonraki(() => json({ result: [{ IsError: true, ErrorMessage: 'sunucu hatası' }] }, durum));
      const { sonuc } = await mikroSay(() => kes(YONETICI, id));
      expect([sonuc.s, sonuc.j.kod], String(durum)).toEqual([502, 'FATURA_SONUCU_BILINMIYOR']);
      expect(await isaretOku(id)).toMatchObject({ durum: 'belirsiz' });
    }
  });

  it('T19 — `result: []` → `belirsiz`', async () => {
    const id = await siparisKur();
    sonraki(() => json({ result: [] }));
    const { sonuc } = await mikroSay(() => kes(YONETICI, id));
    expect([sonuc.s, sonuc.j.kod]).toEqual([502, 'FATURA_SONUCU_BILINMIYOR']);
    expect(await isaretOku(id)).toMatchObject({ durum: 'belirsiz' });
  });

  it('T20 — fetch `TimeoutError` → `belirsiz`, yanıt 504; öteki ağ istisnası → `belirsiz`, 502', async () => {
    const id1 = await siparisKur();
    sonraki(() => { throw new DOMException('The operation was aborted due to timeout', 'TimeoutError'); });
    const r1 = await kes(YONETICI, id1);
    expect([r1.s, r1.j.kod], r1.metin).toEqual([504, 'FATURA_SONUCU_BILINMIYOR']);
    expect(await isaretOku(id1)).toMatchObject({ durum: 'belirsiz' });
    const id2 = await siparisKur();
    sonraki(() => { throw new TypeError('fetch failed'); });
    const r2 = await kes(YONETICI, id2);
    expect([r2.s, r2.j.kod]).toEqual([502, 'FATURA_SONUCU_BILINMIYOR']);
    expect(await isaretOku(id2)).toMatchObject({ durum: 'belirsiz' });
  });

  it('T21 / T35 — başarı, numara anahtarı yok → `gonderildi`, `mikroFaturaNo` yazılmaz; sonraki istek 409 FATURA_GONDERILDI, `numara` alanı YOK', async () => {
    const id = await siparisKur();
    sonraki(() => mikroBasari({ sira: 7 }));
    const r1 = await mikroSay(() => kes(YONETICI, id));
    expect([r1.sonuc.s, r1.sonuc.j.success, r1.n]).toEqual([200, true, 1]);
    const satir = await belgeOku('orders', id);
    expect(satir).not.toHaveProperty('mikroFaturaNo');
    expect(satir).toMatchObject({ hasInvoice: true, [FATURA_GONDERIM_ALANI]: { durum: 'gonderildi' } });
    expect(satir?.[FATURA_GONDERIM_ALANI]).not.toHaveProperty('numara');
    const r2 = await mikroSay(() => kes(YONETICI, id));
    expect([r2.sonuc.s, r2.sonuc.j.kod, r2.n]).toEqual([409, 'FATURA_GONDERILDI', 0]);
    expect(r2.sonuc.j).not.toHaveProperty('numara');
    // T35 — numara VARSA 409 onu taşır (işaretteki numara; sipariş numarası silinmiş olsa da).
    const id2 = await siparisKur({ [FATURA_GONDERIM_ALANI]: isaretNesnesi('gonderildi', Date.now(), { numara: 'CTP2026000000999' }) });
    const r3 = await mikroSay(() => kes(YONETICI, id2));
    expect([r3.sonuc.s, r3.sonuc.j.kod, r3.sonuc.j.numara, r3.n]).toEqual([409, 'FATURA_GONDERILDI', 'CTP2026000000999', 0]);
  });

  it('başarı gövdesi Mikro\'ya AYNEN gider (gövde değişmedi): evrak zarfı + V17 bağlamı', async () => {
    const id = await siparisKur();
    const once = mikro.govdeler.length;
    await kes(YONETICI, id);
    const govde = JSON.parse(mikro.govdeler[once]) as { Mikro: { evraklar: Array<{ cha_kod: string; detay: Array<{ sth_stok_kod: string; sth_tutar: number; sth_vergi: number }> }> } };
    expect(govde.Mikro.evraklar).toHaveLength(1);
    expect(govde.Mikro.evraklar[0].cha_kod).toBe('120.01.0042');
    expect(govde.Mikro.evraklar[0].detay[0]).toMatchObject({ sth_stok_kod: 'CIM-50', sth_tutar: 12500, sth_vergi: 2500 });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('D4 — talepten sonraki yazımlar atomik', () => {
  it('T26 — Mikro yanıtı ile başarı yazımı arasında başka alana PATCH → `mikroFaturaNo` VE işaret (`gonderildi`) kalır, PATCH\'in alanı da', async () => {
    const id = await siparisKur();
    const numara = yeniNumara();
    sonraki(async () => {
      const p = await istek('PATCH', `/api/db/orders/${id}`, SATIS, { notes: 'kargo öğleden sonra' });
      expect(p.s, p.metin).toBe(200);
      return mikroBasari({ faturaNo: numara });
    });
    const r = await kes(YONETICI, id);
    expect([r.s, r.j.success, r.j.localUpdateFailed]).toEqual([200, true, false]);
    expect(await belgeOku('orders', id)).toMatchObject({ notes: 'kargo öğleden sonra', mikroFaturaNo: numara, [FATURA_GONDERIM_ALANI]: { durum: 'gonderildi', numara } });

    // Asıl pencere: PATCH Mikro YANITINDAN SONRA, başarı yazımı bitmeden girer. Oku-değiştir-yaz (pgShim set-merge) kalıbında
    // okumanın hemen ARDINDAN, tek SQL'de yazım ifadesi koşmadan hemen ÖNCE — hangisi önce gelirse (M18 bu kolda kırmızı:
    // set-merge okuduğu eski satırı yazar ve araya giren PATCH'in alanını siler).
    const id2 = await siparisKur();
    const numara2 = yeniNumara();
    let yanitVerildi = false;
    let araya: Promise<Yanit> | undefined;
    const arayaGir = async (): Promise<void> => {
      if (!yanitVerildi || araya) return;
      araya = istek('PATCH', `/api/db/orders/${id2}`, SATIS, { notes: 'yanıttan sonra' });
      const p = await araya;
      expect(p.s, p.metin).toBe(200);
    };
    G.__faturaPgKanca = async (sql: string, p: unknown[] | undefined) => {
      if (sql === 'SELECT data FROM docs WHERE coll = $1 AND id = $2' && p?.[0] === 'orders' && p?.[1] === id2) await arayaGir();
    };
    G.__faturaPgOnKanca = async (sql: string, p: unknown[] | undefined) => {
      if (/^UPDATE docs SET data = /.test(sql) && p?.[0] === id2) await arayaGir();
    };
    try {
      sonraki(() => { yanitVerildi = true; return mikroBasari({ faturaNo: numara2 }); });
      const r2 = await kes(YONETICI, id2);
      expect(araya, 'PATCH yanıt ile başarı yazımı arasına girdi').toBeDefined();
      expect([r2.s, r2.j.success, r2.j.localUpdateFailed]).toEqual([200, true, false]);
      expect(await belgeOku('orders', id2)).toMatchObject({ notes: 'yanıttan sonra', mikroFaturaNo: numara2, [FATURA_GONDERIM_ALANI]: { durum: 'gonderildi', numara: numara2 } });
    } finally { G.__faturaPgKanca = undefined; G.__faturaPgOnKanca = undefined; }
  });

  it('T27 — sipariş uçuşta silinir → başarı yazımı satır YARATMAZ; yanıt `success: true, localUpdateFailed: true`; syncLog\'da numaralı `gec_yanit`', async () => {
    const id = await siparisKur();
    const numara = yeniNumara();
    sonraki(async () => {
      await pg().query("DELETE FROM docs WHERE coll = 'orders' AND id = $1", [id]);
      return mikroBasari({ faturaNo: numara, ettn: 'ettn-gec' });
    });
    const r = await kes(YONETICI, id);
    expect([r.s, r.j.success, r.j.localUpdateFailed, r.j.mikroFaturaNo]).toEqual([200, true, true, numara]);
    expect(await satirVar('orders', id)).toBe(false);
    const gunluk = await syncLogSatirlari('gec_yanit', id);
    expect(gunluk).toHaveLength(1);
    expect(gunluk[0]).toMatchObject({ mikroRef: numara, ayrinti: { yontem: 'FaturaKaydetV2', durum: 'gonderildi', numara, ettn: 'ettn-gec' } });
  });

  for (const tur of ['ret', 'belirsiz', 'basari'] as const) {
    it(`T28 — A uçuşta; işaret bayatlayıp «Mikro'da yok» ile silinir, B talep eder → A'nın ${tur} yazımı B'yi EZMEZ (0 satır + günlük)`, async () => {
      const id = await siparisKur();
      let birakB: (r: Response) => void = () => {};
      let bYaniti: Promise<Yanit> | undefined;
      sonraki(async () => {
        // A Mikro'da: işareti bayatlat → çöz («Mikro'da yok») → B talep etsin (B Mikro'da askıda kalır).
        const d = await belgeOku('orders', id);
        const isaret = d?.[FATURA_GONDERIM_ALANI] as Record<string, unknown>;
        await isaretKoy(id, { ...isaret, zaman: new Date(Date.now() - FATURA_GONDERIM_BAYATLIK_MS - 5_000).toISOString() });
        const c = await coz(YONETICI, id, 'mikrodaYok');
        expect(c.s, c.metin).toBe(200);
        const once = mikro.sayac;
        sonraki(() => new Promise<Response>(cz => { birakB = cz; }));
        bYaniti = kes(SATIS, id);
        await bekle(() => mikro.sayac === once + 1, 30_000, 'B Mikro\'ya ulaştı');
        if (tur === 'ret') return json({ result: [{ IsError: true, ErrorMessage: 'geç ret' }] });
        if (tur === 'belirsiz') return json({ Method: 'FaturaKaydetV2' });
        return mikroBasari({ faturaNo: 'A-GEC-NUMARA' });
      });
      const a = await kes(YONETICI, id);
      expect(a.s, a.metin).toBe(tur === 'ret' ? 200 : tur === 'belirsiz' ? 502 : 200);
      const bIsareti = await isaretOku(id);
      expect(bIsareti).toMatchObject({ durum: 'gonderiliyor', kim: eposta('ic-Sales') });
      expect(await belgeOku('orders', id)).not.toHaveProperty('mikroFaturaNo');
      const gunluk = await syncLogSatirlari('gec_yanit', id);
      expect(gunluk.map(g => (g.ayrinti as Record<string, unknown>).durum)).toEqual([tur === 'ret' ? 'reddedildi' : tur === 'belirsiz' ? 'belirsiz' : 'gonderildi']);
      if (tur === 'basari') expect(a.j.localUpdateFailed).toBe(true);
      birakB(mikroBasari({ faturaNo: yeniNumara() }));
      if (!bYaniti) throw new Error('B gönderilmedi');
      expect((await bYaniti).s).toBe(200);
      expect(await isaretOku(id)).toMatchObject({ durum: 'gonderildi', istekNo: bIsareti?.istekNo });
    });
  }

  for (const tur of ['ret', 'belirsiz', 'basari'] as const) {
    it(`İ1-2 — A uçuşta; işaret bayatlar, «Mikro'da var» ile \`gonderildi\` olur (istekNo AYNI) → A'nın geç ${tur} yanıtı ${tur === 'basari' ? 'numarayı EKLER' : '\`gonderildi\`yi EZMEZ (0 satır + `gec_yanit`)'}; yeni kaydet 409, Mikro 0`, async () => {
      const id = await siparisKur();
      sonraki(async () => {
        const d = await belgeOku('orders', id);
        const isaret = d?.[FATURA_GONDERIM_ALANI] as Record<string, unknown>;
        await isaretKoy(id, { ...isaret, zaman: new Date(Date.now() - FATURA_GONDERIM_BAYATLIK_MS - 5_000).toISOString() });
        const c = await coz(SATIS, id, 'mikrodaVar');
        expect(c.s, c.metin).toBe(200);
        expect(await isaretOku(id)).toMatchObject({ durum: 'gonderildi', istekNo: isaret.istekNo });
        if (tur === 'ret') return json({ result: [{ IsError: true, ErrorMessage: 'geç ret' }] });
        if (tur === 'belirsiz') return json({ Method: 'FaturaKaydetV2' });
        return mikroBasari({ faturaNo: 'A-GEC-BASARI', ettn: 'ettn-a-gec' });
      });
      const a = await kes(YONETICI, id);
      expect(a.s, a.metin).toBe(tur === 'belirsiz' ? 502 : 200);
      const satir = await belgeOku('orders', id);
      if (tur === 'basari') {
        // Başarı `gonderildi` üstüne yazılır: Mikro'nun numarası ve ETTN'si eklenir, işaret yine `gonderildi`.
        expect(satir).toMatchObject({ mikroFaturaNo: 'A-GEC-BASARI', ettn: 'ettn-a-gec', [FATURA_GONDERIM_ALANI]: { durum: 'gonderildi', numara: 'A-GEC-BASARI' } });
        expect([a.j.success, a.j.localUpdateFailed]).toEqual([true, false]);
        expect(await syncLogSatirlari('gec_yanit', id)).toEqual([]);
      } else {
        expect(satir?.[FATURA_GONDERIM_ALANI]).toMatchObject({ durum: 'gonderildi' });
        expect(satir).toMatchObject({ hasInvoice: true, mikroSynced: true });
        const gunluk = await syncLogSatirlari('gec_yanit', id);
        expect(gunluk.map(g => (g.ayrinti as Record<string, unknown>).durum)).toEqual([tur === 'ret' ? 'reddedildi' : 'belirsiz']);
        // D8: geç yanıt istemciye talebin bayat `gonderiliyor`unu değil, GÜNCEL işareti taşır (yerelde çözümü ezmesin).
        expect(a.j.mikroFaturaGonderimi).toMatchObject({ durum: 'gonderildi' });
      }
      const yeni = await mikroSay(() => kes(SATIS, id));
      expect([yeni.sonuc.s, yeni.sonuc.j.kod, yeni.n]).toEqual([409, 'FATURA_GONDERILDI', 0]);
    });
  }

  it('İ1-2 (geri alma) — belirteç alınırken işaret bayatlayıp «Mikro\'da var» ile çözülürse gönderim-öncesi hata `gonderildi`yi SİLMEZ; yanıt güncel işareti taşır; yeni kaydet 409', async () => {
    const id = await siparisKur();
    const { mikroTokenCacheMap } = await import('./mikroClient');
    mikroTokenCacheMap.clear();
    mikro.belirtecHatasi = true;
    let cozuldu = false;
    mikro.belirtecKancasi = async () => {
      const isaret = await isaretOku(id);
      if (!isaret) throw new Error('belirteç isteği talepten ÖNCE geldi — sınama düzeneği yanlış');
      await isaretKoy(id, { ...isaret, zaman: new Date(Date.now() - FATURA_GONDERIM_BAYATLIK_MS - 5_000).toISOString() });
      const c = await coz(YONETICI, id, 'mikrodaVar', 'ELLE-777');
      expect(c.s, c.metin).toBe(200);
      cozuldu = true;
    };
    try {
      const { n, sonuc } = await mikroSay(() => kes(YONETICI, id));
      expect(cozuldu, 'çözüm belirteç isteği sırasında koştu').toBe(true);
      expect([sonuc.s, sonuc.j.kod, n], sonuc.metin).toEqual([502, 'FATURA_GONDERILMEDI', 0]);
      expect(sonuc.j.mikroFaturaGonderimi).toMatchObject({ durum: 'gonderildi', numara: 'ELLE-777' });
      expect(await belgeOku('orders', id)).toMatchObject({ mikroFaturaNo: 'ELLE-777', [FATURA_GONDERIM_ALANI]: { durum: 'gonderildi', numara: 'ELLE-777' } });
    } finally { mikro.belirtecHatasi = false; mikro.belirtecKancasi = undefined; }
    const yeni = await mikroSay(() => kes(SATIS, id));
    expect([yeni.sonuc.s, yeni.sonuc.j.kod, yeni.sonuc.j.numara, yeni.n]).toEqual([409, 'FATURA_GONDERILDI', 'ELLE-777', 0]);
  });

  it('T29 — her geçişte `broadcastDocChange` RETURNING verisiyle BİR kez çağrılır (talep + sonuç)', async () => {
    const { dbEvents } = await import('./pgShim');
    const id = await siparisKur();
    const olaylar: Array<{ type: string; data?: Record<string, unknown> }> = [];
    const dinle = (e: { coll: string; id: string; type: string; data?: Record<string, unknown> }): void => { if (e.coll === 'orders' && e.id === id) olaylar.push(e); };
    dbEvents.on('change', dinle);
    try {
      let birak: (r: Response) => void = () => {};
      sonraki(() => new Promise<Response>(c => { birak = c; }));
      const once = mikro.sayac;
      const a = kes(YONETICI, id);
      await bekle(() => mikro.sayac === once + 1, 30_000, 'Mikro\'ya ulaştı');
      expect(olaylar).toHaveLength(1);
      expect(olaylar[0].data?.[FATURA_GONDERIM_ALANI]).toMatchObject({ durum: 'gonderiliyor' });
      expect(olaylar[0].data).toMatchObject({ customerName: 'Şirin Yapı Malzemeleri', companyId: KIRACI });
      birak(mikroBasari({ faturaNo: yeniNumara() }));
      await a;
      expect(olaylar).toHaveLength(2);
      expect(olaylar[1].data).toEqual(await belgeOku('orders', id));
    } finally { dbEvents.off('change', dinle); }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('D5 — bayat `gonderiliyor`', () => {
  it('T30 — `zaman = şimdi − (eşik + 1 sn)` → kaydet 409 FATURA_SONUCU_BILINMIYOR, Mikro 0, `sonuc` kabul eder; `şimdi − (eşik − 1 sn)` → 409 FATURA_GONDERILIYOR, `sonuc` 409 FATURA_GONDERILIYOR', async () => {
    const id1 = await siparisKur({ [FATURA_GONDERIM_ALANI]: isaretNesnesi('gonderiliyor', Date.now() - FATURA_GONDERIM_BAYATLIK_MS - 1_000) });
    const r1 = await mikroSay(() => kes(YONETICI, id1));
    expect([r1.sonuc.s, r1.sonuc.j.kod, r1.n]).toEqual([409, 'FATURA_SONUCU_BILINMIYOR', 0]);
    expect((await coz(YONETICI, id1, 'mikrodaVar')).s).toBe(200);
    const id2 = await siparisKur({ [FATURA_GONDERIM_ALANI]: isaretNesnesi('gonderiliyor', Date.now() - FATURA_GONDERIM_BAYATLIK_MS + 1_000) });
    const r2 = await mikroSay(() => kes(YONETICI, id2));
    expect([r2.sonuc.s, r2.sonuc.j.kod, r2.n]).toEqual([409, 'FATURA_GONDERILIYOR', 0]);
    const c2 = await coz(YONETICI, id2, 'mikrodaYok');
    expect([c2.s, c2.j.kod]).toEqual([409, 'FATURA_GONDERILIYOR']);
    expect(await isaretOku(id2)).toMatchObject({ durum: 'gonderiliyor' });
  });

  it('T31 — bütçe: eşik > işaretten sonraki ağ çağrılarının zaman aşımı toplamı (belirteç + FaturaKaydetV2; global zaman aşımı; stub tekrarı kapalı)', () => {
    const sunucuKodu = kodSatirlari(join(SRC_KOK, '..', 'server.ts')).map(s => s.kod).join('\n');
    const m = /return _rawFetch\(input, \{ \.\.\.init, signal: AbortSignal\.timeout\((\d+)\) \}\);/.exec(sunucuKodu);
    if (!m) throw new Error('global fetch zaman aşımı yaması bulunamadı');
    const globalZamanAsimi = Number(m[1]);
    const rota = kodSatirlari(join(SRC_KOK, 'server', 'routes', 'mikroRoutes.ts')).map(s => s.kod).join('\n');
    // FaturaKaydetV2 çağrısı kendi zaman aşımını VERMİYOR ve stub tekrarını KAPATIYOR — verilirse bu bütçe ona göre güncellenir.
    // Stub tekrarı ortak sabitle kapalı (şartname yeniden-deneme v3 K0a: `MIKRO_YAZIM_SECENEGI` = `{ stubYenidenDeneme: false }`).
    expect(rota).toContain("yanit = await mikroPost('FaturaKaydetV2', { evraklar: [evrak] }, true, MIKRO_YAZIM_SECENEGI);");
    const istemci = kodSatirlari(join(SRC_KOK, 'server', 'mikroClient.ts')).map(s => s.kod).join('\n');
    const belirtec = istemci.slice(istemci.indexOf('export async function getMikroToken('), istemci.indexOf('function buildMikroDailySifre('));
    expect(belirtec).not.toMatch(/signal:/);   // belirteç çağrısı global zaman aşımında
    const butce = globalZamanAsimi /* belirteç */ + globalZamanAsimi /* FaturaKaydetV2 */;
    expect(FATURA_GONDERIM_BAYATLIK_MS).toBeGreaterThan(butce);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('D6 — `POST /api/mikro/fatura/sonuc`: belirsiz kaydı çözme (kapı = kesim kapısı)', () => {
  it('T32 — dış rol 403; MFA doğrulanmamış oturum reddedilir; yabancı kiracı 404; olmayan sipariş 404', async () => {
    const id = await siparisKur({ [FATURA_GONDERIM_ALANI]: isaretNesnesi('belirsiz') });
    for (const b of [BAYI, B2B]) expect((await coz(b, id, 'mikrodaYok')).s).toBe(403);
    const m = await coz(MFA_ACIK, id, 'mikrodaYok');
    expect([m.s, m.j.mfaRequired]).toEqual([403, true]);
    const y = await coz(YABANCI, id, 'mikrodaYok');
    expect([y.s, y.j.error]).toEqual([404, 'Kayıt bulunamadı.']);
    expect((await coz(YONETICI, 'boyle-bir-siparis-yok', 'mikrodaYok')).s).toBe(404);
    expect(await satirVar('orders', 'boyle-bir-siparis-yok')).toBe(false);
    expect(await isaretOku(id)).toMatchObject({ durum: 'belirsiz' });   // hiçbiri dokunmadı
  });

  it('T32 — `gonderildi` 409; taze `gonderiliyor` 409 FATURA_GONDERILIYOR; işaretsiz ve `reddedildi` 409 FATURA_SONUC_YOK', async () => {
    const g = await siparisKur({ [FATURA_GONDERIM_ALANI]: isaretNesnesi('gonderildi', Date.now(), { numara: 'N-1' }) });
    const rg = await coz(YONETICI, g, 'mikrodaYok');
    expect([rg.s, rg.j.kod, rg.j.numara]).toEqual([409, 'FATURA_GONDERILDI', 'N-1']);
    const t = await siparisKur({ [FATURA_GONDERIM_ALANI]: isaretNesnesi('gonderiliyor') });
    expect((await coz(YONETICI, t, 'mikrodaYok')).j.kod).toBe('FATURA_GONDERILIYOR');
    const yok = await siparisKur();
    const ry = await coz(YONETICI, yok, 'mikrodaVar');
    expect([ry.s, ry.j.kod]).toEqual([409, 'FATURA_SONUC_YOK']);
    const red = await siparisKur({ [FATURA_GONDERIM_ALANI]: isaretNesnesi('reddedildi') });
    expect((await coz(YONETICI, red, 'mikrodaYok')).j.kod).toBe('FATURA_SONUC_YOK');
  });

  it('T32 — `belirsiz` + mikrodaVar + numara → `gonderildi` + `mikroFaturaNo`; numarasız → numarasız `gonderildi`; denetim kaydı var', async () => {
    const id1 = await siparisKur({ [FATURA_GONDERIM_ALANI]: isaretNesnesi('belirsiz') });
    const r1 = await coz(SATIS, id1, 'mikrodaVar', '  CTP2026000000777  ');
    expect([r1.s, r1.j.success], r1.metin).toEqual([200, true]);
    expect(await belgeOku('orders', id1)).toMatchObject({ mikroFaturaNo: 'CTP2026000000777', [FATURA_GONDERIM_ALANI]: { durum: 'gonderildi', numara: 'CTP2026000000777', kim: 'tohum@example.test' } });
    expect(r1.j.mikroFaturaGonderimi).toMatchObject({ durum: 'gonderildi', numara: 'CTP2026000000777' });
    // İ1-4: kaydet başarısıyla AYNI fatura alanları (`hasInvoice`, `mikroSynced`); kesim zamanı / ETTN bilinmiyor → uydurulmaz.
    const s1 = await belgeOku('orders', id1);
    expect(s1).toMatchObject({ hasInvoice: true, mikroSynced: true });
    for (const alan of ['mikroFaturaDate', 'ettn', 'mikroSyncedAt']) expect(s1, alan).not.toHaveProperty(alan);
    const id2 = await siparisKur({ [FATURA_GONDERIM_ALANI]: isaretNesnesi('belirsiz') });
    expect((await coz(YONETICI, id2, 'mikrodaVar')).s).toBe(200);
    const s2 = await belgeOku('orders', id2);
    expect(s2).toMatchObject({ hasInvoice: true, mikroSynced: true });
    expect(s2).not.toHaveProperty('mikroFaturaDate');
    expect(s2).not.toHaveProperty('mikroFaturaNo');
    expect(s2?.[FATURA_GONDERIM_ALANI]).toMatchObject({ durum: 'gonderildi' });
    expect(s2?.[FATURA_GONDERIM_ALANI]).not.toHaveProperty('numara');
    expect((await kes(YONETICI, id2)).j.kod).toBe('FATURA_GONDERILDI');
    const sync = await syncLogSatirlari('FaturaSonucCozumu', id1);
    expect(sync).toHaveLength(1);
    expect(sync[0]).toMatchObject({ success: true, mikroRef: 'CTP2026000000777', userEmail: eposta('ic-Sales'), ayrinti: { karar: 'mikrodaVar' } });
    const denetim = await pg().query("SELECT data FROM docs WHERE coll = 'auditLog' AND data->>'action' = 'FaturaSonucCozumu' AND data->>'details' LIKE $1", [`%${id1}%`]);
    expect(denetim.rows.length).toBe(1);
  });

  it('T32 — mikrodaYok → anahtar YOK (null değil), sonraki kaydet Mikro\'ya gider; iki eşzamanlı `sonuc` → biri 200, öteki 409', async () => {
    const id = await siparisKur({ [FATURA_GONDERIM_ALANI]: isaretNesnesi('belirsiz') });
    const [a, b] = await Promise.all([coz(YONETICI, id, 'mikrodaYok'), coz(SATIS, id, 'mikrodaVar', 'N-yaris')]);
    expect([a.s, b.s].sort()).toEqual([200, 409]);
    const kazanan = a.s === 200 ? 'mikrodaYok' : 'mikrodaVar';
    if (kazanan === 'mikrodaVar') {
      expect(await isaretOku(id)).toMatchObject({ durum: 'gonderildi' });
      return;
    }
    expect(b.j.kod).toBe('FATURA_SONUC_YOK');
    const satir = await belgeOku('orders', id);
    expect(satir && FATURA_GONDERIM_ALANI in satir).toBe(false);
    const { n, sonuc } = await mikroSay(() => kes(YONETICI, id));
    expect([sonuc.s, sonuc.j.success, n]).toEqual([200, true, 1]);
  });

  it('T32 — mikrodaYok tek başına: anahtar silinir, sonraki kaydet Mikro\'ya gider', async () => {
    const id = await siparisKur({ [FATURA_GONDERIM_ALANI]: isaretNesnesi('belirsiz') });
    const r = await coz(YONETICI, id, 'mikrodaYok');
    expect([r.s, r.j.mikroFaturaGonderimi]).toEqual([200, null]);
    const satir = await belgeOku('orders', id);
    expect(satir && FATURA_GONDERIM_ALANI in satir).toBe(false);
    const { n } = await mikroSay(() => kes(YONETICI, id));
    expect(n).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('D3 — istemci `/api/db` ile işareti yazamaz (rolden bağımsız, sessiz)', () => {
  for (const [ad, b, kisa] of [['Satış', SATIS, 'satis'], ['Yönetici', YONETICI, 'yonetici']] as const) {
    it(`T23 — ${ad}: POST / PUT / PUT?merge=1 / PATCH (üç biçim, tünel dâhil) / cas işareti değiştiremez; increment 400; satırsız upsert işaret yazmaz; öteki alanlar yazılır`, async () => {
      const tohum = isaretNesnesi('gonderiliyor');
      const id = await siparisKur({ [FATURA_GONDERIM_ALANI]: tohum, notes: 'ilk' });
      const korundu = async (adim: string): Promise<void> => expect(await isaretOku(id), adim).toEqual(tohum);
      // POST: yeni kayıtta işaret YOK.
      const p = await istek('POST', '/api/db/orders', b, { customerName: 'Yeni', [FATURA_GONDERIM_ALANI]: isaretNesnesi('gonderildi') });
      expect(p.s, p.metin).toBe(200);
      const yeniId = String(p.j.id);
      expect(await belgeOku('orders', yeniId)).toMatchObject({ customerName: 'Yeni' });
      expect(await belgeOku('orders', yeniId)).not.toHaveProperty(FATURA_GONDERIM_ALANI);
      // PUT işaretsiz BAYAT gövde (ekrandaki eski kopya) → işaret aynen.
      const bayat = { customerName: 'Şirin Yapı Malzemeleri', totalPrice: 15000, status: 'Processing', notes: 'put' };
      const put = await istek('PUT', `/api/db/orders/${id}`, b, bayat);
      expect(put.s, put.metin).toBe(200);
      await korundu('PUT');
      expect((await belgeOku('orders', id))?.notes).toBe('put');
      // Yanıt (ve yayın) yazılan GERÇEK satırı taşır: gövdede olmayan işaret istemcinin canlı listesinden silinmez.
      expect((put.j.data as Record<string, unknown>)[FATURA_GONDERIM_ALANI], 'PUT yanıtı').toEqual(tohum);
      const putMerge = await istek('PUT', `/api/db/orders/${id}?merge=1`, b, { [FATURA_GONDERIM_ALANI]: null, notes: 'merge' });
      expect(putMerge.s, putMerge.metin).toBe(200);
      await korundu('PUT?merge=1');
      expect((putMerge.j.data as Record<string, unknown>)[FATURA_GONDERIM_ALANI], 'PUT?merge=1 yanıtı').toEqual(tohum);
      for (const [i, yama] of ([
        { [FATURA_GONDERIM_ALANI]: null },
        { [FATURA_GONDERIM_ALANI]: { durum: 'reddedildi' } },
        { [`${FATURA_GONDERIM_ALANI}.durum`]: 'reddedildi' },
      ] as Array<Record<string, unknown>>).entries()) {
        const r = await istek('PATCH', `/api/db/orders/${id}`, b, { ...yama, notes: `patch-${i}` });
        expect(r.s, r.metin).toBe(200);
        await korundu(`PATCH ${JSON.stringify(yama)}`);
        expect((await belgeOku('orders', id))?.notes).toBe(`patch-${i}`);
        // Yanıt (ve yayın) yazılan GERÇEK satırı taşır: işaret yanıtta da durur.
        expect((r.j.data as Record<string, unknown>)[FATURA_GONDERIM_ALANI]).toEqual(tohum);
        const t = await istek('POST', `/api/db/orders/${id}`, { ...b, 'X-Cetpa-Method': 'PATCH' }, { ...yama, notes: `tunel-${i}` });
        expect(t.s, t.metin).toBe(200);
        await korundu(`tünel PATCH ${JSON.stringify(yama)}`);
        expect((await belgeOku('orders', id))?.notes).toBe(`tunel-${i}`);
      }
      const c = await istek('PATCH', `/api/db/orders/${id}/cas`, b, { field: 'status', expect: 'Processing', set: { [FATURA_GONDERIM_ALANI]: null, notes: 'cas' } });
      expect([c.s, c.j.claimed], c.metin).toEqual([200, true]);
      await korundu('cas');
      expect((await belgeOku('orders', id))?.notes).toBe('cas');
      const inc = await istek('PATCH', `/api/db/orders/${id}/increment`, b, { field: FATURA_GONDERIM_ALANI, delta: 1 });
      expect([inc.s, inc.j.error]).toEqual([400, 'Bu alan artırılamaz.']);
      await korundu('increment');
      const yokId = `upsert-${kisa}-${Date.now()}`;   // kimlik ASCII (URL yolu)
      expect((await istek('PUT', `/api/db/orders/${yokId}`, b, { customerName: 'Upsert', [FATURA_GONDERIM_ALANI]: isaretNesnesi('reddedildi') })).s).toBe(200);
      expect(await belgeOku('orders', yokId)).toMatchObject({ customerName: 'Upsert' });
      expect(await belgeOku('orders', yokId)).not.toHaveProperty(FATURA_GONDERIM_ALANI);
    });
  }

  it('T24 — PGlite yarışı: PATCH\'in SELECT\'i talepten ÖNCE, yazımı SONRA koşar → işaret korunur; ikinci kaydet 409', async () => {
    const id = await siparisKur();
    let gecit: () => void = () => {};
    const gecitAcildi = new Promise<void>(c => { gecit = c; });
    let durdu = false;
    G.__faturaPgKanca = async (sql: string, p: unknown[] | undefined) => {
      if (!durdu && sql === 'SELECT data FROM docs WHERE coll = $1 AND id = $2' && p?.[0] === 'orders' && p?.[1] === id) {
        durdu = true;
        await gecitAcildi;
      }
    };
    try {
      const patch = istek('PATCH', `/api/db/orders/${id}`, SATIS, { notes: 'yarış' });
      await bekle(() => durdu, 30_000, 'PATCH SELECT\'i koştu');
      let birak: (r: Response) => void = () => {};
      sonraki(() => new Promise<Response>(c => { birak = c; }));
      const once = mikro.sayac;
      const a = kes(YONETICI, id);
      await bekle(() => mikro.sayac === once + 1, 30_000, 'talep yazıldı, Mikro\'da');
      gecit();
      expect((await patch).s).toBe(200);
      expect(await belgeOku('orders', id)).toMatchObject({ notes: 'yarış', [FATURA_GONDERIM_ALANI]: { durum: 'gonderiliyor' } });
      const ikinci = await mikroSay(() => kes(SATIS, id));
      expect([ikinci.sonuc.s, ikinci.sonuc.j.kod, ikinci.n]).toEqual([409, 'FATURA_GONDERILIYOR', 0]);
      birak(mikroBasari({ faturaNo: yeniNumara() }));
      expect((await a).s).toBe(200);
    } finally { G.__faturaPgKanca = undefined; }
  });

  it('T25 — çit: server.ts\'teki `/api/db/:coll…` POST / PUT / PATCH yazma rotaları 5 ve her biri korumadan geçer; korunan adlar yalnız SUNUCU_TURETILEN_ALANLAR\'dan', () => {
    const kod = kodSatirlari(join(SRC_KOK, '..', 'server.ts')).map(s => s.kod);
    const rotalar = kod.map((k, i) => ({ k, i })).filter(({ k }) => /app\.(post|put|patch)\('\/api\/db\/:coll/.test(k));
    expect(rotalar.map(r => /app\.(post|put|patch)\('([^']+)'/.exec(r.k)?.slice(1, 3).join(' '))).toEqual([
      'post /api/db/:coll', 'put /api/db/:coll/:id', 'patch /api/db/:coll/:id', 'patch /api/db/:coll/:id/increment', 'patch /api/db/:coll/:id/cas',
    ]);
    const govde = (i: number): string => {
      const son = rotalar.find(r => r.i > i)?.i ?? kod.length;
      return kod.slice(i, son).join('\n');
    };
    const [post, put, patch, inc, cas] = rotalar.map(r => govde(r.i));
    // POST / PUT / PATCH / cas — gövde `injectTenant` (→ tenantErisim.kiraciDamgala: türetilen alan düşer) üstünden yazılır.
    expect(post).toMatch(/let data = await injectTenant\(req, coll, resolveSentinels/);
    expect(put).toMatch(/data = await injectTenant\(req, coll, data, before\);/);
    expect(patch).toMatch(/data = await injectTenant\(req, coll, data, before\);/);
    expect(cas).toMatch(/: await injectTenant\(req, coll, set as Record<string, unknown>, rows\[0\]\.data as Record<string, unknown>\);/);
    // PUT / PATCH çakışma dalı korumalı ifadeyle; yanıt / yayın yazılan satırdan.
    for (const g of [put, patch]) {
      expect(g).toMatch(/ON CONFLICT \(coll, id\) DO UPDATE SET data = \$\{sunucuAlanKorumaSql\(coll\)\}, updated_at = now\(\) RETURNING data`/);
      expect(g).not.toMatch(/DO UPDATE SET data = EXCLUDED\.data/);
    }
    // increment — SAHIPLIK_ALANLARI türetilen alanları içerir.
    expect(inc).toMatch(/if \(SAHIPLIK_ALANLARI\.has\(field\)\) return res\.status\(400\)/);
    expect(kod.join('\n')).toMatch(/\.\.\.\[\.\.\.SUNUCU_TURETILEN_ALANLAR\.keys\(\)\]\.flatMap\(c => sunucuTuretilenAlanlar\(c\)\)/);
    // Korunan ad TEK kaynaktan: işaret alanı listede ve server.ts adı metin olarak YAZMIYOR. `ettn` 2026-10-19'dan beri listede
    // (şartname «fatura gövde + gece MF» § 9.B B1 — G3a / H1 onu MF türetme kararında okur; davranış çiti aşağıda «B1»).
    expect(SUNUCU_TURETILEN_ALANLAR.get('orders')).toEqual([FATURA_GONDERIM_ALANI, 'ettn']);
    expect(kod.filter(k => k.includes(FATURA_GONDERIM_ALANI))).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// Y1 (karar 2026-10-17): sunucu İÇİ sipariş yazıcıları (Mikro import / eşleme, e-İrsaliye sonucu, ödeme, kanal…) pgShim üzerinden
// yazar ve pgShim `set(merge)` / `update` OKU-DEĞİŞTİR-YAZ'dır. Talep SELECT ile yazım arasına düşerse eski tam yazım işareti
// silerdi → uçuştaki faturaya ikinci talep geçerdi. Temsilci yollar pgShim'in BÜTÜN yazma biçimleri (sunucu yazıcılarının
// kullandığı): set(merge), tam set (önceden okunmuş belgeyle), update, batch (set(merge) + update). Gerçek havuz (PGlite), gerçek
// talep (HTTP `fatura/kaydet`), araya girme `__faturaPgKanca` ile (T24 kalıbı).
describe('Y1 — pgShim yazımı talebi ezmez (sunucu içi sipariş yazıcıları)', () => {
  const SECIM = 'SELECT data FROM docs WHERE coll = $1 AND id = $2';
  const shim = async () => {
    const { PgFirestore } = await import('./pgShim');
    const pgModul = await import('pg');
    return new PgFirestore(new pgModul.default.Pool());
  };
  /** `yazici` pgShim üzerinden yazar; İLK `SELECT` (oku-değiştir-yaz okuması) sonrası bekletilir, bu arada `ara` koşar. */
  const yarisli = async (id: string, yazici: () => Promise<void>, ara: () => Promise<void>): Promise<void> => {
    let gecit: () => void = () => {};
    const acildi = new Promise<void>(c => { gecit = c; });
    let durdu = false;
    G.__faturaPgKanca = async (sql: string, p: unknown[] | undefined) => {
      if (!durdu && sql === SECIM && p?.[0] === 'orders' && p?.[1] === id) { durdu = true; await acildi; }
    };
    try {
      const yazim = yazici();
      await bekle(() => durdu, 30_000, 'pgShim okuması koştu');
      await ara();
      gecit();
      await yazim;
    } finally { G.__faturaPgKanca = undefined; }
  };
  /** Talep yazılsın ve Mikro'da askıda kalsın; dönen işlev Mikro'yu başarıyla yanıtlar ve isteğin yanıtını bekler. */
  const talepAskida = async (id: string): Promise<() => Promise<Yanit>> => {
    let birak: (r: Response) => void = () => {};
    sonraki(() => new Promise<Response>(c => { birak = c; }));
    const once = mikro.sayac;
    const a = kes(YONETICI, id);
    await bekle(() => mikro.sayac === once + 1, 30_000, 'talep yazıldı, Mikro\'da');
    return async () => { birak(mikroBasari({ faturaNo: yeniNumara() })); return a; };
  };

  const YAZICILAR: Array<[ad: string, yaz: (db: Awaited<ReturnType<typeof shim>>, id: string) => Promise<void>]> = [
    ['set(merge) — ör. e-İrsaliye sonucu, ödeme', (db, id) => db.collection('orders').doc(id).set({ irsaliyeNo: 'IRS-1', notes: 'pgShim' }, { merge: true })],
    ['update — ör. Mikro import eşlemesi', (db, id) => db.collection('orders').doc(id).update({ status: 'Shipped', notes: 'pgShim' })],
    ['tam set (önceden OKUNMUŞ belgeyle) — ör. kanal / yeniden yazım', async (db, id) => {
      const ref = db.collection('orders').doc(id);
      const once = (await ref.get()).data();
      await ref.set({ ...once, notes: 'pgShim' });
    }],
    ['batch: set(merge) + update — ör. Mikro fatura → sipariş eşlemesi', async (db, id) => {
      const ref = db.collection('orders').doc(id);
      const b = db.batch();
      b.set(ref, { notes: 'pgShim' }, { merge: true });
      b.update(ref, { status: 'Shipped' });
      await b.commit();
    }],
  ];

  for (const [ad, yaz] of YAZICILAR) {
    it(`${ad}: okumadan SONRA araya giren talebin işareti kalır; öteki alanlar yazılır; ikinci kaydet 409, Mikro 0`, async () => {
      const db = await shim();
      const id = await siparisKur();
      let bitir: (() => Promise<Yanit>) | undefined;
      await yarisli(id, () => yaz(db, id), async () => { bitir = await talepAskida(id); });
      const satir = await belgeOku('orders', id);
      expect(satir, ad).toMatchObject({ notes: 'pgShim', [FATURA_GONDERIM_ALANI]: { durum: 'gonderiliyor', kim: eposta('ic-Admin') } });
      const ikinci = await mikroSay(() => kes(SATIS, id));
      expect([ikinci.sonuc.s, ikinci.sonuc.j.kod, ikinci.n], ad).toEqual([409, 'FATURA_GONDERILIYOR', 0]);
      if (!bitir) throw new Error('talep yazılmadı');
      expect((await bitir()).s).toBe(200);
      expect(await isaretOku(id)).toMatchObject({ durum: 'gonderildi' });
    });
  }

  it('ters yön: okumadan sonra işaret SİLİNİRSE («Mikro\'da yok») bayat okumadaki işaret geri YAZILMAZ — set(merge) ve update', async () => {
    const db = await shim();
    for (const [ad, yaz] of YAZICILAR.slice(0, 2)) {
      const id = await siparisKur({ [FATURA_GONDERIM_ALANI]: isaretNesnesi('belirsiz') });
      await yarisli(id, () => yaz(db, id), async () => {
        const c = await coz(YONETICI, id, 'mikrodaYok');
        expect(c.s, c.metin).toBe(200);
      });
      const satir = await belgeOku('orders', id);
      expect(satir && FATURA_GONDERIM_ALANI in satir, `${ad}: işaret geri yazılmamalı`).toBe(false);
      expect(satir?.notes, ad).toBe('pgShim');
      const { n } = await mikroSay(() => kes(YONETICI, id));
      expect(n, ad).toBe(1);
    }
  });

  it('yayın yazılan GERÇEK satırdan: pgShim yazımının olayı güncel işareti taşır (bayat JS verisini değil)', async () => {
    const { dbEvents } = await import('./pgShim');
    const db = await shim();
    const id = await siparisKur();
    const olaylar: Array<Record<string, unknown> | undefined> = [];
    const dinle = (e: { coll: string; id: string; data?: Record<string, unknown> }): void => { if (e.coll === 'orders' && e.id === id) olaylar.push(e.data); };
    dbEvents.on('change', dinle);
    let bitir: (() => Promise<Yanit>) | undefined;
    try {
      await yarisli(id, () => db.collection('orders').doc(id).set({ irsaliyeNo: 'IRS-Y' }, { merge: true }), async () => { bitir = await talepAskida(id); });
      const pgShimOlayi = olaylar.find(d => d?.irsaliyeNo === 'IRS-Y');
      expect(pgShimOlayi?.[FATURA_GONDERIM_ALANI]).toMatchObject({ durum: 'gonderiliyor' });
      expect(pgShimOlayi).toEqual(await belgeOku('orders', id));
    } finally { dbEvents.off('change', dinle); }
    if (!bitir) throw new Error('talep yazılmadı');
    expect((await bitir()).s).toBe(200);
  });

  it('çit: pgShim `set` / `update` yazım ifadesi `/api/db` ile AYNI yardımcıdan (`sunucuAlanKorumaSql`); korumasız tam yazım ifadesi kalmadı', () => {
    const kod = kodSatirlari(join(SRC_KOK, 'server', 'pgShim.ts')).map(s => s.kod).join('\n');
    expect(kod).toMatch(/ON CONFLICT \(coll, id\) DO UPDATE SET data = \$\{sunucuAlanKorumaSql\(this\.coll\)\}, updated_at = now\(\)/);
    expect(kod).toMatch(/UPDATE docs SET data = \$\{sunucuAlanKorumaSql\(this\.coll, '\$3::jsonb'\)\}, updated_at = now\(\) WHERE coll = \$1 AND id = \$2 RETURNING data/);
    expect(kod).not.toMatch(/DO UPDATE SET data = EXCLUDED\.data/);
    // Korumasız `SET data = $3` yalnız türetilen alanı OLMAYAN koleksiyon dalında (koru ? … : …).
    expect(kod.match(/'UPDATE docs SET data = \$3, updated_at = now\(\) WHERE coll = \$1 AND id = \$2'/g)).toHaveLength(1);
    expect(kod).toMatch(/koru\s*\?\s*`UPDATE docs SET data = \$\{sunucuAlanKorumaSql/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// Şartname «fatura gövde + gece MF» § 9 (2026-10-19): A1 (işarete `cariKod` + `faturaTarihi`), B1 (`ettn` sunucuya özel alan),
// B2 / B3 / B6 («Mikro'da var» + ETTN, «ETTN ekle», ayna tutarlılığı). Faturadan-sipariş koşan sınamalar KENDİ kiracısında: bu
// dosyanın öteki sınamaları ana kiracıda carisi bilinmeyen `belirsiz` işaretler bırakır — onlar tarih koşulunu sağlayan TÜM
// faturaları bekletirdi (kural böyle, § 9.A A5).
let kiraciSayaci = 0;
/** Yeni kiracı + Yönetici ve Satış kullanıcıları. */
const kiraciKur = async (): Promise<{ cid: string; YON: Record<string, string>; SAT: Record<string, string> }> => {
  const cid = `ETTN-KIRACI-${++kiraciSayaci}`;
  await belgeKoy('users', `k${kiraciSayaci}-Admin`, { email: eposta(`k${kiraciSayaci}-Admin`), role: 'Admin', companyId: cid });
  await belgeKoy('users', `k${kiraciSayaci}-Sales`, { email: eposta(`k${kiraciSayaci}-Sales`), role: 'Sales', companyId: cid });
  return { cid, YON: belirtec(`k${kiraciSayaci}-Admin`), SAT: belirtec(`k${kiraciSayaci}-Sales`) };
};
const ETTN_A = 'abcdef12-3456-7890-abcd-ef1234567890';
const ettnNo = (n: number): string => `abcdef12-3456-7890-abcd-${String(n).padStart(12, '0')}`;
let aynaSayaci = 0;
/** `mikroFaturalar` satırı (fatura-listesi importunun ham cha_* biçimi). */
const aynaKoy = async (cid: string, ek: Record<string, unknown>): Promise<number> => {
  const sira = 7000 + (++aynaSayaci);
  await belgeKoy('mikroFaturalar', `ayna-${sira}`, { cha_evrakno_seri: '', cha_evrakno_sira: sira, cha_tarihi: '2026-10-19T00:00:00', cha_tip: 0,
    cha_kod: '120.01.0042', cha_meblag: 15000, companyId: cid, source: 'mikro_import', ...ek });
  return sira;
};
const ettnEkle = (b: Record<string, string>, firebaseId: string, ettn?: unknown): Promise<Yanit> =>
  istek('POST', '/api/mikro/fatura/sonuc', b, { firebaseId, karar: 'ettnEkle', ...(ettn !== undefined ? { ettn } : {}) });
const varEttn = (b: Record<string, string>, firebaseId: string, ettn: string, numara?: string): Promise<Yanit> =>
  istek('POST', '/api/mikro/fatura/sonuc', b, { firebaseId, karar: 'mikrodaVar', ettn, ...(numara !== undefined ? { numara } : {}) });
const turet = (b: Record<string, string>): Promise<Yanit> => istek('POST', '/api/mikro/import/faturadan-siparis', b, {});
const isaretli = (durum: string, cariKod = '120.01.0042', ek: Record<string, unknown> = {}) =>
  ({ [FATURA_GONDERIM_ALANI]: isaretNesnesi(durum, Date.now(), { cariKod, faturaTarihi: '18.10.2026', ...ek }) });

describe('§ 9.A A1 — talepte işarete `cariKod` (gövdedeki `cha_kod`) ve `faturaTarihi` (`cha_tarihi`) yazılır, geçişlerde KORUNUR', () => {
  it('talep anında (uçuşta) işaret iki alanı taşır; `gonderildi` geçişinden sonra da', async () => {
    const id = await siparisKur();
    let birak: (r: Response) => void = () => {};
    sonraki(() => new Promise<Response>(c => { birak = c; }));
    const once = mikro.sayac;
    const a = kes(YONETICI, id);
    await bekle(() => mikro.sayac === once + 1, 30_000, 'talep yazıldı, Mikro\'da');
    const ucusta = await isaretOku(id);
    expect(ucusta).toMatchObject({ durum: 'gonderiliyor', cariKod: '120.01.0042', faturaTarihi: '17.10.2026' });
    // Gövdeye giden değerlerle AYNI (müşteri kartından türetilmedi).
    const evrak = (JSON.parse(mikro.govdeler[mikro.govdeler.length - 1]) as { Mikro?: { evraklar?: Array<Record<string, unknown>> }; evraklar?: Array<Record<string, unknown>> });
    const gonderilen = (evrak.Mikro?.evraklar ?? evrak.evraklar ?? [])[0];
    expect(gonderilen).toBeDefined();
    expect([gonderilen?.cha_kod, gonderilen?.cha_tarihi]).toEqual([ucusta?.cariKod, ucusta?.faturaTarihi]);
    birak(mikroBasari({ faturaNo: yeniNumara() }));
    expect((await a).s).toBe(200);
    expect(await isaretOku(id)).toMatchObject({ durum: 'gonderildi', cariKod: '120.01.0042', faturaTarihi: '17.10.2026' });
  });

  it('`belirsiz` geçişinden ve ardından «Mikro\'da var» çözümünden sonra iki alan korunur', async () => {
    const id = await siparisKur();
    sonraki(() => new Response('<html>Bad Gateway</html>', { status: 502 }));
    expect((await kes(YONETICI, id)).j.kod).toBe('FATURA_SONUCU_BILINMIYOR');
    expect(await isaretOku(id)).toMatchObject({ durum: 'belirsiz', cariKod: '120.01.0042', faturaTarihi: '17.10.2026' });
    expect((await coz(YONETICI, id, 'mikrodaVar', 'N-a1')).s).toBe(200);
    expect(await isaretOku(id)).toMatchObject({ durum: 'gonderildi', numara: 'N-a1', cariKod: '120.01.0042', faturaTarihi: '17.10.2026' });
  });
});

describe('§ 9.B B1 — `ettn` sunucuya özel alan: istemci `/api/db` ile DEĞİŞTİREMEZ (Satış rolü, beş yazma yolu)', () => {
  it('POST yeni kayda ETTN yazmaz; PUT / PUT?merge=1 / PATCH (nokta yolu, tünel) / cas satırdaki değeri DEĞİŞTİRMEZ; öteki alanlar yazılır', async () => {
    const { SAT } = await kiraciKur();
    const p = await istek('POST', '/api/db/orders', SAT, { customerName: 'Yeni', ettn: ETTN_A });
    expect(p.s, p.metin).toBe(200);
    expect(await belgeOku('orders', String(p.j.id))).not.toHaveProperty('ettn');
    const SIFIR = '00000000-0000-0000-0000-000000000000';
    for (const [ad, tohum] of [['geçerli', ETTN_A], ['sıfır', SIFIR]] as const) {
      const id = `b1-${ad === 'geçerli' ? 'g' : 's'}-${Date.now()}`;
      const d0 = await belgeOku('users', `k${kiraciSayaci}-Sales`);
      await belgeKoy('orders', id, { customerName: 'Şirin Yapı Malzemeleri', status: 'Processing', companyId: d0?.companyId, ettn: tohum, notes: 'ilk' });
      const korundu = async (adim: string): Promise<void> => expect((await belgeOku('orders', id))?.ettn, `${ad} — ${adim}`).toBe(tohum);
      const yeni = ad === 'geçerli' ? SIFIR : ETTN_A;
      expect((await istek('PUT', `/api/db/orders/${id}`, SAT, { customerName: 'Şirin Yapı Malzemeleri', status: 'Processing', notes: 'put', ettn: yeni })).s).toBe(200);
      await korundu('PUT');
      expect((await istek('PUT', `/api/db/orders/${id}?merge=1`, SAT, { ettn: null, notes: 'merge' })).s).toBe(200);
      await korundu('PUT?merge=1');
      for (const yama of [{ ettn: yeni }, { ettn: null }, { 'ettn.x': 'y' }] as Array<Record<string, unknown>>) {
        expect((await istek('PATCH', `/api/db/orders/${id}`, SAT, { ...yama, notes: 'patch' })).s).toBe(200);
        await korundu(`PATCH ${JSON.stringify(yama)}`);
        expect((await istek('POST', `/api/db/orders/${id}`, { ...SAT, 'X-Cetpa-Method': 'PATCH' }, { ...yama, notes: 'tunel' })).s).toBe(200);
        await korundu(`tünel ${JSON.stringify(yama)}`);
      }
      const c = await istek('PATCH', `/api/db/orders/${id}/cas`, SAT, { field: 'status', expect: 'Processing', set: { ettn: yeni, notes: 'cas' } });
      expect([c.s, c.j.claimed], c.metin).toEqual([200, true]);
      await korundu('cas');
      expect((await belgeOku('orders', id))?.notes).toBe('cas');
      expect((await istek('PATCH', `/api/db/orders/${id}/increment`, SAT, { field: 'ettn', delta: 1 })).s).toBe(400);
    }
  });

  it('PATCH sonrası G3a «bağlı» sayacı DEĞİŞMEZ: ETTN\'yi silmeye / değiştirmeye çalışan istemci yazımı Mikro faturasını MF siparişine çevirmez', async () => {
    const { cid, YON, SAT } = await kiraciKur();
    const sira = await aynaKoy(cid, { cha_uuid: `{${ETTN_A.toLocaleUpperCase('tr-TR')}}` });
    await belgeKoy('orders', 'b1-bagli', { companyId: cid, orderNumber: 'SIP-B1', customerName: 'Şirin Yapı Malzemeleri', status: 'Delivered', hasInvoice: true, ettn: ETTN_A });
    const r1 = await turet(YON);
    expect(r1.s, r1.metin).toBe(200);
    expect(String(r1.j.note)).toContain('1 fatura Cetpa siparişine bağlı (ETTN) — türetilmedi');
    for (const yama of [{ ettn: '' }, { ettn: null }, { ettn: ettnNo(99) }]) {
      expect((await istek('PATCH', '/api/db/orders/b1-bagli', SAT, yama)).s).toBe(200);
      const r = await turet(YON);
      expect(String(r.j.note), JSON.stringify(yama)).toContain('1 fatura Cetpa siparişine bağlı (ETTN) — türetilmedi');
    }
    expect(await satirVar('orders', `mikrofat__${cid}__-${sira}`)).toBe(false);
  });
});

describe('§ 9.B B2 / B6 — «ETTN ekle» ve «Mikro\'da var» + ETTN (`POST /api/mikro/fatura/sonuc`)', () => {
  it('KAPI (sonuc ucuyla birebir): BAYİ / B2B 403, MFA doğrulanmamış 403, yabancı kiracı 404, olmayan sipariş 404 — işarete ve ETTN\'ye dokunulmaz', async () => {
    const id = await siparisKur(isaretli('gonderildi'));
    const once = await belgeOku('orders', id);
    for (const b of [BAYI, B2B]) expect((await ettnEkle(b, id, ETTN_A)).s).toBe(403);
    const m = await ettnEkle(MFA_ACIK, id, ETTN_A);
    expect([m.s, m.j.mfaRequired]).toEqual([403, true]);
    const y = await ettnEkle(YABANCI, id, ETTN_A);
    expect([y.s, y.j.error]).toEqual([404, 'Kayıt bulunamadı.']);
    expect((await ettnEkle(YONETICI, 'boyle-bir-siparis-yok', ETTN_A)).s).toBe(404);
    expect(await satirVar('orders', 'boyle-bir-siparis-yok')).toBe(false);
    expect(await belgeOku('orders', id)).toEqual(once);
  });

  it('ŞEMA: `ettnEkle` ETTN\'siz → 400 «ETTN eklemek için…»; `mikrodaYok` + ETTN → 400 ««Mikro\'da yok» kararında ETTN verilmez.»; bilinmeyen karar → Türkçe ileti', async () => {
    const id = await siparisKur(isaretli('gonderildi'));
    const r1 = await ettnEkle(YONETICI, id);
    expect([r1.s, r1.j.error]).toEqual([400, 'ETTN eklemek için geçerli bir ETTN girin.']);
    const r2 = await istek('POST', '/api/mikro/fatura/sonuc', YONETICI, { firebaseId: id, karar: 'mikrodaYok', ettn: ETTN_A });
    expect([r2.s, r2.j.error]).toEqual([400, '«Mikro\'da yok» kararında ETTN verilmez.']);
    const r3 = await istek('POST', '/api/mikro/fatura/sonuc', YONETICI, { firebaseId: id, karar: 'ettnSil', ettn: ETTN_A });
    expect([r3.s, r3.j.error]).toEqual([400, 'Geçersiz karar: mikrodaVar, mikrodaYok ya da ettnEkle olmalı.']);
    expect((await belgeOku('orders', id))).not.toHaveProperty('ettn');
  });

  it('400 FATURA_ETTN_GECERSIZ — \'abc\', sıfır GUID, tire yeri bozuk (iki kararda da); hiçbir şey yazılmaz', async () => {
    for (const ettn of ['abc', '00000000-0000-0000-0000-000000000000', 'abcdef123-456-7890-abcd-ef1234567890']) {
      const g = await siparisKur(isaretli('gonderildi'));
      const r = await ettnEkle(YONETICI, g, ettn);
      expect([r.s, r.j.kod, r.j.error], ettn).toEqual([400, 'FATURA_ETTN_GECERSIZ', 'ETTN geçersiz: Mikro\'da e-Fatura ekranındaki 36 karakterlik ETTN\'yi girin (sıfır ETTN kabul edilmez).']);
      expect(await belgeOku('orders', g), ettn).not.toHaveProperty('ettn');
      const b = await siparisKur(isaretli('belirsiz'));
      expect((await varEttn(YONETICI, b, ettn)).j.kod, ettn).toBe('FATURA_ETTN_GECERSIZ');
      expect(await isaretOku(b), ettn).toMatchObject({ durum: 'belirsiz' });
    }
  });

  it('VAKA TABLOSU (lib/ettn.test ile AYNI): uç geçerliyi YAZILAN anahtarla kabul eder, geçersizi 400 ile reddeder — sonuçlar `cetpaEttnAnahtari` ile birebir', async () => {
    const { cid, YON } = await kiraciKur();
    for (const [i, v] of ETTN_VAKALARI.entries()) {
      const id = `vaka-${cid}-${i}`;
      await belgeKoy('orders', id, { companyId: cid, orderNumber: `SIP-V${i}`, ...isaretli('gonderildi', `120.07.${i}`) });
      const r = await ettnEkle(YON, id, v.girdi);
      const uc = r.s === 200 ? String((await belgeOku('orders', id))?.ettn) : '';
      expect(uc, `${v.ad}: ${r.metin}`).toBe(cetpaEttnAnahtari(v.girdi));
      expect(uc, v.ad).toBe(v.anahtar);
      if (r.s !== 200) {
        expect(r.s, v.ad).toBe(400);
        expect(r.j.kod, v.ad).toBe(v.bos ? undefined : 'FATURA_ETTN_GECERSIZ');
      } else {
        expect(r.j.ettn, v.ad).toBe(v.anahtar);
        // Vaka satırları aynı ETTN'yi paylaşamaz (B3) — sonraki geçerli vakaya yer aç: bu satırın ETTN'si doğrudan silinir.
        const d = await belgeOku('orders', id);
        if (d) { const { ettn: _e, ...kalan } = d; await belgeKoy('orders', id, kalan); }
      }
    }
  });

  it('200 — `belirsiz` + «Mikro\'da var» + `{1B2C…}` (büyük harf, parantezli) → KÜÇÜK HARFLİ anahtar yazılır; yanıt ETTN\'yi yazılan satırdan döner; syncLog ayrıntısı + denetim 1', async () => {
    const { cid, SAT } = await kiraciKur();
    const ETTN = '1b2c3d4e-0000-4abc-8def-0123456789ab';
    await aynaKoy(cid, { cha_uuid: ETTN });
    const id = `belirsiz-var-${cid}`;
    await belgeKoy('orders', id, { companyId: cid, orderNumber: 'SIP-BV', ...isaretli('belirsiz') });
    const r = await varEttn(SAT, id, `{${ETTN.toLocaleUpperCase('tr-TR')}}`, 'N-77');
    expect([r.s, r.j.success, r.j.karar, r.j.ettn, r.j.numara], r.metin).toEqual([200, true, 'mikrodaVar', ETTN, 'N-77']);
    expect(r.j).not.toHaveProperty('uyari');
    expect(await belgeOku('orders', id)).toMatchObject({ ettn: ETTN, mikroFaturaNo: 'N-77', hasInvoice: true, [FATURA_GONDERIM_ALANI]: { durum: 'gonderildi', numara: 'N-77', cariKod: '120.01.0042' } });
    const sync = await syncLogSatirlari('FaturaSonucCozumu', id);
    expect(sync).toHaveLength(1);
    expect(sync[0].ayrinti).toEqual({ karar: 'mikrodaVar', numara: 'N-77', ettn: ETTN });
    const denetim = await pg().query("SELECT data FROM docs WHERE coll = 'auditLog' AND data->>'action' = 'FaturaSonucCozumu' AND data->>'details' LIKE $1", [`%${id}%`]);
    expect(denetim.rows.length).toBe(1);
  });

  it('200 — `gonderildi` + ETTN yok / sıfır GUID / biçimsiz + «ETTN ekle» → yazılır (`ettnOnceki` yalnız eski değer doluysa); sonraki koşuda bekletme KALKAR, G3a «bağlı» 1', async () => {
    const { cid, YON, SAT } = await kiraciKur();
    const durumlar: Array<[string, Record<string, unknown>]> = [
      ['yok', {}], ['sıfır', { ettn: '00000000-0000-0000-0000-000000000000' }], ['biçimsiz', { ettn: 'abc-bozuk' }],
    ];
    for (const [i, [ad, ek]] of durumlar.entries()) {
      const cari = `120.08.${i}`;
      const ETTN = ettnNo(800 + i);
      const sira = await aynaKoy(cid, { cha_uuid: `{${ETTN}}`, cha_kod: cari });
      const id = `ekle-${ad}-${cid}`;
      await belgeKoy('orders', id, { companyId: cid, orderNumber: `SIP-E${i}`, hasInvoice: true, ...ek, ...isaretli('gonderildi', cari) });
      // Önce: ETTN'siz `gonderildi` sipariş aynı carinin yeni faturasını BEKLETİR (İ-1 kapanışı).
      const once = await turet(YON);
      expect(once.s, once.metin).toBe(200);
      expect(String(once.j.note), ad).toContain(`(SIP-E${i})`);
      expect(await satirVar('orders', `mikrofat__${cid}__-${sira}`), ad).toBe(false);
      const r = await ettnEkle(SAT, id, ETTN.toLocaleUpperCase('tr-TR'));
      expect([r.s, r.j.success, r.j.karar, r.j.ettn], `${ad}: ${r.metin}`).toEqual([200, true, 'ettnEkle', ETTN]);
      expect((await belgeOku('orders', id))?.ettn, ad).toBe(ETTN);
      const sync = await syncLogSatirlari('FaturaSonucCozumu', id);
      expect(sync.map(x => x.ayrinti), ad).toEqual([{ karar: 'ettnEkle', ettn: ETTN, ...(typeof ek.ettn === 'string' ? { ettnOnceki: ek.ettn } : {}) }]);
      const sonra = await turet(YON);
      expect(String(sonra.j.note), ad).not.toContain(`SIP-E${i}`);
      // Kiracının önceki turlarda bağlanan faturaları da sayılır: tur i'de i + 1 fatura bağlı.
      expect(String(sonra.j.note), ad).toContain(`${i + 1} fatura Cetpa siparişine bağlı (ETTN)`);
      expect(await satirVar('orders', `mikrofat__${cid}__-${sira}`), ad).toBe(false);
    }
  });

  it('409 FATURA_ETTN_VAR — geçerli ETTN varken «ETTN ekle» ÜZERİNE YAZMAZ (parantezli / büyük harfli kayıtlı değer de geçerli sayılır)', async () => {
    for (const kayitli of [ETTN_A, `{${ETTN_A.toLocaleUpperCase('tr-TR')}}`]) {
      const id = await siparisKur({ ettn: kayitli, ...isaretli('gonderildi') });
      const r = await ettnEkle(YONETICI, id, ettnNo(1));
      expect([r.s, r.j.kod, r.j.error]).toEqual([409, 'FATURA_ETTN_VAR', 'Bu siparişin ETTN\'si zaten kayıtlı.']);
      expect((await belgeOku('orders', id))?.ettn).toBe(kayitli);
    }
  });

  it('409 — «ETTN ekle» yalnız `gonderildi`de: `belirsiz` / bayat `gonderiliyor` → SONUCU_BILINMIYOR, taze `gonderiliyor` → GONDERILIYOR, işaretsiz / `reddedildi` → SONUC_YOK; MF kaydı → 400', async () => {
    const vakalar: Array<[Record<string, unknown>, number, string]> = [
      [isaretli('belirsiz'), 409, 'FATURA_SONUCU_BILINMIYOR'],
      [{ [FATURA_GONDERIM_ALANI]: isaretNesnesi('gonderiliyor', Date.now() - FATURA_GONDERIM_BAYATLIK_MS - 5_000) }, 409, 'FATURA_SONUCU_BILINMIYOR'],
      [isaretli('gonderiliyor'), 409, 'FATURA_GONDERILIYOR'],
      [{}, 409, 'FATURA_SONUC_YOK'],
      [isaretli('reddedildi'), 409, 'FATURA_SONUC_YOK'],
      [{ source: 'mikro-fatura', ...isaretli('gonderildi') }, 400, 'FATURA_KESILEMEZ'],
    ];
    for (const [ek, durum, kod] of vakalar) {
      const id = await siparisKur(ek);
      const r = await ettnEkle(YONETICI, id, ETTN_A);
      expect([r.s, r.j.kod], JSON.stringify(ek)).toEqual([durum, kod]);
      expect(await belgeOku('orders', id), kod).not.toHaveProperty('ettn');
    }
  });

  it('409 FATURA_ETTN_BASKA_SIPARISTE — aynı ETTN aynı kiracının başka Cetpa siparişinde (kaydetin yazdığı parantezli / büyük harfli biçim dâhil); iki kararda da', async () => {
    const { cid, YON } = await kiraciKur();
    await belgeKoy('orders', `ilk-${cid}`, { companyId: cid, orderNumber: 'SIP-ILK', ettn: `{${ETTN_A.toLocaleUpperCase('tr-TR')}}`, ...isaretli('gonderildi') });
    const g = `ikinci-g-${cid}`;
    await belgeKoy('orders', g, { companyId: cid, orderNumber: 'SIP-G', ...isaretli('gonderildi') });
    const r = await ettnEkle(YON, g, ETTN_A);
    expect([r.s, r.j.kod, r.j.error]).toEqual([409, 'FATURA_ETTN_BASKA_SIPARISTE', 'Bu ETTN başka bir siparişte kayıtlı: SIP-ILK']);
    expect(await belgeOku('orders', g)).not.toHaveProperty('ettn');
    const b = `ikinci-b-${cid}`;
    await belgeKoy('orders', b, { companyId: cid, orderNumber: 'SIP-B', ...isaretli('belirsiz') });
    const r2 = await varEttn(YON, b, ETTN_A);
    expect([r2.s, r2.j.kod]).toEqual([409, 'FATURA_ETTN_BASKA_SIPARISTE']);
    expect(await isaretOku(b)).toMatchObject({ durum: 'belirsiz' });
    // MF siparişi «başka Cetpa siparişi» SAYILMAZ; başka kiracının siparişi de.
    await belgeKoy('orders', `mf-${cid}`, { companyId: cid, source: 'mikro-fatura', ettn: ettnNo(5) });
    await belgeKoy('orders', `yabanci-${cid}`, { companyId: BASKA_KIRACI, ettn: ettnNo(6) });
    const g2 = `ucuncu-${cid}`;
    await belgeKoy('orders', g2, { companyId: cid, orderNumber: 'SIP-3', ...isaretli('gonderildi') });
    expect((await ettnEkle(YON, g2, ettnNo(5))).s).toBe(200);
    const g3 = `dorduncu-${cid}`;
    await belgeKoy('orders', g3, { companyId: cid, orderNumber: 'SIP-4', ...isaretli('gonderildi') });
    expect((await ettnEkle(YON, g3, ettnNo(6))).s).toBe(200);
  });

  it('409 FATURA_ETTN_BASKA_CARI — aynada yalnız ALIŞ faturası; satış faturası başka carinin', async () => {
    const { cid, YON } = await kiraciKur();
    await aynaKoy(cid, { cha_uuid: ettnNo(11), cha_tip: 1, cha_kod: '320.01.0001' });
    const a = `alis-${cid}`;
    await belgeKoy('orders', a, { companyId: cid, orderNumber: 'SIP-A', ...isaretli('gonderildi') });
    const r1 = await ettnEkle(YON, a, ettnNo(11));
    expect([r1.s, r1.j.kod, r1.j.error]).toEqual([409, 'FATURA_ETTN_BASKA_CARI', 'Bu ETTN bir alış faturasına ait']);
    await aynaKoy(cid, { cha_uuid: ettnNo(12), cha_kod: '120.01.0099' });
    const c = `cari-${cid}`;
    await belgeKoy('orders', c, { companyId: cid, orderNumber: 'SIP-C', ...isaretli('belirsiz') });
    const r2 = await varEttn(YON, c, ettnNo(12));
    expect([r2.s, r2.j.kod, r2.j.error]).toEqual([409, 'FATURA_ETTN_BASKA_CARI', 'Bu ETTN 120.01.0099 carisinin faturası; sipariş carisi 120.01.0042']);
    for (const id of [a, c]) expect(await belgeOku('orders', id)).not.toHaveProperty('ettn');
  });

  // İnceleme 2026-10-19 (B3 × A2): bekletme kuralı talep sınırından önceki faturayı «bu siparişin olamaz» sayar (gece MF'ye dönüşür).
  // Bağ kurulurken aynı ölçüt sınanmazsa eski faturanın ETTN'si kabul edilir, bekletme kalkar, gerçek fatura da MF türer (çift satış).
  it('409 FATURA_ETTN_ONCEKI_FATURA — aynı carinin talep sınırından ÖNCEKİ (zaten MF siparişi olmuş) faturasının ETTN\'si: «Mikro\'da var» ve «ETTN ekle»; işaret / ETTN değişmez, gece bekletme SÜRER; sınır günü ve sonrası kabul', async () => {
    const { cid, YON, SAT } = await kiraciKur();
    const CARI = '120.01.0042';
    const ESKI = ettnNo(31);
    const YENI = ettnNo(32);
    // Talep sınırı 2026-10-18 (`isaretli` → faturaTarihi 18.10.2026). Eski fatura 10.10 (sınırdan önce), yeni fatura 19.10.
    const eskiSira = await aynaKoy(cid, { cha_uuid: `{${ESKI.toLocaleUpperCase('tr-TR')}}`, cha_tarihi: '2026-10-10T00:00:00', cha_kod: CARI });
    const yeniSira = await aynaKoy(cid, { cha_uuid: `{${YENI}}`, cha_tarihi: '2026-10-19T00:00:00', cha_kod: CARI });
    const a = `onceki-a-${cid}`;
    await belgeKoy('orders', a, { companyId: cid, orderNumber: 'SIP-OA', ...isaretli('belirsiz', CARI) });
    const once = await turet(YON);
    expect(once.s, once.metin).toBe(200);
    expect(String(once.j.note)).toContain('(SIP-OA)');
    expect(await satirVar('orders', `mikrofat__${cid}__-${eskiSira}`), 'eski fatura sınırdan önce: bekletilmez, MF türer').toBe(true);
    expect(await satirVar('orders', `mikrofat__${cid}__-${yeniSira}`), 'yeni fatura bekletilir').toBe(false);

    const HATA = 'Bu ETTN 2026-10-10 tarihli, talepten (2026-10-18) önceki bir faturanın; bu siparişin faturası olamaz';
    const r = await varEttn(SAT, a, ESKI, 'N-ESKI');
    expect([r.s, r.j.kod, r.j.error], r.metin).toEqual([409, 'FATURA_ETTN_ONCEKI_FATURA', HATA]);
    expect(r.j.mikroFaturaGonderimi).toMatchObject({ durum: 'belirsiz' });
    const aSonra = await belgeOku('orders', a);
    expect(aSonra).not.toHaveProperty('ettn');
    expect(aSonra).not.toHaveProperty('mikroFaturaNo');
    expect(aSonra).not.toHaveProperty('hasInvoice');
    expect(await isaretOku(a)).toMatchObject({ durum: 'belirsiz', cariKod: CARI, faturaTarihi: '18.10.2026' });
    expect(await syncLogSatirlari('FaturaSonucCozumu', a)).toHaveLength(0);

    // «ETTN ekle» (`gonderildi`, ETTN'siz) aynı ret.
    const b = `onceki-b-${cid}`;
    await belgeKoy('orders', b, { companyId: cid, orderNumber: 'SIP-OB', hasInvoice: true, ...isaretli('gonderildi', CARI) });
    const r2 = await ettnEkle(YON, b, ESKI);
    expect([r2.s, r2.j.kod, r2.j.error], r2.metin).toEqual([409, 'FATURA_ETTN_ONCEKI_FATURA', HATA]);
    expect(await belgeOku('orders', b)).not.toHaveProperty('ettn');
    expect(await isaretOku(b)).toMatchObject({ durum: 'gonderildi' });

    // Gece: bekletme SÜRER — yeni fatura MF olarak türemez, not iki siparişi de anar.
    const ara = await turet(YON);
    expect(ara.s, ara.metin).toBe(200);
    expect(String(ara.j.note)).toContain('SIP-OA');
    expect(await satirVar('orders', `mikrofat__${cid}__-${yeniSira}`)).toBe(false);

    // Doğru fatura (sınırdan sonra) kabul; sınır GÜNÜ de kabul (bekletme `>=`).
    const r3 = await varEttn(SAT, a, YENI);
    expect([r3.s, r3.j.success, r3.j.ettn], r3.metin).toEqual([200, true, YENI]);
    expect(r3.j).not.toHaveProperty('uyari');
    const ESIT = ettnNo(33);
    await aynaKoy(cid, { cha_uuid: ESIT, cha_tarihi: '2026-10-18T00:00:00', cha_kod: CARI });
    const r4 = await ettnEkle(YON, b, ESIT);
    expect([r4.s, r4.j.success, r4.j.ettn], r4.metin).toEqual([200, true, ESIT]);
    expect((await belgeOku('orders', b))?.ettn).toBe(ESIT);
    const son = await turet(YON);
    expect(String(son.j.note)).not.toContain('SIP-OA');
    expect(await satirVar('orders', `mikrofat__${cid}__-${yeniSira}`), 'G3a ile bağlı: MF türemez').toBe(false);
  });

  it('`uyari` — aynada yok / yönü okunamayan satır / işarette cari yok → KABUL; uyarı yanıtta ve syncLog ayrıntısında', async () => {
    const { cid, YON } = await kiraciKur();
    const UYARI = 'ETTN Mikro fatura aynasında henüz yok ya da carisi doğrulanamadı (ayna gece güncellenir)';
    await aynaKoy(cid, { cha_uuid: ettnNo(22), cha_tip: null, yon: null, cha_kod: '120.01.0099' });
    await aynaKoy(cid, { cha_uuid: ettnNo(23), cha_kod: '120.01.0099' });
    const vakalar: Array<[string, Record<string, unknown>, string]> = [
      ['aynada yok', isaretli('gonderildi', '120.09.1'), ettnNo(21)],
      ['yönü okunamayan', isaretli('gonderildi', '120.09.2'), ettnNo(22)],
      ['işarette cari yok', { [FATURA_GONDERIM_ALANI]: isaretNesnesi('gonderildi') }, ettnNo(23)],
    ];
    for (const [i, [ad, ek, ettn]] of vakalar.entries()) {
      const id = `uyari-${i}-${cid}`;
      await belgeKoy('orders', id, { companyId: cid, orderNumber: `SIP-U${i}`, ...ek });
      const r = await ettnEkle(YON, id, ettn);
      expect([r.s, r.j.uyari, r.j.ettn], `${ad}: ${r.metin}`).toEqual([200, UYARI, ettn]);
      expect((await syncLogSatirlari('FaturaSonucCozumu', id))[0]?.ayrinti, ad).toEqual({ karar: 'ettnEkle', ettn, uyari: UYARI });
    }
  });

  // SINIR: PGlite TEK bağlantılıdır — burada B, A'nın UPDATE'inden ÖNCE baştan sona koşar (SIRALI araya girme). Sınanan: ön denetimi
  // ikisi de geçer, A'nın UPDATE'i B'nin İŞLENMİŞ yazımını `NOT EXISTS` ile görür. GERÇEK eşzamanlılık (iki bağlantıda aynı anda iki
  // UPDATE, READ COMMITTED) burada SINANAMAZ: orada `NOT EXISTS` ötekinin işlenmemiş yazımını görmez, yarışı (kiracı, ETTN) danışma
  // kilidi kapatır — kilidin sırası ve işlem sınırı aşağıdaki «DANIŞMA KİLİDİ» testinde ve `mikro/faturaGonderimi.ettn.test.ts`'te.
  it('SIRALI ARAYA GİRME — aynı ETTN iki siparişe: ön denetimi ikisi de geçer, B\'nin yazımı A\'nın UPDATE\'inden önce işlenir → A\'nın NOT EXISTS\'i görür, YALNIZ biri yazar; öteki 409 BASKA_SIPARISTE (eşzamanlı iki UPDATE\'i durduran danışma kilididir, PGlite tek bağlantılı — sınanamaz)', async () => {
    for (const karar of ['ettnEkle', 'mikrodaVar'] as const) {
      const { cid, YON, SAT } = await kiraciKur();
      const durum = karar === 'ettnEkle' ? 'gonderildi' : 'belirsiz';
      const a = `yaris-a-${cid}`, b = `yaris-b-${cid}`;
      await belgeKoy('orders', a, { companyId: cid, orderNumber: 'SIP-YA', ...isaretli(durum) });
      await belgeKoy('orders', b, { companyId: cid, orderNumber: 'SIP-YB', ...isaretli(durum) });
      const ETTN = ettnNo(karar === 'ettnEkle' ? 31 : 32);
      let bBitti: Promise<Yanit> | undefined;
      let durdu = false;
      // A'nın yazım ifadesi KOŞMADAN önce B baştan sona koşar (ön denetimi A'nınkinden sonra, yazımı önce).
      G.__faturaPgOnKanca = async (sql: string, p: unknown[] | undefined) => {
        if (!durdu && /^UPDATE docs SET data = /.test(sql) && /NOT EXISTS/.test(sql) && p?.[0] === a) {
          durdu = true;
          bBitti = karar === 'ettnEkle' ? ettnEkle(SAT, b, ETTN) : varEttn(SAT, b, ETTN);
          await bBitti;
        }
      };
      try {
        const ra = karar === 'ettnEkle' ? await ettnEkle(YON, a, ETTN) : await varEttn(YON, a, ETTN);
        expect(durdu, karar).toBe(true);
        const rb = await bBitti;
        expect([rb?.s, ra.s, ra.j.kod], karar).toEqual([200, 409, 'FATURA_ETTN_BASKA_SIPARISTE']);
        expect(ra.j.error, karar).toBe('Bu ETTN başka bir siparişte kayıtlı: SIP-YB');
        expect([(await belgeOku('orders', a))?.ettn, (await belgeOku('orders', b))?.ettn], karar).toEqual([undefined, ETTN]);
      } finally { G.__faturaPgOnKanca = undefined; }
    }
  });

  it('DANIŞMA KİLİDİ — iki yolda da kilit deyimi UPDATE\'ten ÖNCE ve AYNI işlemde (BEGIN → kilit → UPDATE → COMMIT, araya deyim girmez); UPDATE düşerse ROLLBACK, satır değişmez, sonraki istek temiz işlemle yazar (gerçek eşzamanlılık PGlite\'ta sınanamaz)', async () => {
    const { cid, YON } = await kiraciKur();
    const gunluk: Array<{ sql: string; p: unknown[] | undefined }> = [];
    const ETTN_YAZAN = /^UPDATE docs SET data = .*NOT EXISTS/s;
    const adim = (x: { sql: string }): string => (/^(BEGIN|COMMIT|ROLLBACK)$/.test(x.sql.trim()) ? x.sql.trim()
      : /pg_advisory_xact_lock/.test(x.sql) ? 'KILIT' : ETTN_YAZAN.test(x.sql) ? 'YAZ' : 'BASKA');
    const dizi = (): string[] => {
      const i = gunluk.findIndex(x => adim(x) === 'BEGIN');
      return i < 0 ? [] : gunluk.slice(i, i + 4).map(adim);
    };
    try {
      for (const karar of ['ettnEkle', 'mikrodaVar'] as const) {
        gunluk.length = 0;
        G.__faturaPgOnKanca = (sql: string, p: unknown[] | undefined) => { gunluk.push({ sql, p }); };
        const id = `kilit-${karar}-${cid}`;
        await belgeKoy('orders', id, { companyId: cid, orderNumber: `SIP-K-${karar}`, ...isaretli(karar === 'ettnEkle' ? 'gonderildi' : 'belirsiz') });
        const ETTN = ettnNo(karar === 'ettnEkle' ? 51 : 52);
        const r = karar === 'ettnEkle' ? await ettnEkle(YON, id, `{${ETTN.toLocaleUpperCase('tr-TR')}}`) : await varEttn(YON, id, ETTN);
        expect(r.s, `${karar}: ${r.metin}`).toBe(200);
        expect(dizi(), karar).toEqual(['BEGIN', 'KILIT', 'YAZ', 'COMMIT']);
        expect(gunluk.find(x => adim(x) === 'KILIT')?.p, karar).toEqual([cid, ETTN]);   // anahtar: kiracı + KÜÇÜK HARFLİ anahtar
        expect(gunluk.filter(x => adim(x) === 'BEGIN'), karar).toHaveLength(1);
        expect((await belgeOku('orders', id))?.ettn, karar).toBe(ETTN);
      }
      // ETTN'siz «Mikro'da var»: işlem açılmaz, kilit alınmaz (eski tek deyim).
      gunluk.length = 0;
      const yalin = `kilit-yalin-${cid}`;
      await belgeKoy('orders', yalin, { companyId: cid, orderNumber: 'SIP-K-Y', ...isaretli('belirsiz') });
      expect((await coz(YON, yalin, 'mikrodaVar', 'N-k1')).s).toBe(200);
      expect(gunluk.map(adim).filter(a => a !== 'BASKA')).toEqual([]);
      // UPDATE düşer → ROLLBACK, COMMIT yok, satır değişmez; ardından aynı istek temiz işlemle yazar.
      gunluk.length = 0;
      const dus = `kilit-dus-${cid}`;
      await belgeKoy('orders', dus, { companyId: cid, orderNumber: 'SIP-K-D', ...isaretli('gonderildi') });
      const once = await belgeOku('orders', dus);
      let dusur = true;
      G.__faturaPgOnKanca = (sql: string, p: unknown[] | undefined) => {
        gunluk.push({ sql, p });
        if (dusur && ETTN_YAZAN.test(sql)) { dusur = false; throw new Error('yazım düştü (sınama)'); }
      };
      const r1 = await ettnEkle(YON, dus, ettnNo(53));
      expect(r1.s, r1.metin).toBe(500);
      expect(dizi()).toEqual(['BEGIN', 'KILIT', 'YAZ', 'ROLLBACK']);
      expect(gunluk.some(x => adim(x) === 'COMMIT')).toBe(false);
      expect(await belgeOku('orders', dus)).toEqual(once);
      const r2 = await ettnEkle(YON, dus, ettnNo(53));
      expect([r2.s, r2.j.ettn], r2.metin).toEqual([200, ettnNo(53)]);
    } finally { G.__faturaPgOnKanca = undefined; }
  });

  it('409 FATURA_ETTN_DEGISTI — okumadan sonra ham ETTN araya giren yazımla değişti: karşılaştır-yaz tutmaz, değer EZİLMEZ', async () => {
    const id = await siparisKur({ ettn: 'eski-bozuk', ...isaretli('gonderildi') });
    let girdi = false;
    G.__faturaPgOnKanca = async (sql: string, p: unknown[] | undefined) => {
      if (!girdi && /^UPDATE docs SET data = data \|\| jsonb_build_object\('ettn'/.test(sql) && p?.[0] === id) {
        girdi = true;
        await pg().query("UPDATE docs SET data = data || '{\"ettn\":\"araya-giren\"}'::jsonb WHERE coll = 'orders' AND id = $1", [id]);
      }
    };
    try {
      const r = await ettnEkle(YONETICI, id, ettnNo(41));
      expect([r.s, r.j.kod, r.j.error], r.metin).toEqual([409, 'FATURA_ETTN_DEGISTI', 'Kayıt bu arada değişti; yenileyip yeniden deneyin.']);
      expect(girdi).toBe(true);
      expect((await belgeOku('orders', id))?.ettn).toBe('araya-giren');
    } finally { G.__faturaPgOnKanca = undefined; }
  });
});
