/**
 * CrmBloklar6.tsx — CrmRapor bölmesi (2026-09-03)
 *
 * CrmRapor.tsx'ten mekanik olarak çıkarıldı (bölme öncesi satır 853–1235, 7 blok).
 * Bloklar ORİJİNAL SIRASIYLA ve içeriği DEĞİŞTİRİLMEDEN taşındı; bloklardaki
 * `reportsTab === 'crm'` koşulları BİLEREK korundu (bkz. CrmRapor.tsx başlık
 * notu — ebeveyn zaten sekmeye göre render ediyor, koşulu silmek "saf kopya"
 * güvencesini bozardı).
 * Props yalnız bu dosyanın gerçekten kullandığı ctx alanlarıdır
 * (tsc "Cannot find name" listesinden çıkarıldı).
 */
import type { ReportsCtx } from '../useReportsData';

type Props = Pick<ReportsCtx, 'reportsTab' | 'orders' | 'quotations' | 'inventory' | 'currentLanguage' | 'fmtAna'>;

export default function CrmBloklar6({ reportsTab, orders, quotations, inventory, currentLanguage, fmtAna }: Props) {
  return (
    <>
      {reportsTab === 'crm' && orders.length >= 8 && (() => {
        const now230 = new Date();
        const prevStart = new Date(now230.getFullYear(), now230.getMonth() - 6, 1);
        const prevEnd = new Date(now230.getFullYear(), now230.getMonth() - 3, 0, 23, 59, 59);
        const currStart = new Date(now230.getFullYear(), now230.getMonth() - 3, 1);
        // Customers in period 1 (prev 3 months)
        const prevCustRev: Record<string, number> = {};
        const currCustRev: Record<string, number> = {};
        for (const o of orders) {
          if (o.status === 'Cancelled') continue;
          const name = o.customerName || '—';
          try {
            const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
            if (od >= prevStart && od <= prevEnd) prevCustRev[name] = (prevCustRev[name] ?? 0) + (o.totalPrice || 0);
            if (od >= currStart) currCustRev[name] = (currCustRev[name] ?? 0) + (o.totalPrice || 0);
          } catch { /* skip */ }
        }
        const existingCusts = Object.keys(prevCustRev);
        if (existingCusts.length < 3) return null;
        // NRR = revenue from existing customers in curr / their revenue in prev
        const prevRevExisting = existingCusts.reduce((s, n) => s + prevCustRev[n], 0);
        const currRevExisting = existingCusts.reduce((s, n) => s + (currCustRev[n] ?? 0), 0);
        const nrr = prevRevExisting > 0 ? Math.round((currRevExisting / prevRevExisting) * 100) : null;
        if (nrr === null) return null;
        const expansion = existingCusts.filter(n => (currCustRev[n] ?? 0) > prevCustRev[n]).length;
        const churned230 = existingCusts.filter(n => !(currCustRev[n])).length;
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '📈 Net Gelir Tutma Oranı (NRR)' : '📈 Net Revenue Retention (NRR)'}</h3>
              <span className={`text-2xl font-black ${nrr >= 100 ? 'text-emerald-600' : nrr >= 80 ? 'text-amber-500' : 'text-red-500'}`}>%{nrr}</span>
            </div>
            <div className="grid grid-cols-3 gap-3 mb-4">
              {[
                { label: currentLanguage === 'tr' ? 'Önceki Dönem' : 'Prior Period', value: `₺${(prevRevExisting/1000).toFixed(0)}K`, color: 'text-gray-600' },
                { label: currentLanguage === 'tr' ? 'Mevcut Dönem' : 'Current Period', value: `₺${(currRevExisting/1000).toFixed(0)}K`, color: nrr >= 100 ? 'text-emerald-600' : 'text-amber-600' },
                { label: currentLanguage === 'tr' ? 'Müşteri Kaybı' : 'Churned', value: String(churned230), color: 'text-red-500' },
              ].map(k => (
                <div key={k.label} className="bg-gray-50 rounded-xl p-3 text-center">
                  <p className={`text-lg font-bold ${k.color}`}>{k.value}</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">{k.label}</p>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-1.5 p-3 rounded-xl bg-blue-50">
              <span>💡</span>
              <p className="text-[11px] text-blue-700">
                {currentLanguage === 'tr'
                  ? `${expansion} müşteri harcamasını artırdı, ${churned230} kayboldu. NRR >100% büyüme gösterir.`
                  : `${expansion} customers expanded, ${churned230} churned. NRR >100% means expansion exceeds churn.`}
              </p>
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 5 && (() => {
        // Risk factors: high cancellations, long AR days, declining order freq
        const now232 = new Date();
        const custMap232: Record<string, { orders: number; cancelled: number; lastOrderDays: number; rev: number }> = {};
        for (const o of orders) {
          const name = o.customerName || '—';
          if (!custMap232[name]) custMap232[name] = { orders: 0, cancelled: 0, lastOrderDays: 999, rev: 0 };
          custMap232[name].orders++;
          if (o.status === 'Cancelled') { custMap232[name].cancelled++; continue; }
          try {
            const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
            const days = Math.round((now232.getTime() - od.getTime()) / 86400000);
            if (days < custMap232[name].lastOrderDays) custMap232[name].lastOrderDays = days;
          } catch { /* skip */ }
          custMap232[name].rev += o.totalPrice || 0;
        }
        const riskList = Object.entries(custMap232)
          .filter(([, d]) => d.orders >= 2)
          .map(([name, d]) => {
            // Risk = cancel rate * 40 + recency score * 30 + low volume * 30
            const cancelRate = d.orders > 0 ? (d.cancelled / d.orders) * 100 : 0;
            const recencyScore = d.lastOrderDays > 90 ? 30 : d.lastOrderDays > 45 ? 20 : d.lastOrderDays > 30 ? 10 : 0;
            const riskScore = Math.min(100, Math.round(cancelRate * 0.4 + recencyScore));
            return { name, riskScore, cancelRate: Math.round(cancelRate), lastOrderDays: d.lastOrderDays, rev: d.rev };
          })
          .sort((a, b) => b.riskScore - a.riskScore)
          .slice(0, 6);
        if (riskList.length === 0) return null;
        const highRisk = riskList.filter(c => c.riskScore >= 50).length;
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '🚨 Müşteri Risk Skoru' : '🚨 Customer Risk Score'}</h3>
              {highRisk > 0 && (
                <span className="text-xs font-bold text-red-700 bg-red-50 px-2 py-0.5 rounded-full">
                  {highRisk} {currentLanguage === 'tr' ? 'yüksek riskli' : 'high risk'}
                </span>
              )}
            </div>
            <div className="space-y-2.5">
              {riskList.map(c => (
                <div key={c.name}>
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-xs font-medium text-gray-700 truncate">{c.name}</span>
                    <div className="flex items-center gap-2 shrink-0 ml-2">
                      <span className="text-[10px] text-gray-400">{c.lastOrderDays}d {currentLanguage === 'tr' ? 'önce' : 'ago'}</span>
                      <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full ${c.riskScore >= 50 ? 'bg-red-100 text-red-700' : c.riskScore >= 25 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                        {c.riskScore}
                      </span>
                    </div>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${c.riskScore >= 50 ? 'bg-red-400' : c.riskScore >= 25 ? 'bg-amber-400' : 'bg-emerald-400'}`} style={{ width: `${Math.max(4, c.riskScore)}%` }} />
                  </div>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-gray-400 mt-3">{currentLanguage === 'tr' ? 'Risk skoru: iptal oranı + hareketsizlik + düşük hacim (0-100)' : 'Risk score: cancel rate + recency + low volume (0-100 scale)'}</p>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 6 && (() => {
        const freqMap: Record<string, number> = {};
        for (const o of orders) {
          if (o.status === 'Cancelled') continue;
          const name = o.customerName || '—';
          freqMap[name] = (freqMap[name] ?? 0) + 1;
        }
        const buckets237 = [
          { label: '1', min: 1, max: 1, count: 0 },
          { label: '2-3', min: 2, max: 3, count: 0 },
          { label: '4-6', min: 4, max: 6, count: 0 },
          { label: '7-12', min: 7, max: 12, count: 0 },
          { label: '13+', min: 13, max: Infinity, count: 0 },
        ];
        for (const freq of Object.values(freqMap)) {
          const b = buckets237.find(b => freq >= b.min && freq <= b.max);
          if (b) b.count++;
        }
        const maxBkt237 = Math.max(...buckets237.map(b => b.count), 1);
        const totalCusts237 = Object.keys(freqMap).length;
        const repeatCusts = Object.values(freqMap).filter(f => f >= 2).length;
        const repeatPct = totalCusts237 > 0 ? Math.round((repeatCusts / totalCusts237) * 100) : 0;
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '📊 Müşteri Satın Alma Sıklığı' : '📊 Customer Purchase Frequency'}</h3>
              <span className="text-xs font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">%{repeatPct} {currentLanguage === 'tr' ? 'tekrarlı müşteri' : 'repeat customers'}</span>
            </div>
            <div className="flex items-end gap-3 h-24 mb-3">
              {buckets237.map(b => (
                <div key={b.label} className="flex-1 flex flex-col items-center gap-1">
                  <div className="w-full flex flex-col items-center" style={{ height: '72px' }}>
                    {b.count > 0 && <span className="text-[9px] font-bold text-gray-500 mb-0.5">{b.count}</span>}
                    <div className="w-full flex items-end mt-auto" style={{ height: '56px' }}>
                      <div className="w-full bg-indigo-300 rounded-t-md" style={{ height: `${Math.max(4, Math.round((b.count / maxBkt237) * 56))}px` }} />
                    </div>
                  </div>
                  <span className="text-[9px] text-gray-400 leading-none">{b.label}</span>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              {[
                { label: currentLanguage === 'tr' ? 'Toplam Müşteri' : 'Total Customers', value: totalCusts237, color: 'text-gray-700' },
                { label: currentLanguage === 'tr' ? 'Tekrarlı Alım' : 'Repeat Buyers', value: repeatCusts, color: 'text-emerald-600' },
                { label: currentLanguage === 'tr' ? 'Tek Alım' : 'One-time', value: totalCusts237 - repeatCusts, color: 'text-amber-600' },
              ].map(k => (
                <div key={k.label} className="bg-gray-50 rounded-xl p-2">
                  <p className={`text-lg font-bold ${k.color}`}>{k.value}</p>
                  <p className="text-[9px] text-gray-400">{k.label}</p>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 5 && (() => {
        const now240 = new Date();
        // Rolling 6-month window: what % of customers re-ordered within 90 days?
        const months240 = Array.from({ length: 6 }, (_, i) => {
          const d = new Date(now240.getFullYear(), now240.getMonth() - (5 - i), 1);
          const label = d.toLocaleDateString(currentLanguage === 'tr' ? 'tr-TR' : 'en-US', { month: 'short' });
          const monthOrders = orders.filter(o => {
            if (o.status === 'Cancelled') return false;
            try {
              const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
              return od.getFullYear() === d.getFullYear() && od.getMonth() === d.getMonth();
            } catch { return false; }
          });
          const uniqueCusts = new Set(monthOrders.map(o => o.customerName || '—')).size;
          const repeaters = monthOrders.filter(o => {
            const name = o.customerName || '—';
            // Count if this customer also had an order in previous months
            const prevOrder = orders.find(po => {
              if (po === o || po.status === 'Cancelled') return false;
              try {
                const pod = (po.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(po.createdAt as string);
                const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
                return po.customerName === name && pod < od;
              } catch { return false; }
            });
            return !!prevOrder;
          });
          const repeatPct240 = uniqueCusts > 0 ? Math.round((new Set(repeaters.map(o => o.customerName || '—')).size / uniqueCusts) * 100) : 0;
          return { label, repeatPct: repeatPct240, uniqueCusts };
        });
        const hasData = months240.some(m => m.uniqueCusts > 0);
        if (!hasData) return null;
        const maxPct = Math.max(...months240.map(m => m.repeatPct), 1);
        const latestRepeat = months240[months240.length - 1].repeatPct;
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '🔁 Tekrar Sipariş Oranı (6 Ay)' : '🔁 Order Repeat Rate (6 Months)'}</h3>
              <span className={`text-xl font-black ${latestRepeat >= 50 ? 'text-emerald-600' : latestRepeat >= 30 ? 'text-amber-500' : 'text-red-500'}`}>%{latestRepeat}</span>
            </div>
            <div className="flex items-end gap-3 h-24 mb-2">
              {months240.map((m, i) => {
                const isLatest = i === months240.length - 1;
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1">
                    <div className="w-full flex flex-col items-center" style={{ height: '68px' }}>
                      {m.repeatPct > 0 && <span className="text-[8px] font-bold text-gray-500 mb-0.5">%{m.repeatPct}</span>}
                      <div className="w-full flex items-end mt-auto" style={{ height: '52px' }}>
                        <div className={`w-full rounded-t-md ${isLatest ? 'bg-indigo-500' : 'bg-indigo-200'}`} style={{ height: `${Math.max(4, Math.round((m.repeatPct / maxPct) * 52))}px` }} />
                      </div>
                    </div>
                    <span className={`text-[9px] leading-none ${isLatest ? 'font-bold text-indigo-600' : 'text-gray-400'}`}>{m.label}</span>
                  </div>
                );
              })}
            </div>
            <p className="text-[10px] text-gray-400">{currentLanguage === 'tr' ? 'Benchmark: %40+ sağlıklı tekrar müşteri oranı (B2B)' : 'Benchmark: 40%+ healthy repeat customer rate (B2B)'}</p>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 3 && quotations.length >= 2 && (() => {
        const now242 = new Date();
        const monthStart242 = new Date(now242.getFullYear(), now242.getMonth(), 1);
        const monthRev = orders.filter(o => {
          if (o.status === 'Cancelled') return false;
          try {
            const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
            return od >= monthStart242;
          } catch { return false; }
        }).reduce((s, o) => s + (o.totalPrice || 0), 0);
        // Open quotations = pipeline value
        const openQuotes = quotations.filter(q => {
          const m = q as unknown as Record<string,unknown>;
          const status = (m.status as string) || '';
          return status !== 'Converted to Order' && status !== 'rejected' && status !== 'expired';
        });
        const pipelineVal = openQuotes.reduce((s, q) => {
          const m = q as unknown as Record<string,unknown>;
          return s + ((m.totalAmount as number) || (m.total as number) || 0);
        }, 0);
        const conversionRate = openQuotes.length > 0 ? Math.round((openQuotes.length / Math.max(quotations.length, 1)) * 100) : 0;
        if (pipelineVal === 0 && monthRev === 0) return null;
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-4">{currentLanguage === 'tr' ? '🎯 Hedef Gerçekleşme vs Boru Hattı' : '🎯 Quota Attainment vs Pipeline'}</h3>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div className="bg-emerald-50 rounded-2xl p-4">
                <p className="text-[10px] font-bold text-emerald-700 uppercase tracking-wide mb-1">{currentLanguage === 'tr' ? 'Bu Ay Gerçekleşen' : 'This Month Closed'}</p>
                <p className="text-3xl font-black text-emerald-700">{fmtAna(monthRev,'K',0)}</p>
                <p className="text-[10px] text-emerald-600 mt-1">{currentLanguage === 'tr' ? 'Kapanmış siparişler' : 'Closed orders'}</p>
              </div>
              <div className="bg-blue-50 rounded-2xl p-4">
                <p className="text-[10px] font-bold text-blue-700 uppercase tracking-wide mb-1">{currentLanguage === 'tr' ? 'Açık Teklif Pipeline' : 'Open Quote Pipeline'}</p>
                <p className="text-3xl font-black text-blue-700">{fmtAna(pipelineVal,'K',0)}</p>
                <p className="text-[10px] text-blue-600 mt-1">{openQuotes.length} {currentLanguage === 'tr' ? 'açık teklif' : 'open quotes'}</p>
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-600">{currentLanguage === 'tr' ? 'Toplam teklif sayısı' : 'Total quotes'}</span>
                <span className="font-bold text-gray-700">{quotations.length}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-600">{currentLanguage === 'tr' ? 'Açık teklif oranı' : 'Open quote rate'}</span>
                <span className="font-bold text-blue-600">%{conversionRate}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-600">{currentLanguage === 'tr' ? 'Pipeline / Gerçekleşen Oranı' : 'Pipeline / Closed Ratio'}</span>
                <span className="font-bold text-gray-700">{monthRev > 0 ? (pipelineVal / monthRev).toFixed(1) : '—'}×</span>
              </div>
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 5 && inventory.length > 0 && (() => {
        // Customers who bought from category A but never from category B
        const cats244 = [...new Set(inventory.map(i => i.category).filter(Boolean))].slice(0, 4) as string[];
        if (cats244.length < 2) return null;
        const custCats: Record<string, Set<string>> = {};
        for (const o of orders) {
          if (o.status === 'Cancelled') continue;
          const name = o.customerName || '—';
          if (!custCats[name]) custCats[name] = new Set();
          for (const li of (o.lineItems ?? [])) {
            const inv = inventory.find(ii => ii.id === li.inventoryId || ii.name === li.name);
            if (inv?.category) custCats[name].add(inv.category);
          }
        }
        // For each pair of categories, find customers who bought A but not B
        const opportunities: { catA: string; catB: string; count: number }[] = [];
        for (let a = 0; a < cats244.length; a++) {
          for (let b = 0; b < cats244.length; b++) {
            if (a === b) continue;
            const count = Object.values(custCats).filter(s => s.has(cats244[a]) && !s.has(cats244[b])).length;
            if (count >= 2) opportunities.push({ catA: cats244[a], catB: cats244[b], count });
          }
        }
        const top6 = opportunities.sort((a, b) => b.count - a.count).slice(0, 6);
        if (top6.length === 0) return null;
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-4">{currentLanguage === 'tr' ? '🔀 Çapraz Satış Fırsatı Matrisi' : '🔀 Cross-Sell Opportunity Matrix'}</h3>
            <div className="space-y-2">
              {top6.map((op, i) => (
                <div key={i} className="flex items-center gap-2 p-2.5 bg-blue-50 rounded-xl">
                  <span className="text-xs font-bold text-blue-800 truncate">{op.catA}</span>
                  <span className="text-blue-400 text-xs shrink-0">→</span>
                  <span className="text-xs font-bold text-emerald-700 truncate">{op.catB}</span>
                  <span className="text-[10px] text-gray-500 shrink-0 ml-auto">{op.count} {currentLanguage === 'tr' ? 'müşteri' : 'customers'}</span>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-gray-400 mt-3">{currentLanguage === 'tr' ? 'A kategorisini satın alan ama B kategorisini henüz almayan müşteriler' : 'Customers who bought category A but not yet category B'}</p>
          </div>
        );
      })()}

      {reportsTab === 'crm' && quotations.length >= 3 && (() => {
        const now247 = new Date();
        const openQuotes247 = quotations.filter(q => {
          const m = q as unknown as Record<string,unknown>;
          const status = (m.status as string) || '';
          return status !== 'Converted to Order' && status !== 'rejected' && status !== 'expired';
        });
        if (openQuotes247.length === 0) return null;
        const ageBuckets247 = [
          { label: currentLanguage === 'tr' ? '0-7 Gün' : '0-7 Days', min: 0, max: 7, count: 0, value: 0 },
          { label: currentLanguage === 'tr' ? '8-14 Gün' : '8-14 Days', min: 8, max: 14, count: 0, value: 0 },
          { label: currentLanguage === 'tr' ? '15-30 Gün' : '15-30 Days', min: 15, max: 30, count: 0, value: 0 },
          { label: currentLanguage === 'tr' ? '30+ Gün' : '30+ Days', min: 31, max: Infinity, count: 0, value: 0 },
        ];
        for (const q of openQuotes247) {
          const m = q as unknown as Record<string,unknown>;
          const val = (m.totalAmount as number) || (m.total as number) || 0;
          try {
            const created = (q.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(q.createdAt as string);
            const age = Math.round((now247.getTime() - created.getTime()) / 86400000);
            const b = ageBuckets247.find(b => age >= b.min && age <= b.max);
            if (b) { b.count++; b.value += val; }
          } catch { /* skip */ }
        }
        const staleQuotes = ageBuckets247.slice(2).reduce((s, b) => s + b.value, 0);
        const totalQVal = ageBuckets247.reduce((s, b) => s + b.value, 0);
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '⏰ Teklif Yaşlandırma Analizi' : '⏰ Quotation Aging Analysis'}</h3>
              {staleQuotes > 0 && (
                <span className="text-xs font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">
                  {fmtAna(staleQuotes,'K',0)} {currentLanguage === 'tr' ? 'eski teklif' : 'stale quotes'}
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              {ageBuckets247.map(b => (
                <div key={b.label} className={`rounded-xl p-3 ${b.min >= 15 && b.count > 0 ? 'bg-amber-50 border border-amber-100' : 'bg-gray-50'}`}>
                  <p className={`text-xl font-bold ${b.min >= 15 && b.count > 0 ? 'text-amber-600' : 'text-gray-700'}`}>{b.count}</p>
                  <p className="text-[10px] text-gray-600 font-medium">{b.label}</p>
                  {b.value > 0 && <p className="text-[9px] text-gray-400">{fmtAna(b.value,'K',0)}</p>}
                </div>
              ))}
            </div>
            <p className="text-[10px] text-gray-400 mt-3">{currentLanguage === 'tr' ? `${openQuotes247.length} açık teklif · Toplam: ₺${(totalQVal/1000).toFixed(0)}K` : `${openQuotes247.length} open quotes · Total: ₺${(totalQVal/1000).toFixed(0)}K`}</p>
          </div>
        );
      })()}
    </>
  );
}
