/**
 * TeklifSiparisDonusumu — CrmRapor.tsx'ten mekanik bölme ile çıkarıldı (2026-08-31).
 * Gövde BİREBİR taşındı (davranış değişmedi; yalnız girinti düzeltildi).
 * Render koşulu `reportsTab === 'crm' && quotations.length > 0` ebeveyn CrmRapor.tsx'te durur.
 * Props: ReportsCtx'in tamamı DEĞİL — yalnız bu kartın gerçekten kullandığı alanlar.
 */
import type { ReportsCtx } from '../useReportsData';

type Props = Pick<ReportsCtx, 'quotations' | 'currentLanguage' | 'fmtAna'>;

export default function TeklifSiparisDonusumu({ quotations, currentLanguage, fmtAna }: Props) {
  const total145 = quotations.length;
  const converted145 = quotations.filter(q => q.status === 'Converted to Order' || q.status === 'approved').length;
  const pending145 = quotations.filter(q => q.status === 'pending').length;
  const convRate = total145 > 0 ? Math.round((converted145 / total145) * 100) : 0;
  // Monthly conversion last 6m
  const now145 = new Date();
  const months145 = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now145.getFullYear(), now145.getMonth() - (5 - i), 1);
    const label = d.toLocaleDateString(currentLanguage === 'tr' ? 'tr-TR' : 'en-US', { month: 'short' });
    const mq = quotations.filter(q => {
      if (!q.createdAt) return false;
      try {
        const qd = (q.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(q.createdAt as string);
        return qd.getFullYear() === d.getFullYear() && qd.getMonth() === d.getMonth();
      } catch { return false; }
    });
    return { label, total: mq.length, converted: mq.filter(q => q.status === 'Converted to Order' || q.status === 'approved').length };
  });
  const totalQuoteValue = quotations.reduce((s, q) => s + (q.totalAmount || 0), 0);
  const convertedValue = quotations.filter(q => q.status === 'Converted to Order' || q.status === 'approved').reduce((s, q) => s + (q.totalAmount || 0), 0);
  return (
    <div className="apple-card p-6">
      <h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? '📋 Teklif → Sipariş Dönüşümü' : '📋 Quote-to-Order Conversion'}</h3>
      <p className="text-xs text-gray-400 mb-4">{currentLanguage === 'tr' ? 'Tekliflerin siparişe dönüşüm analizi' : 'Analysis of quote-to-order pipeline'}</p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        {[
          { label: currentLanguage==='tr'?'Toplam Teklif':'Total Quotes', value: String(total145), color: 'text-blue-600' },
          { label: currentLanguage==='tr'?'Dönüştürülen':'Converted', value: String(converted145), color: 'text-emerald-600' },
          { label: currentLanguage==='tr'?'Dönüşüm Oranı':'Conversion Rate', value: `%${convRate}`, color: convRate >= 40 ? 'text-emerald-600' : 'text-amber-600' },
          { label: currentLanguage==='tr'?'Bekleyen':'Pending', value: String(pending145), color: 'text-amber-600' },
        ].map(k => (
          <div key={k.label} className="text-center">
            <p className={`text-2xl font-bold ${k.color}`}>{k.value}</p>
            <p className="text-[10px] text-gray-400 mt-0.5">{k.label}</p>
          </div>
        ))}
      </div>
      {/* Value conversion */}
      <div className="mb-5">
        <div className="flex items-center justify-between text-xs mb-1.5">
          <span className="text-gray-600">{currentLanguage==='tr'?'Teklif Değeri Dönüşümü':'Quote Value Conversion'}</span>
          <span className="font-semibold text-emerald-600">{fmtAna(convertedValue)} / {fmtAna(totalQuoteValue)}</span>
        </div>
        <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
          <div className="h-full bg-emerald-400 rounded-full transition-all" style={{ width: `${totalQuoteValue > 0 ? Math.round((convertedValue/totalQuoteValue)*100) : 0}%` }} />
        </div>
      </div>
      {/* Monthly mini chart */}
      <div className="flex items-end gap-2 h-16">
        {months145.map((m, i) => {
          const maxM = Math.max(...months145.map(x => x.total), 1);
          const h = Math.round((m.total / maxM) * 100);
          const convH = m.total > 0 ? Math.round((m.converted / m.total) * 100) : 0;
          return (
            <div key={i} className="flex-1 flex flex-col items-center gap-1">
              <div className="w-full flex flex-col justify-end overflow-hidden rounded-t-sm" style={{ height: '48px' }}>
                <div className="w-full bg-gray-100 rounded-t-sm overflow-hidden" style={{ height: `${h}%` }}>
                  <div className="w-full bg-emerald-400 rounded-t-sm" style={{ height: `${convH}%` }} />
                </div>
              </div>
              <span className="text-[9px] text-gray-400">{m.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
