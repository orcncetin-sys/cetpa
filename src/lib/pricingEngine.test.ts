import { describe, it, expect } from 'vitest';
import { marginPct, markupPct, sellFromMargin, maxBuyPrice, competitorStats, suggestPricing } from './pricingEngine';

describe('pricingEngine', () => {
  it('marginPct: satış üzerinden marj', () => {
    expect(marginPct(60, 100)).toBe(40);   // (100-60)/100
    expect(marginPct(100, 0)).toBe(0);      // sıfır satış
  });

  it('markupPct: maliyet üzerinden ekleme', () => {
    expect(markupPct(50, 100)).toBe(100);   // (100-50)/50
    expect(markupPct(0, 100)).toBe(0);
  });

  it('sellFromMargin: hedef marjdan satış fiyatı', () => {
    expect(sellFromMargin(60, 40)).toBe(100);   // 60/(1-0.4)
    expect(sellFromMargin(100, 0)).toBe(100);
  });

  it('maxBuyPrice: hedef satış+marjdan maks alış', () => {
    expect(maxBuyPrice(100, 40)).toBe(60);      // 100*(1-0.4)
  });

  it('sellFromMargin ↔ maxBuyPrice tutarlı (round-trip)', () => {
    const cost = 73.5, margin = 35;
    const sell = sellFromMargin(cost, margin);
    expect(maxBuyPrice(sell, margin)).toBeCloseTo(cost, 1);
  });

  it('competitorStats: min/avg/max/median', () => {
    const s = competitorStats([120, 100, 140, 0, -5]);
    expect(s.count).toBe(3);
    expect(s.min).toBe(100);
    expect(s.max).toBe(140);
    expect(s.avg).toBe(120);
    expect(s.median).toBe(120);
  });

  it('competitorStats: boş', () => {
    expect(competitorStats([]).count).toBe(0);
    expect(competitorStats([0, -1]).min).toBeNull();
  });

  it('suggestPricing: hedef-marj + rekabetçi öneriler', () => {
    const r = suggestPricing(60, 40, [100, 110, 130]);
    expect(r.marginBasedPrice).toBe(100);
    expect(r.competitor.min).toBe(100);
    // öneriler: hedef marj + agresif(min*0.98) + ortalama + premium(max*1.03)
    const labels = r.suggestions.map(s => s.label);
    expect(labels).toContain('Hedef marj');
    expect(labels).toContain('Agresif (min %2 altı)');
    expect(labels).toContain('Premium (max %3 üstü)');
    // maks alış: rakip min'i hedef satış kabul → 100*(1-0.4)=60
    expect(r.maxBuyForMargin).toBe(60);
  });

  it('suggestPricing: maliyet altı uyarısı', () => {
    const r = suggestPricing(150, 40, [100]); // maliyet rakip min üstünde
    const aggressive = r.suggestions.find(s => s.label.startsWith('Agresif'));
    expect(aggressive!.note).toContain('⚠️');   // 100*0.98=98 < 150
    expect(aggressive!.marginPct).toBeLessThan(0);
  });

  it('suggestPricing: rakip yokken sadece hedef marj', () => {
    const r = suggestPricing(80, 25, []);
    expect(r.suggestions).toHaveLength(1);
    expect(r.competitor.count).toBe(0);
    expect(r.maxBuyForMargin).toBeNull();
  });
});
