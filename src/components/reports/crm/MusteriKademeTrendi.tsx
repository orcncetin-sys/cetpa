/**
 * MusteriKademeTrendi — CrmRapor.tsx'ten mekanik bölme ile çıkarıldı (2026-08-31).
 * Gövde BİREBİR taşındı (davranış değişmedi; yalnız girinti düzeltildi).
 * Render koşulu `reportsTab === 'crm' && orders.length >= 5` ebeveyn CrmRapor.tsx'te durur.
 * Props: ReportsCtx'in tamamı DEĞİL — yalnız bu kartın gerçekten kullandığı alanlar.
 */
import type { ReportsCtx } from '../useReportsData';

type Props = Pick<ReportsCtx, 'orders' | 'currentLanguage' | 'fmtAna'>;

export default function MusteriKademeTrendi({ orders, currentLanguage, fmtAna }: Props) {
  // Tier customers by total LTV: Platinum top 20%, Gold mid 60%, Silver bottom 20%
  const custLTV228: Record<string, number> = {};
  for (const o of orders) {
    if (o.status === 'Cancelled') continue;
    const name = o.customerName || '—';
    custLTV228[name] = (custLTV228[name] ?? 0) + (o.totalPrice || 0);
  }
  const sorted228 = Object.entries(custLTV228).sort(([,a],[,b]) => b - a);
  const n228 = sorted228.length;
  if (n228 < 3) return null;
  const topN = Math.ceil(n228 * 0.2);
  const botN = Math.ceil(n228 * 0.2);
  const platinum = new Set(sorted228.slice(0, topN).map(([n]) => n));
  const silver = new Set(sorted228.slice(n228 - botN).map(([n]) => n));
  // Revenue this month by tier
  const now228 = new Date();
  const monthStart228 = new Date(now228.getFullYear(), now228.getMonth(), 1);
  const prevMonthStart228 = new Date(now228.getFullYear(), now228.getMonth() - 1, 1);
  const prevMonthEnd228 = new Date(now228.getFullYear(), now228.getMonth(), 0, 23, 59, 59);
  const tierRevCurr: Record<string, number> = { Platinum: 0, Gold: 0, Silver: 0 };
  const tierRevPrev: Record<string, number> = { Platinum: 0, Gold: 0, Silver: 0 };
  for (const o of orders) {
    if (o.status === 'Cancelled') continue;
    const name = o.customerName || '—';
    const tier = platinum.has(name) ? 'Platinum' : silver.has(name) ? 'Silver' : 'Gold';
    try {
      const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
      if (od >= monthStart228) tierRevCurr[tier] += o.totalPrice || 0;
      else if (od >= prevMonthStart228 && od <= prevMonthEnd228) tierRevPrev[tier] += o.totalPrice || 0;
    } catch { /* skip */ }
  }
  const tierColors: Record<string, { bg: string; text: string; bar: string }> = {
    Platinum: { bg: 'bg-purple-50', text: 'text-purple-700', bar: 'bg-purple-400' },
    Gold: { bg: 'bg-amber-50', text: 'text-amber-700', bar: 'bg-amber-400' },
    Silver: { bg: 'bg-gray-100', text: 'text-gray-600', bar: 'bg-gray-400' },
  };
  const maxTierRev = Math.max(...Object.values(tierRevCurr), 1);
  return (
    <div className="apple-card p-6">
      <h3 className="font-bold text-gray-800 mb-4">{currentLanguage === 'tr' ? '👑 Müşteri Kademesine Göre Satış Trendi' : '👑 Sales Trend by Customer Tier'}</h3>
      <div className="space-y-3">
        {(['Platinum', 'Gold', 'Silver'] as const).map(tier => {
          const curr = tierRevCurr[tier];
          const prev = tierRevPrev[tier];
          const growth = prev > 0 ? Math.round(((curr - prev) / prev) * 100) : null;
          const cls = tierColors[tier];
          return (
            <div key={tier} className={`${cls.bg} rounded-xl p-4`}>
              <div className="flex items-center justify-between mb-2">
                <div>
                  <p className={`text-xs font-bold ${cls.text}`}>{tier === 'Platinum' ? '💎' : tier === 'Gold' ? '⭐' : '🥈'} {tier}</p>
                  <p className="text-[10px] text-gray-400">{tier === 'Platinum' ? `Top ${topN}` : tier === 'Silver' ? `Bottom ${botN}` : `Mid ${n228 - topN - botN}`} {currentLanguage === 'tr' ? 'müşteri' : 'customers'}</p>
                </div>
                <div className="text-right">
                  <p className={`text-lg font-black ${cls.text}`}>{fmtAna(curr,'K',0)}</p>
                  {growth !== null && <p className={`text-[10px] font-bold ${growth >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>{growth >= 0 ? '↑' : '↓'} %{Math.abs(growth)} MoM</p>}
                </div>
              </div>
              <div className="h-1.5 bg-white/60 rounded-full overflow-hidden">
                <div className={`h-full rounded-full ${cls.bar}`} style={{ width: `${Math.max(4, Math.round((curr / maxTierRev) * 100))}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
