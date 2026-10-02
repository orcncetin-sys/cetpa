/**
 * adresYamasi.ts — ayar formundaki BAĞLANTI ADRESİ kutusu kayıt gövdesine girsin mi? (2026-10-02)
 *
 * Sunucu bağlantı adresini yalnız Yönetici'den kabul eder (server.ts `ayarYazimiEngeli`). Muhasebe > ERP formları kutuyu
 * varsayılan adresle doldurup HER kayıtta gönderiyordu: kayıtta adres yokken varsayılan adres "değişiklik" sayıldığı için
 * adrese hiç dokunmayan Müdür 'etkin' anahtarını bile kaydedemiyordu (403). Kural: adres yalnız kullanıcı onu GERÇEKTEN
 * değiştirdiyse gövdeye girer; `merge` yazımında gönderilmeyen alan kayıtta olduğu gibi kalır.
 *   kutu = kayıttaki (ya da kayıt yokken varsayılan) → gönderilmez
 *   kayıtta özel adres varken kutu varsayılana çevrildi → GÖNDERİLİR (meşru değişiklik yutulmaz)
 */
export function adresYamasi<A extends string>(alan: A, kutu: string, kayitli: string | undefined, varsayilan: string): Partial<Record<A, string>> {
  const gorunen = kayitli !== undefined && kayitli !== '' ? kayitli : varsayilan;
  return kutu === gorunen ? {} : { [alan]: kutu } as Partial<Record<A, string>>;
}
