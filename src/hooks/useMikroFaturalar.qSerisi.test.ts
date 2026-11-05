/**
 * useMikroFaturalar.qSerisi.test.ts — `mapMikroFatura`'nın seri / faturasız alanları (şartname q-serisi v3 Q2-3, T2) ve `faturaNo`'nun
 * TEK anahtar kaynağına geçişinin paritesi (QH1, T2 EK). Mevcut `useMikroFaturalar.test.ts` fikstürleri aynen yeşil kalır.
 */
import { describe, it, expect } from 'vitest';
import { mapMikroFatura } from './useMikroFaturalar';

const satis: Record<string, unknown> = {
  cha_kod: '0120037047', cha_tarihi: '2026-06-06T00:00:00', cha_meblag: 5500.2, cha_evrakno_seri: ' Q ', cha_evrakno_sira: 1,
  kdvTutari: 916.7, matrah: 4583.5, vergiPntr: '4', oranSayisi: 1, cha_tip: 0, cha_subeno: 0, cha_ebelge_Islemturu: 2,
};

describe('T2 — mapMikroFatura: `seri` kırpılmış, giden Q → `faturasiz: true`', () => {
  it('giden Q: seri "Q", faturasız, anahtar "Q-1"', () => {
    const f = mapMikroFatura('q1', satis);
    expect([f.seri, f.faturasiz, f.faturaNo]).toEqual(['Q', true, 'Q-1']);
  });
  it('küçük harf q da faturasız (seri karşılaştırması harf büyüklüğüne duyarsız); saklanan yazım `seri`de AYNEN', () => {
    const f = mapMikroFatura('q2', { ...satis, cha_evrakno_seri: 'q' });
    expect([f.seri, f.faturasiz, f.faturaNo]).toEqual(['q', true, 'q-1']);
  });
  it('boş seri → faturasız DEĞİL', () => {
    const f = mapMikroFatura('f0', { ...satis, cha_evrakno_seri: '', cha_evrakno_sira: 411 });
    expect([f.seri, f.faturasiz, f.faturaNo]).toEqual(['', false, '411']);
  });
  it('gelen Q (alış) faturasız DEĞİL — yön kısıtı (Q2-2)', () => {
    const f = mapMikroFatura('g1', { ...satis, cha_tip: 1 });
    expect([f.yon, f.faturasiz]).toEqual(['gelen', false]);
  });
  it('`cha_evrakno_seri` alanı olmayan eski doküman → seri "", faturasız değil', () => {
    const { cha_evrakno_seri: _yok, ...eski } = satis;
    void _yok;
    const f = mapMikroFatura('e1', eski);
    expect([f.seri, f.faturasiz, f.faturaNo]).toEqual(['', false, '1']);
  });
});

describe('T2 EK — `faturaNo` anahtar işlevine geçiş paritesi', () => {
  it('bugünkü biçimle birebir: seri + sıra "-" ile; boş seri yalnız sıra; sıra yoksa yalnız seri; ikisi de yoksa boş', () => {
    const no = (seri: unknown, sira: unknown) => mapMikroFatura('x', { ...satis, cha_evrakno_seri: seri, cha_evrakno_sira: sira }).faturaNo;
    expect(no('A', 1001)).toBe('A-1001');
    expect(no('  ', 1001)).toBe('1001');
    expect(no('', null)).toBe('');
    expect(no('A', undefined)).toBe('A');
    expect(no('', 0)).toBe('0');
    expect(no('Q', '1')).toBe('Q-1');
  });
});
