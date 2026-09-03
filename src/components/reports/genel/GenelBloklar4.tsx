/**
 * GenelBloklar4.tsx — GenelRapor bölmesi (2026-08-31)
 *
 * GenelRapor.tsx'ten mekanik olarak çıkarıldı (bölme öncesi satır 2030–2599).
 * Bloklar ORİJİNAL SIRASIYLA ve içeriği DEĞİŞTİRİLMEDEN taşındı; bloklardaki
 * `reportsTab === 'genel'` koşulları BİLEREK korundu (bkz. GenelRapor.tsx
 * başlık notu — ebeveyn zaten sekmeye göre render ediyor, koşulu silmek
 * "saf kopya" güvencesini bozardı).
 * Props yalnız bu dosyanın gerçekten kullandığı ctx alanlarıdır
 * (tsc "Cannot find name" listesinden çıkarıldı).
 */
import { itemCostTRY, type ReportsCtx } from '../useReportsData';
import { odemeTakipli } from '../../../utils/siparis';

type Props = Pick<ReportsCtx, 'reportsTab' | 'orders' | 'inventory' | 'employees' | 'exchangeRates' | 'currentLanguage' | 'fmtAna'>;

export default function GenelBloklar4({ reportsTab, orders, inventory, employees, exchangeRates, currentLanguage, fmtAna }: Props) {
  return (
    <>
      {reportsTab === 'genel' && orders.length >= 5 && (() => {
        const now = new Date();
        const currMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const mOrders = orders.filter(o => {
          const d = (o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string);
          return d >= currMonth;
        });
        const revenue = mOrders.reduce((s,o)=>s+o.totalPrice,0);
        const cogs = mOrders.reduce((s,o)=>s+(o.lineItems||[]).reduce((sc,li)=>{
          const inv = inventory.find(it=>it.id===li.inventoryId||it.sku===li.sku);
          return sc+(inv?itemCostTRY(inv,exchangeRates):(li.costPrice||0))*li.quantity;
        },0),0);
        const grossProfit = revenue - cogs;
        const payroll = employees.filter(e=>e.status==='Aktif').reduce((s,e)=>s+(e.salary||0),0);
        const operatingExpenses = payroll;
        const ebitda = grossProfit - operatingExpenses;
        const pnlItems = [
          { label: 'Revenue', value: revenue, type: 'revenue' },
          { label: 'Cost of Goods Sold', value: -cogs, type: 'expense' },
          { label: 'Gross Profit', value: grossProfit, type: 'subtotal' },
          { label: 'Payroll & Benefits', value: -operatingExpenses, type: 'expense' },
          { label: 'EBITDA', value: ebitda, type: 'total' },
        ];
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">P&L Summary — Current Month</h3>
            <p className="text-xs text-gray-500 mb-4">Month-to-date · {mOrders.length} orders processed</p>
            <div className="space-y-2">
              {pnlItems.map((item,i) => (
                <div key={i} className={`flex justify-between items-center px-3 py-2 rounded-lg ${item.type==='subtotal'?'bg-blue-50':item.type==='total'?'bg-gray-100 font-black':'bg-gray-50'}`}>
                  <span className={`text-xs ${item.type==='total'?'font-black text-gray-800':'font-medium text-gray-700'}`}>{item.label}</span>
                  <span className={`text-sm font-bold ${item.value>=0?'text-green-600':'text-red-500'}`}>
                    {item.value>=0?'+':''}{fmtAna(Math.abs(item.value),'full',0)}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-3 text-center">
              <span className="text-xs text-gray-400">Gross margin: {revenue>0?((grossProfit/revenue)*100).toFixed(1):0}% · EBITDA margin: {revenue>0?((ebitda/revenue)*100).toFixed(1):0}%</span>
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 10 && (() => {
        const dayRevenue: Record<string, number> = {};
        orders.forEach(o => {
          const d = (o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string);
          const key = d.toISOString().slice(0,10);
          dayRevenue[key] = (dayRevenue[key]||0) + o.totalPrice;
        });
        const topDays = Object.entries(dayRevenue)
          .sort((a,b)=>b[1]-a[1]).slice(0,10);
        if (topDays.length === 0) return null;
        const maxRev = topDays[0][1];
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-3">Top 10 Revenue Days — All Time</h3>
            <div className="space-y-2">
              {topDays.map(([day, rev], i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-[10px] font-black text-gray-400 w-4">#{i+1}</span>
                  <span className="text-xs text-gray-600 w-20">{day}</span>
                  <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${maxRev>0?(rev/maxRev*100):0}%`, background: i===0?'#f59e0b':i<3?'#10b981':'#3b82f6' }} />
                  </div>
                  <span className="text-xs font-bold text-gray-800 w-24 text-right">{fmtAna(rev,'full',0)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 7 && (() => {
        const now = new Date();
        const days = Array.from({length: 28}, (_, i) => {
          const d = new Date(now);
          d.setDate(d.getDate() - (27 - i));
          return d.toISOString().slice(0, 10);
        });
        const dayRev: Record<string, number> = {};
        orders.forEach(o => {
          const d = (o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string);
          const key = d.toISOString().slice(0, 10);
          dayRev[key] = (dayRev[key] || 0) + o.totalPrice;
        });
        const rolling7: number[] = [];
        for (let i = 6; i < days.length; i++) {
          const sum = days.slice(i - 6, i + 1).reduce((s, d) => s + (dayRev[d] || 0), 0);
          rolling7.push(sum / 7);
        }
        const hasData = rolling7.some(v => v > 0);
        if (!hasData) return null;
        const maxVal = Math.max(...rolling7, 1);
        const trend = rolling7.length >= 2 ? rolling7[rolling7.length - 1] - rolling7[0] : 0;
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Rolling 7-Day Avg Revenue — Last 28 Days</h3>
            <p className="text-xs text-gray-500 mb-4">
              Trend: <span className={trend >= 0 ? 'text-green-600 font-bold' : 'text-red-500 font-bold'}>{trend >= 0 ? '↑' : '↓'} {fmtAna(Math.abs(trend),'full',0)}/day avg</span>
            </p>
            <div className="flex items-end gap-0.5 h-20">
              {rolling7.map((v, i) => (
                <div key={i} className="flex-1 rounded-t transition-all" style={{
                  height: `${maxVal > 0 ? Math.max(2, v / maxVal * 72) : 2}px`,
                  background: i === rolling7.length - 1 ? '#f97316' : '#6366f1',
                  opacity: 0.6 + i / rolling7.length * 0.4
                }} title={`₺${v.toLocaleString('tr-TR', {maximumFractionDigits: 0})}`} />
              ))}
            </div>
            <div className="flex justify-between text-[9px] text-gray-400 mt-1">
              <span>28d ago</span><span>Today</span>
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 10 && (() => {
        const parts = [
          {label: 'Morning', subLabel: '6–12', hours: [6,7,8,9,10,11], color: '#f59e0b'},
          {label: 'Afternoon', subLabel: '12–17', hours: [12,13,14,15,16], color: '#3b82f6'},
          {label: 'Evening', subLabel: '17–22', hours: [17,18,19,20,21], color: '#8b5cf6'},
          {label: 'Night', subLabel: '22–6', hours: [22,23,0,1,2,3,4,5], color: '#94a3b8'},
        ];
        const partData = parts.map(p => {
          const partOrders = orders.filter(o => {
            const d = (o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string);
            return p.hours.includes(d.getHours());
          });
          return {
            ...p,
            count: partOrders.length,
            revenue: partOrders.reduce((s, o) => s + o.totalPrice, 0),
            aov: partOrders.length > 0 ? partOrders.reduce((s, o) => s + o.totalPrice, 0) / partOrders.length : 0,
          };
        });
        const hasData = partData.some(p => p.count > 0);
        if (!hasData) return null;
        const maxAov = Math.max(...partData.map(p => p.aov), 1);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-3">{currentLanguage === 'tr' ? 'Saate Göre Ortalama Sepet' : 'AOV by Time of Day'}</h3>
            <div className="grid grid-cols-2 gap-3">
              {partData.map((p, i) => (
                <div key={i} className="rounded-xl p-4" style={{background: `${p.color}15`}}>
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <div className="text-xs font-bold text-gray-700">{p.label}</div>
                      <div className="text-[10px] text-gray-400">{p.subLabel}h</div>
                    </div>
                    <span className="text-[10px] text-gray-400">{p.count} orders</span>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden mb-2">
                    <div className="h-full rounded-full" style={{width: `${maxAov > 0 ? p.aov / maxAov * 100 : 0}%`, background: p.color}} />
                  </div>
                  <div className="text-base font-black" style={{color: p.color}}>
                    {fmtAna(p.aov,'full',0)}
                  </div>
                  <div className="text-[9px] text-gray-400">avg order value</div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 5 && (() => {
        const invoiced = orders.filter(o => o.hasInvoice || o.faturali);
        if (invoiced.length === 0) return null;
        const paid = invoiced.filter(o => o.paid || (o as unknown as Record<string,unknown>).paidAt);
        // Mikro turevi siparisler `faturali: true` tasir ama `paid`/`paidAt` HIC YOK —
  // odeme durumu Cetpa'da izlenmiyor, "odenmedi" demek yaniltici (2026-09-04).
  const unpaid = invoiced.filter(o => !o.paid && !(o as unknown as Record<string,unknown>).paidAt && odemeTakipli(o));
        const paidRev = paid.reduce((s, o) => s + o.totalPrice, 0);
        const unpaidRev = unpaid.reduce((s, o) => s + o.totalPrice, 0);
        const now = new Date();
        const overdue = unpaid.filter(o => {
          const d = (o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string);
          return (now.getTime() - d.getTime()) / 86400000 > 30;
        });
        const overdueRev = overdue.reduce((s, o) => s + o.totalPrice, 0);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-4">{currentLanguage === 'tr' ? 'Fatura Ödeme Durumu' : 'Invoice Payment Status'}</h3>
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="bg-green-50 rounded-xl p-3 text-center">
                <div className="text-xl font-black text-green-600">{paid.length}</div>
                <div className="text-[10px] text-gray-500">Paid</div>
                <div className="text-[9px] text-green-500">{fmtAna(paidRev,'K',0)}</div>
              </div>
              <div className="bg-amber-50 rounded-xl p-3 text-center">
                <div className="text-xl font-black text-amber-600">{unpaid.length}</div>
                <div className="text-[10px] text-gray-500">Awaiting</div>
                <div className="text-[9px] text-amber-500">{fmtAna(unpaidRev,'K',0)}</div>
              </div>
              <div className="bg-red-50 rounded-xl p-3 text-center">
                <div className="text-xl font-black text-red-600">{overdue.length}</div>
                <div className="text-[10px] text-gray-500">Overdue 30d+</div>
                <div className="text-[9px] text-red-500">{fmtAna(overdueRev,'K',0)}</div>
              </div>
            </div>
            <div className="h-3 bg-gray-100 rounded-full overflow-hidden flex gap-0.5">
              {paidRev > 0 && <div className="h-full bg-green-400 rounded-l-full" style={{width: `${(paidRev / (paidRev + unpaidRev)) * 100}%`}} />}
              {overdueRev > 0 && <div className="h-full bg-red-400" style={{width: `${(overdueRev / (paidRev + unpaidRev)) * 100}%`}} />}
              {(unpaidRev - overdueRev) > 0 && <div className="h-full bg-amber-300 rounded-r-full" style={{width: `${((unpaidRev - overdueRev) / (paidRev + unpaidRev)) * 100}%`}} />}
            </div>
            <div className="flex gap-3 mt-2 text-[10px] text-gray-400">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-400 inline-block" />Paid</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400 inline-block" />Overdue</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-300 inline-block" />Awaiting</span>
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 5 && (() => {
        const cityMap: Record<string, {count: number; revenue: number}> = {};
        orders.forEach(o => {
          const city = (o as unknown as Record<string,unknown>).city as string || (o as unknown as Record<string,unknown>).shippingCity as string || '';
          if (!city) return;
          if (!cityMap[city]) cityMap[city] = {count: 0, revenue: 0};
          cityMap[city].count++;
          cityMap[city].revenue += o.totalPrice || 0;
        });
        const cities325 = Object.entries(cityMap).map(([city, d]) => ({city, ...d})).sort((a, b) => b.revenue - a.revenue).slice(0, 8);
        if (cities325.length < 2) return null;
        const maxRev = Math.max(...cities325.map(c => c.revenue), 1);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? 'Sipariş Hacmine Göre En İyi Şehirler' : 'Top Cities by Order Volume'}</h3>
            <p className="text-xs text-gray-500 mb-4">Revenue and order count by shipping destination</p>
            <div className="space-y-2">
              {cities325.map((c, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs font-semibold text-gray-700 w-24 truncate">{c.city}</span>
                  <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full bg-blue-400 transition-all" style={{width: `${(c.revenue / maxRev) * 100}%`}} />
                  </div>
                  <span className="text-[10px] text-gray-400 w-10 text-right">{c.count} ord</span>
                  <span className="text-xs font-bold text-blue-600 w-24 text-right">{fmtAna(c.revenue,'full',0)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 5 && (() => {
        const pmMap: Record<string, {count: number; revenue: number}> = {};
        orders.forEach(o => {
          const pm = (o as unknown as Record<string,unknown>).paymentMethod as string || (o as unknown as Record<string,unknown>).payment_method as string || 'Other';
          if (!pmMap[pm]) pmMap[pm] = {count: 0, revenue: 0};
          pmMap[pm].count++;
          pmMap[pm].revenue += o.totalPrice || 0;
        });
        const methods = Object.entries(pmMap).map(([method, d]) => ({method, ...d})).sort((a, b) => b.revenue - a.revenue);
        if (methods.length < 2) return null;
        const totalRev328 = methods.reduce((s, m) => s + m.revenue, 0);
        const colors328 = ['#6366f1','#3b82f6','#10b981','#f59e0b','#f97316','#ef4444','#8b5cf6'];
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? 'Ödeme Yöntemi Dağılımı' : 'Payment Method Mix'}</h3>
            <p className="text-xs text-gray-500 mb-4">Revenue share by payment type across {orders.length} orders</p>
            <div className="space-y-2">
              {methods.map((m, i) => {
                const pct = totalRev328 > 0 ? (m.revenue / totalRev328) * 100 : 0;
                return (
                  <div key={i} className="flex items-center gap-3">
                    <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{background: colors328[i % colors328.length]}} />
                    <span className="text-xs text-gray-600 flex-1 truncate">{m.method}</span>
                    <div className="w-32 h-3 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full rounded-full" style={{width: `${pct}%`, background: colors328[i % colors328.length]}} />
                    </div>
                    <span className="text-[10px] text-gray-400 w-8 text-right">{pct.toFixed(0)}%</span>
                    <span className="text-xs font-bold w-24 text-right" style={{color: colors328[i % colors328.length]}}>{fmtAna(m.revenue,'full',0)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 6 && (() => {
        const toTs339 = (v: unknown): number => {
          if (!v) return 0;
          if (typeof (v as {toDate?:()=>Date}).toDate === 'function') return (v as {toDate:()=>Date}).toDate().getTime();
          return new Date(v as string|number).getTime();
        };
        const monthGM: Record<string, {rev: number; cost: number}> = {};
        orders.forEach(o => {
          const d = new Date(toTs339(o.createdAt));
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          if (!monthGM[key]) monthGM[key] = {rev: 0, cost: 0};
          monthGM[key].rev += o.totalPrice || 0;
          const lineCost = (o.lineItems || []).reduce((s: number, li: {costPrice?: number; quantity?: number}) => s + (li.costPrice || 0) * (li.quantity || 1), 0);
          monthGM[key].cost += lineCost || (o.totalPrice || 0) * 0.6;
        });
        const keys339 = Object.keys(monthGM).sort().slice(-8);
        if (keys339.length < 3) return null;
        const gmData = keys339.map(k => ({k, gm: monthGM[k].rev > 0 ? ((monthGM[k].rev - monthGM[k].cost) / monthGM[k].rev) * 100 : 0}));
        const avgGM = gmData.reduce((s, d) => s + d.gm, 0) / gmData.length;
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? 'Brüt Kâr Marjı Eğilimi' : 'Gross Margin Trend'}</h3>
            <p className="text-xs text-gray-500 mb-4">Monthly gross margin % · Avg: {avgGM.toFixed(1)}%</p>
            <div className="flex items-end gap-2 h-24">
              {gmData.map((d, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                  <span className="text-[9px] text-gray-500">{d.gm.toFixed(0)}%</span>
                  <div className="w-full rounded-t-lg transition-all" style={{height: `${Math.max(d.gm / 100 * 72, 4)}px`, background: d.gm >= 40 ? '#10b981' : d.gm >= 25 ? '#f59e0b' : '#ef4444'}} />
                  <span className="text-[9px] text-gray-400">{d.k.slice(5)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 10 && (() => {
        const vals341 = orders.map(o => o.totalPrice || 0).filter(v => v > 0).sort((a, b) => a - b);
        if (vals341.length < 5) return null;
        const p = (pct: number) => vals341[Math.floor((pct / 100) * (vals341.length - 1))];
        const bands = [
          {label: 'P10', val: p(10), color: '#94a3b8'},
          {label: 'P25', val: p(25), color: '#6366f1'},
          {label: 'P50', val: p(50), color: '#3b82f6'},
          {label: 'P75', val: p(75), color: '#10b981'},
          {label: 'P90', val: p(90), color: '#f59e0b'},
          {label: 'P99', val: p(99), color: '#ef4444'},
        ];
        const maxB341 = bands[bands.length - 1].val || 1;
        const avg341 = vals341.reduce((s, v) => s + v, 0) / vals341.length;
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? 'Sipariş Tutarı Yüzdelik Dilimleri' : 'Order Value Percentile Bands'}</h3>
            <p className="text-xs text-gray-500 mb-4">{vals341.length} orders · Avg: {fmtAna(avg341,'full',0)}</p>
            <div className="space-y-1.5">
              {bands.map((b, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs font-bold w-8" style={{color: b.color}}>{b.label}</span>
                  <div className="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{width: `${(b.val / maxB341) * 100}%`, background: b.color}} />
                  </div>
                  <span className="text-xs text-gray-600 w-24 text-right">{fmtAna(b.val,'full',0)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 5 && (() => {
        const custRev346: Record<string, number> = {};
        orders.forEach(o => { custRev346[o.customerName || 'Unknown'] = (custRev346[o.customerName || 'Unknown'] || 0) + (o.totalPrice || 0); });
        const totalRev346 = Object.values(custRev346).reduce((s, v) => s + v, 0);
        if (totalRev346 === 0) return null;
        const shares = Object.values(custRev346).map(v => v / totalRev346);
        const hhi = shares.reduce((s, v) => s + v * v, 0);
        const hhiPct = (hhi * 100).toFixed(1);
        const top5Rev = Object.values(custRev346).sort((a, b) => b - a).slice(0, 5).reduce((s, v) => s + v, 0);
        const top5Pct = totalRev346 > 0 ? ((top5Rev / totalRev346) * 100).toFixed(1) : '0';
        const concentration = hhi > 0.25 ? 'High' : hhi > 0.1 ? 'Moderate' : 'Low';
        const concColor = hhi > 0.25 ? '#ef4444' : hhi > 0.1 ? '#f59e0b' : '#10b981';
        const topCustomers = Object.entries(custRev346).map(([c, v]) => ({c, v, pct: (v / totalRev346) * 100})).sort((a, b) => b.v - a.v).slice(0, 5);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? 'Ciro Yoğunlaşması' : 'Revenue Concentration'}</h3>
            <div className="flex items-center gap-4 mb-4">
              <div className="text-center">
                <p className="text-2xl font-black" style={{color: concColor}}>{hhiPct}%</p>
                <p className="text-[10px] text-gray-400">HHI Score</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-black text-blue-600">{top5Pct}%</p>
                <p className="text-[10px] text-gray-400">Top 5 share</p>
              </div>
              <div className="ml-auto text-right">
                <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{background: concColor+'22', color: concColor}}>{concentration} concentration</span>
              </div>
            </div>
            <div className="space-y-1.5">
              {topCustomers.map((c, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-[10px] text-gray-500 w-4">{i+1}</span>
                  <span className="text-xs text-gray-700 flex-1 truncate">{c.c}</span>
                  <div className="w-24 h-2.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full bg-blue-400" style={{width: `${c.pct}%`}} />
                  </div>
                  <span className="text-[10px] font-bold text-blue-600 w-10 text-right">{c.pct.toFixed(1)}%</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 8 && (() => {
        const vals350 = orders.map(o => o.totalPrice || 0).filter(v => v > 0);
        if (vals350.length < 5) return null;
        const buckets350 = [
          {label:'<₺500',   min:0,     max:500,    count:0, color:'#94a3b8'},
          {label:'₺0.5–2K', min:500,   max:2000,   count:0, color:'#6366f1'},
          {label:'₺2–10K',  min:2000,  max:10000,  count:0, color:'#3b82f6'},
          {label:'₺10–50K', min:10000, max:50000,  count:0, color:'#10b981'},
          {label:'₺50K+',   min:50000, max:Infinity, count:0, color:'#f59e0b'},
        ];
        vals350.forEach(v => { const b = buckets350.find(b => v >= b.min && v < b.max); if (b) b.count++; });
        const maxB350 = Math.max(...buckets350.map(b => b.count), 1);
        const modal = buckets350.reduce((a, b) => b.count > a.count ? b : a);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? 'Fatura Tutarı Dağılımı' : 'Invoice Amount Distribution'}</h3>
            <p className="text-xs text-gray-500 mb-4">Most common range: <span className="font-bold text-[#ff4000]">{modal.label}</span> · {vals350.length} invoices</p>
            <div className="flex items-end gap-3 h-20">
              {buckets350.map((b, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-xs font-bold" style={{color: b.color}}>{b.count}</span>
                  <div className="w-full rounded-t-lg transition-all" style={{height: `${Math.max((b.count / maxB350) * 60, 4)}px`, background: b.color}} />
                  <span className="text-[9px] text-gray-500 text-center">{b.label}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 10 && (() => {
        const toTs351 = (v: unknown): number => {
          if (!v) return 0;
          if (typeof (v as {toDate?:()=>Date}).toDate === 'function') return (v as {toDate:()=>Date}).toDate().getTime();
          return new Date(v as string|number).getTime();
        };
        // Build week × day grid for last 8 weeks
        const now351 = Date.now();
        const grid: Record<string, number> = {};
        orders.forEach(o => {
          const ts = toTs351(o.createdAt);
          if (!ts) return;
          const d = new Date(ts);
          const weekAgo = Math.floor((now351 - ts) / (7 * 86400000));
          if (weekAgo > 7) return;
          const key = `${weekAgo}-${d.getDay()}`;
          grid[key] = (grid[key] || 0) + (o.totalPrice || 0);
        });
        const days351 = ['Su','Mo','Tu','We','Th','Fr','Sa'];
        const weeks351 = [0,1,2,3,4,5,6,7];
        const maxCell = Math.max(...Object.values(grid), 1);
        const totalCells = Object.values(grid).filter(v => v > 0).length;
        if (totalCells < 3) return null;
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? 'Haftalık Ciro Isı Haritası' : 'Weekly Revenue Heatmap'}</h3>
            <p className="text-xs text-gray-500 mb-3">Last 8 weeks · darker = more revenue</p>
            <div className="overflow-x-auto">
              <div className="flex gap-1 min-w-[300px]">
                <div className="flex flex-col gap-1 mr-1">
                  {days351.map(d => <span key={d} className="text-[9px] text-gray-400 h-5 flex items-center">{d}</span>)}
                </div>
                {weeks351.map(w => (
                  <div key={w} className="flex flex-col gap-1 flex-1">
                    {days351.map((_, di) => {
                      const val = grid[`${w}-${di}`] || 0;
                      const intensity = maxCell > 0 ? val / maxCell : 0;
                      const bg = intensity === 0 ? '#f3f4f6'
                        : intensity < 0.25 ? '#bbf7d0'
                        : intensity < 0.5  ? '#4ade80'
                        : intensity < 0.75 ? '#16a34a'
                        : '#166534';
                      return <div key={di} className="h-5 rounded-sm" style={{background: bg}} title={val > 0 ? `₺${val.toLocaleString('tr-TR', {maximumFractionDigits:0})}` : ''} />;
                    })}
                  </div>
                ))}
              </div>
              <div className="flex justify-between mt-1 text-[9px] text-gray-400">
                <span>8w ago</span><span>Now</span>
              </div>
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 5 && (() => {
        const catRev: Record<string, number> = {};
        orders.forEach(o => {
          (o.lineItems || []).forEach((li: {category?: string; name?: string; price?: number; unitPrice?: number; quantity?: number}) => {
            const cat = li.category || 'Other';
            catRev[cat] = (catRev[cat] || 0) + (li.price || li.unitPrice || 0) * (li.quantity || 1);
          });
        });
        const cats361 = Object.entries(catRev).map(([cat, rev]) => ({cat, rev})).filter(d => d.rev > 0).sort((a, b) => b.rev - a.rev).slice(0, 7);
        if (cats361.length < 2) return null;
        const totalRev361 = cats361.reduce((s, c) => s + c.rev, 0);
        const maxRev361 = cats361[0].rev;
        const colors361 = ['#6366f1','#3b82f6','#10b981','#f59e0b','#f97316','#ef4444','#8b5cf6'];
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? 'Ürün Kategorisine Göre Ciro' : 'Revenue by Product Category'}</h3>
            <p className="text-xs text-gray-500 mb-4">Line-item revenue share · Total: {fmtAna(totalRev361,'full',0)}</p>
            <div className="space-y-2">
              {cats361.map((c, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs text-gray-600 w-28 truncate">{c.cat}</span>
                  <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{width: `${(c.rev / maxRev361) * 100}%`, background: colors361[i % colors361.length]}} />
                  </div>
                  <span className="text-[10px] text-gray-400 w-8 text-right">{totalRev361 > 0 ? ((c.rev / totalRev361) * 100).toFixed(0) : 0}%</span>
                  <span className="text-xs font-bold w-24 text-right" style={{color: colors361[i % colors361.length]}}>{fmtAna(c.rev,'full',0)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 7 && (() => {
        const toTs365 = (v: unknown): number => {
          if (!v) return 0;
          if (typeof (v as {toDate?:()=>Date}).toDate === 'function') return (v as {toDate:()=>Date}).toDate().getTime();
          return new Date(v as string|number).getTime();
        };
        const daySet = new Set<string>();
        orders.forEach(o => {
          const ts = toTs365(o.createdAt);
          if (!ts) return;
          const d = new Date(ts);
          daySet.add(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`);
        });
        const sortedDays = [...daySet].sort();
        if (sortedDays.length < 3) return null;
        // Current streak
        let streak = 0;
        let checkDate = new Date();
        while (true) {
          const key = `${checkDate.getFullYear()}-${String(checkDate.getMonth()+1).padStart(2,'0')}-${String(checkDate.getDate()).padStart(2,'0')}`;
          if (!daySet.has(key)) break;
          streak++;
          checkDate = new Date(checkDate.getTime() - 86400000);
        }
        // Longest streak
        let maxStreak = 0, cur = 1;
        for (let i = 1; i < sortedDays.length; i++) {
          const diff = (new Date(sortedDays[i]).getTime() - new Date(sortedDays[i-1]).getTime()) / 86400000;
          if (diff === 1) { cur++; maxStreak = Math.max(maxStreak, cur); }
          else cur = 1;
        }
        // Last 30 days presence
        const last30: boolean[] = [];
        for (let i = 29; i >= 0; i--) {
          const d = new Date(Date.now() - i * 86400000);
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
          last30.push(daySet.has(key));
        }
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? 'Ciro Süreklilik Serisi' : 'Revenue Activity Streak'}</h3>
            <div className="flex gap-6 mb-4">
              <div className="text-center"><p className="text-2xl font-black text-[#ff4000]">{streak}</p><p className="text-[10px] text-gray-400">current streak</p></div>
              <div className="text-center"><p className="text-2xl font-black text-indigo-600">{maxStreak}</p><p className="text-[10px] text-gray-400">longest streak</p></div>
              <div className="text-center"><p className="text-2xl font-black text-gray-700">{daySet.size}</p><p className="text-[10px] text-gray-400">active days total</p></div>
            </div>
            <p className="text-[10px] text-gray-400 mb-1">Last 30 days</p>
            <div className="flex gap-0.5 flex-wrap">
              {last30.map((active, i) => (
                <div key={i} className={`w-4 h-4 rounded-sm ${active ? 'bg-[#ff4000]' : 'bg-gray-100'}`} />
              ))}
            </div>
          </div>
        );
      })()}
    </>
  );
}
