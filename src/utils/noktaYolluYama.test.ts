import { describe, it, expect } from 'vitest';
import { noktaYolluYama } from './noktaYolluYama';
import { mergeDocData } from '../server/pgShim';

describe('noktaYolluYama — iç içe ayarı bütün ezmeden kaydet (2026-10-02)', () => {
  it('yalnız dokunulan alanlar nokta-yollu anahtar olur; boş durum BOŞ yama üretir (istek gitmez)', () => {
    expect(noktaYolluYama('companySettings', { signature: 'CETPA A.Ş.', iban: '' })).toEqual({
      'companySettings.signature': 'CETPA A.Ş.', 'companySettings.iban': '',
    });
    expect(noktaYolluYama('companySettings', {})).toEqual({});
    expect(noktaYolluYama('companySettings', { a: undefined })).toEqual({});
  });
  it('sunucunun birleştirmesiyle: kayıtlı diğer alanlar (erişim belirteci, IBAN) YERİNDE kalır', () => {
    const onceki = { companySettings: { shopify_access_token: 'gizli', iban: 'TR00', signature: 'eski' }, baska: 1 };
    const sonuc = mergeDocData(onceki, noktaYolluYama('companySettings', { signature: 'yeni' }));
    expect(sonuc).toEqual({ companySettings: { shopify_access_token: 'gizli', iban: 'TR00', signature: 'yeni' }, baska: 1 });
    // Eski davranışın kanıtı: nesneyi bütün göndermek diğer alanları siler.
    expect(mergeDocData(onceki, { companySettings: { signature: 'yeni' } })).toEqual({ companySettings: { signature: 'yeni' }, baska: 1 });
  });
  it('alan adında nokta varsa fırlatır — yama başka bir yola yazılmasın', () => {
    expect(() => noktaYolluYama('companySettings', { 'a.b': 1 })).toThrow(/nokta/);
  });
});
