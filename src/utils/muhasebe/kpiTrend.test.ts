/**
 * kpiTrend.test.ts — Dönem trendi (toplam / aylık ortalama / aylık değişim) ve hedef
 * gerçekleşme oranının SÖZLEŞMESİ (Faz 3 2/n hakem turu, grup "hook", 2026-09-18). ÖNCE YAZILDI.
 *
 * NEDEN VAR — hakem bulgusu: RaporlarPage Trend (603) ve KPI Hedef (570) blokları türetme
 * kapısını AY TOPLAMI üzerinden kuruyordu. `ekranTutari` kısmi bir ayı SONLU bir sayı olarak
 * döndürdüğü için "ay içinde bir fatura okunamadı" bilgisi bir üst katta kayboluyor, sonra
 * `toplaBilinen(aylar)` o sonlu değeri "bilinen" sayıp `tamTutar` kapısını AÇIYORDU:
 * ekran aynı anda hem "+100,0%" hem "1 siparişin tutarı okunamadı — ... hesaplanamıyor" diyordu.
 * Kural (para.ts): EKRAN toplamı kısmi olabilir (+ not); TÜRETİLEN sayı (ortalama/oran/değişim)
 * bir kayıt bile eksikse üretilmez. Kapı bu yüzden KAYIT sayacından geçer, ay toplamından değil.
 */
import { describe, it, expect } from 'vitest';
import { trendOzeti, hedefOrani } from './kpiTrend';

/** Ay noktası — değer zaten `ekranTutari` ile üretilmiş (kısmi ay SONLU, bomboş ay NaN). */
const ay = (deger: number) => ({ deger });

describe('trendOzeti — ekran toplamı KISMİ olabilir, türetilen sayılar olamaz', () => {
  it('hiçbir kayıt okunamamış değilse toplam, ortalama ve değişim hesaplanır', () => {
    // Ağustos Şirin İnşaat ₺100.000 → Eylül Çelik Yapı ₺200.000
    const t = trendOzeti([ay(100_000), ay(200_000)], 0);
    expect(t.toplam).toBe(300_000);
    expect(t.ortalama).toBe(150_000);
    expect(t.degisim).toBe(100);
    expect(t.turetilebilir).toBe(true);
  });

  it('MUTASYON AYIRT EDİCİ: ay İÇİNDE tek bir kayıt okunamadıysa aylar SONLU olsa bile ortalama/değişim ÜRETİLMEZ', () => {
    // Eylül'de ₺200.000 bilinen + meblağı NULL bir Mikro faturası: ay toplamı 200.000 (sonlu),
    // ama dönemde 1 tutarsız kayıt var. Kapı ay toplamından kurulursa bu vaka "+100,0%" basar.
    const t = trendOzeti([ay(100_000), ay(200_000)], 1);
    expect(t.toplam).toBe(300_000);              // EKRAN: kısmi toplam basılır (+ sayfa notu)
    expect(Number.isNaN(t.ortalama)).toBe(true); // TÜRETME: '—'
    expect(t.degisim).toBeNull();
    expect(t.turetilebilir).toBe(false);
  });

  it('tamamı okunamayan ay (NaN) toplama girmez, SAYILIR — türetme yine kapalı', () => {
    const t = trendOzeti([ay(100_000), ay(NaN)], 2);
    expect(t.toplam).toBe(100_000);
    expect(Number.isNaN(t.ortalama)).toBe(true);
    expect(t.degisim).toBeNull();
  });

  it('hiç bilinen ay yoksa dönem toplamı da "—" (NaN)', () => {
    const t = trendOzeti([ay(NaN), ay(NaN)], 3);
    expect(Number.isNaN(t.toplam)).toBe(true);
    expect(Number.isNaN(t.ortalama)).toBe(true);
    expect(t.degisim).toBeNull();
  });

  it('hareketsiz dönem GERÇEK 0: boş aylar bilinmeyen değildir', () => {
    const t = trendOzeti([ay(0), ay(0)], 0);
    expect(t.toplam).toBe(0);
    expect(t.ortalama).toBe(0);
    expect(t.degisim).toBeNull();               // payda 0 → "%0 değişim" BASILMAZ
  });

  it('payda ≤ 0 iken değişim null — "%0" ile "bilinmiyor" aynı şey değil', () => {
    expect(trendOzeti([ay(0), ay(5_000)], 0).degisim).toBeNull();
    expect(trendOzeti([ay(-5_000), ay(5_000)], 0).degisim).toBeNull();
  });

  it('düşüş negatif yüzde verir (işaret korunur)', () => {
    expect(trendOzeti([ay(200_000), ay(150_000)], 0).degisim).toBe(-25);
  });

  it('tek aylık dönemde değişim yok (önceki ay yok)', () => {
    expect(trendOzeti([ay(100_000)], 0).degisim).toBeNull();
  });

  it('hiç ay yoksa: toplam gerçek 0, ortalama hesaplanamaz (0 aya bölme yok)', () => {
    const t = trendOzeti([], 0);
    expect(t.toplam).toBe(0);
    expect(Number.isNaN(t.ortalama)).toBe(true);
    expect(t.degisim).toBeNull();
  });

  it('sayaç 0 ama son/önceki ay bilinmiyorsa değişim yine null', () => {
    // Savunma: sayaç ile ay dizisi tutarsız beslenirse (çağrı yeri hatası) uydurma yapılmaz.
    expect(trendOzeti([ay(100_000), ay(NaN)], 0).degisim).toBeNull();
  });
});

describe('hedefOrani — gerçekleşme yüzdesi TÜRETİLEN sayıdır', () => {
  it('hedefin yarısı → %50', () => {
    expect(hedefOrani(100_000, 200_000)).toBe(50);
  });

  it('hedef aşılsa bile çubuk %100 ile sınırlı (mevcut davranış korunur)', () => {
    expect(hedefOrani(300_000, 200_000)).toBe(100);
  });

  it('MUTASYON AYIRT EDİCİ: gerçekleşen bilinmiyorsa (kısmi ciro → NaN) oran null, "%0" değil', () => {
    expect(hedefOrani(NaN, 200_000)).toBeNull();
  });

  it('hedef girilmemiş ya da ≤ 0 ise oran null', () => {
    expect(hedefOrani(100_000, 0)).toBeNull();
    expect(hedefOrani(100_000, -5)).toBeNull();
    expect(hedefOrani(100_000, NaN)).toBeNull();
  });

  it('gerçekleşen 0 GERÇEK 0 (hiç satış olmayan ay) → %0', () => {
    expect(hedefOrani(0, 200_000)).toBe(0);
  });
});
