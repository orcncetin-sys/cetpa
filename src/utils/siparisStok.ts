/**
 * siparisStok.ts — sipariş → stok hareketi PLANI + durum geçişi (Faz 1 4/n, 2026-09-05).
 *
 * OrdersPage `applyOrderStock` / `handleUpdateOrderStatus`'un saf çekirdeği; I/O
 * (incrementField, inventoryMovements yazımı, bildirim) çağıranda kalır. Sözleşme
 * siparisStok.test.ts'te.
 *
 * Eski gövde `Number(li.quantity) || 0` ile bilinmeyen miktarı 0'a çevirip `continue`
 * ediyordu; envanterde bulunmayan ürün de sessizce atlanıyordu — sipariş yine
 * `stockApplied: true` damgalanıyordu (stok hiç düşmemişken "stok uygulandı").
 * Şimdi atlanan her satır SEBEBİYLE döner; çağıran bunu kullanıcıya yüksek sesle söyler.
 */
import type { Order, OrderLineItem, InventoryItem } from '../types';
import { bilinenSayi } from './para';

export type AtlanmaSebebi = 'miktar_bilinmiyor' | 'miktar_gecersiz' | 'urun_bulunamadi';
export interface StokHareketi { invId: string; urunAdi: string; miktar: number }
export interface StokPlani {
  hareketler: StokHareketi[];
  atlanan: Array<{ satir: string; sebep: AtlanmaSebebi }>;
}

export const ATLANMA_SEBEBI: Record<AtlanmaSebebi, { tr: string; en: string }> = {
  miktar_bilinmiyor: { tr: 'miktar bilinmiyor',      en: 'quantity unknown' },
  miktar_gecersiz:   { tr: 'miktar sıfır/negatif',   en: 'quantity zero or negative' },
  urun_bulunamadi:   { tr: 'envanterde bulunamadı',  en: 'not found in inventory' },
};

/** Sipariş satırı: `quantity` DB'den string/null gelebilir — tip iddiasına güvenme. */
type Satir = Partial<Pick<OrderLineItem, 'sku' | 'name' | 'inventoryId'>> & { quantity?: unknown };
type Urun = Pick<InventoryItem, 'id' | 'sku' | 'name'>;

export function siparisStokPlani(
  order: { lineItems?: ReadonlyArray<Satir> | null },
  inventory: ReadonlyArray<Urun>,
): StokPlani {
  const plan: StokPlani = { hareketler: [], atlanan: [] };
  for (const li of order.lineItems ?? []) {
    const satir = li.name || li.sku || li.inventoryId || '?';
    const invId = li.inventoryId || '';
    const sku = (li.sku || '').trim();
    // Boş SKU boş SKU ile EŞLEŞMEZ: eski `i.sku === li.sku` sku'suz satırı sku'suz ilk ürüne bağlıyordu.
    // İKİ taraf da trim: ProductForm/Mikro import SKU'yu ham yazar ('KUM-01 ' sondaki boşlukla) —
    // tek taraflı trim o ürünü 'bulunamadı' yapardı (4/n incelemesi).
    const inv = inventory.find(i => (invId !== '' && i.id === invId) || (sku !== '' && (i.sku || '').trim() === sku));
    if (!inv) { plan.atlanan.push({ satir, sebep: 'urun_bulunamadi' }); continue; }
    if (!bilinenSayi(li.quantity)) { plan.atlanan.push({ satir, sebep: 'miktar_bilinmiyor' }); continue; }
    const miktar = Number(li.quantity);
    if (miktar <= 0) { plan.atlanan.push({ satir, sebep: 'miktar_gecersiz' }); continue; }
    plan.hareketler.push({ invId: inv.id, urunAdi: inv.name || li.name || inv.id, miktar });
  }
  return plan;
}

/**
 * Durum geçişi stok oynatır mı? İdempotent: bayrak `stockApplied` sevkiyatta düşüldüğünü
 * söyler; Delivered ikinci kez düşmez, Cancelled yalnız düşülmüşse geri yükler.
 */
export function stokGecisi(status: Order['status'], stockApplied: boolean): 'out' | 'in' | null {
  if (!stockApplied && (status === 'Shipped' || status === 'Delivered')) return 'out';
  if (stockApplied && status === 'Cancelled') return 'in';
  return null;
}
