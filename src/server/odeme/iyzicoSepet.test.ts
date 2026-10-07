import { describe, it, expect } from 'vitest';
import { iyzicoSepeti, iyzicoTutarMetni } from './iyzicoSepet';

const TEK = (tutar: string) => [{ id: 's1', name: 'Sipariş', category1: 'B2B', itemType: 'PHYSICAL', price: tutar }];
const toplamKurus = (sepet: ReturnType<typeof iyzicoSepeti>) => sepet.reduce((s, b) => s + Math.round(Number(b.price) * 100), 0);

describe('iyzicoSepeti — Σ sepet = ödenecek tutar (iyzico kuralı)', () => {
  it('kalem kırılımı tutarı kuruşu kuruşuna TUTUYORSA gönderilir (faturasız sipariş: fiyat × miktar = toplam)', () => {
    const sepet = iyzicoSepeti('s1', 370, [{ name: 'A', price: 120, qty: 2 }, { name: 'B', price: 130 }]);
    expect(sepet).toEqual([
      { id: 'item-0', name: 'A', category1: 'B2B', itemType: 'PHYSICAL', price: '240.00' },
      { id: 'item-1', name: 'B', category1: 'B2B', itemType: 'PHYSICAL', price: '130.00' },
    ]);
  });
  it('FATURALI sipariş — kalem fiyatı KDV hariç, tutar KDV dâhil: kırılım tutmaz → TEK kalem = ödenecek tutar', () => {
    // Pencereden 250 × 12, %20: kalem price 250 (net), totalPrice 3.600.
    expect(iyzicoSepeti('s1', 3600, [{ name: 'HENKEL', price: 250, qty: 12 }])).toEqual(TEK('3600.00'));
    // KDV dâhil girilmiş: kalem price 208,333333 (net), totalPrice 3.000.
    expect(iyzicoSepeti('s1', 3000, [{ name: 'HENKEL', price: 208.333333, qty: 12 }])).toEqual(TEK('3000.00'));
  });
  it('her durumda Σ sepet = tutar (kuruş)', () => {
    const durumlar: Array<[number, Array<{ name: string; price: number; qty?: number }>]> = [
      [3600, [{ name: 'A', price: 250, qty: 12 }]], [370, [{ name: 'A', price: 120, qty: 2 }, { name: 'B', price: 130 }]],
      [49.98, [{ name: 'A', price: 19.99, qty: 2.5 }]], [0.3, [{ name: 'A', price: 0.1, qty: 3 }]], [100, []],
    ];
    for (const [tutar, kalemler] of durumlar) expect(toplamKurus(iyzicoSepeti('s1', tutar, kalemler)), String(tutar)).toBe(Math.round(tutar * 100));
  });
  it('fiyatı bilinmeyen / sıfır / adsız kalem ya da kalemsiz sipariş → tek kalem (0 tutarlı ya da uydurma satır gönderilmez)', () => {
    expect(iyzicoSepeti('s1', 100, [])).toEqual(TEK('100.00'));
    expect(iyzicoSepeti('s1', 100, null)).toEqual(TEK('100.00'));
    expect(iyzicoSepeti('s1', 100, undefined)).toEqual(TEK('100.00'));
    expect(iyzicoSepeti('s1', 100, [{ name: 'A', price: 100 }, { name: 'B', price: 0 }])).toEqual(TEK('100.00'));
    expect(iyzicoSepeti('s1', 100, [{ name: 'A', price: null, qty: 1 }])).toEqual(TEK('100.00'));       // Mikro türevi fiyatsız kalem
    expect(iyzicoSepeti('s1', 100, [{ name: 'A', price: NaN, qty: 1 }])).toEqual(TEK('100.00'));
    expect(iyzicoSepeti('s1', 100, [{ name: '', price: 100, qty: 1 }])).toEqual(TEK('100.00'));
    expect(iyzicoSepeti('s1', 100, [{ name: 'A', price: 50, qty: Number('x') }])).toEqual(TEK('100.00'));
  });
  it('sepet ve gövdenin `price` metni AYNI kuruş değerinden: yarım kuruşlu tutarda da Σ sepet = price', () => {
    for (const tutar of [1.115, 1.005, 437.675, 0.125, 3600, 49.98]) {
      for (const kalemler of [[{ name: 'A', price: tutar, qty: 1 }], []]) {
        expect(toplamKurus(iyzicoSepeti('s1', tutar, kalemler)), String(tutar)).toBe(Math.round(Number(iyzicoTutarMetni(tutar)) * 100));
      }
    }
    expect(iyzicoTutarMetni(1.115)).toBe('1.12');
    expect(iyzicoSepeti('s1', 437.68, [{ name: 'A', price: 175.07, qty: 2.5 }])).toEqual([{ id: 'item-0', name: 'A', category1: 'B2B', itemType: 'PHYSICAL', price: '437.68' }]);
  });
});
