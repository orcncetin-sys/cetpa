/**
 * currency.ekran.test.ts — EKRAN para biçimi tek kaynağı (Faz 2 1/n, 2026-09-05). ÖNCE YAZILDI.
 *
 * Faz 0 ölçümü: para biçimi 325 yerde satır içi (`₺${n.toLocaleString('tr-TR', …)}`), 20 yerel
 * kopya (fmtKpi ×5, formatTRY ×3, fmtTRY ×3, TahsilatModule.formatCurrency …). Her kopya bilinmeyen
 * tutarı '₺NaN' / '₺0' basıyor; kur yokken kimi 1 kimi 38 sabitiyle çeviriyordu. Bu dosya üç
 * fonksiyonun sözleşmesini kilitler; 325 yer bunlara taşınacak:
 *   paraYaz(v, {birim, ondalik})        — tutar ZATEN birim cinsinden, çeviri YOK
 *   tlYaz(vTRY, {birim, rates, ondalik}) — TL tutarını kurla çevirip yazar; kur yoksa '—'
 *   kisaTutar(vTRY, {fmt:'K'|'M'|'full', ondalik, birim, rates}) — KPI kartları (fmtKpi'nin yerine)
 * Görünüm mevcut satır içi desenle AYNI: sembol önde, yerel gruplama (₺1.234,56 / $1,234.56 / €1.234,56).
 */
import { describe, it, expect } from 'vitest';
import { paraYaz, tlYaz, kisaTutar } from './currency';

describe('paraYaz — sembol önde, yerel gruplama, bilinmeyen "—"', () => {
  it("TL varsayılan 2 ondalık: '₺1.234,50'; 0 gerçek sıfır '₺0,00'", () => {
    expect(paraYaz(1234.5)).toBe('₺1.234,50');
    expect(paraYaz(0)).toBe('₺0,00');
  });
  it("ondalik 0 yuvarlar: '₺1.235'; ondalik 1: '₺1.234,5'", () => {
    expect(paraYaz(1234.5, { ondalik: 0 })).toBe('₺1.235');
    expect(paraYaz(1234.5, { ondalik: 1 })).toBe('₺1.234,5');
  });
  it("bilinmeyen (undefined/null/NaN/''/'abc'/Infinity) → '—', asla '₺NaN' ya da '₺0,00'", () => {
    for (const v of [undefined, null, NaN, '', 'abc', Infinity]) expect(paraYaz(v)).toBe('—');
  });
  it("sayısal string kabul ('1250.5' DB'den gelebilir)", () => {
    expect(paraYaz('1250.5')).toBe('₺1.250,50');
  });
  it("USD/EUR/GBP: sembol önde, kendi yerel gruplaması; bilinmeyen kod: '1.234,50 XAU'", () => {
    expect(paraYaz(1234.5, { birim: 'USD' })).toBe('$1,234.50');
    expect(paraYaz(1234.5, { birim: 'EUR' })).toBe('€1.234,50');
    expect(paraYaz(1234.5, { birim: 'GBP' })).toBe('£1,234.50');
    expect(paraYaz(1234.5, { birim: 'XAU' })).toBe('1.234,50 XAU');
    expect(paraYaz(1234.5, { birim: 'try' })).toBe('₺1.234,50');   // küçük harf kodu tolere
  });
  it("negatif: işaret sembolün ÖNÜNDE ('-₺1.234,50'), '₺-1.234,50' değil", () => {
    expect(paraYaz(-1234.5)).toBe('-₺1.234,50');
  });
});

describe('tlYaz — TL tutarını kurla çevirip yazar', () => {
  it("TRY: çeviri yok; USD kur 40 → 40.000 TL = '$1,000.00'", () => {
    expect(tlYaz(1234.5)).toBe('₺1.234,50');
    expect(tlYaz(40000, { birim: 'USD', rates: { USD: 40 } })).toBe('$1,000.00');
  });
  it("kur yoksa/sıfırsa '—' — TL tutarı yabancı sembolle BASILMAZ (₺40.000 → '$40.000' tuzağı)", () => {
    expect(tlYaz(40000, { birim: 'USD' })).toBe('—');
    expect(tlYaz(40000, { birim: 'USD', rates: { USD: 0 } })).toBe('—');
    expect(tlYaz(40000, { birim: 'USD', rates: null })).toBe('—');
  });
  it("tutar bilinmiyorsa '—'", () => {
    expect(tlYaz(undefined, { birim: 'USD', rates: { USD: 40 } })).toBe('—');
  });
});

describe('kisaTutar — KPI kartları (fmtKpi ×5 kopyasının yerine)', () => {
  it("'K': ₺12.500 → '₺13K' (ondalik 0), ondalik 1 → '₺12,5K'; 'M': ₺1.250.000 → '₺1,3M' (ondalik 1)", () => {
    expect(kisaTutar(12500, { fmt: 'K' })).toBe('₺13K');
    expect(kisaTutar(12500, { fmt: 'K', ondalik: 1 })).toBe('₺12,5K');
    expect(kisaTutar(1250000, { fmt: 'M', ondalik: 1 })).toBe('₺1,3M');
  });
  it("'full' (varsayılan) = paraYaz, ondalik varsayılan 0 (KPI kartı)", () => {
    expect(kisaTutar(1234.5)).toBe('₺1.235');
    expect(kisaTutar(1234.5, { ondalik: 2 })).toBe('₺1.234,50');
  });
  it("USD seçili + kur: çevrilir, en-US gruplama ('$0.3K'); kur yoksa '—'", () => {
    expect(kisaTutar(12500, { fmt: 'K', ondalik: 1, birim: 'USD', rates: { USD: 40 } })).toBe('$0.3K');
    expect(kisaTutar(12500, { fmt: 'K', birim: 'USD' })).toBe('—');
  });
  it("bilinmeyen tutar '—'", () => {
    expect(kisaTutar(NaN, { fmt: 'K' })).toBe('—');
  });
});
