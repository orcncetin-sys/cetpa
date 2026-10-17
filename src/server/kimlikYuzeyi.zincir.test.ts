// @vitest-environment node
/**
 * kimlikYuzeyi.zincir.test.ts — TEK BOĞAZ, GERÇEK `server.ts` + GERÇEK express zinciriyle (şartname «dış rol kapanışı»
 * D1 / D3 / D4′ / D8 · T2 + T3 + T7).
 *
 * NEDEN GERÇEK ZİNCİR: kapı `requireAuth`'un içinde ve `server.ts` içe aktarılamayan kapanışlarla dolu; saf karar testleri
 * (lib/kimlikYuzeyi.test.ts) kapının zincire BAĞLI olduğunu, sınırlayıcılarla / yöntem tüneliyle / gövde ayrıştırıcıyla sırasını ve
 * rota modüllerine giden bağlamı kanıtlamaz. Burada `server.ts` olduğu gibi içe aktarılır ve gerçek bir kapıda dinler.
 *
 * SAHTE OLANLAR (yalnız süreç dışına çıkan her şey): Firebase belirteç doğrulayıcısı (belirteç = "<uid>|<e-posta>|<1|0>"),
 * `pg` havuzu (süreç içi PGlite), pg-boss, node-cron, vite, `dotenv` (hiçbir ortam dosyası YÜKLENMEZ) ve dışarı giden `fetch`
 * (kaydedilir, hiçbir yere gitmez). Canlıya, Firebase'e, Mikro'ya istek YOK. Sunucu `PORT=0` ile boş bir kapıda açılır ve
 * `afterAll`'da kapatılır.
 *
 * NE ÖLÇÜLÜR:
 *  • D8 — uç listesi elle YAZILMAZ: gerçek uygulamanın yönlendiricisinden zincirinde `requireAuth` olan HER rota toplanır;
 *    rolsüz hesap (belgesiz / rol alanı yok / rol alanı geçersiz) ve dış rol (Bayi, B2B) her birine gerçek HTTP isteği atar →
 *    403 + `code`. Yeni `requireAuth`'lu uç eklenince kendiliğinden kapsanır. Taramanın 37 ucu (11 + 26) bu kümenin içindedir.
 *  • İç rol: aynı rotaların HEPSİNDE gerçek `requireAuth` işlevi her iç rol ve süper yönetici için `next()` der (işleyici
 *    koşturulmaz — yan etkisiz tam tarama); seçilmiş uçlarda gerçek HTTP ile bugünkü yanıt (taban sürümde ölçülmüş durum kodları).
 *  • T2 — dış rol: stok, teklif, tek belge, yazma, art arda yazma, akış → 403 / olay yok; kendi `users/<uid>` → 200.
 *  • T7 — izin listesindeki her yol rolsüz hesapta çalışır: oturum açılışı, iki adımlı doğrulama kaydı, davet kabulü.
 *  • Rol okunamadı → 503 (ret değil); yöntem tüneli ve yol yazımı izin listesini aşamaz.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { generateSync as totpKodu } from 'otplib';
import { EXTERNAL_ROLES, STAFF_ROLES, type AppRole } from '../lib/rbac';
import { ROLSUZ_IZINLI_YOLLAR, istekYolu, rolsuzIzinliMi, type KimlikYuzeyiKodu } from '../lib/kimlikYuzeyi';

// ── Sahteler (yalnız süreç dışına çıkanlar) ────────────────────────────────────────────────────────────────────────────────
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
  g.__kimlikYuzeyiPg = db;
  const q = async (text: unknown, params?: unknown[]) => {
    let sql = String(text); let p = params;
    if (text && typeof text === 'object') { const o = text as { text: string; values?: unknown[] }; sql = o.text; p = o.values; }
    // Arıza kancası: «rol okunamadı» sınaması belirli sorguları fırlatır (gerçek havuzun bağlantı hatası gibi).
    const ariza = g.__kimlikYuzeyiAriza as ((sql: string, p: unknown[] | undefined) => boolean) | undefined;
    if (ariza?.(sql, p)) throw new Error('bağlantı koptu (sınama arızası)');
    if (!p || p.length === 0) {
      const r = await db.exec(sql);
      const son = r[r.length - 1];
      if (!son) return { rows: [], rowCount: null };                              // boş betik: `pg` de satır sayısı vermez
      return { rows: son.rows, rowCount: son.affectedRows ?? son.rows.length };
    }
    const r = await db.query(sql, p);
    return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
  };
  class Pool { query = q; async connect() { return { query: q, release() {} }; } on() {} async end() {} }
  class Client { query = q; async connect() {} async end() {} on() {} }
  return { default: { Pool, Client }, Pool, Client };
});

// Paralel koşan takımın yükü altında tek tek istekler yavaşlayabilir: sınama başına süre gevşek (düzenek kurulumu ayrıca süreli).
vi.setConfig({ testTimeout: 90_000 });

// ── Düzenek ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
interface Pg { query: (sql: string, p?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> }
const G = globalThis as Record<string, unknown>;
const pg = (): Pg => G.__kimlikYuzeyiPg as Pg;
const arizaKur = (f: ((sql: string, p: unknown[] | undefined) => boolean) | undefined): void => { G.__kimlikYuzeyiAriza = f; };

interface Katman { name?: string; method?: string; handle: (...a: unknown[]) => unknown; route?: { path: unknown; methods: Record<string, boolean>; stack: Katman[] } }
interface Uygulama { router: { stack: Katman[] } }
type Kapi = (req: unknown, res: unknown, next: () => void) => Promise<void>;

let sunucu: http.Server | undefined;
let uygulama: Uygulama | undefined;
let kapiNo = 0;
let yuklemeDizini = '';
const gercekFetch = globalThis.fetch;
/** Sunucunun DIŞARI yapmaya çalıştığı her istek (hiçbiri gitmez). */
const disari: string[] = [];

const KIRACI = 'CETPA';
const SUPER_EPOSTA = 'super@example.test';
const eposta = (uid: string): string => `${uid.toLowerCase()}@example.test`;
const belirtec = (uid: string, ep = eposta(uid), dogrulanmis = true): Record<string, string> => ({ Authorization: `Bearer ${uid}|${ep}|${dogrulanmis ? 1 : 0}` });

interface Yanit { s: number; j: Record<string, unknown>; metin: string; basliklar: http.IncomingHttpHeaders }
let ipSayaci = 0;
/** Her istek ayrı «istemci IP'si» taşır (vekilin yazdığı gibi): IP anahtarlı sınırlayıcılar sınamayı kesmesin. */
const sonrakiIp = (): string => { ipSayaci++; return `10.${(ipSayaci >> 16) & 255}.${(ipSayaci >> 8) & 255}.${ipSayaci & 255}`; };

/** HAM istek: yol olduğu gibi gider (büyük harf, kaçış, çift eğik çizgi korunur — `fetch` yolu normalleştirirdi). */
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
        coz({ s: durum, j, metin, basliklar: r.headers });
      });
    });
    q.setTimeout(20_000, () => q.destroy(new Error(`zaman aşımı: ${yontem} ${yol}`)));
    q.on('error', reddet);
    if (veri !== undefined) q.write(veri);
    q.end();
  });
}

/** Akış bağlantısı: yanıt başlıkları gelince çözülür; gövde birikir. */
function akisAc(yol: string, basliklar: Record<string, string>): Promise<{ s: number; govde: () => string; kapat: () => void }> {
  return new Promise((coz, reddet) => {
    const q = http.request({ host: '127.0.0.1', port: kapiNo, method: 'GET', path: yol, agent: false, headers: { 'X-Forwarded-For': sonrakiIp(), ...basliklar } }, r => {
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
  while (Date.now() < son) { if (await kosul()) return; await new Promise(r => setTimeout(r, 50)); }
  throw new Error(`beklenen olmadı (${ms} ms): ${ne}`);
};

const belgeKoy = (coll: string, id: string, data: Record<string, unknown>): Promise<unknown> =>
  pg().query('INSERT INTO docs (coll, id, data) VALUES ($1, $2, $3::jsonb) ON CONFLICT (coll, id) DO UPDATE SET data = EXCLUDED.data', [coll, id, JSON.stringify(data)]);
const belgeOku = async (coll: string, id: string): Promise<Record<string, unknown> | undefined> =>
  (await pg().query('SELECT data FROM docs WHERE coll = $1 AND id = $2', [coll, id])).rows[0]?.data as Record<string, unknown> | undefined;

// ── Kimlikler ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** İç rolü OLMAYAN beş hesap türü. */
type Disarida = 'belgesiz' | 'rolsuz' | 'cop' | 'Dealer' | 'B2B';
const DISARIDAKILER: readonly Disarida[] = ['belgesiz', 'rolsuz', 'cop', 'Dealer', 'B2B'];
const beklenenKod = (k: Disarida): KimlikYuzeyiKodu => (k === 'Dealer' || k === 'B2B' ? 'DIS_ROL' : 'ROL_YOK');
const kullaniciBelgesi = (k: Disarida, uid: string): Record<string, unknown> | null => {
  if (k === 'belgesiz') return null;                                             // hesap açmış, `users` belgesi hiç yazılmamış
  if (k === 'rolsuz') return { email: eposta(uid), displayName: 'Yabancı' };     // istemcinin açılış yazımı: rol / kiracı alanı yok
  if (k === 'cop') return { email: eposta(uid), role: 1 };                       // rol alanında geçersiz değer (eski `/increment` yolu)
  return { email: eposta(uid), role: k, companyId: KIRACI };                     // gerçek kiracıda dış rol
};
const hazirKimlikler = new Map<string, Promise<unknown>>();
/** Adı verilen kimliği (gerekirse `users` belgesiyle) kurar. Belge sunucu önbelleğine girmeden ÖNCE yazılır (uid yeni). */
async function kimlik(k: Disarida, ad: string): Promise<{ uid: string; b: Record<string, string> }> {
  const uid = `${k.toLowerCase()}-${ad}`;
  let hazir = hazirKimlikler.get(uid);
  if (!hazir) { const belge = kullaniciBelgesi(k, uid); hazir = belge ? belgeKoy('users', uid, belge) : Promise.resolve(); hazirKimlikler.set(uid, hazir); }
  await hazir;
  return { uid, b: belirtec(uid) };
}
const icUid = (rol: AppRole): string => `ic-${rol}`;
const ic = (rol: AppRole): Record<string, string> => belirtec(icUid(rol));
const SUPER = belirtec('super-1', SUPER_EPOSTA);

// ── Rota dökümü: gerçek uygulamanın yönlendiricisinden ─────────────────────────────────────────────────────────────────────
interface Uc { yontem: string; desen: string; zincir: string[]; onceki: Katman[] }
const PARAM: Record<string, string> = { coll: 'inventory' };
const somutYol = (desen: string): string => desen.replace(/:([A-Za-z0-9_]+)/g, (_t, ad: string) => PARAM[ad] ?? 'x1');
function rotaDokumu(): { uclar: Uc[]; desteklenmeyen: string[]; kapilar: Set<Katman['handle']> } {
  if (!uygulama) throw new Error('uygulama yakalanmadı');
  const uclar: Uc[] = []; const desteklenmeyen: string[] = []; const kapilar = new Set<Katman['handle']>();
  const gez = (yigin: Katman[], icIce: boolean): void => {
    for (const k of yigin) {
      const alt = (k.handle as unknown as { stack?: Katman[] }).stack;
      if (!k.route) { if (Array.isArray(alt)) gez(alt, true); continue; }
      const kimlikli = k.route.stack.filter(s => s.name === 'requireAuth');
      if (!kimlikli.length) continue;
      for (const s of kimlikli) kapilar.add(s.handle);
      const yollar = Array.isArray(k.route.path) ? k.route.path : [k.route.path];
      for (const y of yollar) {
        // İç içe yönlendiricide ya da dize olmayan / joker taşıyan yolda sınama somut adres üretemez: sessizce atlamak yerine bildirir.
        if (icIce || typeof y !== 'string' || /[*{}()+?[\]]/.test(y)) { desteklenmeyen.push(String(y)); continue; }
        for (const [m, acik] of Object.entries(k.route.methods)) {
          if (!acik) continue;
          if (m === '_all') { desteklenmeyen.push(`ALL ${y}`); continue; }
          const zincir = k.route.stack.filter(s => !s.method || s.method === m);
          uclar.push({ yontem: m.toUpperCase(), desen: y, zincir: zincir.map(s => s.name || '(adsız)'), onceki: zincir.slice(0, zincir.findIndex(s => s.name === 'requireAuth')) });
        }
      }
    }
  };
  gez(uygulama.router.stack, false);
  return { uclar, desteklenmeyen, kapilar };
}
const havuz = async <T, R>(girdiler: readonly T[], es: number, is: (g: T) => Promise<R>): Promise<R[]> => {
  const cikti: R[] = new Array<R>(girdiler.length);
  let sira = 0;
  await Promise.all(Array.from({ length: es }, async () => { for (;;) { const i = sira++; if (i >= girdiler.length) return; cikti[i] = await is(girdiler[i]); } }));
  return cikti;
};

/** İç rol / süper yönetici isteklerinin dökümü — `KIMLIK_YUZEYI_DOKUM=<dosya>` verilirse yazılır (taban sürümle karşılaştırma). */
const dokum: Array<{ kim: string; istek: string; s: number; anahtarlar: string[]; hata: unknown; code: unknown }> = [];
async function icIstek(kim: string, b: Record<string, string>, yontem: string, yol: string, govde?: unknown): Promise<Yanit> {
  const r = await istek(yontem, yol, b, govde);
  dokum.push({ kim, istek: `${yontem} ${yol}`, s: r.s, anahtarlar: Object.keys(r.j).sort(), hata: r.j.error, code: r.j.code });
  return r;
}

beforeAll(async () => {
  yuklemeDizini = fs.mkdtempSync(path.join(os.tmpdir(), 'kimlik-yuzeyi-'));
  process.env.PORT = '0';                                  // boş kapı; gerçek numara aşağıda dinleyiciden okunur
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgres://sinama/yok';      // yalnız «PG var» dalını açar; havuz PGlite
  process.env.SESSION_TOKEN_SECRET = 'sinama-sirri';
  process.env.UPLOAD_DIR = yuklemeDizini;
  process.env.SUPER_ADMIN_EMAILS = SUPER_EPOSTA;
  process.env.SERVER_TENANT_COMPANY_ID = KIRACI;
  // Kabuktan sızmış olabilecek dış sistem kimlikleri: bu sınama hiçbirini kullanmaz.
  for (const ad of Object.keys(process.env)) {
    if (/^(STRIPE|RESEND|LUCA|SHOPIFY|SMTP|GEMINI|ANTHROPIC|MIKRO|IYZICO|TRENDYOL|HEPSIBURADA|DHL|UPS|FEDEX|YURTICI|MNG|ARAS|WHATSAPP|FIREBASE|GOOGLE_APPLICATION|OPS_)/.test(ad)) delete process.env[ad];
  }
  globalThis.fetch = (async (girdi: unknown, init?: RequestInit) => {
    const url = String(typeof girdi === 'string' ? girdi : (girdi as { url?: string }).url ?? girdi);
    disari.push(`${init?.method ?? 'GET'} ${url.replace(/\?.*$/, '')}`);
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;

  const dinleyiciCasusu = vi.spyOn(http, 'createServer');
  await import('../../server.ts');
  // `startServer()` beklenmeden çağrılır: dinleyici kurulana ve dinlemeye geçene kadar bekle.
  await bekle(() => dinleyiciCasusu.mock.results.some(r => r.type === 'return'), 150_000, 'sunucu dinleyicisi kuruldu');
  const cagri = dinleyiciCasusu.mock.calls.findIndex(a => typeof a[0] === 'function');
  uygulama = dinleyiciCasusu.mock.calls[cagri][0] as unknown as Uygulama;
  sunucu = dinleyiciCasusu.mock.results[cagri].value as http.Server;
  dinleyiciCasusu.mockRestore();
  await bekle(() => sunucu?.listening === true, 30_000, 'sunucu dinliyor');
  kapiNo = (sunucu.address() as AddressInfo).port;
  await bekle(async () => {
    const r = await pg().query("SELECT to_regclass('docs') AS d, to_regclass('mfa_secrets') AS m, to_regclass('mikro_stok_hareketleri') AS s, to_regclass('mikro_cari_hesaplar') AS c");
    const t = r.rows[0]; return !!(t.d && t.m && t.s && t.c);
  }, 60_000, 'tablolar hazır');

  // Gerçek kiracı = CETPA: her iç rolden bir kullanıcı + dış role ESKİDEN açık olan veriler.
  for (const rol of STAFF_ROLES) await belgeKoy('users', icUid(rol), { email: eposta(icUid(rol)), role: rol, companyId: KIRACI });
  await belgeKoy('inventory', 'mikro-DYO-001', { sku: 'DYO-001', name: 'DYO Boya 15 L', stockLevel: 1, lowStockThreshold: 5, costPrice: 812.5, supplier: 'GİZLİ TEDARİKÇİ A.Ş.', companyId: KIRACI });
  await belgeKoy('quotations', 'tek-1', { customerName: 'Başka Müşteri Ltd.', total: 184500, status: 'Sent', companyId: KIRACI });
  await belgeKoy('priceLists', 'pl-1', { name: 'Bayi listesi', companyId: KIRACI });
  await belgeKoy('priceOverrides', 'po-1', { sku: 'DYO-001', price: 1, companyId: KIRACI });
  await belgeKoy('cpqQuotes', 'cpq-1', { customerName: 'Başka Müşteri Ltd.', companyId: KIRACI });
  await belgeKoy('commissionRules', 'kom-1', { oran: 7, companyId: KIRACI });
  await belgeKoy('recurringOrders', 'yin-1', { customerName: 'Başka Müşteri Ltd.', companyId: KIRACI });
  await belgeKoy('documentTemplates', 'sab-1', { iban: 'TR00', companyId: KIRACI });
  await belgeKoy('orders', 'sip-bayinin', { customerName: 'Şirin Yapı', totalPrice: 1200, assignedTo: 'dealer-kendi', companyId: KIRACI });
  await belgeKoy('orders', 'sip-baskasinin', { customerName: 'Başka Müşteri Ltd.', totalPrice: 99000, assignedTo: icUid('Sales'), companyId: KIRACI });
  // Etiketsiz (userId'siz) bildirim: kullanıcı kapsamlı koleksiyonda herkese görünür — sipariş metni taşır.
  await belgeKoy('notifications', 'bil-etiketsiz', { message: 'Sipariş S-1 onaylandı: Başka Müşteri Ltd. 99.000 TL' });
  await pg().query("INSERT INTO mikro_cari_hesaplar (cari_kod, cari_unvan1) VALUES ('320.01.001', 'GİZLİ TEDARİKÇİ A.Ş.')");
  await pg().query(`INSERT INTO mikro_stok_hareketleri (sth_stok_kod, sth_cari_kodu, sth_tarih, veri) VALUES ('DYO-001', '320.01.001', '2026-09-30', '{"sth_tip":0,"sth_iptal":0}'::jsonb)`);
}, 240_000);

afterAll(async () => {
  arizaKur(undefined);
  globalThis.fetch = gercekFetch;
  if (process.env.KIMLIK_YUZEYI_DOKUM) fs.writeFileSync(process.env.KIMLIK_YUZEYI_DOKUM, JSON.stringify(dokum, null, 1));
  const s = sunucu;
  if (s) { s.closeAllConnections(); await new Promise<void>(r => s.close(() => r())); }
  if (yuklemeDizini) fs.rmSync(yuklemeDizini, { recursive: true, force: true });
}, 30_000);

// Taramada (2026-10-11) rolsüz hesabın ve dış rolün İŞLEYİCİYE ulaştığı 37 uç: server.ts'te 11, rota modüllerinde 26.
const TARAMA_SERVER: ReadonlyArray<[string, string]> = [
  ['GET', '/api/gib/vkn/:vkt'], ['GET', '/api/luca/kontor'], ['POST', '/api/luca/fatura-gonder'], ['POST', '/api/luca/sync/yevmiye'],
  ['POST', '/api/luca/sync/stok'], ['GET', '/api/exchange-rates/at'], ['POST', '/api/upload/tahsilat'], ['GET', '/api/inventory/son-alis-tedarikci'],
  ['POST', '/api/inventory/auto-reorder'], ['GET', '/api/integrations/health'], ['POST', '/api/sku-mapping/auto-match'],
];
const TARAMA_MODUL: ReadonlyArray<[string, string]> = [
  ['POST', '/api/ai/generate'], ['POST', '/api/ai/chat'], ['POST', '/api/ai/demand-forecast'], ['POST', '/api/ai/satis-ajani'], ['POST', '/api/ai/satinalma-ajani'],
  ['GET', '/api/tracking/dhl/:trackingNumber'], ['GET', '/api/tracking/ups/:trackingNumber'], ['POST', '/api/tracking/fedex'], ['GET', '/api/tracking/yurtici/:no'],
  ['GET', '/api/tracking/mng/:no'], ['GET', '/api/tracking/aras/:no'], ['GET', '/api/tracking/ptt/:no'],
  ['POST', '/api/logo/import/stok'], ['POST', '/api/logo/import/cari'], ['POST', '/api/logo/export/siparis'], ['POST', '/api/sap/import/stok'], ['POST', '/api/sap/import/cari'],
  ['POST', '/api/sap/export/siparis'], ['POST', '/api/sap/export/fatura'], ['POST', '/api/dynamics/export/siparis'], ['POST', '/api/dynamics/export/fatura'],
  ['POST', '/api/shopify/draft-order'], ['POST', '/api/marketplace/search'], ['POST', '/api/stripe/create-checkout'],
  ['POST', '/api/invites/redeem'], ['GET', '/api/superadmin/me'],
];

describe('D8 — zincirinde `requireAuth` olan HER uç: rolsüz hesap ve dış rol 403, iç rol ve süper yönetici geçer', () => {
  it('rota dökümü: tek bir `requireAuth` işlevi, somut adresi üretilemeyen rota yok, taramanın 37 ucu dökümde', () => {
    const { uclar, desteklenmeyen, kapilar } = rotaDokumu();
    expect(kapilar.size).toBe(1);                                   // gölge kopya / sarmalayıcı yok: her zincirde AYNI işlev
    expect(desteklenmeyen).toEqual([]);
    expect(uclar.length).toBeGreaterThan(150);
    expect(TARAMA_SERVER).toHaveLength(11); expect(TARAMA_MODUL).toHaveLength(26);
    const dokumde = new Set(uclar.map(u => `${u.yontem} ${u.desen}`));
    expect([...TARAMA_SERVER, ...TARAMA_MODUL].map(([m, y]) => `${m} ${y}`).filter(u => !dokumde.has(u))).toEqual([]);
    // Genel veri yolu ve Mikro modülü de dökümde (kapsam yalnız tarama listesi değil).
    for (const u of ['GET /api/db/:coll', 'GET /api/db/:coll/:id', 'POST /api/db/:coll', 'PUT /api/db/:coll/:id', 'PATCH /api/db/:coll/:id', 'DELETE /api/db/:coll/:id',
      'PATCH /api/db/:coll/:id/increment', 'PATCH /api/db/:coll/:id/cas', 'POST /api/mikro/token', 'POST /api/mfa/disable']) expect(dokumde, u).toContain(u);
  });

  it('kapı zincirin BAŞINDA: `requireAuth`\'tan önce yalnız hız sınırlayıcı koşar; ondan önce koşan rol / veri işleyicisi yok', () => {
    const { uclar } = rotaDokumu();
    // `requireAuth`'tan önce koşabilenler: hız sınırlayıcı (express-rate-limit örneği — `resetKey` taşır), herkese açık form
    // sınırlayıcısı ve `Cache-Control: no-store` yazan başlık ara katmanı. Başka bir şey (rol / veri okuyan işleyici) öne geçerse kırılır.
    const ADIYLA_TANINAN = new Set(['conditionalPublicLimiter', 'onbelleksiz']);
    const sinirlayiciMi = (k: Katman): boolean => typeof (k.handle as unknown as { resetKey?: unknown }).resetKey === 'function';
    const tanimsiz = uclar.flatMap(u => u.onceki.filter(k => !sinirlayiciMi(k) && !ADIYLA_TANINAN.has(k.name ?? '')).map(k => `${u.yontem} ${u.desen}: ${k.name}`));
    expect(tanimsiz, `requireAuth'tan önce koşan tanınmayan ara katman:\n${tanimsiz.join('\n')}`).toEqual([]);
    expect(uclar.some(u => u.onceki.some(sinirlayiciMi))).toBe(true);                    // tanıma ölçütü gerçekten bir şey tanıyor
    // Her zincirde `requireAuth` tam bir kez.
    expect(uclar.filter(u => u.zincir.filter(ad => ad === 'requireAuth').length !== 1).map(u => `${u.yontem} ${u.desen}`)).toEqual([]);
  });

  it('rolsüz hesap (belgesiz / rol alanı yok / rol alanı geçersiz) ve dış rol (Bayi, B2B): HER uç → 403 + `code`; işleyici koşmaz, dışarı istek çıkmaz', async () => {
    const { uclar } = rotaDokumu();
    const disariOnce = disari.length;
    const oncekiBelgeler = (await pg().query("SELECT count(*)::int AS n FROM docs WHERE coll NOT IN ('users')")).rows[0].n;
    const isler = uclar.flatMap((u, i) => DISARIDAKILER.map(k => ({ u, k, i })));
    const sonuclar = await havuz(isler, 8, async ({ u, k, i }) => {
      // Kullanıcı anahtarlı sınırlayıcılar (Mikro: 60 istek / 5 dk) sınamayı kesmesin diye her 20 uçta yeni hesap.
      const { uid, b } = await kimlik(k, `tarama-${Math.floor(i / 20)}`);
      const yol = somutYol(u.desen);
      if (rolsuzIzinliMi(u.yontem, istekYolu(yol), uid)) return null;                       // izin listesi: aşağıda ayrıca
      const r = await istek(u.yontem, yol, b, u.yontem === 'GET' || u.yontem === 'DELETE' ? undefined : {});
      return r.s === 403 && r.j.code === beklenenKod(k) ? null : `${k} ${u.yontem} ${yol} → ${r.s} ${JSON.stringify(r.j).slice(0, 160)}`;
    });
    const kacak = sonuclar.filter((s): s is string => s !== null);
    expect(kacak, `Boğazdan geçen / başka yanıt alan uç(lar):\n${kacak.join('\n')}`).toEqual([]);
    expect(sonuclar.length).toBeGreaterThan(750);                                           // 150+ uç × 5 kimlik
    // İşleyici koşmadı: iş verisine yazım yok, dış sisteme istek yok.
    expect((await pg().query("SELECT count(*)::int AS n FROM docs WHERE coll NOT IN ('users')")).rows[0].n).toBe(oncekiBelgeler);
    // (Kur çekimi açılışta zamanlanan arka plan işidir, uç tetiklemez — sayılmaz.)
    expect(disari.slice(disariOnce).filter(u => !/tcmb\.gov\.tr|exchangerate-api\.com/.test(u))).toEqual([]);
    const dosyalar = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? dosyalar(path.join(d, e.name)) : [e.name]));
    expect(dosyalar(yuklemeDizini)).toEqual([]);                                            // makbuz yükleme ucu diske yazmadı
  }, 180_000);

  it('aynı uçların HEPSİNDE gerçek `requireAuth` her iç rol ve süper yönetici için `next()` der (yanıt yazmaz)', async () => {
    const { uclar, kapilar } = rotaDokumu();
    const kapi = [...kapilar][0] as unknown as Kapi;
    const kimler: Array<[string, Record<string, string>]> = [...STAFF_ROLES.map((r): [string, Record<string, string>] => [r, ic(r)]), ['süper yönetici (rolsüz belge)', SUPER]];
    const takilan: string[] = [];
    for (const [ad, b] of kimler) for (const u of uclar) {
      const yol = somutYol(u.desen);
      let ileri = 0; let durum = 0;
      const yanit = { status(k: number) { durum = k; return yanit; }, json() { return yanit; } };
      await kapi({ method: u.yontem, originalUrl: yol, path: yol, headers: { authorization: b.Authorization } }, yanit, () => { ileri++; });
      if (ileri !== 1 || durum !== 0) takilan.push(`${ad} ${u.yontem} ${yol} → next×${ileri} durum ${durum}`);
    }
    expect(takilan).toEqual([]);
    expect(kimler).toHaveLength(STAFF_ROLES.length + 1);
  }, 60_000);

  it('aynı işlev, aynı sahte istek: rolsüz ve dış rol için `next()` DEMEZ (yukarıdaki sınama boş yere geçmiyor)', async () => {
    const { kapilar } = rotaDokumu();
    const kapi = [...kapilar][0] as unknown as Kapi;
    for (const k of DISARIDAKILER) {
      const { b } = await kimlik(k, 'dogrudan');
      let ileri = 0; let durum = 0; let govde: unknown;
      const yanit = { status(kod: number) { durum = kod; return yanit; }, json(g: unknown) { govde = g; return yanit; } };
      await kapi({ method: 'GET', originalUrl: '/api/integrations/health', path: '/api/integrations/health', headers: { authorization: b.Authorization } }, yanit, () => { ileri++; });
      expect([k, ileri, durum, (govde as { code?: string }).code]).toEqual([k, 0, 403, beklenenKod(k)]);
    }
  });
});

describe('iç rol ve süper yönetici: bugünkü yanıt (gerçek HTTP)', () => {
  // Durum kodları TABAN sürümde (yayin-11 = a01a254) aynı düzenekle ölçüldü; dış sistem anahtarı yok, sahte `fetch` boş nesne döner.
  const SATIS_BEKLENEN: ReadonlyArray<[string, string, unknown, number]> = [
    // ── Taramanın server.ts uçları (11) ──
    ['GET', '/api/gib/vkn/1234567890', undefined, 503],
    ['GET', '/api/luca/kontor', undefined, 503],
    ['POST', '/api/luca/fatura-gonder', { invoiceId: 'x', invoiceData: {} }, 503],
    ['POST', '/api/luca/sync/yevmiye', { entries: [] }, 503],
    ['POST', '/api/luca/sync/stok', {}, 503],
    ['GET', '/api/exchange-rates/at?date=2026-10-01', undefined, 200],
    ['POST', '/api/upload/tahsilat', {}, 400],
    ['GET', '/api/inventory/son-alis-tedarikci?stokKod=DYO-001', undefined, 200],
    ['POST', '/api/inventory/auto-reorder', {}, 200],
    ['GET', '/api/integrations/health', undefined, 200],
    ['POST', '/api/sku-mapping/auto-match', {}, 200],
    // ── Taramanın rota modülü uçları (26) ──
    ['POST', '/api/ai/generate', { prompt: 'merhaba' }, 503],
    ['POST', '/api/ai/chat', { message: 'merhaba' }, 503],
    ['POST', '/api/ai/demand-forecast', {}, 503],
    ['POST', '/api/ai/satis-ajani', {}, 400],
    ['POST', '/api/ai/satinalma-ajani', {}, 503],
    ['GET', '/api/tracking/dhl/123', undefined, 200],
    ['GET', '/api/tracking/ups/123', undefined, 200],
    ['POST', '/api/tracking/fedex', { trackingNumber: '123' }, 200],
    ['GET', '/api/tracking/yurtici/123', undefined, 200],
    ['GET', '/api/tracking/mng/123', undefined, 200],
    ['GET', '/api/tracking/aras/123', undefined, 200],
    ['GET', '/api/tracking/ptt/123', undefined, 200],
    ['POST', '/api/logo/import/stok', {}, 200],
    ['POST', '/api/logo/import/cari', {}, 200],
    ['POST', '/api/logo/export/siparis', {}, 400],
    ['POST', '/api/sap/import/stok', {}, 200],
    ['POST', '/api/sap/import/cari', {}, 200],
    ['POST', '/api/sap/export/siparis', {}, 400],
    ['POST', '/api/sap/export/fatura', {}, 400],
    ['POST', '/api/dynamics/export/siparis', {}, 400],
    ['POST', '/api/dynamics/export/fatura', {}, 400],
    ['POST', '/api/shopify/draft-order', { customerName: 'x', lineItems: [] }, 400],
    ['POST', '/api/marketplace/search', { barcode: '8690000000001' }, 200],
    ['POST', '/api/stripe/create-checkout', { planId: 'starter', cycle: 'monthly' }, 503],
    ['POST', '/api/invites/redeem', {}, 400],
    ['GET', '/api/superadmin/me', undefined, 200],
    // ── Oturum ve genel veri yolu ──
    ['GET', '/api/mfa/status', undefined, 200],
    ['POST', '/api/db/session', {}, 200],
    ['GET', '/api/db/inventory', undefined, 200],
    ['GET', '/api/db/quotations/tek-1', undefined, 200],
    ['GET', '/api/db/orders', undefined, 200],
    ['GET', `/api/db/users/${icUid('Sales')}`, undefined, 200],
    // Rol kapısı olan uçlarda iç rol KENDİ kapısının yanıtını alır (boğazın değil): `code` yok.
    ['GET', '/api/db/users', undefined, 403],
    ['GET', '/api/admin/stats', undefined, 403],
    ['GET', '/api/db/payrolls', undefined, 403],
  ];

  it('Satış: taramanın uçlarında ve genel veri yolunda yanıt tabandaki ile aynı; hiçbir yanıt boğazın reddi değil', async () => {
    const fark: string[] = [];
    for (const [yontem, yol, govde, beklenen] of SATIS_BEKLENEN) {
      const r = await icIstek('Sales', ic('Sales'), yontem, yol, govde);
      if (r.s !== beklenen) fark.push(`${yontem} ${yol} → ${r.s} (taban ${beklenen}) ${r.metin.slice(0, 120)}`);
      expect(['ROL_YOK', 'DIS_ROL', 'ROL_OKUNAMADI'], `${yontem} ${yol}`).not.toContain(r.j.code);
    }
    expect(fark, fark.join('\n')).toEqual([]);
  }, 120_000);

  it('Satış: stok kartı maliyetiyle, teklif başka müşterisiyle geliyor (iç rolde veri daralmadı)', async () => {
    const stok = await icIstek('Sales', ic('Sales'), 'GET', '/api/db/inventory');
    expect(JSON.stringify(stok.j)).toContain('812.5');
    const teklif = await icIstek('Sales', ic('Sales'), 'GET', '/api/db/quotations');
    expect(JSON.stringify(teklif.j)).toContain('Başka Müşteri Ltd.');
    const siparis = await icIstek('Sales', ic('Sales'), 'GET', '/api/db/orders');
    expect((siparis.j.docs as unknown[]).length).toBe(2);                                  // satır süzgeci iç role uygulanmaz
  });

  it('HER iç rol: yalnız `requireAuth` taşıyan uç 200; kendi belgesi 200; yazım kendi kuralıyla', async () => {
    for (const rol of STAFF_ROLES) {
      expect((await icIstek(rol, ic(rol), 'GET', '/api/integrations/health')).s, rol).toBe(200);
      expect((await icIstek(rol, ic(rol), 'GET', `/api/db/users/${icUid(rol)}`)).s, rol).toBe(200);
      expect((await icIstek(rol, ic(rol), 'GET', '/api/db/notifications')).s, rol).toBe(200);        // kullanıcı kapsamlı: her iç rol
    }
    // Yazma kuralı değişmedi: Satış teklif yazar, İK yazamaz (kendi 403'ü — `code` yok).
    expect((await icIstek('Sales', ic('Sales'), 'PATCH', '/api/db/quotations/tek-1', { not: 'iç rol yazdı' })).s).toBe(200);
    const ik = await icIstek('HR', ic('HR'), 'PATCH', '/api/db/quotations/tek-1', { not: 'x' });
    expect([ik.s, ik.j.code]).toEqual([403, undefined]);
  });

  it('süper yönetici (kullanıcı belgesi ve rolü YOK): boğazdan geçer', async () => {
    expect((await icIstek('super', SUPER, 'GET', '/api/integrations/health')).s).toBe(200);
    const ben = await icIstek('super', SUPER, 'GET', '/api/superadmin/me');
    expect([ben.s, ben.j.isSuperAdmin]).toEqual([200, true]);
    // Doğrulanmamış e-postayla aynı adres süper yönetici SAYILMAZ → rolsüz hesap muamelesi.
    const sahte = await istek('GET', '/api/integrations/health', belirtec('super-2', SUPER_EPOSTA, false));
    expect([sahte.s, sahte.j.code]).toEqual([403, 'ROL_YOK']);
  });

  it('yol yazımı iç rolde bugünkü gibi çalışır (boğaz yalnız iç rolü OLMAYAN hesapta yola bakar)', async () => {
    for (const yol of ['/API/DB/inventory', '/api/db/inventory/', '/api/db/inventory?x=1', '/api/db/%69nventory']) {
      expect((await icIstek('Sales', ic('Sales'), 'GET', yol)).s, yol).toBe(200);
    }
  });
});

describe('T2 — dış rol (Bayi, B2B): ERP verisi kapalı; kendi kullanıcı belgesi açık', () => {
  const DIS: readonly Disarida[] = ['Dealer', 'B2B'];

  it('okuma: stok, teklif, fiyat listesi, CPQ, komisyon, şablon, sipariş (KENDİ siparişi dâhil), tek belge → 403 DIS_ROL', async () => {
    expect(EXTERNAL_ROLES.map(String).sort()).toEqual([...DIS].map(String).sort());          // küme büyürse sınama da büyümeli
    for (const k of DIS) {
      const { b } = await kimlik(k, 'kendi');                                               // `dealer-kendi`: sip-bayinin'in sahibi
      for (const yol of ['/api/db/inventory', '/api/db/quotations', '/api/db/priceLists', '/api/db/priceOverrides', '/api/db/cpqQuotes', '/api/db/commissionRules',
        '/api/db/recurringOrders', '/api/db/documentTemplates', '/api/db/orders', '/api/db/inventory/mikro-DYO-001', '/api/db/quotations/tek-1',
        '/api/db/orders/sip-bayinin', '/api/db/orders/sip-baskasinin', '/api/db/notifications', '/api/db/userPrefs', '/api/db/demoRequests', '/api/db/users']) {
        const r = await istek('GET', yol, b);
        expect([k, yol, r.s, r.j.code], r.metin.slice(0, 120)).toEqual([k, yol, 403, 'DIS_ROL']);
        expect(r.metin).not.toContain('812.5'); expect(r.metin).not.toContain('Müşteri');
      }
    }
  });

  it('yazma: ekleme, değiştirme, silme, artırma, koşullu yazma, art arda yazma (doğrudan ve yöntem tüneliyle) → 403; veri DEĞİŞMEZ', async () => {
    const once = JSON.stringify((await pg().query("SELECT coll, id, data FROM docs WHERE coll IN ('orders','quotations','inventory','recurringOrders') ORDER BY coll, id")).rows);
    for (const k of DIS) {
      const { b } = await kimlik(k, 'kendi');
      const denemeler: Array<[string, string, unknown, Record<string, string>?]> = [
        ['POST', '/api/db/orders', { customerName: 'bayi açtı', totalPrice: 1 }],
        ['POST', '/api/db/quotations', { customerName: 'bayi açtı' }],
        ['PUT', '/api/db/quotations/tek-1?merge=1', { total: 1, status: 'Accepted' }],
        ['PATCH', '/api/db/quotations/tek-1', { total: 1 }],
        ['PATCH', '/api/db/orders/sip-bayinin', { totalPrice: 1 }],
        ['DELETE', '/api/db/quotations/tek-1', undefined],
        ['PATCH', '/api/db/quotations/tek-1/increment', { field: 'total', by: -999999 }],
        ['PATCH', '/api/db/orders/sip-bayinin/cas', { field: 'status', expect: 'x', set: { status: 'y' } }],
        ['PUT', '/api/db/recurringOrders/yin-1?merge=1', { customerName: 'x' }],
        // Yöntem tüneli (istemcinin gerçek yazımı): POST + X-Cetpa-Method.
        ['POST', '/api/db/quotations/tek-1', { total: 1 }, { 'X-Cetpa-Method': 'PATCH' }],
        ['POST', '/api/db/quotations/tek-1?merge=1', { total: 1 }, { 'X-Cetpa-Method': 'PUT' }],
        ['POST', '/api/db/quotations/tek-1', undefined, { 'X-Cetpa-Method': 'DELETE' }],
        ['POST', '/api/db/quotations/tek-1/increment', { field: 'total', by: 1 }, { 'X-Cetpa-Method': 'PATCH' }],
        // Art arda (toplu) yazma: her biri ayrı reddedilir.
        ['PUT', '/api/db/orders/toplu-1?merge=0', { customerName: 'toplu' }], ['PUT', '/api/db/orders/toplu-2?merge=0', { customerName: 'toplu' }], ['PUT', '/api/db/orders/toplu-3?merge=0', { customerName: 'toplu' }],
      ];
      for (const [yontem, yol, govde, ek] of denemeler) {
        const r = await istek(yontem, yol, { ...b, ...(ek ?? {}) }, govde);
        expect([k, yontem, yol, r.s, r.j.code], r.metin.slice(0, 120)).toEqual([k, yontem, yol, 403, 'DIS_ROL']);
      }
    }
    expect(JSON.stringify((await pg().query("SELECT coll, id, data FROM docs WHERE coll IN ('orders','quotations','inventory','recurringOrders') ORDER BY coll, id")).rows)).toBe(once);
  });

  it('rol kapısız özel uçlar (tedarikçi kimliği, satın alma taslağı, eşleştirme, yapay zekâ, makbuz) → 403 DIS_ROL', async () => {
    const { b } = await kimlik('Dealer', 'kendi');
    const onceYazilan = (await pg().query("SELECT count(*)::int AS n FROM docs WHERE coll IN ('purchaseOrders','skuMappings')")).rows[0].n;
    for (const [yontem, yol] of [['GET', '/api/inventory/son-alis-tedarikci?stokKod=DYO-001'], ['POST', '/api/inventory/auto-reorder'], ['POST', '/api/sku-mapping/auto-match'],
      ['POST', '/api/ai/satis-ajani'], ['POST', '/api/ai/generate'], ['POST', '/api/upload/tahsilat'], ['POST', '/api/shopify/draft-order'], ['GET', '/api/integrations/health']] as const) {
      const r = await istek(yontem, yol, b, yontem === 'POST' ? {} : undefined);
      expect([yol, r.s, r.j.code]).toEqual([yol, 403, 'DIS_ROL']);
      expect(r.metin).not.toContain('GİZLİ TEDARİKÇİ');
    }
    expect((await pg().query("SELECT count(*)::int AS n FROM docs WHERE coll IN ('purchaseOrders','skuMappings')")).rows[0].n).toBe(onceYazilan);
  });

  it('kendi `users/<uid>` belgesi: okuma 200, profil yazımı 200, rol / kiracı alanı YAZILAMAZ; başkasının belgesi 403', async () => {
    for (const k of DIS) {
      const { uid, b } = await kimlik(k, 'profil');
      const oku = await istek('GET', `/api/db/users/${uid}`, b);
      expect([k, oku.s, (oku.j.data as { role?: string } | undefined)?.role]).toEqual([k, 200, k]);
      expect((await istek('PATCH', `/api/db/users/${uid}`, b, { name: 'Bayi Kullanıcısı' })).s).toBe(200);
      expect((await istek('POST', `/api/db/users/${uid}`, { ...b, 'X-Cetpa-Method': 'PATCH' }, { device: 'tünelden' })).s).toBe(200);
      // Rol yükseltme: bugünkü kapı (403, `code` yok) — boğaz kendi belgesine izin verir, alan korumaları AYNEN çalışır.
      const yukselt = await istek('PATCH', `/api/db/users/${uid}`, b, { role: 'Admin' });
      expect([yukselt.s, yukselt.j.code]).toEqual([403, undefined]);
      await istek('PATCH', `/api/db/users/${uid}`, b, { companyId: 'BASKA-KIRACI', status: 'x' });
      const belge = await belgeOku('users', uid);
      expect([belge?.role, belge?.companyId, belge?.name, belge?.device, belge?.status]).toEqual([k, KIRACI, 'Bayi Kullanıcısı', 'tünelden', undefined]);
      const baskasi = await istek('GET', `/api/db/users/${icUid('Admin')}`, b);
      expect([baskasi.s, baskasi.j.code]).toEqual([403, 'DIS_ROL']);
    }
  });

  it('akış (SSE): dış role açılmaz — iş koleksiyonu, kullanıcı kapsamlı koleksiyon, `users`; belirteçle de çerezle de; olay YAYILMAZ', async () => {
    // Denetim: iç rolün akışı açılıyor ve değişiklik olayı alıyor (akış çalışıyor; aşağıdaki 403'ler «akış kapalı» demek değil).
    const tok = (b: Record<string, string>): string => encodeURIComponent(b.Authorization.replace(/^Bearer /, ''));
    const icAkis = await akisAc(`/api/db/stream?colls=inventory,notifications&token=${tok(ic('Sales'))}`, {});
    expect(icAkis.s).toBe(200);
    await bekle(() => icAkis.govde().includes('event: init'), 10_000, 'iç rol akışı ilk veriyi aldı');
    expect(icAkis.govde()).toContain('812.5');

    const acilan: string[] = [];
    for (const k of DIS) {
      const { uid, b } = await kimlik(k, 'akis');
      for (const colls of ['inventory,orders,quotations,priceLists,cpqQuotes', 'notifications,userPrefs,aiConsents,userOnboarding', 'users,settings', 'orders', 'notifications']) {
        const a = await akisAc(`/api/db/stream?colls=${colls}&token=${tok(b)}`, {});
        if (a.s !== 403) acilan.push(`${k} belirteç ${colls} → ${a.s}`);
        await new Promise(r => setTimeout(r, 30));
        expect(a.govde()).not.toContain('event:'); expect(a.govde()).not.toContain('Sipariş S-1');
        a.kapat();
      }
      // Oturum çerezi kurmak izin listesinde; çerezle açılan akış da kapalı.
      const oturum = await istek('POST', '/api/db/session', b, {});
      expect(oturum.s).toBe(200);
      const cerez = String((oturum.basliklar['set-cookie'] ?? [])[0] ?? '').split(';')[0];
      expect(cerez).toMatch(/^__cetpa_session=/);
      const c = await akisAc('/api/db/stream?colls=inventory,notifications', { Cookie: cerez });
      if (c.s !== 403) acilan.push(`${k} çerez → ${c.s}`);
      c.kapat();
      expect(uid.length).toBeGreaterThan(0);
    }
    expect(acilan).toEqual([]);
    // Rolsüz hesap da açamaz.
    const { b: rb } = await kimlik('rolsuz', 'akis');
    expect((await akisAc(`/api/db/stream?colls=inventory,notifications&token=${tok(rb)}`, {})).s).toBe(403);

    // Canlı olay: Yönetici stok kartını değiştirir → iç rol akışına düşer.
    expect((await icIstek('Admin', ic('Admin'), 'PATCH', '/api/db/inventory/mikro-DYO-001', { stockLevel: 7 })).s).toBe(200);
    await bekle(() => icAkis.govde().includes('event: change'), 10_000, 'iç rol akışı değişiklik olayını aldı');
    icAkis.kapat();
  }, 60_000);
});

describe('T7 — izin listesi: rolsüz hesapta oturum açılışı, iki adımlı doğrulama kaydı ve davet kabulü ÇALIŞIR', () => {
  it('oturum açılışı: kendi belgesi (yok → 404, yaz → 200, oku → 200), oturum çerezi, çıkış, açılış soruları', async () => {
    const { uid, b } = await kimlik('belgesiz', 'acilis');
    const yok = await istek('GET', `/api/db/users/${uid}`, b);
    expect([yok.s, yok.j.code]).toEqual([404, undefined]);                                  // boğaz geçirdi; işleyicinin kendi «yok» yanıtı
    // İstemcinin açılış yazımı rol taşır → bugünkü rol yükseltme kapısı (403, `code` yok); rolsüz yazım geçer.
    const rollu = await istek('PUT', `/api/db/users/${uid}?merge=0`, b, { name: 'Yeni', email: eposta(uid), role: 'Sales' });
    expect([rollu.s, rollu.j.code]).toEqual([403, undefined]);
    expect((await istek('PUT', `/api/db/users/${uid}?merge=1`, b, { name: 'Yeni', email: eposta(uid), companyId: 'CETPA', status: 'active' })).s).toBe(200);
    expect((await istek('PATCH', `/api/db/users/${uid}`, b, { device: 'tarayıcı' })).s).toBe(200);
    expect((await istek('POST', `/api/db/users/${uid}`, { ...b, 'X-Cetpa-Method': 'PATCH' }, { location: 'Bilinmiyor' })).s).toBe(200);
    const oku = await istek('GET', `/api/db/users/${uid}`, b);
    expect(oku.s).toBe(200);
    const belge = await belgeOku('users', uid);
    expect([belge?.name, belge?.device, belge?.location, belge?.role, belge?.companyId, belge?.status]).toEqual(['Yeni', 'tarayıcı', 'Bilinmiyor', undefined, undefined, undefined]);

    const oturum = await istek('POST', '/api/db/session', b, {});
    expect([oturum.s, oturum.j.ok]).toEqual([200, true]);
    expect(String((oturum.basliklar['set-cookie'] ?? [])[0])).toMatch(/^__cetpa_session=/);
    const ben = await istek('GET', '/api/superadmin/me', b);
    expect([ben.s, ben.j.isSuperAdmin]).toEqual([200, false]);
    const mfa = await istek('GET', '/api/mfa/status', b);
    expect([mfa.s, mfa.j.enabled, mfa.j.verified]).toEqual([200, false, true]);
    const cikis = await istek('POST', '/api/db/session/logout', b, {});
    expect([cikis.s, cikis.j.ok]).toEqual([200, true]);
    // Açılıştan sonra da iş verisi kapalı.
    const stok = await istek('GET', '/api/db/inventory', b);
    expect([stok.s, stok.j.code]).toEqual([403, 'ROL_YOK']);
  });

  it('iki adımlı doğrulama: kayıt başlat → kodla doğrula → durum → girişte doğrula (rolsüz hesap; dış rol de)', async () => {
    for (const k of ['rolsuz', 'Dealer'] as const) {
      const { b } = await kimlik(k, 'mfa');
      const basla = await istek('POST', '/api/mfa/enroll/start', b, {});
      expect([k, basla.s, typeof basla.j.secretKey, typeof basla.j.otpauth]).toEqual([k, 200, 'string', 'string']);
      const sir = String(basla.j.secretKey);
      const dogrula = await istek('POST', '/api/mfa/enroll/verify', b, { code: totpKodu({ secret: sir }) });
      expect([k, dogrula.s, dogrula.j.ok]).toEqual([k, 200, true]);
      const cerez = String((dogrula.basliklar['set-cookie'] ?? [])[0] ?? '').split(';')[0];
      expect(cerez).toMatch(/^__cetpa_mfa=/);
      const durum = await istek('GET', '/api/mfa/status', { ...b, Cookie: cerez });
      expect([durum.s, durum.j.enabled, durum.j.verified]).toEqual([200, true, true]);
      const cerezsiz = await istek('GET', '/api/mfa/status', b);
      expect([cerezsiz.s, cerezsiz.j.enabled, cerezsiz.j.verified]).toEqual([200, true, false]);
      const giris = await istek('POST', '/api/mfa/verify', b, { code: totpKodu({ secret: sir }) });
      expect([k, giris.s, giris.j.ok]).toEqual([k, 200, true]);
      // Kapatma ucu izin listesinde DEĞİL (şartname saymıyor) — sabitlenmiş davranış.
      const kapat = await istek('POST', '/api/mfa/disable', { ...b, Cookie: cerez }, { code: totpKodu({ secret: sir }) });
      expect([k, kapat.s, kapat.j.code]).toEqual([k, 403, beklenenKod(k)]);
    }
  });

  it('davet kabulü: rolsüz hesap daveti kullanır → rol alır → boğaz AÇILIR (aynı hesap artık stok okur)', async () => {
    const { uid, b } = await kimlik('rolsuz', 'davetli');
    expect((await istek('GET', '/api/db/inventory', b)).j.code).toBe('ROL_YOK');
    // Geçersiz kod: işleyicinin kendi yanıtı (boğaz geçirdi).
    const yokDavet = await istek('POST', '/api/invites/redeem', b, { token: 'olmayan-kod' });
    expect([yokDavet.s, yokDavet.j.code]).toEqual([404, undefined]);
    await belgeKoy('invites', 'davet-kodu-1', { email: eposta(uid), role: 'Sales', companyId: KIRACI, used: false, expiresAt: new Date(Date.now() + 86_400_000).toISOString() });
    const kabul = await istek('POST', '/api/invites/redeem', b, { token: 'davet-kodu-1' });
    expect([kabul.s, kabul.j.success]).toEqual([200, true]);
    const belge = await belgeOku('users', uid);
    expect([belge?.role, belge?.companyId]).toEqual(['Sales', KIRACI]);
    const stok = await istek('GET', '/api/db/inventory', b);
    expect([stok.s, stok.j.code]).toEqual([200, undefined]);
    expect(JSON.stringify(stok.j)).toContain('DYO Boya 15 L');
  });

  it('izin listesindeki HER satır gerçek zincirde karşılık buluyor (rolsüz hesap boğazın reddini ALMAZ)', async () => {
    const { uid, b } = await kimlik('rolsuz', 'liste');
    for (const izin of ROLSUZ_IZINLI_YOLLAR) for (const yontem of izin.yontemler) {
      const yol = izin.yol.replace(':uid', uid);
      const r = await istek(yontem, yol, b, yontem === 'GET' ? undefined : {});
      expect(['ROL_YOK', 'DIS_ROL', 'ROL_OKUNAMADI'], `${yontem} ${yol} → ${r.s}`).not.toContain(r.j.code);
      expect([401, 503], `${yontem} ${yol}`).not.toContain(r.s);
    }
  });

  it('kimliksiz yol DEĞİŞMEDİ: belirteçsiz istek 401; herkese açık form belirteçsiz yazılır; rolsüz hesap aynı forma KİMLİKLE yazamaz', async () => {
    const yok = await istek('GET', '/api/db/inventory');
    expect([yok.s, yok.j.code]).toEqual([401, undefined]);
    expect((await istek('GET', '/api/integrations/health')).s).toBe(401);
    const form = await istek('POST', '/api/db/demoRequests', {}, { name: 'Ziyaretçi', email: 'z@example.test' });
    expect(form.s).toBe(200);
    const { b } = await kimlik('rolsuz', 'form');
    const kimlikli = await istek('POST', '/api/db/demoRequests', b, { name: 'x' });
    expect([kimlikli.s, kimlikli.j.code]).toEqual([403, 'ROL_YOK']);
    // Geçersiz belirteç: 401 (boğaza gelmez).
    expect((await istek('GET', '/api/db/inventory', { Authorization: 'Bearer bozuk' })).s).toBe(401);
  });
});

describe('izin listesi aşılamaz: yöntem tüneli ve yol yazımı (rolsüz hesap, gerçek HTTP)', () => {
  it('yöntem tüneli GERÇEK yöntemle değerlendirilir: tünelden çıkan DELETE reddedilir, PATCH / PUT kabul edilir', async () => {
    const { uid, b } = await kimlik('rolsuz', 'tunel');
    const sil = await istek('POST', `/api/db/users/${uid}`, { ...b, 'X-Cetpa-Method': 'DELETE' });
    expect([sil.s, sil.j.code]).toEqual([403, 'ROL_YOK']);
    const dogrudanSil = await istek('DELETE', `/api/db/users/${uid}`, b);
    expect([dogrudanSil.s, dogrudanSil.j.code]).toEqual([403, 'ROL_YOK']);
    expect(await belgeOku('users', uid)).toBeDefined();
    expect((await istek('POST', `/api/db/users/${uid}`, { ...b, 'X-Cetpa-Method': 'PATCH' }, { name: 'a' })).s).toBe(200);
    expect((await istek('POST', `/api/db/users/${uid}?merge=1`, { ...b, 'X-Cetpa-Method': 'put' }, { name: 'b' })).s).toBe(200);
    // Tünel başlığı GET'i yazmaya çevirmez (tünel yalnız POST'u yeniden yazar): stok okuması yine boğazda.
    const get = await istek('GET', '/api/db/inventory', { ...b, 'X-Cetpa-Method': 'PATCH' });
    expect([get.s, get.j.code]).toEqual([403, 'ROL_YOK']);
    // İzin listesindeki yolu başka yönteme çevirmek açmaz: oturum ucuna tünelle PATCH → rota yok / ret, veri ucu açılmaz.
    const artir = await istek('POST', `/api/db/users/${uid}/increment`, { ...b, 'X-Cetpa-Method': 'PATCH' }, { field: 'role', by: 1 });
    expect([artir.s, artir.j.code]).toEqual([403, 'ROL_YOK']);
    const cas = await istek('POST', `/api/db/users/${uid}/cas`, { ...b, 'X-Cetpa-Method': 'PATCH' }, { field: 'name', expect: 'b', set: { role: 'Admin' } });
    expect([cas.s, cas.j.code]).toEqual([403, 'ROL_YOK']);
    expect((await belgeOku('users', uid))?.role).toBeUndefined();
  });

  it('yol yazımıyla taklit: sondaki eğik çizgi, büyük harf, yüzde kaçışı, çift eğik çizgi, sorguya gömme → hiçbiri 2xx değil', async () => {
    const { uid, b } = await kimlik('rolsuz', 'taklit');
    await istek('PUT', `/api/db/users/${uid}?merge=1`, b, { name: 'taklit' });
    const baska = icUid('Admin');
    const denemeler: Array<[string, string]> = [
      // Express bunları izin listesindeki işleyiciye götürür; boğaz kurallı yazım dışını reddeder.
      ['GET', `/api/db/users/${uid}/`], ['GET', `/API/DB/USERS/${uid}`], ['GET', `/Api/Db/users/${uid}`], ['GET', `/api/db/%75sers/${uid}`],
      ['GET', '/api/mfa/status/'], ['GET', '/api/MFA/status'], ['GET', '/api/mfa/statu%73'], ['GET', '/api/superadmin/ME'],
      ['POST', '/api/db/session/'], ['POST', '/api/Invites/redeem'],
      // Liste dışı işleyiciye giden, listedeki yola benzeyen yazımlar.
      ['GET', `/api/db/users/${baska}`], ['GET', `/api/db/users/${uid}%2F..%2F${baska}`], ['GET', `/api/db/users/${baska}?x=/api/db/users/${uid}`],
      ['GET', `/api/db/inventory?/api/db/users/${uid}`], ['GET', '/api/db/inventory?x=/api/mfa/status'], ['GET', `/api/db/inventory/${uid}`],
      ['GET', `/api/db/users/${uid}/../../inventory`], ['GET', '/api/db/users'], ['GET', `/api/db/USERS/${uid}`],
      ['PATCH', `/api/db/users/${uid}/increment`], ['PATCH', `/api/db/users/${uid}/cas`], ['PATCH', `/api/db/users/${uid}%2Fincrement`],
      ['GET', `//api/db/users/${uid}`], ['GET', `/api//db/users/${uid}`], ['GET', '/api/mfa//status'],
    ];
    const gecen: string[] = [];
    for (const [yontem, yol] of denemeler) {
      const r = await istek(yontem, yol, b, yontem === 'GET' ? undefined : {});
      if (r.s >= 200 && r.s < 300) gecen.push(`${yontem} ${yol} → ${r.s}`);
      // Zincire ulaşan her yazım boğazın reddini alır; ulaşmayan (Express'in eşleştirmediği çift eğik çizgi) 404'tür.
      if (r.s !== 404) expect([yontem, yol, r.s, r.j.code]).toEqual([yontem, yol, 403, 'ROL_YOK']);
      expect(r.metin).not.toContain('812.5');
    }
    expect(gecen).toEqual([]);
    // Kurallı yazım (sorgulu da) çalışıyor — yukarıdaki retler «her şey kapalı» demek değil.
    expect((await istek('GET', `/api/db/users/${uid}?x=1`, b)).s).toBe(200);
    expect((await istek('GET', '/api/mfa/status?_=1', b)).s).toBe(200);
  });
});

describe('rol OKUNAMADI → 503 (ret değil); başarılı okuma önbelleği paylaşır', () => {
  const kullaniciOkumasi = (uid: string) => (sql: string, p: unknown[] | undefined): boolean =>
    /FROM docs WHERE coll = \$1 AND id = \$2/.test(sql) && p?.[0] === 'users' && p?.[1] === uid;

  it('iç rol: rol okuması fırlatırsa 503 `ROL_OKUNAMADI` (403 değil); arıza geçince aynı istek 200', async () => {
    const uid = 'ic-ariza-1';
    await belgeKoy('users', uid, { email: eposta(uid), role: 'Sales', companyId: KIRACI });
    arizaKur(kullaniciOkumasi(uid));
    try {
      for (const yol of ['/api/integrations/health', '/api/db/inventory', '/api/mfa/status', `/api/db/users/${uid}`]) {
        const r = await istek('GET', yol, belirtec(uid));
        expect([yol, r.s, r.j.code]).toEqual([yol, 503, 'ROL_OKUNAMADI']);
      }
    } finally { arizaKur(undefined); }
    expect((await istek('GET', '/api/integrations/health', belirtec(uid))).s).toBe(200);
  });

  it('rolsüz hesap ve dış rol: okuma fırlatırsa onlar da 503 alır (rol bilinmeden «rolsüz» denmez)', async () => {
    for (const k of ['rolsuz', 'Dealer'] as const) {
      const { uid, b } = await kimlik(k, 'ariza');
      arizaKur(kullaniciOkumasi(uid));
      try {
        const r = await istek('GET', '/api/db/inventory', b);
        expect([k, r.s, r.j.code]).toEqual([k, 503, 'ROL_OKUNAMADI']);
        // İzin listesindeki yol da: karar rol okunmadan verilmez.
        expect((await istek('GET', '/api/mfa/status', b)).s).toBe(503);
      } finally { arizaKur(undefined); }
      expect((await istek('GET', '/api/db/inventory', b)).j.code).toBe(beklenenKod(k));
    }
  });

  it('süper yöneticide rol HİÇ okunmaz: okuma fırlatsa da geçer', async () => {
    arizaKur(kullaniciOkumasi('super-1'));
    try { expect((await istek('GET', '/api/integrations/health', SUPER)).s).toBe(200); } finally { arizaKur(undefined); }
  });

  it('önbellek paylaşımı: rolü bir kez okunan iç rol, okuma arızalıyken de geçer (60 sn önbellek — `getUserRole` ile aynı)', async () => {
    const uid = 'ic-onbellek-1';
    await belgeKoy('users', uid, { email: eposta(uid), role: 'Logistics', companyId: KIRACI });
    expect((await istek('GET', '/api/integrations/health', belirtec(uid))).s).toBe(200);    // okundu, önbelleğe girdi
    let okuma = 0;
    arizaKur((sql, p) => { const e = kullaniciOkumasi(uid)(sql, p); if (e) okuma++; return e; });
    try {
      expect((await istek('GET', '/api/integrations/health', belirtec(uid))).s).toBe(200);
      // Rol kapısı olan uç `getUserRole`'u çağırır: o da AYNI önbellekten okur (veritabanına gitmez).
      expect((await istek('GET', '/api/db/inventory', belirtec(uid))).s).toBe(200);
    } finally { arizaKur(undefined); }
    expect(okuma).toBe(0);
  });
});
