/**
 * mikroEvrakKapilari.ts — `POST /api/mikro/evrak/kaydet` yöntem beyaz listesi + yöntem başına ROL KAPISI (2026-10-10;
 * karar turu 2026-10-11).
 *
 * NEDEN TABLO: uç, istemcinin kurduğu gövdeyi Mikro'ya OLDUĞU GİBİ iletir (sunucuda gövde kurulmaz). Tek bir «iç personel»
 * kapısı yetmez: aynı Mikro yazımı (`DekontKaydetV2` — cari borç / alacak) `cari-hareket/kaydet`'te muhasebe kapısının
 * arkasındayken bu uçtan serbest gövdeyle İK / Hukuk / Kalite rolüne açık kalırdı (zayıf yol kapanıp güçlü yol açık).
 *
 * BEYAZ LİSTE BU TABLODAN TÜRER — kapısız yöntem eklenemez. `Map`, düz nesne DEĞİL: `'constructor'` / `'toString'` gibi
 * miras anahtarlar beyaz listeyi geçmesin.
 *
 * KURAL (karar turu 2026-10-11, İ1 — «yazan uç yazma kapısı alır»): her yöntem, Cetpa'daki EŞDEĞER koleksiyonun yazma
 * kuralını ister. Bu, yöntemin düğmesini ilk turda gören bazı iç rolleri BİLEREK kilitler (satırlardaki «kilitlenen»
 * notları); düğme o rolde ÇİZİLMEZ, sessiz çağrı HİÇ yapılmaz (İ3 — ölü düğme yok). `'staff'` yalnız eşdeğer koleksiyonu
 * olmayan yöntemde kalır ve gerekçesi satırında yazılıdır. Çit: mikroRoutes.rolKapisi.test.ts.
 *
 * DIŞ ROL: düz ikili kuralı DIŞ ROL İÇEREMEZ (çit Ç9). Kuralı dış rol de içeren koleksiyon (`quotations` yazma: B2B / Bayi)
 * `{ icRolVe: … }` ile yazılır — kapı ÖNCE iç personel şartını, SONRA kuralı arar. Düz yazılırsa ilk turda kapanan açık
 * (dış rolün Mikro'ya teklif yazması) yeniden açılır (H4).
 *
 * Saf modül: sunucu (kapı + işleyici) ve istemci (düğme, sessiz çağrı, yeniden deneme kuyruğu süzgeci) AYNI tabloyu okur.
 */
import { STAFF_ROLES, isAllowed, type AppRole } from './rbac';

/** Eşdeğer Cetpa koleksiyonunun kuralı — sunucuda `requireCollectionAccess(koleksiyon, eylem)`. */
export type EvrakKurali = readonly [koleksiyon: string, eylem: 'read' | 'write'];

/**
 * `'staff'`            = yalnız iç personel şartı.
 * ikili                = yalnız koleksiyon kuralı (kural dış rol içeremez — Ç9).
 * `{ icRolVe: ikili }` = iç personel şartı VE koleksiyon kuralı (kural dış rol içeriyorsa — H4).
 */
export type EvrakKapisi = 'staff' | EvrakKurali | { readonly icRolVe: EvrakKurali };

export const MIKRO_EVRAK_KAPILARI: ReadonlyMap<string, EvrakKapisi> = new Map<string, EvrakKapisi>([
  // K3-a — cari borç / alacak yazar; `cari-hareket/kaydet` ile AYNI kapı. Kilitlenen: Satış, Satın Alma.
  ['DekontKaydetV2', ['mikroCariHareketler', 'write']],
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
  // K3-b / H4 — `quotations` yazma kuralı B2B / Bayi'yi de geçirir → iç personel şartı İLE BİRLİKTE. Kilitlenen: Muhasebe.
  ['VerilenTeklifKaydetV2', { icRolVe: ['quotations', 'write'] }],
  // K3-c — kilitlenen: Muhasebe.
  ['DahiliStokHareketKaydetV2', ['inventoryMovements', 'write']],
  // K3-d — sessiz çağrı (sayım kaydından sonra); rol geçemiyorsa yapılmaz.
  ['SayimSonuclariKaydetV2', ['wmsCycleCounts', 'write']],
  // K3-e — `'staff'` KALIR: eşdeğer Cetpa koleksiyonu yok; kayıt etiket basım günlüğüdür (stok / cari / muhasebe yazmaz).
  ['EtiketBasimKaydetV2', 'staff'],
  // K3-f — kilitlenen: Muhasebe.
  ['PersonelIzinTalepKaydetV2', ['leaveRequests', 'write']],
  // K3-g — kilitlenen: Kalite.
  ['UrunReceteKaydetV2', ['bom', 'write']],
  // K3-h — kilitlenen: Satın Alma, Muhasebe.
  ['UretimTalepKaydetV2', ['productionOrders', 'write']],
  ['UretimIsEmriOlusturV2', ['productionOrders', 'write']],
  // K3-i — kilitlenen: Lojistik, Muhasebe, Kalite.
  ['SatinAlmaTalepKaydetV2', ['purchaseOrders', 'write']],
  // K3-j — kilitlenen: Satın Alma.
  ['BakimTalepKaydetV2', ['isEmirleri', 'write']],
  // K3-k — kilitlenen: Satın Alma, Muhasebe, Satış.
  ['DepolarArasiSiparisKaydetV2', ['transfers', 'write']],
]);

/** İstek gövdesindeki yöntem adı. Kapı ve işleyici AYNI ayıklayıcıyı kullanır — ayrışırlarsa kapı bir yöntemin kuralına
 *  bakarken işleyici başkasını Mikro'ya gönderir. Dize olmayan / eksik değer boş dizedir (beyaz listede yok). */
export const evrakYontemi = (govde: unknown): string => {
  const m = (govde as { method?: unknown } | undefined | null)?.method;
  return typeof m === 'string' ? m : '';
};

/** Kapının İKİ koşulu — sunucu kapısı ve istemci süzgeci AYNI çözümü kullanır (ayrışırlarsa düğme ile kapı ayrışır).
 *  Tanınmayan yöntem (`undefined`) `'staff'` sayılır: iç personel işleyiciye ulaşır ve 400 alır, dış rol 403'te kalır. */
export function evrakKapiKosullari(kapi: EvrakKapisi | undefined): { icRol: boolean; kural: EvrakKurali | null } {
  if (kapi === undefined || kapi === 'staff') return { icRol: true, kural: null };
  if ('icRolVe' in kapi) return { icRol: true, kural: kapi.icRolVe };
  return { icRol: false, kural: kapi };
}

/** Bu rol, yöntemin sunucudaki kapısından geçer mi? İstemci düğmeyi çizmeden, sessiz çağrıyı yapmadan ve yeniden deneme
 *  kuyruğundaki işi sahiplenmeden ÖNCE sorar (geçemeyecek rol isteği atıp 403'e çarpmasın). Rolsüz hesap geçemez. */
export function evrakKapisindanGecer(rol: AppRole | null | undefined, yontem: string): boolean {
  if (!rol) return false;
  const { icRol, kural } = evrakKapiKosullari(MIKRO_EVRAK_KAPILARI.get(yontem));
  if (icRol && !STAFF_ROLES.includes(rol)) return false;
  return kural === null || isAllowed(rol, kural[0], kural[1]);
}
