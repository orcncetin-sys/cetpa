// @vitest-environment node
/**
 * takipKoduVeLuca.zincir.test.ts — şartname `.wf/SARTNAME-takip-kodu-ve-luca-reddi.md` (2026-10-19), GERÇEK `server.ts` + GERÇEK
 * express zinciriyle: tahmin edilemez takip kodu (T1–T4, TA–TF) ve Cetpa'dan LUCA'ya fatura yollarının kapanışı (LA) + LUCA
 * işaretlerinin `/api/db` ile yazılamaması (LB). LB'nin e-Fatura talebi kolu (Mikro sahtesiyle) `faturaCiftKesim.zincir.test.ts`'te.
 *
 * NEDEN GERÇEK ZİNCİR: kod alma ucunun kapısı, takip ucunun iki yolu, e-posta ucunun sipariş okuması ve korunan alan listesi
 * «yazıldı ama bağlanmadı» sınıfındandır: saf testler (takipKodu.pglite.test, lib testleri) kuralı kanıtlar, bağlantıyı kanıtlamaz.
 * Düzenek `kucukKapanislar.zincir.test.ts` ile AYNI kalıptır.
 *
 * SAHTE OLANLAR (yalnız süreç dışına çıkanlar): Firebase belirteç doğrulayıcısı (belirteç = "<uid>|<e-posta>|<1|0>"), `pg`
 * havuzu (süreç içi PGlite; her sorgunun metni ve parametreleri kaydedilir), pg-boss, node-cron, vite, `dotenv` (hiçbir ortam
 * dosyası YÜKLENMEZ) ve dışarı giden `fetch` (kaydedilir, hiçbir yere gitmez). LUCA kimliği bu dosyada bilerek TANIMLI (sahte
 * değer): iki LUCA ucu 503'ü geçip kapanış yanıtına ulaşsın — LUCA'ya istek gitmediği `fetch` kaydından ölçülür. Canlıya,
 * Firebase'e, Mikro'ya, LUCA'ya istek YOK.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { STAFF_ROLES, type AppRole } from '../lib/rbac';
import { MAGAZA_KAYNAGI } from '../lib/magazaKaynagi';
import { MF_KAYNAGI } from '../lib/mfKaynagi';
import { TAKIP_KODU_BICIMI } from '../lib/takipKodu';
import { TAKIP_KODU_ARA_SQL, TAKIP_KODU_YAZ_SQL } from './takipKodu';
import { SUNUCU_TURETILEN_ALANLAR } from '../lib/collections';
import { FATURA_GONDERIM_ALANI } from '../lib/faturaGonderimi';
import { kodSatirlari } from '../test/kaynakTarama';

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
  g.__takipLucaPg = db;
  const kayit: Array<{ sql: string; p: unknown[] }> = [];
  g.__takipLucaSorgular = kayit;
  const q = async (text: unknown, params?: unknown[]) => {
    let sql = String(text); let p = params;
    if (text && typeof text === 'object') { const o = text as { text: string; values?: unknown[] }; sql = o.text; p = o.values; }
    kayit.push({ sql, p: p ?? [] });
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
interface Pg { query: (sql: string, p?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> }
const G = globalThis as Record<string, unknown>;
const pg = (): Pg => G.__takipLucaPg as Pg;
const sorgular = (): Array<{ sql: string; p: unknown[] }> => G.__takipLucaSorgular as Array<{ sql: string; p: unknown[] }>;

interface Katman { name?: string; method?: string; handle: (...a: unknown[]) => unknown; route?: { path: unknown; methods: Record<string, boolean>; stack: Katman[] } }
interface Uygulama { router: { stack: Katman[] } }

let sunucu: http.Server | undefined;
let uygulama: Uygulama | undefined;
let kapiNo = 0;
let yuklemeDizini = '';
const gercekFetch = globalThis.fetch;
const disari: Array<{ url: string; govde: string }> = [];

const KIRACI = 'CETPA';
const BASKA_KIRACI = 'BASKA-FIRMA';
const LUCA_ADRESI = /luca/i;
const eposta = (uid: string): string => `${uid.toLowerCase()}@example.test`;
const belirtec = (uid: string): Record<string, string> => ({ Authorization: `Bearer ${uid}|${eposta(uid)}|1` });
const icUid = (rol: AppRole): string => `ic-${rol}`;
const ic = (rol: AppRole): Record<string, string> => belirtec(icUid(rol));
const BAYI = belirtec('dis-bayi');
const YABANCI = belirtec('yabanci-Admin');

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
  while (Date.now() < son) { if (await kosul()) return; await new Promise(r => setTimeout(r, 50)); }
  throw new Error(`beklenen olmadı (${ms} ms): ${ne}`);
};
const belgeKoy = (coll: string, id: string, data: Record<string, unknown>): Promise<unknown> =>
  pg().query('INSERT INTO docs (coll, id, data) VALUES ($1, $2, $3::jsonb) ON CONFLICT (coll, id) DO UPDATE SET data = EXCLUDED.data', [coll, id, JSON.stringify(data)]);
const belgeOku = async (coll: string, id: string): Promise<Record<string, unknown> | undefined> =>
  (await pg().query('SELECT data FROM docs WHERE coll = $1 AND id = $2', [coll, id])).rows[0]?.data as Record<string, unknown> | undefined;

/** Rota dökümü (gerçek yönlendiriciden). */
function rotalar(): Array<{ yontem: string; desen: string; adlar: string[] }> {
  if (!uygulama) throw new Error('uygulama yakalanmadı');
  const cikti: Array<{ yontem: string; desen: string; adlar: string[] }> = [];
  const gez = (yigin: Katman[]): void => {
    for (const k of yigin) {
      const alt = (k.handle as unknown as { stack?: Katman[] }).stack;
      if (!k.route) { if (Array.isArray(alt)) gez(alt); continue; }
      const yollar = Array.isArray(k.route.path) ? k.route.path : [k.route.path];
      for (const y of yollar) for (const [m, acik] of Object.entries(k.route.methods)) {
        if (!acik || typeof y !== 'string') continue;
        cikti.push({ yontem: m.toUpperCase(), desen: y, adlar: k.route.stack.filter(s => !s.method || s.method === m).map(s => s.name || '(adsız)') });
      }
    }
  };
  gez(uygulama.router.stack);
  return cikti;
}

// ── Sipariş tohumları ──────────────────────────────────────────────────────────────────────────────────────────────────────
/** Eski bağlantının rastgele doküman kimliği (genDocId / istemci kimliği biçimi: 20 karakter, `__` yok). */
const ESKI_ID = 'Ab12Cd34Ef56Gh78Ij90';
const MF_ID = `mikrofat__${KIRACI}__CTP-77`;
const MAGAZA_ID = 'MagazaDuz00000000001';
const SIPARIS = {
  customerName: 'Orçun Çetin', status: 'Shipped', trackingNumber: 'YK-123456', orderNumber: 'S-1001',
  shippingAddress: 'Atatürk Cad. No:5, Muratpaşa, Antalya', estimatedDelivery: '2026-10-22',
  customerEmail: 'musteri@example.test', totalPrice: 1950,
  lineItems: [{ name: 'DYO Boya 15 L', sku: 'DYO-001', quantity: 2, price: 812.5 }],
  createdAt: { _seconds: 1760860800, _nanoseconds: 0 }, companyId: KIRACI,
};
let siparisSayaci = 0;
const yeniSiparis = async (ek: Record<string, unknown> = {}): Promise<string> => {
  siparisSayaci++;
  const id = `Yeni${String(siparisSayaci).padStart(16, '0')}`;
  await belgeKoy('orders', id, { ...SIPARIS, orderNumber: `S-${2000 + siparisSayaci}`, ...ek });
  return id;
};
const kodAl = (b: Record<string, string>, id: string): Promise<Yanit> => istek('POST', `/api/siparis/${encodeURIComponent(id)}/takip-kodu`, b);
/**
 * Kod doküman kimliğinden TÜRETİLMEZ (şartname mutasyonu «kodu doğrudan kimlikten türet»): kimliğin (harf-rakam kısmının) hiçbir
 * 6 karakterlik parçası kodda geçmez. Rastgele 22 karakterlik kodda belirli bir 6'lının geçme olasılığı ~17 / 62^6 ≈ 3·10⁻¹⁰.
 */
const kimliktenTuremedi = (kod: string, id: string): void => {
  const s = id.replace(/[^0-9A-Za-z]/g, '');
  for (let i = 0; i + 6 <= s.length; i++) expect(kod, `kod kimlikten türetilmiş (${id} → «${s.slice(i, i + 6)}»)`).not.toContain(s.slice(i, i + 6));
};
const takip = (parametre: string): Promise<Yanit> => istek('GET', `/api/track/${encodeURIComponent(parametre)}`);

beforeAll(async () => {
  yuklemeDizini = fs.mkdtempSync(path.join(os.tmpdir(), 'takip-luca-'));
  process.env.PORT = '0';
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgres://sinama/yok';
  process.env.SESSION_TOKEN_SECRET = 'sinama-sirri';
  process.env.UPLOAD_DIR = yuklemeDizini;
  process.env.SUPER_ADMIN_EMAILS = 'super@example.test';
  for (const ad of Object.keys(process.env)) {
    if (/^(STRIPE|RESEND|LUCA|SHOPIFY|SMTP|GEMINI|ANTHROPIC|MIKRO|IYZICO|TRENDYOL|HEPSIBURADA|DHL|UPS|FEDEX|YURTICI|MNG|ARAS|WHATSAPP|FIREBASE|GOOGLE_APPLICATION|OPS_|SERVER_TENANT_)/.test(ad)) delete process.env[ad];
  }
  // LUCA kimliği bu dosyada bilerek TANIMLI (sahte): iki fatura ucu 503'ü geçip kapanış yanıtına ulaşır. Modül yüklenirken okunur.
  process.env.LUCA_API_KEY = 'sinama-luca-anahtari';
  process.env.LUCA_COMPANY_ID = 'sinama-luca-firma';
  globalThis.fetch = (async (girdi: unknown, init?: RequestInit) => {
    const url = String(typeof girdi === 'string' ? girdi : (girdi as { url?: string }).url ?? girdi);
    disari.push({ url, govde: typeof init?.body === 'string' ? init.body : '' });
    return new Response('{"id":"posta-1"}', { status: 200, headers: { 'content-type': 'application/json' } });
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
    const r = await pg().query("SELECT to_regclass('docs') AS d, to_regclass('mfa_secrets') AS m, to_regclass('docs_orders_takip_kodu') AS t");
    const t = r.rows[0]; return !!(t.d && t.m && t.t);
  }, 60_000, 'tablolar ve takip kodu dizini hazır');

  for (const rol of STAFF_ROLES) await belgeKoy('users', icUid(rol), { email: eposta(icUid(rol)), role: rol, companyId: KIRACI });
  await belgeKoy('users', 'dis-bayi', { email: eposta('dis-bayi'), role: 'Dealer', companyId: KIRACI });
  await belgeKoy('users', 'yabanci-Admin', { email: eposta('yabanci-Admin'), role: 'Admin', companyId: BASKA_KIRACI });
  await belgeKoy('orders', ESKI_ID, SIPARIS);
  await belgeKoy('orders', MF_ID, { ...SIPARIS, orderNumber: 'MF-CTP77', source: MF_KAYNAGI, mikroFaturaNo: 'CTP-77' });
  await belgeKoy('orders', MAGAZA_ID, { ...SIPARIS, orderNumber: '#1042', source: MAGAZA_KAYNAGI });
  await belgeKoy('orders', 'baska-siparis', { ...SIPARIS, companyId: BASKA_KIRACI });
}, 240_000);

afterAll(async () => {
  globalThis.fetch = gercekFetch;
  delete process.env.LUCA_API_KEY;
  delete process.env.LUCA_COMPANY_ID;
  const s = sunucu;
  if (s) { s.closeAllConnections(); await new Promise<void>(r => s.close(() => r())); }
  if (yuklemeDizini) fs.rmSync(yuklemeDizini, { recursive: true, force: true });
}, 30_000);

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('T2 / TB — `POST /api/siparis/:orderId/takip-kodu`', () => {
  it('zincir: kimlik → MFA → personel → `orders` okuma; uç tam bir kez kayıtlı', () => {
    const u = rotalar().filter(r => r.yontem === 'POST' && r.desen === '/api/siparis/:orderId/takip-kodu');
    expect(u).toHaveLength(1);
    expect(u[0].adlar.slice(0, 3)).toEqual(['requireAuth', 'requireMfaVerified', 'requireStaff']);
    expect(u[0].adlar).toHaveLength(5);   // + koleksiyon kuralı (adsız kapanış) + işleyici
  });

  it('kod yoksa yazılır (22 karakter base62), varsa AYNI kod döner; denetim satırı YAZILMAZ', async () => {
    const id = await yeniSiparis();
    const denetimOnce = Number((await pg().query("SELECT count(*)::int AS n FROM docs WHERE coll = 'auditLog'")).rows[0].n);
    const r1 = await kodAl(ic('Sales'), id);
    expect([r1.s, r1.j.success], r1.metin).toEqual([200, true]);
    const kod = String(r1.j.takipKodu);
    expect(kod).toMatch(TAKIP_KODU_BICIMI);
    kimliktenTuremedi(kod, id);
    expect((await belgeOku('orders', id))?.takipKodu).toBe(kod);
    const r2 = await kodAl(ic('Admin'), id);
    expect([r2.s, r2.j.takipKodu]).toEqual([200, kod]);
    expect(Object.keys(r2.j).sort()).toEqual(['success', 'takipKodu']);
    expect(Number((await pg().query("SELECT count(*)::int AS n FROM docs WHERE coll = 'auditLog'")).rows[0].n)).toBe(denetimOnce);
  });

  it('eşzamanlı iki istek AYNI kodu alır; satırda tek kod', async () => {
    const id = await yeniSiparis();
    const [a, b] = await Promise.all([kodAl(ic('Sales'), id), kodAl(ic('Logistics'), id)]);
    expect([a.s, b.s]).toEqual([200, 200]);
    expect(a.j.takipKodu).toMatch(TAKIP_KODU_BICIMI);
    expect(b.j.takipKodu).toBe(a.j.takipKodu);
    expect((await belgeOku('orders', id))?.takipKodu).toBe(a.j.takipKodu);
  });

  it('kapı: dış rol 403 (boğaz); `orders` okuma yetkisi olmayan iç rol 403; başka kiracı 404; mağaza 400; olmayan 404 — hiçbirinde kod yazılmaz', async () => {
    const id = await yeniSiparis();
    const bayi = await kodAl(BAYI, id);
    expect([bayi.s, bayi.j.code]).toEqual([403, 'DIS_ROL']);
    for (const rol of ['HR', 'Quality', 'Legal', 'Corporate'] as AppRole[]) {
      const r = await kodAl(ic(rol), id);
      expect([rol, r.s, r.j]).toEqual([rol, 403, { error: 'Bu veri için yetkiniz yok.' }]);
    }
    const sorguOnce = sorgular().length;
    const yabanci = await kodAl(YABANCI, id);
    expect([yabanci.s, yabanci.j]).toEqual([404, { success: false, error: 'Sipariş bulunamadı.' }]);
    // Ret `siparisGorebilir`'den; koşullu yazıma (ikinci çit) hiç gelinmez.
    expect(sorgular().slice(sorguOnce).filter(q => q.sql === TAKIP_KODU_YAZ_SQL)).toEqual([]);
    const baskasi = await kodAl(ic('Admin'), 'baska-siparis');
    expect([baskasi.s, baskasi.j]).toEqual([404, { success: false, error: 'Sipariş bulunamadı.' }]);
    const magaza = await kodAl(ic('Admin'), MAGAZA_ID);
    expect([magaza.s, magaza.j.success]).toEqual([400, false]);
    expect(String(magaza.j.error)).toMatch(/mağaza/);
    const yok = await kodAl(ic('Admin'), 'OlmayanSiparis000001');
    expect([yok.s, yok.j]).toEqual([404, { success: false, error: 'Sipariş bulunamadı.' }]);
    for (const k of [id, 'baska-siparis', MAGAZA_ID]) expect(await belgeOku('orders', k), k).not.toHaveProperty('takipKodu');
    expect(await belgeOku('orders', 'OlmayanSiparis000001')).toBeUndefined();
  });

  it('`orders` okuma kuralından geçen her iç rol kod alabilir (Muhasebe, Satın Alma dâhil)', async () => {
    for (const rol of ['Admin', 'Manager', 'Sales', 'Logistics', 'Accounting', 'Purchasing'] as AppRole[]) {
      const r = await kodAl(ic(rol), ESKI_ID);
      expect([rol, r.s]).toEqual([rol, 200]);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('TA / LB — `/api/db` ile `takipKodu` ve LUCA işaretleri yazılamaz (beş yol + artırma; rolden bağımsız, sessiz)', () => {
  const KORUNAN = ['takipKodu', 'lucaSynced', 'lucaFaturaNo', 'lucaSyncedAt'] as const;
  /** Tohum değerleri; kod küresel tekil (dizin) — her tur kendi kodunu taşır. */
  const tohum = (tur: number): Record<(typeof KORUNAN)[number], unknown> => ({
    takipKodu: `Tohum1Kod2Takip3Abc45${tur}`, lucaSynced: true, lucaFaturaNo: 'LF-2026-0001', lucaSyncedAt: '2026-10-01T09:00:00.000Z',
  });
  const YENI: Record<(typeof KORUNAN)[number], unknown> = {
    takipKodu: 'Saldirgan1Kod2Bilin3Xy', lucaSynced: false, lucaFaturaNo: '', lucaSyncedAt: '2020-01-01T00:00:00.000Z',
  };

  it('korunan liste: işaret + ETTN + takip kodu + üç LUCA alanı (tek kaynak)', () => {
    expect(SUNUCU_TURETILEN_ALANLAR.get('orders')).toEqual([FATURA_GONDERIM_ALANI, 'ettn', 'takipKodu', 'lucaSynced', 'lucaFaturaNo', 'lucaSyncedAt']);
  });

  it('POST yeni kayda yazmaz; PUT / PUT?merge=1 / PATCH (nokta yolu, null, tünel) / cas satırdaki değeri DEĞİŞTİRMEZ; artırma 400 — Yönetici dâhil', async () => {
    for (const [tur, b] of [ic('Sales'), ic('Admin')].entries()) {
      const TOHUM = tohum(tur);
      const p = await istek('POST', '/api/db/orders', b, { customerName: 'Yeni', ...YENI });
      expect(p.s, p.metin).toBe(200);
      const yeni = await belgeOku('orders', String(p.j.id));
      for (const a of KORUNAN) expect(yeni, a).not.toHaveProperty(a);

      const id = await yeniSiparis({ status: 'Processing', ...TOHUM });
      const korundu = async (adim: string): Promise<void> => {
        const d = await belgeOku('orders', id);
        for (const a of KORUNAN) expect(d?.[a], `${adim} — ${a}`).toEqual(TOHUM[a]);
      };
      expect((await istek('PUT', `/api/db/orders/${id}`, b, { ...SIPARIS, status: 'Processing', notes: 'put', ...YENI })).s).toBe(200);
      await korundu('PUT');
      expect((await istek('PUT', `/api/db/orders/${id}`, b, { ...SIPARIS, status: 'Processing', notes: 'put-yok' })).s).toBe(200);
      await korundu('PUT (alan yok)');
      expect((await istek('PUT', `/api/db/orders/${id}?merge=1`, b, { notes: 'merge', takipKodu: null, lucaSynced: null, lucaFaturaNo: null, lucaSyncedAt: null })).s).toBe(200);
      await korundu('PUT?merge=1');
      for (const yama of [YENI, { takipKodu: null, lucaSynced: null, lucaFaturaNo: null, lucaSyncedAt: null }, { 'takipKodu.x': 'y', 'lucaFaturaNo.x': 'y' }] as Array<Record<string, unknown>>) {
        expect((await istek('PATCH', `/api/db/orders/${id}`, b, { ...yama, notes: 'patch' })).s).toBe(200);
        await korundu(`PATCH ${JSON.stringify(yama)}`);
        expect((await istek('POST', `/api/db/orders/${id}`, { ...b, 'X-Cetpa-Method': 'PATCH' }, { ...yama, notes: 'tunel' })).s).toBe(200);
        await korundu(`tünel ${JSON.stringify(yama)}`);
      }
      const c = await istek('PATCH', `/api/db/orders/${id}/cas`, b, { field: 'status', expect: 'Processing', set: { ...YENI, notes: 'cas' } });
      expect([c.s, c.j.claimed], c.metin).toEqual([200, true]);
      await korundu('cas');
      expect((await belgeOku('orders', id))?.notes).toBe('cas');
      for (const a of KORUNAN) expect((await istek('PATCH', `/api/db/orders/${id}/increment`, b, { field: a, delta: 1 })).s, a).toBe(400);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('T3 / TC — `GET /api/track/:orderId`: takip kodu YA DA eski rastgele kimlik', () => {
  const YOK = { success: false, error: 'Sipariş bulunamadı.' };

  it('kodla 200: maskeli alanlar aynen; yanıtta doküman kimliği, kiracı, `mikrofat__` ve kodun ilk 8 karakteri GEÇMEZ; `id` alanı yok', async () => {
    const kod = String((await kodAl(ic('Sales'), ESKI_ID)).j.takipKodu);
    const r = await takip(kod);
    expect(r.s, r.metin).toBe(200);
    expect(r.j).toEqual({
      success: true,
      order: {
        orderNo: 'S-1001', customerName: 'Orçun Ç.', status: 'Shipped', trackingNumber: 'YK-123456',
        shippingAddress: 'Muratpaşa, Antalya', estimatedDelivery: '2026-10-22',
        lineItems: [{ name: 'DYO Boya 15 L', quantity: 2, price: 812.5 }],
        updatedAt: null, createdAt: '2025-10-19T08:00:00.000Z',
      },
    });
    for (const sizinti of [ESKI_ID, KIRACI, 'mikrofat__', kod.slice(0, 8), 'musteri@example.test', 'Atatürk']) expect(r.metin, sizinti).not.toContain(sizinti);
  });

  it('MF siparişi kodla: `orderNo` = `MF-…` (görünen numara); MF kimliği / kiracı / fatura sırası yanıtta YOK', async () => {
    const kod = String((await kodAl(ic('Accounting'), MF_ID)).j.takipKodu);
    expect(kod).toMatch(TAKIP_KODU_BICIMI);
    kimliktenTuremedi(kod, MF_ID);
    const r = await takip(kod);
    expect(r.s, r.metin).toBe(200);
    expect((r.j.order as Record<string, unknown>).orderNo).toBe('MF-CTP77');
    expect(r.j.order).not.toHaveProperty('id');
    for (const sizinti of [MF_ID, 'mikrofat__', KIRACI, 'CTP-77', kod.slice(0, 8)]) expect(r.metin, sizinti).not.toContain(sizinti);
  });

  it('görünen numarası olmayan siparişte kod yolu `orderNo: null` (kimlikten türetilmez); `shopifyOrderId` sayıysa metin', async () => {
    const id1 = await yeniSiparis({ orderNumber: undefined });
    const k1 = String((await kodAl(ic('Sales'), id1)).j.takipKodu);
    expect((await takip(k1)).j.order).toMatchObject({ orderNo: null });
    const id2 = await yeniSiparis({ orderNumber: '  ', shopifyOrderId: 5012 });
    const k2 = String((await kodAl(ic('Sales'), id2)).j.takipKodu);
    expect((await takip(k2)).j.order).toMatchObject({ orderNo: '5012' });
  });

  it('`mikrofat__…` (ve her `__`) kimliğiyle doğrudan okuma → 404, gövde «yok» ile BİREBİR; veritabanına SORULMAZ', async () => {
    const yok = await takip('OlmayanSiparis000002');
    expect([yok.s, yok.j]).toEqual([404, YOK]);
    const once = sorgular().length;
    for (const p of [MF_ID, 'shopify__abc', 'a__b']) {
      const r = await takip(p);
      expect([p, r.s, r.metin]).toEqual([p, 404, yok.metin]);
    }
    const sonra = sorgular().slice(once);
    expect(sonra.filter(q => q.p.some(v => typeof v === 'string' && v.includes('__')) && /FROM docs/.test(q.sql)), 'kimlikle okuma').toEqual([]);
    expect(sonra.filter(q => q.sql === TAKIP_KODU_ARA_SQL), 'kodla arama').toEqual([]);
  });

  it('eski rastgele kimlikle 200 — gövde 2026-10-19 öncesiyle BİREBİR (anlık görüntü, metin olarak)', async () => {
    const r = await takip(ESKI_ID);
    expect(r.s).toBe(200);
    expect(r.metin).toBe(JSON.stringify({
      success: true,
      order: {
        id: ESKI_ID, orderNo: 'AB12CD34', customerName: 'Orçun Ç.', status: 'Shipped', trackingNumber: 'YK-123456',
        shippingAddress: 'Muratpaşa, Antalya', estimatedDelivery: '2026-10-22',
        lineItems: [{ name: 'DYO Boya 15 L', quantity: 2, price: 812.5 }],
        updatedAt: null, createdAt: '2025-10-19T08:00:00.000Z',
      },
    }));
  });

  it('biçime uymayan parametre (eski 20 karakterlik kimlik) kod olarak SORULMAZ; biçime uyan kod TEK SQL ile aranır (koleksiyon taraması yok)', async () => {
    let once = sorgular().length;
    expect((await takip(ESKI_ID)).s).toBe(200);
    expect(sorgular().slice(once).filter(q => q.sql === TAKIP_KODU_ARA_SQL)).toEqual([]);
    const kod = String((await kodAl(ic('Sales'), ESKI_ID)).j.takipKodu);
    once = sorgular().length;
    expect((await takip(kod)).s).toBe(200);
    const sonra = sorgular().slice(once);
    expect(sonra.filter(q => q.sql === TAKIP_KODU_ARA_SQL).map(q => q.p)).toEqual([[kod]]);
    // pgShim `where` / koleksiyon dökümü (`SELECT … WHERE coll = $1` süzgeçsiz) YOK; doküman kimliğiyle ikinci okuma da yok.
    expect(sonra.filter(q => /FROM docs WHERE coll = \$1(\s|$)(?!AND id)/.test(q.sql))).toEqual([]);
    expect(sonra.filter(q => q.p.includes(ESKI_ID))).toEqual([]);
  });

  it('mağaza siparişi İKİ yolda da 404 (gövde «yok» ile aynı); olmayan kod 404', async () => {
    const eski = await takip(MAGAZA_ID);
    expect([eski.s, eski.j]).toEqual([404, YOK]);
    // Kod yolu: mağaza siparişine kod alınamaz (400) — satıra doğrudan konmuş bir kod da gösterilmez.
    const d = await belgeOku('orders', MAGAZA_ID);
    await belgeKoy('orders', MAGAZA_ID, { ...d, takipKodu: 'Magaza1Kod2Dogrudan3Xy' });
    const kodla = await takip('Magaza1Kod2Dogrudan3Xy');
    expect([kodla.s, kodla.j]).toEqual([404, YOK]);
    const olmayan = await takip('Olmayan1Kod2Takip3Abcd');
    expect([olmayan.s, olmayan.j]).toEqual([404, YOK]);
  });

  it('rota adı `:orderId` ve hız sınırlayıcı aynen (çitler)', () => {
    const u = rotalar().filter(r => r.yontem === 'GET' && r.desen === '/api/track/:orderId');
    expect(u).toHaveLength(1);
    expect(u[0].adlar).toHaveLength(2);   // trackLimiter + işleyici — kimlik kapısı YOK
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('TF — `/api/email/order-notification`: siparişi okur, bağlantı takip kodunu taşır', () => {
  const postalar = (once: number) => disari.slice(once).filter(d => d.url === 'https://api.resend.com/emails')
    .map(d => JSON.parse(d.govde) as { to: string[]; subject: string; html: string });
  const gonder = async (b: Record<string, string>, orderId: string, ek: Record<string, unknown> = {}) => {
    process.env.RESEND_API_KEY = 'sinama-resend-anahtari';
    const once = disari.length;
    try {
      const r = await istek('POST', '/api/email/order-notification', b, { orderId, status: 'Shipped', customerEmail: 'musteri@example.test', customerName: 'Orçun Çetin', ...ek });
      return { r, posta: postalar(once) };
    } finally { delete process.env.RESEND_API_KEY; }
  };
  /** E-postanın «SİPARİŞ NO» bloğundaki numara (`#…`); blok yoksa `null`. */
  const postadakiNo = (html: string): string | null =>
    html.match(/font-family:monospace;">#([^<]*)<\/p>/)?.[1] ?? null;
  const postadakiKod = (html: string): string => {
    const m = html.match(/\/\?track=([0-9A-Za-z]{22})"/);
    if (!m) throw new Error('e-postada takip bağlantısı yok');
    return m[1];
  };

  it('bağlantı `?track=<takip kodu>`; doküman kimliği bağlantıda YOK; kod siparişe yazılır ve kod alma ucuyla AYNI', async () => {
    const id = await yeniSiparis();
    const { r, posta } = await gonder(ic('Sales'), id);
    expect(r.s, r.metin).toBe(200);
    expect(posta).toHaveLength(1);
    const kod = (await belgeOku('orders', id))?.takipKodu;
    expect(kod).toMatch(TAKIP_KODU_BICIMI);
    kimliktenTuremedi(String(kod), id);
    expect(posta[0].html).toContain(`/?track=${String(kod)}"`);
    expect(posta[0].html).not.toContain(`?track=${id}`);
    expect((await kodAl(ic('Sales'), id)).j.takipKodu).toBe(kod);
  });

  it('MF siparişinde bağlantı MF kimliğini taşımaz', async () => {
    const { r, posta } = await gonder(ic('Sales'), MF_ID);
    expect(r.s, r.metin).toBe(200);
    expect(posta[0].html).not.toContain(encodeURIComponent(MF_ID));
    expect(posta[0].html).not.toContain(MF_ID);
    expect(posta[0].html).toMatch(/\/\?track=[0-9A-Za-z]{22}"/);
  });

  it('MF siparişi: konu ve «SİPARİŞ NO» `#MF-…` — `MIKROFAT` / `mikrofat` HİÇBİR yerde yok (kimliğin ilk 8 karakteri basılmaz)', async () => {
    for (const lang of ['tr', 'en'] as const) {
      const { r, posta } = await gonder(ic('Sales'), MF_ID, { lang });
      expect(r.s, r.metin).toBe(200);
      expect(posta).toHaveLength(1);
      expect(postadakiNo(posta[0].html), lang).toBe('MF-CTP77');
      expect(posta[0].subject, lang).toBe(lang === 'tr' ? 'Siparişiniz güncellendi: Kargoya Verildi — #MF-CTP77' : 'Order update: Shipped — #MF-CTP77');
      expect(posta[0].html).toContain(lang === 'tr' ? 'SİPARİŞ NO' : 'ORDER NO');
      for (const alan of [posta[0].subject, posta[0].html]) expect(alan, lang).not.toMatch(/mikrofat/i);
    }
  });

  it('istemcinin gönderdiği `orderNo` OKUNMAZ — numara siparişten (`orderNumber`); konu ve blok aynı numara', async () => {
    const id = await yeniSiparis();
    const kayitNo = String((await belgeOku('orders', id))?.orderNumber);
    const { r, posta } = await gonder(ic('Sales'), id, { orderNo: 'ISTEMCI-99' });
    expect(r.s, r.metin).toBe(200);
    expect(postadakiNo(posta[0].html)).toBe(kayitNo);
    expect(posta[0].subject).toBe(`Siparişiniz güncellendi: Kargoya Verildi — #${kayitNo}`);
    for (const alan of [posta[0].subject, posta[0].html]) expect(alan).not.toContain('ISTEMCI-99');
  });

  it('görünen numarası olmayan sipariş: «SİPARİŞ NO» bloğu YOK, konu numarasız; kimlikten numara türetilmez (istemci `orderNo` gönderse de)', async () => {
    const id = await yeniSiparis({ orderNumber: undefined });
    for (const [lang, ek] of [['tr', {}], ['en', { orderNo: 'ISTEMCI-98' }]] as const) {
      const { r, posta } = await gonder(ic('Sales'), id, { lang, ...ek });
      expect(r.s, r.metin).toBe(200);
      expect(posta).toHaveLength(1);
      expect(posta[0].html, lang).not.toContain('SİPARİŞ NO');
      expect(posta[0].html, lang).not.toContain('ORDER NO');
      expect(postadakiNo(posta[0].html), lang).toBeNull();
      expect(posta[0].subject, lang).toBe(lang === 'tr' ? 'Siparişiniz güncellendi: Kargoya Verildi' : 'Order update: Shipped');
      for (const alan of [posta[0].subject, posta[0].html]) {
        expect(alan, lang).not.toContain(id.slice(0, 8));
        expect(alan, lang).not.toContain(id.slice(0, 8).toUpperCase());
        expect(alan, lang).not.toContain('ISTEMCI-98');
      }
      // Bağlantı yine kodla gider (numara yok diye bağlantı düşmez).
      expect(postadakiKod(posta[0].html)).toMatch(TAKIP_KODU_BICIMI);
    }
  });

  it('e-postadaki numara = bağlantının açtığı takip sayfasındaki `orderNo` (BİREBİR): MF, düz, sayısal `shopifyOrderId`', async () => {
    const duz = await yeniSiparis();
    const sayisal = await yeniSiparis({ orderNumber: '  ', shopifyOrderId: 5013 });
    for (const id of [MF_ID, duz, sayisal]) {
      const { r, posta } = await gonder(ic('Sales'), id);
      expect(r.s, r.metin).toBe(200);
      const t = await takip(postadakiKod(posta[0].html));
      expect(t.s, t.metin).toBe(200);
      const sayfaNo = (t.j.order as Record<string, unknown>).orderNo;
      expect(typeof sayfaNo, id).toBe('string');
      expect(postadakiNo(posta[0].html), id).toBe(sayfaNo);
      expect(posta[0].subject.endsWith(` — #${String(sayfaNo)}`), `${id}: ${posta[0].subject}`).toBe(true);
    }
  });

  it('numara kuralı TEK tanım: `gorunenTakipNo` yalnız lib/takipKodu\'da; server.ts ve e-posta ucu onu içe aktarır (kopya yok)', () => {
    const kok = path.join(__dirname, '..', '..');
    const kaynak = (y: string): string => fs.readFileSync(path.join(kok, y), 'utf8');
    const tanimlar = ['server.ts', 'src/server/routes/epostaRoutes.ts', 'src/lib/takipKodu.ts']
      .filter(y => /function gorunenTakipNo\(/.test(kaynak(y)));
    expect(tanimlar).toEqual(['src/lib/takipKodu.ts']);
    expect(kaynak('server.ts')).toMatch(/import \{[^}]*\bgorunenTakipNo\b[^}]*\} from '\.\/src\/lib\/takipKodu\.js';/);
    expect(kaynak('src/server/routes/epostaRoutes.ts')).toMatch(/import \{ gorunenTakipNo \} from '\.\.\/\.\.\/lib\/takipKodu\.js';/);
    // E-posta ucu numarayı istemci gövdesinden ya da kimlikten kurmaz (yorumlar hariç).
    const epostaKodu = kodSatirlari(path.join(kok, 'src/server/routes/epostaRoutes.ts')).map(k => k.kod).join('\n');
    expect(epostaKodu).not.toMatch(/orderId\.slice\(|\borderNo\b(?!\?: string)/);
  });

  it('başka kiracının siparişi / olmayan sipariş → 404 ve e-posta GİTMEZ, kod yazılmaz — erişim denetimi kod işlevinden ÖNCE (yazım sorgusu yok)', async () => {
    for (const [b, id] of [[ic('Sales'), 'baska-siparis'], [YABANCI, ESKI_ID], [ic('Sales'), 'OlmayanSiparis000003']] as const) {
      const once = (await belgeOku('orders', id))?.takipKodu;
      const sorguOnce = sorgular().length;
      const { r, posta } = await gonder(b, id);
      expect([id, r.s, r.j]).toEqual([id, 404, { success: false, error: 'Sipariş bulunamadı.' }]);
      expect(posta, id).toEqual([]);
      expect((await belgeOku('orders', id))?.takipKodu, id).toBe(once);
      // `siparisGorebilir` ret verir; `takipKoduAlVeyaUret`'in SQL kiracı koşulu yalnız ikinci çittir (ona hiç gelinmez).
      expect(sorgular().slice(sorguOnce).filter(q => q.sql === TAKIP_KODU_YAZ_SQL), id).toEqual([]);
    }
  });

  it('mağaza siparişinde e-postada takip bağlantısı YOK (eskiden ölü bağlantı gidiyordu); kod üretilmez', async () => {
    const id = await yeniSiparis({ source: MAGAZA_KAYNAGI });
    const { r, posta } = await gonder(ic('Sales'), id);
    expect(r.s, r.metin).toBe(200);
    expect(posta).toHaveLength(1);
    expect(posta[0].html).not.toContain('?track=');
    expect(posta[0].html).not.toContain('Siparişimi Takip Et');
    expect(await belgeOku('orders', id)).not.toHaveProperty('takipKodu');
  });

  it('kapı kod alma ucuyla eşdeğer: `orders` okuma yetkisi olmayan iç rol 403; `orderId` yoksa 400 — e-posta gitmez', async () => {
    const { r, posta } = await gonder(ic('HR'), ESKI_ID);
    expect([r.s, r.j]).toEqual([403, { error: 'Bu veri için yetkiniz yok.' }]);
    expect(posta).toEqual([]);
    process.env.RESEND_API_KEY = 'sinama-resend-anahtari';
    try {
      const once = disari.length;
      const bos = await istek('POST', '/api/email/order-notification', ic('Sales'), { status: 'Shipped', customerEmail: 'musteri@example.test' });
      expect(bos.s).toBe(400);
      expect(postalar(once)).toEqual([]);
    } finally { delete process.env.RESEND_API_KEY; }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('LA — Cetpa\'dan LUCA\'ya fatura gönderen iki yol kapalı (kapı ve 503 önde; ardından 400; LUCA\'ya istek YOK)', () => {
  const KAPALI = { success: false, kod: 'LUCA_FATURA_KAPALI', error: "Fatura Mikro'dan kesilir ve LUCA'ya Mikro'dan aktarılır; Cetpa'dan LUCA'ya fatura gönderilmez." };
  const lucaIstekleri = (once: number) => disari.slice(once).filter(d => LUCA_ADRESI.test(d.url));

  it('iki uç KAYITLI, kapıları aynen (kimlik → MFA → `invoices` yazma)', () => {
    for (const desen of ['/api/luca/sync/fatura', '/api/luca/fatura-gonder']) {
      const u = rotalar().filter(r => r.yontem === 'POST' && r.desen === desen);
      expect(u, desen).toHaveLength(1);
      expect(u[0].adlar.slice(0, 2), desen).toEqual(['requireAuth', 'requireMfaVerified']);
    }
  });

  it('`/api/luca/sync/fatura`: düz Cetpa siparişi, MF, Mikro faturalı, mağaza, olmayan — hepsi 400 KAPALI; LUCA fetch 0; sipariş değişmez', async () => {
    const duz = await yeniSiparis();
    const faturali = await yeniSiparis({ mikroFaturaNo: 'CTP2026000000999' });
    for (const id of [duz, MF_ID, faturali, MAGAZA_ID, 'OlmayanSiparis000004', '']) {
      const onceBelge = await belgeOku('orders', id);
      const once = disari.length;
      const r = await istek('POST', '/api/luca/sync/fatura', ic('Accounting'), { orderId: id });
      expect([id, r.s, r.j]).toEqual([id, 400, KAPALI]);
      expect(lucaIstekleri(once), id).toEqual([]);
      expect(await belgeOku('orders', id), id).toEqual(onceBelge);
    }
  });

  it('`/api/luca/fatura-gonder`: gövde ne olursa olsun 400 KAPALI; LUCA fetch 0', async () => {
    for (const govde of [{ invoiceId: 'f-1', invoiceData: { faturaNo: 'CTP-1', customerName: 'Şirin Yapı', totalPrice: 3600 } }, {}, { invoiceId: 'f-2' }]) {
      const once = disari.length;
      const r = await istek('POST', '/api/luca/fatura-gonder', ic('Accounting'), govde);
      expect([r.s, r.j]).toEqual([400, KAPALI]);
      expect(lucaIstekleri(once)).toEqual([]);
    }
  });

  it('kapı önde kalır: `invoices` yazma yetkisi olmayan iç rol 403, dış rol 403 — kapanış iletisi görülmez', async () => {
    for (const yol of ['/api/luca/sync/fatura', '/api/luca/fatura-gonder']) {
      const satis = await istek('POST', yol, ic('Sales'), { orderId: ESKI_ID });
      expect([yol, satis.s, satis.j]).toEqual([yol, 403, { error: 'Bu veri için yetkiniz yok.' }]);
      expect((await istek('POST', yol, BAYI, { orderId: ESKI_ID })).s).toBe(403);
    }
  });
});
