/**
 * GenelBloklar6.tsx — GenelRapor bölmesi (2026-08-31)
 *
 * GenelRapor.tsx'ten mekanik olarak çıkarıldı (bölme öncesi satır 3200–3754).
 * Bloklar ORİJİNAL SIRASIYLA ve içeriği DEĞİŞTİRİLMEDEN taşındı; bloklardaki
 * `reportsTab === 'genel'` koşulları BİLEREK korundu (bkz. GenelRapor.tsx
 * başlık notu — ebeveyn zaten sekmeye göre render ediyor, koşulu silmek
 * "saf kopya" güvencesini bozardı).
 * Props yalnız bu dosyanın gerçekten kullandığı ctx alanlarıdır
 * (tsc "Cannot find name" listesinden çıkarıldı).
 */
import { type ReportsCtx } from '../useReportsData';

type Props = Pick<ReportsCtx, 'reportsTab' | 'orders' | 'inventory' | 'employees' | 'quotations' | 'currentLanguage' | 'fmtAna'>;

export default function GenelBloklar6({ reportsTab, orders, inventory, employees, quotations, currentLanguage, fmtAna }: Props) {
  return (
    <>
      {reportsTab === 'genel' && orders.length >= 3 && (() => {
        const custRevenue: Record<string,number> = {};
        const dayRevenue: Record<string,number> = {};
        let maxOrderValue = 0;
        let maxOrderCustomer = '';
        orders.forEach(o => {
          const d = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(o.createdAt as string)) : null;
          const cid = (o as unknown as Record<string,unknown>).customerName as string|undefined || (o as unknown as Record<string,unknown>).customerId as string|undefined || 'Unknown';
          const oR = o as unknown as Record<string,unknown>;
          const total = typeof oR.total === 'number' ? oR.total as number
            : (o.lineItems??[]).reduce((s,li)=>{ const lr=li as unknown as Record<string,unknown>; return s+((lr.quantity as number|undefined)??0)*((lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0); },0);
          custRevenue[cid]=(custRevenue[cid]??0)+total;
          if (d) { const dk=d.toISOString().slice(0,10); dayRevenue[dk]=(dayRevenue[dk]??0)+total; }
          if (total > maxOrderValue) { maxOrderValue=total; maxOrderCustomer=cid; }
        });
        const topCustomer = Object.entries(custRevenue).sort((a,b)=>b[1]-a[1])[0];
        const bestDay = Object.entries(dayRevenue).sort((a,b)=>b[1]-a[1])[0];
        const records = [
          {label:'Largest Order', val:`₺${(maxOrderValue/1000).toFixed(1)}k`, sub: maxOrderCustomer, icon:'💎'},
          {label:'Best Day', val:`₺${bestDay?((bestDay[1]/1000).toFixed(1))+'k':'—'}`, sub: bestDay?.[0]??'—', icon:'📅'},
          {label:'Top Customer', val:`₺${topCustomer?((topCustomer[1]/1000).toFixed(1))+'k':'—'}`, sub: topCustomer?.[0]??'—', icon:'👑'},
          {label:'Total Orders', val:String(orders.length), sub:'all time', icon:'📦'},
        ];
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">{currentLanguage === 'tr' ? 'Tüm Zamanların Rekorları' : 'All-Time Records'}</h3>
            <div className="grid grid-cols-2 gap-2">
              {records.map(r=>(
                <div key={r.label} className="rounded-xl p-3 bg-gray-50">
                  <div className="flex items-center gap-1 mb-0.5">
                    <span className="text-sm">{r.icon}</span>
                    <span className="text-[10px] text-gray-400">{r.label}</span>
                  </div>
                  <p className="text-base font-bold text-gray-800">{r.val}</p>
                  <p className="text-[9px] text-gray-400 truncate">{r.sub}</p>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 5 && (() => {
        const now = new Date();
        const periods = [7,30,90];
        const results = periods.map(days => {
          const curr = new Date(now.getTime()-days*86400000);
          const prev = new Date(now.getTime()-2*days*86400000);
          let currRev=0, prevRev=0;
          orders.forEach(o => {
            const d = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(o.createdAt as string)) : null;
            if (!d) return;
            const oR = o as unknown as Record<string,unknown>;
            const total = typeof oR.total==='number' ? oR.total as number
              : (o.lineItems??[]).reduce((s,li)=>{ const lr=li as unknown as Record<string,unknown>; return s+((lr.quantity as number|undefined)??0)*((lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0); },0);
            if (d>=curr) currRev+=total;
            else if (d>=prev) prevRev+=total;
          });
          const pct = prevRev>0 ? ((currRev-prevRev)/prevRev)*100 : 0;
          return {label:`${days}d`, pct, currRev};
        });
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">{currentLanguage === 'tr' ? 'Ciro Artış Oranları' : 'Revenue Growth Rates'}</h3>
            <div className="grid grid-cols-3 gap-2">
              {results.map(r=>(
                <div key={r.label} className="rounded-xl p-3 text-center" style={{background:r.pct>=0?'#22c55e12':'#ef444412'}}>
                  <p className="text-lg font-bold" style={{color:r.pct>=0?'#22c55e':'#ef4444'}}>
                    {r.pct>=0?'+':''}{r.pct.toFixed(0)}%
                  </p>
                  <p className="text-[10px] text-gray-500">{r.label}</p>
                  <p className="text-[9px] text-gray-400">{fmtAna(r.currRev,'K',0)}</p>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 10 && (() => {
        const now = new Date();
        const currentYear = now.getFullYear();
        const prevYear = currentYear - 1;
        const currByMonth: number[] = new Array(12).fill(0);
        const prevByMonth: number[] = new Array(12).fill(0);
        orders.forEach(o => {
          const d = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(o.createdAt as string)) : null;
          if (!d) return;
          const oR = o as unknown as Record<string,unknown>;
          const total = typeof oR.total==='number' ? oR.total as number
            : (o.lineItems??[]).reduce((s,li)=>{ const lr=li as unknown as Record<string,unknown>; return s+((lr.quantity as number|undefined)??0)*((lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0); },0);
          if (d.getFullYear()===currentYear) currByMonth[d.getMonth()]+=total;
          else if (d.getFullYear()===prevYear) prevByMonth[d.getMonth()]+=total;
        });
        const hasPrevYear = prevByMonth.some(v=>v>0);
        if (!hasPrevYear) return null;
        const monthsToShow = now.getMonth() + 1;
        const maxVal = Math.max(...currByMonth.slice(0,monthsToShow),...prevByMonth.slice(0,monthsToShow),1);
        const monthLabels = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">{currentLanguage === 'tr' ? 'Yıllık Ciro Karşılaştırması' : 'Year-over-Year Revenue'}</h3>
            <div className="flex items-end gap-1 h-24 mb-1">
              {Array.from({length:monthsToShow},(_,i)=>(
                <div key={i} className="flex-1 flex items-end gap-0.5">
                  <div className="flex-1 rounded-sm" style={{height:`${(prevByMonth[i]/maxVal)*72}px`,background:'#d1d5db',minHeight:prevByMonth[i]>0?2:0}} />
                  <div className="flex-1 rounded-sm" style={{height:`${(currByMonth[i]/maxVal)*72}px`,background:'#ff4000',minHeight:currByMonth[i]>0?2:0}} />
                </div>
              ))}
            </div>
            <div className="flex justify-between">
              {Array.from({length:monthsToShow},(_,i)=><span key={i} className="flex-1 text-center text-[8px] text-gray-400">{monthLabels[i]}</span>)}
            </div>
            <div className="flex gap-3 justify-center text-[10px] mt-1">
              <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-brand"/><span className="text-gray-500">{currentYear}</span></div>
              <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-gray-300"/><span className="text-gray-500">{prevYear}</span></div>
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 12 && (() => {
        const monthRevenue: number[] = new Array(12).fill(0);
        const monthCounts: number[] = new Array(12).fill(0);
        orders.forEach(o => {
          const d = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(o.createdAt as string)) : null;
          if (!d) return;
          const oR = o as unknown as Record<string,unknown>;
          const total = typeof oR.total==='number' ? oR.total as number
            : (o.lineItems??[]).reduce((s,li)=>{ const lr=li as unknown as Record<string,unknown>; return s+((lr.quantity as number|undefined)??0)*((lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0); },0);
          monthRevenue[d.getMonth()]+=total;
          monthCounts[d.getMonth()]++;
        });
        const monthAvg = monthRevenue.map((v,i)=>monthCounts[i]>0?v/monthCounts[i]:0);
        const overallAvg = monthAvg.filter(v=>v>0).reduce((a,b)=>a+b,0)/Math.max(monthAvg.filter(v=>v>0).length,1);
        const indices = monthAvg.map(v=>overallAvg>0?Math.round((v/overallAvg)*100):0);
        const monthLabels = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        const maxIdx = Math.max(...indices,1);
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">{currentLanguage === 'tr' ? 'Mevsimsellik Endeksi' : 'Seasonality Index'}</h3>
            <div className="overflow-x-auto">
              <div className="flex items-end gap-0.5 h-16 min-w-full">
                {indices.map((idx,i)=>(
                  <div key={i} className="flex-1 flex flex-col items-center gap-0.5" style={{minWidth:18}}>
                    <div className="w-full rounded-sm" style={{height:`${(idx/maxIdx)*48}px`,background:idx>=110?'#22c55e':idx>=90?'#3b82f6':'#f59e0b',minHeight:idx>0?2:0}} />
                    <span className="text-[8px] text-gray-400">{monthLabels[i].slice(0,1)}</span>
                  </div>
                ))}
              </div>
            </div>
            <p className="text-[10px] text-gray-400 text-center mt-1">100 = average month</p>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 5 && (() => {
        const brackets = [{label:'<₺1k',min:0,max:1000},{label:'₺1-5k',min:1000,max:5000},{label:'₺5-20k',min:5000,max:20000},{label:'₺20-100k',min:20000,max:100000},{label:'₺100k+',min:100000,max:Infinity}];
        const data = brackets.map(b=>({...b,count:0,revenue:0}));
        orders.forEach(o => {
          const oR = o as unknown as Record<string,unknown>;
          const total = typeof oR.total==='number' ? oR.total as number
            : (o.lineItems??[]).reduce((s,li)=>{ const lr=li as unknown as Record<string,unknown>; return s+((lr.quantity as number|undefined)??0)*((lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0); },0);
          const bracket = data.find(b=>total>=b.min&&total<b.max);
          if (bracket) { bracket.count++; bracket.revenue+=total; }
        });
        const totalRev = data.reduce((s,b)=>s+b.revenue,0);
        const maxRev = Math.max(...data.map(b=>b.revenue),1);
        const colors=['#94a3b8','#3b82f6','#f59e0b','#ff4000','#8b5cf6'];
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">{currentLanguage === 'tr' ? 'Sipariş Büyüklüğüne Göre Ciro' : 'Revenue by Order Size'}</h3>
            <div className="space-y-2">
              {data.map((b,i)=>b.count>0&&(
                <div key={b.label} className="flex items-center gap-2">
                  <span className="text-[10px] w-14 text-gray-600">{b.label}</span>
                  <div className="flex-1 bg-gray-100 rounded-full h-4 overflow-hidden">
                    <div className="h-full rounded-full flex items-center pl-1.5" style={{width:`${(b.revenue/maxRev)*100}%`,background:colors[i]}}>
                      <span className="text-white text-[9px] font-bold">{b.count}</span>
                    </div>
                  </div>
                  <span className="text-[9px] text-gray-400 w-8 text-right">{totalRev>0?Math.round((b.revenue/totalRev)*100):0}%</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 10 && (() => {
        const byMonth: Record<string,{first:number;second:number}> = {};
        orders.forEach(o => {
          const d = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(o.createdAt as string)) : null;
          if (!d) return;
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          const oR = o as unknown as Record<string,unknown>;
          const total = typeof oR.total==='number' ? oR.total as number
            : (o.lineItems??[]).reduce((s,li)=>{ const lr=li as unknown as Record<string,unknown>; return s+((lr.quantity as number|undefined)??0)*((lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0); },0);
          if (!byMonth[key]) byMonth[key]={first:0,second:0};
          if (d.getDate()<=15) byMonth[key].first+=total; else byMonth[key].second+=total;
        });
        const months = Object.keys(byMonth).sort().slice(-5);
        if (months.length<2) return null;
        const maxVal = Math.max(...months.flatMap(m=>[byMonth[m].first,byMonth[m].second]),1);
        const totalFirst = months.reduce((s,m)=>s+byMonth[m].first,0);
        const totalSecond = months.reduce((s,m)=>s+byMonth[m].second,0);
        const total = totalFirst+totalSecond;
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">Revenue: First vs Second Half of Month</h3>
            <div className="flex items-end gap-2 h-20 mb-1">
              {months.map(m=>(
                <div key={m} className="flex-1 flex items-end gap-0.5">
                  <div className="flex-1 rounded-sm" style={{height:`${(byMonth[m].first/maxVal)*64}px`,background:'#3b82f6',minHeight:byMonth[m].first>0?2:0}} />
                  <div className="flex-1 rounded-sm" style={{height:`${(byMonth[m].second/maxVal)*64}px`,background:'#ff4000',minHeight:byMonth[m].second>0?2:0}} />
                </div>
              ))}
            </div>
            <div className="flex gap-1 mb-2">{months.map(m=><span key={m} className="flex-1 text-center text-[9px] text-gray-400">{m.slice(5)}</span>)}</div>
            <div className="flex justify-between text-xs">
              <span className="text-blue-500">1st half: {total>0?Math.round((totalFirst/total)*100):0}%</span>
              <span className="text-brand">2nd half: {total>0?Math.round((totalSecond/total)*100):0}%</span>
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 10 && (() => {
        const byDay: Record<string,number> = {};
        orders.forEach(o => {
          const d = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(o.createdAt as string)) : null;
          if (!d) return;
          const key = d.toISOString().slice(0,10);
          const oR = o as unknown as Record<string,unknown>;
          const total = typeof oR.total==='number' ? oR.total as number
            : (o.lineItems??[]).reduce((s,li)=>{ const lr=li as unknown as Record<string,unknown>; return s+((lr.quantity as number|undefined)??0)*((lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0); },0);
          byDay[key]=(byDay[key]??0)+total;
        });
        const days = Object.keys(byDay).sort().slice(-30);
        if (days.length<7) return null;
        const W=7;
        const rolling = days.map((_,i)=>{ if(i<W-1) return 0; const slice=days.slice(i-W+1,i+1); return slice.reduce((s,d)=>s+byDay[d],0)/W; }).slice(W-1);
        const rollingDays = days.slice(W-1);
        const maxVal = Math.max(...rolling,1);
        const w=240; const h=60; const pad=8;
        const pts = rolling.map((v,i)=>`${pad+(i/(rolling.length-1))*(w-2*pad)},${h-pad-(v/maxVal)*(h-2*pad)}`).join(' ');
        const latestAvg = rolling[rolling.length-1];
        return (
          <div className="apple-card p-4 mb-4">
            <div className="flex justify-between items-center mb-2">
              <h3 className="font-semibold text-sm">7-Day Rolling Revenue Avg</h3>
              <span className="text-xs font-bold text-brand">{fmtAna(latestAvg,'K',1)}/day</span>
            </div>
            <svg width="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{height:60}}>
              <defs><linearGradient id="rollGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#ff4000" stopOpacity="0.25"/><stop offset="100%" stopColor="#ff4000" stopOpacity="0"/></linearGradient></defs>
              <polygon points={`${pad},${h-pad} ${pts} ${pad+(rolling.length-1)/(rolling.length-1)*(w-2*pad)},${h-pad}`} fill="url(#rollGrad)"/>
              <polyline points={pts} fill="none" stroke="#ff4000" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <div className="flex justify-between text-[9px] text-gray-400 mt-1">
              <span>{rollingDays[0]?.slice(5)}</span><span>{rollingDays[rollingDays.length-1]?.slice(5)}</span>
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 5 && (() => {
        const total = orders.length;
        const delivered = orders.filter(o=>o.status==='Delivered').length;
        const cancelled = orders.filter(o=>o.status==='Cancelled').length;
        const inProgress = total-delivered-cancelled;
        const fulfillRate = (total-cancelled)>0 ? Math.round((delivered/(total-cancelled))*100) : 0;
        const cancelRate = total>0 ? Math.round((cancelled/total)*100) : 0;
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">{currentLanguage === 'tr' ? 'Sipariş Karşılama Oranı' : 'Order Fulfillment Rate'}</h3>
            <div className="flex items-center gap-4 mb-3">
              <div className="relative w-20 h-20 flex-shrink-0">
                <svg width="80" height="80" viewBox="0 0 80 80">
                  <circle cx="40" cy="40" r="30" fill="none" stroke="#e5e7eb" strokeWidth="10"/>
                  <circle cx="40" cy="40" r="30" fill="none" stroke="#22c55e" strokeWidth="10"
                    strokeDasharray={`${(fulfillRate/100)*188} 188`} strokeDashoffset="47" strokeLinecap="round"/>
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-lg font-bold text-green-500">{fulfillRate}%</span>
                  <span className="text-[8px] text-gray-400">fulfilled</span>
                </div>
              </div>
              <div className="flex-1 space-y-1.5 text-xs">
                <div className="flex justify-between"><span className="text-gray-500">Total Orders</span><span className="font-bold">{total}</span></div>
                <div className="flex justify-between"><span className="text-green-600">Delivered</span><span className="font-bold text-green-600">{delivered}</span></div>
                <div className="flex justify-between"><span className="text-blue-500">In Progress</span><span className="font-bold text-blue-500">{inProgress}</span></div>
                <div className="flex justify-between"><span className="text-red-500">Cancelled ({cancelRate}%)</span><span className="font-bold text-red-500">{cancelled}</span></div>
              </div>
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 5 && inventory.length >= 3 && (() => {
        // Map products to categories via inventory
        const productCategory: Record<string,string> = {};
        inventory.forEach(item=>{ productCategory[item.name]=(item.category??'Other'); if(item.id) productCategory[item.id]=(item.category??'Other'); });
        const catMonthRev: Record<string,Record<string,number>> = {};
        orders.forEach(o => {
          const d = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(o.createdAt as string)) : null;
          if (!d) return;
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          (o.lineItems??[]).forEach(li=>{ const lr=li as unknown as Record<string,unknown>; const name=(lr.productName as string|undefined)??(lr.name as string|undefined)??''; const pid=(lr.productId as string|undefined)??''; const cat=productCategory[pid]??productCategory[name]??'Other'; const rev=((lr.quantity as number|undefined)??0)*((lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0); if (!catMonthRev[cat]) catMonthRev[cat]={}; catMonthRev[cat][key]=(catMonthRev[cat][key]??0)+rev; });
        });
        const topCats = Object.entries(catMonthRev).sort((a,b)=>Object.values(b[1]).reduce((x,y)=>x+y,0)-Object.values(a[1]).reduce((x,y)=>x+y,0)).slice(0,3);
        const allMonths = [...new Set(Object.values(catMonthRev).flatMap(m=>Object.keys(m)))].sort().slice(-5);
        if (topCats.length<2||allMonths.length<2) return null;
        const palette=['#ff4000','#3b82f6','#22c55e'];
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">{currentLanguage === 'tr' ? 'En İyi Kategori Ciro Eğilimi' : 'Top Category Revenue Trend'}</h3>
            <div className="space-y-2">
              {topCats.map(([cat,monthMap],ci)=>{
                const vals=allMonths.map(m=>monthMap[m]??0);
                const maxV=Math.max(...vals,1);
                return (
                  <div key={cat}>
                    <div className="flex items-center gap-1.5 mb-1">
                      <div className="w-2 h-2 rounded-full" style={{background:palette[ci]}}/>
                      <span className="text-[10px] text-gray-600">{cat}</span>
                    </div>
                    <div className="flex items-end gap-1 h-8">
                      {vals.map((v,i)=><div key={i} className="flex-1 rounded-sm" style={{height:`${(v/maxV)*28}px`,background:palette[ci],opacity:0.7+(i/(vals.length-1))*0.3,minHeight:v>0?2:0}}/>)}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex gap-0.5 mt-1">{allMonths.map(m=><span key={m} className="flex-1 text-center text-[8px] text-gray-400">{m.slice(5)}</span>)}</div>
          </div>
        );
      })()}


      {reportsTab === 'genel' && orders.length >= 5 && (() => {
        const now = new Date();
        const periods = [{label:'7d',days:7},{label:'30d',days:30},{label:'90d',days:90},{label:'365d',days:365}];
        const results = periods.map(p=>{
          const since=new Date(now.getTime()-p.days*86400000);
          const rev=orders.reduce((s,o)=>{
            const d=o.createdAt?((o.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(o.createdAt as string)):null;
            if(!d||d<since) return s;
            const oR=o as unknown as Record<string,unknown>;
            return s+(typeof oR.total==='number'?oR.total as number:(o.lineItems??[]).reduce((s2,li)=>{ const lr=li as unknown as Record<string,unknown>; return s2+((lr.quantity as number|undefined)??0)*((lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0); },0));
          },0);
          return {...p,rev,velocity:rev/p.days};
        });
        const maxV=Math.max(...results.map(r=>r.velocity),1);
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">Revenue Velocity (₺/day)</h3>
            <div className="space-y-2">
              {results.map(r=>(
                <div key={r.label} className="flex items-center gap-2">
                  <span className="text-xs w-10 text-gray-600">{r.label}</span>
                  <div className="flex-1 bg-gray-100 rounded-full h-5 overflow-hidden">
                    <div className="h-full rounded-full flex items-center pl-2" style={{width:`${(r.velocity/maxV)*100}%`,background:'#ff4000',minWidth:r.velocity>0?24:0}}>
                      <span className="text-white text-[9px] font-bold">{fmtAna(r.velocity,'K',1)}</span>
                    </div>
                  </div>
                  <span className="text-[9px] text-gray-400 w-14 text-right">{fmtAna(r.rev,'K',0)} tot</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 3 && (() => {
        const now=new Date();
        const monthStart=new Date(now.getFullYear(),now.getMonth(),1);
        const productRev: Record<string,number>={};
        orders.forEach(o=>{
          const d=o.createdAt?((o.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(o.createdAt as string)):null;
          if(!d||d<monthStart) return;
          (o.lineItems??[]).forEach(li=>{ const lr=li as unknown as Record<string,unknown>; const name=(lr.productName as string|undefined)??(lr.name as string|undefined)??'Unknown'; const rev=((lr.quantity as number|undefined)??0)*((lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0); productRev[name]=(productRev[name]??0)+rev; });
        });
        const top5=Object.entries(productRev).sort((a,b)=>b[1]-a[1]).slice(0,5);
        if(top5.length===0) return null;
        const maxRev=top5[0][1];
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">{currentLanguage === 'tr' ? 'Bu Ayın En İyi Ürünleri' : 'Top Products This Month'}</h3>
            <div className="space-y-2">
              {top5.map(([name,rev],i)=>(
                <div key={name} className="flex items-center gap-2">
                  <span className="text-xs font-bold text-gray-400 w-4">#{i+1}</span>
                  <span className="text-xs truncate flex-1 text-gray-700">{name}</span>
                  <div className="w-16 bg-gray-100 rounded-full h-3 overflow-hidden">
                    <div className="h-full rounded-full" style={{width:`${(rev/maxRev)*100}%`,background:i===0?'#ff4000':'#6366f1'}}/>
                  </div>
                  <span className="text-[10px] font-bold text-gray-600 w-10 text-right">{fmtAna(rev,'K',0)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && (() => {
        const now=new Date();
        const d30=new Date(now.getTime()-30*86400000);
        const orders30=orders.filter(o=>{ const d=o.createdAt?((o.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(o.createdAt as string)):null; return d&&d>=d30; }).length;
        const lowStockCount=inventory.filter(i=>{ const stk=(i.stock as number|undefined)??0; const threshold=(i.reorderPoint as number|undefined)??(i.lowStockThreshold as number|undefined)??5; return stk<=threshold&&stk>0; }).length;
        const activeOrders=orders.filter(o=>o.status==='Processing'||o.status==='Pending'||o.status==='Shipped').length;
        const stats=[
          {label:'Orders (30d)',val:String(orders30),icon:'📦',color:'#3b82f6'},
          {label:'Active Orders',val:String(activeOrders),icon:'⚙️',color:'#f59e0b'},
          {label:'SKUs',val:String(inventory.length),icon:'🗃️',color:'#22c55e'},
          {label:'Low Stock',val:String(lowStockCount),icon:'⚠️',color:lowStockCount>0?'#ef4444':'#22c55e'},
          {label:'Employees',val:String(employees.length),icon:'👥',color:'#8b5cf6'},
          {label:'Quotes',val:String(quotations.length),icon:'📋',color:'#0ea5e9'},
        ];
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">{currentLanguage === 'tr' ? 'Modüller Arası Genel Bakış' : 'Cross-Module Overview'}</h3>
            <div className="grid grid-cols-3 gap-2">
              {stats.map(s=>(
                <div key={s.label} className="rounded-xl p-2 text-center" style={{background:`${s.color}10`}}>
                  <p className="text-sm">{s.icon}</p>
                  <p className="text-xl font-bold" style={{color:s.color}}>{s.val}</p>
                  <p className="text-[9px] text-gray-400">{s.label}</p>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 5 && (() => {
        const byMonth: Record<string,number>={};
        orders.forEach(o=>{ const d=o.createdAt?((o.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(o.createdAt as string)):null; if(!d) return; const key=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; byMonth[key]=(byMonth[key]??0)+1; });
        const months=Object.keys(byMonth).sort().slice(-10);
        if(months.length<3) return null;
        const vals=months.map(m=>byMonth[m]);
        const maxV=Math.max(...vals,1);
        const trend=vals.length>=2?vals[vals.length-1]-vals[vals.length-2]:0;
        const w=240;const h=60;const pad=8;
        const pts=vals.map((v,i)=>`${pad+(i/(vals.length-1))*(w-2*pad)},${h-pad-(v/maxV)*(h-2*pad)}`).join(' ');
        return (
          <div className="apple-card p-4 mb-4">
            <div className="flex justify-between items-center mb-2">
              <h3 className="font-semibold text-sm">{currentLanguage === 'tr' ? 'Aylık Sipariş Hacmi' : 'Monthly Order Volume'}</h3>
              <span className="text-xs" style={{color:trend>=0?'#22c55e':'#ef4444'}}>{trend>=0?'+':''}{trend} MoM</span>
            </div>
            <svg width="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{height:60}}>
              <defs><linearGradient id="volGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#3b82f6" stopOpacity="0.25"/><stop offset="100%" stopColor="#3b82f6" stopOpacity="0"/></linearGradient></defs>
              <polygon points={`${pad},${h-pad} ${pts} ${pad+(vals.length-1)/(vals.length-1)*(w-2*pad)},${h-pad}`} fill="url(#volGrad)"/>
              <polyline points={pts} fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              {vals.map((v,i)=><circle key={i} cx={pad+(i/(vals.length-1))*(w-2*pad)} cy={h-pad-(v/maxV)*(h-2*pad)} r="2.5" fill="#3b82f6"/>)}
            </svg>
            <div className="flex justify-between text-[9px] text-gray-400 mt-1"><span>{months[0]?.slice(5)}</span><span>{months[months.length-1]?.slice(5)}</span></div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 10 && (() => {
        const byMonth: Record<string,number>={};
        orders.forEach(o=>{ const d=o.createdAt?((o.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(o.createdAt as string)):null; if(!d) return; const key=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; const oR=o as unknown as Record<string,unknown>; const total=typeof oR.total==='number'?oR.total as number:(o.lineItems??[]).reduce((s,li)=>{ const lr=li as unknown as Record<string,unknown>; return s+((lr.quantity as number|undefined)??0)*((lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0); },0); byMonth[key]=(byMonth[key]??0)+total; });
        const months=Object.keys(byMonth).sort().slice(-4);
        if(months.length<3) return null;
        const vals=months.map(m=>byMonth[m]);
        const growthRates=vals.slice(1).map((v,i)=>vals[i]>0?(v-vals[i])/vals[i]:0);
        const avgGrowth=growthRates.reduce((a,b)=>a+b,0)/growthRates.length;
        const lastRev=vals[vals.length-1];
        const now=new Date();
        const forecasts=[1,2,3].map(i=>{ const d=new Date(now.getFullYear(),now.getMonth()+i,1); return { month:`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`, rev:lastRev*Math.pow(1+avgGrowth,i) }; });
        const allVals=[...vals,...forecasts.map(f=>f.rev)];
        const maxV=Math.max(...allVals,1);
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">3-Month Revenue Forecast</h3>
            <div className="flex items-end gap-2 h-24 mb-1">
              {vals.map((v,i)=><div key={i} className="flex-1 flex flex-col items-center gap-0.5"><div className="w-full rounded-sm" style={{height:`${(v/maxV)*72}px`,background:'#ff4000'}}/><span className="text-[9px] text-gray-400">{months[i]?.slice(5)}</span></div>)}
              {forecasts.map((f,i)=><div key={f.month} className="flex-1 flex flex-col items-center gap-0.5"><span className="text-[8px] text-indigo-400">{fmtAna(f.rev,'K',0)}</span><div className="w-full rounded-sm border-2 border-dashed border-indigo-300" style={{height:`${(f.rev/maxV)*72}px`,background:`rgba(99,102,241,${0.15+i*0.1})`}}/><span className="text-[9px] text-indigo-400">{f.month.slice(5)}</span></div>)}
            </div>
            <p className="text-[10px] text-gray-400 text-center">Based on {(avgGrowth*100).toFixed(1)}% avg monthly growth</p>
          </div>
        );
      })()}

      {reportsTab === 'genel' && (() => {
        const totalOrders=orders.length;
        const totalInventory=inventory.length;
        const totalEmployees=employees.length;
        const totalQuotations=quotations.length;
        return (
          <div className="apple-card p-4 mb-4 overflow-hidden relative">
            <div className="absolute inset-0 opacity-5" style={{background:'repeating-linear-gradient(45deg,#ff4000,#ff4000 10px,transparent 10px,transparent 20px)'}}/>
            <div className="relative">
              <div className="text-center mb-3">
                <p className="text-4xl mb-1">🏆</p>
                <h3 className="font-bold text-base text-brand">500 Analytics Phases</h3>
                <p className="text-xs text-gray-500">Complete ERP Intelligence Dashboard</p>
              </div>
              <div className="grid grid-cols-2 gap-2 mb-3">
                {[{label:'Orders',val:totalOrders,icon:'📦'},{label:'SKUs',val:totalInventory,icon:'🗃️'},{label:'Employees',val:totalEmployees,icon:'👥'},{label:'Quotations',val:totalQuotations,icon:'📋'}].map(m=>(
                  <div key={m.label} className="rounded-xl p-2 bg-white/60 text-center">
                    <p className="text-sm">{m.icon}</p>
                    <p className="text-xl font-bold text-brand">{m.val}</p>
                    <p className="text-[9px] text-gray-500">{m.label}</p>
                  </div>
                ))}
              </div>
              <div className="text-center">
                <p className="text-[10px] text-gray-400">Covering General · CRM · Inventory · Logistics · HR</p>
                <p className="text-[10px] text-gray-300 mt-0.5">Cetpa B2B Analytics Engine v2026</p>
              </div>
            </div>
          </div>
        );
      })()}
    </>
  );
}
