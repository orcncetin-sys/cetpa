/**
 * odemeYontemi.ts — sipariş "ödeme alındı" kaydının yöntemi. Saf (2026-10-02).
 *
 * NEDEN: "Ödeme Al" penceresi (PaymentMethodModal) seçilen yöntemi `onConfirm(method)` ile gönderiyordu ama App'teki işleyici
 * parametre ALMIYOR, kendi ayrı durumunu (`p532Method`, hep 'bank_transfer') yazıyordu — kopya durum: kullanıcı Nakit / Çek /
 * Kredi Kartı seçse de her ödeme "EFT/Havale" kaydediliyordu (Ödeme Yöntemi raporu pratikte tek satırdı).
 * Kural: yöntem pencereden gelir, doğrulanır ve O yazılır; geçersiz / boş yöntemle kayıt YAPILMAZ (varsayılan uydurulmaz).
 */
import type { Order } from '../../types';

export type OdemeYontemi = NonNullable<Order['paymentMethod']>;

export const ODEME_YONTEMLERI: readonly OdemeYontemi[] = ['cash', 'bank_transfer', 'credit_card', 'check', 'other'];

export function odemeYontemiMi(v: unknown): v is OdemeYontemi {
  return typeof v === 'string' && (ODEME_YONTEMLERI as readonly string[]).includes(v);
}

/** "Ödeme alındı" yaması. `zaman`: sunucu zaman damgası (çağıran verir — modül saf kalsın). Geçersiz yöntemde fırlatır. */
export function odemeAlindiYamasi(yontem: unknown, zaman: unknown): { paid: true; paidAt: unknown; paymentMethod: OdemeYontemi } {
  if (!odemeYontemiMi(yontem)) throw new Error('Ödeme yöntemi seçilmedi.');
  return { paid: true, paidAt: zaman, paymentMethod: yontem };
}
