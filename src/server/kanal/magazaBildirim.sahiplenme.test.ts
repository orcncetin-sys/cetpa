// @vitest-environment node
/**
 * magazaBildirim.sahiplenme.test.ts — işçinin süreç içi sahiplenme ANAHTARI (dilim 2a, şartname § 2.10; K9 / Y6).
 *
 * Kural: `gonderimde` kümesine çıplak `talepId` YAZILMAZ; anahtar `talepId + '|' + tur`dur ve 2a'da tek tür `ilk`tir.
 * 2a'da işçinin DAVRANIŞI değişmez (aynı talep aynı süreçte eşzamanlı iki kez gönderilmez — o davranış
 * magazaBildirim.test.ts «süreç içi sahiplenme» bloğunda sınanır ve bu değişiklikten sonra da aynen geçer). Anahtarın
 * biçimi dışarıdan gözlenemez (2a'da ikinci tür yok); bu yüzden kural KAYNAKTA kilitlenir: 2b `revize` türünü eklediğinde
 * aynı talebin ilk ve revize bildirimi birbirini düşürmesin diye tür anahtarın parçası olarak kalmalıdır.
 */
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { kodSatirlari, SRC_KOK } from '../../test/kaynakTarama';

const kod = kodSatirlari(join(SRC_KOK, 'server', 'kanal', 'magazaBildirim.ts')).map(s => s.kod);
const metin = kod.join('\n');

describe('magazaBildirim.ts — sahiplenme anahtarı `talepId|tur` (kaynak çiti)', () => {
  it('kümeye çıplak `talepId` ile `has` / `add` / `delete` YOK', () => {
    expect(kod.filter(s => /gonderimde\.(has|add|delete)\(\s*talepId\s*\)/.test(s))).toEqual([]);
  });

  it('küme üç yerde kullanılır (sor · al · bırak) ve üçü de AYNI üreticiden gelen anahtarla', () => {
    const kullanim = kod.filter(s => /gonderimde\.(has|add|delete)\(/.test(s)).map(s => s.trim());
    expect(kullanim).toHaveLength(3);
    expect(kullanim.filter(s => s.includes('gonderimde.has(anahtar)'))).toHaveLength(1);
    expect(kullanim.filter(s => s.includes('gonderimde.add(anahtar)'))).toHaveLength(1);
    expect(kullanim.filter(s => s.includes("gonderimde.delete(sahiplenmeAnahtari(talepId, 'ilk'))"))).toHaveLength(1);
    // `anahtar` sahiplenmeden HEMEN önce, aynı üreticiyle ve aynı türle kurulur.
    const al = kod.findIndex(s => s.includes('gonderimde.has(anahtar)'));
    expect(kod[al - 1].trim()).toBe("const anahtar = sahiplenmeAnahtari(talepId, 'ilk');");
  });

  it('üretici anahtarı `talepId|tur` biçiminde kurar; 2a\'da tür kümesi yalnız `ilk` (2b `revize`yi ekler)', () => {
    expect(metin).toContain('const sahiplenmeAnahtari = (talepId: string, tur: BildirimTuru): string => `${talepId}|${tur}`;');
    expect(metin).toContain("type BildirimTuru = 'ilk';");
    expect(metin).not.toMatch(/'revize'/);   // 2b bu dilimde YAZILMAZ
    // Üreticinin TEK tanımı ve iki çağrısı (al + bırak): başka yerde elle `talepId + '|'` birleştirmesi yok.
    expect(metin.split('sahiplenmeAnahtari(').length - 1).toBe(2);
    expect(metin).not.toMatch(/talepId\s*\+\s*['"`]\|/);
  });

  it('kuyruk iş verisi DEĞİŞMEDİ: yalnız `{ talepId }` (tür iş verisine girmez; 2a\'da kuyruk tek türdür)', () => {
    expect(metin).toMatch(/\{ talepId \}/);
    expect(metin).not.toMatch(/\{ talepId, tur\b/);
  });
});
