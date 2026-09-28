/**
 * GET /api/mikro/ebelge-durum-tani — GİB durum yanıtını ÖLÇER (kullanıcı 2026-09-25: "GİB'den kabul edilmeyen faturaları da
 * çekelim"). SALT OKUMA: Mikro'ya yalnız EBelgeDurumSorgulamaV2 (sorgu), Cetpa'ya hiçbir yazım; kolonlar şemadan.
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
let d: Duzenek;
beforeEach(() => {
  process.env.OPS_SUMMARY_TOKEN = JETON;
  d = duzenekKur();
  vi.mocked(v17MetoduKullanilabilir).mockResolvedValue(true);
  vi.mocked(mikroSql).mockReset();
  vi.mocked(mikroKolonlar).mockReset();
  vi.mocked(mikroPost).mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
  if (yedek === undefined) delete process.env.OPS_SUMMARY_TOKEN; else process.env.OPS_SUMMARY_TOKEN = yedek;
});

const YOL = '/api/mikro/ebelge-durum-tani';
const cagir = (headers: Record<string, string> = { 'x-ops-token': JETON }, query: Record<string, unknown> = {}) =>
  d.cagir('GET', YOL, undefined, undefined, { headers, query });
// Şemadaki GERÇEK yazım: Türkçe harmanlamada 'cha_ebelge_Islemturu' küçük harfle yazılırsa kolon bulunmaz.
const CHA = ['cha_tip', 'cha_evrak_tip', 'cha_cinsi', 'cha_iptal', 'cha_meblag', 'cha_uuid', 'cha_ebelge_turu', 'cha_efatura_belge_tipi', 'cha_ebelge_Islemturu'];
const KUYRUK = ['kyr_Guid', 'kyr_create_date', 'kyr_durum'];
const ETTN1 = '3F2504E0-4F89-11D3-9A0C-0305E82C3301', ETTN2 = '9A0C0305-E82C-3301-3F25-04E04F8911D3';
const tablolar = (cha = CHA, kuyruk = KUYRUK) => vi.mocked(mikroKolonlar).mockImplementation(async (t: string) => (t === 'CARI_HESAP_HAREKETLERI' ? cha : t === 'EBELGE_GONDERIM_KUYRUK_LOG' ? kuyruk : []));
// Sıra: kuyruk sayısı, kuyruk son 10, dağılım, örnek (kuyruk durum sorgularından ÖNCE okunur).
const sql = (...yanitlar: Array<Record<string, unknown>[] | string | Error>) => {
  for (const y of yanitlar) {
    if (y instanceof Error) vi.mocked(mikroSql).mockRejectedValueOnce(y);
    else vi.mocked(mikroSql).mockResolvedValueOnce(typeof y === 'string' ? { rows: [], hata: y } : { rows: y, hata: null });
  }
};
const ok = (Data: unknown) => ({ ok: true, status: 200, data: { result: [{ IsError: false, Data }] } });
const red = (msg: string) => ({ ok: true, status: 200, data: { result: [{ IsError: true, ErrorMessage: msg }] } });
const zamanAsimi = () => Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
type Deneme = Record<string, unknown>;
type Govde = { success: boolean; eksikKolonlar: string[]; dagilim: unknown; ornekHata: string | null;
  ornekler: Array<Record<string, unknown> & { denemeler: Deneme[]; atlanan?: Deneme[] }>; kuyruk: Record<string, unknown>; baslangic: string; sureler: Record<string, number> };

describe('GET /api/mikro/ebelge-durum-tani', () => {
  it('jeton kapısı: tanımsız 503, yanlış 401, sorgu dizesindeki jeton kabul edilmez; Mikro\'ya hiç gidilmez', async () => {
    delete process.env.OPS_SUMMARY_TOKEN;
    expect((await cagir()).kod).toBe(503);
    process.env.OPS_SUMMARY_TOKEN = JETON;
    expect((await cagir({ 'x-ops-token': 'yanlis' })).kod).toBe(401);
    expect((await cagir({}, { token: JETON })).kod).toBe(401);
    expect(mikroSql).not.toHaveBeenCalled();
    expect(mikroPost).not.toHaveBeenCalled();
  });

  it('SQL: kuyruk ÖNCE; kolonlar GERÇEK yazımıyla; ETTN metne çevrilerek karşılaştırılır; örnek yalnız iptalsiz ETTN\'li GİDEN, grup başına 2, en çok 8', async () => {
    tablolar();
    sql([{ adet: 0 }], [], [], []);
    await cagir();
    const sqller = vi.mocked(mikroSql).mock.calls.map(c => c[0] as string);
    expect(sqller[0]).toBe('SELECT COUNT(*) AS adet FROM EBELGE_GONDERIM_KUYRUK_LOG');
    expect(sqller[1]).toBe('SELECT TOP 10 * FROM EBELGE_GONDERIM_KUYRUK_LOG ORDER BY kyr_create_date DESC');
    const [, , dagilimSql, ornekSql] = sqller;
    expect(dagilimSql).toContain('cha.cha_ebelge_Islemturu AS cha_ebelge_Islemturu');
    expect(dagilimSql).not.toContain('cha_ebelge_islemturu');
    expect(dagilimSql).toContain('WHERE (cha.cha_evrak_tip = 63 OR (cha.cha_evrak_tip = 0 AND cha.cha_cinsi = 6))');
    expect(dagilimSql).toContain("CASE WHEN ISNULL(CAST(cha.cha_uuid AS nvarchar(40)), '') = '' THEN 0 ELSE 1 END AS ettnVar");
    expect(ornekSql).toMatch(/^SELECT TOP 8 \* FROM \(/);
    expect(ornekSql).toContain('AND cha.cha_tip = 0 AND ISNULL(cha.cha_iptal, 0) = 0');
    expect(ornekSql).toContain("AND ISNULL(CAST(cha.cha_uuid AS nvarchar(40)), '') <> ''");
    expect(ornekSql).toContain('PARTITION BY cha.cha_ebelge_turu, cha.cha_efatura_belge_tipi, cha.cha_ebelge_Islemturu ');
    expect(ornekSql).toContain('WHERE t.sn <= 2');
    for (const c of vi.mocked(mikroSql).mock.calls) expect(c[1]).toEqual({ zamanAsimiMs: 20000 });
  });

  it('durum sorgusu: her ETTN için EBelgeTipi 0 VE 1 (ilk başarıda DURMAZ — tür eşlemesi ölçülmüş sayılmaz); süre yazılır; yazım yok', async () => {
    tablolar();
    sql([{ adet: 3 }], [{ kyr_durum: 2 }], [{ cha_tip: 0, adet: 5 }], [{ cha_evrakno_sira: 101, ettn: ETTN1 }, { cha_evrakno_sira: 102, ettn: ETTN2 }]);
    vi.mocked(mikroPost)
      .mockResolvedValueOnce(ok({ Durum: 'KABUL' })).mockResolvedValueOnce(ok(null))
      .mockResolvedValueOnce(red('Belge bulunamadı')).mockResolvedValueOnce(ok({ Durum: 'RAPORLANDI' }));
    const g = (await cagir()).govde as Govde;
    expect(g.success).toBe(true);
    expect(vi.mocked(mikroPost).mock.calls.map(c => [c[0], (c[1] as { EBelge: Record<string, unknown> }).EBelge, c[2], c[3]])).toEqual([
      ['EBelgeDurumSorgulamaV2', { EFaturaTipi: 0, EBelgeTipi: 0, UUID: ETTN1 }, true, { zamanAsimiMs: 15000 }],
      ['EBelgeDurumSorgulamaV2', { EFaturaTipi: 0, EBelgeTipi: 1, UUID: ETTN1 }, true, { zamanAsimiMs: 15000 }],
      ['EBelgeDurumSorgulamaV2', { EFaturaTipi: 0, EBelgeTipi: 0, UUID: ETTN2 }, true, { zamanAsimiMs: 15000 }],
      ['EBelgeDurumSorgulamaV2', { EFaturaTipi: 0, EBelgeTipi: 1, UUID: ETTN2 }, true, { zamanAsimiMs: 15000 }],
    ]);
    expect(g.ornekler[0].denemeler.map(x => [x.eBelgeTipi, x.isError, x.dataHam])).toEqual([[0, false, '{"Durum":"KABUL"}'], [1, false, 'null']]);
    expect(g.ornekler[1].denemeler.map(x => [x.eBelgeTipi, x.isError, x.hata])).toEqual([[0, true, 'Belge bulunamadı'], [1, false, null]]);
    for (const o of g.ornekler) for (const x of o.denemeler) expect(typeof x.sureMs).toBe('number');
    expect(g.kuyruk).toMatchObject({ siralama: 'kyr_create_date', adet: [{ adet: 3 }], son: [{ kyr_durum: 2 }] });
    expect(typeof g.baslangic).toBe('string');
    expect(d.yazilan).toEqual([]);
  });

  it('zaman aşımı "tip reddi" değil: tip 0 zaman aşımına uğrarsa aynı ETTN\'nin tip 1\'i SORULMAZ, atlanan\'a yazılır; diğer fatura sürer', async () => {
    tablolar();
    sql([{ adet: 0 }], [], [], [{ cha_evrakno_sira: 1, ettn: ETTN1 }, { cha_evrakno_sira: 2, ettn: ETTN2 }]);
    vi.mocked(mikroPost).mockRejectedValueOnce(zamanAsimi()).mockResolvedValueOnce(ok({})).mockResolvedValueOnce(ok({}));
    const g = (await cagir()).govde as Govde;
    expect(g.ornekler[0].denemeler.map(x => [x.eBelgeTipi, x.hata])).toEqual([[0, 'TimeoutError: The operation was aborted due to timeout']]);
    expect(g.ornekler[0].atlanan).toEqual([{ eBelgeTipi: 1, neden: 'tip 0 zaman aşımı — tip reddi değil' }]);
    expect(g.ornekler[1].denemeler).toHaveLength(2);
    expect(mikroPost).toHaveBeenCalledTimes(3);
  });

  it('süre bütçesi İSTEK BAŞINDAN (100 sn): kalan < 15 sn olunca durum sorgusu YAPILMAZ, atlanan "süre bütçesi doldu" (ARR 502\'den önce dürüst kısmi sonuç)', async () => {
    tablolar();
    sql([{ adet: 0 }], [], [], [{ cha_evrakno_sira: 1, ettn: ETTN1 }, { cha_evrakno_sira: 2, ettn: ETTN2 }]);
    let saat = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => saat);
    vi.mocked(mikroPost).mockImplementation(async () => { saat += 31000; return ok({}); });   // her çağrı 31 sn sürüyor
    const g = (await cagir()).govde as Govde;
    expect(mikroPost).toHaveBeenCalledTimes(3);                                                 // 0 → 31 → 62 → 93 (kalan 7 < 15) → dur
    expect(g.ornekler[0].denemeler).toHaveLength(2);
    expect(g.ornekler[1].denemeler.map(x => x.eBelgeTipi)).toEqual([0]);
    expect(g.ornekler[1].atlanan).toEqual([{ eBelgeTipi: 1, neden: 'süre bütçesi doldu' }]);
    expect(g.sureler).toMatchObject({ durumMs: 93000, toplamMs: 93000 });
  });

  it('bütçe ÖNCEKİ okumaları da kapsar: şema okuması bütçeyi yerse SQL okumaları ve durum sorguları yapılmaz, yanıt yine 200', async () => {
    let saat = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => saat);
    vi.mocked(mikroKolonlar).mockImplementation(async (t: string) => { saat += 49000; return t === 'CARI_HESAP_HAREKETLERI' ? CHA : KUYRUK; });  // 2 × 49 sn
    const r = await cagir();
    expect(r.kod).toBe(200);
    const g = r.govde as Govde;
    expect(mikroSql).not.toHaveBeenCalled();
    expect(mikroPost).not.toHaveBeenCalled();
    expect(g.kuyruk).toMatchObject({ adet: { hata: 'süre bütçesi doldu — okunmadı' }, son: { hata: 'süre bütçesi doldu — okunmadı' } });
    expect(g.dagilim).toEqual({ hata: 'süre bütçesi doldu — okunmadı' });
    expect(g.ornekHata).toBe('süre bütçesi doldu — okunmadı');
  });

  it('SQL zaman aşımı KALAN süreyle sınırlı: 88 sn geçtiyse okuma 12 sn ile istenir', async () => {
    let saat = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => saat);
    vi.mocked(mikroKolonlar).mockImplementation(async (t: string) => { saat += 44000; return t === 'CARI_HESAP_HAREKETLERI' ? CHA : KUYRUK; });
    vi.mocked(mikroSql).mockResolvedValue({ rows: [], hata: null });
    await cagir();
    expect(vi.mocked(mikroSql).mock.calls[0][1]).toEqual({ zamanAsimiMs: 12000 });
  });

  it('geçersiz / sıfır ETTN Mikro\'ya GÖNDERİLMEZ; mikroPost başka hatayla fırlatırsa kayda geçer, öbür tip yine sorulur', async () => {
    tablolar();
    sql([{ adet: 0 }], [], [], [{ cha_evrakno_sira: 1, ettn: 'SZN2026000001284' }, { cha_evrakno_sira: 3, ettn: '00000000-0000-0000-0000-000000000000' }, { cha_evrakno_sira: 2, ettn: ETTN1 }]);
    vi.mocked(mikroPost).mockRejectedValueOnce(new Error('ECONNRESET')).mockResolvedValueOnce(ok({}));
    const g = (await cagir()).govde as Govde;
    expect(g.ornekler[0]).toMatchObject({ ettnGecerli: false, denemeler: [] });
    expect(g.ornekler[1]).toMatchObject({ ettnGecerli: false, denemeler: [] });
    expect(g.ornekler[2].denemeler.map(x => [x.eBelgeTipi, x.hata])).toEqual([[0, 'Error: ECONNRESET'], [1, null]]);
    expect(mikroPost).toHaveBeenCalledTimes(2);
  });

  it('bir okuma FIRLATIRSA tanının geri kalanı döner (500 değil): kuyruk sayısı zaman aşımı, dağılım yine gelir', async () => {
    tablolar();
    sql(zamanAsimi(), [{ kyr_durum: 1 }], [{ adet: 7 }], new Error('SqlVeriOkuV2 koptu'));
    const r = await cagir();
    expect(r.kod).toBe(200);
    const g = r.govde as Govde;
    expect(g.kuyruk.adet).toEqual({ hata: 'TimeoutError: The operation was aborted due to timeout' });
    expect(g.kuyruk.son).toEqual([{ kyr_durum: 1 }]);
    expect(g.dagilim).toEqual([{ adet: 7 }]);
    expect(g.ornekHata).toBe('Error: SqlVeriOkuV2 koptu');
  });

  it('kuyruk hücreleri kısaltılır (uzun metin / ikili alan yanıtı şişirmez)', async () => {
    tablolar();
    sql([{ adet: 1 }], [{ kyr_xml: 'z'.repeat(1000), kyr_durum: 4 }], [], []);
    const g = (await cagir()).govde as Govde;
    const [ilk] = g.kuyruk.son as Array<Record<string, unknown>>;
    expect(String(ilk.kyr_xml)).toMatch(/^z{300}…\(\+700\)$/);
    expect(ilk.kyr_durum).toBe(4);
  });

  it('ETTN kolonu şemada yoksa: eksik adıyla döner, sabit ifade GROUP BY\'a GİRMEZ, örnek/durum sorgusu yok', async () => {
    tablolar(CHA.filter(k => k !== 'cha_uuid'));
    sql([{ adet: 0 }], [], []);
    const g = (await cagir()).govde as Govde;
    expect(g.eksikKolonlar).toEqual(['cha_uuid']);
    const dagilimSql = vi.mocked(mikroSql).mock.calls[2][0] as string;
    expect(dagilimSql).toMatch(/GROUP BY cha\.cha_tip, cha\.cha_ebelge_turu, cha\.cha_efatura_belge_tipi, cha\.cha_ebelge_Islemturu, ISNULL\(cha\.cha_iptal, 0\) ORDER BY/);
    expect(dagilimSql).not.toContain('ettnVar');
    expect(mikroPost).not.toHaveBeenCalled();
    expect(g.ornekler).toEqual([]);
  });

  it('şema okunamadıysa 502; kuyruk tablosu okunamazsa okunamadi: true, tanının geri kalanı döner', async () => {
    vi.mocked(mikroKolonlar).mockResolvedValueOnce([]);
    expect((await cagir()).kod).toBe(502);
    tablolar(CHA, []);
    sql([{ adet: 1 }], []);
    const g = (await cagir()).govde as Govde;
    expect(g.kuyruk).toMatchObject({ okunamadi: true, kolonlar: [] });
    expect(g.dagilim).toEqual([{ adet: 1 }]);
  });
});
