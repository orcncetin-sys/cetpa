/**
 * GenelOzet.tsx — GenelRapor bölmesi (2026-08-31)
 *
 * GenelRapor.tsx'ten mekanik olarak çıkarıldı (bölme öncesi satır 50–389).
 * Bloklar ORİJİNAL SIRASIYLA ve içeriği DEĞİŞTİRİLMEDEN taşındı; bloklardaki
 * `reportsTab === 'genel'` koşulları BİLEREK korundu (bkz. GenelRapor.tsx
 * başlık notu — ebeveyn zaten sekmeye göre render ediyor, koşulu silmek
 * "saf kopya" güvencesini bozardı).
 * Props yalnız bu dosyanın gerçekten kullandığı ctx alanlarıdır
 * (tsc "Cannot find name" listesinden çıkarıldı).
 */
import React from 'react';
import {
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, PieChart as RePieChart, Pie, Cell, AreaChart, Area,
} from 'recharts';
import { Package, AlertCircle } from 'lucide-react';
import { itemCostTRY, type ReportsCtx } from '../useReportsData';
import { KpiCard, KpiGrid, KpiCurrencyToggle } from '../ReportKit';

type Props = Pick<ReportsCtx, 'reportsTab' | 'orders' | 'inventory' | 'exchangeRates' | 'currentT' | 'currentLanguage' | 'onNavigate' | 'recurringOrders' | 'fmtAna' | 'totalOrders' | 'revenueSymbol' | 'revenueFormatted' | 'avgOrderFormatted' | 'lowStockItems' | 'trendData' | 'categoryChartData' | 'COLORS' | 'revenueCurrency' | 'setRevenueCurrency'>;

export default function GenelOzet({ reportsTab, orders, inventory, exchangeRates, currentT, currentLanguage, onNavigate, recurringOrders, fmtAna, totalOrders, revenueSymbol, revenueFormatted, avgOrderFormatted, lowStockItems, trendData, categoryChartData, COLORS, revenueCurrency, setRevenueCurrency }: Props) {
  return (
    <>
      {reportsTab === 'genel' && (
        <div className="space-y-6">
          {/* KPI Cards — ortak KpiCard/KpiGrid (ReportKit) ile tek tip */}
          <KpiGrid>
            {([
              { label: currentT.kpi_revenue, value: revenueFormatted, icon: undefined, symbol: revenueSymbol, accent: 'text-brand', accentBg: 'bg-brand/10', tab: 'crm', money: true },
              { label: currentT.kpi_orders, value: String(totalOrders), icon: Package, symbol: undefined, accent: 'text-blue-500', accentBg: 'bg-blue-50', tab: 'crm', money: false },
              { label: currentT.kpi_avg_order, value: avgOrderFormatted, icon: undefined, symbol: revenueSymbol, accent: 'text-green-500', accentBg: 'bg-green-50', tab: 'crm', money: false },
              { label: currentT.kpi_low_stock, value: String(lowStockItems), icon: AlertCircle, symbol: undefined, accent: 'text-orange-500', accentBg: 'bg-orange-50', tab: 'inventory', money: false },
            ] as { label: string; value: string; icon?: React.ElementType; symbol?: string; accent: string; accentBg: string; tab: string; money: boolean }[]).map((kpi, i) => (
              <KpiCard
                key={kpi.tab + i}
                index={i}
                label={kpi.label}
                value={kpi.value}
                icon={kpi.icon}
                symbol={kpi.symbol}
                accent={kpi.accent}
                accentBg={kpi.accentBg}
                action={kpi.money ? <KpiCurrencyToggle value={revenueCurrency} onChange={setRevenueCurrency} /> : undefined}
                onClick={() => onNavigate?.(kpi.tab)}
                linkHint={currentLanguage === 'tr' ? 'Detaya git' : 'View details'}
              />
            ))}
          </KpiGrid>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="apple-card p-8">
              <h3 className="text-lg font-bold mb-6">{currentT.sales_trend}</h3>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={trendData}>
                    <defs>
                      <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#ff4000" stopOpacity={0.1} />
                        <stop offset="95%" stopColor="#ff4000" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F5F5F7" />
                    <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#86868B' }} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#86868B' }} />
                    <Tooltip contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 25px rgba(0,0,0,0.1)' }} />
                    <Area type="monotone" dataKey="value" stroke="#ff4000" strokeWidth={3} fillOpacity={1} fill="url(#colorValue)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="apple-card p-8">
              <h3 className="text-lg font-bold mb-6">{currentT.category_dist}</h3>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <RePieChart>
                    <Pie data={categoryChartData} cx="50%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={5} dataKey="value">
                      {categoryChartData.map((_, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}
                    </Pie>
                    <Tooltip />
                    <Legend verticalAlign="bottom" height={36} />
                  </RePieChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* ── Phase 181: Monthly Recurring Revenue (MRR) ── */}
      {reportsTab === 'genel' && recurringOrders.filter(r => r.active).length > 0 && (() => {
        const activeRO = recurringOrders.filter(r => r.active);
        const mrr = activeRO.reduce((s, r) => {
          const monthly = r.frequency === 'weekly' ? r.totalPrice * 4 : r.frequency === 'quarterly' ? r.totalPrice / 3 : r.totalPrice;
          return s + monthly;
        }, 0);
        const arr = mrr * 12;
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '🔁 Aylık Tekrarlayan Gelir (MRR)' : '🔁 Monthly Recurring Revenue (MRR)'}</h3>
              <span className="text-xs text-emerald-700 font-bold bg-emerald-50 px-2 py-0.5 rounded-full">{activeRO.length} {currentLanguage==='tr'?'aktif şablon':'active templates'}</span>
            </div>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div className="bg-emerald-50 rounded-2xl p-4">
                <p className="text-[10px] text-emerald-700 font-bold uppercase tracking-wide">MRR</p>
                <p className="text-3xl font-black text-emerald-700 mt-1">{fmtAna(mrr,'K',1)}</p>
                <p className="text-[10px] text-emerald-600 mt-0.5">{currentLanguage==='tr'?'Aylık tekrarlayan':'Monthly recurring'}</p>
              </div>
              <div className="bg-blue-50 rounded-2xl p-4">
                <p className="text-[10px] text-blue-700 font-bold uppercase tracking-wide">ARR</p>
                <p className="text-3xl font-black text-blue-700 mt-1">{fmtAna(arr,'K',0)}</p>
                <p className="text-[10px] text-blue-600 mt-0.5">{currentLanguage==='tr'?'Yıllık projeksiyon':'Annual projection'}</p>
              </div>
            </div>
            <div className="space-y-1.5">
              {activeRO.slice(0, 4).map(r => {
                const monthly = r.frequency === 'weekly' ? r.totalPrice * 4 : r.frequency === 'quarterly' ? r.totalPrice / 3 : r.totalPrice;
                return (
                  <div key={r.id} className="flex items-center justify-between text-xs py-1 border-b border-gray-50 last:border-0">
                    <span className="text-gray-700 truncate">{r.templateName} · {r.customerName}</span>
                    <span className="font-bold text-emerald-600 shrink-0 ml-2">{fmtAna(Math.round(monthly))}/m</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 189: Order Value Distribution ── */}
      {reportsTab === 'genel' && orders.length >= 5 && (() => {
        const buckets189 = [
          { label: '<₺1K', min: 0, max: 1000, count: 0, total: 0 },
          { label: '₺1-5K', min: 1000, max: 5000, count: 0, total: 0 },
          { label: '₺5-20K', min: 5000, max: 20000, count: 0, total: 0 },
          { label: '₺20-100K', min: 20000, max: 100000, count: 0, total: 0 },
          { label: '₺100K+', min: 100000, max: Infinity, count: 0, total: 0 },
        ];
        for (const o of orders) {
          if (o.status === 'Cancelled') continue;
          const v = o.totalPrice || 0;
          const b = buckets189.find(b => v >= b.min && v < b.max);
          if (b) { b.count++; b.total += v; }
        }
        const maxCount = Math.max(...buckets189.map(b => b.count), 1);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-4">{currentLanguage === 'tr' ? '📊 Sipariş Değeri Dağılımı' : '📊 Order Value Distribution'}</h3>
            <div className="flex items-end gap-3 h-28 mb-3">
              {buckets189.map((b, i) => {
                const h = Math.round((b.count / maxCount) * 100);
                const colors = ['bg-blue-300', 'bg-blue-400', 'bg-brand/70', 'bg-brand', 'bg-purple-500'];
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1 group">
                    <div className="w-full flex flex-col justify-end" style={{ height: '80px' }}>
                      <div className={`w-full rounded-t-lg ${colors[i]}`} style={{ height: `${Math.max(h, 3)}%` }}
                        title={`${b.count} ${currentLanguage==='tr'?'sipariş':'orders'} · ₺${b.total.toLocaleString()}`} />
                    </div>
                    <span className="text-[8px] text-gray-400 text-center leading-tight">{b.label}</span>
                    <span className="text-[9px] font-bold text-gray-600">{b.count}</span>
                  </div>
                );
              })}
            </div>
            <p className="text-[10px] text-gray-400">{currentLanguage==='tr'?'Sayı, sipariş başına sipariş değerine göre':'Order count by order value range'}</p>
          </div>
        );
      })()}

      {/* ── Phase 185: Cash Conversion Cycle (CCC) ── */}
      {reportsTab === 'genel' && orders.length >= 5 && inventory.length > 0 && (() => {
        const now185 = new Date();
        const days90 = 90;
        const cutoff185 = new Date(now185); cutoff185.setDate(cutoff185.getDate() - days90);
        // DSO: avg days from order creation to paid status
        const paidOrders = orders.filter(o => o.status === 'Delivered' || (o as unknown as Record<string,unknown>).paidAt);
        void paidOrders;
        const unPaidOrders = orders.filter(o => o.status !== 'Cancelled' && o.status !== 'Delivered');
        const arBalance = unPaidOrders.reduce((s, o) => s + (o.totalPrice || 0), 0);
        const monthly90Rev = orders.filter(o => {
          try {
            const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
            return od >= cutoff185 && o.status !== 'Cancelled';
          } catch { return false; }
        }).reduce((s, o) => s + (o.totalPrice || 0), 0);
        const dailyRev185 = monthly90Rev / days90;
        const dso = dailyRev185 > 0 ? Math.round(arBalance / dailyRev185) : 0;
        // DIO: avg inventory value / daily COGS
        const inventoryVal185 = inventory.reduce((s, i) => s + itemCostTRY(i, exchangeRates) * (i.stockLevel ?? 0), 0);
        const dailyCOGS185 = monthly90Rev * 0.6 / days90; // assume 60% COGS ratio
        const dio = dailyCOGS185 > 0 ? Math.round(inventoryVal185 / dailyCOGS185) : 0;
        const ccc = dso + dio;
        const cccColor = ccc <= 30 ? 'text-emerald-600' : ccc <= 60 ? 'text-amber-500' : 'text-red-500';
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '⏱️ Nakit Dönüşüm Döngüsü (CCC)' : '⏱️ Cash Conversion Cycle (CCC)'}</h3>
              <span className={`text-lg font-black ${cccColor}`}>{ccc} {currentLanguage === 'tr' ? 'gün' : 'days'}</span>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-4">
              {[
                { label: 'DSO', desc: currentLanguage === 'tr' ? 'Alacak Tahsilat Süresi' : 'Days Sales Outstanding', value: dso, color: dso > 45 ? 'text-red-500' : dso > 30 ? 'text-amber-500' : 'text-emerald-600', sub: currentLanguage === 'tr' ? `₺${(arBalance/1000).toFixed(0)}K ödenmemiş` : `₺${(arBalance/1000).toFixed(0)}K outstanding` },
                { label: 'DIO', desc: currentLanguage === 'tr' ? 'Stok Elde Tutma Süresi' : 'Days Inventory Outstanding', value: dio, color: dio > 60 ? 'text-red-500' : dio > 30 ? 'text-amber-500' : 'text-emerald-600', sub: currentLanguage === 'tr' ? `₺${(inventoryVal185/1000).toFixed(0)}K stok` : `₺${(inventoryVal185/1000).toFixed(0)}K inventory` },
              ].map(k => (
                <div key={k.label} className="bg-gray-50 rounded-xl p-4">
                  <p className={`text-3xl font-black ${k.color}`}>{k.value}<span className="text-sm font-medium text-gray-400 ml-1">{currentLanguage === 'tr' ? 'gün' : 'd'}</span></p>
                  <p className="text-[11px] text-gray-700 font-semibold mt-1">{k.label} · {k.desc}</p>
                  <p className="text-[10px] text-gray-400">{k.sub}</p>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-1.5 bg-blue-50 rounded-xl p-3">
              <span className="text-blue-500 text-sm">💡</span>
              <p className="text-[11px] text-blue-700">{currentLanguage === 'tr' ? `CCC = DSO + DIO. Hedef: 30 günün altı. Şu an: ${ccc} gün${ccc > 60 ? ' — nakit sıkışıklığı riski var.' : ccc > 30 ? ' — iyileştirme fırsatı var.' : ' — sağlıklı.'}` : `CCC = DSO + DIO. Target: under 30 days. Current: ${ccc} days${ccc > 60 ? ' — cash flow risk.' : ccc > 30 ? ' — room for improvement.' : ' — healthy.'}`}</p>
            </div>
          </div>
        );
      })()}

      {/* ── Phase 186: Sales by Hour of Day ── */}
      {reportsTab === 'genel' && orders.length >= 10 && (() => {
        const hourBuckets186 = Array.from({ length: 8 }, (_, i) => ({ label: `${i*3}:00-${i*3+2}:59`, start: i*3, count: 0, rev: 0 }));
        let hasHours = false;
        for (const o of orders) {
          if (o.status === 'Cancelled') continue;
          try {
            const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
            const h = od.getHours();
            if (isNaN(h)) continue;
            hasHours = true;
            const bucket = hourBuckets186.find(b => h >= b.start && h < b.start + 3);
            if (bucket) { bucket.count++; bucket.rev += o.totalPrice || 0; }
          } catch { /* skip */ }
        }
        if (!hasHours) return null;
        const maxCount186 = Math.max(...hourBuckets186.map(b => b.count), 1);
        const peakBucket = hourBuckets186.reduce((best, b) => b.count > best.count ? b : best, hourBuckets186[0]);
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '🕐 Saate Göre Satış Dağılımı' : '🕐 Sales by Hour of Day'}</h3>
              <span className="text-xs font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full">{currentLanguage === 'tr' ? `Zirve: ${peakBucket.label}` : `Peak: ${peakBucket.label}`}</span>
            </div>
            <div className="flex items-end gap-1.5 h-24">
              {hourBuckets186.map(b => (
                <div key={b.label} className="flex-1 flex flex-col items-center gap-1">
                  <div className="w-full flex items-end justify-center" style={{ height: '72px' }}>
                    <div
                      className={`w-full rounded-t-md ${b.count === peakBucket.count ? 'bg-brand' : 'bg-blue-200'}`}
                      style={{ height: `${Math.max(4, Math.round((b.count / maxCount186) * 72))}px` }}
                    />
                  </div>
                  <span className="text-[9px] text-gray-400 leading-none text-center">{b.start}h</span>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between mt-2">
              <span className="text-[10px] text-gray-400">0:00</span>
              <span className="text-[10px] text-gray-400">12:00</span>
              <span className="text-[10px] text-gray-400">21:00</span>
            </div>
            <p className="text-[10px] text-gray-400 mt-2">{currentLanguage === 'tr' ? 'Her çubuk 3 saatlik dilimi temsil eder' : 'Each bar represents a 3-hour window'}</p>
          </div>
        );
      })()}

      {/* ── Phase 147: Revenue by Day of Week ── */}
          {orders.length >= 5 && (() => {
            const dayNames = currentLanguage === 'tr'
              ? ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt']
              : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
            const dayCounts = Array(7).fill(null).map((_, d) => ({ day: dayNames[d], revenue: 0, orders: 0 }));
            for (const o of orders) {
              if (o.status === 'Cancelled') continue;
              try {
                const d = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
                dayCounts[d.getDay()].revenue += o.totalPrice || 0;
                dayCounts[d.getDay()].orders++;
              } catch { /* skip */ }
            }
            const maxRev147 = Math.max(...dayCounts.map(d => d.revenue), 1);
            const bestDay = dayCounts.reduce((best, d) => d.revenue > best.revenue ? d : best, dayCounts[0]);
            return (
              <div className="apple-card p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '📅 Güne Göre Satış Dağılımı' : '📅 Revenue by Day of Week'}</h3>
                  <span className="text-xs text-gray-500">{currentLanguage === 'tr' ? 'En iyi gün:' : 'Best day:'} <span className="font-bold text-brand">{bestDay.day}</span></span>
                </div>
                <div className="flex items-end gap-2 h-32">
                  {dayCounts.map((d, i) => {
                    const h = Math.round((d.revenue / maxRev147) * 100);
                    return (
                      <div key={i} className="flex-1 flex flex-col items-center gap-1 cursor-default">
                        <div className="w-full flex flex-col justify-end" style={{ height: '96px' }}>
                          <div
                            className={`w-full rounded-t-lg transition-all duration-500 ${d.revenue === maxRev147 ? 'bg-brand' : 'bg-brand/30 hover:bg-brand/60'}`}
                            style={{ height: `${Math.max(h, 2)}%` }}
                            title={`₺${d.revenue.toLocaleString()} · ${d.orders} ${currentLanguage==='tr'?'sipariş':'orders'}`}
                          />
                        </div>
                        <span className={`text-[10px] font-semibold ${d.revenue === maxRev147 ? 'text-brand' : 'text-gray-400'}`}>{d.day}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {/* ── Phase 148: Days-to-Stockout Forecast ── */}
          {inventory.length > 0 && (() => {
            const now148 = new Date();
            const cutoff148 = new Date(now148); cutoff148.setDate(cutoff148.getDate() - 30);
            const atRisk = inventory
              .filter(i => i.stockLevel > 0 && i.stockLevel <= (i.lowStockThreshold ?? 5) * 3)
              .map(i => {
                const sold30 = orders
                  .filter(o => {
                    try {
                      const d = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
                      return d >= cutoff148 && o.status !== 'Cancelled';
                    } catch { return false; }
                  })
                  .reduce((s, o) => {
                    const li = (o.lineItems || []).find(l => l.inventoryId === i.id || l.name === i.name);
                    return s + (li?.quantity || 0);
                  }, 0);
                const dailyUsage = sold30 / 30;
                const daysLeft = dailyUsage > 0 ? Math.round(i.stockLevel / dailyUsage) : null;
                return { ...i, dailyUsage, daysLeft };
              })
              .filter(i => i.daysLeft !== null && i.daysLeft <= 45)
              .sort((a, b) => (a.daysLeft ?? 999) - (b.daysLeft ?? 999))
              .slice(0, 8);
            if (atRisk.length === 0) return null;
            return (
              <div className="apple-card p-6">
                <h3 className="font-bold text-gray-800 mb-2">{currentLanguage === 'tr' ? '⏱️ Stok Tükenme Tahmini' : '⏱️ Days-to-Stockout Forecast'}</h3>
                <p className="text-xs text-gray-400 mb-4">{currentLanguage === 'tr' ? 'Son 30 gün satış hızına göre tahmin' : 'Based on last 30-day sales velocity'}</p>
                <div className="space-y-3">
                  {atRisk.map(item => {
                    const d = item.daysLeft!;
                    const cls = d <= 7 ? 'bg-red-500' : d <= 20 ? 'bg-amber-400' : 'bg-emerald-400';
                    const textCls = d <= 7 ? 'text-red-600' : d <= 20 ? 'text-amber-600' : 'text-emerald-600';
                    return (
                      <div key={item.id} className="flex items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs font-semibold text-gray-800 truncate">{item.name}</span>
                            <span className={`text-xs font-bold ${textCls} shrink-0 ml-2`}>{d} {currentLanguage==='tr'?'gün':'days'}</span>
                          </div>
                          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div className={`h-full rounded-full ${cls}`} style={{ width: `${Math.min((d / 45) * 100, 100)}%` }} />
                          </div>
                          <p className="text-[10px] text-gray-400 mt-0.5">{currentLanguage==='tr'?'Stok':'Stock'}: {item.stockLevel} · {currentLanguage==='tr'?'Günlük':'Daily'}: {item.dailyUsage.toFixed(1)}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </>
  );
}
