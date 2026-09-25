/**
 * mikroRoutes.eslemeStok.test.ts — `server/mikro/eslemeStok.ts` BAĞLAMASININ rota
 * tarafındaki sözleşmesi (Faz 3 3/n "eslemeStok", 2026-09-19).
 *
 * Saf eşlemenin kendisi `src/server/mikro/eslemeStok.test.ts`te (26 test) kilitli.
 * BURADA kanıtlanan, o modülün rotaya GERÇEKTEN bağlandığıdır — modül doğru olup
 * rotanın eski satır içi kodu koşmaya devam etmesi bu projenin tekrar eden arıza
 * sınıfı ("yazıldı ama bağlanmadı"). Üç iddia:
 *
 *   1. Bilinmeyen alan YAZILAN DOKÜMANDA YOK — `batch.update` o alana dokunmaz,
 *      elle düzeltilmiş ad/kategori/birim ve kullanıcının girdiği stok eşiği kalır.
 *   2. Sayaç import YANITINA (`note`) çıkar; bir alan TÜM satırlarda boşsa notun
 *      BAŞINA "UYARI: … hiçbir satırda okunamadı" girer (okuma arızası).
 *   3. Fiyat import'unda Retail bilinmiyorsa `price` alanı YAZILMAZ (eski
 *      `?? mevcut['Retail'] ?? 0` elle girilen perakende fiyatını 0 TL yapıyordu).
 *
 *   4. `/api/mikro/import/stok-miktar`'ta yanıtı HİÇ okunamayan SKU (ağ/IsError)
 *      bilinmeyen-alan sayacına GİRMEZ — girerse payda şişer ve "hiçbir satırda
 *      okunamadı" kapısı tek bir ağ hatasıyla susar (2026-09-19 hakem bulgusu).
 *
 * (Eski not "stok-miktar rota testi YOK — sahte adminDb `.where()` bilmiyor" 2026-09-19'da
 * geçersiz kaldı: düzenek artık `where/limit/get` destekliyor, uç arka plan işini bitirene
 * kadar bekleniyor. Miktar/maliyet/per-depo SÖZLEŞMESİ yine modül testinde kilitli.)
 *
 * vi.mock blokları BURADA kalmak zorunda (vitest hoisting) — tarif: `mikroMockTarifi`.
 *
 * 2026-09-24 (mikro-import-arkaplan): stok / fiyat / stok-miktar uçları ARKA PLAN işi — yanıt anında
 * `{ started:true, job }`; `note` ve sayılar `jobs/<job>` dokümanında (`d.isBitisi`). İddialar DEĞİŞMEDİ.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { duzenekKur, type Duzenek } from './mikroRoutes.testDuzenegi';
import { mikroPost, mikroSql, mikroKolonlar, vergiOraniCoz } from '../mikroClient.js';

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
    mikroVergiOranlari: vi.fn(async () => ({})),
    vergiOraniCoz: vi.fn(() => null),
  };
});

let d: Duzenek;
beforeEach(() => { d = duzenekKur(); });

/** StokListesiV2 yanıtı — sayfa dolmadığı için tek çağrıda biter. */
function stokYaniti(stok: Record<string, unknown>[]) {
  vi.mocked(mikroPost).mockImplementation((async (metot: string) => (
    metot === 'StokListesiV2'
      ? { ok: true, data: { result: [{ Data: { StokListesi: stok } }] } }
      : { ok: false, data: null }
  )) as unknown as typeof mikroPost);
}
/** SQL import sürücüsü: ilk sayfa verilen satırlar (500'den az → döngü biter). */
function sqlYaniti(rows: Record<string, unknown>[]) {
  vi.mocked(mikroSql).mockImplementation((async () => ({ rows, hata: null })) as unknown as typeof mikroSql);
  vi.mocked(mikroKolonlar).mockImplementation((async () => []) as unknown as typeof mikroKolonlar);
}
const inv = (sku: string) => d.koleksiyon('inventory').find(y => y.data?.sku === sku)?.data ?? {};
/** Stok import'unu başlatır, işin bitmesini bekler, `jobs/mikroImport-stok` dokümanını döner. */
const stokImportu = async () => { await d.cagir('POST', '/api/mikro/import/stok'); return (await d.isBitisi('mikroImport-stok')) ?? {}; };
/** Fiyat import'u (SQL fabrika ucu): bekler, `{ res, is }` döner. */
const fiyatImportu = async () => { const res = await d.cagir('POST', '/api/mikro/import/fiyat'); const is = (await d.isBitisi('mikroImport-fiyat')) ?? {}; return { res, is }; };

describe('POST /api/mikro/import/stok — eslemeStok bağlaması', () => {
  it('Mikro ad/kategori/birim boş dönerse MEVCUT kayıtta o alanlar YAZILMAZ; kullanıcının girdiği lowStockThreshold korunur', async () => {
    d.snapAyarla('inventory', {
      cmt: {
        sku: 'CMT-50', companyId: 'A',
        name: 'ÇİMENTO 50KG (elle düzeltildi)', category: 'Çimento', unit: 'TON',
        lowStockThreshold: 50,
      },
    });
    stokYaniti([{ sto_kod: 'CMT-50', sto_mevcut_mik: '120' }]);

    const is = await stokImportu();
    const yazim = d.koleksiyon('inventory')[0];
    expect(yazim).toMatchObject({ op: 'update', ref: { id: 'cmt' } });
    const veri = yazim.data ?? {};
    for (const alan of ['name', 'category', 'unit', 'lowStockThreshold']) {
      expect(alan in veri, `${alan} yazılmamalı — Mikro bilmiyor, mevcut değer korunur`).toBe(false);
    }
    expect(veri).toMatchObject({ sku: 'CMT-50', stockLevel: 120, companyId: 'A', mikroSynced: true });

    // Depo kaydı görünen adı MEVCUT dokümandan alır (boş metin yazıp ürünü isimsiz bırakmaz).
    const wh = d.koleksiyon('warehouseItems')[0]?.data ?? {};
    expect(wh).toMatchObject({ productName: 'ÇİMENTO 50KG (elle düzeltildi)', category: 'Çimento', quantity: 120 });

    // Sayaç jobs dokümanına (note) çıkar; tek satır olduğu için okuma ARIZASI ilan EDİLMEZ.
    const note = String(is.note);
    expect(note).toContain('1 satırın ürün adı bilinmiyor');
    expect(note.startsWith('UYARI:')).toBe(false);
  });

  it('YENİ kayıtta parite korunur: ad/kategori/birim yedekleri ve lowStockThreshold: 5 yazılır', async () => {
    stokYaniti([{ sto_kod: 'KUM-01', sto_isim: 'Yıkanmış Kum', sto_grup_isim: 'Agrega', sto_birim1_ad: 'TON' }]);
    await stokImportu();
    expect(inv('KUM-01')).toMatchObject({
      name: 'Yıkanmış Kum', category: 'Agrega', unit: 'TON', lowStockThreshold: 5, source: 'mikro_import',
    });
    // Ad bilinmeyen YENİ kayıt yine SKU ile açılır (doküman adsız olamaz) ama sayılır.
    d.sifirla();
    stokYaniti([{ sto_kod: 'BOS-1' }]);
    const is = await stokImportu();
    expect(inv('BOS-1')).toMatchObject({ name: 'BOS-1', category: 'Genel', unit: 'ADET' });
    expect(String(is.note)).toContain('ürün adı bilinmiyor');
  });

  it('bir KRİTİK alan SATIRLARIN TAMAMINDA boşsa okuma arızasıdır: uyarı notun BAŞINA girer', async () => {
    // `vergiOraniCoz` bu dosyada daima null döner → KDV işaretçisi hiçbir satırda
    // çözülemiyor, bu KRİTİKTİR (VergiListesiV2 boş döndü / kolon kaydı).
    stokYaniti(['A', 'B', 'C', 'D', 'E'].map(k => ({ sto_kod: `SKU-${k}`, sto_isim: `Ürün ${k}`, sto_grup_isim: 'Agrega', sto_birim1_ad: 'TON' })));
    const is = await stokImportu();
    const note = String(is.note);
    expect(note.startsWith('UYARI: KDV oranı hiçbir satırda okunamadı'), note).toBe(true);
    // Ad/kategori/birim HER satırda geldi → arıza listesinde OLMAMALI.
    expect(note.split('—')[0]).not.toContain('ürün adı');
    expect(d.syncLog).toHaveBeenCalledWith('ImportStok', 'inventory', expect.stringContaining('UYARI:'), true, null, null, expect.any(Number), expect.anything());
  });

  // 2026-09-19 delta bulgusu: arıza taraması kritik-alan süzgeci olmadan koşuyordu.
  // `StokListesiV2` ANLIK MİKTAR TAŞIMAZ (miktarın kaynağı /import/stok-miktar) ve bu
  // kurulumda fiyat ayrı tablodadır — süzgeçsiz tarama 2367 satırlık HER normal koşuda
  // "UYARI: stok miktarı hiçbir satırda okunamadı — kolon adı/şema kontrol edin" basıyordu.
  it("miktar/fiyat taşımayan NORMAL kart import'u yanlış şema alarmı ÜRETMEZ", async () => {
    vi.mocked(vergiOraniCoz).mockReturnValue(20);
    // setup.ts console.warn'ı GLOBAL olarak casusluyor ve dosya içinde temizlenmiyor —
    // önceki testlerin çağrıları burada sayılmasın.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {}); warn.mockClear();
    stokYaniti(['A', 'B', 'C', 'D', 'E'].map(k => ({ sto_kod: `SKU-${k}`, sto_isim: `Ürün ${k}`, sto_grup_isim: 'Agrega', sto_birim1_ad: 'TON' })));

    const is = await stokImportu();
    const note = String(is.note);
    expect(note.startsWith('UYARI:'), note).toBe(false);
    expect(warn).not.toHaveBeenCalledWith('[import/stok]', expect.anything());
    // Bilgi kaybolmaz: sayaç + fiyat kapsamı yine notta.
    expect(note).toContain('5 satırın stok miktarı bilinmiyor');
    expect(note).toContain('0/5 üründe satış fiyatı bulundu');
  });
});

describe('POST /api/mikro/import/stok-miktar — okuma arızası kapısı sulanmamalı', () => {
  /** Arka plan işi yanıt döndükten SONRA koşar; `arkaPlanIsiBekle` (düzenek `isBitisi`) bitişi bekler. */
  const isBitsin = () => d.isBitisi('stokMiktarImport');

  /** 6 SKU'luk envanter + `GenelAmacliMaliyetListesiV2` yanıtı; CMT-KOPUK ağ hatası verir. */
  const miktarDuzenegi = (veri: Record<string, unknown>) => {
    const skular = ['CMT-1', 'CMT-2', 'CMT-3', 'CMT-4', 'CMT-5', 'CMT-KOPUK'];
    d.snapAyarla('inventory', Object.fromEntries(
      skular.map((sku, i) => [`urun${i}`, { sku, companyId: 'A', source: 'mikro_import', name: `ÇİMENTO ${sku}` }]),
    ));
    vi.mocked(mikroSql).mockImplementation((async () => ({ rows: [], hata: null })) as unknown as typeof mikroSql);
    vi.mocked(mikroPost).mockImplementation((async (metot: string, govde: Record<string, unknown>) => {
      if (metot !== 'GenelAmacliMaliyetListesiV2') return { ok: false, data: null };
      // V17 YOKLAMASI (`Depolar: '1'`) metodun VARLIĞINI sınar ve `EldekiMiktar != null`
      // ister; gerçek döngü tüm depoları sorar (`1,2,3,4,5`). İkisi ayrılmazsa "miktar
      // alanı hiç gelmiyor" senaryosu 501'e düşer ve import hiç koşmaz.
      if (govde.Depolar === '1') return { ok: true, data: { result: [{ Data: { EldekiMiktar: 1 } }] } };
      if (govde.StokKod === 'CMT-KOPUK') return { ok: false, data: null };   // ağ hatası
      return { ok: true, data: { result: [{ Data: veri }] } };
    }) as unknown as typeof mikroPost);
  };

  it("yanıtı hiç okunamayan SKU sayaca GİRMEZ: kalan satırların tamamında eksik olan KRİTİK alan okuma arızası ilan edilir", async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {}); warn.mockClear();
    // 6 SKU: beşi yanıt veriyor ama EldekiMiktar YOK (kolon adı değişmiş gibi),
    // biri ağ/IsError ile düşüyor. Eski kod düşen SKU'yu da satır sayıyordu → 5 ≠ 6
    // olduğu için "hiçbir satırda okunamadı" kapısı HİÇ tetiklenmiyordu; uyarı
    // sessizce sayaca iniyordu (hakem bulgusu 2026-09-19).
    miktarDuzenegi({ MaliyetBedeli: 500 });   // EldekiMiktar YOK

    const res = await d.cagir('POST', '/api/mikro/import/stok-miktar');
    expect(res.govde).toMatchObject({ success: true, started: true, job: 'stokMiktarImport' });
    await isBitsin();

    const ozet = String(d.syncLog.mock.calls[0]?.[2] ?? '');
    expect(ozet.startsWith('UYARI: stok miktarı hiçbir satırda okunamadı'), ozet).toBe(true);
    expect(warn).toHaveBeenCalledWith('[import/stok-miktar]', expect.stringContaining('stok miktarı'));
    // Arıza ilan edilen alan sayaç metninde TEKRAR yazılmaz.
    expect(ozet.split('UYARI:')[1]).not.toContain('satırın stok miktarı bilinmiyor');
    // Veri tarafı korunur: miktarı okunamayan satıra 0 YAZILMAZ (gerçek stok silinmez).
    expect(d.koleksiyon('inventory')).toHaveLength(0);
    expect(ozet).toContain('0 ürünün miktarı güncellendi, 6 hata');
  });

  // 2026-09-19 delta bulgusu: arıza taraması kritik-alan süzgeci olmadan koşuyordu.
  // 'maliyet bedeli' bu rotada MEŞRU olarak gelmeyebilir (hareketsiz ürün) — her
  // koşuda "kolon adı/şema kontrol edin" demek gerçek arızayı görünmez kılar.
  it("maliyet bedeli hiçbir satırda yoksa bu ŞEMA ARIZASI DEĞİLDİR: not UYARI ile başlamaz", async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {}); warn.mockClear();
    miktarDuzenegi({ EldekiMiktar: 10 });     // MaliyetBedeli YOK

    await d.cagir('POST', '/api/mikro/import/stok-miktar');
    await isBitsin();

    const ozet = String(d.syncLog.mock.calls[0]?.[2] ?? '');
    expect(ozet.startsWith('UYARI:'), ozet).toBe(false);
    expect(warn).not.toHaveBeenCalledWith('[import/stok-miktar]', expect.stringContaining('hiçbir satırda'));
    // Sayaç yine görünür: bilgi kaybolmaz, yalnız "şema bozuk" iddiasına dönüşmez.
    expect(ozet).toContain('5 satırın maliyet bedeli bilinmiyor');
    const guncellenen = d.koleksiyon('inventory');
    expect(guncellenen).toHaveLength(5);
    for (const y of guncellenen) expect('costPrice' in (y.data ?? {}), 'maliyet bilinmiyor → yazılmaz').toBe(false);
  });
});

describe('POST /api/mikro/import/fiyat — fiyatEsle bağlaması', () => {
  it("Retail hiç bilinmiyorsa `price` YAZILMAZ (0 TL uydurulmaz); prices + priceCurrency yazılır", async () => {
    d.snapAyarla('inventory', { p1: { sku: 'CMT-50', companyId: 'A', prices: { Retail: 300 } } });
    // Mikro yalnız bayi kademesini (liste 2) döndürüyor — bu kurulumun gerçek hâli.
    sqlYaniti([{ sfiyat_Guid: 'g1', sfiyat_stokkod: 'CMT-50', sfiyat_listesirano: 2, sfiyat_fiyati: 230, sfiyat_doviz: 0 }]);

    const { res } = await fiyatImportu();
    const yazim = d.koleksiyon('inventory')[0];
    expect(yazim).toMatchObject({ op: 'update', ref: { id: 'p1' } });
    // MERGE korunur: mevcut Retail silinmez, üstüne bayi kademesi eklenir.
    expect(yazim.data).toEqual({
      prices: { Retail: 300, 'B2B Standard': 230 },
      price: 300,
      priceCurrency: 'TRY',
      mikroFiyatSyncedAt: 'TS',
    });

    // Mevcut Retail HİÇ yokken `price` alanı yazılmamalı.
    d.sifirla();
    d.snapAyarla('inventory', { p2: { sku: 'CMT-50', companyId: 'A' } });
    sqlYaniti([{ sfiyat_Guid: 'g1', sfiyat_stokkod: 'CMT-50', sfiyat_listesirano: 2, sfiyat_fiyati: 230, sfiyat_doviz: 0 }]);
    const { is: is2 } = await fiyatImportu();
    const veri2 = d.koleksiyon('inventory')[0]?.data ?? {};
    expect('price' in veri2, 'Retail bilinmiyor → price alanı YOK (0 değil)').toBe(false);
    expect(veri2).toMatchObject({ prices: { 'B2B Standard': 230 }, priceCurrency: 'TRY' });
    expect(String(is2.note)).toContain('1 satırın perakende fiyatı bilinmiyor');
    expect(res.kod).toBe(200);
    expect(res.govde).toMatchObject({ success: true, started: true, job: 'mikroImport-fiyat' });
  });

  it("tanınmayan liste no'lu satır (ör. liste 5) SESSİZCE Retail'e yazılmaz — atlanır ve notta sayılır", async () => {
    d.snapAyarla('inventory', { p1: { sku: 'CMT-50', companyId: 'A', prices: { Retail: 300 } } });
    sqlYaniti([
      { sfiyat_Guid: 'g1', sfiyat_stokkod: 'CMT-50', sfiyat_listesirano: 5, sfiyat_fiyati: 999, sfiyat_doviz: 0 },
      { sfiyat_Guid: 'g2', sfiyat_stokkod: 'CMT-50', sfiyat_listesirano: 4, sfiyat_fiyati: 210, sfiyat_doviz: 0 },
    ]);
    const { is } = await fiyatImportu();
    expect(d.koleksiyon('inventory')[0]?.data).toMatchObject({
      prices: { Retail: 300, Dealer: 210 },   // 999 HİÇBİR kademeye yazılmadı
      price: 300,
    });
    expect(String(is.note)).toContain('1 satır tanınmayan fiyat listesi');
  });

  it("liste no kolonu çözülemezse tek-liste varsayımı KORUNUR (Retail) — bu kurulumda yalnız liste 1 dolu", async () => {
    d.snapAyarla('inventory', { p1: { sku: 'CMT-50', companyId: 'A' } });
    sqlYaniti([{ sfiyat_Guid: 'g1', sfiyat_stokkod: 'CMT-50', sfiyat_fiyati: 250, sfiyat_doviz: 0 }]);
    await fiyatImportu();
    expect(d.koleksiyon('inventory')[0]?.data).toMatchObject({ prices: { Retail: 250 }, price: 250 });
  });
});
