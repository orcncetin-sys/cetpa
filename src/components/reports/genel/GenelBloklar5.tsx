/**
 * GenelBloklar5.tsx — GenelRapor bölmesi (2026-08-31)
 *
 * GenelRapor.tsx'ten mekanik olarak çıkarıldı (bölme öncesi satır 2600–3199).
 * Bloklar ORİJİNAL SIRASIYLA ve içeriği DEĞİŞTİRİLMEDEN taşındı; bloklardaki
 * `reportsTab === 'genel'` koşulları BİLEREK korundu (bkz. GenelRapor.tsx
 * başlık notu — ebeveyn zaten sekmeye göre render ediyor, koşulu silmek
 * "saf kopya" güvencesini bozardı).
 * Props yalnız bu dosyanın gerçekten kullandığı ctx alanlarıdır
 * (tsc "Cannot find name" listesinden çıkarıldı).
 */
import { type ReportsCtx } from '../useReportsData';

type Props = Pick<ReportsCtx, 'reportsTab' | 'orders' | 'inventory' | 'currentLanguage' | 'fmtAna'>;

export default function GenelBloklar5({ reportsTab, orders, inventory, currentLanguage, fmtAna }: Props) {
  return (
    <>
      {reportsTab === 'genel' && orders.length >= 10 && (() => {
        const toTs371 = (v: unknown): number => {
          if (!v) return 0;
          if (typeof (v as {toDate?:()=>Date}).toDate === 'function') return (v as {toDate:()=>Date}).toDate().getTime();
          return new Date(v as string|number).getTime();
        };
        const now371 = Date.now();
        // IPTAL EDILEN SIPARIS CIROYA GIRMEZ (2026-09-04 denetimi): eskiden
        // filtrede status kontrolu yoktu ve iptaller tahmini yukari cekiyordu.
        const gecerli371 = orders.filter(o => o.status !== 'Cancelled');
        const last90 = gecerli371.filter(o => toTs371(o.createdAt) > now371 - 90 * 86400000);
        if (last90.length < 5) return null;
        const dailyAvg = last90.reduce((s, o) => s + (o.totalPrice || 0), 0) / 90;
        const last30Rev = gecerli371.filter(o => toTs371(o.createdAt) > now371 - 30 * 86400000).reduce((s, o) => s + (o.totalPrice || 0), 0);
        const last60to30Rev = gecerli371.filter(o => { const ts = toTs371(o.createdAt); return ts > now371 - 60 * 86400000 && ts <= now371 - 30 * 86400000; }).reduce((s, o) => s + (o.totalPrice || 0), 0);
        const momGrowth = last60to30Rev > 0 ? (last30Rev - last60to30Rev) / last60to30Rev : 0;
        const buyumeKatsayisi = 0.5;   // buyume trendinin tahmine yansitilan orani
        const forecast = dailyAvg * 30 * (1 + momGrowth * buyumeKatsayisi);
        // "confidence" KALDIRILDI: siparis SAYISINDAN turetilen (70 + n*0.5) bir
        // yuzde istatistiksel guven araligi DEGILDIR — kullaniciya kesinlik
        // uyduruyordu. Yerine tahminin neye dayandigi (kac siparis) yaziliyor.
        const bars = Array.from({length: 6}, (_, i) => ({
          label: `+${(i+1)*5}d`,
          // Grafik ile bastaki rakam AYNI katsayiyi kullanir; eskiden 0.3 vs 0.5 idi
          // ve cubuklarin toplami baslikta yazan tahmini tutmuyordu.
          value: dailyAvg * (i + 1) * 5 * (1 + momGrowth * buyumeKatsayisi),
        }));
        const maxBar = Math.max(...bars.map(b => b.value), 1);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">30-Day Revenue Forecast</h3>
            <div className="flex gap-6 mb-4">
              <div><p className="text-2xl font-black text-[#ff4000]">{fmtAna(forecast,'full',0)}</p><p className="text-[10px] text-gray-400">projected</p></div>
              <div><p className="text-2xl font-black text-gray-700">{last90.length}</p><p className="text-[10px] text-gray-400">{currentLanguage === 'tr' ? 'son 90 günde sipariş (dayanak)' : 'orders in last 90d (basis)'}</p></div>
              <div><p className="text-2xl font-black" style={{color: momGrowth >= 0 ? '#10b981' : '#ef4444'}}>{momGrowth >= 0 ? '+' : ''}{(momGrowth * 100).toFixed(1)}%</p><p className="text-[10px] text-gray-400">MoM trend</p></div>
            </div>
            <div className="flex items-end gap-2 h-16">
              {bars.map((b, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                  <div className="w-full rounded-t-lg" style={{height: `${Math.max((b.value / maxBar) * 48, 4)}px`, background: `rgba(255,64,0,${0.3 + i * 0.12})`}} />
                  <span className="text-[9px] text-gray-400">{b.label}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 5 && (() => {
        const toTs380 = (v: unknown): number => {
          if (!v) return 0;
          if (typeof (v as {toDate?:()=>Date}).toDate === 'function') return (v as {toDate:()=>Date}).toDate().getTime();
          return new Date(v as string|number).getTime();
        };
        const thisYear = new Date().getFullYear();
        const dayRev: Record<string, number> = {};
        orders.forEach(o => {
          const ts = toTs380(o.createdAt);
          if (!ts) return;
          const d = new Date(ts);
          if (d.getFullYear() !== thisYear) return;
          const key = d.toISOString().slice(0, 10);
          dayRev[key] = (dayRev[key] || 0) + (o.totalPrice || 0);
        });
        const top5 = Object.entries(dayRev).sort((a, b) => b[1] - a[1]).slice(0, 5);
        if (top5.length < 2) return null;
        const maxDay = top5[0][1];
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? 'Bu Yılın En Yüksek Ciro Günleri' : 'Top Revenue Days This Year'}</h3>
            <p className="text-xs text-gray-500 mb-4">Highest single-day revenue in {thisYear}</p>
            <div className="space-y-2">
              {top5.map(([date, rev], i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-[10px] font-bold text-gray-500 w-6">{i + 1}.</span>
                  <span className="text-xs text-gray-600 w-24">{new Date(date).toLocaleDateString('tr-TR', {day:'2-digit', month:'short'})}</span>
                  <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{width: `${(rev / maxDay) * 100}%`, background: i === 0 ? '#ff4000' : '#6366f1'}} />
                  </div>
                  <span className="text-xs font-bold w-24 text-right" style={{color: i === 0 ? '#ff4000' : '#6366f1'}}>{fmtAna(rev,'full',0)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 10 && (() => {
        const days = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
        const matrix: number[][] = Array.from({length: 7}, () => [0,0,0,0]);
        orders.forEach(o => {
          const d = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string)) : null;
          if (!d) return;
          const dow = (d.getDay() + 6) % 7; // 0=Mon
          const weekOfMonth = Math.min(Math.floor((d.getDate() - 1) / 7), 3);
          const oRec386 = o as unknown as Record<string,unknown>;
          const total = typeof oRec386.total === 'number' ? oRec386.total as number
            : (o.lineItems ?? []).reduce((s, li) => { const lr = li as unknown as Record<string,unknown>; return s + ((lr.quantity as number | undefined) ?? 0) * ((lr.unitPrice as number | undefined) ?? (lr.price as number | undefined) ?? 0); }, 0);
          matrix[dow][weekOfMonth] += total;
        });
        const allVals = matrix.flat();
        const maxV = Math.max(...allVals, 1);
        const weeks = ['W1','W2','W3','W4'];
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">Revenue Heatmap (Day × Week)</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr>
                    <th className="text-left text-gray-400 font-normal pr-2 pb-1 w-8"></th>
                    {weeks.map(w => <th key={w} className="text-gray-400 font-normal pb-1 px-1">{w}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {days.map((day, di) => (
                    <tr key={day}>
                      <td className="text-gray-500 font-medium pr-2 py-0.5">{day}</td>
                      {matrix[di].map((v, wi) => {
                        const intensity = v / maxV;
                        return (
                          <td key={wi} className="px-1 py-0.5">
                            <div className="rounded w-full h-5 flex items-center justify-center text-[9px] font-medium" style={{background: v > 0 ? `rgba(255,64,0,${0.15 + intensity * 0.85})` : '#f3f4f6', color: intensity > 0.5 ? 'white' : '#374151'}}>
                              {v > 0 ? (v >= 1000 ? `${(v/1000).toFixed(0)}k` : v.toFixed(0)) : ''}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 10 && (() => {
        const byMonth: Record<string, number> = {};
        orders.forEach(o => {
          const d = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string)) : null;
          if (!d) return;
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          const oRec390 = o as unknown as Record<string,unknown>;
          const total = typeof oRec390.total === 'number' ? oRec390.total as number
            : (o.lineItems ?? []).reduce((s, li) => { const lr = li as unknown as Record<string,unknown>; return s + ((lr.quantity as number | undefined) ?? 0) * ((lr.unitPrice as number | undefined) ?? (lr.price as number | undefined) ?? 0); }, 0);
          byMonth[key] = (byMonth[key] ?? 0) + total;
        });
        const months = Object.keys(byMonth).sort().slice(-7);
        if (months.length < 3) return null;
        const growthRows = months.slice(1).map((m, i) => {
          const prev = byMonth[months[i]];
          const curr = byMonth[m];
          const pct = prev > 0 ? ((curr - prev) / prev) * 100 : 0;
          return { month: m.slice(5), pct };
        });
        const maxAbs = Math.max(...growthRows.map(r => Math.abs(r.pct)), 1);
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">{currentLanguage === 'tr' ? 'Aylık Ciro Artışı' : 'Month-over-Month Revenue Growth'}</h3>
            <div className="relative h-28">
              <div className="absolute inset-x-0" style={{top: '50%', height: 1, background: '#e5e7eb'}} />
              <div className="flex items-center h-full gap-2">
                {growthRows.map(r => {
                  const barH = (Math.abs(r.pct) / maxAbs) * 48;
                  const isPos = r.pct >= 0;
                  return (
                    <div key={r.month} className="flex-1 flex flex-col items-center">
                      {isPos ? (
                        <>
                          <div className="flex-1 flex items-end justify-center pb-0.5">
                            <div style={{height: `${barH}px`, background: '#22c55e', width: '70%', borderRadius: '3px 3px 0 0'}} />
                          </div>
                          <span className="text-[9px] font-bold text-green-600">+{r.pct.toFixed(0)}%</span>
                          <div className="flex-1" />
                        </>
                      ) : (
                        <>
                          <div className="flex-1" />
                          <span className="text-[9px] font-bold text-red-500">{r.pct.toFixed(0)}%</span>
                          <div className="flex-1 flex items-start justify-center pt-0.5">
                            <div style={{height: `${barH}px`, background: '#ef4444', width: '70%', borderRadius: '0 0 3px 3px'}} />
                          </div>
                        </>
                      )}
                      <span className="text-[9px] text-gray-400 mt-1">{r.month}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 5 && (() => {
        const now = new Date();
        const thisMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
        const lastDate = new Date(now.getFullYear(), now.getMonth()-1, 1);
        const lastMonth = `${lastDate.getFullYear()}-${String(lastDate.getMonth()+1).padStart(2,'0')}`;
        let thisMRev = 0, lastMRev = 0;
        orders.forEach(o => {
          const d = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string)) : null;
          if (!d) return;
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          const oR = o as unknown as Record<string,unknown>;
          const total = typeof oR.total === 'number' ? oR.total as number
            : (o.lineItems ?? []).reduce((s, li) => { const lr = li as unknown as Record<string,unknown>; return s + ((lr.quantity as number|undefined)??0) * ((lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0); }, 0);
          if (key === thisMonth) thisMRev += total;
          if (key === lastMonth) lastMRev += total;
        });
        if (thisMRev === 0 && lastMRev === 0) return null;
        const pct = lastMRev > 0 ? ((thisMRev - lastMRev) / lastMRev) * 100 : 0;
        const gaugeVal = lastMRev > 0 ? Math.min(thisMRev / lastMRev, 2) : 1;
        const r = 40; const cx = 60; const cy = 55;
        const rad = (a: number) => (a - 90) * Math.PI / 180;
        const arc = (pct2: number, color: string) => {
          const end = Math.min(pct2, 1) * 180;
          const x1 = cx + r * Math.cos(rad(-90)); const y1 = cy + r * Math.sin(rad(-90));
          const x2 = cx + r * Math.cos(rad(-90 + end)); const y2 = cy + r * Math.sin(rad(-90 + end));
          return end > 0 ? `M ${x1} ${y1} A ${r} ${r} 0 ${end > 180 ? 1 : 0} 1 ${x2} ${y2}` : '';
        };
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-1">{currentLanguage === 'tr' ? 'Bu Ay ve Geçen Ay' : 'This Month vs Last Month'}</h3>
            <div className="flex items-center gap-4">
              <svg width="120" height="70" viewBox="0 0 120 70">
                <path d={arc(1, '#e5e7eb')} fill="none" stroke="#e5e7eb" strokeWidth="10" strokeLinecap="round" />
                <path d={arc(gaugeVal, pct >= 0 ? '#22c55e' : '#ef4444')} fill="none" stroke={pct >= 0 ? '#22c55e' : '#ef4444'} strokeWidth="10" strokeLinecap="round" />
                <text x={cx} y={cy+8} textAnchor="middle" fontSize="11" fontWeight="bold" fill={pct >= 0 ? '#22c55e' : '#ef4444'}>{pct >= 0 ? '+' : ''}{pct.toFixed(0)}%</text>
              </svg>
              <div className="flex-1 space-y-1">
                <div className="flex justify-between text-xs"><span className="text-gray-500">This month</span><span className="font-bold">{fmtAna(thisMRev,'full',0)}</span></div>
                <div className="flex justify-between text-xs"><span className="text-gray-500">Last month</span><span className="text-gray-700">{fmtAna(lastMRev,'full',0)}</span></div>
              </div>
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 1 && (() => {
        const totalOrders = orders.length;
        let totalRevenue = 0;
        orders.forEach(o => {
          const oR = o as unknown as Record<string,unknown>;
          totalRevenue += typeof oR.total === 'number' ? oR.total as number
            : (o.lineItems ?? []).reduce((s, li) => { const lr = li as unknown as Record<string,unknown>; return s + ((lr.quantity as number|undefined)??0) * ((lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0); }, 0);
        });
        const orderMilestones = [10,50,100,250,500,1000,5000];
        const revMilestones = [100000,500000,1000000,5000000,10000000];
        const oMilestone = orderMilestones.find(m => totalOrders < m) ?? orderMilestones[orderMilestones.length-1];
        const rMilestone = revMilestones.find(m => totalRevenue < m) ?? revMilestones[revMilestones.length-1];
        const oPct = Math.min((totalOrders / oMilestone) * 100, 100);
        const rPct = Math.min((totalRevenue / rMilestone) * 100, 100);
        const prevO = orderMilestones[orderMilestones.indexOf(oMilestone) - 1] ?? 0;
        const prevR = revMilestones[revMilestones.indexOf(rMilestone) - 1] ?? 0;
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">🏆 Sales Milestones</h3>
            <div className="space-y-4">
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-gray-600">Total Orders</span>
                  <span className="font-bold">{totalOrders} <span className="text-gray-400">/ {oMilestone}</span></span>
                </div>
                <div className="bg-gray-100 rounded-full h-3 overflow-hidden">
                  <div className="h-full rounded-full transition-all" style={{width: `${oPct}%`, background: 'linear-gradient(90deg, #ff4000, #ff8c00)'}} />
                </div>
                <div className="flex justify-between text-[9px] text-gray-400 mt-0.5">
                  <span>{prevO}</span><span>{oMilestone}</span>
                </div>
              </div>
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-gray-600">Total Revenue</span>
                  <span className="font-bold">{fmtAna(totalRevenue,'K',0)} <span className="text-gray-400">/ {fmtAna(rMilestone,'K',0)}</span></span>
                </div>
                <div className="bg-gray-100 rounded-full h-3 overflow-hidden">
                  <div className="h-full rounded-full transition-all" style={{width: `${rPct}%`, background: 'linear-gradient(90deg, #6366f1, #a78bfa)'}} />
                </div>
                <div className="flex justify-between text-[9px] text-gray-400 mt-0.5">
                  <span>{fmtAna(prevR,'K',0)}</span><span>{fmtAna(rMilestone,'K',0)}</span>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 5 && (() => {
        const now = new Date();
        const year = now.getFullYear();
        const quarters: Record<string, number> = {Q1: 0, Q2: 0, Q3: 0, Q4: 0};
        orders.forEach(o => {
          const d = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string)) : null;
          if (!d || d.getFullYear() !== year) return;
          const q = `Q${Math.ceil((d.getMonth()+1)/3)}`;
          const oR = o as unknown as Record<string,unknown>;
          const total = typeof oR.total === 'number' ? oR.total as number
            : (o.lineItems ?? []).reduce((s, li) => { const lr = li as unknown as Record<string,unknown>; return s + ((lr.quantity as number|undefined)??0) * ((lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0); }, 0);
          quarters[q] += total;
        });
        const ytdTotal = Object.values(quarters).reduce((a,b) => a+b, 0);
        if (ytdTotal === 0) return null;
        const maxQ = Math.max(...Object.values(quarters), 1);
        const qColors = {Q1:'#3b82f6',Q2:'#f59e0b',Q3:'#22c55e',Q4:'#ff4000'};
        return (
          <div className="apple-card p-4 mb-4">
            <div className="flex justify-between items-center mb-3">
              <h3 className="font-semibold text-sm">YTD Revenue by Quarter ({year})</h3>
              <span className="text-xs font-bold text-brand">{fmtAna(ytdTotal,'K',0)}</span>
            </div>
            <div className="flex items-end gap-3 h-24 mb-1">
              {Object.entries(quarters).map(([q, rev]) => (
                <div key={q} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-[9px] text-gray-500">{rev > 0 ? `₺${(rev/1000).toFixed(0)}k` : ''}</span>
                  <div className="w-full rounded-sm transition-all" style={{height: `${(rev / maxQ) * 72}px`, background: (qColors as Record<string,string>)[q], minHeight: rev > 0 ? 3 : 0}} />
                  <span className="text-xs font-medium" style={{color: (qColors as Record<string,string>)[q]}}>{q}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 5 && (() => {
        const weeks: Record<string, number> = {};
        orders.forEach(o => {
          const d = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string)) : null;
          if (!d) return;
          const weekStart = new Date(d);
          weekStart.setDate(d.getDate() - ((d.getDay() + 6) % 7));
          const key = `${weekStart.getFullYear()}-${String(weekStart.getMonth()+1).padStart(2,'0')}-${String(weekStart.getDate()).padStart(2,'0')}`;
          weeks[key] = (weeks[key] ?? 0) + 1;
        });
        const weekKeys = Object.keys(weeks).sort().slice(-8);
        if (weekKeys.length < 3) return null;
        const vals = weekKeys.map(k => weeks[k]);
        const maxV = Math.max(...vals, 1);
        const avg = vals.reduce((a,b)=>a+b,0)/vals.length;
        // Simple line chart using SVG polyline
        const w = 240; const h = 60; const pad = 8;
        const pts = vals.map((v, i) => `${pad + (i / (vals.length-1)) * (w-2*pad)},${h - pad - ((v / maxV) * (h-2*pad))}`).join(' ');
        return (
          <div className="apple-card p-4 mb-4">
            <div className="flex justify-between items-center mb-2">
              <h3 className="font-semibold text-sm">{currentLanguage === 'tr' ? 'Haftalık Sipariş Eğilimi' : 'Weekly Orders Trend'}</h3>
              <span className="text-xs text-gray-500">avg {avg.toFixed(0)}/wk</span>
            </div>
            <svg width="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{height: 60}}>
              <polyline points={pts} fill="none" stroke="#ff4000" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              {vals.map((v, i) => (
                <circle key={i} cx={pad + (i / (vals.length-1)) * (w-2*pad)} cy={h - pad - ((v / maxV) * (h-2*pad))} r="3" fill="#ff4000" />
              ))}
            </svg>
            <div className="flex justify-between text-[9px] text-gray-400 mt-1">
              <span>{weekKeys[0]?.slice(5)}</span>
              <span>{weekKeys[weekKeys.length-1]?.slice(5)}</span>
            </div>
          </div>
        );
      })()}


      {reportsTab === 'genel' && orders.length >= 5 && (() => {
        const now = new Date();
        const d90 = new Date(now.getTime() - 90 * 86400000);
        const d180 = new Date(now.getTime() - 180 * 86400000);
        let curr = 0, prev = 0, currC = 0, prevC = 0;
        orders.forEach(o => {
          const d = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string)) : null;
          if (!d) return;
          const oR = o as unknown as Record<string,unknown>;
          const total = typeof oR.total === 'number' ? oR.total as number
            : (o.lineItems ?? []).reduce((s, li) => { const lr = li as unknown as Record<string,unknown>; return s + ((lr.quantity as number|undefined)??0)*((lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0); }, 0);
          if (d >= d90) { curr += total; currC++; }
          else if (d >= d180) { prev += total; prevC++; }
        });
        if (curr === 0 && prev === 0) return null;
        const revPct = prev > 0 ? ((curr - prev) / prev) * 100 : 0;
        const orderPct = prevC > 0 ? ((currC - prevC) / prevC) * 100 : 0;
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">{currentLanguage === 'tr' ? 'Son 90 Gün ve Önceki 90 Gün' : 'Last 90d vs Prior 90d'}</h3>
            <div className="grid grid-cols-2 gap-3">
              {[{label:'Revenue', curr, prev, pct: revPct, fmt: (v:number) => `₺${(v/1000).toFixed(1)}k`},
                {label:'Orders', curr: currC, prev: prevC, pct: orderPct, fmt: (v:number) => String(v)}].map(r => (
                <div key={r.label} className="rounded-xl p-3" style={{background: r.pct >= 0 ? '#22c55e12' : '#ef444412'}}>
                  <p className="text-[10px] text-gray-500 mb-1">{r.label}</p>
                  <p className="text-lg font-bold text-gray-800">{r.fmt(r.curr)}</p>
                  <p className="text-xs" style={{color: r.pct >= 0 ? '#22c55e' : '#ef4444'}}>
                    {r.pct >= 0 ? '▲' : '▼'} {Math.abs(r.pct).toFixed(0)}%
                    <span className="text-gray-400 ml-1">vs {r.fmt(r.prev)}</span>
                  </p>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 5 && (() => {
        const now = new Date();
        const d30 = new Date(now.getTime() - 30 * 86400000);
        const d60 = new Date(now.getTime() - 60 * 86400000);
        let rev30 = 0, rev30to60 = 0, orders30 = 0, orders30to60 = 0;
        let cancelCount = 0;
        orders.forEach(o => {
          const d = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string)) : null;
          if (!d) return;
          const oR = o as unknown as Record<string,unknown>;
          const total = typeof oR.total === 'number' ? oR.total as number
            : (o.lineItems ?? []).reduce((s, li) => { const lr = li as unknown as Record<string,unknown>; return s + ((lr.quantity as number|undefined)??0)*((lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0); }, 0);
          if (d >= d30) { rev30 += total; orders30++; if (o.status === 'Cancelled') cancelCount++; }
          else if (d >= d60) { rev30to60 += total; orders30to60++; }
        });
        const revScore = rev30to60 > 0 ? Math.min(100, Math.round((rev30 / rev30to60) * 50)) : 50;
        const orderScore = orders30to60 > 0 ? Math.min(100, Math.round((orders30 / orders30to60) * 50)) : 50;
        const cancelRate = orders30 > 0 ? (cancelCount / orders30) * 100 : 0;
        const cancelScore = Math.max(0, 100 - cancelRate * 5);
        const inventoryScore = inventory.length > 0 ? Math.min(100, inventory.length * 2) : 50;
        const overall = Math.round((revScore + orderScore + cancelScore + inventoryScore) / 4);
        const color = overall >= 75 ? '#22c55e' : overall >= 50 ? '#f59e0b' : '#ef4444';
        const label = overall >= 75 ? 'Healthy' : overall >= 50 ? 'Moderate' : 'At Risk';
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">{currentLanguage === 'tr' ? 'İş Sağlığı Puanı' : 'Business Health Score'}</h3>
            <div className="flex items-center gap-4">
              <div className="relative w-20 h-20 flex-shrink-0">
                <svg width="80" height="80" viewBox="0 0 80 80">
                  <circle cx="40" cy="40" r="32" fill="none" stroke="#e5e7eb" strokeWidth="8" />
                  <circle cx="40" cy="40" r="32" fill="none" stroke={color} strokeWidth="8"
                    strokeDasharray={`${(overall / 100) * 201} 201`}
                    strokeDashoffset="50" strokeLinecap="round" />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-xl font-bold" style={{color}}>{overall}</span>
                  <span className="text-[8px] text-gray-500">{label}</span>
                </div>
              </div>
              <div className="flex-1 space-y-1.5">
                {[{label:'Revenue Growth', score: revScore}, {label:'Order Volume', score: orderScore},
                  {label:'Low Cancellations', score: Math.round(cancelScore)}, {label:'Inventory', score: inventoryScore}].map(m => (
                  <div key={m.label} className="flex items-center gap-2">
                    <span className="text-[10px] text-gray-500 flex-1">{m.label}</span>
                    <div className="w-16 bg-gray-100 rounded-full h-2">
                      <div className="h-full rounded-full" style={{width: `${m.score}%`, background: m.score >= 75 ? '#22c55e' : m.score >= 50 ? '#f59e0b' : '#ef4444'}} />
                    </div>
                    <span className="text-[9px] font-bold text-gray-600 w-6 text-right">{m.score}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 5 && (() => {
        const productRevenue: Record<string, number> = {};
        orders.forEach(o => {
          (o.lineItems ?? []).forEach(li => {
            const lr = li as unknown as Record<string,unknown>;
            const name = (lr.productName as string|undefined) ?? (lr.name as string|undefined) ?? 'Unknown';
            const qty = (lr.quantity as number|undefined) ?? 0;
            const price = (lr.unitPrice as number|undefined) ?? (lr.price as number|undefined) ?? 0;
            productRevenue[name] = (productRevenue[name] ?? 0) + qty * price;
          });
        });
        const sorted = Object.entries(productRevenue).sort((a,b)=>b[1]-a[1]);
        if (sorted.length < 3) return null;
        const totalRev = sorted.reduce((s,[,v])=>s+v,0);
        const top20n = Math.max(1, Math.ceil(sorted.length * 0.2));
        const top20Rev = sorted.slice(0, top20n).reduce((s,[,v])=>s+v,0);
        const top20Pct = totalRev > 0 ? Math.round((top20Rev/totalRev)*100) : 0;
        const top5 = sorted.slice(0, 5);
        const maxRev = top5[0]?.[1] ?? 1;
        return (
          <div className="apple-card p-4 mb-4">
            <div className="flex justify-between items-center mb-3">
              <h3 className="font-semibold text-sm">{currentLanguage === 'tr' ? 'Ürün Cirosu Pareto' : 'Product Revenue Pareto'}</h3>
              <span className="text-xs bg-orange-100 text-orange-700 rounded-full px-2 py-0.5">Top 20% → {top20Pct}% rev</span>
            </div>
            <div className="space-y-2">
              {top5.map(([name, rev], i) => (
                <div key={name} className="flex items-center gap-2">
                  <span className="text-xs font-bold text-gray-400 w-4">#{i+1}</span>
                  <span className="text-xs truncate flex-1 text-gray-700">{name}</span>
                  <div className="w-20 bg-gray-100 rounded-full h-3 overflow-hidden">
                    <div className="h-full rounded-full" style={{width: `${(rev/maxRev)*100}%`, background: '#ff4000'}} />
                  </div>
                  <span className="text-[10px] text-gray-500 w-8 text-right">{totalRev > 0 ? Math.round((rev/totalRev)*100) : 0}%</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 5 && (() => {
        const byMonth: Record<string, number> = {};
        orders.forEach(o => {
          const d = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string)) : null;
          if (!d) return;
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          const oR = o as unknown as Record<string,unknown>;
          const total = typeof oR.total === 'number' ? oR.total as number
            : (o.lineItems ?? []).reduce((s, li) => { const lr = li as unknown as Record<string,unknown>; return s + ((lr.quantity as number|undefined)??0)*((lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0); }, 0);
          byMonth[key] = (byMonth[key] ?? 0) + total;
        });
        const top5 = Object.entries(byMonth).sort((a,b)=>b[1]-a[1]).slice(0,5);
        if (top5.length < 2) return null;
        const maxRev = top5[0][1];
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">🏆 Best Revenue Months</h3>
            <div className="space-y-2">
              {top5.map(([month, rev], i) => (
                <div key={month} className="flex items-center gap-2">
                  <span className="text-xs font-bold w-4 text-gray-400">#{i+1}</span>
                  <span className="text-xs w-16 text-gray-700">{month}</span>
                  <div className="flex-1 bg-gray-100 rounded-full h-4 overflow-hidden">
                    <div className="h-full rounded-full flex items-center pl-2 transition-all" style={{width:`${(rev/maxRev)*100}%`,background:i===0?'#ff4000':'#6366f1'}}>
                      <span className="text-white text-[9px] font-bold">{fmtAna(rev,'K',0)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 5 && (() => {
        const sorted = [...orders].sort((a,b) => {
          const da = a.createdAt ? ((a.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(a.createdAt as string)) : new Date(0);
          const db = b.createdAt ? ((b.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(b.createdAt as string)) : new Date(0);
          return da.getTime()-db.getTime();
        });
        let cumulative = 0;
        const points = sorted.map(o => {
          const oR = o as unknown as Record<string,unknown>;
          const total = typeof oR.total === 'number' ? oR.total as number
            : (o.lineItems??[]).reduce((s,li)=>{ const lr=li as unknown as Record<string,unknown>; return s+((lr.quantity as number|undefined)??0)*((lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0); },0);
          cumulative += total;
          return cumulative;
        }).filter((_,i)=>i%Math.max(1,Math.floor(sorted.length/40))===0);
        if (points.length < 3) return null;
        const maxV = points[points.length-1];
        const w=240; const h=60; const pad=8;
        const pts = points.map((v,i)=>`${pad+(i/(points.length-1))*(w-2*pad)},${h-pad-(v/maxV)*(h-2*pad)}`).join(' ');
        return (
          <div className="apple-card p-4 mb-4">
            <div className="flex justify-between items-center mb-2">
              <h3 className="font-semibold text-sm">{currentLanguage === 'tr' ? 'Kümülatif Ciro Seyri' : 'Cumulative Revenue Trajectory'}</h3>
              <span className="text-xs font-bold text-brand">{fmtAna(maxV,'K',0)} total</span>
            </div>
            <svg width="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{height:60}}>
              <defs>
                <linearGradient id="cumGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#ff4000" stopOpacity="0.3"/>
                  <stop offset="100%" stopColor="#ff4000" stopOpacity="0"/>
                </linearGradient>
              </defs>
              <polygon points={`${pad},${h-pad} ${pts} ${pad+(points.length-1)/(points.length-1)*(w-2*pad)},${h-pad}`} fill="url(#cumGrad)" />
              <polyline points={pts} fill="none" stroke="#ff4000" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <p className="text-[10px] text-gray-400 text-center mt-1">{sorted.length} orders total</p>
          </div>
        );
      })()}
    </>
  );
}
