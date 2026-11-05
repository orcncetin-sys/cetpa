// @vitest-environment node
/**
 * cariKodTaniRoutes.test.ts: `GET /api/ops/cari-kod-tani` (şartname «Mikro bağlantı B» B3-a § 5.4, BH9 / BH11 / BH19.4; 05.11.2026).
 * PG GERÇEK (PGlite; `docs` canlıyla aynı DDL + boş `mikro_cari_hesaplar` aynası), Mikro sahte (iki okuma). Mikro'ya, ağa istek YOK.
 *
 * Kilitlenen: jeton yalnız başlıkta; yanıtta unvan ve VKN YOK; ölçü sayıları (239 / 236 senaryosunun küçüğü); kuru koşunun «yeni»
 * sayısı `kendiLeadiOlmayanKodlar` ile eşit (kabul ölçüsü); kanıt çelişkisi; okunamayan Mikro → dal kapalı / kuru koşu atlandı.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { duzenekKur, pgliteDocs, type Duzenek, type PgliteDocs } from './mikroRoutes.testDuzenegi';
import { mikroPost, mikroSql, getMikroCreds } from '../mikroClient.js';
import { cariKodTaniRoutes, CANLI_KOD_SORGUSU } from './cariKodTaniRoutes';

vi.mock('node-cron', () => ({ default: { schedule: vi.fn() } }));
vi.mock('../pgShim.js', () => ({ pgServerTimestamp: () => 'TS', resolveSentinels: (v: unknown) => v, broadcastDocChange: vi.fn() }));
vi.mock('../mikroMirror.js', () => ({
  CHA_COLS: {}, STH_COLS: {}, FIS_COLS: {}, SIP_COLS: {},
  mirrorMikroCariler: vi.fn(async () => {}), mirrorMikroInsert: vi.fn(async () => {}), mirrorMikroStoklar: vi.fn(async () => {}),
}));
vi.mock('../mikroClient.js', async (orig) => {
  const gercek = await orig<typeof import('../mikroClient.js')>();
  return {
    ...gercek,
    getMikroCreds: vi.fn(async () => ({ firmaKodu: 'F' })),
    mikroPost: vi.fn(),
    mikroSql: vi.fn(),
    mikroKolonlar: vi.fn(async () => [] as string[]),
    mikroVergiOranlari: vi.fn(async () => new Map<number, number>()),
    vergiOraniCoz: vi.fn(() => null),
  };
});

const JETON = 'test-jetonu-cari';
const yedek = { jeton: process.env.OPS_SUMMARY_TOKEN, kiraci: process.env.MIKRO_CRON_COMPANY_ID };
let pg: PgliteDocs;
let d: Duzenek;
beforeAll(async () => {
  pg = await pgliteDocs();
  await pg.sorgu('CREATE TABLE IF NOT EXISTS mikro_cari_hesaplar (cari_kod text, cari_vdaire_no text)');
}, 60_000);
beforeEach(async () => {
  process.env.OPS_SUMMARY_TOKEN = JETON;
  process.env.MIKRO_CRON_COMPANY_ID = 'A';
  await pg.temizle();
  await pg.sorgu('DELETE FROM mikro_cari_hesaplar');
  d = duzenekKur({ kayit: app => cariKodTaniRoutes(app, { getPgPool: () => ({ query: pg.sorgu }) }) });
  vi.mocked(getMikroCreds).mockResolvedValue({ firmaKodu: 'F' } as Awaited<ReturnType<typeof getMikroCreds>>);
  vi.mocked(mikroSql).mockReset();
  vi.mocked(mikroPost).mockReset();
});
afterEach(() => {
  for (const [ad, deger] of [['OPS_SUMMARY_TOKEN', yedek.jeton], ['MIKRO_CRON_COMPANY_ID', yedek.kiraci]] as const) {
    if (deger === undefined) delete process.env[ad]; else process.env[ad] = deger;
  }
});

const UNVAN = 'ŞİRİN YAPI MALZEMELERİ';
const VKN = '1234567890';
const cari = (kod: string, vkn = VKN) => ({ cari_kod: kod, cari_unvan1: UNVAN, cari_vdaire_no: vkn, cari_efatura_fl: 1, cari_hareket_tipi: 0 });
/** Senaryo: Mikro'da 3 kod (iki aynı VKN), Cetpa'da 2 lead; 120.01.002'nin kendi lead'i yok, VKN'siyle L-A'ya düşer. */
async function kur() {
  for (const [kod, vkn] of [['120.01.001', VKN], ['120.01.002', VKN], ['120.01.003', '5550001112']]) {
    await pg.sorgu('INSERT INTO mikro_cari_hesaplar (cari_kod, cari_vdaire_no) VALUES ($1, $2)', [kod, vkn]);
  }
  await pg.belgeKoy('leads', 'L-A', { companyId: 'A', mikroCariKod: '120.01.001', taxId: VKN, company: 'Şirin Yapı Malzemeleri' });
  await pg.belgeKoy('leads', 'L-C', { companyId: 'A', mikroCariKod: '120.01.003', taxId: '5550001112', company: 'Akasya Hırdavat' });
  await pg.belgeKoy('leads', 'L-yabanci', { companyId: 'B', mikroCariKod: '120.01.002', taxId: VKN });
  await pg.belgeKoy('orders', 'mf-1', { companyId: 'A', source: 'mikro-fatura', mikroCariKod: '120.01.002' });
  await pg.belgeKoy('orders', 'mf-2', { companyId: 'A', source: 'mikro-fatura', mikroCariKod: '120.01.002' });
  await pg.belgeKoy('orders', 'mf-3', { companyId: 'A', source: 'mikro-fatura', mikroCariKod: '120.01.001' });
  await pg.belgeKoy('orders', 'yerel-1', { companyId: 'A', leadId: 'L-A', customerName: 'Şirin Yapı' });
  await pg.belgeKoy('musteriHesaplari', 'u-1', { companyId: 'A', leadId: 'L-A', cariKod: '120.01.001', durum: 'acik' });
  // Yabancı kiracının aynı lead kimliğine bağlı müşteri hesabı: ölçüye GİRMEZ (sayı 1 kalır, bağ kodu 120.01.001; mutasyon: çekirdekteki
  // müşteri hesabı kiracı süzgeci kaldırılırsa «ölçü» testi 2 hesap ve ['120.01.001', '120.01.002'] görür → kırmızı).
  await pg.belgeKoy('musteriHesaplari', 'u-yabanci', { companyId: 'B', leadId: 'L-A', cariKod: '120.01.002', durum: 'acik' });
  vi.mocked(mikroSql).mockImplementation((async (sql: string) => (sql === CANLI_KOD_SORGUSU
    ? { rows: [{ cari_kod: '120.01.001' }, { cari_kod: '120.01.002' }, { cari_kod: '120.01.003' }], hata: null }
    : { rows: [], hata: 'beklenmeyen sorgu' })) as unknown as typeof mikroSql);
  vi.mocked(mikroPost).mockImplementation((async (metot: string) => (metot === 'CariListesiV2'
    ? { ok: true, status: 200, data: { result: [{ Data: { CariListesi: [cari('120.01.001'), cari('120.01.002'), cari('120.01.003', '5550001112')] } }] } }
    : { ok: false, status: 501, data: null })) as unknown as typeof mikroPost);
}
const cagir = (basliklar: Record<string, string> = { 'x-ops-token': JETON }, query: Record<string, unknown> = {}) =>
  d.cagir('GET', '/api/ops/cari-kod-tani', undefined, undefined, { headers: basliklar, query });

describe('GET /api/ops/cari-kod-tani', () => {
  it('jeton yalnız başlıkta: sorgu dizesindeki jeton / yanlış jeton 401; Mikro\'ya gidilmez', async () => {
    expect((await cagir({}, { token: JETON })).kod).toBe(401);
    expect((await cagir({ 'x-ops-token': 'yanlis' })).kod).toBe(401);
    expect(mikroSql).not.toHaveBeenCalled();
    expect(mikroPost).not.toHaveBeenCalled();
  });

  it('ölçü: mikroKod 3 · leadKod 2 · kendi lead\'i olmayan [120.01.002] → L-A\'ya düşer (1 yerel sipariş, 1 müşteri hesabı) · aynı VKN grubu 1', async () => {
    await kur();
    const r = await cagir();
    expect(r.kod, JSON.stringify(r.govde)).toBe(200);
    const g = r.govde as Record<string, unknown>;
    expect(g).toMatchObject({
      success: true, kiraci: 'A', mikroKod: 3, leadKod: 2, kendiLeadiOlmayanKodlar: ['120.01.002'], mikrodaOlmayanLeadKodu: 0, ayniVknCokKodluGrup: 1,
      bagliCetpaVerisi: [{ kod: '120.01.002', dustuguLeadler: ['L-A'], siparis: 1, tahsilat: null, musteriHesabi: 1 }],
    });
    expect(g.gruplar).toEqual([{
      kodlar: ['120.01.001', '120.01.002'], mfKodKirilimi: { '120.01.002': 2, '120.01.001': 1 },
      // Kanıt: müşteri hesabı bağı 120.01.001, MF çoğunluğu 120.01.002, bugünkü kod 120.01.001 → ÇELİŞKİ (S-B3 sorulur, BH11).
      leadler: [{ leadId: 'L-A', bugunkuKod: '120.01.001', musteriHesabiKodlari: ['120.01.001'], bagUyusmaz: 0, yerelSiparis: 1, tahsilat: null, varsayilanKod: null, celiski: true }],
    }]);
  });

  it('kuru koşu (cron ile aynı girdi, aynı saf işlevler): «yeni» = kendi lead\'i olmayan kodlar (kabul eşit); eşik açık; yazım YOK', async () => {
    await kur();
    const g = (await cagir()).govde as { kuruKosu: Record<string, unknown> };
    expect(g.kuruKosu).toMatchObject({
      kodla: 2, plan: [{ kod: '120.01.002', yol: 'yeni', leadId: null, oncekiKod: null }],
      yeniLead: { kodlar: ['120.01.002'], kapi: { acilir: true, not: null } }, canliKumeDali: true,
      kabul: { yeniSayisi: 1, kendiLeadiOlmayan: 1, esit: true },
    });
    expect(vi.mocked(mikroPost).mock.calls.map(c => c[0])).toEqual(['CariListesiV2']);
    expect(vi.mocked(mikroPost).mock.calls[0][1]).toMatchObject({ WhereStr: "cari_baglanti_tipi=0 and cari_lastup_date > '2000/01/01'", Sort: 'cari_kod' });
    // Salt okuma: lead / sipariş satırları değişmedi.
    expect(await pg.belgeOku('leads', 'L-A')).toMatchObject({ mikroCariKod: '120.01.001' });
    expect((await pg.sorgu("SELECT count(*)::int AS n FROM docs WHERE coll = 'leads'")).rows[0].n).toBe(3);
  });

  it('yanıtta unvan ve VKN YOK (yalnız kod, kimlik, sayı)', async () => {
    await kur();
    const metin = JSON.stringify((await cagir()).govde);
    for (const yasak of [UNVAN, 'Şirin', 'Akasya', VKN, '5550001112']) expect(metin, yasak).not.toContain(yasak);
  });

  it('Mikro okunamazsa: canlı küme dalı kapalı (`mikrodaOlmayanLeadKodu: null`), kuru koşu ATLANIR; ayna ölçüsü yine döner', async () => {
    await kur();
    vi.mocked(mikroSql).mockResolvedValue({ rows: [], hata: 'zaman aşımı' });
    vi.mocked(mikroPost).mockResolvedValue({ ok: false, status: 500, data: null });
    const g = (await cagir()).govde as Record<string, unknown>;
    expect(g).toMatchObject({ mikroKod: 3, mikrodaOlmayanLeadKodu: null, kuruKosu: { atlandi: 'CariListesiV2 okunamadı ya da eksik döndü: kuru koşu yapılmadı' } });
    expect(g.kaynak).toEqual({ canliKume: 'okunamadı: zaman aşımı', cariListesi: 'eksik (0 satır)' });
  });
});
