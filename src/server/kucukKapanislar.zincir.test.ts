// @vitest-environment node
/**
 * kucukKapanislar.zincir.test.ts — şartname «dış rol kapanışı» v2 ekinin KÜÇÜK KAPANIŞLARI, GERÇEK `server.ts` + GERÇEK express
 * zinciriyle: D6 (T5) · D9 (T8) · D10 (T9) · D11 (T10) · D12 (T11) · D13.
 *
 * NEDEN GERÇEK ZİNCİR: bu kapanışların her biri «bir satır eklendi» türündendir ve asıl risk satırın YAZILIP BAĞLANMAMASIDIR
 * (kapı zincire girmedi, bağlam nesnesine konmadı, yardımcı çağrılmadı). Saf karar testleri (lib/rbac.yoneticiRolu.test.ts,
 * kiraciOrtami.test.ts, kullaniciSayimi.test.ts) kuralı kanıtlar; burada `server.ts` olduğu gibi içe aktarılır, gerçek bir
 * kapıda dinler ve uçlara gerçek HTTP isteği atılır. Düzenek `kimlikYuzeyi.zincir.test.ts` ile AYNI kalıptır.
 *
 * SAHTE OLANLAR (yalnız süreç dışına çıkan her şey): Firebase belirteç doğrulayıcısı ve hesap yönetimi (belirteç =
 * "<uid>|<e-posta>|<1|0>"; hesap açma / silme çağrıları kaydedilir), `pg` havuzu (süreç içi PGlite), pg-boss, node-cron, vite,
 * `dotenv` (hiçbir ortam dosyası YÜKLENMEZ) ve dışarı giden `fetch` (kaydedilir, hiçbir yere gitmez). Canlıya, Firebase'e,
 * Mikro'ya istek YOK. Sunucu `PORT=0` ile boş bir kapıda açılır ve `afterAll`'da kapatılır.
 *
 * SIRA ÖNEMLİ: kiracı taraması sınaması (T11) dosyanın BAŞINDADIR — ortamda kiracı kimliği YOKTUR ve tarama `users`
 * koleksiyonunun tamamına bakar; sonraki bölümler başka kiracıdan kullanıcı ekler.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { generateSync as totpKodu } from 'otplib';
import { EXTERNAL_ROLES, STAFF_ROLES, type AppRole } from '../lib/rbac';

// ── Sahteler (yalnız süreç dışına çıkanlar) ────────────────────────────────────────────────────────────────────────────────
vi.mock('dotenv', () => ({ default: { config: () => ({ parsed: {} }) }, config: () => ({ parsed: {} }) }));
vi.mock('firebase-admin/auth', () => {
  const g = globalThis as Record<string, unknown>;
  const cagrilar: Array<{ ne: string; kim: string }> = [];
  g.__kucukKapanislarHesap = cagrilar;
  let sira = 0;
  return {
    getAuth: () => ({
      // Belirteç biçimi: "<uid>|<e-posta>|<1|0>" — imza yok; yalnız bu sınamada.
      verifyIdToken: async (t: string) => {
        const [uid, email, v] = String(t).split('|');
        if (!uid || !email) throw new Error('geçersiz belirteç');
        return { uid, email, email_verified: v === '1' };
      },
      revokeRefreshTokens: async () => undefined,
      createUser: async (d: { email: string }) => { sira++; cagrilar.push({ ne: 'ac', kim: d.email }); return { uid: `acilan-${sira}` }; },
      deleteUser: async (uid: string) => { cagrilar.push({ ne: 'sil', kim: uid }); },
      generatePasswordResetLink: async (email: string) => `https://example.test/parola-belirle?kime=${encodeURIComponent(email)}`,
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
  g.__kucukKapanislarPg = db;
  const q = async (text: unknown, params?: unknown[]) => {
    let sql = String(text); let p = params;
    if (text && typeof text === 'object') { const o = text as { text: string; values?: unknown[] }; sql = o.text; p = o.values; }
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
const pg = (): Pg => G.__kucukKapanislarPg as Pg;
/** Sahte Firebase hesap yönetimine yapılan çağrılar (hesap açma / silme). */
const hesapCagrilari = (): Array<{ ne: string; kim: string }> => G.__kucukKapanislarHesap as Array<{ ne: string; kim: string }>;

interface Katman { name?: string; method?: string; handle: (...a: unknown[]) => unknown; route?: { path: unknown; methods: Record<string, boolean>; stack: Katman[] } }
interface Uygulama { router: { stack: Katman[] } }

let sunucu: http.Server | undefined;
let uygulama: Uygulama | undefined;
let kapiNo = 0;
let yuklemeDizini = '';
const gercekFetch = globalThis.fetch;
/** Sunucunun DIŞARI yapmaya çalıştığı her istek (hiçbiri gitmez). */
const disari: string[] = [];

const KIRACI = 'CETPA';
const BASKA_KIRACI = 'BASKA-FIRMA';
const SUPER_EPOSTA = 'super@example.test';
const SUPER_MUDUR_EPOSTA = 'supermudur@example.test';
const OPS_JETONU = 'sinama-ops-jetonu-0123456789';
const eposta = (uid: string): string => `${uid.toLowerCase()}@example.test`;
const belirtec = (uid: string, ep = eposta(uid), dogrulanmis = true): Record<string, string> => ({ Authorization: `Bearer ${uid}|${ep}|${dogrulanmis ? 1 : 0}` });

interface Yanit { s: number; j: Record<string, unknown>; metin: string; basliklar: http.IncomingHttpHeaders }
let ipSayaci = 0;
/** Her istek ayrı «istemci IP'si» taşır (vekilin yazdığı gibi): IP anahtarlı sınırlayıcılar (kimlik uçları: 20 istek / 15 dk) sınamayı kesmesin. */
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
const belgeSil = (coll: string, id: string): Promise<unknown> => pg().query('DELETE FROM docs WHERE coll = $1 AND id = $2', [coll, id]);
const say = async (sql: string, p?: unknown[]): Promise<number> => Number((await pg().query(sql, p)).rows[0]?.n);

/** Kullanıcıyı (sunucu önbelleğine girmeden ÖNCE — uid yeni) `users` belgesiyle kurar; belirtecini döner. */
async function kullanici(uid: string, veri: Record<string, unknown>, ep = eposta(uid)): Promise<Record<string, string>> {
  await belgeKoy('users', uid, { email: ep, ...veri });
  return belirtec(uid, ep);
}
const icUid = (rol: AppRole): string => `ic-${rol}`;
const ic = (rol: AppRole): Record<string, string> => belirtec(icUid(rol));
const SUPER = belirtec('super-1', SUPER_EPOSTA);          // `users` belgesi ve rolü YOK: yalnız doğrulanmış e-postasıyla süper yönetici

// ── İki adımlı doğrulama yardımcıları ──────────────────────────────────────────────────────────────────────────────────────
const SABIT_SIR = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';      // 32 hane (20 bayt): üreteç 16 bayttan kısa sırrı reddeder
/** Doğrulama kaydını DOĞRUDAN tabloya yazar (uid sunucu önbelleğine girmeden önce). */
const mfaKaydiKoy = (uid: string, acik = true): Promise<unknown> =>
  pg().query('INSERT INTO mfa_secrets (uid, secret, enabled) VALUES ($1, $2, $3) ON CONFLICT (uid) DO UPDATE SET secret = $2, enabled = $3', [uid, SABIT_SIR, acik]);
const mfaKaydi = async (uid: string): Promise<{ secret: string; enabled: boolean } | undefined> =>
  (await pg().query('SELECT secret, enabled FROM mfa_secrets WHERE uid = $1', [uid])).rows[0] as { secret: string; enabled: boolean } | undefined;
const mfaCerezi = (r: Yanit): string => String((r.basliklar['set-cookie'] ?? [])[0] ?? '').split(';')[0];
/** Kayıtlı sırla girişte doğrular; doğrulanmış oturumun çerezini döner. */
async function mfaIleGir(b: Record<string, string>, sir = SABIT_SIR): Promise<string> {
  const r = await istek('POST', '/api/mfa/verify', b, { code: totpKodu({ secret: sir }) });
  expect([r.s, r.j.ok], r.metin).toEqual([200, true]);
  const cerez = mfaCerezi(r);
  expect(cerez).toMatch(/^__cetpa_mfa=/);
  return cerez;
}

// ── Rota dökümü: gerçek uygulamanın yönlendiricisinden ─────────────────────────────────────────────────────────────────────
interface Uc { yontem: string; desen: string; katmanlar: Katman[]; adlar: string[] }
function rotaDokumu(): Uc[] {
  if (!uygulama) throw new Error('uygulama yakalanmadı');
  const uclar: Uc[] = [];
  const gez = (yigin: Katman[]): void => {
    for (const k of yigin) {
      const alt = (k.handle as unknown as { stack?: Katman[] }).stack;
      if (!k.route) { if (Array.isArray(alt)) gez(alt); continue; }
      const yollar = Array.isArray(k.route.path) ? k.route.path : [k.route.path];
      for (const y of yollar) for (const [m, acik] of Object.entries(k.route.methods)) {
        if (!acik || typeof y !== 'string') continue;
        const katmanlar = k.route.stack.filter(s => !s.method || s.method === m);
        uclar.push({ yontem: m.toUpperCase(), desen: y, katmanlar, adlar: katmanlar.map(s => s.name || '(adsız)') });
      }
    }
  };
  gez(uygulama.router.stack);
  return uclar;
}
const uc = (yontem: string, desen: string): Uc => {
  const bulunan = rotaDokumu().filter(u => u.yontem === yontem && u.desen === desen);
  expect(bulunan, `${yontem} ${desen} tam bir kez kayıtlı olmalı`).toHaveLength(1);
  return bulunan[0];
};
/** Sahte istek / yanıtla TEK bir zincir katmanını koşturur (işleyiciye ulaşmadan kapının kararını ölçer). */
async function katmanKostur(k: Katman, req: Record<string, unknown>): Promise<{ ileri: number; durum: number; govde: unknown }> {
  let ileri = 0; let durum = 0; let govde: unknown;
  const yanit = { status(kod: number) { durum = kod; return yanit; }, json(g: unknown) { govde = g; return yanit; } };
  await k.handle({ headers: {}, ...req }, yanit, () => { ileri++; });
  return { ileri, durum, govde };
}

beforeAll(async () => {
  yuklemeDizini = fs.mkdtempSync(path.join(os.tmpdir(), 'kucuk-kapanislar-'));
  process.env.PORT = '0';                                  // boş kapı; gerçek numara aşağıda dinleyiciden okunur
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgres://sinama/yok';      // yalnız «PG var» dalını açar; havuz PGlite
  process.env.SESSION_TOKEN_SECRET = 'sinama-sirri';
  process.env.UPLOAD_DIR = yuklemeDizini;
  process.env.SUPER_ADMIN_EMAILS = `${SUPER_EPOSTA},${SUPER_MUDUR_EPOSTA}`;
  // Kabuktan sızmış olabilecek dış sistem kimlikleri ve KİRACI ortam değerleri: bu sınama hiçbirini kullanmaz. Kiracı kimliği
  // bilerek TANIMSIZ — canlının bugünkü durumu (kiracı `users` taramasıyla çözülüyor); T11 bunu ölçer.
  for (const ad of Object.keys(process.env)) {
    if (/^(STRIPE|RESEND|LUCA|SHOPIFY|SMTP|GEMINI|ANTHROPIC|MIKRO|IYZICO|TRENDYOL|HEPSIBURADA|DHL|UPS|FEDEX|YURTICI|MNG|ARAS|WHATSAPP|FIREBASE|GOOGLE_APPLICATION|OPS_|SERVER_TENANT_)/.test(ad)) delete process.env[ad];
  }
  process.env.OPS_SUMMARY_TOKEN = OPS_JETONU;              // yalnız bu sınamanın jetonu (ölçüm ucu için)
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

  // Gerçek kiracı = CETPA: her iç rolden bir kullanıcı + stok kartı + Mikro aynasında son alış.
  for (const rol of STAFF_ROLES) await belgeKoy('users', icUid(rol), { email: eposta(icUid(rol)), role: rol, companyId: KIRACI });
  await belgeKoy('inventory', 'mikro-DYO-001', { sku: 'DYO-001', name: 'DYO Boya 15 L', stockLevel: 1, lowStockThreshold: 5, costPrice: 812.5, companyId: KIRACI });
  await pg().query("INSERT INTO mikro_cari_hesaplar (cari_kod, cari_unvan1) VALUES ('320.01.001', 'GİZLİ TEDARİKÇİ A.Ş.')");
  await pg().query(`INSERT INTO mikro_stok_hareketleri (sth_stok_kod, sth_cari_kodu, sth_tarih, veri) VALUES ('DYO-001', '320.01.001', '2026-09-30', '{"sth_tip":0,"sth_iptal":0}'::jsonb)`);
}, 240_000);

afterAll(async () => {
  globalThis.fetch = gercekFetch;
  const s = sunucu;
  if (s) { s.closeAllConnections(); await new Promise<void>(r => s.close(() => r())); }
  if (yuklemeDizini) fs.rmSync(yuklemeDizini, { recursive: true, force: true });
}, 30_000);

const sirTani = (b: Record<string, string> = { 'X-Ops-Token': OPS_JETONU }): Promise<Yanit> => istek('GET', '/api/ops/sir-tani', b);

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('T11 (D12) — kiracı taraması rolsüz belgeyi saymaz (ortam değeri YOK; gerçek `serverTenantId`)', () => {
  const cozuluyor = async (): Promise<unknown> => {
    const r = await sirTani();
    expect(r.s, r.metin).toBe(200);
    return (r.j.kiraci as { sahipCozuluyor: unknown; sahipOrtamdan: unknown });
  };

  it('başlangıç: ortamda kiracı kimliği yok, tek gerçek kiracı var → çözülüyor (taramayla)', async () => {
    expect(process.env.SERVER_TENANT_COMPANY_ID).toBeUndefined();
    expect(process.env.MIKRO_CRON_COMPANY_ID).toBeUndefined();
    expect(await cozuluyor()).toEqual({ sayi: 1, sahipCozuluyor: true, sahipOrtamdan: false });
  });

  it('giriş ekranından hesap açan yabancı (rolsüz belge) kiracı çözümünü BOZMAZ', async () => {
    // İstemcinin açılış yazımının bıraktığı belge: rol / kiracı alanı yok → eskiden «ikinci kiracı» sayılıyordu.
    const b = belirtec('yabanci-1');
    expect((await istek('PUT', '/api/db/users/yabanci-1?merge=1', b, { name: 'Yabancı', email: eposta('yabanci-1') })).s).toBe(200);
    expect(await belgeOku('users', 'yabanci-1')).toMatchObject({ name: 'Yabancı' });
    expect((await belgeOku('users', 'yabanci-1'))?.role).toBeUndefined();
    const k = await cozuluyor() as { sayi: number; sahipCozuluyor: boolean };
    expect(k.sayi).toBe(2);                              // ham sayım iki «kiracı» görüyor (yabancının belgesi orada) …
    expect(k.sahipCozuluyor).toBe(true);                 // … ama sunucunun kiracısı HÂLÂ çözülüyor
  });

  it('rol alanı geçersiz belgeler de bozmaz: sayı, uydurma dizge, uydurma kiracıyla birlikte', async () => {
    await belgeKoy('users', 'cop-1', { email: eposta('cop-1'), role: 1 });
    await belgeKoy('users', 'cop-2', { email: eposta('cop-2'), role: 'Viewer', companyId: 'UYDURMA-KIRACI' });
    await belgeKoy('users', 'cop-3', { email: eposta('cop-3'), role: '', companyId: 'UYDURMA-2' });
    expect(await cozuluyor()).toMatchObject({ sahipCozuluyor: true, sahipOrtamdan: false });
  });

  it('iki GERÇEK kiracı (rolü olan ikinci firma) → belirsiz; ortam değeri dolu → o; ikinci firma gidince yine çözülür', async () => {
    await belgeKoy('users', 'ikinci-sahip', { email: eposta('ikinci-sahip'), role: 'Admin' });
    expect(await cozuluyor()).toMatchObject({ sahipCozuluyor: false, sahipOrtamdan: false });
    process.env.SERVER_TENANT_COMPANY_ID = KIRACI;
    try { expect(await cozuluyor()).toMatchObject({ sahipCozuluyor: true, sahipOrtamdan: true }); }
    finally { delete process.env.SERVER_TENANT_COMPANY_ID; }
    expect(await cozuluyor()).toMatchObject({ sahipCozuluyor: false });
    await belgeSil('users', 'ikinci-sahip');
    expect(await cozuluyor()).toMatchObject({ sahipCozuluyor: true, sahipOrtamdan: false });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('T5 (D6) — `GET /api/ops/sir-tani` → `kullanici`: yalnız sayı ve en yeni dış rol girişi', () => {
  interface Blok { toplam: number; rolsuz: number; disRol: Record<string, number>; disRolSonGiris: string | null }
  const blok = async (): Promise<Blok> => { const r = await sirTani(); expect(r.s, r.metin).toBe(200); return r.j.kullanici as Blok; };

  it('jetonsuz / yanlış jeton → 401; oturum belirteci (Yönetici, süper yönetici) jeton YERİNE geçmez', async () => {
    for (const b of [{}, { 'X-Ops-Token': 'yanlis' }, ic('Admin'), SUPER]) {
      const r = await sirTani(b);
      expect([r.s, r.metin.includes('kullanici')]).toEqual([401, false]);
    }
    // Jeton sorgu dizesinde kabul edilmez.
    expect((await istek('GET', `/api/ops/sir-tani?token=${OPS_JETONU}`)).s).toBe(401);
  });

  it('sayılar `users` koleksiyonunu izler: toplam, rolsüz (alan yok + geçersiz değer), dış rol başına', async () => {
    const once = await blok();
    const toplamPg = await say("SELECT count(*)::int AS n FROM docs WHERE coll = 'users'");
    expect(once.toplam).toBe(toplamPg);
    expect(once).toEqual({ toplam: STAFF_ROLES.length + 4, rolsuz: 4, disRol: { B2B: 0, Dealer: 0 }, disRolSonGiris: null });   // 10 iç rol + yabanci-1 + cop-1..3
    expect(Object.keys(once.disRol).sort()).toEqual([...EXTERNAL_ROLES].map(String).sort());

    await belgeKoy('users', 'bayi-olcum-1', { email: 'gizli.bayi@example.test', name: 'Şirin Yapı Ltd.', role: 'Dealer', companyId: KIRACI, lastLogin: { _seconds: 1_760_000_000, _nanoseconds: 0 } });
    await belgeKoy('users', 'bayi-olcum-2', { email: 'ikinci.bayi@example.test', name: 'İkinci Bayi', role: 'Dealer', companyId: KIRACI, lastLogin: '2026-10-10T18:30:00.000Z' });
    await belgeKoy('users', 'b2b-olcum-1', { email: 'kurumsal@example.test', name: 'Kurumsal Müşteri', role: 'B2B', companyId: KIRACI });
    const sonra = await sirTani();
    expect(sonra.j.kullanici).toEqual({ toplam: once.toplam + 3, rolsuz: 4, disRol: { B2B: 1, Dealer: 2 }, disRolSonGiris: '2026-10-10T18:30:00.000Z' });

    // Yanıtta e-posta / ad / kullanıcı kimliği / kiracı kimliği deseni YOK.
    const metin = JSON.stringify(sonra.j.kullanici);
    expect(metin).not.toMatch(/@/);
    for (const yasak of ['example', 'bayi-olcum', 'b2b-olcum', 'Şirin', 'İkinci', 'Kurumsal', 'gizli', KIRACI, 'yabanci-1', 'ic-Admin']) expect(metin).not.toContain(yasak);
    expect(sonra.metin).not.toMatch(/[^\s@"]+@[^\s@"]+\.[^\s@"]+/);                       // yanıtın TAMAMINDA e-posta deseni yok
    for (const uid of ['bayi-olcum-1', 'b2b-olcum-1', 'yabanci-1', icUid('Admin')]) expect(sonra.metin).not.toContain(uid);

    // Dış rol hesapları kiracı çözümünü bozmaz (aynı kiracıdalar) — ve ölçüm bitince kaldırılır.
    expect((sonra.j.kiraci as { sahipCozuluyor: boolean }).sahipCozuluyor).toBe(true);
    for (const id of ['bayi-olcum-1', 'bayi-olcum-2', 'b2b-olcum-1']) await belgeSil('users', id);
    expect(await blok()).toEqual(once);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('T8 (D9) — `/increment` × `users`: korunan alanlar (role / companyId / status) artırılamaz', () => {
  const artir = (b: Record<string, string>, coll: string, id: string, field: string, ek: Record<string, string> = {}): Promise<Yanit> =>
    istek('PATCH', `/api/db/${coll}/${id}/increment`, { ...b, ...ek }, { field, delta: 1 });

  it('iç rol KENDİ belgesinde: role → 403 (rol yükseltme kapısı), status / companyId → 403 (korunan alan); belge DEĞİŞMEZ', async () => {
    const uid = 'artir-satis-1';
    const b = await kullanici(uid, { role: 'Sales', companyId: KIRACI });      // `status` alanı YOK: eskiden artırma onu 1 yapıyordu
    const once = JSON.stringify(await belgeOku('users', uid));
    const rol = await artir(b, 'users', uid, 'role');
    expect([rol.s, rol.j.error]).toEqual([403, 'Rol değişikliği için yönetici yetkisi gerekir.']);
    for (const alan of ['status', 'companyId']) {
      const r = await artir(b, 'users', uid, alan);
      expect([alan, r.s, r.j.error]).toEqual([alan, 403, 'Bu alan artırılamaz.']);
    }
    // İstemcinin gerçek yazımı (POST + yöntem tüneli) da aynı kapıdan geçer.
    const tunel = await istek('POST', `/api/db/users/${uid}/increment`, { ...b, 'X-Cetpa-Method': 'PATCH' }, { field: 'status', delta: 5 });
    expect(tunel.s).toBe(403);
    expect(JSON.stringify(await belgeOku('users', uid))).toBe(once);
  });

  it('meşru sayaç alanı GEÇER (kendi belgesinde, atomik): 0 → 1 → 3', async () => {
    const uid = 'artir-satis-2';
    const b = await kullanici(uid, { role: 'Sales', companyId: KIRACI });
    const ilk = await artir(b, 'users', uid, 'girisSayisi');
    expect([ilk.s, (ilk.j.data as { girisSayisi?: number }).girisSayisi]).toEqual([200, 1]);
    const ikinci = await istek('PATCH', `/api/db/users/${uid}/increment`, b, { field: 'girisSayisi', delta: 2 });
    expect([ikinci.s, (ikinci.j.data as { girisSayisi?: number }).girisSayisi]).toEqual([200, 3]);
    expect(await belgeOku('users', uid)).toMatchObject({ role: 'Sales', companyId: KIRACI, girisSayisi: 3 });
  });

  it('Yönetici ve süper yönetici için de: korunan alan HİÇ KİMSE için sayaç değildir (başkasının belgesinde de)', async () => {
    const hedef = 'artir-hedef-1';
    await kullanici(hedef, { role: 'HR', companyId: KIRACI });
    const once = JSON.stringify(await belgeOku('users', hedef));
    for (const [kim, b] of [['Yönetici', ic('Admin')], ['süper yönetici', SUPER]] as const) {
      for (const alan of ['role', 'status', 'companyId']) {
        const r = await artir(b, 'users', hedef, alan);
        expect([kim, alan, r.s]).toEqual([kim, alan, 403]);
      }
    }
    // Yönetici rol yükseltme kapısından GEÇER (rol yazabilir); onu durduran korunan alan kapısıdır.
    expect((await artir(ic('Admin'), 'users', hedef, 'role')).j.error).toBe('Bu alan artırılamaz.');
    expect(JSON.stringify(await belgeOku('users', hedef))).toBe(once);
    // Yönetici başkasının belgesinde meşru sayaç alanını artırır (kullanıcı yönetimi yetkisi değişmedi).
    expect((await artir(ic('Admin'), 'users', hedef, 'uyariSayisi')).s).toBe(200);
  });

  it('kapı YALNIZ `users` içindir: başka koleksiyonda aynı adlı alan ve stok sayacı bugünkü gibi; sahiplik alanı reddi (400) AYNEN', async () => {
    await belgeKoy('inventory', 'artir-stok-1', { sku: 'ART-1', name: 'Artırma Sınaması', stockLevel: 10, companyId: KIRACI });
    const stok = await artir(ic('Admin'), 'inventory', 'artir-stok-1', 'stockLevel');
    expect([stok.s, (stok.j.data as { stockLevel?: number }).stockLevel]).toEqual([200, 11]);
    for (const alan of ['role', 'status']) expect([alan, (await artir(ic('Admin'), 'inventory', 'artir-stok-1', alan)).s]).toEqual([alan, 200]);
    // Sahiplik alanları her koleksiyonda eski kapıdan (400) döner; `users` belgesinde `userId` de.
    const sahiplik = await artir(ic('Admin'), 'inventory', 'artir-stok-1', 'companyId');
    expect([sahiplik.s, sahiplik.j.error]).toEqual([400, 'Bu alan artırılamaz.']);
    expect((await artir(ic('Admin'), 'users', icUid('HR'), 'userId')).s).toBe(400);
    // Yetkisi olmayan iç rol başkasının belgesinde meşru alanı artıramaz (kendi kapısı — değişmedi).
    const yetkisiz = await artir(ic('Sales'), 'users', icUid('HR'), 'girisSayisi');
    expect([yetkisiz.s, yetkisiz.j.code]).toEqual([403, undefined]);
  });

  it('rolsüz hesap ve dış rol bu yola hiç ulaşamaz (tek boğaz); belgede rol alanı sayıya DÖNMEZ', async () => {
    for (const [uid, veri, kod] of [['artir-rolsuz-1', { name: 'Yabancı' }, 'ROL_YOK'], ['artir-bayi-1', { role: 'Dealer', companyId: KIRACI }, 'DIS_ROL']] as const) {
      const b = await kullanici(uid, veri);
      const once = JSON.stringify(await belgeOku('users', uid));
      for (const alan of ['role', 'status', 'girisSayisi']) {
        const r = await artir(b, 'users', uid, alan);
        expect([uid, alan, r.s, r.j.code]).toEqual([uid, alan, 403, kod]);
      }
      expect(JSON.stringify(await belgeOku('users', uid))).toBe(once);
      await belgeSil('users', uid);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('T9 (D10) — iki adımlı doğrulama ikinci adım olmadan sıfırlanamaz; Yönetici sıfırlama ucu', () => {
  const SIFIRLA = (uid: string): string => `/api/admin/users/${uid}/mfa-sifirla`;

  it('zincir: `enroll/start` kimlik kapısından sonra `requireMfaVerified` taşıyor; sıfırlama ucu `requireAuth` + `requireMfaVerified` (requireAdmin YOK)', () => {
    const basla = uc('POST', '/api/mfa/enroll/start').adlar;
    expect(basla.indexOf('requireMfaVerified')).toBe(basla.indexOf('requireAuth') + 1);
    const sifirla = uc('POST', '/api/admin/users/:uid/mfa-sifirla').adlar;
    expect(sifirla.indexOf('requireAuth')).toBeGreaterThan(-1);
    expect(sifirla.indexOf('requireMfaVerified')).toBe(sifirla.indexOf('requireAuth') + 1);
    expect(sifirla).not.toContain('requireAdmin');                // Müdür'ü de geçirirdi — kapı işleyicide: yalnız Yönetici
  });

  it('ilk kayıt 200 (kayıt yok); beklemedeki kayıt yeniden başlatılır; kodla doğrulanınca açılır', async () => {
    const uid = 'mfa-kul-1';
    const b = await kullanici(uid, { role: 'Sales', companyId: KIRACI });
    const ilk = await istek('POST', '/api/mfa/enroll/start', b, {});
    expect([ilk.s, typeof ilk.j.secretKey]).toEqual([200, 'string']);
    expect(await mfaKaydi(uid)).toEqual({ secret: ilk.j.secretKey, enabled: false });
    const yeniden = await istek('POST', '/api/mfa/enroll/start', b, {});      // beklemede (enabled = false): kapı geçirir
    expect(yeniden.s).toBe(200);
    expect(yeniden.j.secretKey).not.toBe(ilk.j.secretKey);
    const dogrula = await istek('POST', '/api/mfa/enroll/verify', b, { code: totpKodu({ secret: String(yeniden.j.secretKey) }) });
    expect([dogrula.s, dogrula.j.ok]).toEqual([200, true]);
    expect(await mfaKaydi(uid)).toEqual({ secret: yeniden.j.secretKey, enabled: true });
  });

  it('AÇIK + çerezsiz (yalnız parola bilen) → 403 `mfaRequired`; kayıt DEĞİŞMEZ; doğrulama kapalı duruma DÜŞMEZ', async () => {
    const uid = 'mfa-kul-2';
    await mfaKaydiKoy(uid);
    const b = await kullanici(uid, { role: 'Sales', companyId: KIRACI });
    const cerezler: Array<Record<string, string>> = [{}, { Cookie: '__cetpa_mfa=uydurma.imza' }, { Cookie: '__cetpa_mfa=' }];
    for (const ek of cerezler) {
      const r = await istek('POST', '/api/mfa/enroll/start', { ...b, ...ek }, {});
      expect([r.s, r.j.mfaRequired, r.j.secretKey]).toEqual([403, true, undefined]);
    }
    // Yöntem tüneli de aynı zincire düşer.
    expect((await istek('POST', '/api/mfa/enroll/start', { ...b, 'X-Cetpa-Method': 'POST' }, {})).s).toBe(403);
    expect(await mfaKaydi(uid)).toEqual({ secret: SABIT_SIR, enabled: true });
    const durum = await istek('GET', '/api/mfa/status', b);
    expect([durum.j.enabled, durum.j.verified]).toEqual([true, false]);
    // İkinci adımı gerektiren uçlar hâlâ kapalı (doğrulama gerçekten ayakta).
    const stok = await istek('GET', '/api/db/inventory', b);
    expect([stok.s, stok.j.mfaRequired]).toEqual([403, true]);
    // Başkasının çerezi işe yaramaz (çerez uid'e bağlı).
    const baskaB = await kullanici('mfa-kul-2b', { role: 'Sales', companyId: KIRACI });
    await mfaKaydiKoy('mfa-kul-2b');
    const baskaCerez = await mfaIleGir(baskaB);
    expect((await istek('POST', '/api/mfa/enroll/start', { ...b, Cookie: baskaCerez }, {})).s).toBe(403);
    expect(await mfaKaydi(uid)).toEqual({ secret: SABIT_SIR, enabled: true });
  });

  it('kodla DOĞRULANMIŞ oturum → 200: cihaz değiştirme çalışıyor', async () => {
    const uid = 'mfa-kul-3';
    await mfaKaydiKoy(uid);
    const b = await kullanici(uid, { role: 'Sales', companyId: KIRACI });
    const cerez = await mfaIleGir(b);
    const r = await istek('POST', '/api/mfa/enroll/start', { ...b, Cookie: cerez }, {});
    expect([r.s, typeof r.j.secretKey]).toEqual([200, 'string']);
    expect(r.j.secretKey).not.toBe(SABIT_SIR);
    const dogrula = await istek('POST', '/api/mfa/enroll/verify', { ...b, Cookie: cerez }, { code: totpKodu({ secret: String(r.j.secretKey) }) });
    expect(dogrula.s).toBe(200);
    expect(await mfaKaydi(uid)).toEqual({ secret: r.j.secretKey, enabled: true });
  });

  it('sıfırlama: Müdür 403, diğer iç roller 403, kendi hesabı 400, olmayan kullanıcı 404 — kayıt ve denetim günlüğü DEĞİŞMEZ', async () => {
    const hedef = 'mfa-hedef-1';
    await mfaKaydiKoy(hedef);
    await kullanici(hedef, { role: 'Sales', companyId: KIRACI });
    const denetimOnce = await say("SELECT count(*)::int AS n FROM docs WHERE coll = 'auditLog'");
    for (const rol of STAFF_ROLES.filter(r => r !== 'Admin')) {
      const r = await istek('POST', SIFIRLA(hedef), ic(rol), {});
      expect([rol, r.s, r.j.code]).toEqual([rol, 403, 'YONETICI_GEREKLI']);
    }
    const kendi = await istek('POST', SIFIRLA(icUid('Admin')), ic('Admin'), {});
    expect([kendi.s, kendi.j.success]).toEqual([400, false]);
    expect((await istek('POST', SIFIRLA('boyle-biri-yok'), ic('Admin'), {})).s).toBe(404);
    expect((await istek('POST', SIFIRLA(hedef), {}, {})).s).toBe(401);                    // kimliksiz
    expect(await mfaKaydi(hedef)).toEqual({ secret: SABIT_SIR, enabled: true });
    expect(await say("SELECT count(*)::int AS n FROM docs WHERE coll = 'auditLog'")).toBe(denetimOnce);
  });

  it('sıfırlama: Yönetici 200 → kayıt SİLİNİR, önbellek düşer (kullanıcı hemen kodsuz girer), denetim kaydı yazılır', async () => {
    const hedef = 'mfa-hedef-2';
    await mfaKaydiKoy(hedef);
    const hb = await kullanici(hedef, { role: 'Sales', companyId: KIRACI });
    // Önbelleği ISIT: sunucu bu kullanıcının doğrulamasını «açık» olarak önbelleğe alsın (60 sn).
    expect((await istek('GET', '/api/mfa/status', hb)).j).toMatchObject({ enabled: true, verified: false });
    expect((await istek('GET', '/api/db/inventory', hb)).s).toBe(403);

    const r = await istek('POST', SIFIRLA(hedef), ic('Admin'), {});
    expect([r.s, r.j]).toEqual([200, { success: true, kayitVardi: true }]);
    expect(await mfaKaydi(hedef)).toBeUndefined();
    // Önbellek düştü: 60 sn beklemeden kapalı görünür, veri ucu açılır, kullanıcı yeniden kayıt başlatabilir.
    expect((await istek('GET', '/api/mfa/status', hb)).j).toMatchObject({ enabled: false, verified: true });
    expect((await istek('GET', '/api/db/inventory', hb)).s).toBe(200);
    expect((await istek('POST', '/api/mfa/enroll/start', hb, {})).s).toBe(200);

    const kayitlar = (await pg().query("SELECT data FROM docs WHERE coll = 'auditLog' AND data->>'action' = 'İki faktörlü doğrulama sıfırlandı'")).rows.map(x => x.data as Record<string, unknown>);
    expect(kayitlar).toHaveLength(1);
    expect(kayitlar[0]).toMatchObject({ userId: icUid('Admin'), userEmail: eposta(icUid('Admin')), companyId: KIRACI, source: 'server', details: `${eposta(hedef)} (${hedef})` });

    // Beklemedeki yeni kayıt da sıfırlanabilir; kaydı olmayan kullanıcıda uç 200 + `kayitVardi: false` (yinelenebilir).
    expect((await istek('POST', SIFIRLA(hedef), ic('Admin'), {})).j).toEqual({ success: true, kayitVardi: true });
    const bos = await istek('POST', SIFIRLA(hedef), ic('Admin'), {});
    expect([bos.s, bos.j]).toEqual([200, { success: true, kayitVardi: false }]);
    const sonKayit = (await pg().query("SELECT data FROM docs WHERE coll = 'auditLog' AND data->>'action' = 'İki faktörlü doğrulama sıfırlandı' AND data->>'details' LIKE '%kayıt yoktu'")).rows;
    expect(sonKayit).toHaveLength(1);
  });

  it('kiracı sınırı: başka firmanın kullanıcısı ve kiracı alanı OLMAYAN belge → 403, kayıt durur; süper yönetici kiracılar arası sıfırlar', async () => {
    await mfaKaydiKoy('mfa-baska-1'); await kullanici('mfa-baska-1', { role: 'Sales', companyId: BASKA_KIRACI });
    await mfaKaydiKoy('mfa-etiketsiz-1'); await kullanici('mfa-etiketsiz-1', { role: 'Admin' });       // kiracısı kendi kimliği (başka firmanın kurucusu)
    for (const hedef of ['mfa-baska-1', 'mfa-etiketsiz-1']) {
      const r = await istek('POST', SIFIRLA(hedef), ic('Admin'), {});
      expect([hedef, r.s, r.j.error]).toEqual([hedef, 403, 'Bu kullanıcı başka bir firmaya ait.']);
      expect(await mfaKaydi(hedef)).toEqual({ secret: SABIT_SIR, enabled: true });
    }
    // Süper yönetici (rolü ve `users` belgesi yok): Müdür kapısına takılmaz, kiracı sınırı uygulanmaz.
    const s = await istek('POST', SIFIRLA('mfa-baska-1'), SUPER, {});
    expect([s.s, s.j]).toEqual([200, { success: true, kayitVardi: true }]);
    expect(await mfaKaydi('mfa-baska-1')).toBeUndefined();
    // Süper yönetici de KENDİ hesabını buradan sıfırlayamaz.
    expect((await istek('POST', SIFIRLA('super-1'), SUPER, {})).s).toBe(400);
    // Doğrulanmamış e-postayla aynı adres süper yönetici SAYILMAZ (rolsüz hesap muamelesi — tek boğaz).
    const sahte = await istek('POST', SIFIRLA('mfa-etiketsiz-1'), belirtec('super-9', SUPER_EPOSTA, false), {});
    expect([sahte.s, sahte.j.code]).toEqual([403, 'ROL_YOK']);
    expect(await mfaKaydi('mfa-etiketsiz-1')).toEqual({ secret: SABIT_SIR, enabled: true });
  });

  it('çağıranın KENDİ ikinci adımı doğrulanmış olmalı: doğrulaması açık Yönetici çerezsiz → 403 `mfaRequired`; çerezle → 200', async () => {
    const yon = 'mfa-yonetici-1';
    await mfaKaydiKoy(yon);
    const yb = await kullanici(yon, { role: 'Admin', companyId: KIRACI });
    await mfaKaydiKoy('mfa-hedef-3'); await kullanici('mfa-hedef-3', { role: 'Logistics', companyId: KIRACI });
    const cerezsiz = await istek('POST', SIFIRLA('mfa-hedef-3'), yb, {});
    expect([cerezsiz.s, cerezsiz.j.mfaRequired]).toEqual([403, true]);
    expect(await mfaKaydi('mfa-hedef-3')).toEqual({ secret: SABIT_SIR, enabled: true });
    const cerez = await mfaIleGir(yb);
    expect((await istek('POST', SIFIRLA('mfa-hedef-3'), { ...yb, Cookie: cerez }, {})).j).toEqual({ success: true, kayitVardi: true });
    expect(await mfaKaydi('mfa-hedef-3')).toBeUndefined();
  });

  it('rolsüz hesap ve dış rol sıfırlama ucuna ulaşamaz (tek boğaz); ilk kayıtları bozulmadı', async () => {
    await mfaKaydiKoy('mfa-hedef-4'); await kullanici('mfa-hedef-4', { role: 'Sales', companyId: KIRACI });
    for (const [uid, veri, kod] of [['mfa-rolsuz-1', { name: 'Yabancı' }, 'ROL_YOK'], ['mfa-bayi-1', { role: 'Dealer', companyId: KIRACI }, 'DIS_ROL']] as const) {
      const b = await kullanici(uid, veri);
      const r = await istek('POST', SIFIRLA('mfa-hedef-4'), b, {});
      expect([uid, r.s, r.j.code]).toEqual([uid, 403, kod]);
      // İlk kayıt (kayıt yok) rolsüz hesapta ve dış rolde de çalışır; açıldıktan sonra çerezsiz yeniden başlatılamaz.
      const basla = await istek('POST', '/api/mfa/enroll/start', b, {});
      expect([uid, basla.s]).toEqual([uid, 200]);
      expect((await istek('POST', '/api/mfa/enroll/verify', b, { code: totpKodu({ secret: String(basla.j.secretKey) }) })).s).toBe(200);
      const yeniden = await istek('POST', '/api/mfa/enroll/start', b, {});
      expect([uid, yeniden.s, yeniden.j.mfaRequired]).toEqual([uid, 403, true]);
      await pg().query('DELETE FROM mfa_secrets WHERE uid = $1', [uid]);
      await belgeSil('users', uid);
    }
    expect(await mfaKaydi('mfa-hedef-4')).toEqual({ secret: SABIT_SIR, enabled: true });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('T10 (D11) — Yönetici rolüne yalnız Yönetici dokunur; davet kodu 64 onaltılık hane', () => {
  const MUDUR = ic('Manager');
  const YONETICI = ic('Admin');
  const kullaniciBul = async (ep: string): Promise<Record<string, unknown> | undefined> =>
    (await pg().query("SELECT data FROM docs WHERE coll = 'users' AND data->>'email' = $1", [ep])).rows[0]?.data as Record<string, unknown> | undefined;
  const davetBul = async (ep: string): Promise<Array<{ id: string; data: Record<string, unknown> }>> =>
    (await pg().query("SELECT id, data FROM docs WHERE coll = 'invites' AND data->>'email' = $1", [ep])).rows as Array<{ id: string; data: Record<string, unknown> }>;
  const acilanlar = (): string[] => hesapCagrilari().filter(c => c.ne === 'ac').map(c => c.kim);
  const silinenler = (): string[] => hesapCagrilari().filter(c => c.ne === 'sil').map(c => c.kim);

  it('hesap açma: Müdür `role: Admin` → 403, hesap AÇILMAZ; Müdür Satış hesabı → 200; Yönetici Yönetici hesabı → 200', async () => {
    const ret = await istek('POST', '/api/admin/users', MUDUR, { email: 'mudurun-ikinci-adresi@example.test', role: 'Admin' });
    expect([ret.s, ret.j.code, ret.j.success]).toEqual([403, 'YONETICI_GEREKLI', false]);
    expect(ret.metin).not.toContain('parola');                                              // parola belirleme bağlantısı dönmedi
    expect(acilanlar()).not.toContain('mudurun-ikinci-adresi@example.test');
    expect(await kullaniciBul('mudurun-ikinci-adresi@example.test')).toBeUndefined();

    const satis = await istek('POST', '/api/admin/users', MUDUR, { email: 'yeni-satis@example.test', role: 'Sales', displayName: 'Yeni Satış' });
    expect([satis.s, satis.j.success, typeof satis.j.parolaLinki]).toEqual([200, true, 'string']);
    expect(await kullaniciBul('yeni-satis@example.test')).toMatchObject({ role: 'Sales', companyId: KIRACI, createdBy: icUid('Manager') });
    // Rol verilmezse varsayılan Satış'tır: Müdür için bugünkü gibi çalışır.
    expect((await istek('POST', '/api/admin/users', MUDUR, { email: 'varsayilan@example.test' })).s).toBe(200);
    expect(await kullaniciBul('varsayilan@example.test')).toMatchObject({ role: 'Sales' });
    // Müdür, Müdür rollü hesap da açabilir (kural YALNIZ Yönetici rolü için).
    expect((await istek('POST', '/api/admin/users', MUDUR, { email: 'ikinci-mudur@example.test', role: 'Manager' })).s).toBe(200);

    const yon = await istek('POST', '/api/admin/users', YONETICI, { email: 'yeni-yonetici@example.test', role: 'Admin' });
    expect([yon.s, yon.j.success]).toEqual([200, true]);
    expect(await kullaniciBul('yeni-yonetici@example.test')).toMatchObject({ role: 'Admin', companyId: KIRACI });
    expect(acilanlar()).toEqual(['yeni-satis@example.test', 'varsayilan@example.test', 'ikinci-mudur@example.test', 'yeni-yonetici@example.test']);
  });

  it('süper yönetici: Müdür rolündeyken Yönetici hesabı açabilir; rolü yoksa `requireAdmin` bugünkü gibi 403 verir', async () => {
    const sm = await kullanici('super-mudur', { role: 'Manager', companyId: KIRACI }, SUPER_MUDUR_EPOSTA);
    const r = await istek('POST', '/api/admin/users', sm, { email: 'super-acti@example.test', role: 'Admin' });
    expect([r.s, r.j.success]).toEqual([200, true]);
    // Aynı Müdür, e-postası doğrulanmamışken süper yönetici SAYILMAZ: önce tek boğaz değil (iç rol), kendi kapısı keser.
    const dogrulanmamis = await istek('POST', '/api/admin/users', belirtec('super-mudur', SUPER_MUDUR_EPOSTA, false), { email: 'olmaz@example.test', role: 'Admin' });
    expect([dogrulanmamis.s, dogrulanmamis.j.code]).toEqual([403, 'YONETICI_GEREKLI']);
    const rolsuzSuper = await istek('POST', '/api/admin/users', SUPER, { email: 'olmaz2@example.test', role: 'Sales' });
    expect([rolsuzSuper.s, rolsuzSuper.j.error]).toEqual([403, 'Bu işlem için yönetici yetkisi gerekir.']);
    expect(acilanlar()).not.toContain('olmaz@example.test'); expect(acilanlar()).not.toContain('olmaz2@example.test');
  });

  it('davet: Müdür `role: Admin` → 403, davet YAZILMAZ; Müdür Satış daveti → 200; kod 64 onaltılık hane ve her seferinde farklı', async () => {
    const ret = await istek('POST', '/api/admin/invite', MUDUR, { email: 'davetli-yonetici@example.test', role: 'Admin' });
    expect([ret.s, ret.j.code]).toEqual([403, 'YONETICI_GEREKLI']);
    expect(ret.j.inviteUrl).toBeUndefined();
    expect(await davetBul('davetli-yonetici@example.test')).toEqual([]);

    const kodlar: string[] = [];
    for (const [b, ep, rol] of [[MUDUR, 'davetli-satis@example.test', 'Sales'], [MUDUR, 'davetli-2@example.test', undefined], [YONETICI, 'davetli-yonetici@example.test', 'Admin']] as const) {
      const r = await istek('POST', '/api/admin/invite', b, rol ? { email: ep, role: rol } : { email: ep });
      expect([ep, r.s, r.j.success, r.j.emailSent]).toEqual([ep, 200, true, false]);
      const kod = String(r.j.inviteUrl).split('?invite=')[1];
      expect(kod, String(r.j.inviteUrl)).toMatch(/^[0-9a-f]{64}$/);
      const davet = await davetBul(ep);
      expect(davet).toHaveLength(1);
      expect([davet[0].id, davet[0].data.token, davet[0].data.role, davet[0].data.companyId, davet[0].data.used]).toEqual([kod, kod, rol ?? 'Sales', KIRACI, false]);
      kodlar.push(kod);
    }
    expect(new Set(kodlar).size).toBe(3);
    // Eski biçim (36'lık tabanda iki `Math.random` parçası) artık üretilmiyor: `g`–`z` harfi yok.
    expect(kodlar.join('')).not.toMatch(/[g-z]/);

    // Yeni kod davet kabulünde çalışır: davetli (rolsüz hesap) kodu kullanır, rolü ve kiracıyı alır.
    const davetli = belirtec('davetli-satis-uid', 'davetli-satis@example.test');
    const kabul = await istek('POST', '/api/invites/redeem', davetli, { token: kodlar[0] });
    expect([kabul.s, kabul.j.success, kabul.j.role]).toEqual([200, true, 'Sales']);
    expect(await belgeOku('users', 'davetli-satis-uid')).toMatchObject({ role: 'Sales', companyId: KIRACI });
  });

  it('süper yöneticinin kiracı daveti AYNI üreteçten: kod 64 onaltılık hane, belge kimliği = kod; davet kabulünde çalışır; kapısı değişmedi', async () => {
    // İkinci davet üreteci (`POST /api/superadmin/tenants/:companyId/invite`) `Math.random().toString(36)` × 2 ile kalmıştı.
    const kodlar: string[] = [];
    for (const [ep, rol] of [['super-davetli-1@example.test', 'Sales'], ['super-davetli-2@example.test', 'Admin']] as const) {
      const r = await istek('POST', `/api/superadmin/tenants/${KIRACI}/invite`, SUPER, { email: ep, role: rol });
      expect([ep, r.s, r.j.success, r.j.emailSent]).toEqual([ep, 200, true, false]);
      const kod = String(r.j.inviteUrl).split('?invite=')[1];
      expect(kod, String(r.j.inviteUrl)).toMatch(/^[0-9a-f]{64}$/);
      const davet = await davetBul(ep);
      expect(davet).toHaveLength(1);
      expect([davet[0].id, davet[0].data.token, davet[0].data.role, davet[0].data.companyId, davet[0].data.used, davet[0].data.invitedBySuperAdmin])
        .toEqual([kod, kod, rol, KIRACI, false, SUPER_EPOSTA]);
      kodlar.push(kod);
    }
    expect(new Set(kodlar).size).toBe(2);

    const davetli = belirtec('super-davetli-uid', 'super-davetli-1@example.test');
    const kabul = await istek('POST', '/api/invites/redeem', davetli, { token: kodlar[0] });
    expect([kabul.s, kabul.j.success, kabul.j.role, kabul.j.companyId]).toEqual([200, true, 'Sales', KIRACI]);
    expect(await belgeOku('users', 'super-davetli-uid')).toMatchObject({ role: 'Sales', companyId: KIRACI });

    // Kapı AYNEN: süper yönetici olmayan Yönetici bu uçtan davet açamaz, davet yazılmaz.
    const ret = await istek('POST', `/api/superadmin/tenants/${KIRACI}/invite`, YONETICI, { email: 'super-olmaz@example.test', role: 'Sales' });
    expect([ret.s, ret.j.error]).toEqual([403, 'Bu işlem için süper-admin yetkisi gerekir.']);
    expect(await davetBul('super-olmaz@example.test')).toEqual([]);
  });

  it('silme: Müdür Yönetici hesabını silemez (belge ve Firebase hesabı durur); Satış hesabını siler; Yönetici Yönetici\'yi siler', async () => {
    await kullanici('sil-yonetici-1', { role: 'Admin', companyId: KIRACI });
    await kullanici('sil-yonetici-2', { role: 'Admin' });                       // kiracı alanı OLMAYAN Yönetici belgesi: eskiden kiracı denetimini de atlıyordu
    await kullanici('sil-satis-1', { role: 'Sales', companyId: KIRACI });
    for (const hedef of ['sil-yonetici-1', 'sil-yonetici-2']) {
      const r = await istek('DELETE', `/api/admin/users/${hedef}`, MUDUR);
      expect([hedef, r.s, r.j.code]).toEqual([hedef, 403, 'YONETICI_GEREKLI']);
      expect(await belgeOku('users', hedef)).toMatchObject({ role: 'Admin' });
    }
    expect(silinenler()).toEqual([]);
    // Yöntem tüneliyle de (istemcinin gerçek yazımı).
    expect((await istek('POST', '/api/admin/users/sil-yonetici-1', { ...MUDUR, 'X-Cetpa-Method': 'DELETE' })).s).toBe(403);
    expect(silinenler()).toEqual([]);

    const satis = await istek('DELETE', '/api/admin/users/sil-satis-1', MUDUR);
    expect([satis.s, satis.j.success]).toEqual([200, true]);
    expect(await belgeOku('users', 'sil-satis-1')).toBeUndefined();
    const yon = await istek('DELETE', '/api/admin/users/sil-yonetici-1', YONETICI);
    expect([yon.s, yon.j.success]).toEqual([200, true]);
    expect(await belgeOku('users', 'sil-yonetici-1')).toBeUndefined();
    expect(silinenler()).toEqual(['sil-satis-1', 'sil-yonetici-1']);
    // Eski kurallar AYNEN: kendi hesabı 400, başka firmanın kullanıcısı 403 (kendi iletisiyle), olmayan kullanıcı 404.
    expect((await istek('DELETE', `/api/admin/users/${icUid('Manager')}`, MUDUR)).s).toBe(400);
    await kullanici('sil-baska-1', { role: 'Sales', companyId: BASKA_KIRACI });
    const baska = await istek('DELETE', '/api/admin/users/sil-baska-1', MUDUR);
    expect([baska.s, baska.j.error]).toEqual([403, 'Bu kullanıcı başka bir firmaya ait.']);
    expect((await istek('DELETE', '/api/admin/users/boyle-biri-yok', MUDUR)).s).toBe(404);
    await belgeSil('users', 'sil-yonetici-2');
  });

  it('silme /api/db yolundan da: Müdür Yönetici belgesini silemez (düz ve tünelli), belge durur; Satış\'ı siler; Yönetici Yönetici\'yi siler', async () => {
    // 2026-10-17 inceleme bulgusu: kural yalnız `/api/admin/users/:uid`'deydi; `DELETE /api/db/users/<uid>` aynı silmeyi kapısız yapıyordu.
    await kullanici('db-sil-yonetici-1', { role: 'Admin', companyId: KIRACI });
    await kullanici('db-sil-yonetici-2', { role: 'Admin', companyId: KIRACI });
    await kullanici('db-sil-satis-1', { role: 'Sales', companyId: KIRACI });
    const duz = await istek('DELETE', '/api/db/users/db-sil-yonetici-1', MUDUR);
    // Gövde `/api/admin/users` reddiyle BİREBİR aynı (tek sabit).
    const adminUcu = await istek('DELETE', '/api/admin/users/db-sil-yonetici-1', MUDUR);
    expect([duz.s, duz.j]).toEqual([403, { success: false, error: 'Yönetici rolündeki hesaplarla ilgili işlemleri yalnız Yönetici yapabilir.', code: 'YONETICI_GEREKLI' }]);
    expect([adminUcu.s, adminUcu.j]).toEqual([duz.s, duz.j]);
    // Yöntem tüneliyle de (istemcinin gerçek yazımı: `POST` + `X-Cetpa-Method: DELETE`).
    const tunel = await istek('POST', '/api/db/users/db-sil-yonetici-1', { ...MUDUR, 'X-Cetpa-Method': 'DELETE' });
    expect([tunel.s, tunel.j.code]).toEqual([403, 'YONETICI_GEREKLI']);
    expect(await belgeOku('users', 'db-sil-yonetici-1')).toMatchObject({ role: 'Admin', companyId: KIRACI });

    // Sıra: sahiplik ÖNCE — başka kiracıdaki Yönetici belgesi için kiracı reddi döner (rol bu yanıttan sızmaz), belge durur.
    await kullanici('db-sil-baska-yonetici', { role: 'Admin', companyId: BASKA_KIRACI });
    const baska = await istek('DELETE', '/api/db/users/db-sil-baska-yonetici', MUDUR);
    expect([baska.s, baska.j.error, baska.j.code]).toEqual([403, 'Bu kayıt başka bir firmaya ait.', undefined]);
    expect(await belgeOku('users', 'db-sil-baska-yonetici')).toMatchObject({ role: 'Admin' });

    // Müdür'ün diğer rollerdeki yetkisi DEĞİŞMEDİ.
    const satis = await istek('DELETE', '/api/db/users/db-sil-satis-1', MUDUR);
    expect([satis.s, satis.j.ok]).toEqual([200, true]);
    expect(await belgeOku('users', 'db-sil-satis-1')).toBeUndefined();
    // Yönetici Yönetici'yi siler; süper yönetici (Müdür rolünde bile) siler.
    const yon = await istek('DELETE', '/api/db/users/db-sil-yonetici-1', YONETICI);
    expect([yon.s, yon.j.ok]).toEqual([200, true]);
    expect(await belgeOku('users', 'db-sil-yonetici-1')).toBeUndefined();
    const sm = await kullanici('db-super-mudur', { role: 'Manager', companyId: KIRACI }, SUPER_MUDUR_EPOSTA);
    const superSil = await istek('DELETE', '/api/db/users/db-sil-yonetici-2', sm);
    expect([superSil.s, superSil.j.ok]).toEqual([200, true]);
    expect(await belgeOku('users', 'db-sil-yonetici-2')).toBeUndefined();
    await belgeSil('users', 'db-sil-baska-yonetici');
    await belgeSil('users', 'db-super-mudur');
  });

  // 2026-10-17 son tur: silme kapandı ama YAZMA açıktı — Müdür (`users` yazabilen tek iç rol; `ADMIN_ONLY_COLLECTIONS`) Yönetici'nin
  // belgesine PUT / PATCH / koşullu yazma / artırma yapabiliyordu. `role` / `status` / `companyId` sabitleniyordu, ama PUT belgeyi
  // baştan yazdığı için ad, e-posta ve diğer alanlar silinebiliyor / değiştirilebiliyordu. Kural silmeyle AYNI: hedef belgenin
  // ÖNCEKİ rolü `Admin` ise yalnız Yönetici ya da süper yönetici yazar; kendi belgesi (oturum açılışı senkronu) istisnadır.
  // SIRA: «baştan yaz» EN SONDA — rolü gövdede taşımadığı için (taşısa Müdür'ü rol yükseltme kapısı keserdi) Yönetici'nin yazımında
  // hedefin rol alanı düşer (bugünkü davranış; Yönetici yalnız `companyId`'ye sabitlenir) ve sonraki yollar kuralı sınamazdı.
  const YAZMA_YOLLARI: ReadonlyArray<{ ad: string; yontem: string; ek: string; govde: (onceki: Record<string, unknown>) => unknown }> = [
    { ad: 'PUT (birleştir)', yontem: 'PUT', ek: '?merge=1', govde: () => ({ name: 'Değiştirildi' }) },
    { ad: 'PATCH', yontem: 'PATCH', ek: '', govde: () => ({ name: 'Değiştirildi', email: 'ele-gecirildi@example.test' }) },
    { ad: 'koşullu yazma', yontem: 'PATCH', ek: '/cas', govde: (o) => ({ field: 'email', expect: o.email, set: { email: 'ele-gecirildi@example.test' } }) },
    { ad: 'artırma', yontem: 'PATCH', ek: '/increment', govde: () => ({ field: 'girisSayaci', delta: 1 }) },
    { ad: 'PUT (baştan yaz)', yontem: 'PUT', ek: '?merge=0', govde: () => ({ name: 'Baştan yazıldı', email: 'ele-gecirildi@example.test' }) },
  ];
  /** Yazma yolunu düz ya da yöntem tüneliyle (istemcinin gerçek yazımı: `POST` + `X-Cetpa-Method`) çağırır. */
  const yaz = async (y: (typeof YAZMA_YOLLARI)[number], hedef: string, b: Record<string, string>, tunel: boolean): Promise<Yanit> => {
    const yol = `/api/db/users/${hedef}${y.ek}`;
    const govde = y.govde((await belgeOku('users', hedef)) ?? {});
    return tunel ? istek('POST', yol, { ...b, 'X-Cetpa-Method': y.yontem }, govde) : istek(y.yontem, yol, b, govde);
  };

  it('yazma /api/db yolundan: Müdür Yönetici belgesine PUT / PATCH / koşullu yazma / artırma yapamaz (düz ve tünelli), belge DEĞİŞMEZ', async () => {
    const mudur = await kullanici('yaz-mudur', { role: 'Manager', companyId: KIRACI, name: 'Yazan Müdür' });
    await kullanici('yaz-yonetici-1', { role: 'Admin', companyId: KIRACI, name: 'Asıl Yönetici', telefon: '0555 000 00 00' });
    const ilk = await belgeOku('users', 'yaz-yonetici-1');
    for (const y of YAZMA_YOLLARI) for (const tunel of [false, true]) {
      const r = await yaz(y, 'yaz-yonetici-1', mudur, tunel);
      // Gövde silme ve `/api/admin/users` reddiyle BİREBİR aynı (tek sabit).
      expect([y.ad, tunel, r.s, r.j]).toEqual([y.ad, tunel, 403, { success: false, error: 'Yönetici rolündeki hesaplarla ilgili işlemleri yalnız Yönetici yapabilir.', code: 'YONETICI_GEREKLI' }]);
      expect([y.ad, tunel, await belgeOku('users', 'yaz-yonetici-1')]).toEqual([y.ad, tunel, ilk]);
    }

    // Sıra: sahiplik ÖNCE — başka kiracıdaki Yönetici belgesi için kiracı reddi döner (rol bu yanıttan sızmaz), belge durur.
    await kullanici('yaz-baska-yonetici', { role: 'Admin', companyId: BASKA_KIRACI, name: 'Başka Firma Yöneticisi' });
    const baskaIlk = await belgeOku('users', 'yaz-baska-yonetici');
    for (const y of YAZMA_YOLLARI) {
      const r = await yaz(y, 'yaz-baska-yonetici', mudur, false);
      expect([y.ad, r.s, r.j.error, r.j.code]).toEqual([y.ad, 403, 'Bu kayıt başka bir firmaya ait.', undefined]);
    }
    expect(await belgeOku('users', 'yaz-baska-yonetici')).toEqual(baskaIlk);
    await belgeSil('users', 'yaz-baska-yonetici');
  });

  it('yazma /api/db yolundan: Müdür\'ün Satış belgesine ve kendi belgesine yazımı, Yönetici\'nin Yönetici belgelerine yazımı BUGÜNKÜ gibi (200)', async () => {
    const mudur = belirtec('yaz-mudur');
    await kullanici('yaz-satis-1', { role: 'Sales', companyId: KIRACI, name: 'Satışçı' });
    // Müdür → Satış belgesi: dört yol da geçer (kural YALNIZ Yönetici rolündeki belge için).
    for (const y of YAZMA_YOLLARI) {
      const r = await yaz(y, 'yaz-satis-1', mudur, false);
      expect([y.ad, r.s]).toEqual([y.ad, 200]);
    }
    // «Baştan yaz» belgeyi gerçekten baştan yazar (artırılan sayaç gitti); korunan alanlar öncekine sabitlenir.
    const satis = await belgeOku('users', 'yaz-satis-1');
    expect(satis).toMatchObject({ role: 'Sales', companyId: KIRACI, name: 'Baştan yazıldı', email: 'ele-gecirildi@example.test' });
    expect(satis?.girisSayaci).toBeUndefined();
    const patch = await istek('PATCH', '/api/db/users/yaz-satis-1', mudur, { name: 'Satışçı 2' });
    expect([patch.s, (await belgeOku('users', 'yaz-satis-1'))?.name]).toEqual([200, 'Satışçı 2']);

    // Müdür → kendi belgesi (oturum açılışı senkronu: `updateDoc` = PATCH, ilk girişte `setDoc` = PUT).
    const kendiPatch = await istek('PATCH', '/api/db/users/yaz-mudur', mudur, { name: 'Müdür (senkron)', lastLogin: 'şimdi' });
    expect(kendiPatch.s).toBe(200);
    const kendiPut = await istek('PUT', '/api/db/users/yaz-mudur?merge=1', mudur, { device: 'sınama' });
    expect(kendiPut.s).toBe(200);
    expect(await belgeOku('users', 'yaz-mudur')).toMatchObject({ role: 'Manager', companyId: KIRACI, name: 'Müdür (senkron)', device: 'sınama' });

    // Yönetici → başka Yönetici belgesi: dört yol da geçer (tünelli de). «Baştan yaz»dan önce belge hâlâ Yönetici rolünde.
    const yonetici = await kullanici('yaz-yonetici-2', { role: 'Admin', companyId: KIRACI, name: 'İkinci Yönetici' });
    for (const y of YAZMA_YOLLARI) {
      if (y.ad === 'PUT (baştan yaz)') expect(await belgeOku('users', 'yaz-yonetici-1')).toMatchObject({ role: 'Admin', name: 'Değiştirildi', email: 'ele-gecirildi@example.test', girisSayaci: 2 });   // düz + tünelli
      for (const tunel of [false, true]) {
        const r = await yaz(y, 'yaz-yonetici-1', yonetici, tunel);
        expect([y.ad, tunel, r.s]).toEqual([y.ad, tunel, 200]);
      }
    }
    expect(await belgeOku('users', 'yaz-yonetici-1')).toMatchObject({ companyId: KIRACI, name: 'Baştan yazıldı', email: 'ele-gecirildi@example.test' });

    // Yönetici → kendi belgesi, oturum açılışı senkronu (PUT, istemcinin `setDoc` gövdesi: rol dâhil).
    const kendi = await istek('PUT', '/api/db/users/yaz-yonetici-2?merge=0', yonetici, { name: 'İkinci Yönetici', email: eposta('yaz-yonetici-2'), role: 'Admin', device: 'sınama' });
    expect(kendi.s).toBe(200);
    expect(await belgeOku('users', 'yaz-yonetici-2')).toMatchObject({ role: 'Admin', companyId: KIRACI, device: 'sınama' });

    // Süper yönetici (Müdür rolünde bile) Yönetici belgesine yazar.
    const sm = await kullanici('yaz-super-mudur', { role: 'Manager', companyId: KIRACI }, SUPER_MUDUR_EPOSTA);
    const superYaz = await istek('PATCH', '/api/db/users/yaz-yonetici-2', sm, { name: 'Süper yönetici yazdı' });
    expect([superYaz.s, await belgeOku('users', 'yaz-yonetici-2')]).toEqual([200, expect.objectContaining({ role: 'Admin', name: 'Süper yönetici yazdı' })]);
    for (const uid of ['yaz-mudur', 'yaz-satis-1', 'yaz-yonetici-1', 'yaz-yonetici-2', 'yaz-super-mudur']) await belgeSil('users', uid);
  });

  it('kendi belgesi istisnası (oturum açılışı senkronu): sunucunun bildiği rol belgedekinden geride kalsa da kişi KENDİ belgesine yazar', async () => {
    // Rol önbelleği (60 sn) belge sunucu dışından değişince düşmez: hesap Müdür olarak tanınmışken belgesi `Admin`e çevrilir.
    // Kural «ÖNCEKİ rol Admin ise» der; istisna olmasa kişi kendi giriş senkronunda 403 alırdı. Başkasının belgesine istisna YOK.
    // Okuma olay yaymaz: rol önbelleğe Müdür olarak girer; belge sonra doğrudan değişir (sunucu yazımı önbelleği düşürürdü).
    const b = await kullanici('yaz-terfi', { role: 'Manager', companyId: KIRACI, name: 'Terfi Eden' });
    await kullanici('yaz-terfi-hedef', { role: 'Admin', companyId: KIRACI, name: 'Hedef' });
    expect((await istek('GET', '/api/db/users/yaz-terfi', b)).s).toBe(200);
    await belgeKoy('users', 'yaz-terfi', { ...(await belgeOku('users', 'yaz-terfi')), role: 'Admin' });
    // Hâlâ Müdür tanınan hesap başka bir Yönetici belgesine yazamaz (ret olay yaymaz, önbellek durur)…
    expect((await istek('PATCH', '/api/db/users/yaz-terfi-hedef', b, { name: 'x' })).j.code).toBe('YONETICI_GEREKLI');
    expect(await belgeOku('users', 'yaz-terfi-hedef')).toMatchObject({ name: 'Hedef' });
    // …ama KENDİ belgesine (önceki rolü artık `Admin`) yazar.
    const r = await istek('PATCH', '/api/db/users/yaz-terfi', b, { lastLogin: 'ikinci', device: 'sınama' });
    expect(r.s).toBe(200);
    expect(await belgeOku('users', 'yaz-terfi')).toMatchObject({ role: 'Admin', lastLogin: 'ikinci', device: 'sınama' });
    for (const uid of ['yaz-terfi', 'yaz-terfi-hedef']) await belgeSil('users', uid);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('D13 — en ağır uçların KENDİ kapısı: `requireStaff`, kimlik kapısından hemen sonra (tek boğaz sökülse de kapalı)', () => {
  const AGIR: ReadonlyArray<[string, string, string, unknown, number]> = [
    // yöntem, desen, somut yol, gövde, iç rolün bugünkü yanıtı (yayin-11'de aynı düzenekle ölçüldü — kimlikYuzeyi.zincir.test.ts)
    ['GET', '/api/inventory/son-alis-tedarikci', '/api/inventory/son-alis-tedarikci?stokKod=DYO-001', undefined, 200],
    ['POST', '/api/inventory/auto-reorder', '/api/inventory/auto-reorder', {}, 200],
    ['POST', '/api/sku-mapping/auto-match', '/api/sku-mapping/auto-match', {}, 200],
    ['POST', '/api/upload/tahsilat', '/api/upload/tahsilat', {}, 400],
    ['POST', '/api/ai/generate', '/api/ai/generate', { prompt: 'merhaba' }, 503],
    ['POST', '/api/ai/chat', '/api/ai/chat', { message: 'merhaba' }, 503],
    ['POST', '/api/ai/demand-forecast', '/api/ai/demand-forecast', {}, 503],
    ['POST', '/api/ai/satis-ajani', '/api/ai/satis-ajani', {}, 400],
    ['POST', '/api/ai/satinalma-ajani', '/api/ai/satinalma-ajani', {}, 503],
  ];

  it('dokuz ucun zincirinde `requireStaff`, `requireAuth`\'un HEMEN ardında; hepsi AYNI işlev', () => {
    const kapilar = new Set<Katman['handle']>();
    for (const [yontem, desen] of AGIR) {
      const u = uc(yontem, desen);
      const i = u.adlar.indexOf('requireAuth');
      expect(i, `${yontem} ${desen}: ${u.adlar.join(' → ')}`).toBeGreaterThan(-1);
      expect(u.adlar[i + 1], `${yontem} ${desen}: ${u.adlar.join(' → ')}`).toBe('requireStaff');
      kapilar.add(u.katmanlar[i + 1].handle);
    }
    expect(kapilar.size).toBe(1);
  });

  it('yapay zekâ modülünün HER ucu rol kapılı: zincirde `requireStaff` ya da `requireAdmin` var (yeni uç kapısız doğarsa kırılır)', () => {
    const yz = rotaDokumu().filter(u => u.desen.startsWith('/api/ai/'));
    expect(yz.map(u => `${u.yontem} ${u.desen}`).sort()).toEqual([
      'GET /api/ai/status', 'POST /api/ai/chat', 'POST /api/ai/demand-forecast', 'POST /api/ai/generate',
      'POST /api/ai/satinalma-ajani', 'POST /api/ai/satis-ajani', 'POST /api/ai/test',
    ]);
    const kapisiz = yz.filter(u => !u.adlar.includes('requireStaff') && !u.adlar.includes('requireAdmin')).map(u => `${u.yontem} ${u.desen}: ${u.adlar.join(' → ')}`);
    expect(kapisiz).toEqual([]);
  });

  it('kapının KENDİSİ (boğaz yokmuş gibi — kimlik kapısından sonraki katman doğrudan koşturulur): rolsüz / geçersiz rol / dış rol → 403, işleyiciye geçilmez', async () => {
    await kullanici('d13-rolsuz', { name: 'Yabancı' });
    await kullanici('d13-cop', { role: 1 });
    await kullanici('d13-bayi', { role: 'Dealer', companyId: KIRACI });
    await kullanici('d13-b2b', { role: 'B2B', companyId: KIRACI });
    for (const [yontem, desen] of AGIR) {
      const u = uc(yontem, desen);
      const kapi = u.katmanlar[u.adlar.indexOf('requireAuth') + 1];
      for (const uid of ['d13-rolsuz', 'd13-cop', 'd13-bayi', 'd13-b2b', 'd13-belgesiz']) {
        const r = await katmanKostur(kapi, { uid, method: yontem, originalUrl: desen, path: desen });
        expect([desen, uid, r.ileri, r.durum, r.govde]).toEqual([desen, uid, 0, 403, { error: 'Bu işlem için personel yetkisi gerekir.' }]);
      }
      // Aynı katman iç rolü geçirir (kapı «herkese kapalı» değil).
      const icRol = await katmanKostur(kapi, { uid: icUid('Sales'), method: yontem, originalUrl: desen, path: desen });
      expect([desen, icRol.ileri, icRol.durum]).toEqual([desen, 1, 0]);
    }
    for (const id of ['d13-rolsuz', 'd13-cop', 'd13-bayi', 'd13-b2b']) await belgeSil('users', id);
  });

  it('HER iç rol: dokuz uçta bugünkü yanıt (iç roller arası daraltma YOK); süper yönetici (rolsüz) kapıdan geçer', async () => {
    const fark: string[] = [];
    for (const rol of STAFF_ROLES) for (const [yontem, , yol, govde, beklenen] of AGIR) {
      const r = await istek(yontem, yol, ic(rol), govde);
      if (r.s !== beklenen) fark.push(`${rol} ${yontem} ${yol} → ${r.s} (beklenen ${beklenen}) ${r.metin.slice(0, 120)}`);
    }
    expect(fark, fark.join('\n')).toEqual([]);
    expect(STAFF_ROLES).toHaveLength(10);
    // Süper yöneticinin kiracısı boştur (kullanıcı belgesi yok) — yanıtı iç rolünkiyle aynı olmak zorunda değil; ölçülen: kapı reddetmiyor.
    for (const [yontem, , yol, govde] of AGIR) {
      const r = await istek(yontem, yol, SUPER, govde);
      expect([401, 403], `süper yönetici ${yontem} ${yol} → ${r.s}`).not.toContain(r.s);
    }
    // İç rol veriyi gerçekten alıyor (kapı yanıtı daraltmadı).
    const t = await istek('GET', '/api/inventory/son-alis-tedarikci?stokKod=DYO-001', ic('Logistics'));
    expect((t.j.tedarikci as { unvan?: string } | null)?.unvan).toBe('GİZLİ TEDARİKÇİ A.Ş.');
  }, 180_000);

  it('gerçek HTTP: rolsüz hesap ve dış rol dokuz uçta 403; veri yazılmaz, diske dosya düşmez, tedarikçi adı dönmez', async () => {
    const yazilanOnce = await say("SELECT count(*)::int AS n FROM docs WHERE coll IN ('purchaseOrders', 'skuMappings')");
    const disariOnce = disari.length;
    for (const [uid, veri] of [['d13-http-rolsuz', { name: 'Yabancı' }], ['d13-http-bayi', { role: 'Dealer', companyId: KIRACI }], ['d13-http-b2b', { role: 'B2B', companyId: KIRACI }]] as const) {
      const b = await kullanici(uid, veri);
      for (const [yontem, , yol, govde] of AGIR) {
        const r = await istek(yontem, yol, b, govde);
        expect([uid, yol, r.s]).toEqual([uid, yol, 403]);
        expect(r.metin).not.toContain('GİZLİ TEDARİKÇİ');
      }
      await belgeSil('users', uid);
    }
    expect(await say("SELECT count(*)::int AS n FROM docs WHERE coll IN ('purchaseOrders', 'skuMappings')")).toBe(yazilanOnce);
    expect(disari.slice(disariOnce).filter(u => !/tcmb\.gov\.tr|exchangerate-api\.com/.test(u))).toEqual([]);
    const dosyalar = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? dosyalar(path.join(d, e.name)) : [e.name]));
    expect(dosyalar(yuklemeDizini)).toEqual([]);
  });
});
