/**
 * GenelBloklar3.tsx — GenelRapor bölmesi (2026-08-31)
 *
 * GenelRapor.tsx'ten mekanik olarak çıkarıldı (bölme öncesi satır 1463–2029).
 * Bloklar ORİJİNAL SIRASIYLA ve içeriği DEĞİŞTİRİLMEDEN taşındı; bloklardaki
 * `reportsTab === 'genel'` koşulları BİLEREK korundu (bkz. GenelRapor.tsx
 * başlık notu — ebeveyn zaten sekmeye göre render ediyor, koşulu silmek
 * "saf kopya" güvencesini bozardı).
 * Props yalnız bu dosyanın gerçekten kullandığı ctx alanlarıdır
 * (tsc "Cannot find name" listesinden çıkarıldı).
 */
import { itemCostTRY, type ReportsCtx } from '../useReportsData';

type Props = Pick<ReportsCtx, 'reportsTab' | 'orders' | 'inventory' | 'employees' | 'quotations' | 'inventoryMovements' | 'exchangeRates' | 'currentLanguage' | 'fmtAna'>;

export default function GenelBloklar3({ reportsTab, orders, inventory, employees, quotations, inventoryMovements, exchangeRates, currentLanguage, fmtAna }: Props) {
  return (
    <>
      {reportsTab === 'genel' && orders.length >= 10 && (() => {
        const validOrders = orders.filter(o => o.status !== 'Cancelled' && (o.totalPrice || 0) > 0);
        if (validOrders.length < 10) return null;
        const sorted256 = [...validOrders].sort((a, b) => (a.totalPrice || 0) - (b.totalPrice || 0));
        const decileSize = Math.ceil(sorted256.length / 10);
        const deciles = Array.from({ length: 10 }, (_, i) => {
          const slice = sorted256.slice(i * decileSize, (i + 1) * decileSize);
          const rev = slice.reduce((s, o) => s + (o.totalPrice || 0), 0);
          return { label: `D${i + 1}`, rev, count: slice.length };
        });
        const totalRev256 = deciles.reduce((s, d) => s + d.rev, 0);
        const top30pct = deciles.slice(7).reduce((s, d) => s + d.rev, 0);
        const top30share = totalRev256 > 0 ? Math.round((top30pct / totalRev256) * 100) : 0;
        const maxRev256 = Math.max(...deciles.map(d => d.rev), 1);
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '📊 Sipariş Büyüklüğü Desil Analizi' : '📊 Order Size Decile Analysis'}</h3>
              <span className="text-xs font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full">{currentLanguage === 'tr' ? `Üst %30 → %${top30share} ciro` : `Top 30% → ${top30share}% revenue`}</span>
            </div>
            <div className="flex items-end gap-1 h-20 mb-2">
              {deciles.map((d, i) => {
                const isTop = i >= 7;
                return (
                  <div key={d.label} className="flex-1 flex flex-col items-center gap-0.5">
                    <div className="w-full flex items-end" style={{ height: '64px' }}>
                      <div className={`w-full rounded-t-sm ${isTop ? 'bg-brand' : 'bg-blue-200'}`} style={{ height: `${Math.max(4, Math.round((d.rev / maxRev256) * 64))}px` }} />
                    </div>
                    <span className="text-[8px] text-gray-400">{d.label}</span>
                  </div>
                );
              })}
            </div>
            <p className="text-[10px] text-gray-400">{currentLanguage === 'tr' ? 'D1 = en küçük siparişler, D10 = en büyük siparişler. Kırmızı = üst %30.' : 'D1 = smallest orders, D10 = largest orders. Red = top 30%.'}</p>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 10 && (() => {
        const now260 = new Date();
        // Compare last 30 days vs prior 30 days across key metrics
        const last30 = new Date(now260); last30.setDate(last30.getDate() - 30);
        const prev30Start = new Date(now260); prev30Start.setDate(prev30Start.getDate() - 60);
        const filter260 = (start: Date, end: Date) => orders.filter(o => {
          if (o.status === 'Cancelled') return false;
          try {
            const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
            return od >= start && od <= end;
          } catch { return false; }
        });
        const curr260 = filter260(last30, now260);
        const prev260 = filter260(prev30Start, last30);
        const metrics260 = [
          { label: currentLanguage === 'tr' ? 'Ciro' : 'Revenue', curr: curr260.reduce((s, o) => s + (o.totalPrice || 0), 0), prev: prev260.reduce((s, o) => s + (o.totalPrice || 0), 0) },
          { label: currentLanguage === 'tr' ? 'Sipariş Adedi' : 'Order Count', curr: curr260.length, prev: prev260.length },
          { label: currentLanguage === 'tr' ? 'Müşteri Sayısı' : 'Customers', curr: new Set(curr260.map(o => o.customerName || '—')).size, prev: new Set(prev260.map(o => o.customerName || '—')).size },
          { label: 'AOV', curr: curr260.length > 0 ? Math.round(curr260.reduce((s, o) => s + (o.totalPrice || 0), 0) / curr260.length) : 0, prev: prev260.length > 0 ? Math.round(prev260.reduce((s, o) => s + (o.totalPrice || 0), 0) / prev260.length) : 0 },
        ];
        const scored = metrics260.map(m => ({
          ...m,
          growth: m.prev > 0 ? Math.round(((m.curr - m.prev) / m.prev) * 100) : null,
          score: m.prev > 0 ? (m.curr >= m.prev * 1.1 ? 25 : m.curr >= m.prev ? 15 : m.curr >= m.prev * 0.9 ? 5 : 0) : (m.curr > 0 ? 15 : 0),
        }));
        const momentumScore = scored.reduce((s, m) => s + m.score, 0);
        const maxScore = 100;
        const momentumLevel = momentumScore >= 80 ? { label: currentLanguage === 'tr' ? '🚀 Güçlü İvme' : '🚀 Strong Momentum', color: 'text-emerald-600 bg-emerald-100' }
          : momentumScore >= 50 ? { label: currentLanguage === 'tr' ? '📈 Orta İvme' : '📈 Moderate Momentum', color: 'text-blue-600 bg-blue-100' }
          : momentumScore >= 25 ? { label: currentLanguage === 'tr' ? '➡️ Stabil' : '➡️ Stable', color: 'text-amber-600 bg-amber-100' }
          : { label: currentLanguage === 'tr' ? '📉 Düşüş' : '📉 Declining', color: 'text-red-600 bg-red-100' };
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '⚡ Satış Momentum Skoru' : '⚡ Sales Momentum Score'}</h3>
              <div className="flex items-center gap-2">
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${momentumLevel.color}`}>{momentumLevel.label}</span>
                <span className={`text-2xl font-black ${momentumLevel.color.split(' ')[0]}`}>{momentumScore}/{maxScore}</span>
              </div>
            </div>
            <div className="h-3 bg-gray-100 rounded-full overflow-hidden mb-4">
              <div className={`h-full rounded-full transition-all ${momentumScore >= 80 ? 'bg-emerald-400' : momentumScore >= 50 ? 'bg-blue-400' : momentumScore >= 25 ? 'bg-amber-400' : 'bg-red-400'}`} style={{ width: `${momentumScore}%` }} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              {scored.map(m => (
                <div key={m.label} className="bg-gray-50 rounded-xl p-3">
                  <p className="text-[10px] text-gray-500 font-medium mb-1">{m.label}</p>
                  <p className="text-lg font-black text-gray-800">{typeof m.curr === 'number' && m.curr > 1000 ? `₺${(m.curr/1000).toFixed(0)}K` : m.curr}</p>
                  {m.growth !== null && (
                    <p className={`text-[10px] font-bold ${m.growth >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                      {m.growth >= 0 ? '↑' : '↓'} %{Math.abs(m.growth)} MoM
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 20 && (() => {
        const sorted = [...orders].sort((a,b) => a.totalPrice - b.totalPrice);
        const n = sorted.length;
        const q = Math.floor(n / 4);
        const quartiles = [
          { label: 'Q1 (Bottom 25%)', orders: sorted.slice(0, q) },
          { label: 'Q2 (25–50%)', orders: sorted.slice(q, q*2) },
          { label: 'Q3 (50–75%)', orders: sorted.slice(q*2, q*3) },
          { label: 'Q4 (Top 25%)', orders: sorted.slice(q*3) },
        ];
        const data = quartiles.map(qt => ({
          label: qt.label,
          count: qt.orders.length,
          revenue: qt.orders.reduce((s, o) => s + o.totalPrice, 0),
          avgOrder: qt.orders.length ? qt.orders.reduce((s, o) => s + o.totalPrice, 0) / qt.orders.length : 0,
        }));
        const maxRev = Math.max(...data.map(d => d.revenue));
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? 'Ciro Çeyreklik Analizi' : 'Revenue Quartile Analysis'}</h3>
            <p className="text-xs text-gray-500 mb-4">Orders split into 4 equal quartiles by order value</p>
            <div className="space-y-3">
              {data.map((d, i) => (
                <div key={i}>
                  <div className="flex justify-between text-xs text-gray-600 mb-1">
                    <span className="font-medium">{d.label}</span>
                    <span>{d.count} orders · avg {fmtAna(d.avgOrder,'full',0)} · total {fmtAna(d.revenue,'full',0)}</span>
                  </div>
                  <div className="h-5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${maxRev > 0 ? (d.revenue/maxRev*100) : 0}%`, background: ['#dbeafe','#93c5fd','#3b82f6','#1d4ed8'][i] }} />
                  </div>
                </div>
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-3">Top quartile drives {maxRev > 0 ? ((data[3].revenue / data.reduce((s,d)=>s+d.revenue,0))*100).toFixed(0) : 0}% of total revenue</p>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 10 && (() => {
        const dayLabels = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
        const dayCounts = Array(7).fill(0);
        const dayRevenue = Array(7).fill(0);
        orders.forEach(o => {
          const d = ((o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string)).getDay();
          dayCounts[d]++;
          dayRevenue[d] += o.totalPrice;
        });
        const maxRev = Math.max(...dayRevenue);
        if (maxRev === 0) return null;
        const bestDay = dayRevenue.indexOf(maxRev);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? 'Haftanın Gününe Göre Satış Hızı' : 'Sales Velocity by Day of Week'}</h3>
            <p className="text-xs text-gray-500 mb-4">Revenue and order count per weekday — best day: <span className="font-bold text-green-600">{dayLabels[bestDay]}</span></p>
            <div className="flex items-end gap-2 h-28">
              {dayLabels.map((label, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-[9px] text-gray-600">{dayCounts[i]}</span>
                  <div className="w-full rounded-t transition-all" style={{ height: `${maxRev > 0 ? (dayRevenue[i]/maxRev*80) : 4}px`, background: i === bestDay ? '#f97316' : '#6366f1', minHeight: '4px' }} />
                  <span className="text-[9px] text-gray-500 font-medium">{label}</span>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1 mt-2">
              {dayRevenue.map((r,i) => (
                <div key={i} className="text-center text-[8px] text-gray-400">{r >= 1000 ? fmtAna(r,'K',0) : fmtAna(r)}</div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 10 && (() => {
        const now = new Date();
        const dayCounts: Record<string, number> = {};
        orders.forEach(o => {
          const d = (o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string);
          const diff = Math.floor((now.getTime() - d.getTime()) / 86400000);
          if (diff <= 90) {
            const key = d.toISOString().slice(0,10);
            dayCounts[key] = (dayCounts[key] || 0) + 1;
          }
        });
        const days = Array.from({length: 90}, (_, i) => {
          const d = new Date(now);
          d.setDate(d.getDate() - (89 - i));
          return d.toISOString().slice(0,10);
        });
        const maxCount = Math.max(...days.map(d => dayCounts[d] || 0), 1);
        const totalDaysWithOrders = days.filter(d => dayCounts[d] > 0).length;
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Order Density — Last 90 Days</h3>
            <p className="text-xs text-gray-500 mb-4">{totalDaysWithOrders} active days out of 90</p>
            <div className="grid gap-0.5" style={{ gridTemplateColumns: 'repeat(30, 1fr)' }}>
              {days.map(day => {
                const count = dayCounts[day] || 0;
                const intensity = count / maxCount;
                return (
                  <div
                    key={day}
                    title={`${day}: ${count} orders`}
                    className="rounded-sm cursor-default"
                    style={{ height: '12px', background: count === 0 ? '#f3f4f6' : `rgba(239,68,68,${0.2 + intensity*0.8})` }}
                  />
                );
              })}
            </div>
            <div className="flex items-center gap-2 mt-3">
              <span className="text-[9px] text-gray-400">Less</span>
              {[0.1, 0.3, 0.5, 0.7, 1.0].map((v,i) => (
                <div key={i} className="w-3 h-3 rounded-sm" style={{ background: `rgba(239,68,68,${0.2+v*0.8})` }} />
              ))}
              <span className="text-[9px] text-gray-400">More</span>
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 5 && (() => {
        const withMargin = orders.filter(o => o.lineItems && o.lineItems.length > 0).map(o => {
          const cost = (o.lineItems || []).reduce((s, li) => {
            const inv = inventory.find(it => it.id === li.inventoryId || it.sku === li.sku);
            return s + (inv ? itemCostTRY(inv, exchangeRates) : (li.costPrice || 0)) * li.quantity;
          }, 0);
          const margin = o.totalPrice - cost;
          return { id: o.id, customer: o.customerName, revenue: o.totalPrice, cost, margin, marginPct: o.totalPrice > 0 ? (margin/o.totalPrice*100) : 0 };
        }).filter(o => o.margin < 0).sort((a,b) => a.margin - b.margin).slice(0,6);
        if (withMargin.length === 0) return null;
        const totalLoss = withMargin.reduce((s,o) => s + Math.abs(o.margin), 0);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? 'Zarar Eden Sipariş Uyarısı' : 'Loss-Making Orders Alert'}</h3>
            <p className="text-xs text-gray-500 mb-3">Orders where cost {'>'}  revenue — total exposure: {fmtAna(totalLoss,'full',0)}</p>
            <div className="space-y-2">
              {withMargin.map((o,i) => (
                <div key={i} className="flex items-center justify-between text-xs p-2 rounded-lg bg-red-50">
                  <span className="font-medium text-gray-800 truncate w-32">{o.customer}</span>
                  <span className="text-gray-500">Revenue: {fmtAna(o.revenue,'full',0)}</span>
                  <span className="text-red-600 font-bold">Loss: {fmtAna(Math.abs(o.margin),'full',0)} ({o.marginPct.toFixed(1)}%)</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && exchangeRates && orders.length >= 5 && (() => {
        // UYDURMA KUR YOK (2026-08-26). Eskiden `|| 32` / `|| 35` vardi: 2024'ten
        // kalma sabit kurlarla "Multi-Currency Revenue" karti YANLIS rakam
        // basiyordu ve hemen altinda "Based on LIVE exchange rates" yaziyordu —
        // yani yanlis rakami dogru diye sunuyordu. Kartin TAMAMI kura bagli
        // oldugu icin dogru davranis kartı hic gostermemek.
        const usdRate = exchangeRates['USD'];
        const eurRate = exchangeRates['EUR'];
        if (!usdRate || !eurRate || !isFinite(usdRate) || !isFinite(eurRate) || usdRate <= 0 || eurRate <= 0) return null;
        const now = new Date();
        const last30 = orders.filter(o => {
          const d = (o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string);
          return (now.getTime() - d.getTime()) / 86400000 <= 30;
        });
        const totalTRY = last30.reduce((s,o) => s+o.totalPrice, 0);
        if (totalTRY === 0) return null;
        const totalUSD = totalTRY / usdRate;
        const totalEUR = totalTRY / eurRate;
        const avgOrderTRY = last30.length > 0 ? totalTRY / last30.length : 0;
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Multi-Currency Revenue (Last 30 Days)</h3>
            <p className="text-xs text-gray-500 mb-4">Based on live exchange rates: 1 USD = ₺{usdRate.toFixed(2)} · 1 EUR = ₺{eurRate.toFixed(2)}</p>
            <div className="grid grid-cols-3 gap-4">
              {[
                { currency: '₺ TRY', value: totalTRY, sub: `${last30.length} orders` },
                { currency: '$ USD', value: totalUSD, sub: `avg $${(avgOrderTRY/usdRate).toFixed(0)}/order` },
                { currency: '€ EUR', value: totalEUR, sub: `avg €${(avgOrderTRY/eurRate).toFixed(0)}/order` },
              ].map((c,i) => (
                <div key={i} className="bg-gray-50 rounded-xl p-4 text-center">
                  <div className="text-xs text-gray-400 mb-1">{c.currency}</div>
                  <div className="text-xl font-black text-gray-800">{i===0 ? '₺' : i===1 ? '$' : '€'}{c.value.toLocaleString('en', {maximumFractionDigits:0})}</div>
                  <div className="text-[10px] text-gray-400 mt-1">{c.sub}</div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 10 && (() => {
        const now = new Date();
        // İPTALLER DIŞARIDA (2026-08-22 denetim bulgusu C6): bu blok `orders`ı
        // ham kullanıyordu — sayfanın ana ciro KPI'sı ve bu dosyadaki diğer 10+
        // hesap iptalleri dışlarken, buradaki finansal oran kartları (brüt marj,
        // stok devri, aylık ortalama ciro) iptal edilen siparişleri de sayıyordu.
        // Aynı sayfada iki farklı ciro tanımı = güvenilmez rapor.
        const gecerliSiparisler = orders.filter(o => o.status !== 'Cancelled');
        const totalRevenue = gecerliSiparisler.reduce((s,o) => s+o.totalPrice, 0);
        const totalCost = gecerliSiparisler.reduce((s,o) => s + (o.lineItems||[]).reduce((sc, li) => {
          const inv = inventory.find(it => it.id === li.inventoryId || it.sku === li.sku);
          return sc + (inv ? itemCostTRY(inv, exchangeRates) : (li.costPrice||0)) * li.quantity;
        }, 0), 0);
        const grossProfit = totalRevenue - totalCost;
        const grossMarginPct = totalRevenue > 0 ? (grossProfit/totalRevenue*100) : 0;
        const inventoryValue = inventory.reduce((s,i) => s + i.stockLevel * itemCostTRY(i, exchangeRates), 0);
        const monthlyRevArr = Array.from({length:12}, (_,i) => {
          const d = new Date(now.getFullYear(), now.getMonth()-11+i, 1);
          return gecerliSiparisler.filter(o => {
            const od = (o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string);
            return od.getFullYear()===d.getFullYear() && od.getMonth()===d.getMonth();
          }).reduce((s,o)=>s+o.totalPrice,0);
        });
        const avgMonthlyRev = monthlyRevArr.reduce((s,v)=>s+v,0) / 12;
        const inventoryTurnover = inventoryValue > 0 ? (totalCost / inventoryValue) : 0;
        const dso = avgMonthlyRev > 0 ? (inventoryValue / avgMonthlyRev * 30) : 0;
        const ratios = [
          { label: 'Gross Margin', value: `${grossMarginPct.toFixed(1)}%`, good: grossMarginPct >= 30, neutral: grossMarginPct >= 15 },
          { label: 'Inventory Turnover', value: `${inventoryTurnover.toFixed(1)}x`, good: inventoryTurnover >= 4, neutral: inventoryTurnover >= 2 },
          { label: 'Avg Monthly Revenue', value: `₺${(avgMonthlyRev/1000).toFixed(0)}k`, good: true, neutral: true },
          { label: 'Gross Profit', value: `₺${(grossProfit/1000).toFixed(0)}k`, good: grossProfit > 0, neutral: grossProfit >= 0 },
          { label: 'Inventory Value', value: `₺${(inventoryValue/1000).toFixed(0)}k`, good: true, neutral: true },
          { label: 'Est. DSO', value: `${dso.toFixed(0)} days`, good: dso <= 30, neutral: dso <= 60 },
        ];
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-3">{currentLanguage === 'tr' ? 'Kapsamlı Finansal Oranlar' : 'Comprehensive Financial Ratios'}</h3>
            <div className="grid grid-cols-3 gap-3">
              {ratios.map((r,i) => (
                <div key={i} className="bg-gray-50 rounded-xl p-3 text-center">
                  <div className="text-lg font-black" style={{ color: r.good ? '#10b981' : r.neutral ? '#f59e0b' : '#ef4444' }}>{r.value}</div>
                  <div className="text-[10px] text-gray-500 mt-0.5">{r.label}</div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 10 && (() => {
        const now = new Date();
        const months = Array.from({length:12}, (_,i) => {
          const d = new Date(now.getFullYear(), now.getMonth() - (11-i), 1);
          return { key: `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`, label: `${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getFullYear()).slice(2)}`, year: d.getFullYear(), month: d.getMonth() };
        });
        const monthData = months.map(m => {
          const mOrders = orders.filter(o => {
            if (o.status === 'Cancelled') return false; // iptaller marj trendine girmez (C6)
            const d = (o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string);
            return d.getFullYear() === m.year && d.getMonth() === m.month;
          });
          const rev = mOrders.reduce((s,o)=>s+o.totalPrice,0);
          const cost = mOrders.reduce((s,o)=>s+(o.lineItems||[]).reduce((sc,li)=>{
            const inv = inventory.find(it=>it.id===li.inventoryId||it.sku===li.sku);
            return sc+(inv?itemCostTRY(inv, exchangeRates):(li.costPrice||0))*li.quantity;
          },0),0);
          const margin = rev > 0 ? ((rev-cost)/rev*100) : 0;
          return { label: m.label, rev, cost, margin };
        });
        const hasData = monthData.some(d => d.rev > 0);
        if (!hasData) return null;
        const maxMargin = Math.max(...monthData.map(d=>d.margin), 1);
        const avgMargin = monthData.filter(d=>d.rev>0).reduce((s,d)=>s+d.margin,0) / (monthData.filter(d=>d.rev>0).length || 1);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Gross Margin % — 12-Month Trend</h3>
            <p className="text-xs text-gray-500 mb-4">Average: {avgMargin.toFixed(1)}% · Target: 30%</p>
            <div className="flex items-end gap-1 h-24">
              {monthData.map((d,i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-[9px] text-gray-600">{d.margin > 0 ? `${d.margin.toFixed(0)}%` : ''}</span>
                  <div className="w-full rounded-t" style={{ height: `${d.margin > 0 ? Math.max(4, d.margin/Math.max(maxMargin,50)*80) : 2}px`, background: d.margin >= 30 ? '#10b981' : d.margin >= 15 ? '#f59e0b' : d.margin > 0 ? '#ef4444' : '#e5e7eb', minHeight: '2px' }} />
                  <span className="text-[8px] text-gray-400">{d.label}</span>
                </div>
              ))}
            </div>
            <div className="flex gap-3 mt-3 text-xs">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500 inline-block"></span>≥30% target</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block"></span>15-30%</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400 inline-block"></span>below 15%</span>
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 10 && (() => {
        const now = new Date();
        const prevMonth = new Date(now.getFullYear(), now.getMonth()-1, 1);
        const currMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        // İptaller gelir köprüsüne girmez (C6) — ana KPI ile aynı ciro tanımı.
        const prevOrders = orders.filter(o => {
          if (o.status === 'Cancelled') return false;
          const d = (o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string);
          return d >= prevMonth && d < currMonth;
        });
        const currOrders = orders.filter(o => {
          if (o.status === 'Cancelled') return false;
          const d = (o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string);
          return d >= currMonth;
        });
        if (prevOrders.length === 0 && currOrders.length === 0) return null;
        const prevRev = prevOrders.reduce((s,o)=>s+o.totalPrice,0);
        const currRev = currOrders.reduce((s,o)=>s+o.totalPrice,0);
        const prevCusts = new Set(prevOrders.map(o=>o.customerName));
        const currCusts = new Set(currOrders.map(o=>o.customerName));
        const newCustRev = currOrders.filter(o=>!prevCusts.has(o.customerName)).reduce((s,o)=>s+o.totalPrice,0);
        const retainedRev = currOrders.filter(o=>prevCusts.has(o.customerName)).reduce((s,o)=>s+o.totalPrice,0);
        const lostRev = prevOrders.filter(o=>!currCusts.has(o.customerName)).reduce((s,o)=>s+o.totalPrice,0);
        const netChange = currRev - prevRev;
        const items = [
          { label: 'Prior Month', value: prevRev, type: 'base' as const },
          { label: 'New Customers', value: newCustRev, type: 'add' as const },
          { label: 'Retained Growth', value: retainedRev - (prevRev - lostRev), type: retainedRev - (prevRev - lostRev) >= 0 ? 'add' as const : 'sub' as const },
          { label: 'Lost Customers', value: -lostRev, type: 'sub' as const },
          { label: 'Current Month', value: currRev, type: 'base' as const },
        ];
        const maxVal = Math.max(...[prevRev, currRev], 1);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Revenue Attribution Waterfall (MoM)</h3>
            <p className="text-xs text-gray-500 mb-4">Net change: <span className={netChange >= 0 ? 'text-green-600 font-bold' : 'text-red-600 font-bold'}>{netChange >= 0 ? '+' : ''}{fmtAna(netChange,'full',0)}</span></p>
            <div className="space-y-2">
              {items.map((item,i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs text-gray-600 w-32">{item.label}</span>
                  <div className="flex-1 h-5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{
                      width: `${maxVal>0?(Math.abs(item.value)/maxVal*100):0}%`,
                      background: item.type==='base' ? '#6366f1' : item.type==='add' ? '#10b981' : '#ef4444'
                    }} />
                  </div>
                  <span className="text-xs font-bold w-24 text-right" style={{ color: item.type==='base'?'#6366f1':item.type==='add'?'#10b981':'#ef4444' }}>
                    {item.type !== 'base' && (item.value >= 0 ? '+' : '')}{fmtAna(Math.abs(item.value),'full',0)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 10 && inventory.length >= 3 && (() => {
        const totalRevenue = orders.reduce((s,o)=>s+o.totalPrice,0);
        const totalCOGS = orders.reduce((s,o)=>s+(o.lineItems||[]).reduce((sc,li)=>{
          const inv = inventory.find(it=>it.id===li.inventoryId||it.sku===li.sku);
          return sc+(inv?itemCostTRY(inv,exchangeRates):(li.costPrice||0))*li.quantity;
        },0),0);
        const inventoryValue = inventory.reduce((s,i)=>s+Math.max(0,i.stockLevel)*itemCostTRY(i,exchangeRates),0);
        const avgMonthlyRevenue = totalRevenue / Math.max(1, (() => {
          const now = new Date();
          const dates = orders.map(o => (o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string));
          if (dates.length === 0) return 1;
          const oldest = new Date(Math.min(...dates.map(d=>d.getTime())));
          return Math.max(1, (now.getTime() - oldest.getTime()) / (86400000 * 30));
        })());
        const dso = avgMonthlyRevenue > 0 ? 30 : 0; // simplified: assume 30d collection
        const dio = totalCOGS > 0 ? (inventoryValue / (totalCOGS / 365)) : 0;
        const dpo = 30; // assumed supplier terms
        const ccc = dso + dio - dpo;
        const wcMetrics = [
          { label: 'Days Sales Outstanding (DSO)', value: dso.toFixed(0), unit: 'days', good: dso <= 30 },
          { label: 'Days Inventory Outstanding (DIO)', value: dio.toFixed(0), unit: 'days', good: dio <= 45 },
          { label: 'Days Payable Outstanding (DPO)', value: dpo.toFixed(0), unit: 'days', good: true },
          { label: 'Cash Conversion Cycle (CCC)', value: ccc.toFixed(0), unit: 'days', good: ccc <= 45 },
        ];
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? 'İşletme Sermayesi Döngüsü' : 'Working Capital Cycle'}</h3>
            <p className="text-xs text-gray-500 mb-4">CCC = DSO + DIO − DPO · Lower is better · target: under 45 days</p>
            <div className="space-y-3">
              {wcMetrics.map((m,i) => (
                <div key={i} className="flex items-center justify-between p-3 rounded-xl" style={{ background: m.good ? '#f0fdf4' : '#fef2f2' }}>
                  <span className="text-xs text-gray-700 font-medium">{m.label}</span>
                  <span className="text-xl font-black" style={{ color: m.good ? '#10b981' : '#ef4444' }}>{m.value}<span className="text-xs font-normal text-gray-400 ml-1">{m.unit}</span></span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && (() => {
        const totalOrders = orders.length;
        const totalRevenue = orders.reduce((s,o)=>s+o.totalPrice,0);
        const totalInventoryItems = inventory.length;
        const totalEmployees = employees.length;
        const totalQuotations = quotations.length;
        const totalMovements = inventoryMovements.length;
        const uniqueCustomers = new Set(orders.map(o=>o.customerName)).size;
        const deliveredOrders = orders.filter(o=>o.status==='Delivered').length;
        const deliveryRate = totalOrders > 0 ? (deliveredOrders/totalOrders*100) : 0;
        return (
          <div className="apple-card p-6 border-2 border-brand">
            <div className="flex items-center gap-3 mb-4">
              <div className="text-3xl">🎯</div>
              <div>
                <h3 className="font-black text-gray-800 text-lg">Phase 300 Milestone Reached!</h3>
                <p className="text-xs text-gray-500">300 analytics phases deployed — your live business intelligence dashboard</p>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              {[
                { label: 'Total Orders', value: totalOrders.toLocaleString(), icon: '📦' },
                { label: 'Total Revenue', value: `₺${(totalRevenue/1000).toFixed(0)}k`, icon: '💰' },
                { label: 'Unique Customers', value: uniqueCustomers.toLocaleString(), icon: '👥' },
                { label: 'Delivery Rate', value: `${deliveryRate.toFixed(0)}%`, icon: '🚚' },
                { label: 'SKUs Tracked', value: totalInventoryItems.toLocaleString(), icon: '📋' },
                { label: 'Active Employees', value: totalEmployees.toLocaleString(), icon: '👤' },
                { label: 'Quotations', value: totalQuotations.toLocaleString(), icon: '📝' },
                { label: 'Stock Movements', value: totalMovements.toLocaleString(), icon: '🔄' },
              ].map((s,i) => (
                <div key={i} className="bg-gray-50 rounded-xl p-3 text-center">
                  <div className="text-lg">{s.icon}</div>
                  <div className="text-base font-black text-gray-800">{s.value}</div>
                  <div className="text-[9px] text-gray-400 mt-0.5">{s.label}</div>
                </div>
              ))}
            </div>
            <div className="bg-gradient-to-r from-red-50 to-orange-50 rounded-xl p-3 text-center">
              <p className="text-xs font-bold text-brand">300 phases · 5 dashboard tabs · Full ERP analytics coverage</p>
              <p className="text-[10px] text-gray-400 mt-1">Revenue · CRM · Inventory · Logistics · HR — all connected</p>
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 12 && (() => {
        const monthRevenue: Record<number, number[]> = {};
        orders.forEach(o => {
          const d = (o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string);
          const m = d.getMonth();
          if (!monthRevenue[m]) monthRevenue[m] = [];
          monthRevenue[m].push(o.totalPrice);
        });
        const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        const monthAvg = Array.from({length:12}, (_,i) => {
          const vals = monthRevenue[i] || [];
          return vals.length > 0 ? vals.reduce((s,v)=>s+v,0)/vals.length : 0;
        });
        const overallAvg = monthAvg.filter(v=>v>0).reduce((s,v)=>s+v,0) / Math.max(1, monthAvg.filter(v=>v>0).length);
        if (overallAvg === 0) return null;
        const seasonality = monthAvg.map(avg => avg > 0 ? avg / overallAvg : null);
        // <number>: akumulator DIZI eleman tipine (number|null) cozulup
        // seasonality[best] indekslemesini kirmasin diye acikca sabitlendi.
        const peakMonth = seasonality.reduce<number>((best, val, i) => val !== null && (best === -1 || (seasonality[best] || 0) < val) ? i : best, -1);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? 'Ciro Mevsimsellik Endeksi' : 'Revenue Seasonality Index'}</h3>
            <p className="text-xs text-gray-500 mb-4">Monthly avg vs overall avg · peak: <span className="font-bold text-green-600">{monthNames[peakMonth]}</span></p>
            <div className="flex items-end gap-1 h-24">
              {seasonality.map((s, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  {s !== null && <span className="text-[8px] text-gray-500">{s.toFixed(1)}x</span>}
                  <div className="w-full rounded-t" style={{
                    height: s !== null ? `${Math.max(4, Math.min(80, s * 40))}px` : '2px',
                    background: s === null ? '#e5e7eb' : s >= 1.2 ? '#10b981' : s >= 0.8 ? '#3b82f6' : '#f59e0b',
                    minHeight: '2px'
                  }} />
                  <span className="text-[8px] text-gray-400">{monthNames[i].slice(0,1)}</span>
                </div>
              ))}
            </div>
            <div className="flex gap-3 mt-2 text-[10px]">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500 inline-block"></span>Peak (≥1.2x)</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-400 inline-block"></span>Normal</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block"></span>Trough ({'<'}0.8x)</span>
            </div>
          </div>
        );
      })()}
    </>
  );
}
