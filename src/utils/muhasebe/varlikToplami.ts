/**
 * varlikToplami.ts — sabit kıymet KPI toplamlarının TEK kuralı (Faz 3 5/n düzeltici turu,
 * 2026-09-19). Test: `varlikToplami.test.ts` (önce yazıldı, kırmızı görüldü).
 * Saf modül: React/DB/kur tablosu/kullanıcı metni yok — çevrim ve metin çağıranda.
 *
 * ## NEDEN VAR
 *
 * `SabitKiymetModule.tsx` içindeki `toplaTRY` (satır ~347) şu kapıyı taşıyordu:
 *
 *     const ham = tutar(v);
 *     if (!Number.isFinite(ham)) return null;      // ← TEK varlık bütün toplamı siliyor
 *
 * Kapının kur yarısı ("tek kalem çevrilemiyorsa toplam güvenilmez") doğruydu; BİLİNMEYEN
 * TUTARA genişletilmesi ise kartı boşaltıyordu: 40 demirbaş elle girilmiş ve tamken, Mikro
 * importundan gelen ve `demirbasEsle`nin alış tarihini çözemediği TEK kayıt yüzünden hem
 * "Toplam Defter Değeri" hem "Birikmiş Amortisman" (ikisi de AYNI listeden) '—' oluyordu.
 * Önceki gün ₺4,2M gösteren kart açıklamasız boşalıyordu; üstelik kur-yok yolu da aynı '—'yı
 * bastığı için kullanıcı iki nedeni ayırt edemiyordu.
 *
 * ## SÖZLEŞME (src/utils/para.ts — İKİ SÖZLEŞME)
 *
 * KPI kartı bir **EKRAN** toplamıdır: bilinenlerin kısmi toplamı + "N varlık dışarıda" notu;
 * hiç bilinen yoksa NaN ('—'). Türetme (oran/fark) DEĞİLDİR. İki dışlama nedeni AYRI sayılır,
 * çünkü kullanıcının yapacağı iş farklıdır: biri eksik veri girişi (alış tarihi/ömür/bedel),
 * diğeri kur arşivi. Değeri bilinmeyen varlığa kur HİÇ sorulmaz — aynı kayıt iki sayaca düşmez.
 */
import { toplaBilinen, ekranTutari, type Tutar } from '../para';

export interface VarlikToplamSonucu {
  /** EKRAN toplamı — bilinenlerin kısmi toplamı; hiç bilinen yoksa NaN ('—'). */
  ekran: number;
  /** Ham sayaçlar (`bilinen` / `bilinmeyen` = `hesaplanamayan + kursuz`). */
  tutar: Tutar;
  /** Değeri TÜRETİLEMEYEN varlık sayısı (alış tarihi / ömür / bedel eksik). */
  hesaplanamayan: number;
  /** Değeri bilinen ama para birimi ₺'ye ÇEVRİLEMEYEN varlık sayısı (kur arşivinde yok). */
  kursuz: number;
}

/**
 * Karışık para birimli varlıkları ₺'ye toplar.
 *
 * @param deger    Varlığın ham değeri; TÜRETİLEMİYORSA `NaN` dönmeli (0 "bedelsiz" demektir).
 * @param tryCevir Ham değeri ₺'ye çevirir; kur bulunamazsa `null` (ya da `NaN`) dönmeli —
 *                 uydurma sabit kur YOK (bkz. CLAUDE.md "kur yoksa uydurma").
 */
export function varlikToplami<T>(
  liste: readonly T[],
  deger: (v: T) => number,
  tryCevir: (ham: number, v: T) => number | null,
): VarlikToplamSonucu {
  let hesaplanamayan = 0, kursuz = 0;
  const cevrilmis = liste.map(v => {
    const ham = deger(v);
    // Değer bilinmiyorsa kur SORULMAZ: tarihsiz bir EUR kaydı iki sayaca birden düşerdi.
    if (!Number.isFinite(ham)) { hesaplanamayan++; return NaN; }
    const tl = tryCevir(ham, v);
    if (tl === null || !Number.isFinite(tl)) { kursuz++; return NaN; }
    return tl;
  });
  const tutar = toplaBilinen(cevrilmis, x => x);
  return { ekran: ekranTutari(tutar), tutar, hesaplanamayan, kursuz };
}
