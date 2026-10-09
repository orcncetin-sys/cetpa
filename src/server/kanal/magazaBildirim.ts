/**
 * magazaBildirim.ts — mağaza talebi e-posta bildirimi: içerik, kuyruk sözleşmesi, işçi.
 *
 * NEDEN VAR (kullanıcı kararı K2, 2026-10-08): her mağaza talebinde
 * `MAGAZA_BILDIRIM_ALICI`'ya bir e-posta gider — Resend ile DEĞİL, kendi posta
 * sunucumuzdan SMTP ile (`smtpPosta.ts`) ve KİŞİSEL VERİ İÇERMEDEN. Talebin
 * tamamı yalnız ERP'de (Siparişler → Mağaza Talepleri) görünür.
 *
 * BEŞ DEĞİŞMEZ:
 *
 * 1) İÇERİKTE KİŞİSEL VERİ YOK. Ad, firma (şahıs firmasında unvan = ad soyad),
 *    telefon, müşteri e-postası, adres, vergi no ve not e-postaya GİRMEZ. Giren
 *    serbest metin (il, kalem adı / stok kodu / marka) `escapeHtml` ile ve
 *    bağlantıya çevrilmeden basılır: modül ona `<a>` yazmaz; posta istemcisi
 *    KENDİLİĞİNDEN bağlamasın diye adres tetikleyicileri kırılır (`baglantisiz`)
 *    ve gövdeye «adreslere tıklamayın» uyarısı konur. Konu satırına yalnız
 *    DOĞRULANMIŞ talep no.
 *
 * 2) KUYRUK VERİSİ YALNIZ `{ talepId }`. Kuyruk tablosu `docs` dışındadır;
 *    saklama kuralları oraya uzanmaz. İşçi dokümanı YENİDEN okur.
 *
 * 3) ÇİFT POSTAYA KARŞI İKİ KORUMA — İKİSİ DE SINIRLI.
 *    (a) `bildirim.durum === 'gitti'` olan talep yeniden gönderilmez. Denetim
 *        OKUMA ANINDADIR: okuma ile gönderim arasında veritabanı kirası YOK.
 *    (b) Aynı talep aynı SÜREÇTE iki kez koşarsa (kuyruk + süreç içi yol; pg-boss'un
 *        süresi dolan işi yeniden vermesi) süreç içi sahiplenme kümesi
 *        (`gonderimde`) ikinci gönderimi geri çevirir. Yalnız TEK süreçte korur.
 *    Posta gittikten SONRA oluşan hiçbir hata «yeniden dene» üretmez.
 *    KORUNMAYAN: ikinci bir süreç aynı talebi aynı anda işlerse; posta gidip
 *    `gitti` YAZILAMAZSA (sonraki koşu dokümanda `gitti` göremez).
 *
 * 4) HATA METNİ DIŞARI ÇIKMAZ. Dokümana, günlüğe, fırlatılan hataya yalnız kapalı
 *    kümeden bir SINIF yazılır (`MAGAZA_BILDIRIM_HATA_SINIFLARI`). pg-boss
 *    fırlatılan hatanın iletisini iş satırına kaydeder — o yüzden işçinin
 *    fırlattığı hata SABİT iletilidir.
 *
 * 5) SONUÇ TEK SQL İLE YAZILIR (`jsonb_set`, yalnız `bildirim` alanı). pgShim
 *    `update` oku-birleştir-yaz yapar; dilim 2'de geç kalan bir deneme durum
 *    değişikliğini ezerdi.
 *
 * İşlevlerin hiçbiri fırlatmaz — tek istisna işçinin «yeniden dene» hatası
 * (pg-boss yeniden denemeyi ancak fırlatılan hatadan anlar).
 */
import { MAGAZA_BILDIRIM_HATA_SINIFLARI, MAGAZA_TALEP_KIMLIK_DESENI, MAGAZA_TALEP_KOLEKSIYONU, MAGAZA_TALEP_NO_DESENI } from '../../lib/magazaTalep.js';
import type { MagazaBildirim, MagazaBildirimHataSinifi, MagazaTalebi, MagazaTalepKalemi } from '../../lib/magazaTalep.js';
import { paraYaz } from '../../utils/currency.js';
import { tarihSaatYaz } from '../../utils/zaman.js';
import type { MagazaPgHavuzu } from '../routes/magazaRoutes.js';
import { escapeHtml } from '../eposta.js';
import { smtpGonder, smtpHataSinifi } from '../smtpPosta.js';
import { smtpDogrula, smtpYapilandirmasi } from '../smtpPosta.js';
import type { SmtpSonucu } from '../smtpPosta.js';

export const MAGAZA_BILDIRIM_KUYRUGU = 'magaza-talep-bildirimi';

/** İŞ başına `send` seçenekleri (kuyruk seçeneği var olan kuyruğu güncellemez). */
export const MAGAZA_BILDIRIM_IS_SECENEKLERI = {
  retryLimit: 8, retryDelay: 30, retryBackoff: true, retryDelayMax: 3600, expireInSeconds: 120,
} as const;

/**
 * İşçinin `work` seçenekleri. `includeMetadata` OLMADAN işe `retryCount` /
 * `retryLimit` gelmez; işçi hangi denemenin SON olduğunu bilemez ve işi tek
 * atımlık sayar (bkz. `magazaBildirimIscisi`).
 */
export const MAGAZA_BILDIRIM_ISCI_SECENEKLERI = { includeMetadata: true } as const;

/**
 * İşçinin «yeniden dene» için fırlattığı hatanın SABİT iletisi. pg-boss bu
 * iletiyi (ve yığın izini) iş satırının `output` alanına yazar: talep kimliği,
 * hata sınıfı, sunucu yanıtı ya da kişisel veri TAŞIMAZ.
 */
export const MAGAZA_BILDIRIM_YENIDEN_DENE_ILETISI = 'mağaza talebi bildirimi gönderilemedi; yeniden denenecek';

/** E-postada en çok bu kadar kalem SATIRI; fazlası «… ve N kalem daha» diye sayıyla yazılır. */
export const MAGAZA_BILDIRIM_KALEM_SINIRI = 50;

export interface MagazaBildirimDeps {
  getPgPool: () => MagazaPgHavuzu | null;
  broadcastDocChange: (coll: string, type: 'set' | 'delete', id: string, data?: unknown, kapsam?: { cid: string | null }) => void;
  /** `APP_URL`; yoksa ya da `https:` değilse e-postaya bağlantı KONMAZ. */
  appUrl?: () => string | undefined;
  simdi?: () => Date;
}

// ─────────────────────────────────────────────────────────────────────────────
// İçerik

/** ERP'de mağaza talepleri sekmesi. Bağlantıya talep no / kişisel veri KONMAZ. */
const ERP_YOLU = '/orders?kaynak=magaza';

const KAYIT_ZAMANI_BICIMI: Intl.DateTimeFormatOptions = {
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  // AÇIKÇA İstanbul: dilimsiz biçim süreç saatine bağlıdır (canlı sunucu 2026-09-24'e
  // kadar Pasifik dilimindeydi — bildirim 10 saat geri yazardı). Dilim adı düz yazılır
  // (acilisTani / trafikRoutes gibi): `zamanla.ts` sabiti bu modüle node-cron'u da yüklerdi.
  timeZone: 'Europe/Istanbul',
};

// Denetim karakterleri (C0 / C1) ve satır ayırıcılar tek satırlık alanda boşluğa iner.
// `talepEsle` kayıtta zaten temizler; burada İKİNCİ kez — düz metin bölümünde satır
// sonu, müşterinin yazdığı metni ayrı bir satır («Talep edilen toplam: …») gibi
// gösterirdi. Desen kaçışla yazılır (ham karakter değil). Türkçe harfe DOKUNMAZ.
const DENETIM_KARAKTERI = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]+/g;
const tekSatir = (v: unknown): string => (typeof v === 'string' ? v.replace(DENETIM_KARAKTERI, ' ').trim() : '');

/**
 * Posta istemcileri çıplak adresi KENDİSİ bağlantıya çevirir; modülün `<a>` yazmaması
 * yetmez (inceleme turu kararı 2026-10-08). Müşteri metnindeki BELİRSİZ OLMAYAN adres
 * tetikleyicileri görünür biçimde kırılır:
 *   «://»              → «[:]//»    şemalı adres (https://…, ftp://…)
 *   sözcük başı «www.» → «www[.]»   önünde harf / rakam yoksa; yazıldığı büyük-küçük harfle
 *   «@»                → «[at]»     e-posta adresi
 * Harf öncesi HER nokta KIRILMAZ: «Dr.Fixit», «DYO.ABC», «AKCALI-AKÇ.00325» gibi meşru
 * ürün adı / stok kodu postada AYNEN görünür (personel stok kodunu postadan kopyalar).
 * BİLİNEN SINIR: şemasız çıplak alan adı («kotu.example/x»), IP adresi ve telefon
 * numarası algılaması kırılmaz — onları gövdedeki uyarı cümlesi (`METIN_UYARISI`)
 * karşılar. Kırılmış yazımın gerçek posta istemcilerinde bağlantıya DÖNMEDİĞİ ölçülmedi
 * (gerçek posta sunucusuna gönderim yapılmadı).
 * ERP bağlantısı bu işlevden GEÇMEZ: adresi sunucu yapılandırmasından gelir.
 *
 * YAZIM NOTU: şema ayracında yalnız İKİ NOKTA değiştirilir (ardından iki eğik çizgi
 * geliyorsa) ve desen `\/{2}` ile yazılır — kod satırında art arda iki eğik çizgi
 * BULUNMAZ. Bulunsaydı kaynak çitlerinin yorum süzgeci (`yorumsuz`) satırın kalanını
 * yorum sanıp yutardı (çit: mikroImportArkaplan.degismez.test.ts §0d).
 */
const baglantisiz = (s: string): string => s
  .replace(/:(?=\/{2})/g, '[:]')
  .replace(/(?<![\p{L}\p{N}])(www)\./giu, '$1[.]')
  .replace(/@/g, '[at]');

/** Müşteri metni doğrulanmamıştır — HTML ve düz metin bölümünde AYNI tek cümle (kalemlerin hemen üstünde). */
const METIN_UYARISI = 'İl ve kalem metinleri mağaza ziyaretçisinden gelir, doğrulanmamıştır; içindeki adreslere tıklamayın.';

/**
 * Müşterinin yazdığı serbest metnin (il, kalem adı / stok kodu / marka) TEK kapısı: tek
 * satıra indir, adres tetikleyicilerini kır. Boş metin ekranda '—' (boş hücre «veri
 * gelmedi» ile «boş bırakıldı»yı ayırt ettirmez).
 */
const yaDaTire = (v: unknown): string => baglantisiz(tekSatir(v)) || '—';

/** Konuya / gövdeye yalnız DOĞRULANMIŞ talep no girer; desene uymayan değer HİÇ basılmaz. */
const dogrulanmisTalepNo = (v: unknown): string | null => (typeof v === 'string' && MAGAZA_TALEP_NO_DESENI.test(v) ? v : null);

/** `talepFiyat` bilinen bir sayı değilse kalemin fiyatı SORULACAKTIR (0 bilinen bir fiyattır). */
const fiyatSorulacakMi = (k: MagazaTalepKalemi): boolean => !(typeof k.talepFiyat === 'number' && Number.isFinite(k.talepFiyat));

/**
 * ERP bağlantısı: `new URL('/orders?kaynak=magaza', APP_URL)`. `APP_URL` yoksa,
 * çözülemiyorsa ya da `https:` değilse `null` — bağlantı KONMAZ (eski yedek adrese
 * düşülmez). Kimlik bilgisi taşıyan taban (`https://kullanici:parola@…`) da
 * reddedilir: e-postaya sızmasın.
 */
function erpBaglantisi(appUrl: string | undefined): string | null {
  if (typeof appUrl !== 'string' || appUrl.trim() === '') return null;
  try {
    const adres = new URL(ERP_YOLU, appUrl.trim());
    if (adres.protocol !== 'https:') return null;
    if (adres.username !== '' || adres.password !== '') return null;
    return adres.href;
  } catch {
    return null;
  }
}

const HUCRE = 'padding:6px 8px;border-bottom:1px solid #eee;vertical-align:top';
const BASLIK_HUCRESI = 'padding:6px 8px;border-bottom:2px solid #ddd;text-align:left';
const ISARET = 'display:inline-block;padding:1px 6px;border-radius:4px;background:#fef9c3;color:#854d0e;font-size:12px';

/** Kişisel veri İÇERMEYEN ileti (ad, firma, telefon, e-posta, adres, vergi no, not YOK). */
export function magazaBildirimIcerigi(talep: MagazaTalebi, o: { appUrl?: string }): { konu: string; html: string; metin: string } {
  const e = escapeHtml;
  const talepNo = dogrulanmisTalepNo(talep.talepNo);
  const konu = talepNo ? `Yeni mağaza talebi: ${talepNo}` : 'Yeni mağaza talebi';

  const zaman = typeof talep.olusturma === 'string' ? tarihSaatYaz(talep.olusturma, KAYIT_ZAMANI_BICIMI) : '—';
  const kayit = zaman === '—' ? '—' : `${zaman} (İstanbul saati)`;
  const il = yaDaTire(talep.musteri.il);

  const gosterilen = talep.kalemler.slice(0, MAGAZA_BILDIRIM_KALEM_SINIRI);
  const kalan = talep.kalemler.length - gosterilen.length;
  const kalanNotu = kalan > 0 ? `… ve ${kalan} kalem daha` : '';
  const satirlar = gosterilen.map((k) => ({
    sku: yaDaTire(k.sku),
    ad: yaDaTire(k.ad),
    marka: yaDaTire(k.marka),
    adet: typeof k.adet === 'number' && Number.isFinite(k.adet) ? k.adet.toLocaleString('tr-TR') : '—',
    fiyatSorulacak: fiyatSorulacakMi(k),
  }));

  // Toplam müşterinin sitede GÖRDÜĞÜ rakamdır (beyan); kalemlerden TÜRETİLMEZ.
  // Bilinmiyorsa '—' (₺0,00 değil). Fiyatı sorulacak kalem varsa toplam EKSİKTİR
  // ve tek başına basılmaz — sayı gösterilen 50 satırdan değil BÜTÜN kalemlerden.
  const toplam = paraYaz(talep.talepEdilen.toplam);
  const fiyatsiz = talep.kalemler.filter(fiyatSorulacakMi).length;
  const eksikNotu = fiyatsiz > 0 ? `eksik — ${fiyatsiz} kalemin fiyatı sorulacak`
    : talep.fiyatiSorulacakVar === true ? 'eksik — fiyatı sorulacak kalem var'
    : '';

  const baglanti = erpBaglantisi(o.appUrl);
  const yonlendirme = "Müşteri bilgileri bu e-postada yer almaz. Talebin tamamı ERP'de: Siparişler → Mağaza Talepleri.";

  const html = '<div lang="tr" style="font-family:-apple-system,Segoe UI,sans-serif;max-width:640px">'
    + `<h2 style="margin:0 0 4px">${e(konu)}</h2>`
    + `<p style="margin:0 0 12px;color:#555">Kayıt zamanı: ${e(kayit)} · İl: ${e(il)}</p>`
    + `<p style="margin:0 0 8px;color:#555;font-size:12px">${e(METIN_UYARISI)}</p>`
    + '<table style="border-collapse:collapse;width:100%;font-size:13px">'
    + `<tr><th style="${BASLIK_HUCRESI}">Stok kodu</th><th style="${BASLIK_HUCRESI}">Ürün</th><th style="${BASLIK_HUCRESI}">Marka</th><th style="${BASLIK_HUCRESI};text-align:right">Adet</th></tr>`
    + satirlar.map((s) => '<tr>'
      + `<td style="${HUCRE}">${e(s.sku)}</td>`
      + `<td style="${HUCRE}">${e(s.ad)}${s.fiyatSorulacak ? ` <span style="${ISARET}">fiyat sorulacak</span>` : ''}</td>`
      + `<td style="${HUCRE}">${e(s.marka)}</td>`
      + `<td style="${HUCRE};text-align:right">${e(s.adet)}</td>`
      + '</tr>').join('')
    + '</table>'
    + (kalanNotu ? `<p style="margin:8px 0 0;color:#555">${e(kalanNotu)}</p>` : '')
    + `<p style="margin:12px 0 0"><b>Talep edilen toplam</b> (müşterinin sitede gördüğü): ${e(toplam)}`
    + (eksikNotu ? ` <span style="${ISARET}">${e(eksikNotu)}</span>` : '') + '</p>'
    + `<p style="margin:12px 0 0;color:#555">${e(yonlendirme)}</p>`
    // Modülün YAZDIĞI tek bağlantı: adres sunucu yapılandırmasından gelir, müşteri metninden DEĞİL.
    // (İstemcinin müşteri metnini kendiliğinden bağlamasına karşı: `baglantisiz` + `METIN_UYARISI`.)
    + (baglanti ? `<p style="margin:8px 0 0"><a href="${e(baglanti)}">${e(baglanti)}</a></p>` : '')
    + '</div>';

  const metin = [
    konu,
    `Kayıt zamanı: ${kayit}`,
    `İl: ${il}`,
    '',
    METIN_UYARISI,
    `Kalemler (${talep.kalemler.length}):`,
    ...satirlar.map((s, i) => `${i + 1}. [${s.sku}] ${s.ad} · ${s.marka} · ${s.adet} adet${s.fiyatSorulacak ? ' · fiyat sorulacak' : ''}`),
    ...(kalanNotu ? [kalanNotu] : []),
    '',
    `Talep edilen toplam (müşterinin sitede gördüğü): ${toplam}${eksikNotu ? ` (${eksikNotu})` : ''}`,
    '',
    yonlendirme,
    ...(baglanti ? [baglanti] : []),
  ].join('\n');

  return { konu, html, metin };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tek talebin bildirimi

export type MagazaBildirimSonucu = 'gitti' | 'atlandi' | 'yapilandirilmamis' | 'yeniden-dene' | 'gonderilemedi';

/**
 * SÜREÇ İÇİ SAHİPLENME (dosya başı, madde 3b; inceleme turu kararı 2026-10-08): gönderimi
 * SÜREN talep kimlikleri. `magazaBildirimIsle` girişte sahiplenir, `finally`'de bırakır.
 *
 * NEDEN: dokümandaki `gitti` denetimi okuma anındadır; aynı talep aynı süreçte iki kez
 * koşarsa ikisi de `bekliyor` okur ve İKİ posta gider (sahte gönderici + sahte havuzla
 * gösterildi; canlıda üretilmedi). Buna götüren iki yol (kaynaktan okundu):
 *   · `send` fırlatıp işi yine de eklemişse kuyruk yolu ile süreç içi yol birlikte koşar;
 *   · pg-boss 12.26 süresi dolan (`expireInSeconds`) işin işleyicisini DURDURMAZ, yalnız
 *     beklemeyi bırakır ve işi yeniden verir — ilk gönderim hâlâ sürüyor olabilir
 *     (adım süre sınırlarının toplamı iş süresini aşabilir: `smtpPosta.ts`).
 *
 * NEDEN VERİTABANI KİRASI DEĞİL: sonuç yazımı başarısız olursa ya da süreç ölürse kira,
 * gecikmeyle gelen MEŞRU yeniden denemeyi engellerdi; «kiralı, gönderme» dalı işi
 * tamamlanmış sayarsa doküman kalıcı `bekliyor` kalırdı — yinelenen bildirimden kötü.
 *
 * SINIRLARI: (1) yalnız TEK süreçte korur (kurulum tek süreç: `deploy/windows/setup.ps1`
 * tek `nssm` hizmeti); ikinci süreç eklenirse yetmez. (2) Geri çevrilen kuyruk denemesi
 * bir deneme hakkı harcar. (3) SON denemesi geri çevrilen iş `atlandi` ile biter; sonucu
 * süren koşu yazar — o koşu başarısız olur ve kendisi son deneme değilse doküman
 * `bekliyor` kalır (10 dakikadan eski `bekliyor` ekranda ve bekçide uyarıdır).
 */
const gonderimde = new Set<string>();

const OKU_SQL = 'SELECT data FROM docs WHERE coll = $1 AND id = $2';
// TEK SQL: yalnız `bildirim` alanı değişir (dosya başı, madde 5). `gitti` ASLA ezilmez (orkestratör kararı 2026-10-08): aynı talep
// iki yerde birlikte koşarsa (ikinci süreç; tek süreçte `gonderimde` ikincisini zaten geri çevirir) geç kalan başarısız yazım,
// gitmiş postayı «gönderilemedi» gösterirdi. Koşul tutmazsa satır dönmez → yayın da olmaz.
const YAZ_SQL = "UPDATE docs SET data = jsonb_set(data, '{bildirim}', $3::jsonb), updated_at = now() WHERE coll = $1 AND id = $2 AND (data->'bildirim'->>'durum') IS DISTINCT FROM 'gitti' RETURNING data";

const nesneMi = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * İçeriğin OKUDUĞU kapların biçimi (dokümanın tamamı değil): `musteri`,
 * `talepEdilen` nesne, `kalemler` nesne dizisi. Tek tek alanlar içerikte ayrıca
 * süzülür (dizge değilse '—', sayı değilse '—').
 */
function icerigeYeterli(v: unknown): v is MagazaTalebi {
  if (!nesneMi(v) || !nesneMi(v.musteri) || !nesneMi(v.talepEdilen)) return false;
  return Array.isArray(v.kalemler) && v.kalemler.every(nesneMi);
}

/** İçerik; doküman bozuksa ya da üretim fırlatırsa `null` (gönderim DENENMEZ). */
function guvenliIcerik(belge: unknown, D: MagazaBildirimDeps): { konu: string; html: string; metin: string } | null {
  try {
    return icerigeYeterli(belge) ? magazaBildirimIcerigi(belge, { appUrl: D.appUrl?.() }) : null;
  } catch {
    return null;
  }
}

/**
 * Yeniden denemenin çözmeyeceği sınıflar: ilk başarısızlıkta `gonderilemedi` yazılır, kuyruk işi yeniden denenmez.
 * İki sınıf da yalnız 5xx ya da yanıt kodsuz hatayı taşır; aynı komutların 4xx (geçici) reddi `diger`dir (`smtpHataSinifi`).
 */
export const KALICI_HATA_SINIFLARI: ReadonlySet<MagazaBildirimHataSinifi> = new Set<MagazaBildirimHataSinifi>(['kimlik', 'gonderen-reddi', 'alici-reddi']);

/** Sınıf dokümana yazılmadan önce kapalı kümeye indirgenir (gönderici bozulsa da serbest metin yazılmaz). */
function kapaliKumeden(sinif: unknown): MagazaBildirimHataSinifi {
  return MAGAZA_BILDIRIM_HATA_SINIFLARI.find((s) => s === sinif) ?? 'diger';
}

/**
 * Veritabanı hatasından günlüğe yazılabilecek TEK parça: kod (SQLSTATE `57P01`,
 * ağ kodu `ECONNREFUSED`). Hata NESNESİ / iletisi yazılmaz — pg hata nesnesinin
 * `detail` / `where` alanı JSON verisinden parça taşır.
 */
function hataKodu(hata: unknown): string {
  try {
    const kod = nesneMi(hata) ? hata.code : undefined;
    return typeof kod === 'string' && /^[0-9A-Z_]{1,24}$/.test(kod) ? kod : 'yok';
  } catch {
    return 'yok';
  }
}

/**
 * `bildirim` alanını TEK SQL ile yazar; satır döndüyse akışa yayınlar. Asla
 * fırlatmaz: yazılamayan sonuç çağıranın döndürdüğü değeri DEĞİŞTİRMEZ (doküman
 * `bekliyor` kalır; 10 dakikadan eski `bekliyor` ekranda ve bekçide uyarıdır).
 */
async function sonucYaz(havuz: MagazaPgHavuzu, D: MagazaBildirimDeps, talepId: string, bildirim: MagazaBildirim): Promise<void> {
  let satir: unknown;
  try {
    const { rows } = await havuz.query(YAZ_SQL, [MAGAZA_TALEP_KOLEKSIYONU, talepId, JSON.stringify(bildirim)]);
    if (rows.length === 0) return;   // talep arada silinmiş ya da bildirim zaten `gitti`: yayın yok
    satir = rows[0].data;
  } catch (hata) {
    console.warn(`[magaza-bildirim] bildirim sonucu yazılamadı (kod: ${hataKodu(hata)})`);
    return;
  }
  // Kiracı etiketi OLMAYAN olay akışta BÜTÜN kiracılara gider (server.ts süzgeci
  // `ev.cid && ev.cid !== streamCid`); doküman müşteri verisi taşır — etiketsiz YAYINLANMAZ.
  const cid = nesneMi(satir) ? satir.companyId : undefined;
  if (typeof cid !== 'string' || cid === '') return;
  try {
    D.broadcastDocChange(MAGAZA_TALEP_KOLEKSIYONU, 'set', talepId, satir, { cid });
  } catch { /* yayın hatası sonucu değiştirmez */ }
}

/**
 * Tek talebin bildirimi: dokümanı oku → (yoksa / `gitti` ise atla) → gönder → sonucu TEK SQL ile yaz → yayınla.
 * `deneme.sonMu` yanlışken başarısızlık `'yeniden-dene'` döner (doküman `bekliyor` + deneme + hataSinifi);
 * doğruyken ya da `deneme` verilmemişken (süreç içi yol) `'gonderilemedi'`. Asla fırlatmaz.
 *
 * DÖNEN DEĞER GÖNDERİMİ anlatır, dokümanı değil:
 *   · kimlik biçimi bozuk, doküman yok, `gitti`          → 'atlandi' (gönderim yok)
 *   · aynı talebin gönderimi bu süreçte SÜRÜYOR          → yeniden denenebiliyorsa 'yeniden-dene', değilse 'atlandi'; doküman OKUNMAZ / YAZILMAZ (sonucu süren koşu yazar)
 *   · havuz yok / okuma hatası (posta GİTMEDİ)           → yeniden denenebiliyorsa 'yeniden-dene', değilse 'gonderilemedi'; doküman YAZILAMAZ
 *   · doküman bozuk, içerik üretilemedi                  → 'gonderilemedi' (yeniden deneme çözmez; `hataSinifi: 'diger'`)
 *   · posta gitti ama sonuç yazılamadı                   → 'gitti' — yeniden deneme ÇİFT posta olurdu
 *   · beklenmeyen hata                                   → posta gittiyse 'gitti', gitmediyse havuz yok satırıyla aynı
 */
export async function magazaBildirimIsle(talepId: string, D: MagazaBildirimDeps, deneme?: { sayi: number; sonMu: boolean }): Promise<MagazaBildirimSonucu> {
  let basarisiz: MagazaBildirimSonucu = 'gonderilemedi';
  let gitti = false;
  let sahip = false;
  try {
    if (typeof talepId !== 'string' || !MAGAZA_TALEP_KIMLIK_DESENI.test(talepId)) return 'atlandi';
    // Yeniden deneme YALNIZ kuyruk yolunda (deneme verilmiş) ve son deneme değilken.
    const yenidenDenenir = deneme !== undefined && !deneme.sonMu;
    if (yenidenDenenir) basarisiz = 'yeniden-dene';
    // Sahiplenme (`gonderimde`): aynı talebin gönderimi bu süreçte sürüyorsa İKİNCİ posta gitmesin. Kuyruk sonra yeniden
    // sorar (o zaman dokümanda sonucu görür); yeniden soramayacak çağrı (süreç içi yol / son deneme) sonucu süren koşuya bırakır.
    // OKUMADAN ÖNCE alınır (ilk `await`ten önce, eşzamanlı): okumadan sonra alınsaydı, süren koşu biterken bayat `bekliyor`
    // okumuş bir çağrı kümeyi boş bulur ve yine gönderirdi.
    if (gonderimde.has(talepId)) return yenidenDenenir ? 'yeniden-dene' : 'atlandi';
    gonderimde.add(talepId);
    sahip = true;
    // Deneme sayısı bilinmiyorsa alan YAZILMAZ (0 ya da uydurma sayı değil).
    const denemeSayisi = deneme !== undefined && Number.isInteger(deneme.sayi) && deneme.sayi > 0 ? deneme.sayi : undefined;
    const zaman = (): string => (D.simdi?.() ?? new Date()).toISOString();

    const havuz = D.getPgPool();
    if (!havuz) {
      console.warn('[magaza-bildirim] veritabanı havuzu yok — bildirim gönderilemedi');
      return basarisiz;
    }

    let belge: unknown;
    try {
      const { rows } = await havuz.query(OKU_SQL, [MAGAZA_TALEP_KOLEKSIYONU, talepId]);
      if (rows.length === 0) return 'atlandi';
      belge = rows[0].data;
    } catch (hata) {
      console.warn(`[magaza-bildirim] talep okunamadı (kod: ${hataKodu(hata)})`);
      return basarisiz;
    }
    // Çift posta olmasın: yeniden denenen iş ya da iki yoldan gelen istek, postası gitmiş talebi yeniden göndermesin.
    // Denetim OKUMA ANINDADIR — bu satırla gönderim arasında kira yok; aynı süreçteki eşzamanlı koşuyu yukarıdaki
    // sahiplenme geri çevirir, BAŞKA süreçteki eşzamanlı koşuyu hiçbir şey çevirmez (dosya başı, madde 3).
    if (nesneMi(belge) && nesneMi(belge.bildirim) && belge.bildirim.durum === 'gitti') return 'atlandi';

    const icerik = guvenliIcerik(belge, D);
    if (icerik === null) {
      console.warn('[magaza-bildirim] bildirim içeriği üretilemedi (doküman biçimi)');
      await sonucYaz(havuz, D, talepId, { durum: 'gonderilemedi', hataSinifi: 'diger', zaman: zaman() });
      return 'gonderilemedi';
    }

    // `smtpGonder` fırlatmaz; fırlatırsa da hata METNİ değil sınıfı alınır.
    const sonuc = await smtpGonder(icerik).catch((hata: unknown) => ({ ok: false as const, sinif: smtpHataSinifi(hata) }));

    if (sonuc.ok) {
      gitti = true;
      await sonucYaz(havuz, D, talepId, { durum: 'gitti', zaman: zaman() });
      return 'gitti';
    }
    if ('yapilandirilmamis' in sonuc) {
      // Yapılandırma eksik: bağlantı denenmedi; yeniden deneme çözmez (bekçi kırmızı gösterir).
      await sonucYaz(havuz, D, talepId, { durum: 'yapilandirilmamis', zaman: zaman() });
      return 'yapilandirilmamis';
    }

    const hataSinifi = kapaliKumeden(sonuc.sinif);
    // KALICI sınıflar yeniden DENENMEZ (orkestratör kararı 2026-10-08): yanlış parola (`kimlik`) ya da reddedilen alıcı
    // (`alici-reddi`) kendiliğinden düzelmez; talep başına 9 AUTH denemesi posta sunucusunda hesap kilidi / IP engeli tetikleyebilir.
    // Düzeltme yapılandırmadadır; bekçi kırmızı gösterir. Geçici sınıflar (bağlantı, tls, diğer) kuyruk yolunda yeniden denenir.
    // Sunucunun GEÇİCİ (4xx) reddi kalıcı sınıfa hiç girmez: `smtpHataSinifi` onu `diger`e indirir (450 / 451 / 452 / 454).
    const tekrarEdilir = yenidenDenenir && !KALICI_HATA_SINIFLARI.has(hataSinifi);
    await sonucYaz(havuz, D, talepId, {
      durum: tekrarEdilir ? 'bekliyor' : 'gonderilemedi',
      ...(denemeSayisi !== undefined ? { deneme: denemeSayisi } : {}),
      hataSinifi,
      zaman: zaman(),
    });
    if (!tekrarEdilir) console.warn(`[magaza-bildirim] bildirim gönderilemedi (sınıf: ${hataSinifi})`);
    return tekrarEdilir ? 'yeniden-dene' : 'gonderilemedi';
  } catch {
    // Buraya düşen hata beklenmeyendir; metni yazılmaz. Posta gittiyse yeniden deneme YOK.
    return gitti ? 'gitti' : basarisiz;
  } finally {
    // Sahiplenme HER çıkışta bırakılır (erken dönüş, hata); yalnız bu çağrı aldıysa — geri çevrilen çağrı süren koşununkini SİLMEZ.
    if (sahip) gonderimde.delete(talepId);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Kuyruk: işçi + istek

const sayacMi = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

/** İş verisinden talep kimliği; biçimi bozuksa `null`. `talepId` dışındaki alan OKUNMAZ. */
function istenTalepId(is: unknown): string | null {
  if (!nesneMi(is) || !nesneMi(is.data)) return null;
  const { talepId } = is.data;
  return typeof talepId === 'string' && MAGAZA_TALEP_KIMLIK_DESENI.test(talepId) ? talepId : null;
}

let metaUyarisiVerildi = false;

/**
 * pg-boss sayacından deneme bilgisi. Ölçüm (pg-boss 12.26 `plans.js`): `retryCount`
 * ilk denemede 0'dır, her yeniden alımda 1 artar; başarısız iş `retryCount <
 * retryLimit` iken yeniden denenir. Yani `retryCount === retryLimit` SON denemedir
 * (`retryLimit: 8` → 9 deneme). Sayaç yoksa (işçi `includeMetadata` olmadan
 * kaydedilmiş) `undefined`: iş tek atımlık sayılır — hangi denemenin son olduğu
 * bilinmeden «yeniden dene» demek dokümanı sonsuza dek `bekliyor` bırakırdı.
 */
function denemeBilgisi(is: { retryCount?: number; retryLimit?: number }): { sayi: number; sonMu: boolean } | undefined {
  const { retryCount, retryLimit } = is;
  if (!sayacMi(retryCount) || !sayacMi(retryLimit)) {
    if (!metaUyarisiVerildi) {
      metaUyarisiVerildi = true;
      console.warn('[magaza-bildirim] iş sayaçları yok (işçi includeMetadata: true ile kaydedilmeli) — yeniden deneme yapılamıyor');
    }
    return undefined;
  }
  return { sayi: retryCount + 1, sonMu: retryCount >= retryLimit };
}

/**
 * pg-boss işçisi (`includeMetadata: true` ile kaydedilir). `'yeniden-dene'`de kişisel veri taşımayan hata fırlatır.
 *
 * · İş verisi YALNIZ `{ talepId }`; biçimi bozuk iş sessizce atlanır (yeniden denenmez — yeniden deneme düzeltmez).
 * · İşleyici değer DÖNDÜRMEZ (dönen değer iş satırına yazılırdı).
 * · TOPLU ÇAĞRI: bir işin başarısızlığı diğerlerini YUTMAZ — bütün işler sırayla
 *   işlenir, hata ancak EN SONDA ve bir kez fırlatılır. pg-boss o zaman toplu işin
 *   TAMAMINI başarısız sayar; postası gitmiş talepler yeniden gelince dokümanda
 *   `gitti` görür ve göndermeden atlanır (çift posta yok).
 */
export function magazaBildirimIscisi(D: MagazaBildirimDeps): (isler: Array<{ data: unknown; retryCount?: number; retryLimit?: number }>) => Promise<void> {
  return magazaBildirimIscisiKur(D, magazaBildirimIsle);
}

/**
 * `magazaBildirimIscisi`'nin gövdesi; tek talep işlevi verilir (test: biçimi bozuk
 * iş işleve HİÇ ulaşmaz; işlev sözleşmesine aykırı fırlatsa da hatası iş satırına
 * sızmaz). Üretim kodu `magazaBildirimIscisi`'ni çağırır.
 */
export function magazaBildirimIscisiKur(
  D: MagazaBildirimDeps,
  isle: (talepId: string, D: MagazaBildirimDeps, deneme?: { sayi: number; sonMu: boolean }) => Promise<MagazaBildirimSonucu>,
): (isler: Array<{ data: unknown; retryCount?: number; retryLimit?: number }>) => Promise<void> {
  return async (isler) => {
    let yenidenDene = false;
    for (const is of Array.isArray(isler) ? isler : []) {
      const talepId = istenTalepId(is);
      if (talepId === null) continue;
      let sonuc: MagazaBildirimSonucu;
      try {
        sonuc = await isle(talepId, D, denemeBilgisi(is));
      } catch {
        // `magazaBildirimIsle` fırlatmaz; fırlatırsa hatası AYNEN yükseltilmez (iletisi iş
        // satırına yazılırdı) ve iş yeniden denenmez (postanın gidip gitmediği bilinmiyor).
        sonuc = 'gonderilemedi';
      }
      if (sonuc === 'yeniden-dene') yenidenDene = true;
    }
    if (yenidenDene) throw new Error(MAGAZA_BILDIRIM_YENIDEN_DENE_ILETISI);
  };
}

type BildirimKuyrugu = { send: (ad: string, veri: object, secenek?: object) => Promise<unknown> };

/**
 * Kuyruğa TEK giriş noktası (isteyici ve kaçanlar): iş verisi YALNIZ `{ talepId }`. pg-boss `send` iş
 * oluşturulmadıysa `null` çözer (fırlatmaz) — o da «kuyruğa girmedi»dir. `standard` politikada `send` null'u
 * pratikte üretmez; politika `exclusive`e çekilirse null = «zaten kuyrukta» olur ve isteyici süreç içi yola
 * DÜŞMEMELİ — o gün bu yorum okunacak.
 */
async function kuyrugaEkle(k: BildirimKuyrugu, talepId: string): Promise<boolean> {
  return (await k.send(MAGAZA_BILDIRIM_KUYRUGU, { talepId }, MAGAZA_BILDIRIM_IS_SECENEKLERI)) != null;
}

/**
 * `magazaBildirimIsteyici`'nin gövdesi; süreç içi işlev verilir (test: reddeden
 * işlev genel `unhandledRejection` işleyicisine düşmez). Üretim kodu
 * `magazaBildirimIsteyici`'yi çağırır.
 */
export function magazaBildirimIsteyiciKur(
  kuyruk: () => { send: (ad: string, veri: object, secenek?: object) => Promise<unknown> } | null,
  D: MagazaBildirimDeps,
  isle: (talepId: string, D: MagazaBildirimDeps) => Promise<unknown>,
): (talepId: string) => Promise<void> {
  return async (talepId) => {
    try {
      if (typeof talepId !== 'string' || !MAGAZA_TALEP_KIMLIK_DESENI.test(talepId)) return;
      let kuyrukta = false;
      try {
        const k = kuyruk();
        if (k) kuyrukta = await kuyrugaEkle(k, talepId);
      } catch {
        console.warn('[magaza-bildirim] bildirim kuyruğa eklenemedi — süreç içi gönderime geçildi');
      }
      if (kuyrukta) return;
      // Süreç içi yol: BAŞLATILIR, BEKLENMEZ (yanıt SMTP'yi beklemez). Kendi reddini
      // kendisi yutar: genel `unhandledRejection` işleyicisi ret nedenini günlüğe basar.
      void isle(talepId, D).catch(() => { /* sonuç dokümanda */ });
    } catch { /* asla reddetmez */ }
  };
}

/**
 * Rota bağlamının `bildirimIste` gerçekleştirimi: kuyruk hazırsa `send` (iş verisi YALNIZ `{ talepId }`);
 * kuyruk yoksa ya da `send` fırlatırsa süreç içi gönderimi BAŞLATIR ve beklemeden döner. Asla reddetmez.
 */
export function magazaBildirimIsteyici(
  kuyruk: () => { send: (ad: string, veri: object, secenek?: object) => Promise<unknown> } | null,
  D: MagazaBildirimDeps,
): (talepId: string) => Promise<void> {
  return magazaBildirimIsteyiciKur(kuyruk, D, magazaBildirimIsle);
}

// ── Kaçan bildirimleri yeniden kuyruğa alma (K6, 2026-10-09) ─────────────────────────────────────────────────────────
/**
 * Açılışta, kuyruk işçisi bağlandıktan sonra çağrılır. Hedef: SMTP yapılandırması yokken (yerel kip gelmeden önce)
 * `yapilandirilmamis` kalmış talepler ve kuyruk ufkunu (8 deneme, en çok ≈ 2 sa 22 dk) aşmış yetim `bekliyor` kayıtlar
 * kendiliğinden yeniden gönderilsin.
 *
 * KURALLAR (şartname kapısı 2026-10-09):
 *  • Kuyruk hazır değilse HİÇ koşmaz — süreç içi yola DÜŞMEZ: 50 talep aynı anda giderse her geçici hata kalıcı
 *    `gonderilemedi` olurdu (ölçüm: 50 eşzamanlı gönderimde sunucu 5 bağlantı sınırıyla 30'unu kesti).
 *  • Önce teslim sondası (`smtpDogrula`; yerel kipte MAIL FROM + RCPT TO kabulü): sonda geçmezse 50 talep × kalıcı ret
 *    üretmek yerine hiç başlamaz, nedeni günlükler.
 *  • TEK SQL ile sahiplenir (durumu `bekliyor`a çeker, `RETURNING`) ve SONRA kuyruğa alır: ikinci açılış aynı satırı
 *    bulamaz → aynı talep için çift iş yok (pg-boss `standard` politikada `singletonKey` etkisizdir). UPDATE ile `send`
 *    arasında süreç ölürse satır `deneme`SİZ `bekliyor` kalır; 3 saat sonra yetim kuralıyla yeniden alınır.
 *  • `yapilandirilmamis` için yaş penceresi YOK (hiç denenmemiş talepte çift posta riski yok); sel koruması LIMIT.
 *  • `gitti` ASLA ezilmez (durum süzgeci). Sahiplenme yazımı kiracı etiketiyle yayınlanır (ekran kırmızıdan çıkar; ara
 *    «bekleme aşıldı» sarısı bilerek kabul edilir).
 *  • Günlüğe yalnız SAYI yazılır (talep no / kişisel veri yok). Asla fırlatmaz.
 */
export const MAGAZA_KACAN_SINIRI = 50;
/** Kuyruk ufku (30 + 60 + … + 3600 sn + 9 × 120 sn ≈ 2 sa 22 dk) aşıldıysa ve kuyruk yolunda hiç deneme yazılmamışsa
 *  (`deneme` yok) `bekliyor` yetimdir. `deneme` yazılmış `bekliyor` ALINMAZ: onun pg-boss işi PG'de durur, süreç ölse de
 *  açılışta kaldığı yerden sürer (12.26: `active` kalan iş `failJobsByTimeout` ile `retry`) — ikinci iş eklemek aynı talep
 *  için iki yeniden deneme zinciri ve `deneme` sayacının ezilmesi demekti (inceleme 2026-10-09). Bilinen kör nokta: SON
 *  denemede sonuç yazımı düşerse doküman `bekliyor` + `deneme` kalır; bekçi / ekran «bekleme aşıldı» ile gösterir. */
export const MAGAZA_KACAN_YETIM_ESIGI_MS = 3 * 60 * 60 * 1000;
export const MAGAZA_KACAN_SAHIPLEN_SQL = `WITH aday AS (
  SELECT id FROM docs
   WHERE coll = $1
     AND ( data->'bildirim'->>'durum' = 'yapilandirilmamis'
        OR ( data->'bildirim'->>'durum' = 'bekliyor'
             AND NOT (data->'bildirim' ? 'deneme')
             AND COALESCE((data->'bildirim'->>'zaman') COLLATE "C" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
                      AND (data->'bildirim'->>'zaman') COLLATE "C" < $3, false) ) )
   ORDER BY (data->>'olusturma') COLLATE "C" DESC
   LIMIT ${MAGAZA_KACAN_SINIRI}
   FOR UPDATE SKIP LOCKED )
UPDATE docs d
   SET data = jsonb_set(d.data, '{bildirim}', jsonb_build_object('durum', 'bekliyor', 'zaman', $2::text)), updated_at = now()
  FROM aday WHERE d.coll = $1 AND d.id = aday.id
RETURNING d.id, d.data`;

export interface MagazaKacanSonucu {
  alinan: number;
  kuyrukta: number;
  neden?: 'kuyruk-hazir-degil' | 'yapilandirma' | 'teslim-sondasi' | 'havuz-yok' | 'sorgu';
}

export async function magazaBildirimKacanlariKuyrukla(
  D: MagazaBildirimDeps,
  kuyruk: () => BildirimKuyrugu | null,
  dogrula: () => Promise<SmtpSonucu | { ok: false; yapilandirilmamis: true }> = smtpDogrula,
  yapilandirma: () => { tamam: boolean } = smtpYapilandirmasi,
  simdi: () => number = Date.now,
): Promise<MagazaKacanSonucu> {
  const gunluk = (ileti: string): void => console.warn('[magaza-bildirim] kaçanlar: ' + ileti);
  try {
    const k = kuyruk();
    if (!k) { gunluk('kuyruğa alınmadı — kuyruk hazır değil'); return { alinan: 0, kuyrukta: 0, neden: 'kuyruk-hazir-degil' }; }
    if (!yapilandirma().tamam) { gunluk('kuyruğa alınmadı — SMTP yapılandırması tamam değil'); return { alinan: 0, kuyrukta: 0, neden: 'yapilandirma' }; }
    const sonda = await dogrula();
    if (!sonda.ok) {
      gunluk(`kuyruğa alınmadı — teslim sondası geçmedi (${'sinif' in sonda ? `sınıf: ${sonda.sinif}` : 'yapılandırılmamış'})`);
      return { alinan: 0, kuyrukta: 0, neden: 'teslim-sondasi' };
    }
    const havuz = D.getPgPool();
    if (!havuz) { gunluk('kuyruğa alınmadı — pg havuzu yok'); return { alinan: 0, kuyrukta: 0, neden: 'havuz-yok' }; }
    const an = simdi();
    let satirlar: unknown[];
    try {
      const { rows } = await havuz.query(MAGAZA_KACAN_SAHIPLEN_SQL, [MAGAZA_TALEP_KOLEKSIYONU, new Date(an).toISOString(), new Date(an - MAGAZA_KACAN_YETIM_ESIGI_MS).toISOString()]);
      satirlar = Array.isArray(rows) ? rows : [];
    } catch (hata) {
      gunluk(`sorgu başarısız (kod: ${hataKodu(hata)})`);
      return { alinan: 0, kuyrukta: 0, neden: 'sorgu' };
    }
    let kuyrukta = 0;
    for (const satir of satirlar) {
      const id = nesneMi(satir) ? satir.id : undefined;
      const veri = nesneMi(satir) ? satir.data : undefined;
      if (typeof id !== 'string' || !MAGAZA_TALEP_KIMLIK_DESENI.test(id)) continue;
      const cid = nesneMi(veri) ? veri.companyId : undefined;
      if (typeof cid === 'string' && cid !== '') {
        try { D.broadcastDocChange(MAGAZA_TALEP_KOLEKSIYONU, 'set', id, veri, { cid }); } catch { /* yayın hatası sonucu değiştirmez */ }
      }
      try {
        if (await kuyrugaEkle(k, id)) kuyrukta += 1;
      } catch { /* sayıyla raporlanır; satır `bekliyor` kalır, 3 saat sonra yeniden alınır */ }
    }
    if (satirlar.length > 0) gunluk(`${satirlar.length} talep sahiplenildi, ${kuyrukta} kuyruğa alındı${satirlar.length - kuyrukta > 0 ? `, kuyruğa alınamadı: ${satirlar.length - kuyrukta}` : ''}`);
    return { alinan: satirlar.length, kuyrukta };
  } catch {
    return { alinan: 0, kuyrukta: 0, neden: 'sorgu' };
  }
}
