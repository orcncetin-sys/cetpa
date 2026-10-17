// @vitest-environment node
/**
 * mikroCariArama.zincir.test.ts — salt okuyan Mikro cari arama ucu `POST /api/mikro/cari/ara` (şartname
 * `.wf/SARTNAME-mikro-cari-arama.md`, A1: C1–C6, § 7 H1 / H5 / H6 / H7 / H12), GERÇEK `server.ts` + GERÇEK express zinciriyle.
 *
 * NEDEN GERÇEK ZİNCİR: ucun asıl riski kapının, gövde ayrıştırıcının ve hız sınırlayıcının ZİNCİRDEKİ yeridir (rota
 * `express.json`'dan önce kaydedilirse her POST kırılır; kapı yanlış halkadaysa Lojistik geçer). Rota satırının metni ayrıca
 * `routes/mikroRoutes.rolKapisi.test.ts`'te kilitli; burada DAVRANIŞ ölçülür. Düzenek `kucukKapanislar.zincir.test.ts` ile aynı.
 *
 * H1 ÖN ÖLÇÜMÜ (§ 7, CRM kutusunun ön şartı) dosyanın başındadır: Satış rolünün `leads` okuması sunucuda `assignedTo` ile
 * süzülmüyor mu — süzülseydi CRM «Bağla» denetiminin hedefli sorgusu başka satışçıya bağlı kaydı göremez, kutu yazılmazdı.
 *
 * SAHTE OLANLAR (yalnız süreç dışına çıkan her şey): Firebase belirteç doğrulayıcısı (belirteç = "<uid>|<e-posta>|<1|0>"),
 * `pg` havuzu (süreç içi PGlite), pg-boss, node-cron, vite, `dotenv` (hiçbir ortam dosyası YÜKLENMEZ) ve dışarı giden `fetch`
 * (Mikro kimlik sunucusu ile Jump API'si burada yanıtlanır; hiçbir istek ağa çıkmaz). Canlıya, Firebase'e, Mikro'ya istek YOK.
 * Mikro BULUT kipinde kurulur (`MIKRO_LOCAL=0`): yalnız bu kipte «yapılandırılmamış» (503) durumu ortamdan üretilebilir.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { STAFF_ROLES, type AppRole } from '../lib/rbac';

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
    createUser: async () => ({ uid: 'acilan' }),
    deleteUser: async () => undefined,
    generatePasswordResetLink: async (email: string) => `https://example.test/parola?kime=${encodeURIComponent(email)}`,
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
  const gunluk: string[] = [];
  (globalThis as Record<string, unknown>).__cariAramaPg = db;
  (globalThis as Record<string, unknown>).__cariAramaSql = gunluk;   // sunucunun koşturduğu HER SQL (C5: yazım sayacı)
  const q = async (text: unknown, params?: unknown[]) => {
    let sql = String(text); let p = params;
    if (text && typeof text === 'object') { const o = text as { text: string; values?: unknown[] }; sql = o.text; p = o.values; }
    gunluk.push(sql);
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
const pg = (): Pg => (globalThis as Record<string, unknown>).__cariAramaPg as Pg;
/** Sunucunun (ve sınamanın) havuzdan koşturduğu SQL metinleri, sırasıyla. */
const sqlGunlugu = (): string[] => (globalThis as Record<string, unknown>).__cariAramaSql as string[];
const YAZAN_SQL = /^\s*(INSERT|UPDATE|DELETE|UPSERT|MERGE|TRUNCATE|CREATE|ALTER|DROP)\b/i;

let sunucu: http.Server | undefined;
let kapiNo = 0;
let yuklemeDizini = '';
const gercekFetch = globalThis.fetch;

const KIRACI = 'CETPA';
const SUPER_EPOSTA = 'sahip@example.test';
const UC = '/api/mikro/cari/ara';
const MIKRO_KIMLIK_URL = 'https://onlinekullanici.mikro.com.tr/auth/realms/Mikro/protocol/openid-connect/token';
/** Mikro'nun «yapılandırılmış» sayılması için bulut kipinde gereken DÖRT ortam değeri (mikroClient.getMikroCreds). */
const MIKRO_ORTAMI: Record<string, string> = {
  MIKRO_IDM_EMAIL: 'sinama@example.test', MIKRO_IDM_PASSWORD: 'sinama-parolasi', MIKRO_API_KEY: 'sinama-anahtari', MIKRO_ALIAS: 'sinama',
};
const eposta = (uid: string): string => `${uid.toLowerCase()}@example.test`;
const belirtec = (uid: string, ep = eposta(uid)): Record<string, string> => ({ Authorization: `Bearer ${uid}|${ep}|1` });

// ── Mikro'nun yerine geçen yanıtlayıcı ─────────────────────────────────────────────────────────────────────────────────────
interface MikroCagrisi { govde: Record<string, unknown> }
/** CariListesiV2'ye giden her istek (gövdesiyle). */
const mikroCagrilari: MikroCagrisi[] = [];
/** Sunucunun Mikro DIŞINDA dışarı yapmaya çalıştığı istekler (hiçbiri gitmez). */
const disari: string[] = [];
const jsonYanit = (govde: unknown, kod = 200): Response => new Response(JSON.stringify(govde), { status: kod, headers: { 'content-type': 'application/json' } });
const zarf = (satirlar: unknown[]): unknown => ({ result: [{ StatusCode: 200, IsError: false, ErrorMessage: '', Data: { CariListesi: satirlar } }] });
type MikroYanitlayici = (govde: Record<string, unknown>) => Response | Promise<Response>;
const VARSAYILAN_YANIT: MikroYanitlayici = () => jsonYanit(zarf([]));
let mikroYaniti: MikroYanitlayici = VARSAYILAN_YANIT;
/** Bir sınamanın Mikro yanıtını kurar; `finally`'de varsayılana döner. */
async function mikroIle<T>(y: MikroYanitlayici, is: () => Promise<T>): Promise<T> {
  mikroYaniti = y;
  try { return await is(); } finally { mikroYaniti = VARSAYILAN_YANIT; }
}

interface Yanit { s: number; j: Record<string, unknown>; metin: string }
let ipSayaci = 0;
const sonrakiIp = (): string => { ipSayaci++; return `10.${(ipSayaci >> 16) & 255}.${(ipSayaci >> 8) & 255}.${ipSayaci & 255}`; };

function istek(yontem: string, yol: string, basliklar: Record<string, string> = {}, govde?: unknown, hamGovde?: string): Promise<Yanit> {
  return new Promise((coz, reddet) => {
    const veri = hamGovde ?? (govde === undefined ? undefined : JSON.stringify(govde));
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

let kullaniciSayaci = 0;
/** YENİ bir kullanıcı (sunucu önbelleğine girmeden önce `users` belgesiyle) — Mikro sınırlayıcısı kullanıcı başına 60 istek /
 *  5 dk saydığı için her sınama grubu kendi hesabıyla gelir. `rol` yoksa belge rolsüzdür. */
async function yeniKullanici(rol: AppRole | null, ek: Record<string, unknown> = {}): Promise<Record<string, string>> {
  kullaniciSayaci++;
  const uid = `ara-${rol ?? 'rolsuz'}-${kullaniciSayaci}`;
  await belgeKoy('users', uid, { email: eposta(uid), ...(rol ? { role: rol, companyId: KIRACI } : {}), ...ek });
  return belirtec(uid);
}
const ara = (b: Record<string, string>, govde: unknown): Promise<Yanit> => istek('POST', UC, b, govde);

/** Docs tablosunun ve Mikro cari aynasının TAM dökümü (yazım olmadığının kanıtı). */
const veriDokumu = async (): Promise<string> => {
  const docs = await pg().query('SELECT coll, id, data::text AS d FROM docs ORDER BY coll, id');
  const ayna = await pg().query('SELECT * FROM mikro_cari_hesaplar ORDER BY cari_kod');
  return JSON.stringify([docs.rows, ayna.rows]);
};

beforeAll(async () => {
  yuklemeDizini = fs.mkdtempSync(path.join(os.tmpdir(), 'cari-arama-'));
  process.env.PORT = '0';
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgres://sinama/yok';      // yalnız «PG var» dalını açar; havuz PGlite
  process.env.SESSION_TOKEN_SECRET = 'sinama-sirri';
  process.env.UPLOAD_DIR = yuklemeDizini;
  process.env.SUPER_ADMIN_EMAILS = SUPER_EPOSTA;
  for (const ad of Object.keys(process.env)) {
    if (/^(STRIPE|RESEND|LUCA|SHOPIFY|SMTP|GEMINI|ANTHROPIC|MIKRO|IYZICO|TRENDYOL|HEPSIBURADA|DHL|UPS|FEDEX|YURTICI|MNG|ARAS|WHATSAPP|FIREBASE|GOOGLE_APPLICATION|OPS_|SERVER_TENANT_)/.test(ad)) delete process.env[ad];
  }
  // Bulut kipi (modül yüklenirken okunur): kimlik bilgisi ortamdan gelir, yoksa uç 503 döner. Adres portlu (uyarı yok).
  process.env.MIKRO_LOCAL = '0';
  process.env.MIKRO_API_URL = 'https://mikro.example.test:8094/Api/APIMethods';
  Object.assign(process.env, MIKRO_ORTAMI);
  globalThis.fetch = (async (girdi: unknown, init?: RequestInit) => {
    const url = String(typeof girdi === 'string' ? girdi : (girdi as { url?: string }).url ?? girdi);
    if (url === MIKRO_KIMLIK_URL) return jsonYanit({ access_token: 'sinama-jetonu', expires_in: 3600 });
    if (url === 'https://mikro.example.test:8094/Api/APIMethods/CariListesiV2') {
      const govde = JSON.parse(String(init?.body)) as Record<string, unknown>;
      mikroCagrilari.push({ govde });
      return mikroYaniti(govde);
    }
    disari.push(`${init?.method ?? 'GET'} ${url.replace(/\?.*$/, '')}`);
    return jsonYanit({});
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
    const r = await pg().query("SELECT to_regclass('docs') AS d, to_regclass('mfa_secrets') AS m, to_regclass('mikro_cari_hesaplar') AS c");
    const t = r.rows[0]; return !!(t.d && t.m && t.c);
  }, 60_000, 'tablolar hazır');
  await pg().query("INSERT INTO mikro_cari_hesaplar (cari_kod, cari_unvan1) VALUES ('120.01.001', 'AYNADAKİ CARİ A.Ş.')");
}, 240_000);

afterAll(async () => {
  globalThis.fetch = gercekFetch;
  const s = sunucu;
  if (s) { s.closeAllConnections(); await new Promise<void>(r => s.close(() => r())); }
  if (yuklemeDizini) fs.rmSync(yuklemeDizini, { recursive: true, force: true });
}, 30_000);

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('H1 ön ölçümü — Satış rolünün `leads` okuması sunucuda `assignedTo` ile SÜZÜLMEZ (CRM «Bağla» denetiminin ön şartı)', () => {
  it('Satış: başka satışçıya atanmış aday ve müşteri kaydı `GET /api/db/leads` yanıtında; istemcinin hedefli sorgusu (companyId + mikroCariKod) onları bulur', async () => {
    const satis = await yeniKullanici('Sales');
    const satisUid = satis.Authorization.split(' ')[1].split('|')[0];
    await belgeKoy('leads', 'h1-kendi', { name: 'Kendi Adayı', companyId: KIRACI, assignedTo: satisUid });
    await belgeKoy('leads', 'h1-baskasinin', { name: 'Başka Satışçının Adayı', companyId: KIRACI, assignedTo: 'baska-satisci', mikroCariKod: '120.09.001' });
    await belgeKoy('leads', 'h1-musteri', { name: 'Müşteri Kaydı', companyId: KIRACI, assignedTo: 'baska-satisci', mikroCariKod: '120.09.002', isMusteri: true });
    await belgeKoy('leads', 'h1-yabanci', { name: 'Yabancı Kiracı', companyId: 'BASKA-FIRMA', assignedTo: 'baska-satisci', mikroCariKod: '120.09.001' });
    const r = await istek('GET', '/api/db/leads', satis);
    expect(r.s, r.metin).toBe(200);
    const docs = (r.j.docs as Array<{ id: string; data: Record<string, unknown> }>);
    const kimlikler = docs.map(d => d.id);
    expect(kimlikler).toEqual(expect.arrayContaining(['h1-kendi', 'h1-baskasinin', 'h1-musteri']));
    expect(kimlikler).not.toContain('h1-yabanci');                       // kiracı süzgeci duruyor
    // İstemci (`dbClient.getDocs` → `applyConstraints`) aynı listeyi eşitlik koşullarıyla süzer; burada aynı süzgeç elle.
    const hedefli = (kod: string) => docs.filter(d => d.data.companyId === KIRACI && d.data.mikroCariKod === kod).map(d => d.id);
    expect(hedefli('120.09.001')).toEqual(['h1-baskasinin']);
    expect(hedefli('120.09.002')).toEqual(['h1-musteri']);
    // Tek belge okuması da açık (Satış başkasının adayını okuyabiliyor — süzgeç yalnız İSTEMCİNİN bellek listesinde).
    expect((await istek('GET', '/api/db/leads/h1-baskasinin', satis)).s).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('C2 — kapı: `leads` okuma (Yönetici, Müdür, Satış, Muhasebe, Satın Alma); kilitli roller Mikro\'ya hiç gitmez', () => {
  const GECEN: AppRole[] = ['Admin', 'Manager', 'Sales', 'Accounting', 'Purchasing'];

  it('12 rol + rolsüz + kimliksiz + süper yönetici: geçen 200, kilitli 403 (Mikro çağrısı yok)', async () => {
    const sonuc: Record<string, number> = {};
    for (const rol of [...STAFF_ROLES, 'B2B' as AppRole, 'Dealer' as AppRole]) {
      const once = mikroCagrilari.length;
      const r = await ara(await yeniKullanici(rol), { metin: 'yapı' });
      sonuc[rol] = r.s;
      expect(mikroCagrilari.length - once, `${rol}: Mikro çağrısı`).toBe(r.s === 200 ? 1 : 0);
      if (r.s === 200) expect(r.j, rol).toEqual({ success: true, data: [], sinirli: false });
      else if (STAFF_ROLES.includes(rol)) expect(r.j, rol).toEqual({ error: 'Bu veri için yetkiniz yok.' });
      else expect(r.j.code, rol).toBe('DIS_ROL');
    }
    expect(sonuc).toEqual({
      Admin: 200, Manager: 200, Sales: 200, Accounting: 200, Purchasing: 200,
      Logistics: 403, HR: 403, Legal: 403, Corporate: 403, Quality: 403, B2B: 403, Dealer: 403,
    });
    expect(Object.keys(sonuc).filter(k => sonuc[k] === 200).sort()).toEqual([...GECEN].sort());
    const once = mikroCagrilari.length;
    const rolsuz = await ara(await yeniKullanici(null), { metin: 'yapı' });
    expect([rolsuz.s, rolsuz.j.code]).toEqual([403, 'ROL_YOK']);
    expect((await ara({}, { metin: 'yapı' })).s).toBe(401);
    expect(mikroCagrilari.length).toBe(once);
    // Sahip hesabı (rolü olmayan belge, doğrulanmış süper yönetici e-postası) rolünden bağımsız geçer.
    expect((await ara(belirtec('sahip-1', SUPER_EPOSTA), { metin: 'yapı' })).s).toBe(200);
  });

  it('iki adımlı doğrulaması AÇIK, oturumu doğrulanmamış Satış → mevcut MFA yanıtı (403 `mfaRequired`), Mikro\'ya gidilmez', async () => {
    const uid = 'ara-mfa-1';
    await pg().query("INSERT INTO mfa_secrets (uid, secret, enabled) VALUES ($1, 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP', true)", [uid]);
    await belgeKoy('users', uid, { email: eposta(uid), role: 'Sales', companyId: KIRACI });
    const once = mikroCagrilari.length;
    const r = await ara(belirtec(uid), { metin: 'yapı' });
    expect([r.s, r.j]).toEqual([403, { error: 'İki faktörlü doğrulama gerekli.', mfaRequired: true }]);
    expect(mikroCagrilari.length).toBe(once);
  });

  it('GET ile kayıtlı değil (arama metni sorgu dizesine düşmesin — C1)', async () => {
    const r = await istek('GET', `${UC}?metin=yapi`, await yeniKullanici('Admin'));
    expect(r.s).not.toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('C1 — gövde `{ metin }` (strict): kısa / uzun / dize olmayan / tanınmayan alan 400, Mikro\'ya gidilmez', () => {
  it.each([
    ['tek karakter', { metin: 'a' }, 'En az iki karakter yazın.'],
    ['boşluklarla tek karakter (trim)', { metin: '   a   ' }, 'En az iki karakter yazın.'],
    ['yalnız boşluk', { metin: '     ' }, 'En az iki karakter yazın.'],
    ['101 karakter (kesilmez)', { metin: 'ş'.repeat(101) }, 'Arama metni en çok 100 karakter olabilir.'],
    ['dize olmayan', { metin: 5 }, 'Arama metni yazı olmalı.'],
    ['dizi', { metin: ['yapı'] }, 'Arama metni yazı olmalı.'],
    ['metin yok', {}, 'Arama metni yazı olmalı.'],
    ['tanınmayan alan', { metin: 'yapı', nameSearch: 'yapı' }, 'Geçersiz istek gövdesi.'],
    ['eski `whereStr` alanı', { metin: 'yapı', whereStr: "cari_kod LIKE '%'" }, 'Geçersiz istek gövdesi.'],
  ])('%s → 400', async (_ad, govde, ileti) => {
    const once = mikroCagrilari.length;
    const r = await ara(await yeniKullanici('Admin'), govde);
    expect([r.s, r.j]).toEqual([400, { success: false, error: ileti }]);
    expect(mikroCagrilari.length).toBe(once);
  });

  it('KİMLİKSİZ bozuk JSON gövde ayrıştırıcıda düşer (zincir sağlam: 400 / 500; rota `express.json`\'dan ÖNCE kayıtlı olsaydı kimlik kapısı 401 derdi); Mikro\'ya gidilmez', async () => {
    const once = mikroCagrilari.length;
    const r = await istek('POST', UC, {}, undefined, '{bozuk');
    expect([400, 500], r.metin).toContain(r.s);
    expect(mikroCagrilari.length).toBe(once);
  });

  it('kenarlardaki boşluk sayılmaz: 100 karakter + boşluklar geçer ve Mikro\'ya kırpılmış gider', async () => {
    const metin = 'y'.repeat(100);
    const r = await ara(await yeniKullanici('Admin'), { metin: `  ${metin}  ` });
    expect(r.s, r.metin).toBe(200);
    expect(String(mikroCagrilari[mikroCagrilari.length - 1].govde.WhereStr)).toBe(`(cari_unvan1 LIKE '%${metin}%' OR cari_unvan2 LIKE '%${metin}%' OR cari_kod LIKE '%${metin}%')`);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('C3 / H5 / H12 — Mikro sorgusu: CariListesiV2 tek sayfa; WhereStr yalnız şartnamenin saydığı kolonlarla', () => {
  const sonGovde = (): Record<string, unknown> => mikroCagrilari[mikroCagrilari.length - 1].govde;
  let b: Record<string, string>;
  beforeAll(async () => { b = await yeniKullanici('Purchasing'); });

  it('gövde birebir: FieldName (altı kolon), Sort, Size \'21\', Index 0; bağlam `Mikro` nesnesinde (evrak kalıbı değil)', async () => {
    const zamanAsimi = vi.spyOn(AbortSignal, 'timeout');
    try {
      expect((await ara(b, { metin: '  Şirin Yapı ' })).s).toBe(200);
      expect(zamanAsimi).toHaveBeenCalledWith(20000);                                   // § 7: çağrıya özel 20 sn
    } finally { zamanAsimi.mockRestore(); }
    const g = sonGovde();
    expect(Object.keys(g).sort()).toEqual(['FieldName', 'Index', 'Mikro', 'Size', 'Sort', 'WhereStr']);
    expect(g.FieldName).toBe('cari_kod,cari_unvan1,cari_unvan2,cari_vdaire_no,cari_EMail,cari_CepTel');
    expect(g.Sort).toBe('cari_unvan1');
    expect(g.Size).toBe('21');
    expect(g.Index).toBe(0);
    expect(g.WhereStr).toBe("(cari_unvan1 LIKE '%Şirin Yapı%' OR cari_unvan2 LIKE '%Şirin Yapı%' OR cari_kod LIKE '%Şirin Yapı%')");
    expect(g.Mikro).toMatchObject({ Alias: 'sinama', ApiKey: 'sinama-anahtari' });
  });

  it('kaçış: `%`, `_`, `[` ve `\'` WhereStr\'de DÜZ karakter (üç LIKE\'ta da)', async () => {
    expect((await ara(b, { metin: "a%b_c[d'e" })).s).toBe(200);
    const x = "a[%]b[_]c[[]d''e";
    expect(sonGovde().WhereStr).toBe(`(cari_unvan1 LIKE '%${x}%' OR cari_unvan2 LIKE '%${x}%' OR cari_kod LIKE '%${x}%')`);
  });

  it('H12: tırnak benzerleri (U+2018, U+2019, U+02BC, U+02B9, U+02C8 ˈ, U+2032 ′, U+FF07) LIKE tek karakter jokeri `_` olur; kapanmamış tırnak üretmez', async () => {
    expect((await ara(b, { metin: 'xʼy' })).s).toBe(200);
    expect(sonGovde().WhereStr).toBe("(cari_unvan1 LIKE '%x_y%' OR cari_unvan2 LIKE '%x_y%' OR cari_kod LIKE '%x_y%')");
    // İnceleme 1: U+02C8 (ˈ, vurgu işareti) ve U+2032 (′, dakika / üs işareti) da listede.
    expect((await ara(b, { metin: 'a\u2018b\u2019c\u02BCd\u02B9e\uFF07fˈg′h' })).s).toBe(200);
    expect(String(sonGovde().WhereStr)).toBe("(cari_unvan1 LIKE '%a_b_c_d_e_f_g_h%' OR cari_unvan2 LIKE '%a_b_c_d_e_f_g_h%' OR cari_kod LIKE '%a_b_c_d_e_f_g_h%')");
    // Düz `_` hâlâ kaçışlı; benzerinin ürettiği `_` kaçışsız joker (sıra: önce kaçış, sonra benzer).
    expect((await ara(b, { metin: '_ʼ' })).s).toBe(200);
    expect(String(sonGovde().WhereStr)).toContain("LIKE '%[_]_%'");
  });

  it('H5 VKN / TCKN dalı: boşluk, tire, nokta atılınca 10 ya da 11 rakam → `(cari_vdaire_no = … OR cari_kod = …)`', async () => {
    const vkn = async (metin: string): Promise<unknown> => { expect((await ara(b, { metin })).s).toBe(200); return sonGovde().WhereStr; };
    expect(await vkn('123 456 78-90')).toBe("(cari_vdaire_no = '1234567890' OR cari_kod = '1234567890')");
    expect(await vkn('1234567890')).toBe("(cari_vdaire_no = '1234567890' OR cari_kod = '1234567890')");
    expect(await vkn('167.813.759-30')).toBe("(cari_vdaire_no = '16781375930' OR cari_kod = '16781375930')");
    // 9 ya da 12 rakam, rakam + harf, rakamlı kod → ad dalı (LIKE; boşluk / tire korunur).
    expect(await vkn('123456789')).toBe("(cari_unvan1 LIKE '%123456789%' OR cari_unvan2 LIKE '%123456789%' OR cari_kod LIKE '%123456789%')");
    expect(await vkn('123456789012')).toBe("(cari_unvan1 LIKE '%123456789012%' OR cari_unvan2 LIKE '%123456789012%' OR cari_kod LIKE '%123456789012%')");
    expect(await vkn('12345 abc 90')).toBe("(cari_unvan1 LIKE '%12345 abc 90%' OR cari_unvan2 LIKE '%12345 abc 90%' OR cari_kod LIKE '%12345 abc 90%')");
    expect(await vkn('120.01-001')).toBe("(cari_unvan1 LIKE '%120.01-001%' OR cari_unvan2 LIKE '%120.01-001%' OR cari_kod LIKE '%120.01-001%')");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('C4 / H7 — yanıt: yalnız altı alan, gelmeyen alan YOK; `sinirli` = Mikro 21. satırı döndürdü', () => {
  let b: Record<string, string>;
  beforeAll(async () => { b = await yeniKullanici('Sales'); });
  const satir = (i: number): Record<string, unknown> => ({ cari_kod: `120.01.${String(i).padStart(3, '0')}`, cari_unvan1: `CARİ ${i} A.Ş.` });

  it('altı alan aynen; fazlası atılır; boş / dize olmayan alan yanıta GİRMEZ (boş dize uydurulmaz); kodsuz ya da unvansız satır atlanır', async () => {
    const r = await mikroIle(() => jsonYanit(zarf([
      { cari_kod: ' 120.01.007 ', cari_unvan1: 'İSTANBUL YAPI MALZEMELERİ A.Ş.', cari_unvan2: 'Şube', cari_vdaire_no: '1234567890', cari_EMail: 'satis@istanbulyapi.example', cari_CepTel: '05320000000', cari_efatura_fl: 1, cari_baglanti_tipi: 0 },
      { cari_kod: '320.01.002', cari_unvan1: 'ÖZKAN HIRDAVAT', cari_unvan2: '', cari_vdaire_no: null, cari_EMail: '   ', cari_CepTel: 5320000000 },
      { cari_kod: '', cari_unvan1: 'KODSUZ KART' },
      { cari_unvan1: 'KODU OLMAYAN' },
      { cari_kod: '320.01.009' },
      'tanınmayan satır',
    ])), () => ara(b, { metin: 'yapı' }));
    expect(r.s, r.metin).toBe(200);
    expect(r.j).toEqual({
      success: true, sinirli: false,
      data: [
        { cari_kod: '120.01.007', cari_unvan1: 'İSTANBUL YAPI MALZEMELERİ A.Ş.', cari_unvan2: 'Şube', cari_vdaire_no: '1234567890', cari_EMail: 'satis@istanbulyapi.example', cari_CepTel: '05320000000' },
        { cari_kod: '320.01.002', cari_unvan1: 'ÖZKAN HIRDAVAT' },
      ],
    });
  });

  it('Mikro 20 satır döndürürse `sinirli: false`, `data` 20', async () => {
    const r = await mikroIle(() => jsonYanit(zarf(Array.from({ length: 20 }, (_, i) => satir(i)))), () => ara(b, { metin: 'cari' }));
    expect([r.s, r.j.sinirli, (r.j.data as unknown[]).length]).toEqual([200, false, 20]);
  });

  it('Mikro 21 satır döndürürse `sinirli: true`, `data` sıralı İLK 20 (21. satır yanıta girmez)', async () => {
    const r = await mikroIle(() => jsonYanit(zarf(Array.from({ length: 21 }, (_, i) => satir(i)))), () => ara(b, { metin: 'cari' }));
    expect([r.s, r.j.sinirli]).toEqual([200, true]);
    const data = r.j.data as Array<{ cari_kod: string }>;
    expect(data.map(d => d.cari_kod)).toEqual(Array.from({ length: 20 }, (_, i) => satir(i).cari_kod));
  });

  it('liste alanı YOKSA boş sonuç (tam import kalıbı); liste alanı dizi değilse hata (502)', async () => {
    const yok = await mikroIle(() => jsonYanit({ result: [{ IsError: false, Data: {} }] }), () => ara(b, { metin: 'cari' }));
    expect([yok.s, yok.j]).toEqual([200, { success: true, data: [], sinirli: false }]);
    const bozuk = await mikroIle(() => jsonYanit({ result: [{ IsError: false, Data: { CariListesi: { a: 1 } } }] }), () => ara(b, { metin: 'cari' }));
    expect([bozuk.s, bozuk.j]).toEqual([502, { success: false, error: 'Mikro yanıtında cari listesi tanınmadı.' }]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('H6 — Mikro hata zarfı: HTTP 200 + `IsError` ya da zarfsız yanıt «sonuç yok» SAYILMAZ; yapılandırılmamış 503', () => {
  let b: Record<string, string>;
  beforeAll(async () => { b = await yeniKullanici('Admin'); });

  it('HTTP 200 + `IsError: true` → 502, Mikro iletisiyle', async () => {
    const r = await mikroIle(() => jsonYanit({ result: [{ StatusCode: 500, IsError: true, ErrorMessage: "Invalid column name 'cari_unvan2'." }] }), () => ara(b, { metin: 'yapı' }));
    expect([r.s, r.j]).toEqual([502, { success: false, error: "Invalid column name 'cari_unvan2'." }]);
  });

  it('zarfsız (stub: `result` yok) yanıt → 502 (token bir kez tazelenip yeniden denenir)', async () => {
    const once = mikroCagrilari.length;
    const r = await mikroIle(() => jsonYanit({ Method: 'CariListesiV2' }), () => ara(b, { metin: 'yapı' }));
    expect([r.s, r.j]).toEqual([502, { success: false, error: 'Mikro API yanıt vermedi.' }]);
    expect(mikroCagrilari.length - once).toBeGreaterThanOrEqual(1);
  });

  it('`result` dizisi boş → 502; HTTP 500 düz metin → 502, metinle', async () => {
    const bos = await mikroIle(() => jsonYanit({ result: [] }), () => ara(b, { metin: 'yapı' }));
    expect([bos.s, bos.j]).toEqual([502, { success: false, error: 'Mikro API yanıt vermedi.' }]);
    const duz = await mikroIle(() => new Response('Api Server Error', { status: 500 }), () => ara(b, { metin: 'yapı' }));
    expect([duz.s, duz.j]).toEqual([502, { success: false, error: 'Api Server Error' }]);
  });

  it('istisna (bağlantı koptu) → 500, iletiyle', async () => {
    const r = await mikroIle(() => { throw new Error('Mikro bağlantısı reddedildi'); }, () => ara(b, { metin: 'yapı' }));
    expect([r.s, r.j]).toEqual([500, { success: false, error: 'Mikro bağlantısı reddedildi' }]);
  });

  it('20 sn süre kapısı dolarsa (DOMException `TimeoutError`) → 500, TÜRKÇE iletiyle; çalışma zamanının İngilizce iletisi ne yanıtta ne günlükte (inceleme 1)', async () => {
    const yazilan: string[] = [];
    const casuslar = (['log', 'info', 'warn', 'error', 'debug'] as const).map(ad =>
      vi.spyOn(console, ad).mockImplementation((...a: unknown[]) => { yazilan.push(a.map(x => (typeof x === 'string' ? x : JSON.stringify(x) ?? String(x))).join(' ')); }));
    let r: Yanit;
    try {
      r = await mikroIle(() => { throw new DOMException('The operation was aborted due to timeout', 'TimeoutError'); }, () => ara(b, { metin: 'yapı' }));
    } finally { for (const c of casuslar) c.mockRestore(); }
    expect([r.s, r.j]).toEqual([500, { success: false, error: 'Mikro 20 saniyede yanıt vermedi; aramayı daraltıp yeniden deneyin.' }]);
    expect(r.metin).not.toMatch(/aborted|timeout/i);
    const aramaGunlugu = yazilan.filter(s => s.includes('cari araması'));
    expect(aramaGunlugu).toEqual(['Mikro cari araması zaman aşımı (20 sn)']);
    expect(yazilan.filter(s => /aborted due to timeout/i.test(s))).toEqual([]);
  });

  it('Mikro yapılandırılmamış → 503 `{ success:false, notConfigured:true }` (gövde mevcut uçlarla aynı); Mikro\'ya gidilmez', async () => {
    const once = mikroCagrilari.length;
    for (const ad of Object.keys(MIKRO_ORTAMI)) delete process.env[ad];
    try {
      const r = await ara(b, { metin: 'yapı' });
      expect([r.s, r.j]).toEqual([503, { success: false, notConfigured: true }]);
      // Gövde doğrulaması yine önce: geçersiz gövde 503'e düşmez.
      expect((await ara(b, { metin: 'a' })).s).toBe(400);
    } finally { Object.assign(process.env, MIKRO_ORTAMI); }
    expect(mikroCagrilari.length).toBe(once);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('C5 — YAZMAZ: `leads`, `suppliers`, Mikro aynası, `syncLog`, denetim kaydı yok; günlüğe arama metni / sonuç düşmez', () => {
  it('sonuçlu arama, hatalı arama ve geçersiz gövde: veritabanı dökümü birebir aynı; konsolda arama metni ve unvan yok', async () => {
    const b = await yeniKullanici('Sales');
    const METIN = 'Gizlişahıs Yılmaz';
    const UNVAN = 'GİZLİŞAHIS YILMAZ İNŞAAT';
    const once = await veriDokumu();
    const disariOnce = disari.length;
    const sqlOnce = sqlGunlugu().length;
    const yazilan: string[] = [];
    const casuslar = (['log', 'info', 'warn', 'error', 'debug'] as const).map(ad =>
      vi.spyOn(console, ad).mockImplementation((...a: unknown[]) => { yazilan.push(a.map(x => (typeof x === 'string' ? x : JSON.stringify(x) ?? String(x))).join(' ')); }));
    try {
      const r = await mikroIle(() => jsonYanit(zarf([{ cari_kod: '120.05.001', cari_unvan1: UNVAN, cari_vdaire_no: '11111111111' }])), () => ara(b, { metin: METIN }));
      expect([r.s, (r.j.data as unknown[]).length]).toEqual([200, 1]);
      expect((await mikroIle(() => jsonYanit({ result: [{ IsError: true, ErrorMessage: 'ret' }] }), () => ara(b, { metin: METIN }))).s).toBe(502);
      expect((await ara(b, { metin: METIN, fazla: 1 })).s).toBe(400);
      expect((await ara(b, { metin: '11111111111' })).s).toBe(200);
    } finally { for (const c of casuslar) c.mockRestore(); }
    // Sunucunun arka plan yazımları (oturum damgası vb.) bitmeden ölçmeyelim: kısa bir bekleme.
    await new Promise(r => setTimeout(r, 300));
    // Yazım SAYACI 0: dört istek boyunca havuzdan tek bir yazan SQL bile geçmedi (aynı veriyi yeniden yazan — dökümü değiştirmeyen —
    // yazım da burada yakalanır).
    expect(sqlGunlugu().slice(sqlOnce).filter(q => YAZAN_SQL.test(q))).toEqual([]);
    expect(await veriDokumu()).toBe(once);
    expect(yazilan.filter(s => s.includes(METIN) || s.includes(UNVAN) || s.includes('11111111111'))).toEqual([]);
    expect(disari.slice(disariOnce)).toEqual([]);                                     // Mikro dışında dışarı istek yok
  });
});
