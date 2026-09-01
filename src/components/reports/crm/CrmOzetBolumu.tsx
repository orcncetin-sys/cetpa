/**
 * CrmOzetBolumu — CrmRapor.tsx'ten mekanik bölme ile çıkarıldı (2026-08-31).
 * Gövde BİREBİR taşındı (davranış değişmedi; yalnız girinti düzeltildi).
 * Render koşulu `reportsTab === 'crm'` ebeveyn CrmRapor.tsx'te durur.
 * Props: ReportsCtx'in tamamı DEĞİL — yalnız bu kartın gerçekten kullandığı alanlar.
 */
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart as RePieChart, Pie, Cell,
} from 'recharts';
import { Users, UserCheck, CheckCircle2, CreditCard } from 'lucide-react';
import { formatInCurrency, type ExchangeRates } from '../../../utils/currency';
import type { ReportsCtx } from '../useReportsData';
import { KpiCard, KpiGrid, KpiCurrencyToggle } from '../ReportKit';

type Props = Pick<ReportsCtx, 'orders' | 'currentLanguage' | 'currentT' | 'revenueCurrency' | 'setRevenueCurrency' | 'onMusteriAc' | 'statusChartData' | 'COLORS' | 'topCustomers' | 'trendData'> & {
  /** `exchangeRates ?? undefined` — yalnız TİP köprüsü, ebeveynde türetilir (bkz. CrmRapor.tsx). */
  fxKurlari: ExchangeRates | undefined;
};

export default function CrmOzetBolumu({ orders, currentLanguage, currentT, revenueCurrency, setRevenueCurrency, onMusteriAc, statusChartData, COLORS, topCustomers, trendData, fxKurlari }: Props) {
  return (
    <div className="space-y-6">
      {/* KPIs — KONUYA UYGUN METRİKLER (2026-08-21).
          Burada eskiden SİPARİŞ DURUMU sayıları vardı (Toplam Sipariş /
          Teslim Edilen / Bekleyen / İptal). Bunlar bir CRM raporunun konusu
          değil — sipariş hattı zaten Lojistik ve Genel raporlarında var.
          Kullanıcı: "rapor çekerken gelen veriler o konuyla ilgili olmalı."
          CRM'in konusu MÜŞTERİ; metrikler sipariş verisinden müşteri
          bazında türetiliyor (ayrı veri kaynağı gerekmedi). */}
      {(() => {
        const musteriAdi = (o: typeof orders[number]) => (o.customerName || '—').trim();
        const gecerli = orders.filter(o => o.status !== 'Cancelled');
        const musteriler = new Map<string, { adet: number; ciro: number; ilk: number }>();
        for (const o of gecerli) {
          const ad = musteriAdi(o);
          const ms = (() => {
            const raw = o.createdAt as { toDate?: () => Date } | string | undefined;
            try { const d = (raw as { toDate?: () => Date })?.toDate?.() ?? new Date(raw as string); return d.getTime(); }
            catch { return NaN; }
          })();
          const m = musteriler.get(ad) ?? { adet: 0, ciro: 0, ilk: Number.POSITIVE_INFINITY };
          m.adet += 1;
          m.ciro += Number(o.totalPrice) || 0;
          if (Number.isFinite(ms)) m.ilk = Math.min(m.ilk, ms);
          musteriler.set(ad, m);
        }
        const toplamMusteri = musteriler.size;
        const otuzGunOnce = Date.now() - 30 * 86_400_000;
        // "Yeni" = İLK siparişi son 30 günde olan müşteri (yalnız sipariş
        // vereni değil) — aksi halde 5 yıllık müşteri de "yeni" sayılırdı.
        const yeni = [...musteriler.values()].filter(m => Number.isFinite(m.ilk) && m.ilk >= otuzGunOnce).length;
        const tekrarEden = [...musteriler.values()].filter(m => m.adet > 1).length;
        const toplamCiro = [...musteriler.values()].reduce((s, m) => s + m.ciro, 0);
        const ortDeger = toplamMusteri ? toplamCiro / toplamMusteri : 0;
        const sadakatYuzde = toplamMusteri ? Math.round((tekrarEden / toplamMusteri) * 100) : 0;

        const kartlar = [
          { label: currentLanguage==='tr'?'Toplam Müşteri':'Total Customers', value: String(toplamMusteri),
            hint: currentLanguage==='tr'?'sipariş vermiş tekil müşteri':'unique customers with orders',
            icon: Users, accent: 'text-brand', accentBg: 'bg-brand/10', money: false },
          { label: currentLanguage==='tr'?'Yeni Müşteri (30g)':'New Customers (30d)', value: String(yeni),
            hint: currentLanguage==='tr'?'ilk siparişi son 30 günde':'first order in last 30 days',
            icon: UserCheck, accent: 'text-green-600', accentBg: 'bg-green-50', money: false },
          { label: currentLanguage==='tr'?'Tekrar Eden':'Repeat Customers', value: `${tekrarEden} (%${sadakatYuzde})`,
            hint: currentLanguage==='tr'?'birden fazla sipariş veren':'more than one order',
            icon: CheckCircle2, accent: 'text-violet-600', accentBg: 'bg-violet-50', money: false },
          { label: currentLanguage==='tr'?'Ort. Müşteri Değeri':'Avg Customer Value', value: formatInCurrency(ortDeger, revenueCurrency, fxKurlari),
            hint: currentLanguage==='tr'?'iptaller hariç toplam ciro / müşteri':'revenue excl. cancelled / customer',
            icon: CreditCard, accent: 'text-amber-600', accentBg: 'bg-amber-50', money: true },
        ];
        return (
          <KpiGrid>
            {kartlar.map((k, i) => (
              // Kart tıklanınca CRM→Müşteriler'e inilir (2026-08-31 kullanıcı
              // bildirimi: "kartlara basınca detaya gidemiyoruz").
              <div key={i} onClick={() => onMusteriAc?.('')}
                className={onMusteriAc ? 'cursor-pointer transition-transform hover:-translate-y-0.5' : undefined}
                title={onMusteriAc ? (currentLanguage==='tr'?'Müşteri listesini aç':'Open customer list') : undefined}>
                <KpiCard index={i} label={k.label} value={k.value} hint={k.hint}
                  icon={k.icon} accent={k.accent} accentBg={k.accentBg}
                  action={k.money ? <KpiCurrencyToggle value={revenueCurrency} onChange={setRevenueCurrency} /> : undefined} />
              </div>
            ))}
          </KpiGrid>
        );
      })()}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Status Dağılımı */}
        <div className="apple-card p-6">
          <h3 className="font-bold text-gray-800 mb-4">{currentLanguage==='tr'?'Sipariş Durumu Dağılımı':'Order Status Distribution'}</h3>
          <div className="h-[250px]">
            <ResponsiveContainer width="100%" height="100%">
              <RePieChart>
                <Pie data={statusChartData} cx="50%" cy="50%" innerRadius={50} outerRadius={90} paddingAngle={4} dataKey="value" label={(props: { name?: string, percent?: number }) => `${props.name || ''} ${((props.percent||0)*100).toFixed(0)}%`} labelLine={false}>
                  {statusChartData.map((_, i) => <Cell key={i} fill={COLORS[i%COLORS.length]} />)}
                </Pie>
                <Tooltip />
              </RePieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Top Müşteriler */}
        <div className="apple-card p-6">
          <h3 className="font-bold text-gray-800 mb-4">{currentLanguage==='tr'?'En Çok Sipariş Veren Müşteriler':'Top Customers by Revenue'}</h3>
          <div className="space-y-2 max-h-[280px] overflow-y-auto">
            {topCustomers.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">{currentLanguage==='tr'?'Henüz sipariş yok.':'No orders yet.'}</p>
            ) : topCustomers.map((c, i) => (
              // Satır tıklanınca o müşteri CRM→Müşteriler'de ada filtreli açılır
              // (2026-08-31 kullanıcı bildirimi: "kartlara basınca detaya gidemiyoruz").
              <button key={i} type="button" onClick={() => onMusteriAc?.(c.name)}
                disabled={!onMusteriAc}
                className="w-full text-left flex items-center gap-3 py-2 border-b border-gray-50 last:border-0 rounded-lg px-1 -mx-1 enabled:hover:bg-gray-50 enabled:cursor-pointer transition-colors">
                <div className="w-6 h-6 rounded-full bg-brand/10 flex items-center justify-center text-[10px] font-bold text-brand flex-shrink-0">{i+1}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-800 truncate">{c.name}</p>
                  <p className="text-xs text-gray-400">{c.count} {currentLanguage==='tr'?'sipariş':'orders'}</p>
                </div>
                <span className="text-sm font-bold text-brand">{formatInCurrency(c.total, revenueCurrency, fxKurlari)}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Satış Trendi */}
      <div className="apple-card p-6">
        <h3 className="font-bold text-gray-800 mb-4">{currentT.sales_trend}</h3>
        <div className="h-[280px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={trendData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F5F5F7" />
              <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fontSize:11,fill:'#86868B'}} />
              <YAxis axisLine={false} tickLine={false} tick={{fontSize:11,fill:'#86868B'}} />
              <Tooltip contentStyle={{borderRadius:'12px',border:'none',boxShadow:'0 10px 25px rgba(0,0,0,0.1)'}} />
              <Bar dataKey="value" fill="#ff4000" radius={[6,6,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ── Phase 129: Sales Rep Leaderboard (by order assignee) ── */}
      {orders.length > 0 && (() => {
        type RepStat = { name: string; orderCount: number; revenue: number; delivered: number };
        const repMap: Record<string, RepStat> = {};
        for (const o of orders) {
          if (o.status === 'Cancelled') continue;
          const rep = (o.assignedTo as string | undefined) || o.customerName || '—';
          const key = rep.length > 30 ? rep.slice(0, 15) + '…' : rep;
          if (!repMap[key]) repMap[key] = { name: key, orderCount: 0, revenue: 0, delivered: 0 };
          repMap[key].orderCount++;
          repMap[key].revenue += o.totalPrice || 0;
          if (o.status === 'Delivered') repMap[key].delivered++;
        }
        const reps = Object.values(repMap).sort((a, b) => b.revenue - a.revenue).slice(0, 8);
        if (reps.length === 0) return null;
        const medals = ['🥇', '🥈', '🥉'];
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-4">{currentLanguage === 'tr' ? '🏆 En Çok Ciro Yapanlar' : '🏆 Sales Leaderboard'}</h3>
            <div className="space-y-3">
              {reps.map((r, i) => (
                <div key={r.name} className="flex items-center gap-3 py-2 border-b border-gray-50 last:border-0">
                  <span className="text-base w-7 flex-shrink-0">{medals[i] || `#${i + 1}`}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-gray-800 truncate">{r.name}</p>
                    <p className="text-[10px] text-gray-400">{r.orderCount} {currentLanguage === 'tr' ? 'sipariş' : 'orders'} · {r.delivered} {currentLanguage === 'tr' ? 'teslim' : 'delivered'}</p>
                  </div>
                  <span className="text-sm font-bold text-brand">{formatInCurrency(r.revenue, revenueCurrency, fxKurlari)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
