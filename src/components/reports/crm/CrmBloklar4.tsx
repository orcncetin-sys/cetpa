/**
 * CrmBloklar4.tsx — CrmRapor bölmesi (2026-09-03)
 *
 * CrmRapor.tsx'ten mekanik olarak çıkarıldı (bölme öncesi satır 461–781, 6 blok).
 * Bloklar ORİJİNAL SIRASIYLA ve içeriği DEĞİŞTİRİLMEDEN taşındı; bloklardaki
 * `reportsTab === 'crm'` koşulları BİLEREK korundu (bkz. CrmRapor.tsx başlık
 * notu — ebeveyn zaten sekmeye göre render ediyor, koşulu silmek "saf kopya"
 * güvencesini bozardı).
 * Props yalnız bu dosyanın gerçekten kullandığı ctx alanlarıdır
 * (tsc "Cannot find name" listesinden çıkarıldı).
 */
import type { ReportsCtx } from '../useReportsData';

type Props = Pick<ReportsCtx, 'reportsTab' | 'orders' | 'quotations' | 'inventory' | 'currentLanguage' | 'fmtAna'>;

export default function CrmBloklar4({ reportsTab, orders, quotations, inventory, currentLanguage, fmtAna }: Props) {
  return (
    <>
      {reportsTab === 'crm' && orders.length >= 5 && (() => {
        const repMap196: Record<string, { rev: number; orders: number }> = {};
        const now196 = new Date();
        const monthStart196 = new Date(now196.getFullYear(), now196.getMonth(), 1);
        for (const o of orders) {
          if (o.status === 'Cancelled') continue;
          const rep = (o.assignedTo as string | undefined) || (o as unknown as Record<string,unknown>).salesRep as string || '—';
          if (rep === '—') continue;
          if (!repMap196[rep]) repMap196[rep] = { rev: 0, orders: 0 };
          try {
            const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
            if (od >= monthStart196) {
              repMap196[rep].rev += o.totalPrice || 0;
              repMap196[rep].orders++;
            }
          } catch { /* skip */ }
        }
        const repList = Object.entries(repMap196).map(([name, d]) => ({ name, ...d })).sort((a, b) => b.rev - a.rev).slice(0, 8);
        if (repList.length < 2) return null;
        const maxRevRep = Math.max(...repList.map(r => r.rev), 1);
        const medals = ['🥇', '🥈', '🥉'];
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '🏆 Satış Temsilcisi Sıralaması' : '🏆 Sales Rep Leaderboard'}</h3>
              <span className="text-[10px] text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{currentLanguage === 'tr' ? 'Bu ay' : 'This month'}</span>
            </div>
            <div className="space-y-2.5">
              {repList.map((r, i) => (
                <div key={r.name}>
                  <div className="flex items-center justify-between mb-0.5">
                    <div className="flex items-center gap-2">
                      <span className="text-sm">{medals[i] ?? `#${i+1}`}</span>
                      <span className="text-xs font-medium text-gray-800 truncate">{r.name}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-2">
                      <span className="text-[10px] text-gray-400">{r.orders} {currentLanguage === 'tr' ? 'sipariş' : 'orders'}</span>
                      <span className="text-xs font-bold text-gray-700">{fmtAna(r.rev,'K',0)}</span>
                    </div>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${i === 0 ? 'bg-yellow-400' : i === 1 ? 'bg-gray-400' : i === 2 ? 'bg-orange-400' : 'bg-blue-300'}`} style={{ width: `${Math.max(4, Math.round((r.rev / maxRevRep) * 100))}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 5 && (() => {
        const now200 = new Date();
        const months200 = Array.from({ length: 6 }, (_, i) => {
          const d = new Date(now200.getFullYear(), now200.getMonth() - (5 - i), 1);
          const label = d.toLocaleDateString(currentLanguage === 'tr' ? 'tr-TR' : 'en-US', { month: 'short' });
          const year = d.getFullYear(); const month = d.getMonth();
          return { label, year, month, newRev: 0, repeatRev: 0 };
        });
        // Track first order month per customer
        const firstOrderMonth: Record<string, { year: number; month: number }> = {};
        const sortedOrders = [...orders].sort((a, b) => {
          try {
            const da = (a.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(a.createdAt as string);
            const db2 = (b.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(b.createdAt as string);
            return da.getTime() - db2.getTime();
          } catch { return 0; }
        });
        for (const o of sortedOrders) {
          if (o.status === 'Cancelled') continue;
          const name = o.customerName || '—';
          try {
            const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
            if (!firstOrderMonth[name]) firstOrderMonth[name] = { year: od.getFullYear(), month: od.getMonth() };
            const m = months200.find(m => m.year === od.getFullYear() && m.month === od.getMonth());
            if (!m) continue;
            const isNew = firstOrderMonth[name].year === od.getFullYear() && firstOrderMonth[name].month === od.getMonth();
            if (isNew) m.newRev += o.totalPrice || 0;
            else m.repeatRev += o.totalPrice || 0;
          } catch { /* skip */ }
        }
        const hasData = months200.some(m => m.newRev > 0 || m.repeatRev > 0);
        if (!hasData) return null;
        const maxTotal = Math.max(...months200.map(m => m.newRev + m.repeatRev), 1);
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '🆕 Yeni vs Tekrar Müşteri Cirosu' : '🆕 New vs Repeat Customer Revenue'}</h3>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1"><div className="w-3 h-2 rounded-sm bg-brand" /><span className="text-[10px] text-gray-500">{currentLanguage === 'tr' ? 'Yeni' : 'New'}</span></div>
                <div className="flex items-center gap-1"><div className="w-3 h-2 rounded-sm bg-blue-300" /><span className="text-[10px] text-gray-500">{currentLanguage === 'tr' ? 'Tekrar' : 'Repeat'}</span></div>
              </div>
            </div>
            <div className="flex items-end gap-3 h-28 mb-2">
              {months200.map((m, i) => {
                const total = m.newRev + m.repeatRev;
                const totalH = Math.round((total / maxTotal) * 80);
                const newH = total > 0 ? Math.round((m.newRev / total) * totalH) : 0;
                const repH = totalH - newH;
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1">
                    <div className="w-full flex flex-col items-center justify-end" style={{ height: '80px' }}>
                      <div className="w-full bg-brand rounded-t-sm" style={{ height: `${Math.max(newH > 0 ? 2 : 0, newH)}px` }} />
                      <div className="w-full bg-blue-300" style={{ height: `${Math.max(repH > 0 ? 2 : 0, repH)}px` }} />
                    </div>
                    <span className="text-[9px] text-gray-400 leading-none">{m.label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 5 && (() => {
        const now205 = new Date();
        // Compute CLV = total spend per customer, cohorted by first-order quarter
        const custData205: Record<string, { firstQ: string; ltv: number }> = {};
        for (const o of orders) {
          if (o.status === 'Cancelled') continue;
          const name = o.customerName || '—';
          try {
            const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
            const q = `Q${Math.floor(od.getMonth() / 3) + 1} ${od.getFullYear()}`;
            if (!custData205[name]) custData205[name] = { firstQ: q, ltv: 0 };
            custData205[name].ltv += o.totalPrice || 0;
          } catch { /* skip */ }
        }
        void now205;
        const cohorts: Record<string, number[]> = {};
        for (const { firstQ, ltv } of Object.values(custData205)) {
          if (!cohorts[firstQ]) cohorts[firstQ] = [];
          cohorts[firstQ].push(ltv);
        }
        const cohortList = Object.entries(cohorts)
          .map(([q, ltvs]) => ({ q, avgLTV: Math.round(ltvs.reduce((s,v) => s+v,0) / ltvs.length), count: ltvs.length }))
          .sort((a, b) => a.q.localeCompare(b.q))
          .slice(-6);
        if (cohortList.length < 2) return null;
        const maxLTV = Math.max(...cohortList.map(c => c.avgLTV), 1);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-4">{currentLanguage === 'tr' ? '💎 Müşteri Yaşam Boyu Değeri (Cohort)' : '💎 Customer LTV by Cohort'}</h3>
            <div className="flex items-end gap-3 h-28 mb-2">
              {cohortList.map((c, i) => {
                const h = Math.round((c.avgLTV / maxLTV) * 80);
                const isLatest = i === cohortList.length - 1;
                return (
                  <div key={c.q} className="flex-1 flex flex-col items-center gap-1">
                    <div className="w-full flex flex-col items-center" style={{ height: '80px' }}>
                      {c.avgLTV > 0 && <span className="text-[8px] font-bold text-gray-500 mb-0.5">{fmtAna(c.avgLTV,'K',0)}</span>}
                      <div className="w-full flex items-end mt-auto" style={{ height: `${Math.max(4, h)}px` }}>
                        <div className={`w-full rounded-t-md ${isLatest ? 'bg-purple-500' : 'bg-purple-200'}`} style={{ height: '100%' }} />
                      </div>
                    </div>
                    <span className="text-[8px] text-gray-400 leading-none text-center">{c.q}</span>
                    <span className="text-[8px] text-gray-300">{c.count}m</span>
                  </div>
                );
              })}
            </div>
            <p className="text-[10px] text-gray-400">{currentLanguage === 'tr' ? 'İlk sipariş çeyreğine göre ortalama müşteri değeri' : 'Avg customer value by first-order quarter cohort'}</p>
          </div>
        );
      })()}

      {reportsTab === 'crm' && quotations.length >= 3 && inventory.length > 0 && (() => {
        const catQuotes: Record<string, { won: number; total: number }> = {};
        for (const q of quotations) {
          const status = (q as unknown as Record<string,unknown>).status as string | undefined;
          const items = (q as unknown as Record<string,unknown>).items as Array<{ inventoryId?: string; name?: string }> | undefined;
          if (!items?.length) continue;
          for (const qi of items) {
            const inv = inventory.find(ii => ii.id === qi.inventoryId || ii.name === qi.name);
            const cat = inv?.category || (currentLanguage === 'tr' ? 'Diğer' : 'Other');
            if (!catQuotes[cat]) catQuotes[cat] = { won: 0, total: 0 };
            catQuotes[cat].total++;
            if (status === 'Converted to Order' || status === 'accepted' || status === 'won') catQuotes[cat].won++;
          }
        }
        const catList = Object.entries(catQuotes)
          .map(([cat, d]) => ({ cat, ...d, rate: d.total > 0 ? Math.round((d.won / d.total) * 100) : 0 }))
          .filter(c => c.total >= 2)
          .sort((a, b) => b.rate - a.rate)
          .slice(0, 6);
        if (catList.length < 2) return null;
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-4">{currentLanguage === 'tr' ? '🎯 Kategori Bazlı Teklif Kazanma Oranı' : '🎯 Quote Win Rate by Category'}</h3>
            <div className="space-y-2.5">
              {catList.map(c => (
                <div key={c.cat}>
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-xs font-medium text-gray-700 truncate">{c.cat}</span>
                    <div className="flex items-center gap-2 shrink-0 ml-2">
                      <span className="text-[10px] text-gray-400">{c.won}/{c.total}</span>
                      <span className={`text-xs font-bold ${c.rate >= 50 ? 'text-emerald-600' : c.rate >= 30 ? 'text-amber-600' : 'text-red-500'}`}>%{c.rate}</span>
                    </div>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${c.rate >= 50 ? 'bg-emerald-400' : c.rate >= 30 ? 'bg-amber-400' : 'bg-red-400'}`} style={{ width: `${Math.max(4, c.rate)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 6 && (() => {
        const now210 = new Date();
        const months210 = Array.from({ length: 6 }, (_, i) => {
          const d = new Date(now210.getFullYear(), now210.getMonth() - (5 - i), 1);
          const label = d.toLocaleDateString(currentLanguage === 'tr' ? 'tr-TR' : 'en-US', { month: 'short' });
          const mOrds = orders.filter(o => {
            if (o.status === 'Cancelled') return false;
            try {
              const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
              return od.getFullYear() === d.getFullYear() && od.getMonth() === d.getMonth();
            } catch { return false; }
          });
          const customers = new Set(mOrds.map(o => o.customerName || '—')).size;
          const rev = mOrds.reduce((s, o) => s + (o.totalPrice || 0), 0);
          const arpu = customers > 0 ? Math.round(rev / customers) : 0;
          return { label, arpu, customers, rev };
        });
        const hasData = months210.some(m => m.arpu > 0);
        if (!hasData) return null;
        const maxARPU = Math.max(...months210.map(m => m.arpu), 1);
        const currARPU = months210[months210.length - 1].arpu;
        const prevARPU = months210[months210.length - 2].arpu;
        const growth210 = prevARPU > 0 ? Math.round(((currARPU - prevARPU) / prevARPU) * 100) : null;
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '👤 Kullanıcı Başı Ortalama Gelir (ARPU)' : '👤 Avg Revenue Per User (ARPU)'}</h3>
              {growth210 !== null && (
                <span className={`text-sm font-bold px-2 py-0.5 rounded-full ${growth210 >= 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                  {growth210 >= 0 ? '↑' : '↓'} %{Math.abs(growth210)} MoM
                </span>
              )}
            </div>
            <div className="flex items-end gap-3 h-24 mb-2">
              {months210.map((m, i) => {
                const isLatest = i === months210.length - 1;
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1">
                    <div className="w-full" style={{ height: '72px', display: 'flex', alignItems: 'flex-end' }}>
                      <div className={`w-full rounded-t-md ${isLatest ? 'bg-indigo-500' : 'bg-indigo-200'}`} style={{ height: `${Math.max(4, Math.round((m.arpu / maxARPU) * 68))}px` }} />
                    </div>
                    <span className={`text-[9px] leading-none ${isLatest ? 'font-bold text-indigo-600' : 'text-gray-400'}`}>{m.label}</span>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-black text-indigo-600">{fmtAna(currARPU)}</p>
                <p className="text-[10px] text-gray-400">{currentLanguage === 'tr' ? 'Bu ay ARPU' : 'This month ARPU'}</p>
              </div>
              <div className="text-right">
                <p className="text-sm font-bold text-gray-600">{months210[months210.length-1].customers} {currentLanguage === 'tr' ? 'aktif müşteri' : 'active customers'}</p>
                <p className="text-[10px] text-gray-400">{currentLanguage === 'tr' ? 'Bu ay' : 'This month'}</p>
              </div>
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 5 && (() => {
        const custRev218: Record<string, number> = {};
        for (const o of orders) {
          if (o.status === 'Cancelled') continue;
          const name = o.customerName || '—';
          custRev218[name] = (custRev218[name] ?? 0) + (o.totalPrice || 0);
        }
        const custList218 = Object.entries(custRev218).sort(([,a],[,b]) => b - a);
        if (custList218.length < 3) return null;
        const totalRev218 = custList218.reduce((s,[,v]) => s + v, 0);
        const top1Pct218 = totalRev218 > 0 ? Math.round((custList218[0][1] / totalRev218) * 100) : 0;
        const top3Pct218 = totalRev218 > 0 ? Math.round((custList218.slice(0,3).reduce((s,[,v]) => s+v, 0) / totalRev218) * 100) : 0;
        const riskLevel218 = top1Pct218 >= 50 ? 'high' : top1Pct218 >= 30 ? 'medium' : 'low';
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '⚠️ Müşteri Konsantrasyon Riski' : '⚠️ Customer Concentration Risk'}</h3>
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${riskLevel218 === 'high' ? 'bg-red-100 text-red-700' : riskLevel218 === 'medium' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                {riskLevel218 === 'high' ? (currentLanguage === 'tr' ? 'Yüksek' : 'High') : riskLevel218 === 'medium' ? (currentLanguage === 'tr' ? 'Orta' : 'Med') : (currentLanguage === 'tr' ? 'Düşük' : 'Low')}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="bg-gray-50 rounded-xl p-3 text-center">
                <p className={`text-2xl font-black ${top1Pct218 >= 50 ? 'text-red-500' : 'text-amber-500'}`}>%{top1Pct218}</p>
                <p className="text-[10px] text-gray-500">{currentLanguage === 'tr' ? 'En büyük müşteri' : 'Largest customer'}</p>
              </div>
              <div className="bg-gray-50 rounded-xl p-3 text-center">
                <p className={`text-2xl font-black ${top3Pct218 >= 80 ? 'text-red-500' : 'text-blue-600'}`}>%{top3Pct218}</p>
                <p className="text-[10px] text-gray-500">{currentLanguage === 'tr' ? 'İlk 3 müşteri' : 'Top 3 customers'}</p>
              </div>
            </div>
            <div className="space-y-2">
              {custList218.slice(0, 5).map(([name, rev]) => {
                const pct = totalRev218 > 0 ? Math.round((rev / totalRev218) * 100) : 0;
                return (
                  <div key={name}>
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-xs font-medium text-gray-700 truncate">{name}</span>
                      <div className="flex items-center gap-2 shrink-0 ml-2">
                        <span className="text-[10px] text-gray-400">%{pct}</span>
                        <span className="text-xs font-bold text-gray-700">{fmtAna(rev,'K',0)}</span>
                      </div>
                    </div>
                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${pct >= 30 ? 'bg-red-400' : pct >= 15 ? 'bg-amber-400' : 'bg-blue-300'}`} style={{ width: `${Math.max(4, pct)}%` }} />
                    </div>
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
