/**
 * durumEtiketi.test.ts — slug → EKRAN ETİKETİ (Faz 1 3/n, 2026-09-05).
 *
 * Kilitlenen dersler: (1) `status` verisi İngilizce sabit, ekranda "Delivered" sızıyordu;
 * (2) `faturaTipi` ASCII slug ('e-arsiv') — büyütmek 'E-ARSİV' verir, doğrusu 'E-ARŞİV',
 * eksik 'ş'yi hiçbir casing geri getiremez → EŞLEME şart; (3) `priority` İngilizce enum —
 * Türkçe casing 'HİGH' üretirdi → çeviri. Bilinmeyen değer HAM döner (sahte kesinlik yok).
 */
import { describe, it, expect } from 'vitest';
import { siparisDurumEtiketi, sevkiyatDurumEtiketi, faturaTipiEtiketi, oncelikEtiketi, odemeDurumuEtiketi, kargoDurumuEtiketi } from './durumEtiketi';

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

// ── Çevrim içi mağaza (Shopify) durumları — Online Siparişler ekranı (2026-10-02) ──────────
describe('odemeDurumuEtiketi — Shopify financial_status', () => {
  it('TR: yedi durumun yedisi de Türkçe (ö/ı/İ tam)', () => {
    expect(odemeDurumuEtiketi('pending', 'tr')).toBe('Ödeme bekliyor');
    expect(odemeDurumuEtiketi('authorized', 'tr')).toBe('Provizyon alındı');
    expect(odemeDurumuEtiketi('partially_paid', 'tr')).toBe('Kısmen ödendi');
    expect(odemeDurumuEtiketi('paid', 'tr')).toBe('Ödendi');
    expect(odemeDurumuEtiketi('partially_refunded', 'tr')).toBe('Kısmen iade edildi');
    expect(odemeDurumuEtiketi('refunded', 'tr')).toBe('İade edildi');
    expect(odemeDurumuEtiketi('voided', 'tr')).toBe('Geçersiz kılındı');
  });
  it('EN: çeviri (ham slug DEĞİL — alt çizgi ekrana sızmaz)', () => {
    expect(odemeDurumuEtiketi('partially_paid', 'en')).toBe('Partially paid');
    expect(odemeDurumuEtiketi('paid', 'en')).toBe('Paid');
    expect(odemeDurumuEtiketi('pending', 'en')).toBe('Payment pending');
  });
  it('bilinmeyen değer HAM döner — büyütülmez, çevrilmiş gibi yapılmaz', () => {
    expect(odemeDurumuEtiketi('chargeback_pending', 'tr')).toBe('chargeback_pending');
    expect(odemeDurumuEtiketi('chargeback_pending', 'en')).toBe('chargeback_pending');
    expect(odemeDurumuEtiketi('Paid', 'tr')).toBe('Paid');   // büyük/küçük harf farkı: birlik dışı → ham
  });
  it("null / undefined / boş → '—' (bilinmiyor; 'Ödeme bekliyor' UYDURULMAZ)", () => {
    expect(odemeDurumuEtiketi(null, 'tr')).toBe('—');
    expect(odemeDurumuEtiketi(undefined, 'tr')).toBe('—');
    expect(odemeDurumuEtiketi('', 'en')).toBe('—');
    expect(odemeDurumuEtiketi('   ', 'tr')).toBe('—');
  });
  it('prototip anahtarı eşleşme sayılmaz (dış sistem metni: "constructor" → ham)', () => {
    expect(odemeDurumuEtiketi('constructor', 'tr')).toBe('constructor');
    expect(odemeDurumuEtiketi('toString', 'en')).toBe('toString');
  });
});

describe('kargoDurumuEtiketi — Shopify fulfillment_status', () => {
  it("null BİLİNEN değerdir: Shopify gönderilmemiş siparişi null ile söyler → 'Hazırlanmadı'", () => {
    expect(kargoDurumuEtiketi(null, 'tr')).toBe('Hazırlanmadı');
    expect(kargoDurumuEtiketi(null, 'en')).toBe('Unfulfilled');
    expect(kargoDurumuEtiketi('unfulfilled', 'tr')).toBe('Hazırlanmadı');
  });
  it('TR / EN: partial, fulfilled, restocked', () => {
    expect(kargoDurumuEtiketi('partial', 'tr')).toBe('Kısmen gönderildi');
    expect(kargoDurumuEtiketi('fulfilled', 'tr')).toBe('Gönderildi');
    expect(kargoDurumuEtiketi('restocked', 'tr')).toBe('Stoğa geri alındı');
    expect(kargoDurumuEtiketi('partial', 'en')).toBe('Partially fulfilled');
    expect(kargoDurumuEtiketi('fulfilled', 'en')).toBe('Fulfilled');
    expect(kargoDurumuEtiketi('restocked', 'en')).toBe('Restocked');
  });
  it("undefined / boş → '—' (alan hiç yazılmamış: 'Hazırlanmadı' DENMEZ)", () => {
    expect(kargoDurumuEtiketi(undefined, 'tr')).toBe('—');
    expect(kargoDurumuEtiketi('', 'tr')).toBe('—');
    expect(kargoDurumuEtiketi('  ', 'en')).toBe('—');
  });
  it('bilinmeyen değer HAM döner, büyütülmez', () => {
    expect(kargoDurumuEtiketi('in_progress', 'tr')).toBe('in_progress');
    expect(kargoDurumuEtiketi('hasOwnProperty', 'tr')).toBe('hasOwnProperty');
  });
});
