/**
 * GET /api/mikro/fatura-tani — "fatura Mikro'da iptal oldu, Cetpa'da duruyor" (389, kullanıcı 2026-10-02) ÖLÇÜMÜ.
 * Cetpa kopyaları ↔ Mikro'nun güncel fatura kümesi. SALT OKUMA, jeton yalnız başlıkta, GUID kolonu şemadan.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { duzenekKur, type Duzenek } from './mikroRoutes.testDuzenegi';
import { mikroPost, mikroSql, mikroKolonlar, v17MetoduKullanilabilir } from '../mikroClient.js';

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
const G = (n: number) => `AAAAAAAA-0000-0000-0000-${String(n).padStart(12, '0')}`;
// Türkçe harmanlamada kolonun GERÇEK yazımı kullanılmalı (cha_Guid ≠ CHA_GUID olabilir).
const SEMA = ['CHA_GUID', 'cha_tip', 'cha_iptal', 'cha_uuid', 'cha_ebelge_turu', 'cha_ebelge_Islemturu'];
// Mikro uniqueidentifier değerini SÜSLÜ PARANTEZLE döndürür (canlı ölçüm 2026-10-02: kimlikler 38 karakter) — fikstür gerçek biçimde.
const P = (n: number) => `{${G(n)}}`;
const kopya = (n: number, o: Record<string, unknown> = {}) => ({
  id: P(n), companyId: 'K1', seri: '', sira: String(n), tip: '0', tarih: `2026-09-${String(n % 28 + 1).padStart(2, '0')}T00:00:00`, meblag: '8500', guncelleme: '2026-09-30 03:20:00+03', ...o,
});
let d: Duzenek;
let pgSorgulari: string[];
const pgKur = (satirlar: Record<string, unknown>[]) => {
  pgSorgulari = [];
  d.pgAyarla(async (sql) => { pgSorgulari.push(sql); return { rows: satirlar }; });
};
beforeEach(() => {
  process.env.OPS_SUMMARY_TOKEN = JETON;
  d = duzenekKur();
  vi.mocked(v17MetoduKullanilabilir).mockResolvedValue(true);
  vi.mocked(mikroSql).mockReset();
  vi.mocked(mikroKolonlar).mockReset();
  vi.mocked(mikroPost).mockReset();
  vi.mocked(mikroKolonlar).mockResolvedValue(SEMA);
});
afterEach(() => { if (yedek === undefined) delete process.env.OPS_SUMMARY_TOKEN; else process.env.OPS_SUMMARY_TOKEN = yedek; });

const YOL = '/api/mikro/fatura-tani';
const cagir = (headers: Record<string, string> = { 'x-ops-token': JETON }, query: Record<string, unknown> = {}) =>
  d.cagir('GET', YOL, undefined, undefined, { headers, query });
type Govde = Record<string, unknown> & { yetim: Array<Record<string, unknown>>; evrak: Record<string, unknown> | null };

describe('GET /api/mikro/fatura-tani', () => {
  it('jeton kapısı: tanımsız 503, yanlış 401, sorgu dizesindeki jeton 401 — Mikro\'ya ve PG\'ye dokunulmaz', async () => {
    pgKur([]);
    delete process.env.OPS_SUMMARY_TOKEN;
    expect((await cagir()).kod).toBe(503);
    process.env.OPS_SUMMARY_TOKEN = JETON;
    expect((await cagir({ 'x-ops-token': 'yanlis' })).kod).toBe(401);
    expect((await cagir({}, { token: JETON })).kod).toBe(401);
    expect(mikroSql).not.toHaveBeenCalled();
    expect(mikroKolonlar).not.toHaveBeenCalled();
    expect(mikroPost).not.toHaveBeenCalled();
    expect(pgSorgulari).toEqual([]);
  });

  it('PG yoksa 503; sira rakam değilse 400 (SQL\'e girmez); şema okunamazsa 502', async () => {
    d.pgAyarla(null);
    expect((await cagir()).kod).toBe(503);
    pgKur([]);
    for (const sira of ['389; DROP TABLE x', '-1', '1234567890', ['389']]) expect((await cagir(undefined, { sira })).kod).toBe(400);
    expect(mikroSql).not.toHaveBeenCalled();
    vi.mocked(mikroKolonlar).mockResolvedValue([]);
    expect((await cagir()).kod).toBe(502);
  });

  it('Mikro listesi BOŞ dönerse yetim hesabı YAPILMAZ (okunamayan Mikro her kopyayı yetim gösterirdi)', async () => {
    pgKur([kopya(389)]);
    vi.mocked(mikroSql).mockResolvedValueOnce({ rows: [], hata: null });
    const y = await cagir();
    expect(y.kod).toBe(502);
    expect(pgSorgulari).toEqual([]);
  });

  it('silinen fatura YETİM çıkar; GUID kolonu şemadaki yazımıyla; yetim kimlik Mikro\'da başka evrak tipiyle aranır', async () => {
    pgKur([kopya(388), kopya(389)]);
    vi.mocked(mikroSql)
      .mockResolvedValueOnce({ rows: [{ guid: P(388), iptal: false }], hata: null })
      .mockResolvedValueOnce({ rows: [], hata: null });
    const y = await cagir();
    expect(y.kod).toBe(200);
    const g = y.govde as Govde;
    expect(g).toMatchObject({ cetpaAdet: 2, mikroAdet: 1, yetimAdet: 1, iptalKalanAdet: 0, yetimMikroDurumu: [], evrak: null });
    expect(g.yetim.map(f => f.sira)).toEqual(['389']);
    const [ilk, ikinci] = vi.mocked(mikroSql).mock.calls.map(c => c[0]);
    expect(ilk).toBe("SELECT cha.CHA_GUID AS guid, ISNULL(cha.cha_iptal, 0) AS iptal FROM CARI_HESAP_HAREKETLERI cha "
      + 'WHERE (cha.cha_evrak_tip = 63 OR (cha.cha_evrak_tip = 0 AND cha.cha_cinsi = 6))');
    // Süslü parantez SOYULUR: soyulmasa biçim denetimi kimliği eler ve bu sorgu hiç koşmazdı (ilk canlı ölçümdeki boş sonuç).
    expect(ikinci).toContain(`WHERE cha.CHA_GUID IN ('${G(389).toLowerCase()}')`);
    expect(pgSorgulari).toHaveLength(1);
    expect(pgSorgulari[0]).toMatch(/^SELECT id, /);
    expect(d.yazilan).toEqual([]);                                             // Cetpa'ya yazım yok
    for (const sql of [ilk, ikinci, ...pgSorgulari]) expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|MERGE|DROP)\b/i);
  });

  it('GUID biçiminde olmayan kopya kimliği Mikro SQL\'ine GİRMEZ', async () => {
    pgKur([kopya(1, { id: "x' OR 1=1 --" })]);
    vi.mocked(mikroSql).mockResolvedValueOnce({ rows: [{ guid: G(9), iptal: 0 }], hata: null });
    const g = (await cagir()).govde as Govde;
    expect(g.yetimAdet).toBe(1);
    expect(mikroSql).toHaveBeenCalledTimes(1);                                 // ikinci (IN listeli) sorgu hiç koşmadı
  });

  it('?sira=389: Mikro başlıkları fatura koşulu bayrağıyla, Cetpa kopyası, giden faturada GİB durumu iki tipte de sorulur', async () => {
    pgKur([kopya(389)]);
    vi.mocked(mikroSql)
      .mockResolvedValueOnce({ rows: [{ guid: P(389), iptal: 0 }], hata: null })
      .mockResolvedValueOnce({ rows: [
        { guid: G(389), cha_tip: '0', faturaKosulu: 1, iptal: false, cha_ebelge_Islemturu: '2', ettn: 'BBBBBBBB-1111-2222-3333-444444444444' },
        { guid: G(900), cha_tip: '1', faturaKosulu: 1, iptal: false, ettn: 'CCCCCCCC-1111-2222-3333-444444444444' },   // gelen: sorulmaz
        { guid: G(901), cha_tip: '0', faturaKosulu: 0, iptal: false, ettn: 'DDDDDDDD-1111-2222-3333-444444444444' },   // fatura değil: sorulmaz
      ], hata: null });
    vi.mocked(mikroPost).mockResolvedValue({ ok: true, status: 200, data: { result: [{ StatusCode: 200, IsError: false, ErrorMessage: null,
      Data: { BelgeDurumKodu: '1006', BelgeDurumAciklamasi: 'e-Arşiv faturası imzalandı' } }] } });
    const y = await cagir(undefined, { sira: '389' });
    expect(y.kod).toBe(200);
    const e = (y.govde as Govde).evrak as { sira: number; mikro: unknown[]; cetpa: unknown[]; durumlar: Array<{ guid: string; denemeler: unknown[] }> };
    expect(e.sira).toBe(389);
    expect(e.mikro).toHaveLength(3);
    expect(e.cetpa).toHaveLength(1);
    expect(e.durumlar.map(x => x.guid)).toEqual([G(389)]);
    expect(e.durumlar[0].denemeler).toHaveLength(2);
    expect(vi.mocked(mikroPost).mock.calls.map(c => [c[0], (c[1] as { EBelge: { EBelgeTipi: number } }).EBelge.EBelgeTipi])).toEqual([
      ['EBelgeDurumSorgulamaV2', 0], ['EBelgeDurumSorgulamaV2', 1]]);
    const evrakSql = vi.mocked(mikroSql).mock.calls[1][0];
    expect(evrakSql).toContain('WHERE cha.cha_evrakno_sira = 389 ORDER BY cha.cha_tarihi DESC');
    expect(evrakSql).toContain('cha.cha_ebelge_Islemturu AS cha_ebelge_Islemturu');
    expect(evrakSql).toContain("ISNULL(CAST(cha.cha_uuid AS nvarchar(40)), '') AS ettn");
    expect(evrakSql).not.toMatch(/[^\x00-\x7F]/);
    // Evrağa bağlı Cetpa siparişleri de okunur (MF mi, Cetpa'dan mı kesilmiş; durumu) — salt okuma.
    expect(pgSorgulari).toHaveLength(2);
    expect(pgSorgulari[1]).toContain("FROM docs WHERE coll = 'orders'");
    expect(pgSorgulari[1]).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/i);
  });

  it('?ettn=<GUID>: evrak numarası bilinmeden ETTN ile bulunur; biçimsiz ETTN ya da sira ile birlikte 400', async () => {
    pgKur([kopya(3)]);
    const ETTN = '6A68A5F6-9F68-4283-9E76-0B2A878BBEAE';
    for (const query of [{ ettn: "x' OR 1=1 --" }, { ettn: ETTN, sira: '3' }, { ettn: ['a'] }]) expect((await cagir(undefined, query)).kod).toBe(400);
    expect(mikroSql).not.toHaveBeenCalled();
    vi.mocked(mikroSql)
      .mockResolvedValueOnce({ rows: [{ guid: P(3), iptal: 0 }], hata: null })
      .mockResolvedValueOnce({ rows: [{ guid: P(3), cha_tip: '1', faturaKosulu: 1, iptal: false, cha_evrakno_sira: 3, cha_ebelge_Islemturu: '2', ettn: ETTN }], hata: null });
    const y = await cagir(undefined, { ettn: `{${ETTN}}` });                    // parantezli de kabul edilir, soyulur
    expect(y.kod).toBe(200);
    const e = (y.govde as Govde).evrak as { sira: number | null; ettn: string; cetpa: unknown[] };
    expect(e).toMatchObject({ sira: null, ettn: ETTN.toLowerCase() });
    expect(e.cetpa).toHaveLength(1);                                           // Mikro'da bulunan başlığın sırasıyla (3) eşlendi
    expect(vi.mocked(mikroSql).mock.calls[1][0]).toContain(`WHERE CAST(cha.cha_uuid AS nvarchar(40)) = '${ETTN.toLowerCase()}' ORDER BY`);
  });

  it("?sira=0389: iki taraf da AYNI değeri arar (Mikro 389, Cetpa '389') — baştaki sıfır kopyayı \"yok\" göstermez", async () => {
    pgKur([kopya(389)]);
    vi.mocked(mikroSql)
      .mockResolvedValueOnce({ rows: [{ guid: P(389), iptal: 0 }], hata: null })
      .mockResolvedValueOnce({ rows: [{ guid: P(389), cha_tip: '1', faturaKosulu: 1, iptal: false, ettn: '' }], hata: null });
    const e = ((await cagir(undefined, { sira: '0389' })).govde as Govde).evrak as { sira: number; cetpa: unknown[] };
    expect(e.sira).toBe(389);
    expect(e.cetpa).toHaveLength(1);
    expect(vi.mocked(mikroSql).mock.calls[1][0]).toContain('cha.cha_evrakno_sira = 389 ORDER BY');
  });

  it('PG yanıt vermezse istek asılı kalmaz: 504 ve açık hata (bütçe PG okumasını da kapsar)', async () => {
    vi.useFakeTimers();
    try {
      d.pgAyarla(() => new Promise(() => {}));                                 // hiç dönmeyen sorgu (tıkalı havuz)
      vi.mocked(mikroSql).mockResolvedValueOnce({ rows: [{ guid: G(1), iptal: 0 }], hata: null });
      const bekleyen = cagir();
      await vi.advanceTimersByTimeAsync(20001);
      const y = await bekleyen;
      expect(y.kod).toBe(504);
      expect(String((y.govde as { error: string }).error)).toContain('PG');
    } finally { vi.useRealTimers(); }
  });
});
