import type { InventoryItem } from '../types';

/** Bir stok kaleminin maliyetini TRY cinsinden döndürür (USD/EUR ise kurla çevirir). */
export function itemCostTRY(item: InventoryItem, rates: Record<string, number> | null | undefined): number {
  const raw = item.costPrice ?? (item.cost as number | undefined) ?? 0;
  const cur = item.costCurrency;
  if (!cur || cur === 'TRY' || !rates) return raw;
  return raw * (rates[cur] ?? 1);
}
