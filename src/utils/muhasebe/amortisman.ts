/**
 * amortisman.ts — sabit kıymet amortismanının TEK kaynağı (Faz 3 5/n düzeltici turu, 2026-09-19).
 * Test: `amortisman.test.ts` (önce yazıldı, kırmızı görüldü). Saf modül: React/DB/kullanıcı metni yok.
 *
 * ## NEDEN VAR — sahte kesinlik sitesi
 *
 * Hesap `src/components/SabitKiymetModule.tsx` içinde sayfaya gömülüydü (`calcBirikmisSalinma`
 * ~99, `calcNetDeger` ~128) ve testi yoktu. Bilanço tarafı ise hesabı hiç yapmıyor,
 * `src/utils/pano/raporVeriKatmani.ts:196` dokümandaki `birikmisSalinma` alanını olduğu gibi
 * okuyordu. O alan "manuel override, 0 = hesaplansın" anlamındadır (SabitKiymetModule:37) ve
 * FORM VARSAYILANI tam olarak 0'dır (satır 320) — yani forma girilen her demirbaş Bilanço'ya
 * amortismansız, BRÜT alış bedeliyle "Net" diye giriyordu:
 *
 *     Forklift ₺1.200.000, 2022-09 alım, 5 yıl doğrusal
 *       SabitKiymet listesi (calcNetDeger) → ₺240.000
 *       Bilanço duran varlık (cost − 0)    → ₺1.200.000      ← aktif ve özkaynak ₺960.000 şişik
 *
 * Bir varlık, iki ekran, iki farklı net değer. Kural artık tek yerde ve testli; iki yüzey de
 * buradan okur (KOPYA YAZMA).
 *
 * ## SÖZLEŞME (src/utils/para.ts — TÜRETİLEN sayı)
 *
 * Amortisman türetmedir: alış bedeli, alış tarihi ya da faydalı ömür bilinmiyorsa HESAPLANMAZ
 * → `NaN` (ekranda '—'). Eski kod bu durumda 0 döndürüyordu, yani "amortismanı yok" diyordu;
 * "bilinmiyor" ile "sıfır" farkı duran varlık kaleminde ₺1.200.000'a kadar çıkabiliyor.
 * `birikmisSalinma > 0` ise o MANUEL OVERRIDE'dır: hesap yapılmaz, değer alış bedeliyle sınırlanır.
 *
 * ## PARİTE (bilinen girdide sayı eskiyle BİREBİR)
 *
 * Alış bedeli + tarihi + ömrü bilinen bir varlıkta doğrusal ve azalan-bakiyeler sonuçları
 * `calcBirikmisSalinma` / `calcNetDeger` / `calcYillikAmort` / `calcAylikAmort` ile aynıdır:
 * aynı 365,25 günlük yıl, aynı ömür sınırı (`Math.min`), aynı DDB döngüsü ve kesirli yıl kuralı,
 * aynı `Math.max(0, …)` tabanı.
 *
 * ## BİLİNÇLİ FARKLAR
 *  1. Bilinmeyen girdi 0 değil NaN (yukarıdaki sözleşme) — düzeltmenin kendisi.
 *  2. `amortYontemi` dalı DEĞİŞTİRİLMEDİ: eski kod `=== 'Doğrusal'` değilse azalan bakiyelere
 *     düşüyordu, yani yöntemi yazılmamış kayıt sessizce DDB oluyordu. Bu da bir varsayımdır ama
 *     bu turun kapsamı değil ve tetiklenebilir yüzeyi yok (form ve `demirbasEsle` yöntemi HER
 *     ZAMAN yazar). Davranışı çevirmek sessiz bir rakam değişikliği olurdu → Açık İşler.
 *  3. Para birimi burada ÇEVRİLMEZ: girdi ne cinsindeyse çıktı da odur (`paraBirimi` çağıranda;
 *     SabitKiymetModule `toplaTRY` ile çevirir). Bilanço tarafının kur çevirmemesi ayrı bir
 *     açık iştir (bkz. Açık İşler).
 */
import { bilinenSayi } from '../para';
import { zamanDate } from '../zaman';

/** Bir yılın gün sayısı — eski hesapla birebir (artık yıl ortalaması). */
const GUN_YIL = 365.25;
const MS_GUN = 1000 * 60 * 60 * 24;

/** Amortisman için gereken alanlar — yapısal (SabitKiymetModule'ün `SabitKiymet`i ve ham doküman uyar). */
export interface AmortismanGirdisi {
  alisBedeli?: unknown;
  alisTarihi?: unknown;
  faydaliOmur?: unknown;
  amortYontemi?: unknown;
  /** Manuel override; **0 = hesaplansın** (SabitKiymetModule:37 form varsayılanı). */
  birikmisSalinma?: unknown;
}

/** Bilinen sonlu sayı, yoksa NaN. */
function sayi(x: unknown): number {
  return bilinenSayi(x) ? Number(x) : NaN;
}

/** Alış tarihinden bugüne geçen yıl (ömürle sınırlı); çözülemiyorsa NaN. */
function gecenYil(girdi: AmortismanGirdisi, bugun: Date, omur: number): number {
  const alis = zamanDate(girdi.alisTarihi);
  if (alis === null) return NaN;
  const bas = new Date(bugun.getTime());
  bas.setHours(0, 0, 0, 0);
  const yil = (bas.getTime() - alis.getTime()) / (MS_GUN * GUN_YIL);
  if (yil <= 0) return 0;               // bugün/gelecek alım: BİLİNEN 0 amortisman
  return Math.min(yil, omur);
}

/**
 * Birikmiş amortisman; türetilemiyorsa **NaN** (0 DEĞİL).
 *
 * Sıra: (1) manuel override > 0 → alış bedeliyle sınırlı o değer; (2) bedel/ömür/tarih bilinen
 * → yönteme göre hesap; (3) aksi hâlde bilinmiyor.
 */
export function birikmisAmortisman(girdi: AmortismanGirdisi, bugun: Date = new Date()): number {
  const bedel = sayi(girdi.alisBedeli);
  if (!Number.isFinite(bedel)) return NaN;          // bedelsiz varlıkta amortisman da bilinmez

  const override = sayi(girdi.birikmisSalinma);
  if (Number.isFinite(override) && override > 0) return Math.min(override, bedel);

  const omur = sayi(girdi.faydaliOmur);
  if (!Number.isFinite(omur) || omur <= 0) return NaN;   // eski kod burada 0'a bölüp NaN üretiyordu

  const yil = gecenYil(girdi, bugun, omur);
  if (!Number.isFinite(yil)) return NaN;
  if (yil === 0) return 0;

  if (girdi.amortYontemi === 'Doğrusal') return (bedel / omur) * yil;

  // Azalan Bakiyeler (DDB): oran = 2 / ömür, her tam yıl kalan bakiyeden düşülür.
  const oran = 2 / omur;
  let kalan = bedel;
  let toplam = 0;
  const tamYil = Math.floor(yil);
  for (let i = 0; i < tamYil; i++) {
    const a = kalan * oran;
    toplam += a;
    kalan -= a;
  }
  const kesir = yil - tamYil;
  if (kesir > 0) toplam += kalan * oran * kesir;
  return Math.min(toplam, bedel);
}

/** Net defter değeri = max(0, alış bedeli − birikmiş amortisman); girdilerden biri bilinmiyorsa NaN. */
export function netDeger(girdi: AmortismanGirdisi, bugun: Date = new Date()): number {
  const bedel = sayi(girdi.alisBedeli);
  const birikmis = birikmisAmortisman(girdi, bugun);
  if (!Number.isFinite(bedel) || !Number.isFinite(birikmis)) return NaN;
  return Math.max(0, bedel - birikmis);
}

/** Yıllık amortisman gideri; türetilemiyorsa NaN. Tamamen itfa edilmişse BİLİNEN 0. */
export function yillikAmortisman(girdi: AmortismanGirdisi, bugun: Date = new Date()): number {
  const bedel = sayi(girdi.alisBedeli);
  const omur = sayi(girdi.faydaliOmur);
  if (!Number.isFinite(bedel) || !Number.isFinite(omur) || omur <= 0) return NaN;

  const birikmis = birikmisAmortisman(girdi, bugun);
  if (!Number.isFinite(birikmis)) return NaN;
  if (birikmis >= bedel) return 0;                  // ömür sonrası sonsuz amortisman yok

  if (girdi.amortYontemi === 'Doğrusal') return bedel / omur;
  return Math.max(0, bedel - birikmis) * (2 / omur);
}

/** Aylık amortisman gideri (yıllığın 1/12'si); türetilemiyorsa NaN. */
export function aylikAmortisman(girdi: AmortismanGirdisi, bugun: Date = new Date()): number {
  return yillikAmortisman(girdi, bugun) / 12;
}
