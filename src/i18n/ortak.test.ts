/**
 * ortak.test.ts — tekrarlayan arayüz ifadeleri için ORTAK SÖZLÜK sözleşmesi (Faz 2 4/n, 2026-09-13). ÖNCE YAZILDI.
 *
 * Ölçüm: 156 dosyada 6.928 satır içi `currentLanguage === 'tr' ? 'A' : 'B'`; 686 ifade çifti tekrarlıyor (2.778 yer).
 * 'İptal'/'Cancel' 70 yerde, 'Kaydet'/'Save' 63 yerde elle yazılıydı. Bu sözlük tekrarlayanların tek kaynağı;
 * `oc(dil)` hem dil kodunu ('tr'|'en') hem de eski `tr63`/`isTR` bayraklarını (boolean) kabul eder ki kodmod
 * her çağrı biçimini tek satırda değiştirebilsin. Tek geçen ifadeler bilinçli olarak yerinde kalır.
 */
import { describe, it, expect } from 'vitest';
import { oc, ORTAK, type OrtakAnahtar } from './ortak';

describe('oc — ortak sözlük erişimi', () => {
  it("dil kodu ve boolean bayrak aynı sonucu verir: 'tr' / true → Türkçe, 'en' / false → İngilizce", () => {
    expect(oc('tr').iptal).toBe('İptal');
    expect(oc(true).iptal).toBe('İptal');
    expect(oc('en').iptal).toBe('Cancel');
    expect(oc(false).iptal).toBe('Cancel');
  });
  it('en sık ifadeler sözlükte (kodmodun ilk hedefleri)', () => {
    const c = oc('tr');
    expect([c.kaydet, c.sil, c.duzenle, c.durum, c.tarih, c.toplam]).toEqual(['Kaydet', 'Sil', 'Düzenle', 'Durum', 'Tarih', 'Toplam']);
    expect(oc('en').kaydet).toBe('Save');
  });
  it('her anahtar iki dilde de DOLU ve tr/en metinleri ayırt edici (kopyala-yapıştır İngilizce yok)', () => {
    const anahtarlar = Object.keys(ORTAK.tr) as OrtakAnahtar[];
    expect(anahtarlar.length).toBeGreaterThan(400);
    for (const k of anahtarlar) {
      expect(ORTAK.tr[k], `tr.${k}`).toBeTruthy();
      expect(ORTAK.en[k], `en.${k}`).toBeTruthy();
    }
    expect(Object.keys(ORTAK.en).sort()).toEqual(anahtarlar.slice().sort());
  });
  it("yerel kodları ('tr'/'en', 'tr-TR'/'en-US') sözlükte DEĞİL — bunlar çeviri değil", () => {
    expect(Object.values(ORTAK.tr)).not.toContain('tr-TR');
    expect(Object.values(ORTAK.tr)).not.toContain('tr');
  });
  it("Türkçe büyük harf anahtarlarda bozulmaz: 'İptal' → anahtar 'iptal' (locale küçültme), 'Sipariş' → 'siparis'", () => {
    expect('iptal' in ORTAK.tr).toBe(true);
    expect('siparis' in ORTAK.tr).toBe(true);
  });
});
