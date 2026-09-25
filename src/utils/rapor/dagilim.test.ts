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

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 6b EKİ (2026-09-24): `siraliDilimler` — sıralı EŞİT dilimler (desil / çeyreklik), POZİSYONA göre
// A · GenelBloklar3.tsx:21-57 (P256 desil):
//   :22  `orders.filter(o => o.status !== 'Cancelled' && (o.totalPrice || 0) > 0)` → bilinmeyen '0' sayılıp eleniyor (sayılmıyor)
//   :24  `sort((a, b) => (a.totalPrice || 0) - (b.totalPrice || 0))`             → bilinmeyen D1'e
//   :25  `decileSize = Math.ceil(n / 10)`; `slice(i*size, (i+1)*size)`            → 'tavan' bölmesi
// B · GenelBloklar3.tsx:120-157 (çeyreklik):
//   :121 `sort((a,b) => a.totalPrice - b.totalPrice)`                              → KORUMASIZ: NaN karşılaştırıcı
//   :123 `q = Math.floor(n / 4)`; `slice(3q)` son dilim kalanı alır                → 'taban' bölmesi
//   :133 `reduce((s, o) => s + o.totalPrice, 0)`                                    → tek bilinmeyen TÜM çeyreği NaN yapar
// İki bölme kuralı da KORUNUR (K28 parite) — seçenekle. Pay hesabı BURADA DEĞİL (utils-yogunlasma).
// ═══════════════════════════════════════════════════════════════════════════════════════════
import { siraliDilimler } from './dagilim';
import { ekranTutari, tamTutar, tutarBirlestir } from '../para';

/** 1..n arası TL tutarlı Şirin İnşaat siparişleri: 100, 200, …, n×100. */
const seri = (n: number): Siparis[] => Array.from({ length: n }, (_, i) => sip((i + 1) * 100));

describe('siraliDilimler — 6b eki', () => {
  it("PARİTE 'tavan' (desil, GB3:25 ceil): 10 sipariş → 10×1; 11 sipariş → [2,2,2,2,2,1,0,0,0,0]; boş dilim TÜRETMEYE KAPI DEĞİL", () => {
    const on = siraliDilimler(seri(10), tutarSec, 10, { bolme: 'tavan' });
    expect(on.dilimler.map(d => d.adet)).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
    expect(on.dilimler[0].ogeler[0].tutar).toBe(100);      // D1 = en KÜÇÜK
    expect(on.dilimler[9].ogeler[0].tutar).toBe(1000);     // D10 = en BÜYÜK
    expect(on.dilimler.map(d => d.sira)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

    // 11 sipariş: boyut = ceil(11/10) = 2 → D7-D10 BOŞ (bugünkü ceil davranışı; mutasyon: floor ya da
    // "eşit dağıt" düzeltmesi dağılımı değiştirir → parite bekçisi).
    const onbir = siraliDilimler(seri(11), tutarSec, 10, { bolme: 'tavan' });
    expect(onbir.dilimler.map(d => d.adet)).toEqual([2, 2, 2, 2, 2, 1, 0, 0, 0, 0]);
    expect(onbir.dilimler[5].tutar).toEqual({ toplam: 1100, bilinen: 1, bilinmeyen: 0 });
    // GB3 P1 kapısının KANITI: üst 3 dilim boş → yardımcı bunu "tutarsız" diye ETİKETLEMEZ
    expect(onbir.dilimler.slice(-3).every(d => d.adet === 0)).toBe(true);
    const ust = tutarBirlestir(...onbir.dilimler.slice(-3).map(d => d.tutar));
    expect(ust).toEqual({ toplam: 0, bilinen: 0, bilinmeyen: 0 });
    expect(tamTutar(ust)).toBe(0);                          // NaN DEĞİL — "boş liste gerçek 0" (para.ts)
    expect(onbir.toplam.bilinmeyen).toBe(0);
    // Kapısız `yuzdeOrani(0, toplam)` → %0 = bugünkü "Üst %30 → %0 ciro" yanlışı;
    // PAY KAPISI ÇAĞIRANDADIR: `dilimler.slice(-3).every(d => d.adet > 0)`.
    expect(onbir.dilimler.slice(-3).every(d => d.adet > 0)).toBe(false);
    expect(tamTutar(onbir.toplam)).toBe(6600);              // 100+…+1100

    // 25 sipariş: boyut = 3 → [3×8, 1, 0]
    const yirmibes = siraliDilimler(seri(25), tutarSec, 10, { bolme: 'tavan' });
    expect(yirmibes.dilimler.map(d => d.adet)).toEqual([3, 3, 3, 3, 3, 3, 3, 3, 1, 0]);
    expect(yirmibes.dilimler.slice(-3).every(d => d.adet > 0)).toBe(false);
  });

  it("PARİTE 'taban' (çeyreklik, GB3:123-129 floor): 10 sipariş → [2,2,2,4] (artık SON dilimde; mutasyon: ceil → [3,3,3,1])", () => {
    const r = siraliDilimler(seri(10), tutarSec, 4, { bolme: 'taban' });
    expect(r.dilimler.map(d => d.adet)).toEqual([2, 2, 2, 4]);
    expect(r.dilimler[3].ogeler.map(o => o.tutar)).toEqual([700, 800, 900, 1000]);
    expect(r.dilimler[3].tutar).toEqual({ toplam: 3400, bilinen: 4, bilinmeyen: 0 });
  });

  it('MUTASYON-AYIRT EDİCİ: bilinmeyen değer dilime (sıralamaya bile) GİRMEZ, `bilinmeyen` sayılır (mutasyon: `|| 0` → D1 şişer)', () => {
    const liste = [sip(400), sip(undefined), sip(100), sip(null), sip(300), sip('abc'), sip(200)];
    const r = siraliDilimler(liste, tutarSec, 4, { bolme: 'tavan' });
    expect(r.bilinmeyen).toBe(3);
    expect(r.dilimler.reduce((t, d) => t + d.adet, 0)).toBe(4);
    expect(r.dilimler.map(d => d.adet)).toEqual([1, 1, 1, 1]);
    expect(r.dilimler[0].ogeler[0].tutar).toBe(100);        // D1 gerçek en küçük, '0'lar değil
    expect(r.dilimler.every(d => d.tutar.bilinmeyen === 0)).toBe(true);
  });

  it('`sadecePozitif`: bilinen `<= 0` değer dilime girmez, `kapsamDisi` sayılır (mutasyon: sessiz filter → sayaç 0)', () => {
    const liste = [sip(-500), sip(0), sip(100)];
    const pozitif = siraliDilimler(liste, tutarSec, 2, { bolme: 'tavan', sadecePozitif: true });
    expect(pozitif.kapsamDisi).toBe(2);                     // negatif + MEŞRU 0
    expect(pozitif.bilinmeyen).toBe(0);
    expect(pozitif.dilimler.reduce((t, d) => t + d.adet, 0)).toBe(1);
    expect(pozitif.dilimler[0].ogeler[0].tutar).toBe(100);

    const hepsi = siraliDilimler(liste, tutarSec, 2, { bolme: 'tavan' });
    expect(hepsi.kapsamDisi).toBe(0);
    expect(hepsi.dilimler.reduce((t, d) => t + d.adet, 0)).toBe(3);
    expect(hepsi.dilimler[0].ogeler.map(o => o.tutar)).toEqual([-500, 0]);   // varsayılan: her değer girer (çeyreklik paritesi)
  });

  it('MUTASYON-AYIRT EDİCİ: `toplam` TÜRETMEYE KAPALI — bilinmeyen sayacı TAŞINIR; `kapsamDisi` tamTutar\'ı BOZMAZ', () => {
    const r = siraliDilimler([sip(200), sip(300), sip(500), sip(undefined)], tutarSec, 2, { bolme: 'tavan' });
    expect(ekranTutari(r.toplam)).toBe(1000);
    expect(Number.isNaN(tamTutar(r.toplam))).toBe(true);    // sayaç taşınmazsa 1000 döner → "Üst %30 → %42" eksik veriyle basılır
    expect(r.toplam).toEqual({ toplam: 1000, bilinen: 3, bilinmeyen: 1 });
    expect(r.toplam.bilinmeyen).toBe(r.bilinmeyen);

    const k = siraliDilimler([sip(200), sip(300), sip(-50)], tutarSec, 2, { bolme: 'tavan', sadecePozitif: true });
    expect(k.kapsamDisi).toBe(1);
    expect(tamTutar(k.toplam)).toBe(500);                   // okunmuş ama kapsam dışı → bilinmez YAPMAZ
  });

  it('eşit değerler: sıralama girdi sırasını korur (kararlı), dilimler POZİSYONA göre bölünür (aynı tutar iki dilimde)', () => {
    const liste = Array.from({ length: 5 }, (_, i) => ({ ...sip(500), musteri: `Şirin İnşaat ${i + 1}` }));
    const r = siraliDilimler(liste, tutarSec, 2, { bolme: 'tavan' });
    expect(r.dilimler.map(d => d.adet)).toEqual([3, 2]);
    expect(r.dilimler[0].ogeler.map(o => o.musteri)).toEqual(['Şirin İnşaat 1', 'Şirin İnşaat 2', 'Şirin İnşaat 3']);
    expect(r.dilimler[1].ogeler.map(o => o.musteri)).toEqual(['Şirin İnşaat 4', 'Şirin İnşaat 5']);
    expect(r.dilimler[0].ogeler[0]).toBe(liste[0]);         // nesne kimliği korunur
  });

  it("az kayıt: n=2, 4 dilim → 'taban' [0,0,0,2] (q=0, bugünkü davranış), 'tavan' [1,1,0,0]", () => {
    const liste = seri(2);
    expect(siraliDilimler(liste, tutarSec, 4, { bolme: 'taban' }).dilimler.map(d => d.adet)).toEqual([0, 0, 0, 2]);
    expect(siraliDilimler(liste, tutarSec, 4, { bolme: 'tavan' }).dilimler.map(d => d.adet)).toEqual([1, 1, 0, 0]);
  });

  it('boş liste: tüm dilimler adet 0 / tutar {0,0,0}; toplam {0,0,0}; sayaçlar 0 (dilim sayısı SABİT)', () => {
    for (const bolme of ['tavan', 'taban'] as const) {
      const r = siraliDilimler([], tutarSec, 4, { bolme });
      expect(r.dilimler).toHaveLength(4);
      expect(r.dilimler.map(d => d.adet)).toEqual([0, 0, 0, 0]);
      expect(r.dilimler.every(d => d.tutar.toplam === 0 && d.tutar.bilinen === 0 && d.tutar.bilinmeyen === 0)).toBe(true);
      expect(r.toplam).toEqual({ toplam: 0, bilinen: 0, bilinmeyen: 0 });
      expect(r.bilinmeyen).toBe(0);
      expect(r.kapsamDisi).toBe(0);
    }
  });

  it('geçersiz dilimSayisi → throw (sessizce yanlış bölme YOK)', () => {
    for (const n of [0, -2, 2.5, NaN]) {
      expect(() => siraliDilimler(seri(3), tutarSec, n, { bolme: 'tavan' }), String(n)).toThrow();
    }
  });

  it('DEĞİŞMEZ + mutasyon yok: Σ adet + bilinmeyen + kapsamDisi === liste.length; donuk girdi hata atmaz; girdi sırası değişmez', () => {
    const liste = Object.freeze([sip(900), sip(undefined), sip(-10), sip(300), sip(0), sip('abc'), sip(150)]
      .map(o => Object.freeze(o)));
    const oncesi = liste.map(o => o.tutar);
    const r = siraliDilimler(liste, tutarSec, 3, { bolme: 'taban', sadecePozitif: true });
    const adet = r.dilimler.reduce((t, d) => t + d.adet, 0);
    expect(adet + r.bilinmeyen + r.kapsamDisi).toBe(liste.length);
    expect(r.bilinmeyen).toBe(2);
    expect(r.kapsamDisi).toBe(2);
    expect(liste.map(o => o.tutar)).toEqual(oncesi);        // `[...liste]` kopyası üzerinde sıralandı
    // Bilinen pozitifler [150, 300, 900] → n=3, 3 dilim 'taban' → boyut 1: D1 [150], D2 [300], D3 [900]
    expect(r.dilimler.map(d => d.adet)).toEqual([1, 1, 1]);
    expect(r.dilimler.map(d => d.ogeler.map(o => o.tutar))).toEqual([[150], [300], [900]]);
  });
});
