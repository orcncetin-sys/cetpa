/**
 * mikroEvrakKapilari.ts — `POST /api/mikro/evrak/kaydet` yöntem beyaz listesi + yöntem başına ROL KAPISI (2026-10-10).
 *
 * NEDEN TABLO: uç, istemcinin kurduğu gövdeyi Mikro'ya OLDUĞU GİBİ iletir (sunucuda gövde kurulmaz). Tek bir «iç personel»
 * kapısı yetmez: aynı Mikro yazımı (`DekontKaydetV2` — cari borç / alacak) `cari-hareket/kaydet`'te muhasebe kapısının
 * arkasındayken bu uçtan serbest gövdeyle İK / Hukuk / Kalite rolüne açık kalırdı (zayıf yol kapanıp güçlü yol açık).
 *
 * BEYAZ LİSTE BU TABLODAN TÜRER — kapısız yöntem eklenemez. `Map`, düz nesne DEĞİL: `'constructor'` / `'toString'` gibi
 * miras anahtarlar beyaz listeyi geçmesin.
 *
 * KURAL (R2 — «hiçbir meşru kullanıcı kilitlenmez»): yönteme İNCE kapı yalnız o yöntemi çağıran düğmeyi BUGÜN gören her
 * rol kapıdan geçiyorsa (ya da yöntemin istemcide çağıranı yoksa) verilir. Koşulu sağlamayan yöntem `'staff'`ta kalır
 * (dış rol ve rolsüz hesap yine kapanır); ince kapısı kullanıcı kararını bekler. Çit: mikroRoutes.rolKapisi.test.ts.
 *
 * İNCE KAPI KURALI DIŞ ROL İÇEREMEZ (ör. `quotations:write` B2B / Bayi'yi geçirir) — öyle bir kural tek başına kapı olamaz.
 *
 * Saf modül: sunucu (kapı + işleyici) ve istemci (yeniden deneme kuyruğu süzgeci) AYNI tabloyu okur.
 */
import { STAFF_ROLES, isAllowed, type AppRole } from './rbac';

/** `'staff'` = yalnız iç personel şartı; ikili = `requireCollectionAccess(koleksiyon, eylem)`. */
export type EvrakKapisi = 'staff' | readonly [koleksiyon: string, eylem: 'read' | 'write'];

export const MIKRO_EVRAK_KAPILARI: ReadonlyMap<string, EvrakKapisi> = new Map<string, EvrakKapisi>([
  // ── İnce kapı ──
  // Dekont: GEÇİCİ `leads:read` — dekont penceresini bugün gören rollerin TAM kümesi (Yönetici, Müdür, Satış, Muhasebe,
  // Satın Alma). Kalıcı kapı (`mikroCariHareketler:write`) Satış ve Satın Alma'yı kilitler → kullanıcı kararı bekliyor.
  ['DekontKaydetV2', ['leads', 'read']],
  ['ZiyaretKaydetV2', ['leads', 'write']],
  ['ServisIsEmriKaydetV2', ['servisTalepleri', 'write']],
  ['ServisFormuKaydetV2', ['servisTalepleri', 'write']],
  ['ServisMalzemePlanKaydetV2', ['servisTalepleri', 'write']],
  ['ServisRotaPlanKaydetV2', ['servisTalepleri', 'write']],
  ['AlinanTeklifKaydetV2', ['purchaseOrders', 'write']],
  ['SayimKesinlestirmeV2', ['stockCountSessions', 'write']],
  ['PersonelizinKaydetV2', ['leaveRequests', 'write']],
  ['PersonelKaydetV2', ['employees', 'write']],
  ['BakimHareketleriKaydetV2', ['isEmirleri', 'write']],
  ['BakimSarfiyatlariKaydetV2', ['isEmirleri', 'write']],
  ['BakimSozlesmeKaydetV2', ['isEmirleri', 'write']],
  ['UrunRotaKaydetV2', ['routingTemplates', 'write']],
  ['UretimRotaPlanKaydetV2', ['routingTemplates', 'write']],
  // ── Yalnız iç personel (ince kapı, düğmeyi bugün gören bir iç rolü kilitlerdi — karar bekliyor) ──
  ['VerilenTeklifKaydetV2', 'staff'],
  ['DahiliStokHareketKaydetV2', 'staff'],
  ['SayimSonuclariKaydetV2', 'staff'],
  ['EtiketBasimKaydetV2', 'staff'],
  ['PersonelIzinTalepKaydetV2', 'staff'],
  ['UrunReceteKaydetV2', 'staff'],
  ['UretimTalepKaydetV2', 'staff'],
  ['UretimIsEmriOlusturV2', 'staff'],
  ['SatinAlmaTalepKaydetV2', 'staff'],
  ['BakimTalepKaydetV2', 'staff'],
  ['DepolarArasiSiparisKaydetV2', 'staff'],
]);

/** İstek gövdesindeki yöntem adı. Kapı ve işleyici AYNI ayıklayıcıyı kullanır — ayrışırlarsa kapı bir yöntemin kuralına
 *  bakarken işleyici başkasını Mikro'ya gönderir. Dize olmayan / eksik değer boş dizedir (beyaz listede yok). */
export const evrakYontemi = (govde: unknown): string => {
  const m = (govde as { method?: unknown } | undefined | null)?.method;
  return typeof m === 'string' ? m : '';
};

/** Bu rol, yöntemin sunucudaki kapısından geçer mi? İstemci yeniden deneme kuyruğu işi sahiplenmeden ÖNCE sorar
 *  (geçemeyecek rol işi alıp 403'e çarptırmasın). Tanınmayan yöntem `'staff'` sayılır — sunucu kapısıyla aynı. */
export function evrakKapisindanGecer(rol: AppRole | null | undefined, yontem: string): boolean {
  if (!rol) return false;
  const kapi = MIKRO_EVRAK_KAPILARI.get(yontem);
  if (kapi === undefined || kapi === 'staff') return STAFF_ROLES.includes(rol);
  return isAllowed(rol, kapi[0], kapi[1]);
}
