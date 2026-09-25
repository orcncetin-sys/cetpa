/**
 * sayiMetni.test.ts — ekran sayaç biçimleyicisi (mikro-import-arkaplan K-K, 2026-09-24). ÖNCE YAZILDI.
 * Sahte kesinlik yasağı: bilinmeyen sayaç '—' olur, 0 UYDURULMAZ. `?? 0` geri gelirse
 * `sayiMetni(undefined)` '0' döner ve bu dosya KIRMIZI olur (mutasyon ayırt edici).
 */
import { describe, it, expect } from 'vitest';
import { sayiMetni, sonluSayi } from './sayiMetni';

describe('sayiMetni — number → metin', () => {
  it('sonlu sayı olduğu gibi (0 dâhil — gerçek sıfır bilgidir)', () => {
    expect(sayiMetni(0)).toBe('0');
    expect(sayiMetni(2384)).toBe('2384');
    expect(sayiMetni(-3)).toBe('-3');
  });
  it('bilinmeyen → "—": undefined, null, NaN, Infinity, sayısal STRING, boolean', () => {
    for (const v of [undefined, null, NaN, Infinity, -Infinity, '5', '', true, {}]) expect(sayiMetni(v)).toBe('—');
  });
});

describe('sonluSayi — unknown → number | null (yalnız gerçek sayı; string KABUL EDİLMEZ)', () => {
  it('sonlu sayı → kendisi', () => { expect(sonluSayi(7)).toBe(7); expect(sonluSayi(0)).toBe(0); });
  it('bilinmeyen → null (0 DEĞİL)', () => {
    for (const v of [undefined, null, NaN, Infinity, '7', true]) expect(sonluSayi(v)).toBeNull();
  });
});
