import type { InventoryItem } from '../types';

/** Bir stok kaleminin maliyetini TRY cinsinden döndürür (USD/EUR ise kurla çevirir). */
export function itemCostTRY(item: InventoryItem, rates: Record<string, number> | null | undefined): number {
  const raw = item.costPrice ?? (item.cost as number | undefined) ?? 0;
  const cur = item.costCurrency;
  if (!cur || cur === 'TRY' || !rates) return raw;
  // ⚠️ BILINEN KUSUR — KARAR BEKLIYOR (2026-08-26 denetimi).
  //
  // Kur yoksa `?? 1` devreye giriyor: maliyeti $100 girilmis bir urun ₺100
  // sayiliyor, yani maliyet ~40 KAT DUSUK cikiyor ve MARJ SISKIN gorunuyor.
  // Ustteki `if (!rates) return raw` dali da ayni sonucu veriyor.
  //
  // NEDEN HENUZ DUZELTILMEDI: bu fonksiyonun ~60 cagri yeri var ve hepsi
  // TOPLAM/MARJ hesabina giriyor (stok degeri, COGS, kategori kirilimi,
  // tedarikci toplami...). `null` dondurmek her cagri yerinde ayri bir URUN
  // KARARI gerektirir: o kalemi toplamdan DISLA mi, yoksa toplami komple '—'
  // mi yap? Yanlis secim sessizce yanlis bir finansal rakam uretir.
  //
  // Kardes desen: gosterim tarafinda `kurCevir` (src/utils/currency.ts) kur
  // yoksa null donuyor ve UI '—' gosteriyor. Burada da ayni ilke uygulanmali.
  //
  // NOT: bu fonksiyonun UC KOPYASI var (burasi,
  // src/components/reports/useReportsData.ts:49, src/pages/OrdersPage.tsx:48) —
  // duzeltme yapilirken ucu de tek kaynaga indirilmeli.
  return raw * (rates[cur] ?? 1);
}
