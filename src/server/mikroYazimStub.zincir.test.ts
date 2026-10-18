// @vitest-environment node
/**
 * mikroYazimStub.zincir.test.ts — Mikro'ya YAZAN uçlarda stub yanıtı (şartname `.wf/SARTNAME-yeniden-deneme-sunucuda-v3.md` K0a,
 * § 8.2 commit 0-A; T0, H1 (d), H5; kullanıcı kararı S2), GERÇEK `server.ts` + GERÇEK express zinciriyle.
 *
 * İDDİA: `result` anahtarı olmayan 200 yanıtında (stub) yazan uç Mikro'ya TEK istek atar (aynı gövde ikinci kez GİTMEZ), yanıt
 * `success: false` + «OLABİLİR» iletisini (`MIKRO_STUB_METNI`) taşır; belirteç önbelleği yine silinir → kişinin bilerek yaptığı
 * ikinci basış YENİ belirteçle ve yine TEK istekle gider. Okuyan uç bugünkü gibi iki istek atar (stub tekrarı açık).
 * `FaturaKaydetV2` aynı sabiti geçer; davranışı `faturaCiftKesim.zincir.test.ts`'te sınanır.
 *
 * BULUT kipi (`MIKRO_LOCAL=0`): stub tekrarı ve belirteç adımı yalnız bu kipte koşar (canlı LOKAL — Ö20; LOKAL vektörleri
 * `mikroClient.test.ts`'te). Her vektör ayrı Mikro takma adıyla (`MIKRO_ALIAS`, çağrı anında okunur) koşar: belirteç önbelleği ve
 * 5 dk geri çekilme damgası kimlik bilgisi başınadır — vektörler birbirinin damgasını görmez.
 *
 * SAHTE OLANLAR (yalnız süreç dışına çıkanlar; kalıp `mikroCariArama.zincir.test.ts`): Firebase belirteç doğrulayıcısı, `pg` (PGlite),
 * pg-boss, node-cron, vite, `dotenv` ve dışarı giden `fetch` (Mikro kimlik sunucusu + Jump API). Canlıya, Firebase'e, Mikro'ya istek YOK.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { MIKRO_STUB_METNI } from './mikro/yazimSecenegi';

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
  (globalThis as Record<string, unknown>).__yazimStubPg = db;
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

vi.setConfig({ testTimeout: 90_000 });

// ── Düzenek ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
interface Pg { query: (sql: string, p?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> }
const pg = (): Pg => (globalThis as Record<string, unknown>).__yazimStubPg as Pg;

let sunucu: http.Server | undefined;
let kapiNo = 0;
let yuklemeDizini = '';
const gercekFetch = globalThis.fetch;

const KIRACI = 'CETPA';
const TABAN = 'https://mikro.example.test:8094/Api/APIMethods';
const MIKRO_KIMLIK_URL = 'https://onlinekullanici.mikro.com.tr/auth/realms/Mikro/protocol/openid-connect/token';
const eposta = (uid: string): string => `${uid.toLowerCase()}@example.test`;

const jsonYanit = (govde: unknown, kod = 200): Response => new Response(JSON.stringify(govde), { status: kod, headers: { 'content-type': 'application/json' } });
/** Müşterinin VergiListesiV2 tablosu (2026-07-31 canlı bulgusu): sıra 4 = %20, 3 = %10 — gövde kurucularının ters araması için. */
const VERGI_LISTESI = { result: [{ StatusCode: 200, IsError: false, ErrorMessage: '', Data: { VergiListesi: [
  { vergiSiraNo: 1, vergiOrani: 0, vergiAdi: 'YOK' }, { vergiSiraNo: 2, vergiOrani: 1, vergiAdi: 'KDV %1' },
  { vergiSiraNo: 3, vergiOrani: 10, vergiAdi: 'KDV %10' }, { vergiSiraNo: 4, vergiOrani: 20, vergiAdi: 'KDV %20' },
] } }] };

/** Jump API'ye giden her yöntem isteği: yöntem adı ve taşıdığı belirteç (Authorization başlığı). */
const mikroIstekleri: Array<{ yontem: string; belirtec: string | null }> = [];
let belirtecSayaci = 0;

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

let kullaniciSayaci = 0;
/** Her vektör YENİ bir Yönetici hesabıyla gelir (Mikro sınırlayıcısı kullanıcı başına sayar). */
async function yeniYonetici(): Promise<Record<string, string>> {
  kullaniciSayaci++;
  const uid = `stub-yonetici-${kullaniciSayaci}`;
  await belgeKoy('users', uid, { email: eposta(uid), role: 'Admin', companyId: KIRACI });
  return { Authorization: `Bearer ${uid}|${eposta(uid)}|1` };
}
let takmaSayaci = 0;
/** Vektöre özel Mikro takma adı: belirteç önbelleği ve 5 dk geri çekilme damgası bu anahtarla tutulur (mikroClient). */
const yeniTakmaAd = (): void => { takmaSayaci++; process.env.MIKRO_ALIAS = `stub-takma-${takmaSayaci}`; };
const yontemIstekleri = (yontem: string) => mikroIstekleri.filter(m => m.yontem === yontem);

// ── Gövdeler (rota birim testlerindeki geçerli gövdelerle aynı) ────────────────────────────────────────────────────────────
const STOK = { sku: 'CIM-50', name: 'ÇİMENTO 50KG PORTLAND CEM I 42,5R', unit: 'ADET', vatRate: 20, prices: { Retail: 189.9 } };
const SIPARIS = {
  mikroCariKod: '120.01.0042', createdAt: '2026-09-15', depoNo: 2,
  lineItems: [{ sku: 'CIM-50', name: 'ÇİMENTO 50KG', quantity: 3, price: 150, vatRate: 20 }],
};
const DEKONT = {
  cha_tarihi: '19.09.2026', cha_tip: 0, cha_normal_Iade: 0, cha_evrak_tip: 29, cha_evrakno_seri: 'CTP', cha_cari_cins: 0,
  cha_kod: '120-SIRIN', cha_d_kurtar: null, cha_d_cins: 0, cha_d_kur: 1, cha_srmrkkodu: '', cha_projekodu: '',
  cha_kasa_hizmet: 0, cha_kasa_hizkod: '', cha_meblag: 12500,
};
const FIS = {
  id: 'fis-stub', date: '2026-09-19', 'fiş': 'SIP-10421', aciklama: 'Şirin İnşaat - Faturalı Satış (ÇİMENTO 50KG)',
  debitHesap: '120 - Alıcılar', alacakHesap: '600 - Yurt İçi Satışlar', borc: 45000, alacak: 45000,
};
const TAHSILAT = { cariKod: '120-SIRIN', tutar: 45000, tarih: '2026-09-19', aciklama: 'Şirin İnşaat bakiye tahsilatı', tip: 'tahsilat' };
const SEVKIYAT = {
  mikroCariKod: '120.01.0042', customerName: 'Şirin İnşaat Ltd. Şti.', destination: 'Organize Sanayi 5. Cadde No:12, Kocaeli',
  trackingNo: '41 ABC 123', cargoFirm: 'ARAS', date: '2026-09-19T12:00:00.000Z', kdvOran: 20, depoNo: 2,
  items: [{ sku: 'CIM-50', name: 'ÇİMENTO 50KG', quantity: 40, price: 312.5 }],
};

interface YazanUc { ad: string; yontem: string; yol: string; govde: Record<string, unknown>; durum: number; hata: (j: Record<string, unknown>) => unknown }
const ileti = (j: Record<string, unknown>): unknown => j.error;
/** § 0.2'deki 11 yazma çağrısı (genel `evrak/kaydet` dâhil). `FaturaKaydetV2`: faturaCiftKesim.zincir.test.ts. */
const YAZAN_UCLAR: readonly YazanUc[] = [
  { ad: 'stok kartı', yontem: 'StokKaydetV2', yol: '/api/mikro/stok/kaydet', govde: { item: STOK, firebaseId: 'inv-stub' }, durum: 200, hata: ileti },
  { ad: 'cari kart', yontem: 'CariKaydetV2', yol: '/api/mikro/cari/kaydet', govde: { lead: { name: 'Şirin İnşaat' }, firebaseId: 'abc123xyz', collection: 'suppliers' }, durum: 200, hata: ileti },
  { ad: 'sipariş', yontem: 'SiparisKaydetV2', yol: '/api/mikro/siparis/kaydet', govde: { order: SIPARIS, firebaseId: 'ord-stub' }, durum: 200, hata: ileti },
  { ad: 'dekont (cari hareket)', yontem: 'DekontKaydetV2', yol: '/api/mikro/cari-hareket/kaydet', govde: { hareket: DEKONT }, durum: 200, hata: ileti },
  { ad: 'genel evrak', yontem: 'ZiyaretKaydetV2', yol: '/api/mikro/evrak/kaydet', govde: { method: 'ZiyaretKaydetV2', payload: { ziyaret: 1 }, entityType: 'leadVisit', entityId: 'ziyaret-stub' }, durum: 200, hata: ileti },
  { ad: 'muhasebe fişi (yevmiye)', yontem: 'MuhasebeFisKaydetV2', yol: '/api/mikro/yevmiye/kaydet', govde: { entries: [FIS] }, durum: 200,
    hata: j => (Array.isArray(j.errors) ? (j.errors[0] as { error?: unknown } | undefined)?.error : undefined) },
  { ad: 'tahsilat (H1 (d))', yontem: 'TahsilatTediyeKaydetV2', yol: '/api/mikro/tahsilat/kaydet', govde: { tahsilat: TAHSILAT }, durum: 200, hata: ileti },
  { ad: 'e-Arşiv iptali', yontem: 'EArsivIptalV2', yol: '/api/mikro/ebelge/earsiv-iptal', govde: { uuid: '11111111-2222-3333-4444-555555555555', iptalAciklamasi: 'Hatalı tutar' }, durum: 502, hata: ileti },
  { ad: 'gelen fatura kabulü', yontem: 'GelenFaturalarKabulV2', yol: '/api/mikro/gelen-fatura/kabul', govde: { faturaGuid: 'G-KABUL-1' }, durum: 200, hata: ileti },
  { ad: 'gelen fatura reddi', yontem: 'GelenFaturalarRedV2', yol: '/api/mikro/gelen-fatura/ret', govde: { faturaGuid: 'G-RET-1', aciklama: 'Hatalı' }, durum: 200, hata: ileti },
  { ad: 'e-İrsaliye', yontem: 'IrsaliyeKaydetV2', yol: '/api/mikro/irsaliye/kaydet', govde: { shipment: SEVKIYAT, firebaseId: 'shp-stub' }, durum: 200, hata: ileti },
];

beforeAll(async () => {
  yuklemeDizini = fs.mkdtempSync(path.join(os.tmpdir(), 'yazim-stub-'));
  process.env.PORT = '0';
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgres://sinama/yok';      // yalnız «PG var» dalını açar; havuz PGlite
  process.env.SESSION_TOKEN_SECRET = 'sinama-sirri';
  process.env.UPLOAD_DIR = yuklemeDizini;
  for (const ad of Object.keys(process.env)) {
    if (/^(STRIPE|RESEND|LUCA|SHOPIFY|SMTP|GEMINI|ANTHROPIC|MIKRO|IYZICO|TRENDYOL|HEPSIBURADA|DHL|UPS|FEDEX|YURTICI|MNG|ARAS|WHATSAPP|FIREBASE|GOOGLE_APPLICATION|OPS_|SERVER_TENANT_|SUPER_ADMIN)/.test(ad)) delete process.env[ad];
  }
  process.env.MIKRO_LOCAL = '0';
  process.env.MIKRO_API_URL = TABAN;
  Object.assign(process.env, { MIKRO_IDM_EMAIL: 'sinama@example.test', MIKRO_IDM_PASSWORD: 'sinama-parolasi', MIKRO_API_KEY: 'sinama-anahtari' });
  yeniTakmaAd();
  globalThis.fetch = (async (girdi: unknown, init?: RequestInit) => {
    const url = String(typeof girdi === 'string' ? girdi : (girdi as { url?: string }).url ?? girdi);
    if (url === MIKRO_KIMLIK_URL) { belirtecSayaci++; return jsonYanit({ access_token: `belirtec-${belirtecSayaci}`, expires_in: 3600 }); }
    if (url.startsWith(`${TABAN}/`)) {
      const yontem = url.slice(TABAN.length + 1);
      if (yontem === 'VergiListesiV2') return jsonYanit(VERGI_LISTESI);
      const basliklar = (init?.headers ?? {}) as Record<string, string>;
      mikroIstekleri.push({ yontem, belirtec: basliklar.Authorization ?? null });
      return jsonYanit({ Method: yontem });                // stub: `result` anahtarı YOK
    }
    return jsonYanit({});                                  // kur servisleri vb.: hiçbir istek ağa çıkmaz
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
    const t = r.rows[0]; return !!(t.d && t.m);
  }, 60_000, 'tablolar hazır');
}, 240_000);

afterAll(async () => {
  globalThis.fetch = gercekFetch;
  const s = sunucu;
  if (s) { s.closeAllConnections(); await new Promise<void>(r => s.close(() => r())); }
  if (yuklemeDizini) fs.rmSync(yuklemeDizini, { recursive: true, force: true });
}, 30_000);

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('K0a — yazan uç stub alınca Mikro\'ya TEK istek; yanıt «OLABİLİR»; belirteç silinir, bilerek ikinci basış yeni belirteçle tek istek', () => {
  it.each(YAZAN_UCLAR.map(u => [u.ad, u] as const))('%s', async (_ad, u) => {
    yeniTakmaAd();
    const yonetici = await yeniYonetici();
    const once = yontemIstekleri(u.yontem).length;

    const ilk = await istek('POST', u.yol, yonetici, u.govde);
    expect(ilk.s, ilk.metin).toBe(u.durum);
    expect(ilk.j.success).toBe(false);
    expect(u.hata(ilk.j)).toBe(MIKRO_STUB_METNI);
    expect(yontemIstekleri(u.yontem).length - once, 'stub alındı — aynı gövde İKİNCİ kez gitmedi').toBe(1);

    // Kişinin bilerek yaptığı ikinci basış: belirteç önbelleği ilk stub'da silindi → yeni belirteç; yine TEK istek.
    const ikinci = await istek('POST', u.yol, yonetici, u.govde);
    expect(ikinci.s, ikinci.metin).toBe(u.durum);
    expect(u.hata(ikinci.j)).toBe(MIKRO_STUB_METNI);
    const bu = yontemIstekleri(u.yontem).slice(once);
    expect(bu).toHaveLength(2);
    expect(bu[0].belirtec).not.toBeNull();
    expect(bu[1].belirtec, 'ikinci basış taze belirteçle').not.toBe(bu[0].belirtec);
  });

  it('okuyan uç (`cari/ara` → CariListesiV2) stub alınca bugünkü gibi İKİ istek atar (stub tekrarı okuyan çağrıda açık)', async () => {
    yeniTakmaAd();
    const once = yontemIstekleri('CariListesiV2').length;
    const r = await istek('POST', '/api/mikro/cari/ara', await yeniYonetici(), { metin: 'yapı' });
    expect(r.s, r.metin).toBe(502);
    expect(yontemIstekleri('CariListesiV2').length - once).toBe(2);
  });

});
