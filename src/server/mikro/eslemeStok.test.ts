/**
 * eslemeStok.test.ts — Mikro'dan OKUYAN stok/fiyat/miktar eşlemelerinin sözleşmesi
 * (Faz 3 3/n "eslemeStok" grubu, 2026-09-19). ÖNCE YAZILDI (kırmızı görüldü).
 *
 * İKİ SINIF İDDİA:
 *   (a) PARİTE — bilinen girdide eşleme, rotadaki eski satır içi kodla BİREBİR aynı
 *       nesneyi üretir (alan adları + değerler `toEqual` ile kilitli).
 *   (b) BİLİNMEYEN → ALAN YAZILMAZ + SAYAÇ — Mikro okuması bir alanı vermediyse o alan
 *       dönen nesnede HİÇ bulunmaz (update/merge mevcut değeri korur) ve alan adı
 *       `bilinmeyen` listesine düşer. `?? 0` / `|| 1` mutasyonu bu testleri KIRAR.
 *
 * Fikstür Türkçe ve gerçek veriden: ÇİMENTO 50KG (₺), Şirin İnşaat deposu.
 */
import { describe, it, expect } from 'vitest';
import {
  stokEsle, fiyatEsle, stokMiktarEsle, depoSatiriCoz,
  sayacOlustur, sayacaEkle, sayacNotu, okumaArizalari, okumaArizasiNotu,
  STOK_KRITIK, FIYAT_KRITIK, STOK_MIKTAR_KRITIK, DEPO_KRITIK,
} from './eslemeStok';

const VERGI = new Map<number, number>([[3, 10], [4, 20]]);

/** Mikro StokListesiV2 satırı — tüm alanları BİLİNEN tam kayıt. */
const tamSatir = {
  sto_kod: 'CMT-50',
  sto_isim: 'ÇİMENTO 50KG',
  sto_grup_isim: 'Çimento',
  sto_birim1_ad: 'TON',
  sto_perakende_vergi: 4,
  sto_mevcut_mik: '120',
  sto_satis_fiyat1: 250,
  sto_satis_fiyat2: 230,
};

describe('stokEsle — parite (bilinen girdide eski satır içi eşlemenin aynısı)', () => {
  it('tam satır + YENİ kayıt → eski `item` nesnesiyle birebir aynı alanlar', () => {
    const { alanlar, bilinmeyen } = stokEsle(tamSatir, undefined, { vergiTablosu: VERGI });
    expect(alanlar).toEqual({
      sku: 'CMT-50',
      name: 'ÇİMENTO 50KG',
      category: 'Çimento',
      unit: 'TON',
      vatRate: 20,
      stockLevel: 120,
      lowStockThreshold: 5,
      prices: { Retail: 250, 'B2B Standard': 230 },
      price: 250,
      mikroStoKod: 'CMT-50',
      mikroSynced: true,
      source: 'mikro_import',
    });
    expect(bilinmeyen).toEqual([]);
  });

  it('kategori sto_grup_isim yoksa sto_grup_kodu, ikisi de yoksa "Genel" (yeni kayıtta)', () => {
    expect(stokEsle({ sto_kod: 'A', sto_grup_kodu: 'INS' }).alanlar.category).toBe('INS');
    const bos = stokEsle({ sto_kod: 'A' });
    expect(bos.alanlar.category).toBe('Genel');
    expect(bos.bilinmeyen).toContain('kategori');
  });

  it('ad boşsa yeni kayıtta SKU ile açılır (eski davranış) ama sayaca girer', () => {
    const r = stokEsle({ sto_kod: 'KUM-01' });
    expect(r.alanlar.name).toBe('KUM-01');
    expect(r.alanlar.unit).toBe('ADET');
    expect(r.bilinmeyen).toEqual(expect.arrayContaining(['ürün adı', 'birim']));
  });
});

describe('stokEsle — bilinmeyen alan YAZILMAZ (sessiz-sıfır/uydurma sınıfı)', () => {
  it('miktar alanı yoksa stockLevel YAZILMAZ (mevcut stok ezilmez), sayaç artar', () => {
    const r = stokEsle({ sto_kod: 'KUM-01' }, { stockLevel: 40 });
    expect('stockLevel' in r.alanlar).toBe(false);
    expect(r.bilinmeyen).toContain('stok miktarı');
  });

  it('vergi işaretçisi tabloda yoksa vatRate YAZILMAZ (sabit %20 uydurulmaz)', () => {
    const r = stokEsle({ sto_kod: 'A', sto_perakende_vergi: 9 }, undefined, { vergiTablosu: VERGI });
    expect('vatRate' in r.alanlar).toBe(false);
    expect(r.bilinmeyen).toContain('KDV oranı');
    // Tablo hiç gelmediyse (VergiListesiV2 hatası) de aynı: alan yok.
    expect('vatRate' in stokEsle({ sto_kod: 'A', sto_perakende_vergi: 4 }).alanlar).toBe(false);
  });

  it('hiç fiyat yoksa prices/price YAZILMAZ; Retail yoksa `price: 0` UYDURULMAZ', () => {
    const yok = stokEsle({ sto_kod: 'F0' });
    expect('prices' in yok.alanlar || 'price' in yok.alanlar).toBe(false);
    expect(yok.bilinmeyen).toContain('satış fiyatı');

    const sadeceBayi = stokEsle({ sto_kod: 'F1', sto_satis_fiyat2: 90 });
    expect(sadeceBayi.alanlar.prices).toEqual({ 'B2B Standard': 90 });
    expect('price' in sadeceBayi.alanlar, 'Retail bilinmiyor → price alanı HİÇ olmamalı').toBe(false);
    expect(sadeceBayi.bilinmeyen).toContain('perakende fiyatı');
  });

  it('MEVCUT kayıtta Mikro alanı boşsa ad/kategori/birim EZİLMEZ (elle düzeltilen ad korunur)', () => {
    const mevcut = { name: 'Çimento 50 kg torba', category: 'İnşaat', unit: 'TON' };
    const r = stokEsle({ sto_kod: 'CMT-50' }, mevcut);
    expect('name' in r.alanlar).toBe(false);
    expect('category' in r.alanlar).toBe(false);
    expect('unit' in r.alanlar).toBe(false);
    expect(r.bilinmeyen).toEqual(expect.arrayContaining(['ürün adı', 'kategori', 'birim']));
  });

  it('lowStockThreshold yalnız YENİ kayıtta yazılır — kullanıcının girdiği eşik senkronla 5 olmaz', () => {
    expect(stokEsle(tamSatir, undefined, { vergiTablosu: VERGI }).alanlar.lowStockThreshold).toBe(5);
    expect('lowStockThreshold' in stokEsle(tamSatir, { lowStockThreshold: 50 }, { vergiTablosu: VERGI }).alanlar).toBe(false);
  });

  it('source/mikroSynced güncellemede de yazılır (stok-miktar işi source ile ürün seçiyor)', () => {
    const r = stokEsle(tamSatir, { name: 'x' }, { vergiTablosu: VERGI });
    expect(r.alanlar).toMatchObject({ source: 'mikro_import', mikroSynced: true, mikroStoKod: 'CMT-50' });
  });
});

describe('fiyatEsle — /api/mikro/import/fiyat', () => {
  it('parite: Retail bilinen → prices + price + priceCurrency TRY', () => {
    const { alanlar, bilinmeyen } = fiyatEsle({ Retail: 250, Dealer: 210 }, { Retail: 240 });
    expect(alanlar).toEqual({ prices: { Retail: 250, Dealer: 210 }, price: 250, priceCurrency: 'TRY' });
    expect(bilinmeyen).toEqual([]);
  });

  it('Retail HİÇ yoksa `price` alanı YAZILMAZ (eski `?? 0` elle girilen perakende fiyatını 0 yapıyordu)', () => {
    const { alanlar, bilinmeyen } = fiyatEsle({ Dealer: 210 }, {});
    expect(alanlar).toEqual({ prices: { Dealer: 210 }, priceCurrency: 'TRY' });
    expect('price' in alanlar).toBe(false);
    expect(bilinmeyen).toContain('perakende fiyatı');
  });

  it('Retail yalnız MEVCUT kayıtta varsa oradan yazılır (eski `?? mevcut[Retail]` davranışı korunur)', () => {
    const { alanlar, bilinmeyen } = fiyatEsle({ Dealer: 210 }, { Retail: 240 });
    expect(alanlar.price).toBe(240);
    expect(bilinmeyen).toEqual([]);
  });

  it('Retail 0/negatif/metin ise fiyat BİLİNMİYOR sayılır — 0 TL yazılmaz', () => {
    for (const bozuk of [0, -5, '', 'abc', null]) {
      const { alanlar } = fiyatEsle({ Retail: bozuk, Dealer: 210 }, {});
      expect('price' in alanlar, `Retail=${String(bozuk)} için price yazılmamalı`).toBe(false);
    }
  });

  it('hiç bilinen fiyat yoksa prices bile YAZILMAZ (boş nesne mevcut fiyatları ezerdi)', () => {
    const { alanlar, bilinmeyen } = fiyatEsle({}, {});
    expect(alanlar).toEqual({});
    expect(bilinmeyen).toContain('satış fiyatı');
  });
});

describe('stokMiktarEsle — /api/mikro/import/stok-miktar (GenelAmacliMaliyetListesiV2 Data)', () => {
  it('parite: EldekiMiktar + MaliyetBedeli bilinen → stockLevel + birim maliyet (2 hane yuvarlı)', () => {
    const { alanlar, bilinmeyen } = stokMiktarEsle({ EldekiMiktar: 12, MaliyetBedeli: 3000.04 });
    expect(alanlar).toEqual({ stockLevel: 12, costPrice: 250 });
    expect(bilinmeyen).toEqual([]);
  });

  it('MaliyetBedeli yoksa costPrice YAZILMAZ — eski `?? 0` gerçek maliyeti 0 TL yapıyordu', () => {
    const { alanlar, bilinmeyen } = stokMiktarEsle({ EldekiMiktar: 12 });
    expect(alanlar).toEqual({ stockLevel: 12 });
    expect('costPrice' in alanlar).toBe(false);
    expect(bilinmeyen).toContain('maliyet bedeli');
  });

  it('EldekiMiktar yoksa/sayı değilse hiçbir alan yazılmaz (yanıt okunamadı = 0 stok DEĞİL)', () => {
    for (const bozuk of [undefined, null, '', 'abc']) {
      const r = stokMiktarEsle({ EldekiMiktar: bozuk, MaliyetBedeli: 3000 });
      expect(r.alanlar).toEqual({});
      expect(r.bilinmeyen).toContain('stok miktarı');
    }
  });

  // Sayaç paydası TUTARLI olmalı: miktarı okunamayan satırda maliyet OKUNMADAN
  // dönülürse 'maliyet bedeli' o satırda sayılmaz, `n === satır` eşitliği bozulur ve
  // "hiçbir satırda okunamadı" kapısı hiç tetiklenmez (hakem bulgusu 2026-09-19).
  it('miktar okunamayan satırda maliyet de okunamıyorsa İKİSİ de sayılır (arıza kapısı sulanmaz)', () => {
    const r = stokMiktarEsle({});
    expect(r.alanlar).toEqual({});
    expect(r.bilinmeyen).toEqual(['stok miktarı', 'maliyet bedeli']);
  });

  it('miktar 0 ise birim maliyet HESAPLANAMAZ — costPrice yok ama bu okuma arızası değil', () => {
    const { alanlar, bilinmeyen } = stokMiktarEsle({ EldekiMiktar: 0, MaliyetBedeli: 3000 });
    expect(alanlar).toEqual({ stockLevel: 0 });
    expect(bilinmeyen).toEqual([]);
  });
});

describe('depoSatiriCoz — per-depo bakiye satırı (STOK_HAREKETLERI toplamı)', () => {
  it('parite: normal satır çözülür', () => {
    expect(depoSatiriCoz({ sth_stok_kod: 'CMT-50', depo: 2, bakiye: 527 }).satir)
      .toEqual({ sku: 'CMT-50', depoNo: '2', bakiye: 527 });
  });

  it('bakiye sayı DEĞİLSE satır atlanır ve sayılır — eski `Number(x ?? 0)` NaN yazıyordu', () => {
    const r = depoSatiriCoz({ sth_stok_kod: 'CMT-50', depo: 2, bakiye: 'abc' });
    expect(r.satir).toBeNull();
    expect(r.bilinmeyen).toContain('depo bakiyesi');
    expect(depoSatiriCoz({ sth_stok_kod: 'CMT-50', depo: 2, bakiye: null }).satir).toBeNull();
  });

  it('bakiye 0 ise satır atlanır ama BİLİNMEYEN değildir (gerçekten sıfır bakiye)', () => {
    const r = depoSatiriCoz({ sth_stok_kod: 'CMT-50', depo: 2, bakiye: 0 });
    expect(r.satir).toBeNull();
    expect(r.bilinmeyen).toEqual([]);
  });

  it('stok kodu/depo no boşsa satır atlanır ve sayılır', () => {
    expect(depoSatiriCoz({ depo: 2, bakiye: 5 }).bilinmeyen).toContain('stok kodu');
    expect(depoSatiriCoz({ sth_stok_kod: 'A', bakiye: 5 }).bilinmeyen).toContain('depo numarası');
  });
});

describe('sayaç + okuma arızası (sessiz-sıfır sınıfının import karşılığı)', () => {
  it('not metni: alan başına "N satırın X bilinmiyor"', () => {
    const s = sayacOlustur();
    sayacaEkle(s, ['maliyet bedeli']);
    sayacaEkle(s, ['maliyet bedeli', 'stok miktarı']);
    sayacaEkle(s, []);
    expect(sayacNotu(s, [])).toBe('2 satırın maliyet bedeli bilinmiyor, 1 satırın stok miktarı bilinmiyor');
    expect(sayacNotu(sayacOlustur(), [])).toBe('');
  });

  it('arıza ilan edilen alan sayaç metninde TEKRAR yazılmaz (aynı bilgi iki kez)', () => {
    const s = sayacOlustur();
    for (let i = 0; i < 6; i++) sayacaEkle(s, i === 0 ? ['stok miktarı', 'maliyet bedeli'] : ['stok miktarı']);
    const arizalar = okumaArizalari(s, STOK_MIKTAR_KRITIK);
    expect(arizalar).toEqual(['stok miktarı']);
    expect(sayacNotu(s, arizalar)).toBe('1 satırın maliyet bedeli bilinmiyor');
  });

  it('KRİTİK alan TÜM satırlarda bilinmiyorsa (≥5 satır) bu veri değil OKUMA ARIZASIDIR', () => {
    const s = sayacOlustur();
    // 6 satırın HEPSİNDE miktar yok (kolon adı/şema arızası); maliyet yalnız 1'inde.
    for (let i = 0; i < 6; i++) sayacaEkle(s, i === 0 ? ['maliyet bedeli', 'stok miktarı'] : ['stok miktarı']);
    expect(okumaArizalari(s, STOK_MIKTAR_KRITIK)).toEqual(['stok miktarı']);
  });

  it('5 satırdan AZ importta arıza ilan edilmez (küçük import doğal olarak eksik olabilir)', () => {
    const s = sayacOlustur();
    for (let i = 0; i < 4; i++) sayacaEkle(s, ['stok miktarı']);
    expect(okumaArizalari(s, STOK_MIKTAR_KRITIK)).toEqual([]);
  });

  it('uyarı metni kolon/şema kontrolüne yönlendirir; arıza yoksa boş string', () => {
    expect(okumaArizasiNotu(['maliyet bedeli', 'depo bakiyesi']))
      .toBe('UYARI: maliyet bedeli, depo bakiyesi hiçbir satırda okunamadı — kolon adı/şema kontrol edin.');
    expect(okumaArizasiNotu([])).toBe('');
  });
});

// ── KRİTİK ALAN SÜZGECİ ───────────────────────────────────────────────────────
// 2026-09-19 delta bulgusu: arıza taraması sayaçtaki TÜM alanlara bakıyordu.
// StokListesiV2 ANLIK MİKTAR TAŞIMAZ (mikroClient.ts:273-282 — miktarın kaynağı
// GenelAmacliMaliyetListesiV2 / ayrı rota) ve bu kurulumda fiyat da ayrı tabloda.
// Sonuç: HER stok import'u "UYARI: stok miktarı hiçbir satırda okunamadı — kolon
// adı/şema kontrol edin" ile başlıyordu. Kalıcı yanlış alarm, GERÇEK arızayı
// (ör. `sto_isim` kolonunun kayması) aynı cümlenin içinde görünmez kılar.
describe('okuma arızası YALNIZ kritik alanlarda aranır (kalıcı yanlış alarm sınıfı)', () => {
  /** `n` satırlık import; her satır aynı alanları bilmiyor. */
  const sayacKur = (n: number, bilinmeyen: string[]) => {
    const s = sayacOlustur();
    for (let i = 0; i < n; i++) sayacaEkle(s, bilinmeyen);
    return s;
  };

  it('stok import: miktarı HİÇ gelmeyen 5 satır UYARI ÜRETMEZ (miktarın kaynağı ayrı rota)', () => {
    const s = sayacKur(5, ['stok miktarı', 'satış fiyatı']);
    expect(okumaArizalari(s, STOK_KRITIK)).toEqual([]);
    expect(okumaArizasiNotu(okumaArizalari(s, STOK_KRITIK))).toBe('');
  });

  it('stok import: `sto_isim` kolonu kayarsa (ürün adı 5 satırda da yok) UYARI ÜRETİR', () => {
    const s = sayacKur(5, ['ürün adı', 'stok miktarı']);
    expect(okumaArizalari(s, STOK_KRITIK)).toEqual(['ürün adı']);
  });

  it('stok import: KDV işaretçisi hiç çözülemiyorsa (vergi tablosu boş) UYARI ÜRETİR', () => {
    const s = sayacKur(8, ['KDV oranı']);
    expect(okumaArizalari(s, STOK_KRITIK)).toEqual(['KDV oranı']);
  });

  it('stok import: kategori/birim meşru olarak boş olabilir — arıza değildir', () => {
    const s = sayacKur(9, ['kategori', 'birim']);
    expect(okumaArizalari(s, STOK_KRITIK)).toEqual([]);
  });

  it('fiyat import: Retail kademesi hiç yoksa arıza DEĞİL; hiçbir fiyat yoksa arızadır', () => {
    expect(okumaArizalari(sayacKur(6, ['perakende fiyatı']), FIYAT_KRITIK)).toEqual([]);
    expect(okumaArizalari(sayacKur(6, ['satış fiyatı']), FIYAT_KRITIK)).toEqual(['satış fiyatı']);
  });

  it('stok-miktar rotası: miktar orada KRİTİKTİR (rotanın tek işi o); maliyet değildir', () => {
    expect(okumaArizalari(sayacKur(6, ['stok miktarı']), STOK_MIKTAR_KRITIK)).toEqual(['stok miktarı']);
    expect(okumaArizalari(sayacKur(6, ['maliyet bedeli']), STOK_MIKTAR_KRITIK)).toEqual([]);
  });

  it('per-depo: üç kolon da SQL\'in kendi seçtiği alanlar — hepsi kritiktir', () => {
    expect(okumaArizalari(sayacKur(6, ['depo bakiyesi']), DEPO_KRITIK)).toEqual(['depo bakiyesi']);
    expect(okumaArizalari(sayacKur(6, ['stok kodu', 'depo numarası']), DEPO_KRITIK))
      .toEqual(['stok kodu', 'depo numarası']);
  });

  it('GERÇEK stok satırından üretilen sayaç: miktarsız/fiyatsız kart uyarı üretmez', () => {
    // mikroClient notu: liste uçları yalnız KART verisi taşır (miktar/fiyat yok).
    const kart = { sto_kod: 'CMT-50', sto_isim: 'ÇİMENTO 50KG', sto_grup_isim: 'Çimento', sto_birim1_ad: 'TON', sto_perakende_vergi: 4 };
    const s = sayacOlustur();
    for (let i = 0; i < 6; i++) sayacaEkle(s, stokEsle({ ...kart, sto_kod: `CMT-${i}` }, null, { vergiTablosu: VERGI }).bilinmeyen);
    expect(okumaArizalari(s, STOK_KRITIK)).toEqual([]);
    expect(sayacNotu(s, [])).toContain('6 satırın stok miktarı bilinmiyor');
  });
});
