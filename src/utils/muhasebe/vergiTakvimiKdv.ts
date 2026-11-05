/**
 * vergiTakvimiKdv.ts: Vergi Takvimi'nin «KDV Beyannamesi» satırındaki ÖNERİ (dönemin satış KDV'si, siparişlerden). VergiTakvimi.tsx
 * içinden TAŞINDI (şartname «Mikro bağlantı B» B2 #4, 05.11.2026: kaynaksız MF kapısının kendi testi olsun diye saf modül).
 * Davranış taşıma öncesiyle aynı; tek değişiklik B2 kapısı. Öneridir: kullanıcı tutarı düzenler (resmî beyan değil).
 */
import { ayAnahtari } from '../zaman';
import { bilinenSayi } from '../para';
import { mfKaynaksizMi } from '../../lib/mfKaynagi';

export type VTOrder = { totalPrice?: number; kdvOran?: number; faturali?: boolean; status?: string; createdAt?: unknown; source?: string; mfKaynaksiz?: unknown };

/** Yaklaşım 1: KDV Beyannamesi için dönemin satış KDV'sini faturalardan türet (öneri). `donem` 'YYYY/MM' ya da 'YYYY-MM' içerir. */
export function ayKdvOnerisi(orders: readonly VTOrder[], donem: string): number {
  const m = donem.match(/(\d{4})[/-](\d{2})/); if (!m) return 0;
  const ym = `${m[1]}-${m[2]}`;
  return orders.reduce((s, o) => {
    // Kaynaksız MF (B2): Mikro'da satış faturası yok → KDV önerisine girmez.
    if (o.status === 'Cancelled' || o.faturali === false || mfKaynaksizMi(o)) return s;
    const d = ayAnahtari(o.createdAt);         // yerel ay; bilinmiyorsa null → öneriye girmez
    if (d !== ym) return s;
    // Tutarı bilinmeyen sipariş öneriye girmez (taşıma öncesi `Number(x) || 0` ile AYNI toplam: 0 katkı).
    if (!bilinenSayi(o.totalPrice)) return s;
    // Oran yoksa %20 varsayımı taşıma öncesinden AYNEN (öneri; kullanıcı düzenler).
    const rate = (o.kdvOran ?? 20) / 100;
    return s + Number(o.totalPrice) * rate;
  }, 0);
}
