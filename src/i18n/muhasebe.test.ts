/**
 * muhasebe.test.ts — MuhasebePage'in KENDİ sözlüğünün sözleşmesi (Faz 3 1/n, 2026-09-14).
 *
 * Sözlük ÜRETİLMİŞTİR (scripts/modul-sozluk-kodmod.py: 362 satır içi çift → 345 anahtar); bu test üretimin
 * sözleşmesini korur: iki dil de dolu, anahtar kümeleri birebir, yerel kodu/şablon ifadesi sözlükte değil,
 * `mc()` hem dil kodunu ('tr'|'en') hem eski boolean bayrağı (`tr580`) alır, ortak sözlükle çakışma yok.
 */
import { describe, it, expect } from 'vitest';
import { mc, MUHASEBE, type MuhasebeAnahtar } from './muhasebe';
import { ORTAK } from './ortak';

describe('mc — Muhasebe modül sözlüğü', () => {
  it("'tr' / true → Türkçe, 'en' / false → İngilizce (kodmod her çağrı biçimini tek satırda değiştirir)", () => {
    expect(mc('tr').kdv_haric_ciro).toBe('KDV Hariç Ciro');
    expect(mc(true).kdv_haric_ciro).toBe('KDV Hariç Ciro');
    expect(mc('en').kdv_haric_ciro).toBe('Net Revenue');
    expect(mc(false).kdv_haric_ciro).toBe('Net Revenue');
    expect(mc('tr').tahsilat_hatirlatma_otomasyonu).toBe('Tahsilat Hatırlatma Otomasyonu');
  });
  it('her anahtar iki dilde de DOLU; anahtar kümeleri birebir', () => {
    const anahtarlar = Object.keys(MUHASEBE.tr) as MuhasebeAnahtar[];
    expect(anahtarlar.length).toBeGreaterThan(300);
    for (const k of anahtarlar) {
      expect(MUHASEBE.tr[k], `tr.${k}`).toBeTruthy();
      expect(MUHASEBE.en[k], `en.${k}`).toBeTruthy();
    }
    expect(Object.keys(MUHASEBE.en).sort()).toEqual(anahtarlar.slice().sort());
  });
  it("yerel kodları ('tr'/'en', 'tr-TR'/'en-US') ve şablon ifadeleri (${…}) sözlükte DEĞİL — bunlar çeviri değil", () => {
    const degerler = [...Object.values(MUHASEBE.tr), ...Object.values(MUHASEBE.en)] as string[];
    for (const v of ['tr', 'en', 'tr-TR', 'en-US', 'TR', 'EN']) expect(degerler, v).not.toContain(v);
    expect(degerler.filter(v => v.includes('${'))).toEqual([]);
  });
  it("Türkçe metnin slug'ı ASCII anahtar: 'KDV Hariç Ciro' → kdv_haric_ciro; kesme işaretli metin korunur", () => {
    expect(Object.keys(MUHASEBE.tr).every(k => /^[a-z0-9_]+$/.test(k))).toBe(true);
    expect(MUHASEBE.tr.fatura_kdv_si_bilinmiyor).toBe("fatura KDV'si bilinmiyor");
  });
  it('ortak sözlükle ÇAKIŞMAZ: aynı (tr, en) çifti iki sözlükte birden olmaz (ortak kodmod önce koşar)', () => {
    const ortak = new Set(Object.keys(ORTAK.tr).map(k => `${ORTAK.tr[k as keyof typeof ORTAK.tr]}\u0000${ORTAK.en[k as keyof typeof ORTAK.en]}`));
    const cakisan = (Object.keys(MUHASEBE.tr) as MuhasebeAnahtar[]).filter(k => ortak.has(`${MUHASEBE.tr[k]}\u0000${MUHASEBE.en[k]}`));
    expect(cakisan).toEqual([]);
  });
});
