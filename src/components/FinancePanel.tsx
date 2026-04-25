import React, { useState } from 'react';
import { motion } from 'motion/react';
import { DollarSign, TrendingUp, TrendingDown, FileText, Clock, CheckCircle2, AlertCircle, AlarmClock, Waves } from 'lucide-react';

interface Order {
  id?: string;
  shopifyOrderId?: string | number;
  customerName?: string;
  totalPrice?: number;
  cost?: number;
  status?: string;
  hasInvoice?: boolean;
  paid?: boolean;        // Phase 98
  syncedAt?: { toDate?: () => Date } | string | number;
  createdAt?: { toDate?: () => Date } | string | number;
}

interface FinancePanelProps {
  orders: Order[];
  currentLanguage: 'tr' | 'en';
  exchangeRates?: Record<string, number> | null;
  displayCurrency?: 'TRY' | 'USD' | 'EUR';
}

const toDate = (val: Order['syncedAt']): Date => {
  if (!val) return new Date();
  if (typeof val === 'object' && 'toDate' in val && typeof val.toDate === 'function') return val.toDate();
  return new Date(val as string | number);
};

const FinancePanel: React.FC<FinancePanelProps> = ({ orders, currentLanguage, exchangeRates, displayCurrency: externalCurrency }) => {
  const [sort, setSort] = useState<{key: string; dir: 'asc'|'desc'}>({key: 'date', dir: 'desc'});
  const [localCurrency, setLocalCurrency] = useState<'TRY'|'USD'|'EUR'>('TRY');
  const toggleSort = (key: string) => setSort(s => ({key, dir: s.key === key && s.dir === 'asc' ? 'desc' : 'asc'}));

  // Use external currency if provided, otherwise local toggle
  const currency = externalCurrency ?? localCurrency;
  const fxRate   = currency === 'USD' ? (exchangeRates?.USD || 1) : currency === 'EUR' ? (exchangeRates?.EUR || 1) : 1;
  const sym      = currency === 'TRY' ? '₺' : currency === 'USD' ? '$' : '€';
  const cvt      = (v: number) => (currency === 'TRY' ? v : v / fxRate).toLocaleString('tr-TR', { maximumFractionDigits: 0 });

  const totalRevenue = orders.reduce((sum, o) => sum + (o.totalPrice || 0), 0);
  const totalCost    = orders.reduce((sum, o) => sum + (o.cost || 0), 0);
  const profit       = totalRevenue - totalCost;

  const recentOrders = [...orders]
    .sort((a, b) => {
      if (sort.key === 'date') {
        const av = toDate(a.syncedAt || a.createdAt).getTime();
        const bv = toDate(b.syncedAt || b.createdAt).getTime();
        return sort.dir === 'asc' ? av - bv : bv - av;
      }
      const av = (a as Record<string, unknown>)[sort.key] as string | number ?? '';
      const bv = (b as Record<string, unknown>)[sort.key] as string | number ?? '';
      if (av < bv) return sort.dir === 'asc' ? -1 : 1;
      if (av > bv) return sort.dir === 'asc' ? 1 : -1;
      return 0;
    })
    .slice(0, 10);

  const statusColor = (status?: string) => {
    switch (status) {
      case 'Delivered': return 'bg-green-100 text-green-700';
      case 'Shipped':   return 'bg-blue-100 text-blue-700';
      case 'Processing':return 'bg-yellow-100 text-yellow-700';
      case 'Cancelled': return 'bg-red-100 text-red-700';
      default:          return 'bg-gray-100 text-gray-600';
    }
  };

  const statusLabel = (status?: string) => {
    if (currentLanguage === 'en') return status || '—';
    const map: Record<string, string> = {
      Delivered: 'Teslim Edildi', Shipped: 'Kargoda', Processing: 'İşleniyor',
      Cancelled: 'İptal', Pending: 'Bekliyor'
    };
    return map[status || ''] || status || '—';
  };

  const kpis = [
    { label: currentLanguage === 'tr' ? 'Toplam Ciro' : 'Total Revenue', value: `${sym}${cvt(totalRevenue)}`, icon: DollarSign, color: 'text-green-600', bg: 'bg-green-50' },
    { label: currentLanguage === 'tr' ? 'Toplam Maliyet' : 'Total Cost',  value: `${sym}${cvt(totalCost)}`,    icon: TrendingDown, color: 'text-red-500',   bg: 'bg-red-50'   },
    { label: currentLanguage === 'tr' ? 'Net Kâr' : 'Net Profit',          value: `${sym}${cvt(profit)}`,       icon: TrendingUp,   color: 'text-blue-600', bg: 'bg-blue-50'  },
  ];

  // Phase 98: Unpaid revenue analytics
  const unpaidOrders  = orders.filter(o => !o.paid && o.status !== 'Cancelled');
  const unpaidRevenue = unpaidOrders.reduce((s, o) => s + (o.totalPrice || 0), 0);
  const paidRevenue   = orders.filter(o => o.paid).reduce((s, o) => s + (o.totalPrice || 0), 0);
  const collectionRate = totalRevenue > 0 ? Math.round((paidRevenue / totalRevenue) * 100) : 0;

  // ── Phase 127: Financial Health Score ───────────────────────────────────
  const marginPct = totalRevenue > 0 ? Math.round(((totalRevenue - totalCost) / totalRevenue) * 100) : 0;
  const deliveryRate = orders.length > 0 ? Math.round((orders.filter(o => o.status === 'Delivered').length / orders.length) * 100) : 0;
  const healthScore = Math.round((collectionRate * 0.4) + (Math.min(marginPct, 50) * 0.6) + (deliveryRate * 0.2)) ;
  const clampedScore = Math.min(100, Math.max(0, healthScore));
  const scoreColor = clampedScore >= 70 ? 'text-emerald-600' : clampedScore >= 40 ? 'text-amber-600' : 'text-red-500';
  const scoreLabel = clampedScore >= 70
    ? (currentLanguage === 'tr' ? 'Sağlıklı' : 'Healthy')
    : clampedScore >= 40
    ? (currentLanguage === 'tr' ? 'Orta' : 'Moderate')
    : (currentLanguage === 'tr' ? 'Dikkat' : 'Attention');

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
      {/* ── Phase 127: Financial Health Score ── */}
      <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-bold text-gray-800">{currentLanguage === 'tr' ? 'Finansal Sağlık Skoru' : 'Financial Health Score'}</h3>
            <p className="text-[10px] text-gray-400 mt-0.5">{currentLanguage === 'tr' ? 'Tahsilat · Kâr Marjı · Teslimat' : 'Collection · Margin · Delivery'}</p>
          </div>
          <div className="text-right">
            <span className={`text-3xl font-black ${scoreColor}`}>{clampedScore}</span>
            <span className="text-gray-300 text-lg font-bold">/100</span>
            <p className={`text-xs font-bold ${scoreColor}`}>{scoreLabel}</p>
          </div>
        </div>
        {/* Score bar */}
        <div className="w-full bg-gray-100 rounded-full h-3 overflow-hidden mb-3">
          <div
            className={`h-3 rounded-full transition-all duration-1000 ${clampedScore >= 70 ? 'bg-emerald-400' : clampedScore >= 40 ? 'bg-amber-400' : 'bg-red-400'}`}
            style={{ width: `${clampedScore}%` }}
          />
        </div>
        {/* Component metrics */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: currentLanguage === 'tr' ? 'Tahsilat' : 'Collection', value: collectionRate, unit: '%', weight: 40 },
            { label: currentLanguage === 'tr' ? 'Kâr Marjı' : 'Margin', value: marginPct, unit: '%', weight: 40 },
            { label: currentLanguage === 'tr' ? 'Teslimat' : 'Delivery', value: deliveryRate, unit: '%', weight: 20 },
          ].map(m => (
            <div key={m.label} className="text-center">
              <p className={`text-lg font-bold ${m.value >= 50 ? 'text-emerald-600' : m.value >= 25 ? 'text-amber-600' : 'text-red-500'}`}>{m.value}{m.unit}</p>
              <p className="text-[10px] text-gray-400">{m.label}</p>
              <div className="w-full bg-gray-100 rounded-full h-1 mt-1 overflow-hidden">
                <div className={`h-1 rounded-full ${m.value >= 50 ? 'bg-emerald-400' : m.value >= 25 ? 'bg-amber-400' : 'bg-red-400'}`} style={{ width: `${Math.min(m.value, 100)}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Phase 98: Unpaid Revenue Alert */}
      {unpaidOrders.length > 0 && (
        <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-2xl px-5 py-4">
          <div className="w-9 h-9 rounded-xl bg-amber-100 flex items-center justify-center flex-shrink-0">
            <AlertCircle className="w-5 h-5 text-amber-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-amber-800">
              {currentLanguage === 'tr'
                ? `${unpaidOrders.length} siparişte ödeme tahsil edilmedi`
                : `${unpaidOrders.length} order${unpaidOrders.length !== 1 ? 's' : ''} with pending payment`}
            </p>
            <p className="text-xs text-amber-600 mt-0.5">
              {sym}{cvt(unpaidRevenue)} {currentLanguage === 'tr' ? 'tahsil bekliyor' : 'outstanding'} · {currentLanguage === 'tr' ? 'Tahsilat Oranı' : 'Collection Rate'}: <strong>{collectionRate}%</strong>
            </p>
          </div>
          <div className="flex-shrink-0">
            <div className="w-24 bg-amber-200 rounded-full h-2">
              <div className="bg-emerald-500 h-2 rounded-full transition-all" style={{ width: `${collectionRate}%` }} />
            </div>
            <p className="text-[9px] text-amber-600 font-bold text-right mt-1">{collectionRate}% {currentLanguage === 'tr' ? 'tahsil' : 'collected'}</p>
          </div>
        </div>
      )}
      {/* ── Phase 105: Invoice Aging Table ── */}
      {unpaidOrders.length > 0 && (() => {
        const now = Date.now();
        type AgingBucket = { label: string; days: string; orders: Order[]; color: string; bg: string; dot: string };
        const buckets: AgingBucket[] = [
          { label: currentLanguage === 'tr' ? 'Güncel (0–30 gün)' : 'Current (0–30 d)',  days: '0-30',  orders: [], color: 'text-emerald-700', bg: 'bg-emerald-50', dot: 'bg-emerald-400' },
          { label: currentLanguage === 'tr' ? 'Orta (31–60 gün)'  : 'Moderate (31–60 d)', days: '31-60', orders: [], color: 'text-amber-700',   bg: 'bg-amber-50',   dot: 'bg-amber-400'  },
          { label: currentLanguage === 'tr' ? 'Kritik (61–90 gün)': 'Serious (61–90 d)',  days: '61-90', orders: [], color: 'text-orange-700',  bg: 'bg-orange-50',  dot: 'bg-orange-400' },
          { label: currentLanguage === 'tr' ? 'Gecikmiş (90+ gün)': 'Overdue (90+ d)',    days: '90+',   orders: [], color: 'text-red-700',     bg: 'bg-red-50',     dot: 'bg-red-500'    },
        ];
        unpaidOrders.forEach(o => {
          const d = toDate(o.createdAt);
          const days = Math.floor((now - d.getTime()) / 86400000);
          if      (days <= 30) buckets[0].orders.push(o);
          else if (days <= 60) buckets[1].orders.push(o);
          else if (days <= 90) buckets[2].orders.push(o);
          else                 buckets[3].orders.push(o);
        });
        const activeBuckets = buckets.filter(b => b.orders.length > 0);
        if (activeBuckets.length === 0) return null;
        const maxAmt = Math.max(...activeBuckets.map(b => b.orders.reduce((s, o) => s + (o.totalPrice || 0), 0)), 1);
        return (
          <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
              <AlarmClock size={16} className="text-orange-400" />
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? 'Alacak Vade Analizi' : 'AR Aging Analysis'}</h3>
              <span className="ml-auto text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                {currentLanguage === 'tr' ? 'Ödenmemiş siparişler' : 'Unpaid orders'}
              </span>
            </div>
            <div className="divide-y divide-gray-50">
              {buckets.map((b, bi) => {
                if (b.orders.length === 0) return null;
                const amt = b.orders.reduce((s, o) => s + (o.totalPrice || 0), 0);
                const barW = Math.round((amt / maxAmt) * 100);
                return (
                  <div key={bi} className="px-5 py-3.5 flex items-center gap-4">
                    <div className="flex items-center gap-2 w-44 flex-shrink-0">
                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${b.dot}`} />
                      <span className="text-xs font-semibold text-gray-700 truncate">{b.label}</span>
                    </div>
                    <div className="flex-1 flex items-center gap-3">
                      <div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden">
                        <div
                          className={`h-2 rounded-full transition-all duration-700 ${b.dot}`}
                          style={{ width: `${barW}%` }}
                        />
                      </div>
                      <span className={`text-xs font-bold flex-shrink-0 w-20 text-right ${b.color}`}>
                        {sym}{cvt(amt)}
                      </span>
                    </div>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${b.bg} ${b.color}`}>
                      {b.orders.length} {currentLanguage === 'tr' ? 'sipariş' : 'order'}{b.orders.length !== 1 ? (currentLanguage === 'en' ? 's' : '') : ''}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="px-5 py-2.5 bg-gray-50 border-t border-gray-100 flex justify-between items-center">
              <span className="text-[10px] text-gray-400">
                {currentLanguage === 'tr' ? 'Toplam tahsil edilmemiş' : 'Total outstanding'}
              </span>
              <span className="text-xs font-black text-gray-800">{sym}{cvt(unpaidRevenue)}</span>
            </div>
          </div>
        );
      })()}

      {/* KPI Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {kpis.map((k, i) => {
          const Icon = k.icon;
          return (
            <div key={i} className={`apple-card p-6 ${k.bg} relative`}>
              {/* Currency toggle — only on first card */}
              {i === 0 && !externalCurrency && (
                <button
                  onClick={() => setLocalCurrency(c => c === 'TRY' ? 'USD' : c === 'USD' ? 'EUR' : 'TRY')}
                  className="absolute top-3 right-3 text-[9px] font-bold bg-white/70 px-1.5 py-0.5 rounded-full text-gray-500 hover:bg-white transition-colors border border-gray-200"
                >
                  {currency}
                </button>
              )}
              <div className="flex items-center gap-3 mb-2">
                <Icon className={k.color} size={20} />
                <h3 className="text-sm font-bold text-gray-500">{k.label}</h3>
              </div>
              <p className={`text-3xl font-bold ${k.color}`}>{k.value}</p>
            </div>
          );
        })}
      </div>

      {/* Invoice / Order Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { label: currentLanguage === 'tr' ? 'Faturalı Sipariş' : 'Invoiced Orders',   value: orders.filter(o => o.hasInvoice).length,              icon: CheckCircle2, color: 'text-green-600' },
          { label: currentLanguage === 'tr' ? 'Faturasız Sipariş' : 'Uninvoiced',        value: orders.filter(o => !o.hasInvoice).length,             icon: AlertCircle,  color: 'text-orange-500' },
          { label: currentLanguage === 'tr' ? 'Toplam Sipariş' : 'Total Orders',          value: orders.length,                                         icon: FileText,     color: 'text-blue-600' },
        ].map((s, i) => {
          const Icon = s.icon;
          return (
            <div key={i} className="apple-card p-5 flex items-center gap-4">
              <div className="p-2 bg-gray-50 rounded-xl"><Icon className={s.color} size={22} /></div>
              <div>
                <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">{s.label}</p>
                <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Phase 109: Cash Flow Forecast ── */}
      {(() => {
        const now109 = new Date();
        const startOfWeek = (d: Date) => {
          const copy = new Date(d);
          copy.setHours(0, 0, 0, 0);
          copy.setDate(copy.getDate() - copy.getDay());
          return copy;
        };
        const weekLabel = (offset: number) => {
          const d = new Date(now109);
          d.setDate(d.getDate() + offset * 7);
          return d.toLocaleDateString(currentLanguage === 'tr' ? 'tr-TR' : 'en-US', { month: 'short', day: 'numeric' });
        };

        // Build 8 weeks: -3 past, current, +4 future
        const weeks = Array.from({ length: 8 }, (_, i) => {
          const weekOffset = i - 3;
          const weekStart = startOfWeek(new Date(now109.getTime() + weekOffset * 7 * 86400000));
          const weekEnd   = new Date(weekStart.getTime() + 7 * 86400000);
          const isCurrent = weekOffset === 0;
          const isFuture  = weekOffset > 0;

          const relevant = orders.filter(o => {
            const raw = o.syncedAt || o.createdAt;
            if (!raw) return false;
            const d = toDate(raw as Order['syncedAt']);
            return d >= weekStart && d < weekEnd;
          });

          const collected = relevant.filter(o => o.paid).reduce((s, o) => s + (o.totalPrice || 0), 0);
          const expected  = relevant.filter(o => !o.paid && o.status !== 'Cancelled').reduce((s, o) => s + (o.totalPrice || 0), 0);
          const inflow    = isFuture ? expected : collected;

          return { weekOffset, isCurrent, isFuture, inflow, collected, expected, label: weekLabel(weekOffset * 7) };
        });

        const maxVal = Math.max(...weeks.map(w => w.inflow), 1);
        const totalForecast = weeks.filter(w => w.isFuture).reduce((s, w) => s + w.inflow, 0);

        return (
          <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Waves size={16} className="text-blue-400" />
                <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? 'Nakit Akış Tahmini' : 'Cash Flow Forecast'}</h3>
              </div>
              <span className="text-[10px] text-gray-400">
                {currentLanguage === 'tr' ? '4 haftalık tahmin' : '4-week projection'} · {sym}{cvt(totalForecast)}
              </span>
            </div>
            <div className="px-5 py-4">
              <div className="flex items-end gap-1.5 h-28">
                {weeks.map((w, i) => {
                  const barH = maxVal > 0 ? Math.max((w.inflow / maxVal) * 100, w.inflow > 0 ? 8 : 0) : 0;
                  const barColor = w.isCurrent
                    ? 'bg-brand'
                    : w.isFuture
                    ? 'bg-blue-300'
                    : 'bg-emerald-300';
                  return (
                    <div key={i} className="flex-1 flex flex-col items-center gap-1" title={`${w.label}: ${sym}${cvt(w.inflow)}`}>
                      <div className="w-full flex flex-col justify-end" style={{ height: '80px' }}>
                        <div
                          className={`w-full rounded-t-md transition-all duration-500 ${barColor} ${w.isFuture ? 'opacity-60' : ''}`}
                          style={{ height: `${barH}%` }}
                        />
                      </div>
                      <span className={`text-[8px] font-bold text-center leading-tight ${w.isCurrent ? 'text-brand' : 'text-gray-400'}`}>
                        {w.label}
                      </span>
                    </div>
                  );
                })}
              </div>
              <div className="flex items-center gap-4 mt-3 pt-3 border-t border-gray-50">
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-sm bg-emerald-300 flex-shrink-0" />
                  <span className="text-[10px] text-gray-400">{currentLanguage === 'tr' ? 'Tahsil edilen' : 'Collected'}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-sm bg-brand flex-shrink-0" />
                  <span className="text-[10px] text-gray-400">{currentLanguage === 'tr' ? 'Bu hafta' : 'This week'}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-sm bg-blue-300 flex-shrink-0" />
                  <span className="text-[10px] text-gray-400">{currentLanguage === 'tr' ? 'Beklenen' : 'Expected'}</span>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Recent Invoices Table */}
      <div className="apple-card overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-2">
          <Clock size={16} className="text-gray-400" />
          <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? 'Son Siparişler / Faturalar' : 'Recent Orders / Invoices'}</h3>
          <span className="ml-auto text-xs text-gray-400">{currentLanguage === 'tr' ? 'Son 10 kayıt' : 'Last 10 records'}</span>
        </div>
        {recentOrders.length === 0 ? (
          <div className="p-12 text-center">
            <FileText className="mx-auto mb-3 text-gray-300" size={40} />
            <p className="text-gray-400 text-sm">{currentLanguage === 'tr' ? 'Henüz sipariş verisi yok.' : 'No order data yet.'}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  {[
                    {k:'shopifyOrderId', label: currentLanguage==='tr'?'Sipariş No':'Order #', align:'text-left', cls:''},
                    {k:'customerName', label: currentLanguage==='tr'?'Müşteri':'Customer', align:'text-left', cls:'hidden sm:table-cell'},
                    {k:'totalPrice', label: currentLanguage==='tr'?'Tutar':'Amount', align:'text-right', cls:''},
                    {k:'status', label: currentLanguage==='tr'?'Durum':'Status', align:'text-center', cls:''},
                    {k:'date', label: currentLanguage==='tr'?'Tarih':'Date', align:'text-center', cls:'hidden md:table-cell'},
                  ].map(({k, label, align, cls}) => {
                    const active = sort.key === k;
                    return (
                      <th key={k} onClick={() => toggleSort(k)} className={`py-3 px-5 ${align} text-[10px] font-bold uppercase tracking-wider cursor-pointer select-none transition-colors ${cls} ${active?'text-brand':'text-gray-400 hover:text-gray-600'}`}>
                        {label} <span className={active?'opacity-100':'opacity-25'}>{active?(sort.dir==='asc'?'↑':'↓'):'↕'}</span>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {recentOrders.map((o, i) => (
                  <tr key={o.id || i} className="hover:bg-gray-50/50 transition-all">
                    <td className="py-3.5 px-5 font-mono text-xs text-gray-600">
                      #{String(o.shopifyOrderId || o.id || '').slice(-8) || '—'}
                    </td>
                    <td className="py-3.5 px-5 font-medium text-gray-800 hidden sm:table-cell">{o.customerName || '—'}</td>
                    <td className="py-3.5 px-5 text-right font-bold text-gray-900">
                      {sym}{cvt(o.totalPrice || 0)}
                    </td>
                    <td className="py-3.5 px-5 text-center">
                      <span className={`text-[10px] font-bold px-2 py-1 rounded-full ${statusColor(o.status)}`}>
                        {statusLabel(o.status)}
                      </span>
                    </td>
                    <td className="py-3.5 px-5 text-center hidden md:table-cell">
                      {o.hasInvoice
                        ? <CheckCircle2 size={16} className="text-green-500 mx-auto" />
                        : <Clock size={16} className="text-gray-300 mx-auto" />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </motion.div>
  );
};

export default FinancePanel;
