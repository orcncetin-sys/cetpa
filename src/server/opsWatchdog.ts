/**
 * opsWatchdog.ts - Operasyon Bekcisi + disk nobetcisi.
 *
 * server.ts'ten AYRILDI (2026-08-24). O dosya 12.754 satira ulasmisti ve
 * buyumeye devam ediyordu; bolunmesi acik teknik borctu.
 *
 * ILK CIKARILAN PARCA BU, cunku RISKI EN DUSUK olan: bekci istek yolunda
 * degil - iki cron ve tek bir okuma rotasi. Bozulsa bile uygulama hizmet
 * vermeye devam eder. Ayni desen (bagimliliklari acik parametreyle gecir,
 * yan etkileri init'te topla) sonraki cikarmalarda tekrarlanacak.
 *
 * BAGIMLILIKLAR NEDEN GETTER: `pgPool` ve `adminDb` server.ts'te sonradan
 * atanan `let` baglantilari. Deger olarak gecilseydi init aninda null
 * olurlardi. Getter ile her cagride guncel deger okunur ve veritabani
 * baslatma koduna HIC dokunmadan ayrilma yapilabildi.
 */
import { resendGonderici, resendSagligi } from './eposta.js';
import type { AdminDbLike } from './adminDbTypes.js';
import { zamanla, isGunu } from './zamanla.js';
// Mağaza talep kontrolünün okudukları. İkisi de bu modülü (ve server.ts'i) içe
// AKTARMAZ — döngü yok (ölçüldü 2026-10-08; çiti: opsWatchdog.magazaTalep.test.ts).
import { smtpYapilandirmasi, smtpDogrula } from './smtpPosta.js';
import { ortamdanKiraci } from './kiraciOrtami.js';
import { magazaSayaclari } from './routes/magazaRoutes.js';
import {
  MAGAZA_TALEP_KOLEKSIYONU, MAGAZA_BILDIRIM_BEKLEME_SINIRI_MS, MAGAZA_BILDIRIM_HATA_SINIFLARI,
  type MagazaBildirimHataSinifi,
} from '../lib/magazaTalep.js';
import fs from 'fs';
import path from 'path';
import tls from 'tls';
import pg from 'pg';

export interface OpsDeps {
  // Sorgu sonucu server.ts'teki kullanimla ayni gevseklikte: satirlar dinamik
  // JSONB gövdeleri tasiyor, dar bir tip burada yalnizca cast gurultusu uretir.
  getPgPool: () => { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> } | null;
  /** `any` DEGIL: yapisal tip, tip denetimini korur (bkz. adminDbTypes.ts). */
  getAdminDb: () => AdminDbLike | null;
  pgServerTimestamp: () => any;
  getMikroCreds: () => Promise<unknown>;
  /** Kur onbellegi - tazelik kontrolu icin. Sonradan atanan bir `let`, getter. */
  getCachedExchangeRates: () => { rates: Record<string, number>; source: string; updatedAt: string } | null;
  /** Gemini saglik sondasi. Rota katmani tarafindan atanir; null ise kontrol atlanir. */
  getAiHealthProbe: () => (() => Promise<{ ok: boolean; detail: string }>) | null;
  /**
   * Oturumsuz sunucu bağlamının kiracı çözümleyicisi (server.ts `serverTenantId`);
   * boş dizge = çözülemedi. Mağaza talep ucu AYNI çözümleyiciyle yazar: boşsa uç
   * 503 döner ve mağaza bunu görmez — bekçi buradan ölçer (`magaza_talep`).
   */
  serverTenantId: () => Promise<string>;
}

/** Kayit saklama sureleri. Hem bekci (asim var mi?) hem saklamaSuresiUygula
 *  (silme) bunu okur - tek kaynak. */
export const SAKLAMA_KURALLARI: Array<{ coll: string; gun: number }> = [
  { coll: 'clientErrors', gun: 90 },
  { coll: 'auditLog', gun: 730 },
];

let D: OpsDeps;

/**
 * Bagimliliklara guvenli erisim. `D` atanmadan bir islev cagrilirsa
 * `Cannot read properties of undefined` gibi ANLAMSIZ bir hata yerine ne
 * yapilmasi gerektigini SOYLEYEN bir hata verir.
 *
 * Bugun tum cagiranlar initOpsWatchdog'dan sonra kosuyor; bu koruma gelecek
 * icin: bu modul, server.ts'in kalan parcalarini ayirmak icin SABLON olarak
 * duruyor ve bir sonraki modul bunu kendi yuklenme aninda cagirirsa hata
 * kaynagini gostermeden coker.
 */
function deps(): OpsDeps {
  if (!D) throw new Error('opsWatchdog: initOpsWatchdog() cagrilmadan kullanilamaz.');
  return D;
}

export interface OpsCheckResult { key: string; ok: boolean; detail: string }

function opsToMs(v: unknown): number {
  if (!v) return 0;
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number') return v;
  if (typeof v === 'string') { const t = new Date(v).getTime(); return Number.isFinite(t) ? t : 0; }
  if (typeof v === 'object' && 'seconds' in (v as Record<string, unknown>)) return Number((v as Record<string, unknown>).seconds) * 1000;
  return 0;
}

// ── Mağaza sipariş talebi kontrolü (`magaza_talep`) ───────────────────────────
//
// NEDEN VAR: `POST /api/magaza/siparis-talebi` KİMLİKSİZ bir uçtur ve mağaza
// (www.cetpa.com.tr) yanıtı OKUMAZ. Uç 503'e düşerse ya da bildirim e-postası
// gitmezse müşteri «talebiniz alındı» görür, içeride kimse bir şey görmez —
// bu projenin en pahalı hata sınıfı (sessiz başarısızlık). Üç şey ölçülür,
// TEK sonuç üretilir:
//   (a) Yapılandırma — talep sayısından BAĞIMSIZ. SMTP anahtarı eksikse kırmızı
//       (her sabah kırmızı görünmesi gürültü değil kurulum eksiğidir; `uyari_hatti`
//       emsali). Tamsa bağlantı gerçekten denenir (posta GÖNDERİLMEZ).
//   (b) Sayım — ölçüt `updated_at` DEĞİL `data->>'olusturma'`: bildirim sonucu
//       yazılırken `updated_at` ilerler, eski talep «yeni» sayılırdı. Gitmeyen
//       bildirim (gönderilemedi / yapılandırılmamış / takılı bekleyen) YALNIZ son
//       7 günün talebindeyse kırmızıdır; daha eskisi ayrıntıda bilgi olarak sayılır.
//       Süresiz sayımda tek eski satır kontrolü kalıcı kırmızıda tutuyordu (satırı
//       kapatacak yol yok — «yeniden kuyruğa al» dilim 2) ve her sabahki aynı kırmızı
//       YENİ arızayı ayırt edilemez kılıyordu. Yaşı okunamayan satır «eski» sayılmaz.
//   (c) Kullanılabilirlik — kiracı çözülemiyorsa, çözülen kimlik hiçbir kiracıyla
//       eşleşmiyorsa (hayalet kiracı) ya da pg havuzu yoksa uç yazamaz. Uç süreç
//       başından beri 500 döndüyse de kırmızı (öbür uç sayaçları yalnız bilgidir).
//
// AYRINTIYA NE YAZILMAZ: kişisel veri, sır DEĞERİ, hata METNİ. Ayrıntı
// `opsChecks`'e kaydedilir ve uyarı e-postasıyla gider. Eksik anahtarın yalnız
// ADI, SMTP hatasının yalnız SINIFI, yakalanan hatanın yalnız KODU yazılır.

/** `smtpDogrula()` için bekçinin KENDİ üst sınırı: doğrulayıcının iç süre sınırları
 *  (bağlantı / karşılama / soket) art arda işleyebilir; bekçi koşusu ona takılmaz. */
const SMTP_DOGRULAMA_SINIRI_MS = 10_000;
const SURE_DOLDU = Symbol('süre doldu');
const GUN_MS = 86_400_000;
/**
 * Gitmeyen bildirimin KIRMIZI sayıldığı pencere (talebin `olusturma`sına göre); daha eskisi yalnız bilgidir.
 * Alt sınır teknik: bekçi günde bir koşar (24 saat) + kuyruğun yeniden deneme ufku (yaklaşık 2 saat) + kaçan bir koşu —
 * daha kısa pencere arızayı HİÇ kırmızı göstermeden düşürebilir. 7 gün: inceleme turu kararı (2026-10-08).
 * Pencere hiçbir satırı silmez / değiştirmez; talep sekmede «bildirim gönderilmedi» uyarısıyla görünmeye devam eder.
 */
const MAGAZA_BILDIRIM_KIRMIZI_PENCERESI_MS = 7 * GUN_MS;
/** `olusturma` bu sunucunun saatiyle yazılır; «şimdi»nin bu kadar ilerisi hâlâ geçerli zaman sayılır. */
const SAAT_TOLERANSI_MS = 5 * 60_000;

/**
 * `olusturma` kırmızı penceresinden KANITLI eski mi ($5 = pencerenin başı): sunucunun yazdığı biçimde (`toISOString()`) VE
 * $5'ten küçük. Eksik (NULL) ya da biçimsiz değer «eski» SAYILMAZ (`COALESCE(…, false)`) — yaşı okunamayan satır bilgiye
 * düşmez, kırmızıda kalır. Biçim denetimi ŞART: yalnız metin karşılaştırmasında boş dizge ya da '0' / '2020-bozuk' gibi
 * bir değer bayt sırasında eşikten «küçük» çıkar ve sessizce bilgiye düşerdi (ölçüldü 2026-10-08). Desende ters bölü YOK
 * (`[.]`, `[0-9]`): şablon dizgesi ters bölüyü yutardı.
 */
const PENCEREDEN_ESKI_SQL = `COALESCE((data->>'olusturma') COLLATE "C" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
              AND (data->>'olusturma') COLLATE "C" < $5, false)`;

/**
 * $1 koleksiyon · $2 «son 24 saat» eşiği · $3 bekleme eşiği · $4 üst sınır (şimdi + tolerans) ·
 * $5 kırmızı penceresinin başı (şimdi − MAGAZA_BILDIRIM_KIRMIZI_PENCERESI_MS).
 *
 * `olusturma` ISO-8601 UTC METİNDİR (`toISOString()`): aynı biçimdeki iki metnin
 * bayt sırası zaman sırasıdır; `COLLATE "C"` veritabanının dil sıralamasını devreden
 * çıkarır. Karşılaştırma BİLEREK metin: `::timestamptz` dönüşümü tek bozuk satırda
 * bütün sorguyu düşürürdü.
 *
 * «Bekleyen» = TAZE olduğu KANITLANAMAYAN `bekliyor`. `olusturma`sı eksik ya da
 * zaman olmayan satır bekleyen sayılır — bilinmeyen yaş sessizce «taze» sayılmaz.
 *
 * Kırmızıya giren üç sayım (`gonderilemedi`, `yapilandirilmamis`, `bekleyen`) pencereden KANITLI eski satırı saymaz;
 * o satırlar `eski_gitmeyen` sütununda toplanır (ayrıntıda bilgi). Gitmeyen her satır bu dört sütundan EN ÇOK birine
 * düşer (taze `bekliyor` hiçbirine). Yaşı okunamayan satır iki yönde de kanıtsızdır: ne «taze» ne «pencereden eski»
 * sayılır, kırmızıda kalır.
 */
const MAGAZA_TALEP_SAYIM_SQL = `
  SELECT count(*)::int AS toplam,
         (count(*) FILTER (WHERE (data->>'olusturma') COLLATE "C" BETWEEN $2 AND $4))::int AS son24,
         (count(*) FILTER (WHERE data->'bildirim'->>'durum' = 'gonderilemedi'
            AND NOT ${PENCEREDEN_ESKI_SQL}))::int AS gonderilemedi,
         (count(*) FILTER (WHERE data->'bildirim'->>'durum' = 'yapilandirilmamis'
            AND NOT ${PENCEREDEN_ESKI_SQL}))::int AS yapilandirilmamis,
         (count(*) FILTER (WHERE data->'bildirim'->>'durum' = 'bekliyor'
            AND NOT COALESCE((data->>'olusturma') COLLATE "C" BETWEEN $3 AND $4, false)
            AND NOT ${PENCEREDEN_ESKI_SQL}))::int AS bekleyen,
         (count(*) FILTER (WHERE data->'bildirim'->>'durum' IN ('gonderilemedi', 'yapilandirilmamis', 'bekliyor')
            AND ${PENCEREDEN_ESKI_SQL}))::int AS eski_gitmeyen
    FROM docs WHERE coll = $1`;

/**
 * Hayalet kiracı sorgusu. Kiracı kimliği = `companyId`, o yoksa kullanıcının kendi
 * kimliği (server.ts `getUserCompanyId` / `serverTenantId` ile AYNI formül). Davetle
 * katılmış bir kullanıcının kimliği kiracı DEĞİLDİR; ortam değişkenine o yazılmışsa
 * talepler kimsenin görmediği bir kiracıya düşer.
 */
const MAGAZA_KIRACI_ESLESME_SQL =
  "SELECT count(*)::int AS n FROM docs WHERE coll = 'users' AND COALESCE(NULLIF(data->>'companyId', ''), id) = $1";

/**
 * Hata nesnesinden YALNIZ kod ya da tür adı — İLETİ DEĞİL.
 * pg hata nesnesinin `message` / `detail` / `where` alanı JSON verisinden parça
 * taşıyabilir (mağaza talebinde ad, telefon, adres). pg: SQLSTATE (`42P01`);
 * Node: `ECONNREFUSED` vb. Desene uymayan değer yazılmaz.
 */
function hataKodu(e: unknown): string {
  const guvenli = (v: unknown): string | null =>
    typeof v === 'string' && /^[A-Za-z0-9_]{1,40}$/.test(v) ? v : null;
  if (typeof e !== 'object' || e === null) return 'bilinmeyen hata';
  const h = e as { code?: unknown; name?: unknown };
  return guvenli(h.code) ?? guvenli(h.name) ?? 'bilinmeyen hata';
}

/** Ortam değişkeni ADI biçiminde olmayan değer ayrıntıya girmez (`ANAHTAR=değer` gibi bir metin sızmasın). */
function ortamAnahtarAdi(ad: unknown): string {
  return typeof ad === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(ad) ? ad : '?';
}

/** Kapalı kümenin ayrıntıdaki karşılığı. Kümede OLMAYAN değer (ör. yanlışlıkla hata metni) «diğer» yazılır. */
const SMTP_HATA_SINIFI_ETIKETI: Record<MagazaBildirimHataSinifi, string> = {
  kimlik: 'kimlik doğrulama', tls: 'TLS / sertifika', baglanti: 'bağlantı', 'alici-reddi': 'alıcı reddi', diger: 'diğer',
};
function smtpSinifEtiketi(sinif: unknown): string {
  const bilinen = MAGAZA_BILDIRIM_HATA_SINIFLARI.find(s => s === sinif);
  return SMTP_HATA_SINIFI_ETIKETI[bilinen ?? 'diger'];
}

/** Sayım hücresi: eksi olmayan tam sayı; başka her şey BİLİNMİYOR (`null`) — sıfır DEĞİL. */
function sayimHucresi(satir: unknown, ad: string): number | null {
  if (typeof satir !== 'object' || satir === null) return null;
  const v = (satir as Record<string, unknown>)[ad];
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null;
}
const sayiYaz = (n: number | null): string => (n === null ? '—' : String(n));

/** `soz` süre içinde bitmezse `SURE_DOLDU`. Geç gelen ret yakalanmamış kalmaz (`race` dinliyor). */
async function sureSinirli<T>(soz: Promise<T>, ms: number): Promise<T | typeof SURE_DOLDU> {
  let zamanlayici: ReturnType<typeof setTimeout> | undefined;
  const sinir = new Promise<typeof SURE_DOLDU>(coz => { zamanlayici = setTimeout(() => coz(SURE_DOLDU), ms); });
  try { return await Promise.race([soz, sinir]); } finally { clearTimeout(zamanlayici); }
}

/** `magazaSayaclari()` anahtarları (sözleşme: routes/magazaRoutes.ts) ve ayrıntıdaki karşılıkları. */
const MAGAZA_SAYAC_ETIKETLERI: ReadonlyArray<readonly [anahtar: string, etiket: string]> = [
  ['eklenen', 'eklenen'], ['cakisan', 'çakışan'],
  ['r400', '400'], ['r403', '403'], ['r404', '404'], ['r413', '413'], ['r415', '415'],
  ['r429', '429'], ['r500', '500'], ['r503', '503'],
];

async function magazaTalepKontrolu(): Promise<{ ok: boolean; detail: string }> {
  const parcalar: Array<{ ok: boolean; metin: string }> = [];
  const havuz = deps().getPgPool();

  // (c) Kullanılabilirlik. Uç pg havuzu yokken `adminDb`'ye DÜŞMEZ, 503 döner.
  if (!havuz) parcalar.push({ ok: false, metin: 'PG HAVUZU YOK — mağaza ucu 503 döner (talep yazılmaz); sayım yapılamadı' });
  try {
    const kimlik = await deps().serverTenantId();
    if (typeof kimlik !== 'string' || kimlik === '') {
      parcalar.push({ ok: false,
        metin: 'KİRACI ÇÖZÜLEMİYOR — mağaza ucu 503 döner ve mağaza bunu görmez (sunucuda SERVER_TENANT_COMPANY_ID tanımlı mı?)' });
    } else if (havuz) {
      // Kimlik ayrıntıya YAZILMAZ; uçla aynı değer (kırpılmadan) sorgulanır.
      const { rows } = await havuz.query(MAGAZA_KIRACI_ESLESME_SQL, [kimlik]);
      const eslesen = sayimHucresi(rows[0], 'n');
      if (eslesen === null) parcalar.push({ ok: false, metin: 'kiracı eşleşmesi OKUNAMADI' });
      else if (eslesen === 0) {
        parcalar.push({ ok: false,
          // Hayalet yalnız ortam değişkeninden gelebilir: `users` taramasından çözülen kimlik tanım gereği eşleşir.
          metin: 'HAYALET KİRACI — çözülen kiracı kimliği `users` içinde hiçbir kiracıyla eşleşmiyor; talepler kimsenin görmediği kiracıya yazılır (SERVER_TENANT_COMPANY_ID, o yoksa MIKRO_CRON_COMPANY_ID değerini kontrol et)' });
      } else if (ortamdanKiraci() === '') {
        // Kimlik ortam değişkeninden DEĞİL `users` taramasından geldi (tek kiracı). Bugün çalışır; kayıt açık olduğu için davetsiz
        // ikinci bir hesap açıldığı an kiracı belirsizleşir ve uç 503 döner — o an değil, bugünden görünmeli (kurulum eksiği).
        parcalar.push({ ok: false,
          metin: 'KİRACI TARAMAYLA ÇÖZÜLÜYOR — SERVER_TENANT_COMPANY_ID tanımlı değil; ikinci bir hesap açıldığı an mağaza ucu 503 döner ve mağaza bunu görmez' });
      } else parcalar.push({ ok: true, metin: 'kiracı çözüldü' });
    }
  } catch (e) {
    parcalar.push({ ok: false, metin: `kiracı kontrol edilemedi (${hataKodu(e)})` });
  }

  // (a) Yapılandırma + günde bir bağlantı doğrulaması (bağlan + TLS + EHLO + AUTH).
  try {
    const yapi = smtpYapilandirmasi();
    if (!yapi.tamam) {
      const adlar = yapi.eksik.map(ortamAnahtarAdi).join(', ');
      parcalar.push({ ok: false, metin: `SMTP yapılandırılmamış — eksik: ${adlar || 'anahtar adı bildirilmedi'}` });
    } else {
      const sonuc = await sureSinirli(smtpDogrula(), SMTP_DOGRULAMA_SINIRI_MS);
      if (sonuc === SURE_DOLDU) {
        parcalar.push({ ok: false,
          metin: `SMTP doğrulaması BAŞARISIZ — hata sınıfı: ${SMTP_HATA_SINIFI_ETIKETI.baglanti} (${SMTP_DOGRULAMA_SINIRI_MS / 1000} sn içinde yanıt yok)` });
      } else if (sonuc.ok === true) parcalar.push({ ok: true, metin: 'SMTP hazır (bağlantı ve kimlik doğrulandı)' });
      else if ('yapilandirilmamis' in sonuc) parcalar.push({ ok: false, metin: 'SMTP yapılandırılmamış' });
      else parcalar.push({ ok: false, metin: `SMTP doğrulaması BAŞARISIZ — hata sınıfı: ${smtpSinifEtiketi(sonuc.sinif)}` });
    }
  } catch (e) {
    parcalar.push({ ok: false, metin: `SMTP kontrol edilemedi (${hataKodu(e)})` });
  }

  // (b) Sayım. Kırmızı penceresindeki (son 7 gün ya da yaşı okunamayan) üç gitmeyen sayısından biri > 0 ise kırmızı;
  // pencereden eski gitmeyenler yalnız bilgi. Okunamayan sayı (bilgi sütunu dâhil) da kırmızıdır.
  if (havuz) {
    try {
      const simdi = Date.now();
      const { rows } = await havuz.query(MAGAZA_TALEP_SAYIM_SQL, [
        MAGAZA_TALEP_KOLEKSIYONU,
        new Date(simdi - GUN_MS).toISOString(),
        new Date(simdi - MAGAZA_BILDIRIM_BEKLEME_SINIRI_MS).toISOString(),
        new Date(simdi + SAAT_TOLERANSI_MS).toISOString(),
        new Date(simdi - MAGAZA_BILDIRIM_KIRMIZI_PENCERESI_MS).toISOString(),
      ]);
      const satir: unknown = rows[0];
      const toplam = sayimHucresi(satir, 'toplam');
      const son24 = sayimHucresi(satir, 'son24');
      const gonderilemedi = sayimHucresi(satir, 'gonderilemedi');
      const yapilandirilmamis = sayimHucresi(satir, 'yapilandirilmamis');
      const bekleyen = sayimHucresi(satir, 'bekleyen');
      const eskiGitmeyen = sayimHucresi(satir, 'eski_gitmeyen');
      const okunamadi = [toplam, son24, gonderilemedi, yapilandirilmamis, bekleyen, eskiGitmeyen].some(n => n === null);
      // `eskiGitmeyen` BİLEREK bu dizide yok: pencereden eski satır kırmızı yapmaz.
      const gitmeyen = [gonderilemedi, yapilandirilmamis, bekleyen].some(n => n !== null && n > 0);
      parcalar.push({ ok: !okunamadi && !gitmeyen,
        metin: `${sayiYaz(toplam)} talep, son 24 saatte ${sayiYaz(son24)}`
          + ` — bildirim: gönderilemedi ${sayiYaz(gonderilemedi)}, yapılandırılmamış ${sayiYaz(yapilandirilmamis)}`
          + `, ${MAGAZA_BILDIRIM_BEKLEME_SINIRI_MS / 60_000} dk+ bekleyen ${sayiYaz(bekleyen)}`
          + `, ${MAGAZA_BILDIRIM_KIRMIZI_PENCERESI_MS / GUN_MS} günden eski gitmeyen ${sayiYaz(eskiGitmeyen)} (bilgi)`
          + (okunamadi ? ' (SAYIM OKUNAMADI)' : '') });
    } catch (e) {
      parcalar.push({ ok: false, metin: `sayım yapılamadı (${hataKodu(e)})` });
    }
  }

  // Uç sayaçları: süreç belleğinde, yeniden başlatmada sıfırlanır. 500 DIŞINDAKİLER yalnız bilgi
  // (eşik yok — alarm eşiği kullanıcı kararı); okuyucu fırlatırsa kırmızı.
  try {
    const sayaclar: unknown = magazaSayaclari();
    // 500'ün zararsız açıklaması yok: şemadan geçmiş talep yazılamadı (ya da zincir beklenmedik hata verdi) ve mağaza yanıtı
    // okumadı. Kırmızı YAPIŞKANDIR: sayaç süreç yeniden başlayana kadar sıfırlanmaz. Okunamayan (`null`) 500 sayacı burada
    // kırmızı yapmaz; aşağıdaki bilgi satırında «—» görünür.
    const r500 = sayimHucresi(sayaclar, 'r500');
    if (r500 !== null && r500 > 0) {
      parcalar.push({ ok: false,
        metin: `UÇ ${r500} KEZ 500 DÖNDÜ (süreç başından beri) — talep yazılamadı, mağaza bunu görmez; süreç günlüğünde «[magaza]» satırlarına bak` });
    }
    parcalar.push({ ok: true,
      metin: 'uç sayaçları (süreç başından beri) — '
        + MAGAZA_SAYAC_ETIKETLERI.map(([anahtar, etiket]) => `${etiket}: ${sayiYaz(sayimHucresi(sayaclar, anahtar))}`).join(', ') });
  } catch (e) {
    parcalar.push({ ok: false, metin: `uç sayaçları okunamadı (${hataKodu(e)})` });
  }

  // Bozuk parçalar başa: uyarı e-postasında satırın ilk okunan yeri neden olsun.
  const sirali = [...parcalar.filter(p => !p.ok), ...parcalar.filter(p => p.ok)];
  return { ok: parcalar.every(p => p.ok), detail: sirali.map(p => p.metin).join(' · ') };
}

export async function runOpsWatchdog(): Promise<{ date: string; ok: boolean; checks: OpsCheckResult[]; stockRatio: number | null }> {
  const checks: OpsCheckResult[] = [];
  // Kontrol SAYISINI yoruma / metne ELLE YAZMA (her eklemede bayatlar), ölç:
  //   grep -oE "add\('[a-z_]+'" src/server/opsWatchdog.ts | sort -u | wc -l
  const add = (key: string, ok: boolean, detail: string) => { checks.push({ key, ok, detail }); };
  const hoursAgo = (t: number) => (Date.now() - t) / 3_600_000;

  // 1) Offsite yedek tazeliği — KİRACI BAZINDA (2026-08-21).
  //
  // Eskiden tek bir Firebase Storage bucket'ı listeleniyordu, çünkü yedek de
  // tekti (tüm kiracılar birlikte). Artık her kiracı KENDİ rclone remote'una
  // yedekleniyor, dolayısıyla tek bir yer listelemek anlamsız — kontrol
  // backupConfigs'teki her kiracının SON KOŞU damgasına bakıyor.
  //
  // KURULUM YAPMAMIŞ KİRACI DA ARIZADIR: "yedeklendiğini sanan ama
  // yedeklenmeyen müşteri" bu projedeki en pahalı hata sınıfının (sessiz
  // başarısızlık) tam örneği. O yüzden ayrıca sayılıp FAIL üretiyor.
  try {
    const havuz = deps().getPgPool();
    if (!havuz) add('backup_tenants', true, 'deps().getPgPool() yok, atlandı');
    else {
      const { rows: kiracilar } = await havuz.query(
        "SELECT DISTINCT data->>'companyId' AS cid FROM docs WHERE data ? 'companyId' AND data->>'companyId' <> ''",
      );
      const { rows: ayarlar } = await havuz.query(
        "SELECT data FROM docs WHERE coll = 'backupConfigs'",
      );
      const ayarMap = new Map(
        ayarlar.map((r: { data: Record<string, unknown> }) => [String(r.data.companyId ?? ''), r.data]),
      );

      const kurulumYok: string[] = [];
      const bayat: string[] = [];
      const hatali: string[] = [];
      let taze = 0;

      for (const { cid } of kiracilar as Array<{ cid: string }>) {
        const a = ayarMap.get(cid);
        const remote = a?.rcloneRemote as string | undefined;
        if (!remote || !String(remote).includes(':')) { kurulumYok.push(cid); continue; }
        if (a?.enabled === false) continue;              // bilerek kapatılmış
        if (a?.lastStatus === 'error') { hatali.push(cid); continue; }
        const son = opsToMs(a?.lastRunAt);
        if (!son || hoursAgo(son) >= 26) bayat.push(cid); else taze++;
      }

      const sorunlu = kurulumYok.length + bayat.length + hatali.length;
      const detay = [
        `${taze} kiracı taze`,
        kurulumYok.length ? `${kurulumYok.length} KURULUM YOK (${kurulumYok.slice(0, 3).join(', ')}${kurulumYok.length > 3 ? '…' : ''})` : '',
        bayat.length ? `${bayat.length} BAYAT/hiç koşmamış (${bayat.slice(0, 3).join(', ')}${bayat.length > 3 ? '…' : ''})` : '',
        hatali.length ? `${hatali.length} HATA (${hatali.slice(0, 3).join(', ')}${hatali.length > 3 ? '…' : ''})` : '',
      ].filter(Boolean).join(' · ');
      add('backup_tenants', sorunlu === 0, detay || 'kiracı yok');
    }
  } catch (e) {
    add('backup_tenants', false, e instanceof Error ? e.message : String(e));
  }

  // 1b) KVKK saklama sureleri gercekten uygulaniyor mu?
  //
  // Cron'un kosmasi yetmez — silme sessizce basarisiz olursa (yetki, kilit,
  // sema degisikligi) musterilere VAAT EDILEN sure asilir ve kimse fark etmez.
  // Burada dogrudan VERIYE bakiyoruz: suresi gecmis kayit KALDI MI?
  try {
    const havuz = deps().getPgPool();
    if (!havuz) add('kvkk_saklama', true, 'deps().getPgPool() yok, atlandı');
    else {
      const asanlar: string[] = [];
      for (const { coll, gun } of SAKLAMA_KURALLARI) {
        const { rows } = await havuz.query(
          `SELECT count(*)::int AS n FROM docs WHERE coll = $1 AND updated_at < now() - ($2 || ' days')::interval`,
          [coll, String(gun)],
        );
        const n = rows[0]?.n ?? 0;
        if (n > 0) asanlar.push(`${coll}: ${n} kayıt >${gun} gün`);
      }
      add('kvkk_saklama', asanlar.length === 0,
        asanlar.length
          ? `SÜRESİ AŞAN KAYIT VAR — ${asanlar.join(' · ')} (KVKK metninde bu süreler müşteriye vaat ediliyor)`
          : SAKLAMA_KURALLARI.map(k => `${k.coll} ≤${k.gun}g`).join(' · '));
    }
  } catch (e) { add('kvkk_saklama', false, e instanceof Error ? e.message : String(e)); }

  // 2) Mikro ayna tazeliği — saatlik sync mikro_stoklar.guncelleme'yi ilerletiyor mu?
  //    (Yaşanan arıza sınıfı: cron haftalarca "başarıyla" koşup veri yazmamıştı.)
  try {
    const creds = await deps().getMikroCreds();
    const havuz = deps().getPgPool();
    if (!creds) add('mikro_sync', true, 'Mikro yapılandırılmamış, atlandı');
    else if (!havuz) add('mikro_sync', false, 'deps().getPgPool() yok');
    else {
      const { rows } = await havuz.query('SELECT max(guncelleme) AS g, count(*)::int AS n FROM mikro_stoklar');
      const g = rows[0]?.g ? new Date(rows[0].g).getTime() : 0;
      if (!g) add('mikro_sync', false, 'mikro_stoklar boş — sync hiç yazmamış');
      else add('mikro_sync', hoursAgo(g) < 26, `${rows[0].n} kayıt, son güncelleme ${hoursAgo(g).toFixed(1)} saat önce`);
    }
  } catch (e) { add('mikro_sync', false, e instanceof Error ? e.message : String(e)); }

  // 3) Stok oranı çöküşü — stoklu ürün oranı bir gecede >30 puan düşerse alarm
  //    (2.347 ürünün "kritik stok" göründüğü stockLevel arızasının imzası).
  let stockRatio: number | null = null;
  try {
    const db = deps().getAdminDb();
    if (!db) add('stock_ratio', false, 'deps().getAdminDb() yok');
    else {
      const snap = await db.collection('inventory').get();
      const total = snap.docs.length;
      if (total === 0) add('stock_ratio', true, 'envanter boş, atlandı');
      else {
        const withStock = snap.docs.filter(d => Number((d.data() as Record<string, unknown>).stockLevel) > 0).length;
        stockRatio = withStock / total;
        const ydStr = isGunu(new Date(Date.now() - 86_400_000));   // dünün İstanbul günü (zamanla.ts)
        const prev = await db.collection('opsChecks').doc(ydStr).get();
        const prevRatio = prev.exists ? Number((prev.data() as Record<string, unknown>).stockRatio) : NaN;
        const drop = Number.isFinite(prevRatio) ? prevRatio - stockRatio : 0;
        add('stock_ratio', drop <= 0.3,
          `stoklu ürün %${(stockRatio * 100).toFixed(0)} (${withStock}/${total})` +
          (Number.isFinite(prevRatio) ? `, dün %${(prevRatio * 100).toFixed(0)}` : ', dünkü veri yok'));
      }
    }
  } catch (e) { add('stock_ratio', false, e instanceof Error ? e.message : String(e)); }

  // 4) Mikro retry kuyruğu — işlemci yalnız bir kullanıcı login'ken çalışır;
  //    24 saatten eski queued iş = kuyruk tıkalı, ölü iş birikimi = temizlik gerek.
  try {
    const db = deps().getAdminDb();
    if (!db) add('retry_queue', false, 'deps().getAdminDb() yok');
    else {
      const snap = await db.collection('syncJobs').get();
      let queued = 0, dead = 0, stuck = 0;
      for (const d of snap.docs) {
        const j = d.data() as Record<string, unknown>;
        if (j.status === 'dead') dead++;
        else if (j.status === 'queued' || j.status === 'in-progress') {
          queued++;
          const created = opsToMs(j.createdAt);
          if (created && hoursAgo(created) > 24) stuck++;
        }
      }
      add('retry_queue', stuck === 0 && dead <= 10, `bekleyen ${queued} (24s+ takılı ${stuck}), ölü ${dead}`);
    }
  } catch (e) { add('retry_queue', false, e instanceof Error ? e.message : String(e)); }

  // 5) Kur tazeliği — 30 dakikalık kur cron'u bellek önbelleğini ilerletiyor mu?
  // Tek anlik goruntu: getter sonradan atanan bir `let` okur, dort ayri
  // cagri kontrol ile mesaji farkli kur setlerinden uretebilirdi.
  const kurlar = deps().getCachedExchangeRates();
  if (!kurlar) add('exchange_rates', false, 'bellekte kur yok');
  else {
    const age = hoursAgo(opsToMs(kurlar.updatedAt));
    add('exchange_rates', age < 2, `USD ${kurlar.rates.USD ?? '?'} (${kurlar.source}, ${age.toFixed(1)} saat önce)`);
  }

  // 6) Bant genişliği self-testi — 2026-07-20 arızası: sunucunun TÜM ağ hattı
  //    ~40 KB/sn'ye düştü (sağlayıcı tarafı), uygulama bundle indiremediği için
  //    boot edemedi; küçük /api/health yanıtları ise "sağlıklı" göründü. Bu test
  //    gerçek veri akıtarak ölçer: Cloudflare'den 5 MB indir (8 sn bütçe) +
  //    1 MB yükle. Kendi signal'ımızı verdiğimiz için 30 sn'lik global fetch
  //    timeout'una takılmayız.
  try {
    const dlKBs = await (async () => {
      const ctrl = new AbortController();
      const t0 = Date.now();
      let bytes = 0;
      const timer = setTimeout(() => ctrl.abort(), 8000);
      try {
        const res = await fetch('https://speed.cloudflare.com/__down?bytes=5000000', { signal: ctrl.signal });
        const reader = res.body?.getReader();
        if (reader) for (;;) { const { done, value } = await reader.read(); if (done) break; bytes += value?.length ?? 0; }
      } catch { /* abort = 8 sn'lik ölçüm penceresi doldu; sayılan bayt yeterli */ }
      clearTimeout(timer);
      return bytes / Math.max(0.3, (Date.now() - t0) / 1000) / 1024;
    })();
    const upKBs = await (async () => {
      const t0 = Date.now();
      try {
        const res = await fetch('https://speed.cloudflare.com/__up', { method: 'POST', body: new Uint8Array(1_000_000), signal: AbortSignal.timeout(15000) });
        if (!res.ok) return -1; // uç arızası (4xx/5xx) — ağ sinyali değil, ölçümü atla
        void res.arrayBuffer().catch(() => {});
        return 1_000_000 / Math.max(0.2, (Date.now() - t0) / 1000) / 1024;
      } catch { return 0; } // timeout/bağlantı hatası = gerçek yavaşlık sinyali
    })();
    const fmt = (k: number) => k >= 1024 ? `${(k / 1024).toFixed(1)} MB/sn` : `${k.toFixed(0)} KB/sn`;
    add('bandwidth', dlKBs >= 512 && (upKBs === -1 || upKBs >= 256),
      `indirme ${fmt(dlKBs)}, ` + (upKBs === -1 ? 'yükleme ölçülemedi (uç hatası)' : `yükleme ${fmt(upKBs)}`) +
      ' — eşik ↓512/↑256 KB/sn; düşükse sağlayıcı (ODEA) hat sorunu olabilir');
  } catch (e) { add('bandwidth', false, e instanceof Error ? e.message : String(e)); }

  // 7) Gemini AI sağlığı — 2026-07-20 arızası: Google eski modellerin free-tier
  //    kotasını sıfırladı, her AI çağrısı 429 dönüyordu ama kimse fark etmedi
  //    ("Üzgünüm, şu an yanıt veremiyorum"). Günde 1 mini çağrıyla anahtar +
  //    model + kota üçünü birden doğrula. (Probe startServer'da kurulur.)
  try {
    const probe = deps().getAiHealthProbe();
    // PROBE YOKSA BU BİR ARIZADIR — 'atlandı' diye YEŞİL geçmez.
    // Eskiden `add('ai_gemini', true, ...)` idi: probe hiç kurulmamış olsa da
    // kontrol BAŞARILI görünüyordu, yani "izleme var sanılan yerde izleme
    // yok" sınıfı. Probe `aiRoutes(app, C)` çağrısında kurulur (server.ts) ve
    // bekçi startServer'dan saatler sonra koşar; o noktada null olması,
    // kayıt zincirinin kırıldığı anlamına gelir.
    if (!probe) add('ai_gemini', false, 'AI sağlık sondası KURULMAMIŞ — aiRoutes kaydı yapılmamış olabilir (setAiHealthProbe hiç çağrılmadı)');
    else { const r = await probe(); add('ai_gemini', r.ok, r.detail); }
  } catch (e) { add('ai_gemini', false, e instanceof Error ? e.message : String(e)); }

  // 8) SSL sertifika — kamuya SUNULAN sertifikanın kalan ömrü + host eşleşmesi.
  //    (Geçmiş arıza: Plesk default *.plesk.page sertifikası sunarken yeşil CI
  //    bunu haftalarca maskeledi.) rejectUnauthorized:false bilinçli — bozuk/
  //    uymayan sertifikayı hata yerine BULGU olarak raporlamak istiyoruz.
  try {
    const host = 'app.cetpa.com.tr';
    const cert = await new Promise<{ valid_to?: string; subject?: { CN?: string }; subjectaltname?: string }>((resolve, reject) => {
      const sock = tls.connect({ host, port: 443, servername: host, rejectUnauthorized: false, timeout: 8000 }, () => {
        const c = sock.getPeerCertificate();
        sock.end();
        resolve(c as never);
      });
      sock.on('error', reject);
      sock.on('timeout', () => { sock.destroy(); reject(new Error('TLS bağlantı zaman aşımı')); });
    });
    const days = cert.valid_to ? (new Date(cert.valid_to).getTime() - Date.now()) / 86_400_000 : 0;
    const cn = cert.subject?.CN ?? '';
    const san = cert.subjectaltname ?? '';
    const hostMatch = san.includes(host) || cn === host || san.includes('*.cetpa.com.tr') || cn === '*.cetpa.com.tr';
    add('ssl_cert', days > 14 && hostMatch,
      `${cn || 'CN?'} — ${days.toFixed(0)} gün kaldı` +
      (hostMatch ? '' : ` — SERTİFİKA ${host} İLE UYUŞMUYOR (Plesk default cert olabilir)`));
  } catch (e) { add('ssl_cert', false, 'TLS bağlantısı kurulamadı: ' + (e instanceof Error ? e.message : String(e))); }

  // 9) Disk doluluğu — yedekler (C:\cetpa\backups) + WAL + loglar birikirse
  //    PG yazamaz hale gelir; %8 veya 10 GB altı = müdahale zamanı.
  try {
    const st = await fs.promises.statfs(process.cwd());
    const totalGB = (Number(st.blocks) * Number(st.bsize)) / 1024 ** 3;
    const freeGB = (Number(st.bavail) * Number(st.bsize)) / 1024 ** 3;
    const freePct = totalGB > 0 ? (freeGB / totalGB) * 100 : 0;
    add('disk_space', freeGB > 10 && freePct > 8,
      `boş ${freeGB.toFixed(1)} GB / ${totalGB.toFixed(0)} GB (%${freePct.toFixed(0)}) — eşik: >10 GB ve >%8`);
  } catch (e) { add('disk_space', false, 'statfs başarısız: ' + (e instanceof Error ? e.message : String(e))); }

  // ── Mikro ayna tablolari olustu mu ────────────────────────────────────────
  //
  // NEDEN (2026-08-24): `initMikroTables()` MODUL YUKLENIRKEN kosuyor ve
  // hatasi `initDocsTable().catch(...)` tarafindan SESSIZ bir console.warn'a
  // ceviriliyor. D4 refactor'unde tam bu yol bir kez kirildi: init sirasi
  // yanlis oldugu icin tablolar olusmayacakti ve kimse fark etmeyecekti -
  // lokal boot testi de goremez, cunku lokalde DATABASE_URL yok ve o kod yolu
  // hic kosmuyor. Sessiz bir "tablo yok" durumu, Mikro verisinin yerel
  // aynasinin (off-server yedek + raporlama) tamamen bos kalmasi demek.
  try {
    const havuz = deps().getPgPool();
    if (!havuz) {
      add('mikro_ayna_tablolari', true, 'PG yok (Firestore yedek modu) - kontrol atlandi');
    } else {
      const { rows } = await havuz.query(
        `SELECT count(*)::int AS n FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name LIKE 'mikro\\_%'`,
      );
      const n = Number(rows[0]?.n ?? 0);
      add('mikro_ayna_tablolari', n > 0,
        n > 0 ? `${n} mikro_* tablosu mevcut`
              : 'HIC mikro_* tablosu YOK - initMikroTables() bootta sessizce basarisiz olmus olabilir '
                + '(service-err.log icinde "PostgreSQL init failed" ara)');
    }
  } catch (e) {
    add('mikro_ayna_tablolari', false, 'kontrol edilemedi: ' + (e instanceof Error ? e.message : String(e)));
  }

  // ── Veritabani super kullanici VARSAYILAN parolasi ────────────────────────
  //
  // NEDEN (2026-08-24): PostgreSQL bu kutuya Chocolatey ile `/Password:postgres`
  // ile kuruldu ve GECICI varsayilan parola hic degistirilmedi. Projenin kendi
  // RUNBOOK'u bunu iki ayri yerde yazmisti ("gecici postgres/postgres parolasini
  // guclu bir parolayla degistir" ve "gecici parola OLMADIGINI dogrula") — iki
  // ay boyunca kimse fark etmedi. Yazili bir talimat, KONTROL EDILMIYORSA
  // yapilmis sayilmaz; bu yuzden bekciye tasindi.
  //
  // Bu kontrol parola SAKLAMAZ. Yalnizca BILINEN-KOTU varsayilanla baglanmayi
  // dener: baglanti BASARILI olursa varsayilan hala yururlukte demektir ve
  // kontrol FAIL verir. Basarisiz olursa (beklenen durum) her sey yolundadir.
  // 5432 su an disariya kapali, yani uzaktan somurulemez; ama kutuda herhangi
  // bir yer edinen biri dogrudan veritabani super kullanicisi olur.
  try {
    const dbHost = process.env.PGHOST || 'localhost';
    const dbPort = Number(process.env.PGPORT || 5432);
    const deneme = new pg.Client({
      host: dbHost, port: dbPort, user: 'postgres', password: 'postgres',
      database: 'postgres', connectionTimeoutMillis: 4000,
    });
    let varsayilanGecerli = false;
    try {
      await deneme.connect();
      varsayilanGecerli = true;              // BAGLANDI => varsayilan parola hala aktif
      await deneme.end();
    } catch {
      varsayilanGecerli = false;             // reddedildi => beklenen, iyi
      try { await deneme.end(); } catch { /* zaten kapali */ }
    }
    add('db_default_password', !varsayilanGecerli,
      varsayilanGecerli
        ? "postgres super kullanicisi VARSAYILAN 'postgres' parolasiyla giris kabul ediyor — "
          + "ALTER USER postgres WITH PASSWORD '<guclu>' ile degistir (uygulama etkilenmez, o 'cetpa' ile baglaniyor)"
        : 'varsayilan super kullanici parolasi kullanimda degil');
  } catch (e) {
    add('db_default_password', false, 'kontrol edilemedi: ' + (e instanceof Error ? e.message : String(e)));
  }

  // 10) Client hata birikimi — son 24 saatte anormal frontend hatası =
  //     kullanıcıların yaşadığı ama bildirmediği kırıklık sinyali.
  try {
    const havuz = deps().getPgPool();
    if (!havuz) add('client_errors', true, 'deps().getPgPool() yok, atlandı');
    else {
      const { rows } = await havuz.query(
        "SELECT count(*)::int AS n FROM docs WHERE coll = 'clientErrors' AND updated_at > now() - interval '24 hours'");
      const n = rows[0]?.n ?? 0;
      add('client_errors', n <= 50, `son 24 saatte ${n} client hatası (eşik ≤50)`);
    }
  } catch (e) { add('client_errors', false, e instanceof Error ? e.message : String(e)); }

  // 11) Veritabanı büyüme anomalisi — docs satır sayısı bir günde 2×+ VE
  //     10k+ artarsa kaçak yazan döngü/sync var demektir (dünkü değer
  //     opsChecks'ten; stock_ratio ile aynı desen).
  let docsCount: number | null = null;
  try {
    const havuz = deps().getPgPool();
    if (!havuz) add('pg_growth', true, 'deps().getPgPool() yok, atlandı');
    else {
      const { rows } = await havuz.query("SELECT count(*)::int AS n, pg_total_relation_size('docs') AS b FROM docs");
      docsCount = rows[0]?.n ?? 0;
      const mb = Number(rows[0]?.b ?? 0) / 1024 ** 2;
      const yd2Str = isGunu(new Date(Date.now() - 86_400_000));   // dünün İstanbul günü (zamanla.ts)
      const db = deps().getAdminDb();
      const prev = db ? await db.collection('opsChecks').doc(yd2Str).get() : null;
      const prevCount = prev?.exists ? Number((prev.data() as Record<string, unknown>).docsCount) : NaN;
      const anomaly = Number.isFinite(prevCount) && prevCount > 0 && (docsCount ?? 0) > prevCount * 2 && (docsCount ?? 0) - prevCount > 10_000;
      add('pg_growth', !anomaly,
        `${docsCount} satır, ${mb.toFixed(0)} MB` +
        (Number.isFinite(prevCount) ? `, dün ${prevCount} satır` : ', dünkü veri yok (yarından itibaren kıyaslanır)'));
    }
  } catch (e) { add('pg_growth', false, e instanceof Error ? e.message : String(e)); }

  // Mağaza sipariş talebi: uç ayakta mı, bildirim gidiyor mu (bkz. magazaTalepKontrolu).
  try {
    const m = await magazaTalepKontrolu();
    add('magaza_talep', m.ok, m.detail);
  } catch (e) {
    // Ham hata iletisi YAZILMAZ (pg iletisi veri parçası taşıyabilir) — yalnız kod.
    add('magaza_talep', false, 'kontrol edilemedi: ' + hataKodu(e));
  }

  // UYARI HATTININ KENDİSİ. Diğer kontroller bir arızayı bulur; bu kontrol
  //     "bulduğunu HABER VEREBİLİYOR MUSUN?" sorusunu sorar. Bekçi postayı
  //     gönderemezse sonuç yalnızca aşağıdaki `console.warn`'dur — kimse görmez,
  //     yani izleme var sanılan yerde izleme YOKTUR. Bu kontrol de aynı e-postayla
  //     bildirilemez (tavuk-yumurta) ama süper-admin panelindeki bekçi kartında
  //     ve GET /api/ops/watchdog'da KIRMIZI görünür.
  //     Günde bir kez tek bir Resend /domains çağrısı — ai_gemini ile aynı desen.
  try {
    const alici = process.env.OPS_ALERT_EMAIL || process.env.REPORT_RECIPIENT_EMAIL;
    const durum = await resendSagligi();
    if (!alici) {
      add('uyari_hatti', false,
        'OPS_ALERT_EMAIL/REPORT_RECIPIENT_EMAIL tanımlı değil — bekçi arıza bulsa da haber veremez');
    } else {
      add('uyari_hatti', durum.ok, `${durum.detay} · alıcı: ${alici}`);
    }
  } catch (e) {
    add('uyari_hatti', false, 'kontrol edilemedi: ' + (e instanceof Error ? e.message : String(e)));
  }

  const d = new Date();
  const date = isGunu(d);   // opsChecks/<İstanbul günü> — tetik de İstanbul (zamanla.ts)
  const ok = checks.every(c => c.ok);
  try {
    const db = deps().getAdminDb();
    if (db) await db.collection('opsChecks').doc(date).set({ date, ok, checks, stockRatio, docsCount, ranAt: deps().pgServerTimestamp() });
  } catch (e) { console.warn('opsChecks yazılamadı:', e instanceof Error ? e.message : String(e)); }
  console.log(`Ops watchdog: ${ok ? 'PASS' : 'FAIL'} — ${checks.map(c => `${c.ok ? '+' : '!'}${c.key}`).join(' ')}`);
  return { date, ok, checks, stockRatio };
}
/** ── Disk nöbetçisi: SAATLİK, PostgreSQL'e BAĞIMSIZ ──────────────────────────
 *
 *  Neden ayrı: 2026-07-31'de disk %100 doldu (sistem-yönetimli sayfa dosyası
 *  şişti) ve uygulama tamamen yanıt veremez oldu. Bekçi'nin `disk_space`
 *  kontrolü doğru yazılmıştı ama HABER VEREMEDİ:
 *    - günde bir kez (08:30) koşuyor — saatler içinde dolan diski kaçırır
 *    - sonucu opsChecks'e PostgreSQL üzerinden yazıyor; disk dolunca PG de
 *      yanıt vermiyordu, yani izleme tam da izlediği şey bozulunca bozuluyordu
 *
 *  Bu nöbetçi hiçbir şey yazmaz, sadece doğrudan e-posta atar. İki eşik:
 *  uyarı (<%15) ve kritik (<%8). Aynı seviye için 6 saatte bir kez postalar —
 *  disk dolu kaldığı sürece dakikada bir posta atmasın.
 */
let diskUyariSon: { seviye: string; t: number } | null = null;

/**
 * DÖNDÜRÜLMÜŞ LOG DOSYALARINI BUDA — alanı deploy beklemeden geri al.
 *
 * NEDEN VAR (2026-08-24, üçüncü disk kesintisi):
 * Log büyümesine karşı iki önlem vardı ve İKİSİ DE alanı geri veremiyordu:
 *   1. NSSM `AppRotateFiles` dosyayı 50 MB'ta yeniden ADLANDIRIR — eskisini
 *      SİLMEZ. Yani 1 tane 1,6 GB'lık dosya yerine sınırsız sayıda 50 MB'lık
 *      dosya birikir. Daha yavaş dolar ama yine dolar.
 *   2. Logları silen TEK yer `deploy.ps1` — yani alan ancak DEPLOY ederken
 *      geri gelir. Disk dolduğunda ise deploy'un kendisi SSH adımında düşüyor
 *      (sunucu yanıt veremiyor), dolayısıyla temizlik tam gerektiği anda
 *      çalışamıyor. Kısır döngü: dolu disk → deploy yok → temizlik yok → dolu disk.
 *      Bu döngüyü bugüne kadar hep ELLE yeniden başlatma kırdı.
 * Bekçi de yalnız UYARIYORDU (e-posta), hiçbir şey silmiyordu.
 *
 * Bu işlev döngüyü içeriden kırar: bütçeyi aşan DÖNDÜRÜLMÜŞ dosyaları
 * eskiden yeniye siler. AKTİF dosyaya (service-err.log / service-out.log)
 * ASLA dokunmaz — NSSM onları açık tutuyor; silmek alanı geri vermez, yalnız
 * canlı günlüğü kaybettirir.
 */
const LOG_DIZINI     = process.env.CETPA_LOG_DIR || 'C:\\cetpa\\logs';
const LOG_BUTCE_MB   = Number(process.env.CETPA_LOG_BUDGET_MB || 500);

export async function donmusLoglariBuda(): Promise<{ silinen: number; kazanilanMB: number; hata?: string }> {
  try {
    if (!fs.existsSync(LOG_DIZINI)) return { silinen: 0, kazanilanMB: 0 };
    const adlar = await fs.promises.readdir(LOG_DIZINI);
    const aday: Array<{ yol: string; boyut: number; mtime: number }> = [];
    for (const ad of adlar) {
      // AKTİF log'u KORU: NSSM aktif dosyaları tam olarak bu iki adla tutar;
      // döndürülmüşler ada zaman damgası ekler (service-err-2026....log).
      if (ad === 'service-err.log' || ad === 'service-out.log') continue;
      if (!/\.log$/i.test(ad)) continue;
      const yol = path.join(LOG_DIZINI, ad);
      try {
        const st = await fs.promises.stat(yol);
        if (st.isFile()) aday.push({ yol, boyut: st.size, mtime: st.mtimeMs });
      } catch { /* okunamayanı atla */ }
    }
    const toplam = aday.reduce((t, a) => t + a.boyut, 0);
    const butce  = LOG_BUTCE_MB * 1024 * 1024;
    if (toplam <= butce) return { silinen: 0, kazanilanMB: 0 };

    aday.sort((a, b) => a.mtime - b.mtime);   // en ESKİ önce gider
    let kalan = toplam, silinen = 0, kazanilan = 0;
    for (const a of aday) {
      if (kalan <= butce) break;
      try {
        await fs.promises.unlink(a.yol);
        kalan -= a.boyut; kazanilan += a.boyut; silinen++;
      } catch { /* kilitliyse atla — bir sonraki turda dener */ }
    }
    if (silinen) {
      console.warn(`[log-budama] ${silinen} döndürülmüş log silindi, ${(kazanilan / 1e6).toFixed(0)} MB geri alındı.`);
    }
    return { silinen, kazanilanMB: kazanilan / 1e6 };
  } catch (e) {
    return { silinen: 0, kazanilanMB: 0, hata: e instanceof Error ? e.message : String(e) };
  }
}

export async function diskNobetcisi(zorla = false): Promise<{ freeGB: number; totalGB: number; freePct: number; seviye: string; postaDenendi: boolean; hata?: string }> {
  const bos = { freeGB: 0, totalGB: 0, freePct: 0, seviye: 'BILINMIYOR', postaDenendi: false };
  try {
    const st = await fs.promises.statfs(process.platform === 'win32' ? 'C:\\' : '/');
    const totalGB = (st.blocks * st.bsize) / 1e9;
    const freeGB  = (st.bavail * st.bsize) / 1e9;
    const freePct = totalGB > 0 ? (freeGB / totalGB) * 100 : 0;

    // ÖNCE TEMİZLE, SONRA KARAR VER: bekçi eskiden yalnız uyarıyordu ve
    // temizlik deploy'a bağlıydı (bkz. donmusLoglariBuda gerekçesi). Artık
    // sıkışma anında alanı KENDİ geri alıyor; hâlâ yetersizse uyarı gider.
    let budama = { silinen: 0, kazanilanMB: 0 } as { silinen: number; kazanilanMB: number; hata?: string };
    let freeGB2 = freeGB, freePct2 = freePct;
    if (freePct < 15) {
      budama = await donmusLoglariBuda();
      if (budama.silinen > 0) {
        try {
          const st2 = await fs.promises.statfs(process.platform === 'win32' ? 'C:\\' : '/');
          freeGB2  = (st2.bavail * st2.bsize) / 1e9;
          freePct2 = totalGB > 0 ? (freeGB2 / totalGB) * 100 : 0;
        } catch { /* yeniden ölçülemezse ilk ölçümle devam */ }
      }
    }

    const gercekSeviye = freePct2 < 8 ? 'KRITIK' : freePct2 < 15 ? 'UYARI' : 'OK';
    const seviye = zorla ? 'TEST' : gercekSeviye;
    if (!zorla && gercekSeviye === 'OK') { diskUyariSon = null; return { freeGB: freeGB2, totalGB, freePct: freePct2, seviye: gercekSeviye, postaDenendi: false }; }

    // Aynı seviyeyi 6 saatte bir kez bildir. (zorla=true bunu atlar — test yolu)
    const simdi = Date.now();
    if (!zorla && diskUyariSon && diskUyariSon.seviye === seviye && simdi - diskUyariSon.t < 6 * 3600_000) {
      return { freeGB: freeGB2, totalGB, freePct: freePct2, seviye, postaDenendi: false };
    }
    if (!zorla) diskUyariSon = { seviye, t: simdi };

    const mesaj = `Disk ${seviye}: boş ${freeGB2.toFixed(1)} GB / ${totalGB.toFixed(0)} GB (%${freePct2.toFixed(1)})`
      + (budama.silinen ? ` — ${budama.silinen} eski log silindi, ${budama.kazanilanMB.toFixed(0)} MB geri alındı`
         + ` (öncesi: %${freePct.toFixed(1)})` : '')
      + (budama.hata ? ` — ⚠ log budama hatası: ${budama.hata}` : '');
    console.error('[disk-nobetcisi]', mesaj);

    const resendKey = process.env.RESEND_API_KEY;
    const recipient = process.env.OPS_ALERT_EMAIL || process.env.REPORT_RECIPIENT_EMAIL;
    if (!resendKey || !recipient) {
      return { freeGB: freeGB2, totalGB, freePct: freePct2, seviye, postaDenendi: false,
               hata: `posta yolu yok (RESEND_API_KEY=${resendKey ? 'var' : 'YOK'}, alıcı=${recipient ? 'var' : 'YOK'})` };
    }

    const postaRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: resendGonderici(),
        to: [recipient],
        subject: zorla
          ? '✅ CETPA disk uyarı TESTİ — bu posta geldiyse uyarı yolu çalışıyor'
          : `${seviye === 'KRITIK' ? '🔴' : '⚠️'} CETPA sunucu diski: %${freePct.toFixed(0)} boş`,
        html: `<div style="font-family:-apple-system,Segoe UI,sans-serif">
          ${zorla ? '<p style="background:#e8f5e9;padding:8px 12px;border-radius:8px;color:#1b5e20"><b>Bu bir TESTTİR.</b> Elle tetiklendi; disk durumu normal olabilir. Bu postayı aldıysanız uyarı yolu çalışıyor demektir.</p>' : ''}
          <h2 style="margin:0 0 8px">Sunucu disk durumu</h2>
          <p style="font-size:15px"><b>${mesaj}</b></p>
          <p style="color:#555;font-size:13px">Disk dolduğunda PostgreSQL yazamaz ve uygulama tamamen durur
          (2026-07-31'de yaşandı). Bakılacaklar: <code>C:\\cetpa\\logs</code> boyutu,
          <code>pagefile.sys</code>, yedek klasörleri.</p>
          <p style="font-size:11px;color:#888">Saatlik otomatik kontrol. AI kullanılmaz.</p>
        </div>`,
      }),
    });
    // Resend YANITINI OKU. Sadece fetch'in patlamamasına bakmak, gönderilmemiş
    // postayı "gönderildi" saymaktır — doğrulanmamış alan adında Resend 403
    // döner ve eskiden bunu göremiyorduk (2026-07-31 testinde yakalandı).
    if (!postaRes.ok) {
      const govde = await postaRes.text().catch(() => '');
      const hata = `Resend HTTP ${postaRes.status}: ${govde.slice(0, 300)}`;
      console.error('[disk-nobetcisi] posta REDDEDİLDİ —', hata);
      return { freeGB: freeGB2, totalGB, freePct: freePct2, seviye, postaDenendi: false, hata };
    }
    return { freeGB: freeGB2, totalGB, freePct: freePct2, seviye, postaDenendi: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('[disk-nobetcisi] çalışamadı:', msg);
    return { ...bos, postaDenendi: false, hata: msg };
  }
}

// Saatte bir — Bekçi'den bağımsız, PostgreSQL gerektirmez.

/** ── KVKK saklama sureleri — VAAT EDILEN GERCEKTEN UYGULANIR ────────────────
 *
 * BULGU (2026-08-21): LegalModule'deki KVKK aydinlatma metni musterilere
 * saklama sureleri VAAT EDIYOR —
 *     "Hata kayitlari (clientErrors): 90 gun"
 *     "Denetim/erisim kayitlari (auditLog): 2 yil"
 * — ama bunlari silen HICBIR KOD YOKTU. Yani kamuya acik bir uyumluluk
 * iddiasi karsiliksizdi. KVKK acisindan "gerekli sureden uzun saklamama"
 * yukumlulugu ihlal ediliyordu; ayrica clientErrors kullanici e-postasi ve
 * gezinti yolu tasiyor, yani suresiz biriken bir kisisel veri yigini.
 *
 * TICARI KAYITLARA DOKUNULMAZ: fatura/siparis/cari 10 yil (VUK/TTK) — bu is
 * yalnizca yukaridaki IKI koleksiyonu temizler, baskasina genisletilmemeli.
 */

export async function runOpsWatchdogAndAlert(): Promise<void> {
  let result: Awaited<ReturnType<typeof runOpsWatchdog>>;
  try { result = await runOpsWatchdog(); } catch (e) { console.error('Ops watchdog hatası:', e); return; }

  const failing = result.checks.filter(c => !c.ok);
  const always = process.env.OPS_ALERT_ALWAYS === 'true';
  if (!failing.length && !always) return; // sessizlik = iyi haber

  const resendKey = process.env.RESEND_API_KEY;
  const recipient = process.env.OPS_ALERT_EMAIL || process.env.REPORT_RECIPIENT_EMAIL;
  if (!resendKey || !recipient) {
    console.warn(`Ops uyarısı gönderilemedi (RESEND_API_KEY/OPS_ALERT_EMAIL eksik). Bozuk: ${failing.map(c => c.key).join(', ') || 'yok'}`);
    return;
  }
  const esc = (s: string) => String(s).replace(/[<>&]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[ch] as string));
  const row = (c: { key: string; ok: boolean; detail: string }) =>
    `<tr><td style="padding:6px 10px;border-bottom:1px solid #eee;">${c.ok ? '✅' : '❌'} <b>${esc(c.key)}</b></td>` +
    `<td style="padding:6px 10px;border-bottom:1px solid #eee;color:#555;">${esc(c.detail)}</td></tr>`;
  const html = `<div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:640px">
    <h2 style="margin:0 0 4px">CETPA Operasyon Bekçisi — ${esc(result.date)}</h2>
    <p style="color:#666;margin:0 0 14px">${failing.length ? `<b style="color:#c00">${failing.length} kontrol başarısız</b>` : 'Tüm kontroller başarılı'}</p>
    <table style="border-collapse:collapse;width:100%;font-size:13px">
      ${failing.map(row).join('')}${failing.length && always ? '<tr><td colspan="2" style="height:10px"></td></tr>' : ''}
      ${always ? result.checks.filter(c => c.ok).map(row).join('') : ''}
    </table>
    <p style="font-size:11px;color:#888;margin-top:14px">Detay: Yönetim → süper-admin panelindeki Operasyon Bekçisi kartı. Bu e-posta sunucudan otomatik gönderildi (AI kullanılmaz).</p>
  </div>`;
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: resendGonderici(),
        to: [recipient],
        subject: failing.length
          ? `⚠️ CETPA: ${failing.length} kontrol başarısız (${failing.map(c => c.key).join(', ')})`
          : `✅ CETPA: tüm kontroller başarılı — ${result.date}`,
        html,
      }),
    });
    // Resend yanıtını oku — reddedilen postayı "gönderildi" saymak, izlemenin
    // sessiz kalmasının ta kendisidir (2026-07-31 dersi).
    if (!r.ok) {
      const govde = await r.text().catch(() => '');
      console.error(`Ops uyarısı REDDEDİLDİ — Resend HTTP ${r.status}: ${govde.slice(0, 300)}`);
      return;
    }
    console.log(`Ops uyarısı gönderildi → ${recipient} (bozuk: ${failing.length})`);
  } catch (err) {
    console.error('Ops uyarı e-postası gönderilemedi:', err);
  }
}

// In-memory token cache keyed by IDM email (invalidates if user changes creds)

/**
 * Bekciyi baslatir: bagimliliklari baglar ve zamanlanmis isleri kaydeder.
 * server.ts bunu bir kez cagirir. Yan etkiler (cron/setTimeout) modul
 * yuklenirken DEGIL, burada olusur - boylece modul test edilebilir kalir.
 */
export function initOpsWatchdog(d: OpsDeps): void {
  D = d;
  // Her sabah 08:30 İstanbul (zamanla.ts) — gece Mikro cron'ları (02:00/03:20/04:00
  // İstanbul) ve 08:15 saklama süresi bittikten sonra. Off-site yedek görevi
  // 03:30 SUNUCU-yerel saattedir; bekçi bir önceki yedeği en fazla ~19 saat
  // yaşında görür, 26 saatlik eşik tutar.
  zamanla('30 8 * * *', () => { void runOpsWatchdogAndAlert(); });
  zamanla('7 * * * *', () => { void diskNobetcisi(); });
  setTimeout(() => { void diskNobetcisi(); }, 30_000);
}
