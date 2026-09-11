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

/**
 * FİRMA anahtarı: `company` varsa o, yoksa `name`. Elle açılan lead'de `name` YETKİLİ KİŞİ adıdır
 * (NewLeadModal "İletişim Adı"), firma `company`'de; Mikro/ERP import'u ikisine de unvanı yazar.
 * `name`i önce almak iki farklı firmanın aynı adlı yetkilisini eşleştirir — cari import'u bu yüzden
 * yanlış lead'i GÜNCELLEYEBİLİR, birleştirme scripti yanlış lead'i SİLEBİLİRDİ (inceleme, 2026-09-05).
 * Harita (mevcut lead'ler) ve gelen taraf (unvan) AYNI fonksiyondan geçer.
 */
export function firmaAnahtari(data: { company?: unknown; name?: unknown }): string {
  return isimAnahtari(data.company || data.name);
}
