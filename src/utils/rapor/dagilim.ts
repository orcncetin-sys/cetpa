/**
 * dagilim.ts — rapor ekranlarının DEĞER KOVASI (histogram) çekirdeği. Test: dagilim.test.ts (önce yazıldı).
 * Faz 3 6/n (rapor ekranları), 2026-09-19.
 *
 * NEDEN VAR — "sayısal değeri sınır listesine göre kovala" işi kodda 10+ panelde elle yazılmış,
 * her kopyada aynı iki sahte kesinlik hatasıyla. Ölçülen ilk site
 * src/components/reports/genel/GenelOzet.tsx:168-205 (Phase 189 "Sipariş Değeri Dağılımı"):
 *   178  `const v = o.totalPrice || 0;`
 *   180  `const b = buckets189.find(b => v >= b.min && v < b.max);`
 *   181  `if (b) { b.count++; b.total += v; }`
 * (1) Tutarı bilinmeyen sipariş ₺0 sayılıp `'<₺1K'` kovasını şişiriyor — histogramın sol ucu
 *     gerçek küçük siparişlerle değil, VERİ EKSİĞİYLE dolu görünüyor.
 * (2) `find` eşleşmezse (negatif tutar; ya da son sınır sonlu olduğunda taşan değer) öğe
 *     SESSİZCE düşüyor — hiçbir yerde izi kalmıyor.
 * Kural (CLAUDE.md "sahte kesinlik gösterme"): bilinmeyen sayı 0 DEĞİL bilinmiyordur, toplama
 * girmez ve SAYILIR; sessiz eleme de yoktur, ayrı sayılır. Bu modül o kararı tek yerde uygular.
 *
 * PARİTE: bilinen ve kapsam içi girdide adetler ve kova toplamları P189 ile BİREBİR aynıdır
 * (dagilim.test.ts test 1: `500, 1000, 4999, 250000` → `[1, 2, 0, 0, 1]`).
 *
 * BİLİNÇLİ FARKLAR (rakamı değiştirenler — hepsi yukarıdaki iki arızanın düzeltmesi):
 *   • Tutarı bilinmeyen öğe artık ilk kovada DEĞİL, `bilinmeyen` sayacında.
 *   • Kapsam dışı (negatif / sonlu son sınırı aşan) öğe artık `kapsamDisi` sayacında.
 *   • Kova toplamı çıplak `number` değil `Tutar` — kısmi toplam + bilinen/bilinmeyen sayaçları
 *     (`tutarSec` JIT olarak eklendiğinde kova içi bilinmeyen tutar da sayılabilsin diye).
 * Çağıran bu iki sayacı ekranda göstermeli (CLAUDE.md: '—' ya da açık not).
 *
 * KAPSAM DIŞI (bilerek): iptal süzgeci bu modülde YOK. Rapor ekranlarında ciro = iptaller hariç
 * (kullanıcı kararı K2, 2026-09-19: "İptaller ciroya girsin mi → hayır") ve bu kural TEK yerde,
 * `raporCirosu`/çağıranın süzgecinde durur — kovalayıcı kendisine ne verilirse onu kovalar.
 *
 * DOKUNULMADI: `muhasebe/arYaslandirma.yasKovasi` (sabit 4 yaş kovası) ve
 * `siparisler/tahsilatVade` (vade kovaları) alacak yaşlandırmasının AYRI sözleşmesidir
 * (gelecek tarihli kayıt 0–30 kovasına düşer) — buraya indirilmez.
 */
import { bilinenSayi, type Tutar } from '../para';
import { BOS_TUTAR, kovayaEkle } from '../pano/raporVeriKatmani';

/** Tek bir kovanın tanımı: etiket + ÜST sınır (HARİÇ). Son kova için `ust: Infinity` (üst taşma olmaz). */
export interface KovaSiniri {
  etiket: string;
  /** ÜST sınır, HARİÇ. Son kova için `Infinity`. */
  ust: number;
}

/** Dolu kova: `[alt, ust)` aralığı, öğe adedi, kova içi `Tutar` ve öğelerin kendisi (girdi sırasında). */
export interface DegerKovasi<T> {
  etiket: string;
  alt: number;
  ust: number;
  adet: number;
  tutar: Tutar;
  ogeler: T[];
}

/**
 * İlk kovanın ALT sınırı — SABİT. Bunun altındaki (negatif) değer hiçbir kovaya girmez,
 * `kapsamDisi` sayılır. Negatif değerin de kovalanması gerektiğinde 4. parametre
 * `secenek?: { alt?: number }` ADDITIVE eklenecek (JIT: ilk üretim tüketicisi 6f CB8 yaş dağılımı);
 * 3 parametreli çağrılar aynen derlenir.
 */
const ILK_KOVA_ALT = 0;

/**
 * `liste`yi `degerSec`in verdiği sayıya göre `sinirlar`daki kovalara dağıtır.
 *
 * - Kova aralığı `[alt, ust)`; ilk kovanın `alt`'ı `ILK_KOVA_ALT`, sonrakilerin `alt`'ı bir
 *   öncekinin `ust`'u. Kovalar `sinirlar` sırasında ve BOŞ kovalar dâhil döner (histogram şekli sabit).
 * - `degerSec` bilinmiyorsa (`bilinenSayi` false) öğe hiçbir kovaya girmez → `bilinmeyen++`.
 *   Meşru `0` bilinen bir sayıdır, ilk kovaya girer.
 * - Değer ilk `alt`'ın altında ya da son `ust`'un üstünde/eşitse → `kapsamDisi++` (sessiz eleme yok).
 * - `sinirlar` artan olmalıdır; değilse `throw` (sessizce yanlış kovaya yazmak yerine gürültü).
 *   Boş `sinirlar` ise bilinen her değer `kapsamDisi` olur — çağıranın ekranında görünür.
 * - Girdi (liste ve sınırlar) mutasyona uğramaz; `ogeler` girdi sırasını ve nesne kimliğini korur.
 *
 * DEĞİŞMEZ: `Σ kovalar.adet + bilinmeyen + kapsamDisi === liste.length`.
 */
export function kovayaYerlestir<T>(
  liste: readonly T[],
  degerSec: (o: T) => unknown,
  sinirlar: readonly KovaSiniri[],
): { kovalar: DegerKovasi<T>[]; bilinmeyen: number; kapsamDisi: number } {
  const kovalar: DegerKovasi<T>[] = [];
  let alt = ILK_KOVA_ALT;
  for (const s of sinirlar) {
    // `!(ust > alt)` NaN'ı da yakalar: sınırın kendisi bilinmiyorsa kovalama anlamsızdır.
    if (!(s.ust > alt)) {
      throw new Error(
        `kovayaYerlestir: sınırlar artan olmalı — '${s.etiket}' üst sınırı ${String(s.ust)}, ` +
        `önceki üst sınır (bu kovanın alt sınırı) ${String(alt)}.`,
      );
    }
    kovalar.push({ etiket: s.etiket, alt, ust: s.ust, adet: 0, tutar: BOS_TUTAR, ogeler: [] });
    alt = s.ust;
  }

  let bilinmeyen = 0;
  let kapsamDisi = 0;
  for (const oge of liste) {
    const ham = degerSec(oge);
    if (!bilinenSayi(ham)) { bilinmeyen++; continue; }   // `|| 0` DEĞİL: bilinmeyen kovayı şişirmez
    const deger = Number(ham);
    const kova = kovalar.find(k => deger >= k.alt && deger < k.ust);
    if (kova === undefined) { kapsamDisi++; continue; } // P189'un sessiz düşürdüğü öğe: artık sayılıyor
    kova.adet++;
    kova.tutar = kovayaEkle(kova.tutar, ham);           // BOS_TUTAR donmuş; kovayaEkle YENİ nesne döner
    kova.ogeler.push(oge);
  }

  return { kovalar, bilinmeyen, kapsamDisi };
}
