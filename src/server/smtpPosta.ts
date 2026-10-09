/**
 * smtpPosta.ts — kendi posta sunucumuzdan SMTP ile giden posta.
 *
 * NEDEN VAR (kullanıcı kararı K2, 2026-10-08): mağaza talebi bildirimi Resend ile
 * DEĞİL, kendi posta sunucumuzdan gider (ölçüm: `mail.cetpa.com.tr`, MailEnable,
 * 465 örtük TLS, AUTH LOGIN). Resend yolu `eposta.ts`'te kalır; mevcut Resend
 * çağıranları (davet, bekçi uyarısı, rapor) bu modülü KULLANMAZ.
 *
 * ÜÇ KİP (2026-10-09; kullanıcı: «smtp ayarı eksik olmamalı, aynı sunucuda mail
 * adresi iletisim'den gidecek mail»; şartname kapısı `.wf/SARTNAME-smtp-yerel.md`):
 *
 *   kimlikli — `SMTP_USER` ve `SMTP_PASS` dolu: `SMTP_HOST`a (zorunlu) 465 örtük TLS
 *              ya da başka kapıda zorunlu STARTTLS ile, kimlik doğrulayarak.
 *   yerel    — ikisi de BOŞ (varsayılan): posta sunucusu ERP ile AYNI makinede (ölçüm:
 *              MX cetpa.com.tr = mail.cetpa.com.tr = app.cetpa.com.tr). Bildirim kimlik
 *              bilgisi olmadan, makinenin KENDİ adresine (127.0.0.1; o dinlemiyorsa kendi
 *              IPv4 adresleri) 25 numaralı kapıdan düz metinle teslim edilir. Trafik
 *              makineden çıkmaz; alıcı o sunucunun kendi kutusudur (gelen posta, aktarma
 *              değil). İki kapıdan geçer: RCPT TO (alıcı yerel → aktarma izni gerekmez)
 *              ve MAIL FROM (MailEnable «Address spoofing» ayarı kimliksiz yerel göndereni
 *              551 ile reddedebilir → `gonderen-reddi`; o zaman aynı oturumda bir kez boş
 *              zarf göndereniyle `MAIL FROM:<>` denenir, başlık From değişmez).
 *              `SMTP_HOST` yerel kipte YALNIZ yerel bir adres olabilir (uzak sunucu
 *              kimliksiz teslim almaz → «eksik: SMTP_USER, SMTP_PASS»); 465 ve 587
 *              kabul edilmez (örtük TLS / kimlik isteyen gönderim kapısı). Yalnız biri
 *              verilmiş kimlik yerel kipe DÜŞMEZ (eksik yarı bildirilir).
 *   kapali   — `MAGAZA_BILDIRIM=kapali`: bağlantı denenmez (hazırlık / geliştirme; deneme
 *              talepleri gerçek kutuya gitmesin).
 *   Alıcı varsayılanı `iletisim@cetpa.com.tr`; gönderen `SMTP_FROM`, yoksa kimlikli
 *   kipte kullanıcı adı, yerel kipte alıcı.
 *
 * YAPRAK modül: server.ts'i içe aktarmaz.
 *
 * ÜÇ DEĞİŞMEZ:
 *
 * 1) YAPILANDIRMA TEK İŞLEVDEN. `smtpYapilandirmasi()` dışarıya yalnız anahtar
 *    ADI ve kipi verir; değer günlüğe / yanıta / dokümana yazılmaz. Eksikse bağlantı
 *    DENENMEZ (`{ ok: false, yapilandirilmamis: true }`).
 *
 * 2) SERTİFİKA DOĞRULAMASI KAPATILMAZ. `rejectUnauthorized: false` ve
 *    `NODE_TLS_REJECT_UNAUTHORIZED` bu modülde YASAK (çit: smtpPosta.test.ts,
 *    yorumları süzerek tarar). Doğrulama AÇIKÇA açık yazılır — ölçüm 2026-10-08
 *    (nodemailer 10.0.16, Node 24): süreçte `NODE_TLS_REJECT_UNAUTHORIZED=0`
 *    varken seçenek verilmeyen bağlantı kendinden imzalı sertifikayı KABUL edip
 *    kullanıcı adı + parolayı gönderdi; seçenek açıkça `true` iken reddetti.
 *    Düz metne düşüş de yok: kapı 465 değilse STARTTLS ZORUNLU (ölçüm: sunucu
 *    STARTTLS sunmayınca AUTH hiç gönderilmedi). Yerel kip bu kuralın DIŞINDA
 *    değildir, KONUSU değildir: TLS yalnız makinenin kendi adresine giden,
 *    kimlik bilgisi taşımayan oturumda kapalıdır (ölçüm 2026-10-09: sunucu STARTTLS
 *    duyursa da `ignoreTLS` ile yükseltme denenmez; sertifika `mail.cetpa.com.tr`
 *    adına, bağlantı 127.0.0.1'e — ad doğrulaması tutamazdı, doğrulamayı gevşetmek
 *    yerine trafiği makineden çıkarmayan düz oturum seçildi). Yerel kipin seçenek
 *    işlevi uzak bir adres ÜRETEMEZ: adaylar yalnız geri döngü + kendi adresleri;
 *    `SMTP_HOST` yerel değilse yapılandırma eksik sayılır.
 *
 * 3) HATA METNİ DIŞARI ÇIKMAZ. `sendEmail`'in (Resend) ham sağlayıcı hata metni
 *    döndüren sözleşmesi ÖRNEK ALINMADI: SMTP hata iletisi sunucu yanıtını,
 *    alıcı adresini, sertifika ayrıntısını taşır. Dışarıya yalnız kapalı kümeden
 *    bir SINIF çıkar (`MAGAZA_BILDIRIM_HATA_SINIFLARI`). `smtpGonder` ve
 *    `smtpDogrula` ASLA fırlatmaz.
 *
 * ADAY SEÇİMİ VE ÇİFT POSTA: birden çok aday yalnız yerel kipte ve yalnız `SMTP_HOST`
 * boşken olur. Aday, posta GÖNDERMEYEN ham bir sondayla (bağlan + 220 karşılama + QUIT)
 * seçilir; `sendMail` hiçbir hatada ikinci adayı tetiklemez. Ölçüm 2026-10-09: nodemailer
 * hata alanları «oturum hiç kurulmadı» ile «DATA gönderildi, yanıt gelmedi»yi ayırmaz
 * (ikisi de ECONNECTION / CONN) — gönderim hatasına bakıp aday değiştirmek çift posta
 * üretebilirdi.
 */
import { createTransport } from 'nodemailer';
import type { SMTPTransportOptions, SendMailOptions } from 'nodemailer';
import { connect as soketAc } from 'node:net';
import { networkInterfaces, hostname } from 'node:os';
import type { MagazaBildirimHataSinifi } from '../lib/magazaTalep.js';
import { isValidEmail } from './eposta.js';

export type SmtpSonucu = { ok: true } | { ok: false; sinif: MagazaBildirimHataSinifi };
export type SmtpKipi = 'kimlikli' | 'yerel' | 'kapali';

/** `MAGAZA_BILDIRIM_ALICI` verilmediğinde bildirimin gideceği kutu (kullanıcı kararı 2026-10-09). */
export const MAGAZA_BILDIRIM_VARSAYILAN_ALICI = 'iletisim@cetpa.com.tr';

/** Kimlikli kipte `SMTP_PORT` verilmediğinde: örtük TLS kapısı (posta sunucumuzun ölçülen kapısı). */
const VARSAYILAN_KAPI = 465;
/** Yerel kipte `SMTP_PORT` verilmediğinde: MX kapısı (gelen posta için zaten açık; kimlik zorlaması dış postayı da keserdi). */
const YEREL_VARSAYILAN_KAPI = 25;
/** Yerel kipte KABUL EDİLMEYEN kapılar: 465 örtük TLS ister (düz istemci karşılamayı bekler, zaman aşımı), 587 kimlik isteyebilir. */
const YEREL_YASAK_KAPILAR: ReadonlySet<number> = new Set([465, 587]);
/** Yerel kipin ilk ve en yetkili adayı (Plesk beyaz listesi varsayılanında yalnız 127.0.0.1/8 var). Hep IP literali: ad verilirse
 *  nodemailer DNS sorar, 'localhost' ::1'e düşebilir ve IPv4 dinleyici reddeder. */
const GERI_DONGU = '127.0.0.1';
/** Toplam aday üst sınırı (geri döngü + kendi adresleri). */
const EN_COK_ADAY = 3;

// Süre sınırları (ms). nodemailer varsayılanları bağlantı 2 dk / karşılama 30 sn /
// soket 10 dk / DNS 30 sn — bir bildirim işi için fazla uzun.
//
// KUYRUK İŞİ SÜRESİYLE İLİŞKİ (`MAGAZA_BILDIRIM_IS_SECENEKLERI.expireInSeconds` = 120 sn):
// bu sınırlar ADIM BAŞINADIR, gönderimin TOPLAM süresini sınırlamaz (nodemailer 10.0.16:
// soket sınırı hareketsizlik süresidir, her veri parçasında yeniden başlar). 465'te bir
// gönderim DNS + bağlantı + karşılama + sekiz komut gidiş-dönüşünden geçer (EHLO; AUTH
// LOGIN, kullanıcı, parola; MAIL FROM; RCPT TO; DATA; gövde onayı). Her adımı sınırın
// hemen altında bekleten sunucuda toplam 10 + 10 + 10 + 8 × 15 = 150 sn'ye varır (hesap,
// ölçüm DEĞİL; yanıtı parça parça yollayan sunucuda daha da uzar) — 120 sn'ye SIĞMAYABİLİR.
// O durumda pg-boss 12.26 işleyiciyi DURDURMAZ: beklemeyi bırakır, işi başarısız sayar
// (bir deneme hakkı harcanır) ve hak kaldıysa gecikmeyle yeniden verir; gönderim arkada
// sürer. Süren gönderimle çakışan yeniden denemeyi `magazaBildirim.ts`'teki süreç içi
// sahiplenme geri çevirir (çift posta olmasın). Değerler bu turda DEĞİŞTİRİLMEDİ (inceleme
// turu kararı 2026-10-08); canlı sunucuda bir oturumun gerçek süresi ölçülmedi.
const BAGLANTI_SINIRI_MS = 10_000;
const KARSILAMA_SINIRI_MS = 10_000;
const SOKET_SINIRI_MS = 15_000;
const DNS_SINIRI_MS = 10_000;
// Yerel kip: geri döngüde bağlantı ya anında kurulur ya anında RST alır (ölçüm 0–1 ms); 3 sn yalnız SYN'i yanıtlanmayan
// adaya harcanır. En kötü durum 3 aday × (3 + 5) + 5 gidiş-dönüş × 15 = 99 sn < 120 sn iş sınırı.
const YEREL_BAGLANTI_SINIRI_MS = 3_000;
const YEREL_KARSILAMA_SINIRI_MS = 5_000;
/** Ham sondada komut başına yanıt bekleme. */
const SONDA_YANIT_SINIRI_MS = 5_000;

/**
 * `smtpDogrula`'nın TOPLAM süre sınırı (bekçi: «10 sn sınır»). Adım sınırları tek
 * tek tutsa da toplamları 10 sn'yi aşabilir; doğrulama posta göndermediği için
 * beklemeyi bırakmak zararsızdır. `smtpGonder`'de toplam sınır YOK (bilerek):
 * nodemailer süren gönderimi iptal edemez — beklemeyi bırakıp «gitmedi» demek,
 * ileti aslında gittiğinde yeniden denemeyle ÇİFT posta üretirdi.
 */
export const SMTP_DOGRULAMA_SINIRI_MS = 10_000;

interface SmtpAyari {
  kip: 'kimlikli' | 'yerel';
  /** Sırayla denenecek sunucu adresleri; kimlikli kipte tek (`SMTP_HOST`), yerel kipte IP literalleri. */
  adaylar: string[];
  port: number;
  user: string;
  pass: string;
  from: string;
  alici: string;
}

/**
 * Kapı: yoksa / boşsa kipin varsayılanı; verilmişse 1–65535 TAM sayı. Bozuksa `null` —
 * sessizce varsayılana DÖNÜLMEZ (yanlış yazılmış kapı «yapılandırılmış» görünüp başka
 * bir kapıya bağlanmasın). `parseInt` KULLANILMAZ: '587abc' → 587 kabul ederdi.
 */
function kapiCoz(ham: string | undefined, varsayilan: number): number | null {
  const metin = (ham ?? '').trim();
  if (metin === '') return varsayilan;
  if (!/^\d{1,5}$/.test(metin)) return null;
  const kapi = Number(metin);
  return kapi >= 1 && kapi <= 65535 ? kapi : null;
}

/**
 * Makinenin kendi IPv4 adresleri: iç (geri döngü) olmayan, bağlantı-yerel (169.254/16) ve 0.0.0.0 olmayan.
 * Node 18+ `family: 'IPv4'`; eski sürümde 4. Sıra arayüz sırasıdır.
 */
export function kendiIpv4Adresleri(arayuzler: ReturnType<typeof networkInterfaces> = networkInterfaces()): string[] {
  const adresler: string[] = [];
  for (const liste of Object.values(arayuzler)) {
    for (const a of liste ?? []) {
      const aile: unknown = a.family;
      if (a.internal || !(aile === 'IPv4' || aile === 4) || typeof a.address !== 'string') continue;
      if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(a.address) || a.address === '0.0.0.0' || a.address.startsWith('169.254.')) continue;
      if (!adresler.includes(a.address)) adresler.push(a.address);
    }
  }
  return adresler;
}

const GERI_DONGU_ADLARI: ReadonlySet<string> = new Set(['localhost', '::1', '::ffff:127.0.0.1']);
/** RFC 1918 özel ağ adresi (Hyper-V / WSL / VPN sanal bağdaştırıcıları): aday sırasında herkese açık adresin ARKASINA alınır. */
const ozelAgMi = (a: string): boolean => /^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(a);
const geriDonguMu = (h: string): boolean => GERI_DONGU_ADLARI.has(h) || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h);

/** Adres bu makine mi: geri döngü adları / adresleri ya da kendi IPv4 adreslerinden biri. */
export function yerelAdresMi(host: string, kendiAdresleri: readonly string[]): boolean {
  const h = host.trim().toLowerCase().replace(/^\[(.*)\]$/, '$1');
  return geriDonguMu(h) || kendiAdresleri.some(a => a.toLowerCase() === h);
}

/**
 * `SMTP_HOST` boşken yerel kipin aday listesi: geri döngü, sonra kendi adresleri — herkese açık adres ÖNCE, özel ağ
 * (sanal bağdaştırıcılar) sonra; kararlı sıralama arayüz sırasını korur; en çok `EN_COK_ADAY`.
 */
export function yerelAdaylar(kendiAdresleri: readonly string[]): string[] {
  const kendi = kendiAdresleri.filter(a => !geriDonguMu(a)).sort((a, b) => Number(ozelAgMi(a)) - Number(ozelAgMi(b)));
  return [GERI_DONGU, ...kendi].slice(0, EN_COK_ADAY);
}

/** Yerel kipte nodemailer'a verilecek IP literali: geri döngü yazımlarının hepsi 127.0.0.1'e iner. */
function yerelAdayi(host: string): string {
  const h = host.trim().toLowerCase().replace(/^\[(.*)\]$/, '$1');
  return geriDonguMu(h) ? GERI_DONGU : h;
}

/**
 * Ortam değişkenlerini TEK yerde okur. `ayar` yalnız hiçbir anahtar eksik değilken dolu.
 * Eksik adlarının sırası sabit: HOST, (USER, PASS), PORT, ALICI. Yarım kimlikte yalnız boş kalan
 * kimlik anahtarı yazılır (operatörün kararı «tamamla» ya da «ikisini de sil»dir, sunucu değil).
 */
function smtpAyarlari(ortam: NodeJS.ProcessEnv, kendiAdresleri: readonly string[]): { eksik: string[]; ayar: SmtpAyari | null; kip: SmtpKipi } {
  const oku = (ad: string): string => (ortam[ad] ?? '').trim();
  if (oku('MAGAZA_BILDIRIM').toLowerCase() === 'kapali') return { eksik: [], ayar: null, kip: 'kapali' };
  const host = oku('SMTP_HOST');
  const user = oku('SMTP_USER');
  // Parola KIRPILMAZ: baştaki / sondaki boşluk parolanın parçası olabilir.
  const pass = ortam.SMTP_PASS ?? '';
  const alici = oku('MAGAZA_BILDIRIM_ALICI') || MAGAZA_BILDIRIM_VARSAYILAN_ALICI;
  // Kimlik bilgisinin yarısı bile yazılmışsa kimlikli kip hedeflenmiştir: eksik yarı bildirilir, yerel kipe DÜŞÜLMEZ.
  // Kip kararında yalnız boşluktan oluşan parola «yazılmamış» sayılır (USER ile simetrik); parolanın DEĞERİ yine kırpılmaz.
  const kip: 'kimlikli' | 'yerel' = user !== '' || pass.trim() !== '' ? 'kimlikli' : 'yerel';
  const port = kapiCoz(ortam.SMTP_PORT, kip === 'yerel' ? YEREL_VARSAYILAN_KAPI : VARSAYILAN_KAPI);

  const eksik: string[] = [];
  if (kip === 'kimlikli') {
    if (!host && user && pass) eksik.push('SMTP_HOST');
    if (port === null) eksik.push('SMTP_PORT');
    if (!user) eksik.push('SMTP_USER');
    if (!pass) eksik.push('SMTP_PASS');
  } else {
    if (host && !yerelAdresMi(host, kendiAdresleri)) eksik.push('SMTP_USER', 'SMTP_PASS');
    if (port === null || YEREL_YASAK_KAPILAR.has(port)) eksik.push('SMTP_PORT');
    // Yerel kip YALNIZ üretim adresi tanımlıyken: hazırlık hizmeti üretimin .env'ini kopyalar ama APP_URL'i
    // http://localhost yapar, geliştirme makinesinde APP_URL yoktur — ikisi de aynı makinedeki posta sunucusuna
    // kimliksiz teslim yapıp deneme taleplerini gerçek iletisim@ kutusuna gönderirdi (inceleme 2026-10-09).
    // Kimlikli kip bilinçli yapılandırmadır, bu kurala tabi değil. Hazırlıkta yeşil görünüm için MAGAZA_BILDIRIM=kapali.
    // `\/{2}`: satır tabanlı yorum süzgeci (degismezTarayici) regex içindeki `//`'i yorum sanıyor.
    if (!/^https:\/{2}/i.test(oku('APP_URL'))) eksik.push('APP_URL');
  }
  // Yazılmış ama e-posta biçiminde olmayan alıcı da «eksik»tir (gönderim zaten reddedilirdi).
  if (!isValidEmail(alici)) eksik.push('MAGAZA_BILDIRIM_ALICI');

  if (eksik.length > 0 || port === null) return { eksik, ayar: null, kip };
  let adaylar: string[];
  if (kip === 'kimlikli') adaylar = [host];
  else if (host) adaylar = [yerelAdayi(host)];
  else adaylar = yerelAdaylar(kendiAdresleri);
  const from = oku('SMTP_FROM') || (kip === 'kimlikli' ? user : alici);
  return { eksik, ayar: { kip, adaylar, port, user, pass, from, alici }, kip };
}

/** Yalnız anahtar ADI ve kip döner; değer asla günlüğe / yanıta yazılmaz. `kapali` kipte `tamam` yanlış, `eksik` boş. */
export function smtpYapilandirmasi(ortam: NodeJS.ProcessEnv = process.env, kendiAdresleri: readonly string[] = kendiIpv4Adresleri()): { tamam: boolean; eksik: string[]; kip: SmtpKipi } {
  const { eksik, ayar, kip } = smtpAyarlari(ortam, kendiAdresleri);
  return { tamam: ayar !== null, eksik, kip };
}

/** Kimlikli kip — güvenlik değişmezleri (dosya başı, madde 2) burada toplanır. */
function kimlikliSecenekleri(a: SmtpAyari, host: string): SMTPTransportOptions {
  const ortukTls = a.port === VARSAYILAN_KAPI;
  return {
    host,
    port: a.port,
    // 465 = bağlantı baştan TLS. Başka kapıda (587 / 25) STARTTLS ZORUNLU:
    // sunucu sunmuyorsa ya da yükseltme başarısızsa gönderim DURUR, düz metne düşmez.
    secure: ortukTls,
    ...(ortukTls ? {} : { requireTLS: true }),
    // Yöntem ADI verilmez: nodemailer sunucunun duyurduğunu seçer (sunucumuz yalnız AUTH LOGIN sunuyor).
    auth: { user: a.user, pass: a.pass },
    // `SMTP_HOST` sertifikadaki adla aynı olmalı (ad doğrulaması da açık kalır).
    tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
    connectionTimeout: BAGLANTI_SINIRI_MS,
    greetingTimeout: KARSILAMA_SINIRI_MS,
    socketTimeout: SOKET_SINIRI_MS,
    dnsTimeout: DNS_SINIRI_MS,
    // İleti yalnız metin + HTML taşır; içerikten dosya yolu / adres ÇEKİLMEZ.
    disableFileAccess: true,
    disableUrlAccess: true,
  };
}

/**
 * Yerel kip — makinenin KENDİ adresine, kimlik bilgisi olmadan, düz metin. `host` yalnız `smtpAyarlari`nın
 * ürettiği adaylardan gelir (geri döngü, kendi adresleri ya da yerel olduğu doğrulanmış `SMTP_HOST`); bu
 * işlev uzak adres görmez. `auth` YOK: kimlik bilgisi taşınmaz, gönderilmez. `requireTLS` YOK: ölçüm 2026-10-09,
 * `requireTLS` `ignoreTLS`i ezer ve yükseltmeyi dener.
 */
function yerelSecenekleri(a: SmtpAyari, host: string): SMTPTransportOptions {
  return {
    host,
    port: a.port,
    secure: false,
    ignoreTLS: true,
    connectionTimeout: YEREL_BAGLANTI_SINIRI_MS,
    greetingTimeout: YEREL_KARSILAMA_SINIRI_MS,
    socketTimeout: SOKET_SINIRI_MS,
    dnsTimeout: DNS_SINIRI_MS,
    disableFileAccess: true,
    disableUrlAccess: true,
  };
}

const tasiyiciSecenekleri = (a: SmtpAyari, host: string): SMTPTransportOptions =>
  (a.kip === 'yerel' ? yerelSecenekleri(a, host) : kimlikliSecenekleri(a, host));

/** Bu modülün taşıyıcıdan kullandığı EN DAR yüzey (nodemailer `Mail` buna uyar). */
interface SmtpTasiyici {
  sendMail: (ileti: SendMailOptions) => Promise<unknown>;
  verify: () => Promise<true>;
  close: () => void;
}

/** Kapatma hatası sonucu DEĞİŞTİRMEZ (asla fırlatmaz sözleşmesi `finally` içinde de geçerli). */
function sessizKapat(tasiyici: SmtpTasiyici | null): void {
  try { tasiyici?.close(); } catch { /* yut */ }
}

const alan = (nesne: object, ad: string): unknown => (ad in nesne ? (nesne as Record<string, unknown>)[ad] : undefined);

// TLS / sertifika hatasının İZİ. NEDEN KOD YETMİYOR (ölçüm 2026-10-08, nodemailer
// 10.0.16): soket düzeyindeki HER hata `ESOCKET` koduyla gelir ve Node'un kendi
// kodu (CERT_HAS_EXPIRED, ERR_TLS_CERT_ALTNAME_INVALID …) ÜZERİNE yazılır —
// kendinden imzalı sertifika hem 465'te hem STARTTLS yükseltmesinde `ESOCKET` verdi,
// `ETLS` DEĞİL. Ayırt eden yalnız şunlar kalıyor:
//   · `library: 'SSL routines'`  — el sıkışma hatası (yanlış sürüm, TLS konuşmayan kapı)
//   · `cert` alanı               — ad uyuşmazlığı (Node hataya sertifikayı iliştirir)
//   · ileti metni                — 'self-signed certificate', 'certificate has expired' …
// İleti yalnız SINIFLAMAK için okunur; hiçbir yere yazılmaz.
const TLS_ILETI_DESENI = /certificate|altnames|SSL routines|\b(?:START)?TLS\b/i;

function tlsIzi(hata: object): boolean {
  const kutuphane = alan(hata, 'library');
  if (typeof kutuphane === 'string' && /SSL/i.test(kutuphane)) return true;
  if (alan(hata, 'cert') !== undefined) return true;
  const ileti = alan(hata, 'message');
  return typeof ileti === 'string' && TLS_ILETI_DESENI.test(ileti);
}

/**
 * Hata nesnesini kapalı kümeden bir sınıfa indirger (metin taşımaz).
 *
 * Kodlar nodemailer 10.0.16 `errors.d.ts` + ölçümden (yerel sahte sunucu, 2026-10-08 / 09):
 *   kimlik         EAUTH        — 5xx (535 «Invalid login») ya da yanıt kodsuz (eksik kimlik bilgisi)
 *                  ENOAUTH      — kimlik bilgisi hiç verilmedi (yalnız `forceAuth` ile; bu modül her zaman verir)
 *   gonderen-reddi EENVELOPE    — MAIL FROM komutunun 5xx reddi (MailEnable 551 «requires authentication before sending
 *                                 mail from a locally hosted domain» = Address spoofing ayarı; kimlikli kipte 551 «Sender
 *                                 address is not valid for your login» = SMTP_FROM ≠ kullanıcı)
 *   alici-reddi    EENVELOPE    — RCPT TO / DATA komutunun 5xx ya da yanıt kodsuz reddi; ayrıca kodsuz hatada RCPT TO'ya 5xx
 *                                 (MailEnable 503 «requires authentication when … non-local» = alan yerel değil; 550 = kutu yok)
 *   tls            ETLS         — STARTTLS sunulmuyor / yükseltilemedi; ya da soket hatasında TLS izi
 *                  EREQUIRETLS  — RFC 8689 uzantısı (bu modül istemez; kod adı gereği TLS sınıfı)
 *   baglanti       ECONNECTION / ETIMEDOUT / ESOCKET / EDNS
 *   diger          kalan her şey (EMESSAGE: ileti gövdesinin reddi, EPROTOCOL, kodsuz hata, hata olmayan değer)
 *                  + EAUTH / ENOAUTH / EENVELOPE hatasında 4xx yanıt (aşağıda)
 *
 * 4xx YANIT GEÇİCİDİR (inceleme turu kararı 2026-10-08). `kimlik`, `gonderen-reddi` ve `alici-reddi` çağıranda
 * KALICI sınıftır (`magazaBildirim.ts` `KALICI_HATA_SINIFLARI`): ilk başarısızlıkta
 * `gonderilemedi` yazılır, kuyruk yeniden DENEMEZ. 4xx ise SMTP'nin «geçici olumsuz yanıt»ıdır
 * (RFC 5321 §4.2.1; örnek: 450 kutu meşgul / gri liste, 451 sunucu hatası, 452 yer yok; RFC 4954:
 * 454 kimlik doğrulama geçici arızası): kendiliğinden düzelir, o yüzden kalıcı sınıfa GİRMEZ, `diger`
 * olur ve kuyruk yeniden dener. Ölçüm (gerçek nodemailer, yerel sahte sunucu): RCPT TO 450 / 451 / 452,
 * MAIL FROM 451 / 452, DATA 451 → `EENVELOPE`; AUTH 454 → `EAUTH`; hepsi `responseCode` taşır.
 * Yanıt kodu TAŞIMAYAN `EAUTH` («Missing credentials») ve `EENVELOPE` («no recipients defined»)
 * yapılandırma hatasıdır — kalıcı kalır. Bedeli: bütün denemeler 4xx ile biterse son kayıtta
 * `hataSinifi: 'diger'` görünür («alıcı / kimlik tarafı geçici reddetti» ipucu taşınmaz).
 */
export function smtpHataSinifi(hata: unknown): MagazaBildirimHataSinifi {
  if (typeof hata !== 'object' || hata === null) return 'diger';
  try {
    const kod = alan(hata, 'code');
    const komut = alan(hata, 'command');
    const yanitKodu = alan(hata, 'responseCode');
    const gecici = typeof yanitKodu === 'number' && yanitKodu >= 400 && yanitKodu <= 499;
    const kalici = typeof yanitKodu === 'number' && yanitKodu >= 500 && yanitKodu <= 599;
    if (kod === 'EAUTH' || kod === 'ENOAUTH') return gecici ? 'diger' : 'kimlik';
    if (kod === 'EENVELOPE') {
      if (gecici) return 'diger';
      return komut === 'MAIL FROM' && kalici ? 'gonderen-reddi' : 'alici-reddi';
    }
    if (komut === 'RCPT TO' && kalici) return 'alici-reddi';
    if (kod === 'ETLS' || kod === 'EREQUIRETLS') return 'tls';
    if (kod === 'EDNS' || kod === 'ETIMEDOUT') return 'baglanti';
    if (kod === 'ESOCKET' || kod === 'ECONNECTION') return tlsIzi(hata) ? 'tls' : 'baglanti';
    return 'diger';
  } catch {
    // Alan okuması fırlatan nesne (erişimci / vekil): sınıflama da fırlatmamalı.
    return 'diger';
  }
}

// ── Ham SMTP sondası (posta GÖNDERMEZ) ────────────────────────────────────────────────────────────────────────────
export interface HamOturumSonucu {
  /** Sunucudan 220 karşılaması alındı mı (bağlantı kuruldu ve SMTP konuşuyor). */
  ulasildi: boolean;
  /** Komutlara gelen yanıt kodları (komut sırasıyla; ilk 4xx / 5xx'te durur). */
  yanitlar: number[];
}

/**
 * Satır tabanlı ham SMTP oturumu: bağlan, 220 karşılamasını bekle, komutları sırayla gönder (ilk olumsuz yanıtta dur),
 * sonunda QUIT. DATA hiç gönderilmez; ileti oluşmaz. Bağlantı / karşılama / yanıt sınırları ayrı. Asla fırlatmaz.
 * Çok satırlı yanıtın (`250-…`) yalnız son satırı (`250 …`) sayılır.
 */
export function hamSmtpOturumu(host: string, port: number, komutlar: readonly string[], sinir: { baglantiMs: number; yanitMs: number } = { baglantiMs: YEREL_BAGLANTI_SINIRI_MS, yanitMs: SONDA_YANIT_SINIRI_MS }): Promise<HamOturumSonucu> {
  return new Promise((coz) => {
    const yanitlar: number[] = [];
    let tampon = '';
    let bitti = false;
    let ulasildi = false;
    let sira = -1;
    let zamanlayici: ReturnType<typeof setTimeout> | undefined;
    const sok = soketAc({ host, port });
    const bitir = (): void => {
      if (bitti) return;
      bitti = true;
      clearTimeout(zamanlayici);
      sok.destroy();
      coz({ ulasildi, yanitlar });
    };
    const sinirla = (ms: number): void => { clearTimeout(zamanlayici); zamanlayici = setTimeout(bitir, ms); };
    const sonraki = (): void => {
      sira += 1;
      if (sira < komutlar.length) { sok.write(komutlar[sira] + '\r\n'); sinirla(sinir.yanitMs); return; }
      sok.write('QUIT\r\n');
      bitir();
    };
    sinirla(sinir.baglantiMs);
    sok.on('connect', () => sinirla(sinir.yanitMs));
    sok.on('error', bitir);
    sok.on('close', bitir);
    sok.on('data', (parca: Buffer) => {
      tampon += parca.toString('latin1');
      for (let i = tampon.indexOf('\r\n'); i >= 0 && !bitti; i = tampon.indexOf('\r\n')) {
        const satir = tampon.slice(0, i);
        tampon = tampon.slice(i + 2);
        const m = /^(\d{3})([ -]|$)/.exec(satir);
        if (!m || m[2] === '-') continue;
        const kod = Number(m[1]);
        if (!ulasildi) {
          if (kod !== 220) { bitir(); return; }
          ulasildi = true;
          sonraki();
          continue;
        }
        yanitlar.push(kod);
        if (kod >= 400) { sok.write('QUIT\r\n'); bitir(); return; }
        sonraki();
      }
    });
  });
}

/** Adaylardan 220 karşılaması veren İLKİ; hiçbiri vermezse `null`. Sonda posta göndermez; aday ≤ 3. */
export async function adaySec(adaylar: readonly string[], port: number, sonda: (host: string, port: number) => Promise<HamOturumSonucu> = (h, p) => hamSmtpOturumu(h, p, [])): Promise<string | null> {
  for (const host of adaylar.slice(0, EN_COK_ADAY)) {
    if ((await sonda(host, port)).ulasildi) return host;
  }
  return null;
}

/** `MAIL FROM:<…>` için zarf adresi: «Ad <adres>» biçiminden adres ayıklanır. */
const zarfAdresi = (s: string): string => (/<([^>]+)>/.exec(s)?.[1] ?? s).trim();

/**
 * Yerel kipte teslim KABULÜ sondası: EHLO → MAIL FROM → RCPT TO → RSET → QUIT; DATA yok, posta oluşmaz.
 * nodemailer `verify()` yalnız bağlan + EHLO yapar ve MailEnable'ın MAIL FROM (551) / RCPT TO (503, 550) reddini
 * göremez (ölçüm 2026-10-09); bekçi bu sondayla «yeşil ama posta reddediliyor» kör noktasını kapatır.
 */
export async function teslimSondasi(host: string, port: number, from: string, alici: string): Promise<SmtpSonucu> {
  const ilk = await sondaOturumu(host, port, zarfAdresi(from), alici);
  // Gönderimle AYNI karar (`smtpGonder` geri dönüşünün ikizi): MAIL FROM 5xx → ikinci oturumda bir kez boş zarf göndereni.
  // Sonda gönderimden farklı hüküm verseydi bekçi hep kırmızı kalır, kaçanlar hiç kuyruğa alınmazdı (inceleme 2026-10-09).
  if (!ilk.ok && ilk.sinif === 'gonderen-reddi') return sondaOturumu(host, port, '', alici);
  return ilk;
}

async function sondaOturumu(host: string, port: number, zarf: string, alici: string): Promise<SmtpSonucu> {
  const sonuc = await hamSmtpOturumu(host, port, [`EHLO ${hostname()}`, `MAIL FROM:<${zarf}>`, `RCPT TO:<${alici}>`, 'RSET']);
  if (!sonuc.ulasildi) return { ok: false, sinif: 'baglanti' };
  const [ehlo, mail, rcpt] = sonuc.yanitlar;
  if (ehlo === undefined || ehlo >= 400) return { ok: false, sinif: 'diger' };
  if (mail === undefined) return { ok: false, sinif: 'baglanti' };
  if (mail >= 500) return { ok: false, sinif: 'gonderen-reddi' };
  if (mail >= 400) return { ok: false, sinif: 'diger' };
  if (rcpt === undefined) return { ok: false, sinif: 'baglanti' };
  if (rcpt >= 500) return { ok: false, sinif: 'alici-reddi' };
  if (rcpt >= 400) return { ok: false, sinif: 'diger' };
  return { ok: true };
}

/** Test düzeneği için: kendi adreslerini vermek (gerçek arayüzler okunmasın). */
export interface SmtpSecenek { kendiAdresleri?: readonly string[] }

/** Birden çok adayda ulaşılabilen ilki (sondayla); tek adayda sonda yok (gönderim aynı yoldan geçer). */
async function hedefSec(a: SmtpAyari): Promise<string | null> {
  return a.adaylar.length === 1 ? a.adaylar[0] : adaySec(a.adaylar, a.port);
}

/** `MAGAZA_BILDIRIM_ALICI`'ya (yoksa varsayılan kutuya) tek ileti. Asla fırlatmaz. Yapılandırma eksikse bağlantı DENEMEZ. */
export async function smtpGonder(ileti: { konu: string; html: string; metin: string }, secenek: SmtpSecenek = {}): Promise<SmtpSonucu | { ok: false; yapilandirilmamis: true }> {
  let tasiyici: SmtpTasiyici | null = null;
  try {
    const { ayar } = smtpAyarlari(process.env, secenek.kendiAdresleri ?? kendiIpv4Adresleri());
    if (!ayar) return { ok: false, yapilandirilmamis: true };
    const host = await hedefSec(ayar);
    if (host === null) return { ok: false, sinif: 'baglanti' };
    tasiyici = createTransport(tasiyiciSecenekleri(ayar, host));
    const govde: SendMailOptions = {
      from: ayar.from,
      // Nesne biçimi: adres ayrıştırıcısından GEÇMEZ (virgül / köşeli ayraç ikinci alıcı üretemez).
      to: { name: '', address: ayar.alici },
      subject: ileti.konu,
      text: ileti.metin,
      html: ileti.html,
    };
    try {
      await tasiyici.sendMail(govde);
    } catch (hata) {
      // MAIL FROM reddi (5xx): DATA hiç gitmedi, ileti kabul edilmedi — aynı adaya BİR KEZ boş zarf göndereniyle
      // (`MAIL FROM:<>`) yeniden denenir; başlık From değişmez. MailEnable «Address spoofing» kapısı yalnız sunucuda
      // tanımlı alan adlı gönderene bakar; boş gönderene bakmaz (belge; ölçüm: nodemailer `envelope.from = ''` → `MAIL FROM:<>`).
      if (ayar.kip !== 'yerel' || smtpHataSinifi(hata) !== 'gonderen-reddi') throw hata;
      await tasiyici.sendMail({ ...govde, envelope: { from: '', to: [ayar.alici] } });
      console.warn('[smtp] yerel teslim: MAIL FROM reddedildi, boş zarf göndereniyle kabul edildi (posta sunucusunda Address spoofing ayarı kimliksiz yerel gönderene kapalı)');
    }
    return { ok: true };
  } catch (hata) {
    return { ok: false, sinif: smtpHataSinifi(hata) };
  } finally {
    sessizKapat(tasiyici);
  }
}

/**
 * Bekçi doğrulaması; posta GÖNDERMEZ. Asla fırlatmaz. Kimlikli kip: nodemailer `verify` (bağlan + TLS + EHLO + AUTH).
 * Yerel kip: aday seçimi + teslim sondası (EHLO + MAIL FROM + RCPT TO + RSET) — kabul reddini de görür.
 */
export async function smtpDogrula(secenek: SmtpSecenek = {}): Promise<SmtpSonucu | { ok: false; yapilandirilmamis: true }> {
  let tasiyici: SmtpTasiyici | null = null;
  let zamanlayici: ReturnType<typeof setTimeout> | undefined;
  try {
    const { ayar } = smtpAyarlari(process.env, secenek.kendiAdresleri ?? kendiIpv4Adresleri());
    if (!ayar) return { ok: false, yapilandirilmamis: true };
    const sureDoldu = new Promise<never>((_, reddet) => {
      zamanlayici = setTimeout(() => reddet(Object.assign(new Error('SMTP doğrulaması süre sınırını aştı'), { code: 'ETIMEDOUT' })), SMTP_DOGRULAMA_SINIRI_MS);
    });
    if (ayar.kip === 'yerel') {
      const host = await Promise.race([hedefSec(ayar), sureDoldu]);
      if (host === null) return { ok: false, sinif: 'baglanti' };
      return await Promise.race([teslimSondasi(host, ayar.port, ayar.from, ayar.alici), sureDoldu]);
    }
    tasiyici = createTransport(tasiyiciSecenekleri(ayar, ayar.adaylar[0]));
    const dogrulama = tasiyici.verify();
    // Süre sınırı kazanırsa doğrulama sözü geride kalır ama SAHİPSİZ değildir: yarış ona
    // ret işleyicisi bağlar, SONRADAN reddetse de genel `unhandledRejection` işleyicisine
    // düşmez (test kilitler — yarış başka bir yapıyla değiştirilirse kırılır).
    await Promise.race([dogrulama, sureDoldu]);
    return { ok: true };
  } catch (hata) {
    return { ok: false, sinif: smtpHataSinifi(hata) };
  } finally {
    clearTimeout(zamanlayici);
    sessizKapat(tasiyici);
  }
}
