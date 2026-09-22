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
import { oranYuzde } from '../siparisler/lojistikKpi';

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

/**
 * ADET / sayı serilerinin ölçeği — En büyük BİLİNEN pozitif değer; hiç pozitif yoksa `null`
 * (→ hiçbir çubuk ÇİZİLMEZ). Faz 3 6a (2026-09-19) ADDITIVE eklendi.
 *
 * ## NEDEN BURADA (yeni modül DEĞİL)
 * Aynı sözleşme `hedefButce.enBuyukHafta`da ZATEN vardı ama imzası `Hafta`ya kilitliydi
 * (`{ indeks, ciro, deger }`): adet kovası, saat dilimi ya da ay serisi geçirilemiyordu.
 * Beşinci bir ölçek fonksiyonu yazmak yerine ölçek kurallarının TEK EVİ olan bu modüle
 * alındı; `enBuyukHafta` gövdesi buna indi (imzası, JSDoc'u ve testleri AYNEN durur).
 *
 * ## HANGİSİ NE ZAMAN (ölçek ailesi — KOPYA YAZMA)
 *   • PARA çubukları → `olcekReferansi` + `cubukOrani` (girdi `CubukSatiri`; tepe satır
 *     KISMİYSE ölçek yoktur — tutarsız kayıt sayacına bakar).
 *   • `aylikCiro`/`gunlukCiro` dönem serileri → `ciroDonem.olcekTavani`.
 *   • Muhasebe gelir/gider ayları → `gelirGider.grafikTavani` + `cubukYuzdesi`.
 *   • ADET / sayı serileri → BU fonksiyon (girdi düz sayı dizisi; kısmilik sayacı YOK,
 *     çünkü adet ya bilinir ya bilinmez). Not: çağıran KISMİ bir ayı `null`layıp düz sayı
 *     dizisi verdiğinde para serisi de buradan ölçeklenebilir (P620 paritesi).
 *
 * ## SÖZLEŞME (sahte kesinlik yasağı)
 *   • `null` / `undefined` / `NaN` / `±Infinity` eleman YOK SAYILIR — tek bir okunamayan
 *     değer ölçeği bozmaz. Eski sayfa kodu süzgeçsiz `Math.max(...x, 1)` yazıyordu: tek NaN
 *     bütün ölçeği NaN yapıp o listedeki HER çubuğu söndürüyordu.
 *   • `≤ 0` değerler ölçek OLAMAZ; hepsi `≤ 0` ise `null` — `, 1` uydurma tabanı YOK.
 *     O taban boş seride bile her çubuğu "biraz dolu" çizdirip "az da olsa hareket var"
 *     izlenimi veriyordu (veri yok ≠ sıfıra yakın değer).
 *   • Boş dizi → `null`. Girdi MUTASYONA UĞRAMAZ (sıralama/kopyalama yok).
 *   • YÜZDE serilerinde ölçek HESAPLANMAZ: çağıran sabit `100` kullanır. `Math.max(oran, 1)`
 *     düşük oranları tavana yapıştırıyordu (%0,4 dolu çubuk → %100 görünüyordu).
 *
 * Oran için AYRI fonksiyon yok: mevcut testli `siparisler/lojistikKpi.oranYuzde(deger, olcek)`
 * kullanılır — `olcek` `null` geldiğinde oran da `null` olur, çubuk çizilmez.
 */
export function sayacOlcegi(degerler: readonly (number | null | undefined)[]): number | null {
  let en: number | null = null;
  for (const d of degerler) {
    if (!Number.isFinite(d) || d == null || d <= 0) continue;
    if (en === null || d > en) en = d;
  }
  return en;
}

/**
 * Sayı serisi çubuğunun ORANI — `sayacOlcegi`nin `null`unu okuyan TEK kural.
 * Faz 3 6a düzeltme turu (2026-09-22). ADDITIVE: mevcut export'ların sözleşmesi değişmedi.
 *
 * ## NEDEN BURADA (sayfa içinde DEĞİL)
 * Kural `RaporlarPage.tsx:67`de sayfa-içi `const` olarak duruyordu: export edilmediği için
 * hiçbir test onu göremiyordu ve `if (olcek === null) return 0;` satırını `return null;` yapan
 * mutasyon tek bir testi bile kırmadan hayatta kaldı. Oysa kapattığı arıza gerçek: ölçek
 * ailesinin (`olcekReferansi` / `cubukOrani` / `sayacOlcegi`) evi burası, oran kuralı da buraya
 * taşındı; iki üretim sitesi (P603 sparkline, P620 tahmin çubukları) yalnız içe aktarır.
 *
 * ## KURAL — "ölçek yok" ile "değer bilinmiyor" AYNI ŞEY DEĞİLDİR
 *   • Değer okunamıyor (NaN / ±Infinity) → `null`. `OlcekCubugu` `null`u BİLİNMİYOR sayar:
 *     tam boy gri TARALI çubuk + `aria-label="bilinmiyor"`.
 *   • Değer biliniyor ama seride hiç pozitif yok (`sayacOlcegi` → `null`) → `0`: çubuk
 *     ÇİZİLMEZ. Burada da `null` dönseydi, son üç ayda hiç aday açılmamışken (üç ayın üçü de
 *     GERÇEK 0) üç taralı çubuk çizilir; hemen üstteki kart "Dönem Toplamı: 0", çubuğun ipucu
 *     da "Eyl 26: 0" derken ekran kendisiyle çelişirdi.
 *   • Aksi hâlde `oranYuzde(deger, olcek)` — oran kuralı İKİNCİ KEZ yazılmaz (payda ≤ 0 →
 *     `null` sözleşmesi de oradan gelir).
 */
export function seriCubukOrani(deger: number, olcek: number | null): number | null {
  if (!Number.isFinite(deger)) return null;
  if (olcek === null) return 0;
  return oranYuzde(deger, olcek);
}
