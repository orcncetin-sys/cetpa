/**
 * GET /api/mikro/iskonto-tutarsizlik — "başka böyle bir kayıt var mı" (kullanıcı 2026-09-28). Mikro'nun TÜM geçmişinden
 * "iskonto brüte bir kez daha eklenmiş" faturaları döndürür. SALT OKUMA, token yalnız başlıkta, kolonlar şemadan.
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

const YOL = '/api/mikro/iskonto-tutarsizlik';
const cagir = (headers: Record<string, string> = { 'x-ops-token': JETON }, query: Record<string, unknown> = {}) =>
  d.cagir('GET', YOL, undefined, undefined, { headers, query });
const SEMA = [...TEMEL_SATIR_KOLONLARI, 'sth_iskonto1', 'sth_iskonto2', 'sth_isk_mas1', 'sth_aciklama'];
const E420 = { sth_evraktip: '3', sth_evrakno_seri: '', sth_evrakno_sira: '420', sth_tarih: '2026-08-31T00:00:00', sth_stok_kod: 'RULO1081', sth_tip: '0',
  sth_miktar: '1050', sth_tutar: '398317.5', sth_vergi: '33736.5', sth_vergi_pntr: '4', sth_iptal: '0', sth_iskonto1: '85050', sth_iskonto2: '29767.5' };
const B420 = { cha_evrakno_seri: '', cha_evrakno_sira: 420, cha_tip: 1, cha_meblag: 317236.5, cha_iptal: 0, cha_tarihi: '2026-08-31T00:00:00', cha_kod: '7721308691' };
const kur = (satirlar: Record<string, unknown>[], basliklar: Record<string, unknown>[]) => {
  vi.mocked(mikroKolonlar).mockResolvedValue(SEMA);
  vi.mocked(mikroSql)
    .mockResolvedValueOnce({ rows: satirlar, hata: null })
    .mockResolvedValueOnce({ rows: basliklar, hata: null });
};

describe('GET /api/mikro/iskonto-tutarsizlik', () => {
  it('jeton kapısı: tanımsız 503, yanlış 401, SORGU DİZESİNDEKİ jeton kabul edilmez (IIS günlüğüne düşerdi)', async () => {
    delete process.env.OPS_SUMMARY_TOKEN;
    expect((await cagir()).kod).toBe(503);
    process.env.OPS_SUMMARY_TOKEN = JETON;
    expect((await cagir({ 'x-ops-token': 'yanlis' })).kod).toBe(401);
    expect((await cagir({}, { token: JETON })).kod).toBe(401);
    expect(mikroSql).not.toHaveBeenCalled();
  });

  it('evrak 420: Mikro toplamı 317.236,50 → doğru toplam 202.419, fazla 114.817,50; hiçbir yazım yok', async () => {
    kur([E420], [B420]);
    const r = await cagir();
    expect(r.kod).toBe(200);
    const g = r.govde as { success: boolean; kesildi: boolean; iskontoKolonlari: string[]; faturalar: Array<Record<string, unknown>>; ozet: Record<string, number> };
    expect(g).toMatchObject({ success: true, kesildi: false, iskontoKolonlari: ['sth_iskonto1', 'sth_iskonto2'] });
    expect(g.faturalar).toHaveLength(1);
    expect(g.faturalar[0]).toMatchObject({ yon: 'gelen', sira: '420', cariKod: '7721308691', mikroToplam: 317236.5, kesin: true });
    expect(g.faturalar[0].dogruToplam as number).toBeCloseTo(202419, 2);
    expect(g.faturalar[0].fazla as number).toBeCloseTo(114817.5, 2);
    expect(g.ozet).toMatchObject({ tutarsizFatura: 1, tutarsizSatir: 1, incelenenFatura: 1 });
    expect(d.yazilan).toEqual([]);
    expect(mikroPost).not.toHaveBeenCalled();                    // Mikro'ya yazan hiçbir metot çağrılmaz
  });

  it('SQL: yalnız şemadan gelen kolonlar; iskonto koşulu şemadaki TÜM iskonto kolonlarıyla; fatura evrak koşulu + yön eşlemesi', async () => {
    kur([], []);
    await cagir();
    const [satirSql] = vi.mocked(mikroSql).mock.calls[0] as [string];
    const [baslikSql] = vi.mocked(mikroSql).mock.calls[1] as [string];
    expect(satirSql).toMatch(/^SELECT TOP 50000 s\.sth_evraktip, /);
    expect(satirSql).toContain('s.sth_iskonto1, s.sth_iskonto2');
    expect(satirSql).not.toMatch(/sth_isk_mas1|sth_aciklama/);   // bayrak/açıklama TUTAR değil
    expect(satirSql).toContain('(ISNULL(x.sth_iskonto1, 0) <> 0 OR ISNULL(x.sth_iskonto2, 0) <> 0)');
    expect(satirSql).toContain('s.sth_evraktip IN (3, 4)');
    expect(baslikSql).toContain('(cha.cha_evrak_tip = 63 OR (cha.cha_evrak_tip = 0 AND cha.cha_cinsi = 6))');
    expect(baslikSql).toContain('x.sth_evraktip = CASE WHEN cha.cha_tip = 0 THEN 4 ELSE 3 END');
  });

  it('ağır okumalar uzun zaman aşımıyla (listeZamanAsimiMs), global 30 sn ile DEĞİL', async () => {
    kur([], []);
    await cagir();
    const cagrilar = vi.mocked(mikroSql).mock.calls;
    expect(cagrilar).toHaveLength(2);
    for (const c of cagrilar) expect(c[1]).toEqual({ zamanAsimiMs: expect.any(Number) });
    for (const c of cagrilar) expect((c[1] as { zamanAsimiMs: number }).zamanAsimiMs).toBeGreaterThanOrEqual(120000);
  });

  it('şemada temel kolon eksikse rapor KOŞMAZ, eksik adıyla 500 (tahmin yok); iskonto kolonu yoksa boş rapor', async () => {
    vi.mocked(mikroKolonlar).mockResolvedValueOnce(TEMEL_SATIR_KOLONLARI.filter(k => k !== 'sth_vergi'));
    const r = await cagir();
    expect(r.kod).toBe(500);
    expect(String((r.govde as { error: string }).error)).toContain('sth_vergi');
    expect(mikroSql).not.toHaveBeenCalled();
    vi.mocked(mikroKolonlar).mockResolvedValueOnce([...TEMEL_SATIR_KOLONLARI]);
    const bos = await cagir();
    expect(bos.govde).toMatchObject({ success: true, iskontoKolonuYok: true, faturalar: [] });
  });

  it('şema OKUNAMADIYSA (mikroKolonlar boş: Mikro erişilemedi / INFORMATION_SCHEMA hatası) 502 "şema okunamadı" — sahte "kolon yok" hükmü YOK', async () => {
    vi.mocked(mikroKolonlar).mockResolvedValueOnce([]);
    const r = await cagir();
    expect(r.kod).toBe(502);
    const hata = String((r.govde as { error: string }).error);
    expect(hata).toContain('şeması okunamadı');
    expect(hata).not.toMatch(/beklenen kolon yok|sth_evraktip/);
    expect(mikroSql).not.toHaveBeenCalled();
  });

  it('Mikro SQL hatası 502 ve metin; sınıra dayanan sonuç kesildi: true', async () => {
    vi.mocked(mikroKolonlar).mockResolvedValue(SEMA);
    vi.mocked(mikroSql).mockResolvedValueOnce({ rows: [], hata: 'Invalid column name' });
    const r = await cagir();
    expect(r.kod).toBe(502);
    expect(String((r.govde as { error: string }).error)).toContain('Invalid column name');
    const cok = Array.from({ length: 50000 }, (_, i) => ({ ...E420, sth_evrakno_sira: String(100000 + i), sth_iskonto1: '0', sth_iskonto2: '0', sth_vergi: '200', sth_tutar: '1000' }));
    kur(cok, []);
    expect((await cagir()).govde).toMatchObject({ success: true, kesildi: true });
  });
});
