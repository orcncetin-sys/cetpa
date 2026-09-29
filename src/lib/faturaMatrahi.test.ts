/** faturaMatrahi — matrahın tek kaynağı (ölçülen tanım: cha_aratoplam − Σcha_ft_iskonto; satırdan tutar − Σisk + Σmasraf). */
import { describe, it, expect } from 'vitest';
import { baslikMatrahi, baslikMatrahSql, satirNetSql } from './faturaMatrahi';

describe('baslikMatrahi (JS)', () => {
  it('iskontolu: aratoplam BRÜT − Σft iskonto (evrak 420 Mikro kaydı: 398.317,50 − 114.817,50 = 283.500)', () => {
    expect(baslikMatrahi({ cha_aratoplam: 398317.5, cha_ft_iskonto1: 85050, cha_ft_iskonto2: 29767.5, cha_ft_iskonto3: 0 })).toBe(283500);
    expect(baslikMatrahi({ cha_aratoplam: '16769.52', cha_ft_iskonto1: '0' })).toBeCloseTo(16769.52, 2);
  });
  it('BİLİNMİYOR: aratoplam yok/okunamaz, HİÇ ft alanı yok (brüte düşmez), var olan ft alanı okunamaz', () => {
    expect(baslikMatrahi({ cha_ft_iskonto1: 0 })).toBeNull();
    expect(baslikMatrahi({ cha_aratoplam: null, cha_ft_iskonto1: 0 })).toBeNull();
    expect(baslikMatrahi({ cha_aratoplam: 1000 })).toBeNull();
    expect(baslikMatrahi({ cha_aratoplam: 1000, cha_ft_iskonto1: 10, cha_ft_iskonto2: null })).toBeNull();
  });
  it('bayrak alanları (cha_isk_mas*) iskonto sayılmaz', () => {
    expect(baslikMatrahi({ cha_aratoplam: 1000, cha_ft_iskonto1: 100, cha_isk_mas1: 1 })).toBe(900);
  });
});

describe('SQL üreticileri', () => {
  it('başlık: gerçek yazımla, yalnız ft aileleri; aratoplam ya da ft yoksa null (brüt matrah yazılmaz)', () => {
    expect(baslikMatrahSql(['cha_aratoplam', 'cha_ft_iskonto1', 'cha_ft_iskonto2', 'cha_isk_mas1'])).toBe(
      '(cha.cha_aratoplam - (ISNULL(cha.cha_ft_iskonto1, 0) + ISNULL(cha.cha_ft_iskonto2, 0)))');
    expect(baslikMatrahSql(['CHA_ARATOPLAM', 'CHA_FT_ISKONTO1'], '')).toBe('(CHA_ARATOPLAM - (ISNULL(CHA_FT_ISKONTO1, 0)))');
    expect(baslikMatrahSql(['cha_ft_iskonto1'])).toBeNull();
    expect(baslikMatrahSql(['cha_aratoplam'])).toBeNull();
  });
  it('satır: tutar − Σiskonto + Σmasraf; sth_masraf_vergi / _pntr ve isk_mas bayrakları GİRMEZ; sth_tutar yoksa null', () => {
    const r = satirNetSql(['sth_tutar', 'sth_iskonto1', 'sth_iskonto2', 'sth_masraf1', 'sth_masraf_vergi', 'sth_masraf_vergi_pntr', 'sth_isk_mas1']);
    expect(r).toEqual({
      ifade: 'sth_tutar - (ISNULL(sth_iskonto1, 0) + ISNULL(sth_iskonto2, 0)) + (ISNULL(sth_masraf1, 0))',
      iskonto: ['sth_iskonto1', 'sth_iskonto2'], masraf: ['sth_masraf1'],
    });
    expect(satirNetSql(['sth_tutar'])?.ifade).toBe('sth_tutar');
    expect(satirNetSql(['sth_iskonto1'])).toBeNull();
  });
  it('yalnız ASCII SQL (T-SQL U+2212 eksi işaretini tanımaz)', () => {
    const sql = [baslikMatrahSql(['cha_aratoplam', 'cha_ft_iskonto1']), satirNetSql(['sth_tutar', 'sth_iskonto1', 'sth_masraf1'])?.ifade].join(' ');
    expect(sql).not.toMatch(/[^\x00-\x7F]/);
  });
});
