/**
 * GET /api/mikro/seri-ozet — «Q serisi» işinin ADIM 0'ı: evrak serisi dağılımının ÖLÇÜMÜ (şartname Q1-7, Y14; test T8).
 * SALT OKUMA: Mikro'ya yalnız SELECT (mikroSql), Cetpa'ya yalnız SELECT; jeton yalnız başlıkta; kolonlar şemadan.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { duzenekKur, type Duzenek } from './mikroRoutes.testDuzenegi';
import { getMikroCreds, mikroPost, mikroSql, mikroKolonlar, v17MetoduKullanilabilir } from '../mikroClient.js';
import { FT_ISKONTO_ADLARI } from '../mikro/seriOzet.js';

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
// Şemadaki GERÇEK yazım (Türkçe harmanlamada 'cha_ebelge_Islemturu' küçük harfle yazılırsa kolon bulunmaz).
const CHA = ['cha_Guid', 'cha_evrakno_seri', 'cha_evrakno_sira', 'cha_evrak_tip', 'cha_cinsi', 'cha_tip', 'cha_meblag', 'cha_tarihi', 'cha_kod',
  'cha_iptal', 'cha_aratoplam', ...FT_ISKONTO_ADLARI, 'cha_vergi', 'cha_uuid', 'cha_ebelge_turu', 'cha_efatura_belge_tipi', 'cha_ebelge_Islemturu'];
const STH = ['sth_Guid', 'sth_evrakno_seri', 'sth_evrakno_sira', 'sth_evraktip', 'sth_tutar', 'sth_vergi', 'sth_vergi_pntr', 'sth_giris_depo_no',
  'sth_cikis_depo_no', 'sth_iptal'];
const olmadan = (sema: readonly string[], ...adlar: string[]) => sema.filter(k => !adlar.includes(k));
const alansiz = (satir: Record<string, unknown>, ...alanlar: string[]): Record<string, unknown> =>
  Object.fromEntries(Object.entries(satir).filter(([k]) => !alanlar.includes(k)));
const YASAK = /\b(INSERT|UPDATE|DELETE|MERGE|EXEC|EXECUTE|DROP|ALTER|TRUNCATE|CREATE|GRANT|INTO)\b/i;

let d: Duzenek;
let pgSorgulari: Array<{ sql: string; params: unknown[] | undefined }>;
const FATURA_KOPYALARI = [{ companyId: 'K1', seri: 'Q', adet: 12 }, { companyId: 'K1', seri: '', adet: 700 }];
const MF_SIPARISLERI = [{ companyId: 'K1', seri: 'Q', tur: 'boolean', deger: 'true', adet: 9 }, { companyId: 'K1', seri: 'Q', tur: 'boolean', deger: 'false', adet: 2 }];
/** PG sahtesi: sorguyu kaydeder; koleksiyon parametresine göre satır döndürür. */
const pgKur = (faturalar: Record<string, unknown>[] = FATURA_KOPYALARI, siparisler: Record<string, unknown>[] = MF_SIPARISLERI) => {
  d.pgAyarla(async (sql, params) => { pgSorgulari.push({ sql, params }); return { rows: params?.[0] === 'orders' ? siparisler : faturalar }; });
};
const tablolar = (cha: string[] = CHA, sth: string[] = STH) =>
  vi.mocked(mikroKolonlar).mockImplementation(async (t: string) => (t === 'CARI_HESAP_HAREKETLERI' ? cha : t === 'STOK_HAREKETLERI' ? sth : []));
// Mikro okuma sırası: (1) seriler, (2) e-belge, (3a) başlıklar, (3b) satırlar.
const sql = (...yanitlar: Array<Record<string, unknown>[] | string | Error>) => {
  for (const y of yanitlar) {
    if (y instanceof Error) vi.mocked(mikroSql).mockRejectedValueOnce(y);
    else vi.mocked(mikroSql).mockResolvedValueOnce(typeof y === 'string' ? { rows: [], hata: y } : { rows: y, hata: null });
  }
};
const SERILER = [{ seri: 'Q', evrakTip: 63, cinsi: 7, tip: 0, adet: 12, toplam: 120000, enEski: '2025-03-01T00:00:00', enYeni: '2026-10-01T00:00:00', iptalAdet: 0, iptalToplam: null },
  { seri: '', evrakTip: 63, cinsi: 6, tip: 1, adet: 700, toplam: 9000000, enEski: '2025-01-02T00:00:00', enYeni: '2026-10-09T00:00:00', iptalAdet: 0, iptalToplam: null }];
const EBELGE = [{ cha_ebelge_turu: 0, cha_efatura_belge_tipi: 0, cha_ebelge_Islemturu: 0, ettnVar: 0, iptal: false, adet: 12 }];
const BASLIKLAR = [
  { sira: 15, seri: 'Q', tarih: '2026-10-01T00:00:00', cariKod: '120.01.001', evrakTip: 63, cinsi: 7, tip: 0, meblag: 12000, araToplam: 10000, vergi: 2000,
    ...Object.fromEntries(FT_ISKONTO_ADLARI.map(k => [k, 0])), cha_ebelge_turu: 0, cha_efatura_belge_tipi: 0, cha_ebelge_Islemturu: 0, ettnVar: 0, iptal: false },
  { sira: 14, seri: 'Q', tarih: '2026-09-28T00:00:00', cariKod: '120.01.002', evrakTip: 63, cinsi: 7, tip: 0, meblag: 500, araToplam: 500, vergi: 0,
    ...Object.fromEntries(FT_ISKONTO_ADLARI.map(k => [k, 0])), cha_ebelge_turu: 0, cha_efatura_belge_tipi: 0, cha_ebelge_Islemturu: 0, ettnVar: 0, iptal: false },
];
const SATIRLAR = [
  { sira: 15, evraktip: 4, vergiPntr: 4, girisDepo: 2, cikisDepo: 2, iptal: false, adet: 3, tutar: 10000, tutarBos: 0, vergi: 2000, vergiBos: 0 },
  { sira: 14, evraktip: 4, vergiPntr: 1, girisDepo: 2, cikisDepo: 2, iptal: false, adet: 1, tutar: 500, tutarBos: 0, vergi: 0, vergiBos: 0 },
];
const mikroSqlleri = () => vi.mocked(mikroSql).mock.calls.map(c => c[0] as string);

beforeEach(() => {
  process.env.OPS_SUMMARY_TOKEN = JETON;
  d = duzenekKur();
  pgSorgulari = [];
  vi.mocked(getMikroCreds).mockReset();
  vi.mocked(getMikroCreds).mockResolvedValue({ firmaKodu: 'F' } as Awaited<ReturnType<typeof getMikroCreds>>);
  vi.mocked(v17MetoduKullanilabilir).mockResolvedValue(true);
  vi.mocked(mikroSql).mockReset();
  vi.mocked(mikroSql).mockResolvedValue({ rows: [], hata: null });
  vi.mocked(mikroKolonlar).mockReset();
  vi.mocked(mikroPost).mockReset();
});
afterEach(() => {
  // HER senaryoda (hata / eksik kolon / bütçe dâhil) rota üzerinden çıkan her Mikro SQL'i ve PG sorgusu salt okunur tek deyimdir.
  for (const s of [...vi.mocked(mikroSql).mock.calls.map(c => String(c[0])), ...pgSorgulari.map(p => p.sql)]) {
    expect(s).toMatch(/^SELECT /);
    expect(s).not.toMatch(YASAK);
    expect(s).not.toContain(';');
  }
  vi.restoreAllMocks();
  if (yedek === undefined) delete process.env.OPS_SUMMARY_TOKEN; else process.env.OPS_SUMMARY_TOKEN = yedek;
});

const YOL = '/api/mikro/seri-ozet';
const cagir = (headers: Record<string, string> = { 'x-ops-token': JETON }, query: Record<string, unknown> = {}) =>
  d.cagir('GET', YOL, undefined, undefined, { headers, query });
type Bolum = Record<string, unknown> & { satirlar?: Array<Record<string, unknown>>; hata?: string; atlandi?: string; atlananAlanlar?: Record<string, string> };
type Govde = { success: boolean; seri: string; sureMs: number; sureler: Record<string, number>; eksikKolonlar: string[]; semaOkunamadi: string[];
  hataliBolumler: string[]; seriler: Bolum; eBelge: Bolum; sonBasliklar: Bolum & { satirOzeti?: Record<string, unknown> };
  cetpa: { mikroFaturalar: Record<string, unknown>; siparisler: Record<string, unknown> } };

describe('GET /api/mikro/seri-ozet', () => {
  it('zincir BOŞ: tek halka işleyicinin kendisi (kimlik / rol ara katmanı yok — kapı ops jetonu)', () => {
    expect(d.app.zincirler[`GET ${YOL}`]).toHaveLength(1);
  });

  it('jeton kapısı: tanımsız 503, jetonsuz 401, yanlış 401, sorgu dizesindeki jeton 401 — Mikro\'ya ve PG\'ye dokunulmaz', async () => {
    pgKur();
    delete process.env.OPS_SUMMARY_TOKEN;
    expect((await cagir()).kod).toBe(503);
    process.env.OPS_SUMMARY_TOKEN = JETON;
    expect((await cagir({})).kod).toBe(401);
    expect((await cagir({ 'x-ops-token': 'yanlis' })).kod).toBe(401);
    expect((await cagir({}, { token: JETON })).kod).toBe(401);
    expect((await cagir({}, { token: JETON, seri: 'Q' })).kod).toBe(401);
    expect(getMikroCreds).not.toHaveBeenCalled();
    expect(mikroSql).not.toHaveBeenCalled();
    expect(mikroKolonlar).not.toHaveBeenCalled();
    expect(mikroPost).not.toHaveBeenCalled();
    expect(pgSorgulari).toEqual([]);
  });

  it('Mikro yapılandırılmamışsa 503 (notConfigured) — hiçbir okuma yapılmaz', async () => {
    pgKur();
    vi.mocked(getMikroCreds).mockResolvedValue(null);
    const y = await cagir();
    expect(y.kod).toBe(503);
    expect(y.govde).toEqual({ success: false, notConfigured: true });
    expect(mikroKolonlar).not.toHaveBeenCalled();
    expect(pgSorgulari).toEqual([]);
  });

  it('seri biçimi bozuksa 400: SQL\'e de PG\'ye de GİRMEZ', async () => {
    pgKur();
    tablolar();
    for (const seri of ['Q;DROP', 'Q'.repeat(21), 'Ş', 'QÜ', 'Q Q', ' Q', "Q'--", '', 'Q-1', ['Q'], { a: 'Q' }]) {
      const y = await cagir(undefined, { seri });
      expect(y.kod, JSON.stringify(seri)).toBe(400);
      expect((y.govde as { success: boolean }).success).toBe(false);
    }
    expect(mikroSql).not.toHaveBeenCalled();
    expect(mikroKolonlar).not.toHaveBeenCalled();
    expect(pgSorgulari).toEqual([]);
  });

  it('seri verilmezse \'Q\'; verilirse SQL\'e yalnız doğrulanmış biçimiyle, saklandığı yazımla (büyütülmeden) girer', async () => {
    pgKur();
    tablolar();
    sql(SERILER, EBELGE, BASLIKLAR, SATIRLAR);
    expect(((await cagir()).govde as Govde).seri).toBe('Q');
    const [, eBelgeSql, baslikSql, satirSql] = mikroSqlleri();
    expect(eBelgeSql).toContain("WHERE cha.cha_evrakno_seri = 'Q' GROUP BY");
    expect(baslikSql).toContain("WHERE cha.cha_evrakno_seri = 'Q' ORDER BY");
    expect(satirSql).toContain("WHERE sth_evrakno_seri = 'Q' AND sth_evrakno_sira IN (14, 15)");

    vi.mocked(mikroSql).mockClear();
    sql(SERILER, EBELGE, BASLIKLAR, SATIRLAR);
    const g = (await cagir(undefined, { seri: 'q9A' })).govde as Govde;
    expect(g.seri).toBe('q9A');
    for (const s of mikroSqlleri().slice(1)) {
      expect(s).toContain("= 'q9A'");
      expect(s.replace(/''/g, '').split("'").length - 1).toBe(2);                 // boş metin sabitleri dışında tek tırnaklı sabit: seri
    }
    expect(mikroSqlleri()[0]).not.toContain("'");                                 // (1) tüm seriler: seri süzgeci yok
  });

  it('tam ölçüm: beş bölüm; üretilen HER Mikro SQL\'i ve PG sorgusu yalnız SELECT; okuma başına 20 sn; hiçbir yere yazılmaz', async () => {
    pgKur();
    tablolar();
    sql(SERILER, EBELGE, BASLIKLAR, SATIRLAR);
    const y = await cagir();
    expect(y.kod).toBe(200);
    const g = y.govde as Govde;
    expect(g).toMatchObject({ success: true, seri: 'Q', eksikKolonlar: [], semaOkunamadi: [], hataliBolumler: [] });
    expect(typeof g.sureMs).toBe('number');
    expect(Object.keys(g.sureler).sort()).toEqual(['basliklarMs', 'chaSemaMs', 'eBelgeMs', 'pgFaturaMs', 'pgSiparisMs', 'satirlarMs', 'serilerMs', 'sthSemaMs']);

    // (1) Tüm seriler — boş seri ayrı satır.
    expect(g.seriler.satirlar?.map(s => [s.seri, s.evrakTip, s.cinsi, s.tip, s.adet, s.toplam, s.iptalAdet])).toEqual([['Q', 63, 7, 0, 12, 120000, 0], ['', 63, 6, 1, 700, 9000000, 0]]);
    // (2) e-belge dağılımı.
    expect(g.eBelge.satirlar).toEqual([{ cha_ebelge_turu: 0, cha_efatura_belge_tipi: 0, cha_ebelge_Islemturu: 0, ettnVar: false, iptal: false, adet: 12 }]);
    // (3) Son başlıklar + satır özeti (KDV'li ve KDV'siz iki örnek).
    expect(g.sonBasliklar.satirlar).toHaveLength(2);
    expect(g.sonBasliklar.satirlar?.[0]).toMatchObject({
      sira: 15, seri: 'Q', cariKod: '120.01.001', evrakTip: 63, cinsi: 7, tip: 0, meblag: 12000, araToplam: 10000, vergi: 2000, ftIskonto: 0, ettnVar: false, iptal: false,
      satirOzeti: { evraktip: 4, satirAdedi: 3, tutar: 10000, vergi: 2000, iptalSatirAdedi: 0, vergiIsaretcisi: { '4': 3 }, girisDeposu: { '2': 3 }, cikisDeposu: { '2': 3 } },
    });
    expect(g.sonBasliklar.satirlar?.[1].satirOzeti).toMatchObject({ satirAdedi: 1, tutar: 500, vergi: 0, vergiIsaretcisi: { '1': 1 } });
    expect(g.sonBasliklar.satirOzeti).toMatchObject({ okundu: true, grupSayisi: 2 });
    expect(String(g.sonBasliklar.satirOzeti?.bag)).toContain('sth_evraktip');
    // (4) + (5) Cetpa.
    expect(g.cetpa.mikroFaturalar).toEqual({ adet: 12, kiracilar: { K1: 12 }, yazimlar: { Q: 12 }, toplamKopya: 712 });
    expect(g.cetpa.siparisler).toEqual({ adet: 11, faturali: { true: 9, false: 2, yok: 0, diger: 0 }, kiracilar: { K1: 11 }, yazimlar: { Q: 11 }, toplamMikroFaturaSiparisi: 11 });

    // Mikro: dört okuma, hepsi salt okunur tek deyim; şema iki tablo için okundu.
    const sqller = mikroSqlleri();
    expect(sqller).toHaveLength(4);
    for (const s of sqller) {
      expect(s).toMatch(/^SELECT /);
      expect(s).not.toMatch(YASAK);
      expect(s).not.toContain(';');
      expect(s).not.toContain('--');
      expect(s).not.toMatch(/[^\x20-\x7E]/);
    }
    for (const c of vi.mocked(mikroSql).mock.calls) expect(c[1]).toEqual({ zamanAsimiMs: 20000 });
    expect(vi.mocked(mikroKolonlar).mock.calls.map(c => c[0])).toEqual(['CARI_HESAP_HAREKETLERI', 'STOK_HAREKETLERI']);
    expect(sqller[0]).not.toMatch(/\bWHERE\b/);                                   // fatura koşulu ÖNCEDEN uygulanmaz
    expect(sqller[2]).toMatch(/^SELECT TOP 20 /);
    // PG: iki okuma, yalnız SELECT, değerler parametreyle (seri metne gömülmez).
    expect(pgSorgulari.map(p => p.params)).toEqual([['mikroFaturalar'], ['orders', 'mikro-fatura']]);
    for (const p of pgSorgulari) {
      expect(p.sql).toMatch(/^SELECT /);
      expect(p.sql).not.toMatch(YASAK);
      expect(p.sql).not.toContain(';');
      expect(p.sql).toContain('FROM docs WHERE coll = $1');
    }
    // Yazım yok: Cetpa'ya (adminDb) hiçbir şey düşmedi, Mikro'ya SqlVeriOkuV2 dışında çağrı yok.
    expect(d.yazilan).toEqual([]);
    expect(mikroPost).not.toHaveBeenCalled();
    expect(d.syncLog).not.toHaveBeenCalled();
  });

  it('şemada olmayan kolon: `eksikKolonlar`\'da ADIYLA, sorgu metinlerinde YOK; bağlı alan `atlananAlanlar`\'da, bağlı bölüm `atlandi`', async () => {
    pgKur();
    const eksikler = ['cha_vergi', 'cha_uuid', 'cha_ft_iskonto6', 'sth_cikis_depo_no', 'sth_vergi_pntr'];
    tablolar(olmadan(CHA, ...eksikler), olmadan(STH, ...eksikler));
    // Mikro yanıtı da o kolonları taşımaz (sorguda yoklar).
    sql(SERILER, EBELGE, BASLIKLAR.map(b => alansiz(b, 'vergi', 'ettnVar', 'cha_ft_iskonto6')), SATIRLAR.map(g => alansiz(g, 'vergiPntr', 'cikisDepo')));
    const g = (await cagir()).govde as Govde;
    expect(g.eksikKolonlar).toEqual([...eksikler].sort());
    expect(g.semaOkunamadi).toEqual([]);
    expect(g.hataliBolumler).toEqual([]);
    const sqller = mikroSqlleri();
    expect(sqller).toHaveLength(4);
    for (const s of sqller) for (const ad of eksikler) expect(new RegExp(`\\b${ad}\\b`).test(s), `${ad} sorguda geçmemeli: ${s}`).toBe(false);
    expect(g.eBelge.atlananAlanlar).toEqual({ ettnVar: 'şemada yok: cha_uuid' });
    expect(g.sonBasliklar.atlananAlanlar).toEqual({ vergi: 'şemada yok: cha_vergi', ettnVar: 'şemada yok: cha_uuid' });
    expect(g.sonBasliklar.satirOzeti).toMatchObject({ okundu: true, atlananAlanlar: { vergiIsaretcisi: 'şemada yok: sth_vergi_pntr', cikisDeposu: 'şemada yok: sth_cikis_depo_no' } });
    const ilk = g.sonBasliklar.satirlar?.[0] as Record<string, unknown>;
    expect('vergi' in ilk || 'ettnVar' in ilk).toBe(false);                       // okunmayan alan çıktıda YOK (0 / false uydurulmaz)
    expect(ilk.satirOzeti).toEqual({ evraktip: 4, satirAdedi: 3, tutar: 10000, vergi: 2000, iptalSatirAdedi: 0, girisDeposu: { '2': 3 } });

    // Zorunlu kolon yoksa bölüm sorgusuz ATLANIR — boş dizi dönmez.
    vi.mocked(mikroSql).mockClear();
    tablolar(olmadan(CHA, 'cha_cinsi', 'cha_evrakno_sira'), STH);
    sql(EBELGE);
    const g2 = (await cagir()).govde as Govde;
    expect(g2.eksikKolonlar).toEqual(['cha_cinsi', 'cha_evrakno_sira']);
    expect(g2.seriler).toEqual({ atlandi: 'şemada yok: cha_cinsi' });
    expect(g2.sonBasliklar).toEqual({ atlandi: 'şemada yok: cha_evrakno_sira' });
    expect(g2.eBelge.satirlar).toHaveLength(1);
    expect(mikroSqlleri()).toHaveLength(1);
    expect(g2.hataliBolumler).toEqual([]);
  });

  it('şema OKUNAMADIYSA (boş liste ≠ «kolon yok»): üç Mikro bölümü `hata`, `eksikKolonlar` DOLDURULMAZ; Cetpa bölümleri yine döner', async () => {
    pgKur();
    tablolar([], STH);
    const y = await cagir();
    expect(y.kod).toBe(200);
    const g = y.govde as Govde;
    expect(g.eksikKolonlar).toEqual([]);
    expect(g.semaOkunamadi).toEqual(['CARI_HESAP_HAREKETLERI']);
    for (const b of [g.seriler, g.eBelge, g.sonBasliklar]) expect(b.hata).toContain('Mikro şeması okunamadı (CARI_HESAP_HAREKETLERI');
    expect(g.hataliBolumler).toEqual(['seriler', 'eBelge', 'sonBasliklar']);
    expect(mikroSql).not.toHaveBeenCalled();
    expect(g.cetpa.mikroFaturalar).toMatchObject({ adet: 12 });
    expect(g.cetpa.siparisler).toMatchObject({ adet: 11 });

    // Şema okuması FIRLATIRSA da aynı: istek düşmez, neden hata metninde.
    vi.mocked(mikroKolonlar).mockRejectedValue(Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }));
    const g2 = (await cagir()).govde as Govde;
    expect(g2.seriler.hata).toContain('TimeoutError: The operation was aborted due to timeout');
    expect(g2.cetpa.mikroFaturalar).toMatchObject({ adet: 12 });

    // Satır şeması okunamazsa yalnız satır özeti düşer; başlıklar döner (satirOzeti null).
    tablolar(CHA, []);
    sql(SERILER, EBELGE, BASLIKLAR);
    const g3 = (await cagir()).govde as Govde;
    expect(g3.semaOkunamadi).toEqual(['STOK_HAREKETLERI']);
    expect(g3.sonBasliklar.satirlar).toHaveLength(2);
    expect(g3.sonBasliklar.satirlar?.[0].satirOzeti).toBeNull();
    expect(String(g3.sonBasliklar.satirOzeti?.hata)).toContain('Mikro şeması okunamadı (STOK_HAREKETLERI');
    expect(g3.hataliBolumler).toEqual(['sonBasliklar.satirOzeti']);
    expect(g3.eksikKolonlar).toEqual([]);
  });

  it('bölüm hatası diğerlerini DÜŞÜRMEZ: Mikro hatası (dönen ve fırlayan), PG hatası, biçimleyici hatası kendi bölümünde kalır', async () => {
    pgKur();
    tablolar();
    // (1) Mikro hata döndürür, (2) fırlatır, (3a) + (3b) sağlam.
    sql('Invalid column name', Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }), BASLIKLAR, SATIRLAR);
    const g = (await cagir()).govde as Govde;
    expect(g.success).toBe(true);
    expect(g.seriler).toEqual({ hata: 'Invalid column name' });
    expect(g.eBelge).toEqual({ hata: 'TimeoutError: The operation was aborted due to timeout' });
    expect(g.sonBasliklar.satirlar).toHaveLength(2);
    expect(g.cetpa.mikroFaturalar).toMatchObject({ adet: 12 });
    expect(g.hataliBolumler).toEqual(['seriler', 'eBelge']);

    // Satır okuması düşerse başlıklar yine döner; satır özeti null + neden.
    vi.mocked(mikroSql).mockClear();
    sql(SERILER, EBELGE, BASLIKLAR, 'Conversion failed');
    const g2 = (await cagir()).govde as Govde;
    expect(g2.sonBasliklar.satirlar?.map(b => b.satirOzeti)).toEqual([null, null]);
    expect(g2.sonBasliklar.satirOzeti).toEqual({ hata: 'Conversion failed' });
    expect(g2.hataliBolumler).toEqual(['sonBasliklar.satirOzeti']);               // bölüm döndü; düşen alt okuma adıyla işaretli

    // Başlık okuması düşerse satırlar HİÇ sorulmaz.
    vi.mocked(mikroSql).mockClear();
    sql(SERILER, EBELGE, 'başlık okunamadı');
    const g3 = (await cagir()).govde as Govde;
    expect(g3.sonBasliklar).toEqual({ hata: 'başlık okunamadı' });
    expect(mikroSqlleri()).toHaveLength(3);
    expect(g3.seriler.satirlar).toHaveLength(2);

    // PG: fatura okuması fırlatır, sipariş okuması bozuk satır döndürür → ikisi de kendi bölümünde; Mikro bölümleri sağlam.
    vi.mocked(mikroSql).mockClear();
    sql(SERILER, EBELGE, BASLIKLAR, SATIRLAR);
    d.pgAyarla(async (_sql, params) => {
      if (params?.[0] === 'mikroFaturalar') throw new Error('relation "docs" does not exist');
      return { rows: [{ companyId: 'K1', seri: 'Q', tur: 'boolean', deger: 'true', adet: null }] };
    });
    const g4 = (await cagir()).govde as Govde;
    expect(g4.cetpa.mikroFaturalar).toEqual({ hata: 'Error: relation "docs" does not exist' });
    expect(g4.cetpa.siparisler).toEqual({ hata: 'Error: PG adet değeri sayı değil' });
    expect(g4.seriler.satirlar).toHaveLength(2);
    expect(g4.hataliBolumler).toEqual(['cetpa.mikroFaturalar', 'cetpa.siparisler']);
  });

  it('PG havuzu yoksa (DATABASE_URL tanımsız) Cetpa bölümleri `hata`; Mikro bölümleri döner', async () => {
    d.pgAyarla(null);
    tablolar();
    sql(SERILER, EBELGE, BASLIKLAR, SATIRLAR);
    const y = await cagir();
    expect(y.kod).toBe(200);
    const g = y.govde as Govde;
    expect(g.cetpa.mikroFaturalar).toEqual({ hata: 'DATABASE_URL tanımlı değil — Cetpa tarafı okunamadı' });
    expect(g.cetpa.siparisler).toEqual({ hata: 'DATABASE_URL tanımlı değil — Cetpa tarafı okunamadı' });
    expect(g.seriler.satirlar).toHaveLength(2);
    expect(g.sonBasliklar.satirlar).toHaveLength(2);
  });

  it('seride başlık yoksa satır şeması ve satırlar SORULMAZ; boş sonuç nedeniyle birlikte döner', async () => {
    pgKur([], []);
    tablolar();
    sql(SERILER, [], []);
    const g = (await cagir(undefined, { seri: 'ZZ' })).govde as Govde;
    expect(g.eBelge.satirlar).toEqual([]);
    expect(g.sonBasliklar).toEqual({ satirlar: [], satirOzeti: { atlandi: 'seride başlık yok — satırlar sorulmadı' }, siralama: 'fatura koşuluna uyanlar önce; sonra tarih, sonra evrak sırası — yeniden eskiye' });
    expect(mikroSqlleri()).toHaveLength(3);
    expect(vi.mocked(mikroKolonlar).mock.calls.map(c => c[0])).toEqual(['CARI_HESAP_HAREKETLERI']);
    expect(g.cetpa.mikroFaturalar).toEqual({ adet: 0, kiracilar: {}, yazimlar: {}, toplamKopya: 0 });
    expect(g.cetpa.siparisler).toMatchObject({ adet: 0, toplamMikroFaturaSiparisi: 0 });
  });

  it('süre bütçesi İSTEK BAŞINDAN (100 sn): kalan < 5 sn olunca okuma YAPILMAZ, bölüm «süre bütçesi doldu» ile döner; okuma süresi kalanla sınırlı', async () => {
    pgKur();
    tablolar();
    let saat = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => saat);
    vi.mocked(mikroSql).mockReset();
    vi.mocked(mikroSql)
      .mockImplementationOnce(async () => { saat += 45000; return { rows: SERILER, hata: null }; })    // 0 → 45 sn
      .mockImplementationOnce(async () => { saat += 45000; return { rows: EBELGE, hata: null }; })     // 45 → 90 sn (kalan 10)
      .mockImplementationOnce(async () => { saat += 6000; return { rows: BASLIKLAR, hata: null }; });  // 90 → 96 sn (kalan 4 < 5)
    const g = (await cagir()).govde as Govde;
    expect(vi.mocked(mikroSql).mock.calls.map(c => c[1])).toEqual([{ zamanAsimiMs: 20000 }, { zamanAsimiMs: 20000 }, { zamanAsimiMs: 10000 }]);
    expect(g.seriler.satirlar).toHaveLength(2);
    expect(g.sonBasliklar.satirlar).toHaveLength(2);                              // başlıklar okundu
    expect(g.sonBasliklar.satirOzeti).toEqual({ hata: 'süre bütçesi doldu — şema okunmadı' });
    expect(g.hataliBolumler).toEqual(['sonBasliklar.satirOzeti']);
    expect(vi.mocked(mikroKolonlar).mock.calls.map(c => c[0])).toEqual(['CARI_HESAP_HAREKETLERI']);
    expect(g.semaOkunamadi).toEqual([]);                                          // okunmayan şema «okunamadı» sayılmaz
    expect(g.sureMs).toBe(96000);
    expect(g.cetpa.mikroFaturalar).toMatchObject({ adet: 12 });                   // PG eş zamanlı koştu — Mikro bütçeyi yese de kaybolmadı
  });

  it('süre bütçesi: sondaki şema okuması KALAN süreyle yarıştırılır — yanıt 100 sn\'de döner (ARR sınırına taşmaz), satır okuması YAPILMAZ; yarıda kesilen tablo `semaOkunamadi`\'ya girmez', async () => {
    vi.useFakeTimers();
    try {
      pgKur();
      const sonra = <T>(ms: number, deger: T) => new Promise<T>(coz => { setTimeout(() => coz(deger), ms); });
      // Şema okumaları seçenek almaz (genel 30 sn): ikincisi 90. sn'de başlar, kalan 10 sn'yi aşar — yarış 100. sn'de keser.
      vi.mocked(mikroKolonlar).mockImplementation((t: string) => sonra(30000, t === 'CARI_HESAP_HAREKETLERI' ? CHA : STH));
      vi.mocked(mikroSql).mockReset();
      vi.mocked(mikroSql)
        .mockImplementationOnce(() => sonra(20000, { rows: SERILER, hata: null }))      // 30 → 50 sn
        .mockImplementationOnce(() => sonra(20000, { rows: EBELGE, hata: null }))       // 50 → 70 sn
        .mockImplementationOnce(() => sonra(20000, { rows: BASLIKLAR, hata: null }));   // 70 → 90 sn (kalan 10 ≥ 5: şema okuması başlar)
      const bekleyen = cagir();
      await vi.advanceTimersByTimeAsync(130000);
      const g = (await bekleyen).govde as Govde;
      expect(vi.mocked(mikroKolonlar).mock.calls.map(c => c[0])).toEqual(['CARI_HESAP_HAREKETLERI', 'STOK_HAREKETLERI']);
      expect(vi.mocked(mikroSql).mock.calls.map(c => c[1])).toEqual([{ zamanAsimiMs: 20000 }, { zamanAsimiMs: 20000 }, { zamanAsimiMs: 20000 }]);
      expect(g.sonBasliklar.satirlar).toHaveLength(2);
      expect(g.sonBasliklar.satirOzeti).toEqual({ hata: 'süre bütçesi doldu — şema okuması tamamlanmadı' });
      expect(g.hataliBolumler).toEqual(['sonBasliklar.satirOzeti']);
      expect(g.semaOkunamadi).toEqual([]);                                        // yarıda kesildi — «okunamadı» sayılmaz
      expect(g.sureMs).toBe(100000);
    } finally { vi.useRealTimers(); }
  });

  it('süre bütçesi: sondaki şema okuması son 5 sn\'ye sarkarak DÖNERSE satır okuması YAPILMAZ (mikroOku kapısı) — Mikro\'ya baştan ölü / sıfır-negatif zaman aşımı gitmez', async () => {
    vi.useFakeTimers();
    try {
      pgKur();
      const sonra = <T>(ms: number, deger: T) => new Promise<T>(coz => { setTimeout(() => coz(deger), ms); });
      // CHA şeması 30 sn, üç okuma 20'şer sn → 90. sn; STH şeması 7 sn → 97. sn'de DÖNER (yarış kesmez), kalan 3 sn < 5.
      vi.mocked(mikroKolonlar).mockImplementation((t: string) => (t === 'CARI_HESAP_HAREKETLERI' ? sonra(30000, CHA) : sonra(7000, STH)));
      vi.mocked(mikroSql).mockReset();
      vi.mocked(mikroSql)
        .mockImplementationOnce(() => sonra(20000, { rows: SERILER, hata: null }))      // 30 → 50 sn
        .mockImplementationOnce(() => sonra(20000, { rows: EBELGE, hata: null }))       // 50 → 70 sn
        .mockImplementationOnce(() => sonra(20000, { rows: BASLIKLAR, hata: null }))    // 70 → 90 sn
        .mockImplementationOnce(() => sonra(1000, { rows: SATIRLAR, hata: null }));     // kapı yoksa: 3 sn'lik ölü zaman aşımıyla Mikro'ya gider
      const bekleyen = cagir();
      await vi.advanceTimersByTimeAsync(130000);
      const g = (await bekleyen).govde as Govde;
      expect(vi.mocked(mikroKolonlar).mock.calls.map(c => c[0])).toEqual(['CARI_HESAP_HAREKETLERI', 'STOK_HAREKETLERI']);
      expect(vi.mocked(mikroSql).mock.calls.map(c => c[1])).toEqual([{ zamanAsimiMs: 20000 }, { zamanAsimiMs: 20000 }, { zamanAsimiMs: 20000 }]);
      expect(g.sonBasliklar.satirlar).toHaveLength(2);
      expect(g.sonBasliklar.satirOzeti).toEqual({ hata: 'süre bütçesi doldu — okunmadı' });
      expect(g.hataliBolumler).toEqual(['sonBasliklar.satirOzeti']);
      expect(g.semaOkunamadi).toEqual([]);                                        // şema OKUNDU — yarış kesmedi
      expect(g.sureMs).toBe(97000);
    } finally { vi.useRealTimers(); }
  });

  it('PG yanıt vermezse istek asılı kalmaz: 20 sn sonra o bölümler `hata`, Mikro bölümleri döner', async () => {
    vi.useFakeTimers();
    try {
      d.pgAyarla(() => new Promise(() => {}));                                    // hiç dönmeyen sorgu (tıkalı havuz)
      tablolar();
      sql(SERILER, EBELGE, BASLIKLAR, SATIRLAR);
      const bekleyen = cagir();
      await vi.advanceTimersByTimeAsync(20001);
      const y = await bekleyen;
      expect(y.kod).toBe(200);
      const g = y.govde as Govde;
      expect(g.cetpa.mikroFaturalar).toEqual({ hata: 'Error: Cetpa (PG) 20 sn içinde yanıt vermedi' });
      expect(g.cetpa.siparisler).toEqual({ hata: 'Error: Cetpa (PG) 20 sn içinde yanıt vermedi' });
      expect(g.seriler.satirlar).toHaveLength(2);
    } finally { vi.useRealTimers(); }
  });
});
