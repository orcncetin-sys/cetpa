import { describe, it, expect } from 'vitest';
import { siparisFaturaVar, faturaKesilebilir, mikroyaFaturaGonderilebilir } from './faturaDurumu';

describe('siparisFaturaVar — "faturası VAR mı" (faturalı satış bayrağı DEĞİL)', () => {
  it('Mikro faturası satırı (MF-383 vakası): source mikro-fatura + faturali true + mikroFaturaNo → VAR', () => {
    expect(siparisFaturaVar({ source: 'mikro-fatura', faturali: true, mikroFaturaNo: '383' })).toBe(true);
  });
  it('backfill öncesi Mikro faturası: mikroFaturaNo YOK ama source mikro-fatura → yine VAR', () => {
    expect(siparisFaturaVar({ source: 'mikro-fatura', faturali: true })).toBe(true);
  });
  it('native sipariş, Cetpa faturası kesilmiş (hasInvoice) → VAR; Mikro numarası alınmış → VAR', () => {
    expect(siparisFaturaVar({ hasInvoice: true })).toBe(true);
    expect(siparisFaturaVar({ mikroFaturaNo: 'CTP2026000000174' })).toBe(true);
  });
  it('faturali:true tek başına fatura KANITI DEĞİLDİR (faturalı satış tipi) — mutasyon-ayırt-edici', () => {
    expect(siparisFaturaVar({ faturali: true })).toBe(false);
    expect(siparisFaturaVar({ faturali: true, hasInvoice: false })).toBe(false);
  });
  it('yalnız gerçek tipler: "true"/1/boş string fatura sayılmaz; null/undefined → yok', () => {
    expect(siparisFaturaVar({ hasInvoice: 'true' as never })).toBe(false);
    expect(siparisFaturaVar({ mikroFaturaNo: '   ' })).toBe(false);
    expect(siparisFaturaVar({ mikroFaturaNo: 1 as never })).toBe(false);
    expect(siparisFaturaVar(null)).toBe(false);
    expect(siparisFaturaVar(undefined)).toBe(false);
  });
});

describe('faturaKesilebilir — Fatura Kes düğmesi', () => {
  it('MF-383: Mikro faturası olan satırda düğme KAPALI (kullanıcı kuralı)', () => {
    expect(faturaKesilebilir({ source: 'mikro-fatura', faturali: true, mikroFaturaNo: '383' })).toBe(false);
  });
  it('parite: native, faturası yok, faturali undefined/true → AÇIK (eski `!hasInvoice && faturali !== false`)', () => {
    expect(faturaKesilebilir({})).toBe(true);
    expect(faturaKesilebilir({ faturali: true })).toBe(true);
  });
  it('faturasız satış (faturali:false) → KAPALI; Cetpa faturası varsa → KAPALI', () => {
    expect(faturaKesilebilir({ faturali: false })).toBe(false);
    expect(faturaKesilebilir({ hasInvoice: true })).toBe(false);
  });
});

describe('mikroyaFaturaGonderilebilir — Mikro e-Fatura push düğmesi', () => {
  it('Mikro numarası alınmışsa ya da satır Mikro faturasıysa KAPALI (çift e-Fatura yolu)', () => {
    expect(mikroyaFaturaGonderilebilir({ mikroFaturaNo: '383' })).toBe(false);
    expect(mikroyaFaturaGonderilebilir({ source: 'mikro-fatura' })).toBe(false);
  });
  it('Cetpa-iç fatura (hasInvoice) Mikro\'ya göndermeyi ENGELLEMEZ; faturali:false engeller', () => {
    expect(mikroyaFaturaGonderilebilir({ hasInvoice: true })).toBe(true);
    expect(mikroyaFaturaGonderilebilir({ faturali: false })).toBe(false);
    expect(mikroyaFaturaGonderilebilir({})).toBe(true);
  });
});
