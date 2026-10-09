/**
 * isimAnahtari.test.ts — Türkçe isim eşleştirme anahtarı + "kopya kalmadı" değişmezi (4/n, 2026-09-05).
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, statSync } from 'fs';
import { join } from 'path';
import { kodSatirlari } from '../test/kaynakTarama';
import { isimAnahtari, firmaAnahtari } from './isimAnahtari';

describe('isimAnahtari', () => {
  it("'ŞİRİN YAPI' ↔ 'Şirin Yapı' aynı anahtar (toLowerCase ile eşleşmiyordu)", () => {
    expect(isimAnahtari('ŞİRİN YAPI')).toBe('şirin yapı');
    expect(isimAnahtari('Şirin Yapı')).toBe(isimAnahtari('ŞİRİN YAPI'));
    expect('ŞİRİN YAPI'.toLowerCase()).not.toBe('şirin yapı');   // eski yolun neden kırıldığının kanıtı
  });
  it("'ISI YALITIM' → 'ısı yalıtım' (noktasız I); boşluk kırpılır; null/undefined → ''", () => {
    expect(isimAnahtari('ISI YALITIM A.Ş.')).toBe('ısı yalıtım a.ş.');
    expect(isimAnahtari('  Akdeniz İnşaat ')).toBe('akdeniz inşaat');
    expect(isimAnahtari(null)).toBe('');
    expect(isimAnahtari(undefined)).toBe('');
  });
});

describe('firmaAnahtari — company önce, name yalnız company boşsa', () => {
  it("elle lead {name:'Ahmet Yılmaz', company:'Beta İnşaat'} → 'beta i\u0307nşaat' değil 'beta inşaat'; Mikro {name=company='BETA İNŞAAT'} ile eşleşir; şahıs carisi 'AHMET YILMAZ' ile EŞLEŞMEZ", () => {
    expect(firmaAnahtari({ name: 'Ahmet Yılmaz', company: 'Beta İnşaat' })).toBe('beta inşaat');
    expect(firmaAnahtari({ name: 'BETA İNŞAAT', company: 'BETA İNŞAAT' })).toBe('beta inşaat');
    expect(firmaAnahtari({ name: 'AHMET YILMAZ', company: 'AHMET YILMAZ' })).not.toBe(firmaAnahtari({ name: 'Ahmet Yılmaz', company: 'Beta İnşaat' }));
    expect(firmaAnahtari({ name: 'Şirin Yapı' })).toBe('şirin yapı');
    expect(firmaAnahtari({})).toBe('');
  });
});

describe('DEĞİŞMEZ: sunucu tarafında isim anahtarı elle üretilmiyor', () => {
  const dosyalar: string[] = [];
  const tara = (d: string) => { for (const ad of readdirSync(d)) { const p = join(d, ad); if (statSync(p).isDirectory()) tara(p); else if (/\.ts$/.test(ad) && !/\.test\.ts$/.test(ad)) dosyalar.push(p); } };
  tara(join(__dirname, '..', 'server'));
  it("`nameKey = …toLowerCase()` / `toLocaleLowerCase` kalıntısı YOK — hepsi isimAnahtari (kod-hariç süzgeç: yorumlar sayılmaz)", () => {
    expect(dosyalar.length).toBeGreaterThan(5);
    const suclular: string[] = [];
    for (const p of dosyalar) {
      for (const { n, kod } of kodSatirlari(p)) {
        if (/nameKey\s*=.*\.to(Locale)?LowerCase\(/.test(kod)) suclular.push(`${p.split('/src/')[1]}:${n}`);
      }
    }
    expect(suclular).toEqual([]);
  }, 60_000);   // src/server'ın tamamı tek testte ayrıştırılır
});
