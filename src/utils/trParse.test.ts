import { describe, it, expect } from 'vitest';
import { parseTRNumber, parseTRDate } from './trParse';

describe('parseTRNumber — YAŞANMIŞ hatayı kilitler', () => {
  // 2026-08-22 denetim bulgusu C1: AccountingModule banka CSV import'u düz
  // parseFloat kullanıyordu; aşağıdaki üç durum 1000× küçük tutar yazıyordu.
  it('Türk ondalığı (1.234,56) tam okunur — parseFloat 1.234 verirdi', () => {
    expect(parseTRNumber('1.234,56')).toBe(1234.56);
    expect(parseFloat('1.234,56')).toBe(1.234);   // hatanın kanıtı
  });
  it('binlik ayracı (5.000) 5000 olur — parseFloat 5 verirdi', () => {
    expect(parseTRNumber('5.000')).toBe(5000);
    expect(parseFloat('5.000')).toBe(5);          // hatanın kanıtı
  });
  it('çok gruplu binlik (1.234.567)', () => {
    expect(parseTRNumber('1.234.567')).toBe(1234567);
  });
  it('sadece virgül ondalıktır', () => {
    expect(parseTRNumber('5,75')).toBe(5.75);
  });
  it('nokta ondalık da desteklenir (12.5 / 5.75)', () => {
    expect(parseTRNumber('12.5')).toBe(12.5);
    expect(parseTRNumber('5.75')).toBe(5.75);
  });
  it('EN biçimi (1,234.56) de doğru okunur', () => {
    expect(parseTRNumber('1,234.56')).toBe(1234.56);
  });
  it('para simgesi ve boşluk temizlenir', () => {
    expect(parseTRNumber('₺ 12.500,00')).toBe(12500);
    expect(parseTRNumber('1.000,50 TL')).toBe(1000.5);
  });
  it('negatif tutar korunur (ödeme satırı)', () => {
    expect(parseTRNumber('-2.500,25')).toBe(-2500.25);
  });
  it('boş / bozuk girdi 0 döner, NaN DÖNMEZ', () => {
    expect(parseTRNumber('')).toBe(0);
    expect(parseTRNumber('abc')).toBe(0);
    expect(Number.isNaN(parseTRNumber('---'))).toBe(false);
  });
});

describe('parseTRDate', () => {
  it('DD.MM.YYYY → ISO', () => expect(parseTRDate('15.03.2026')).toBe('2026-03-15'));
  it('DD/MM/YYYY → ISO', () => expect(parseTRDate('5/3/2026')).toBe('2026-03-05'));
  it('iki haneli yıl 20xx varsayar', () => expect(parseTRDate('15.03.26')).toBe('2026-03-15'));
  it('ISO olduğu gibi kalır', () => expect(parseTRDate('2026-03-15')).toBe('2026-03-15'));
});
