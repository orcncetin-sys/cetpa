/**
 * zaman.ekran.test.ts — tarih GÖSTERİM tek kaynağı (Faz 2 2/n, 2026-09-12). ÖNCE YAZILDI.
 *
 * Faz 0 ölçümü: tarih parse/biçimi ~117 yerde elle (yerel `toDate` kopyaları, `toLocaleDateString('tr-TR')`,
 * `toISOString().slice(0,10)`). Kopyaların ortak arızaları: Timestamp'e `new Date(ts)` → "Invalid Date";
 * çözülemeyen tarih `?? new Date()` ile BUGÜN olur; `toISOString().slice(0,10)` UTC günü verir (TR'de 00:00-03:00
 * arası DÜNÜ yazar). Bu dosya üç fonksiyonun sözleşmesini kilitler:
 *   tarihYaz(v, intlSecenek?)      → zamanDate + toLocaleDateString('tr-TR'); çözülemezse '—'
 *   tarihSaatYaz(v, intlSecenek?)  → toLocaleString('tr-TR') karşılığı; çözülemezse '—'
 *   bugunAnahtari(simdi?)          → YEREL 'YYYY-MM-DD' (input[type=date] varsayılanı; UTC değil)
 * Görünüm mevcut satır içi çağrılarla AYNI (tr-TR varsayılanı 'GG.AA.YYYY'; Intl seçenekleri aynen geçer).
 */
import { describe, it, expect } from 'vitest';
import { tarihYaz, tarihSaatYaz, bugunAnahtari, gunAnahtari } from './zaman';

describe('tarihYaz', () => {
  it("ISO / Timestamp zarfı / Date / epoch → 'GG.AA.YYYY' (tr-TR varsayılanı)", () => {
    expect(tarihYaz('2026-09-05T10:00:00Z')).toBe('05.09.2026');
    expect(tarihYaz({ _seconds: Math.floor(Date.UTC(2026, 8, 5, 10) / 1000), _nanoseconds: 0 })).toBe('05.09.2026');   // 2026-09-05T10:00Z (fikstür hatası: elle yazılan epoch 2025'ti)
    expect(tarihYaz(new Date(2026, 8, 5))).toBe('05.09.2026');
    expect(tarihYaz(new Date(2026, 8, 5).getTime())).toBe('05.09.2026');
  });
  it("Intl seçenekleri aynen geçer ('5 Eyl', '5 Eylül 2026', 'Eyl 2026')", () => {
    expect(tarihYaz('2026-09-05', { day: 'numeric', month: 'short' })).toBe('5 Eyl');
    expect(tarihYaz('2026-09-05', { day: 'numeric', month: 'long', year: 'numeric' })).toBe('5 Eylül 2026');
    expect(tarihYaz('2026-09-05', { month: 'short', year: 'numeric' })).toBe('Eyl 2026');
  });
  it("çözülemeyen (undefined/null/''/'abc'/sentinel) → '—'; asla 'Invalid Date' ya da BUGÜN", () => {
    for (const v of [undefined, null, '', 'abc', { __op: 'serverTimestamp' }, NaN]) expect(tarihYaz(v)).toBe('—');
  });
  it('Türk biçimi string (05.09.2026) ay/gün TERS okunmaz', () => {
    expect(tarihYaz('05.09.2026')).toBe('05.09.2026');
  });
});

describe('tarihYaz / tarihSaatYaz — dil parametresi (arayüz EN ise en-US)', () => {
  it("üçüncü parametre 'en' → en-US biçimi ('Sep', '9/5/2026'); varsayılan 'tr'", () => {
    expect(tarihYaz('2026-09-05', { month: 'short' }, 'en')).toBe('Sep');
    expect(tarihYaz('2026-09-05', { month: 'short' }, 'tr')).toBe('Eyl');
    expect(tarihYaz('2026-09-05', undefined, 'en')).toBe('9/5/2026');
    expect(tarihSaatYaz(new Date(2026, 8, 5, 14, 7), { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }, 'en')).toBe('Sep 5, 02:07 PM');
    expect(tarihYaz(undefined, undefined, 'en')).toBe('—');
  });
});

describe('tarihSaatYaz', () => {
  it("varsayılan: 'GG.AA.YYYY SS:DD' (saniye YOK — ekranlarda böyle basılıyordu)", () => {
    expect(tarihSaatYaz(new Date(2026, 8, 5, 14, 7))).toBe('05.09.2026 14:07');
  });
  it("Intl seçenekleri geçer ('5 Eyl 14:07'); çözülemeyen '—'", () => {
    expect(tarihSaatYaz(new Date(2026, 8, 5, 14, 7), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })).toBe('5 Eyl 14:07');
    expect(tarihSaatYaz(undefined)).toBe('—');
  });
});

describe('bugunAnahtari — YEREL gün (UTC tuzağı yok)', () => {
  it("TR'de gece 01:00 → toISOString dünü verir, bugunAnahtari bugünü", () => {
    const geceBir = new Date(2026, 8, 5, 1, 0);   // yerel 05.09.2026 01:00
    expect(bugunAnahtari(geceBir)).toBe('2026-09-05');
    expect(bugunAnahtari(geceBir)).toBe(gunAnahtari(geceBir));
    // UTC+3'te toISOString 2026-09-04T22:00Z → '2026-09-04' verirdi (makine TR saatindeyse); iddia yerel anahtar
    expect(bugunAnahtari(new Date(2026, 11, 31, 23, 59))).toBe('2026-12-31');
  });
});
