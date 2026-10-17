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
import { TENANT_COLLECTIONS as TENANT_LIST, USER_SCOPED_COLLECTIONS as USER_SCOPED_LIST, SERVER_ONLY_COLLECTIONS as SERVER_ONLY_LIST, DIS_ROL_SATIR_ALANI, DIS_ROL_YAZAMAZ, SAHIP_SATIR_ALANI, SUNUCU_TURETILEN_ALANLAR } from './collections';
import { STAFF_ROLES, type AppRole } from './rbac';

const TENANT = new Set<string>(TENANT_LIST);
const USER_SCOPED = new Set<string>(USER_SCOPED_LIST);
const SERVER_ONLY = new Set<string>(SERVER_ONLY_LIST);

const STAFF = new Set<AppRole>(STAFF_ROLES);

export interface KiraciKimligi {
  uid: string;
  /** İsteği yapan kullanıcının kiracı id'si — tembel, yalnız gerektiğinde çözülür. */
  cid: () => Promise<string>;
  superAdmin: boolean;
  /** Kullanıcının rolü — TEMBEL ve ZORUNLU: yalnız satır süzgeçli koleksiyonda (DIS_ROL_SATIR_ALANI, SAHIP_SATIR_ALANI) sorulur.
   *  İsteğe bağlı olsaydı unutulan çağrı yeri sessizce süzgeçsiz kalırdı. */
  rol: () => Promise<AppRole | null>;
}

/**
 * SAHİP süzgecinden (collections.SAHIP_SATIR_ALANI — K10) MUAF tek rol: Yönetici. Müdür muaf DEĞİL; rolü çözülemeyen de değil.
 * Süper-admin ayrıcalığı YOK. Kural TEK yerde: sunucu (aşağıdaki `satirAlani`) ve istemci yürütücüsü / bekçi
 * (lib/kuyrukSahipligi) AYNI işlevden sorar — «Yönetici» adı başka dosyada yeniden yazılmaz.
 */
export const sahipSuzgecindenMuaf = (rol: AppRole | null | undefined): boolean => rol === 'Admin';

/**
 * Bu koleksiyonda bu role SATIR süzgeci uygulanır mı? Uygulanırsa sahiplik alanının adı, yoksa null.
 *   • SAHİP süzgeçli koleksiyon (SAHIP_SATIR_ALANI — `syncJobs`): Yönetici dışındaki HER rol (iç roller, Müdür, dış rol,
 *     rolü çözülemeyen) → alan; yalnız Yönetici → null.
 *   • DIŞ ROL süzgeçli koleksiyon (DIS_ROL_SATIR_ALANI — `orders`): iç rol (STAFF_ROLES) → null; dış rol VE rolü çözülemeyen
 *     (null) kullanıcı → alan (kapalı başarısızlık).
 * Süper-admin ayrıcalığı YOK (kiraciWhere ile aynı ilke — onun yolu /api/superadmin/*).
 * Liste SQL'i, tek okuma, altı yazma yolu, akış init'i ve akış olayı HEPSİ bu işlevden okur: okuma = yazma kuralı.
 */
export function satirAlani(coll: string, rol: AppRole | null | undefined): string | null {
  const sahip = SAHIP_SATIR_ALANI.get(coll);
  if (sahip) return sahipSuzgecindenMuaf(rol) ? null : sahip;
  const alan = DIS_ROL_SATIR_ALANI.get(coll);
  if (!alan) return null;
  return rol && STAFF.has(rol) ? null : alan;
}

/**
 * Koleksiyonun satır sahipliği alanı — ROLDEN BAĞIMSIZ («bu koleksiyon satır süzgeçli mi» sorusu ve akış olayının etiketi
 * için: pgShim.broadcastDocChange olayı yayınlarken alıcının rolünü bilmez). Süzgeçsiz koleksiyonda null.
 */
export function satirSahibiAlani(coll: string): string | null {
  return SAHIP_SATIR_ALANI.get(coll) ?? DIS_ROL_SATIR_ALANI.get(coll) ?? null;
}

/**
 * Satır bu kullanıcıya görünür mü? Süzgeç yoksa (iç rol / süzgeçsiz koleksiyon) evet. Süzgeç varsa KATI: kiracı etiketi kendi
 * kiracısı VE sahiplik alanı kendi uid'i olmalı — etiketsiz / sahipsiz satır dış role görünmez (iç roldeki "etiketsiz eski
 * kayıt görünür" esnekliği burada sızıntı olurdu: Mikro faturasından, pazar yerinden, çevrim içi mağazadan gelen siparişlerin
 * sahiplik alanı yoktur). SAHİP süzgecinde aynı katılık: damgasız (K10 öncesi) kuyruk işi Yönetici dışında kimseye görünmez.
 */
export function satirGorunur(coll: string, rol: AppRole | null | undefined, k: { uid: string; cid: string }, data: Record<string, unknown> | undefined): boolean {
  const alan = satirAlani(coll, rol);
  if (!alan) return true;
  return !!k.uid && !!data && data.companyId === k.cid && data[alan] === k.uid;
}

/**
 * AYRILMIŞ KİMLİK: `__` içeren kimlikleri sunucu üretir (`mikrofat__<cid>__<seri>-<sıra>`, `shopify__<özet>`) ve tahmin
 * edilebilir olanları vardır. Satır süzgeçli koleksiyonda DIŞ ROL, kendisine GÖRÜNEN bir kaydı olmayan böyle bir kimliğe
 * yazamaz: önceden açarsa (kimlik kapma) sunucunun sonradan aynı kimliğe yazdığı sipariş — damgalanan sahiplik alanı
 * yüzünden — ona görünür olurdu. `gorunur` = kayıt VAR ve bu kullanıcıya görünür; "yok" ile "var ama görünmez" aynı sonucu
 * verir (yanıt farkı tahmin edilebilir kimliklerin VARLIĞINI sızdırırdı).
 */
export function ayrilmisKimlikMi(coll: string, id: string, rol: AppRole | null | undefined, gorunur: boolean): boolean {
  return ayrilmisKimlikAdayi(coll, id, gorunur) && satirAlani(coll, rol) !== null;
}

/**
 * `ayrilmisKimlikMi`'nin ROL SORMADAN bilinen kısmı (ucuz ön eleme): aday değilse hiçbir rolde engel yoktur, rol sorgusuna gerek
 * kalmaz. Kararın kendisi DEĞİL: adayı engele çeviren, rolün dış ya da çözülemez olmasıdır.
 * Eskiden bu üç koşul server.ts sarmalayıcısında KOPYA olarak duruyordu ve saf işlevden önce dönüyordu: tek işaret hatası
 * kapıyı sessizce devre dışı bırakıyor, testler yeşil kalıyordu.
 * YALNIZ dış rol haritası (DIS_ROL_SATIR_ALANI): SAHİP süzgeçli koleksiyona (`syncJobs`) BİLEREK uygulanmaz — kuyruk işinin
 * kimliği gönderilen varlığın kimliğinden türer ve o `__` taşıyabilir (`mikro_…_mikrofat__<cid>__<seri>-<sıra>_<uid>`);
 * kapı uygulansaydı meşru iş 403 alırdı.
 */
export function ayrilmisKimlikAdayi(coll: string, id: string, gorunur: boolean): boolean {
  return !gorunur && id.includes('__') && DIS_ROL_SATIR_ALANI.has(coll);
}

/**
 * Sahiplik denetimi BAŞARISIZ olunca dönülecek durum kodu. Satır süzgeçli koleksiyonda dış role (ve rolü çözülemeyene) "yok" ile
 * AYNI yanıt: 404 — varlık sızmaz (tek GET ve Luca ucu da öyle). İç rolde ve süzgeçsiz koleksiyonda bugünkü 403.
 * SAHİP süzgeçli koleksiyonda (`syncJobs`) Yönetici dışındaki her rol 404 alır: başkasının işinin VARLIĞI da sızmaz. Bu kod
 * yalnız atomik artırma ve koşullu yazma yollarında kullanılır; PUT / PATCH / DELETE başkasının kaydına 403 döner (server.ts).
 */
export function sahipsizDurumKodu(coll: string, rol: AppRole | null | undefined): 404 | 403 {
  return satirAlani(coll, rol) !== null ? 404 : 403;
}

/**
 * Canlı akışta TEK olayın kararı (satır süzgeci: dış rol — `orders`; SAHİP — `syncJobs`, Yönetici dışındaki her rol).
 * `gonderilen` = bu bağlantıya daha önce gönderilmiş satırların anahtarları (`coll/id`) — işlev onu GÜNCELLER.
 *   • 'gonder' — süzgeç yok (iç rol / süzgeçsiz koleksiyon) ya da satır kullanıcının kendi satırı;
 *   • 'sil'    — satır artık görünmüyor ama bu bağlantıya daha önce gönderilmişti (yeniden atama): istemci önbelleğinden
 *                düşsün diye yalnız kimliğiyle `delete` gider — doküman gövdesi GİTMEZ;
 *   • 'yut'    — başkasının / etiketsiz / yabancı kiracının satırı: hiçbir şey gönderilmez.
 * Eskiden her sipariş değişikliği dokümanın TAMAMIYLA kiracıdaki dış rollü herkese canlı gidiyordu.
 */
export function akisOlayKarari(
  ev: { coll: string; id?: string; type?: string; cid?: string | null; satirSahibi?: string | null },
  k: { uid: string; cid: string; rol: AppRole | null },
  gonderilen: Set<string>,
): 'gonder' | 'sil' | 'yut' {
  if (satirAlani(ev.coll, k.rol) === null) return 'gonder';
  const anahtar = `${ev.coll}/${ev.id}`;
  const kendi = !!ev.id && !!k.uid && ev.cid === k.cid && ev.satirSahibi === k.uid;
  if (!kendi) return gonderilen.delete(anahtar) ? 'sil' : 'yut';
  if (ev.type === 'delete') gonderilen.delete(anahtar); else gonderilen.add(anahtar);
  return 'gonder';
}

/** `/api/db` DIŞINDAKİ uçlar için: bu kullanıcı bu SİPARİŞİ görebilir mi (kiracı + dış rolde satır). */
export function siparisGorebilir(rol: AppRole | null | undefined, k: { uid: string; cid: string }, siparis: Record<string, unknown> | undefined): boolean {
  if (!siparis) return false;
  const dc = (siparis.companyId as string) || null;
  if (dc !== null && dc !== k.cid) return false;
  return satirGorunur('orders', rol, k, siparis);
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
    // Satır süzgeçli koleksiyon + süzgece tabi rol (dış rol; SAHİP süzgecinde Yönetici dışındaki her rol): KATI — kendi kiracısı
    // ve sahiplik alanı = uid (etiketsiz / damgasız satır görünmez). Alan adı PARAMETREDİR (koddaki sabit haritadan; enjeksiyon
    // yüzeyi yok). Süzgece tabi olmayan rolde çıktı birebir eskisi. Rol yalnız süzgeçli koleksiyonda sorulur (tembel).
    const alan = satirSahibiAlani(coll) ? satirAlani(coll, await k.rol()) : null;
    if (alan) return { sql: " AND data->>'companyId' = $2 AND data->>$3 = $4", params: [await k.cid(), alan, k.uid] };
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

/** DIS_ROL_YAZAMAZ'daki alanları yamadan düşürür (yalnız dış rol için çağrılır; saf, testli). */
export function disRolAlanlariniDusur(coll: string, data: Record<string, unknown>): Record<string, unknown> {
  const yasak = DIS_ROL_YAZAMAZ.get(coll);
  if (!yasak || yasak.length === 0) return data;
  return Object.fromEntries(Object.entries(data).filter(([ad]) => !yasak.includes(ad)));
}

/** Önceki kayıttaki DIS_ROL_YAZAMAZ alanları — dış rolün yazımında aynen geri konur (PATCH / PUT-merge «yazamaz», «siler» değil). */
export function yasakAlanlariKoru(coll: string, onceki: Record<string, unknown> | undefined): Record<string, unknown> {
  const yasak = DIS_ROL_YAZAMAZ.get(coll);
  if (!onceki || !yasak || yasak.length === 0) return {};
  return Object.fromEntries(yasak.filter(ad => ad in onceki).map(ad => [ad, onceki[ad]]));
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
export async function kiraciDamgala(coll: string, gelen: Record<string, unknown>, k: KiraciKimligi, onceki?: Record<string, unknown>): Promise<Record<string, unknown>> {
  // SUNUCUNUN TÜRETTİĞİ ALANLAR (collections.SUNUCU_TURETILEN_ALANLAR — e-Fatura gönderim işareti): ROLDEN BAĞIMSIZ, sessizce
  // düşer. Önceki değer burada geri KONMAZ: PUT / PATCH çakışma dalında YAZIM ANINDAKİ satır değerini SQL korur
  // (`sunucuAlanKorumaSql`), cas `data || set` ile korur. JS'te okunan `onceki`den geri koymak, SELECT ile yazım arasına düşen
  // sunucu talebini silerdi (şartname «e-Fatura çift kesim» D3 / SV-4).
  const data = sunucuAlanlariniDusur(coll, gelen);
  if (TENANT.has(coll)) {
    // SAHİP damgası (K10 — collections.SAHIP_SATIR_ALANI): ROLDEN BAĞIMSIZ, Yönetici oluştururken de damgalanır. Kayıtta sahip
    // VARSA o korunur — devredilemez: yamada / gövdede gelen değer 403 ÜRETMEZ, sessizce ezilir (`companyId` / `userId` ile
    // aynı desen; ret alan adını öğretirdi). Yoksa (yeni kayıt: `onceki` yok ya da `{}`; ya da Yönetici'nin dokunduğu damgasız
    // eski kayıt) oturumun kullanıcısı sahip olur. Sahibi damgayı DÜŞÜREMEZ: PATCH birleştirmeden SONRA buraya gelir, tam
    // değiştirmede (PUT) önceki sahip geri konur, koşullu yazma `data || set` alan silemez, atomik artırma bu alanda 400 döner.
    const sahipAlan = SAHIP_SATIR_ALANI.get(coll);
    if (sahipAlan) {
      const eski = onceki?.[sahipAlan];
      return { ...data, companyId: await k.cid(), [sahipAlan]: typeof eski === 'string' && eski !== '' ? eski : k.uid };
    }
    // Dış rol satır süzgeçli koleksiyona yazarken sahiplik alanı KOŞULSUZ kendi uid'idir: başkası adına ya da sahipsiz kayıt
    // açamaz, kendi kaydını başkasına devredemez (userId damgasıyla aynı desen). İç rolde alana dokunulmaz (yeniden atama serbest).
    const alan = DIS_ROL_SATIR_ALANI.has(coll) ? satirAlani(coll, await k.rol()) : null;
    // Dış rol sunucunun eşleştirme alanlarını (DIS_ROL_YAZAMAZ) yazamaz: pazar yeri senkronu o alanla eşleşip `merge: true` ile
    // üstüne yazdığından, önceden yazılmış alan gerçek siparişi dış rolün kaydına çekerdi. Sessizce düşer; kayıtta önceden
    // varsa (`onceki`: PUT / PATCH / cas yolları mevcut belgeyi verir) önceki değer korunur. İç rolde dokunulmaz.
    const temiz = alan ? { ...disRolAlanlariniDusur(coll, data), ...yasakAlanlariKoru(coll, onceki) } : data;
    return { ...temiz, companyId: await k.cid(), ...(alan ? { [alan]: k.uid } : {}) };
  }
  if (USER_SCOPED.has(coll)) return { ...data, userId: k.uid };
  return data;
}

/** Sunucunun türettiği alanların adları (yoksa boş). Ad SQL'e gömülür → yalnız `[A-Za-z0-9_]` kabul edilir (fırlatır). */
export function sunucuTuretilenAlanlar(coll: string): readonly string[] {
  const alanlar = SUNUCU_TURETILEN_ALANLAR.get(coll) ?? [];
  for (const a of alanlar) if (!/^[A-Za-z0-9_]+$/.test(a)) throw new Error(`SUNUCU_TURETILEN_ALANLAR: geçersiz alan adı '${a}'`);
  return alanlar;
}

/** Yazım gövdesinden sunucunun türettiği alanları düşürür (saf). Nokta yolu birleştirmeden SONRA üst düzey anahtara döner
 *  (pgShim.mergeDocData), PUT / PATCH bu işleve birleştirilmiş veriyi verir; ham gövde yolu (POST, cas `set`) için nokta
 *  yollu anahtar (`mikroFaturaGonderimi.durum`) da düşer. */
export function sunucuAlanlariniDusur(coll: string, data: Record<string, unknown>): Record<string, unknown> {
  const alanlar = sunucuTuretilenAlanlar(coll);
  if (alanlar.length === 0) return data;
  return Object.fromEntries(Object.entries(data).filter(([ad]) => !alanlar.some(a => ad === a || ad.startsWith(`${a}.`))));
}

/**
 * `… SET data = <bu ifade>` — sunucunun türettiği alanı YAZIM ANINDA koruyan ifade. `yeni` = yazılacak verinin SQL ifadesi:
 *   • `EXCLUDED.data` (varsayılan) — `/api/db` PUT ve PATCH'in son yazımı (server.ts) ve pgShim `set`in çakışma dalı
 *     (`INSERT … ON CONFLICT (coll, id) DO UPDATE SET data = <ifade>`);
 *   • `$3::jsonb` — pgShim `update` (`UPDATE docs SET data = <ifade> WHERE …`; şartname «e-Fatura çift kesim» Y1).
 * Sunucunun türettiği alan yoksa ifade `yeni`nin KENDİSİDİR (davranış birebir eski). Varsa gelen veriden alan çıkarılır ve YAZIM
 * ANINDAKİ satırın (`docs.data` — iki deyimde de güncellenen satırın ESKİ değeri) değeri geri konur — tek ifadede, satır kilidi
 * altında: oku-değiştir-yaz kalıbının SELECT'i ile yazımı arasına düşen sunucu talebi korunur; araya düşen geri alma / çözüm
 * işareti sildiyse bayat okumadaki işaret de geri GELMEZ. Satır yoksa (INSERT dalı) ifade koşmaz: `/api/db`'de alan zaten
 * `kiraciDamgala`'da düşmüştür; pgShim'de sunucunun kendi verisi aynen yazılır. İfade alan listesinden üretilir (kopya metin yok).
 */
export function sunucuAlanKorumaSql(coll: string, yeni = 'EXCLUDED.data'): string {
  const alanlar = sunucuTuretilenAlanlar(coll);
  if (alanlar.length === 0) return yeni;
  const cikar = alanlar.map(a => ` - '${a}'`).join('');
  const koru = alanlar.map(a => ` || CASE WHEN docs.data ? '${a}' THEN jsonb_build_object('${a}', docs.data->'${a}') ELSE '{}'::jsonb END`).join('');
  return `(${yeni}${cikar})${koru}`;
}

/**
 * SAHİP süzgeçli koleksiyonda (SAHIP_SATIR_ALANI — `syncJobs`) TAM DEĞİŞTİRME (PUT) yalnız kaydın sahibine (inceleme
 * düzeltmesi, 2026-10-17). Sahip devredilemediği için (`kiraciDamgala` önceki sahibi geri koyar) Yönetici'nin başkasının
 * damgalı kaydına yazdığı gövde ÖNCEKİ sahibin okumasına düşerdi — G2 kimlik kapmasında kurban Yönetici ise gövde
 * (cari kodu, tutar) saldırgana sızardı. Yönetici DÂHİL reddedilir; Yönetici dışındaki roller bu kayda zaten sahiplik
 * kapısında (`dokumanSahibiMi`) 403 alır. Yeni kayıt (`onceki` yok / `{}`) ve damgasız ya da bozuk damgalı eski kayıt
 * engellenmez (damgayı oturum alır). PATCH / koşullu yazma / silme bu yüklemi SORMAZ: Yönetici'nin kapatma ve temizlik
 * yolları onlardan geçer, gövde de değişmez. Bağlantı çiti: server/satirSuzgeci.degismez.test.
 */
export function baskasininSahipKaydiMi(coll: string, onceki: Record<string, unknown> | undefined, uid: string): boolean {
  const alan = SAHIP_SATIR_ALANI.get(coll);
  const eski = alan ? onceki?.[alan] : undefined;
  return typeof eski === 'string' && eski !== '' && eski !== uid;
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
    if (dc !== null && dc !== await k.cid()) return false;
    // Satır süzgeci (dış rol — `orders`; SAHİP — `syncJobs`: Yönetici dışındaki her rol): mevcut kayıt yalnız KENDİSİNİNSE
    // (etiketsiz / damgasız / başkasının → hayır). Okuma, yazma, silme, artırma, koşullu yazma hepsi bu kapıdan.
    if (satirSahibiAlani(coll)) return satirGorunur(coll, await k.rol(), { uid: k.uid, cid: await k.cid() }, docData);
    return true;
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
  k: { uid: string; cid: string; rol: AppRole | null },
): boolean {
  if (!data) return true;
  if (coll === 'users') return (!!id && id === k.uid) || ((data.companyId as string) || null) === k.cid;
  if (coll === 'settings') { const sahip = ayarSahibi(id); return sahip === null || sahip === k.cid; }   // kimlikten — `data.companyId` DEĞİL (bkz. ayarSahibi)
  if (TENANT.has(coll)) {
    const dc = (data.companyId as string) || null;
    return (dc === null || dc === k.cid) && satirGorunur(coll, k.rol, k, data);   // satır süzgeci (katı): dış rol; SAHİP süzgecinde Yönetici dışı her rol
  }
  if (USER_SCOPED.has(coll)) { const du = (data.userId as string) || null; return du === null || du === k.uid; }
  return true;
}

/** SSE init sorgusunun koleksiyon kovaları: `users` KENDİ kovasında (companyId = kiracı VEYA id = uid); `settings` KENDİ kovasında
 *  (global + yalnız çağıranın `<cid>__*` ayarları — eskiden filtresiz `diger`e düşüyor, her kiracının ayarı diskten okunuyordu);
 *  `satir`: bu ROLE satır süzgeci uygulanan koleksiyonlar (dış rolde `orders`; Yönetici dışındaki her rolde `syncJobs` — yalnız
 *  kendi kiracısı VE sahiplik alanı = uid) — `tenant` kovasından AYRIK;
 *  sunucuya özel koleksiyonlar hiçbir kovaya girmez (diske gitmez). */
export function akisKovalari(colls: readonly string[], rol: AppRole | null): {
  tenant: string[]; user: string[]; users: string[]; ayar: string[]; diger: string[];
  /** Satır kovası (`satirAlani`'nın bu role alan döndürdüğü koleksiyonlar): koleksiyon + sahiplik alanı. */
  satir: Array<{ coll: string; alan: string }>;
} {
  const satir = colls.flatMap(c => { const alan = TENANT.has(c) ? satirAlani(c, rol) : null; return alan ? [{ coll: c, alan }] : []; });
  const satirli = new Set(satir.map(x => x.coll));
  return {
    tenant: colls.filter(c => TENANT.has(c) && !satirli.has(c)),
    user:   colls.filter(c => USER_SCOPED.has(c)),
    users:  colls.filter(c => c === 'users'),
    ayar:   colls.filter(c => c === 'settings'),
    diger:  colls.filter(c => !TENANT.has(c) && !USER_SCOPED.has(c) && c !== 'users' && c !== 'settings' && !SERVER_ONLY.has(c)),
    satir,
  };
}
