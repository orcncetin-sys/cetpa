// @vitest-environment node
/**
 * mikroRoutes.mfKaynaksiz.test.ts: `mfIptalEsle` kaynaksız MF işaretini GERÇEKTEN yazar ve kaldırır (şartname «Mikro bağlantı B»
 * B2 § 4.2, T-B2-1 / T-B2-2; 05.11.2026). Rota `POST /api/mikro/import/faturadan-siparis` (gece ile AYNI gövde
 * `faturadanSiparisCalistir`); işaret yazıcısı doğrudan SQL → PGlite (`docs` canlıyla aynı DDL). Öteki yazımlar sahte adminDb'ye düşer.
 * Mikro'ya, ağa istek YOK.
 *
 * Mutasyon (yapılıp geri alındı, raporda): `mfIptalEsle`'de kaldırma dalı (`isaretKaldir.push`) silinir → «fatura geri gelince
 * işaret kalkar», «iptal dalı», «belirsiz dal» ve «kaynaksizSay false iken kaldırır» kırmızı.
 *
 * vi.mock blokları BURADA kalmak zorunda (vitest hoisting); tarif: mikroRoutes.testDuzenegi `mikroMockTarifi`.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { duzenekKur, pgliteDocs, type Duzenek, type PgliteDocs } from './mikroRoutes.testDuzenegi';
import { v17MetoduKullanilabilir } from '../mikroClient.js';
import { kaynaksizAdetiOku } from '../mikro/faturadanSiparisNotu';

vi.mock('node-cron', () => ({ default: { schedule: vi.fn() } }));
vi.mock('../pgShim.js', () => ({ pgServerTimestamp: () => 'TS' }));
vi.mock('../mikroMirror.js', () => ({
  CHA_COLS: {}, STH_COLS: {}, FIS_COLS: {}, SIP_COLS: {},
  mirrorMikroCariler: vi.fn(async () => {}), mirrorMikroInsert: vi.fn(async () => {}), mirrorMikroStoklar: vi.fn(async () => {}),
}));
vi.mock('../mikroClient.js', async (orig) => {
  const gercek = await orig<typeof import('../mikroClient.js')>();
  return {
    ...gercek,
    getMikroCreds: vi.fn(async () => ({ firmaKodu: 'F' })),
    mikroPost: vi.fn(async () => ({ ok: false, status: 501, data: null })),
    mikroVergiOranlari: vi.fn(async () => new Map<number, number>()),
    vergiOraniCoz: vi.fn(() => null),
    v17MetoduKullanilabilir: vi.fn(async () => true),
    mikroSql: vi.fn(async () => ({ rows: [] as Record<string, unknown>[], hata: null })),
    mikroKolonlar: vi.fn(async () => [] as string[]),
  };
});

let pg: PgliteDocs;
let d: Duzenek;
beforeAll(async () => {
  pg = await pgliteDocs();
  // `faturadanSiparisCalistir` havuz varken cari adlarını aynadan okur (tek SELECT); ayna tablosu boş kurulur.
  await pg.sorgu('CREATE TABLE IF NOT EXISTS mikro_cari_hesaplar (cari_kod text, cari_unvan1 text)');
}, 60_000);
beforeEach(async () => {
  await pg.temizle();
  d = duzenekKur();
  d.pgAyarla(pg.sorgu);
  vi.mocked(v17MetoduKullanilabilir).mockResolvedValue(true);
});

const BASLIK = { cha_evrakno_seri: '', cha_evrakno_sira: 321, cha_tarihi: '2026-08-01T00:00:00', cha_tip: 0, cha_kod: '120 01', cha_meblag: 21600 };
const fatura = (sira: number) => ({ ...BASLIK, cha_Guid: `G${sira}`, cha_evrakno_sira: sira });
const ISARET = { mfKaynaksiz: true, mfKaynaksizGoruldu: '2026-11-01T00:20:00.000Z' };
const MF = (sira: number, p: Record<string, unknown> = {}) => ({
  id: `mikrofat__A__-${sira}`, companyId: 'A', source: 'mikro-fatura', orderNumber: `MF-${sira}`, status: 'Delivered', faturali: true,
  mikroFaturaNo: String(sira), mikroEvrak: { seri: '', sira: String(sira) }, lineItems: [{ kalemSurumu: 2 }], totalPrice: 1000, ...p,
});
/** Girdiler: fatura listesi + iptal listesi + mevcut siparişler (aynı siparişler PGlite'a da konur: işaret SQL'inin hedefi). */
const kur = async (faturalar: Record<string, unknown>[], iptaller: Record<string, unknown>[], mevcut: Array<Record<string, unknown>>) => {
  for (const o of mevcut) { const { id, ...veri } = o; await pg.belgeKoy('orders', String(id), veri); }
  vi.mocked(d.C.loadCompanyDocs).mockImplementation((async (coll: string) =>
    coll === 'mikroFaturalar' ? faturalar : coll === 'mikroIptalFaturalar' ? iptaller : coll === 'orders' ? mevcut : []) as typeof d.C.loadCompanyDocs);
};
const turet = async () => {
  const res = await d.cagir('POST', '/api/mikro/import/faturadan-siparis');
  expect(res.kod, JSON.stringify(res.govde)).toBe(200);
  return String((res.govde as { note?: string }).note ?? '');
};
const satir = (sira: number) => pg.belgeOku('orders', `mikrofat__A__-${sira}`);
const durumYazimi = (sira: number) => d.koleksiyon('orders').filter(y => y.ref.id === `mikrofat__A__-${sira}` && y.data && 'status' in y.data);

describe('T-B2-1 · mfIptalEsle kaynaksız işaretini yazar ve kaldırır', () => {
  it('kaynaksız MF (325) işaretlenir; durum / tutar DEĞİŞMEZ; yayın; not: eski ⚠ parçası + «1 kaynaksız işaretlendi, 0 işaret kaldırıldı»', async () => {
    await kur([BASLIK], [], [MF(321), MF(325)]);
    const not = await turet();
    expect(await satir(325)).toMatchObject({ mfKaynaksiz: true, status: 'Delivered', totalPrice: 1000 });
    expect(typeof (await satir(325))?.mfKaynaksizGoruldu).toBe('string');
    expect(await satir(321)).not.toHaveProperty('mfKaynaksiz');
    expect(durumYazimi(325)).toEqual([]);
    expect(not).toContain('1 kaynaksız işaretlendi, 0 işaret kaldırıldı');
    expect(kaynaksizAdetiOku(not)).toBe(1);   // açılış tanısı ADAY sayısını okumaya devam eder (A8)
    expect(vi.mocked(d.C.broadcastDocChange).mock.calls.filter(c => c[0] === 'orders').map(c => c[2])).toEqual(['mikrofat__A__-325']);
  });

  it('fatura geri gelince (geçerli listede) işaret KALKAR; not «0 kaynaksız işaretlendi, 1 işaret kaldırıldı»', async () => {
    await kur([BASLIK, fatura(325)], [], [MF(321), MF(325, ISARET)]);
    const not = await turet();
    expect(await satir(325)).not.toHaveProperty('mfKaynaksiz');
    expect(await satir(325)).not.toHaveProperty('mfKaynaksizGoruldu');
    expect(not).toContain('0 kaynaksız işaretlendi, 1 işaret kaldırıldı');
  });

  it('iptal listesinde görünen işaretli MF: işaret kalkar (iptal eşlemesi ayrıca durumu çevirir)', async () => {
    await kur([BASLIK], [{ cha_evrakno_seri: '', cha_evrakno_sira: 325, cha_tip: 0 }], [MF(321), MF(325, ISARET)]);
    await turet();
    expect(await satir(325)).not.toHaveProperty('mfKaynaksiz');
    expect(durumYazimi(325).map(y => y.data?.status)).toEqual(['Cancelled']);
  });

  it('belirsiz dal (aynı numarada hem geçerli hem iptal başlığı): kaynak VAR → işaret kalkar, durum dokunulmaz', async () => {
    await kur([BASLIK, fatura(325)], [{ cha_evrakno_seri: '', cha_evrakno_sira: 325, cha_tip: 0 }], [MF(321), MF(325, ISARET)]);
    await turet();
    expect(await satir(325)).not.toHaveProperty('mfKaynaksiz');
    expect(durumYazimi(325)).toEqual([]);
  });

  it('`kaynaksizSay` false (hiç geçerli satış faturası yok): işaret YAZILMAZ, ama iptal listesindeki işaretli MF\'nin işareti KALKAR', async () => {
    await kur([], [{ cha_evrakno_seri: '', cha_evrakno_sira: 325, cha_tip: 0 }], [MF(325, ISARET), MF(400)]);
    await turet();
    expect(await satir(325)).not.toHaveProperty('mfKaynaksiz');
    expect(await satir(400)).not.toHaveProperty('mfKaynaksiz');
  });

  it('zaten iptal edilmiş kaynaksız MF işaretlenmez', async () => {
    await kur([BASLIK], [], [MF(321), MF(325, { status: 'Cancelled', iptalKaynagi: 'mikro' })]);
    await turet();
    expect(await satir(325)).not.toHaveProperty('mfKaynaksiz');
  });
});

describe('T-B2-2 · olağandışılık eşiği (rota)', () => {
  it('11 kaynaksız → 0 işaret + «⚠ olağandışı: 11 kaynaksız · işaret yazılmadı (eşik 10)»; aday sayısı tanıya yine okunur', async () => {
    const siralar = Array.from({ length: 11 }, (_, i) => 500 + i);
    await kur([BASLIK], [], [MF(321), ...siralar.map(s => MF(s))]);
    const not = await turet();
    for (const s of siralar) expect(await satir(s)).not.toHaveProperty('mfKaynaksiz');
    expect(not).toContain('⚠ olağandışı: 11 kaynaksız · işaret yazılmadı (eşik 10)');
    expect(not).not.toContain('kaynaksız işaretlendi');
    expect(kaynaksizAdetiOku(not)).toBe(11);
  });
});
