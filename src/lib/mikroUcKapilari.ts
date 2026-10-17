/**
 * mikroUcKapilari.ts — `/api/mikro/*` UÇ düzeyi rol kapılarının ORTAK tablosu (karar turu 2026-10-11 — İ4, H6).
 *
 * NEDEN: yöntem düzeyi kapılar zaten paylaşılan tabloda (`mikroEvrakKapilari.ts`); uç düzeyi kapılar ise yalnız sunucunun
 * rota satırında düz metindi. İstemci «bu rol bu ucu geçer mi» sorusunu soracak tek kaynak bulamayınca sekme tablosuna
 * (`hasFullAccess`) ya da elle yazılmış rol listesine bakıyordu — sunucu kapısı değişince düğme sessizce bayatlar
 * (ölü düğme: tıklanır, 403 döner). Bu tabloyla istemci sunucunun kapısını ADIYLA sorar; bileşende rol adı da
 * koleksiyon adı da yazılmaz.
 *
 * TEK KAYNAK ZİNCİRİ (çit: `src/server/routes/mikroRoutes.rolKapisi.test.ts`):
 *   rota satırındaki kapı metni  ═ Ç3 ═  testin BEKLENEN tablosu  ═ Ç16 ═  bu tablo.
 * Rota satırı sunucuda düz metin KALIR (kaynak çiti kapıyı sabit dize olarak ister); kayma testte kırılır.
 * Anahtarlar BEKLENEN anahtarlarıyla BİREBİR aynıdır: `'YÖNTEM /api/mikro/yol'`.
 *
 * KAPSAM: karar turunda kapısı değişen uçlar + istemcinin koşul sorduğu uçlar. Tabloda OLMAYAN uç için istemci koşul
 * yazmadan önce buraya satır eklenir (çit, satırın sunucudaki kapıyla aynı olduğunu sınar).
 *
 * İLKELER: İ1 — Cetpa'ya ya da Mikro'ya YAZAN uç eşdeğer koleksiyonun yazma kuralını ister. İ2 — yalnız OKUYAN uç okuma
 * kuralını. İ3 — rol geçemiyorsa düğme ÇİZİLMEZ, çağrı HİÇ yapılmaz (sessiz 403 kalmaz). İ5 — alış belgesi muhasebenindir.
 *
 * SINIR: sunucu süper yöneticiyi (sahip hesabı) rolüne bakmadan geçirir; istemci ROLE bakar. Sahip hesabının rolü
 * Yönetici'dir — fark bilerek kabul edildi (gizli düğme, ölü düğme değil).
 *
 * Saf modül: sunucu testi ve istemci (bileşen / kanca / servis) AYNI tabloyu okur. Karar işlevi ORTAK çekirdekte
 * (`ucKapisiCekirdegi.ts`) — entegrasyon uçlarının tablosu (`entegrasyonUcKapilari.ts`) da aynı çekirdeği çağırır (kopya yok).
 */
import type { AppRole } from './rbac';
import { tablodakiUcKapisindanGecer, type UcKapisi } from './ucKapisiCekirdegi';

/** `requireCollectionAccess(koleksiyon, eylem)` ikilisi (tanım çekirdekte). */
export type { UcKapisi } from './ucKapisiCekirdegi';

export const MIKRO_UC_KAPILARI = {
  // K1 — arama DÂHİL iki dal da `leads`'e yazar (arama istek başına en çok 200 cari upsert eder) → yazma kapısı.
  //      Kilitlenen: Satın Alma, Lojistik, Muhasebe. İki «Mikro'da ara» kutusu salt okuyan arama ucu gelene kadar çizilmez (H3).
  'POST /api/mikro/cari/listesi': ['leads', 'write'],
  // K2 — yalnız okur (Mikro'daki cari hareket türleri) → okuma kapısı. Kilitlenen: Satış, Satın Alma.
  'GET /api/mikro/cari-hareket/turler': ['mikroCariHareketler', 'read'],
  // K4 — `employees`'e yazar. Kilitlenen: Müdür, Muhasebe.
  'POST /api/mikro/pull/personel': ['employees', 'write'],
  // K5 — `bom`'a yazar. Kilitlenen: Kalite.
  'POST /api/mikro/pull/uretim-receteleri': ['bom', 'write'],
  // K6 — üç çekme ucu `eBelgeler`'e yazar. Kilitlenen: Satış, Lojistik.
  'POST /api/mikro/ebelge/gelen': ['eBelgeler', 'write'],
  'POST /api/mikro/ebelge/giden': ['eBelgeler', 'write'],
  'POST /api/mikro/ebelge/eirsaliye': ['eBelgeler', 'write'],
  // K7 / H1 / İ5 — PDF ve XML İKİ YÖNDE de tek sabit kapı: sunucu belgenin yönünü bilemez (PDF gövdesinde yön yok, XML'de
  //      istemci beyanı, `eBelgeler.yon` damgası güvenilmez). «Giden belge Satış'a açık» dalı YOKTUR.
  //      Kilitlenen: Satış, Lojistik, Satın Alma.
  'POST /api/mikro/ebelge/pdf': ['mikroFaturalar', 'read'],
  'POST /api/mikro/ebelge/xml': ['mikroFaturalar', 'read'],
  // K9 — kapı DEĞİŞMEDİ (kasa hareketi; Satış'a tahsilat gönderimi açılmaz). Satır, sessiz çağrının koşulu için burada.
  'POST /api/mikro/tahsilat/kaydet': ['kasaHareketleri', 'write'],
} as const satisfies Record<string, UcKapisi>;

/** Ortak tabloda kapısı olan uç — `'YÖNTEM /api/mikro/yol'`. */
export type MikroKapiliUc = keyof typeof MIKRO_UC_KAPILARI;

/** Bu rol, ucun sunucudaki kapısından geçer mi? İstemci düğmeyi çizmeden / çağrıyı yapmadan ÖNCE sorar.
 *  Rolsüz hesap ve tabloda olmayan anahtar (tip dışı çağrı) GEÇEMEZ — kapalı başarısızlık. */
export function ucKapisindanGecer(rol: AppRole | null | undefined, uc: MikroKapiliUc): boolean {
  return tablodakiUcKapisindanGecer(MIKRO_UC_KAPILARI, rol, uc);
}
