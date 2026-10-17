/**
 * kimlikYuzeyi.ts — TEK BOĞAZ: iç rolü OLMAYAN hesabın (rolsüz ya da dış rol) ulaşabildiği uçların İZİN LİSTESİ ve geçiş kararı.
 *
 * NEDEN VAR (2026-10-11 güvenlik taraması, şartname «dış rol kapanışı» D4′): `requireAuth` yalnız «belirteç geçerli» demekti.
 * Giriş ekranından hesap açan yabancı (rol alamaz) ve dış rol (B2B, Bayi) rol kapısı taşımayan 37 uca ulaşıyordu: stok koduyla
 * tedarikçi kimliği, yapay zekâ ajanları üzerinden herhangi bir carinin satış geçmişi, ücretli yapay zekâ kotası, makbuz
 * yükleme ucuyla disk doldurma, satın alma taslağı yazımı, LUCA ve Shopify uçları. Uçları tek tek kapılamak yeni eklenen her
 * ucun aynı açıkla doğması demekti; kapanış `requireAuth`'un içinde, zincirin BAŞINDA yapılır:
 *
 *   süper yönetici → geçer · rolü `STAFF_ROLES` üyesi → geçer · AKSİ HÂLDE yalnız aşağıdaki listedeki (yöntem, yol) geçer,
 *   kalanı `403 { error, code: 'ROL_YOK' | 'DIS_ROL' }`. Rol OKUNAMAZSA karar verilmez: çağıran 503 döner (ret değil).
 *
 * İç roller ve süper yönetici için hiçbir ucun davranışı DEĞİŞMEZ; kimliksiz geçen yol (herkese açık form yazımı) bu modüle hiç
 * gelmez. SAF: Express / veritabanı içe aktarılmaz — `server.ts` bağlar (`kimlikYuzeyindenGecer`), davranış burada testlidir
 * (kimlikYuzeyi.test.ts), gerçek zincir `src/server/kimlikYuzeyi.zincir.test.ts`'te.
 *
 * YOL KARŞILAŞTIRMASI — NORMALLEŞTİRME YOK, BİLEREK. Bu projede «istek şu rotaya mı gitti» sorusunu yol metnini Express gibi
 * yorumlayarak cevaplamak iki inceleme turunda da ayrıştı (istemciIp.ts başlığı: büyük harf, sondaki eğik çizgi, ters eğik
 * çizgi + '#', mutlak biçimli hedef). Orada tanınmayan yazım AÇIK kalıyordu; burada tersine çevrilmiştir: liste yalnız KURALLI
 * yazımı tanır (ham istek hedefinin '?' öncesi, karakteri karakterine), kurallı olmayan HER yazım izin listesi DIŞIDIR ve
 * reddedilir. Express büyük harfli / sonu eğik çizgili yazımı aynı işleyiciye götürse de rolsüz hesap o yazımla 403 alır —
 * istemci kurallı yazımı kullanır (dbClient, lib/mfa, lib/invite), meşru akış etkilenmez. Tersi mümkün değildir: metni listedeki
 * kurallı yola EŞİT olan istek Express'te de o yolun işleyicisine gider (kaçış, nokta parçası, çift eğik çizgi içeremez).
 */
import { EXTERNAL_ROLES, STAFF_ROLES } from './rbac';

/** İç rolü olmayan hesabın aldığı ret kodu: rolsüz (ya da rol alanı bilinmeyen değer) → `ROL_YOK`; B2B / Bayi → `DIS_ROL`. */
export type KimlikYuzeyiKodu = 'ROL_YOK' | 'DIS_ROL';

/** Listede yer alabilen yöntemler. `DELETE` YOK: rolsüz hesap hiçbir şey silemez (kendi `users` belgesini de). */
export type IzinliYontem = 'GET' | 'POST' | 'PUT' | 'PATCH';

export interface RolsuzIzinliYol {
  /** `X-Cetpa-Method` tünelinden SONRAKİ gerçek yöntem (Express'in rotayı seçtiği `req.method`), büyük harf. */
  yontemler: readonly IzinliYontem[];
  /** Kurallı yol. `:uid` parçası yalnız çağıranın KENDİ uid'iyle eşleşir (başkasının uid'i liste dışıdır). */
  yol: string;
  /** Bu uç rolsüz hesaba neden açık (oturum açılışı / iki adımlı doğrulama / davet). */
  neden: string;
}

/** Yoldaki «çağıranın kendi uid'i» yer tutucusu. */
export const KENDI_UID = ':uid';

/**
 * İZİN LİSTESİ — TEK SABİT. Buraya satır eklemek o ucu internetten hesap açan HERKESE açar: eklemeden önce ucun yalnız
 * çağıranın kendi kaydına dokunduğunu ve kiracıdan bağımsız kaynak (dış sistem anahtarı, disk, ücretli kota) kullanmadığını
 * doğrula. Liste değişince iki çit kırılır: kimlikYuzeyi.test.ts (listenin TAMAMI sabitlenmiştir) ve zincir testi.
 *
 * LİSTEDE OLMAYANLAR (bilerek): `/api/db/users/<uid>/increment` ve `/cas` (korunan alan kapılarının zayıf yolu),
 * `DELETE /api/db/users/<uid>`, başkasının `users` belgesi, `POST /api/db/users` (kimlik istemciden gelmez),
 * `POST /api/mfa/disable` (şartname saymıyor), `POST /api/stripe/create-checkout`, herkese açık form koleksiyonlarına
 * KİMLİKLİ yazım (kimliksiz yazım bu kapıya gelmez, değişmedi).
 */
export const ROLSUZ_IZINLI_YOLLAR: readonly RolsuzIzinliYol[] = Object.freeze(([
  { yontemler: ['GET', 'PUT', 'PATCH'], yol: `/api/db/users/${KENDI_UID}`, neden: 'oturum açılışı: kişinin kendi kullanıcı belgesi (rol / kiracı / durum alanları sunucuda ayrıca korunur)' },
  { yontemler: ['POST'], yol: '/api/db/session', neden: 'oturum çerezi kurma' },
  { yontemler: ['POST'], yol: '/api/db/session/logout', neden: 'çıkış (bugün çerezle çalışır, `requireAuth` taşımaz; taşırsa da açık kalsın)' },
  { yontemler: ['GET'], yol: '/api/mfa/status', neden: 'iki adımlı doğrulama durumu (girişte sorulur)' },
  { yontemler: ['POST'], yol: '/api/mfa/enroll/start', neden: 'iki adımlı doğrulama kaydı — 1. adım' },
  { yontemler: ['POST'], yol: '/api/mfa/enroll/verify', neden: 'iki adımlı doğrulama kaydı — 2. adım' },
  { yontemler: ['POST'], yol: '/api/mfa/verify', neden: 'girişte iki adımlı doğrulama kodu' },
  { yontemler: ['POST'], yol: '/api/invites/redeem', neden: 'davet kabulü: rolü VEREN uç (kod + e-posta eşleşmesi işleyicide)' },
  { yontemler: ['GET'], yol: '/api/superadmin/me', neden: 'açılışta sorulur; yalnız çağıranın kendi süper yönetici durumunu söyler' },
] satisfies RolsuzIzinliYol[]).map(izin => Object.freeze({ ...izin, yontemler: Object.freeze([...izin.yontemler]) })));

/**
 * Yola gömülebilen uid: yalnız kaçış GEREKTİRMEYEN karakterler. Firebase'in verdiği kimlikler bu kümededir. Başka karakter
 * taşıyan uid için «kendi belgesi» satırı eşleşmez (kapalı başarısızlık): öyle bir uid yolda yüzde kaçışıyla taşınırdı ve ham
 * metin karşılaştırması onu zaten tanımazdı.
 */
const GUVENLI_UID = /^[A-Za-z0-9_-]{1,128}$/;

/** Ham istek hedefinin (`req.originalUrl`) sorgudan ÖNCEKİ kısmı — kod çözme, küçültme, eğik çizgi temizliği YOK. */
export function istekYolu(hedef: unknown): string {
  if (typeof hedef !== 'string') return '';
  const soru = hedef.indexOf('?');
  return soru === -1 ? hedef : hedef.slice(0, soru);
}

/**
 * (yöntem, yol) iç rolü olmayan hesaba açık mı? `yol` sorgusuz ham yoldur (`istekYolu`). Karşılaştırma karakteri karakterine:
 * büyük / küçük harf farkı, sondaki eğik çizgi, yüzde kaçışı, çift eğik çizgi, nokta parçası → `false`.
 */
export function rolsuzIzinliMi(yontem: string, yol: string, uid: string): boolean {
  if (typeof yontem !== 'string' || typeof yol !== 'string' || typeof uid !== 'string') return false;
  for (const izin of ROLSUZ_IZINLI_YOLLAR) {
    if (!izin.yontemler.some(y => y === yontem)) continue;
    if (!izin.yol.includes(KENDI_UID)) {
      if (yol === izin.yol) return true;
      continue;
    }
    if (!GUVENLI_UID.test(uid)) continue;
    // `split` / `join`: `replace`'in `$` kalıpları uid'de yorumlanmasın (küme bugün `$` içermiyor; küme genişlerse de güvenli).
    if (yol === izin.yol.split(KENDI_UID).join(uid)) return true;
  }
  return false;
}

/** Rol alanının DEĞERİ iç rol mü? Veritabanından gelen ham değer (sayı, uydurma dizge, null) verilebilir. */
export function icRolMu(rol: unknown): boolean {
  return typeof rol === 'string' && (STAFF_ROLES as readonly string[]).includes(rol);
}

/** Rol alanının DEĞERİ dış rol mü (B2B / Bayi)? */
export function disRolMu(rol: unknown): boolean {
  return typeof rol === 'string' && (EXTERNAL_ROLES as readonly string[]).includes(rol);
}

export interface KimlikYuzeyiGirdisi {
  /** `isSuperAdmin(req)` — doğrulanmış e-postası süper yönetici listesinde. */
  superAdmin: boolean;
  /** `users/<uid>.role` — BAŞARIYLA okunmuş ham değer (yoksa null). Okunamadıysa bu işlev ÇAĞRILMAZ (çağıran 503 döner). */
  rol: unknown;
  /** `req.method` — yöntem tünelinden sonraki gerçek yöntem. */
  yontem: string;
  /** `req.originalUrl` — ham istek hedefi. */
  hedef: unknown;
  uid: string;
}

export type KimlikYuzeyiKarari =
  | { gecer: true; neden: 'super-yonetici' | 'ic-rol' | 'izin-listesi' }
  | { gecer: false; kod: KimlikYuzeyiKodu };

/** TEK BOĞAZ kararı. Sıra sözleşmedir: süper yönetici → iç rol → izin listesi → ret. */
export function kimlikYuzeyiKarari(g: KimlikYuzeyiGirdisi): KimlikYuzeyiKarari {
  if (g.superAdmin === true) return { gecer: true, neden: 'super-yonetici' };
  if (icRolMu(g.rol)) return { gecer: true, neden: 'ic-rol' };
  if (rolsuzIzinliMi(g.yontem, istekYolu(g.hedef), g.uid)) return { gecer: true, neden: 'izin-listesi' };
  return { gecer: false, kod: disRolMu(g.rol) ? 'DIS_ROL' : 'ROL_YOK' };
}

/**
 * 403 gövdeleri. `code` reddin NEDENİNİ ayırır (günlük, teşhis, sınamalar). İstemci bugün `code`'u OKUMAZ (ölçüldü 2026-10-11:
 * `src/` içinde okuyan yok): dış rol sayfasını ve «rol atanmamış» ekranını kendi `users` belgesindeki role göre çizer
 * (App.tsx `disRol`, `roleMissing`) — o belge izin listesinde olduğu için bu ret gövdesine hiç gerek kalmadan okunur.
 */
export const KIMLIK_YUZEYI_RETLERI: Readonly<Record<KimlikYuzeyiKodu, { error: string; code: KimlikYuzeyiKodu }>> = Object.freeze({
  ROL_YOK: { error: 'Hesabınıza henüz rol atanmamış. Yöneticinizden davet isteyin.', code: 'ROL_YOK' },
  DIS_ROL: { error: 'Bu hesap bayi hesabıdır. ERP ekranı bayi hesaplarına kapalıdır.', code: 'DIS_ROL' },
});

/** 503 gövdesi — rol OKUNAMADI (veritabanı hatası). Ret DEĞİL: istemci yeniden dener; iç rol de aynı yanıtı alır. */
export const ROL_OKUNAMADI_YANITI: Readonly<{ error: string; code: 'ROL_OKUNAMADI' }> = Object.freeze({
  error: 'Yetki bilgisi şu anda okunamıyor. Lütfen biraz sonra yeniden deneyin.',
  code: 'ROL_OKUNAMADI',
});
