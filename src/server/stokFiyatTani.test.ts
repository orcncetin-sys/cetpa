import { describe, it, expect } from 'vitest';
import { kartFiyatDurumu, stokFiyatOzeti } from './stokFiyatTani';

describe('stokFiyatTani — satış fiyatı kapsaması (fiyat DÖNMEZ, yalnız sayım)', () => {
  const kartlar = [
    { sku: 'A', prices: { Retail: 120, Dealer: 0 }, price: 120, priceCurrency: 'TRY', vatRate: 20, stockLevel: 5, source: 'mikro_import', companyId: 'K' },
    { sku: 'B', prices: {}, stockLevel: 60, source: 'mikro_import', companyId: 'K' },                       // stokta, fiyat yok
    { sku: 'C', prices: { 'B2B Standard': 80 }, priceCurrency: 'USD', stockLevel: 0, vatRate: 0 },           // perakende yok, başka kademe var
    { sku: 'D', price: 0, prices: { Retail: 0 }, stockLevel: 3 },                                            // 0 = fiyat yok
    { sku: 'E', price: 45 },                                                                                 // yalnız tekil alan
    { sku: 'F', prices: 'bozuk', price: 'on', stockLevel: '7' },                                             // bozuk tipler sayılmaz
  ];
  it('kart sayımları: 0 / negatif / metin "fiyat yok"tur', () => {
    const o = stokFiyatOzeti(kartlar);
    expect(o.kart).toEqual({ toplam: 6, perakende: 1, herhangiKademe: 2, tekilFiyat: 2, fiyatsiz: 3, stoklu: 3, stokluFiyatsiz: 2, kdvBilinen: 2 });
  });
  it('kademe adları, para birimi ve kaynak dağılımı', () => {
    const o = stokFiyatOzeti(kartlar);
    expect(o.kademeler).toEqual({ Retail: { kart: 2, pozitif: 1 }, Dealer: { kart: 1, pozitif: 0 }, 'B2B Standard': { kart: 1, pozitif: 1 } });
    expect(o.paraBirimleri).toEqual({ TRY: 1, USD: 1, '(yok)': 4 });
    expect(o.kaynaklar).toEqual({ mikro_import: 2, '(yok)': 4 });
  });
  it('çıktıda hiçbir FİYAT DEĞERİ yok', () => {
    const metin = JSON.stringify([stokFiyatOzeti(kartlar), kartlar.map(kartFiyatDurumu)]);
    for (const fiyat of ['120', '80', '45']) expect(metin).not.toMatch(new RegExp(`[^0-9]${fiyat}[^0-9]`));
  });
  it('tek kart durumu: VAR / YOK', () => {
    expect(kartFiyatDurumu(kartlar[1])).toEqual({ perakende: false, herhangiKademe: false, tekilFiyat: false, fiyatli: false, paraBirimi: '(yok)', kdvBilinen: false, stoklu: true, kaynak: 'mikro_import', etiketli: true });
    expect(kartFiyatDurumu(kartlar[2])).toMatchObject({ perakende: false, herhangiKademe: true, fiyatli: true, paraBirimi: 'USD', kdvBilinen: true });
  });
});
