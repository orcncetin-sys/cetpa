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
import { olcekReferansi, cubukOrani, tutarSatiri, type CubukSatiri } from './cubuk';
import { toplaBilinen } from '../para';

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
