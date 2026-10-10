/**
 * durumEtiketi.test.ts — slug → EKRAN ETİKETİ (Faz 1 3/n, 2026-09-05).
 *
 * Kilitlenen dersler: (1) `status` verisi İngilizce sabit, ekranda "Delivered" sızıyordu;
 * (2) `faturaTipi` ASCII slug ('e-arsiv') — büyütmek 'E-ARSİV' verir, doğrusu 'E-ARŞİV',
 * eksik 'ş'yi hiçbir casing geri getiremez → EŞLEME şart; (3) `priority` İngilizce enum —
 * Türkçe casing 'HİGH' üretirdi → çeviri. Bilinmeyen değer HAM döner (sahte kesinlik yok).
 */
import { describe, it, expect } from 'vitest';
import {
  siparisDurumEtiketi, sevkiyatDurumEtiketi, faturaTipiEtiketi, oncelikEtiketi, odemeDurumuEtiketi, kargoDurumuEtiketi,
  magazaTalepDurumEtiketi, magazaTalepDurumRengi, magazaKalemTeslimEtiketi, magazaKalemTeslimRengi, MAGAZA_ASAMA_RENGI,
} from './durumEtiketi';
import { MAGAZA_TALEP_ASAMALARI } from '../lib/magazaTalep';

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

// ── Mağaza sipariş talebi aşamaları (dilim 2a, şartname v6 § 5.2) ───────────────────────────────────────────────────
describe('magazaTalepDurumEtiketi / renk tablosu / kalem teslim etiketi', () => {
  it('altı aşamanın etiketi iki dilde — Türkçe harfler tam («Hazırlanıyor», «İptal edildi»)', () => {
    expect(MAGAZA_TALEP_ASAMALARI.map(a => magazaTalepDurumEtiketi(a, 'tr'))).toEqual(['Yeni', 'Teyit edildi', 'Hazırlanıyor', 'Sevk edildi', 'Teslim edildi', 'İptal edildi']);
    expect(MAGAZA_TALEP_ASAMALARI.map(a => magazaTalepDurumEtiketi(a, 'en'))).toEqual(['New', 'Confirmed', 'Preparing', 'Shipped', 'Delivered', 'Cancelled']);
    // Slug ekrana sızmaz: hiçbir etiket saklanan değerin kendisi değildir.
    for (const a of MAGAZA_TALEP_ASAMALARI) for (const dil of ['tr', 'en']) expect(magazaTalepDurumEtiketi(a, dil)).not.toBe(a);
  });

  it('altı sınıflık renk tablosu şartnamedeki zeminlerle; metin sınıfı zeminle aynı tonun koyusu (`*-700`: AA karşıtlık)', () => {
    expect(MAGAZA_ASAMA_RENGI).toEqual({
      yeni: 'bg-red-50 text-red-700',
      teyit: 'bg-yellow-50 text-yellow-700',
      hazirlaniyor: 'bg-blue-50 text-blue-700',
      sevk: 'bg-indigo-50 text-indigo-700',
      teslim: 'bg-green-50 text-green-700',
      iptal: 'bg-gray-100 text-gray-700',
    });
    for (const a of MAGAZA_TALEP_ASAMALARI) {
      expect(magazaTalepDurumRengi(a)).toBe(MAGAZA_ASAMA_RENGI[a]);
      expect(magazaTalepDurumRengi(a)).toMatch(/^bg-(\w+)-(50|100) text-\1-700$/);
    }
    // Altı aşamanın altısı da AYRI renktedir (iki aşama aynı rozetle karışmaz).
    expect(new Set(Object.values(MAGAZA_ASAMA_RENGI)).size).toBe(6);
  });

  it('kalem teslim etiketi «teslim edildi» / «bekliyor» (iki dil); rengi AYNI tablodan — yeni renk eklenmez', () => {
    expect(magazaKalemTeslimEtiketi(true, 'tr')).toBe('teslim edildi');
    expect(magazaKalemTeslimEtiketi(false, 'tr')).toBe('bekliyor');
    expect(magazaKalemTeslimEtiketi(true, 'en')).toBe('delivered');
    expect(magazaKalemTeslimEtiketi(false, 'en')).toBe('pending');
    expect(magazaKalemTeslimRengi(true)).toBe(MAGAZA_ASAMA_RENGI.teslim);
    expect(magazaKalemTeslimRengi(true)).toContain('bg-green-50');
    expect(magazaKalemTeslimRengi(false)).toBe(MAGAZA_ASAMA_RENGI.iptal);
    expect(magazaKalemTeslimRengi(false)).toContain('bg-gray-100');
  });
});
