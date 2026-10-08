/**
 * smtpPosta.ts — kendi posta sunucumuzdan SMTP ile giden posta.
 *
 * NEDEN VAR (kullanıcı kararı K2, 2026-10-08): mağaza talebi bildirimi Resend ile
 * DEĞİL, kendi posta sunucumuzdan gider (ölçüm: `mail.cetpa.com.tr`, MailEnable,
 * 465 örtük TLS, AUTH LOGIN). Resend yolu `eposta.ts`'te kalır; mevcut Resend
 * çağıranları (davet, bekçi uyarısı, rapor) bu modülü KULLANMAZ.
 *
 * YAPRAK modül: server.ts'i içe aktarmaz.
 *
 * ÜÇ DEĞİŞMEZ:
 *
 * 1) YAPILANDIRMA TEK İŞLEVDEN. `smtpYapilandirmasi()` dışarıya yalnız anahtar
 *    ADI verir; değer günlüğe / yanıta / dokümana yazılmaz. Eksikse bağlantı
 *    DENENMEZ (`{ ok: false, yapilandirilmamis: true }`).
 *
 * 2) SERTİFİKA DOĞRULAMASI KAPATILMAZ. `rejectUnauthorized: false` ve
 *    `NODE_TLS_REJECT_UNAUTHORIZED` bu modülde YASAK (çit: smtpPosta.test.ts,
 *    yorumları süzerek tarar). Doğrulama AÇIKÇA açık yazılır — ölçüm 2026-10-08
 *    (nodemailer 10.0.16, Node 24): süreçte `NODE_TLS_REJECT_UNAUTHORIZED=0`
 *    varken seçenek verilmeyen bağlantı kendinden imzalı sertifikayı KABUL edip
 *    kullanıcı adı + parolayı gönderdi; seçenek açıkça `true` iken reddetti.
 *    Düz metne düşüş de yok: kapı 465 değilse STARTTLS ZORUNLU (ölçüm: sunucu
 *    STARTTLS sunmayınca AUTH hiç gönderilmedi).
 *
 * 3) HATA METNİ DIŞARI ÇIKMAZ. `sendEmail`'in (Resend) ham sağlayıcı hata metni
 *    döndüren sözleşmesi ÖRNEK ALINMADI: SMTP hata iletisi sunucu yanıtını,
 *    alıcı adresini, sertifika ayrıntısını taşır. Dışarıya yalnız kapalı kümeden
 *    bir SINIF çıkar (`MAGAZA_BILDIRIM_HATA_SINIFLARI`). `smtpGonder` ve
 *    `smtpDogrula` ASLA fırlatmaz.
 */
import { createTransport } from 'nodemailer';
import type { SMTPTransportOptions, SendMailOptions } from 'nodemailer';
import type { MagazaBildirimHataSinifi } from '../lib/magazaTalep.js';
import { isValidEmail } from './eposta.js';

export type SmtpSonucu = { ok: true } | { ok: false; sinif: MagazaBildirimHataSinifi };

/** `SMTP_PORT` verilmediğinde: örtük TLS kapısı (posta sunucumuzun ölçülen kapısı). */
const VARSAYILAN_KAPI = 465;

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

/**
 * `smtpDogrula`'nın TOPLAM süre sınırı (bekçi: «10 sn sınır»). Adım sınırları tek
 * tek tutsa da toplamları 10 sn'yi aşabilir; doğrulama posta göndermediği için
 * beklemeyi bırakmak zararsızdır. `smtpGonder`'de toplam sınır YOK (bilerek):
 * nodemailer süren gönderimi iptal edemez — beklemeyi bırakıp «gitmedi» demek,
 * ileti aslında gittiğinde yeniden denemeyle ÇİFT posta üretirdi.
 */
export const SMTP_DOGRULAMA_SINIRI_MS = 10_000;

interface SmtpAyari {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
  alici: string;
}

/**
 * Kapı: yoksa / boşsa 465; verilmişse 1–65535 TAM sayı. Bozuksa `null` — sessizce
 * 465'e DÖNÜLMEZ (yanlış yazılmış kapı «yapılandırılmış» görünüp başka bir kapıya
 * bağlanmasın). `parseInt` KULLANILMAZ: '587abc' → 587 kabul ederdi.
 */
function kapiCoz(ham: string | undefined): number | null {
  const metin = (ham ?? '').trim();
  if (metin === '') return VARSAYILAN_KAPI;
  if (!/^\d{1,5}$/.test(metin)) return null;
  const kapi = Number(metin);
  return kapi >= 1 && kapi <= 65535 ? kapi : null;
}

/** Ortam değişkenlerini TEK yerde okur. `ayar` yalnız hiçbir anahtar eksik değilken dolu. */
function smtpAyarlari(ortam: NodeJS.ProcessEnv): { eksik: string[]; ayar: SmtpAyari | null } {
  const oku = (ad: string): string => (ortam[ad] ?? '').trim();
  const host = oku('SMTP_HOST');
  const port = kapiCoz(ortam.SMTP_PORT);
  const user = oku('SMTP_USER');
  // Parola KIRPILMAZ: baştaki / sondaki boşluk parolanın parçası olabilir.
  const pass = ortam.SMTP_PASS ?? '';
  const alici = oku('MAGAZA_BILDIRIM_ALICI');

  const eksik: string[] = [];
  if (!host) eksik.push('SMTP_HOST');
  if (port === null) eksik.push('SMTP_PORT');
  if (!user) eksik.push('SMTP_USER');
  if (!pass) eksik.push('SMTP_PASS');
  // Yazılmış ama e-posta biçiminde olmayan alıcı da «eksik»tir (gönderim zaten reddedilirdi).
  if (!isValidEmail(alici)) eksik.push('MAGAZA_BILDIRIM_ALICI');

  if (eksik.length > 0 || port === null) return { eksik, ayar: null };
  return { eksik, ayar: { host, port, user, pass, from: oku('SMTP_FROM') || user, alici } };
}

/** Yalnız anahtar ADI döner; değer asla günlüğe / yanıta yazılmaz. */
export function smtpYapilandirmasi(ortam: NodeJS.ProcessEnv = process.env): { tamam: boolean; eksik: string[] } {
  const { eksik } = smtpAyarlari(ortam);
  return { tamam: eksik.length === 0, eksik };
}

/** Bağlantı seçenekleri — güvenlik değişmezleri (dosya başı, madde 2) burada toplanır. */
function tasiyiciSecenekleri(a: SmtpAyari): SMTPTransportOptions {
  const ortukTls = a.port === VARSAYILAN_KAPI;
  return {
    host: a.host,
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
 * Kodlar nodemailer 10.0.16 `errors.d.ts` + ölçümden (yerel sahte sunucu, 2026-10-08):
 *   kimlik       EAUTH        — 5xx (535 «Invalid login») ya da yanıt kodsuz (eksik kimlik bilgisi)
 *                ENOAUTH      — kimlik bilgisi hiç verilmedi (yalnız `forceAuth` ile; bu modül her zaman verir)
 *   alici-reddi  EENVELOPE    — MAIL FROM / RCPT TO / DATA komutunun 5xx ya da yanıt kodsuz reddi; ayrıca kodsuz hatada RCPT TO'ya 5xx
 *   tls          ETLS         — STARTTLS sunulmuyor / yükseltilemedi; ya da soket hatasında TLS izi
 *                EREQUIRETLS  — RFC 8689 uzantısı (bu modül istemez; kod adı gereği TLS sınıfı)
 *   baglanti     ECONNECTION / ETIMEDOUT / ESOCKET / EDNS
 *   diger        kalan her şey (EMESSAGE: ileti gövdesinin reddi, EPROTOCOL, kodsuz hata, hata olmayan değer)
 *                + EAUTH / ENOAUTH / EENVELOPE hatasında 4xx yanıt (aşağıda)
 *
 * 4xx YANIT GEÇİCİDİR (inceleme turu kararı 2026-10-08). `kimlik` ve `alici-reddi` çağıranda
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
    const yanitKodu = alan(hata, 'responseCode');
    const gecici = typeof yanitKodu === 'number' && yanitKodu >= 400 && yanitKodu <= 499;
    if (kod === 'EAUTH' || kod === 'ENOAUTH') return gecici ? 'diger' : 'kimlik';
    if (kod === 'EENVELOPE') return gecici ? 'diger' : 'alici-reddi';
    if (alan(hata, 'command') === 'RCPT TO' && typeof yanitKodu === 'number' && yanitKodu >= 500 && yanitKodu <= 599) return 'alici-reddi';
    if (kod === 'ETLS' || kod === 'EREQUIRETLS') return 'tls';
    if (kod === 'EDNS' || kod === 'ETIMEDOUT') return 'baglanti';
    if (kod === 'ESOCKET' || kod === 'ECONNECTION') return tlsIzi(hata) ? 'tls' : 'baglanti';
    return 'diger';
  } catch {
    // Alan okuması fırlatan nesne (erişimci / vekil): sınıflama da fırlatmamalı.
    return 'diger';
  }
}

/** `MAGAZA_BILDIRIM_ALICI`'ya tek ileti. Asla fırlatmaz. Yapılandırma eksikse bağlantı DENEMEZ. */
export async function smtpGonder(ileti: { konu: string; html: string; metin: string }): Promise<SmtpSonucu | { ok: false; yapilandirilmamis: true }> {
  let tasiyici: SmtpTasiyici | null = null;
  try {
    const { ayar } = smtpAyarlari(process.env);
    if (!ayar) return { ok: false, yapilandirilmamis: true };
    tasiyici = createTransport(tasiyiciSecenekleri(ayar));
    await tasiyici.sendMail({
      from: ayar.from,
      // Nesne biçimi: adres ayrıştırıcısından GEÇMEZ (virgül / köşeli ayraç ikinci alıcı üretemez).
      to: { name: '', address: ayar.alici },
      subject: ileti.konu,
      text: ileti.metin,
      html: ileti.html,
    });
    return { ok: true };
  } catch (hata) {
    return { ok: false, sinif: smtpHataSinifi(hata) };
  } finally {
    sessizKapat(tasiyici);
  }
}

/** Bağlan + TLS + EHLO + AUTH; posta GÖNDERMEZ (bekçi). Asla fırlatmaz. */
export async function smtpDogrula(): Promise<SmtpSonucu | { ok: false; yapilandirilmamis: true }> {
  let tasiyici: SmtpTasiyici | null = null;
  let zamanlayici: ReturnType<typeof setTimeout> | undefined;
  try {
    const { ayar } = smtpAyarlari(process.env);
    if (!ayar) return { ok: false, yapilandirilmamis: true };
    tasiyici = createTransport(tasiyiciSecenekleri(ayar));
    const dogrulama = tasiyici.verify();
    const sureDoldu = new Promise<never>((_, reddet) => {
      zamanlayici = setTimeout(() => reddet(Object.assign(new Error('SMTP doğrulaması süre sınırını aştı'), { code: 'ETIMEDOUT' })), SMTP_DOGRULAMA_SINIRI_MS);
    });
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
