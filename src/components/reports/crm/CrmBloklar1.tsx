/**
 * CrmBloklar1.tsx — CrmRapor bölmesi (2026-09-03)
 *
 * CrmRapor.tsx'ten mekanik olarak çıkarıldı (bölme öncesi satır 73–179, 2 blok).
 * Bloklar ORİJİNAL SIRASIYLA ve içeriği DEĞİŞTİRİLMEDEN taşındı; bloklardaki
 * `reportsTab === 'crm'` koşulları BİLEREK korundu (bkz. CrmRapor.tsx başlık
 * notu — ebeveyn zaten sekmeye göre render ediyor, koşulu silmek "saf kopya"
 * güvencesini bozardı).
 * Props yalnız bu dosyanın gerçekten kullandığı ctx alanlarıdır
 * (tsc "Cannot find name" listesinden çıkarıldı).
 */
import { type Order } from '../../../types';
import type { ReportsCtx } from '../useReportsData';

type Props = Pick<ReportsCtx, 'reportsTab' | 'orders' | 'currentLanguage' | 'fmtAna'>;

export default function CrmBloklar1({ reportsTab, orders, currentLanguage, fmtAna }: Props) {
  return (
    <>
      {reportsTab === 'crm' && orders.length >= 3 && (() => {
        const now172 = new Date();
        const thisMonth172 = `${now172.getFullYear()}-${String(now172.getMonth()+1).padStart(2,'0')}`;
        // Find first-order-ever date per customer
        const firstOrderDate: Record<string, string> = {};
        for (const o of orders) {
          if (o.status === 'Cancelled') continue;
          try {
            const d = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
            const mkey = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
            const name = o.customerName || '—';
            if (!firstOrderDate[name] || mkey < firstOrderDate[name]) firstOrderDate[name] = mkey;
          } catch { /* skip */ }
        }
        // New customers this month (first order is this month)
        const newThisMonth = Object.entries(firstOrderDate)
          .filter(([, m]) => m === thisMonth172)
          .map(([name]) => {
            const custOrders = orders.filter(o => o.customerName === name && o.status !== 'Cancelled');
            const revenue = custOrders.reduce((s, o) => s + (o.totalPrice || 0), 0);
            return { name, revenue, orders: custOrders.length };
          })
          .sort((a, b) => b.revenue - a.revenue);
        if (newThisMonth.length === 0) return null;
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '🌟 Bu Ayin Yeni Müşterileri' : '🌟 New Customers This Month'}</h3>
              <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">{newThisMonth.length} {currentLanguage==='tr'?'yeni':'new'}</span>
            </div>
            <div className="space-y-2">
              {newThisMonth.slice(0, 6).map((c, i) => (
                <div key={i} className="flex items-center justify-between py-1.5 border-b border-gray-50 last:border-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-5 h-5 rounded-full bg-emerald-100 flex items-center justify-center text-[9px] font-bold text-emerald-700 shrink-0">{i+1}</span>
                    <span className="text-xs font-medium text-gray-800 truncate">{c.name}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 ml-2">
                    <span className="text-[10px] text-gray-400">{c.orders} {currentLanguage==='tr'?'sip.':'ord.'}</span>
                    <span className="text-xs font-bold text-emerald-600">{fmtAna(c.revenue)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length > 3 && (() => {
        // New vs Returning customers per month (last 6 months)
        const now139 = new Date();
        const months139 = Array.from({ length: 6 }, (_, i) => {
          const d = new Date(now139.getFullYear(), now139.getMonth() - (5 - i), 1);
          return { year: d.getFullYear(), month: d.getMonth(), label: d.toLocaleString(currentLanguage === 'tr' ? 'tr-TR' : 'en-US', { month: 'short' }) };
        });
        const getOD139 = (o: Order): Date => {
          const raw = o.createdAt ?? o.syncedAt;
          if (!raw) return new Date(0);
          return typeof (raw as { toDate?: () => Date }).toDate === 'function' ? (raw as { toDate: () => Date }).toDate() : new Date(raw as string | number);
        };
        // Build first-order date per customer
        const firstOrderMap: Record<string, Date> = {};
        for (const o of [...orders].sort((a, b) => getOD139(a).getTime() - getOD139(b).getTime())) {
          if (!firstOrderMap[o.customerName]) firstOrderMap[o.customerName] = getOD139(o);
        }
        const data139 = months139.map(m => {
          const monthOrders = orders.filter(o => {
            const d = getOD139(o);
            return d.getFullYear() === m.year && d.getMonth() === m.month;
          });
          const customers = [...new Set(monthOrders.map(o => o.customerName))];
          const newCustomers = customers.filter(c => {
            const first = firstOrderMap[c];
            return first && first.getFullYear() === m.year && first.getMonth() === m.month;
          }).length;
          return { label: m.label, new: newCustomers, returning: customers.length - newCustomers };
        });
        const maxBar = Math.max(...data139.map(d => d.new + d.returning), 1);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? '🔄 Müşteri Tutma Analizi' : '🔄 Customer Retention'}</h3>
            <p className="text-xs text-gray-400 mb-4">{currentLanguage === 'tr' ? 'Yeni vs Geri dönen müşteriler' : 'New vs returning customers per month'}</p>
            <div className="flex items-end gap-3 h-32 mb-3">
              {data139.map((d, i) => {
                const totalH = (d.new + d.returning) / maxBar * 100;
                const newH = (d.new / maxBar) * 100;
                const retH = (d.returning / maxBar) * 100;
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1">
                    <div className="w-full flex flex-col justify-end" style={{ height: '100px' }}>
                      <div className="w-full flex flex-col overflow-hidden rounded-t-md" style={{ height: `${totalH}%` }}>
                        <div style={{ height: `${totalH > 0 ? (retH / totalH) * 100 : 0}%` }} className="w-full bg-brand/40 rounded-t-sm" />
                        <div style={{ height: `${totalH > 0 ? (newH / totalH) * 100 : 0}%` }} className="w-full bg-brand" />
                      </div>
                    </div>
                    <span className="text-[9px] text-gray-400 font-semibold">{d.label}</span>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center gap-4 pt-3 border-t border-gray-50">
              <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-brand flex-shrink-0" /><span className="text-[10px] text-gray-500">{currentLanguage === 'tr' ? 'Yeni' : 'New'}</span></div>
              <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-brand/40 flex-shrink-0" /><span className="text-[10px] text-gray-500">{currentLanguage === 'tr' ? 'Geri Dönen' : 'Returning'}</span></div>
            </div>
          </div>
        );
      })()}
    </>
  );
}
