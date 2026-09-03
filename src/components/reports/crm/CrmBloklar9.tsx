/**
 * CrmBloklar9.tsx — CrmRapor bölmesi (2026-09-03)
 *
 * CrmRapor.tsx'ten mekanik olarak çıkarıldı (bölme öncesi satır 2407–2999, 15 blok).
 * Bloklar ORİJİNAL SIRASIYLA ve içeriği DEĞİŞTİRİLMEDEN taşındı; bloklardaki
 * `reportsTab === 'crm'` koşulları BİLEREK korundu (bkz. CrmRapor.tsx başlık
 * notu — ebeveyn zaten sekmeye göre render ediyor, koşulu silmek "saf kopya"
 * güvencesini bozardı).
 * Props yalnız bu dosyanın gerçekten kullandığı ctx alanlarıdır
 * (tsc "Cannot find name" listesinden çıkarıldı).
 */
import type { ReportsCtx } from '../useReportsData';

type Props = Pick<ReportsCtx, 'reportsTab' | 'orders' | 'quotations' | 'currentLanguage' | 'fmtAna'>;

export default function CrmBloklar9({ reportsTab, orders, quotations, currentLanguage, fmtAna }: Props) {
  return (
    <>
      {reportsTab === 'crm' && orders.length >= 5 && (() => {
        const segRev: Record<string, number> = {};
        orders.forEach(o => {
          const seg = (o as unknown as Record<string,unknown>).customerSegment as string || (o as unknown as Record<string,unknown>).segment as string || (o as unknown as Record<string,unknown>).customerType as string || 'Standard';
          segRev[seg] = (segRev[seg] || 0) + (o.totalPrice || 0);
        });
        const segs370 = Object.entries(segRev).map(([seg, rev]) => ({seg, rev})).sort((a, b) => b.rev - a.rev);
        if (segs370.length < 2) return null;
        const totalRev370 = segs370.reduce((s, d) => s + d.rev, 0);
        const colors370 = ['#6366f1','#10b981','#f59e0b','#3b82f6','#f97316','#8b5cf6'];
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? 'Müşteri Segmentine Göre Ciro' : 'Revenue by Customer Segment'}</h3>
            <p className="text-xs text-gray-500 mb-4">Total: {fmtAna(totalRev370,'full',0)}</p>
            <div className="space-y-2">
              {segs370.map((s, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs text-gray-700 w-24 truncate">{s.seg}</span>
                  <div className="flex-1 h-5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{width: `${totalRev370 > 0 ? (s.rev / totalRev370) * 100 : 0}%`, background: colors370[i % colors370.length]}} />
                  </div>
                  <span className="text-[10px] text-gray-400 w-8 text-right">{totalRev370 > 0 ? ((s.rev / totalRev370) * 100).toFixed(0) : 0}%</span>
                  <span className="text-xs font-bold w-24 text-right" style={{color: colors370[i % colors370.length]}}>{fmtAna(s.rev,'full',0)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 5 && (() => {
        const sourceMap: Record<string, {count: number; rev: number}> = {};
        orders.forEach(o => {
          const src = (o as unknown as Record<string,unknown>).source as string || (o as unknown as Record<string,unknown>).channel as string || (o as unknown as Record<string,unknown>).orderSource as string || 'Direct';
          if (!sourceMap[src]) sourceMap[src] = {count: 0, rev: 0};
          sourceMap[src].count++;
          sourceMap[src].rev += o.totalPrice || 0;
        });
        const sources = Object.entries(sourceMap).map(([src, d]) => ({src, ...d})).sort((a, b) => b.rev - a.rev);
        if (sources.length < 2) return null;
        const totalRev373 = sources.reduce((s, d) => s + d.rev, 0);
        const colors373 = ['#6366f1','#10b981','#f59e0b','#3b82f6','#f97316','#8b5cf6'];
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? 'Sipariş Kaynağı Dağılımı' : 'Order Source Mix'}</h3>
            <p className="text-xs text-gray-500 mb-4">Revenue share by acquisition channel</p>
            <div className="space-y-2">
              {sources.map((s, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{background: colors373[i % colors373.length]}} />
                  <span className="text-xs text-gray-700 flex-1 truncate">{s.src}</span>
                  <div className="w-28 h-3 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{width: `${totalRev373 > 0 ? (s.rev / totalRev373) * 100 : 0}%`, background: colors373[i % colors373.length]}} />
                  </div>
                  <span className="text-[10px] text-gray-400 w-8 text-right">{totalRev373 > 0 ? ((s.rev / totalRev373) * 100).toFixed(0) : 0}%</span>
                  <span className="text-xs font-bold w-20 text-right" style={{color: colors373[i % colors373.length]}}>{fmtAna(s.rev,'full',0)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 8 && (() => {
        const toTs377 = (v: unknown): number => {
          if (!v) return 0;
          if (typeof (v as {toDate?:()=>Date}).toDate === 'function') return (v as {toDate:()=>Date}).toDate().getTime();
          return new Date(v as string|number).getTime();
        };
        const firstOrder: Record<string, string> = {};
        [...orders].sort((a, b) => toTs377(a.createdAt) - toTs377(b.createdAt)).forEach(o => {
          if (!firstOrder[o.customerName]) firstOrder[o.customerName] = (() => {
            const d = new Date(toTs377(o.createdAt));
            return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          })();
        });
        const monthNew: Record<string, number> = {};
        Object.values(firstOrder).forEach(k => { monthNew[k] = (monthNew[k] || 0) + 1; });
        const keys377 = Object.keys(monthNew).sort().slice(-8);
        if (keys377.length < 3) return null;
        const maxNew = Math.max(...keys377.map(k => monthNew[k]), 1);
        const totalNew = keys377.reduce((s, k) => s + monthNew[k], 0);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? 'Yeni Müşteri Kazanımı' : 'New Customer Acquisition'}</h3>
            <p className="text-xs text-gray-500 mb-4">{totalNew} new customers across shown period</p>
            <div className="flex items-end gap-2 h-24">
              {keys377.map(k => (
                <div key={k} className="flex-1 flex flex-col items-center gap-0.5">
                  <span className="text-[9px] text-gray-500">{monthNew[k]}</span>
                  <div className="w-full rounded-t-lg bg-fuchsia-400 transition-all" style={{height: `${Math.max((monthNew[k] / maxNew) * 72, 4)}px`}} />
                  <span className="text-[9px] text-gray-400">{k.slice(5)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 8 && (() => {
        const toTs378 = (v: unknown): number => {
          if (!v) return 0;
          if (typeof (v as {toDate?:()=>Date}).toDate === 'function') return (v as {toDate:()=>Date}).toDate().getTime();
          return new Date(v as string|number).getTime();
        };
        const monthData378: Record<string, {orders: number; customers: Set<string>}> = {};
        orders.forEach(o => {
          const d = new Date(toTs378(o.createdAt));
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          if (!monthData378[key]) monthData378[key] = {orders: 0, customers: new Set()};
          monthData378[key].orders++;
          monthData378[key].customers.add(o.customerName || 'Unknown');
        });
        const keys378 = Object.keys(monthData378).sort().slice(-7);
        if (keys378.length < 3) return null;
        const avgPerCust = keys378.map(k => ({k, avg: monthData378[k].customers.size > 0 ? monthData378[k].orders / monthData378[k].customers.size : 0}));
        const maxAvg378 = Math.max(...avgPerCust.map(d => d.avg), 1);
        const overallAvg378 = avgPerCust.reduce((s, d) => s + d.avg, 0) / avgPerCust.length;
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? 'Müşteri Başına Aylık Ortalama Sipariş' : 'Avg Orders per Customer / Month'}</h3>
            <p className="text-xs text-gray-500 mb-4">Purchase frequency trend · Avg: {overallAvg378.toFixed(2)} orders/customer</p>
            <div className="flex items-end gap-2 h-24">
              {avgPerCust.map((d, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                  <span className="text-[9px] text-gray-500">{d.avg.toFixed(1)}</span>
                  <div className="w-full rounded-t-lg transition-all" style={{height: `${Math.max((d.avg / maxAvg378) * 72, 4)}px`, background: d.avg >= overallAvg378 ? '#10b981' : '#6366f1'}} />
                  <span className="text-[9px] text-gray-400">{d.k.slice(5)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 5 && (() => {
        const spend: Record<string, number> = {};
        orders.forEach(o => {
          const cid = (o as unknown as Record<string,unknown>).customerId as string | undefined
            || (o as unknown as Record<string,unknown>).customerName as string | undefined
            || 'Unknown';
          const oRec = o as unknown as Record<string,unknown>;
          const total = typeof oRec.total === 'number' ? oRec.total as number
            : (o.lineItems ?? []).reduce((s, li) => { const lr = li as unknown as Record<string,unknown>; return s + ((lr.quantity as number | undefined) ?? 0) * ((lr.unitPrice as number | undefined) ?? (lr.price as number | undefined) ?? 0); }, 0);
          spend[cid] = (spend[cid] ?? 0) + total;
        });
        const vals = Object.values(spend).sort((a, b) => b - a);
        if (vals.length < 3) return null;
        const tiers = [
          { label: 'Platinum', color: '#8b5cf6', min: vals[0] * 0.5 },
          { label: 'Gold',     color: '#f59e0b', min: vals[0] * 0.2 },
          { label: 'Silver',   color: '#6b7280', min: vals[0] * 0.05 },
          { label: 'Bronze',   color: '#b45309', min: 0 },
        ];
        const tierBuckets = tiers.map((t, i) => ({
          ...t,
          count: vals.filter(v => v >= t.min && (i === 0 || v < tiers[i - 1].min)).length,
        }));
        const maxC = Math.max(...tierBuckets.map(t => t.count), 1);
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">{currentLanguage === 'tr' ? 'Müşteri Yaşam Boyu Değer Kademeleri' : 'Customer Lifetime Value Tiers'}</h3>
            <div className="space-y-2">
              {tierBuckets.map(t => (
                <div key={t.label} className="flex items-center gap-2">
                  <span className="text-xs w-16 font-medium" style={{color: t.color}}>{t.label}</span>
                  <div className="flex-1 bg-gray-100 rounded-full h-5 overflow-hidden">
                    <div className="h-full rounded-full flex items-center pl-2 transition-all" style={{width: `${(t.count / maxC) * 100}%`, background: t.color}}>
                      <span className="text-white text-xs font-bold">{t.count > 0 ? t.count : ''}</span>
                    </div>
                  </div>
                  <span className="text-xs text-gray-500 w-10 text-right">{t.count} cust</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && quotations.length >= 3 && orders.length >= 3 && (() => {
        const monthOrders: Record<string, Set<string>> = {};
        orders.forEach(o => {
          const d = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string)) : null;
          if (!d) return;
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          if (!monthOrders[key]) monthOrders[key] = new Set();
          const qid = (o as unknown as Record<string,unknown>).quotationId as string | undefined;
          if (qid) monthOrders[key].add(qid);
        });
        const monthQuotes: Record<string, number> = {};
        quotations.forEach(q => {
          const d = q.createdAt ? ((q.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(q.createdAt as string)) : null;
          if (!d) return;
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          monthQuotes[key] = (monthQuotes[key] ?? 0) + 1;
        });
        const months = Object.keys(monthQuotes).sort().slice(-6);
        if (months.length < 2) return null;
        const rows = months.map(m => ({
          month: m.slice(5),
          quotes: monthQuotes[m] ?? 0,
          converted: (monthOrders[m]?.size ?? 0),
          rate: monthQuotes[m] > 0 ? Math.round(((monthOrders[m]?.size ?? 0) / monthQuotes[m]) * 100) : 0,
        }));
        const maxR = Math.max(...rows.map(r => r.rate), 1);
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">Quote → Order Conversion Rate by Month</h3>
            <div className="flex items-end gap-2 h-24 mb-1">
              {rows.map(r => (
                <div key={r.month} className="flex-1 flex flex-col items-center gap-0.5">
                  <span className="text-[9px] text-gray-500">{r.rate}%</span>
                  <div className="w-full rounded-sm" style={{height: `${(r.rate / maxR) * 64}px`, background: r.rate >= 50 ? '#22c55e' : r.rate >= 25 ? '#f59e0b' : '#ef4444', minHeight: r.rate > 0 ? 2 : 0}} />
                  <span className="text-[9px] text-gray-400">{r.month}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 5 && (() => {
        const byMonth: Record<string, {total: number; cancelled: number}> = {};
        orders.forEach(o => {
          const d = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string)) : null;
          if (!d) return;
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          if (!byMonth[key]) byMonth[key] = {total: 0, cancelled: 0};
          byMonth[key].total++;
          if (o.status === 'Cancelled' || (o.status as string) === 'İptal') byMonth[key].cancelled++;
        });
        const months = Object.keys(byMonth).sort().slice(-6);
        if (months.length < 2) return null;
        const rows = months.map(m => ({
          month: m.slice(5),
          rate: byMonth[m].total > 0 ? Math.round((byMonth[m].cancelled / byMonth[m].total) * 100) : 0,
          total: byMonth[m].total,
          cancelled: byMonth[m].cancelled,
        }));
        const maxR = Math.max(...rows.map(r => r.rate), 1);
        const totalCancelled = rows.reduce((s, r) => s + r.cancelled, 0);
        const totalOrders = rows.reduce((s, r) => s + r.total, 0);
        const overallRate = totalOrders > 0 ? ((totalCancelled / totalOrders) * 100).toFixed(1) : '0';
        return (
          <div className="apple-card p-4 mb-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-sm">{currentLanguage === 'tr' ? 'Sipariş İptal Oranı' : 'Order Cancellation Rate'}</h3>
              <span className="text-xs bg-red-100 text-red-700 rounded-full px-2 py-0.5">{overallRate}% overall</span>
            </div>
            <div className="flex items-end gap-2 h-20 mb-1">
              {rows.map(r => (
                <div key={r.month} className="flex-1 flex flex-col items-center gap-0.5">
                  <span className="text-[9px] text-gray-500">{r.rate}%</span>
                  <div className="w-full rounded-sm" style={{height: `${(r.rate / maxR) * 56}px`, background: r.rate >= 20 ? '#ef4444' : r.rate >= 10 ? '#f59e0b' : '#22c55e', minHeight: r.rate > 0 ? 2 : 0}} />
                  <span className="text-[9px] text-gray-400">{r.month}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 10 && (() => {
        const ordersByCustomer: Record<string, Date[]> = {};
        orders.forEach(o => {
          const d = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string)) : null;
          if (!d) return;
          const cid = (o as unknown as Record<string,unknown>).customerId as string | undefined
            || (o as unknown as Record<string,unknown>).customerName as string | undefined
            || 'Unknown';
          if (!ordersByCustomer[cid]) ordersByCustomer[cid] = [];
          ordersByCustomer[cid].push(d);
        });
        const gaps: number[] = [];
        Object.values(ordersByCustomer).forEach(dates => {
          if (dates.length < 2) return;
          dates.sort((a, b) => a.getTime() - b.getTime());
          for (let i = 1; i < dates.length; i++) {
            const gap = Math.round((dates[i].getTime() - dates[i-1].getTime()) / 86400000);
            if (gap > 0 && gap <= 365) gaps.push(gap);
          }
        });
        if (gaps.length < 3) return null;
        const avg = gaps.reduce((a,b) => a+b, 0) / gaps.length;
        const buckets = [[1,7,'1-7d'],[8,14,'8-14d'],[15,30,'15-30d'],[31,60,'1-2mo'],[61,90,'2-3mo'],[91,365,'3mo+']];
        const counts = buckets.map(([lo,hi,lbl]) => ({ label: lbl as string, count: gaps.filter(g => g >= (lo as number) && g <= (hi as number)).length }));
        const maxC = Math.max(...counts.map(c => c.count), 1);
        return (
          <div className="apple-card p-4 mb-4">
            <div className="flex justify-between items-center mb-3">
              <h3 className="font-semibold text-sm">{currentLanguage === 'tr' ? 'Siparişler Arası Ortalama Gün' : 'Avg Days Between Orders'}</h3>
              <span className="text-xs bg-purple-100 text-purple-700 rounded-full px-2 py-0.5">{avg.toFixed(0)}d avg</span>
            </div>
            <div className="flex items-end gap-2 h-20 mb-1">
              {counts.map(c => (
                <div key={c.label} className="flex-1 flex flex-col items-center gap-0.5">
                  <span className="text-[9px] text-gray-500">{c.count > 0 ? c.count : ''}</span>
                  <div className="w-full rounded-sm" style={{height: `${(c.count / maxC) * 56}px`, background: '#a78bfa', minHeight: c.count > 0 ? 2 : 0}} />
                  <span className="text-[9px] text-gray-400">{c.label}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 5 && (() => {
        const custOrders: Record<string, {count: number; revenue: number}> = {};
        orders.forEach(o => {
          const cid = (o as unknown as Record<string,unknown>).customerId as string | undefined
            || (o as unknown as Record<string,unknown>).customerName as string | undefined
            || 'Unknown';
          const oR = o as unknown as Record<string,unknown>;
          const total = typeof oR.total === 'number' ? oR.total as number
            : (o.lineItems ?? []).reduce((s, li) => { const lr = li as unknown as Record<string,unknown>; return s + ((lr.quantity as number|undefined)??0) * ((lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0); }, 0);
          if (!custOrders[cid]) custOrders[cid] = {count: 0, revenue: 0};
          custOrders[cid].count++;
          custOrders[cid].revenue += total;
        });
        const top5 = Object.entries(custOrders).sort((a, b) => b[1].count - a[1].count).slice(0, 5);
        if (top5.length === 0) return null;
        const maxC = top5[0][1].count;
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">{currentLanguage === 'tr' ? 'Sipariş Adedine Göre İlk 5 Müşteri' : 'Top 5 Customers by Order Count'}</h3>
            <div className="space-y-2">
              {top5.map(([name, d], i) => (
                <div key={name} className="flex items-center gap-2">
                  <span className="text-xs font-bold w-4 text-gray-400">#{i+1}</span>
                  <span className="text-xs truncate flex-1 text-gray-700">{name}</span>
                  <div className="w-20 bg-gray-100 rounded-full h-3 overflow-hidden">
                    <div className="h-full rounded-full" style={{width: `${(d.count / maxC) * 100}%`, background: '#ff4000'}} />
                  </div>
                  <span className="text-xs font-bold w-8 text-right text-brand">{d.count}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 8 && (() => {
        const custFirstOrder: Record<string, {date: Date; value: number}> = {};
        const allCustomerOrders: Record<string, {date: Date; value: number}[]> = {};
        orders.forEach(o => {
          const d = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string)) : null;
          if (!d) return;
          const cid = (o as unknown as Record<string,unknown>).customerId as string | undefined
            || (o as unknown as Record<string,unknown>).customerName as string | undefined
            || 'Unknown';
          const oR = o as unknown as Record<string,unknown>;
          const total = typeof oR.total === 'number' ? oR.total as number
            : (o.lineItems ?? []).reduce((s, li) => { const lr = li as unknown as Record<string,unknown>; return s + ((lr.quantity as number|undefined)??0) * ((lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0); }, 0);
          if (!allCustomerOrders[cid]) allCustomerOrders[cid] = [];
          allCustomerOrders[cid].push({date: d, value: total});
        });
        const firstOrderVals: number[] = [];
        const repeatOrderVals: number[] = [];
        Object.values(allCustomerOrders).forEach(oList => {
          oList.sort((a, b) => a.date.getTime() - b.date.getTime());
          if (oList.length > 0) firstOrderVals.push(oList[0].value);
          if (oList.length > 1) oList.slice(1).forEach(o => repeatOrderVals.push(o.value));
        });
        if (firstOrderVals.length < 2) return null;
        const avgFirst = firstOrderVals.reduce((a,b) => a+b, 0) / firstOrderVals.length;
        const avgRepeat = repeatOrderVals.length > 0 ? repeatOrderVals.reduce((a,b) => a+b, 0) / repeatOrderVals.length : 0;
        const maxVal = Math.max(avgFirst, avgRepeat, 1);
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">{currentLanguage === 'tr' ? 'İlk ve Tekrar Sipariş Tutarı' : 'First vs Repeat Order Value'}</h3>
            <div className="space-y-3">
              {[{label:'1st Order Avg', val: avgFirst, color: '#3b82f6', n: firstOrderVals.length},
                {label:'Repeat Avg', val: avgRepeat, color: '#22c55e', n: repeatOrderVals.length}].map(r => (
                <div key={r.label}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-gray-600">{r.label}</span>
                    <span className="font-bold" style={{color: r.color}}>{fmtAna(r.val,'full',0)} <span className="font-normal text-gray-400">({r.n})</span></span>
                  </div>
                  <div className="bg-gray-100 rounded-full h-3 overflow-hidden">
                    <div className="h-full rounded-full" style={{width: `${(r.val / maxVal) * 100}%`, background: r.color}} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 5 && (() => {
        const byMonth: Record<string, {lost: number; count: number}> = {};
        orders.forEach(o => {
          if (o.status !== 'Cancelled' && (o.status as string) !== 'İptal') return;
          const d = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string)) : null;
          if (!d) return;
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          const oR = o as unknown as Record<string,unknown>;
          const total = typeof oR.total === 'number' ? oR.total as number
            : (o.lineItems ?? []).reduce((s, li) => { const lr = li as unknown as Record<string,unknown>; return s + ((lr.quantity as number|undefined)??0) * ((lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0); }, 0);
          if (!byMonth[key]) byMonth[key] = {lost: 0, count: 0};
          byMonth[key].lost += total;
          byMonth[key].count++;
        });
        const months = Object.keys(byMonth).sort().slice(-6);
        if (months.length === 0) return (
          <div className="apple-card p-4 mb-4 flex items-center gap-2">
            <span className="text-green-500">✓</span>
            <span className="text-sm font-medium text-green-700">No cancelled orders — 0 lost revenue</span>
          </div>
        );
        const maxLost = Math.max(...months.map(m => byMonth[m].lost), 1);
        const totalLost = months.reduce((s, m) => s + byMonth[m].lost, 0);
        return (
          <div className="apple-card p-4 mb-4">
            <div className="flex justify-between items-center mb-3">
              <h3 className="font-semibold text-sm">Lost Revenue (Cancellations)</h3>
              <span className="text-xs bg-red-100 text-red-700 rounded-full px-2 py-0.5">{fmtAna(totalLost,'K',1)} total</span>
            </div>
            <div className="flex items-end gap-2 h-20 mb-1">
              {months.map(m => (
                <div key={m} className="flex-1 flex flex-col items-center gap-0.5">
                  <span className="text-[9px] text-gray-500">{byMonth[m].count}</span>
                  <div className="w-full rounded-sm" style={{height: `${(byMonth[m].lost / maxLost) * 56}px`, background: '#ef4444', minHeight: byMonth[m].lost > 0 ? 2 : 0}} />
                  <span className="text-[9px] text-gray-400">{m.slice(5)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 5 && (() => {
        const productCustomers: Record<string, Set<string>> = {};
        orders.forEach(o => {
          const cid = (o as unknown as Record<string,unknown>).customerId as string | undefined
            || (o as unknown as Record<string,unknown>).customerName as string | undefined
            || 'Unknown';
          (o.lineItems ?? []).forEach(li => {
            const liR = li as unknown as Record<string,unknown>;
            const name = (liR.productName as string | undefined) ?? (liR.name as string | undefined) ?? 'Unknown';
            if (!productCustomers[name]) productCustomers[name] = new Set();
            productCustomers[name].add(cid);
          });
        });
        const top = Object.entries(productCustomers)
          .sort((a, b) => b[1].size - a[1].size)
          .slice(0, 6);
        if (top.length === 0) return null;
        const maxSize = top[0][1].size;
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">{currentLanguage === 'tr' ? 'Müşteri Erişimine Göre Ürünler' : 'Products by Customer Reach'}</h3>
            <div className="space-y-2">
              {top.map(([name, custSet]) => (
                <div key={name} className="flex items-center gap-2">
                  <span className="text-xs truncate flex-1 text-gray-700">{name}</span>
                  <div className="w-20 bg-gray-100 rounded-full h-3 overflow-hidden">
                    <div className="h-full rounded-full" style={{width: `${(custSet.size / maxSize) * 100}%`, background: '#8b5cf6'}} />
                  </div>
                  <span className="text-xs font-bold w-8 text-right text-purple-600">{custSet.size}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 5 && (() => {
        const now = new Date();
        const lastOrderByCustomer: Record<string, Date> = {};
        const revenueByCustomer: Record<string, number> = {};
        orders.forEach(o => {
          const d = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string)) : null;
          if (!d) return;
          const cid = (o as unknown as Record<string,unknown>).customerName as string | undefined
            || (o as unknown as Record<string,unknown>).customerId as string | undefined
            || 'Unknown';
          if (!lastOrderByCustomer[cid] || d > lastOrderByCustomer[cid]) lastOrderByCustomer[cid] = d;
          const oR = o as unknown as Record<string,unknown>;
          const total = typeof oR.total === 'number' ? oR.total as number
            : (o.lineItems ?? []).reduce((s, li) => { const lr = li as unknown as Record<string,unknown>; return s + ((lr.quantity as number|undefined)??0) * ((lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0); }, 0);
          revenueByCustomer[cid] = (revenueByCustomer[cid] ?? 0) + total;
        });
        const churnRisk = Object.entries(lastOrderByCustomer)
          .map(([cid, lastDate]) => ({
            name: cid,
            daysSince: Math.floor((now.getTime() - lastDate.getTime()) / 86400000),
            revenue: revenueByCustomer[cid] ?? 0,
          }))
          .filter(c => c.daysSince >= 90)
          .sort((a, b) => b.revenue - a.revenue)
          .slice(0, 6);
        if (churnRisk.length === 0) return (
          <div className="apple-card p-4 mb-4 flex items-center gap-2">
            <span className="text-green-500">✓</span>
            <span className="text-sm font-medium text-green-700">All customers active within 90 days</span>
          </div>
        );
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
              <span>⚠️ Churn Risk (&gt;90d no order)</span>
              <span className="text-xs bg-red-100 text-red-700 rounded-full px-2 py-0.5">{churnRisk.length}</span>
            </h3>
            <div className="space-y-2">
              {churnRisk.map((c, i) => (
                <div key={i} className="flex items-center justify-between text-xs">
                  <span className="truncate flex-1 text-gray-700">{c.name}</span>
                  <span className="text-gray-400 mx-2">{fmtAna(c.revenue,'K',0)}</span>
                  <span className="font-bold" style={{color: c.daysSince >= 180 ? '#ef4444' : '#f59e0b'}}>{c.daysSince}d</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 10 && (() => {
        const hourCounts = new Array(24).fill(0);
        orders.forEach(o => {
          const d = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string)) : null;
          if (!d) return;
          hourCounts[d.getHours()]++;
        });
        const maxH = Math.max(...hourCounts, 1);
        const peakHour = hourCounts.indexOf(Math.max(...hourCounts));
        const businessHours = hourCounts.slice(8, 19);
        const businessTotal = businessHours.reduce((a,b) => a+b, 0);
        const totalOrders = hourCounts.reduce((a,b) => a+b, 0);
        return (
          <div className="apple-card p-4 mb-4">
            <div className="flex justify-between items-center mb-3">
              <h3 className="font-semibold text-sm">{currentLanguage === 'tr' ? 'Saate Göre Siparişler' : 'Orders by Hour'}</h3>
              <span className="text-xs bg-blue-100 text-blue-700 rounded-full px-2 py-0.5">Peak: {peakHour}:00</span>
            </div>
            <div className="flex items-end gap-0.5 h-16">
              {hourCounts.map((count, h) => (
                <div key={h} className="flex-1 rounded-sm transition-all" style={{
                  height: `${(count / maxH) * 52}px`,
                  background: h === peakHour ? '#ff4000' : h >= 8 && h <= 18 ? '#3b82f6' : '#d1d5db',
                  minHeight: count > 0 ? 1 : 0,
                }} title={`${h}:00 — ${count} orders`} />
              ))}
            </div>
            <div className="flex justify-between text-[9px] text-gray-400 mt-1">
              <span>00:00</span><span>12:00</span><span>23:00</span>
            </div>
            <p className="text-[10px] text-gray-400 mt-1 text-center">{totalOrders > 0 ? Math.round((businessTotal/totalOrders)*100) : 0}% during business hours (8-18)</p>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 5 && (() => {
        const custRevenue: Record<string, number> = {};
        orders.forEach(o => {
          const cid = (o as unknown as Record<string,unknown>).customerName as string | undefined
            || (o as unknown as Record<string,unknown>).customerId as string | undefined
            || 'Unknown';
          const oR = o as unknown as Record<string,unknown>;
          const total = typeof oR.total === 'number' ? oR.total as number
            : (o.lineItems ?? []).reduce((s, li) => { const lr = li as unknown as Record<string,unknown>; return s + ((lr.quantity as number|undefined)??0) * ((lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0); }, 0);
          custRevenue[cid] = (custRevenue[cid] ?? 0) + total;
        });
        const sorted = Object.values(custRevenue).sort((a, b) => b - a);
        if (sorted.length < 3) return null;
        const totalRev = sorted.reduce((a,b) => a+b, 0);
        const top20Count = Math.max(1, Math.ceil(sorted.length * 0.2));
        const top20Rev = sorted.slice(0, top20Count).reduce((a,b) => a+b, 0);
        const top20Pct = totalRev > 0 ? Math.round((top20Rev / totalRev) * 100) : 0;
        // Build cumulative Pareto data
        let cumRev = 0;
        const paretoPoints = sorted.map((v, i) => {
          cumRev += v;
          return { custPct: Math.round(((i+1)/sorted.length)*100), revPct: Math.round((cumRev/totalRev)*100) };
        });
        const w = 240; const h = 60; const pad = 8;
        const pts = paretoPoints.map(p => `${pad + (p.custPct / 100) * (w-2*pad)},${h - pad - (p.revPct / 100) * (h-2*pad)}`).join(' ');
        return (
          <div className="apple-card p-4 mb-4">
            <div className="flex justify-between items-center mb-2">
              <h3 className="font-semibold text-sm">{currentLanguage === 'tr' ? 'Ciro Pareto' : 'Revenue Pareto'}</h3>
              <span className="text-xs bg-purple-100 text-purple-700 rounded-full px-2 py-0.5">Top 20% → {top20Pct}% revenue</span>
            </div>
            <svg width="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{height: 60}}>
              <line x1={pad} y1={pad} x2={w-pad} y2={h-pad} stroke="#e5e7eb" strokeWidth="1" strokeDasharray="4 4" />
              <polyline points={pts} fill="none" stroke="#8b5cf6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <line x1={pad + 0.2*(w-2*pad)} y1={pad} x2={pad + 0.2*(w-2*pad)} y2={h-pad} stroke="#f59e0b" strokeWidth="1" strokeDasharray="3 3" />
            </svg>
            <div className="flex justify-between text-[9px] text-gray-400 mt-1">
              <span>0% customers</span><span>100%</span>
            </div>
          </div>
        );
      })()}
    </>
  );
}
