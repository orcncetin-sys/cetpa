/**
 * ReportsDashboard.tsx — Analytics & raporlama ekranı
 *
 * App.tsx'ten çıkarıldı. Saf görüntüleme bileşeni — Firestore yazma işlemi yok.
 * Tüm veriler props olarak App.tsx'teki onSnapshot aboneliklerinden gelir.
 */

import React, { useState, useEffect } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, PieChart as RePieChart, Pie, Cell, AreaChart, Area,
} from 'recharts';
import {
  LayoutDashboard, List, Truck, UserCheck, Package, Users, BarChart3,
  AlertCircle, Calendar, Download, CheckCircle2, ChevronRight,
  CreditCard,
} from 'lucide-react';
import { format } from 'date-fns';
import { tr, enUS } from 'date-fns/locale';
import { cn } from '../lib/utils';
import { motion } from 'motion/react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  collection, onSnapshot, query, where,
} from '../lib/dbClient';
import { db, auth } from '../firebase';
import { logFirestoreError as importedLogFirestoreError, OperationType } from '../utils/firebase';
import { sortByCreatedAt } from '../utils/fsSort';
import { formatInCurrency } from '../utils/currency';
import ModuleHeader from './ModuleHeader';
import {
  type Order,
  type Employee,
  type Quotation,
  type InventoryItem,
  type InventoryMovement,
} from '../types';

// ── Module-level helpers ───────────────────────────────────────────────────────

function itemCostTRY(item: InventoryItem, rates: Record<string, number> | null | undefined): number {
  const raw = item.costPrice ?? (item as unknown as { cost?: number }).cost ?? 0;
  const cur = (item as unknown as { costCurrency?: string }).costCurrency;
  if (!cur || cur === 'TRY' || !rates) return raw;
  return raw * (rates[cur] ?? 1);
}

function itemPriceTRY(item: InventoryItem, tier: string, rates: Record<string, number> | null | undefined): number {
  const raw = (item.prices?.[tier] as number | undefined) ?? (item as unknown as { price?: number }).price ?? 0;
  const cur = (item as unknown as { priceCurrency?: string }).priceCurrency;
  if (!cur || cur === 'TRY' || !rates) return raw;
  return raw * (rates[cur] ?? 1);
}

// ── Component ─────────────────────────────────────────────────────────────────

const ReportsDashboard = ({ orders, inventory, exchangeRates, currentT, currentLanguage, userRole, onNavigate, employees, quotations = [], inventoryMovements = [], recurringOrders = [], externalTab, setExternalTab }: { orders: Order[], inventory: InventoryItem[], exchangeRates: Record<string, number> | null, currentT: Record<string, string>, currentLanguage: string, userRole?: string | null, onNavigate?: (tab: string) => void, employees: Employee[], quotations?: Quotation[], inventoryMovements?: InventoryMovement[], recurringOrders?: Array<{ id: string; templateName: string; customerName: string; totalPrice: number; frequency: 'weekly' | 'monthly' | 'quarterly'; nextDue: string; active: boolean }>, externalTab?: 'genel'|'crm'|'envanter'|'lojistik'|'ik'|'urunler', setExternalTab?: (t: 'genel'|'crm'|'envanter'|'lojistik'|'ik'|'urunler') => void }) => {
  const [timeRange, setTimeRange] = useState('30');
  const [revenueCurrency, setRevenueCurrency] = useState<'TRY' | 'USD' | 'EUR'>('TRY');
  const [_localReportsTab, _setLocalReportsTab] = useState<'genel'|'crm'|'envanter'|'lojistik'|'ik'|'urunler'>('genel');
  const reportsTab = externalTab ?? _localReportsTab;
  const setReportsTab = (t: 'genel'|'crm'|'envanter'|'lojistik'|'ik'|'urunler') => { _setLocalReportsTab(t); setExternalTab?.(t); };
  const [invSummarySort, setInvSummarySort] = useState<{key: string; dir: 'asc'|'desc'}>({key: 'name', dir: 'asc'});
  const [logisticsSummarySort, setLogisticsSummarySort] = useState<{key: string; dir: 'asc'|'desc'}>({key: 'customerName', dir: 'asc'});
  // fmtAna uses revenueCurrency (same as the per-card toggle — no separate global state needed)
  const fmtAna = (v: number, fmt: 'full' | 'K' = 'full', decimals = 0): string => {
    const usd = exchangeRates?.USD ?? 38; // FX fallback (App.tsx FX_FALLBACK ile hizalı)
    const eur = exchangeRates?.EUR ?? 41;
    const rate = revenueCurrency === 'USD' ? usd : revenueCurrency === 'EUR' ? eur : 1;
    const sym = revenueCurrency === 'USD' ? '$' : revenueCurrency === 'EUR' ? '€' : '₺';
    const locale = revenueCurrency === 'USD' ? 'en-US' : revenueCurrency === 'EUR' ? 'de-DE' : 'tr-TR';
    const cv = v / rate;
    if (fmt === 'K') return `${sym}${(cv/1000).toFixed(decimals)}K`;
    return `${sym}${cv.toLocaleString(locale, {maximumFractionDigits: decimals})}`;
  };

  // HR Data for Reports
  const [hrStats, setHrStats] = useState({
    activeEmployees: 0,
    totalPayroll: 0,
    pendingLeave: 0,
    departmentDistribution: [] as { name: string, value: number }[],
    payrollTrend: [] as { name: string, value: number }[]
  });

  useEffect(() => {
    if (!employees) return;
    const active = employees.filter(e => e.status === 'Aktif').length;
    const depts = employees.reduce((acc: Record<string, number>, e) => {
      acc[e.department] = (acc[e.department] || 0) + 1;
      return acc;
    }, {});
     
    setHrStats(prev => ({
      ...prev,
      activeEmployees: active,
      departmentDistribution: Object.entries(depts).map(([name, value]) => ({ name, value: Number(value) }))
    }));
  }, [employees]);

  useEffect(() => {
    if (reportsTab !== 'ik' || !userRole) return;

    const unsubLeave = onSnapshot(query(collection(db, 'leaveRequests'), where('status', '==', 'Bekliyor')), (snap) => {
      setHrStats(prev => ({ ...prev, pendingLeave: snap.size }));
    }, (error) => importedLogFirestoreError(error, OperationType.LIST, 'leaveRequests', auth.currentUser?.uid));

    const unsubPayroll = onSnapshot(collection(db, 'payrolls'), (snap) => {
      const pays = sortByCreatedAt(snap.docs.map(d => d.data()));
      const total = pays.filter(p => p.status === 'Ödendi').reduce((sum, p) => sum + (p.netSalary || 0), 0);
      
      const trend = pays.reduce((acc: Record<string, number>, p) => {
        const key = `${p.month}/${p.year}`;
        acc[key] = (acc[key] || 0) + (p.netSalary || 0);
        return acc;
      }, {});

      setHrStats(prev => ({
        ...prev,
        totalPayroll: total,
        payrollTrend: Object.entries(trend).map(([name, value]) => ({ name, value: Number(value) }))
      }));
    }, (error) => importedLogFirestoreError(error, OperationType.LIST, 'payrolls', auth.currentUser?.uid));

    return () => {
      unsubLeave();
      unsubPayroll();
    };
  }, [reportsTab, userRole]);

  // KPI Calculations
  const totalRevenueTRY = orders
    .filter(o => o.status !== 'Cancelled')
    .reduce((sum, o) => sum + (Number(o.totalPrice) || 0), 0);
  const revenueSymbol = revenueCurrency === 'USD' ? '$' : revenueCurrency === 'EUR' ? '€' : '₺';
  const revenueFormatted = formatInCurrency(totalRevenueTRY, revenueCurrency, exchangeRates);
  const totalOrders = orders.length;
  const avgOrderValueTRY = totalOrders > 0 ? totalRevenueTRY / totalOrders : 0;
  const avgOrderFormatted = formatInCurrency(avgOrderValueTRY, revenueCurrency, exchangeRates);
  const lowStockItems = inventory.filter(i => i.stockLevel <= i.lowStockThreshold).length;

  // Sales Trend Data
  const salesByDate = orders.reduce((acc: Record<string, number>, o) => {
    let date = currentT.unknown;
    if (o.syncedAt) {
      try {
        const d = typeof (o.syncedAt as { toDate?: () => Date }).toDate === 'function' ? (o.syncedAt as { toDate: () => Date }).toDate() : new Date(o.syncedAt as unknown as string | number | Date);
        date = format(d, 'dd MMM', { locale: currentLanguage === 'tr' ? tr : enUS });
      } catch (e) {
        console.error("Error formatting date:", e);
      }
    }
    acc[date] = (acc[date] || 0) + (Number(o.totalPrice) || 0);
    return acc;
  }, {});

  const trendData = Object.entries(salesByDate)
    .map(([name, value]) => ({ name, value: Number(value) }))
    .sort((a, b) => {
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
      const getMonthIndex = (dateStr: string) => { const parts = dateStr.split(' '); if (parts.length < 2) return -1; return months.indexOf(parts[1]); };
      const getDay = (dateStr: string) => parseInt(dateStr.split(' ')[0]);
      const monthA = getMonthIndex(a.name); const monthB = getMonthIndex(b.name);
      if (monthA !== monthB) return monthA - monthB;
      return getDay(a.name) - getDay(b.name);
    })
    .slice(-30);

  // Category Data
  const categoryData = inventory.reduce((acc: Record<string, number>, item) => {
    const category = item.category || currentT.other;
    acc[category] = (acc[category] || 0) + item.stockLevel;
    return acc;
  }, {});
  const categoryChartData = Object.entries(categoryData).map(([name, value]) => ({ name, value: Number(value) }));

  // --- CRM sub-data ---
  const ordersByStatus = orders.reduce((acc: Record<string, number>, o) => { acc[o.status] = (acc[o.status]||0)+1; return acc; }, {});
  const statusChartData = Object.entries(ordersByStatus).map(([name, value]) => ({ name, value: Number(value) }));
  const topCustomers = Object.values(
    orders.reduce((acc: Record<string, { name: string; total: number; count: number }>, o) => {
      const k = o.customerName || '—';
      if (!acc[k]) acc[k] = { name: k, total: 0, count: 0 };
      acc[k].total += Number(o.totalPrice) || 0;
      acc[k].count += 1;
      return acc;
    }, {})
  ).sort((a, b) => b.total - a.total).slice(0, 8);

  // --- Inventory sub-data ---
  const totalInventoryValueTRY = inventory.reduce((s, i) => s + (i.stockLevel * ((i.prices?.['Retail']) || 0)), 0);
  const categoryValueData = inventory.reduce((acc: Record<string, { name: string; count: number; value: number }>, item) => {
    const cat = item.category || 'Diğer';
    if (!acc[cat]) acc[cat] = { name: cat, count: 0, value: 0 };
    acc[cat].count += item.stockLevel;
    acc[cat].value += item.stockLevel * ((item.prices?.['Retail']) || 0);
    return acc;
  }, {});
  const categoryValueChartData = Object.values(categoryValueData);

  const COLORS = ['#ff4000', '#007AFF', '#34C759', '#FF9500', '#AF52DE', '#00C7BE', '#FF2D55'];

  const exportPDF = () => {
    const doc = new jsPDF();
    doc.text(currentT.report_title, 14, 15);
    autoTable(doc, {
      head: [[currentT.customer, currentT.amount, currentT.status, currentT.date]],
      body: orders.map(o => [
        o.customerName,
        `${Number(o.totalPrice).toLocaleString()} TL`,
        currentT[o.status.toLowerCase()] || o.status,
        o.syncedAt ? format(typeof (o.syncedAt as { toDate?: () => Date }).toDate === 'function' ? (o.syncedAt as { toDate: () => Date }).toDate() : new Date(o.syncedAt as unknown as string | number | Date), 'dd.MM.yyyy') : ''
      ]),
      startY: 25,
    });
    doc.save(`cetpa-rapor-${format(new Date(), 'dd-MM-yyyy')}.pdf`);
  };

  const subTabs = [
    { id: 'genel', label: currentLanguage==='tr'?'Genel Bakış':'Overview', icon: LayoutDashboard },
    { id: 'crm', label: currentLanguage==='tr'?'CRM & Satış':'CRM & Sales', icon: Users },
    { id: 'envanter', label: currentLanguage==='tr'?'Envanter':'Inventory', icon: List },
    { id: 'lojistik', label: currentLanguage==='tr'?'Lojistik':'Logistics', icon: Truck },
    { id: 'ik', label: currentLanguage==='tr'?'İnsan Kaynakları':'Human Resources', icon: UserCheck },
    { id: 'urunler', label: currentLanguage==='tr'?'Ürün Performansı':'Product Performance', icon: Package }, // Phase 545
  ] as const;

  return (
    <div className="space-y-6">
      <ModuleHeader
        title={currentT.reports}
        subtitle={currentT.reports_dashboard_desc}
        icon={BarChart3}
        actionButton={
          <div className="flex gap-3">
            <button onClick={exportPDF} className="apple-button-secondary flex items-center gap-2">
              <Download className="w-4 h-4" /> {currentT.export_pdf}
            </button>
            <select value={timeRange} onChange={(e) => setTimeRange(e.target.value)} className="apple-input text-sm font-semibold">
              <option value="7">{currentT.last_7_days}</option>
              <option value="30">{currentT.last_30_days}</option>
              <option value="90">{currentT.last_90_days}</option>
            </select>
          </div>
        }
      />

      {/* Sub-tab Navigation */}
      <div className="overflow-x-auto scrollbar-none">
        <div className="flex gap-1 p-1 bg-white/80 border border-gray-100 rounded-2xl shadow-sm w-max">
          {subTabs.map(tab => {
            const Icon = tab.icon;
            return (
              <button key={tab.id} onClick={() => setReportsTab(tab.id)}
                className={`shrink-0 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all whitespace-nowrap ${reportsTab === tab.id ? 'bg-brand text-white shadow-sm' : 'text-[#86868B] hover:text-[#1D1D1F] hover:bg-gray-100'}`}>
                <Icon size={13} />{tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── GENEL BAKIŞ ── */}
      {reportsTab === 'genel' && (
        <div className="space-y-6">
          {/* KPI Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0 }}
              onClick={() => onNavigate?.('crm')}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onNavigate?.('crm'); }}
              className="apple-card p-6 text-left w-full hover:shadow-md hover:scale-[1.01] transition-all duration-200 cursor-pointer group">
              <div className="flex items-center justify-between mb-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-brand/10">
                  <span className="text-xl font-black text-brand leading-none">{revenueSymbol}</span>
                </div>
                <div className="flex gap-0.5 bg-gray-100 rounded-lg p-0.5" onClick={e => e.stopPropagation()}>
                  {(['TRY', 'USD', 'EUR'] as const).map(c => (
                    <button key={c} onClick={() => setRevenueCurrency(c)} className={cn('px-1.5 py-0.5 rounded-md text-[9px] font-bold transition-colors', revenueCurrency === c ? 'bg-white text-brand shadow-sm' : 'text-gray-400 hover:text-gray-600')}>
                      {c === 'TRY' ? '₺' : c === 'USD' ? '$' : '€'}
                    </button>
                  ))}
                </div>
              </div>
              <p className="text-xs font-bold text-[#86868B] uppercase tracking-wider">{currentT.kpi_revenue}</p>
              <p className="text-2xl font-bold mt-1">{revenueFormatted}</p>
              <p className="text-[10px] text-brand mt-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <ChevronRight className="w-3 h-3" />{currentLanguage === 'tr' ? 'Detaya git' : 'View details'}
              </p>
            </motion.div>
            {[
              { label: currentT.kpi_orders, value: String(totalOrders), icon: Package as React.ElementType | null, symbol: null as string | null, color: 'text-blue-500', bg: 'bg-blue-50', tab: 'crm' },
              { label: currentT.kpi_avg_order, value: avgOrderFormatted, icon: null, symbol: revenueSymbol, color: 'text-green-500', bg: 'bg-green-50', tab: 'crm' },
              { label: currentT.kpi_low_stock, value: String(lowStockItems), icon: AlertCircle as React.ElementType | null, symbol: null, color: 'text-orange-500', bg: 'bg-orange-50', tab: 'inventory' },
            ].map((kpi, i) => (
              <motion.div key={i} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: (i + 1) * 0.1 }}
                onClick={() => onNavigate?.(kpi.tab)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onNavigate?.(kpi.tab); }}
                className="apple-card p-6 text-left w-full hover:shadow-md hover:scale-[1.01] transition-all duration-200 cursor-pointer group">
                <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center mb-4", kpi.bg)}>
                  {kpi.symbol ? <span className={cn('text-xl font-black leading-none', kpi.color)}>{kpi.symbol}</span> : kpi.icon && <kpi.icon className={cn("w-6 h-6", kpi.color)} />}
                </div>
                <p className="text-xs font-bold text-[#86868B] uppercase tracking-wider">{kpi.label}</p>
                <p className="text-2xl font-bold mt-1">{kpi.value}</p>
                <p className="text-[10px] text-brand mt-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <ChevronRight className="w-3 h-3" />{currentLanguage === 'tr' ? 'Detaya git' : 'View details'}
                </p>
              </motion.div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="apple-card p-8">
              <h3 className="text-lg font-bold mb-6">{currentT.sales_trend}</h3>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={trendData}>
                    <defs>
                      <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#ff4000" stopOpacity={0.1} />
                        <stop offset="95%" stopColor="#ff4000" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F5F5F7" />
                    <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#86868B' }} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#86868B' }} />
                    <Tooltip contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 25px rgba(0,0,0,0.1)' }} />
                    <Area type="monotone" dataKey="value" stroke="#ff4000" strokeWidth={3} fillOpacity={1} fill="url(#colorValue)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="apple-card p-8">
              <h3 className="text-lg font-bold mb-6">{currentT.category_dist}</h3>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <RePieChart>
                    <Pie data={categoryChartData} cx="50%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={5} dataKey="value">
                      {categoryChartData.map((_, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}
                    </Pie>
                    <Tooltip />
                    <Legend verticalAlign="bottom" height={36} />
                  </RePieChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* ── Phase 181: Monthly Recurring Revenue (MRR) ── */}
      {reportsTab === 'genel' && recurringOrders.filter(r => r.active).length > 0 && (() => {
        const activeRO = recurringOrders.filter(r => r.active);
        const mrr = activeRO.reduce((s, r) => {
          const monthly = r.frequency === 'weekly' ? r.totalPrice * 4 : r.frequency === 'quarterly' ? r.totalPrice / 3 : r.totalPrice;
          return s + monthly;
        }, 0);
        const arr = mrr * 12;
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '🔁 Aylık Tekrarlayan Gelir (MRR)' : '🔁 Monthly Recurring Revenue (MRR)'}</h3>
              <span className="text-xs text-emerald-700 font-bold bg-emerald-50 px-2 py-0.5 rounded-full">{activeRO.length} {currentLanguage==='tr'?'aktif şablon':'active templates'}</span>
            </div>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div className="bg-emerald-50 rounded-2xl p-4">
                <p className="text-[10px] text-emerald-700 font-bold uppercase tracking-wide">MRR</p>
                <p className="text-3xl font-black text-emerald-700 mt-1">{fmtAna(mrr,'K',1)}</p>
                <p className="text-[10px] text-emerald-600 mt-0.5">{currentLanguage==='tr'?'Aylık tekrarlayan':'Monthly recurring'}</p>
              </div>
              <div className="bg-blue-50 rounded-2xl p-4">
                <p className="text-[10px] text-blue-700 font-bold uppercase tracking-wide">ARR</p>
                <p className="text-3xl font-black text-blue-700 mt-1">{fmtAna(arr,'K',0)}</p>
                <p className="text-[10px] text-blue-600 mt-0.5">{currentLanguage==='tr'?'Yıllık projeksiyon':'Annual projection'}</p>
              </div>
            </div>
            <div className="space-y-1.5">
              {activeRO.slice(0, 4).map(r => {
                const monthly = r.frequency === 'weekly' ? r.totalPrice * 4 : r.frequency === 'quarterly' ? r.totalPrice / 3 : r.totalPrice;
                return (
                  <div key={r.id} className="flex items-center justify-between text-xs py-1 border-b border-gray-50 last:border-0">
                    <span className="text-gray-700 truncate">{r.templateName} · {r.customerName}</span>
                    <span className="font-bold text-emerald-600 shrink-0 ml-2">{fmtAna(Math.round(monthly))}/m</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 189: Order Value Distribution ── */}
      {reportsTab === 'genel' && orders.length >= 5 && (() => {
        const buckets189 = [
          { label: '<₺1K', min: 0, max: 1000, count: 0, total: 0 },
          { label: '₺1-5K', min: 1000, max: 5000, count: 0, total: 0 },
          { label: '₺5-20K', min: 5000, max: 20000, count: 0, total: 0 },
          { label: '₺20-100K', min: 20000, max: 100000, count: 0, total: 0 },
          { label: '₺100K+', min: 100000, max: Infinity, count: 0, total: 0 },
        ];
        for (const o of orders) {
          if (o.status === 'Cancelled') continue;
          const v = o.totalPrice || 0;
          const b = buckets189.find(b => v >= b.min && v < b.max);
          if (b) { b.count++; b.total += v; }
        }
        const maxCount = Math.max(...buckets189.map(b => b.count), 1);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-4">{currentLanguage === 'tr' ? '📊 Sipariş Değeri Dağılımı' : '📊 Order Value Distribution'}</h3>
            <div className="flex items-end gap-3 h-28 mb-3">
              {buckets189.map((b, i) => {
                const h = Math.round((b.count / maxCount) * 100);
                const colors = ['bg-blue-300', 'bg-blue-400', 'bg-brand/70', 'bg-brand', 'bg-purple-500'];
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1 group">
                    <div className="w-full flex flex-col justify-end" style={{ height: '80px' }}>
                      <div className={`w-full rounded-t-lg ${colors[i]}`} style={{ height: `${Math.max(h, 3)}%` }}
                        title={`${b.count} ${currentLanguage==='tr'?'sipariş':'orders'} · ₺${b.total.toLocaleString()}`} />
                    </div>
                    <span className="text-[8px] text-gray-400 text-center leading-tight">{b.label}</span>
                    <span className="text-[9px] font-bold text-gray-600">{b.count}</span>
                  </div>
                );
              })}
            </div>
            <p className="text-[10px] text-gray-400">{currentLanguage==='tr'?'Sayı, sipariş başına sipariş değerine göre':'Order count by order value range'}</p>
          </div>
        );
      })()}

      {/* ── Phase 185: Cash Conversion Cycle (CCC) ── */}
      {reportsTab === 'genel' && orders.length >= 5 && inventory.length > 0 && (() => {
        const now185 = new Date();
        const days90 = 90;
        const cutoff185 = new Date(now185); cutoff185.setDate(cutoff185.getDate() - days90);
        // DSO: avg days from order creation to paid status
        const paidOrders = orders.filter(o => o.status === 'Delivered' || (o as unknown as Record<string,unknown>).paidAt);
        void paidOrders;
        const unPaidOrders = orders.filter(o => o.status !== 'Cancelled' && o.status !== 'Delivered');
        const arBalance = unPaidOrders.reduce((s, o) => s + (o.totalPrice || 0), 0);
        const monthly90Rev = orders.filter(o => {
          try {
            const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
            return od >= cutoff185 && o.status !== 'Cancelled';
          } catch { return false; }
        }).reduce((s, o) => s + (o.totalPrice || 0), 0);
        const dailyRev185 = monthly90Rev / days90;
        const dso = dailyRev185 > 0 ? Math.round(arBalance / dailyRev185) : 0;
        // DIO: avg inventory value / daily COGS
        const inventoryVal185 = inventory.reduce((s, i) => s + itemCostTRY(i, exchangeRates) * (i.stockLevel ?? 0), 0);
        const dailyCOGS185 = monthly90Rev * 0.6 / days90; // assume 60% COGS ratio
        const dio = dailyCOGS185 > 0 ? Math.round(inventoryVal185 / dailyCOGS185) : 0;
        const ccc = dso + dio;
        const cccColor = ccc <= 30 ? 'text-emerald-600' : ccc <= 60 ? 'text-amber-500' : 'text-red-500';
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '⏱️ Nakit Dönüşüm Döngüsü (CCC)' : '⏱️ Cash Conversion Cycle (CCC)'}</h3>
              <span className={`text-lg font-black ${cccColor}`}>{ccc} {currentLanguage === 'tr' ? 'gün' : 'days'}</span>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-4">
              {[
                { label: 'DSO', desc: currentLanguage === 'tr' ? 'Alacak Tahsilat Süresi' : 'Days Sales Outstanding', value: dso, color: dso > 45 ? 'text-red-500' : dso > 30 ? 'text-amber-500' : 'text-emerald-600', sub: currentLanguage === 'tr' ? `₺${(arBalance/1000).toFixed(0)}K ödenmemiş` : `₺${(arBalance/1000).toFixed(0)}K outstanding` },
                { label: 'DIO', desc: currentLanguage === 'tr' ? 'Stok Elde Tutma Süresi' : 'Days Inventory Outstanding', value: dio, color: dio > 60 ? 'text-red-500' : dio > 30 ? 'text-amber-500' : 'text-emerald-600', sub: currentLanguage === 'tr' ? `₺${(inventoryVal185/1000).toFixed(0)}K stok` : `₺${(inventoryVal185/1000).toFixed(0)}K inventory` },
              ].map(k => (
                <div key={k.label} className="bg-gray-50 rounded-xl p-4">
                  <p className={`text-3xl font-black ${k.color}`}>{k.value}<span className="text-sm font-medium text-gray-400 ml-1">{currentLanguage === 'tr' ? 'gün' : 'd'}</span></p>
                  <p className="text-[11px] text-gray-700 font-semibold mt-1">{k.label} · {k.desc}</p>
                  <p className="text-[10px] text-gray-400">{k.sub}</p>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-1.5 bg-blue-50 rounded-xl p-3">
              <span className="text-blue-500 text-sm">💡</span>
              <p className="text-[11px] text-blue-700">{currentLanguage === 'tr' ? `CCC = DSO + DIO. Hedef: 30 günün altı. Şu an: ${ccc} gün${ccc > 60 ? ' — nakit sıkışıklığı riski var.' : ccc > 30 ? ' — iyileştirme fırsatı var.' : ' — sağlıklı.'}` : `CCC = DSO + DIO. Target: under 30 days. Current: ${ccc} days${ccc > 60 ? ' — cash flow risk.' : ccc > 30 ? ' — room for improvement.' : ' — healthy.'}`}</p>
            </div>
          </div>
        );
      })()}

      {/* ── Phase 186: Sales by Hour of Day ── */}
      {reportsTab === 'genel' && orders.length >= 10 && (() => {
        const hourBuckets186 = Array.from({ length: 8 }, (_, i) => ({ label: `${i*3}:00-${i*3+2}:59`, start: i*3, count: 0, rev: 0 }));
        let hasHours = false;
        for (const o of orders) {
          if (o.status === 'Cancelled') continue;
          try {
            const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
            const h = od.getHours();
            if (isNaN(h)) continue;
            hasHours = true;
            const bucket = hourBuckets186.find(b => h >= b.start && h < b.start + 3);
            if (bucket) { bucket.count++; bucket.rev += o.totalPrice || 0; }
          } catch { /* skip */ }
        }
        if (!hasHours) return null;
        const maxCount186 = Math.max(...hourBuckets186.map(b => b.count), 1);
        const peakBucket = hourBuckets186.reduce((best, b) => b.count > best.count ? b : best, hourBuckets186[0]);
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '🕐 Saate Göre Satış Dağılımı' : '🕐 Sales by Hour of Day'}</h3>
              <span className="text-xs font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full">{currentLanguage === 'tr' ? `Zirve: ${peakBucket.label}` : `Peak: ${peakBucket.label}`}</span>
            </div>
            <div className="flex items-end gap-1.5 h-24">
              {hourBuckets186.map(b => (
                <div key={b.label} className="flex-1 flex flex-col items-center gap-1">
                  <div className="w-full flex items-end justify-center" style={{ height: '72px' }}>
                    <div
                      className={`w-full rounded-t-md ${b.count === peakBucket.count ? 'bg-brand' : 'bg-blue-200'}`}
                      style={{ height: `${Math.max(4, Math.round((b.count / maxCount186) * 72))}px` }}
                    />
                  </div>
                  <span className="text-[9px] text-gray-400 leading-none text-center">{b.start}h</span>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between mt-2">
              <span className="text-[10px] text-gray-400">0:00</span>
              <span className="text-[10px] text-gray-400">12:00</span>
              <span className="text-[10px] text-gray-400">21:00</span>
            </div>
            <p className="text-[10px] text-gray-400 mt-2">{currentLanguage === 'tr' ? 'Her çubuk 3 saatlik dilimi temsil eder' : 'Each bar represents a 3-hour window'}</p>
          </div>
        );
      })()}

      {/* ── Phase 147: Revenue by Day of Week ── */}
          {orders.length >= 5 && (() => {
            const dayNames = currentLanguage === 'tr'
              ? ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt']
              : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
            const dayCounts = Array(7).fill(null).map((_, d) => ({ day: dayNames[d], revenue: 0, orders: 0 }));
            for (const o of orders) {
              if (o.status === 'Cancelled') continue;
              try {
                const d = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
                dayCounts[d.getDay()].revenue += o.totalPrice || 0;
                dayCounts[d.getDay()].orders++;
              } catch { /* skip */ }
            }
            const maxRev147 = Math.max(...dayCounts.map(d => d.revenue), 1);
            const bestDay = dayCounts.reduce((best, d) => d.revenue > best.revenue ? d : best, dayCounts[0]);
            return (
              <div className="apple-card p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '📅 Güne Göre Satış Dağılımı' : '📅 Revenue by Day of Week'}</h3>
                  <span className="text-xs text-gray-500">{currentLanguage === 'tr' ? 'En iyi gün:' : 'Best day:'} <span className="font-bold text-brand">{bestDay.day}</span></span>
                </div>
                <div className="flex items-end gap-2 h-32">
                  {dayCounts.map((d, i) => {
                    const h = Math.round((d.revenue / maxRev147) * 100);
                    return (
                      <div key={i} className="flex-1 flex flex-col items-center gap-1 cursor-default">
                        <div className="w-full flex flex-col justify-end" style={{ height: '96px' }}>
                          <div
                            className={`w-full rounded-t-lg transition-all duration-500 ${d.revenue === maxRev147 ? 'bg-brand' : 'bg-brand/30 hover:bg-brand/60'}`}
                            style={{ height: `${Math.max(h, 2)}%` }}
                            title={`₺${d.revenue.toLocaleString()} · ${d.orders} ${currentLanguage==='tr'?'sipariş':'orders'}`}
                          />
                        </div>
                        <span className={`text-[10px] font-semibold ${d.revenue === maxRev147 ? 'text-brand' : 'text-gray-400'}`}>{d.day}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {/* ── Phase 148: Days-to-Stockout Forecast ── */}
          {inventory.length > 0 && (() => {
            const now148 = new Date();
            const cutoff148 = new Date(now148); cutoff148.setDate(cutoff148.getDate() - 30);
            const atRisk = inventory
              .filter(i => i.stockLevel > 0 && i.stockLevel <= (i.lowStockThreshold ?? 5) * 3)
              .map(i => {
                const sold30 = orders
                  .filter(o => {
                    try {
                      const d = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
                      return d >= cutoff148 && o.status !== 'Cancelled';
                    } catch { return false; }
                  })
                  .reduce((s, o) => {
                    const li = (o.lineItems || []).find(l => l.inventoryId === i.id || l.name === i.name);
                    return s + (li?.quantity || 0);
                  }, 0);
                const dailyUsage = sold30 / 30;
                const daysLeft = dailyUsage > 0 ? Math.round(i.stockLevel / dailyUsage) : null;
                return { ...i, dailyUsage, daysLeft };
              })
              .filter(i => i.daysLeft !== null && i.daysLeft <= 45)
              .sort((a, b) => (a.daysLeft ?? 999) - (b.daysLeft ?? 999))
              .slice(0, 8);
            if (atRisk.length === 0) return null;
            return (
              <div className="apple-card p-6">
                <h3 className="font-bold text-gray-800 mb-2">{currentLanguage === 'tr' ? '⏱️ Stok Tükenme Tahmini' : '⏱️ Days-to-Stockout Forecast'}</h3>
                <p className="text-xs text-gray-400 mb-4">{currentLanguage === 'tr' ? 'Son 30 gün satış hızına göre tahmin' : 'Based on last 30-day sales velocity'}</p>
                <div className="space-y-3">
                  {atRisk.map(item => {
                    const d = item.daysLeft!;
                    const cls = d <= 7 ? 'bg-red-500' : d <= 20 ? 'bg-amber-400' : 'bg-emerald-400';
                    const textCls = d <= 7 ? 'text-red-600' : d <= 20 ? 'text-amber-600' : 'text-emerald-600';
                    return (
                      <div key={item.id} className="flex items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs font-semibold text-gray-800 truncate">{item.name}</span>
                            <span className={`text-xs font-bold ${textCls} shrink-0 ml-2`}>{d} {currentLanguage==='tr'?'gün':'days'}</span>
                          </div>
                          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div className={`h-full rounded-full ${cls}`} style={{ width: `${Math.min((d / 45) * 100, 100)}%` }} />
                          </div>
                          <p className="text-[10px] text-gray-400 mt-0.5">{currentLanguage==='tr'?'Stok':'Stock'}: {item.stockLevel} · {currentLanguage==='tr'?'Günlük':'Daily'}: {item.dailyUsage.toFixed(1)}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* ── CRM & SATIŞ ── */}
      {reportsTab === 'crm' && (
        <div className="space-y-6">
          {/* KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: currentLanguage==='tr'?'Toplam Sipariş':'Total Orders', value: String(totalOrders), color: 'text-brand', bg: 'bg-brand/10' },
              { label: currentLanguage==='tr'?'Teslim Edilen':'Delivered', value: String(orders.filter(o=>o.status==='Delivered').length), color: 'text-green-600', bg: 'bg-green-50' },
              { label: currentLanguage==='tr'?'Bekleyen':'Pending', value: String(orders.filter(o=>o.status==='Pending').length), color: 'text-yellow-600', bg: 'bg-yellow-50' },
              { label: currentLanguage==='tr'?'İptal':'Cancelled', value: String(orders.filter(o=>o.status==='Cancelled').length), color: 'text-red-500', bg: 'bg-red-50' },
            ].map((k,i) => (
              <motion.div key={i} initial={{opacity:0,y:10}} animate={{opacity:1,y:0}} transition={{delay:i*0.05}}
                className={`apple-card p-5 ${k.bg}`}>
                <p className="text-xs font-bold text-[#86868B] uppercase tracking-wider mb-1">{k.label}</p>
                <p className={`text-3xl font-bold ${k.color}`}>{k.value}</p>
              </motion.div>
            ))}
          </div>

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
                  <div key={i} className="flex items-center gap-3 py-2 border-b border-gray-50 last:border-0">
                    <div className="w-6 h-6 rounded-full bg-brand/10 flex items-center justify-center text-[10px] font-bold text-brand flex-shrink-0">{i+1}</div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-800 truncate">{c.name}</p>
                      <p className="text-xs text-gray-400">{c.count} {currentLanguage==='tr'?'sipariş':'orders'}</p>
                    </div>
                    <span className="text-sm font-bold text-brand">{formatInCurrency(c.total, revenueCurrency, exchangeRates)}</span>
                  </div>
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
                      <span className="text-sm font-bold text-brand">{formatInCurrency(r.revenue, revenueCurrency, exchangeRates)}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* ── ENVANTERi ── */}
      {reportsTab === 'envanter' && (
        <div className="space-y-6">
          {/* KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {([
              { label: currentLanguage==='tr'?'Toplam Ürün':'Total Products', value: String(inventory.length), color: 'text-blue-600', bg: 'bg-blue-50', isMoney: false },
              { label: currentLanguage==='tr'?'Düşük Stok':'Low Stock', value: String(lowStockItems), color: 'text-orange-500', bg: 'bg-orange-50', isMoney: false },
              { label: currentLanguage==='tr'?'Toplam Stok Değeri':'Total Stock Value', value: formatInCurrency(totalInventoryValueTRY, revenueCurrency, exchangeRates), color: 'text-green-600', bg: 'bg-green-50', isMoney: true },
              { label: currentLanguage==='tr'?'Kategori Sayısı':'Categories', value: String(Object.keys(categoryData).length), color: 'text-purple-600', bg: 'bg-purple-50', isMoney: false },
            ] as { label: string; value: string; color: string; bg: string; isMoney: boolean }[]).map((k,i) => (
              <motion.div key={i} initial={{opacity:0,y:10}} animate={{opacity:1,y:0}} transition={{delay:i*0.05}}
                className={`apple-card p-5 ${k.bg}`}>
                <div className="flex items-start justify-between mb-1">
                  <p className="text-xs font-bold text-[#86868B] uppercase tracking-wider">{k.label}</p>
                  {k.isMoney && (
                    <div className="flex gap-0.5 bg-white/70 rounded-md p-0.5" onClick={e => e.stopPropagation()}>
                      {(['TRY','USD','EUR'] as const).map(c => (
                        <button key={c} onClick={() => setRevenueCurrency(c)}
                          className={`px-1 py-0.5 rounded text-[9px] font-bold transition-colors ${revenueCurrency===c ? 'bg-white shadow-sm text-green-700' : 'text-gray-400 hover:text-gray-600'}`}>
                          {c==='TRY'?'₺':c==='USD'?'$':'€'}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <p className={`text-2xl font-bold ${k.color}`}>{k.value}</p>
              </motion.div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Kategori Stok */}
            <div className="apple-card p-6">
              <h3 className="font-bold text-gray-800 mb-4">{currentLanguage==='tr'?'Kategori Bazlı Stok':'Stock by Category'}</h3>
              <div className="h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={categoryValueChartData} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#F5F5F7" />
                    <XAxis type="number" axisLine={false} tickLine={false} tick={{fontSize:10,fill:'#86868B'}} />
                    <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} tick={{fontSize:10,fill:'#86868B'}} width={80} />
                    <Tooltip contentStyle={{borderRadius:'12px',border:'none',boxShadow:'0 10px 25px rgba(0,0,0,0.1)'}} />
                    <Bar dataKey="count" fill="#007AFF" radius={[0,6,6,0]} name={currentLanguage==='tr'?'Adet':'Units'} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Düşük Stok Listesi */}
            <div className="apple-card p-6">
              <h3 className="font-bold text-gray-800 mb-4">{currentLanguage==='tr'?'Kritik Stok Ürünleri':'Critical Stock Items'}</h3>
              <div className="space-y-2 max-h-[280px] overflow-y-auto">
                {inventory.filter(i => i.stockLevel <= i.lowStockThreshold).length === 0 ? (
                  <div className="flex items-center justify-center gap-2 py-8 text-green-600">
                    <CheckCircle2 className="w-5 h-5" />
                    <span className="text-sm font-medium">{currentLanguage==='tr'?'Tüm ürünler yeterli stokta':'All products in stock'}</span>
                  </div>
                ) : inventory.filter(i => i.stockLevel <= i.lowStockThreshold).sort((a,b) => a.stockLevel-b.stockLevel).map((item, i) => (
                  <div key={i} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-800 truncate">{item.name}</p>
                      <p className="text-xs text-gray-400">{item.sku}</p>
                    </div>
                    <div className="text-right ml-3">
                      <p className="text-sm font-bold text-red-500">{item.stockLevel} {currentLanguage==='tr'?'adet':'units'}</p>
                      <p className="text-[10px] text-gray-400">Min: {item.lowStockThreshold}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Tüm Envanter Tablosu */}
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-4">{currentLanguage==='tr'?'Envanter Özeti':'Inventory Summary'}</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    {[
                      {k:'name', label:currentLanguage==='tr'?'Ürün':'Product', align:'text-left', cls:''},
                      {k:'category', label:currentLanguage==='tr'?'Kategori':'Category', align:'text-left', cls:'hidden sm:table-cell'},
                      {k:'stockLevel', label:currentLanguage==='tr'?'Stok':'Stock', align:'text-right', cls:''},
                      {k:'value', label:currentLanguage==='tr'?'Değer':'Value', align:'text-right', cls:'hidden md:table-cell'},
                    ].map(({k,label,align,cls}) => {
                      const active = invSummarySort.key === k;
                      return (
                        <th key={k} onClick={() => setInvSummarySort(s=>({key:k,dir:s.key===k&&s.dir==='asc'?'desc':'asc'}))} className={`${align} py-2 px-3 font-medium text-xs cursor-pointer select-none transition-colors ${cls} ${active?'text-brand':'text-gray-500 hover:text-gray-700'}`}>
                          {label} <span className={active?'opacity-100':'opacity-25'}>{active?(invSummarySort.dir==='asc'?'↑':'↓'):'↕'}</span>
                        </th>
                      );
                    })}
                    <th className="text-center py-2 px-3 text-gray-500 font-medium text-xs">{currentLanguage==='tr'?'Durum':'Status'}</th>
                  </tr>
                </thead>
                <tbody>
                  {[...inventory].sort((a,b) => {
                    const av = invSummarySort.key === 'value'
                      ? (a.stockLevel * (a.prices?.['Retail'] || 0))
                      : (a as Record<string,unknown>)[invSummarySort.key] as string|number ?? '';
                    const bv = invSummarySort.key === 'value'
                      ? (b.stockLevel * (b.prices?.['Retail'] || 0))
                      : (b as Record<string,unknown>)[invSummarySort.key] as string|number ?? '';
                    if (av < bv) return invSummarySort.dir === 'asc' ? -1 : 1;
                    if (av > bv) return invSummarySort.dir === 'asc' ? 1 : -1;
                    return 0;
                  }).slice(0,10).map((item, i) => (
                    <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="py-2.5 px-3">
                        <p className="font-medium text-gray-800">{item.name}</p>
                        <p className="text-xs text-gray-400">{item.sku}</p>
                      </td>
                      <td className="py-2.5 px-3 text-gray-500 text-xs hidden sm:table-cell">{item.category||'—'}</td>
                      <td className="py-2.5 px-3 text-right font-semibold text-gray-800">{item.stockLevel}</td>
                      <td className="py-2.5 px-3 text-right text-gray-500 text-xs hidden md:table-cell">{fmtAna(item.stockLevel*(item.prices?.['Retail']||0))}</td>
                      <td className="py-2.5 px-3 text-center">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${item.stockLevel <= item.lowStockThreshold ? 'bg-red-100 text-red-600' : item.stockLevel <= item.lowStockThreshold*2 ? 'bg-yellow-100 text-yellow-600' : 'bg-green-100 text-green-600'}`}>
                          {item.stockLevel <= item.lowStockThreshold ? (currentLanguage==='tr'?'Kritik':'Critical') : item.stockLevel <= item.lowStockThreshold*2 ? (currentLanguage==='tr'?'Düşük':'Low') : (currentLanguage==='tr'?'Normal':'Normal')}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {inventory.length > 10 && <p className="text-xs text-center text-gray-400 mt-3 py-2">{currentLanguage==='tr'?`+${inventory.length-10} ürün daha — Envanter sekmesine gidin`:`+${inventory.length-10} more items — Go to Inventory tab`}</p>}
            </div>

          {/* ── Phase 135: Product Profitability ── */}
          {orders.length > 0 && inventory.length > 0 && (() => {
            type ProdProfit = { name: string; sku: string; revenue: number; cogs: number; margin: number; units: number };
            const prodMap: Record<string, ProdProfit> = {};
            for (const o of orders) {
              if (o.status === 'Cancelled') continue;
              for (const li of (o.lineItems || [])) {
                const key = li.inventoryId || li.name;
                if (!prodMap[key]) {
                  const inv = inventory.find(i => i.id === li.inventoryId || i.name === li.name);
                  prodMap[key] = { name: li.name, sku: li.sku || inv?.sku || '—', revenue: 0, cogs: 0, margin: 0, units: 0 };
                }
                prodMap[key].revenue += li.price * li.quantity;
                prodMap[key].cogs += ((li.costPrice ?? 0) || 0) * li.quantity;
                prodMap[key].units += li.quantity;
              }
            }
            const prods = Object.values(prodMap)
              .map(p => ({ ...p, margin: p.revenue > 0 ? Math.round(((p.revenue - p.cogs) / p.revenue) * 100) : 0 }))
              .sort((a, b) => b.revenue - a.revenue)
              .slice(0, 10);
            if (prods.length === 0) return null;
            return (
              <div className="apple-card p-6 mt-4">
                <h3 className="font-bold text-gray-800 mb-4">{currentLanguage === 'tr' ? '💰 Ürün Kârlılık Analizi' : '💰 Product Profitability'}</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                        <th className="text-left py-2 px-3">{currentLanguage === 'tr' ? 'Ürün' : 'Product'}</th>
                        <th className="text-right py-2 px-3">{currentLanguage === 'tr' ? 'Adet' : 'Units'}</th>
                        <th className="text-right py-2 px-3 hidden sm:table-cell">{currentLanguage === 'tr' ? 'Ciro' : 'Revenue'}</th>
                        <th className="text-right py-2 px-3 hidden md:table-cell">{currentLanguage === 'tr' ? 'Maliyet' : 'COGS'}</th>
                        <th className="text-right py-2 px-3">{currentLanguage === 'tr' ? 'Marj' : 'Margin'}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {prods.map(p => (
                        <tr key={p.name} className="hover:bg-gray-50/50 transition-all">
                          <td className="py-3 px-3">
                            <p className="text-xs font-bold text-gray-800 truncate max-w-[180px]">{p.name}</p>
                            <p className="text-[9px] text-gray-400">{p.sku}</p>
                          </td>
                          <td className="py-3 px-3 text-right text-xs font-semibold text-gray-600">{p.units}</td>
                          <td className="py-3 px-3 text-right text-xs font-bold text-gray-800 hidden sm:table-cell">{fmtAna(p.revenue)}</td>
                          <td className="py-3 px-3 text-right text-xs text-gray-500 hidden md:table-cell">{fmtAna(p.cogs)}</td>
                          <td className="py-3 px-3 text-right">
                            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${p.margin >= 30 ? 'bg-emerald-100 text-emerald-700' : p.margin >= 15 ? 'bg-amber-100 text-amber-700' : p.cogs > 0 ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-400'}`}>
                              {p.cogs > 0 ? `%${p.margin}` : '—'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })()}

          {/* ── Phase 137: Inventory Valuation by Category ── */}
          {inventory.length > 0 && (() => {
            type CatVal = { category: string; items: number; stockValue: number; costValue: number; margin: number };
            const catMap: Record<string, CatVal> = {};
            for (const item of inventory) {
              const cat = item.category || (currentLanguage === 'tr' ? 'Kategorisiz' : 'Uncategorized');
              if (!catMap[cat]) catMap[cat] = { category: cat, items: 0, stockValue: 0, costValue: 0, margin: 0 };
              const retail = item.prices?.['Retail'] ?? item.price ?? 0;
              const cost = itemCostTRY(item, exchangeRates);
              const qty = item.stockLevel ?? 0;
              catMap[cat].items++;
              catMap[cat].stockValue += retail * qty;
              catMap[cat].costValue += cost * qty;
            }
            const cats = Object.values(catMap).map(c => ({
              ...c, margin: c.stockValue > 0 ? Math.round(((c.stockValue - c.costValue) / c.stockValue) * 100) : 0
            })).sort((a, b) => b.stockValue - a.stockValue);
            const maxVal = Math.max(...cats.map(c => c.stockValue), 1);
            const totalStockVal = cats.reduce((s, c) => s + c.stockValue, 0);
            return (
              <div className="apple-card p-6">
                <h3 className="font-bold text-gray-800 mb-4">{currentLanguage === 'tr' ? '📦 Kategori Bazında Stok Değeri' : '📦 Inventory Valuation by Category'}</h3>
                <div className="space-y-3">
                  {cats.map(c => (
                    <div key={c.category}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <p className="text-xs font-bold text-gray-800">{c.category}</p>
                          <span className="text-[9px] text-gray-400">{c.items} {currentLanguage === 'tr' ? 'ürün' : 'items'}</span>
                        </div>
                        <div className="flex items-center gap-3 text-xs">
                          <span className="text-gray-500">{fmtAna(c.stockValue,'K',1)}</span>
                          {c.costValue > 0 && <span className={`font-bold ${c.margin >= 30 ? 'text-emerald-600' : c.margin >= 15 ? 'text-amber-600' : 'text-red-500'}`}>%{c.margin}</span>}
                        </div>
                      </div>
                      <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
                        <div className="h-2 bg-brand/60 rounded-full transition-all duration-700" style={{ width: `${(c.stockValue / maxVal) * 100}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-4 pt-3 border-t border-gray-100 flex justify-between text-xs font-bold text-gray-600">
                  <span>{cats.length} {currentLanguage === 'tr' ? 'kategori' : 'categories'}</span>
                  <span>{currentLanguage === 'tr' ? 'Toplam Stok Değeri' : 'Total Stock Value'}: {fmtAna(totalStockVal,'K',1)}</span>
                </div>
              </div>
            );
          })()}

          {/* ── Phase 144: Expiry Date Tracker ── */}
          {(() => {
            const today144 = new Date();
            const in30 = new Date(today144); in30.setDate(in30.getDate() + 30);
            const in90 = new Date(today144); in90.setDate(in90.getDate() + 90);
            const expItems = inventory
              .filter(i => i.expiryDate)
              .map(i => {
                const expDate = new Date(i.expiryDate as string);
                const daysLeft = Math.round((expDate.getTime() - today144.getTime()) / 86400000);
                return { ...i, expDate, daysLeft };
              })
              .sort((a, b) => a.daysLeft - b.daysLeft);
            if (expItems.length === 0) return null;
            const expired = expItems.filter(i => i.daysLeft < 0);
            const critical = expItems.filter(i => i.daysLeft >= 0 && i.daysLeft <= 30);
            const warning = expItems.filter(i => i.daysLeft > 30 && i.daysLeft <= 90);
            return (
              <div className="apple-card p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '📅 Son Kullanma Tarihi Takibi' : '📅 Expiry Date Tracker'}</h3>
                  <div className="flex items-center gap-2 text-xs">
                    {expired.length > 0 && <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-semibold">{expired.length} {currentLanguage==='tr'?'süresi geçmiş':'expired'}</span>}
                    {critical.length > 0 && <span className="px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 font-semibold">{critical.length} {currentLanguage==='tr'?'kritik':'critical'}</span>}
                    {warning.length > 0 && <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-semibold">{warning.length} {currentLanguage==='tr'?'uyarı':'warning'}</span>}
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100">
                        <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500">{currentLanguage==='tr'?'Ürün':'Product'}</th>
                        <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500">SKU</th>
                        <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500">{currentLanguage==='tr'?'Stok':'Stock'}</th>
                        <th className="text-center py-2 px-3 text-xs font-semibold text-gray-500">{currentLanguage==='tr'?'Son Kullanma':'Expiry'}</th>
                        <th className="text-center py-2 px-3 text-xs font-semibold text-gray-500">{currentLanguage==='tr'?'Kalan Gün':'Days Left'}</th>
                        <th className="text-center py-2 px-3 text-xs font-semibold text-gray-500">{currentLanguage==='tr'?'Durum':'Status'}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {expItems.slice(0, 15).map(item => {
                        const isExpired = item.daysLeft < 0;
                        const isCritical = !isExpired && item.daysLeft <= 30;
                        const isWarn = !isExpired && item.daysLeft > 30 && item.daysLeft <= 90;
                        const badge = isExpired
                          ? { label: currentLanguage==='tr'?'Süresi Geçti':'Expired', cls: 'bg-red-100 text-red-700' }
                          : isCritical
                            ? { label: currentLanguage==='tr'?'Kritik':'Critical', cls: 'bg-orange-100 text-orange-700' }
                            : isWarn
                              ? { label: currentLanguage==='tr'?'Uyarı':'Warning', cls: 'bg-amber-100 text-amber-700' }
                              : { label: currentLanguage==='tr'?'Normal':'OK', cls: 'bg-emerald-100 text-emerald-700' };
                        return (
                          <tr key={item.id} className={`hover:bg-gray-50 ${isExpired ? 'bg-red-50/40' : ''}`}>
                            <td className="py-2.5 px-3 font-medium text-gray-900">{item.name}</td>
                            <td className="py-2.5 px-3 font-mono text-xs text-gray-500">{item.sku}</td>
                            <td className="py-2.5 px-3 text-right text-gray-700">{item.stockLevel}</td>
                            <td className="py-2.5 px-3 text-center text-xs text-gray-600">{item.expDate.toLocaleDateString()}</td>
                            <td className={`py-2.5 px-3 text-center font-bold text-sm ${isExpired ? 'text-red-600' : isCritical ? 'text-orange-600' : isWarn ? 'text-amber-600' : 'text-emerald-600'}`}>
                              {isExpired ? `+${Math.abs(item.daysLeft)}` : item.daysLeft}
                            </td>
                            <td className="py-2.5 px-3 text-center">
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${badge.cls}`}>{badge.label}</span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })()}

          {/* ── Phase 151: SKU Velocity Ranking ── */}
          {(() => {
            // Count units sold per SKU across all non-cancelled orders
            const skuMap: Record<string, { name: string; sku: string; unitsSold: number; revenue: number; category: string }> = {};
            for (const o of orders) {
              if (o.status === 'Cancelled') continue;
              for (const li of (o.lineItems || [])) {
                const key = li.sku || li.name;
                if (!skuMap[key]) {
                  const inv = inventory.find(i => i.sku === li.sku || i.name === li.name);
                  skuMap[key] = { name: li.name, sku: li.sku || key, unitsSold: 0, revenue: 0, category: inv?.category || '—' };
                }
                skuMap[key].unitsSold += li.quantity;
                skuMap[key].revenue += li.price * li.quantity;
              }
            }
            const skus = Object.values(skuMap).sort((a, b) => b.unitsSold - a.unitsSold).slice(0, 12);
            if (skus.length === 0) return null;
            const maxUnits = Math.max(...skus.map(s => s.unitsSold), 1);
            return (
              <div className="apple-card p-6">
                <h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? '🚀 SKU Hız Sıralaması' : '🚀 SKU Velocity Ranking'}</h3>
                <p className="text-xs text-gray-400 mb-4">{currentLanguage === 'tr' ? 'En çok satılan ürünler (adet bazında)' : 'Top products by units sold'}</p>
                <div className="space-y-2">
                  {skus.map((s, i) => {
                    const w = Math.round((s.unitsSold / maxUnits) * 100);
                    const tier = i < 3 ? 'A' : i < 7 ? 'B' : 'C';
                    const tierCls = tier === 'A' ? 'bg-emerald-100 text-emerald-700' : tier === 'B' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600';
                    return (
                      <div key={s.sku} className="flex items-center gap-3">
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md ${tierCls} shrink-0 w-6 text-center`}>{tier}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-0.5">
                            <span className="text-xs font-medium text-gray-800 truncate">{s.name}</span>
                            <span className="text-xs text-gray-500 ml-2 shrink-0 tabular-nums">{s.unitsSold} {currentLanguage==='tr'?'adet':'units'}</span>
                          </div>
                          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div className={`h-full rounded-full ${tier === 'A' ? 'bg-emerald-400' : tier === 'B' ? 'bg-blue-400' : 'bg-gray-300'}`} style={{ width: `${w}%` }} />
                          </div>
                        </div>
                        <span className="text-xs text-gray-500 shrink-0 tabular-nums w-20 text-right">{fmtAna(s.revenue,'full',0)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {/* ── Phase 176: Inventory Turnover by Category ── */}
          {inventory.length > 0 && orders.length > 0 && (() => {
            const catMap: Record<string, { totalCOGS: number; avgStock: number; turnover: number }> = {};
            for (const i of inventory) {
              const cat = i.category || (currentLanguage === 'tr' ? 'Diğer' : 'Other'); // parantez: önce tüm kategoriler 'Diğer'e çöküyordu
              if (!catMap[cat]) catMap[cat] = { totalCOGS: 0, avgStock: 0, turnover: 0 };
              catMap[cat].avgStock += (i.stockLevel ?? 0) * itemCostTRY(i, exchangeRates);
            }
            for (const o of orders) {
              if (o.status === 'Cancelled') continue;
              for (const li of (o.lineItems || [])) {
                const inv = inventory.find(ii => ii.id === li.inventoryId || ii.name === li.name);
                const cat = inv?.category || (currentLanguage === 'tr' ? 'Diğer' : 'Other');
                if (!catMap[cat]) catMap[cat] = { totalCOGS: 0, avgStock: 0, turnover: 0 };
                catMap[cat].totalCOGS += (inv ? itemCostTRY(inv, exchangeRates) : li.price * 0.6) * li.quantity;
              }
            }
            const cats = Object.entries(catMap)
              .map(([cat, v]) => ({
                cat,
                turnover: v.avgStock > 0 ? parseFloat((v.totalCOGS / v.avgStock).toFixed(2)) : 0,
                avgStock: v.avgStock,
              }))
              .filter(c => c.avgStock > 0)
              .sort((a, b) => b.turnover - a.turnover)
              .slice(0, 8);
            if (cats.length === 0) return null;
            const maxTurnover = Math.max(...cats.map(c => c.turnover), 1);
            return (
              <div className="apple-card p-6">
                <h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? '🔄 Kategori Bazlı Stok Devir Hızı' : '🔄 Inventory Turnover by Category'}</h3>
                <p className="text-xs text-gray-400 mb-4">{currentLanguage === 'tr' ? 'COGS / Ortalama stok değeri' : 'COGS / Average stock value'}</p>
                <div className="space-y-2.5">
                  {cats.map(c => {
                    const w = Math.round((c.turnover / maxTurnover) * 100);
                    return (
                      <div key={c.cat} className="flex items-center gap-3">
                        <span className="text-xs text-gray-700 w-28 shrink-0 truncate">{c.cat}</span>
                        <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${c.turnover >= 6 ? 'bg-emerald-400' : c.turnover >= 3 ? 'bg-blue-400' : 'bg-amber-400'}`} style={{ width: `${w}%` }} />
                        </div>
                        <span className={`text-xs font-bold tabular-nums shrink-0 w-10 text-right ${c.turnover >= 6 ? 'text-emerald-600' : c.turnover >= 3 ? 'text-blue-600' : 'text-amber-600'}`}>{c.turnover}x</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {/* ── Phase 177: Price Tier Revenue Distribution ── */}
          {orders.length > 0 && (() => {
            const tierMap: Record<string, { revenue: number; orders: number }> = {};
            for (const o of orders) {
              if (o.status === 'Cancelled') continue;
              const tier = (o as unknown as Record<string,unknown>).customerType as string || o.customerType || 'Retail';
              if (!tierMap[tier]) tierMap[tier] = { revenue: 0, orders: 0 };
              tierMap[tier].revenue += o.totalPrice || 0;
              tierMap[tier].orders++;
            }
            const tiers = Object.entries(tierMap).sort(([,a],[,b]) => b.revenue - a.revenue);
            if (tiers.length < 2) return null;
            const total177 = tiers.reduce((s, [,v]) => s + v.revenue, 0);
            const tierColors: Record<string, string> = { 'B2B': '#3b82f6', 'Retail': '#10b981', 'Dealer': '#f59e0b', 'B2B Premium': '#8b5cf6', 'B2B Standard': '#06b6d4' };
            return (
              <div className="apple-card p-6">
                <h3 className="font-bold text-gray-800 mb-4">{currentLanguage === 'tr' ? '💰 Fiyat Kademesi Gelir Dağılımı' : '💰 Price Tier Revenue Mix'}</h3>
                <div className="flex rounded-xl overflow-hidden h-6 mb-4 gap-0.5">
                  {tiers.map(([tier, v]) => (
                    <div key={tier} className="transition-all" style={{ width: `${Math.round((v.revenue / total177) * 100)}%`, backgroundColor: tierColors[tier] || '#6b7280' }} title={`${tier}: ₺${v.revenue.toLocaleString()}`} />
                  ))}
                </div>
                <div className="space-y-1.5">
                  {tiers.map(([tier, v]) => (
                    <div key={tier} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: tierColors[tier] || '#6b7280' }} />
                        <span className="text-gray-700">{tier}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-gray-400">{Math.round((v.revenue / total177) * 100)}%</span>
                        <span className="font-bold text-gray-800 tabular-nums">{fmtAna(v.revenue,'K',1)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
          </div>
        </div>
      )}

      {/* ── LOJİSTİK ── */}
      {reportsTab === 'lojistik' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: currentLanguage==='tr'?'Toplam Sipariş':'Total Orders', value: String(totalOrders), color: 'text-brand', bg: 'bg-brand/10' },
              { label: currentLanguage==='tr'?'Teslim Edilen':'Delivered', value: String(orders.filter(o=>o.status==='Delivered').length), color: 'text-green-600', bg: 'bg-green-50' },
              { label: currentLanguage==='tr'?'Aktarma':'In Transit', value: String(orders.filter(o=>o.status==='Shipped').length), color: 'text-blue-600', bg: 'bg-blue-50' },
              { label: currentLanguage==='tr'?'Toplam Ciro':'Revenue', value: `₺${totalRevenueTRY.toLocaleString('tr-TR',{minimumFractionDigits:0})}`, color: 'text-purple-600', bg: 'bg-purple-50' },
            ].map((k,i) => (
              <motion.div key={i} initial={{opacity:0,y:10}} animate={{opacity:1,y:0}} transition={{delay:i*0.05}} className={`apple-card p-5 ${k.bg}`}>
                <p className="text-xs font-bold text-[#86868B] uppercase tracking-wider mb-1">{k.label}</p>
                <p className={`text-2xl font-bold ${k.color}`}>{k.value}</p>
              </motion.div>
            ))}
          </div>

          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-4">{currentLanguage==='tr'?'Teslimat Performansı':'Delivery Performance'}</h3>
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <RePieChart>
                  <Pie data={statusChartData} cx="50%" cy="50%" outerRadius={100} paddingAngle={4} dataKey="value" label={(props: { name?: string, value?: number }) => `${props.name || ''}: ${props.value || 0}`}>
                    {statusChartData.map((_,i) => <Cell key={i} fill={COLORS[i%COLORS.length]} />)}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </RePieChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-4">{currentLanguage==='tr'?'Son Siparişler — Lojistik Durumu':'Recent Orders — Logistics Status'}</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    {[
                      {k:'shopifyOrderId', label:currentLanguage==='tr'?'Sipariş':'Order', align:'text-left', cls:''},
                      {k:'customerName', label:currentLanguage==='tr'?'Müşteri':'Customer', align:'text-left', cls:'hidden sm:table-cell'},
                      {k:'shippingAddress', label:currentLanguage==='tr'?'Adres':'Address', align:'text-left', cls:'hidden md:table-cell'},
                      {k:'status', label:currentLanguage==='tr'?'Durum':'Status', align:'text-center', cls:''},
                    ].map(({k,label,align,cls}) => {
                      const active = logisticsSummarySort.key === k;
                      return (
                        <th key={k} onClick={() => setLogisticsSummarySort(s=>({key:k,dir:s.key===k&&s.dir==='asc'?'desc':'asc'}))} className={`${align} py-2 px-3 font-medium text-xs cursor-pointer select-none transition-colors ${cls} ${active?'text-brand':'text-gray-500 hover:text-gray-700'}`}>
                          {label} <span className={active?'opacity-100':'opacity-25'}>{active?(logisticsSummarySort.dir==='asc'?'↑':'↓'):'↕'}</span>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {[...orders].sort((a,b) => {
                    const av = (a as unknown as Record<string,unknown>)[logisticsSummarySort.key] as string|number ?? '';
                    const bv = (b as unknown as Record<string,unknown>)[logisticsSummarySort.key] as string|number ?? '';
                    if (av < bv) return logisticsSummarySort.dir === 'asc' ? -1 : 1;
                    if (av > bv) return logisticsSummarySort.dir === 'asc' ? 1 : -1;
                    return 0;
                  }).slice(0,8).map((o,i) => (
                    <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="py-2.5 px-3 font-mono text-xs text-gray-600">#{o.shopifyOrderId||o.id?.slice(-6)||'—'}</td>
                      <td className="py-2.5 px-3 font-medium text-gray-800 hidden sm:table-cell">{o.customerName||'—'}</td>
                      <td className="py-2.5 px-3 text-xs text-gray-400 truncate max-w-[150px] hidden md:table-cell">{o.shippingAddress||'—'}</td>
                      <td className="py-2.5 px-3 text-center">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${o.status==='Delivered'?'bg-green-100 text-green-600':o.status==='Shipped'?'bg-blue-100 text-blue-600':o.status==='Pending'?'bg-yellow-100 text-yellow-600':'bg-gray-100 text-gray-500'}`}>{o.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── Phase 140: Cargo Company Performance Analysis ── */}
          {orders.filter(o => o.cargoCompany).length > 0 && (() => {
            type CargoStat = { name: string; shipments: number; delivered: number; deliveryRate: number; avgRevenue: number };
            const cargoMap: Record<string, CargoStat> = {};
            for (const o of orders) {
              if (!o.cargoCompany) continue;
              const co = o.cargoCompany;
              if (!cargoMap[co]) cargoMap[co] = { name: co, shipments: 0, delivered: 0, deliveryRate: 0, avgRevenue: 0 };
              cargoMap[co].shipments++;
              cargoMap[co].avgRevenue += o.totalPrice || 0;
              if (o.status === 'Delivered') cargoMap[co].delivered++;
            }
            const cargos = Object.values(cargoMap).map(c => ({
              ...c,
              deliveryRate: c.shipments > 0 ? Math.round((c.delivered / c.shipments) * 100) : 0,
              avgRevenue: c.shipments > 0 ? c.avgRevenue / c.shipments : 0,
            })).sort((a, b) => b.deliveryRate - a.deliveryRate);
            return (
              <div className="apple-card p-6">
                <h3 className="font-bold text-gray-800 mb-4">{currentLanguage === 'tr' ? '🚚 Kargo Firması Performansı' : '🚚 Cargo Company Performance'}</h3>
                <div className="space-y-3">
                  {cargos.map(c => (
                    <div key={c.name}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <p className="text-xs font-bold text-gray-800">{c.name}</p>
                          <span className="text-[9px] text-gray-400">{c.shipments} {currentLanguage === 'tr' ? 'gönderi' : 'shipments'}</span>
                        </div>
                        <span className={`text-xs font-bold ${c.deliveryRate >= 80 ? 'text-emerald-600' : c.deliveryRate >= 60 ? 'text-amber-600' : 'text-red-500'}`}>
                          %{c.deliveryRate} {currentLanguage === 'tr' ? 'teslimat' : 'delivery'}
                        </span>
                      </div>
                      <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
                        <div className={`h-2 rounded-full transition-all duration-700 ${c.deliveryRate >= 80 ? 'bg-emerald-400' : c.deliveryRate >= 60 ? 'bg-amber-400' : 'bg-red-400'}`} style={{ width: `${c.deliveryRate}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* ── Phase 152: Order Fulfillment Rate by City ── */}
          {orders.some(o => o.shippingAddress) && (() => {
            type CityFulfill = { city: string; total: number; delivered: number; rate: number };
            const cityMap: Record<string, CityFulfill> = {};
            for (const o of orders) {
              if (!o.shippingAddress) continue;
              // Extract city from address (last meaningful token or full address if short)
              const parts = o.shippingAddress.split(/[,\/\n]/);
              const city = (parts[parts.length - 1] || parts[0] || '—').trim().slice(0, 20) || '—';
              if (!cityMap[city]) cityMap[city] = { city, total: 0, delivered: 0, rate: 0 };
              cityMap[city].total++;
              if (o.status === 'Delivered') cityMap[city].delivered++;
            }
            const cities = Object.values(cityMap)
              .map(c => ({ ...c, rate: c.total > 0 ? Math.round((c.delivered / c.total) * 100) : 0 }))
              .filter(c => c.total >= 2)
              .sort((a, b) => b.total - a.total)
              .slice(0, 10);
            if (cities.length === 0) return null;
            return (
              <div className="apple-card p-6">
                <h3 className="font-bold text-gray-800 mb-4">{currentLanguage === 'tr' ? '🗺️ Şehir Bazında Teslimat Oranı' : '🗺️ Fulfillment Rate by City'}</h3>
                <div className="space-y-2.5">
                  {cities.map(c => (
                    <div key={c.city} className="flex items-center gap-3">
                      <span className="text-xs text-gray-600 font-medium w-28 shrink-0 truncate">{c.city}</span>
                      <div className="flex-1 h-2.5 bg-gray-100 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full transition-all ${c.rate >= 80 ? 'bg-emerald-400' : c.rate >= 60 ? 'bg-amber-400' : 'bg-red-400'}`}
                          style={{ width: `${c.rate}%` }} />
                      </div>
                      <span className={`text-xs font-bold w-12 text-right shrink-0 tabular-nums ${c.rate >= 80 ? 'text-emerald-600' : c.rate >= 60 ? 'text-amber-600' : 'text-red-500'}`}>
                        %{c.rate}
                      </span>
                      <span className="text-[10px] text-gray-400 shrink-0">{c.total}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* ── Phase 170: Order Lead Time Analysis ── */}
          {orders.filter(o => o.status === 'Delivered').length >= 3 && (() => {
            const delivered = orders.filter(o => o.status === 'Delivered' && o.createdAt);
            const leadTimes: number[] = [];
            for (const o of delivered) {
              try {
                const created = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
                // Approximate delivery date as updatedAt or +7 days heuristic
                const raw2 = (o as unknown as Record<string,unknown>).updatedAt;
                const delivered_date = raw2
                  ? ((raw2 as { toDate?: () => Date }).toDate?.() ?? new Date(raw2 as string))
                  : null;
                if (delivered_date) {
                  const days = Math.round((delivered_date.getTime() - created.getTime()) / 86400000);
                  if (days >= 0 && days <= 90) leadTimes.push(days);
                }
              } catch { /* skip */ }
            }
            if (leadTimes.length < 2) return null;
            const avgLT = Math.round(leadTimes.reduce((s, d) => s + d, 0) / leadTimes.length);
            const minLT = Math.min(...leadTimes);
            const maxLT = Math.max(...leadTimes);
            // Histogram buckets
            const buckets = [
              { label: '0-3', min: 0, max: 3, count: 0 },
              { label: '4-7', min: 4, max: 7, count: 0 },
              { label: '8-14', min: 8, max: 14, count: 0 },
              { label: '15+', min: 15, max: Infinity, count: 0 },
            ];
            for (const d of leadTimes) { const b = buckets.find(b => d >= b.min && d <= b.max); if (b) b.count++; }
            const maxBucketCount = Math.max(...buckets.map(b => b.count), 1);
            return (
              <div className="apple-card p-6">
                <h3 className="font-bold text-gray-800 mb-4">{currentLanguage === 'tr' ? '📦 Sipariş Teslim Süresi' : '📦 Order Lead Time'}</h3>
                <div className="grid grid-cols-3 gap-3 mb-5">
                  {[
                    { label: currentLanguage==='tr'?'Ortalama':'Average', value: `${avgLT}g`, color: avgLT <= 7 ? 'text-emerald-600' : avgLT <= 14 ? 'text-amber-600' : 'text-red-500' },
                    { label: currentLanguage==='tr'?'En Hızlı':'Fastest', value: `${minLT}g`, color: 'text-emerald-600' },
                    { label: currentLanguage==='tr'?'En Yavaş':'Slowest', value: `${maxLT}g`, color: 'text-red-500' },
                  ].map(k => (
                    <div key={k.label} className="bg-gray-50 rounded-xl p-3 text-center">
                      <p className={`text-xl font-bold ${k.color}`}>{k.value}</p>
                      <p className="text-[10px] text-gray-400">{k.label}</p>
                    </div>
                  ))}
                </div>
                <div className="flex items-end gap-3 h-20">
                  {buckets.map(b => (
                    <div key={b.label} className="flex-1 flex flex-col items-center gap-1">
                      <div className="w-full flex flex-col justify-end" style={{ height: '64px' }}>
                        <div className={`w-full rounded-t-lg ${b.label === '0-3' ? 'bg-emerald-400' : b.label === '4-7' ? 'bg-blue-400' : b.label === '8-14' ? 'bg-amber-400' : 'bg-red-400'}`}
                          style={{ height: `${Math.max(Math.round((b.count / maxBucketCount) * 100), 4)}%` }} />
                      </div>
                      <span className="text-[9px] text-gray-400">{b.label}{currentLanguage==='tr'?'g':'d'}</span>
                    </div>
                  ))}
                </div>
                <p className="text-[10px] text-gray-400 mt-2">{currentLanguage==='tr'?`${leadTimes.length} teslim üzerinden hesaplandı`:`Calculated from ${leadTimes.length} deliveries`}</p>
              </div>
            );
          })()}
        </div>
      )}

      {/* ── İNSAN KAYNAKLARI ── */}
      {reportsTab === 'ik' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {([
              { label: currentLanguage==='tr'?'Aktif Çalışan':'Active Employees', value: hrStats.activeEmployees.toString(), icon: Users, color: 'text-blue-600', bg: 'bg-blue-50', desc: currentLanguage==='tr'?'Toplam çalışan sayısı':'Total employee count', isMoney: false },
              { label: currentLanguage==='tr'?'Ödenen Maaş':'Paid Salary', value: formatInCurrency(hrStats.totalPayroll, revenueCurrency, exchangeRates), icon: CreditCard, color: 'text-green-600', bg: 'bg-green-50', desc: currentLanguage==='tr'?'Toplam ödenen bordro':'Total paid payroll', isMoney: true },
              { label: currentLanguage==='tr'?'İzin Bekleyen':'Pending Leave', value: hrStats.pendingLeave.toString(), icon: Calendar, color: 'text-orange-500', bg: 'bg-orange-50', desc: currentLanguage==='tr'?'Onay bekleyen talepler':'Requests awaiting approval', isMoney: false },
            ] as { label: string; value: string; icon: React.ElementType; color: string; bg: string; desc: string; isMoney: boolean }[]).map((k,i) => {
              const Icon = k.icon;
              return (
                <div key={i} className={`apple-card p-5 ${k.bg}`}>
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <Icon className={`w-5 h-5 ${k.color}`} />
                      <p className="text-xs font-bold text-[#86868B] uppercase tracking-wider">{k.label}</p>
                    </div>
                    {k.isMoney && (
                      <div className="flex gap-0.5 bg-white/70 rounded-md p-0.5">
                        {(['TRY','USD','EUR'] as const).map(c => (
                          <button key={c} onClick={() => setRevenueCurrency(c)}
                            className={`px-1 py-0.5 rounded text-[9px] font-bold transition-colors ${revenueCurrency===c ? 'bg-white shadow-sm text-green-700' : 'text-gray-400 hover:text-gray-600'}`}>
                            {c==='TRY'?'₺':c==='USD'?'$':'€'}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <p className={`text-2xl font-bold ${k.color}`}>{k.value}</p>
                  <p className="text-xs text-gray-400 mt-1">{k.desc}</p>
                </div>
              );
            })}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="apple-card p-6">
              <h4 className="font-bold mb-6">{currentLanguage==='tr'?'Departman Dağılımı':'Department Distribution'}</h4>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <RePieChart>
                    <Pie
                      data={hrStats.departmentDistribution}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={80}
                      paddingAngle={5}
                      dataKey="value"
                    >
                      {hrStats.departmentDistribution.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </RePieChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="apple-card p-6">
              <h4 className="font-bold mb-6">{currentLanguage==='tr'?'Maaş Ödeme Trendi':'Payroll Payment Trend'}</h4>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={hrStats.payrollTrend}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="name" axisLine={false} tickLine={false} />
                    <YAxis axisLine={false} tickLine={false} />
                    <Tooltip />
                    <Bar dataKey="value" fill="#ff4000" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* ── Phase 180: HR Cost Ratio ── */}
      {reportsTab === 'ik' && employees.length > 0 && orders.length > 0 && (() => {
        const totalRevHR = orders.filter(o => o.status !== 'Cancelled').reduce((s, o) => s + (o.totalPrice || 0), 0);
        const totalPayrollHR = employees.filter(e => e.status === 'Aktif').reduce((s, e) => s + (e.salary || 0), 0);
        const hrCostRatio = totalRevHR > 0 ? Math.round((totalPayrollHR / totalRevHR) * 100) : 0;
        const revenuePerPayroll = totalPayrollHR > 0 ? (totalRevHR / totalPayrollHR).toFixed(1) : '—';
        const totalOrders180 = orders.filter(o => o.status !== 'Cancelled').length;
        const avgOrdersPerEmp = employees.filter(e => e.status === 'Aktif').length > 0
          ? Math.round(totalOrders180 / employees.filter(e => e.status === 'Aktif').length)
          : 0;
        return (
          <div className="apple-card p-6">
            <h4 className="font-bold text-gray-800 mb-4">{currentLanguage==='tr'?'💼 İK Maliyet Analizi':'💼 HR Cost Analysis'}</h4>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: currentLanguage==='tr'?'İK / Ciro Oranı':'HR Cost Ratio', value: `%${hrCostRatio}`, color: hrCostRatio <= 20 ? 'text-emerald-600' : hrCostRatio <= 40 ? 'text-amber-600' : 'text-red-500', desc: currentLanguage==='tr'?'Maaş/Toplam Ciro':'Payroll/Revenue' },
                { label: currentLanguage==='tr'?'Gelir Çarpanı':'Revenue Multiplier', value: `${revenuePerPayroll}x`, color: 'text-blue-600', desc: currentLanguage==='tr'?'Ciro/Maaş Kütlesi':'Revenue/Payroll' },
                { label: currentLanguage==='tr'?'Toplam Maaş':'Total Payroll', value: `₺${(totalPayrollHR/1000).toFixed(0)}K`, color: 'text-gray-700', desc: currentLanguage==='tr'?'Aylık':'Monthly' },
                { label: currentLanguage==='tr'?'Çalışan Başı Sipariş':'Orders/Employee', value: String(avgOrdersPerEmp), color: 'text-purple-600', desc: currentLanguage==='tr'?'Toplam sipariş/aktif':'Total orders/active' },
              ].map(k => (
                <div key={k.label} className="bg-gray-50 rounded-xl p-4 text-center">
                  <p className={`text-2xl font-bold ${k.color}`}>{k.value}</p>
                  <p className="text-[10px] text-gray-600 font-medium mt-0.5">{k.label}</p>
                  <p className="text-[9px] text-gray-400">{k.desc}</p>
                </div>
              ))}
            </div>
            <div className="mt-4">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs text-gray-600">{currentLanguage==='tr'?'İK Maliyeti / Toplam Ciro':'HR Cost / Revenue'}</span>
                <span className={`text-xs font-bold ${hrCostRatio <= 20 ? 'text-emerald-600' : hrCostRatio <= 40 ? 'text-amber-600' : 'text-red-500'}`}>%{hrCostRatio}</span>
              </div>
              <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
                <div className={`h-full rounded-full ${hrCostRatio <= 20 ? 'bg-emerald-400' : hrCostRatio <= 40 ? 'bg-amber-400' : 'bg-red-400'}`} style={{ width: `${Math.min(hrCostRatio, 100)}%` }} />
              </div>
              <p className="text-[10px] text-gray-400 mt-1">{currentLanguage==='tr'?'Benchmark: %20-35 (B2B SaaS sektörü)':'Benchmark: 20-35% (B2B sector)'}</p>
            </div>
          </div>
        );
      })()}

      {/* ── Phase 188: Headcount Planning ── */}
      {reportsTab === 'ik' && employees.length > 0 && orders.length > 0 && (() => {
        const activeEmps188 = employees.filter(e => e.status === 'Aktif').length || 1;
        const totalRev188 = orders.filter(o => o.status !== 'Cancelled').reduce((s, o) => s + (o.totalPrice || 0), 0);
        const revPerEmp188 = Math.round(totalRev188 / activeEmps188);
        // Estimate headcount needed for 1.5x and 2x revenue targets
        const targets188 = [
          { label: currentLanguage === 'tr' ? '1.5× Büyüme' : '1.5× Growth', rev: totalRev188 * 1.5 },
          { label: currentLanguage === 'tr' ? '2× Büyüme' : '2× Growth', rev: totalRev188 * 2 },
          { label: currentLanguage === 'tr' ? '3× Büyüme' : '3× Growth', rev: totalRev188 * 3 },
        ].map(t => ({
          ...t,
          headcount: revPerEmp188 > 0 ? Math.ceil(t.rev / revPerEmp188) : 0,
          hires: revPerEmp188 > 0 ? Math.max(0, Math.ceil(t.rev / revPerEmp188) - activeEmps188) : 0,
        }));
        const avgSalary188 = employees.filter(e => e.status === 'Aktif' && e.salary).reduce((s, e) => s + (e.salary || 0), 0) / activeEmps188;
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '👷 Kadro Planlama' : '👷 Headcount Planning'}</h3>
              <span className="text-xs text-purple-700 font-bold bg-purple-50 px-2 py-0.5 rounded-full">{currentLanguage === 'tr' ? `${activeEmps188} aktif` : `${activeEmps188} active`}</span>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="bg-gray-50 rounded-xl p-4">
                <p className="text-[10px] text-gray-500 font-medium uppercase tracking-wide mb-1">{currentLanguage === 'tr' ? 'Çalışan Başı Ciro' : 'Revenue / Employee'}</p>
                <p className="text-2xl font-black text-gray-800">{fmtAna(revPerEmp188,'K',0)}</p>
              </div>
              <div className="bg-gray-50 rounded-xl p-4">
                <p className="text-[10px] text-gray-500 font-medium uppercase tracking-wide mb-1">{currentLanguage === 'tr' ? 'Ort. Maaş' : 'Avg Salary'}</p>
                <p className="text-2xl font-black text-gray-800">{fmtAna(avgSalary188,'K',0)}</p>
              </div>
            </div>
            <div className="space-y-3">
              <p className="text-xs font-semibold text-gray-700">{currentLanguage === 'tr' ? 'Büyüme Senaryoları:' : 'Growth Scenarios:'}</p>
              {targets188.map(t => (
                <div key={t.label} className="flex items-center justify-between p-3 bg-purple-50 rounded-xl">
                  <div>
                    <p className="text-xs font-bold text-purple-800">{t.label}</p>
                    <p className="text-[10px] text-purple-600">{fmtAna(t.rev,'K',0)} {currentLanguage === 'tr' ? 'hedef ciro' : 'target revenue'}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-black text-purple-700">{t.headcount} {currentLanguage === 'tr' ? 'kişi' : 'staff'}</p>
                    <p className="text-[10px] text-purple-500">+{t.hires} {currentLanguage === 'tr' ? 'yeni işe alım' : 'new hires'}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 154: HR Turnover & Tenure Analytics ── */}
          {employees.length > 0 && (() => {
            const now154 = new Date();
            const active = employees.filter(e => e.status === 'Aktif');
            const left = employees.filter(e => e.status === 'Ayrıldı');
            const turnoverRate = employees.length > 0 ? Math.round((left.length / employees.length) * 100) : 0;
            // Tenure buckets for active employees
            const tenureBuckets = [
              { label: currentLanguage==='tr'?'<1 Yıl':'<1 Year', min: 0, max: 12, count: 0 },
              { label: currentLanguage==='tr'?'1-3 Yıl':'1-3 Yrs', min: 12, max: 36, count: 0 },
              { label: currentLanguage==='tr'?'3-5 Yıl':'3-5 Yrs', min: 36, max: 60, count: 0 },
              { label: currentLanguage==='tr'?'5+ Yıl':'5+ Yrs', min: 60, max: Infinity, count: 0 },
            ];
            for (const e of active) {
              if (!e.startDate) continue;
              const months = Math.round((now154.getTime() - new Date(e.startDate).getTime()) / (30 * 86400000));
              const b = tenureBuckets.find(b => months >= b.min && months < b.max);
              if (b) b.count++;
            }
            const maxBucket = Math.max(...tenureBuckets.map(b => b.count), 1);
            // Avg tenure
            const avgTenureMonths = active.filter(e => e.startDate).length > 0
              ? Math.round(active.filter(e => e.startDate).reduce((s, e) => s + Math.round((now154.getTime() - new Date(e.startDate!).getTime()) / (30 * 86400000)), 0) / active.filter(e => e.startDate).length)
              : 0;
            // Salary by dept
            const deptSalary: Record<string, number> = {};
            for (const e of active) {
              if (!e.department || !e.salary) continue;
              deptSalary[e.department] = (deptSalary[e.department] ?? 0) + (e.salary || 0);
            }
            const deptList = Object.entries(deptSalary).sort(([,a],[,b]) => b - a).slice(0, 5);
            const maxDeptSal = Math.max(...deptList.map(([,v]) => v), 1);
            return (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="apple-card p-6">
                  <h4 className="font-bold text-gray-800 mb-4">{currentLanguage==='tr'?'👥 Kıdem Dağılımı':'👥 Tenure Distribution'}</h4>
                  <div className="grid grid-cols-2 gap-3 mb-4">
                    {[
                      { label: currentLanguage==='tr'?'Aktif':'Active', value: active.length, color: 'text-emerald-600' },
                      { label: currentLanguage==='tr'?'Ortalama Kıdem':'Avg Tenure', value: `${Math.floor(avgTenureMonths/12)}y ${avgTenureMonths%12}m`, color: 'text-blue-600' },
                      { label: currentLanguage==='tr'?'Ayrılan':'Left', value: left.length, color: 'text-red-500' },
                      { label: currentLanguage==='tr'?'Devir Oranı':'Turnover', value: `%${turnoverRate}`, color: turnoverRate <= 15 ? 'text-emerald-600' : 'text-red-500' },
                    ].map(k => (
                      <div key={k.label} className="bg-gray-50 rounded-xl p-3 text-center">
                        <p className={`text-xl font-bold ${k.color}`}>{k.value}</p>
                        <p className="text-[10px] text-gray-400">{k.label}</p>
                      </div>
                    ))}
                  </div>
                  <div className="space-y-2">
                    {tenureBuckets.map(b => (
                      <div key={b.label} className="flex items-center gap-3">
                        <span className="text-xs text-gray-600 w-16 shrink-0">{b.label}</span>
                        <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full bg-blue-400 rounded-full" style={{ width: `${Math.round((b.count / maxBucket) * 100)}%` }} />
                        </div>
                        <span className="text-xs font-semibold text-gray-700 w-6 text-right">{b.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="apple-card p-6">
                  <h4 className="font-bold text-gray-800 mb-4">{currentLanguage==='tr'?'💰 Departman Maaş Kütlesi':'💰 Payroll by Department'}</h4>
                  {deptList.length === 0 ? (
                    <p className="text-sm text-gray-400 text-center py-8">{currentLanguage==='tr'?'Veri yok':'No data'}</p>
                  ) : (
                    <div className="space-y-3">
                      {deptList.map(([dept, total]) => (
                        <div key={dept}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs font-medium text-gray-800 truncate">{dept}</span>
                            <span className="text-xs font-bold text-gray-700 tabular-nums ml-2 shrink-0">{fmtAna(total)}</span>
                          </div>
                          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                            <div className="h-full bg-purple-400 rounded-full" style={{ width: `${Math.round((total / maxDeptSal) * 100)}%` }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          <div className="apple-card p-6 text-center">
            <div className="w-16 h-16 bg-purple-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <UserCheck className="w-8 h-8 text-purple-500" />
            </div>
            <h3 className="text-lg font-bold text-gray-800 mb-2">{currentLanguage==='tr'?'İK Yönetimine Git':'Go to HR Management'}</h3>
            <p className="text-sm text-gray-500 max-w-md mx-auto mb-6">{currentLanguage==='tr'?'Detaylı çalışan yönetimi, bordro hesaplama ve izin onayları için İK sekmesini kullanın.':'Use the HR tab for detailed employee management, payroll calculation, and leave approvals.'}</p>
            <button onClick={() => onNavigate?.('ik')} className="apple-button-primary px-6 py-2 text-sm">
              {currentLanguage==='tr'?'İnsan Kaynakları Sekmesine Git →':'Go to Human Resources →'}
            </button>
          </div>

          {/* ── Phase 169: Revenue per Employee ── */}
          {employees.length > 0 && orders.length > 0 && (() => {
            const activeEmps = employees.filter(e => e.status === 'Aktif').length || 1;
            const totalRev169 = orders.filter(o => o.status !== 'Cancelled').reduce((s, o) => s + (o.totalPrice || 0), 0);
            const revPerEmp = Math.round(totalRev169 / activeEmps);
            const totalPayroll = employees.filter(e => e.status === 'Aktif').reduce((s, e) => s + (e.salary || 0), 0);
            const revenueMultiplier = totalPayroll > 0 ? (totalRev169 / totalPayroll).toFixed(1) : '—';
            // Revenue per dept
            const deptRevMap: Record<string, number> = {};
            for (const o of orders) {
              if (o.status === 'Cancelled') continue;
              const rep = (o.assignedTo as string | undefined) || '';
              const emp = employees.find(e => e.name === rep || e.email === rep);
              if (emp?.department) {
                deptRevMap[emp.department] = (deptRevMap[emp.department] ?? 0) + (o.totalPrice || 0);
              }
            }
            const deptList169 = Object.entries(deptRevMap).sort(([,a],[,b]) => b - a).slice(0, 5);
            return (
              <div className="apple-card p-6">
                <h4 className="font-bold text-gray-800 mb-4">{currentLanguage==='tr'?'📊 Çalışan Başı Üretkenlik':'📊 Revenue per Employee'}</h4>
                <div className="grid grid-cols-3 gap-3 mb-4">
                  {[
                    { label: currentLanguage==='tr'?'Çalışan Başı Ciro':'Rev / Employee', value: `₺${(revPerEmp/1000).toFixed(1)}K`, color: 'text-blue-600' },
                    { label: currentLanguage==='tr'?'Gelir Çarpanı':'Revenue Multiplier', value: `${revenueMultiplier}x`, color: 'text-emerald-600' },
                    { label: currentLanguage==='tr'?'Aktif Çalışan':'Active Staff', value: String(activeEmps), color: 'text-gray-700' },
                  ].map(k => (
                    <div key={k.label} className="bg-gray-50 rounded-xl p-3 text-center">
                      <p className={`text-lg font-bold ${k.color}`}>{k.value}</p>
                      <p className="text-[10px] text-gray-400 leading-tight mt-0.5">{k.label}</p>
                    </div>
                  ))}
                </div>
                {deptList169.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-gray-600 mb-2">{currentLanguage==='tr'?'Departman Bazlı Ciro':'Revenue by Department'}</p>
                    {deptList169.map(([dept, rev]) => (
                      <div key={dept} className="flex items-center justify-between text-xs">
                        <span className="text-gray-700 truncate">{dept}</span>
                        <span className="font-bold text-gray-800 ml-2">{fmtAna(rev,'K',1)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}

      {/* ── Phase 172: Top New Customers This Month ── */}
      {reportsTab === 'crm' && orders.length >= 3 && (() => {
        const now172 = new Date();
        const thisMonth172 = `${now172.getFullYear()}-${String(now172.getMonth()+1).padStart(2,'0')}`;
        // Find first-order-ever date per customer
        const firstOrderDate: Record<string, string> = {};
        for (const o of orders) {
          if (o.status === 'Cancelled') continue;
          try {
            const d = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
            const mkey = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
            const name = o.customerName || '—';
            if (!firstOrderDate[name] || mkey < firstOrderDate[name]) firstOrderDate[name] = mkey;
          } catch { /* skip */ }
        }
        // New customers this month (first order is this month)
        const newThisMonth = Object.entries(firstOrderDate)
          .filter(([, m]) => m === thisMonth172)
          .map(([name]) => {
            const custOrders = orders.filter(o => o.customerName === name && o.status !== 'Cancelled');
            const revenue = custOrders.reduce((s, o) => s + (o.totalPrice || 0), 0);
            return { name, revenue, orders: custOrders.length };
          })
          .sort((a, b) => b.revenue - a.revenue);
        if (newThisMonth.length === 0) return null;
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '🌟 Bu Ayin Yeni Müşterileri' : '🌟 New Customers This Month'}</h3>
              <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">{newThisMonth.length} {currentLanguage==='tr'?'yeni':'new'}</span>
            </div>
            <div className="space-y-2">
              {newThisMonth.slice(0, 6).map((c, i) => (
                <div key={i} className="flex items-center justify-between py-1.5 border-b border-gray-50 last:border-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-5 h-5 rounded-full bg-emerald-100 flex items-center justify-center text-[9px] font-bold text-emerald-700 shrink-0">{i+1}</span>
                    <span className="text-xs font-medium text-gray-800 truncate">{c.name}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 ml-2">
                    <span className="text-[10px] text-gray-400">{c.orders} {currentLanguage==='tr'?'sip.':'ord.'}</span>
                    <span className="text-xs font-bold text-emerald-600">{fmtAna(c.revenue)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 139: Customer Retention Analysis ── */}
      {reportsTab === 'crm' && orders.length > 3 && (() => {
        // New vs Returning customers per month (last 6 months)
        const now139 = new Date();
        const months139 = Array.from({ length: 6 }, (_, i) => {
          const d = new Date(now139.getFullYear(), now139.getMonth() - (5 - i), 1);
          return { year: d.getFullYear(), month: d.getMonth(), label: d.toLocaleString(currentLanguage === 'tr' ? 'tr-TR' : 'en-US', { month: 'short' }) };
        });
        const getOD139 = (o: Order): Date => {
          const raw = o.createdAt ?? o.syncedAt;
          if (!raw) return new Date(0);
          return typeof (raw as { toDate?: () => Date }).toDate === 'function' ? (raw as { toDate: () => Date }).toDate() : new Date(raw as string | number);
        };
        // Build first-order date per customer
        const firstOrderMap: Record<string, Date> = {};
        for (const o of [...orders].sort((a, b) => getOD139(a).getTime() - getOD139(b).getTime())) {
          if (!firstOrderMap[o.customerName]) firstOrderMap[o.customerName] = getOD139(o);
        }
        const data139 = months139.map(m => {
          const monthOrders = orders.filter(o => {
            const d = getOD139(o);
            return d.getFullYear() === m.year && d.getMonth() === m.month;
          });
          const customers = [...new Set(monthOrders.map(o => o.customerName))];
          const newCustomers = customers.filter(c => {
            const first = firstOrderMap[c];
            return first && first.getFullYear() === m.year && first.getMonth() === m.month;
          }).length;
          return { label: m.label, new: newCustomers, returning: customers.length - newCustomers };
        });
        const maxBar = Math.max(...data139.map(d => d.new + d.returning), 1);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? '🔄 Müşteri Tutma Analizi' : '🔄 Customer Retention'}</h3>
            <p className="text-xs text-gray-400 mb-4">{currentLanguage === 'tr' ? 'Yeni vs Geri dönen müşteriler' : 'New vs returning customers per month'}</p>
            <div className="flex items-end gap-3 h-32 mb-3">
              {data139.map((d, i) => {
                const totalH = (d.new + d.returning) / maxBar * 100;
                const newH = (d.new / maxBar) * 100;
                const retH = (d.returning / maxBar) * 100;
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1">
                    <div className="w-full flex flex-col justify-end" style={{ height: '100px' }}>
                      <div className="w-full flex flex-col overflow-hidden rounded-t-md" style={{ height: `${totalH}%` }}>
                        <div style={{ height: `${totalH > 0 ? (retH / totalH) * 100 : 0}%` }} className="w-full bg-brand/40 rounded-t-sm" />
                        <div style={{ height: `${totalH > 0 ? (newH / totalH) * 100 : 0}%` }} className="w-full bg-brand" />
                      </div>
                    </div>
                    <span className="text-[9px] text-gray-400 font-semibold">{d.label}</span>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center gap-4 pt-3 border-t border-gray-50">
              <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-brand flex-shrink-0" /><span className="text-[10px] text-gray-500">{currentLanguage === 'tr' ? 'Yeni' : 'New'}</span></div>
              <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-brand/40 flex-shrink-0" /><span className="text-[10px] text-gray-500">{currentLanguage === 'tr' ? 'Geri Dönen' : 'Returning'}</span></div>
            </div>
          </div>
        );
      })()}

      {/* ── Phase 145: Quote-to-Order Conversion Rate ── */}
      {reportsTab === 'crm' && quotations.length > 0 && (() => {
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
      })()}

      {/* ── Phase 155: Customer Discount Analysis ── */}
      {reportsTab === 'crm' && orders.length > 0 && inventory.length > 0 && (() => {
        // For each order, compare actualPrice vs list price to compute discount
        type DiscStat = { customer: string; orders: number; totalList: number; totalActual: number; discPct: number };
        const custMap: Record<string, DiscStat> = {};
        for (const o of orders) {
          if (o.status === 'Cancelled') continue;
          const name = o.customerName || '—';
          if (!custMap[name]) custMap[name] = { customer: name, orders: 0, totalList: 0, totalActual: 0, discPct: 0 };
          custMap[name].orders++;
          custMap[name].totalActual += o.totalPrice || 0;
          // Estimate list price from inventory retail prices × quantities
          const listPrice = (o.lineItems || []).reduce((s, li) => {
            const inv = inventory.find(i => i.id === li.inventoryId || i.name === li.name || i.sku === li.sku);
            return s + ((inv?.prices?.['Retail'] ?? inv?.price ?? li.price) * li.quantity);
          }, 0);
          custMap[name].totalList += listPrice || o.totalPrice || 0;
        }
        const discs = Object.values(custMap).map(c => ({
          ...c,
          discPct: c.totalList > 0 ? Math.round(((c.totalList - c.totalActual) / c.totalList) * 100) : 0,
        })).filter(c => c.orders >= 1).sort((a, b) => b.discPct - a.discPct).slice(0, 8);
        if (discs.length === 0 || discs.every(d => d.discPct === 0)) return null;
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? '🏷️ Müşteri İndirim Analizi' : '🏷️ Customer Discount Analysis'}</h3>
            <p className="text-xs text-gray-400 mb-4">{currentLanguage === 'tr' ? 'Liste fiyatına göre uygulanan ortalama indirim' : 'Average discount vs retail list price'}</p>
            <div className="space-y-2.5">
              {discs.map(c => (
                <div key={c.customer} className="flex items-center gap-3">
                  <span className="text-xs font-medium text-gray-800 w-36 truncate shrink-0">{c.customer}</span>
                  <div className="flex-1 h-2.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${c.discPct >= 20 ? 'bg-red-400' : c.discPct >= 10 ? 'bg-amber-400' : 'bg-emerald-400'}`}
                      style={{ width: `${Math.min(c.discPct * 3, 100)}%` }} />
                  </div>
                  <span className={`text-xs font-bold tabular-nums shrink-0 w-10 text-right ${c.discPct >= 20 ? 'text-red-600' : c.discPct >= 10 ? 'text-amber-600' : 'text-emerald-600'}`}>
                    %{c.discPct}
                  </span>
                  <span className="text-[10px] text-gray-400 shrink-0">{c.orders} {currentLanguage==='tr'?'sip.':'ord.'}</span>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-gray-400 mt-3">{currentLanguage==='tr'?'* İndirim = (Liste Fiyatı - Gerçekleşen) / Liste Fiyatı':'* Discount = (List Price - Actual) / List Price'}</p>
          </div>
        );
      })()}

      {/* ── Phase 158: Top Product Co-Purchase Pairs ── */}
      {reportsTab === 'envanter' && orders.length >= 3 && (() => {
        // Find most common item pairs within the same order
        const pairMap: Record<string, { nameA: string; nameB: string; count: number }> = {};
        for (const o of orders) {
          if (o.status === 'Cancelled') continue;
          const items = (o.lineItems || []).map(li => li.name).filter(Boolean);
          if (items.length < 2) continue;
          for (let i = 0; i < items.length; i++) {
            for (let j = i + 1; j < items.length; j++) {
              const key = [items[i], items[j]].sort().join('|||');
              if (!pairMap[key]) pairMap[key] = { nameA: items[i], nameB: items[j], count: 0 };
              pairMap[key].count++;
            }
          }
        }
        const pairs = Object.values(pairMap).filter(p => p.count >= 2).sort((a, b) => b.count - a.count).slice(0, 8);
        if (pairs.length === 0) return null;
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? '🛒 Birlikte Sık Satın Alınan Ürünler' : '🛒 Frequently Bought Together'}</h3>
            <p className="text-xs text-gray-400 mb-4">{currentLanguage === 'tr' ? 'Aynı siparişte en çok birlikte geçen ürün çiftleri' : 'Most common product pairs in the same order'}</p>
            <div className="space-y-2.5">
              {pairs.map((p, i) => (
                <div key={i} className="flex items-center gap-3 py-2 border-b border-gray-50 last:border-0">
                  <span className="text-xs font-semibold text-gray-700 bg-gray-100 px-1.5 py-0.5 rounded-md shrink-0">×{p.count}</span>
                  <div className="flex-1 min-w-0 flex items-center gap-2">
                    <span className="text-xs font-medium text-gray-800 truncate">{p.nameA}</span>
                    <span className="text-gray-300 shrink-0">+</span>
                    <span className="text-xs font-medium text-gray-800 truncate">{p.nameB}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 175: Customer Win-Back Candidates ── */}
      {reportsTab === 'crm' && orders.length >= 3 && (() => {
        const now175 = new Date();
        const cutoff175 = new Date(now175); cutoff175.setDate(cutoff175.getDate() - 90);
        // Find customers whose last order was >90 days ago
        const lastOrderDate: Record<string, Date> = {};
        for (const o of orders) {
          if (o.status === 'Cancelled') continue;
          try {
            const d = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
            if (!lastOrderDate[o.customerName] || d > lastOrderDate[o.customerName]) {
              lastOrderDate[o.customerName] = d;
            }
          } catch { /* skip */ }
        }
        const winBack = Object.entries(lastOrderDate)
          .filter(([, d]) => d < cutoff175)
          .map(([name, lastDate]) => {
            const daysDormant = Math.floor((now175.getTime() - lastDate.getTime()) / 86400000);
            const custOrders = orders.filter(o => o.customerName === name && o.status !== 'Cancelled');
            const ltv = custOrders.reduce((s, o) => s + (o.totalPrice || 0), 0);
            return { name, daysDormant, ltv, orders: custOrders.length };
          })
          .sort((a, b) => b.ltv - a.ltv)
          .slice(0, 6);
        if (winBack.length === 0) return null;
        return (
          <div className="apple-card p-6 border border-amber-100">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '🔄 Geri Kazanım Listesi' : '🔄 Win-Back Candidates'}</h3>
              <span className="text-xs text-amber-700 font-bold bg-amber-50 px-2 py-0.5 rounded-full">{winBack.length} {currentLanguage==='tr'?'hareketsiz müşteri':'dormant customers'}</span>
            </div>
            <div className="space-y-2.5">
              {winBack.map((c, i) => (
                <div key={i} className="flex items-center justify-between py-1.5 border-b border-gray-50 last:border-0">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-gray-800 truncate">{c.name}</p>
                    <p className="text-[10px] text-gray-400">{c.daysDormant} {currentLanguage==='tr'?'gündür sipariş yok':'days since last order'} · {c.orders} {currentLanguage==='tr'?'önceki sip.':'prev orders'}</p>
                  </div>
                  <span className="text-xs font-bold text-amber-600 shrink-0 ml-3">{fmtAna(c.ltv,'K',1)} LTV</span>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-gray-400 mt-3">{currentLanguage==='tr'?'90+ gündür sipariş vermeyen yüksek değerli müşteriler':'High-value customers who haven\'t ordered in 90+ days'}</p>
          </div>
        );
      })()}

      {/* ── Phase 164: Customer LTV Tier Segmentation ── */}
      {reportsTab === 'crm' && orders.length >= 5 && (() => {
        // Compute LTV per customer
        const ltvMap: Record<string, { name: string; ltv: number; orders: number; avgOrder: number }> = {};
        for (const o of orders) {
          if (o.status === 'Cancelled') continue;
          const name = o.customerName || '—';
          if (!ltvMap[name]) ltvMap[name] = { name, ltv: 0, orders: 0, avgOrder: 0 };
          ltvMap[name].ltv += o.totalPrice || 0;
          ltvMap[name].orders++;
        }
        const customers = Object.values(ltvMap).map(c => ({ ...c, avgOrder: c.orders > 0 ? c.ltv / c.orders : 0 })).sort((a, b) => b.ltv - a.ltv);
        if (customers.length === 0) return null;
        // Tier by top 20% / mid 60% / bottom 20%
        const n = customers.length;
        const top20 = customers.slice(0, Math.ceil(n * 0.2));
        const mid60 = customers.slice(Math.ceil(n * 0.2), Math.ceil(n * 0.8));
        const bot20 = customers.slice(Math.ceil(n * 0.8));
        const tiers = [
          { label: currentLanguage==='tr'?'Platin (Top %20)':'Platinum (Top 20%)', customers: top20, color: 'text-purple-700', bg: 'bg-purple-50', border: 'border-purple-200' },
          { label: currentLanguage==='tr'?'Altın (Orta %60)':'Gold (Mid 60%)', customers: mid60, color: 'text-amber-700', bg: 'bg-amber-50', border: 'border-amber-200' },
          { label: currentLanguage==='tr'?'Gümüş (Alt %20)':'Silver (Bottom 20%)', customers: bot20, color: 'text-gray-600', bg: 'bg-gray-50', border: 'border-gray-200' },
        ];
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-4">{currentLanguage === 'tr' ? '💎 Müşteri LTV Segmentasyonu' : '💎 Customer LTV Segmentation'}</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {tiers.map(tier => {
                const tierLTV = tier.customers.reduce((s, c) => s + c.ltv, 0);
                return (
                  <div key={tier.label} className={`rounded-2xl border p-4 ${tier.bg} ${tier.border}`}>
                    <p className={`text-xs font-bold uppercase tracking-wide mb-2 ${tier.color}`}>{tier.label}</p>
                    <p className={`text-2xl font-black ${tier.color}`}>{tier.customers.length}</p>
                    <p className="text-[10px] text-gray-500 mt-0.5">{currentLanguage==='tr'?'müşteri':'customers'}</p>
                    <p className={`text-sm font-bold mt-2 ${tier.color}`}>{fmtAna(tierLTV,'K',1)}</p>
                    <p className="text-[10px] text-gray-500">{currentLanguage==='tr'?'toplam ciro':'total revenue'}</p>
                    {tier.customers.length > 0 && (
                      <div className="mt-2 pt-2 border-t border-white/60 space-y-0.5">
                        {tier.customers.slice(0, 3).map(c => (
                          <p key={c.name} className="text-[10px] text-gray-600 truncate">{c.name}</p>
                        ))}
                        {tier.customers.length > 3 && <p className="text-[10px] text-gray-400">+{tier.customers.length - 3} {currentLanguage==='tr'?'daha':'more'}</p>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 161: Order Cancellation Analysis ── */}
      {reportsTab === 'crm' && orders.filter(o => o.status === 'Cancelled').length > 0 && (() => {
        const cancelled = orders.filter(o => o.status === 'Cancelled');
        const total = orders.length;
        const cancelRate = Math.round((cancelled.length / total) * 100);
        const cancelledRevLost = cancelled.reduce((s, o) => s + (o.totalPrice || 0), 0);
        // Cancellations by customer
        const custCancelMap: Record<string, number> = {};
        for (const o of cancelled) {
          const name = o.customerName || '—';
          custCancelMap[name] = (custCancelMap[name] ?? 0) + 1;
        }
        const topCancellers = Object.entries(custCancelMap).sort(([,a],[,b]) => b - a).slice(0, 5);
        // Cancellations by month
        const now161 = new Date();
        const cancelByMonth: Record<string, number> = {};
        for (const o of cancelled) {
          try {
            const d = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
            const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
            cancelByMonth[key] = (cancelByMonth[key] ?? 0) + 1;
          } catch { /* skip */ }
        }
        void now161;
        return (
          <div className="apple-card p-6 border border-red-50">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '❌ İptal Analizi' : '❌ Cancellation Analysis'}</h3>
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${cancelRate >= 15 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                %{cancelRate} {currentLanguage==='tr'?'iptal oranı':'cancel rate'}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-3 mb-4">
              {[
                { label: currentLanguage==='tr'?'İptal Edilen':'Cancelled', value: cancelled.length, color: 'text-red-600' },
                { label: currentLanguage==='tr'?'İptal Oranı':'Cancel Rate', value: `%${cancelRate}`, color: cancelRate >= 15 ? 'text-red-600' : 'text-amber-600' },
                { label: currentLanguage==='tr'?'Kayıp Ciro':'Revenue Lost', value: `₺${(cancelledRevLost/1000).toFixed(1)}K`, color: 'text-red-500' },
              ].map(k => (
                <div key={k.label} className="bg-gray-50 rounded-xl p-3 text-center">
                  <p className={`text-lg font-bold ${k.color}`}>{k.value}</p>
                  <p className="text-[10px] text-gray-400">{k.label}</p>
                </div>
              ))}
            </div>
            {topCancellers.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-600 mb-2">{currentLanguage==='tr'?'En Çok İptal Eden Müşteriler':'Top Cancelling Customers'}</p>
                <div className="space-y-1.5">
                  {topCancellers.map(([name, count]) => (
                    <div key={name} className="flex items-center justify-between text-xs">
                      <span className="text-gray-700 truncate">{name}</span>
                      <span className="text-red-500 font-bold ml-2">{count}×</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* ── Phase 187: Churned Revenue (Month-over-Month Customer Loss) ── */}
      {reportsTab === 'crm' && orders.length >= 5 && (() => {
        const now187 = new Date();
        const prevMonthStart = new Date(now187.getFullYear(), now187.getMonth() - 1, 1);
        const prevMonthEnd = new Date(now187.getFullYear(), now187.getMonth(), 0, 23, 59, 59);
        const currMonthStart = new Date(now187.getFullYear(), now187.getMonth(), 1);
        const getDate187 = (o: Order) => {
          try { return (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string); }
          catch { return null; }
        };
        const prevCustomers = new Set<string>();
        const currCustomers = new Set<string>();
        const prevRevByCustomer: Record<string, number> = {};
        for (const o of orders) {
          if (o.status === 'Cancelled') continue;
          const d = getDate187(o);
          if (!d) continue;
          const name = o.customerName || '—';
          if (d >= prevMonthStart && d <= prevMonthEnd) {
            prevCustomers.add(name);
            prevRevByCustomer[name] = (prevRevByCustomer[name] ?? 0) + (o.totalPrice || 0);
          }
          if (d >= currMonthStart) currCustomers.add(name);
        }
        const churned = [...prevCustomers].filter(c => !currCustomers.has(c));
        const churnedRevLost = churned.reduce((s, c) => s + (prevRevByCustomer[c] ?? 0), 0);
        const newCustomers = [...currCustomers].filter(c => !prevCustomers.has(c));
        const churnRate = prevCustomers.size > 0 ? Math.round((churned.length / prevCustomers.size) * 100) : 0;
        if (churned.length === 0 && newCustomers.length === 0) return null;
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-1">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '📤 Müşteri Churn Analizi' : '📤 Customer Churn Analysis'}</h3>
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${churnRate >= 30 ? 'bg-red-100 text-red-700' : churnRate >= 15 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                %{churnRate} {currentLanguage === 'tr' ? 'churn' : 'churn rate'}
              </span>
            </div>
            <p className="text-[10px] text-gray-400 mb-4">{currentLanguage === 'tr' ? 'Önceki ay aktif → bu ay sipariş vermeyen müşteriler' : 'Active last month → no orders this month'}</p>
            <div className="grid grid-cols-3 gap-3 mb-4">
              {[
                { label: currentLanguage === 'tr' ? 'Kaybedilen' : 'Churned', value: churned.length, color: 'text-red-600' },
                { label: currentLanguage === 'tr' ? 'Kayıp Ciro' : 'Lost Revenue', value: `₺${(churnedRevLost/1000).toFixed(1)}K`, color: 'text-red-500' },
                { label: currentLanguage === 'tr' ? 'Yeni Müşteri' : 'New Customers', value: newCustomers.length, color: 'text-emerald-600' },
              ].map(k => (
                <div key={k.label} className="bg-gray-50 rounded-xl p-3 text-center">
                  <p className={`text-xl font-bold ${k.color}`}>{k.value}</p>
                  <p className="text-[10px] text-gray-500 mt-0.5">{k.label}</p>
                </div>
              ))}
            </div>
            {churned.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-700 mb-2">{currentLanguage === 'tr' ? 'Kaybedilen Müşteriler:' : 'Churned Customers:'}</p>
                <div className="space-y-1">
                  {churned.slice(0, 5).map(c => (
                    <div key={c} className="flex items-center justify-between text-xs py-1 border-b border-gray-50 last:border-0">
                      <span className="text-gray-700 truncate">{c}</span>
                      <span className="text-red-500 font-medium shrink-0 ml-2">-{fmtAna((prevRevByCustomer[c] ?? 0),'full',0)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* ── Phase 162: Inventory Shrinkage Report ── */}
      {reportsTab === 'envanter' && inventoryMovements.length > 0 && (() => {
        // Find items with negative adjustments (shrinkage/write-offs)
        type ShrinkItem = { name: string; qty: number; value: number };
        const shrinkMap: Record<string, ShrinkItem> = {};
        for (const mov of inventoryMovements) {
          const m = mov as unknown as Record<string, unknown>;
          const type = (m.type as string) || '';
          const qty = (m.quantity as number) || 0;
          const isNeg = type === 'adjustment' && qty < 0;
          const isWriteOff = type === 'write-off' || type === 'damage' || type === 'loss';
          if (!isNeg && !isWriteOff) continue;
          const pid = (m.productId as string) || (m.inventoryId as string) || '';
          const inv = inventory.find(i => i.id === pid || i.name === (m.productName as string));
          const name = inv?.name || (m.productName as string) || pid || '—';
          if (!shrinkMap[name]) shrinkMap[name] = { name, qty: 0, value: 0 };
          shrinkMap[name].qty += Math.abs(qty);
          shrinkMap[name].value += Math.abs(qty) * (inv ? itemCostTRY(inv, exchangeRates) : 0);
        }
        const shrinkItems = Object.values(shrinkMap).sort((a, b) => b.value - a.value).slice(0, 8);
        if (shrinkItems.length === 0) return null;
        const totalShrinkVal = shrinkItems.reduce((s, i) => s + i.value, 0);
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '📉 Fire & Kayıp Raporu' : '📉 Inventory Shrinkage Report'}</h3>
              <span className="text-xs text-red-600 font-semibold bg-red-50 px-2 py-0.5 rounded-full">
                {fmtAna(totalShrinkVal,'full',0)} {currentLanguage==='tr'?'toplam kayıp':'total loss'}
              </span>
            </div>
            <div className="space-y-2.5">
              {shrinkItems.map(item => (
                <div key={item.name} className="flex items-center justify-between py-1.5 border-b border-gray-50 last:border-0">
                  <span className="text-xs font-medium text-gray-800 truncate">{item.name}</span>
                  <div className="flex items-center gap-3 shrink-0 ml-2">
                    <span className="text-xs text-gray-500">{item.qty} {currentLanguage==='tr'?'adet':'units'}</span>
                    <span className="text-xs font-bold text-red-500">-{fmtAna(item.value,'full',0)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 182: Gross Profit Heatmap (Category × Month) ── */}
      {reportsTab === 'envanter' && orders.length >= 3 && inventory.length > 0 && (() => {
        const now182 = new Date();
        const cats182 = [...new Set(inventory.map(i => i.category).filter(Boolean))].slice(0, 5) as string[];
        if (cats182.length < 2) return null;
        const months182 = Array.from({ length: 6 }, (_, i) => {
          const d = new Date(now182.getFullYear(), now182.getMonth() - (5 - i), 1);
          return {
            label: d.toLocaleDateString(currentLanguage === 'tr' ? 'tr-TR' : 'en-US', { month: 'short' }),
            year: d.getFullYear(), month: d.getMonth(),
          };
        });
        // Build margin[cat][monthIdx]
        const heatmap: Record<string, number[]> = {};
        for (const c of cats182) heatmap[c] = Array(6).fill(null);
        for (let mi = 0; mi < months182.length; mi++) {
          const { year, month } = months182[mi];
          const mOrders = orders.filter(o => {
            if (o.status === 'Cancelled') return false;
            try {
              const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
              return od.getFullYear() === year && od.getMonth() === month;
            } catch { return false; }
          });
          for (const c of cats182) {
            let rev = 0; let cogs = 0;
            for (const o of mOrders) {
              for (const li of (o.lineItems ?? [])) {
                const inv = inventory.find(ii => ii.id === li.inventoryId || ii.name === li.name);
                if (!inv || inv.category !== c) continue;
                rev += li.price * li.quantity;
                cogs += itemCostTRY(inv, exchangeRates) * li.quantity;
              }
            }
            heatmap[c][mi] = rev > 0 ? Math.round(((rev - cogs) / rev) * 100) : -1;
          }
        }
        const cellColor = (m: number) => {
          if (m < 0) return 'bg-gray-50 text-gray-300';
          if (m >= 40) return 'bg-emerald-600 text-white';
          if (m >= 25) return 'bg-emerald-400 text-white';
          if (m >= 15) return 'bg-amber-300 text-gray-800';
          if (m >= 0) return 'bg-red-300 text-gray-800';
          return 'bg-gray-100 text-gray-400';
        };
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-4">{currentLanguage === 'tr' ? '🟩 Brüt Marj Isı Haritası (Kategori × Ay)' : '🟩 Gross Margin Heatmap (Category × Month)'}</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr>
                    <th className="text-left text-gray-500 font-medium pb-2 pr-3">{currentLanguage === 'tr' ? 'Kategori' : 'Category'}</th>
                    {months182.map(m => <th key={m.label} className="text-center text-gray-500 font-medium pb-2 px-1 min-w-[44px]">{m.label}</th>)}
                  </tr>
                </thead>
                <tbody className="space-y-1">
                  {cats182.map(c => (
                    <tr key={c}>
                      <td className="text-gray-700 font-medium py-1 pr-3 truncate max-w-[100px]">{c}</td>
                      {heatmap[c].map((val, mi) => (
                        <td key={mi} className="py-1 px-0.5 text-center">
                          <span className={`inline-block rounded-md px-1.5 py-1 font-bold text-[10px] w-full ${cellColor(val)}`}>
                            {val >= 0 ? `%${val}` : '—'}
                          </span>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center gap-3 mt-3 flex-wrap">
              {[
                { cls: 'bg-emerald-600', label: '≥40%' },
                { cls: 'bg-emerald-400', label: '25-40%' },
                { cls: 'bg-amber-300', label: '15-25%' },
                { cls: 'bg-red-300', label: '<15%' },
                { cls: 'bg-gray-50 border border-gray-200', label: currentLanguage === 'tr' ? 'Veri yok' : 'No data' },
              ].map(l => (
                <div key={l.label} className="flex items-center gap-1">
                  <span className={`w-3 h-3 rounded-sm ${l.cls}`} />
                  <span className="text-[10px] text-gray-500">{l.label}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 183: Supplier Concentration Risk ── */}
      {reportsTab === 'envanter' && inventory.length > 0 && (() => {
        const suppMap183: Record<string, { value: number; items: number }> = {};
        for (const item of inventory) {
          const supp = item.supplier?.trim() || (currentLanguage === 'tr' ? 'Bilinmiyor' : 'Unknown');
          const val = itemCostTRY(item, exchangeRates) * (item.stockLevel ?? 0);
          if (!suppMap183[supp]) suppMap183[supp] = { value: 0, items: 0 };
          suppMap183[supp].value += val;
          suppMap183[supp].items++;
        }
        const suppList183 = Object.entries(suppMap183)
          .map(([name, d]) => ({ name, ...d }))
          .sort((a, b) => b.value - a.value)
          .slice(0, 8);
        if (suppList183.length < 2) return null;
        const totalVal183 = suppList183.reduce((s, s2) => s + s2.value, 0);
        const top1Pct = totalVal183 > 0 ? Math.round((suppList183[0].value / totalVal183) * 100) : 0;
        const top3Pct = totalVal183 > 0 ? Math.round((suppList183.slice(0, 3).reduce((s, s2) => s + s2.value, 0) / totalVal183) * 100) : 0;
        const riskLevel = top1Pct >= 60 ? 'high' : top1Pct >= 40 ? 'medium' : 'low';
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-1">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '🔗 Tedarikçi Konsantrasyon Riski' : '🔗 Supplier Concentration Risk'}</h3>
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${riskLevel === 'high' ? 'bg-red-100 text-red-700' : riskLevel === 'medium' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                {riskLevel === 'high' ? (currentLanguage === 'tr' ? 'Yüksek Risk' : 'High Risk') : riskLevel === 'medium' ? (currentLanguage === 'tr' ? 'Orta Risk' : 'Med Risk') : (currentLanguage === 'tr' ? 'Düşük Risk' : 'Low Risk')}
              </span>
            </div>
            <p className="text-[10px] text-gray-400 mb-4">{currentLanguage === 'tr' ? 'Stok değerine göre tedarikçi dağılımı' : 'Supplier distribution by inventory value'}</p>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="bg-gray-50 rounded-xl p-3 text-center">
                <p className={`text-2xl font-black ${top1Pct >= 60 ? 'text-red-500' : top1Pct >= 40 ? 'text-amber-500' : 'text-emerald-600'}`}>%{top1Pct}</p>
                <p className="text-[10px] text-gray-500 mt-0.5">{currentLanguage === 'tr' ? 'En büyük tedarikçi' : 'Top supplier share'}</p>
              </div>
              <div className="bg-gray-50 rounded-xl p-3 text-center">
                <p className={`text-2xl font-black ${top3Pct >= 80 ? 'text-amber-500' : 'text-blue-600'}`}>%{top3Pct}</p>
                <p className="text-[10px] text-gray-500 mt-0.5">{currentLanguage === 'tr' ? 'İlk 3 tedarikçi' : 'Top 3 suppliers'}</p>
              </div>
            </div>
            <div className="space-y-2">
              {suppList183.map(s => {
                const pct = totalVal183 > 0 ? Math.round((s.value / totalVal183) * 100) : 0;
                return (
                  <div key={s.name}>
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-xs font-medium text-gray-700 truncate">{s.name}</span>
                      <div className="flex items-center gap-2 shrink-0 ml-2">
                        <span className="text-[10px] text-gray-400">{s.items} {currentLanguage === 'tr' ? 'ürün' : 'items'}</span>
                        <span className="text-xs font-bold text-gray-700">%{pct}</span>
                      </div>
                    </div>
                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${pct >= 40 ? 'bg-red-400' : pct >= 20 ? 'bg-amber-400' : 'bg-blue-400'}`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
            {top1Pct >= 40 && (
              <div className="mt-4 p-3 bg-amber-50 rounded-xl border border-amber-100">
                <p className="text-xs text-amber-700 font-medium">⚠️ {currentLanguage === 'tr' ? `"${suppList183[0].name}" tedarikçisi stok değerinin %${top1Pct}'ini oluşturuyor. Tedarik riski yüksek.` : `"${suppList183[0].name}" accounts for ${top1Pct}% of inventory value — high supply chain risk.`}</p>
              </div>
            )}
          </div>
        );
      })()}

      {/* ── Phase 184: Product Return Rate ── */}
      {reportsTab === 'envanter' && inventoryMovements.length > 0 && (() => {
        // Group return/adjustment movements per product
        const returnMap: Record<string, { name: string; returns: number; totalSold: number }> = {};
        for (const mov of inventoryMovements) {
          const m = mov as unknown as Record<string, unknown>;
          const type = (m.type as string) || '';
          if (!['return', 'sale-return', 'customer-return'].includes(type)) continue;
          const pid = (m.productId as string) || (m.inventoryId as string) || '';
          const inv = inventory.find(i => i.id === pid || i.name === (m.productName as string));
          const name = inv?.name || (m.productName as string) || pid || '?';
          if (!returnMap[name]) returnMap[name] = { name, returns: 0, totalSold: 0 };
          returnMap[name].returns += Math.abs((m.quantity as number) || 0);
        }
        // Total sold from sale movements
        for (const mov of inventoryMovements) {
          const m = mov as unknown as Record<string, unknown>;
          const type = (m.type as string) || '';
          if (type !== 'sale' && type !== 'out') continue;
          const pid = (m.productId as string) || (m.inventoryId as string) || '';
          const inv = inventory.find(i => i.id === pid || i.name === (m.productName as string));
          const name = inv?.name || (m.productName as string) || pid || '?';
          if (returnMap[name]) returnMap[name].totalSold += Math.abs((m.quantity as number) || 0);
        }
        const returnItems = Object.values(returnMap)
          .filter(r => r.returns > 0)
          .map(r => ({ ...r, rate: r.totalSold > 0 ? Math.round((r.returns / r.totalSold) * 100) : null }))
          .sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0))
          .slice(0, 6);
        if (returnItems.length === 0) return null;
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-4">{currentLanguage === 'tr' ? '↩️ Ürün İade Oranı' : '↩️ Product Return Rate'}</h3>
            <div className="space-y-2.5">
              {returnItems.map(item => (
                <div key={item.name} className="flex items-center justify-between py-1 border-b border-gray-50 last:border-0">
                  <span className="text-xs font-medium text-gray-800 truncate">{item.name}</span>
                  <div className="flex items-center gap-3 shrink-0 ml-2">
                    <span className="text-[10px] text-gray-500">{item.returns} {currentLanguage === 'tr' ? 'iade' : 'returns'}</span>
                    {item.rate !== null ? (
                      <span className={`text-xs font-bold ${item.rate >= 20 ? 'text-red-500' : item.rate >= 10 ? 'text-amber-500' : 'text-gray-600'}`}>%{item.rate}</span>
                    ) : (
                      <span className="text-xs text-gray-400">—</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-gray-400 mt-3">{currentLanguage === 'tr' ? 'İade/Satış oranı — %10+ yüksek risk' : 'Return/Sales ratio — 10%+ is high risk'}</p>
          </div>
        );
      })()}

      {/* ── Phase 166: Monthly Gross Margin Trend ── */}
      {reportsTab === 'genel' && orders.length >= 3 && inventory.length > 0 && (() => {
        const now166 = new Date();
        const months166 = Array.from({ length: 6 }, (_, i) => {
          const d = new Date(now166.getFullYear(), now166.getMonth() - (5 - i), 1);
          const label = d.toLocaleDateString(currentLanguage === 'tr' ? 'tr-TR' : 'en-US', { month: 'short' });
          const mOrders = orders.filter(o => {
            if (o.status === 'Cancelled') return false;
            try {
              const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
              return od.getFullYear() === d.getFullYear() && od.getMonth() === d.getMonth();
            } catch { return false; }
          });
          const rev = mOrders.reduce((s, o) => s + (o.totalPrice || 0), 0);
          const cogs = mOrders.reduce((s, o) =>
            s + (o.lineItems ?? []).reduce((ls, li) => {
              const inv = inventory.find(ii => ii.id === li.inventoryId || ii.name === li.name);
              return ls + ((inv ? itemCostTRY(inv, exchangeRates) : li.price * 0.6) * li.quantity);
            }, 0), 0);
          const margin = rev > 0 ? Math.round(((rev - cogs) / rev) * 100) : 0;
          return { label, rev, cogs, margin };
        });
        const avgMargin = months166.filter(m => m.rev > 0).length > 0
          ? Math.round(months166.filter(m => m.rev > 0).reduce((s, m) => s + m.margin, 0) / months166.filter(m => m.rev > 0).length)
          : 0;
        const maxRev166 = Math.max(...months166.map(m => m.rev), 1);
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '📈 Aylık Brüt Marj Trendi' : '📈 Monthly Gross Margin Trend'}</h3>
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${avgMargin >= 30 ? 'bg-emerald-100 text-emerald-700' : avgMargin >= 15 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-600'}`}>
                Ø %{avgMargin}
              </span>
            </div>
            <div className="flex items-end gap-3 h-28 mb-3">
              {months166.map((m, i) => {
                const revH = Math.round((m.rev / maxRev166) * 100);
                const cogsH = m.rev > 0 ? Math.round((m.cogs / m.rev) * revH) : 0;
                const gpH = Math.max(revH - cogsH, 0);
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1 group cursor-default">
                    <div className="w-full flex flex-col justify-end overflow-hidden rounded-t-md" style={{ height: '88px' }}>
                      <div className="w-full" style={{ height: `${revH}%` }}>
                        <div className="w-full bg-blue-100 rounded-t-md" style={{ height: `${cogsH > 0 ? (cogsH/revH)*100 : 0}%` }} />
                        <div className="w-full bg-emerald-400" style={{ height: `${gpH > 0 ? (gpH/revH)*100 : 0}%` }} />
                      </div>
                    </div>
                    <span className="text-[9px] text-gray-400">{m.label}</span>
                    <span className={`text-[9px] font-bold ${m.margin >= 30 ? 'text-emerald-600' : m.margin >= 15 ? 'text-amber-600' : 'text-red-500'}`}>%{m.margin}</span>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center gap-4 text-[10px] text-gray-500">
              <span className="flex items-center gap-1"><span className="w-3 h-2 bg-emerald-400 rounded-sm inline-block" />{currentLanguage==='tr'?'Brüt Kâr':'Gross Profit'}</span>
              <span className="flex items-center gap-1"><span className="w-3 h-2 bg-blue-100 rounded-sm inline-block" />{currentLanguage==='tr'?'Maliyet':'COGS'}</span>
            </div>
          </div>
        );
      })()}

      {/* ── Phase 156: Quarter-over-Quarter Revenue Comparison ── */}
      {reportsTab === 'genel' && orders.length >= 5 && (() => {
        const now156 = new Date();
        const getQuarter = (d: Date) => Math.floor(d.getMonth() / 3);
        const getQLabel = (year: number, q: number) => `Q${q + 1} ${year}`;
        // Last 4 quarters
        const quarters: { label: string; year: number; q: number; revenue: number; orders: number }[] = [];
        for (let i = 3; i >= 0; i--) {
          const qDate = new Date(now156.getFullYear(), now156.getMonth() - i * 3, 1);
          const year = qDate.getFullYear();
          const q = getQuarter(qDate);
          quarters.push({ label: getQLabel(year, q), year, q, revenue: 0, orders: 0 });
        }
        for (const o of orders) {
          if (o.status === 'Cancelled') continue;
          try {
            const d = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
            const oq = getQuarter(d);
            const entry = quarters.find(qt => qt.year === d.getFullYear() && qt.q === oq);
            if (entry) { entry.revenue += o.totalPrice || 0; entry.orders++; }
          } catch { /* skip */ }
        }
        const maxQ = Math.max(...quarters.map(q => q.revenue), 1);
        const currQ = quarters[quarters.length - 1];
        const prevQ = quarters[quarters.length - 2];
        const growth = prevQ.revenue > 0 ? Math.round(((currQ.revenue - prevQ.revenue) / prevQ.revenue) * 100) : null;
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '📊 Çeyrek Bazlı Karşılaştırma' : '📊 Quarter-over-Quarter Revenue'}</h3>
              {growth !== null && (
                <span className={`text-sm font-bold px-2 py-0.5 rounded-full ${growth >= 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                  {growth >= 0 ? '↑' : '↓'} %{Math.abs(growth)} QoQ
                </span>
              )}
            </div>
            <div className="flex items-end gap-4 h-36 mb-3">
              {quarters.map((q, i) => {
                const h = Math.round((q.revenue / maxQ) * 100);
                const isLatest = i === quarters.length - 1;
                return (
                  <div key={q.label} className="flex-1 flex flex-col items-center gap-1">
                    <span className="text-[10px] font-semibold text-gray-600 tabular-nums">{fmtAna(q.revenue,'K',0)}</span>
                    <div className="w-full flex flex-col justify-end" style={{ height: '96px' }}>
                      <div className={`w-full rounded-t-xl transition-all duration-700 ${isLatest ? 'bg-brand' : 'bg-brand/30'}`}
                        style={{ height: `${Math.max(h, 3)}%` }} />
                    </div>
                    <span className={`text-[10px] font-bold ${isLatest ? 'text-brand' : 'text-gray-400'}`}>{q.label}</span>
                    <span className="text-[9px] text-gray-400">{q.orders} {currentLanguage==='tr'?'sip':'ord'}</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 190: Revenue Forecast (Linear Trend) ── */}
      {reportsTab === 'genel' && orders.length >= 6 && (() => {
        const now190 = new Date();
        // Last 6 months revenue
        const months190 = Array.from({ length: 6 }, (_, i) => {
          const d = new Date(now190.getFullYear(), now190.getMonth() - (5 - i), 1);
          const rev = orders.filter(o => {
            if (o.status === 'Cancelled') return false;
            try {
              const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
              return od.getFullYear() === d.getFullYear() && od.getMonth() === d.getMonth();
            } catch { return false; }
          }).reduce((s, o) => s + (o.totalPrice || 0), 0);
          return { x: i, rev };
        });
        // Simple linear regression
        const n = months190.length;
        const sumX = months190.reduce((s, m) => s + m.x, 0);
        const sumY = months190.reduce((s, m) => s + m.rev, 0);
        const sumXY = months190.reduce((s, m) => s + m.x * m.rev, 0);
        const sumX2 = months190.reduce((s, m) => s + m.x * m.x, 0);
        const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX || 1);
        const intercept = (sumY - slope * sumX) / n;
        const forecast = [1, 2, 3].map(f => ({
          label: new Date(now190.getFullYear(), now190.getMonth() + f, 1)
            .toLocaleDateString(currentLanguage === 'tr' ? 'tr-TR' : 'en-US', { month: 'short', year: '2-digit' }),
          rev: Math.max(0, Math.round(slope * (n - 1 + f) + intercept)),
        }));
        const maxForecast = Math.max(...months190.map(m => m.rev), ...forecast.map(f => f.rev), 1);
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '🔮 Gelir Tahmini (3 Ay)' : '🔮 Revenue Forecast (3 Month)'}</h3>
              <span className="text-[10px] text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{currentLanguage === 'tr' ? 'Doğrusal trend' : 'Linear trend model'}</span>
            </div>
            <div className="flex items-end gap-1.5 h-28 mb-3">
              {months190.map((m, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <div className="w-full flex items-end justify-center" style={{ height: '80px' }}>
                    <div className="w-full bg-blue-300 rounded-t-md" style={{ height: `${Math.max(4, Math.round((m.rev / maxForecast) * 80))}px` }} />
                  </div>
                </div>
              ))}
              {forecast.map((f, i) => (
                <div key={`f${i}`} className="flex-1 flex flex-col items-center gap-1">
                  <div className="w-full flex items-end justify-center" style={{ height: '80px' }}>
                    <div className="w-full bg-emerald-300 rounded-t-md border-2 border-dashed border-emerald-500" style={{ height: `${Math.max(4, Math.round((f.rev / maxForecast) * 80))}px` }} />
                  </div>
                  <span className="text-[8px] text-emerald-600 font-bold leading-none">{f.label}</span>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-2">
              {forecast.map(f => (
                <div key={f.label} className="bg-emerald-50 rounded-xl p-3 text-center">
                  <p className="text-xs font-bold text-emerald-700">{f.label}</p>
                  <p className="text-lg font-black text-emerald-700">{fmtAna(f.rev,'K',0)}</p>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-gray-400 mt-2">{currentLanguage === 'tr' ? 'Tahmini değerler son 6 ayın doğrusal trendine dayanmaktadır.' : 'Forecasts based on linear trend of last 6 months. Indicative only.'}</p>
          </div>
        );
      })()}

      {/* ── Phase 191: Inventory ABC Analysis ── */}
      {reportsTab === 'envanter' && inventory.length >= 3 && orders.length >= 3 && (() => {
        // Compute revenue per product
        const prodRev: Record<string, { name: string; rev: number }> = {};
        for (const o of orders) {
          if (o.status === 'Cancelled') continue;
          for (const li of (o.lineItems ?? [])) {
            const key = li.inventoryId || li.name || li.sku || '?';
            const name = li.name || key;
            if (!prodRev[key]) prodRev[key] = { name, rev: 0 };
            prodRev[key].rev += li.price * li.quantity;
          }
        }
        const sorted = Object.values(prodRev).sort((a, b) => b.rev - a.rev);
        if (sorted.length < 3) return null;
        const totalRev191 = sorted.reduce((s, p) => s + p.rev, 0);
        let cumRev = 0;
        const withClass = sorted.map(p => {
          cumRev += p.rev;
          const cumPct = totalRev191 > 0 ? (cumRev / totalRev191) * 100 : 0;
          const cls = cumPct <= 80 ? 'A' : cumPct <= 95 ? 'B' : 'C';
          return { ...p, cls, pct: totalRev191 > 0 ? Math.round((p.rev / totalRev191) * 100) : 0 };
        });
        const counts = { A: withClass.filter(p => p.cls === 'A').length, B: withClass.filter(p => p.cls === 'B').length, C: withClass.filter(p => p.cls === 'C').length };
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '🅰️ Stok ABC Analizi' : '🅰️ Inventory ABC Analysis'}</h3>
              <div className="flex items-center gap-1.5">
                {(['A','B','C'] as const).map(c => (
                  <span key={c} className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${c === 'A' ? 'bg-emerald-100 text-emerald-700' : c === 'B' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'}`}>{c}: {counts[c]}</span>
                ))}
              </div>
            </div>
            <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
              {withClass.slice(0, 15).map((p, i) => (
                <div key={p.name} className="flex items-center gap-2">
                  <span className={`w-5 h-5 rounded text-[10px] font-black flex items-center justify-center shrink-0 ${p.cls === 'A' ? 'bg-emerald-500 text-white' : p.cls === 'B' ? 'bg-amber-400 text-white' : 'bg-gray-300 text-gray-700'}`}>{p.cls}</span>
                  <span className="text-[10px] text-gray-400 w-5 shrink-0">#{i+1}</span>
                  <span className="text-xs text-gray-700 truncate flex-1">{p.name}</span>
                  <span className="text-xs font-bold text-gray-700 shrink-0">%{p.pct}</span>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-gray-400 mt-3">{currentLanguage === 'tr' ? 'A=Cironun %80\'i, B=%15, C=%5. Satış gelirine göre sınıflandırma.' : 'A=80% of revenue, B=15%, C=5%. Classified by sales revenue.'}</p>
          </div>
        );
      })()}

      {/* ── Phase 192: Customer RFM Segmentation ── */}
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

      {/* ── Phase 193: Profit by Customer ── */}
      {reportsTab === 'crm' && orders.length >= 3 && inventory.length > 0 && (() => {
        const custProfit: Record<string, { rev: number; cogs: number }> = {};
        for (const o of orders) {
          if (o.status === 'Cancelled') continue;
          const name = o.customerName || '—';
          if (!custProfit[name]) custProfit[name] = { rev: 0, cogs: 0 };
          custProfit[name].rev += o.totalPrice || 0;
          for (const li of (o.lineItems ?? [])) {
            const inv = inventory.find(ii => ii.id === li.inventoryId || ii.name === li.name);
            custProfit[name].cogs += (inv ? itemCostTRY(inv, exchangeRates) : li.price * 0.6) * li.quantity;
          }
        }
        const profitList = Object.entries(custProfit)
          .map(([name, d]) => ({ name, rev: d.rev, cogs: d.cogs, profit: d.rev - d.cogs, margin: d.rev > 0 ? Math.round(((d.rev - d.cogs) / d.rev) * 100) : 0 }))
          .sort((a, b) => b.profit - a.profit)
          .slice(0, 8);
        if (profitList.length < 2) return null;
        const maxProfit = Math.max(...profitList.map(p => p.profit), 1);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-4">{currentLanguage === 'tr' ? '💹 Müşteri Bazlı Kâr Analizi' : '💹 Profit by Customer'}</h3>
            <div className="space-y-2.5">
              {profitList.map(p => (
                <div key={p.name}>
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-xs font-medium text-gray-700 truncate">{p.name}</span>
                    <div className="flex items-center gap-2 shrink-0 ml-2">
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${p.margin >= 30 ? 'bg-emerald-100 text-emerald-700' : p.margin >= 15 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-600'}`}>%{p.margin}</span>
                      <span className="text-xs font-bold text-gray-700">{fmtAna(p.profit,'K',0)}</span>
                    </div>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${p.margin >= 30 ? 'bg-emerald-400' : p.margin >= 15 ? 'bg-amber-400' : 'bg-red-400'}`} style={{ width: `${Math.max(4, Math.round((p.profit / maxProfit) * 100))}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 194: Seasonal Demand YoY Comparison ── */}
      {reportsTab === 'envanter' && orders.length >= 10 && (() => {
        const now194 = new Date();
        const thisMonth = now194.getMonth();
        const currYear = now194.getFullYear();
        const prevYear = currYear - 1;
        // Compare last 6 months this year vs same months last year
        const periods = Array.from({ length: 6 }, (_, i) => {
          const month = (thisMonth - 5 + i + 12) % 12;
          const cYear = thisMonth - 5 + i < 0 ? currYear - 1 : currYear;
          const pYear = cYear - 1;
          const label = new Date(cYear, month, 1).toLocaleDateString(currentLanguage === 'tr' ? 'tr-TR' : 'en-US', { month: 'short' });
          const curr = orders.filter(o => {
            if (o.status === 'Cancelled') return false;
            try {
              const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
              return od.getFullYear() === cYear && od.getMonth() === month;
            } catch { return false; }
          }).reduce((s, o) => s + (o.totalPrice || 0), 0);
          const prev = orders.filter(o => {
            if (o.status === 'Cancelled') return false;
            try {
              const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
              return od.getFullYear() === pYear && od.getMonth() === month;
            } catch { return false; }
          }).reduce((s, o) => s + (o.totalPrice || 0), 0);
          return { label, curr, prev, yoy: prev > 0 ? Math.round(((curr - prev) / prev) * 100) : null };
        });
        const hasPrevYear = periods.some(p => p.prev > 0);
        if (!hasPrevYear) return null;
        const maxVal = Math.max(...periods.map(p => Math.max(p.curr, p.prev)), 1);
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '📅 Yıllık Mevsimsel Karşılaştırma' : '📅 Year-over-Year Seasonal'}</h3>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1"><div className="w-3 h-2 rounded-sm bg-blue-400" /><span className="text-[10px] text-gray-500">{currYear}</span></div>
                <div className="flex items-center gap-1"><div className="w-3 h-2 rounded-sm bg-gray-300" /><span className="text-[10px] text-gray-500">{prevYear}</span></div>
              </div>
            </div>
            <div className="flex items-end gap-2 h-28 mb-2">
              {periods.map((p, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                  <div className="w-full flex items-end gap-0.5" style={{ height: '80px' }}>
                    <div className="flex-1 bg-blue-400 rounded-t-sm" style={{ height: `${Math.max(2, Math.round((p.curr / maxVal) * 80))}px` }} />
                    <div className="flex-1 bg-gray-200 rounded-t-sm" style={{ height: `${Math.max(2, Math.round((p.prev / maxVal) * 80))}px` }} />
                  </div>
                  <span className="text-[8px] text-gray-400 leading-none">{p.label}</span>
                  {p.yoy !== null && (
                    <span className={`text-[8px] font-bold leading-none ${p.yoy >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>{p.yoy >= 0 ? '+' : ''}{p.yoy}%</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 195: Order Fulfillment Rate ── */}
      {reportsTab === 'lojistik' && orders.length >= 5 && (() => {
        const now195 = new Date();
        const last90 = new Date(now195); last90.setDate(last90.getDate() - 90);
        const recent = orders.filter(o => {
          try {
            const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
            return od >= last90;
          } catch { return false; }
        });
        const totalOrders195 = recent.length;
        const delivered = recent.filter(o => o.status === 'Delivered').length;
        const cancelled = recent.filter(o => o.status === 'Cancelled').length;
        const inProgress = recent.filter(o => o.status === 'Processing' || o.status === 'Shipped').length;
        const pending = recent.filter(o => o.status === 'Pending').length;
        const fulfillRate = totalOrders195 > 0 ? Math.round((delivered / totalOrders195) * 100) : 0;
        const cancelRate195 = totalOrders195 > 0 ? Math.round((cancelled / totalOrders195) * 100) : 0;
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '✅ Sipariş Karşılama Oranı (Son 90 Gün)' : '✅ Order Fulfillment Rate (Last 90 Days)'}</h3>
              <span className={`text-lg font-black ${fulfillRate >= 80 ? 'text-emerald-600' : fulfillRate >= 60 ? 'text-amber-500' : 'text-red-500'}`}>%{fulfillRate}</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              {[
                { label: currentLanguage === 'tr' ? 'Toplam' : 'Total', value: totalOrders195, color: 'text-gray-700' },
                { label: currentLanguage === 'tr' ? 'Teslim' : 'Delivered', value: delivered, color: 'text-emerald-600' },
                { label: currentLanguage === 'tr' ? 'Süreçte' : 'In Progress', value: inProgress + pending, color: 'text-blue-600' },
                { label: currentLanguage === 'tr' ? 'İptal' : 'Cancelled', value: cancelled, color: 'text-red-500' },
              ].map(k => (
                <div key={k.label} className="bg-gray-50 rounded-xl p-3 text-center">
                  <p className={`text-2xl font-bold ${k.color}`}>{k.value}</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">{k.label}</p>
                </div>
              ))}
            </div>
            <div className="h-3 bg-gray-100 rounded-full overflow-hidden flex gap-0.5">
              <div className="h-full bg-emerald-400 rounded-l-full" style={{ width: `${Math.round((delivered / Math.max(totalOrders195, 1)) * 100)}%` }} />
              <div className="h-full bg-blue-300" style={{ width: `${Math.round(((inProgress + pending) / Math.max(totalOrders195, 1)) * 100)}%` }} />
              <div className="h-full bg-red-300 rounded-r-full" style={{ width: `${Math.round((cancelled / Math.max(totalOrders195, 1)) * 100)}%` }} />
            </div>
            <p className="text-[10px] text-gray-400 mt-2">{currentLanguage === 'tr' ? `İptal oranı: %${cancelRate195}` : `Cancel rate: ${cancelRate195}%`}</p>
          </div>
        );
      })()}

      {/* ── Phase 196: Sales Rep Leaderboard ── */}
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

      {/* ── Phase 197: Average Order Cycle Time ── */}
      {reportsTab === 'genel' && orders.filter(o => o.status === 'Delivered').length >= 3 && (() => {
        const delivered197 = orders.filter(o => {
          if (o.status !== 'Delivered') return false;
          const m = o as unknown as Record<string,unknown>;
          return !!(m.deliveredAt || m.updatedAt);
        });
        if (delivered197.length < 3) return null;
        const cycleTimes = delivered197.map(o => {
          const m = o as unknown as Record<string,unknown>;
          try {
            const created = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
            const delivered = ((m.deliveredAt as { toDate?: () => Date })?.toDate?.() ?? new Date(m.deliveredAt as string))
              || ((m.updatedAt as { toDate?: () => Date })?.toDate?.() ?? new Date(m.updatedAt as string));
            const days = Math.round((delivered.getTime() - created.getTime()) / 86400000);
            return days >= 0 && days < 365 ? days : null;
          } catch { return null; }
        }).filter((d): d is number => d !== null);
        if (cycleTimes.length < 3) return null;
        const avgCycle = Math.round(cycleTimes.reduce((s, d) => s + d, 0) / cycleTimes.length);
        const minCycle = Math.min(...cycleTimes);
        const maxCycle = Math.max(...cycleTimes);
        // Distribution buckets
        const buckets197 = [
          { label: currentLanguage === 'tr' ? '≤1 gün' : '≤1d', max: 1, count: 0 },
          { label: '2-3', max: 3, count: 0 },
          { label: '4-7', max: 7, count: 0 },
          { label: '8-14', max: 14, count: 0 },
          { label: '15+', max: Infinity, count: 0 },
        ];
        for (const d of cycleTimes) {
          const b = buckets197.find(b => d <= b.max);
          if (b) b.count++;
        }
        const maxBucket197 = Math.max(...buckets197.map(b => b.count), 1);
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '⏳ Ortalama Sipariş Teslim Süresi' : '⏳ Avg Order Cycle Time'}</h3>
              <span className="text-2xl font-black text-blue-600">{avgCycle} {currentLanguage === 'tr' ? 'gün' : 'd'}</span>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="bg-emerald-50 rounded-xl p-3 text-center">
                <p className="text-xl font-bold text-emerald-600">{minCycle} {currentLanguage === 'tr' ? 'gün' : 'd'}</p>
                <p className="text-[10px] text-gray-500">{currentLanguage === 'tr' ? 'En hızlı' : 'Fastest'}</p>
              </div>
              <div className="bg-red-50 rounded-xl p-3 text-center">
                <p className="text-xl font-bold text-red-500">{maxCycle} {currentLanguage === 'tr' ? 'gün' : 'd'}</p>
                <p className="text-[10px] text-gray-500">{currentLanguage === 'tr' ? 'En yavaş' : 'Slowest'}</p>
              </div>
            </div>
            <div className="flex items-end gap-2 h-16">
              {buckets197.map(b => (
                <div key={b.label} className="flex-1 flex flex-col items-center gap-1">
                  <div className="w-full flex items-end" style={{ height: '44px' }}>
                    <div className="w-full bg-blue-300 rounded-t-md" style={{ height: `${Math.max(4, Math.round((b.count / maxBucket197) * 44))}px` }} />
                  </div>
                  <span className="text-[9px] text-gray-400 leading-none">{b.label}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 198: Monthly Average Order Value Trend ── */}
      {reportsTab === 'genel' && orders.length >= 6 && (() => {
        const now198 = new Date();
        const months198 = Array.from({ length: 6 }, (_, i) => {
          const d = new Date(now198.getFullYear(), now198.getMonth() - (5 - i), 1);
          const label = d.toLocaleDateString(currentLanguage === 'tr' ? 'tr-TR' : 'en-US', { month: 'short' });
          const mOrds = orders.filter(o => {
            if (o.status === 'Cancelled') return false;
            try {
              const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
              return od.getFullYear() === d.getFullYear() && od.getMonth() === d.getMonth();
            } catch { return false; }
          });
          const aov = mOrds.length > 0 ? Math.round(mOrds.reduce((s, o) => s + (o.totalPrice || 0), 0) / mOrds.length) : 0;
          return { label, aov, count: mOrds.length };
        });
        const hasData = months198.some(m => m.aov > 0);
        if (!hasData) return null;
        const maxAOV = Math.max(...months198.map(m => m.aov), 1);
        const currAOV = months198[months198.length - 1].aov;
        const prevAOV = months198[months198.length - 2].aov;
        const aovGrowth = prevAOV > 0 ? Math.round(((currAOV - prevAOV) / prevAOV) * 100) : null;
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '🛒 Ortalama Sipariş Değeri Trendi' : '🛒 Avg Order Value Trend'}</h3>
              {aovGrowth !== null && (
                <span className={`text-sm font-bold px-2 py-0.5 rounded-full ${aovGrowth >= 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                  {aovGrowth >= 0 ? '↑' : '↓'} %{Math.abs(aovGrowth)} MoM
                </span>
              )}
            </div>
            <div className="flex items-end gap-3 h-24 mb-3">
              {months198.map((m, i) => {
                const isLatest = i === months198.length - 1;
                return (
                  <div key={m.label} className="flex-1 flex flex-col items-center gap-1">
                    <div className="w-full flex flex-col items-center" style={{ height: '72px' }}>
                      {m.aov > 0 && <span className={`text-[9px] font-bold ${isLatest ? 'text-brand' : 'text-gray-500'}`}>{fmtAna(m.aov,'K',1)}</span>}
                      <div className="w-full flex items-end mt-auto" style={{ height: '52px' }}>
                        <div className={`w-full rounded-t-md ${isLatest ? 'bg-brand' : 'bg-gray-200'}`} style={{ height: `${Math.max(4, Math.round((m.aov / maxAOV) * 52))}px` }} />
                      </div>
                    </div>
                    <span className={`text-[9px] ${isLatest ? 'font-bold text-brand' : 'text-gray-400'}`}>{m.label}</span>
                  </div>
                );
              })}
            </div>
            <p className="text-[10px] text-gray-400">{currentLanguage === 'tr' ? `Bu ay: ₺${currAOV.toLocaleString()} ortalama sipariş değeri · ${months198[months198.length-1].count} sipariş` : `This month: ₺${currAOV.toLocaleString()} AOV · ${months198[months198.length-1].count} orders`}</p>
          </div>
        );
      })()}

      {/* ── Phase 199: Dead Stock Alert ── */}
      {reportsTab === 'envanter' && inventory.length > 0 && orders.length > 0 && (() => {
        const now199 = new Date();
        const cutoff199 = new Date(now199); cutoff199.setDate(cutoff199.getDate() - 60);
        // Products sold in last 60 days
        const soldRecently = new Set<string>();
        for (const o of orders) {
          if (o.status === 'Cancelled') continue;
          try {
            const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
            if (od < cutoff199) continue;
            for (const li of (o.lineItems ?? [])) {
              soldRecently.add(li.inventoryId || li.name || li.sku || '');
            }
          } catch { /* skip */ }
        }
        const deadStock = inventory.filter(i =>
          (i.stockLevel ?? 0) > 0 &&
          !soldRecently.has(i.id) &&
          !soldRecently.has(i.name) &&
          !soldRecently.has(i.sku || '')
        ).map(i => ({
          name: i.name,
          stock: i.stockLevel ?? 0,
          value: (i.stockLevel ?? 0) * itemCostTRY(i, exchangeRates),
          category: i.category ?? '—',
        })).sort((a, b) => b.value - a.value).slice(0, 8);
        if (deadStock.length === 0) return null;
        const totalDeadVal = deadStock.reduce((s, i) => s + i.value, 0);
        return (
          <div className="apple-card p-6 border border-orange-100">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '💤 Ölü Stok Alarmı (60 Gün Satışsız)' : '💤 Dead Stock Alert (60 Days No Sales)'}</h3>
              <span className="text-xs font-bold text-orange-700 bg-orange-50 px-2 py-0.5 rounded-full">
                {fmtAna(totalDeadVal,'K',0)} {currentLanguage === 'tr' ? 'hareketsiz' : 'idle'}
              </span>
            </div>
            <div className="space-y-2">
              {deadStock.map(item => (
                <div key={item.name} className="flex items-center justify-between py-1.5 border-b border-gray-50 last:border-0">
                  <div>
                    <p className="text-xs font-medium text-gray-800">{item.name}</p>
                    <p className="text-[10px] text-gray-400">{item.category} · {item.stock} {currentLanguage === 'tr' ? 'adet' : 'units'}</p>
                  </div>
                  <span className="text-xs font-bold text-orange-600 shrink-0 ml-2">{fmtAna(item.value,'full',0)}</span>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-gray-400 mt-3">{currentLanguage === 'tr' ? 'Son 60 günde satış hareketi olmayan ve stoku bulunan ürünler.' : 'Items with stock but no sales movement in last 60 days.'}</p>
          </div>
        );
      })()}

      {/* ── Phase 200: Monthly New vs Repeat Customer Revenue ── */}
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

      {/* ── Phase 201: Inventory Reorder Point Calculator ── */}
      {reportsTab === 'envanter' && inventory.length > 0 && orders.length >= 5 && (() => {
        const now201 = new Date();
        const days201 = 30;
        const cutoff201 = new Date(now201); cutoff201.setDate(cutoff201.getDate() - days201);
        const LEAD_TIME_DAYS = 7;
        // Daily demand per product
        const dailyDemand: Record<string, number> = {};
        for (const o of orders) {
          if (o.status === 'Cancelled') continue;
          try {
            const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
            if (od < cutoff201) continue;
            for (const li of (o.lineItems ?? [])) {
              const key = li.inventoryId || li.name || '';
              if (!key) continue;
              dailyDemand[key] = (dailyDemand[key] ?? 0) + li.quantity / days201;
            }
          } catch { /* skip */ }
        }
        const reorderItems = inventory
          .map(i => {
            const demand = dailyDemand[i.id] ?? dailyDemand[i.name] ?? dailyDemand[i.sku || ''] ?? 0;
            if (demand <= 0) return null;
            const reorderPoint = Math.ceil(demand * LEAD_TIME_DAYS * 1.5); // 1.5x safety stock
            const needsReorder = (i.stockLevel ?? 0) <= reorderPoint;
            return { name: i.name, stock: i.stockLevel ?? 0, reorderPoint, demand: Math.round(demand * 10) / 10, needsReorder };
          })
          .filter((x): x is NonNullable<typeof x> => x !== null)
          .sort((a, b) => (b.needsReorder ? 1 : 0) - (a.needsReorder ? 1 : 0) || b.demand - a.demand)
          .slice(0, 8);
        if (reorderItems.length === 0) return null;
        const needsReorderCount = reorderItems.filter(i => i.needsReorder).length;
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '📦 Yeniden Sipariş Noktası Hesaplayıcı' : '📦 Reorder Point Calculator'}</h3>
              {needsReorderCount > 0 && (
                <span className="text-xs font-bold bg-red-100 text-red-700 px-2 py-0.5 rounded-full">
                  {needsReorderCount} {currentLanguage === 'tr' ? 'ürün sipariş gerekiyor' : 'items need reorder'}
                </span>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-400 text-[10px]">
                    <th className="text-left pb-2">{currentLanguage === 'tr' ? 'Ürün' : 'Product'}</th>
                    <th className="text-center pb-2">{currentLanguage === 'tr' ? 'Stok' : 'Stock'}</th>
                    <th className="text-center pb-2">{currentLanguage === 'tr' ? 'Yeni. Noktası' : 'Reorder Pt'}</th>
                    <th className="text-center pb-2">{currentLanguage === 'tr' ? 'Günlük Talep' : 'Daily Demand'}</th>
                    <th className="text-center pb-2">{currentLanguage === 'tr' ? 'Durum' : 'Status'}</th>
                  </tr>
                </thead>
                <tbody>
                  {reorderItems.map(item => (
                    <tr key={item.name} className="border-t border-gray-50">
                      <td className="py-1.5 text-gray-800 font-medium truncate max-w-[100px]">{item.name}</td>
                      <td className="py-1.5 text-center text-gray-700">{item.stock}</td>
                      <td className="py-1.5 text-center text-gray-700">{item.reorderPoint}</td>
                      <td className="py-1.5 text-center text-gray-600">{item.demand}/d</td>
                      <td className="py-1.5 text-center">
                        {item.needsReorder
                          ? <span className="text-[10px] font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded-full">🔴 {currentLanguage === 'tr' ? 'Sipariş Ver' : 'Order Now'}</span>
                          : <span className="text-[10px] text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-full">✅ OK</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[10px] text-gray-400 mt-3">{currentLanguage === 'tr' ? `Yeniden sipariş noktası = Günlük ortalama talep × ${LEAD_TIME_DAYS} gün tedarik süresi × 1.5 emniyet stoku` : `Reorder point = Avg daily demand × ${LEAD_TIME_DAYS}-day lead time × 1.5 safety stock`}</p>
          </div>
        );
      })()}

      {/* ── Phase 202: Top Revenue Days (Last 90 Days) ── */}
      {reportsTab === 'genel' && orders.length >= 10 && (() => {
        const now202 = new Date();
        const cutoff202 = new Date(now202); cutoff202.setDate(cutoff202.getDate() - 90);
        const dayRevMap: Record<string, number> = {};
        for (const o of orders) {
          if (o.status === 'Cancelled') continue;
          try {
            const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
            if (od < cutoff202) continue;
            const key = od.toLocaleDateString(currentLanguage === 'tr' ? 'tr-TR' : 'en-US', { day: '2-digit', month: 'short' });
            dayRevMap[key] = (dayRevMap[key] ?? 0) + (o.totalPrice || 0);
          } catch { /* skip */ }
        }
        const topDays = Object.entries(dayRevMap).sort(([,a],[,b]) => b - a).slice(0, 6);
        if (topDays.length < 3) return null;
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-4">{currentLanguage === 'tr' ? '🏅 En Yüksek Ciro Günleri (Son 90 Gün)' : '🏅 Top Revenue Days (Last 90 Days)'}</h3>
            <div className="space-y-2">
              {topDays.map(([day, rev], i) => {
                const maxRev = topDays[0][1];
                return (
                  <div key={day} className="flex items-center gap-3">
                    <span className="text-sm">{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i+1}`}</span>
                    <span className="text-xs font-medium text-gray-700 w-16 shrink-0">{day}</span>
                    <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-brand rounded-full" style={{ width: `${Math.round((rev / maxRev) * 100)}%` }} />
                    </div>
                    <span className="text-xs font-bold text-gray-700 w-16 text-right shrink-0">{fmtAna(rev,'K',1)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 203: Gross Margin by Order Size Tier ── */}
      {reportsTab === 'genel' && orders.length >= 5 && inventory.length > 0 && (() => {
        const tiers203 = [
          { label: '<₺5K', min: 0, max: 5000, rev: 0, cogs: 0, count: 0 },
          { label: '₺5-20K', min: 5000, max: 20000, rev: 0, cogs: 0, count: 0 },
          { label: '₺20-50K', min: 20000, max: 50000, rev: 0, cogs: 0, count: 0 },
          { label: '₺50K+', min: 50000, max: Infinity, rev: 0, cogs: 0, count: 0 },
        ];
        for (const o of orders) {
          if (o.status === 'Cancelled') continue;
          const tier = tiers203.find(t => (o.totalPrice || 0) >= t.min && (o.totalPrice || 0) < t.max);
          if (!tier) continue;
          tier.rev += o.totalPrice || 0;
          tier.count++;
          for (const li of (o.lineItems ?? [])) {
            const inv = inventory.find(ii => ii.id === li.inventoryId || ii.name === li.name);
            tier.cogs += (inv ? itemCostTRY(inv, exchangeRates) : li.price * 0.6) * li.quantity;
          }
        }
        const activeTiers = tiers203.filter(t => t.count > 0);
        if (activeTiers.length < 2) return null;
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-4">{currentLanguage === 'tr' ? '🎯 Sipariş Büyüklüğüne Göre Brüt Marj' : '🎯 Gross Margin by Order Size'}</h3>
            <div className="grid grid-cols-2 gap-3">
              {activeTiers.map(t => {
                const margin = t.rev > 0 ? Math.round(((t.rev - t.cogs) / t.rev) * 100) : 0;
                return (
                  <div key={t.label} className={`rounded-2xl p-4 ${margin >= 30 ? 'bg-emerald-50' : margin >= 15 ? 'bg-amber-50' : 'bg-red-50'}`}>
                    <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500 mb-1">{t.label}</p>
                    <p className={`text-3xl font-black ${margin >= 30 ? 'text-emerald-600' : margin >= 15 ? 'text-amber-600' : 'text-red-500'}`}>%{margin}</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">{t.count} {currentLanguage === 'tr' ? 'sipariş' : 'orders'} · {fmtAna(t.rev,'K',0)}</p>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 204: Inventory Velocity (Fast vs Slow Movers) ── */}
      {reportsTab === 'envanter' && inventory.length >= 3 && orders.length >= 5 && (() => {
        const now204 = new Date();
        const days204 = 30;
        const cutoff204 = new Date(now204); cutoff204.setDate(cutoff204.getDate() - days204);
        const unitsSold: Record<string, number> = {};
        for (const o of orders) {
          if (o.status === 'Cancelled') continue;
          try {
            const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
            if (od < cutoff204) continue;
            for (const li of (o.lineItems ?? [])) {
              const key = li.inventoryId || li.name || '';
              if (!key) continue;
              unitsSold[key] = (unitsSold[key] ?? 0) + li.quantity;
            }
          } catch { /* skip */ }
        }
        const velocityList = inventory
          .map(i => {
            const sold = unitsSold[i.id] ?? unitsSold[i.name] ?? unitsSold[i.sku || ''] ?? 0;
            const stock = i.stockLevel ?? 0;
            const turnover = stock > 0 ? Math.round((sold / stock) * 100) / 100 : sold > 0 ? Infinity : 0;
            return { name: i.name, sold, stock, turnover };
          })
          .filter(i => i.sold > 0 || i.stock > 0)
          .sort((a, b) => b.turnover - a.turnover)
          .slice(0, 10);
        if (velocityList.length < 3) return null;
        const maxTurnover = Math.min(Math.max(...velocityList.map(i => i.turnover === Infinity ? 0 : i.turnover), 1), 5);
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '⚡ Stok Devir Hızı (Son 30 Gün)' : '⚡ Inventory Velocity (Last 30 Days)'}</h3>
              <span className="text-[10px] text-gray-400">{currentLanguage === 'tr' ? 'Satılan/Stok Oranı' : 'Units Sold/Stock Ratio'}</span>
            </div>
            <div className="space-y-2">
              {velocityList.map(item => {
                const pct = item.turnover === Infinity ? 100 : Math.min(100, Math.round((item.turnover / maxTurnover) * 100));
                const isfast = item.turnover >= 0.5;
                return (
                  <div key={item.name}>
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-xs text-gray-700 truncate">{item.name}</span>
                      <div className="flex items-center gap-2 shrink-0 ml-2">
                        <span className="text-[10px] text-gray-400">{item.sold} {currentLanguage === 'tr' ? 'satılan' : 'sold'}</span>
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${isfast ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                          {isfast ? (currentLanguage === 'tr' ? '⚡ Hızlı' : '⚡ Fast') : (currentLanguage === 'tr' ? '🐢 Yavaş' : '🐢 Slow')}
                        </span>
                      </div>
                    </div>
                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${isfast ? 'bg-emerald-400' : 'bg-gray-300'}`} style={{ width: `${Math.max(4, pct)}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 205: Customer Lifetime Value Trend ── */}
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

      {/* ── Phase 206: Product Category Revenue Pareto ── */}
      {reportsTab === 'envanter' && orders.length >= 3 && inventory.length > 0 && (() => {
        const catRev206: Record<string, number> = {};
        for (const o of orders) {
          if (o.status === 'Cancelled') continue;
          for (const li of (o.lineItems ?? [])) {
            const inv = inventory.find(ii => ii.id === li.inventoryId || ii.name === li.name);
            const cat = inv?.category || (currentLanguage === 'tr' ? 'Diğer' : 'Other');
            catRev206[cat] = (catRev206[cat] ?? 0) + li.price * li.quantity;
          }
        }
        const sortedCats = Object.entries(catRev206).sort(([,a],[,b]) => b - a);
        if (sortedCats.length < 2) return null;
        const totalCatRev = sortedCats.reduce((s,[,v]) => s + v, 0);
        let cumPct = 0;
        const withPareto = sortedCats.map(([cat, rev]) => {
          cumPct += totalCatRev > 0 ? (rev / totalCatRev) * 100 : 0;
          return { cat, rev, pct: Math.round((rev / (totalCatRev || 1)) * 100), cumPct: Math.round(cumPct) };
        }).slice(0, 8);
        const maxRev206 = sortedCats[0][1];
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-4">{currentLanguage === 'tr' ? '📊 Kategori Pareto Analizi' : '📊 Category Revenue Pareto'}</h3>
            <div className="space-y-2.5">
              {withPareto.map(c => (
                <div key={c.cat}>
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-xs font-medium text-gray-700 truncate">{c.cat}</span>
                    <div className="flex items-center gap-2 shrink-0 ml-2">
                      <span className="text-[10px] text-gray-400">%{c.pct}</span>
                      <span className="text-[10px] text-purple-600 font-bold">Σ%{c.cumPct}</span>
                      <span className="text-xs font-bold text-gray-700">{fmtAna(c.rev,'K',0)}</span>
                    </div>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${c.cumPct <= 80 ? 'bg-brand' : c.cumPct <= 95 ? 'bg-amber-400' : 'bg-gray-300'}`} style={{ width: `${Math.max(4, Math.round((c.rev / maxRev206) * 100))}%` }} />
                  </div>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-3 mt-3 text-[10px] text-gray-500 flex-wrap">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-brand inline-block" /> {currentLanguage === 'tr' ? 'Cironun %80\'i' : '80% of Revenue'}</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-amber-400 inline-block" /> {currentLanguage === 'tr' ? '%80-95' : '80-95%'}</span>
            </div>
          </div>
        );
      })()}

      {/* ── Phase 207: Quote Win Rate by Product Category ── */}
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

      {/* ── Phase 208: Monthly Payroll vs Revenue Bridge ── */}
      {reportsTab === 'ik' && employees.length > 0 && orders.length >= 3 && (() => {
        const now208 = new Date();
        const months208 = Array.from({ length: 6 }, (_, i) => {
          const d = new Date(now208.getFullYear(), now208.getMonth() - (5 - i), 1);
          const label = d.toLocaleDateString(currentLanguage === 'tr' ? 'tr-TR' : 'en-US', { month: 'short' });
          const rev = orders.filter(o => {
            if (o.status === 'Cancelled') return false;
            try {
              const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
              return od.getFullYear() === d.getFullYear() && od.getMonth() === d.getMonth();
            } catch { return false; }
          }).reduce((s, o) => s + (o.totalPrice || 0), 0);
          const payroll = employees.filter(e => e.status === 'Aktif').reduce((s, e) => s + (e.salary || 0), 0);
          return { label, rev, payroll, ratio: rev > 0 ? Math.round((payroll / rev) * 100) : 0 };
        });
        const maxRev208 = Math.max(...months208.map(m => m.rev), 1);
        const maxPayroll208 = Math.max(...months208.map(m => m.payroll), 1);
        const maxVal208 = Math.max(maxRev208, maxPayroll208);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-4">{currentLanguage === 'tr' ? '💰 Maaş Kütlesi vs Ciro Köprüsü' : '💰 Payroll vs Revenue Bridge'}</h3>
            <div className="flex items-end gap-3 h-28 mb-2">
              {months208.map((m, i) => {
                const revH = Math.round((m.rev / maxVal208) * 80);
                const payH = Math.round((m.payroll / maxVal208) * 80);
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1">
                    <div className="w-full flex items-end gap-0.5" style={{ height: '80px' }}>
                      <div className="flex-1 bg-blue-400 rounded-t-sm" style={{ height: `${Math.max(2, revH)}px` }} title={`Rev ₺${(m.rev/1000).toFixed(0)}K`} />
                      <div className="flex-1 bg-red-300 rounded-t-sm" style={{ height: `${Math.max(2, payH)}px` }} title={`Payroll ₺${(m.payroll/1000).toFixed(0)}K`} />
                    </div>
                    <span className="text-[9px] text-gray-400 leading-none">{m.label}</span>
                    {m.ratio > 0 && <span className={`text-[8px] font-bold ${m.ratio <= 30 ? 'text-emerald-500' : m.ratio <= 50 ? 'text-amber-500' : 'text-red-500'}`}>%{m.ratio}</span>}
                  </div>
                );
              })}
            </div>
            <div className="flex items-center gap-4 text-[10px] text-gray-500">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-blue-400 inline-block" />{currentLanguage === 'tr' ? 'Ciro' : 'Revenue'}</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-red-300 inline-block" />{currentLanguage === 'tr' ? 'Maaş' : 'Payroll'}</span>
              <span className="ml-auto">{currentLanguage === 'tr' ? '%: Maaş/Ciro' : '%: Payroll/Revenue'}</span>
            </div>
          </div>
        );
      })()}

      {/* ── Phase 209: Cancelled Order Root Cause ── */}
      {reportsTab === 'lojistik' && orders.filter(o => o.status === 'Cancelled').length >= 2 && (() => {
        const cancelled209 = orders.filter(o => o.status === 'Cancelled');
        // Group by cancellation reason field or customer
        const reasonMap: Record<string, number> = {};
        const custMap: Record<string, number> = {};
        for (const o of cancelled209) {
          const m = o as unknown as Record<string,unknown>;
          const reason = (m.cancelReason as string) || (m.cancellationReason as string) || (currentLanguage === 'tr' ? 'Belirtilmemiş' : 'Not specified');
          reasonMap[reason] = (reasonMap[reason] ?? 0) + 1;
          const cust = o.customerName || '—';
          custMap[cust] = (custMap[cust] ?? 0) + 1;
        }
        const reasons = Object.entries(reasonMap).sort(([,a],[,b]) => b - a).slice(0, 5);
        const topCancellers = Object.entries(custMap).sort(([,a],[,b]) => b - a).slice(0, 4);
        const total209 = cancelled209.length;
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '🔍 İptal Kök Neden Analizi' : '🔍 Cancellation Root Cause'}</h3>
              <span className="text-xs font-bold text-red-700 bg-red-50 px-2 py-0.5 rounded-full">{total209} {currentLanguage === 'tr' ? 'iptal' : 'cancellations'}</span>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <p className="text-[10px] font-semibold text-gray-500 mb-2 uppercase tracking-wide">{currentLanguage === 'tr' ? 'İptal Sebebi' : 'Cancellation Reason'}</p>
                <div className="space-y-2">
                  {reasons.map(([reason, count]) => (
                    <div key={reason} className="flex items-center justify-between text-xs">
                      <span className="text-gray-700 truncate">{reason}</span>
                      <div className="flex items-center gap-2 shrink-0 ml-2">
                        <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full bg-red-400 rounded-full" style={{ width: `${Math.round((count / total209) * 100)}%` }} />
                        </div>
                        <span className="font-bold text-gray-700 w-6 text-right">{count}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-[10px] font-semibold text-gray-500 mb-2 uppercase tracking-wide">{currentLanguage === 'tr' ? 'En Çok İptal Eden' : 'Most Cancellations By'}</p>
                <div className="space-y-2">
                  {topCancellers.map(([cust, count]) => (
                    <div key={cust} className="flex items-center justify-between text-xs">
                      <span className="text-gray-700 truncate">{cust}</span>
                      <span className="font-bold text-red-500 shrink-0 ml-2">{count}×</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Phase 210: Average Revenue Per User (ARPU) by Month ── */}
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

      {/* ── Phase 211: Price Tier Adoption Analysis ── */}
      {reportsTab === 'envanter' && orders.length >= 5 && inventory.length > 0 && (() => {
        // Count how many orders use each price tier (Retail, B2B Standard, B2B Premium, Dealer)
        const tierCounts: Record<string, { count: number; rev: number }> = {
          'Retail': { count: 0, rev: 0 },
          'B2B Standard': { count: 0, rev: 0 },
          'B2B Premium': { count: 0, rev: 0 },
          'Dealer': { count: 0, rev: 0 },
        };
        let matchedOrders = 0;
        for (const o of orders) {
          if (o.status === 'Cancelled') continue;
          const m = o as unknown as Record<string,unknown>;
          const tier = (m.priceTier as string) || (m.priceList as string) || '';
          if (tier && tierCounts[tier]) {
            tierCounts[tier].count++;
            tierCounts[tier].rev += o.totalPrice || 0;
            matchedOrders++;
          }
        }
        if (matchedOrders < 3) return null;
        const total211 = Object.values(tierCounts).reduce((s, t) => s + t.count, 0);
        const tierList = Object.entries(tierCounts).filter(([,t]) => t.count > 0).sort(([,a],[,b]) => b.rev - a.rev);
        if (tierList.length < 2) return null;
        const colors: Record<string, string> = { 'Retail': 'bg-blue-400', 'B2B Standard': 'bg-emerald-400', 'B2B Premium': 'bg-purple-400', 'Dealer': 'bg-amber-400' };
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-4">{currentLanguage === 'tr' ? '💲 Fiyat Kademesi Dağılımı' : '💲 Price Tier Adoption'}</h3>
            <div className="space-y-2.5">
              {tierList.map(([tier, d]) => {
                const pct = total211 > 0 ? Math.round((d.count / total211) * 100) : 0;
                return (
                  <div key={tier}>
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-xs font-medium text-gray-700">{tier}</span>
                      <div className="flex items-center gap-2 shrink-0 ml-2">
                        <span className="text-[10px] text-gray-400">{d.count} {currentLanguage === 'tr' ? 'sipariş' : 'orders'} · %{pct}</span>
                        <span className="text-xs font-bold text-gray-700">{fmtAna(d.rev,'K',0)}</span>
                      </div>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${colors[tier] ?? 'bg-gray-400'}`} style={{ width: `${Math.max(4, pct)}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 212: Order Status Funnel ── */}
      {reportsTab === 'lojistik' && orders.length >= 5 && (() => {
        const total212 = orders.length;
        const stages212 = [
          { label: currentLanguage === 'tr' ? 'Toplam Sipariş' : 'Total Orders', count: total212, color: 'bg-gray-400' },
          { label: currentLanguage === 'tr' ? 'İşleniyor/Bekliyor' : 'Processing/Pending', count: orders.filter(o => o.status === 'Pending' || o.status === 'Processing').length, color: 'bg-blue-400' },
          { label: currentLanguage === 'tr' ? 'Kargoya Verildi' : 'Shipped', count: orders.filter(o => o.status === 'Shipped').length, color: 'bg-amber-400' },
          { label: currentLanguage === 'tr' ? 'Teslim Edildi' : 'Delivered', count: orders.filter(o => o.status === 'Delivered').length, color: 'bg-emerald-400' },
        ];
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-4">{currentLanguage === 'tr' ? '🔽 Sipariş Durum Hunisi' : '🔽 Order Status Funnel'}</h3>
            <div className="space-y-2">
              {stages212.map((s, i) => {
                const pct = total212 > 0 ? Math.round((s.count / total212) * 100) : 0;
                const width = Math.max(10, 100 - i * 12);
                return (
                  <div key={s.label} className="flex flex-col items-center">
                    <div className={`h-10 ${s.color} rounded-xl flex items-center justify-between px-4 text-white`} style={{ width: `${width}%` }}>
                      <span className="text-xs font-medium">{s.label}</span>
                      <span className="text-sm font-bold">{s.count} <span className="text-xs font-normal opacity-80">(%{pct})</span></span>
                    </div>
                    {i < stages212.length - 1 && (
                      <div className="w-px h-3 bg-gray-200 my-0.5" />
                    )}
                  </div>
                );
              })}
            </div>
            <div className="mt-4 p-3 bg-red-50 rounded-xl flex items-center justify-between">
              <span className="text-xs text-red-700 font-medium">❌ {currentLanguage === 'tr' ? 'İptal' : 'Cancelled'}</span>
              <span className="text-sm font-bold text-red-600">{orders.filter(o => o.status === 'Cancelled').length} ({total212 > 0 ? Math.round((orders.filter(o => o.status === 'Cancelled').length / total212) * 100) : 0}%)</span>
            </div>
          </div>
        );
      })()}

      {/* ── Phase 213: Revenue by Geographic Region ── */}
      {reportsTab === 'lojistik' && orders.length >= 5 && (() => {
        const regionRev: Record<string, number> = {};
        for (const o of orders) {
          if (o.status === 'Cancelled') continue;
          const m = o as unknown as Record<string,unknown>;
          const city = (m.deliveryCity as string) || (m.city as string) || (m.region as string) || '';
          if (!city) continue;
          regionRev[city] = (regionRev[city] ?? 0) + (o.totalPrice || 0);
        }
        const regions = Object.entries(regionRev).sort(([,a],[,b]) => b - a).slice(0, 8);
        if (regions.length < 2) return null;
        const totalRegRev = regions.reduce((s,[,v]) => s + v, 0);
        const maxRegRev = regions[0][1];
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-4">{currentLanguage === 'tr' ? '🗺️ Bölgeye Göre Ciro' : '🗺️ Revenue by Region'}</h3>
            <div className="space-y-2.5">
              {regions.map(([region, rev]) => {
                const pct = totalRegRev > 0 ? Math.round((rev / totalRegRev) * 100) : 0;
                return (
                  <div key={region}>
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-xs font-medium text-gray-700">{region}</span>
                      <div className="flex items-center gap-2 shrink-0 ml-2">
                        <span className="text-[10px] text-gray-400">%{pct}</span>
                        <span className="text-xs font-bold text-gray-700">{fmtAna(rev,'K',0)}</span>
                      </div>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-blue-400 rounded-full" style={{ width: `${Math.max(4, Math.round((rev / maxRegRev) * 100))}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 214: Employee Sales Attribution ── */}
      {reportsTab === 'ik' && employees.length > 0 && orders.length >= 3 && (() => {
        const empRevMap: Record<string, { name: string; rev: number; orders: number; dept: string }> = {};
        for (const o of orders) {
          if (o.status === 'Cancelled') continue;
          const rep = (o.assignedTo as string | undefined) || (o as unknown as Record<string,unknown>).salesRep as string || '';
          if (!rep) continue;
          const emp = employees.find(e => e.name === rep || e.email === rep);
          const name = emp?.name ?? rep;
          const dept = emp?.department ?? (currentLanguage === 'tr' ? 'Satış' : 'Sales');
          if (!empRevMap[name]) empRevMap[name] = { name, rev: 0, orders: 0, dept };
          empRevMap[name].rev += o.totalPrice || 0;
          empRevMap[name].orders++;
        }
        const empList = Object.values(empRevMap).sort((a, b) => b.rev - a.rev).slice(0, 8);
        if (empList.length < 2) return null;
        const totalEmpRev = empList.reduce((s, e) => s + e.rev, 0);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-4">{currentLanguage === 'tr' ? '👤 Çalışan Satış Atıf Analizi' : '👤 Employee Sales Attribution'}</h3>
            <div className="space-y-2.5">
              {empList.map(e => {
                const pct = totalEmpRev > 0 ? Math.round((e.rev / totalEmpRev) * 100) : 0;
                return (
                  <div key={e.name}>
                    <div className="flex items-center justify-between mb-0.5">
                      <div>
                        <span className="text-xs font-medium text-gray-800">{e.name}</span>
                        <span className="text-[10px] text-gray-400 ml-1.5">{e.dept}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 ml-2">
                        <span className="text-[10px] text-gray-400">{e.orders} {currentLanguage === 'tr' ? 'sipariş' : 'orders'}</span>
                        <span className="text-[10px] font-bold text-gray-500">%{pct}</span>
                        <span className="text-xs font-bold text-gray-700">{fmtAna(e.rev,'K',0)}</span>
                      </div>
                    </div>
                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-purple-400 rounded-full" style={{ width: `${Math.max(4, pct)}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 215: Monthly Order Count vs Revenue Scatter ── */}
      {reportsTab === 'genel' && orders.length >= 6 && (() => {
        const now215 = new Date();
        const months215 = Array.from({ length: 12 }, (_, i) => {
          const d = new Date(now215.getFullYear(), now215.getMonth() - (11 - i), 1);
          const mOrds = orders.filter(o => {
            if (o.status === 'Cancelled') return false;
            try {
              const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
              return od.getFullYear() === d.getFullYear() && od.getMonth() === d.getMonth();
            } catch { return false; }
          });
          return {
            label: d.toLocaleDateString(currentLanguage === 'tr' ? 'tr-TR' : 'en-US', { month: 'short', year: '2-digit' }),
            count: mOrds.length,
            rev: mOrds.reduce((s, o) => s + (o.totalPrice || 0), 0),
          };
        }).filter(m => m.count > 0);
        if (months215.length < 4) return null;
        const maxCount = Math.max(...months215.map(m => m.count), 1);
        const maxRev215 = Math.max(...months215.map(m => m.rev), 1);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-4">{currentLanguage === 'tr' ? '📈 Sipariş Adedi vs Ciro (12 Ay)' : '📈 Order Count vs Revenue (12 Months)'}</h3>
            <div className="flex items-end gap-1.5 h-28 mb-2">
              {months215.map((m, i) => {
                const isLatest = i === months215.length - 1;
                const revH = Math.round((m.rev / maxRev215) * 72);
                const cntH = Math.round((m.count / maxCount) * 72);
                return (
                  <div key={m.label} className="flex-1 flex flex-col items-center gap-0.5">
                    <div className="w-full flex items-end gap-px" style={{ height: '72px' }}>
                      <div className={`flex-1 rounded-t-sm ${isLatest ? 'bg-brand' : 'bg-red-200'}`} style={{ height: `${Math.max(2, revH)}px` }} />
                      <div className={`flex-1 rounded-t-sm ${isLatest ? 'bg-blue-500' : 'bg-blue-200'}`} style={{ height: `${Math.max(2, cntH)}px` }} />
                    </div>
                    <span className="text-[8px] text-gray-400 leading-none">{m.label}</span>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center gap-4 text-[10px] text-gray-500">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-red-300 inline-block" />{currentLanguage === 'tr' ? 'Ciro' : 'Revenue'}</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-blue-300 inline-block" />{currentLanguage === 'tr' ? 'Sipariş Adedi' : 'Order Count'}</span>
            </div>
          </div>
        );
      })()}

      {/* ── Phase 216: Working Capital Analysis ── */}
      {reportsTab === 'genel' && orders.length >= 3 && inventory.length > 0 && (() => {
        // Working Capital = Current Assets - Current Liabilities (estimated)
        const inventoryVal216 = inventory.reduce((s, i) => s + itemCostTRY(i, exchangeRates) * (i.stockLevel ?? 0), 0);
        const arBalance216 = orders.filter(o => o.status !== 'Cancelled' && o.status !== 'Delivered').reduce((s, o) => s + (o.totalPrice || 0), 0);
        const currentAssets = inventoryVal216 + arBalance216;
        // Estimated AP: orders received in last 30 days (proxy for payables)
        const now216 = new Date();
        const cut216 = new Date(now216); cut216.setDate(cut216.getDate() - 30);
        const recentPurchases = orders.filter(o => {
          const m = o as unknown as Record<string,unknown>;
          if (!m.isPurchase && !m.purchaseOrder) return false;
          try {
            const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
            return od >= cut216;
          } catch { return false; }
        }).reduce((s, o) => s + (o.totalPrice || 0), 0);
        const estimatedPayroll = inventory.length; // fallback
        void estimatedPayroll;
        const currentLiabilities = recentPurchases; // proxy
        const workingCapital = currentAssets - currentLiabilities;
        const currentRatio = currentLiabilities > 0 ? (currentAssets / currentLiabilities).toFixed(1) : '∞';
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '🏦 İşletme Sermayesi Analizi' : '🏦 Working Capital Analysis'}</h3>
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${workingCapital >= 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                {workingCapital >= 0 ? (currentLanguage === 'tr' ? 'Sağlıklı' : 'Healthy') : (currentLanguage === 'tr' ? 'Risk' : 'Risk')}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-3 mb-4">
              {[
                { label: currentLanguage === 'tr' ? 'Dönen Varlıklar' : 'Current Assets', value: `₺${(currentAssets/1000).toFixed(0)}K`, color: 'text-emerald-600', sub: currentLanguage === 'tr' ? 'Stok + Alacak' : 'Inventory + AR' },
                { label: currentLanguage === 'tr' ? 'Kısa Vade Borç' : 'Current Liabilities', value: `₺${(currentLiabilities/1000).toFixed(0)}K`, color: 'text-red-500', sub: currentLanguage === 'tr' ? 'Borç tahmini' : 'AP estimate' },
                { label: currentLanguage === 'tr' ? 'Net Sermaye' : 'Net Working Capital', value: `₺${(workingCapital/1000).toFixed(0)}K`, color: workingCapital >= 0 ? 'text-emerald-600' : 'text-red-500', sub: currentLanguage === 'tr' ? 'Cari Oran: ' + currentRatio : 'Current Ratio: ' + currentRatio },
              ].map(k => (
                <div key={k.label} className="bg-gray-50 rounded-xl p-3 text-center">
                  <p className={`text-xl font-black ${k.color}`}>{k.value}</p>
                  <p className="text-[10px] text-gray-600 font-medium mt-0.5">{k.label}</p>
                  <p className="text-[9px] text-gray-400">{k.sub}</p>
                </div>
              ))}
            </div>
            <div className="space-y-2">
              <div>
                <div className="flex justify-between text-[10px] text-gray-500 mb-0.5">
                  <span>{currentLanguage === 'tr' ? 'Stok Değeri' : 'Inventory Value'}</span>
                  <span>{fmtAna(inventoryVal216,'K',0)}</span>
                </div>
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-300 rounded-full" style={{ width: `${currentAssets > 0 ? Math.round((inventoryVal216/currentAssets)*100) : 0}%` }} />
                </div>
              </div>
              <div>
                <div className="flex justify-between text-[10px] text-gray-500 mb-0.5">
                  <span>{currentLanguage === 'tr' ? 'Tahsil Edilecek Alacaklar' : 'Accounts Receivable'}</span>
                  <span>{fmtAna(arBalance216,'K',0)}</span>
                </div>
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full bg-amber-300 rounded-full" style={{ width: `${currentAssets > 0 ? Math.round((arBalance216/currentAssets)*100) : 0}%` }} />
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Phase 217: Product Mix Analysis ── */}
      {reportsTab === 'genel' && orders.length >= 5 && inventory.length > 0 && (() => {
        // Top products by revenue contribution
        const prodRev217: Record<string, { name: string; rev: number; qty: number }> = {};
        for (const o of orders) {
          if (o.status === 'Cancelled') continue;
          for (const li of (o.lineItems ?? [])) {
            const key = li.inventoryId || li.name || '';
            if (!key) continue;
            if (!prodRev217[key]) prodRev217[key] = { name: li.name || key, rev: 0, qty: 0 };
            prodRev217[key].rev += li.price * li.quantity;
            prodRev217[key].qty += li.quantity;
          }
        }
        const sorted217 = Object.values(prodRev217).sort((a, b) => b.rev - a.rev).slice(0, 6);
        if (sorted217.length < 2) return null;
        const total217 = sorted217.reduce((s, p) => s + p.rev, 0);
        const COLORS_217 = ['#ff4000', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#6b7280'];
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-4">{currentLanguage === 'tr' ? '🧩 Ürün Karma Analizi (Top 6)' : '🧩 Product Mix Analysis (Top 6)'}</h3>
            <div className="flex gap-2 mb-4">
              {sorted217.map((p, i) => {
                const pct = total217 > 0 ? Math.round((p.rev / total217) * 100) : 0;
                return (
                  <div key={p.name} className="flex-1" style={{ minWidth: 0 }}>
                    <div className="h-16 rounded-xl flex items-end justify-center pb-2" style={{ backgroundColor: COLORS_217[i] + '20' }}>
                      <span className="text-[10px] font-bold" style={{ color: COLORS_217[i] }}>{pct}%</span>
                    </div>
                    <div className="w-full h-1.5 rounded-full mt-1" style={{ backgroundColor: COLORS_217[i] }} />
                    <p className="text-[9px] text-gray-600 text-center mt-1 truncate">{p.name}</p>
                  </div>
                );
              })}
            </div>
            <div className="space-y-1.5">
              {sorted217.map((p, i) => {
                const pct = total217 > 0 ? Math.round((p.rev / total217) * 100) : 0;
                return (
                  <div key={p.name} className="flex items-center gap-2 text-xs">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: COLORS_217[i] }} />
                    <span className="text-gray-700 truncate flex-1">{p.name}</span>
                    <span className="text-gray-400 shrink-0">{p.qty} {currentLanguage === 'tr' ? 'adet' : 'units'}</span>
                    <span className="font-bold text-gray-700 shrink-0">%{pct}</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 218: Customer Concentration Risk ── */}
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

      {/* ── Phase 219: Stock Expiry Tracker ── */}
      {reportsTab === 'envanter' && inventory.length > 0 && (() => {
        const now219 = new Date();
        const warn30 = new Date(now219); warn30.setDate(warn30.getDate() + 30);
        const warn90 = new Date(now219); warn90.setDate(warn90.getDate() + 90);
        const expiryItems = inventory
          .filter(i => i.expiryDate)
          .map(i => {
            const exp = new Date(i.expiryDate!);
            const daysLeft = Math.round((exp.getTime() - now219.getTime()) / 86400000);
            return { name: i.name, daysLeft, stock: i.stockLevel ?? 0, value: (i.stockLevel ?? 0) * itemCostTRY(i, exchangeRates) };
          })
          .filter(i => i.daysLeft <= 90)
          .sort((a, b) => a.daysLeft - b.daysLeft)
          .slice(0, 8);
        if (expiryItems.length === 0) return null;
        return (
          <div className="apple-card p-6 border border-orange-100">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '⏰ Son Kullanma Tarihi Takibi' : '⏰ Expiry Date Tracker'}</h3>
              <span className="text-xs font-bold text-orange-700 bg-orange-50 px-2 py-0.5 rounded-full">{expiryItems.length} {currentLanguage === 'tr' ? 'ürün dikkat' : 'items at risk'}</span>
            </div>
            <div className="space-y-2">
              {expiryItems.map(item => (
                <div key={item.name} className="flex items-center justify-between py-1.5 border-b border-gray-50 last:border-0">
                  <div>
                    <p className="text-xs font-medium text-gray-800">{item.name}</p>
                    <p className="text-[10px] text-gray-400">{item.stock} {currentLanguage === 'tr' ? 'adet' : 'units'} · {fmtAna(item.value,'full',0)}</p>
                  </div>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full shrink-0 ml-2 ${item.daysLeft <= 0 ? 'bg-red-200 text-red-800' : item.daysLeft <= 30 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                    {item.daysLeft <= 0 ? (currentLanguage === 'tr' ? 'Süresi Doldu' : 'Expired') : `${item.daysLeft}d`}
                  </span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 220: Revenue Concentration Index (HHI) ── */}
      {reportsTab === 'genel' && orders.length >= 5 && (() => {
        const custRev220: Record<string, number> = {};
        for (const o of orders) {
          if (o.status === 'Cancelled') continue;
          const name = o.customerName || '—';
          custRev220[name] = (custRev220[name] ?? 0) + (o.totalPrice || 0);
        }
        const total220 = Object.values(custRev220).reduce((s, v) => s + v, 0);
        if (total220 === 0) return null;
        // HHI = sum of (market share %)^2 — normalized 0-10000
        const hhi = Object.values(custRev220).reduce((s, v) => s + Math.pow((v / total220) * 100, 2), 0);
        const hhiRounded = Math.round(hhi);
        const hhiLevel = hhiRounded > 2500 ? 'high' : hhiRounded > 1500 ? 'medium' : 'low';
        const custCount = Object.keys(custRev220).length;
        const avgRevPerCust = Math.round(total220 / custCount);
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '📐 Gelir Konsantrasyon Endeksi (HHI)' : '📐 Revenue Concentration Index (HHI)'}</h3>
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${hhiLevel === 'high' ? 'bg-red-100 text-red-700' : hhiLevel === 'medium' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                {hhiLevel === 'high' ? (currentLanguage === 'tr' ? 'Yüksek Risk' : 'High Risk') : hhiLevel === 'medium' ? (currentLanguage === 'tr' ? 'Orta Risk' : 'Med Risk') : (currentLanguage === 'tr' ? 'Düşük Risk' : 'Diversified')}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-3 mb-4">
              {[
                { label: 'HHI', value: hhiRounded.toLocaleString(), color: hhiLevel === 'high' ? 'text-red-500' : hhiLevel === 'medium' ? 'text-amber-500' : 'text-emerald-600', desc: currentLanguage === 'tr' ? 'Herfindahl Endeksi' : 'Herfindahl Index' },
                { label: currentLanguage === 'tr' ? 'Müşteri Sayısı' : 'Customers', value: String(custCount), color: 'text-blue-600', desc: currentLanguage === 'tr' ? 'Toplam aktif' : 'Total active' },
                { label: currentLanguage === 'tr' ? 'Müşteri Başı' : 'Avg per Customer', value: `₺${(avgRevPerCust/1000).toFixed(0)}K`, color: 'text-gray-700', desc: currentLanguage === 'tr' ? 'Ort. gelir' : 'Avg revenue' },
              ].map(k => (
                <div key={k.label} className="bg-gray-50 rounded-xl p-3 text-center">
                  <p className={`text-xl font-bold ${k.color}`}>{k.value}</p>
                  <p className="text-[10px] text-gray-600 font-medium mt-0.5">{k.label}</p>
                  <p className="text-[9px] text-gray-400">{k.desc}</p>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-1.5 bg-blue-50 rounded-xl p-3">
              <span className="text-blue-500">💡</span>
              <p className="text-[11px] text-blue-700">
                {currentLanguage === 'tr'
                  ? `HHI > 2500 yüksek, 1500-2500 orta, < 1500 düşük konsantrasyon. Şu an: ${hhiRounded} — ${hhiLevel === 'low' ? 'müşteri tabanı sağlıklı dağılmış.' : hhiLevel === 'medium' ? 'birkaç müşteriye bağımlılık var.' : 'kritik müşteri bağımlılığı!'}`
                  : `HHI > 2500 concentrated, 1500-2500 moderate, < 1500 diversified. Currently: ${hhiRounded} — ${hhiLevel === 'low' ? 'healthy diversification.' : hhiLevel === 'medium' ? 'moderate concentration.' : 'critical dependency!'}`}
              </p>
            </div>
          </div>
        );
      })()}

      {/* ── Phase 221: Discount Leakage Analysis ── */}
      {reportsTab === 'crm' && orders.length >= 5 && (() => {
        // Orders where totalPrice < sum(lineItems at list price) indicates discount
        let totalListPrice = 0;
        let totalActualPrice = 0;
        const discountByCustomer: Record<string, { discount: number; orders: number }> = {};
        for (const o of orders) {
          if (o.status === 'Cancelled') continue;
          const listPrice = (o.lineItems ?? []).reduce((s, li) => {
            const inv = inventory.find(ii => ii.id === li.inventoryId || ii.name === li.name);
            const retail = inv?.prices?.['Retail'] ?? li.price;
            return s + retail * li.quantity;
          }, 0);
          const actual = o.totalPrice || 0;
          totalListPrice += listPrice;
          totalActualPrice += actual;
          const discount = listPrice - actual;
          if (discount > 0) {
            const name = o.customerName || '—';
            if (!discountByCustomer[name]) discountByCustomer[name] = { discount: 0, orders: 0 };
            discountByCustomer[name].discount += discount;
            discountByCustomer[name].orders++;
          }
        }
        const totalDiscount = totalListPrice - totalActualPrice;
        if (totalDiscount <= 0 || totalListPrice === 0) return null;
        const discountRate = Math.round((totalDiscount / totalListPrice) * 100);
        const topDiscountCusts = Object.entries(discountByCustomer)
          .sort(([,a],[,b]) => b.discount - a.discount)
          .slice(0, 5);
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '💸 İskonto Sızıntı Analizi' : '💸 Discount Leakage Analysis'}</h3>
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${discountRate >= 20 ? 'bg-red-100 text-red-700' : discountRate >= 10 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                %{discountRate} {currentLanguage === 'tr' ? 'ortalama iskonto' : 'avg discount'}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="bg-red-50 rounded-xl p-3 text-center">
                <p className="text-2xl font-black text-red-600">{fmtAna(totalDiscount,'K',0)}</p>
                <p className="text-[10px] text-gray-500 mt-0.5">{currentLanguage === 'tr' ? 'Toplam İskonto' : 'Total Discount Given'}</p>
              </div>
              <div className="bg-gray-50 rounded-xl p-3 text-center">
                <p className="text-2xl font-black text-gray-700">{fmtAna(totalListPrice,'K',0)}</p>
                <p className="text-[10px] text-gray-500 mt-0.5">{currentLanguage === 'tr' ? 'Liste Fiyatı Toplamı' : 'Total List Price'}</p>
              </div>
            </div>
            {topDiscountCusts.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-700 mb-2">{currentLanguage === 'tr' ? 'En Çok İskonto Alan Müşteriler:' : 'Top Discounted Customers:'}</p>
                <div className="space-y-1.5">
                  {topDiscountCusts.map(([name, d]) => (
                    <div key={name} className="flex items-center justify-between text-xs">
                      <span className="text-gray-700 truncate">{name}</span>
                      <div className="flex items-center gap-2 shrink-0 ml-2">
                        <span className="text-[10px] text-gray-400">{d.orders} {currentLanguage === 'tr' ? 'sipariş' : 'orders'}</span>
                        <span className="font-bold text-red-500">-{fmtAna(d.discount,'K',0)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* ── Phase 222: Backlog & Pipeline Value ── */}
      {reportsTab === 'genel' && orders.length >= 3 && (() => {
        const now222 = new Date();
        void now222;
        const backlogOrders = orders.filter(o => o.status === 'Pending' || o.status === 'Processing');
        const shippedOrders = orders.filter(o => o.status === 'Shipped');
        const backlogValue = backlogOrders.reduce((s, o) => s + (o.totalPrice || 0), 0);
        const shippedValue = shippedOrders.reduce((s, o) => s + (o.totalPrice || 0), 0);
        const totalPipeline = backlogValue + shippedValue;
        if (totalPipeline === 0) return null;
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '📋 Sipariş Biriktirme & Boru Hattı Değeri' : '📋 Order Backlog & Pipeline Value'}</h3>
              <span className="text-sm font-black text-blue-600">{fmtAna(totalPipeline,'K',0)}</span>
            </div>
            <div className="grid grid-cols-2 gap-4 mb-4">
              {[
                { label: currentLanguage === 'tr' ? 'Sipariş Birikimi' : 'Order Backlog', count: backlogOrders.length, value: backlogValue, color: 'text-amber-600', bg: 'bg-amber-50', icon: '⏳' },
                { label: currentLanguage === 'tr' ? 'Kargoda' : 'In Transit', count: shippedOrders.length, value: shippedValue, color: 'text-blue-600', bg: 'bg-blue-50', icon: '🚚' },
              ].map(k => (
                <div key={k.label} className={`${k.bg} rounded-2xl p-4`}>
                  <p className="text-xl mb-1">{k.icon}</p>
                  <p className={`text-2xl font-black ${k.color}`}>{fmtAna(k.value,'K',0)}</p>
                  <p className="text-xs text-gray-600 font-medium mt-1">{k.label}</p>
                  <p className="text-[10px] text-gray-400">{k.count} {currentLanguage === 'tr' ? 'sipariş' : 'orders'}</p>
                </div>
              ))}
            </div>
            <div className="h-3 bg-gray-100 rounded-full overflow-hidden flex">
              <div className="h-full bg-amber-400" style={{ width: `${totalPipeline > 0 ? Math.round((backlogValue / totalPipeline) * 100) : 0}%` }} />
              <div className="h-full bg-blue-400" style={{ width: `${totalPipeline > 0 ? Math.round((shippedValue / totalPipeline) * 100) : 0}%` }} />
            </div>
            <p className="text-[10px] text-gray-400 mt-2">{currentLanguage === 'tr' ? 'İşlenmemiş ve kargodaki siparişlerin toplam değeri' : 'Total value of unprocessed and in-transit orders'}</p>
          </div>
        );
      })()}

      {/* ── Phase 223: Training & Certification Tracker ── */}
      {reportsTab === 'ik' && employees.length > 0 && (() => {
        // Use employee records to find certification/training fields
        type EmpRec = Record<string, unknown>;
        const withCerts = employees.filter(e => {
          const m = e as unknown as EmpRec;
          return !!(m.certifications || m.training || m.skills);
        });
        const deptDist: Record<string, { trained: number; total: number }> = {};
        for (const e of employees) {
          if (e.status !== 'Aktif') continue;
          const dept = e.department || (currentLanguage === 'tr' ? 'Genel' : 'General');
          if (!deptDist[dept]) deptDist[dept] = { trained: 0, total: 0 };
          deptDist[dept].total++;
          const m = e as unknown as EmpRec;
          if (m.certifications || m.training || m.skills) deptDist[dept].trained++;
        }
        const activeCount = employees.filter(e => e.status === 'Aktif').length;
        const trainedCount = withCerts.filter(e => e.status === 'Aktif').length;
        const coveragePct = activeCount > 0 ? Math.round((trainedCount / activeCount) * 100) : 0;
        const deptList = Object.entries(deptDist).filter(([,d]) => d.total > 0).sort(([,a],[,b]) => b.total - a.total).slice(0, 5);
        if (deptList.length === 0) return null;
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '🎓 Eğitim & Sertifika Takibi' : '🎓 Training & Certification Tracker'}</h3>
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${coveragePct >= 70 ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                %{coveragePct} {currentLanguage === 'tr' ? 'kapsam' : 'coverage'}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-3 mb-4">
              {[
                { label: currentLanguage === 'tr' ? 'Aktif Çalışan' : 'Active Employees', value: activeCount, color: 'text-gray-700' },
                { label: currentLanguage === 'tr' ? 'Sertifikalı' : 'Certified/Trained', value: trainedCount, color: 'text-emerald-600' },
                { label: currentLanguage === 'tr' ? 'Eksik Kayıt' : 'Missing Records', value: activeCount - trainedCount, color: 'text-amber-600' },
              ].map(k => (
                <div key={k.label} className="bg-gray-50 rounded-xl p-3 text-center">
                  <p className={`text-2xl font-bold ${k.color}`}>{k.value}</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">{k.label}</p>
                </div>
              ))}
            </div>
            <div className="space-y-2">
              {deptList.map(([dept, d]) => {
                const pct = d.total > 0 ? Math.round((d.trained / d.total) * 100) : 0;
                return (
                  <div key={dept}>
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-xs font-medium text-gray-700">{dept}</span>
                      <span className="text-xs text-gray-400 shrink-0 ml-2">{d.trained}/{d.total} · %{pct}</span>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${pct >= 70 ? 'bg-emerald-400' : pct >= 40 ? 'bg-amber-400' : 'bg-red-300'}`} style={{ width: `${Math.max(4, pct)}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 224: Shipping Cost Analysis ── */}
      {reportsTab === 'lojistik' && orders.length >= 5 && (() => {
        const shippingOrders = orders.filter(o => {
          const m = o as unknown as Record<string,unknown>;
          return (m.shippingCost as number) > 0 || (m.deliveryCost as number) > 0;
        });
        if (shippingOrders.length < 3) return null;
        const totalShipping = shippingOrders.reduce((s, o) => {
          const m = o as unknown as Record<string,unknown>;
          return s + (((m.shippingCost as number) || 0) + ((m.deliveryCost as number) || 0));
        }, 0);
        const totalRevShip = shippingOrders.reduce((s, o) => s + (o.totalPrice || 0), 0);
        const shippingRatio = totalRevShip > 0 ? Math.round((totalShipping / totalRevShip) * 100) : 0;
        const avgShippingPerOrder = Math.round(totalShipping / shippingOrders.length);
        // By status
        const byStatus: Record<string, number> = {};
        for (const o of shippingOrders) {
          const m = o as unknown as Record<string,unknown>;
          const cost = ((m.shippingCost as number) || 0) + ((m.deliveryCost as number) || 0);
          byStatus[o.status] = (byStatus[o.status] ?? 0) + cost;
        }
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '🚛 Nakliye Maliyeti Analizi' : '🚛 Shipping Cost Analysis'}</h3>
              <span className="text-xs font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full">%{shippingRatio} {currentLanguage === 'tr' ? 'ciro oranı' : 'of revenue'}</span>
            </div>
            <div className="grid grid-cols-3 gap-3 mb-4">
              {[
                { label: currentLanguage === 'tr' ? 'Toplam Nakliye' : 'Total Shipping', value: `₺${(totalShipping/1000).toFixed(0)}K`, color: 'text-blue-600' },
                { label: currentLanguage === 'tr' ? 'Sipariş Başı' : 'Per Order', value: `₺${avgShippingPerOrder.toLocaleString()}`, color: 'text-gray-700' },
                { label: currentLanguage === 'tr' ? 'Sipariş Sayısı' : 'Orders Tracked', value: String(shippingOrders.length), color: 'text-gray-500' },
              ].map(k => (
                <div key={k.label} className="bg-gray-50 rounded-xl p-3 text-center">
                  <p className={`text-lg font-bold ${k.color}`}>{k.value}</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">{k.label}</p>
                </div>
              ))}
            </div>
            <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full bg-blue-400 rounded-full" style={{ width: `${Math.min(shippingRatio * 3, 100)}%` }} />
            </div>
            <p className="text-[10px] text-gray-400 mt-1">{currentLanguage === 'tr' ? 'Benchmark: %3-7 (e-ticaret sektörü)' : 'Benchmark: 3-7% (e-commerce industry)'}</p>
          </div>
        );
      })()}

      {/* ── Phase 225: Monthly Goal Progress Dashboard ── */}
      {reportsTab === 'genel' && orders.length >= 3 && (() => {
        const now225 = new Date();
        const monthStart225 = new Date(now225.getFullYear(), now225.getMonth(), 1);
        const daysInMonth = new Date(now225.getFullYear(), now225.getMonth() + 1, 0).getDate();
        const dayOfMonth = now225.getDate();
        const monthProgress = Math.round((dayOfMonth / daysInMonth) * 100);
        const mRevenue225 = orders.filter(o => {
          if (o.status === 'Cancelled') return false;
          try {
            const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
            return od >= monthStart225;
          } catch { return false; }
        }).reduce((s, o) => s + (o.totalPrice || 0), 0);
        const mOrders225 = orders.filter(o => {
          if (o.status === 'Cancelled') return false;
          try {
            const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
            return od >= monthStart225;
          } catch { return false; }
        }).length;
        const mNewCustomers225 = new Set(orders.filter(o => {
          if (o.status === 'Cancelled') return false;
          try {
            const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
            return od >= monthStart225;
          } catch { return false; }
        }).map(o => o.customerName || '—')).size;
        // Pace = what we'd expect at current run rate by end of month
        const pace225 = dayOfMonth > 0 ? Math.round((mRevenue225 / dayOfMonth) * daysInMonth) : 0;
        const goals = [
          { label: currentLanguage === 'tr' ? 'Aylık Ciro' : 'Monthly Revenue', current: mRevenue225, pace: pace225, icon: '💰', format: (v: number) => `₺${(v/1000).toFixed(0)}K` },
          { label: currentLanguage === 'tr' ? 'Sipariş Adedi' : 'Order Count', current: mOrders225, pace: dayOfMonth > 0 ? Math.round((mOrders225 / dayOfMonth) * daysInMonth) : 0, icon: '📦', format: (v: number) => String(v) },
          { label: currentLanguage === 'tr' ? 'Aktif Müşteri' : 'Active Customers', current: mNewCustomers225, pace: dayOfMonth > 0 ? Math.round((mNewCustomers225 / dayOfMonth) * daysInMonth) : 0, icon: '👥', format: (v: number) => String(v) },
        ];
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '🎯 Aylık İlerleme Göstergesi' : '🎯 Monthly Goal Progress'}</h3>
              <span className="text-xs font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">
                {currentLanguage === 'tr' ? `Ay: %${monthProgress} tamamlandı (${dayOfMonth}/${daysInMonth} gün)` : `Month: ${monthProgress}% complete (day ${dayOfMonth}/${daysInMonth})`}
              </span>
            </div>
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden mb-4">
              <div className="h-full bg-blue-400 rounded-full" style={{ width: `${monthProgress}%` }} />
            </div>
            <div className="space-y-4">
              {goals.map(g => {
                const paceVsMonth = monthProgress > 0 ? Math.round((g.current / (g.pace || 1)) * 100) : 0;
                const isAhead = paceVsMonth >= 100;
                return (
                  <div key={g.label}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span>{g.icon}</span>
                        <span className="text-xs font-medium text-gray-700">{g.label}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 ml-2">
                        <span className="text-xs text-gray-700 font-bold">{g.format(g.current)}</span>
                        <span className="text-[10px] text-gray-400">→ {g.format(g.pace)} {currentLanguage === 'tr' ? 'tahmini' : 'projected'}</span>
                        <span className={`text-[10px] font-bold px-1 py-0.5 rounded ${isAhead ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                          {isAhead ? '▲' : '▼'} %{Math.abs(paceVsMonth - 100)}
                        </span>
                      </div>
                    </div>
                    <div className="relative h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${isAhead ? 'bg-emerald-400' : 'bg-amber-400'}`} style={{ width: `${Math.min(paceVsMonth, 100)}%` }} />
                      <div className="absolute top-0 h-full w-px bg-blue-400 opacity-60" style={{ left: `${monthProgress}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="text-[10px] text-gray-400 mt-3">{currentLanguage === 'tr' ? 'Mavi çizgi = ayın şu anki günü. Yeşil = hedefin önünde, Sarı = hedefin gerisinde.' : 'Blue line = current day in month. Green = ahead of pace, Amber = behind pace.'}</p>
          </div>
        );
      })()}

      {/* ── Phase 226: Sales Conversion Timeline ── */}
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

      {/* ── Phase 227: Inventory Turnover by Category ── */}
      {reportsTab === 'envanter' && inventory.length > 0 && orders.length >= 3 && (() => {
        const now227 = new Date();
        const days227 = 90;
        const cutoff227 = new Date(now227); cutoff227.setDate(cutoff227.getDate() - days227);
        const catSales: Record<string, number> = {};
        const catCost: Record<string, number> = {};
        for (const o of orders) {
          if (o.status === 'Cancelled') continue;
          try {
            const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
            if (od < cutoff227) continue;
            for (const li of (o.lineItems ?? [])) {
              const inv = inventory.find(ii => ii.id === li.inventoryId || ii.name === li.name);
              const cat = inv?.category || (currentLanguage === 'tr' ? 'Diğer' : 'Other');
              catSales[cat] = (catSales[cat] ?? 0) + (inv ? itemCostTRY(inv, exchangeRates) : li.price * 0.6) * li.quantity;
            }
          } catch { /* skip */ }
        }
        for (const i of inventory) {
          const cat = i.category || (currentLanguage === 'tr' ? 'Diğer' : 'Other');
          catCost[cat] = (catCost[cat] ?? 0) + itemCostTRY(i, exchangeRates) * (i.stockLevel ?? 0);
        }
        const cats227 = Object.keys({ ...catSales, ...catCost });
        const turnoverList = cats227
          .map(cat => {
            const cogs = catSales[cat] ?? 0;
            const avgInv = catCost[cat] ?? 0;
            const annualCOGS = avgInv > 0 ? (cogs / days227) * 365 : 0;
            const turnover = avgInv > 0 ? Math.round((annualCOGS / avgInv) * 10) / 10 : 0;
            return { cat, turnover, cogs, avgInv };
          })
          .filter(c => c.turnover > 0 || c.avgInv > 0)
          .sort((a, b) => b.turnover - a.turnover)
          .slice(0, 7);
        if (turnoverList.length < 2) return null;
        const maxTurnover227 = Math.max(...turnoverList.map(c => c.turnover), 1);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-4">{currentLanguage === 'tr' ? '🔄 Kategoriye Göre Stok Devir Hızı (Yıllık)' : '🔄 Inventory Turnover by Category (Annual)'}</h3>
            <div className="space-y-2.5">
              {turnoverList.map(c => (
                <div key={c.cat}>
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-xs font-medium text-gray-700 truncate">{c.cat}</span>
                    <div className="flex items-center gap-2 shrink-0 ml-2">
                      <span className="text-[10px] text-gray-400">{fmtAna(c.avgInv,'K',0)} stok</span>
                      <span className={`text-sm font-black ${c.turnover >= 6 ? 'text-emerald-600' : c.turnover >= 3 ? 'text-amber-600' : 'text-red-500'}`}>{c.turnover}×</span>
                    </div>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${c.turnover >= 6 ? 'bg-emerald-400' : c.turnover >= 3 ? 'bg-amber-400' : 'bg-red-300'}`} style={{ width: `${Math.max(4, Math.round((c.turnover / maxTurnover227) * 100))}%` }} />
                  </div>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-gray-400 mt-3">{currentLanguage === 'tr' ? 'Benchmark: ≥6× iyi, 3-6× orta, <3× yavaş stok devri (B2B)' : 'Benchmark: ≥6× good, 3-6× average, <3× slow (B2B)'}</p>
          </div>
        );
      })()}

      {/* ── Phase 228: Sales Trend by Customer Tier ── */}
      {reportsTab === 'crm' && orders.length >= 5 && (() => {
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
      })()}

      {/* ── Phase 229: Order Lead Time by Status ── */}
      {reportsTab === 'lojistik' && orders.length >= 5 && (() => {
        const now229 = new Date();
        // Avg days from Pending → each subsequent status
        const openOrders = orders.filter(o => o.status !== 'Delivered' && o.status !== 'Cancelled');
        const ageBuckets: Record<string, { total: number; count: number }> = {
          Pending: { total: 0, count: 0 },
          Processing: { total: 0, count: 0 },
          Shipped: { total: 0, count: 0 },
        };
        for (const o of openOrders) {
          if (!ageBuckets[o.status]) continue;
          try {
            const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
            const days = Math.round((now229.getTime() - od.getTime()) / 86400000);
            ageBuckets[o.status].total += days;
            ageBuckets[o.status].count++;
          } catch { /* skip */ }
        }
        const statusInfo: Record<string, { label: string; color: string; warn: number }> = {
          Pending: { label: currentLanguage === 'tr' ? 'Beklemede' : 'Pending', color: 'bg-gray-400', warn: 3 },
          Processing: { label: currentLanguage === 'tr' ? 'İşleniyor' : 'Processing', color: 'bg-blue-400', warn: 5 },
          Shipped: { label: currentLanguage === 'tr' ? 'Kargoda' : 'Shipped', color: 'bg-amber-400', warn: 7 },
        };
        const hasData = Object.values(ageBuckets).some(b => b.count > 0);
        if (!hasData) return null;
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '📊 Statüye Göre Bekleyen Sipariş Yaşı' : '📊 Open Order Age by Status'}</h3>
              <span className="text-xs text-gray-400">{openOrders.length} {currentLanguage === 'tr' ? 'açık sipariş' : 'open orders'}</span>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {Object.entries(ageBuckets).map(([status, d]) => {
                const avg = d.count > 0 ? Math.round(d.total / d.count) : 0;
                const info = statusInfo[status];
                const isWarn = avg > info.warn;
                return (
                  <div key={status} className={`rounded-xl p-4 ${isWarn ? 'bg-red-50 border border-red-100' : 'bg-gray-50'}`}>
                    <div className={`w-2 h-2 rounded-full ${info.color} mb-2`} />
                    <p className={`text-2xl font-black ${isWarn ? 'text-red-600' : 'text-gray-700'}`}>{d.count > 0 ? avg : '—'}{d.count > 0 ? (currentLanguage === 'tr' ? 'g' : 'd') : ''}</p>
                    <p className="text-[10px] text-gray-600 font-medium mt-0.5">{info.label}</p>
                    <p className="text-[9px] text-gray-400">{d.count} {currentLanguage === 'tr' ? 'sipariş' : 'orders'}</p>
                    {isWarn && <p className="text-[9px] text-red-500 font-bold mt-1">{'⚠ >'}{info.warn}{currentLanguage === 'tr' ? 'g' : 'd'}</p>}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 230: Net Revenue Retention (NRR) ── */}
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

      {/* ── Phase 231: Price Sensitivity Analysis ── */}
      {reportsTab === 'envanter' && orders.length >= 5 && inventory.length > 0 && (() => {
        // Compare avg selling price vs list price per product to gauge price sensitivity
        const prodPricing: Record<string, { listPrice: number; totalRev: number; totalQty: number; name: string }> = {};
        for (const o of orders) {
          if (o.status === 'Cancelled') continue;
          for (const li of (o.lineItems ?? [])) {
            const inv = inventory.find(ii => ii.id === li.inventoryId || ii.name === li.name);
            if (!inv) continue;
            const key = inv.id;
            const listP = inv.prices?.['Retail'] ?? inv.price ?? li.price;
            if (!prodPricing[key]) prodPricing[key] = { listPrice: listP, totalRev: 0, totalQty: 0, name: inv.name };
            prodPricing[key].totalRev += li.price * li.quantity;
            prodPricing[key].totalQty += li.quantity;
          }
        }
        const pricingList = Object.values(prodPricing)
          .filter(p => p.totalQty > 0 && p.listPrice > 0)
          .map(p => {
            const avgSellPrice = p.totalRev / p.totalQty;
            const discount = Math.round(((p.listPrice - avgSellPrice) / p.listPrice) * 100);
            return { name: p.name, listPrice: p.listPrice, avgSellPrice: Math.round(avgSellPrice), discount };
          })
          .filter(p => Math.abs(p.discount) > 0)
          .sort((a, b) => b.discount - a.discount)
          .slice(0, 7);
        if (pricingList.length < 2) return null;
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '💲 Fiyat Hassasiyet Analizi' : '💲 Price Sensitivity Analysis'}</h3>
              <span className="text-[10px] text-gray-400">{currentLanguage === 'tr' ? 'Liste fiyatı vs ortalama satış fiyatı' : 'List price vs avg selling price'}</span>
            </div>
            <div className="space-y-2.5">
              {pricingList.map(p => (
                <div key={p.name} className="flex items-center gap-2">
                  <span className="text-xs text-gray-700 truncate flex-1">{p.name}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[10px] text-gray-400">{fmtAna(p.avgSellPrice)}</span>
                    <span className={`text-xs font-bold ${p.discount > 0 ? 'text-red-500' : 'text-emerald-600'}`}>
                      {p.discount > 0 ? `-${p.discount}%` : `+${Math.abs(p.discount)}%`}
                    </span>
                  </div>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-gray-400 mt-3">{currentLanguage === 'tr' ? 'Eksi % = liste altı satış (iskonto). Artı % = liste üstü satış.' : 'Negative % = sold below list (discounted). Positive % = sold above list.'}</p>
          </div>
        );
      })()}

      {/* ── Phase 232: Customer Risk Score ── */}
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

      {/* ── Phase 233: Payroll Efficiency Score ── */}
      {reportsTab === 'ik' && employees.length > 0 && orders.length >= 3 && (() => {
        const now233 = new Date();
        const months233 = 3;
        const cutoff233 = new Date(now233.getFullYear(), now233.getMonth() - months233, 1);
        const recentRev = orders.filter(o => {
          if (o.status === 'Cancelled') return false;
          try {
            const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
            return od >= cutoff233;
          } catch { return false; }
        }).reduce((s, o) => s + (o.totalPrice || 0), 0);
        const activeEmps233 = employees.filter(e => e.status === 'Aktif');
        const totalPayroll233 = activeEmps233.reduce((s, e) => s + (e.salary || 0), 0) * months233;
        const efficiency = totalPayroll233 > 0 ? Math.round((recentRev / totalPayroll233) * 100) / 100 : 0;
        // By department
        const deptEff: Record<string, { rev: number; payroll: number }> = {};
        for (const o of orders) {
          if (o.status === 'Cancelled') continue;
          const rep = (o.assignedTo as string | undefined) || '';
          if (!rep) continue;
          const emp = activeEmps233.find(e => e.name === rep || e.email === rep);
          if (!emp?.department) continue;
          const dept = emp.department;
          if (!deptEff[dept]) deptEff[dept] = { rev: 0, payroll: 0 };
          deptEff[dept].rev += o.totalPrice || 0;
        }
        for (const e of activeEmps233) {
          if (!e.department) continue;
          if (!deptEff[e.department]) deptEff[e.department] = { rev: 0, payroll: 0 };
          deptEff[e.department].payroll += (e.salary || 0) * months233;
        }
        const deptList233 = Object.entries(deptEff)
          .filter(([,d]) => d.payroll > 0)
          .map(([dept, d]) => ({ dept, eff: d.payroll > 0 ? Math.round((d.rev / d.payroll) * 100) / 100 : 0, rev: d.rev, payroll: d.payroll }))
          .sort((a, b) => b.eff - a.eff)
          .slice(0, 5);
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '⚡ Personel Verimlilik Skoru' : '⚡ Payroll Efficiency Score'}</h3>
              <span className={`text-2xl font-black ${efficiency >= 3 ? 'text-emerald-600' : efficiency >= 1.5 ? 'text-amber-500' : 'text-red-500'}`}>{efficiency}×</span>
            </div>
            <p className="text-[11px] text-gray-500 mb-4">{currentLanguage === 'tr' ? `Son ${months233} ayda ₺${(recentRev/1000).toFixed(0)}K ciro / ₺${(totalPayroll233/1000).toFixed(0)}K maaş kütlesi` : `Last ${months233} months: ₺${(recentRev/1000).toFixed(0)}K revenue / ₺${(totalPayroll233/1000).toFixed(0)}K payroll`}</p>
            {deptList233.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-gray-600 mb-1">{currentLanguage === 'tr' ? 'Departmana Göre:' : 'By Department:'}</p>
                {deptList233.map(d => (
                  <div key={d.dept} className="flex items-center justify-between text-xs">
                    <span className="text-gray-700 truncate">{d.dept}</span>
                    <div className="flex items-center gap-2 shrink-0 ml-2">
                      <div className="w-20 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${d.eff >= 3 ? 'bg-emerald-400' : d.eff >= 1.5 ? 'bg-amber-400' : 'bg-red-300'}`} style={{ width: `${Math.min(100, Math.round(d.eff * 20))}%` }} />
                      </div>
                      <span className={`font-bold w-10 text-right ${d.eff >= 3 ? 'text-emerald-600' : d.eff >= 1.5 ? 'text-amber-600' : 'text-red-500'}`}>{d.eff}×</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <p className="text-[10px] text-gray-400 mt-3">{currentLanguage === 'tr' ? 'Benchmark: 3x+ mükemmel, 2-3x iyi, 1.5-2x orta, <1.5x geliştirme gerekiyor' : 'Benchmark: 3x+ excellent, 2-3x good, 1.5-2x fair, <1.5x needs improvement'}</p>
          </div>
        );
      })()}

      {/* ── Phase 234: Weekly Revenue Run Rate ── */}
      {reportsTab === 'genel' && orders.length >= 5 && (() => {
        const now234 = new Date();
        // Last 8 weeks
        const weeks234 = Array.from({ length: 8 }, (_, i) => {
          const weekStart = new Date(now234);
          weekStart.setDate(weekStart.getDate() - (7 - i) * 7 - weekStart.getDay());
          weekStart.setHours(0, 0, 0, 0);
          const weekEnd = new Date(weekStart); weekEnd.setDate(weekEnd.getDate() + 6); weekEnd.setHours(23, 59, 59, 999);
          const label = `W${weekStart.toLocaleDateString(currentLanguage === 'tr' ? 'tr-TR' : 'en-US', { month: 'short', day: 'numeric' })}`;
          const rev = orders.filter(o => {
            if (o.status === 'Cancelled') return false;
            try {
              const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
              return od >= weekStart && od <= weekEnd;
            } catch { return false; }
          }).reduce((s, o) => s + (o.totalPrice || 0), 0);
          return { label, rev, weekStart };
        });
        const hasData = weeks234.some(w => w.rev > 0);
        if (!hasData) return null;
        const maxWeekRev = Math.max(...weeks234.map(w => w.rev), 1);
        const lastWeek = weeks234[weeks234.length - 1].rev;
        const prevWeek = weeks234[weeks234.length - 2].rev;
        const weekGrowth = prevWeek > 0 ? Math.round(((lastWeek - prevWeek) / prevWeek) * 100) : null;
        const annualRunRate = lastWeek * 52;
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '📅 Haftalık Ciro & Yıllık Projeksiyon' : '📅 Weekly Revenue & Annual Run Rate'}</h3>
              {weekGrowth !== null && (
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${weekGrowth >= 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                  {weekGrowth >= 0 ? '↑' : '↓'} %{Math.abs(weekGrowth)} WoW
                </span>
              )}
            </div>
            <div className="flex items-end gap-1.5 h-24 mb-3">
              {weeks234.map((w, i) => {
                const isLatest = i === weeks234.length - 1;
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1">
                    <div className="w-full flex items-end" style={{ height: '68px' }}>
                      <div className={`w-full rounded-t-md ${isLatest ? 'bg-brand' : 'bg-gray-200'}`} style={{ height: `${Math.max(4, Math.round((w.rev / maxWeekRev) * 68))}px` }} />
                    </div>
                    <span className={`text-[8px] leading-none ${isLatest ? 'font-bold text-brand' : 'text-gray-400'}`}>{w.label}</span>
                  </div>
                );
              })}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-gray-50 rounded-xl p-3 text-center">
                <p className="text-xl font-black text-gray-700">{fmtAna(lastWeek,'K',0)}</p>
                <p className="text-[10px] text-gray-400">{currentLanguage === 'tr' ? 'Bu hafta' : 'This week'}</p>
              </div>
              <div className="bg-blue-50 rounded-xl p-3 text-center">
                <p className="text-xl font-black text-blue-600">{fmtAna(annualRunRate,'K',0)}</p>
                <p className="text-[10px] text-gray-400">{currentLanguage === 'tr' ? 'Yıllık projeksiyon' : 'Annual run rate'}</p>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Phase 235: Margin Bridge Analysis ── */}
      {reportsTab === 'genel' && orders.length >= 5 && inventory.length > 0 && (() => {
        const now235 = new Date();
        const prevMonthStart235 = new Date(now235.getFullYear(), now235.getMonth() - 1, 1);
        const prevMonthEnd235 = new Date(now235.getFullYear(), now235.getMonth(), 0, 23, 59, 59);
        const currMonthStart235 = new Date(now235.getFullYear(), now235.getMonth(), 1);
        const calcMargin = (ordersList: Order[]) => {
          const rev = ordersList.reduce((s, o) => s + (o.totalPrice || 0), 0);
          const cogs = ordersList.reduce((s, o) =>
            s + (o.lineItems ?? []).reduce((ls, li) => {
              const inv = inventory.find(ii => ii.id === li.inventoryId || ii.name === li.name);
              return ls + (inv ? itemCostTRY(inv, exchangeRates) : li.price * 0.6) * li.quantity;
            }, 0), 0);
          return { rev, cogs, margin: rev > 0 ? Math.round(((rev - cogs) / rev) * 100) : 0, gross: rev - cogs };
        };
        const filterOrders = (start: Date, end: Date) => orders.filter(o => {
          if (o.status === 'Cancelled') return false;
          try {
            const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
            return od >= start && od <= end;
          } catch { return false; }
        });
        const prev235 = calcMargin(filterOrders(prevMonthStart235, prevMonthEnd235));
        const curr235 = calcMargin(filterOrders(currMonthStart235, new Date()));
        if (prev235.rev === 0 && curr235.rev === 0) return null;
        const revChange = curr235.rev - prev235.rev;
        const grossChange = curr235.gross - prev235.gross;
        const marginChange = curr235.margin - prev235.margin;
        const bridges = [
          { label: currentLanguage === 'tr' ? 'Önceki Ay Brüt Kâr' : 'Prior Month Gross Profit', value: prev235.gross, neutral: true },
          { label: currentLanguage === 'tr' ? 'Ciro Değişimi Etkisi' : 'Revenue Volume Effect', value: revChange * (prev235.margin / 100), neutral: false },
          { label: currentLanguage === 'tr' ? 'Marj Değişimi Etkisi' : 'Margin Mix Effect', value: grossChange - revChange * (prev235.margin / 100), neutral: false },
          { label: currentLanguage === 'tr' ? 'Bu Ay Brüt Kâr' : 'Current Month Gross Profit', value: curr235.gross, neutral: true, total: true },
        ];
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '🌉 Marj Köprü Analizi (MoM)' : '🌉 Margin Bridge Analysis (MoM)'}</h3>
              <span className={`text-sm font-bold px-2 py-0.5 rounded-full ${marginChange >= 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                {marginChange >= 0 ? '+' : ''}{marginChange}pp {currentLanguage === 'tr' ? 'marj' : 'margin'}
              </span>
            </div>
            <div className="space-y-2">
              {bridges.map((b, i) => (
                <div key={i} className={`flex items-center justify-between p-2.5 rounded-xl ${b.total ? 'bg-blue-50' : b.neutral ? 'bg-gray-50' : b.value >= 0 ? 'bg-emerald-50' : 'bg-red-50'}`}>
                  <span className={`text-xs font-medium ${b.total ? 'text-blue-800 font-bold' : 'text-gray-700'}`}>{b.label}</span>
                  <span className={`text-sm font-bold shrink-0 ml-2 ${b.total ? 'text-blue-700' : b.neutral ? 'text-gray-700' : b.value >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                    {!b.neutral && b.value >= 0 ? '+' : ''}{b.neutral ? '' : b.value >= 0 ? '' : ''}{fmtAna(Math.abs(b.value),'K',0)}{!b.neutral && b.value < 0 ? ' ▼' : !b.neutral ? ' ▲' : ''}
                  </span>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-4 mt-3 text-[10px] text-gray-500">
              <span>{currentLanguage === 'tr' ? 'Önceki: ' : 'Prior: '}{fmtAna(prev235.rev,'K',0)} · %{prev235.margin}</span>
              <span>{currentLanguage === 'tr' ? 'Bu ay: ' : 'Current: '}{fmtAna(curr235.rev,'K',0)} · %{curr235.margin}</span>
            </div>
          </div>
        );
      })()}

      {/* ── Phase 236: Demand Forecast Accuracy ── */}
      {reportsTab === 'envanter' && orders.length >= 10 && inventory.length > 0 && (() => {
        const now236 = new Date();
        // Compare projected (last month run rate) vs actual this month per category
        const prevMonthStart236 = new Date(now236.getFullYear(), now236.getMonth() - 1, 1);
        const prevMonthEnd236 = new Date(now236.getFullYear(), now236.getMonth(), 0, 23, 59, 59);
        const currMonthStart236 = new Date(now236.getFullYear(), now236.getMonth(), 1);
        const getCatQty = (start: Date, end: Date) => {
          const catQty: Record<string, number> = {};
          for (const o of orders) {
            if (o.status === 'Cancelled') continue;
            try {
              const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
              if (od < start || od > end) continue;
              for (const li of (o.lineItems ?? [])) {
                const inv = inventory.find(ii => ii.id === li.inventoryId || ii.name === li.name);
                const cat = inv?.category || 'Other';
                catQty[cat] = (catQty[cat] ?? 0) + li.quantity;
              }
            } catch { /* skip */ }
          }
          return catQty;
        };
        const prevQty = getCatQty(prevMonthStart236, prevMonthEnd236);
        const currQty = getCatQty(currMonthStart236, new Date());
        const daysElapsed = now236.getDate();
        const daysInMonth236 = new Date(now236.getFullYear(), now236.getMonth() + 1, 0).getDate();
        const cats236 = Object.keys(prevQty);
        if (cats236.length < 2) return null;
        const accuracyList = cats236.map(cat => {
          const projected = Math.round((prevQty[cat] ?? 0) * (daysElapsed / daysInMonth236));
          const actual = currQty[cat] ?? 0;
          const accuracy = projected > 0 ? Math.round((Math.min(actual, projected) / Math.max(actual, projected)) * 100) : null;
          return { cat, projected, actual, accuracy };
        }).filter(c => c.projected > 0 || c.actual > 0).sort((a, b) => (b.accuracy ?? 0) - (a.accuracy ?? 0)).slice(0, 6);
        const avgAccuracy = accuracyList.filter(c => c.accuracy !== null).reduce((s, c) => s + (c.accuracy ?? 0), 0) / Math.max(accuracyList.filter(c => c.accuracy !== null).length, 1);
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '🎯 Talep Tahmin Doğruluğu' : '🎯 Demand Forecast Accuracy'}</h3>
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${avgAccuracy >= 80 ? 'bg-emerald-100 text-emerald-700' : avgAccuracy >= 60 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-600'}`}>
                Ø %{Math.round(avgAccuracy)} {currentLanguage === 'tr' ? 'doğruluk' : 'accuracy'}
              </span>
            </div>
            <div className="space-y-2.5">
              {accuracyList.map(c => (
                <div key={c.cat}>
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-xs font-medium text-gray-700 truncate">{c.cat}</span>
                    <div className="flex items-center gap-2 shrink-0 ml-2">
                      <span className="text-[10px] text-gray-400">{c.actual} / {c.projected} {currentLanguage === 'tr' ? 'adet' : 'units'}</span>
                      {c.accuracy !== null && <span className={`text-xs font-bold ${c.accuracy >= 80 ? 'text-emerald-600' : c.accuracy >= 60 ? 'text-amber-600' : 'text-red-500'}`}>%{c.accuracy}</span>}
                    </div>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${(c.accuracy ?? 0) >= 80 ? 'bg-emerald-400' : (c.accuracy ?? 0) >= 60 ? 'bg-amber-400' : 'bg-red-300'}`} style={{ width: `${Math.max(4, c.accuracy ?? 0)}%` }} />
                  </div>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-gray-400 mt-3">{currentLanguage === 'tr' ? 'Tahmin: geçen ay çıkış hızı × bu ayın geçen gün sayısı' : 'Forecast: prior month run rate × days elapsed this month'}</p>
          </div>
        );
      })()}

      {/* ── Phase 237: Customer Purchase Frequency Distribution ── */}
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

      {/* ── Phase 238: Inventory Health Score ── */}
      {reportsTab === 'envanter' && inventory.length > 0 && (() => {
        const now238 = new Date();
        const scores238 = inventory.map(i => {
          let score = 100;
          // Low stock penalty
          if ((i.stockLevel ?? 0) <= (i.lowStockThreshold ?? i.minStock ?? 5)) score -= 30;
          // No cost price penalty
          if (!i.costPrice && !i.cost) score -= 20;
          // No category penalty
          if (!i.category) score -= 10;
          // Expiry penalty
          if (i.expiryDate) {
            const daysLeft = Math.round((new Date(i.expiryDate).getTime() - now238.getTime()) / 86400000);
            if (daysLeft < 0) score -= 40;
            else if (daysLeft < 30) score -= 25;
            else if (daysLeft < 90) score -= 10;
          }
          return { name: i.name, score: Math.max(0, score), category: i.category ?? '—', stock: i.stockLevel ?? 0 };
        });
        const avgScore = Math.round(scores238.reduce((s, i) => s + i.score, 0) / Math.max(scores238.length, 1));
        const excellent = scores238.filter(i => i.score >= 80).length;
        const warning = scores238.filter(i => i.score >= 50 && i.score < 80).length;
        const critical = scores238.filter(i => i.score < 50).length;
        const worstItems = scores238.filter(i => i.score < 70).sort((a, b) => a.score - b.score).slice(0, 5);
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '🏥 Stok Sağlık Skoru' : '🏥 Inventory Health Score'}</h3>
              <span className={`text-2xl font-black ${avgScore >= 80 ? 'text-emerald-600' : avgScore >= 60 ? 'text-amber-500' : 'text-red-500'}`}>{avgScore}/100</span>
            </div>
            <div className="grid grid-cols-3 gap-3 mb-4">
              {[
                { label: currentLanguage === 'tr' ? 'Sağlıklı' : 'Healthy', value: excellent, color: 'text-emerald-600', bg: 'bg-emerald-50' },
                { label: currentLanguage === 'tr' ? 'Dikkat' : 'Warning', value: warning, color: 'text-amber-600', bg: 'bg-amber-50' },
                { label: currentLanguage === 'tr' ? 'Kritik' : 'Critical', value: critical, color: 'text-red-600', bg: 'bg-red-50' },
              ].map(k => (
                <div key={k.label} className={`${k.bg} rounded-xl p-3 text-center`}>
                  <p className={`text-xl font-bold ${k.color}`}>{k.value}</p>
                  <p className="text-[10px] text-gray-500 mt-0.5">{k.label}</p>
                </div>
              ))}
            </div>
            {worstItems.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-600 mb-2">{currentLanguage === 'tr' ? 'İyileştirme Gereken Ürünler:' : 'Items Needing Attention:'}</p>
                <div className="space-y-1.5">
                  {worstItems.map(item => (
                    <div key={item.name} className="flex items-center justify-between text-xs">
                      <span className="text-gray-700 truncate">{item.name}</span>
                      <span className={`font-bold px-1.5 py-0.5 rounded-full shrink-0 ml-2 ${item.score < 50 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>{item.score}/100</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* ── Phase 239: Financial Health Dashboard ── */}
      {reportsTab === 'genel' && orders.length >= 5 && inventory.length > 0 && (() => {
        const now239 = new Date();
        const months3Start = new Date(now239.getFullYear(), now239.getMonth() - 3, 1);
        const recentOrders = orders.filter(o => {
          if (o.status === 'Cancelled') return false;
          try {
            const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
            return od >= months3Start;
          } catch { return false; }
        });
        const revenue239 = recentOrders.reduce((s, o) => s + (o.totalPrice || 0), 0);
        const cogs239 = recentOrders.reduce((s, o) =>
          s + (o.lineItems ?? []).reduce((ls, li) => {
            const inv = inventory.find(ii => ii.id === li.inventoryId || ii.name === li.name);
            return ls + (inv ? itemCostTRY(inv, exchangeRates) : li.price * 0.6) * li.quantity;
          }, 0), 0);
        const grossProfit = revenue239 - cogs239;
        const grossMargin = revenue239 > 0 ? Math.round((grossProfit / revenue239) * 100) : 0;
        const inventoryVal239 = inventory.reduce((s, i) => s + itemCostTRY(i, exchangeRates) * (i.stockLevel ?? 0), 0);
        const arVal = orders.filter(o => o.status !== 'Cancelled' && o.status !== 'Delivered').reduce((s, o) => s + (o.totalPrice || 0), 0);
        const monthlyRevRate = revenue239 / 3;
        const kpis239 = [
          { label: 'Gross Margin', value: `%${grossMargin}`, score: grossMargin >= 30 ? 'A' : grossMargin >= 20 ? 'B' : grossMargin >= 10 ? 'C' : 'D', desc: currentLanguage === 'tr' ? 'Brüt marj' : 'Gross margin' },
          { label: 'Revenue Trend', value: revenue239 > 0 ? '▲' : '—', score: revenue239 > monthlyRevRate * 2.5 ? 'A' : revenue239 > monthlyRevRate ? 'B' : 'C', desc: currentLanguage === 'tr' ? '3 aylık ciro' : '3-month revenue' },
          { label: 'AR Health', value: arVal > 0 ? `₺${(arVal/1000).toFixed(0)}K` : '✓', score: arVal <= monthlyRevRate * 0.5 ? 'A' : arVal <= monthlyRevRate ? 'B' : 'C', desc: currentLanguage === 'tr' ? 'Tahsilat bekleyen' : 'Outstanding AR' },
          { label: 'Inventory', value: `₺${(inventoryVal239/1000).toFixed(0)}K`, score: inventoryVal239 <= cogs239 * 1.5 ? 'A' : inventoryVal239 <= cogs239 * 2.5 ? 'B' : 'C', desc: currentLanguage === 'tr' ? 'Stok değeri' : 'Stock value' },
        ];
        const gradeColor: Record<string, string> = { A: 'text-emerald-600 bg-emerald-100', B: 'text-blue-600 bg-blue-100', C: 'text-amber-600 bg-amber-100', D: 'text-red-600 bg-red-100' };
        const overallScore = Math.round(['A','B','C','D'].map((g, i) => kpis239.filter(k => k.score === g).length * (4 - i)).reduce((s, v) => s + v, 0) / kpis239.length);
        const overallGrade = overallScore >= 3.5 ? 'A' : overallScore >= 2.5 ? 'B' : overallScore >= 1.5 ? 'C' : 'D';
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '🏦 Finansal Sağlık Göstergesi' : '🏦 Financial Health Dashboard'}</h3>
              <span className={`text-2xl font-black px-3 py-1 rounded-xl ${gradeColor[overallGrade]}`}>{overallGrade}</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {kpis239.map(k => (
                <div key={k.label} className="bg-gray-50 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">{k.label}</p>
                    <span className={`text-xs font-black px-1.5 py-0.5 rounded ${gradeColor[k.score]}`}>{k.score}</span>
                  </div>
                  <p className="text-xl font-black text-gray-700">{k.value}</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">{k.desc}</p>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 240: Order Repeat Rate Analysis ── */}
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

      {/* ── Phase 241: Product Launch Performance Tracker ── */}
      {reportsTab === 'envanter' && inventory.length > 0 && orders.length >= 5 && (() => {
        const now241 = new Date();
        const recent90 = new Date(now241); recent90.setDate(recent90.getDate() - 90);
        // Products added to inventory in last 90 days (new launches)
        const newProducts = inventory.filter(i => {
          const m = i as unknown as Record<string,unknown>;
          const createdAt = m.createdAt;
          if (!createdAt) return false;
          try {
            const d = (createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(createdAt as string);
            return d >= recent90;
          } catch { return false; }
        });
        if (newProducts.length === 0) return null;
        // Revenue generated by new products
        const newProdRevMap: Record<string, number> = {};
        for (const o of orders) {
          if (o.status === 'Cancelled') continue;
          for (const li of (o.lineItems ?? [])) {
            const isNew = newProducts.some(p => p.id === li.inventoryId || p.name === li.name);
            if (!isNew) continue;
            const key = li.name || li.inventoryId || '';
            newProdRevMap[key] = (newProdRevMap[key] ?? 0) + li.price * li.quantity;
          }
        }
        const launches = newProducts.map(p => ({
          name: p.name,
          rev: newProdRevMap[p.name] ?? newProdRevMap[p.id] ?? 0,
          stock: p.stockLevel ?? 0,
          category: p.category ?? '—',
        })).sort((a, b) => b.rev - a.rev).slice(0, 6);
        const totalLaunchRev = launches.reduce((s, l) => s + l.rev, 0);
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '🚀 Yeni Ürün Lansmanı Takibi (Son 90 Gün)' : '🚀 New Product Launch Tracker (Last 90 Days)'}</h3>
              <span className="text-xs font-bold text-purple-700 bg-purple-50 px-2 py-0.5 rounded-full">{newProducts.length} {currentLanguage === 'tr' ? 'yeni ürün' : 'new products'}</span>
            </div>
            <div className="space-y-2.5 mb-3">
              {launches.map(l => (
                <div key={l.name} className="flex items-center justify-between py-1 border-b border-gray-50 last:border-0">
                  <div>
                    <p className="text-xs font-medium text-gray-800">{l.name}</p>
                    <p className="text-[10px] text-gray-400">{l.category} · {l.stock} {currentLanguage === 'tr' ? 'stok' : 'in stock'}</p>
                  </div>
                  <span className={`text-xs font-bold shrink-0 ml-2 ${l.rev > 0 ? 'text-emerald-600' : 'text-gray-400'}`}>
                    {l.rev > 0 ? `₺${(l.rev/1000).toFixed(0)}K` : (currentLanguage === 'tr' ? 'Satış yok' : 'No sales')}
                  </span>
                </div>
              ))}
            </div>
            <div className="p-3 bg-purple-50 rounded-xl flex items-center justify-between">
              <span className="text-xs text-purple-700 font-medium">{currentLanguage === 'tr' ? 'Yeni ürün toplam cirosu' : 'Total new product revenue'}</span>
              <span className="text-sm font-black text-purple-700">{fmtAna(totalLaunchRev,'K',0)}</span>
            </div>
          </div>
        );
      })()}

      {/* ── Phase 242: Quota Attainment vs Pipeline ── */}
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

      {/* ── Phase 243: Logistics On-Time Delivery Rate ── */}
      {reportsTab === 'lojistik' && orders.length >= 5 && (() => {
        // Orders with deliveredAt vs expectedDelivery or estimatedDelivery
        const deliveredOrders = orders.filter(o => {
          const m = o as unknown as Record<string,unknown>;
          return o.status === 'Delivered' && (m.deliveredAt || m.updatedAt) && (m.expectedDelivery || m.estimatedDelivery || m.promisedDate);
        });
        if (deliveredOrders.length < 2) {
          // Show basic delivered vs total breakdown instead
          const total243 = orders.length;
          const delivered243 = orders.filter(o => o.status === 'Delivered').length;
          const inTransit243 = orders.filter(o => o.status === 'Shipped').length;
          const pending243 = orders.filter(o => o.status === 'Pending' || o.status === 'Processing').length;
          return (
            <div className="apple-card p-6">
              <h3 className="font-bold text-gray-800 mb-4">{currentLanguage === 'tr' ? '🚚 Lojistik Performans Özeti' : '🚚 Logistics Performance Summary'}</h3>
              <div className="grid grid-cols-4 gap-3">
                {[
                  { label: currentLanguage === 'tr' ? 'Toplam' : 'Total', value: total243, color: 'text-gray-700' },
                  { label: currentLanguage === 'tr' ? 'Teslim' : 'Delivered', value: delivered243, color: 'text-emerald-600' },
                  { label: currentLanguage === 'tr' ? 'Kargoda' : 'In Transit', value: inTransit243, color: 'text-blue-600' },
                  { label: currentLanguage === 'tr' ? 'Bekleyen' : 'Pending', value: pending243, color: 'text-amber-600' },
                ].map(k => (
                  <div key={k.label} className="bg-gray-50 rounded-xl p-3 text-center">
                    <p className={`text-2xl font-bold ${k.color}`}>{k.value}</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">{k.label}</p>
                  </div>
                ))}
              </div>
              <div className="mt-4">
                <p className="text-xs font-medium text-gray-600 mb-2">{currentLanguage === 'tr' ? 'Teslim Performansı' : 'Delivery Performance'}</p>
                <div className="h-3 bg-gray-100 rounded-full overflow-hidden flex gap-px">
                  <div className="h-full bg-emerald-400" style={{ width: `${total243 > 0 ? Math.round((delivered243/total243)*100) : 0}%` }} />
                  <div className="h-full bg-blue-300" style={{ width: `${total243 > 0 ? Math.round((inTransit243/total243)*100) : 0}%` }} />
                  <div className="h-full bg-amber-300" style={{ width: `${total243 > 0 ? Math.round((pending243/total243)*100) : 0}%` }} />
                </div>
              </div>
            </div>
          );
        }
        let onTime = 0;
        for (const o of deliveredOrders) {
          const m = o as unknown as Record<string,unknown>;
          try {
            const deliveredDate = ((m.deliveredAt as { toDate?: () => Date })?.toDate?.() ?? new Date(m.deliveredAt as string))
              || ((m.updatedAt as { toDate?: () => Date })?.toDate?.() ?? new Date(m.updatedAt as string));
            const expectedDate = ((m.expectedDelivery as { toDate?: () => Date })?.toDate?.() ?? new Date(m.expectedDelivery as string))
              || ((m.estimatedDelivery as { toDate?: () => Date })?.toDate?.() ?? new Date(m.estimatedDelivery as string));
            if (deliveredDate <= expectedDate) onTime++;
          } catch { /* skip */ }
        }
        const otdRate = deliveredOrders.length > 0 ? Math.round((onTime / deliveredOrders.length) * 100) : 0;
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '✅ Zamanında Teslimat Oranı (OTD)' : '✅ On-Time Delivery Rate (OTD)'}</h3>
              <span className={`text-2xl font-black ${otdRate >= 90 ? 'text-emerald-600' : otdRate >= 75 ? 'text-amber-500' : 'text-red-500'}`}>%{otdRate}</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-emerald-50 rounded-xl p-4 text-center">
                <p className="text-2xl font-bold text-emerald-600">{onTime}</p>
                <p className="text-[10px] text-gray-500">{currentLanguage === 'tr' ? 'Zamanında' : 'On Time'}</p>
              </div>
              <div className="bg-red-50 rounded-xl p-4 text-center">
                <p className="text-2xl font-bold text-red-500">{deliveredOrders.length - onTime}</p>
                <p className="text-[10px] text-gray-500">{currentLanguage === 'tr' ? 'Gecikmeli' : 'Late'}</p>
              </div>
            </div>
            <p className="text-[10px] text-gray-400 mt-3">{currentLanguage === 'tr' ? 'Benchmark: %95+ (dünya standartı)' : 'Benchmark: 95%+ (world class OTD)'}</p>
          </div>
        );
      })()}

      {/* ── Phase 244: Cross-Sell Opportunity Matrix ── */}
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

      {/* ── Phase 245: Executive KPI Summary Card ── */}
      {reportsTab === 'genel' && orders.length >= 3 && (() => {
        const now245 = new Date();
        const monthStart245 = new Date(now245.getFullYear(), now245.getMonth(), 1);
        const prevMonthStart245 = new Date(now245.getFullYear(), now245.getMonth() - 1, 1);
        const prevMonthEnd245 = new Date(now245.getFullYear(), now245.getMonth(), 0, 23, 59, 59);
        const filterOrders245 = (start: Date, end: Date) => orders.filter(o => {
          if (o.status === 'Cancelled') return false;
          try {
            const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
            return od >= start && od <= end;
          } catch { return false; }
        });
        const currOrders = filterOrders245(monthStart245, new Date());
        const prevOrders = filterOrders245(prevMonthStart245, prevMonthEnd245);
        const currRev = currOrders.reduce((s, o) => s + (o.totalPrice || 0), 0);
        const prevRev = prevOrders.reduce((s, o) => s + (o.totalPrice || 0), 0);
        const revGrowth = prevRev > 0 ? Math.round(((currRev - prevRev) / prevRev) * 100) : null;
        const currCusts = new Set(currOrders.map(o => o.customerName || '—')).size;
        const prevCusts = new Set(prevOrders.map(o => o.customerName || '—')).size;
        const custGrowth = prevCusts > 0 ? Math.round(((currCusts - prevCusts) / prevCusts) * 100) : null;
        const currAOV = currOrders.length > 0 ? Math.round(currRev / currOrders.length) : 0;
        const prevAOV = prevOrders.length > 0 ? Math.round(prevOrders.reduce((s, o) => s + (o.totalPrice || 0), 0) / prevOrders.length) : 0;
        const aovGrowth245 = prevAOV > 0 ? Math.round(((currAOV - prevAOV) / prevAOV) * 100) : null;
        const kpis245 = [
          { icon: '💰', label: currentLanguage === 'tr' ? 'Bu Ay Ciro' : 'Month Revenue', value: `₺${(currRev/1000).toFixed(0)}K`, growth: revGrowth },
          { icon: '📦', label: currentLanguage === 'tr' ? 'Sipariş' : 'Orders', value: String(currOrders.length), growth: prevOrders.length > 0 ? Math.round(((currOrders.length - prevOrders.length) / prevOrders.length) * 100) : null },
          { icon: '👥', label: currentLanguage === 'tr' ? 'Aktif Müşteri' : 'Active Customers', value: String(currCusts), growth: custGrowth },
          { icon: '🛒', label: 'AOV', value: `₺${(currAOV/1000).toFixed(1)}K`, growth: aovGrowth245 },
        ];
        return (
          <div className="apple-card p-6 border-2 border-brand/20">
            <div className="flex items-center gap-2 mb-4">
              <span className="text-xl">📋</span>
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? 'Yönetici KPI Özeti' : 'Executive KPI Summary'}</h3>
              <span className="text-[10px] text-gray-400 ml-auto">{now245.toLocaleDateString(currentLanguage === 'tr' ? 'tr-TR' : 'en-US', { month: 'long', year: 'numeric' })}</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {kpis245.map(k => (
                <div key={k.label} className="bg-gray-50 rounded-2xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-lg">{k.icon}</span>
                    {k.growth !== null && (
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${k.growth >= 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                        {k.growth >= 0 ? '↑' : '↓'} %{Math.abs(k.growth)}
                      </span>
                    )}
                  </div>
                  <p className="text-2xl font-black text-gray-800">{k.value}</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">{k.label}</p>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 246: Revenue per SKU Analysis ── */}
      {reportsTab === 'envanter' && orders.length >= 3 && inventory.length > 0 && (() => {
        const skuRev: Record<string, { name: string; sku: string; rev: number; qty: number }> = {};
        for (const o of orders) {
          if (o.status === 'Cancelled') continue;
          for (const li of (o.lineItems ?? [])) {
            const inv = inventory.find(ii => ii.id === li.inventoryId || ii.name === li.name);
            const sku = inv?.sku || li.sku || li.inventoryId || li.name || '?';
            const name = inv?.name || li.name || sku;
            if (!skuRev[sku]) skuRev[sku] = { name, sku, rev: 0, qty: 0 };
            skuRev[sku].rev += li.price * li.quantity;
            skuRev[sku].qty += li.quantity;
          }
        }
        const skuList = Object.values(skuRev).sort((a, b) => b.rev - a.rev).slice(0, 8);
        if (skuList.length < 2) return null;
        const totalSkuRev = skuList.reduce((s, s2) => s + s2.rev, 0);
        const maxSkuRev = skuList[0].rev;
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-4">{currentLanguage === 'tr' ? '📦 SKU Bazlı Ciro Analizi (Top 8)' : '📦 Revenue per SKU (Top 8)'}</h3>
            <div className="space-y-2.5">
              {skuList.map((s, i) => {
                const pct = totalSkuRev > 0 ? Math.round((s.rev / totalSkuRev) * 100) : 0;
                return (
                  <div key={s.sku}>
                    <div className="flex items-center justify-between mb-0.5">
                      <div className="min-w-0 flex-1">
                        <span className="text-xs font-medium text-gray-800 truncate block">{s.name}</span>
                        <span className="text-[10px] text-gray-400">{s.sku} · {s.qty} {currentLanguage === 'tr' ? 'adet' : 'units'}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 ml-2">
                        <span className="text-[10px] text-gray-400">%{pct}</span>
                        <span className="text-xs font-bold text-gray-700">{fmtAna(s.rev,'K',0)}</span>
                      </div>
                    </div>
                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${i === 0 ? 'bg-brand' : i <= 2 ? 'bg-blue-400' : 'bg-gray-300'}`} style={{ width: `${Math.max(4, Math.round((s.rev / maxSkuRev) * 100))}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 247: Quotation Aging Analysis ── */}
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

      {/* ── Phase 248: Employee Overtime & Absence Rate ── */}
      {reportsTab === 'ik' && employees.length > 0 && (() => {
        type EmpWithHR = { overtimeHours?: number; absenceDays?: number; leaveDays?: number; status?: string; name?: string; department?: string };
        const active248 = employees.filter(e => e.status === 'Aktif') as unknown as EmpWithHR[];
        const withOvertime = active248.filter(e => (e.overtimeHours ?? 0) > 0);
        const withAbsence = active248.filter(e => ((e.absenceDays ?? 0) + (e.leaveDays ?? 0)) > 0);
        const avgOvertime = active248.length > 0
          ? Math.round(active248.reduce((s, e) => s + (e.overtimeHours ?? 0), 0) / active248.length * 10) / 10
          : 0;
        const avgAbsence = active248.length > 0
          ? Math.round(active248.reduce((s, e) => s + (e.absenceDays ?? 0) + (e.leaveDays ?? 0), 0) / active248.length * 10) / 10
          : 0;
        if (avgOvertime === 0 && avgAbsence === 0) return null;
        const topOT = [...active248].sort((a, b) => (b.overtimeHours ?? 0) - (a.overtimeHours ?? 0)).slice(0, 4);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-4">{currentLanguage === 'tr' ? '⏰ Fazla Mesai & Devamsızlık Oranı' : '⏰ Overtime & Absence Rate'}</h3>
            <div className="grid grid-cols-2 gap-3 mb-4">
              {[
                { label: currentLanguage === 'tr' ? 'Ort. Fazla Mesai' : 'Avg Overtime', value: `${avgOvertime}h`, count: withOvertime.length, color: 'text-amber-600' },
                { label: currentLanguage === 'tr' ? 'Ort. Devamsızlık' : 'Avg Absence', value: `${avgAbsence}d`, count: withAbsence.length, color: 'text-red-500' },
              ].map(k => (
                <div key={k.label} className="bg-gray-50 rounded-xl p-4">
                  <p className={`text-2xl font-bold ${k.color}`}>{k.value}</p>
                  <p className="text-[10px] text-gray-600 font-medium mt-0.5">{k.label}</p>
                  <p className="text-[9px] text-gray-400">{k.count} {currentLanguage === 'tr' ? 'çalışan' : 'employees'}</p>
                </div>
              ))}
            </div>
            {topOT.some(e => (e.overtimeHours ?? 0) > 0) && (
              <div>
                <p className="text-xs font-semibold text-gray-600 mb-2">{currentLanguage === 'tr' ? 'En Çok Fazla Mesai:' : 'Top Overtime Workers:'}</p>
                <div className="space-y-1.5">
                  {topOT.filter(e => (e.overtimeHours ?? 0) > 0).map((e, i) => (
                    <div key={i} className="flex items-center justify-between text-xs">
                      <span className="text-gray-700 truncate">{e.name ?? '—'}</span>
                      <span className="font-bold text-amber-600 shrink-0 ml-2">{e.overtimeHours}h</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* ── Phase 249: Payment Method Distribution ── */}
      {reportsTab === 'genel' && orders.length >= 5 && (() => {
        const methodMap: Record<string, { count: number; rev: number }> = {};
        for (const o of orders) {
          if (o.status === 'Cancelled') continue;
          const m = o as unknown as Record<string,unknown>;
          const method = (m.paymentMethod as string) || (m.payment as string) || (currentLanguage === 'tr' ? 'Belirtilmemiş' : 'Not specified');
          if (!methodMap[method]) methodMap[method] = { count: 0, rev: 0 };
          methodMap[method].count++;
          methodMap[method].rev += o.totalPrice || 0;
        }
        const methodList = Object.entries(methodMap).sort(([,a],[,b]) => b.rev - a.rev);
        if (methodList.length < 2) return null;
        const totalRev249 = methodList.reduce((s,[,v]) => s + v.rev, 0);
        const COLORS249 = ['bg-brand', 'bg-blue-400', 'bg-emerald-400', 'bg-amber-400', 'bg-purple-400'];
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-4">{currentLanguage === 'tr' ? '💳 Ödeme Yöntemi Dağılımı' : '💳 Payment Method Distribution'}</h3>
            <div className="space-y-2.5">
              {methodList.slice(0, 5).map(([method, d], i) => {
                const pct = totalRev249 > 0 ? Math.round((d.rev / totalRev249) * 100) : 0;
                return (
                  <div key={method}>
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-xs font-medium text-gray-700 capitalize">{method}</span>
                      <div className="flex items-center gap-2 shrink-0 ml-2">
                        <span className="text-[10px] text-gray-400">{d.count} {currentLanguage === 'tr' ? 'sipariş' : 'orders'}</span>
                        <span className="text-[10px] font-bold text-gray-500">%{pct}</span>
                        <span className="text-xs font-bold text-gray-700">{fmtAna(d.rev,'K',0)}</span>
                      </div>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${COLORS249[i] ?? 'bg-gray-400'}`} style={{ width: `${Math.max(4, pct)}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 250: 360° Business Intelligence Summary ── */}
      {reportsTab === 'genel' && orders.length >= 5 && inventory.length > 0 && employees.length > 0 && (() => {
        const now250 = new Date();
        const m3Start = new Date(now250.getFullYear(), now250.getMonth() - 3, 1);
        const recentOrds = orders.filter(o => {
          if (o.status === 'Cancelled') return false;
          try {
            const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
            return od >= m3Start;
          } catch { return false; }
        });
        const rev250 = recentOrds.reduce((s, o) => s + (o.totalPrice || 0), 0);
        const activeEmp250 = employees.filter(e => e.status === 'Aktif').length;
        const lowStockCount = inventory.filter(i => (i.stockLevel ?? 0) <= (i.lowStockThreshold ?? i.minStock ?? 5)).length;
        const inventoryVal250 = inventory.reduce((s, i) => s + itemCostTRY(i, exchangeRates) * (i.stockLevel ?? 0), 0);
        const totalOrds250 = recentOrds.length;
        const uniqueCusts250 = new Set(recentOrds.map(o => o.customerName || '—')).size;
        const openOrds = orders.filter(o => o.status === 'Pending' || o.status === 'Processing').length;
        const insights = [
          rev250 > 0 && `💰 ${currentLanguage === 'tr' ? `Son 3 ayda ₺${(rev250/1000).toFixed(0)}K ciro` : `₺${(rev250/1000).toFixed(0)}K revenue in last 3 months`}`,
          `📦 ${currentLanguage === 'tr' ? `${totalOrds250} sipariş, ${uniqueCusts250} benzersiz müşteri` : `${totalOrds250} orders from ${uniqueCusts250} unique customers`}`,
          `👥 ${currentLanguage === 'tr' ? `${activeEmp250} aktif çalışan` : `${activeEmp250} active employees`}`,
          `🏭 ${currentLanguage === 'tr' ? `₺${(inventoryVal250/1000).toFixed(0)}K stok değeri` : `₺${(inventoryVal250/1000).toFixed(0)}K inventory value`}`,
          lowStockCount > 0 && `⚠️ ${currentLanguage === 'tr' ? `${lowStockCount} ürün kritik stok seviyesinde` : `${lowStockCount} items at critical stock level`}`,
          openOrds > 0 && `⏳ ${currentLanguage === 'tr' ? `${openOrds} sipariş işleme bekliyor` : `${openOrds} orders awaiting processing`}`,
        ].filter(Boolean) as string[];
        return (
          <div className="apple-card p-6 bg-gradient-to-br from-gray-50 to-white border border-gray-100">
            <div className="flex items-center gap-2 mb-4">
              <span className="text-2xl">🔭</span>
              <div>
                <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '360° İş Zekası Özeti' : '360° Business Intelligence Summary'}</h3>
                <p className="text-[10px] text-gray-400">{now250.toLocaleDateString(currentLanguage === 'tr' ? 'tr-TR' : 'en-US', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
              </div>
            </div>
            <div className="space-y-2.5">
              {insights.map((insight, i) => (
                <div key={i} className="flex items-start gap-2.5 p-3 bg-white rounded-xl shadow-sm border border-gray-50">
                  <p className="text-xs text-gray-700 leading-relaxed">{insight}</p>
                </div>
              ))}
            </div>
            <div className="mt-4 p-3 bg-brand/5 rounded-xl border border-brand/10">
              <p className="text-[11px] text-brand font-semibold">{currentLanguage === 'tr' ? '🚀 Cetpa ERP Analytics · 250 Faz tamamlandı' : '🚀 Cetpa ERP Analytics · 250 Phases Complete'}</p>
              <p className="text-[10px] text-gray-500 mt-0.5">{currentLanguage === 'tr' ? 'Finansal, satış, lojistik, envanter ve İK analizleri entegre edildi.' : 'Financial, sales, logistics, inventory, and HR analytics fully integrated.'}</p>
            </div>
          </div>
        );
      })()}

      {/* ── Phase 251: Year-over-Year Full Revenue Comparison ── */}
      {reportsTab === 'genel' && orders.length >= 10 && (() => {
        const now251 = new Date();
        const currYear = now251.getFullYear();
        const prevYear = currYear - 1;
        const months251 = Array.from({ length: 12 }, (_, i) => {
          const label = new Date(currYear, i, 1).toLocaleDateString(currentLanguage === 'tr' ? 'tr-TR' : 'en-US', { month: 'short' });
          const curr = orders.filter(o => {
            if (o.status === 'Cancelled') return false;
            try { const d = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string); return d.getFullYear() === currYear && d.getMonth() === i; } catch { return false; }
          }).reduce((s, o) => s + (o.totalPrice || 0), 0);
          const prev = orders.filter(o => {
            if (o.status === 'Cancelled') return false;
            try { const d = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string); return d.getFullYear() === prevYear && d.getMonth() === i; } catch { return false; }
          }).reduce((s, o) => s + (o.totalPrice || 0), 0);
          return { label, curr, prev };
        });
        const hasPrev = months251.some(m => m.prev > 0);
        const totalCurr = months251.reduce((s, m) => s + m.curr, 0);
        const totalPrev = months251.reduce((s, m) => s + m.prev, 0);
        const yoyGrowth = totalPrev > 0 ? Math.round(((totalCurr - totalPrev) / totalPrev) * 100) : null;
        if (totalCurr === 0) return null;
        const maxVal251 = Math.max(...months251.map(m => Math.max(m.curr, m.prev)), 1);
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '📅 Yıllık Ciro Karşılaştırması (YoY)' : '📅 Year-over-Year Revenue Comparison'}</h3>
              {yoyGrowth !== null && (
                <span className={`text-sm font-bold px-2 py-0.5 rounded-full ${yoyGrowth >= 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                  {yoyGrowth >= 0 ? '↑' : '↓'} %{Math.abs(yoyGrowth)} YoY
                </span>
              )}
            </div>
            <div className="flex items-end gap-1 h-28 mb-2">
              {months251.map((m, i) => {
                const currH = Math.round((m.curr / maxVal251) * 80);
                const prevH = Math.round((m.prev / maxVal251) * 80);
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                    <div className="w-full flex items-end gap-px" style={{ height: '80px' }}>
                      <div className="flex-1 bg-brand rounded-t-sm" style={{ height: `${Math.max(m.curr > 0 ? 2 : 0, currH)}px` }} />
                      {hasPrev && <div className="flex-1 bg-gray-200 rounded-t-sm" style={{ height: `${Math.max(m.prev > 0 ? 2 : 0, prevH)}px` }} />}
                    </div>
                    <span className="text-[8px] text-gray-400 leading-none">{m.label}</span>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center gap-4 mb-3">
              <div className="flex items-center gap-1"><div className="w-3 h-2 rounded-sm bg-brand" /><span className="text-[10px] text-gray-500">{currYear}: {fmtAna(totalCurr,'K',0)}</span></div>
              {hasPrev && <div className="flex items-center gap-1"><div className="w-3 h-2 rounded-sm bg-gray-300" /><span className="text-[10px] text-gray-500">{prevYear}: {fmtAna(totalPrev,'K',0)}</span></div>}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 252: Average Days to First Reorder ── */}
      {reportsTab === 'crm' && orders.length >= 8 && (() => {
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
      })()}

      {/* ── Phase 253: Gross Margin per Employee ── */}
      {reportsTab === 'ik' && employees.length > 0 && orders.length >= 3 && inventory.length > 0 && (() => {
        const activeEmps253 = employees.filter(e => e.status === 'Aktif').length || 1;
        const totalGross253 = orders.filter(o => o.status !== 'Cancelled').reduce((s, o) => {
          const rev = o.totalPrice || 0;
          const cogs = (o.lineItems ?? []).reduce((ls, li) => {
            const inv = inventory.find(ii => ii.id === li.inventoryId || ii.name === li.name);
            return ls + (inv ? itemCostTRY(inv, exchangeRates) : li.price * 0.6) * li.quantity;
          }, 0);
          return s + (rev - cogs);
        }, 0);
        const grossPerEmp = Math.round(totalGross253 / activeEmps253);
        const revPerEmp253 = Math.round(orders.filter(o => o.status !== 'Cancelled').reduce((s, o) => s + (o.totalPrice || 0), 0) / activeEmps253);
        const totalPayroll253 = employees.filter(e => e.status === 'Aktif').reduce((s, e) => s + (e.salary || 0), 0);
        const grossToPayroll = totalPayroll253 > 0 ? Math.round((totalGross253 / totalPayroll253) * 10) / 10 : 0;
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-4">{currentLanguage === 'tr' ? '💹 Çalışan Başı Brüt Kâr' : '💹 Gross Margin per Employee'}</h3>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="bg-emerald-50 rounded-2xl p-4">
                <p className="text-[10px] text-emerald-700 font-bold uppercase tracking-wide mb-1">{currentLanguage === 'tr' ? 'Çalışan Başı Brüt Kâr' : 'Gross Profit / Employee'}</p>
                <p className="text-3xl font-black text-emerald-700">{fmtAna(grossPerEmp,'K',0)}</p>
              </div>
              <div className="bg-blue-50 rounded-2xl p-4">
                <p className="text-[10px] text-blue-700 font-bold uppercase tracking-wide mb-1">{currentLanguage === 'tr' ? 'Çalışan Başı Ciro' : 'Revenue / Employee'}</p>
                <p className="text-3xl font-black text-blue-700">{fmtAna(revPerEmp253,'K',0)}</p>
              </div>
            </div>
            <div className="p-3 bg-gray-50 rounded-xl flex items-center justify-between">
              <span className="text-xs text-gray-600">{currentLanguage === 'tr' ? 'Brüt Kâr / Maaş Kütlesi' : 'Gross Profit / Payroll'}</span>
              <span className={`text-lg font-black ${grossToPayroll >= 2 ? 'text-emerald-600' : grossToPayroll >= 1 ? 'text-amber-500' : 'text-red-500'}`}>{grossToPayroll}×</span>
            </div>
            <p className="text-[10px] text-gray-400 mt-2">{currentLanguage === 'tr' ? 'Benchmark: 2x+ iyi (maaş kütlesi başına 2x brüt kâr)' : 'Benchmark: 2x+ healthy (2x gross profit per payroll dollar)'}</p>
          </div>
        );
      })()}

      {/* ── Phase 254: Product Profitability Index ── */}
      {reportsTab === 'envanter' && orders.length >= 5 && inventory.length > 0 && (() => {
        const now254 = new Date();
        const days254 = 90;
        const cutoff254 = new Date(now254); cutoff254.setDate(cutoff254.getDate() - days254);
        // Profitability Index = (margin % × velocity) / 100
        const prodPI: Record<string, { name: string; margin: number; velocity: number; pi: number; rev: number }> = {};
        for (const o of orders) {
          if (o.status === 'Cancelled') continue;
          try {
            const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
            if (od < cutoff254) continue;
            for (const li of (o.lineItems ?? [])) {
              const inv = inventory.find(ii => ii.id === li.inventoryId || ii.name === li.name);
              if (!inv) continue;
              const key = inv.id;
              const margin = li.price > 0 ? Math.round(((li.price - itemCostTRY(inv, exchangeRates)) / li.price) * 100) : 0;
              if (!prodPI[key]) prodPI[key] = { name: inv.name, margin, velocity: 0, pi: 0, rev: 0 };
              prodPI[key].velocity += li.quantity;
              prodPI[key].rev += li.price * li.quantity;
            }
          } catch { /* skip */ }
        }
        const maxVel254 = Math.max(...Object.values(prodPI).map(p => p.velocity), 1);
        const piList = Object.values(prodPI)
          .map(p => ({ ...p, pi: Math.round((p.margin * (p.velocity / maxVel254)) * 10) / 10 }))
          .sort((a, b) => b.pi - a.pi)
          .slice(0, 8);
        if (piList.length < 2) return null;
        const maxPI = Math.max(...piList.map(p => p.pi), 1);
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-1">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '🏆 Ürün Karlılık Endeksi (PI)' : '🏆 Product Profitability Index (PI)'}</h3>
              <span className="text-[10px] text-gray-400">{currentLanguage === 'tr' ? 'Marj × Hız' : 'Margin × Velocity'}</span>
            </div>
            <p className="text-[10px] text-gray-400 mb-4">{currentLanguage === 'tr' ? 'Son 90 gün · Yüksek PI = yüksek marj + hızlı satış' : 'Last 90 days · High PI = high margin + fast moving'}</p>
            <div className="space-y-2.5">
              {piList.map((p, i) => (
                <div key={p.name}>
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-xs font-medium text-gray-700 truncate">{p.name}</span>
                    <div className="flex items-center gap-2 shrink-0 ml-2">
                      <span className="text-[10px] text-gray-400">%{p.margin} · {p.velocity}{currentLanguage === 'tr' ? 'ad' : 'u'}</span>
                      <span className={`text-xs font-bold ${i === 0 ? 'text-brand' : i <= 2 ? 'text-emerald-600' : 'text-gray-600'}`}>PI {p.pi}</span>
                    </div>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${i === 0 ? 'bg-brand' : i <= 2 ? 'bg-emerald-400' : 'bg-blue-300'}`} style={{ width: `${Math.max(4, Math.round((p.pi / maxPI) * 100))}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 255: Sales Pipeline Stage Velocity ── */}
      {reportsTab === 'crm' && quotations.length >= 5 && (() => {
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
      })()}

      {/* ── Phase 256: Revenue by Order Size Decile ── */}
      {reportsTab === 'genel' && orders.length >= 10 && (() => {
        const validOrders = orders.filter(o => o.status !== 'Cancelled' && (o.totalPrice || 0) > 0);
        if (validOrders.length < 10) return null;
        const sorted256 = [...validOrders].sort((a, b) => (a.totalPrice || 0) - (b.totalPrice || 0));
        const decileSize = Math.ceil(sorted256.length / 10);
        const deciles = Array.from({ length: 10 }, (_, i) => {
          const slice = sorted256.slice(i * decileSize, (i + 1) * decileSize);
          const rev = slice.reduce((s, o) => s + (o.totalPrice || 0), 0);
          return { label: `D${i + 1}`, rev, count: slice.length };
        });
        const totalRev256 = deciles.reduce((s, d) => s + d.rev, 0);
        const top30pct = deciles.slice(7).reduce((s, d) => s + d.rev, 0);
        const top30share = totalRev256 > 0 ? Math.round((top30pct / totalRev256) * 100) : 0;
        const maxRev256 = Math.max(...deciles.map(d => d.rev), 1);
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '📊 Sipariş Büyüklüğü Desil Analizi' : '📊 Order Size Decile Analysis'}</h3>
              <span className="text-xs font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full">{currentLanguage === 'tr' ? `Üst %30 → %${top30share} ciro` : `Top 30% → ${top30share}% revenue`}</span>
            </div>
            <div className="flex items-end gap-1 h-20 mb-2">
              {deciles.map((d, i) => {
                const isTop = i >= 7;
                return (
                  <div key={d.label} className="flex-1 flex flex-col items-center gap-0.5">
                    <div className="w-full flex items-end" style={{ height: '64px' }}>
                      <div className={`w-full rounded-t-sm ${isTop ? 'bg-brand' : 'bg-blue-200'}`} style={{ height: `${Math.max(4, Math.round((d.rev / maxRev256) * 64))}px` }} />
                    </div>
                    <span className="text-[8px] text-gray-400">{d.label}</span>
                  </div>
                );
              })}
            </div>
            <p className="text-[10px] text-gray-400">{currentLanguage === 'tr' ? 'D1 = en küçük siparişler, D10 = en büyük siparişler. Kırmızı = üst %30.' : 'D1 = smallest orders, D10 = largest orders. Red = top 30%.'}</p>
          </div>
        );
      })()}

      {/* ── Phase 257: Days Since Last Sale per Product ── */}
      {reportsTab === 'envanter' && inventory.length > 0 && orders.length >= 3 && (() => {
        const now257 = new Date();
        const lastSaleDate: Record<string, Date> = {};
        for (const o of orders) {
          if (o.status === 'Cancelled') continue;
          try {
            const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
            for (const li of (o.lineItems ?? [])) {
              const key = li.inventoryId || li.name || '';
              if (!key) continue;
              if (!lastSaleDate[key] || od > lastSaleDate[key]) lastSaleDate[key] = od;
            }
          } catch { /* skip */ }
        }
        const staleProducts = inventory
          .map(i => {
            const lastDate = lastSaleDate[i.id] ?? lastSaleDate[i.name] ?? lastSaleDate[i.sku || ''];
            const days = lastDate ? Math.round((now257.getTime() - lastDate.getTime()) / 86400000) : null;
            return { name: i.name, days, stock: i.stockLevel ?? 0, value: (i.stockLevel ?? 0) * itemCostTRY(i, exchangeRates) };
          })
          .filter(p => p.days !== null && p.days > 30 && p.stock > 0)
          .sort((a, b) => (b.days ?? 0) - (a.days ?? 0))
          .slice(0, 8) as Array<{ name: string; days: number; stock: number; value: number }>;
        if (staleProducts.length === 0) return null;
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '📆 Son Satıştan Bu Yana Geçen Gün' : '📆 Days Since Last Sale (with Stock)'}</h3>
              <span className="text-xs text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full font-bold">{staleProducts.length} {currentLanguage === 'tr' ? 'ürün' : 'products'}</span>
            </div>
            <div className="space-y-2.5">
              {staleProducts.map(p => (
                <div key={p.name} className="flex items-center justify-between py-1 border-b border-gray-50 last:border-0">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-gray-800 truncate">{p.name}</p>
                    <p className="text-[10px] text-gray-400">{p.stock} {currentLanguage === 'tr' ? 'stok' : 'in stock'} · {fmtAna(p.value,'full',0)}</p>
                  </div>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full shrink-0 ml-2 ${p.days > 90 ? 'bg-red-100 text-red-700' : p.days > 60 ? 'bg-orange-100 text-orange-700' : 'bg-amber-100 text-amber-700'}`}>
                    {p.days}d
                  </span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 258: Monthly Customer Wallet Share ── */}
      {reportsTab === 'crm' && orders.length >= 5 && (() => {
        const now258 = new Date();
        const monthStart258 = new Date(now258.getFullYear(), now258.getMonth(), 1);
        const mOrders258 = orders.filter(o => {
          if (o.status === 'Cancelled') return false;
          try {
            const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
            return od >= monthStart258;
          } catch { return false; }
        });
        if (mOrders258.length < 3) return null;
        const custRevMap258: Record<string, number> = {};
        for (const o of mOrders258) {
          const name = o.customerName || '—';
          custRevMap258[name] = (custRevMap258[name] ?? 0) + (o.totalPrice || 0);
        }
        const sorted258 = Object.entries(custRevMap258).sort(([,a],[,b]) => b - a).slice(0, 8);
        const total258 = sorted258.reduce((s,[,v]) => s + v, 0);
        let cumPct258 = 0;
        const withCum = sorted258.map(([name, rev]) => {
          const pct = total258 > 0 ? Math.round((rev / total258) * 100) : 0;
          cumPct258 += pct;
          return { name, rev, pct, cumPct: cumPct258 };
        });
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '🥧 Bu Ay Müşteri Cüzdan Payı' : '🥧 This Month Customer Wallet Share'}</h3>
              <span className="text-[10px] text-gray-400">{withCum.length} {currentLanguage === 'tr' ? 'müşteri' : 'customers'} · {fmtAna(total258,'K',0)}</span>
            </div>
            <div className="space-y-2">
              {withCum.map((c, i) => (
                <div key={c.name}>
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-xs font-medium text-gray-700 truncate">{c.name}</span>
                    <div className="flex items-center gap-2 shrink-0 ml-2">
                      <span className="text-[10px] text-purple-600 font-bold">Σ%{c.cumPct}</span>
                      <span className="text-xs font-bold text-gray-700">%{c.pct}</span>
                    </div>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${i === 0 ? 'bg-purple-500' : i === 1 ? 'bg-purple-400' : i <= 3 ? 'bg-purple-300' : 'bg-gray-300'}`} style={{ width: `${Math.max(4, c.pct)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 259: Inventory Carrying Cost Estimate ── */}
      {reportsTab === 'envanter' && inventory.length > 0 && (() => {
        const inventoryVal259 = inventory.reduce((s, i) => s + itemCostTRY(i, exchangeRates) * (i.stockLevel ?? 0), 0);
        if (inventoryVal259 === 0) return null;
        // Carrying cost = typically 20-30% of inventory value per year
        const carryingRates = [
          { label: currentLanguage === 'tr' ? 'Muhafaza & Depo' : 'Storage & Handling', pct: 5, color: 'bg-blue-300' },
          { label: currentLanguage === 'tr' ? 'Sermaye Maliyeti' : 'Capital Cost', pct: 8, color: 'bg-amber-300' },
          { label: currentLanguage === 'tr' ? 'Sigorta & Vergi' : 'Insurance & Tax', pct: 3, color: 'bg-purple-300' },
          { label: currentLanguage === 'tr' ? 'Eskime & Fire' : 'Obsolescence & Loss', pct: 4, color: 'bg-red-300' },
        ];
        const totalCarryPct = carryingRates.reduce((s, r) => s + r.pct, 0);
        const annualCarryCost = Math.round(inventoryVal259 * (totalCarryPct / 100));
        const monthlyCarryCost = Math.round(annualCarryCost / 12);
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '💼 Stok Taşıma Maliyeti Tahmini' : '💼 Inventory Carrying Cost Estimate'}</h3>
              <span className="text-xs text-red-700 bg-red-50 px-2 py-0.5 rounded-full font-bold">%{totalCarryPct} / {currentLanguage === 'tr' ? 'yıl' : 'yr'}</span>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="bg-red-50 rounded-xl p-3 text-center">
                <p className="text-xl font-black text-red-600">{fmtAna(annualCarryCost,'K',0)}</p>
                <p className="text-[10px] text-gray-400">{currentLanguage === 'tr' ? 'Yıllık taşıma maliyeti' : 'Annual carrying cost'}</p>
              </div>
              <div className="bg-amber-50 rounded-xl p-3 text-center">
                <p className="text-xl font-black text-amber-600">{fmtAna(monthlyCarryCost,'K',0)}</p>
                <p className="text-[10px] text-gray-400">{currentLanguage === 'tr' ? 'Aylık taşıma maliyeti' : 'Monthly carrying cost'}</p>
              </div>
            </div>
            <div className="space-y-2">
              {carryingRates.map(r => (
                <div key={r.label} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-sm ${r.color}`} />
                    <span className="text-gray-600">{r.label}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-gray-400">%{r.pct}</span>
                    <span className="font-bold text-gray-700">{fmtAna(Math.round(inventoryVal259 * r.pct / 100),'full',0)}</span>
                  </div>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-gray-400 mt-3">{currentLanguage === 'tr' ? `Stok değeri: ₺${(inventoryVal259/1000).toFixed(0)}K · Taşıma maliyeti genellikle stok değerinin %20-30\'udur.` : `Inventory value: ₺${(inventoryVal259/1000).toFixed(0)}K · Carrying cost is typically 20-30% of inventory value.`}</p>
          </div>
        );
      })()}

      {/* ── Phase 260: Sales Momentum Score ── */}
      {reportsTab === 'genel' && orders.length >= 10 && (() => {
        const now260 = new Date();
        // Compare last 30 days vs prior 30 days across key metrics
        const last30 = new Date(now260); last30.setDate(last30.getDate() - 30);
        const prev30Start = new Date(now260); prev30Start.setDate(prev30Start.getDate() - 60);
        const filter260 = (start: Date, end: Date) => orders.filter(o => {
          if (o.status === 'Cancelled') return false;
          try {
            const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
            return od >= start && od <= end;
          } catch { return false; }
        });
        const curr260 = filter260(last30, now260);
        const prev260 = filter260(prev30Start, last30);
        const metrics260 = [
          { label: currentLanguage === 'tr' ? 'Ciro' : 'Revenue', curr: curr260.reduce((s, o) => s + (o.totalPrice || 0), 0), prev: prev260.reduce((s, o) => s + (o.totalPrice || 0), 0) },
          { label: currentLanguage === 'tr' ? 'Sipariş Adedi' : 'Order Count', curr: curr260.length, prev: prev260.length },
          { label: currentLanguage === 'tr' ? 'Müşteri Sayısı' : 'Customers', curr: new Set(curr260.map(o => o.customerName || '—')).size, prev: new Set(prev260.map(o => o.customerName || '—')).size },
          { label: 'AOV', curr: curr260.length > 0 ? Math.round(curr260.reduce((s, o) => s + (o.totalPrice || 0), 0) / curr260.length) : 0, prev: prev260.length > 0 ? Math.round(prev260.reduce((s, o) => s + (o.totalPrice || 0), 0) / prev260.length) : 0 },
        ];
        const scored = metrics260.map(m => ({
          ...m,
          growth: m.prev > 0 ? Math.round(((m.curr - m.prev) / m.prev) * 100) : null,
          score: m.prev > 0 ? (m.curr >= m.prev * 1.1 ? 25 : m.curr >= m.prev ? 15 : m.curr >= m.prev * 0.9 ? 5 : 0) : (m.curr > 0 ? 15 : 0),
        }));
        const momentumScore = scored.reduce((s, m) => s + m.score, 0);
        const maxScore = 100;
        const momentumLevel = momentumScore >= 80 ? { label: currentLanguage === 'tr' ? '🚀 Güçlü İvme' : '🚀 Strong Momentum', color: 'text-emerald-600 bg-emerald-100' }
          : momentumScore >= 50 ? { label: currentLanguage === 'tr' ? '📈 Orta İvme' : '📈 Moderate Momentum', color: 'text-blue-600 bg-blue-100' }
          : momentumScore >= 25 ? { label: currentLanguage === 'tr' ? '➡️ Stabil' : '➡️ Stable', color: 'text-amber-600 bg-amber-100' }
          : { label: currentLanguage === 'tr' ? '📉 Düşüş' : '📉 Declining', color: 'text-red-600 bg-red-100' };
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '⚡ Satış Momentum Skoru' : '⚡ Sales Momentum Score'}</h3>
              <div className="flex items-center gap-2">
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${momentumLevel.color}`}>{momentumLevel.label}</span>
                <span className={`text-2xl font-black ${momentumLevel.color.split(' ')[0]}`}>{momentumScore}/{maxScore}</span>
              </div>
            </div>
            <div className="h-3 bg-gray-100 rounded-full overflow-hidden mb-4">
              <div className={`h-full rounded-full transition-all ${momentumScore >= 80 ? 'bg-emerald-400' : momentumScore >= 50 ? 'bg-blue-400' : momentumScore >= 25 ? 'bg-amber-400' : 'bg-red-400'}`} style={{ width: `${momentumScore}%` }} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              {scored.map(m => (
                <div key={m.label} className="bg-gray-50 rounded-xl p-3">
                  <p className="text-[10px] text-gray-500 font-medium mb-1">{m.label}</p>
                  <p className="text-lg font-black text-gray-800">{typeof m.curr === 'number' && m.curr > 1000 ? `₺${(m.curr/1000).toFixed(0)}K` : m.curr}</p>
                  {m.growth !== null && (
                    <p className={`text-[10px] font-bold ${m.growth >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                      {m.growth >= 0 ? '↑' : '↓'} %{Math.abs(m.growth)} MoM
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 261: Revenue Quartile Cohort Analysis (genel) ── */}
      {reportsTab === 'genel' && orders.length >= 20 && (() => {
        const sorted = [...orders].sort((a,b) => a.totalPrice - b.totalPrice);
        const n = sorted.length;
        const q = Math.floor(n / 4);
        const quartiles = [
          { label: 'Q1 (Bottom 25%)', orders: sorted.slice(0, q) },
          { label: 'Q2 (25–50%)', orders: sorted.slice(q, q*2) },
          { label: 'Q3 (50–75%)', orders: sorted.slice(q*2, q*3) },
          { label: 'Q4 (Top 25%)', orders: sorted.slice(q*3) },
        ];
        const data = quartiles.map(qt => ({
          label: qt.label,
          count: qt.orders.length,
          revenue: qt.orders.reduce((s, o) => s + o.totalPrice, 0),
          avgOrder: qt.orders.length ? qt.orders.reduce((s, o) => s + o.totalPrice, 0) / qt.orders.length : 0,
        }));
        const maxRev = Math.max(...data.map(d => d.revenue));
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Revenue Quartile Analysis</h3>
            <p className="text-xs text-gray-500 mb-4">Orders split into 4 equal quartiles by order value</p>
            <div className="space-y-3">
              {data.map((d, i) => (
                <div key={i}>
                  <div className="flex justify-between text-xs text-gray-600 mb-1">
                    <span className="font-medium">{d.label}</span>
                    <span>{d.count} orders · avg {fmtAna(d.avgOrder,'full',0)} · total {fmtAna(d.revenue,'full',0)}</span>
                  </div>
                  <div className="h-5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${maxRev > 0 ? (d.revenue/maxRev*100) : 0}%`, background: ['#dbeafe','#93c5fd','#3b82f6','#1d4ed8'][i] }} />
                  </div>
                </div>
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-3">Top quartile drives {maxRev > 0 ? ((data[3].revenue / data.reduce((s,d)=>s+d.revenue,0))*100).toFixed(0) : 0}% of total revenue</p>
          </div>
        );
      })()}

      {/* ── Phase 262: Customer Acquisition Month Distribution (crm) ── */}
      {reportsTab === 'crm' && orders.length >= 10 && (() => {
        const firstOrderByCustomer: Record<string, Date> = {};
        [...orders].sort((a,b) => {
          const da = (a.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(a.createdAt as string);
          const db = (b.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(b.createdAt as string);
          return da.getTime() - db.getTime();
        }).forEach(o => {
          if (!firstOrderByCustomer[o.customerName]) {
            firstOrderByCustomer[o.customerName] = (o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string);
          }
        });
        const monthCounts: Record<string, number> = {};
        Object.values(firstOrderByCustomer).forEach(d => {
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          monthCounts[key] = (monthCounts[key] || 0) + 1;
        });
        const months = Object.keys(monthCounts).sort().slice(-12);
        if (months.length < 2) return null;
        const maxC = Math.max(...months.map(m => monthCounts[m]));
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Customer Acquisition by Month</h3>
            <p className="text-xs text-gray-500 mb-4">New customers (first order) per month — last 12 months</p>
            <div className="flex items-end gap-1 h-28">
              {months.map(m => (
                <div key={m} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-[9px] text-gray-600 font-bold">{monthCounts[m]}</span>
                  <div className="w-full rounded-t" style={{ height: `${maxC > 0 ? (monthCounts[m]/maxC*80) : 4}px`, background: '#10b981', minHeight: '4px' }} />
                  <span className="text-[8px] text-gray-400 rotate-45 origin-left whitespace-nowrap">{m.slice(5)}/{m.slice(2,4)}</span>
                </div>
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-4">Total new customers tracked: {Object.keys(firstOrderByCustomer).length}</p>
          </div>
        );
      })()}

      {/* ── Phase 263: Inventory Write-Down Risk (envanter) ── */}
      {reportsTab === 'envanter' && inventory.length >= 5 && (() => {
        const now = new Date();
        const risky = inventory.filter(item => {
          if (!item.expiryDate) return false;
          const exp = new Date(item.expiryDate);
          const daysLeft = Math.floor((exp.getTime() - now.getTime()) / 86400000);
          return daysLeft <= 180 && daysLeft > 0 && item.stockLevel > 0;
        }).map(item => {
          const exp = new Date(item.expiryDate!);
          const daysLeft = Math.floor((exp.getTime() - now.getTime()) / 86400000);
          const writeDownValue = item.stockLevel * itemCostTRY(item, exchangeRates);
          return { name: item.name, sku: item.sku, daysLeft, stock: item.stockLevel, value: writeDownValue };
        }).sort((a,b) => a.daysLeft - b.daysLeft).slice(0, 8);
        if (risky.length === 0) {
          return (
            <div className="apple-card p-6">
              <h3 className="font-bold text-gray-800 mb-1">Inventory Write-Down Risk</h3>
              <p className="text-xs text-gray-500 mt-2 text-center py-4">✅ No inventory expiring within 180 days</p>
            </div>
          );
        }
        const totalRisk = risky.reduce((s,r)=>s+r.value,0);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Inventory Write-Down Risk</h3>
            <p className="text-xs text-gray-500 mb-3">Items expiring within 180 days — potential write-down: {fmtAna(totalRisk,'full',0)}</p>
            <div className="space-y-2">
              {risky.map((r,i) => (
                <div key={i} className="flex items-center justify-between text-xs p-2 rounded-lg" style={{ background: r.daysLeft <= 30 ? '#fef2f2' : r.daysLeft <= 90 ? '#fffbeb' : '#f0fdf4' }}>
                  <span className="font-medium text-gray-800">{r.name} <span className="text-gray-400">({r.sku})</span></span>
                  <span className="font-bold" style={{ color: r.daysLeft <= 30 ? '#ef4444' : r.daysLeft <= 90 ? '#f59e0b' : '#10b981' }}>{r.daysLeft}d left</span>
                  <span className="text-gray-600">Qty: {r.stock}</span>
                  <span className="text-gray-700 font-semibold">{fmtAna(r.value,'full',0)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 264: Sales Velocity by Day of Week (genel) ── */}
      {reportsTab === 'genel' && orders.length >= 10 && (() => {
        const dayLabels = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
        const dayCounts = Array(7).fill(0);
        const dayRevenue = Array(7).fill(0);
        orders.forEach(o => {
          const d = ((o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string)).getDay();
          dayCounts[d]++;
          dayRevenue[d] += o.totalPrice;
        });
        const maxRev = Math.max(...dayRevenue);
        if (maxRev === 0) return null;
        const bestDay = dayRevenue.indexOf(maxRev);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Sales Velocity by Day of Week</h3>
            <p className="text-xs text-gray-500 mb-4">Revenue and order count per weekday — best day: <span className="font-bold text-green-600">{dayLabels[bestDay]}</span></p>
            <div className="flex items-end gap-2 h-28">
              {dayLabels.map((label, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-[9px] text-gray-600">{dayCounts[i]}</span>
                  <div className="w-full rounded-t transition-all" style={{ height: `${maxRev > 0 ? (dayRevenue[i]/maxRev*80) : 4}px`, background: i === bestDay ? '#f97316' : '#6366f1', minHeight: '4px' }} />
                  <span className="text-[9px] text-gray-500 font-medium">{label}</span>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1 mt-2">
              {dayRevenue.map((r,i) => (
                <div key={i} className="text-center text-[8px] text-gray-400">{r >= 1000 ? fmtAna(r,'K',0) : fmtAna(r)}</div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 265: Supplier Lead Time Estimation (envanter) ── */}
      {reportsTab === 'envanter' && inventory.length >= 5 && (() => {
        const supplierMap: Record<string, {items: number; avgCost: number; totalValue: number}> = {};
        inventory.forEach(item => {
          const sup = item.supplier || 'Unknown';
          if (!supplierMap[sup]) supplierMap[sup] = { items: 0, avgCost: 0, totalValue: 0 };
          supplierMap[sup].items++;
          supplierMap[sup].totalValue += itemCostTRY(item, exchangeRates) * item.stockLevel;
          supplierMap[sup].avgCost += itemCostTRY(item, exchangeRates);
        });
        const suppliers = Object.entries(supplierMap)
          .map(([name, d]) => ({ name, items: d.items, avgCost: d.items > 0 ? d.avgCost / d.items : 0, totalValue: d.totalValue }))
          .sort((a,b) => b.totalValue - a.totalValue)
          .slice(0, 8);
        if (suppliers.length === 0) return null;
        const totalVal = suppliers.reduce((s,s2) => s + s2.totalValue, 0);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Supplier Inventory Exposure</h3>
            <p className="text-xs text-gray-500 mb-3">Stock value at cost by supplier — top {suppliers.length}</p>
            <div className="space-y-2">
              {suppliers.map((s, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs text-gray-700 w-32 truncate font-medium">{s.name}</span>
                  <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full bg-purple-500" style={{ width: `${totalVal > 0 ? (s.totalValue/totalVal*100) : 0}%` }} />
                  </div>
                  <span className="text-xs text-gray-600 w-28 text-right">{fmtAna(s.totalValue,'full',0)} · {s.items} SKUs</span>
                </div>
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-3">Total supplier exposure: {fmtAna(totalVal,'full',0)}</p>
          </div>
        );
      })()}

      {/* ── Phase 266: Order Density Calendar Heatmap (genel) ── */}
      {reportsTab === 'genel' && orders.length >= 10 && (() => {
        const now = new Date();
        const dayCounts: Record<string, number> = {};
        orders.forEach(o => {
          const d = (o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string);
          const diff = Math.floor((now.getTime() - d.getTime()) / 86400000);
          if (diff <= 90) {
            const key = d.toISOString().slice(0,10);
            dayCounts[key] = (dayCounts[key] || 0) + 1;
          }
        });
        const days = Array.from({length: 90}, (_, i) => {
          const d = new Date(now);
          d.setDate(d.getDate() - (89 - i));
          return d.toISOString().slice(0,10);
        });
        const maxCount = Math.max(...days.map(d => dayCounts[d] || 0), 1);
        const totalDaysWithOrders = days.filter(d => dayCounts[d] > 0).length;
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Order Density — Last 90 Days</h3>
            <p className="text-xs text-gray-500 mb-4">{totalDaysWithOrders} active days out of 90</p>
            <div className="grid gap-0.5" style={{ gridTemplateColumns: 'repeat(30, 1fr)' }}>
              {days.map(day => {
                const count = dayCounts[day] || 0;
                const intensity = count / maxCount;
                return (
                  <div
                    key={day}
                    title={`${day}: ${count} orders`}
                    className="rounded-sm cursor-default"
                    style={{ height: '12px', background: count === 0 ? '#f3f4f6' : `rgba(239,68,68,${0.2 + intensity*0.8})` }}
                  />
                );
              })}
            </div>
            <div className="flex items-center gap-2 mt-3">
              <span className="text-[9px] text-gray-400">Less</span>
              {[0.1, 0.3, 0.5, 0.7, 1.0].map((v,i) => (
                <div key={i} className="w-3 h-3 rounded-sm" style={{ background: `rgba(239,68,68,${0.2+v*0.8})` }} />
              ))}
              <span className="text-[9px] text-gray-400">More</span>
            </div>
          </div>
        );
      })()}

      {/* ── Phase 267: Customer Tier Revenue Matrix (crm) ── */}
      {reportsTab === 'crm' && orders.length >= 10 && (() => {
        const tiers: Record<string, {revenue: number; orders: number; customers: Set<string>}> = {};
        orders.forEach(o => {
          const tier = o.customerType || 'Unknown';
          if (!tiers[tier]) tiers[tier] = { revenue: 0, orders: 0, customers: new Set() };
          tiers[tier].revenue += o.totalPrice;
          tiers[tier].orders++;
          tiers[tier].customers.add(o.customerName);
        });
        const tierData = Object.entries(tiers).map(([tier, d]) => ({
          tier,
          revenue: d.revenue,
          orders: d.orders,
          customers: d.customers.size,
          avgOrder: d.orders > 0 ? d.revenue / d.orders : 0,
          revenuePerCustomer: d.customers.size > 0 ? d.revenue / d.customers.size : 0,
        })).sort((a,b) => b.revenue - a.revenue);
        if (tierData.length === 0) return null;
        const totalRevenue = tierData.reduce((s,t) => s+t.revenue, 0);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-3">Customer Tier Revenue Matrix</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-500 border-b border-gray-100">
                    <th className="text-left pb-2">Tier</th>
                    <th className="text-right pb-2">Revenue</th>
                    <th className="text-right pb-2">Share</th>
                    <th className="text-right pb-2">Orders</th>
                    <th className="text-right pb-2">Customers</th>
                    <th className="text-right pb-2">Avg Order</th>
                    <th className="text-right pb-2">Rev/Customer</th>
                  </tr>
                </thead>
                <tbody>
                  {tierData.map((t,i) => (
                    <tr key={i} className="border-b border-gray-50">
                      <td className="py-2 font-medium text-gray-800">{t.tier}</td>
                      <td className="py-2 text-right">{fmtAna(t.revenue,'full',0)}</td>
                      <td className="py-2 text-right font-bold" style={{ color: i===0?'#10b981':'#6b7280' }}>{totalRevenue > 0 ? ((t.revenue/totalRevenue)*100).toFixed(1) : 0}%</td>
                      <td className="py-2 text-right">{t.orders}</td>
                      <td className="py-2 text-right">{t.customers}</td>
                      <td className="py-2 text-right">{fmtAna(t.avgOrder,'full',0)}</td>
                      <td className="py-2 text-right">{fmtAna(t.revenuePerCustomer,'full',0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}

      {/* ── Phase 268: Payroll Growth vs Revenue Growth (ik) ── */}
      {reportsTab === 'ik' && employees.length >= 2 && orders.length >= 10 && (() => {
        const now = new Date();
        const months = Array.from({length:6}, (_,i) => {
          const d = new Date(now.getFullYear(), now.getMonth() - (5-i), 1);
          return { label: `${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getFullYear()).slice(2)}`, year: d.getFullYear(), month: d.getMonth() };
        });
        const totalPayroll = employees.reduce((s,e) => s + (e.salary || 0), 0);
        const data = months.map(m => {
          const rev = orders.filter(o => {
            const d = (o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string);
            return d.getFullYear() === m.year && d.getMonth() === m.month;
          }).reduce((s,o) => s+o.totalPrice, 0);
          return { label: m.label, revenue: rev, payroll: totalPayroll, ratio: rev > 0 ? (totalPayroll/rev*100) : 0 };
        });
        const hasData = data.some(d => d.revenue > 0);
        if (!hasData) return null;
        const maxRev = Math.max(...data.map(d=>d.revenue),1);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Payroll-to-Revenue Ratio Trend</h3>
            <p className="text-xs text-gray-500 mb-4">Monthly payroll burden as % of revenue — target: below 30%</p>
            <div className="space-y-2">
              {data.map((d,i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs text-gray-500 w-12">{d.label}</span>
                  <div className="flex-1 h-5 bg-gray-100 rounded-full overflow-hidden relative">
                    <div className="h-full rounded-full bg-blue-400" style={{ width: `${d.revenue/maxRev*100}%` }} />
                  </div>
                  <span className="text-xs font-bold w-14 text-right" style={{ color: d.ratio > 50 ? '#ef4444' : d.ratio > 30 ? '#f59e0b' : '#10b981' }}>
                    {d.revenue > 0 ? `${d.ratio.toFixed(0)}%` : 'N/A'}
                  </span>
                  <span className="text-xs text-gray-400 w-24 text-right">{fmtAna(d.revenue,'full',0)}</span>
                </div>
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-2">Monthly payroll base: {fmtAna(totalPayroll,'full',0)}</p>
          </div>
        );
      })()}

      {/* ── Phase 269: Top Loss-Making Orders (genel) ── */}
      {reportsTab === 'genel' && orders.length >= 5 && (() => {
        const withMargin = orders.filter(o => o.lineItems && o.lineItems.length > 0).map(o => {
          const cost = (o.lineItems || []).reduce((s, li) => {
            const inv = inventory.find(it => it.id === li.inventoryId || it.sku === li.sku);
            return s + (inv ? itemCostTRY(inv, exchangeRates) : (li.costPrice || 0)) * li.quantity;
          }, 0);
          const margin = o.totalPrice - cost;
          return { id: o.id, customer: o.customerName, revenue: o.totalPrice, cost, margin, marginPct: o.totalPrice > 0 ? (margin/o.totalPrice*100) : 0 };
        }).filter(o => o.margin < 0).sort((a,b) => a.margin - b.margin).slice(0,6);
        if (withMargin.length === 0) return null;
        const totalLoss = withMargin.reduce((s,o) => s + Math.abs(o.margin), 0);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Loss-Making Orders Alert</h3>
            <p className="text-xs text-gray-500 mb-3">Orders where cost {'>'}  revenue — total exposure: {fmtAna(totalLoss,'full',0)}</p>
            <div className="space-y-2">
              {withMargin.map((o,i) => (
                <div key={i} className="flex items-center justify-between text-xs p-2 rounded-lg bg-red-50">
                  <span className="font-medium text-gray-800 truncate w-32">{o.customer}</span>
                  <span className="text-gray-500">Revenue: {fmtAna(o.revenue,'full',0)}</span>
                  <span className="text-red-600 font-bold">Loss: {fmtAna(Math.abs(o.margin),'full',0)} ({o.marginPct.toFixed(1)}%)</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 270: Logistics Performance Score Card (lojistik) ── */}
      {reportsTab === 'lojistik' && orders.length >= 5 && (() => {
        const total = orders.length;
        const delivered = orders.filter(o => o.status === 'Delivered').length;
        const cancelled = orders.filter(o => o.status === 'Cancelled').length;
        const pending = orders.filter(o => o.status === 'Pending').length;
        const inTransit = orders.filter(o => o.status === 'Shipped' || o.status === 'Processing').length;
        const deliveryRate = total > 0 ? (delivered / total * 100) : 0;
        const cancellationRate = total > 0 ? (cancelled / total * 100) : 0;
        const utilizationRate = total > 0 ? ((total - pending) / total * 100) : 0;
        const now = new Date();
        const avgAge = orders.filter(o => o.status === 'Pending' || o.status === 'Processing').map(o => {
          const d = (o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string);
          return (now.getTime() - d.getTime()) / 86400000;
        });
        const avgOpenAge = avgAge.length > 0 ? avgAge.reduce((s,a)=>s+a,0) / avgAge.length : 0;
        const score = Math.round(deliveryRate * 0.4 + utilizationRate * 0.3 + Math.max(0, 100 - cancellationRate * 5) * 0.2 + Math.max(0, 100 - avgOpenAge * 2) * 0.1);
        const scoreColor = score >= 80 ? '#10b981' : score >= 60 ? '#f59e0b' : '#ef4444';
        const metrics = [
          { label: 'Delivery Rate', value: `${deliveryRate.toFixed(1)}%`, color: deliveryRate >= 80 ? '#10b981' : '#f59e0b' },
          { label: 'Cancellation Rate', value: `${cancellationRate.toFixed(1)}%`, color: cancellationRate <= 5 ? '#10b981' : '#ef4444' },
          { label: 'In Transit', value: inTransit.toString(), color: '#3b82f6' },
          { label: 'Pending', value: pending.toString(), color: pending > 10 ? '#ef4444' : '#6b7280' },
          { label: 'Avg Open Age', value: `${avgOpenAge.toFixed(1)}d`, color: avgOpenAge <= 3 ? '#10b981' : '#f59e0b' },
          { label: 'Fulfillment Rate', value: `${utilizationRate.toFixed(1)}%`, color: utilizationRate >= 90 ? '#10b981' : '#f59e0b' },
        ];
        return (
          <div className="apple-card p-6">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="font-bold text-gray-800">Logistics Performance Score</h3>
                <p className="text-xs text-gray-500">Composite score from delivery, cancellation & fulfillment KPIs</p>
              </div>
              <div className="text-center">
                <div className="text-4xl font-black" style={{ color: scoreColor }}>{score}</div>
                <div className="text-xs text-gray-400">/ 100</div>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {metrics.map((m,i) => (
                <div key={i} className="bg-gray-50 rounded-xl p-3 text-center">
                  <div className="text-lg font-bold" style={{ color: m.color }}>{m.value}</div>
                  <div className="text-[10px] text-gray-500 mt-0.5">{m.label}</div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 271: Revenue by Product Category Trend (envanter) ── */}
      {reportsTab === 'envanter' && orders.length >= 10 && (() => {
        const now = new Date();
        const months = Array.from({length:6}, (_,i) => {
          const d = new Date(now.getFullYear(), now.getMonth() - (5-i), 1);
          return { key: `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`, label: `${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getFullYear()).slice(2)}`, year: d.getFullYear(), month: d.getMonth() };
        });
        const catRevenue: Record<string, Record<string, number>> = {};
        orders.forEach(o => {
          const d = (o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string);
          const mkey = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          (o.lineItems || []).forEach(li => {
            const inv = inventory.find(it => it.id === li.inventoryId || it.sku === li.sku);
            const cat = inv?.category || 'Uncategorized';
            if (!catRevenue[cat]) catRevenue[cat] = {};
            catRevenue[cat][mkey] = (catRevenue[cat][mkey] || 0) + li.price * li.quantity;
          });
        });
        const topCats = Object.entries(catRevenue)
          .map(([cat, mdata]) => ({ cat, total: Object.values(mdata).reduce((s,v)=>s+v,0) }))
          .sort((a,b) => b.total - a.total).slice(0,4).map(c => c.cat);
        if (topCats.length === 0) return null;
        const colors = ['#3b82f6','#10b981','#f59e0b','#8b5cf6'];
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-3">Revenue by Category — 6-Month Trend</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-400 border-b border-gray-100">
                    <th className="text-left pb-2">Category</th>
                    {months.map(m => <th key={m.key} className="text-right pb-2">{m.label}</th>)}
                    <th className="text-right pb-2">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {topCats.map((cat, ci) => (
                    <tr key={cat} className="border-b border-gray-50">
                      <td className="py-1.5 font-medium" style={{ color: colors[ci] }}>{cat}</td>
                      {months.map(m => (
                        <td key={m.key} className="py-1.5 text-right text-gray-600">
                          {catRevenue[cat][m.key] ? `₺${(catRevenue[cat][m.key]/1000).toFixed(0)}k` : '-'}
                        </td>
                      ))}
                      <td className="py-1.5 text-right font-bold text-gray-800">
                        {fmtAna(Object.values(catRevenue[cat]).reduce((s,v)=>s+v,0),'K',0)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}

      {/* ── Phase 272: Order Return on Investment per Sales Rep (crm) ── */}
      {reportsTab === 'crm' && orders.length >= 10 && (() => {
        const repData: Record<string, {revenue: number; cost: number; count: number}> = {};
        orders.forEach(o => {
          const rep = (o.assignedTo as string) || 'Unassigned';
          if (!repData[rep]) repData[rep] = { revenue: 0, cost: 0, count: 0 };
          repData[rep].revenue += o.totalPrice;
          repData[rep].count++;
          repData[rep].cost += (o.lineItems || []).reduce((s, li) => {
            const inv = inventory.find(it => it.id === li.inventoryId || it.sku === li.sku);
            return s + (inv ? itemCostTRY(inv, exchangeRates) : (li.costPrice || 0)) * li.quantity;
          }, 0);
        });
        const reps = Object.entries(repData)
          .map(([rep, d]) => ({ rep, revenue: d.revenue, cost: d.cost, count: d.count, margin: d.revenue - d.cost, marginPct: d.revenue > 0 ? ((d.revenue - d.cost)/d.revenue*100) : 0 }))
          .sort((a,b) => b.margin - a.margin).slice(0,8);
        if (reps.length === 0) return null;
        const maxMargin = Math.max(...reps.map(r => r.margin));
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-3">Gross Margin by Sales Rep</h3>
            <div className="space-y-2">
              {reps.map((r,i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs text-gray-700 w-28 truncate font-medium">{r.rep}</span>
                  <div className="flex-1 h-5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${maxMargin > 0 ? Math.max(2, r.margin/maxMargin*100) : 2}%`, background: r.marginPct >= 30 ? '#10b981' : r.marginPct >= 15 ? '#f59e0b' : '#ef4444' }} />
                  </div>
                  <span className="text-xs font-bold w-12 text-right" style={{ color: r.marginPct >= 30 ? '#10b981' : r.marginPct >= 15 ? '#f59e0b' : '#ef4444' }}>{r.marginPct.toFixed(0)}%</span>
                  <span className="text-xs text-gray-400 w-20 text-right">{fmtAna(r.margin,'full',0)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 273: Multi-Currency Revenue Breakdown (genel) ── */}
      {reportsTab === 'genel' && exchangeRates && orders.length >= 5 && (() => {
        const usdRate = exchangeRates['USD'] || 32;
        const eurRate = exchangeRates['EUR'] || 35;
        const now = new Date();
        const last30 = orders.filter(o => {
          const d = (o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string);
          return (now.getTime() - d.getTime()) / 86400000 <= 30;
        });
        const totalTRY = last30.reduce((s,o) => s+o.totalPrice, 0);
        if (totalTRY === 0) return null;
        const totalUSD = totalTRY / usdRate;
        const totalEUR = totalTRY / eurRate;
        const avgOrderTRY = last30.length > 0 ? totalTRY / last30.length : 0;
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Multi-Currency Revenue (Last 30 Days)</h3>
            <p className="text-xs text-gray-500 mb-4">Based on live exchange rates: 1 USD = ₺{usdRate.toFixed(2)} · 1 EUR = ₺{eurRate.toFixed(2)}</p>
            <div className="grid grid-cols-3 gap-4">
              {[
                { currency: '₺ TRY', value: totalTRY, sub: `${last30.length} orders` },
                { currency: '$ USD', value: totalUSD, sub: `avg $${(avgOrderTRY/usdRate).toFixed(0)}/order` },
                { currency: '€ EUR', value: totalEUR, sub: `avg €${(avgOrderTRY/eurRate).toFixed(0)}/order` },
              ].map((c,i) => (
                <div key={i} className="bg-gray-50 rounded-xl p-4 text-center">
                  <div className="text-xs text-gray-400 mb-1">{c.currency}</div>
                  <div className="text-xl font-black text-gray-800">{i===0 ? '₺' : i===1 ? '$' : '€'}{c.value.toLocaleString('en', {maximumFractionDigits:0})}</div>
                  <div className="text-[10px] text-gray-400 mt-1">{c.sub}</div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 274: Inventory Stockout Frequency (envanter) ── */}
      {reportsTab === 'envanter' && inventoryMovements.length >= 5 && inventory.length >= 3 && (() => {
        const stockoutMap: Record<string, number> = {};
        inventoryMovements.filter(m => m.type === 'out').forEach(m => {
          const key = m.productName || 'Unknown';
          stockoutMap[key] = (stockoutMap[key] || 0) + 1;
        });
        const lowStockItems = inventory.filter(item => item.stockLevel <= item.lowStockThreshold && item.stockLevel >= 0)
          .map(item => ({ name: item.name, stock: item.stockLevel, threshold: item.lowStockThreshold, outFreq: stockoutMap[item.name] || 0 }))
          .sort((a,b) => b.outFreq - a.outFreq).slice(0,8);
        if (lowStockItems.length === 0) {
          return (
            <div className="apple-card p-6">
              <h3 className="font-bold text-gray-800 mb-1">Stockout Frequency Monitor</h3>
              <p className="text-xs text-green-600 text-center py-4">✅ No items currently at or below reorder threshold</p>
            </div>
          );
        }
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Stockout Frequency Monitor</h3>
            <p className="text-xs text-gray-500 mb-3">Items at/below threshold sorted by movement frequency</p>
            <div className="space-y-2">
              {lowStockItems.map((item,i) => (
                <div key={i} className="flex items-center justify-between text-xs p-2 rounded-lg bg-amber-50">
                  <span className="font-medium text-gray-800 truncate w-36">{item.name}</span>
                  <span className="text-amber-700">Stock: {item.stock} / Min: {item.threshold}</span>
                  <span className="text-gray-500">{item.outFreq} outflows</span>
                  <span className={`font-bold ${item.stock === 0 ? 'text-red-600' : 'text-amber-600'}`}>{item.stock === 0 ? '🔴 OUT' : '🟡 LOW'}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 275: Customer Segment Profitability (crm) ── */}
      {reportsTab === 'crm' && orders.length >= 10 && (() => {
        const segments: Record<string, {revenue: number; cost: number; orders: number; customers: Set<string>}> = {};
        orders.forEach(o => {
          const seg = o.customerType || 'Unknown';
          if (!segments[seg]) segments[seg] = { revenue: 0, cost: 0, orders: 0, customers: new Set() };
          segments[seg].revenue += o.totalPrice;
          segments[seg].orders++;
          segments[seg].customers.add(o.customerName);
          segments[seg].cost += (o.lineItems || []).reduce((s, li) => {
            const inv = inventory.find(it => it.id === li.inventoryId || it.sku === li.sku);
            return s + (inv ? itemCostTRY(inv, exchangeRates) : (li.costPrice || 0)) * li.quantity;
          }, 0);
        });
        const data = Object.entries(segments).map(([seg, d]) => ({
          seg, revenue: d.revenue, cost: d.cost, orders: d.orders, customers: d.customers.size,
          margin: d.revenue - d.cost,
          marginPct: d.revenue > 0 ? ((d.revenue - d.cost)/d.revenue*100) : 0,
          ltv: d.customers.size > 0 ? d.revenue / d.customers.size : 0,
        })).sort((a,b) => b.margin - a.margin);
        if (data.length === 0) return null;
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-3">Customer Segment Profitability</h3>
            <div className="space-y-4">
              {data.map((d,i) => (
                <div key={i} className="border border-gray-100 rounded-xl p-4">
                  <div className="flex justify-between items-center mb-2">
                    <span className="font-bold text-gray-800">{d.seg}</span>
                    <span className="text-sm font-black" style={{ color: d.marginPct >= 25 ? '#10b981' : d.marginPct >= 10 ? '#f59e0b' : '#ef4444' }}>{d.marginPct.toFixed(1)}% margin</span>
                  </div>
                  <div className="grid grid-cols-4 gap-2 text-xs text-center">
                    <div className="bg-gray-50 rounded-lg p-2"><div className="font-bold text-gray-800">{fmtAna(d.revenue,'K',0)}</div><div className="text-gray-400">Revenue</div></div>
                    <div className="bg-gray-50 rounded-lg p-2"><div className="font-bold text-gray-800">{fmtAna(d.margin,'K',0)}</div><div className="text-gray-400">Margin</div></div>
                    <div className="bg-gray-50 rounded-lg p-2"><div className="font-bold text-gray-800">{d.customers}</div><div className="text-gray-400">Customers</div></div>
                    <div className="bg-gray-50 rounded-lg p-2"><div className="font-bold text-gray-800">{fmtAna(d.ltv,'K',0)}</div><div className="text-gray-400">LTV</div></div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 276: Order Priority Distribution (lojistik) ── */}
      {reportsTab === 'lojistik' && orders.length >= 5 && (() => {
        const now = new Date();
        const aged = orders.filter(o => o.status === 'Pending' || o.status === 'Processing').map(o => {
          const d = (o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string);
          const age = Math.floor((now.getTime() - d.getTime()) / 86400000);
          return { ...o, age };
        });
        const critical = aged.filter(o => o.age >= 7);
        const urgent = aged.filter(o => o.age >= 3 && o.age < 7);
        const normal = aged.filter(o => o.age < 3);
        const buckets = [
          { label: 'Critical (7+ days)', count: critical.length, revenue: critical.reduce((s,o)=>s+o.totalPrice,0), color: '#ef4444', bg: '#fef2f2' },
          { label: 'Urgent (3-6 days)', count: urgent.length, revenue: urgent.reduce((s,o)=>s+o.totalPrice,0), color: '#f59e0b', bg: '#fffbeb' },
          { label: 'Normal (0-2 days)', count: normal.length, revenue: normal.reduce((s,o)=>s+o.totalPrice,0), color: '#10b981', bg: '#f0fdf4' },
        ];
        if (aged.length === 0) {
          return (
            <div className="apple-card p-6">
              <h3 className="font-bold text-gray-800 mb-1">Open Order Priority Queue</h3>
              <p className="text-xs text-green-600 text-center py-4">✅ No open orders pending fulfillment</p>
            </div>
          );
        }
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Open Order Priority Queue</h3>
            <p className="text-xs text-gray-500 mb-4">Age-based prioritization of {aged.length} open orders</p>
            <div className="space-y-3">
              {buckets.map((b,i) => (
                <div key={i} className="flex items-center justify-between p-3 rounded-xl" style={{ background: b.bg }}>
                  <div>
                    <span className="text-sm font-bold" style={{ color: b.color }}>{b.label}</span>
                    <span className="text-xs text-gray-500 ml-2">{b.count} orders</span>
                  </div>
                  <div className="text-sm font-bold text-gray-700">{fmtAna(b.revenue,'full',0)}</div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 277: Employee Efficiency Ratio (ik) ── */}
      {reportsTab === 'ik' && employees.length >= 2 && orders.length >= 5 && (() => {
        const now = new Date();
        const last90Rev = orders.filter(o => {
          const d = (o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string);
          return (now.getTime() - d.getTime()) / 86400000 <= 90;
        }).reduce((s,o) => s+o.totalPrice, 0);
        const activeEmps = employees.filter(e => e.status === 'Aktif');
        const totalPayroll = activeEmps.reduce((s,e) => s + (e.salary || 0), 0);
        const annualPayroll = totalPayroll * 12;
        const annualRevEst = last90Rev * (365 / 90);
        const revenuePerEmp = activeEmps.length > 0 ? annualRevEst / activeEmps.length : 0;
        const payrollRatio = annualRevEst > 0 ? (annualPayroll / annualRevEst * 100) : 0;
        const deptData: Record<string, {count:number; payroll:number}> = {};
        activeEmps.forEach(e => {
          const dept = e.department || 'Other';
          if (!deptData[dept]) deptData[dept] = { count: 0, payroll: 0 };
          deptData[dept].count++;
          deptData[dept].payroll += e.salary || 0;
        });
        const depts = Object.entries(deptData).sort((a,b)=>b[1].payroll-a[1].payroll).slice(0,5);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-4">Employee Efficiency Ratios</h3>
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="bg-blue-50 rounded-xl p-3 text-center">
                <div className="text-lg font-black text-blue-700">{fmtAna(revenuePerEmp,'K',0)}</div>
                <div className="text-[10px] text-gray-500 mt-0.5">Revenue/Employee (Annual)</div>
              </div>
              <div className="rounded-xl p-3 text-center" style={{ background: payrollRatio <= 25 ? '#f0fdf4' : payrollRatio <= 40 ? '#fffbeb' : '#fef2f2' }}>
                <div className="text-lg font-black" style={{ color: payrollRatio <= 25 ? '#10b981' : payrollRatio <= 40 ? '#f59e0b' : '#ef4444' }}>{payrollRatio.toFixed(1)}%</div>
                <div className="text-[10px] text-gray-500 mt-0.5">Payroll/Revenue Ratio</div>
              </div>
              <div className="bg-purple-50 rounded-xl p-3 text-center">
                <div className="text-lg font-black text-purple-700">{activeEmps.length}</div>
                <div className="text-[10px] text-gray-500 mt-0.5">Active Employees</div>
              </div>
            </div>
            <div className="space-y-2">
              {depts.map(([dept, d], i) => (
                <div key={i} className="flex items-center justify-between text-xs">
                  <span className="text-gray-600 w-32 truncate">{dept}</span>
                  <span className="text-gray-400">{d.count} staff</span>
                  <span className="font-medium text-gray-800">{fmtAna(d.payroll,'full',0)}/mo</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 278: Top Products by Velocity (envanter) ── */}
      {reportsTab === 'envanter' && inventoryMovements.length >= 5 && (() => {
        const now = new Date();
        const velocityMap: Record<string, {units: number; value: number}> = {};
        inventoryMovements.filter(m => {
          if (m.type !== 'out') return false;
          const d = (m.timestamp as {toDate?:()=>Date}).toDate?.() ?? new Date(m.timestamp as string);
          return (now.getTime() - d.getTime()) / 86400000 <= 30;
        }).forEach(m => {
          const key = m.productName || 'Unknown';
          if (!velocityMap[key]) velocityMap[key] = { units: 0, value: 0 };
          velocityMap[key].units += m.quantity || 1;
          const inv = inventory.find(it => it.name === key);
          velocityMap[key].value += (m.quantity || 1) * (inv ? itemCostTRY(inv, exchangeRates) : 0);
        });
        const top = Object.entries(velocityMap)
          .map(([name, d]) => ({ name, units: d.units, value: d.value, dailyVelocity: d.units / 30 }))
          .sort((a,b) => b.units - a.units).slice(0,8);
        if (top.length === 0) return null;
        const maxUnits = Math.max(...top.map(t=>t.units));
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Top Products by Sales Velocity (Last 30 Days)</h3>
            <p className="text-xs text-gray-500 mb-4">Units shipped from inventory movements</p>
            <div className="space-y-2">
              {top.map((t,i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-[10px] font-bold text-gray-400 w-4">{i+1}</span>
                  <span className="text-xs text-gray-700 truncate w-36 font-medium">{t.name}</span>
                  <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full bg-green-500" style={{ width: `${maxUnits>0?(t.units/maxUnits*100):0}%` }} />
                  </div>
                  <span className="text-xs text-gray-600 w-16 text-right">{t.units} units</span>
                  <span className="text-xs text-gray-400 w-14 text-right">{t.dailyVelocity.toFixed(1)}/day</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 279: Revenue Concentration by Geography (crm) ── */}
      {reportsTab === 'crm' && orders.length >= 10 && (() => {
        const geoRevenue: Record<string, {revenue: number; orders: number}> = {};
        orders.forEach(o => {
          const addr = (o.shippingAddress || '').toLowerCase();
          let region = 'Unknown';
          if (addr.includes('istanbul') || addr.includes('İstanbul')) region = 'İstanbul';
          else if (addr.includes('ankara')) region = 'Ankara';
          else if (addr.includes('izmir') || addr.includes('İzmir')) region = 'İzmir';
          else if (addr.includes('bursa')) region = 'Bursa';
          else if (addr.includes('antalya')) region = 'Antalya';
          else if (addr.includes('adana')) region = 'Adana';
          else if (addr.match(/\b(tr|turkey|türkiye)\b/)) region = 'Other TR';
          else if (addr.length > 3) region = 'Other';
          if (!geoRevenue[region]) geoRevenue[region] = { revenue: 0, orders: 0 };
          geoRevenue[region].revenue += o.totalPrice;
          geoRevenue[region].orders++;
        });
        const regions = Object.entries(geoRevenue)
          .map(([region, d]) => ({ region, ...d }))
          .sort((a,b) => b.revenue - a.revenue).slice(0,7);
        if (regions.length === 0 || (regions.length === 1 && regions[0].region === 'Unknown')) return null;
        const totalRev = regions.reduce((s,r)=>s+r.revenue,0);
        const maxRev = Math.max(...regions.map(r=>r.revenue));
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-3">Revenue Concentration by Region</h3>
            <div className="space-y-2">
              {regions.map((r,i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs text-gray-700 w-24 font-medium">{r.region}</span>
                  <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full bg-indigo-500" style={{ width: `${maxRev>0?(r.revenue/maxRev*100):0}%` }} />
                  </div>
                  <span className="text-xs text-gray-500 w-10 text-right">{r.orders} ord</span>
                  <span className="text-xs font-bold text-indigo-700 w-10 text-right">{totalRev>0?((r.revenue/totalRev)*100).toFixed(0):0}%</span>
                  <span className="text-xs text-gray-600 w-20 text-right">{fmtAna(r.revenue,'full',0)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 280: Comprehensive Financial Ratios (genel) ── */}
      {reportsTab === 'genel' && orders.length >= 10 && (() => {
        const now = new Date();
        const totalRevenue = orders.reduce((s,o) => s+o.totalPrice, 0);
        const totalCost = orders.reduce((s,o) => s + (o.lineItems||[]).reduce((sc, li) => {
          const inv = inventory.find(it => it.id === li.inventoryId || it.sku === li.sku);
          return sc + (inv ? itemCostTRY(inv, exchangeRates) : (li.costPrice||0)) * li.quantity;
        }, 0), 0);
        const grossProfit = totalRevenue - totalCost;
        const grossMarginPct = totalRevenue > 0 ? (grossProfit/totalRevenue*100) : 0;
        const inventoryValue = inventory.reduce((s,i) => s + i.stockLevel * itemCostTRY(i, exchangeRates), 0);
        const monthlyRevArr = Array.from({length:12}, (_,i) => {
          const d = new Date(now.getFullYear(), now.getMonth()-11+i, 1);
          return orders.filter(o => {
            const od = (o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string);
            return od.getFullYear()===d.getFullYear() && od.getMonth()===d.getMonth();
          }).reduce((s,o)=>s+o.totalPrice,0);
        });
        const avgMonthlyRev = monthlyRevArr.reduce((s,v)=>s+v,0) / 12;
        const inventoryTurnover = inventoryValue > 0 ? (totalCost / inventoryValue) : 0;
        const dso = avgMonthlyRev > 0 ? (inventoryValue / avgMonthlyRev * 30) : 0;
        const ratios = [
          { label: 'Gross Margin', value: `${grossMarginPct.toFixed(1)}%`, good: grossMarginPct >= 30, neutral: grossMarginPct >= 15 },
          { label: 'Inventory Turnover', value: `${inventoryTurnover.toFixed(1)}x`, good: inventoryTurnover >= 4, neutral: inventoryTurnover >= 2 },
          { label: 'Avg Monthly Revenue', value: `₺${(avgMonthlyRev/1000).toFixed(0)}k`, good: true, neutral: true },
          { label: 'Gross Profit', value: `₺${(grossProfit/1000).toFixed(0)}k`, good: grossProfit > 0, neutral: grossProfit >= 0 },
          { label: 'Inventory Value', value: `₺${(inventoryValue/1000).toFixed(0)}k`, good: true, neutral: true },
          { label: 'Est. DSO', value: `${dso.toFixed(0)} days`, good: dso <= 30, neutral: dso <= 60 },
        ];
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-3">Comprehensive Financial Ratios</h3>
            <div className="grid grid-cols-3 gap-3">
              {ratios.map((r,i) => (
                <div key={i} className="bg-gray-50 rounded-xl p-3 text-center">
                  <div className="text-lg font-black" style={{ color: r.good ? '#10b981' : r.neutral ? '#f59e0b' : '#ef4444' }}>{r.value}</div>
                  <div className="text-[10px] text-gray-500 mt-0.5">{r.label}</div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 281: Monthly New vs Lost Customer Balance (crm) ── */}
      {reportsTab === 'crm' && orders.length >= 10 && (() => {
        const now = new Date();
        const months = Array.from({length:6}, (_,i) => {
          const d = new Date(now.getFullYear(), now.getMonth() - (5-i), 1);
          return { key: `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`, label: `${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getFullYear()).slice(2)}`, year: d.getFullYear(), month: d.getMonth() };
        });
        const custByMonth: Record<string, Set<string>> = {};
        months.forEach(m => { custByMonth[m.key] = new Set(); });
        orders.forEach(o => {
          const d = (o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string);
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          if (custByMonth[key]) custByMonth[key].add(o.customerName);
        });
        const data = months.map((m, i) => {
          const current = custByMonth[m.key];
          const prev = i > 0 ? custByMonth[months[i-1].key] : new Set<string>();
          const newCusts = [...current].filter(c => !prev.has(c)).length;
          const lostCusts = i > 0 ? [...prev].filter(c => !current.has(c)).length : 0;
          return { label: m.label, new: newCusts, lost: lostCusts, net: newCusts - lostCusts };
        });
        const hasData = data.some(d => d.new > 0 || d.lost > 0);
        if (!hasData) return null;
        const maxVal = Math.max(...data.map(d => Math.max(d.new, d.lost)), 1);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Customer Gain/Loss Balance</h3>
            <p className="text-xs text-gray-500 mb-4">New vs churned customers per month (MoM)</p>
            <div className="flex items-center justify-center gap-1 mb-2">
              <span className="w-3 h-3 rounded-sm bg-green-400 inline-block"></span><span className="text-xs text-gray-500 mr-4">New</span>
              <span className="w-3 h-3 rounded-sm bg-red-400 inline-block"></span><span className="text-xs text-gray-500">Lost</span>
            </div>
            <div className="flex items-end justify-around gap-2 h-28">
              {data.map((d,i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                  <div className="w-full flex gap-0.5 items-end justify-center" style={{ height: '80px' }}>
                    <div className="w-1/2 rounded-t bg-green-400" style={{ height: `${maxVal>0?(d.new/maxVal*80):2}px`, minHeight: d.new>0?'4px':'0' }} title={`New: ${d.new}`} />
                    <div className="w-1/2 rounded-t bg-red-400" style={{ height: `${maxVal>0?(d.lost/maxVal*80):2}px`, minHeight: d.lost>0?'4px':'0' }} title={`Lost: ${d.lost}`} />
                  </div>
                  <span className="text-[9px] text-gray-500">{d.label}</span>
                  <span className="text-[9px] font-bold" style={{ color: d.net >= 0 ? '#10b981' : '#ef4444' }}>{d.net >= 0 ? '+' : ''}{d.net}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 282: SKU Rationalization Score (envanter) ── */}
      {reportsTab === 'envanter' && inventory.length >= 10 && orders.length >= 5 && (() => {
        const skuSales: Record<string, number> = {};
        orders.forEach(o => (o.lineItems||[]).forEach(li => { skuSales[li.sku] = (skuSales[li.sku]||0) + li.quantity; }));
        const skuData = inventory.map(item => ({
          sku: item.sku, name: item.name,
          sold: skuSales[item.sku] || 0,
          stock: item.stockLevel,
          value: item.stockLevel * itemCostTRY(item, exchangeRates),
          category: item.category || 'Other',
        }));
        const noSales = skuData.filter(s => s.sold === 0 && s.stock > 0).sort((a,b)=>b.value-a.value).slice(0,6);
        const lowSales = skuData.filter(s => s.sold > 0 && s.sold < 5 && s.stock > 0).slice(0,4);
        if (noSales.length === 0 && lowSales.length === 0) return null;
        const deadValue = noSales.reduce((s,d)=>s+d.value,0);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">SKU Rationalization Candidates</h3>
            <p className="text-xs text-gray-500 mb-3">Zero-sales SKUs holding {fmtAna(deadValue,'full',0)} in capital</p>
            {noSales.length > 0 && (
              <div className="mb-3">
                <p className="text-xs font-bold text-red-600 mb-1">🔴 Discontinue (0 sales, stock in hand)</p>
                <div className="space-y-1">
                  {noSales.map((s,i) => (
                    <div key={i} className="flex justify-between text-xs p-1.5 bg-red-50 rounded-lg">
                      <span className="text-gray-700 truncate w-40">{s.name}</span>
                      <span className="text-gray-400">{s.sku}</span>
                      <span className="font-medium text-red-700">Qty: {s.stock} · {fmtAna(s.value,'full',0)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {lowSales.length > 0 && (
              <div>
                <p className="text-xs font-bold text-amber-600 mb-1">🟡 Review (fewer than 5 units sold)</p>
                <div className="space-y-1">
                  {lowSales.map((s,i) => (
                    <div key={i} className="flex justify-between text-xs p-1.5 bg-amber-50 rounded-lg">
                      <span className="text-gray-700 truncate w-40">{s.name}</span>
                      <span className="text-gray-400">{s.sku}</span>
                      <span className="font-medium text-amber-700">{s.sold} sold</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* ── Phase 283: Revenue per Square Meter (lojistik) ── */}
      {reportsTab === 'lojistik' && orders.length >= 5 && (() => {
        const now = new Date();
        const cargoMap: Record<string, {orders: number; revenue: number}> = {};
        orders.filter(o => o.cargoCompany).forEach(o => {
          const cargo = o.cargoCompany!;
          if (!cargoMap[cargo]) cargoMap[cargo] = { orders: 0, revenue: 0 };
          cargoMap[cargo].orders++;
          cargoMap[cargo].revenue += o.totalPrice;
        });
        const last30 = orders.filter(o => {
          const d = (o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string);
          return (now.getTime() - d.getTime()) / 86400000 <= 30;
        });
        const withCargo = last30.filter(o => o.cargoCompany).length;
        const withoutCargo = last30.filter(o => !o.cargoCompany).length;
        const cargoEntries = Object.entries(cargoMap).sort((a,b)=>b[1].revenue-a[1].revenue);
        if (cargoEntries.length === 0) return null;
        const totalRev = cargoEntries.reduce((s,[,d])=>s+d.revenue,0);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Cargo Partner Performance</h3>
            <p className="text-xs text-gray-500 mb-3">Revenue and order distribution by shipping carrier</p>
            <div className="space-y-2 mb-4">
              {cargoEntries.slice(0,6).map(([cargo,d],i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs text-gray-700 w-28 truncate font-medium">{cargo}</span>
                  <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full bg-cyan-500" style={{ width: `${totalRev>0?(d.revenue/totalRev*100):0}%` }} />
                  </div>
                  <span className="text-xs text-gray-500">{d.orders} orders</span>
                  <span className="text-xs font-bold text-cyan-700">{totalRev>0?((d.revenue/totalRev)*100).toFixed(0):0}%</span>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3 text-xs text-center">
              <div className="bg-green-50 rounded-xl p-3">
                <div className="font-bold text-green-700">{withCargo}</div>
                <div className="text-gray-500">Orders with Cargo (30d)</div>
              </div>
              <div className="bg-gray-50 rounded-xl p-3">
                <div className="font-bold text-gray-700">{withoutCargo}</div>
                <div className="text-gray-500">No Cargo Assigned</div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Phase 284: Gross Margin Trend (12 months) (genel) ── */}
      {reportsTab === 'genel' && orders.length >= 10 && (() => {
        const now = new Date();
        const months = Array.from({length:12}, (_,i) => {
          const d = new Date(now.getFullYear(), now.getMonth() - (11-i), 1);
          return { key: `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`, label: `${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getFullYear()).slice(2)}`, year: d.getFullYear(), month: d.getMonth() };
        });
        const monthData = months.map(m => {
          const mOrders = orders.filter(o => {
            const d = (o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string);
            return d.getFullYear() === m.year && d.getMonth() === m.month;
          });
          const rev = mOrders.reduce((s,o)=>s+o.totalPrice,0);
          const cost = mOrders.reduce((s,o)=>s+(o.lineItems||[]).reduce((sc,li)=>{
            const inv = inventory.find(it=>it.id===li.inventoryId||it.sku===li.sku);
            return sc+(inv?itemCostTRY(inv, exchangeRates):(li.costPrice||0))*li.quantity;
          },0),0);
          const margin = rev > 0 ? ((rev-cost)/rev*100) : 0;
          return { label: m.label, rev, cost, margin };
        });
        const hasData = monthData.some(d => d.rev > 0);
        if (!hasData) return null;
        const maxMargin = Math.max(...monthData.map(d=>d.margin), 1);
        const avgMargin = monthData.filter(d=>d.rev>0).reduce((s,d)=>s+d.margin,0) / (monthData.filter(d=>d.rev>0).length || 1);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Gross Margin % — 12-Month Trend</h3>
            <p className="text-xs text-gray-500 mb-4">Average: {avgMargin.toFixed(1)}% · Target: 30%</p>
            <div className="flex items-end gap-1 h-24">
              {monthData.map((d,i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-[9px] text-gray-600">{d.margin > 0 ? `${d.margin.toFixed(0)}%` : ''}</span>
                  <div className="w-full rounded-t" style={{ height: `${d.margin > 0 ? Math.max(4, d.margin/Math.max(maxMargin,50)*80) : 2}px`, background: d.margin >= 30 ? '#10b981' : d.margin >= 15 ? '#f59e0b' : d.margin > 0 ? '#ef4444' : '#e5e7eb', minHeight: '2px' }} />
                  <span className="text-[8px] text-gray-400">{d.label}</span>
                </div>
              ))}
            </div>
            <div className="flex gap-3 mt-3 text-xs">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500 inline-block"></span>≥30% target</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block"></span>15-30%</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400 inline-block"></span>below 15%</span>
            </div>
          </div>
        );
      })()}

      {/* ── Phase 285: Employee Department Headcount Trend (ik) ── */}
      {reportsTab === 'ik' && employees.length >= 3 && (() => {
        const deptCounts: Record<string, number> = {};
        employees.filter(e=>e.status==='Aktif').forEach(e => {
          const dept = e.department || 'Other';
          deptCounts[dept] = (deptCounts[dept]||0)+1;
        });
        const depts = Object.entries(deptCounts).sort((a,b)=>b[1]-a[1]);
        if (depts.length === 0) return null;
        const total = depts.reduce((s,[,c])=>s+c,0);
        const maxCount = Math.max(...depts.map(([,c])=>c));
        const colors = ['#3b82f6','#10b981','#f59e0b','#8b5cf6','#ec4899','#06b6d4','#f97316'];
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Headcount by Department</h3>
            <p className="text-xs text-gray-500 mb-4">Active employees: {total} across {depts.length} departments</p>
            <div className="space-y-2">
              {depts.map(([dept,count],i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs text-gray-700 w-28 truncate font-medium">{dept}</span>
                  <div className="flex-1 h-5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${maxCount>0?(count/maxCount*100):0}%`, background: colors[i%colors.length] }} />
                  </div>
                  <span className="text-xs font-bold text-gray-700 w-6 text-right">{count}</span>
                  <span className="text-xs text-gray-400 w-10 text-right">{total>0?((count/total)*100).toFixed(0):0}%</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 286: Quote-to-Cash Timeline (crm) ── */}
      {reportsTab === 'crm' && quotations.length >= 5 && orders.length >= 5 && (() => {
        const converted = quotations.filter(q => q.status === 'Converted to Order');
        if (converted.length < 3) return null;
        const timings: number[] = [];
        converted.forEach(q => {
          const qDate = (q.createdAt as {toDate?:()=>Date}).toDate?.() ?? (q.createdAt ? new Date(q.createdAt as string) : null);
          if (!qDate) return;
          const matchOrder = orders.find(o => o.leadId === q.leadId || o.customerName === q.customerName);
          if (!matchOrder) return;
          const oDate = (matchOrder.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(matchOrder.createdAt as string);
          const days = Math.floor((oDate.getTime() - qDate.getTime()) / 86400000);
          if (days >= 0 && days <= 365) timings.push(days);
        });
        if (timings.length < 2) return null;
        const avg = timings.reduce((s,t)=>s+t,0)/timings.length;
        const median = [...timings].sort((a,b)=>a-b)[Math.floor(timings.length/2)];
        const under7 = timings.filter(t=>t<=7).length;
        const under30 = timings.filter(t=>t<=30).length;
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-3">Quote-to-Cash Timeline</h3>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div className="bg-blue-50 rounded-xl p-3 text-center">
                <div className="text-2xl font-black text-blue-700">{avg.toFixed(1)}d</div>
                <div className="text-xs text-gray-500">Average Close Time</div>
              </div>
              <div className="bg-green-50 rounded-xl p-3 text-center">
                <div className="text-2xl font-black text-green-700">{median}d</div>
                <div className="text-xs text-gray-500">Median Close Time</div>
              </div>
            </div>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between items-center p-2 bg-gray-50 rounded-lg">
                <span className="text-gray-600">Closed within 7 days</span>
                <span className="font-bold text-green-600">{under7} / {timings.length} ({timings.length>0?((under7/timings.length)*100).toFixed(0):0}%)</span>
              </div>
              <div className="flex justify-between items-center p-2 bg-gray-50 rounded-lg">
                <span className="text-gray-600">Closed within 30 days</span>
                <span className="font-bold text-blue-600">{under30} / {timings.length} ({timings.length>0?((under30/timings.length)*100).toFixed(0):0}%)</span>
              </div>
              <div className="flex justify-between items-center p-2 bg-gray-50 rounded-lg">
                <span className="text-gray-600">Conversion rate</span>
                <span className="font-bold text-purple-600">{quotations.length>0?((converted.length/quotations.length)*100).toFixed(1):0}% ({converted.length}/{quotations.length})</span>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Phase 287: Inventory Restock Cost Forecast (envanter) ── */}
      {reportsTab === 'envanter' && inventory.length >= 5 && inventoryMovements.length >= 3 && (() => {
        const now = new Date();
        const velocityMap: Record<string, number> = {};
        inventoryMovements.filter(m => {
          if (m.type !== 'out') return false;
          const d = (m.timestamp as {toDate?:()=>Date}).toDate?.() ?? new Date(m.timestamp as string);
          return (now.getTime() - d.getTime()) / 86400000 <= 30;
        }).forEach(m => {
          velocityMap[m.productName || 'Unknown'] = (velocityMap[m.productName || 'Unknown'] || 0) + (m.quantity || 1);
        });
        const restockItems = inventory.filter(item => {
          const dailyVel = (velocityMap[item.name] || 0) / 30;
          const daysLeft = dailyVel > 0 ? item.stockLevel / dailyVel : Infinity;
          return daysLeft <= 60 && item.stockLevel > 0;
        }).map(item => {
          const dailyVel = (velocityMap[item.name] || 0) / 30;
          const daysLeft = dailyVel > 0 ? Math.floor(item.stockLevel / dailyVel) : 60;
          const unitsNeeded = Math.ceil(dailyVel * 30); // 30-day restock
          const cost = unitsNeeded * itemCostTRY(item, exchangeRates);
          return { name: item.name, sku: item.sku, daysLeft, unitsNeeded, cost, dailyVel };
        }).sort((a,b)=>a.daysLeft-b.daysLeft).slice(0,6);
        if (restockItems.length === 0) return null;
        const totalRestockCost = restockItems.reduce((s,r)=>s+r.cost,0);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Restock Cost Forecast (Next 60 Days)</h3>
            <p className="text-xs text-gray-500 mb-3">Estimated 30-day restock cost: <span className="font-bold text-purple-700">{fmtAna(totalRestockCost,'full',0)}</span></p>
            <div className="space-y-2">
              {restockItems.map((r,i) => (
                <div key={i} className="flex items-center justify-between text-xs p-2 rounded-lg" style={{ background: r.daysLeft <= 14 ? '#fef2f2' : r.daysLeft <= 30 ? '#fffbeb' : '#f0fdf4' }}>
                  <span className="font-medium text-gray-800 truncate w-36">{r.name}</span>
                  <span style={{ color: r.daysLeft <= 14 ? '#ef4444' : r.daysLeft <= 30 ? '#f59e0b' : '#10b981' }} className="font-bold">{r.daysLeft}d left</span>
                  <span className="text-gray-500">{r.unitsNeeded} units</span>
                  <span className="font-bold text-purple-700">{fmtAna(r.cost,'full',0)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 288: Customer Loyalty Index (crm) ── */}
      {reportsTab === 'crm' && orders.length >= 10 && (() => {
        const custOrders: Record<string, {count: number; revenue: number; first: Date; last: Date}> = {};
        orders.forEach(o => {
          const d = (o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string);
          if (!custOrders[o.customerName]) custOrders[o.customerName] = { count: 0, revenue: 0, first: d, last: d };
          custOrders[o.customerName].count++;
          custOrders[o.customerName].revenue += o.totalPrice;
          if (d < custOrders[o.customerName].first) custOrders[o.customerName].first = d;
          if (d > custOrders[o.customerName].last) custOrders[o.customerName].last = d;
        });
        const now = new Date();
        const custData = Object.entries(custOrders).map(([name, d]) => {
          const tenureDays = (d.last.getTime() - d.first.getTime()) / 86400000;
          const daysSinceLast = (now.getTime() - d.last.getTime()) / 86400000;
          const loyaltyScore = Math.min(100, Math.round(
            (d.count * 15) +
            (Math.min(tenureDays, 365) / 365 * 40) +
            (Math.max(0, 1 - daysSinceLast/90) * 30) +
            (Math.min(d.revenue, 100000) / 100000 * 15)
          ));
          return { name, count: d.count, revenue: d.revenue, loyaltyScore, daysSinceLast: Math.floor(daysSinceLast) };
        }).sort((a,b)=>b.loyaltyScore-a.loyaltyScore).slice(0,8);
        if (custData.length === 0) return null;
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Customer Loyalty Index</h3>
            <p className="text-xs text-gray-500 mb-3">Composite score: order freq, tenure, recency, revenue (0-100)</p>
            <div className="space-y-2">
              {custData.map((c,i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-[10px] font-bold text-gray-400 w-4">{i+1}</span>
                  <span className="text-xs text-gray-700 truncate w-28 font-medium">{c.name}</span>
                  <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${c.loyaltyScore}%`, background: c.loyaltyScore >= 70 ? '#10b981' : c.loyaltyScore >= 40 ? '#f59e0b' : '#ef4444' }} />
                  </div>
                  <span className="text-xs font-black w-8 text-right" style={{ color: c.loyaltyScore >= 70 ? '#10b981' : c.loyaltyScore >= 40 ? '#f59e0b' : '#ef4444' }}>{c.loyaltyScore}</span>
                  <span className="text-xs text-gray-400 w-12 text-right">{c.count} ord</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 289: Order Fulfilment Speed Distribution (lojistik) ── */}
      {reportsTab === 'lojistik' && orders.length >= 5 && (() => {
        const delivered = orders.filter(o => o.status === 'Delivered' && o.createdAt).map(o => {
          const created = (o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string);
          const delivered = o.estimatedDelivery
            ? ((o.estimatedDelivery as {toDate?:()=>Date}).toDate?.() ?? new Date(o.estimatedDelivery as string))
            : null;
          if (!delivered) return null;
          const days = Math.floor((delivered.getTime() - created.getTime()) / 86400000);
          return days >= 0 && days <= 30 ? days : null;
        }).filter((d): d is number => d !== null);
        if (delivered.length < 3) return null;
        const buckets = [
          { label: 'Same day', range: [0,0], color: '#10b981' },
          { label: '1-2 days', range: [1,2], color: '#3b82f6' },
          { label: '3-5 days', range: [3,5], color: '#f59e0b' },
          { label: '6-10 days', range: [6,10], color: '#f97316' },
          { label: '11+ days', range: [11,999], color: '#ef4444' },
        ];
        const bucketData = buckets.map(b => ({
          ...b,
          count: delivered.filter(d => d >= b.range[0] && d <= b.range[1]).length,
        }));
        const maxCount = Math.max(...bucketData.map(b=>b.count), 1);
        const avg = delivered.reduce((s,d)=>s+d,0)/delivered.length;
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Order Fulfilment Speed Distribution</h3>
            <p className="text-xs text-gray-500 mb-4">Based on {delivered.length} delivered orders · avg {avg.toFixed(1)} days</p>
            <div className="flex items-end gap-3 h-24">
              {bucketData.map((b,i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-[9px] text-gray-600 font-bold">{b.count}</span>
                  <div className="w-full rounded-t" style={{ height: `${maxCount>0?(b.count/maxCount*72):2}px`, background: b.color, minHeight: b.count>0?'4px':'2px' }} />
                  <span className="text-[8px] text-gray-400 text-center leading-tight">{b.label}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 290: Revenue Attribution Waterfall (genel) ── */}
      {reportsTab === 'genel' && orders.length >= 10 && (() => {
        const now = new Date();
        const prevMonth = new Date(now.getFullYear(), now.getMonth()-1, 1);
        const currMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const prevOrders = orders.filter(o => {
          const d = (o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string);
          return d >= prevMonth && d < currMonth;
        });
        const currOrders = orders.filter(o => {
          const d = (o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string);
          return d >= currMonth;
        });
        if (prevOrders.length === 0 && currOrders.length === 0) return null;
        const prevRev = prevOrders.reduce((s,o)=>s+o.totalPrice,0);
        const currRev = currOrders.reduce((s,o)=>s+o.totalPrice,0);
        const prevCusts = new Set(prevOrders.map(o=>o.customerName));
        const currCusts = new Set(currOrders.map(o=>o.customerName));
        const newCustRev = currOrders.filter(o=>!prevCusts.has(o.customerName)).reduce((s,o)=>s+o.totalPrice,0);
        const retainedRev = currOrders.filter(o=>prevCusts.has(o.customerName)).reduce((s,o)=>s+o.totalPrice,0);
        const lostRev = prevOrders.filter(o=>!currCusts.has(o.customerName)).reduce((s,o)=>s+o.totalPrice,0);
        const netChange = currRev - prevRev;
        const items = [
          { label: 'Prior Month', value: prevRev, type: 'base' as const },
          { label: 'New Customers', value: newCustRev, type: 'add' as const },
          { label: 'Retained Growth', value: retainedRev - (prevRev - lostRev), type: retainedRev - (prevRev - lostRev) >= 0 ? 'add' as const : 'sub' as const },
          { label: 'Lost Customers', value: -lostRev, type: 'sub' as const },
          { label: 'Current Month', value: currRev, type: 'base' as const },
        ];
        const maxVal = Math.max(...[prevRev, currRev], 1);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Revenue Attribution Waterfall (MoM)</h3>
            <p className="text-xs text-gray-500 mb-4">Net change: <span className={netChange >= 0 ? 'text-green-600 font-bold' : 'text-red-600 font-bold'}>{netChange >= 0 ? '+' : ''}{fmtAna(netChange,'full',0)}</span></p>
            <div className="space-y-2">
              {items.map((item,i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs text-gray-600 w-32">{item.label}</span>
                  <div className="flex-1 h-5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{
                      width: `${maxVal>0?(Math.abs(item.value)/maxVal*100):0}%`,
                      background: item.type==='base' ? '#6366f1' : item.type==='add' ? '#10b981' : '#ef4444'
                    }} />
                  </div>
                  <span className="text-xs font-bold w-24 text-right" style={{ color: item.type==='base'?'#6366f1':item.type==='add'?'#10b981':'#ef4444' }}>
                    {item.type !== 'base' && (item.value >= 0 ? '+' : '')}{fmtAna(Math.abs(item.value),'full',0)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 291: Cohort Revenue Retention Matrix (crm) ── */}
      {reportsTab === 'crm' && orders.length >= 15 && (() => {
        const cohortMap: Record<string, {customers: Set<string>; months: Record<string, number>}> = {};
        orders.forEach(o => {
          const d = (o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string);
          const cohortKey = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          if (!cohortMap[cohortKey]) cohortMap[cohortKey] = { customers: new Set(), months: {} };
        });
        // Find each customer's first order month
        const custFirstMonth: Record<string, string> = {};
        [...orders].sort((a,b) => {
          const da = (a.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(a.createdAt as string);
          const db = (b.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(b.createdAt as string);
          return da.getTime()-db.getTime();
        }).forEach(o => {
          const d = (o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string);
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          if (!custFirstMonth[o.customerName]) custFirstMonth[o.customerName] = key;
        });
        orders.forEach(o => {
          const cohort = custFirstMonth[o.customerName];
          if (!cohort || !cohortMap[cohort]) return;
          cohortMap[cohort].customers.add(o.customerName);
        });
        const cohorts = Object.keys(cohortMap).sort().slice(-5);
        if (cohorts.length < 2) return null;
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-3">Cohort Customer Count (Last 5 Cohorts)</h3>
            <div className="space-y-2">
              {cohorts.map((cohort,i) => {
                const cData = cohortMap[cohort];
                const size = cData.customers.size;
                return (
                  <div key={i} className="flex items-center gap-3">
                    <span className="text-xs text-gray-600 w-16 font-medium">{cohort.slice(5)}/{cohort.slice(2,4)}</span>
                    <div className="flex-1 h-6 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full rounded-full bg-violet-500" style={{ width: `${size > 0 ? Math.min(100, size * 10) : 2}%` }} />
                    </div>
                    <span className="text-xs font-bold text-violet-700 w-20 text-right">{size} customers</span>
                  </div>
                );
              })}
            </div>
            <p className="text-xs text-gray-400 mt-3">Cohort = month of customer's first order</p>
          </div>
        );
      })()}

      {/* ── Phase 292: Top Customers by Order Frequency (crm) ── */}
      {reportsTab === 'crm' && orders.length >= 10 && (() => {
        const custFreq: Record<string, {count: number; revenue: number; lastDate: Date}> = {};
        orders.forEach(o => {
          const d = (o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string);
          if (!custFreq[o.customerName]) custFreq[o.customerName] = { count: 0, revenue: 0, lastDate: d };
          custFreq[o.customerName].count++;
          custFreq[o.customerName].revenue += o.totalPrice;
          if (d > custFreq[o.customerName].lastDate) custFreq[o.customerName].lastDate = d;
        });
        const top = Object.entries(custFreq)
          .map(([name, d]) => ({ name, ...d }))
          .sort((a,b)=>b.count-a.count).slice(0,8);
        if (top.length === 0) return null;
        const maxCount = top[0].count;
        const now = new Date();
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-3">Top Customers by Order Frequency</h3>
            <div className="space-y-2">
              {top.map((c,i) => {
                const daysSince = Math.floor((now.getTime() - c.lastDate.getTime())/86400000);
                return (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-[10px] font-bold text-gray-400 w-4">{i+1}</span>
                    <span className="text-xs text-gray-700 truncate w-28 font-medium">{c.name}</span>
                    <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full rounded-full bg-rose-500" style={{ width: `${maxCount>0?(c.count/maxCount*100):0}%` }} />
                    </div>
                    <span className="text-xs font-bold text-rose-700 w-12 text-right">{c.count}x</span>
                    <span className="text-xs text-gray-400 w-12 text-right">{daysSince}d ago</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 293: Inventory Shrinkage & Loss Tracker (envanter) ── */}
      {reportsTab === 'envanter' && inventoryMovements.length >= 3 && (() => {
        const inbound = inventoryMovements.filter(m => m.type === 'in').reduce((s,m)=>s+(m.quantity||0),0);
        const outbound = inventoryMovements.filter(m => m.type === 'out' && (m.quantity||0) > 0).reduce((s,m)=>s+(m.quantity||0),0);
        const totalItems = inventory.length;
        const zeroStock = inventory.filter(i=>i.stockLevel === 0).length;
        const negStock = inventory.filter(i=>i.stockLevel < 0).length;
        const totalStockValue = inventory.reduce((s,i)=>s+Math.max(0,i.stockLevel)*itemCostTRY(i,exchangeRates),0);
        const shrinkageValue = inventory.filter(i=>i.stockLevel < 0).reduce((s,i)=>s+Math.abs(i.stockLevel)*(i.costPrice||0),0);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-3">Inventory Health & Shrinkage</h3>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="bg-blue-50 rounded-xl p-3 text-center">
                <div className="text-xl font-black text-blue-700">{inbound.toLocaleString()}</div>
                <div className="text-[10px] text-gray-500">Units Received (Total)</div>
              </div>
              <div className="bg-green-50 rounded-xl p-3 text-center">
                <div className="text-xl font-black text-green-700">{outbound.toLocaleString()}</div>
                <div className="text-[10px] text-gray-500">Units Shipped (Total)</div>
              </div>
              <div className={`rounded-xl p-3 text-center ${negStock > 0 ? 'bg-red-50' : 'bg-gray-50'}`}>
                <div className="text-xl font-black" style={{ color: negStock > 0 ? '#ef4444' : '#10b981' }}>{negStock}</div>
                <div className="text-[10px] text-gray-500">Negative Stock SKUs</div>
              </div>
              <div className="bg-amber-50 rounded-xl p-3 text-center">
                <div className="text-xl font-black text-amber-700">{zeroStock}</div>
                <div className="text-[10px] text-gray-500">Zero Stock SKUs ({totalItems} total)</div>
              </div>
            </div>
            {shrinkageValue > 0 && (
              <div className="bg-red-50 rounded-xl p-3 text-center">
                <div className="text-sm font-bold text-red-700">Estimated Shrinkage Exposure: {fmtAna(shrinkageValue,'full',0)}</div>
                <div className="text-xs text-gray-500 mt-0.5">From items with negative stock levels</div>
              </div>
            )}
            <div className="mt-3 text-xs text-gray-500 text-center">Total inventory at cost: {fmtAna(totalStockValue,'full',0)}</div>
          </div>
        );
      })()}

      {/* ── Phase 294: Sales Cycle Efficiency (lojistik) ── */}
      {reportsTab === 'lojistik' && orders.length >= 5 && (() => {
        const now = new Date();
        const last30Days = orders.filter(o => {
          const d = (o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string);
          return (now.getTime() - d.getTime()) / 86400000 <= 30;
        });
        const statusBreakdown = {
          Pending: last30Days.filter(o=>o.status==='Pending').length,
          Processing: last30Days.filter(o=>o.status==='Processing').length,
          Shipped: last30Days.filter(o=>o.status==='Shipped').length,
          Delivered: last30Days.filter(o=>o.status==='Delivered').length,
          Cancelled: last30Days.filter(o=>o.status==='Cancelled').length,
        };
        const total = last30Days.length;
        if (total === 0) return null;
        const activeRate = ((statusBreakdown.Delivered + statusBreakdown.Shipped) / total * 100);
        const stuckRate = ((statusBreakdown.Pending + statusBreakdown.Processing) / total * 100);
        const steps = [
          { label: 'Pending', count: statusBreakdown.Pending, color: '#94a3b8' },
          { label: 'Processing', count: statusBreakdown.Processing, color: '#f59e0b' },
          { label: 'Shipped', count: statusBreakdown.Shipped, color: '#3b82f6' },
          { label: 'Delivered', count: statusBreakdown.Delivered, color: '#10b981' },
          { label: 'Cancelled', count: statusBreakdown.Cancelled, color: '#ef4444' },
        ];
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Order Pipeline — Last 30 Days</h3>
            <p className="text-xs text-gray-500 mb-4">{total} orders · {activeRate.toFixed(0)}% progressing · {stuckRate.toFixed(0)}% awaiting action</p>
            <div className="flex items-center gap-1 h-10 mb-4 rounded-xl overflow-hidden">
              {steps.map((s,i) => s.count > 0 && (
                <div key={i} title={`${s.label}: ${s.count}`} className="h-full flex items-center justify-center text-white text-[9px] font-bold" style={{ width: `${(s.count/total)*100}%`, background: s.color, minWidth: '4px' }}>
                  {s.count/total > 0.07 ? s.count : ''}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-5 gap-1 text-center">
              {steps.map((s,i) => (
                <div key={i}>
                  <div className="text-xs font-bold" style={{ color: s.color }}>{s.count}</div>
                  <div className="text-[9px] text-gray-400">{s.label}</div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 295: Revenue per Employee by Department (ik) ── */}
      {reportsTab === 'ik' && employees.length >= 2 && orders.length >= 5 && (() => {
        const now = new Date();
        const annualRev = orders.filter(o => {
          const d = (o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string);
          return (now.getTime() - d.getTime()) / 86400000 <= 365;
        }).reduce((s,o)=>s+o.totalPrice,0);
        const deptData: Record<string, {count: number; payroll: number}> = {};
        employees.filter(e=>e.status==='Aktif').forEach(e => {
          const dept = e.department || 'Other';
          if (!deptData[dept]) deptData[dept] = { count: 0, payroll: 0 };
          deptData[dept].count++;
          deptData[dept].payroll += e.salary || 0;
        });
        const totalEmps = Object.values(deptData).reduce((s,d)=>s+d.count,0);
        const depts = Object.entries(deptData).map(([dept, d]) => ({
          dept,
          count: d.count,
          payroll: d.payroll * 12,
          revShare: totalEmps > 0 ? annualRev * (d.count/totalEmps) : 0,
          revPerHead: totalEmps > 0 ? annualRev * (d.count/totalEmps) / d.count : 0,
        })).sort((a,b)=>b.revPerHead-a.revPerHead);
        if (depts.length === 0) return null;
        const maxRevPerHead = Math.max(...depts.map(d=>d.revPerHead), 1);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Revenue per Employee by Department</h3>
            <p className="text-xs text-gray-500 mb-4">Annual revenue allocated proportionally by headcount</p>
            <div className="space-y-2">
              {depts.map((d,i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs text-gray-700 w-28 truncate font-medium">{d.dept}</span>
                  <div className="flex-1 h-5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full bg-teal-500" style={{ width: `${maxRevPerHead>0?(d.revPerHead/maxRevPerHead*100):0}%` }} />
                  </div>
                  <span className="text-xs font-bold text-teal-700 w-20 text-right">{fmtAna(d.revPerHead,'K',0)}/emp</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 296: Abandoned Quote Revenue Opportunity (crm) ── */}
      {reportsTab === 'crm' && quotations.length >= 3 && (() => {
        const now = new Date();
        const staleQuotes = quotations.filter(q => {
          if (q.status === 'Converted to Order' || q.status === 'approved') return false;
          const d = (q.createdAt as {toDate?:()=>Date}).toDate?.() ?? (q.createdAt ? new Date(q.createdAt as string) : null);
          if (!d) return false;
          const age = (now.getTime() - d.getTime()) / 86400000;
          return age >= 7;
        }).map(q => {
          const d = (q.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(q.createdAt as string);
          const age = Math.floor((now.getTime() - d.getTime()) / 86400000);
          const value = q.totalAmount || (q.items||q.lineItems||[]).reduce((s, i) => s + i.price * i.quantity, 0);
          return { customer: q.customerName, age, value, status: q.status };
        }).sort((a,b)=>b.value-a.value).slice(0,8);
        if (staleQuotes.length === 0) return null;
        const totalOpportunity = staleQuotes.reduce((s,q)=>s+q.value,0);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Stale Quote Recovery Opportunities</h3>
            <p className="text-xs text-gray-500 mb-3">Unconverted quotes (7+ days old) — {fmtAna(totalOpportunity,'full',0)} total opportunity</p>
            <div className="space-y-2">
              {staleQuotes.map((q,i) => (
                <div key={i} className="flex items-center justify-between text-xs p-2 rounded-lg" style={{ background: q.age >= 30 ? '#fef2f2' : q.age >= 14 ? '#fffbeb' : '#f8fafc' }}>
                  <span className="font-medium text-gray-800 truncate w-32">{q.customer}</span>
                  <span className="text-gray-400 capitalize">{q.status}</span>
                  <span style={{ color: q.age >= 30 ? '#ef4444' : q.age >= 14 ? '#f59e0b' : '#6b7280' }} className="font-bold">{q.age}d old</span>
                  <span className="font-bold text-gray-800">{fmtAna(q.value,'full',0)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 297: Product Bundle Affinity Analysis (envanter) ── */}
      {reportsTab === 'envanter' && orders.length >= 10 && (() => {
        const pairCounts: Record<string, number> = {};
        orders.forEach(o => {
          const items = (o.lineItems||[]).map(li=>li.name||li.sku).filter(Boolean);
          for (let a = 0; a < items.length; a++) {
            for (let b = a+1; b < items.length; b++) {
              const key = [items[a], items[b]].sort().join(' + ');
              pairCounts[key] = (pairCounts[key]||0)+1;
            }
          }
        });
        const topPairs = Object.entries(pairCounts)
          .filter(([,count])=>count>=2)
          .sort((a,b)=>b[1]-a[1]).slice(0,6);
        if (topPairs.length === 0) return null;
        const maxCount = topPairs[0][1];
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Product Bundle Affinity</h3>
            <p className="text-xs text-gray-500 mb-4">Products frequently ordered together — top co-purchase pairs</p>
            <div className="space-y-3">
              {topPairs.map(([pair, count],i) => {
                const [prod1, prod2] = pair.split(' + ');
                return (
                  <div key={i} className="flex items-center gap-3">
                    <div className="flex-1">
                      <div className="text-xs font-medium text-gray-800">{prod1}</div>
                      <div className="text-[10px] text-gray-400">+ {prod2}</div>
                    </div>
                    <div className="w-24 h-3 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full rounded-full bg-orange-400" style={{ width: `${maxCount>0?(count/maxCount*100):0}%` }} />
                    </div>
                    <span className="text-xs font-bold text-orange-600 w-12 text-right">{count}x</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 298: Net Promoter Score Proxy (crm) ── */}
      {reportsTab === 'crm' && orders.length >= 10 && (() => {
        const custOrders: Record<string, {count: number; recent: boolean}> = {};
        const now = new Date();
        orders.forEach(o => {
          const d = (o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string);
          const isRecent = (now.getTime() - d.getTime()) / 86400000 <= 90;
          if (!custOrders[o.customerName]) custOrders[o.customerName] = { count: 0, recent: false };
          custOrders[o.customerName].count++;
          if (isRecent) custOrders[o.customerName].recent = true;
        });
        const total = Object.keys(custOrders).length;
        if (total < 5) return null;
        const promoters = Object.values(custOrders).filter(c => c.count >= 3 && c.recent).length;
        const detractors = Object.values(custOrders).filter(c => c.count === 1 && !c.recent).length;
        const passives = total - promoters - detractors;
        const npsProxy = Math.round(((promoters - detractors) / total) * 100);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">NPS Proxy Score</h3>
            <p className="text-xs text-gray-500 mb-4">Based on repeat purchase behaviour — not survey data</p>
            <div className="flex items-center justify-center mb-4">
              <div className="text-5xl font-black" style={{ color: npsProxy >= 50 ? '#10b981' : npsProxy >= 0 ? '#f59e0b' : '#ef4444' }}>{npsProxy >= 0 ? '+' : ''}{npsProxy}</div>
            </div>
            <div className="grid grid-cols-3 gap-3 text-center text-xs">
              <div className="bg-green-50 rounded-xl p-3">
                <div className="text-lg font-black text-green-700">{promoters}</div>
                <div className="text-gray-500">Promoters</div>
                <div className="text-[10px] text-gray-400">3+ orders, active</div>
              </div>
              <div className="bg-gray-50 rounded-xl p-3">
                <div className="text-lg font-black text-gray-600">{passives}</div>
                <div className="text-gray-500">Passives</div>
                <div className="text-[10px] text-gray-400">occasional buyers</div>
              </div>
              <div className="bg-red-50 rounded-xl p-3">
                <div className="text-lg font-black text-red-600">{detractors}</div>
                <div className="text-gray-500">Detractors</div>
                <div className="text-[10px] text-gray-400">1 order, gone quiet</div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Phase 299: Working Capital Cycle (genel) ── */}
      {reportsTab === 'genel' && orders.length >= 10 && inventory.length >= 3 && (() => {
        const totalRevenue = orders.reduce((s,o)=>s+o.totalPrice,0);
        const totalCOGS = orders.reduce((s,o)=>s+(o.lineItems||[]).reduce((sc,li)=>{
          const inv = inventory.find(it=>it.id===li.inventoryId||it.sku===li.sku);
          return sc+(inv?itemCostTRY(inv,exchangeRates):(li.costPrice||0))*li.quantity;
        },0),0);
        const inventoryValue = inventory.reduce((s,i)=>s+Math.max(0,i.stockLevel)*itemCostTRY(i,exchangeRates),0);
        const avgMonthlyRevenue = totalRevenue / Math.max(1, (() => {
          const now = new Date();
          const dates = orders.map(o => (o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string));
          if (dates.length === 0) return 1;
          const oldest = new Date(Math.min(...dates.map(d=>d.getTime())));
          return Math.max(1, (now.getTime() - oldest.getTime()) / (86400000 * 30));
        })());
        const dso = avgMonthlyRevenue > 0 ? 30 : 0; // simplified: assume 30d collection
        const dio = totalCOGS > 0 ? (inventoryValue / (totalCOGS / 365)) : 0;
        const dpo = 30; // assumed supplier terms
        const ccc = dso + dio - dpo;
        const wcMetrics = [
          { label: 'Days Sales Outstanding (DSO)', value: dso.toFixed(0), unit: 'days', good: dso <= 30 },
          { label: 'Days Inventory Outstanding (DIO)', value: dio.toFixed(0), unit: 'days', good: dio <= 45 },
          { label: 'Days Payable Outstanding (DPO)', value: dpo.toFixed(0), unit: 'days', good: true },
          { label: 'Cash Conversion Cycle (CCC)', value: ccc.toFixed(0), unit: 'days', good: ccc <= 45 },
        ];
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Working Capital Cycle</h3>
            <p className="text-xs text-gray-500 mb-4">CCC = DSO + DIO − DPO · Lower is better · target: under 45 days</p>
            <div className="space-y-3">
              {wcMetrics.map((m,i) => (
                <div key={i} className="flex items-center justify-between p-3 rounded-xl" style={{ background: m.good ? '#f0fdf4' : '#fef2f2' }}>
                  <span className="text-xs text-gray-700 font-medium">{m.label}</span>
                  <span className="text-xl font-black" style={{ color: m.good ? '#10b981' : '#ef4444' }}>{m.value}<span className="text-xs font-normal text-gray-400 ml-1">{m.unit}</span></span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 300: 300-Phase Milestone Analytics Summary (genel) ── */}
      {reportsTab === 'genel' && (() => {
        const totalOrders = orders.length;
        const totalRevenue = orders.reduce((s,o)=>s+o.totalPrice,0);
        const totalInventoryItems = inventory.length;
        const totalEmployees = employees.length;
        const totalQuotations = quotations.length;
        const totalMovements = inventoryMovements.length;
        const uniqueCustomers = new Set(orders.map(o=>o.customerName)).size;
        const deliveredOrders = orders.filter(o=>o.status==='Delivered').length;
        const deliveryRate = totalOrders > 0 ? (deliveredOrders/totalOrders*100) : 0;
        return (
          <div className="apple-card p-6 border-2 border-brand">
            <div className="flex items-center gap-3 mb-4">
              <div className="text-3xl">🎯</div>
              <div>
                <h3 className="font-black text-gray-800 text-lg">Phase 300 Milestone Reached!</h3>
                <p className="text-xs text-gray-500">300 analytics phases deployed — your live business intelligence dashboard</p>
              </div>
            </div>
            <div className="grid grid-cols-4 gap-3 mb-4">
              {[
                { label: 'Total Orders', value: totalOrders.toLocaleString(), icon: '📦' },
                { label: 'Total Revenue', value: `₺${(totalRevenue/1000).toFixed(0)}k`, icon: '💰' },
                { label: 'Unique Customers', value: uniqueCustomers.toLocaleString(), icon: '👥' },
                { label: 'Delivery Rate', value: `${deliveryRate.toFixed(0)}%`, icon: '🚚' },
                { label: 'SKUs Tracked', value: totalInventoryItems.toLocaleString(), icon: '📋' },
                { label: 'Active Employees', value: totalEmployees.toLocaleString(), icon: '👤' },
                { label: 'Quotations', value: totalQuotations.toLocaleString(), icon: '📝' },
                { label: 'Stock Movements', value: totalMovements.toLocaleString(), icon: '🔄' },
              ].map((s,i) => (
                <div key={i} className="bg-gray-50 rounded-xl p-3 text-center">
                  <div className="text-lg">{s.icon}</div>
                  <div className="text-base font-black text-gray-800">{s.value}</div>
                  <div className="text-[9px] text-gray-400 mt-0.5">{s.label}</div>
                </div>
              ))}
            </div>
            <div className="bg-gradient-to-r from-red-50 to-orange-50 rounded-xl p-3 text-center">
              <p className="text-xs font-bold text-brand">300 phases · 5 dashboard tabs · Full ERP analytics coverage</p>
              <p className="text-[10px] text-gray-400 mt-1">Revenue · CRM · Inventory · Logistics · HR — all connected</p>
            </div>
          </div>
        );
      })()}

      {/* ── Phase 301: Revenue Seasonality Index (genel) ── */}
      {reportsTab === 'genel' && orders.length >= 12 && (() => {
        const monthRevenue: Record<number, number[]> = {};
        orders.forEach(o => {
          const d = (o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string);
          const m = d.getMonth();
          if (!monthRevenue[m]) monthRevenue[m] = [];
          monthRevenue[m].push(o.totalPrice);
        });
        const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        const monthAvg = Array.from({length:12}, (_,i) => {
          const vals = monthRevenue[i] || [];
          return vals.length > 0 ? vals.reduce((s,v)=>s+v,0)/vals.length : 0;
        });
        const overallAvg = monthAvg.filter(v=>v>0).reduce((s,v)=>s+v,0) / Math.max(1, monthAvg.filter(v=>v>0).length);
        if (overallAvg === 0) return null;
        const seasonality = monthAvg.map(avg => avg > 0 ? avg / overallAvg : null);
        const peakMonth = seasonality.reduce((best, val, i) => val !== null && (best === -1 || (seasonality[best] || 0) < val) ? i : best, -1);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Revenue Seasonality Index</h3>
            <p className="text-xs text-gray-500 mb-4">Monthly avg vs overall avg · peak: <span className="font-bold text-green-600">{monthNames[peakMonth]}</span></p>
            <div className="flex items-end gap-1 h-24">
              {seasonality.map((s, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  {s !== null && <span className="text-[8px] text-gray-500">{s.toFixed(1)}x</span>}
                  <div className="w-full rounded-t" style={{
                    height: s !== null ? `${Math.max(4, Math.min(80, s * 40))}px` : '2px',
                    background: s === null ? '#e5e7eb' : s >= 1.2 ? '#10b981' : s >= 0.8 ? '#3b82f6' : '#f59e0b',
                    minHeight: '2px'
                  }} />
                  <span className="text-[8px] text-gray-400">{monthNames[i].slice(0,1)}</span>
                </div>
              ))}
            </div>
            <div className="flex gap-3 mt-2 text-[10px]">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500 inline-block"></span>Peak (≥1.2x)</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-400 inline-block"></span>Normal</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block"></span>Trough ({'<'}0.8x)</span>
            </div>
          </div>
        );
      })()}

      {/* ── Phase 302: Customer Spend Bucket Segmentation (crm) ── */}
      {reportsTab === 'crm' && orders.length >= 10 && (() => {
        const custTotal: Record<string, number> = {};
        orders.forEach(o => { custTotal[o.customerName] = (custTotal[o.customerName]||0) + o.totalPrice; });
        const buckets = [
          { label: '₺0–10k', min: 0, max: 10000, color: '#94a3b8' },
          { label: '₺10k–50k', min: 10000, max: 50000, color: '#3b82f6' },
          { label: '₺50k–200k', min: 50000, max: 200000, color: '#10b981' },
          { label: '₺200k+', min: 200000, max: Infinity, color: '#f59e0b' },
        ];
        const bucketData = buckets.map(b => {
          const custs = Object.entries(custTotal).filter(([,v]) => v >= b.min && v < b.max);
          return { ...b, count: custs.length, revenue: custs.reduce((s,[,v])=>s+v,0) };
        });
        const totalRev = bucketData.reduce((s,b)=>s+b.revenue,0);
        const totalCusts = bucketData.reduce((s,b)=>s+b.count,0);
        if (totalCusts === 0) return null;
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-3">Customer Spend Bucket Segmentation</h3>
            <div className="space-y-3">
              {bucketData.map((b,i) => (
                <div key={i}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="font-medium text-gray-700">{b.label}</span>
                    <span className="text-gray-500">{b.count} customers · {totalRev>0?((b.revenue/totalRev)*100).toFixed(0):0}% revenue</span>
                  </div>
                  <div className="grid grid-cols-2 gap-1">
                    <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${totalCusts>0?(b.count/totalCusts*100):0}%`, background: b.color }} title="Customer %" />
                    </div>
                    <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full rounded-full opacity-70" style={{ width: `${totalRev>0?(b.revenue/totalRev*100):0}%`, background: b.color }} title="Revenue %" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex gap-4 mt-2 text-[10px] text-gray-400">
              <span>Left bar = customer share</span><span>Right bar = revenue share</span>
            </div>
          </div>
        );
      })()}

      {/* ── Phase 303: Inventory Cost Breakdown by Category (envanter) ── */}
      {reportsTab === 'envanter' && inventory.length >= 5 && (() => {
        const catCost: Record<string, {items: number; value: number; units: number}> = {};
        inventory.forEach(item => {
          const cat = item.category || 'Uncategorized';
          if (!catCost[cat]) catCost[cat] = { items: 0, value: 0, units: 0 };
          catCost[cat].items++;
          catCost[cat].value += item.stockLevel * (item.costPrice||0);
          catCost[cat].units += item.stockLevel;
        });
        const cats = Object.entries(catCost).sort((a,b)=>b[1].value-a[1].value);
        if (cats.length === 0) return null;
        const totalValue = cats.reduce((s,[,d])=>s+d.value,0);
        const colors = ['#3b82f6','#10b981','#f59e0b','#8b5cf6','#ec4899','#06b6d4','#f97316','#84cc16'];
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Inventory Cost by Category</h3>
            <p className="text-xs text-gray-500 mb-3">Total at cost: {fmtAna(totalValue,'full',0)}</p>
            <div className="flex h-4 rounded-full overflow-hidden mb-4 gap-0.5">
              {cats.slice(0,8).map(([,d],i) => (
                <div key={i} style={{ width: `${totalValue>0?(d.value/totalValue*100):0}%`, background: colors[i%colors.length], minWidth: d.value>0?'2px':'0' }} title={`${cats[i][0]}: ₺${d.value.toLocaleString()}`} />
              ))}
            </div>
            <div className="space-y-2">
              {cats.slice(0,6).map(([cat,d],i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: colors[i%colors.length] }} />
                  <span className="text-xs text-gray-700 truncate flex-1">{cat}</span>
                  <span className="text-xs text-gray-400">{d.items} SKUs</span>
                  <span className="text-xs text-gray-400">{d.units} units</span>
                  <span className="text-xs font-bold text-gray-800">{fmtAna(d.value,'full',0)}</span>
                  <span className="text-xs text-gray-400 w-8 text-right">{totalValue>0?((d.value/totalValue)*100).toFixed(0):0}%</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 304: Driver Performance Scorecard (lojistik) ── */}
      {reportsTab === 'lojistik' && orders.length >= 5 && (() => {
        const driverMap: Record<string, {total: number; delivered: number; cancelled: number; revenue: number}> = {};
        orders.filter(o => (o.assignedDriver as string)).forEach(o => {
          const drv = o.assignedDriver as string;
          if (!driverMap[drv]) driverMap[drv] = { total: 0, delivered: 0, cancelled: 0, revenue: 0 };
          driverMap[drv].total++;
          driverMap[drv].revenue += o.totalPrice;
          if (o.status === 'Delivered') driverMap[drv].delivered++;
          if (o.status === 'Cancelled') driverMap[drv].cancelled++;
        });
        const drivers = Object.entries(driverMap)
          .map(([name, d]) => ({ name, ...d, rate: d.total > 0 ? (d.delivered/d.total*100) : 0 }))
          .sort((a,b) => b.rate - a.rate);
        if (drivers.length === 0) return null;
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-3">Driver Performance Scorecard</h3>
            <div className="space-y-2">
              {drivers.map((d,i) => (
                <div key={i} className="flex items-center gap-3 p-2 rounded-lg bg-gray-50">
                  <span className="text-[10px] font-bold text-gray-400 w-4">{i+1}</span>
                  <span className="text-xs font-medium text-gray-800 truncate w-24">{d.name}</span>
                  <div className="flex-1 h-4 bg-gray-200 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${d.rate}%`, background: d.rate >= 80 ? '#10b981' : d.rate >= 60 ? '#f59e0b' : '#ef4444' }} />
                  </div>
                  <span className="text-xs font-bold w-10 text-right" style={{ color: d.rate >= 80 ? '#10b981' : d.rate >= 60 ? '#f59e0b' : '#ef4444' }}>{d.rate.toFixed(0)}%</span>
                  <span className="text-xs text-gray-400 w-12 text-right">{d.total} trips</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 305: Profit & Loss Summary (genel) ── */}
      {reportsTab === 'genel' && orders.length >= 5 && (() => {
        const now = new Date();
        const currMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const mOrders = orders.filter(o => {
          const d = (o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string);
          return d >= currMonth;
        });
        const revenue = mOrders.reduce((s,o)=>s+o.totalPrice,0);
        const cogs = mOrders.reduce((s,o)=>s+(o.lineItems||[]).reduce((sc,li)=>{
          const inv = inventory.find(it=>it.id===li.inventoryId||it.sku===li.sku);
          return sc+(inv?itemCostTRY(inv,exchangeRates):(li.costPrice||0))*li.quantity;
        },0),0);
        const grossProfit = revenue - cogs;
        const payroll = employees.filter(e=>e.status==='Aktif').reduce((s,e)=>s+(e.salary||0),0);
        const operatingExpenses = payroll;
        const ebitda = grossProfit - operatingExpenses;
        const pnlItems = [
          { label: 'Revenue', value: revenue, type: 'revenue' },
          { label: 'Cost of Goods Sold', value: -cogs, type: 'expense' },
          { label: 'Gross Profit', value: grossProfit, type: 'subtotal' },
          { label: 'Payroll & Benefits', value: -operatingExpenses, type: 'expense' },
          { label: 'EBITDA', value: ebitda, type: 'total' },
        ];
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">P&L Summary — Current Month</h3>
            <p className="text-xs text-gray-500 mb-4">Month-to-date · {mOrders.length} orders processed</p>
            <div className="space-y-2">
              {pnlItems.map((item,i) => (
                <div key={i} className={`flex justify-between items-center px-3 py-2 rounded-lg ${item.type==='subtotal'?'bg-blue-50':item.type==='total'?'bg-gray-100 font-black':'bg-gray-50'}`}>
                  <span className={`text-xs ${item.type==='total'?'font-black text-gray-800':'font-medium text-gray-700'}`}>{item.label}</span>
                  <span className={`text-sm font-bold ${item.value>=0?'text-green-600':'text-red-500'}`}>
                    {item.value>=0?'+':''}{fmtAna(Math.abs(item.value),'full',0)}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-3 text-center">
              <span className="text-xs text-gray-400">Gross margin: {revenue>0?((grossProfit/revenue)*100).toFixed(1):0}% · EBITDA margin: {revenue>0?((ebitda/revenue)*100).toFixed(1):0}%</span>
            </div>
          </div>
        );
      })()}

      {/* ── Phase 306: Lead Response Time Analysis (crm) ── */}
      {reportsTab === 'crm' && orders.length >= 5 && quotations.length >= 3 && (() => {
        const now = new Date();
        const responseGroups = [
          { label: 'Same day', days: 0, count: 0, color: '#10b981' },
          { label: '1-3 days', days: 3, count: 0, color: '#3b82f6' },
          { label: '4-7 days', days: 7, count: 0, color: '#f59e0b' },
          { label: '8-14 days', days: 14, count: 0, color: '#f97316' },
          { label: '15+ days', days: 999, count: 0, color: '#ef4444' },
        ];
        quotations.forEach(q => {
          const d = (q.createdAt as {toDate?:()=>Date}).toDate?.() ?? (q.createdAt ? new Date(q.createdAt as string) : null);
          if (!d) return;
          const age = (now.getTime() - d.getTime()) / 86400000;
          if (age <= 1) responseGroups[0].count++;
          else if (age <= 3) responseGroups[1].count++;
          else if (age <= 7) responseGroups[2].count++;
          else if (age <= 14) responseGroups[3].count++;
          else responseGroups[4].count++;
        });
        const total = quotations.length;
        if (total === 0) return null;
        const maxCount = Math.max(...responseGroups.map(g=>g.count));
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Quotation Age Distribution</h3>
            <p className="text-xs text-gray-500 mb-4">{total} quotations — age from creation date</p>
            <div className="space-y-2">
              {responseGroups.map((g,i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs text-gray-600 w-20">{g.label}</span>
                  <div className="flex-1 h-5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${maxCount>0?(g.count/maxCount*100):0}%`, background: g.color }} />
                  </div>
                  <span className="text-xs font-bold w-6 text-right" style={{ color: g.color }}>{g.count}</span>
                  <span className="text-xs text-gray-400 w-10 text-right">{total>0?((g.count/total)*100).toFixed(0):0}%</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 307: Stock-to-Sales Ratio by Category (envanter) ── */}
      {reportsTab === 'envanter' && inventory.length >= 5 && orders.length >= 5 && (() => {
        const catSales: Record<string, number> = {};
        const catStock: Record<string, number> = {};
        orders.forEach(o => (o.lineItems||[]).forEach(li => {
          const inv = inventory.find(it=>it.id===li.inventoryId||it.sku===li.sku);
          const cat = inv?.category || 'Uncategorized';
          catSales[cat] = (catSales[cat]||0) + li.quantity;
        }));
        inventory.forEach(item => {
          const cat = item.category || 'Uncategorized';
          catStock[cat] = (catStock[cat]||0) + item.stockLevel;
        });
        const cats = Object.keys({...catSales, ...catStock});
        const data = cats.map(cat => ({
          cat,
          stock: catStock[cat]||0,
          sales: catSales[cat]||0,
          ratio: catSales[cat]>0 ? (catStock[cat]||0)/catSales[cat] : null,
        })).filter(d=>d.stock>0||d.sales>0).sort((a,b)=>(b.sales)-(a.sales)).slice(0,7);
        if (data.length === 0) return null;
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Stock-to-Sales Ratio by Category</h3>
            <p className="text-xs text-gray-500 mb-3">Ratio = current stock ÷ total units sold · lower = faster moving</p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-400 border-b border-gray-100">
                    <th className="text-left pb-2">Category</th>
                    <th className="text-right pb-2">Stock</th>
                    <th className="text-right pb-2">Sold</th>
                    <th className="text-right pb-2">S:S Ratio</th>
                    <th className="text-right pb-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((d,i) => (
                    <tr key={i} className="border-b border-gray-50">
                      <td className="py-1.5 font-medium text-gray-800">{d.cat}</td>
                      <td className="py-1.5 text-right text-gray-600">{d.stock}</td>
                      <td className="py-1.5 text-right text-gray-600">{d.sales}</td>
                      <td className="py-1.5 text-right font-bold" style={{ color: d.ratio===null?'#94a3b8':d.ratio<=1?'#10b981':d.ratio<=3?'#f59e0b':'#ef4444' }}>
                        {d.ratio===null ? 'N/A' : d.ratio.toFixed(1)+'x'}
                      </td>
                      <td className="py-1.5 text-right text-[10px]" style={{ color: d.ratio===null?'#94a3b8':d.ratio<=1?'#10b981':d.ratio<=3?'#f59e0b':'#ef4444' }}>
                        {d.ratio===null?'No sales':d.ratio<=1?'Fast':d.ratio<=3?'Normal':'Slow'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}

      {/* ── Phase 308: Monthly Cancellation Value Recovery (lojistik) ── */}
      {reportsTab === 'lojistik' && orders.length >= 5 && (() => {
        const now = new Date();
        const months = Array.from({length:6}, (_,i) => {
          const d = new Date(now.getFullYear(), now.getMonth() - (5-i), 1);
          return { key: `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`, label: `${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getFullYear()).slice(2)}`, year: d.getFullYear(), month: d.getMonth() };
        });
        const data = months.map(m => {
          const mOrders = orders.filter(o => {
            const d = (o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string);
            return d.getFullYear() === m.year && d.getMonth() === m.month;
          });
          const total = mOrders.reduce((s,o)=>s+o.totalPrice,0);
          const cancelled = mOrders.filter(o=>o.status==='Cancelled');
          const cancelledRev = cancelled.reduce((s,o)=>s+o.totalPrice,0);
          return { label: m.label, total, cancelledRev, cancelledCount: cancelled.length, rate: total>0?(cancelledRev/total*100):0 };
        });
        const hasData = data.some(d=>d.total>0);
        if (!hasData) return null;
        const maxTotal = Math.max(...data.map(d=>d.total),1);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Cancellation Revenue Loss — 6 Months</h3>
            <p className="text-xs text-gray-500 mb-4">Red = cancelled revenue · blue = fulfilled revenue</p>
            <div className="flex items-end gap-2 h-28">
              {data.map((d,i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <div className="w-full flex flex-col justify-end" style={{ height: '88px' }}>
                    <div className="w-full rounded-t-sm bg-red-400" style={{ height: `${maxTotal>0?(d.cancelledRev/maxTotal*80):0}px`, minHeight: d.cancelledRev>0?'2px':'0' }} />
                    <div className="w-full bg-blue-400" style={{ height: `${maxTotal>0?((d.total-d.cancelledRev)/maxTotal*80):0}px`, minHeight: d.total-d.cancelledRev>0?'2px':'0' }} />
                  </div>
                  <span className="text-[9px] text-gray-400">{d.label}</span>
                  {d.rate > 0 && <span className="text-[8px] text-red-500 font-bold">{d.rate.toFixed(0)}%</span>}
                </div>
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-2">Total lost revenue (6mo): {fmtAna(data.reduce((s,d)=>s+d.cancelledRev,0),'full',0)}</p>
          </div>
        );
      })()}

      {/* ── Phase 309: Employee Tenure Distribution (ik) ── */}
      {reportsTab === 'ik' && employees.length >= 3 && (() => {
        const now = new Date();
        const tenureData = employees.filter(e=>e.status==='Aktif' && e.startDate).map(e => {
          const start = new Date(e.startDate);
          const months = Math.floor((now.getTime()-start.getTime())/(86400000*30));
          return { name: e.name, months, years: months/12, dept: e.department };
        });
        if (tenureData.length === 0) return null;
        const buckets = [
          { label: '< 6 months', min: 0, max: 6, color: '#94a3b8' },
          { label: '6–12 months', min: 6, max: 12, color: '#3b82f6' },
          { label: '1–2 years', min: 12, max: 24, color: '#10b981' },
          { label: '2–5 years', min: 24, max: 60, color: '#f59e0b' },
          { label: '5+ years', min: 60, max: Infinity, color: '#8b5cf6' },
        ];
        const bucketData = buckets.map(b => ({
          ...b,
          count: tenureData.filter(e=>e.months>=b.min && e.months<b.max).length,
        }));
        const avgTenure = tenureData.reduce((s,e)=>s+e.years,0)/tenureData.length;
        const maxCount = Math.max(...bucketData.map(b=>b.count),1);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Employee Tenure Distribution</h3>
            <p className="text-xs text-gray-500 mb-4">Active employees · avg tenure: {avgTenure.toFixed(1)} years</p>
            <div className="space-y-2">
              {bucketData.map((b,i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs text-gray-600 w-24">{b.label}</span>
                  <div className="flex-1 h-5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${maxCount>0?(b.count/maxCount*100):0}%`, background: b.color }} />
                  </div>
                  <span className="text-xs font-bold w-6 text-right" style={{ color: b.color }}>{b.count}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 310: Top 10 Revenue Days All-Time (genel) ── */}
      {reportsTab === 'genel' && orders.length >= 10 && (() => {
        const dayRevenue: Record<string, number> = {};
        orders.forEach(o => {
          const d = (o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string);
          const key = d.toISOString().slice(0,10);
          dayRevenue[key] = (dayRevenue[key]||0) + o.totalPrice;
        });
        const topDays = Object.entries(dayRevenue)
          .sort((a,b)=>b[1]-a[1]).slice(0,10);
        if (topDays.length === 0) return null;
        const maxRev = topDays[0][1];
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-3">Top 10 Revenue Days — All Time</h3>
            <div className="space-y-2">
              {topDays.map(([day, rev], i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-[10px] font-black text-gray-400 w-4">#{i+1}</span>
                  <span className="text-xs text-gray-600 w-20">{day}</span>
                  <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${maxRev>0?(rev/maxRev*100):0}%`, background: i===0?'#f59e0b':i<3?'#10b981':'#3b82f6' }} />
                  </div>
                  <span className="text-xs font-bold text-gray-800 w-24 text-right">{fmtAna(rev,'full',0)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 311: Rolling 7-Day Revenue Trend (genel) ── */}
      {reportsTab === 'genel' && orders.length >= 7 && (() => {
        const now = new Date();
        const days = Array.from({length: 28}, (_, i) => {
          const d = new Date(now);
          d.setDate(d.getDate() - (27 - i));
          return d.toISOString().slice(0, 10);
        });
        const dayRev: Record<string, number> = {};
        orders.forEach(o => {
          const d = (o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string);
          const key = d.toISOString().slice(0, 10);
          dayRev[key] = (dayRev[key] || 0) + o.totalPrice;
        });
        const rolling7: number[] = [];
        for (let i = 6; i < days.length; i++) {
          const sum = days.slice(i - 6, i + 1).reduce((s, d) => s + (dayRev[d] || 0), 0);
          rolling7.push(sum / 7);
        }
        const hasData = rolling7.some(v => v > 0);
        if (!hasData) return null;
        const maxVal = Math.max(...rolling7, 1);
        const trend = rolling7.length >= 2 ? rolling7[rolling7.length - 1] - rolling7[0] : 0;
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Rolling 7-Day Avg Revenue — Last 28 Days</h3>
            <p className="text-xs text-gray-500 mb-4">
              Trend: <span className={trend >= 0 ? 'text-green-600 font-bold' : 'text-red-500 font-bold'}>{trend >= 0 ? '↑' : '↓'} {fmtAna(Math.abs(trend),'full',0)}/day avg</span>
            </p>
            <div className="flex items-end gap-0.5 h-20">
              {rolling7.map((v, i) => (
                <div key={i} className="flex-1 rounded-t transition-all" style={{
                  height: `${maxVal > 0 ? Math.max(2, v / maxVal * 72) : 2}px`,
                  background: i === rolling7.length - 1 ? '#f97316' : '#6366f1',
                  opacity: 0.6 + i / rolling7.length * 0.4
                }} title={`₺${v.toLocaleString('tr-TR', {maximumFractionDigits: 0})}`} />
              ))}
            </div>
            <div className="flex justify-between text-[9px] text-gray-400 mt-1">
              <span>28d ago</span><span>Today</span>
            </div>
          </div>
        );
      })()}

      {/* ── Phase 312: Inventory Reorder Alert Dashboard (envanter) ── */}
      {reportsTab === 'envanter' && inventory.length >= 3 && (() => {
        const critical = inventory.filter(i => i.stockLevel === 0);
        const low = inventory.filter(i => i.stockLevel > 0 && i.stockLevel <= i.lowStockThreshold);
        const healthy = inventory.filter(i => i.stockLevel > i.lowStockThreshold);
        const totalValue = inventory.reduce((s, i) => s + i.stockLevel * (i.costPrice || 0), 0);
        const criticalValue = critical.reduce((s, i) => s + i.lowStockThreshold * (i.costPrice || 0), 0);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-4">Inventory Reorder Alert Dashboard</h3>
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="bg-red-50 rounded-xl p-3 text-center">
                <div className="text-2xl font-black text-red-600">{critical.length}</div>
                <div className="text-[10px] text-gray-500">Out of Stock</div>
                <div className="text-[9px] text-red-400 mt-0.5">{fmtAna(criticalValue,'full',0)} to restock</div>
              </div>
              <div className="bg-amber-50 rounded-xl p-3 text-center">
                <div className="text-2xl font-black text-amber-600">{low.length}</div>
                <div className="text-[10px] text-gray-500">Low Stock</div>
                <div className="text-[9px] text-amber-400 mt-0.5">at or below threshold</div>
              </div>
              <div className="bg-green-50 rounded-xl p-3 text-center">
                <div className="text-2xl font-black text-green-600">{healthy.length}</div>
                <div className="text-[10px] text-gray-500">Healthy Stock</div>
                <div className="text-[9px] text-green-400 mt-0.5">above threshold</div>
              </div>
            </div>
            {critical.slice(0, 4).length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-bold text-red-600 mb-1">🔴 Immediate Reorder Required</p>
                {critical.slice(0, 4).map((item, i) => (
                  <div key={i} className="flex justify-between text-xs p-1.5 bg-red-50 rounded-lg">
                    <span className="text-gray-800 font-medium truncate w-44">{item.name}</span>
                    <span className="text-gray-400">{item.sku}</span>
                    <span className="text-red-600 font-bold">0 in stock</span>
                  </div>
                ))}
              </div>
            )}
            <p className="text-xs text-gray-400 mt-3 text-center">Total inventory value: {fmtAna(totalValue,'full',0)}</p>
          </div>
        );
      })()}

      {/* ── Phase 313: Sales Rep Activity Heatmap (crm) ── */}
      {reportsTab === 'crm' && orders.length >= 10 && (() => {
        const repMonthly: Record<string, Record<string, number>> = {};
        const now = new Date();
        const months = Array.from({length: 6}, (_, i) => {
          const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
          return {key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getFullYear()).slice(2)}`, year: d.getFullYear(), month: d.getMonth()};
        });
        orders.forEach(o => {
          const rep = (o.assignedTo as string) || 'Unassigned';
          const d = (o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string);
          const mkey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
          if (!repMonthly[rep]) repMonthly[rep] = {};
          repMonthly[rep][mkey] = (repMonthly[rep][mkey] || 0) + o.totalPrice;
        });
        const reps = Object.entries(repMonthly)
          .map(([rep, mdata]) => ({rep, total: Object.values(mdata).reduce((s, v) => s + v, 0), months: mdata}))
          .sort((a, b) => b.total - a.total).slice(0, 5);
        if (reps.length === 0) return null;
        const allVals = reps.flatMap(r => months.map(m => r.months[m.key] || 0));
        const maxVal = Math.max(...allVals, 1);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-3">Sales Rep Activity Heatmap — 6 Months</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-400">
                    <th className="text-left pb-2 w-24">Rep</th>
                    {months.map(m => <th key={m.key} className="text-center pb-2 w-10">{m.label}</th>)}
                    <th className="text-right pb-2">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {reps.map((r, i) => (
                    <tr key={i}>
                      <td className="py-1 text-gray-700 font-medium truncate max-w-[6rem]">{r.rep}</td>
                      {months.map(m => {
                        const v = r.months[m.key] || 0;
                        const intensity = maxVal > 0 ? v / maxVal : 0;
                        return (
                          <td key={m.key} className="py-1 px-0.5">
                            <div className="rounded h-6 flex items-center justify-center text-[8px] font-bold" style={{
                              background: v === 0 ? '#f3f4f6' : `rgba(99,102,241,${0.15 + intensity * 0.85})`,
                              color: intensity > 0.5 ? 'white' : '#4b5563'
                            }} title={`₺${v.toLocaleString('tr-TR', {maximumFractionDigits: 0})}`}>
                              {v > 0 ? `${(v / 1000).toFixed(0)}k` : '-'}
                            </div>
                          </td>
                        );
                      })}
                      <td className="py-1 text-right font-bold text-gray-800">{fmtAna(r.total,'K',0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}

      {/* ── Phase 314: Average Transaction Value by Day Part (genel) ── */}
      {reportsTab === 'genel' && orders.length >= 10 && (() => {
        const parts = [
          {label: 'Morning', subLabel: '6–12', hours: [6,7,8,9,10,11], color: '#f59e0b'},
          {label: 'Afternoon', subLabel: '12–17', hours: [12,13,14,15,16], color: '#3b82f6'},
          {label: 'Evening', subLabel: '17–22', hours: [17,18,19,20,21], color: '#8b5cf6'},
          {label: 'Night', subLabel: '22–6', hours: [22,23,0,1,2,3,4,5], color: '#94a3b8'},
        ];
        const partData = parts.map(p => {
          const partOrders = orders.filter(o => {
            const d = (o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string);
            return p.hours.includes(d.getHours());
          });
          return {
            ...p,
            count: partOrders.length,
            revenue: partOrders.reduce((s, o) => s + o.totalPrice, 0),
            aov: partOrders.length > 0 ? partOrders.reduce((s, o) => s + o.totalPrice, 0) / partOrders.length : 0,
          };
        });
        const hasData = partData.some(p => p.count > 0);
        if (!hasData) return null;
        const maxAov = Math.max(...partData.map(p => p.aov), 1);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-3">AOV by Time of Day</h3>
            <div className="grid grid-cols-2 gap-3">
              {partData.map((p, i) => (
                <div key={i} className="rounded-xl p-4" style={{background: `${p.color}15`}}>
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <div className="text-xs font-bold text-gray-700">{p.label}</div>
                      <div className="text-[10px] text-gray-400">{p.subLabel}h</div>
                    </div>
                    <span className="text-[10px] text-gray-400">{p.count} orders</span>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden mb-2">
                    <div className="h-full rounded-full" style={{width: `${maxAov > 0 ? p.aov / maxAov * 100 : 0}%`, background: p.color}} />
                  </div>
                  <div className="text-base font-black" style={{color: p.color}}>
                    {fmtAna(p.aov,'full',0)}
                  </div>
                  <div className="text-[9px] text-gray-400">avg order value</div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 315: Invoice Payment Status Tracker (genel) ── */}
      {reportsTab === 'genel' && orders.length >= 5 && (() => {
        const invoiced = orders.filter(o => o.hasInvoice || o.faturali);
        if (invoiced.length === 0) return null;
        const paid = invoiced.filter(o => o.paid || (o as unknown as Record<string,unknown>).paidAt);
        const unpaid = invoiced.filter(o => !o.paid && !(o as unknown as Record<string,unknown>).paidAt);
        const paidRev = paid.reduce((s, o) => s + o.totalPrice, 0);
        const unpaidRev = unpaid.reduce((s, o) => s + o.totalPrice, 0);
        const now = new Date();
        const overdue = unpaid.filter(o => {
          const d = (o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string);
          return (now.getTime() - d.getTime()) / 86400000 > 30;
        });
        const overdueRev = overdue.reduce((s, o) => s + o.totalPrice, 0);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-4">Invoice Payment Status</h3>
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="bg-green-50 rounded-xl p-3 text-center">
                <div className="text-xl font-black text-green-600">{paid.length}</div>
                <div className="text-[10px] text-gray-500">Paid</div>
                <div className="text-[9px] text-green-500">{fmtAna(paidRev,'K',0)}</div>
              </div>
              <div className="bg-amber-50 rounded-xl p-3 text-center">
                <div className="text-xl font-black text-amber-600">{unpaid.length}</div>
                <div className="text-[10px] text-gray-500">Awaiting</div>
                <div className="text-[9px] text-amber-500">{fmtAna(unpaidRev,'K',0)}</div>
              </div>
              <div className="bg-red-50 rounded-xl p-3 text-center">
                <div className="text-xl font-black text-red-600">{overdue.length}</div>
                <div className="text-[10px] text-gray-500">Overdue 30d+</div>
                <div className="text-[9px] text-red-500">{fmtAna(overdueRev,'K',0)}</div>
              </div>
            </div>
            <div className="h-3 bg-gray-100 rounded-full overflow-hidden flex gap-0.5">
              {paidRev > 0 && <div className="h-full bg-green-400 rounded-l-full" style={{width: `${(paidRev / (paidRev + unpaidRev)) * 100}%`}} />}
              {overdueRev > 0 && <div className="h-full bg-red-400" style={{width: `${(overdueRev / (paidRev + unpaidRev)) * 100}%`}} />}
              {(unpaidRev - overdueRev) > 0 && <div className="h-full bg-amber-300 rounded-r-full" style={{width: `${((unpaidRev - overdueRev) / (paidRev + unpaidRev)) * 100}%`}} />}
            </div>
            <div className="flex gap-3 mt-2 text-[10px] text-gray-400">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-400 inline-block" />Paid</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400 inline-block" />Overdue</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-300 inline-block" />Awaiting</span>
            </div>
          </div>
        );
      })()}

      {/* ── Phase 316: Product Margin Ranking (envanter) ── */}
      {reportsTab === 'envanter' && inventory.length >= 5 && orders.length >= 5 && (() => {
        const productRev: Record<string, {revenue: number; cost: number; qty: number}> = {};
        orders.forEach(o => (o.lineItems || []).forEach(li => {
          const inv = inventory.find(it => it.id === li.inventoryId || it.sku === li.sku);
          const cost = inv ? itemCostTRY(inv, exchangeRates) : (li.costPrice || 0);
          const key = li.name || li.sku;
          if (!productRev[key]) productRev[key] = {revenue: 0, cost: 0, qty: 0};
          productRev[key].revenue += li.price * li.quantity;
          productRev[key].cost += cost * li.quantity;
          productRev[key].qty += li.quantity;
        }));
        const ranked = Object.entries(productRev)
          .map(([name, d]) => ({name, ...d, margin: d.revenue - d.cost, marginPct: d.revenue > 0 ? ((d.revenue - d.cost) / d.revenue * 100) : 0}))
          .filter(p => p.revenue > 0)
          .sort((a, b) => b.marginPct - a.marginPct)
          .slice(0, 8);
        if (ranked.length === 0) return null;
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-3">Product Margin Ranking (Top 8 by %)</h3>
            <div className="space-y-2">
              {ranked.map((p, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-[10px] font-bold text-gray-400 w-4">#{i + 1}</span>
                  <span className="text-xs text-gray-700 truncate w-32 font-medium">{p.name}</span>
                  <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{
                      width: `${Math.max(2, p.marginPct)}%`,
                      background: p.marginPct >= 40 ? '#10b981' : p.marginPct >= 20 ? '#3b82f6' : p.marginPct >= 0 ? '#f59e0b' : '#ef4444'
                    }} />
                  </div>
                  <span className="text-xs font-bold w-10 text-right" style={{color: p.marginPct >= 40 ? '#10b981' : p.marginPct >= 20 ? '#3b82f6' : '#f59e0b'}}>{p.marginPct.toFixed(0)}%</span>
                  <span className="text-xs text-gray-400 w-16 text-right">{fmtAna(p.margin,'full',0)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 317: On-Hold Order Value (lojistik) ── */}
      {reportsTab === 'lojistik' && orders.length >= 5 && (() => {
        const now = new Date();
        const pending = orders.filter(o => o.status === 'Pending' || o.status === 'Processing');
        if (pending.length === 0) return null;
        const totalHeld = pending.reduce((s, o) => s + o.totalPrice, 0);
        const byStatus = {
          Pending: pending.filter(o => o.status === 'Pending'),
          Processing: pending.filter(o => o.status === 'Processing'),
        };
        const oldest = pending.reduce((oldest, o) => {
          const d = (o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string);
          return d < oldest ? d : oldest;
        }, now);
        const oldestDays = Math.floor((now.getTime() - oldest.getTime()) / 86400000);
        const aging = [
          {label: '0-1 days', orders: pending.filter(o => { const d = (o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string); return (now.getTime()-d.getTime())/86400000 <= 1; })},
          {label: '2-3 days', orders: pending.filter(o => { const d = (o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string); const age=(now.getTime()-d.getTime())/86400000; return age>1&&age<=3; })},
          {label: '4-7 days', orders: pending.filter(o => { const d = (o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string); const age=(now.getTime()-d.getTime())/86400000; return age>3&&age<=7; })},
          {label: '7+ days', orders: pending.filter(o => { const d = (o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string); return (now.getTime()-d.getTime())/86400000>7; })},
        ];
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">On-Hold Order Value</h3>
            <p className="text-xs text-gray-500 mb-4">{pending.length} orders holding {fmtAna(totalHeld,'full',0)} · oldest: {oldestDays}d</p>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="bg-amber-50 rounded-xl p-3 text-center">
                <div className="text-xl font-black text-amber-600">{byStatus.Pending.length}</div>
                <div className="text-[10px] text-gray-500">Pending</div>
                <div className="text-[9px] text-amber-400">{fmtAna(byStatus.Pending.reduce((s,o)=>s+o.totalPrice,0),'full',0)}</div>
              </div>
              <div className="bg-blue-50 rounded-xl p-3 text-center">
                <div className="text-xl font-black text-blue-600">{byStatus.Processing.length}</div>
                <div className="text-[10px] text-gray-500">Processing</div>
                <div className="text-[9px] text-blue-400">{fmtAna(byStatus.Processing.reduce((s,o)=>s+o.totalPrice,0),'full',0)}</div>
              </div>
            </div>
            <div className="space-y-1">
              {aging.map((a, i) => (
                <div key={i} className="flex justify-between text-xs p-2 rounded-lg" style={{background: i >= 2 ? '#fef2f2' : '#f8fafc'}}>
                  <span className="text-gray-600 font-medium">{a.label}</span>
                  <span className="font-bold" style={{color: i >= 2 ? '#ef4444' : '#6b7280'}}>{a.orders.length} orders · {fmtAna(a.orders.reduce((s,o)=>s+o.totalPrice,0),'full',0)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 318: Salary Band Distribution (ik) ── */}
      {reportsTab === 'ik' && employees.length >= 3 && (() => {
        const active = employees.filter(e => e.status === 'Aktif' && e.salary > 0);
        if (active.length === 0) return null;
        const salaries = active.map(e => e.salary).sort((a, b) => a - b);
        const min = salaries[0];
        const max = salaries[salaries.length - 1];
        const avg = salaries.reduce((s, v) => s + v, 0) / salaries.length;
        const median = salaries[Math.floor(salaries.length / 2)];
        const range = max - min || 1;
        const bucketSize = range / 5;
        const buckets = Array.from({length: 5}, (_, i) => {
          const lo = min + i * bucketSize;
          const hi = min + (i + 1) * bucketSize;
          const count = salaries.filter(s => s >= lo && (i === 4 ? s <= hi : s < hi)).length;
          return {label: `₺${(lo / 1000).toFixed(0)}k–${(hi / 1000).toFixed(0)}k`, count};
        });
        const maxCount = Math.max(...buckets.map(b => b.count), 1);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Salary Band Distribution</h3>
            <p className="text-xs text-gray-500 mb-4">Active employees · avg: {fmtAna(avg,'full',0)} · median: {fmtAna(median,'full',0)}</p>
            <div className="flex items-end gap-2 h-20 mb-3">
              {buckets.map((b, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-[9px] text-gray-500">{b.count}</span>
                  <div className="w-full rounded-t bg-violet-500" style={{height: `${maxCount > 0 ? Math.max(4, b.count / maxCount * 60) : 4}px`}} />
                </div>
              ))}
            </div>
            <div className="grid grid-cols-5 gap-1 text-center">
              {buckets.map((b, i) => (
                <div key={i} className="text-[8px] text-gray-400">{b.label}</div>
              ))}
            </div>
            <div className="flex gap-4 mt-3 text-xs text-gray-500">
              <span>Min: {fmtAna(min,'full',0)}</span>
              <span>Max: {fmtAna(max,'full',0)}</span>
            </div>
          </div>
        );
      })()}

      {/* ── Phase 319: Customer Order Gap Analysis (crm) ── */}
      {reportsTab === 'crm' && orders.length >= 10 && (() => {
        const custDates: Record<string, Date[]> = {};
        orders.forEach(o => {
          const d = (o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string);
          if (!custDates[o.customerName]) custDates[o.customerName] = [];
          custDates[o.customerName].push(d);
        });
        const gaps: number[] = [];
        Object.values(custDates).forEach(dates => {
          const sorted = dates.sort((a, b) => a.getTime() - b.getTime());
          for (let i = 1; i < sorted.length; i++) {
            const gap = Math.floor((sorted[i].getTime() - sorted[i - 1].getTime()) / 86400000);
            if (gap > 0 && gap <= 365) gaps.push(gap);
          }
        });
        if (gaps.length < 3) return null;
        const avg = gaps.reduce((s, g) => s + g, 0) / gaps.length;
        const buckets = [
          {label: '≤7d', max: 7, color: '#10b981'},
          {label: '8–14d', max: 14, color: '#3b82f6'},
          {label: '15–30d', max: 30, color: '#f59e0b'},
          {label: '31–90d', max: 90, color: '#f97316'},
          {label: '91d+', max: 999, color: '#ef4444'},
        ];
        const bucketCounts = buckets.map((b, i) => ({
          ...b,
          count: gaps.filter(g => g <= b.max && (i === 0 || g > buckets[i - 1].max)).length,
        }));
        const maxCount = Math.max(...bucketCounts.map(b => b.count), 1);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Customer Re-Order Gap Distribution</h3>
            <p className="text-xs text-gray-500 mb-4">Days between consecutive orders per customer · avg: {avg.toFixed(0)} days</p>
            <div className="flex items-end gap-3 h-20">
              {bucketCounts.map((b, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-[9px] text-gray-600 font-bold">{b.count}</span>
                  <div className="w-full rounded-t" style={{height: `${maxCount > 0 ? Math.max(4, b.count / maxCount * 60) : 4}px`, background: b.color}} />
                  <span className="text-[9px] text-gray-400">{b.label}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 321: Revenue per Employee (ik) ── */}
      {reportsTab === 'ik' && employees.length >= 2 && orders.length >= 5 && (() => {
        const totalRevenue321 = orders.reduce((s, o) => s + (o.totalPrice || 0), 0);
        const revPerEmp = employees.length > 0 ? totalRevenue321 / employees.length : 0;
        const depts321 = [...new Set(employees.map(e => e.department).filter(Boolean))];
        const deptRevPerEmp = depts321.map(dept => {
          const cnt = employees.filter(e => e.department === dept).length;
          const estRev = cnt > 0 ? (totalRevenue321 / employees.length) * cnt : 0;
          return { dept, cnt, estRev, perHead: cnt > 0 ? estRev / cnt : 0 };
        }).sort((a, b) => b.perHead - a.perHead);
        const maxPH = Math.max(...deptRevPerEmp.map(d => d.perHead), 1);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Revenue per Employee</h3>
            <p className="text-xs text-gray-500 mb-4">Estimated revenue contribution per headcount by department · Overall: {fmtAna(revPerEmp,'full',0)}/emp</p>
            <div className="space-y-2">
              {deptRevPerEmp.map((d, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs text-gray-600 w-28 truncate">{d.dept}</span>
                  <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full bg-indigo-400 transition-all" style={{width: `${(d.perHead / maxPH) * 100}%`}} />
                  </div>
                  <span className="text-[10px] text-gray-400 w-10 text-right">{d.cnt} emp</span>
                  <span className="text-xs font-bold text-indigo-600 w-24 text-right">{fmtAna(d.perHead,'full',0)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 322: Quotation Conversion Funnel (crm) ── */}
      {reportsTab === 'crm' && quotations.length >= 3 && (() => {
        const total322 = quotations.length;
        const sent322 = quotations.filter(q => ['sent','accepted','rejected','converted'].includes((q.status||'').toLowerCase())).length;
        const accepted322 = quotations.filter(q => ['accepted','converted'].includes((q.status||'').toLowerCase())).length;
        const converted322 = quotations.filter(q => (q.status||'').toLowerCase() === 'converted').length;
        const stages = [
          { label: 'Created', count: total322, color: '#6366f1' },
          { label: 'Sent',    count: sent322,  color: '#3b82f6' },
          { label: 'Accepted',count: accepted322, color: '#10b981' },
          { label: 'Converted',count: converted322, color: '#f59e0b' },
        ];
        const convRate = total322 > 0 ? ((converted322 / total322) * 100).toFixed(1) : '0';
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Quotation Conversion Funnel</h3>
            <p className="text-xs text-gray-500 mb-4">End-to-end pipeline from quote creation to order · Overall conversion: {convRate}%</p>
            <div className="flex items-end gap-2 h-28">
              {stages.map((s, i) => {
                const h = total322 > 0 ? Math.max((s.count / total322) * 100, 4) : 4;
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1">
                    <span className="text-xs font-bold" style={{color: s.color}}>{s.count}</span>
                    <div className="w-full rounded-t-lg transition-all" style={{height: `${h}%`, background: s.color}} />
                    <span className="text-[10px] text-gray-500 text-center">{s.label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 323: Stock Turnover Rate (envanter) ── */}
      {reportsTab === 'envanter' && inventory.length >= 5 && inventoryMovements.length >= 5 && (() => {
        const outMoves = inventoryMovements.filter(m => m.type === 'out');
        const soldByProduct: Record<string, number> = {};
        outMoves.forEach(m => { soldByProduct[m.productName || 'Unknown'] = (soldByProduct[m.productName || 'Unknown'] || 0) + (m.quantity || 0); });
        const turnoverData = inventory
          .filter(item => item.stockLevel > 0 || soldByProduct[item.name])
          .map(item => {
            const sold = soldByProduct[item.name] || 0;
            const avgStock = (item.stockLevel + (item.stockLevel + sold)) / 2;
            const turnover = avgStock > 0 ? sold / avgStock : 0;
            return { name: item.name, turnover, sold, stock: item.stockLevel };
          })
          .filter(d => d.turnover > 0)
          .sort((a, b) => b.turnover - a.turnover)
          .slice(0, 8);
        if (turnoverData.length < 2) return null;
        const maxT = Math.max(...turnoverData.map(d => d.turnover), 1);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Stock Turnover Rate</h3>
            <p className="text-xs text-gray-500 mb-4">Units sold ÷ average stock level · higher = faster-moving inventory</p>
            <div className="space-y-2">
              {turnoverData.map((d, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs text-gray-600 w-32 truncate">{d.name}</span>
                  <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{width: `${(d.turnover / maxT) * 100}%`, background: d.turnover >= 2 ? '#10b981' : d.turnover >= 1 ? '#f59e0b' : '#ef4444'}} />
                  </div>
                  <span className="text-xs font-bold w-12 text-right" style={{color: d.turnover >= 2 ? '#10b981' : d.turnover >= 1 ? '#f59e0b' : '#ef4444'}}>{d.turnover.toFixed(2)}×</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 324: Late Delivery Rate (lojistik) ── */}
      {reportsTab === 'lojistik' && orders.length >= 5 && (() => {
        const delivered324 = orders.filter(o => o.status === 'Delivered');
        if (delivered324.length < 3) return null;
        const toTs324 = (v: unknown): number => {
          if (!v) return 0;
          if (typeof (v as {toDate?:()=>Date}).toDate === 'function') return (v as {toDate:()=>Date}).toDate().getTime();
          return new Date(v as string|number).getTime();
        };
        const lateOrders = delivered324.filter(o => {
          const created = toTs324(o.createdAt);
          const updated = toTs324((o as unknown as Record<string,unknown>).updatedAt);
          return updated > 0 && created > 0 && (updated - created) > 3 * 86400000;
        });
        const onTime = delivered324.length - lateOrders.length;
        const lateRate = (lateOrders.length / delivered324.length * 100).toFixed(1);
        const months324: Record<string, {late: number; total: number}> = {};
        delivered324.forEach(o => {
          const d = new Date(toTs324(o.createdAt));
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          if (!months324[key]) months324[key] = {late: 0, total: 0};
          months324[key].total++;
          const created = toTs324(o.createdAt);
          const updated = toTs324((o as unknown as Record<string,unknown>).updatedAt);
          if (updated > 0 && created > 0 && (updated - created) > 3 * 86400000) months324[key].late++;
        });
        const monthKeys = Object.keys(months324).sort().slice(-6);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Late Delivery Rate</h3>
            <p className="text-xs text-gray-500 mb-4">Orders taking {'>'}3 days to deliver · Overall late rate: <span className="font-bold text-red-500">{lateRate}%</span></p>
            <div className="flex items-center gap-6 mb-4">
              {[{label: 'On-Time', val: onTime, color: '#10b981'}, {label: 'Late (>3d)', val: lateOrders.length, color: '#ef4444'}].map((s, i) => (
                <div key={i} className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full" style={{background: s.color}} />
                  <span className="text-sm font-bold text-gray-700">{s.val}</span>
                  <span className="text-xs text-gray-400">{s.label}</span>
                </div>
              ))}
            </div>
            {monthKeys.length >= 2 && (
              <div className="flex items-end gap-1 h-20">
                {monthKeys.map(k => {
                  const m = months324[k];
                  const rate = m.total > 0 ? m.late / m.total : 0;
                  return (
                    <div key={k} className="flex-1 flex flex-col items-center gap-0.5">
                      <div className="w-full rounded-t" style={{height: `${Math.max(rate * 80, 2)}px`, background: rate > 0.3 ? '#ef4444' : rate > 0.15 ? '#f59e0b' : '#10b981'}} />
                      <span className="text-[9px] text-gray-400">{k.slice(5)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })()}

      {/* ── Phase 325: Top Cities by Order Volume (genel) ── */}
      {reportsTab === 'genel' && orders.length >= 5 && (() => {
        const cityMap: Record<string, {count: number; revenue: number}> = {};
        orders.forEach(o => {
          const city = (o as unknown as Record<string,unknown>).city as string || (o as unknown as Record<string,unknown>).shippingCity as string || '';
          if (!city) return;
          if (!cityMap[city]) cityMap[city] = {count: 0, revenue: 0};
          cityMap[city].count++;
          cityMap[city].revenue += o.totalPrice || 0;
        });
        const cities325 = Object.entries(cityMap).map(([city, d]) => ({city, ...d})).sort((a, b) => b.revenue - a.revenue).slice(0, 8);
        if (cities325.length < 2) return null;
        const maxRev = Math.max(...cities325.map(c => c.revenue), 1);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Top Cities by Order Volume</h3>
            <p className="text-xs text-gray-500 mb-4">Revenue and order count by shipping destination</p>
            <div className="space-y-2">
              {cities325.map((c, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs font-semibold text-gray-700 w-24 truncate">{c.city}</span>
                  <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full bg-blue-400 transition-all" style={{width: `${(c.revenue / maxRev) * 100}%`}} />
                  </div>
                  <span className="text-[10px] text-gray-400 w-10 text-right">{c.count} ord</span>
                  <span className="text-xs font-bold text-blue-600 w-24 text-right">{fmtAna(c.revenue,'full',0)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 326: Customer Lifetime Value Distribution (crm) ── */}
      {reportsTab === 'crm' && orders.length >= 5 && (() => {
        const ltvMap: Record<string, number> = {};
        orders.forEach(o => {
          const cust = o.customerName || 'Unknown';
          ltvMap[cust] = (ltvMap[cust] || 0) + (o.totalPrice || 0);
        });
        const ltvValues = Object.values(ltvMap);
        if (ltvValues.length < 3) return null;
        const buckets = [
          {label: '< ₺10K',   min: 0,      max: 10000,   color: '#94a3b8', count: 0, total: 0},
          {label: '₺10–50K',  min: 10000,  max: 50000,   color: '#6366f1', count: 0, total: 0},
          {label: '₺50–200K', min: 50000,  max: 200000,  color: '#3b82f6', count: 0, total: 0},
          {label: '₺200K+',   min: 200000, max: Infinity, color: '#10b981', count: 0, total: 0},
        ];
        ltvValues.forEach(v => {
          const b = buckets.find(b => v >= b.min && v < b.max);
          if (b) { b.count++; b.total += v; }
        });
        const maxCount = Math.max(...buckets.map(b => b.count), 1);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Customer LTV Distribution</h3>
            <p className="text-xs text-gray-500 mb-4">Lifetime value buckets across {ltvValues.length} customers</p>
            <div className="flex items-end gap-3 h-24">
              {buckets.map((b, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-xs font-bold" style={{color: b.color}}>{b.count}</span>
                  <div className="w-full rounded-t-lg" style={{height: `${Math.max((b.count / maxCount) * 72, 4)}px`, background: b.color}} />
                  <span className="text-[9px] text-gray-500 text-center">{b.label}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 327: Inventory Stockout Risk (envanter) ── */}
      {reportsTab === 'envanter' && inventory.length >= 3 && (() => {
        const atRisk = inventory
          .filter(item => { const rp = (item.reorderPoint as number | undefined) ?? item.lowStockThreshold ?? 5; return item.stockLevel > 0 && item.stockLevel <= rp; })
          .sort((a, b) => a.stockLevel - b.stockLevel)
          .slice(0, 8);
        if (atRisk.length < 2) return null;
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Stockout Risk Alert</h3>
            <p className="text-xs text-gray-500 mb-4">{atRisk.length} SKU{atRisk.length !== 1 ? 's' : ''} at or below reorder point — action needed</p>
            <div className="space-y-2">
              {atRisk.map((item, i) => {
                const reorder: number = (item.reorderPoint as number | undefined) ?? item.lowStockThreshold ?? 5;
                const riskPct = reorder > 0 ? Math.min((item.stockLevel / reorder) * 100, 100) : 100;
                const color = riskPct <= 30 ? '#ef4444' : riskPct <= 60 ? '#f59e0b' : '#10b981';
                return (
                  <div key={i} className="flex items-center gap-3">
                    <span className="text-xs text-gray-600 w-32 truncate">{item.name}</span>
                    <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{width: `${riskPct}%`, background: color}} />
                    </div>
                    <span className="text-xs font-bold w-20 text-right" style={{color}}>{item.stockLevel} / {reorder} units</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 328: Payment Method Mix (genel) ── */}
      {reportsTab === 'genel' && orders.length >= 5 && (() => {
        const pmMap: Record<string, {count: number; revenue: number}> = {};
        orders.forEach(o => {
          const pm = (o as unknown as Record<string,unknown>).paymentMethod as string || (o as unknown as Record<string,unknown>).payment_method as string || 'Other';
          if (!pmMap[pm]) pmMap[pm] = {count: 0, revenue: 0};
          pmMap[pm].count++;
          pmMap[pm].revenue += o.totalPrice || 0;
        });
        const methods = Object.entries(pmMap).map(([method, d]) => ({method, ...d})).sort((a, b) => b.revenue - a.revenue);
        if (methods.length < 2) return null;
        const totalRev328 = methods.reduce((s, m) => s + m.revenue, 0);
        const colors328 = ['#6366f1','#3b82f6','#10b981','#f59e0b','#f97316','#ef4444','#8b5cf6'];
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Payment Method Mix</h3>
            <p className="text-xs text-gray-500 mb-4">Revenue share by payment type across {orders.length} orders</p>
            <div className="space-y-2">
              {methods.map((m, i) => {
                const pct = totalRev328 > 0 ? (m.revenue / totalRev328) * 100 : 0;
                return (
                  <div key={i} className="flex items-center gap-3">
                    <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{background: colors328[i % colors328.length]}} />
                    <span className="text-xs text-gray-600 flex-1 truncate">{m.method}</span>
                    <div className="w-32 h-3 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full rounded-full" style={{width: `${pct}%`, background: colors328[i % colors328.length]}} />
                    </div>
                    <span className="text-[10px] text-gray-400 w-8 text-right">{pct.toFixed(0)}%</span>
                    <span className="text-xs font-bold w-24 text-right" style={{color: colors328[i % colors328.length]}}>{fmtAna(m.revenue,'full',0)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 329: Employee Department Cost (ik) ── */}
      {reportsTab === 'ik' && employees.length >= 2 && (() => {
        const deptCost: Record<string, {headcount: number; cost: number}> = {};
        employees.forEach(e => {
          const dept = e.department || 'Unknown';
          if (!deptCost[dept]) deptCost[dept] = {headcount: 0, cost: 0};
          deptCost[dept].headcount++;
          deptCost[dept].cost += (e.salary || 0);
        });
        const deptRows = Object.entries(deptCost).map(([dept, d]) => ({dept, ...d, avgCost: d.headcount > 0 ? d.cost / d.headcount : 0})).sort((a, b) => b.cost - a.cost);
        if (deptRows.length < 2) return null;
        const totalCost329 = deptRows.reduce((s, d) => s + d.cost, 0);
        const maxCost329 = Math.max(...deptRows.map(d => d.cost), 1);
        const colors329 = ['#6366f1','#3b82f6','#10b981','#f59e0b','#f97316','#8b5cf6'];
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Department Salary Cost</h3>
            <p className="text-xs text-gray-500 mb-4">Monthly payroll by department · Total: {fmtAna(totalCost329,'full',0)}</p>
            <div className="space-y-2">
              {deptRows.map((d, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs text-gray-600 w-28 truncate">{d.dept}</span>
                  <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{width: `${(d.cost / maxCost329) * 100}%`, background: colors329[i % colors329.length]}} />
                  </div>
                  <span className="text-[10px] text-gray-400 w-10 text-right">{d.headcount} emp</span>
                  <span className="text-xs font-bold w-24 text-right" style={{color: colors329[i % colors329.length]}}>{fmtAna(d.cost,'full',0)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 330: Order Cancellation Analysis (lojistik) ── */}
      {reportsTab === 'lojistik' && orders.filter(o => o.status === 'Cancelled').length >= 2 && (() => {
        const cancelled330 = orders.filter(o => o.status === 'Cancelled');
        const cancelRate = orders.length > 0 ? (cancelled330.length / orders.length * 100).toFixed(1) : '0';
        const reasonMap: Record<string, number> = {};
        cancelled330.forEach(o => {
          const reason = (o as unknown as Record<string,unknown>).cancellationReason as string || (o as unknown as Record<string,unknown>).cancelReason as string || 'Not specified';
          reasonMap[reason] = (reasonMap[reason] || 0) + 1;
        });
        const reasons = Object.entries(reasonMap).map(([reason, count]) => ({reason, count})).sort((a, b) => b.count - a.count);
        const maxCount330 = Math.max(...reasons.map(r => r.count), 1);
        const cancelRevLost = cancelled330.reduce((s, o) => s + (o.totalPrice || 0), 0);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Order Cancellation Analysis</h3>
            <p className="text-xs text-gray-500 mb-4">{cancelled330.length} cancelled orders · {cancelRate}% rate · {fmtAna(cancelRevLost,'full',0)} revenue lost</p>
            <div className="space-y-2">
              {reasons.map((r, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs text-gray-600 flex-1 truncate">{r.reason}</span>
                  <div className="w-32 h-4 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full bg-red-400 transition-all" style={{width: `${(r.count / maxCount330) * 100}%`}} />
                  </div>
                  <span className="text-xs font-bold text-red-500 w-8 text-right">{r.count}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 331: Monthly New vs Returning Customers (crm) ── */}
      {reportsTab === 'crm' && orders.length >= 8 && (() => {
        const toTs331 = (v: unknown): number => {
          if (!v) return 0;
          if (typeof (v as {toDate?:()=>Date}).toDate === 'function') return (v as {toDate:()=>Date}).toDate().getTime();
          return new Date(v as string|number).getTime();
        };
        const seenBefore: Record<string, string> = {};
        const monthData: Record<string, {newC: number; ret: number}> = {};
        [...orders].sort((a, b) => toTs331(a.createdAt) - toTs331(b.createdAt)).forEach(o => {
          const d = new Date(toTs331(o.createdAt));
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          if (!monthData[key]) monthData[key] = {newC: 0, ret: 0};
          const cust = o.customerName || 'Unknown';
          if (seenBefore[cust]) monthData[key].ret++;
          else { monthData[key].newC++; seenBefore[cust] = key; }
        });
        const keys331 = Object.keys(monthData).sort().slice(-6);
        if (keys331.length < 2) return null;
        const maxVal = Math.max(...keys331.map(k => monthData[k].newC + monthData[k].ret), 1);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">New vs Returning Customers</h3>
            <p className="text-xs text-gray-500 mb-4">Monthly breakdown — stacked bars by customer type</p>
            <div className="flex items-end gap-2 h-28 mb-2">
              {keys331.map(k => {
                const {newC, ret} = monthData[k];
                const total = newC + ret;
                const newH = maxVal > 0 ? (newC / maxVal) * 96 : 0;
                const retH = maxVal > 0 ? (ret / maxVal) * 96 : 0;
                return (
                  <div key={k} className="flex-1 flex flex-col items-center gap-0">
                    <span className="text-[9px] text-gray-500 mb-0.5">{total}</span>
                    <div className="w-full flex flex-col justify-end rounded-t overflow-hidden" style={{height: '80px'}}>
                      <div style={{height: `${retH}px`, background: '#6366f1'}} />
                      <div style={{height: `${newH}px`, background: '#10b981'}} />
                    </div>
                    <span className="text-[9px] text-gray-400 mt-0.5">{k.slice(5)}</span>
                  </div>
                );
              })}
            </div>
            <div className="flex gap-4">
              {[{color:'#10b981', label:'New'},{color:'#6366f1', label:'Returning'}].map((s,i)=>(
                <div key={i} className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-sm" style={{background:s.color}}/><span className="text-[10px] text-gray-500">{s.label}</span></div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 332: Shipment Volume by Day of Week (lojistik) ── */}
      {reportsTab === 'lojistik' && orders.length >= 7 && (() => {
        const toTs332 = (v: unknown): number => {
          if (!v) return 0;
          if (typeof (v as {toDate?:()=>Date}).toDate === 'function') return (v as {toDate:()=>Date}).toDate().getTime();
          return new Date(v as string|number).getTime();
        };
        const days332 = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
        const dayData = days332.map(d => ({day: d, count: 0, revenue: 0}));
        orders.forEach(o => {
          const ts = toTs332(o.createdAt);
          if (!ts) return;
          const dow = new Date(ts).getDay();
          dayData[dow].count++;
          dayData[dow].revenue += o.totalPrice || 0;
        });
        const maxCount332 = Math.max(...dayData.map(d => d.count), 1);
        const busiest = dayData.reduce((a, b) => b.count > a.count ? b : a);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Orders by Day of Week</h3>
            <p className="text-xs text-gray-500 mb-4">Busiest day: <span className="font-bold text-[#ff4000]">{busiest.day}</span> · {busiest.count} orders</p>
            <div className="flex items-end gap-2 h-20">
              {dayData.map((d, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                  <span className="text-[9px] text-gray-500">{d.count}</span>
                  <div className="w-full rounded-t-lg transition-all" style={{height: `${Math.max((d.count / maxCount332) * 60, 4)}px`, background: d.day === busiest.day ? '#ff4000' : '#6366f1'}} />
                  <span className="text-[9px] text-gray-400">{d.day}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 333: Top Performing Sales Reps (crm) ── */}
      {reportsTab === 'crm' && orders.length >= 5 && (() => {
        const repMap: Record<string, {orders: number; revenue: number}> = {};
        orders.forEach(o => {
          const rep = (o as unknown as Record<string,unknown>).salesRep as string || (o as unknown as Record<string,unknown>).assignedTo as string || '';
          if (!rep) return;
          if (!repMap[rep]) repMap[rep] = {orders: 0, revenue: 0};
          repMap[rep].orders++;
          repMap[rep].revenue += o.totalPrice || 0;
        });
        const reps333 = Object.entries(repMap).map(([rep, d]) => ({rep, ...d})).sort((a, b) => b.revenue - a.revenue).slice(0, 6);
        if (reps333.length < 2) return null;
        const maxRev333 = Math.max(...reps333.map(r => r.revenue), 1);
        const colors333 = ['#f59e0b','#6366f1','#3b82f6','#10b981','#f97316','#8b5cf6'];
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Top Sales Representatives</h3>
            <p className="text-xs text-gray-500 mb-4">Revenue and order count by assigned sales rep</p>
            <div className="space-y-2">
              {reps333.map((r, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs text-gray-600 w-28 truncate">{r.rep}</span>
                  <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{width: `${(r.revenue / maxRev333) * 100}%`, background: colors333[i % colors333.length]}} />
                  </div>
                  <span className="text-[10px] text-gray-400 w-10 text-right">{r.orders} ord</span>
                  <span className="text-xs font-bold w-24 text-right" style={{color: colors333[i % colors333.length]}}>{fmtAna(r.revenue,'full',0)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 334: Inventory Value by Category (envanter) ── */}
      {reportsTab === 'envanter' && inventory.length >= 5 && (() => {
        const catVal: Record<string, {count: number; value: number; stock: number}> = {};
        inventory.forEach(item => {
          const cat = item.category || 'Uncategorised';
          if (!catVal[cat]) catVal[cat] = {count: 0, value: 0, stock: 0};
          catVal[cat].count++;
          catVal[cat].stock += item.stockLevel;
          catVal[cat].value += item.stockLevel * (item.costPrice || 0);
        });
        const cats334 = Object.entries(catVal).map(([cat, d]) => ({cat, ...d})).sort((a, b) => b.value - a.value).slice(0, 8);
        if (cats334.length < 2) return null;
        const totalVal334 = cats334.reduce((s, c) => s + c.value, 0);
        const maxVal334 = Math.max(...cats334.map(c => c.value), 1);
        const colors334 = ['#6366f1','#3b82f6','#10b981','#f59e0b','#f97316','#ef4444','#8b5cf6','#06b6d4'];
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Inventory Value by Category</h3>
            <p className="text-xs text-gray-500 mb-4">Total stock value · {fmtAna(totalVal334,'full',0)}</p>
            <div className="space-y-2">
              {cats334.map((c, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs text-gray-600 w-28 truncate">{c.cat}</span>
                  <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{width: `${(c.value / maxVal334) * 100}%`, background: colors334[i % colors334.length]}} />
                  </div>
                  <span className="text-[10px] text-gray-400 w-12 text-right">{c.count} SKU</span>
                  <span className="text-xs font-bold w-24 text-right" style={{color: colors334[i % colors334.length]}}>{fmtAna(c.value,'full',0)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 335: Recurring Order Health (lojistik) ── */}
      {reportsTab === 'lojistik' && recurringOrders.length >= 2 && (() => {
        const active335 = recurringOrders.filter(r => r.active);
        const inactive335 = recurringOrders.filter(r => !r.active);
        const totalARR = active335.reduce((s, r) => {
          const mult = r.frequency === 'weekly' ? 52 : r.frequency === 'monthly' ? 12 : 4;
          return s + r.totalPrice * mult;
        }, 0);
        const freqBreak = ['weekly','monthly','quarterly'].map(f => ({
          freq: f,
          count: active335.filter(r => r.frequency === f).length,
          arr: active335.filter(r => r.frequency === f).reduce((s, r) => {
            const m = f === 'weekly' ? 52 : f === 'monthly' ? 12 : 4;
            return s + r.totalPrice * m;
          }, 0),
        }));
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Recurring Order Health</h3>
            <p className="text-xs text-gray-500 mb-4">{active335.length} active subscriptions · {inactive335.length} paused · ARR: {fmtAna(totalARR,'full',0)}</p>
            <div className="grid grid-cols-3 gap-3">
              {freqBreak.map((f, i) => (
                <div key={i} className="bg-gray-50 rounded-xl p-3 text-center">
                  <p className="text-[10px] text-gray-400 capitalize mb-1">{f.freq}</p>
                  <p className="text-xl font-black text-gray-800">{f.count}</p>
                  <p className="text-[10px] text-gray-500 mt-0.5">{fmtAna(f.arr,'K',0)} ARR</p>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 336: Revenue by Order Size Bucket (crm) ── */}
      {reportsTab === 'crm' && orders.length >= 5 && (() => {
        const buckets336 = [
          {label: 'Micro\n<₺1K',   min: 0,    max: 1000,   color: '#94a3b8'},
          {label: 'Small\n₺1–5K',  min: 1000,  max: 5000,   color: '#6366f1'},
          {label: 'Mid\n₺5–20K',   min: 5000,  max: 20000,  color: '#3b82f6'},
          {label: 'Large\n₺20K+',  min: 20000, max: Infinity, color: '#10b981'},
        ];
        buckets336.forEach(b => { (b as unknown as Record<string,unknown>).count = 0; (b as unknown as Record<string,unknown>).rev = 0; });
        const bData = buckets336.map(b => ({...b, count: 0, rev: 0}));
        orders.forEach(o => {
          const v = o.totalPrice || 0;
          const b = bData.find(b => v >= b.min && v < b.max);
          if (b) { b.count++; b.rev += v; }
        });
        const maxCount336 = Math.max(...bData.map(b => b.count), 1);
        const totalRev336 = bData.reduce((s, b) => s + b.rev, 0);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Order Size Distribution</h3>
            <p className="text-xs text-gray-500 mb-4">Revenue share by order value tier · {orders.length} orders total</p>
            <div className="flex items-end gap-3 h-24 mb-2">
              {bData.map((b, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-xs font-bold" style={{color: b.color}}>{b.count}</span>
                  <div className="w-full rounded-t-lg transition-all" style={{height: `${Math.max((b.count / maxCount336) * 72, 4)}px`, background: b.color}} />
                  <span className="text-[9px] text-gray-500 text-center whitespace-pre-line leading-tight">{b.label}</span>
                </div>
              ))}
            </div>
            <div className="flex gap-2 flex-wrap mt-1">
              {bData.map((b, i) => (
                <span key={i} className="text-[10px] text-gray-400">{b.label.split('\n')[0]}: {totalRev336 > 0 ? ((b.rev / totalRev336) * 100).toFixed(0) : 0}% rev</span>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 337: Top Products by Line-Item Frequency (envanter) ── */}
      {reportsTab === 'envanter' && orders.length >= 5 && (() => {
        const lineFreq: Record<string, {orderCount: number; totalQty: number; revenue: number}> = {};
        orders.forEach(o => {
          (o.lineItems || []).forEach((li: {name?: string; quantity?: number; price?: number; unitPrice?: number}) => {
            const name = li.name || 'Unknown';
            if (!lineFreq[name]) lineFreq[name] = {orderCount: 0, totalQty: 0, revenue: 0};
            lineFreq[name].orderCount++;
            lineFreq[name].totalQty += li.quantity || 1;
            lineFreq[name].revenue += (li.price || li.unitPrice || 0) * (li.quantity || 1);
          });
        });
        const topProducts = Object.entries(lineFreq).map(([name, d]) => ({name, ...d})).filter(d => d.orderCount >= 2).sort((a, b) => b.orderCount - a.orderCount).slice(0, 8);
        if (topProducts.length < 2) return null;
        const maxOC = Math.max(...topProducts.map(p => p.orderCount), 1);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Most-Ordered Products</h3>
            <p className="text-xs text-gray-500 mb-4">Products by number of orders they appear in</p>
            <div className="space-y-2">
              {topProducts.map((p, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs text-gray-600 w-32 truncate">{p.name}</span>
                  <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full bg-teal-400 transition-all" style={{width: `${(p.orderCount / maxOC) * 100}%`}} />
                  </div>
                  <span className="text-[10px] text-gray-400 w-10 text-right">{p.totalQty} qty</span>
                  <span className="text-xs font-bold text-teal-600 w-10 text-right">{p.orderCount}×</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 338: Headcount Change Over Time (ik) ── */}
      {reportsTab === 'ik' && employees.length >= 3 && (() => {
        const toTs338 = (v: unknown): number => {
          if (!v) return 0;
          if (typeof (v as {toDate?:()=>Date}).toDate === 'function') return (v as {toDate:()=>Date}).toDate().getTime();
          return new Date(v as string|number).getTime();
        };
        const monthCount: Record<string, number> = {};
        employees.forEach(e => {
          const ts = toTs338((e as unknown as Record<string,unknown>).startDate || (e as unknown as Record<string,unknown>).createdAt || (e as unknown as Record<string,unknown>).hireDate);
          if (!ts) return;
          const d = new Date(ts);
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          monthCount[key] = (monthCount[key] || 0) + 1;
        });
        const keys338 = Object.keys(monthCount).sort().slice(-8);
        if (keys338.length < 2) return null;
        let cumulative = 0;
        const cumulData = keys338.map(k => { cumulative += monthCount[k]; return {k, added: monthCount[k], total: cumulative}; });
        const maxTotal = Math.max(...cumulData.map(d => d.total), 1);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Headcount Growth</h3>
            <p className="text-xs text-gray-500 mb-4">Cumulative employee count by hire month · Current: {employees.length}</p>
            <div className="flex items-end gap-2 h-24">
              {cumulData.map((d, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                  <span className="text-[9px] text-gray-500">{d.total}</span>
                  <div className="w-full rounded-t-lg bg-violet-400 transition-all" style={{height: `${Math.max((d.total / maxTotal) * 72, 4)}px`}} />
                  <span className="text-[9px] text-gray-400">{d.k.slice(5)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 339: Gross Margin Trend (genel) ── */}
      {reportsTab === 'genel' && orders.length >= 6 && (() => {
        const toTs339 = (v: unknown): number => {
          if (!v) return 0;
          if (typeof (v as {toDate?:()=>Date}).toDate === 'function') return (v as {toDate:()=>Date}).toDate().getTime();
          return new Date(v as string|number).getTime();
        };
        const monthGM: Record<string, {rev: number; cost: number}> = {};
        orders.forEach(o => {
          const d = new Date(toTs339(o.createdAt));
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          if (!monthGM[key]) monthGM[key] = {rev: 0, cost: 0};
          monthGM[key].rev += o.totalPrice || 0;
          const lineCost = (o.lineItems || []).reduce((s: number, li: {costPrice?: number; quantity?: number}) => s + (li.costPrice || 0) * (li.quantity || 1), 0);
          monthGM[key].cost += lineCost || (o.totalPrice || 0) * 0.6;
        });
        const keys339 = Object.keys(monthGM).sort().slice(-8);
        if (keys339.length < 3) return null;
        const gmData = keys339.map(k => ({k, gm: monthGM[k].rev > 0 ? ((monthGM[k].rev - monthGM[k].cost) / monthGM[k].rev) * 100 : 0}));
        const avgGM = gmData.reduce((s, d) => s + d.gm, 0) / gmData.length;
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Gross Margin Trend</h3>
            <p className="text-xs text-gray-500 mb-4">Monthly gross margin % · Avg: {avgGM.toFixed(1)}%</p>
            <div className="flex items-end gap-2 h-24">
              {gmData.map((d, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                  <span className="text-[9px] text-gray-500">{d.gm.toFixed(0)}%</span>
                  <div className="w-full rounded-t-lg transition-all" style={{height: `${Math.max(d.gm / 100 * 72, 4)}px`, background: d.gm >= 40 ? '#10b981' : d.gm >= 25 ? '#f59e0b' : '#ef4444'}} />
                  <span className="text-[9px] text-gray-400">{d.k.slice(5)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 340: Quotation Status Breakdown (crm) ── */}
      {reportsTab === 'crm' && quotations.length >= 3 && (() => {
        const statusCount340: Record<string, {count: number; value: number}> = {};
        quotations.forEach(q => {
          const s = (q.status || 'draft');
          if (!statusCount340[s]) statusCount340[s] = {count: 0, value: 0};
          statusCount340[s].count++;
          statusCount340[s].value += (q as unknown as Record<string,unknown>).totalPrice as number || (q as unknown as Record<string,unknown>).total as number || 0;
        });
        const colors340: Record<string, string> = {draft:'#94a3b8',sent:'#6366f1',accepted:'#10b981',rejected:'#ef4444',converted:'#f59e0b',expired:'#f97316'};
        const stages340 = Object.entries(statusCount340).map(([s, d]) => ({label: s, ...d})).sort((a, b) => b.count - a.count);
        if (stages340.length < 2) return null;
        const maxCount340 = Math.max(...stages340.map(s => s.count), 1);
        const acceptedRev = (statusCount340['accepted']?.value || 0) + (statusCount340['converted']?.value || 0);
        const totalRev340 = Object.values(statusCount340).reduce((s, d) => s + d.value, 0);
        const convPct = totalRev340 > 0 ? ((acceptedRev / totalRev340) * 100).toFixed(1) : '0';
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Quotation Status Breakdown</h3>
            <p className="text-xs text-gray-500 mb-4">{quotations.length} quotes · Accepted/Converted revenue: {convPct}% of pipeline</p>
            <div className="space-y-2">
              {stages340.map((s, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs text-gray-600 w-20 capitalize">{s.label}</span>
                  <div className="flex-1 h-5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{width: `${(s.count / maxCount340) * 100}%`, background: colors340[s.label] || '#94a3b8'}} />
                  </div>
                  <span className="text-xs font-bold w-8 text-right" style={{color: colors340[s.label] || '#94a3b8'}}>{s.count}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 341: Order Value Percentile Bands (genel) ── */}
      {reportsTab === 'genel' && orders.length >= 10 && (() => {
        const vals341 = orders.map(o => o.totalPrice || 0).filter(v => v > 0).sort((a, b) => a - b);
        if (vals341.length < 5) return null;
        const p = (pct: number) => vals341[Math.floor((pct / 100) * (vals341.length - 1))];
        const bands = [
          {label: 'P10', val: p(10), color: '#94a3b8'},
          {label: 'P25', val: p(25), color: '#6366f1'},
          {label: 'P50', val: p(50), color: '#3b82f6'},
          {label: 'P75', val: p(75), color: '#10b981'},
          {label: 'P90', val: p(90), color: '#f59e0b'},
          {label: 'P99', val: p(99), color: '#ef4444'},
        ];
        const maxB341 = bands[bands.length - 1].val || 1;
        const avg341 = vals341.reduce((s, v) => s + v, 0) / vals341.length;
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Order Value Percentile Bands</h3>
            <p className="text-xs text-gray-500 mb-4">{vals341.length} orders · Avg: {fmtAna(avg341,'full',0)}</p>
            <div className="space-y-1.5">
              {bands.map((b, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs font-bold w-8" style={{color: b.color}}>{b.label}</span>
                  <div className="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{width: `${(b.val / maxB341) * 100}%`, background: b.color}} />
                  </div>
                  <span className="text-xs text-gray-600 w-24 text-right">{fmtAna(b.val,'full',0)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 342: Employee Tenure Distribution (ik) ── */}
      {reportsTab === 'ik' && employees.length >= 3 && (() => {
        const toTs342 = (v: unknown): number => {
          if (!v) return 0;
          if (typeof (v as {toDate?:()=>Date}).toDate === 'function') return (v as {toDate:()=>Date}).toDate().getTime();
          return new Date(v as string|number).getTime();
        };
        const now342 = Date.now();
        const tenures = employees.map(e => {
          const start = toTs342((e as unknown as Record<string,unknown>).startDate || (e as unknown as Record<string,unknown>).hireDate || (e as unknown as Record<string,unknown>).createdAt);
          return start > 0 ? Math.floor((now342 - start) / (365.25 * 86400000)) : -1;
        }).filter(t => t >= 0);
        if (tenures.length < 2) return null;
        const buckets342 = [
          {label: '<1yr',  max: 1,   count: 0, color: '#6366f1'},
          {label: '1–2yr', max: 2,   count: 0, color: '#3b82f6'},
          {label: '2–5yr', max: 5,   count: 0, color: '#10b981'},
          {label: '5–10yr',max: 10,  count: 0, color: '#f59e0b'},
          {label: '10yr+', max: 999, count: 0, color: '#f97316'},
        ];
        tenures.forEach(t => {
          const b = buckets342.find(b => t < b.max);
          if (b) b.count++;
        });
        const maxTB = Math.max(...buckets342.map(b => b.count), 1);
        const avgTenure = (tenures.reduce((s, t) => s + t, 0) / tenures.length).toFixed(1);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Employee Tenure Distribution</h3>
            <p className="text-xs text-gray-500 mb-4">Years of service · Avg tenure: {avgTenure} years</p>
            <div className="flex items-end gap-3 h-20">
              {buckets342.map((b, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-xs font-bold" style={{color: b.color}}>{b.count}</span>
                  <div className="w-full rounded-t-lg" style={{height: `${Math.max((b.count / maxTB) * 64, 4)}px`, background: b.color}} />
                  <span className="text-[9px] text-gray-500">{b.label}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 343: Quote Win/Loss by Customer (crm) ── */}
      {reportsTab === 'crm' && quotations.length >= 5 && (() => {
        const custQMap: Record<string, {won: number; lost: number; total: number}> = {};
        quotations.forEach(q => {
          const c = q.customerName || 'Unknown';
          if (!custQMap[c]) custQMap[c] = {won: 0, lost: 0, total: 0};
          custQMap[c].total++;
          if (['accepted','converted'].includes((q.status||'').toLowerCase())) custQMap[c].won++;
          if ((q.status||'').toLowerCase() === 'rejected') custQMap[c].lost++;
        });
        const custQ343 = Object.entries(custQMap).map(([c, d]) => ({customer: c, ...d, winRate: d.total > 0 ? (d.won / d.total) * 100 : 0})).filter(d => d.total >= 2).sort((a, b) => b.total - a.total).slice(0, 6);
        if (custQ343.length < 2) return null;
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Quote Win Rate by Customer</h3>
            <p className="text-xs text-gray-500 mb-4">Accepted ÷ total quotes per customer</p>
            <div className="space-y-2">
              {custQ343.map((c, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs text-gray-600 w-28 truncate">{c.customer}</span>
                  <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden relative">
                    <div className="h-full rounded-full" style={{width: `${c.winRate}%`, background: c.winRate >= 60 ? '#10b981' : c.winRate >= 30 ? '#f59e0b' : '#ef4444'}} />
                  </div>
                  <span className="text-[10px] text-gray-400 w-10 text-right">{c.total} qt</span>
                  <span className="text-xs font-bold w-10 text-right" style={{color: c.winRate >= 60 ? '#10b981' : c.winRate >= 30 ? '#f59e0b' : '#ef4444'}}>{c.winRate.toFixed(0)}%</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 344: Inventory Inflow vs Outflow (envanter) ── */}
      {reportsTab === 'envanter' && inventoryMovements.length >= 5 && (() => {
        const toTs344 = (v: unknown): number => {
          if (!v) return 0;
          if (typeof (v as {toDate?:()=>Date}).toDate === 'function') return (v as {toDate:()=>Date}).toDate().getTime();
          return new Date(v as string|number).getTime();
        };
        const monthIO: Record<string, {in: number; out: number}> = {};
        inventoryMovements.forEach(m => {
          const ts = toTs344(m.timestamp);
          if (!ts) return;
          const d = new Date(ts);
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          if (!monthIO[key]) monthIO[key] = {in: 0, out: 0};
          if (m.type === 'in') monthIO[key].in += m.quantity || 0;
          else monthIO[key].out += m.quantity || 0;
        });
        const keys344 = Object.keys(monthIO).sort().slice(-7);
        if (keys344.length < 2) return null;
        const maxQty = Math.max(...keys344.map(k => Math.max(monthIO[k].in, monthIO[k].out)), 1);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Inventory Inflow vs Outflow</h3>
            <p className="text-xs text-gray-500 mb-4">Monthly stock movement volume · green = in, red = out</p>
            <div className="flex items-end gap-2 h-24 mb-2">
              {keys344.map(k => {
                const {in: inV, out: outV} = monthIO[k];
                return (
                  <div key={k} className="flex-1 flex flex-col items-center gap-0">
                    <div className="w-full flex gap-0.5 items-end" style={{height: '80px'}}>
                      <div className="flex-1 rounded-t-sm bg-emerald-400" style={{height: `${Math.max((inV / maxQty) * 72, 2)}px`}} />
                      <div className="flex-1 rounded-t-sm bg-red-400" style={{height: `${Math.max((outV / maxQty) * 72, 2)}px`}} />
                    </div>
                    <span className="text-[9px] text-gray-400 mt-0.5">{k.slice(5)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 345: Delivery Status Mix (lojistik) ── */}
      {reportsTab === 'lojistik' && orders.length >= 5 && (() => {
        const statusMix: Record<string, number> = {};
        orders.forEach(o => { statusMix[o.status] = (statusMix[o.status] || 0) + 1; });
        const statusColors: Record<string, string> = {Delivered:'#10b981',Processing:'#6366f1',Pending:'#f59e0b',Shipped:'#3b82f6',Cancelled:'#ef4444'};
        const statuses = Object.entries(statusMix).map(([s, c]) => ({status: s, count: c, pct: (c / orders.length) * 100})).sort((a, b) => b.count - a.count);
        const maxS = Math.max(...statuses.map(s => s.count), 1);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Order Status Distribution</h3>
            <p className="text-xs text-gray-500 mb-4">{orders.length} total orders · current pipeline snapshot</p>
            <div className="space-y-2">
              {statuses.map((s, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs text-gray-600 w-24">{s.status}</span>
                  <div className="flex-1 h-5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{width: `${(s.count / maxS) * 100}%`, background: statusColors[s.status] || '#94a3b8'}} />
                  </div>
                  <span className="text-[10px] text-gray-400 w-8 text-right">{s.pct.toFixed(0)}%</span>
                  <span className="text-xs font-bold w-8 text-right" style={{color: statusColors[s.status] || '#94a3b8'}}>{s.count}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 346: Revenue Concentration (Herfindahl) (genel) ── */}
      {reportsTab === 'genel' && orders.length >= 5 && (() => {
        const custRev346: Record<string, number> = {};
        orders.forEach(o => { custRev346[o.customerName || 'Unknown'] = (custRev346[o.customerName || 'Unknown'] || 0) + (o.totalPrice || 0); });
        const totalRev346 = Object.values(custRev346).reduce((s, v) => s + v, 0);
        if (totalRev346 === 0) return null;
        const shares = Object.values(custRev346).map(v => v / totalRev346);
        const hhi = shares.reduce((s, v) => s + v * v, 0);
        const hhiPct = (hhi * 100).toFixed(1);
        const top5Rev = Object.values(custRev346).sort((a, b) => b - a).slice(0, 5).reduce((s, v) => s + v, 0);
        const top5Pct = totalRev346 > 0 ? ((top5Rev / totalRev346) * 100).toFixed(1) : '0';
        const concentration = hhi > 0.25 ? 'High' : hhi > 0.1 ? 'Moderate' : 'Low';
        const concColor = hhi > 0.25 ? '#ef4444' : hhi > 0.1 ? '#f59e0b' : '#10b981';
        const topCustomers = Object.entries(custRev346).map(([c, v]) => ({c, v, pct: (v / totalRev346) * 100})).sort((a, b) => b.v - a.v).slice(0, 5);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Revenue Concentration</h3>
            <div className="flex items-center gap-4 mb-4">
              <div className="text-center">
                <p className="text-2xl font-black" style={{color: concColor}}>{hhiPct}%</p>
                <p className="text-[10px] text-gray-400">HHI Score</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-black text-blue-600">{top5Pct}%</p>
                <p className="text-[10px] text-gray-400">Top 5 share</p>
              </div>
              <div className="ml-auto text-right">
                <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{background: concColor+'22', color: concColor}}>{concentration} concentration</span>
              </div>
            </div>
            <div className="space-y-1.5">
              {topCustomers.map((c, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-[10px] text-gray-500 w-4">{i+1}</span>
                  <span className="text-xs text-gray-700 flex-1 truncate">{c.c}</span>
                  <div className="w-24 h-2.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full bg-blue-400" style={{width: `${c.pct}%`}} />
                  </div>
                  <span className="text-[10px] font-bold text-blue-600 w-10 text-right">{c.pct.toFixed(1)}%</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 347: Avg Salary by Position (ik) ── */}
      {reportsTab === 'ik' && employees.length >= 3 && (() => {
        const posMap: Record<string, {count: number; totalSalary: number}> = {};
        employees.forEach(e => {
          const pos = (e as unknown as Record<string,unknown>).position as string || (e as unknown as Record<string,unknown>).jobTitle as string || e.department || 'Unknown';
          if (!posMap[pos]) posMap[pos] = {count: 0, totalSalary: 0};
          posMap[pos].count++;
          posMap[pos].totalSalary += e.salary || 0;
        });
        const positions = Object.entries(posMap).map(([pos, d]) => ({pos, ...d, avg: d.count > 0 ? d.totalSalary / d.count : 0})).sort((a, b) => b.avg - a.avg);
        if (positions.length < 2) return null;
        const maxAvg = Math.max(...positions.map(p => p.avg), 1);
        const overallAvg = employees.reduce((s, e) => s + (e.salary || 0), 0) / (employees.length || 1);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Avg Salary by Position</h3>
            <p className="text-xs text-gray-500 mb-4">Company average: {fmtAna(overallAvg,'full',0)}/mo</p>
            <div className="space-y-2">
              {positions.map((p, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs text-gray-600 w-28 truncate">{p.pos}</span>
                  <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full bg-violet-400 transition-all" style={{width: `${(p.avg / maxAvg) * 100}%`}} />
                  </div>
                  <span className="text-[10px] text-gray-400 w-8 text-right">{p.count}×</span>
                  <span className="text-xs font-bold text-violet-600 w-24 text-right">{fmtAna(p.avg,'full',0)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 348: Monthly Cost of Goods Sold (envanter) ── */}
      {reportsTab === 'envanter' && orders.length >= 5 && (() => {
        const toTs348 = (v: unknown): number => {
          if (!v) return 0;
          if (typeof (v as {toDate?:()=>Date}).toDate === 'function') return (v as {toDate:()=>Date}).toDate().getTime();
          return new Date(v as string|number).getTime();
        };
        const monthCOGS: Record<string, number> = {};
        orders.forEach(o => {
          const d = new Date(toTs348(o.createdAt));
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          const cogs = (o.lineItems || []).reduce((s: number, li: {costPrice?: number; quantity?: number; sku?: string}) => {
            const item = inventory.find(i => i.sku === li.sku);
            return s + (li.costPrice || (item ? itemCostTRY(item, exchangeRates) : 0)) * (li.quantity || 1);
          }, 0);
          monthCOGS[key] = (monthCOGS[key] || 0) + (cogs || (o.totalPrice || 0) * 0.55);
        });
        const keys348 = Object.keys(monthCOGS).sort().slice(-8);
        if (keys348.length < 3) return null;
        const maxCOGS = Math.max(...keys348.map(k => monthCOGS[k]), 1);
        const totalCOGS = keys348.reduce((s, k) => s + monthCOGS[k], 0);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Monthly COGS Trend</h3>
            <p className="text-xs text-gray-500 mb-4">Cost of Goods Sold · {keys348.length}-month total: {fmtAna(totalCOGS,'full',0)}</p>
            <div className="flex items-end gap-2 h-24">
              {keys348.map(k => (
                <div key={k} className="flex-1 flex flex-col items-center gap-0.5">
                  <div className="w-full rounded-t-lg bg-orange-400 transition-all" style={{height: `${Math.max((monthCOGS[k] / maxCOGS) * 72, 4)}px`}} />
                  <span className="text-[9px] text-gray-400">{k.slice(5)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 349: Order Fulfilment Time Distribution (lojistik) ── */}
      {reportsTab === 'lojistik' && orders.filter(o => o.status === 'Delivered').length >= 3 && (() => {
        const toTs349 = (v: unknown): number => {
          if (!v) return 0;
          if (typeof (v as {toDate?:()=>Date}).toDate === 'function') return (v as {toDate:()=>Date}).toDate().getTime();
          return new Date(v as string|number).getTime();
        };
        const delivTimes = orders
          .filter(o => o.status === 'Delivered')
          .map(o => {
            const created = toTs349(o.createdAt);
            const updated = toTs349((o as unknown as Record<string,unknown>).updatedAt || (o as unknown as Record<string,unknown>).deliveredAt);
            return (created && updated && updated > created) ? Math.floor((updated - created) / 86400000) : -1;
          })
          .filter(d => d >= 0 && d <= 60);
        if (delivTimes.length < 3) return null;
        const avg349 = (delivTimes.reduce((s, d) => s + d, 0) / delivTimes.length).toFixed(1);
        const sorted349 = [...delivTimes].sort((a, b) => a - b);
        const p50 = sorted349[Math.floor(sorted349.length / 2)];
        const p90 = sorted349[Math.floor(sorted349.length * 0.9)];
        const buckets349 = [
          {label:'Same day',max:1,count:0,color:'#10b981'},
          {label:'1–3d',max:3,count:0,color:'#6366f1'},
          {label:'4–7d',max:7,count:0,color:'#f59e0b'},
          {label:'8–14d',max:14,count:0,color:'#f97316'},
          {label:'15d+',max:999,count:0,color:'#ef4444'},
        ];
        delivTimes.forEach(d => { const b = buckets349.find(b => d < b.max); if (b) b.count++; });
        const maxB349 = Math.max(...buckets349.map(b => b.count), 1);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Fulfilment Time Distribution</h3>
            <p className="text-xs text-gray-500 mb-4">Days from order to delivery · Avg: {avg349}d · P50: {p50}d · P90: {p90}d</p>
            <div className="flex items-end gap-3 h-20">
              {buckets349.map((b, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-xs font-bold" style={{color: b.color}}>{b.count}</span>
                  <div className="w-full rounded-t-lg" style={{height: `${Math.max((b.count / maxB349) * 60, 4)}px`, background: b.color}} />
                  <span className="text-[9px] text-gray-500 text-center">{b.label}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 350: Invoice Amount Distribution (genel) ── */}
      {reportsTab === 'genel' && orders.length >= 8 && (() => {
        const vals350 = orders.map(o => o.totalPrice || 0).filter(v => v > 0);
        if (vals350.length < 5) return null;
        const buckets350 = [
          {label:'<₺500',   min:0,     max:500,    count:0, color:'#94a3b8'},
          {label:'₺0.5–2K', min:500,   max:2000,   count:0, color:'#6366f1'},
          {label:'₺2–10K',  min:2000,  max:10000,  count:0, color:'#3b82f6'},
          {label:'₺10–50K', min:10000, max:50000,  count:0, color:'#10b981'},
          {label:'₺50K+',   min:50000, max:Infinity, count:0, color:'#f59e0b'},
        ];
        vals350.forEach(v => { const b = buckets350.find(b => v >= b.min && v < b.max); if (b) b.count++; });
        const maxB350 = Math.max(...buckets350.map(b => b.count), 1);
        const modal = buckets350.reduce((a, b) => b.count > a.count ? b : a);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Invoice Amount Distribution</h3>
            <p className="text-xs text-gray-500 mb-4">Most common range: <span className="font-bold text-[#ff4000]">{modal.label}</span> · {vals350.length} invoices</p>
            <div className="flex items-end gap-3 h-20">
              {buckets350.map((b, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-xs font-bold" style={{color: b.color}}>{b.count}</span>
                  <div className="w-full rounded-t-lg transition-all" style={{height: `${Math.max((b.count / maxB350) * 60, 4)}px`, background: b.color}} />
                  <span className="text-[9px] text-gray-500 text-center">{b.label}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 351: Weekly Revenue Heatmap (genel) ── */}
      {reportsTab === 'genel' && orders.length >= 10 && (() => {
        const toTs351 = (v: unknown): number => {
          if (!v) return 0;
          if (typeof (v as {toDate?:()=>Date}).toDate === 'function') return (v as {toDate:()=>Date}).toDate().getTime();
          return new Date(v as string|number).getTime();
        };
        // Build week × day grid for last 8 weeks
        const now351 = Date.now();
        const grid: Record<string, number> = {};
        orders.forEach(o => {
          const ts = toTs351(o.createdAt);
          if (!ts) return;
          const d = new Date(ts);
          const weekAgo = Math.floor((now351 - ts) / (7 * 86400000));
          if (weekAgo > 7) return;
          const key = `${weekAgo}-${d.getDay()}`;
          grid[key] = (grid[key] || 0) + (o.totalPrice || 0);
        });
        const days351 = ['Su','Mo','Tu','We','Th','Fr','Sa'];
        const weeks351 = [0,1,2,3,4,5,6,7];
        const maxCell = Math.max(...Object.values(grid), 1);
        const totalCells = Object.values(grid).filter(v => v > 0).length;
        if (totalCells < 3) return null;
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Weekly Revenue Heatmap</h3>
            <p className="text-xs text-gray-500 mb-3">Last 8 weeks · darker = more revenue</p>
            <div className="overflow-x-auto">
              <div className="flex gap-1 min-w-[300px]">
                <div className="flex flex-col gap-1 mr-1">
                  {days351.map(d => <span key={d} className="text-[9px] text-gray-400 h-5 flex items-center">{d}</span>)}
                </div>
                {weeks351.map(w => (
                  <div key={w} className="flex flex-col gap-1 flex-1">
                    {days351.map((_, di) => {
                      const val = grid[`${w}-${di}`] || 0;
                      const intensity = maxCell > 0 ? val / maxCell : 0;
                      const bg = intensity === 0 ? '#f3f4f6'
                        : intensity < 0.25 ? '#bbf7d0'
                        : intensity < 0.5  ? '#4ade80'
                        : intensity < 0.75 ? '#16a34a'
                        : '#166534';
                      return <div key={di} className="h-5 rounded-sm" style={{background: bg}} title={val > 0 ? `₺${val.toLocaleString('tr-TR', {maximumFractionDigits:0})}` : ''} />;
                    })}
                  </div>
                ))}
              </div>
              <div className="flex justify-between mt-1 text-[9px] text-gray-400">
                <span>8w ago</span><span>Now</span>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Phase 352: Inventory Low Margin Alert (envanter) ── */}
      {reportsTab === 'envanter' && inventory.length >= 5 && (() => {
        const marginData = inventory
          .filter(item => item.costPrice > 0 && (item.prices?.['Retail'] || item.price || 0) > 0)
          .map(item => {
            const sell = item.prices?.['Retail'] || item.price || 0;
            const cost = item.costPrice;
            const margin = sell > 0 ? ((sell - cost) / sell) * 100 : 0;
            return { name: item.name, margin, sell, cost, stock: item.stockLevel };
          })
          .filter(d => d.margin < 40)
          .sort((a, b) => a.margin - b.margin)
          .slice(0, 8);
        if (marginData.length < 2) return null;
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Low Margin Products</h3>
            <p className="text-xs text-gray-500 mb-4">Items with gross margin below 40% — review pricing or costs</p>
            <div className="space-y-2">
              {marginData.map((d, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs text-gray-600 w-32 truncate">{d.name}</span>
                  <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{width: `${Math.max(d.margin, 0)}%`, background: d.margin < 10 ? '#ef4444' : d.margin < 20 ? '#f97316' : '#f59e0b'}} />
                  </div>
                  <span className="text-xs font-bold w-12 text-right" style={{color: d.margin < 10 ? '#ef4444' : d.margin < 20 ? '#f97316' : '#f59e0b'}}>{d.margin.toFixed(1)}%</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 353: Order Gap Between Customers (crm) ── */}
      {reportsTab === 'crm' && orders.length >= 8 && (() => {
        const toTs353 = (v: unknown): number => {
          if (!v) return 0;
          if (typeof (v as {toDate?:()=>Date}).toDate === 'function') return (v as {toDate:()=>Date}).toDate().getTime();
          return new Date(v as string|number).getTime();
        };
        const custOrders: Record<string, number[]> = {};
        orders.forEach(o => {
          const c = o.customerName || 'Unknown';
          const ts = toTs353(o.createdAt);
          if (!ts) return;
          if (!custOrders[c]) custOrders[c] = [];
          custOrders[c].push(ts);
        });
        const gaps = Object.entries(custOrders)
          .filter(([, ts]) => ts.length >= 2)
          .map(([customer, timestamps]) => {
            const sorted = [...timestamps].sort((a, b) => a - b);
            const avgGap = sorted.slice(1).reduce((s, t, i) => s + (t - sorted[i]) / 86400000, 0) / (sorted.length - 1);
            return { customer, avgGap: Math.round(avgGap), orders: sorted.length };
          })
          .sort((a, b) => b.orders - a.orders)
          .slice(0, 7);
        if (gaps.length < 2) return null;
        const maxGap = Math.max(...gaps.map(g => g.avgGap), 1);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Avg Days Between Orders</h3>
            <p className="text-xs text-gray-500 mb-4">Repeat customer purchase cadence — shorter gap = higher loyalty</p>
            <div className="space-y-2">
              {gaps.map((g, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs text-gray-600 w-28 truncate">{g.customer}</span>
                  <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{width: `${(g.avgGap / maxGap) * 100}%`, background: g.avgGap <= 14 ? '#10b981' : g.avgGap <= 45 ? '#f59e0b' : '#ef4444'}} />
                  </div>
                  <span className="text-[10px] text-gray-400 w-10 text-right">{g.orders}×</span>
                  <span className="text-xs font-bold w-14 text-right" style={{color: g.avgGap <= 14 ? '#10b981' : g.avgGap <= 45 ? '#f59e0b' : '#ef4444'}}>{g.avgGap}d</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 354: Inventory Cost vs Sell Price Scatter (envanter) ── */}
      {reportsTab === 'envanter' && inventory.length >= 6 && (() => {
        const scatterData = inventory
          .filter(i => itemCostTRY(i, exchangeRates) > 0 && (i.prices?.['Retail'] || i.price || 0) > 0)
          .map(i => ({
            name: i.name,
            cost: itemCostTRY(i, exchangeRates),
            sell: itemPriceTRY(i, 'Retail', exchangeRates) || i.price || 0,
            margin: ((( i.prices?.['Retail'] || i.price || 0) - itemCostTRY(i, exchangeRates)) / (i.prices?.['Retail'] || i.price || 1)) * 100,
          }))
          .sort((a, b) => b.sell - a.sell)
          .slice(0, 10);
        if (scatterData.length < 3) return null;
        const maxSell = Math.max(...scatterData.map(d => d.sell), 1);
        const avgMargin = scatterData.reduce((s, d) => s + d.margin, 0) / scatterData.length;
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Cost vs Sell Price — Top 10 SKUs</h3>
            <p className="text-xs text-gray-500 mb-4">Avg margin: <span className="font-bold">{avgMargin.toFixed(1)}%</span> · width = sell price, fill = margin%</p>
            <div className="space-y-1.5">
              {scatterData.map((d, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-[10px] text-gray-500 w-28 truncate">{d.name}</span>
                  <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden relative">
                    <div className="h-full rounded-full absolute left-0" style={{width: `${(d.sell / maxSell) * 100}%`, background: '#e5e7eb'}} />
                    <div className="h-full rounded-full absolute left-0" style={{width: `${(d.cost / maxSell) * 100}%`, background: d.margin < 20 ? '#ef4444' : d.margin < 40 ? '#f59e0b' : '#10b981'}} />
                  </div>
                  <span className="text-[10px] font-bold w-10 text-right" style={{color: d.margin < 20 ? '#ef4444' : d.margin < 40 ? '#f59e0b' : '#10b981'}}>{d.margin.toFixed(0)}%</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 355: Overtime / Absence Rate (ik) ── */}
      {reportsTab === 'ik' && employees.length >= 3 && (() => {
        const withOT = employees.filter(e => (e as unknown as Record<string,unknown>).overtimeHours as number > 0);
        const withAbsence = employees.filter(e => (e as unknown as Record<string,unknown>).absenceDays as number > 0);
        const totalOT = employees.reduce((s, e) => s + (((e as unknown as Record<string,unknown>).overtimeHours as number) || 0), 0);
        const totalAbsence = employees.reduce((s, e) => s + (((e as unknown as Record<string,unknown>).absenceDays as number) || 0), 0);
        if (totalOT === 0 && totalAbsence === 0) return null;
        const otRate = (withOT.length / employees.length * 100).toFixed(0);
        const absRate = (withAbsence.length / employees.length * 100).toFixed(0);
        const topOT = [...employees].sort((a, b) => (((b as unknown as Record<string,unknown>).overtimeHours as number)||0) - (((a as unknown as Record<string,unknown>).overtimeHours as number)||0)).slice(0, 5);
        const maxOT = Math.max(...topOT.map(e => (((e as unknown as Record<string,unknown>).overtimeHours as number)||0)), 1);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Overtime & Absence Overview</h3>
            <div className="flex gap-6 mb-4">
              <div className="text-center"><p className="text-2xl font-black text-amber-500">{otRate}%</p><p className="text-[10px] text-gray-400">with OT ({withOT.length})</p></div>
              <div className="text-center"><p className="text-2xl font-black text-red-500">{absRate}%</p><p className="text-[10px] text-gray-400">with absences ({withAbsence.length})</p></div>
              <div className="text-center"><p className="text-2xl font-black text-gray-700">{totalOT.toLocaleString('tr-TR')}</p><p className="text-[10px] text-gray-400">total OT hrs</p></div>
              <div className="text-center"><p className="text-2xl font-black text-gray-700">{totalAbsence}</p><p className="text-[10px] text-gray-400">absence days</p></div>
            </div>
            {totalOT > 0 && (
              <div className="space-y-1.5">
                {topOT.filter(e => (((e as unknown as Record<string,unknown>).overtimeHours as number)||0) > 0).map((e, i) => {
                  const ot: number = (((e as unknown as Record<string,unknown>).overtimeHours as number)||0);
                  return (
                    <div key={i} className="flex items-center gap-3">
                      <span className="text-xs text-gray-600 w-28 truncate">{e.name}</span>
                      <div className="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full rounded-full bg-amber-400" style={{width: `${(ot / maxOT) * 100}%`}} />
                      </div>
                      <span className="text-xs font-bold text-amber-600 w-12 text-right">{ot}h OT</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })()}

      {/* ── Phase 356: Shipment Weight / Volume Trend (lojistik) ── */}
      {reportsTab === 'lojistik' && orders.length >= 6 && (() => {
        const toTs356 = (v: unknown): number => {
          if (!v) return 0;
          if (typeof (v as {toDate?:()=>Date}).toDate === 'function') return (v as {toDate:()=>Date}).toDate().getTime();
          return new Date(v as string|number).getTime();
        };
        const monthItems: Record<string, number> = {};
        orders.forEach(o => {
          const d = new Date(toTs356(o.createdAt));
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          const qty = (o.lineItems || []).reduce((s: number, li: {quantity?: number}) => s + (li.quantity || 1), 0);
          monthItems[key] = (monthItems[key] || 0) + qty;
        });
        const keys356 = Object.keys(monthItems).sort().slice(-8);
        if (keys356.length < 3) return null;
        const maxQty356 = Math.max(...keys356.map(k => monthItems[k]), 1);
        const totalItems = keys356.reduce((s, k) => s + monthItems[k], 0);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Monthly Shipment Volume</h3>
            <p className="text-xs text-gray-500 mb-4">Total line-item units shipped · {totalItems.toLocaleString('tr-TR')} over {keys356.length} months</p>
            <div className="flex items-end gap-2 h-24">
              {keys356.map(k => (
                <div key={k} className="flex-1 flex flex-col items-center gap-0.5">
                  <span className="text-[9px] text-gray-500">{monthItems[k]}</span>
                  <div className="w-full rounded-t-lg bg-sky-400 transition-all" style={{height: `${Math.max((monthItems[k] / maxQty356) * 72, 4)}px`}} />
                  <span className="text-[9px] text-gray-400">{k.slice(5)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 357: Quote Value Pipeline (crm) ── */}
      {reportsTab === 'crm' && quotations.length >= 3 && (() => {
        const pipeline: Record<string, number> = {};
        quotations.forEach(q => {
          const s = (q.status || 'draft').toLowerCase();
          const val = (q as unknown as Record<string,unknown>).totalPrice as number || (q as unknown as Record<string,unknown>).total as number || 0;
          pipeline[s] = (pipeline[s] || 0) + val;
        });
        const statusOrder = ['draft','sent','accepted','converted','rejected'];
        const pipelineData = statusOrder.map(s => ({status: s, value: pipeline[s] || 0})).filter(d => d.value > 0);
        if (pipelineData.length < 2) return null;
        const totalPipeline = pipelineData.reduce((s, d) => s + d.value, 0);
        const colors357: Record<string, string> = {draft:'#94a3b8',sent:'#6366f1',accepted:'#10b981',converted:'#f59e0b',rejected:'#ef4444'};
        const maxVal357 = Math.max(...pipelineData.map(d => d.value), 1);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Quote Value Pipeline</h3>
            <p className="text-xs text-gray-500 mb-4">Total pipeline: {fmtAna(totalPipeline,'full',0)}</p>
            <div className="space-y-2">
              {pipelineData.map((d, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs text-gray-600 w-20 capitalize">{d.status}</span>
                  <div className="flex-1 h-5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{width: `${(d.value / maxVal357) * 100}%`, background: colors357[d.status] || '#94a3b8'}} />
                  </div>
                  <span className="text-[10px] text-gray-400 w-10 text-right">{totalPipeline > 0 ? ((d.value / totalPipeline) * 100).toFixed(0) : 0}%</span>
                  <span className="text-xs font-bold w-24 text-right" style={{color: colors357[d.status] || '#94a3b8'}}>{fmtAna(d.value,'full',0)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 358: Inventory Dead Stock (envanter) ── */}
      {reportsTab === 'envanter' && inventory.length >= 5 && inventoryMovements.length >= 3 && (() => {
        const toTs358 = (v: unknown): number => {
          if (!v) return 0;
          if (typeof (v as {toDate?:()=>Date}).toDate === 'function') return (v as {toDate:()=>Date}).toDate().getTime();
          return new Date(v as string|number).getTime();
        };
        const now358 = Date.now();
        const lastSale358: Record<string, number> = {};
        inventoryMovements.filter(m => m.type === 'out').forEach(m => {
          const ts = toTs358(m.timestamp);
          const key = m.productName || '';
          if (key && (!lastSale358[key] || ts > lastSale358[key])) lastSale358[key] = ts;
        });
        const deadStock = inventory
          .filter(item => {
            if (item.stockLevel <= 0) return false;
            const lastTs = lastSale358[item.name];
            const daysSince = lastTs ? Math.floor((now358 - lastTs) / 86400000) : 999;
            return daysSince > 180;
          })
          .map(item => {
            const lastTs = lastSale358[item.name];
            const days = lastTs ? Math.floor((now358 - lastTs) / 86400000) : 999;
            return { name: item.name, stock: item.stockLevel, value: item.stockLevel * (item.costPrice || 0), days };
          })
          .sort((a, b) => b.value - a.value)
          .slice(0, 7);
        if (deadStock.length < 2) return null;
        const totalDeadValue = deadStock.reduce((s, d) => s + d.value, 0);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Dead Stock Report</h3>
            <p className="text-xs text-gray-500 mb-4">No sales in 180+ days · Locked capital: {fmtAna(totalDeadValue,'full',0)}</p>
            <div className="space-y-2">
              {deadStock.map((d, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs text-gray-600 flex-1 truncate">{d.name}</span>
                  <span className="text-[10px] text-gray-400 w-16 text-right">{d.days === 999 ? 'Never sold' : `${d.days}d ago`}</span>
                  <span className="text-[10px] text-gray-500 w-12 text-right">{d.stock} units</span>
                  <span className="text-xs font-bold text-red-500 w-24 text-right">{fmtAna(d.value,'full',0)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 359: Orders per Customer Histogram (crm) ── */}
      {reportsTab === 'crm' && orders.length >= 8 && (() => {
        const custCount: Record<string, number> = {};
        orders.forEach(o => { const c = o.customerName || 'Unknown'; custCount[c] = (custCount[c] || 0) + 1; });
        const counts = Object.values(custCount);
        if (counts.length < 3) return null;
        const buckets359 = [
          {label: '1 order',  min: 1, max: 1,   count: 0, color: '#94a3b8'},
          {label: '2–3',      min: 2, max: 3,   count: 0, color: '#6366f1'},
          {label: '4–6',      min: 4, max: 6,   count: 0, color: '#3b82f6'},
          {label: '7–10',     min: 7, max: 10,  count: 0, color: '#10b981'},
          {label: '11+',      min: 11, max: 999, count: 0, color: '#f59e0b'},
        ];
        counts.forEach(c => { const b = buckets359.find(b => c >= b.min && c <= b.max); if (b) b.count++; });
        const maxB359 = Math.max(...buckets359.map(b => b.count), 1);
        const totalCusts = counts.length;
        const repeatPct = ((counts.filter(c => c > 1).length / totalCusts) * 100).toFixed(0);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Orders per Customer</h3>
            <p className="text-xs text-gray-500 mb-4">{totalCusts} unique customers · <span className="font-bold text-[#ff4000]">{repeatPct}%</span> repeat buyers</p>
            <div className="flex items-end gap-3 h-20">
              {buckets359.map((b, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-xs font-bold" style={{color: b.color}}>{b.count}</span>
                  <div className="w-full rounded-t-lg" style={{height: `${Math.max((b.count / maxB359) * 60, 4)}px`, background: b.color}} />
                  <span className="text-[9px] text-gray-500 text-center">{b.label}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 360: Monthly Employee Cost vs Revenue Ratio (ik) ── */}
      {reportsTab === 'ik' && employees.length >= 2 && orders.length >= 3 && (() => {
        const toTs360 = (v: unknown): number => {
          if (!v) return 0;
          if (typeof (v as {toDate?:()=>Date}).toDate === 'function') return (v as {toDate:()=>Date}).toDate().getTime();
          return new Date(v as string|number).getTime();
        };
        const totalSalary = employees.reduce((s, e) => s + (e.salary || 0), 0);
        const monthRevMap: Record<string, number> = {};
        orders.forEach(o => {
          const d = new Date(toTs360(o.createdAt));
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          monthRevMap[key] = (monthRevMap[key] || 0) + (o.totalPrice || 0);
        });
        const keys360 = Object.keys(monthRevMap).sort().slice(-6);
        if (keys360.length < 2) return null;
        const ratioData = keys360.map(k => ({
          k,
          rev: monthRevMap[k],
          ratio: monthRevMap[k] > 0 ? (totalSalary / monthRevMap[k]) * 100 : 0,
        }));
        const avgRatio = ratioData.reduce((s, d) => s + d.ratio, 0) / ratioData.length;
        const maxRatio = Math.max(...ratioData.map(d => d.ratio), 1);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Payroll-to-Revenue Ratio</h3>
            <p className="text-xs text-gray-500 mb-4">Monthly salary ({fmtAna(totalSalary,'full',0)}) as % of revenue · Avg: {avgRatio.toFixed(1)}%</p>
            <div className="flex items-end gap-2 h-24">
              {ratioData.map((d, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                  <span className="text-[9px] text-gray-500">{d.ratio.toFixed(0)}%</span>
                  <div className="w-full rounded-t-lg transition-all" style={{height: `${Math.max((d.ratio / maxRatio) * 72, 4)}px`, background: d.ratio > 40 ? '#ef4444' : d.ratio > 20 ? '#f59e0b' : '#10b981'}} />
                  <span className="text-[9px] text-gray-400">{d.k.slice(5)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 361: Revenue by Product Category (genel) ── */}
      {reportsTab === 'genel' && orders.length >= 5 && (() => {
        const catRev: Record<string, number> = {};
        orders.forEach(o => {
          (o.lineItems || []).forEach((li: {category?: string; name?: string; price?: number; unitPrice?: number; quantity?: number}) => {
            const cat = li.category || 'Other';
            catRev[cat] = (catRev[cat] || 0) + (li.price || li.unitPrice || 0) * (li.quantity || 1);
          });
        });
        const cats361 = Object.entries(catRev).map(([cat, rev]) => ({cat, rev})).filter(d => d.rev > 0).sort((a, b) => b.rev - a.rev).slice(0, 7);
        if (cats361.length < 2) return null;
        const totalRev361 = cats361.reduce((s, c) => s + c.rev, 0);
        const maxRev361 = cats361[0].rev;
        const colors361 = ['#6366f1','#3b82f6','#10b981','#f59e0b','#f97316','#ef4444','#8b5cf6'];
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Revenue by Product Category</h3>
            <p className="text-xs text-gray-500 mb-4">Line-item revenue share · Total: {fmtAna(totalRev361,'full',0)}</p>
            <div className="space-y-2">
              {cats361.map((c, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs text-gray-600 w-28 truncate">{c.cat}</span>
                  <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{width: `${(c.rev / maxRev361) * 100}%`, background: colors361[i % colors361.length]}} />
                  </div>
                  <span className="text-[10px] text-gray-400 w-8 text-right">{totalRev361 > 0 ? ((c.rev / totalRev361) * 100).toFixed(0) : 0}%</span>
                  <span className="text-xs font-bold w-24 text-right" style={{color: colors361[i % colors361.length]}}>{fmtAna(c.rev,'full',0)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 362: Quotation Avg Value Over Time (crm) ── */}
      {reportsTab === 'crm' && quotations.length >= 4 && (() => {
        const toTs362 = (v: unknown): number => {
          if (!v) return 0;
          if (typeof (v as {toDate?:()=>Date}).toDate === 'function') return (v as {toDate:()=>Date}).toDate().getTime();
          return new Date(v as string|number).getTime();
        };
        const monthQV: Record<string, {total: number; count: number}> = {};
        quotations.forEach(q => {
          const ts = toTs362((q as unknown as Record<string,unknown>).createdAt);
          if (!ts) return;
          const d = new Date(ts);
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          const val = (q as unknown as Record<string,unknown>).totalPrice as number || (q as unknown as Record<string,unknown>).total as number || 0;
          if (!monthQV[key]) monthQV[key] = {total: 0, count: 0};
          monthQV[key].total += val;
          monthQV[key].count++;
        });
        const keys362 = Object.keys(monthQV).sort().slice(-7);
        if (keys362.length < 2) return null;
        const avgData = keys362.map(k => ({k, avg: monthQV[k].count > 0 ? monthQV[k].total / monthQV[k].count : 0, count: monthQV[k].count}));
        const maxAvg362 = Math.max(...avgData.map(d => d.avg), 1);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Avg Quote Value Over Time</h3>
            <p className="text-xs text-gray-500 mb-4">Monthly average quotation value trend</p>
            <div className="flex items-end gap-2 h-24">
              {avgData.map((d, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                  <span className="text-[9px] text-gray-500">{d.count}</span>
                  <div className="w-full rounded-t-lg bg-violet-400 transition-all" style={{height: `${Math.max((d.avg / maxAvg362) * 72, 4)}px`}} />
                  <span className="text-[9px] text-gray-400">{d.k.slice(5)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 363: Top Suppliers by Inventory Stock (lojistik) ── */}
      {reportsTab === 'lojistik' && inventory.length >= 3 && (() => {
        const suppMap: Record<string, {count: number; stock: number; value: number}> = {};
        inventory.forEach(item => {
          const s = item.supplier || 'Unknown';
          if (!suppMap[s]) suppMap[s] = {count: 0, stock: 0, value: 0};
          suppMap[s].count++;
          suppMap[s].stock += item.stockLevel;
          suppMap[s].value += item.stockLevel * (item.costPrice || 0);
        });
        const supps363 = Object.entries(suppMap).filter(([s]) => s !== 'Unknown').map(([s, d]) => ({supplier: s, ...d})).sort((a, b) => b.value - a.value).slice(0, 7);
        if (supps363.length < 2) return null;
        const maxVal363 = Math.max(...supps363.map(s => s.value), 1);
        const colors363 = ['#6366f1','#3b82f6','#10b981','#f59e0b','#f97316','#ef4444','#8b5cf6'];
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Top Suppliers by Stock Value</h3>
            <p className="text-xs text-gray-500 mb-4">Current inventory value held per supplier</p>
            <div className="space-y-2">
              {supps363.map((s, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs text-gray-600 w-28 truncate">{s.supplier}</span>
                  <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{width: `${(s.value / maxVal363) * 100}%`, background: colors363[i % colors363.length]}} />
                  </div>
                  <span className="text-[10px] text-gray-400 w-12 text-right">{s.count} SKU</span>
                  <span className="text-xs font-bold w-24 text-right" style={{color: colors363[i % colors363.length]}}>{fmtAna(s.value,'full',0)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 364: Inventory Reorder Frequency (envanter) ── */}
      {reportsTab === 'envanter' && inventoryMovements.length >= 5 && (() => {
        const inMoves = inventoryMovements.filter(m => m.type === 'in');
        const reorderCount: Record<string, number> = {};
        inMoves.forEach(m => { reorderCount[m.productName || 'Unknown'] = (reorderCount[m.productName || 'Unknown'] || 0) + 1; });
        const reorderData = Object.entries(reorderCount).map(([name, count]) => ({name, count})).filter(d => d.count >= 2).sort((a, b) => b.count - a.count).slice(0, 8);
        if (reorderData.length < 2) return null;
        const maxCount364 = Math.max(...reorderData.map(d => d.count), 1);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Most Frequently Reordered</h3>
            <p className="text-xs text-gray-500 mb-4">Products with most inbound stock movements</p>
            <div className="space-y-2">
              {reorderData.map((d, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs text-gray-600 w-32 truncate">{d.name}</span>
                  <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full bg-cyan-400 transition-all" style={{width: `${(d.count / maxCount364) * 100}%`}} />
                  </div>
                  <span className="text-xs font-bold text-cyan-600 w-10 text-right">{d.count}×</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 365: Daily Active Revenue Streak (genel) ── */}
      {reportsTab === 'genel' && orders.length >= 7 && (() => {
        const toTs365 = (v: unknown): number => {
          if (!v) return 0;
          if (typeof (v as {toDate?:()=>Date}).toDate === 'function') return (v as {toDate:()=>Date}).toDate().getTime();
          return new Date(v as string|number).getTime();
        };
        const daySet = new Set<string>();
        orders.forEach(o => {
          const ts = toTs365(o.createdAt);
          if (!ts) return;
          const d = new Date(ts);
          daySet.add(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`);
        });
        const sortedDays = [...daySet].sort();
        if (sortedDays.length < 3) return null;
        // Current streak
        let streak = 0;
        let checkDate = new Date();
        while (true) {
          const key = `${checkDate.getFullYear()}-${String(checkDate.getMonth()+1).padStart(2,'0')}-${String(checkDate.getDate()).padStart(2,'0')}`;
          if (!daySet.has(key)) break;
          streak++;
          checkDate = new Date(checkDate.getTime() - 86400000);
        }
        // Longest streak
        let maxStreak = 0, cur = 1;
        for (let i = 1; i < sortedDays.length; i++) {
          const diff = (new Date(sortedDays[i]).getTime() - new Date(sortedDays[i-1]).getTime()) / 86400000;
          if (diff === 1) { cur++; maxStreak = Math.max(maxStreak, cur); }
          else cur = 1;
        }
        // Last 30 days presence
        const last30: boolean[] = [];
        for (let i = 29; i >= 0; i--) {
          const d = new Date(Date.now() - i * 86400000);
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
          last30.push(daySet.has(key));
        }
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Revenue Activity Streak</h3>
            <div className="flex gap-6 mb-4">
              <div className="text-center"><p className="text-2xl font-black text-[#ff4000]">{streak}</p><p className="text-[10px] text-gray-400">current streak</p></div>
              <div className="text-center"><p className="text-2xl font-black text-indigo-600">{maxStreak}</p><p className="text-[10px] text-gray-400">longest streak</p></div>
              <div className="text-center"><p className="text-2xl font-black text-gray-700">{daySet.size}</p><p className="text-[10px] text-gray-400">active days total</p></div>
            </div>
            <p className="text-[10px] text-gray-400 mb-1">Last 30 days</p>
            <div className="flex gap-0.5 flex-wrap">
              {last30.map((active, i) => (
                <div key={i} className={`w-4 h-4 rounded-sm ${active ? 'bg-[#ff4000]' : 'bg-gray-100'}`} />
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 366: HR Department Headcount vs Budget (ik) ── */}
      {reportsTab === 'ik' && employees.length >= 3 && (() => {
        const deptHC: Record<string, number> = {};
        employees.forEach(e => { const d = e.department || 'Unknown'; deptHC[d] = (deptHC[d] || 0) + 1; });
        const totalHC = employees.length;
        const deptRows = Object.entries(deptHC).map(([dept, count]) => ({dept, count, pct: (count / totalHC) * 100})).sort((a, b) => b.count - a.count);
        if (deptRows.length < 2) return null;
        const colors366 = ['#6366f1','#3b82f6','#10b981','#f59e0b','#f97316','#8b5cf6','#ef4444'];
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Headcount by Department</h3>
            <p className="text-xs text-gray-500 mb-4">{totalHC} employees across {deptRows.length} departments</p>
            <div className="space-y-2">
              {deptRows.map((d, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{background: colors366[i % colors366.length]}} />
                  <span className="text-xs text-gray-700 flex-1 truncate">{d.dept}</span>
                  <div className="w-32 h-3 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{width: `${d.pct}%`, background: colors366[i % colors366.length]}} />
                  </div>
                  <span className="text-xs font-bold w-12 text-right" style={{color: colors366[i % colors366.length]}}>{d.count} ({d.pct.toFixed(0)}%)</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 367: Order Status Change Velocity (lojistik) ── */}
      {reportsTab === 'lojistik' && orders.length >= 8 && (() => {
        const toTs367 = (v: unknown): number => {
          if (!v) return 0;
          if (typeof (v as {toDate?:()=>Date}).toDate === 'function') return (v as {toDate:()=>Date}).toDate().getTime();
          return new Date(v as string|number).getTime();
        };
        const now367 = Date.now();
        const ageBuckets = [
          {label: '< 1d',  max: 1,   count: 0, color: '#10b981'},
          {label: '1–3d',  max: 3,   count: 0, color: '#6366f1'},
          {label: '4–7d',  max: 7,   count: 0, color: '#f59e0b'},
          {label: '8–14d', max: 14,  count: 0, color: '#f97316'},
          {label: '15d+',  max: 999, count: 0, color: '#ef4444'},
        ];
        const openOrders = orders.filter(o => !['Delivered','Cancelled'].includes(o.status));
        openOrders.forEach(o => {
          const created = toTs367(o.createdAt);
          if (!created) return;
          const ageDays = (now367 - created) / 86400000;
          const b = ageBuckets.find(b => ageDays < b.max);
          if (b) b.count++;
        });
        if (openOrders.length < 2) return null;
        const maxAB = Math.max(...ageBuckets.map(b => b.count), 1);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Open Order Age Distribution</h3>
            <p className="text-xs text-gray-500 mb-4">{openOrders.length} open orders (Pending + Processing + Shipped)</p>
            <div className="flex items-end gap-3 h-20">
              {ageBuckets.map((b, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-xs font-bold" style={{color: b.color}}>{b.count}</span>
                  <div className="w-full rounded-t-lg" style={{height: `${Math.max((b.count / maxAB) * 60, 4)}px`, background: b.color}} />
                  <span className="text-[9px] text-gray-500">{b.label}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 368: SKU Velocity Ranking (envanter) ── */}
      {reportsTab === 'envanter' && inventoryMovements.length >= 5 && (() => {
        const toTs368 = (v: unknown): number => {
          if (!v) return 0;
          if (typeof (v as {toDate?:()=>Date}).toDate === 'function') return (v as {toDate:()=>Date}).toDate().getTime();
          return new Date(v as string|number).getTime();
        };
        const cutoff = Date.now() - 30 * 86400000;
        const recentOut: Record<string, number> = {};
        inventoryMovements.filter(m => m.type === 'out' && toTs368(m.timestamp) > cutoff)
          .forEach(m => { recentOut[m.productName || 'Unknown'] = (recentOut[m.productName || 'Unknown'] || 0) + (m.quantity || 0); });
        const velocityData = Object.entries(recentOut).map(([sku, qty]) => ({sku, qty})).sort((a, b) => b.qty - a.qty).slice(0, 8);
        if (velocityData.length < 2) return null;
        const maxQty368 = Math.max(...velocityData.map(d => d.qty), 1);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">SKU Velocity (Last 30 Days)</h3>
            <p className="text-xs text-gray-500 mb-4">Units moved out in the past 30 days — fastest moving SKUs</p>
            <div className="space-y-2">
              {velocityData.map((d, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs text-gray-600 w-32 truncate">{d.sku}</span>
                  <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full bg-rose-400 transition-all" style={{width: `${(d.qty / maxQty368) * 100}%`}} />
                  </div>
                  <span className="text-xs font-bold text-rose-500 w-14 text-right">{d.qty} units</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 369: Recurring Revenue Trend (lojistik) ── */}
      {reportsTab === 'lojistik' && recurringOrders.length >= 2 && (() => {
        const freqMult: Record<string, number> = {weekly: 4.33, monthly: 1, quarterly: 0.333};
        const activeRec = recurringOrders.filter(r => r.active);
        if (activeRec.length < 2) return null;
        const mrr = activeRec.reduce((s, r) => s + r.totalPrice * (freqMult[r.frequency] || 1), 0);
        const arr = mrr * 12;
        const byCustomer = Object.entries(
          activeRec.reduce((acc, r) => { acc[r.customerName] = (acc[r.customerName] || 0) + r.totalPrice * (freqMult[r.frequency] || 1); return acc; }, {} as Record<string, number>)
        ).map(([c, v]) => ({c, v})).sort((a, b) => b.v - a.v).slice(0, 5);
        const maxMRR = Math.max(...byCustomer.map(d => d.v), 1);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Recurring Revenue Overview</h3>
            <div className="flex gap-6 mb-4">
              <div><p className="text-xl font-black text-[#ff4000]">{fmtAna(mrr,'full',0)}</p><p className="text-[10px] text-gray-400">MRR</p></div>
              <div><p className="text-xl font-black text-indigo-600">{fmtAna(arr,'full',0)}</p><p className="text-[10px] text-gray-400">ARR</p></div>
              <div><p className="text-xl font-black text-gray-700">{activeRec.length}</p><p className="text-[10px] text-gray-400">active subs</p></div>
            </div>
            <div className="space-y-1.5">
              {byCustomer.map((d, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs text-gray-600 w-28 truncate">{d.c}</span>
                  <div className="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full bg-indigo-400" style={{width: `${(d.v / maxMRR) * 100}%`}} />
                  </div>
                  <span className="text-xs font-bold text-indigo-600 w-24 text-right">{fmtAna(d.v,'full',0)}/mo</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 370: Customer Segment Revenue Share (crm) ── */}
      {reportsTab === 'crm' && orders.length >= 5 && (() => {
        const segRev: Record<string, number> = {};
        orders.forEach(o => {
          const seg = (o as unknown as Record<string,unknown>).customerSegment as string || (o as unknown as Record<string,unknown>).segment as string || (o as unknown as Record<string,unknown>).customerType as string || 'Standard';
          segRev[seg] = (segRev[seg] || 0) + (o.totalPrice || 0);
        });
        const segs370 = Object.entries(segRev).map(([seg, rev]) => ({seg, rev})).sort((a, b) => b.rev - a.rev);
        if (segs370.length < 2) return null;
        const totalRev370 = segs370.reduce((s, d) => s + d.rev, 0);
        const colors370 = ['#6366f1','#10b981','#f59e0b','#3b82f6','#f97316','#8b5cf6'];
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Revenue by Customer Segment</h3>
            <p className="text-xs text-gray-500 mb-4">Total: {fmtAna(totalRev370,'full',0)}</p>
            <div className="space-y-2">
              {segs370.map((s, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs text-gray-700 w-24 truncate">{s.seg}</span>
                  <div className="flex-1 h-5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{width: `${totalRev370 > 0 ? (s.rev / totalRev370) * 100 : 0}%`, background: colors370[i % colors370.length]}} />
                  </div>
                  <span className="text-[10px] text-gray-400 w-8 text-right">{totalRev370 > 0 ? ((s.rev / totalRev370) * 100).toFixed(0) : 0}%</span>
                  <span className="text-xs font-bold w-24 text-right" style={{color: colors370[i % colors370.length]}}>{fmtAna(s.rev,'full',0)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 371: Revenue Forecast Next 30 Days (genel) ── */}
      {reportsTab === 'genel' && orders.length >= 10 && (() => {
        const toTs371 = (v: unknown): number => {
          if (!v) return 0;
          if (typeof (v as {toDate?:()=>Date}).toDate === 'function') return (v as {toDate:()=>Date}).toDate().getTime();
          return new Date(v as string|number).getTime();
        };
        const now371 = Date.now();
        const last90 = orders.filter(o => toTs371(o.createdAt) > now371 - 90 * 86400000);
        if (last90.length < 5) return null;
        const dailyAvg = last90.reduce((s, o) => s + (o.totalPrice || 0), 0) / 90;
        const last30Rev = orders.filter(o => toTs371(o.createdAt) > now371 - 30 * 86400000).reduce((s, o) => s + (o.totalPrice || 0), 0);
        const last60to30Rev = orders.filter(o => { const ts = toTs371(o.createdAt); return ts > now371 - 60 * 86400000 && ts <= now371 - 30 * 86400000; }).reduce((s, o) => s + (o.totalPrice || 0), 0);
        const momGrowth = last60to30Rev > 0 ? (last30Rev - last60to30Rev) / last60to30Rev : 0;
        const forecast = dailyAvg * 30 * (1 + momGrowth * 0.5);
        const confidence = Math.min(90, Math.max(50, 70 + last90.length * 0.5));
        const bars = Array.from({length: 6}, (_, i) => ({
          label: `+${(i+1)*5}d`,
          value: dailyAvg * (i + 1) * 5 * (1 + momGrowth * 0.3),
        }));
        const maxBar = Math.max(...bars.map(b => b.value), 1);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">30-Day Revenue Forecast</h3>
            <div className="flex gap-6 mb-4">
              <div><p className="text-2xl font-black text-[#ff4000]">{fmtAna(forecast,'full',0)}</p><p className="text-[10px] text-gray-400">projected</p></div>
              <div><p className="text-2xl font-black text-gray-700">{confidence.toFixed(0)}%</p><p className="text-[10px] text-gray-400">confidence</p></div>
              <div><p className="text-2xl font-black" style={{color: momGrowth >= 0 ? '#10b981' : '#ef4444'}}>{momGrowth >= 0 ? '+' : ''}{(momGrowth * 100).toFixed(1)}%</p><p className="text-[10px] text-gray-400">MoM trend</p></div>
            </div>
            <div className="flex items-end gap-2 h-16">
              {bars.map((b, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                  <div className="w-full rounded-t-lg" style={{height: `${Math.max((b.value / maxBar) * 48, 4)}px`, background: `rgba(255,64,0,${0.3 + i * 0.12})`}} />
                  <span className="text-[9px] text-gray-400">{b.label}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 372: Employee Skills Matrix (ik) ── */}
      {reportsTab === 'ik' && employees.length >= 3 && (() => {
        const skillMap: Record<string, number> = {};
        employees.forEach(e => {
          const skills = (e as unknown as Record<string,unknown>).skills as string[] | string | undefined;
          const arr = Array.isArray(skills) ? skills : typeof skills === 'string' ? skills.split(',').map(s => s.trim()) : [];
          arr.filter(Boolean).forEach(s => { skillMap[s] = (skillMap[s] || 0) + 1; });
        });
        const topSkills = Object.entries(skillMap).sort((a, b) => b[1] - a[1]).slice(0, 8);
        if (topSkills.length < 2) return null;
        const maxSkill = Math.max(...topSkills.map(([, c]) => c), 1);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Skill Coverage Matrix</h3>
            <p className="text-xs text-gray-500 mb-4">Number of employees with each skill</p>
            <div className="space-y-2">
              {topSkills.map(([skill, count], i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs text-gray-600 w-28 truncate">{skill}</span>
                  <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full bg-sky-400 transition-all" style={{width: `${(count / maxSkill) * 100}%`}} />
                  </div>
                  <span className="text-xs font-bold text-sky-600 w-8 text-right">{count}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 373: Order Source Channel Mix (crm) ── */}
      {reportsTab === 'crm' && orders.length >= 5 && (() => {
        const sourceMap: Record<string, {count: number; rev: number}> = {};
        orders.forEach(o => {
          const src = (o as unknown as Record<string,unknown>).source as string || (o as unknown as Record<string,unknown>).channel as string || (o as unknown as Record<string,unknown>).orderSource as string || 'Direct';
          if (!sourceMap[src]) sourceMap[src] = {count: 0, rev: 0};
          sourceMap[src].count++;
          sourceMap[src].rev += o.totalPrice || 0;
        });
        const sources = Object.entries(sourceMap).map(([src, d]) => ({src, ...d})).sort((a, b) => b.rev - a.rev);
        if (sources.length < 2) return null;
        const totalRev373 = sources.reduce((s, d) => s + d.rev, 0);
        const colors373 = ['#6366f1','#10b981','#f59e0b','#3b82f6','#f97316','#8b5cf6'];
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Order Source Mix</h3>
            <p className="text-xs text-gray-500 mb-4">Revenue share by acquisition channel</p>
            <div className="space-y-2">
              {sources.map((s, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{background: colors373[i % colors373.length]}} />
                  <span className="text-xs text-gray-700 flex-1 truncate">{s.src}</span>
                  <div className="w-28 h-3 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{width: `${totalRev373 > 0 ? (s.rev / totalRev373) * 100 : 0}%`, background: colors373[i % colors373.length]}} />
                  </div>
                  <span className="text-[10px] text-gray-400 w-8 text-right">{totalRev373 > 0 ? ((s.rev / totalRev373) * 100).toFixed(0) : 0}%</span>
                  <span className="text-xs font-bold w-20 text-right" style={{color: colors373[i % colors373.length]}}>{fmtAna(s.rev,'full',0)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 374: Inventory ABC Analysis (envanter) ── */}
      {reportsTab === 'envanter' && inventory.length >= 6 && (() => {
        const itemsWithRev = inventory.map(item => {
          const sold = inventoryMovements.filter(m => m.type === 'out' && m.productName === item.name).reduce((s, m) => s + (m.quantity || 0), 0);
          const rev = sold * (item.prices?.['Retail'] || item.price || 0);
          return {name: item.name, rev, stock: item.stockLevel, cost: item.costPrice};
        }).filter(d => d.rev > 0 || d.stock > 0).sort((a, b) => b.rev - a.rev);
        if (itemsWithRev.length < 4) return null;
        const totalRev374 = itemsWithRev.reduce((s, d) => s + d.rev, 0);
        let cumRev = 0;
        const classified = itemsWithRev.map(d => {
          cumRev += d.rev;
          const cumPct = totalRev374 > 0 ? (cumRev / totalRev374) * 100 : 0;
          return {...d, class: cumPct <= 80 ? 'A' : cumPct <= 95 ? 'B' : 'C'};
        });
        const counts = {A: classified.filter(d => d.class === 'A').length, B: classified.filter(d => d.class === 'B').length, C: classified.filter(d => d.class === 'C').length};
        const classColors: Record<string, string> = {A: '#10b981', B: '#f59e0b', C: '#ef4444'};
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">ABC Inventory Analysis</h3>
            <p className="text-xs text-gray-500 mb-4">A = top 80% revenue · B = next 15% · C = bottom 5%</p>
            <div className="flex gap-4 mb-4">
              {(['A','B','C'] as const).map(cls => (
                <div key={cls} className="flex-1 rounded-xl p-3 text-center" style={{background: classColors[cls] + '22'}}>
                  <p className="text-xl font-black" style={{color: classColors[cls]}}>{counts[cls]}</p>
                  <p className="text-[10px] font-bold" style={{color: classColors[cls]}}>Class {cls}</p>
                  <p className="text-[9px] text-gray-400">{itemsWithRev.length > 0 ? ((counts[cls] / itemsWithRev.length) * 100).toFixed(0) : 0}% of SKUs</p>
                </div>
              ))}
            </div>
            <div className="space-y-1">
              {classified.slice(0, 6).map((d, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-[9px] font-black w-4 text-center rounded" style={{color: classColors[d.class], background: classColors[d.class] + '22'}}>{d.class}</span>
                  <span className="text-[10px] text-gray-600 flex-1 truncate">{d.name}</span>
                  <span className="text-[10px] font-bold text-gray-500">{fmtAna(d.rev,'full',0)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 375: Logistics On-Time Delivery by Month (lojistik) ── */}
      {reportsTab === 'lojistik' && orders.filter(o => o.status === 'Delivered').length >= 4 && (() => {
        const toTs375 = (v: unknown): number => {
          if (!v) return 0;
          if (typeof (v as {toDate?:()=>Date}).toDate === 'function') return (v as {toDate:()=>Date}).toDate().getTime();
          return new Date(v as string|number).getTime();
        };
        const monthOTD: Record<string, {total: number; onTime: number}> = {};
        orders.filter(o => o.status === 'Delivered').forEach(o => {
          const created = toTs375(o.createdAt);
          const updated = toTs375((o as unknown as Record<string,unknown>).updatedAt || (o as unknown as Record<string,unknown>).deliveredAt);
          if (!created) return;
          const d = new Date(created);
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          if (!monthOTD[key]) monthOTD[key] = {total: 0, onTime: 0};
          monthOTD[key].total++;
          const days = (updated && updated > created) ? (updated - created) / 86400000 : 0;
          if (days > 0 && days <= 3) monthOTD[key].onTime++;
        });
        const keys375 = Object.keys(monthOTD).sort().slice(-7);
        if (keys375.length < 2) return null;
        const otdData = keys375.map(k => ({k, rate: monthOTD[k].total > 0 ? (monthOTD[k].onTime / monthOTD[k].total) * 100 : 0, total: monthOTD[k].total}));
        const avgOTD = otdData.reduce((s, d) => s + d.rate, 0) / otdData.length;
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">On-Time Delivery Rate (≤3d)</h3>
            <p className="text-xs text-gray-500 mb-4">Monthly OTD % · Avg: <span className="font-bold" style={{color: avgOTD >= 80 ? '#10b981' : avgOTD >= 60 ? '#f59e0b' : '#ef4444'}}>{avgOTD.toFixed(1)}%</span></p>
            <div className="flex items-end gap-2 h-24">
              {otdData.map((d, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                  <span className="text-[9px] text-gray-500">{d.rate.toFixed(0)}%</span>
                  <div className="w-full rounded-t-lg transition-all" style={{height: `${Math.max(d.rate / 100 * 72, 4)}px`, background: d.rate >= 80 ? '#10b981' : d.rate >= 60 ? '#f59e0b' : '#ef4444'}} />
                  <span className="text-[9px] text-gray-400">{d.k.slice(5)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 376: Revenue per SKU Sold (envanter) ── */}
      {reportsTab === 'envanter' && orders.length >= 5 && (() => {
        const skuRev: Record<string, {units: number; rev: number}> = {};
        orders.forEach(o => {
          (o.lineItems || []).forEach((li: {sku?: string; name?: string; quantity?: number; price?: number; unitPrice?: number}) => {
            const key = li.sku || li.name || 'Unknown';
            if (!skuRev[key]) skuRev[key] = {units: 0, rev: 0};
            skuRev[key].units += li.quantity || 1;
            skuRev[key].rev += (li.price || li.unitPrice || 0) * (li.quantity || 1);
          });
        });
        const skuData = Object.entries(skuRev).map(([sku, d]) => ({sku, ...d, revPerUnit: d.units > 0 ? d.rev / d.units : 0})).filter(d => d.units >= 2).sort((a, b) => b.rev - a.rev).slice(0, 8);
        if (skuData.length < 2) return null;
        const maxRev376 = Math.max(...skuData.map(d => d.rev), 1);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Revenue per SKU</h3>
            <p className="text-xs text-gray-500 mb-4">Top SKUs by total revenue generated from sales</p>
            <div className="space-y-2">
              {skuData.map((d, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs text-gray-600 w-28 truncate">{d.sku}</span>
                  <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full bg-emerald-400 transition-all" style={{width: `${(d.rev / maxRev376) * 100}%`}} />
                  </div>
                  <span className="text-[10px] text-gray-400 w-12 text-right">{d.units} sold</span>
                  <span className="text-xs font-bold text-emerald-600 w-24 text-right">{fmtAna(d.rev,'full',0)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 377: New Customer Acquisition Rate (crm) ── */}
      {reportsTab === 'crm' && orders.length >= 8 && (() => {
        const toTs377 = (v: unknown): number => {
          if (!v) return 0;
          if (typeof (v as {toDate?:()=>Date}).toDate === 'function') return (v as {toDate:()=>Date}).toDate().getTime();
          return new Date(v as string|number).getTime();
        };
        const firstOrder: Record<string, string> = {};
        [...orders].sort((a, b) => toTs377(a.createdAt) - toTs377(b.createdAt)).forEach(o => {
          if (!firstOrder[o.customerName]) firstOrder[o.customerName] = (() => {
            const d = new Date(toTs377(o.createdAt));
            return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          })();
        });
        const monthNew: Record<string, number> = {};
        Object.values(firstOrder).forEach(k => { monthNew[k] = (monthNew[k] || 0) + 1; });
        const keys377 = Object.keys(monthNew).sort().slice(-8);
        if (keys377.length < 3) return null;
        const maxNew = Math.max(...keys377.map(k => monthNew[k]), 1);
        const totalNew = keys377.reduce((s, k) => s + monthNew[k], 0);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">New Customer Acquisition</h3>
            <p className="text-xs text-gray-500 mb-4">{totalNew} new customers across shown period</p>
            <div className="flex items-end gap-2 h-24">
              {keys377.map(k => (
                <div key={k} className="flex-1 flex flex-col items-center gap-0.5">
                  <span className="text-[9px] text-gray-500">{monthNew[k]}</span>
                  <div className="w-full rounded-t-lg bg-fuchsia-400 transition-all" style={{height: `${Math.max((monthNew[k] / maxNew) * 72, 4)}px`}} />
                  <span className="text-[9px] text-gray-400">{k.slice(5)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 378: Monthly Avg Order Count per Customer (crm) ── */}
      {reportsTab === 'crm' && orders.length >= 8 && (() => {
        const toTs378 = (v: unknown): number => {
          if (!v) return 0;
          if (typeof (v as {toDate?:()=>Date}).toDate === 'function') return (v as {toDate:()=>Date}).toDate().getTime();
          return new Date(v as string|number).getTime();
        };
        const monthData378: Record<string, {orders: number; customers: Set<string>}> = {};
        orders.forEach(o => {
          const d = new Date(toTs378(o.createdAt));
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          if (!monthData378[key]) monthData378[key] = {orders: 0, customers: new Set()};
          monthData378[key].orders++;
          monthData378[key].customers.add(o.customerName || 'Unknown');
        });
        const keys378 = Object.keys(monthData378).sort().slice(-7);
        if (keys378.length < 3) return null;
        const avgPerCust = keys378.map(k => ({k, avg: monthData378[k].customers.size > 0 ? monthData378[k].orders / monthData378[k].customers.size : 0}));
        const maxAvg378 = Math.max(...avgPerCust.map(d => d.avg), 1);
        const overallAvg378 = avgPerCust.reduce((s, d) => s + d.avg, 0) / avgPerCust.length;
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Avg Orders per Customer / Month</h3>
            <p className="text-xs text-gray-500 mb-4">Purchase frequency trend · Avg: {overallAvg378.toFixed(2)} orders/customer</p>
            <div className="flex items-end gap-2 h-24">
              {avgPerCust.map((d, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                  <span className="text-[9px] text-gray-500">{d.avg.toFixed(1)}</span>
                  <div className="w-full rounded-t-lg transition-all" style={{height: `${Math.max((d.avg / maxAvg378) * 72, 4)}px`, background: d.avg >= overallAvg378 ? '#10b981' : '#6366f1'}} />
                  <span className="text-[9px] text-gray-400">{d.k.slice(5)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 379: Stock Value Change (envanter) ── */}
      {reportsTab === 'envanter' && inventoryMovements.length >= 5 && (() => {
        const toTs379 = (v: unknown): number => {
          if (!v) return 0;
          if (typeof (v as {toDate?:()=>Date}).toDate === 'function') return (v as {toDate:()=>Date}).toDate().getTime();
          return new Date(v as string|number).getTime();
        };
        const monthDelta: Record<string, number> = {};
        inventoryMovements.forEach(m => {
          const ts = toTs379(m.timestamp);
          if (!ts) return;
          const d = new Date(ts);
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          const item = inventory.find(i => i.name === m.productName);
          const cost = item?.costPrice || 0;
          const delta = (m.quantity || 0) * cost * (m.type === 'in' ? 1 : -1);
          monthDelta[key] = (monthDelta[key] || 0) + delta;
        });
        const keys379 = Object.keys(monthDelta).sort().slice(-7);
        if (keys379.length < 3) return null;
        const maxAbs = Math.max(...keys379.map(k => Math.abs(monthDelta[k])), 1);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Monthly Stock Value Change</h3>
            <p className="text-xs text-gray-500 mb-4">Net inventory cost value added (+) or consumed (−)</p>
            <div className="flex items-center gap-2 h-28">
              {keys379.map(k => {
                const val = monthDelta[k];
                const h = Math.max((Math.abs(val) / maxAbs) * 56, 4);
                return (
                  <div key={k} className="flex-1 flex flex-col items-center" style={{height: '112px', justifyContent: 'center'}}>
                    {val >= 0 ? (
                      <>
                        <div className="w-full rounded-t-lg bg-emerald-400" style={{height: `${h}px`}} />
                        <div className="w-full h-px bg-gray-200" />
                        <div className="w-full" style={{height: '56px'}} />
                      </>
                    ) : (
                      <>
                        <div className="w-full" style={{height: '56px'}} />
                        <div className="w-full h-px bg-gray-200" />
                        <div className="w-full rounded-b-lg bg-red-400" style={{height: `${h}px`}} />
                      </>
                    )}
                    <span className="text-[9px] text-gray-400 mt-0.5">{k.slice(5)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 380: Top 5 Revenue Days This Year (genel) ── */}
      {reportsTab === 'genel' && orders.length >= 5 && (() => {
        const toTs380 = (v: unknown): number => {
          if (!v) return 0;
          if (typeof (v as {toDate?:()=>Date}).toDate === 'function') return (v as {toDate:()=>Date}).toDate().getTime();
          return new Date(v as string|number).getTime();
        };
        const thisYear = new Date().getFullYear();
        const dayRev: Record<string, number> = {};
        orders.forEach(o => {
          const ts = toTs380(o.createdAt);
          if (!ts) return;
          const d = new Date(ts);
          if (d.getFullYear() !== thisYear) return;
          const key = d.toISOString().slice(0, 10);
          dayRev[key] = (dayRev[key] || 0) + (o.totalPrice || 0);
        });
        const top5 = Object.entries(dayRev).sort((a, b) => b[1] - a[1]).slice(0, 5);
        if (top5.length < 2) return null;
        const maxDay = top5[0][1];
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Top Revenue Days This Year</h3>
            <p className="text-xs text-gray-500 mb-4">Highest single-day revenue in {thisYear}</p>
            <div className="space-y-2">
              {top5.map(([date, rev], i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-[10px] font-bold text-gray-500 w-6">{i + 1}.</span>
                  <span className="text-xs text-gray-600 w-24">{new Date(date).toLocaleDateString('tr-TR', {day:'2-digit', month:'short'})}</span>
                  <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{width: `${(rev / maxDay) * 100}%`, background: i === 0 ? '#ff4000' : '#6366f1'}} />
                  </div>
                  <span className="text-xs font-bold w-24 text-right" style={{color: i === 0 ? '#ff4000' : '#6366f1'}}>{fmtAna(rev,'full',0)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 381: Customer Lifetime Value Tiers (crm) ── */}
      {reportsTab === 'crm' && orders.length >= 5 && (() => {
        const spend: Record<string, number> = {};
        orders.forEach(o => {
          const cid = (o as unknown as Record<string,unknown>).customerId as string | undefined
            || (o as unknown as Record<string,unknown>).customerName as string | undefined
            || 'Unknown';
          const oRec = o as unknown as Record<string,unknown>;
          const total = typeof oRec.total === 'number' ? oRec.total as number
            : (o.lineItems ?? []).reduce((s, li) => { const lr = li as unknown as Record<string,unknown>; return s + ((lr.quantity as number | undefined) ?? 0) * ((lr.unitPrice as number | undefined) ?? (lr.price as number | undefined) ?? 0); }, 0);
          spend[cid] = (spend[cid] ?? 0) + total;
        });
        const vals = Object.values(spend).sort((a, b) => b - a);
        if (vals.length < 3) return null;
        const tiers = [
          { label: 'Platinum', color: '#8b5cf6', min: vals[0] * 0.5 },
          { label: 'Gold',     color: '#f59e0b', min: vals[0] * 0.2 },
          { label: 'Silver',   color: '#6b7280', min: vals[0] * 0.05 },
          { label: 'Bronze',   color: '#b45309', min: 0 },
        ];
        const tierBuckets = tiers.map((t, i) => ({
          ...t,
          count: vals.filter(v => v >= t.min && (i === 0 || v < tiers[i - 1].min)).length,
        }));
        const maxC = Math.max(...tierBuckets.map(t => t.count), 1);
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">Customer Lifetime Value Tiers</h3>
            <div className="space-y-2">
              {tierBuckets.map(t => (
                <div key={t.label} className="flex items-center gap-2">
                  <span className="text-xs w-16 font-medium" style={{color: t.color}}>{t.label}</span>
                  <div className="flex-1 bg-gray-100 rounded-full h-5 overflow-hidden">
                    <div className="h-full rounded-full flex items-center pl-2 transition-all" style={{width: `${(t.count / maxC) * 100}%`, background: t.color}}>
                      <span className="text-white text-xs font-bold">{t.count > 0 ? t.count : ''}</span>
                    </div>
                  </div>
                  <span className="text-xs text-gray-500 w-10 text-right">{t.count} cust</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 382: Delivery Lead Time Distribution (lojistik) ── */}
      {reportsTab === 'lojistik' && orders.length >= 5 && (() => {
        const diffs: number[] = [];
        orders.forEach(o => {
          const created = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string)) : null;
          const delivered = (o as unknown as Record<string,unknown>).deliveredAt;
          if (!created || !delivered) return;
          const dDate = (delivered as {toDate?:()=>Date}).toDate?.() ?? new Date(delivered as string);
          const diff = Math.round((dDate.getTime() - created.getTime()) / 86400000);
          if (diff >= 0 && diff <= 30) diffs.push(diff);
        });
        if (diffs.length < 3) return null;
        const buckets = [0,1,2,3,5,7,10,15,20,30];
        const labels = ['0d','1d','2d','3d','4-5d','6-7d','8-10d','11-15d','16-20d','21-30d'];
        const counts = buckets.map((b, i) => ({
          label: labels[i],
          count: diffs.filter(d => d >= b && d < (buckets[i+1] ?? 31)).length,
        }));
        const maxC = Math.max(...counts.map(c => c.count), 1);
        const avg = (diffs.reduce((a,b) => a+b,0) / diffs.length).toFixed(1);
        return (
          <div className="apple-card p-4 mb-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-sm">Delivery Lead Time Distribution</h3>
              <span className="text-xs bg-blue-100 text-blue-700 rounded-full px-2 py-0.5">Avg {avg}d</span>
            </div>
            <div className="flex items-end gap-1 h-24">
              {counts.map(c => (
                <div key={c.label} className="flex-1 flex flex-col items-center gap-0.5">
                  <div className="w-full rounded-sm transition-all" style={{height: `${(c.count / maxC) * 80}px`, background: '#3b82f6', minHeight: c.count > 0 ? 2 : 0}} />
                  <span className="text-[9px] text-gray-400">{c.label}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 383: Quote-to-Order Conversion by Month (crm) ── */}
      {reportsTab === 'crm' && quotations.length >= 3 && orders.length >= 3 && (() => {
        const monthOrders: Record<string, Set<string>> = {};
        orders.forEach(o => {
          const d = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string)) : null;
          if (!d) return;
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          if (!monthOrders[key]) monthOrders[key] = new Set();
          const qid = (o as unknown as Record<string,unknown>).quotationId as string | undefined;
          if (qid) monthOrders[key].add(qid);
        });
        const monthQuotes: Record<string, number> = {};
        quotations.forEach(q => {
          const d = q.createdAt ? ((q.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(q.createdAt as string)) : null;
          if (!d) return;
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          monthQuotes[key] = (monthQuotes[key] ?? 0) + 1;
        });
        const months = Object.keys(monthQuotes).sort().slice(-6);
        if (months.length < 2) return null;
        const rows = months.map(m => ({
          month: m.slice(5),
          quotes: monthQuotes[m] ?? 0,
          converted: (monthOrders[m]?.size ?? 0),
          rate: monthQuotes[m] > 0 ? Math.round(((monthOrders[m]?.size ?? 0) / monthQuotes[m]) * 100) : 0,
        }));
        const maxR = Math.max(...rows.map(r => r.rate), 1);
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">Quote → Order Conversion Rate by Month</h3>
            <div className="flex items-end gap-2 h-24 mb-1">
              {rows.map(r => (
                <div key={r.month} className="flex-1 flex flex-col items-center gap-0.5">
                  <span className="text-[9px] text-gray-500">{r.rate}%</span>
                  <div className="w-full rounded-sm" style={{height: `${(r.rate / maxR) * 64}px`, background: r.rate >= 50 ? '#22c55e' : r.rate >= 25 ? '#f59e0b' : '#ef4444', minHeight: r.rate > 0 ? 2 : 0}} />
                  <span className="text-[9px] text-gray-400">{r.month}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 384: Slow-Mover Alert List (envanter) ── */}
      {reportsTab === 'envanter' && inventory.length >= 5 && inventoryMovements.length >= 3 && (() => {
        const now = new Date();
        const lastMove: Record<string, Date> = {};
        inventoryMovements.forEach(m => {
          const d = m.date ? ((m.date as {toDate?:()=>Date}).toDate?.() ?? new Date(m.date as string)) : null;
          if (!d) return;
          const pid = m.productId as string;
          if (!lastMove[pid] || d > lastMove[pid]) lastMove[pid] = d;
        });
        const slowMovers = inventory
          .map(item => ({
            name: item.name,
            sku: item.sku ?? '',
            stock: (item.stock as number | undefined) ?? 0,
            daysSince: lastMove[item.id] ? Math.floor((now.getTime() - lastMove[item.id].getTime()) / 86400000) : 999,
          }))
          .filter(i => i.daysSince >= 30 && i.stock > 0)
          .sort((a, b) => b.daysSince - a.daysSince)
          .slice(0, 8);
        if (slowMovers.length === 0) return null;
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
              <span>⚠️ Slow-Mover Alert</span>
              <span className="text-xs bg-orange-100 text-orange-700 rounded-full px-2 py-0.5">{slowMovers.length} items</span>
            </h3>
            <div className="space-y-1.5">
              {slowMovers.map((item, i) => (
                <div key={i} className="flex items-center justify-between text-xs">
                  <span className="truncate flex-1 text-gray-700">{item.name}</span>
                  <span className="ml-2 text-gray-400">×{String(item.stock)}</span>
                  <span className="ml-2 font-bold" style={{color: item.daysSince >= 90 ? '#ef4444' : item.daysSince >= 60 ? '#f59e0b' : '#6b7280'}}>{item.daysSince}d</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 385: Headcount Growth by Month (ik) ── */}
      {reportsTab === 'ik' && employees.length >= 3 && (() => {
        const joinByMonth: Record<string, number> = {};
        employees.forEach(e => {
          const d = e.startDate ? ((e.startDate as unknown as {toDate?:()=>Date}).toDate?.() ?? new Date(e.startDate as string)) : null;
          if (!d || isNaN(d.getTime())) return;
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          joinByMonth[key] = (joinByMonth[key] ?? 0) + 1;
        });
        const months = Object.keys(joinByMonth).sort().slice(-9);
        if (months.length < 2) return null;
        let cumulative = 0;
        const rows = months.map(m => { cumulative += joinByMonth[m]; return { month: m.slice(5), new: joinByMonth[m], total: cumulative }; });
        // Reset and properly calculate cumulative
        const allBefore = employees.filter(e => {
          const d = e.startDate ? ((e.startDate as unknown as {toDate?:()=>Date}).toDate?.() ?? new Date(e.startDate as string)) : null;
          if (!d || isNaN(d.getTime())) return false;
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          return key < months[0];
        }).length;
        let running = allBefore;
        const finalRows = months.map(m => { running += joinByMonth[m]; return { month: m.slice(5), new: joinByMonth[m], cumulative: running }; });
        const maxC = Math.max(...finalRows.map(r => r.cumulative), 1);
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">Headcount Growth by Month</h3>
            <div className="flex items-end gap-2 h-24 mb-1">
              {finalRows.map(r => (
                <div key={r.month} className="flex-1 flex flex-col items-center gap-0.5">
                  <div className="w-full rounded-sm transition-all" style={{height: `${(r.cumulative / maxC) * 80}px`, background: '#6366f1'}} />
                  <span className="text-[9px] text-gray-400">{r.month}</span>
                </div>
              ))}
            </div>
            <div className="flex justify-between text-xs text-gray-500 mt-1">
              <span>+{finalRows.reduce((s,r) => s + r.new, 0)} in period</span>
              <span>Total: {finalRows[finalRows.length-1]?.cumulative ?? 0}</span>
            </div>
          </div>
        );
      })()}

      {/* ── Phase 386: Weekly Revenue Heatmap (genel) ── */}
      {reportsTab === 'genel' && orders.length >= 10 && (() => {
        const days = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
        const matrix: number[][] = Array.from({length: 7}, () => [0,0,0,0]);
        orders.forEach(o => {
          const d = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string)) : null;
          if (!d) return;
          const dow = (d.getDay() + 6) % 7; // 0=Mon
          const weekOfMonth = Math.min(Math.floor((d.getDate() - 1) / 7), 3);
          const oRec386 = o as unknown as Record<string,unknown>;
          const total = typeof oRec386.total === 'number' ? oRec386.total as number
            : (o.lineItems ?? []).reduce((s, li) => { const lr = li as unknown as Record<string,unknown>; return s + ((lr.quantity as number | undefined) ?? 0) * ((lr.unitPrice as number | undefined) ?? (lr.price as number | undefined) ?? 0); }, 0);
          matrix[dow][weekOfMonth] += total;
        });
        const allVals = matrix.flat();
        const maxV = Math.max(...allVals, 1);
        const weeks = ['W1','W2','W3','W4'];
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">Revenue Heatmap (Day × Week)</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr>
                    <th className="text-left text-gray-400 font-normal pr-2 pb-1 w-8"></th>
                    {weeks.map(w => <th key={w} className="text-gray-400 font-normal pb-1 px-1">{w}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {days.map((day, di) => (
                    <tr key={day}>
                      <td className="text-gray-500 font-medium pr-2 py-0.5">{day}</td>
                      {matrix[di].map((v, wi) => {
                        const intensity = v / maxV;
                        return (
                          <td key={wi} className="px-1 py-0.5">
                            <div className="rounded w-full h-5 flex items-center justify-center text-[9px] font-medium" style={{background: v > 0 ? `rgba(255,64,0,${0.15 + intensity * 0.85})` : '#f3f4f6', color: intensity > 0.5 ? 'white' : '#374151'}}>
                              {v > 0 ? (v >= 1000 ? `${(v/1000).toFixed(0)}k` : v.toFixed(0)) : ''}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}

      {/* ── Phase 387: Order Cancellation Rate by Month (crm) ── */}
      {reportsTab === 'crm' && orders.length >= 5 && (() => {
        const byMonth: Record<string, {total: number; cancelled: number}> = {};
        orders.forEach(o => {
          const d = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string)) : null;
          if (!d) return;
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          if (!byMonth[key]) byMonth[key] = {total: 0, cancelled: 0};
          byMonth[key].total++;
          if (o.status === 'Cancelled' || (o.status as string) === 'İptal') byMonth[key].cancelled++;
        });
        const months = Object.keys(byMonth).sort().slice(-6);
        if (months.length < 2) return null;
        const rows = months.map(m => ({
          month: m.slice(5),
          rate: byMonth[m].total > 0 ? Math.round((byMonth[m].cancelled / byMonth[m].total) * 100) : 0,
          total: byMonth[m].total,
          cancelled: byMonth[m].cancelled,
        }));
        const maxR = Math.max(...rows.map(r => r.rate), 1);
        const totalCancelled = rows.reduce((s, r) => s + r.cancelled, 0);
        const totalOrders = rows.reduce((s, r) => s + r.total, 0);
        const overallRate = totalOrders > 0 ? ((totalCancelled / totalOrders) * 100).toFixed(1) : '0';
        return (
          <div className="apple-card p-4 mb-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-sm">Order Cancellation Rate</h3>
              <span className="text-xs bg-red-100 text-red-700 rounded-full px-2 py-0.5">{overallRate}% overall</span>
            </div>
            <div className="flex items-end gap-2 h-20 mb-1">
              {rows.map(r => (
                <div key={r.month} className="flex-1 flex flex-col items-center gap-0.5">
                  <span className="text-[9px] text-gray-500">{r.rate}%</span>
                  <div className="w-full rounded-sm" style={{height: `${(r.rate / maxR) * 56}px`, background: r.rate >= 20 ? '#ef4444' : r.rate >= 10 ? '#f59e0b' : '#22c55e', minHeight: r.rate > 0 ? 2 : 0}} />
                  <span className="text-[9px] text-gray-400">{r.month}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 388: Items Below Reorder Point (envanter) ── */}
      {reportsTab === 'envanter' && inventory.length >= 5 && (() => {
        const atRisk = inventory
          .map(item => {
            const rp = (item.reorderPoint as number | undefined) ?? (item.lowStockThreshold as number | undefined) ?? 5;
            const stk = (item.stock as number | undefined) ?? 0;
            return { name: item.name, stock: stk, reorderPoint: rp, gap: rp - stk };
          })
          .filter(i => i.gap > 0)
          .sort((a, b) => b.gap - a.gap)
          .slice(0, 8);
        if (atRisk.length === 0) return (
          <div className="apple-card p-4 mb-4 flex items-center gap-2">
            <span className="text-green-500 text-lg">✓</span>
            <div>
              <p className="text-sm font-semibold text-green-700">All items above reorder point</p>
              <p className="text-xs text-gray-500">No restocking needed right now</p>
            </div>
          </div>
        );
        const maxGap = Math.max(...atRisk.map(i => i.gap), 1);
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
              <span>🔴 Below Reorder Point</span>
              <span className="text-xs bg-red-100 text-red-700 rounded-full px-2 py-0.5">{atRisk.length} items</span>
            </h3>
            <div className="space-y-2">
              {atRisk.map((item, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-xs truncate flex-1 text-gray-700">{item.name}</span>
                  <div className="w-20 bg-gray-100 rounded-full h-3 overflow-hidden">
                    <div className="h-full rounded-full" style={{width: `${(item.gap / maxGap) * 100}%`, background: '#ef4444'}} />
                  </div>
                  <span className="text-xs font-bold text-red-600 w-12 text-right">-{item.gap}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 389: Order Line Item Count Distribution (lojistik) ── */}
      {reportsTab === 'lojistik' && orders.length >= 5 && (() => {
        const bucketLabels = ['1','2','3','4','5','6-10','11+'];
        const bucketCounts = [0,0,0,0,0,0,0];
        orders.forEach(o => {
          const n = (o.lineItems ?? []).length;
          if (n === 0) return;
          if (n <= 5) bucketCounts[n-1]++;
          else if (n <= 10) bucketCounts[5]++;
          else bucketCounts[6]++;
        });
        const maxC = Math.max(...bucketCounts, 1);
        const totalOrders = bucketCounts.reduce((a,b) => a+b, 0);
        if (totalOrders < 3) return null;
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">Orders by Line Item Count</h3>
            <div className="flex items-end gap-2 h-24 mb-1">
              {bucketLabels.map((label, i) => (
                <div key={label} className="flex-1 flex flex-col items-center gap-0.5">
                  <span className="text-[9px] text-gray-500">{bucketCounts[i] > 0 ? bucketCounts[i] : ''}</span>
                  <div className="w-full rounded-sm transition-all" style={{height: `${(bucketCounts[i] / maxC) * 72}px`, background: '#0ea5e9', minHeight: bucketCounts[i] > 0 ? 2 : 0}} />
                  <span className="text-[9px] text-gray-400">{label}</span>
                </div>
              ))}
            </div>
            <p className="text-xs text-gray-400 text-center">items per order</p>
          </div>
        );
      })()}

      {/* ── Phase 390: MoM Revenue Growth Rate (genel) ── */}
      {reportsTab === 'genel' && orders.length >= 10 && (() => {
        const byMonth: Record<string, number> = {};
        orders.forEach(o => {
          const d = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string)) : null;
          if (!d) return;
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          const oRec390 = o as unknown as Record<string,unknown>;
          const total = typeof oRec390.total === 'number' ? oRec390.total as number
            : (o.lineItems ?? []).reduce((s, li) => { const lr = li as unknown as Record<string,unknown>; return s + ((lr.quantity as number | undefined) ?? 0) * ((lr.unitPrice as number | undefined) ?? (lr.price as number | undefined) ?? 0); }, 0);
          byMonth[key] = (byMonth[key] ?? 0) + total;
        });
        const months = Object.keys(byMonth).sort().slice(-7);
        if (months.length < 3) return null;
        const growthRows = months.slice(1).map((m, i) => {
          const prev = byMonth[months[i]];
          const curr = byMonth[m];
          const pct = prev > 0 ? ((curr - prev) / prev) * 100 : 0;
          return { month: m.slice(5), pct };
        });
        const maxAbs = Math.max(...growthRows.map(r => Math.abs(r.pct)), 1);
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">Month-over-Month Revenue Growth</h3>
            <div className="relative h-28">
              <div className="absolute inset-x-0" style={{top: '50%', height: 1, background: '#e5e7eb'}} />
              <div className="flex items-center h-full gap-2">
                {growthRows.map(r => {
                  const barH = (Math.abs(r.pct) / maxAbs) * 48;
                  const isPos = r.pct >= 0;
                  return (
                    <div key={r.month} className="flex-1 flex flex-col items-center">
                      {isPos ? (
                        <>
                          <div className="flex-1 flex items-end justify-center pb-0.5">
                            <div style={{height: `${barH}px`, background: '#22c55e', width: '70%', borderRadius: '3px 3px 0 0'}} />
                          </div>
                          <span className="text-[9px] font-bold text-green-600">+{r.pct.toFixed(0)}%</span>
                          <div className="flex-1" />
                        </>
                      ) : (
                        <>
                          <div className="flex-1" />
                          <span className="text-[9px] font-bold text-red-500">{r.pct.toFixed(0)}%</span>
                          <div className="flex-1 flex items-start justify-center pt-0.5">
                            <div style={{height: `${barH}px`, background: '#ef4444', width: '70%', borderRadius: '0 0 3px 3px'}} />
                          </div>
                        </>
                      )}
                      <span className="text-[9px] text-gray-400 mt-1">{r.month}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Phase 391: This Month Revenue vs Last Month (genel) ── */}
      {reportsTab === 'genel' && orders.length >= 5 && (() => {
        const now = new Date();
        const thisMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
        const lastDate = new Date(now.getFullYear(), now.getMonth()-1, 1);
        const lastMonth = `${lastDate.getFullYear()}-${String(lastDate.getMonth()+1).padStart(2,'0')}`;
        let thisMRev = 0, lastMRev = 0;
        orders.forEach(o => {
          const d = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string)) : null;
          if (!d) return;
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          const oR = o as unknown as Record<string,unknown>;
          const total = typeof oR.total === 'number' ? oR.total as number
            : (o.lineItems ?? []).reduce((s, li) => { const lr = li as unknown as Record<string,unknown>; return s + ((lr.quantity as number|undefined)??0) * ((lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0); }, 0);
          if (key === thisMonth) thisMRev += total;
          if (key === lastMonth) lastMRev += total;
        });
        if (thisMRev === 0 && lastMRev === 0) return null;
        const pct = lastMRev > 0 ? ((thisMRev - lastMRev) / lastMRev) * 100 : 0;
        const gaugeVal = lastMRev > 0 ? Math.min(thisMRev / lastMRev, 2) : 1;
        const r = 40; const cx = 60; const cy = 55;
        const rad = (a: number) => (a - 90) * Math.PI / 180;
        const arc = (pct2: number, color: string) => {
          const end = Math.min(pct2, 1) * 180;
          const x1 = cx + r * Math.cos(rad(-90)); const y1 = cy + r * Math.sin(rad(-90));
          const x2 = cx + r * Math.cos(rad(-90 + end)); const y2 = cy + r * Math.sin(rad(-90 + end));
          return end > 0 ? `M ${x1} ${y1} A ${r} ${r} 0 ${end > 180 ? 1 : 0} 1 ${x2} ${y2}` : '';
        };
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-1">This Month vs Last Month</h3>
            <div className="flex items-center gap-4">
              <svg width="120" height="70" viewBox="0 0 120 70">
                <path d={arc(1, '#e5e7eb')} fill="none" stroke="#e5e7eb" strokeWidth="10" strokeLinecap="round" />
                <path d={arc(gaugeVal, pct >= 0 ? '#22c55e' : '#ef4444')} fill="none" stroke={pct >= 0 ? '#22c55e' : '#ef4444'} strokeWidth="10" strokeLinecap="round" />
                <text x={cx} y={cy+8} textAnchor="middle" fontSize="11" fontWeight="bold" fill={pct >= 0 ? '#22c55e' : '#ef4444'}>{pct >= 0 ? '+' : ''}{pct.toFixed(0)}%</text>
              </svg>
              <div className="flex-1 space-y-1">
                <div className="flex justify-between text-xs"><span className="text-gray-500">This month</span><span className="font-bold">{fmtAna(thisMRev,'full',0)}</span></div>
                <div className="flex justify-between text-xs"><span className="text-gray-500">Last month</span><span className="text-gray-700">{fmtAna(lastMRev,'full',0)}</span></div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Phase 392: Avg Days Between Orders (crm) ── */}
      {reportsTab === 'crm' && orders.length >= 10 && (() => {
        const ordersByCustomer: Record<string, Date[]> = {};
        orders.forEach(o => {
          const d = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string)) : null;
          if (!d) return;
          const cid = (o as unknown as Record<string,unknown>).customerId as string | undefined
            || (o as unknown as Record<string,unknown>).customerName as string | undefined
            || 'Unknown';
          if (!ordersByCustomer[cid]) ordersByCustomer[cid] = [];
          ordersByCustomer[cid].push(d);
        });
        const gaps: number[] = [];
        Object.values(ordersByCustomer).forEach(dates => {
          if (dates.length < 2) return;
          dates.sort((a, b) => a.getTime() - b.getTime());
          for (let i = 1; i < dates.length; i++) {
            const gap = Math.round((dates[i].getTime() - dates[i-1].getTime()) / 86400000);
            if (gap > 0 && gap <= 365) gaps.push(gap);
          }
        });
        if (gaps.length < 3) return null;
        const avg = gaps.reduce((a,b) => a+b, 0) / gaps.length;
        const buckets = [[1,7,'1-7d'],[8,14,'8-14d'],[15,30,'15-30d'],[31,60,'1-2mo'],[61,90,'2-3mo'],[91,365,'3mo+']];
        const counts = buckets.map(([lo,hi,lbl]) => ({ label: lbl as string, count: gaps.filter(g => g >= (lo as number) && g <= (hi as number)).length }));
        const maxC = Math.max(...counts.map(c => c.count), 1);
        return (
          <div className="apple-card p-4 mb-4">
            <div className="flex justify-between items-center mb-3">
              <h3 className="font-semibold text-sm">Avg Days Between Orders</h3>
              <span className="text-xs bg-purple-100 text-purple-700 rounded-full px-2 py-0.5">{avg.toFixed(0)}d avg</span>
            </div>
            <div className="flex items-end gap-2 h-20 mb-1">
              {counts.map(c => (
                <div key={c.label} className="flex-1 flex flex-col items-center gap-0.5">
                  <span className="text-[9px] text-gray-500">{c.count > 0 ? c.count : ''}</span>
                  <div className="w-full rounded-sm" style={{height: `${(c.count / maxC) * 56}px`, background: '#a78bfa', minHeight: c.count > 0 ? 2 : 0}} />
                  <span className="text-[9px] text-gray-400">{c.label}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 393: Category Margin Analysis (envanter) ── */}
      {reportsTab === 'envanter' && inventory.length >= 5 && (() => {
        const catData: Record<string, {cost: number; retail: number; count: number}> = {};
        inventory.forEach(item => {
          const cat = item.category ?? 'Other';
          const retail = (item.prices?.['Retail'] as number | undefined) ?? (item.prices?.['B2B Standard'] as number | undefined) ?? 0;
          const cost = itemCostTRY(item, exchangeRates) || retail * 0.6;
          if (!catData[cat]) catData[cat] = {cost: 0, retail: 0, count: 0};
          catData[cat].retail += retail;
          catData[cat].cost += cost;
          catData[cat].count++;
        });
        const rows = Object.entries(catData)
          .map(([cat, d]) => ({ cat, margin: d.retail > 0 ? ((d.retail - d.cost) / d.retail) * 100 : 0, count: d.count }))
          .filter(r => r.margin > 0)
          .sort((a, b) => b.margin - a.margin)
          .slice(0, 6);
        if (rows.length < 2) return null;
        const maxM = Math.max(...rows.map(r => r.margin), 1);
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">Category Margin Analysis</h3>
            <div className="space-y-2">
              {rows.map(r => (
                <div key={r.cat} className="flex items-center gap-2">
                  <span className="text-xs truncate w-24 text-gray-700">{r.cat}</span>
                  <div className="flex-1 bg-gray-100 rounded-full h-4 overflow-hidden">
                    <div className="h-full rounded-full flex items-center pl-2" style={{width: `${(r.margin / maxM) * 100}%`, background: r.margin >= 40 ? '#22c55e' : r.margin >= 20 ? '#f59e0b' : '#ef4444'}}>
                      <span className="text-white text-[9px] font-bold">{r.margin.toFixed(0)}%</span>
                    </div>
                  </div>
                  <span className="text-[9px] text-gray-400 w-8 text-right">{r.count}×</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 394: Orders by Status Breakdown (lojistik) ── */}
      {reportsTab === 'lojistik' && orders.length >= 5 && (() => {
        const statusCounts: Record<string, number> = {};
        orders.forEach(o => { statusCounts[o.status] = (statusCounts[o.status] ?? 0) + 1; });
        const total = orders.length;
        const statusColors: Record<string, string> = {
          'Pending': '#f59e0b', 'Processing': '#3b82f6', 'Shipped': '#8b5cf6',
          'Delivered': '#22c55e', 'Cancelled': '#ef4444',
        };
        const rows = Object.entries(statusCounts).sort((a, b) => b[1] - a[1]);
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">Orders by Status</h3>
            <div className="flex h-4 rounded-full overflow-hidden mb-3">
              {rows.map(([status, count]) => (
                <div key={status} style={{width: `${(count / total) * 100}%`, background: statusColors[status] ?? '#6b7280'}} title={`${status}: ${count}`} />
              ))}
            </div>
            <div className="grid grid-cols-2 gap-1">
              {rows.map(([status, count]) => (
                <div key={status} className="flex items-center gap-1.5 text-xs">
                  <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{background: statusColors[status] ?? '#6b7280'}} />
                  <span className="text-gray-600 truncate">{status}</span>
                  <span className="ml-auto font-medium">{count}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 395: Dept Headcount & Avg Salary (ik) ── */}
      {reportsTab === 'ik' && employees.length >= 3 && (() => {
        const deptData: Record<string, {count: number; salarySum: number}> = {};
        employees.forEach(e => {
          const dept = e.department ?? 'Other';
          if (!deptData[dept]) deptData[dept] = {count: 0, salarySum: 0};
          deptData[dept].count++;
          const sal = (e as unknown as Record<string,unknown>).salary as number | undefined
            || (e as unknown as Record<string,unknown>).baseSalary as number | undefined
            || (e as unknown as Record<string,unknown>).monthlySalary as number | undefined
            || 0;
          deptData[dept].salarySum += sal;
        });
        const rows = Object.entries(deptData).sort((a, b) => b[1].count - a[1].count).slice(0, 6);
        if (rows.length === 0) return null;
        const maxCount = Math.max(...rows.map(r => r[1].count), 1);
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">Headcount by Department</h3>
            <div className="space-y-2">
              {rows.map(([dept, d]) => (
                <div key={dept} className="flex items-center gap-2">
                  <span className="text-xs truncate w-20 text-gray-700">{dept}</span>
                  <div className="flex-1 bg-gray-100 rounded-full h-4 overflow-hidden">
                    <div className="h-full rounded-full flex items-center pl-2" style={{width: `${(d.count / maxCount) * 100}%`, background: '#6366f1'}}>
                      <span className="text-white text-[9px] font-bold">{d.count}</span>
                    </div>
                  </div>
                  {d.salarySum > 0 && <span className="text-[9px] text-gray-400 w-16 text-right">avg {fmtAna(Math.round(d.salarySum / d.count))}</span>}
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 396: Top 5 Customers by Order Count (crm) ── */}
      {reportsTab === 'crm' && orders.length >= 5 && (() => {
        const custOrders: Record<string, {count: number; revenue: number}> = {};
        orders.forEach(o => {
          const cid = (o as unknown as Record<string,unknown>).customerId as string | undefined
            || (o as unknown as Record<string,unknown>).customerName as string | undefined
            || 'Unknown';
          const oR = o as unknown as Record<string,unknown>;
          const total = typeof oR.total === 'number' ? oR.total as number
            : (o.lineItems ?? []).reduce((s, li) => { const lr = li as unknown as Record<string,unknown>; return s + ((lr.quantity as number|undefined)??0) * ((lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0); }, 0);
          if (!custOrders[cid]) custOrders[cid] = {count: 0, revenue: 0};
          custOrders[cid].count++;
          custOrders[cid].revenue += total;
        });
        const top5 = Object.entries(custOrders).sort((a, b) => b[1].count - a[1].count).slice(0, 5);
        if (top5.length === 0) return null;
        const maxC = top5[0][1].count;
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">Top 5 Customers by Order Count</h3>
            <div className="space-y-2">
              {top5.map(([name, d], i) => (
                <div key={name} className="flex items-center gap-2">
                  <span className="text-xs font-bold w-4 text-gray-400">#{i+1}</span>
                  <span className="text-xs truncate flex-1 text-gray-700">{name}</span>
                  <div className="w-20 bg-gray-100 rounded-full h-3 overflow-hidden">
                    <div className="h-full rounded-full" style={{width: `${(d.count / maxC) * 100}%`, background: '#ff4000'}} />
                  </div>
                  <span className="text-xs font-bold w-8 text-right text-brand">{d.count}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 397: Inventory Health Summary (envanter) ── */}
      {reportsTab === 'envanter' && inventory.length >= 3 && (() => {
        let inStock = 0, lowStock = 0, outOfStock = 0;
        inventory.forEach(item => {
          const stk = (item.stock as number | undefined) ?? 0;
          const threshold = (item.reorderPoint as number | undefined) ?? (item.lowStockThreshold as number | undefined) ?? 5;
          if (stk === 0) outOfStock++;
          else if (stk <= threshold) lowStock++;
          else inStock++;
        });
        const total = inventory.length;
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">Inventory Health Summary</h3>
            <div className="flex h-3 rounded-full overflow-hidden mb-3">
              <div style={{width: `${(inStock/total)*100}%`, background: '#22c55e'}} />
              <div style={{width: `${(lowStock/total)*100}%`, background: '#f59e0b'}} />
              <div style={{width: `${(outOfStock/total)*100}%`, background: '#ef4444'}} />
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              {[{label:'In Stock',count:inStock,color:'#22c55e'},{label:'Low',count:lowStock,color:'#f59e0b'},{label:'Out',count:outOfStock,color:'#ef4444'}].map(s => (
                <div key={s.label} className="rounded-xl p-2" style={{background: `${s.color}15`}}>
                  <p className="text-xl font-bold" style={{color: s.color}}>{s.count}</p>
                  <p className="text-[10px] text-gray-500">{s.label}</p>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 398: First Order vs Repeat Order Avg Value (crm) ── */}
      {reportsTab === 'crm' && orders.length >= 8 && (() => {
        const custFirstOrder: Record<string, {date: Date; value: number}> = {};
        const allCustomerOrders: Record<string, {date: Date; value: number}[]> = {};
        orders.forEach(o => {
          const d = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string)) : null;
          if (!d) return;
          const cid = (o as unknown as Record<string,unknown>).customerId as string | undefined
            || (o as unknown as Record<string,unknown>).customerName as string | undefined
            || 'Unknown';
          const oR = o as unknown as Record<string,unknown>;
          const total = typeof oR.total === 'number' ? oR.total as number
            : (o.lineItems ?? []).reduce((s, li) => { const lr = li as unknown as Record<string,unknown>; return s + ((lr.quantity as number|undefined)??0) * ((lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0); }, 0);
          if (!allCustomerOrders[cid]) allCustomerOrders[cid] = [];
          allCustomerOrders[cid].push({date: d, value: total});
        });
        const firstOrderVals: number[] = [];
        const repeatOrderVals: number[] = [];
        Object.values(allCustomerOrders).forEach(oList => {
          oList.sort((a, b) => a.date.getTime() - b.date.getTime());
          if (oList.length > 0) firstOrderVals.push(oList[0].value);
          if (oList.length > 1) oList.slice(1).forEach(o => repeatOrderVals.push(o.value));
        });
        if (firstOrderVals.length < 2) return null;
        const avgFirst = firstOrderVals.reduce((a,b) => a+b, 0) / firstOrderVals.length;
        const avgRepeat = repeatOrderVals.length > 0 ? repeatOrderVals.reduce((a,b) => a+b, 0) / repeatOrderVals.length : 0;
        const maxVal = Math.max(avgFirst, avgRepeat, 1);
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">First vs Repeat Order Value</h3>
            <div className="space-y-3">
              {[{label:'1st Order Avg', val: avgFirst, color: '#3b82f6', n: firstOrderVals.length},
                {label:'Repeat Avg', val: avgRepeat, color: '#22c55e', n: repeatOrderVals.length}].map(r => (
                <div key={r.label}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-gray-600">{r.label}</span>
                    <span className="font-bold" style={{color: r.color}}>{fmtAna(r.val,'full',0)} <span className="font-normal text-gray-400">({r.n})</span></span>
                  </div>
                  <div className="bg-gray-100 rounded-full h-3 overflow-hidden">
                    <div className="h-full rounded-full" style={{width: `${(r.val / maxVal) * 100}%`, background: r.color}} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 399: Recurring vs One-Time Orders (lojistik) ── */}
      {reportsTab === 'lojistik' && orders.length >= 5 && (() => {
        const customerOrderCounts: Record<string, number> = {};
        orders.forEach(o => {
          const cid = (o as unknown as Record<string,unknown>).customerId as string | undefined
            || (o as unknown as Record<string,unknown>).customerName as string | undefined
            || 'Unknown';
          customerOrderCounts[cid] = (customerOrderCounts[cid] ?? 0) + 1;
        });
        const oneTime = Object.values(customerOrderCounts).filter(c => c === 1).length;
        const returning = Object.values(customerOrderCounts).filter(c => c >= 2 && c <= 5).length;
        const loyal = Object.values(customerOrderCounts).filter(c => c > 5).length;
        const total = oneTime + returning + loyal;
        if (total === 0) return null;
        const segments = [
          {label: 'One-time', count: oneTime, color: '#94a3b8'},
          {label: 'Returning (2-5)', count: returning, color: '#3b82f6'},
          {label: 'Loyal (6+)', count: loyal, color: '#ff4000'},
        ];
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">Customer Purchase Frequency</h3>
            <div className="flex h-5 rounded-full overflow-hidden mb-3">
              {segments.map(s => s.count > 0 && (
                <div key={s.label} style={{width: `${(s.count/total)*100}%`, background: s.color}} title={`${s.label}: ${s.count}`} />
              ))}
            </div>
            <div className="space-y-1">
              {segments.map(s => (
                <div key={s.label} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-full" style={{background: s.color}} />
                    <span className="text-gray-600">{s.label}</span>
                  </div>
                  <span className="font-bold">{s.count} <span className="font-normal text-gray-400">({total > 0 ? Math.round((s.count/total)*100) : 0}%)</span></span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 400: Sales Milestone Tracker (genel) ── */}
      {reportsTab === 'genel' && orders.length >= 1 && (() => {
        const totalOrders = orders.length;
        let totalRevenue = 0;
        orders.forEach(o => {
          const oR = o as unknown as Record<string,unknown>;
          totalRevenue += typeof oR.total === 'number' ? oR.total as number
            : (o.lineItems ?? []).reduce((s, li) => { const lr = li as unknown as Record<string,unknown>; return s + ((lr.quantity as number|undefined)??0) * ((lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0); }, 0);
        });
        const orderMilestones = [10,50,100,250,500,1000,5000];
        const revMilestones = [100000,500000,1000000,5000000,10000000];
        const oMilestone = orderMilestones.find(m => totalOrders < m) ?? orderMilestones[orderMilestones.length-1];
        const rMilestone = revMilestones.find(m => totalRevenue < m) ?? revMilestones[revMilestones.length-1];
        const oPct = Math.min((totalOrders / oMilestone) * 100, 100);
        const rPct = Math.min((totalRevenue / rMilestone) * 100, 100);
        const prevO = orderMilestones[orderMilestones.indexOf(oMilestone) - 1] ?? 0;
        const prevR = revMilestones[revMilestones.indexOf(rMilestone) - 1] ?? 0;
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">🏆 Sales Milestones</h3>
            <div className="space-y-4">
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-gray-600">Total Orders</span>
                  <span className="font-bold">{totalOrders} <span className="text-gray-400">/ {oMilestone}</span></span>
                </div>
                <div className="bg-gray-100 rounded-full h-3 overflow-hidden">
                  <div className="h-full rounded-full transition-all" style={{width: `${oPct}%`, background: 'linear-gradient(90deg, #ff4000, #ff8c00)'}} />
                </div>
                <div className="flex justify-between text-[9px] text-gray-400 mt-0.5">
                  <span>{prevO}</span><span>{oMilestone}</span>
                </div>
              </div>
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-gray-600">Total Revenue</span>
                  <span className="font-bold">{fmtAna(totalRevenue,'K',0)} <span className="text-gray-400">/ {fmtAna(rMilestone,'K',0)}</span></span>
                </div>
                <div className="bg-gray-100 rounded-full h-3 overflow-hidden">
                  <div className="h-full rounded-full transition-all" style={{width: `${rPct}%`, background: 'linear-gradient(90deg, #6366f1, #a78bfa)'}} />
                </div>
                <div className="flex justify-between text-[9px] text-gray-400 mt-0.5">
                  <span>{fmtAna(prevR,'K',0)}</span><span>{fmtAna(rMilestone,'K',0)}</span>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Phase 401: YTD Revenue Breakdown by Quarter (genel) ── */}
      {reportsTab === 'genel' && orders.length >= 5 && (() => {
        const now = new Date();
        const year = now.getFullYear();
        const quarters: Record<string, number> = {Q1: 0, Q2: 0, Q3: 0, Q4: 0};
        orders.forEach(o => {
          const d = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string)) : null;
          if (!d || d.getFullYear() !== year) return;
          const q = `Q${Math.ceil((d.getMonth()+1)/3)}`;
          const oR = o as unknown as Record<string,unknown>;
          const total = typeof oR.total === 'number' ? oR.total as number
            : (o.lineItems ?? []).reduce((s, li) => { const lr = li as unknown as Record<string,unknown>; return s + ((lr.quantity as number|undefined)??0) * ((lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0); }, 0);
          quarters[q] += total;
        });
        const ytdTotal = Object.values(quarters).reduce((a,b) => a+b, 0);
        if (ytdTotal === 0) return null;
        const maxQ = Math.max(...Object.values(quarters), 1);
        const qColors = {Q1:'#3b82f6',Q2:'#f59e0b',Q3:'#22c55e',Q4:'#ff4000'};
        return (
          <div className="apple-card p-4 mb-4">
            <div className="flex justify-between items-center mb-3">
              <h3 className="font-semibold text-sm">YTD Revenue by Quarter ({year})</h3>
              <span className="text-xs font-bold text-brand">{fmtAna(ytdTotal,'K',0)}</span>
            </div>
            <div className="flex items-end gap-3 h-24 mb-1">
              {Object.entries(quarters).map(([q, rev]) => (
                <div key={q} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-[9px] text-gray-500">{rev > 0 ? `₺${(rev/1000).toFixed(0)}k` : ''}</span>
                  <div className="w-full rounded-sm transition-all" style={{height: `${(rev / maxQ) * 72}px`, background: (qColors as Record<string,string>)[q], minHeight: rev > 0 ? 3 : 0}} />
                  <span className="text-xs font-medium" style={{color: (qColors as Record<string,string>)[q]}}>{q}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 402: Lost Revenue from Cancellations (crm) ── */}
      {reportsTab === 'crm' && orders.length >= 5 && (() => {
        const byMonth: Record<string, {lost: number; count: number}> = {};
        orders.forEach(o => {
          if (o.status !== 'Cancelled' && (o.status as string) !== 'İptal') return;
          const d = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string)) : null;
          if (!d) return;
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          const oR = o as unknown as Record<string,unknown>;
          const total = typeof oR.total === 'number' ? oR.total as number
            : (o.lineItems ?? []).reduce((s, li) => { const lr = li as unknown as Record<string,unknown>; return s + ((lr.quantity as number|undefined)??0) * ((lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0); }, 0);
          if (!byMonth[key]) byMonth[key] = {lost: 0, count: 0};
          byMonth[key].lost += total;
          byMonth[key].count++;
        });
        const months = Object.keys(byMonth).sort().slice(-6);
        if (months.length === 0) return (
          <div className="apple-card p-4 mb-4 flex items-center gap-2">
            <span className="text-green-500">✓</span>
            <span className="text-sm font-medium text-green-700">No cancelled orders — 0 lost revenue</span>
          </div>
        );
        const maxLost = Math.max(...months.map(m => byMonth[m].lost), 1);
        const totalLost = months.reduce((s, m) => s + byMonth[m].lost, 0);
        return (
          <div className="apple-card p-4 mb-4">
            <div className="flex justify-between items-center mb-3">
              <h3 className="font-semibold text-sm">Lost Revenue (Cancellations)</h3>
              <span className="text-xs bg-red-100 text-red-700 rounded-full px-2 py-0.5">{fmtAna(totalLost,'K',1)} total</span>
            </div>
            <div className="flex items-end gap-2 h-20 mb-1">
              {months.map(m => (
                <div key={m} className="flex-1 flex flex-col items-center gap-0.5">
                  <span className="text-[9px] text-gray-500">{byMonth[m].count}</span>
                  <div className="w-full rounded-sm" style={{height: `${(byMonth[m].lost / maxLost) * 56}px`, background: '#ef4444', minHeight: byMonth[m].lost > 0 ? 2 : 0}} />
                  <span className="text-[9px] text-gray-400">{m.slice(5)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 403: Stock Turnover Ratio by Category (envanter) ── */}
      {reportsTab === 'envanter' && inventory.length >= 5 && inventoryMovements.length >= 5 && (() => {
        const outByCategory: Record<string, number> = {};
        const stockByCategory: Record<string, number> = {};
        inventoryMovements.filter(m => m.type === 'out').forEach(m => {
          const item = inventory.find(i => i.id === (m.productId as string));
          if (!item) return;
          const cat = item.category ?? 'Other';
          outByCategory[cat] = (outByCategory[cat] ?? 0) + (m.quantity ?? 0);
        });
        inventory.forEach(item => {
          const cat = item.category ?? 'Other';
          stockByCategory[cat] = (stockByCategory[cat] ?? 0) + ((item.stock as number | undefined) ?? 0);
        });
        const rows = Object.keys(outByCategory)
          .map(cat => ({ cat, turnover: stockByCategory[cat] > 0 ? outByCategory[cat] / stockByCategory[cat] : 0 }))
          .filter(r => r.turnover > 0)
          .sort((a, b) => b.turnover - a.turnover)
          .slice(0, 6);
        if (rows.length < 2) return null;
        const maxT = Math.max(...rows.map(r => r.turnover), 1);
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">Stock Turnover by Category</h3>
            <div className="space-y-2">
              {rows.map(r => (
                <div key={r.cat} className="flex items-center gap-2">
                  <span className="text-xs truncate w-24 text-gray-700">{r.cat}</span>
                  <div className="flex-1 bg-gray-100 rounded-full h-4 overflow-hidden">
                    <div className="h-full rounded-full flex items-center pl-2" style={{width: `${(r.turnover / maxT) * 100}%`, background: r.turnover >= 2 ? '#22c55e' : r.turnover >= 1 ? '#f59e0b' : '#ef4444'}}>
                      <span className="text-white text-[9px] font-bold">{r.turnover.toFixed(1)}×</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 404: Stuck Orders (Processing >7 Days) (lojistik) ── */}
      {reportsTab === 'lojistik' && orders.length >= 3 && (() => {
        const now = new Date();
        const stuck = orders.filter(o => {
          if (o.status !== 'Processing' && o.status !== 'Pending') return false;
          const d = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string)) : null;
          if (!d) return false;
          return (now.getTime() - d.getTime()) / 86400000 > 7;
        }).map(o => {
          const d = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string)) : new Date();
          const days = Math.floor((now.getTime() - d.getTime()) / 86400000);
          const cid = (o as unknown as Record<string,unknown>).customerName as string | undefined
            || (o as unknown as Record<string,unknown>).customerId as string | undefined
            || 'Unknown';
          const oR = o as unknown as Record<string,unknown>;
          const total = typeof oR.total === 'number' ? oR.total as number
            : (o.lineItems ?? []).reduce((s, li) => { const lr = li as unknown as Record<string,unknown>; return s + ((lr.quantity as number|undefined)??0) * ((lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0); }, 0);
          return {id: o.id, status: o.status, days, customer: cid, total};
        }).sort((a, b) => b.days - a.days).slice(0, 6);
        if (stuck.length === 0) return (
          <div className="apple-card p-4 mb-4 flex items-center gap-2">
            <span className="text-green-500">✓</span>
            <span className="text-sm font-medium text-green-700">No stuck orders — all moving normally</span>
          </div>
        );
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
              <span>⏳ Stuck Orders (&gt;7 days)</span>
              <span className="text-xs bg-orange-100 text-orange-700 rounded-full px-2 py-0.5">{stuck.length}</span>
            </h3>
            <div className="space-y-2">
              {stuck.map((o, i) => (
                <div key={i} className="flex items-center justify-between text-xs">
                  <div className="flex-1">
                    <span className="text-gray-700 font-medium">{o.customer}</span>
                    <span className="ml-2 text-gray-400">{o.status}</span>
                  </div>
                  <span className="font-bold ml-2" style={{color: o.days > 14 ? '#ef4444' : '#f59e0b'}}>{o.days}d</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 405: Employee Tenure Distribution (ik) ── */}
      {reportsTab === 'ik' && employees.length >= 3 && (() => {
        const now = new Date();
        const tenures = employees.map(e => {
          const d = e.startDate ? ((e.startDate as unknown as {toDate?:()=>Date}).toDate?.() ?? new Date(e.startDate as string)) : null;
          if (!d || isNaN(d.getTime())) return null;
          return (now.getTime() - d.getTime()) / (365.25 * 86400000);
        }).filter((t): t is number => t !== null && t >= 0);
        if (tenures.length < 2) return null;
        const buckets = [[0,0.5,'<6mo'],[0.5,1,'6-12mo'],[1,2,'1-2yr'],[2,5,'2-5yr'],[5,10,'5-10yr'],[10,100,'10yr+']];
        const counts = buckets.map(([lo,hi,lbl]) => ({
          label: lbl as string,
          count: tenures.filter(t => t >= (lo as number) && t < (hi as number)).length,
        }));
        const maxC = Math.max(...counts.map(c => c.count), 1);
        const avgTenure = tenures.reduce((a,b) => a+b, 0) / tenures.length;
        return (
          <div className="apple-card p-4 mb-4">
            <div className="flex justify-between items-center mb-3">
              <h3 className="font-semibold text-sm">Employee Tenure Distribution</h3>
              <span className="text-xs bg-indigo-100 text-indigo-700 rounded-full px-2 py-0.5">avg {avgTenure.toFixed(1)}yr</span>
            </div>
            <div className="flex items-end gap-2 h-20 mb-1">
              {counts.map(c => (
                <div key={c.label} className="flex-1 flex flex-col items-center gap-0.5">
                  <span className="text-[9px] text-gray-500">{c.count > 0 ? c.count : ''}</span>
                  <div className="w-full rounded-sm" style={{height: `${(c.count / maxC) * 56}px`, background: '#6366f1', minHeight: c.count > 0 ? 2 : 0}} />
                  <span className="text-[9px] text-gray-400">{c.label}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 406: Avg Order Value by Day of Week (lojistik) ── */}
      {reportsTab === 'lojistik' && orders.length >= 7 && (() => {
        const days = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
        const dayTotals: {sum: number; count: number}[] = Array.from({length: 7}, () => ({sum: 0, count: 0}));
        orders.forEach(o => {
          const d = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string)) : null;
          if (!d) return;
          const dow = (d.getDay() + 6) % 7;
          const oR = o as unknown as Record<string,unknown>;
          const total = typeof oR.total === 'number' ? oR.total as number
            : (o.lineItems ?? []).reduce((s, li) => { const lr = li as unknown as Record<string,unknown>; return s + ((lr.quantity as number|undefined)??0) * ((lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0); }, 0);
          dayTotals[dow].sum += total;
          dayTotals[dow].count++;
        });
        const avgs = dayTotals.map(d => d.count > 0 ? d.sum / d.count : 0);
        const maxAvg = Math.max(...avgs, 1);
        const bestDay = avgs.indexOf(Math.max(...avgs));
        return (
          <div className="apple-card p-4 mb-4">
            <div className="flex justify-between items-center mb-3">
              <h3 className="font-semibold text-sm">Avg Order Value by Day</h3>
              <span className="text-xs bg-green-100 text-green-700 rounded-full px-2 py-0.5">Best: {days[bestDay]}</span>
            </div>
            <div className="flex items-end gap-1.5 h-20 mb-1">
              {avgs.map((avg, i) => (
                <div key={days[i]} className="flex-1 flex flex-col items-center gap-0.5">
                  <div className="w-full rounded-sm transition-all" style={{height: `${(avg / maxAvg) * 56}px`, background: i === bestDay ? '#ff4000' : '#3b82f6', minHeight: avg > 0 ? 2 : 0}} />
                  <span className="text-[9px] text-gray-400">{days[i].slice(0,2)}</span>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-gray-400 text-center">average order value (₺)</p>
          </div>
        );
      })()}

      {/* ── Phase 407: Top Products by Unique Customer Reach (crm) ── */}
      {reportsTab === 'crm' && orders.length >= 5 && (() => {
        const productCustomers: Record<string, Set<string>> = {};
        orders.forEach(o => {
          const cid = (o as unknown as Record<string,unknown>).customerId as string | undefined
            || (o as unknown as Record<string,unknown>).customerName as string | undefined
            || 'Unknown';
          (o.lineItems ?? []).forEach(li => {
            const liR = li as unknown as Record<string,unknown>;
            const name = (liR.productName as string | undefined) ?? (liR.name as string | undefined) ?? 'Unknown';
            if (!productCustomers[name]) productCustomers[name] = new Set();
            productCustomers[name].add(cid);
          });
        });
        const top = Object.entries(productCustomers)
          .sort((a, b) => b[1].size - a[1].size)
          .slice(0, 6);
        if (top.length === 0) return null;
        const maxSize = top[0][1].size;
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">Products by Customer Reach</h3>
            <div className="space-y-2">
              {top.map(([name, custSet]) => (
                <div key={name} className="flex items-center gap-2">
                  <span className="text-xs truncate flex-1 text-gray-700">{name}</span>
                  <div className="w-20 bg-gray-100 rounded-full h-3 overflow-hidden">
                    <div className="h-full rounded-full" style={{width: `${(custSet.size / maxSize) * 100}%`, background: '#8b5cf6'}} />
                  </div>
                  <span className="text-xs font-bold w-8 text-right text-purple-600">{custSet.size}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 408: Inventory Value by Category (envanter) ── */}
      {reportsTab === 'envanter' && inventory.length >= 5 && (() => {
        const catValue: Record<string, number> = {};
        inventory.forEach(item => {
          const cat = item.category ?? 'Other';
          const retail = (item.prices?.['Retail'] as number | undefined) ?? 0;
          const stk = (item.stock as number | undefined) ?? 0;
          catValue[cat] = (catValue[cat] ?? 0) + retail * stk;
        });
        const total = Object.values(catValue).reduce((a,b) => a+b, 0);
        if (total === 0) return null;
        const rows = Object.entries(catValue).sort((a, b) => b[1] - a[1]).slice(0, 5);
        const others = total - rows.reduce((s, [,v]) => s + v, 0);
        if (others > 0) rows.push(['Other', others]);
        const palette = ['#ff4000','#3b82f6','#22c55e','#f59e0b','#8b5cf6','#6b7280'];
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">Inventory Value by Category</h3>
            <div className="flex h-4 rounded-full overflow-hidden mb-3">
              {rows.map(([cat, val], i) => (
                <div key={cat} style={{width: `${(val/total)*100}%`, background: palette[i]}} title={cat} />
              ))}
            </div>
            <div className="grid grid-cols-2 gap-1">
              {rows.map(([cat, val], i) => (
                <div key={cat} className="flex items-center gap-1.5 text-xs">
                  <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{background: palette[i]}} />
                  <span className="text-gray-600 truncate">{cat}</span>
                  <span className="ml-auto font-medium text-gray-800">{Math.round((val/total)*100)}%</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 409: Revenue per Employee (ik) ── */}
      {reportsTab === 'ik' && employees.length >= 1 && orders.length >= 1 && (() => {
        const now = new Date();
        const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000);
        const ytdStart = new Date(now.getFullYear(), 0, 1);
        let rev30 = 0, revYTD = 0;
        orders.forEach(o => {
          const d = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string)) : null;
          if (!d) return;
          const oR = o as unknown as Record<string,unknown>;
          const total = typeof oR.total === 'number' ? oR.total as number
            : (o.lineItems ?? []).reduce((s, li) => { const lr = li as unknown as Record<string,unknown>; return s + ((lr.quantity as number|undefined)??0) * ((lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0); }, 0);
          if (d >= thirtyDaysAgo) rev30 += total;
          if (d >= ytdStart) revYTD += total;
        });
        const activeCount = employees.filter(e => (e as unknown as Record<string,unknown>).status !== 'Inactive').length || employees.length;
        const rpe30 = activeCount > 0 ? rev30 / activeCount : 0;
        const rpeYTD = activeCount > 0 ? revYTD / activeCount : 0;
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">Revenue per Employee</h3>
            <div className="grid grid-cols-2 gap-3">
              {[{label:'Last 30 Days', val: rpe30, color: '#3b82f6'}, {label:'YTD', val: rpeYTD, color: '#ff4000'}].map(r => (
                <div key={r.label} className="rounded-xl p-3 text-center" style={{background: `${r.color}12`}}>
                  <p className="text-lg font-bold" style={{color: r.color}}>{fmtAna(r.val,'K',1)}</p>
                  <p className="text-[10px] text-gray-500">{r.label}</p>
                  <p className="text-[9px] text-gray-400">{activeCount} employees</p>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 410: Weekly Orders Trend (genel) ── */}
      {reportsTab === 'genel' && orders.length >= 5 && (() => {
        const weeks: Record<string, number> = {};
        orders.forEach(o => {
          const d = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string)) : null;
          if (!d) return;
          const weekStart = new Date(d);
          weekStart.setDate(d.getDate() - ((d.getDay() + 6) % 7));
          const key = `${weekStart.getFullYear()}-${String(weekStart.getMonth()+1).padStart(2,'0')}-${String(weekStart.getDate()).padStart(2,'0')}`;
          weeks[key] = (weeks[key] ?? 0) + 1;
        });
        const weekKeys = Object.keys(weeks).sort().slice(-8);
        if (weekKeys.length < 3) return null;
        const vals = weekKeys.map(k => weeks[k]);
        const maxV = Math.max(...vals, 1);
        const avg = vals.reduce((a,b)=>a+b,0)/vals.length;
        // Simple line chart using SVG polyline
        const w = 240; const h = 60; const pad = 8;
        const pts = vals.map((v, i) => `${pad + (i / (vals.length-1)) * (w-2*pad)},${h - pad - ((v / maxV) * (h-2*pad))}`).join(' ');
        return (
          <div className="apple-card p-4 mb-4">
            <div className="flex justify-between items-center mb-2">
              <h3 className="font-semibold text-sm">Weekly Orders Trend</h3>
              <span className="text-xs text-gray-500">avg {avg.toFixed(0)}/wk</span>
            </div>
            <svg width="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{height: 60}}>
              <polyline points={pts} fill="none" stroke="#ff4000" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              {vals.map((v, i) => (
                <circle key={i} cx={pad + (i / (vals.length-1)) * (w-2*pad)} cy={h - pad - ((v / maxV) * (h-2*pad))} r="3" fill="#ff4000" />
              ))}
            </svg>
            <div className="flex justify-between text-[9px] text-gray-400 mt-1">
              <span>{weekKeys[0]?.slice(5)}</span>
              <span>{weekKeys[weekKeys.length-1]?.slice(5)}</span>
            </div>
          </div>
        );
      })()}

      {/* ── Phase 411: Executive KPI Summary (genel) ── */}
      {reportsTab === 'genel' && orders.length >= 1 && (() => {
        const now = new Date();
        const thirtyAgo = new Date(now.getTime() - 30 * 86400000);
        let rev30 = 0; let orders30 = 0;
        orders.forEach(o => {
          const d = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string)) : null;
          if (!d || d < thirtyAgo) return;
          const oR = o as unknown as Record<string,unknown>;
          const total = typeof oR.total === 'number' ? oR.total as number
            : (o.lineItems ?? []).reduce((s, li) => { const lr = li as unknown as Record<string,unknown>; return s + ((lr.quantity as number|undefined)??0) * ((lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0); }, 0);
          rev30 += total; orders30++;
        });
        const aov = orders30 > 0 ? rev30 / orders30 : 0;
        const uniqueCustomers = new Set(orders.map(o => (o as unknown as Record<string,unknown>).customerId as string || (o as unknown as Record<string,unknown>).customerName as string || 'u')).size;
        const kpis = [
          {label:'Revenue (30d)', val:`₺${(rev30/1000).toFixed(1)}k`, icon:'💰', color:'#ff4000'},
          {label:'Orders (30d)', val:String(orders30), icon:'📦', color:'#3b82f6'},
          {label:'Avg Order', val:`₺${(aov/1000).toFixed(1)}k`, icon:'📊', color:'#22c55e'},
          {label:'Customers', val:String(uniqueCustomers), icon:'👥', color:'#8b5cf6'},
        ];
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">Executive KPI Summary</h3>
            <div className="grid grid-cols-2 gap-2">
              {kpis.map(k => (
                <div key={k.label} className="rounded-xl p-3" style={{background: `${k.color}12`}}>
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="text-sm">{k.icon}</span>
                    <span className="text-[10px] text-gray-500">{k.label}</span>
                  </div>
                  <p className="text-xl font-bold" style={{color: k.color}}>{k.val}</p>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 412: Customer Churn Risk (crm) ── */}
      {reportsTab === 'crm' && orders.length >= 5 && (() => {
        const now = new Date();
        const lastOrderByCustomer: Record<string, Date> = {};
        const revenueByCustomer: Record<string, number> = {};
        orders.forEach(o => {
          const d = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string)) : null;
          if (!d) return;
          const cid = (o as unknown as Record<string,unknown>).customerName as string | undefined
            || (o as unknown as Record<string,unknown>).customerId as string | undefined
            || 'Unknown';
          if (!lastOrderByCustomer[cid] || d > lastOrderByCustomer[cid]) lastOrderByCustomer[cid] = d;
          const oR = o as unknown as Record<string,unknown>;
          const total = typeof oR.total === 'number' ? oR.total as number
            : (o.lineItems ?? []).reduce((s, li) => { const lr = li as unknown as Record<string,unknown>; return s + ((lr.quantity as number|undefined)??0) * ((lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0); }, 0);
          revenueByCustomer[cid] = (revenueByCustomer[cid] ?? 0) + total;
        });
        const churnRisk = Object.entries(lastOrderByCustomer)
          .map(([cid, lastDate]) => ({
            name: cid,
            daysSince: Math.floor((now.getTime() - lastDate.getTime()) / 86400000),
            revenue: revenueByCustomer[cid] ?? 0,
          }))
          .filter(c => c.daysSince >= 90)
          .sort((a, b) => b.revenue - a.revenue)
          .slice(0, 6);
        if (churnRisk.length === 0) return (
          <div className="apple-card p-4 mb-4 flex items-center gap-2">
            <span className="text-green-500">✓</span>
            <span className="text-sm font-medium text-green-700">All customers active within 90 days</span>
          </div>
        );
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
              <span>⚠️ Churn Risk (&gt;90d no order)</span>
              <span className="text-xs bg-red-100 text-red-700 rounded-full px-2 py-0.5">{churnRisk.length}</span>
            </h3>
            <div className="space-y-2">
              {churnRisk.map((c, i) => (
                <div key={i} className="flex items-center justify-between text-xs">
                  <span className="truncate flex-1 text-gray-700">{c.name}</span>
                  <span className="text-gray-400 mx-2">{fmtAna(c.revenue,'K',0)}</span>
                  <span className="font-bold" style={{color: c.daysSince >= 180 ? '#ef4444' : '#f59e0b'}}>{c.daysSince}d</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 413: Top Products by Estimated Profit (envanter) ── */}
      {reportsTab === 'envanter' && inventory.length >= 5 && (() => {
        const products = inventory
          .map(item => {
            const retail = (item.prices?.['Retail'] as number | undefined) ?? 0;
            const cost = itemCostTRY(item, exchangeRates) || retail * 0.6;
            const stk = (item.stock as number | undefined) ?? 0;
            const margin = retail > 0 ? ((retail - cost) / retail) * 100 : 0;
            const potentialProfit = (retail - cost) * stk;
            return { name: item.name, margin, potentialProfit, retail, stock: stk };
          })
          .filter(p => p.margin > 0 && p.stock > 0)
          .sort((a, b) => b.potentialProfit - a.potentialProfit)
          .slice(0, 7);
        if (products.length < 2) return null;
        const maxProfit = products[0].potentialProfit;
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">Top Products by Potential Profit</h3>
            <div className="space-y-2">
              {products.map((p, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-xs truncate flex-1 text-gray-700">{p.name}</span>
                  <div className="w-16 bg-gray-100 rounded-full h-3 overflow-hidden">
                    <div className="h-full rounded-full" style={{width: `${(p.potentialProfit / maxProfit) * 100}%`, background: '#22c55e'}} />
                  </div>
                  <span className="text-[10px] text-gray-500 w-10 text-right">{p.margin.toFixed(0)}%</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 414: Monthly Delivery Success Rate (lojistik) ── */}
      {reportsTab === 'lojistik' && orders.length >= 5 && (() => {
        const byMonth: Record<string, {delivered: number; total: number}> = {};
        orders.forEach(o => {
          const d = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string)) : null;
          if (!d) return;
          if (o.status === 'Processing' || o.status === 'Pending') return;
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          if (!byMonth[key]) byMonth[key] = {delivered: 0, total: 0};
          byMonth[key].total++;
          if (o.status === 'Delivered') byMonth[key].delivered++;
        });
        const months = Object.keys(byMonth).sort().slice(-6);
        if (months.length < 2) return null;
        const rows = months.map(m => ({
          month: m.slice(5),
          rate: byMonth[m].total > 0 ? Math.round((byMonth[m].delivered / byMonth[m].total) * 100) : 0,
        }));
        const maxR = Math.max(...rows.map(r => r.rate), 1);
        const avgRate = rows.reduce((s, r) => s + r.rate, 0) / rows.length;
        return (
          <div className="apple-card p-4 mb-4">
            <div className="flex justify-between items-center mb-3">
              <h3 className="font-semibold text-sm">Delivery Success Rate</h3>
              <span className="text-xs bg-green-100 text-green-700 rounded-full px-2 py-0.5">{avgRate.toFixed(0)}% avg</span>
            </div>
            <div className="flex items-end gap-2 h-20 mb-1">
              {rows.map(r => (
                <div key={r.month} className="flex-1 flex flex-col items-center gap-0.5">
                  <span className="text-[9px] text-gray-500">{r.rate}%</span>
                  <div className="w-full rounded-sm" style={{height: `${(r.rate / maxR) * 56}px`, background: r.rate >= 90 ? '#22c55e' : r.rate >= 70 ? '#f59e0b' : '#ef4444', minHeight: r.rate > 0 ? 2 : 0}} />
                  <span className="text-[9px] text-gray-400">{r.month}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 415: Salary Range Distribution (ik) ── */}
      {reportsTab === 'ik' && employees.length >= 3 && (() => {
        const salaries = employees.map(e => {
          const eR = e as unknown as Record<string,unknown>;
          return (eR.salary as number|undefined) ?? (eR.baseSalary as number|undefined) ?? (eR.monthlySalary as number|undefined) ?? 0;
        }).filter(s => s > 0);
        if (salaries.length < 2) return null;
        const min = Math.min(...salaries); const max = Math.max(...salaries);
        const step = (max - min) / 5 || 1000;
        const buckets = Array.from({length: 5}, (_, i) => ({
          lo: min + i * step, hi: min + (i+1) * step,
          label: `₺${((min + i * step)/1000).toFixed(0)}k`,
          count: 0,
        }));
        salaries.forEach(s => {
          const idx = Math.min(Math.floor((s - min) / step), 4);
          buckets[idx].count++;
        });
        const maxC = Math.max(...buckets.map(b => b.count), 1);
        const avgSal = salaries.reduce((a,b)=>a+b,0)/salaries.length;
        return (
          <div className="apple-card p-4 mb-4">
            <div className="flex justify-between items-center mb-3">
              <h3 className="font-semibold text-sm">Salary Distribution</h3>
              <span className="text-xs bg-indigo-100 text-indigo-700 rounded-full px-2 py-0.5">avg {fmtAna(avgSal,'K',1)}</span>
            </div>
            <div className="flex items-end gap-2 h-20 mb-1">
              {buckets.map(b => (
                <div key={b.label} className="flex-1 flex flex-col items-center gap-0.5">
                  <span className="text-[9px] text-gray-500">{b.count > 0 ? b.count : ''}</span>
                  <div className="w-full rounded-sm" style={{height: `${(b.count / maxC) * 56}px`, background: '#6366f1', minHeight: b.count > 0 ? 2 : 0}} />
                  <span className="text-[9px] text-gray-400">{b.label}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 416: Orders by Hour of Day (crm) ── */}
      {reportsTab === 'crm' && orders.length >= 10 && (() => {
        const hourCounts = new Array(24).fill(0);
        orders.forEach(o => {
          const d = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string)) : null;
          if (!d) return;
          hourCounts[d.getHours()]++;
        });
        const maxH = Math.max(...hourCounts, 1);
        const peakHour = hourCounts.indexOf(Math.max(...hourCounts));
        const businessHours = hourCounts.slice(8, 19);
        const businessTotal = businessHours.reduce((a,b) => a+b, 0);
        const totalOrders = hourCounts.reduce((a,b) => a+b, 0);
        return (
          <div className="apple-card p-4 mb-4">
            <div className="flex justify-between items-center mb-3">
              <h3 className="font-semibold text-sm">Orders by Hour</h3>
              <span className="text-xs bg-blue-100 text-blue-700 rounded-full px-2 py-0.5">Peak: {peakHour}:00</span>
            </div>
            <div className="flex items-end gap-0.5 h-16">
              {hourCounts.map((count, h) => (
                <div key={h} className="flex-1 rounded-sm transition-all" style={{
                  height: `${(count / maxH) * 52}px`,
                  background: h === peakHour ? '#ff4000' : h >= 8 && h <= 18 ? '#3b82f6' : '#d1d5db',
                  minHeight: count > 0 ? 1 : 0,
                }} title={`${h}:00 — ${count} orders`} />
              ))}
            </div>
            <div className="flex justify-between text-[9px] text-gray-400 mt-1">
              <span>00:00</span><span>12:00</span><span>23:00</span>
            </div>
            <p className="text-[10px] text-gray-400 mt-1 text-center">{totalOrders > 0 ? Math.round((businessTotal/totalOrders)*100) : 0}% during business hours (8-18)</p>
          </div>
        );
      })()}

      {/* ── Phase 417: Overstock Alert (envanter) ── */}
      {reportsTab === 'envanter' && inventory.length >= 5 && inventoryMovements.length >= 5 && (() => {
        const outPerMonth: Record<string, number> = {};
        inventoryMovements.filter(m => m.type === 'out').forEach(m => {
          outPerMonth[m.productId as string] = (outPerMonth[m.productId as string] ?? 0) + (m.quantity ?? 0);
        });
        const now = new Date();
        const oldestMove = inventoryMovements.reduce((oldest, m) => {
          const d = m.date ? ((m.date as {toDate?:()=>Date}).toDate?.() ?? new Date(m.date as string)) : null;
          if (!d) return oldest;
          return d < oldest ? d : oldest;
        }, now);
        const monthsCovered = Math.max((now.getTime() - oldestMove.getTime()) / (30 * 86400000), 1);
        const overstocked = inventory
          .map(item => {
            const monthlyOut = (outPerMonth[item.id] ?? 0) / monthsCovered;
            const stk = (item.stock as number | undefined) ?? 0;
            const monthsOfStock = monthlyOut > 0 ? stk / monthlyOut : stk > 0 ? 999 : 0;
            return { name: item.name, stock: stk, monthlyOut, monthsOfStock };
          })
          .filter(i => i.monthsOfStock >= 6 && i.stock > 0)
          .sort((a, b) => b.monthsOfStock - a.monthsOfStock)
          .slice(0, 6);
        if (overstocked.length === 0) return null;
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
              <span>📦 Overstock Alert</span>
              <span className="text-xs bg-yellow-100 text-yellow-700 rounded-full px-2 py-0.5">{overstocked.length} items</span>
            </h3>
            <div className="space-y-1.5">
              {overstocked.map((item, i) => (
                <div key={i} className="flex items-center justify-between text-xs">
                  <span className="truncate flex-1 text-gray-700">{item.name}</span>
                  <span className="text-gray-400 mx-2">×{item.stock}</span>
                  <span className="font-bold text-orange-600">{item.monthsOfStock >= 999 ? '∞' : `${item.monthsOfStock.toFixed(0)}mo`}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 418: Top Shipped-to Locations (lojistik) ── */}
      {reportsTab === 'lojistik' && orders.length >= 5 && (() => {
        const locationCounts: Record<string, {count: number; revenue: number}> = {};
        orders.forEach(o => {
          const oR = o as unknown as Record<string,unknown>;
          const city = (oR.shippingCity as string|undefined) ?? (oR.city as string|undefined)
            ?? (oR.deliveryCity as string|undefined) ?? (oR.address as string|undefined)?.split(',').pop()?.trim()
            ?? 'Unknown';
          const total = typeof oR.total === 'number' ? oR.total as number
            : (o.lineItems ?? []).reduce((s, li) => { const lr = li as unknown as Record<string,unknown>; return s + ((lr.quantity as number|undefined)??0) * ((lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0); }, 0);
          if (!locationCounts[city]) locationCounts[city] = {count: 0, revenue: 0};
          locationCounts[city].count++;
          locationCounts[city].revenue += total;
        });
        const top = Object.entries(locationCounts).sort((a, b) => b[1].count - a[1].count).slice(0, 6);
        if (top.length <= 1) return null;
        const maxC = top[0][1].count;
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">Top Delivery Locations</h3>
            <div className="space-y-2">
              {top.map(([city, d], i) => (
                <div key={city} className="flex items-center gap-2">
                  <span className="text-xs font-bold text-gray-400 w-4">#{i+1}</span>
                  <span className="text-xs truncate flex-1 text-gray-700">{city}</span>
                  <div className="w-16 bg-gray-100 rounded-full h-3 overflow-hidden">
                    <div className="h-full rounded-full" style={{width: `${(d.count / maxC) * 100}%`, background: '#0ea5e9'}} />
                  </div>
                  <span className="text-xs font-bold w-6 text-right text-blue-600">{d.count}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 419: Employee Contract Type Breakdown (ik) ── */}
      {reportsTab === 'ik' && employees.length >= 3 && (() => {
        const types: Record<string, number> = {};
        employees.forEach(e => {
          const eR = e as unknown as Record<string,unknown>;
          const t = (eR.contractType as string|undefined) ?? (eR.employmentType as string|undefined) ?? (eR.type as string|undefined) ?? 'Full-time';
          types[t] = (types[t] ?? 0) + 1;
        });
        const total = employees.length;
        const rows = Object.entries(types).sort((a, b) => b[1] - a[1]);
        if (rows.length <= 1) {
          return (
            <div className="apple-card p-4 mb-4">
              <h3 className="font-semibold text-sm mb-1">Employment Types</h3>
              <p className="text-sm text-gray-600">{total} {rows[0]?.[0] ?? 'Full-time'} employees</p>
            </div>
          );
        }
        const palette = ['#6366f1','#22c55e','#f59e0b','#ef4444','#3b82f6'];
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">Employment Type Breakdown</h3>
            <div className="flex h-4 rounded-full overflow-hidden mb-3">
              {rows.map(([t, n], i) => (
                <div key={t} style={{width: `${(n/total)*100}%`, background: palette[i]}} title={`${t}: ${n}`} />
              ))}
            </div>
            <div className="space-y-1">
              {rows.map(([t, n], i) => (
                <div key={t} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-full" style={{background: palette[i]}} />
                    <span className="text-gray-600">{t}</span>
                  </div>
                  <span className="font-bold">{n} <span className="font-normal text-gray-400">({Math.round((n/total)*100)}%)</span></span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 420: Revenue Pareto (Top 20% Customers) (crm) ── */}
      {reportsTab === 'crm' && orders.length >= 5 && (() => {
        const custRevenue: Record<string, number> = {};
        orders.forEach(o => {
          const cid = (o as unknown as Record<string,unknown>).customerName as string | undefined
            || (o as unknown as Record<string,unknown>).customerId as string | undefined
            || 'Unknown';
          const oR = o as unknown as Record<string,unknown>;
          const total = typeof oR.total === 'number' ? oR.total as number
            : (o.lineItems ?? []).reduce((s, li) => { const lr = li as unknown as Record<string,unknown>; return s + ((lr.quantity as number|undefined)??0) * ((lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0); }, 0);
          custRevenue[cid] = (custRevenue[cid] ?? 0) + total;
        });
        const sorted = Object.values(custRevenue).sort((a, b) => b - a);
        if (sorted.length < 3) return null;
        const totalRev = sorted.reduce((a,b) => a+b, 0);
        const top20Count = Math.max(1, Math.ceil(sorted.length * 0.2));
        const top20Rev = sorted.slice(0, top20Count).reduce((a,b) => a+b, 0);
        const top20Pct = totalRev > 0 ? Math.round((top20Rev / totalRev) * 100) : 0;
        // Build cumulative Pareto data
        let cumRev = 0;
        const paretoPoints = sorted.map((v, i) => {
          cumRev += v;
          return { custPct: Math.round(((i+1)/sorted.length)*100), revPct: Math.round((cumRev/totalRev)*100) };
        });
        const w = 240; const h = 60; const pad = 8;
        const pts = paretoPoints.map(p => `${pad + (p.custPct / 100) * (w-2*pad)},${h - pad - (p.revPct / 100) * (h-2*pad)}`).join(' ');
        return (
          <div className="apple-card p-4 mb-4">
            <div className="flex justify-between items-center mb-2">
              <h3 className="font-semibold text-sm">Revenue Pareto</h3>
              <span className="text-xs bg-purple-100 text-purple-700 rounded-full px-2 py-0.5">Top 20% → {top20Pct}% revenue</span>
            </div>
            <svg width="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{height: 60}}>
              <line x1={pad} y1={pad} x2={w-pad} y2={h-pad} stroke="#e5e7eb" strokeWidth="1" strokeDasharray="4 4" />
              <polyline points={pts} fill="none" stroke="#8b5cf6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <line x1={pad + 0.2*(w-2*pad)} y1={pad} x2={pad + 0.2*(w-2*pad)} y2={h-pad} stroke="#f59e0b" strokeWidth="1" strokeDasharray="3 3" />
            </svg>
            <div className="flex justify-between text-[9px] text-gray-400 mt-1">
              <span>0% customers</span><span>100%</span>
            </div>
          </div>
        );
      })()}

      {/* ── Phase 421: Last 90 Days vs Prior 90 Days (genel) ── */}
      {reportsTab === 'genel' && orders.length >= 5 && (() => {
        const now = new Date();
        const d90 = new Date(now.getTime() - 90 * 86400000);
        const d180 = new Date(now.getTime() - 180 * 86400000);
        let curr = 0, prev = 0, currC = 0, prevC = 0;
        orders.forEach(o => {
          const d = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string)) : null;
          if (!d) return;
          const oR = o as unknown as Record<string,unknown>;
          const total = typeof oR.total === 'number' ? oR.total as number
            : (o.lineItems ?? []).reduce((s, li) => { const lr = li as unknown as Record<string,unknown>; return s + ((lr.quantity as number|undefined)??0)*((lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0); }, 0);
          if (d >= d90) { curr += total; currC++; }
          else if (d >= d180) { prev += total; prevC++; }
        });
        if (curr === 0 && prev === 0) return null;
        const revPct = prev > 0 ? ((curr - prev) / prev) * 100 : 0;
        const orderPct = prevC > 0 ? ((currC - prevC) / prevC) * 100 : 0;
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">Last 90d vs Prior 90d</h3>
            <div className="grid grid-cols-2 gap-3">
              {[{label:'Revenue', curr, prev, pct: revPct, fmt: (v:number) => `₺${(v/1000).toFixed(1)}k`},
                {label:'Orders', curr: currC, prev: prevC, pct: orderPct, fmt: (v:number) => String(v)}].map(r => (
                <div key={r.label} className="rounded-xl p-3" style={{background: r.pct >= 0 ? '#22c55e12' : '#ef444412'}}>
                  <p className="text-[10px] text-gray-500 mb-1">{r.label}</p>
                  <p className="text-lg font-bold text-gray-800">{r.fmt(r.curr)}</p>
                  <p className="text-xs" style={{color: r.pct >= 0 ? '#22c55e' : '#ef4444'}}>
                    {r.pct >= 0 ? '▲' : '▼'} {Math.abs(r.pct).toFixed(0)}%
                    <span className="text-gray-400 ml-1">vs {r.fmt(r.prev)}</span>
                  </p>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 422: New vs Returning Customers This Month (crm) ── */}
      {reportsTab === 'crm' && orders.length >= 5 && (() => {
        const now = new Date();
        const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const thisMonthCustomers = new Set<string>();
        const allTimeCustomers = new Set<string>();
        orders.forEach(o => {
          const d = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string)) : null;
          const cid = (o as unknown as Record<string,unknown>).customerId as string | undefined
            || (o as unknown as Record<string,unknown>).customerName as string | undefined
            || 'Unknown';
          if (d && d < thisMonthStart) allTimeCustomers.add(cid);
          if (d && d >= thisMonthStart) thisMonthCustomers.add(cid);
        });
        const returning = [...thisMonthCustomers].filter(c => allTimeCustomers.has(c)).length;
        const newCust = thisMonthCustomers.size - returning;
        const total = thisMonthCustomers.size;
        if (total === 0) return null;
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">New vs Returning (This Month)</h3>
            <div className="flex h-5 rounded-full overflow-hidden mb-3">
              <div style={{width: `${(newCust/total)*100}%`, background: '#ff4000'}} />
              <div style={{width: `${(returning/total)*100}%`, background: '#3b82f6'}} />
            </div>
            <div className="grid grid-cols-2 gap-3 text-center">
              {[{label:'New', count: newCust, color:'#ff4000'},{label:'Returning', count: returning, color:'#3b82f6'}].map(s => (
                <div key={s.label} className="rounded-xl p-2" style={{background: `${s.color}12`}}>
                  <p className="text-2xl font-bold" style={{color: s.color}}>{s.count}</p>
                  <p className="text-[10px] text-gray-500">{s.label} ({total > 0 ? Math.round((s.count/total)*100) : 0}%)</p>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 423: Items per Category (envanter) ── */}
      {reportsTab === 'envanter' && inventory.length >= 3 && (() => {
        const catCount: Record<string, {items: number; totalStock: number; totalValue: number}> = {};
        inventory.forEach(item => {
          const cat = item.category ?? 'Other';
          if (!catCount[cat]) catCount[cat] = {items: 0, totalStock: 0, totalValue: 0};
          catCount[cat].items++;
          const stk = (item.stock as number|undefined) ?? 0;
          const price = (item.prices?.['Retail'] as number|undefined) ?? 0;
          catCount[cat].totalStock += stk;
          catCount[cat].totalValue += price * stk;
        });
        const rows = Object.entries(catCount).sort((a, b) => b[1].items - a[1].items);
        if (rows.length < 2) return null;
        const maxItems = rows[0][1].items;
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">SKUs per Category</h3>
            <div className="space-y-2">
              {rows.map(([cat, d]) => (
                <div key={cat} className="flex items-center gap-2">
                  <span className="text-xs truncate w-20 text-gray-700">{cat}</span>
                  <div className="flex-1 bg-gray-100 rounded-full h-4 overflow-hidden">
                    <div className="h-full rounded-full flex items-center pl-2" style={{width: `${(d.items / maxItems) * 100}%`, background: '#0ea5e9'}}>
                      <span className="text-white text-[9px] font-bold">{d.items}</span>
                    </div>
                  </div>
                  <span className="text-[9px] text-gray-400 w-12 text-right">×{d.totalStock}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 424: Order Fulfillment Funnel (lojistik) ── */}
      {reportsTab === 'lojistik' && orders.length >= 5 && (() => {
        const funnel = [
          {label:'Pending',   count: orders.filter(o => o.status === 'Pending').length,   color:'#f59e0b'},
          {label:'Processing',count: orders.filter(o => o.status === 'Processing').length, color:'#3b82f6'},
          {label:'Shipped',   count: orders.filter(o => o.status === 'Shipped').length,    color:'#8b5cf6'},
          {label:'Delivered', count: orders.filter(o => o.status === 'Delivered').length,  color:'#22c55e'},
        ];
        const maxCount = Math.max(...funnel.map(f => f.count), 1);
        const totalOrders = orders.length;
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">Order Fulfillment Funnel</h3>
            <div className="space-y-2">
              {funnel.map(f => {
                const w = (f.count / maxCount) * 100;
                return (
                  <div key={f.label} className="flex items-center gap-2">
                    <span className="text-xs w-20 text-gray-600">{f.label}</span>
                    <div className="flex-1 flex">
                      <div className="h-6 rounded-sm flex items-center px-2 transition-all" style={{width: `${w}%`, background: f.color, minWidth: f.count > 0 ? 24 : 0}}>
                        <span className="text-white text-xs font-bold">{f.count > 0 ? f.count : ''}</span>
                      </div>
                    </div>
                    <span className="text-[10px] text-gray-400 w-8 text-right">{totalOrders > 0 ? Math.round((f.count/totalOrders)*100) : 0}%</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 425: Employee Performance Index (ik) ── */}
      {reportsTab === 'ik' && employees.length >= 2 && (() => {
        const deptEmployees: Record<string, number> = {};
        employees.forEach(e => {
          const dept = e.department ?? 'Other';
          deptEmployees[dept] = (deptEmployees[dept] ?? 0) + 1;
        });
        const totalEmp = employees.length;
        const activeEmp = employees.filter(e => (e as unknown as Record<string,unknown>).status !== 'Inactive').length || totalEmp;
        const avgTenure = (() => {
          const now = new Date();
          const tenures = employees.map(e => {
            const d = e.startDate ? ((e.startDate as unknown as {toDate?:()=>Date}).toDate?.() ?? new Date(e.startDate as string)) : null;
            if (!d || isNaN(d.getTime())) return null;
            return (now.getTime() - d.getTime()) / (365.25*86400000);
          }).filter((t): t is number => t !== null && t >= 0);
          return tenures.length > 0 ? tenures.reduce((a,b)=>a+b,0)/tenures.length : 0;
        })();
        const departments = Object.keys(deptEmployees).length;
        const metrics = [
          {label:'Active Staff', val: activeEmp, unit:'', color:'#22c55e'},
          {label:'Departments', val: departments, unit:'', color:'#3b82f6'},
          {label:'Avg Tenure', val: parseFloat(avgTenure.toFixed(1)), unit:'yr', color:'#8b5cf6'},
          {label:'Total Headcount', val: totalEmp, unit:'', color:'#ff4000'},
        ];
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">HR Overview</h3>
            <div className="grid grid-cols-2 gap-2">
              {metrics.map(m => (
                <div key={m.label} className="rounded-xl p-3" style={{background: `${m.color}12`}}>
                  <p className="text-xl font-bold" style={{color: m.color}}>{m.val}{m.unit}</p>
                  <p className="text-[10px] text-gray-500">{m.label}</p>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 426: Monthly Orders vs Quotations (crm) ── */}
      {reportsTab === 'crm' && orders.length >= 3 && quotations.length >= 2 && (() => {
        const ordersByMonth: Record<string, number> = {};
        const quotesByMonth: Record<string, number> = {};
        orders.forEach(o => {
          const d = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string)) : null;
          if (!d) return;
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          ordersByMonth[key] = (ordersByMonth[key] ?? 0) + 1;
        });
        quotations.forEach(q => {
          const d = q.createdAt ? ((q.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(q.createdAt as string)) : null;
          if (!d) return;
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          quotesByMonth[key] = (quotesByMonth[key] ?? 0) + 1;
        });
        const allMonths = [...new Set([...Object.keys(ordersByMonth), ...Object.keys(quotesByMonth)])].sort().slice(-6);
        if (allMonths.length < 2) return null;
        const maxVal = Math.max(...allMonths.map(m => Math.max(ordersByMonth[m]??0, quotesByMonth[m]??0)), 1);
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">Orders vs Quotations by Month</h3>
            <div className="flex items-end gap-2 h-24 mb-1">
              {allMonths.map(m => (
                <div key={m} className="flex-1 flex items-end gap-0.5">
                  <div className="flex-1 rounded-sm" style={{height: `${((ordersByMonth[m]??0)/maxVal)*72}px`, background: '#ff4000', minHeight: (ordersByMonth[m]??0) > 0 ? 2 : 0}} />
                  <div className="flex-1 rounded-sm" style={{height: `${((quotesByMonth[m]??0)/maxVal)*72}px`, background: '#3b82f680', minHeight: (quotesByMonth[m]??0) > 0 ? 2 : 0}} />
                </div>
              ))}
            </div>
            <div className="flex gap-1 mb-1">
              {allMonths.map(m => <span key={m} className="flex-1 text-center text-[9px] text-gray-400">{m.slice(5)}</span>)}
            </div>
            <div className="flex gap-3 justify-center text-[10px]">
              <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-brand" /><span className="text-gray-500">Orders</span></div>
              <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-blue-400" /><span className="text-gray-500">Quotes</span></div>
            </div>
          </div>
        );
      })()}

      {/* ── Phase 427: Items with Zero Sales (envanter) ── */}
      {reportsTab === 'envanter' && inventory.length >= 5 && inventoryMovements.length >= 3 && (() => {
        const soldIds = new Set(inventoryMovements.filter(m => m.type === 'out').map(m => m.productId as string));
        const neverSold = inventory.filter(item => !soldIds.has(item.id) && ((item.stock as number|undefined) ?? 0) > 0);
        if (neverSold.length === 0) return null;
        const topNeverSold = neverSold
          .map(item => ({
            name: item.name,
            stock: (item.stock as number|undefined) ?? 0,
            value: ((item.prices?.['Retail'] as number|undefined) ?? 0) * ((item.stock as number|undefined) ?? 0),
          }))
          .sort((a, b) => b.value - a.value)
          .slice(0, 6);
        const totalValue = topNeverSold.reduce((s, i) => s + i.value, 0);
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
              <span>🚫 Never Sold Items</span>
              <span className="text-xs bg-gray-100 text-gray-700 rounded-full px-2 py-0.5">{neverSold.length}</span>
            </h3>
            <div className="space-y-1.5">
              {topNeverSold.map((item, i) => (
                <div key={i} className="flex items-center justify-between text-xs">
                  <span className="truncate flex-1 text-gray-700">{item.name}</span>
                  <span className="text-gray-400 mx-2">×{item.stock}</span>
                  <span className="text-gray-600">{fmtAna(item.value,'full',0)}</span>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-gray-400 mt-2 text-right">Total tied-up: {fmtAna(totalValue,'full',0)}</p>
          </div>
        );
      })()}

      {/* ── Phase 428: Top Products by Movement Velocity (envanter) ── */}
      {reportsTab === 'envanter' && inventoryMovements.length >= 5 && (() => {
        const outCounts: Record<string, number> = {};
        inventoryMovements.filter(m => m.type === 'out').forEach(m => {
          outCounts[m.productId as string] = (outCounts[m.productId as string] ?? 0) + (m.quantity ?? 0);
        });
        const top = Object.entries(outCounts)
          .map(([id, qty]) => ({ id, qty, name: inventory.find(i => i.id === id)?.name ?? id }))
          .sort((a, b) => b.qty - a.qty)
          .slice(0, 7);
        if (top.length < 2) return null;
        const maxQty = top[0].qty;
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">Top Products by Movement (Out)</h3>
            <div className="space-y-2">
              {top.map((p, i) => (
                <div key={p.id} className="flex items-center gap-2">
                  <span className="text-xs font-bold text-gray-400 w-4">#{i+1}</span>
                  <span className="text-xs truncate flex-1 text-gray-700">{p.name}</span>
                  <div className="w-20 bg-gray-100 rounded-full h-3 overflow-hidden">
                    <div className="h-full rounded-full" style={{width: `${(p.qty / maxQty) * 100}%`, background: '#22c55e'}} />
                  </div>
                  <span className="text-xs font-bold text-green-600 w-8 text-right">{p.qty}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 429: Avg Delivery Days Trend (lojistik) ── */}
      {reportsTab === 'lojistik' && orders.length >= 5 && (() => {
        const byMonth: Record<string, {sum: number; count: number}> = {};
        orders.forEach(o => {
          const created = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string)) : null;
          const delivered = (o as unknown as Record<string,unknown>).deliveredAt ?? (o as unknown as Record<string,unknown>).completedAt;
          if (!created || !delivered || o.status !== 'Delivered') return;
          const dDate = (delivered as {toDate?:()=>Date}).toDate?.() ?? new Date(delivered as string);
          const diff = Math.round((dDate.getTime() - created.getTime()) / 86400000);
          if (diff < 0 || diff > 60) return;
          const key = `${created.getFullYear()}-${String(created.getMonth()+1).padStart(2,'0')}`;
          if (!byMonth[key]) byMonth[key] = {sum: 0, count: 0};
          byMonth[key].sum += diff;
          byMonth[key].count++;
        });
        const months = Object.keys(byMonth).sort().slice(-6);
        if (months.length < 2) {
          // Fallback: show order status counts
          const delivered = orders.filter(o => o.status === 'Delivered').length;
          const total = orders.length;
          const rate = total > 0 ? Math.round((delivered/total)*100) : 0;
          return (
            <div className="apple-card p-4 mb-4">
              <h3 className="font-semibold text-sm mb-1">Delivery Performance</h3>
              <p className="text-3xl font-bold text-green-500">{rate}%</p>
              <p className="text-xs text-gray-500">{delivered}/{total} orders delivered</p>
            </div>
          );
        }
        const rows = months.map(m => ({month: m.slice(5), avg: byMonth[m].count > 0 ? byMonth[m].sum / byMonth[m].count : 0}));
        const maxAvg = Math.max(...rows.map(r => r.avg), 1);
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">Avg Delivery Days by Month</h3>
            <div className="flex items-end gap-2 h-20 mb-1">
              {rows.map(r => (
                <div key={r.month} className="flex-1 flex flex-col items-center gap-0.5">
                  <span className="text-[9px] text-gray-500">{r.avg.toFixed(1)}d</span>
                  <div className="w-full rounded-sm" style={{height: `${(r.avg / maxAvg) * 56}px`, background: r.avg <= 3 ? '#22c55e' : r.avg <= 7 ? '#f59e0b' : '#ef4444', minHeight: r.avg > 0 ? 2 : 0}} />
                  <span className="text-[9px] text-gray-400">{r.month}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 430: Business Health Score (genel) ── */}
      {reportsTab === 'genel' && orders.length >= 5 && (() => {
        const now = new Date();
        const d30 = new Date(now.getTime() - 30 * 86400000);
        const d60 = new Date(now.getTime() - 60 * 86400000);
        let rev30 = 0, rev30to60 = 0, orders30 = 0, orders30to60 = 0;
        let cancelCount = 0;
        orders.forEach(o => {
          const d = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string)) : null;
          if (!d) return;
          const oR = o as unknown as Record<string,unknown>;
          const total = typeof oR.total === 'number' ? oR.total as number
            : (o.lineItems ?? []).reduce((s, li) => { const lr = li as unknown as Record<string,unknown>; return s + ((lr.quantity as number|undefined)??0)*((lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0); }, 0);
          if (d >= d30) { rev30 += total; orders30++; if (o.status === 'Cancelled') cancelCount++; }
          else if (d >= d60) { rev30to60 += total; orders30to60++; }
        });
        const revScore = rev30to60 > 0 ? Math.min(100, Math.round((rev30 / rev30to60) * 50)) : 50;
        const orderScore = orders30to60 > 0 ? Math.min(100, Math.round((orders30 / orders30to60) * 50)) : 50;
        const cancelRate = orders30 > 0 ? (cancelCount / orders30) * 100 : 0;
        const cancelScore = Math.max(0, 100 - cancelRate * 5);
        const inventoryScore = inventory.length > 0 ? Math.min(100, inventory.length * 2) : 50;
        const overall = Math.round((revScore + orderScore + cancelScore + inventoryScore) / 4);
        const color = overall >= 75 ? '#22c55e' : overall >= 50 ? '#f59e0b' : '#ef4444';
        const label = overall >= 75 ? 'Healthy' : overall >= 50 ? 'Moderate' : 'At Risk';
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">Business Health Score</h3>
            <div className="flex items-center gap-4">
              <div className="relative w-20 h-20 flex-shrink-0">
                <svg width="80" height="80" viewBox="0 0 80 80">
                  <circle cx="40" cy="40" r="32" fill="none" stroke="#e5e7eb" strokeWidth="8" />
                  <circle cx="40" cy="40" r="32" fill="none" stroke={color} strokeWidth="8"
                    strokeDasharray={`${(overall / 100) * 201} 201`}
                    strokeDashoffset="50" strokeLinecap="round" />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-xl font-bold" style={{color}}>{overall}</span>
                  <span className="text-[8px] text-gray-500">{label}</span>
                </div>
              </div>
              <div className="flex-1 space-y-1.5">
                {[{label:'Revenue Growth', score: revScore}, {label:'Order Volume', score: orderScore},
                  {label:'Low Cancellations', score: Math.round(cancelScore)}, {label:'Inventory', score: inventoryScore}].map(m => (
                  <div key={m.label} className="flex items-center gap-2">
                    <span className="text-[10px] text-gray-500 flex-1">{m.label}</span>
                    <div className="w-16 bg-gray-100 rounded-full h-2">
                      <div className="h-full rounded-full" style={{width: `${m.score}%`, background: m.score >= 75 ? '#22c55e' : m.score >= 50 ? '#f59e0b' : '#ef4444'}} />
                    </div>
                    <span className="text-[9px] font-bold text-gray-600 w-6 text-right">{m.score}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Phase 431: Product Revenue Pareto (genel) ── */}
      {reportsTab === 'genel' && orders.length >= 5 && (() => {
        const productRevenue: Record<string, number> = {};
        orders.forEach(o => {
          (o.lineItems ?? []).forEach(li => {
            const lr = li as unknown as Record<string,unknown>;
            const name = (lr.productName as string|undefined) ?? (lr.name as string|undefined) ?? 'Unknown';
            const qty = (lr.quantity as number|undefined) ?? 0;
            const price = (lr.unitPrice as number|undefined) ?? (lr.price as number|undefined) ?? 0;
            productRevenue[name] = (productRevenue[name] ?? 0) + qty * price;
          });
        });
        const sorted = Object.entries(productRevenue).sort((a,b)=>b[1]-a[1]);
        if (sorted.length < 3) return null;
        const totalRev = sorted.reduce((s,[,v])=>s+v,0);
        const top20n = Math.max(1, Math.ceil(sorted.length * 0.2));
        const top20Rev = sorted.slice(0, top20n).reduce((s,[,v])=>s+v,0);
        const top20Pct = totalRev > 0 ? Math.round((top20Rev/totalRev)*100) : 0;
        const top5 = sorted.slice(0, 5);
        const maxRev = top5[0]?.[1] ?? 1;
        return (
          <div className="apple-card p-4 mb-4">
            <div className="flex justify-between items-center mb-3">
              <h3 className="font-semibold text-sm">Product Revenue Pareto</h3>
              <span className="text-xs bg-orange-100 text-orange-700 rounded-full px-2 py-0.5">Top 20% → {top20Pct}% rev</span>
            </div>
            <div className="space-y-2">
              {top5.map(([name, rev], i) => (
                <div key={name} className="flex items-center gap-2">
                  <span className="text-xs font-bold text-gray-400 w-4">#{i+1}</span>
                  <span className="text-xs truncate flex-1 text-gray-700">{name}</span>
                  <div className="w-20 bg-gray-100 rounded-full h-3 overflow-hidden">
                    <div className="h-full rounded-full" style={{width: `${(rev/maxRev)*100}%`, background: '#ff4000'}} />
                  </div>
                  <span className="text-[10px] text-gray-500 w-8 text-right">{totalRev > 0 ? Math.round((rev/totalRev)*100) : 0}%</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 432: Repeat Purchase Rate (crm) ── */}
      {reportsTab === 'crm' && orders.length >= 5 && (() => {
        const custOrderCount: Record<string, number> = {};
        orders.forEach(o => {
          const cid = (o as unknown as Record<string,unknown>).customerId as string|undefined
            || (o as unknown as Record<string,unknown>).customerName as string|undefined || 'Unknown';
          custOrderCount[cid] = (custOrderCount[cid] ?? 0) + 1;
        });
        const total = Object.keys(custOrderCount).length;
        const repeating = Object.values(custOrderCount).filter(c => c > 1).length;
        const rate = total > 0 ? Math.round((repeating / total) * 100) : 0;
        const avgOrdersPerRepeat = repeating > 0
          ? (Object.values(custOrderCount).filter(c=>c>1).reduce((a,b)=>a+b,0)/repeating).toFixed(1)
          : '0';
        // Monthly repeat rate trend
        const monthSeen: Record<string, Set<string>> = {};
        const monthRepeat: Record<string, number> = {};
        const custFirstMonth: Record<string, string> = {};
        [...orders].sort((a,b)=>{
          const da = a.createdAt ? ((a.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(a.createdAt as string)) : new Date(0);
          const db = b.createdAt ? ((b.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(b.createdAt as string)) : new Date(0);
          return da.getTime()-db.getTime();
        }).forEach(o => {
          const d = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(o.createdAt as string)) : null;
          if (!d) return;
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          const cid = (o as unknown as Record<string,unknown>).customerId as string|undefined || (o as unknown as Record<string,unknown>).customerName as string|undefined || 'Unknown';
          if (!custFirstMonth[cid]) custFirstMonth[cid] = key;
          if (!monthSeen[key]) { monthSeen[key] = new Set(); monthRepeat[key] = 0; }
          if (custFirstMonth[cid] < key) monthRepeat[key]++;
          monthSeen[key].add(cid);
        });
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">Repeat Purchase Rate</h3>
            <div className="flex items-center gap-4 mb-3">
              <div className="text-center">
                <p className="text-3xl font-bold text-brand">{rate}%</p>
                <p className="text-[10px] text-gray-500">of customers repeat</p>
              </div>
              <div className="flex-1">
                <div className="bg-gray-100 rounded-full h-4 overflow-hidden mb-1">
                  <div className="h-full rounded-full bg-brand transition-all" style={{width:`${rate}%`}} />
                </div>
                <p className="text-xs text-gray-500">{repeating}/{total} customers • avg {avgOrdersPerRepeat} orders</p>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Phase 433: Price Tier SKU Distribution (envanter) ── */}
      {reportsTab === 'envanter' && inventory.length >= 3 && (() => {
        const tiers = ['Retail','B2B Standard','B2B Premium','Dealer'] as const;
        const tierCounts = tiers.map(t => ({
          tier: t,
          count: inventory.filter(item => (item.prices?.[t] as number|undefined) != null && ((item.prices?.[t] as number)??0) > 0).length,
          avgPrice: (() => {
            const prices = inventory.map(i => (i.prices?.[t] as number|undefined)).filter((p): p is number => p != null && p > 0);
            return prices.length > 0 ? prices.reduce((a,b)=>a+b,0)/prices.length : 0;
          })(),
        }));
        const maxCount = Math.max(...tierCounts.map(t=>t.count), 1);
        const colors = ['#ff4000','#3b82f6','#22c55e','#8b5cf6'];
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">SKUs with Pricing by Tier</h3>
            <div className="space-y-2">
              {tierCounts.map((t, i) => (
                <div key={t.tier} className="flex items-center gap-2">
                  <span className="text-[10px] truncate w-20 text-gray-600">{t.tier}</span>
                  <div className="flex-1 bg-gray-100 rounded-full h-4 overflow-hidden">
                    <div className="h-full rounded-full flex items-center pl-2" style={{width: `${(t.count/maxCount)*100}%`, background: colors[i]}}>
                      <span className="text-white text-[9px] font-bold">{t.count > 0 ? t.count : ''}</span>
                    </div>
                  </div>
                  {t.avgPrice > 0 && <span className="text-[9px] text-gray-400 w-14 text-right">avg {fmtAna(t.avgPrice,'full',0)}</span>}
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 434: Multi-Item vs Single-Item Orders (lojistik) ── */}
      {reportsTab === 'lojistik' && orders.length >= 5 && (() => {
        let single = 0, multi = 0, bulk = 0;
        let singleRev = 0, multiRev = 0, bulkRev = 0;
        orders.forEach(o => {
          const n = (o.lineItems ?? []).length;
          const oR = o as unknown as Record<string,unknown>;
          const total = typeof oR.total === 'number' ? oR.total as number
            : (o.lineItems ?? []).reduce((s, li) => { const lr = li as unknown as Record<string,unknown>; return s + ((lr.quantity as number|undefined)??0)*((lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0); }, 0);
          if (n <= 1) { single++; singleRev += total; }
          else if (n <= 5) { multi++; multiRev += total; }
          else { bulk++; bulkRev += total; }
        });
        const total = single + multi + bulk;
        const segments = [
          {label:'Single item', count: single, rev: singleRev, color:'#94a3b8'},
          {label:'2-5 items', count: multi, rev: multiRev, color:'#3b82f6'},
          {label:'6+ items', count: bulk, rev: bulkRev, color:'#ff4000'},
        ];
        const maxRev = Math.max(singleRev, multiRev, bulkRev, 1);
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">Order Complexity Breakdown</h3>
            <div className="flex h-3 rounded-full overflow-hidden mb-3">
              {segments.map(s => s.count > 0 && <div key={s.label} style={{width:`${(s.count/total)*100}%`,background:s.color}} />)}
            </div>
            <div className="space-y-2">
              {segments.map(s => (
                <div key={s.label} className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{background:s.color}} />
                  <span className="text-xs text-gray-600 flex-1">{s.label}</span>
                  <span className="text-xs font-bold">{s.count}</span>
                  <div className="w-16 bg-gray-100 rounded-full h-2.5 overflow-hidden ml-1">
                    <div className="h-full rounded-full" style={{width:`${(s.rev/maxRev)*100}%`,background:s.color}} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 435: Recent Hires List (ik) ── */}
      {reportsTab === 'ik' && employees.length >= 1 && (() => {
        const now = new Date();
        const ninetyAgo = new Date(now.getTime() - 90 * 86400000);
        const recent = employees
          .map(e => {
            const d = e.startDate ? ((e.startDate as unknown as {toDate?:()=>Date}).toDate?.() ?? new Date(e.startDate as string)) : null;
            if (!d || isNaN(d.getTime()) || d < ninetyAgo) return null;
            const eR = e as unknown as Record<string,unknown>;
            return {
              name: (eR.name as string|undefined) ?? (eR.firstName as string|undefined) ?? 'Employee',
              dept: e.department ?? '',
              startDate: d,
              daysAgo: Math.floor((now.getTime() - d.getTime()) / 86400000),
            };
          })
          .filter((e): e is NonNullable<typeof e> => e !== null)
          .sort((a,b) => b.startDate.getTime() - a.startDate.getTime());
        if (recent.length === 0) return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-1">Recent Hires (90d)</h3>
            <p className="text-sm text-gray-500">No new hires in the last 90 days</p>
          </div>
        );
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
              <span>🆕 Recent Hires</span>
              <span className="text-xs bg-green-100 text-green-700 rounded-full px-2 py-0.5">{recent.length} in 90d</span>
            </h3>
            <div className="space-y-2">
              {recent.map((e, i) => (
                <div key={i} className="flex items-center justify-between text-xs">
                  <span className="font-medium text-gray-700">{e.name}</span>
                  {e.dept && <span className="text-gray-400">{e.dept}</span>}
                  <span className="text-green-600 font-bold">{e.daysAgo === 0 ? 'Today' : `${e.daysAgo}d ago`}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 436: Orders by Customer Type / Segment (crm) ── */}
      {reportsTab === 'crm' && orders.length >= 5 && (() => {
        const segmentData: Record<string, {count: number; revenue: number}> = {};
        orders.forEach(o => {
          const oR = o as unknown as Record<string,unknown>;
          const segment = (oR.customerType as string|undefined) ?? (oR.segment as string|undefined)
            ?? (oR.type as string|undefined) ?? 'Standard';
          const total = typeof oR.total === 'number' ? oR.total as number
            : (o.lineItems ?? []).reduce((s, li) => { const lr = li as unknown as Record<string,unknown>; return s + ((lr.quantity as number|undefined)??0)*((lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0); }, 0);
          if (!segmentData[segment]) segmentData[segment] = {count: 0, revenue: 0};
          segmentData[segment].count++;
          segmentData[segment].revenue += total;
        });
        const rows = Object.entries(segmentData).sort((a,b)=>b[1].revenue-a[1].revenue);
        if (rows.length <= 1) {
          // Single segment — show order size distribution instead
          const sizes = orders.map(o => (o.lineItems??[]).length).filter(n=>n>0);
          const avg = sizes.length > 0 ? (sizes.reduce((a,b)=>a+b,0)/sizes.length).toFixed(1) : '0';
          return (
            <div className="apple-card p-4 mb-4">
              <h3 className="font-semibold text-sm mb-1">Order Size Summary</h3>
              <p className="text-3xl font-bold text-brand">{avg}</p>
              <p className="text-xs text-gray-500">avg line items per order ({orders.length} orders)</p>
            </div>
          );
        }
        const totalRev = rows.reduce((s,[,d])=>s+d.revenue,0);
        const palette = ['#ff4000','#3b82f6','#22c55e','#f59e0b','#8b5cf6'];
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">Revenue by Customer Segment</h3>
            <div className="flex h-4 rounded-full overflow-hidden mb-3">
              {rows.map(([seg,d],i)=><div key={seg} style={{width:`${(d.revenue/totalRev)*100}%`,background:palette[i]}} title={seg} />)}
            </div>
            <div className="space-y-1">
              {rows.map(([seg,d],i) => (
                <div key={seg} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-full" style={{background:palette[i]}} />
                    <span className="text-gray-600">{seg}</span>
                  </div>
                  <span className="font-bold">{d.count} <span className="font-normal text-gray-400">({totalRev>0?Math.round((d.revenue/totalRev)*100):0}%)</span></span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 437: Inventory Replenishment Due (envanter) ── */}
      {reportsTab === 'envanter' && inventory.length >= 3 && inventoryMovements.length >= 3 && (() => {
        const now = new Date();
        const outPerProduct: Record<string, {qty: number; days: number}> = {};
        inventoryMovements.filter(m => m.type === 'out').forEach(m => {
          const d = m.date ? ((m.date as {toDate?:()=>Date}).toDate?.() ?? new Date(m.date as string)) : null;
          if (!d) return;
          const pid = m.productId as string;
          const daysSince = (now.getTime() - d.getTime()) / 86400000;
          if (!outPerProduct[pid]) outPerProduct[pid] = {qty: 0, days: 30};
          outPerProduct[pid].qty += m.quantity ?? 0;
          outPerProduct[pid].days = Math.max(outPerProduct[pid].days, daysSince);
        });
        const replenishment = inventory
          .map(item => {
            const out = outPerProduct[item.id];
            const stk = (item.stock as number|undefined) ?? 0;
            if (!out || out.qty === 0) return null;
            const dailyRate = out.qty / Math.max(out.days, 1);
            const daysOfStock = dailyRate > 0 ? stk / dailyRate : 999;
            return {name: item.name, daysOfStock, stock: stk, dailyRate};
          })
          .filter((i): i is NonNullable<typeof i> => i !== null && i.daysOfStock <= 14 && i.stock > 0)
          .sort((a,b) => a.daysOfStock - b.daysOfStock)
          .slice(0, 6);
        if (replenishment.length === 0) return null;
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
              <span>🔄 Replenishment Due Soon</span>
              <span className="text-xs bg-red-100 text-red-700 rounded-full px-2 py-0.5">{replenishment.length}</span>
            </h3>
            <div className="space-y-2">
              {replenishment.map((item, i) => (
                <div key={i} className="flex items-center justify-between text-xs">
                  <span className="truncate flex-1 text-gray-700">{item.name}</span>
                  <span className="text-gray-400 mx-2">×{item.stock}</span>
                  <span className="font-bold" style={{color: item.daysOfStock <= 3 ? '#ef4444' : item.daysOfStock <= 7 ? '#f59e0b' : '#6b7280'}}>
                    {item.daysOfStock.toFixed(0)}d left
                  </span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 438: Monthly Shipped Order Count (lojistik) ── */}
      {reportsTab === 'lojistik' && orders.length >= 5 && (() => {
        const shipped = orders.filter(o => o.status === 'Shipped' || o.status === 'Delivered');
        if (shipped.length < 3) return null;
        const byMonth: Record<string, number> = {};
        shipped.forEach(o => {
          const d = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string)) : null;
          if (!d) return;
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          byMonth[key] = (byMonth[key] ?? 0) + 1;
        });
        const months = Object.keys(byMonth).sort().slice(-8);
        if (months.length < 2) return null;
        const vals = months.map(m => byMonth[m]);
        const maxV = Math.max(...vals, 1);
        const trend = vals[vals.length-1] - vals[0];
        return (
          <div className="apple-card p-4 mb-4">
            <div className="flex justify-between items-center mb-3">
              <h3 className="font-semibold text-sm">Shipped Orders by Month</h3>
              <span className="text-xs" style={{color: trend >= 0 ? '#22c55e' : '#ef4444'}}>
                {trend >= 0 ? '▲' : '▼'} {Math.abs(trend)} trend
              </span>
            </div>
            <div className="flex items-end gap-2 h-20 mb-1">
              {vals.map((v, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                  <span className="text-[9px] text-gray-500">{v}</span>
                  <div className="w-full rounded-sm" style={{height: `${(v/maxV)*56}px`, background: '#8b5cf6', minHeight: v > 0 ? 2 : 0}} />
                  <span className="text-[9px] text-gray-400">{months[i]?.slice(5)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 439: Employee Status Overview (ik) ── */}
      {reportsTab === 'ik' && employees.length >= 1 && (() => {
        const statusCounts: Record<string, number> = {};
        employees.forEach(e => {
          const eR = e as unknown as Record<string,unknown>;
          const status = (eR.status as string|undefined) ?? (eR.employmentStatus as string|undefined) ?? 'Active';
          statusCounts[status] = (statusCounts[status] ?? 0) + 1;
        });
        const rows = Object.entries(statusCounts).sort((a,b)=>b[1]-a[1]);
        const total = employees.length;
        const statusColors: Record<string,string> = {
          'Active':'#22c55e','Full-time':'#22c55e','Part-time':'#3b82f6',
          'Inactive':'#ef4444','On Leave':'#f59e0b','Contract':'#8b5cf6',
        };
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">Employee Status Overview</h3>
            <div className="flex h-4 rounded-full overflow-hidden mb-3">
              {rows.map(([status,n]) => <div key={status} style={{width:`${(n/total)*100}%`,background:statusColors[status]??'#6b7280'}} title={status} />)}
            </div>
            <div className="grid grid-cols-2 gap-1">
              {rows.map(([status,n]) => (
                <div key={status} className="flex items-center gap-1.5 text-xs">
                  <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{background:statusColors[status]??'#6b7280'}} />
                  <span className="text-gray-600 truncate">{status}</span>
                  <span className="ml-auto font-bold">{n}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 440: Top 5 Months by Revenue (genel) ── */}
      {reportsTab === 'genel' && orders.length >= 5 && (() => {
        const byMonth: Record<string, number> = {};
        orders.forEach(o => {
          const d = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string)) : null;
          if (!d) return;
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          const oR = o as unknown as Record<string,unknown>;
          const total = typeof oR.total === 'number' ? oR.total as number
            : (o.lineItems ?? []).reduce((s, li) => { const lr = li as unknown as Record<string,unknown>; return s + ((lr.quantity as number|undefined)??0)*((lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0); }, 0);
          byMonth[key] = (byMonth[key] ?? 0) + total;
        });
        const top5 = Object.entries(byMonth).sort((a,b)=>b[1]-a[1]).slice(0,5);
        if (top5.length < 2) return null;
        const maxRev = top5[0][1];
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">🏆 Best Revenue Months</h3>
            <div className="space-y-2">
              {top5.map(([month, rev], i) => (
                <div key={month} className="flex items-center gap-2">
                  <span className="text-xs font-bold w-4 text-gray-400">#{i+1}</span>
                  <span className="text-xs w-16 text-gray-700">{month}</span>
                  <div className="flex-1 bg-gray-100 rounded-full h-4 overflow-hidden">
                    <div className="h-full rounded-full flex items-center pl-2 transition-all" style={{width:`${(rev/maxRev)*100}%`,background:i===0?'#ff4000':'#6366f1'}}>
                      <span className="text-white text-[9px] font-bold">{fmtAna(rev,'K',0)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 441: Cumulative Revenue Trajectory (genel) ── */}
      {reportsTab === 'genel' && orders.length >= 5 && (() => {
        const sorted = [...orders].sort((a,b) => {
          const da = a.createdAt ? ((a.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(a.createdAt as string)) : new Date(0);
          const db = b.createdAt ? ((b.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(b.createdAt as string)) : new Date(0);
          return da.getTime()-db.getTime();
        });
        let cumulative = 0;
        const points = sorted.map(o => {
          const oR = o as unknown as Record<string,unknown>;
          const total = typeof oR.total === 'number' ? oR.total as number
            : (o.lineItems??[]).reduce((s,li)=>{ const lr=li as unknown as Record<string,unknown>; return s+((lr.quantity as number|undefined)??0)*((lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0); },0);
          cumulative += total;
          return cumulative;
        }).filter((_,i)=>i%Math.max(1,Math.floor(sorted.length/40))===0);
        if (points.length < 3) return null;
        const maxV = points[points.length-1];
        const w=240; const h=60; const pad=8;
        const pts = points.map((v,i)=>`${pad+(i/(points.length-1))*(w-2*pad)},${h-pad-(v/maxV)*(h-2*pad)}`).join(' ');
        return (
          <div className="apple-card p-4 mb-4">
            <div className="flex justify-between items-center mb-2">
              <h3 className="font-semibold text-sm">Cumulative Revenue Trajectory</h3>
              <span className="text-xs font-bold text-brand">{fmtAna(maxV,'K',0)} total</span>
            </div>
            <svg width="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{height:60}}>
              <defs>
                <linearGradient id="cumGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#ff4000" stopOpacity="0.3"/>
                  <stop offset="100%" stopColor="#ff4000" stopOpacity="0"/>
                </linearGradient>
              </defs>
              <polygon points={`${pad},${h-pad} ${pts} ${pad+(points.length-1)/(points.length-1)*(w-2*pad)},${h-pad}`} fill="url(#cumGrad)" />
              <polyline points={pts} fill="none" stroke="#ff4000" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <p className="text-[10px] text-gray-400 text-center mt-1">{sorted.length} orders total</p>
          </div>
        );
      })()}

      {/* ── Phase 442: Active Quotations Summary (crm) ── */}
      {reportsTab === 'crm' && quotations.length >= 1 && (() => {
        const active = quotations.filter(q => {
          const s = ((q as unknown as Record<string,unknown>).status as string|undefined) ?? '';
          return !['Rejected','Expired','Converted','Cancelled'].includes(s);
        });
        const totalValue = active.reduce((s, q) => {
          const qR = q as unknown as Record<string,unknown>;
          const val = (qR.totalAmount as number|undefined) ?? (qR.total as number|undefined) ?? 0;
          return s + val;
        }, 0);
        const byStatus: Record<string,number> = {};
        quotations.forEach(q => {
          const s = ((q as unknown as Record<string,unknown>).status as string|undefined) ?? 'Draft';
          byStatus[s] = (byStatus[s]??0)+1;
        });
        const statusRows = Object.entries(byStatus).sort((a,b)=>b[1]-a[1]);
        const statusColors: Record<string,string> = {'Draft':'#94a3b8','Sent':'#3b82f6','Pending':'#f59e0b','Approved':'#22c55e','Rejected':'#ef4444','Converted':'#8b5cf6','Expired':'#6b7280'};
        return (
          <div className="apple-card p-4 mb-4">
            <div className="flex justify-between items-center mb-3">
              <h3 className="font-semibold text-sm">Quotation Pipeline</h3>
              <span className="text-xs bg-blue-100 text-blue-700 rounded-full px-2 py-0.5">{active.length} active • {fmtAna(totalValue,'K',0)}</span>
            </div>
            <div className="grid grid-cols-2 gap-1">
              {statusRows.map(([s,n]) => (
                <div key={s} className="flex items-center gap-1.5 text-xs">
                  <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{background:statusColors[s]??'#6b7280'}} />
                  <span className="text-gray-600 truncate">{s}</span>
                  <span className="ml-auto font-bold">{n}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 443: Revenue from Recurring Orders (lojistik) ── */}
      {reportsTab === 'lojistik' && (() => {
        const recurringCount = (recurringOrders ?? []).length;
        if (recurringCount === 0) return null;
        const byFreq: Record<string,number> = {};
        (recurringOrders ?? []).forEach(ro => {
          const roR = ro as unknown as Record<string,unknown>;
          const freq = (roR.frequency as string|undefined) ?? (roR.interval as string|undefined) ?? 'Other';
          byFreq[freq] = (byFreq[freq]??0)+1;
        });
        const totalValue = (recurringOrders ?? []).reduce((s,ro) => {
          const roR = ro as unknown as Record<string,unknown>;
          return s + ((roR.totalAmount as number|undefined) ?? (roR.total as number|undefined) ?? 0);
        }, 0);
        const rows = Object.entries(byFreq).sort((a,b)=>b[1]-a[1]);
        return (
          <div className="apple-card p-4 mb-4">
            <div className="flex justify-between items-center mb-3">
              <h3 className="font-semibold text-sm">Recurring Orders</h3>
              <span className="text-xs bg-green-100 text-green-700 rounded-full px-2 py-0.5">{recurringCount} active</span>
            </div>
            <div className="flex items-center gap-4 mb-2">
              <div className="text-center">
                <p className="text-2xl font-bold text-green-500">{recurringCount}</p>
                <p className="text-[10px] text-gray-500">subscriptions</p>
              </div>
              {totalValue > 0 && <div className="text-center">
                <p className="text-2xl font-bold text-brand">{fmtAna(totalValue,'K',1)}</p>
                <p className="text-[10px] text-gray-500">period value</p>
              </div>}
            </div>
            {rows.length > 0 && <div className="flex flex-wrap gap-1">
              {rows.map(([freq,n])=>(
                <span key={freq} className="text-[10px] bg-gray-100 text-gray-600 rounded-full px-2 py-0.5">{freq}: {n}</span>
              ))}
            </div>}
          </div>
        );
      })()}

      {/* ── Phase 444: Products by Revenue Category (envanter) ── */}
      {reportsTab === 'envanter' && inventory.length >= 5 && orders.length >= 3 && (() => {
        const productRevenue: Record<string, number> = {};
        orders.forEach(o => {
          (o.lineItems??[]).forEach(li => {
            const lr = li as unknown as Record<string,unknown>;
            const pid = (lr.productId as string|undefined) ?? (lr.id as string|undefined) ?? '';
            const name = (lr.productName as string|undefined) ?? (lr.name as string|undefined) ?? '';
            const qty = (lr.quantity as number|undefined)??0;
            const price = (lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0;
            const key = pid || name;
            if (key) productRevenue[key] = (productRevenue[key]??0)+qty*price;
          });
        });
        const invRevenue = inventory.map(item => ({
          cat: item.category ?? 'Other',
          rev: productRevenue[item.id] ?? productRevenue[item.name] ?? 0,
        }));
        const catRev: Record<string,number> = {};
        invRevenue.forEach(({cat,rev}) => { catRev[cat]=(catRev[cat]??0)+rev; });
        const rows = Object.entries(catRev).filter(([,v])=>v>0).sort((a,b)=>b[1]-a[1]).slice(0,5);
        if (rows.length < 2) return null;
        const totalRev = rows.reduce((s,[,v])=>s+v,0);
        const palette=['#ff4000','#3b82f6','#22c55e','#f59e0b','#8b5cf6'];
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">Category Revenue from Orders</h3>
            <div className="flex h-4 rounded-full overflow-hidden mb-3">
              {rows.map(([cat,rev],i)=><div key={cat} style={{width:`${(rev/totalRev)*100}%`,background:palette[i]}} title={cat} />)}
            </div>
            <div className="space-y-1.5">
              {rows.map(([cat,rev],i)=>(
                <div key={cat} className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full flex-shrink-0" style={{background:palette[i]}} />
                  <span className="text-xs truncate flex-1 text-gray-700">{cat}</span>
                  <span className="text-xs font-bold">{fmtAna(rev,'K',1)}</span>
                  <span className="text-[9px] text-gray-400 w-8 text-right">{Math.round((rev/totalRev)*100)}%</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 445: Monthly Payroll Estimate (ik) ── */}
      {reportsTab === 'ik' && employees.length >= 2 && (() => {
        const salaries = employees.map(e => {
          const eR = e as unknown as Record<string,unknown>;
          return (eR.salary as number|undefined)??(eR.baseSalary as number|undefined)??(eR.monthlySalary as number|undefined)??0;
        });
        const hasSalaryData = salaries.some(s=>s>0);
        if (!hasSalaryData) return null;
        const totalPayroll = salaries.reduce((a,b)=>a+b,0);
        const avgSalary = salaries.filter(s=>s>0).reduce((a,b)=>a+b,0) / (salaries.filter(s=>s>0).length||1);
        const minSal = Math.min(...salaries.filter(s=>s>0));
        const maxSal = Math.max(...salaries.filter(s=>s>0));
        const percentiles = salaries.filter(s=>s>0).sort((a,b)=>a-b);
        const median = percentiles.length > 0 ? percentiles[Math.floor(percentiles.length/2)] : 0;
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">Monthly Payroll Estimate</h3>
            <div className="grid grid-cols-2 gap-2 mb-3">
              <div className="rounded-xl p-3 bg-indigo-50">
                <p className="text-xl font-bold text-indigo-600">{fmtAna(totalPayroll,'K',0)}</p>
                <p className="text-[10px] text-gray-500">Total monthly</p>
              </div>
              <div className="rounded-xl p-3 bg-purple-50">
                <p className="text-xl font-bold text-purple-600">{fmtAna(median,'K',1)}</p>
                <p className="text-[10px] text-gray-500">Median salary</p>
              </div>
            </div>
            <div className="flex justify-between text-xs text-gray-500">
              <span>Min: {fmtAna(minSal,'K',1)}</span>
              <span>Avg: {fmtAna(avgSalary,'K',1)}</span>
              <span>Max: {fmtAna(maxSal,'K',1)}</span>
            </div>
          </div>
        );
      })()}

      {/* ── Phase 446: All-Time Records (genel) ── */}
      {reportsTab === 'genel' && orders.length >= 3 && (() => {
        const custRevenue: Record<string,number> = {};
        const dayRevenue: Record<string,number> = {};
        let maxOrderValue = 0;
        let maxOrderCustomer = '';
        orders.forEach(o => {
          const d = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(o.createdAt as string)) : null;
          const cid = (o as unknown as Record<string,unknown>).customerName as string|undefined || (o as unknown as Record<string,unknown>).customerId as string|undefined || 'Unknown';
          const oR = o as unknown as Record<string,unknown>;
          const total = typeof oR.total === 'number' ? oR.total as number
            : (o.lineItems??[]).reduce((s,li)=>{ const lr=li as unknown as Record<string,unknown>; return s+((lr.quantity as number|undefined)??0)*((lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0); },0);
          custRevenue[cid]=(custRevenue[cid]??0)+total;
          if (d) { const dk=d.toISOString().slice(0,10); dayRevenue[dk]=(dayRevenue[dk]??0)+total; }
          if (total > maxOrderValue) { maxOrderValue=total; maxOrderCustomer=cid; }
        });
        const topCustomer = Object.entries(custRevenue).sort((a,b)=>b[1]-a[1])[0];
        const bestDay = Object.entries(dayRevenue).sort((a,b)=>b[1]-a[1])[0];
        const records = [
          {label:'Largest Order', val:`₺${(maxOrderValue/1000).toFixed(1)}k`, sub: maxOrderCustomer, icon:'💎'},
          {label:'Best Day', val:`₺${bestDay?((bestDay[1]/1000).toFixed(1))+'k':'—'}`, sub: bestDay?.[0]??'—', icon:'📅'},
          {label:'Top Customer', val:`₺${topCustomer?((topCustomer[1]/1000).toFixed(1))+'k':'—'}`, sub: topCustomer?.[0]??'—', icon:'👑'},
          {label:'Total Orders', val:String(orders.length), sub:'all time', icon:'📦'},
        ];
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">All-Time Records</h3>
            <div className="grid grid-cols-2 gap-2">
              {records.map(r=>(
                <div key={r.label} className="rounded-xl p-3 bg-gray-50">
                  <div className="flex items-center gap-1 mb-0.5">
                    <span className="text-sm">{r.icon}</span>
                    <span className="text-[10px] text-gray-400">{r.label}</span>
                  </div>
                  <p className="text-base font-bold text-gray-800">{r.val}</p>
                  <p className="text-[9px] text-gray-400 truncate">{r.sub}</p>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 447: Inventory Movement Balance (envanter) ── */}
      {reportsTab === 'envanter' && inventoryMovements.length >= 5 && (() => {
        const byMonth: Record<string,{in:number;out:number}> = {};
        inventoryMovements.forEach(m => {
          const d = m.date ? ((m.date as {toDate?:()=>Date}).toDate?.()??new Date(m.date as string)) : null;
          if (!d) return;
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          if (!byMonth[key]) byMonth[key]={in:0,out:0};
          if (m.type==='in') byMonth[key].in+=(m.quantity??0);
          else byMonth[key].out+=(m.quantity??0);
        });
        const months = Object.keys(byMonth).sort().slice(-6);
        if (months.length < 2) return null;
        const maxVal = Math.max(...months.flatMap(m=>[byMonth[m].in,byMonth[m].out]),1);
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">Inventory In vs Out by Month</h3>
            <div className="flex items-end gap-2 h-24 mb-1">
              {months.map(m=>(
                <div key={m} className="flex-1 flex items-end gap-0.5">
                  <div className="flex-1 rounded-sm" style={{height:`${(byMonth[m].in/maxVal)*72}px`,background:'#22c55e',minHeight:byMonth[m].in>0?2:0}} />
                  <div className="flex-1 rounded-sm" style={{height:`${(byMonth[m].out/maxVal)*72}px`,background:'#ef4444',minHeight:byMonth[m].out>0?2:0}} />
                </div>
              ))}
            </div>
            <div className="flex gap-1 mb-2">
              {months.map(m=><span key={m} className="flex-1 text-center text-[9px] text-gray-400">{m.slice(5)}</span>)}
            </div>
            <div className="flex gap-3 justify-center text-[10px]">
              <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-green-500"/><span className="text-gray-500">In</span></div>
              <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-red-500"/><span className="text-gray-500">Out</span></div>
            </div>
          </div>
        );
      })()}

      {/* ── Phase 448: Order Lead Time Segments (lojistik) ── */}
      {reportsTab === 'lojistik' && orders.length >= 5 && (() => {
        // Segment by days since order creation
        const now = new Date();
        const segments = [{label:'≤1d',min:0,max:1,color:'#22c55e'},{label:'2-3d',min:1,max:3,color:'#84cc16'},
          {label:'4-7d',min:3,max:7,color:'#f59e0b'},{label:'8-14d',min:7,max:14,color:'#ef4444'},{label:'14d+',min:14,max:9999,color:'#7c3aed'}];
        const counts = segments.map(s=>({...s,count:0}));
        orders.filter(o=>o.status==='Delivered').forEach(o=>{
          const created = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(o.createdAt as string)) : null;
          const deliv = (o as unknown as Record<string,unknown>).deliveredAt ?? (o as unknown as Record<string,unknown>).completedAt;
          if (!created) return;
          const end = deliv ? ((deliv as {toDate?:()=>Date}).toDate?.()??new Date(deliv as string)) : now;
          const days = (end.getTime()-created.getTime())/86400000;
          const seg = counts.find(s=>days>=s.min&&days<s.max);
          if (seg) seg.count++;
        });
        const totalDelivered = counts.reduce((s,c)=>s+c.count,0);
        if (totalDelivered < 2) return null;
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">Delivered Order Lead Times</h3>
            <div className="flex h-3 rounded-full overflow-hidden mb-3">
              {counts.map(s=>s.count>0&&<div key={s.label} style={{width:`${(s.count/totalDelivered)*100}%`,background:s.color}} />)}
            </div>
            <div className="grid grid-cols-5 gap-1 text-center">
              {counts.map(s=>(
                <div key={s.label}>
                  <p className="text-sm font-bold" style={{color:s.color}}>{s.count}</p>
                  <p className="text-[9px] text-gray-400">{s.label}</p>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 449: Quotation Value Trend (crm) ── */}
      {reportsTab === 'crm' && quotations.length >= 3 && (() => {
        const byMonth: Record<string,{count:number;value:number}> = {};
        quotations.forEach(q => {
          const d = q.createdAt ? ((q.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(q.createdAt as string)) : null;
          if (!d) return;
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          if (!byMonth[key]) byMonth[key]={count:0,value:0};
          byMonth[key].count++;
          const qR = q as unknown as Record<string,unknown>;
          byMonth[key].value += (qR.totalAmount as number|undefined)??(qR.total as number|undefined)??0;
        });
        const months = Object.keys(byMonth).sort().slice(-6);
        if (months.length < 2) return null;
        const maxVal = Math.max(...months.map(m=>byMonth[m].value),1);
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">Quotation Volume & Value by Month</h3>
            <div className="flex items-end gap-2 h-20 mb-1">
              {months.map(m=>(
                <div key={m} className="flex-1 flex flex-col items-center gap-0.5">
                  <div className="w-full rounded-sm" style={{height:`${(byMonth[m].value/maxVal)*56}px`,background:'#3b82f6',minHeight:byMonth[m].value>0?2:0}} />
                  <span className="text-[9px] text-gray-400">{m.slice(5)}</span>
                </div>
              ))}
            </div>
            <div className="flex justify-between text-xs text-gray-500 mt-1">
              <span>Total: {quotations.length} quotes</span>
              <span>Avg: {quotations.length>0?(quotations.length/months.length).toFixed(0):0}/mo</span>
            </div>
          </div>
        );
      })()}

      {/* ── Phase 450: Growth Rate Summary Card (genel) ── */}
      {reportsTab === 'genel' && orders.length >= 5 && (() => {
        const now = new Date();
        const periods = [7,30,90];
        const results = periods.map(days => {
          const curr = new Date(now.getTime()-days*86400000);
          const prev = new Date(now.getTime()-2*days*86400000);
          let currRev=0, prevRev=0;
          orders.forEach(o => {
            const d = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(o.createdAt as string)) : null;
            if (!d) return;
            const oR = o as unknown as Record<string,unknown>;
            const total = typeof oR.total==='number' ? oR.total as number
              : (o.lineItems??[]).reduce((s,li)=>{ const lr=li as unknown as Record<string,unknown>; return s+((lr.quantity as number|undefined)??0)*((lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0); },0);
            if (d>=curr) currRev+=total;
            else if (d>=prev) prevRev+=total;
          });
          const pct = prevRev>0 ? ((currRev-prevRev)/prevRev)*100 : 0;
          return {label:`${days}d`, pct, currRev};
        });
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">Revenue Growth Rates</h3>
            <div className="grid grid-cols-3 gap-2">
              {results.map(r=>(
                <div key={r.label} className="rounded-xl p-3 text-center" style={{background:r.pct>=0?'#22c55e12':'#ef444412'}}>
                  <p className="text-lg font-bold" style={{color:r.pct>=0?'#22c55e':'#ef4444'}}>
                    {r.pct>=0?'+':''}{r.pct.toFixed(0)}%
                  </p>
                  <p className="text-[10px] text-gray-500">{r.label}</p>
                  <p className="text-[9px] text-gray-400">{fmtAna(r.currRev,'K',0)}</p>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 451: Year-over-Year Revenue (genel) ── */}
      {reportsTab === 'genel' && orders.length >= 10 && (() => {
        const now = new Date();
        const currentYear = now.getFullYear();
        const prevYear = currentYear - 1;
        const currByMonth: number[] = new Array(12).fill(0);
        const prevByMonth: number[] = new Array(12).fill(0);
        orders.forEach(o => {
          const d = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(o.createdAt as string)) : null;
          if (!d) return;
          const oR = o as unknown as Record<string,unknown>;
          const total = typeof oR.total==='number' ? oR.total as number
            : (o.lineItems??[]).reduce((s,li)=>{ const lr=li as unknown as Record<string,unknown>; return s+((lr.quantity as number|undefined)??0)*((lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0); },0);
          if (d.getFullYear()===currentYear) currByMonth[d.getMonth()]+=total;
          else if (d.getFullYear()===prevYear) prevByMonth[d.getMonth()]+=total;
        });
        const hasPrevYear = prevByMonth.some(v=>v>0);
        if (!hasPrevYear) return null;
        const monthsToShow = now.getMonth() + 1;
        const maxVal = Math.max(...currByMonth.slice(0,monthsToShow),...prevByMonth.slice(0,monthsToShow),1);
        const monthLabels = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">Year-over-Year Revenue</h3>
            <div className="flex items-end gap-1 h-24 mb-1">
              {Array.from({length:monthsToShow},(_,i)=>(
                <div key={i} className="flex-1 flex items-end gap-0.5">
                  <div className="flex-1 rounded-sm" style={{height:`${(prevByMonth[i]/maxVal)*72}px`,background:'#d1d5db',minHeight:prevByMonth[i]>0?2:0}} />
                  <div className="flex-1 rounded-sm" style={{height:`${(currByMonth[i]/maxVal)*72}px`,background:'#ff4000',minHeight:currByMonth[i]>0?2:0}} />
                </div>
              ))}
            </div>
            <div className="flex justify-between">
              {Array.from({length:monthsToShow},(_,i)=><span key={i} className="flex-1 text-center text-[8px] text-gray-400">{monthLabels[i]}</span>)}
            </div>
            <div className="flex gap-3 justify-center text-[10px] mt-1">
              <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-brand"/><span className="text-gray-500">{currentYear}</span></div>
              <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-gray-300"/><span className="text-gray-500">{prevYear}</span></div>
            </div>
          </div>
        );
      })()}

      {/* ── Phase 452: Revenue Seasonality by Month (genel) ── */}
      {reportsTab === 'genel' && orders.length >= 12 && (() => {
        const monthRevenue: number[] = new Array(12).fill(0);
        const monthCounts: number[] = new Array(12).fill(0);
        orders.forEach(o => {
          const d = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(o.createdAt as string)) : null;
          if (!d) return;
          const oR = o as unknown as Record<string,unknown>;
          const total = typeof oR.total==='number' ? oR.total as number
            : (o.lineItems??[]).reduce((s,li)=>{ const lr=li as unknown as Record<string,unknown>; return s+((lr.quantity as number|undefined)??0)*((lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0); },0);
          monthRevenue[d.getMonth()]+=total;
          monthCounts[d.getMonth()]++;
        });
        const monthAvg = monthRevenue.map((v,i)=>monthCounts[i]>0?v/monthCounts[i]:0);
        const overallAvg = monthAvg.filter(v=>v>0).reduce((a,b)=>a+b,0)/Math.max(monthAvg.filter(v=>v>0).length,1);
        const indices = monthAvg.map(v=>overallAvg>0?Math.round((v/overallAvg)*100):0);
        const monthLabels = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        const maxIdx = Math.max(...indices,1);
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">Seasonality Index</h3>
            <div className="overflow-x-auto">
              <div className="flex items-end gap-0.5 h-16 min-w-full">
                {indices.map((idx,i)=>(
                  <div key={i} className="flex-1 flex flex-col items-center gap-0.5" style={{minWidth:18}}>
                    <div className="w-full rounded-sm" style={{height:`${(idx/maxIdx)*48}px`,background:idx>=110?'#22c55e':idx>=90?'#3b82f6':'#f59e0b',minHeight:idx>0?2:0}} />
                    <span className="text-[8px] text-gray-400">{monthLabels[i].slice(0,1)}</span>
                  </div>
                ))}
              </div>
            </div>
            <p className="text-[10px] text-gray-400 text-center mt-1">100 = average month</p>
          </div>
        );
      })()}

      {/* ── Phase 453: Customer Order Frequency Heatmap (crm) ── */}
      {reportsTab === 'crm' && orders.length >= 10 && (() => {
        const custMonthOrders: Record<string,Record<string,number>> = {};
        orders.forEach(o => {
          const d = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(o.createdAt as string)) : null;
          if (!d) return;
          const cid = (o as unknown as Record<string,unknown>).customerName as string|undefined || (o as unknown as Record<string,unknown>).customerId as string|undefined || 'Unknown';
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          if (!custMonthOrders[cid]) custMonthOrders[cid]={};
          custMonthOrders[cid][key]=(custMonthOrders[cid][key]??0)+1;
        });
        const topCusts = Object.entries(custMonthOrders).sort((a,b)=>Object.values(b[1]).reduce((x,y)=>x+y,0)-Object.values(a[1]).reduce((x,y)=>x+y,0)).slice(0,5);
        const allMonths = [...new Set(orders.map(o=>{const d=o.createdAt?((o.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(o.createdAt as string)):null;if(!d)return '';return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;}).filter(Boolean))].sort().slice(-5);
        if (topCusts.length < 2 || allMonths.length < 2) return null;
        const maxOrders = Math.max(...topCusts.flatMap(([,m])=>Object.values(m)),1);
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">Top Customer Order Frequency</h3>
            <table className="w-full text-xs">
              <thead>
                <tr>
                  <th className="text-left text-gray-400 font-normal pb-1 pr-2 w-24">Customer</th>
                  {allMonths.map(m=><th key={m} className="text-gray-400 font-normal pb-1 px-0.5">{m.slice(5)}</th>)}
                </tr>
              </thead>
              <tbody>
                {topCusts.map(([cid,monthMap])=>(
                  <tr key={cid}>
                    <td className="text-gray-600 truncate pr-2 py-0.5 max-w-[6rem]">{cid}</td>
                    {allMonths.map(m=>{
                      const n=monthMap[m]??0;
                      const intensity=n/maxOrders;
                      return <td key={m} className="px-0.5 py-0.5"><div className="rounded h-5 w-full flex items-center justify-center text-[9px] font-medium" style={{background:n>0?`rgba(255,64,0,${0.15+intensity*0.85})`:'#f3f4f6',color:intensity>0.5?'white':'#374151'}}>{n>0?n:''}</div></td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })()}

      {/* ── Phase 454: Inventory Movement Summary (envanter) ── */}
      {reportsTab === 'envanter' && inventoryMovements.length >= 5 && (() => {
        const now = new Date();
        const d30 = new Date(now.getTime()-30*86400000);
        let totalIn=0,totalOut=0,totalIn30=0,totalOut30=0;
        inventoryMovements.forEach(m => {
          const d = m.date ? ((m.date as {toDate?:()=>Date}).toDate?.()??new Date(m.date as string)) : null;
          if (m.type==='in') { totalIn+=(m.quantity??0); if(d&&d>=d30) totalIn30+=(m.quantity??0); }
          else { totalOut+=(m.quantity??0); if(d&&d>=d30) totalOut30+=(m.quantity??0); }
        });
        const netAllTime = totalIn - totalOut;
        const net30 = totalIn30 - totalOut30;
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">Inventory Movement Summary</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-[10px] text-gray-500 mb-2">All Time</p>
                <div className="space-y-1">
                  <div className="flex justify-between text-xs"><span className="text-green-600">In</span><span className="font-bold">{totalIn.toLocaleString('tr-TR')}</span></div>
                  <div className="flex justify-between text-xs"><span className="text-red-500">Out</span><span className="font-bold">{totalOut.toLocaleString('tr-TR')}</span></div>
                  <div className="flex justify-between text-xs border-t pt-1"><span className="text-gray-600">Net</span><span className="font-bold" style={{color:netAllTime>=0?'#22c55e':'#ef4444'}}>{netAllTime>=0?'+':''}{netAllTime.toLocaleString('tr-TR')}</span></div>
                </div>
              </div>
              <div>
                <p className="text-[10px] text-gray-500 mb-2">Last 30 Days</p>
                <div className="space-y-1">
                  <div className="flex justify-between text-xs"><span className="text-green-600">In</span><span className="font-bold">{totalIn30.toLocaleString('tr-TR')}</span></div>
                  <div className="flex justify-between text-xs"><span className="text-red-500">Out</span><span className="font-bold">{totalOut30.toLocaleString('tr-TR')}</span></div>
                  <div className="flex justify-between text-xs border-t pt-1"><span className="text-gray-600">Net</span><span className="font-bold" style={{color:net30>=0?'#22c55e':'#ef4444'}}>{net30>=0?'+':''}{net30.toLocaleString('tr-TR')}</span></div>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Phase 455: Upcoming Work Anniversaries (ik) ── */}
      {reportsTab === 'ik' && employees.length >= 1 && (() => {
        const now = new Date();
        const in60 = new Date(now.getTime()+60*86400000);
        const upcoming = employees
          .map(e => {
            const d = e.startDate ? ((e.startDate as unknown as {toDate?:()=>Date}).toDate?.()??new Date(e.startDate as string)) : null;
            if (!d || isNaN(d.getTime())) return null;
            const nextAnniv = new Date(now.getFullYear(),d.getMonth(),d.getDate());
            if (nextAnniv < now) nextAnniv.setFullYear(now.getFullYear()+1);
            if (nextAnniv > in60) return null;
            const daysUntil = Math.ceil((nextAnniv.getTime()-now.getTime())/86400000);
            const eR = e as unknown as Record<string,unknown>;
            return {
              name: (eR.name as string|undefined)??(eR.firstName as string|undefined)??'Employee',
              years: nextAnniv.getFullYear()-d.getFullYear(),
              daysUntil,
              dept: e.department??'',
            };
          })
          .filter((e): e is NonNullable<typeof e> => e!==null)
          .sort((a,b)=>a.daysUntil-b.daysUntil);
        if (upcoming.length===0) return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-1">Work Anniversaries (60d)</h3>
            <p className="text-sm text-gray-500">No anniversaries in next 60 days</p>
          </div>
        );
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
              <span>🎉 Upcoming Anniversaries</span>
              <span className="text-xs bg-purple-100 text-purple-700 rounded-full px-2 py-0.5">{upcoming.length}</span>
            </h3>
            <div className="space-y-2">
              {upcoming.map((e,i)=>(
                <div key={i} className="flex items-center justify-between text-xs">
                  <span className="font-medium text-gray-700">{e.name}</span>
                  <span className="text-purple-600 font-bold">{e.years}yr</span>
                  <span className="text-gray-400">{e.daysUntil===0?'Today':`in ${e.daysUntil}d`}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 456: Avg Products per Order Trend (crm) ── */}
      {reportsTab === 'crm' && orders.length >= 5 && (() => {
        const byMonth: Record<string,{qty:number;lines:number;orders:number}> = {};
        orders.forEach(o => {
          const d = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(o.createdAt as string)) : null;
          if (!d) return;
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          if (!byMonth[key]) byMonth[key]={qty:0,lines:0,orders:0};
          byMonth[key].orders++;
          (o.lineItems??[]).forEach(li=>{ const lr=li as unknown as Record<string,unknown>; byMonth[key].qty+=((lr.quantity as number|undefined)??1); byMonth[key].lines++; });
        });
        const months = Object.keys(byMonth).sort().slice(-6);
        if (months.length < 2) return null;
        const rows = months.map(m=>({month:m.slice(5),avgQty:byMonth[m].orders>0?byMonth[m].qty/byMonth[m].orders:0,avgLines:byMonth[m].orders>0?byMonth[m].lines/byMonth[m].orders:0}));
        const maxVal = Math.max(...rows.map(r=>r.avgQty),1);
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">Avg Items per Order</h3>
            <div className="flex items-end gap-2 h-20 mb-1">
              {rows.map(r=>(
                <div key={r.month} className="flex-1 flex flex-col items-center gap-0.5">
                  <span className="text-[9px] text-gray-500">{r.avgQty.toFixed(1)}</span>
                  <div className="w-full rounded-sm" style={{height:`${(r.avgQty/maxVal)*56}px`,background:'#f59e0b',minHeight:r.avgQty>0?2:0}} />
                  <span className="text-[9px] text-gray-400">{r.month}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 457: Inventory Cost vs Retail Value (envanter) ── */}
      {reportsTab === 'envanter' && inventory.length >= 3 && (() => {
        let totalCost=0, totalRetail=0, count=0;
        inventory.forEach(item => {
          const retail = (item.prices?.['Retail'] as number|undefined)??0;
          const cost = itemCostTRY(item, exchangeRates)||retail*0.6;
          const stk = (item.stock as number|undefined)??0;
          if (retail>0 && stk>0) { totalRetail+=retail*stk; totalCost+=cost*stk; count++; }
        });
        if (totalRetail===0) return null;
        const overallMargin = totalRetail>0 ? ((totalRetail-totalCost)/totalRetail)*100 : 0;
        const profitPotential = totalRetail - totalCost;
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">Inventory Cost vs Retail Value</h3>
            <div className="relative h-8 bg-gray-100 rounded-full overflow-hidden mb-3">
              <div className="absolute inset-y-0 left-0 rounded-full" style={{width:`${(totalCost/totalRetail)*100}%`,background:'#6b7280'}} />
              <div className="absolute inset-y-0 rounded-full" style={{left:`${(totalCost/totalRetail)*100}%`,right:0,background:'#22c55e'}} />
              <div className="absolute inset-0 flex items-center justify-center text-xs font-bold text-white">{overallMargin.toFixed(1)}% margin</div>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <div className="rounded-xl p-2 bg-gray-50"><p className="font-bold">{fmtAna(totalCost,'K',0)}</p><p className="text-gray-400">Cost</p></div>
              <div className="rounded-xl p-2 bg-green-50"><p className="font-bold text-green-600">{fmtAna(profitPotential,'K',0)}</p><p className="text-gray-400">Profit</p></div>
              <div className="rounded-xl p-2 bg-blue-50"><p className="font-bold text-blue-600">{fmtAna(totalRetail,'K',0)}</p><p className="text-gray-400">Retail</p></div>
            </div>
          </div>
        );
      })()}

      {/* ── Phase 458: Order Conversion from Quotations (lojistik) ── */}
      {reportsTab === 'lojistik' && orders.length >= 3 && quotations.length >= 3 && (() => {
        const convertedQuoteIds = new Set(orders.map(o=>(o as unknown as Record<string,unknown>).quotationId as string|undefined).filter(Boolean));
        const totalQuotes = quotations.length;
        const converted = convertedQuoteIds.size;
        const convRate = totalQuotes>0 ? Math.round((converted/totalQuotes)*100) : 0;
        const unconverted = totalQuotes-converted;
        // Conversion by month
        const convByMonth: Record<string,{total:number;conv:number}> = {};
        quotations.forEach(q => {
          const d = q.createdAt ? ((q.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(q.createdAt as string)) : null;
          if (!d) return;
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          if (!convByMonth[key]) convByMonth[key]={total:0,conv:0};
          convByMonth[key].total++;
          const qR = q as unknown as Record<string,unknown>;
          if (convertedQuoteIds.has(qR.id as string|undefined??'')) convByMonth[key].conv++;
        });
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">Quote-to-Order Conversion</h3>
            <div className="flex items-center gap-4 mb-3">
              <div className="relative w-16 h-16 flex-shrink-0">
                <svg width="64" height="64" viewBox="0 0 64 64">
                  <circle cx="32" cy="32" r="25" fill="none" stroke="#e5e7eb" strokeWidth="7"/>
                  <circle cx="32" cy="32" r="25" fill="none" stroke="#22c55e" strokeWidth="7"
                    strokeDasharray={`${(convRate/100)*157} 157`} strokeDashoffset="39" strokeLinecap="round"/>
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-sm font-bold text-green-600">{convRate}%</span>
                </div>
              </div>
              <div className="flex-1 space-y-1 text-xs">
                <div className="flex justify-between"><span className="text-gray-500">Total Quotes</span><span className="font-bold">{totalQuotes}</span></div>
                <div className="flex justify-between"><span className="text-green-600">Converted</span><span className="font-bold text-green-600">{converted}</span></div>
                <div className="flex justify-between"><span className="text-gray-400">Pending</span><span className="font-bold">{unconverted}</span></div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Phase 459: Top Cities by Order Revenue (lojistik) ── */}
      {reportsTab === 'lojistik' && orders.length >= 5 && (() => {
        const cityRev: Record<string,number> = {};
        orders.forEach(o => {
          const oR = o as unknown as Record<string,unknown>;
          const city = (oR.shippingCity as string|undefined)??(oR.city as string|undefined)??(oR.deliveryCity as string|undefined)??'Unknown';
          if (city==='Unknown') return;
          const total = typeof oR.total==='number' ? oR.total as number
            : (o.lineItems??[]).reduce((s,li)=>{ const lr=li as unknown as Record<string,unknown>; return s+((lr.quantity as number|undefined)??0)*((lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0); },0);
          cityRev[city]=(cityRev[city]??0)+total;
        });
        const rows = Object.entries(cityRev).sort((a,b)=>b[1]-a[1]).slice(0,6);
        if (rows.length<2) return null;
        const maxRev=rows[0][1];
        const totalRev=rows.reduce((s,[,v])=>s+v,0);
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">Revenue by Delivery City</h3>
            <div className="space-y-2">
              {rows.map(([city,rev],i)=>(
                <div key={city} className="flex items-center gap-2">
                  <span className="text-xs font-bold text-gray-400 w-4">#{i+1}</span>
                  <span className="text-xs truncate flex-1 text-gray-700">{city}</span>
                  <div className="w-16 bg-gray-100 rounded-full h-3 overflow-hidden">
                    <div className="h-full rounded-full" style={{width:`${(rev/maxRev)*100}%`,background:'#0ea5e9'}} />
                  </div>
                  <span className="text-[10px] text-gray-400 w-8 text-right">{Math.round((rev/totalRev)*100)}%</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 460: Sales Team Productivity (ik) ── */}
      {reportsTab === 'ik' && employees.length >= 1 && orders.length >= 1 && (() => {
        const salesDept = employees.filter(e => {
          const dept = (e.department??'').toLowerCase();
          return dept.includes('sales')||dept.includes('satış')||dept.includes('crm');
        });
        const salesCount = salesDept.length || 1;
        const now = new Date();
        const d30 = new Date(now.getTime()-30*86400000);
        const d90 = new Date(now.getTime()-90*86400000);
        let orders30=0,orders90=0,rev30=0,rev90=0;
        orders.forEach(o => {
          const d = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(o.createdAt as string)) : null;
          if (!d) return;
          const oR = o as unknown as Record<string,unknown>;
          const total = typeof oR.total==='number' ? oR.total as number
            : (o.lineItems??[]).reduce((s,li)=>{ const lr=li as unknown as Record<string,unknown>; return s+((lr.quantity as number|undefined)??0)*((lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0); },0);
          if (d>=d30) { orders30++; rev30+=total; }
          if (d>=d90) { orders90++; rev90+=total; }
        });
        const metrics = [
          {label:'Orders/rep (30d)', val:(orders30/salesCount).toFixed(1), color:'#3b82f6'},
          {label:'Rev/rep (30d)', val:`₺${((rev30/salesCount)/1000).toFixed(1)}k`, color:'#ff4000'},
          {label:'Orders/rep (90d)', val:(orders90/salesCount).toFixed(1), color:'#22c55e'},
          {label:'Rev/rep (90d)', val:`₺${((rev90/salesCount)/1000).toFixed(1)}k`, color:'#8b5cf6'},
        ];
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-1">Sales Productivity</h3>
            <p className="text-[10px] text-gray-400 mb-3">{salesDept.length>0?`${salesDept.length} sales rep${salesDept.length>1?'s':''}`:'All staff as baseline'}</p>
            <div className="grid grid-cols-2 gap-2">
              {metrics.map(m=>(
                <div key={m.label} className="rounded-xl p-3" style={{background:`${m.color}12`}}>
                  <p className="text-lg font-bold" style={{color:m.color}}>{m.val}</p>
                  <p className="text-[10px] text-gray-500">{m.label}</p>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 461: Revenue by Order Size Bracket (genel) ── */}
      {reportsTab === 'genel' && orders.length >= 5 && (() => {
        const brackets = [{label:'<₺1k',min:0,max:1000},{label:'₺1-5k',min:1000,max:5000},{label:'₺5-20k',min:5000,max:20000},{label:'₺20-100k',min:20000,max:100000},{label:'₺100k+',min:100000,max:Infinity}];
        const data = brackets.map(b=>({...b,count:0,revenue:0}));
        orders.forEach(o => {
          const oR = o as unknown as Record<string,unknown>;
          const total = typeof oR.total==='number' ? oR.total as number
            : (o.lineItems??[]).reduce((s,li)=>{ const lr=li as unknown as Record<string,unknown>; return s+((lr.quantity as number|undefined)??0)*((lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0); },0);
          const bracket = data.find(b=>total>=b.min&&total<b.max);
          if (bracket) { bracket.count++; bracket.revenue+=total; }
        });
        const totalRev = data.reduce((s,b)=>s+b.revenue,0);
        const maxRev = Math.max(...data.map(b=>b.revenue),1);
        const colors=['#94a3b8','#3b82f6','#f59e0b','#ff4000','#8b5cf6'];
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">Revenue by Order Size</h3>
            <div className="space-y-2">
              {data.map((b,i)=>b.count>0&&(
                <div key={b.label} className="flex items-center gap-2">
                  <span className="text-[10px] w-14 text-gray-600">{b.label}</span>
                  <div className="flex-1 bg-gray-100 rounded-full h-4 overflow-hidden">
                    <div className="h-full rounded-full flex items-center pl-1.5" style={{width:`${(b.revenue/maxRev)*100}%`,background:colors[i]}}>
                      <span className="text-white text-[9px] font-bold">{b.count}</span>
                    </div>
                  </div>
                  <span className="text-[9px] text-gray-400 w-8 text-right">{totalRev>0?Math.round((b.revenue/totalRev)*100):0}%</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 462: Top 10 Customers by LTV (crm) ── */}
      {reportsTab === 'crm' && orders.length >= 5 && (() => {
        const custLTV: Record<string,{revenue:number;orders:number;firstOrder:Date|null;lastOrder:Date|null}> = {};
        orders.forEach(o => {
          const d = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(o.createdAt as string)) : null;
          const cid = (o as unknown as Record<string,unknown>).customerName as string|undefined || (o as unknown as Record<string,unknown>).customerId as string|undefined || 'Unknown';
          const oR = o as unknown as Record<string,unknown>;
          const total = typeof oR.total==='number' ? oR.total as number
            : (o.lineItems??[]).reduce((s,li)=>{ const lr=li as unknown as Record<string,unknown>; return s+((lr.quantity as number|undefined)??0)*((lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0); },0);
          if (!custLTV[cid]) custLTV[cid]={revenue:0,orders:0,firstOrder:null,lastOrder:null};
          custLTV[cid].revenue+=total;
          custLTV[cid].orders++;
          if (d) { if (!custLTV[cid].firstOrder||d<custLTV[cid].firstOrder!) custLTV[cid].firstOrder=d; if (!custLTV[cid].lastOrder||d>custLTV[cid].lastOrder!) custLTV[cid].lastOrder=d; }
        });
        const top10 = Object.entries(custLTV).sort((a,b)=>b[1].revenue-a[1].revenue).slice(0,8);
        if (top10.length<2) return null;
        const maxRev = top10[0][1].revenue;
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">Top Customers by Lifetime Value</h3>
            <div className="space-y-2">
              {top10.map(([name,d],i)=>(
                <div key={name} className="flex items-center gap-2">
                  <span className="text-xs font-bold text-gray-400 w-4">#{i+1}</span>
                  <span className="text-xs truncate flex-1 text-gray-700">{name}</span>
                  <div className="w-16 bg-gray-100 rounded-full h-3 overflow-hidden">
                    <div className="h-full rounded-full" style={{width:`${(d.revenue/maxRev)*100}%`,background:i===0?'#ff4000':i<=2?'#f59e0b':'#6366f1'}} />
                  </div>
                  <span className="text-[10px] font-bold text-gray-600 w-12 text-right">{fmtAna(d.revenue,'K',0)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 463: Recent Inventory Inflows (envanter) ── */}
      {reportsTab === 'envanter' && inventoryMovements.length >= 3 && (() => {
        const recentIn = inventoryMovements
          .filter(m=>m.type==='in')
          .map(m=>{
            const d = m.date ? ((m.date as {toDate?:()=>Date}).toDate?.()??new Date(m.date as string)) : null;
            return {
              ...m,
              date2: d,
              productName: inventory.find(i=>i.id===(m.productId as string))?.name ?? (m.productId as string),
            };
          })
          .filter(m=>m.date2!==null)
          .sort((a,b)=>b.date2!.getTime()-a.date2!.getTime())
          .slice(0,8);
        if (recentIn.length===0) return null;
        const totalQty = recentIn.reduce((s,m)=>s+(m.quantity??0),0);
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
              <span>📥 Recent Stock Inflows</span>
              <span className="text-xs bg-green-100 text-green-700 rounded-full px-2 py-0.5">+{totalQty} units</span>
            </h3>
            <div className="space-y-1.5">
              {recentIn.map((m,i)=>(
                <div key={i} className="flex items-center justify-between text-xs">
                  <span className="truncate flex-1 text-gray-700">{m.productName}</span>
                  <span className="text-green-600 font-bold ml-2">+{m.quantity??0}</span>
                  <span className="text-gray-400 ml-2">{m.date2!.toLocaleDateString('tr-TR',{day:'2-digit',month:'short'})}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 464: Order Processing Pipeline (lojistik) ── */}
      {reportsTab === 'lojistik' && orders.length >= 5 && (() => {
        const pipeline = [
          {status:'Pending',   count:orders.filter(o=>o.status==='Pending').length,   color:'#f59e0b', icon:'⏳'},
          {status:'Processing',count:orders.filter(o=>o.status==='Processing').length, color:'#3b82f6', icon:'⚙️'},
          {status:'Shipped',   count:orders.filter(o=>o.status==='Shipped').length,    color:'#8b5cf6', icon:'🚚'},
        ];
        const totalActive = pipeline.reduce((s,p)=>s+p.count,0);
        const delivered = orders.filter(o=>o.status==='Delivered').length;
        const cancelled = orders.filter(o=>o.status==='Cancelled').length;
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">Active Order Pipeline</h3>
            <div className="space-y-2 mb-3">
              {pipeline.map(p=>(
                <div key={p.status} className="flex items-center gap-2">
                  <span className="text-sm">{p.icon}</span>
                  <span className="text-xs text-gray-600 w-20">{p.status}</span>
                  <div className="flex-1 bg-gray-100 rounded-full h-5 overflow-hidden">
                    {totalActive>0&&<div className="h-full rounded-full flex items-center pl-2" style={{width:`${(p.count/Math.max(totalActive,1))*100}%`,background:p.color,minWidth:p.count>0?24:0}}>
                      <span className="text-white text-xs font-bold">{p.count>0?p.count:''}</span>
                    </div>}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex justify-between text-xs text-gray-500 border-t pt-2">
              <span className="text-green-600 font-medium">✓ {delivered} delivered</span>
              <span className="text-red-500">{cancelled} cancelled</span>
            </div>
          </div>
        );
      })()}

      {/* ── Phase 465: Skills Distribution (ik) ── */}
      {reportsTab === 'ik' && employees.length >= 2 && (() => {
        const skillCounts: Record<string,number> = {};
        employees.forEach(e => {
          const eR = e as unknown as Record<string,unknown>;
          const skills = (eR.skills as string[]|undefined) ?? [];
          const skillStr = (eR.skillList as string|undefined)??(eR.skillsText as string|undefined)??'';
          const allSkills = [...skills, ...skillStr.split(/[,;]/g).map((s:string)=>s.trim()).filter(Boolean)];
          allSkills.forEach(s => { if (s) skillCounts[s]=(skillCounts[s]??0)+1; });
        });
        const topSkills = Object.entries(skillCounts).sort((a,b)=>b[1]-a[1]).slice(0,8);
        if (topSkills.length===0) return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-1">Skills Overview</h3>
            <p className="text-sm text-gray-500">{employees.length} employees — skill data not yet recorded</p>
          </div>
        );
        const maxCount = topSkills[0][1];
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">Top Skills Across Team</h3>
            <div className="space-y-1.5">
              {topSkills.map(([skill,count])=>(
                <div key={skill} className="flex items-center gap-2">
                  <span className="text-xs truncate flex-1 text-gray-700">{skill}</span>
                  <div className="w-20 bg-gray-100 rounded-full h-3 overflow-hidden">
                    <div className="h-full rounded-full" style={{width:`${(count/maxCount)*100}%`,background:'#6366f1'}} />
                  </div>
                  <span className="text-xs font-bold text-indigo-600 w-4 text-right">{count}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 466: Revenue First Half vs Second Half of Month (genel) ── */}
      {reportsTab === 'genel' && orders.length >= 10 && (() => {
        const byMonth: Record<string,{first:number;second:number}> = {};
        orders.forEach(o => {
          const d = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(o.createdAt as string)) : null;
          if (!d) return;
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          const oR = o as unknown as Record<string,unknown>;
          const total = typeof oR.total==='number' ? oR.total as number
            : (o.lineItems??[]).reduce((s,li)=>{ const lr=li as unknown as Record<string,unknown>; return s+((lr.quantity as number|undefined)??0)*((lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0); },0);
          if (!byMonth[key]) byMonth[key]={first:0,second:0};
          if (d.getDate()<=15) byMonth[key].first+=total; else byMonth[key].second+=total;
        });
        const months = Object.keys(byMonth).sort().slice(-5);
        if (months.length<2) return null;
        const maxVal = Math.max(...months.flatMap(m=>[byMonth[m].first,byMonth[m].second]),1);
        const totalFirst = months.reduce((s,m)=>s+byMonth[m].first,0);
        const totalSecond = months.reduce((s,m)=>s+byMonth[m].second,0);
        const total = totalFirst+totalSecond;
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">Revenue: First vs Second Half of Month</h3>
            <div className="flex items-end gap-2 h-20 mb-1">
              {months.map(m=>(
                <div key={m} className="flex-1 flex items-end gap-0.5">
                  <div className="flex-1 rounded-sm" style={{height:`${(byMonth[m].first/maxVal)*64}px`,background:'#3b82f6',minHeight:byMonth[m].first>0?2:0}} />
                  <div className="flex-1 rounded-sm" style={{height:`${(byMonth[m].second/maxVal)*64}px`,background:'#ff4000',minHeight:byMonth[m].second>0?2:0}} />
                </div>
              ))}
            </div>
            <div className="flex gap-1 mb-2">{months.map(m=><span key={m} className="flex-1 text-center text-[9px] text-gray-400">{m.slice(5)}</span>)}</div>
            <div className="flex justify-between text-xs">
              <span className="text-blue-500">1st half: {total>0?Math.round((totalFirst/total)*100):0}%</span>
              <span className="text-brand">2nd half: {total>0?Math.round((totalSecond/total)*100):0}%</span>
            </div>
          </div>
        );
      })()}

      {/* ── Phase 467: Products Frequently Co-Ordered (crm) ── */}
      {reportsTab === 'crm' && orders.length >= 5 && (() => {
        const pairs: Record<string,number> = {};
        orders.forEach(o => {
          const names = (o.lineItems??[]).map(li=>{ const lr=li as unknown as Record<string,unknown>; return (lr.productName as string|undefined)??(lr.name as string|undefined)??''; }).filter(Boolean);
          if (names.length<2) return;
          for (let i=0;i<names.length;i++) for (let j=i+1;j<names.length;j++) {
            const key = [names[i],names[j]].sort().join(' + ');
            pairs[key]=(pairs[key]??0)+1;
          }
        });
        const topPairs = Object.entries(pairs).filter(([,n])=>n>=2).sort((a,b)=>b[1]-a[1]).slice(0,5);
        if (topPairs.length===0) return null;
        const maxCount = topPairs[0][1];
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">Frequently Co-Ordered Products</h3>
            <div className="space-y-2">
              {topPairs.map(([pair,count])=>(
                <div key={pair} className="flex items-center gap-2">
                  <span className="text-xs truncate flex-1 text-gray-700">{pair}</span>
                  <div className="w-12 bg-gray-100 rounded-full h-3 overflow-hidden">
                    <div className="h-full rounded-full" style={{width:`${(count/maxCount)*100}%`,background:'#8b5cf6'}} />
                  </div>
                  <span className="text-xs font-bold text-purple-600 w-4 text-right">{count}×</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 468: Stock Deficit Analysis (envanter) ── */}
      {reportsTab === 'envanter' && inventory.length >= 5 && inventoryMovements.length >= 5 && (() => {
        const now = new Date();
        const outByProduct: Record<string,number> = {};
        inventoryMovements.filter(m=>m.type==='out').forEach(m=>{ outByProduct[m.productId as string]=(outByProduct[m.productId as string]??0)+(m.quantity??0); });
        const oldestMove = inventoryMovements.reduce((oldest,m)=>{ const d=m.date?((m.date as {toDate?:()=>Date}).toDate?.()??new Date(m.date as string)):null; return (d&&d<oldest)?d:oldest; },now);
        const months = Math.max((now.getTime()-oldestMove.getTime())/(30*86400000),1);
        const deficit = inventory
          .filter(item=>((item.stock as number|undefined)??0)===0)
          .map(item=>({
            name: item.name,
            demandPerMonth: (outByProduct[item.id]??0)/months,
          }))
          .filter(i=>i.demandPerMonth>0)
          .sort((a,b)=>b.demandPerMonth-a.demandPerMonth)
          .slice(0,6);
        if (deficit.length===0) return null;
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
              <span>🚨 Out of Stock with Demand</span>
              <span className="text-xs bg-red-100 text-red-700 rounded-full px-2 py-0.5">{deficit.length}</span>
            </h3>
            <div className="space-y-2">
              {deficit.map((item,i)=>(
                <div key={i} className="flex items-center justify-between text-xs">
                  <span className="truncate flex-1 text-gray-700">{item.name}</span>
                  <span className="text-red-600 font-bold ml-2">{item.demandPerMonth.toFixed(1)}/mo demand</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 469: Order Notes & Special Requests (lojistik) ── */}
      {reportsTab === 'lojistik' && orders.length >= 5 && (() => {
        const withNotes = orders.filter(o=>{ const oR=o as unknown as Record<string,unknown>; return !!(oR.notes||oR.specialInstructions||oR.comments||oR.note); });
        const priorityOrders = orders.filter(o=>{ const oR=o as unknown as Record<string,unknown>; return (oR.priority as string|undefined)==='high'||(oR.urgent as boolean|undefined)===true||(oR.rush as boolean|undefined)===true; });
        const avgLineItems = orders.length>0 ? (orders.reduce((s,o)=>s+(o.lineItems??[]).length,0)/orders.length).toFixed(1) : '0';
        const pendingCount = orders.filter(o=>o.status==='Pending').length;
        const processingCount = orders.filter(o=>o.status==='Processing').length;
        const stats = [
          {label:'With Notes', val:withNotes.length, total:orders.length, color:'#3b82f6'},
          {label:'Priority', val:priorityOrders.length, total:orders.length, color:'#ef4444'},
          {label:'Pending', val:pendingCount, total:orders.length, color:'#f59e0b'},
          {label:'Processing', val:processingCount, total:orders.length, color:'#8b5cf6'},
        ];
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">Order Operations Overview</h3>
            <div className="grid grid-cols-2 gap-2">
              {stats.map(s=>(
                <div key={s.label} className="rounded-xl p-3" style={{background:`${s.color}10`}}>
                  <p className="text-xl font-bold" style={{color:s.color}}>{s.val}</p>
                  <p className="text-[10px] text-gray-500">{s.label}</p>
                  {s.total>0&&<p className="text-[9px] text-gray-400">{Math.round((s.val/s.total)*100)}% of {s.total}</p>}
                </div>
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-2 text-center">avg {avgLineItems} line items/order</p>
          </div>
        );
      })()}

      {/* ── Phase 470: Revenue Rolling Average (genel) ── */}
      {reportsTab === 'genel' && orders.length >= 10 && (() => {
        const byDay: Record<string,number> = {};
        orders.forEach(o => {
          const d = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(o.createdAt as string)) : null;
          if (!d) return;
          const key = d.toISOString().slice(0,10);
          const oR = o as unknown as Record<string,unknown>;
          const total = typeof oR.total==='number' ? oR.total as number
            : (o.lineItems??[]).reduce((s,li)=>{ const lr=li as unknown as Record<string,unknown>; return s+((lr.quantity as number|undefined)??0)*((lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0); },0);
          byDay[key]=(byDay[key]??0)+total;
        });
        const days = Object.keys(byDay).sort().slice(-30);
        if (days.length<7) return null;
        const W=7;
        const rolling = days.map((_,i)=>{ if(i<W-1) return 0; const slice=days.slice(i-W+1,i+1); return slice.reduce((s,d)=>s+byDay[d],0)/W; }).slice(W-1);
        const rollingDays = days.slice(W-1);
        const maxVal = Math.max(...rolling,1);
        const w=240; const h=60; const pad=8;
        const pts = rolling.map((v,i)=>`${pad+(i/(rolling.length-1))*(w-2*pad)},${h-pad-(v/maxVal)*(h-2*pad)}`).join(' ');
        const latestAvg = rolling[rolling.length-1];
        return (
          <div className="apple-card p-4 mb-4">
            <div className="flex justify-between items-center mb-2">
              <h3 className="font-semibold text-sm">7-Day Rolling Revenue Avg</h3>
              <span className="text-xs font-bold text-brand">{fmtAna(latestAvg,'K',1)}/day</span>
            </div>
            <svg width="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{height:60}}>
              <defs><linearGradient id="rollGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#ff4000" stopOpacity="0.25"/><stop offset="100%" stopColor="#ff4000" stopOpacity="0"/></linearGradient></defs>
              <polygon points={`${pad},${h-pad} ${pts} ${pad+(rolling.length-1)/(rolling.length-1)*(w-2*pad)},${h-pad}`} fill="url(#rollGrad)"/>
              <polyline points={pts} fill="none" stroke="#ff4000" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <div className="flex justify-between text-[9px] text-gray-400 mt-1">
              <span>{rollingDays[0]?.slice(5)}</span><span>{rollingDays[rollingDays.length-1]?.slice(5)}</span>
            </div>
          </div>
        );
      })()}

      {/* ── Phase 471: Order Fulfillment Rate Summary (genel) ── */}
      {reportsTab === 'genel' && orders.length >= 5 && (() => {
        const total = orders.length;
        const delivered = orders.filter(o=>o.status==='Delivered').length;
        const cancelled = orders.filter(o=>o.status==='Cancelled').length;
        const inProgress = total-delivered-cancelled;
        const fulfillRate = (total-cancelled)>0 ? Math.round((delivered/(total-cancelled))*100) : 0;
        const cancelRate = total>0 ? Math.round((cancelled/total)*100) : 0;
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">Order Fulfillment Rate</h3>
            <div className="flex items-center gap-4 mb-3">
              <div className="relative w-20 h-20 flex-shrink-0">
                <svg width="80" height="80" viewBox="0 0 80 80">
                  <circle cx="40" cy="40" r="30" fill="none" stroke="#e5e7eb" strokeWidth="10"/>
                  <circle cx="40" cy="40" r="30" fill="none" stroke="#22c55e" strokeWidth="10"
                    strokeDasharray={`${(fulfillRate/100)*188} 188`} strokeDashoffset="47" strokeLinecap="round"/>
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-lg font-bold text-green-500">{fulfillRate}%</span>
                  <span className="text-[8px] text-gray-400">fulfilled</span>
                </div>
              </div>
              <div className="flex-1 space-y-1.5 text-xs">
                <div className="flex justify-between"><span className="text-gray-500">Total Orders</span><span className="font-bold">{total}</span></div>
                <div className="flex justify-between"><span className="text-green-600">Delivered</span><span className="font-bold text-green-600">{delivered}</span></div>
                <div className="flex justify-between"><span className="text-blue-500">In Progress</span><span className="font-bold text-blue-500">{inProgress}</span></div>
                <div className="flex justify-between"><span className="text-red-500">Cancelled ({cancelRate}%)</span><span className="font-bold text-red-500">{cancelled}</span></div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Phase 472: Net Revenue Excl. Cancelled (crm) ── */}
      {reportsTab === 'crm' && orders.length >= 5 && (() => {
        let grossRev=0, cancelledRev=0;
        const byMonth: Record<string,{gross:number;net:number}> = {};
        orders.forEach(o => {
          const d = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(o.createdAt as string)) : null;
          const oR = o as unknown as Record<string,unknown>;
          const total = typeof oR.total==='number' ? oR.total as number
            : (o.lineItems??[]).reduce((s,li)=>{ const lr=li as unknown as Record<string,unknown>; return s+((lr.quantity as number|undefined)??0)*((lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0); },0);
          grossRev+=total;
          if (o.status==='Cancelled') cancelledRev+=total;
          if (d) {
            const key=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
            if (!byMonth[key]) byMonth[key]={gross:0,net:0};
            byMonth[key].gross+=total;
            if (o.status!=='Cancelled') byMonth[key].net+=total;
          }
        });
        const netRev = grossRev-cancelledRev;
        const months = Object.keys(byMonth).sort().slice(-5);
        if (months.length<2) return null;
        const maxNet = Math.max(...months.map(m=>byMonth[m].net),1);
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-2">Net Revenue (excl. cancelled)</h3>
            <div className="flex items-center justify-between mb-3">
              <div><p className="text-2xl font-bold text-brand">{fmtAna(netRev,'K',1)}</p><p className="text-[10px] text-gray-400">net all-time</p></div>
              {cancelledRev>0&&<div className="text-right"><p className="text-sm font-bold text-red-500">-{fmtAna(cancelledRev,'K',1)}</p><p className="text-[10px] text-gray-400">from cancellations</p></div>}
            </div>
            <div className="flex items-end gap-2 h-16">
              {months.map(m=><div key={m} className="flex-1 flex flex-col items-center gap-0.5">
                <div className="w-full rounded-sm" style={{height:`${(byMonth[m].net/maxNet)*48}px`,background:'#22c55e',minHeight:byMonth[m].net>0?2:0}}/>
                <span className="text-[9px] text-gray-400">{m.slice(5)}</span>
              </div>)}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 473: Inventory Location Tags (envanter) ── */}
      {reportsTab === 'envanter' && inventory.length >= 3 && (() => {
        const locationCounts: Record<string,{count:number;totalStock:number}> = {};
        inventory.forEach(item => {
          const itemR = item as unknown as Record<string,unknown>;
          const loc = (itemR.location as string|undefined)??(itemR.warehouse as string|undefined)??(itemR.bin as string|undefined)??(itemR.shelf as string|undefined)??'Unassigned';
          if (!locationCounts[loc]) locationCounts[loc]={count:0,totalStock:0};
          locationCounts[loc].count++;
          locationCounts[loc].totalStock+=((item.stock as number|undefined)??0);
        });
        const rows = Object.entries(locationCounts).sort((a,b)=>b[1].count-a[1].count);
        if (rows.length<=1) {
          const totalItems=inventory.length;
          const totalStock=inventory.reduce((s,i)=>s+((i.stock as number|undefined)??0),0);
          return (
            <div className="apple-card p-4 mb-4">
              <h3 className="font-semibold text-sm mb-3">Inventory Totals</h3>
              <div className="grid grid-cols-2 gap-2 text-center">
                <div className="rounded-xl p-3 bg-blue-50"><p className="text-2xl font-bold text-blue-600">{totalItems}</p><p className="text-[10px] text-gray-500">SKUs</p></div>
                <div className="rounded-xl p-3 bg-green-50"><p className="text-2xl font-bold text-green-600">{totalStock.toLocaleString('tr-TR')}</p><p className="text-[10px] text-gray-500">Total Units</p></div>
              </div>
            </div>
          );
        }
        const maxCount=rows[0][1].count;
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">Items by Storage Location</h3>
            <div className="space-y-2">
              {rows.map(([loc,d])=>(
                <div key={loc} className="flex items-center gap-2">
                  <span className="text-xs truncate w-24 text-gray-700">{loc}</span>
                  <div className="flex-1 bg-gray-100 rounded-full h-4 overflow-hidden">
                    <div className="h-full rounded-full flex items-center pl-2" style={{width:`${(d.count/maxCount)*100}%`,background:'#0ea5e9'}}>
                      <span className="text-white text-[9px] font-bold">{d.count}</span>
                    </div>
                  </div>
                  <span className="text-[9px] text-gray-400 w-10 text-right">×{d.totalStock}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 474: Orders by Total Quantity (lojistik) ── */}
      {reportsTab === 'lojistik' && orders.length >= 5 && (() => {
        const buckets = [{label:'1-5',min:0,max:5},{label:'6-20',min:5,max:20},{label:'21-50',min:20,max:50},{label:'51-100',min:50,max:100},{label:'100+',min:100,max:Infinity}];
        const data = buckets.map(b=>({...b,count:0,revenue:0}));
        orders.forEach(o => {
          const totalQty = (o.lineItems??[]).reduce((s,li)=>{ const lr=li as unknown as Record<string,unknown>; return s+((lr.quantity as number|undefined)??1); },0);
          const oR = o as unknown as Record<string,unknown>;
          const total = typeof oR.total==='number' ? oR.total as number
            : (o.lineItems??[]).reduce((s,li)=>{ const lr=li as unknown as Record<string,unknown>; return s+((lr.quantity as number|undefined)??0)*((lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0); },0);
          const bucket = data.find(b=>totalQty>b.min&&totalQty<=b.max);
          if (bucket) { bucket.count++; bucket.revenue+=total; }
        });
        const maxCount = Math.max(...data.map(b=>b.count),1);
        const colors=['#94a3b8','#3b82f6','#f59e0b','#ff4000','#8b5cf6'];
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">Orders by Total Quantity</h3>
            <div className="flex items-end gap-2 h-20 mb-1">
              {data.map((b,i)=>(
                <div key={b.label} className="flex-1 flex flex-col items-center gap-0.5">
                  <span className="text-[9px] text-gray-500">{b.count>0?b.count:''}</span>
                  <div className="w-full rounded-sm" style={{height:`${(b.count/maxCount)*56}px`,background:colors[i],minHeight:b.count>0?2:0}}/>
                  <span className="text-[9px] text-gray-400">{b.label}</span>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-gray-400 text-center">units per order</p>
          </div>
        );
      })()}

      {/* ── Phase 475: Employee Retention Rate (ik) ── */}
      {reportsTab === 'ik' && employees.length >= 2 && (() => {
        const total = employees.length;
        const active = employees.filter(e=>{ const s=(e as unknown as Record<string,unknown>).status as string|undefined; return !s||s==='Active'||s==='Full-time'||s==='Part-time'; }).length;
        const onLeave = employees.filter(e=>{ const s=(e as unknown as Record<string,unknown>).status as string|undefined; return s==='On Leave'; }).length;
        const inactive = total-active-onLeave;
        const retentionRate = total>0 ? Math.round((active/total)*100) : 100;
        const now = new Date();
        const newIn90 = employees.filter(e=>{ const d=e.startDate?((e.startDate as unknown as {toDate?:()=>Date}).toDate?.()??new Date(e.startDate as string)):null; return d&&!isNaN(d.getTime())&&(now.getTime()-d.getTime())/(86400000)<90; }).length;
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">Workforce Retention</h3>
            <div className="flex items-center gap-4 mb-3">
              <div className="text-center">
                <p className="text-3xl font-bold" style={{color:retentionRate>=90?'#22c55e':retentionRate>=70?'#f59e0b':'#ef4444'}}>{retentionRate}%</p>
                <p className="text-[10px] text-gray-500">retention rate</p>
              </div>
              <div className="flex-1 space-y-1 text-xs">
                <div className="flex justify-between"><span className="text-green-600">Active</span><span className="font-bold">{active}</span></div>
                {onLeave>0&&<div className="flex justify-between"><span className="text-yellow-600">On Leave</span><span className="font-bold">{onLeave}</span></div>}
                {inactive>0&&<div className="flex justify-between"><span className="text-gray-400">Inactive</span><span className="font-bold">{inactive}</span></div>}
                {newIn90>0&&<div className="flex justify-between"><span className="text-blue-500">New (90d)</span><span className="font-bold text-blue-500">+{newIn90}</span></div>}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Phase 476: Revenue per Category Trend (genel) ── */}
      {reportsTab === 'genel' && orders.length >= 5 && inventory.length >= 3 && (() => {
        // Map products to categories via inventory
        const productCategory: Record<string,string> = {};
        inventory.forEach(item=>{ productCategory[item.name]=(item.category??'Other'); if(item.id) productCategory[item.id]=(item.category??'Other'); });
        const catMonthRev: Record<string,Record<string,number>> = {};
        orders.forEach(o => {
          const d = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(o.createdAt as string)) : null;
          if (!d) return;
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          (o.lineItems??[]).forEach(li=>{ const lr=li as unknown as Record<string,unknown>; const name=(lr.productName as string|undefined)??(lr.name as string|undefined)??''; const pid=(lr.productId as string|undefined)??''; const cat=productCategory[pid]??productCategory[name]??'Other'; const rev=((lr.quantity as number|undefined)??0)*((lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0); if (!catMonthRev[cat]) catMonthRev[cat]={}; catMonthRev[cat][key]=(catMonthRev[cat][key]??0)+rev; });
        });
        const topCats = Object.entries(catMonthRev).sort((a,b)=>Object.values(b[1]).reduce((x,y)=>x+y,0)-Object.values(a[1]).reduce((x,y)=>x+y,0)).slice(0,3);
        const allMonths = [...new Set(Object.values(catMonthRev).flatMap(m=>Object.keys(m)))].sort().slice(-5);
        if (topCats.length<2||allMonths.length<2) return null;
        const palette=['#ff4000','#3b82f6','#22c55e'];
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">Top Category Revenue Trend</h3>
            <div className="space-y-2">
              {topCats.map(([cat,monthMap],ci)=>{
                const vals=allMonths.map(m=>monthMap[m]??0);
                const maxV=Math.max(...vals,1);
                return (
                  <div key={cat}>
                    <div className="flex items-center gap-1.5 mb-1">
                      <div className="w-2 h-2 rounded-full" style={{background:palette[ci]}}/>
                      <span className="text-[10px] text-gray-600">{cat}</span>
                    </div>
                    <div className="flex items-end gap-1 h-8">
                      {vals.map((v,i)=><div key={i} className="flex-1 rounded-sm" style={{height:`${(v/maxV)*28}px`,background:palette[ci],opacity:0.7+(i/(vals.length-1))*0.3,minHeight:v>0?2:0}}/>)}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex gap-0.5 mt-1">{allMonths.map(m=><span key={m} className="flex-1 text-center text-[8px] text-gray-400">{m.slice(5)}</span>)}</div>
          </div>
        );
      })()}

      {/* ── Phase 477: Inventory Batch Status (envanter) ── */}
      {reportsTab === 'envanter' && inventory.length >= 3 && (() => {
        const withExpiry = inventory.filter(item=>{ const ir=item as unknown as Record<string,unknown>; return !!(ir.expiryDate||ir.expiry||ir.bestBefore); });
        const withBarcode = inventory.filter(item=>{ const ir=item as unknown as Record<string,unknown>; return !!(ir.barcode||ir.ean||ir.upc||item.sku); });
        const withCost = inventory.filter(item=>{ return !!(item as unknown as Record<string,unknown>).costPrice; });
        const withImages = inventory.filter(item=>{ const ir=item as unknown as Record<string,unknown>; return !!(ir.imageUrl||ir.images||ir.photo); });
        const total=inventory.length;
        const fields=[
          {label:'Has SKU/Barcode',count:withBarcode.length,color:'#3b82f6'},
          {label:'Has Cost Price',count:withCost.length,color:'#22c55e'},
          {label:'Has Expiry',count:withExpiry.length,color:'#f59e0b'},
          {label:'Has Images',count:withImages.length,color:'#8b5cf6'},
        ];
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">Inventory Data Completeness</h3>
            <div className="space-y-2">
              {fields.map(f=>(
                <div key={f.label} className="flex items-center gap-2">
                  <span className="text-xs truncate w-28 text-gray-600">{f.label}</span>
                  <div className="flex-1 bg-gray-100 rounded-full h-3 overflow-hidden">
                    <div className="h-full rounded-full" style={{width:`${total>0?(f.count/total)*100:0}%`,background:f.color}}/>
                  </div>
                  <span className="text-[10px] text-gray-500 w-8 text-right">{total>0?Math.round((f.count/total)*100):0}%</span>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-gray-400 mt-2 text-right">{total} total SKUs</p>
          </div>
        );
      })()}

      {/* ── Phase 478: Shortest Fulfilled Orders (lojistik) ── */}
      {reportsTab === 'lojistik' && orders.length >= 5 && (() => {
        const fulfilled = orders
          .filter(o=>o.status==='Delivered')
          .map(o=>{
            const created = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(o.createdAt as string)) : null;
            const delivered = (o as unknown as Record<string,unknown>).deliveredAt??(o as unknown as Record<string,unknown>).completedAt;
            if (!created||!delivered) return null;
            const dDate = (delivered as {toDate?:()=>Date}).toDate?.()??new Date(delivered as string);
            const hours = (dDate.getTime()-created.getTime())/3600000;
            if (hours<0||hours>8760) return null;
            const cid=(o as unknown as Record<string,unknown>).customerName as string|undefined||(o as unknown as Record<string,unknown>).customerId as string|undefined||'Unknown';
            return {customer:cid,hours,days:hours/24};
          })
          .filter((o): o is NonNullable<typeof o> => o!==null)
          .sort((a,b)=>a.hours-b.hours)
          .slice(0,5);
        if (fulfilled.length<2) {
          const deliveredCount=orders.filter(o=>o.status==='Delivered').length;
          return (
            <div className="apple-card p-4 mb-4">
              <h3 className="font-semibold text-sm mb-1">Delivered Orders</h3>
              <p className="text-3xl font-bold text-green-500">{deliveredCount}</p>
              <p className="text-xs text-gray-500">orders successfully delivered</p>
            </div>
          );
        }
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">⚡ Fastest Fulfilled Orders</h3>
            <div className="space-y-2">
              {fulfilled.map((o,i)=>(
                <div key={i} className="flex items-center justify-between text-xs">
                  <span className="truncate flex-1 text-gray-700">{o.customer}</span>
                  <span className="font-bold ml-2" style={{color:o.hours<24?'#22c55e':o.hours<72?'#3b82f6':'#6b7280'}}>
                    {o.hours<24?`${o.hours.toFixed(0)}h`:`${o.days.toFixed(1)}d`}
                  </span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 479: Revenue Concentration Score (genel) ── */}
      {reportsTab === 'genel' && orders.length >= 5 && (() => {
        const custRev: Record<string,number> = {};
        orders.forEach(o => {
          const cid=(o as unknown as Record<string,unknown>).customerName as string|undefined||(o as unknown as Record<string,unknown>).customerId as string|undefined||'Unknown';
          const oR=o as unknown as Record<string,unknown>;
          const total=typeof oR.total==='number' ? oR.total as number : (o.lineItems??[]).reduce((s,li)=>{ const lr=li as unknown as Record<string,unknown>; return s+((lr.quantity as number|undefined)??0)*((lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0); },0);
          custRev[cid]=(custRev[cid]??0)+total;
        });
        const revVals=Object.values(custRev);
        const totalRev=revVals.reduce((a,b)=>a+b,0);
        if (totalRev===0||revVals.length<2) return null;
        // Herfindahl-Hirschman Index
        const hhi = revVals.reduce((s,v)=>s+Math.pow(v/totalRev,2),0);
        const hhiScore = Math.round(hhi*10000);
        const label = hhiScore<1000?'Diversified':hhiScore<2500?'Moderate':hhiScore<5000?'Concentrated':'Highly Concentrated';
        const color = hhiScore<1000?'#22c55e':hhiScore<2500?'#3b82f6':hhiScore<5000?'#f59e0b':'#ef4444';
        const top1=revVals.sort((a,b)=>b-a)[0];
        const top1pct=totalRev>0?Math.round((top1/totalRev)*100):0;
        const sorted=revVals.sort((a,b)=>b-a);
        const top3pct=Math.round((sorted.slice(0,3).reduce((a,b)=>a+b,0)/totalRev)*100);
        return (
          <div className="apple-card p-4 mb-4">
            <div className="flex justify-between items-start mb-3">
              <h3 className="font-semibold text-sm">Revenue Concentration</h3>
              <span className="text-xs rounded-full px-2 py-0.5 font-medium" style={{background:`${color}20`,color}}>{label}</span>
            </div>
            <div className="text-center mb-3">
              <p className="text-4xl font-bold" style={{color}}>{hhiScore}</p>
              <p className="text-[10px] text-gray-400">HHI Score (0-10,000)</p>
            </div>
            <div className="flex justify-between text-xs text-gray-500">
              <span>Top customer: <strong>{top1pct}%</strong></span>
              <span>Top 3: <strong>{top3pct}%</strong></span>
              <span><strong>{revVals.length}</strong> customers</span>
            </div>
          </div>
        );
      })()}

      {/* ── Phase 480: Daily Order Count Heatmap (crm) ── */}
      {reportsTab === 'crm' && orders.length >= 10 && (() => {
        const dayCount: Record<string,number> = {};
        orders.forEach(o => {
          const d = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(o.createdAt as string)) : null;
          if (!d) return;
          const key = d.toISOString().slice(0,10);
          dayCount[key]=(dayCount[key]??0)+1;
        });
        const days = Object.keys(dayCount).sort().slice(-35);
        if (days.length<7) return null;
        const maxCount = Math.max(...days.map(d=>dayCount[d]),1);
        // 7 columns (Mon-Sun), up to 5 rows
        const firstDow = (new Date(days[0]).getDay()+6)%7;
        const grid: {day:string;count:number}[][] = [];
        let week: {day:string;count:number}[] = Array.from({length:firstDow},()=>({day:'',count:0}));
        days.forEach(d=>{
          week.push({day:d,count:dayCount[d]});
          if (week.length===7) { grid.push(week); week=[]; }
        });
        if (week.length>0) { while(week.length<7) week.push({day:'',count:0}); grid.push(week); }
        const dowLabels=['M','T','W','T','F','S','S'];
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">Order Activity Calendar</h3>
            <div className="flex gap-0.5 mb-1">{dowLabels.map((l,i)=><span key={i} className="flex-1 text-center text-[9px] text-gray-400">{l}</span>)}</div>
            <div className="space-y-0.5">
              {grid.map((week,wi)=>(
                <div key={wi} className="flex gap-0.5">
                  {week.map((cell,di)=>(
                    <div key={di} className="flex-1 aspect-square rounded-sm" style={{background:cell.count>0?`rgba(255,64,0,${0.1+(cell.count/maxCount)*0.9})`:'#f3f4f6'}} title={cell.day?`${cell.day}: ${cell.count} orders`:''} />
                  ))}
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 481: Revenue Velocity (rev per calendar day) (genel) ── */}
      {reportsTab === 'genel' && orders.length >= 5 && (() => {
        const now = new Date();
        const periods = [{label:'7d',days:7},{label:'30d',days:30},{label:'90d',days:90},{label:'365d',days:365}];
        const results = periods.map(p=>{
          const since=new Date(now.getTime()-p.days*86400000);
          const rev=orders.reduce((s,o)=>{
            const d=o.createdAt?((o.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(o.createdAt as string)):null;
            if(!d||d<since) return s;
            const oR=o as unknown as Record<string,unknown>;
            return s+(typeof oR.total==='number'?oR.total as number:(o.lineItems??[]).reduce((s2,li)=>{ const lr=li as unknown as Record<string,unknown>; return s2+((lr.quantity as number|undefined)??0)*((lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0); },0));
          },0);
          return {...p,rev,velocity:rev/p.days};
        });
        const maxV=Math.max(...results.map(r=>r.velocity),1);
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">Revenue Velocity (₺/day)</h3>
            <div className="space-y-2">
              {results.map(r=>(
                <div key={r.label} className="flex items-center gap-2">
                  <span className="text-xs w-10 text-gray-600">{r.label}</span>
                  <div className="flex-1 bg-gray-100 rounded-full h-5 overflow-hidden">
                    <div className="h-full rounded-full flex items-center pl-2" style={{width:`${(r.velocity/maxV)*100}%`,background:'#ff4000',minWidth:r.velocity>0?24:0}}>
                      <span className="text-white text-[9px] font-bold">{fmtAna(r.velocity,'K',1)}</span>
                    </div>
                  </div>
                  <span className="text-[9px] text-gray-400 w-14 text-right">{fmtAna(r.rev,'K',0)} tot</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 482: Weekend vs Weekday Orders (lojistik) ── */}
      {reportsTab === 'lojistik' && orders.length >= 5 && (() => {
        let weekdayCount=0,weekendCount=0,weekdayRev=0,weekendRev=0;
        orders.forEach(o=>{
          const d=o.createdAt?((o.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(o.createdAt as string)):null;
          if(!d) return;
          const oR=o as unknown as Record<string,unknown>;
          const total=typeof oR.total==='number'?oR.total as number:(o.lineItems??[]).reduce((s,li)=>{ const lr=li as unknown as Record<string,unknown>; return s+((lr.quantity as number|undefined)??0)*((lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0); },0);
          const isWeekend=d.getDay()===0||d.getDay()===6;
          if(isWeekend){weekendCount++;weekendRev+=total;}
          else{weekdayCount++;weekdayRev+=total;}
        });
        const totalOrders=weekdayCount+weekendCount;
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">Weekday vs Weekend Orders</h3>
            <div className="flex h-4 rounded-full overflow-hidden mb-3">
              <div style={{width:`${(weekdayCount/Math.max(totalOrders,1))*100}%`,background:'#3b82f6'}}/>
              <div style={{width:`${(weekendCount/Math.max(totalOrders,1))*100}%`,background:'#f59e0b'}}/>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {[{label:'Weekday',count:weekdayCount,rev:weekdayRev,color:'#3b82f6'},{label:'Weekend',count:weekendCount,rev:weekendRev,color:'#f59e0b'}].map(s=>(
                <div key={s.label} className="rounded-xl p-3" style={{background:`${s.color}12`}}>
                  <p className="text-sm font-bold" style={{color:s.color}}>{s.count} orders</p>
                  <p className="text-[10px] text-gray-500">{s.label}</p>
                  {s.rev>0&&<p className="text-[10px] text-gray-400">{fmtAna(s.rev,'K',1)} rev</p>}
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 483: New Customer Acquisition by Month (crm) ── */}
      {reportsTab === 'crm' && orders.length >= 5 && (() => {
        const custFirstMonth: Record<string,string> = {};
        [...orders].sort((a,b)=>{
          const da=a.createdAt?((a.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(a.createdAt as string)):new Date(0);
          const db=b.createdAt?((b.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(b.createdAt as string)):new Date(0);
          return da.getTime()-db.getTime();
        }).forEach(o=>{
          const d=o.createdAt?((o.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(o.createdAt as string)):null;
          if(!d) return;
          const cid=(o as unknown as Record<string,unknown>).customerId as string|undefined||(o as unknown as Record<string,unknown>).customerName as string|undefined||'Unknown';
          const key=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          if(!custFirstMonth[cid]) custFirstMonth[cid]=key;
        });
        const newByMonth: Record<string,number>={};
        Object.values(custFirstMonth).forEach(m=>{ newByMonth[m]=(newByMonth[m]??0)+1; });
        const months=Object.keys(newByMonth).sort().slice(-8);
        if(months.length<3) return null;
        const vals=months.map(m=>newByMonth[m]);
        const maxV=Math.max(...vals,1);
        const totalNew=vals.reduce((a,b)=>a+b,0);
        return (
          <div className="apple-card p-4 mb-4">
            <div className="flex justify-between items-center mb-3">
              <h3 className="font-semibold text-sm">New Customer Acquisition</h3>
              <span className="text-xs bg-green-100 text-green-700 rounded-full px-2 py-0.5">{totalNew} total</span>
            </div>
            <div className="flex items-end gap-2 h-20 mb-1">
              {vals.map((v,i)=>(
                <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                  <span className="text-[9px] text-gray-500">{v}</span>
                  <div className="w-full rounded-sm" style={{height:`${(v/maxV)*56}px`,background:'#22c55e',minHeight:v>0?2:0}}/>
                  <span className="text-[9px] text-gray-400">{months[i]?.slice(5)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 484: Most Active Products by Movement Events (envanter) ── */}
      {reportsTab === 'envanter' && inventoryMovements.length >= 5 && (() => {
        const eventCount: Record<string,{events:number;qty:number}> = {};
        inventoryMovements.forEach(m=>{
          const pid=m.productId as string;
          if(!eventCount[pid]) eventCount[pid]={events:0,qty:0};
          eventCount[pid].events++;
          eventCount[pid].qty+=(m.quantity??0);
        });
        const top=Object.entries(eventCount).sort((a,b)=>b[1].events-a[1].events).slice(0,7);
        if(top.length<2) return null;
        const maxEvents=top[0][1].events;
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">Most Active Products</h3>
            <div className="space-y-2">
              {top.map(([pid,d])=>{
                const name=inventory.find(i=>i.id===pid)?.name??pid;
                return (
                  <div key={pid} className="flex items-center gap-2">
                    <span className="text-xs truncate flex-1 text-gray-700">{name}</span>
                    <div className="w-16 bg-gray-100 rounded-full h-3 overflow-hidden">
                      <div className="h-full rounded-full" style={{width:`${(d.events/maxEvents)*100}%`,background:'#0ea5e9'}}/>
                    </div>
                    <span className="text-[10px] text-gray-500 w-10 text-right">{d.events} ev</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 485: Top 5 Revenue Products This Month (genel) ── */}
      {reportsTab === 'genel' && orders.length >= 3 && (() => {
        const now=new Date();
        const monthStart=new Date(now.getFullYear(),now.getMonth(),1);
        const productRev: Record<string,number>={};
        orders.forEach(o=>{
          const d=o.createdAt?((o.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(o.createdAt as string)):null;
          if(!d||d<monthStart) return;
          (o.lineItems??[]).forEach(li=>{ const lr=li as unknown as Record<string,unknown>; const name=(lr.productName as string|undefined)??(lr.name as string|undefined)??'Unknown'; const rev=((lr.quantity as number|undefined)??0)*((lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0); productRev[name]=(productRev[name]??0)+rev; });
        });
        const top5=Object.entries(productRev).sort((a,b)=>b[1]-a[1]).slice(0,5);
        if(top5.length===0) return null;
        const maxRev=top5[0][1];
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">Top Products This Month</h3>
            <div className="space-y-2">
              {top5.map(([name,rev],i)=>(
                <div key={name} className="flex items-center gap-2">
                  <span className="text-xs font-bold text-gray-400 w-4">#{i+1}</span>
                  <span className="text-xs truncate flex-1 text-gray-700">{name}</span>
                  <div className="w-16 bg-gray-100 rounded-full h-3 overflow-hidden">
                    <div className="h-full rounded-full" style={{width:`${(rev/maxRev)*100}%`,background:i===0?'#ff4000':'#6366f1'}}/>
                  </div>
                  <span className="text-[10px] font-bold text-gray-600 w-10 text-right">{fmtAna(rev,'K',0)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 486: Average Rating / Performance (ik) ── */}
      {reportsTab === 'ik' && employees.length >= 2 && (() => {
        const ratings=employees.map(e=>{
          const eR=e as unknown as Record<string,unknown>;
          return (eR.performanceRating as number|undefined)??(eR.rating as number|undefined)??(eR.score as number|undefined)??null;
        }).filter((r): r is number=>r!==null&&r>0);
        if(ratings.length<2) {
          return (
            <div className="apple-card p-4 mb-4">
              <h3 className="font-semibold text-sm mb-1">Performance Ratings</h3>
              <p className="text-sm text-gray-500">{employees.length} employees — no performance data yet</p>
            </div>
          );
        }
        const avg=ratings.reduce((a,b)=>a+b,0)/ratings.length;
        const bins=[1,2,3,4,5].map(s=>({star:s,count:ratings.filter(r=>Math.round(r)===s).length}));
        const maxBin=Math.max(...bins.map(b=>b.count),1);
        return (
          <div className="apple-card p-4 mb-4">
            <div className="flex justify-between items-center mb-3">
              <h3 className="font-semibold text-sm">Performance Ratings</h3>
              <span className="text-xs bg-yellow-100 text-yellow-700 rounded-full px-2 py-0.5">avg {avg.toFixed(1)}★</span>
            </div>
            <div className="space-y-1.5">
              {bins.map(b=>(
                <div key={b.star} className="flex items-center gap-2">
                  <span className="text-xs text-yellow-500 w-6">{b.star}★</span>
                  <div className="flex-1 bg-gray-100 rounded-full h-3 overflow-hidden">
                    <div className="h-full rounded-full" style={{width:`${(b.count/maxBin)*100}%`,background:'#f59e0b'}}/>
                  </div>
                  <span className="text-xs text-gray-500 w-4 text-right">{b.count}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 487: Stock Value at Risk (envanter) ── */}
      {reportsTab === 'envanter' && inventory.length >= 3 && (() => {
        const now=new Date();
        let expiredValue=0,nearExpiryValue=0,healthyValue=0;
        const in30=new Date(now.getTime()+30*86400000);
        inventory.forEach(item=>{
          const itemR=item as unknown as Record<string,unknown>;
          const expStr=(itemR.expiryDate as string|undefined)??(itemR.expiry as string|undefined)??(itemR.bestBefore as string|undefined);
          const retail=(item.prices?.['Retail'] as number|undefined)??0;
          const stk=(item.stock as number|undefined)??0;
          const val=retail*stk;
          if(!expStr) { healthyValue+=val; return; }
          const expDate=new Date(expStr);
          if(expDate<now) expiredValue+=val;
          else if(expDate<in30) nearExpiryValue+=val;
          else healthyValue+=val;
        });
        const total=expiredValue+nearExpiryValue+healthyValue;
        if(total===0) return null;
        const hasExpiryData=expiredValue+nearExpiryValue>0;
        if(!hasExpiryData) return null;
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">Stock Value at Risk (Expiry)</h3>
            <div className="flex h-4 rounded-full overflow-hidden mb-3">
              <div style={{width:`${(expiredValue/total)*100}%`,background:'#ef4444'}}/>
              <div style={{width:`${(nearExpiryValue/total)*100}%`,background:'#f59e0b'}}/>
              <div style={{width:`${(healthyValue/total)*100}%`,background:'#22c55e'}}/>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              {[{label:'Expired',val:expiredValue,color:'#ef4444'},{label:'<30d',val:nearExpiryValue,color:'#f59e0b'},{label:'Healthy',val:healthyValue,color:'#22c55e'}].map(s=>(
                <div key={s.label} className="rounded-xl p-2" style={{background:`${s.color}10`}}>
                  <p className="font-bold" style={{color:s.color}}>{fmtAna(s.val,'K',0)}</p>
                  <p className="text-gray-400">{s.label}</p>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 488: Order Value Trend (90-day line) (lojistik) ── */}
      {reportsTab === 'lojistik' && orders.length >= 5 && (() => {
        const now=new Date();
        const d90=new Date(now.getTime()-90*86400000);
        const recent=orders.filter(o=>{ const d=o.createdAt?((o.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(o.createdAt as string)):null; return d&&d>=d90; }).sort((a,b)=>{ const da=a.createdAt?((a.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(a.createdAt as string)):new Date(0); const db=b.createdAt?((b.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(b.createdAt as string)):new Date(0); return da.getTime()-db.getTime(); });
        if(recent.length<5) return null;
        const vals=recent.map(o=>{ const oR=o as unknown as Record<string,unknown>; return typeof oR.total==='number'?oR.total as number:(o.lineItems??[]).reduce((s,li)=>{ const lr=li as unknown as Record<string,unknown>; return s+((lr.quantity as number|undefined)??0)*((lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0); },0); });
        const step=Math.max(1,Math.floor(vals.length/30));
        const sampled=vals.filter((_,i)=>i%step===0);
        const maxV=Math.max(...sampled,1);
        const w=240;const h=60;const pad=8;
        const pts=sampled.map((v,i)=>`${pad+(i/(sampled.length-1))*(w-2*pad)},${h-pad-(v/maxV)*(h-2*pad)}`).join(' ');
        const avgVal=vals.reduce((a,b)=>a+b,0)/vals.length;
        return (
          <div className="apple-card p-4 mb-4">
            <div className="flex justify-between items-center mb-2">
              <h3 className="font-semibold text-sm">Order Values (90d)</h3>
              <span className="text-xs text-gray-500">avg {fmtAna(avgVal,'K',1)}</span>
            </div>
            <svg width="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{height:60}}>
              <line x1={pad} y1={h-pad-(avgVal/maxV)*(h-2*pad)} x2={w-pad} y2={h-pad-(avgVal/maxV)*(h-2*pad)} stroke="#e5e7eb" strokeWidth="1" strokeDasharray="4 4"/>
              <polyline points={pts} fill="none" stroke="#8b5cf6" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
        );
      })()}

      {/* ── Phase 489: Cross-Module Summary Dashboard (genel) ── */}
      {reportsTab === 'genel' && (() => {
        const now=new Date();
        const d30=new Date(now.getTime()-30*86400000);
        const orders30=orders.filter(o=>{ const d=o.createdAt?((o.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(o.createdAt as string)):null; return d&&d>=d30; }).length;
        const lowStockCount=inventory.filter(i=>{ const stk=(i.stock as number|undefined)??0; const threshold=(i.reorderPoint as number|undefined)??(i.lowStockThreshold as number|undefined)??5; return stk<=threshold&&stk>0; }).length;
        const activeOrders=orders.filter(o=>o.status==='Processing'||o.status==='Pending'||o.status==='Shipped').length;
        const stats=[
          {label:'Orders (30d)',val:String(orders30),icon:'📦',color:'#3b82f6'},
          {label:'Active Orders',val:String(activeOrders),icon:'⚙️',color:'#f59e0b'},
          {label:'SKUs',val:String(inventory.length),icon:'🗃️',color:'#22c55e'},
          {label:'Low Stock',val:String(lowStockCount),icon:'⚠️',color:lowStockCount>0?'#ef4444':'#22c55e'},
          {label:'Employees',val:String(employees.length),icon:'👥',color:'#8b5cf6'},
          {label:'Quotes',val:String(quotations.length),icon:'📋',color:'#0ea5e9'},
        ];
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">Cross-Module Overview</h3>
            <div className="grid grid-cols-3 gap-2">
              {stats.map(s=>(
                <div key={s.label} className="rounded-xl p-2 text-center" style={{background:`${s.color}10`}}>
                  <p className="text-sm">{s.icon}</p>
                  <p className="text-xl font-bold" style={{color:s.color}}>{s.val}</p>
                  <p className="text-[9px] text-gray-400">{s.label}</p>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 490: Inventory Reorder Forecast (envanter) ── */}
      {reportsTab === 'envanter' && inventory.length >= 3 && inventoryMovements.length >= 5 && (() => {
        const now=new Date();
        const outRates: Record<string,number>={};
        const oldest=inventoryMovements.reduce((o,m)=>{ const d=m.date?((m.date as {toDate?:()=>Date}).toDate?.()??new Date(m.date as string)):null; return (d&&d<o)?d:o; },now);
        const months=Math.max((now.getTime()-oldest.getTime())/(30*86400000),1);
        inventoryMovements.filter(m=>m.type==='out').forEach(m=>{ outRates[m.productId as string]=(outRates[m.productId as string]??0)+(m.quantity??0)/months; });
        const forecast=inventory
          .map(item=>{
            const rate=outRates[item.id]??0;
            const stk=(item.stock as number|undefined)??0;
            const rp=(item.reorderPoint as number|undefined)??(item.lowStockThreshold as number|undefined)??5;
            if(rate<=0||stk>rp) return null;
            const daysToStockout=rate>0?Math.floor(stk/rate*30):999;
            return {name:item.name,stock:stk,rate:rate.toFixed(1),days:daysToStockout};
          })
          .filter((i): i is NonNullable<typeof i>=>i!==null&&i.days<90)
          .sort((a,b)=>a.days-b.days)
          .slice(0,6);
        if(forecast.length===0) return null;
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
              <span>📊 Reorder Forecast</span>
              <span className="text-xs bg-orange-100 text-orange-700 rounded-full px-2 py-0.5">{forecast.length} items</span>
            </h3>
            <div className="space-y-2">
              {forecast.map((item,i)=>(
                <div key={i} className="flex items-center gap-2">
                  <div className="flex-1">
                    <span className="text-xs text-gray-700">{item.name}</span>
                    <span className="text-[9px] text-gray-400 ml-2">×{item.stock} • {item.rate}/mo</span>
                  </div>
                  <span className="text-xs font-bold" style={{color:item.days<=14?'#ef4444':item.days<=30?'#f59e0b':'#6b7280'}}>
                    {item.days}d left
                  </span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 491: Monthly Order Volume Trend (genel) ── */}
      {reportsTab === 'genel' && orders.length >= 5 && (() => {
        const byMonth: Record<string,number>={};
        orders.forEach(o=>{ const d=o.createdAt?((o.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(o.createdAt as string)):null; if(!d) return; const key=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; byMonth[key]=(byMonth[key]??0)+1; });
        const months=Object.keys(byMonth).sort().slice(-10);
        if(months.length<3) return null;
        const vals=months.map(m=>byMonth[m]);
        const maxV=Math.max(...vals,1);
        const trend=vals.length>=2?vals[vals.length-1]-vals[vals.length-2]:0;
        const w=240;const h=60;const pad=8;
        const pts=vals.map((v,i)=>`${pad+(i/(vals.length-1))*(w-2*pad)},${h-pad-(v/maxV)*(h-2*pad)}`).join(' ');
        return (
          <div className="apple-card p-4 mb-4">
            <div className="flex justify-between items-center mb-2">
              <h3 className="font-semibold text-sm">Monthly Order Volume</h3>
              <span className="text-xs" style={{color:trend>=0?'#22c55e':'#ef4444'}}>{trend>=0?'+':''}{trend} MoM</span>
            </div>
            <svg width="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{height:60}}>
              <defs><linearGradient id="volGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#3b82f6" stopOpacity="0.25"/><stop offset="100%" stopColor="#3b82f6" stopOpacity="0"/></linearGradient></defs>
              <polygon points={`${pad},${h-pad} ${pts} ${pad+(vals.length-1)/(vals.length-1)*(w-2*pad)},${h-pad}`} fill="url(#volGrad)"/>
              <polyline points={pts} fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              {vals.map((v,i)=><circle key={i} cx={pad+(i/(vals.length-1))*(w-2*pad)} cy={h-pad-(v/maxV)*(h-2*pad)} r="2.5" fill="#3b82f6"/>)}
            </svg>
            <div className="flex justify-between text-[9px] text-gray-400 mt-1"><span>{months[0]?.slice(5)}</span><span>{months[months.length-1]?.slice(5)}</span></div>
          </div>
        );
      })()}

      {/* ── Phase 492: Products Never Quoted (crm) ── */}
      {reportsTab === 'crm' && quotations.length >= 2 && inventory.length >= 3 && (() => {
        const quotedProductNames = new Set<string>();
        quotations.forEach(q=>{ (q as unknown as Record<string,unknown>); const items=((q as unknown as Record<string,unknown>).items as {productName?:string;name?:string}[]|undefined)??[]; items.forEach(i=>{ const n=i.productName??i.name; if(n) quotedProductNames.add(n); }); });
        const neverQuoted=inventory.filter(item=>!quotedProductNames.has(item.name)&&((item.stock as number|undefined)??0)>0).slice(0,6);
        if(neverQuoted.length===0) return null;
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
              <span>💤 Products Never Quoted</span>
              <span className="text-xs bg-gray-100 text-gray-600 rounded-full px-2 py-0.5">{neverQuoted.length} shown</span>
            </h3>
            <div className="space-y-1.5">
              {neverQuoted.map((item,i)=>(
                <div key={i} className="flex items-center justify-between text-xs">
                  <span className="truncate flex-1 text-gray-700">{item.name}</span>
                  <span className="text-gray-400 ml-2">×{(item.stock as number|undefined)??0}</span>
                  <span className="text-gray-500 ml-2">{(item.prices?.['Retail'] as number|undefined) != null ? fmtAna((item.prices?.['Retail'] as number)) : '—'}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 493: Employee Onboarding Queue (ik) ── */}
      {reportsTab === 'ik' && employees.length >= 1 && (() => {
        const now=new Date();
        const d90=new Date(now.getTime()-90*86400000);
        const onboarding=employees
          .map(e=>{
            const d=e.startDate?((e.startDate as unknown as {toDate?:()=>Date}).toDate?.()??new Date(e.startDate as string)):null;
            if(!d||isNaN(d.getTime())||d<d90) return null;
            const eR=e as unknown as Record<string,unknown>;
            const daysIn=Math.floor((now.getTime()-d.getTime())/86400000);
            return { name:(eR.name as string|undefined)??(eR.firstName as string|undefined)??'New Hire', dept:e.department??'', daysIn, progress:Math.min(Math.round((daysIn/90)*100),100) };
          })
          .filter((e): e is NonNullable<typeof e>=>e!==null)
          .sort((a,b)=>b.daysIn-a.daysIn);
        if(onboarding.length===0) return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-1">Onboarding Queue</h3>
            <p className="text-sm text-gray-500">No employees in their first 90 days</p>
          </div>
        );
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
              <span>🎓 Onboarding (90-day)</span>
              <span className="text-xs bg-blue-100 text-blue-700 rounded-full px-2 py-0.5">{onboarding.length}</span>
            </h3>
            <div className="space-y-3">
              {onboarding.map((e,i)=>(
                <div key={i}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="font-medium text-gray-700">{e.name}{e.dept&&<span className="text-gray-400"> · {e.dept}</span>}</span>
                    <span className="text-gray-500">Day {e.daysIn}/90</span>
                  </div>
                  <div className="bg-gray-100 rounded-full h-2 overflow-hidden">
                    <div className="h-full rounded-full" style={{width:`${e.progress}%`,background:e.progress>=75?'#22c55e':e.progress>=40?'#3b82f6':'#f59e0b'}}/>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 545: Product Revenue Performance Table ── */}
      {reportsTab === 'urunler' && (() => {
        // Build product revenue map from order lineItems
        type ProdStat = { name: string; sku: string; quantity: number; revenue: number; orderCount: number; avgOrderValue: number };
        const prodMap: Record<string, ProdStat> = {};
        for (const o of orders) {
          if (o.status === 'Cancelled') continue;
          for (const li of (o.lineItems ?? [])) {
            const liR = li as unknown as Record<string, unknown>;
            const name = (liR.name as string | undefined) ?? (liR.productName as string | undefined) ?? (liR.title as string | undefined) ?? 'Unknown';
            const sku  = (liR.sku as string | undefined) ?? '';
            const qty  = Number(liR.quantity ?? 1) || 1;
            const up   = Number(liR.unitPrice ?? liR.price ?? liR.variant_price ?? 0) || 0;
            const rev  = qty * up;
            const key  = sku || name;
            if (!prodMap[key]) prodMap[key] = { name, sku, quantity: 0, revenue: 0, orderCount: 0, avgOrderValue: 0 };
            prodMap[key].quantity  += qty;
            prodMap[key].revenue   += rev;
            prodMap[key].orderCount++;
          }
        }
        const products = Object.values(prodMap)
          .map(p => ({ ...p, avgOrderValue: p.orderCount > 0 ? p.revenue / p.orderCount : 0 }))
          .sort((a, b) => b.revenue - a.revenue);
        const totalRevenue = products.reduce((s, p) => s + p.revenue, 0);

        // ABC classification
        let cumPct = 0;
        const classified = products.map(p => {
          const pct = totalRevenue > 0 ? (p.revenue / totalRevenue) * 100 : 0;
          cumPct += pct;
          const cls: 'A' | 'B' | 'C' = cumPct <= 70 ? 'A' : cumPct <= 90 ? 'B' : 'C';
          return { ...p, pct, cls };
        });

        const countA = classified.filter(p => p.cls === 'A').length;
        const countB = classified.filter(p => p.cls === 'B').length;
        const countC = classified.filter(p => p.cls === 'C').length;

        if (products.length === 0) return (
          <div className="apple-card p-12 text-center space-y-3">
            <Package className="w-12 h-12 text-gray-200 mx-auto" />
            <p className="text-gray-400 text-sm">
              {currentLanguage === 'tr' ? 'Sipariş satır kalemlerinde ürün verisi yok' : 'No product data found in order line items'}
            </p>
          </div>
        );

        return (
          <div className="space-y-4">
            {/* KPI Strip */}
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: currentLanguage === 'tr' ? 'A Sınıfı Ürün' : 'Class A Items', value: countA, cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', desc: currentLanguage === 'tr' ? 'Gelirin %70\'i' : '70% of revenue' },
                { label: currentLanguage === 'tr' ? 'B Sınıfı Ürün' : 'Class B Items', value: countB, cls: 'bg-amber-50 text-amber-700 border-amber-200', desc: currentLanguage === 'tr' ? 'Gelirin %20\'si' : '20% of revenue' },
                { label: currentLanguage === 'tr' ? 'C Sınıfı Ürün' : 'Class C Items', value: countC, cls: 'bg-gray-50 text-gray-600 border-gray-200', desc: currentLanguage === 'tr' ? 'Gelirin %10\'u' : '10% of revenue' },
              ].map(k => (
                <div key={k.label} className={`rounded-xl border px-4 py-3 ${k.cls}`}>
                  <p className="text-2xl font-black">{k.value}</p>
                  <p className="text-[10px] font-bold uppercase tracking-wide mt-0.5">{k.label}</p>
                  <p className="text-[10px] opacity-70">{k.desc}</p>
                </div>
              ))}
            </div>

            {/* Product table */}
            <div className="apple-card overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
                <Package className="w-4 h-4 text-brand" />
                <h3 className="font-bold text-gray-800 text-sm">
                  {currentLanguage === 'tr' ? 'Ürün Bazında Satış Performansı' : 'Product Revenue Performance'}
                </h3>
                <span className="text-[10px] font-bold bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full ml-auto">{products.length} {currentLanguage === 'tr' ? 'ürün' : 'products'}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="bg-gray-50 border-b border-gray-100">
                    <tr>
                      <th className="px-4 py-3 text-[10px] font-bold text-gray-400 uppercase tracking-wider w-8">#</th>
                      <th className="px-4 py-3 text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                        {currentLanguage === 'tr' ? 'Ürün' : 'Product'}
                      </th>
                      <th className="px-4 py-3 text-[10px] font-bold text-gray-400 uppercase tracking-wider text-center">ABC</th>
                      <th className="px-4 py-3 text-[10px] font-bold text-gray-400 uppercase tracking-wider text-right">
                        {currentLanguage === 'tr' ? 'Adet' : 'Qty'}
                      </th>
                      <th className="px-4 py-3 text-[10px] font-bold text-gray-400 uppercase tracking-wider text-right">
                        {currentLanguage === 'tr' ? 'Sipariş' : 'Orders'}
                      </th>
                      <th className="px-4 py-3 text-[10px] font-bold text-gray-400 uppercase tracking-wider text-right">
                        {currentLanguage === 'tr' ? 'Gelir' : 'Revenue'}
                      </th>
                      <th className="px-4 py-3 text-[10px] font-bold text-gray-400 uppercase tracking-wider text-right">
                        {currentLanguage === 'tr' ? 'Pay' : 'Share'}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {classified.map((p, i) => {
                      const barW = totalRevenue > 0 ? (p.revenue / classified[0].revenue) * 100 : 0;
                      return (
                        <tr key={i} className="hover:bg-gray-50 transition-colors">
                          <td className="px-4 py-3 text-[10px] font-bold text-gray-400">{i + 1}</td>
                          <td className="px-4 py-3">
                            <div>
                              <p className="font-semibold text-gray-800 text-xs truncate max-w-[200px]">{p.name}</p>
                              {p.sku && <p className="text-[10px] text-gray-400 font-mono">{p.sku}</p>}
                              <div className="w-full bg-gray-100 rounded-full h-1 mt-1.5 overflow-hidden">
                                <div className="h-full rounded-full bg-brand/60" style={{ width: `${barW}%` }} />
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${p.cls === 'A' ? 'bg-emerald-100 text-emerald-700' : p.cls === 'B' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-500'}`}>
                              {p.cls}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right text-xs font-semibold text-gray-700">{p.quantity.toLocaleString('tr-TR')}</td>
                          <td className="px-4 py-3 text-right text-xs text-gray-500">{p.orderCount}</td>
                          <td className="px-4 py-3 text-right text-xs font-bold text-gray-800">₺{p.revenue.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}</td>
                          <td className="px-4 py-3 text-right">
                            <span className="text-[10px] font-bold text-gray-500">{p.pct.toFixed(1)}%</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="bg-gray-50 border-t border-gray-200">
                    <tr>
                      <td colSpan={5} className="px-4 py-3 text-xs font-bold text-gray-500 uppercase">{currentLanguage === 'tr' ? 'Toplam' : 'Total'}</td>
                      <td className="px-4 py-3 text-right text-sm font-black text-gray-800">₺{totalRevenue.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}</td>
                      <td className="px-4 py-3 text-right text-xs font-bold text-gray-500">100%</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Phase 494: Order Value Distribution Histogram (lojistik) ── */}
      {reportsTab === 'lojistik' && orders.length >= 5 && (() => {
        const orderValues=orders.map(o=>{ const oR=o as unknown as Record<string,unknown>; return typeof oR.total==='number'?oR.total as number:(o.lineItems??[]).reduce((s,li)=>{ const lr=li as unknown as Record<string,unknown>; return s+((lr.quantity as number|undefined)??0)*((lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0); },0); }).filter(v=>v>0);
        if(orderValues.length<3) return null;
        const sorted=[...orderValues].sort((a,b)=>a-b);
        const min=sorted[0]; const max=sorted[sorted.length-1];
        const range=max-min||1;
        const bucketCount=6;
        const bucketSize=range/bucketCount;
        const buckets=Array.from({length:bucketCount},(_,i)=>({min:min+i*bucketSize,max:min+(i+1)*bucketSize,count:0}));
        orderValues.forEach(v=>{ const idx=Math.min(Math.floor((v-min)/bucketSize),bucketCount-1); buckets[idx].count++; });
        const maxCount=Math.max(...buckets.map(b=>b.count),1);
        const median=sorted[Math.floor(sorted.length/2)];
        return (
          <div className="apple-card p-4 mb-4">
            <div className="flex justify-between items-center mb-3">
              <h3 className="font-semibold text-sm">Order Value Distribution</h3>
              <span className="text-xs text-gray-500">median {fmtAna(median,'K',1)}</span>
            </div>
            <div className="flex items-end gap-1 h-20 mb-1">
              {buckets.map((b,i)=>(
                <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                  <span className="text-[9px] text-gray-500">{b.count>0?b.count:''}</span>
                  <div className="w-full rounded-sm" style={{height:`${(b.count/maxCount)*56}px`,background:'#6366f1',minHeight:b.count>0?2:0}}/>
                  <span className="text-[8px] text-gray-400">{b.min>=1000?`₺${(b.min/1000).toFixed(0)}k`:`₺${b.min.toFixed(0)}`}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 495: Revenue Forecast Next 3 Months (genel) ── */}
      {reportsTab === 'genel' && orders.length >= 10 && (() => {
        const byMonth: Record<string,number>={};
        orders.forEach(o=>{ const d=o.createdAt?((o.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(o.createdAt as string)):null; if(!d) return; const key=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; const oR=o as unknown as Record<string,unknown>; const total=typeof oR.total==='number'?oR.total as number:(o.lineItems??[]).reduce((s,li)=>{ const lr=li as unknown as Record<string,unknown>; return s+((lr.quantity as number|undefined)??0)*((lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0); },0); byMonth[key]=(byMonth[key]??0)+total; });
        const months=Object.keys(byMonth).sort().slice(-4);
        if(months.length<3) return null;
        const vals=months.map(m=>byMonth[m]);
        const growthRates=vals.slice(1).map((v,i)=>vals[i]>0?(v-vals[i])/vals[i]:0);
        const avgGrowth=growthRates.reduce((a,b)=>a+b,0)/growthRates.length;
        const lastRev=vals[vals.length-1];
        const now=new Date();
        const forecasts=[1,2,3].map(i=>{ const d=new Date(now.getFullYear(),now.getMonth()+i,1); return { month:`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`, rev:lastRev*Math.pow(1+avgGrowth,i) }; });
        const allVals=[...vals,...forecasts.map(f=>f.rev)];
        const maxV=Math.max(...allVals,1);
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">3-Month Revenue Forecast</h3>
            <div className="flex items-end gap-2 h-24 mb-1">
              {vals.map((v,i)=><div key={i} className="flex-1 flex flex-col items-center gap-0.5"><div className="w-full rounded-sm" style={{height:`${(v/maxV)*72}px`,background:'#ff4000'}}/><span className="text-[9px] text-gray-400">{months[i]?.slice(5)}</span></div>)}
              {forecasts.map((f,i)=><div key={f.month} className="flex-1 flex flex-col items-center gap-0.5"><span className="text-[8px] text-indigo-400">{fmtAna(f.rev,'K',0)}</span><div className="w-full rounded-sm border-2 border-dashed border-indigo-300" style={{height:`${(f.rev/maxV)*72}px`,background:`rgba(99,102,241,${0.15+i*0.1})`}}/><span className="text-[9px] text-indigo-400">{f.month.slice(5)}</span></div>)}
            </div>
            <p className="text-[10px] text-gray-400 text-center">Based on {(avgGrowth*100).toFixed(1)}% avg monthly growth</p>
          </div>
        );
      })()}

      {/* ── Phase 496: Re-Engaged Customers (crm) ── */}
      {reportsTab === 'crm' && orders.length >= 8 && (() => {
        const now=new Date();
        const custLastOrder: Record<string,Date>={};
        const custOrders: Record<string,{date:Date;gap:number}[]>={};
        [...orders].sort((a,b)=>{ const da=a.createdAt?((a.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(a.createdAt as string)):new Date(0); const db=b.createdAt?((b.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(b.createdAt as string)):new Date(0); return da.getTime()-db.getTime(); }).forEach(o=>{
          const d=o.createdAt?((o.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(o.createdAt as string)):null; if(!d) return;
          const cid=(o as unknown as Record<string,unknown>).customerName as string|undefined||(o as unknown as Record<string,unknown>).customerId as string|undefined||'Unknown';
          const prev=custLastOrder[cid];
          const gap=prev?Math.floor((d.getTime()-prev.getTime())/86400000):0;
          if(!custOrders[cid]) custOrders[cid]=[];
          if(prev&&gap>=60) custOrders[cid].push({date:d,gap});
          custLastOrder[cid]=d;
        });
        const reEngaged=Object.entries(custOrders).filter(([,arr])=>arr.length>0&&arr[arr.length-1].date>new Date(now.getTime()-90*86400000)).length;
        const totalReEngagements=Object.values(custOrders).reduce((s,arr)=>s+arr.length,0);
        if(totalReEngagements===0) return null;
        const avgGap=totalReEngagements>0?Math.round(Object.values(custOrders).flatMap(a=>a.map(e=>e.gap)).reduce((a,b)=>a+b,0)/totalReEngagements):0;
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">Customer Re-Engagement</h3>
            <div className="grid grid-cols-3 gap-2 text-center">
              {[{label:'Total Re-engaged',val:String(totalReEngagements),color:'#22c55e'},{label:'Recent (90d)',val:String(reEngaged),color:'#3b82f6'},{label:'Avg Gap',val:`${avgGap}d`,color:'#f59e0b'}].map(s=>(
                <div key={s.label} className="rounded-xl p-3" style={{background:`${s.color}12`}}>
                  <p className="text-xl font-bold" style={{color:s.color}}>{s.val}</p>
                  <p className="text-[9px] text-gray-400">{s.label}</p>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 497: Inventory Fill Rate (envanter) ── */}
      {reportsTab === 'envanter' && inventory.length >= 3 && inventoryMovements.length >= 5 && (() => {
        const now=new Date();
        const d30=new Date(now.getTime()-30*86400000);
        const recentOut=inventoryMovements.filter(m=>m.type==='out').filter(m=>{ const d=m.date?((m.date as {toDate?:()=>Date}).toDate?.()??new Date(m.date as string)):null; return d&&d>=d30; });
        const recentIn=inventoryMovements.filter(m=>m.type==='in').filter(m=>{ const d=m.date?((m.date as {toDate?:()=>Date}).toDate?.()??new Date(m.date as string)):null; return d&&d>=d30; });
        const totalOut=recentOut.reduce((s,m)=>s+(m.quantity??0),0);
        const totalIn=recentIn.reduce((s,m)=>s+(m.quantity??0),0);
        const fillRate=totalOut>0?Math.min(Math.round((totalIn/totalOut)*100),200):100;
        const inProducts=new Set(recentIn.map(m=>m.productId as string)).size;
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">Inventory Fill Rate (30d)</h3>
            <div className="flex items-center gap-4 mb-3">
              <div className="text-center">
                <p className="text-3xl font-bold" style={{color:fillRate>=100?'#22c55e':fillRate>=70?'#f59e0b':'#ef4444'}}>{fillRate}%</p>
                <p className="text-[10px] text-gray-500">in/out ratio</p>
              </div>
              <div className="flex-1 space-y-1.5 text-xs">
                <div className="flex justify-between"><span className="text-green-600">In (30d)</span><span className="font-bold">{totalIn} units</span></div>
                <div className="flex justify-between"><span className="text-red-500">Out (30d)</span><span className="font-bold">{totalOut} units</span></div>
                <div className="flex justify-between"><span className="text-gray-500">SKUs replenished</span><span className="font-bold">{inProducts}</span></div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Phase 498: Shipments This Month KPI (lojistik) ── */}
      {reportsTab === 'lojistik' && orders.length >= 1 && (() => {
        const now=new Date();
        const monthStart=new Date(now.getFullYear(),now.getMonth(),1);
        const thisMonth=orders.filter(o=>{ const d=o.createdAt?((o.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(o.createdAt as string)):null; return d&&d>=monthStart; });
        const shipped=thisMonth.filter(o=>o.status==='Shipped'||o.status==='Delivered').length;
        const pending=thisMonth.filter(o=>o.status==='Pending').length;
        const processing=thisMonth.filter(o=>o.status==='Processing').length;
        const rev=thisMonth.reduce((s,o)=>{ const oR=o as unknown as Record<string,unknown>; return s+(typeof oR.total==='number'?oR.total as number:(o.lineItems??[]).reduce((s2,li)=>{ const lr=li as unknown as Record<string,unknown>; return s2+((lr.quantity as number|undefined)??0)*((lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0); },0)); },0);
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">This Month's Logistics</h3>
            <div className="grid grid-cols-2 gap-2 mb-3">
              <div className="rounded-xl p-3 bg-purple-50 text-center">
                <p className="text-2xl font-bold text-purple-600">{shipped}</p>
                <p className="text-[10px] text-gray-500">Shipped/Delivered</p>
              </div>
              <div className="rounded-xl p-3 bg-brand/10 text-center">
                <p className="text-2xl font-bold text-brand">{fmtAna(rev,'K',1)}</p>
                <p className="text-[10px] text-gray-500">Revenue</p>
              </div>
            </div>
            <div className="flex justify-between text-xs text-gray-500">
              <span>Pending: <strong>{pending}</strong></span>
              <span>Processing: <strong>{processing}</strong></span>
              <span>Total: <strong>{thisMonth.length}</strong></span>
            </div>
          </div>
        );
      })()}

      {/* ── Phase 499: Quotation Approval Rate (crm) ── */}
      {reportsTab === 'crm' && quotations.length >= 3 && (() => {
        const statusMap: Record<string,number>={};
        quotations.forEach(q=>{ const s=((q as unknown as Record<string,unknown>).status as string|undefined)??'Unknown'; statusMap[s]=(statusMap[s]??0)+1; });
        const approved=(statusMap['Approved']??0)+(statusMap['Accepted']??0)+(statusMap['Won']??0);
        const rejected=(statusMap['Rejected']??0)+(statusMap['Declined']??0)+(statusMap['Lost']??0);
        const converted=(statusMap['Converted']??0)+(statusMap['Ordered']??0);
        const total=quotations.length;
        const approvalRate=total>0?Math.round(((approved+converted)/total)*100):0;
        const segments=[{label:'Approved/Won',count:approved+converted,color:'#22c55e'},{label:'Pending',count:total-approved-converted-rejected,color:'#f59e0b'},{label:'Rejected',count:rejected,color:'#ef4444'}].filter(s=>s.count>0);
        return (
          <div className="apple-card p-4 mb-4">
            <div className="flex justify-between items-center mb-3">
              <h3 className="font-semibold text-sm">Quotation Approval Rate</h3>
              <span className="text-xs bg-green-100 text-green-700 rounded-full px-2 py-0.5">{approvalRate}%</span>
            </div>
            <div className="flex h-4 rounded-full overflow-hidden mb-3">
              {segments.map(s=>s.count>0&&<div key={s.label} style={{width:`${(s.count/total)*100}%`,background:s.color}} title={`${s.label}: ${s.count}`}/>)}
            </div>
            <div className="grid grid-cols-3 gap-1 text-center">
              {segments.map(s=>(
                <div key={s.label}>
                  <p className="text-lg font-bold" style={{color:s.color}}>{s.count}</p>
                  <p className="text-[9px] text-gray-400">{s.label}</p>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 500: 🏆 Analytics Milestone — 500 Phases (genel) ── */}
      {reportsTab === 'genel' && (() => {
        const totalOrders=orders.length;
        const totalInventory=inventory.length;
        const totalEmployees=employees.length;
        const totalQuotations=quotations.length;
        return (
          <div className="apple-card p-4 mb-4 overflow-hidden relative">
            <div className="absolute inset-0 opacity-5" style={{background:'repeating-linear-gradient(45deg,#ff4000,#ff4000 10px,transparent 10px,transparent 20px)'}}/>
            <div className="relative">
              <div className="text-center mb-3">
                <p className="text-4xl mb-1">🏆</p>
                <h3 className="font-bold text-base text-brand">500 Analytics Phases</h3>
                <p className="text-xs text-gray-500">Complete ERP Intelligence Dashboard</p>
              </div>
              <div className="grid grid-cols-2 gap-2 mb-3">
                {[{label:'Orders',val:totalOrders,icon:'📦'},{label:'SKUs',val:totalInventory,icon:'🗃️'},{label:'Employees',val:totalEmployees,icon:'👥'},{label:'Quotations',val:totalQuotations,icon:'📋'}].map(m=>(
                  <div key={m.label} className="rounded-xl p-2 bg-white/60 text-center">
                    <p className="text-sm">{m.icon}</p>
                    <p className="text-xl font-bold text-brand">{m.val}</p>
                    <p className="text-[9px] text-gray-500">{m.label}</p>
                  </div>
                ))}
              </div>
              <div className="text-center">
                <p className="text-[10px] text-gray-400">Covering General · CRM · Inventory · Logistics · HR</p>
                <p className="text-[10px] text-gray-300 mt-0.5">Cetpa B2B Analytics Engine v2026</p>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Phase 320: Inventory Ageing Pyramid (envanter) ── */}
      {reportsTab === 'envanter' && inventory.length >= 5 && inventoryMovements.length >= 3 && (() => {
        const now = new Date();
        const lastSaleByProduct: Record<string, Date> = {};
        inventoryMovements.filter(m => m.type === 'out').forEach(m => {
          const d = (m.timestamp as {toDate?:()=>Date}).toDate?.() ?? new Date(m.timestamp as string);
          const key = m.productName || 'Unknown';
          if (!lastSaleByProduct[key] || d > lastSaleByProduct[key]) lastSaleByProduct[key] = d;
        });
        const tiers = [
          {label: 'Fresh (≤30d)', min: 0, max: 30, color: '#10b981'},
          {label: 'Active (31–90d)', min: 30, max: 90, color: '#3b82f6'},
          {label: 'Slow (91–180d)', min: 90, max: 180, color: '#f59e0b'},
          {label: 'Ageing (181–365d)', min: 180, max: 365, color: '#f97316'},
          {label: 'Dead (365d+)', min: 365, max: Infinity, color: '#ef4444'},
        ];
        const tierData = tiers.map(t => {
          const items = inventory.filter(item => {
            if (item.stockLevel <= 0) return false;
            const lastSale = lastSaleByProduct[item.name];
            const daysSince = lastSale ? Math.floor((now.getTime() - lastSale.getTime()) / 86400000) : 999;
            return daysSince >= t.min && daysSince < t.max;
          });
          return {
            ...t,
            count: items.length,
            value: items.reduce((s, i) => s + i.stockLevel * (i.costPrice || 0), 0),
          };
        });
        const totalValue = tierData.reduce((s, t) => s + t.value, 0);
        if (totalValue === 0) return null;
        const maxValue = Math.max(...tierData.map(t => t.value), 1);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Inventory Ageing Pyramid</h3>
            <p className="text-xs text-gray-500 mb-4">Stock value by days since last sale — total: {fmtAna(totalValue)}</p>
            <div className="space-y-2">
              {tierData.map((t, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs text-gray-600 w-32">{t.label}</span>
                  <div className="flex-1 h-5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{width: `${maxValue > 0 ? t.value / maxValue * 100 : 0}%`, background: t.color}} />
                  </div>
                  <span className="text-xs text-gray-500 w-8">{t.count} SKU</span>
                  <span className="text-xs font-bold w-24 text-right" style={{color: t.color}}>{fmtAna(t.value)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

    </div>
  );
};

export default ReportsDashboard;
