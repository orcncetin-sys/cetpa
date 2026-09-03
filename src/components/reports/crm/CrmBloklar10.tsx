/**
 * CrmBloklar10.tsx — CrmRapor bölmesi (2026-09-03)
 *
 * CrmRapor.tsx'ten mekanik olarak çıkarıldı (bölme öncesi satır 3001–3582, 16 blok).
 * Bloklar ORİJİNAL SIRASIYLA ve içeriği DEĞİŞTİRİLMEDEN taşındı; bloklardaki
 * `reportsTab === 'crm'` koşulları BİLEREK korundu (bkz. CrmRapor.tsx başlık
 * notu — ebeveyn zaten sekmeye göre render ediyor, koşulu silmek "saf kopya"
 * güvencesini bozardı).
 * Props yalnız bu dosyanın gerçekten kullandığı ctx alanlarıdır
 * (tsc "Cannot find name" listesinden çıkarıldı).
 */
import type { ReportsCtx } from '../useReportsData';

type Props = Pick<ReportsCtx, 'reportsTab' | 'orders' | 'quotations' | 'inventory' | 'currentLanguage' | 'fmtAna'>;

export default function CrmBloklar10({ reportsTab, orders, quotations, inventory, currentLanguage, fmtAna }: Props) {
  return (
    <>
      {reportsTab === 'crm' && orders.length >= 5 && (() => {
        const now = new Date();
        const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const thisMonthCustomers = new Set<string>();
        const allTimeCustomers = new Set<string>();
        orders.forEach(o => {
          const d = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string)) : null;
          const cid = (o as unknown as Record<string,unknown>).customerId as string | undefined
            || (o as unknown as Record<string,unknown>).customerName as string | undefined
            || 'Unknown';
          if (d && d < thisMonthStart) allTimeCustomers.add(cid);
          if (d && d >= thisMonthStart) thisMonthCustomers.add(cid);
        });
        const returning = [...thisMonthCustomers].filter(c => allTimeCustomers.has(c)).length;
        const newCust = thisMonthCustomers.size - returning;
        const total = thisMonthCustomers.size;
        if (total === 0) return null;
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">New vs Returning (This Month)</h3>
            <div className="flex h-5 rounded-full overflow-hidden mb-3">
              <div style={{width: `${(newCust/total)*100}%`, background: '#ff4000'}} />
              <div style={{width: `${(returning/total)*100}%`, background: '#3b82f6'}} />
            </div>
            <div className="grid grid-cols-2 gap-3 text-center">
              {[{label:'New', count: newCust, color:'#ff4000'},{label:'Returning', count: returning, color:'#3b82f6'}].map(s => (
                <div key={s.label} className="rounded-xl p-2" style={{background: `${s.color}12`}}>
                  <p className="text-2xl font-bold" style={{color: s.color}}>{s.count}</p>
                  <p className="text-[10px] text-gray-500">{s.label} ({total > 0 ? Math.round((s.count/total)*100) : 0}%)</p>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 3 && quotations.length >= 2 && (() => {
        const ordersByMonth: Record<string, number> = {};
        const quotesByMonth: Record<string, number> = {};
        orders.forEach(o => {
          const d = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string)) : null;
          if (!d) return;
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          ordersByMonth[key] = (ordersByMonth[key] ?? 0) + 1;
        });
        quotations.forEach(q => {
          const d = q.createdAt ? ((q.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(q.createdAt as string)) : null;
          if (!d) return;
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          quotesByMonth[key] = (quotesByMonth[key] ?? 0) + 1;
        });
        const allMonths = [...new Set([...Object.keys(ordersByMonth), ...Object.keys(quotesByMonth)])].sort().slice(-6);
        if (allMonths.length < 2) return null;
        const maxVal = Math.max(...allMonths.map(m => Math.max(ordersByMonth[m]??0, quotesByMonth[m]??0)), 1);
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">{currentLanguage === 'tr' ? 'Aya Göre Sipariş ve Teklifler' : 'Orders vs Quotations by Month'}</h3>
            <div className="flex items-end gap-2 h-24 mb-1">
              {allMonths.map(m => (
                <div key={m} className="flex-1 flex items-end gap-0.5">
                  <div className="flex-1 rounded-sm" style={{height: `${((ordersByMonth[m]??0)/maxVal)*72}px`, background: '#ff4000', minHeight: (ordersByMonth[m]??0) > 0 ? 2 : 0}} />
                  <div className="flex-1 rounded-sm" style={{height: `${((quotesByMonth[m]??0)/maxVal)*72}px`, background: '#3b82f680', minHeight: (quotesByMonth[m]??0) > 0 ? 2 : 0}} />
                </div>
              ))}
            </div>
            <div className="flex gap-1 mb-1">
              {allMonths.map(m => <span key={m} className="flex-1 text-center text-[9px] text-gray-400">{m.slice(5)}</span>)}
            </div>
            <div className="flex gap-3 justify-center text-[10px]">
              <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-brand" /><span className="text-gray-500">Orders</span></div>
              <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-blue-400" /><span className="text-gray-500">Quotes</span></div>
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 5 && (() => {
        const custOrderCount: Record<string, number> = {};
        orders.forEach(o => {
          const cid = (o as unknown as Record<string,unknown>).customerId as string|undefined
            || (o as unknown as Record<string,unknown>).customerName as string|undefined || 'Unknown';
          custOrderCount[cid] = (custOrderCount[cid] ?? 0) + 1;
        });
        const total = Object.keys(custOrderCount).length;
        const repeating = Object.values(custOrderCount).filter(c => c > 1).length;
        const rate = total > 0 ? Math.round((repeating / total) * 100) : 0;
        const avgOrdersPerRepeat = repeating > 0
          ? (Object.values(custOrderCount).filter(c=>c>1).reduce((a,b)=>a+b,0)/repeating).toFixed(1)
          : '0';
        // Monthly repeat rate trend
        const monthSeen: Record<string, Set<string>> = {};
        const monthRepeat: Record<string, number> = {};
        const custFirstMonth: Record<string, string> = {};
        [...orders].sort((a,b)=>{
          const da = a.createdAt ? ((a.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(a.createdAt as string)) : new Date(0);
          const db = b.createdAt ? ((b.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(b.createdAt as string)) : new Date(0);
          return da.getTime()-db.getTime();
        }).forEach(o => {
          const d = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(o.createdAt as string)) : null;
          if (!d) return;
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          const cid = (o as unknown as Record<string,unknown>).customerId as string|undefined || (o as unknown as Record<string,unknown>).customerName as string|undefined || 'Unknown';
          if (!custFirstMonth[cid]) custFirstMonth[cid] = key;
          if (!monthSeen[key]) { monthSeen[key] = new Set(); monthRepeat[key] = 0; }
          if (custFirstMonth[cid] < key) monthRepeat[key]++;
          monthSeen[key].add(cid);
        });
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">{currentLanguage === 'tr' ? 'Tekrar Satın Alma Oranı' : 'Repeat Purchase Rate'}</h3>
            <div className="flex items-center gap-4 mb-3">
              <div className="text-center">
                <p className="text-3xl font-bold text-brand">{rate}%</p>
                <p className="text-[10px] text-gray-500">of customers repeat</p>
              </div>
              <div className="flex-1">
                <div className="bg-gray-100 rounded-full h-4 overflow-hidden mb-1">
                  <div className="h-full rounded-full bg-brand transition-all" style={{width:`${rate}%`}} />
                </div>
                <p className="text-xs text-gray-500">{repeating}/{total} customers • avg {avgOrdersPerRepeat} orders</p>
              </div>
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 5 && (() => {
        const segmentData: Record<string, {count: number; revenue: number}> = {};
        orders.forEach(o => {
          const oR = o as unknown as Record<string,unknown>;
          const segment = (oR.customerType as string|undefined) ?? (oR.segment as string|undefined)
            ?? (oR.type as string|undefined) ?? 'Standard';
          const total = typeof oR.total === 'number' ? oR.total as number
            : (o.lineItems ?? []).reduce((s, li) => { const lr = li as unknown as Record<string,unknown>; return s + ((lr.quantity as number|undefined)??0)*((lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0); }, 0);
          if (!segmentData[segment]) segmentData[segment] = {count: 0, revenue: 0};
          segmentData[segment].count++;
          segmentData[segment].revenue += total;
        });
        const rows = Object.entries(segmentData).sort((a,b)=>b[1].revenue-a[1].revenue);
        if (rows.length <= 1) {
          // Single segment — show order size distribution instead
          const sizes = orders.map(o => (o.lineItems??[]).length).filter(n=>n>0);
          const avg = sizes.length > 0 ? (sizes.reduce((a,b)=>a+b,0)/sizes.length).toFixed(1) : '0';
          return (
            <div className="apple-card p-4 mb-4">
              <h3 className="font-semibold text-sm mb-1">{currentLanguage === 'tr' ? 'Sipariş Büyüklüğü Özeti' : 'Order Size Summary'}</h3>
              <p className="text-3xl font-bold text-brand">{avg}</p>
              <p className="text-xs text-gray-500">avg line items per order ({orders.length} orders)</p>
            </div>
          );
        }
        const totalRev = rows.reduce((s,[,d])=>s+d.revenue,0);
        const palette = ['#ff4000','#3b82f6','#22c55e','#f59e0b','#8b5cf6'];
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">{currentLanguage === 'tr' ? 'Müşteri Segmentine Göre Ciro' : 'Revenue by Customer Segment'}</h3>
            <div className="flex h-4 rounded-full overflow-hidden mb-3">
              {rows.map(([seg,d],i)=><div key={seg} style={{width:`${(d.revenue/totalRev)*100}%`,background:palette[i]}} title={seg} />)}
            </div>
            <div className="space-y-1">
              {rows.map(([seg,d],i) => (
                <div key={seg} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-full" style={{background:palette[i]}} />
                    <span className="text-gray-600">{seg}</span>
                  </div>
                  <span className="font-bold">{d.count} <span className="font-normal text-gray-400">({totalRev>0?Math.round((d.revenue/totalRev)*100):0}%)</span></span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && quotations.length >= 1 && (() => {
        const active = quotations.filter(q => {
          const s = ((q as unknown as Record<string,unknown>).status as string|undefined) ?? '';
          return !['Rejected','Expired','Converted','Cancelled'].includes(s);
        });
        const totalValue = active.reduce((s, q) => {
          const qR = q as unknown as Record<string,unknown>;
          const val = (qR.totalAmount as number|undefined) ?? (qR.total as number|undefined) ?? 0;
          return s + val;
        }, 0);
        const byStatus: Record<string,number> = {};
        quotations.forEach(q => {
          const s = ((q as unknown as Record<string,unknown>).status as string|undefined) ?? 'Draft';
          byStatus[s] = (byStatus[s]??0)+1;
        });
        const statusRows = Object.entries(byStatus).sort((a,b)=>b[1]-a[1]);
        const statusColors: Record<string,string> = {'Draft':'#94a3b8','Sent':'#3b82f6','Pending':'#f59e0b','Approved':'#22c55e','Rejected':'#ef4444','Converted':'#8b5cf6','Expired':'#6b7280'};
        return (
          <div className="apple-card p-4 mb-4">
            <div className="flex justify-between items-center mb-3">
              <h3 className="font-semibold text-sm">{currentLanguage === 'tr' ? 'Teklif Hattı' : 'Quotation Pipeline'}</h3>
              <span className="text-xs bg-blue-100 text-blue-700 rounded-full px-2 py-0.5">{active.length} active • {fmtAna(totalValue,'K',0)}</span>
            </div>
            <div className="grid grid-cols-2 gap-1">
              {statusRows.map(([s,n]) => (
                <div key={s} className="flex items-center gap-1.5 text-xs">
                  <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{background:statusColors[s]??'#6b7280'}} />
                  <span className="text-gray-600 truncate">{s}</span>
                  <span className="ml-auto font-bold">{n}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && quotations.length >= 3 && (() => {
        const byMonth: Record<string,{count:number;value:number}> = {};
        quotations.forEach(q => {
          const d = q.createdAt ? ((q.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(q.createdAt as string)) : null;
          if (!d) return;
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          if (!byMonth[key]) byMonth[key]={count:0,value:0};
          byMonth[key].count++;
          const qR = q as unknown as Record<string,unknown>;
          byMonth[key].value += (qR.totalAmount as number|undefined)??(qR.total as number|undefined)??0;
        });
        const months = Object.keys(byMonth).sort().slice(-6);
        if (months.length < 2) return null;
        const maxVal = Math.max(...months.map(m=>byMonth[m].value),1);
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">{currentLanguage === 'tr' ? 'Aya Göre Teklif Adedi ve Tutarı' : 'Quotation Volume & Value by Month'}</h3>
            <div className="flex items-end gap-2 h-20 mb-1">
              {months.map(m=>(
                <div key={m} className="flex-1 flex flex-col items-center gap-0.5">
                  <div className="w-full rounded-sm" style={{height:`${(byMonth[m].value/maxVal)*56}px`,background:'#3b82f6',minHeight:byMonth[m].value>0?2:0}} />
                  <span className="text-[9px] text-gray-400">{m.slice(5)}</span>
                </div>
              ))}
            </div>
            <div className="flex justify-between text-xs text-gray-500 mt-1">
              <span>Total: {quotations.length} quotes</span>
              <span>Avg: {quotations.length>0?(quotations.length/months.length).toFixed(0):0}/mo</span>
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 10 && (() => {
        const custMonthOrders: Record<string,Record<string,number>> = {};
        orders.forEach(o => {
          const d = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(o.createdAt as string)) : null;
          if (!d) return;
          const cid = (o as unknown as Record<string,unknown>).customerName as string|undefined || (o as unknown as Record<string,unknown>).customerId as string|undefined || 'Unknown';
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          if (!custMonthOrders[cid]) custMonthOrders[cid]={};
          custMonthOrders[cid][key]=(custMonthOrders[cid][key]??0)+1;
        });
        const topCusts = Object.entries(custMonthOrders).sort((a,b)=>Object.values(b[1]).reduce((x,y)=>x+y,0)-Object.values(a[1]).reduce((x,y)=>x+y,0)).slice(0,5);
        const allMonths = [...new Set(orders.map(o=>{const d=o.createdAt?((o.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(o.createdAt as string)):null;if(!d)return '';return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;}).filter(Boolean))].sort().slice(-5);
        if (topCusts.length < 2 || allMonths.length < 2) return null;
        const maxOrders = Math.max(...topCusts.flatMap(([,m])=>Object.values(m)),1);
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">{currentLanguage === 'tr' ? 'En İyi Müşteri Sipariş Sıklığı' : 'Top Customer Order Frequency'}</h3>
            <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr>
                  <th className="text-left text-gray-400 font-normal pb-1 pr-2 w-24">Customer</th>
                  {allMonths.map(m=><th key={m} className="text-gray-400 font-normal pb-1 px-0.5">{m.slice(5)}</th>)}
                </tr>
              </thead>
              <tbody>
                {topCusts.map(([cid,monthMap])=>(
                  <tr key={cid}>
                    <td className="text-gray-600 truncate pr-2 py-0.5 max-w-[6rem]">{cid}</td>
                    {allMonths.map(m=>{
                      const n=monthMap[m]??0;
                      const intensity=n/maxOrders;
                      return <td key={m} className="px-0.5 py-0.5"><div className="rounded h-5 w-full flex items-center justify-center text-[9px] font-medium" style={{background:n>0?`rgba(255,64,0,${0.15+intensity*0.85})`:'#f3f4f6',color:intensity>0.5?'white':'#374151'}}>{n>0?n:''}</div></td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 5 && (() => {
        const byMonth: Record<string,{qty:number;lines:number;orders:number}> = {};
        orders.forEach(o => {
          const d = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(o.createdAt as string)) : null;
          if (!d) return;
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          if (!byMonth[key]) byMonth[key]={qty:0,lines:0,orders:0};
          byMonth[key].orders++;
          (o.lineItems??[]).forEach(li=>{ const lr=li as unknown as Record<string,unknown>; byMonth[key].qty+=((lr.quantity as number|undefined)??1); byMonth[key].lines++; });
        });
        const months = Object.keys(byMonth).sort().slice(-6);
        if (months.length < 2) return null;
        const rows = months.map(m=>({month:m.slice(5),avgQty:byMonth[m].orders>0?byMonth[m].qty/byMonth[m].orders:0,avgLines:byMonth[m].orders>0?byMonth[m].lines/byMonth[m].orders:0}));
        const maxVal = Math.max(...rows.map(r=>r.avgQty),1);
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">{currentLanguage === 'tr' ? 'Sipariş Başına Ortalama Kalem' : 'Avg Items per Order'}</h3>
            <div className="flex items-end gap-2 h-20 mb-1">
              {rows.map(r=>(
                <div key={r.month} className="flex-1 flex flex-col items-center gap-0.5">
                  <span className="text-[9px] text-gray-500">{r.avgQty.toFixed(1)}</span>
                  <div className="w-full rounded-sm" style={{height:`${(r.avgQty/maxVal)*56}px`,background:'#f59e0b',minHeight:r.avgQty>0?2:0}} />
                  <span className="text-[9px] text-gray-400">{r.month}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 5 && (() => {
        const custLTV: Record<string,{revenue:number;orders:number;firstOrder:Date|null;lastOrder:Date|null}> = {};
        orders.forEach(o => {
          const d = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(o.createdAt as string)) : null;
          const cid = (o as unknown as Record<string,unknown>).customerName as string|undefined || (o as unknown as Record<string,unknown>).customerId as string|undefined || 'Unknown';
          const oR = o as unknown as Record<string,unknown>;
          const total = typeof oR.total==='number' ? oR.total as number
            : (o.lineItems??[]).reduce((s,li)=>{ const lr=li as unknown as Record<string,unknown>; return s+((lr.quantity as number|undefined)??0)*((lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0); },0);
          if (!custLTV[cid]) custLTV[cid]={revenue:0,orders:0,firstOrder:null,lastOrder:null};
          custLTV[cid].revenue+=total;
          custLTV[cid].orders++;
          if (d) { if (!custLTV[cid].firstOrder||d<custLTV[cid].firstOrder!) custLTV[cid].firstOrder=d; if (!custLTV[cid].lastOrder||d>custLTV[cid].lastOrder!) custLTV[cid].lastOrder=d; }
        });
        const top10 = Object.entries(custLTV).sort((a,b)=>b[1].revenue-a[1].revenue).slice(0,8);
        if (top10.length<2) return null;
        const maxRev = top10[0][1].revenue;
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">{currentLanguage === 'tr' ? 'Yaşam Boyu Değere Göre En İyi Müşteriler' : 'Top Customers by Lifetime Value'}</h3>
            <div className="space-y-2">
              {top10.map(([name,d],i)=>(
                <div key={name} className="flex items-center gap-2">
                  <span className="text-xs font-bold text-gray-400 w-4">#{i+1}</span>
                  <span className="text-xs truncate flex-1 text-gray-700">{name}</span>
                  <div className="w-16 bg-gray-100 rounded-full h-3 overflow-hidden">
                    <div className="h-full rounded-full" style={{width:`${(d.revenue/maxRev)*100}%`,background:i===0?'#ff4000':i<=2?'#f59e0b':'#6366f1'}} />
                  </div>
                  <span className="text-[10px] font-bold text-gray-600 w-12 text-right">{fmtAna(d.revenue,'K',0)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 5 && (() => {
        const pairs: Record<string,number> = {};
        orders.forEach(o => {
          const names = (o.lineItems??[]).map(li=>{ const lr=li as unknown as Record<string,unknown>; return (lr.productName as string|undefined)??(lr.name as string|undefined)??''; }).filter(Boolean);
          if (names.length<2) return;
          for (let i=0;i<names.length;i++) for (let j=i+1;j<names.length;j++) {
            const key = [names[i],names[j]].sort().join(' + ');
            pairs[key]=(pairs[key]??0)+1;
          }
        });
        const topPairs = Object.entries(pairs).filter(([,n])=>n>=2).sort((a,b)=>b[1]-a[1]).slice(0,5);
        if (topPairs.length===0) return null;
        const maxCount = topPairs[0][1];
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">{currentLanguage === 'tr' ? 'Birlikte Sıkça Sipariş Edilen Ürünler' : 'Frequently Co-Ordered Products'}</h3>
            <div className="space-y-2">
              {topPairs.map(([pair,count])=>(
                <div key={pair} className="flex items-center gap-2">
                  <span className="text-xs truncate flex-1 text-gray-700">{pair}</span>
                  <div className="w-12 bg-gray-100 rounded-full h-3 overflow-hidden">
                    <div className="h-full rounded-full" style={{width:`${(count/maxCount)*100}%`,background:'#8b5cf6'}} />
                  </div>
                  <span className="text-xs font-bold text-purple-600 w-4 text-right">{count}×</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 5 && (() => {
        let grossRev=0, cancelledRev=0;
        const byMonth: Record<string,{gross:number;net:number}> = {};
        orders.forEach(o => {
          const d = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(o.createdAt as string)) : null;
          const oR = o as unknown as Record<string,unknown>;
          const total = typeof oR.total==='number' ? oR.total as number
            : (o.lineItems??[]).reduce((s,li)=>{ const lr=li as unknown as Record<string,unknown>; return s+((lr.quantity as number|undefined)??0)*((lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0); },0);
          grossRev+=total;
          if (o.status==='Cancelled') cancelledRev+=total;
          if (d) {
            const key=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
            if (!byMonth[key]) byMonth[key]={gross:0,net:0};
            byMonth[key].gross+=total;
            if (o.status!=='Cancelled') byMonth[key].net+=total;
          }
        });
        const netRev = grossRev-cancelledRev;
        const months = Object.keys(byMonth).sort().slice(-5);
        if (months.length<2) return null;
        const maxNet = Math.max(...months.map(m=>byMonth[m].net),1);
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-2">Net Revenue (excl. cancelled)</h3>
            <div className="flex items-center justify-between mb-3">
              <div><p className="text-2xl font-bold text-brand">{fmtAna(netRev,'K',1)}</p><p className="text-[10px] text-gray-400">net all-time</p></div>
              {cancelledRev>0&&<div className="text-right"><p className="text-sm font-bold text-red-500">-{fmtAna(cancelledRev,'K',1)}</p><p className="text-[10px] text-gray-400">from cancellations</p></div>}
            </div>
            <div className="flex items-end gap-2 h-16">
              {months.map(m=><div key={m} className="flex-1 flex flex-col items-center gap-0.5">
                <div className="w-full rounded-sm" style={{height:`${(byMonth[m].net/maxNet)*48}px`,background:'#22c55e',minHeight:byMonth[m].net>0?2:0}}/>
                <span className="text-[9px] text-gray-400">{m.slice(5)}</span>
              </div>)}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 10 && (() => {
        const dayCount: Record<string,number> = {};
        orders.forEach(o => {
          const d = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(o.createdAt as string)) : null;
          if (!d) return;
          const key = d.toISOString().slice(0,10);
          dayCount[key]=(dayCount[key]??0)+1;
        });
        const days = Object.keys(dayCount).sort().slice(-35);
        if (days.length<7) return null;
        const maxCount = Math.max(...days.map(d=>dayCount[d]),1);
        // 7 columns (Mon-Sun), up to 5 rows
        const firstDow = (new Date(days[0]).getDay()+6)%7;
        const grid: {day:string;count:number}[][] = [];
        let week: {day:string;count:number}[] = Array.from({length:firstDow},()=>({day:'',count:0}));
        days.forEach(d=>{
          week.push({day:d,count:dayCount[d]});
          if (week.length===7) { grid.push(week); week=[]; }
        });
        if (week.length>0) { while(week.length<7) week.push({day:'',count:0}); grid.push(week); }
        const dowLabels=['M','T','W','T','F','S','S'];
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">{currentLanguage === 'tr' ? 'Sipariş Hareket Takvimi' : 'Order Activity Calendar'}</h3>
            <div className="flex gap-0.5 mb-1">{dowLabels.map((l,i)=><span key={i} className="flex-1 text-center text-[9px] text-gray-400">{l}</span>)}</div>
            <div className="space-y-0.5">
              {grid.map((week,wi)=>(
                <div key={wi} className="flex gap-0.5">
                  {week.map((cell,di)=>(
                    <div key={di} className="flex-1 aspect-square rounded-sm" style={{background:cell.count>0?`rgba(255,64,0,${0.1+(cell.count/maxCount)*0.9})`:'#f3f4f6'}} title={cell.day?`${cell.day}: ${cell.count} orders`:''} />
                  ))}
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 5 && (() => {
        const custFirstMonth: Record<string,string> = {};
        [...orders].sort((a,b)=>{
          const da=a.createdAt?((a.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(a.createdAt as string)):new Date(0);
          const db=b.createdAt?((b.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(b.createdAt as string)):new Date(0);
          return da.getTime()-db.getTime();
        }).forEach(o=>{
          const d=o.createdAt?((o.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(o.createdAt as string)):null;
          if(!d) return;
          const cid=(o as unknown as Record<string,unknown>).customerId as string|undefined||(o as unknown as Record<string,unknown>).customerName as string|undefined||'Unknown';
          const key=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          if(!custFirstMonth[cid]) custFirstMonth[cid]=key;
        });
        const newByMonth: Record<string,number>={};
        Object.values(custFirstMonth).forEach(m=>{ newByMonth[m]=(newByMonth[m]??0)+1; });
        const months=Object.keys(newByMonth).sort().slice(-8);
        if(months.length<3) return null;
        const vals=months.map(m=>newByMonth[m]);
        const maxV=Math.max(...vals,1);
        const totalNew=vals.reduce((a,b)=>a+b,0);
        return (
          <div className="apple-card p-4 mb-4">
            <div className="flex justify-between items-center mb-3">
              <h3 className="font-semibold text-sm">{currentLanguage === 'tr' ? 'Yeni Müşteri Kazanımı' : 'New Customer Acquisition'}</h3>
              <span className="text-xs bg-green-100 text-green-700 rounded-full px-2 py-0.5">{totalNew} total</span>
            </div>
            <div className="flex items-end gap-2 h-20 mb-1">
              {vals.map((v,i)=>(
                <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                  <span className="text-[9px] text-gray-500">{v}</span>
                  <div className="w-full rounded-sm" style={{height:`${(v/maxV)*56}px`,background:'#22c55e',minHeight:v>0?2:0}}/>
                  <span className="text-[9px] text-gray-400">{months[i]?.slice(5)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && quotations.length >= 2 && inventory.length >= 3 && (() => {
        const quotedProductNames = new Set<string>();
        quotations.forEach(q=>{ (q as unknown as Record<string,unknown>); const items=((q as unknown as Record<string,unknown>).items as {productName?:string;name?:string}[]|undefined)??[]; items.forEach(i=>{ const n=i.productName??i.name; if(n) quotedProductNames.add(n); }); });
        const neverQuoted=inventory.filter(item=>!quotedProductNames.has(item.name)&&((item.stock as number|undefined)??0)>0).slice(0,6);
        if(neverQuoted.length===0) return null;
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
              <span>💤 Products Never Quoted</span>
              <span className="text-xs bg-gray-100 text-gray-600 rounded-full px-2 py-0.5">{neverQuoted.length} shown</span>
            </h3>
            <div className="space-y-1.5">
              {neverQuoted.map((item,i)=>(
                <div key={i} className="flex items-center justify-between text-xs">
                  <span className="truncate flex-1 text-gray-700">{item.name}</span>
                  <span className="text-gray-400 ml-2">×{(item.stock as number|undefined)??0}</span>
                  <span className="text-gray-500 ml-2">{(item.prices?.['Retail'] as number|undefined) != null ? fmtAna((item.prices?.['Retail'] as number)) : '—'}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 8 && (() => {
        const now=new Date();
        const custLastOrder: Record<string,Date>={};
        const custOrders: Record<string,{date:Date;gap:number}[]>={};
        [...orders].sort((a,b)=>{ const da=a.createdAt?((a.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(a.createdAt as string)):new Date(0); const db=b.createdAt?((b.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(b.createdAt as string)):new Date(0); return da.getTime()-db.getTime(); }).forEach(o=>{
          const d=o.createdAt?((o.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(o.createdAt as string)):null; if(!d) return;
          const cid=(o as unknown as Record<string,unknown>).customerName as string|undefined||(o as unknown as Record<string,unknown>).customerId as string|undefined||'Unknown';
          const prev=custLastOrder[cid];
          const gap=prev?Math.floor((d.getTime()-prev.getTime())/86400000):0;
          if(!custOrders[cid]) custOrders[cid]=[];
          if(prev&&gap>=60) custOrders[cid].push({date:d,gap});
          custLastOrder[cid]=d;
        });
        const reEngaged=Object.entries(custOrders).filter(([,arr])=>arr.length>0&&arr[arr.length-1].date>new Date(now.getTime()-90*86400000)).length;
        const totalReEngagements=Object.values(custOrders).reduce((s,arr)=>s+arr.length,0);
        if(totalReEngagements===0) return null;
        const avgGap=totalReEngagements>0?Math.round(Object.values(custOrders).flatMap(a=>a.map(e=>e.gap)).reduce((a,b)=>a+b,0)/totalReEngagements):0;
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">{currentLanguage === 'tr' ? 'Müşteri Yeniden Kazanımı' : 'Customer Re-Engagement'}</h3>
            <div className="grid grid-cols-3 gap-2 text-center">
              {[{label:'Total Re-engaged',val:String(totalReEngagements),color:'#22c55e'},{label:'Recent (90d)',val:String(reEngaged),color:'#3b82f6'},{label:'Avg Gap',val:`${avgGap}d`,color:'#f59e0b'}].map(s=>(
                <div key={s.label} className="rounded-xl p-3" style={{background:`${s.color}12`}}>
                  <p className="text-xl font-bold" style={{color:s.color}}>{s.val}</p>
                  <p className="text-[9px] text-gray-400">{s.label}</p>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && quotations.length >= 3 && (() => {
        const statusMap: Record<string,number>={};
        quotations.forEach(q=>{ const s=((q as unknown as Record<string,unknown>).status as string|undefined)??'Unknown'; statusMap[s]=(statusMap[s]??0)+1; });
        const approved=(statusMap['Approved']??0)+(statusMap['Accepted']??0)+(statusMap['Won']??0);
        const rejected=(statusMap['Rejected']??0)+(statusMap['Declined']??0)+(statusMap['Lost']??0);
        const converted=(statusMap['Converted']??0)+(statusMap['Ordered']??0);
        const total=quotations.length;
        const approvalRate=total>0?Math.round(((approved+converted)/total)*100):0;
        const segments=[{label:'Approved/Won',count:approved+converted,color:'#22c55e'},{label:'Pending',count:total-approved-converted-rejected,color:'#f59e0b'},{label:'Rejected',count:rejected,color:'#ef4444'}].filter(s=>s.count>0);
        return (
          <div className="apple-card p-4 mb-4">
            <div className="flex justify-between items-center mb-3">
              <h3 className="font-semibold text-sm">{currentLanguage === 'tr' ? 'Teklif Onay Oranı' : 'Quotation Approval Rate'}</h3>
              <span className="text-xs bg-green-100 text-green-700 rounded-full px-2 py-0.5">{approvalRate}%</span>
            </div>
            <div className="flex h-4 rounded-full overflow-hidden mb-3">
              {segments.map(s=>s.count>0&&<div key={s.label} style={{width:`${(s.count/total)*100}%`,background:s.color}} title={`${s.label}: ${s.count}`}/>)}
            </div>
            <div className="grid grid-cols-3 gap-1 text-center">
              {segments.map(s=>(
                <div key={s.label}>
                  <p className="text-lg font-bold" style={{color:s.color}}>{s.count}</p>
                  <p className="text-[9px] text-gray-400">{s.label}</p>
                </div>
              ))}
            </div>
          </div>
        );
      })()}
    </>
  );
}
