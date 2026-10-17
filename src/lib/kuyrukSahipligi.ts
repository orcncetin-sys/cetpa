/**
 * kuyrukSahipligi.ts — yeniden deneme kuyruğunda (`syncJobs`) «iş kimin, hangi oturum gönderir» kuralı (K10, 2026-10-11). SAF.
 *
 * AÇIK NEYDİ: kuyruğa yazabilen her iç rol `{ type: 'mikro', payload: { method: 'DekontKaydetV2', … } }` yazıp işi YETKİLİ bir
 * rolün açık oturumuna çalıştırtabiliyordu — yürütücü işi KENDİ kimliğiyle gönderir, ilk turun rol süzgeci yürütenin rolüne
 * bakıyordu (işi yazanın değil). Yöntem başına rol kapıları (karar turu K3) kuyruktan aşılırdı.
 *
 * KURAL: iş SAHİBİNİNDİR.
 *   • Sahibi SUNUCU damgalar (collections.SAHIP_SATIR_ALANI → `sahipUid`; lib/tenantErisim.kiraciDamgala). İstemcinin
 *     gönderdiği değer yok sayılır; güncellemeyle değişmez.
 *   • Yürütücü yalnız KENDİ işini sahiplenir — Yönetici dâhil (sunucu Yönetici'ye bütün kuyruğu listeler; istemci süzgeci
 *     olmasa açık, Yönetici oturumu üzerinden aynen sürerdi).
 *   • Damgasız (K10 öncesi) eski işi yalnız Yönetici oturumu çalıştırır; dokununca sunucu onu sahibi yapar.
 *   • Sahibi olmak yetmez: rolü yöntemin kapısından da geçmelidir (sunucunun okuduğu AYNI tablo — lib/mikroEvrakKapilari).
 *
 * TEK KAYNAK (İ4): istemci yürütücüsü (`services/syncRetryService`), kuyruk kartı (`components/MikroKuyrukKarti`) ve sunucu
 * bekçisi (`server/opsWatchdog` — `retry_queue`) «bu oturum bu işi gönderir mi» sorusunu AYNI işlevden (`isiGonderebilir`)
 * sorar. «Yönetici muaf» kuralı da burada yeniden yazılmaz: `tenantErisim.sahipSuzgecindenMuaf`.
 *
 * GEÇİŞ ARTIKLARI (K10-11):
 *   G1 — yayından ÖNCE ekilmiş sahip alanı. Eski sunucu istemcinin gönderdiği `sahipUid` değerini olduğu gibi bırakıyordu;
 *        yayından önce yazılmış böyle bir iş, yayından sonra o kullanıcının «kendi işi» sayılır ve onun oturumunda çalışırdı.
 *        Kural: Yönetici dışındaki oturum, belge kimliği KENDİ sonekini (`…_<uid>` — `isKimligi`) taşımayan işi kendi işi
 *        SAYMAZ. K10 öncesi kimlik biçimi sonek taşımaz. (Yöneticide kural aranmaz: damgasız eski işi zaten çalıştırır,
 *        dokunduğu damgasız iş de soneksiz kimlikle onun olur.) Kalan risk: alan adını VE kimlik biçimini yayından önce bilen
 *        (yayınlanmamış kodu okumuş) bir iç kullanıcı; kapatmanın yolu kuyruğun sunucuya taşınmasıdır (ayrı iş).
 *        Bedeli: yayından sonra AÇIK kalan eski sekmenin (eski paket) kuyruğa koyduğu iş soneksizdir — o sekme kapanırsa işi
 *        sahibinin yeni oturumu almaz; bekçi 24 saatte uyarır, Yönetici kapatır.
 *   G2 — kimlik kapma. Kimlik istemci seçimli kaldı: bir iç rol başkasının `…_<uid>` kimliğini ÖNCEDEN açabilir. Belge
 *        saldırganın sahipliğinde doğar (sunucu damgası); kurbanın oturumu onu ÇALIŞTIRMAZ (süzgeç kimliğe değil SAHİBE
 *        bakar), saldırganın oturumu da çalıştırmaz (kimlik onun sonekini taşımıyor — G1). Kurbanın o işi kuyruğa giremez
 *        (sunucu 403 — Yönetici dâhil: tam değiştirme başkasının damgalı kaydına reddedilir, `tenantErisim.baskasininSahipKaydiMi`;
 *        yoksa Yönetici'nin gövdesi saldırganın sahipliğinde kalır, ona okunurdu): yetki yükseltme değil, tek işlik yeniden
 *        deneme kaybı. Kimliğe rastgele ek KONMAZ: aynı varlığın
 *        yeniden kuyruğa girişi aynı belgeyi yenilemeli (rastgele kimlik aynı evrakı Mikro'ya iki kez gönderirdi).
 */
import { sahipSuzgecindenMuaf } from './tenantErisim';
import { evrakKapisindanGecer } from './mikroEvrakKapilari';
import { isAllowed, type AppRole } from './rbac';

export const KUYRUK_KOLEKSIYONU = 'syncJobs';

/** Yürütücünün kimliği. Çağrılarda ZORUNLU parametredir: isteğe bağlı olsaydı unutulan çağrı yeri sahiplik süzgecini sessizce atlardı. */
export type YurutucuKimligi = { uid: string | null | undefined; rol: AppRole | null | undefined };

/**
 * Kuralların okuduğu iş alanları (istemcide `SyncJob`, bekçide ham belge gövdesi). `id` BELGE kimliğidir — gövdedeki `id`
 * alanı DEĞİL: gövdeyi işin sahibi yazar; başka bir işin kimliğini taşıyan gövde, Yönetici oturumunun yazımını o işe
 * yönlendirirdi (K10-7).
 */
export interface KuyrukIsi {
  id: string;
  type?: unknown;
  payload?: unknown;
  sahipUid?: unknown;
  createdAt?: unknown;
}

/** İşin damgalı sahibi; damgasız (K10 öncesi) ya da bozuk damgalı işte null. */
export function isSahibi(job: Pick<KuyrukIsi, 'sahipUid'>): string | null {
  return typeof job.sahipUid === 'string' && job.sahipUid !== '' ? job.sahipUid : null;
}

/**
 * Kuyruğa yazılan işin BELGE kimliği: çağıranın verdiği taban (`mikro_<yöntem>_<varlık>`) + kullanıcı. Kullanıcı kimliğin
 * parçası olmasaydı ikinci kullanıcının aynı varlık için işi ilkiyle çakışır, sunucu yazmayı reddeder (başkasının kaydı — 403)
 * ve yeniden deneme SESSİZCE, kalıcı olarak kaybolurdu (`success` kaydı hiç silinmez — K10-1).
 */
export const isKimligi = (taban: string, uid: string): string => `${taban}_${uid}`;

/** Belge kimliği bu kullanıcının sonekini taşıyor mu (`isKimligi` biçimi)? */
export const kimlikSahibiniTasir = (id: string, uid: string): boolean => uid !== '' && id.endsWith(`_${uid}`);

/**
 * Bu oturum kuyruğu YÜRÜTEBİLİR mi: kimliği bilinen ve `syncJobs`'u okuyup yazabilen rol. Dış rolde, rolü olmayan hesapta ve
 * kimliksiz çağrıda `false` — yürütücü, kart ve zamanlayıcı o durumda `GET /api/db/syncJobs` isteğini HİÇ atmaz (İ3: eskiden
 * her 90 saniyede 403 alınıp yutuluyordu).
 */
export function kuyrukYurutebilir(k: YurutucuKimligi): boolean {
  const rol = k.rol ?? null;
  return !!k.uid && isAllowed(rol, KUYRUK_KOLEKSIYONU, 'read') && isAllowed(rol, KUYRUK_KOLEKSIYONU, 'write');
}

/**
 * Bu iş bu OTURUMUN mu?
 *   • damgasız eski iş → yalnız Yönetici;
 *   • başkasının işi → HAYIR, Yönetici dâhil;
 *   • kendi işi → Yönetici'de evet; diğer rollerde yalnız belge kimliği kendi sonekini taşıyorsa (G1).
 */
export function isBuOturumun(job: Pick<KuyrukIsi, 'id' | 'sahipUid'>, k: YurutucuKimligi): boolean {
  if (!k.uid) return false;
  const muaf = sahipSuzgecindenMuaf(k.rol);
  const sahip = isSahibi(job);
  if (sahip === null) return muaf;
  if (sahip !== k.uid) return false;
  return muaf || kimlikSahibiniTasir(job.id, k.uid);
}

/**
 * Mikro işinin yöntemi (kuyruk gövdesi `{ method, payload, meta }`). Okunamıyorsa '' — tabloda olmayan yöntemdir: kapı onu
 * sunucudaki gibi «iç personel» sayar (iç rol gönderir, işleyici 400 döner, deneme yanar ve iş beş denemede ölür; dış rol
 * hiç göndermez). Yani bozuk gövdeli iş kuyrukta takılı KALMAZ.
 */
export function isYontemi(job: Pick<KuyrukIsi, 'payload'>): string {
  const govde = job.payload;
  const yontem = govde !== null && typeof govde === 'object' ? (govde as { method?: unknown }).method : undefined;
  return typeof yontem === 'string' ? yontem : '';
}

/** ROL bu işi gönderebilir mi: Mikro işinde yöntemin rol kapısı (`evrak/kaydet` ile AYNI işlev); Mikro dışı işte kapı yok. */
export function rolGonderebilir(job: Pick<KuyrukIsi, 'type' | 'payload'>, rol: AppRole | null | undefined): boolean {
  return job.type !== 'mikro' || evrakKapisindanGecer(rol, isYontemi(job));
}

/**
 * Bu oturum bu işi SAHİPLENİP gönderir mi — yürütücünün süzgeci. Kart («Şimdi Dene» kaç iş gönderir) ve bekçi (sahibi bu işi
 * gönderebilir mi — sahibinin kimliği ve BUGÜNKÜ rolüyle sorulur) aynı işlevden sayar; üç yer ayrışamaz.
 */
export function isiGonderebilir(job: KuyrukIsi, k: YurutucuKimligi): boolean {
  return kuyrukYurutebilir(k) && isBuOturumun(job, k) && rolGonderebilir(job, k.rol);
}

/** Bekçinin `retry_queue` eşiğiyle AYNI süre (opsWatchdog: 24 saatten eski bekleyen iş = kuyruk tıkalı). */
export const TAKILI_IS_ESIGI_MS = 24 * 60 * 60 * 1000;

/**
 * İş «takılı» mı: oluşturulalı eşikten fazla olmuş, ya da yaşı OKUNAMIYOR. `createdAt` istemci yazımıdır: sayı değilse ya da
 * saat farkıyla açıklanamayacak kadar ileride ise yaş bilinmiyordur — öyle iş «taze» sayılmaz (yoksa ileri tarihli bir iş
 * sonsuza dek kapatılamazdı).
 */
export function isTakili(job: Pick<KuyrukIsi, 'createdAt'>, simdi: number): boolean {
  const t = job.createdAt;
  return typeof t !== 'number' || !Number.isFinite(t) || Math.abs(simdi - t) > TAKILI_IS_ESIGI_MS;
}

/**
 * Bu oturum kuyrukta iş KAPATABİLİR mi: kuyruğu yürütebilen VE sahip süzgecinden muaf rol (Yönetici). Sunucu başkasının
 * işine yazımı yalnız ona açar; diğer rollerde kapatma çağrısı sunucuya HİÇ gitmez (İ3).
 */
export function kuyruktaKapatabilir(k: YurutucuKimligi): boolean {
  return kuyrukYurutebilir(k) && sahipSuzgecindenMuaf(k.rol);
}

/**
 * YÖNETİCİ ÇIKIŞI (K10-8): bu oturum bu işi KAPATABİLİR mi — çalıştırmadan ölü işaretler, Mikro'ya hiçbir şey gitmez.
 * Yalnız Yönetici (`kuyruktaKapatabilir`), yalnız KENDİ oturumunun gönderemeyeceği (başkasının işi ya da kimliği sahibini
 * taşımayan iş) ve takılı iş. Sahibi gönder(e)meyen iş başka türlü sonsuza dek bekler: sahibi ayrıldıysa / oturum açmıyorsa
 * ya da rolü yöntemin kapısından geçmiyorsa onu çalıştıracak oturum yoktur, bekçi kalıcı kırmızı kalırdı.
 * İKİ ÇIKIŞ, iki sınıf: damgasız eski işi Yönetici DEVRALIR (kendi gönderir — `isBuOturumun`; sunucu onu sahibi yapar);
 * damgalı işi KAPATIR. Damgalı işte devralma YOK: Yönetici başkasının işini KENDİ kimliğiyle göndermez — açığın kendisi buydu.
 */
export function kapatilabilir(job: KuyrukIsi, k: YurutucuKimligi, simdi: number): boolean {
  return kuyruktaKapatabilir(k) && !isiGonderebilir(job, k) && isTakili(job, simdi);
}

/**
 * Kuyruk kartının bekleyen iş dökümü — BU oturumun gözünden. İlk üç sayı ayrıktır ve toplamları bekleyen iş sayısıdır;
 * dördüncüsü (kapatılabilir) son ikisinin alt kümesidir.
 */
export interface KuyrukOzeti {
  /** «Şimdi Dene» ile bu oturumun göndereceği iş (kendi işi; Yönetici'de damgasız eski iş de). */
  gonderilebilir: number;
  /** Bu oturumun işi ama rolü yöntemin kapısından geçmiyor — rol düzelmeden hiçbir oturum gönderemez. */
  rolYetmiyor: number;
  /** Başka kullanıcının işi (sunucu yalnız Yönetici'ye listeler) ya da kimliği sahibini taşımayan iş (G1). */
  baskasinin: number;
  /** Yönetici'nin «Takılanları Kapat» ile kapatabileceği iş (yukarıdaki son iki sınıfın takılı olanları). */
  kapatilabilir: number;
}

export function kuyrukOzeti(bekleyen: readonly KuyrukIsi[], k: YurutucuKimligi, simdi: number): KuyrukOzeti {
  const ozet: KuyrukOzeti = { gonderilebilir: 0, rolYetmiyor: 0, baskasinin: 0, kapatilabilir: 0 };
  for (const job of bekleyen) {
    if (isiGonderebilir(job, k)) ozet.gonderilebilir++;
    else if (isBuOturumun(job, k)) ozet.rolYetmiyor++;
    else ozet.baskasinin++;
    if (kapatilabilir(job, k, simdi)) ozet.kapatilabilir++;
  }
  return ozet;
}

/**
 * BEKÇİ (`retry_queue`): bekleyen işin sınıfı — sahibinin BUGÜNKÜ rolüyle (kaydı yoksa / rolü boşsa null).
 *   • 'sahipsiz'         — damgasız eski iş: yalnız Yönetici oturumu çalıştırır;
 *   • 'sahibiGonderemez' — sahibinin oturumu bu işi ALMAZ (rolü yöntemin kapısından geçmiyor, kuyruğu yürütemiyor ya da
 *                          kimlik onun sonekini taşımıyor): Yönetici kapatmadıkça sonsuza dek bekler;
 *   • 'sahibiGonderir'   — sahibi oturum açınca gönderilir.
 */
export type BekleyenIsSinifi = 'sahipsiz' | 'sahibiGonderemez' | 'sahibiGonderir';

export function bekleyenIsSinifi(job: KuyrukIsi, sahipRolu: AppRole | null | undefined): BekleyenIsSinifi {
  const sahip = isSahibi(job);
  if (sahip === null) return 'sahipsiz';
  return isiGonderebilir(job, { uid: sahip, rol: sahipRolu }) ? 'sahibiGonderir' : 'sahibiGonderemez';
}
