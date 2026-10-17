/**
 * kiraciOrtami.ts — sunucunun kiracısını çözen iki SAF okuyucu: AÇIK ortam değişkeni ve `users` taraması.
 * Yaprak modül: yalnız `lib/rbac`'ı (saf; girdi / çıktı yok) içe aktarır — `server.ts`'i ve rota modüllerini içe AKTARMAZ.
 *
 * NEDEN AYRI DOSYA (2026-10-08, mağaza dilim 1): kullanıcı oturumu olmayan sunucu bağlamı (webhook, cron, mağaza sipariş talebi ucu)
 * kiracıyı `server.ts` `serverTenantId` ile çözer: önce bu ortam değeri, yoksa `users` taramasında TEK kiracı varsa o. Tarama yolu
 * kayıt açıkken kırılgandır — davetsiz ikinci bir hesap açıldığı an kiracı «belirsiz» olur ve mağaza ucu sessizce 503'e düşer
 * (mağaza yanıtı okumuyor). Bekçi (`opsWatchdog` `magaza_talep`) çözümün KAYNAĞINI bilmek zorunda; ad listesini iki yerde ayrı
 * yazmak ayrışırdı, bu yüzden okuyucu tektir.
 */
import { APP_ROLES } from '../lib/rbac.js';

export function ortamdanKiraci(ortam: NodeJS.ProcessEnv = process.env): string {
  return ortam.SERVER_TENANT_COMPANY_ID || ortam.MIKRO_CRON_COMPANY_ID || '';
}

/** `users` taramasının bir satırı: belge kimliği + verisi (yoksa `undefined`). */
export interface KullaniciBelgesi {
  id: string;
  veri: Readonly<Record<string, unknown>> | undefined;
}

/**
 * `users` taramasındaki KİRACI KÜMESİ — yalnız `role` değeri `APP_ROLES` üyesi olan belgeler sayılır (2026-10-11, şartname
 * «dış rol kapanışı» D12; ortam ayarının ikinci katı).
 *
 * NEDEN: giriş ekranından hesap açan yabancının `users/<uid>` belgesi rol / kiracı alanı OLMADAN yazılır (kendi belgesi
 * istisnası; rol ve kiracı alanları sunucuda sökülür). O belgenin kiracısı kendi kimliği sayılıyordu → tarama İKİ kiracı görüp
 * boş dönüyordu: mağaza sipariş talebi ucu, takip sorgusu, site paneli ve «ERP ile bağlan» 503'e düşüyor (mağaza yanıtı
 * okumadığı için talepler sessizce kayboluyor), saatlik + gece Mikro işleri «hedef kiracı belirsiz» deyip atlıyordu. Kötü niyet
 * gerekmez: meraklı bir ziyaretçinin kaydı yeter. Rolü olmayan hesap kiracı DEĞİLDİR (daveti kabul edince rolü ve davetteki
 * kiracıyı alır); rol alanındaki geçersiz değer de (sayı, uydurma dizge — eski `/increment` yolu) rol sayılmaz.
 *
 * Kiracı kimliği `getUserCompanyId` ile AYNI kural: `companyId` alanı, yoksa belge kimliği (firmanın kurucusu).
 * ÜÇ tarama da bunu çağırır — ayrı kopyalar ayrışırdı (üçüncüsü ilk düzeltmede unutulmuş, eski kuralla kalmıştı):
 * `serverTenantId` (server.ts), `cronCompanyId` (crons.ts — saatlik + gece stok / cari işleri) ve `sqlSenkronHedefTenant`
 * (routes/mikroRoutes.ts — gece ve aylık SQL senkronu). Çit: kiraciOrtami.test.ts «bağlantı çiti» (elle kurulan kiracı kümesi yok).
 */
export function rolluKiracilar(belgeler: Iterable<KullaniciBelgesi>): string[] {
  const kume = new Set<string>();
  for (const b of belgeler) {
    const rol = b.veri?.role;
    if (typeof rol !== 'string' || !(APP_ROLES as readonly string[]).includes(rol)) continue;
    const cid = b.veri?.companyId;
    kume.add(typeof cid === 'string' && cid !== '' ? cid : b.id);
  }
  return [...kume];
}

/** Taramada TEK kiracı varsa o; hiç yoksa ya da birden fazlaysa `''` (belirsiz — çağıran yazmaz / atlar). */
export function taramadanKiraci(belgeler: Iterable<KullaniciBelgesi>): string {
  const kiracilar = rolluKiracilar(belgeler);
  return kiracilar.length === 1 ? kiracilar[0] : '';
}
