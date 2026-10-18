/**
 * ettnGirdisi.test.ts — istemci ETTN ön sınaması (şartname «fatura gövde + gece MF» § 9.B B5 / B6, 2026-10-19). Ortak vaka tablosu
 * (`test/ettnVakalari`) — uç (`server/faturaCiftKesim.zincir.test` «VAKA TABLOSU») ve `cetpaEttnAnahtari` (`lib/ettn.test`) AYNI
 * tabloyu koşar; burada istemci yüklemi tablonun `anahtar` sütununa karşı sınanır (birebir). Bileşen düzeyi:
 * `pages/OrdersPage.faturaGonderimi.test.tsx`.
 */
import { describe, it, expect } from 'vitest';
import { ETTN_GIRDI_UZUNLUGU, ettnGecersizMetni, ettnGirdisi, ettnYardimMetni } from './ettnGirdisi';
import { cetpaEttnAnahtari } from '../../lib/ettn';
import { ETTN_VAKALARI } from '../../test/ettnVakalari';

describe('ettnGirdisi — ortak vaka tablosu', () => {
  for (const v of ETTN_VAKALARI) {
    it(`${v.ad}: ${JSON.stringify(v.girdi)}`, () => {
      const g = ettnGirdisi(v.girdi);
      expect(g.anahtar).toBe(v.anahtar);
      expect(g.anahtar).toBe(cetpaEttnAnahtari(v.girdi));   // ölçüt sunucuyla AYNI işlev (kopya yok)
      expect(g.dolu).toBe(v.bos !== true);
      expect(g.gecersiz).toBe(v.bos !== true && v.anahtar === '');
    });
  }
  it('uzunluk tek başına ölçüt DEĞİL: 36 karakterlik sıfır GUID ve tire yeri bozuk değer geçersiz', () => {
    expect(ettnGirdisi('00000000-0000-0000-0000-000000000000')).toEqual({ dolu: true, anahtar: '', gecersiz: true });
    expect(ettnGirdisi('abcdef123-456-7890-abcd-ef1234567890').gecersiz).toBe(true);
  });
  it('`maxLength` parantezli GUID\'i alır (38); iletiler Türkçe tam karakterle', () => {
    expect(ETTN_GIRDI_UZUNLUGU).toBe(38);
    expect(`{${'a'.repeat(36)}}`.length).toBe(ETTN_GIRDI_UZUNLUGU);
    expect(ettnYardimMetni('tr')).toBe('Mikro\'da faturanın ETTN\'si (e-Fatura ekranında)');
    expect(ettnGecersizMetni('tr')).toBe('ETTN geçersiz: Mikro\'da e-Fatura ekranındaki 36 karakterlik ETTN\'yi girin (sıfır ETTN kabul edilmez).');
    expect(ettnGecersizMetni('en')).toMatch(/^Invalid ETTN/);
  });
});
