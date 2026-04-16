import React, { useState, useEffect, useMemo } from 'react';
import { motion } from 'motion/react';
import { AlertTriangle, TrendingUp, ShieldCheck, DollarSign, Users } from 'lucide-react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { logFirestoreError, OperationType } from '../utils/firebase';

interface CustomerRisk {
  id: string;
  customerName: string;
  currentBalance: number;
  creditLimit: number;
  riskScore: number;
  [key: string]: unknown;
}

type ExchangeRates = Record<string, number>;

interface RiskPanelProps {
  orders: { id: string, customerName: string, status: string, totalPrice: number, dueDate?: string | { toDate?: () => Date }, syncedAt?: string | { toDate?: () => Date }, shopifyOrderId?: string, leadId?: string }[];
  leads: { id: string, name: string, company?: string, paymentTerms?: string }[];
  currentLanguage: 'tr' | 'en';
  userRole: string | null;
  setActiveTab?: (tab: string) => void;
  exchangeRates?: ExchangeRates | null;
}

type Currency = 'TRY' | 'USD' | 'EUR';

// ─── Currency helpers ─────────────────────────────────────────────────────────
function convertAmount(tryAmount: number, currency: Currency, rates?: ExchangeRates | null): number {
  if (currency === 'TRY' || !rates) return tryAmount;
  const rate = currency === 'USD' ? rates.USD : rates.EUR;
  return rate ? tryAmount / rate : tryAmount;
}

function formatAmount(tryAmount: number, currency: Currency, rates?: ExchangeRates | null): string {
  const val = convertAmount(tryAmount, currency, rates);
  if (currency === 'USD') return `$${val.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  if (currency === 'EUR') return `€${val.toLocaleString('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  return `₺${val.toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

// ─── Currency Toggle ──────────────────────────────────────────────────────────
function CurrencyToggle({ active, onChange }: { active: Currency; onChange: (c: Currency) => void }) {
  return (
    <div className="flex items-center gap-0.5 bg-gray-100 rounded-full p-0.5">
      {(['TRY', 'USD', 'EUR'] as Currency[]).map(c => (
        <button
          key={c}
          onClick={e => { e.stopPropagation(); onChange(c); }}
          className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full transition-all ${active === c ? 'bg-white shadow text-gray-800' : 'text-gray-400 hover:text-gray-600'}`}
        >
          {c === 'TRY' ? '₺' : c === 'USD' ? '$' : '€'}
        </button>
      ))}
    </div>
  );
}

// ─── SortTh ──────────────────────────────────────────────────────────────────
function SortTh({ k, label, sort, onSort, align = 'left' }: {
  k: string; label: string;
  sort: { key: string; dir: 'asc' | 'desc' };
  onSort: (k: string) => void;
  align?: 'left' | 'right' | 'center';
}) {
  const active = sort.key === k;
  return (
    <th
      onClick={() => onSort(k)}
      className={`cursor-pointer select-none py-3 px-4 text-${align} text-[10px] font-bold uppercase tracking-wider transition-colors whitespace-nowrap ${active ? 'text-brand' : 'text-gray-400 hover:text-gray-600'}`}
    >
      {label}{' '}
      <span className={active ? 'opacity-100' : 'opacity-25'}>{active ? (sort.dir === 'asc' ? '↑' : '↓') : '↕'}</span>
    </th>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────
const RiskPanel: React.FC<RiskPanelProps> = ({ orders, leads, currentLanguage, userRole, setActiveTab, exchangeRates }) => {
  const [risks, setRisks] = useState<CustomerRisk[]>([]);
  const [activeFilter, setActiveFilter] = useState<'all' | 'highRisk' | 'exposure' | 'overdue'>('all');
  const [activeCurrency, setActiveCurrency] = useState<Currency>('TRY');
  const [riskSort, setRiskSort] = useState<{key: string; dir: 'asc'|'desc'}>({key: 'riskScore', dir: 'desc'});
  const [overdueSort, setOverdueSort] = useState<{key: string; dir: 'asc'|'desc'}>({key: 'customerName', dir: 'asc'});

  useEffect(() => {
    if (!userRole) return;
    const unsubscribe = onSnapshot(collection(db, 'customerRisks'), (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as CustomerRisk));
      setRisks(data);
    }, (error) => logFirestoreError(error, OperationType.LIST, 'customerRisks'));
    return () => unsubscribe();
  }, [userRole]);

  const kpis = useMemo(() => {
    const totalExposure = risks.reduce((sum, r) => sum + (Number(r.currentBalance) || 0), 0);
    const highRiskCount = risks.filter(r => Number(r.riskScore) > 70).length;
    const avgRiskScore = risks.length > 0 ? (risks.reduce((sum, r) => sum + Number(r.riskScore), 0) / risks.length).toFixed(1) : 0;
    return { totalExposure, highRiskCount, avgRiskScore };
  }, [risks]);

  const chartData = useMemo(() => {
    const tr = currentLanguage === 'tr';
    const categories: Record<string, number> = {
      [tr ? 'Düşük' : 'Low']: 0,
      [tr ? 'Orta' : 'Mid']: 0,
      [tr ? 'Yüksek' : 'High']: 0
    };
    risks.forEach(r => {
      const score = Number(r.riskScore);
      if (score < 40) categories[tr ? 'Düşük' : 'Low']++;
      else if (score < 70) categories[tr ? 'Orta' : 'Mid']++;
      else categories[tr ? 'Yüksek' : 'High']++;
    });
    return Object.entries(categories).map(([name, value]) => ({ name, value }));
  }, [risks, currentLanguage]);

  const [currentPage, setCurrentPage] = useState(1);
  const ordersPerPage = 5;

  const overdueOrders = useMemo(() => {
    const now = new Date();
    return orders.filter(o => {
      if (o.status === 'Delivered' || o.status === 'Cancelled') return false;
      const lead = leads.find(l => l.id === o.leadId || l.name === o.customerName);
      let daysAllowed = 30;
      if (lead?.paymentTerms) {
        const match = lead.paymentTerms.match(/\d+/);
        if (match) daysAllowed = parseInt(match[0], 10);
      }
      const orderDate = (o.syncedAt && typeof o.syncedAt === 'object' && 'toDate' in o.syncedAt && typeof o.syncedAt.toDate === 'function')
        ? o.syncedAt.toDate()
        : new Date((o.syncedAt as string) || now);
      const dueDate = new Date(orderDate);
      dueDate.setDate(dueDate.getDate() + daysAllowed);
      return now > dueDate;
    });
  }, [orders, leads]);

  const filteredRisks = useMemo(() => {
    let base = risks;
    if (activeFilter === 'highRisk') base = risks.filter(r => Number(r.riskScore) > 70);
    else if (activeFilter === 'exposure') base = risks.filter(r => (Number(r.currentBalance) || 0) > 0);
    return [...base].sort((a, b) => {
      const av = Number(a[riskSort.key]) || String(a[riskSort.key] || '');
      const bv = Number(b[riskSort.key]) || String(b[riskSort.key] || '');
      if (av < bv) return riskSort.dir === 'asc' ? -1 : 1;
      if (av > bv) return riskSort.dir === 'asc' ? 1 : -1;
      return 0;
    });
  }, [risks, activeFilter, riskSort]);

  const sortedOverdue = useMemo(() => [...overdueOrders].sort((a, b) => {
    const av = (a as Record<string, unknown>)[overdueSort.key] as string | number ?? '';
    const bv = (b as Record<string, unknown>)[overdueSort.key] as string | number ?? '';
    if (av < bv) return overdueSort.dir === 'asc' ? -1 : 1;
    if (av > bv) return overdueSort.dir === 'asc' ? 1 : -1;
    return 0;
  }), [overdueOrders, overdueSort]);

  const totalPages = Math.ceil(sortedOverdue.length / ordersPerPage);
  const currentOverdueOrders = sortedOverdue.slice((currentPage - 1) * ordersPerPage, currentPage * ordersPerPage);

  const tr = currentLanguage === 'tr';

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">

      {/* Currency rate context bar */}
      {exchangeRates && (
        <div className="flex items-center gap-3 text-[10px] text-gray-500 bg-white/70 backdrop-blur rounded-xl px-4 py-2 border border-gray-100 w-fit">
          <span className="font-semibold text-gray-600">{tr ? 'Canlı Kur:' : 'Live Rate:'}</span>
          <span>$ <b className="text-gray-800">₺{exchangeRates.USD.toFixed(2)}</b></span>
          <span>€ <b className="text-gray-800">₺{exchangeRates.EUR.toFixed(2)}</b></span>
          {activeCurrency !== 'TRY' && (
            <span className="text-brand font-bold">
              {tr ? `Değerler ${activeCurrency} cinsinden gösteriliyor` : `Values shown in ${activeCurrency}`}
            </span>
          )}
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {/* Card 1 — Toplam Riskli Bakiye (with currency toggle) */}
        <button
          onClick={() => setActiveFilter('exposure')}
          className={`apple-card p-5 text-left flex flex-col gap-3 ${activeFilter === 'exposure' ? 'ring-2 ring-brand/20' : ''}`}
        >
          <div className="flex items-center justify-between">
            <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
              <DollarSign className="w-5 h-5 text-blue-600" />
            </div>
            <CurrencyToggle active={activeCurrency} onChange={setActiveCurrency} />
          </div>
          <div>
            <p className="text-[11px] text-[#86868B] font-medium uppercase tracking-wide">{tr ? 'Toplam Riskli Bakiye' : 'Total Exposure'}</p>
            <p className="text-2xl font-bold text-gray-900 mt-0.5">{formatAmount(kpis.totalExposure, activeCurrency, exchangeRates)}</p>
          </div>
        </button>

        {/* Card 2 — Yüksek Riskli Müşteri */}
        <button
          onClick={() => setActiveFilter('highRisk')}
          className={`apple-card p-5 text-left flex flex-col gap-3 ${activeFilter === 'highRisk' ? 'ring-2 ring-red-200' : ''}`}
        >
          <div className="flex items-center justify-between">
            <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center">
              <AlertTriangle className="w-5 h-5 text-red-500" />
            </div>
          </div>
          <div>
            <p className="text-[11px] text-[#86868B] font-medium uppercase tracking-wide">{tr ? 'Yüksek Riskli Müşteri' : 'High Risk Customers'}</p>
            <p className="text-2xl font-bold text-gray-900 mt-0.5">{kpis.highRiskCount}</p>
          </div>
        </button>

        {/* Card 3 — Geciken Siparişler */}
        <button
          onClick={() => { document.getElementById('overdue-section')?.scrollIntoView({ behavior: 'smooth' }); setActiveFilter('all'); }}
          className={`apple-card p-5 text-left flex flex-col gap-3 ${activeFilter === 'overdue' ? 'ring-2 ring-amber-200' : ''}`}
        >
          <div className="flex items-center justify-between">
            <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center">
              <TrendingUp className="w-5 h-5 text-amber-500" />
            </div>
          </div>
          <div>
            <p className="text-[11px] text-[#86868B] font-medium uppercase tracking-wide">{tr ? 'Geciken Siparişler' : 'Overdue Orders'}</p>
            <p className="text-2xl font-bold text-gray-900 mt-0.5">{overdueOrders.length}</p>
          </div>
        </button>

        {/* Card 4 — Ortalama Risk Skoru */}
        <button
          onClick={() => setActiveFilter('all')}
          className={`apple-card p-5 text-left flex flex-col gap-3 ${activeFilter === 'all' ? 'ring-2 ring-green-200' : ''}`}
        >
          <div className="flex items-center justify-between">
            <div className="w-10 h-10 rounded-xl bg-green-50 flex items-center justify-center">
              <ShieldCheck className="w-5 h-5 text-green-500" />
            </div>
          </div>
          <div>
            <p className="text-[11px] text-[#86868B] font-medium uppercase tracking-wide">{tr ? 'Ortalama Risk Skoru' : 'Avg Risk Score'}</p>
            <p className="text-2xl font-bold text-gray-900 mt-0.5">{kpis.avgRiskScore}</p>
          </div>
        </button>
      </div>

      {/* Main Dashboard */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Risk Distribution Chart */}
        <div className="lg:col-span-1 apple-card p-6">
          <div className="flex items-center justify-between mb-6">
            <h3 className="font-bold text-gray-800">{tr ? 'Risk Dağılımı' : 'Risk Distribution'}</h3>
            {activeFilter !== 'all' && (
              <button onClick={() => setActiveFilter('all')} className="text-xs text-brand font-bold hover:underline">
                {tr ? 'Temizle' : 'Clear'}
              </button>
            )}
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                  {chartData.map((entry, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={
                        entry.name === (tr ? 'Yüksek' : 'High') ? '#ef4444' :
                        entry.name === (tr ? 'Orta' : 'Mid') ? '#f59e0b' : '#10b981'
                      }
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Detailed Table */}
        <div className="lg:col-span-2 apple-card overflow-hidden">
          <div className="p-6 border-b border-gray-100 flex items-center justify-between">
            <h3 className="font-bold text-gray-800">
              {tr ? 'Müşteri Bazlı Detaylar' : 'Customer Details'}
              {activeFilter !== 'all' && (
                <span className="ml-2 text-xs font-normal text-gray-400">
                  ({filteredRisks.length} {tr ? 'kayıt' : 'records'})
                </span>
              )}
            </h3>
            <button onClick={() => setActiveTab?.('accounting')} className="apple-button-secondary py-1.5 px-3 text-xs">
              <DollarSign size={12} />
              {tr ? 'Bakiye Raporu' : 'Balance Report'}
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <SortTh k="customerName" label={tr ? 'Müşteri' : 'Customer'} sort={riskSort} onSort={k => setRiskSort(s => ({key:k, dir:s.key===k&&s.dir==='asc'?'desc':'asc'}))} />
                  <SortTh k="currentBalance" label={`${tr?'Bakiye':'Balance'} (${activeCurrency})`} sort={riskSort} onSort={k => setRiskSort(s => ({key:k, dir:s.key===k&&s.dir==='asc'?'desc':'asc'}))} align="right" />
                  <SortTh k="creditLimit" label={`${tr?'Limit':'Limit'} (${activeCurrency})`} sort={riskSort} onSort={k => setRiskSort(s => ({key:k, dir:s.key===k&&s.dir==='asc'?'desc':'asc'}))} align="right" />
                  <SortTh k="riskScore" label={tr?'Skor':'Score'} sort={riskSort} onSort={k => setRiskSort(s => ({key:k, dir:s.key===k&&s.dir==='asc'?'desc':'asc'}))} align="center" />
                  <th className="px-4 py-3 text-center text-[10px] font-bold text-gray-400 uppercase tracking-wider">{tr?'İşlem':'Action'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredRisks.length > 0 ? filteredRisks.map((c) => {
                  const currentBalance = Number(c.currentBalance || 0);
                  const creditLimit = Number(c.creditLimit || 0);
                  const riskScore = Number(c.riskScore || 0);
                  return (
                    <tr key={c.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 font-medium">{String(c.customerName || '')}</td>
                      <td className="px-6 py-4 text-right font-mono text-sm">{formatAmount(currentBalance, activeCurrency, exchangeRates)}</td>
                      <td className="px-6 py-4 text-right font-mono text-sm">{formatAmount(creditLimit, activeCurrency, exchangeRates)}</td>
                      <td className="px-6 py-4 text-center">
                        <span className={`px-2 py-1 rounded-full text-xs font-bold ${riskScore > 70 ? 'bg-red-100 text-red-600' : riskScore > 40 ? 'bg-amber-100 text-amber-600' : 'bg-green-100 text-green-600'}`}>
                          {riskScore}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <button onClick={() => setActiveTab?.('muhasebe')} className="action-btn-view" title={tr ? 'Muhasebe Detayı' : 'Accounting Detail'}>
                          <Users size={14} />
                        </button>
                      </td>
                    </tr>
                  );
                }) : (
                  <tr>
                    <td colSpan={5} className="px-6 py-8 text-center text-gray-400 text-sm">
                      {tr ? 'Kayıt bulunamadı.' : 'No records found.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Overdue Orders */}
      <div id="overdue-section" className="apple-card overflow-hidden">
        <div className="p-6 border-b border-gray-100 flex justify-between items-center">
          <div>
            <h3 className="font-bold text-gray-800">{tr ? 'Ödemesi Geciken Siparişler' : 'Overdue Orders'}</h3>
            <p className="text-xs text-gray-400 mt-0.5">{tr ? 'Vade tarihi geçmiş ve henüz ödenmemiş' : 'Past due date, unpaid'}</p>
          </div>
          <div className="flex items-center gap-2">
            <CurrencyToggle active={activeCurrency} onChange={setActiveCurrency} />
            <span className="bg-red-100 text-red-600 px-3 py-1 rounded-full text-xs font-bold">
              {overdueOrders.length} {tr ? 'Sipariş' : 'Orders'}
            </span>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <SortTh k="shopifyOrderId" label={tr?'Sipariş ID':'Order ID'} sort={overdueSort} onSort={k => setOverdueSort(s => ({key:k, dir:s.key===k&&s.dir==='asc'?'desc':'asc'}))} />
                <SortTh k="customerName" label={tr?'Müşteri':'Customer'} sort={overdueSort} onSort={k => setOverdueSort(s => ({key:k, dir:s.key===k&&s.dir==='asc'?'desc':'asc'}))} />
                <SortTh k="totalPrice" label={`${tr?'Tutar':'Amount'} (${activeCurrency})`} sort={overdueSort} onSort={k => setOverdueSort(s => ({key:k, dir:s.key===k&&s.dir==='asc'?'desc':'asc'}))} align="right" />
                <th className="px-4 py-3 text-center text-[10px] font-bold text-gray-400 uppercase tracking-wider">{tr?'Durum':'Status'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {currentOverdueOrders.length > 0 ? currentOverdueOrders.map((order) => (
                <tr key={order.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 font-medium text-gray-900">{order.shopifyOrderId || order.id}</td>
                  <td className="px-6 py-4 text-gray-600">{order.customerName}</td>
                  <td className="px-6 py-4 text-right font-mono">{formatAmount(order.totalPrice || 0, activeCurrency, exchangeRates)}</td>
                  <td className="px-6 py-4 text-center">
                    <span className="px-2 py-1 rounded-full text-xs font-bold bg-red-50 text-red-600 border border-red-100">
                      {tr ? 'Gecikmiş' : 'Overdue'}
                    </span>
                  </td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={4} className="px-6 py-8 text-center text-gray-400 text-sm">
                    {tr ? 'Geciken sipariş bulunmamaktadır.' : 'No overdue orders found.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="p-4 border-t border-gray-100 flex items-center justify-between bg-gray-50/50">
            <p className="text-sm text-gray-500">
              {tr ? 'Toplam' : 'Total'} <span className="font-medium">{sortedOverdue.length}</span> {tr ? 'kayıttan' : 'records,'}{' '}
              <span className="font-medium">{(currentPage - 1) * ordersPerPage + 1}–{Math.min(currentPage * ordersPerPage, overdueOrders.length)}</span> {tr ? 'gösteriliyor' : 'showing'}
            </p>
            <div className="flex gap-2">
              <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} className="px-4 py-2 border border-gray-200 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed">
                {tr ? 'Önceki' : 'Previous'}
              </button>
              <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages} className="px-4 py-2 border border-gray-200 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed">
                {tr ? 'Sonraki' : 'Next'}
              </button>
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
};

export default RiskPanel;
