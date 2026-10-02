/**
 * tenantErisim.ts — /api/db kiracı/kullanıcı kapsam kuralları, SAF (Faz 1 4/n, 2026-09-05).
 *
 * server.ts `startServer` içindeki dört kapanış (tenantWhere / injectTenant /
 * sahiplikDenetimli / ownsDoc) buraya taşındı; server.ts artık isteğin kimliğini çözüp
 * (uid, tembel kiracı getter'ı, süper-admin) bunları çağıran ince sarmalayıcı. NEDEN: bu
 * dört kural kiracılar-arası sızıntının TEK savunması (2026-08-11/22 denetimleri) ve
 * server.ts import edilemediği için TESTSİZDİ. Sözleşme tenantErisim.test.ts'te.
 *
 * `cid()` GETTER'dır (tembel): USER_SCOPED ve sınıfsız koleksiyonlarda kiracı sorgusu HİÇ
 * yapılmaz — eski davranış korunur (getUserCompanyId 60 sn önbellekli ama ilk çağrı DB'ye gider).
 */
import { TENANT_COLLECTIONS as TENANT_LIST, USER_SCOPED_COLLECTIONS as USER_SCOPED_LIST, SERVER_ONLY_COLLECTIONS as SERVER_ONLY_LIST } from './collections';

const TENANT = new Set<string>(TENANT_LIST);
const USER_SCOPED = new Set<string>(USER_SCOPED_LIST);
const SERVER_ONLY = new Set<string>(SERVER_ONLY_LIST);

export interface KiraciKimligi {
  uid: string;
  /** İsteği yapan kullanıcının kiracı id'si — tembel, yalnız gerektiğinde çözülür. */
  cid: () => Promise<string>;
  superAdmin: boolean;
}

/**
 * Listeleme WHERE eki — lenient (etiketsiz legacy doc sahibe görünür). Dönen params $2'den başlar.
 *
 * `users` İKİ SETTE DE YOK, dolayısıyla eskiden buraya kadar düşüyor ve boş filtre
 * dönüyordu: GET /api/db/users HER kiracının kullanıcı kayıtlarını (ad, e-posta, rol,
 * companyId) döküyordu — kiracılar arası PII sızıntısı (2026-08-22 denetim bulgusu;
 * C7/C19'un listeleme yarısı). Süper-admin ayrıcalığı burada YOK: onun için ayrı
 * /api/superadmin/* uçları var ve onlar bilerek global. Kendi kaydı her koşulda görünür
 * (companyId'si henüz damgalanmamış yeni davet edilen kullanıcı kendini okuyabilsin diye).
 */
export async function kiraciWhere(coll: string, k: KiraciKimligi): Promise<{ sql: string; params: unknown[] }> {
  if (TENANT.has(coll)) {
    return { sql: " AND (data->>'companyId' = $2 OR NOT (data ? 'companyId'))", params: [await k.cid()] };
  }
  if (USER_SCOPED.has(coll)) {
    return { sql: " AND (data->>'userId' = $2 OR NOT (data ? 'userId'))", params: [k.uid] };
  }
  if (coll === 'users') {
    return { sql: " AND (data->>'companyId' = $2 OR id = $3)", params: [await k.cid(), k.uid] };
  }
  // `settings` TENANT listesinde DEĞİL (dağıtım düzeyi, global dokümanlar da taşır). Firma-bazlı ayarın sahibi DOKÜMAN KİMLİĞİNDEN
  // okunur (`<cid>__<anahtar>` — bkz. `ayarSahibi`), `data.companyId`'den DEĞİL. Eskiden buraya kadar düşüp BOŞ filtre dönüyordu:
  // GET /api/db/settings her kiracının firma-bazlı ayarlarını (içlerindeki sırlarla, Admin'e maskesiz) döküyordu (2026-10-02).
  if (coll === 'settings') {
    return { sql: " AND (position('__' in id) = 0 OR left(id, length($2)) = $2)", params: [`${await k.cid()}${AYAR_AYRACI}`] };
  }
  return { sql: '', params: [] };
}

/**
 * `settings` dokümanının SAHİBİ kimlikten okunur: firma-bazlı ayar `<cid>__<anahtar>` kimliğiyle saklanır (server.ts
 * `settingsRealId`); `__` içermeyen kimlik GLOBAL (dağıtım düzeyi) ayardır → `null`.
 *
 * NEDEN `data.companyId` DEĞİL (2026-10-02 taraması): (1) `settings/luca` dokümanındaki `companyId` alanı LUCA FİRMA KİMLİĞİDİR —
 * akış onu kiracı etiketi sanıp dokümanı sahibi dâhil HERKESTEN gizliyordu; (2) alan istemciden geldiği için bir kiracı global
 * dokümana `companyId: '<kurban>'` yazıp görünürlüğünü kaçırabiliyordu; (3) sunucunun `adminDb` ile yazdığı firma-bazlı ayar
 * (süper-admin firma profili) damgasız kalıp tüm kiracıların akışına düşüyordu. Kimlik sunucuda üretilir, istemci `__` içeren
 * kimlik gönderemez (`rejectNamespacedSettings`) — taklit edilemez.
 */
export const AYAR_AYRACI = '__';
export function ayarSahibi(id: string | undefined): string | null {
  const i = id ? id.indexOf(AYAR_AYRACI) : -1;
  return i > 0 ? (id as string).slice(0, i) : null;
}
/** İstemcinin gördüğü ayar anahtarı: firma-bazlı kimlikte kiracı öneki ATILIR (`<cid>__app` → `app`). */
export function ayarAnahtari(id: string): string {
  const i = id.indexOf(AYAR_AYRACI);
  return i > 0 ? id.slice(i + AYAR_AYRACI.length) : id;
}
/**
 * Akış (SSE) init'i ve REST listesi için `settings` satırlarını çağırana göre düzenler: yabancı kiracının firma-bazlı ayarı DÜŞER;
 * kendi firma-bazlı ayarı DÜZ anahtarla döner (istemci `settings/app` dinler — ham `<cid>__app` kimliğiyle gönderilince bulamıyor,
 * sayfa yenilenince bayat global dokümanı gösteriyordu); aynı anahtarın hem firma-bazlısı hem eski global kopyası varsa firma-bazlı
 * kazanır (çift kayıt gitmez).
 */
export function ayarSatirlari<T extends { id: string }>(satirlar: readonly T[], cid: string): T[] {
  const kendi = new Map<string, T>();
  const global: T[] = [];
  for (const r of satirlar) {
    const sahip = ayarSahibi(r.id);
    if (sahip === null) global.push(r);
    else if (sahip === cid) kendi.set(ayarAnahtari(r.id), { ...r, id: ayarAnahtari(r.id) });
  }
  return [...global.filter(r => !kendi.has(r.id)), ...kendi.values()];
}

/**
 * Yazmada companyId/userId enjekte et (istemci değerini geçersiz kıl).
 *
 * userId KOŞULSUZ damgalanır (2026-08-22, P3 ile birlikte): eskiden `!('userId' in data)`
 * şartı vardı — istemci userId'yi KENDİSİ gönderirse ona GÜVENİLİYORDU, yani bir kullanıcı
 * başka birinin bildirim/tercih kaydını yazabilirdi. TENANT damgası nasıl istemci
 * companyId'sini her zaman eziyorsa, userId de öyle ezilir. Kod tabanındaki tüm meşru
 * yazmalar zaten kendi uid'sini gönderiyor (App.tsx createNotification vb.).
 */
export async function kiraciDamgala(coll: string, data: Record<string, unknown>, k: KiraciKimligi): Promise<Record<string, unknown>> {
  if (TENANT.has(coll)) return { ...data, companyId: await k.cid() };
  if (USER_SCOPED.has(coll)) return { ...data, userId: k.uid };
  return data;
}

/**
 * Bir koleksiyonun SAHİPLİK denetimine tabi olup olmadığı — `dokumanSahibiMi` bu yüklem
 * doğruyken çağrılır.
 *
 * NEDEN AYRI (2026-08-22 denetim bulgusu): koşul dört ayrı yerde (SET/DELETE/increment/
 * update) elle `TENANT.has(coll) || USER_SCOPED.has(coll)` diye yazılıydı. `users` ise İKİ
 * SETTE DE YOK — bu yüzden C7/C19 için `ownsDoc` içine eklenen "users" dalı bu dört yolda
 * HİÇ çağrılmıyordu: kiracı A'nın Admin'i DELETE /api/db/users/<B-uid> ile BAŞKA firmanın
 * kullanıcısını silebiliyordu. Yüklem tek yere alındı ve `users` açıkça dahil edildi.
 */
export const sahiplikDenetimli = (coll: string): boolean =>
  TENANT.has(coll) || USER_SCOPED.has(coll) || coll === 'users' || coll === 'settings';

/**
 * Mevcut doküman sahibin mi? (etiketsiz legacy → erişilebilir — users HARİÇ.)
 *
 * users KİRACI-KAPSAMLI DEĞİL (TENANT dışında) — bu yüzden eskiden buradan hep `true`
 * dönüyor ve A kiracısının Admin'i B kiracısının kullanıcılarının rolünü/durumunu
 * değiştirebiliyordu. Kural (2026-08-22): kendi dokümanın → serbest; süper-admin → serbest;
 * aksi halde hedef dokümanın companyId'si SENİN kiracın olmalı. Etiketsiz (companyId'siz)
 * bir users dokümanı BAŞKA bir kiracının sahibidir (companyId = kendi uid'i) — ona da
 * dokunulamaz; bu yüzden burada TENANT koleksiyonlarındaki "etiketsiz → görünür" esnekliği YOK.
 */
export async function dokumanSahibiMi(
  coll: string,
  docData: Record<string, unknown> | undefined,
  k: KiraciKimligi,
  docId?: string,
): Promise<boolean> {
  if (!docData) return true; // yeni kayıt
  if (coll === 'users') {
    if (docId && docId === k.uid) return true;
    if (k.superAdmin) return true;
    const hedefCid = (docData.companyId as string) || null;
    return !!hedefCid && hedefCid === await k.cid();
  }
  // settings: sahip KİMLİKTEN (`ayarSahibi`). Firma-bazlı ayar yalnız sahibinin; global (dağıtım düzeyi) ayar bugün her kiracı
  // yöneticisine açık — çok kiracıda sahip kiracıya daraltmak ayrı karar (Açık İşler «2. müşteri öncesi»). Süper-admin ayrıcalığı YOK.
  if (coll === 'settings') {
    const sahip = ayarSahibi(docId);
    return sahip === null || sahip === await k.cid();
  }
  if (TENANT.has(coll)) {
    const dc = (docData.companyId as string) || null;
    return dc === null || dc === await k.cid();
  }
  if (USER_SCOPED.has(coll)) {
    const du = (docData.userId as string) || null;
    return du === null || du === k.uid;
  }
  return true;
}

/**
 * Canlı akış (SSE /api/db/stream) satır görünürlüğü — `kiraciWhere`'in JS karşılığı, ikinci kapı.
 * Lenient: etiketsiz legacy görünür; `settings` firma-bazlı; `users` HARİÇ (kendi kaydı ya da
 * kendi kiracısı — etiketsiz users dokümanı başkasınındır).
 *
 * 4/n incelemesi (2026-09-05): SSE'deki kopyada `users` dalı YOKTU ve SQL'de users filtresiz
 * kovaya düşüyordu → kiracı A'nın Admin'i `?init=users` ile TÜM kiracıların kullanıcı kayıtlarını
 * (ad, e-posta, rol) alıyordu. GET yolu 2026-08-22'de düzeltilmiş, SSE kopyası sapmıştı — bu
 * yüzden iki yol artık aynı modülden okuyor.
 */
export function akisSatiriGorunur(
  coll: string,
  id: string | undefined,
  data: Record<string, unknown> | undefined,
  k: { uid: string; cid: string },
): boolean {
  if (!data) return true;
  if (coll === 'users') return (!!id && id === k.uid) || ((data.companyId as string) || null) === k.cid;
  if (coll === 'settings') { const sahip = ayarSahibi(id); return sahip === null || sahip === k.cid; }   // kimlikten — `data.companyId` DEĞİL (bkz. ayarSahibi)
  if (TENANT.has(coll)) { const dc = (data.companyId as string) || null; return dc === null || dc === k.cid; }
  if (USER_SCOPED.has(coll)) { const du = (data.userId as string) || null; return du === null || du === k.uid; }
  return true;
}

/** SSE init sorgusunun koleksiyon kovaları: `users` KENDİ kovasında (companyId = kiracı VEYA id = uid); `settings` KENDİ kovasında
 *  (global + yalnız çağıranın `<cid>__*` ayarları — eskiden filtresiz `diger`e düşüyor, her kiracının ayarı diskten okunuyordu);
 *  sunucuya özel koleksiyonlar hiçbir kovaya girmez (diske gitmez). */
export function akisKovalari(colls: readonly string[]): { tenant: string[]; user: string[]; users: string[]; ayar: string[]; diger: string[] } {
  return {
    tenant: colls.filter(c => TENANT.has(c)),
    user:   colls.filter(c => USER_SCOPED.has(c)),
    users:  colls.filter(c => c === 'users'),
    ayar:   colls.filter(c => c === 'settings'),
    diger:  colls.filter(c => !TENANT.has(c) && !USER_SCOPED.has(c) && c !== 'users' && c !== 'settings' && !SERVER_ONLY.has(c)),
  };
}
