/**
 * faturaEvrakKosulu.test.ts: «bu Mikro cari hareketi fatura mı, hangi tür» kuralının çiti (şartname «Mikro bağlantı A» A6.5,
 * 2026-11-05). Dosyanın ve `seriOzet.ts`'in yorumları «eşitlik `faturaEvrakKosulu.test.ts`'te çitli» diyordu ama böyle bir dosya
 * yoktu (`git ls-files | grep faturaEvrakKosulu` yalnız modülü döndürdü). Burada iki şey kilitlenir:
 *   1. `faturaTuruEvraktan` tablosu (tipe dayanıklı: metin, boşluklu metin, ondalıklı sayı);
 *   2. SQL ifadesi (`seriOzet.faturaKosuluIfadesi`) BAYT BAYT beklenen metin VE JS yüklemi aynı örneklerde aynı kararı verir.
 */
import { describe, it, expect } from 'vitest';
import { faturaEvrakiMi, faturaTuruEvraktan } from './faturaEvrakKosulu';
import { faturaKosuluIfadesi } from '../server/mikro/seriOzet';

describe('faturaTuruEvraktan · evrak tipi + cinsi → satış / alış / fatura değil', () => {
  it.each([
    [63, 0, 'satis'],
    [63, 6, 'satis'],
    ['63', undefined, 'satis'],
    [' 63', null, 'satis'],
    [63.0, 8, 'satis'],
    [0, 6, 'alis'],
    ['0', '6', 'alis'],
    [0, ' 6', 'alis'],
    [0, 8, null],          // cinsi 8: hizmet / masraf olabilir, kanıt yok ([15] kullanıcıda)
    [0, 14, null],
    [0, 15, null],
    [0, undefined, null],
    [1, 6, null],          // evrak tipi 1: fatura değil
    [29, 0, null],
    [null, 6, null],
    [undefined, undefined, null],
  ] as const)('(%s, %s) → %s', (tip, cinsi, beklenen) => {
    expect(faturaTuruEvraktan(tip, cinsi)).toBe(beklenen);
  });

  it('`faturaEvrakiMi` ile AYNI küme: tür null değilse ve yalnız o zaman fatura', () => {
    for (const [tip, cinsi] of [[63, 0], [0, 6], [0, 8], [1, 6], ['0', '6'], [null, null]] as const) {
      expect(faturaTuruEvraktan(tip, cinsi) !== null).toBe(faturaEvrakiMi(tip, cinsi));
    }
  });
});

describe('ÇİT · SQL ifadesi ile JS yüklemi aynı küme', () => {
  it('`faturaKosuluIfadesi(cha_evrak_tip, cha_cinsi)` bayt bayt beklenen metin (mikroRoutes `FATURA_EVRAK_KOSULU` bundan türer)', () => {
    expect(faturaKosuluIfadesi('cha_evrak_tip', 'cha_cinsi')).toBe('(cha.cha_evrak_tip = 63 OR (cha.cha_evrak_tip = 0 AND cha.cha_cinsi = 6))');
  });

  // SQL'in kararı: yalnız iki dal (63) ya da (0 VE 6). Aynı örneklerde JS yüklemi aynı kararı vermeli.
  const sqlKarari = (tip: number, cinsi: number) => tip === 63 || (tip === 0 && cinsi === 6);
  it.each([[63, 0], [63, 6], [0, 6], [0, 8], [0, 0], [1, 6], [6, 0], [64, 6]])('(%s, %s) · SQL ve JS aynı', (tip, cinsi) => {
    expect(faturaEvrakiMi(tip, cinsi)).toBe(sqlKarari(tip, cinsi));
  });
});
