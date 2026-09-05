/**
 * isimAnahtari.ts — cari/lead İSİM eşleştirme anahtarı, TEK KAYNAK (Faz 1 4/n, 2026-09-05).
 *
 * Mikro/Logo/Dynamics unvanı BÜYÜK gelir ('ŞİRİN YAPI'), CRM'de elle açılan lead karışık
 * ('Şirin Yapı'). `toLowerCase()` locale-duyarsızdır: 'İ' → 'i̇' (i + birleşik nokta), 'I' → 'i'
 * (Türkçe'de 'ı') — iki taraf ASLA eşleşmez, her import'ta mükerrer lead açılır. 4/n testi
 * mikroRoutes'ta buldu; inceleme aynı deseni crons/erpRoutes/dynamicsRoutes'ta da (6 yer) buldu.
 * Bu yüzden anahtar tek fonksiyondan üretilir: harita tarafı da gelen tarafı da BUNU çağırır.
 */
export function isimAnahtari(ad: unknown): string {
  return String(ad ?? '').trim().toLocaleLowerCase('tr-TR');
}
