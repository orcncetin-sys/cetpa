/**
 * eslemeCari.ts — Mikro'dan OKUNAN cari verisinin Cetpa `leads`/`cariBalances`
 * dokümanlarına eşlenmesi. SAF: ağ, DB, express yok (Faz 3 3/n, grup "eslemeCari", 2026-09-19).
 *
 * ── NEDEN VAR ───────────────────────────────────────────────────────────────
 * Aynı eşleme dört yerde elle tekrarlanıyordu ve her kopyada "bilinmeyeni sabit bir
 * değerle doldur" kalıbı vardı. Bu, gövde tarafındaki "varsayılan yok" kuralının
 * IMPORT karşılığıdır: Mikro'nun okuması geçici bozulduğunda (kolon adı sürümle
 * değişti — `cha_vergi`/`cha_ettn` üç kez sessizce öldü; şema keşfi boş döndü)
 * sabit değer, CRM'de elle girilmiş GERÇEK veriyi siler ve iş "başarılı" görünür.
 *
 * Kaldırılan sahte-varsayılan siteleri (mikroRoutes.ts, 2026-09-19 ölçümü):
 *   • ~449 ve ~927  `Number(c.cari_hareket_tipi ?? 0) === 1 ? 'Supplier' : 'Customer'`
 *       → tip kolonu okunamazsa TEDARİKÇİ müşteri diye işaretleniyordu. (crons.ts:255
 *         aynı satırı üçüncü kez taşıyor — bkz. açık sorular.)
 *   • ~449 ve ~927  `eFaturaKayitli: Number(c.cari_efatura_fl) === 1`
 *       → bayrak okunamazsa "e-faturaya kayıtlı DEĞİL" diye YAZIYORDU; e-fatura/
 *         e-arşiv kararı bu alana bakıyor.
 *   • ~440-447 / ~923-926  `email/phone/taxId/taxOffice: (x as string) || ''`
 *       → Mikro tarafı boş dönerse CRM'deki e-posta/telefon `''` ile EZİLİYORDU
 *         (update yolunda; "bayat değer, silinmiş değerden iyidir").
 *   • ~930 `status: 'Active'` paylaşılan gövdede → güncellemede kullanıcının
 *         işaretlediği durumu her import'ta geri alıyordu. Aynı sınıf `source` için
 *         2026-09-05 incelemesinde zaten düzeltilmişti (yorum ~933'te duruyor);
 *         `status` atlanmıştı. Artık `yeniKayitAlanlari`nda = YALNIZ yeni kayıtta.
 *   • ~4266-4270 `pull/bakiye`: `Number.isFinite(Number(raw))` — `''` için Number('')=0
 *         olduğundan BOŞ hücre geçerli sıfır bakiye sayılıyordu.
 *   • ~4257 `pull/cari-adres`: `Number(row.adr_adres_no ?? 0)` — adres no okunamayan
 *         satır DAİMA 0 olup "en düşük no" yarışını KAZANIYOR ve varsayılan adres
 *         oluyordu. Tam tersi doğru: bilinmeyen en sona gider.
 *
 * ── PARİTE ──────────────────────────────────────────────────────────────────
 * Bilinen girdide çıkan doküman bugünküyle BİREBİR aynıdır (alan adları + değerler);
 * `eslemeCari.test.ts` bunu `toEqual` ile kilitler. Davranış yalnız BİLİNMEYEN
 * girdide değişir: alan hiç yazılmaz (merge/update mevcut değeri korur) ve sayılır.
 *
 * ── BİLİNÇLİ FARKLAR (bilinen girdide görünmez) ─────────────────────────────
 *  1. Boş metin (`''`, yalnız boşluk) = BİLİNMEYEN → yazılmaz. Eski kod `''` yazardı.
 *  2. Metin değerleri kırpılır — SQL Server CHAR kolonları sağdan boşlukla döner;
 *     ' İstanbul ' şehri Satış Bölgesi eşleşmesini bozuyordu.
 *  3. `company`: `/cari/listesi` unvan yokken `''`, `/import/cari` cari kodunu
 *     yazıyordu (iki site AYRIŞMIŞTI). Artık ikisi de yazmaz; `name` ise her iki
 *     sitede olduğu gibi cari koduna düşer — o bir KİMLİK, uydurma değil.
 *  4. Bir alan satırların TAMAMINDA (≥ ARIZA_ESIGI satır) okunamıyorsa bu veri değil
 *     OKUMA ARIZASIDIR: `okumaArizasi` döner, rota notun BAŞINA uyarı yazar + console.warn.
 *  5. Bakiyesi okunamayan cari `okunamayanKodlar`a düşer ve rota ona HİÇ YAZMAZ.
 *     Eski kod (ve ilk sürüm) o cariye 0 yazıyordu: `cariBakiyesi` haritada olmayana
 *     0 döner, ama "haritada yok"un İKİ nedeni var ve anlamları ZIT — hareketi yok
 *     (gerçek sıfır) / satırı geldi ama okunamadı (bilinmiyor). Hakem bulgusu 2026-09-19.
 *  6. `_fl`/tip gibi BİT kolonları JSON boolean gelebilir; `bayrak()` bunu bilinen
 *     sayar (`true`→1). Eski satır içi `Number(x)` de böyle okuyordu — parite.
 *
 * ── TAŞINAN CANLI DOĞRULAMA NOTLARI (rotadan) ───────────────────────────────
 * • pull/bakiye 2026-07-30'da BAŞTAN YAZILDI: eski hâli `CariHareketListesiV2`yi cari
 *   başına çağırıyordu; o metot Mikro Jump V17'de HİÇ YOK (resmî Postman koleksiyonunda
 *   161 uç arasında yok). Her çağrı boşa gidiyor, ardından `Number(md?.bakiye ?? 0)`
 *   devreye girip TÜM carilerin bakiyesini 0 yazıyordu — sessiz-sıfır sınıfının en
 *   pahalı örneği. Yeni yol: SqlVeriOkuV2 ile tek sorguda tüm bakiyeler.
 * • İŞARET SÖZLEŞMESİ (doğrulandı 2026-07-30): `SUM(cha_tip=0 ? +meblag : -meblag)`
 *   — cha_tip 0 = borç (satış), 1 = alacak. EKSİ = CETPA BORÇLU. `Math.abs` YOK.
 * • `ISNULL(cha_iptal,0)=0` sorguda ZORUNLU (2026-08-22 denetim bulgusu C16): iptal
 *   edilmiş hareketler toplama giriyordu. Sorgu rotada kalır, bu modül satırı eşler.
 * • Mikro'da hiç hareketi olmayan cari SQL'de satır olarak YOKTUR. Bu GERÇEKTEN sıfır
 *   bakiyedir (hareket yok = borç yok), tespit edilememiş değil — `cariBakiyesi`
 *   yalnız bu hâlde 0 döner ve sorgunun satır döndürdüğü rotada doğrulanır.
 * • cari-adres: bir carinin birden çok adresi olabilir (sevk/fatura, `adr_adres_no`).
 *   "En düşük adres no = varsayılan" bir TAHMİNDİR, Mikro'da doğrulanmış kural değil —
 *   bu yüzden doldurulan lead `addressSource: 'mikro-heuristic'` ile işaretlenir
 *   (Satış Bölgesi otomatik ataması bu alanı okuyacak, task #31).
 * • cari-adres SORGUSUNDA `ORDER BY adr_cari_kod, adr_adres_no` ŞART (code-review
 *   bulgusu): eşit adres no'larda SQL Server'ın keyfî dönüş sırası her çalıştırmada
 *   FARKLI adres seçtirir. Buradaki seçim eşitlikte İLK satırı tutar (kararlı).
 * • "Boş" sayılan: undefined/null/'' ve YALNIZ BOŞLUKTAN oluşan değer — salt falsy
 *   kontrolü ' ' gibi anlamsız-ama-truthy değeri "zaten dolu" sanıp Mikro'dan
 *   doldurmayı atlıyordu (code-review bulgusu).
 */
import { bilinenSayi } from '../../utils/para.js';

/** Bir alanın "hiçbir satırda okunamadı" sayılması için gereken en az satır sayısı.
 *  Altında iddia edilmez: 3 carili bir firmada hiç e-posta olmaması normaldir. */
export const ARIZA_ESIGI = 5;

type Satir = Record<string, unknown>;

/** Metin değeri: kırpılmış string; boş/boşluk/nesne → null (= bilinmiyor, yazılmaz). */
function metin(x: unknown): string | null {
  if (typeof x === 'number' && Number.isFinite(x)) return String(x);
  if (typeof x !== 'string') return null;
  const t = x.trim();
  return t === '' ? null : t;
}

/**
 * BAYRAK/TİP KODU okuyucu: bilinen bit/tinyint değeri → sayı, bilinmiyorsa null.
 *
 * `bilinenSayi` (para.ts) yalnız number/string kabul eder — para/miktar için doğru,
 * ama SQL Server `bit` kolonu JSON'a **boolean** olarak dönebilir ve bu kod tabanı
 * Mikro'ya `_fl` alanlarını zaten boolean gönderiyor (`govdeSiparis.sip_vergisiz_fl`).
 * Eski satır içi kod `Number(c.cari_efatura_fl) === 1` ile boolean'ı okuyordu;
 * boolean "bilinmiyor" sayılsaydı HİÇBİR carinin e-fatura bayrağı güncellenmez ve
 * yeni lead'ler bayraksız açılırdı (e-fatura/e-arşiv kararı bu alana bakıyor) —
 * parite kırığı, hakem bulgusu 2026-09-19. `Number(true) === 1`, `Number(false) === 0`
 * olduğu için dönüşüm eski davranışla birebir aynıdır.
 *
 * Bu KAPI YALNIZ BAYRAK/TİP İÇİNDİR; para/miktar/bakiye `bilinenSayi`den geçer
 * (bir bakiyenin boolean gelmesi veri değil, arızadır).
 */
function bayrak(x: unknown): number | null {
  if (typeof x === 'boolean') return x ? 1 : 0;
  return bilinenSayi(x) ? Number(x) : null;
}

// ── Ortak özet (sayaç + okuma arızası + not) ─────────────────────────────────
export interface EslemeOzeti {
  /** Alan adı → o alanın bilinmediği satır sayısı. */
  sayac: Record<string, number>;
  /** Satırların TAMAMINDA okunamayan alanlar (≥ ARIZA_ESIGI satır varsa). */
  okumaArizasi: string[];
  /** İmport yanıtının `note`'una eklenecek Türkçe cümle; eksik yoksa ''. */
  not: string;
  /** Değerlendirilen satır sayısı. */
  satir: number;
}

/**
 * `bilinmeyen` listelerinden özet kurar. Not: önce arıza uyarıları, sonra sayaçlar.
 *
 * `kritikAlanlar` ZORUNLUDUR (2026-09-19 delta bulgusu, `eslemeVarlik`/`eslemeStok` ile
 * aynı gerekçe): arıza taraması MEŞRU olarak boş kalabilen alanları da aday sayıyordu.
 * Türk KOBİ carilerinin çoğunda `cari_EMail` boştur — 5+ carili her import "UYARI:
 * email alanı hiçbir satırda okunamadı — kolon adı/şema kontrol edin" üretiyordu.
 * Kalıcı yanlış alarm, gerçek arıza kapısını (kolon adı kaydı) değersizleştirir.
 */
function ozetKur(
  bilinmeyenListeleri: readonly (readonly string[])[],
  alanSirasi: readonly string[],
  kritikAlanlar: readonly string[],
): EslemeOzeti {
  const satir = bilinmeyenListeleri.length;
  const sayac: Record<string, number> = {};
  for (const liste of bilinmeyenListeleri) {
    for (const alan of liste) sayac[alan] = (sayac[alan] ?? 0) + 1;
  }
  // Sıra: çağıranın verdiği alan sırası (deterministik not — test edilebilir).
  const eksikAlanlar = alanSirasi.filter(a => (sayac[a] ?? 0) > 0);
  const kritikSeti = new Set(kritikAlanlar);
  const okumaArizasi = satir >= ARIZA_ESIGI
    ? eksikAlanlar.filter(a => kritikSeti.has(a) && sayac[a] === satir)
    : [];
  const arizaSeti = new Set(okumaArizasi);
  const parcalar = [
    ...okumaArizasi.map(a => `UYARI: ${a} alanı hiçbir satırda okunamadı — kolon adı/şema kontrol edin`),
    ...eksikAlanlar.filter(a => !arizaSeti.has(a)).map(a => `${sayac[a]} satırın ${a} alanı bilinmiyor`),
  ];
  return { sayac, okumaArizasi, not: parcalar.join('; '), satir };
}

// ── 1) Cari → lead ───────────────────────────────────────────────────────────
export interface CariEslemeSecenek {
  /** Kiracı etiketi (rotada `await C.reqCompanyId(req)`). */
  companyId: string;
  /** `pgServerTimestamp()` sonucu — modül saf kalsın diye DIŞARIDAN gelir. */
  zamanDamgasi: unknown;
}

export interface CariEsleme {
  /** Kırpılmış Mikro cari kodu (doküman eşleştirmesinin anahtarı). */
  cariKod: string;
  /** leads dokümanına yazılacak alanlar — BİLİNMEYEN ALAN HİÇ YOK. */
  alanlar: Record<string, unknown>;
  /** YALNIZ yeni kayıtta yazılacaklar. `source`/`createdAt` rotaya ait (değerleri farklı). */
  yeniKayitAlanlari: Record<string, unknown>;
  /** Bu satırda Mikro'dan okunamayan LEAD alan adları. */
  bilinmeyen: string[];
}

/** Not/sayaç sırası — `cariEslemeOzeti` bu sırayı kullanır. */
const CARI_ALANLARI = ['company', 'email', 'phone', 'taxId', 'taxOffice', 'eFaturaKayitli', 'type'] as const;
/**
 * Cari KRİTİK alanları — okuma arızası yalnız bunlarda aranır.
 * • `company` (`cari_unvan1`): Mikro'da unvansız cari kartı açılamaz.
 * • `eFaturaKayitli` / `type`: BİT/TINYINT kolonları; her satır 0 ya da 1 döner.
 *   Hiçbirinin okunamaması ancak kolonun kaybolmasıyla açıklanır.
 * E-posta/telefon/VKN/vergi dairesi DIŞARIDA: inşaat toptancısı carilerinin çoğunda
 * bunlar meşru olarak boştur — kalıcı yanlış alarm üretiyorlardı (2026-09-19).
 */
export const CARI_KRITIK = ['company', 'eFaturaKayitli', 'type'] as const;

/**
 * Mikro `CariListesiV2` satırı → lead alanları. `cari_kod` yoksa null (satır atlanır).
 *
 * `name` bilinçli istisnadır: unvan okunamazsa cari koduna düşer (her iki rotanın
 * bugünkü davranışı). Bu uydurma bir değer değil, kaydın KİMLİĞİDİR — adı boş bir
 * lead CRM listesinde hiç görünmez ve eşleştirmesi imkânsız hâle gelir.
 */
export function cariEsle(satir: Satir, secenek: CariEslemeSecenek): CariEsleme | null {
  const cariKod = metin(satir.cari_kod);
  if (!cariKod) return null;

  const bilinmeyen: string[] = [];
  const alanlar: Record<string, unknown> = {};
  /** YALNIZ yeni kayıtta yazılacaklar — güncellemede bunlara HİÇ dokunulmaz. */
  const yeniKayitAlanlari: Record<string, unknown> = { status: 'Active' };

  /**
   * Bilinmeyen METİN alanı: güncellemede yazılmaz (mevcut değer korunur), YENİ kayıtta
   * `''` ile açılır. `''` burada uydurma bir değer DEĞİLDİR — yeni kaydın ezilecek bir
   * geçmişi yoktur ve `Lead` tipi bu alanları `string` ilan eder; alan hiç yazılmazsa
   * okuyan ekranlar (`l.email.toLowerCase()`) TypeError ile çöker. `personelEsle` aynı
   * kapıyı taşıyor (eslemeVarlik: "HRModule `e.position.toLowerCase()` çağırıyor").
   * Alan yine `bilinmeyen`e düşer, yani sayaç ve okuma arızası kapısı etkilenmez.
   */
  const metinAlani = (lead: string, ham: string | null): void => {
    if (ham) { alanlar[lead] = ham; return; }
    bilinmeyen.push(lead);
    yeniKayitAlanlari[lead] = '';
  };

  const unvan = metin(satir.cari_unvan1);
  // `alanlar` GÜNCELLEMEDE de yazılır (saatlik cron + iki rota): unvan okunamadığında kimlik yedeği (cari kodu)
  // yalnız YENİ kayda konur — aksi hâlde tek bir bozuk okuma TÜM lead adlarını cari koduna çevirirdi
  // (2026-09-19 kapanış incelemesi; stok tarafındaki "Mikro ad boşsa mevcut kaydı EZME" kuralının cari karşılığı).
  if (unvan) alanlar.name = unvan; else yeniKayitAlanlari.name = cariKod;
  metinAlani('company', unvan);

  const metinAlanlari: Array<[lead: string, mikro: string]> = [
    ['email', 'cari_EMail'],
    ['phone', 'cari_CepTel'],
    ['taxId', 'cari_vdaire_no'],
    ['taxOffice', 'cari_vdaire_adi'],
  ];
  for (const [lead, mikro] of metinAlanlari) metinAlani(lead, metin(satir[mikro]));

  // BAYRAK/TİP KODU — `bilinenSayi` ile: `Number(x ?? 0)` burada meşru görünür ama
  // "0" bu iki alanda ANLAMLI bir cevaptır (e-faturaya kayıtlı DEĞİL / müşteri),
  // yani okunamayan hücre gerçek bir iddiaya dönüşür. Bu yüzden bilinmiyorsa yazılmaz.
  const efatura = bayrak(satir.cari_efatura_fl);
  if (efatura !== null) alanlar.eFaturaKayitli = efatura === 1;
  else bilinmeyen.push('eFaturaKayitli');

  const hareketTipi = bayrak(satir.cari_hareket_tipi);
  if (hareketTipi !== null) alanlar.type = hareketTipi === 1 ? 'Supplier' : 'Customer';
  else bilinmeyen.push('type');

  alanlar.mikroCariKod = cariKod;
  alanlar.mikroSynced = true;
  alanlar.mikroSyncedAt = secenek.zamanDamgasi;
  alanlar.companyId = secenek.companyId;   // güncellemede de etiketle (self-heal)

  return { cariKod, alanlar, yeniKayitAlanlari, bilinmeyen };
}

/** Sayfa(lar)daki tüm eşlemelerin özeti — rota bunu `note`'a yazar. */
export function cariEslemeOzeti(eslemeler: readonly CariEsleme[]): EslemeOzeti {
  return ozetKur(eslemeler.map(e => e.bilinmeyen), CARI_ALANLARI, CARI_KRITIK);
}

// ── 2) Cari bakiyesi ─────────────────────────────────────────────────────────
export interface BakiyeEsleme {
  cariKod: string;
  /** İŞARETİ KORUNMUŞ bakiye; okunamadıysa null — 0 DEĞİL. */
  bakiye: number | null;
}

/** `SELECT cha_kod, SUM(...) AS bakiye` satırı → cari kodu + bakiye. Kodsuz satır null. */
export function bakiyeEsle(satir: Satir): BakiyeEsleme | null {
  const cariKod = metin(satir.cha_kod);
  if (!cariKod) return null;
  // bilinenSayi: `''` reddedilir. Eski kod `Number.isFinite(Number(''))` kullanıyordu
  // ve Number('') === 0 olduğu için BOŞ hücreyi geçerli "sıfır bakiye" sayıyordu.
  return { cariKod, bakiye: bilinenSayi(satir.bakiye) ? Number(satir.bakiye) : null };
}

export interface BakiyeHaritasi extends EslemeOzeti {
  /** cari kodu → bakiye (yalnız BİLİNENLER). */
  harita: Map<string, number>;
  /** Bakiyesi okunamayan satır sayısı (rota yanıtındaki `unreadable`). */
  okunamayan: number;
  /**
   * Satırı GELDİĞİ hâlde bakiyesi okunamayan ve BAŞKA hiçbir satırda bilinmeyen cari
   * kodları. Rota bunlara HİÇBİR ŞEY YAZMAMALI: `cariBakiyesi` haritada olmayana 0
   * döner ve o 0 yalnız "Mikro'da hiç hareketi yok" hâlinde doğrudur. İki hâli ayıran
   * tek şey bu küme (hakem bulgusu 2026-09-19 — 48.000 TL borçlu cari, bakiyesi
   * okunamadığı için tahsilat ekranında 0 görünüyordu).
   */
  okunamayanKodlar: Set<string>;
}

/**
 * Tüm bakiye satırlarını haritalar. `okumaArizasi` DOLU dönerse rota HİÇBİR ŞEY
 * YAZMAMALI (502): harita boşken cari döngüsü her cariye 0 yazar, yani tüm bakiyeleri
 * sıfırlar. Rotanın kendi ilkesi zaten bu: "Sorgu başarısızsa bakiyeleri sıfırlamak,
 * bilgi vermemekten çok daha kötü — tahsilat kararları bu rakama bakıyor."
 */
export function bakiyeHaritasi(satirlar: readonly Satir[]): BakiyeHaritasi {
  const harita = new Map<string, number>();
  const bilinmeyenListeleri: string[][] = [];
  const adaylar = new Set<string>();        // bakiyesi okunamayan satırı OLAN cari kodları
  let okunamayan = 0;
  for (const satir of satirlar) {
    const e = bakiyeEsle(satir);
    if (!e) continue;                       // kodsuz satır: eşleştirilemez, sayılmaz
    if (e.bakiye === null) { okunamayan++; bilinmeyenListeleri.push(['bakiye']); adaylar.add(e.cariKod); continue; }
    bilinmeyenListeleri.push([]);
    harita.set(e.cariKod, e.bakiye);        // bilinmeyen satır bileni EZMEZ (yukarıda continue)
  }
  // Aynı cari hem bilinen hem bilinmeyen satırla gelebilir (GROUP BY'a rağmen ayrı
  // sayfalardan): BİLİNEN kazanır, kod arızalı listesinden düşer. Bu yüzden eleme
  // döngünün SONUNDA yapılır — satır sırasına bağlı olmaz.
  const okunamayanKodlar = new Set([...adaylar].filter(kod => !harita.has(kod)));
  // `bakiye` sorgunun KENDİ SELECT'indeki tek değer kolonudur — hiçbir satırda
  // okunamıyorsa bu veri değil şema sorunudur, yani kritiktir.
  return { harita, okunamayan, okunamayanKodlar, ...ozetKur(bilinmeyenListeleri, ['bakiye'], ['bakiye']) };
}

/**
 * Bir carinin yazılacak bakiyesi. Haritada YOKSA 0 — bu, modüldeki TEK meşru sıfır
 * varsayılanıdır ve yalnız sorgu BAŞARILI olup satır döndürdüğünde geçerlidir:
 * Mikro'da hiç hareketi olmayan cari SQL'de satır olarak yoktur, bu gerçekten sıfır
 * bakiyedir. Sorgu hata verdiyse veya hiç satır dönmediyse rota bu fonksiyona HİÇ
 * gelmez (502 / erken dönüş).
 *
 * ⚠️ ÇAĞIRMADAN ÖNCE `okunamayanKodlar` KONTROL EDİLMELİ. "Haritada yok"un İKİNCİ bir
 * nedeni daha vardır ve anlamı TERSTİR: satır geldi ama bakiyesi okunamadı. O cari bu
 * fonksiyona hiç sokulmamalı (rota `continue` eder) — aksi hâlde bilinmeyen bakiye
 * 0 olarak yazılır.
 */
export function cariBakiyesi(harita: ReadonlyMap<string, number>, cariKod: string): number {
  return harita.has(cariKod) ? harita.get(cariKod)! : 0;
}

// ── 3) Cari adresleri ────────────────────────────────────────────────────────
/** Adres alan eşlemesi — not/sayaç sırası da budur. */
const ADRES_ALANLARI: Array<[lead: string, mikro: string]> = [
  ['address', 'adr_cadde'],
  ['district', 'adr_ilce'],
  ['city', 'adr_il'],
  ['country', 'adr_ulke'],
];
/**
 * Adres KRİTİK alanları: cadde ve il. `district`/`country` DIŞARIDA — ilçe girilmemiş
 * adres kartı ve yurt içi carilerde boş `adr_ulke` olağandır; ikisi kritik sayılınca
 * her adres import'u yanlış şema alarmı üretiyordu (2026-09-19).
 */
export const ADRES_KRITIK = ['address', 'city'] as const;

/**
 * Cari başına kullanılacak adres satırını seçer: en küçük BİLİNEN `adr_adres_no`.
 * Adres no'su okunamayan satır EN SONA gider — yalnız o cari için bilinen no'lu hiç
 * satır yoksa seçilir. Eski `Number(row.adr_adres_no ?? 0)` bunun tam TERSİNİ yapıyor,
 * no'su okunamayan satırı 0 sayıp yarışı daima kazandırıyordu (havalimanı şubesi
 * merkez adresin yerine geçer). Eşitlikte İLK satır kalır — kararlı seçim.
 */
export function adresSec(satirlar: readonly Satir[]): Map<string, Satir> {
  const secilen = new Map<string, Satir>();
  const secilenNo = new Map<string, number | null>();
  for (const satir of satirlar) {
    const kod = metin(satir.adr_cari_kod);
    if (!kod) continue;
    const no = bilinenSayi(satir.adr_adres_no) ? Number(satir.adr_adres_no) : null;
    if (!secilen.has(kod)) { secilen.set(kod, satir); secilenNo.set(kod, no); continue; }
    const mevcutNo = secilenNo.get(kod) ?? null;
    // Bilinen no bilinmeyeni yener; iki bilinenden küçüğü kazanır; eşitlikte ilk kalır.
    const dahaIyi = mevcutNo === null ? no !== null : (no !== null && no < mevcutNo);
    if (dahaIyi) { secilen.set(kod, satir); secilenNo.set(kod, no); }
  }
  return secilen;
}

/**
 * Lead'in adres güncellemesi — SADECE BOŞ ALANLARI DOLDURUR (EKLE, YERİNE KOYMA):
 * elle düzeltilmiş bir city/address ÜZERİNE YAZMAZ. Yazacak bir şey yoksa null.
 * Doldurulan kayıt `addressSource: 'mikro-heuristic'` ile işaretlenir (adres seçimi
 * sezgiseldir — bkz. dosya başı).
 */
export function adresGuncellemesi(mevcut: Satir, adres: Satir): Record<string, unknown> | null {
  const guncelleme: Record<string, unknown> = {};
  for (const [lead, mikro] of ADRES_ALANLARI) {
    const yeni = metin(adres[mikro]);
    // `metin` yalnız boşluktan oluşan mevcut değeri de null sayar → "dolu" saymaz.
    if (yeni && metin(mevcut[lead]) === null) guncelleme[lead] = yeni;
  }
  if (!Object.keys(guncelleme).length) return null;
  guncelleme.addressSource = 'mikro-heuristic';
  return guncelleme;
}

/**
 * Adres satırlarının özeti. Dört adres alanının HEPSİ tüm satırlarda boşsa kolon adı
 * değişmiş olabilir (`adr_cadde` → ?): `okumaArizasi` dolu döner, rota notun başına
 * uyarı yazar + `console.warn` basar. Adres import'u zaten hiçbir şeyi silmediği için
 * bu bir uyarıdır, durdurma değil.
 */
export function adresOzeti(satirlar: readonly Satir[]): EslemeOzeti {
  const listeler: string[][] = [];
  for (const satir of satirlar) {
    if (!metin(satir.adr_cari_kod)) continue;
    listeler.push(ADRES_ALANLARI.filter(([, mikro]) => metin(satir[mikro]) === null).map(([lead]) => lead));
  }
  return ozetKur(listeler, ADRES_ALANLARI.map(([lead]) => lead), ADRES_KRITIK);
}
