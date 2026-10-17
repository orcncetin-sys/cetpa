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
 *
 * 6c (2026-10-17) — `yogunlasma()` (HHI) sözleşmesi dosyanın SONUNDA, ayrı `describe`ta (16 vaka + `sec`siz çağrı).
 * ÖNCE YAZILDI (kırmızı görüldü: `yogunlasma` / `HHI_ESIKLERI` export'u yokken), sonra modüle ADDITIVE eklendi.
 * Aynı sekmede iki çelişen HHI vardı: GenelBloklar2 P220 (0–10.000, eşik `> 1500` / `> 2500`, adsız sipariş
 * tek sahte '—' müşterisi, okunamayan tutar ₺0) ve GenelBloklar4 "Ciro Yoğunlaşması" (0–1 ölçeği, orta eşiği
 * 0,10 = 1.000, iptaller DAHİL). Vakalar eski iki ifadeyi yeniden kurup PARİTEYİ (GB2) ve BİLİNÇLİ FARKI
 * (GB4 eşiği, tam 1.500, bilinmeyen tutar, negatif müşteri) ayrı ayrı gösterir. Her "bilinmeyen 0 sayılmaz"
 * kuralının yanında onu bozan mutasyonu ayırt eden beklenti var.
 */
import { describe, it, expect } from 'vitest';
import {
  kumulatifPaylar, abcSiniflandir, ABC_ESIKLERI,
  yogunlasma, HHI_ESIKLERI,
  type KumulatifPaylar, type PaySatiri, type YogunlasmaSonucu,
} from './yogunlasma';
import { toplaBilinen, satirTutari, tamTutar, type Tutar } from '../para';
import { musteriOzeti } from './musteri';
import { raporSiparisi } from '../pano/raporVeriKatmani';
import { siparisIptalMi } from '../siparis';
import { zamanMs } from '../zaman';
import { tryDisiMi } from '../siparisler/magazaSiparisi';

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

// ── HHI (6c) ──

/** Müşteri satırının yapısal karşılığı (`musteriOzeti().musteriler` yerine — tipe bağımlı değil). */
interface Musteri { ad: string; ciro: unknown }
const m = (ad: string, ciro: unknown): Musteri => ({ ad, ciro });
const ciroSec = (o: Musteri): unknown => o.ciro;
/** Eşik vakaları için adı önemsiz müşteri dizisi: Bayi 1, Bayi 2, … */
const bayiler = (cirolar: readonly number[]): Musteri[] => cirolar.map((v, i) => m(`Bayi ${i + 1}`, v));

/** Dört müşteri, TL — payda 1.000.000: paylar 50 · 30 · 15 · 5. */
const DORT_MUSTERI_CIRO: readonly (readonly [string, number])[] = [
  ['Şirin İnşaat', 500000],
  ['Yılmaz Yapı', 300000],
  ['Kaya Hırdavat', 150000],
  ['Demir Beton', 50000],
];
const DORT_MUSTERI: Musteri[] = DORT_MUSTERI_CIRO.map(([ad, ciro]) => m(ad, ciro));

/**
 * Bugünkü GenelBloklar2 P220 satır-içi HHI'sı — parite için AYNEN yeniden kurulur (kova = ad → ciro,
 * ekleme sırası = girdi sırası; `musteriOzeti` İLK GÖRÜLME sırasıyla aynı).
 */
function eskiGb2(kova: Readonly<Record<string, number>>): { hhi: number; seviye: 'high' | 'medium' | 'low' } {
  const total220 = Object.values(kova).reduce((s, v) => s + v, 0);
  // HHI = sum of (market share %)^2 — normalized 0-10000
  const hhi = Object.values(kova).reduce((s, v) => s + Math.pow((v / total220) * 100, 2), 0);
  const hhiRounded = Math.round(hhi);
  const seviye = hhiRounded > 2500 ? 'high' : hhiRounded > 1500 ? 'medium' : 'low';
  return { hhi, seviye };
}

/** Bugünkü GenelBloklar4 "Ciro Yoğunlaşması" — 0–1 ölçeği, orta eşiği 0,10 (paneli O4 + K14 ile SİLİNİYOR). */
function eskiGb4(kova: Readonly<Record<string, number>>): { hhi: number; concentration: 'High' | 'Moderate' | 'Low' } {
  const totalRev346 = Object.values(kova).reduce((s, v) => s + v, 0);
  const shares = Object.values(kova).map(v => v / totalRev346);
  const hhi = shares.reduce((s, v) => s + v * v, 0);
  const concentration = hhi > 0.25 ? 'High' : hhi > 0.1 ? 'Moderate' : 'Low';
  return { hhi, concentration };
}

const kovaKur = (satirlar: readonly (readonly [string, number])[]): Record<string, number> =>
  Object.fromEntries(satirlar.map(([ad, ciro]) => [ad, ciro]));

const T = (toplam: number, bilinen: number, bilinmeyen: number): Tutar => ({ toplam, bilinen, bilinmeyen });

describe('yogunlasma — HHI 0–10.000, eşikler 1.500 / 2.500 dahil orta (K16 + O4), ilk 3 paydası TÜM ciro (K21), HHI atfedilebilenlerle (O4)', () => {
  it('1 · PARİTE: Şirin 500.000 · Yılmaz 300.000 · Kaya 150.000 · Demir 50.000 → eski GB2 HHI ile bit-bit aynı (3.650, yüksek), ilk 3 payı 95', () => {
    const y = yogunlasma(DORT_MUSTERI, ciroSec);
    const eski = eskiGb2(kovaKur(DORT_MUSTERI_CIRO));
    expect(y.hhi).toBe(eski.hhi);
    expect(Math.round(y.hhi as number)).toBe(3650);
    expect(Math.round(y.hhi as number)).toBe(Math.round(eski.hhi));
    expect(eski.seviye).toBe('high');
    expect(y.seviye).toBe('yuksek');
    expect(y.ilk3Pay).toBeCloseTo(95, 9);
    expect(y.ilkN).toBe(3);
    expect(y.neden).toBeNull();
    expect(y.toplam).toEqual({ toplam: 1000000, bilinen: 4, bilinmeyen: 0 });
    expect(y.bilinmeyenSatir).toBe(0);
    // Atfedilemeyen verilmedi → boş Tutar = gerçek 0 (null DEĞİL: HHI hesaplandı, endeks dışı ciro yok).
    expect(y.endeksDisiCiro).toBe(0);
  });

  it('2 · tek müşteri → HHI 10.000, yüksek, ilk 1 payı 100', () => {
    const y = yogunlasma([m('Şirin İnşaat', 250000)], ciroSec);
    expect(y.hhi).toBe(10000);
    expect(y.seviye).toBe('yuksek');
    expect(y.ilk3Pay).toBe(100);
    expect(y.ilkN).toBe(1);
    expect(y.neden).toBeNull();
  });

  it('3 · boş liste → payda-yok; HHI 0 ("düşük") UYDURULMAZ', () => {
    const y = yogunlasma<Musteri>([], ciroSec);
    expect(y.neden).toBe('payda-yok');
    expect(y.hhi).toBeNull();
    expect(y.seviye).toBeNull();
    expect(y.ilk3Pay).toBeNull();
    expect(y.endeksDisiCiro).toBeNull();
    expect(y.ilkN).toBe(0);
    expect(y.toplam).toEqual({ toplam: 0, bilinen: 0, bilinmeyen: 0 });
    expect(y.bilinmeyenSatir).toBe(0);
    // Mutasyon: `payda <= 0` kapısı silinirse boş `reduce` 0 döner → hhi === 0, 'dusuk'.
    expect(y.hhi).not.toBe(0);
  });

  it('4 · hepsi ₺0 → payda-yok (eski panel sessizce kayboluyordu); iadelerle toplam ≤ 0 da payda-yok', () => {
    const sifir = yogunlasma([m('Şirin İnşaat', 0), m('Yılmaz Yapı', 0)], ciroSec);
    expect(sifir.neden).toBe('payda-yok');
    expect(sifir.hhi).toBeNull();
    expect(sifir.seviye).toBeNull();
    expect(sifir.ilk3Pay).toBeNull();
    expect(sifir.ilkN).toBe(2);
    expect(sifir.toplam).toEqual({ toplam: 0, bilinen: 2, bilinmeyen: 0 });
    // Neden SIRASI: payda ≤ 0 iken negatif satır olsa bile önce 'payda-yok' (kumulatifPaylar ile aynı iki kapı).
    const eksi = yogunlasma([m('Şirin İnşaat', 100), m('Demir Beton', -200)], ciroSec);
    expect(eksi.neden).toBe('payda-yok');
    expect(eksi.hhi).toBeNull();
    expect(eksi.endeksDisiCiro).toBeNull();
  });

  it('5 · eşik 1.500 SINIR DAHİL ORTA (O4, `>=`); 1.550 orta; 1.400 düşük', () => {
    // Paylar 20·20·20·10·10·5·5·5·5 → Σ² = 1.500 (node ile ölçüldü: tam 1500).
    const tam = yogunlasma(bayiler([20000, 20000, 20000, 10000, 10000, 5000, 5000, 5000, 5000]), ciroSec);
    expect(tam.hhi).toBe(1500);
    expect(Math.round(tam.hhi as number)).toBe(1500);
    expect(tam.seviye).toBe('orta');
    // Mutasyon: eski `> 1500` → 'low'. Eski ifade yeniden kurulup gösterilir (BİLİNÇLİ FARK 7).
    expect(eskiGb2({ a: 20000, b: 20000, c: 20000, d: 10000, e: 10000, f: 5000, g: 5000, h: 5000, i: 5000 }).seviye).toBe('low');
    // Paylar 20·20·20·15·5·5·5·5·5 → Σ² = 1.550.
    const ust = yogunlasma(bayiler([20000, 20000, 20000, 15000, 5000, 5000, 5000, 5000, 5000]), ciroSec);
    expect(Math.round(ust.hhi as number)).toBe(1550);
    expect(ust.seviye).toBe('orta');
    // Paylar 20·20·10·10·10·10·10·10 → Σ² = 1.400.
    const alt = yogunlasma(bayiler([20000, 20000, 10000, 10000, 10000, 10000, 10000, 10000]), ciroSec);
    expect(Math.round(alt.hhi as number)).toBe(1400);
    expect(alt.seviye).toBe('dusuk');
  });

  it('6 · eşik 2.500 SINIR DAHİL ORTA (üst eşik `>` değişmedi); 2.600 yüksek; dört eşit müşteri 2.500 orta', () => {
    // Paylar 40·20·20·5·5·5·5 → Σ² = 2.500.
    const tam = yogunlasma(bayiler([40, 20, 20, 5, 5, 5, 5]), ciroSec);
    expect(tam.hhi).toBe(2500);
    expect(tam.seviye).toBe('orta');
    // Paylar 40·20·20·10·10 → Σ² = 2.600.
    const ust = yogunlasma(bayiler([40, 20, 20, 10, 10]), ciroSec);
    expect(Math.round(ust.hhi as number)).toBe(2600);
    expect(ust.seviye).toBe('yuksek');
    // Dört eşit müşteri — HHI'nın alt sınırı 10.000 / 4 = 2.500.
    const esit = yogunlasma([
      m('Şirin İnşaat', 250000), m('Yılmaz Yapı', 250000), m('Kaya Hırdavat', 250000), m('Demir Beton', 250000),
    ], ciroSec);
    expect(esit.hhi).toBe(2500);
    expect(esit.seviye).toBe('orta');
    expect(esit.ilk3Pay).toBeCloseTo(75, 9);
  });

  it('7 · sınıf YUVARLANMIŞ HHI\'dan (ekrandaki sayı ile rozet çelişmez) — iki eşikte de', () => {
    // Payda 1.000: 400 · 201 · 199 · 50 ×4 → ham ≈ 2.500,02 (> 2.500), yuvarlanmış 2.500 → orta.
    const ust = yogunlasma(bayiler([400, 201, 199, 50, 50, 50, 50]), ciroSec);
    expect(ust.hhi as number).toBeGreaterThan(2500);
    expect(Math.round(ust.hhi as number)).toBe(2500);
    // Mutasyon: ham `hhi > yuksek` → 'yuksek'.
    expect(ust.seviye).toBe('orta');
    // Payda 1.000: 200 · 199 · 199 · 115 · 87 · 50 ×4 → ham 1.499,96 (< 1.500), yuvarlanmış 1.500 → orta.
    const alt = yogunlasma(bayiler([200, 199, 199, 115, 87, 50, 50, 50, 50]), ciroSec);
    expect(alt.hhi as number).toBeLessThan(1500);
    expect(Math.round(alt.hhi as number)).toBe(1500);
    // Mutasyon: ham `hhi >= orta` → 'dusuk'.
    expect(alt.seviye).toBe('orta');
  });

  it('8 · bilinmeyen tutar 0 SAYILMAZ: tek okunamayan değer HHI\'yı ve ilk 3 payını durdurur (O4 katı)', () => {
    // Kısmi müşteri cirosu: ekranTutari 100.000 basardı; TÜRETME kapısı (tamTutar) NaN → HHI kurulmaz.
    const y = yogunlasma([m('Şirin İnşaat', T(100000, 2, 1)), m('Yılmaz Yapı', T(50000, 1, 0))], ciroSec);
    expect(y.neden).toBe('payda-bilinmiyor');
    expect(y.hhi).toBeNull();
    expect(y.seviye).toBeNull();
    expect(y.ilk3Pay).toBeNull();
    expect(y.endeksDisiCiro).toBeNull();
    expect(y.bilinmeyenSatir).toBe(1);
    expect(y.toplam.bilinmeyen).toBe(1);
    expect(y.toplam.toplam).toBe(150000);
    expect(y.ilkN).toBe(2);
    // Ham değerler: undefined / 'abc' / NaN / Infinity / null HER BİRİ bilinmeyen; '500000' sayısal metin BİLİNEN.
    const ham = yogunlasma([
      m('Şirin İnşaat', undefined), m('Yılmaz Yapı', 'abc'), m('Kaya Hırdavat', NaN),
      m('Demir Beton', Infinity), m('Çelik Yapı', null), m('Öztürk Hırdavat', '500000'),
    ], ciroSec);
    expect(ham.bilinmeyenSatir).toBe(5);
    expect(ham.toplam).toEqual({ toplam: 500000, bilinen: 1, bilinmeyen: 5 });
    // Mutasyon: `|| 0` / `Number(x) || 0` → tek bilinen müşteri %100 → hhi 10.000, neden null.
    expect(ham.neden).toBe('payda-bilinmiyor');
    expect(ham.hhi).toBeNull();
    // Yalnız sayısal metin: bilinen sayılır, hesap yapılır.
    expect(yogunlasma([m('Öztürk Hırdavat', '500000')], ciroSec).hhi).toBe(10000);
    // ₺0 + okunamayan "ciro yok" DEĞİLDİR. Mutasyon: payda `ekranTutari` ile kurulursa kısmi toplam 0 →
    // 'payda-yok' ("veri yok" ile "okunamadı" karışır).
    const sifirVeBilinmez = yogunlasma([m('Şirin İnşaat', 0), m('Yılmaz Yapı', undefined)], ciroSec);
    expect(sifirVeBilinmez.neden).toBe('payda-bilinmiyor');
    expect(sifirVeBilinmez.toplam).toEqual({ toplam: 0, bilinen: 1, bilinmeyen: 1 });
  });

  it('9 · negatif net müşteri (iade) → negatif-pay; eski GB2 formülü 10.000\'i AŞIYORDU (16.250)', () => {
    const satirlar = [m('Şirin İnşaat', 1000), m('Demir Beton', -200)];
    const y = yogunlasma(satirlar, ciroSec);
    expect(y.neden).toBe('negatif-pay');
    expect(y.hhi).toBeNull();
    expect(y.seviye).toBeNull();
    expect(y.ilk3Pay).toBeNull();
    expect(y.endeksDisiCiro).toBeNull();
    expect(y.toplam).toEqual({ toplam: 800, bilinen: 2, bilinmeyen: 0 });
    // Arızanın kanıtı: eski ifade 0–10.000 ölçeğinin dışına taşıyor.
    const eski = eskiGb2({ 'Şirin İnşaat': 1000, 'Demir Beton': -200 });
    expect(Math.round(eski.hhi)).toBe(16250);
    expect(eski.hhi).toBeGreaterThan(10000);
    // Atfedilemeyen ciro negatifse de negatif-pay. Mutasyon (atfedilemeyen işareti denetlenmezse):
    // ilk3Pay = 1.000 / 900 → %111 ve hhi 10.000 dönerdi.
    const atfEksi = yogunlasma([m('Şirin İnşaat', 1000)], ciroSec, { atfedilemeyen: T(-100, 1, 0) });
    expect(atfEksi.neden).toBe('negatif-pay');
    expect(atfEksi.hhi).toBeNull();
    expect(atfEksi.ilk3Pay).toBeNull();
    expect(atfEksi.endeksDisiCiro).toBeNull();
  });

  it('10 · atfedilemeyen (kimliksiz) ciro: ilk 3 paydasına GİRER (K21), HHI\'ya GİRMEZ (O4) — iki payda', () => {
    const iki = [m('Şirin İnşaat', 60000), m('Yılmaz Yapı', 40000)];
    const y = yogunlasma(iki, ciroSec, { atfedilemeyen: T(100000, 3, 0) });
    expect(y.toplam).toEqual({ toplam: 200000, bilinen: 5, bilinmeyen: 0 });
    // Mutasyon A: atfedilemeyen ilk 3 paydasına katılmazsa 100.
    expect(y.ilk3Pay).toBe(50);
    expect(y.ilkN).toBe(2);
    // Mutasyon B: atfedilemeyen HHI paydasına katılırsa paylar 30·20 → 1.300 'dusuk'.
    // Mutasyon C: eski 'atfedilemeyen-ciro' durdurması → hhi null.
    expect(y.hhi).toBe(5200);
    expect(y.seviye).toBe('yuksek');
    expect(y.endeksDisiCiro).toBe(100000);
    expect(y.neden).toBeNull();
    expect(y.bilinmeyenSatir).toBe(0);

    // İkinci kol: musteriOzeti'nin "kimliksiz YOK" hâli — boş Tutar GERÇEK 0'dır, hiçbir şeyi engellemez.
    const bos = yogunlasma(iki, ciroSec, { atfedilemeyen: T(0, 0, 0) });
    expect(bos.hhi).toBe(5200);
    expect(bos.ilk3Pay).toBe(100);
    expect(bos.endeksDisiCiro).toBe(0);
    expect(bos.neden).toBeNull();

    // Üçüncü kol (O4 katı): atfedilemeyende okunamayan tutar → HHI ve ilk 3 durur; sayaç ÇİFT sayılmaz.
    const bilinmez = yogunlasma(iki, ciroSec, { atfedilemeyen: T(0, 0, 2) });
    expect(bilinmez.neden).toBe('payda-bilinmiyor');
    expect(bilinmez.hhi).toBeNull();
    expect(bilinmez.ilk3Pay).toBeNull();
    expect(bilinmez.endeksDisiCiro).toBeNull();
    expect(bilinmez.toplam).toEqual({ toplam: 100000, bilinen: 2, bilinmeyen: 2 });
    expect(bilinmez.bilinmeyenSatir).toBe(0);

    // Dördüncü kol: müşteri satırı YOK, yalnız kimliksiz ciro → HHI kurulamaz, ilk 3 de (ilkN 0).
    const satirsiz = yogunlasma<Musteri>([], ciroSec, { atfedilemeyen: T(10000, 2, 0) });
    expect(satirsiz.ilkN).toBe(0);
    expect(satirsiz.ilk3Pay).toBeNull();
    expect(satirsiz.hhi).toBeNull();
    expect(satirsiz.seviye).toBeNull();
    expect(satirsiz.endeksDisiCiro).toBe(10000);
    expect(satirsiz.neden).toBe('atfedilebilen-yok');

    // Beşinci kol: müşterili siparişlerin hepsi ₺0 → ilk 2'nin payı GERÇEK 0; HHI 0/0 değil, null.
    const sifirlar = yogunlasma([m('Şirin İnşaat', 0), m('Yılmaz Yapı', 0)], ciroSec, { atfedilemeyen: T(10000, 1, 0) });
    expect(sifirlar.neden).toBe('atfedilebilen-yok');
    // Mutasyon: `hhiPaydasi <= 0` kapısı silinirse 0/0 → NaN.
    expect(sifirlar.hhi).toBeNull();
    expect(sifirlar.seviye).toBeNull();
    expect(sifirlar.ilk3Pay).toBe(0);
    expect(sifirlar.ilkN).toBe(2);
    expect(sifirlar.endeksDisiCiro).toBe(10000);
  });

  it('11 · ilk 3 AZALAN ciroya göre seçilir (girdi sırası değil); HHI sıradan bağımsız', () => {
    const karisik = [
      m('Demir Beton', 50000), m('Şirin İnşaat', 500000), m('Kaya Hırdavat', 150000), m('Yılmaz Yapı', 300000),
    ];
    const y = yogunlasma(karisik, ciroSec);
    // Mutasyon: sıralama silinirse girdinin ilk üçü → 70.
    expect(y.ilk3Pay).toBeCloseTo(95, 9);
    expect(y.hhi as number).toBeCloseTo(yogunlasma(DORT_MUSTERI, ciroSec).hhi as number, 9);
    // Girdi dizisinin sırası değişmedi (sıralama yerel kopyada).
    expect(karisik.map(s => s.ad)).toEqual(['Demir Beton', 'Şirin İnşaat', 'Kaya Hırdavat', 'Yılmaz Yapı']);
  });

  it('12 · K16 bilinçli farkı: GB4\'ün 0,10 orta eşiği KALKTI — 1.400 artık yalnız "düşük" (eskiden GB4 "Moderate")', () => {
    const cirolar = [20000, 20000, 10000, 10000, 10000, 10000, 10000, 10000];
    const y = yogunlasma(bayiler(cirolar), ciroSec);
    expect(y.seviye).toBe('dusuk');
    const kova = Object.fromEntries(cirolar.map((v, i) => [`Bayi ${i + 1}`, v]));
    const eski4 = eskiGb4(kova);
    expect(eski4.concentration).toBe('Moderate');
    expect(eskiGb2(kova).seviye).toBe('low');
    // Ölçek paritesi: 0–1 × 10.000 = 0–10.000.
    expect(eski4.hhi * 10000).toBeCloseTo(y.hhi as number, 6);
  });

  it('13 · MUTASYONSUZLUK: donmuş dizi + donmuş öğeler + donmuş atfedilemeyen → hata yok, sonuç test 1 ile aynı', () => {
    const atf: Tutar = Object.freeze(T(0, 0, 0));
    const girdi: readonly Musteri[] = Object.freeze(DORT_MUSTERI.map(s => Object.freeze(m(s.ad, s.ciro))));
    const kopya = JSON.stringify(girdi);
    let y: YogunlasmaSonucu | undefined;
    expect(() => { y = yogunlasma(girdi, ciroSec, { atfedilemeyen: atf }); }).not.toThrow();
    expect(y).toEqual(yogunlasma(DORT_MUSTERI, ciroSec));
    expect(JSON.stringify(girdi)).toBe(kopya);
    expect(atf).toEqual({ toplam: 0, bilinen: 0, bilinmeyen: 0 });
    // Dönen `toplam` girdinin takma adı DEĞİL (çağıran onu değiştirirse girdi bozulmasın).
    const satirsiz = yogunlasma<Musteri>([], ciroSec, { atfedilemeyen: atf });
    expect(satirsiz.toplam).toEqual(atf);
    expect(satirsiz.toplam).not.toBe(atf);
    // Donmuş `Tutar` öğeleri (`sec` verilmeden) de çalışır.
    const donmus: readonly Tutar[] = Object.freeze([Object.freeze(T(60000, 2, 0)), Object.freeze(T(40000, 1, 0))]);
    expect(yogunlasma(donmus).hhi).toBe(5200);
  });

  it('14 · DEĞİŞMEZLER: HHI aralığı, hhi ⇔ seviye ⇔ neden, ilk 3 ∈ [0, 100], endeksDisiCiro ⇔ neden', () => {
    const hesaplanan: { ad: string; satirlar: readonly Musteri[]; atfedilemeyen?: Tutar }[] = [
      { ad: 'test 1', satirlar: DORT_MUSTERI },
      { ad: 'test 2', satirlar: [m('Şirin İnşaat', 250000)] },
      { ad: 'test 5 · 1.500', satirlar: bayiler([20000, 20000, 20000, 10000, 10000, 5000, 5000, 5000, 5000]) },
      { ad: 'test 5 · 1.550', satirlar: bayiler([20000, 20000, 20000, 15000, 5000, 5000, 5000, 5000, 5000]) },
      { ad: 'test 5 · 1.400', satirlar: bayiler([20000, 20000, 10000, 10000, 10000, 10000, 10000, 10000]) },
      { ad: 'test 6 · 2.500', satirlar: bayiler([40, 20, 20, 5, 5, 5, 5]) },
      { ad: 'test 6 · 2.600', satirlar: bayiler([40, 20, 20, 10, 10]) },
      { ad: 'test 6 · eşit', satirlar: bayiler([250000, 250000, 250000, 250000]) },
      { ad: 'test 7 · üst', satirlar: bayiler([400, 201, 199, 50, 50, 50, 50]) },
      { ad: 'test 7 · alt', satirlar: bayiler([200, 199, 199, 115, 87, 50, 50, 50, 50]) },
      { ad: 'test 10', satirlar: [m('Şirin İnşaat', 60000), m('Yılmaz Yapı', 40000)], atfedilemeyen: T(100000, 3, 0) },
      { ad: 'test 10 · boş', satirlar: [m('Şirin İnşaat', 60000), m('Yılmaz Yapı', 40000)], atfedilemeyen: T(0, 0, 0) },
      { ad: '₺0 müşterili', satirlar: [m('Şirin İnşaat', 0), m('Yılmaz Yapı', 100)] },
    ];
    const durdurulan: typeof hesaplanan = [
      { ad: 'boş', satirlar: [] },
      { ad: 'hepsi ₺0', satirlar: [m('Şirin İnşaat', 0), m('Yılmaz Yapı', 0)] },
      { ad: 'bilinmeyen', satirlar: [m('Şirin İnşaat', T(100000, 2, 1)), m('Yılmaz Yapı', 50000)] },
      { ad: 'negatif', satirlar: [m('Şirin İnşaat', 1000), m('Demir Beton', -200)] },
      { ad: 'atfedilemeyen bilinmiyor', satirlar: [m('Şirin İnşaat', 60000)], atfedilemeyen: T(0, 0, 2) },
      { ad: 'satırsız', satirlar: [], atfedilemeyen: T(10000, 2, 0) },
      { ad: '₺0 + kimliksiz', satirlar: [m('Şirin İnşaat', 0), m('Yılmaz Yapı', 0)], atfedilemeyen: T(10000, 1, 0) },
    ];
    for (const v of hesaplanan) {
      const y = yogunlasma(v.satirlar, ciroSec, v.atfedilemeyen === undefined ? undefined : { atfedilemeyen: v.atfedilemeyen });
      expect(y.hhi, v.ad).not.toBeNull();
      const n = v.satirlar.length;
      expect(y.hhi as number, v.ad).toBeGreaterThanOrEqual(10000 / n - 1e-9);
      expect(y.hhi as number, v.ad).toBeLessThanOrEqual(10000 + 1e-9);
    }
    for (const v of [...hesaplanan, ...durdurulan]) {
      const y = yogunlasma(v.satirlar, ciroSec, v.atfedilemeyen === undefined ? undefined : { atfedilemeyen: v.atfedilemeyen });
      expect(y.hhi === null, v.ad).toBe(y.seviye === null);
      expect(y.seviye === null, v.ad).toBe(y.neden !== null);
      if (y.ilk3Pay !== null) {
        expect(y.ilk3Pay, v.ad).toBeGreaterThanOrEqual(0);
        expect(y.ilk3Pay, v.ad).toBeLessThanOrEqual(100 + 1e-9);
      }
      expect(y.endeksDisiCiro !== null, v.ad).toBe(y.neden === null || y.neden === 'atfedilebilen-yok');
      if (y.endeksDisiCiro !== null) {
        expect(y.endeksDisiCiro, v.ad).toBe(v.atfedilemeyen === undefined ? 0 : tamTutar(v.atfedilemeyen));
        expect(y.endeksDisiCiro, v.ad).toBeGreaterThanOrEqual(0);
      }
      expect(y.ilkN, v.ad).toBe(Math.min(3, v.satirlar.length));
    }
  });

  it('15 · HHI_ESIKLERI değeri kilit (K16 — değişirse kullanıcı kararı gerekir)', () => {
    expect(HHI_ESIKLERI).toEqual([1500, 2500]);
  });

  it('16 · O21: TRY dışı mağaza siparişi bu yardımcıya ULAŞMAZ (ayrım çağıranda); ulaşırsa ₺0 sayılmaz, dovizTutar TL\'ye eklenmez', () => {
    interface TestSiparisi {
      source?: string; paraBirimi?: string; dovizTutar?: unknown; totalPrice?: unknown;
      customerName?: string; status?: string; createdAt?: string;
    }
    const siparisler: TestSiparisi[] = [
      { customerName: 'Şirin İnşaat', totalPrice: 60000, status: 'Delivered', createdAt: '2026-09-01T09:00:00+03:00' },
      { customerName: 'Yılmaz Yapı', totalPrice: 40000, status: 'Delivered', createdAt: '2026-09-02T09:00:00+03:00' },
      // Sunucu TRY dışı mağaza siparişine `totalPrice` YAZMAZ (`dovizTutar` + `paraBirimi` yazar).
      {
        source: 'shopify_webhook', paraBirimi: 'EUR', dovizTutar: 50,
        customerName: 'Kaya Hırdavat', status: 'Delivered', createdAt: '2026-09-03T09:00:00+03:00',
      },
    ];
    const secenek = { tutarSec: raporSiparisi, tarihSec: (o: TestSiparisi) => zamanMs(o.createdAt) };
    const iptalsiz = siparisler.filter(o => !siparisIptalMi(o));

    // (a) Süzgeçsiz: yardımcının sözleşmesi aynen — tutarı okunamayan sipariş bilinmeyen sayılır.
    const ham = musteriOzeti(iptalsiz, secenek);
    const a = yogunlasma(ham.musteriler, s => s.ciro, { atfedilemeyen: ham.kimliksizCiro });
    expect(a.neden).toBe('payda-bilinmiyor');
    expect(a.hhi).toBeNull();
    expect(a.bilinmeyenSatir).toBe(1);
    // Mutasyon: yardımcıya / tutarOku'ya `dovizTutar` yedeği eklenirse 100.050 olur.
    expect(a.toplam.toplam).toBe(100000);

    // (b) Çağıran reçetesiyle (§ İMZA «Çağrı»): ÖNCE iptal, SONRA TRY dışı ayrımı.
    const dovizli = iptalsiz.filter(tryDisiMi).length;
    const ozet = musteriOzeti(iptalsiz.filter(o => !tryDisiMi(o)), secenek);
    const b = yogunlasma(ozet.musteriler, s => s.ciro, { atfedilemeyen: ozet.kimliksizCiro });
    expect(dovizli).toBe(1);
    expect(b.neden).toBeNull();
    expect(b.hhi).toBe(5200);
    expect(b.ilk3Pay).toBe(100);
    expect(b.ilkN).toBe(2);
    expect(b.toplam.bilinmeyen).toBe(0);
    expect(b.endeksDisiCiro).toBe(0);
  });

  it('17 · `sec` verilmezse öğenin KENDİSİ (sayı ya da Tutar); bozuk sayaçlı Tutar HHI üretmez', () => {
    expect(yogunlasma([60000, 40000]).hhi).toBe(5200);
    const tutarlar = yogunlasma([T(60000, 2, 0), T(40000, 1, 0)]);
    expect(tutarlar.hhi).toBe(5200);
    expect(tutarlar.toplam).toEqual({ toplam: 100000, bilinen: 3, bilinmeyen: 0 });
    const eksik = yogunlasma([60000, undefined]);
    expect(eksik.neden).toBe('payda-bilinmiyor');
    expect(eksik.bilinmeyenSatir).toBe(1);
    // Savunma: sayaçları birbirini götüren bozuk Tutar'lar (+1 / −1) toplamı "tam" gösterir ama satır tam DEĞİL
    // → HHI NaN üretip 'dusuk' rozeti basmaz.
    const bozuk = yogunlasma([T(100, 1, 1), T(50, 1, -1)]);
    expect(bozuk.neden).toBe('payda-bilinmiyor');
    expect(bozuk.hhi).toBeNull();
    expect(bozuk.seviye).toBeNull();
    expect(bozuk.ilk3Pay).toBeNull();
    const bozukAtf = yogunlasma([T(50, 1, -1)], undefined, { atfedilemeyen: T(100, 1, 1) });
    expect(bozukAtf.neden).toBe('payda-bilinmiyor');
    expect(bozukAtf.hhi).toBeNull();
  });
});
