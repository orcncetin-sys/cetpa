/**
 * cubuk.test.ts — pano ölçek çubuklarının TEK kuralı (Faz 3 5/n hakem turu, 2026-09-19).
 * ÖNCE YAZILDI (kırmızı görüldü: modül yoktu), sonra `cubuk.ts` yazıldı.
 *
 * NEDEN VAR: aynı sayfada İKİ ÇELİŞEN çubuk kuralı çalışıyordu.
 *   • `musteriAnaliz` (Phase 77 / 124): satırın cirosu kısmiyse çubuk çizilmez, tepe satır
 *     kısmiyse ölçek hiç kurulmaz.
 *   • DashboardPage 2049/2127 "En Çok Satan Ürünler": ölçek kısmi tepeden alınıyor
 *     (`p.ciro.bilinen > 0 && p.ciro.toplam > m`) ve her satır `oranYuzde(ekranTutari(...))`
 *     ile çiziliyordu — fiyatsız satırı olan ürün olduğundan KISA görünüyor, kullanıcı
 *     yanlış bir sıralama izlenimi alıyordu.
 *
 * Kural (src/utils/para.ts TÜRETME sözleşmesi): oran/çubuk türetilen sayıdır — tek girdi
 * bile bilinmiyorsa HESAPLANMAZ (null → çubuk çizilmez).
 */
import { describe, it, expect } from 'vitest';
import { olcekReferansi, cubukOrani, tutarSatiri, sayacOlcegi, seriCubukOrani, type CubukSatiri } from './cubuk';
import { toplaBilinen, type Tutar } from '../para';
import { enBuyukHafta, type Hafta } from './hedefButce';
import { oranYuzde } from '../siparisler/lojistikKpi';

/** Şirin İnşaat / ÇİMENTO 50KG evreninden satırlar (₺). */
const tam = (ciro: number): CubukSatiri => ({ ciro, tutarsizSiparis: 0 });
const kismi = (ciro: number, tutarsiz = 1): CubukSatiri => ({ ciro, tutarsizSiparis: tutarsiz });

describe('olcekReferansi — ölçek yalnız TAM bir tepe satırdan kurulur', () => {
  it('tepe satır tamsa ölçek onun cirosudur (eski `maxRev = top5[0].revenue` paritesi)', () => {
    expect(olcekReferansi([tam(1500), tam(1000), tam(250)])).toBe(1500);
  });

  it('sıra bozuk verilse de EN BÜYÜK satır bulunur', () => {
    expect(olcekReferansi([tam(250), tam(1500), tam(1000)])).toBe(1500);
  });

  it('tepe satır KISMİYSE ölçek yoktur (mutasyon-ayırt-edici)', () => {
    // ÇİMENTO'nun 500 adetlik fiyatsız satırı var: kısmi ₺1.000 tepeye göre çizilen
    // çubuk alt satırları olduğundan uzun gösterir.
    expect(Number.isNaN(olcekReferansi([kismi(1000), tam(900)]))).toBe(true);
  });

  it('boş liste ve ≤ 0 tepe: ölçek yok (0\'a bölme / negatif genişlik yok)', () => {
    expect(Number.isNaN(olcekReferansi([]))).toBe(true);
    expect(Number.isNaN(olcekReferansi([tam(0), tam(0)]))).toBe(true);
    expect(Number.isNaN(olcekReferansi([tam(-50)]))).toBe(true);
  });

  /**
   * Cirosu HİÇ bilinmeyen satır (NaN) tepe sayılmaz: `sayiSirala` onu her yönde sona koyar.
   * Ölçek bilinen en büyükten kurulur, o satır yalnız kendi çubuğunu kaybeder — aksi hâlde
   * tek bir tutarsız kayıt tüm listenin çubuklarını söndürürdü.
   */
  it('cirosu bilinmeyen satır tepe SAYILMAZ, ölçek bilinen en büyükten kurulur', () => {
    expect(olcekReferansi([{ ciro: NaN, tutarsizSiparis: 1 }, tam(800)])).toBe(800);
    expect(olcekReferansi([{ ciro: NaN, tutarsizSiparis: 2 }, tam(900)])).toBe(900);
  });
});

describe('cubukOrani — kısmi satır çubuk çizdirmez', () => {
  it('BİLİNEN ₺0 satır ölçek yokken de 0 (taralı "bilinmiyor" DEĞİL) — tüm pencere ₺0 (inceleme 2026-09-25)', () => {
    expect(cubukOrani(tam(0), NaN)).toBe(0);
    const satirlar = [tam(0), tam(0), tam(0)];
    const olcek = olcekReferansi(satirlar);
    expect(Number.isNaN(olcek)).toBe(true);
    expect(satirlar.map(s => cubukOrani(s, olcek))).toEqual([0, 0, 0]);
    // kısmi ₺0 (bilinen 0 + okunamayan kayıt) hâlâ bilinmiyor
    expect(cubukOrani(kismi(0), NaN)).toBeNull();
    expect(cubukOrani(kismi(0), 1000)).toBeNull();
  });
  it('parite: tam satırda oran `(ciro / referans) * 100`', () => {
    expect(cubukOrani(tam(750), 1500)).toBeCloseTo(50, 9);
    expect(cubukOrani(tam(1500), 1500)).toBe(100);
  });

  it('satır kısmiyse null — kısmi ciro çubuğa DÖNÜŞMEZ (mutasyon-ayırt-edici)', () => {
    // Eski sayfa: oranYuzde(1000, 1500) = %66,7 çiziyordu.
    expect(cubukOrani(kismi(1000), 1500)).toBeNull();
  });

  it('satırın cirosu hiç bilinmiyorsa null', () => {
    expect(cubukOrani({ ciro: NaN, tutarsizSiparis: 3 }, 1500)).toBeNull();
  });

  it('ölçek yoksa (NaN) hiçbir satır çubuk almaz', () => {
    expect(cubukOrani(tam(750), NaN)).toBeNull();
  });

  it('meşru ₺0 ciro: çubuk GENİŞLİĞİ 0, null değil (bilinen sıfır ≠ bilinmiyor)', () => {
    expect(cubukOrani(tam(0), 1500)).toBe(0);
  });
});

describe('tutarSatiri — `Tutar` → çubuk satırı köprüsü (kopya ekran kuralı YOK)', () => {
  it('bilinen toplam + bilinmeyen sayacı taşınır', () => {
    const t = toplaBilinen([130, 260, null], x => x);
    expect(tutarSatiri(t)).toEqual({ ciro: 390, tutarsizSiparis: 1 });
  });

  it('hiç bilinen yoksa ciro NaN (ekranda "—") ve çubuk çizilmez', () => {
    const t = toplaBilinen([null, undefined], x => x);
    const satir = tutarSatiri(t);
    expect(Number.isNaN(satir.ciro)).toBe(true);
    expect(cubukOrani(satir, 1000)).toBeNull();
  });

  it('boş liste GERÇEK 0 (hareketsiz kova)', () => {
    expect(tutarSatiri(toplaBilinen([], x => x))).toEqual({ ciro: 0, tutarsizSiparis: 0 });
  });

  /**
   * MUTASYON AYIRT EDİCİ — ölçek kapısına YALNIZ ciro `Tutar`ı girer (2026-09-19 delta bulgusu).
   * GenelBloklar1:45 `tutarsizSiparis`e `ciroTutar.bilinmeyen + maliyetTutar.bilinmeyen`
   * koyuyordu: cirosu TAM bilinen tepe ayın tek bir siparişinin maliyeti çözülemeyince ölçek
   * NaN oluyor ve ALTI ayın ciro çubuğu birden '—' oluyordu (ekrandaki neden de yanlıştı:
   * "tutar eksik" diyordu, oysa tutar tamdı). Köprü artık `tutarSatiri(m.ciroTutar)`.
   */
  it('cirosu TAM bilinen tepe ay ölçeği kurar — maliyet sayacı buraya HİÇ girmez', () => {
    const ciroTutarlari = [
      toplaBilinen([500_000], x => x),   // Eylül — tepe, tutarı tam (maliyeti çözülemedi)
      toplaBilinen([300_000], x => x),
      toplaBilinen([120_000], x => x),
    ];
    const satirlar = ciroTutarlari.map(tutarSatiri);
    const olcek = olcekReferansi(satirlar);
    expect(olcek).toBe(500_000);
    expect(satirlar.map(s => cubukOrani(s, olcek))).toEqual([100, 60, 24]);
    // Eski köprü (`tutarsizSiparis: 0 + 1`) tepe satırı kısmi sayıp hepsini söndürüyordu:
    const eskiKopru = satirlar.map((s, i) => ({ ...s, tutarsizSiparis: s.tutarsizSiparis + (i === 0 ? 1 : 0) }));
    expect(Number.isNaN(olcekReferansi(eskiKopru))).toBe(true);
  });
});

/**
 * sayacOlcegi — ADET / sayı serilerinin ölçeği (Faz 3 6a, 2026-09-19).
 *
 * NEDEN BURADA: aynı sözleşme `hedefButce.enBuyukHafta`da ZATEN vardı ("bilinen en büyük
 * değer; hiç bilinen pozitif yoksa null") ama imzası `Hafta`ya (`{indeks, ciro, deger}`)
 * kilitliydi — adet kovası, saat dilimi ya da ay serisi geçirilemiyordu. Beşinci bir ölçek
 * fonksiyonu yazmak yerine ölçek kurallarının tek evi olan `cubuk.ts`'e alındı; `enBuyukHafta`
 * gövdesi buraya indi (imzası ve testleri AYNEN durur — aşağıda çapraz parite vakası).
 *
 * Ayırt edici mutasyon: eski sayfa kodu `Math.max(...sayilar, 1)` yazıyordu —
 *   (a) tek bir NaN bütün ölçeği NaN yapıyor, o listede hiçbir çubuk çizilmiyordu;
 *   (b) `, 1` uydurma tabanı BOŞ seride bile her çubuğu "biraz dolu" gösteriyordu.
 */
describe('sayacOlcegi — adet/sayı serilerinin ölçeği (ADDITIVE, 6a)', () => {
  it('parite (`enBuyukHafta` vektörleri): en büyük bilinen; hiç bilinen yoksa null', () => {
    expect(sayacOlcegi([50_000, 12_000])).toBe(50_000);
    expect(sayacOlcegi([null])).toBeNull();
    expect(sayacOlcegi([0, 0, 0])).toBeNull(); // hepsi ₺0 → ölçek yok
  });

  it('MUTASYON-AYIRT EDİCİ: tek NaN ölçeği BOZMAZ (süzgeçsiz `Math.max` NaN döndürürdü)', () => {
    expect(sayacOlcegi([3, NaN, 7, undefined, null])).toBe(7);
  });

  it('MUTASYON-AYIRT EDİCİ: uydurma taban YOK — boş seri ve yalnız sıfır null (`Math.max(..., 1)` → 1)', () => {
    expect(sayacOlcegi([])).toBeNull();
    expect(sayacOlcegi([0])).toBeNull();
  });

  it('negatif / sıfır ölçek OLAMAZ; aralarındaki pozitif ölçeği kurar', () => {
    expect(sayacOlcegi([-5, 0])).toBeNull();
    expect(sayacOlcegi([-5, 2])).toBe(2);
  });

  it('±Infinity elenir (bölmeden gelen taşma ölçeği ele geçirmez)', () => {
    expect(sayacOlcegi([Infinity, 4])).toBe(4);
    expect(sayacOlcegi([-Infinity, 4])).toBe(4);
  });

  /**
   * ÇAPRAZ PARİTE — `enBuyukHafta` gövdesinin bu fonksiyona indiğinin kanıtı.
   * Fikstür: Şirin İnşaat'ın 8 haftalık ÇİMENTO 50KG cirosu (₺); 2 numaralı haftada
   * tutarı okunamayan tek sipariş var → o haftanın `deger`i null (₺0 DEĞİL).
   */
  it('çapraz parite: enBuyukHafta(h) === sayacOlcegi(h.map(x => x.deger))', () => {
    const tutar = (bilinenler: readonly number[], bilinmeyen = 0): Tutar =>
      toplaBilinen([...bilinenler, ...Array.from({ length: bilinmeyen }, () => null)], x => x);
    const haftalar: Hafta[] = [
      { indeks: 0, ciro: tutar([]), deger: 0 },                 // sipariş yok → gerçek ₺0
      { indeks: 1, ciro: tutar([12_000]), deger: 12_000 },
      { indeks: 2, ciro: tutar([], 1), deger: null },           // yalnız tutarsız kayıt
      { indeks: 3, ciro: tutar([50_000]), deger: 50_000 },      // tepe
    ];
    expect(sayacOlcegi(haftalar.map(h => h.deger))).toBe(50_000);
    expect(enBuyukHafta(haftalar)).toBe(sayacOlcegi(haftalar.map(h => h.deger)));

    const bosSeri: Hafta[] = [{ indeks: 0, ciro: tutar([], 2), deger: null }];
    expect(enBuyukHafta(bosSeri)).toBe(sayacOlcegi(bosSeri.map(h => h.deger)));
    expect(enBuyukHafta(bosSeri)).toBeNull();
  });

  /**
   * Oran AYRI fonksiyon değil: mevcut testli `lojistikKpi.oranYuzde` kullanılır
   * (ölçek null → oran null → çubuk ÇİZİLMEZ; KOPYA oran kuralı yazılmaz).
   */
  it('oranYuzde ile birlikte: ölçek yoksa çubuk çizilmez', () => {
    expect(oranYuzde(3, sayacOlcegi([3, 6]))).toBe(50);
    expect(oranYuzde(3, sayacOlcegi([0]))).toBeNull();
    expect(oranYuzde(0, sayacOlcegi([0, 4]))).toBe(0); // bilinen 0 adet: çubuk genişliği 0
  });

  it('girdi mutasyona uğramaz (donmuş dizi hata vermez)', () => {
    const seri = Object.freeze([3, 9, 1]);
    expect(sayacOlcegi(seri)).toBe(9);
    expect(seri).toEqual([3, 9, 1]);
  });
});

/**
 * seriCubukOrani — ÖLÇEĞİN `null`unu okuyan tek kural (Faz 3 6a düzeltme turu, 2026-09-22).
 *
 * NEDEN VAR: kural `RaporlarPage.tsx:67`de sayfa-içi `const` olarak duruyordu, yani export
 * edilmediği için HİÇBİR test onu göremiyordu. Hakem `if (olcek === null) return 0;` satırını
 * `return null;` yaptı ve tek bir test bile kırılmadı — düzeltme turunun kapattığı arıza
 * korumasızdı. Aşağıdaki iki vaka tam o mutasyonu ayırt eder.
 */
describe('seriCubukOrani — "değer bilinmiyor" ile "seride hiç pozitif yok" AYNI ŞEY DEĞİL', () => {
  it('MUTASYON AYIRT EDİCİ: bilinen 0 + ölçeksiz seri → 0 (çubuk çizilmez), null DEĞİL', () => {
    // P603 'leads' metriği: son üç ayda hiç aday açılmamış (üçü de GERÇEK 0).
    const olcek = sayacOlcegi([0, 0, 0]);
    expect(olcek).toBeNull();                     // uydurma `, 1` tabanı yok
    expect(seriCubukOrani(0, olcek)).toBe(0);     // `return null` mutasyonu BURADA ölür
  });

  it('MUTASYON AYIRT EDİCİ: değer okunamıyorsa null (taralı çubuk) — 0 DEĞİL', () => {
    expect(seriCubukOrani(NaN, 50_000)).toBeNull();
    expect(seriCubukOrani(NaN, null)).toBeNull();     // değer kapısı ölçek kapısından ÖNCE
    expect(seriCubukOrani(Infinity, 50_000)).toBeNull();
  });

  it('ölçek varsa oran `oranYuzde` ile BİREBİR (kopya oran kuralı yazılmaz)', () => {
    // Şirin İnşaat'ın ÇİMENTO 50KG ayları (₺): tepe 50.000.
    const olcek = sayacOlcegi([12_000, 50_000, 25_000]);
    expect(olcek).toBe(50_000);
    expect(seriCubukOrani(25_000, olcek)).toBe(oranYuzde(25_000, 50_000));
    expect(seriCubukOrani(50_000, olcek)).toBe(100);
    expect(seriCubukOrani(0, olcek)).toBe(0);
  });

  it('negatif ölçek/değer: `oranYuzde` sözleşmesi aynen (payda ≤ 0 → null)', () => {
    expect(seriCubukOrani(5, 0)).toBeNull();
    expect(seriCubukOrani(5, -10)).toBeNull();
  });
});
