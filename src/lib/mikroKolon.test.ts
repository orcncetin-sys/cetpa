import { describe, it, expect } from 'vitest';
import { findKey, kolonSec } from './mikroKolon';

describe('findKey', () => {
  it('desene uyan ilk kolonu bulur', () => {
    expect(findKey({ sth_stok_kod: 1, sth_miktar: 2 }, /miktar/i)).toBe('sth_miktar');
  });
  it('eşleşme yoksa null döner (uydurma yapmaz)', () => {
    expect(findKey({ a: 1, b: 2 }, /miktar/i)).toBeNull();
  });
  it('GUID kolonunu bulmakta kullanılır (import doc id kaynağı)', () => {
    expect(findKey({ dem_Guid: 'x', dem_kod: 'y' }, /_Guid$/i)).toBe('dem_Guid');
  });
});

describe('kolonSec — GUID dışlama (fiyatları sıfırlayan hatanın çözümü)', () => {
  const cols = ['sfiyat_Guid', 'sfiyat_fiyati', 'sfiyat_stok_kod'];

  it('gevşek desen GUID ile eşleşmez — değer kolonunu bulur', () => {
    // Bu tam olarak canlıda yaşanan hata: `fiyat` deseni `sfiyat_Guid`i
    // yakalayıp tüm fiyatları sessizce sıfırlamıştı.
    expect(kolonSec(cols, [/fiyat/i])).toBe('sfiyat_fiyati');
  });

  it('GUID gerçekten aranıyorsa guidDahil ile bulunabilir', () => {
    expect(kolonSec(cols, [/_guid$/i], true)).toBe('sfiyat_Guid');
    expect(kolonSec(cols, [/_guid$/i])).toBeNull(); // varsayılan: dışla
  });
});

describe('kolonSec — desen SIRASI (en spesifik başa)', () => {
  const cols = ['cha_meblag', 'cha_meblag_ana', 'cha_aciklama'];

  it('spesifik desen önce yazılırsa o kazanır', () => {
    expect(kolonSec(cols, [/^cha_meblag_ana$/i, /meblag/i])).toBe('cha_meblag_ana');
  });

  it('sıra ters olursa gevşek desen önce eşleşir — sıralama ÖNEMLİ', () => {
    expect(kolonSec(cols, [/meblag/i, /^cha_meblag_ana$/i])).toBe('cha_meblag');
  });
});

describe('kolonSec — bulunamama', () => {
  it('hiçbir desen tutmazsa null döner; çağıran taraf yüksek sesle hata vermeli', () => {
    expect(kolonSec(['a_kod', 'b_isim'], [/tarih/i, /bedel/i])).toBeNull();
  });

  it('boş kolon listesinde null döner', () => {
    expect(kolonSec([], [/.*/])).toBeNull();
  });

  it('yalnız GUID kolonu varsa varsayılan dışlama null verir', () => {
    expect(kolonSec(['dem_Guid'], [/.*/])).toBeNull();
  });
});
