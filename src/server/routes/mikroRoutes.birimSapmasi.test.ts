/**
 * GET /api/mikro/birim-sapmasi — "DAYSON-DYS.029 … paket girilmiş. bu tip hata var mı?" (kullanıcı 2026-09-28). Mikro'nun TÜM
 * geçmişinden koli/paket ↔ adet şüphesi taşıyan fatura satırları. SALT OKUMA, jeton yalnız başlıkta, kolonlar şemadan.
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

const YOL = '/api/mikro/birim-sapmasi';
const cagir = (headers: Record<string, string> = { 'x-ops-token': JETON }, query: Record<string, unknown> = {}) =>
  d.cagir('GET', YOL, undefined, undefined, { headers, query });
const SEMA = [...TEMEL_SATIR_KOLONLARI, 'sth_iskonto1', 'sth_masraf1', 'sth_isk_mas1', 'sth_aciklama'];
// Türkçe harmanlamada kolon adının GERÇEK yazımı kullanılmalı ('sto_isim' ≠ 'STO_ISIM' olabilir).
const STOK_SEMA = ['STO_KOD', 'STO_ISIM', 'sto_Guid'];
const satir = (sira: number, miktar: number, birim: number, sku = "DYS.029") => ({
  sth_evraktip: '3', sth_evrakno_seri: '', sth_evrakno_sira: String(sira), sth_tarih: '2026-08-10T00:00:00', sth_stok_kod: sku, sth_tip: '0',
  sth_miktar: String(miktar), sth_tutar: String(miktar * birim), sth_vergi: String(miktar * birim * 0.2), sth_vergi_pntr: '4', sth_iptal: '0',
});
const DAYSON = [...[301, 302, 303, 304, 305, 306].map((s, i) => satir(s, 100, 128 + i)), satir(410, 10, 3125), satir(394, 5, 3229)];
const B410 = { cha_evrakno_seri: '', cha_evrakno_sira: 410, cha_tip: 1, cha_meblag: 37500, cha_iptal: 0, cha_tarihi: '2026-09-01T00:00:00', cha_kod: '320.01.0042' };
const kur = (satirlar: Record<string, unknown>[], basliklar: Record<string, unknown>[], adlar: Record<string, unknown>[] | { hata: string } = []) => {
  vi.mocked(mikroKolonlar).mockImplementation(async (tablo: string) => (tablo === 'STOKLAR' ? STOK_SEMA : SEMA));
  vi.mocked(mikroSql)
    .mockResolvedValueOnce({ rows: satirlar, hata: null })
    .mockResolvedValueOnce({ rows: basliklar, hata: null })
    .mockResolvedValueOnce(Array.isArray(adlar) ? { rows: adlar, hata: null } : { rows: [], hata: adlar.hata });
};
type Govde = { success: boolean; kesildi: boolean; adHatasi: string | null; satirlar: Array<Record<string, unknown>>; ozet: Record<string, unknown> };

describe('GET /api/mikro/birim-sapmasi', () => {
  it('jeton kapısı: tanımsız 503, yanlış 401, SORGU DİZESİNDEKİ jeton kabul edilmez (IIS günlüğüne düşerdi)', async () => {
    delete process.env.OPS_SUMMARY_TOKEN;
    expect((await cagir()).kod).toBe(503);
    process.env.OPS_SUMMARY_TOKEN = JETON;
    expect((await cagir({ 'x-ops-token': 'yanlis' })).kod).toBe(401);
    expect((await cagir({}, { token: JETON })).kod).toBe(401);
    expect(mikroSql).not.toHaveBeenCalled();
    expect(mikroKolonlar).not.toHaveBeenCalled();
  });

  it('DAYSON: evrak 410 ve 394 listelenir, ürün adı STOKLAR\'dan, cari başlıktan; hiçbir yazım yok', async () => {
    kur(DAYSON, [B410], [{ kod: 'DYS.029', ad: 'DAYSON DUŞ SETİ' }]);
    const r = await cagir();
    expect(r.kod).toBe(200);
    const g = r.govde as Govde;
    expect(g).toMatchObject({ success: true, kesildi: false, adHatasi: null });
    expect(g.satirlar.map(s => s.evrakNo).sort()).toEqual(['394', '410']);
    expect(g.satirlar.every(s => s.ad === 'DAYSON DUŞ SETİ' && s.yon === 'alis')).toBe(true);
    expect(g.satirlar.find(s => s.evrakNo === '410')?.cariKod).toBe('320.01.0042');
    expect(g.ozet).toMatchObject({ incelenenSatir: 8, sapanSatir: 2, sapanFatura: 2, degerlendirilenUrun: 1 });
    expect(d.yazilan).toEqual([]);
    expect(mikroPost).not.toHaveBeenCalled();                    // Mikro'ya yazan hiçbir metot çağrılmaz
  });

  it('SQL: yalnız şemadan gelen kolonlar; TÜM iptalsiz fatura satırları (iskonto süzgeci YOK); tüm fatura başlıkları', async () => {
    kur([], []);
    await cagir();
    const [satirSql] = vi.mocked(mikroSql).mock.calls[0] as [string];
    const [baslikSql] = vi.mocked(mikroSql).mock.calls[1] as [string];
    expect(satirSql).toMatch(/^SELECT TOP 50000 sth_evraktip, /);
    expect(satirSql).toContain('sth_iskonto1, sth_masraf1');
    expect(satirSql).not.toMatch(/sth_isk_mas1|sth_aciklama/);
    expect(satirSql).toContain('WHERE sth_evraktip IN (3, 4) AND ISNULL(sth_iptal, 0) = 0 ORDER BY sth_tarih DESC, sth_evrakno_seri, sth_evrakno_sira DESC');
    expect(satirSql).not.toContain('EXISTS');
    expect(baslikSql).toContain('WHERE (cha.cha_evrak_tip = 63 OR (cha.cha_evrak_tip = 0 AND cha.cha_cinsi = 6))');
    expect(baslikSql).not.toContain('EXISTS');
    expect(vi.mocked(mikroSql).mock.calls).toHaveLength(2);      // liste boş → ad sorgusu YOK
    expect(mikroKolonlar).not.toHaveBeenCalledWith('STOKLAR');
  });

  it('ağır okumalar uzun zaman aşımıyla (listeZamanAsimiMs), global 30 sn ile DEĞİL', async () => {
    kur([], []);
    await cagir();
    for (const c of vi.mocked(mikroSql).mock.calls) expect((c[1] as { zamanAsimiMs: number }).zamanAsimiMs).toBeGreaterThanOrEqual(120000);
  });

  it('ad sorgusu: şemadaki GERÇEK kolon yazımıyla, yalnız listedeki ürünler, tek tırnak kaçırılmış', async () => {
    const tirnakli = [...[1, 2, 3, 4, 5, 6].map(s => satir(800 + s, 10, 50, "O'NEIL-1")), satir(899, 1, 1200, "O'NEIL-1")];
    kur([...DAYSON, ...tirnakli], [B410], []);
    await cagir();
    const [adSql] = vi.mocked(mikroSql).mock.calls[2] as [string];
    expect(adSql).toMatch(/^SELECT STO_KOD AS kod, STO_ISIM AS ad FROM STOKLAR WHERE STO_KOD IN \(/);
    expect(adSql).toContain("N'O''NEIL-1'");
    expect(adSql).toContain("N'DYS.029'");
    expect((adSql.match(/N'/g) ?? []).length).toBe(2);           // ürün başına bir kez, satır başına değil
  });

  it('ad okunamazsa rapor DÜŞMEZ: ad null + adHatasi; STOKLAR şemasında ad kolonu yoksa sorgu atılmaz', async () => {
    kur(DAYSON, [B410], { hata: 'Timeout' });
    const g = (await cagir()).govde as Govde;
    expect(g).toMatchObject({ success: true, adHatasi: 'Timeout' });
    expect(g.satirlar).toHaveLength(2);
    expect(g.satirlar.every(s => s.ad === null)).toBe(true);

    vi.mocked(mikroSql).mockReset();
    vi.mocked(mikroKolonlar).mockImplementation(async (tablo: string) => (tablo === 'STOKLAR' ? ['sto_kod'] : SEMA));
    vi.mocked(mikroSql).mockResolvedValueOnce({ rows: DAYSON, hata: null }).mockResolvedValueOnce({ rows: [B410], hata: null });
    const g2 = (await cagir()).govde as Govde;
    expect(g2.adHatasi).toContain('sto_isim');
    expect(vi.mocked(mikroSql).mock.calls).toHaveLength(2);
  });

  it('şema okunamadıysa 502 (sahte "kolon yok" yok); temel kolon eksikse 500 eksik adıyla; SQL hatası 502', async () => {
    vi.mocked(mikroKolonlar).mockResolvedValueOnce([]);
    const bos = await cagir();
    expect(bos.kod).toBe(502);
    expect(String((bos.govde as { error: string }).error)).toContain('şeması okunamadı');
    vi.mocked(mikroKolonlar).mockResolvedValueOnce(TEMEL_SATIR_KOLONLARI.filter(k => k !== 'sth_miktar'));
    const eksik = await cagir();
    expect(eksik.kod).toBe(500);
    expect(String((eksik.govde as { error: string }).error)).toContain('sth_miktar');
    expect(mikroSql).not.toHaveBeenCalled();
    vi.mocked(mikroKolonlar).mockResolvedValue(SEMA);
    vi.mocked(mikroSql).mockResolvedValueOnce({ rows: [], hata: 'Invalid column name' });
    const hata = await cagir();
    expect(hata.kod).toBe(502);
    expect(String((hata.govde as { error: string }).error)).toContain('Invalid column name');
  });

  it('sınıra dayanan sonuç kesildi: true', async () => {
    const cok = Array.from({ length: 50000 }, (_, i) => satir(100000 + i, 1, 10, `U${i % 7}`));
    kur(cok, []);
    expect((await cagir()).govde).toMatchObject({ success: true, kesildi: true,
      ozet: { incelenenSatir: 50000, urun: null, degerlendirilenUrun: null, degerlendirilemeyenUrun: null } });
    vi.mocked(mikroSql).mockReset();                               // ilk koşunun kullanılmayan ad yanıtı kuyrukta kalmasın
    kur(DAYSON, [B410], []);
    expect(((await cagir()).govde as Govde).ozet).toMatchObject({ urun: 1, degerlendirilenUrun: 1 });
  });
});
