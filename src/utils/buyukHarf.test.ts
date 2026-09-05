/**
 * buyukHarf.test.ts — Türkçe büyük harf (Faz 1 3/n, 2026-09-05).
 * `toUpperCase()` locale-duyarsız: 'i' → 'I'. Türkçe'de 'i' → 'İ', 'ı' → 'I'.
 * Yalnız EKRANA basılan gerçek metin için; slug/karşılaştırma için DEĞİL (bkz. dosya yorumu).
 */
import { describe, it, expect } from 'vitest';
import { buyukHarf, kucukHarf, basHarf } from './buyukHarf';

describe('buyukHarf / kucukHarf', () => {
  it("'i' → 'İ', 'ı' → 'I' — toUpperCase'in yaptığı 'IRSALIYE' değil", () => {
    expect(buyukHarf('irsaliye')).toBe('İRSALİYE');
    expect('irsaliye'.toUpperCase()).toBe('IRSALIYE');     // tuzağın kendisi, belge olsun
    expect(buyukHarf('ışık')).toBe('IŞIK');
    expect(buyukHarf('teslim edildi')).toBe('TESLİM EDİLDİ');
  });
  it("'I' → 'ı', 'İ' → 'i'", () => {
    expect(kucukHarf('IŞIK')).toBe('ışık');
    expect(kucukHarf('İSTANBUL')).toBe('istanbul');
  });
});

describe('basHarf — avatar baş harfleri', () => {
  it("gerçek ad: 'irfan' → 'İ', 'izmir Çimento' 2 hane → 'İZ'", () => {
    expect(basHarf('irfan')).toBe('İ');
    expect(basHarf('izmir Çimento', 2)).toBe('İZ');
    expect(basHarf('  ahmet')).toBe('A');   // baştaki boşluk kırpılır
  });
  it("boş / null / undefined → '?' (eskiden ''[0] undefined → toUpperCase çöküyordu)", () => {
    expect(basHarf('')).toBe('?');
    expect(basHarf('   ')).toBe('?');
    expect(basHarf(null)).toBe('?');
    expect(basHarf(undefined)).toBe('?');
  });
});
