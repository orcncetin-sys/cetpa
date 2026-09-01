/**
 * GenelBloklar2.tsx — GenelRapor bölmesi (2026-08-31)
 *
 * GenelRapor.tsx'ten mekanik olarak çıkarıldı (bölme öncesi satır 927–1462).
 * Bloklar ORİJİNAL SIRASIYLA ve içeriği DEĞİŞTİRİLMEDEN taşındı; bloklardaki
 * `reportsTab === 'genel'` koşulları BİLEREK korundu (bkz. GenelRapor.tsx
 * başlık notu — ebeveyn zaten sekmeye göre render ediyor, koşulu silmek
 * "saf kopya" güvencesini bozardı).
 * Props yalnız bu dosyanın gerçekten kullandığı ctx alanlarıdır
 * (tsc "Cannot find name" listesinden çıkarıldı).
 */
import { itemCostTRY, type ReportsCtx } from '../useReportsData';
import { type Order } from '../../../types';

type Props = Pick<ReportsCtx, 'reportsTab' | 'orders' | 'inventory' | 'employees' | 'exchangeRates' | 'currentLanguage' | 'fmtAna'>;

export default function GenelBloklar2({ reportsTab, orders, inventory, employees, exchangeRates, currentLanguage, fmtAna }: Props) {
  return (
    <>
      {reportsTab === 'genel' && orders.length >= 5 && (() => {
        const custRev220: Record<string, number> = {};
        for (const o of orders) {
          if (o.status === 'Cancelled') continue;
          const name = o.customerName || '—';
          custRev220[name] = (custRev220[name] ?? 0) + (o.totalPrice || 0);
        }
        const total220 = Object.values(custRev220).reduce((s, v) => s + v, 0);
        if (total220 === 0) return null;
        // HHI = sum of (market share %)^2 — normalized 0-10000
        const hhi = Object.values(custRev220).reduce((s, v) => s + Math.pow((v / total220) * 100, 2), 0);
        const hhiRounded = Math.round(hhi);
        const hhiLevel = hhiRounded > 2500 ? 'high' : hhiRounded > 1500 ? 'medium' : 'low';
        const custCount = Object.keys(custRev220).length;
        const avgRevPerCust = Math.round(total220 / custCount);
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '📐 Gelir Konsantrasyon Endeksi (HHI)' : '📐 Revenue Concentration Index (HHI)'}</h3>
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${hhiLevel === 'high' ? 'bg-red-100 text-red-700' : hhiLevel === 'medium' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                {hhiLevel === 'high' ? (currentLanguage === 'tr' ? 'Yüksek Risk' : 'High Risk') : hhiLevel === 'medium' ? (currentLanguage === 'tr' ? 'Orta Risk' : 'Med Risk') : (currentLanguage === 'tr' ? 'Düşük Risk' : 'Diversified')}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-3 mb-4">
              {[
                { label: 'HHI', value: hhiRounded.toLocaleString(), color: hhiLevel === 'high' ? 'text-red-500' : hhiLevel === 'medium' ? 'text-amber-500' : 'text-emerald-600', desc: currentLanguage === 'tr' ? 'Herfindahl Endeksi' : 'Herfindahl Index' },
                { label: currentLanguage === 'tr' ? 'Müşteri Sayısı' : 'Customers', value: String(custCount), color: 'text-blue-600', desc: currentLanguage === 'tr' ? 'Toplam aktif' : 'Total active' },
                { label: currentLanguage === 'tr' ? 'Müşteri Başı' : 'Avg per Customer', value: `₺${(avgRevPerCust/1000).toFixed(0)}K`, color: 'text-gray-700', desc: currentLanguage === 'tr' ? 'Ort. gelir' : 'Avg revenue' },
              ].map(k => (
                <div key={k.label} className="bg-gray-50 rounded-xl p-3 text-center">
                  <p className={`text-xl font-bold ${k.color}`}>{k.value}</p>
                  <p className="text-[10px] text-gray-600 font-medium mt-0.5">{k.label}</p>
                  <p className="text-[9px] text-gray-400">{k.desc}</p>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-1.5 bg-blue-50 rounded-xl p-3">
              <span className="text-blue-500">💡</span>
              <p className="text-[11px] text-blue-700">
                {currentLanguage === 'tr'
                  ? `HHI > 2500 yüksek, 1500-2500 orta, < 1500 düşük konsantrasyon. Şu an: ${hhiRounded} — ${hhiLevel === 'low' ? 'müşteri tabanı sağlıklı dağılmış.' : hhiLevel === 'medium' ? 'birkaç müşteriye bağımlılık var.' : 'kritik müşteri bağımlılığı!'}`
                  : `HHI > 2500 concentrated, 1500-2500 moderate, < 1500 diversified. Currently: ${hhiRounded} — ${hhiLevel === 'low' ? 'healthy diversification.' : hhiLevel === 'medium' ? 'moderate concentration.' : 'critical dependency!'}`}
              </p>
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 3 && (() => {
        const now222 = new Date();
        void now222;
        const backlogOrders = orders.filter(o => o.status === 'Pending' || o.status === 'Processing');
        const shippedOrders = orders.filter(o => o.status === 'Shipped');
        const backlogValue = backlogOrders.reduce((s, o) => s + (o.totalPrice || 0), 0);
        const shippedValue = shippedOrders.reduce((s, o) => s + (o.totalPrice || 0), 0);
        const totalPipeline = backlogValue + shippedValue;
        if (totalPipeline === 0) return null;
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '📋 Sipariş Biriktirme & Boru Hattı Değeri' : '📋 Order Backlog & Pipeline Value'}</h3>
              <span className="text-sm font-black text-blue-600">{fmtAna(totalPipeline,'K',0)}</span>
            </div>
            <div className="grid grid-cols-2 gap-4 mb-4">
              {[
                { label: currentLanguage === 'tr' ? 'Sipariş Birikimi' : 'Order Backlog', count: backlogOrders.length, value: backlogValue, color: 'text-amber-600', bg: 'bg-amber-50', icon: '⏳' },
                { label: currentLanguage === 'tr' ? 'Kargoda' : 'In Transit', count: shippedOrders.length, value: shippedValue, color: 'text-blue-600', bg: 'bg-blue-50', icon: '🚚' },
              ].map(k => (
                <div key={k.label} className={`${k.bg} rounded-2xl p-4`}>
                  <p className="text-xl mb-1">{k.icon}</p>
                  <p className={`text-2xl font-black ${k.color}`}>{fmtAna(k.value,'K',0)}</p>
                  <p className="text-xs text-gray-600 font-medium mt-1">{k.label}</p>
                  <p className="text-[10px] text-gray-400">{k.count} {currentLanguage === 'tr' ? 'sipariş' : 'orders'}</p>
                </div>
              ))}
            </div>
            <div className="h-3 bg-gray-100 rounded-full overflow-hidden flex">
              <div className="h-full bg-amber-400" style={{ width: `${totalPipeline > 0 ? Math.round((backlogValue / totalPipeline) * 100) : 0}%` }} />
              <div className="h-full bg-blue-400" style={{ width: `${totalPipeline > 0 ? Math.round((shippedValue / totalPipeline) * 100) : 0}%` }} />
            </div>
            <p className="text-[10px] text-gray-400 mt-2">{currentLanguage === 'tr' ? 'İşlenmemiş ve kargodaki siparişlerin toplam değeri' : 'Total value of unprocessed and in-transit orders'}</p>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 3 && (() => {
        const now225 = new Date();
        const monthStart225 = new Date(now225.getFullYear(), now225.getMonth(), 1);
        const daysInMonth = new Date(now225.getFullYear(), now225.getMonth() + 1, 0).getDate();
        const dayOfMonth = now225.getDate();
        const monthProgress = Math.round((dayOfMonth / daysInMonth) * 100);
        const mRevenue225 = orders.filter(o => {
          if (o.status === 'Cancelled') return false;
          try {
            const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
            return od >= monthStart225;
          } catch { return false; }
        }).reduce((s, o) => s + (o.totalPrice || 0), 0);
        const mOrders225 = orders.filter(o => {
          if (o.status === 'Cancelled') return false;
          try {
            const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
            return od >= monthStart225;
          } catch { return false; }
        }).length;
        const mNewCustomers225 = new Set(orders.filter(o => {
          if (o.status === 'Cancelled') return false;
          try {
            const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
            return od >= monthStart225;
          } catch { return false; }
        }).map(o => o.customerName || '—')).size;
        // Pace = what we'd expect at current run rate by end of month
        const pace225 = dayOfMonth > 0 ? Math.round((mRevenue225 / dayOfMonth) * daysInMonth) : 0;
        const goals = [
          { label: currentLanguage === 'tr' ? 'Aylık Ciro' : 'Monthly Revenue', current: mRevenue225, pace: pace225, icon: '💰', format: (v: number) => `₺${(v/1000).toFixed(0)}K` },
          { label: currentLanguage === 'tr' ? 'Sipariş Adedi' : 'Order Count', current: mOrders225, pace: dayOfMonth > 0 ? Math.round((mOrders225 / dayOfMonth) * daysInMonth) : 0, icon: '📦', format: (v: number) => String(v) },
          { label: currentLanguage === 'tr' ? 'Aktif Müşteri' : 'Active Customers', current: mNewCustomers225, pace: dayOfMonth > 0 ? Math.round((mNewCustomers225 / dayOfMonth) * daysInMonth) : 0, icon: '👥', format: (v: number) => String(v) },
        ];
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '🎯 Aylık İlerleme Göstergesi' : '🎯 Monthly Goal Progress'}</h3>
              <span className="text-xs font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">
                {currentLanguage === 'tr' ? `Ay: %${monthProgress} tamamlandı (${dayOfMonth}/${daysInMonth} gün)` : `Month: ${monthProgress}% complete (day ${dayOfMonth}/${daysInMonth})`}
              </span>
            </div>
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden mb-4">
              <div className="h-full bg-blue-400 rounded-full" style={{ width: `${monthProgress}%` }} />
            </div>
            <div className="space-y-4">
              {goals.map(g => {
                const paceVsMonth = monthProgress > 0 ? Math.round((g.current / (g.pace || 1)) * 100) : 0;
                const isAhead = paceVsMonth >= 100;
                return (
                  <div key={g.label}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span>{g.icon}</span>
                        <span className="text-xs font-medium text-gray-700">{g.label}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 ml-2">
                        <span className="text-xs text-gray-700 font-bold">{g.format(g.current)}</span>
                        <span className="text-[10px] text-gray-400">→ {g.format(g.pace)} {currentLanguage === 'tr' ? 'tahmini' : 'projected'}</span>
                        <span className={`text-[10px] font-bold px-1 py-0.5 rounded ${isAhead ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                          {isAhead ? '▲' : '▼'} %{Math.abs(paceVsMonth - 100)}
                        </span>
                      </div>
                    </div>
                    <div className="relative h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${isAhead ? 'bg-emerald-400' : 'bg-amber-400'}`} style={{ width: `${Math.min(paceVsMonth, 100)}%` }} />
                      <div className="absolute top-0 h-full w-px bg-blue-400 opacity-60" style={{ left: `${monthProgress}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="text-[10px] text-gray-400 mt-3">{currentLanguage === 'tr' ? 'Mavi çizgi = ayın şu anki günü. Yeşil = hedefin önünde, Sarı = hedefin gerisinde.' : 'Blue line = current day in month. Green = ahead of pace, Amber = behind pace.'}</p>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 5 && (() => {
        const now234 = new Date();
        // Last 8 weeks
        const weeks234 = Array.from({ length: 8 }, (_, i) => {
          const weekStart = new Date(now234);
          weekStart.setDate(weekStart.getDate() - (7 - i) * 7 - weekStart.getDay());
          weekStart.setHours(0, 0, 0, 0);
          const weekEnd = new Date(weekStart); weekEnd.setDate(weekEnd.getDate() + 6); weekEnd.setHours(23, 59, 59, 999);
          const label = `W${weekStart.toLocaleDateString(currentLanguage === 'tr' ? 'tr-TR' : 'en-US', { month: 'short', day: 'numeric' })}`;
          const rev = orders.filter(o => {
            if (o.status === 'Cancelled') return false;
            try {
              const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
              return od >= weekStart && od <= weekEnd;
            } catch { return false; }
          }).reduce((s, o) => s + (o.totalPrice || 0), 0);
          return { label, rev, weekStart };
        });
        const hasData = weeks234.some(w => w.rev > 0);
        if (!hasData) return null;
        const maxWeekRev = Math.max(...weeks234.map(w => w.rev), 1);
        const lastWeek = weeks234[weeks234.length - 1].rev;
        const prevWeek = weeks234[weeks234.length - 2].rev;
        const weekGrowth = prevWeek > 0 ? Math.round(((lastWeek - prevWeek) / prevWeek) * 100) : null;
        const annualRunRate = lastWeek * 52;
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '📅 Haftalık Ciro & Yıllık Projeksiyon' : '📅 Weekly Revenue & Annual Run Rate'}</h3>
              {weekGrowth !== null && (
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${weekGrowth >= 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                  {weekGrowth >= 0 ? '↑' : '↓'} %{Math.abs(weekGrowth)} WoW
                </span>
              )}
            </div>
            <div className="flex items-end gap-1.5 h-24 mb-3">
              {weeks234.map((w, i) => {
                const isLatest = i === weeks234.length - 1;
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1">
                    <div className="w-full flex items-end" style={{ height: '68px' }}>
                      <div className={`w-full rounded-t-md ${isLatest ? 'bg-brand' : 'bg-gray-200'}`} style={{ height: `${Math.max(4, Math.round((w.rev / maxWeekRev) * 68))}px` }} />
                    </div>
                    <span className={`text-[8px] leading-none ${isLatest ? 'font-bold text-brand' : 'text-gray-400'}`}>{w.label}</span>
                  </div>
                );
              })}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-gray-50 rounded-xl p-3 text-center">
                <p className="text-xl font-black text-gray-700">{fmtAna(lastWeek,'K',0)}</p>
                <p className="text-[10px] text-gray-400">{currentLanguage === 'tr' ? 'Bu hafta' : 'This week'}</p>
              </div>
              <div className="bg-blue-50 rounded-xl p-3 text-center">
                <p className="text-xl font-black text-blue-600">{fmtAna(annualRunRate,'K',0)}</p>
                <p className="text-[10px] text-gray-400">{currentLanguage === 'tr' ? 'Yıllık projeksiyon' : 'Annual run rate'}</p>
              </div>
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 5 && inventory.length > 0 && (() => {
        const now235 = new Date();
        const prevMonthStart235 = new Date(now235.getFullYear(), now235.getMonth() - 1, 1);
        const prevMonthEnd235 = new Date(now235.getFullYear(), now235.getMonth(), 0, 23, 59, 59);
        const currMonthStart235 = new Date(now235.getFullYear(), now235.getMonth(), 1);
        const calcMargin = (ordersList: Order[]) => {
          const rev = ordersList.reduce((s, o) => s + (o.totalPrice || 0), 0);
          const cogs = ordersList.reduce((s, o) =>
            s + (o.lineItems ?? []).reduce((ls, li) => {
              const inv = inventory.find(ii => ii.id === li.inventoryId || ii.name === li.name);
              return ls + (inv ? itemCostTRY(inv, exchangeRates) : li.price * 0.6) * li.quantity;
            }, 0), 0);
          return { rev, cogs, margin: rev > 0 ? Math.round(((rev - cogs) / rev) * 100) : 0, gross: rev - cogs };
        };
        const filterOrders = (start: Date, end: Date) => orders.filter(o => {
          if (o.status === 'Cancelled') return false;
          try {
            const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
            return od >= start && od <= end;
          } catch { return false; }
        });
        const prev235 = calcMargin(filterOrders(prevMonthStart235, prevMonthEnd235));
        const curr235 = calcMargin(filterOrders(currMonthStart235, new Date()));
        if (prev235.rev === 0 && curr235.rev === 0) return null;
        const revChange = curr235.rev - prev235.rev;
        const grossChange = curr235.gross - prev235.gross;
        const marginChange = curr235.margin - prev235.margin;
        const bridges = [
          { label: currentLanguage === 'tr' ? 'Önceki Ay Brüt Kâr' : 'Prior Month Gross Profit', value: prev235.gross, neutral: true },
          { label: currentLanguage === 'tr' ? 'Ciro Değişimi Etkisi' : 'Revenue Volume Effect', value: revChange * (prev235.margin / 100), neutral: false },
          { label: currentLanguage === 'tr' ? 'Marj Değişimi Etkisi' : 'Margin Mix Effect', value: grossChange - revChange * (prev235.margin / 100), neutral: false },
          { label: currentLanguage === 'tr' ? 'Bu Ay Brüt Kâr' : 'Current Month Gross Profit', value: curr235.gross, neutral: true, total: true },
        ];
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '🌉 Marj Köprü Analizi (MoM)' : '🌉 Margin Bridge Analysis (MoM)'}</h3>
              <span className={`text-sm font-bold px-2 py-0.5 rounded-full ${marginChange >= 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                {marginChange >= 0 ? '+' : ''}{marginChange}pp {currentLanguage === 'tr' ? 'marj' : 'margin'}
              </span>
            </div>
            <div className="space-y-2">
              {bridges.map((b, i) => (
                <div key={i} className={`flex items-center justify-between p-2.5 rounded-xl ${b.total ? 'bg-blue-50' : b.neutral ? 'bg-gray-50' : b.value >= 0 ? 'bg-emerald-50' : 'bg-red-50'}`}>
                  <span className={`text-xs font-medium ${b.total ? 'text-blue-800 font-bold' : 'text-gray-700'}`}>{b.label}</span>
                  <span className={`text-sm font-bold shrink-0 ml-2 ${b.total ? 'text-blue-700' : b.neutral ? 'text-gray-700' : b.value >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                    {!b.neutral && b.value >= 0 ? '+' : ''}{b.neutral ? '' : b.value >= 0 ? '' : ''}{fmtAna(Math.abs(b.value),'K',0)}{!b.neutral && b.value < 0 ? ' ▼' : !b.neutral ? ' ▲' : ''}
                  </span>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-4 mt-3 text-[10px] text-gray-500">
              <span>{currentLanguage === 'tr' ? 'Önceki: ' : 'Prior: '}{fmtAna(prev235.rev,'K',0)} · %{prev235.margin}</span>
              <span>{currentLanguage === 'tr' ? 'Bu ay: ' : 'Current: '}{fmtAna(curr235.rev,'K',0)} · %{curr235.margin}</span>
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 5 && inventory.length > 0 && (() => {
        const now239 = new Date();
        const months3Start = new Date(now239.getFullYear(), now239.getMonth() - 3, 1);
        const recentOrders = orders.filter(o => {
          if (o.status === 'Cancelled') return false;
          try {
            const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
            return od >= months3Start;
          } catch { return false; }
        });
        const revenue239 = recentOrders.reduce((s, o) => s + (o.totalPrice || 0), 0);
        const cogs239 = recentOrders.reduce((s, o) =>
          s + (o.lineItems ?? []).reduce((ls, li) => {
            const inv = inventory.find(ii => ii.id === li.inventoryId || ii.name === li.name);
            return ls + (inv ? itemCostTRY(inv, exchangeRates) : li.price * 0.6) * li.quantity;
          }, 0), 0);
        const grossProfit = revenue239 - cogs239;
        const grossMargin = revenue239 > 0 ? Math.round((grossProfit / revenue239) * 100) : 0;
        const inventoryVal239 = inventory.reduce((s, i) => s + itemCostTRY(i, exchangeRates) * (i.stockLevel ?? 0), 0);
        const arVal = orders.filter(o => o.status !== 'Cancelled' && o.status !== 'Delivered').reduce((s, o) => s + (o.totalPrice || 0), 0);
        const monthlyRevRate = revenue239 / 3;
        const kpis239 = [
          { label: 'Gross Margin', value: `%${grossMargin}`, score: grossMargin >= 30 ? 'A' : grossMargin >= 20 ? 'B' : grossMargin >= 10 ? 'C' : 'D', desc: currentLanguage === 'tr' ? 'Brüt marj' : 'Gross margin' },
          { label: 'Revenue Trend', value: revenue239 > 0 ? '▲' : '—', score: revenue239 > monthlyRevRate * 2.5 ? 'A' : revenue239 > monthlyRevRate ? 'B' : 'C', desc: currentLanguage === 'tr' ? '3 aylık ciro' : '3-month revenue' },
          { label: 'AR Health', value: arVal > 0 ? `₺${(arVal/1000).toFixed(0)}K` : '✓', score: arVal <= monthlyRevRate * 0.5 ? 'A' : arVal <= monthlyRevRate ? 'B' : 'C', desc: currentLanguage === 'tr' ? 'Tahsilat bekleyen' : 'Outstanding AR' },
          { label: 'Inventory', value: `₺${(inventoryVal239/1000).toFixed(0)}K`, score: inventoryVal239 <= cogs239 * 1.5 ? 'A' : inventoryVal239 <= cogs239 * 2.5 ? 'B' : 'C', desc: currentLanguage === 'tr' ? 'Stok değeri' : 'Stock value' },
        ];
        const gradeColor: Record<string, string> = { A: 'text-emerald-600 bg-emerald-100', B: 'text-blue-600 bg-blue-100', C: 'text-amber-600 bg-amber-100', D: 'text-red-600 bg-red-100' };
        const overallScore = Math.round(['A','B','C','D'].map((g, i) => kpis239.filter(k => k.score === g).length * (4 - i)).reduce((s, v) => s + v, 0) / kpis239.length);
        const overallGrade = overallScore >= 3.5 ? 'A' : overallScore >= 2.5 ? 'B' : overallScore >= 1.5 ? 'C' : 'D';
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '🏦 Finansal Sağlık Göstergesi' : '🏦 Financial Health Dashboard'}</h3>
              <span className={`text-2xl font-black px-3 py-1 rounded-xl ${gradeColor[overallGrade]}`}>{overallGrade}</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {kpis239.map(k => (
                <div key={k.label} className="bg-gray-50 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">{k.label}</p>
                    <span className={`text-xs font-black px-1.5 py-0.5 rounded ${gradeColor[k.score]}`}>{k.score}</span>
                  </div>
                  <p className="text-xl font-black text-gray-700">{k.value}</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">{k.desc}</p>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 3 && (() => {
        const now245 = new Date();
        const monthStart245 = new Date(now245.getFullYear(), now245.getMonth(), 1);
        const prevMonthStart245 = new Date(now245.getFullYear(), now245.getMonth() - 1, 1);
        const prevMonthEnd245 = new Date(now245.getFullYear(), now245.getMonth(), 0, 23, 59, 59);
        const filterOrders245 = (start: Date, end: Date) => orders.filter(o => {
          if (o.status === 'Cancelled') return false;
          try {
            const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
            return od >= start && od <= end;
          } catch { return false; }
        });
        const currOrders = filterOrders245(monthStart245, new Date());
        const prevOrders = filterOrders245(prevMonthStart245, prevMonthEnd245);
        const currRev = currOrders.reduce((s, o) => s + (o.totalPrice || 0), 0);
        const prevRev = prevOrders.reduce((s, o) => s + (o.totalPrice || 0), 0);
        const revGrowth = prevRev > 0 ? Math.round(((currRev - prevRev) / prevRev) * 100) : null;
        const currCusts = new Set(currOrders.map(o => o.customerName || '—')).size;
        const prevCusts = new Set(prevOrders.map(o => o.customerName || '—')).size;
        const custGrowth = prevCusts > 0 ? Math.round(((currCusts - prevCusts) / prevCusts) * 100) : null;
        const currAOV = currOrders.length > 0 ? Math.round(currRev / currOrders.length) : 0;
        const prevAOV = prevOrders.length > 0 ? Math.round(prevOrders.reduce((s, o) => s + (o.totalPrice || 0), 0) / prevOrders.length) : 0;
        const aovGrowth245 = prevAOV > 0 ? Math.round(((currAOV - prevAOV) / prevAOV) * 100) : null;
        const kpis245 = [
          { icon: '💰', label: currentLanguage === 'tr' ? 'Bu Ay Ciro' : 'Month Revenue', value: `₺${(currRev/1000).toFixed(0)}K`, growth: revGrowth },
          { icon: '📦', label: currentLanguage === 'tr' ? 'Sipariş' : 'Orders', value: String(currOrders.length), growth: prevOrders.length > 0 ? Math.round(((currOrders.length - prevOrders.length) / prevOrders.length) * 100) : null },
          { icon: '👥', label: currentLanguage === 'tr' ? 'Aktif Müşteri' : 'Active Customers', value: String(currCusts), growth: custGrowth },
          { icon: '🛒', label: 'AOV', value: `₺${(currAOV/1000).toFixed(1)}K`, growth: aovGrowth245 },
        ];
        return (
          <div className="apple-card p-6 border-2 border-brand/20">
            <div className="flex items-center gap-2 mb-4">
              <span className="text-xl">📋</span>
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? 'Yönetici KPI Özeti' : 'Executive KPI Summary'}</h3>
              <span className="text-[10px] text-gray-400 ml-auto">{now245.toLocaleDateString(currentLanguage === 'tr' ? 'tr-TR' : 'en-US', { month: 'long', year: 'numeric' })}</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {kpis245.map(k => (
                <div key={k.label} className="bg-gray-50 rounded-2xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-lg">{k.icon}</span>
                    {k.growth !== null && (
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${k.growth >= 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                        {k.growth >= 0 ? '↑' : '↓'} %{Math.abs(k.growth)}
                      </span>
                    )}
                  </div>
                  <p className="text-2xl font-black text-gray-800">{k.value}</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">{k.label}</p>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 5 && (() => {
        const methodMap: Record<string, { count: number; rev: number }> = {};
        for (const o of orders) {
          if (o.status === 'Cancelled') continue;
          const m = o as unknown as Record<string,unknown>;
          const method = (m.paymentMethod as string) || (m.payment as string) || (currentLanguage === 'tr' ? 'Belirtilmemiş' : 'Not specified');
          if (!methodMap[method]) methodMap[method] = { count: 0, rev: 0 };
          methodMap[method].count++;
          methodMap[method].rev += o.totalPrice || 0;
        }
        const methodList = Object.entries(methodMap).sort(([,a],[,b]) => b.rev - a.rev);
        if (methodList.length < 2) return null;
        const totalRev249 = methodList.reduce((s,[,v]) => s + v.rev, 0);
        const COLORS249 = ['bg-brand', 'bg-blue-400', 'bg-emerald-400', 'bg-amber-400', 'bg-purple-400'];
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-4">{currentLanguage === 'tr' ? '💳 Ödeme Yöntemi Dağılımı' : '💳 Payment Method Distribution'}</h3>
            <div className="space-y-2.5">
              {methodList.slice(0, 5).map(([method, d], i) => {
                const pct = totalRev249 > 0 ? Math.round((d.rev / totalRev249) * 100) : 0;
                return (
                  <div key={method}>
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-xs font-medium text-gray-700 capitalize">{method}</span>
                      <div className="flex items-center gap-2 shrink-0 ml-2">
                        <span className="text-[10px] text-gray-400">{d.count} {currentLanguage === 'tr' ? 'sipariş' : 'orders'}</span>
                        <span className="text-[10px] font-bold text-gray-500">%{pct}</span>
                        <span className="text-xs font-bold text-gray-700">{fmtAna(d.rev,'K',0)}</span>
                      </div>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${COLORS249[i] ?? 'bg-gray-400'}`} style={{ width: `${Math.max(4, pct)}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 5 && inventory.length > 0 && employees.length > 0 && (() => {
        const now250 = new Date();
        const m3Start = new Date(now250.getFullYear(), now250.getMonth() - 3, 1);
        const recentOrds = orders.filter(o => {
          if (o.status === 'Cancelled') return false;
          try {
            const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
            return od >= m3Start;
          } catch { return false; }
        });
        const rev250 = recentOrds.reduce((s, o) => s + (o.totalPrice || 0), 0);
        const activeEmp250 = employees.filter(e => e.status === 'Aktif').length;
        const lowStockCount = inventory.filter(i => (i.stockLevel ?? 0) <= (i.lowStockThreshold ?? i.minStock ?? 5)).length;
        const inventoryVal250 = inventory.reduce((s, i) => s + itemCostTRY(i, exchangeRates) * (i.stockLevel ?? 0), 0);
        const totalOrds250 = recentOrds.length;
        const uniqueCusts250 = new Set(recentOrds.map(o => o.customerName || '—')).size;
        const openOrds = orders.filter(o => o.status === 'Pending' || o.status === 'Processing').length;
        const insights = [
          rev250 > 0 && `💰 ${currentLanguage === 'tr' ? `Son 3 ayda ₺${(rev250/1000).toFixed(0)}K ciro` : `₺${(rev250/1000).toFixed(0)}K revenue in last 3 months`}`,
          `📦 ${currentLanguage === 'tr' ? `${totalOrds250} sipariş, ${uniqueCusts250} benzersiz müşteri` : `${totalOrds250} orders from ${uniqueCusts250} unique customers`}`,
          `👥 ${currentLanguage === 'tr' ? `${activeEmp250} aktif çalışan` : `${activeEmp250} active employees`}`,
          `🏭 ${currentLanguage === 'tr' ? `₺${(inventoryVal250/1000).toFixed(0)}K stok değeri` : `₺${(inventoryVal250/1000).toFixed(0)}K inventory value`}`,
          lowStockCount > 0 && `⚠️ ${currentLanguage === 'tr' ? `${lowStockCount} ürün kritik stok seviyesinde` : `${lowStockCount} items at critical stock level`}`,
          openOrds > 0 && `⏳ ${currentLanguage === 'tr' ? `${openOrds} sipariş işleme bekliyor` : `${openOrds} orders awaiting processing`}`,
        ].filter(Boolean) as string[];
        return (
          <div className="apple-card p-6 bg-gradient-to-br from-gray-50 to-white border border-gray-100">
            <div className="flex items-center gap-2 mb-4">
              <span className="text-2xl">🔭</span>
              <div>
                <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '360° İş Zekası Özeti' : '360° Business Intelligence Summary'}</h3>
                <p className="text-[10px] text-gray-400">{now250.toLocaleDateString(currentLanguage === 'tr' ? 'tr-TR' : 'en-US', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
              </div>
            </div>
            <div className="space-y-2.5">
              {insights.map((insight, i) => (
                <div key={i} className="flex items-start gap-2.5 p-3 bg-white rounded-xl shadow-sm border border-gray-50">
                  <p className="text-xs text-gray-700 leading-relaxed">{insight}</p>
                </div>
              ))}
            </div>
            <div className="mt-4 p-3 bg-brand/5 rounded-xl border border-brand/10">
              <p className="text-[11px] text-brand font-semibold">{currentLanguage === 'tr' ? '🚀 Cetpa ERP Analytics · 250 Faz tamamlandı' : '🚀 Cetpa ERP Analytics · 250 Phases Complete'}</p>
              <p className="text-[10px] text-gray-500 mt-0.5">{currentLanguage === 'tr' ? 'Finansal, satış, lojistik, envanter ve İK analizleri entegre edildi.' : 'Financial, sales, logistics, inventory, and HR analytics fully integrated.'}</p>
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 10 && (() => {
        const now251 = new Date();
        const currYear = now251.getFullYear();
        const prevYear = currYear - 1;
        const months251 = Array.from({ length: 12 }, (_, i) => {
          const label = new Date(currYear, i, 1).toLocaleDateString(currentLanguage === 'tr' ? 'tr-TR' : 'en-US', { month: 'short' });
          const curr = orders.filter(o => {
            if (o.status === 'Cancelled') return false;
            try { const d = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string); return d.getFullYear() === currYear && d.getMonth() === i; } catch { return false; }
          }).reduce((s, o) => s + (o.totalPrice || 0), 0);
          const prev = orders.filter(o => {
            if (o.status === 'Cancelled') return false;
            try { const d = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string); return d.getFullYear() === prevYear && d.getMonth() === i; } catch { return false; }
          }).reduce((s, o) => s + (o.totalPrice || 0), 0);
          return { label, curr, prev };
        });
        const hasPrev = months251.some(m => m.prev > 0);
        const totalCurr = months251.reduce((s, m) => s + m.curr, 0);
        const totalPrev = months251.reduce((s, m) => s + m.prev, 0);
        const yoyGrowth = totalPrev > 0 ? Math.round(((totalCurr - totalPrev) / totalPrev) * 100) : null;
        if (totalCurr === 0) return null;
        const maxVal251 = Math.max(...months251.map(m => Math.max(m.curr, m.prev)), 1);
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '📅 Yıllık Ciro Karşılaştırması (YoY)' : '📅 Year-over-Year Revenue Comparison'}</h3>
              {yoyGrowth !== null && (
                <span className={`text-sm font-bold px-2 py-0.5 rounded-full ${yoyGrowth >= 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                  {yoyGrowth >= 0 ? '↑' : '↓'} %{Math.abs(yoyGrowth)} YoY
                </span>
              )}
            </div>
            <div className="flex items-end gap-1 h-28 mb-2">
              {months251.map((m, i) => {
                const currH = Math.round((m.curr / maxVal251) * 80);
                const prevH = Math.round((m.prev / maxVal251) * 80);
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                    <div className="w-full flex items-end gap-px" style={{ height: '80px' }}>
                      <div className="flex-1 bg-brand rounded-t-sm" style={{ height: `${Math.max(m.curr > 0 ? 2 : 0, currH)}px` }} />
                      {hasPrev && <div className="flex-1 bg-gray-200 rounded-t-sm" style={{ height: `${Math.max(m.prev > 0 ? 2 : 0, prevH)}px` }} />}
                    </div>
                    <span className="text-[8px] text-gray-400 leading-none">{m.label}</span>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center gap-4 mb-3">
              <div className="flex items-center gap-1"><div className="w-3 h-2 rounded-sm bg-brand" /><span className="text-[10px] text-gray-500">{currYear}: {fmtAna(totalCurr,'K',0)}</span></div>
              {hasPrev && <div className="flex items-center gap-1"><div className="w-3 h-2 rounded-sm bg-gray-300" /><span className="text-[10px] text-gray-500">{prevYear}: {fmtAna(totalPrev,'K',0)}</span></div>}
            </div>
          </div>
        );
      })()}
    </>
  );
}
