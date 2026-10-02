/** ebelgeTuruCoz — tür `cha_ebelge_Islemturu`'ndan; `cha_ebelge_turu` tür DEĞİL (canlı ölçüm 2026-10-02). */
import { describe, it, expect } from 'vitest';
import { ebelgeTuruCoz } from './ebelgeTuru';

describe('ebelgeTuruCoz', () => {
  it('giden: işlem türü 1 → e-Fatura (0), 2 → e-Arşiv (1) — sayı ya da metin', () => {
    expect(ebelgeTuruCoz({ cha_tip: 0, cha_ebelge_Islemturu: 1 })).toBe(0);
    expect(ebelgeTuruCoz({ cha_tip: '0', cha_ebelge_Islemturu: '2' })).toBe(1);
  });
  it('cha_ebelge_turu türü BELİRLEMEZ: 381 (tür kolonu 1, işlem 1) e-Fatura; 384 (tür kolonu 0, işlem 2) e-Arşiv', () => {
    expect(ebelgeTuruCoz({ cha_tip: '0', cha_ebelge_turu: '1', cha_ebelge_Islemturu: '1' })).toBe(0);
    expect(ebelgeTuruCoz({ cha_tip: '0', cha_ebelge_turu: '0', cha_ebelge_Islemturu: '2' })).toBe(1);
    expect(ebelgeTuruCoz({ cha_tip: 0, cha_ebelge_turu: 1 })).toBe(-1);            // işlem türü hiç yoksa uydurulmaz
  });
  it('gelen: Mikro türü tutmuyor (işlem türü hep 0) → bilinmiyor; cha_ebelge_turu = 1 olsa da e-Arşiv DENMEZ', () => {
    expect(ebelgeTuruCoz({ cha_tip: '1', cha_ebelge_turu: '1', cha_ebelge_Islemturu: '0' })).toBe(-1);
    expect(ebelgeTuruCoz({ cha_tip: 1, cha_ebelge_Islemturu: 2 })).toBe(-1);
  });
  it('bilinmeyen kod / boş / yön okunamıyor → bilinmiyor', () => {
    expect(ebelgeTuruCoz({ cha_tip: 0, cha_ebelge_Islemturu: 0 })).toBe(-1);
    expect(ebelgeTuruCoz({ cha_tip: 0, cha_ebelge_Islemturu: null })).toBe(-1);
    expect(ebelgeTuruCoz({ cha_tip: 0, cha_ebelge_Islemturu: '' })).toBe(-1);
    expect(ebelgeTuruCoz({ cha_ebelge_Islemturu: 2 })).toBe(-1);
    expect(ebelgeTuruCoz({ cha_tip: '', cha_ebelge_Islemturu: 2 })).toBe(-1);
  });
  it('anahtar harf duyarsız (küçük harfli yazım da okunur)', () => {
    expect(ebelgeTuruCoz({ cha_tip: 0, cha_ebelge_islemturu: 2 })).toBe(1);
  });
});
