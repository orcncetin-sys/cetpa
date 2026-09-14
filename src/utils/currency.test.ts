import { describe, it, expect } from 'vitest';
import { formatCurrency, formatInCurrency, kurCevir, tlyeCevir, kurFarki } from './currency';

describe('formatCurrency', () => {
  it('formats TRY amounts with ₺ symbol', () => {
    const result = formatCurrency(1000);
    expect(result).toContain('1.000');
    expect(result).toContain('₺');
  });

  // Faz 1 (2026-09-04): eskiden '₺0,00' bekleniyordu — test YANLIŞ davranışı
  // sabitliyordu. Bilinmeyen tutar sıfır değil, bilinmiyordur.
  it("bilinmeyen tutar '—' döner — '₺0,00' sahte kesinlikti", () => {
    expect(formatCurrency(NaN)).toBe('—');
    expect(formatCurrency(Infinity)).toBe('—');
    expect(formatCurrency(-Infinity)).toBe('—');
    expect(formatCurrency(Number(undefined))).toBe('—');   // Mikro'dan gelmemiş alan
    // GERÇEK VERİ ŞEKLİ: null. Global isFinite(null) === true olduğundan ilk düzeltme
    // bunu kaçırmıştı ('₺0,00' basıyordu) — inceleme yakaladı, Number.isFinite ile kapandı.
    expect(formatCurrency(null as unknown as number)).toBe('—');
    expect(formatCurrency(undefined as unknown as number)).toBe('—');
    expect(formatCurrency('' as unknown as number)).toBe('—');
    expect(formatCurrency(0)).not.toBe('—');               // GERÇEK sıfır sıfırdır
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
    expect(result).toBe('—');   // Faz 1: '0 USD' sahte kesinlikti
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

describe('kurCevir — uydurma kur YASAK', () => {
  const kurlar = { USD: 40, EUR: 44 };

  it('TRY icin aynen doner (kur gerekmez)', () => {
    expect(kurCevir(1000, 'TRY', kurlar)).toBe(1000);
    // Kur HIC yokken bile TRY yolu calismali — regresyonun en olasi yeri burasi.
    expect(kurCevir(1000, 'TRY', null)).toBe(1000);
    expect(kurCevir(1000, 'TRY', undefined)).toBe(1000);
  });

  it('kur varsa dogru cevirir', () => {
    expect(kurCevir(40000, 'USD', kurlar)).toBe(1000);
    expect(kurCevir(44000, 'EUR', kurlar)).toBe(1000);
  });

  it('kur YOKSA null doner — TL tutarini oldugu gibi DONDURMEZ', () => {
    // Bu testin varlik sebebi: 13 dosyada `exchangeRates?.USD || 1` vardi ve
    // kur yokken TL tutari '$' ile basiliyordu (₺40.000 -> "$40.000", ~40 kat).
    expect(kurCevir(40000, 'USD', null)).toBeNull();
    expect(kurCevir(40000, 'USD', undefined)).toBeNull();
    expect(kurCevir(40000, 'USD', {})).toBeNull();
    expect(kurCevir(40000, 'USD', kurlar)).not.toBe(40000);
  });

  it('gecersiz kur (0, negatif, NaN) null doner — bolme patlamaz', () => {
    expect(kurCevir(40000, 'USD', { USD: 0 })).toBeNull();
    expect(kurCevir(40000, 'USD', { USD: -5 })).toBeNull();
    expect(kurCevir(40000, 'USD', { USD: NaN })).toBeNull();
    expect(kurCevir(40000, 'USD', { USD: Infinity })).toBeNull();
  });

  it('gecersiz tutar null doner', () => {
    expect(kurCevir(NaN, 'USD', kurlar)).toBeNull();
    expect(kurCevir(Infinity, 'TRY', kurlar)).toBeNull();
  });

  it('formatInCurrency ile AYNI karari verir (iki kopya sapmasin)', () => {
    // Ikisi de "kur yok -> gosterme" diyor; biri sayi, digeri string dilinde.
    expect(kurCevir(40000, 'USD', null)).toBeNull();
    expect(formatInCurrency(40000, 'USD', undefined)).toBe('—');
  });
});

// Faz 3 1/n hakem turu (2026-09-13): döviz→TL çevirimi üç kopyaydı (MuhasebePage tlYap — global isFinite —,
// nakitBilanco dovizTopla içi, mutabakatMasraf tlyeCevir). Tek kaynak burada, kurCevir'in tersi.
describe('tlyeCevir — dövizi TL’ye çevirir, kur yoksa null (kurCevir’in tersi)', () => {
  const kurlar = { USD: 40, EUR: 45 };
  it('TRY olduğu gibi; boş birim TRY sayılır', () => {
    expect(tlyeCevir(100, 'TRY', kurlar)).toBe(100);
    expect(tlyeCevir(100, undefined, null)).toBe(100);
    expect(tlyeCevir(100, '', undefined)).toBe(100);
  });
  it('kur varsa tutar × kur', () => {
    expect(tlyeCevir(10, 'USD', kurlar)).toBe(400);
    expect(tlyeCevir(2, 'EUR', kurlar)).toBe(90);
  });
  it('kur yok / 0 / negatif / NaN → null (2024 sabiti YOK)', () => {
    expect(tlyeCevir(10, 'GBP', kurlar)).toBeNull();
    expect(tlyeCevir(10, 'USD', null)).toBeNull();
    expect(tlyeCevir(10, 'USD', undefined)).toBeNull();
    expect(tlyeCevir(10, 'USD', { USD: 0 })).toBeNull();
    expect(tlyeCevir(10, 'USD', { USD: -3 })).toBeNull();
    expect(tlyeCevir(10, 'USD', { USD: NaN })).toBeNull();
  });
  it('tutar bilinmiyorsa null — kur olsa bile; null tutar 0 SAYILMAZ (global isFinite tuzağı)', () => {
    expect(tlyeCevir(NaN, 'USD', kurlar)).toBeNull();
    expect(tlyeCevir(NaN, 'TRY', kurlar)).toBeNull();
    expect(tlyeCevir(null as unknown as number, 'TRY', kurlar)).toBeNull();
  });
  it('kurCevir ile SİMETRİK: TL → döviz → TL aynı tutara döner; kur yokken ikisi de null', () => {
    const doviz = kurCevir(40000, 'USD', kurlar);
    expect(doviz).toBe(1000);
    expect(tlyeCevir(doviz as number, 'USD', kurlar)).toBe(40000);
    expect(kurCevir(40000, 'EUR', {})).toBeNull();
    expect(tlyeCevir(1000, 'EUR', {})).toBeNull();
  });
});

describe('kurFarki — Phase 635 kur değerleme (bakiye × (güncel − defter)); bilinmeyen girdi → null', () => {
  it('sayı: 1000 USD × (41,50 − 40,00) = +1.500 TL; defter kuru güncelin üstündeyse negatif', () => {
    expect(kurFarki(1000, 40, 41.5)).toBeCloseTo(1500, 6);
    expect(kurFarki('250', '45', 44)).toBeCloseTo(-250, 6);   // sayısal string girişler kabul
  });
  it("güncel kur yoksa (null/NaN) ya da bakiye/defter kuru boş/bozuk (NaN, '', 'abc', undefined) → null ('—'); ₺0 zarar uydurulmaz", () => {
    expect(kurFarki(1000, 40, null)).toBeNull();
    expect(kurFarki(1000, 40, NaN)).toBeNull();
    for (const bozuk of [NaN, '', 'abc', undefined, null]) {
      expect(kurFarki(bozuk, 40, 41.5)).toBeNull();
      expect(kurFarki(1000, bozuk, 41.5)).toBeNull();
    }
  });
  it('bakiye 0 gerçek sıfır: fark 0 (pozisyon yok), null değil', () => {
    expect(kurFarki(0, 40, 41.5)).toBe(0);
  });
});
