/**
 * PipelineAsamaHizi — CrmRapor.tsx'ten mekanik bölme ile çıkarıldı (2026-08-31).
 * Gövde BİREBİR taşındı (davranış değişmedi; yalnız girinti düzeltildi).
 * Render koşulu `reportsTab === 'crm' && quotations.length >= 5` ebeveyn CrmRapor.tsx'te durur.
 * Props: ReportsCtx'in tamamı DEĞİL — yalnız bu kartın gerçekten kullandığı alanlar.
 */
import type { ReportsCtx } from '../useReportsData';

type Props = Pick<ReportsCtx, 'quotations' | 'currentLanguage'>;

export default function PipelineAsamaHizi({ quotations, currentLanguage }: Props) {
  // How long quotes sit at each status before moving
  const now255 = new Date();
  const stageGroups: Record<string, number[]> = { draft: [], sent: [], negotiation: [], pending: [] };
  for (const q of quotations) {
    const m = q as unknown as Record<string,unknown>;
    const status = ((m.status as string) || '').toLowerCase();
    try {
      const created = (q.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(q.createdAt as string);
      const age = Math.round((now255.getTime() - created.getTime()) / 86400000);
      if (age < 0 || age > 365) continue;
      if (status === 'draft' || status === 'taslak') stageGroups.draft.push(age);
      else if (status === 'sent' || status === 'gönderildi') stageGroups.sent.push(age);
      else if (status === 'negotiation' || status === 'müzakere') stageGroups.negotiation.push(age);
      else if (status === 'pending' || status === 'beklemede') stageGroups.pending.push(age);
    } catch { /* skip */ }
  }
  const stages255 = [
    { key: 'draft', label: currentLanguage === 'tr' ? 'Taslak' : 'Draft', color: 'bg-gray-400' },
    { key: 'sent', label: currentLanguage === 'tr' ? 'Gönderildi' : 'Sent', color: 'bg-blue-400' },
    { key: 'negotiation', label: currentLanguage === 'tr' ? 'Müzakere' : 'Negotiation', color: 'bg-amber-400' },
    { key: 'pending', label: currentLanguage === 'tr' ? 'Beklemede' : 'Pending', color: 'bg-purple-400' },
  ].map(s => ({
    ...s,
    avg: stageGroups[s.key].length > 0 ? Math.round(stageGroups[s.key].reduce((a, b) => a + b, 0) / stageGroups[s.key].length) : 0,
    count: stageGroups[s.key].length,
  })).filter(s => s.count > 0);
  if (stages255.length === 0) {
    // Fallback: just show quote status distribution
    const statusDist: Record<string, number> = {};
    for (const q of quotations) {
      const m = q as unknown as Record<string,unknown>;
      const st = (m.status as string) || (currentLanguage === 'tr' ? 'Bilinmiyor' : 'Unknown');
      statusDist[st] = (statusDist[st] ?? 0) + 1;
    }
    const items = Object.entries(statusDist).sort(([,a],[,b]) => b - a).slice(0, 5);
    return (
      <div className="apple-card p-6">
        <h3 className="font-bold text-gray-800 mb-4">{currentLanguage === 'tr' ? '📋 Teklif Durum Dağılımı' : '📋 Quote Status Distribution'}</h3>
        <div className="space-y-2">
          {items.map(([status, count]) => (
            <div key={status} className="flex items-center justify-between text-xs">
              <span className="text-gray-700 capitalize">{status}</span>
              <div className="flex items-center gap-2 shrink-0 ml-2">
                <div className="w-24 h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-400 rounded-full" style={{ width: `${Math.round((count / quotations.length) * 100)}%` }} />
                </div>
                <span className="font-bold text-gray-700 w-6 text-right">{count}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }
  const maxAvg255 = Math.max(...stages255.map(s => s.avg), 1);
  return (
    <div className="apple-card p-6">
      <h3 className="font-bold text-gray-800 mb-4">{currentLanguage === 'tr' ? '⚡ Pipeline Aşama Hızı' : '⚡ Pipeline Stage Velocity'}</h3>
      <div className="space-y-3">
        {stages255.map(s => (
          <div key={s.key}>
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${s.color}`} />
                <span className="text-xs font-medium text-gray-700">{s.label}</span>
                <span className="text-[10px] text-gray-400">({s.count})</span>
              </div>
              <span className={`text-sm font-bold ${s.avg > 14 ? 'text-red-500' : s.avg > 7 ? 'text-amber-500' : 'text-emerald-600'}`}>{s.avg}d {currentLanguage === 'tr' ? 'ort.' : 'avg'}</span>
            </div>
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
              <div className={`h-full rounded-full ${s.color}`} style={{ width: `${Math.max(4, Math.round((s.avg / maxAvg255) * 100))}%` }} />
            </div>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-gray-400 mt-3">{currentLanguage === 'tr' ? 'Her aşamada tekliflerin ortalama bekleme süresi' : 'Avg time quotes spend at each pipeline stage'}</p>
    </div>
  );
}
