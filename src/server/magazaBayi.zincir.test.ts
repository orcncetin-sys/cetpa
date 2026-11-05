// @vitest-environment node
/**
 * magazaBayi.zincir.test.ts — müşteri / bayi ekranı «Siparişlerim» (www.cetpa.com.tr/bayi.html), GERÇEK `server.ts` + GERÇEK
 * express zinciri + PGlite (2026-10-21, şartname `.wf/SARTNAME-musteri-siparislerim.md` Tur 1: H1–H15).
 *
 * NEDEN GERÇEK ZİNCİR: köprünün her parçası (kimlik yüzeyinin dış rol listesi, `requireAuth`'un giriş bilgisi, ortak iptal örneği,
 * ayrı kod deposu, bağ okuyucu ve olayla düşen önbelleği, `/bayi` alt zincirinin köken kapısından ÖNCE bağlanması, ERP çıkışının
 * Bearer kimliği, Yönetici kapıları) server.ts'te BAĞLANIR; asıl risk «yazıldı ama bağlanmadı»dır. Düzenek
 * `kucukKapanislar.zincir.test.ts` ile AYNI kalıptır.
 *
 * SAHTE OLANLAR (yalnız süreç dışına çıkanlar): Firebase belirteç doğrulayıcısı — belirteç = `<uid>|<e-posta>|<1|0>|<sağlayıcı>|
 * <auth_time>` (eksik alan '' / yok); iptal denetimli doğrulama (`verifyIdToken(t, true)`) sınamanın verdiği davranışla (geçer /
 * iptal / ağ hatası / zaman aşımı); yenileme iptali ve hesap yönetimi çağrıları kaydedilir. `pg` havuzu süreç içi PGlite (sorgu
 * kancası okuma / yazma hatası canlandırır), pg-boss, node-cron, vite, `dotenv` (ortam dosyası YÜKLENMEZ), dışarı giden `fetch`.
 * Canlıya, Firebase'e, Mikro'ya istek YOK. Sunucu `PORT=0` ile açılır, `afterAll`'da kapanır.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { STAFF_ROLES, type AppRole } from '../lib/rbac';
import { meydanHesapla, panelKoduUret } from './kanal/magazaPanelKod';
import { magazaPanelSayaclari } from './routes/magazaPanelZinciri';
import { magazaBayiSayaclari } from './routes/magazaBayiZinciri';
import { kodSatirlari, SRC_KOK } from '../test/kaynakTarama';

// ── Sahteler ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
vi.mock('dotenv', () => ({ default: { config: () => ({ parsed: {} }) }, config: () => ({ parsed: {} }) }));
vi.mock('firebase-admin/auth', () => {
  const g = globalThis as Record<string, unknown>;
  const cagrilar: Array<{ ne: string; kim: string }> = [];
  g.__bayiHesap = cagrilar;
  let sira = 0;
  return {
    getAuth: () => ({
      verifyIdToken: async (t: string, iptalDenetimi?: boolean) => {
        const [uid, email, v, saglayici, an] = String(t).split('|');
        if (!uid || !email) throw new Error('geçersiz belirteç');
        if (iptalDenetimi === true) {
          const d = g.__bayiIptalDenetimi as ((b: string) => Promise<void>) | undefined;
          if (d) await d(String(t));
        }
        return {
          uid, email, email_verified: v === '1',
          firebase: { sign_in_provider: saglayici ?? '' },
          ...(an !== undefined && an !== '' ? { auth_time: Number(an) } : {}),
        };
      },
      revokeRefreshTokens: async (uid: string) => {
        cagrilar.push({ ne: 'revoke', kim: uid });
        const h = g.__bayiRevokeHatasi as (() => Error | null) | undefined;
        const e = h?.();
        if (e) throw e;
      },
      createUser: async (d: { email: string }) => { sira++; cagrilar.push({ ne: 'ac', kim: d.email }); return { uid: `acilan-bayi-${sira}` }; },
      deleteUser: async (uid: string) => { cagrilar.push({ ne: 'sil', kim: uid }); },
      generatePasswordResetLink: async (email: string) => `https://example.test/parola?kime=${encodeURIComponent(email)}`,
    }),
  };
});
vi.mock('pg-boss', () => ({
  PgBoss: class { on() {} async start() {} async createQueue() {} async work() {} async send() { return null; } async stop() {} },
}));
vi.mock('node-cron', () => ({ default: { schedule: () => ({ stop() {}, start() {} }), validate: () => true } }));
vi.mock('vite', () => ({ createServer: async () => ({ middlewares: (_q: unknown, _s: unknown, n: () => void) => n() }) }));
vi.mock('pg', async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();
  const g = globalThis as Record<string, unknown>;
  g.__bayiPg = db;
  const q = async (text: unknown, params?: unknown[]) => {
    let sql = String(text); let p = params;
    if (text && typeof text === 'object') { const o = text as { text: string; values?: unknown[] }; sql = o.text; p = o.values; }
    const kanca = g.__bayiSorguKancasi as ((s: string, p: unknown[]) => void) | undefined;
    if (kanca) kanca(sql, p ?? []);
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
// ERP rota bağlamının KENDİSİ yakalanır (sarmal; uçlar ve zincir aynen gerçek): «bayi yapılandırılmamış» kipi (`bayiDonus: null`)
// süreç içinde ancak bu bağlamla kurulabilir — server.ts bir kez içe aktarılır, aynı dosyadaki öteki sınamalar yapılandırılmış kipi ister.
vi.mock('./routes/magazaErpRoutes', async (asil) => {
  const a = await asil<typeof import('./routes/magazaErpRoutes')>();
  return {
    ...a,
    magazaErpRoutes: (...g: Parameters<typeof a.magazaErpRoutes>) => {
      (globalThis as Record<string, unknown>).__bayiErpBaglami = g[1];
      a.magazaErpRoutes(...g);
    },
  };
});

vi.setConfig({ testTimeout: 90_000 });

// ── Düzenek ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
interface Pg { query: (sql: string, p?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> }
const G = globalThis as Record<string, unknown>;
const pg = (): Pg => G.__bayiPg as Pg;
const hesapCagrilari = (): Array<{ ne: string; kim: string }> => G.__bayiHesap as Array<{ ne: string; kim: string }>;
const revokeSayisi = (uid: string): number => hesapCagrilari().filter(c => c.ne === 'revoke' && c.kim === uid).length;
const iptalDenetimi = (d: ((b: string) => Promise<void>) | undefined): void => { G.__bayiIptalDenetimi = d; };
const sorguKancasi = (k: ((s: string, p: unknown[]) => void) | undefined): void => { G.__bayiSorguKancasi = k; };

interface Katman { name?: string; handle: (...a: unknown[]) => unknown; route?: { path: unknown; methods: Record<string, boolean>; stack: Katman[] } }
interface Uygulama { router: { stack: Katman[] } }

let sunucu: http.Server | undefined;
let uygulama: Uygulama | undefined;
let kapiNo = 0;
let yuklemeDizini = '';
const gercekFetch = globalThis.fetch;

const KIRACI = 'CETPA';
const BASKA = 'BASKA-FIRMA';
const KOKEN = 'https://www.cetpa.com.tr';
const SUPER_EPOSTA = 'super@example.test';
const eposta = (uid: string): string => `${uid.toLowerCase()}@example.test`;
const simdiSn = (): number => Math.floor(Date.now() / 1000);
/** Firebase kimlik belirteci (sahte biçim). Varsayılan: e-posta + şifre, 1 dakika önce giriş. */
const belirtecMetni = (uid: string, o: { saglayici?: string; authTime?: number | null; ep?: string } = {}): string =>
  `${uid}|${o.ep ?? eposta(uid)}|1|${o.saglayici ?? 'password'}|${o.authTime === null ? '' : (o.authTime ?? simdiSn() - 60)}`;
const yetki = (uid: string, o: { saglayici?: string; authTime?: number | null; ep?: string } = {}): Record<string, string> =>
  ({ Authorization: `Bearer ${belirtecMetni(uid, o)}` });
const icUid = (rol: AppRole): string => `ic-${rol}`;
const ic = (rol: AppRole): Record<string, string> => yetki(icUid(rol));
const SUPER = yetki('super-1', { ep: SUPER_EPOSTA });

interface Yanit { s: number; j: Record<string, unknown>; metin: string; basliklar: http.IncomingHttpHeaders }
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
        coz({ s: durum, j, metin, basliklar: r.headers });
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
const say = async (sql: string, p?: unknown[]): Promise<number> => Number((await pg().query(sql, p)).rows[0]?.n);

/** Bağ kaydı (sunucunun yazdığı biçim). */
const bagKoy = (uid: string, b: { leadId: string; cariKod?: string | null; durum?: 'acik' | 'kapali'; firma?: string; companyId?: string }): Promise<unknown> =>
  belgeKoy('musteriHesaplari', uid, {
    companyId: b.companyId ?? KIRACI, leadId: b.leadId, cariKod: b.cariKod === undefined ? null : b.cariKod, firma: b.firma ?? 'Örnek Yapı Market',
    durum: b.durum ?? 'acik', olusturan: icUid('Admin'), olusturma: '2026-10-21T08:00:00.000Z', guncelleme: '2026-10-21T08:00:00.000Z',
  });
/** Bayi / müşteri kullanıcısı (uid YENİ olmalı — sunucu önbelleğine girmeden yazılır). */
async function bayi(uid: string, o: { rol?: AppRole; leadId?: string; cariKod?: string | null; durum?: 'acik' | 'kapali'; bagYok?: boolean; firma?: string; companyId?: string } = {}): Promise<string> {
  await belgeKoy('users', uid, { email: eposta(uid), role: o.rol ?? 'Dealer', companyId: o.companyId ?? KIRACI, status: 'active' });
  if (!o.bagYok) await bagKoy(uid, { leadId: o.leadId ?? 'L1', cariKod: o.cariKod === undefined ? '120.01.0042' : o.cariKod, durum: o.durum, firma: o.firma, companyId: o.companyId });
  return uid;
}

/** PKCE benzeri meydan çifti (site tarafının ürettiği). */
const meydanCifti = (): { dogrulayici: string; meydan: string; tur: string } => {
  const dogrulayici = panelKoduUret();
  return { dogrulayici, meydan: meydanHesapla(dogrulayici), tur: randomBytes(16).toString('base64url') };
};
/** ERP kökeninde bayi yetki kodu ister; `kod` dönüş adresinin parçasından. */
async function bayiKodu(b: Record<string, string>): Promise<{ r: Yanit; kod: string; dogrulayici: string }> {
  const m = meydanCifti();
  const r = await istek('POST', '/api/magaza-bayi/yetki-kodu', b, { meydan: m.meydan, tur: m.tur });
  const donus = typeof r.j.donus === 'string' ? r.j.donus : '';
  const kod = donus.includes('#kod=') ? donus.split('#kod=')[1].split('&tur=')[0] : '';
  return { r, kod, dogrulayici: m.dogrulayici };
}
const siteBasligi = (token?: string): Record<string, string> => ({ Origin: KOKEN, ...(token ? { Authorization: `Bearer ${token}` } : {}) });
const oturum = (kod: string, dogrulayici: string): Promise<Yanit> => istek('POST', '/api/magaza/bayi/oturum', siteBasligi(), { kod, dogrulayici });
/** Uçtan uca bayi belirteci: yetki kodu → oturum. */
async function bayiBelirteci(uid: string, o: { saglayici?: string; authTime?: number | null } = {}): Promise<string> {
  const { r, kod, dogrulayici } = await bayiKodu(yetki(uid, o));
  expect(r.s, r.metin).toBe(200);
  const t = await oturum(kod, dogrulayici);
  expect(t.s, t.metin).toBe(200);
  expect(typeof t.j.token).toBe('string');
  return String(t.j.token);
}
const ben = (token: string): Promise<Yanit> => istek('GET', '/api/magaza/bayi/ben', siteBasligi(token));
const siparisler = (token: string): Promise<Yanit> => istek('GET', '/api/magaza/bayi/siparisler', siteBasligi(token));
const bayiCikis = (token: string): Promise<Yanit> => istek('POST', '/api/magaza/bayi/cikis', siteBasligi(token), {});

function rotaDokumu(): Array<{ yontem: string; desen: string; adlar: string[] }> {
  if (!uygulama) throw new Error('uygulama yakalanmadı');
  const uclar: Array<{ yontem: string; desen: string; adlar: string[] }> = [];
  const gez = (yigin: Katman[]): void => {
    for (const k of yigin) {
      const alt = (k.handle as unknown as { stack?: Katman[] }).stack;
      if (!k.route) { if (Array.isArray(alt)) gez(alt); continue; }
      const yollar = Array.isArray(k.route.path) ? k.route.path : [k.route.path];
      for (const y of yollar) for (const [m, acik] of Object.entries(k.route.methods)) {
        if (acik && typeof y === 'string') uclar.push({ yontem: m.toUpperCase(), desen: y, adlar: k.route.stack.map(s => s.name || '(adsız)') });
      }
    }
  };
  gez(uygulama.router.stack);
  return uclar;
}

beforeAll(async () => {
  yuklemeDizini = fs.mkdtempSync(path.join(os.tmpdir(), 'magaza-bayi-'));
  process.env.PORT = '0';
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgres://sinama/yok';
  process.env.SESSION_TOKEN_SECRET = 'sinama-sirri';
  process.env.UPLOAD_DIR = yuklemeDizini;
  process.env.SUPER_ADMIN_EMAILS = SUPER_EPOSTA;
  for (const ad of Object.keys(process.env)) {
    if (/^(STRIPE|RESEND|LUCA|SHOPIFY|SMTP|GEMINI|ANTHROPIC|MIKRO|IYZICO|TRENDYOL|HEPSIBURADA|DHL|UPS|FEDEX|YURTICI|MNG|ARAS|WHATSAPP|FIREBASE|GOOGLE_APPLICATION|OPS_|SERVER_TENANT_|MAGAZA_)/.test(ad)) delete process.env[ad];
  }
  // Bayi dönüş adresi ve izinli köken BİLEREK tanımsız: varsayılanlar (bayi.html, www.cetpa.com.tr) sınanır.
  process.env.SERVER_TENANT_COMPANY_ID = KIRACI;
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
  await bekle(async () => {
    const r = await pg().query("SELECT to_regclass('docs') AS d, to_regclass('mfa_secrets') AS m");
    return !!(r.rows[0].d && r.rows[0].m);
  }, 60_000, 'tablolar hazır');

  for (const rol of STAFF_ROLES) await belgeKoy('users', icUid(rol), { email: eposta(icUid(rol)), role: rol, companyId: KIRACI });
  await belgeKoy('users', 'baska-yonetici', { email: eposta('baska-yonetici'), role: 'Admin', companyId: BASKA });
  await belgeKoy('users', 'rolsuz-1', { email: eposta('rolsuz-1'), displayName: 'Yabancı' });
  // Cariler (lead) ve siparişler.
  await belgeKoy('leads', 'L1', { companyId: KIRACI, company: 'Örnek Yapı Market Ltd. Şti.', mikroCariKod: ' 120.01.0042 ' });
  await belgeKoy('leads', 'L2', { companyId: KIRACI, company: 'Başka Cari A.Ş.', mikroCariKod: '120.01.0099' });
  await belgeKoy('leads', 'L-KODSUZ', { companyId: KIRACI, name: 'Kodsuz Usta' });
  await belgeKoy('leads', 'L-BASKA', { companyId: BASKA, company: 'Yabancı Kiracı' });
  const siparis = (id: string, d: Record<string, unknown>) => belgeKoy('orders', id, d);
  await siparis('c-1', { companyId: KIRACI, leadId: 'L1', orderNumber: 'SAS-1', status: 'Processing', createdAt: '2026-10-05T10:00:00.000Z',
    notes: 'İÇ NOT', assignedTo: 'satis', assignedDriver: 'surucu', totalPrice: 1200, mikroFaturaGonderimi: { durum: 'x' }, customerEmail: 'gizli@ornek.com',
    trackingNumber: 'KRG-1', takipKodu: 'Qw12Er34Ty56Ui78Op90As', lineItems: [{ id: 'k1', sku: 'DYO-001', name: 'DYO Boya 15 L', quantity: 3, price: 400 }] });
  await siparis('c-iptal', { companyId: KIRACI, leadId: 'L1', orderNumber: 'SAS-2', status: 'Cancelled', createdAt: '2026-10-06T10:00:00.000Z', lineItems: [] });
  await siparis('mikrofat__CETPA__CTP-42', { companyId: KIRACI, mikroCariKod: '120.01.0042', orderNumber: 'MF-CTP42', status: 'Delivered', source: 'mikro-fatura',
    mikroFaturaNo: 'CTP42', createdAt: '2026-09-01T12:00:00.000Z', lineItems: [{ sku: 'NP1-200', name: 'Silikon', quantity: null, price: null }] });
  await siparis('mikrofat__CETPA__CTP-43', { companyId: KIRACI, mikroCariKod: '', orderNumber: 'MF-CTP43', status: 'Delivered', source: 'mikro-fatura' });
  await siparis('baska-cari', { companyId: KIRACI, leadId: 'L2', orderNumber: 'SAS-9', status: 'Pending' });
  await siparis('baska-kiraci', { companyId: BASKA, leadId: 'L1', mikroCariKod: '120.01.0042', orderNumber: 'SAS-X', status: 'Pending' });
  await siparis('etiketsiz', { leadId: 'L1', orderNumber: 'SAS-E', status: 'Pending' });
  await siparis('magaza', { companyId: KIRACI, leadId: 'L1', orderNumber: '#1001', source: 'shopify_webhook', status: 'Pending' });
  await siparis('trendyol', { companyId: KIRACI, leadId: 'L1', orderNumber: 'TY-1', source: 'Trendyol', status: 'Pending' });
  await siparis('hb', { companyId: KIRACI, mikroCariKod: '120.01.0042', orderNumber: 'HB-1', source: 'Hepsiburada', status: 'Pending' });
  await siparis('kodsuz-1', { companyId: KIRACI, leadId: 'L-KODSUZ', orderNumber: 'SAS-K', status: 'Pending', createdAt: '2026-10-01T00:00:00.000Z' });
}, 240_000);

afterAll(async () => {
  globalThis.fetch = gercekFetch;
  const s = sunucu;
  if (s) { s.closeAllConnections(); await new Promise<void>(r => s.close(() => r())); }
  if (yuklemeDizini) fs.rmSync(yuklemeDizini, { recursive: true, force: true });
}, 30_000);

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('H1 / H4 — ERP kökeni köprü: yetki kodu ve firma okuma AYNI hükmü verir', () => {
  const ikiUc = async (b: Record<string, string>): Promise<{ hesap: Yanit; kod: Yanit }> => {
    const hesap = await istek('GET', '/api/magaza-bayi/hesap', b);
    const { r: kod } = await bayiKodu(b);
    return { hesap, kod };
  };

  it('dış rol + açık bağ → 200; firma okuma YALNIZ `{ firma }`; dönüş adresi değişken yokken bayi.html#kod=', async () => {
    const uid = await bayi('kopru-acik');
    const { hesap, kod } = await ikiUc(yetki(uid));
    expect([hesap.s, hesap.j]).toEqual([200, { firma: 'Örnek Yapı Market' }]);
    expect(kod.s, kod.metin).toBe(200);
    expect(String(kod.j.donus).startsWith('https://www.cetpa.com.tr/bayi.html#kod=')).toBe(true);
    expect(Object.keys(kod.j)).toEqual(['donus']);
    expect(hesap.basliklar['cache-control']).toBe('no-store');
  });

  it.each([
    ['bağsız dış rol', async () => yetki(await bayi('kopru-bagsiz', { bagYok: true })), 403, 'bag-yok'],
    ['kapalı bağ', async () => yetki(await bayi('kopru-kapali', { rol: 'B2B', durum: 'kapali' })), 403, 'kapali'],
    ['başka kiracının bağı', async () => yetki(await bayi('kopru-bag-baska', { companyId: KIRACI }).then(async u => { await bagKoy(u, { leadId: 'L1', companyId: BASKA }); return u; })), 403, 'kiraci'],
    ['iç rol (bu köprü yalnız dış rol)', async () => ic('Sales'), 403, 'rol'],
    ['Google sağlayıcısı', async () => yetki(await bayi('kopru-google'), { saglayici: 'google.com' }), 403, 'sifre-gerekli'],
    ['`auth_time` yok', async () => yetki(await bayi('kopru-zamansiz'), { authTime: null }), 401, 'yeniden-giris'],
    ['ERP girişi 13 saat önce', async () => yetki(await bayi('kopru-eski'), { authTime: simdiSn() - 13 * 3600 }), 401, 'yeniden-giris'],
  ] as const)('%s → iki uçta aynı ret (durum + `kod`)', async (_ad, kim, durum, kod) => {
    const b = await kim();
    const { hesap, kod: yk } = await ikiUc(b);
    expect([hesap.s, hesap.j.kod], hesap.metin).toEqual([durum, kod]);
    expect([yk.s, yk.j.kod], yk.metin).toEqual([durum, kod]);
    expect(yk.j.donus).toBeUndefined();
  });

  it('rolsüz hesap iki uçta 403 `ROL_YOK` (dış rol izin listesi rolsüze SIZMADI); başka kiracının dış rol hesabı 403 `kiraci`', async () => {
    const { hesap, kod } = await ikiUc(yetki('rolsuz-1'));
    expect([hesap.s, hesap.j.code, kod.s, kod.j.code]).toEqual([403, 'ROL_YOK', 403, 'ROL_YOK']);
    const yabanci = await bayi('kopru-yabanci', { companyId: BASKA });
    const y = await ikiUc(yetki(yabanci));
    expect([y.hesap.s, y.hesap.j.kod, y.kod.s, y.kod.j.kod]).toEqual([403, 'kiraci', 403, 'kiraci']);
  });

  it('Firebase «belirteç iptal edildi» → 401; denetim ağ hatası → 503 `denetlenemedi` ve kod YOK; panel aynı anda 200 (`gec`); bayi isteği panel sayaçlarını ARTIRMAZ', async () => {
    const uid = await bayi('kopru-iptal');
    try {
      iptalDenetimi(async () => { throw Object.assign(new Error('iptal'), { code: 'auth/id-token-revoked' }); });
      const { hesap, kod } = await ikiUc(yetki(uid));
      expect([hesap.s, kod.s, kod.j.kod]).toEqual([401, 401, undefined]);
      iptalDenetimi(async () => { throw Object.assign(new Error('ağ'), { code: 'app/network-error' }); });
      const panelOnce = magazaPanelSayaclari();
      const bayiOnce = magazaBayiSayaclari();
      const ag = await ikiUc(yetki(uid));
      expect([ag.hesap.s, ag.hesap.j, ag.kod.s, ag.kod.j]).toEqual([503, { ok: false, kod: 'denetlenemedi' }, 503, { ok: false, kod: 'denetlenemedi' }]);
      expect(magazaBayiSayaclari().yetkiKoduIptalDenetlenemedi - bayiOnce.yetkiKoduIptalDenetlenemedi).toBe(2);
      expect(magazaPanelSayaclari()).toEqual(panelOnce);                                      // bayi isteği panel kümesine SAYILMADI
      const m = meydanCifti();
      const panel = await istek('POST', '/api/magaza-panel/yetki-kodu', ic('Sales'), { meydan: m.meydan, tur: m.tur });
      expect(panel.s, panel.metin).toBe(200);                                                   // panel davranışı DEĞİŞMEDİ
    } finally { iptalDenetimi(undefined); }
  });

  it('denetim zaman aşımı (4 sn) → 503 `denetlenemedi`', async () => {
    const uid = await bayi('kopru-zaman');
    try {
      iptalDenetimi(() => new Promise<void>(() => { /* hiç sonuçlanmaz */ }));
      const { r } = await bayiKodu(yetki(uid));
      expect([r.s, r.j.kod]).toEqual([503, 'denetlenemedi']);
    } finally { iptalDenetimi(undefined); }
  }, 30_000);

  it('`gecersizOnce` okunamazsa 503 (kod yok)', async () => {
    const uid = await bayi('kopru-iptal-okuma');
    sorguKancasi((sql, p) => { if (sql.startsWith('SELECT data FROM docs') && p[0] === 'magazaPanelIptal' && p[1] === uid) throw Object.assign(new Error('okuma'), { code: '57P01' }); });
    try {
      const { r } = await bayiKodu(yetki(uid));
      expect([r.s, r.j]).toEqual([503, { ok: false }]);
    } finally { sorguKancasi(undefined); }
  });

  it('mağaza çıkışı / ERP çıkışı / erişim kapatma SONRASINDA eski `auth_time` ile (Firebase denetimi GEÇERKEN) → 401 `yeniden-giris`; yeni şifre girişi → 200', async () => {
    // (a) mağaza çıkışı
    const a = await bayi('kural-magaza');
    const eskiA = simdiSn() - 60;
    const tA = await bayiBelirteci(a, { authTime: eskiA });
    expect((await bayiCikis(tA)).s).toBe(204);
    expect((await bayiKodu(yetki(a, { authTime: eskiA }))).r.j.kod).toBe('yeniden-giris');
    expect((await bayiKodu(yetki(a, { authTime: simdiSn() + 1 }))).r.s).toBe(200);
    // (b) ERP çıkışı (Bearer; çerez yok)
    const b = await bayi('kural-erp');
    const eskiB = simdiSn() - 60;
    expect((await istek('POST', '/api/db/session/logout', yetki(b, { authTime: eskiB }), {})).s).toBe(200);
    expect((await bayiKodu(yetki(b, { authTime: eskiB }))).r.j.kod).toBe('yeniden-giris');
    expect((await bayiKodu(yetki(b, { authTime: simdiSn() + 1 }))).r.s).toBe(200);
    // (c) erişim kapatma (Yönetici) ve yeniden açma: açınca da eski girişle köprü açılmaz
    const c = await bayi('kural-kapat');
    const eskiC = simdiSn() - 60;
    expect((await istek('POST', `/api/admin/musteri-hesaplari/${c}/durum`, ic('Admin'), { durum: 'kapali' })).s).toBe(200);
    expect((await istek('POST', `/api/admin/musteri-hesaplari/${c}/durum`, ic('Admin'), { durum: 'acik' })).s).toBe(200);
    expect((await bayiKodu(yetki(c, { authTime: eskiC }))).r.j.kod).toBe('yeniden-giris');
    expect((await bayiKodu(yetki(c, { authTime: simdiSn() + 1 }))).r.s).toBe(200);
  });

  it('bayi yapılandırılmamış (`bayiDonus: null`): dış rollü, açık bağlı kullanıcının firma okuması da 503 `bayi-yapilandirilmamis`, gövdede `firma` YOK', async () => {
    // Belge (env.example, RUNBOOK, server.ts) iki ucun da 503 döndüğünü söyler; firma okuması 200 dönseydi onay sayfası etkin
    // «Onayla ve giriş yap» düğmesini çizer, ret ancak tıklayınca gelirdi.
    const C = G.__bayiErpBaglami as { bayiDonus: string | null } | undefined;
    if (!C) throw new Error('magazaErpRoutes bağlamı yakalanmadı (sarmal bağlanmadı)');
    const uid = await bayi('kopru-yapilandirilmamis');
    const b = yetki(uid);
    const once = await istek('GET', '/api/magaza-bayi/hesap', b);
    expect([once.s, once.j]).toEqual([200, { firma: 'Örnek Yapı Market' }]);       // aynı kullanıcı köprüden GEÇER: 503'ün tek nedeni yapılandırma
    const asil = C.bayiDonus;
    expect(asil).not.toBeNull();
    C.bayiDonus = null;
    try {
      const hesap = await istek('GET', '/api/magaza-bayi/hesap', b);
      expect([hesap.s, hesap.j], hesap.metin).toEqual([503, { ok: false, kod: 'bayi-yapilandirilmamis' }]);
      expect(hesap.j).not.toHaveProperty('firma');
      expect(hesap.metin).not.toContain('Örnek Yapı Market');
      const { r: kod } = await bayiKodu(b);
      expect([kod.s, kod.j], kod.metin).toEqual([503, { ok: false, kod: 'bayi-yapilandirilmamis' }]);   // iki uç AYNI hüküm
    } finally { C.bayiDonus = asil; }
    expect((await istek('GET', '/api/magaza-bayi/hesap', b)).s).toBe(200);
  });

  it('EŞİT AN ret: giriş anı (`auth_time` × 1000) son iptale EŞİTSE 401 `yeniden-giris`; bir saniye sonrası 200', async () => {
    // İptal kaydı tam saniyeye denk gelecek biçimde DOĞRUDAN yazılır (bu uid için okuma yapılmadan: iptal önbelleği boş). Gerçek
    // çıkışın değeri milisaniyelidir, eşitlik ancak böyle kurulabilir — `>` yerine `>=` yazılırsa bu satır kırmızı (2026-10-21
    // paket turu mutasyonu M03b: öteki testlerin hiçbiri yakalamıyordu).
    const uid = await bayi('kural-esit');
    const an = simdiSn() - 30;
    await belgeKoy('magazaPanelIptal', uid, { gecersizOnce: new Date(an * 1000).toISOString(), companyId: KIRACI });
    const esit = await bayiKodu(yetki(uid, { authTime: an }));
    expect([esit.r.s, esit.r.j.kod], esit.r.metin).toEqual([401, 'yeniden-giris']);
    expect(esit.r.j.donus).toBeUndefined();
    const sonra = await bayiKodu(yetki(uid, { authTime: an + 1 }));
    expect(sonra.r.s, sonra.r.metin).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('H10 — site kökeni oturum: kod → belirteç', () => {
  it('başarılı: `{ token, bitis (ms), bayi: { firma } }`, `mb1-` öneki, iskonto / vade / özel oran YOK; kod TEK kullanımlık', async () => {
    const uid = await bayi('oturum-1');
    const { kod, dogrulayici } = await bayiKodu(yetki(uid));
    const r = await oturum(kod, dogrulayici);
    expect(r.s, r.metin).toBe(200);
    expect(Object.keys(r.j).sort()).toEqual(['bayi', 'bitis', 'token']);
    expect(String(r.j.token).startsWith('mb1-')).toBe(true);
    expect(typeof r.j.bitis).toBe('number');
    expect(r.j.bayi).toEqual({ firma: 'Örnek Yapı Market' });
    expect(r.metin).not.toMatch(/iskonto|vade|ozel/);
    expect(r.basliklar['access-control-allow-origin']).toBe(KOKEN);
    expect((await oturum(kod, dogrulayici)).s).toBe(401);
  });

  it('meydan yanlış → 401 (kod yanar); panel kodu bayi oturumunda geçersiz (AYRI depo); bayi kodu panel oturumunda geçersiz', async () => {
    const uid = await bayi('oturum-2');
    const { kod, dogrulayici } = await bayiKodu(yetki(uid));
    expect((await oturum(kod, 'A'.repeat(43))).s).toBe(401);
    expect((await oturum(kod, dogrulayici)).s).toBe(401);
    const m = meydanCifti();
    const panel = await istek('POST', '/api/magaza-panel/yetki-kodu', ic('Sales'), { meydan: m.meydan, tur: m.tur });
    const panelKodu = String(panel.j.donus).split('#kod=')[1].split('&tur=')[0];
    expect((await oturum(panelKodu, m.dogrulayici)).s).toBe(401);
    const bk = await bayiKodu(yetki(uid));
    expect((await istek('POST', '/api/magaza/panel/oturum', siteBasligi(), { kod: bk.kod, dogrulayici: bk.dogrulayici })).s).toBe(401);
  });

  it('panel belirteci bayi kapısında geçersiz (ANAHTAR + önek); bayi belirteci panel kapısında geçersiz', async () => {
    const m = meydanCifti();
    const panel = await istek('POST', '/api/magaza-panel/yetki-kodu', ic('Sales'), { meydan: m.meydan, tur: m.tur });
    const panelKodu = String(panel.j.donus).split('#kod=')[1].split('&tur=')[0];
    const panelOturum = await istek('POST', '/api/magaza/panel/oturum', siteBasligi(), { kod: panelKodu, dogrulayici: m.dogrulayici });
    expect(panelOturum.s, panelOturum.metin).toBe(200);
    const panelBelirteci = String(panelOturum.j.token);
    expect((await ben(panelBelirteci)).s).toBe(401);
    expect((await ben(`mb1-${panelBelirteci.slice(4)}`)).s).toBe(401);
    const t = await bayiBelirteci(await bayi('oturum-3'));
    expect((await istek('GET', '/api/magaza/panel/siparisler', siteBasligi(t))).s).toBe(401);
  });

  it.each([
    // Mağaza çıkışının belirteci kod istenmeden ÖNCE alınır: depo kişi başına TEK canlı kod tutar, sonradan istenen kod öncekini
    // silerdi (401 yanlış nedenle gelirdi).
    ['mağaza çıkışı', async (uid: string) => bayiBelirteci(uid), async (_uid: string, t: string | null) => { expect((await bayiCikis(String(t))).s).toBe(204); }],
    ['ERP çıkışı (Bearer)', async () => null, async (uid: string) => { expect((await istek('POST', '/api/db/session/logout', yetki(uid), {})).s).toBe(200); }],
    ['erişim kapatma', async () => null, async (uid: string) => { expect((await istek('POST', `/api/admin/musteri-hesaplari/${uid}/durum`, ic('Admin'), { durum: 'kapali' })).s).toBe(200); }],
  ] as const)('kod alındıktan SONRA %s → oturum 401 (veriliş iptalden önce)', async (ad, hazirla, olay) => {
    const uid = await bayi(`oturum-sonra-${ad.length}`);
    const t = await hazirla(uid);
    const { r, kod, dogrulayici } = await bayiKodu(yetki(uid, { authTime: simdiSn() + 1 }));
    expect(r.s, r.metin).toBe(200);
    await new Promise(res => setTimeout(res, 5));
    await olay(uid, t);
    expect((await oturum(kod, dogrulayici)).s).toBe(401);
  });

  it('kontrol: aynı akış olaysız → oturum 200 (yukarıdaki 401\'ler boşuna geçmiyor)', async () => {
    const uid = await bayi('oturum-sonra-kontrol');
    const { kod, dogrulayici } = await bayiKodu(yetki(uid, { authTime: simdiSn() + 1 }));
    expect((await oturum(kod, dogrulayici)).s).toBe(200);
  });

  it.each([['kullanıcı', 'users'], ['bağ', 'musteriHesaplari']] as const)('%s okuması hata → 503 (kod yanmıştır)', async (_ad, coll) => {
    const uid = await bayi(`oturum-503-${coll}`);
    const { kod, dogrulayici } = await bayiKodu(yetki(uid));
    // Köprü ucu okumaları önbelleğe aldı: `users` olayı (Yönetici yazımı) kullanıcı ve bağ önbelleğini düşürür, sonra okuma bozulur.
    // (İptal değerinin okuma hatası 60 sn'lik iptal önbelleği yüzünden burada canlandırılamaz — zincir düzeneğinde:
    // routes/magazaBayiZinciri.test.ts.)
    expect((await istek('PUT', `/api/db/users/${uid}?merge=1`, ic('Admin'), { displayName: 'önbellek düşsün' })).s).toBe(200);
    sorguKancasi((sql, p) => { if (sql.startsWith('SELECT data FROM docs') && p[0] === coll && p[1] === uid) throw Object.assign(new Error('okuma'), { code: '57P01' }); });
    try {
      const r = await oturum(kod, dogrulayici);
      expect([r.s, r.j]).toEqual([503, { ok: false }]);
    } finally { sorguKancasi(undefined); }
    expect((await oturum(kod, dogrulayici)).s).toBe(401);                                       // kod yanmıştır
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('H12 / H13 / H14 — siparişler ve hesap özeti', () => {
  it('yalnız o carinin Cetpa + MF siparişleri; başka cari / kiracı / mağaza / pazar yeri / etiketsiz / carisiz MF YOK; iptal «iptal»; yeni önce', async () => {
    const t = await bayiBelirteci(await bayi('liste-1'));
    const r = await siparisler(t);
    expect(r.s, r.metin).toBe(200);
    expect(Object.keys(r.j)).toEqual(['siparisler']);
    const l = r.j.siparisler as Array<Record<string, unknown>>;
    expect(l.map(s => s.no)).toEqual(['SAS-2', 'SAS-1', 'MF-CTP42']);
    expect(l.map(s => s.durum)).toEqual(['iptal', 'hazirlaniyor', 'teslim']);
    expect(l[1]).toMatchObject({ tarih: '2026-10-05T10:00:00.000Z', kalemler: [{ sku: 'DYO-001', ad: 'DYO Boya 15 L', adet: 3 }] });
    expect(l[2]).toMatchObject({ kalemler: [{ sku: 'NP1-200', ad: 'Silikon', adet: null }] });
    for (const s of l) expect(Object.keys(s).sort()).toEqual(['durum', 'id', 'kalemler', 'no', 'tarih']);
    // Yasaklı alanlar ve iç kimlikler yanıtta YOK; `id` doküman kimliği değil. Tarama opak kimlik DEĞERLERİ maskelenerek yapılır:
    // kimlik oturum başına (`bas`) değişen rastgele görünümlü 22 karakterdir ve 'L1' gibi kısa bir parça içinde rastlantıyla geçebilir
    // (2026-10-21 paket turu: kopyadaki koşuda `…DL1RW…` kimliği bu satırı bir kez kırmızıya çevirdi). Kimliğin biçimi ve doküman
    // kimliğini taşımadığı aşağıda ayrıca sınanır.
    const metinKimliksiz = r.metin.replace(/"id":"[A-Za-z0-9_-]{22}"/g, '"id":"…"');
    expect(metinKimliksiz.match(/"id":"…"/g)?.length, 'her satırın kimliği maskelendi').toBe(l.length);
    for (const yasak of ['İÇ NOT', 'notes', 'assignedTo', 'surucu', 'totalPrice', 'price', 'mikroFaturaGonderimi', 'gizli@ornek.com', 'KRG-1', '"CTP42"', 'Qw12Er34', 'takip', 'track', 'kargoNo', 'faturaNo', 'mikrofat', 'c-iptal', '"c-1"', 'CETPA', 'L1', '120.01']) {
      expect(metinKimliksiz, yasak).not.toContain(yasak);
    }
    for (const s of l) expect(String(s.id)).toMatch(/^[A-Za-z0-9_-]{22}$/);
    for (const s of l) for (const ic of ['c-1', 'c-iptal', 'mikrofat__CETPA__CTP-42']) expect(String(s.id), ic).not.toBe(ic);
    for (const s of l) for (const parca of ['c-iptal', 'mikrofat', 'CTP-42']) expect(String(s.id), parca).not.toContain(parca);
    // Aynı oturumda aynı kimlik; yeni oturumda farklı.
    expect(((await siparisler(t)).j.siparisler as Array<Record<string, unknown>>).map(s => s.id)).toEqual(l.map(s => s.id));
    const t2 = await bayiBelirteci('liste-1', { authTime: simdiSn() + 1 });
    const l2 = (await siparisler(t2)).j.siparisler as Array<Record<string, unknown>>;
    expect(l2.map(s => s.no)).toEqual(l.map(s => s.no));
    expect(l2.map(s => s.id).filter(id => l.some(s => s.id === id))).toEqual([]);
  });

  it('kodsuz lead\'e bağlı hesap yalnız kendi `leadId`\'li siparişini görür (carisiz MF siparişi YOK)', async () => {
    const t = await bayiBelirteci(await bayi('liste-kodsuz', { leadId: 'L-KODSUZ', cariKod: null }));
    expect(((await siparisler(t)).j.siparisler as Array<Record<string, unknown>>).map(s => s.no)).toEqual(['SAS-K']);
  });

  it('201 siparişte yanıt 200 kayıt: ilk en yeni, en eski yok', async () => {
    const uid = await bayi('liste-cok', { leadId: 'L-COK', cariKod: null });
    await belgeKoy('leads', 'L-COK', { companyId: KIRACI, company: 'Çok Sipariş' });
    const degerler = Array.from({ length: 201 }, (_, i) => `('orders', 'cok-${i}', '${JSON.stringify({ companyId: KIRACI, leadId: 'L-COK', orderNumber: `N-${i}`, status: 'Pending', createdAt: new Date(Date.UTC(2026, 0, 1) + i * 3_600_000).toISOString() })}'::jsonb)`);
    await pg().query(`INSERT INTO docs (coll, id, data) VALUES ${degerler.join(', ')}`);
    const l = (await siparisler(await bayiBelirteci(uid))).j.siparisler as Array<Record<string, unknown>>;
    expect(l).toHaveLength(200);
    expect(l[0].no).toBe('N-200');
    expect(l.some(s => s.no === 'N-0')).toBe(false);
  });

  it('`ben`: `{ bayi: { firma }, ozet: { bakiye: null, vadesiGecen: null, acikSiparis: null } }` — başka anahtar, iskonto YOK', async () => {
    const r = await ben(await bayiBelirteci(await bayi('ben-1')));
    expect([r.s, r.j]).toEqual([200, { bayi: { firma: 'Örnek Yapı Market' }, ozet: { bakiye: null, vadesiGecen: null, acikSiparis: null } }]);
    expect(r.metin).not.toContain('iskonto');
  });

  it('bu dilimde OLMAYAN uçlar belirteçle 404 (takip, sipariş verme, fiyat, ekstre, başvuru); belirteçsiz 401', async () => {
    const t = await bayiBelirteci(await bayi('yok-uclar'));
    for (const [y, yol] of [['POST', '/siparisler/x/takip'], ['POST', '/siparis'], ['GET', '/fiyat'], ['GET', '/ekstre'], ['POST', '/basvuru'], ['POST', '/siparisler']] as const) {
      const r = await istek(y, `/api/magaza/bayi${yol}`, siteBasligi(t), y === 'POST' ? {} : undefined);
      expect([yol, r.s, r.j], r.metin).toEqual([yol, 404, { ok: false }]);
      expect((await istek(y, `/api/magaza/bayi${yol}`, siteBasligi(), y === 'POST' ? {} : undefined)).s, yol).toBe(401);
    }
  });

  it('köken: izinli köken + GET ön uçuşu → 204, `Allow-Methods` GET, `Allow-Headers` Authorization; izinsiz köken 403; bayi istekleri genel kovaya sayılmaz', async () => {
    const r = await istek('OPTIONS', '/api/magaza/bayi/siparisler', { Origin: KOKEN, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization' });
    expect(r.s).toBe(204);
    expect(String(r.basliklar['access-control-allow-methods'])).toMatch(/\bGET\b/);
    expect(String(r.basliklar['access-control-allow-headers'])).toMatch(/Authorization/);
    expect(r.basliklar['access-control-allow-credentials']).toBeUndefined();
    expect((await istek('GET', '/api/magaza/bayi/ben', { Origin: 'https://kotu.example' })).s).toBe(403);
    // Son koşan sınırlayıcının başlığı bayi kovasınındır (600) — genel `apiLimiter` (kimliksiz 300) koşmadı.
    const t = await bayiBelirteci(await bayi('kova-1'));
    expect((await ben(t)).basliklar['ratelimit-limit']).toBe('600');
  });

  it('kaynak çiti: bayi modüllerinde pgShim `where` / sınırlayıcı / yazma SQL\'i YOK; liste sorgusu iki sabitten', () => {
    for (const d of ['routes/magazaBayiZinciri.ts', 'kanal/magazaBayiSiparis.ts', 'routes/musteriHesapRoutes.ts']) {
      const kod = kodSatirlari(path.join(SRC_KOK, 'server', d)).map(s => s.kod).join('\n');
      expect(kod, d).not.toMatch(/\.where\(|rateLimit\(|express-rate-limit|UPDATE |INSERT |DELETE |::timestamptz/);
      expect(kod, d).not.toMatch(/\bas any\b|@ts-ignore|@ts-expect-error|(\?\?|\|\|)\s*0\b/);
    }
    const zincir = kodSatirlari(path.join(SRC_KOK, 'server', 'routes', 'magazaBayiZinciri.ts')).map(s => s.kod).join('\n');
    expect(zincir.match(/havuz\.query\(/g)).toHaveLength(2);
    expect(zincir).toContain('havuz.query(BAYI_SIPARIS_ADAY_SQL, p)');
    expect(zincir).toContain('havuz.query(BAYI_SIPARIS_GOVDE_SQL, [...p, sira])');
    // Yönetici listesi kiracıyı SQL'de süzer (JS'teki ikinci süzgeç yalnız ikinci kattır — tek başına kalırsa bütün kiracıların bağ
    // kayıtları sunucu belleğine okunurdu; davranış testi bunu göremez, 2026-10-21 paket turu mutasyonu M24a).
    const hesapUclari = kodSatirlari(path.join(SRC_KOK, 'server', 'routes', 'musteriHesapRoutes.ts')).map(s => s.kod).join('\n');
    expect(hesapUclari).toContain(`const LISTE_SQL = "SELECT id, data FROM docs WHERE coll = 'musteriHesaplari' AND data->>'companyId' = $1";`);
    expect(hesapUclari).toMatch(/const LEAD_KODLARI_SQL = "SELECT id, data->'mikroCariKod' AS k FROM docs WHERE coll = 'leads' AND data->>'companyId' = \$1 AND id = ANY\(\$2::text\[\]\)";/);
    expect(hesapUclari).toContain('havuz.query(LISTE_SQL, [kiraci])');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('H2 / K7 — çıkış', () => {
  it('bayi çıkışı: 204; bayi belirteci `ben` ve `siparisler`\'de 401; Firebase yenileme iptali uid ile BİR kez', async () => {
    const uid = await bayi('cikis-1');
    const t = await bayiBelirteci(uid);
    expect((await bayiCikis(t)).s).toBe(204);
    expect(revokeSayisi(uid)).toBe(1);
    expect((await ben(t)).s).toBe(401);
    expect((await siparisler(t)).s).toBe(401);
  });

  it('bayi çıkışı: revoke fırlatsa da 204 (sayaç +1); iptal YAZILAMAZSA 503 ve revoke YOK', async () => {
    const a = await bayi('cikis-revoke');
    const ta = await bayiBelirteci(a);
    const once = magazaBayiSayaclari().cikisFirebaseIptalYazilamadi;
    G.__bayiRevokeHatasi = () => new Error('firebase');
    try { expect((await bayiCikis(ta)).s).toBe(204); } finally { G.__bayiRevokeHatasi = undefined; }
    expect(magazaBayiSayaclari().cikisFirebaseIptalYazilamadi - once).toBe(1);
    const b = await bayi('cikis-iptal-hata');
    const tb = await bayiBelirteci(b);
    sorguKancasi((sql, p) => { if (sql.startsWith('INSERT INTO docs') && p[0] === 'magazaPanelIptal' && p[1] === b) throw Object.assign(new Error('yazma'), { code: '57P01' }); });
    try { expect((await bayiCikis(tb)).s).toBe(503); } finally { sorguKancasi(undefined); }
    expect(revokeSayisi(b)).toBe(0);
  });

  it('ERP çıkışı çerezsiz + geçerli Bearer: iptal + revoke uid ile birer kez, `cikisUidsiz` artmaz; ardından bayi ve panel belirteçleri 401', async () => {
    const uid = await bayi('cikis-erp');
    const t = await bayiBelirteci(uid);
    const once = magazaPanelSayaclari().cikisUidsiz;
    expect((await istek('POST', '/api/db/session/logout', yetki(uid), {})).s).toBe(200);
    expect(revokeSayisi(uid)).toBe(1);
    expect(magazaPanelSayaclari().cikisUidsiz).toBe(once);
    expect((await ben(t)).s).toBe(401);
    expect((await siparisler(t)).s).toBe(401);
    expect(await belgeOku('magazaPanelIptal', uid)).toMatchObject({ gecersizOnce: expect.any(String) });
    // Personel: panel belirteci de ERP çıkışıyla ölür (Bearer yolu).
    const m = meydanCifti();
    const pk = await istek('POST', '/api/magaza-panel/yetki-kodu', ic('Manager'), { meydan: m.meydan, tur: m.tur });
    expect(pk.s, pk.metin).toBe(200);
    const po = await istek('POST', '/api/magaza/panel/oturum', siteBasligi(), { kod: String(pk.j.donus).split('#kod=')[1].split('&tur=')[0], dogrulayici: m.dogrulayici });
    expect(po.s, po.metin).toBe(200);
    await new Promise(r => setTimeout(r, 5));
    expect((await istek('POST', '/api/db/session/logout', ic('Manager'), {})).s).toBe(200);
    expect((await istek('GET', '/api/magaza/panel/siparisler', siteBasligi(String(po.j.token)))).s).toBe(401);
  });

  it('bayat çerez (A) + Bearer (B) → yalnız B iptal edilir; bozuk Bearer + çerez yok → 200, sayaç +1, iptal yok', async () => {
    const cerezYanit = await istek('POST', '/api/db/session', ic('Purchasing'), {});
    const cerez = String((cerezYanit.basliklar['set-cookie'] ?? [])[0] ?? '').split(';')[0];
    expect(cerez).toMatch(/=/);
    const b = await bayi('cikis-bearer-b');
    const revokeA = revokeSayisi(icUid('Purchasing'));
    expect((await istek('POST', '/api/db/session/logout', { ...yetki(b), Cookie: cerez }, {})).s).toBe(200);
    expect(revokeSayisi(b)).toBe(1);
    expect(revokeSayisi(icUid('Purchasing'))).toBe(revokeA);
    expect(await belgeOku('magazaPanelIptal', b)).toBeDefined();
    expect(await belgeOku('magazaPanelIptal', icUid('Purchasing'))).toBeUndefined();   // bayat çerezin sahibine iptal YAZILMADI
    const once = magazaPanelSayaclari().cikisUidsiz;
    const toplam = hesapCagrilari().filter(c => c.ne === 'revoke').length;
    expect((await istek('POST', '/api/db/session/logout', { Authorization: 'Bearer bozuk' }, {})).s).toBe(200);
    expect(magazaPanelSayaclari().cikisUidsiz - once).toBe(1);
    expect(hesapCagrilari().filter(c => c.ne === 'revoke').length).toBe(toplam);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('H6 / H7 / H8 — hesap yönetimi: dış rol yalnız Yönetici, yalnız cariyle, davetle değil', () => {
  it('Müdür dış rol hesabı AÇAMAZ, SİLEMEZ, belgesini YAZAMAZ / SİLEMEZ (403, yan etki yok)', async () => {
    const hedef = await bayi('yonetim-hedef');
    const acilis = hesapCagrilari().length;
    const ac = await istek('POST', '/api/admin/users', ic('Manager'), { email: 'yeni-bayi@example.test', role: 'Dealer', leadId: 'L1' });
    expect([ac.s, ac.j.code]).toEqual([403, 'YONETICI_GEREKLI']);
    expect((await istek('DELETE', `/api/admin/users/${hedef}`, ic('Manager'))).s).toBe(403);
    expect(hesapCagrilari().length).toBe(acilis);                                               // Auth hesabı açılmadı / silinmedi
    const once = JSON.stringify(await belgeOku('users', hedef));
    expect((await istek('PUT', `/api/db/users/${hedef}`, ic('Manager'), { email: 'x@example.test', displayName: 'Ezildi' })).s).toBe(403);
    expect((await istek('DELETE', `/api/db/users/${hedef}`, ic('Manager'))).s).toBe(403);
    expect(JSON.stringify(await belgeOku('users', hedef))).toBe(once);
  });

  it('Yönetici: `leadId`\'siz 400; başka kiracının lead\'i 404 ve Auth hesabı AÇILMAZ; geçerli lead → 200 ve bağ yazılır (kırpılmış kod, `acik`)', async () => {
    const acilis = hesapCagrilari().filter(c => c.ne === 'ac').length;
    expect((await istek('POST', '/api/admin/users', ic('Admin'), { email: 'b-yok@example.test', role: 'Dealer' })).s).toBe(400);
    expect((await istek('POST', '/api/admin/users', ic('Admin'), { email: 'b-baska@example.test', role: 'B2B', leadId: 'L-BASKA' })).s).toBe(404);
    expect(hesapCagrilari().filter(c => c.ne === 'ac').length).toBe(acilis);
    const r = await istek('POST', '/api/admin/users', ic('Admin'), { email: 'b-tamam@example.test', role: 'Dealer', leadId: 'L1' });
    expect(r.s, r.metin).toBe(200);
    expect(r.j.bagYok).toBeUndefined();
    const uid = String(r.j.uid);
    expect(await belgeOku('musteriHesaplari', uid)).toMatchObject({ companyId: KIRACI, leadId: 'L1', cariKod: '120.01.0042', durum: 'acik', firma: 'Örnek Yapı Market Ltd. Şti.' });
    expect(await belgeOku('users', uid)).toMatchObject({ role: 'Dealer', companyId: KIRACI });
  });

  it('bağ yazımı hata verirse hesap KALIR: `{ success: true, uid, bagYok: true }` (Yönetici «Cari bağla» görür)', async () => {
    sorguKancasi((sql, p) => { if (sql.startsWith('INSERT INTO docs') && p[0] === 'musteriHesaplari') throw Object.assign(new Error('yazma'), { code: '57P01' }); });
    let r: Yanit;
    try { r = await istek('POST', '/api/admin/users', ic('Admin'), { email: 'bag-hata@example.test', role: 'B2B', leadId: 'L1' }); } finally { sorguKancasi(undefined); }
    expect([r.s, r.j.success, r.j.bagYok], r.metin).toEqual([200, true, true]);
    expect(await belgeOku('users', String(r.j.uid))).toMatchObject({ role: 'B2B' });
    expect(await belgeOku('musteriHesaplari', String(r.j.uid))).toBeUndefined();
    // Bağsız müşteri hesabı köprüden geçemez.
    expect((await bayiKodu(yetki(String(r.j.uid), { ep: 'bag-hata@example.test' }))).r.j.kod).toBe('bag-yok');
  });

  it('`/api/db` ile `{ role: \'Dealer\' }` Yönetici ve süper yönetici için de 403 `DIS_ROL_UCLA` (PUT, PATCH, cas); rol yazılmaz', async () => {
    await belgeKoy('users', 'personel-cevir', { email: eposta('personel-cevir'), role: 'Sales', companyId: KIRACI });
    // Yönetici başkasının belgesine; süper yönetici KENDİ belgesine (rol yazımı muafiyetinin olduğu tek yer — kural ondan ÖNCE).
    for (const [kim, b, hedef] of [['Yönetici', ic('Admin'), 'personel-cevir'], ['süper', SUPER, 'super-1']] as const) {
      const put = await istek('PUT', `/api/db/users/${hedef}?merge=1`, b, { role: 'Dealer' });
      expect([kim, put.s, put.j.code]).toEqual([kim, 403, 'DIS_ROL_UCLA']);
      const patch = await istek('PATCH', `/api/db/users/${hedef}`, b, { role: 'B2B' });
      expect([kim, patch.s, patch.j.code]).toEqual([kim, 403, 'DIS_ROL_UCLA']);
      const cas = await istek('PATCH', `/api/db/users/${hedef}/cas`, b, { field: 'role', expect: 'Sales', set: { role: 'Dealer' } });
      expect([kim, cas.s, cas.j.code]).toEqual([kim, 403, 'DIS_ROL_UCLA']);
    }
    expect((await belgeOku('users', 'personel-cevir'))?.role).toBe('Sales');
    expect((await belgeOku('users', 'super-1'))?.role).toBeUndefined();
    // İç rol yazımı DEĞİŞMEDİ: Yönetici personelin rolünü yine değiştirebilir.
    expect((await istek('PUT', '/api/db/users/personel-cevir?merge=1', ic('Admin'), { role: 'Logistics' })).s).toBe(200);
  });

  it('davet: iki davet ucunda dış rol 400 ve `invites` yazılmaz; dış rollü ESKİ davetin kabulü 409, `users` yazılmaz, davet kullanılmış SAYILMAZ', async () => {
    const once = await say("SELECT count(*)::int AS n FROM docs WHERE coll = 'invites'");
    const d1 = await istek('POST', '/api/admin/invite', ic('Admin'), { email: 'davet-bayi@example.test', role: 'Dealer' });
    expect([d1.s, d1.j.code]).toEqual([400, 'DIS_ROL_DAVETLE_ACILMAZ']);
    const d2 = await istek('POST', `/api/superadmin/tenants/${KIRACI}/invite`, SUPER, { email: 'davet-b2b@example.test', role: 'B2B' });
    expect([d2.s, d2.j.code]).toEqual([400, 'DIS_ROL_DAVETLE_ACILMAZ']);
    expect(await say("SELECT count(*)::int AS n FROM docs WHERE coll = 'invites'")).toBe(once);
    await belgeKoy('invites', 'eski-davet', { email: eposta('davetli-bayi'), role: 'Dealer', companyId: KIRACI, used: false, expiresAt: new Date(Date.now() + 86_400_000).toISOString() });
    const k = await istek('POST', '/api/invites/redeem', yetki('davetli-bayi'), { token: 'eski-davet' });
    expect([k.s, k.j.code, k.j.success]).toEqual([409, 'DIS_ROL_DAVETLE_ACILMAZ', false]);
    expect(await belgeOku('users', 'davetli-bayi')).toBeUndefined();
    expect((await belgeOku('invites', 'eski-davet'))?.used).toBe(false);
  });

  it('bayi Satış\'a çevrilince (Yönetici, `/api/db`) açık bayi belirteci 401; panelKullanicisi okunamazsa 503', async () => {
    const uid = await bayi('cevir-1');
    const t = await bayiBelirteci(uid);
    expect((await ben(t)).s).toBe(200);
    const r = await istek('PUT', `/api/db/users/${uid}?merge=1`, ic('Admin'), { role: 'Sales' });
    expect(r.s, r.metin).toBe(200);
    expect((await ben(t)).s).toBe(401);
    const u2 = await bayi('okuma-503');
    const t2 = await bayiBelirteci(u2);
    await istek('PUT', `/api/db/users/${u2}?merge=1`, ic('Admin'), { displayName: 'önbellek düşsün' });
    sorguKancasi((sql, p) => { if (sql.startsWith('SELECT data FROM docs') && p[0] === 'users' && p[1] === u2) throw Object.assign(new Error('okuma'), { code: '57P01' }); });
    try { expect([(await ben(t2)).s, (await ben(t2)).j]).toEqual([503, { ok: false }]); } finally { sorguKancasi(undefined); }
  });

  it('silinen bayinin belirteci 401 ve bağı `kapali` (sıra: bağ → iptal → Auth → users); `/api/db` ile silinen `users` (bağ açık) → yine 401', async () => {
    const uid = await bayi('silinen-1');
    const t = await bayiBelirteci(uid);
    const r = await istek('DELETE', `/api/admin/users/${uid}`, ic('Admin'));
    expect(r.s, r.metin).toBe(200);
    expect(hesapCagrilari().filter(c => c.ne === 'sil' && c.kim === uid)).toHaveLength(1);
    expect((await belgeOku('musteriHesaplari', uid))?.durum).toBe('kapali');
    expect(await belgeOku('magazaPanelIptal', uid)).toBeDefined();
    expect(await belgeOku('users', uid)).toBeUndefined();
    expect((await ben(t)).s).toBe(401);
    const u2 = await bayi('silinen-2');
    const t2 = await bayiBelirteci(u2);
    expect((await istek('DELETE', `/api/db/users/${u2}`, ic('Admin'))).s).toBe(200);
    expect((await belgeOku('musteriHesaplari', u2))?.durum).toBe('acik');
    expect((await ben(t2)).s).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('H9 / H15 — bağ uçları (yalnız Yönetici) ve SERVER_ONLY', () => {
  it('Müdür, dış rol ve rolsüz üç uçta 403; Yönetici liste 200, yalnız kendi kiracısı, ham `cariKod` / `olusturan` YOK', async () => {
    const hedef = await bayi('bag-liste');
    await belgeKoy('users', 'yabanci-bayi', { email: eposta('yabanci-bayi'), role: 'Dealer', companyId: BASKA });
    await bagKoy('yabanci-bayi', { leadId: 'L-BASKA', companyId: BASKA });
    for (const b of [ic('Manager'), yetki(hedef), yetki('rolsuz-1')]) {
      expect((await istek('GET', '/api/admin/musteri-hesaplari', b)).s).toBe(403);
      expect((await istek('PUT', `/api/admin/musteri-hesaplari/${hedef}`, b, { leadId: 'L1' })).s).toBe(403);
      expect((await istek('POST', `/api/admin/musteri-hesaplari/${hedef}/durum`, b, { durum: 'kapali' })).s).toBe(403);
    }
    expect((await belgeOku('musteriHesaplari', hedef))?.durum).toBe('acik');
    const r = await istek('GET', '/api/admin/musteri-hesaplari', ic('Admin'));
    expect(r.s, r.metin).toBe(200);
    const hesaplar = r.j.hesaplar as Array<Record<string, unknown>>;
    expect(hesaplar.some(h => h.uid === 'yabanci-bayi')).toBe(false);
    const benim = hesaplar.find(h => h.uid === hedef);
    expect(benim).toEqual({ uid: hedef, leadId: 'L1', firma: 'Örnek Yapı Market', durum: 'acik', guncelleme: '2026-10-21T08:00:00.000Z', cariKodDurumu: 'uyusuyor' });
    expect(r.metin).not.toMatch(/"cariKod"|olusturan|120\.01/);
  });

  it('PUT: başka kiracının lead\'i 404; iç role bağ 400 `dis-rol-degil`; gövdede fazladan alan 400; `leadId` değişince eski bayi belirteci 401', async () => {
    const uid = await bayi('bag-degis');
    const t = await bayiBelirteci(uid);
    expect((await istek('PUT', `/api/admin/musteri-hesaplari/${uid}`, ic('Admin'), { leadId: 'L-BASKA' })).s).toBe(404);
    const ici = await istek('PUT', `/api/admin/musteri-hesaplari/${icUid('Sales')}`, ic('Admin'), { leadId: 'L1' });
    expect([ici.s, ici.j.kod]).toEqual([400, 'dis-rol-degil']);
    expect((await istek('PUT', `/api/admin/musteri-hesaplari/${uid}`, ic('Admin'), { leadId: 'L2', cariKod: 'X' })).s).toBe(400);
    expect((await ben(t)).s).toBe(200);
    const r = await istek('PUT', `/api/admin/musteri-hesaplari/${uid}`, ic('Admin'), { leadId: 'L2' });
    expect([r.s, r.j.ok, r.j.cariKodDurumu, r.j.mfSayisi], r.metin).toEqual([200, true, 'uyusuyor', 0]);
    expect((await ben(t)).s).toBe(401);
  });

  it('kiracılar arası: Yönetici BAŞKA kiracının müşteri hesabına bağ KURAMAZ (o kiracının lead\'iyle bile) ve erişimini değiştiremez → 403, yazım yok', async () => {
    // Hedefin kiracısı oturum kiracısından farklıysa (süper yönetici hariç) ret. Lead denetimi hedefin kiracısıyla yapıldığı için bu
    // kapı olmadan BASKA kiracının hesabı BASKA kiracının lead'ine bağlanabilirdi (2026-10-21 paket turu mutasyonu M43).
    await belgeKoy('users', 'yabanci-bag', { email: eposta('yabanci-bag'), role: 'Dealer', companyId: BASKA });
    const put = await istek('PUT', '/api/admin/musteri-hesaplari/yabanci-bag', ic('Admin'), { leadId: 'L-BASKA' });
    expect(put.s, put.metin).toBe(403);
    expect(await belgeOku('musteriHesaplari', 'yabanci-bag')).toBeUndefined();
    await bagKoy('yabanci-bag', { leadId: 'L-BASKA', companyId: BASKA });
    const kapat = await istek('POST', '/api/admin/musteri-hesaplari/yabanci-bag/durum', ic('Admin'), { durum: 'kapali' });
    expect(kapat.s, kapat.metin).toBe(403);
    expect((await belgeOku('musteriHesaplari', 'yabanci-bag'))?.durum).toBe('acik');
    expect(await belgeOku('magazaPanelIptal', 'yabanci-bag')).toBeUndefined();
  });

  it('kodsuz lead → bağ kurulur, MF yok (`mfSayisi: 0`); lead\'e kod yazılıp PUT tekrarlanınca (tazeleme) MF listelenir ve denetim kaydında eski / yeni kod var', async () => {
    const r0 = await istek('POST', '/api/admin/users', ic('Admin'), { email: 'tazele@example.test', role: 'Dealer', leadId: 'L-KODSUZ' });
    expect(r0.s, r0.metin).toBe(200);
    const uid = String(r0.j.uid);
    expect((await belgeOku('musteriHesaplari', uid))?.cariKod).toBeNull();
    const t = await bayiBelirteci(uid);
    expect(((await siparisler(t)).j.siparisler as Array<Record<string, unknown>>).map(s => s.no)).toEqual(['SAS-K']);
    await belgeKoy('leads', 'L-KODSUZ', { companyId: KIRACI, name: 'Kodsuz Usta', mikroCariKod: '120.01.0042 ' });
    const liste = (await istek('GET', '/api/admin/musteri-hesaplari', ic('Admin'))).j.hesaplar as Array<Record<string, unknown>>;
    expect(liste.find(h => h.uid === uid)?.cariKodDurumu).toBe('farkli');
    const r = await istek('PUT', `/api/admin/musteri-hesaplari/${uid}`, ic('Admin'), { leadId: 'L-KODSUZ' });
    expect([r.s, r.j.cariKodDurumu, r.j.mfSayisi]).toEqual([200, 'uyusuyor', 1]);
    expect((await ben(t)).s).toBe(401);                                                           // kod değişti → oturum kapandı
    const t2 = await bayiBelirteci(uid, { authTime: simdiSn() + 1 });
    expect(((await siparisler(t2)).j.siparisler as Array<Record<string, unknown>>).map(s => s.no)).toEqual(['SAS-K', 'MF-CTP42']);
    const denetim = (await pg().query("SELECT data FROM docs WHERE coll = 'auditLog' AND data->>'action' = 'musteri_hesap_bag' AND data->>'details' LIKE $1", [`${uid}:%`])).rows.map(x => String((x.data as Record<string, unknown>).details));
    expect(denetim.some(d => d.includes('cari — → 120.01.0042'))).toBe(true);
  });

  it('kapatmada iptal yazılamazsa 200 + `iptalYazilamadi`, belirteç yine 401 (kapı bağı okur); kapatma Firebase yenileme iptali ister', async () => {
    const uid = await bayi('kapat-hata');
    const t = await bayiBelirteci(uid);
    sorguKancasi((sql, p) => { if (sql.startsWith('INSERT INTO docs') && p[0] === 'magazaPanelIptal' && p[1] === uid) throw Object.assign(new Error('yazma'), { code: '57P01' }); });
    let r: Yanit;
    try { r = await istek('POST', `/api/admin/musteri-hesaplari/${uid}/durum`, ic('Admin'), { durum: 'kapali' }); } finally { sorguKancasi(undefined); }
    expect([r.s, r.j.ok, r.j.iptalYazilamadi], r.metin).toEqual([200, true, true]);
    expect((await belgeOku('musteriHesaplari', uid))?.durum).toBe('kapali');
    expect(revokeSayisi(uid)).toBe(1);
    expect((await ben(t)).s).toBe(401);
    expect((await istek('POST', '/api/admin/musteri-hesaplari/yok-uid/durum', ic('Admin'), { durum: 'kapali' })).s).toBe(404);
  });

  it('`/api/db` ile `musteriHesaplari` okunamaz / yazılamaz (SERVER_ONLY) — Yönetici ve süper yönetici dâhil', async () => {
    await bayi('db-kapali');
    for (const b of [ic('Admin'), SUPER]) {
      expect((await istek('GET', '/api/db/musteriHesaplari', b)).s).toBe(403);
      expect((await istek('GET', '/api/db/musteriHesaplari/db-kapali', b)).s).toBe(403);
      expect((await istek('PUT', '/api/db/musteriHesaplari/db-kapali', b, { durum: 'acik', leadId: 'L2' })).s).toBe(403);
      expect((await istek('POST', '/api/db/musteriHesaplari', b, { leadId: 'L2' })).s).toBe(403);
      expect((await istek('DELETE', '/api/db/musteriHesaplari/db-kapali', b)).s).toBe(403);
    }
    expect(await belgeOku('musteriHesaplari', 'db-kapali')).toMatchObject({ leadId: 'L1' });
  });

  it('«yazıldı ama bağlanmadı»: yeni uçlar gerçek uygulamada TAM bir kez ve kapılarıyla kayıtlı', () => {
    const uclar = rotaDokumu();
    const bul = (y: string, d: string) => uclar.filter(u => u.yontem === y && u.desen === d);
    for (const [y, d] of [['GET', '/api/magaza-bayi/hesap'], ['POST', '/api/magaza-bayi/yetki-kodu'], ['GET', '/api/admin/musteri-hesaplari'],
      ['PUT', '/api/admin/musteri-hesaplari/:uid'], ['POST', '/api/admin/musteri-hesaplari/:uid/durum']] as const) {
      expect(bul(y, d), `${y} ${d}`).toHaveLength(1);
      expect(bul(y, d)[0].adlar, `${y} ${d}`).toContain('requireAuth');
      expect(bul(y, d)[0].adlar, `${y} ${d}`).toContain('requireMfaVerified');
    }
    for (const [y, d] of [['POST', '/oturum'], ['GET', '/ben'], ['GET', '/siparisler'], ['POST', '/cikis']] as const) expect(bul(y, d).length, `${y} ${d}`).toBeGreaterThanOrEqual(1);
  });
});
