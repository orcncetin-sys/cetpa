import { describe, it, expect } from 'vitest';
import type { InventoryItem, OrderLineItem } from '../../types';
import {
  musteriFiyatKademesi, urunSiparisFiyati, kalemSorunu, fiyatGirdisi, fiyatKademesiEtiketi, kopyaKalemi,
  siparisTutarlari, satirTutarlari, kalemBirimi, gorunenFiyat, kayitFiyati, kayitAlanlari, fiyatBirimiMi, oranDegisimi, kayitliTutarlar,
  type FiyatBirimi, type TaslakKalem,
} from './siparisKalemFiyati';
import { kurusaYuvarla } from '../para';

const kart = (ek: Record<string, unknown>): InventoryItem => ({ id: 'k', name: 'AKÇALI SPREY', sku: 'AKCALI-AKÇ.00325', stockLevel: 60, lowStockThreshold: 5, prices: {}, ...ek } as unknown as InventoryItem);
const KUR = { USD: 40, EUR: 45 };

describe('musteriFiyatKademesi', () => {
  it('müşterinin kademesi; yoksa / boşsa perakende', () => {
    expect(musteriFiyatKademesi({ priceTier: 'Dealer' })).toBe('Dealer');
    for (const m of [null, undefined, {}, { priceTier: '' }, { priceTier: '  ' }, { priceTier: 5 }]) expect(musteriFiyatKademesi(m)).toBe('Retail');
  });
});

describe('urunSiparisFiyati — kademe → düz fiyat → kur; bilinmeyen 0 DEĞİLDİR', () => {
  it('müşterinin kademesi ÖNCE; kademe yoksa kartın düz fiyatı', () => {
    const k = kart({ prices: { Retail: 120, Dealer: 95 }, price: 120 });
    expect(urunSiparisFiyati(k, 'Dealer', KUR)).toEqual({ fiyat: 95, neden: null });
    expect(urunSiparisFiyati(k, 'Retail', KUR)).toEqual({ fiyat: 120, neden: null });
    expect(urunSiparisFiyati(k, 'B2B Premium', KUR)).toEqual({ fiyat: 120, neden: null });
    // Eski pencere `price`'ı öne alıyordu: bayi müşteriye perakende fiyat yazılıyordu.
    expect(urunSiparisFiyati(kart({ prices: { Dealer: 95 }, price: 120 }), 'Dealer', KUR).fiyat).toBe(95);
  });
  it('dövizli kart güncel kurla TL\'ye çevrilir; kur yoksa fiyat BİLİNMİYOR (döviz tutarı TL gibi yazılmaz)', () => {
    const k = kart({ prices: { Retail: 12.5 }, priceCurrency: 'USD' });
    expect(urunSiparisFiyati(k, 'Retail', KUR)).toEqual({ fiyat: 500, neden: null });
    expect(urunSiparisFiyati(k, 'Retail', {})).toEqual({ fiyat: null, neden: 'kurYok' });
    expect(urunSiparisFiyati(k, 'Retail', null)).toEqual({ fiyat: null, neden: 'kurYok' });
    expect(urunSiparisFiyati(kart({ price: 10, priceCurrency: 'GBP' }), 'Retail', KUR)).toEqual({ fiyat: null, neden: 'kurYok' });
  });
  it('fiyat alanı yok / 0 / negatif / metin → "yok" (ekrandaki "$0.00" vakası)', () => {
    for (const ek of [{}, { prices: {} }, { price: 0 }, { prices: { Retail: 0 }, price: 0 }, { price: -5 }, { price: '120' }, { prices: { Retail: null } }]) {
      expect(urunSiparisFiyati(kart(ek), 'Retail', KUR), JSON.stringify(ek)).toEqual({ fiyat: null, neden: 'yok' });
    }
  });
  it('kuruşa yuvarlanır', () => {
    expect(urunSiparisFiyati(kart({ price: 3.333, priceCurrency: 'USD' }), 'Retail', { USD: 41.27 }).fiyat).toBe(137.55);
  });
});

describe('kalem denetimi ve toplam', () => {
  it('boş sipariş, fiyatı girilmemiş / 0 / geçersiz kalem ve pozitif olmayan miktar kaydı engeller', () => {
    expect(kalemSorunu([])).toBe('kalemYok');
    expect(kalemSorunu([{ id: 'a', price: null, quantity: 1 }])).toBe('fiyatEksik');
    expect(kalemSorunu([{ id: 'a', price: 0, quantity: 1 }])).toBe('fiyatEksik');
    expect(kalemSorunu([{ id: 'a', price: NaN, quantity: 1 }])).toBe('fiyatEksik');
    expect(kalemSorunu([{ id: 'a', price: 10, quantity: 0 }])).toBe('miktarGecersiz');
    expect(kalemSorunu([{ id: 'a', price: 10, quantity: NaN }])).toBe('miktarGecersiz');
    expect(kalemSorunu([{ id: 'a', price: 10, quantity: 2.5 }, { id: 'b', price: 0.5, quantity: 1 }])).toBeNull();
  });
  it('fiyat girdisi: boş / geçersiz / negatif → null; virgül ondalık', () => {
    expect(fiyatGirdisi('12,5')).toBe(12.5);
    expect(fiyatGirdisi(' 100 ')).toBe(100);
    expect(fiyatGirdisi('0')).toBe(0);
    for (const h of ['', '  ', 'abc', '-3', '1.2.3']) expect(fiyatGirdisi(h)).toBeNull();
  });
  it('Türkçe binlik yazım: virgül varken nokta binlik ayraçtır', () => {
    expect(fiyatGirdisi('1.250,50')).toBe(1250.5);
    expect(fiyatGirdisi('12.345.678,9')).toBe(12345678.9);
    expect(fiyatGirdisi('1250,')).toBe(1250);                   // yazım sürerken
    expect(fiyatGirdisi('12.5')).toBe(12.5);
    expect(fiyatGirdisi('0.125')).toBe(0.125);
    for (const h of ['1.25,5', '1,2,3', '12.3456,7', ',']) expect(fiyatGirdisi(h)).toBeNull();
  });
  it('BELİRSİZ "1.250" (bin iki yüz elli mi, 1,25 mi) fiyat sayılmaz — sessizce bin kat ucuza yazılmaz', () => {
    for (const h of ['1.250', '12.500', '1.250.000']) expect(fiyatGirdisi(h)).toBeNull();
  });
  it('yalnız düz ondalık yazım: Number()\'ın kabul ettiği üstel / onaltılık / Infinity fiyat değildir', () => {
    for (const h of ['1e3', '0x10', 'Infinity', '+5', '1_000', '0b11']) expect(fiyatGirdisi(h)).toBeNull();
  });
});

describe('fiyatKademesiEtiketi', () => {
  it('bilinen kademe Türkçe etiketle; bilinmeyen kademe adı olduğu gibi; İngilizcede ad', () => {
    expect(fiyatKademesiEtiketi('Retail', true)).toBe('Perakende');
    expect(fiyatKademesiEtiketi('Dealer', true)).toBe('Bayi');
    expect(fiyatKademesiEtiketi('B2B Standard', true)).toBe('B2B Standart');
    expect(fiyatKademesiEtiketi('Özel Liste', true)).toBe('Özel Liste');
    expect(fiyatKademesiEtiketi('Dealer', false)).toBe('Dealer');
  });
});

describe('KDV birimi — çapa, sipariş tutarları, kayıt fiyatı (kullanıcı 2026-10-03: «hesap hatası var»)', () => {
  const k = (price: number | null, quantity: number, fiyatBirimi?: FiyatBirimi): TaslakKalem => ({ id: 'a', price, quantity, ...(fiyatBirimi ? { fiyatBirimi } : {}) });

  it('KULLANICININ ÖRNEĞİ — 250 × 12, %20: KDV HARİÇ girişte 3.000 + 600 = 3.600; KDV DÂHİL girişte 2.500 + 500 = 3.000', () => {
    expect(siparisTutarlari([k(250, 12)], 20)).toEqual({ matrah: 3000, kdv: 600, toplam: 3600 });
    expect(siparisTutarlari([k(250, 12, 'kdvHaric')], 20)).toEqual({ matrah: 3000, kdv: 600, toplam: 3600 });
    expect(siparisTutarlari([k(250, 12, 'kdvDahil')], 20)).toEqual({ matrah: 2500, kdv: 500, toplam: 3000 });
  });
  it('çapa birimi yoksa KDV HARİÇ sayılır (stok kartı, teklif, Mikro gövdesi ve raporlarla aynı anlam)', () => {
    expect(siparisTutarlari([k(100, 1)], 20)).toEqual(siparisTutarlari([k(100, 1, 'kdvHaric')], 20));
  });
  it('matrah + KDV = toplam — karışık çapa, kesirli miktar ve her oranda (KDV kalan olarak hesaplanır)', () => {
    const kalemler = [k(19.99, 2.5), k(100, 3, 'kdvDahil'), k(0.1, 3), k(33.33, 7, 'kdvDahil')];
    for (const oran of [0, 1, 8, 10, 18, 20]) {
      const t = siparisTutarlari(kalemler, oran);
      expect(t, String(oran)).not.toBeNull();
      if (!t) continue;
      expect(kurusaYuvarla(t.matrah + t.kdv), String(oran)).toBe(t.toplam);
      expect(t.kdv, String(oran)).toBeGreaterThanOrEqual(0);
    }
  });
  it('faturasız (oran 0): KDV yok — matrah = toplam, iki çapa aynı tutarı verir', () => {
    expect(siparisTutarlari([k(87.5, 1)], 0)).toEqual({ matrah: 87.5, kdv: 0, toplam: 87.5 });
    expect(siparisTutarlari([k(87.5, 1, 'kdvDahil')], 0)).toEqual({ matrah: 87.5, kdv: 0, toplam: 87.5 });
  });
  it('fiyatı eksik kalem varken tutarlar BİLİNMİYOR (0 sayılıp toplanmaz); geçersiz oran → null; boş liste → sıfır', () => {
    expect(siparisTutarlari([k(10, 2), k(null, 1)], 20)).toBeNull();
    expect(siparisTutarlari([k(10, 2)], NaN)).toBeNull();
    expect(siparisTutarlari([k(10, 2)], -5)).toBeNull();
    expect(siparisTutarlari([k(10, NaN)], 20)).toBeNull();
    expect(siparisTutarlari([], 20)).toEqual({ matrah: 0, kdv: 0, toplam: 0 });
  });
  it('kuruş: satır tutarı ÇAPA biriminde yuvarlanır (19,99 × 2,5 = 49,98 — kayan nokta artığı yarım kuruşu aşağı çekmez)', () => {
    expect(siparisTutarlari([k(19.99, 2.5)], 0)).toEqual({ matrah: 49.98, kdv: 0, toplam: 49.98 });
    expect(siparisTutarlari([k(0.1, 3)], 0)?.toplam).toBe(0.3);
    expect(satirTutarlari(k(19.99, 2.5, 'kdvDahil'), 20)?.dahil).toBe(49.98);
  });
  it('KDV ORANI DEĞİŞİNCE: KDV dâhil çapada TOPLAM, KDV hariç çapada MATRAH sabit kalır', () => {
    expect(siparisTutarlari([k(300, 12, 'kdvDahil')], 20)).toEqual({ matrah: 3000, kdv: 600, toplam: 3600 });
    expect(siparisTutarlari([k(300, 12, 'kdvDahil')], 10)).toEqual({ matrah: 3272.73, kdv: 327.27, toplam: 3600 });
    expect(siparisTutarlari([k(250, 12)], 10)).toEqual({ matrah: 3000, kdv: 300, toplam: 3300 });
  });
  it('kalemBirimi / gorunenFiyat: çapa birimindeyse yazıldığı gibi; çevrilince kuruşa yuvarlı', () => {
    expect(kalemBirimi(k(250, 1), 'kdvHaric', 20)).toBe(250);
    expect(kalemBirimi(k(250, 1), 'kdvDahil', 20)).toBe(300);
    expect(gorunenFiyat(k(250, 1), 'kdvDahil', 20)).toBe(300);
    expect(gorunenFiyat(k(100, 1, 'kdvDahil'), 'kdvHaric', 20)).toBe(83.33);
    expect(gorunenFiyat(k(100, 1, 'kdvDahil'), 'kdvDahil', 20)).toBe(100);
    expect(gorunenFiyat(k(33.333333, 1), 'kdvHaric', 20)).toBe(33.333333);   // çapadaki değer yuvarlanmaz
    expect(gorunenFiyat(k(null, 1), 'kdvDahil', 20)).toBeNull();
    expect(gorunenFiyat(k(100, 1), 'kdvDahil', NaN)).toBeNull();
    expect(gorunenFiyat(k(100, 1), 'kdvHaric', NaN)).toBe(100);              // çapa birimi için oran gerekmez
  });
  it('kayitFiyati: KAYITTA fiyat hep KDV HARİÇ — hariç girilen AYNEN, dâhil girilen 6 ondalık net (Mikro çarpımı Cetpa matrahını tutar)', () => {
    expect(kayitFiyati(k(250, 12), 20)).toBe(250);
    const net = kayitFiyati(k(100, 12, 'kdvDahil'), 20);
    expect(net).toBe(83.333333);
    // Mikro gövdesi `sip_tutar = kuruş(fiyat × miktar)` yazar — pencerenin matrahıyla AYNI olmalı (kuruşa yuvarlı 83,33 → 999,96 olurdu).
    expect(kurusaYuvarla(net * 12)).toBe(siparisTutarlari([k(100, 12, 'kdvDahil')], 20)?.matrah);
    expect(kayitFiyati(k(250, 12, 'kdvDahil'), 20)).toBe(208.333333);
    expect(kayitFiyati(k(87.5, 1, 'kdvDahil'), 0)).toBe(87.5);               // faturasız: çevrim yok
    expect(() => kayitFiyati(k(null, 1), 20)).toThrow();
    expect(() => kayitFiyati(k(100, 1, 'kdvDahil'), NaN)).toThrow();
  });
  it('DEĞİŞMEZ — matrah = Σ kuruş(kayıt fiyatı × miktar): kayda / Mikro\'ya giden kalemlerden yeniden hesaplanan matrahla AYNI', () => {
    const kumeler: TaslakKalem[][] = [
      [k(100, 1, 'kdvDahil'), k(100, 1, 'kdvDahil'), k(100, 1, 'kdvDahil')],     // eskiden 250,00'e karşı 3 × 83,33 = 249,99
      [k(50, 1, 'kdvDahil'), k(50, 1, 'kdvDahil')],                              // eskiden 83,33'e karşı 2 × 41,67 = 83,34
      [k(33.33, 7, 'kdvDahil'), k(0.99, 1000, 'kdvDahil'), k(19.99, 2.5, 'kdvDahil')],
      [k(250, 12), k(100, 3, 'kdvDahil'), k(0.1, 3), k(19.99, 2.5)],
      [k(0.13, 50000, 'kdvDahil'), k(0.45, 100000, 'kdvDahil')],                  // 6 ondalık net × büyük miktar
    ];
    for (const kalemler of kumeler) for (const oran of [0, 1, 8, 10, 18, 20]) {
      const t = siparisTutarlari(kalemler, oran);
      const kayittan = kurusaYuvarla(kalemler.reduce((s, x) => s + kurusaYuvarla(kayitFiyati(x, oran) * x.quantity), 0));
      expect(t?.matrah, `${JSON.stringify(kalemler)} %${oran}`).toBe(kayittan);
    }
  });
  it('KDV HARİÇ çapa: satır KDV\'si fatura gövdesinin kendi hesabıyla AYNI (`sth_vergi = round(sth_tutar × oran) / 100`)', () => {
    const faturaKdv = (tutar: number, oran: number) => Math.round(tutar * oran) / 100;      // govdeFaturaIrsaliye.ts
    for (const oran of [1, 8, 10, 18, 20]) for (let kurus = 1; kurus <= 30000; kurus += 7) for (const miktar of [1, 2.5, 12]) {
      const t = satirTutarlari(k(kurus / 100, miktar), oran);
      if (!t || t.kdv !== faturaKdv(t.haric, oran) || kurusaYuvarla(t.haric + t.kdv) !== t.dahil) {
        throw new Error(`${kurus / 100} × ${miktar} %${oran}: ${JSON.stringify(t)} ≠ fatura KDV ${t && faturaKdv(t.haric, oran)}`);
      }
    }
  });
  it('KDV DÂHİL çapa — YAZILAN TOPLAM KORUNUR (kullanıcı kararı 2026-10-07): 50,01 × 1 = 50,01; KDV iç yüzdeyle (toplam − matrah)', () => {
    // «KDV = matrah × oran» 41,68 → 8,34 → 50,02 verirdi; hiçbir matrah tam 50,01 etmez. Yazılan tutar korunur: 41,68 + 8,33.
    expect(satirTutarlari(k(50.01, 1, 'kdvDahil'), 20)).toEqual({ haric: 41.68, kdv: 8.33, dahil: 50.01 });
    expect(satirTutarlari(k(99.99, 1, 'kdvDahil'), 20)).toEqual({ haric: 83.33, kdv: 16.66, dahil: 99.99 });
    expect(satirTutarlari(k(100.03, 3, 'kdvDahil'), 20)).toEqual({ haric: 250.07, kdv: 50.02, dahil: 300.09 });
    expect(siparisTutarlari([k(100.03, 3, 'kdvDahil'), k(50.01, 1, 'kdvDahil')], 20)).toEqual({ matrah: 291.75, kdv: 58.35, toplam: 350.1 });
  });
  it('KDV DÂHİL çapa: dâhil tutar HER ZAMAN kuruş(yazılan × miktar); haric + kdv = dâhil; KDV, matrah × orandan yalnız yuvarlama kadar sapar', () => {
    for (const oran of [1, 8, 10, 18, 20]) for (let kurus = 1; kurus <= 30000; kurus += 7) for (const miktar of [1, 2.5, 12, 1000]) {
      const kalem = k(kurus / 100, miktar, 'kdvDahil');
      const t = satirTutarlari(kalem, oran);
      const sinir = 0.01 + (1 + oran / 100) * (0.005 + 5e-7 * miktar);                       // satirKdvTutari (fatura gövdesi) ile AYNI sınır
      if (!t || t.dahil !== kurusaYuvarla((kurus / 100) * miktar) || kurusaYuvarla(t.haric + t.kdv) !== t.dahil || t.kdv < 0
        || Math.abs(t.kdv - Math.round(t.haric * oran) / 100) > sinir + 1e-9) {
        throw new Error(`${kurus / 100} × ${miktar} %${oran}: ${JSON.stringify(t)}`);
      }
    }
  });
  it('matrah KAYDA GİDEN (6 ondalık) net birimden hesaplanır — yuvarlanmamış netten değil (Mikro `sip_b_fiyat` × miktar ile aynı)', () => {
    // 0,13 dâhil, %20: tam net 0,108333… × 50.000 = 5.416,67 olurdu; kayda giden 0,108333 × 50.000 = 5.416,65.
    expect(kayitFiyati(k(0.13, 50000, 'kdvDahil'), 20)).toBe(0.108333);
    expect(satirTutarlari(k(0.13, 50000, 'kdvDahil'), 20)).toEqual({ haric: 5416.65, kdv: 1083.35, dahil: 6500 });   // yazılan toplam korunur
  });
  it('çok kalemli KDV DÂHİL: matrah ve KDV satır satır kuruşa yuvarlanır (Mikro satır toplamıyla aynı)', () => {
    expect(siparisTutarlari([k(100, 1, 'kdvDahil'), k(100, 1, 'kdvDahil'), k(100, 1, 'kdvDahil')], 20)).toEqual({ matrah: 249.99, kdv: 50.01, toplam: 300 });
    expect(siparisTutarlari([k(50, 1, 'kdvDahil'), k(50, 1, 'kdvDahil')], 20)).toEqual({ matrah: 83.34, kdv: 16.66, toplam: 100 });
  });
  it('KDV HARİÇ: satır KDV\'si satır satır kuruşa yuvarlanır (fatura gövdesindeki `sth_vergi` ile aynı hesap)', () => {
    expect(satirTutarlari(k(0.33, 1), 20)).toEqual({ haric: 0.33, kdv: 0.07, dahil: 0.4 });
    expect(siparisTutarlari([k(0.33, 1), k(0.33, 1), k(0.33, 1)], 20)).toEqual({ matrah: 0.99, kdv: 0.21, toplam: 1.2 });
    expect(satirTutarlari(k(250, 12), 20)).toEqual({ haric: 3000, kdv: 600, dahil: 3600 });
    expect(satirTutarlari(k(250, 12, 'kdvDahil'), 20)).toEqual({ haric: 2500, kdv: 500, dahil: 3000 });
  });
  it('oran 0 (faturasız / istisna): iki birim AYNI sayıdır — çevrim de yuvarlama da yok', () => {
    expect(kayitFiyati(k(12.3456789, 1, 'kdvDahil'), 0)).toBe(12.3456789);
    expect(gorunenFiyat(k(33.333333, 1, 'kdvDahil'), 'kdvHaric', 0)).toBe(33.333333);
    expect(gorunenFiyat(k(33.333333, 1), 'kdvDahil', 0)).toBe(33.333333);
    expect(satirTutarlari(k(33.333333, 3, 'kdvDahil'), 0)).toEqual({ haric: 100, kdv: 0, dahil: 100 });
    expect(siparisTutarlari([k(12.3456789, 1000, 'kdvDahil')], 0)).toEqual({ matrah: 12345.68, kdv: 0, toplam: 12345.68 });
    // 6 ondalıktan ince fiyat + büyük miktar: çevrim yapılsaydı matrah 100.000,00, toplam 100.000,04 → faturasız siparişte 4 kuruş "KDV".
    expect(siparisTutarlari([k(1.0000004, 100000, 'kdvDahil')], 0)).toEqual({ matrah: 100000.04, kdv: 0, toplam: 100000.04 });
  });
  it('kayitAlanlari — faturalı siparişin kalemine yazılanlar: net birim, çapa, (dâhilde) yazılan birim, satır matrahı ve satır KDV\'si', () => {
    expect(kayitAlanlari(k(250, 12), 20)).toEqual({ price: 250, fiyatBirimi: 'kdvHaric', netTutar: 3000, kdv: 600 });
    expect(kayitAlanlari(k(250, 12, 'kdvDahil'), 20)).toEqual({ price: 208.333333, fiyatBirimi: 'kdvDahil', dahilFiyat: 250, netTutar: 2500, kdv: 500 });
    expect(kayitAlanlari(k(50.01, 1, 'kdvDahil'), 20)).toEqual({ price: 41.675, fiyatBirimi: 'kdvDahil', dahilFiyat: 50.01, netTutar: 41.68, kdv: 8.33 });
    expect(kayitAlanlari(k(100, 1), 0)).toEqual({ price: 100, fiyatBirimi: 'kdvHaric', netTutar: 100, kdv: 0 });
    expect(() => kayitAlanlari(k(null, 1), 20)).toThrow();
    expect(() => kayitAlanlari(k(100, 1), NaN)).toThrow();
  });
  it('fiyatBirimiMi yalnız iki değeri tanır', () => {
    expect(fiyatBirimiMi('kdvHaric')).toBe(true); expect(fiyatBirimiMi('kdvDahil')).toBe(true);
    for (const x of [undefined, null, '', 'dahil', 1]) expect(fiyatBirimiMi(x)).toBe(false);
  });
});

describe('kopyaKalemi — "Siparişi kopyala"', () => {
  const kalem = (ek: Record<string, unknown>): OrderLineItem => ({ id: 'k', sku: 'S1', name: 'A', quantity: 4, ...ek } as unknown as OrderLineItem);
  /** Mikro faturasından türeyen sürüm-2 kalemin GERÇEK şekli (eslemeFatura.mfKalemleri): `id` ve `title` YOK. */
  const MF2 = (ek: Record<string, unknown> = {}): OrderLineItem => ({
    sku: 'S1', name: 'A', quantity: 4, price: 100, birim: null, brutTutar: 400, iskonto: 0, netTutar: 400, kdv: 80, masraf: 0,
    netKaynagi: 'satir', kdvUyumsuz: false, ciftIskontoBelirsiz: false, total: 480, kalemSurumu: 2, ...ek,
  } as unknown as OrderLineItem);

  it('elle açılmış sipariş kalemi: fiyat olduğu gibi, KDV HARİÇ çapayla; kimlik YENİ', () => {
    const k = kopyaKalemi(kalem({ price: 120, title: 'A', vatRate: 20, inventoryId: 'i1' }));
    expect(k).toEqual({ id: expect.any(String), sku: 'S1', name: 'A', title: 'A', quantity: 4, vatRate: 20, inventoryId: 'i1', price: 120, fiyatBirimi: 'kdvHaric' });
    expect(k.id).not.toBe('k');
  });
  it('sürüm-2 Mikro kalemi (gerçek şekil): `price` KDV hariç net birimdir; türetilmiş alanlar ve tanı bayrakları taşınmaz; ad `name`\'den', () => {
    expect(kopyaKalemi(MF2())).toEqual({ id: expect.any(String), sku: 'S1', name: 'A', title: 'A', quantity: 4, price: 100, fiyatBirimi: 'kdvHaric' });
  });
  it('çok kalemli Mikro siparişinin kopyasında her kalemin kimliği BENZERSİZ (kaynakta `id` yok — ham girdiler satırlar arasında karışırdı)', () => {
    const kopya = [MF2(), MF2({ sku: 'S2', name: 'B' }), MF2({ sku: 'S3', name: 'C' })].map(kopyaKalemi);
    expect(new Set(kopya.map(k => k.id)).size).toBe(3);
    for (const k of kopya) { expect(typeof k.id).toBe('string'); expect(k.id.length).toBeGreaterThan(8); expect(k.title).toBe(k.name); }
  });
  it('`price` yoksa `netTutar ÷ miktar` (KDV hariç); o da yoksa `total ÷ miktar` — KDV DÂHİL çapayla', () => {
    expect(kopyaKalemi(MF2({ price: null }))).toMatchObject({ price: 100, fiyatBirimi: 'kdvHaric' });
    expect(kopyaKalemi(MF2({ price: null, netTutar: null }))).toMatchObject({ price: 120, fiyatBirimi: 'kdvDahil' });
    expect(kopyaKalemi(kalem({ total: 480 }))).toMatchObject({ price: 120, fiyatBirimi: 'kdvDahil' });    // eski Mikro kalemi
  });
  it('bölümden gelen birim 6 ondalıkta tutulur (kuruşa yuvarlansa 100 ÷ 3 = 33,33 × 3 = 99,99 olurdu)', () => {
    const k = kopyaKalemi(kalem({ total: 100, quantity: 3 }));
    expect(k.price).toBe(33.333333);
    expect(siparisTutarlari([{ ...k, quantity: 3 }], 20)?.toplam).toBe(100);
  });
  it('pencereden açılmış kalem KENDİ çapasıyla açılır: KDV dâhil girilmişse YAZILAN birim (kopya dokunulmadan kaynakla aynı tutarı yazar)', () => {
    const dahil = kalem({ price: 41.675, fiyatBirimi: 'kdvDahil', dahilFiyat: 50.01, netTutar: 41.68, kdv: 8.33, vatRate: 20, quantity: 1 });
    const kopya = kopyaKalemi(dahil);
    expect(kopya).toEqual({ id: expect.any(String), sku: 'S1', name: 'A', title: 'A', quantity: 1, vatRate: 20, price: 50.01, fiyatBirimi: 'kdvDahil' });
    expect(siparisTutarlari([kopya], 20)).toEqual({ matrah: 41.68, kdv: 8.33, toplam: 50.01 });
    // KDV hariç girilmiş kalem net birimiyle; kaynak siparişin satır tutarları taşınmaz.
    expect(kopyaKalemi(kalem({ price: 250, fiyatBirimi: 'kdvHaric', netTutar: 3000, kdv: 600, quantity: 12 })))
      .toEqual({ id: expect.any(String), sku: 'S1', name: 'A', title: 'A', quantity: 12, price: 250, fiyatBirimi: 'kdvHaric' });
    // Çapa 'kdvDahil' ama yazılan birim yoksa (bozuk kayıt) net birime düşer — uydurma dâhil fiyat yok.
    expect(kopyaKalemi(kalem({ price: 41.675, fiyatBirimi: 'kdvDahil' }))).toMatchObject({ price: 41.675, fiyatBirimi: 'kdvHaric' });
    // Yazılan birim 0 / negatifse de (bozuk kayıt) net birime düşer.
    for (const dahilFiyat of [0, -5]) expect(kopyaKalemi(kalem({ price: 41.675, fiyatBirimi: 'kdvDahil', dahilFiyat })), String(dahilFiyat)).toMatchObject({ price: 41.675, fiyatBirimi: 'kdvHaric' });
  });
  it('fiyat çözülemiyorsa BİLİNMİYOR (null): miktar 0, hiç tutar yok, fiyat 0', () => {
    expect(kopyaKalemi(kalem({ total: 480, quantity: 0 })).price).toBeNull();
    expect(kopyaKalemi(kalem({})).price).toBeNull();
    expect(kopyaKalemi(kalem({ price: 0 })).price).toBeNull();
    expect(kopyaKalemi(MF2({ price: null, netTutar: null, total: null })).price).toBeNull();
  });
});

describe('oranDegisimi — KAYITLI siparişin KDV oranı değişince: pencerenin kuralı, her kalem KENDİ çapasıyla (düzenleme formu)', () => {
  const kalem = (ek: Record<string, unknown>): OrderLineItem => ({ id: 'k1', sku: 'S1', name: 'A', quantity: 12, price: 250, vatRate: 20, fiyatBirimi: 'kdvHaric', netTutar: 3000, kdv: 600, ...ek } as unknown as OrderLineItem);
  const DAHIL = { price: 208.333333, fiyatBirimi: 'kdvDahil', dahilFiyat: 250, netTutar: 2500, kdv: 500 };

  it('KDV HARİÇ çapa → MATRAH sabit: 250 × 12, %20 → %10 = 3.000 + 300 = 3.300; fiyat değişmez, satır tutarları ve kalem oranı yeni', () => {
    const d = oranDegisimi([kalem({})], 10);
    expect(d?.tutarlar).toEqual({ matrah: 3000, kdv: 300, toplam: 3300 });
    expect(d?.kalemler).toEqual([kalem({ vatRate: 10, kdv: 300 })]);
  });
  it('KDV DÂHİL çapa → TOPLAM sabit: 250 dâhil × 12 = 3.000; %20 → %10: net birim yazılan birimden yeniden türetilir', () => {
    const d = oranDegisimi([kalem(DAHIL)], 10);
    expect(d?.tutarlar).toEqual({ matrah: 2727.27, kdv: 272.73, toplam: 3000 });
    expect(d?.kalemler).toEqual([kalem({ ...DAHIL, price: 227.272727, netTutar: 2727.27, kdv: 272.73, vatRate: 10 })]);
    // Geri dönüş kuruşu kuruşuna (yazılan birim kayıtlı — 6 ondalıklı netten geri hesap yok).
    expect(oranDegisimi(d?.kalemler ?? [], 20)).toEqual({ tutarlar: { matrah: 2500, kdv: 500, toplam: 3000 }, kalemler: [kalem(DAHIL)] });
  });
  it('yazılan toplam kesirli miktarda ve her oranda korunur (eski yol 131,73 × 2,5\'ta 1 kuruş oynatıyordu)', () => {
    const ilk = kalem({ quantity: 2.5, price: 119.754545, fiyatBirimi: 'kdvDahil', dahilFiyat: 131.73, netTutar: 299.39, kdv: 29.94, vatRate: 10 });
    for (const oran of [0, 1, 8, 10, 18, 20]) expect(oranDegisimi([ilk], oran)?.tutarlar.toplam, String(oran)).toBe(329.33);
  });
  it('karışık çapa: her kalem kendi kuralıyla; yazılan tutarlar kalemlere yazılan satır tutarlarının toplamı', () => {
    const d = oranDegisimi([kalem({}), kalem({ id: 'k2', ...DAHIL })], 10);
    expect(d?.tutarlar).toEqual({ matrah: 5727.27, kdv: 572.73, toplam: 6300 });
    expect(kayitliTutarlar(d?.kalemler ?? [])).toEqual(d?.tutarlar);
  });
  it('çapası olmayan (eski / başka kaynaklı) kalemde `price` KDV hariç net birim sayılır', () => {
    const d = oranDegisimi([{ id: 'k1', sku: 'S1', name: 'A', quantity: 12, price: 250 } as OrderLineItem], 10);
    expect(d?.tutarlar).toEqual({ matrah: 3000, kdv: 300, toplam: 3300 });
    expect(d?.kalemler[0]).toEqual({ id: 'k1', sku: 'S1', name: 'A', quantity: 12, price: 250, fiyatBirimi: 'kdvHaric', netTutar: 3000, kdv: 300, vatRate: 10 });
  });
  it('çapaya ait olmayan bayat `dahilFiyat` kalemde kalmaz (KDV hariç çapalı kalemde yazılan dâhil birim olmaz)', () => {
    const d = oranDegisimi([kalem({ dahilFiyat: 999 })], 10);
    expect(d?.kalemler[0]).not.toHaveProperty('dahilFiyat');
    expect(d?.kalemler).toEqual([kalem({ vatRate: 10, kdv: 300 })]);
  });
  it("çapa 'kdvDahil' ama yazılan birim 0 / negatifse (bozuk kayıt) net birimle hesaplanır — toplam 0'a ya da eksiye düşmez", () => {
    for (const dahilFiyat of [0, -5]) {
      const d = oranDegisimi([kalem({ quantity: 1, price: 41.675, fiyatBirimi: 'kdvDahil', dahilFiyat, netTutar: 41.68, kdv: 8.33 })], 10);
      expect(d?.tutarlar, String(dahilFiyat)).toEqual({ matrah: 41.68, kdv: 4.17, toplam: 45.85 });
      expect(d?.kalemler[0]).toMatchObject({ price: 41.675, fiyatBirimi: 'kdvHaric', netTutar: 41.68, kdv: 4.17, vatRate: 10 });
      expect(d?.kalemler[0]).not.toHaveProperty('dahilFiyat');
    }
  });
  it('kayitliTutarlar: kalemlere YAZILMIŞ satır tutarlarının toplamı; bir kalemde eksikse null', () => {
    expect(kayitliTutarlar([kalem({})])).toEqual({ matrah: 3000, kdv: 600, toplam: 3600 });
    expect(kayitliTutarlar([kalem({ price: 41.675, quantity: 1, netTutar: 41.68, kdv: 8.33 }), kalem({ id: 'k2', netTutar: 250.07, kdv: 50.02 })])).toEqual({ matrah: 291.75, kdv: 58.35, toplam: 350.1 });
    expect(kayitliTutarlar([])).toBeNull();
    expect(kayitliTutarlar([kalem({}), kalem({ kdv: null })])).toBeNull();
    expect(kayitliTutarlar([kalem({ netTutar: undefined })])).toBeNull();
  });
  it('kalemsiz, fiyatı / miktarı bilinmeyen ya da pozitif olmayan kalem, geçersiz oran → null (çağıran başlık yoluna düşer)', () => {
    expect(oranDegisimi([], 10)).toBeNull();
    for (const ek of [{ price: null }, { price: undefined }, { price: 0 }, { price: NaN }, { quantity: 0 }, { quantity: null }]) {
      expect(oranDegisimi([kalem({}), kalem(ek)], 10), JSON.stringify(ek)).toBeNull();
    }
    expect(oranDegisimi([kalem({})], NaN)).toBeNull();
    expect(oranDegisimi([kalem({})], -1)).toBeNull();
  });
  it('%0\'a çekmek (istisna / ihracat): KDV 0, matrah = toplam; dâhil çapada net birim = yazılan birim', () => {
    expect(oranDegisimi([kalem({})], 0)).toEqual({ tutarlar: { matrah: 3000, kdv: 0, toplam: 3000 }, kalemler: [kalem({ vatRate: 0, kdv: 0 })] });
    expect(oranDegisimi([kalem(DAHIL)], 0)).toEqual({ tutarlar: { matrah: 3000, kdv: 0, toplam: 3000 }, kalemler: [kalem({ ...DAHIL, price: 250, netTutar: 3000, kdv: 0, vatRate: 0 })] });
  });
});
