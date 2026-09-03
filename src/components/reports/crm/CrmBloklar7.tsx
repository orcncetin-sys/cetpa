/**
 * CrmBloklar7.tsx — CrmRapor bölmesi (2026-09-03)
 *
 * CrmRapor.tsx'ten mekanik olarak çıkarıldı (bölme öncesi satır 1245–1810, 13 blok).
 * Bloklar ORİJİNAL SIRASIYLA ve içeriği DEĞİŞTİRİLMEDEN taşındı; bloklardaki
 * `reportsTab === 'crm'` koşulları BİLEREK korundu (bkz. CrmRapor.tsx başlık
 * notu — ebeveyn zaten sekmeye göre render ediyor, koşulu silmek "saf kopya"
 * güvencesini bozardı).
 * Props yalnız bu dosyanın gerçekten kullandığı ctx alanlarıdır
 * (tsc "Cannot find name" listesinden çıkarıldı).
 */
import { itemCostTRY, type ReportsCtx } from '../useReportsData';

type Props = Pick<ReportsCtx, 'reportsTab' | 'orders' | 'quotations' | 'inventory' | 'exchangeRates' | 'currentLanguage' | 'fmtAna'>;

export default function CrmBloklar7({ reportsTab, orders, quotations, inventory, exchangeRates, currentLanguage, fmtAna }: Props) {
  return (
    <>
      {reportsTab === 'crm' && orders.length >= 5 && (() => {
        const now258 = new Date();
        const monthStart258 = new Date(now258.getFullYear(), now258.getMonth(), 1);
        const mOrders258 = orders.filter(o => {
          if (o.status === 'Cancelled') return false;
          try {
            const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
            return od >= monthStart258;
          } catch { return false; }
        });
        if (mOrders258.length < 3) return null;
        const custRevMap258: Record<string, number> = {};
        for (const o of mOrders258) {
          const name = o.customerName || '—';
          custRevMap258[name] = (custRevMap258[name] ?? 0) + (o.totalPrice || 0);
        }
        const sorted258 = Object.entries(custRevMap258).sort(([,a],[,b]) => b - a).slice(0, 8);
        const total258 = sorted258.reduce((s,[,v]) => s + v, 0);
        let cumPct258 = 0;
        const withCum = sorted258.map(([name, rev]) => {
          const pct = total258 > 0 ? Math.round((rev / total258) * 100) : 0;
          cumPct258 += pct;
          return { name, rev, pct, cumPct: cumPct258 };
        });
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '🥧 Bu Ay Müşteri Cüzdan Payı' : '🥧 This Month Customer Wallet Share'}</h3>
              <span className="text-[10px] text-gray-400">{withCum.length} {currentLanguage === 'tr' ? 'müşteri' : 'customers'} · {fmtAna(total258,'K',0)}</span>
            </div>
            <div className="space-y-2">
              {withCum.map((c, i) => (
                <div key={c.name}>
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-xs font-medium text-gray-700 truncate">{c.name}</span>
                    <div className="flex items-center gap-2 shrink-0 ml-2">
                      <span className="text-[10px] text-purple-600 font-bold">Σ%{c.cumPct}</span>
                      <span className="text-xs font-bold text-gray-700">%{c.pct}</span>
                    </div>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${i === 0 ? 'bg-purple-500' : i === 1 ? 'bg-purple-400' : i <= 3 ? 'bg-purple-300' : 'bg-gray-300'}`} style={{ width: `${Math.max(4, c.pct)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 10 && (() => {
        const firstOrderByCustomer: Record<string, Date> = {};
        [...orders].sort((a,b) => {
          const da = (a.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(a.createdAt as string);
          const db = (b.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(b.createdAt as string);
          return da.getTime() - db.getTime();
        }).forEach(o => {
          if (!firstOrderByCustomer[o.customerName]) {
            firstOrderByCustomer[o.customerName] = (o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string);
          }
        });
        const monthCounts: Record<string, number> = {};
        Object.values(firstOrderByCustomer).forEach(d => {
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          monthCounts[key] = (monthCounts[key] || 0) + 1;
        });
        const months = Object.keys(monthCounts).sort().slice(-12);
        if (months.length < 2) return null;
        const maxC = Math.max(...months.map(m => monthCounts[m]));
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? 'Aya Göre Müşteri Kazanımı' : 'Customer Acquisition by Month'}</h3>
            <p className="text-xs text-gray-500 mb-4">New customers (first order) per month — last 12 months</p>
            <div className="flex items-end gap-1 h-28">
              {months.map(m => (
                <div key={m} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-[9px] text-gray-600 font-bold">{monthCounts[m]}</span>
                  <div className="w-full rounded-t" style={{ height: `${maxC > 0 ? (monthCounts[m]/maxC*80) : 4}px`, background: '#10b981', minHeight: '4px' }} />
                  <span className="text-[8px] text-gray-400 rotate-45 origin-left whitespace-nowrap">{m.slice(5)}/{m.slice(2,4)}</span>
                </div>
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-4">Total new customers tracked: {Object.keys(firstOrderByCustomer).length}</p>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 10 && (() => {
        const tiers: Record<string, {revenue: number; orders: number; customers: Set<string>}> = {};
        orders.forEach(o => {
          const tier = o.customerType || 'Unknown';
          if (!tiers[tier]) tiers[tier] = { revenue: 0, orders: 0, customers: new Set() };
          tiers[tier].revenue += o.totalPrice;
          tiers[tier].orders++;
          tiers[tier].customers.add(o.customerName);
        });
        const tierData = Object.entries(tiers).map(([tier, d]) => ({
          tier,
          revenue: d.revenue,
          orders: d.orders,
          customers: d.customers.size,
          avgOrder: d.orders > 0 ? d.revenue / d.orders : 0,
          revenuePerCustomer: d.customers.size > 0 ? d.revenue / d.customers.size : 0,
        })).sort((a,b) => b.revenue - a.revenue);
        if (tierData.length === 0) return null;
        const totalRevenue = tierData.reduce((s,t) => s+t.revenue, 0);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-3">{currentLanguage === 'tr' ? 'Müşteri Kademesi Ciro Matrisi' : 'Customer Tier Revenue Matrix'}</h3>
            <div className="overflow-x-auto">
              <table className="min-w-[560px] w-full text-xs">
                <thead>
                  <tr className="text-gray-500 border-b border-gray-100">
                    <th className="text-left pb-2">Tier</th>
                    <th className="text-right pb-2">Revenue</th>
                    <th className="text-right pb-2">Share</th>
                    <th className="text-right pb-2">Orders</th>
                    <th className="text-right pb-2">Customers</th>
                    <th className="text-right pb-2">Avg Order</th>
                    <th className="text-right pb-2">Rev/Customer</th>
                  </tr>
                </thead>
                <tbody>
                  {tierData.map((t,i) => (
                    <tr key={i} className="border-b border-gray-50">
                      <td className="py-2 font-medium text-gray-800">{t.tier}</td>
                      <td className="py-2 text-right">{fmtAna(t.revenue,'full',0)}</td>
                      <td className="py-2 text-right font-bold" style={{ color: i===0?'#10b981':'#6b7280' }}>{totalRevenue > 0 ? ((t.revenue/totalRevenue)*100).toFixed(1) : 0}%</td>
                      <td className="py-2 text-right">{t.orders}</td>
                      <td className="py-2 text-right">{t.customers}</td>
                      <td className="py-2 text-right">{fmtAna(t.avgOrder,'full',0)}</td>
                      <td className="py-2 text-right">{fmtAna(t.revenuePerCustomer,'full',0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 10 && (() => {
        const repData: Record<string, {revenue: number; cost: number; count: number}> = {};
        orders.forEach(o => {
          const rep = (o.assignedTo as string) || 'Unassigned';
          if (!repData[rep]) repData[rep] = { revenue: 0, cost: 0, count: 0 };
          repData[rep].revenue += o.totalPrice;
          repData[rep].count++;
          repData[rep].cost += (o.lineItems || []).reduce((s, li) => {
            const inv = inventory.find(it => it.id === li.inventoryId || it.sku === li.sku);
            return s + (inv ? itemCostTRY(inv, exchangeRates) : (li.costPrice || 0)) * li.quantity;
          }, 0);
        });
        const reps = Object.entries(repData)
          .map(([rep, d]) => ({ rep, revenue: d.revenue, cost: d.cost, count: d.count, margin: d.revenue - d.cost, marginPct: d.revenue > 0 ? ((d.revenue - d.cost)/d.revenue*100) : 0 }))
          .sort((a,b) => b.margin - a.margin).slice(0,8);
        if (reps.length === 0) return null;
        const maxMargin = Math.max(...reps.map(r => r.margin));
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-3">{currentLanguage === 'tr' ? 'Satış Temsilcisine Göre Brüt Marj' : 'Gross Margin by Sales Rep'}</h3>
            <div className="space-y-2">
              {reps.map((r,i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs text-gray-700 w-28 truncate font-medium">{r.rep}</span>
                  <div className="flex-1 h-5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${maxMargin > 0 ? Math.max(2, r.margin/maxMargin*100) : 2}%`, background: r.marginPct >= 30 ? '#10b981' : r.marginPct >= 15 ? '#f59e0b' : '#ef4444' }} />
                  </div>
                  <span className="text-xs font-bold w-12 text-right" style={{ color: r.marginPct >= 30 ? '#10b981' : r.marginPct >= 15 ? '#f59e0b' : '#ef4444' }}>{r.marginPct.toFixed(0)}%</span>
                  <span className="text-xs text-gray-400 w-20 text-right">{fmtAna(r.margin,'full',0)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 10 && (() => {
        const segments: Record<string, {revenue: number; cost: number; orders: number; customers: Set<string>}> = {};
        orders.forEach(o => {
          const seg = o.customerType || 'Unknown';
          if (!segments[seg]) segments[seg] = { revenue: 0, cost: 0, orders: 0, customers: new Set() };
          segments[seg].revenue += o.totalPrice;
          segments[seg].orders++;
          segments[seg].customers.add(o.customerName);
          segments[seg].cost += (o.lineItems || []).reduce((s, li) => {
            const inv = inventory.find(it => it.id === li.inventoryId || it.sku === li.sku);
            return s + (inv ? itemCostTRY(inv, exchangeRates) : (li.costPrice || 0)) * li.quantity;
          }, 0);
        });
        const data = Object.entries(segments).map(([seg, d]) => ({
          seg, revenue: d.revenue, cost: d.cost, orders: d.orders, customers: d.customers.size,
          margin: d.revenue - d.cost,
          marginPct: d.revenue > 0 ? ((d.revenue - d.cost)/d.revenue*100) : 0,
          ltv: d.customers.size > 0 ? d.revenue / d.customers.size : 0,
        })).sort((a,b) => b.margin - a.margin);
        if (data.length === 0) return null;
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-3">{currentLanguage === 'tr' ? 'Müşteri Segmenti Kârlılığı' : 'Customer Segment Profitability'}</h3>
            <div className="space-y-4">
              {data.map((d,i) => (
                <div key={i} className="border border-gray-100 rounded-xl p-4">
                  <div className="flex justify-between items-center mb-2">
                    <span className="font-bold text-gray-800">{d.seg}</span>
                    <span className="text-sm font-black" style={{ color: d.marginPct >= 25 ? '#10b981' : d.marginPct >= 10 ? '#f59e0b' : '#ef4444' }}>{d.marginPct.toFixed(1)}% margin</span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs text-center">
                    <div className="bg-gray-50 rounded-lg p-2"><div className="font-bold text-gray-800">{fmtAna(d.revenue,'K',0)}</div><div className="text-gray-400">Revenue</div></div>
                    <div className="bg-gray-50 rounded-lg p-2"><div className="font-bold text-gray-800">{fmtAna(d.margin,'K',0)}</div><div className="text-gray-400">Margin</div></div>
                    <div className="bg-gray-50 rounded-lg p-2"><div className="font-bold text-gray-800">{d.customers}</div><div className="text-gray-400">Customers</div></div>
                    <div className="bg-gray-50 rounded-lg p-2"><div className="font-bold text-gray-800">{fmtAna(d.ltv,'K',0)}</div><div className="text-gray-400">LTV</div></div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 10 && (() => {
        const geoRevenue: Record<string, {revenue: number; orders: number}> = {};
        orders.forEach(o => {
          const addr = (o.shippingAddress || '').toLowerCase();
          let region = 'Unknown';
          if (addr.includes('istanbul') || addr.includes('İstanbul')) region = 'İstanbul';
          else if (addr.includes('ankara')) region = 'Ankara';
          else if (addr.includes('izmir') || addr.includes('İzmir')) region = 'İzmir';
          else if (addr.includes('bursa')) region = 'Bursa';
          else if (addr.includes('antalya')) region = 'Antalya';
          else if (addr.includes('adana')) region = 'Adana';
          else if (addr.match(/\b(tr|turkey|türkiye)\b/)) region = 'Other TR';
          else if (addr.length > 3) region = 'Other';
          if (!geoRevenue[region]) geoRevenue[region] = { revenue: 0, orders: 0 };
          geoRevenue[region].revenue += o.totalPrice;
          geoRevenue[region].orders++;
        });
        const regions = Object.entries(geoRevenue)
          .map(([region, d]) => ({ region, ...d }))
          .sort((a,b) => b.revenue - a.revenue).slice(0,7);
        if (regions.length === 0 || (regions.length === 1 && regions[0].region === 'Unknown')) return null;
        const totalRev = regions.reduce((s,r)=>s+r.revenue,0);
        const maxRev = Math.max(...regions.map(r=>r.revenue));
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-3">{currentLanguage === 'tr' ? 'Bölgeye Göre Ciro Yoğunlaşması' : 'Revenue Concentration by Region'}</h3>
            <div className="space-y-2">
              {regions.map((r,i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs text-gray-700 w-24 font-medium">{r.region}</span>
                  <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full bg-indigo-500" style={{ width: `${maxRev>0?(r.revenue/maxRev*100):0}%` }} />
                  </div>
                  <span className="text-xs text-gray-500 w-10 text-right">{r.orders} ord</span>
                  <span className="text-xs font-bold text-indigo-700 w-10 text-right">{totalRev>0?((r.revenue/totalRev)*100).toFixed(0):0}%</span>
                  <span className="text-xs text-gray-600 w-20 text-right">{fmtAna(r.revenue,'full',0)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 10 && (() => {
        const now = new Date();
        const months = Array.from({length:6}, (_,i) => {
          const d = new Date(now.getFullYear(), now.getMonth() - (5-i), 1);
          return { key: `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`, label: `${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getFullYear()).slice(2)}`, year: d.getFullYear(), month: d.getMonth() };
        });
        const custByMonth: Record<string, Set<string>> = {};
        months.forEach(m => { custByMonth[m.key] = new Set(); });
        orders.forEach(o => {
          const d = (o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string);
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          if (custByMonth[key]) custByMonth[key].add(o.customerName);
        });
        const data = months.map((m, i) => {
          const current = custByMonth[m.key];
          const prev = i > 0 ? custByMonth[months[i-1].key] : new Set<string>();
          const newCusts = [...current].filter(c => !prev.has(c)).length;
          const lostCusts = i > 0 ? [...prev].filter(c => !current.has(c)).length : 0;
          return { label: m.label, new: newCusts, lost: lostCusts, net: newCusts - lostCusts };
        });
        const hasData = data.some(d => d.new > 0 || d.lost > 0);
        if (!hasData) return null;
        const maxVal = Math.max(...data.map(d => Math.max(d.new, d.lost)), 1);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? 'Müşteri Kazanç/Kayıp Dengesi' : 'Customer Gain/Loss Balance'}</h3>
            <p className="text-xs text-gray-500 mb-4">New vs churned customers per month (MoM)</p>
            <div className="flex items-center justify-center gap-1 mb-2">
              <span className="w-3 h-3 rounded-sm bg-green-400 inline-block"></span><span className="text-xs text-gray-500 mr-4">New</span>
              <span className="w-3 h-3 rounded-sm bg-red-400 inline-block"></span><span className="text-xs text-gray-500">Lost</span>
            </div>
            <div className="flex items-end justify-around gap-2 h-28">
              {data.map((d,i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                  <div className="w-full flex gap-0.5 items-end justify-center" style={{ height: '80px' }}>
                    <div className="w-1/2 rounded-t bg-green-400" style={{ height: `${maxVal>0?(d.new/maxVal*80):2}px`, minHeight: d.new>0?'4px':'0' }} title={`New: ${d.new}`} />
                    <div className="w-1/2 rounded-t bg-red-400" style={{ height: `${maxVal>0?(d.lost/maxVal*80):2}px`, minHeight: d.lost>0?'4px':'0' }} title={`Lost: ${d.lost}`} />
                  </div>
                  <span className="text-[9px] text-gray-500">{d.label}</span>
                  <span className="text-[9px] font-bold" style={{ color: d.net >= 0 ? '#10b981' : '#ef4444' }}>{d.net >= 0 ? '+' : ''}{d.net}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && quotations.length >= 5 && orders.length >= 5 && (() => {
        const converted = quotations.filter(q => q.status === 'Converted to Order');
        if (converted.length < 3) return null;
        const timings: number[] = [];
        converted.forEach(q => {
          const qDate = (q.createdAt as {toDate?:()=>Date}).toDate?.() ?? (q.createdAt ? new Date(q.createdAt as string) : null);
          if (!qDate) return;
          const matchOrder = orders.find(o => o.leadId === q.leadId || o.customerName === q.customerName);
          if (!matchOrder) return;
          const oDate = (matchOrder.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(matchOrder.createdAt as string);
          const days = Math.floor((oDate.getTime() - qDate.getTime()) / 86400000);
          if (days >= 0 && days <= 365) timings.push(days);
        });
        if (timings.length < 2) return null;
        const avg = timings.reduce((s,t)=>s+t,0)/timings.length;
        const median = [...timings].sort((a,b)=>a-b)[Math.floor(timings.length/2)];
        const under7 = timings.filter(t=>t<=7).length;
        const under30 = timings.filter(t=>t<=30).length;
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-3">{currentLanguage === 'tr' ? 'Tekliften Tahsilata Zaman Çizelgesi' : 'Quote-to-Cash Timeline'}</h3>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div className="bg-blue-50 rounded-xl p-3 text-center">
                <div className="text-2xl font-black text-blue-700">{avg.toFixed(1)}d</div>
                <div className="text-xs text-gray-500">Average Close Time</div>
              </div>
              <div className="bg-green-50 rounded-xl p-3 text-center">
                <div className="text-2xl font-black text-green-700">{median}d</div>
                <div className="text-xs text-gray-500">Median Close Time</div>
              </div>
            </div>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between items-center p-2 bg-gray-50 rounded-lg">
                <span className="text-gray-600">Closed within 7 days</span>
                <span className="font-bold text-green-600">{under7} / {timings.length} ({timings.length>0?((under7/timings.length)*100).toFixed(0):0}%)</span>
              </div>
              <div className="flex justify-between items-center p-2 bg-gray-50 rounded-lg">
                <span className="text-gray-600">Closed within 30 days</span>
                <span className="font-bold text-blue-600">{under30} / {timings.length} ({timings.length>0?((under30/timings.length)*100).toFixed(0):0}%)</span>
              </div>
              <div className="flex justify-between items-center p-2 bg-gray-50 rounded-lg">
                <span className="text-gray-600">Conversion rate</span>
                <span className="font-bold text-purple-600">{quotations.length>0?((converted.length/quotations.length)*100).toFixed(1):0}% ({converted.length}/{quotations.length})</span>
              </div>
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 10 && (() => {
        const custOrders: Record<string, {count: number; revenue: number; first: Date; last: Date}> = {};
        orders.forEach(o => {
          const d = (o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string);
          if (!custOrders[o.customerName]) custOrders[o.customerName] = { count: 0, revenue: 0, first: d, last: d };
          custOrders[o.customerName].count++;
          custOrders[o.customerName].revenue += o.totalPrice;
          if (d < custOrders[o.customerName].first) custOrders[o.customerName].first = d;
          if (d > custOrders[o.customerName].last) custOrders[o.customerName].last = d;
        });
        const now = new Date();
        const custData = Object.entries(custOrders).map(([name, d]) => {
          const tenureDays = (d.last.getTime() - d.first.getTime()) / 86400000;
          const daysSinceLast = (now.getTime() - d.last.getTime()) / 86400000;
          const loyaltyScore = Math.min(100, Math.round(
            (d.count * 15) +
            (Math.min(tenureDays, 365) / 365 * 40) +
            (Math.max(0, 1 - daysSinceLast/90) * 30) +
            (Math.min(d.revenue, 100000) / 100000 * 15)
          ));
          return { name, count: d.count, revenue: d.revenue, loyaltyScore, daysSinceLast: Math.floor(daysSinceLast) };
        }).sort((a,b)=>b.loyaltyScore-a.loyaltyScore).slice(0,8);
        if (custData.length === 0) return null;
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? 'Müşteri Sadakat Endeksi' : 'Customer Loyalty Index'}</h3>
            <p className="text-xs text-gray-500 mb-3">Composite score: order freq, tenure, recency, revenue (0-100)</p>
            <div className="space-y-2">
              {custData.map((c,i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-[10px] font-bold text-gray-400 w-4">{i+1}</span>
                  <span className="text-xs text-gray-700 truncate w-28 font-medium">{c.name}</span>
                  <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${c.loyaltyScore}%`, background: c.loyaltyScore >= 70 ? '#10b981' : c.loyaltyScore >= 40 ? '#f59e0b' : '#ef4444' }} />
                  </div>
                  <span className="text-xs font-black w-8 text-right" style={{ color: c.loyaltyScore >= 70 ? '#10b981' : c.loyaltyScore >= 40 ? '#f59e0b' : '#ef4444' }}>{c.loyaltyScore}</span>
                  <span className="text-xs text-gray-400 w-12 text-right">{c.count} ord</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 15 && (() => {
        const cohortMap: Record<string, {customers: Set<string>; months: Record<string, number>}> = {};
        orders.forEach(o => {
          const d = (o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string);
          const cohortKey = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          if (!cohortMap[cohortKey]) cohortMap[cohortKey] = { customers: new Set(), months: {} };
        });
        // Find each customer's first order month
        const custFirstMonth: Record<string, string> = {};
        [...orders].sort((a,b) => {
          const da = (a.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(a.createdAt as string);
          const db = (b.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(b.createdAt as string);
          return da.getTime()-db.getTime();
        }).forEach(o => {
          const d = (o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string);
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          if (!custFirstMonth[o.customerName]) custFirstMonth[o.customerName] = key;
        });
        orders.forEach(o => {
          const cohort = custFirstMonth[o.customerName];
          if (!cohort || !cohortMap[cohort]) return;
          cohortMap[cohort].customers.add(o.customerName);
        });
        const cohorts = Object.keys(cohortMap).sort().slice(-5);
        if (cohorts.length < 2) return null;
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-3">Cohort Customer Count (Last 5 Cohorts)</h3>
            <div className="space-y-2">
              {cohorts.map((cohort,i) => {
                const cData = cohortMap[cohort];
                const size = cData.customers.size;
                return (
                  <div key={i} className="flex items-center gap-3">
                    <span className="text-xs text-gray-600 w-16 font-medium">{cohort.slice(5)}/{cohort.slice(2,4)}</span>
                    <div className="flex-1 h-6 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full rounded-full bg-violet-500" style={{ width: `${size > 0 ? Math.min(100, size * 10) : 2}%` }} />
                    </div>
                    <span className="text-xs font-bold text-violet-700 w-20 text-right">{size} customers</span>
                  </div>
                );
              })}
            </div>
            <p className="text-xs text-gray-400 mt-3">Cohort = month of customer's first order</p>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 10 && (() => {
        const custFreq: Record<string, {count: number; revenue: number; lastDate: Date}> = {};
        orders.forEach(o => {
          const d = (o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string);
          if (!custFreq[o.customerName]) custFreq[o.customerName] = { count: 0, revenue: 0, lastDate: d };
          custFreq[o.customerName].count++;
          custFreq[o.customerName].revenue += o.totalPrice;
          if (d > custFreq[o.customerName].lastDate) custFreq[o.customerName].lastDate = d;
        });
        const top = Object.entries(custFreq)
          .map(([name, d]) => ({ name, ...d }))
          .sort((a,b)=>b.count-a.count).slice(0,8);
        if (top.length === 0) return null;
        const maxCount = top[0].count;
        const now = new Date();
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-3">{currentLanguage === 'tr' ? 'Sipariş Sıklığına Göre En İyi Müşteriler' : 'Top Customers by Order Frequency'}</h3>
            <div className="space-y-2">
              {top.map((c,i) => {
                const daysSince = Math.floor((now.getTime() - c.lastDate.getTime())/86400000);
                return (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-[10px] font-bold text-gray-400 w-4">{i+1}</span>
                    <span className="text-xs text-gray-700 truncate w-28 font-medium">{c.name}</span>
                    <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full rounded-full bg-rose-500" style={{ width: `${maxCount>0?(c.count/maxCount*100):0}%` }} />
                    </div>
                    <span className="text-xs font-bold text-rose-700 w-12 text-right">{c.count}x</span>
                    <span className="text-xs text-gray-400 w-12 text-right">{daysSince}d ago</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && quotations.length >= 3 && (() => {
        const now = new Date();
        const staleQuotes = quotations.filter(q => {
          if (q.status === 'Converted to Order' || q.status === 'approved') return false;
          const d = (q.createdAt as {toDate?:()=>Date}).toDate?.() ?? (q.createdAt ? new Date(q.createdAt as string) : null);
          if (!d) return false;
          const age = (now.getTime() - d.getTime()) / 86400000;
          return age >= 7;
        }).map(q => {
          const d = (q.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(q.createdAt as string);
          const age = Math.floor((now.getTime() - d.getTime()) / 86400000);
          const value = q.totalAmount || (q.items||q.lineItems||[]).reduce((s, i) => s + i.price * i.quantity, 0);
          return { customer: q.customerName, age, value, status: q.status };
        }).sort((a,b)=>b.value-a.value).slice(0,8);
        if (staleQuotes.length === 0) return null;
        const totalOpportunity = staleQuotes.reduce((s,q)=>s+q.value,0);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? 'Bekleyen Teklif Kurtarma Fırsatları' : 'Stale Quote Recovery Opportunities'}</h3>
            <p className="text-xs text-gray-500 mb-3">Unconverted quotes (7+ days old) — {fmtAna(totalOpportunity,'full',0)} total opportunity</p>
            <div className="space-y-2">
              {staleQuotes.map((q,i) => (
                <div key={i} className="flex items-center justify-between text-xs p-2 rounded-lg" style={{ background: q.age >= 30 ? '#fef2f2' : q.age >= 14 ? '#fffbeb' : '#f8fafc' }}>
                  <span className="font-medium text-gray-800 truncate w-32">{q.customer}</span>
                  <span className="text-gray-400 capitalize">{q.status}</span>
                  <span style={{ color: q.age >= 30 ? '#ef4444' : q.age >= 14 ? '#f59e0b' : '#6b7280' }} className="font-bold">{q.age}d old</span>
                  <span className="font-bold text-gray-800">{fmtAna(q.value,'full',0)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 10 && (() => {
        const custOrders: Record<string, {count: number; recent: boolean}> = {};
        const now = new Date();
        orders.forEach(o => {
          const d = (o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string);
          const isRecent = (now.getTime() - d.getTime()) / 86400000 <= 90;
          if (!custOrders[o.customerName]) custOrders[o.customerName] = { count: 0, recent: false };
          custOrders[o.customerName].count++;
          if (isRecent) custOrders[o.customerName].recent = true;
        });
        const total = Object.keys(custOrders).length;
        if (total < 5) return null;
        const promoters = Object.values(custOrders).filter(c => c.count >= 3 && c.recent).length;
        const detractors = Object.values(custOrders).filter(c => c.count === 1 && !c.recent).length;
        const passives = total - promoters - detractors;
        const npsProxy = Math.round(((promoters - detractors) / total) * 100);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? 'Tahmini NPS Puanı' : 'NPS Proxy Score'}</h3>
            <p className="text-xs text-gray-500 mb-4">Based on repeat purchase behaviour — not survey data</p>
            <div className="flex items-center justify-center mb-4">
              <div className="text-5xl font-black" style={{ color: npsProxy >= 50 ? '#10b981' : npsProxy >= 0 ? '#f59e0b' : '#ef4444' }}>{npsProxy >= 0 ? '+' : ''}{npsProxy}</div>
            </div>
            <div className="grid grid-cols-3 gap-3 text-center text-xs">
              <div className="bg-green-50 rounded-xl p-3">
                <div className="text-lg font-black text-green-700">{promoters}</div>
                <div className="text-gray-500">Promoters</div>
                <div className="text-[10px] text-gray-400">3+ orders, active</div>
              </div>
              <div className="bg-gray-50 rounded-xl p-3">
                <div className="text-lg font-black text-gray-600">{passives}</div>
                <div className="text-gray-500">Passives</div>
                <div className="text-[10px] text-gray-400">occasional buyers</div>
              </div>
              <div className="bg-red-50 rounded-xl p-3">
                <div className="text-lg font-black text-red-600">{detractors}</div>
                <div className="text-gray-500">Detractors</div>
                <div className="text-[10px] text-gray-400">1 order, gone quiet</div>
              </div>
            </div>
          </div>
        );
      })()}
    </>
  );
}
