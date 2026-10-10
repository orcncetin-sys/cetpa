/**
 * durumEtiketi.ts — Sipariş / sevkiyat durumlarının EKRAN ETİKETİ. TEK KAYNAK.
 *
 * NEDEN VAR (2026-09-04, kullanıcı bildirdi: "etiketlerde çeviri eksiği var,
 * delivered diyor"):
 * `status` alanları VERİ değeridir ve her zaman İngilizce sabittir
 * ('Pending' | 'Processing' | 'Shipped' | 'Delivered' | 'Cancelled'). Ekranların
 * bir kısmı bunu çeviriyor, bir kısmı ham basıyordu — aynı ekranda iki dil yan
 * yana görünüyordu: Dashboard'da üstteki bar "Teslim" derken hemen altındaki
 * rozet "Delivered" diyordu.
 *
 * İKİ AYRI BİRLİK, BİLEREK AYRI TUTULDU:
 *   - Sipariş: types.ts `Order['status']`
 *   - Sevkiyat: types.ts `Shipment['status']` ('In Transit' var, 'Processing' yok)
 * Tek sözlüğe karıştırmak, birinde olmayan bir durumu diğerine sızdırır.
 *
 * `Record<Birlik, ...>` BİLİNÇLİ: birliğe yeni bir durum eklenirse bu dosya
 * DERLENMEZ ve çeviri eklemek zorunlu olur — sessiz İngilizce sızıntısı bir daha
 * olmaz. `?? ham` de bilinçli: Mikro'dan birlik dışı bir değer gelirse boş rozet
 * yerine ham değer görünür (sahte kesinlik yerine görünür bilinmezlik).
 */
import type { Order, Shipment } from '../types';
import type { MagazaTalepAsamasi } from '../lib/magazaTalep';

const SIPARIS_TR: Record<Order['status'], string> = {
  Pending: 'Bekliyor',
  Processing: 'Hazırlanıyor',
  Shipped: 'Kargoda',
  Delivered: 'Teslim Edildi',
  Cancelled: 'İptal Edildi',
};

const SEVKIYAT_TR: Record<Shipment['status'], string> = {
  'Pending': 'Bekliyor',
  'In Transit': 'Yolda',
  'Delivered': 'Teslim Edildi',
  'Cancelled': 'İptal Edildi',
};

/** Sipariş durumunun ekranda gösterilecek hâli. */
export function siparisDurumEtiketi(durum: string | undefined | null, dil: string): string {
  const ham = String(durum ?? '');
  if (dil !== 'tr') return ham;
  return SIPARIS_TR[ham as Order['status']] ?? ham;
}

/** Sevkiyat durumunun ekranda gösterilecek hâli. */
export function sevkiyatDurumEtiketi(durum: string | undefined | null, dil: string): string {
  const ham = String(durum ?? '');
  if (dil !== 'tr') return ham;
  return SEVKIYAT_TR[ham as Shipment['status']] ?? ham;
}

/**
 * ── SLUG'LAR: BÜYÜTMEK YETMEZ, EŞLEME ŞART (2026-09-04 inceleme bulgusu) ──
 * `faturaTipi` ve `priority` gibi alanlar ASCII slug'dır — depolanan değerde
 * Türkçe harf YOKTUR ('e-arsiv', 'ihracat'). Bunları `toUpperCase()` ya da
 * `buyukHarf()` ile büyütmek doğru Türkçe ÜRETMEZ: 'e-arsiv' → 'E-ARSIV'
 * (locale-duyarsız) ya da 'E-ARSİV' (Türkçe casing) çıkar; doğrusu 'E-ARŞİV'
 * ve eksik 'ş' harfini hiçbir büyütme geri getiremez. Kullanıcı bu değeri
 * AddOrderModal'da zaten 'e-Arşiv' etiketiyle SEÇİYOR — üç yüzeyin üç farklı
 * yazım göstermesinin sebebi buydu. Çözüm casing değil, aşağıdaki eşlemedir.
 *
 * `priority` ise tersi tuzak: değerleri İngilizce ('low'|'medium'|'high') ve
 * Türkçe casing UYGULANMAMALI — 'high' → 'HİGH' olurdu. Çeviri gerekiyor.
 */

/** Sipariş tipleri — types.ts `Order['faturaTipi']` ile aynı birlik. */
type FaturaTipi = 'e-fatura' | 'e-arsiv' | 'ihracat';

const FATURA_TIPI: Record<FaturaTipi, { tr: string; en: string }> = {
  'e-fatura': { tr: 'E-FATURA', en: 'E-INVOICE' },
  'e-arsiv':  { tr: 'E-ARŞİV',  en: 'E-ARCHIVE' },
  'ihracat':  { tr: 'İHRACAT',  en: 'EXPORT' },
};

type Oncelik = 'low' | 'medium' | 'high';

const ONCELIK: Record<Oncelik, { tr: string; en: string }> = {
  low:    { tr: 'DÜŞÜK',  en: 'LOW' },
  medium: { tr: 'ORTA',   en: 'MEDIUM' },
  high:   { tr: 'YÜKSEK', en: 'HIGH' },
};

/**
 * Fatura tipinin rozet etiketi. Bilinmeyen değerde ham slug'ı BÜYÜTMEDEN
 * döner — sahte kesinlik yerine görünür bilinmezlik (bkz. CLAUDE.md).
 */
export function faturaTipiEtiketi(tip: string | undefined | null, dil: string): string {
  const ham = String(tip ?? '');
  const eslesme = FATURA_TIPI[ham as FaturaTipi];
  return eslesme ? (dil === 'tr' ? eslesme.tr : eslesme.en) : ham;
}

/** Öncelik rozetinin etiketi. */
export function oncelikEtiketi(oncelik: string | undefined | null, dil: string): string {
  const ham = String(oncelik ?? '');
  const eslesme = ONCELIK[ham as Oncelik];
  return eslesme ? (dil === 'tr' ? eslesme.tr : eslesme.en) : ham;
}

/**
 * ── ÇEVRİM İÇİ MAĞAZA (Shopify) DURUMLARI (2026-10-02, Online Siparişler ekranı) ──
 * Sunucu, mağazanın iki ham durumunu `orders.shopifyRaw` içine OLDUĞU GİBİ yazar:
 * `financialStatus` (Shopify `financial_status`) ve `fulfillmentStatus` (`fulfillment_status`).
 * İkisi de İngilizce, alt çizgili sabittir ('partially_paid') — büyütmek ya da alt çizgiyi
 * boşluğa çevirmek çeviri DEĞİLDİR; eşleme şart (yukarıdaki slug dersiyle aynı).
 *
 * Bilinmeyen değer HAM hâliyle, büyütülmeden döner: Shopify yeni bir durum eklerse boş rozet
 * ya da uydurma etiket yerine görünür bilinmezlik (CLAUDE.md "sahte kesinlik gösterme").
 * `Record<Birlik, …>` yerine `hasOwnProperty` ile bakılır: 'constructor' / 'toString' gibi
 * prototip anahtarları eşleşme SAYILMAZ (dış sistemden gelen metin).
 */
type Cift = { tr: string; en: string };

/** Shopify `financial_status` birliği. */
type OdemeDurumu = 'pending' | 'authorized' | 'partially_paid' | 'paid' | 'partially_refunded' | 'refunded' | 'voided';

const ODEME_DURUMU: Record<OdemeDurumu, Cift> = {
  pending:            { tr: 'Ödeme bekliyor',     en: 'Payment pending' },
  authorized:         { tr: 'Provizyon alındı',   en: 'Authorized' },
  partially_paid:     { tr: 'Kısmen ödendi',      en: 'Partially paid' },
  paid:               { tr: 'Ödendi',             en: 'Paid' },
  partially_refunded: { tr: 'Kısmen iade edildi', en: 'Partially refunded' },
  refunded:           { tr: 'İade edildi',        en: 'Refunded' },
  voided:             { tr: 'Geçersiz kılındı',   en: 'Voided' },
};

/**
 * Shopify `fulfillment_status` birliği. Shopify "hiç gönderilmedi"yi `null` ile söyler;
 * 'unfulfilled' aynı anlamın metin hâlidir (API süzgeçlerinde geçer) — ikisi tek etikete iner.
 */
type KargoDurumu = 'unfulfilled' | 'partial' | 'fulfilled' | 'restocked';

const KARGO_DURUMU: Record<KargoDurumu, Cift> = {
  unfulfilled: { tr: 'Hazırlanmadı',      en: 'Unfulfilled' },
  partial:     { tr: 'Kısmen gönderildi', en: 'Partially fulfilled' },
  fulfilled:   { tr: 'Gönderildi',        en: 'Fulfilled' },
  restocked:   { tr: 'Stoğa geri alındı', en: 'Restocked' },
};

const ciftSec = <K extends string>(sozluk: Record<K, Cift>, ham: string, dil: string): string | null =>
  Object.prototype.hasOwnProperty.call(sozluk, ham) ? (dil === 'tr' ? sozluk[ham as K].tr : sozluk[ham as K].en) : null;

/**
 * Ödeme durumunun (Shopify `financial_status`) ekran etiketi.
 * null / undefined / boş → '—' (durum bilinmiyor); bilinmeyen değer HAM, büyütülmeden.
 */
export function odemeDurumuEtiketi(deger: string | undefined | null, dil: string): string {
  const ham = typeof deger === 'string' ? deger.trim() : '';
  if (!ham) return '—';
  return ciftSec(ODEME_DURUMU, ham, dil) ?? ham;
}

/**
 * Kargo / gönderim durumunun (Shopify `fulfillment_status`) ekran etiketi.
 *
 * `null` BİLİNEN bir değerdir: Shopify gönderilmemiş siparişte bu alanı `null` yollar →
 * 'Hazırlanmadı'. `undefined` (alan hiç yazılmamış) ve boş metin ise BİLİNMİYOR → '—'.
 * İkisini aynı saymak her yeni siparişin kargo rozetini '—' yapardı; tersini yapmak da alanı
 * hiç gelmemiş kayda "hazırlanmadı" dedirtirdi. Bilinmeyen değer HAM, büyütülmeden.
 */
export function kargoDurumuEtiketi(deger: string | undefined | null, dil: string): string {
  if (deger === null) return dil === 'tr' ? KARGO_DURUMU.unfulfilled.tr : KARGO_DURUMU.unfulfilled.en;
  const ham = typeof deger === 'string' ? deger.trim() : '';
  if (!ham) return '—';
  return ciftSec(KARGO_DURUMU, ham, dil) ?? ham;
}

/**
 * ── MAĞAZA SİPARİŞ TALEBİ AŞAMALARI (dilim 2a, şartname v6 § 5.2; 2026-10-09) ──
 * Saklanan değerler `lib/magazaTalep.ts` `MAGAZA_TALEP_ASAMALARI` (`yeni` → `teyit` → `hazirlaniyor` → `sevk` → `teslim`;
 * `iptal`). Aşama BİRLİĞİ `Record<MagazaTalepAsamasi, …>` ile kilitli: kümeye aşama eklenirse etiket ve renk eklenmeden
 * derlenmez. Renk tablosu TEK kaynak: ERP rozeti buradan okur; kalem teslim rozeti de aynı tablodan (`teslim` yeşili,
 * `iptal` grisi) — yeni renk eklenmez. Metin sınıfları WCAG AA karşıtlığını tutar (`*-700` metin, `*-50` / `gray-100` zemin).
 * Bilinmeyen değer bu işlevlere GİRMEZ: kanca aşamayı kapalı kümeden geçirir, okunamayanı `null` yapar; ekran `null` için
 * kendi «durum okunamadı» metnini basar (uydurma aşama yok).
 */
const MAGAZA_ASAMA: Record<MagazaTalepAsamasi, Cift> = {
  yeni:         { tr: 'Yeni',          en: 'New' },
  teyit:        { tr: 'Teyit edildi',  en: 'Confirmed' },
  hazirlaniyor: { tr: 'Hazırlanıyor',  en: 'Preparing' },
  sevk:         { tr: 'Sevk edildi',   en: 'Shipped' },
  teslim:       { tr: 'Teslim edildi', en: 'Delivered' },
  iptal:        { tr: 'İptal edildi',  en: 'Cancelled' },
};

/** Altı sınıflık renk tablosu (zemin + metin). */
export const MAGAZA_ASAMA_RENGI: Record<MagazaTalepAsamasi, string> = {
  yeni:         'bg-red-50 text-red-700',
  teyit:        'bg-yellow-50 text-yellow-700',
  hazirlaniyor: 'bg-blue-50 text-blue-700',
  sevk:         'bg-indigo-50 text-indigo-700',
  teslim:       'bg-green-50 text-green-700',
  iptal:        'bg-gray-100 text-gray-700',
};

/** Mağaza talebi aşamasının ekran etiketi (iki dil). */
export function magazaTalepDurumEtiketi(asama: MagazaTalepAsamasi, dil: string): string {
  return dil === 'tr' ? MAGAZA_ASAMA[asama].tr : MAGAZA_ASAMA[asama].en;
}

/** Aşama rozetinin sınıfı. */
export function magazaTalepDurumRengi(asama: MagazaTalepAsamasi): string {
  return MAGAZA_ASAMA_RENGI[asama];
}

const MAGAZA_KALEM_TESLIM: Record<'teslim' | 'bekliyor', Cift> = {
  teslim:   { tr: 'teslim edildi', en: 'delivered' },
  bekliyor: { tr: 'bekliyor',      en: 'pending' },
};

/** Kalem teslim işaretinin etiketi («teslim edildi» / «bekliyor»; iki dil). */
export function magazaKalemTeslimEtiketi(teslim: boolean, dil: string): string {
  const c = teslim ? MAGAZA_KALEM_TESLIM.teslim : MAGAZA_KALEM_TESLIM.bekliyor;
  return dil === 'tr' ? c.tr : c.en;
}

/** Kalem rozetinin sınıfı — aşama tablosundan: işaretli `teslim` yeşili, bekleyen `iptal` grisi (yeni renk yok). */
export function magazaKalemTeslimRengi(teslim: boolean): string {
  return teslim ? MAGAZA_ASAMA_RENGI.teslim : MAGAZA_ASAMA_RENGI.iptal;
}
