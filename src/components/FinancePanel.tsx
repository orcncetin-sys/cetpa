import React, { useState } from 'react';
import { motion } from 'motion/react';
import { DollarSign, TrendingUp, TrendingDown, FileText, Clock, CheckCircle2, AlertCircle } from 'lucide-react';

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

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
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
