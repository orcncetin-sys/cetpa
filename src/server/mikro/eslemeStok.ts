/**
 * eslemeStok.ts — Mikro'dan OKUNAN stok/fiyat/miktar satırlarının Cetpa dokümanına
 * eşlemesi, TEK KAYNAK ve SAF (ağ/DB/express yok). Faz 3 3/n "eslemeStok" grubu, 2026-09-19.
 * Test: eslemeStok.test.ts (ÖNCE yazıldı).
 *
 * ── NEDEN VAR ───────────────────────────────────────────────────────────────────
 * Eşleme, `mikroRoutes.ts`in içinde satır içi duruyordu ve dört ayrı yerde "bilinmeyen
 * değeri 0 yaz" kapısı taşıyordu. Bunlar (dosyadaki eski konumlarıyla):
 *
 *   • ~2277 `/api/mikro/import/fiyat`:
 *       price: birlesik['Retail'] ?? mevcut['Retail'] ?? 0
 *     Mikro'da yalnız bayi/B2B kademesi tanımlı bir üründe Retail HİÇ yoktur; bu satır
 *     elle girilmiş perakende fiyatını her senkronda **0 TL** yapıyordu. (Aynı sınıf
 *     stok import'unda 2026-09-05'te kapatılmıştı; fiyat import'unda kalmıştı.)
 *   • ~2631 `/api/mikro/import/stok-miktar`:
 *       const totalCost = Number(d.MaliyetBedeli ?? 0)  →  costPrice: 0
 *     Yanıtta maliyet alanı yoksa ürünün gerçek maliyeti **0 TL** yazılıyordu; kâr/zarar
 *     ve teklif marjı bu alandan besleniyor.
 *   • ~2601 `/api/mikro/import/stok-miktar` per-depo döngüsü:
 *       const bakiye = Number(row.bakiye ?? 0)
 *     `bakiye` sayı değilse (kolon adı değişti / metin döndü) `Number('abc') = NaN`,
 *     `NaN === 0` false olduğu için satır ELENMİYOR ve `depoBreakdown`a **NaN** düşüyordu.
 *   • ~709 `/api/mikro/import/stok`:
 *       lowStockThreshold: 5   (her güncellemede koşulsuz)
 *     Kullanıcı ProductForm'dan eşiği 50 yapıyor, bir sonraki "Stokları İçeri Al" onu
 *     sessizce 5'e döndürüyordu.
 *
 * ── SÖZLEŞME ────────────────────────────────────────────────────────────────────
 * Bir alan Mikro okumasından BİLİNMİYORSA dönen `alanlar` nesnesinde HİÇ BULUNMAZ —
 * `batch.update` / `set(..., {merge:true})` o alana dokunmaz, mevcut değer korunur.
 * `null` da YAZILMAZ: Mikro okuması geçici bozulduğunda toplu null'lama tüm fiyatları
 * silerdi; bayat değer, silinmiş değerden iyidir. Bilinmeyen alan `bilinmeyen[]`e
 * düşer; rota bunları `sayacaEkle` ile toplar ve import notuna "N satırın X bilinmiyor"
 * yazar. Bir alan satırların TAMAMINDA (≥5 satırlık importta) bilinmiyorsa bu veri
 * değil OKUMA ARIZASIDIR (`okumaArizalari`) — notun BAŞINA uyarı girer + console.warn.
 *
 * ── BİLİNÇLİ FARKLAR (parite dışı, hepsi yukarıdaki sınıfın düzeltmesi) ──────────
 *   1. `price` yalnız Retail BİLİNİYORSA ve > 0 ise yazılır (eski `?? 0` kaldırıldı).
 *   2. `costPrice` yalnız MaliyetBedeli biliniyorsa yazılır.
 *   3. Per-depo `bakiye` sayı değilse satır atlanır (NaN yazılmaz).
 *   4. `lowStockThreshold: 5` yalnız YENİ kayıtta (mevcut yokken) yazılır.
 *   5. MEVCUT kayıtta Mikro `sto_isim`/`sto_grup_*`/`sto_birim1_ad` boşsa ad/kategori/
 *      birim EZİLMEZ (eski kod `|| sku`, `|| 'Genel'`, `|| 'ADET'` ile elle düzeltilmiş
 *      adı SKU'ya çeviriyordu). YENİ kayıtta eski yedekler aynen yazılır — doküman
 *      adsız açılamaz — ama yine de sayaca girer.
 *   6. Miktarı okunamayan satırda MaliyetBedeli de OKUNUR (yazılan alan DEĞİŞMEZ,
 *      yalnız sayılır): erken dönülürse sayaç paydası tutarsız kalır ve "hiçbir satırda
 *      okunamadı" kapısı hiç tetiklenmez (hakem bulgusu 2026-09-19). Aynı kapının rota
 *      tarafındaki eşi: yanıtı HİÇ okunamayan SKU sayaca girmez (`okunamadi` bayrağı).
 * Bunlar dışında bilinen girdide çıktı eskiyle BİREBİR aynıdır (parite testleri).
 *
 * ── ROTADAN TAŞINAN CANLI DOĞRULAMA NOTLARI ─────────────────────────────────────
 *   • `sto_perakende_vergi` bir YÜZDE DEĞİL, VergiListesiV2 sıra numarasıdır
 *     (2026-07-31: envantere `vatRate: 4` yazılmış, teklif ekranı %4 KDV uygulamıştı).
 *     Çözülemezse alan yazılmaz — %20 UYDURULMAZ (bkz. vergiOraniCoz).
 *   • Fiyat kaynağı stok kartı DEĞİL ayrı tablodur: bu kurulumda `sto_satis_fiyat1`
 *     kolonu HİÇ YOK ("Invalid column name"), fiyatlar STOK_SATIS_FIYAT_LISTELERI'nde
 *     ve tek liste (Retail) dolu (2026-08-11 şema keşfi). `mikroSatisFiyatlari` iki
 *     kaynağı da dener; 0/boş "fiyat YOK" sayılır ve DÖNMEZ.
 *   • `sto_yer_kod` bu kurulumda ürünlerin TAMAMINDA boş; depo eşlemesi bu alandan
 *     TÜRETİLMEZ (eski `|| '1'` tüm stoğu HAVALİMANI deposunda gösteriyordu). Depo
 *     yeri per-depo hareket toplamından gelir — bkz. `depoSatiriCoz`.
 *   • `MaliyetBedeli` TOPLAM maliyettir; birim maliyet = toplam / miktar (miktar 0 ise
 *     hesaplanamaz, bu bir okuma arızası değildir).
 *
 * Kiracı izolasyonu, sayfalama, batch ve mutabakat (devir kovası) mantığı ROTADA kalır —
 * bu modül tek bir satırı nesneye çevirir, başka hiçbir şey bilmez.
 */
import { bilinenSayi } from '../../utils/para.js';
import { mikroStokMiktari, mikroSatisFiyatlari, vergiOraniCoz } from '../mikroClient.js';

/** Eşleme çıktısı: yazılacak alanlar + bu satırda okunamayan alanların adları. */
export interface EslemeSonucu<T> {
  /** Doğrudan `batch.update` / `set(..., {merge:true})` gövdesine yayılır.
   *  Bilinmeyen alan BURADA HİÇ BULUNMAZ (0/null ile doldurulmaz). */
  alanlar: T;
  /** İnsan okunur alan adları — import notundaki sayaca girer. */
  bilinmeyen: string[];
}

/** Boş/boşluk olmayan metni döndürür, aksi hâlde null (`|| yedek` yerine açık kapı). */
function metin(x: unknown): string | null {
  if (typeof x === 'number' && Number.isFinite(x)) return String(x);
  const s = typeof x === 'string' ? x.trim() : '';
  return s === '' ? null : s;
}

/** Bilinen sonlu sayı → number, aksi hâlde null. */
function sayi(x: unknown): number | null {
  return bilinenSayi(x) ? Number(x) : null;
}

// ── 1. Stok kartı → inventory ────────────────────────────────────────────────

export interface StokAlanlari {
  sku: string;
  name?: string;
  category?: string;
  unit?: string;
  vatRate?: number;
  stockLevel?: number;
  lowStockThreshold?: number;
  prices?: Record<string, number>;
  price?: number;
  mikroStoKod: string;
  mikroSynced: true;
  source: 'mikro_import';
}

/**
 * StokListesiV2 satırı → `inventory` dokümanı alanları.
 *
 * @param row     Mikro satırı (`sto_*`). `sto_kod` boşsa çağıran satırı zaten atlar.
 * @param mevcut  Eşleşen Cetpa dokümanının MEVCUT verisi (yoksa yeni kayıt açılıyor demektir).
 *                Sadece "bu alanı yazmasam da bir değer kalır mı?" kararında kullanılır.
 * @param sec.vergiTablosu `mikroVergiOranlari()` çıktısı (sıra no → yüzde). Yoksa vatRate yazılmaz.
 *
 * `companyId` ve `mikroSyncedAt` ROTANIN işidir (kiracı + sunucu zaman damgası).
 */
export function stokEsle(
  row: Record<string, unknown>,
  mevcut?: Record<string, unknown> | null,
  sec?: { vergiTablosu?: Map<number, number> },
): EslemeSonucu<StokAlanlari> {
  const sku = metin(row.sto_kod) ?? '';
  const bilinmeyen: string[] = [];
  const alanlar: StokAlanlari = {
    sku,
    mikroStoKod: sku,
    mikroSynced: true,
    // Güncellemede de yazılır (parite): `/api/mikro/import/stok-miktar` ürünleri
    // `where('source','==','mikro_import')` ile seçiyor — elle açılmış ama Mikro'da
    // eşleşen ürün damgalanmazsa miktarı hiç güncellenmez.
    source: 'mikro_import',
  };

  /** Metin alanı: Mikro biliyorsa yaz; bilmiyorsa MEVCUDU KORU, yoksa yedekle aç. */
  const metinAlani = (ad: string, ham: string | null, mevcutDeger: unknown, yedek: string) => {
    if (ham !== null) return ham;
    bilinmeyen.push(ad);
    return metin(mevcutDeger) !== null ? undefined : yedek;
  };

  const ad  = metinAlani('ürün adı', metin(row.sto_isim), mevcut?.name, sku);
  const kat = metinAlani('kategori', metin(row.sto_grup_isim) ?? metin(row.sto_grup_kodu), mevcut?.category, 'Genel');
  const bir = metinAlani('birim', metin(row.sto_birim1_ad), mevcut?.unit, 'ADET');
  if (ad  !== undefined) alanlar.name = ad;
  if (kat !== undefined) alanlar.category = kat;
  if (bir !== undefined) alanlar.unit = bir;

  // KDV: işaretçi → gerçek yüzde. Tablo yoksa/çözülemezse alan YAZILMAZ.
  const kdv = sec?.vergiTablosu ? vergiOraniCoz(row.sto_perakende_vergi, sec.vergiTablosu) : null;
  if (kdv !== null) alanlar.vatRate = kdv; else bilinmeyen.push('KDV oranı');

  // Miktar: alan hiç yoksa null → mevcut stockLevel EZİLMEZ (yeni kayıt rotada 0 ile açılır).
  const qty = mikroStokMiktari(row);
  if (qty !== null) alanlar.stockLevel = qty; else bilinmeyen.push('stok miktarı');

  // Kullanıcının girdiği eşiği senkron EZMESİN: yalnız yeni kayıtta varsayılan.
  if (!mevcut) alanlar.lowStockThreshold = 5;

  // Fiyat: boş nesne YAZILMAZ (elle girilen fiyatları `{}` ile ezerdi).
  const prices = mikroSatisFiyatlari(row);
  if (Object.keys(prices).length) {
    alanlar.prices = prices;
    // Eski tekil `price` alanı yalnız Retail BİLİNİYORSA — `?? 0` başka kademe varken
    // 0 TL basıyor ve elle girilmiş perakende fiyatını eziyordu.
    if (prices['Retail'] != null) alanlar.price = prices['Retail'];
    else bilinmeyen.push('perakende fiyatı');
  } else {
    bilinmeyen.push('satış fiyatı');
  }

  return { alanlar, bilinmeyen };
}

// ── 2. Fiyat listesi → inventory.prices ──────────────────────────────────────

export interface FiyatAlanlari {
  prices?: Record<string, unknown>;
  price?: number;
  priceCurrency?: 'TRY';
}

/**
 * `/api/mikro/import/fiyat` — birleştirilmiş kademe haritasını yazılacak alanlara çevirir.
 *
 * @param birlesik `{ ...mevcutFiyatlar, ...mikrodanGelenler }` (rotada kurulur; Mikro'dan
 *                 gelmeyen kademe mevcut değeriyle kalır — elle girilen fiyat silinmemeli).
 * @param mevcut   Dokümanın MEVCUT `prices` haritası (Retail yedeği; eski `?? mevcut['Retail']`).
 *
 * `priceCurrency: 'TRY'` BİLEREK sabit: bu import yalnız TL satır yazar (döviz satırları
 * rotada elenir). Aksi hâlde kullanıcının seçtiği eski `priceCurrency` (ör. USD) kalır ve
 * ekran TL tutarı bir kez daha kurla çarpar (~kur katı yanlış).
 */
export function fiyatEsle(
  birlesik: Record<string, unknown>,
  mevcut?: Record<string, unknown> | null,
): EslemeSonucu<FiyatAlanlari> {
  const bilinmeyen: string[] = [];
  const alanlar: FiyatAlanlari = {};

  // Haritada tek bir bilinen pozitif fiyat bile yoksa `prices`e DOKUNMA.
  const bilinenVar = Object.values(birlesik).some(v => { const n = sayi(v); return n !== null && n > 0; });
  if (!bilinenVar) {
    bilinmeyen.push('satış fiyatı');
    return { alanlar, bilinmeyen };
  }

  alanlar.prices = birlesik;
  alanlar.priceCurrency = 'TRY';

  const retail = sayi(birlesik['Retail']) ?? sayi(mevcut?.['Retail']);
  // 0 ve negatif "fiyat YOK" sayılır: yazılırsa ekranda yine 0 TL görünür ve elle
  // girilmiş perakende fiyatını ezer (sessiz-sıfır sınıfı).
  if (retail !== null && retail > 0) alanlar.price = retail;
  else bilinmeyen.push('perakende fiyatı');

  return { alanlar, bilinmeyen };
}

// ── 3. Miktar/maliyet yanıtı → inventory ─────────────────────────────────────

export interface StokMiktarAlanlari {
  stockLevel?: number;
  costPrice?: number;
}

/**
 * `/api/mikro/import/stok-miktar` — GenelAmacliMaliyetListesiV2 `Data` gövdesi → alanlar.
 *
 * `EldekiMiktar` alanı HİÇ YOKSA bu "0 stok" değil "yanıt okunamadı" demektir: hiçbir alan
 * yazılmaz ve çağıran satırı `failed` sayar (0 yazıp başarılı saymak gerçek stoğu siler).
 * `MaliyetBedeli` TOPLAM maliyettir; birim maliyet = toplam / miktar, 2 hane yuvarlanır.
 */
export function stokMiktarEsle(d: Record<string, unknown>): EslemeSonucu<StokMiktarAlanlari> {
  const bilinmeyen: string[] = [];
  const alanlar: StokMiktarAlanlari = {};

  // İKİ ALAN DA HER SATIRDA OKUNUR — miktar okunamadı diye erken dönülürse 'maliyet
  // bedeli' o satırda SAYILMAZ, `n === satır` eşitliği bozulur ve `okumaArizalari`
  // kapısı hiç tetiklenmez (sayaç paydası tutarsız kalır; hakem bulgusu 2026-09-19).
  // Yazılan alanlar değişmez: miktar bilinmeden ne stockLevel ne birim maliyet yazılır.
  const qty = sayi(d.EldekiMiktar);
  if (qty === null) bilinmeyen.push('stok miktarı');
  const toplamMaliyet = sayi(d.MaliyetBedeli);
  if (toplamMaliyet === null) bilinmeyen.push('maliyet bedeli');
  if (qty === null) return { alanlar, bilinmeyen };

  alanlar.stockLevel = qty;
  // Miktar 0/negatifken birim maliyet HESAPLANAMAZ — bu bir okuma arızası değil,
  // matematiksel imkânsızlık; sayaca girmez (parite: eski `qty > 0 ? ... : null`).
  if (toplamMaliyet !== null && qty > 0) alanlar.costPrice = Math.round((toplamMaliyet / qty) * 100) / 100;

  return { alanlar, bilinmeyen };
}

// ── 4. Per-depo bakiye satırı ────────────────────────────────────────────────

export interface DepoSatiri { sku: string; depoNo: string; bakiye: number }

/**
 * STOK_HAREKETLERI per-depo toplam satırı → `{ sku, depoNo, bakiye }`.
 *
 * Bakiye 0 olan satır ATLANIR ama bu BİLİNMEYEN DEĞİLDİR (gerçekten sıfır bakiye —
 * SQL zaten `HAVING SUM(net) <> 0` süzüyor). Bakiye sayı değilse satır atlanır ve
 * SAYILIR: eski `Number(row.bakiye ?? 0)` metin/NaN durumunda `NaN === 0` false
 * olduğu için satırı eleyemiyor ve `depoBreakdown`a NaN düşürüyordu.
 */
export function depoSatiriCoz(row: Record<string, unknown>): { satir: DepoSatiri | null; bilinmeyen: string[] } {
  const bilinmeyen: string[] = [];
  const sku = metin(row.sth_stok_kod);
  const depoNo = metin(row.depo);
  const bakiye = sayi(row.bakiye);
  if (sku === null) bilinmeyen.push('stok kodu');
  if (depoNo === null) bilinmeyen.push('depo numarası');
  if (bakiye === null) bilinmeyen.push('depo bakiyesi');
  if (sku === null || depoNo === null || bakiye === null || bakiye === 0) return { satir: null, bilinmeyen };
  return { satir: { sku, depoNo, bakiye }, bilinmeyen };
}

// ── 5. Bilinmeyen sayacı + okuma arızası ─────────────────────────────────────

export interface BilinmeyenSayaci {
  /** İşlenen satır sayısı (arıza eşiği bunun üstünden hesaplanır). */
  satir: number;
  /** Alan adı → o alanın bilinmediği satır sayısı. Ekleme sırası korunur (Map). */
  alanlar: Map<string, number>;
}

export function sayacOlustur(): BilinmeyenSayaci {
  return { satir: 0, alanlar: new Map() };
}

/** Bir satırı sayaca işler (bilinmeyen boş olsa da satır sayılır — eşik için şart). */
export function sayacaEkle(sayac: BilinmeyenSayaci, bilinmeyen: readonly string[]): void {
  sayac.satir++;
  for (const alan of bilinmeyen) sayac.alanlar.set(alan, (sayac.alanlar.get(alan) ?? 0) + 1);
}

/**
 * Import notuna eklenecek sayaç metni; hiç bilinmeyen yoksa boş string.
 *
 * `arizalar` ZATEN uyarı cümlesinde geçen alanlardır ve burada ATLANIR — aksi hâlde
 * aynı bilgi notta iki kez görünür ("UYARI: stok miktarı hiçbir satırda okunamadı …
 * — 2367 satırın stok miktarı bilinmiyor"). Parametre ZORUNLU (eslemeVarlik
 * `bilinmeyenNotu` ile aynı yaklaşım): unutulan dışlama sessizce çift not üretirdi.
 */
export function sayacNotu(sayac: BilinmeyenSayaci, arizalar: readonly string[]): string {
  const arizaSeti = new Set(arizalar);
  return [...sayac.alanlar]
    .filter(([alan]) => !arizaSeti.has(alan))
    .map(([alan, n]) => `${n} satırın ${alan} bilinmiyor`)
    .join(', ');
}

/**
 * KRİTİK alan kümeleri — okuma arızası YALNIZ burada aranır.
 *
 * 2026-09-19 delta bulgusu (aynı gün `eslemeVarlik`te DEMIRBAS_KRITIK vb. ile kapatılan
 * sınıfın stok hattındaki eşi): tarama sayaçtaki TÜM alanlara bakıyordu. Oysa
 * `StokListesiV2` ANLIK MİKTAR TAŞIMAZ — `mikroClient.ts` notu: "STOKLAR tablosunda
 * anlık miktar kolonu yok … liste uçları yalnız kart verisi taşır"; miktarın kaynağı
 * `GenelAmacliMaliyetListesiV2` (/api/mikro/import/stok-miktar). Bu kurulumda fiyat da
 * ayrı tablodadır (`sto_satis_fiyat1` kolonu HİÇ YOK, 2026-08-11 şema keşfi). Sonuç:
 * HER stok import'u "UYARI: stok miktarı hiçbir satırda okunamadı — kolon adı/şema
 * kontrol edin" ile başlıyordu. Kalıcı yanlış alarm, GERÇEK arızayı (ör. `sto_isim`
 * kolonunun kayması) aynı cümlenin içinde ayırt edilemez kılar.
 *
 * Kritik alan = boşluğu ancak kolon adının değişmesiyle / şema keşfinin boş dönmesiyle
 * açıklanabilen alan. Miktar ve fiyat bu tanıma STOK KARTI import'unda GİRMEZ; miktar
 * kendi rotasında (STOK_MIKTAR_KRITIK) girer. Fiyat kapsamını not zaten ayrıca veriyor
 * ("X/Y üründe satış fiyatı bulundu").
 */
/** Stok kartı: kategori/birim meşru olarak boş olabilir, miktar/fiyat başka kaynaktan gelir. */
export const STOK_KRITIK = ['ürün adı', 'KDV oranı'] as const;
/** Fiyat import'u: 'perakende fiyatı' YOK — Mikro'da yalnız bayi kademesi tanımlı olabilir. */
export const FIYAT_KRITIK = ['satış fiyatı'] as const;
/** Stok-miktar rotasının TEK işi miktardır; 'maliyet bedeli' meşru olarak gelmeyebilir. */
export const STOK_MIKTAR_KRITIK = ['stok miktarı'] as const;
/** Per-depo: üçü de SQL'in kendi SELECT'indeki kolonlar — biri hiç okunamıyorsa şema sorunu. */
export const DEPO_KRITIK = ['stok kodu', 'depo numarası', 'depo bakiyesi'] as const;

/**
 * Bir KRİTİK alan satırların TAMAMINDA bilinmiyorsa bu veri değil OKUMA ARIZASIDIR
 * (kolon adı değişti / şema keşfi boş döndü). Küçük importta tesadüf olabileceği için
 * en az `esik` satır aranır.
 *
 * `kritikAlanlar` ZORUNLUDUR (eslemeVarlik `okumaArizasi` ile aynı gerekçe): isteğe
 * bağlı bir süzgeç unutulduğunda kalıcı yanlış alarm sessizce geri gelirdi; eksik
 * bırakan çağrı artık DERLENMEZ. Dönüş sırası kritik liste sırasıdır (deterministik).
 */
export function okumaArizalari(
  sayac: BilinmeyenSayaci,
  kritikAlanlar: readonly string[],
  esik = 5,
): string[] {
  if (sayac.satir < esik) return [];
  return kritikAlanlar.filter(alan => sayac.alanlar.get(alan) === sayac.satir);
}

/** Notun BAŞINA girecek uyarı; arıza yoksa boş string. Çağıran ayrıca `console.warn` basar. */
export function okumaArizasiNotu(alanlar: readonly string[]): string {
  if (!alanlar.length) return '';
  return `UYARI: ${alanlar.join(', ')} hiçbir satırda okunamadı — kolon adı/şema kontrol edin.`;
}
