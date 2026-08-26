/**
 * cost.test.ts — döviz maliyetinin kur yokken NE YAPMADIĞINI sabitler.
 *
 * Kullanıcı kararı (2026-08-26): kur yoksa UYDURMA, "kur bulunamadı" de ve kur
 * gelince kendiliğinden düzelsin; para biriminin türü bilinmiyorsa TL toplamına
 * karıştırma, ayrı N/A olarak göster.
 *
 * Eski hâli `raw * (rates[cur] ?? 1)` idi: $100 maliyet kur yokken ₺100
 * sayılıyordu — maliyet ~40 kat düşük, marj şişkin.
 */
import { describe, it, expect } from 'vitest';
import { itemCostTRY, itemPriceTRY, maliyetDurumu, cevrilemeyenler, cevrilemeyenMesaji } from './cost';
import type { InventoryItem } from '../types';

const urun = (o: Partial<InventoryItem>) => ({ id: 'x', name: 'X', sku: 'S', ...o }) as InventoryItem;
const KURLAR = { USD: 40, EUR: 44 };

describe('itemCostTRY', () => {
  it('TL maliyet aynen döner (kur hiç gerekmez)', () => {
    expect(itemCostTRY(urun({ costPrice: 100 }), KURLAR)).toBe(100);              // etiketsiz = TL
    expect(itemCostTRY(urun({ costPrice: 100, costCurrency: 'TRY' }), null)).toBe(100);
  });

  it('kur varsa doğru çevirir', () => {
    expect(itemCostTRY(urun({ costPrice: 100, costCurrency: 'USD' }), KURLAR)).toBe(4000);
    expect(itemCostTRY(urun({ costPrice: 100, costCurrency: 'EUR' }), KURLAR)).toBe(4400);
  });

  it('KUR YOKSA 0 döner — 1:1 saymaz', () => {
    const d = urun({ costPrice: 100, costCurrency: 'USD' });
    expect(itemCostTRY(d, null)).toBe(0);
    expect(itemCostTRY(d, {})).toBe(0);
    expect(itemCostTRY(d, { USD: 0 })).toBe(0);
    expect(itemCostTRY(d, KURLAR)).not.toBe(100);   // eski hatanın ta kendisi
  });

  it('durum sınıflandırması kur-yok / bilinmeyen-birim ayırıyor', () => {
    expect(maliyetDurumu(urun({ costPrice: 100, costCurrency: 'USD' }), null))
      .toEqual({ durum: 'kur-yok', tutar: 100, birim: 'USD' });
    // Tip dışı bir kod (Mikro/eski veri) TL toplamına karışmaz, N/A olur.
    expect(maliyetDurumu(urun({ costPrice: 100, costCurrency: 'GBP' as 'USD' }), KURLAR))
      .toEqual({ durum: 'bilinmeyen-birim', tutar: 100, birim: 'GBP' });
  });
});

describe('itemPriceTRY — fiyat tarafı aynı kural', () => {
  it('kur yoksa 0, varsa çevirir', () => {
    const d = urun({ prices: { Retail: 100 }, priceCurrency: 'USD' } as Partial<InventoryItem>);
    expect(itemPriceTRY(d, 'Retail', KURLAR)).toBe(4000);
    expect(itemPriceTRY(d, 'Retail', null)).toBe(0);
  });
});

describe('cevrilemeyenler — sessiz eksiltmeyi GÖRÜNÜR yapar', () => {
  const liste = [
    urun({ costPrice: 10 }),                                        // TL
    urun({ costPrice: 10, costCurrency: 'USD' }),                   // kur gerekir
    urun({ costPrice: 10, costCurrency: 'EUR' }),                   // kur gerekir
    urun({ costPrice: 10, costCurrency: 'GBP' as 'USD' }),          // tanınmaz
  ];

  it('kur varken yalnız N/A kalır', () => {
    const o = cevrilemeyenler(liste, KURLAR);
    expect(o.kurYok).toBe(0);
    expect(o.na).toEqual({ GBP: 1 });
    expect(o.toplam).toBe(1);
  });

  it('kur yokken hepsini sayar ve hangi birimin eksik olduğunu söyler', () => {
    const o = cevrilemeyenler(liste, null);
    expect(o.kurYok).toBe(2);
    expect(o.eksikBirimler).toEqual(['EUR', 'USD']);
    expect(o.toplam).toBe(3);
  });

  it('her şey TL ise uyarı YOK (gereksiz gürültü çıkarmaz)', () => {
    const o = cevrilemeyenler([urun({ costPrice: 5 }), urun({ costPrice: 7, costCurrency: 'TRY' })], null);
    expect(o.toplam).toBe(0);
    expect(cevrilemeyenMesaji(o)).toBeNull();
  });

  it('mesaj neyin DIŞARIDA kaldığını ve düzeleceğini söylüyor', () => {
    const m = cevrilemeyenMesaji(cevrilemeyenler(liste, null))!;
    expect(m).toContain('kuru bulunamadı');
    expect(m).toContain('DAHİL DEĞİL');
    expect(m).toContain('Kur geldiğinde');
  });
});
