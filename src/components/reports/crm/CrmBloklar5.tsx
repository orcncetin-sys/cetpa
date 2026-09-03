/**
 * CrmBloklar5.tsx — CrmRapor bölmesi (2026-09-03)
 *
 * CrmRapor.tsx'ten mekanik olarak çıkarıldı (bölme öncesi satır 787–847, 1 blok).
 * Bloklar ORİJİNAL SIRASIYLA ve içeriği DEĞİŞTİRİLMEDEN taşındı; bloklardaki
 * `reportsTab === 'crm'` koşulları BİLEREK korundu (bkz. CrmRapor.tsx başlık
 * notu — ebeveyn zaten sekmeye göre render ediyor, koşulu silmek "saf kopya"
 * güvencesini bozardı).
 * Props yalnız bu dosyanın gerçekten kullandığı ctx alanlarıdır
 * (tsc "Cannot find name" listesinden çıkarıldı).
 */
import type { ReportsCtx } from '../useReportsData';

type Props = Pick<ReportsCtx, 'reportsTab' | 'quotations' | 'currentLanguage'>;

export default function CrmBloklar5({ reportsTab, quotations, currentLanguage }: Props) {
  return (
    <>
      {reportsTab === 'crm' && quotations.length >= 3 && (() => {
        // Days from quotation creation to conversion
        const conversionTimes: number[] = [];
        for (const q of quotations) {
          const m = q as unknown as Record<string,unknown>;
          const status = (m.status as string) || '';
          if (status !== 'Converted to Order' && status !== 'accepted') continue;
          try {
            const created = (q.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(q.createdAt as string);
            const converted = m.convertedAt
              ? ((m.convertedAt as { toDate?: () => Date }).toDate?.() ?? new Date(m.convertedAt as string))
              : new Date();
            const days = Math.round((converted.getTime() - created.getTime()) / 86400000);
            if (days >= 0 && days < 180) conversionTimes.push(days);
          } catch { /* skip */ }
        }
        if (conversionTimes.length < 2) return null;
        const avgDays = Math.round(conversionTimes.reduce((s, d) => s + d, 0) / conversionTimes.length);
        const minDays = Math.min(...conversionTimes);
        const maxDays = Math.max(...conversionTimes);
        const buckets226 = [
          { label: currentLanguage === 'tr' ? 'Aynı gün' : 'Same day', max: 0, count: 0 },
          { label: '1-3d', max: 3, count: 0 },
          { label: '4-7d', max: 7, count: 0 },
          { label: '8-30d', max: 30, count: 0 },
          { label: '30d+', max: Infinity, count: 0 },
        ];
        for (const d of conversionTimes) {
          const b = buckets226.find(b => d <= b.max);
          if (b) b.count++;
        }
        const maxBkt226 = Math.max(...buckets226.map(b => b.count), 1);
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '⏱️ Teklif → Sipariş Dönüşüm Süresi' : '⏱️ Quote → Order Conversion Time'}</h3>
              <span className="text-xl font-black text-blue-600">{avgDays} {currentLanguage === 'tr' ? 'gün ort.' : 'd avg'}</span>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="bg-emerald-50 rounded-xl p-3 text-center">
                <p className="text-xl font-bold text-emerald-600">{minDays} {currentLanguage === 'tr' ? 'gün' : 'd'}</p>
                <p className="text-[10px] text-gray-400">{currentLanguage === 'tr' ? 'En hızlı' : 'Fastest'}</p>
              </div>
              <div className="bg-amber-50 rounded-xl p-3 text-center">
                <p className="text-xl font-bold text-amber-600">{maxDays} {currentLanguage === 'tr' ? 'gün' : 'd'}</p>
                <p className="text-[10px] text-gray-400">{currentLanguage === 'tr' ? 'En yavaş' : 'Slowest'}</p>
              </div>
            </div>
            <div className="flex items-end gap-2 h-16">
              {buckets226.map(b => (
                <div key={b.label} className="flex-1 flex flex-col items-center gap-1">
                  <div className="w-full flex items-end" style={{ height: '44px' }}>
                    <div className="w-full bg-blue-300 rounded-t-md" style={{ height: `${Math.max(4, Math.round((b.count / maxBkt226) * 44))}px` }} />
                  </div>
                  <span className="text-[9px] text-gray-400 leading-none text-center">{b.label}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}
    </>
  );
}
