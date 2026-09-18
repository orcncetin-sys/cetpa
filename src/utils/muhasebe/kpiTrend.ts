/**
 * kpiTrend.ts — Dönem trendi (toplam / aylık ortalama / aylık değişim) ve hedef gerçekleşme
 * oranı, tek kaynak (Faz 3 2/n hakem turu, grup "hook", 2026-09-18).
 * Test: kpiTrend.test.ts (ÖNCE yazıldı).
 *
 * NEDEN VAR — RaporlarPage'in iki bloğu türetme kapısını YANLIŞ KATTA kuruyordu:
 *   Trend (603)     `tamTutar(toplaBilinen(aylar, a => a.value))`
 *   KPI Hedef (570) `Number.isFinite(kpi.actual)` — actual = `ekranTutari(ciro570)`
 * `ekranTutari` sözleşmesi gereği KISMİ bir ayı SONLU döndürür (ekranda kısmi toplam + not).
 * O sonlu değer bir üst kata çıkınca "ay içinde bir fatura okunamadı" bilgisi kayboluyor,
 * `toplaBilinen(aylar)` onu "bilinen" sayıyor ve `tamTutar` kapısı AÇILIYORDU: aynı ekran
 * hem "Aylık Değişim +100,0%" hem "1 siparişin tutarı okunamadı — ... hesaplanamıyor" diyordu.
 *
 * KURAL (para.ts ekranTutari/tamTutar ayrımı): EKRAN toplamı kısmi olabilir; TÜRETİLEN sayı
 * (ortalama, yüzde, değişim) bir KAYIT bile eksikse üretilmez. Bu yüzden kapı ay toplamından
 * değil, dönemdeki TUTARSIZ KAYIT SAYACINDAN geçer — Satış Tahmini (620) bloğunun
 * `tahminYapilabilir = tutarsiz620 === 0` kapısıyla aynı desen, artık tek yerde.
 */
import { toplaBilinen, ekranTutari } from '../para';

/** Grafikteki bir ay: değeri zaten `ekranTutari` ile üretilmiş (kısmi ay SONLU, bomboş ay NaN). */
export interface TrendAyi { deger: number }

export interface TrendOzeti {
  /** EKRAN sözleşmesi: bilinen ayların kısmi toplamı; hiç bilinen ay yoksa NaN ('—'). */
  toplam: number;
  /** TÜRETME: dönemde bir kayıt bile okunamadıysa ya da hiç ay yoksa NaN ('—'). */
  ortalama: number;
  /** TÜRETME: son aya göre yüzde değişim; üretilemezse null ('—', ASLA "%0"). */
  degisim: number | null;
  /** Türetilen sayılar üretilebilir mi (sayfa notunu de bu belirler). */
  turetilebilir: boolean;
}

/**
 * Dönem özeti.
 *
 * @param aylar         Grafik noktaları (ekran değerleriyle).
 * @param tutarsizKayit Dönem boyunca tutarı OKUNAMAYAN kayıt sayısı — ay toplamlarında
 *                      görünmez, çünkü kısmi ay sonlu bir sayıya çöker. Türetme kapısı budur.
 */
export function trendOzeti(aylar: readonly TrendAyi[], tutarsizKayit: number): TrendOzeti {
  const t = toplaBilinen(aylar, a => a.deger);
  const turetilebilir = tutarsizKayit === 0 && t.bilinmeyen === 0;

  const ortalama = turetilebilir && aylar.length > 0 ? t.toplam / aylar.length : NaN;

  const son = aylar[aylar.length - 1]?.deger ?? NaN;
  const onceki = aylar[aylar.length - 2]?.deger ?? NaN;
  // Payda ≤ 0 iken oran üretilmez: ₺0'dan ₺5.000'e çıkışın yüzdesi yoktur ("%∞" ya da "%0"
  // basmak sahte kesinliktir). Negatif payda da aynı — işareti ters çevrilmiş bir yüzde çıkardı.
  const degisim = turetilebilir && Number.isFinite(son) && Number.isFinite(onceki) && onceki > 0
    ? ((son - onceki) / onceki) * 100
    : null;

  return { toplam: ekranTutari(t), ortalama, degisim, turetilebilir };
}

/**
 * Hedef gerçekleşme yüzdesi. Gerçekleşen değer TÜRETME kapısından geçmiş olmalı
 * (kısmi ciro için `tamTutar`, ekran için `ekranTutari` — ikisi KARIŞTIRILMAZ):
 * kısmi bir cirodan "%50 gerçekleşme" üretmek, eksik faturanın büyüklüğü kadar yanlıştır.
 * Hedef girilmemiş (0) ya da negatifse de null — "%0 gerçekleşme" basılmaz.
 * Tavan %100: mevcut çubuk davranışı (parite), hedefi aşan KPI çubuğu taşmaz.
 */
export function hedefOrani(gerceklesen: number, hedef: number): number | null {
  if (!Number.isFinite(gerceklesen) || !Number.isFinite(hedef) || hedef <= 0) return null;
  return Math.min(100, (gerceklesen / hedef) * 100);
}
