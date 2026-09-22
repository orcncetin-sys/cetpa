/**
 * stokTalep.ts — ürün talebi → günlük talep → kalan gün → öneri adedi, TEK KAYNAK
 * (Faz 3 6a, 2026-09-19). Test: `stokTalep.test.ts` (önce yazıldı, kırmızı görüldü).
 * Saf modül: React/DB/kullanıcı metni yok.
 *
 * ## NEDEN VAR
 * AYNI sekmede iki panel "ürün başına günlük talep → kalan gün" hesaplıyor ve İKİ FARKLI
 * sonuç veriyordu:
 *
 *   `GenelOzet.tsx:398-450` (Phase 148 "Stok Tükenme Tahmini")
 *   `RaporlarPage.tsx:718-765` (Phase 619 "Akıllı Sipariş Önerisi")
 *
 *  1. **Eşleme.** P148 `l.inventoryId === i.id || l.name === i.name`, P619 `li.sku === item.sku`.
 *     Aynı kalem bir panelde eşleşip diğerinde eşleşmiyordu; ikisinin de boş anahtar kapısı yoktu
 *     (`'' === ''` serbest satırı — "Nakliye bedeli" — katalogdaki adsız/SKU'suz İLK karta bağlıyordu).
 *  2. **Sipariş başına kalem.** P148 `find` ile yalnız İLK eşleşen kalemi topluyordu: aynı siparişte
 *     iki kez geçen ürünün ikinci satırı sessizce kayboluyor, talep olduğundan az çıkıyordu.
 *  3. **Miktar bilinmiyor.** P148 `li?.quantity || 0` → "satılmadı"; P619 korumasız `+` → NaN →
 *     `|| 0` → ürün öneri listesinden TAMAMEN düşüyordu. İkisi de eksik talebi "az talep" sayıyor,
 *     yani stoksuz kalma uyarısını GECİKTİRİYORDU.
 *  4. **Stok bilinmiyor.** P148 ham `i.stockLevel > 0` ile sessizce eliyor; P619 `item.stockLevel || 0`
 *     ile **"0 gün kaldı" KIRMIZI kartı + satın alma önerisi** basıyordu — stok seviyesi hiç girilmemiş
 *     bir kart için uydurma acil sipariş.
 *  5. **Pencere.** P148 sabit 30 gün; P619 kullanıcı girdisi — alan boşaltılınca `Number('') === 0`,
 *     payda 0, ekranda "NaN adet".
 *
 * Tek yardımcı, tek eşleme kuralı, tek miktar kuralı. Bölme KOPYASI yok: günlük talep
 * MEVCUT `pano/hedefButce.satisHizi(cikis, gun).gunluk`; stok MEVCUT `pano/finansKpi.stokSeviyesi`;
 * tarih MEVCUT `pano/ciroDonem.ciroTarihi`; eşleme MEVCUT `siparisler/siparisKarlilik.stokKartiBul`
 * + `pano/raporMarj.stokKartiCozucu`.
 *
 * ## SÖZLEŞME (src/utils/para.ts — İKİ SÖZLEŞME, KARIŞTIRMA)
 *   • `UrunTalebi.talep` değerleri EKRAN toplamı `Tutar`dır: bilinen kısmi toplam + `bilinmeyen`
 *     sayacı ("N kalemin miktarı bilinmiyor").
 *   • `gunluk` / `kalan` TÜRETMEdir: çıkışta ya da stokta TEK bilinmeyen bile varsa hesaplanmaz
 *     (null). Bağlama o hâlde çubuk/rozet ÇİZMEZ, "—" + neden basar.
 *
 * ## PARİTE
 * Tüm kalemleri eşleşen, miktarı ve stoğu bilinen ürünlerde sayı eskiyle BİREBİR:
 * günlük = Σmiktar / pencereGun; kalan = stok / günlük (ham — yuvarlama çağıranda: P148
 * `Math.round`, P619 `Math.floor`); öneri = ceil(günlük × kapsama × katsayı).
 *
 * ## BİLİNÇLİ FARKLAR
 *  1. **Sipariş başına TÜM eşleşen kalemler sayılır** (P148'in `find` kuralı düştü) — aynı siparişte
 *     iki satır olarak geçen ürünün talebi artık tam.
 *  2. **Tarih zinciri `createdAt` → `syncedAt`** (`ciroTarihi`). İki panel de bugün yalnız `createdAt`
 *     okuyor; `createdAt`'i olan her sipariş AYNI güne düşer (parite), yalnız `createdAt`'siz kayıtlar
 *     sessizce düşmek yerine `syncedAt` ile sayılır. `siparis.siparisTarih` BİLEREK kullanılmadı:
 *     sırası `syncedAt` ÖNCE'dir, yeniden eşitlenen siparişi pencereye geri sokardı.
 *  3. **Eksik veri artık SAYILIR, uydurulmaz:** tarihsiz / kalemsiz / eşleşmeyen kalem sayaçları
 *     ekrana yazılır; stoğu ya da miktarı bilinmeyen ürüne gün SAYISI üretilmez (`neden` alanı der ki
 *     niye). "0 gün kaldı" ve 999/Infinity nöbet değerleri YOK.
 *  4. **Geçersiz pencere hesabı durdurur** (`urunTalebi` → null): payda 0 ile "NaN adet" basmak yerine
 *     bağlama "pencere geçersiz" der.
 *
 * ## JIT
 * `gunlukTalep` ve `kalanGun` MODÜL İÇİDİR — 6a'da dış tüketicileri yok, `tukenmeSatirlari`
 * üzerinden sınanır. İlk dış tüketicide (6i adım 0: Envanter "Reorder Forecast") yalnız `export`
 * eklenip doğrudan vakalarla test genişler. `yenidenSiparisNoktasi` / `devirHizi` de oraya.
 *
 * ## SABİTLER BURADA DEĞİL
 * 30 g pencere, ×3 eşik çarpanı, 45 g ufuk, ×2 kapsama katsayısı, ≤7 / ≤20 g renk eşikleri
 * çağıranın ADLANDIRILMIŞ sabitleridir (K20 "ok kalsın" — değerler değişmez, adlandırılır + dipnot).
 * `tukenmeListesi` onları PARAMETRE olarak alır; kendi varsayılanını KURMAZ.
 *
 * ## 2026-09-20 HAKEM TURU — `tukenmeListesi` eklendi
 * P148'in aday kapısı + ufuk süzgeci + üç sayacı 6a bağlamasında `GenelOzet.tsx` içinde satır içi
 * kalmıştı ve testsizdi (şartname başka dosyaya yazmayı yasaklamıştı). Hakem mutasyonu hayatta
 * kaldığı için kural buraya ADDITIVE olarak taşındı; mevcut export'ların sözleşmesi DEĞİŞMEDİ.
 */
// `toplaBilinen` / `tamTutar` / `bilinenSayi` BURADA çağrılmaz: toplama `kovayaEkle`nin (kova
// başına `toplaBilinen` kuralı), türetme kapısı ise `satisHizi`nin (içinde `tamTutar`) içinde.
// `Tutar` tipi ve `sayiSirala` (bilinmeyen HER yönde sonda) dışında `para` yüzeyi kullanılmaz.
import { sayiSirala, type Tutar } from '../para';
import { satisHizi } from '../pano/hedefButce';
import { stokSeviyesi, stokEsigi } from '../pano/finansKpi';
import { ciroTarihi } from '../pano/ciroDonem';
import { BOS_TUTAR, kovayaEkle } from '../pano/raporVeriKatmani';
import { stokKartiBul } from '../siparisler/siparisKarlilik';
import { stokKartiCozucu } from '../pano/raporMarj';

/** Milisaniye cinsinden bir gün — pencere aritmetiği (P619 ile aynı: `86400000`). */
const GUN_MS = 86_400_000;

/** Talep hesabına giren kalem — yapısal (`OrderLineItem` uyar), tipe bağımlı DEĞİL. */
export interface TalepKalemi {
  inventoryId?: unknown;
  sku?: unknown;
  name?: unknown;
  /** Çıkış miktarı; NaN/null/''/undefined = BİLİNMİYOR (0 DEĞİL). */
  quantity?: unknown;
}

/** Talep hesabına giren sipariş. `lineItems` yok/boş = Mikro faturasından türeyen sözde-sipariş. */
export interface TalepSiparisi {
  status?: unknown;
  createdAt?: unknown;
  syncedAt?: unknown;
  lineItems?: readonly TalepKalemi[] | null;
}

/**
 * TEK eşleme kuralı, iki kapılı zincir:
 *   1. kimlik/sku — `siparisKarlilik.stokKartiBul` (P619'un `sku` kuralı + kimlik)
 *   2. bulunamazsa kimlik/ad — `raporMarj.stokKartiCozucu` (P148'in `name` kuralı)
 *
 * BOŞ ANAHTAR EŞLEŞMEZ — iki çözücünün de kendi kapısı var, bu yüzden SKU'su/adı boş serbest
 * satır ("Nakliye bedeli") katalogdaki boş anahtarlı İLK karta BAĞLANMAZ. Her iki basamakta da
 * eşleşme, liste sırasında anahtarlardan birini tutan İLK karttır (mevcut OR semantiği).
 */
export function talepKartCozucu<K extends { id?: unknown; sku?: unknown; name?: unknown }>(
  kartlar: readonly K[],
): (satir: TalepKalemi) => K | null {
  const adCozucu = stokKartiCozucu(kartlar);
  return (satir) => stokKartiBul(kartlar, satir) ?? adCozucu(satir);
}

export interface UrunTalebi<K> {
  /** kart → Σ quantity. Miktarı bilinmeyen kalem toplama GİRMEZ, `Tutar.bilinmeyen`de SAYILIR. */
  talep: Map<K, Tutar>;
  /** Penceredeki (iptal olmayan, tarihi çözülen) sipariş sayısı. */
  penceredeSiparis: number;
  /** Tarihi çözülemeyen (iptal olmayan) sipariş — pencereye GİRMEZ, sayılır. */
  tarihsiz: number;
  /** Penceredeki, `lineItems`'ı boş/eksik sipariş (Mikro sözde-siparişi) — talebi BESLEMEZ. */
  kalemsizSiparis: number;
  /** Hiçbir kartla eşleşmeyen kalem sayısı — sessizce düşmez. */
  eslesmeyenKalem: number;
}

/**
 * Pencere içindeki çıkışı ürün kartı başına toplar. Pencere: `ciroTarihi(o) >= simdi − pencereGun gün`;
 * iptal (`status === 'Cancelled'`) HARİÇ (iki panelle parite).
 *
 * `pencereGun` pozitif sonlu değilse ya da `simdi` geçersiz bir `Date` ise **null** — hesap YAPILMAZ.
 * (Geçersiz `simdi` sözleşmeye 6a'da eklendi: `NaN.getTime()` ile her karşılaştırma false döner, yani
 * tarihli siparişler pencere dışına düşer AMA `tarihsiz` sayacına da girmezdi — sessiz düşme.)
 *
 * Girdi mutasyona uğramaz; tek geçiş (P148 kalem başına tüm siparişleri tarıyordu).
 */
export function urunTalebi<K>(
  siparisler: readonly TalepSiparisi[],
  s: { pencereGun: number; simdi: Date; kartSec: (satir: TalepKalemi) => K | null },
): UrunTalebi<K> | null {
  if (!Number.isFinite(s.pencereGun) || s.pencereGun <= 0) return null;
  const simdiMs = s.simdi.getTime();
  if (!Number.isFinite(simdiMs)) return null;
  const esik = simdiMs - s.pencereGun * GUN_MS;

  const talep = new Map<K, Tutar>();
  let penceredeSiparis = 0, tarihsiz = 0, kalemsizSiparis = 0, eslesmeyenKalem = 0;

  for (const o of siparisler) {
    if (o.status === 'Cancelled') continue;
    // `ciroTarihi` `CiroSiparisi` bekler; yalnız okuduğu iki alanı veriyoruz (tip daraltma,
    // davranış aynı): createdAt ÖNCE, yoksa syncedAt.
    const d = ciroTarihi({ createdAt: o.createdAt, syncedAt: o.syncedAt });
    if (d === null) { tarihsiz++; continue; }
    if (d.getTime() < esik) continue;
    penceredeSiparis++;

    const kalemler = o.lineItems;
    if (!kalemler || kalemler.length === 0) { kalemsizSiparis++; continue; }

    for (const kalem of kalemler) {
      const kart = s.kartSec(kalem);
      if (kart === null) { eslesmeyenKalem++; continue; }
      talep.set(kart, kovayaEkle(talep.get(kart) ?? BOS_TUTAR, kalem.quantity));
    }
  }

  return { talep, penceredeSiparis, tarihsiz, kalemsizSiparis, eslesmeyenKalem };
}

/**
 * MODÜL İÇİ (JIT — 6a'da dış tüketicisi yok). `satisHizi` sarmalayıcısı: çıkışta tek bilinmeyen
 * kalem bile varsa ya da gün sayısı pozitif sonlu değilse **null** — kısmi çıkıştan "12 gün"
 * ÜRETİLMEZ (eksik talep = GEÇ uyarı = stoksuz kalma riski).
 */
function gunlukTalep(cikis: Tutar, pencereGun: unknown): number | null {
  return satisHizi(cikis, pencereGun).gunluk;
}

/** Kalan günün NEDEN hesaplanamadığı — bağlama bu sayaca göre not basar. null = gün hesaplandı. */
export type KalanGunNedeni = 'stok-bilinmiyor' | 'talep-bilinmiyor' | 'talep-yok' | null;

/**
 * MODÜL İÇİ (JIT). HAM gün döner — yuvarlama ÇAĞIRANDA (P148 `Math.round`, P619 `Math.floor`; parite).
 *
 * Kapı sırası: stok → talep bilinmiyor → talep yok.
 *   • stok bilinmiyor  → null ('0 gün kaldı' ÜRETİLMEZ — P619'un uydurma kırmızı kartı)
 *   • talep bilinmiyor → null (kısmi çıkıştan gün türetilmez)
 *   • günlük === 0     → null, 'talep-yok' (999 / Infinity nöbet değeri YOK)
 *   • stok ≤ 0 (BİLİNEN) ve talep > 0 → 0 (gerçek tükenme)
 */
function kalanGun(stok: number, gunluk: number | null): { gun: number | null; neden: KalanGunNedeni } {
  if (!Number.isFinite(stok)) return { gun: null, neden: 'stok-bilinmiyor' };
  if (gunluk === null || !Number.isFinite(gunluk)) return { gun: null, neden: 'talep-bilinmiyor' };
  if (gunluk <= 0) return { gun: null, neden: 'talep-yok' };
  if (stok <= 0) return { gun: 0, neden: null };
  return { gun: stok / gunluk, neden: null };
}

export interface TukenmeSatiri<K> {
  kart: K;
  /** `finansKpi.stokSeviyesi` (kanonik `stockLevel` → eski `stock`); NaN = BİLİNMİYOR. */
  stok: number;
  /** Penceredeki çıkış — EKRAN `Tutar`ı (kısmi toplam + `bilinmeyen` sayacı). */
  satilan: Tutar;
  /** TÜRETME: gün başına talep; null = hesaplanamaz. */
  gunluk: number | null;
  /** TÜRETME: HAM kalan gün; null = hesaplanamaz (`neden` der ki niye). */
  kalan: number | null;
  neden: KalanGunNedeni;
}

/**
 * Talep Map'inde OLAN her kart için bir satır. Talebi hiç olmayan kart satır ÜRETMEZ — iki panel de
 * `sold > 0` / eşleşen kalem istiyor (parite).
 *
 * `pencereGun` geçersiz geçilirse satırlar `gunluk null / kalan null` döner (sayı UYDURULMAZ);
 * bağlama bu dala girmez, çünkü `urunTalebi` zaten null dönüp paneli "pencere geçersiz"e çevirir.
 */
export function tukenmeSatirlari<K extends { stockLevel?: unknown; stock?: unknown }>(
  talep: UrunTalebi<K>,
  pencereGun: number,
): TukenmeSatiri<K>[] {
  const satirlar: TukenmeSatiri<K>[] = [];
  for (const [kart, satilan] of talep.talep) {
    const stok = stokSeviyesi(kart);
    const gunluk = gunlukTalep(satilan, pencereGun);
    const { gun, neden } = kalanGun(stok, gunluk);
    satirlar.push({ kart, stok, satilan, gunluk, kalan: gun, neden });
  }
  return satirlar;
}

/** Aday kapısının okuduğu kart alanları — `finansKpi.KpiStokKalemi` ile AYNI yapı (tipe bağımlı değil). */
export interface TukenmeKarti {
  stockLevel?: unknown;
  stock?: unknown;
  lowStockThreshold?: unknown;
  minStock?: unknown;
}

/** Listeye GİREN satır: `kalan` burada kesinlikle sayıdır (süzgeç `null`'ı eledi — `!` gerekmez). */
export type TukenmeListeSatiri<K> = TukenmeSatiri<K> & { kalan: number };

export interface TukenmeListesi<K> {
  /** Ufuk içindeki ADAY satırlar; kalan güne göre ARTAN sıralı, `satir` kadar kesilmiş. */
  liste: TukenmeListeSatiri<K>[];
  /** Stoğu bilinen ve pozitif AMA kritik eşiği tanımsız kart — aday OLAMAZ, ekranda sayılır. */
  esiksiz: number;
  /** Talebi olan ama stok seviyesi okunamayan ürün — aday olamaz, tahmin üretilmez. */
  stokBilinmeyen: number;
  /** ADAY olduğu hâlde çıkışı kısmi olan ürün — kısmi çıkıştan gün üretilmez. */
  talebiBilinmeyenAday: number;
  /** Ekrandaki "miktarsız" sayacı: `stokBilinmeyen + talebiBilinmeyenAday`. Kümeler AYRIK (aşağı bak). */
  miktarsizUrun: number;
  /** Liste de sayaçlar da boş: panel HİÇ çizilmez (sıfır sayaçlı boş kart basmak gürültüdür). */
  bos: boolean;
}

/**
 * P148 "Stok Tükenme Tahmini" listesinin TEK kuralı: aday kapısı + ufuk süzgeci + sıralama +
 * kesme + üç sayaç.
 *
 * ## NEDEN VAR (2026-09-20 hakem turu)
 * 6a bağlamasında bu blok `GenelOzet.tsx:575-596` içinde SATIR İÇİ duruyordu (şartname
 * `6a/baglama-genel-ozet.md:121-128` onu satır içi yazdırdı ve ajanın başka dosyaya yazmasını
 * yasakladı). Sonuç: kural ekranda doğru çalışıyordu ama HİÇBİR testle kilitli değildi — hakem
 * aday kapısına uydurma 5 eşiğini geri koyan bir mutasyon yazdı
 * (`seviye <= (Number.isFinite(esik) ? esik : 5) * carpan` — `?? 5` grep'ine TAKILMAYAN biçim) ve
 * `src/components/reports` testleri yeşil kaldı. Eşiği tanımsız kart yeniden 5 × 3 = 15 sınırıyla
 * listeye girerdi ve kimse görmezdi. Kural artık burada ve `stokTalep.test.ts` ile mutasyon-ayırt
 * edici vakalara bağlı.
 *
 * ## PARİTE
 * Bağlamadaki davranış BİREBİR taşındı (sayı değişmez): aday = stoğu bilinen ve pozitif + eşiği
 * bilinen + `seviye ≤ eşik × carpan`; ufuk `Math.round(kalan) ≤ ufukGun` (yuvarlama P148'in);
 * sıralama `sayiSirala` ile artan; kesme `slice(0, satir)`.
 *
 * ## SAYAÇLAR ÇİFT SAYMAZ
 * `stokBilinmeyen` ile `talebiBilinmeyenAday` AYRIK kümelerdir: bir satırın TEK bir `neden`i vardır
 * ve `kalanGun`'da stok kapısı talep kapısından ÖNCE gelir — hem stoğu hem miktarı okunamayan ürün
 * yalnız `stok-bilinmiyor` sayılır. Bu yüzden `miktarsizUrun` düz toplamdır.
 * Stoğu okunamayan kart aday OLAMAZ (`stokSeviyesi > 0` NaN'da false), bu yüzden aday süzgecinden
 * ÖNCE sayılır; yoksa talebi olduğu hâlde SESSİZCE düşerdi (`RaporlarPage` P619 aynı ürünü ayrı
 * listede basıyor: iki panel aynı sözleşme).
 * `esiksiz` ise KATALOĞU tarar (talebi olsun olmasın): "eşiği tanımsız olduğu için tahmin
 * üretilmedi" cümlesi ürün birimindedir. Stoğu okunamayan kart buraya GİRMEZ (`stokSeviyesi > 0`
 * false) — aynı kart iki ayrı notta anılmaz.
 *
 * ## GEÇERSİZ AYAR SAYI UYDURMAZ
 *   • `carpan` pozitif sonlu değilse aday ÜRETİLMEZ (uydurma eşik yok) — sayaçlar yaşar.
 *   • `ufukGun` pozitif sonlu değilse liste BOŞ kalır (süzgeç değerlendirilemez).
 *   • `satir` pozitif sonlu değilse KESME yapılmaz: sınır tamamen SUNUMLUK, veri gizlenmez.
 * Üçü de çağıranın adlandırılmış sabitidir (K20 "ok kalsın") — bu dallar savunmadır.
 *
 * Girdi mutasyona uğramaz: `filter` yeni dizi döndürür, `sort` onun üstünde çalışır.
 */
export function tukenmeListesi<K extends TukenmeKarti>(
  satirlar: readonly TukenmeSatiri<K>[],
  kartlar: readonly K[],
  s: { carpan: number; ufukGun: number; satir: number },
): TukenmeListesi<K> {
  const carpanGecerli = Number.isFinite(s.carpan) && s.carpan > 0;
  const aday = (k: K): boolean => {
    if (!carpanGecerli) return false;
    const seviye = stokSeviyesi(k);
    const esik = stokEsigi(k);
    return seviye > 0 && Number.isFinite(esik) && seviye <= esik * s.carpan;
  };

  const esiksiz = kartlar.filter(k => stokSeviyesi(k) > 0 && !Number.isFinite(stokEsigi(k))).length;
  const stokBilinmeyen = satirlar.filter(x => x.neden === 'stok-bilinmiyor').length;
  const talebiBilinmeyenAday = satirlar.filter(x => x.neden === 'talep-bilinmiyor' && aday(x.kart)).length;
  const miktarsizUrun = stokBilinmeyen + talebiBilinmeyenAday;

  const ufukGecerli = Number.isFinite(s.ufukGun) && s.ufukGun > 0;
  const secilen = ufukGecerli
    ? satirlar.filter((x): x is TukenmeListeSatiri<K> =>
        x.kalan !== null && aday(x.kart) && Math.round(x.kalan) <= s.ufukGun)
    : [];
  secilen.sort((a, b) => sayiSirala(a.kalan, b.kalan));
  const liste = Number.isFinite(s.satir) && s.satir > 0 ? secilen.slice(0, s.satir) : secilen;

  return {
    liste,
    esiksiz,
    stokBilinmeyen,
    talebiBilinmeyenAday,
    miktarsizUrun,
    bos: liste.length === 0 && esiksiz === 0 && miktarsizUrun === 0,
  };
}

/**
 * Önerilen sipariş adedi: `ceil(günlük × kapsama × katsayı)` — P619 paritesi
 * (`Math.ceil(avgDailyDemand * p619MinCoverage * 2)`).
 *
 * Girdilerden biri bilinmiyor ya da ≤ 0 ise **null**: ekranda "NaN adet" ya da "0 adet sipariş
 * önerisi" yazmak yerine öneri HİÇ çizilmez. (`gunluk === 0` = bilinen talepsizlik → öneri yok.)
 */
export function oneriAdedi(gunluk: number | null, kapsamaGun: number | null, katsayi: number): number | null {
  if (gunluk === null || !Number.isFinite(gunluk) || gunluk <= 0) return null;
  if (kapsamaGun === null || !Number.isFinite(kapsamaGun) || kapsamaGun <= 0) return null;
  if (!Number.isFinite(katsayi) || katsayi <= 0) return null;
  return Math.ceil(gunluk * kapsamaGun * katsayi);
}
