/**
 * istemciIp.ts — hız sınırı ANAHTARI: istemci IP'si (kapı numarası ayıklanmış) ve DOĞRULANMIŞ kullanıcı kimliği.
 *
 * NEDEN (2026-10-08 canlı ölçümü): hız sınırı kovası IP başına değil TCP BAĞLANTISI başına sayıyordu — üç ayrı bağlantıda
 * `ratelimit-remaining` üçü de 299, tek bağlantıda 299 → 298. IIS / ARR `X-Forwarded-For`'a istemciyi 'IP:kapı' diye yazar;
 * `trust proxy` 1 iken `req.ip` o dizgedir ve express-rate-limit'in `ipKeyGenerator`'ı IPv4:kapı dizgesini AYNEN döndürür
 * (yalnız IPv6'yı tanır). Her yeni bağlantı = yeni kapı = taze kova: bağlantıyı yenileyen istemci hiçbir sınıra takılmıyordu.
 * İkinci arıza: anahtar `req.uid` varsa kullanıcı başına olacaktı, ama `req.uid`'yi yalnız `requireAuth` yazar ve
 * sınırlayıcıların çoğu ondan ÖNCE çalışır — o dal yalnız rota-içi birkaç Mikro ucunda canlıydı. Kapı ayıklanınca aynı
 * ofisin (tek dış IP) bütün personeli TEK kovaya düşerdi; bu yüzden kimlik anahtar üretilirken yerelde doğrulanır.
 *
 * İKİ ANAHTAR (tasarım kapısı 2026-10-08 — hesap açmak serbest olduğu için "doğrulanmış uid" ucuz üretilir):
 *  • `ipSinirAnahtari`        — ASLA kullanıcıya yükselmez. Kimliksiz yüzeyi koruyan sınırlayıcılar (herkese açık form, sipariş
 *                               takibi, sayaç, davet, webhook) bunu kullanır; yoksa her yeni hesap taze kova olurdu.
 *  • `kullaniciSinirAnahtari` — doğrulanmış kullanıcı → 'u:<uid>', değilse IP. Personelin olağan trafiği (/api, /api/db,
 *                               Mikro, ödeme) bunu kullanır ki aynı ofisteki kullanıcılar birbirini kilitlemesin.
 *
 * SAF: Express / Firebase içe aktarılmaz; doğrulayıcılar ENJEKTE edilir (server.ts bağlar). HİÇBİR işlev fırlatmaz:
 * express-rate-limit anahtar üreticinin hatasını yutmaz, isteği 500'e düşürür ve HİÇ saymaz (ölçüldü).
 */
import { createHash } from 'node:crypto';
import { isIP, isIPv4, isIPv6 } from 'node:net';
import { ipKeyGenerator } from 'express-rate-limit';

// ── İstemci IP'si ────────────────────────────────────────────────────────────────────────────────────

export type IpCozumu =
  | { tur: 'ip'; ip: string }
  /** Vekilin yazdığı değer IP'ye çözülemedi — değere ÖZGÜ kovaya gider (ortak kovaya düşürülmez). */
  | { tur: 'ham'; ham: string }
  /** Hiç değer yok (soket kapanmış). */
  | { tur: 'yok' };

const V4_KAPI = /^(\d{1,3}(?:\.\d{1,3}){3}):\d{1,5}$/;
const V6_KOSELI = /^\[([^\]]+)\](?::\d{1,5})?$/;
const SON_KAPI = /^(.+):\d{1,5}$/;

/**
 * Vekilin yazdığı istemci adresinden kapı numarasını ayıklar: 'a.b.c.d:kapı' → 'a.b.c.d'; '[v6]:kapı' / '[v6]' → 'v6';
 * köşeli parantezsiz 'v6:kapı' ve '::ffff:a.b.c.d:kapı' → son ':kapı' atılınca geçerli IPv6 kalıyorsa o; kapısız v4 / v6 aynen.
 *
 * BİLİNEN SINIRLAR — IPv6 (bugün erişilemez: app.cetpa.com.tr'nin AAAA kaydı YOK, Node yalnız IPv4 dinliyor; 2026-10-08 ölçümü).
 * AAAA kaydı ya da IIS'e IPv6 bağlaması eklenmeden ÖNCE ARR'nin IPv6 istemci için ne yazdığı ölçülmeli:
 *  • Köşeli parantezsiz 'v6:kapı' biçiminde kapı 4 haneye kadarsa dizge KENDİSİ geçerli bir IPv6 adresi olabilir (kapı son hane
 *    sayılır). '::' ilk dört hanenin içindeyse /56 öneki KAYAR (ör. '2a02:ff0::1234:5678:9abc:def0:8080' → 2a02:ff0:0:1200::/56):
 *    aynı adres kapı hane sayısına göre iki kovaya düşer. Metinden çözülemez; düzeltmeden önce de böyleydi. ARR köşeli yazıyorsa
 *    `SON_KAPI` dalı kaldırılıp o biçim 'ham' sayılmalı.
 *  • Son 32 biti NOKTALI yazılmış IPv6 (ör. ISATAP '…:0:5efe:85.105.1.2'): kitaplığın `ipKeyGenerator`'ı onu IPv4 kovasına
 *    indirger (yalnız '::ffff:' eşlemli adresi değil, noktalı sonu olan HER adresi) — /56 toplaması aşılır ve başka bir IPv4'ün
 *    kovası tüketilebilir. ARR noktalı yazıyorsa IPv4'e indirgeme yalnız ::ffff:0:0/96 için bırakılmalı.
 */
export function istemciIpCoz(ham: unknown): IpCozumu {
  if (typeof ham !== 'string') return { tur: 'yok' };
  const s = ham.trim();
  if (s === '') return { tur: 'yok' };
  if (isIP(s) !== 0) return { tur: 'ip', ip: s };
  const v4 = V4_KAPI.exec(s);
  if (v4 && isIPv4(v4[1])) return { tur: 'ip', ip: v4[1] };
  const koseli = V6_KOSELI.exec(s);
  if (koseli && isIPv6(koseli[1])) return { tur: 'ip', ip: koseli[1] };
  const kapili = SON_KAPI.exec(s);
  if (kapili && isIPv6(kapili[1])) return { tur: 'ip', ip: kapili[1] };
  return { tur: 'ham', ham: s };
}

/** `req.ip`'nin kapısı ayıklanmış hâli; IP'ye çözülemiyorsa null (çağıran değeri olduğu gibi bırakır). */
export function temizIstemciIp(ham: unknown): string | null {
  const c = istemciIpCoz(ham);
  return c.tur === 'ip' ? c.ip : null;
}

/** Günlüğe süreç başına bir kez: çözülemeyen adres görüldü (değerin KENDİSİ yazılmaz — IP kişisel veridir). */
let hamUyarildi = false;
const hamUyar = (uzunluk: number): void => {
  if (hamUyarildi) return;
  hamUyarildi = true;
  console.warn(`[hız sınırı] istemci adresi IP'ye çözülemedi (uzunluk ${uzunluk}) — vekilin yazdığı biçim değişmiş olabilir; anahtar değerin özetinden üretiliyor.`);
};

/**
 * Ham adresten kova anahtarı. IPv4 → adresin kendisi; IPv6 → /56 ağ öneki (kitaplığın `ipKeyGenerator`'ı — tek abonenin
 * elindeki adres bolluğuyla sınırı aşması engellenir); v4-eşlemli IPv6 → IPv4. Çözülemeyen değer → 'ham:<özet>': değere ÖZGÜ
 * kova (herkesi tek kovaya düşürmek bütün trafiği birlikte kilitlerdi) ve SABİT boyda (değerin kendisi anahtar olsaydı başlık
 * boyunda — KB'larca — bellek tutardı). Sağdaki girdiyi vekil yazdığı için istemci bu dalı seçemez.
 */
export function ipAnahtari(ham: unknown): string {
  const c = istemciIpCoz(ham);
  try {
    if (c.tur === 'ip') return `ip:${ipKeyGenerator(c.ip)}`;
  } catch { /* kitaplık adresi işleyemedi — aşağıdaki özet dalına düş */ }
  if (c.tur === 'yok') return 'ham:yok';
  const deger = c.tur === 'ham' ? c.ham : c.ip;
  hamUyar(deger.length);
  return `ham:${createHash('sha256').update(deger).digest('hex').slice(0, 16)}`;
}

// ── Sınır kimliği: kullanıcı başına kova ───────────────────────────────────────────────────────────

/** Anahtar üretirken okunan istek yüzeyi (Express `Request`'in alt kümesi — saf kalsın diye yapısal). */
export interface SinirIstegi {
  ip?: string;
  /** `requireAuth` yazdıysa (sınırlayıcı kimlik kapısından SONRA çalışıyorsa) doğrudan kullanılır. */
  uid?: string;
  method?: string;
  originalUrl?: string;
  /** Express'in ayrıştırdığı sorgu (`req.query`) — yalnız akış ucunda okunur (`akisSorguBelirteci`). */
  query?: unknown;
  headers: { authorization?: string | string[]; cookie?: string | string[] };
}
export interface SinirBagimliliklari {
  /** Firebase ID belirtecini YEREL doğrular; geçerliyse uid. Geçersizse null döner ya da fırlatır (ikisi de "kimlik yok"). */
  belirtecDogrula: (belirtec: string) => Promise<string | null>;
  /** Çerez başlığındaki imzalı oturum çerezinden uid; yoksa / geçersizse null. Fırlatabilir ("kimlik yok" sayılır). */
  cerezdenUid: (cerezBasligi: string) => string | null;
  /** Belirteç doğrulamasına tanınan en uzun süre (ms); varsayılan `DOGRULAMA_ZAMAN_ASIMI_MS`. */
  zamanAsimiMs?: number;
}

/**
 * `Authorization` başlığından belirteç — `requireAuth` ile AYNI ayıklama (o da bunu çağırır). Ayrışsalardı sınırlayıcının
 * tanımadığı ama kimlik kapısının kabul ettiği bir yazım (ör. 'Bearer' öneksiz belirteç) kimlikli kullanıcıya IP kovasını da
 * açar, tavan ikiye katlanırdı.
 */
export function yetkiBelirteci(baslik: unknown): string {
  return typeof baslik === 'string' ? baslik.replace(/^Bearer\s+/, '') : '';
}

/**
 * AKIŞ UCU (`GET /api/db/stream`) — çerezle ve `?token=` sorgusuyla kimlik doğrulanan TEK uç. Başka uçlarda çerez kovayı
 * YÖNLENDİRMEZ: çerez orada kimlik sayılmaz, 401 alan istek bile sahibinin kovasını tüketirdi (aynı alan adındaki başka bir
 * sitedeki betik, oturumu açık kullanıcıyı böyle kilitleyebilirdi).
 *
 * İstek akış ucuna mı gitti? Bunu YOL KARŞILAŞTIRMASIYLA değil, rotanın KENDİ zincirine konan işaretle biliriz:
 * `app.get('/api/db/stream', akisIstegiIsaretle, dbLimiter, …)`. Yol karşılaştırması Express yönlendirmesini taklit etmek
 * zorundaydı ve iki inceleme turunda da ayrıştı (HEAD, büyük harf, sondaki eğik çizgi; sonra ters eğik çizgi + '#', mutlak
 * biçimli hedef — hepsi akış işleyicisine gidiyor ama tanınmıyor, kullanıcı o yazımla IP kovasına kaçıp tavanı ikiye katlıyordu).
 * İşaret, eşleşmeyi Express'in yaptığı yerde yapar: işleyiciye giden HER yazım işaretlidir, gitmeyen hiçbiri değildir.
 * ŞART: işaret, kullanıcı anahtarlı sınırlayıcıdan ÖNCE konur (kimlik istek başına bir kez çözülür) — çit: hizSiniri.degismez.test.ts.
 */
const akisIstekleri = new WeakSet<object>();
export function akisIstegiIsaretle<Q extends object>(req: Q, _res: unknown, next: (hata?: unknown) => void): void {
  akisIstekleri.add(req);
  next();
}
/**
 * Akış ucunun geriye uyum kimliği: çerez yoksa `?token=`. İşleyici (server.ts) ile sınırlayıcı belirteci BU işlevden okur —
 * `requireAuth` ↔ `yetkiBelirteci` ile aynı gerekçe: iki ayrı ayıklayıcı ayrışırsa (tekrarlı anahtar, parça sonrası sorgu, anahtar
 * sayısı sınırı) işleyicinin 401 verdiği istek belirteç sahibinin kovasında sayılır ya da tersi.
 */
export function akisSorguBelirteci(sorgu: unknown): string {
  const t = sorgu !== null && typeof sorgu === 'object' ? (sorgu as { token?: unknown }).token : undefined;
  return String(t || '');
}
/** JWT biçimi (üç base64url parça) — biçimsiz dizge doğrulayıcıya hiç gitmez. Dışa açık: mağaza paneli belirteci
 *  (`mp1-<yük>.<imza>`, İKİ parça) bu desene UYMAZ ve hiçbir sınırlayıcıda Firebase doğrulayıcısına gitmez (çit, dilim 2a). */
export const JWT_BICIMI = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
/** Firebase ID belirteci 1–2 KB'tır; dev başlıkla doğrulama maliyeti ödetilmesin (Node başlık sınırı 16 KB). */
const BELIRTEC_EN_UZUN = 8192;
/**
 * Doğrulama sıcak sertifika önbelleğiyle ~0,05 ms sürer; süreç açılışında / önbellek süresi dolunca ilk çağrı Google'dan
 * sertifika çeker ve kitaplıkta zaman aşımı yoktur (ölçüldü). Sınırlayıcı o çağrıyı BEKLEMEZ: süre dolarsa istek IP kovasına
 * düşer (kimlik kapısı kendi doğrulamasını ayrıca yapar).
 */
export const DOGRULAMA_ZAMAN_ASIMI_MS = 1000;

const tekMetin = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const gecerliUid = (v: unknown): string | null => (typeof v === 'string' && v !== '' && v.length <= 128 ? v : null);
/**
 * İsteğin yolu — sorgu ('?') ve parça ('#') atılır: Express yönlendirirken ikisini de yok sayar (ölçüldü: '/api/hit#x' sayaç
 * işleyicisine gider). Yalnız `apiSinirindanMuaf` kullanır; orada ayrışma ZARARSIZ yöndedir (tanınmayan yazım muaf sayılmaz,
 * genel kovada da sayılır).
 */
const yol = (url: unknown): string => (typeof url === 'string' ? url.split(/[?#]/)[0] : '');

function sureyleYaris(is: Promise<string | null>, ms: number): Promise<string | null> {
  return new Promise<string | null>(coz => {
    const t = setTimeout(() => coz(null), ms);
    // Zamanlayıcı süreci ayakta tutmasın (test / kapanış).
    if (typeof t === 'object' && t !== null && 'unref' in t) (t as { unref: () => void }).unref();
    is.then(v => { clearTimeout(t); coz(v); }, () => { clearTimeout(t); coz(null); });
  });
}

async function kimlikCoz(req: SinirIstegi, dep: SinirBagimliliklari): Promise<string | null> {
  let belirtec = yetkiBelirteci(tekMetin(req.headers.authorization));
  // Akış ucu: işleyicinin okuduğu kimliklerin AYNISI, aynı sırayla — çerez, çerez geçersizse `?token=`. İşleyici o uçta
  // Authorization başlığını HİÇ okumaz; sınırlayıcı da okumaz (okusaydı 401 alan istek başlıktaki belirtecin sahibinin kovasında sayılırdı).
  if (akisIstekleri.has(req)) {
    const cerez = tekMetin(req.headers.cookie);
    if (cerez) {
      try { const u = gecerliUid(dep.cerezdenUid(cerez)); if (u) return u; } catch { /* bozuk çerez = kimlik yok */ }
    }
    belirtec = akisSorguBelirteci(req.query);
  }
  if (belirtec === '' || belirtec.length > BELIRTEC_EN_UZUN || !JWT_BICIMI.test(belirtec)) return null;
  // Doğrulayıcı söz zincirinin İÇİNDE çağrılır: eşzamanlı fırlatması da (Firebase Admin başlatılamamışsa `getAuth()` öyle yapar)
  // söz reddine döner ve `sureyleYaris` onu "kimlik yok" sayar.
  const dogrulama = Promise.resolve().then(() => dep.belirtecDogrula(belirtec));
  return gecerliUid(await sureyleYaris(dogrulama, dep.zamanAsimiMs ?? DOGRULAMA_ZAMAN_ASIMI_MS));
}

const kimlikOnbellegi = new WeakMap<object, Promise<string | null>>();

/**
 * İsteğin DOĞRULANMIŞ kullanıcı kimliği (yoksa null) — yalnız hız sınırı anahtarı / tavanı için; kimlik kapısının yerini TUTMAZ
 * (`req.uid`'yi yalnız `requireAuth` yazar). İstek başına BİR KEZ hesaplanır: SÖZ saklanır ki aynı isteğe uygulanan ikinci
 * sınırlayıcı belirteci yeniden doğrulamasın. Hiçbir durumda reddetmez: doğrulanamayan her şey "kimlik yok"tur. Doğrulanmamış /
 * sahte belirteç ASLA kimlik olmaz — olsaydı saldırgan her istekte yeni bir sahte belirteçle taze kova alırdı.
 */
export function sinirKimligi(req: SinirIstegi, dep: SinirBagimliliklari): Promise<string | null> {
  const hazir = gecerliUid(req.uid);
  if (hazir) return Promise.resolve(hazir);
  let s = kimlikOnbellegi.get(req);
  if (!s) {
    s = kimlikCoz(req, dep).catch(() => null);
    kimlikOnbellegi.set(req, s);
  }
  return s;
}

/**
 * Yalnız IP'den kova anahtarı — kimliksiz yüzeyi koruyan sınırlayıcılar için (kullanıcıya ASLA yükselmez).
 * Parametre adı bilerek `istek`: kitaplık anahtar üreticinin KAYNAK METNİNDE 'req.ip' arar ve `ipKeyGenerator` görmezse
 * ERR_ERL_KEY_GEN_IPV6 basar — bu işlev doğrudan `keyGenerator` verildiğinde yanlış alarm üretirdi (IPv6 /56 toplaması
 * `ipAnahtari` içinde zaten yapılıyor).
 */
export function ipSinirAnahtari(istek: SinirIstegi): string {
  try { return ipAnahtari(istek.ip); } catch { return 'ham:yok'; }
}

/** Doğrulanmış kullanıcı → 'u:<uid>'; değilse istemci IP'si (`ipSinirAnahtari`). */
export async function kullaniciSinirAnahtari(req: SinirIstegi, dep: SinirBagimliliklari): Promise<string> {
  let uid: string | null = null;
  try { uid = await sinirKimligi(req, dep); } catch { uid = null; }
  return uid ? `u:${uid}` : ipSinirAnahtari(req);
}

// ── Tavan ve muafiyet politikası ────────────────────────────────────────────────────────────────────

/**
 * Kovaya göre tavan: doğrulanmış kullanıcı kovası `kimlikli`, IP kovası `kimliksiz`. NEDEN iki tavan: düzeltmeden önce fiilî kova
 * bağlantı başınaydı; kullanıcı başına kovada bir kullanıcının BÜTÜN cihazları ve sekmeleri tek kovayı paylaşır. Kimlikli tavan
 * kimliksizin 2 katı tutulur ki çok cihazla çalışan kullanıcı daralmasın, kimliksiz kötüye kullanım sınırı ise değişmesin.
 * Dayanak STATİK SAYIMDIR, canlı ölçüm değil (2026-10-08): bir cihazın açılışı + 15 dakikalık olağan kullanımı genel sınırlayıcıdan
 * ≈ 64 istek geçirir (akış / `/api/db` ayrı sınırlayıcıda). «2 ×» bir paydır; canlıda 429 görülürse sayılıp ayarlanır.
 * Kimlik `sinirKimligi` ile (istek başına bir kez) okunur — anahtar üreticiyle AYNI hüküm.
 */
export function kimligeGoreTavan(dep: SinirBagimliliklari, kimliksiz: number, kimlikli: number): (req: SinirIstegi) => Promise<number> {
  return async (req) => {
    let uid: string | null = null;
    try { uid = await sinirKimligi(req, dep); } catch { uid = null; }
    return uid ? kimlikli : kimliksiz;
  };
}

/**
 * Genel `/api` sınırlayıcısından MUAF yollar (yalnız POST) — her birinin KENDİ sınırlayıcısı vardır (çit: hizSiniri.degismez.test.ts):
 *  • `/api/hit`: sayfa sayacı. Kimlik taşıyamaz (sendBeacon), her sayfa geçişinde gider; genel IP kovasında sayılsaydı bir ofisin
 *    sayfa geçişleri aynı IP'nin kur / takip / form isteklerini 429'a düşürürdü (ölçüldü: 300 sayaç isteğinden sonra kur 429).
 *  • imzalı sağlayıcı webhook'ları: gönderen tek çıkış IP'sinden toplu teslim eder; genel tavan (300 / 15 dk) teslimatı reddettirir,
 *    art arda ret aboneliğin kaldırılmasına gider. İmza doğrulaması asıl kapıdır; sel için ayrı, yüksek tavanlı sınırlayıcı var.
 */
export const API_SINIRINDAN_MUAF_YOLLAR: readonly string[] = ['/api/hit', '/api/shopify/webhook', '/api/stripe/webhook'];
const muafYollar = new Set(API_SINIRINDAN_MUAF_YOLLAR);
/**
 * Muafiyet yalnız POST içindir: muaf yolların kendi sınırlayıcısı POST zincirine bağlıdır. Yönteme bakılmasaydı aynı yola giden
 * GET / PUT … istekleri HİÇBİR tavana takılmadan 404 üretirdi (ölçüldü: GET /api/hit × 1000, hiçbiri 429 değil).
 */
export function apiSinirindanMuaf(req: Pick<SinirIstegi, 'originalUrl' | 'method'>): boolean {
  return req.method === 'POST' && muafYollar.has(yol(req.originalUrl));
}

// ── Aynı sınırlayıcının bir isteği İKİ KEZ saymaması ────────────────────────────────────────────────

type AraKatman<Q extends object, S> = (req: Q, res: S, next: (hata?: unknown) => void) => unknown;

/**
 * Bir ara katmanı (sınırlayıcıyı) istek başına EN ÇOK bir kez çalıştırır. Aynı sınırlayıcı hem önekle (`app.use`) hem rota
 * zincirinde bağlıysa iki geçiş de aynı kovayı artırır ve tavan sessizce yarıya iner (ölçüldü: Mikro sınırlayıcısı 4 uçta
 * 30 → 15). Eskiden iki geçiş farklı anahtar ürettiği için (IP:kapı ve u:<uid>) bu görünmüyordu.
 */
export function istekBasinaBirKez<Q extends object, S>(ara: AraKatman<Q, S>): AraKatman<Q, S> {
  const gorulen = new WeakSet<object>();
  return (req, res, next) => {
    if (gorulen.has(req)) { next(); return undefined; }
    gorulen.add(req);
    return ara(req, res, next);
  };
}
