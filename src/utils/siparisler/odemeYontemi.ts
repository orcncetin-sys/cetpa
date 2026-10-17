/**
 * odemeYontemi.ts — sipariş "ödeme alındı" kaydının yöntemi. Saf (2026-10-02).
 *
 * NEDEN: "Ödeme Al" penceresi (PaymentMethodModal) seçilen yöntemi `onConfirm(method)` ile gönderiyordu ama App'teki işleyici
 * parametre ALMIYOR, kendi ayrı durumunu (`p532Method`, hep 'bank_transfer') yazıyordu — kopya durum: kullanıcı Nakit / Çek /
 * Kredi Kartı seçse de her ödeme "EFT/Havale" kaydediliyordu (Ödeme Yöntemi raporu pratikte tek satırdı).
 * Kural: yöntem pencereden gelir, doğrulanır ve O yazılır; geçersiz / boş yöntemle kayıt YAPILMAZ (varsayılan uydurulmaz).
 */
import type { Order } from '../../types';
import { oc } from '../../i18n/ortak';
import { op } from '../../i18n/orders';

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

/**
 * Ödeme yöntemi enum kodunun EKRAN etiketi (6c inceleme 1, 2026-10-17). Neden: GenelBloklar2 «Ödeme Yöntemi Dağılımı» ham
 * kodu basıyordu («bank_transfer»; `capitalize` sınıfıyla «Bank_transfer»). Orkestratör kararı: sözlük anahtarları OrdersPage
 * `pmLabels` rozetiyle AYNI (`oc.nakit` · `op.eft` · `op.kart` · `oc.cek` · `oc.diger`) — yeni metin YAZILMAZ. Dil daraltması
 * `oc()` / `op()`'nin kendisi (`undefined` / 'tr' → Türkçe). CRMPage / OrdersPage / PaymentMethodModal'ın buna bağlanması
 * AYRI iştir (bugün kendi listeleri var). «Belirtilmemiş» bir yöntem DEĞİLDİR → çağıran `oc(dil).belirtilmemis` basar.
 */
const ETIKET: Readonly<Record<OdemeYontemi, (dil: string | undefined) => string>> = {
  cash: dil => oc(dil).nakit,
  bank_transfer: dil => op(dil).eft,
  credit_card: dil => op(dil).kart,
  check: dil => oc(dil).cek,
  other: dil => oc(dil).diger,
};

export function odemeYontemiEtiketi(yontem: OdemeYontemi, dil: string | undefined): string {
  return ETIKET[yontem](dil);
}
