/**
 * CrmBloklar2.tsx — CrmRapor bölmesi (2026-09-03)
 *
 * CrmRapor.tsx'ten mekanik olarak çıkarıldı (bölme öncesi satır 185–387, 4 blok).
 * Bloklar ORİJİNAL SIRASIYLA ve içeriği DEĞİŞTİRİLMEDEN taşındı; bloklardaki
 * `reportsTab === 'crm'` koşulları BİLEREK korundu (bkz. CrmRapor.tsx başlık
 * notu — ebeveyn zaten sekmeye göre render ediyor, koşulu silmek "saf kopya"
 * güvencesini bozardı).
 * Props yalnız bu dosyanın gerçekten kullandığı ctx alanlarıdır
 * (tsc "Cannot find name" listesinden çıkarıldı).
 */
import type { ReportsCtx } from '../useReportsData';

type Props = Pick<ReportsCtx, 'reportsTab' | 'orders' | 'inventory' | 'currentLanguage' | 'fmtAna'>;

export default function CrmBloklar2({ reportsTab, orders, inventory, currentLanguage, fmtAna }: Props) {
  return (
    <>
      {reportsTab === 'crm' && orders.length > 0 && inventory.length > 0 && (() => {
        // For each order, compare actualPrice vs list price to compute discount
        type DiscStat = { customer: string; orders: number; totalList: number; totalActual: number; discPct: number };
        const custMap: Record<string, DiscStat> = {};
        for (const o of orders) {
          if (o.status === 'Cancelled') continue;
          const name = o.customerName || '—';
          if (!custMap[name]) custMap[name] = { customer: name, orders: 0, totalList: 0, totalActual: 0, discPct: 0 };
          custMap[name].orders++;
          custMap[name].totalActual += o.totalPrice || 0;
          // Estimate list price from inventory retail prices × quantities
          const listPrice = (o.lineItems || []).reduce((s, li) => {
            const inv = inventory.find(i => i.id === li.inventoryId || i.name === li.name || i.sku === li.sku);
            return s + ((inv?.prices?.['Retail'] ?? inv?.price ?? li.price) * li.quantity);
          }, 0);
          custMap[name].totalList += listPrice || o.totalPrice || 0;
        }
        const discs = Object.values(custMap).map(c => ({
          ...c,
          discPct: c.totalList > 0 ? Math.round(((c.totalList - c.totalActual) / c.totalList) * 100) : 0,
        })).filter(c => c.orders >= 1).sort((a, b) => b.discPct - a.discPct).slice(0, 8);
        if (discs.length === 0 || discs.every(d => d.discPct === 0)) return null;
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? '🏷️ Müşteri İndirim Analizi' : '🏷️ Customer Discount Analysis'}</h3>
            <p className="text-xs text-gray-400 mb-4">{currentLanguage === 'tr' ? 'Liste fiyatına göre uygulanan ortalama indirim' : 'Average discount vs retail list price'}</p>
            <div className="space-y-2.5">
              {discs.map(c => (
                <div key={c.customer} className="flex items-center gap-3">
                  <span className="text-xs font-medium text-gray-800 w-36 truncate shrink-0">{c.customer}</span>
                  <div className="flex-1 h-2.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${c.discPct >= 20 ? 'bg-red-400' : c.discPct >= 10 ? 'bg-amber-400' : 'bg-emerald-400'}`}
                      style={{ width: `${Math.min(c.discPct * 3, 100)}%` }} />
                  </div>
                  <span className={`text-xs font-bold tabular-nums shrink-0 w-10 text-right ${c.discPct >= 20 ? 'text-red-600' : c.discPct >= 10 ? 'text-amber-600' : 'text-emerald-600'}`}>
                    %{c.discPct}
                  </span>
                  <span className="text-[10px] text-gray-400 shrink-0">{c.orders} {currentLanguage==='tr'?'sip.':'ord.'}</span>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-gray-400 mt-3">{currentLanguage==='tr'?'* İndirim = (Liste Fiyatı - Gerçekleşen) / Liste Fiyatı':'* Discount = (List Price - Actual) / List Price'}</p>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 3 && (() => {
        const now175 = new Date();
        const cutoff175 = new Date(now175); cutoff175.setDate(cutoff175.getDate() - 90);
        // Find customers whose last order was >90 days ago
        const lastOrderDate: Record<string, Date> = {};
        for (const o of orders) {
          if (o.status === 'Cancelled') continue;
          try {
            const d = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
            if (!lastOrderDate[o.customerName] || d > lastOrderDate[o.customerName]) {
              lastOrderDate[o.customerName] = d;
            }
          } catch { /* skip */ }
        }
        const winBack = Object.entries(lastOrderDate)
          .filter(([, d]) => d < cutoff175)
          .map(([name, lastDate]) => {
            const daysDormant = Math.floor((now175.getTime() - lastDate.getTime()) / 86400000);
            const custOrders = orders.filter(o => o.customerName === name && o.status !== 'Cancelled');
            const ltv = custOrders.reduce((s, o) => s + (o.totalPrice || 0), 0);
            return { name, daysDormant, ltv, orders: custOrders.length };
          })
          .sort((a, b) => b.ltv - a.ltv)
          .slice(0, 6);
        if (winBack.length === 0) return null;
        return (
          <div className="apple-card p-6 border border-amber-100">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '🔄 Geri Kazanım Listesi' : '🔄 Win-Back Candidates'}</h3>
              <span className="text-xs text-amber-700 font-bold bg-amber-50 px-2 py-0.5 rounded-full">{winBack.length} {currentLanguage==='tr'?'hareketsiz müşteri':'dormant customers'}</span>
            </div>
            <div className="space-y-2.5">
              {winBack.map((c, i) => (
                <div key={i} className="flex items-center justify-between py-1.5 border-b border-gray-50 last:border-0">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-gray-800 truncate">{c.name}</p>
                    <p className="text-[10px] text-gray-400">{c.daysDormant} {currentLanguage==='tr'?'gündür sipariş yok':'days since last order'} · {c.orders} {currentLanguage==='tr'?'önceki sip.':'prev orders'}</p>
                  </div>
                  <span className="text-xs font-bold text-amber-600 shrink-0 ml-3">{fmtAna(c.ltv,'K',1)} LTV</span>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-gray-400 mt-3">{currentLanguage==='tr'?'90+ gündür sipariş vermeyen yüksek değerli müşteriler':'High-value customers who haven\'t ordered in 90+ days'}</p>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 5 && (() => {
        // Compute LTV per customer
        const ltvMap: Record<string, { name: string; ltv: number; orders: number; avgOrder: number }> = {};
        for (const o of orders) {
          if (o.status === 'Cancelled') continue;
          const name = o.customerName || '—';
          if (!ltvMap[name]) ltvMap[name] = { name, ltv: 0, orders: 0, avgOrder: 0 };
          ltvMap[name].ltv += o.totalPrice || 0;
          ltvMap[name].orders++;
        }
        const customers = Object.values(ltvMap).map(c => ({ ...c, avgOrder: c.orders > 0 ? c.ltv / c.orders : 0 })).sort((a, b) => b.ltv - a.ltv);
        if (customers.length === 0) return null;
        // Tier by top 20% / mid 60% / bottom 20%
        const n = customers.length;
        const top20 = customers.slice(0, Math.ceil(n * 0.2));
        const mid60 = customers.slice(Math.ceil(n * 0.2), Math.ceil(n * 0.8));
        const bot20 = customers.slice(Math.ceil(n * 0.8));
        const tiers = [
          { label: currentLanguage==='tr'?'Platin (Top %20)':'Platinum (Top 20%)', customers: top20, color: 'text-purple-700', bg: 'bg-purple-50', border: 'border-purple-200' },
          { label: currentLanguage==='tr'?'Altın (Orta %60)':'Gold (Mid 60%)', customers: mid60, color: 'text-amber-700', bg: 'bg-amber-50', border: 'border-amber-200' },
          { label: currentLanguage==='tr'?'Gümüş (Alt %20)':'Silver (Bottom 20%)', customers: bot20, color: 'text-gray-600', bg: 'bg-gray-50', border: 'border-gray-200' },
        ];
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-4">{currentLanguage === 'tr' ? '💎 Müşteri LTV Segmentasyonu' : '💎 Customer LTV Segmentation'}</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {tiers.map(tier => {
                const tierLTV = tier.customers.reduce((s, c) => s + c.ltv, 0);
                return (
                  <div key={tier.label} className={`rounded-2xl border p-4 ${tier.bg} ${tier.border}`}>
                    <p className={`text-xs font-bold uppercase tracking-wide mb-2 ${tier.color}`}>{tier.label}</p>
                    <p className={`text-2xl font-black ${tier.color}`}>{tier.customers.length}</p>
                    <p className="text-[10px] text-gray-500 mt-0.5">{currentLanguage==='tr'?'müşteri':'customers'}</p>
                    <p className={`text-sm font-bold mt-2 ${tier.color}`}>{fmtAna(tierLTV,'K',1)}</p>
                    <p className="text-[10px] text-gray-500">{currentLanguage==='tr'?'toplam ciro':'total revenue'}</p>
                    {tier.customers.length > 0 && (
                      <div className="mt-2 pt-2 border-t border-white/60 space-y-0.5">
                        {tier.customers.slice(0, 3).map(c => (
                          <p key={c.name} className="text-[10px] text-gray-600 truncate">{c.name}</p>
                        ))}
                        {tier.customers.length > 3 && <p className="text-[10px] text-gray-400">+{tier.customers.length - 3} {currentLanguage==='tr'?'daha':'more'}</p>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.filter(o => o.status === 'Cancelled').length > 0 && (() => {
        const cancelled = orders.filter(o => o.status === 'Cancelled');
        const total = orders.length;
        const cancelRate = Math.round((cancelled.length / total) * 100);
        const cancelledRevLost = cancelled.reduce((s, o) => s + (o.totalPrice || 0), 0);
        // Cancellations by customer
        const custCancelMap: Record<string, number> = {};
        for (const o of cancelled) {
          const name = o.customerName || '—';
          custCancelMap[name] = (custCancelMap[name] ?? 0) + 1;
        }
        const topCancellers = Object.entries(custCancelMap).sort(([,a],[,b]) => b - a).slice(0, 5);
        // Cancellations by month
        const now161 = new Date();
        const cancelByMonth: Record<string, number> = {};
        for (const o of cancelled) {
          try {
            const d = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
            const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
            cancelByMonth[key] = (cancelByMonth[key] ?? 0) + 1;
          } catch { /* skip */ }
        }
        void now161;
        return (
          <div className="apple-card p-6 border border-red-50">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '❌ İptal Analizi' : '❌ Cancellation Analysis'}</h3>
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${cancelRate >= 15 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                %{cancelRate} {currentLanguage==='tr'?'iptal oranı':'cancel rate'}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-3 mb-4">
              {[
                { label: currentLanguage==='tr'?'İptal Edilen':'Cancelled', value: cancelled.length, color: 'text-red-600' },
                { label: currentLanguage==='tr'?'İptal Oranı':'Cancel Rate', value: `%${cancelRate}`, color: cancelRate >= 15 ? 'text-red-600' : 'text-amber-600' },
                { label: currentLanguage==='tr'?'Kayıp Ciro':'Revenue Lost', value: `₺${(cancelledRevLost/1000).toFixed(1)}K`, color: 'text-red-500' },
              ].map(k => (
                <div key={k.label} className="bg-gray-50 rounded-xl p-3 text-center">
                  <p className={`text-lg font-bold ${k.color}`}>{k.value}</p>
                  <p className="text-[10px] text-gray-400">{k.label}</p>
                </div>
              ))}
            </div>
            {topCancellers.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-600 mb-2">{currentLanguage==='tr'?'En Çok İptal Eden Müşteriler':'Top Cancelling Customers'}</p>
                <div className="space-y-1.5">
                  {topCancellers.map(([name, count]) => (
                    <div key={name} className="flex items-center justify-between text-xs">
                      <span className="text-gray-700 truncate">{name}</span>
                      <span className="text-red-500 font-bold ml-2">{count}×</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })()}
    </>
  );
}
