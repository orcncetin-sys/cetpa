import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  TrendingUp, Target, Award, Plus, Edit2, Trash2, X,
  DollarSign, CheckCircle2, AlertCircle, BarChart3, Lock
} from 'lucide-react';
import {
  collection, onSnapshot, addDoc, updateDoc, deleteDoc,
  doc, serverTimestamp, query, orderBy
} from 'firebase/firestore';
import { db } from '../firebase';
import { logFirestoreError, OperationType } from '../utils/firebase';
import { format } from 'date-fns';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import ModuleHeader from './ModuleHeader';
import ConfirmModal from './ConfirmModal';
import { cn } from '../lib/utils';

interface CommissionRule {
  id: string;
  tier: string;
  targetAmount: number;
  commissionRate: number;
  bonusRate: number;
  period: 'monthly' | 'quarterly';
  createdAt?: unknown;
}

interface Lead {
  id: string;
  name?: string;
  company?: string;
  email?: string;
  customerType?: string;
  priceTier?: string;
  status?: string;
}

interface Order {
  id?: string;
  customerName?: string;
  customerEmail?: string;
  totalPrice?: number;
  status?: string;
  syncedAt?: { toDate?: () => Date } | string | number;
}

interface DealerCommissionPanelProps {
  currentLanguage: 'tr' | 'en';
  isAuthenticated: boolean;
  userRole: string | null;
  leads: Lead[];
  orders: Order[];
  exchangeRates?: Record<string, number> | null;
}

const TIER_COLORS: Record<string, string> = {
  'Dealer': '#ff4000',
  'B2B Premium': '#7c3aed',
  'B2B Standard': '#2563eb',
  'Retail': '#059669',
};

const toDate = (val: unknown): Date => {
  if (!val) return new Date();
  if (typeof val === 'object' && val !== null && 'toDate' in val && typeof (val as { toDate: () => Date }).toDate === 'function') {
    return (val as { toDate: () => Date }).toDate();
  }
  return new Date(val as string | number);
};

export default function DealerCommissionPanel({
  currentLanguage, isAuthenticated, userRole, leads, orders, exchangeRates
}: DealerCommissionPanelProps) {
  const [commissionRules, setCommissionRules] = useState<CommissionRule[]>([]);
  const [dealerSort, setDealerSort] = useState<{key: string; dir: 'asc'|'desc'}>({key: 'actualSales', dir: 'desc'});
  const toggleDealerSort = (key: string) => setDealerSort(s => ({key, dir: s.key === key && s.dir === 'asc' ? 'desc' : 'asc'}));
  const [activeTab, setActiveTab] = useState<'performance' | 'rules'>('performance');
  const [selectedPeriod, setSelectedPeriod] = useState(format(new Date(), 'yyyy-MM'));
  const [kpiCurrency, setKpiCurrency] = useState<'TRY' | 'USD' | 'EUR'>('TRY');
  const [showRuleModal, setShowRuleModal] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [confirmModal, setConfirmModal] = useState<{ isOpen: boolean; title: string; message: string; onConfirm: () => void }>({
    isOpen: false, title: '', message: '', onConfirm: () => {}
  });
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const [seedingDefaults, setSeedingDefaults] = useState(false);

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const handleSeedDefaults = async () => {
    if (!isAuthenticated) {
      showToast(
        currentLanguage === 'tr' ? 'Kural eklemek için giriş yapmanız gerekiyor.' : 'Please sign in to add commission rules.',
        'error'
      );
      return;
    }
    setSeedingDefaults(true);
    try {
      const defaults = [
        { tier: 'Dealer',       targetAmount: 200000, commissionRate: 5,   bonusRate: 2,   period: 'monthly' as const },
        { tier: 'B2B Premium',  targetAmount: 150000, commissionRate: 4,   bonusRate: 1.5, period: 'monthly' as const },
        { tier: 'B2B Standard', targetAmount: 100000, commissionRate: 3,   bonusRate: 1,   period: 'monthly' as const },
        { tier: 'Retail',       targetAmount: 50000,  commissionRate: 2,   bonusRate: 0.5, period: 'monthly' as const },
      ];
      for (const rule of defaults) {
        await addDoc(collection(db, 'commissionRules'), { ...rule, createdAt: serverTimestamp() });
      }
      showToast(currentLanguage === 'tr' ? 'Varsayılan komisyon kuralları eklendi.' : 'Default commission rules added.');
    } catch (err) {
      console.error(err);
      const msg = err instanceof Error ? err.message : '';
      const isPermission = msg.includes('permission') || msg.includes('Missing or insufficient');
      showToast(
        isPermission
          ? (currentLanguage === 'tr' ? 'Yetki hatası — lütfen giriş yapın.' : 'Permission denied — please sign in.')
          : (currentLanguage === 'tr' ? 'Hata oluştu.' : 'Error occurred.'),
        'error'
      );
    } finally {
      setSeedingDefaults(false);
    }
  };

  const [ruleForm, setRuleForm] = useState<Omit<CommissionRule, 'id' | 'createdAt'>>({
    tier: 'Dealer',
    targetAmount: 100000,
    commissionRate: 3,
    bonusRate: 1.5,
    period: 'monthly',
  });

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'commissionRules'), orderBy('createdAt', 'desc')),
      (snap) => {
        setCommissionRules(snap.docs.map(d => ({ id: d.id, ...d.data() } as CommissionRule)));
      },
      (err) => logFirestoreError(err, OperationType.LIST, 'commissionRules')
    );
    return () => unsub();
  }, []);

  const handleSaveRule = async () => {
    if (!isAuthenticated) {
      showToast(
        currentLanguage === 'tr' ? 'Kural eklemek için giriş yapmanız gerekiyor.' : 'Please sign in to save rules.',
        'error'
      );
      return;
    }
    try {
      if (editingRuleId) {
        await updateDoc(doc(db, 'commissionRules', editingRuleId), { ...ruleForm, updatedAt: serverTimestamp() });
        showToast(currentLanguage === 'tr' ? 'Kural güncellendi.' : 'Rule updated.');
      } else {
        await addDoc(collection(db, 'commissionRules'), { ...ruleForm, createdAt: serverTimestamp() });
        showToast(currentLanguage === 'tr' ? 'Kural eklendi.' : 'Rule added.');
      }
      setShowRuleModal(false);
      setEditingRuleId(null);
      setRuleForm({ tier: 'Dealer', targetAmount: 100000, commissionRate: 3, bonusRate: 1.5, period: 'monthly' });
    } catch (err) {
      console.error(err);
      const msg = err instanceof Error ? err.message : '';
      const isPermission = msg.includes('permission') || msg.includes('Missing or insufficient');
      showToast(
        isPermission
          ? (currentLanguage === 'tr' ? 'Yetki hatası — lütfen giriş yapın.' : 'Permission denied — please sign in.')
          : (currentLanguage === 'tr' ? 'Hata oluştu.' : 'Error occurred.'),
        'error'
      );
    }
  };

  // Compute dealer performance for selected period
  const dealerPerformance = React.useMemo(() => {
    const [year, month] = selectedPeriod.split('-').map(Number);

    const dealers = leads.filter(l =>
      l.priceTier === 'Dealer' || l.priceTier === 'B2B Premium' || l.priceTier === 'B2B Standard' ||
      l.customerType === 'B2B' || l.customerType === 'Dealer'
    );

    return dealers.map(dealer => {
      // Sum orders in the selected period for this dealer
      const dealerOrders = orders.filter(o => {
        if (o.status === 'Cancelled') return false;
        const matches = (o.customerEmail && o.customerEmail === dealer.email) ||
                        (o.customerName && o.customerName === (dealer.company || dealer.name));
        if (!matches) return false;
        const d = toDate(o.syncedAt);
        return d.getFullYear() === year && d.getMonth() + 1 === month;
      });

      const actualSales = dealerOrders.reduce((s, o) => s + (o.totalPrice || 0), 0);
      const tier = dealer.priceTier || dealer.customerType || 'B2B Standard';
      const rule = commissionRules.find(r => r.tier === tier);
      const targetAmount = rule?.targetAmount || 100000;
      const baseRate = rule?.commissionRate || 3;
      const bonusRate = rule?.bonusRate || 0;
      const achievementRate = targetAmount > 0 ? (actualSales / targetAmount) * 100 : 0;
      const effectiveRate = achievementRate >= 100 ? baseRate + bonusRate : baseRate * (achievementRate / 100);
      const commissionEarned = actualSales * (effectiveRate / 100);

      return {
        id: dealer.id,
        name: dealer.company || dealer.name || '—',
        tier,
        targetAmount,
        actualSales,
        achievementRate: Math.min(achievementRate, 200),
        effectiveRate,
        commissionEarned,
        orderCount: dealerOrders.length,
      };
    }).sort((a, b) => b.actualSales - a.actualSales);
  }, [leads, orders, selectedPeriod, commissionRules]);

  const totalCommission = dealerPerformance.reduce((s, d) => s + d.commissionEarned, 0);
  const totalSales = dealerPerformance.reduce((s, d) => s + d.actualSales, 0);
  const onTargetCount = dealerPerformance.filter(d => d.achievementRate >= 100).length;

  const rate = kpiCurrency === 'USD' ? (exchangeRates?.USD || 1) : kpiCurrency === 'EUR' ? (exchangeRates?.EUR || 1) : 1;
  const currencySymbol = kpiCurrency === 'TRY' ? '₺' : kpiCurrency === 'USD' ? '$' : '€';
  const convertedTotalSales = kpiCurrency === 'TRY' ? totalSales : totalSales / rate;
  const convertedTotalCommission = kpiCurrency === 'TRY' ? totalCommission : totalCommission / rate;

  const tabs = [
    { id: 'performance', label: currentLanguage === 'tr' ? 'Performans' : 'Performance', icon: TrendingUp },
    { id: 'rules', label: currentLanguage === 'tr' ? 'Komisyon Kuralları' : 'Commission Rules', icon: Target },
  ];

  const tierLabel = (tier: string) => {
    if (currentLanguage === 'en') return tier;
    const map: Record<string, string> = {
      'Dealer': 'Bayi',
      'B2B Premium': 'B2B Premium',
      'B2B Standard': 'B2B Standart',
      'Retail': 'Perakende',
    };
    return map[tier] || tier;
  };

  const periodLabel = (period: 'monthly' | 'quarterly') =>
    period === 'monthly'
      ? (currentLanguage === 'tr' ? 'Aylık' : 'Monthly')
      : (currentLanguage === 'tr' ? 'Çeyreklik' : 'Quarterly');

  return (
    <div className="space-y-6">
      <ModuleHeader
        title={currentLanguage === 'tr' ? 'Bayi Komisyon Sistemi' : 'Dealer Commission System'}
        subtitle={currentLanguage === 'tr' ? 'Bayi hedefleri, satış performansı ve komisyon hesabı' : 'Dealer targets, sales performance and commission calculation'}
        icon={Award}
        actionButton={
          <div className="flex items-center gap-2">
            <input
              type="month"
              value={selectedPeriod}
              onChange={e => setSelectedPeriod(e.target.value)}
              className="px-3 py-2 bg-gray-50 border border-gray-100 rounded-xl text-sm outline-none focus:ring-2 focus:ring-brand/20"
            />
            {activeTab === 'rules' && (
              <div className="flex items-center gap-2">
                {commissionRules.length === 0 && (
                  <button
                    onClick={() => void handleSeedDefaults()}
                    disabled={seedingDefaults}
                    className="apple-button-secondary text-sm flex items-center gap-1.5"
                  >
                    {seedingDefaults ? (
                      <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 100 16v-4l-3 3 3 3v-4a8 8 0 01-8-8z"/></svg>
                    ) : <BarChart3 size={15} />}
                    {currentLanguage === 'tr' ? 'Hızlı Kurulum' : 'Quick Setup'}
                  </button>
                )}
                <button onClick={() => { setRuleForm({ tier: 'Dealer', targetAmount: 100000, commissionRate: 3, bonusRate: 1.5, period: 'monthly' }); setEditingRuleId(null); setShowRuleModal(true); }} className="apple-button-primary">
                  <Plus size={16} /> {currentLanguage === 'tr' ? 'Kural Ekle' : 'Add Rule'}
                </button>
              </div>
            )}
          </div>
        }
      />

      {/* Tab bar */}
      <div className="overflow-x-auto scrollbar-none -mx-4 px-4">
        <div className="flex gap-2 p-1 bg-gray-100/50 rounded-2xl w-max">
          {tabs.map(tab => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as 'performance' | 'rules')}
                className={cn(
                  'shrink-0 flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all',
                  activeTab === tab.id ? 'bg-white text-brand shadow-sm' : 'text-gray-500 hover:text-gray-700'
                )}
              >
                <Icon size={15} />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      <AnimatePresence mode="wait">
        {activeTab === 'performance' && (
          <motion.div key="perf" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-6">
            {/* KPI Row */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {/* Toplam Satış — with currency toggle */}
              <div className="apple-card p-5 bg-brand/5 flex flex-col justify-between">
                <div className="flex items-center justify-between mb-3">
                  <div className="w-9 h-9 rounded-xl bg-brand/10 flex items-center justify-center">
                    <DollarSign size={16} className="text-brand" />
                  </div>
                  <div className="flex items-center gap-0.5 bg-gray-100 rounded-lg p-0.5">
                    {(['TRY', 'USD', 'EUR'] as const).map(c => (
                      <button key={c} onClick={() => setKpiCurrency(c)}
                        className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md transition-all ${kpiCurrency === c ? 'bg-white shadow-sm text-gray-800' : 'text-gray-400 hover:text-gray-600'}`}>
                        {c === 'TRY' ? '₺' : c === 'USD' ? '$' : '€'}
                      </button>
                    ))}
                  </div>
                </div>
                <p className="text-2xl font-bold text-brand">{currencySymbol}{convertedTotalSales.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}</p>
                <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mt-1">{currentLanguage === 'tr' ? 'Toplam Satış' : 'Total Sales'}</p>
              </div>

              {/* Toplam Komisyon — with currency toggle */}
              <div className="apple-card p-5 bg-purple-50 flex flex-col justify-between">
                <div className="flex items-center justify-between mb-3">
                  <div className="w-9 h-9 rounded-xl bg-purple-100 flex items-center justify-center">
                    <Award size={16} className="text-purple-600" />
                  </div>
                  <div className="flex items-center gap-0.5 bg-gray-100 rounded-lg p-0.5">
                    {(['TRY', 'USD', 'EUR'] as const).map(c => (
                      <button key={c} onClick={() => setKpiCurrency(c)}
                        className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md transition-all ${kpiCurrency === c ? 'bg-white shadow-sm text-gray-800' : 'text-gray-400 hover:text-gray-600'}`}>
                        {c === 'TRY' ? '₺' : c === 'USD' ? '$' : '€'}
                      </button>
                    ))}
                  </div>
                </div>
                <p className="text-2xl font-bold text-purple-600">{currencySymbol}{convertedTotalCommission.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}</p>
                <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mt-1">{currentLanguage === 'tr' ? 'Toplam Komisyon' : 'Total Commission'}</p>
              </div>

              {/* Hedefe Ulaşan — no toggle needed */}
              <div className="apple-card p-5 bg-green-50 flex flex-col justify-between">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-9 h-9 rounded-xl bg-green-100 flex items-center justify-center">
                    <Target size={16} className="text-green-600" />
                  </div>
                </div>
                <p className="text-2xl font-bold text-green-600">{onTargetCount} / {dealerPerformance.length}</p>
                <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mt-1">{currentLanguage === 'tr' ? 'Hedefe Ulaşan' : 'On Target'}</p>
              </div>
            </div>

            {/* Chart */}
            {dealerPerformance.length > 0 && (
              <div className="apple-card p-6">
                <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
                  <BarChart3 size={18} className="text-brand" />
                  {currentLanguage === 'tr' ? 'Bayi Satış Karşılaştırması' : 'Dealer Sales Comparison'}
                </h3>
                <div className="h-[220px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={dealerPerformance.slice(0, 8).map(d => ({
                        ...d,
                        convertedSales: kpiCurrency === 'TRY' ? d.actualSales : d.actualSales / rate,
                      }))}
                      margin={{ top: 5, right: 5, bottom: 5, left: 5 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F5F5F7" />
                      <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#86868B' }} />
                      <YAxis
                        axisLine={false} tickLine={false}
                        tick={{ fontSize: 10, fill: '#86868B' }}
                        tickFormatter={v => `${currencySymbol}${(v / 1000).toFixed(0)}K`}
                      />
                      <Tooltip
                        contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 25px rgba(0,0,0,0.1)' }}
                        formatter={(value: number) => [`${currencySymbol}${value.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}`, currentLanguage === 'tr' ? 'Satış' : 'Sales']}
                      />
                      <Bar dataKey="convertedSales" radius={[6, 6, 0, 0]} name={currentLanguage === 'tr' ? 'Satış' : 'Sales'}>
                        {dealerPerformance.slice(0, 8).map((d, i) => (
                          <Cell key={i} fill={TIER_COLORS[d.tier] || '#ff4000'} fillOpacity={d.achievementRate >= 100 ? 1 : 0.5} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* Performance Table */}
            <div className="apple-card overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-100">
                <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? 'Bayi Performans Tablosu' : 'Dealer Performance Table'}</h3>
              </div>
              {dealerPerformance.length === 0 ? (
                <div className="p-12 text-center">
                  <Award className="mx-auto mb-3 text-gray-200" size={48} />
                  <p className="text-gray-400 font-medium">{currentLanguage === 'tr' ? 'Bu dönemde bayi verisi yok.' : 'No dealer data for this period.'}</p>
                  <p className="text-gray-300 text-sm mt-1">{currentLanguage === 'tr' ? "Önce müşterilerin 'Bayi' veya 'B2B' olarak işaretlenmesi gerekiyor." : "Customers must be tagged as 'Dealer' or 'B2B' first."}</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-100">
                        {[
                          {k:'name', label: currentLanguage==='tr'?'Bayi':'Dealer', align:'text-left', cls:''},
                          {k:'tier', label: 'Tier', align:'text-left', cls:'hidden sm:table-cell'},
                          {k:'targetAmount', label: currentLanguage==='tr'?'Hedef':'Target', align:'text-right', cls:''},
                          {k:'actualSales', label: currentLanguage==='tr'?'Gerçekleşen':'Actual', align:'text-right', cls:''},
                          {k:'effectiveRate', label: currentLanguage==='tr'?'Oran':'Rate', align:'text-center', cls:'hidden md:table-cell'},
                          {k:'commissionEarned', label: currentLanguage==='tr'?'Komisyon':'Commission', align:'text-right', cls:''},
                          {k:'achievementRate', label: currentLanguage==='tr'?'Hedef %':'Target %', align:'text-center', cls:'hidden lg:table-cell'},
                        ].map(({k,label,align,cls}) => {
                          const active = dealerSort.key === k;
                          return (
                            <th key={k} onClick={() => toggleDealerSort(k)} className={`py-3 px-5 ${align} text-[10px] font-bold uppercase tracking-wider cursor-pointer select-none transition-colors ${cls} ${active?'text-brand':'text-gray-400 hover:text-gray-600'}`}>
                              {label} <span className={active?'opacity-100':'opacity-25'}>{active?(dealerSort.dir==='asc'?'↑':'↓'):'↕'}</span>
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {[...dealerPerformance].sort((a, b) => {
                        const av = (a as Record<string, unknown>)[dealerSort.key] as string | number ?? '';
                        const bv = (b as Record<string, unknown>)[dealerSort.key] as string | number ?? '';
                        if (av < bv) return dealerSort.dir === 'asc' ? -1 : 1;
                        if (av > bv) return dealerSort.dir === 'asc' ? 1 : -1;
                        return 0;
                      }).map(d => (
                        <tr key={d.id} className="hover:bg-gray-50/50 transition-all">
                          <td className="py-3.5 px-5 font-bold text-gray-900">{d.name}</td>
                          <td className="py-3.5 px-5 hidden sm:table-cell">
                            <span className="px-2 py-1 rounded-lg text-[10px] font-bold" style={{ background: `${TIER_COLORS[d.tier]}20`, color: TIER_COLORS[d.tier] }}>
                              {tierLabel(d.tier)}
                            </span>
                          </td>
                          <td className="py-3.5 px-5 text-right text-gray-500 text-xs">{currencySymbol}{(kpiCurrency === 'TRY' ? d.targetAmount : d.targetAmount / rate).toLocaleString('tr-TR', { maximumFractionDigits: 0 })}</td>
                          <td className="py-3.5 px-5 text-right font-bold text-gray-900">{currencySymbol}{(kpiCurrency === 'TRY' ? d.actualSales : d.actualSales / rate).toLocaleString('tr-TR', { maximumFractionDigits: 0 })}</td>
                          <td className="py-3.5 px-5 text-center hidden md:table-cell">
                            <span className="text-xs font-bold text-gray-500">%{d.effectiveRate.toFixed(1)}</span>
                          </td>
                          <td className="py-3.5 px-5 text-right font-bold text-brand">{currencySymbol}{(kpiCurrency === 'TRY' ? d.commissionEarned : d.commissionEarned / rate).toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</td>
                          <td className="py-3.5 px-5 hidden lg:table-cell">
                            <div className="flex items-center gap-2">
                              <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                <div
                                  className="h-full rounded-full transition-all"
                                  style={{
                                    width: `${Math.min(d.achievementRate, 100)}%`,
                                    background: d.achievementRate >= 100 ? '#22c55e' : d.achievementRate >= 70 ? '#f59e0b' : '#ef4444'
                                  }}
                                />
                              </div>
                              <span className={cn(
                                'text-[10px] font-bold w-10 text-right',
                                d.achievementRate >= 100 ? 'text-green-600' : d.achievementRate >= 70 ? 'text-yellow-600' : 'text-red-500'
                              )}>
                                %{d.achievementRate.toFixed(0)}
                              </span>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-gray-50 border-t border-gray-200">
                        <td colSpan={3} className="py-3 px-5 text-xs font-bold text-gray-400 uppercase">{currentLanguage === 'tr' ? 'TOPLAM' : 'TOTAL'}</td>
                        <td className="py-3 px-5 text-right font-bold text-gray-900">{currencySymbol}{convertedTotalSales.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}</td>
                        <td className="hidden md:table-cell" />
                        <td className="py-3 px-5 text-right font-bold text-brand">{currencySymbol}{convertedTotalCommission.toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</td>
                        <td className="hidden lg:table-cell" />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          </motion.div>
        )}

        {activeTab === 'rules' && (
          <motion.div key="rules" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-4">
            {!isAuthenticated && (
              <div className="flex items-center gap-3 bg-blue-50 border border-blue-100 rounded-2xl px-5 py-3">
                <Lock size={16} className="text-blue-400 flex-shrink-0" />
                <p className="text-sm text-blue-600 font-medium">
                  {currentLanguage === 'tr'
                    ? 'Kural eklemek veya düzenlemek için giriş yapmanız gerekiyor.'
                    : 'Sign in to add or edit commission rules.'}
                </p>
              </div>
            )}
            {commissionRules.length === 0 ? (
              <div className="apple-card p-12 text-center">
                <Target className="mx-auto mb-3 text-gray-200" size={48} />
                <p className="text-gray-400 font-medium mb-2">{currentLanguage === 'tr' ? 'Henüz komisyon kuralı yok.' : 'No commission rules yet.'}</p>
                <p className="text-gray-300 text-sm mb-6">{currentLanguage === 'tr' ? 'Hızlı kurulum ile tüm tier\'lar için varsayılan kurallar ekleyin veya kendiniz oluşturun.' : 'Use Quick Setup to add default rules for all tiers, or create your own.'}</p>
                <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                  <button
                    onClick={() => void handleSeedDefaults()}
                    disabled={seedingDefaults}
                    className="apple-button-secondary px-8 flex items-center gap-2"
                  >
                    {seedingDefaults ? (
                      <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 100 16v-4l-3 3 3 3v-4a8 8 0 01-8-8z"/></svg>
                    ) : <BarChart3 size={16} />}
                    {currentLanguage === 'tr' ? 'Hızlı Kurulum (4 Tier)' : 'Quick Setup (4 Tiers)'}
                  </button>
                  <button onClick={() => { setRuleForm({ tier: 'Dealer', targetAmount: 100000, commissionRate: 3, bonusRate: 1.5, period: 'monthly' }); setEditingRuleId(null); setShowRuleModal(true); }} className="apple-button-primary px-8">
                    <Plus size={16} /> {currentLanguage === 'tr' ? 'İlk Kuralı Ekle' : 'Add First Rule'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {commissionRules.map(rule => (
                  <div key={rule.id} className="apple-card p-6 space-y-4" style={{ borderLeft: `4px solid ${TIER_COLORS[rule.tier] || '#86868B'}` }}>
                    <div className="flex justify-between items-start">
                      <div>
                        <span className="text-xs font-bold px-2 py-1 rounded-lg" style={{ background: `${TIER_COLORS[rule.tier] || '#86868B'}20`, color: TIER_COLORS[rule.tier] || '#86868B' }}>
                          {tierLabel(rule.tier)}
                        </span>
                        <span className="ml-2 text-xs text-gray-400">{periodLabel(rule.period)}</span>
                      </div>
                      <div className="flex gap-1">
                        <button
                          onClick={() => {
                            setRuleForm({ tier: rule.tier, targetAmount: rule.targetAmount, commissionRate: rule.commissionRate, bonusRate: rule.bonusRate, period: rule.period });
                            setEditingRuleId(rule.id);
                            setShowRuleModal(true);
                          }}
                          className="p-2 hover:bg-gray-100 rounded-xl text-gray-400 hover:text-blue-600 transition-all"
                        ><Edit2 size={14} /></button>
                        <button
                          onClick={() => setConfirmModal({
                            isOpen: true,
                            title: currentLanguage === 'tr' ? 'Kuralı Sil' : 'Delete Rule',
                            message: currentLanguage === 'tr' ? 'Bu komisyon kuralını silmek istediğinize emin misiniz?' : 'Are you sure you want to delete this commission rule?',
                            onConfirm: async () => {
                              await deleteDoc(doc(db, 'commissionRules', rule.id));
                              showToast(currentLanguage === 'tr' ? 'Kural silindi.' : 'Rule deleted.');
                            }
                          })}
                          className="p-2 hover:bg-red-50 rounded-xl text-gray-400 hover:text-red-600 transition-all"
                        ><Trash2 size={14} /></button>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <div className="text-center">
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-0.5">{currentLanguage === 'tr' ? 'Hedef' : 'Target'}</p>
                        <p className="text-lg font-bold text-gray-900">₺{(rule.targetAmount / 1000).toFixed(0)}K</p>
                      </div>
                      <div className="text-center">
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-0.5">{currentLanguage === 'tr' ? 'Baz Oran' : 'Base Rate'}</p>
                        <p className="text-lg font-bold text-brand">%{rule.commissionRate}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-0.5">{currentLanguage === 'tr' ? 'Bonus' : 'Bonus'}</p>
                        <p className="text-lg font-bold text-green-600">+%{rule.bonusRate}</p>
                      </div>
                    </div>
                    <p className="text-xs text-gray-400">
                      {currentLanguage === 'tr'
                        ? `Hedefe ulaşılırsa toplam oran %${rule.commissionRate + rule.bonusRate} olur.`
                        : `Total rate becomes ${rule.commissionRate + rule.bonusRate}% when target is reached.`}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Rule Modal */}
      <AnimatePresence>
        {showRuleModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowRuleModal(false)} />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-3xl shadow-2xl w-full max-w-md relative z-10 overflow-hidden"
            >
              <div className="p-6 border-b border-gray-100 flex items-center justify-between">
                <h3 className="font-bold text-gray-800">
                  {editingRuleId
                    ? (currentLanguage === 'tr' ? 'Kuralı Düzenle' : 'Edit Rule')
                    : (currentLanguage === 'tr' ? 'Yeni Komisyon Kuralı' : 'New Commission Rule')}
                </h3>
                <button onClick={() => setShowRuleModal(false)} className="p-2 hover:bg-gray-100 rounded-xl transition-all"><X size={18} /></button>
              </div>
              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5">{currentLanguage === 'tr' ? 'Tier' : 'Tier'}</label>
                  <select value={ruleForm.tier} onChange={e => setRuleForm({ ...ruleForm, tier: e.target.value })} className="w-full px-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl outline-none text-sm">
                    <option value="Dealer">{currentLanguage === 'tr' ? 'Bayi' : 'Dealer'}</option>
                    <option value="B2B Premium">B2B Premium</option>
                    <option value="B2B Standard">{currentLanguage === 'tr' ? 'B2B Standart' : 'B2B Standard'}</option>
                    <option value="Retail">{currentLanguage === 'tr' ? 'Perakende' : 'Retail'}</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5">{currentLanguage === 'tr' ? 'Dönem' : 'Period'}</label>
                  <select value={ruleForm.period} onChange={e => setRuleForm({ ...ruleForm, period: e.target.value as 'monthly' | 'quarterly' })} className="w-full px-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl outline-none text-sm">
                    <option value="monthly">{currentLanguage === 'tr' ? 'Aylık' : 'Monthly'}</option>
                    <option value="quarterly">{currentLanguage === 'tr' ? 'Çeyreklik' : 'Quarterly'}</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5">{currentLanguage === 'tr' ? 'Satış Hedefi (₺)' : 'Sales Target (₺)'}</label>
                  <input type="number" value={ruleForm.targetAmount} onChange={e => setRuleForm({ ...ruleForm, targetAmount: Number(e.target.value) })} className="w-full px-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl outline-none text-sm" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5">{currentLanguage === 'tr' ? 'Baz Komisyon (%)' : 'Base Commission (%)'}</label>
                    <input type="number" step="0.1" value={ruleForm.commissionRate} onChange={e => setRuleForm({ ...ruleForm, commissionRate: Number(e.target.value) })} className="w-full px-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl outline-none text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5">{currentLanguage === 'tr' ? 'Hedef Bonusu (+%)' : 'Target Bonus (+%)'}</label>
                    <input type="number" step="0.1" value={ruleForm.bonusRate} onChange={e => setRuleForm({ ...ruleForm, bonusRate: Number(e.target.value) })} className="w-full px-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl outline-none text-sm" />
                  </div>
                </div>
                <div className="bg-orange-50 rounded-xl p-3 text-xs text-orange-700">
                  {currentLanguage === 'tr'
                    ? `Hedefe ulaşılırsa toplam oran %${(ruleForm.commissionRate + ruleForm.bonusRate).toFixed(1)} olur.`
                    : `If target is reached, total rate becomes ${(ruleForm.commissionRate + ruleForm.bonusRate).toFixed(1)}%.`}
                </div>
              </div>
              <div className="p-6 border-t border-gray-100 flex gap-3">
                <button onClick={() => { setShowRuleModal(false); setEditingRuleId(null); }} className="flex-1 py-3 rounded-2xl font-bold text-gray-500 hover:bg-gray-50 transition-all">
                  {currentLanguage === 'tr' ? 'İptal' : 'Cancel'}
                </button>
                <button onClick={handleSaveRule} className="apple-button-primary flex-1 justify-center py-3 rounded-2xl">
                  {currentLanguage === 'tr' ? 'Kaydet' : 'Save'}
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {toast && (
          <div className={`fixed bottom-8 right-8 px-6 py-3 rounded-2xl shadow-2xl z-[300] flex items-center gap-3 ${toast.type === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'}`}>
            {toast.type === 'success' ? <CheckCircle2 size={20} /> : <AlertCircle size={20} />}
            <span className="font-bold">{toast.msg}</span>
          </div>
        )}
      </AnimatePresence>

      <ConfirmModal
        isOpen={confirmModal.isOpen}
        title={confirmModal.title}
        message={confirmModal.message}
        onConfirm={async () => { await confirmModal.onConfirm(); setConfirmModal(c => ({ ...c, isOpen: false })); }}
        onCancel={() => setConfirmModal(c => ({ ...c, isOpen: false }))}
        variant="danger"
      />
    </div>
  );
}
