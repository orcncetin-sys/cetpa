/**
 * IskontoSizintiAnalizi — CrmRapor.tsx'ten mekanik bölme ile çıkarıldı (2026-08-31).
 * Gövde BİREBİR taşındı (davranış değişmedi; yalnız girinti düzeltildi).
 * Render koşulu `reportsTab === 'crm' && orders.length >= 5` ebeveyn CrmRapor.tsx'te durur.
 * Props: ReportsCtx'in tamamı DEĞİL — yalnız bu kartın gerçekten kullandığı alanlar.
 */
import type { ReportsCtx } from '../useReportsData';

type Props = Pick<ReportsCtx, 'orders' | 'inventory' | 'currentLanguage' | 'fmtAna'>;

export default function IskontoSizintiAnalizi({ orders, inventory, currentLanguage, fmtAna }: Props) {
  // Orders where totalPrice < sum(lineItems at list price) indicates discount
  let totalListPrice = 0;
  let totalActualPrice = 0;
  const discountByCustomer: Record<string, { discount: number; orders: number }> = {};
  for (const o of orders) {
    if (o.status === 'Cancelled') continue;
    const listPrice = (o.lineItems ?? []).reduce((s, li) => {
      const inv = inventory.find(ii => ii.id === li.inventoryId || ii.name === li.name);
      const retail = inv?.prices?.['Retail'] ?? li.price;
      return s + retail * li.quantity;
    }, 0);
    const actual = o.totalPrice || 0;
    totalListPrice += listPrice;
    totalActualPrice += actual;
    const discount = listPrice - actual;
    if (discount > 0) {
      const name = o.customerName || '—';
      if (!discountByCustomer[name]) discountByCustomer[name] = { discount: 0, orders: 0 };
      discountByCustomer[name].discount += discount;
      discountByCustomer[name].orders++;
    }
  }
  const totalDiscount = totalListPrice - totalActualPrice;
  if (totalDiscount <= 0 || totalListPrice === 0) return null;
  const discountRate = Math.round((totalDiscount / totalListPrice) * 100);
  const topDiscountCusts = Object.entries(discountByCustomer)
    .sort(([,a],[,b]) => b.discount - a.discount)
    .slice(0, 5);
  return (
    <div className="apple-card p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '💸 İskonto Sızıntı Analizi' : '💸 Discount Leakage Analysis'}</h3>
        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${discountRate >= 20 ? 'bg-red-100 text-red-700' : discountRate >= 10 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
          %{discountRate} {currentLanguage === 'tr' ? 'ortalama iskonto' : 'avg discount'}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="bg-red-50 rounded-xl p-3 text-center">
          <p className="text-2xl font-black text-red-600">{fmtAna(totalDiscount,'K',0)}</p>
          <p className="text-[10px] text-gray-500 mt-0.5">{currentLanguage === 'tr' ? 'Toplam İskonto' : 'Total Discount Given'}</p>
        </div>
        <div className="bg-gray-50 rounded-xl p-3 text-center">
          <p className="text-2xl font-black text-gray-700">{fmtAna(totalListPrice,'K',0)}</p>
          <p className="text-[10px] text-gray-500 mt-0.5">{currentLanguage === 'tr' ? 'Liste Fiyatı Toplamı' : 'Total List Price'}</p>
        </div>
      </div>
      {topDiscountCusts.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-700 mb-2">{currentLanguage === 'tr' ? 'En Çok İskonto Alan Müşteriler:' : 'Top Discounted Customers:'}</p>
          <div className="space-y-1.5">
            {topDiscountCusts.map(([name, d]) => (
              <div key={name} className="flex items-center justify-between text-xs">
                <span className="text-gray-700 truncate">{name}</span>
                <div className="flex items-center gap-2 shrink-0 ml-2">
                  <span className="text-[10px] text-gray-400">{d.orders} {currentLanguage === 'tr' ? 'sipariş' : 'orders'}</span>
                  <span className="font-bold text-red-500">-{fmtAna(d.discount,'K',0)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
