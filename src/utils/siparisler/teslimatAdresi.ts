/**
 * teslimatAdresi.ts — siparişin teslimat adresi: TAM METİN, ŞEHİR, ÜLKE ADI ve form yardımcıları. TEK KAYNAK
 * (2026-10-10; kullanıcı isteği 2026-10-09: «şehir ve ülke seçtir droplist (otomatik liste yap)»).
 *
 * VERİ MODELİ (src/types.ts `Order`):
 *   • `shippingAddress` — «kalan»: ilçe, mahalle, sokak (serbest metin). Eski kayıtta ve müşteriden gelen oto-adreste
 *     il / ülke de içerebilir; veri AYRIŞTIRILMAZ ve DEĞİŞTİRİLMEZ — yineleme yalnız metin kurulurken önlenir.
 *   • `teslimatSehri`   — Türkiye'de 81 il listesinden seçilen il, başka ülkede serbest yazılan şehir.
 *   • `teslimatUlke`    — ISO 3166-1 alpha-2, büyük harf. Kayıtta yoksa okuyan taraf 'TR' sayar (`etkinUlke`).
 *   • MAĞAZA siparişi (`source === MAGAZA_KAYNAGI`) İSTİSNADIR: `shippingAddress` TAM adres metnidir, `teslimatSehri`
 *     «ilçe / il» (Online Siparişler sütunu). O kayıtta metne il / ülke EKLENMEZ, `siparisSehri` de `null` döner.
 *
 * KURAL: tam adres isteyen HER okuyucu `teslimatAdresiMetni` çağırır (belge, liste, dışa aktarma, e-İrsaliye, LUCA,
 * arama); `o.shippingAddress`'i doğrudan okumak ili / ülkeyi düşürür. Çit: teslimatAdresi.cit.test.ts.
 *
 * SAF modül: React / DB / i18n yok; yalnız `../arama` ve `../../lib/magazaKaynagi` içe aktarılır (`./magazaSiparisi`
 * DEĞİL — o modül para / tarih yardımcılarını da yükler). Sunucu da içe aktarır (`.js` uzantısıyla): server.ts takip ucu
 * ve LUCA gövdesi, paymentRoutes iyzico bloğu. Girdi bu yüzden gevşektir: metin olmayan / `null` / yalnız boşluktan
 * oluşan parça BOŞ sayılır, dolu parça kırpılır; hiçbir işlev fırlatmaz.
 */
import { katla } from '../arama';
import { MAGAZA_KAYNAGI } from '../../lib/magazaKaynagi';

/** Adres okuyan işlevlerin girdisi — yapısal ve gevşek: `Order` da `Record<string, unknown>` da uyar. */
export interface TeslimatAdresiGirdisi {
  shippingAddress?: unknown;
  teslimatSehri?: unknown;
  teslimatUlke?: unknown;
  source?: unknown;
}

/** Dolu metin → kırpılmış hâli; metin olmayan / `null` / yalnız boşluk → ''. */
const doluMetin = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/* ── Ülke ─────────────────────────────────────────────────────────────────── */

/** ISO 3166-1 alpha-2, büyük harf (Satış Bölgesi `countryCode` ile aynı biçim). */
const ULKE_KODU = /^[A-Z]{2}$/;

/**
 * Değer BİÇİMCE ülke kodu mu (`^[A-Z]{2}$` metin)? Kırpma / harf büyütme YAPMAZ — ' de ' ya da 'de' kod değildir
 * (harf büyütme / ülke adından kod tahmini yok). Desenin TEK yeri: kayda ülke yazan başka bir yazıcı (ör. mağaza
 * eşleyicisi) deseni yeniden yazmak yerine bunu sorar. Yalnız biçime bakar; adının çözülüp çözülmediğini `ulkeAdi`
 * söyler ('AA' biçimce koddur, adı yoktur).
 */
export function ulkeKoduMu(v: unknown): v is string {
  return typeof v === 'string' && ULKE_KODU.test(v);
}

/** `Intl.DisplayNames` örneği dil başına BİR kez kurulur: arama her tuşta her sipariş için ülke adı sorar. */
const adlandiricilar = new Map<'tr' | 'en', Intl.DisplayNames | null>();
function adlandirici(dil: 'tr' | 'en'): Intl.DisplayNames | null {
  const onbellekteki = adlandiricilar.get(dil);
  if (onbellekteki !== undefined) return onbellekteki;
  let yeni: Intl.DisplayNames | null;
  try { yeni = new Intl.DisplayNames([dil], { type: 'region' }); } catch { yeni = null; }   // çok eski tarayıcı
  adlandiricilar.set(dil, yeni);
  return yeni;
}

/**
 * ISO2 ülke kodu → görünen ad (Türkçe / İngilizce). Çözülemezse `null` — ham kod DÖNMEZ (belgeye, Mikro açıklamasına
 * 'DE' basılmasın; kodu göstermek isteyen çağıran `?? kod` yazar, bkz. `useWorldGeo.countryDisplayName`).
 *
 * «Çözülemedi» (ölçüm, Node v24.14.1 / ICU 78.2): kod `^[A-Z]{2}$` değil ('de', 'DEU', '', `null`) · `Intl.DisplayNames`
 * yok ya da fırlattı · `undefined` döndü · sonuç kodun KENDİSİ ('AA' → 'AA') · kod 'ZZ' («Bilinmeyen Bölge» bir ad değil).
 *
 * Çıktı çalışma ortamına bağlıdır: aynı ICU'da `ulkeAdi('TR', 'en')` 'Türkiye' verir, eski tarayıcı 'Turkey' verebilir —
 * dış sistemin beklediği SABİT (iyzico 'Turkey') bu işlevden ALINMAZ.
 */
export function ulkeAdi(iso2: unknown, dil: 'tr' | 'en'): string | null {
  if (!ulkeKoduMu(iso2) || iso2 === 'ZZ') return null;
  const a = adlandirici(dil);
  if (a === null) return null;
  try {
    const ad = a.of(iso2);
    return ad && ad !== iso2 ? ad : null;
  } catch {
    return null;
  }
}

/**
 * Kaydın ETKİN ülke kodu: değer `^[A-Z]{2}$` metinse o, değilse 'TR' (alan yok / `null` / '' / 'de'). Seçici görünümü,
 * değişiklik karşılaştırması ve metin kurulumu AYNI işlevi kullanır — eski kayıt (alan yok) her yerde 'Türkiye'dir ve
 * yalnız görünümdür: karşılaştırma iki yanda da bu işlevle yapıldığı için yalnız notu / tutarı değişen eski kayda sessiz
 * 'TR' yazılmaz. İSTİSNA (inceleme 2026-10-10): düzenlemede ADRESE DOKUNULDUYSA (adres metni değişti ya da il yaması var)
 * karşılaştırma kayıttaki HAM değerle yapılır ve alanı olmayan kayda 'TR' AÇIKÇA yazılır — bkz. `takipAdresi` ve
 * `formKayit.adreseDokunuldu`.
 */
export function etkinUlke(v: unknown): string {
  return ulkeKoduMu(v) ? v : 'TR';
}

/* ── Tam adres metni ──────────────────────────────────────────────────────── */

/** «Kalan» metnin parçaları, karşılaştırmaya hazır. Ayırıcı kümesi `LojistikRapor`'un şehir türetimiyle aynı. */
const katliParcalar = (kalan: string): string[] => kalan.split(/[,/\n]/).map(p => katla(p).trim()).filter(Boolean);

/**
 * Parça adla BİTİYOR mu (ikisi de `katla()`'dan geçmiş): tamamı addır ya da adın hemen önünde boşluk / tire vardır;
 * sondaki nokta ve boşluk sayılmaz. İl ve ülke yinelemesinin TEK ölçütü (inceleme 2026-10-10).
 *   • Yakalar: 'Kepez Antalya', 'Kepez - Antalya', 'Kepez-ANTALYA', '07090 Kepez Antalya', 'Antalya.', '10115 Berlin',
 *     çok sözcüklü ad ('10001 New York').
 *   • Yakalamaz (ad EKLENİR): ad parçanın BAŞINDA / ortasında ('Antalya Cad. No:5', 'Antalya Bulvarı No:8'); ad bir
 *     sözcüğün kuyruğu ('Kolordu Cad. No 3 Kervan' + Van — önünde boşluk / tire yok).
 *   • BEDEL (kabul edildi): adı ile biten yer adı yineleme sayılır — 'Mall of Antalya, Altınova' + Antalya → il eklenmez
 *     ('Avenue de France' + 'FR' → ülke eklenmez). Ad metinde görünür kalır, kayıttaki alan değişmez; etkilenen yalnız
 *     kurulan metindir.
 */
const sonuKirp = (s: string): string => s.replace(/[.\s]+$/, '');
const adlaBiter = (parca: string, ad: string): boolean => {
  const p = sonuKirp(parca);
  // Ad da noktayla bitebilir ('Frankfurt a.M.', 'Washington D.C.') — iki yan AYNI kırpılır; yalnız parça kırpılınca nokta ile
  // biten şehir adı belgeye iki kez basılıyordu (delta incelemesi 2026-10-10). Kırpılınca boş kalan ad ('.') hiçbir parçayla eşleşmez.
  const a = sonuKirp(ad);
  return a !== '' && (p === a || p.endsWith(` ${a}`) || p.endsWith(`-${a}`));
};

/**
 * Siparişin TAM teslimat adresi, tek satır metin: `[kalan, il, ülke adı]` boş olmayanları ', ' ile birleşir.
 *   • Yurt içi (etkin ülke 'TR') → ülke YAZILMAZ. Başka ülkede Türkçe ad ('DE' → «Almanya»); ad çözülemezse ülke
 *     yazılmaz — ham kod metne HİÇBİR durumda basılmaz. Çıktı arayüz diline göre DEĞİŞMEZ (belgeye, Mikro
 *     açıklamasına, LUCA'ya giden metin).
 *   • Mağaza siparişinde `shippingAddress` AYNEN döner (zaten tam adres); il / ülke eklenmez.
 *   • YİNELEME: kalan `,` `/` ve satır sonuyla parçalanır; parçalardan HERHANGİ biri `katla()` ile il adıyla BİTİYORSA
 *     il, ülkenin Türkçe ya da İngilizce adıyla bitiyorsa ülke EKLENMEZ ('Kadıköy, İstanbul, Türkiye' + İstanbul →
 *     birebir; 'Kepez / Antalya' + Antalya → birebir; 'Hauptstr. 5, 10115, Germany' + 'DE' → «Almanya» eklenmez). «Son
 *     parça» değil «herhangi bir parça»: il çoğu kez ülke adından önce durur. «Eşit» değil «adla BİTER» (`adlaBiter`;
 *     inceleme 2026-10-10): il boşluk / tire / sondaki nokta ile de yazılır ('Kepez Antalya', 'Kepez - Antalya',
 *     'Antalya.', '10115 Berlin') ve parça eşitliği bunları kaçırıp ili belgeye iki kez basıyordu. Sınırlar ve kabul
 *     edilen bedel `adlaBiter`'in yorumunda.
 *   • Eski kayıt (yalnız `shippingAddress`) baş / son boşluk dışında birebir döner.
 * Bilinen sınır: metinde ülke adı olup il olmayan kayıtta ('Kadıköy, Türkiye' + İstanbul) il ülke adından SONRA eklenir;
 * metin yeniden sıralanmaz.
 */
export function teslimatAdresiMetni(o: TeslimatAdresiGirdisi | null | undefined): string {
  const kalan = doluMetin(o?.shippingAddress);
  if (!o || o.source === MAGAZA_KAYNAGI) return kalan;

  const il = doluMetin(o.teslimatSehri);
  const kod = etkinUlke(o.teslimatUlke);
  const ulke = kod === 'TR' ? null : ulkeAdi(kod, 'tr');

  const parcalar = katliParcalar(kalan);
  const ilVar = il !== '' && parcalar.some(p => adlaBiter(p, katla(il)));
  const ulkeVar = ulke !== null && [ulke, ulkeAdi(kod, 'en')].some(ad => ad !== null && parcalar.some(p => adlaBiter(p, katla(ad))));

  return [kalan, ilVar ? '' : il, ulke === null || ulkeVar ? '' : ulke].filter(Boolean).join(', ');
}

/**
 * Siparişin YAPISAL şehri: mağaza siparişi DEĞİLSE ve `teslimatSehri` doluysa o değer (kırpılmış); aksi hâlde `null`.
 * Mağaza siparişinde alan «ilçe / il»dir, il değildir → `null`. `null` gören rapor bugünkü metin türetimine düşer
 * (eski ve mağaza kayıtlarında davranış birebir).
 */
export function siparisSehri(o: TeslimatAdresiGirdisi | null | undefined): string | null {
  if (!o || o.source === MAGAZA_KAYNAGI) return null;
  return doluMetin(o.teslimatSehri) || null;
}

/* ── Kimliksiz takip ucu ──────────────────────────────────────────────────── */

export type TakipAdresi = { yapisal: false } | { yapisal: true; metin: string | null };

/**
 * Kimliksiz `GET /api/track/:orderId` yanıtının adres alanı için karar.
 *   • `yapisal` = kayıtta `teslimatSehri` ya da `teslimatUlke` DOLU metin. O zaman yanıtın adresi YALNIZ `metin`dir:
 *     `[teslimatSehri, ülke TR değilse Türkçe ülke adı]` birleşimi, boşsa `null`. `shippingAddress` (kalan: ilçe,
 *     mahalle, sokak, kapı no) bu işleve HİÇ girmez — yapısal kayıtta kalanın tamamı sokak düzeyidir, eski
 *     «son iki parça» maskesi onu dışarı verirdi.
 *   • `yapisal` değilse (eski kayıt) çağıran bugünkü `maskAddress(o.shippingAddress)`'i AYNEN çalıştırır.
 * Sonuç (bilerek): yeni siparişler `teslimatUlke`'yi hep yazdığı için hepsi yapısal yoldan geçer; il seçilmemiş yurt içi
 * yeni siparişte `metin` `null`dur ve takip sayfası adres satırı göstermez.
 *
 * YAZICI SÖZLEŞMESİ (inceleme 2026-10-10, gizlilik): `shippingAddress`'i «kalan» anlamıyla yazan HER yol kaydı aynı
 * yazımda yapısal da yapmalıdır — bu işlev «kalan»ı okumaz, kararı yalnız iki yapısal alandan verir; alanlar boşsa
 * çağıran eski maskeye düşer ve sokak / kapı / daire dışarı çıkar. Yeni sipariş: `adresKayitAlanlari` ülkeyi hep yazar.
 * Düzenleme: adres metni ya da il değişen kayıtta alan yoksa 'TR' açıkça yazılır ve il sonradan boşaltılsa da ülke
 * kayıtta kalır (`formKayit.siparisDuzenlemeYamasi` / `adreseDokunuldu`). Zincir testi: formKayit.test.ts.
 */
export function takipAdresi(o: TeslimatAdresiGirdisi | null | undefined): TakipAdresi {
  const il = doluMetin(o?.teslimatSehri);
  if (il === '' && doluMetin(o?.teslimatUlke) === '') return { yapisal: false };
  const kod = etkinUlke(o?.teslimatUlke);
  const ulke = kod === 'TR' ? null : ulkeAdi(kod, 'tr');
  const metin = [il, ulke].filter(Boolean).join(', ');
  return { yapisal: true, metin: metin || null };
}

/* ── Form yardımcıları (Yeni Sipariş ve Sipariş Düzenle AYNI işlevleri çağırır) ─────────────── */

/**
 * Ülke seçicisi değişince FORM durumuna uygulanacak yama. Etkin ülke değişmediyse `{}`; değiştiyse yeni kod yazılır ve
 * il BOŞALTILIR (`teslimatSehri: ''`): TR listesinden seçilmiş il yabancı ülkede, serbest yazılmış şehir TR'de kalmaz.
 * Düzenlemede boşalan il, önceki il doluysa kayıtta `teslimatSehri: null` yamasına dönüşür (`formKayit.girilenMetinYamasi`).
 */
export function ulkeSecimiYamasi(mevcutUlke: unknown, yeniKod: string): { teslimatUlke?: string; teslimatSehri?: string } {
  if (etkinUlke(mevcutUlke) === yeniKod) return {};
  return { teslimatUlke: yeniKod, teslimatSehri: '' };
}

/**
 * YENİ sipariş gövdesinin iki adres alanı. `teslimatUlke` HER ZAMAN açıkça yazılır ('TR' dâhil); il yalnız doluysa
 * (kırpılmış). Boş il anahtarı gövdede BULUNMAZ — '' / `undefined` yazılmaz (kayıt katmanı `undefined` alanı reddeder).
 */
export function adresKayitAlanlari(form: { teslimatUlke?: unknown; teslimatSehri?: unknown }): { teslimatUlke: string; teslimatSehri?: string } {
  const il = doluMetin(form.teslimatSehri);
  return { teslimatUlke: etkinUlke(form.teslimatUlke), ...(il ? { teslimatSehri: il } : {}) };
}
