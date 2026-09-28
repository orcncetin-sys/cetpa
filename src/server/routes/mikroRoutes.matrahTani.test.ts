/**
 * GET /api/mikro/matrah-tani — fatura matrahı tanımını ÖLÇER (2026-09-28). SALT OKUMA, jeton yalnız başlıkta, kolonlar şemadan.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { duzenekKur, type Duzenek } from './mikroRoutes.testDuzenegi';
import { mikroPost, mikroSql, mikroKolonlar, v17MetoduKullanilabilir } from '../mikroClient.js';
import { TEMEL_SATIR_KOLONLARI } from '../mikro/iskontoTutarsizlik';

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
    mikroPost: vi.fn(),
    mikroVergiOranlari: vi.fn(async () => ({})),
    vergiOraniCoz: vi.fn(() => null),
    v17MetoduKullanilabilir: vi.fn(async () => true),
    mikroSql: vi.fn(async () => ({ rows: [] as Record<string, unknown>[], hata: null })),
    mikroKolonlar: vi.fn(async () => [] as string[]),
  };
});

const JETON = 'test-jetonu-abc';
const yedek = process.env.OPS_SUMMARY_TOKEN;
let d: Duzenek;
beforeEach(() => {
  process.env.OPS_SUMMARY_TOKEN = JETON;
  d = duzenekKur();
  vi.mocked(v17MetoduKullanilabilir).mockResolvedValue(true);
  vi.mocked(mikroSql).mockReset();
  vi.mocked(mikroKolonlar).mockReset();
  vi.mocked(mikroPost).mockReset();
});
afterEach(() => { if (yedek === undefined) delete process.env.OPS_SUMMARY_TOKEN; else process.env.OPS_SUMMARY_TOKEN = yedek; });

const YOL = '/api/mikro/matrah-tani';
const cagir = (headers: Record<string, string> = { 'x-ops-token': JETON }, query: Record<string, unknown> = {}) =>
  d.cagir('GET', YOL, undefined, undefined, { headers, query });
const STH = [...TEMEL_SATIR_KOLONLARI, 'sth_iskonto1', 'sth_iskonto2', 'sth_masraf1', 'sth_masraf2', 'sth_masraf_vergi', 'sth_isk_mas1', 'sth_masraf_vergi_pntr'];
const CHA = ['cha_tip', 'cha_meblag', 'cha_aratoplam', 'cha_ft_iskonto1', 'cha_ft_iskonto2', 'cha_isk_mas1'];
const tablolar = (sth = STH, cha = CHA) => vi.mocked(mikroKolonlar).mockImplementation(async (t: string) => (t === 'STOK_HAREKETLERI' ? sth : t === 'CARI_HESAP_HAREKETLERI' ? cha : []));
const sql = (satirlar: Record<string, unknown>[], basliklar: Record<string, unknown>[]) => {
  vi.mocked(mikroSql).mockResolvedValueOnce({ rows: satirlar, hata: null }).mockResolvedValueOnce({ rows: basliklar, hata: null });
};

describe('GET /api/mikro/matrah-tani', () => {
  it('jeton kapısı: tanımsız 503, yanlış 401, sorgu dizesindeki jeton 401; Mikro\'ya hiç gidilmez', async () => {
    delete process.env.OPS_SUMMARY_TOKEN;
    expect((await cagir()).kod).toBe(503);
    process.env.OPS_SUMMARY_TOKEN = JETON;
    expect((await cagir({ 'x-ops-token': 'yanlis' })).kod).toBe(401);
    expect((await cagir({}, { token: JETON })).kod).toBe(401);
    expect(mikroSql).not.toHaveBeenCalled();
    expect(mikroKolonlar).not.toHaveBeenCalled();
  });

  it('SQL: iskonto/masraf aileleri + masraf KDV\'si + ft iskontoları + aratoplam ŞEMADAN; bayrak kolonları (isk_mas, masraf_vergi_pntr) GİRMEZ', async () => {
    tablolar();
    sql([], []);
    await cagir();
    const [satirSql, satirSecenek] = vi.mocked(mikroSql).mock.calls[0] as [string, unknown];
    const [baslikSql] = vi.mocked(mikroSql).mock.calls[1] as [string];
    const aktif = (x: string, e = 'ELSE 0 ') => `CASE WHEN ISNULL(sth_iptal, 0) = 0 THEN ${x} ${e}END`;
    expect(satirSql).toContain(`SUM(${aktif('(ISNULL(sth_iskonto1, 0) + ISNULL(sth_iskonto2, 0))')}) AS isk`);
    expect(satirSql).toContain(`SUM(${aktif('(ISNULL(sth_masraf1, 0) + ISNULL(sth_masraf2, 0))')}) AS masraf`);
    expect(satirSql).toContain(`SUM(${aktif('ISNULL(sth_masraf_vergi, 0)')}) AS masrafVergi`);
    expect(satirSql).toContain(`SUM(${aktif('sth_tutar', '')}) AS tutar`);                  // NULL tutar 0 SAYILMAZ…
    expect(satirSql).toContain('SUM(CASE WHEN ISNULL(sth_iptal, 0) = 0 AND (sth_tutar IS NULL OR sth_vergi IS NULL) THEN 1 ELSE 0 END) AS bilinmeyen');  // …sayılır
    // İptal satırları WHERE'de süzülmez, AYRI sayılır (fatura-listesi importu JOIN'de süzmüyor — ölçülmeli).
    expect(satirSql).toContain('SUM(CASE WHEN ISNULL(sth_iptal, 0) <> 0 THEN 1 ELSE 0 END) AS iptalSatir');
    expect(satirSql).toContain('SUM(CASE WHEN ISNULL(sth_iptal, 0) <> 0 THEN ISNULL(sth_tutar, 0) ELSE 0 END) AS iptalTutar');
    expect(satirSql).toContain('(ISNULL(sth_iskonto1, 0) < 0 OR ISNULL(sth_iskonto2, 0) < 0)');
    expect(satirSql).not.toMatch(/sth_isk_mas1|sth_masraf_vergi_pntr/);
    expect(satirSql).toContain('FROM STOK_HAREKETLERI WHERE sth_evraktip IN (3, 4) GROUP BY sth_evraktip, sth_evrakno_seri, sth_evrakno_sira');
    expect(satirSecenek).toEqual({ zamanAsimiMs: expect.any(Number) });
    expect(baslikSql).toContain('cha.cha_aratoplam AS aratoplam');
    expect(baslikSql).toContain('(ISNULL(cha.cha_ft_iskonto1, 0) + ISNULL(cha.cha_ft_iskonto2, 0)) AS ftIsk');
    expect(baslikSql).not.toContain('cha_isk_mas1');
    expect(baslikSql).toContain('WHERE (cha.cha_evrak_tip = 63 OR (cha.cha_evrak_tip = 0 AND cha.cha_cinsi = 6))');
  });

  it('isteğe bağlı kolonlar şemada yoksa SQL\'e girmez: masrafVergi seçilmez, aratoplam/ftIsk NULL; kolonlar yanıtta null/boş', async () => {
    tablolar([...TEMEL_SATIR_KOLONLARI], ['cha_tip', 'cha_meblag']);
    sql([], []);
    const g = (await cagir()).govde as { kolonlar: Record<string, unknown> };
    const [satirSql] = vi.mocked(mikroSql).mock.calls[0] as [string];
    const [baslikSql] = vi.mocked(mikroSql).mock.calls[1] as [string];
    expect(satirSql).toContain('THEN (0) ELSE 0 END) AS isk');
    expect(satirSql).toContain('SUM(0) AS negatifIsk');
    expect(satirSql).not.toContain('masrafVergi');
    expect(baslikSql).toContain('NULL AS aratoplam, NULL AS ftIsk');
    expect(g.kolonlar).toEqual({ iskonto: [], masraf: [], masrafVergi: null, aratoplam: null, ftIskonto: [] });
  });

  it('uçtan uca: iskontolu fatura tutuyor + aratoplam "net"; satırsız fatura listelenir; hiçbir yazım yok', async () => {
    tablolar();
    sql(
      [{ sth_evraktip: '3', sth_evrakno_seri: '', sth_evrakno_sira: '1', n: 1, tutar: 283500, isk: 114817.5, masraf: 0, vergi: 33736.5, bilinmeyen: 0, masrafVergi: 0 }],
      [
        { cha_tip: 1, cha_evrakno_seri: '', cha_evrakno_sira: 1, cha_meblag: 202419, aratoplam: 168682.5, ftIsk: 0, iptal: 0 },
        { cha_tip: 0, cha_evrakno_seri: '', cha_evrakno_sira: 9, cha_meblag: 1200, aratoplam: 1000, ftIsk: 0, iptal: 0 },
      ],
    );
    const r = await cagir();
    expect(r.kod).toBe(200);
    const g = r.govde as { ozet: { sinif: Record<string, { gelen: number; giden: number }>; aratoplam: { iliski: Record<string, number> } }; tutmayanlar: Record<string, Array<Record<string, unknown>>>; okunan: unknown };
    expect(g.ozet.sinif.tutuyor).toEqual({ gelen: 1, giden: 0 });
    expect(g.ozet.sinif.satirsiz).toEqual({ gelen: 0, giden: 1 });
    expect(g.ozet.aratoplam.iliski.net).toBe(1);
    expect(g.tutmayanlar.satirsiz[0]).toMatchObject({ yon: 'giden', sira: '9', meblag: 1200 });
    expect(g.okunan).toEqual({ faturaSatirGrubu: 1, baslik: 2 });
    expect(d.yazilan).toEqual([]);
    expect(mikroPost).not.toHaveBeenCalled();
  });

  it('şema okunamadıysa 502; temel kolon eksikse 500 adıyla; SQL hatası 502', async () => {
    vi.mocked(mikroKolonlar).mockResolvedValue([]);
    expect((await cagir()).kod).toBe(502);
    tablolar(TEMEL_SATIR_KOLONLARI.filter(k => k !== 'sth_vergi'));
    const eksik = await cagir();
    expect(eksik.kod).toBe(500);
    expect(String((eksik.govde as { error: string }).error)).toContain('sth_vergi');
    expect(mikroSql).not.toHaveBeenCalled();
    tablolar();
    vi.mocked(mikroSql).mockResolvedValueOnce({ rows: [], hata: 'Invalid column name' });
    const h = await cagir();
    expect(h.kod).toBe(502);
    expect(String((h.govde as { error: string }).error)).toContain('Invalid column name');
  });
});
