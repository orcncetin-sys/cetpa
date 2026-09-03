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
