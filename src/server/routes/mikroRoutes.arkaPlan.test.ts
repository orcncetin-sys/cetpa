/**
 * mikroRoutes.arkaPlan.test.ts — Mikro import uçları ARKA PLAN İŞİ olarak koşar (mikro-import-arkaplan,
 * 2026-09-24). ÖNCE YAZILDI.
 *
 * Teşhis (teshis-mikro-import-2026-09-24.json, CONFIRMED): iş HTTP isteğinin İÇİNDE bitiyor, IIS/ARR
 * ~120 sn'de kesip 502 dönüyor; kullanıcı "Cari Hareketler (Tümü)"nü çalıştıramadığı için LUCA
 * dekontları ekrana hiç gelmiyordu. Bu dosya 15 ucun (stok, cari, stok-miktar, 12 SQL fabrika)
 * `src/server/mikro/arkaPlanIsi.ts` TEK yardımcısına GERÇEKTEN bağlandığını kanıtlar — modül doğru
 * olup rotanın eski satır içi gövdesinin koşmaya devam etmesi bu projenin tekrar eden arıza sınıfı
 * ("yazıldı ama bağlanmadı", 4 tekrar).
 *
 * Vakalar: (a) anında yanıt + jobs dokümanı + sonSayfaMs zinciri · (b) süreç-geneli TEK kilit ·
 * (c) istisnada syncLog(false) TAM 1 kez, kilit sızmaz · (d) cron paritesi (helper'a BAĞLANMAZ,
 * pencere K-B; sayfa + süpürge zaman aşımı 30 → 120 sn BİLİNÇLİ FARK, iddia kilitli) · (e) zaman aşımı ayrı sayılır → success:false; ASILI Mikro'da devre kesici işi bitirir ·
 * (f) yazıcı kaydı iş ömrünce + 423 · (g) SQL ucunda ÇİFT syncLog yok; başarısız koşu SAYILMAZ (total yok).
 *
 * vi.mock blokları BURADA kalmak zorunda (vitest hoisting) — tarif: `mikroMockTarifi`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import cron from 'node-cron';
import { duzenekKur, type Duzenek } from './mikroRoutes.testDuzenegi';
import { mikroPost, mikroSql, mikroKolonlar, listeZamanAsimiMs, v17MetoduKullanilabilir } from '../mikroClient.js';
import { arkaPlanIsiBaslat, arkaPlanIsiKosan } from '../mikro/arkaPlanIsi.js';

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
    mikroSql: vi.fn(),
    mikroKolonlar: vi.fn(async () => [] as string[]),
    // Gerçek koşar; yalnız çağrı casuslanır — stok-miktar kısa devresi yoklamadan ÖNCE mi (delta bulgu 3/8).
    // Önbellek (10 dk) yüzünden Mikro çağrı sayısı tek başına ayırt etmez; yoklamanın KENDİSİ sayılır.
    v17MetoduKullanilabilir: vi.fn(gercek.v17MetoduKullanilabilir),
    mikroVergiOranlari: vi.fn(async () => new Map<number, number>()),
    vergiOraniCoz: vi.fn(() => null),
  };
});
// Yardımcı GERÇEK koşar; yalnız çağrı sayısı casuslanır (cron paritesi: HİÇ çağrılmaz).
vi.mock('../mikro/arkaPlanIsi.js', async (orig) => {
  const gercek = await orig<typeof import('../mikro/arkaPlanIsi.js')>();
  return { ...gercek, arkaPlanIsiBaslat: vi.fn(gercek.arkaPlanIsiBaslat) };
});

type MikroYanit = { ok: boolean; status: number; data: unknown };
/** Açık kalan bekletilmiş sözler: bir iddia patlarsa afterEach bunları reddeder ki iş bitsin ve
 *  süreç-geneli kilit SONRAKİ testleri (alreadyRunning) zehirlemesin. */
const acikSozler: Array<(e: unknown) => void> = [];
function ertelenen<T>() {
  let coz!: (v: T) => void; let reddet!: (e: unknown) => void;   // ! : Promise yapıcısı senkron atar
  const soz = new Promise<T>((r, j) => { coz = r; reddet = j; });
  acikSozler.push(reddet);
  return { soz, coz, reddet };
}
const liste = (metot: 'StokListesi' | 'CariListesi', rows: Record<string, unknown>[]): MikroYanit =>
  ({ ok: true, status: 200, data: { result: [{ Data: { [metot]: rows } }] } });
const HATA: MikroYanit = { ok: false, status: 500, data: null };
const zamanAsimi = () => new DOMException('The operation was aborted due to timeout', 'TimeoutError');

let d: Duzenek;
beforeEach(() => {
  d = duzenekKur();
  vi.mocked(mikroPost).mockReset();
  vi.mocked(mikroSql).mockReset();
  vi.mocked(mikroKolonlar).mockResolvedValue([]);
  vi.mocked(arkaPlanIsiBaslat).mockClear();
  vi.mocked(v17MetoduKullanilabilir).mockClear();
});
afterEach(async () => {
  // Hiçbir test koşan iş bırakmasın (süreç-geneli kilit sonraki dosyayı/testi kilitler).
  const sus = vi.spyOn(console, 'error').mockImplementation(() => {});
  for (const reddet of acikSozler) reddet(new Error('test bitti'));
  acikSozler.length = 0;
  for (const ad of ['mikroImport-stok', 'mikroImport-cari', 'stokMiktarImport', 'mikroImport-cari-hareket', 'mikroImport-siparis']) await d.isBitisi(ad);
  sus.mockRestore();
  vi.restoreAllMocks();
});

/** stok-miktar düzeneği: 2 SKU envanter + V17 yoklaması (Depolar:'1') OK + per-depo SQL boş. Ürün çağrıları `urun` ile yanıtlanır. */
function miktarDuzenegi(urun: (govde: Record<string, unknown>) => Promise<MikroYanit> | MikroYanit) {
  d.snapAyarla('inventory', {
    u1: { sku: 'CMT-1', companyId: 'A', source: 'mikro_import' },
    u2: { sku: 'CMT-2', companyId: 'A', source: 'mikro_import' },
  });
  vi.mocked(mikroSql).mockResolvedValue({ rows: [], hata: null });
  vi.mocked(mikroPost).mockImplementation((async (metot: string, govde: Record<string, unknown>) => {
    if (metot !== 'GenelAmacliMaliyetListesiV2') return HATA;
    if (govde.Depolar === '1') return { ok: true, status: 200, data: { result: [{ Data: { EldekiMiktar: 1 } }] } };
    return urun(govde);
  }) as unknown as typeof mikroPost);
}

describe('(a) anında döner + jobs/<isAdi> dokümanı; sonSayfaMs zinciri', () => {
  it("import/stok: iş bitmeden { success, started, job:'mikroImport-stok' }; ilk yazım merge'SİZ set (running/companyId/isAdi); bitişte running:false + sayaçlar + sonSayfaMs", async () => {
    const sayfa = ertelenen<MikroYanit>();
    vi.mocked(mikroPost).mockImplementation((async (metot: string) => metot === 'StokListesiV2' ? sayfa.soz : HATA) as unknown as typeof mikroPost);

    const res = await d.cagir('POST', '/api/mikro/import/stok');
    expect(res.kod).toBe(200);
    expect(res.govde).toEqual({ success: true, started: true, job: 'mikroImport-stok' });
    // Yanıt döndü ama iş SÜRÜYOR: envantere hiçbir şey yazılmadı, jobs'ta yalnız başlangıç dokümanı.
    expect(d.koleksiyon('inventory')).toEqual([]);
    const jobs = d.koleksiyon('jobs');
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toEqual({ op: 'set', ref: { id: 'mikroImport-stok', coll: 'jobs' },
      data: { running: true, startedAt: 'TS', finishedAt: null, error: null, companyId: 'A', isAdi: 'mikroImport-stok',
              operation: 'ImportStok', entityType: 'inventory' } });   // operation/entityType: açılış taraması (delta bulgu 1c)
    expect(d.mergeMi(jobs[0]), "başlangıç dokümanı MERGE'SİZ (önceki koşunun alanları silinir)").toBe(false);
    // İş arka planda snapshot'ları okuduktan sonra Mikro'ya çıkar — yanıt bunu BEKLEMEZ (waitFor, sabit setTimeout değil).
    await vi.waitFor(() => expect(mikroPost).toHaveBeenCalledWith('StokListesiV2', expect.objectContaining({ Size: '100', Index: 0 }), false, { zamanAsimiMs: listeZamanAsimiMs() }));

    sayfa.coz(liste('StokListesi', [{ sto_kod: 'A1', sto_isim: 'Çimento' }]));
    const son = await d.isBitisi('mikroImport-stok');
    expect(son).toMatchObject({ running: false, finishedAt: 'TS', created: 1, updated: 0, errors: 0, bozukKayit: 0, zamanAsimiSayfa: 0, zamanAsimiKayit: 0, fiyatliUrun: 0, error: null, companyId: 'A', isAdi: 'mikroImport-stok' });
    expect(Number.isFinite(son?.durationMs)).toBe(true);
    expect(typeof son?.note).toBe('string');
    expect(d.koleksiyon('inventory').map(y => y.data?.sku)).toEqual(['A1']);
    // K-A: her CHUNK sonunda ilerleme merge'i sonSayfaMs taşır (sonlu, ≥ 0).
    const ilerlemeler = d.koleksiyon('jobs').filter(y => d.mergeMi(y) && 'offset' in (y.data ?? {}));
    expect(ilerlemeler.length).toBeGreaterThanOrEqual(1);
    for (const y of ilerlemeler) {
      expect(y.data).toMatchObject({ running: true, processed: 1, offset: 100, sonSayfaMs: expect.any(Number) });
      expect(Number.isFinite(y.data?.sonSayfaMs) && (y.data?.sonSayfaMs as number) >= 0).toBe(true);
    }
    expect(d.syncLog).toHaveBeenCalledTimes(1);
    expect(d.syncLog).toHaveBeenCalledWith('ImportStok', 'inventory', expect.stringContaining('1 yeni / 0 güncel'), true, null, null, expect.any(Number), expect.anything());
  });

  it("import/cari: job 'mikroImport-cari'; sayfa merge'i { sayfa:1, sonSayfaMs }; CariListesiV2 gövdesi birebir + zamanAsimiMs", async () => {
    const sayfa = ertelenen<MikroYanit>();
    vi.mocked(mikroPost).mockImplementation((async (metot: string) => metot === 'CariListesiV2' ? sayfa.soz : HATA) as unknown as typeof mikroPost);

    const res = await d.cagir('POST', '/api/mikro/import/cari');
    expect(res.govde).toEqual({ success: true, started: true, job: 'mikroImport-cari' });
    expect(d.koleksiyon('jobs')[0]).toMatchObject({ op: 'set', ref: { id: 'mikroImport-cari' }, data: { running: true, companyId: 'A', isAdi: 'mikroImport-cari' } });
    await vi.waitFor(() => expect(mikroPost).toHaveBeenCalledWith('CariListesiV2', {
      FieldName: 'cari_kod,cari_unvan1,cari_unvan2,cari_vdaire_no,cari_vdaire_adi,cari_EMail,cari_CepTel,cari_efatura_fl,cari_hareket_tipi,cari_baglanti_tipi,cari_muh_kod',
      WhereStr: "cari_baglanti_tipi=0 and cari_lastup_date > '2000/01/01'",
      Sort: 'cari_kod', Size: '500', Index: 0,
    }, false, { zamanAsimiMs: listeZamanAsimiMs() }));

    sayfa.coz(liste('CariListesi', [{ cari_kod: 'C1', cari_unvan1: 'ŞİRİN YAPI' }]));
    const son = await d.isBitisi('mikroImport-cari');
    expect(son).toMatchObject({ running: false, created: 1, updated: 0, errors: 0, bozukKayit: 0, zamanAsimiSayfa: 0, zamanAsimiKayit: 0, error: null, companyId: 'A' });
    const sayfaMerge = d.koleksiyon('jobs').find(y => d.mergeMi(y) && 'sayfa' in (y.data ?? {}));
    expect(sayfaMerge?.data).toMatchObject({ running: true, sayfa: 1, processed: 1, sonSayfaMs: expect.any(Number) });
    expect(Number.isFinite(sayfaMerge?.data?.sonSayfaMs)).toBe(true);
    expect(d.syncLog).toHaveBeenCalledTimes(1);
    expect(d.syncLog).toHaveBeenCalledWith('ImportCari', 'lead', expect.stringMatching(/^1 yeni \/ 0 güncel/), true, null, null, expect.any(Number), expect.anything());
  });

  it("import/stok-miktar: job 'stokMiktarImport' (sözlük istisnası); bitiş dokümanı şekli AYNEN (+companyId/isAdi); syncLog+audit 2819/2820 argümanları", async () => {
    const urun = ertelenen<MikroYanit>();
    miktarDuzenegi(() => urun.soz);

    const res = await d.cagir('POST', '/api/mikro/import/stok-miktar');
    expect(res.govde).toEqual({ success: true, started: true, job: 'stokMiktarImport' });
    expect(d.koleksiyon('jobs')[0]).toEqual({ op: 'set', ref: { id: 'stokMiktarImport', coll: 'jobs' },
      data: { running: true, startedAt: 'TS', finishedAt: null, error: null, companyId: 'A', isAdi: 'stokMiktarImport',
              operation: 'GenelAmacliMaliyetListesiV2', entityType: 'inventory' } });

    urun.coz({ ok: true, status: 200, data: { result: [{ Data: { EldekiMiktar: 10, MaliyetBedeli: 50 } }] } });
    const son = await d.isBitisi('stokMiktarImport');
    expect(son).toEqual({
      running: false, startedAt: 'TS', finishedAt: 'TS', error: null, companyId: 'A', isAdi: 'stokMiktarImport',
      operation: 'GenelAmacliMaliyetListesiV2', entityType: 'inventory',
      processed: 2, updated: 2, failed: 0, total: 2,
      depoUyusmazlik: 0, depoDagilimliUrun: 0, depoDevirli: 0, uyusmazlikOrnek: [],
      durationMs: expect.any(Number),
    });
    expect(d.koleksiyon('inventory').map(y => y.data?.stockLevel)).toEqual([10, 10]);
    expect(d.syncLog).toHaveBeenCalledTimes(1);
    expect(d.syncLog).toHaveBeenCalledWith('GenelAmacliMaliyetListesiV2', 'inventory', expect.stringContaining('2 ürünün miktarı güncellendi, 0 hata'), true, null, null, expect.any(Number), { uid: 'u1', email: 'a@cetpa.com.tr' });
    expect(d.C.writeAuditLog).toHaveBeenCalledWith({ uid: 'u1', email: 'a@cetpa.com.tr' }, 'Mikro Stok Miktarları', expect.stringContaining('2 ürünün miktarı güncellendi'));
  });

  // Hakem 2026-09-25 (bulgu 4): HEAD'de bitiş merge'i (2798-2803) `error`a DOKUNMUYORDU — okunamayan SKU
  // yalnız `failed` sayacında ve syncLog'da (success:false, 'N SKU okunamadı'). jobs `error` dolarsa kart
  // 'tamamlandı' yerine 'Son koşu hatası' basar, Tümünü Çek adımı HATA sayar (isiBaslatVeBekle reddeder).
  it('stok-miktar: 1 SKU okunamadı → jobs error NULL kalır (iş TAMAMLANDI, sayı `failed`da), syncLog success=false + "1 SKU okunamadı" (2819 AYNEN)', async () => {
    miktarDuzenegi(govde => govde.StokKod === 'CMT-2' ? HATA : { ok: true, status: 200, data: { result: [{ Data: { EldekiMiktar: 7, MaliyetBedeli: 5 } }] } });
    await d.cagir('POST', '/api/mikro/import/stok-miktar');
    const son = await d.isBitisi('stokMiktarImport');
    expect(son).toMatchObject({ running: false, processed: 2, updated: 1, failed: 1, error: null });
    expect(d.syncLog).toHaveBeenCalledTimes(1);
    expect(d.syncLog).toHaveBeenCalledWith('GenelAmacliMaliyetListesiV2', 'inventory', expect.stringContaining('1 ürünün miktarı güncellendi, 1 hata'), false, null, '1 SKU okunamadı', expect.any(Number), expect.anything());
  });

  // İnceleme bulgusu 2026-09-25: envanter yalnız `source` ile okunuyordu → B kiracısının Mikro
  // ürünü A'nın Mikro'sundan okunan miktarla ezilirdi. Artık yoklamayla aynı kiracı koşulu.
  it('stok-miktar: YALNIZ çağıran kiracının Mikro ürünleri okunur/yazılır (B kiracısının ürünü dokunulmaz, total 2)', async () => {
    miktarDuzenegi(() => ({ ok: true, status: 200, data: { result: [{ Data: { EldekiMiktar: 4, MaliyetBedeli: 1 } }] } }));
    d.snapAyarla('inventory', {
      u1: { sku: 'CMT-1', companyId: 'A', source: 'mikro_import' },
      u2: { sku: 'CMT-2', companyId: 'A', source: 'mikro_import' },
      b1: { sku: 'CMT-1', companyId: 'B', source: 'mikro_import' },
    });
    await d.cagir('POST', '/api/mikro/import/stok-miktar');
    const son = await d.isBitisi('stokMiktarImport');
    expect(son).toMatchObject({ running: false, processed: 2, updated: 2, total: 2, failed: 0 });
    const yazilan = d.koleksiyon('inventory').map(y => y.ref.id);
    expect(yazilan).toEqual(['u1', 'u2']);
    expect(yazilan).not.toContain('b1');
  });

  it("import/cari-hareket (fabrika): job 'mikroImport-cari-hareket'; sayfa merge'inde processed === satir VE sonSayfaMs (S5 → S4 `...a` zinciri); HTTP sonTarih yoksa `>=` (üst sınır yok)", async () => {
    const sayfa = ertelenen<{ rows: Record<string, unknown>[]; hata: string | null }>();
    vi.mocked(mikroSql).mockImplementation((async () => sayfa.soz) as unknown as typeof mikroSql);

    const res = await d.cagir('POST', '/api/mikro/import/cari-hareket');
    expect(res.govde).toEqual({ success: true, started: true, job: 'mikroImport-cari-hareket' });
    expect(d.koleksiyon('jobs')[0]).toMatchObject({ op: 'set', ref: { id: 'mikroImport-cari-hareket' }, data: { running: true, companyId: 'A', isAdi: 'mikroImport-cari-hareket' } });
    await vi.waitFor(() => expect(mikroSql).toHaveBeenCalledTimes(1));
    const sql = String(vi.mocked(mikroSql).mock.calls[0][0]);
    expect(sql).toContain("cha_tarihi >= '2020-01-01'");
    expect(sql).not.toContain('BETWEEN');
    expect(vi.mocked(mikroSql).mock.calls[0][1]).toEqual({ zamanAsimiMs: listeZamanAsimiMs() });

    sayfa.coz({ rows: [{ cha_Guid: 'g1', cha_tip: 0, cha_meblag: 100 }], hata: null });
    const son = await d.isBitisi('mikroImport-cari-hareket');
    expect(son).toMatchObject({ running: false, total: 1, tablo: 'CARI_HESAP_HAREKETLERI', truncated: false, guidsizSatir: 0, error: null, companyId: 'A' });
    const sayfaMerge = d.koleksiyon('jobs').find(y => d.mergeMi(y) && 'satir' in (y.data ?? {}));
    expect(sayfaMerge?.data).toMatchObject({ running: true, sayfa: 1, satir: 1, processed: 1, sonSayfaMs: expect.any(Number) });
    expect(sayfaMerge?.data?.processed).toBe(sayfaMerge?.data?.satir);
    expect(Number.isFinite(sayfaMerge?.data?.sonSayfaMs) && (sayfaMerge?.data?.sonSayfaMs as number) >= 0).toBe(true);
    expect(d.koleksiyon('mikroCariHareketler')).toHaveLength(1);
  });

  it('fabrika: gövdede sonTarih VERİLİRSE BETWEEN korunur; süpürge sorgusu da AYNI pencereyi kullanır (iki ayrı koşul üreticisi YOK)', async () => {
    vi.mocked(mikroSql).mockResolvedValue({ rows: [{ cha_Guid: 'g1' }], hata: null });
    vi.mocked(mikroKolonlar).mockResolvedValue(['cha_Guid', 'cha_iptal', 'cha_tarihi']);
    vi.mocked(mikroPost).mockImplementation((async () => ({ ok: true, status: 200, data: { result: [{ Data: [] }] } })) as unknown as typeof mikroPost);
    await d.cagir('POST', '/api/mikro/import/cari-hareket', { ilkTarih: '2025-01-01', sonTarih: '2026-09-30' });
    await d.isBitisi('mikroImport-cari-hareket');
    expect(String(vi.mocked(mikroSql).mock.calls[0][0])).toContain("cha_tarihi BETWEEN '2025-01-01' AND '2026-09-30'");
    const supurge = vi.mocked(mikroPost).mock.calls.find(c => c[0] === 'SqlVeriOkuV2');
    expect(String((supurge?.[1] as { SQLSorgu?: string })?.SQLSorgu)).toContain("cha_tarihi BETWEEN '2025-01-01' AND '2026-09-30'");
    expect(supurge?.[3]).toEqual({ zamanAsimiMs: listeZamanAsimiMs() });

    // sonTarih YOKKEN süpürge de `>=` kullanır.
    d.sifirla(); vi.mocked(mikroPost).mockClear(); vi.mocked(mikroSql).mockResolvedValue({ rows: [{ cha_Guid: 'g1' }], hata: null });
    await d.cagir('POST', '/api/mikro/import/cari-hareket');
    await d.isBitisi('mikroImport-cari-hareket');
    const supurge2 = vi.mocked(mikroPost).mock.calls.find(c => c[0] === 'SqlVeriOkuV2');
    expect(String((supurge2?.[1] as { SQLSorgu?: string })?.SQLSorgu)).toMatch(/cha_tarihi >= '2020-01-01'$/);
  });
});

/** Ters süpürgenin küme sağlaması sorgusu: `SELECT [takma.]<guid> AS guid FROM <tablo> <WHERE>` (sayfasız, fromEk'siz). */
const KUME_SORGUSU = /^SELECT (\w+\.)?\w+ AS guid FROM /;

// 2026-09-25: iptal edilen faturalar AYRI koleksiyona iner; Mikro'da iptal GERİ ALINAN fatura ters süpürgeyle kalkar.
// Şartname kapısı D1: iptalKolonu verilseydi süpürge `<> 0` GUID'leri, yani bu koleksiyonun KENDİ kayıtlarını silerdi.
describe('import/iptal-faturalar — ayrı koleksiyon + TERS süpürge (yalnız eksiksiz sonuçta, pencere içinde)', () => {
  const MEVCUT = [
    { id: 'g1', data: { companyId: 'A', cha_tarihi: '2026-01-05T00:00:00' } },   // hâlâ iptal → kalır
    { id: 'g2', data: { companyId: 'A', cha_tarihi: '2025-03-01T00:00:00' } },   // iptali geri alındı → SİLİNİR
    { id: 'g0', data: { companyId: 'A', cha_tarihi: '2019-12-31T00:00:00' } },   // pencere (2020+) DIŞI → kalır
    { id: 'gx', data: { companyId: 'A' } },                                      // tarih okunamıyor → kalır
  ];
  const pgKur = () => d.pgAyarla(async (sql: string, params?: unknown[]) =>
    (/SELECT id, data FROM docs WHERE coll = \$1 AND data->>'companyId' = \$2/.test(sql) && params?.[0] === 'mikroIptalFaturalar' && params?.[1] === 'A'
      ? { rows: MEVCUT } : { rows: [] }));

  it("sorgu: evrak koşulu + ISNULL(cha.cha_iptal, 0) <> 0; iptal süpürgesi YOK; yazım mikroIptalFaturalar'a; ters süpürge yalnız g2'yi siler", async () => {
    pgKur();
    // Küme sağlaması (2026-10-02): ters süpürge ancak Mikro'nun ANLIK GUID kümesi okunanla birebir aynıysa siler.
    vi.mocked(mikroSql).mockImplementation((async (sql: string) => (KUME_SORGUSU.test(sql)
      ? { rows: [{ guid: 'g1' }], hata: null }
      : { rows: [{ cha_Guid: 'g1', cha_tarihi: '2026-01-05T00:00:00', cha_tip: 0 }], hata: null })) as unknown as typeof mikroSql);
    const res = await d.cagir('POST', '/api/mikro/import/iptal-faturalar');
    expect(res.govde).toEqual({ success: true, started: true, job: 'mikroImport-iptal-faturalar' });
    const son = await d.isBitisi('mikroImport-iptal-faturalar');
    expect(son).toMatchObject({ running: false, error: null, total: 1 });
    const sql = String(vi.mocked(mikroSql).mock.calls[0][0]);
    expect(sql).toContain('(cha.cha_evrak_tip = 63 OR (cha.cha_evrak_tip = 0 AND cha.cha_cinsi = 6)) AND ISNULL(cha.cha_iptal, 0) <> 0');
    expect(vi.mocked(mikroPost).mock.calls.filter(c => c[0] === 'SqlVeriOkuV2')).toEqual([]);   // iptal süpürgesi koşmadı
    expect(d.koleksiyon('mikroIptalFaturalar').filter(y => y.op === 'set').map(y => y.ref.id)).toEqual(['g1']);
    expect(d.koleksiyon('mikroIptalFaturalar').filter(y => y.op === 'delete').map(y => y.ref.id)).toEqual(['g2']);
    expect(d.syncLog).toHaveBeenCalledWith('SQL:CARI_HESAP_HAREKETLERI cha', 'mikroIptalFaturalar',
      expect.stringContaining('1 kayıt artık sonuçta yok'), true, null, null, expect.any(Number), expect.anything());
  });

  // Şartname kapısı + inceleme 2026-10-02: sayfa döngüsü boş sayfada biter; Mikro bir ara sayfayı hatasız ama BOŞ dönerse ya da
  // OFFSET kayarsa `allRows` eksik kalır — eksik sonuca bakıp silmek geçerli kayıtları götürürdü.
  const sayfaVeKume = (sayfa: Record<string, unknown>[], kume: { rows: Record<string, unknown>[]; hata: string | null }, sorgular?: string[]) =>
    vi.mocked(mikroSql).mockImplementation((async (sql: string) => { sorgular?.push(sql); return KUME_SORGUSU.test(sql) ? kume : { rows: sayfa, hata: null }; }) as unknown as typeof mikroSql);
  const G1 = [{ cha_Guid: 'g1', cha_tarihi: '2026-01-05T00:00:00', cha_tip: 0 }];
  const silinenYok = async () => {
    await d.cagir('POST', '/api/mikro/import/iptal-faturalar');
    await d.isBitisi('mikroImport-iptal-faturalar');
    expect(d.koleksiyon('mikroIptalFaturalar').filter(y => y.op === 'delete')).toEqual([]);
  };
  it('KÜME SAĞLAMASI: Mikro\'nun anlık kümesi okunandan BÜYÜKSE ters süpürge ATLANIR; küme sorgusu `fromEk`siz ve aynı WHERE ile', async () => {
    pgKur();
    const sorgular: string[] = [];
    sayfaVeKume(G1, { rows: [{ guid: 'g1' }, { guid: 'g7' }, { guid: 'g8' }], hata: null }, sorgular);
    await silinenYok();
    expect(d.syncLog).toHaveBeenCalledWith('SQL:CARI_HESAP_HAREKETLERI cha', 'mikroIptalFaturalar',
      expect.stringContaining("ters süpürge atlandı: Mikro'daki küme okunanla aynı değil (Mikro 3, okunan 1)"), true, null, null, expect.any(Number), expect.anything());
    expect(sorgular.find(q => KUME_SORGUSU.test(q))).toBe("SELECT cha.cha_Guid AS guid FROM CARI_HESAP_HAREKETLERI cha WHERE (cha.cha_evrak_tip = 63 OR (cha.cha_evrak_tip = 0 AND cha.cha_cinsi = 6)) "
      + "AND ISNULL(cha.cha_iptal, 0) <> 0 AND cha.cha_tarihi >= '2020-01-01'");
  });
  // İnceleme 2026-10-02 (CONFIRMED): iki sayfa arasında bir kayıt silinirse OFFSET kayar — bir geçerli kayıt hiç okunmaz ama ADET
  // yine tutar (bir eksilme + bir atlama). Yalnız sayı karşılaştıran sağlama burada geçerli kaydı sildirirdi.
  it('ADET TUTUYOR ama küme FARKLI (OFFSET kayması): hiçbir şey silinmez', async () => {
    pgKur();
    sayfaVeKume([...G1, { cha_Guid: 'gD', cha_tarihi: '2026-01-06T00:00:00', cha_tip: 0 }], { rows: [{ guid: 'g1' }, { guid: 'g2' }], hata: null });
    await silinenYok();                                                        // g2 PG'de var ve okunanlarda yok — yine de SİLİNMEZ
    expect(d.syncLog).toHaveBeenCalledWith('SQL:CARI_HESAP_HAREKETLERI cha', 'mikroIptalFaturalar',
      expect.stringContaining("Mikro'daki küme okunanla aynı değil (Mikro 2, okunan 2)"), true, null, null, expect.any(Number), expect.anything());
  });
  it('anlık küme okunamazsa (hata / boş yanıt) ters süpürge ATLANIR', async () => {
    for (const kume of [{ rows: [], hata: 'timeout' }, { rows: [], hata: null }]) {
      d.sifirla(); pgKur();
      sayfaVeKume(G1, kume);
      await silinenYok();
    }
  });
  it('SİLME TAVANI: 20\'den fazla ve pencerenin %10\'undan fazlası silinecekse HİÇBİRİ silinmez (yanlış firmaya dönen bağlantı)', async () => {
    const cok = [{ id: 'g1', data: { companyId: 'A', cha_tarihi: '2026-01-05T00:00:00' } },
      ...Array.from({ length: 30 }, (_, i) => ({ id: `eski${i}`, data: { companyId: 'A', cha_tarihi: '2025-06-01T00:00:00' } }))];
    d.pgAyarla(async (sql: string) => (/SELECT id, data FROM docs WHERE coll = \$1/.test(sql) ? { rows: cok } : { rows: [] }));
    sayfaVeKume(G1, { rows: [{ guid: 'g1' }], hata: null });
    await silinenYok();
    expect(d.syncLog).toHaveBeenCalledWith('SQL:CARI_HESAP_HAREKETLERI cha', 'mikroIptalFaturalar',
      expect.stringContaining('30 / 31 kayıt silinecekti — OLAĞANDIŞI'), true, null, null, expect.any(Number), expect.anything());
  });

  it('üst sınır (sonTarih) verilirse sonuç eksiksiz DEĞİL → ters süpürge atlanır ve söylenir; hiçbir şey silinmez', async () => {
    pgKur();
    vi.mocked(mikroSql).mockResolvedValue({ rows: [{ cha_Guid: 'g1', cha_tarihi: '2026-01-05T00:00:00' }], hata: null });
    await d.cagir('POST', '/api/mikro/import/iptal-faturalar', { sonTarih: '2026-09-30' });
    await d.isBitisi('mikroImport-iptal-faturalar');
    expect(d.koleksiyon('mikroIptalFaturalar').filter(y => y.op === 'delete')).toEqual([]);
    expect(d.syncLog).toHaveBeenCalledWith('SQL:CARI_HESAP_HAREKETLERI cha', 'mikroIptalFaturalar',
      expect.stringContaining('ters süpürge atlandı (sonuç eksiksiz değil)'), true, null, null, expect.any(Number), expect.anything());
  });

  it('BOŞ sonuçta ters süpürge atlanır (okunamayan yanıt da `rows: []` döner) — hiçbir şey silinmez', async () => {
    pgKur();
    vi.mocked(mikroSql).mockResolvedValue({ rows: [], hata: null });
    await d.cagir('POST', '/api/mikro/import/iptal-faturalar');
    await d.isBitisi('mikroImport-iptal-faturalar');
    expect(d.koleksiyon('mikroIptalFaturalar').filter(y => y.op === 'delete')).toEqual([]);
    expect(d.syncLog).toHaveBeenCalledWith('SQL:CARI_HESAP_HAREKETLERI cha', 'mikroIptalFaturalar',
      expect.stringContaining('ters süpürge atlandı (sonuç boş'), true, null, null, expect.any(Number), expect.anything());
  });

  it('sayfa TAVANINA çarpılırsa (sonuç eksik) ters süpürge atlanır', async () => {
    pgKur();
    let n = 0;
    vi.mocked(mikroSql).mockImplementation((async () => ({
      rows: Array.from({ length: 500 }, () => ({ cha_Guid: `p${n++}`, cha_tarihi: '2026-01-05T00:00:00' })), hata: null,
    })) as unknown as typeof mikroSql);
    await d.cagir('POST', '/api/mikro/import/iptal-faturalar');
    await d.isBitisi('mikroImport-iptal-faturalar');
    expect(d.koleksiyon('mikroIptalFaturalar').filter(y => y.op === 'delete')).toEqual([]);
    expect(d.syncLog).toHaveBeenCalledWith('SQL:CARI_HESAP_HAREKETLERI cha', 'mikroIptalFaturalar',
      expect.stringContaining('ters süpürge atlandı (sonuç eksiksiz değil)'), true, null, null, expect.any(Number), expect.anything());
  });

  it("GUID'siz satır varsa (eşleşme kurulamaz) ters süpürge atlanır", async () => {
    pgKur();
    vi.mocked(mikroSql).mockResolvedValue({ rows: [{ cha_tarihi: '2026-01-05T00:00:00' }], hata: null });
    await d.cagir('POST', '/api/mikro/import/iptal-faturalar');
    await d.isBitisi('mikroImport-iptal-faturalar');
    expect(d.koleksiyon('mikroIptalFaturalar').filter(y => y.op === 'delete')).toEqual([]);
  });
});

// 2026-10-02: Mikro kayıt SİLEBİLİYOR (satış 325 — Cetpa 709 / Mikro 708). İptal süpürgesi yalnız `<> 0` GUID'leri görür;
// silinen fatura yetim kalıp ciro/KDV'ye katılıyordu → fatura-listesi de ters süpürgeli (iptal süpürgesiyle BİRLİKTE).
describe('import/fatura-listesi — Mikro\'dan SİLİNEN fatura ters süpürgeyle kalkar', () => {
  const MEVCUT = [
    { id: 'f1', data: { companyId: 'A', cha_tarihi: '2026-09-01 00:00:00' } },   // Mikro'da duruyor → kalır
    { id: 'f325', data: { companyId: 'A', cha_tarihi: '2026-08-06 00:00:00' } }, // Mikro'dan silinmiş → SİLİNİR
    { id: 'eski', data: { companyId: 'A', cha_tarihi: '2019-05-01 00:00:00' } }, // pencere (2020+) dışı → kalır
  ];
  const kur = (mikroAdet: number) => {
    d.pgAyarla(async (sql: string, params?: unknown[]) =>
      (/SELECT id, data FROM docs WHERE coll = \$1 AND data->>'companyId' = \$2/.test(sql) && params?.[0] === 'mikroFaturalar' && params?.[1] === 'A'
        ? { rows: MEVCUT } : { rows: [] }));
    vi.mocked(mikroKolonlar).mockResolvedValue(['cha_Guid', 'cha_iptal', 'cha_tarihi']);
    vi.mocked(mikroPost).mockImplementation((async () => ({ ok: true, status: 200, data: { result: [{ Data: [] }] } })) as unknown as typeof mikroPost);
    vi.mocked(mikroSql).mockImplementation((async (sql: string) => (KUME_SORGUSU.test(sql)
      ? { rows: Array.from({ length: mikroAdet }, (_, i) => ({ guid: `f${i + 1}` })), hata: null }
      : { rows: [{ cha_Guid: 'f1', cha_tarihi: '2026-09-01 00:00:00', cha_tip: 0, cha_meblag: 100, kdvTutari: 20 }], hata: null })) as unknown as typeof mikroSql);
  };
  it('yetim kopya silinir, duran ve pencere dışı kalır; iptal süpürgesi de koşar; özet "Mikro\'da artık yok"', async () => {
    kur(1);
    await d.cagir('POST', '/api/mikro/import/fatura-listesi');
    await d.isBitisi('mikroImport-fatura-listesi');
    expect(d.koleksiyon('mikroFaturalar').filter(y => y.op === 'delete').map(y => y.ref.id)).toEqual(['f325']);
    expect(vi.mocked(mikroPost).mock.calls.filter(c => c[0] === 'SqlVeriOkuV2')).toHaveLength(1);          // iptal süpürgesi
    expect(d.syncLog).toHaveBeenCalledWith('SQL:CARI_HESAP_HAREKETLERI cha', 'mikroFaturalar',
      expect.stringContaining("1 kayıt Mikro'da artık yok (silinmiş ya da koşuldan çıkmış), kaldırıldı"), true, null, null, expect.any(Number), expect.anything());
  });
  it('anlık küme okunandan büyükse (eksik sayfa) HİÇBİR fatura silinmez', async () => {
    kur(2);
    await d.cagir('POST', '/api/mikro/import/fatura-listesi');
    await d.isBitisi('mikroImport-fatura-listesi');
    expect(d.koleksiyon('mikroFaturalar').filter(y => y.op === 'delete')).toEqual([]);
  });

});

// Şartname «Mikro bağlantı A» A9 (2026-11-05): `cari-hareket` tanımı `iptalKolonu` + `gecePenceresi: 'tam'` taşıyordu ama ters
// süpürgesi yoktu; Mikro'dan FİZİKSEL silinen hareket Cetpa'da yetim kalıp Cari Ekstre / Tahsilat'ta sayılıyordu (canlı Cetpa
// 1.699 / Mikro 1.695). Koruma ortak gövdedir (fatura-listesi / iptal-faturalar testleri); burada TANIMIN ona bağlandığı çitlenir.
describe('import/cari-hareket · Mikro\'dan SİLİNEN hareket ters süpürgeyle kalkar (A9)', () => {
  const MEVCUT = [
    { id: 'h1', data: { companyId: 'A', cha_tarihi: '2026-09-01 00:00:00' } },    // Mikro'da duruyor → kalır
    { id: 'h9', data: { companyId: 'A', cha_tarihi: '2026-08-06 00:00:00' } },    // Mikro'dan silinmiş → SİLİNİR
    { id: 'eski', data: { companyId: 'A', cha_tarihi: '2019-05-01 00:00:00' } },  // pencere (2020+) dışı → kalır
    { id: 'tarihsiz', data: { companyId: 'A' } },                                 // `cha_tarihi` taşımıyor → aday değil
  ];
  const H1 = [{ cha_Guid: 'h1', cha_tarihi: '2026-09-01 00:00:00', cha_tip: 0, cha_meblag: 100 }];
  const kur = (mevcut: typeof MEVCUT, sayfa: Record<string, unknown>[], kume: { rows: Record<string, unknown>[]; hata: string | null }, sorgular?: string[]) => {
    d.pgAyarla(async (sql: string, params?: unknown[]) =>
      (/SELECT id, data FROM docs WHERE coll = \$1 AND data->>'companyId' = \$2/.test(sql) && params?.[0] === 'mikroCariHareketler' && params?.[1] === 'A'
        ? { rows: mevcut } : { rows: [] }));
    vi.mocked(mikroKolonlar).mockResolvedValue(['cha_Guid', 'cha_iptal', 'cha_tarihi']);
    // İptal süpürgesi (SqlVeriOkuV2) boş döner: silmeyi YALNIZ ters süpürge yapabilir.
    vi.mocked(mikroPost).mockImplementation((async () => ({ ok: true, status: 200, data: { result: [{ Data: [] }] } })) as unknown as typeof mikroPost);
    vi.mocked(mikroSql).mockImplementation((async (sql: string) => { sorgular?.push(sql); return KUME_SORGUSU.test(sql) ? kume : { rows: sayfa, hata: null }; }) as unknown as typeof mikroSql);
  };
  const kos = async () => {
    await d.cagir('POST', '/api/mikro/import/cari-hareket');
    await d.isBitisi('mikroImport-cari-hareket');
    return d.koleksiyon('mikroCariHareketler').filter(y => y.op === 'delete').map(y => y.ref.id);
  };

  it("tanım çiti (davranışla): Mikro'da olmayan GUID'li belge silinir; pencere dışı ve `cha_tarihi` taşımayan belge KALIR; küme sorgusu takma adsız ve fromEk'siz", async () => {
    const sorgular: string[] = [];
    kur(MEVCUT, H1, { rows: [{ guid: 'h1' }], hata: null }, sorgular);
    expect(await kos()).toEqual(['h9']);
    expect(sorgular.find(q => KUME_SORGUSU.test(q)))
      .toBe("SELECT cha_Guid AS guid FROM CARI_HESAP_HAREKETLERI WHERE ISNULL(cha_iptal, 0) = 0 AND cha_tarihi >= '2020-01-01'");
    expect(d.syncLog).toHaveBeenCalledWith('SQL:CARI_HESAP_HAREKETLERI', 'mikroCariHareketler',
      expect.stringContaining("1 kayıt Mikro'da artık yok (silinmiş ya da koşuldan çıkmış), kaldırıldı"), true, null, null, expect.any(Number), expect.anything());
  });

  it('küme UYUŞMAZLIĞINDA (Mikro anlık kümesi okunandan büyük) hiçbir hareket silinmez', async () => {
    kur(MEVCUT, H1, { rows: [{ guid: 'h1' }, { guid: 'h7' }], hata: null });
    expect(await kos()).toEqual([]);
    expect(d.syncLog).toHaveBeenCalledWith('SQL:CARI_HESAP_HAREKETLERI', 'mikroCariHareketler',
      expect.stringContaining("ters süpürge atlandı: Mikro'daki küme okunanla aynı değil (Mikro 2, okunan 1)"), true, null, null, expect.any(Number), expect.anything());
  });

  it('BOŞ sonuçta hiçbir hareket silinmez (okunamayan yanıt da `rows: []` döner)', async () => {
    kur(MEVCUT, [], { rows: [], hata: null });
    expect(await kos()).toEqual([]);
    expect(d.syncLog).toHaveBeenCalledWith('SQL:CARI_HESAP_HAREKETLERI', 'mikroCariHareketler',
      expect.stringContaining('ters süpürge atlandı (sonuç boş'), true, null, null, expect.any(Number), expect.anything());
  });

  it('SİLME TAVANI: 100 belgeden 25\'i silinecekken (20\'den fazla VE %10\'dan fazla) HİÇBİRİ silinmez', async () => {
    const yuz = Array.from({ length: 100 }, (_, i) => ({ id: `h${i}`, data: { companyId: 'A', cha_tarihi: '2026-09-01 00:00:00' } }));
    const duran = yuz.slice(0, 75).map(x => ({ cha_Guid: x.id, cha_tarihi: '2026-09-01 00:00:00', cha_tip: 0, cha_meblag: 1 }));
    kur(yuz, duran, { rows: duran.map(r => ({ guid: r.cha_Guid })), hata: null });
    expect(await kos()).toEqual([]);
    expect(d.syncLog).toHaveBeenCalledWith('SQL:CARI_HESAP_HAREKETLERI', 'mikroCariHareketler',
      expect.stringContaining('25 / 100 kayıt silinecekti — OLAĞANDIŞI'), true, null, null, expect.any(Number), expect.anything());
  });
});

// AH11 (2026-11-05): stok hareketi ters süpürgesi Dilim A'dan ÇIKTI (kullanıcıya soru 20). `inventoryMovements` karma koleksiyon
// (Cetpa + Mikro): Mikro'da GUID'i olmayan, pencere içi `sth_tarih` taşıyan belge bile SİLİNMEZ. Karar kodda kilitli olsun:
// tanıma `tersSupurge` eklenirse bu test kırmızı (paket mutasyonu kaçıyordu, 2026-11-05).
describe('import/stok-hareket · ters süpürge YOK (AH11)', () => {
  it("Mikro'da olmayan GUID'li, pencere içi `sth_tarih`'li `inventoryMovements` belgesi KALIR; küme sorgusu hiç atılmaz", async () => {
    const sorgular: string[] = [];
    d.pgAyarla(async (sql: string, params?: unknown[]) =>
      (/SELECT id, data FROM docs WHERE coll = \$1 AND data->>'companyId' = \$2/.test(sql) && params?.[0] === 'inventoryMovements' && params?.[1] === 'A'
        ? { rows: [
          { id: 's1', data: { companyId: 'A', sth_tarih: '2026-09-01 00:00:00' } },
          { id: 's9', data: { companyId: 'A', sth_tarih: '2026-09-02 00:00:00' } },
        ] } : { rows: [] }));
    vi.mocked(mikroKolonlar).mockResolvedValue(['sth_Guid', 'sth_iptal', 'sth_tarih']);
    vi.mocked(mikroPost).mockImplementation((async () => ({ ok: true, status: 200, data: { result: [{ Data: [] }] } })) as unknown as typeof mikroPost);
    vi.mocked(mikroSql).mockImplementation((async (sql: string) => {
      sorgular.push(sql);
      return KUME_SORGUSU.test(sql) ? { rows: [{ guid: 's1' }], hata: null }
        : { rows: [{ sth_Guid: 's1', sth_tarih: '2026-09-01 00:00:00', sth_stok_kod: 'CMT-1', sth_miktar: 2 }], hata: null };
    }) as unknown as typeof mikroSql);
    await d.cagir('POST', '/api/mikro/import/stok-hareket');
    await d.isBitisi('mikroImport-stok-hareket');
    expect(d.koleksiyon('inventoryMovements').filter(y => y.op === 'delete').map(y => y.ref.id)).toEqual([]);
    expect(sorgular.filter(q => KUME_SORGUSU.test(q))).toEqual([]);
  });
});

describe('(b) KİLİT: süreç-geneli TEK iş — farklı isAdi de alreadyRunning, job = ÇALIŞAN iş', () => {
  it('stok sürerken ikinci stok VE cari isteği alreadyRunning; mikroPost sayısı artmaz; jobs\'a ikinci set yok; bitince üçüncü başlar', async () => {
    const sayfa = ertelenen<MikroYanit>();
    vi.mocked(mikroPost).mockImplementation((async (metot: string) => metot === 'StokListesiV2' ? sayfa.soz : HATA) as unknown as typeof mikroPost);
    await d.cagir('POST', '/api/mikro/import/stok');
    await vi.waitFor(() => expect(mikroPost).toHaveBeenCalledWith('StokListesiV2', expect.anything(), false, expect.anything()));
    const cagriSayisi = vi.mocked(mikroPost).mock.calls.length;

    const ayni = await d.cagir('POST', '/api/mikro/import/stok');
    expect(ayni.govde).toEqual({ success: true, started: false, alreadyRunning: true, job: 'mikroImport-stok' });
    const farkli = await d.cagir('POST', '/api/mikro/import/cari');
    expect(farkli.govde).toEqual({ success: true, started: false, alreadyRunning: true, job: 'mikroImport-stok' });
    const sql = await d.cagir('POST', '/api/mikro/import/cari-hareket');
    expect(sql.govde).toEqual({ success: true, started: false, alreadyRunning: true, job: 'mikroImport-stok' });
    expect(vi.mocked(mikroPost).mock.calls.length).toBe(cagriSayisi);
    expect(mikroSql).not.toHaveBeenCalled();
    expect(d.koleksiyon('jobs')).toHaveLength(1);

    sayfa.coz(liste('StokListesi', []));
    await d.isBitisi('mikroImport-stok');
    vi.mocked(mikroPost).mockResolvedValue(liste('CariListesi', []));
    const ucuncu = await d.cagir('POST', '/api/mikro/import/cari');
    expect(ucuncu.govde).toEqual({ success: true, started: true, job: 'mikroImport-cari' });
  });
});

// Delta hakem 2026-09-25 (bulgu 3/8, CONFIRMED): kısa devre V17 yoklamasının ARKASINA kaymıştı. HEAD 2582:
// "Kısa devre ÖNCE: iş zaten koşuyorsa hiçbir yoklama/sorgu maliyeti ödeme". Kilit doluyken yoklama koşan işe
// paralel Mikro'ya gidiyor; yük altında düşerse false 10 dk önbelleğe giriyor → yanıltıcı 501 (hakem üretti).
describe('(b2) stok-miktar: kısa devre + bakım kilidi V17 YOKLAMASINDAN ÖNCE (HEAD 2582 kuralı)', () => {
  it("stok sürerken stok-miktar → alreadyRunning(job:'mikroImport-stok'); V17 yoklaması ÇAĞRILMAZ, GenelAmacliMaliyetListesiV2 0, 501 YOK", async () => {
    const sayfa = ertelenen<MikroYanit>();
    vi.mocked(mikroPost).mockImplementation((async (metot: string) => metot === 'StokListesiV2' ? sayfa.soz : HATA) as unknown as typeof mikroPost);
    await d.cagir('POST', '/api/mikro/import/stok');
    await vi.waitFor(() => expect(mikroPost).toHaveBeenCalledWith('StokListesiV2', expect.anything(), false, expect.anything()));

    const res = await d.cagir('POST', '/api/mikro/import/stok-miktar');
    expect(res.kod).toBe(200);
    expect(res.govde).toEqual({ success: true, started: false, alreadyRunning: true, job: 'mikroImport-stok' });
    expect(v17MetoduKullanilabilir).not.toHaveBeenCalled();
    expect(vi.mocked(mikroPost).mock.calls.filter(c => c[0] === 'GenelAmacliMaliyetListesiV2')).toHaveLength(0);

    sayfa.coz(liste('StokListesi', []));
    await d.isBitisi('mikroImport-stok');
  });

  it('bakım kilidi varken stok-miktar 423 — V17 yoklaması ÇAĞRILMAZ (HEAD: 423 ilk adımdı)', async () => {
    d.kilitAyarla({ aciklama: 'lead-birlestir', baslangic: '2026-09-05T12:00:00.000Z' });
    miktarDuzenegi(() => HATA);
    const res = await d.cagir('POST', '/api/mikro/import/stok-miktar');
    expect(res.kod).toBe(423);
    expect(v17MetoduKullanilabilir).not.toHaveBeenCalled();
    expect(d.yazilan).toEqual([]);
  });
});

describe('(c) istisna: syncLog(false) HER ZAMAN ve TAM 1 kez; bekle çözülür; kilit sızmaz', () => {
  it("stok: mikroPost throw('ağ') → syncLog('ImportStok','inventory','bulk',false,null,'ağ') ×1; jobs { running:false, error:'ağ' }; ardından üçüncü istek started", async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(mikroPost).mockRejectedValue(new Error('ağ'));
    const res = await d.cagir('POST', '/api/mikro/import/stok');
    expect(res.govde).toMatchObject({ started: true });
    const son = await d.isBitisi('mikroImport-stok');
    expect(son).toMatchObject({ running: false, error: 'ağ', finishedAt: 'TS' });
    expect(d.syncLog).toHaveBeenCalledTimes(1);
    expect(d.syncLog).toHaveBeenCalledWith('ImportStok', 'inventory', 'bulk', false, null, 'ağ', expect.any(Number), expect.anything());
    expect((await d.cagir('POST', '/api/mikro/import/stok')).govde).toMatchObject({ started: true });
  });

  it("cari: throw → ('ImportCari','lead','bulk',false,null,'ağ') ×1", async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(mikroPost).mockRejectedValue(new Error('ağ'));
    await d.cagir('POST', '/api/mikro/import/cari');
    await d.isBitisi('mikroImport-cari');
    expect(d.syncLog).toHaveBeenCalledTimes(1);
    expect(d.syncLog).toHaveBeenCalledWith('ImportCari', 'lead', 'bulk', false, null, 'ağ', expect.any(Number), expect.anything());
  });

  it("stok-miktar: istisnada ARTIK syncLog(false) yazılır (bugün yazmıyordu — kabul edilen sapma 1); jobs error", async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    miktarDuzenegi(() => HATA);
    vi.mocked(mikroSql).mockRejectedValue(new Error('sql patladı'));   // per-depo SQL calistir içinde
    const res = await d.cagir('POST', '/api/mikro/import/stok-miktar');
    expect(res.govde).toMatchObject({ started: true, job: 'stokMiktarImport' });
    const son = await d.isBitisi('stokMiktarImport');
    expect(son).toMatchObject({ running: false, error: 'sql patladı' });
    expect(d.syncLog).toHaveBeenCalledTimes(1);
    expect(d.syncLog).toHaveBeenCalledWith('GenelAmacliMaliyetListesiV2', 'inventory', 'bulk', false, null, 'sql patladı', expect.any(Number), expect.anything());
  });
});

describe('(d) cron paritesi: SQL_IMPORT_TANIMLARI → mikroSqlImportCalistir DOĞRUDAN; pencere K-B', () => {
  it("03:20: cari-hareket + fatura-listesi + iptal-faturalar TAM (>= '2000-01-01'), siparis/stok-hareket 90 gün, BETWEEN YOK, üst sınır YOK; sayfa + süpürge zaman aşımı 120 sn (env 600 sn'ye kadar); arkaPlanIsiBaslat HİÇ; syncLog tanım başına 1", async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-09-24T12:00:00Z') });
    vi.stubEnv('MIKRO_CRON_SYNC', 'true');
    vi.stubEnv('MIKRO_CRON_COMPANY_ID', 'A');
    vi.stubEnv('MIKRO_LISTE_ZAMAN_ASIMI_MS', undefined);   // varsayılan (120 sn) iddia edilir — ortamdan sızan değer ölçüyü bozmasın
    vi.mocked(cron.schedule).mockClear();
    const dc = duzenekKur();
    const sorgular: string[] = [];
    const secenekler: unknown[] = [];
    vi.mocked(mikroSql).mockImplementation((async (sql: string, secenek?: unknown) => { sorgular.push(sql); secenekler.push(secenek); return { rows: [], hata: null }; }) as unknown as typeof mikroSql);
    // İptal süpürgesi (fatura-listesi, cari-hareket, stok-hareket) GERÇEKTEN koşsun: şema GUID + iptal kolonunu
    // verir; diğer tablolar [] (şema okunamadı → yazılan adla devam — bugünkü davranış). Süpürge mikroSql'i
    // DEĞİL doğrudan mikroPost('SqlVeriOkuV2')'yi çağırır; boş Data → silinecek yok, syncLog sayısı değişmez.
    vi.mocked(mikroKolonlar).mockImplementation(async (tablo: string) =>
      tablo === 'CARI_HESAP_HAREKETLERI' ? ['cha_Guid', 'cha_iptal', 'cha_tarihi']
        : tablo === 'STOK_HAREKETLERI' ? ['sth_Guid', 'sth_iptal', 'sth_tarih'] : []);
    vi.mocked(mikroPost).mockImplementation((async () => ({ ok: true, status: 200, data: { result: [{ Data: [] }] } })) as unknown as typeof mikroPost);
    // Gece bakiye adımı (A3, AH6.1) da SqlVeriOkuV2 çağırır: iptal süpürgesi sayımından SQL metniyle (`AS bakiye`) ayrılır.
    const bakiyeSorgusuMu = (c: unknown[]) => String((c[1] as { SQLSorgu?: string } | undefined)?.SQLSorgu).includes('AS bakiye');
    const supurgeler = () => vi.mocked(mikroPost).mock.calls.filter(c => c[0] === 'SqlVeriOkuV2' && !bakiyeSorgusuMu(c));
    // Stok miktarı adımı (A1 / AH1, son adım): yoklama sonucu AÇIKÇA verilir (AH7; gerçek önbellek sıraya bağlı) → «geçmedi» satırı.
    vi.mocked(v17MetoduKullanilabilir).mockResolvedValueOnce(false);
    const gece = vi.mocked(cron.schedule).mock.calls.find(c => c[0] === '20 3 * * *');
    expect(gece, 'gece cron kayıtlı').toBeDefined();
    await (gece![1] as () => Promise<void>)();   // ! : üstteki iddia tanımlı olduğunu kanıtladı

    expect(sorgular.some(s => s.includes("FROM CARI_HESAP_HAREKETLERI WHERE ISNULL(cha_iptal, 0) = 0 AND cha_tarihi >= '2000-01-01' ORDER BY"))).toBe(true);
    expect(sorgular.some(s => s.includes("cha.cha_tarihi >= '2000-01-01'"))).toBe(true);     // fatura-listesi (alt küme)
    // Matrah (2026-09-29): fatura-listesi seçimi şemadan üretilir (secimUret → faturaListesiSorgusu). Bu sahte şemada
    // cha_aratoplam/ft iskonto yok → başlık matrahı NULL; seçim yine matrah/KDV alanlarını taşır.
    expect(sorgular.some(s => s.includes("cha.cha_tarihi >= '2000-01-01'") && s.includes('CROSS APPLY (SELECT CAST(NULL AS FLOAT) AS bm) b')
      && s.includes('AS matrahKaynagi'))).toBe(true);
    expect(sorgular.some(s => s.includes("sip_tarih >= '2026-06-26'"))).toBe(true);           // 90 gün (ÖLÇÜLMEDİ → kalır)
    expect(sorgular.some(s => s.includes("sth_tarih >= '2026-06-26'"))).toBe(true);
    expect(sorgular.filter(s => /BETWEEN/.test(s))).toEqual([]);
    expect(arkaPlanIsiBaslat).not.toHaveBeenCalled();
    // 13 tanım (2026-09-25: + iptal-faturalar) → cari bakiye (2026-11-05, «Mikro bağlantı A» A3: SQL döngüsünden SONRA; boş
    // `Data` → «satır yok», true) → GİB durum taraması (2026-10-02) → faturadan sipariş (2026-10-18, «fatura gövde + gece MF» G3;
    // satış faturası yok → «bulunamadı», true) → stok miktarı (A1 / AH1, SON adım; yoklama false → «geçmedi», false).
    expect(dc.syncLog).toHaveBeenCalledTimes(17);
    expect(dc.syncLog).toHaveBeenNthCalledWith(14, 'SQL:CARI_HESAP_HAREKETLERI', 'cariBalances', 'satır yok; bakiye yazılmadı', true, null, null, expect.any(Number),
      { uid: 'system', email: '' }, undefined, { denetimKiracisi: 'A' });
    expect(dc.syncLog).toHaveBeenNthCalledWith(15, 'EBelgeDurumSorgulamaV2', 'mikroFaturalar', expect.stringContaining('GİB durum taraması'), true, null, null, expect.any(Number), expect.anything());
    expect(dc.syncLog).toHaveBeenNthCalledWith(16, 'faturadan-siparis', 'orders', expect.stringContaining('Satış faturası bulunamadı'), true, null, null, expect.any(Number),
      { uid: 'system', email: '' }, undefined, { denetimKiracisi: 'A' });
    expect(dc.syncLog).toHaveBeenLastCalledWith('GenelAmacliMaliyetListesiV2', 'inventory', 'gece senkronu', false, null, 'V17 yoklaması geçmedi; stok miktarı çekilmedi',
      expect.any(Number), { uid: 'system', email: '' }, undefined, { denetimKiracisi: 'A' });
    // Bakiye sorgusu gecede TAM BİR kez (AH6.1).
    expect(vi.mocked(mikroPost).mock.calls.filter(c => c[0] === 'SqlVeriOkuV2' && bakiyeSorgusuMu(c))).toHaveLength(1);
    // iptal-faturalar: fatura-listesiyle AYNI evrak koşulu + `<> 0`; iptal süpürgesi YOK (kendi yazdığını silerdi).
    expect(sorgular.some(s => s.includes('ISNULL(cha.cha_iptal, 0) <> 0') && s.includes("cha.cha_tarihi >= '2000-01-01'"))).toBe(true);
    // BİLİNÇLİ FARK (S5/K-A ortak gövde; kapanış hakemi 2026-09-25): cron'un ÇAĞRI deseni değişmedi, ama
    // sayfa sorgusu ve iptal süpürgesi artık listeZamanAsimiMs() taşır → gece/aylık cron'da sayfa zaman aşımı
    // 30 sn (server.ts global yaması) → 120 sn. SQL yolunda devre kesici YOK: asılı Mikro'da tanım başına bir
    // zaman aşımı (12 × 120 sn ≈ 24 dk; HEAD ≈ 6 dk). Bu iddialar farkı KİLİTLER — seçenek yalnız HTTP yoluna
    // daraltılırsa (ör. `ilerle ? {…} : undefined`) ya da varsayılan değişirse KIRMIZI.
    expect(secenekler).toEqual(new Array(13).fill({ zamanAsimiMs: 120_000 }));
    expect(supurgeler().map(c => c[3])).toEqual(new Array(3).fill({ zamanAsimiMs: 120_000 }));
    expect(supurgeler().filter(c => /BETWEEN/.test(String((c[1] as { SQLSorgu?: string }).SQLSorgu)))).toEqual([]);   // süpürge de üst sınırsız (hakem 7)

    // Aylık TAM senkron da üst sınırsız; env tavanı (600 sn) cron'a da ULAŞIR → asılı Mikro'da ≈ 12 × 600 sn.
    sorgular.length = 0; secenekler.length = 0; vi.mocked(mikroPost).mockClear();
    vi.stubEnv('MIKRO_LISTE_ZAMAN_ASIMI_MS', '600000');
    const aylik = vi.mocked(cron.schedule).mock.calls.find(c => c[0] === '0 2 1 * *');
    await (aylik![1] as () => Promise<void>)();   // ! : kayıt yoksa test zaten patlar
    expect(sorgular.length).toBe(13);
    expect(sorgular.filter(s => /BETWEEN/.test(s))).toEqual([]);
    expect(sorgular.filter(s => s.includes("cha_tarihi >= '2000-01-01'"))).toHaveLength(3);
    expect(secenekler).toEqual(new Array(13).fill({ zamanAsimiMs: 600_000 }));
    expect(supurgeler().map(c => c[3])).toEqual(new Array(3).fill({ zamanAsimiMs: 600_000 }));
    vi.useRealTimers(); vi.unstubAllEnvs();
  });

  it('matrah: STOK_HAREKETLERI şeması OKUNAMAZSA (mikroKolonlar fırlatır) fatura-listesi matrah/KDV SEÇMEZ ve özet "GÜNCELLENMEDİ" der', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-09-24T12:00:00Z') });
    vi.stubEnv('MIKRO_CRON_SYNC', 'true');
    vi.stubEnv('MIKRO_CRON_COMPANY_ID', 'A');
    vi.mocked(cron.schedule).mockClear();
    const dc = duzenekKur();
    const sorgular: string[] = [];
    // fatura-listesi sayfası BİR satır döndürür → postProcess koşar (şema okunamadığı için satırda matrah/kdvTutari YOK).
    let faturaSayfasi = 0;
    vi.mocked(mikroSql).mockImplementation((async (sql: string) => {
      sorgular.push(sql);
      const fatura = sql.includes("cha.cha_tarihi >= '2000-01-01'") && !sql.includes('<> 0') && sql.includes('OFFSET 0 ROWS');
      return { rows: fatura && faturaSayfasi++ === 0 ? [{ cha_Guid: 'g1', cha_meblag: 120 }] : [], hata: null };
    }) as unknown as typeof mikroSql);
    vi.mocked(mikroKolonlar).mockImplementation(async (tablo: string) => {
      if (tablo === 'STOK_HAREKETLERI') throw new Error('INFORMATION_SCHEMA zaman aşımı');
      return tablo === 'CARI_HESAP_HAREKETLERI' ? ['cha_Guid', 'cha_iptal', 'cha_tarihi', 'cha_aratoplam', 'cha_ft_iskonto1'] : [];
    });
    vi.mocked(mikroPost).mockImplementation((async () => ({ ok: true, status: 200, data: { result: [{ Data: [] }] } })) as unknown as typeof mikroPost);
    vi.mocked(v17MetoduKullanilabilir).mockResolvedValueOnce(false);   // AH7: stok adımı gerçek önbelleğe dayanmasın
    const gece = vi.mocked(cron.schedule).mock.calls.find(c => c[0] === '20 3 * * *');
    await (gece![1] as () => Promise<void>)();   // ! : önceki test gece cron'un kayıtlı olduğunu kanıtladı
    const fatura = sorgular.filter(s => s.includes("cha.cha_tarihi >= '2000-01-01'") && !s.includes('<> 0'));
    expect(fatura).toHaveLength(1);
    expect(fatura[0]).toMatch(/^SELECT cha\.\* FROM CARI_HESAP_HAREKETLERI cha WHERE /);
    expect(fatura[0]).not.toMatch(/AS matrah|kdvTutari/);
    const ozetler = dc.syncLog.mock.calls.map(c => String(c[2]));
    expect(ozetler.some(o => o.includes('GÜNCELLENMEDİ'))).toBe(true);
    // postProcess "KDV BİLİNMİYOR" DEMEZ (değerler korunuyor; inceleme 2026-09-29 — üç ajan bağımsız buldu).
    const faturaOzeti = ozetler.find(o => o.includes('GÜNCELLENMEDİ')) ?? '';
    expect(faturaOzeti).toContain('bu koşuda seçilmedi');
    expect(faturaOzeti).not.toContain('BİLİNMİYOR');
    vi.useRealTimers(); vi.unstubAllEnvs();
  });
});

describe('(e) zaman aşımı AYRI sayılır: import EKSİK → success:false; yalnız bozuk → success:true (parite)', () => {
  /** 100'lük sayfa ve 0. kaydı içeren her alt aralık `davranis`; diğer aralıklar boş (liste bitti). */
  const daraltmaDuzenegi = (davranis: () => MikroYanit | Promise<MikroYanit>) => {
    vi.mocked(mikroPost).mockImplementation((async (metot: string, govde: Record<string, unknown>) => {
      if (metot !== 'StokListesiV2') return HATA;
      if (Number(govde.Index) === 0) return davranis();
      return liste('StokListesi', []);
    }) as unknown as typeof mikroPost);
  };

  it("TimeoutError zinciri (100→20→5→1) → zamanAsimiKayit:1, bozukKayit:0, özet 'zaman aşımıyla ATLANDI', basarili:false, syncLog success=false", async () => {
    daraltmaDuzenegi(() => Promise.reject(zamanAsimi()));
    await d.cagir('POST', '/api/mikro/import/stok');
    const son = await d.isBitisi('mikroImport-stok');
    expect(son).toMatchObject({ running: false, bozukKayit: 0, zamanAsimiSayfa: 4, zamanAsimiKayit: 1 });
    expect(String(son?.error)).toContain('1 kayıt zaman aşımıyla atlandı');
    expect(d.syncLog).toHaveBeenCalledWith('ImportStok', 'inventory', expect.stringContaining('1 kayıt zaman aşımıyla ATLANDI — import EKSİK, yeniden çalıştırın'), false, null, expect.stringContaining('zaman aşımı'), expect.any(Number), expect.anything());
  });

  it("yalnız bozuk kayıt (Api Server Error) → bozukKayit:1, zamanAsimiKayit:0, error null, syncLog success=true, özet 'bozuk atlandı'", async () => {
    daraltmaDuzenegi(() => HATA);
    await d.cagir('POST', '/api/mikro/import/stok');
    const son = await d.isBitisi('mikroImport-stok');
    expect(son).toMatchObject({ running: false, bozukKayit: 1, zamanAsimiSayfa: 0, zamanAsimiKayit: 0, error: null });
    expect(d.syncLog).toHaveBeenCalledWith('ImportStok', 'inventory', expect.stringContaining('1 bozuk atlandı'), true, null, null, expect.any(Number), expect.anything());
  });

  it('cari: eski `!ok → break` sessiz bitişi yerine daraltma — bozuk sayfa sayılır, devam edilir', async () => {
    vi.mocked(mikroPost).mockImplementation((async (metot: string, govde: Record<string, unknown>) => {
      if (metot !== 'CariListesiV2') return HATA;
      const size = Number(govde.Size), index = Number(govde.Index), offset = size * index;
      // 0. kayıt bozuk; [1,5) tek tek dolu; kalan aralıklar boş.
      if (offset === 0 && size >= 1) return size === 1 ? HATA : HATA;
      if (size === 1 && offset >= 1 && offset < 5) return liste('CariListesi', [{ cari_kod: `C${offset}`, cari_unvan1: `F ${offset}` }]);
      return liste('CariListesi', []);
    }) as unknown as typeof mikroPost);
    await d.cagir('POST', '/api/mikro/import/cari');
    const son = await d.isBitisi('mikroImport-cari');
    expect(son).toMatchObject({ running: false, created: 4, bozukKayit: 1, zamanAsimiKayit: 0 });
  });

  // Hakem 2026-09-25 (kritik): devre kesici yoktu — asılı Mikro'da iş ~2.100 saat sürüyor, süreç-geneli
  // kilit o süre doluydu (HEAD'de global 30 sn TimeoutError catch'e düşüp işi 30 sn'de bitiriyordu).
  it.each([
    ['/api/mikro/import/stok', 'mikroImport-stok', 'StokListesiV2', 5, 'ImportStok', 'inventory'],
    ['/api/mikro/import/cari', 'mikroImport-cari', 'CariListesiV2', 6, 'ImportCari', 'lead'],
  ] as const)('Mikro ASILI (%s: her çağrı TimeoutError) → %s iş error ile BİTER; %s çağrısı %i adet (sınırlı), syncLog(false) ×1, kilit açılır', async (yol, isAdi, metot, cagri, operation, entityType) => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(mikroPost).mockImplementation((async (m: string) => { if (m === metot) throw zamanAsimi(); return HATA; }) as unknown as typeof mikroPost);
    expect((await d.cagir('POST', yol)).govde).toEqual({ success: true, started: true, job: isAdi });
    const son = await d.isBitisi(isAdi);
    expect(son).toMatchObject({ running: false, finishedAt: 'TS' });
    expect(String(son?.error)).toMatch(/^Mikro yanıt vermiyor: art arda \d+ çağrı zaman aşımına uğradı/);
    expect(vi.mocked(mikroPost).mock.calls.filter(c => c[0] === metot)).toHaveLength(cagri);
    expect(d.syncLog).toHaveBeenCalledTimes(1);
    expect(d.syncLog).toHaveBeenCalledWith(operation, entityType, 'bulk', false, null, expect.stringMatching(/^Mikro yanıt vermiyor/), expect.any(Number), expect.anything());
    // Kilit bırakıldı: sonraki istek başlar (asılı iş 15 düğmeyi alreadyRunning'e kilitlemiyor).
    vi.mocked(mikroPost).mockResolvedValue(liste('StokListesi', []));
    expect((await d.cagir('POST', '/api/mikro/import/stok')).govde).toMatchObject({ started: true });
    await d.isBitisi('mikroImport-stok');
  });

  // Delta hakem 2026-09-25 (bulgu 6, kritik): null yanıtı (IsError / HTTP 5xx / stub) kesiciyi sıfırlıyordu →
  // ÖLÇÜLDÜ cari 63.100 çağrı + "50000 bozuk atlandı" success:true (HEAD cari `!ok → break` ile 1 çağrıda bitiyordu).
  it.each([
    ['/api/mikro/import/stok', 'mikroImport-stok', 'StokListesiV2', 9, 'ImportStok', 'inventory'],
    ['/api/mikro/import/cari', 'mikroImport-cari', 'CariListesiV2', 10, 'ImportCari', 'lead'],
  ] as const)('Mikro SÜREKLİ null (%s: her çağrı ok:false) → %s iş error ile BİTER; %s çağrısı %i adet, 50.000 "bozuk" UYDURULMAZ, syncLog(false) ×1', async (yol, isAdi, metot, cagri, operation, entityType) => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(mikroPost).mockResolvedValue(HATA);
    expect((await d.cagir('POST', yol)).govde).toEqual({ success: true, started: true, job: isAdi });
    const son = await d.isBitisi(isAdi);
    expect(son).toMatchObject({ running: false, finishedAt: 'TS' });
    expect(String(son?.error)).toMatch(/^Mikro veri vermiyor: art arda \d+ çağrı veri döndürmedi/);
    expect(vi.mocked(mikroPost).mock.calls.filter(c => c[0] === metot)).toHaveLength(cagri);
    expect(son?.bozukKayit, 'var olmayan kayıt sayılmaz').not.toBe(50000);
    expect(d.syncLog).toHaveBeenCalledTimes(1);
    expect(d.syncLog).toHaveBeenCalledWith(operation, entityType, 'bulk', false, null, expect.stringMatching(/^Mikro veri vermiyor/), expect.any(Number), expect.anything());
  });
});

describe('(f) yazıcı kaydı iş ÖMRÜNCE (res.finish\'e bağlı DEĞİL) + bakım kilidi 423', () => {
  it("INSERT 'yazici:mikro-import:mikroImport-stok:…' yanıt DÖNMEDEN; DELETE ancak iş bitince", async () => {
    const sorgular: Array<{ sql: string; params: unknown[] }> = [];
    d.pgAyarla(async (sql, params) => { sorgular.push({ sql, params: params ?? [] }); return { rows: [], rowCount: 1 }; });
    const sayfa = ertelenen<MikroYanit>();
    vi.mocked(mikroPost).mockImplementation((async (metot: string) => metot === 'StokListesiV2' ? sayfa.soz : HATA) as unknown as typeof mikroPost);

    const res = await d.cagir('POST', '/api/mikro/import/stok');
    expect(res.govde).toMatchObject({ started: true });
    const insert = sorgular.find(s => /^INSERT INTO docs/.test(s.sql));
    expect(String(insert?.params[1])).toMatch(/^yazici:mikro-import:mikroImport-stok:[0-9a-z]+$/);
    expect(res.bittiMi).toBe(true);
    expect(sorgular.some(s => /^DELETE FROM docs/.test(s.sql)), 'yanıt bitti ama iş sürüyor: kayıt DURUR').toBe(false);

    sayfa.coz(liste('StokListesi', []));
    await d.isBitisi('mikroImport-stok');
    const del = sorgular.find(s => /^DELETE FROM docs/.test(s.sql));
    expect(del?.params[1]).toBe(insert?.params[1]);
  });

  it('kilit varken stok / cari / stok-miktar 423 (metin birebir) ve HİÇBİR yazım yok (jobs dâhil); SQL fabrika ucu kilide BAĞLI DEĞİL (parite)', async () => {
    d.kilitAyarla({ aciklama: 'lead-birlestir', baslangic: '2026-09-05T12:00:00.000Z' });
    miktarDuzenegi(() => HATA);
    for (const yol of ['/api/mikro/import/stok', '/api/mikro/import/cari', '/api/mikro/import/stok-miktar']) {
      const res = await d.cagir('POST', yol);
      expect(res.kod, yol).toBe(423);
      expect(res.govde).toEqual({ success: false, error: 'Bakım kilidi: lead-birlestir (2026-09-05T12:00:00.000Z) — veri bakımı bitince tekrar deneyin.' });
    }
    expect(d.yazilan).toEqual([]);
    vi.mocked(mikroSql).mockResolvedValue({ rows: [], hata: null });
    const sql = await d.cagir('POST', '/api/mikro/import/cari-hareket');
    expect(sql.govde).toMatchObject({ started: true, job: 'mikroImport-cari-hareket' });
  });
});

describe('(g) SQL ucunda ÇİFT syncLog yok: gövde (1174) yazar, helper kendiYazar ile SUSAR', () => {
  it("mikroSql { hata:'X' } → d.syncLog TAM 1 (SQL:CARI_HESAP_HAREKETLERI, false, 'X'); jobs { running:false, error içerir 'X' }; HTTP artık 502 DEĞİL", async () => {
    vi.mocked(mikroSql).mockResolvedValue({ rows: [], hata: 'X' });
    const res = await d.cagir('POST', '/api/mikro/import/cari-hareket');
    expect(res.kod).toBe(200);
    expect(res.govde).toEqual({ success: true, started: true, job: 'mikroImport-cari-hareket' });
    const son = await d.isBitisi('mikroImport-cari-hareket');
    expect(son).toMatchObject({ running: false, finishedAt: 'TS' });
    expect(String(son?.error)).toContain('X');
    // Hakem 2026-09-25: başarısız koşu SAYILMADI — `total: 0` / `truncated: false` / `guidsizSatir: 0`
    // sahte kesinlikti (kart '…/0 işlendi' basardı). Yazılmayan alan = bilinmiyor (istemci `total?`).
    for (const alan of ['total', 'truncated', 'guidsizSatir', 'limit', 'note']) expect(son, alan).not.toHaveProperty(alan);
    expect(d.syncLog).toHaveBeenCalledTimes(1);
    expect(d.syncLog).toHaveBeenCalledWith('SQL:CARI_HESAP_HAREKETLERI', 'mikroCariHareketler', 'Mikro Cari Hareketleri', false, null, 'X', expect.any(Number), expect.anything());
  });

  it("KISMİ koşu: sayfa 1'in 500 satırı yazıldı, sayfa 2 TimeoutError → processed/satir 500 KALIR, total/truncated/guidsizSatir YOK (eski: total:0 → kart '500/0 işlendi')", async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const sayfa1 = Array.from({ length: 500 }, (_, i) => ({ cha_Guid: `g${i}`, cha_tip: 0, cha_meblag: 1 }));
    vi.mocked(mikroSql).mockResolvedValueOnce({ rows: sayfa1, hata: null }).mockRejectedValueOnce(zamanAsimi());
    await d.cagir('POST', '/api/mikro/import/cari-hareket');
    const son = await d.isBitisi('mikroImport-cari-hareket');
    expect(son).toMatchObject({ running: false, processed: 500, satir: 500, sayfa: 1, error: 'Mikro Cari Hareketleri başarısız.' });
    for (const alan of ['total', 'truncated', 'guidsizSatir', 'limit']) expect(son, alan).not.toHaveProperty(alan);
    expect(d.syncLog).toHaveBeenCalledTimes(1);
  });

  it('başarıda da 1 kez (1308) — guidsizSatir SAYILDI (0 gerçek sayım), total/truncated yazılır', async () => {
    vi.mocked(mikroSql).mockResolvedValue({ rows: [{ cha_Guid: 'g1' }], hata: null });
    await d.cagir('POST', '/api/mikro/import/siparis');
    const son = await d.isBitisi('mikroImport-siparis');
    expect(son).toMatchObject({ running: false, total: 1, truncated: false, guidsizSatir: 0, error: null });
    expect(d.syncLog).toHaveBeenCalledTimes(1);
    expect(d.syncLog).toHaveBeenCalledWith('SQL:SIPARISLER', 'mikroSiparisler', expect.stringContaining('1 kayıt'), true, null, null, expect.any(Number), expect.anything());
  });
});

// ═══ Şartname «Mikro bağlantı A» (2026-11-05): stok miktarı işi + gece 03:20 bloğuna iki YAZICI adımı ═══════════════════════
// A2 / AH13: stok miktarı işi ve V17 yoklaması `mikro_cron` kartını da okur (tek yüklem `mikroStokKartiMi`, kiracı sorguda).
describe('stok-miktar: Mikro kaynaklı kart = `mikro_import` | `mikro_cron` (A2 / AH13)', () => {
  /** Her SKU için GEÇERLİ miktar döner (elle açılan ve yabancı kiracının kartı dâhil): süzgeç Mikro'da değil Cetpa'da olmalı. */
  const herSkuGecerli = (yoklananlar: string[]) => vi.mocked(mikroPost).mockImplementation((async (metot: string, govde: Record<string, unknown>) => {
    if (metot !== 'GenelAmacliMaliyetListesiV2') return HATA;
    if (govde.Depolar === '1') yoklananlar.push(String(govde.StokKod));
    return { ok: true, status: 200, data: { result: [{ Data: { EldekiMiktar: 4, MaliyetBedeli: 40 } }] } };
  }) as unknown as typeof mikroPost);

  it('kiracıda mikro_import + mikro_cron + manuel kart, yabancı kiracıda mikro_cron kart → YALNIZ ilk ikisinin stockLevel\'ı yazılır', async () => {
    d.snapAyarla('inventory', {
      'u-import': { sku: 'CMT-1', companyId: 'A', source: 'mikro_import' },
      'u-cron':   { sku: 'CMT-2', companyId: 'A', source: 'mikro_cron' },
      'u-elle':   { sku: 'CMT-3', companyId: 'A', source: 'manuel' },
      'u-yabanci': { sku: 'CMT-4', companyId: 'B', source: 'mikro_cron' },
    });
    vi.mocked(mikroSql).mockResolvedValue({ rows: [], hata: null });
    herSkuGecerli([]);
    vi.mocked(v17MetoduKullanilabilir).mockResolvedValueOnce(true);   // AH7: yoklama sonucu açıkça
    await d.cagir('POST', '/api/mikro/import/stok-miktar');
    await d.isBitisi('stokMiktarImport');
    expect(d.koleksiyon('inventory').map(y => [y.ref.id, y.data?.stockLevel]).sort()).toEqual([['u-cron', 4], ['u-import', 4]]);
    expect(vi.mocked(mikroPost).mock.calls.map(c => (c[1] as { StokKod?: string }).StokKod).sort()).toEqual(['CMT-1', 'CMT-2']);
  });

  it('AH13: yoklamada süzgeçten ÖNCE `limit` yok: kiracının İLK kartı elle açılmış, tek Mikro kartı mikro_cron → yoklama o SKU ile yapılır', async () => {
    d.snapAyarla('inventory', {
      'u-elle':    { sku: 'ELLE-1', companyId: 'A', source: 'manuel' },
      'u-yabanci': { sku: 'YABANCI-1', companyId: 'B', source: 'mikro_cron' },
      'u-cron':    { sku: 'CRON-1', companyId: 'A', source: 'mikro_cron' },
    });
    vi.mocked(mikroSql).mockResolvedValue({ rows: [], hata: null });
    const yoklananlar: string[] = [];
    herSkuGecerli(yoklananlar);
    // Önbellek ATLATILIR (AH7): yoklama işlevinin KENDİSİ koşar.
    vi.mocked(v17MetoduKullanilabilir).mockImplementationOnce(async (_metot, yokla) => yokla());
    const res = await d.cagir('POST', '/api/mikro/import/stok-miktar');
    expect(res.govde).toMatchObject({ success: true, started: true, job: 'stokMiktarImport' });
    await d.isBitisi('stokMiktarImport');
    expect(yoklananlar).toEqual(['CRON-1']);
  });
});

// AH2: gece stok miktarı Cetpa'daki farklı değeri ezerken SAYAR (yalnız sayı); ezme kararı kullanıcıda (soru 19).
describe('stok-miktar: Cetpa miktarı Mikro\'dan farklı kart SAYILIR (AH2)', () => {
  const kos = async (kartlar: Record<string, Record<string, unknown>>) => {
    d.snapAyarla('inventory', kartlar);
    vi.mocked(mikroSql).mockResolvedValue({ rows: [], hata: null });
    vi.mocked(mikroPost).mockImplementation((async (metot: string) => metot === 'GenelAmacliMaliyetListesiV2'
      ? { ok: true, status: 200, data: { result: [{ Data: { EldekiMiktar: 7 } }] } } : HATA) as unknown as typeof mikroPost);
    vi.mocked(v17MetoduKullanilabilir).mockResolvedValueOnce(true);
    await d.cagir('POST', '/api/mikro/import/stok-miktar');
    return d.isBitisi('stokMiktarImport');
  };
  it("Cetpa 10, Mikro 7 → stockLevel 7 yazılır; özet ve iş notu «1 kartta Cetpa miktarı Mikro'dan farklıydı»; stockDiscrepancies yazımı YOK", async () => {
    const son = await kos({ u1: { sku: 'CMT-1', companyId: 'A', source: 'mikro_import', stockLevel: 10 } });
    expect(d.koleksiyon('inventory').map(y => y.data?.stockLevel)).toEqual([7]);
    const ozet = String(d.syncLog.mock.calls[0]?.[2]);
    expect(ozet).toContain(" · 1 kartta Cetpa miktarı Mikro'dan farklıydı; Mikro değeri yazıldı");
    expect(son).toMatchObject({ cetpaFarkli: 1, note: "1 kartta Cetpa miktarı Mikro'dan farklıydı; Mikro değeri yazıldı" });
    expect(d.koleksiyon('stockDiscrepancies')).toEqual([]);
  });
  it('Cetpa stockLevel BİLİNMİYORSA (yok / metin) sayılmaz; hepsi eşitse özet eski metinle BAYT BAYT aynı, iş dokümanında not YOK', async () => {
    const son = await kos({
      u1: { sku: 'CMT-1', companyId: 'A', source: 'mikro_import' },
      u2: { sku: 'CMT-2', companyId: 'A', source: 'mikro_import', stockLevel: 'yok' },
      u3: { sku: 'CMT-3', companyId: 'A', source: 'mikro_import', stockLevel: 7 },
    });
    const ozet = String(d.syncLog.mock.calls[0]?.[2]);
    expect(ozet, ozet).toMatch(/^3 ürünün miktarı güncellendi, 0 hata, 0 üründe depo dağılımı yazıldı, 3 satırın maliyet bedeli bilinmiyor \(\d+sn\)$/);
    expect(son && 'note' in son).toBe(false);
    expect(son && 'cetpaFarkli' in son).toBe(false);
  });
});

// İnceleme MBS #2 (2026-11-05): stok miktarı işinde DEVRE KESİCİ (GİB taramasıyla aynı anlam). Art arda 3 turda turun BÜTÜN çağrıları
// FIRLATIRSA iş durur (asılı Mikro'da ~2,8 saat yerine ~3 × 30 sn); IsError / ok:false yanıtı kesiciyi TETİKLEMEZ.
describe('stok-miktar: devre kesici (art arda 3 tamamen fırlatan tur)', () => {
  const KIRK = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`u${i}`, { sku: `CMT-${i}`, companyId: 'A', source: 'mikro_import' }]));
  /** 40 SKU; `urun(sira)` sırayla sorulan ürün çağrısının yanıtını verir (sıra 0'dan). Yoklama `v17MetoduKullanilabilir` ile atlanır. */
  const kos = async (urun: (sira: number) => MikroYanit) => {
    d.snapAyarla('inventory', KIRK);
    vi.mocked(mikroSql).mockResolvedValue({ rows: [], hata: null });
    let sira = 0;
    vi.mocked(mikroPost).mockImplementation((async (metot: string) => {
      if (metot !== 'GenelAmacliMaliyetListesiV2') return HATA;
      return urun(sira++);
    }) as unknown as typeof mikroPost);
    vi.mocked(v17MetoduKullanilabilir).mockResolvedValueOnce(true);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await d.cagir('POST', '/api/mikro/import/stok-miktar');
    const son = await d.isBitisi('stokMiktarImport');
    const urunCagrisi = vi.mocked(mikroPost).mock.calls.filter(c => c[0] === 'GenelAmacliMaliyetListesiV2').length;
    return { son, urunCagrisi, satir: d.syncLog.mock.calls[0] };
  };
  const GECERLI: MikroYanit = { ok: true, status: 200, data: { result: [{ Data: { EldekiMiktar: 3, MaliyetBedeli: 30 } }] } };

  it('her çağrı zaman aşımıyla fırlatır → 3 turda (24 ürün) durur; koşu BAŞARISIZ, özet «Mikro yanıt vermedi, 24 üründe durdu», hata «24/40 SKU soruldu»', async () => {
    const { son, urunCagrisi, satir } = await kos(() => { throw zamanAsimi(); });
    expect(urunCagrisi).toBe(24);
    expect(son).toMatchObject({ running: false, processed: 24, updated: 0, failed: 24, total: 40 });
    expect(d.syncLog).toHaveBeenCalledTimes(1);
    expect(String(satir[2])).toMatch(/^Mikro yanıt vermedi, 24 üründe durdu \(art arda 3 turda bütün çağrılar zaman aşımı \/ bağlantı hatası verdi; 40 üründen 16 ürün sorulmadı\)\. 0 ürünün miktarı güncellendi, 24 hata/);
    expect([satir[3], satir[5]]).toEqual([false, 'Mikro yanıt vermedi (24/40 SKU soruldu)']);
    expect(d.koleksiyon('inventory')).toEqual([]);
  });

  it('IsError / ok:false yanıtları kesiciyi TETİKLEMEZ (Mikro yanıt veriyor): 40 ürünün hepsi sorulur, özet eski biçimde', async () => {
    const { urunCagrisi, satir } = await kos(() => HATA);
    expect(urunCagrisi).toBe(40);
    expect(String(satir[2])).toMatch(/^0 ürünün miktarı güncellendi, 40 hata/);
    expect([satir[3], satir[5]]).toEqual([false, '40 SKU okunamadı']);
  });

  it('kısmen fırlatan tur (8\'in 7\'si) ve aradaki başarılı tur sayacı SIFIRLAR: 2 tam fırlatan + 1 başarılı + 2 tam fırlatan → hepsi sorulur', async () => {
    // Turlar: 0-1 tamamen fırlatır, 2 başarılı, 3-4 tamamen fırlatır (sayaç 2'de kalır), 5'te 7 fırlatan + 1 geçerli → sayaç sıfır.
    const { urunCagrisi, son, satir } = await kos(i => {
      const tur = Math.floor(i / 8);
      if (tur === 2) return GECERLI;
      throw zamanAsimi();
    });
    expect(urunCagrisi).toBe(40);
    expect(son).toMatchObject({ processed: 40, updated: 8, failed: 32 });
    expect(String(satir[2])).not.toContain('Mikro yanıt vermedi');
    // Tek SKU'su geçerli tur da tamamen fırlatan sayılmaz.
    vi.mocked(mikroPost).mockReset();
    d.syncLog.mockClear();
    const ikinci = await kos(i => (i % 8 === 7 ? GECERLI : (() => { throw zamanAsimi(); })()));
    expect(ikinci.urunCagrisi).toBe(40);
    expect(String(ikinci.satir[2])).not.toContain('Mikro yanıt vermedi');
  });
});

describe('03:20 gece: cari bakiye (A3) + SON adım stok miktarı (A1 / AH1 / AH4 / AH12 / AH14)', () => {
  const SISTEM = { uid: 'system', email: '' };
  const BOS: MikroYanit = { ok: true, status: 200, data: { result: [{ Data: [] }] } };
  const bakiyeYaniti = (rows: Record<string, unknown>[]): MikroYanit => ({ ok: true, status: 200, data: { result: [{ Data: { SQLResult1: rows } }] } });
  interface GeceSecenegi {
    /** Bakiye sorgusunun (`AS bakiye`) yanıtı; varsayılan boş `Data` → «satır yok». */
    bakiye?: MikroYanit;
    hazirla?: (dc: Duzenek) => void;
    /** Önce sorulan Mikro yanıtı (undefined → varsayılan). */
    ozelMikro?: (metot: string, govde: Record<string, unknown>) => Promise<MikroYanit> | MikroYanit | undefined;
  }
  const bakiyeSorgusuMu = (c: unknown[]) => c[0] === 'SqlVeriOkuV2' && String((c[1] as { SQLSorgu?: string } | undefined)?.SQLSorgu).includes('AS bakiye');
  /** Düzeneği ve sahteleri kurar; 03:20 işini KOŞTURMAZ (çağıran `kostur()` der). */
  function geceKur(s: GeceSecenegi = {}): { dc: Duzenek; kostur: () => Promise<void> } {
    vi.stubEnv('MIKRO_CRON_SYNC', 'true');
    vi.stubEnv('MIKRO_CRON_COMPANY_ID', 'A');
    vi.mocked(cron.schedule).mockClear();
    const dc = duzenekKur();
    s.hazirla?.(dc);
    // Per-depo sorgusu (stok işi) bir satır döner; SQL tanımlarının sayfaları boş.
    vi.mocked(mikroSql).mockImplementation((async (sql: string) => (sql.includes('sth_giris_depo_no')
      ? { rows: [{ sth_stok_kod: 'CMT-1', depo: 2, bakiye: 7 }], hata: null } : { rows: [], hata: null })) as unknown as typeof mikroSql);
    vi.mocked(mikroPost).mockImplementation((async (metot: string, govde: Record<string, unknown>) => {
      const ozel = await s.ozelMikro?.(metot, govde);
      if (ozel) return ozel;
      if (bakiyeSorgusuMu([metot, govde])) return s.bakiye ?? BOS;
      if (metot === 'GenelAmacliMaliyetListesiV2') return { ok: true, status: 200, data: { result: [{ Data: { EldekiMiktar: 7, MaliyetBedeli: 70 } }] } };
      return BOS;
    }) as unknown as typeof mikroPost);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const gece = vi.mocked(cron.schedule).mock.calls.find(c => c[0] === '20 3 * * *');
    if (!gece) throw new Error('03:20 işi kayıtlı değil');
    return { dc, kostur: () => (gece[1] as () => Promise<void>)() };
  }
  async function geceKostur(s: GeceSecenegi = {}): Promise<Duzenek> {
    const { dc, kostur } = geceKur(s);
    await kostur();
    return dc;
  }
  const satirlar = (dc: Duzenek, islem: string, hedef: string) => dc.syncLog.mock.calls.filter(c => c[0] === islem && c[1] === hedef);
  const stokSatirlari = (dc: Duzenek) => satirlar(dc, 'GenelAmacliMaliyetListesiV2', 'inventory');
  const bakiyeSatirlari = (dc: Duzenek) => satirlar(dc, 'SQL:CARI_HESAP_HAREKETLERI', 'cariBalances');
  const stokIsleri = () => vi.mocked(arkaPlanIsiBaslat).mock.calls.filter(c => c[1].isAdi === 'stokMiktarImport');
  const denetimler = (dc: Duzenek) => vi.mocked(dc.C.writeAuditLog).mock.calls.map(c => String(c[1]));
  const KART = { u1: { sku: 'CMT-1', companyId: 'A', source: 'mikro_import', stockLevel: 10 } };
  afterEach(() => { vi.unstubAllEnvs(); });

  // ── A1: stok miktarı son adım ────────────────────────────────────────────────────────────────────────────────────────────────
  it('A1-1 sürüm 16 + yoklama true → `stokMiktarImport` başlar ve BEKLENİR: warehouseItems depoBreakdown yazılır, bitiş satırı HEDEF kiracıya, ayrı denetim YOK', async () => {
    vi.mocked(v17MetoduKullanilabilir).mockResolvedValueOnce(true);
    const dc = await geceKostur({ hazirla: x => x.snapAyarla('inventory', KART) });
    expect(stokIsleri().map(c => [c[1].companyId, c[1].actor, c[1].denetimKiracisi])).toEqual([['A', SISTEM, 'A']]);
    expect(dc.koleksiyon('inventory').map(y => [y.ref.id, y.data?.stockLevel, y.data?.costPrice])).toEqual([['u1', 7, 10]]);
    expect(dc.koleksiyon('warehouseItems').map(y => y.data?.depoBreakdown)).toEqual([{ 2: 7 }]);
    const s = stokSatirlari(dc);
    expect(s).toHaveLength(1);
    expect(s[0]).toEqual(['GenelAmacliMaliyetListesiV2', 'inventory', expect.stringContaining('1 ürünün miktarı güncellendi'), true, null, null,
      expect.any(Number), SISTEM, undefined, { denetimKiracisi: 'A' }]);
    // AH2: gecede de sayılır (Cetpa 10, Mikro 7).
    expect(String(s[0][2])).toContain("1 kartta Cetpa miktarı Mikro'dan farklıydı");
    expect(denetimler(dc)).not.toContain('Mikro Stok Miktarları');
    // Gece işi bittiğinde kilit bırakılmıştır (sonraki saatlik koşu atlamaz).
    expect(arkaPlanIsiKosan()).toBeNull();
  });

  // İnceleme MBA1 #1 (2026-11-05): depo dağılımı SQL'i hata verirse dağılım BİLİNMİYOR: alan yazılmaz (son bilinen kalır), özet söyler.
  it('MBA1-1 depo SQL\'i hata verirse warehouseItems `depoBreakdown` YAZILMAZ (merge son bilinen dağılımı korur); özet «depo dağılımı okunamadı»', async () => {
    vi.mocked(v17MetoduKullanilabilir).mockResolvedValueOnce(true);
    const { dc, kostur } = geceKur({ hazirla: x => { x.snapAyarla('inventory', KART); x.snapAyarla('warehouseItems', { 'mikro-CMT-1': { companyId: 'A', depoBreakdown: { 2: 7 } } }); } });
    vi.mocked(mikroSql).mockImplementation((async (sql: string) => (sql.includes('sth_giris_depo_no')
      ? { rows: [], hata: 'HTTP 502' } : { rows: [], hata: null })) as unknown as typeof mikroSql);
    await kostur();
    const wi = dc.koleksiyon('warehouseItems');
    expect(wi).toHaveLength(1);
    expect(wi[0].data).not.toHaveProperty('depoBreakdown');
    expect(wi[0].data).toMatchObject({ companyId: 'A', quantity: 7, warehouseId: null });
    expect(String(stokSatirlari(dc)[0][2])).toContain('depo dağılımı okunamadı');
    // Not, stoğu 0 / eksi üründe dağılımın null yazıldığıyla çelişmez (MBA3 delta): «değiştirilmedi» yalnız stoğu olan ürün için.
    expect(String(stokSatirlari(dc)[0][2])).toContain('stoğu olan üründe değiştirilmedi');
  });

  // İnceleme MBA2 #2 (2026-11-05): stok ≤ 0 iken dağılım SQL'siz de bilinir (hiçbir depoda yok): depo SQL'i hata verse de null
  // yazılır; bayat {2: 7} korunursa stoğu sıfırlanan ürün Depo sekmesinde görünmeye devam eder.
  it.each([0, -2])('MBA2-2 depo SQL\'i hata verir ve Mikro miktarı %d → warehouseItems `depoBreakdown: null` (bayat dağılım korunmaz)', async (miktar) => {
    vi.mocked(v17MetoduKullanilabilir).mockResolvedValueOnce(true);
    const { dc, kostur } = geceKur({
      hazirla: x => { x.snapAyarla('inventory', KART); x.snapAyarla('warehouseItems', { 'mikro-CMT-1': { companyId: 'A', quantity: 7, depoBreakdown: { 2: 7 } } }); },
      ozelMikro: m => (m === 'GenelAmacliMaliyetListesiV2'
        ? { ok: true, status: 200, data: { result: [{ Data: { EldekiMiktar: miktar, MaliyetBedeli: 0 } }] } } : undefined),
    });
    vi.mocked(mikroSql).mockImplementation((async (sql: string) => (sql.includes('sth_giris_depo_no')
      ? { rows: [], hata: 'HTTP 502' } : { rows: [], hata: null })) as unknown as typeof mikroSql);
    await kostur();
    const wi = dc.koleksiyon('warehouseItems');
    expect(wi).toHaveLength(1);
    expect(wi[0].data).toMatchObject({ companyId: 'A', quantity: miktar, warehouseId: null, depoBreakdown: null });
  });

  // İnceleme MBS #0 (2026-11-05): depo SQL'i HATASIZ ama BOŞ dönerse (`mikroSql` dizisiz yanıtı `rows: []` verir) dağılım yine
  // BİLİNMİYOR: stoğu olan kartta alan yazılmaz (son bilinen kalır). Yalnız yazma koruması: özet metni değişmez (AH2).
  it.each([7, 0])('MBS-0 depo SQL\'i hatasız ama BOŞ ({ rows: [], hata: null }), Mikro miktarı %d → stok > 0 ise `depoBreakdown` YAZILMAZ, ≤ 0 ise null', async (miktar) => {
    vi.mocked(v17MetoduKullanilabilir).mockResolvedValueOnce(true);
    const { dc, kostur } = geceKur({
      hazirla: x => { x.snapAyarla('inventory', KART); x.snapAyarla('warehouseItems', { 'mikro-CMT-1': { companyId: 'A', quantity: 7, depoBreakdown: { 2: 7 } } }); },
      ozelMikro: m => (m === 'GenelAmacliMaliyetListesiV2'
        ? { ok: true, status: 200, data: { result: [{ Data: { EldekiMiktar: miktar, MaliyetBedeli: 0 } }] } } : undefined),
    });
    vi.mocked(mikroSql).mockResolvedValue({ rows: [], hata: null });
    await kostur();
    const wi = dc.koleksiyon('warehouseItems');
    expect(wi).toHaveLength(1);
    expect(wi[0].data).toMatchObject({ companyId: 'A', quantity: miktar, warehouseId: null });
    if (miktar > 0) expect(wi[0].data).not.toHaveProperty('depoBreakdown');
    else expect(wi[0].data).toMatchObject({ depoBreakdown: null });
    // Özet metni değişmedi: «okunamadı» notu yalnız SQL HATASINDA (AH2 parite testleri boş satırla başarılı SQL taklit ediyor).
    const s = stokSatirlari(dc);
    expect(s).toHaveLength(1);
    expect(String(s[0][2])).not.toContain('depo dağılımı okunamadı');
    expect(s[0][3]).toBe(true);
  });

  it('A1-2 yoklama false → koşum YOK: inventory / warehouseItems yazımı 0, GenelAmacliMaliyetListesiV2 Mikro çağrısı 0, TEK başarısız «V17 yoklaması geçmedi» satırı', async () => {
    vi.mocked(v17MetoduKullanilabilir).mockResolvedValueOnce(false);
    const dc = await geceKostur({ hazirla: x => x.snapAyarla('inventory', KART) });
    expect(arkaPlanIsiBaslat).not.toHaveBeenCalled();
    expect(vi.mocked(mikroPost).mock.calls.filter(c => c[0] === 'GenelAmacliMaliyetListesiV2')).toEqual([]);
    expect([dc.koleksiyon('inventory'), dc.koleksiyon('warehouseItems')]).toEqual([[], []]);
    expect(stokSatirlari(dc)).toEqual([['GenelAmacliMaliyetListesiV2', 'inventory', 'gece senkronu', false, null,
      'V17 yoklaması geçmedi; stok miktarı çekilmedi', expect.any(Number), SISTEM, undefined, { denetimKiracisi: 'A' }]]);
  });

  it('A1-3 / AH14 bakım kilidi → stok adımı KOŞMAZ (yoklama da yok), TEK «bakım kilidi: …» satırı; bakiye adımı da kilide uyar', async () => {
    const dc = await geceKostur({ hazirla: x => { x.snapAyarla('inventory', KART); x.kilitAyarla({ aciklama: 'lead birleştirme', baslangic: '2026-11-05T00:00:00.000Z' }); } });
    expect(v17MetoduKullanilabilir).not.toHaveBeenCalled();
    expect(arkaPlanIsiBaslat).not.toHaveBeenCalled();
    expect(stokSatirlari(dc).map(c => [c[3], c[5]])).toEqual([[false, 'bakım kilidi: lead birleştirme']]);
    expect(bakiyeSatirlari(dc).map(c => [c[3], c[5]])).toEqual([[false, 'bakım kilidi: lead birleştirme']]);
    expect(vi.mocked(mikroPost).mock.calls.filter(bakiyeSorgusuMu)).toEqual([]);   // bakiye Mikro'ya hiç sorulmadı
    expect([dc.koleksiyon('inventory'), dc.koleksiyon('cariBalances')]).toEqual([[], []]);
  });

  it('A1-3 / AH14 başka arka plan işi koşarken → stok adımı KOŞMAZ, TEK «atlandı: başka iş koşuyor (<iş>)» satırı', async () => {
    const sayfa = ertelenen<MikroYanit>();
    const { dc, kostur } = geceKur({
      hazirla: x => x.snapAyarla('inventory', KART),
      ozelMikro: metot => (metot === 'StokListesiV2' ? sayfa.soz : undefined),
    });
    // Gece BAŞLAMADAN önce elle başlatılmış ve Mikro yanıtını bekleyen stok kartı importu (süreç-geneli tek iş).
    await d.cagir('POST', '/api/mikro/import/stok');
    await vi.waitFor(() => expect(mikroPost).toHaveBeenCalledWith('StokListesiV2', expect.anything(), false, expect.anything()));
    vi.mocked(arkaPlanIsiBaslat).mockClear();
    await kostur();
    expect(v17MetoduKullanilabilir).not.toHaveBeenCalled();
    expect(stokIsleri()).toEqual([]);
    expect(stokSatirlari(dc).map(c => [c[3], c[5]])).toEqual([[false, 'atlandı: başka iş koşuyor (mikroImport-stok)']]);
    sayfa.coz(liste('StokListesi', []));
    await d.isBitisi('mikroImport-stok');
  });

  // ── AH4: `arkaPlanIsiBaslat`'ın her `started:false` sonucu TEK eşleyiciden günlüğe ───────────────────────────────────────────
  it('AH4 ön kontrol boş, yoklama true, iş başlatılamadı (alreadyRunning) → TEK başarısız «başka iş koşuyor» satırı', async () => {
    vi.mocked(v17MetoduKullanilabilir).mockResolvedValueOnce(true);
    vi.mocked(arkaPlanIsiBaslat).mockResolvedValueOnce({ started: false, alreadyRunning: true, job: 'x' });
    const dc = await geceKostur({ hazirla: x => x.snapAyarla('inventory', KART) });
    expect(stokSatirlari(dc).map(c => [c[2], c[3], c[5], c[9]])).toEqual([['gece senkronu', false, 'atlandı: başka iş koşuyor (x)', { denetimKiracisi: 'A' }]]);
  });
  it('AH4 iş yazıcı kaydından sonra kilit gördü ({ started:false, kilit }) → TEK başarısız «bakım kilidi: …» satırı', async () => {
    vi.mocked(v17MetoduKullanilabilir).mockResolvedValueOnce(true);
    vi.mocked(arkaPlanIsiBaslat).mockResolvedValueOnce({ started: false, kilit: { aciklama: 'kopya temizliği', baslangic: '2026-11-05T00:20:00.000Z' } });
    const dc = await geceKostur({ hazirla: x => x.snapAyarla('inventory', KART) });
    expect(stokSatirlari(dc).map(c => [c[3], c[5]])).toEqual([[false, 'bakım kilidi: kopya temizliği']]);
  });

  // ── AH1: sıra, saatlik senkron kapısı, 04:00 kaydı yok ──────────────────────────────────────────────────────────────────────
  it('AH1-a SIRA: son SQL tanımı < bakiye sorgusu < GİB satırı < faturadan-siparis satırı < stokMiktarImport başlatma', async () => {
    vi.mocked(v17MetoduKullanilabilir).mockResolvedValueOnce(true);
    const dc = await geceKostur({ hazirla: x => x.snapAyarla('inventory', KART) });
    const sira = <T extends unknown[]>(m: { calls: T[]; invocationCallOrder: number[] }, sec: (c: T) => boolean): number[] =>
      m.calls.map((c, i) => (sec(c) ? m.invocationCallOrder[i] : -1)).filter(n => n >= 0);
    const sqlSon = Math.max(...sira(vi.mocked(mikroSql).mock, c => !String(c[0]).includes('sth_giris_depo_no')));
    const bakiye = sira(vi.mocked(mikroPost).mock, c => bakiyeSorgusuMu(c));
    const gib = sira(dc.syncLog.mock, c => c[0] === 'EBelgeDurumSorgulamaV2');
    const mf = sira(dc.syncLog.mock, c => c[0] === 'faturadan-siparis');
    const stok = sira(vi.mocked(arkaPlanIsiBaslat).mock, c => c[1].isAdi === 'stokMiktarImport');
    expect([bakiye.length, gib.length, mf.length, stok.length]).toEqual([1, 1, 1, 1]);
    expect(sqlSon < bakiye[0] && bakiye[0] < gib[0] && gib[0] < mf[0] && mf[0] < stok[0]).toBe(true);
  });

  it("AH1-b saatlik senkron yazıcısı ('mikro-cron') kayıtlıyken stok adımı KOŞMAZ: TEK «atlandı: saatlik senkron koşuyor» satırı; önekli gece adımı kaydı engellemez", async () => {
    const yazicilar = (adlar: string[]) => async (sql: string) => (/id LIKE/.test(sql)
      ? { rows: adlar.map(ad => ({ id: `yazici:${ad}`, data: { baslangic: new Date().toISOString() } })) } : { rows: [] });
    const dc = await geceKostur({ hazirla: x => { x.snapAyarla('inventory', KART); x.pgAyarla(yazicilar(['mikro-cron'])); } });
    expect(v17MetoduKullanilabilir).not.toHaveBeenCalled();
    expect(arkaPlanIsiBaslat).not.toHaveBeenCalled();
    expect(stokSatirlari(dc).map(c => [c[3], c[5]])).toEqual([[false, 'atlandı: saatlik senkron koşuyor']]);
    // `'mikro-cron:faturadan-siparis'` gibi önekli kayıt kapıya girmez.
    vi.mocked(v17MetoduKullanilabilir).mockResolvedValueOnce(false);
    const dc2 = await geceKostur({ hazirla: x => { x.snapAyarla('inventory', KART); x.pgAyarla(yazicilar(['mikro-cron:faturadan-siparis'])); } });
    expect(stokSatirlari(dc2).map(c => c[5])).toEqual(['V17 yoklaması geçmedi; stok miktarı çekilmedi']);
  });

  // İnceleme MBA1 #2 (2026-11-05): V17 yoklaması (ağ çağrısı) sırasında saatlik senkron kaydolursa, başlatmadan hemen önceki
  // ikinci bakış işi durdurur; satır yine TEK. Yazıcı listesine bakışlar: 1. bakiye adımı (MBS #1, 2026-11-05), 2. stok adımının
  // ilk bakışı, 3. yoklamadan sonraki bakış: kayıt yalnız 3.'de görünür.
  it("MBA1-2 ilk bakışta saatlik yazıcı yok, yoklamadan sonra var → `arkaPlanIsiBaslat` çağrılmaz, TEK «atlandı: saatlik senkron koşuyor» satırı", async () => {
    let bakis = 0;
    vi.mocked(v17MetoduKullanilabilir).mockResolvedValueOnce(true);
    const dc = await geceKostur({ hazirla: x => { x.snapAyarla('inventory', KART); x.pgAyarla(async (sql: string) => {
      if (!/id LIKE/.test(sql)) return { rows: [] };
      bakis++;
      return { rows: bakis >= 3 ? [{ id: 'yazici:mikro-cron', data: { baslangic: new Date().toISOString() } }] : [] };
    }); } });
    expect(v17MetoduKullanilabilir).toHaveBeenCalledTimes(1);
    expect(bakis).toBe(3);
    expect(arkaPlanIsiBaslat).not.toHaveBeenCalled();
    expect(stokSatirlari(dc).map(c => [c[3], c[5]])).toEqual([[false, 'atlandı: saatlik senkron koşuyor']]);
    expect(dc.koleksiyon('inventory')).toEqual([]);
  });

  // İnceleme MBS #1 (2026-11-05): saatlik kapı bakiye adımında da var. Bakış yazıcı kaydından SONRA (`yaziciOlarakCalistir` geri
  // çağrısının içinde); satır TEK; bakiye Mikro'ya hiç sorulmaz. AH6 parite sırası (17 satır) aynen kalır.
  it("MBS-1 saatlik yazıcı ('mikro-cron') kayıtlıyken bakiye adımı KOŞMAZ: Mikro'ya bakiye sorgusu 0, cariBalances / leads yazımı 0, TEK «atlandı: saatlik senkron koşuyor» satırı; bakış yazıcı kaydından SONRA", async () => {
    const sorgular: Array<{ sql: string; params: unknown[] }> = [];
    const dc = await geceKostur({ hazirla: x => { x.snapAyarla('leads', LEADLER); x.pgAyarla(async (sql: string, params: unknown[] = []) => {
      sorgular.push({ sql, params });
      return /id LIKE/.test(sql) ? { rows: [{ id: 'yazici:mikro-cron', data: { baslangic: new Date().toISOString() } }] } : { rows: [] };
    }); } });
    expect(vi.mocked(mikroPost).mock.calls.filter(bakiyeSorgusuMu)).toEqual([]);
    expect([dc.koleksiyon('cariBalances'), dc.koleksiyon('leads')]).toEqual([[], []]);
    expect(bakiyeSatirlari(dc)).toEqual([['SQL:CARI_HESAP_HAREKETLERI', 'cariBalances', 'gece senkronu', false, null, 'atlandı: saatlik senkron koşuyor',
      expect.any(Number), SISTEM, undefined, { denetimKiracisi: 'A' }]]);
    // Sıra: bakiye yazıcısının kaydı (INSERT) → bakım kilidi → yazıcı listesi (kapı) → kaydın silinmesi.
    const kayit = sorgular.findIndex(q => /^INSERT/.test(q.sql) && q.params[1] === 'yazici:mikro-cron:pull-bakiye');
    const silme = sorgular.findIndex(q => /^DELETE/.test(q.sql) && q.params[1] === 'yazici:mikro-cron:pull-bakiye');
    const bakis = sorgular.findIndex((q, i) => i > kayit && /id LIKE/.test(q.sql));
    expect(kayit).toBeGreaterThanOrEqual(0);
    expect(kayit < bakis && bakis < silme).toBe(true);
    // Sonraki adımlar yine koşar (stok adımı da aynı kapıyla atlar).
    expect(dc.syncLog.mock.calls.map(c => c[0]).slice(-3)).toEqual(['EBelgeDurumSorgulamaV2', 'faturadan-siparis', 'GenelAmacliMaliyetListesiV2']);
  });

  it("MBS-1 önekli gece kaydı ('mikro-cron:faturadan-siparis') bakiye kapısına girmez: bakiye sorgusu TAM 1, satır «satır yok»", async () => {
    vi.mocked(v17MetoduKullanilabilir).mockResolvedValueOnce(false);
    const dc = await geceKostur({ hazirla: x => { x.snapAyarla('leads', LEADLER); x.pgAyarla(async (sql: string) => (/id LIKE/.test(sql)
      ? { rows: [{ id: 'yazici:mikro-cron:faturadan-siparis', data: { baslangic: new Date().toISOString() } }] } : { rows: [] })); } });
    expect(vi.mocked(mikroPost).mock.calls.filter(bakiyeSorgusuMu)).toHaveLength(1);
    expect(bakiyeSatirlari(dc).map(c => [c[2], c[3], c[5]])).toEqual([['satır yok; bakiye yazılmadı', true, null]]);
  });

  it("AH1-c mikroRoutes zamanlayıcı kayıtlarında '0 4 * * *' YOK (stok adımı 03:20 bloğunun içinde)", () => {
    vi.stubEnv('MIKRO_CRON_SYNC', 'true');
    vi.mocked(cron.schedule).mockClear();
    duzenekKur();
    const ifadeler = vi.mocked(cron.schedule).mock.calls.map(c => c[0]);
    expect(ifadeler).toContain('20 3 * * *');
    expect(ifadeler).not.toContain('0 4 * * *');
  });

  // ── A3 / AH6 / AH12: gece cari bakiye adımı ─────────────────────────────────────────────────────────────────────────────────
  const LEADLER = {
    'L-A': { name: 'Şirin İnşaat', mikroCariKod: '120.01.001', companyId: 'A' },
    'L-B': { name: 'Başka Firma', mikroCariKod: '120.01.001', companyId: 'B' },
    'L-eski': { name: 'Çelik Yapı', mikroCariKod: '120.01.002' },
  };
  it('AH12 bakiye `tamam` → satırı İŞLEV yazar: sistem aktörü + `denetimKiracisi`; «Mikro Bakiye Çekme» denetimi YAZILMAZ; cariBalances hedef kiracıyla', async () => {
    vi.mocked(v17MetoduKullanilabilir).mockResolvedValueOnce(false);
    const dc = await geceKostur({
      hazirla: x => x.snapAyarla('leads', LEADLER),
      bakiye: bakiyeYaniti([{ cha_kod: '120.01.001', bakiye: 15000 }, { cha_kod: '120.01.002', bakiye: -4200 }]),
    });
    expect(bakiyeSatirlari(dc)).toEqual([['SQL:CARI_HESAP_HAREKETLERI', 'cariBalances', expect.stringContaining('2 cari bakiyesi güncellendi'), true, null, null,
      expect.any(Number), SISTEM, undefined, { denetimKiracisi: 'A' }]]);
    expect(denetimler(dc)).not.toContain('Mikro Bakiye Çekme');
    expect(dc.koleksiyon('cariBalances').map(y => [y.ref.id, y.data?.bakiye, y.data?.companyId])).toEqual([['120.01.001', 15000, 'A'], ['120.01.002', -4200, 'A']]);
    expect(dc.koleksiyon('leads').map(y => y.ref.id).sort()).toEqual(['L-A', 'L-eski']);   // yabancı kiracının lead'i atlanır
  });

  it('AH12 elle rota → denetim «Mikro Bakiye Çekme» TAM 1; syncLog denetim kiracısı TAŞIMAZ (8 argüman, bugünkü şekil)', async () => {
    d.snapAyarla('leads', LEADLER);
    vi.mocked(mikroPost).mockResolvedValue(bakiyeYaniti([{ cha_kod: '120.01.001', bakiye: 15000 }]));
    const res = await d.cagir('POST', '/api/mikro/pull/bakiye', {});
    expect(res.govde).toMatchObject({ success: true, updated: 2, yabanciAtlanan: 1, mikroRows: 1 });
    expect(vi.mocked(d.C.writeAuditLog).mock.calls.filter(c => c[1] === 'Mikro Bakiye Çekme')).toHaveLength(1);
    expect(d.syncLog.mock.calls).toEqual([['SQL:CARI_HESAP_HAREKETLERI', 'cariBalances', expect.stringContaining('2 cari bakiyesi'), true, null, null, expect.any(Number),
      { uid: 'u1', email: 'a@cetpa.com.tr' }]]);
  });

  it('A3 SqlVeriOkuV2 başarısız → cariBalances / leads yazımı 0; TEK başarısız satır (mesajla); sonraki adımlar yine koşar', async () => {
    vi.mocked(v17MetoduKullanilabilir).mockResolvedValueOnce(false);
    const dc = await geceKostur({ hazirla: x => x.snapAyarla('leads', LEADLER), bakiye: { ok: false, status: 500, data: { result: [{ IsError: true, ErrorMessage: 'Timeout' }] } } });
    expect([dc.koleksiyon('cariBalances'), dc.koleksiyon('leads')]).toEqual([[], []]);
    expect(bakiyeSatirlari(dc).map(c => [c[2], c[3], c[5]])).toEqual([['gece senkronu', false, 'Bakiye sorgusu çalıştırılamadı: Timeout. Hiçbir bakiye değiştirilmedi.']]);
    expect(dc.syncLog.mock.calls.map(c => c[0]).slice(-3)).toEqual(['EBelgeDurumSorgulamaV2', 'faturadan-siparis', 'GenelAmacliMaliyetListesiV2']);
  });

  it('A3 okuma arızası (bakiye hiçbir satırda okunamadı) → yazım 0; TEK başarısız satır', async () => {
    vi.mocked(v17MetoduKullanilabilir).mockResolvedValueOnce(false);
    const dc = await geceKostur({ hazirla: x => x.snapAyarla('leads', LEADLER), bakiye: bakiyeYaniti([1, 2, 3, 4, 5].map(n => ({ cha_kod: `120.01.00${n}`, bakiye: '' }))) });
    expect([dc.koleksiyon('cariBalances'), dc.koleksiyon('leads')]).toEqual([[], []]);
    expect(bakiyeSatirlari(dc).map(c => [c[3], String(c[5])])).toEqual([[false, expect.stringContaining('hiçbir satırda okunamadı')]]);
  });

  it('A3 Mikro satır döndürmedi → yazım 0; TEK BAŞARILI «satır yok; bakiye yazılmadı» satırı', async () => {
    vi.mocked(v17MetoduKullanilabilir).mockResolvedValueOnce(false);
    const dc = await geceKostur({ hazirla: x => x.snapAyarla('leads', LEADLER), bakiye: bakiyeYaniti([]) });
    expect([dc.koleksiyon('cariBalances'), dc.koleksiyon('leads')]).toEqual([[], []]);
    expect(bakiyeSatirlari(dc).map(c => [c[2], c[3], c[5]])).toEqual([['satır yok; bakiye yazılmadı', true, null]]);
  });

  it('A3 istisna → TEK başarısız satır (hata metni); sonraki adımlar yine koşar', async () => {
    vi.mocked(v17MetoduKullanilabilir).mockResolvedValueOnce(false);
    const dc = await geceKostur({ hazirla: x => x.snapAyarla('leads', LEADLER), ozelMikro: (m, g) => { if (bakiyeSorgusuMu([m, g])) throw new Error('ağ koptu'); return undefined; } });
    expect(bakiyeSatirlari(dc).map(c => [c[3], c[5]])).toEqual([[false, 'ağ koptu']]);
    expect(dc.syncLog.mock.calls.map(c => c[0]).at(-1)).toBe('GenelAmacliMaliyetListesiV2');
  });
});
