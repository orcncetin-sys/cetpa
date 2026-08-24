import { describe, it, expect } from 'vitest';
import { formatCurrency, formatInCurrency } from './currency';

describe('formatCurrency', () => {
  it('formats TRY amounts with ₺ symbol', () => {
    const result = formatCurrency(1000);
    expect(result).toContain('1.000');
    expect(result).toContain('₺');
  });

  it('returns ₺0,00 for non-finite values', () => {
    expect(formatCurrency(NaN)).toBe('₺0,00');
    expect(formatCurrency(Infinity)).toBe('₺0,00');
    expect(formatCurrency(-Infinity)).toBe('₺0,00');
  });

  it('formats zero correctly', () => {
    const result = formatCurrency(0);
    expect(result).toContain('0');
    expect(result).toContain('₺');
  });

  it('formats negative amounts', () => {
    const result = formatCurrency(-500);
    expect(result).toContain('500');
  });
});

describe('formatInCurrency', () => {
  const rates = { USD: 46, EUR: 50, GBP: 58 };

  it('returns TRY without conversion', () => {
    const result = formatInCurrency(1000, 'TRY', rates);
    expect(result).toContain('1.000');
  });

  it('converts TRY to USD using exchange rate', () => {
    // 9200 TRY / 46 = 200 USD
    const result = formatInCurrency(9200, 'USD', rates);
    expect(result).toContain('200');
  });

  it('converts TRY to EUR using exchange rate', () => {
    // 5000 TRY / 50 = 100 EUR
    const result = formatInCurrency(5000, 'EUR', rates);
    expect(result).toContain('100');
  });

  it('returns 0 currency fallback for non-finite', () => {
    const result = formatInCurrency(NaN, 'USD', rates);
    expect(result).toBe('0 USD');
  });

  it("kur yoksa '—' döner — TL tutarı yabancı sembolle GÖSTERİLMEZ", () => {
    // Eski davranış "tutarı aynen döndür"dü ve bu test onu kilitliyordu —
    // yani ₺1000, XYZ para birimi etiketiyle 1000 diye basılıyordu (~40×
    // şişkin gösterim, 2026-08-22 denetim bulgusu C4). Doğrusu: güvenilir
    // çevrilemeyen rakam yerine '—' (CLAUDE.md: sahte kesinlik gösterme).
    expect(formatInCurrency(1000, 'XYZ', rates)).toBe('—');
    expect(formatInCurrency(1000, 'USD', undefined)).toBe('—');  // kur tablosu hiç yok
    expect(formatInCurrency(1000, 'TRY', undefined)).not.toBe('—'); // TRY kur istemez
  });

  it('handles missing rates gracefully', () => {
    const result = formatInCurrency(1000, 'USD');
    // No rates → no conversion → shows 1000
    expect(result).toBeTruthy();
  });
});
