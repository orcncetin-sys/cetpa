/**
 * magazaTalepAramasi.ts — ERP Mağaza Talepleri listesindeki arama kutusunun SAF süzgeci (V23, 2026-10-09).
 *
 * Yaprak modül; yalnız ERP ekranı okur (panel / sunucu okumaz — § 1 ortak sözleşmesine bu yüzden GİRMEZ, ayrı dosya).
 * Bileşen (`components/siparis/MagazaTalepleri.tsx`) bunu içe aktarır; istek atmaz, sunucu ucu yoktur (liste istemcidedir).
 *
 * KURAL (§ 5.2): `metin.trim()` boşsa girdi AYNEN döner; değilse satır eşleşir ⇔
 *  (a) `talepNo` metne EŞİT ya da metinle BİTER — ASCII kod kimliği: iki taraf `toUpperCase()` (CLAUDE.md «karşılaştırmada
 *      ASCII kod için `toUpperCase()`»; `T261008-CZZF` için `CZZF`, `8-CZZF`, `czzf` eşleşir; `T2610` önek olduğu için eşleşmez);
 *  (b) metin yalnız rakamsa `telefonSon10` metinle BİTER (son 4 hane dâhil; 10 haneye kadar);
 *  (c) müşteri adı / firma (`musteri.ad`, `musteri.firma`) metni İÇERİR — iki taraf `toLocaleLowerCase('tr-TR')`
 *      (`toLowerCase` YOK: `İ` / `I` tuzağı — `'ŞİRİN YAPI'.toLowerCase()` «i» + birleşik nokta (U+0307) ve «yapi» üretir,
 *      hiçbir aramayla eşleşmez).
 * Yalnız bu üç alan: e-posta, il, not, kalem adı ARANMAZ. Sıra korunur; aynı satır iki ölçütten eşleşince bir kez döner.
 */

/** Süzgecin okuduğu alanlar — `MagazaTalepSatiri` buna uyar; kanca tipi burada içe aktarılmaz (yaprak kalsın). */
export interface MagazaAramaSatiri {
  talepNo: string;
  telefonSon10: string;
  musteri: { ad: string; firma: string };
}

const YALNIZ_RAKAM = /^\d+$/;

export function magazaTalepAramasi<T extends MagazaAramaSatiri>(talepler: T[], metin: string): T[] {
  const aranan = metin.trim();
  if (aranan === '') return talepler;
  const kod = aranan.toUpperCase();
  const rakam = YALNIZ_RAKAM.test(aranan);
  const kucuk = aranan.toLocaleLowerCase('tr-TR');
  return talepler.filter(t => {
    const no = t.talepNo.toUpperCase();
    if (no === kod || no.endsWith(kod)) return true;
    if (rakam && t.telefonSon10.endsWith(aranan)) return true;
    return t.musteri.ad.toLocaleLowerCase('tr-TR').includes(kucuk) || t.musteri.firma.toLocaleLowerCase('tr-TR').includes(kucuk);
  });
}
