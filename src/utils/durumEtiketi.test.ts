/**
 * durumEtiketi.test.ts — slug → EKRAN ETİKETİ (Faz 1 3/n, 2026-09-05).
 *
 * Kilitlenen dersler: (1) `status` verisi İngilizce sabit, ekranda "Delivered" sızıyordu;
 * (2) `faturaTipi` ASCII slug ('e-arsiv') — büyütmek 'E-ARSİV' verir, doğrusu 'E-ARŞİV',
 * eksik 'ş'yi hiçbir casing geri getiremez → EŞLEME şart; (3) `priority` İngilizce enum —
 * Türkçe casing 'HİGH' üretirdi → çeviri. Bilinmeyen değer HAM döner (sahte kesinlik yok).
 */
import { describe, it, expect } from 'vitest';
import { siparisDurumEtiketi, sevkiyatDurumEtiketi, faturaTipiEtiketi, oncelikEtiketi } from './durumEtiketi';

describe('siparisDurumEtiketi / sevkiyatDurumEtiketi', () => {
  it("TR: beş sipariş durumu Türkçe (İ/ı doğru: 'Teslim Edildi', 'İptal Edildi', 'Hazırlanıyor')", () => {
    expect(siparisDurumEtiketi('Delivered', 'tr')).toBe('Teslim Edildi');
    expect(siparisDurumEtiketi('Cancelled', 'tr')).toBe('İptal Edildi');
    expect(siparisDurumEtiketi('Processing', 'tr')).toBe('Hazırlanıyor');
    expect(siparisDurumEtiketi('Pending', 'tr')).toBe('Bekliyor');
    expect(siparisDurumEtiketi('Shipped', 'tr')).toBe('Kargoda');
  });
  it('EN: ham değer aynen', () => {
    expect(siparisDurumEtiketi('Delivered', 'en')).toBe('Delivered');
  });
  it('sevkiyat birliği AYRI: In Transit → Yolda; sipariş sözlüğüne sızmaz', () => {
    expect(sevkiyatDurumEtiketi('In Transit', 'tr')).toBe('Yolda');
    expect(siparisDurumEtiketi('In Transit', 'tr')).toBe('In Transit');   // sipariş birliğinde yok → ham
  });
  it('bilinmeyen / boş / null → ham (Mikro\'dan birlik dışı değer gelirse boş rozet yerine görünür bilinmezlik)', () => {
    expect(siparisDurumEtiketi('Beklemede', 'tr')).toBe('Beklemede');
    expect(siparisDurumEtiketi(undefined, 'tr')).toBe('');
    expect(siparisDurumEtiketi(null, 'tr')).toBe('');
  });
});

describe('faturaTipiEtiketi — slug büyütülmez, EŞLENİR', () => {
  it("'e-arsiv' → 'E-ARŞİV' (ş ile; 'E-ARSİV' değil), 'ihracat' → 'İHRACAT', 'e-fatura' → 'E-FATURA'", () => {
    expect(faturaTipiEtiketi('e-arsiv', 'tr')).toBe('E-ARŞİV');
    expect(faturaTipiEtiketi('e-arsiv', 'tr')).not.toBe('E-ARSİV');
    expect(faturaTipiEtiketi('ihracat', 'tr')).toBe('İHRACAT');
    expect(faturaTipiEtiketi('e-fatura', 'tr')).toBe('E-FATURA');
  });
  it('EN karşılıkları', () => {
    expect(faturaTipiEtiketi('e-arsiv', 'en')).toBe('E-ARCHIVE');
    expect(faturaTipiEtiketi('ihracat', 'en')).toBe('EXPORT');
  });
  it('bilinmeyen slug ham ve BÜYÜTÜLMEDEN döner', () => {
    expect(faturaTipiEtiketi('proforma', 'tr')).toBe('proforma');
    expect(faturaTipiEtiketi(null, 'tr')).toBe('');
  });
});

describe('oncelikEtiketi — İngilizce enum çevrilir, Türkçe casing uygulanmaz', () => {
  it("high → YÜKSEK / HIGH; 'HİGH' asla", () => {
    expect(oncelikEtiketi('high', 'tr')).toBe('YÜKSEK');
    expect(oncelikEtiketi('high', 'en')).toBe('HIGH');
    expect(oncelikEtiketi('medium', 'tr')).toBe('ORTA');
    expect(oncelikEtiketi('low', 'tr')).toBe('DÜŞÜK');
  });
  it('bilinmeyen → ham', () => { expect(oncelikEtiketi('urgent', 'tr')).toBe('urgent'); });
});
