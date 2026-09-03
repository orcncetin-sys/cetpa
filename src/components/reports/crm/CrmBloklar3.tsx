/**
 * CrmBloklar3.tsx — CrmRapor bölmesi (2026-09-03)
 *
 * CrmRapor.tsx'ten mekanik olarak çıkarıldı (bölme öncesi satır 393–455, 1 blok).
 * Bloklar ORİJİNAL SIRASIYLA ve içeriği DEĞİŞTİRİLMEDEN taşındı; bloklardaki
 * `reportsTab === 'crm'` koşulları BİLEREK korundu (bkz. CrmRapor.tsx başlık
 * notu — ebeveyn zaten sekmeye göre render ediyor, koşulu silmek "saf kopya"
 * güvencesini bozardı).
 * Props yalnız bu dosyanın gerçekten kullandığı ctx alanlarıdır
 * (tsc "Cannot find name" listesinden çıkarıldı).
 */
import type { ReportsCtx } from '../useReportsData';

type Props = Pick<ReportsCtx, 'reportsTab' | 'orders' | 'currentLanguage' | 'fmtAna'>;

export default function CrmBloklar3({ reportsTab, orders, currentLanguage, fmtAna }: Props) {
  return (
    <>
      {reportsTab === 'crm' && orders.length >= 5 && (() => {
        const now192 = new Date();
        const custMap192: Record<string, { recency: number; frequency: number; monetary: number }> = {};
        for (const o of orders) {
          if (o.status === 'Cancelled') continue;
          const name = o.customerName || '—';
          let days = 999;
          try {
            const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
            days = Math.round((now192.getTime() - od.getTime()) / 86400000);
          } catch { /* skip */ }
          if (!custMap192[name]) custMap192[name] = { recency: days, frequency: 0, monetary: 0 };
          if (days < custMap192[name].recency) custMap192[name].recency = days;
          custMap192[name].frequency++;
          custMap192[name].monetary += o.totalPrice || 0;
        }
        const custs192 = Object.entries(custMap192).map(([name, d]) => ({ name, ...d }));
        if (custs192.length < 3) return null;
        // Quintile scoring 1-5 per dimension
        const sortedR = [...custs192].sort((a, b) => a.recency - b.recency); // lower recency = more recent = higher score
        const sortedF = [...custs192].sort((a, b) => b.frequency - a.frequency);
        const sortedM = [...custs192].sort((a, b) => b.monetary - a.monetary);
        const scoreOf = (arr: typeof custs192, name: string) => {
          const idx = arr.findIndex(c => c.name === name);
          const n = arr.length;
          return n <= 1 ? 5 : Math.round(5 - (idx / (n - 1)) * 4);
        };
        const rfm = custs192.map(c => ({
          name: c.name,
          r: scoreOf(sortedR, c.name),
          f: scoreOf(sortedF, c.name),
          m: scoreOf(sortedM, c.name),
          total: scoreOf(sortedR, c.name) + scoreOf(sortedF, c.name) + scoreOf(sortedM, c.name),
          monetary: c.monetary,
        })).sort((a, b) => b.total - a.total);
        const segmentOf = (total: number) => total >= 13 ? { label: currentLanguage === 'tr' ? '💎 Şampiyonlar' : '💎 Champions', cls: 'bg-emerald-100 text-emerald-700' }
          : total >= 10 ? { label: currentLanguage === 'tr' ? '⭐ Sadık' : '⭐ Loyal', cls: 'bg-blue-100 text-blue-700' }
          : total >= 7 ? { label: currentLanguage === 'tr' ? '😐 Orta' : '😐 At Risk', cls: 'bg-amber-100 text-amber-700' }
          : { label: currentLanguage === 'tr' ? '😴 Uykuda' : '😴 Lost', cls: 'bg-red-100 text-red-600' };
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-4">{currentLanguage === 'tr' ? '🎯 Müşteri RFM Segmentasyonu' : '🎯 Customer RFM Segmentation'}</h3>
            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {rfm.slice(0, 10).map(c => {
                const seg = segmentOf(c.total);
                return (
                  <div key={c.name} className="flex items-center gap-2 py-1 border-b border-gray-50 last:border-0">
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${seg.cls}`}>{seg.label}</span>
                    <span className="text-xs text-gray-700 truncate flex-1">{c.name}</span>
                    <div className="flex items-center gap-1 shrink-0">
                      {[{ v: c.r, t: 'R' }, { v: c.f, t: 'F' }, { v: c.m, t: 'M' }].map(dim => (
                        <span key={dim.t} className={`text-[9px] font-bold w-5 h-5 rounded flex items-center justify-center ${dim.v >= 4 ? 'bg-emerald-400 text-white' : dim.v >= 3 ? 'bg-amber-300 text-gray-800' : 'bg-red-200 text-gray-700'}`}>{dim.v}</span>
                      ))}
                    </div>
                    <span className="text-xs font-bold text-gray-600 shrink-0 ml-1">{fmtAna(c.monetary,'K',0)}</span>
                  </div>
                );
              })}
            </div>
            <p className="text-[10px] text-gray-400 mt-2">{currentLanguage === 'tr' ? 'R=Yenilik, F=Sıklık, M=Para · 1(düşük)–5(yüksek)' : 'R=Recency, F=Frequency, M=Monetary · 1(low)–5(high)'}</p>
          </div>
        );
      })()}
    </>
  );
}
