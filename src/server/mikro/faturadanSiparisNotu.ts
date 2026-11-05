/**
 * faturadanSiparisNotu.ts: «faturadan sipariş» notunun KAYNAKSIZ parçası: üretici ve ayrıştırıcı TEK modülde
 * (şartname «Mikro bağlantı A» A8.3, 2026-11-05). Test: faturadanSiparisNotu.test.ts (ikisi birlikte çitli).
 *
 * NEDEN: gece adımı ⚠ notunu syncLog `entityId`'ye yazıyor; açılış tanısı (`acilisTani.senkronSatiri`) yalnız `uyari: ⚠ var mı`
 * döndürüyordu (canlı 5/5 gece ⚠, metin hiçbir tanı ucunda yok). Tanı değer TAŞIMAZ: ad / sipariş numarası dönmez, yalnız
 * SAYI (`kaynaksizAdet`). Üretici ile ayrıştırıcı ayrı dosyalarda olsaydı metin değişince sayı sessizce `null`a düşerdi.
 * Kaynaksız MF siparişlerinin ciroda kalıp kalmayacağı kullanıcı kararıdır (soru 2); bu modül yalnız sayar.
 * Saf: Express / db yok (`src/server/mikro/*` deseni).
 */

/** Not metinlerindeki örnek listesi: ilk beş ad, fazlası « …» (mikroRoutes notlarının ORTAK biçimi; tek tanım burada). */
export const ilkBes = (l: readonly string[]): string => `${l.slice(0, 5).join(', ')}${l.length > 5 ? ' …' : ''}`;

/** Kaynaksız parçanın SABİT gövdesi: üretici ve ayrıştırıcı bundan kurulur. */
const KAYNAKSIZ_GOVDE = 'MF siparişinin kaynağı Mikro fatura listesinde yok (silinmiş olabilir)';

/** `⚠ {adet} MF siparişinin kaynağı Mikro fatura listesinde yok (silinmiş olabilir): {ilk beş} — durum değiştirilmedi`
 *  (metin 2026-11-05 öncesi `iptalNotlari` satır içi metniyle BAYT BAYT aynı; ayırıcılar da). */
export function kaynaksizNotu(adet: number, adlar: readonly string[]): string {
  return `⚠ ${adet} ${KAYNAKSIZ_GOVDE}: ${ilkBes(adlar)} — durum değiştirilmedi`;
}

const KAYNAKSIZ_DESENI = new RegExp(`⚠ (\\d+) ${KAYNAKSIZ_GOVDE.replace(/[()]/g, '\\$&')}:`);

/** Özetteki kaynaksız MF siparişi SAYISI; parça yoksa `null` (0 DEĞİL: «yok» ile «okunamadı» karışmasın). */
export function kaynaksizAdetiOku(ozet: unknown): number | null {
  if (typeof ozet !== 'string') return null;
  const m = KAYNAKSIZ_DESENI.exec(ozet);
  return m ? Number(m[1]) : null;
}
