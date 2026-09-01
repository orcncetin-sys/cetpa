/**
 * MusteriChurnAnalizi — CrmRapor.tsx'ten mekanik bölme ile çıkarıldı (2026-08-31).
 * Gövde BİREBİR taşındı (davranış değişmedi; yalnız girinti düzeltildi).
 * Render koşulu `reportsTab === 'crm' && orders.length >= 5` ebeveyn CrmRapor.tsx'te durur.
 * Props: ReportsCtx'in tamamı DEĞİL — yalnız bu kartın gerçekten kullandığı alanlar.
 */
import { type Order } from '../../../types';
import type { ReportsCtx } from '../useReportsData';

type Props = Pick<ReportsCtx, 'orders' | 'currentLanguage' | 'fmtAna'>;

export default function MusteriChurnAnalizi({ orders, currentLanguage, fmtAna }: Props) {
  const now187 = new Date();
  const prevMonthStart = new Date(now187.getFullYear(), now187.getMonth() - 1, 1);
  const prevMonthEnd = new Date(now187.getFullYear(), now187.getMonth(), 0, 23, 59, 59);
  const currMonthStart = new Date(now187.getFullYear(), now187.getMonth(), 1);
  const getDate187 = (o: Order) => {
    try { return (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string); }
    catch { return null; }
  };
  const prevCustomers = new Set<string>();
  const currCustomers = new Set<string>();
  const prevRevByCustomer: Record<string, number> = {};
  for (const o of orders) {
    if (o.status === 'Cancelled') continue;
    const d = getDate187(o);
    if (!d) continue;
    const name = o.customerName || '—';
    if (d >= prevMonthStart && d <= prevMonthEnd) {
      prevCustomers.add(name);
      prevRevByCustomer[name] = (prevRevByCustomer[name] ?? 0) + (o.totalPrice || 0);
    }
    if (d >= currMonthStart) currCustomers.add(name);
  }
  const churned = [...prevCustomers].filter(c => !currCustomers.has(c));
  const churnedRevLost = churned.reduce((s, c) => s + (prevRevByCustomer[c] ?? 0), 0);
  const newCustomers = [...currCustomers].filter(c => !prevCustomers.has(c));
  const churnRate = prevCustomers.size > 0 ? Math.round((churned.length / prevCustomers.size) * 100) : 0;
  if (churned.length === 0 && newCustomers.length === 0) return null;
  return (
    <div className="apple-card p-6">
      <div className="flex items-center justify-between mb-1">
        <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '📤 Müşteri Churn Analizi' : '📤 Customer Churn Analysis'}</h3>
        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${churnRate >= 30 ? 'bg-red-100 text-red-700' : churnRate >= 15 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
          %{churnRate} {currentLanguage === 'tr' ? 'churn' : 'churn rate'}
        </span>
      </div>
      <p className="text-[10px] text-gray-400 mb-4">{currentLanguage === 'tr' ? 'Önceki ay aktif → bu ay sipariş vermeyen müşteriler' : 'Active last month → no orders this month'}</p>
      <div className="grid grid-cols-3 gap-3 mb-4">
        {[
          { label: currentLanguage === 'tr' ? 'Kaybedilen' : 'Churned', value: churned.length, color: 'text-red-600' },
          { label: currentLanguage === 'tr' ? 'Kayıp Ciro' : 'Lost Revenue', value: `₺${(churnedRevLost/1000).toFixed(1)}K`, color: 'text-red-500' },
          { label: currentLanguage === 'tr' ? 'Yeni Müşteri' : 'New Customers', value: newCustomers.length, color: 'text-emerald-600' },
        ].map(k => (
          <div key={k.label} className="bg-gray-50 rounded-xl p-3 text-center">
            <p className={`text-xl font-bold ${k.color}`}>{k.value}</p>
            <p className="text-[10px] text-gray-500 mt-0.5">{k.label}</p>
          </div>
        ))}
      </div>
      {churned.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-700 mb-2">{currentLanguage === 'tr' ? 'Kaybedilen Müşteriler:' : 'Churned Customers:'}</p>
          <div className="space-y-1">
            {churned.slice(0, 5).map(c => (
              <div key={c} className="flex items-center justify-between text-xs py-1 border-b border-gray-50 last:border-0">
                <span className="text-gray-700 truncate">{c}</span>
                <span className="text-red-500 font-medium shrink-0 ml-2">-{fmtAna((prevRevByCustomer[c] ?? 0),'full',0)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
