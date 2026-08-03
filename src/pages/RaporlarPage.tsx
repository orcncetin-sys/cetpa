import { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot } from '../lib/dbClient';
import { db } from '../firebase';
import { Download, FileText } from 'lucide-react';
import UnauthorizedView from '../components/UnauthorizedView';
import ReadOnlyBanner from '../components/ReadOnlyBanner';
import ReportsDashboard from '../components/ReportsDashboard';
import DemandForecastPanel from '../components/DemandForecastPanel';
import {
  exportOrdersCSV,
  exportLeadsCSV,
  exportInventoryCSV,
  exportMonthlySummaryCSV,
  type MonthlySummaryRow,
} from '../utils/export';
import type { Order, Lead, InventoryItem, Employee, Quotation, InventoryMovement } from '../types';

type RecurringOrder = {
  id: string; templateName: string; customerName: string; totalPrice: number;
  frequency: 'weekly' | 'monthly' | 'quarterly'; nextDue: string; active: boolean;
};

type P570Targets = { revenue: number; orders: number; avgOrderVal: number; leadConv: number };

interface Props {
  canAccess: (tab: string) => boolean;
  hasFullAccess: (tab: string) => boolean;
  currentLanguage: 'tr' | 'en';
  currentT: Record<string, string>;
  orders: Order[];
  leads: Lead[];
  inventory: InventoryItem[];
  exchangeRates: Record<string, number> | null;
  userRole: string;
  employees: Employee[];
  appQuotations: Quotation[];
  inventoryMovements: InventoryMovement[];
  recurringOrders: RecurringOrder[];
  appReportsTab: 'genel' | 'crm' | 'envanter' | 'lojistik' | 'ik' | 'urunler';
  setAppReportsTab: (tab: 'genel' | 'crm' | 'envanter' | 'lojistik' | 'ik' | 'urunler') => void;
  onNavigate: (tab: string) => void;
  p570Targets: P570Targets;
  setP570Targets: React.Dispatch<React.SetStateAction<P570Targets>>;
  fmtKpi: (v: number, fmt?: 'full' | 'K', decimals?: number) => string;
}

export default function RaporlarPage({
  canAccess = () => true, hasFullAccess = () => false, currentLanguage, currentT,
  orders: ordersProp = [], leads = [], inventory = [], userRole, employees = [],
  appQuotations = [], inventoryMovements = [], recurringOrders = [], exchangeRates,
  appReportsTab, setAppReportsTab, onNavigate,
  p570Targets, setP570Targets, fmtKpi,
}: Props) {
  const [p603TrendMetric, setP603TrendMetric] = useState<'revenue' | 'orders' | 'leads' | 'inventory'>('revenue');
  const [p603TrendPeriod, setP603TrendPeriod] = useState<'3m' | '6m' | '12m'>('6m');
  const [p619MinCoverage, setP619MinCoverage] = useState(30);
  const [p620Horizon, setP620Horizon] = useState<'1m' | '3m' | '6m'>('3m');
  const [p631View, setP631View] = useState<'pipeline' | 'cycle-time' | 'bottleneck'>('pipeline');

  // ── Mikro satış faturaları → pseudo-sipariş ─────────────────────────────────
  // Cetpa orders BOŞ (satışlar Mikro'da fatura olarak) → tüm Raporlar sekmeleri
  // ₺0/0 gösteriyordu. Mikro GİDEN faturaları (satış) pseudo-sipariş olarak
  // eklenir; useReportsData'ya `orders` merged geçtiği için 6 sekme de canlanır.
  //
  // Yalnız GİDEN (satış — tie-out DOĞRULANMIŞ: 2026 satış 9,75M ≈ portal 9,36M).
  // ALIŞ/cinsi=6 CİRO OLARAK DOĞRULANMADI → bilerek dışarıda.
  // CARİ YIL filtresi: mikroFaturalar 2020+ tüm yılları tutar; hepsini toplamak
  // all-time ciro balonu yaratır (kullanıcı "132M hatalı" travması). Cari yıl
  // tied-out ve beklenen değer. (Not: Raporlar'ın timeRange seçicisi bu KPI'ları
  // zaten scope'lamıyor — mevcut hook davranışı; ayrı iş.)
  const [mikroSatisFaturalari, setMikroSatisFaturalari] = useState<Array<{ id: string; cariKod: string; tarih: string; tutar: number; faturaNo: string }>>([]);
  useEffect(() => {
    if (!userRole) return;
    const unsub = onSnapshot(collection(db, 'mikroFaturalar'), (snap: { docs: Array<{ id: string; data: () => Record<string, unknown> }> }) => {
      const cariYil = String(new Date().getFullYear());
      setMikroSatisFaturalari(
        snap.docs.map(d => {
          const x = d.data();
          const seri = String(x.cha_evrakno_seri ?? '').trim();
          const sira = x.cha_evrakno_sira;
          return {
            id: d.id,
            cariKod: String(x.cha_kod ?? '').trim(),
            tarih: String(x.cha_tarihi ?? '').slice(0, 10),
            tutar: Number(x.cha_meblag ?? 0) || 0,
            faturaNo: [seri, sira].filter(v => v !== '' && v != null).join('-'),
            _giden: Number(x.cha_tip ?? 0) === 0,   // 0=satış(giden), 1=alış(gelen)
            _iptal: x.cha_iptal === true || Number(x.cha_iptal ?? 0) === 1,
          };
        })
          .filter(f => f._giden && !f._iptal && f.tarih.startsWith(cariYil))
          .map(({ _giden, _iptal, ...f }) => { void _giden; void _iptal; return f; }),
      );
    }, () => setMikroSatisFaturalari([]));
    return () => unsub();
  }, [userRole]);

  // cariKod → müşteri adı (leads). Mikro faturasında yalnız cari KODU var.
  const cariAdMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of leads) {
      const kod = String((l as unknown as { mikroCariKod?: string }).mikroCariKod ?? '').trim();
      if (kod) m.set(kod, (l as unknown as { company?: string; name?: string }).company || (l as unknown as { name?: string }).name || kod);
    }
    return m;
  }, [leads]);

  // Cetpa siparişi + Mikro satış. Mükerrer eleme: Cetpa siparişi Mikro'ya
  // gönderilince evrak no `mikroEvrakNo`ya yazılır; o faturaları tekrar sayma.
  const orders = useMemo<Order[]>(() => {
    const cetpaEvrak = new Set(
      ordersProp.map(o => String((o as unknown as { mikroEvrakNo?: string }).mikroEvrakNo ?? '').trim()).filter(Boolean),
    );
    const mikroOrders = mikroSatisFaturalari
      .filter(f => !cetpaEvrak.has(f.faturaNo))
      .map(f => ({
        id: `mikro-${f.id}`,
        customerName: cariAdMap.get(f.cariKod) || f.cariKod || '—',
        status: 'Delivered',
        totalPrice: f.tutar,
        totalAmount: f.tutar,
        createdAt: f.tarih,
        syncedAt: f.tarih,
      })) as unknown as Order[];
    return [...ordersProp, ...mikroOrders];
  }, [ordersProp, mikroSatisFaturalari, cariAdMap]);

  if (!canAccess('reports')) {
    return <UnauthorizedView currentLanguage={currentLanguage} tab={currentLanguage === 'tr' ? 'Raporlar' : 'Reports'} />;
  }

  return (
    <>
      {!hasFullAccess('reports') && <ReadOnlyBanner currentLanguage={currentLanguage} />}

      {/* ── Export toolbar ── */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">{currentLanguage === 'tr' ? 'Dışa Aktar:' : 'Export:'}</span>
        <button onClick={() => exportOrdersCSV(orders, currentLanguage)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-gray-200 bg-white hover:bg-gray-50 text-gray-600 text-xs font-semibold transition-colors">
          <Download className="w-3.5 h-3.5" /> {currentLanguage === 'tr' ? 'Siparişler' : 'Orders'}
        </button>
        <button onClick={() => exportLeadsCSV(leads, currentLanguage)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-gray-200 bg-white hover:bg-gray-50 text-gray-600 text-xs font-semibold transition-colors">
          <Download className="w-3.5 h-3.5" /> {currentLanguage === 'tr' ? 'Müşteriler' : 'Leads'}
        </button>
        <button onClick={() => exportInventoryCSV(inventory, currentLanguage)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-gray-200 bg-white hover:bg-gray-50 text-gray-600 text-xs font-semibold transition-colors">
          <Download className="w-3.5 h-3.5" /> {currentLanguage === 'tr' ? 'Envanter' : 'Inventory'}
        </button>
        {/* Phase 63: Full Report PDF */}
        <button
          onClick={() => {
            import('jspdf').then(({ jsPDF }) => {
              import('jspdf-autotable').then(({ default: autoTable }) => {
                const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
                const tr63 = currentLanguage === 'tr';
                const today63 = new Date().toLocaleDateString(tr63 ? 'tr-TR' : 'en-US');
                // Cover
                pdf.setFillColor(26, 58, 92);
                pdf.rect(0, 0, 210, 40, 'F');
                pdf.setTextColor(255, 255, 255);
                pdf.setFontSize(18); pdf.setFont('helvetica', 'bold');
                pdf.text('CETPA', 14, 18);
                pdf.setFontSize(10); pdf.setFont('helvetica', 'normal');
                pdf.text(tr63 ? 'Yönetim Raporu' : 'Management Report', 14, 26);
                pdf.text(today63, 14, 34);
                pdf.setTextColor(0, 0, 0);
                // Section 1: Orders
                pdf.setFontSize(12); pdf.setFont('helvetica', 'bold');
                pdf.text(tr63 ? 'Sipariş Özeti' : 'Order Summary', 14, 52);
                const totalRev = orders.reduce((s, o) => s + (o.totalPrice || 0), 0);
                autoTable(pdf, {
                  startY: 56,
                  head: [[tr63 ? 'Durum' : 'Status', tr63 ? 'Adet' : 'Count', tr63 ? 'Oran' : 'Share']],
                  body: ['Pending', 'Processing', 'Shipped', 'Delivered', 'Cancelled'].map(s => [
                    s, orders.filter(o => o.status === s).length,
                    `${orders.length > 0 ? Math.round((orders.filter(o => o.status === s).length / orders.length) * 100) : 0}%`
                  ]),
                  styles: { fontSize: 9 },
                });
                // Section 2: Top Customers
                const finalY = (pdf as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
                pdf.setFontSize(12); pdf.setFont('helvetica', 'bold');
                pdf.text(tr63 ? 'En Yüksek Cirolu Müşteriler' : 'Top Customers by Revenue', 14, finalY);
                const custMap: Record<string, number> = {};
                for (const o of orders) { custMap[o.customerName] = (custMap[o.customerName] ?? 0) + (o.totalPrice || 0); }
                const top5 = Object.entries(custMap).sort(([, a], [, b]) => b - a).slice(0, 5);
                autoTable(pdf, {
                  startY: finalY + 4,
                  head: [[tr63 ? 'Müşteri' : 'Customer', tr63 ? 'Ciro' : 'Revenue', tr63 ? 'Pay' : 'Share']],
                  body: top5.map(([name, rev]) => [name, `₺${rev.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}`, `${totalRev > 0 ? Math.round((rev / totalRev) * 100) : 0}%`]),
                  styles: { fontSize: 9 },
                });
                // Section 3: Inventory highlights
                const finalY2 = (pdf as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
                pdf.setFontSize(12); pdf.setFont('helvetica', 'bold');
                pdf.text(tr63 ? 'Kritik Stok Uyarıları' : 'Critical Stock Alerts', 14, finalY2);
                const lowStock = inventory.filter(i => (i.stockLevel ?? 0) <= (i.lowStockThreshold ?? 5)).slice(0, 10);
                autoTable(pdf, {
                  startY: finalY2 + 4,
                  head: [['SKU', tr63 ? 'Ürün' : 'Product', tr63 ? 'Stok' : 'Stock', tr63 ? 'Min' : 'Min']],
                  body: lowStock.map(i => [i.sku, i.name, i.stockLevel ?? 0, i.lowStockThreshold ?? 5]),
                  styles: { fontSize: 9 },
                });
                pdf.save(`cetpa-rapor-${new Date().toISOString().split('T')[0]}.pdf`);
              });
            });
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-gray-300 bg-[#1a3a5c] hover:bg-[#243f60] text-white text-xs font-semibold transition-colors"
        >
          <FileText className="w-3.5 h-3.5" /> {currentLanguage === 'tr' ? 'PDF Rapor' : 'PDF Report'}
        </button>
        <button
          onClick={() => {
            const monthMap = new Map<string, MonthlySummaryRow>();
            for (const o of orders) {
              const raw = o.createdAt;
              const date = raw
                ? (typeof raw === 'string' ? new Date(raw) : (raw as { toDate?: () => Date }).toDate?.() ?? new Date())
                : new Date();
              const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
              const row = monthMap.get(month) ?? { month, orderCount: 0, revenue: 0, newLeads: 0, delivered: 0 };
              row.orderCount++;
              row.revenue += o.totalPrice;
              if (o.status === 'Delivered') row.delivered++;
              monthMap.set(month, row);
            }
            for (const l of leads) {
              const raw = l.createdAt;
              const date = raw
                ? (typeof raw === 'string' ? new Date(raw) : (raw as { toDate?: () => Date }).toDate?.() ?? new Date())
                : new Date();
              const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
              const row = monthMap.get(month) ?? { month, orderCount: 0, revenue: 0, newLeads: 0, delivered: 0 };
              row.newLeads++;
              monthMap.set(month, row);
            }
            exportMonthlySummaryCSV(
              [...monthMap.values()].sort((a, b) => a.month.localeCompare(b.month)),
              currentLanguage
            );
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-brand/30 bg-brand/5 hover:bg-brand/10 text-brand text-xs font-semibold transition-colors"
        >
          <Download className="w-3.5 h-3.5" /> {currentLanguage === 'tr' ? 'Aylık Özet' : 'Monthly Summary'}
        </button>
      </div>

      <ReportsDashboard
        orders={orders} inventory={inventory} exchangeRates={exchangeRates}
        currentT={currentT} currentLanguage={currentLanguage} userRole={userRole}
        onNavigate={onNavigate} employees={employees} quotations={appQuotations}
        inventoryMovements={inventoryMovements} recurringOrders={recurringOrders}
        externalTab={appReportsTab} setExternalTab={setAppReportsTab}
      />

      {/* ── Phase 570: KPI Hedef Takibi ─────────────────────────────────────── */}
      {appReportsTab === 'genel' && (() => {
        const tr570 = currentLanguage === 'tr';
        const now570 = new Date();
        const monthStart570 = new Date(now570.getFullYear(), now570.getMonth(), 1);
        const monthOrders570 = orders.filter(o => {
          const d = o.createdAt ? new Date(o.createdAt as string) : null;
          return d && d >= monthStart570;
        });
        const actRevenue570 = monthOrders570.reduce((s, o) => s + (o.totalPrice || 0), 0);
        const actOrders570 = monthOrders570.length;
        const actAvgOrder570 = actOrders570 > 0 ? actRevenue570 / actOrders570 : 0;
        const totalLeads570 = leads.length;
        const closedLeads570 = leads.filter(l => l.status === 'Closed Won' || l.status === 'Closed').length;
        const actLeadConv570 = totalLeads570 > 0 ? (closedLeads570 / totalLeads570) * 100 : 0;
        const kpis570 = [
          { label: tr570 ? 'Aylık Ciro' : 'Monthly Revenue', actual: actRevenue570, target: p570Targets.revenue, fmt: (v: number) => fmtKpi(v, 'K', 1) + (tr570 ? ' ₺' : ' ₺'), key: 'revenue' as const, color: 'blue' },
          { label: tr570 ? 'Sipariş Adedi' : 'Order Count', actual: actOrders570, target: p570Targets.orders, fmt: (v: number) => String(v), key: 'orders' as const, color: 'green' },
          { label: tr570 ? 'Ort. Sipariş Değeri' : 'Avg Order Value', actual: actAvgOrder570, target: p570Targets.avgOrderVal, fmt: (v: number) => fmtKpi(v, 'full', 0) + ' ₺', key: 'avgOrderVal' as const, color: 'purple' },
          { label: tr570 ? 'Lead Dönüşüm %' : 'Lead Conv. %', actual: actLeadConv570, target: p570Targets.leadConv, fmt: (v: number) => v.toFixed(1) + '%', key: 'leadConv' as const, color: 'orange' },
        ];
        const colorMap570: Record<string, string> = { blue: 'bg-blue-500', green: 'bg-green-500', purple: 'bg-purple-500', orange: 'bg-orange-500' };
        const colorText570: Record<string, string> = { blue: 'text-blue-600', green: 'text-green-600', purple: 'text-purple-600', orange: 'text-orange-600' };
        return (
          <div className="apple-card p-5">
            <h3 className="text-base font-bold text-gray-900 mb-4">{tr570 ? '🎯 KPI Hedef Takibi (Bu Ay)' : '🎯 KPI Target Tracking (This Month)'}</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
              {kpis570.map(kpi => {
                const pct = kpi.target > 0 ? Math.min(100, (kpi.actual / kpi.target) * 100) : 0;
                const isGood = pct >= 80;
                return (
                  <div key={kpi.key} className="bg-gray-50 rounded-xl p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{kpi.label}</p>
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${isGood ? 'bg-green-100 text-green-700' : pct >= 50 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>{pct.toFixed(0)}%</span>
                    </div>
                    <div>
                      <p className={`text-xl font-bold ${colorText570[kpi.color]}`}>{kpi.fmt(kpi.actual)}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{tr570 ? 'Hedef:' : 'Target:'} {kpi.fmt(kpi.target)}</p>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-1.5">
                      <div className={`h-1.5 rounded-full transition-all ${colorMap570[kpi.color]}`} style={{ width: `${pct}%` }} />
                    </div>
                    <input type="number" value={p570Targets[kpi.key]} onChange={e => setP570Targets(prev => ({ ...prev, [kpi.key]: Number(e.target.value) }))}
                      className="w-full text-xs apple-input py-1 px-2" placeholder={tr570 ? 'Hedef girin...' : 'Set target...'} />
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 603: İş Zekası Trend Analizi ─────────────────────── */}
      {appReportsTab === 'genel' && (() => {
        const tr603 = currentLanguage === 'tr';
        const monthsBack = p603TrendPeriod === '3m' ? 3 : p603TrendPeriod === '6m' ? 6 : 12;
        const now603 = new Date();
        const months603 = Array.from({ length: monthsBack }, (_, i) => {
          const d = new Date(now603.getFullYear(), now603.getMonth() - monthsBack + 1 + i, 1);
          return { date: d, label: d.toLocaleString(currentLanguage === 'tr' ? 'tr-TR' : 'en-US', { month: 'short', year: '2-digit' }) };
        });
        const getMonthValue = (m: typeof months603[number]) => {
          const start = m.date;
          const end = new Date(start.getFullYear(), start.getMonth() + 1, 0, 23, 59, 59);
          if (p603TrendMetric === 'revenue') {
            return orders.filter(o => {
              if (o.status === 'Cancelled' || !o.createdAt) return false;
              try { const d = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string); return d >= start && d <= end; } catch { return false; }
            }).reduce((s, o) => s + (o.totalPrice || 0), 0);
          }
          if (p603TrendMetric === 'orders') {
            return orders.filter(o => {
              if (!o.createdAt) return false;
              try { const d = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string); return d >= start && d <= end; } catch { return false; }
            }).length;
          }
          if (p603TrendMetric === 'leads') {
            return leads.filter(l => {
              if (!l.createdAt) return false;
              try { const d = (l.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(l.createdAt as string); return d >= start && d <= end; } catch { return false; }
            }).length;
          }
          return 0;
        };
        const data603 = months603.map(m => ({ ...m, value: getMonthValue(m) }));
        const maxVal = Math.max(...data603.map(d => d.value), 1);
        const totalVal = data603.reduce((s, d) => s + d.value, 0);
        const avgVal = totalVal / data603.length;
        const lastVal = data603[data603.length - 1]?.value || 0;
        const prevVal = data603[data603.length - 2]?.value || 0;
        const trend = prevVal > 0 ? ((lastVal - prevVal) / prevVal) * 100 : 0;
        const fmt603 = (v: number) => p603TrendMetric === 'revenue' ? `₺${v.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}` : String(v);
        return (
          <div className="apple-card p-5">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
              <h3 className="font-bold text-gray-900 text-sm">{tr603 ? '📈 İş Zekası Trend Analizi' : '📈 Business Intelligence Trends'}</h3>
              <div className="flex gap-2 flex-wrap">
                <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
                  {([['revenue', tr603 ? 'Gelir' : 'Revenue'], ['orders', tr603 ? 'Sipariş' : 'Orders'], ['leads', 'Leads']] as const).map(([id, lbl]) => (
                    <button key={id} onClick={() => setP603TrendMetric(id)} className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${p603TrendMetric === id ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>{lbl}</button>
                  ))}
                </div>
                <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
                  {(['3m', '6m', '12m'] as const).map(p => (
                    <button key={p} onClick={() => setP603TrendPeriod(p)} className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${p603TrendPeriod === p ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>{p}</button>
                  ))}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3 mb-4">
              {[
                { label: tr603 ? 'Dönem Toplamı' : 'Period Total', val: fmt603(totalVal), color: 'text-gray-800' },
                { label: tr603 ? 'Aylık Ortalama' : 'Monthly Avg', val: fmt603(Math.round(avgVal)), color: 'text-blue-600' },
                { label: tr603 ? 'Aylık Değişim' : 'MoM Change', val: `${trend >= 0 ? '+' : ''}${trend.toFixed(1)}%`, color: trend >= 0 ? 'text-emerald-600' : 'text-red-500' },
              ].map(k => (
                <div key={k.label} className="bg-gray-50 rounded-xl p-3">
                  <p className="text-[10px] text-gray-400 uppercase font-semibold">{k.label}</p>
                  <p className={`text-base font-bold mt-0.5 ${k.color}`}>{k.val}</p>
                </div>
              ))}
            </div>
            {/* Sparkline bars */}
            <div className="flex items-end gap-1 h-20">
              {data603.map((m, i) => {
                const h = maxVal > 0 ? (m.value / maxVal) * 100 : 0;
                const isLast = i === data603.length - 1;
                return (
                  <div key={m.label} className="flex-1 flex flex-col items-center gap-1" title={`${m.label}: ${fmt603(m.value)}`}>
                    <div className="w-full rounded-t-md transition-all" style={{ height: `${Math.max(h, 2)}%`, background: isLast ? '#ff4000' : '#e5e7eb' }} />
                    <span className="text-[9px] text-gray-400 rotate-0">{m.label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* ── AI Demand Forecast ── */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6">
        <DemandForecastPanel currentLanguage={currentLanguage} />
      </div>

      {/* ── Phase 620: Satış Tahmini (Forecast) ────────────────────── */}
      {appReportsTab === 'genel' && orders.length >= 2 && (() => {
        const tr620 = currentLanguage === 'tr';
        const horizonMonths = p620Horizon === '1m' ? 1 : p620Horizon === '3m' ? 3 : 6;
        const now620 = new Date();
        const histMonths = 6;
        const history = Array.from({ length: histMonths }, (_, i) => {
          const d = new Date(now620.getFullYear(), now620.getMonth() - histMonths + i + 1, 1);
          const label = d.toLocaleString('tr-TR', { month: 'short', year: '2-digit' });
          const rev = orders.filter(o => {
            if (o.status === 'Cancelled' || !o.createdAt) return false;
            try {
              const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
              return od.getFullYear() === d.getFullYear() && od.getMonth() === d.getMonth();
            } catch { return false; }
          }).reduce((s, o) => s + (o.totalPrice || 0), 0);
          return { label, rev };
        });
        const avgRev = history.reduce((s, m) => s + m.rev, 0) / histMonths;
        const n = history.length;
        const sumX = n * (n - 1) / 2, sumXX = n * (n - 1) * (2 * n - 1) / 6;
        const sumY = history.reduce((s, m, i) => s + m.rev * i, 0);
        const slope = (n * sumY - sumX * history.reduce((s, m) => s + m.rev, 0)) / (n * sumXX - sumX * sumX) || 0;
        const forecast = Array.from({ length: horizonMonths }, (_, i) => {
          const d = new Date(now620.getFullYear(), now620.getMonth() + i + 1, 1);
          const label = d.toLocaleString('tr-TR', { month: 'short', year: '2-digit' });
          const val = Math.max(0, avgRev + slope * (histMonths + i));
          return { label, val };
        });
        const fmtF = (v: number) => v >= 1000000 ? `₺${(v / 1000000).toFixed(1)}M` : v >= 1000 ? `₺${(v / 1000).toFixed(0)}K` : `₺${Math.round(v).toLocaleString('tr-TR')}`;
        return (
          <div className="apple-card p-5 space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h3 className="font-bold text-gray-900 text-sm">🔮 {tr620 ? 'Satış Tahmini' : 'Sales Forecast'}</h3>
              <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
                {([{ k: '1m', l: '1M' }, { k: '3m', l: '3M' }, { k: '6m', l: '6M' }] as { k: '1m' | '3m' | '6m'; l: string }[]).map(t => (
                  <button key={t.k} onClick={() => setP620Horizon(t.k)} className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${p620Horizon === t.k ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>{t.l}</button>
                ))}
              </div>
            </div>
            <div className="flex items-end gap-1 h-24">
              {[...history, ...forecast.map(f => ({ label: f.label, rev: f.val, forecast: true }))].map((m, i) => {
                const isF = 'forecast' in m && (m as { forecast?: boolean }).forecast;
                const allVals = [...history.map(h => h.rev), ...forecast.map(f => f.val)];
                const maxV = Math.max(...allVals, 1);
                const h = ((isF ? (m as { val?: number }).val || 0 : m.rev) / maxV * 100);
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-0.5" title={isF ? fmtF((m as { val?: number }).val || 0) : fmtF(m.rev)}>
                    <div className="w-full rounded-t-md" style={{ height: `${Math.max(h, 2)}%`, background: isF ? 'rgba(255,64,0,0.3)' : '#e5e7eb' }} />
                    <span className="text-[8px] text-gray-400">{m.label}</span>
                  </div>
                );
              })}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {forecast.map(f => (
                <div key={f.label} className="bg-orange-50 border border-orange-100 rounded-xl p-3">
                  <p className="text-[10px] font-bold text-orange-400 uppercase">{f.label} {tr620 ? '(Tahmin)' : '(Forecast)'}</p>
                  <p className="text-lg font-black text-orange-700">{fmtF(f.val)}</p>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-gray-400">* {tr620 ? 'Doğrusal trend ekstrapolasyonu. Gerçek sonuçlar farklılık gösterebilir.' : 'Linear trend extrapolation. Actual results may vary.'}</p>
          </div>
        );
      })()}

      {/* ── Phase 631: İş Süreci Analizi (Bottleneck) ──────────────── */}
      {appReportsTab === 'genel' && orders.length > 0 && (() => {
        const tr631 = currentLanguage === 'tr';
        const stageMap: { [s: string]: number } = { Pending: 0, Processing: 0, Shipped: 0, Delivered: 0, Cancelled: 0 };
        orders.forEach(o => { if (stageMap[o.status] !== undefined) stageMap[o.status]++; });
        const pipeline631 = [
          { stage: 'Pending',    label: tr631 ? 'Bekliyor'  : 'Pending',    color: 'bg-amber-400',  count: stageMap['Pending']    },
          { stage: 'Processing', label: tr631 ? 'İşlemde'  : 'Processing', color: 'bg-blue-500',   count: stageMap['Processing'] },
          { stage: 'Shipped',    label: tr631 ? 'Yolda'     : 'Shipped',    color: 'bg-indigo-500', count: stageMap['Shipped']    },
          { stage: 'Delivered',  label: tr631 ? 'Teslim'    : 'Delivered',  color: 'bg-green-500',  count: stageMap['Delivered']  },
        ].filter(s => s.count > 0 || s.stage === 'Processing');
        const total631 = pipeline631.reduce((s, p) => s + p.count, 0) || 1;
        const bottleneck631 = [...pipeline631].sort((a, b) => b.count - a.count)[0];
        const cycleOrders = orders.filter(o => o.status === 'Delivered' && o.createdAt && o.estimatedDelivery);
        const avgCycle = cycleOrders.length > 0 ? cycleOrders.reduce((s, o) => {
          try {
            const created = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
            const delivered = (o.estimatedDelivery as { toDate?: () => Date }).toDate?.() ?? new Date(o.estimatedDelivery as string);
            return s + (delivered.getTime() - created.getTime()) / (86400000);
          } catch { return s; }
        }, 0) / cycleOrders.length : null;
        return (
          <div className="apple-card p-5 space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h3 className="font-bold text-gray-900 text-sm">🔄 {tr631 ? 'İş Süreci Analizi' : 'Process Bottleneck Analysis'}</h3>
              <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
                {(['pipeline', 'cycle-time', 'bottleneck'] as const).map(v => (
                  <button key={v} onClick={() => setP631View(v)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${p631View === v ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
                    {v === 'pipeline' ? (tr631 ? 'Boru Hattı' : 'Pipeline') : v === 'cycle-time' ? (tr631 ? 'Döngü Süresi' : 'Cycle Time') : (tr631 ? 'Darboğaz' : 'Bottleneck')}
                  </button>
                ))}
              </div>
            </div>
            {p631View === 'pipeline' && (
              <div className="space-y-3">
                {pipeline631.map(p => (
                  <div key={p.stage} className="space-y-1">
                    <div className="flex justify-between text-xs text-gray-600">
                      <span className="font-medium">{p.label}</span>
                      <span className="font-bold">{p.count} {tr631 ? 'sipariş' : 'orders'} ({Math.round(p.count / total631 * 100)}%)</span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-3 overflow-hidden">
                      <div className={`h-3 rounded-full ${p.color} transition-all`} style={{ width: `${Math.max(2, p.count / total631 * 100)}%` }} />
                    </div>
                  </div>
                ))}
                <p className="text-[11px] text-gray-400 pt-1">{tr631 ? 'Toplam aktif sipariş:' : 'Total active orders:'} <span className="font-semibold text-gray-600">{orders.filter(o => o.status !== 'Cancelled').length}</span></p>
              </div>
            )}
            {p631View === 'cycle-time' && (
              <div className="space-y-3">
                {avgCycle !== null ? (
                  <div className="text-center py-4 space-y-2">
                    <p className="text-4xl font-bold text-[#ff4000]">{avgCycle.toFixed(1)}<span className="text-base font-normal text-gray-500 ml-1">{tr631 ? 'gün' : 'days'}</span></p>
                    <p className="text-sm text-gray-500">{tr631 ? 'Ortalama sipariş teslim süresi' : 'Avg. order fulfillment cycle'}</p>
                    <p className="text-xs text-gray-400">{cycleOrders.length} {tr631 ? 'teslim edilen siparişten' : 'delivered orders analyzed'}</p>
                  </div>
                ) : (
                  <div className="text-center py-6">
                    <p className="text-sm text-gray-400">{tr631 ? 'Henüz yeterli teslim verisi yok' : 'Not enough delivery data yet'}</p>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: tr631 ? 'Bekleyen' : 'Pending',    val: stageMap['Pending'],    col: 'text-amber-600'  },
                    { label: tr631 ? 'İşlemde'  : 'Processing', val: stageMap['Processing'], col: 'text-blue-600'   },
                    { label: tr631 ? 'Yolda'    : 'Shipped',    val: stageMap['Shipped'],    col: 'text-indigo-600' },
                    { label: tr631 ? 'Teslim'   : 'Delivered',  val: stageMap['Delivered'],  col: 'text-green-600'  },
                  ].map(s => (
                    <div key={s.label} className="apple-card bg-gray-50 p-3 text-center">
                      <p className={`text-xl font-bold ${s.col}`}>{s.val}</p>
                      <p className="text-[11px] text-gray-500">{s.label}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {p631View === 'bottleneck' && (
              <div className="space-y-3">
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
                  <span className="text-2xl">⚠️</span>
                  <div>
                    <p className="font-bold text-amber-800 text-sm">{tr631 ? 'Tespit Edilen Darboğaz:' : 'Detected Bottleneck:'} {bottleneck631?.label}</p>
                    <p className="text-xs text-amber-700 mt-1">{bottleneck631?.count} {tr631 ? 'sipariş bu aşamada bekliyor, toplam siparişlerin' : 'orders stuck here —'} {Math.round((bottleneck631?.count || 0) / total631 * 100)}% {tr631 ? 'u.' : 'of total.'}</p>
                  </div>
                </div>
                <div className="space-y-2">
                  {pipeline631.map(p => (
                    <div key={p.stage} className={`flex items-center justify-between px-4 py-2.5 rounded-xl border text-sm ${p.stage === bottleneck631?.stage ? 'bg-amber-50 border-amber-300' : 'bg-gray-50 border-gray-200'}`}>
                      <span className="font-medium text-gray-700">{p.label}</span>
                      <span className={`font-bold ${p.stage === bottleneck631?.stage ? 'text-amber-700' : 'text-gray-600'}`}>{p.count} {tr631 ? 'sipariş' : 'orders'}</span>
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-gray-400">{tr631 ? 'Öneri: En yüksek birikimli aşamada kapasite veya süreç iyileştirmesi yapın.' : 'Tip: Improve capacity or process at the highest-backlog stage.'}</p>
              </div>
            )}
          </div>
        );
      })()}

      {/* ── Phase 619: Akıllı Sipariş Önerisi ─────────────────────── */}
      {appReportsTab === 'genel' && inventory.length > 0 && (() => {
        const tr619 = currentLanguage === 'tr';
        const cutoff619 = new Date(Date.now() - p619MinCoverage * 86400000);
        const recentSales619 = orders.filter(o => {
          if (o.status === 'Cancelled' || !o.createdAt) return false;
          try { const d = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string); return d >= cutoff619; } catch { return false; }
        });
        const skuSold: { [sku: string]: number } = {};
        recentSales619.forEach(o => { (o.lineItems || []).forEach(li => { skuSold[li.sku] = (skuSold[li.sku] || 0) + li.quantity; }); });
        const suggestions = inventory
          .map(item => {
            const sold = skuSold[item.sku] || 0;
            const avgDailyDemand = sold / p619MinCoverage;
            const daysLeft = avgDailyDemand > 0 ? Math.floor((item.stockLevel || 0) / avgDailyDemand) : null;
            const suggestQty = Math.ceil(avgDailyDemand * p619MinCoverage * 2);
            return { ...item, avgDailyDemand, daysLeft, suggestQty, sold };
          })
          .filter(i => i.daysLeft !== null && i.daysLeft < p619MinCoverage && i.sold > 0)
          .sort((a, b) => (a.daysLeft ?? 999) - (b.daysLeft ?? 999))
          .slice(0, 8);
        if (suggestions.length === 0) return null;
        return (
          <div className="apple-card p-5 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h3 className="font-bold text-gray-900 text-sm">🛒 {tr619 ? 'Akıllı Sipariş Önerisi' : 'Smart Order Suggestion'}</h3>
              <div className="flex items-center gap-2 text-xs text-gray-500">
                {tr619 ? 'Kapsama Günü:' : 'Coverage Days:'}
                <input type="number" value={p619MinCoverage} onChange={e => setP619MinCoverage(Number(e.target.value))} className="apple-input px-2 py-0.5 text-xs w-14 text-center" />
              </div>
            </div>
            <div className="space-y-2">
              {suggestions.map(item => (
                <div key={item.id} className={`flex items-center gap-3 border rounded-xl px-4 py-2.5 ${(item.daysLeft ?? 0) <= 7 ? 'border-red-200 bg-red-50/20' : 'border-amber-200 bg-amber-50/20'}`}>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-gray-800 truncate">{item.name} <span className="text-gray-400 font-normal">({item.sku})</span></p>
                    <p className="text-[10px] text-gray-400">{tr619 ? 'Günlük satış:' : 'Daily sales:'} {item.avgDailyDemand.toFixed(1)} · {item.daysLeft}g {tr619 ? 'kaldı' : 'left'}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs font-bold text-[#ff4000]">{item.suggestQty} {tr619 ? 'adet sipariş önerisi' : 'units suggested'}</p>
                    <p className="text-[10px] text-gray-400">{tr619 ? 'Mevcut:' : 'Stock:'} {item.stockLevel}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}
    </>
  );
}
