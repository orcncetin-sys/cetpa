// @vitest-environment node
/**
 * surumluOnbellek.test.ts — ortak sürüm sayaçlı önbelleğin KENDİ kuralları (2026-10-21, Tur 2 A parçası incelemesi). İki okuyucunun
 * (panel kullanıcısı, müşteri bağı) yarış testleri kendi dosyalarında: `kanal/magazaPanelKullanici.test.ts`, `musteriHesap.test.ts`.
 *
 * Mutasyon: `get` içindeki `surum === okumaSurumu` koşulu kaldırılırsa «yarış» testleri kırmızıya döner.
 */
import { describe, expect, it } from 'vitest';
import { surumluOnbellekKur } from './surumluOnbellek';

/** Bırakılana kadar bekleyen okuma: `oku()` çağrılınca söz verir, `birak(deger)` sonuçlandırır. */
function bekletilenOkuma<T>() {
  let birak: (d: T) => void = () => { throw new Error('bekleyen okuma yok'); };
  let sayi = 0;
  const oku = (): Promise<T> => { sayi += 1; return new Promise<T>((coz) => { birak = coz; }); };
  return { oku, birak: (d: T) => birak(d), sayi: () => sayi };
}

describe('surumluOnbellekKur', () => {
  it('ömür içinde önbellekten verir; ömür dolunca (bitis = yazım + ömür, sınır dâhil) yeniden okur', async () => {
    let ms = 1_000;
    const o = surumluOnbellekKur<string>({ omurMs: 60_000, simdiMs: () => ms });
    let okuma = 0;
    const oku = async () => { okuma += 1; return `deger-${okuma}`; };
    expect(await o.get('a', oku)).toBe('deger-1');
    ms += 59_999;
    expect(await o.get('a', oku)).toBe('deger-1');
    ms += 1;
    expect(await o.get('a', oku)).toBe('deger-2');
    expect(okuma).toBe(2);
  });

  it('`saklansinMi` false dönen sonucu yazmaz (her çağrı yeniden okur); verilmezse `null` sonuç da saklanır', async () => {
    let okuma = 0;
    const oku = async (): Promise<string | null> => { okuma += 1; return null; };
    const secici = surumluOnbellekKur<string | null>({ omurMs: 60_000, simdiMs: () => 0, saklansinMi: (d) => d !== null });
    await secici.get('a', oku); await secici.get('a', oku);
    expect(okuma).toBe(2);
    const hepsi = surumluOnbellekKur<string | null>({ omurMs: 60_000, simdiMs: () => 0 });
    await hepsi.get('a', oku); await hepsi.get('a', oku);
    expect(okuma).toBe(3);
  });

  it('okuma hatası FIRLATIR ve önbelleğe hiçbir şey yazılmaz', async () => {
    const o = surumluOnbellekKur<string>({ omurMs: 60_000, simdiMs: () => 0 });
    await expect(o.get('a', async () => { throw Object.assign(new Error('bağlantı koptu'), { code: '57P01' }); })).rejects.toMatchObject({ code: '57P01' });
    expect(await o.get('a', async () => 'taze')).toBe('taze');
  });

  it('`dusur(anahtar)` yalnız o kaydı, `temizle()` hepsini düşürür', async () => {
    const o = surumluOnbellekKur<string>({ omurMs: 60_000, simdiMs: () => 0 });
    await o.get('a', async () => 'a1');
    await o.get('b', async () => 'b1');
    o.dusur('a');
    expect(await o.get('a', async () => 'a2')).toBe('a2');
    expect(await o.get('b', async () => 'b2')).toBe('b1');
    o.temizle();
    expect(await o.get('b', async () => 'b3')).toBe('b3');
  });

  it('YARIŞ — `dusur`: okuma beklerken düşürme gelirse eski değer önbelleğe YAZILMAZ; o çağrı kendi sonucunu alır, sonraki çağrı yeniden okur', async () => {
    const o = surumluOnbellekKur<string>({ omurMs: 60_000, simdiMs: () => 0 });
    const b = bekletilenOkuma<string>();
    const ucusta = o.get('a', b.oku);
    o.dusur('a');
    b.birak('eski');
    expect(await ucusta).toBe('eski');
    expect(await o.get('a', async () => 'yeni')).toBe('yeni');
    // Düşürme olmadan aynı akış değeri YAZAR (koşul yalnız yarışta devrede — karşı örnek).
    const b2 = bekletilenOkuma<string>();
    const ucusta2 = o.get('c', b2.oku);
    b2.birak('c1');
    expect(await ucusta2).toBe('c1');
    expect(await o.get('c', async () => 'c2')).toBe('c1');
  });

  it('YARIŞ — `temizle` (ve başka anahtarın `dusur`u): uçuştaki okuma önbelleğe YAZILMAZ', async () => {
    const o = surumluOnbellekKur<string>({ omurMs: 60_000, simdiMs: () => 0 });
    const b = bekletilenOkuma<string>();
    const ucusta = o.get('a', b.oku);
    o.temizle();
    b.birak('eski');
    expect(await ucusta).toBe('eski');
    expect(await o.get('a', async () => 'yeni')).toBe('yeni');
    const b2 = bekletilenOkuma<string>();
    const ucusta2 = o.get('x', b2.oku);
    o.dusur('baska');
    b2.birak('x-eski');
    await ucusta2;
    expect(await o.get('x', async () => 'x-yeni')).toBe('x-yeni');
  });
});
