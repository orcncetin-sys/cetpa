/**
 * GenelBloklar1.tsx — GenelRapor bölmesi (2026-08-31)
 *
 * GenelRapor.tsx'ten mekanik olarak çıkarıldı (bölme öncesi satır 391–926).
 * Bloklar ORİJİNAL SIRASIYLA ve içeriği DEĞİŞTİRİLMEDEN taşındı; bloklardaki
 * `reportsTab === 'genel'` koşulları BİLEREK korundu (bkz. GenelRapor.tsx
 * başlık notu — ebeveyn zaten sekmeye göre render ediyor, koşulu silmek
 * "saf kopya" güvencesini bozardı).
 * Props yalnız bu dosyanın gerçekten kullandığı ctx alanlarıdır
 * (tsc "Cannot find name" listesinden çıkarıldı).
 */
import { itemCostTRY, brutMarj, type ReportsCtx } from '../useReportsData';

type Props = Pick<ReportsCtx, 'reportsTab' | 'orders' | 'inventory' | 'exchangeRates' | 'currentLanguage' | 'fmtAna'>;

export default function GenelBloklar1({ reportsTab, orders, inventory, exchangeRates, currentLanguage, fmtAna }: Props) {
  return (
    <>
      {reportsTab === 'genel' && orders.length >= 3 && inventory.length > 0 && (() => {
        const now166 = new Date();
        const months166 = Array.from({ length: 6 }, (_, i) => {
          const d = new Date(now166.getFullYear(), now166.getMonth() - (5 - i), 1);
          const label = d.toLocaleDateString(currentLanguage === 'tr' ? 'tr-TR' : 'en-US', { month: 'short' });
          const mOrders = orders.filter(o => {
            if (o.status === 'Cancelled') return false;
            try {
              const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
              return od.getFullYear() === d.getFullYear() && od.getMonth() === d.getMonth();
            } catch { return false; }
          });
          // Kalemi olmayan siparis (Mikro fatura turevi / sentetik) marj hesabina
          // GIRMEZ — aksi halde maliyet 0 sayilip marj %100'e sisiyordu (2026-09-04).
          const mm = brutMarj(mOrders, inventory, exchangeRates);
          return { label, rev: mm.ciro, cogs: mm.maliyet, margin: mm.marj, kapsamDisi: mm.kapsamDisi, toplamCiro: mm.toplamCiro };
        });
        // Marji BILINMEYEN ay (kalem verisi yok) ortalamaya katilmaz; hicbiri
        // bilinmiyorsa ortalama da null'dur ('—' gosterilir, 0 degil).
        const marjliAylar = months166.filter(m => m.margin !== null);
        const avgMargin: number | null = marjliAylar.length > 0
          ? Math.round(marjliAylar.reduce((s, m) => s + (m.margin as number), 0) / marjliAylar.length)
          : null;
        const kapsamDisiToplam = months166.reduce((s, m) => s + m.kapsamDisi, 0);
        const maxRev166 = Math.max(...months166.map(m => m.rev), 1);
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '📈 Aylık Brüt Marj Trendi' : '📈 Monthly Gross Margin Trend'}</h3>
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${avgMargin === null ? 'bg-gray-100 text-gray-500' : avgMargin >= 30 ? 'bg-emerald-100 text-emerald-700' : avgMargin >= 15 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-600'}`}
                title={kapsamDisiToplam > 0 ? (currentLanguage === 'tr' ? `${kapsamDisiToplam} sipariş kalem verisi olmadığı için marj hesabının DIŞINDA (cirosu grafikte, maliyeti bilinmiyor)` : `${kapsamDisiToplam} orders excluded from margin (no line items)`) : undefined}>
                {avgMargin === null ? 'Ø —' : `Ø %${avgMargin}`}
              </span>
            </div>
            <div className="flex items-end gap-3 h-28 mb-3">
              {months166.map((m, i) => {
                const revH = Math.round((m.rev / maxRev166) * 100);
                const cogsH = m.rev > 0 ? Math.round((m.cogs / m.rev) * revH) : 0;
                const gpH = Math.max(revH - cogsH, 0);
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1 group cursor-default">
                    <div className="w-full flex flex-col justify-end overflow-hidden rounded-t-md" style={{ height: '88px' }}>
                      <div className="w-full" style={{ height: `${revH}%` }}>
                        <div className="w-full bg-blue-100 rounded-t-md" style={{ height: `${cogsH > 0 ? (cogsH/revH)*100 : 0}%` }} />
                        <div className="w-full bg-emerald-400" style={{ height: `${gpH > 0 ? (gpH/revH)*100 : 0}%` }} />
                      </div>
                    </div>
                    <span className="text-[9px] text-gray-400">{m.label}</span>
                    <span className={`text-[9px] font-bold ${m.margin === null ? 'text-gray-400' : m.margin >= 30 ? 'text-emerald-600' : m.margin >= 15 ? 'text-amber-600' : 'text-red-500'}`}>{m.margin === null ? '—' : `%${m.margin}`}</span>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center gap-4 text-[10px] text-gray-500">
              <span className="flex items-center gap-1"><span className="w-3 h-2 bg-emerald-400 rounded-sm inline-block" />{currentLanguage==='tr'?'Brüt Kâr':'Gross Profit'}</span>
              <span className="flex items-center gap-1"><span className="w-3 h-2 bg-blue-100 rounded-sm inline-block" />{currentLanguage==='tr'?'Maliyet':'COGS'}</span>
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 5 && (() => {
        const now156 = new Date();
        const getQuarter = (d: Date) => Math.floor(d.getMonth() / 3);
        const getQLabel = (year: number, q: number) => `Q${q + 1} ${year}`;
        // Last 4 quarters
        const quarters: { label: string; year: number; q: number; revenue: number; orders: number }[] = [];
        for (let i = 3; i >= 0; i--) {
          const qDate = new Date(now156.getFullYear(), now156.getMonth() - i * 3, 1);
          const year = qDate.getFullYear();
          const q = getQuarter(qDate);
          quarters.push({ label: getQLabel(year, q), year, q, revenue: 0, orders: 0 });
        }
        for (const o of orders) {
          if (o.status === 'Cancelled') continue;
          try {
            const d = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
            const oq = getQuarter(d);
            const entry = quarters.find(qt => qt.year === d.getFullYear() && qt.q === oq);
            if (entry) { entry.revenue += o.totalPrice || 0; entry.orders++; }
          } catch { /* skip */ }
        }
        const maxQ = Math.max(...quarters.map(q => q.revenue), 1);
        const currQ = quarters[quarters.length - 1];
        const prevQ = quarters[quarters.length - 2];
        const growth = prevQ.revenue > 0 ? Math.round(((currQ.revenue - prevQ.revenue) / prevQ.revenue) * 100) : null;
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '📊 Çeyrek Bazlı Karşılaştırma' : '📊 Quarter-over-Quarter Revenue'}</h3>
              {growth !== null && (
                <span className={`text-sm font-bold px-2 py-0.5 rounded-full ${growth >= 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                  {growth >= 0 ? '↑' : '↓'} %{Math.abs(growth)} QoQ
                </span>
              )}
            </div>
            <div className="flex items-end gap-4 h-36 mb-3">
              {quarters.map((q, i) => {
                const h = Math.round((q.revenue / maxQ) * 100);
                const isLatest = i === quarters.length - 1;
                return (
                  <div key={q.label} className="flex-1 flex flex-col items-center gap-1">
                    <span className="text-[10px] font-semibold text-gray-600 tabular-nums">{fmtAna(q.revenue,'K',0)}</span>
                    <div className="w-full flex flex-col justify-end" style={{ height: '96px' }}>
                      <div className={`w-full rounded-t-xl transition-all duration-700 ${isLatest ? 'bg-brand' : 'bg-brand/30'}`}
                        style={{ height: `${Math.max(h, 3)}%` }} />
                    </div>
                    <span className={`text-[10px] font-bold ${isLatest ? 'text-brand' : 'text-gray-400'}`}>{q.label}</span>
                    <span className="text-[9px] text-gray-400">{q.orders} {currentLanguage==='tr'?'sip':'ord'}</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 6 && (() => {
        const now190 = new Date();
        // Last 6 months revenue
        const months190 = Array.from({ length: 6 }, (_, i) => {
          const d = new Date(now190.getFullYear(), now190.getMonth() - (5 - i), 1);
          const rev = orders.filter(o => {
            if (o.status === 'Cancelled') return false;
            try {
              const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
              return od.getFullYear() === d.getFullYear() && od.getMonth() === d.getMonth();
            } catch { return false; }
          }).reduce((s, o) => s + (o.totalPrice || 0), 0);
          return { x: i, rev };
        });
        // Simple linear regression
        const n = months190.length;
        const sumX = months190.reduce((s, m) => s + m.x, 0);
        const sumY = months190.reduce((s, m) => s + m.rev, 0);
        const sumXY = months190.reduce((s, m) => s + m.x * m.rev, 0);
        const sumX2 = months190.reduce((s, m) => s + m.x * m.x, 0);
        const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX || 1);
        const intercept = (sumY - slope * sumX) / n;
        const forecast = [1, 2, 3].map(f => ({
          label: new Date(now190.getFullYear(), now190.getMonth() + f, 1)
            .toLocaleDateString(currentLanguage === 'tr' ? 'tr-TR' : 'en-US', { month: 'short', year: '2-digit' }),
          rev: Math.max(0, Math.round(slope * (n - 1 + f) + intercept)),
        }));
        const maxForecast = Math.max(...months190.map(m => m.rev), ...forecast.map(f => f.rev), 1);
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '🔮 Gelir Tahmini (3 Ay)' : '🔮 Revenue Forecast (3 Month)'}</h3>
              <span className="text-[10px] text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{currentLanguage === 'tr' ? 'Doğrusal trend' : 'Linear trend model'}</span>
            </div>
            <div className="flex items-end gap-1.5 h-28 mb-3">
              {months190.map((m, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <div className="w-full flex items-end justify-center" style={{ height: '80px' }}>
                    <div className="w-full bg-blue-300 rounded-t-md" style={{ height: `${Math.max(4, Math.round((m.rev / maxForecast) * 80))}px` }} />
                  </div>
                </div>
              ))}
              {forecast.map((f, i) => (
                <div key={`f${i}`} className="flex-1 flex flex-col items-center gap-1">
                  <div className="w-full flex items-end justify-center" style={{ height: '80px' }}>
                    <div className="w-full bg-emerald-300 rounded-t-md border-2 border-dashed border-emerald-500" style={{ height: `${Math.max(4, Math.round((f.rev / maxForecast) * 80))}px` }} />
                  </div>
                  <span className="text-[8px] text-emerald-600 font-bold leading-none">{f.label}</span>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-2">
              {forecast.map(f => (
                <div key={f.label} className="bg-emerald-50 rounded-xl p-3 text-center">
                  <p className="text-xs font-bold text-emerald-700">{f.label}</p>
                  <p className="text-lg font-black text-emerald-700">{fmtAna(f.rev,'K',0)}</p>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-gray-400 mt-2">{currentLanguage === 'tr' ? 'Tahmini değerler son 6 ayın doğrusal trendine dayanmaktadır.' : 'Forecasts based on linear trend of last 6 months. Indicative only.'}</p>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.filter(o => o.status === 'Delivered').length >= 3 && (() => {
        const delivered197 = orders.filter(o => {
          if (o.status !== 'Delivered') return false;
          const m = o as unknown as Record<string,unknown>;
          return !!(m.deliveredAt || m.updatedAt);
        });
        if (delivered197.length < 3) return null;
        const cycleTimes = delivered197.map(o => {
          const m = o as unknown as Record<string,unknown>;
          try {
            const created = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
            const delivered = ((m.deliveredAt as { toDate?: () => Date })?.toDate?.() ?? new Date(m.deliveredAt as string))
              || ((m.updatedAt as { toDate?: () => Date })?.toDate?.() ?? new Date(m.updatedAt as string));
            const days = Math.round((delivered.getTime() - created.getTime()) / 86400000);
            return days >= 0 && days < 365 ? days : null;
          } catch { return null; }
        }).filter((d): d is number => d !== null);
        if (cycleTimes.length < 3) return null;
        const avgCycle = Math.round(cycleTimes.reduce((s, d) => s + d, 0) / cycleTimes.length);
        const minCycle = Math.min(...cycleTimes);
        const maxCycle = Math.max(...cycleTimes);
        // Distribution buckets
        const buckets197 = [
          { label: currentLanguage === 'tr' ? '≤1 gün' : '≤1d', max: 1, count: 0 },
          { label: '2-3', max: 3, count: 0 },
          { label: '4-7', max: 7, count: 0 },
          { label: '8-14', max: 14, count: 0 },
          { label: '15+', max: Infinity, count: 0 },
        ];
        for (const d of cycleTimes) {
          const b = buckets197.find(b => d <= b.max);
          if (b) b.count++;
        }
        const maxBucket197 = Math.max(...buckets197.map(b => b.count), 1);
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '⏳ Ortalama Sipariş Teslim Süresi' : '⏳ Avg Order Cycle Time'}</h3>
              <span className="text-2xl font-black text-blue-600">{avgCycle} {currentLanguage === 'tr' ? 'gün' : 'd'}</span>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="bg-emerald-50 rounded-xl p-3 text-center">
                <p className="text-xl font-bold text-emerald-600">{minCycle} {currentLanguage === 'tr' ? 'gün' : 'd'}</p>
                <p className="text-[10px] text-gray-500">{currentLanguage === 'tr' ? 'En hızlı' : 'Fastest'}</p>
              </div>
              <div className="bg-red-50 rounded-xl p-3 text-center">
                <p className="text-xl font-bold text-red-500">{maxCycle} {currentLanguage === 'tr' ? 'gün' : 'd'}</p>
                <p className="text-[10px] text-gray-500">{currentLanguage === 'tr' ? 'En yavaş' : 'Slowest'}</p>
              </div>
            </div>
            <div className="flex items-end gap-2 h-16">
              {buckets197.map(b => (
                <div key={b.label} className="flex-1 flex flex-col items-center gap-1">
                  <div className="w-full flex items-end" style={{ height: '44px' }}>
                    <div className="w-full bg-blue-300 rounded-t-md" style={{ height: `${Math.max(4, Math.round((b.count / maxBucket197) * 44))}px` }} />
                  </div>
                  <span className="text-[9px] text-gray-400 leading-none">{b.label}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 6 && (() => {
        const now198 = new Date();
        const months198 = Array.from({ length: 6 }, (_, i) => {
          const d = new Date(now198.getFullYear(), now198.getMonth() - (5 - i), 1);
          const label = d.toLocaleDateString(currentLanguage === 'tr' ? 'tr-TR' : 'en-US', { month: 'short' });
          const mOrds = orders.filter(o => {
            if (o.status === 'Cancelled') return false;
            try {
              const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
              return od.getFullYear() === d.getFullYear() && od.getMonth() === d.getMonth();
            } catch { return false; }
          });
          const aov = mOrds.length > 0 ? Math.round(mOrds.reduce((s, o) => s + (o.totalPrice || 0), 0) / mOrds.length) : 0;
          return { label, aov, count: mOrds.length };
        });
        const hasData = months198.some(m => m.aov > 0);
        if (!hasData) return null;
        const maxAOV = Math.max(...months198.map(m => m.aov), 1);
        const currAOV = months198[months198.length - 1].aov;
        const prevAOV = months198[months198.length - 2].aov;
        const aovGrowth = prevAOV > 0 ? Math.round(((currAOV - prevAOV) / prevAOV) * 100) : null;
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '🛒 Ortalama Sipariş Değeri Trendi' : '🛒 Avg Order Value Trend'}</h3>
              {aovGrowth !== null && (
                <span className={`text-sm font-bold px-2 py-0.5 rounded-full ${aovGrowth >= 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                  {aovGrowth >= 0 ? '↑' : '↓'} %{Math.abs(aovGrowth)} MoM
                </span>
              )}
            </div>
            <div className="flex items-end gap-3 h-24 mb-3">
              {months198.map((m, i) => {
                const isLatest = i === months198.length - 1;
                return (
                  <div key={m.label} className="flex-1 flex flex-col items-center gap-1">
                    <div className="w-full flex flex-col items-center" style={{ height: '72px' }}>
                      {m.aov > 0 && <span className={`text-[9px] font-bold ${isLatest ? 'text-brand' : 'text-gray-500'}`}>{fmtAna(m.aov,'K',1)}</span>}
                      <div className="w-full flex items-end mt-auto" style={{ height: '52px' }}>
                        <div className={`w-full rounded-t-md ${isLatest ? 'bg-brand' : 'bg-gray-200'}`} style={{ height: `${Math.max(4, Math.round((m.aov / maxAOV) * 52))}px` }} />
                      </div>
                    </div>
                    <span className={`text-[9px] ${isLatest ? 'font-bold text-brand' : 'text-gray-400'}`}>{m.label}</span>
                  </div>
                );
              })}
            </div>
            <p className="text-[10px] text-gray-400">{currentLanguage === 'tr' ? `Bu ay: ₺${currAOV.toLocaleString()} ortalama sipariş değeri · ${months198[months198.length-1].count} sipariş` : `This month: ₺${currAOV.toLocaleString()} AOV · ${months198[months198.length-1].count} orders`}</p>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 10 && (() => {
        const now202 = new Date();
        const cutoff202 = new Date(now202); cutoff202.setDate(cutoff202.getDate() - 90);
        const dayRevMap: Record<string, number> = {};
        for (const o of orders) {
          if (o.status === 'Cancelled') continue;
          try {
            const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
            if (od < cutoff202) continue;
            const key = od.toLocaleDateString(currentLanguage === 'tr' ? 'tr-TR' : 'en-US', { day: '2-digit', month: 'short' });
            dayRevMap[key] = (dayRevMap[key] ?? 0) + (o.totalPrice || 0);
          } catch { /* skip */ }
        }
        const topDays = Object.entries(dayRevMap).sort(([,a],[,b]) => b - a).slice(0, 6);
        if (topDays.length < 3) return null;
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-4">{currentLanguage === 'tr' ? '🏅 En Yüksek Ciro Günleri (Son 90 Gün)' : '🏅 Top Revenue Days (Last 90 Days)'}</h3>
            <div className="space-y-2">
              {topDays.map(([day, rev], i) => {
                const maxRev = topDays[0][1];
                return (
                  <div key={day} className="flex items-center gap-3">
                    <span className="text-sm">{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i+1}`}</span>
                    <span className="text-xs font-medium text-gray-700 w-16 shrink-0">{day}</span>
                    <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-brand rounded-full" style={{ width: `${Math.round((rev / maxRev) * 100)}%` }} />
                    </div>
                    <span className="text-xs font-bold text-gray-700 w-16 text-right shrink-0">{fmtAna(rev,'K',1)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 5 && inventory.length > 0 && (() => {
        const tiers203 = [
          { label: '<₺5K', min: 0, max: 5000, rev: 0, cogs: 0, count: 0 },
          { label: '₺5-20K', min: 5000, max: 20000, rev: 0, cogs: 0, count: 0 },
          { label: '₺20-50K', min: 20000, max: 50000, rev: 0, cogs: 0, count: 0 },
          { label: '₺50K+', min: 50000, max: Infinity, rev: 0, cogs: 0, count: 0 },
        ];
        for (const o of orders) {
          if (o.status === 'Cancelled') continue;
          const tier = tiers203.find(t => (o.totalPrice || 0) >= t.min && (o.totalPrice || 0) < t.max);
          if (!tier) continue;
          tier.rev += o.totalPrice || 0;
          tier.count++;
          for (const li of (o.lineItems ?? [])) {
            const inv = inventory.find(ii => ii.id === li.inventoryId || ii.name === li.name);
            tier.cogs += (inv ? itemCostTRY(inv, exchangeRates) : li.price * 0.6) * li.quantity;
          }
        }
        const activeTiers = tiers203.filter(t => t.count > 0);
        if (activeTiers.length < 2) return null;
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-4">{currentLanguage === 'tr' ? '🎯 Sipariş Büyüklüğüne Göre Brüt Marj' : '🎯 Gross Margin by Order Size'}</h3>
            <div className="grid grid-cols-2 gap-3">
              {activeTiers.map(t => {
                const margin = t.rev > 0 ? Math.round(((t.rev - t.cogs) / t.rev) * 100) : 0;
                return (
                  <div key={t.label} className={`rounded-2xl p-4 ${margin >= 30 ? 'bg-emerald-50' : margin >= 15 ? 'bg-amber-50' : 'bg-red-50'}`}>
                    <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500 mb-1">{t.label}</p>
                    <p className={`text-3xl font-black ${margin >= 30 ? 'text-emerald-600' : margin >= 15 ? 'text-amber-600' : 'text-red-500'}`}>%{margin}</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">{t.count} {currentLanguage === 'tr' ? 'sipariş' : 'orders'} · {fmtAna(t.rev,'K',0)}</p>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 6 && (() => {
        const now215 = new Date();
        const months215 = Array.from({ length: 12 }, (_, i) => {
          const d = new Date(now215.getFullYear(), now215.getMonth() - (11 - i), 1);
          const mOrds = orders.filter(o => {
            if (o.status === 'Cancelled') return false;
            try {
              const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
              return od.getFullYear() === d.getFullYear() && od.getMonth() === d.getMonth();
            } catch { return false; }
          });
          return {
            label: d.toLocaleDateString(currentLanguage === 'tr' ? 'tr-TR' : 'en-US', { month: 'short', year: '2-digit' }),
            count: mOrds.length,
            rev: mOrds.reduce((s, o) => s + (o.totalPrice || 0), 0),
          };
        }).filter(m => m.count > 0);
        if (months215.length < 4) return null;
        const maxCount = Math.max(...months215.map(m => m.count), 1);
        const maxRev215 = Math.max(...months215.map(m => m.rev), 1);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-4">{currentLanguage === 'tr' ? '📈 Sipariş Adedi vs Ciro (12 Ay)' : '📈 Order Count vs Revenue (12 Months)'}</h3>
            <div className="flex items-end gap-1.5 h-28 mb-2">
              {months215.map((m, i) => {
                const isLatest = i === months215.length - 1;
                const revH = Math.round((m.rev / maxRev215) * 72);
                const cntH = Math.round((m.count / maxCount) * 72);
                return (
                  <div key={m.label} className="flex-1 flex flex-col items-center gap-0.5">
                    <div className="w-full flex items-end gap-px" style={{ height: '72px' }}>
                      <div className={`flex-1 rounded-t-sm ${isLatest ? 'bg-brand' : 'bg-red-200'}`} style={{ height: `${Math.max(2, revH)}px` }} />
                      <div className={`flex-1 rounded-t-sm ${isLatest ? 'bg-blue-500' : 'bg-blue-200'}`} style={{ height: `${Math.max(2, cntH)}px` }} />
                    </div>
                    <span className="text-[8px] text-gray-400 leading-none">{m.label}</span>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center gap-4 text-[10px] text-gray-500">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-red-300 inline-block" />{currentLanguage === 'tr' ? 'Ciro' : 'Revenue'}</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-blue-300 inline-block" />{currentLanguage === 'tr' ? 'Sipariş Adedi' : 'Order Count'}</span>
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 3 && inventory.length > 0 && (() => {
        // Working Capital = Current Assets - Current Liabilities (estimated)
        const inventoryVal216 = inventory.reduce((s, i) => s + itemCostTRY(i, exchangeRates) * (i.stockLevel ?? 0), 0);
        const arBalance216 = orders.filter(o => o.status !== 'Cancelled' && o.status !== 'Delivered').reduce((s, o) => s + (o.totalPrice || 0), 0);
        const currentAssets = inventoryVal216 + arBalance216;
        // Estimated AP: orders received in last 30 days (proxy for payables)
        const now216 = new Date();
        const cut216 = new Date(now216); cut216.setDate(cut216.getDate() - 30);
        const recentPurchases = orders.filter(o => {
          const m = o as unknown as Record<string,unknown>;
          if (!m.isPurchase && !m.purchaseOrder) return false;
          try {
            const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
            return od >= cut216;
          } catch { return false; }
        }).reduce((s, o) => s + (o.totalPrice || 0), 0);
        const estimatedPayroll = inventory.length; // fallback
        void estimatedPayroll;
        const currentLiabilities = recentPurchases; // proxy
        const workingCapital = currentAssets - currentLiabilities;
        const currentRatio = currentLiabilities > 0 ? (currentAssets / currentLiabilities).toFixed(1) : '∞';
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '🏦 İşletme Sermayesi Analizi' : '🏦 Working Capital Analysis'}</h3>
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${workingCapital >= 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                {workingCapital >= 0 ? (currentLanguage === 'tr' ? 'Sağlıklı' : 'Healthy') : (currentLanguage === 'tr' ? 'Risk' : 'Risk')}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-3 mb-4">
              {[
                { label: currentLanguage === 'tr' ? 'Dönen Varlıklar' : 'Current Assets', value: `₺${(currentAssets/1000).toFixed(0)}K`, color: 'text-emerald-600', sub: currentLanguage === 'tr' ? 'Stok + Alacak' : 'Inventory + AR' },
                { label: currentLanguage === 'tr' ? 'Kısa Vade Borç' : 'Current Liabilities', value: `₺${(currentLiabilities/1000).toFixed(0)}K`, color: 'text-red-500', sub: currentLanguage === 'tr' ? 'Borç tahmini' : 'AP estimate' },
                { label: currentLanguage === 'tr' ? 'Net Sermaye' : 'Net Working Capital', value: `₺${(workingCapital/1000).toFixed(0)}K`, color: workingCapital >= 0 ? 'text-emerald-600' : 'text-red-500', sub: currentLanguage === 'tr' ? 'Cari Oran: ' + currentRatio : 'Current Ratio: ' + currentRatio },
              ].map(k => (
                <div key={k.label} className="bg-gray-50 rounded-xl p-3 text-center">
                  <p className={`text-xl font-black ${k.color}`}>{k.value}</p>
                  <p className="text-[10px] text-gray-600 font-medium mt-0.5">{k.label}</p>
                  <p className="text-[9px] text-gray-400">{k.sub}</p>
                </div>
              ))}
            </div>
            <div className="space-y-2">
              <div>
                <div className="flex justify-between text-[10px] text-gray-500 mb-0.5">
                  <span>{currentLanguage === 'tr' ? 'Stok Değeri' : 'Inventory Value'}</span>
                  <span>{fmtAna(inventoryVal216,'K',0)}</span>
                </div>
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-300 rounded-full" style={{ width: `${currentAssets > 0 ? Math.round((inventoryVal216/currentAssets)*100) : 0}%` }} />
                </div>
              </div>
              <div>
                <div className="flex justify-between text-[10px] text-gray-500 mb-0.5">
                  <span>{currentLanguage === 'tr' ? 'Tahsil Edilecek Alacaklar' : 'Accounts Receivable'}</span>
                  <span>{fmtAna(arBalance216,'K',0)}</span>
                </div>
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full bg-amber-300 rounded-full" style={{ width: `${currentAssets > 0 ? Math.round((arBalance216/currentAssets)*100) : 0}%` }} />
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 5 && inventory.length > 0 && (() => {
        // Top products by revenue contribution
        const prodRev217: Record<string, { name: string; rev: number; qty: number }> = {};
        for (const o of orders) {
          if (o.status === 'Cancelled') continue;
          for (const li of (o.lineItems ?? [])) {
            const key = li.inventoryId || li.name || '';
            if (!key) continue;
            if (!prodRev217[key]) prodRev217[key] = { name: li.name || key, rev: 0, qty: 0 };
            prodRev217[key].rev += li.price * li.quantity;
            prodRev217[key].qty += li.quantity;
          }
        }
        const sorted217 = Object.values(prodRev217).sort((a, b) => b.rev - a.rev).slice(0, 6);
        if (sorted217.length < 2) return null;
        const total217 = sorted217.reduce((s, p) => s + p.rev, 0);
        const COLORS_217 = ['#ff4000', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#6b7280'];
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-4">{currentLanguage === 'tr' ? '🧩 Ürün Karma Analizi (Top 6)' : '🧩 Product Mix Analysis (Top 6)'}</h3>
            <div className="flex gap-2 mb-4">
              {sorted217.map((p, i) => {
                const pct = total217 > 0 ? Math.round((p.rev / total217) * 100) : 0;
                return (
                  <div key={p.name} className="flex-1" style={{ minWidth: 0 }}>
                    <div className="h-16 rounded-xl flex items-end justify-center pb-2" style={{ backgroundColor: COLORS_217[i] + '20' }}>
                      <span className="text-[10px] font-bold" style={{ color: COLORS_217[i] }}>{pct}%</span>
                    </div>
                    <div className="w-full h-1.5 rounded-full mt-1" style={{ backgroundColor: COLORS_217[i] }} />
                    <p className="text-[9px] text-gray-600 text-center mt-1 truncate">{p.name}</p>
                  </div>
                );
              })}
            </div>
            <div className="space-y-1.5">
              {sorted217.map((p, i) => {
                const pct = total217 > 0 ? Math.round((p.rev / total217) * 100) : 0;
                return (
                  <div key={p.name} className="flex items-center gap-2 text-xs">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: COLORS_217[i] }} />
                    <span className="text-gray-700 truncate flex-1">{p.name}</span>
                    <span className="text-gray-400 shrink-0">{p.qty} {currentLanguage === 'tr' ? 'adet' : 'units'}</span>
                    <span className="font-bold text-gray-700 shrink-0">%{pct}</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}
    </>
  );
}
