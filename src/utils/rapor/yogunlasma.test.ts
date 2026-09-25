/**
 * yogunlasma.test.ts — kümülatif pay + ABC sınıflandırma sözleşmesi (Faz 3 6/n · 6b).
 * ÖNCE YAZILDI (kırmızı görüldü: modül yokken import düştü), sonra modül yazıldı.
 *
 * Sayfadaki sahte kesinlik siteleri (HEAD `b95fc18`'de yeniden ölçüldü, satırlar şartnameyle birebir):
 *   genel/GenelBloklar1.tsx:601  `total217 = sorted217.reduce(...)` → payda YALNIZ ilk 6 ürün (K21)
 *   genel/GenelBloklar1.tsx:608 + :622  `total217 > 0 ? Math.round(...) : 0` → payda bilinmezken '%0' ×6, satır 622 kopya
 *   genel/GenelBloklar3.tsx:33   `totalRev256 > 0 ? ... : 0` → rozet "Üst %30 → %0 ciro" veri yokken
 *   genel/GenelBloklar3.tsx:154  `maxRev > 0 ? (...).toFixed(0) : 0` + ikinci `reduce` kopyası
 *   reports/UrunlerRapor.tsx:81  `totalRevenue > 0 ? ... : 0` → pct 0 → cumPct hiç artmaz → HER ürün 'A Sınıfı'
 *   reports/UrunlerRapor.tsx:83  `cumPct <= 70 ? 'A' : cumPct <= 90 ? 'B' : 'C'` (K20: değer kalır, adlandırılır)
 *   reports/UrunlerRapor.tsx:179 `<td>100%</td>` SABİT — paylar bilinmezken bile
 *
 * Kural (CLAUDE.md): bilinmeyen sayı 0 DEĞİL bilinmiyordur; paydaya da paya da girmez, ayrı sayılır.
 * Türetilen sayı (pay, kümülatif, sınıf) tek girdi bile eksikse HESAPLANMAZ (null).
 * PARİTE: tüm değerler biliniyor ve payda > 0 iken pay/kümülatif/sınıf eski satır-içi hesapla BİREBİR
 * (test 1 ve 9 eski ifadeyi aynı sırayla yeniden kurup karşılaştırır).
 */
import { describe, it, expect } from 'vitest';
import {
  kumulatifPaylar, abcSiniflandir, ABC_ESIKLERI,
  type KumulatifPaylar, type PaySatiri,
} from './yogunlasma';
import { toplaBilinen, satirTutari, type Tutar } from '../para';

/** GB1 P217 / UrunlerRapor ürün kovasının yapısal karşılığı (tipe bağımlı değil). */
interface Urun { ad: string; ciro: unknown }
const u = (ad: string, ciro: unknown): Urun => ({ ad, ciro });

/** Dört ürün, TL — payda 1.000: paylar tam sayı, kümülatif 100'de biter. */
const DORT_URUN: Urun[] = [
  u('ÇİMENTO 50KG', 500),
  u('DEMİR Ø12', 300),
  u('TUĞLA', 150),
  u('KUM', 50),
];

const adlar = <T extends { oge: Urun }>(satirlar: readonly T[]): string[] => satirlar.map(s => s.oge.ad);
const paylar = (satirlar: readonly PaySatiri<unknown>[]): (number | null)[] => satirlar.map(s => s.pay);
const kumulatifler = (satirlar: readonly PaySatiri<unknown>[]): (number | null)[] => satirlar.map(s => s.kumulatif);

/** Bugünkü UrunlerRapor.tsx:76-83 satır-içi mantığı — parite ve "kilit" testleri için AYNEN yeniden kurulur. */
function eskiAbc(ciro: readonly number[], toplam: number): { pct: number[]; cls: ('A' | 'B' | 'C')[] } {
  let cumPct = 0;
  const pct: number[] = [];
  const cls: ('A' | 'B' | 'C')[] = [];
  for (const rev of ciro) {
    const p = toplam > 0 ? (rev / toplam) * 100 : 0;
    cumPct += p;
    pct.push(p);
    cls.push(cumPct <= 70 ? 'A' : cumPct <= 90 ? 'B' : 'C');
  }
  return { pct, cls };
}

describe('kumulatifPaylar — payda TÜM toplam, bilinmeyen paydaya da paya da girmez', () => {
  it('1 · PARİTE: [500, 300, 150, 50] → pay [50, 30, 15, 5], kümülatif [50, 80, 95, 100]; eski Math.round / toFixed(1) sonuçları aynı', () => {
    const p = kumulatifPaylar(DORT_URUN, o => o.ciro);
    expect(adlar(p.satirlar)).toEqual(['ÇİMENTO 50KG', 'DEMİR Ø12', 'TUĞLA', 'KUM']);
    expect(paylar(p.satirlar)).toEqual([50, 30, 15, 5]);
    expect(kumulatifler(p.satirlar)).toEqual([50, 80, 95, 100]);
    expect(p.toplam).toEqual({ toplam: 1000, bilinen: 4, bilinmeyen: 0 });
    expect(p.neden).toBeNull();
    expect(p.bilinmeyenSatir).toBe(0);
    expect(p.sira).toBe('azalan');
    expect(p.satirlar).toHaveLength(DORT_URUN.length);

    // Eski GenelBloklar1.tsx:608 `Math.round((p.rev / total) * 100)` ve UrunlerRapor.tsx:169 `pct.toFixed(1)` — BİREBİR.
    const eskiTotal = [500, 300, 150, 50].reduce((s, r) => s + r, 0);
    const eskiRound = [500, 300, 150, 50].map(r => Math.round((r / eskiTotal) * 100));
    expect(p.satirlar.map(s => Math.round(s.pay as number))).toEqual(eskiRound);
    const { pct: eskiPct } = eskiAbc([500, 300, 150, 50], eskiTotal);
    expect(p.satirlar.map(s => (s.pay as number).toFixed(1))).toEqual(eskiPct.map(x => x.toFixed(1)));
    // pay YUVARLANMAZ: ham yüzde döner (yuvarlama `bicim.yuzdeYaz`'da).
    const ham = kumulatifPaylar([u('A', 1), u('B', 2)], o => o.ciro);
    expect(ham.satirlar[1].pay).toBeCloseTo(33.3333333, 6);
    expect(ham.satirlar[1].pay).not.toBe(33);
  });

  it('2 · SIRA: varsayılan azalan; eşit tutarlı iki ürün girdi sırasını korur; okunamayan satır SONDA (-cmp değil)', () => {
    const girdi: Urun[] = [
      u('DEMİR Ø12', 300),
      u('KİREÇ', 150),      // TUĞLA ile eşit — girdi sırasında ÖNCE
      u('ALÇI', undefined), // okunamıyor → azalan sırada da SONDA
      u('ÇİMENTO 50KG', 500),
      u('KUM', 50),
      u('TUĞLA', 150),
    ];
    const p = kumulatifPaylar(girdi, o => o.ciro);
    expect(adlar(p.satirlar)).toEqual(['ÇİMENTO 50KG', 'DEMİR Ø12', 'KİREÇ', 'TUĞLA', 'KUM', 'ALÇI']);
    expect(p.satirlar).toHaveLength(girdi.length);
    // Mutasyon: `-sayiSirala(a, b)` yön çevirme → ALÇI BAŞA gelirdi.
    expect(p.satirlar[0].oge.ad).not.toBe('ALÇI');
    expect(p.satirlar.at(-1)?.oge.ad).toBe('ALÇI');
  });

  it('3 · BİLİNMEYEN değer paydaya DA paya DA girmez: üçünün de pay/kümülatif null, satır KAYBOLMAZ', () => {
    const girdi: Urun[] = [u('ÇİMENTO 50KG', 500), u('DEMİR Ø12', undefined), u('KUM', 50)];
    const p = kumulatifPaylar(girdi, o => o.ciro);
    expect(p.neden).toBe('payda-bilinmiyor');
    expect(p.satirlar).toHaveLength(3);
    expect(paylar(p.satirlar)).toEqual([null, null, null]);
    expect(kumulatifler(p.satirlar)).toEqual([null, null, null]);
    expect(p.toplam).toEqual({ toplam: 550, bilinen: 2, bilinmeyen: 1 });
    expect(p.bilinmeyenSatir).toBe(1);
    expect(adlar(p.satirlar)).toEqual(['ÇİMENTO 50KG', 'KUM', 'DEMİR Ø12']); // bilinmeyen sonda
    // Mutasyon A (`?? 0`): paylar [90.9, 9.1, 0] dolardı. Mutasyon B (kapı `ekranTutari`): 550'den pay üretirdi.
    expect(p.satirlar[0].pay).not.toBeCloseTo((500 / 550) * 100, 6);
    expect(p.satirlar.every(s => s.pay === null)).toBe(true);
  });

  it('4 · KISMİ satır ({toplam:100, bilinen:1, bilinmeyen:1}) → payda bilinmiyor, ama sıralama kısmi toplamı görür (ortada, sonda değil)', () => {
    const kismi: Tutar = { toplam: 100, bilinen: 1, bilinmeyen: 1 };
    const girdi: { ad: string; t: Tutar }[] = [
      { ad: 'KUM', t: { toplam: 50, bilinen: 1, bilinmeyen: 0 } },
      { ad: 'DEMİR Ø12', t: kismi },
      { ad: 'ÇİMENTO 50KG', t: { toplam: 500, bilinen: 1, bilinmeyen: 0 } },
    ];
    const p = kumulatifPaylar(girdi, o => o.t);
    expect(p.neden).toBe('payda-bilinmiyor');
    expect(paylar(p.satirlar)).toEqual([null, null, null]);
    expect(kumulatifler(p.satirlar)).toEqual([null, null, null]);
    expect(p.toplam).toEqual({ toplam: 650, bilinen: 3, bilinmeyen: 1 });
    expect(p.bilinmeyenSatir).toBe(1);
    // ekranTutari(kısmi) = 100 → 500 > 100 > 50: ORTADA (tamTutar ile sıralansaydı NaN → sonda olurdu).
    expect(p.satirlar.map(s => s.oge.ad)).toEqual(['ÇİMENTO 50KG', 'DEMİR Ø12', 'KUM']);
    expect(p.satirlar[1].tutar).toEqual(kismi);
  });

  it('5a · PAYDA YOK: hepsi gerçek 0 → neden payda-yok, paylar null (bugün "0%" basılıyordu); bilinmeyen SAYILMAZ', () => {
    const p = kumulatifPaylar([u('ÇİMENTO 50KG', 0), u('KUM', 0)], o => o.ciro);
    expect(p.neden).toBe('payda-yok');
    expect(paylar(p.satirlar)).toEqual([null, null]);
    expect(kumulatifler(p.satirlar)).toEqual([null, null]);
    expect(p.toplam).toEqual({ toplam: 0, bilinen: 2, bilinmeyen: 0 }); // 0 BİLİNEN sayıdır
    expect(p.bilinmeyenSatir).toBe(0);
    expect(p.satirlar).toHaveLength(2);
  });

  it('5b · PAYDA YOK: toplam negatif (iade fazlası) → payda-yok; negatif/Infinity pay ÜRETİLMEZ', () => {
    const p = kumulatifPaylar([u('ÇİMENTO 50KG', 500), u('İADE', -700)], o => o.ciro);
    expect(p.neden).toBe('payda-yok');
    expect(p.toplam.toplam).toBe(-200);
    expect(paylar(p.satirlar)).toEqual([null, null]); // mutasyon: `payda > 0` kapısı kalkarsa [-250, 350]
    expect(kumulatifler(p.satirlar)).toEqual([null, null]);
  });

  it('5c · PAYDA YOK: boş liste → satirlar [], toplam {0,0,0}, payda-yok', () => {
    const p = kumulatifPaylar<Urun>([], o => o.ciro);
    expect(p.satirlar).toEqual([]);
    expect(p.toplam).toEqual({ toplam: 0, bilinen: 0, bilinmeyen: 0 });
    expect(p.neden).toBe('payda-yok');
    expect(p.bilinmeyenSatir).toBe(0);
  });

  it('6 · K21 "Tüm ciro": 10 ürün, ilk 6\'nın payları TÜM toplama göre → toplamı < 100 (ilk 6\'nın kendi toplamı DEĞİL)', () => {
    const cirolar = [1000, 900, 800, 700, 600, 500, 400, 300, 200, 100]; // toplam 5.500; ilk 6 = 4.500
    const girdi = cirolar.map((c, i) => u(`ÜRÜN ${i + 1}`, c));
    const p = kumulatifPaylar(girdi, o => o.ciro);
    const ilk6 = p.satirlar.slice(0, 6); // "ilk 6" yalnız GÖSTERİM için çağıranda kesilir
    expect(p.toplam.toplam).toBe(5500);
    for (const [i, s] of ilk6.entries()) expect(s.pay).toBeCloseTo((cirolar[i] / 5500) * 100, 9);
    const ilk6Toplam = ilk6.reduce((s, r) => s + (r.pay as number), 0);
    expect(ilk6Toplam).toBeCloseTo((4500 / 5500) * 100, 9);
    expect(ilk6Toplam).toBeLessThan(100);
    // Mutasyon (bugünkü GenelBloklar1.tsx:601): payda = ilk 6'nın toplamı → altı pay %100'e tamamlanır.
    expect(ilk6Toplam).not.toBeCloseTo(100, 6);
    expect(ilk6[0].pay).not.toBeCloseTo((1000 / 4500) * 100, 6);
    // Kümülatif DÖNEN sıraya göre; son satır 100'de biter.
    expect(p.satirlar.at(-1)?.kumulatif).toBeCloseTo(100, 9);
    expect(p.satirlar).toHaveLength(10);
  });

  it('7 · seçicisiz Tutar[] ve düz number[] aynı payları verir; çöp değerlerin hepsi bilinmeyen, "undefined"/"[object Object]" oluşmaz; meşru 0 bilinen', () => {
    const tutarlar: Tutar[] = [
      { toplam: 500, bilinen: 1, bilinmeyen: 0 },
      { toplam: 300, bilinen: 1, bilinmeyen: 0 },
    ];
    const aTutar = kumulatifPaylar(tutarlar);
    const bSayi = kumulatifPaylar([500, 300]);
    const cString = kumulatifPaylar(['500', '300']); // bilinenSayi sayısal string kabul eder
    expect(paylar(aTutar.satirlar)).toEqual(paylar(bSayi.satirlar));
    expect(paylar(cString.satirlar)).toEqual(paylar(bSayi.satirlar));
    expect(paylar(bSayi.satirlar)).toEqual([62.5, 37.5]);
    expect(aTutar.toplam).toEqual(bSayi.toplam);
    // Seçicisiz Tutar: öğenin kendisi hem `oge` hem değerdir; toplam nesnesi yeni (girdiye alias değil).
    expect(aTutar.satirlar[0].oge).toBe(tutarlar[0]);
    expect(aTutar.satirlar[0].tutar).toEqual(tutarlar[0]);

    const cop: unknown[] = ['abc', null, NaN, Infinity, -Infinity, {}, '', undefined, { toplam: 'x', bilinen: 1, bilinmeyen: 0 }];
    const p = kumulatifPaylar(cop);
    expect(p.satirlar).toHaveLength(cop.length);
    expect(p.toplam).toEqual({ toplam: 0, bilinen: 0, bilinmeyen: cop.length });
    expect(p.bilinmeyenSatir).toBe(cop.length);
    expect(p.neden).toBe('payda-bilinmiyor');
    for (const s of p.satirlar) {
      expect(s.tutar).toEqual({ toplam: 0, bilinen: 0, bilinmeyen: 1 });
      expect(Number.isNaN(s.tutar.toplam)).toBe(false); // `Number(undefined)` / `Number({})` toplama sızmaz
    }
    // Meşru 0 BİLİNEN: `{0, 1, 0}` — bilinmeyen değil.
    const sifir = kumulatifPaylar([0, 250]);
    expect(sifir.satirlar.map(s => s.tutar)).toEqual([
      { toplam: 250, bilinen: 1, bilinmeyen: 0 },
      { toplam: 0, bilinen: 1, bilinmeyen: 0 },
    ]);
    expect(sifir.neden).toBeNull();
    expect(paylar(sifir.satirlar)).toEqual([100, 0]);
    // Global `isFinite(null) === true` tuzağı: null bilinmeyendir, 0 değil.
    const nullVar = kumulatifPaylar([null, 100]);
    expect(nullVar.neden).toBe('payda-bilinmiyor');
    expect(nullVar.toplam.bilinmeyen).toBe(1);
  });

  it('8 · sira "girdi": giriş sırası korunur, kümülatif dönen sıraya göre birikir; abcSiniflandir bu sonuçla THROW eder', () => {
    // GB3 P256 desilleri: D1..D3 sırası ANLAM taşır (azalan olsa D1 en sona giderdi).
    const desiller: { etiket: string; tutar: Tutar }[] = [
      { etiket: 'D1', tutar: { toplam: 100, bilinen: 4, bilinmeyen: 0 } },
      { etiket: 'D2', tutar: { toplam: 300, bilinen: 4, bilinmeyen: 0 } },
      { etiket: 'D3', tutar: { toplam: 200, bilinen: 4, bilinmeyen: 0 } },
    ];
    const p = kumulatifPaylar(desiller, d => d.tutar, { sira: 'girdi' });
    expect(p.sira).toBe('girdi');
    expect(p.satirlar.map(s => s.oge.etiket)).toEqual(['D1', 'D2', 'D3']);
    expect(p.satirlar[0].pay).toBeCloseTo(100 / 6, 9);
    expect(p.satirlar[1].pay).toBe(50);
    expect(p.satirlar[2].pay).toBeCloseTo(100 / 3, 9);
    expect(p.satirlar[0].kumulatif).toBeCloseTo(100 / 6, 9);
    expect(p.satirlar[1].kumulatif).toBeCloseTo(100 / 6 + 50, 9);
    expect(p.satirlar[2].kumulatif).toBeCloseTo(100, 9);
    expect(p.toplam).toEqual({ toplam: 600, bilinen: 12, bilinmeyen: 0 });
    // Mutasyon: sıra doğrulaması kaldırılırsa girdi sırasındaki liste sessizce yanlış A/B/C üretirdi.
    expect(() => abcSiniflandir(p)).toThrow(/azalan/);
    // Açık `{ sira: 'azalan' }` varsayılanla aynı sonucu verir.
    const acik = kumulatifPaylar(desiller, d => d.tutar, { sira: 'azalan' });
    expect(acik.satirlar.map(s => s.oge.etiket)).toEqual(['D2', 'D3', 'D1']);
    expect(acik.sira).toBe('azalan');
    expect(() => abcSiniflandir(acik)).not.toThrow();
  });

  it('13 · sec bir Tutar döner (T3 çeyrekler): boş çeyrek `{0,0,0}` GERÇEK 0 → pay 0, bilinmeyen DEĞİL; okunamayan sipariş payda\'yı düşürür', () => {
    interface Siparis { musteri: string; totalPrice: unknown }
    const ceyrekler: { etiket: string; orders: Siparis[] }[] = [
      { etiket: 'Q1', orders: [] },                                                       // hiç sipariş yok → gerçek 0
      { etiket: 'Q2', orders: [{ musteri: 'Şirin İnşaat', totalPrice: 1000 }] },
      { etiket: 'Q3', orders: [{ musteri: 'Yıldız Yapı', totalPrice: 2000 }, { musteri: 'Kâhya Hafriyat', totalPrice: 1000 }] },
    ];
    const q = kumulatifPaylar(ceyrekler, c => toplaBilinen(c.orders, o => o.totalPrice), { sira: 'girdi' });
    expect(q.neden).toBeNull();
    expect(q.satirlar[0].tutar).toEqual({ toplam: 0, bilinen: 0, bilinmeyen: 0 });
    expect(paylar(q.satirlar)).toEqual([0, 25, 75]);
    expect(kumulatifler(q.satirlar)).toEqual([0, 25, 100]);
    expect(q.bilinmeyenSatir).toBe(0);
    // Mutasyon: `bilinen === 0` çeyreği bilinmeyen sayan gövde → neden 'payda-bilinmiyor' olurdu.
    expect(q.satirlar[0].pay).toBe(0);

    // Bir çeyrekte tutarı okunamayan tek sipariş → o çeyrek KISMİ → payda bilinmiyor → hiçbir çeyreğin payı yok.
    ceyrekler[1].orders.push({ musteri: 'Şirin İnşaat', totalPrice: undefined });
    const q2 = kumulatifPaylar(ceyrekler, c => toplaBilinen(c.orders, o => o.totalPrice), { sira: 'girdi' });
    expect(q2.neden).toBe('payda-bilinmiyor');
    expect(paylar(q2.satirlar)).toEqual([null, null, null]);
    expect(q2.toplam).toEqual({ toplam: 4000, bilinen: 3, bilinmeyen: 1 }); // DEĞER sayacı
    expect(q2.bilinmeyenSatir).toBe(1);                                      // SATIR sayacı — ayrı birim
    expect(q2.satirlar).toHaveLength(3);
  });
});

describe('abcSiniflandir — Pareto sınıfı yalnız azalan sırada, eşikler DÂHİL (K20: [70, 90] değişmez)', () => {
  /** Elle kurulmuş KumulatifPaylar — sınır davranışını kayan nokta artığından bağımsız test etmek için. */
  const elle = (kumulatifler: readonly (number | null)[]): KumulatifPaylar<string> => ({
    satirlar: kumulatifler.map((k, i) => ({
      oge: `ÜRÜN ${i + 1}`,
      tutar: { toplam: 1, bilinen: 1, bilinmeyen: 0 },
      pay: k === null ? null : k - (kumulatifler[i - 1] ?? 0),
      kumulatif: k,
    })),
    toplam: { toplam: kumulatifler.length, bilinen: kumulatifler.length, bilinmeyen: 0 },
    bilinmeyenSatir: 0,
    neden: kumulatifler.some(k => k === null) ? 'payda-bilinmiyor' : null,
    sira: 'azalan',
  });

  it('9 · PARİTE: kümülatif [40, 70, 85, 90, 100] → [A, A, B, B, C] (70 ve 90 DÂHİL); sayılar {2, 2, 1, 0}; değişmez toplamı satır sayısı', () => {
    const r = abcSiniflandir(elle([40, 70, 85, 90, 100]));
    expect(r.satirlar.map(s => s.sinif)).toEqual(['A', 'A', 'B', 'B', 'C']);
    expect(r.sayilar).toEqual({ A: 2, B: 2, C: 1, siniflandirilamayan: 0 });
    expect(r.sayilar.A + r.sayilar.B + r.sayilar.C + r.sayilar.siniflandirilamayan).toBe(r.satirlar.length);
    // Mutasyon: `<=` → `<` yapılırsa 70 'B', 90 'C' olur.
    expect(r.satirlar[1].sinif).toBe('A');
    expect(r.satirlar[3].sinif).toBe('B');
    // Sınırın hemen üstü sınıf atlar.
    const ust = abcSiniflandir(elle([70.0001, 90.0001, 100]));
    expect(ust.satirlar.map(s => s.sinif)).toEqual(['B', 'C', 'C']);

    // Uçtan uca: kumulatifPaylar çıktısı ile eski UrunlerRapor.tsx:79-83 döngüsü BİREBİR (aynı ifade, aynı sıra).
    const cirolar = [400, 250, 150, 80, 70, 50]; // toplam 1.000
    const p = kumulatifPaylar(cirolar.map((c, i) => u(`ÜRÜN ${i + 1}`, c)), o => o.ciro);
    const abc = abcSiniflandir(p);
    const eski = eskiAbc(cirolar, cirolar.reduce((s, r) => s + r, 0));
    expect(abc.satirlar.map(s => s.sinif)).toEqual(eski.cls);
    expect(abc.satirlar.map(s => s.pay)).toEqual(eski.pct);
    expect(abc.satirlar.map(s => s.sinif)).toEqual(['A', 'A', 'B', 'B', 'C', 'C']);
    expect(abc.sayilar).toEqual({ A: 2, B: 2, C: 2, siniflandirilamayan: 0 });
    // Satır kimliği ve pay/kümülatif korunur; `oge` spread edilmez (nesne aynı).
    expect(abc.satirlar[0].oge).toBe(p.satirlar[0].oge);
    expect(abc.satirlar[0].kumulatif).toBe(p.satirlar[0].kumulatif);
    // Son satırın kümülatifi tam veride 100 (UrunlerRapor:179 sabit '100%' yerine BURADAN okunur).
    expect(p.satirlar.at(-1)?.kumulatif).toBeCloseTo(100, 9);
  });

  it('10 · KİLİT: üç üründen birinin fiyatı okunamıyor → HEPSİ sinif null, A 0, siniflandirilamayan 3 (eski mantık üçünü de "A" sayıyordu)', () => {
    const kalemler = [
      { ad: 'ÇİMENTO 50KG', price: 120, quantity: 100 },
      { ad: 'DEMİR Ø12', price: undefined, quantity: 40 }, // fiyatı yok → satirTutari NaN
      { ad: 'KUM', price: 800, quantity: 5 },
    ];
    const p = kumulatifPaylar(kalemler, k => satirTutari(k.price, k.quantity));
    const r = abcSiniflandir(p);
    expect(p.neden).toBe('payda-bilinmiyor');
    expect(r.satirlar.map(s => s.sinif)).toEqual([null, null, null]);
    expect(r.sayilar).toEqual({ A: 0, B: 0, C: 0, siniflandirilamayan: 3 });
    expect(r.sayilar.A + r.sayilar.B + r.sayilar.C + r.sayilar.siniflandirilamayan).toBe(3);
    expect(r.satirlar).toHaveLength(3);
    // Eski UrunlerRapor.tsx:76-83 aynı girdide: `(li.price || 0) * qty` → 0; total > 0 ama... NaN'lı toplamda
    // `totalRevenue > 0` false → pct 0 → cumPct 0 → HER ürün 'A'. Arıza belgeleniyor:
    const eskiToplam = [12000, NaN, 4000].reduce((s, r) => s + r, 0);
    const eski = eskiAbc([12000, NaN, 4000], eskiToplam);
    expect(eski.cls).toEqual(['A', 'A', 'A']);
    // Elle kurulmuş kısmi: bazı satırlar null → yalnız onlar siniflandirilamayan (değişmez korunur).
    const karisik = abcSiniflandir(elle([50, null, null]));
    expect(karisik.satirlar.map(s => s.sinif)).toEqual(['A', null, null]);
    expect(karisik.sayilar).toEqual({ A: 1, B: 0, C: 0, siniflandirilamayan: 2 });
    // Savunma kapısı: elle kurulmuş NaN kümülatif de sınıflandırılamaz ('C'ye düşmez).
    const nanli = abcSiniflandir(elle([NaN]));
    expect(nanli.satirlar[0].sinif).toBeNull();
    expect(nanli.sayilar.siniflandirilamayan).toBe(1);
  });

  it('11 · EŞİK doğrulama: [90,70] / [0,50] / [70,110] / NaN / Infinity → throw; varsayılan ABC_ESIKLERI = [70, 90] (K20)', () => {
    const p = elle([40, 70, 85, 90, 100]);
    expect(() => abcSiniflandir(p, [90, 70])).toThrow(/90.*70|eşik/);
    expect(() => abcSiniflandir(p, [0, 50])).toThrow();
    expect(() => abcSiniflandir(p, [70, 110])).toThrow();
    expect(() => abcSiniflandir(p, [NaN, 90])).toThrow();
    expect(() => abcSiniflandir(p, [70, Infinity])).toThrow();
    expect(() => abcSiniflandir(p, [-10, 90])).toThrow();
    // Sınırlar dâhil geçerli: e1 === e2 ve e2 === 100.
    expect(() => abcSiniflandir(p, [50, 50])).not.toThrow();
    expect(() => abcSiniflandir(p, [70, 100])).not.toThrow();
    // K20 değişmezi: değer [70, 90]; varsayılan çağrı == açık [70, 90] çağrısı.
    expect(ABC_ESIKLERI).toEqual([70, 90]);
    expect(abcSiniflandir(p)).toEqual(abcSiniflandir(p, [70, 90]));
    expect(abcSiniflandir(p)).toEqual(abcSiniflandir(p, ABC_ESIKLERI));
    // Farklı eşik farklı sınıf üretir (varsayılanın gerçekten kullanıldığının kanıtı).
    expect(abcSiniflandir(p, [50, 95]).satirlar.map(s => s.sinif)).toEqual(['A', 'B', 'B', 'B', 'C']);
  });

  it('12 · MUTASYONSUZLUK: donmuş dizi + donmuş öğelerle çalışır; girdi sırası/öğeleri aynı kalır; oge kimliği korunur', () => {
    const girdi: readonly Urun[] = Object.freeze([
      Object.freeze(u('KUM', 50)),
      Object.freeze(u('ÇİMENTO 50KG', 500)),
      Object.freeze(u('ALÇI', undefined)),
      Object.freeze(u('DEMİR Ø12', 300)),
    ]);
    const kopya = JSON.stringify(girdi);
    let p: KumulatifPaylar<Urun> | undefined;
    expect(() => { p = kumulatifPaylar(girdi, o => o.ciro); }).not.toThrow();
    expect(() => { if (p !== undefined) abcSiniflandir(p); }).not.toThrow();
    expect(JSON.stringify(girdi)).toBe(kopya);
    expect(girdi.map(o => o.ad)).toEqual(['KUM', 'ÇİMENTO 50KG', 'ALÇI', 'DEMİR Ø12']);
    expect(p?.satirlar.map(s => s.oge.ad)).toEqual(['ÇİMENTO 50KG', 'DEMİR Ø12', 'KUM', 'ALÇI']);
    expect(p?.satirlar[0].oge).toBe(girdi[1]);
    expect(p?.satirlar[3].oge).toBe(girdi[2]);
    // Donmuş `Tutar` girdisi de aynen çalışır (BOS_TUTAR deseni).
    const donmus: readonly Tutar[] = Object.freeze([
      Object.freeze({ toplam: 0, bilinen: 0, bilinmeyen: 0 }),
      Object.freeze({ toplam: 100, bilinen: 1, bilinmeyen: 0 }),
    ]);
    const q = kumulatifPaylar(donmus, undefined, { sira: 'girdi' });
    expect(paylar(q.satirlar)).toEqual([0, 100]);
    expect(q.satirlar[0].oge).toBe(donmus[0]);
  });
});
