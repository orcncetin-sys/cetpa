/**
 * mikroSiparisFisi.ts: «Mikro Siparişleri» sekmesinin kaydı: Mikro'da kesilmiş ALINAN (satış) sipariş fişi mi?
 * (şartname «Mikro bağlantı A» A7 / AH9, 2026-11-05). Test: mikroSiparisFisi.test.ts.
 *
 * NEDEN AYRI MODÜL: `tip === 0` süzgeci OrdersPage'in çağrı yerinde satır içiydi. Sekmenin boş durum açıklaması
 * (`mikroBosDurumu`) aynı süzgeci HAM listeye uygulamalı: süzgeç iki yerde yazılırsa biri değişip öteki kalır («kopya kural»).
 * Kural TEK burada; OrdersPage listesi ve boş durum yardımcısı bunu çağırır.
 *
 * `tip`: `useMikroSiparisler` `sip_tip`'i sayıya çevirir (0 = alınan / satış, 1 = verilen / alış). Kullanıcı (05.11.2026):
 * Mikro'da sipariş fişi kesilmiyor; sekme yine gizlenmez (karar soru 16'da, `sema-kesif` `siparisSatirSayisi` ölçüsüne bağlı).
 */
export function mikroSiparisFisiMi(ms: { readonly tip: number }): boolean {
  return ms.tip === 0;
}

/**
 * «Mikro Siparişleri» sekmesi boşken hangi metin (şartname «Mikro bağlantı A» A7 / AH9). Liste dolu (`sortedUzunluk > 0`) → null.
 *   • sekme `'mikro'` VE ham listede hiç sipariş FİŞİ yok (süzgeci yardımcı KENDİSİ uygular) → `'mikroFisYok'`: sekmeye özel açıklama
 *     («Mikro'dan sipariş fişi gelmedi …»). Canlı: `mikroSiparisler` 0, `SQL:SIPARISLER` her gece başarılı 0 kayıt; MF siparişleri
 *     (444) «Cetpa Siparişleri» sekmesinde. «Senkron başarılı» DENMEZ: liste senkron başarısız olsa da boştur (istemci ayırt edemez).
 *   • fiş var ama süzgeç / arama hepsini eledi, ya da başka sekme → `'genel'` (eski `no_orders_found`).
 * Bilinen sınır: ilk anlık görüntü gelmeden açıklama kısa süre görünebilir (hook yükleme bilgisi taşımaz; 3 okuyucuyu değiştirirdi).
 */
export type MikroBosDurumu = 'mikroFisYok' | 'genel';
export function mikroBosDurumu(
  sekme: string,
  mikroSiparisler: readonly { readonly tip: number }[],
  sortedUzunluk: number,
): MikroBosDurumu | null {
  if (sortedUzunluk > 0) return null;
  if (sekme === 'mikro' && !mikroSiparisler.some(mikroSiparisFisiMi)) return 'mikroFisYok';
  return 'genel';
}
