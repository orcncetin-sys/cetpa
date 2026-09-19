/**
 * cubuk.ts — pano ölçek çubuklarının TEK kuralı (Faz 3 5/n hakem turu, 2026-09-19).
 * Test: `cubuk.test.ts` (önce yazıldı, kırmızı görüldü). Saf modül: React/DB/metin yok.
 *
 * ## NEDEN VAR
 * Kural `musteriAnaliz.ts` içinde DOĞRU yazılmıştı ama oraya kapalıydı; aynı sayfadaki
 * "En Çok Satan Ürünler" paneli (DashboardPage 2049 + 2127) kendi kuralını kuruyordu:
 *
 *     const maxRevTop = top5.reduce((m, p) => (p.ciro.bilinen > 0 && p.ciro.toplam > m ? p.ciro.toplam : m), 0);
 *     const pay = oranYuzde(ekranTutari(p.ciro), maxRevTop);
 *
 * Yani ölçek KISMİ bir tepeden alınıyor, çubuk da kısmi bir satır cirosundan çiziliyordu:
 * 500 adetlik fiyatsız satırı olan ÇİMENTO, gerçekte listenin tepesindeyken ekranda
 * %67'lik kısa bir çubukla ikinci sırada görünüyordu. "1 satır tutarsız" notu basılsa
 * bile çubuk yanlış bir sıralama izlenimi veriyordu — ve hesap sayfada olduğu için testi
 * de yoktu. Kural artık tek yerde ve testli; iki modül de buradan okur (KOPYA YAZMA).
 *
 * ## SÖZLEŞME (src/utils/para.ts)
 * Çubuk oranı TÜRETİLEN sayıdır: tek girdi bile bilinmiyorsa hesaplanmaz (`null` → çubuk
 * ÇİZİLMEZ). Ölçeğin kendisi de türetmedir: tepe satır kısmiyse ölçek YOKTUR (NaN) ve o
 * listede hiçbir çubuk çizilmez. Satırın gösterilen tutarı ise EKRAN toplamıdır
 * (`ekranTutari`) — kısmi olabilir, yanında "N kayıt tutarsız" notu durur.
 */
import { ekranTutari, sayiSirala, type Tutar } from '../para';

/** Ölçek çubuğu için gereken asgari alanlar. */
export interface CubukSatiri {
  /** EKRAN toplamı (kısmi olabilir; NaN = hiç bilinen yok). */
  ciro: number;
  /**
   * Bu satırda **TUTARI** bilinmeyen kayıt sayısı — başka hiçbir sayaç buraya KONMAZ.
   * (2026-09-19: GenelBloklar1 buraya maliyet bilinmeyenlerini de topluyordu; cirosu TAM
   * bilinen tepe ayın tek bir siparişinin maliyeti çözülemediğinde ölçek NaN oluyor ve ALTI
   * ayın ciro çubuğu birden kayboluyordu. Köprüyü elle kurma: `tutarSatiri` kullan.)
   */
  tutarsizSiparis: number;
}

/**
 * `Tutar` → çubuk satırı köprüsü. Ekran kuralı `ekranTutari`den gelir; burada İKİNCİ bir
 * kopya yazılmaz (stokSevkiyat'taki yerel `ekranCiro` tam olarak o kopyaydı, silindi).
 */
export function tutarSatiri(t: Tutar): CubukSatiri {
  return { ciro: ekranTutari(t), tutarsizSiparis: t.bilinmeyen };
}

/**
 * Çubukların ölçeği: EN BÜYÜK satırın cirosu — ama o satır kısmiyse (ya da bilinmiyorsa, ya da
 * ≤ 0 ise) ölçek YOKTUR (NaN). Kısmi bir tepeye göre çizilen çubuk alt satırları olduğundan
 * uzun gösterir; eski kod `maxRev = top5[0].revenue` ile tam bunu yapıyordu.
 */
export function olcekReferansi(satirlar: readonly CubukSatiri[]): number {
  let en: CubukSatiri | null = null;
  for (const s of satirlar) {
    if (en === null || sayiSirala(s.ciro, en.ciro, true) < 0) en = s;
  }
  if (en === null || en.tutarsizSiparis > 0) return NaN;
  return Number.isFinite(en.ciro) && en.ciro > 0 ? en.ciro : NaN;
}

/** Satırın çubuk oranı (%). Ölçek yoksa ya da satırın kendi cirosu kısmi/bilinmiyorsa `null`. */
export function cubukOrani(satir: CubukSatiri, referans: number): number | null {
  if (!Number.isFinite(referans)) return null;
  if (satir.tutarsizSiparis > 0 || !Number.isFinite(satir.ciro)) return null;
  return (satir.ciro / referans) * 100;
}
