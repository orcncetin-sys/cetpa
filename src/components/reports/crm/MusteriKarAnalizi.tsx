/**
 * MusteriKarAnalizi — CrmRapor.tsx'ten mekanik bölme ile çıkarıldı (2026-08-31).
 * Gövde BİREBİR taşındı (davranış değişmedi; yalnız girinti düzeltildi).
 * Render koşulu `reportsTab === 'crm' && orders.length >= 3 && inventory.length > 0` ebeveyn CrmRapor.tsx'te durur.
 * Props: ReportsCtx'in tamamı DEĞİL — yalnız bu kartın gerçekten kullandığı alanlar.
 */
import { itemCostTRY, type ReportsCtx } from '../useReportsData';

type Props = Pick<ReportsCtx, 'orders' | 'inventory' | 'inventoryMovements' | 'exchangeRates' | 'currentLanguage' | 'fmtAna'>;

export default function MusteriKarAnalizi({ orders, inventory, inventoryMovements, exchangeRates, currentLanguage, fmtAna }: Props) {
  // Ortalama alış fiyatı — gerçek Mikro stok hareketlerinden (STOK_HAREKETLERI,
  // sth_tip=0 alış) SKU bazında ağırlıklı ortalama. inventory.costPrice (itemCostTRY)
  // birçok kalemde 0/boş çıkıyordu (2026-08-13 kullanıcı bildirimi — bu yüzden
  // her müşteri "%100 kâr" gösteriyordu, maliyet hiç düşülmüyordu). Aynı hesap
  // yöntemi server.ts'teki /api/reports/stok-fiyat-karsilastirma ile tutarlı.
  const avgAlisFiyatMap = new Map<string, number>();
  {
    const tut = new Map<string, number>(), mik = new Map<string, number>();
    for (const m0 of inventoryMovements) {
      const m = m0 as unknown as Record<string, unknown>;
      const sku = String(m.sth_stok_kod ?? '').trim();
      if (!sku || Number(m.sth_tip) !== 0) continue; // yalnız alış
      if (m.sth_iptal === true || Number(m.sth_iptal ?? 0) === 1) continue;
      const miktar = Math.abs(Number(m.sth_miktar) || 0);
      const tutar = Math.abs(Number(m.sth_tutar) || 0);
      if (miktar <= 0) continue;
      tut.set(sku, (tut.get(sku) ?? 0) + tutar);
      mik.set(sku, (mik.get(sku) ?? 0) + miktar);
    }
    for (const [sku, m] of mik) if (m > 0) avgAlisFiyatMap.set(sku, tut.get(sku)! / m);
  }
  const custProfit: Record<string, { rev: number; cogs: number }> = {};
  for (const o of orders) {
    if (o.status === 'Cancelled') continue;
    const name = o.customerName || '—';
    if (!custProfit[name]) custProfit[name] = { rev: 0, cogs: 0 };
    custProfit[name].rev += o.totalPrice || 0;
    for (const li of (o.lineItems ?? [])) {
      const inv = inventory.find(ii => ii.id === li.inventoryId || ii.name === li.name);
      const avgAlis = inv ? avgAlisFiyatMap.get(inv.sku) : undefined;
      const storedCost = inv ? itemCostTRY(inv, exchangeRates) : 0;
      const unitCost = avgAlis && avgAlis > 0 ? avgAlis : (storedCost > 0 ? storedCost : li.price * 0.6);
      custProfit[name].cogs += unitCost * li.quantity;
    }
  }
  const profitList = Object.entries(custProfit)
    .map(([name, d]) => ({ name, rev: d.rev, cogs: d.cogs, profit: d.rev - d.cogs, margin: d.rev > 0 ? Math.round(((d.rev - d.cogs) / d.rev) * 100) : 0 }))
    .sort((a, b) => b.profit - a.profit)
    .slice(0, 8);
  if (profitList.length < 2) return null;
  const maxProfit = Math.max(...profitList.map(p => p.profit), 1);
  return (
    <div className="apple-card p-6">
      <h3 className="font-bold text-gray-800 mb-4">{currentLanguage === 'tr' ? '💹 Müşteri Bazlı Kâr Analizi' : '💹 Profit by Customer'}</h3>
      <div className="space-y-2.5">
        {profitList.map(p => (
          <div key={p.name}>
            <div className="flex items-center justify-between mb-0.5">
              <span className="text-xs font-medium text-gray-700 truncate">{p.name}</span>
              <div className="flex items-center gap-2 shrink-0 ml-2">
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${p.margin >= 30 ? 'bg-emerald-100 text-emerald-700' : p.margin >= 15 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-600'}`}>%{p.margin}</span>
                <span className="text-xs font-bold text-gray-700">{fmtAna(p.profit,'K',0)}</span>
              </div>
            </div>
            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div className={`h-full rounded-full ${p.margin >= 30 ? 'bg-emerald-400' : p.margin >= 15 ? 'bg-amber-400' : 'bg-red-400'}`} style={{ width: `${Math.max(4, Math.round((p.profit / maxProfit) * 100))}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
