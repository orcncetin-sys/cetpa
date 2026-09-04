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
