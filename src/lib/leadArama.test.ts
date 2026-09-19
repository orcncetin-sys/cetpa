/**
 * leadArama.test.ts — CRM lead arama süzgecinin sözleşmesi (2026-09-19). ÖNCE YAZILDI.
 *
 * NEDEN: `CRMPage` üç ayrı yerde aynı süzgeci elle kopyalamış ve üçü de korumasızdı
 * (`l.company.toLowerCase()`, `l.email.toLowerCase()`). Mikro cari import'u artık
 * BİLİNMEYEN alanı hiç yazmıyor (eslemeCari sözleşmesi), yani e-postası boş bir
 * cariden açılan lead'de `email` anahtarı BULUNMAYABİLİR — ada uymayan her aramada
 * "Cannot read properties of undefined" ile CRM sekmesi çöküyordu.
 *
 * İkinci iddia: eşleştirme Türkçe duyarlı olmalı. `'ŞİRİN'.toLowerCase()` → 'şi̇ri̇n'
 * (i + birleşik nokta) ve 'Şirin' ile ASLA eşleşmez; Mikro unvanları BÜYÜK gelir.
 * Tek kaynak `isimAnahtari` (tr-TR) — CLAUDE.md Türkçe büyük/küçük harf kuralı.
 */
import { describe, it, expect } from 'vitest';
import { leadAramaEslesir } from './leadArama';

const SIRIN = { name: 'Şirin İnşaat', company: 'ŞİRİN İNŞAAT LTD. ŞTİ.', email: 'muhasebe@sirin.com.tr' };

describe('leadAramaEslesir — alan eksikse ÇÖKMEZ', () => {
  it('email/company alanı HİÇ YOKSA sessizce elenir (Mikro import lead\'i)', () => {
    const mikroLead = { name: 'Şirin İnşaat' };   // email/company yazılmadı
    expect(() => leadAramaEslesir(mikroLead, 'xyz')).not.toThrow();
    expect(leadAramaEslesir(mikroLead, 'xyz')).toBe(false);
    expect(leadAramaEslesir(mikroLead, 'şirin')).toBe(true);
  });

  it('name de yoksa çökmez (tamamen boş kayıt)', () => {
    expect(leadAramaEslesir({}, 'xyz')).toBe(false);
    expect(leadAramaEslesir({}, '')).toBe(true);
  });

  it('null/undefined alanlar boş metin sayılır', () => {
    expect(leadAramaEslesir({ name: null, company: undefined, email: null }, 'a')).toBe(false);
  });
});

describe('leadAramaEslesir — eşleştirme davranışı', () => {
  it('boş sorgu her lead\'i geçirir (liste filtresiz görünür)', () => {
    expect(leadAramaEslesir(SIRIN, '')).toBe(true);
    expect(leadAramaEslesir(SIRIN, '   ')).toBe(true);
  });

  it('ad, unvan ve e-postanın ÜÇÜNDE de arar', () => {
    expect(leadAramaEslesir(SIRIN, 'inşaat')).toBe(true);        // name
    expect(leadAramaEslesir(SIRIN, 'ltd')).toBe(true);           // company
    expect(leadAramaEslesir(SIRIN, 'muhasebe@')).toBe(true);     // email
    expect(leadAramaEslesir(SIRIN, 'çimento')).toBe(false);
  });

  it('TÜRKÇE büyük/küçük harf: BÜYÜK Mikro unvanı karışık yazımla eşleşir', () => {
    // `toLowerCase()` ile 'ŞİRİN' → 'şi̇ri̇n' olur ve 'şirin' ile eşleşmez.
    expect(leadAramaEslesir(SIRIN, 'ŞİRİN')).toBe(true);
    expect(leadAramaEslesir(SIRIN, 'şirin')).toBe(true);
    expect(leadAramaEslesir({ company: 'IŞIK YAPI' }, 'ışık')).toBe(true);
  });

  it('sayısal alan (telefon gibi) metne çevrilir, çökmez', () => {
    expect(leadAramaEslesir({ name: 12345 }, '234')).toBe(true);
  });
});

// 2026-09-19 kapanış incelemesi (REGRESYON): tr-TR küçültme ASCII 'I'yı 'ı' yapar — Mikro/Excel kaynaklı
// NOKTASIZ büyük harfli kayıtlar ('DEMIR INSAAT', 'INFO@DEMIR.COM') 'demir' / 'info@' ile artık BULUNMUYORDU
// (eski `toLowerCase()` buluyordu). ARAMA katlaması ı→i yapar; `isimAnahtari` (mükerrer-lead eşleştirme
// anahtarı) DEĞİŞMEZ.
describe('leadAramaEslesir — ASCII büyük I ile yazılmış kayıt (mutasyon-ayırt-edici)', () => {
  it("'DEMIR INSAAT' 'demir' ile, 'INFO@DEMIR.COM' 'info@' ile bulunur", () => {
    expect(leadAramaEslesir({ company: 'DEMIR INSAAT', email: 'INFO@DEMIR.COM' }, 'demir')).toBe(true);
    expect(leadAramaEslesir({ company: 'DEMIR INSAAT', email: 'INFO@DEMIR.COM' }, 'info@')).toBe(true);
    expect(leadAramaEslesir({ name: 'ISIK YAPI' }, 'isik')).toBe(true);   // ASCII kayıt, ASCII sorgu
    expect(leadAramaEslesir({ name: 'ISIK YAPI' }, 'ışık')).toBe(false);  // ş ≠ s: translit yok (yalnız ı/i katlanır)
  });
  it('ters yön: küçük kayıt BÜYÜK sorguyla bulunur', () => {
    expect(leadAramaEslesir({ email: 'info@demir.com' }, 'INFO')).toBe(true);
    expect(leadAramaEslesir({ name: 'Şirin İnşaat' }, 'SIRIN')).toBe(false); // ş ≠ s — yalnız ı/i katlanır, translit YOK
  });
  it('Türkçe kazanım korunur', () => {
    expect(leadAramaEslesir({ company: 'ŞİRİN İNŞAAT' }, 'şirin')).toBe(true);
    expect(leadAramaEslesir({ company: 'IŞIK YAPI' }, 'ışık')).toBe(true);
    expect(leadAramaEslesir({ company: 'IŞIK YAPI' }, 'çimento')).toBe(false);
  });
});

