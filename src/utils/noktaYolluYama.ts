/**
 * noktaYolluYama.ts — iç içe bir ayar nesnesini BÜTÜN göndermek yerine yalnız dokunulan alanları nokta-yollu yama olarak üretir.
 *
 * NEDEN (2026-10-02, tarama bulgusu «rest-kenar:5»): Ayarlar ve Yönetim ekranındaki 'Kaydet'
 * `setDoc(settings/app, { companySettings }, { merge: true })` gönderiyordu. Sunucunun birleştirmesi ÜST düzeyde sığdır
 * (pgShim `mergeDocData`): `companySettings` anahtarı bütün olarak yer değiştirir. Form durumu sunucudan HİÇ doldurulmadığı
 * için (yalnız bu oturumda yazılan alanları taşır) kayıtlı diğer alanlar — mağaza erişim belirteci, imza, IBAN — sessizce
 * siliniyor, ekranda 'Ayarlar kaydedildi' görünüyordu. Hiçbir alana dokunmadan basmak nesneyi tamamen boşaltıyordu.
 *
 * Nokta-yollu anahtar (`companySettings.signature`) sunucuda yalnız o yaprağı değiştirir. Formu sunucudan DOLDURMAK çözüm
 * değildir: düz metin sırrı istemciye geri taşır.
 */
export function noktaYolluYama(kok: string, alanlar: Record<string, unknown>): Record<string, unknown> {
  const yama: Record<string, unknown> = {};
  for (const [alan, deger] of Object.entries(alanlar)) {
    // Alan adında nokta olursa yama BAŞKA bir yola yazılır — sessizce yanlış yere kaydetmektense dur.
    if (alan.includes('.')) throw new Error(`Ayar alanı adı nokta içeremez: ${alan}`);
    if (deger === undefined) continue;   // tanımsız = dokunulmadı (JSON'a da girmez)
    yama[`${kok}.${alan}`] = deger;
  }
  return yama;
}
