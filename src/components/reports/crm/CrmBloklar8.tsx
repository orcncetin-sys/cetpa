/**
 * CrmBloklar8.tsx — CrmRapor bölmesi (2026-09-03)
 *
 * CrmRapor.tsx'ten mekanik olarak çıkarıldı (bölme öncesi satır 1812–2405, 15 blok).
 * Bloklar ORİJİNAL SIRASIYLA ve içeriği DEĞİŞTİRİLMEDEN taşındı; bloklardaki
 * `reportsTab === 'crm'` koşulları BİLEREK korundu (bkz. CrmRapor.tsx başlık
 * notu — ebeveyn zaten sekmeye göre render ediyor, koşulu silmek "saf kopya"
 * güvencesini bozardı).
 * Props yalnız bu dosyanın gerçekten kullandığı ctx alanlarıdır
 * (tsc "Cannot find name" listesinden çıkarıldı).
 */
import type { ReportsCtx } from '../useReportsData';

type Props = Pick<ReportsCtx, 'reportsTab' | 'orders' | 'quotations' | 'currentLanguage' | 'fmtAna'>;

export default function CrmBloklar8({ reportsTab, orders, quotations, currentLanguage, fmtAna }: Props) {
  return (
    <>
      {reportsTab === 'crm' && orders.length >= 10 && (() => {
        const custTotal: Record<string, number> = {};
        orders.forEach(o => { custTotal[o.customerName] = (custTotal[o.customerName]||0) + o.totalPrice; });
        const buckets = [
          { label: '₺0–10k', min: 0, max: 10000, color: '#94a3b8' },
          { label: '₺10k–50k', min: 10000, max: 50000, color: '#3b82f6' },
          { label: '₺50k–200k', min: 50000, max: 200000, color: '#10b981' },
          { label: '₺200k+', min: 200000, max: Infinity, color: '#f59e0b' },
        ];
        const bucketData = buckets.map(b => {
          const custs = Object.entries(custTotal).filter(([,v]) => v >= b.min && v < b.max);
          return { ...b, count: custs.length, revenue: custs.reduce((s,[,v])=>s+v,0) };
        });
        const totalRev = bucketData.reduce((s,b)=>s+b.revenue,0);
        const totalCusts = bucketData.reduce((s,b)=>s+b.count,0);
        if (totalCusts === 0) return null;
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-3">{currentLanguage === 'tr' ? 'Müşteri Harcama Aralığı Segmentasyonu' : 'Customer Spend Bucket Segmentation'}</h3>
            <div className="space-y-3">
              {bucketData.map((b,i) => (
                <div key={i}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="font-medium text-gray-700">{b.label}</span>
                    <span className="text-gray-500">{b.count} customers · {totalRev>0?((b.revenue/totalRev)*100).toFixed(0):0}% revenue</span>
                  </div>
                  <div className="grid grid-cols-2 gap-1">
                    <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${totalCusts>0?(b.count/totalCusts*100):0}%`, background: b.color }} title="Customer %" />
                    </div>
                    <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full rounded-full opacity-70" style={{ width: `${totalRev>0?(b.revenue/totalRev*100):0}%`, background: b.color }} title="Revenue %" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex gap-4 mt-2 text-[10px] text-gray-400">
              <span>Left bar = customer share</span><span>Right bar = revenue share</span>
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 5 && quotations.length >= 3 && (() => {
        const now = new Date();
        const responseGroups = [
          { label: 'Same day', days: 0, count: 0, color: '#10b981' },
          { label: '1-3 days', days: 3, count: 0, color: '#3b82f6' },
          { label: '4-7 days', days: 7, count: 0, color: '#f59e0b' },
          { label: '8-14 days', days: 14, count: 0, color: '#f97316' },
          { label: '15+ days', days: 999, count: 0, color: '#ef4444' },
        ];
        quotations.forEach(q => {
          const d = (q.createdAt as {toDate?:()=>Date}).toDate?.() ?? (q.createdAt ? new Date(q.createdAt as string) : null);
          if (!d) return;
          const age = (now.getTime() - d.getTime()) / 86400000;
          if (age <= 1) responseGroups[0].count++;
          else if (age <= 3) responseGroups[1].count++;
          else if (age <= 7) responseGroups[2].count++;
          else if (age <= 14) responseGroups[3].count++;
          else responseGroups[4].count++;
        });
        const total = quotations.length;
        if (total === 0) return null;
        const maxCount = Math.max(...responseGroups.map(g=>g.count));
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? 'Teklif Yaşı Dağılımı' : 'Quotation Age Distribution'}</h3>
            <p className="text-xs text-gray-500 mb-4">{total} quotations — age from creation date</p>
            <div className="space-y-2">
              {responseGroups.map((g,i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs text-gray-600 w-20">{g.label}</span>
                  <div className="flex-1 h-5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${maxCount>0?(g.count/maxCount*100):0}%`, background: g.color }} />
                  </div>
                  <span className="text-xs font-bold w-6 text-right" style={{ color: g.color }}>{g.count}</span>
                  <span className="text-xs text-gray-400 w-10 text-right">{total>0?((g.count/total)*100).toFixed(0):0}%</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 10 && (() => {
        const repMonthly: Record<string, Record<string, number>> = {};
        const now = new Date();
        const months = Array.from({length: 6}, (_, i) => {
          const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
          return {key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getFullYear()).slice(2)}`, year: d.getFullYear(), month: d.getMonth()};
        });
        orders.forEach(o => {
          const rep = (o.assignedTo as string) || 'Unassigned';
          const d = (o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string);
          const mkey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
          if (!repMonthly[rep]) repMonthly[rep] = {};
          repMonthly[rep][mkey] = (repMonthly[rep][mkey] || 0) + o.totalPrice;
        });
        const reps = Object.entries(repMonthly)
          .map(([rep, mdata]) => ({rep, total: Object.values(mdata).reduce((s, v) => s + v, 0), months: mdata}))
          .sort((a, b) => b.total - a.total).slice(0, 5);
        if (reps.length === 0) return null;
        const allVals = reps.flatMap(r => months.map(m => r.months[m.key] || 0));
        const maxVal = Math.max(...allVals, 1);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-3">Sales Rep Activity Heatmap — 6 Months</h3>
            <div className="overflow-x-auto">
              <table className="min-w-[560px] w-full text-xs">
                <thead>
                  <tr className="text-gray-400">
                    <th className="text-left pb-2 w-24">Rep</th>
                    {months.map(m => <th key={m.key} className="text-center pb-2 w-10">{m.label}</th>)}
                    <th className="text-right pb-2">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {reps.map((r, i) => (
                    <tr key={i}>
                      <td className="py-1 text-gray-700 font-medium truncate max-w-[6rem]">{r.rep}</td>
                      {months.map(m => {
                        const v = r.months[m.key] || 0;
                        const intensity = maxVal > 0 ? v / maxVal : 0;
                        return (
                          <td key={m.key} className="py-1 px-0.5">
                            <div className="rounded h-6 flex items-center justify-center text-[8px] font-bold" style={{
                              background: v === 0 ? '#f3f4f6' : `rgba(99,102,241,${0.15 + intensity * 0.85})`,
                              color: intensity > 0.5 ? 'white' : '#4b5563'
                            }} title={`₺${v.toLocaleString('tr-TR', {maximumFractionDigits: 0})}`}>
                              {v > 0 ? `${(v / 1000).toFixed(0)}k` : '-'}
                            </div>
                          </td>
                        );
                      })}
                      <td className="py-1 text-right font-bold text-gray-800">{fmtAna(r.total,'K',0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 10 && (() => {
        const custDates: Record<string, Date[]> = {};
        orders.forEach(o => {
          const d = (o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string);
          if (!custDates[o.customerName]) custDates[o.customerName] = [];
          custDates[o.customerName].push(d);
        });
        const gaps: number[] = [];
        Object.values(custDates).forEach(dates => {
          const sorted = dates.sort((a, b) => a.getTime() - b.getTime());
          for (let i = 1; i < sorted.length; i++) {
            const gap = Math.floor((sorted[i].getTime() - sorted[i - 1].getTime()) / 86400000);
            if (gap > 0 && gap <= 365) gaps.push(gap);
          }
        });
        if (gaps.length < 3) return null;
        const avg = gaps.reduce((s, g) => s + g, 0) / gaps.length;
        const buckets = [
          {label: '≤7d', max: 7, color: '#10b981'},
          {label: '8–14d', max: 14, color: '#3b82f6'},
          {label: '15–30d', max: 30, color: '#f59e0b'},
          {label: '31–90d', max: 90, color: '#f97316'},
          {label: '91d+', max: 999, color: '#ef4444'},
        ];
        const bucketCounts = buckets.map((b, i) => ({
          ...b,
          count: gaps.filter(g => g <= b.max && (i === 0 || g > buckets[i - 1].max)).length,
        }));
        const maxCount = Math.max(...bucketCounts.map(b => b.count), 1);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? 'Tekrar Sipariş Aralığı Dağılımı' : 'Customer Re-Order Gap Distribution'}</h3>
            <p className="text-xs text-gray-500 mb-4">Days between consecutive orders per customer · avg: {avg.toFixed(0)} days</p>
            <div className="flex items-end gap-3 h-20">
              {bucketCounts.map((b, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-[9px] text-gray-600 font-bold">{b.count}</span>
                  <div className="w-full rounded-t" style={{height: `${maxCount > 0 ? Math.max(4, b.count / maxCount * 60) : 4}px`, background: b.color}} />
                  <span className="text-[9px] text-gray-400">{b.label}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && quotations.length >= 3 && (() => {
        const total322 = quotations.length;
        const sent322 = quotations.filter(q => ['sent','accepted','rejected','converted'].includes((q.status||'').toLowerCase())).length;
        const accepted322 = quotations.filter(q => ['accepted','converted'].includes((q.status||'').toLowerCase())).length;
        const converted322 = quotations.filter(q => (q.status||'').toLowerCase() === 'converted').length;
        const stages = [
          { label: 'Created', count: total322, color: '#6366f1' },
          { label: 'Sent',    count: sent322,  color: '#3b82f6' },
          { label: 'Accepted',count: accepted322, color: '#10b981' },
          { label: 'Converted',count: converted322, color: '#f59e0b' },
        ];
        const convRate = total322 > 0 ? ((converted322 / total322) * 100).toFixed(1) : '0';
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? 'Teklif Dönüşüm Hunisi' : 'Quotation Conversion Funnel'}</h3>
            <p className="text-xs text-gray-500 mb-4">End-to-end pipeline from quote creation to order · Overall conversion: {convRate}%</p>
            <div className="flex items-end gap-2 h-28">
              {stages.map((s, i) => {
                const h = total322 > 0 ? Math.max((s.count / total322) * 100, 4) : 4;
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1">
                    <span className="text-xs font-bold" style={{color: s.color}}>{s.count}</span>
                    <div className="w-full rounded-t-lg transition-all" style={{height: `${h}%`, background: s.color}} />
                    <span className="text-[10px] text-gray-500 text-center">{s.label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 5 && (() => {
        const ltvMap: Record<string, number> = {};
        orders.forEach(o => {
          const cust = o.customerName || 'Unknown';
          ltvMap[cust] = (ltvMap[cust] || 0) + (o.totalPrice || 0);
        });
        const ltvValues = Object.values(ltvMap);
        if (ltvValues.length < 3) return null;
        const buckets = [
          {label: '< ₺10K',   min: 0,      max: 10000,   color: '#94a3b8', count: 0, total: 0},
          {label: '₺10–50K',  min: 10000,  max: 50000,   color: '#6366f1', count: 0, total: 0},
          {label: '₺50–200K', min: 50000,  max: 200000,  color: '#3b82f6', count: 0, total: 0},
          {label: '₺200K+',   min: 200000, max: Infinity, color: '#10b981', count: 0, total: 0},
        ];
        ltvValues.forEach(v => {
          const b = buckets.find(b => v >= b.min && v < b.max);
          if (b) { b.count++; b.total += v; }
        });
        const maxCount = Math.max(...buckets.map(b => b.count), 1);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? 'Müşteri Yaşam Boyu Değer Dağılımı' : 'Customer LTV Distribution'}</h3>
            <p className="text-xs text-gray-500 mb-4">Lifetime value buckets across {ltvValues.length} customers</p>
            <div className="flex items-end gap-3 h-24">
              {buckets.map((b, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-xs font-bold" style={{color: b.color}}>{b.count}</span>
                  <div className="w-full rounded-t-lg" style={{height: `${Math.max((b.count / maxCount) * 72, 4)}px`, background: b.color}} />
                  <span className="text-[9px] text-gray-500 text-center">{b.label}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 8 && (() => {
        const toTs331 = (v: unknown): number => {
          if (!v) return 0;
          if (typeof (v as {toDate?:()=>Date}).toDate === 'function') return (v as {toDate:()=>Date}).toDate().getTime();
          return new Date(v as string|number).getTime();
        };
        const seenBefore: Record<string, string> = {};
        const monthData: Record<string, {newC: number; ret: number}> = {};
        [...orders].sort((a, b) => toTs331(a.createdAt) - toTs331(b.createdAt)).forEach(o => {
          const d = new Date(toTs331(o.createdAt));
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          if (!monthData[key]) monthData[key] = {newC: 0, ret: 0};
          const cust = o.customerName || 'Unknown';
          if (seenBefore[cust]) monthData[key].ret++;
          else { monthData[key].newC++; seenBefore[cust] = key; }
        });
        const keys331 = Object.keys(monthData).sort().slice(-6);
        if (keys331.length < 2) return null;
        const maxVal = Math.max(...keys331.map(k => monthData[k].newC + monthData[k].ret), 1);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? 'Yeni ve Geri Dönen Müşteriler' : 'New vs Returning Customers'}</h3>
            <p className="text-xs text-gray-500 mb-4">Monthly breakdown — stacked bars by customer type</p>
            <div className="flex items-end gap-2 h-28 mb-2">
              {keys331.map(k => {
                const {newC, ret} = monthData[k];
                const total = newC + ret;
                const newH = maxVal > 0 ? (newC / maxVal) * 96 : 0;
                const retH = maxVal > 0 ? (ret / maxVal) * 96 : 0;
                return (
                  <div key={k} className="flex-1 flex flex-col items-center gap-0">
                    <span className="text-[9px] text-gray-500 mb-0.5">{total}</span>
                    <div className="w-full flex flex-col justify-end rounded-t overflow-hidden" style={{height: '80px'}}>
                      <div style={{height: `${retH}px`, background: '#6366f1'}} />
                      <div style={{height: `${newH}px`, background: '#10b981'}} />
                    </div>
                    <span className="text-[9px] text-gray-400 mt-0.5">{k.slice(5)}</span>
                  </div>
                );
              })}
            </div>
            <div className="flex gap-4">
              {[{color:'#10b981', label:'New'},{color:'#6366f1', label:'Returning'}].map((s,i)=>(
                <div key={i} className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-sm" style={{background:s.color}}/><span className="text-[10px] text-gray-500">{s.label}</span></div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 5 && (() => {
        const repMap: Record<string, {orders: number; revenue: number}> = {};
        orders.forEach(o => {
          const rep = (o as unknown as Record<string,unknown>).salesRep as string || (o as unknown as Record<string,unknown>).assignedTo as string || '';
          if (!rep) return;
          if (!repMap[rep]) repMap[rep] = {orders: 0, revenue: 0};
          repMap[rep].orders++;
          repMap[rep].revenue += o.totalPrice || 0;
        });
        const reps333 = Object.entries(repMap).map(([rep, d]) => ({rep, ...d})).sort((a, b) => b.revenue - a.revenue).slice(0, 6);
        if (reps333.length < 2) return null;
        const maxRev333 = Math.max(...reps333.map(r => r.revenue), 1);
        const colors333 = ['#f59e0b','#6366f1','#3b82f6','#10b981','#f97316','#8b5cf6'];
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? 'En İyi Satış Temsilcileri' : 'Top Sales Representatives'}</h3>
            <p className="text-xs text-gray-500 mb-4">Revenue and order count by assigned sales rep</p>
            <div className="space-y-2">
              {reps333.map((r, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs text-gray-600 w-28 truncate">{r.rep}</span>
                  <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{width: `${(r.revenue / maxRev333) * 100}%`, background: colors333[i % colors333.length]}} />
                  </div>
                  <span className="text-[10px] text-gray-400 w-10 text-right">{r.orders} ord</span>
                  <span className="text-xs font-bold w-24 text-right" style={{color: colors333[i % colors333.length]}}>{fmtAna(r.revenue,'full',0)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 5 && (() => {
        const buckets336 = [
          {label: 'Micro\n<₺1K',   min: 0,    max: 1000,   color: '#94a3b8'},
          {label: 'Small\n₺1–5K',  min: 1000,  max: 5000,   color: '#6366f1'},
          {label: 'Mid\n₺5–20K',   min: 5000,  max: 20000,  color: '#3b82f6'},
          {label: 'Large\n₺20K+',  min: 20000, max: Infinity, color: '#10b981'},
        ];
        buckets336.forEach(b => { (b as unknown as Record<string,unknown>).count = 0; (b as unknown as Record<string,unknown>).rev = 0; });
        const bData = buckets336.map(b => ({...b, count: 0, rev: 0}));
        orders.forEach(o => {
          const v = o.totalPrice || 0;
          const b = bData.find(b => v >= b.min && v < b.max);
          if (b) { b.count++; b.rev += v; }
        });
        const maxCount336 = Math.max(...bData.map(b => b.count), 1);
        const totalRev336 = bData.reduce((s, b) => s + b.rev, 0);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? 'Sipariş Büyüklüğü Dağılımı' : 'Order Size Distribution'}</h3>
            <p className="text-xs text-gray-500 mb-4">Revenue share by order value tier · {orders.length} orders total</p>
            <div className="flex items-end gap-3 h-24 mb-2">
              {bData.map((b, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-xs font-bold" style={{color: b.color}}>{b.count}</span>
                  <div className="w-full rounded-t-lg transition-all" style={{height: `${Math.max((b.count / maxCount336) * 72, 4)}px`, background: b.color}} />
                  <span className="text-[9px] text-gray-500 text-center whitespace-pre-line leading-tight">{b.label}</span>
                </div>
              ))}
            </div>
            <div className="flex gap-2 flex-wrap mt-1">
              {bData.map((b, i) => (
                <span key={i} className="text-[10px] text-gray-400">{b.label.split('\n')[0]}: {totalRev336 > 0 ? ((b.rev / totalRev336) * 100).toFixed(0) : 0}% rev</span>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && quotations.length >= 3 && (() => {
        const statusCount340: Record<string, {count: number; value: number}> = {};
        quotations.forEach(q => {
          const s = (q.status || 'draft');
          if (!statusCount340[s]) statusCount340[s] = {count: 0, value: 0};
          statusCount340[s].count++;
          statusCount340[s].value += (q as unknown as Record<string,unknown>).totalPrice as number || (q as unknown as Record<string,unknown>).total as number || 0;
        });
        const colors340: Record<string, string> = {draft:'#94a3b8',sent:'#6366f1',accepted:'#10b981',rejected:'#ef4444',converted:'#f59e0b',expired:'#f97316'};
        const stages340 = Object.entries(statusCount340).map(([s, d]) => ({label: s, ...d})).sort((a, b) => b.count - a.count);
        if (stages340.length < 2) return null;
        const maxCount340 = Math.max(...stages340.map(s => s.count), 1);
        const acceptedRev = (statusCount340['accepted']?.value || 0) + (statusCount340['converted']?.value || 0);
        const totalRev340 = Object.values(statusCount340).reduce((s, d) => s + d.value, 0);
        const convPct = totalRev340 > 0 ? ((acceptedRev / totalRev340) * 100).toFixed(1) : '0';
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? 'Teklif Durumu Dağılımı' : 'Quotation Status Breakdown'}</h3>
            <p className="text-xs text-gray-500 mb-4">{quotations.length} quotes · Accepted/Converted revenue: {convPct}% of pipeline</p>
            <div className="space-y-2">
              {stages340.map((s, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs text-gray-600 w-20 capitalize">{s.label}</span>
                  <div className="flex-1 h-5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{width: `${(s.count / maxCount340) * 100}%`, background: colors340[s.label] || '#94a3b8'}} />
                  </div>
                  <span className="text-xs font-bold w-8 text-right" style={{color: colors340[s.label] || '#94a3b8'}}>{s.count}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && quotations.length >= 5 && (() => {
        const custQMap: Record<string, {won: number; lost: number; total: number}> = {};
        quotations.forEach(q => {
          const c = q.customerName || 'Unknown';
          if (!custQMap[c]) custQMap[c] = {won: 0, lost: 0, total: 0};
          custQMap[c].total++;
          if (['accepted','converted'].includes((q.status||'').toLowerCase())) custQMap[c].won++;
          if ((q.status||'').toLowerCase() === 'rejected') custQMap[c].lost++;
        });
        const custQ343 = Object.entries(custQMap).map(([c, d]) => ({customer: c, ...d, winRate: d.total > 0 ? (d.won / d.total) * 100 : 0})).filter(d => d.total >= 2).sort((a, b) => b.total - a.total).slice(0, 6);
        if (custQ343.length < 2) return null;
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? 'Müşteriye Göre Teklif Kazanma Oranı' : 'Quote Win Rate by Customer'}</h3>
            <p className="text-xs text-gray-500 mb-4">Accepted ÷ total quotes per customer</p>
            <div className="space-y-2">
              {custQ343.map((c, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs text-gray-600 w-28 truncate">{c.customer}</span>
                  <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden relative">
                    <div className="h-full rounded-full" style={{width: `${c.winRate}%`, background: c.winRate >= 60 ? '#10b981' : c.winRate >= 30 ? '#f59e0b' : '#ef4444'}} />
                  </div>
                  <span className="text-[10px] text-gray-400 w-10 text-right">{c.total} qt</span>
                  <span className="text-xs font-bold w-10 text-right" style={{color: c.winRate >= 60 ? '#10b981' : c.winRate >= 30 ? '#f59e0b' : '#ef4444'}}>{c.winRate.toFixed(0)}%</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 8 && (() => {
        const toTs353 = (v: unknown): number => {
          if (!v) return 0;
          if (typeof (v as {toDate?:()=>Date}).toDate === 'function') return (v as {toDate:()=>Date}).toDate().getTime();
          return new Date(v as string|number).getTime();
        };
        const custOrders: Record<string, number[]> = {};
        orders.forEach(o => {
          const c = o.customerName || 'Unknown';
          const ts = toTs353(o.createdAt);
          if (!ts) return;
          if (!custOrders[c]) custOrders[c] = [];
          custOrders[c].push(ts);
        });
        const gaps = Object.entries(custOrders)
          .filter(([, ts]) => ts.length >= 2)
          .map(([customer, timestamps]) => {
            const sorted = [...timestamps].sort((a, b) => a - b);
            const avgGap = sorted.slice(1).reduce((s, t, i) => s + (t - sorted[i]) / 86400000, 0) / (sorted.length - 1);
            return { customer, avgGap: Math.round(avgGap), orders: sorted.length };
          })
          .sort((a, b) => b.orders - a.orders)
          .slice(0, 7);
        if (gaps.length < 2) return null;
        const maxGap = Math.max(...gaps.map(g => g.avgGap), 1);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? 'Siparişler Arası Ortalama Gün' : 'Avg Days Between Orders'}</h3>
            <p className="text-xs text-gray-500 mb-4">Repeat customer purchase cadence — shorter gap = higher loyalty</p>
            <div className="space-y-2">
              {gaps.map((g, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs text-gray-600 w-28 truncate">{g.customer}</span>
                  <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{width: `${(g.avgGap / maxGap) * 100}%`, background: g.avgGap <= 14 ? '#10b981' : g.avgGap <= 45 ? '#f59e0b' : '#ef4444'}} />
                  </div>
                  <span className="text-[10px] text-gray-400 w-10 text-right">{g.orders}×</span>
                  <span className="text-xs font-bold w-14 text-right" style={{color: g.avgGap <= 14 ? '#10b981' : g.avgGap <= 45 ? '#f59e0b' : '#ef4444'}}>{g.avgGap}d</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && quotations.length >= 3 && (() => {
        const pipeline: Record<string, number> = {};
        quotations.forEach(q => {
          const s = (q.status || 'draft').toLowerCase();
          const val = (q as unknown as Record<string,unknown>).totalPrice as number || (q as unknown as Record<string,unknown>).total as number || 0;
          pipeline[s] = (pipeline[s] || 0) + val;
        });
        const statusOrder = ['draft','sent','accepted','converted','rejected'];
        const pipelineData = statusOrder.map(s => ({status: s, value: pipeline[s] || 0})).filter(d => d.value > 0);
        if (pipelineData.length < 2) return null;
        const totalPipeline = pipelineData.reduce((s, d) => s + d.value, 0);
        const colors357: Record<string, string> = {draft:'#94a3b8',sent:'#6366f1',accepted:'#10b981',converted:'#f59e0b',rejected:'#ef4444'};
        const maxVal357 = Math.max(...pipelineData.map(d => d.value), 1);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? 'Teklif Tutarı Hattı' : 'Quote Value Pipeline'}</h3>
            <p className="text-xs text-gray-500 mb-4">Total pipeline: {fmtAna(totalPipeline,'full',0)}</p>
            <div className="space-y-2">
              {pipelineData.map((d, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs text-gray-600 w-20 capitalize">{d.status}</span>
                  <div className="flex-1 h-5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{width: `${(d.value / maxVal357) * 100}%`, background: colors357[d.status] || '#94a3b8'}} />
                  </div>
                  <span className="text-[10px] text-gray-400 w-10 text-right">{totalPipeline > 0 ? ((d.value / totalPipeline) * 100).toFixed(0) : 0}%</span>
                  <span className="text-xs font-bold w-24 text-right" style={{color: colors357[d.status] || '#94a3b8'}}>{fmtAna(d.value,'full',0)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 8 && (() => {
        const custCount: Record<string, number> = {};
        orders.forEach(o => { const c = o.customerName || 'Unknown'; custCount[c] = (custCount[c] || 0) + 1; });
        const counts = Object.values(custCount);
        if (counts.length < 3) return null;
        const buckets359 = [
          {label: '1 order',  min: 1, max: 1,   count: 0, color: '#94a3b8'},
          {label: '2–3',      min: 2, max: 3,   count: 0, color: '#6366f1'},
          {label: '4–6',      min: 4, max: 6,   count: 0, color: '#3b82f6'},
          {label: '7–10',     min: 7, max: 10,  count: 0, color: '#10b981'},
          {label: '11+',      min: 11, max: 999, count: 0, color: '#f59e0b'},
        ];
        counts.forEach(c => { const b = buckets359.find(b => c >= b.min && c <= b.max); if (b) b.count++; });
        const maxB359 = Math.max(...buckets359.map(b => b.count), 1);
        const totalCusts = counts.length;
        const repeatPct = ((counts.filter(c => c > 1).length / totalCusts) * 100).toFixed(0);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? 'Müşteri Başına Sipariş' : 'Orders per Customer'}</h3>
            <p className="text-xs text-gray-500 mb-4">{totalCusts} unique customers · <span className="font-bold text-[#ff4000]">{repeatPct}%</span> repeat buyers</p>
            <div className="flex items-end gap-3 h-20">
              {buckets359.map((b, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-xs font-bold" style={{color: b.color}}>{b.count}</span>
                  <div className="w-full rounded-t-lg" style={{height: `${Math.max((b.count / maxB359) * 60, 4)}px`, background: b.color}} />
                  <span className="text-[9px] text-gray-500 text-center">{b.label}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && quotations.length >= 4 && (() => {
        const toTs362 = (v: unknown): number => {
          if (!v) return 0;
          if (typeof (v as {toDate?:()=>Date}).toDate === 'function') return (v as {toDate:()=>Date}).toDate().getTime();
          return new Date(v as string|number).getTime();
        };
        const monthQV: Record<string, {total: number; count: number}> = {};
        quotations.forEach(q => {
          const ts = toTs362((q as unknown as Record<string,unknown>).createdAt);
          if (!ts) return;
          const d = new Date(ts);
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          const val = (q as unknown as Record<string,unknown>).totalPrice as number || (q as unknown as Record<string,unknown>).total as number || 0;
          if (!monthQV[key]) monthQV[key] = {total: 0, count: 0};
          monthQV[key].total += val;
          monthQV[key].count++;
        });
        const keys362 = Object.keys(monthQV).sort().slice(-7);
        if (keys362.length < 2) return null;
        const avgData = keys362.map(k => ({k, avg: monthQV[k].count > 0 ? monthQV[k].total / monthQV[k].count : 0, count: monthQV[k].count}));
        const maxAvg362 = Math.max(...avgData.map(d => d.avg), 1);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? 'Zaman İçinde Ortalama Teklif Tutarı' : 'Avg Quote Value Over Time'}</h3>
            <p className="text-xs text-gray-500 mb-4">Monthly average quotation value trend</p>
            <div className="flex items-end gap-2 h-24">
              {avgData.map((d, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                  <span className="text-[9px] text-gray-500">{d.count}</span>
                  <div className="w-full rounded-t-lg bg-violet-400 transition-all" style={{height: `${Math.max((d.avg / maxAvg362) * 72, 4)}px`}} />
                  <span className="text-[9px] text-gray-400">{d.k.slice(5)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}
    </>
  );
}
