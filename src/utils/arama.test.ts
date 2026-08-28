import { describe, it, expect } from 'vitest';
import { katla, eslesir } from './arama';

describe('arama — Türkçe katlama', () => {
  it("toLowerCase'in bozduğu durumları düzeltir", () => {
    // Bu ikisi düz toLowerCase ile EŞLEŞMEZ — hatanın ta kendisi.
    expect(eslesir('ışık', 'IŞIK ELEKTRİK')).toBe(true);
    expect(eslesir('ISIK', 'Işık Elektrik')).toBe(true);
    expect(eslesir('istanbul', 'İSTANBUL TİCARET')).toBe(true);
  });

  it('Türkçe karakter olmadan da aranabilir', () => {
    expect(eslesir('sisli', 'Şişli Yapı Market')).toBe(true);
    expect(eslesir('cimento', 'ÇİMENTO A.Ş.')).toBe(true);
    expect(eslesir('gungoren', 'Güngören İnşaat')).toBe(true);
  });

  it('kullanıcının aradığı gerçek örnek', () => {
    expect(eslesir('ahmet', 'AHMET YILMAZ İNŞAAT')).toBe(true);
    expect(eslesir('AHMET', 'ahmet yılmaz')).toBe(true);
  });

  it('eşleşmeyeni eşleştirmez (bulanık arama YOK)', () => {
    expect(eslesir('ahmet', 'MEHMET YILMAZ')).toBe(false);
    expect(eslesir('ahmed', 'AHMET')).toBe(false); // typo toleransı yok
  });

  it('boş sorgu filtre uygulamaz', () => {
    expect(eslesir('', 'herhangi bir sey')).toBe(true);
    expect(eslesir('   ', 'herhangi bir sey')).toBe(true);
  });

  it('birden çok alanda arar, null/undefined güvenli', () => {
    expect(eslesir('FT-2026', null, undefined, 'FT-2026-001')).toBe(true);
    expect(eslesir('yok', null, undefined)).toBe(false);
  });

  it('sayısal alanlarda da çalışır (tutar araması)', () => {
    expect(eslesir('1500', 'Cari', 15000)).toBe(true);
  });

  it('katla boş girdilerde patlamaz', () => {
    expect(katla(null)).toBe('');
    expect(katla(undefined)).toBe('');
    expect(katla(0)).toBe('0');
  });
});
