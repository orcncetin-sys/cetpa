/**
 * IlkYenidenSiparisSuresi — CrmRapor.tsx'ten mekanik bölme ile çıkarıldı (2026-08-31).
 * Gövde BİREBİR taşındı (davranış değişmedi; yalnız girinti düzeltildi).
 * Render koşulu `reportsTab === 'crm' && orders.length >= 8` ebeveyn CrmRapor.tsx'te durur.
 * Props: ReportsCtx'in tamamı DEĞİL — yalnız bu kartın gerçekten kullandığı alanlar.
 */
import type { ReportsCtx } from '../useReportsData';

type Props = Pick<ReportsCtx, 'orders' | 'currentLanguage'>;

export default function IlkYenidenSiparisSuresi({ orders, currentLanguage }: Props) {
  // For each customer, find gap between 1st and 2nd order
  const custFirstTwo: Record<string, number[]> = {};
  for (const o of orders) {
    if (o.status === 'Cancelled') continue;
    const name = o.customerName || '—';
    try {
      const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
      if (!custFirstTwo[name]) custFirstTwo[name] = [];
      custFirstTwo[name].push(od.getTime());
    } catch { /* skip */ }
  }
  const reorderDays: number[] = [];
  for (const times of Object.values(custFirstTwo)) {
    if (times.length < 2) continue;
    times.sort((a, b) => a - b);
    const gap = Math.round((times[1] - times[0]) / 86400000);
    if (gap > 0 && gap < 365) reorderDays.push(gap);
  }
  if (reorderDays.length < 3) return null;
  reorderDays.sort((a, b) => a - b);
  const avgDays252 = Math.round(reorderDays.reduce((s, d) => s + d, 0) / reorderDays.length);
  const medianDays252 = reorderDays[Math.floor(reorderDays.length / 2)];
  const fast252 = reorderDays.filter(d => d <= 30).length;
  const slow252 = reorderDays.filter(d => d > 90).length;
  const buckets252 = [
    { label: '≤7d', max: 7, count: 0 },
    { label: '8-30d', max: 30, count: 0 },
    { label: '31-60d', max: 60, count: 0 },
    { label: '61-90d', max: 90, count: 0 },
    { label: '90d+', max: Infinity, count: 0 },
  ];
  for (const d of reorderDays) {
    const b = buckets252.find(b => d <= b.max);
    if (b) b.count++;
  }
  const maxBkt252 = Math.max(...buckets252.map(b => b.count), 1);
  return (
    <div className="apple-card p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '🔄 İlk Yeniden Sipariş Süresi' : '🔄 Days to First Reorder'}</h3>
        <span className="text-xl font-black text-blue-600">{avgDays252}d {currentLanguage === 'tr' ? 'ort.' : 'avg'}</span>
      </div>
      <div className="grid grid-cols-3 gap-3 mb-4">
        {[
          { label: currentLanguage === 'tr' ? 'Ortalama' : 'Average', value: `${avgDays252}d`, color: 'text-blue-600' },
          { label: currentLanguage === 'tr' ? 'Medyan' : 'Median', value: `${medianDays252}d`, color: 'text-gray-700' },
          { label: currentLanguage === 'tr' ? '≤30 gün tekrar' : '≤30d reorder', value: `${fast252}`, color: 'text-emerald-600' },
        ].map(k => (
          <div key={k.label} className="bg-gray-50 rounded-xl p-3 text-center">
            <p className={`text-xl font-bold ${k.color}`}>{k.value}</p>
            <p className="text-[10px] text-gray-400 mt-0.5">{k.label}</p>
          </div>
        ))}
      </div>
      <div className="flex items-end gap-2 h-14">
        {buckets252.map(b => (
          <div key={b.label} className="flex-1 flex flex-col items-center gap-1">
            <div className="w-full flex items-end" style={{ height: '40px' }}>
              <div className="w-full bg-blue-300 rounded-t-md" style={{ height: `${Math.max(4, Math.round((b.count / maxBkt252) * 40))}px` }} />
            </div>
            <span className="text-[9px] text-gray-400 leading-none">{b.label}</span>
          </div>
        ))}
      </div>
      {slow252 > 0 && <p className="text-[10px] text-amber-600 mt-2 font-medium">⚠ {slow252} {currentLanguage === 'tr' ? 'müşteri 90+ günde tekrar sipariş verdi' : 'customers took 90+ days to reorder'}</p>}
    </div>
  );
}
