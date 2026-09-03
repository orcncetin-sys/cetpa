/**
 * siparis.ts — Sipariş alanlarının KAYNAK-BAĞIMSIZ okunması. TEK KAYNAK.
 *
 * NEDEN VAR (2026-09-03, kullanıcı SS'li bildirimi + 8-açılı code review):
 * `orders` koleksiyonu artık ÜÇ farklı üreticiden besleniyor ve her biri
 * farklı alan adları yazıyor:
 *
 *   1. Shopify aynası      → `shopifyOrderId`, `syncedAt`
 *   2. Cetpa-native/AddOrder → `orderNumber`, `createdAt`
 *   3. Mikro satış faturasından türetme (POST /api/mikro/import/faturadan-siparis)
 *                          → `orderNumber: MF-<seri><sıra>`, `createdAt`, `orderDate`,
 *                            `source: 'mikro-fatura'` — ve `paid` alanı HİÇ YOK
 *
 * UI'ın 15+ yüzeyi yalnız (1)'in alanlarını okuyordu: 355 türetilmiş siparişte
 * başlık "Order undefined", tarih "Bilinmeyen Tarih" görünüyordu; daha kötüsü
 * `!o.paid` toplamları ₺17,6M'lik SAHTE bir "Alacak Toplam" ve 355 kayıtlık
 * yaşlandırma alarmı üretiyordu.
 *
 * TAHSİLAT SEMANTİĞİ — `odemeTakipli` neden var:
 * Bir Mikro satış faturasından türetilen sipariş, tahsilatın yapılıp yapılmadığı
 * hakkında HİÇBİR ŞEY bilmez; o gerçek Mikro cari hareketlerinde yaşar. Bu yüzden
 * bu kayıtlarda `paid` alanının yokluğu "ödenmedi" DEĞİL, "bilinmiyor"dur —
 * CLAUDE.md'nin "sahte kesinlik gösterme" kuralı. Alacak/yaşlandırma/hatırlatma
 * gibi tahsilat yüzeyleri bu süzgeçten geçmeli.
 */
import type { Order } from '../types';
import { zamanDate } from './zaman';

/** Listede/başlıkta gösterilecek sipariş numarası — üreticiden bağımsız. */
export function gorunenSiparisNo(o: Order): string {
  return o.orderNumber || o.shopifyOrderId || `#${o.id.slice(-6)}`;
}

/**
 * Siparişin tarihi; çözülemezse null (asla "bugün"e düşmez — bkz. zaman.ts).
 * Sıra: Shopify `syncedAt` → native `createdAt` → türetme `orderDate`.
 */
export function siparisTarih(o: Order): Date | null {
  return zamanDate(o.syncedAt) ?? zamanDate(o.createdAt) ?? zamanDate(o.orderDate);
}

/** Sıralama için epoch ms; tarihi bilinmeyen kayıt EN SONA düşsün diye -Infinity. */
export function siparisTarihMs(o: Order): number {
  const d = siparisTarih(o);
  return d ? d.getTime() : -Infinity;
}

/**
 * Bu siparişin ödeme durumu Cetpa'da mı izleniyor?
 * false → tahsilat gerçeği Mikro cari hesapta; `paid` alanına bakma.
 */
export function odemeTakipli(o: Order): boolean {
  return o.source !== 'mikro-fatura';
}
