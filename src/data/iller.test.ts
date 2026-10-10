/**
 * iller.test.ts — 81 il listesi, ekran sırası, il eşleme (`ilBul`) ve arama süzgeci (`illeriSuz`).
 * Kullanıcı isteği 2026-10-09: «şehir ve ülke seçtir droplist (otomatik liste yap)».
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { katla } from '../utils/arama';
import { ILLER, IL_ADLARI, ilBul, illeriSuz } from './iller';

describe('ILLER — 81 il, plaka sırasıyla', () => {
  it('81 kayıt; plaka 1..81 eksiksiz ve tekil, dizideki yeri plakasıdır', () => {
    expect(ILLER).toHaveLength(81);
    expect(ILLER.map(il => il.plaka)).toEqual(Array.from({ length: 81 }, (_, i) => i + 1));
  });

  it('ad tekil; `katla(ad)` de tekil (il eşleme anahtarı çakışmaz)', () => {
    expect(new Set(ILLER.map(il => il.ad)).size).toBe(81);
    expect(new Set(ILLER.map(il => katla(il.ad))).size).toBe(81);
  });

  it('plaka — ad eşlemesi: alfabeden ayrılan ve sonradan il olanlar yerinde', () => {
    const ad = (plaka: number) => ILLER.find(il => il.plaka === plaka)?.ad;
    expect([ad(1), ad(6), ad(7), ad(34), ad(35)]).toEqual(['Adana', 'Ankara', 'Antalya', 'İstanbul', 'İzmir']);
    expect([ad(33), ad(46), ad(63)]).toEqual(['Mersin', 'Kahramanmaraş', 'Şanlıurfa']);
    expect([ad(68), ad(76), ad(81)]).toEqual(['Aksaray', 'Iğdır', 'Düzce']);
  });

  it('yazım: resmî ve şapkasız, tam Türkçe karakterle', () => {
    const adlar = ILLER.map(il => il.ad);
    for (const beklenen of ['Hakkari', 'Afyonkarahisar', 'Kahramanmaraş', 'Şanlıurfa', 'Iğdır', 'İstanbul']) {
      expect(adlar, beklenen).toContain(beklenen);
    }
    for (const yanlis of ['Hakkâri', 'Afyon', 'K.Maraş', 'Urfa', 'Igdir', 'Istanbul', 'İçel']) {
      expect(adlar, yanlis).not.toContain(yanlis);
    }
  });

  it('`scripts/gen-geo-cities.cjs` içindeki TR_ILLER ile KÜME eşit (betik çalıştırılmaz; dizi kaynak metninden okunur)', () => {
    const kaynak = readFileSync(join(__dirname, '..', '..', 'scripts', 'gen-geo-cities.cjs'), 'utf-8');
    const dizi = kaynak.match(/const TR_ILLER = \[([\s\S]*?)\];/)?.[1];
    expect(dizi, 'TR_ILLER dizisi betikte bulunamadı').toBeTruthy();
    const betikteki = [...(dizi ?? '').matchAll(/'([^']+)'/g)].map(m => m[1]);
    expect(betikteki).toHaveLength(81);   // ayrıştırma gerçekten oldu
    expect([...betikteki].sort()).toEqual(ILLER.map(il => il.ad).sort());
  });
});

describe('IL_ADLARI — ekranda gösterilen sıra (Türkçe alfabe)', () => {
  it("81 ad, `localeCompare('tr')` sıralı; ilk «Adana», son «Zonguldak»", () => {
    expect(IL_ADLARI).toHaveLength(81);
    expect([...IL_ADLARI]).toEqual([...IL_ADLARI].sort((a, b) => a.localeCompare(b, 'tr')));
    expect(IL_ADLARI[0]).toBe('Adana');
    expect(IL_ADLARI[80]).toBe('Zonguldak');
  });

  it('I / İ ve S / Ş Türkçe sırada: «Hatay, Iğdır, Isparta, İstanbul, İzmir, Kahramanmaraş» · «Sivas, Şanlıurfa, Şırnak, Tekirdağ»', () => {
    const kesit = (ilk: string, adet: number) => IL_ADLARI.slice(IL_ADLARI.indexOf(ilk), IL_ADLARI.indexOf(ilk) + adet);
    expect(kesit('Hatay', 6)).toEqual(['Hatay', 'Iğdır', 'Isparta', 'İstanbul', 'İzmir', 'Kahramanmaraş']);
    expect(kesit('Sivas', 4)).toEqual(['Sivas', 'Şanlıurfa', 'Şırnak', 'Tekirdağ']);
  });

  it('plaka sırası alfabetik DEĞİL — ham ILLER için sıralama iddiası yok, iki dizi aynı kümedir', () => {
    expect(ILLER.map(il => il.ad)).not.toEqual([...IL_ADLARI]);
    expect([...IL_ADLARI].sort()).toEqual(ILLER.map(il => il.ad).sort());
  });
});

describe('illeriSuz — arama kutusu süzgeci', () => {
  it('Türkçe karaktersiz yazım da bulur', () => {
    expect(illeriSuz('sanli')).toEqual(['Şanlıurfa']);
    expect(illeriSuz('igdir')).toEqual(['Iğdır']);
    expect(illeriSuz('canak')).toEqual(['Çanakkale']);
  });

  it("şapkalı ve şapkasız yazım aynı ili verir: 'hakkari' ve 'hakkâri' → Hakkari", () => {
    expect(illeriSuz('hakkari')).toEqual(['Hakkari']);
    expect(illeriSuz('hakkâri')).toEqual(['Hakkari']);
  });

  it("'ıs' ve 'IS': 7 il; adı sorguyla BAŞLAYAN Isparta ve İstanbul ilk iki sırada", () => {
    for (const sorgu of ['ıs', 'IS']) {
      const sonuc = illeriSuz(sorgu);
      expect(sonuc, sorgu).toHaveLength(7);
      expect(sonuc.slice(0, 2), sorgu).toEqual(['Isparta', 'İstanbul']);
      // Kalanlar (yalnız içerenler) IL_ADLARI sırasında.
      expect(sonuc.slice(2), sorgu).toEqual(['Afyonkarahisar', 'Bitlis', 'Eskişehir', 'Kilis', 'Manisa']);
    }
  });

  it('boş / yalnız boşluk sorgu → 81 il, IL_ADLARI sırasında (yeni dizi: çağıran değiştirse liste bozulmaz)', () => {
    expect(illeriSuz('')).toEqual([...IL_ADLARI]);
    expect(illeriSuz('   ')).toEqual([...IL_ADLARI]);
    expect(illeriSuz('')).not.toBe(IL_ADLARI);
  });

  it('eşleşme yoksa boş dizi', () => {
    expect(illeriSuz('berlin')).toEqual([]);
  });
});

describe('ilBul — serbest yazılmış ili listedeki ada çevirir (yalnız birebir eşleşmede)', () => {
  it('harf büyüklüğü ve Türkçe harf bağışlanır; dönen değer listedeki DOĞRU yazımdır', () => {
    expect(ilBul('ANTALYA')).toBe('Antalya');
    for (const yazim of ['ISTANBUL', 'İSTANBUL', 'istanbul']) expect(ilBul(yazim), yazim).toBe('İstanbul');
    for (const yazim of ['IĞDIR', 'Igdir']) expect(ilBul(yazim), yazim).toBe('Iğdır');
    expect(ilBul('Hakkâri')).toBe('Hakkari');
  });

  it('baştaki / sondaki boşluk kırpılır', () => {
    expect(ilBul(' Şanlıurfa ')).toBe('Şanlıurfa');
  });

  it('kısaltma, eski ad ve il dışında metin taşıyan girdi EŞLEŞMEZ — il uydurulmaz', () => {
    for (const yazim of ['K.MARAŞ', 'AFYON', 'İÇEL', 'URFA', 'Antalya / Kepez']) expect(ilBul(yazim), yazim).toBeNull();
  });

  it('boş, `null`, tanımsız ve metin olmayan girdi → `null` (fırlatmaz)', () => {
    for (const girdi of ['', '   ', null, undefined, 34, {}, []]) expect(ilBul(girdi), String(girdi)).toBeNull();
  });

  it('81 ilin her biri kendi adıyla ve büyük harfli yazımıyla bulunur', () => {
    for (const il of ILLER) {
      expect(ilBul(il.ad), il.ad).toBe(il.ad);
      expect(ilBul(il.ad.toLocaleUpperCase('tr-TR')), il.ad).toBe(il.ad);
    }
  });
});
