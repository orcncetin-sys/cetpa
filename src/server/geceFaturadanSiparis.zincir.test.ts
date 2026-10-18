// @vitest-environment node
/**
 * geceFaturadanSiparis.zincir.test.ts — 03:20 gece Mikro işinin faturadan-sipariş adımı, GERÇEK `server.ts` + GERÇEK express
 * zinciri + GERÇEK SQL (şartname `.wf/SARTNAME-fatura-govde-ve-gece-mf.md` § 3 «Audit» yönetici kararı, § 4 G3a, § 6, G4).
 *
 * NEDEN GERÇEK ZİNCİR: denetim satırının kiracısı `server.ts`'teki `writeSyncLog` → `writeAuditLog` içinde belirlenir; rota
 * düzeneği (mikroRoutes.testDuzenegi) bu yazıcıları sahteyle değiştirdiği için «gece koşusu başına TEK denetim satırı ve
 * `companyId` = hedef kiracı, `'system'` DEĞİL» sözü yalnız burada ölçülebilir. Aynı koşuda: G3a (Cetpa'dan kesilmiş fatura
 * türetilmez), `acilis-tani`'nin yeni satırı kod değişikliği OLMADAN sayması (G4: 14 → 15) ve panel ucunun denetim davranışının
 * DEĞİŞMEDİĞİ (iki satır, çağıranın kiracısı) ölçülür.
 *
 * SAHTE OLANLAR (yalnız süreç dışına çıkan her şey): Firebase belirteç doğrulayıcısı (belirteç = "<uid>|<e-posta>|<1|0>"), `pg`
 * havuzu (süreç içi PGlite), pg-boss, node-cron (zamanlanan işler YAKALANIR, elle koşturulur — gerçek `zamanla` kaydı), vite,
 * `dotenv` (hiçbir ortam dosyası YÜKLENMEZ) ve dışarı giden `fetch`: Mikro LOKAL modda (belirteç adımı yok) sahte bir uca
 * konuşur — her SQL sorgusu boş döner; hiçbir istek makineden çıkmaz. Canlıya, Firebase'e, Mikro'ya istek YOK.
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
// Zamanlanan işler YAKALANIR (gerçek `zamanla` → `cron.schedule` kaydı); hiçbiri kendiliğinden koşmaz.
vi.mock('node-cron', () => {
  const g = globalThis as Record<string, unknown>;
  const isler: Array<{ ifade: string; is: () => unknown }> = [];
  g.__geceMfIsler = isler;
  return { default: { schedule: (ifade: string, is: () => unknown) => { isler.push({ ifade, is }); return { stop() {}, start() {} }; }, validate: () => true } };
});
vi.mock('vite', () => ({ createServer: async () => ({ middlewares: (_q: unknown, _s: unknown, n: () => void) => n() }) }));
vi.mock('pg', async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();
  const g = globalThis as Record<string, unknown>;
  g.__geceMfPg = db;
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
const pg = (): Pg => G.__geceMfPg as Pg;
const isler = (): Array<{ ifade: string; is: () => unknown }> => G.__geceMfIsler as Array<{ ifade: string; is: () => unknown }>;

let sunucu: http.Server | undefined;
let kapiNo = 0;
let yuklemeDizini = '';
const gercekFetch = globalThis.fetch;
/** Sunucunun dışarı yapmaya çalıştığı her istek (hiçbiri gitmez). */
const disari: string[] = [];

const KIRACI = 'CETPA';
const OPS_JETONU = 'sinama-ops-jetonu-gece-mf-0123456789';
const MIKRO_TABAN = 'http://mikro.ornek.test:8094/Api/APIMethods';
const ETTN = 'ABCDEF12-3456-7890-ABCD-EF1234567890';
const eposta = (uid: string): string => `${uid.toLowerCase()}@example.test`;
const YONETICI = { Authorization: `Bearer ic-Admin|${eposta('ic-Admin')}|1` };

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
const satirlar = async (coll: string, alan: string, deger: string): Promise<Array<Record<string, unknown>>> =>
  (await pg().query(`SELECT data FROM docs WHERE coll = $1 AND data->>'${alan}' = $2`, [coll, deger])).rows.map(r => r.data as Record<string, unknown>);
const belgeVar = async (coll: string, id: string): Promise<boolean> =>
  (await pg().query('SELECT 1 FROM docs WHERE coll = $1 AND id = $2', [coll, id])).rows.length > 0;

/** `mikroFaturalar` satış başlığı (fatura-listesi importunun yazdığı ham cha_* biçimi). */
const satisFaturasi = (sira: number, ek: Record<string, unknown> = {}) => ({
  cha_Guid: `{00000000-0000-0000-0000-000000000${sira}}`, cha_evrakno_seri: '', cha_evrakno_sira: sira, cha_tarihi: '2026-10-17T00:00:00',
  cha_tip: 0, cha_evrak_tip: 63, cha_cinsi: 6, cha_kod: '120.01.0042', cha_meblag: 15000, yon: 'satis', companyId: KIRACI, source: 'mikro_import', ...ek,
});

beforeAll(async () => {
  yuklemeDizini = fs.mkdtempSync(path.join(os.tmpdir(), 'gece-mf-'));
  process.env.PORT = '0';
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgres://sinama/yok';      // yalnız «PG var» dalını açar; havuz PGlite
  process.env.SESSION_TOKEN_SECRET = 'sinama-sirri';
  process.env.UPLOAD_DIR = yuklemeDizini;
  for (const ad of Object.keys(process.env)) {
    if (/^(STRIPE|RESEND|LUCA|SHOPIFY|SMTP|GEMINI|ANTHROPIC|MIKRO|IYZICO|TRENDYOL|HEPSIBURADA|DHL|UPS|FEDEX|YURTICI|MNG|ARAS|WHATSAPP|FIREBASE|GOOGLE_APPLICATION|OPS_|SERVER_TENANT_|SUPER_ADMIN)/.test(ad)) delete process.env[ad];
  }
  // Gece işi KAYDEDİLSİN (modül yüklenirken okunur) ve hedef kiracı ortamdan gelsin. Mikro LOKAL mod: belirteç adımı yok.
  process.env.MIKRO_CRON_SYNC = 'true';
  process.env.MIKRO_CRON_COMPANY_ID = KIRACI;
  process.env.MIKRO_API_URL = MIKRO_TABAN;
  process.env.MIKRO_LOCAL = '1';
  process.env.OPS_SUMMARY_TOKEN = OPS_JETONU;
  globalThis.fetch = (async (girdi: unknown, init?: RequestInit) => {
    const url = String(typeof girdi === 'string' ? girdi : (girdi as { url?: string }).url ?? girdi);
    disari.push(`${init?.method ?? 'GET'} ${url.replace(/\?.*$/, '')}`);
    if (url === `${MIKRO_TABAN}/SqlVeriOkuV2`) {
      return new Response(JSON.stringify({ result: [{ IsError: false, Data: [{ SQLResult1: [] }] }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({ result: [{ IsError: false, Data: [] }] }), { status: 200, headers: { 'content-type': 'application/json' } });
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

  await belgeKoy('users', 'ic-Admin', { email: eposta('ic-Admin'), role: 'Admin', companyId: KIRACI });
  // 501: Cetpa'dan kesilmiş fatura (Cetpa siparişi ETTN'i süslü parantezli + BÜYÜK harf, faturada küçük harf) → türetilmez (G3a).
  // 502: Mikro masaüstünden kesilmiş fatura → MF siparişi türetilir.
  await belgeKoy('mikroFaturalar', 'f501', satisFaturasi(501, { cha_uuid: ETTN.toLowerCase() }));
  await belgeKoy('mikroFaturalar', 'f502', satisFaturasi(502, { cha_uuid: '11111111-2222-3333-4444-555555555555' }));
  await belgeKoy('orders', 'cetpa-sip-1', { companyId: KIRACI, orderNumber: 'SIP-0001', customerName: 'Şirin Yapı Malzemeleri', status: 'Delivered',
    hasInvoice: true, ettn: `{${ETTN}}`, mikroFaturaNo: 'CTP2026000000001', totalPrice: 15000 });
  // İnceleme 1, İ-1 (§ 8 H1 / § 9.A, 2026-10-19): kaydet sonucu BELİRSİZ kalan Cetpa siparişi (ETTN yok) + aynı carinin talep
  // gününden sonraki Mikro faturası (503) → gece MF siparişi TÜRETİLMEZ, «⚠ 1 fatura bekletildi» (çift MF yok).
  await belgeKoy('orders', 'cetpa-sip-2', { companyId: KIRACI, orderNumber: 'SIP-0002', customerName: 'Örnek İnşaat', status: 'Processing',
    mikroFaturaGonderimi: { durum: 'belirsiz', istekNo: 'gece-belirsiz', zaman: '2026-10-16T08:00:00.000Z', kim: 'satis@example.test',
      cariKod: '120.01.0077', faturaTarihi: '16.10.2026' } });
  await belgeKoy('mikroFaturalar', 'f503', satisFaturasi(503, { cha_kod: '120.01.0077', cha_uuid: '22222222-3333-4444-5555-666666666666' }));
}, 240_000);

afterAll(async () => {
  globalThis.fetch = gercekFetch;
  const s = sunucu;
  if (s) { s.closeAllConnections(); await new Promise<void>(r => s.close(() => r())); }
  if (yuklemeDizini) fs.rmSync(yuklemeDizini, { recursive: true, force: true });
}, 30_000);

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('03:20 gece işi (gerçek kayıt, elle koşturuldu) — faturadan-sipariş adımı', () => {
  it('iş GERÇEK `zamanla` kaydından yakalanır; koşu sonunda MF siparişi türer, Cetpa\'ya ETTN ile bağlı fatura türetilmez (G3a), belirsiz Cetpa siparişinin carisinin faturası BEKLER (İ-1)', async () => {
    const gece = isler().filter(i => i.ifade === '20 3 * * *');
    expect(gece).toHaveLength(1);
    await gece[0].is();
    expect(await belgeVar('orders', `mikrofat__${KIRACI}__-502`)).toBe(true);
    expect(await belgeVar('orders', `mikrofat__${KIRACI}__-501`)).toBe(false);
    expect(await belgeVar('orders', `mikrofat__${KIRACI}__-503`)).toBe(false);
    // Mikro'ya giden her istek SAHTE uca (LOKAL mod: belirteç sunucusuna istek yok). `fetch` sahte — hiçbir istek makineden çıkmaz.
    const mikroIstekleri = disari.filter(u => /mikro/i.test(u));
    expect(mikroIstekleri.length).toBeGreaterThan(0);
    expect(mikroIstekleri.every(u => u.includes(MIKRO_TABAN)), mikroIstekleri.join('\n')).toBe(true);
  });

  it('syncLog: TAM BİR sistem satırı (userId system, başarılı), notta G3a sayacı', async () => {
    const s = await satirlar('syncLog', 'operation', 'faturadan-siparis');
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ entityType: 'orders', success: true, error: null, userId: 'system', userEmail: '' });
    expect(String(s[0].entityId)).toContain('1 sipariş türetildi');
    expect(String(s[0].entityId)).toContain('1 fatura Cetpa siparişine bağlı (ETTN) — türetilmedi');
    // Bekletme gece satırını BAŞARISIZ yapmaz (iş doğru koştu); sayı nota girer (§ 9.A A6).
    expect(String(s[0].entityId)).toContain("⚠ 1 fatura bekletildi: aynı müşterinin Mikro'ya gönderilmiş ama hangi faturaya karşılık geldiği bilinmeyen Cetpa siparişi var (SIP-0002)");
  });

  it("denetim: gece koşusu başına TEK satır ve `companyId` = HEDEF KİRACI ('system' DEĞİL); ucun «Faturadan Sipariş» satırı yazılmaz", async () => {
    const d = await satirlar('auditLog', 'action', 'faturadan-siparis');
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ companyId: KIRACI, userId: 'system', source: 'server' });
    expect(await satirlar('auditLog', 'action', 'Faturadan Sipariş')).toEqual([]);
    // Öteki gece adımlarının denetimi bu işte DEĞİŞMEDİ (§ 7 ayrı iş): GİB taraması hâlâ `'system'` kiracısına yazar.
    const gib = await satirlar('auditLog', 'action', 'EBelgeDurumSorgulamaV2');
    expect(gib.length).toBeGreaterThan(0);
    expect(gib.every(r => r.companyId === 'system')).toBe(true);
  });

  it('G4 — `acilis-tani` kod değişikliği OLMADAN sayar: satır `faturadan-siparis` / sistem; gün özetinde sistem satırı 15 (14 → 15)', async () => {
    const sistemSatiri = (await pg().query("SELECT count(*)::int AS n FROM docs WHERE coll = 'syncLog' AND data->>'userId' = 'system'")).rows[0].n;
    expect(sistemSatiri).toBe(15);
    const r = await istek('GET', '/api/ops/acilis-tani', { 'X-Ops-Token': OPS_JETONU });
    expect(r.s, r.metin).toBe(200);
    const senkron = r.j.senkron as { satirlar: Array<Record<string, unknown>>; gunler: Array<{ basarili: number; hatali: number }> };
    // `⚠` (bekletme notu) açılış tanısında satırı UYARILI gösterir; satır yine başarılı (§ 9.A A6).
    expect(senkron.satirlar.filter(x => x.islem === 'faturadan-siparis')).toEqual([expect.objectContaining({ islem: 'faturadan-siparis', hedef: 'orders', sistem: true, basarili: true, uyari: true })]);
    expect(senkron.gunler.reduce((t, g) => t + g.basarili + g.hatali, 0)).toBe(15);
  });

  it('panel ucu DEĞİŞMEDİ: aynı işlevi koşar, denetim İKİ satır (uç + writeSyncLog içi) ve çağıranın kiracısıyla; ikinci koşu kopya üretmez', async () => {
    const once = (await satirlar('auditLog', 'userId', 'ic-Admin')).length;
    const r = await istek('POST', '/api/mikro/import/faturadan-siparis', YONETICI, {});
    expect(r.s, r.metin).toBe(200);
    expect(r.j).toMatchObject({ success: true, created: 0, total: 3 });                 // 502 zaten var (idempotent), 501 Cetpa'ya bağlı, 503 bekler
    expect(String(r.j.note)).toContain('1 fatura Cetpa siparişine bağlı');
    const yeni = (await satirlar('auditLog', 'userId', 'ic-Admin')).slice(once);
    expect(yeni.map(x => [x.action, x.companyId]).sort()).toEqual([['Faturadan Sipariş', KIRACI], ['faturadan-siparis', KIRACI]]);
    expect(await belgeVar('orders', `mikrofat__${KIRACI}__-501`)).toBe(false);
  });
});
