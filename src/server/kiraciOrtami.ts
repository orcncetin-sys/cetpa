/**
 * kiraciOrtami.ts — sunucunun kiracısını AÇIKÇA veren ortam değişkeni (yaprak modül; hiçbir şeyi içe aktarmaz).
 *
 * NEDEN AYRI DOSYA (2026-10-08, mağaza dilim 1): kullanıcı oturumu olmayan sunucu bağlamı (webhook, cron, mağaza sipariş talebi ucu)
 * kiracıyı `server.ts` `serverTenantId` ile çözer: önce bu ortam değeri, yoksa `users` taramasında TEK kiracı varsa o. Tarama yolu
 * kayıt açıkken kırılgandır — davetsiz ikinci bir hesap açıldığı an kiracı «belirsiz» olur ve mağaza ucu sessizce 503'e düşer
 * (mağaza yanıtı okumuyor). Bekçi (`opsWatchdog` `magaza_talep`) çözümün KAYNAĞINI bilmek zorunda; ad listesini iki yerde ayrı
 * yazmak ayrışırdı, bu yüzden okuyucu tektir.
 */
export function ortamdanKiraci(ortam: NodeJS.ProcessEnv = process.env): string {
  return ortam.SERVER_TENANT_COMPANY_ID || ortam.MIKRO_CRON_COMPANY_ID || '';
}
