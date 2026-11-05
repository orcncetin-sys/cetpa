// @vitest-environment node
/**
 * stokKodGocuTasima.test.ts — stok kodu göçünün UYGULAMA kararları, SAF (şartname «Mikro bağlantı D» D2 / D3 / D4 / D5 + DH1 yazım
 * tarafı, DH2, DH5, DH7, DH10, DH11, DH14, DH15, DH17, DH18, DH19, DH20). Örnek kodlar ölçü dosyasındaki GERÇEK biçimlerdir (ad yok).
 *
 * MUTASYON NOTLARI (her biri en az bir sınamayı kırmızıya çevirir):
 *   • DH1 tablosunda bir koleksiyonun yolu bozulur (ör. `orders` `lineItems` → `items`) → «DH1 · gerçek biçim» o koleksiyonda kırmızı;
 *   • `belgeyiTasi` karşılaştırması `toUpperCase()` ile kurulur → «DH20 · ı / I» kırmızı;
 *   • `KATLANAN_ALANLAR`'a Mikro alanı (`stockLevel`, `costPrice`) eklenir → «DH5 · Mikro alanı katlanmaz» kırmızı;
 *   • geri almada `sonra` eşitliği aranmaz → «DH11 · sonradan değişen alan atlanır» kırmızı;
 *   • beyaz liste / kiracı denetimi kaldırılır → «DH10» kırmızı;
 *   • DH2 / DH14 engeli kaldırılır → «D4 · engelli satır» kırmızı.
 */
import { describe, it, expect } from 'vitest';
import {
  BAGLI_KAYIT_TABLOSU, bagliKayitlariSay, gocEvreni, kodAnahtari, siniflandir,
  type GocKarti, type KodKaniti, type MikroEskiKodSayimlari, type TabloCifti, type TabloKaynagi,
} from './stokKodGocu';
import type { KuruIc, StokKodEsiKaydi } from './stokKodGocuKuru';
import {
  ENGELLEYEN_GEREKCELER, GERI_ALMA_KOLEKSIYONLARI, KATLANAN_ALANLAR, TASINMAYAN_ALANLAR, YAZILAN_TANIMLAR,
  alanDegisikligi, belgeyiTasi, depoKimlikCakismalari, esCozumu, geriAlGovdesiniCoz, geriAlmaKarari, geriAlmaSatiriReddi,
  hareketYazilirMi, kartAlanlariniKatla, konumKimligiTasi, onayliDogrula, uygulaGovdesiniCoz, zamanMs, type TasimaBaglami,
} from './stokKodGocuTasima';
import { kalemYenilenmeli, mfKalemleri } from './eslemeFatura';
import { bakimKilidiDenetimi } from '../bakimKilidi';

const IMZA = 'a'.repeat(64);
const ESKI = 'AKCALI-AKÇ.00312', YENI = 'AKCALI-00312';
const bag = (ek: Partial<TasimaBaglami> = {}): TasimaBaglami => ({ eski: ESKI, yeni: YENI, eskiKartlar: new Set(['k-eski']), kalanKart: 'k-yeni', companyId: 'A', ...ek });
const tanim = (coll: string) => {
  const t = YAZILAN_TANIMLAR.find(x => x.koleksiyon === coll);
  if (!t) throw new Error(`tanım yok: ${coll}`);
  return t;
};

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('DH16 / DH17 · uygulama gövdesi', () => {
  const tam = { planImza: IMZA, ciftler: [{ eski: ESKI, yeni: YENI, kaynak: 'onayli1010' }], onayli: [{ eski: ESKI, yeni: YENI }] };

  it('imzasız ya da biçimsiz imza → hata (uç 400); tanınmayan alan → hata', () => {
    expect(uygulaGovdesiniCoz({ ...tam, planImza: undefined })).toMatchObject({ tamam: false });
    expect(uygulaGovdesiniCoz({ ...tam, planImza: 'ABC' })).toMatchObject({ tamam: false });
    expect(uygulaGovdesiniCoz({ ...tam, planImza: 'A'.repeat(64) })).toMatchObject({ tamam: false });
    expect(uygulaGovdesiniCoz({ ...tam, sinif: 'kesin' })).toEqual({ tamam: false, error: 'Tanınmayan alan: sinif.' });
    expect(uygulaGovdesiniCoz([tam])).toMatchObject({ tamam: false });
  });

  it('`ciftler` kuru koşu çözücüsünden geçer (tanınmayan kaynak → hata); yokluğu tablosuz koşudur', () => {
    expect(uygulaGovdesiniCoz({ ...tam, ciftler: [{ eski: 'A', yeni: 'B', kaynak: 'uydurma' }] })).toMatchObject({ tamam: false });
    const r = uygulaGovdesiniCoz({ planImza: IMZA, onayli: [{ eski: ESKI, yeni: YENI }] });
    expect(r.tamam && r.g.ciftler).toEqual([]);
  });

  it('onaylı satır: anahtar biçimine iner (U+200E), tekrar yok sayılır; aynı eski iki farklı yeniyle → hata; eski = yeni → hata', () => {
    const r = uygulaGovdesiniCoz({ ...tam, onayli: [{ eski: `${ESKI}\u200E`, yeni: ` ${YENI}` }, { eski: ESKI, yeni: YENI }] });
    expect(r.tamam && r.g.onayli).toEqual([{ eski: ESKI, yeni: YENI }]);
    expect(uygulaGovdesiniCoz({ ...tam, onayli: [{ eski: ESKI, yeni: YENI }, { eski: ESKI, yeni: 'BASKA' }] })).toMatchObject({ tamam: false });
    expect(uygulaGovdesiniCoz({ ...tam, onayli: [{ eski: ESKI, yeni: ESKI }] })).toMatchObject({ tamam: false });
    expect(uygulaGovdesiniCoz({ ...tam, onayli: [{ eski: ESKI, yeni: YENI, sinif: 'kesin' }] })).toMatchObject({ tamam: false });
  });

  it('pasif: hem onaylı hem pasif → hata; ikisi de boş → hata; yalnız pasif kabul', () => {
    expect(uygulaGovdesiniCoz({ ...tam, pasif: [ESKI] })).toMatchObject({ tamam: false });
    expect(uygulaGovdesiniCoz({ planImza: IMZA, onayli: [] })).toMatchObject({ tamam: false });
    const r = uygulaGovdesiniCoz({ planImza: IMZA, pasif: ['RENKLENDİRME15LT', 'RENKLENDİRME15LT'] });
    expect(r.tamam && r.g.pasif).toEqual(['RENKLENDİRME15LT']);
  });

  it('geri alma gövdesi: yalnız `calismaId` (biçimli)', () => {
    expect(geriAlGovdesiniCoz({ calismaId: 'skg-20261105223000-ab12cd' })).toEqual({ tamam: true, g: { calismaId: 'skg-20261105223000-ab12cd' } });
    expect(geriAlGovdesiniCoz({ calismaId: '../users' })).toMatchObject({ tamam: false });
    expect(geriAlGovdesiniCoz({ calismaId: 'skg-20261105223000-ab12cd', x: 1 })).toMatchObject({ tamam: false });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('DH1 · gerçek biçim: her yazılan koleksiyon YALNIZ tablodaki yolla taşınır', () => {
  it('yazılan koleksiyonlar: aynalar (barkodlar, mikroFiyatListeleri) ve mağaza talebi YOK; alanı olmayan (shipments, vehicles) YOK', () => {
    const adlar = YAZILAN_TANIMLAR.map(t => t.koleksiyon);
    for (const c of ['barkodlar', 'mikroFiyatListeleri', 'magazaTalepleri', 'shipments', 'vehicles']) expect(adlar).not.toContain(c);
    for (const c of ['orders', 'quotations', 'quotes', 'priceLists', 'inventoryMovements', 'stockDiscrepancies', 'locationStocks', 'consignments', 'purchaseOrders', 'bom', 'skuMappings', 'warehouseItems']) expect(adlar).toContain(c);
    // DH10 beyaz listesi uygulamanın yazdığı her koleksiyonu kapsar.
    for (const c of [...adlar, 'inventory', 'stokKodEsleri']) expect(GERI_ALMA_KOLEKSIYONLARI.has(c), c).toBe(true);
  });

  it('orders: `lineItems[].sku` (U+200E\'li / NFD yazım dâhil) yeni koda, `inventoryId` kalan karta; ad, tutar, KDV, updatedAt DOKUNULMAZ', () => {
    const veri = {
      companyId: 'A', updatedAt: '2026-10-02T00:00:00.000Z', source: 'mikro-fatura',
      lineItems: [
        { sku: `${ESKI}\u200E`, name: 'GİZLİ', price: 10, kdv: 2, inventoryId: 'k-eski' },
        { sku: 'AKCALI-AKC\u0327.00312', name: 'GİZLİ 2', price: 3 },
        { sku: 'BASKA-1', name: 'x', price: 1 },
      ],
    };
    const r = belgeyiTasi(tanim('orders'), veri, bag());
    expect(r?.alanlar).toEqual(['lineItems']);
    expect(r?.deger).toBe(3);
    expect(r?.veri).toEqual({ ...veri, lineItems: [
      { sku: YENI, name: 'GİZLİ', price: 10, kdv: 2, inventoryId: 'k-yeni' },
      { sku: YENI, name: 'GİZLİ 2', price: 3 },
      { sku: 'BASKA-1', name: 'x', price: 1 },
    ] });
    expect(veri.lineItems[0].sku).toBe(`${ESKI}\u200E`);                       // girdi kopyalanır, yerinde değişmez
    // `items` biçimindeki sipariş (yanlış yol) taşınmaz — tablo `lineItems` der.
    expect(belgeyiTasi(tanim('orders'), { companyId: 'A', items: [{ sku: ESKI }] }, bag())).toBeNull();
  });

  it('quotations: `items[]` VE `lineItems[]` (sku + inventoryId)', () => {
    const r = belgeyiTasi(tanim('quotations'), { companyId: 'A', items: [{ sku: ESKI, inventoryId: 'k-eski' }], lineItems: [{ sku: ESKI }] }, bag());
    expect(r?.veri).toEqual({ companyId: 'A', items: [{ sku: YENI, inventoryId: 'k-yeni' }], lineItems: [{ sku: YENI }] });
    expect(r?.alanlar).toEqual(['items', 'lineItems']);
  });

  it('inventoryMovements: `sth_stok_kod`, `sku`, `productId` (elle hareket); öbür alanlar aynı', () => {
    const r = belgeyiTasi(tanim('inventoryMovements'), { companyId: 'A', sth_stok_kod: ESKI, sth_miktar: 4, productId: 'k-eski', sku: ESKI }, bag());
    expect(r?.veri).toEqual({ companyId: 'A', sth_stok_kod: YENI, sth_miktar: 4, productId: 'k-yeni', sku: YENI });
  });

  it('stockDiscrepancies / locationStocks / consignments: `sku` + `productId`', () => {
    for (const c of ['stockDiscrepancies', 'locationStocks', 'consignments']) {
      const r = belgeyiTasi(tanim(c), { companyId: 'A', sku: ESKI, productId: 'k-eski', miktar: 2 }, bag());
      expect(r?.veri, c).toEqual({ companyId: 'A', sku: YENI, productId: 'k-yeni', miktar: 2 });
    }
  });

  it('purchaseOrders (sku + inventoryId + items[].sku + items[].id), bom (productSku + components[]), priceLists, skuMappings', () => {
    expect(belgeyiTasi(tanim('purchaseOrders'), { companyId: 'A', sku: ESKI, inventoryId: 'k-eski', items: [{ id: 'k-eski', sku: ESKI, qty: 1 }] }, bag())?.veri)
      .toEqual({ companyId: 'A', sku: YENI, inventoryId: 'k-yeni', items: [{ id: 'k-yeni', sku: YENI, qty: 1 }] });
    expect(belgeyiTasi(tanim('bom'), { companyId: 'A', productSku: ESKI, components: [{ sku: ESKI, inventoryId: 'k-eski' }, { sku: 'X' }] }, bag())?.veri)
      .toEqual({ companyId: 'A', productSku: YENI, components: [{ sku: YENI, inventoryId: 'k-yeni' }, { sku: 'X' }] });
    expect(belgeyiTasi(tanim('priceLists'), { companyId: 'A', productId: 'k-eski', items: [{ productId: 'k-eski', sku: ESKI }] }, bag())?.veri)
      .toEqual({ companyId: 'A', productId: 'k-yeni', items: [{ productId: 'k-yeni', sku: YENI }] });
    expect(belgeyiTasi(tanim('skuMappings'), { companyId: 'A', mikroSku: ESKI }, bag())?.veri).toEqual({ companyId: 'A', mikroSku: YENI });
  });

  it('DH19 · etiketsiz belge taşınırken `companyId` yazılır; eski kodu taşımayan belge `null`', () => {
    const r = belgeyiTasi(tanim('orders'), { lineItems: [{ sku: ESKI }] }, bag());
    expect(r?.veri).toEqual({ companyId: 'A', lineItems: [{ sku: YENI }] });
    expect(r?.alanlar).toEqual(['companyId', 'lineItems']);
    expect(belgeyiTasi(tanim('orders'), { lineItems: [{ sku: 'BASKA' }] }, bag())).toBeNull();
  });

  it('DH20 · harf dönüşümü YOK: eski `DEMIR-01` kalemi `DEMİR-01` değildir; eski `KAPı-02` kalemi `KAPI-02` değildir', () => {
    expect(belgeyiTasi(tanim('orders'), { companyId: 'A', lineItems: [{ sku: 'DEMİR-01' }] }, bag({ eski: 'DEMIR-01', yeni: 'YENI-1' }))).toBeNull();
    expect(belgeyiTasi(tanim('orders'), { companyId: 'A', lineItems: [{ sku: 'KAPI-02' }] }, bag({ eski: 'KAPı-02', yeni: 'YENI-2' }))).toBeNull();
    expect(belgeyiTasi(tanim('orders'), { companyId: 'A', lineItems: [{ sku: 'KAPı-02' }] }, bag({ eski: 'KAPı-02', yeni: 'YENI-2' }))?.veri.lineItems).toEqual([{ sku: 'YENI-2' }]);
  });

  it('kalan kart bilinmiyorsa (`null`) kart kimliği yolu yazılmaz, sku yine taşınır', () => {
    expect(belgeyiTasi(tanim('stockDiscrepancies'), { companyId: 'A', sku: ESKI, productId: 'k-eski' }, bag({ kalanKart: null }))?.veri)
      .toEqual({ companyId: 'A', sku: YENI, productId: 'k-eski' });
  });

  it('locationStocks kimliği eski kart kimliğiyle biterse kalan kartla yeni kimlik (server.ts `locId`)', () => {
    expect(konumKimligiTasi('depo__D1__k-eski', new Set(['k-eski']), 'k-yeni')).toBe('depo__D1__k-yeni');
    expect(konumKimligiTasi('depo__D1__baska', new Set(['k-eski']), 'k-yeni')).toBeNull();
    expect(konumKimligiTasi('depo__D1__k-eski', new Set(['k-eski']), null)).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('DH2 · göçten sonra MF kalemi «yenilenmeli» SAYILMAZ (Mikro yeni kodla)', () => {
  it('eski kodlu kalem yeni kodlu Mikro hareketiyle FARKLI; dizgi göçünden sonra AYNI', () => {
    const T = { sth_tarih: '2026-09-06', sth_miktar: 2, sth_tutar: 100, sth_vergi: 20 };
    const kayitli = mfKalemleri([{ ...T, sth_stok_kod: ESKI }], 120, () => undefined).kalemler;
    const kaynak = mfKalemleri([{ ...T, sth_stok_kod: YENI }], 120, () => undefined).kalemler;
    expect(kalemYenilenmeli(kayitli, kaynak)).toBe(true);
    const tasinan = belgeyiTasi(tanim('orders'), { companyId: 'A', lineItems: kayitli }, bag());
    expect(kalemYenilenmeli(tasinan?.veri.lineItems, kaynak)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('D3 + DH2 · inventoryMovements: hangi satır yeni koda yazılır', () => {
  const g = '00000101-0000-1111-2222-333333333333';
  it('elle hareket hep; Mikro satırı yalnız Mikro kodu yeni kodsa; yetim yalnız evrak eşi YOKSA', () => {
    const mikro = new Map([[g, YENI]]);
    expect(hareketYazilirMi('', mikro, new Map(), 'elle-1', YENI)).toBeNull();
    expect(hareketYazilirMi(g, mikro, new Map(), g, YENI)).toBeNull();
    expect(hareketYazilirMi(g, new Map([[g, 'UCUNCU']]), new Map(), g, YENI)).toBe('mikro_kodu_farkli');
    expect(hareketYazilirMi(g, null, new Map(), g, YENI)).toBe('mikro_hareketleri_okunamadi');
    const y = '00000102-0000-1111-2222-333333333333';
    expect(hareketYazilirMi(y, mikro, new Map([[y, false]]), y, YENI)).toBeNull();
    expect(hareketYazilirMi(y, mikro, new Map([[y, true]]), y, YENI)).toBe('yetim_evrak_esi_mikroda');
    expect(hareketYazilirMi(y, mikro, new Map([[y, null]]), y, YENI)).toBe('yetim_evrak_esi_olculmedi');
    expect(hareketYazilirMi(y, mikro, new Map(), y, YENI)).toBe('yetim_evrak_esi_olculmedi');
  });
});

describe('DH18 · warehouseItems kimlik çakışması', () => {
  it('iki FARKLI kod `/` → `_` sonrası aynı parçaya düşerse çakışma; tek kod çakışmaz', () => {
    expect([...depoKimlikCakismalari(['YTONG-60*25*10 PL/48', 'YTONG-60*25*10 PL_48', 'MADE/002'])]).toEqual(['YTONG-60*25*10 PL_48']);
    expect([...depoKimlikCakismalari(['000008/3', 'MADE/002'])]).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('D2 + DH5 · kalan karta alan katlama', () => {
  it('eski eşik 20 + ikiz 5 (import varsayılanı) → 20; ikiz boşsa da 20; ikizde elle 12 varsa taşınmaz, rapora girer', () => {
    expect(kartAlanlariniKatla({ lowStockThreshold: 5 }, [{ id: 'e', veri: { lowStockThreshold: 20 } }]).yama).toEqual({ lowStockThreshold: 20 });
    expect(kartAlanlariniKatla({}, [{ id: 'e', veri: { lowStockThreshold: 20 } }]).yama).toEqual({ lowStockThreshold: 20 });
    expect(kartAlanlariniKatla({ lowStockThreshold: 12 }, [{ id: 'e', veri: { lowStockThreshold: 20 } }])).toEqual({ yama: {}, rapor: [{ alan: 'lowStockThreshold', eskiKart: 'e', neden: 'kalan_dolu' }] });
    expect(kartAlanlariniKatla({ lowStockThreshold: 5 }, [{ id: 'e', veri: { lowStockThreshold: 5 } }])).toEqual({ yama: {}, rapor: [] });
  });

  it('Mikro alanı katlanmaz: kalan kartta `stockLevel` / `costPrice` / `prices` / `barcode` YOKKEN bile eski karttan gelmez', () => {
    const { yama } = kartAlanlariniKatla({ sku: YENI }, [{ id: 'e', veri: { stockLevel: 7, costPrice: 99, prices: { Retail: 10 }, barcode: '869', name: 'GİZLİ', vatRate: 20, unit: 'ADET' } }]);
    expect(yama).toEqual({});
    expect(KATLANAN_ALANLAR.map(f => f.alan).filter(a => TASINMAYAN_ALANLAR.includes(a))).toEqual([]);
  });

  it('`notes` kalan kartta boşsa taşınır, doluysa çakışma raporlanır; yazan ekranı olmayan alan (description, images) taşınmaz', () => {
    expect(kartAlanlariniKatla({ notes: '  ' }, [{ id: 'e', veri: { notes: 'elle not' } }]).yama).toEqual({ notes: 'elle not' });
    expect(kartAlanlariniKatla({ notes: 'kalan not' }, [{ id: 'e', veri: { notes: 'elle not' } }]).rapor).toEqual([{ alan: 'notes', eskiKart: 'e', neden: 'kalan_dolu' }]);
    const r = kartAlanlariniKatla({}, [{ id: 'e', veri: { description: 'açıklama', images: ['a.jpg'], image: 'b.jpg' } }]);
    expect(r.yama).toEqual({});
    expect(r.rapor.map(x => [x.alan, x.neden]).sort()).toEqual([['description', 'yazan_ekran_yok'], ['image', 'yazan_ekran_yok'], ['images', 'yazan_ekran_yok']]);
  });

  // Y29 son inceleme bulgu 3 (06.11.2026). Mutasyon: `KATLANAN_ALANLAR`'dan `location` / `warehouseId` satırı silinir → kırmızı.
  it('elle girilen raf konumu (`location`) ve depo (`warehouseId`) kalan kartta boşsa taşınır; doluysa ve farklıysa `kalan_dolu`', () => {
    expect(kartAlanlariniKatla({ sku: YENI }, [{ id: 'k-eski', veri: { location: 'A-3 raf', warehouseId: 'depo-1' } }]))
      .toEqual({ yama: { location: 'A-3 raf', warehouseId: 'depo-1' }, rapor: [] });
    expect(kartAlanlariniKatla({ location: '', warehouseId: null }, [{ id: 'k-eski', veri: { location: 'A-3 raf', warehouseId: 'depo-1' } }]).yama)
      .toEqual({ location: 'A-3 raf', warehouseId: 'depo-1' });
    expect(kartAlanlariniKatla({ location: 'B-1 raf', warehouseId: 'depo-2' }, [{ id: 'k-eski', veri: { location: 'A-3 raf', warehouseId: 'depo-1' } }]))
      .toEqual({ yama: {}, rapor: [{ alan: 'location', eskiKart: 'k-eski', neden: 'kalan_dolu' }, { alan: 'warehouseId', eskiKart: 'k-eski', neden: 'kalan_dolu' }] });
    // Aynı değer çakışma değildir; eski kartta boşsa hiçbir şey olmaz.
    expect(kartAlanlariniKatla({ location: 'A-3 raf' }, [{ id: 'k-eski', veri: { location: 'A-3 raf', warehouseId: '  ' } }])).toEqual({ yama: {}, rapor: [] });
    expect(KATLANAN_ALANLAR.filter(f => f.alan === 'location' || f.alan === 'warehouseId').map(f => [f.alan, f.kural, f.elleYazan !== null]))
      .toEqual([['location', 'bossa', true], ['warehouseId', 'bossa', true]]);
  });

  it('birden çok eski kart: ilk (en yeni) kazanır, sonraki farklı değer çakışma', () => {
    const r = kartAlanlariniKatla({}, [{ id: 'yeni-e', veri: { notes: 'yeni not', lowStockThreshold: 30 } }, { id: 'eski-e', veri: { notes: 'eski not', lowStockThreshold: 15 } }]);
    expect(r.yama).toEqual({ notes: 'yeni not', lowStockThreshold: 30 });
    expect(r.rapor).toEqual([{ alan: 'lowStockThreshold', eskiKart: 'eski-e', neden: 'kalan_dolu' }, { alan: 'notes', eskiKart: 'eski-e', neden: 'kalan_dolu' }]);
  });

  it('zamanMs: ISO metin, sayı, `{ seconds }`; okunamazsa sütun; o da yoksa null', () => {
    expect(zamanMs('2026-10-01T00:00:00.000Z')).toBe(Date.parse('2026-10-01T00:00:00.000Z'));
    expect(zamanMs({ _seconds: 10 })).toBe(10_000);
    expect(zamanMs(undefined, new Date(5))).toBe(5);
    expect(zamanMs('bozuk', null)).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('DH11 · alan düzeyinde geri alma kararı', () => {
  it('alan yalnız mevcut değer `sonra`ya eşitse döner; önceden yoksa silinir; sonradan değişen alan atlanır ve listelenir', () => {
    const d = alanDegisikligi('inventory', 'k-yeni', { lowStockThreshold: 5, stockLevel: 3 }, { lowStockThreshold: 20, notes: 'n', stockLevel: 3 }, ['lowStockThreshold', 'notes']);
    expect(d).toEqual({ coll: 'inventory', id: 'k-yeni', tur: 'alan', once: { lowStockThreshold: 5 }, onceYok: ['notes'], sonra: { lowStockThreshold: 20, notes: 'n' } });
    expect(geriAlmaKarari(d, { lowStockThreshold: 20, notes: 'n', stockLevel: 9, mikroSyncedAt: 'x' }))
      .toEqual({ islem: 'guncelle', veri: { lowStockThreshold: 5, stockLevel: 9, mikroSyncedAt: 'x' }, atlananAlanlar: [] });
    expect(geriAlmaKarari(d, { lowStockThreshold: 25, notes: 'n' })).toEqual({ islem: 'guncelle', veri: { lowStockThreshold: 25 }, atlananAlanlar: ['lowStockThreshold'] });
    expect(geriAlmaKarari(d, { lowStockThreshold: 25, notes: 'başka' })).toEqual({ islem: 'atla', neden: 'sonradan_degisti', atlananAlanlar: ['lowStockThreshold', 'notes'] });
    expect(geriAlmaKarari(d, null)).toEqual({ islem: 'atla', neden: 'belge_yok' });
  });

  it('dizi alanı (lineItems) kanonik eşitlikle (anahtar sırası fark etmez)', () => {
    const d = alanDegisikligi('orders', 'o', { lineItems: [{ sku: ESKI, price: 1 }] }, { lineItems: [{ sku: YENI, price: 1 }] }, ['lineItems']);
    expect(geriAlmaKarari(d, { lineItems: [{ price: 1, sku: YENI }] })).toEqual({ islem: 'guncelle', veri: { lineItems: [{ sku: ESKI, price: 1 }] }, atlananAlanlar: [] });
  });

  it('silinen belge yalnız kimlik boşsa geri yazılır; açılan belge yalnız hâlâ aynıysa silinir', () => {
    expect(geriAlmaKarari({ coll: 'inventory', id: 'k', tur: 'silindi', tam: { sku: ESKI } }, null)).toEqual({ islem: 'ekle', veri: { sku: ESKI } });
    expect(geriAlmaKarari({ coll: 'inventory', id: 'k', tur: 'silindi', tam: { sku: ESKI } }, { sku: 'X' })).toEqual({ islem: 'atla', neden: 'kimlikte_belge_var' });
    expect(geriAlmaKarari({ coll: 'stokKodEsleri', id: 'e', tur: 'olusturuldu', tam: { a: 1, b: 2 } }, { b: 2, a: 1 })).toEqual({ islem: 'sil' });
    expect(geriAlmaKarari({ coll: 'stokKodEsleri', id: 'e', tur: 'olusturuldu', tam: { a: 1 } }, { a: 1, yenidenKullanildi: true })).toEqual({ islem: 'atla', neden: 'sonradan_degisti' });
  });
});

describe('DH10 · geri alma beyaz listesi + kiracı', () => {
  it('`users` (ya da listede olmayan koleksiyon) → ret; yabancı kiracı görüntüsü → ret; etiketsiz ve kendi kiracısı → kabul', () => {
    expect(geriAlmaSatiriReddi({ coll: 'users', id: 'u1', tur: 'silindi', tam: { role: 'Admin' } }, 'A')).toMatch(/beyaz listede değil: users/);
    expect(geriAlmaSatiriReddi({ coll: 'opsLocks', id: 'bakim', tur: 'silindi', tam: {} }, 'A')).toMatch(/beyaz listede değil/);
    expect(geriAlmaSatiriReddi({ coll: 'inventory', id: 'k', tur: 'silindi', tam: { companyId: 'B' } }, 'A')).toMatch(/yabancı kiracı/);
    expect(geriAlmaSatiriReddi({ coll: 'orders', id: 'o', tur: 'alan', once: { companyId: 'B' }, onceYok: [], sonra: {} }, 'A')).toMatch(/yabancı kiracı/);
    expect(geriAlmaSatiriReddi({ coll: 'inventory', id: 'k', tur: 'silindi', tam: { sku: ESKI } }, 'A')).toBeNull();
    expect(geriAlmaSatiriReddi({ coll: 'inventory', id: 'k', tur: 'silindi', tam: { companyId: 'A' } }, 'A')).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('D4 · onaylı çiftlerin kuru koşuyla doğrulanması (gerçek çekirdekten kurulan iç veri)', () => {
  const kart = (id: string, sku: string, ek: Partial<GocKarti> = {}): GocKarti => ({ id, sku, source: 'mikro_import', companyId: 'A', ...ek });
  const cift = (eski: string, yeni: string, kaynak: TabloKaynagi): TabloCifti => ({ eski: kodAnahtari(eski), yeni: kodAnahtari(yeni), kaynak });
  function ic(o: { kartlar: GocKarti[]; mikro: string[]; tablo: TabloCifti[]; kanitlar?: KodKaniti[]; sayim?: MikroEskiKodSayimlari; magaza?: string[]; esler?: StokKodEsiKaydi[]; siparisler?: Array<{ id: string; veri: Record<string, unknown> }>; konumlar?: Array<{ id: string; veri: Record<string, unknown> }> }): KuruIc {
    const evren = gocEvreni(o.kartlar, o.mikro);
    const eskiKartlar = new Map<string, string[]>([...evren.eskiKodlar].map(([k, ks]) => [k, ks.map(x => x.id)]));
    for (const e of o.esler ?? []) if (!eskiKartlar.has(e.eski)) eskiKartlar.set(e.eski, e.eskiKartlar);
    const siniflama = siniflandir({ evren, tablo: o.tablo, kanitlar: o.kanitlar ?? [], mikroEskiKodda: o.sayim ?? { hareket: new Map(), fiyat: new Map(), barkod: new Map() }, magazaEskiKodlar: new Set(o.magaza ?? []) });
    const t = BAGLI_KAYIT_TABLOSU.find(x => x.koleksiyon === 'orders');
    const tl = BAGLI_KAYIT_TABLOSU.find(x => x.koleksiyon === 'locationStocks');
    if (!t || !tl) throw new Error('orders / locationStocks tanımı yok');
    const konumlar = o.konumlar ?? [];
    return {
      evren, siniflama, sayimlar: [bagliKayitlariSay(t, o.siparisler ?? [], eskiKartlar), bagliKayitlariSay(tl, konumlar, eskiKartlar)], eskiKartlar, kartsizKodlar: [], depoKimlikleri: new Map(),
      konumKimlikleri: new Set(konumlar.map(k => k.id)),
      mikroHareketKodu: new Map(), yetimEvrakEsi: new Map(), aynaStoGuid: new Map(), esler: new Map((o.esler ?? []).map(e => [e.eski, e])),
    };
  }
  const MIKRO = [YENI, 'APEL-HY-003', 'MITREAPEL-HY-003', 'HAR-YENI'];

  it('kesin ve onaylanan dogrula → tam; yeni kod kuru koşunun hedefi değilse → geçersiz; karşılıksız → geçersiz', () => {
    const i = ic({
      kartlar: [kart('k-eski', ESKI), kart('k-yeni', YENI), kart('k-kars', 'RENKLENDİRME15LT'), kart('k-apel', 'APEL-HY-003')],
      mikro: MIKRO, tablo: [cift(ESKI, YENI, 'onayli1010')],
    });
    const r = onayliDogrula(i, [{ eski: ESKI, yeni: YENI }], ['RENKLENDİRME15LT']);
    expect(r.kararlar).toMatchObject([{ tur: 'tam', eski: ESKI, yeni: YENI, kalanKart: 'k-yeni', eskiKartlar: ['k-eski'] }]);
    expect(r.pasifler).toEqual([{ eski: 'RENKLENDİRME15LT', kartlar: ['k-kars'] }]);
    expect(onayliDogrula(i, [{ eski: ESKI, yeni: 'APEL-HY-003' }], []).gecersiz).toEqual([{ eski: ESKI, yeni: 'APEL-HY-003', neden: 'yeni_kuru_kosuyla_uyusmuyor' }]);
    expect(onayliDogrula(i, [{ eski: 'RENKLENDİRME15LT', yeni: YENI }], []).gecersiz).toEqual([{ eski: 'RENKLENDİRME15LT', yeni: YENI, neden: 'karsiliksiz' }]);
    expect(onayliDogrula(i, [], ['YOK-KOD']).gecersiz).toEqual([{ eski: 'YOK-KOD', yeni: null, neden: 'pasif_kart_yok' }]);
  });

  it('çok anlamlı satır: kullanıcı Mikro\'da VAR olan adaylardan birini seçer → tam; aday olmayan → geçersiz', () => {
    const i = ic({
      kartlar: [kart('k-ma', 'MA-HY-003'), kart('k-apel', 'APEL-HY-003'), kart('k-mitre', 'MITREAPEL-HY-003', { source: 'mikro_cron' })],
      mikro: MIKRO, tablo: [cift('MA-HY-003', 'APEL-HY-003', 'onayli1010'), cift('MA-HY-003', 'MITREAPEL-HY-003', 'aktarim0930')],
    });
    expect(i.siniflama.satirlar[0].sinif).toBe('cok_anlamli');
    expect(onayliDogrula(i, [{ eski: 'MA-HY-003', yeni: 'MITREAPEL-HY-003' }], []).kararlar).toMatchObject([{ tur: 'tam', kalanKart: 'k-mitre' }]);
    expect(onayliDogrula(i, [{ eski: 'MA-HY-003', yeni: YENI }], []).gecersiz).toHaveLength(1);
  });

  it('DH2 / DH14 engeli: Mikro\'da eski kodla hareket ya da mağaza talebi eski kodda → onaylı olsa da geçersiz', () => {
    const i = ic({
      kartlar: [kart('k-har', 'HAR-ESKI'), kart('k-hary', 'HAR-YENI'), kart('k-eski', ESKI), kart('k-yeni', YENI)],
      mikro: MIKRO, tablo: [cift('HAR-ESKI', 'HAR-YENI', 'onayli1010'), cift(ESKI, YENI, 'onayli1010')],
      sayim: { hareket: new Map([['HAR-ESKI', 3]]), fiyat: new Map(), barkod: new Map() }, magaza: [ESKI],
    });
    expect(onayliDogrula(i, [{ eski: 'HAR-ESKI', yeni: 'HAR-YENI' }, { eski: ESKI, yeni: YENI }], []).gecersiz).toEqual([
      { eski: 'HAR-ESKI', yeni: 'HAR-YENI', neden: 'engel:mikro_hareket_eski_kodda' },
      { eski: ESKI, yeni: YENI, neden: 'engel:magaza_talebi_eski_kodda' },
    ]);
    // ölçülemeyen sayım da engeldir (boş sonuç kanıt değil)
    expect(ENGELLEYEN_GEREKCELER.has('mikro_olcum_yok_hareket')).toBe(true);
  });

  it('kalan kart yok / birden çok → geçersiz', () => {
    const yok = ic({ kartlar: [kart('k-eski', ESKI)], mikro: MIKRO, tablo: [cift(ESKI, YENI, 'onayli1010')] });
    expect(onayliDogrula(yok, [{ eski: ESKI, yeni: YENI }], []).gecersiz[0].neden).toBe('kalan_kart_yok');
    const cok = ic({ kartlar: [kart('k-eski', ESKI), kart('y1', YENI), kart('y2', YENI)], mikro: MIKRO, tablo: [cift(ESKI, YENI, 'onayli1010')] });
    expect(onayliDogrula(cok, [{ eski: ESKI, yeni: YENI }], []).gecersiz[0].neden).toBe('kalan_kart_birden_cok');
  });

  // İnceleme turu 06.11.2026 (MKD4 dizin 1). Mutasyon: `konumCakismasi` denetimi kaldırılır → ilk iki sınama kırmızı; `hedefler`
  // kümesi kaldırılır → «iki eski kart aynı depoda» kırmızı; denetim kimliğe bakmadan her konumda çakışma sayar → «başka depo» kırmızı.
  it('MKD4 · tam çiftte eski konum belgesinin yeni kimliği doluysa → geçersiz `hedef_konum_belgesi_var` (uygulama hatası önizlemede görünür)', () => {
    const i = ic({
      kartlar: [kart('k-eski', ESKI), kart('k-yeni', YENI)], mikro: MIKRO, tablo: [cift(ESKI, YENI, 'onayli1010')],
      konumlar: [
        { id: 'depo__D1__k-eski', veri: { productId: 'k-eski', sku: ESKI, quantity: 2, companyId: 'A' } },
        { id: 'depo__D1__k-yeni', veri: { productId: 'k-yeni', sku: YENI, quantity: 7, companyId: 'A' } },
      ],
    });
    const r = onayliDogrula(i, [{ eski: ESKI, yeni: YENI }], []);
    expect(r.gecersiz).toEqual([{ eski: ESKI, yeni: YENI, neden: 'hedef_konum_belgesi_var' }]);
    expect(r.kararlar).toEqual([]);
  });

  it('MKD4 · iki eski kart aynı depoda (ikisi de aynı yeni kimliğe düşer) → geçersiz `hedef_konum_belgesi_var`', () => {
    const i = ic({
      kartlar: [kart('k-eski1', ESKI), kart('k-eski2', ESKI), kart('k-yeni', YENI)], mikro: MIKRO, tablo: [cift(ESKI, YENI, 'onayli1010')],
      konumlar: [
        { id: 'depo__D1__k-eski1', veri: { productId: 'k-eski1', sku: ESKI, quantity: 2, companyId: 'A' } },
        { id: 'depo__D1__k-eski2', veri: { productId: 'k-eski2', sku: ESKI, quantity: 3, companyId: 'A' } },
      ],
    });
    expect(onayliDogrula(i, [{ eski: ESKI, yeni: YENI }], []).gecersiz).toEqual([{ eski: ESKI, yeni: YENI, neden: 'hedef_konum_belgesi_var' }]);
  });

  // MKD5 delta (06.11.2026): ortak hedef — iki eski kod aynı yeni koda gider, iki eski kartın da D1 konumu var: ikisi de
  // `depo__D1__k-apel` kimliğine düşer. Önizleme sıradaki İKİNCİ çifti işaretler. Mutasyon: `tumHedefler.add` kaldırılır → kırmızı.
  it('MKD5 · iki eski kod aynı yeni koda (ortak hedef), ikisinin de aynı depoda konumu var → ikinci çift `hedef_konum_belgesi_var`', () => {
    const i = ic({
      kartlar: [kart('k-ma', 'MA-HY-003'), kart('k-mitre', 'MITREAPEL-HY-003'), kart('k-apel', 'APEL-HY-003')],
      mikro: [YENI, 'APEL-HY-003'], tablo: [cift('MA-HY-003', 'APEL-HY-003', 'onayli1010'), cift('MITREAPEL-HY-003', 'APEL-HY-003', 'onayli1010')],
      konumlar: [
        { id: 'depo__D1__k-ma', veri: { productId: 'k-ma', sku: 'MA-HY-003', quantity: 2, companyId: 'A' } },
        { id: 'depo__D1__k-mitre', veri: { productId: 'k-mitre', sku: 'MITREAPEL-HY-003', quantity: 3, companyId: 'A' } },
      ],
    });
    const r = onayliDogrula(i, [{ eski: 'MA-HY-003', yeni: 'APEL-HY-003' }, { eski: 'MITREAPEL-HY-003', yeni: 'APEL-HY-003' }], []);
    expect(r.gecersiz).toEqual([{ eski: 'MITREAPEL-HY-003', yeni: 'APEL-HY-003', neden: 'hedef_konum_belgesi_var' }]);
    expect(r.kararlar).toMatchObject([{ tur: 'tam', eski: 'MA-HY-003', yeni: 'APEL-HY-003', kalanKart: 'k-apel' }]);
    // Ayrı depolarda (D1 / D2) çakışma yok: ikisi de tam.
    const ayri = ic({
      kartlar: [kart('k-ma', 'MA-HY-003'), kart('k-mitre', 'MITREAPEL-HY-003'), kart('k-apel', 'APEL-HY-003')],
      mikro: [YENI, 'APEL-HY-003'], tablo: [cift('MA-HY-003', 'APEL-HY-003', 'onayli1010'), cift('MITREAPEL-HY-003', 'APEL-HY-003', 'onayli1010')],
      konumlar: [
        { id: 'depo__D1__k-ma', veri: { productId: 'k-ma', sku: 'MA-HY-003', quantity: 2, companyId: 'A' } },
        { id: 'depo__D2__k-mitre', veri: { productId: 'k-mitre', sku: 'MITREAPEL-HY-003', quantity: 3, companyId: 'A' } },
      ],
    });
    expect(onayliDogrula(ayri, [{ eski: 'MA-HY-003', yeni: 'APEL-HY-003' }, { eski: 'MITREAPEL-HY-003', yeni: 'APEL-HY-003' }], []).gecersiz).toEqual([]);
  });

  it('MKD4 · hedef kimlik boş (yeni kartın konumu başka depoda; iki eski kart ayrı depolarda) → tam', () => {
    const i = ic({
      kartlar: [kart('k-eski1', ESKI), kart('k-eski2', ESKI), kart('k-yeni', YENI)], mikro: MIKRO, tablo: [cift(ESKI, YENI, 'onayli1010')],
      konumlar: [
        { id: 'depo__D1__k-eski1', veri: { productId: 'k-eski1', sku: ESKI, quantity: 2, companyId: 'A' } },
        { id: 'arac__V1__k-eski2', veri: { productId: 'k-eski2', sku: ESKI, quantity: 3, companyId: 'A' } },
        { id: 'depo__D2__k-yeni', veri: { productId: 'k-yeni', sku: YENI, quantity: 7, companyId: 'A' } },
      ],
    });
    const r = onayliDogrula(i, [{ eski: ESKI, yeni: YENI }], []);
    expect(r.gecersiz).toEqual([]);
    expect(r.kararlar).toMatchObject([{ tur: 'tam', eski: ESKI, yeni: YENI, kalanKart: 'k-yeni' }]);
  });

  it('DH7 · eski kart yok + eş aynı yeni: bağlı kayıt 0 → atla; bağlı kayıt > 0 → YALNIZ referans; eş yok → geçersiz', () => {
    const es: StokKodEsiKaydi = { id: 'x', eski: ESKI, yeni: YENI, eskiKartlar: ['k-eski'], kalanKart: 'k-yeni' };
    const bos = ic({ kartlar: [kart('k-yeni', YENI)], mikro: MIKRO, tablo: [], esler: [es] });
    expect(onayliDogrula(bos, [{ eski: ESKI, yeni: YENI }], []).kararlar).toEqual([{ tur: 'atla', eski: ESKI, yeni: YENI, neden: 'zaten_uygulandi' }]);
    const dolu = ic({ kartlar: [kart('k-yeni', YENI)], mikro: MIKRO, tablo: [], esler: [es], siparisler: [{ id: 'o1', veri: { companyId: 'A', lineItems: [{ sku: ESKI }] } }] });
    expect(onayliDogrula(dolu, [{ eski: ESKI, yeni: YENI }], []).kararlar).toEqual([{ tur: 'referans', eski: ESKI, yeni: YENI, kalanKart: 'k-yeni', eskiKartlar: ['k-eski'] }]);
    expect(onayliDogrula(dolu, [{ eski: ESKI, yeni: 'APEL-HY-003' }], []).gecersiz[0].neden).toBe('kuru_kosuda_yok');
    expect(onayliDogrula(dolu, [{ eski: 'HAR-YENI', yeni: YENI }], []).gecersiz[0].neden).toBe('eski_kod_mikroda');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('DH14 · mağaza eş çözümü (sıra sabit: anahtar → -Dnnn → eş → renk/baz → son ek)', () => {
  const esler = new Map([['ESKI', 'YENI'], ['DYO-205-0001-45', 'DYO-YENI-45'], [ESKI, YENI]]);
  it('`ESKI-D025` → `YENI-D025`; son eksiz kod doğrudan; U+200E\'li kod anahtara iner', () => {
    expect(esCozumu('ESKI-D025', esler)).toEqual({ kod: 'YENI-D025', yol: 'es' });
    expect(esCozumu('ESKI', esler)).toEqual({ kod: 'YENI', yol: 'es' });
    expect(esCozumu(`\u200E${ESKI}-D002`, esler)).toEqual({ kod: `${YENI}-D002`, yol: 'es' });
  });
  it('DYO renk varyantı baz kartın YENİ koduna (renk parçası eklenmez); 3 parçalı önekle YANLIŞ koda eşlenmez', () => {
    expect(esCozumu('DYO-205-0001-45-7233', esler)).toEqual({ kod: 'DYO-YENI-45', yol: 'baz_es' });
    expect(esCozumu('DYO-386-0001-18-0001-0001', new Map([['DYO-386-0001', 'YANLIS']]))).toBeNull();
    expect(esCozumu('DYO-205-0001-46-7233', esler)).toBeNull();
    expect(esCozumu('BILINMEYEN', esler)).toBeNull();
    expect(esCozumu(42, esler)).toBeNull();
  });
});

describe('DH8 · bekçi bakım kilidi kontrolü', () => {
  const t0 = Date.parse('2026-11-05T20:00:00.000Z');
  it('kilit yok → geçer; 1 saatlik → geçer; 2 saatten eski → FAIL; başlangıcı okunamayan → FAIL', () => {
    expect(bakimKilidiDenetimi(null, t0).ok).toBe(true);
    expect(bakimKilidiDenetimi({ aciklama: 'stok-kod-gocu skg-1', baslangic: '2026-11-05T19:00:00.000Z' }, t0).ok).toBe(true);
    const eski = bakimKilidiDenetimi({ aciklama: 'stok-kod-gocu skg-1', baslangic: '2026-11-05T17:30:00.000Z' }, t0);
    expect(eski).toEqual({ ok: false, detail: expect.stringContaining('150 dk') });
    expect(bakimKilidiDenetimi({ aciklama: 'x', baslangic: '' }, t0).ok).toBe(false);
  });
});
