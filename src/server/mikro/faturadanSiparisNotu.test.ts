import { describe, it, expect } from 'vitest';
import { ilkBes, kaynaksizNotu, kaynaksizAdetiOku, kaynaksizIsaretNotu, kaynaksizEsikNotu } from './faturadanSiparisNotu';

// Şartname «Mikro bağlantı A» A8.3 (2026-11-05): üretici ve ayrıştırıcı BİRLİKTE çitli; metin değişirse sayı sessizce null'a düşmesin.
describe('kaynaksizNotu / kaynaksizAdetiOku · tek modül, birlikte çitli', () => {
  it('üreticinin çıktısını ayrıştırıcı geri okur (7 → 7; 1 → 1); gece özetinin ortasında da bulunur', () => {
    const adlar = ['MF-1', 'MF-2', 'MF-3', 'MF-4', 'MF-5', 'MF-6', 'MF-7'];
    expect(kaynaksizAdetiOku(kaynaksizNotu(7, adlar))).toBe(7);
    expect(kaynaksizAdetiOku(kaynaksizNotu(1, ['MF-325']))).toBe(1);
    expect(kaynaksizAdetiOku(`3 sipariş türetildi — x · ${kaynaksizNotu(12, adlar)} · y`)).toBe(12);
  });
  it('metin 2026-11-05 öncesi satır içi metinle BAYT BAYT aynı (canlı günlük okuyucuları, panel parçalayıcısı)', () => {
    expect(kaynaksizNotu(2, ['MF-325', 'MF-401']))
      .toBe('⚠ 2 MF siparişinin kaynağı Mikro fatura listesinde yok (silinmiş olabilir): MF-325, MF-401 — durum değiştirilmedi');
    expect(kaynaksizNotu(6, ['a', 'b', 'c', 'd', 'e', 'f'])).toContain(': a, b, c, d, e … — durum');
  });
  it('parça yoksa / metin değilse null (0 DEĞİL)', () => {
    expect(kaynaksizAdetiOku('⚠ 1 fatura bekletildi: …')).toBeNull();
    expect(kaynaksizAdetiOku('')).toBeNull();
    expect(kaynaksizAdetiOku(undefined)).toBeNull();
    expect(kaynaksizAdetiOku(42)).toBeNull();
  });
  it('ilkBes: ilk beş + « …» (mikroRoutes notlarının ortak biçimi)', () => {
    expect(ilkBes(['a', 'b'])).toBe('a, b');
    expect(ilkBes(['a', 'b', 'c', 'd', 'e', 'f'])).toBe('a, b, c, d, e …');
    expect(ilkBes([])).toBe('');
  });
});

// Şartname «Mikro bağlantı B» BH21: işaret notları da bu modülde; ayrıştırıcı yalnız ADAY sayısını okur. Mutasyon (yapılıp geri
// alındı): `kaynaksizAdetiOku` parça seçicisi kaldırılıp «ilk sayı» okunursa ilk iddia 2 döner → kırmızı.
describe('kaynaksizIsaretNotu / kaynaksizEsikNotu · ayrıştırıcı çiti (BH21)', () => {
  it('birleşik özette ayrıştırıcı ADAY sayısını okur (7); işaret ve eşik notunu tek başına okumaz (null)', () => {
    expect(kaynaksizAdetiOku([kaynaksizIsaretNotu(2, 1), kaynaksizNotu(7, ['MF-1'])].join(' · '))).toBe(7);
    expect(kaynaksizAdetiOku([kaynaksizNotu(7, ['MF-1']), kaynaksizIsaretNotu(2, 1)].join(' · '))).toBe(7);
    expect(kaynaksizAdetiOku(kaynaksizIsaretNotu(2, 1))).toBeNull();
    expect(kaynaksizAdetiOku(kaynaksizEsikNotu(11, 10))).toBeNull();
  });
  it('metinler: işaret ve eşik notu; yeni metinde uzun tire yok (A kural 10)', () => {
    expect(kaynaksizIsaretNotu(2, 1)).toBe('2 kaynaksız işaretlendi, 1 işaret kaldırıldı');
    expect(kaynaksizEsikNotu(11, 10)).toBe('⚠ olağandışı: 11 kaynaksız · işaret yazılmadı (eşik 10)');
    expect(kaynaksizIsaretNotu(0, 0) + kaynaksizEsikNotu(1, 1)).not.toContain('—');
  });
});
