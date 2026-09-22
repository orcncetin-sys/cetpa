/**
 * dagilim.test.ts — "sayısal değeri sınır listesine göre kovala" (histogram) sözleşmesi.
 * ÖNCE YAZILDI (Faz 3 6/n rapor ekranları, 2026-09-19).
 *
 * Sahte kesinlik sitesi (src/components/reports/genel/GenelOzet.tsx, Phase 189
 * "Sipariş Değeri Dağılımı", 168-205):
 *   178  `const v = o.totalPrice || 0;`
 *   180  `const b = buckets189.find(b => v >= b.min && v < b.max);`
 *   181  `if (b) { b.count++; b.total += v; }`
 * İki ayrı arıza tek satırda: (1) tutarı bilinmeyen sipariş ₺0 sayılıp `'<₺1K'` kovasını
 * ŞİŞİRİYOR — histogramın sol ucu veri eksikliğiyle dolu görünüyor; (2) `find` eşleşmezse
 * (negatif tutar, ya da son sınır sonlu olduğunda taşan değer) sipariş SESSİZCE düşüyor —
 * ne kovada ne de ekranda bir iz var. Kural (CLAUDE.md "sahte kesinlik gösterme"):
 * bilinmeyen sayı 0 DEĞİL bilinmiyordur; sessiz eleme de yoktur, SAYILIR.
 *
 * Testler bu iki sayacı (`bilinmeyen`, `kapsamDisi`) ve `[alt, ust)` sınır davranışını
 * kilitler; bilinen + kapsam içi girdide sayılar P189 ile BİREBİR aynıdır (test 1).
 */
import { describe, it, expect } from 'vitest';
import { kovayaYerlestir, type KovaSiniri } from './dagilim';

// Türkçe fikstür: Şirin İnşaat'ın ÇİMENTO 50KG siparişleri (tutarlar TL).
interface Siparis { readonly musteri: string; readonly urun: string; readonly tutar?: unknown }
const sip = (tutar: unknown): Siparis => ({ musteri: 'Şirin İnşaat', urun: 'ÇİMENTO 50KG', tutar });
const tutarSec = (o: Siparis): unknown => o.tutar;

/** P189'un kendi sınırları (GenelOzet.tsx:169-175) — parite ölçüsü. */
const P189: readonly KovaSiniri[] = [
  { etiket: '<₺1K', ust: 1000 },
  { etiket: '₺1-5K', ust: 5000 },
  { etiket: '₺5-20K', ust: 20_000 },
  { etiket: '₺20-100K', ust: 100_000 },
  { etiket: '₺100K+', ust: Infinity },
];

const SIFIR_TUTAR = { toplam: 0, bilinen: 0, bilinmeyen: 0 };

describe('kovayaYerlestir', () => {
  // 1 · PARİTE: bilinen + kapsam içi girdide P189 ile aynı adet/toplam.
  it('P189 sınırlarında adet ve tutarları birebir üretir; [alt, ust) yarı açık', () => {
    const liste = [500, 1000, 4999, 250_000].map(sip);
    const { kovalar, bilinmeyen, kapsamDisi } = kovayaYerlestir(liste, tutarSec, P189);

    // 1000 İKİNCİ kovada ([alt, ust) — üst sınır HARİÇ), 4999 da öyle.
    expect(kovalar.map(k => k.adet)).toEqual([1, 2, 0, 0, 1]);
    expect(kovalar.map(k => k.tutar.toplam)).toEqual([500, 5999, 0, 0, 250_000]);
    expect(bilinmeyen).toBe(0);
    expect(kapsamDisi).toBe(0);

    // Kovalar `sinirlar` sırasında, BOŞ kovalar dâhil döner (histogram şekli sabit).
    expect(kovalar.map(k => k.etiket)).toEqual(['<₺1K', '₺1-5K', '₺5-20K', '₺20-100K', '₺100K+']);
    expect(kovalar.map(k => [k.alt, k.ust])).toEqual([
      [0, 1000], [1000, 5000], [5000, 20_000], [20_000, 100_000], [100_000, Infinity],
    ]);
  });

  // 2 · MUTASYON AYIRT EDİCİ: `|| 0` geri gelirse ilk kova 4 olur → kırmızı.
  it('tutarı bilinmeyen sipariş HİÇBİR kovaya girmez, ayrı sayılır', () => {
    const liste = [undefined, null, '', NaN].map(sip);
    const { kovalar, bilinmeyen, kapsamDisi } = kovayaYerlestir(liste, tutarSec, P189);

    expect(bilinmeyen).toBe(4);
    expect(kovalar[0].adet).toBe(0);            // `o.totalPrice || 0` burayı 4 yapardı
    expect(kovalar.map(k => k.adet)).toEqual([0, 0, 0, 0, 0]);
    expect(kovalar[0].tutar).toEqual(SIFIR_TUTAR);
    expect(kapsamDisi).toBe(0);                 // bilinmeyen ≠ kapsam dışı

    // Sayısal olmayan metin ve sonsuzluk da BİLİNMEYENDİR (kapsam dışı DEĞİL).
    const ikinci = kovayaYerlestir(['abc', Infinity, -Infinity].map(sip), tutarSec, P189);
    expect(ikinci.bilinmeyen).toBe(3);
    expect(ikinci.kapsamDisi).toBe(0);
    expect(ikinci.kovalar.map(k => k.adet)).toEqual([0, 0, 0, 0, 0]);
  });

  // 3 · MUTASYON AYIRT EDİCİ: `if (!v)` ile 0'ı bilinmeyen saymak → kırmızı.
  it('meşru 0 (ve "0" metni) ilk kovaya girer, bilinmeyen SAYILMAZ', () => {
    const { kovalar, bilinmeyen } = kovayaYerlestir([sip(0), sip('0')], tutarSec, P189);

    expect(kovalar[0].adet).toBe(2);
    expect(kovalar[0].tutar.bilinen).toBe(2);
    expect(kovalar[0].tutar.toplam).toBe(0);
    expect(kovalar[0].tutar.bilinmeyen).toBe(0);
    expect(bilinmeyen).toBe(0);
  });

  // 4 · Bugün P189'un `find`'i negatifi SESSİZCE düşürüyor.
  it('ilk kovanın altındaki (negatif) değer kovaya girmez, kapsamDisi sayılır', () => {
    const { kovalar, bilinmeyen, kapsamDisi } = kovayaYerlestir([sip(-50)], tutarSec, P189);

    expect(kapsamDisi).toBe(1);
    expect(kovalar.map(k => k.adet)).toEqual([0, 0, 0, 0, 0]);
    expect(bilinmeyen).toBe(0);                 // eksi tutar BİLİNİYOR, yalnız kapsam dışı
  });

  // 5 · Son sınır SONLU olduğunda üst taşma da sayılır (CB8:549 `999` tuzağı).
  it('sonlu son üst sınırda, sınıra eşit ve üstündeki değerler kapsamDisi olur', () => {
    const sonlu: readonly KovaSiniri[] = [
      { etiket: '<₺500', ust: 500 },
      { etiket: '₺500-998', ust: 999 },
    ];
    const { kovalar, kapsamDisi, bilinmeyen } = kovayaYerlestir([sip(999), sip(5000), sip(998)], tutarSec, sonlu);

    expect(kapsamDisi).toBe(2);                 // 999 (ust HARİÇ) + 5000 (taşma)
    expect(kovalar.map(k => k.adet)).toEqual([0, 1]);
    expect(kovalar[1].tutar.toplam).toBe(998);
    expect(bilinmeyen).toBe(0);
  });

  // 7 · Sessiz yanlış kova yok: artmayan sınır listesi programlama hatasıdır.
  it('artmayan / geçersiz sınır listesinde throw eder', () => {
    const cagir = (sinirlar: readonly KovaSiniri[]) => () => kovayaYerlestir([], tutarSec, sinirlar);

    expect(cagir([{ etiket: 'a', ust: 5 }, { etiket: 'b', ust: 3 }])).toThrow();
    expect(cagir([{ etiket: 'a', ust: 5 }, { etiket: 'b', ust: 5 }])).toThrow();   // sıfır genişlik
    expect(cagir([{ etiket: 'a', ust: 0 }])).toThrow();                            // ilk alt = 0
    expect(cagir([{ etiket: 'a', ust: -5 }])).toThrow();
    expect(cagir([{ etiket: 'a', ust: NaN }])).toThrow();                          // sınır bilinmiyor
    expect(cagir([{ etiket: 'a', ust: 1000 }, { etiket: 'b', ust: Infinity }])).not.toThrow();
  });

  // 8 · DEĞİŞMEZ: hiçbir öğe kaybolmaz.
  it('Σ kovalar.adet + bilinmeyen + kapsamDisi === liste.length', () => {
    const liste = [500, undefined, 1000, -50, NaN, 250_000, '7500', '', 0].map(sip);
    const { kovalar, bilinmeyen, kapsamDisi } = kovayaYerlestir(liste, tutarSec, P189);

    const kovadaki = kovalar.reduce((s, k) => s + k.adet, 0);
    expect(kovadaki + bilinmeyen + kapsamDisi).toBe(liste.length);
    expect({ kovadaki, bilinmeyen, kapsamDisi }).toEqual({ kovadaki: 5, bilinmeyen: 3, kapsamDisi: 1 });
    // Sayısal metin '7500' üçüncü kovada — bilinen sayıdır.
    expect(kovalar[2].adet).toBe(1);
    expect(kovalar[2].tutar.toplam).toBe(7500);
  });

  // 9 · Boş liste + girdi mutasyonu yok.
  it('boş listede tüm kovalar sıfırdır; girdi (liste ve sınırlar) mutasyona uğramaz', () => {
    const bos: readonly Siparis[] = Object.freeze([]);
    const sinirlar = Object.freeze(P189.map(s => Object.freeze({ ...s })));
    const { kovalar, bilinmeyen, kapsamDisi } = kovayaYerlestir(bos, tutarSec, sinirlar);

    expect(kovalar).toHaveLength(5);
    expect(kovalar.map(k => k.adet)).toEqual([0, 0, 0, 0, 0]);
    expect(kovalar.map(k => k.tutar)).toEqual([SIFIR_TUTAR, SIFIR_TUTAR, SIFIR_TUTAR, SIFIR_TUTAR, SIFIR_TUTAR]);
    expect(kovalar.every(k => k.ogeler.length === 0)).toBe(true);
    expect(bilinmeyen).toBe(0);
    expect(kapsamDisi).toBe(0);
    expect(sinirlar.map(s => s.ust)).toEqual([1000, 5000, 20_000, 100_000, Infinity]);

    // Donmuş öğelerle dolu donmuş liste de sorunsuz (yerinde yazma yok).
    const dolu = Object.freeze([Object.freeze(sip(500)), Object.freeze(sip(250_000))]);
    expect(() => kovayaYerlestir(dolu, tutarSec, sinirlar)).not.toThrow();
  });

  it('ogeler girdi sırasını ve nesne kimliğini korur', () => {
    const a = sip(1500), b = sip(4000), c = sip(2000);
    const { kovalar } = kovayaYerlestir([a, b, c], tutarSec, P189);

    expect(kovalar[1].ogeler).toEqual([a, b, c]);
    expect(kovalar[1].ogeler[0]).toBe(a);       // kopya değil, aynı nesne
    expect(kovalar[1].ogeler[1]).toBe(b);
    expect(kovalar[1].ogeler[2]).toBe(c);
    expect(kovalar[0].ogeler).toEqual([]);
  });

  it('boş sınır listesinde bilinen değerler kapsamDisi sayılır (sessiz eleme yok)', () => {
    const { kovalar, bilinmeyen, kapsamDisi } = kovayaYerlestir([sip(500), sip(null)], tutarSec, []);

    expect(kovalar).toEqual([]);
    expect(kapsamDisi).toBe(1);
    expect(bilinmeyen).toBe(1);
  });
});
