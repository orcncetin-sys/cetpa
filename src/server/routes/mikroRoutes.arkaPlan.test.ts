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
import { arkaPlanIsiBaslat } from '../mikro/arkaPlanIsi.js';

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
  it("03:20: cari-hareket + fatura-listesi TAM (>= '2000-01-01'), siparis/stok-hareket 90 gün, BETWEEN YOK, üst sınır YOK; sayfa + süpürge zaman aşımı 120 sn (env 600 sn'ye kadar); arkaPlanIsiBaslat HİÇ; syncLog tanım başına 1", async () => {
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
    const supurgeler = () => vi.mocked(mikroPost).mock.calls.filter(c => c[0] === 'SqlVeriOkuV2');
    const gece = vi.mocked(cron.schedule).mock.calls.find(c => c[0] === '20 3 * * *');
    expect(gece, 'gece cron kayıtlı').toBeDefined();
    await (gece![1] as () => Promise<void>)();   // ! : üstteki iddia tanımlı olduğunu kanıtladı

    expect(sorgular.some(s => s.includes("FROM CARI_HESAP_HAREKETLERI WHERE ISNULL(cha_iptal, 0) = 0 AND cha_tarihi >= '2000-01-01' ORDER BY"))).toBe(true);
    expect(sorgular.some(s => s.includes("cha.cha_tarihi >= '2000-01-01'"))).toBe(true);     // fatura-listesi (alt küme)
    expect(sorgular.some(s => s.includes("sip_tarih >= '2026-06-26'"))).toBe(true);           // 90 gün (ÖLÇÜLMEDİ → kalır)
    expect(sorgular.some(s => s.includes("sth_tarih >= '2026-06-26'"))).toBe(true);
    expect(sorgular.filter(s => /BETWEEN/.test(s))).toEqual([]);
    expect(arkaPlanIsiBaslat).not.toHaveBeenCalled();
    expect(dc.syncLog).toHaveBeenCalledTimes(12);
    // BİLİNÇLİ FARK (S5/K-A ortak gövde; kapanış hakemi 2026-09-25): cron'un ÇAĞRI deseni değişmedi, ama
    // sayfa sorgusu ve iptal süpürgesi artık listeZamanAsimiMs() taşır → gece/aylık cron'da sayfa zaman aşımı
    // 30 sn (server.ts global yaması) → 120 sn. SQL yolunda devre kesici YOK: asılı Mikro'da tanım başına bir
    // zaman aşımı (12 × 120 sn ≈ 24 dk; HEAD ≈ 6 dk). Bu iddialar farkı KİLİTLER — seçenek yalnız HTTP yoluna
    // daraltılırsa (ör. `ilerle ? {…} : undefined`) ya da varsayılan değişirse KIRMIZI.
    expect(secenekler).toEqual(new Array(12).fill({ zamanAsimiMs: 120_000 }));
    expect(supurgeler().map(c => c[3])).toEqual(new Array(3).fill({ zamanAsimiMs: 120_000 }));
    expect(supurgeler().filter(c => /BETWEEN/.test(String((c[1] as { SQLSorgu?: string }).SQLSorgu)))).toEqual([]);   // süpürge de üst sınırsız (hakem 7)

    // Aylık TAM senkron da üst sınırsız; env tavanı (600 sn) cron'a da ULAŞIR → asılı Mikro'da ≈ 12 × 600 sn.
    sorgular.length = 0; secenekler.length = 0; vi.mocked(mikroPost).mockClear();
    vi.stubEnv('MIKRO_LISTE_ZAMAN_ASIMI_MS', '600000');
    const aylik = vi.mocked(cron.schedule).mock.calls.find(c => c[0] === '0 2 1 * *');
    await (aylik![1] as () => Promise<void>)();   // ! : kayıt yoksa test zaten patlar
    expect(sorgular.length).toBe(12);
    expect(sorgular.filter(s => /BETWEEN/.test(s))).toEqual([]);
    expect(sorgular.filter(s => s.includes("cha_tarihi >= '2000-01-01'"))).toHaveLength(2);
    expect(secenekler).toEqual(new Array(12).fill({ zamanAsimiMs: 600_000 }));
    expect(supurgeler().map(c => c[3])).toEqual(new Array(3).fill({ zamanAsimiMs: 600_000 }));
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
