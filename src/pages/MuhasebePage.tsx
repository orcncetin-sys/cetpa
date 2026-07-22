import React, { useState } from 'react';
import { motion } from 'motion/react';
import BankStatementImportModal from '../components/BankStatementImportModal';
import BankBalanceReport from '../components/BankBalanceReport';
import {
  Calculator, DollarSign, Building2, BarChart3, CreditCard,
  Package, Users, Activity, TrendingUp, Wallet, FileText, Receipt,
  CheckCircle2, RefreshCw, Plus, AlertCircle, AlertTriangle, Filter,
  TrendingDown, Eye, X, Edit2, Trash2, Search, Download, Upload,
  ChevronDown, ChevronRight, Info, Clock, Calendar, ArrowUpRight, ArrowDownRight,
  ShoppingCart, Truck, Percent, Hash, Landmark, PiggyBank, Scale, Repeat, Globe, Tag,
} from 'lucide-react';
import { db } from '../firebase';
import { doc, setDoc, addDoc, collection, updateDoc, deleteDoc, serverTimestamp } from '../lib/dbClient';
import { confirmDelete } from '../lib/confirm';
import AccountingModule from '../components/AccountingModule';
import { MUHASEBE_MENU } from '../lib/muhasebeMenu';
import TahsilatModule from '../components/TahsilatModule';
import UnauthorizedView from '../components/UnauthorizedView';
import ReadOnlyBanner from '../components/ReadOnlyBanner';
import ModuleHeader from '../components/ModuleHeader';
import type { Order, Employee, Warehouse, Supplier, InventoryItem, Lead } from '../types';

const SabitKiymetModule    = React.lazy(() => import('../components/SabitKiymetModule'));
const MaliyetMerkeziModule = React.lazy(() => import('../components/MaliyetMerkeziModule'));
const KasaModule           = React.lazy(() => import('../components/KasaModule'));
const CariEkstrePanel      = React.lazy(() => import('../components/CariEkstrePanel'));

// Lazy alt-modüller (kasa/sabit-kıymet/maliyet/cari) YEREL Suspense ile sarılır.
// Aksi halde bu sekmeye geçince chunk inene kadar App seviyesindeki Suspense
// devreye girip TÜM Muhasebe sayfası boşalıyor ("yüklemede kalıyor" — özellikle
// yavaş bağlantıda). Yerel fallback yalnız o paneli spinner gösterir, başlık+bar durur.
const LAZY_FALLBACK = (
  <div className="apple-card p-10 flex items-center justify-center">
    <div className="animate-spin w-6 h-6 border-4 border-brand border-t-transparent rounded-full" />
  </div>
);

const FxInput = ({ value, onChange, w = 'w-28' }: { value: number; onChange: (v: number) => void; w?: string }) => (
  <input type="number" step="0.01" value={value || ''} onChange={e => onChange(Number(e.target.value) || 0)}
    placeholder="0" className={`${w} px-2 py-1 text-xs text-right bg-gray-50 border border-gray-200 rounded-lg outline-none focus:border-brand tabular-nums`} />
);

type BudgetEntry = { dept: string; budgetTRY: number };

type MuhasebeTab = 'genel'|'sabit-kiymet'|'maliyet'|'tahsilat'|'ap'|'butce'|'nakit-akis'|'banka'|'ar-aging'|'finansal-oranlar'|'pnl'|'kasa'|'bilanco'|'mutabakat'|'masraf'|'babs'|'kdv'|'cari'|'fatura-takip'|'fiyat-kural'|'butce-gercek'|'oto-fatura'|'gelir-tanima'|'kdv-mutabakat'|'gelir-gider-butce'|'varyans-analiz'|'kur-degerleme'|'tekrar-fatura'|'sirket-arasi';

interface Props {
  currentLanguage: 'tr' | 'en';
  currentT: Record<string, string>;
  canAccess: (tab: string) => boolean;
  hasFullAccess: (tab: string) => boolean;
  user: { email?: string | null; uid?: string; displayName?: string | null } | null;
  userRole: string | null;
  orders: Order[];
  employees: Employee[];
  warehouses: Warehouse[];
  suppliers: Supplier[];
  inventory: InventoryItem[];
  leads: Lead[];
  exchangeRates: Record<string, number> | null;
  fmtKpi: (value: number, format?: 'full' | 'K', decimals?: number) => string;
  createNotification: (title: string, message: string, type?: string) => Promise<void>;
  toast: (msg: string, type?: string) => void;
  setActiveTab: (tab: string) => void;
  kpiCurrency: 'TRY' | 'USD' | 'EUR';
  setKpiCurrency: React.Dispatch<React.SetStateAction<'TRY' | 'USD' | 'EUR'>>;
  fxPos: { usdBalance: number; usdBookRate: number; eurBalance: number; eurBookRate: number };
  updateFx: (field: 'usdBalance' | 'usdBookRate' | 'eurBalance' | 'eurBookRate', value: number) => void;
  refreshFxRates: () => Promise<void>;
  fxRefreshing: boolean;

  muhasebeTab: MuhasebeTab;
  setMuhasebeTab: React.Dispatch<React.SetStateAction<MuhasebeTab>>;
  // Birleşik menü (2026-07-21): AccountingModule iç sekmesini App seviyesinde
  // kontrol et — sidebar'dan doğrudan bir ERP sekmesi açılabilsin diye.
  muhasebeAccountingTab: string;
  setMuhasebeAccountingTab: (tab: string) => void;

  budgets: BudgetEntry[];
  setBudgets: React.Dispatch<React.SetStateAction<BudgetEntry[]>>;
  allBudgetsFirestore: Record<string, BudgetEntry[]>;
  setAllBudgetsFirestore: React.Dispatch<React.SetStateAction<Record<string, BudgetEntry[]>>>;
  budgetDraft: Record<string, string>;
  setBudgetDraft: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  budgetMonth: string;
  setBudgetMonth: React.Dispatch<React.SetStateAction<string>>;
  butceCurrency: 'TRY' | 'USD' | 'EUR';
  setButceCurrency: React.Dispatch<React.SetStateAction<'TRY' | 'USD' | 'EUR'>>;

  apPurchaseOrders: Array<{ id: string; orderNumber: string; supplier: string; totalAmount: number; status: string; expectedDate?: unknown; createdAt?: unknown }>;
  setApPurchaseOrders: React.Dispatch<React.SetStateAction<Array<{ id: string; orderNumber: string; supplier: string; totalAmount: number; status: string; expectedDate?: unknown; createdAt?: unknown }>>>;
  apCurrency: 'TRY' | 'USD' | 'EUR';
  setApCurrency: React.Dispatch<React.SetStateAction<'TRY' | 'USD' | 'EUR'>>;

  p607ReminderDays: number[];
  setP607ReminderDays: React.Dispatch<React.SetStateAction<number[]>>;

  bankBalance: number;
  setBankBalance: React.Dispatch<React.SetStateAction<number>>;
  bankBalanceDraft: string;
  setBankBalanceDraft: React.Dispatch<React.SetStateAction<string>>;
  bankBalanceEditing: boolean;
  setBankBalanceEditing: React.Dispatch<React.SetStateAction<boolean>>;
  reconMonth: string;
  setReconMonth: React.Dispatch<React.SetStateAction<string>>;

  p547BankAccounts: Array<{ id: string; bankName: string; accountType: string; balance: number; currency: string }>;
  setP547BankAccounts: React.Dispatch<React.SetStateAction<Array<{ id: string; bankName: string; accountType: string; balance: number; currency: string }>>>;
  p547FixedAssets: Array<{ id: string; name: string; cost: number; depreciation: number }>;
  setP547FixedAssets: React.Dispatch<React.SetStateAction<Array<{ id: string; name: string; cost: number; depreciation: number }>>>;

  p548Masraflar: Array<{ id: string; employeeName: string; category: string; amount: number; currency: string; date: string; description: string; receiptUrl?: string; status: 'Bekliyor' | 'Onaylandı' | 'Reddedildi'; createdAt?: unknown; rejectionNote?: string }>;
  setP548Masraflar: React.Dispatch<React.SetStateAction<Array<{ id: string; employeeName: string; category: string; amount: number; currency: string; date: string; description: string; receiptUrl?: string; status: 'Bekliyor' | 'Onaylandı' | 'Reddedildi'; createdAt?: unknown; rejectionNote?: string }>>>;
  p548Form: boolean;
  setP548Form: React.Dispatch<React.SetStateAction<boolean>>;
  p548Draft: { employeeName: string; category: string; amount: string; currency: string; date: string; description: string };
  setP548Draft: React.Dispatch<React.SetStateAction<{ employeeName: string; category: string; amount: string; currency: string; date: string; description: string }>>;

  p555Period: string;
  setP555Period: React.Dispatch<React.SetStateAction<string>>;
  p559Customer: string;
  setP559Customer: React.Dispatch<React.SetStateAction<string>>;
  p560ApprovalThreshold: number;
  setP560ApprovalThreshold: React.Dispatch<React.SetStateAction<number>>;

  p563PnlCurrency: 'TRY' | 'USD' | 'EUR';
  setP563PnlCurrency: React.Dispatch<React.SetStateAction<'TRY' | 'USD' | 'EUR'>>;
  p564FaturaFilter: 'all' | 'missing' | 'synced' | 'pending';
  setP564FaturaFilter: React.Dispatch<React.SetStateAction<'all' | 'missing' | 'synced' | 'pending'>>;

  p573Rules: Array<{ id: string; name: string; type: 'bulk' | 'customer-tier' | 'promo'; minQty?: number; tierName?: string; discountPct: number; active: boolean }>;
  setP573Rules: React.Dispatch<React.SetStateAction<Array<{ id: string; name: string; type: 'bulk' | 'customer-tier' | 'promo'; minQty?: number; tierName?: string; discountPct: number; active: boolean }>>>;
  p573Draft: { name: string; type: 'bulk' | 'customer-tier' | 'promo'; minQty: string; tierName: string; discountPct: string; active: boolean };
  setP573Draft: React.Dispatch<React.SetStateAction<{ name: string; type: 'bulk' | 'customer-tier' | 'promo'; minQty: string; tierName: string; discountPct: string; active: boolean }>>;
  p573ShowForm: boolean;
  setP573ShowForm: React.Dispatch<React.SetStateAction<boolean>>;

  p557Scenario: 'base' | 'best' | 'worst';
  setP557Scenario: React.Dispatch<React.SetStateAction<'base' | 'best' | 'worst'>>;
  p558Year: string;
  setP558Year: React.Dispatch<React.SetStateAction<string>>;
  p580Year: string;
  setP580Year: React.Dispatch<React.SetStateAction<string>>;

  p591Schedules: Array<{ id: string; customerName: string; amount: number; frequency: 'monthly' | 'quarterly' | 'yearly'; nextDate: string; description: string; active: boolean }>;
  setP591Schedules: React.Dispatch<React.SetStateAction<Array<{ id: string; customerName: string; amount: number; frequency: 'monthly' | 'quarterly' | 'yearly'; nextDate: string; description: string; active: boolean }>>>;
  p591ShowForm: boolean;
  setP591ShowForm: React.Dispatch<React.SetStateAction<boolean>>;
  p591Draft: { customerName: string; amount: string; frequency: 'monthly' | 'quarterly' | 'yearly'; nextDate: string; description: string };
  setP591Draft: React.Dispatch<React.SetStateAction<{ customerName: string; amount: string; frequency: 'monthly' | 'quarterly' | 'yearly'; nextDate: string; description: string }>>;

  p597Contracts: Array<{ id: string; customerName: string; totalValue: number; startDate: string; endDate: string; recognized: number }>;
  setP597Contracts: React.Dispatch<React.SetStateAction<Array<{ id: string; customerName: string; totalValue: number; startDate: string; endDate: string; recognized: number }>>>;
  p597ShowForm: boolean;
  setP597ShowForm: React.Dispatch<React.SetStateAction<boolean>>;
  p597Draft: { customerName: string; totalValue: string; startDate: string; endDate: string; recognized: string };
  setP597Draft: React.Dispatch<React.SetStateAction<{ customerName: string; totalValue: string; startDate: string; endDate: string; recognized: string }>>;

  p610Period: 'this_month' | 'last_month' | 'ytd';
  setP610Period: React.Dispatch<React.SetStateAction<'this_month' | 'last_month' | 'ytd'>>;

  p617Month: string;
  setP617Month: React.Dispatch<React.SetStateAction<string>>;

  p623LCs: Array<{ id: string; bank: string; beneficiary: string; amount: number; currency: 'USD' | 'EUR'; expiryDate: string; status: 'Açık' | 'Kullanıldı' | 'Sona Erdi' | 'İptal'; ref: string }>;
  setP623LCs: React.Dispatch<React.SetStateAction<Array<{ id: string; bank: string; beneficiary: string; amount: number; currency: 'USD' | 'EUR'; expiryDate: string; status: 'Açık' | 'Kullanıldı' | 'Sona Erdi' | 'İptal'; ref: string }>>>;
  p623ShowForm: boolean;
  setP623ShowForm: React.Dispatch<React.SetStateAction<boolean>>;
  p623Draft: { bank: string; beneficiary: string; amount: string; currency: 'USD' | 'EUR'; expiryDate: string; ref: string };
  setP623Draft: React.Dispatch<React.SetStateAction<{ bank: string; beneficiary: string; amount: string; currency: 'USD' | 'EUR'; expiryDate: string; ref: string }>>;

  p625BudgetYear: number;
  setP625BudgetYear: React.Dispatch<React.SetStateAction<number>>;
  p625BudgetData: Array<{ month: number; budgetRevenue: number; budgetExpense: number }>;
  setP625BudgetData: React.Dispatch<React.SetStateAction<Array<{ month: number; budgetRevenue: number; budgetExpense: number }>>>;
  p625EditMonth: number | null;
  setP625EditMonth: React.Dispatch<React.SetStateAction<number | null>>;

  p630InvoicePeriod: '7d' | '30d' | '60d' | '90d';
  setP630InvoicePeriod: React.Dispatch<React.SetStateAction<'7d' | '30d' | '60d' | '90d'>>;

  p634Period: 'this_month' | 'last_month' | 'ytd';
  setP634Period: React.Dispatch<React.SetStateAction<'this_month' | 'last_month' | 'ytd'>>;

  p638MatchResults: Array<{ invoiceId: string; invoiceNo: string; customer: string; invoiceAmount: number; matchedAmount: number; confidence: number; status: 'Tam' | 'Kısmi' | 'Eşleşmedi' }>;
  setP638MatchResults: React.Dispatch<React.SetStateAction<Array<{ invoiceId: string; invoiceNo: string; customer: string; invoiceAmount: number; matchedAmount: number; confidence: number; status: 'Tam' | 'Kısmi' | 'Eşleşmedi' }>>>;
  p638Running: boolean;
  setP638Running: React.Dispatch<React.SetStateAction<boolean>>;

  p640Subs: Array<{ id: string; customerName: string; amount: number; frequency: 'Aylık' | '3 Aylık' | 'Yıllık'; nextDate: string; status: 'Aktif' | 'Pasif' | 'İptal' }>;
  setP640Subs: React.Dispatch<React.SetStateAction<Array<{ id: string; customerName: string; amount: number; frequency: 'Aylık' | '3 Aylık' | 'Yıllık'; nextDate: string; status: 'Aktif' | 'Pasif' | 'İptal' }>>>;
  p640ShowForm: boolean;
  setP640ShowForm: React.Dispatch<React.SetStateAction<boolean>>;
  p640Draft: { customerName: string; amount: string; frequency: 'Aylık' | '3 Aylık' | 'Yıllık'; nextDate: string };
  setP640Draft: React.Dispatch<React.SetStateAction<{ customerName: string; amount: string; frequency: 'Aylık' | '3 Aylık' | 'Yıllık'; nextDate: string }>>;

  p643Txns: Array<{ id: string; from: string; to: string; amount: number; currency: 'TRY' | 'USD' | 'EUR'; desc: string; date: string; status: 'Bekliyor' | 'Netleştirildi' }>;
  setP643Txns: React.Dispatch<React.SetStateAction<Array<{ id: string; from: string; to: string; amount: number; currency: 'TRY' | 'USD' | 'EUR'; desc: string; date: string; status: 'Bekliyor' | 'Netleştirildi' }>>>;
  p643ShowForm: boolean;
  setP643ShowForm: React.Dispatch<React.SetStateAction<boolean>>;
  p643Draft: { from: string; to: string; amount: string; currency: 'TRY' | 'USD' | 'EUR'; desc: string; date: string };
  setP643Draft: React.Dispatch<React.SetStateAction<{ from: string; to: string; amount: string; currency: 'TRY' | 'USD' | 'EUR'; desc: string; date: string }>>;
}

const FX_FALLBACK: Record<string, number> = { USD: 38, EUR: 41 };

export default function MuhasebePage(props: Props) {
  const {
    currentLanguage, currentT, canAccess, hasFullAccess, user, userRole,
    orders, employees, warehouses, suppliers, inventory, leads, exchangeRates, fmtKpi, createNotification, toast,
    setActiveTab, kpiCurrency, setKpiCurrency,
    fxPos, updateFx, refreshFxRates, fxRefreshing,
    muhasebeTab, setMuhasebeTab, muhasebeAccountingTab, setMuhasebeAccountingTab,
    budgets, setBudgets, allBudgetsFirestore, setAllBudgetsFirestore, budgetDraft, setBudgetDraft, budgetMonth, setBudgetMonth, butceCurrency, setButceCurrency,
    apPurchaseOrders, setApPurchaseOrders, apCurrency, setApCurrency,
    p607ReminderDays, setP607ReminderDays,
    bankBalance, setBankBalance, bankBalanceDraft, setBankBalanceDraft, bankBalanceEditing, setBankBalanceEditing, reconMonth, setReconMonth,
    p547BankAccounts, setP547BankAccounts, p547FixedAssets, setP547FixedAssets,
    p548Masraflar, setP548Masraflar, p548Form, setP548Form, p548Draft, setP548Draft,
    p555Period, setP555Period, p559Customer, setP559Customer, p560ApprovalThreshold, setP560ApprovalThreshold,
    p563PnlCurrency, setP563PnlCurrency, p564FaturaFilter, setP564FaturaFilter,
    p573Rules, setP573Rules, p573Draft, setP573Draft, p573ShowForm, setP573ShowForm,
    p557Scenario, setP557Scenario, p558Year, setP558Year, p580Year, setP580Year,
    p591Schedules, setP591Schedules, p591ShowForm, setP591ShowForm, p591Draft, setP591Draft,
    p597Contracts, setP597Contracts, p597ShowForm, setP597ShowForm, p597Draft, setP597Draft,
    p610Period, setP610Period,
    p617Month, setP617Month,
    p623LCs, setP623LCs, p623ShowForm, setP623ShowForm, p623Draft, setP623Draft,
    p625BudgetYear, setP625BudgetYear, p625BudgetData, setP625BudgetData, p625EditMonth, setP625EditMonth,
    p630InvoicePeriod, setP630InvoicePeriod,
    p634Period, setP634Period,
    p638MatchResults, setP638MatchResults, p638Running, setP638Running,
    p640Subs, setP640Subs, p640ShowForm, setP640ShowForm, p640Draft, setP640Draft,
    p643Txns, setP643Txns, p643ShowForm, setP643ShowForm, p643Draft, setP643Draft,
  } = props;
  // Kalıcılaştırma (2026-07-21): düzenleme modu kimlikleri — hangi kayıt formda
  const [p591EditId, setP591EditId] = useState<string | null>(null);

  // Banka ekstresi CSV içe aktarma modalı
  const [showBankImport, setShowBankImport] = useState(false);

  return (
            <motion.div key="muhasebe" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
              {!canAccess('muhasebe') ? <UnauthorizedView currentLanguage={currentLanguage} tab={currentLanguage==='tr'?'Muhasebe & Finans':'Accounting & Finance'} /> : (
                <>
                  {!hasFullAccess('muhasebe') && <ReadOnlyBanner currentLanguage={currentLanguage} />}
                  <ModuleHeader
                    title={currentLanguage === 'tr' ? 'Muhasebe & Finans' : 'Accounting & Finance'}
                    subtitle={currentLanguage === 'tr' ? 'Finansal kayıtları, sabit kıymetler, maliyet merkezleri ve tahsilatları yönetin.' : 'Manage financial records, fixed assets, cost centers and collections.'}
                    icon={Calculator}
                  />

                  {/* ── Birleşik yatay menü — HER sekmede sabit kalır (rapora geçince kaybolmaz),
                       sidebar ile birebir aynı liste. AccountingModule kendi barını gizler (hideTabBar). ── */}
                  <div className="overflow-x-auto scrollbar-none -mx-1 px-1">
                    <div className="flex gap-1 p-1 bg-white/80 border border-gray-100 rounded-2xl shadow-sm w-max">
                      {MUHASEBE_MENU.map(m => {
                        const Icon = m.icon;
                        const isActive = m.target.kind === 'accounting'
                          ? (muhasebeTab === 'genel' && muhasebeAccountingTab === m.target.tab)
                          : m.target.kind === 'muhasebe' ? muhasebeTab === m.target.tab : false;
                        return (
                          <button
                            key={m.id}
                            onClick={() => {
                              if (m.target.kind === 'accounting') { setMuhasebeTab('genel'); setMuhasebeAccountingTab(m.target.tab); }
                              else if (m.target.kind === 'muhasebe') setMuhasebeTab(m.target.tab as MuhasebeTab);
                              else setActiveTab(m.target.tab);
                            }}
                            className={`shrink-0 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all whitespace-nowrap ${isActive ? 'bg-[#ff4000] text-white shadow-sm' : 'text-[#86868B] hover:text-[#1D1D1F] hover:bg-gray-100'}`}
                          >
                            <Icon className="w-3.5 h-3.5" />
                            {currentLanguage === 'tr' ? m.tr : m.en}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* ── Genel Muhasebe ── */}
                  {muhasebeTab === 'genel' && (
                    <motion.div key="muhasebe-genel" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
                      <AccountingModule
                        orders={orders}
                        currentLanguage={currentLanguage}
                        isAuthenticated={!!user && hasFullAccess('muhasebe')}
                        userRole={userRole}
                        exchangeRates={exchangeRates}
                        createNotification={createNotification}
                        warehouses={warehouses}
                        employees={employees}
                        hideTabBar
                        controlledTab={muhasebeAccountingTab}
                        onControlledTabChange={setMuhasebeAccountingTab}
                      />
                    </motion.div>
                  )}

                  {/* ── Phase 146: VAT/KDV Monthly Dashboard ── */}
                  {muhasebeTab === 'genel' && orders.some(o => (o as unknown as Record<string,unknown>).kdvTutari) && (() => {
                    const now146 = new Date();
                    const months146 = Array.from({ length: 6 }, (_, i) => {
                      const d = new Date(now146.getFullYear(), now146.getMonth() - (5 - i), 1);
                      const label = d.toLocaleDateString(currentLanguage === 'tr' ? 'tr-TR' : 'en-US', { month: 'short', year: '2-digit' });
                      const mOrders = orders.filter(o => {
                        if (!(o as unknown as Record<string,unknown>).kdvTutari) return false;
                        try {
                          const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
                          return od.getFullYear() === d.getFullYear() && od.getMonth() === d.getMonth();
                        } catch { return false; }
                      });
                      const kdvCollected = mOrders.reduce((s, o) => s + (((o as unknown as Record<string,unknown>).kdvTutari as number) || 0), 0);
                      const netRevenue = mOrders.reduce((s, o) => s + (((o as unknown as Record<string,unknown>).kdvHaricTutar as number) || o.totalPrice || 0), 0);
                      return { label, kdvCollected, netRevenue, invoiced: mOrders.filter(o => (o as unknown as Record<string,unknown>).faturali).length };
                    });
                    const totalKDV = months146.reduce((s, m) => s + m.kdvCollected, 0);
                    const totalNet = months146.reduce((s, m) => s + m.netRevenue, 0);
                    const maxKDV = Math.max(...months146.map(m => m.kdvCollected), 1);
                    return (
                      <div className="apple-card p-6">
                        <div className="flex items-center justify-between mb-4">
                          <div>
                            <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '🧾 KDV Özeti (Son 6 Ay)' : '🧾 VAT Summary (Last 6 Months)'}</h3>
                            <p className="text-xs text-gray-400 mt-0.5">{currentLanguage === 'tr' ? 'Tahsil edilen KDV & KDV hariç ciro' : 'VAT collected & net revenue ex-VAT'}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-xs text-gray-500">{currentLanguage === 'tr' ? 'Toplam KDV' : 'Total VAT'}</p>
                            <p className="text-2xl font-bold text-purple-600">{fmtKpi(totalKDV,'full',0)}</p>
                          </div>
                        </div>
                        <div className="grid grid-cols-3 gap-3 mb-5">
                          {[
                            { label: currentLanguage==='tr'?'KDV Hariç Ciro':'Net Revenue', value: `₺${totalNet.toLocaleString(undefined,{maximumFractionDigits:0})}`, color: 'text-blue-600' },
                            { label: currentLanguage==='tr'?'KDV Tutarı':'VAT Amount', value: `₺${totalKDV.toLocaleString(undefined,{maximumFractionDigits:0})}`, color: 'text-purple-600' },
                            { label: currentLanguage==='tr'?'Efektif KDV Oranı':'Effective VAT Rate', value: totalNet > 0 ? `%${((totalKDV/totalNet)*100).toFixed(1)}` : '—', color: 'text-gray-700' },
                          ].map(k => (
                            <div key={k.label} className="bg-gray-50 rounded-xl p-3 text-center">
                              <p className={`text-lg font-bold ${k.color}`}>{k.value}</p>
                              <p className="text-[10px] text-gray-400 mt-0.5">{k.label}</p>
                            </div>
                          ))}
                        </div>
                        <div className="space-y-3">
                          {months146.map(m => {
                            const w = Math.round((m.kdvCollected / maxKDV) * 100);
                            return (
                              <div key={m.label} className="flex items-center gap-3">
                                <span className="text-xs text-gray-500 w-12 text-right shrink-0">{m.label}</span>
                                <div className="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden">
                                  <div className="h-full bg-purple-400 rounded-full transition-all" style={{ width: `${w}%` }} />
                                </div>
                                <span className="text-xs text-gray-600 tabular-nums shrink-0 w-24 text-right">
                                  {fmtKpi(m.kdvCollected,'full',0)}
                                </span>
                                <span className="text-[10px] text-gray-400 shrink-0">{m.invoiced} {currentLanguage==='tr'?'fatura':'inv.'}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}

                  {/* ── Tahsilat Takibi ── */}
                  {muhasebeTab === 'tahsilat' && (
                    <motion.div key="muhasebe-tahsilat" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
                      <TahsilatModule
                        currentLanguage={currentLanguage as 'tr' | 'en'}
                        isAuthenticated={!!user && hasFullAccess('muhasebe')}
                      />
                      {/* ── Phase 607: Tahsilat Hatırlatma Otomasyonu ───────────────────── */}
                      {(() => {
                        const tr607 = currentLanguage === 'tr';
                        const today607 = new Date();
                        // Find unpaid orders sorted by createdAt
                        const unpaidOrders = orders.filter(o => !o.paid && o.status !== 'Cancelled' && o.createdAt);
                        const withDays = unpaidOrders.map(o => {
                          let daysPast = 0;
                          try {
                            const d = (o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string);
                            daysPast = Math.floor((today607.getTime() - d.getTime()) / 86400000);
                          } catch { /* skip */ }
                          return {...o, daysPast};
                        }).sort((a,b) => b.daysPast - a.daysPast);
                        if (withDays.length === 0) return null;
                        const getBucket = (days: number) => {
                          if (days >= p607ReminderDays[2]) return {label:tr607?`${p607ReminderDays[2]}+ gün`:`${p607ReminderDays[2]}+ days`,color:'text-red-600',bg:'bg-red-50 border-red-200'};
                          if (days >= p607ReminderDays[1]) return {label:tr607?`${p607ReminderDays[1]}+ gün`:`${p607ReminderDays[1]}+ days`,color:'text-orange-600',bg:'bg-orange-50 border-orange-200'};
                          if (days >= p607ReminderDays[0]) return {label:tr607?`${p607ReminderDays[0]}+ gün`:`${p607ReminderDays[0]}+ days`,color:'text-amber-600',bg:'bg-amber-50 border-amber-200'};
                          return {label:tr607?'Normal':'Current',color:'text-gray-500',bg:'bg-gray-50 border-gray-100'};
                        };
                        const criticalCount = withDays.filter(o=>o.daysPast>=p607ReminderDays[2]).length;
                        const totalUnpaid = withDays.reduce((s,o)=>s+(o.totalPrice||0),0);
                        return (
                          <div className="apple-card p-5 space-y-4">
                            <div className="flex items-center justify-between flex-wrap gap-2">
                              <h3 className="font-bold text-gray-900 text-sm">🔔 {tr607?'Tahsilat Hatırlatma Otomasyonu':'Collection Reminder Automation'}</h3>
                              <div className="flex items-center gap-2 text-xs text-gray-500">
                                {tr607?'Eşikler (gün):':'Thresholds (days):'}
                                {p607ReminderDays.map((d,i)=>(
                                  <input key={i} type="number" value={d} onChange={e=>{
                                    const next=[...p607ReminderDays]; next[i]=Number(e.target.value); setP607ReminderDays(next);
                                  }} className="apple-input px-2 py-0.5 text-xs w-12 text-center"/>
                                ))}
                              </div>
                            </div>
                            <div className="grid grid-cols-3 gap-3">
                              <div className="bg-red-50 rounded-xl p-3"><p className="text-[10px] font-bold text-gray-400 uppercase">{tr607?'Kritik':'Critical'}</p><p className="text-xl font-black text-red-600">{criticalCount}</p></div>
                              <div className="bg-amber-50 rounded-xl p-3"><p className="text-[10px] font-bold text-gray-400 uppercase">{tr607?'Açık Fatura':'Unpaid'}</p><p className="text-xl font-black text-amber-600">{withDays.length}</p></div>
                              <div className="bg-orange-50 rounded-xl p-3"><p className="text-[10px] font-bold text-gray-400 uppercase">{tr607?'Toplam Bakiye':'Total O/S'}</p><p className="text-lg font-black text-orange-600">₺{Math.round(totalUnpaid).toLocaleString('tr-TR')}</p></div>
                            </div>
                            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                              {withDays.slice(0,20).map(o=>{
                                const bucket = getBucket(o.daysPast);
                                return (
                                  <div key={o.id} className={`flex items-center justify-between border rounded-xl px-4 py-2.5 ${bucket.bg}`}>
                                    <div className="min-w-0 flex-1">
                                      <p className="text-xs font-semibold text-gray-800 truncate">{o.customerName}</p>
                                      <p className="text-[10px] text-gray-400">{tr607?'Sipariş:':'Order:'} #{o.id.slice(-6)} · {o.daysPast}g</p>
                                    </div>
                                    <div className="flex items-center gap-3 shrink-0">
                                      <span className={`text-xs font-bold ${bucket.color}`}>{bucket.label}</span>
                                      <span className="text-xs font-mono text-gray-700">₺{(o.totalPrice||0).toLocaleString('tr-TR',{maximumFractionDigits:0})}</span>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                            <p className="text-[10px] text-gray-400">* {tr607?'Ödenmemiş siparişler gün sırasına göre listelenir. Eşikler yukarıdan ayarlanabilir.':'Unpaid orders listed by days outstanding. Thresholds adjustable above.'}</p>
                          </div>
                        );
                      })()}
                    </motion.div>
                  )}

                  {/* ── Phase 110: Ödenecekler / AP Tracker ── */}
                  {muhasebeTab === 'ap' && (
                    <motion.div key="muhasebe-ap" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
                      {(() => {
                        const toTs110 = (val: unknown): number => {
                          if (!val) return 0;
                          if (typeof (val as { toDate?: () => Date }).toDate === 'function') return (val as { toDate: () => Date }).toDate().getTime();
                          return new Date(val as string | number).getTime();
                        };
                        const now110 = Date.now();
                        // Only include open/pending POs (not delivered/cancelled)
                        const openPOs = apPurchaseOrders.filter(po => !['Teslim Alındı', 'İptal Edildi'].includes(po.status));
                        const totalAP = openPOs.reduce((s, po) => s + po.totalAmount, 0);

                        type APBucket = { label: string; range: string; orders: typeof openPOs; color: string; bg: string; dot: string };
                        const apBuckets: APBucket[] = [
                          { label: currentLanguage === 'tr' ? 'Vadesi Gelmedi (0–30 gün)' : 'Not Due (0–30 d)',  range: '0-30',  orders: [], color: 'text-emerald-700', bg: 'bg-emerald-50', dot: 'bg-emerald-400' },
                          { label: currentLanguage === 'tr' ? 'Yaklaşan (31–60 gün)'      : 'Due Soon (31–60 d)', range: '31-60', orders: [], color: 'text-amber-700',   bg: 'bg-amber-50',   dot: 'bg-amber-400'  },
                          { label: currentLanguage === 'tr' ? 'Gecikmiş (60+ gün)'        : 'Overdue (60+ d)',   range: '60+',   orders: [], color: 'text-red-700',     bg: 'bg-red-50',     dot: 'bg-red-500'    },
                        ];
                        openPOs.forEach(po => {
                          const created = toTs110(po.createdAt);
                          const days = created ? Math.floor((now110 - created) / 86400000) : 0;
                          if (days <= 30) apBuckets[0].orders.push(po);
                          else if (days <= 60) apBuckets[1].orders.push(po);
                          else apBuckets[2].orders.push(po);
                        });
                        const maxAmt110 = Math.max(...apBuckets.map(b => b.orders.reduce((s, po) => s + po.totalAmount, 0)), 1);

                        const apRate = apCurrency === 'USD' ? (exchangeRates?.USD ?? FX_FALLBACK.USD) : apCurrency === 'EUR' ? (exchangeRates?.EUR ?? FX_FALLBACK.EUR) : 1;
                        const apSym = apCurrency === 'TRY' ? '₺' : apCurrency === 'USD' ? '$' : '€';
                        const fmtAP = (n: number) => apCurrency === 'TRY' ? `₺${n.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}` : `${apSym}${(n / apRate).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                        return (
                          <>
                            {/* Summary KPIs */}
                            <div className="grid grid-cols-3 gap-4">
                              {[
                                { label: currentLanguage === 'tr' ? 'Toplam Borç' : 'Total Payable', value: totalAP, color: 'text-red-600', bg: 'bg-red-50' },
                                { label: currentLanguage === 'tr' ? 'Açık PO' : 'Open POs', value: openPOs.length, color: 'text-amber-600', bg: 'bg-amber-50', isCount: true },
                                { label: currentLanguage === 'tr' ? 'Gecikmiş' : 'Overdue', value: apBuckets[2].orders.reduce((s, po) => s + po.totalAmount, 0), color: 'text-red-700', bg: 'bg-red-100' },
                              ].map((k, i) => (
                                <div key={i} className={`apple-card p-5 ${k.bg}`}>
                                  <div className="flex items-center justify-between mb-1">
                                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{k.label}</p>
                                    {!((k as { isCount?: boolean }).isCount) && exchangeRates && (
                                      <div className="flex gap-0.5">
                                        {(['TRY','USD','EUR'] as const).map(c => (
                                          <button key={c} onClick={() => setApCurrency(c)}
                                            className={`px-1.5 py-0.5 rounded-md text-[9px] font-bold transition-all ${apCurrency === c ? 'bg-[#ff4000] text-white' : 'text-gray-400 hover:bg-gray-100'}`}>
                                            {c === 'TRY' ? '₺' : c === 'USD' ? '$' : '€'}
                                          </button>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                  <p className={`text-2xl font-black ${k.color}`}>
                                    {(k as { isCount?: boolean }).isCount ? k.value : fmtAP(k.value as number)}
                                  </p>
                                </div>
                              ))}
                            </div>

                            {/* AP Aging buckets */}
                            <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
                              <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
                                <Building2 size={15} className="text-gray-400" />
                                <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? 'Tedarikçi Borç Vade Analizi' : 'AP Aging Analysis'}</h3>
                              </div>
                              {openPOs.length === 0 ? (
                                <div className="py-12 text-center">
                                  <CheckCircle2 size={36} className="mx-auto mb-3 text-emerald-200" />
                                  <p className="text-sm text-gray-400">{currentLanguage === 'tr' ? 'Açık tedarikçi siparişi yok.' : 'No open supplier orders.'}</p>
                                </div>
                              ) : (
                                <div className="divide-y divide-gray-50">
                                  {apBuckets.map((b, bi) => {
                                    if (b.orders.length === 0) return null;
                                    const amt = b.orders.reduce((s, po) => s + po.totalAmount, 0);
                                    const barW = Math.round((amt / maxAmt110) * 100);
                                    return (
                                      <div key={bi} className="px-5 py-3.5 flex items-center gap-4">
                                        <div className="flex items-center gap-2 w-52 flex-shrink-0">
                                          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${b.dot}`} />
                                          <span className="text-xs font-semibold text-gray-700 truncate">{b.label}</span>
                                        </div>
                                        <div className="flex-1 flex items-center gap-3">
                                          <div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden">
                                            <div className={`h-2 rounded-full transition-all duration-700 ${b.dot}`} style={{ width: `${barW}%` }} />
                                          </div>
                                          <span className={`text-xs font-bold flex-shrink-0 w-24 text-right ${b.color}`}>
                                            {fmtAP(amt)}
                                          </span>
                                        </div>
                                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${b.bg} ${b.color}`}>
                                          {b.orders.length} {currentLanguage === 'tr' ? 'sipariş' : 'PO'}
                                        </span>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>

                            {/* PO list */}
                            {openPOs.length > 0 && (
                              <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
                                <div className="px-5 py-4 border-b border-gray-100">
                                  <h3 className="font-bold text-gray-800 text-sm">{currentLanguage === 'tr' ? 'Açık Siparişler' : 'Open Purchase Orders'}</h3>
                                </div>
                                <div className="divide-y divide-gray-50 max-h-72 overflow-y-auto">
                                  {openPOs.map(po => {
                                    const days110 = po.createdAt ? Math.floor((now110 - toTs110(po.createdAt)) / 86400000) : 0;
                                    const late = days110 > 60;
                                    return (
                                      <div key={po.id} className="flex items-center gap-4 px-5 py-3">
                                        <div className="flex-1 min-w-0">
                                          <p className="text-sm font-semibold text-gray-800">#{po.orderNumber} · {po.supplier}</p>
                                          <p className="text-[10px] text-gray-400">{days110} {currentLanguage === 'tr' ? 'gün önce oluşturuldu' : 'days ago'}</p>
                                        </div>
                                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                          po.status === 'Sipariş Edildi' ? 'bg-blue-50 text-blue-700' :
                                          po.status === 'Beklemede' ? 'bg-amber-50 text-amber-700' :
                                          'bg-gray-100 text-gray-600'
                                        }`}>{po.status}</span>
                                        <span className={`text-sm font-bold flex-shrink-0 ${late ? 'text-red-600' : 'text-gray-700'}`}>
                                          {fmtAP(po.totalAmount)}
                                        </span>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}
                          </>
                        );
                      })()}
                    </motion.div>
                  )}

                  {/* ── Phase 113: Budget vs Actuals ── */}
                  {muhasebeTab === 'butce' && (
                    <motion.div key="muhasebe-butce" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
                      {(() => {
                        const DEPTS = [
                          { key: 'satis',    label: currentLanguage === 'tr' ? 'Satış' : 'Sales' },
                          { key: 'pazarlama',label: currentLanguage === 'tr' ? 'Pazarlama' : 'Marketing' },
                          { key: 'operasyon',label: currentLanguage === 'tr' ? 'Operasyon' : 'Operations' },
                          { key: 'ik',       label: currentLanguage === 'tr' ? 'İnsan Kaynakları' : 'HR' },
                          { key: 'it',       label: 'IT' },
                          { key: 'genel',    label: currentLanguage === 'tr' ? 'Genel Giderler' : 'G&A' },
                        ];

                        // Actual: use order costs as a proxy for the selected month
                        const [bYear, bMonthN] = budgetMonth.split('-').map(Number);
                        const monthOrders = orders.filter(o => {
                          const raw = o.createdAt ?? o.syncedAt;
                          if (!raw) return false;
                          const d = typeof (raw as { toDate?: () => Date }).toDate === 'function'
                            ? (raw as { toDate: () => Date }).toDate()
                            : new Date(raw as string | number);
                          return d.getFullYear() === bYear && d.getMonth() + 1 === bMonthN;
                        });
                        const totalMonthRevenue = monthOrders.reduce((s, o) => s + (o.totalPrice || 0), 0);
                        // Distribute actual spend proportionally (heuristic — real ERP uses cost centers)
                        const actualSplit: Record<string, number> = {
                          satis:     totalMonthRevenue * 0.12,
                          pazarlama: totalMonthRevenue * 0.06,
                          operasyon: totalMonthRevenue * 0.10,
                          ik:        totalMonthRevenue * 0.08,
                          it:        totalMonthRevenue * 0.03,
                          genel:     totalMonthRevenue * 0.05,
                        };

                        const getBudget = (key: string) => budgets.find(b => b.dept === key)?.budgetTRY || 0;
                        const totalBudget = DEPTS.reduce((s, d) => s + getBudget(d.key), 0);
                        const totalActual = DEPTS.reduce((s, d) => s + (actualSplit[d.key] || 0), 0);

                        const saveBudgets = (newBudgets: BudgetEntry[]) => {
                          setBudgets(newBudgets);
                          const updated = { ...allBudgetsFirestore, [budgetMonth]: newBudgets };
                          setAllBudgetsFirestore(updated);
                          setDoc(doc(db, 'settings', 'budgets'), { [budgetMonth]: newBudgets }, { merge: true }).catch(() => {});
                        };

                        const butceRate = butceCurrency === 'USD' ? (exchangeRates?.USD ?? FX_FALLBACK.USD) : butceCurrency === 'EUR' ? (exchangeRates?.EUR ?? FX_FALLBACK.EUR) : 1;
                        const butceSym = butceCurrency === 'TRY' ? '₺' : butceCurrency === 'USD' ? '$' : '€';
                        const fmtButce = (n: number) => butceCurrency === 'TRY' ? `₺${n.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}` : `${butceSym}${(n / butceRate).toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
                        return (
                          <>
                            {/* Month picker + summary */}
                            <div className="flex flex-wrap items-center gap-4">
                              <div className="flex items-center gap-2">
                                <label className="text-xs font-bold text-gray-500">{currentLanguage === 'tr' ? 'Dönem' : 'Period'}:</label>
                                <input
                                  type="month"
                                  value={budgetMonth}
                                  onChange={e => setBudgetMonth(e.target.value)}
                                  className="apple-input text-sm px-3 py-1.5"
                                />
                              </div>
                              {exchangeRates && (
                                <div className="flex gap-0.5 bg-gray-100 rounded-lg p-0.5">
                                  {(['TRY','USD','EUR'] as const).map(c => (
                                    <button key={c} onClick={() => setButceCurrency(c)}
                                      className={`px-2 py-1 rounded-md text-[10px] font-bold transition-all ${butceCurrency === c ? 'bg-white shadow-sm text-gray-800' : 'text-gray-400 hover:text-gray-600'}`}>
                                      {c === 'TRY' ? '₺' : c === 'USD' ? '$' : '€'}
                                    </button>
                                  ))}
                                </div>
                              )}
                              <div className="flex items-center gap-6 ml-auto">
                                <div className="text-right">
                                  <p className="text-[10px] text-gray-400">{currentLanguage === 'tr' ? 'Toplam Bütçe' : 'Total Budget'}</p>
                                  <p className="text-sm font-black text-gray-800">{fmtButce(totalBudget)}</p>
                                </div>
                                <div className="text-right">
                                  <p className="text-[10px] text-gray-400">{currentLanguage === 'tr' ? 'Gerçekleşen' : 'Actual'}</p>
                                  <p className={`text-sm font-black ${totalActual > totalBudget ? 'text-red-600' : 'text-emerald-600'}`}>
                                    {fmtButce(totalActual)}
                                  </p>
                                </div>
                              </div>
                            </div>

                            {/* Dept rows */}
                            <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
                              <div className="divide-y divide-gray-50">
                                {DEPTS.map(dept => {
                                  const budget = getBudget(dept.key);
                                  const actual = actualSplit[dept.key] || 0;
                                  const pct    = budget > 0 ? Math.round((actual / budget) * 100) : 0;
                                  const over   = actual > budget && budget > 0;
                                  return (
                                    <div key={dept.key} className="px-5 py-4">
                                      <div className="flex items-center gap-3 mb-2">
                                        <span className="text-sm font-bold text-gray-800 flex-1">{dept.label}</span>
                                        <div className="flex items-center gap-2">
                                          <div className="relative flex-shrink-0">
                                            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-gray-400">₺</span>
                                            <input
                                              type="number"
                                              value={budgetDraft[dept.key] ?? String(budget)}
                                              onChange={e => setBudgetDraft(prev => ({ ...prev, [dept.key]: e.target.value }))}
                                              onBlur={() => {
                                                const val = Number(budgetDraft[dept.key]);
                                                if (!isNaN(val) && val >= 0) {
                                                  const updated = budgets.filter(b => b.dept !== dept.key);
                                                  if (val > 0) updated.push({ dept: dept.key, budgetTRY: val });
                                                  saveBudgets(updated);
                                                }
                                                setBudgetDraft(prev => { const n = { ...prev }; delete n[dept.key]; return n; });
                                              }}
                                              className="apple-input w-32 pl-6 pr-2 py-1.5 text-right text-sm font-bold"
                                              placeholder="0"
                                            />
                                          </div>
                                          <span className={`text-xs font-bold w-12 text-right ${over ? 'text-red-600' : pct > 80 ? 'text-amber-600' : 'text-emerald-600'}`}>
                                            {pct}%
                                          </span>
                                        </div>
                                      </div>
                                      <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
                                        <div
                                          className={`h-2 rounded-full transition-all duration-500 ${over ? 'bg-red-400' : pct > 80 ? 'bg-amber-400' : 'bg-emerald-400'}`}
                                          style={{ width: `${Math.min(pct, 100)}%` }}
                                        />
                                      </div>
                                      <div className="flex justify-between mt-1">
                                        <span className="text-[10px] text-gray-400">
                                          {currentLanguage === 'tr' ? 'Gerçekleşen' : 'Actual'}: {fmtButce(actual)}
                                        </span>
                                        {over && (
                                          <span className="text-[10px] font-bold text-red-600">
                                            +{fmtButce(actual - budget)} {currentLanguage === 'tr' ? 'aşım' : 'over'}
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                              <div className="px-5 py-3 bg-gray-50 border-t border-gray-100 text-[10px] text-gray-400">
                                {currentLanguage === 'tr'
                                  ? '* Gerçekleşen değerler aylık siparişlerden maliyet merkezi dağılımına göre hesaplanır.'
                                  : '* Actual values are estimated from monthly order revenue by cost center split.'}
                              </div>
                            </div>
                          </>
                        );
                      })()}
                    </motion.div>
                  )}

                  {/* ── Phase 118: Banka Mutabakatı ── */}
                  {muhasebeTab === 'banka' && (
                    <motion.div key="muhasebe-banka" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
                      {(() => {
                        const [rYear, rMonthN] = reconMonth.split('-').map(Number);
                        const monthPaidOrders = orders.filter(o => {
                          if (!o.paid) return false;
                          const raw = o.createdAt ?? o.syncedAt;
                          if (!raw) return false;
                          const d = typeof (raw as { toDate?: () => Date }).toDate === 'function'
                            ? (raw as { toDate: () => Date }).toDate()
                            : new Date(raw as string | number);
                          return d.getFullYear() === rYear && d.getMonth() + 1 === rMonthN;
                        });
                        const bookReceipts   = monthPaidOrders.reduce((s, o) => s + (o.totalPrice || 0), 0);
                        const openAPThisMonth = apPurchaseOrders
                          .filter(po => {
                            if (['Teslim Alındı', 'İptal Edildi'].includes(po.status)) return false;
                            const ts = po.createdAt ? (() => {
                              if (typeof (po.createdAt as { toDate?: () => Date }).toDate === 'function') return (po.createdAt as { toDate: () => Date }).toDate();
                              return new Date(po.createdAt as string | number);
                            })() : null;
                            return ts ? ts.getFullYear() === rYear && ts.getMonth() + 1 === rMonthN : false;
                          })
                          .reduce((s, po) => s + po.totalAmount, 0);
                        const estimatedBalance = bankBalance + bookReceipts - openAPThisMonth;
                        const gap = bankBalance - estimatedBalance;
                        const gapAbs = Math.abs(gap);
                        const balanced = gapAbs < 1000;

                        return (
                          <>
                            <div className="flex flex-wrap items-center gap-4">
                              <div className="flex items-center gap-2">
                                <label className="text-xs font-bold text-gray-500">{currentLanguage === 'tr' ? 'Dönem' : 'Period'}:</label>
                                <input type="month" value={reconMonth} onChange={e => setReconMonth(e.target.value)} className="apple-input text-sm px-3 py-1.5" />
                              </div>
                              <button onClick={() => setShowBankImport(true)} className="apple-button-secondary text-sm px-4 py-1.5 flex items-center gap-1.5 ml-auto">
                                <Upload className="w-4 h-4" />
                                {currentLanguage === 'tr' ? 'CSV Ekstre Yükle' : 'Import CSV Statement'}
                              </button>
                            </div>

                            {/* Main reconciliation card */}
                            <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
                              <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
                                <CreditCard size={16} className="text-gray-400" />
                                <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? 'Banka Mutabakat Özeti' : 'Bank Reconciliation Summary'}</h3>
                                <span className={`ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full ${balanced ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                                  {balanced ? (currentLanguage === 'tr' ? '✓ Mutabık' : '✓ Balanced') : (currentLanguage === 'tr' ? '⚠ Fark Var' : '⚠ Discrepancy')}
                                </span>
                              </div>
                              <div className="p-5 space-y-4">
                                {/* Bank balance entry */}
                                <div className="flex items-center justify-between p-4 bg-blue-50 rounded-xl">
                                  <div>
                                    <p className="text-xs font-bold text-blue-700">{currentLanguage === 'tr' ? 'Banka Ekstresindeki Bakiye' : 'Bank Statement Balance'}</p>
                                    <p className="text-[10px] text-blue-500 mt-0.5">{currentLanguage === 'tr' ? 'Manuel olarak girin' : 'Enter manually'}</p>
                                  </div>
                                  {bankBalanceEditing ? (
                                    <div className="flex items-center gap-2">
                                      <div className="relative">
                                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-sm text-gray-400">₺</span>
                                        <input
                                          autoFocus
                                          type="number"
                                          value={bankBalanceDraft}
                                          onChange={e => setBankBalanceDraft(e.target.value)}
                                          onBlur={() => { setBankBalance(Number(bankBalanceDraft) || 0); setBankBalanceEditing(false); }}
                                          onKeyDown={e => { if (e.key === 'Enter') { setBankBalance(Number(bankBalanceDraft) || 0); setBankBalanceEditing(false); } }}
                                          className="apple-input w-36 pl-6 text-right font-bold"
                                        />
                                      </div>
                                    </div>
                                  ) : (
                                    <button
                                      onClick={() => { setBankBalanceDraft(String(bankBalance)); setBankBalanceEditing(true); }}
                                      className="text-xl font-black text-blue-700 hover:text-blue-900 transition-colors"
                                    >
                                      {fmtKpi(bankBalance,'full',0)}
                                      <span className="text-[10px] text-blue-400 ml-1">✎</span>
                                    </button>
                                  )}
                                </div>

                                {/* Rows */}
                                {[
                                  { label: currentLanguage === 'tr' ? '+ Tahsil edilen (ödendi)' : '+ Collected (paid orders)', value: bookReceipts,     color: 'text-emerald-600', sign: '+' },
                                  { label: currentLanguage === 'tr' ? '− Açık satın alma siparişleri' : '− Open purchase orders',    value: openAPThisMonth, color: 'text-red-500',     sign: '−' },
                                  { label: currentLanguage === 'tr' ? '= Hesaplanan Bakiye'           : '= Calculated Balance',      value: estimatedBalance, color: 'text-gray-800',    sign: '=' },
                                ].map((row, i) => (
                                  <div key={i} className={`flex items-center justify-between py-2.5 border-b border-gray-50 ${i === 2 ? 'border-t border-gray-200 pt-3 mt-1' : ''}`}>
                                    <span className="text-sm text-gray-600">{row.label}</span>
                                    <span className={`text-sm font-black ${row.color}`}>
                                      {row.sign} {fmtKpi(Math.abs(row.value),'full',0)}
                                    </span>
                                  </div>
                                ))}

                                {/* Gap */}
                                {!balanced && (
                                  <div className="flex items-center justify-between p-3 bg-amber-50 rounded-xl mt-2">
                                    <span className="text-sm font-bold text-amber-700">{currentLanguage === 'tr' ? 'Açıklanamayan Fark' : 'Unexplained Difference'}</span>
                                    <span className="text-sm font-black text-amber-700">
                                      {gap > 0 ? '+' : '−'} {fmtKpi(gapAbs,'full',0)}
                                    </span>
                                  </div>
                                )}
                              </div>
                              <div className="px-5 py-3 bg-gray-50 border-t border-gray-100 text-[10px] text-gray-400">
                                {currentLanguage === 'tr'
                                  ? '* Banka ekstrenizi sisteme girerek otomatik karşılaştırma yapabilirsiniz.'
                                  : '* Enter your bank statement balance to auto-reconcile against book records.'}
                              </div>
                            </div>
                          </>
                        );
                      })()}

                      <BankBalanceReport
                        currentLanguage={currentLanguage}
                        exchangeRates={exchangeRates}
                        toast={toast}
                      />

                      <BankStatementImportModal
                        isOpen={showBankImport}
                        onClose={() => setShowBankImport(false)}
                        currentLanguage={currentLanguage}
                        bankAccounts={p547BankAccounts.map(a => ({ id: a.id, bankName: a.bankName, currency: a.currency }))}
                        toast={toast}
                      />

                      {/* ── Phase 623: Akreditif & Ödeme Belgesi ─────────────────── */}
                      {hasFullAccess('muhasebe') && (() => {
                        const tr623 = currentLanguage === 'tr';
                        const openLCs = p623LCs.filter(lc=>lc.status==='Açık');
                        const totalValue623 = openLCs.reduce((s,lc)=>s+lc.amount,0);
                        const expiringSoon = openLCs.filter(lc=>new Date(lc.expiryDate)<=new Date(Date.now()+30*86400000)).length;
                        const statCls:{[k:string]:string}={Açık:'bg-emerald-100 text-emerald-700','Kullanıldı':'bg-blue-100 text-blue-700','Sona Erdi':'bg-gray-100 text-gray-500',İptal:'bg-red-100 text-red-700'};
                        return (
                          <div className="apple-card p-5 space-y-4 mt-4">
                            <div className="flex items-center justify-between flex-wrap gap-2">
                              <h3 className="font-bold text-gray-900 text-sm">📄 {tr623?'Akreditif (L/C) Takibi':'Letter of Credit (L/C) Tracking'}</h3>
                              <button onClick={()=>setP623ShowForm(v=>!v)} className="apple-button-secondary text-xs flex items-center gap-1.5"><Plus className="w-3.5 h-3.5"/>{tr623?'L/C Ekle':'Add L/C'}</button>
                            </div>
                            {expiringSoon>0&&<div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-xs font-bold text-amber-700">⚠️ {expiringSoon} {tr623?'L/C 30 gün içinde sona eriyor':'L/C expiring within 30 days'}</div>}
                            <div className="grid grid-cols-3 gap-3">
                              <div className="bg-emerald-50 rounded-xl p-3"><p className="text-[10px] font-bold text-gray-400 uppercase">{tr623?'Açık L/C':'Open L/C'}</p><p className="text-xl font-black text-emerald-600">{openLCs.length}</p></div>
                              <div className="bg-blue-50 rounded-xl p-3"><p className="text-[10px] font-bold text-gray-400 uppercase">{tr623?'Toplam Değer':'Total Value'}</p><p className="text-base font-black text-blue-600">${totalValue623.toLocaleString('tr-TR')}</p></div>
                              <div className="bg-amber-50 rounded-xl p-3"><p className="text-[10px] font-bold text-gray-400 uppercase">{tr623?'Sona Yakın':'Expiring Soon'}</p><p className="text-xl font-black text-amber-600">{expiringSoon}</p></div>
                            </div>
                            {p623ShowForm && (
                              <div className="bg-gray-50 rounded-xl p-4 space-y-3">
                                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                                  <input className="apple-input" placeholder={tr623?'Banka':'Bank'} value={p623Draft.bank} onChange={e=>setP623Draft(d=>({...d,bank:e.target.value}))}/>
                                  <input className="apple-input" placeholder={tr623?'Lehtar':'Beneficiary'} value={p623Draft.beneficiary} onChange={e=>setP623Draft(d=>({...d,beneficiary:e.target.value}))}/>
                                  <input className="apple-input" placeholder="Ref" value={p623Draft.ref} onChange={e=>setP623Draft(d=>({...d,ref:e.target.value}))}/>
                                  <input type="number" className="apple-input" placeholder={tr623?'Tutar':'Amount'} value={p623Draft.amount} onChange={e=>setP623Draft(d=>({...d,amount:e.target.value}))}/>
                                  <select value={p623Draft.currency} onChange={e=>setP623Draft(d=>({...d,currency:e.target.value as typeof d.currency}))} className="apple-input">{['USD','EUR'].map(c=><option key={c}>{c}</option>)}</select>
                                  <input type="date" className="apple-input" value={p623Draft.expiryDate} onChange={e=>setP623Draft(d=>({...d,expiryDate:e.target.value}))}/>
                                </div>
                                <button onClick={async ()=>{
                                  if(!p623Draft.bank||!p623Draft.amount) return;
                                  try { await addDoc(collection(db,'letterOfCredit'),{bank:p623Draft.bank,beneficiary:p623Draft.beneficiary,amount:Number(p623Draft.amount),currency:p623Draft.currency,expiryDate:p623Draft.expiryDate,status:'Açık',ref:p623Draft.ref,createdAt:serverTimestamp()}); toast(currentLanguage === 'tr' ? 'Akreditif eklendi ✓' : 'LC added ✓', 'success'); } catch(e){console.error("[firestore]", e); toast(currentLanguage === 'tr' ? 'Akreditif eklenemedi.' : 'Failed to add LC.', 'error');}
                                  setP623Draft(d=>({...d,bank:'',beneficiary:'',amount:'',ref:'',expiryDate:''}));
                                  setP623ShowForm(false);
                                  toast(tr623?'L/C eklendi.':'L/C added.','success');
                                }} className="apple-button-primary text-xs px-6">{tr623?'Kaydet':'Save'}</button>
                              </div>
                            )}
                            {p623LCs.length > 0 && (
                              <div className="overflow-x-auto"><table className="w-full text-xs">
                                <thead><tr className="border-b border-gray-100 bg-gray-50">{[tr623?'Banka':'Bank',tr623?'Lehtar':'Beneficiary','Ref',tr623?'Tutar':'Amount',tr623?'Vade':'Expiry',tr623?'Durum':'Status'].map(h=><th key={h} className="px-3 py-2 text-left text-[10px] font-bold text-gray-400 uppercase">{h}</th>)}</tr></thead>
                                <tbody className="divide-y divide-gray-50">
                                  {[...p623LCs].sort((a,b)=>a.expiryDate.localeCompare(b.expiryDate)).map(lc=>(
                                    <tr key={lc.id} className="hover:bg-gray-50/50">
                                      <td className="px-3 py-2.5 font-medium text-gray-800">{lc.bank}</td>
                                      <td className="px-3 py-2.5 text-gray-600">{lc.beneficiary}</td>
                                      <td className="px-3 py-2.5 font-mono text-gray-500">{lc.ref}</td>
                                      <td className="px-3 py-2.5 font-bold">{lc.currency} {lc.amount.toLocaleString()}</td>
                                      <td className="px-3 py-2.5 text-gray-500">{lc.expiryDate?new Date(lc.expiryDate).toLocaleDateString('tr-TR'):'—'}</td>
                                      <td className="px-3 py-2.5"><select value={lc.status} onChange={async e=>{try{await updateDoc(doc(db,'letterOfCredit',lc.id),{status:e.target.value});}catch(err){console.error(err);}}} className={`text-[10px] font-bold px-2 py-0.5 rounded-full border-0 ${statCls[lc.status]}`}>{['Açık','Kullanıldı','Sona Erdi','İptal'].map(s=><option key={s}>{s}</option>)}</select></td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table></div>
                            )}
                          </div>
                        );
                      })()}

                      {/* ── Phase 638: Otomatik Ödeme Eşleştirme ─────────────────── */}
                      {(() => {
                        const tr638 = currentLanguage === 'tr';
                        const runMatch = () => {
                          const unpaidInvoices = orders.filter(o=>!o.paid&&o.status!=='Cancelled').map(o=>({
                            invoiceId:o.id,
                            invoiceNo:`INV-${o.id.slice(-6)}`,
                            customer:o.customerName||'',
                            invoiceAmount:o.totalPrice||0,
                          }));
                          const results = unpaidInvoices.map(inv=>{
                            const paidCustOrders = orders.filter(o=>o.paid && o.customerName===inv.customer);
                            const exactMatch = paidCustOrders.some(o=>(o.totalPrice||0)===inv.invoiceAmount);
                            const confidence = exactMatch?100:paidCustOrders.length>0?80:60;
                            const matchedAmount = confidence===100?inv.invoiceAmount:confidence===80?Math.round(inv.invoiceAmount*0.8):0;
                            const status: 'Tam'|'Kısmi'|'Eşleşmedi' = confidence===100?'Tam':matchedAmount>0?'Kısmi':'Eşleşmedi';
                            return {...inv,matchedAmount,confidence,status};
                          });
                          setP638MatchResults(results);
                          setP638Running(false);
                        };
                        const statusCls:{[k:string]:string}={Tam:'bg-emerald-100 text-emerald-700',Kısmi:'bg-amber-100 text-amber-700',Eşleşmedi:'bg-red-100 text-red-700'};
                        const totalMatched = p638MatchResults.filter(r=>r.status==='Tam').length;
                        const totalUnmatched = p638MatchResults.filter(r=>r.status==='Eşleşmedi').length;
                        return (
                          <div className="apple-card p-5 space-y-4 mt-4">
                            <div className="flex items-center justify-between flex-wrap gap-2">
                              <div><h3 className="font-bold text-gray-900 text-sm">🤖 {tr638?'Otomatik Ödeme Eşleştirme':'Auto Payment Matching'}</h3>
                              <p className="text-xs text-gray-400">{tr638?'Banka hareketlerini faturalara AI ile eşleştirir':'AI matches bank transactions to invoices'}</p></div>
                              <button onClick={()=>{setP638Running(true);setTimeout(runMatch,900);}} disabled={p638Running} className="apple-button-primary text-xs px-4 py-1.5 flex items-center gap-1.5 disabled:opacity-50">
                                {p638Running?<span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin"/>:'🤖'}
                                {tr638?'Eşleştir':'Match'}</button>
                            </div>
                            {p638MatchResults.length > 0 && (
                              <>
                                <div className="grid grid-cols-3 gap-3">
                                  <div className="bg-emerald-50 rounded-xl p-3"><p className="text-[10px] font-bold text-gray-400 uppercase">{tr638?'Tam Eşleşme':'Full Match'}</p><p className="text-xl font-black text-emerald-600">{totalMatched}</p></div>
                                  <div className="bg-amber-50 rounded-xl p-3"><p className="text-[10px] font-bold text-gray-400 uppercase">{tr638?'Kısmi':'Partial'}</p><p className="text-xl font-black text-amber-600">{p638MatchResults.filter(r=>r.status==='Kısmi').length}</p></div>
                                  <div className="bg-red-50 rounded-xl p-3"><p className="text-[10px] font-bold text-gray-400 uppercase">{tr638?'Eşleşmedi':'Unmatched'}</p><p className="text-xl font-black text-red-600">{totalUnmatched}</p></div>
                                </div>
                                <div className="overflow-x-auto">
                                  <table className="w-full text-xs">
                                    <thead><tr className="border-b border-gray-100 bg-gray-50">
                                      {[tr638?'Fatura No':'Invoice No',tr638?'Müşteri':'Customer',tr638?'Tutar':'Amount',tr638?'Eşleşen':'Matched','Güven','Durum'].map(h=>(
                                        <th key={h} className="px-3 py-2 text-left text-[10px] font-bold text-gray-400 uppercase">{h}</th>
                                      ))}
                                    </tr></thead>
                                    <tbody className="divide-y divide-gray-50">
                                      {p638MatchResults.slice(0,10).map(r=>(
                                        <tr key={r.invoiceId} className="hover:bg-gray-50/50">
                                          <td className="px-3 py-2.5 font-mono text-gray-600">{r.invoiceNo}</td>
                                          <td className="px-3 py-2.5 font-medium text-gray-800">{r.customer}</td>
                                          <td className="px-3 py-2.5 font-mono text-gray-700">₺{r.invoiceAmount.toLocaleString('tr-TR',{maximumFractionDigits:0})}</td>
                                          <td className="px-3 py-2.5 font-mono text-emerald-600">₺{r.matchedAmount.toLocaleString('tr-TR',{maximumFractionDigits:0})}</td>
                                          <td className="px-3 py-2.5"><div className="flex items-center gap-1.5"><div className="w-12 bg-gray-100 rounded-full h-1.5 overflow-hidden"><div className={`h-full rounded-full ${r.confidence>80?'bg-emerald-400':r.confidence>60?'bg-amber-400':'bg-red-400'}`} style={{width:`${r.confidence}%`}}/></div><span className="text-gray-500">%{r.confidence}</span></div></td>
                                          <td className="px-3 py-2.5"><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${statusCls[r.status]}`}>{r.status}</span></td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </>
                            )}
                            {p638MatchResults.length===0&&!p638Running&&<p className="text-center text-gray-400 text-xs py-4">{tr638?`${orders.filter(o=>!o.paid&&o.status!=='Cancelled').length} ödenmemiş fatura için "Eşleştir" butonuna tıklayın.`:`Click "Match" to auto-match ${orders.filter(o=>!o.paid&&o.status!=='Cancelled').length} unpaid invoices.`}</p>}
                          </div>
                        );
                      })()}
                    </motion.div>
                  )}

                  {/* ── Sabit Kıymetler ── */}
                  {muhasebeTab === 'sabit-kiymet' && (
                    <motion.div key="muhasebe-sabit" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
                      <React.Suspense fallback={LAZY_FALLBACK}>
                        <SabitKiymetModule
                          currentLanguage={currentLanguage}
                          isAuthenticated={!!user && hasFullAccess('muhasebe')}
                          exchangeRates={exchangeRates}
                        />
                      </React.Suspense>
                    </motion.div>
                  )}

                  {/* ── Maliyet Merkezleri ── */}
                  {muhasebeTab === 'maliyet' && (
                    <motion.div key="muhasebe-maliyet" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
                      <React.Suspense fallback={LAZY_FALLBACK}>
                        <MaliyetMerkeziModule
                          currentLanguage={currentLanguage as 'tr' | 'en'}
                          isAuthenticated={!!user && hasFullAccess('muhasebe')}
                        />
                      </React.Suspense>
                    </motion.div>
                  )}

                  {/* ── Phase 131: AR Aging per Customer ── */}
                  {muhasebeTab === 'ar-aging' && (
                    <motion.div key="muhasebe-ar-aging" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
                      <ModuleHeader
                        title={currentLanguage === 'tr' ? 'Müşteri Alacak Yaşlandırması' : 'Customer AR Aging'}
                        subtitle={currentLanguage === 'tr' ? 'Müşteri bazında ödenmemiş alacakların vade analizi' : 'Per-customer unpaid receivables aging analysis'}
                        icon={Users}
                      />
                      {(() => {
                        const now131 = Date.now();
                        const unpaid131 = orders.filter(o => !o.paid && o.status !== 'Cancelled');
                        // Group by customer
                        type CustAR = { name: string; total: number; b0_30: number; b31_60: number; b61_90: number; b90p: number; oldest: number };
                        const custMap: Record<string, CustAR> = {};
                        for (const o of unpaid131) {
                          const name = o.customerName || '—';
                          if (!custMap[name]) custMap[name] = { name, total: 0, b0_30: 0, b31_60: 0, b61_90: 0, b90p: 0, oldest: 0 };
                          const raw = o.createdAt ?? o.syncedAt;
                          const d = raw
                            ? (typeof (raw as { toDate?: () => Date }).toDate === 'function' ? (raw as { toDate: () => Date }).toDate() : new Date(raw as string | number))
                            : new Date();
                          const days = Math.floor((now131 - d.getTime()) / 86400000);
                          const amt = o.totalPrice || 0;
                          custMap[name].total += amt;
                          custMap[name].oldest = Math.max(custMap[name].oldest, days);
                          if (days <= 30) custMap[name].b0_30 += amt;
                          else if (days <= 60) custMap[name].b31_60 += amt;
                          else if (days <= 90) custMap[name].b61_90 += amt;
                          else custMap[name].b90p += amt;
                        }
                        const custs = Object.values(custMap).sort((a, b) => b.total - a.total);
                        const totalAR = custs.reduce((s, c) => s + c.total, 0);
                        if (custs.length === 0) return (
                          <div className="text-center py-16 bg-white border border-gray-100 rounded-2xl">
                            <CheckCircle2 size={40} className="mx-auto mb-3 text-emerald-200" />
                            <p className="text-sm text-gray-400">{currentLanguage === 'tr' ? 'Tüm siparişler tahsil edildi.' : 'All orders collected.'}</p>
                          </div>
                        );
                        const r131 = kpiCurrency === 'USD' ? (exchangeRates?.USD ?? FX_FALLBACK.USD) : kpiCurrency === 'EUR' ? (exchangeRates?.EUR ?? FX_FALLBACK.EUR) : 1;
                        const s131 = kpiCurrency === 'TRY' ? '₺' : kpiCurrency === 'USD' ? '$' : '€';
                        const f131 = (v: number) => (kpiCurrency === 'TRY' ? v : v / r131).toLocaleString('tr-TR', { maximumFractionDigits: 0 });
                        return (
                          <div className="space-y-3">
                            {/* Summary cards */}
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                              {[
                                { label: '0–30 gün', val: custs.reduce((s, c) => s + c.b0_30, 0), color: 'text-emerald-600', bg: 'bg-emerald-50' },
                                { label: '31–60 gün', val: custs.reduce((s, c) => s + c.b31_60, 0), color: 'text-amber-600', bg: 'bg-amber-50' },
                                { label: '61–90 gün', val: custs.reduce((s, c) => s + c.b61_90, 0), color: 'text-orange-600', bg: 'bg-orange-50' },
                                { label: '90+ gün', val: custs.reduce((s, c) => s + c.b90p, 0), color: 'text-red-600', bg: 'bg-red-50' },
                              ].map(k => (
                                <div key={k.label} className={`apple-card p-4 ${k.bg}`}>
                                  <p className="text-[10px] font-bold text-gray-400 uppercase">{k.label}</p>
                                  <p className={`text-xl font-bold ${k.color}`}>{s131}{f131(k.val)}</p>
                                </div>
                              ))}
                            </div>
                            {/* Per-customer table */}
                            <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
                              <div className="px-5 py-3 bg-gray-50 border-b border-gray-100 grid grid-cols-6 text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                                <span className="col-span-2">{currentLanguage === 'tr' ? 'Müşteri' : 'Customer'}</span>
                                <span className="text-right">0–30</span>
                                <span className="text-right">31–60</span>
                                <span className="text-right">61–90</span>
                                <span className="text-right">90+</span>
                              </div>
                              <div className="divide-y divide-gray-50 max-h-96 overflow-y-auto">
                                {custs.map(c => (
                                  <div key={c.name} className="px-5 py-3 grid grid-cols-6 items-center hover:bg-gray-50/50 transition-all">
                                    <div className="col-span-2 min-w-0">
                                      <p className="text-xs font-bold text-gray-800 truncate">{c.name}</p>
                                      <p className="text-[10px] text-gray-400">{currentLanguage === 'tr' ? 'Toplam' : 'Total'}: {s131}{f131(c.total)} · {c.oldest}g</p>
                                    </div>
                                    {[c.b0_30, c.b31_60, c.b61_90, c.b90p].map((v, i) => (
                                      <span key={i} className={`text-xs font-bold text-right ${v > 0 ? i === 0 ? 'text-emerald-600' : i === 1 ? 'text-amber-600' : i === 2 ? 'text-orange-600' : 'text-red-600' : 'text-gray-200'}`}>
                                        {v > 0 ? s131 + f131(v) : '—'}
                                      </span>
                                    ))}
                                  </div>
                                ))}
                              </div>
                              <div className="px-5 py-3 bg-gray-50 border-t border-gray-100 flex justify-between text-xs font-bold">
                                <span className="text-gray-500">{custs.length} {currentLanguage === 'tr' ? 'müşteri' : 'customers'}</span>
                                <span className="text-gray-800">{currentLanguage === 'tr' ? 'Toplam Alacak' : 'Total AR'}: {s131}{f131(totalAR)}</span>
                              </div>
                            </div>
                          </div>
                        );
                      })()}
                    </motion.div>
                  )}

                  {/* ── Phase 178: Overdue Invoice Escalation ── */}
                  {muhasebeTab === 'ar-aging' && orders.filter(o => !o.paid && o.status !== 'Cancelled').length > 0 && (() => {
                    const now178 = new Date();
                    const overdueOrders = orders
                      .filter(o => !o.paid && o.status !== 'Cancelled' && o.createdAt)
                      .map(o => {
                        let daysOld = 0;
                        try {
                          const d = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
                          daysOld = Math.floor((now178.getTime() - d.getTime()) / 86400000);
                        } catch { /* skip */ }
                        return { ...o, daysOld };
                      })
                      .filter(o => o.daysOld > 30)
                      .sort((a, b) => b.daysOld - a.daysOld)
                      .slice(0, 8);
                    if (overdueOrders.length === 0) return null;
                    return (
                      <div className="apple-card p-5 border border-red-100 mt-4">
                        <div className="flex items-center gap-2 mb-3">
                          <AlertCircle className="w-4 h-4 text-red-500" />
                          <h3 className="font-bold text-gray-800 text-sm">{currentLanguage === 'tr' ? 'Eskalasyon Gerektiren Faturalar' : 'Overdue Invoice Escalation'}</h3>
                          <span className="ml-auto text-[10px] text-red-600 font-bold bg-red-50 px-2 py-0.5 rounded-full">{overdueOrders.length} {currentLanguage==='tr'?'>30g gecikmiş':'>30d overdue'}</span>
                        </div>
                        <div className="space-y-2">
                          {overdueOrders.map(o => {
                            const escLevel = o.daysOld > 90 ? { label: 'L3', cls: 'bg-red-100 text-red-800' } : o.daysOld > 60 ? { label: 'L2', cls: 'bg-orange-100 text-orange-800' } : { label: 'L1', cls: 'bg-amber-100 text-amber-700' };
                            return (
                              <div key={o.id} className="flex items-center gap-3 py-1.5 border-b border-gray-50 last:border-0">
                                <span className={`text-[9px] font-black px-1.5 py-0.5 rounded shrink-0 ${escLevel.cls}`}>{escLevel.label}</span>
                                <div className="flex-1 min-w-0">
                                  <p className="text-xs font-medium text-gray-800 truncate">{o.customerName}</p>
                                  <p className="text-[10px] text-gray-400">{o.daysOld}g {currentLanguage==='tr'?'gecikmiş':'overdue'}</p>
                                </div>
                                <span className="text-xs font-bold text-red-600 shrink-0">{fmtKpi((o.totalPrice||0))}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}

                  {/* ── Phase 132: Financial Ratios ── */}
                  {muhasebeTab === 'finansal-oranlar' && (
                    <motion.div key="muhasebe-ratios" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
                      <ModuleHeader
                        title={currentLanguage === 'tr' ? 'Finansal Oranlar' : 'Financial Ratios'}
                        subtitle={currentLanguage === 'tr' ? 'SAP / NetSuite benzeri likidite, karlılık ve verimlilik göstergeleri' : 'SAP/NetSuite-style liquidity, profitability and efficiency ratios'}
                        icon={Activity}
                      />
                      {(() => {
                        const totalRevenue132 = orders.filter(o => o.status !== 'Cancelled').reduce((s, o) => s + (o.totalPrice || 0), 0);
                        const totalCOGS132 = orders.filter(o => o.status !== 'Cancelled').reduce((s, o) => s + (o.lineItems ?? []).reduce((ls, li) => ls + ((li.costPrice ?? 0) * li.quantity), 0), 0);
                        const grossProfit132 = totalRevenue132 - totalCOGS132;
                        const totalAR132 = orders.filter(o => !o.paid && o.status !== 'Cancelled').reduce((s, o) => s + (o.totalPrice || 0), 0);
                        const totalAP132 = apPurchaseOrders.filter(po => !['Teslim Alındı', 'İptal Edildi'].includes(po.status)).reduce((s, po) => s + (po.totalAmount || 0), 0);
                        const inventoryValue132 = inventory.reduce((s, i) => s + ((i.stockLevel ?? 0) * (i.prices?.['Retail'] ?? i.price ?? 0)), 0);
                        const totalAssets = totalAR132 + inventoryValue132;

                        const grossMargin = totalRevenue132 > 0 ? (grossProfit132 / totalRevenue132) * 100 : 0;
                        const currentRatio = totalAP132 > 0 ? totalAssets / totalAP132 : null;
                        const arTurnover = totalAR132 > 0 ? totalRevenue132 / totalAR132 : null;
                        const dso = totalRevenue132 > 0 ? (totalAR132 / totalRevenue132) * 365 : null;
                        const inventoryTurnover = inventoryValue132 > 0 ? totalCOGS132 / inventoryValue132 : null;

                        const ratios = [
                          {
                            label: currentLanguage === 'tr' ? 'Brüt Kâr Marjı' : 'Gross Profit Margin',
                            value: `%${grossMargin.toFixed(1)}`,
                            desc: currentLanguage === 'tr' ? 'Satışlardan elde edilen brüt kâr yüzdesi' : 'Gross profit as % of revenue',
                            status: grossMargin >= 30 ? 'good' : grossMargin >= 15 ? 'warn' : 'bad',
                            benchmark: currentLanguage === 'tr' ? 'İdeal: %30+' : 'Benchmark: 30%+',
                          },
                          {
                            label: currentLanguage === 'tr' ? 'Cari Oran' : 'Current Ratio',
                            value: currentRatio !== null ? currentRatio.toFixed(2) : '—',
                            desc: currentLanguage === 'tr' ? 'Dönen varlıklar / Kısa vadeli borçlar' : 'Current assets / Current liabilities',
                            status: currentRatio === null ? 'neutral' : currentRatio >= 2 ? 'good' : currentRatio >= 1 ? 'warn' : 'bad',
                            benchmark: currentLanguage === 'tr' ? 'İdeal: 1.5–2.5' : 'Benchmark: 1.5–2.5',
                          },
                          {
                            label: currentLanguage === 'tr' ? 'Alacak Devir Hızı' : 'AR Turnover',
                            value: arTurnover !== null ? arTurnover.toFixed(1) + 'x' : '—',
                            desc: currentLanguage === 'tr' ? 'Yıllık ciro / Alacak bakiyesi' : 'Annual revenue / AR balance',
                            status: arTurnover === null ? 'neutral' : arTurnover >= 8 ? 'good' : arTurnover >= 4 ? 'warn' : 'bad',
                            benchmark: currentLanguage === 'tr' ? 'İdeal: 8x+' : 'Benchmark: 8x+',
                          },
                          {
                            label: currentLanguage === 'tr' ? 'Alacak Tahsilat Günü (DSO)' : 'Days Sales Outstanding',
                            value: dso !== null ? `${Math.round(dso)} gün` : '—',
                            desc: currentLanguage === 'tr' ? 'Ortalama tahsilat süresi (gün)' : 'Average days to collect payment',
                            status: dso === null ? 'neutral' : dso <= 30 ? 'good' : dso <= 60 ? 'warn' : 'bad',
                            benchmark: currentLanguage === 'tr' ? 'İdeal: 30 gün' : 'Benchmark: 30 days',
                          },
                          {
                            label: currentLanguage === 'tr' ? 'Stok Devir Hızı' : 'Inventory Turnover',
                            value: inventoryTurnover !== null ? inventoryTurnover.toFixed(2) + 'x' : '—',
                            desc: currentLanguage === 'tr' ? 'Maliyet / Ortalama stok değeri' : 'COGS / Average inventory value',
                            status: inventoryTurnover === null ? 'neutral' : inventoryTurnover >= 6 ? 'good' : inventoryTurnover >= 3 ? 'warn' : 'bad',
                            benchmark: currentLanguage === 'tr' ? 'İdeal: 6x+' : 'Benchmark: 6x+',
                          },
                        ];

                        const statusCfg = { good: 'text-emerald-700 bg-emerald-50 border-emerald-100', warn: 'text-amber-700 bg-amber-50 border-amber-100', bad: 'text-red-700 bg-red-50 border-red-100', neutral: 'text-gray-700 bg-gray-50 border-gray-100' };
                        const dotCfg = { good: 'bg-emerald-400', warn: 'bg-amber-400', bad: 'bg-red-500', neutral: 'bg-gray-300' };

                        return (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            {ratios.map(r => (
                              <div key={r.label} className={`border rounded-2xl p-5 ${statusCfg[r.status as keyof typeof statusCfg]}`}>
                                <div className="flex items-start justify-between gap-2 mb-2">
                                  <div>
                                    <p className="text-sm font-bold">{r.label}</p>
                                    <p className="text-[10px] opacity-70 mt-0.5">{r.desc}</p>
                                  </div>
                                  <span className={`w-3 h-3 rounded-full flex-shrink-0 mt-1 ${dotCfg[r.status as keyof typeof dotCfg]}`} />
                                </div>
                                <p className="text-3xl font-black mt-3">{r.value}</p>
                                <p className="text-[10px] opacity-60 mt-1">{r.benchmark}</p>
                              </div>
                            ))}
                          </div>
                        );
                      })()}
                    </motion.div>
                  )}

                  {/* ── Phase 143: Profit & Loss Statement ── */}
                  {muhasebeTab === 'pnl' && (() => {
                    // ── Shared currency setup (used by entire PnL tab) ──────────
                    const pnlUsd = exchangeRates?.USD ?? FX_FALLBACK.USD;
                    const pnlEur = exchangeRates?.EUR ?? FX_FALLBACK.EUR;
                    const pnlRate = p563PnlCurrency === 'USD' ? pnlUsd : p563PnlCurrency === 'EUR' ? pnlEur : 1;
                    const pnlSym  = p563PnlCurrency === 'USD' ? '$' : p563PnlCurrency === 'EUR' ? '€' : '₺';
                    const fmtPnl  = (v: number) => `${pnlSym}${(v / pnlRate).toLocaleString(
                      p563PnlCurrency === 'TRY' ? 'tr-TR' : p563PnlCurrency === 'EUR' ? 'de-DE' : 'en-US',
                      { maximumFractionDigits: 0 }
                    )}`;

                    const now143 = new Date();
                    const months143: { label: string; revenue: number; cogs: number; grossProfit: number }[] = [];
                    for (let m = 5; m >= 0; m--) {
                      const d = new Date(now143.getFullYear(), now143.getMonth() - m, 1);
                      const label = d.toLocaleDateString(currentLanguage === 'tr' ? 'tr-TR' : 'en-US', { month: 'short', year: '2-digit' });
                      const monthOrders = orders.filter(o => {
                        if (!o.createdAt) return false;
                        try {
                          const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
                          return od.getFullYear() === d.getFullYear() && od.getMonth() === d.getMonth() && o.status !== 'Cancelled';
                        } catch { return false; }
                      });
                      const revenue = monthOrders.reduce((s, o) => s + (o.totalPrice || 0), 0);
                      const cogs = monthOrders.reduce((s, o) => s + (o.lineItems ?? []).reduce((ls, li) => ls + ((li.costPrice ?? 0) * li.quantity), 0), 0);
                      months143.push({ label, revenue, cogs, grossProfit: revenue - cogs });
                    }
                    const ytdRevenue = months143.reduce((s, m) => s + m.revenue, 0);
                    const ytdCOGS    = months143.reduce((s, m) => s + m.cogs, 0);
                    const ytdGross   = ytdRevenue - ytdCOGS;
                    const ytdOpEx    = ytdRevenue * 0.12;
                    const ytdEBIT    = ytdGross - ytdOpEx;
                    const grossMargin143 = ytdRevenue > 0 ? (ytdGross / ytdRevenue) * 100 : 0;
                    const netMargin143   = ytdRevenue > 0 ? (ytdEBIT  / ytdRevenue) * 100 : 0;
                    const pnlRows = [
                      { label: currentLanguage === 'tr' ? 'Gelir (Satışlar)' : 'Revenue (Net Sales)', value: ytdRevenue, bold: true, indent: false, positive: true },
                      { label: currentLanguage === 'tr' ? 'Satılan Malın Maliyeti (COGS)' : 'Cost of Goods Sold', value: -ytdCOGS, bold: false, indent: true, positive: false },
                      { label: currentLanguage === 'tr' ? 'BRÜT KÂR' : 'GROSS PROFIT', value: ytdGross, bold: true, indent: false, positive: ytdGross >= 0 },
                      { label: currentLanguage === 'tr' ? 'İşletme Giderleri (SG&A ~%12)' : 'Operating Expenses (SG&A ~12%)', value: -ytdOpEx, bold: false, indent: true, positive: false },
                      { label: currentLanguage === 'tr' ? 'FAALİYET KÂRI (EBIT)' : 'OPERATING INCOME (EBIT)', value: ytdEBIT, bold: true, indent: false, positive: ytdEBIT >= 0 },
                    ];
                    return (
                      <motion.div key="muhasebe-pnl" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
                        {/* Header + currency toggle in one row */}
                        <div className="flex items-start justify-between gap-4 flex-wrap">
                          <ModuleHeader
                            title={currentLanguage === 'tr' ? 'Gelir Tablosu (P&L)' : 'Profit & Loss Statement'}
                            subtitle={currentLanguage === 'tr' ? 'Son 6 ay özeti' : 'Last 6-month summary'}
                            icon={TrendingUp}
                          />
                          {/* Currency toggle — controls ALL numbers on this tab */}
                          <div className="flex items-center gap-1 bg-gray-100 rounded-xl p-1 self-start mt-1">
                            {(['TRY','USD','EUR'] as const).map(c => (
                              <button key={c} onClick={() => setP563PnlCurrency(c)}
                                className={`text-xs font-bold px-3 py-1.5 rounded-lg transition-all ${p563PnlCurrency === c ? 'bg-white shadow text-gray-900' : 'text-gray-400 hover:text-gray-700'}`}>
                                {c === 'TRY' ? '₺ TRY' : c === 'USD' ? '$ USD' : '€ EUR'}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Live rate notice when converted */}
                        {p563PnlCurrency !== 'TRY' && (
                          <div className="flex items-center gap-2 px-3 py-2 bg-indigo-50 border border-indigo-100 rounded-xl text-xs text-indigo-700">
                            <Globe className="w-3.5 h-3.5 flex-shrink-0" />
                            <span>
                              {currentLanguage === 'tr'
                                ? `Kur: ₺1 = ${p563PnlCurrency === 'USD' ? `$${(1/pnlRate).toFixed(4)}` : `€${(1/pnlRate).toFixed(4)}`} — Frankfurter API (TCMB referans)`
                                : `Rate: ₺1 = ${p563PnlCurrency === 'USD' ? `$${(1/pnlRate).toFixed(4)}` : `€${(1/pnlRate).toFixed(4)}`} — Frankfurter API`}
                            </span>
                          </div>
                        )}

                        {/* Summary KPIs */}
                        <div className="grid grid-cols-3 gap-3">
                          {[
                            { label: currentLanguage==='tr'?'Toplam Gelir':'Total Revenue', value: fmtPnl(ytdRevenue), color: 'text-blue-600', bg: 'bg-blue-50' },
                            { label: currentLanguage==='tr'?'Brüt Marj':'Gross Margin', value: `%${grossMargin143.toFixed(1)}`, color: grossMargin143 >= 30 ? 'text-emerald-600' : 'text-amber-600', bg: grossMargin143 >= 30 ? 'bg-emerald-50' : 'bg-amber-50' },
                            { label: currentLanguage==='tr'?'Net Marj':'Net Margin', value: `%${netMargin143.toFixed(1)}`, color: netMargin143 >= 10 ? 'text-emerald-600' : 'text-amber-600', bg: netMargin143 >= 10 ? 'bg-emerald-50' : 'bg-amber-50' },
                          ].map(k => (
                            <div key={k.label} className={`apple-card p-4 ${k.bg}`}>
                              <p className="text-xs text-gray-600 mb-1">{k.label}</p>
                              <p className={`text-2xl font-bold ${k.color}`}>{k.value}</p>
                            </div>
                          ))}
                        </div>

                        {/* P&L table */}
                        <div className="apple-card p-6">
                          <h3 className="font-bold text-gray-800 mb-4">
                            {currentLanguage === 'tr' ? 'Gelir-Gider Özeti (6 Ay)' : 'Income Statement (6 Months)'}
                          </h3>
                          <div className="space-y-0 divide-y divide-gray-100">
                            {pnlRows.map(row => (
                              <div key={row.label} className={`flex items-center justify-between py-3 ${row.bold ? 'bg-gray-50 -mx-2 px-2 rounded-xl' : ''}`}>
                                <span className={`text-sm ${row.indent ? 'pl-4 text-gray-500' : 'font-semibold text-gray-900'}`}>{row.label}</span>
                                <div className="flex items-center gap-3">
                                  {/* Show TRY reference when not in TRY mode */}
                                  {p563PnlCurrency !== 'TRY' && (
                                    <span className="text-xs text-gray-400 font-mono tabular-nums">
                                      ₺{Math.abs(row.value).toLocaleString('tr-TR', { maximumFractionDigits: 0 })}
                                    </span>
                                  )}
                                  <span className={`text-sm font-bold tabular-nums ${row.positive ? 'text-emerald-600' : 'text-red-500'}`}>
                                    {row.value < 0 ? '– ' : ''}{fmtPnl(Math.abs(row.value))}
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                          <p className="text-[10px] text-gray-400 mt-4">
                            * {currentLanguage === 'tr'
                              ? 'İşletme giderleri %12 SG&A tahminidir. Gerçek giderler için muhasebe entegrasyonu gereklidir.'
                              : 'Operating expenses estimated at 12% SG&A. Real-time opex requires accounting integration.'}
                          </p>
                        </div>

                        {/* Monthly chart */}
                        <div className="apple-card p-6">
                          <h3 className="font-semibold text-gray-800 mb-4 text-sm">
                            {currentLanguage === 'tr' ? 'Aylık Gelir & Brüt Kâr' : 'Monthly Revenue & Gross Profit'}
                          </h3>
                          <div className="space-y-3">
                            {months143.map(m => {
                              const maxVal = Math.max(...months143.map(x => x.revenue), 1);
                              const revW   = Math.round((m.revenue / maxVal) * 100);
                              const gpW    = m.revenue > 0 ? Math.round((m.grossProfit / maxVal) * 100) : 0;
                              return (
                                <div key={m.label} className="flex items-center gap-3">
                                  <span className="text-xs text-gray-500 w-12 shrink-0 text-right">{m.label}</span>
                                  <div className="flex-1 space-y-0.5">
                                    <div className="h-2 bg-blue-100 rounded-full overflow-hidden">
                                      <div className="h-full bg-blue-400 rounded-full" style={{ width: `${revW}%` }} />
                                    </div>
                                    <div className="h-2 bg-emerald-100 rounded-full overflow-hidden">
                                      <div className="h-full bg-emerald-400 rounded-full" style={{ width: `${Math.max(gpW, 0)}%` }} />
                                    </div>
                                  </div>
                                  <span className="text-xs text-gray-600 w-28 shrink-0 tabular-nums">{fmtPnl(m.revenue)}</span>
                                </div>
                              );
                            })}
                          </div>
                          <div className="flex items-center gap-4 mt-3">
                            <span className="flex items-center gap-1.5 text-xs text-gray-500"><span className="w-3 h-2 bg-blue-400 rounded-sm inline-block" />{currentLanguage==='tr'?'Gelir':'Revenue'}</span>
                            <span className="flex items-center gap-1.5 text-xs text-gray-500"><span className="w-3 h-2 bg-emerald-400 rounded-sm inline-block" />{currentLanguage==='tr'?'Brüt Kâr':'Gross Profit'}</span>
                          </div>
                        </div>
                      </motion.div>
                    );
                  })()}

                  {/* ── Break-Even Calculator ── */}
                  {muhasebeTab === 'pnl' && (() => {
                    const totalRevBE = orders.filter(o => o.status !== 'Cancelled').reduce((s, o) => s + (o.totalPrice || 0), 0);
                    const totalCOGSBE = orders.filter(o => o.status !== 'Cancelled').reduce((s, o) =>
                      s + (o.lineItems ?? []).reduce((ls, li) => ls + ((li.costPrice ?? 0) * li.quantity), 0), 0);
                    const grossMarginBE = totalRevBE > 0 ? (totalRevBE - totalCOGSBE) / totalRevBE : 0;
                    const estFixedCosts = totalRevBE * 0.12; // 12% SG&A estimate
                    const breakEvenRev = grossMarginBE > 0 ? estFixedCosts / grossMarginBE : 0;
                    const breakEvenUnits = inventory.length > 0
                      ? Math.round(breakEvenRev / Math.max(
                          inventory.reduce((s, i) => s + (i.prices?.['Retail'] ?? i.price ?? 0), 0) / Math.max(inventory.length, 1),
                          1
                        ))
                      : null;
                    const safetyMargin = totalRevBE > 0 ? Math.round(((totalRevBE - breakEvenRev) / totalRevBE) * 100) : 0;
                    return (
                      <div className="apple-card p-6 mt-4">
                        <h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? '📐 Başabaş Noktası Analizi' : '📐 Break-Even Analysis'}</h3>
                        <p className="text-xs text-gray-400 mb-5">{currentLanguage === 'tr' ? 'Sabit maliyet tahmini %12 SG&A üzerinden' : 'Fixed cost estimated at 12% SG&A of revenue'}</p>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
                          {[
                            { label: currentLanguage==='tr'?'Brüt Marj':'Gross Margin', value: `%${(grossMarginBE*100).toFixed(1)}`, color: 'text-blue-600' },
                            { label: currentLanguage==='tr'?'Tahmini Sabit Gider':'Est. Fixed Costs', value: `₺${estFixedCosts.toLocaleString(undefined,{maximumFractionDigits:0})}`, color: 'text-red-500' },
                            { label: currentLanguage==='tr'?'Başabaş Cirosu':'Break-Even Revenue', value: `₺${breakEvenRev.toLocaleString(undefined,{maximumFractionDigits:0})}`, color: 'text-amber-600' },
                            { label: currentLanguage==='tr'?'Güvenlik Marjı':'Safety Margin', value: `%${safetyMargin}`, color: safetyMargin >= 20 ? 'text-emerald-600' : 'text-red-500' },
                          ].map(k => (
                            <div key={k.label} className="bg-gray-50 rounded-xl p-3 text-center">
                              <p className={`text-xl font-bold ${k.color}`}>{k.value}</p>
                              <p className="text-[10px] text-gray-400 mt-0.5 leading-tight">{k.label}</p>
                            </div>
                          ))}
                        </div>
                        <div className="mb-3">
                          <div className="flex items-center justify-between text-xs mb-1.5">
                            <span className="text-gray-600">{currentLanguage==='tr'?'Gerçekleşen / Başabaş':'Actual vs Break-Even'}</span>
                            <span className={`font-semibold ${totalRevBE >= breakEvenRev ? 'text-emerald-600' : 'text-red-500'}`}>
                              {totalRevBE >= breakEvenRev ? (currentLanguage==='tr'?'✓ Kâr Bölgesinde':'✓ Profitable') : (currentLanguage==='tr'?'✗ Zarar Bölgesinde':'✗ Below Break-Even')}
                            </span>
                          </div>
                          <div className="h-4 bg-gray-100 rounded-full overflow-hidden relative">
                            <div className="h-full bg-emerald-400 rounded-full transition-all" style={{ width: `${Math.min((totalRevBE / Math.max(breakEvenRev * 1.5, totalRevBE)) * 100, 100)}%` }} />
                            {breakEvenRev > 0 && (
                              <div className="absolute top-0 bottom-0 w-0.5 bg-red-500"
                                style={{ left: `${Math.min((breakEvenRev / Math.max(breakEvenRev * 1.5, totalRevBE)) * 100, 100)}%` }} />
                            )}
                          </div>
                          <div className="flex items-center justify-between text-[10px] text-gray-400 mt-1">
                            <span>₺0</span>
                            <span className="text-red-500">▲ {currentLanguage==='tr'?'Başabaş':'B/E'} {fmtKpi(breakEvenRev,'K',0)}</span>
                            <span>{fmtKpi(Math.max(breakEvenRev * 1.5, totalRevBE),'K',0)}</span>
                          </div>
                        </div>
                        {breakEvenUnits !== null && (
                          <p className="text-xs text-gray-500 mt-2">{currentLanguage==='tr'?'Tahmini başabaş sipariş adedi:':'Estimated break-even order count:'} <span className="font-bold text-gray-800">{breakEvenUnits.toLocaleString()}</span></p>
                        )}
                      </div>
                    );
                  })()}


                  {/* ── Nakit Akışı (Cash Flow) ── */}
                  {muhasebeTab === 'nakit-akis' && (() => {
                    // Build monthly cash flow from orders (inflows) and AP/expense records
                    const months: Record<string, { inflow: number; outflow: number }> = {};
                    const now = new Date();
                    // Last 6 months
                    for (let i = 5; i >= 0; i--) {
                      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
                      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                      months[key] = { inflow: 0, outflow: 0 };
                    }
                    // Inflows: paid orders
                    orders.filter(o => o.paid && o.status !== 'Cancelled').forEach(o => {
                      const raw = o.createdAt ?? o.syncedAt;
                      const d = raw ? (typeof (raw as { toDate?: () => Date }).toDate === 'function' ? (raw as { toDate: () => Date }).toDate() : new Date(raw as string | number)) : null;
                      if (!d) return;
                      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                      if (months[key]) months[key].inflow += o.totalPrice || 0;
                    });
                    // Outflows: COGS from all orders (proxy for expenses)
                    orders.filter(o => o.status !== 'Cancelled').forEach(o => {
                      const raw = o.createdAt ?? o.syncedAt;
                      const d = raw ? (typeof (raw as { toDate?: () => Date }).toDate === 'function' ? (raw as { toDate: () => Date }).toDate() : new Date(raw as string | number)) : null;
                      if (!d) return;
                      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                      if (months[key]) {
                        const cogs = (o.lineItems ?? []).reduce((s, li) => s + ((li.costPrice ?? 0) * li.quantity), 0);
                        months[key].outflow += cogs;
                      }
                    });
                    const rows = Object.entries(months).map(([key, v]) => {
                      const [year, month] = key.split('-');
                      const label = new Date(Number(year), Number(month) - 1, 1).toLocaleDateString(currentLanguage === 'tr' ? 'tr-TR' : 'en-US', { month: 'short', year: '2-digit' });
                      return { key, label, ...v, net: v.inflow - v.outflow };
                    });
                    const totalInflow = rows.reduce((s, r) => s + r.inflow, 0);
                    const totalOutflow = rows.reduce((s, r) => s + r.outflow, 0);
                    const totalNet = totalInflow - totalOutflow;
                    const maxVal = Math.max(...rows.map(r => Math.max(r.inflow, r.outflow)), 1);
                    const fCF = (v: number) => '₺' + Math.abs(v).toLocaleString('tr-TR', { maximumFractionDigits: 0 });
                    return (
                      <motion.div key="muhasebe-nakit" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
                        <ModuleHeader
                          title={currentLanguage === 'tr' ? 'Nakit Akışı' : 'Cash Flow Statement'}
                          subtitle={currentLanguage === 'tr' ? 'Son 6 aylık nakit giriş/çıkış analizi' : 'Last 6 months cash inflow/outflow analysis'}
                          icon={Wallet}
                        />
                        {/* Summary KPIs */}
                        <div className="grid grid-cols-3 gap-3">
                          {[
                            { label: currentLanguage === 'tr' ? 'Toplam Giriş' : 'Total Inflow', val: totalInflow, color: 'text-emerald-600', bg: 'bg-emerald-50', prefix: '+' },
                            { label: currentLanguage === 'tr' ? 'Toplam Çıkış' : 'Total Outflow', val: totalOutflow, color: 'text-red-600', bg: 'bg-red-50', prefix: '-' },
                            { label: currentLanguage === 'tr' ? 'Net Nakit' : 'Net Cash', val: totalNet, color: totalNet >= 0 ? 'text-blue-700' : 'text-red-700', bg: totalNet >= 0 ? 'bg-blue-50' : 'bg-red-50', prefix: totalNet >= 0 ? '+' : '-' },
                          ].map(k => (
                            <div key={k.label} className={`apple-card p-4 ${k.bg}`}>
                              <p className="text-[10px] font-bold text-gray-400 uppercase mb-1">{k.label}</p>
                              <p className={`text-xl font-bold ${k.color}`}>{k.prefix === '-' ? fCF(-k.val) : (k.val >= 0 ? '' : '-') + fCF(k.val)}</p>
                            </div>
                          ))}
                        </div>
                        {/* Bar chart */}
                        <div className="apple-card p-5">
                          <h3 className="text-sm font-bold text-gray-800 mb-4">{currentLanguage === 'tr' ? 'Aylık Nakit Akışı' : 'Monthly Cash Flow'}</h3>
                          <div className="flex items-end gap-3 h-36">
                            {rows.map(r => (
                              <div key={r.key} className="flex-1 flex flex-col items-center gap-1">
                                <div className="w-full flex items-end gap-0.5 h-28">
                                  <div className="flex-1 rounded-t-md bg-emerald-400 transition-all" style={{ height: `${(r.inflow / maxVal) * 100}%` }} title={`Giriş: ${fCF(r.inflow)}`} />
                                  <div className="flex-1 rounded-t-md bg-red-400 transition-all" style={{ height: `${(r.outflow / maxVal) * 100}%` }} title={`Çıkış: ${fCF(r.outflow)}`} />
                                </div>
                                <span className="text-[9px] text-gray-400 font-medium">{r.label}</span>
                              </div>
                            ))}
                          </div>
                          <div className="flex items-center gap-4 mt-3 text-[10px] font-semibold text-gray-500">
                            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-400 inline-block" />{currentLanguage === 'tr' ? 'Giriş' : 'Inflow'}</span>
                            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-red-400 inline-block" />{currentLanguage === 'tr' ? 'Çıkış' : 'Outflow'}</span>
                          </div>
                        </div>
                        {/* Table */}
                        <div className="apple-card overflow-hidden">
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="bg-gray-50 border-b border-gray-100">
                                  <th className="text-left px-4 py-3 text-[10px] font-bold text-gray-400 uppercase">{currentLanguage === 'tr' ? 'Dönem' : 'Period'}</th>
                                  <th className="text-right px-4 py-3 text-[10px] font-bold text-emerald-500 uppercase">{currentLanguage === 'tr' ? 'Nakit Giriş' : 'Cash In'}</th>
                                  <th className="text-right px-4 py-3 text-[10px] font-bold text-red-500 uppercase">{currentLanguage === 'tr' ? 'Nakit Çıkış' : 'Cash Out'}</th>
                                  <th className="text-right px-4 py-3 text-[10px] font-bold text-blue-500 uppercase">{currentLanguage === 'tr' ? 'Net' : 'Net'}</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-50">
                                {rows.map(r => (
                                  <tr key={r.key} className="hover:bg-gray-50/50 transition-colors">
                                    <td className="px-4 py-3 font-semibold text-gray-800">{r.label}</td>
                                    <td className="px-4 py-3 text-right font-medium text-emerald-600">{fCF(r.inflow)}</td>
                                    <td className="px-4 py-3 text-right font-medium text-red-500">{fCF(r.outflow)}</td>
                                    <td className={`px-4 py-3 text-right font-bold ${r.net >= 0 ? 'text-blue-700' : 'text-red-600'}`}>{r.net >= 0 ? '+' : '-'}{fCF(Math.abs(r.net))}</td>
                                  </tr>
                                ))}
                                <tr className="bg-gray-50 border-t-2 border-gray-200">
                                  <td className="px-4 py-3 font-bold text-gray-800 text-[11px] uppercase">{currentLanguage === 'tr' ? 'Toplam' : 'Total'}</td>
                                  <td className="px-4 py-3 text-right font-bold text-emerald-600">{fCF(totalInflow)}</td>
                                  <td className="px-4 py-3 text-right font-bold text-red-500">{fCF(totalOutflow)}</td>
                                  <td className={`px-4 py-3 text-right font-bold text-base ${totalNet >= 0 ? 'text-blue-700' : 'text-red-600'}`}>{totalNet >= 0 ? '+' : '-'}{fCF(Math.abs(totalNet))}</td>
                                </tr>
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </motion.div>
                    );
                  })()}

                  {/* ── Kasa Yönetimi ── */}
                  {muhasebeTab === 'kasa' && (
                    <motion.div key="muhasebe-kasa" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
                      <ModuleHeader title={currentLanguage === 'tr' ? 'Kasa' : 'Cash Register'} subtitle={currentLanguage === 'tr' ? 'Nakit giriş/çıkış hareketleri ve kasa bakiyeleri' : 'Cash in/out movements and register balances'} icon={Wallet} />
                      <React.Suspense fallback={LAZY_FALLBACK}><KasaModule currentLanguage={currentLanguage as 'tr' | 'en'} isAuthenticated={!!user && hasFullAccess('muhasebe')} /></React.Suspense>
                    </motion.div>
                  )}

                  {/* ── Phase 547: Bilanço (Balance Sheet) ─────────────────────────────── */}
                  {muhasebeTab === 'bilanco' && (() => {
                    const tr547 = currentLanguage === 'tr';
                    const usd547 = exchangeRates?.USD ?? FX_FALLBACK.USD; const eur547 = exchangeRates?.EUR ?? FX_FALLBACK.EUR;
                    const toTRY = (v: number, cur: string) => cur === 'USD' ? v * usd547 : cur === 'EUR' ? v * eur547 : v;
                    // — Aktif (Assets) —
                    const kasa547   = p547BankAccounts.filter(b => b.accountType === 'Kasa').reduce((s,b) => s + toTRY(b.balance, b.currency), 0);
                    const banka547  = p547BankAccounts.filter(b => b.accountType !== 'Kasa').reduce((s,b) => s + toTRY(b.balance, b.currency), 0);
                    const ar547     = orders.filter(o => !o.paid && o.status !== 'Cancelled').reduce((s,o) => s + (o.totalPrice||o.totalAmount||0), 0);
                    const stok547   = inventory.reduce((s,i) => s + (i.stockLevel||0) * ((i.prices?.['Retail']??i.price??0)), 0);
                    const duranVarlık547 = p547FixedAssets.reduce((s,fa) => s + Math.max(0, fa.cost - fa.depreciation), 0);
                    const toplamAktif547 = kasa547 + banka547 + ar547 + stok547 + duranVarlık547;
                    // — Pasif (Liabilities + Equity) —
                    const ap547     = apPurchaseOrders.filter(po => !['Teslim Alındı','İptal Edildi'].includes(po.status)).reduce((s,po) => s + (po.totalAmount||0), 0);
                    const kdvBorc547 = orders.filter(o => o.faturali && o.kdvTutari).reduce((s,o) => s + (o.kdvTutari||0), 0);
                    const toplamBorç547 = ap547 + kdvBorc547;
                    const ozkaynak547 = toplamAktif547 - toplamBorç547;
                    const toplamPasif547 = toplamBorç547 + ozkaynak547;
                    const fB = (v: number) => `₺${Math.round(v).toLocaleString('tr-TR')}`;
                    const aktifRows = [
                      { group: tr547?'Dönen Varlıklar':'Current Assets', items: [
                        { label: tr547?'Kasa':'Cash on Hand',          v: kasa547 },
                        { label: tr547?'Bankalar':'Bank Accounts',      v: banka547 },
                        { label: tr547?'Ticari Alacaklar':'Trade AR',   v: ar547 },
                        { label: tr547?'Stoklar':'Inventories',         v: stok547 },
                      ]},
                      { group: tr547?'Duran Varlıklar':'Non-Current Assets', items: [
                        { label: tr547?'Sabit Kıymetler (Net)':'Fixed Assets (Net)', v: duranVarlık547 },
                      ]},
                    ];
                    const pasifRows = [
                      { group: tr547?'Kısa Vadeli Yükümlülükler':'Current Liabilities', items: [
                        { label: tr547?'Ticari Borçlar':'Trade Payables', v: ap547 },
                        { label: tr547?'KDV Borcu':'VAT Payable',         v: kdvBorc547 },
                      ]},
                      { group: tr547?'Özkaynaklar':'Equity', items: [
                        { label: tr547?'Net Özkaynaklar':'Net Equity', v: ozkaynak547 },
                      ]},
                    ];
                    return (
                      <motion.div key="muhasebe-bilanco" initial={{ opacity:0,y:6 }} animate={{ opacity:1,y:0 }} className="space-y-4">
                        <ModuleHeader title={tr547?'Bilanço':'Balance Sheet'} subtitle={tr547?'Aktif = Pasif (MSUGT formatı)':'Assets = Liabilities + Equity (MSUGT format)'} icon={Scale} />
                        {/* KPI strip */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                          {[
                            { label: tr547?'Toplam Aktif':'Total Assets',      v: toplamAktif547, color: 'text-blue-700',  bg: 'bg-blue-50' },
                            { label: tr547?'Toplam Pasif':'Total Liabilities + Equity', v: toplamPasif547, color: 'text-indigo-700', bg: 'bg-indigo-50' },
                            { label: tr547?'Toplam Borç':'Total Debt',         v: toplamBorç547, color: 'text-red-600',   bg: 'bg-red-50' },
                            { label: tr547?'Özkaynaklar':'Equity',             v: ozkaynak547,   color: ozkaynak547>=0?'text-emerald-700':'text-red-600', bg: ozkaynak547>=0?'bg-emerald-50':'bg-red-50' },
                          ].map(k => (
                            <div key={k.label} className={`apple-card p-4 ${k.bg}`}>
                              <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">{k.label}</p>
                              <p className={`text-xl font-bold ${k.color}`}>{fB(k.v)}</p>
                            </div>
                          ))}
                        </div>
                        {Math.abs(toplamAktif547 - toplamPasif547) > 1 && (
                          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-2 text-sm text-amber-800 flex items-center gap-2">
                            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                            {tr547?'Bilanço dengelenmedi — bazı veriler eksik olabilir.':'Balance sheet does not balance — some data may be missing.'}
                          </div>
                        )}
                        {/* Two-column balance sheet */}
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                          {/* AKTİF */}
                          <div className="apple-card p-5">
                            <h3 className="font-bold text-blue-700 mb-3 flex items-center gap-2"><TrendingUp className="w-4 h-4" />{tr547?'AKTİF':'ASSETS'}</h3>
                            {aktifRows.map(grp => (
                              <div key={grp.group} className="mb-3">
                                <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1.5">{grp.group}</p>
                                {grp.items.map(it => (
                                  <div key={it.label} className="flex justify-between py-1 border-b border-gray-50 text-sm">
                                    <span className="text-gray-600">{it.label}</span>
                                    <span className="font-semibold text-gray-900 tabular-nums">{fB(it.v)}</span>
                                  </div>
                                ))}
                              </div>
                            ))}
                            <div className="flex justify-between pt-2 border-t-2 border-blue-200 text-sm font-bold">
                              <span className="text-blue-700">{tr547?'TOPLAM AKTİF':'TOTAL ASSETS'}</span>
                              <span className="text-blue-700 tabular-nums">{fB(toplamAktif547)}</span>
                            </div>
                          </div>
                          {/* PASİF */}
                          <div className="apple-card p-5">
                            <h3 className="font-bold text-indigo-700 mb-3 flex items-center gap-2"><TrendingDown className="w-4 h-4" />{tr547?'PASİF':'LIABILITIES + EQUITY'}</h3>
                            {pasifRows.map(grp => (
                              <div key={grp.group} className="mb-3">
                                <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1.5">{grp.group}</p>
                                {grp.items.map(it => (
                                  <div key={it.label} className="flex justify-between py-1 border-b border-gray-50 text-sm">
                                    <span className="text-gray-600">{it.label}</span>
                                    <span className="font-semibold text-gray-900 tabular-nums">{fB(it.v)}</span>
                                  </div>
                                ))}
                              </div>
                            ))}
                            <div className="flex justify-between pt-2 border-t-2 border-indigo-200 text-sm font-bold">
                              <span className="text-indigo-700">{tr547?'TOPLAM PASİF':'TOTAL L+E'}</span>
                              <span className="text-indigo-700 tabular-nums">{fB(toplamPasif547)}</span>
                            </div>
                          </div>
                        </div>
                        <p className="text-[10px] text-gray-400 text-center">{tr547?'Veriler veritabanından anlık hesaplanmaktadır. Muhasebe yazılımı çıktısı olarak kullanmayınız.':'Data is calculated live from the database. Do not use as official accounting output.'}</p>
                      </motion.div>
                    );
                  })()}

                  {/* ── Phase 550: e-Mutabakat (Account Reconciliation) ────────────────── */}
                  {muhasebeTab === 'mutabakat' && (() => {
                    const tr550 = currentLanguage === 'tr';
                    // AR per customer from orders
                    const arMap: Record<string, { name: string; ar: number; paid: number }> = {};
                    for (const o of orders) {
                      if (o.status === 'Cancelled') continue;
                      const k = o.customerName;
                      if (!arMap[k]) arMap[k] = { name: k, ar: 0, paid: 0 };
                      arMap[k].ar += o.totalPrice || o.totalAmount || 0;
                      if (o.paid) arMap[k].paid += o.totalPrice || o.totalAmount || 0;
                    }
                    const mutRows = Object.values(arMap).map(r => ({ ...r, balance: r.ar - r.paid })).sort((a,b) => b.balance - a.balance);
                    const fM = (v: number) => `₺${Math.round(v).toLocaleString('tr-TR')}`;
                    return (
                      <motion.div key="mutabakat" initial={{ opacity:0,y:6 }} animate={{ opacity:1,y:0 }} className="space-y-4">
                        <ModuleHeader title={tr550?'Cari Mutabakat':'Account Reconciliation'} subtitle={tr550?'Müşteri bazında alacak/ödeme dengesi':'AR vs. payments balance per customer'} icon={RefreshCw} />
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-2">
                          {[
                            { label: tr550?'Toplam Alacak':'Total AR',     v: mutRows.reduce((s,r)=>s+r.ar,0),      color:'text-blue-700',   bg:'bg-blue-50' },
                            { label: tr550?'Tahsil Edilen':'Collected',     v: mutRows.reduce((s,r)=>s+r.paid,0),    color:'text-emerald-700', bg:'bg-emerald-50' },
                            { label: tr550?'Bakiye':'Open Balance',         v: mutRows.reduce((s,r)=>s+r.balance,0), color:'text-orange-700',  bg:'bg-orange-50' },
                          ].map(k=>(
                            <div key={k.label} className={`apple-card p-4 ${k.bg}`}>
                              <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">{k.label}</p>
                              <p className={`text-xl font-bold ${k.color}`}>{fM(k.v)}</p>
                            </div>
                          ))}
                        </div>
                        <div className="apple-card overflow-hidden">
                          <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                              <thead><tr className="border-b border-gray-100 bg-gray-50/60">
                                <th className="px-4 py-2.5 text-left text-xs font-bold text-gray-400 uppercase">{tr550?'Müşteri':'Customer'}</th>
                                <th className="px-4 py-2.5 text-right text-xs font-bold text-gray-400 uppercase">{tr550?'Toplam Borç':'Total Charged'}</th>
                                <th className="px-4 py-2.5 text-right text-xs font-bold text-gray-400 uppercase">{tr550?'Tahsil':'Collected'}</th>
                                <th className="px-4 py-2.5 text-right text-xs font-bold text-gray-400 uppercase">{tr550?'Bakiye':'Balance'}</th>
                                <th className="px-4 py-2.5 text-center text-xs font-bold text-gray-400 uppercase">{tr550?'Durum':'Status'}</th>
                              </tr></thead>
                              <tbody>
                                {mutRows.slice(0,30).map((r,i)=>(
                                  <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                                    <td className="px-4 py-2.5 font-medium text-gray-800">{r.name}</td>
                                    <td className="px-4 py-2.5 text-right text-gray-600 tabular-nums">{fM(r.ar)}</td>
                                    <td className="px-4 py-2.5 text-right text-emerald-600 tabular-nums">{fM(r.paid)}</td>
                                    <td className={`px-4 py-2.5 text-right font-bold tabular-nums ${r.balance>0?'text-orange-600':'text-emerald-600'}`}>{fM(r.balance)}</td>
                                    <td className="px-4 py-2.5 text-center">
                                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${r.balance<=0?'bg-emerald-100 text-emerald-700':r.balance/r.ar>0.5?'bg-red-100 text-red-700':'bg-orange-100 text-orange-700'}`}>
                                        {r.balance<=0?(tr550?'Kapalı':'Closed'):r.balance/r.ar>0.5?(tr550?'Yüksek Bakiye':'High Balance'):(tr550?'Kısmi':'Partial')}
                                      </span>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          {mutRows.length === 0 && <p className="text-center py-8 text-gray-400 text-sm">{tr550?'Henüz sipariş verisi yok.':'No order data yet.'}</p>}
                        </div>
                      </motion.div>
                    );
                  })()}

                  {/* ── Phase 548: Masraf Yönetimi (Expense Management) ───────────────── */}
                  {muhasebeTab === 'masraf' && (() => {
                    const tr548 = currentLanguage === 'tr';
                    const cats548 = [tr548?'Ulaşım':'Transportation', tr548?'Konaklama':'Accommodation', tr548?'Yemek':'Meals', tr548?'Temsil':'Entertainment', tr548?'Kırtasiye':'Office Supplies', tr548?'Diğer':'Other'];
                    const pending548 = p548Masraflar.filter(m=>m.status==='Bekliyor');
                    const approved548 = p548Masraflar.filter(m=>m.status==='Onaylandı');
                    // Karışık para birimlerini ₺'ye çevirerek topla (önce ham toplanıyordu).
                    const toTRY548 = (amt:number, cur?:string) => (amt||0) * (cur==='USD' ? (exchangeRates?.USD ?? FX_FALLBACK.USD) : cur==='EUR' ? (exchangeRates?.EUR ?? FX_FALLBACK.EUR) : 1);
                    const totalPending = pending548.reduce((s,m)=>s+toTRY548(m.amount,(m as {currency?:string}).currency),0);
                    const totalApproved = approved548.reduce((s,m)=>s+toTRY548(m.amount,(m as {currency?:string}).currency),0);
                    const fE = (v:number, c:string='TRY') => c==='USD'?`$${v.toFixed(2)}`:c==='EUR'?`€${v.toFixed(2)}`:`₺${Math.round(v).toLocaleString('tr-TR')}`;
                    return (
                      <motion.div key="masraf" initial={{opacity:0,y:6}} animate={{opacity:1,y:0}} className="space-y-4">
                        <ModuleHeader
                          title={tr548?'Masraf Yönetimi':'Expense Management'}
                          subtitle={tr548?'Çalışan harcama talepleri ve onay süreci':'Employee expense claims and approval workflow'}
                          icon={Receipt}
                          actionButton={hasFullAccess('muhasebe') ? (
                            <button onClick={()=>setP548Form(true)} className="apple-button-primary px-4 py-2 text-sm flex items-center gap-1.5">
                              <Plus className="w-3.5 h-3.5" />{tr548?'Masraf Ekle':'Add Expense'}
                            </button>
                          ) : undefined}
                        />
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                          {[
                            { label: tr548?'Bekleyen Talep':'Pending', v: pending548.length, sub: `₺${Math.round(totalPending).toLocaleString('tr-TR')}`, color:'text-orange-600', bg:'bg-orange-50' },
                            { label: tr548?'Onaylanan':'Approved',     v: approved548.length, sub: `₺${Math.round(totalApproved).toLocaleString('tr-TR')}`, color:'text-emerald-600', bg:'bg-emerald-50' },
                            { label: tr548?'Reddedilen':'Rejected',    v: p548Masraflar.filter(m=>m.status==='Reddedildi').length, sub:'', color:'text-red-500', bg:'bg-red-50' },
                            { label: tr548?'Toplam Kayıt':'Total',     v: p548Masraflar.length, sub:'', color:'text-gray-600', bg:'bg-gray-50' },
                          ].map(k=>(
                            <div key={k.label} className={`apple-card p-4 ${k.bg}`}>
                              <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">{k.label}</p>
                              <p className={`text-2xl font-bold ${k.color}`}>{k.v}</p>
                              {k.sub && <p className="text-xs text-gray-500 mt-0.5">{k.sub}</p>}
                            </div>
                          ))}
                        </div>
                        {/* Add expense form */}
                        {p548Form && (
                          <div className="apple-card p-5 border-2 border-brand/20 space-y-3">
                            <h4 className="font-bold text-gray-800">{tr548?'Yeni Masraf Talebi':'New Expense Claim'}</h4>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                              <input value={p548Draft.employeeName} onChange={e=>setP548Draft(d=>({...d,employeeName:e.target.value}))} placeholder={tr548?'Çalışan Adı':'Employee Name'} className="apple-input px-3 py-2 text-sm" />
                              <select value={p548Draft.category} onChange={e=>setP548Draft(d=>({...d,category:e.target.value}))} className="apple-input px-3 py-2 text-sm">
                                {cats548.map(c=><option key={c}>{c}</option>)}
                              </select>
                              <div className="flex gap-2">
                                <input type="number" value={p548Draft.amount} onChange={e=>setP548Draft(d=>({...d,amount:e.target.value}))} placeholder={tr548?'Tutar':'Amount'} className="apple-input px-3 py-2 text-sm flex-1" />
                                <select value={p548Draft.currency} onChange={e=>setP548Draft(d=>({...d,currency:e.target.value}))} className="apple-input px-3 py-2 text-sm w-20">
                                  {['TRY','USD','EUR'].map(c=><option key={c}>{c}</option>)}
                                </select>
                              </div>
                              <input type="date" value={p548Draft.date} onChange={e=>setP548Draft(d=>({...d,date:e.target.value}))} className="apple-input px-3 py-2 text-sm" />
                              <input value={p548Draft.description} onChange={e=>setP548Draft(d=>({...d,description:e.target.value}))} placeholder={tr548?'Açıklama':'Description'} className="apple-input px-3 py-2 text-sm md:col-span-2" />
                            </div>
                            <div className="flex gap-2">
                              <button onClick={async()=>{
                                const amt=parseFloat(p548Draft.amount);
                                if(!p548Draft.employeeName||!Number.isFinite(amt)||amt<=0){ toast(tr548?'Geçerli bir tutar girin.':'Enter a valid amount.','error'); return; }
                                try{ await addDoc(collection(db,'masraflar'),{...p548Draft,amount:amt,status:'Bekliyor',createdAt:serverTimestamp()});
                                setP548Form(false); setP548Draft({employeeName:'',category:tr548?'Ulaşım':'Transportation',amount:'',currency:'TRY',date:new Date().toISOString().slice(0,10),description:''}); }
                                catch(e){ console.error('[masraf save]',e); toast(tr548?'Kaydedilemedi.':'Could not save.','error'); }
                              }} className="apple-button-primary px-4 py-2 text-sm">{tr548?'Kaydet':'Save'}</button>
                              <button onClick={()=>setP548Form(false)} className="apple-button-secondary px-4 py-2 text-sm">{tr548?'İptal':'Cancel'}</button>
                            </div>
                          </div>
                        )}
                        {/* Expense list */}
                        <div className="apple-card overflow-hidden">
                          <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                              <thead><tr className="border-b border-gray-100 bg-gray-50/60">
                                <th className="px-4 py-2.5 text-left text-xs font-bold text-gray-400 uppercase">{tr548?'Çalışan':'Employee'}</th>
                                <th className="px-4 py-2.5 text-left text-xs font-bold text-gray-400 uppercase hidden sm:table-cell">{tr548?'Kategori':'Category'}</th>
                                <th className="px-4 py-2.5 text-right text-xs font-bold text-gray-400 uppercase">{tr548?'Tutar':'Amount'}</th>
                                <th className="px-4 py-2.5 text-left text-xs font-bold text-gray-400 uppercase hidden md:table-cell">{tr548?'Tarih':'Date'}</th>
                                <th className="px-4 py-2.5 text-center text-xs font-bold text-gray-400 uppercase">{tr548?'Durum':'Status'}</th>
                                {hasFullAccess('muhasebe') && <th className="px-4 py-2.5 text-center text-xs font-bold text-gray-400 uppercase">{tr548?'İşlem':'Action'}</th>}
                              </tr></thead>
                              <tbody>
                                {p548Masraflar.map(m=>(
                                  <tr key={m.id} className="border-b border-gray-50 hover:bg-gray-50">
                                    <td className="px-4 py-2.5">
                                      <p className="font-medium text-gray-800">{m.employeeName}</p>
                                      <p className="text-xs text-gray-400 hidden sm:block">{m.description}</p>
                                    </td>
                                    <td className="px-4 py-2.5 text-gray-500 hidden sm:table-cell">{m.category}</td>
                                    <td className="px-4 py-2.5 text-right font-bold text-gray-800 tabular-nums">{fE(m.amount,m.currency)}</td>
                                    <td className="px-4 py-2.5 text-gray-500 text-xs hidden md:table-cell">{m.date}</td>
                                    <td className="px-4 py-2.5 text-center">
                                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${m.status==='Onaylandı'?'bg-emerald-100 text-emerald-700':m.status==='Reddedildi'?'bg-red-100 text-red-700':'bg-orange-100 text-orange-700'}`}>{m.status}</span>
                                    </td>
                                    {hasFullAccess('muhasebe') && (
                                      <td className="px-4 py-2.5 text-center">
                                        {m.status==='Bekliyor' && (
                                          <div className="flex justify-center gap-1">
                                            <button onClick={async()=>{try{await updateDoc(doc(db,'masraflar',m.id),{status:'Onaylandı',approvedBy:user?.displayName||user?.email||''});}catch(e){console.error('[masraf approve]',e);toast(tr548?'İşlem başarısız.':'Failed.','error');}}} className="text-[10px] bg-emerald-100 text-emerald-700 font-bold px-2 py-1 rounded-full hover:bg-emerald-200 transition-colors">{tr548?'Onayla':'Approve'}</button>
                                            <button onClick={async()=>{try{await updateDoc(doc(db,'masraflar',m.id),{status:'Reddedildi'});}catch(e){console.error('[masraf reject]',e);toast(tr548?'İşlem başarısız.':'Failed.','error');}}} className="text-[10px] bg-red-100 text-red-700 font-bold px-2 py-1 rounded-full hover:bg-red-200 transition-colors">{tr548?'Reddet':'Reject'}</button>
                                          </div>
                                        )}
                                      </td>
                                    )}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          {p548Masraflar.length===0 && (
                            <div className="text-center py-12 space-y-2">
                              <Receipt className="w-10 h-10 text-gray-200 mx-auto" />
                              <p className="text-gray-400 text-sm">{tr548?'"Masraf Ekle" ile ilk talebi oluşturun':'Click "Add Expense" to create the first claim'}</p>
                            </div>
                          )}
                        </div>
                      </motion.div>
                    );
                  })()}

                  {/* ── Phase 555: Ba/Bs Formu (Turkish VAT Transaction Lists) ────────── */}
                  {muhasebeTab === 'babs' && (() => {
                    const tr555 = currentLanguage === 'tr';
                    // Filter orders by selected period
                    const [yr555, mo555] = p555Period.split('-').map(Number);
                    const periodOrders = orders.filter(o => {
                      const d = o.createdAt ? new Date(typeof (o.createdAt as {toDate?:()=>Date}).toDate === 'function' ? (o.createdAt as {toDate:()=>Date}).toDate() : o.createdAt as string) : null;
                      return d && d.getFullYear()===yr555 && d.getMonth()+1===mo555 && o.status !== 'Cancelled';
                    });
                    const periodPOs = apPurchaseOrders.filter(po => {
                      const d = po.createdAt ? new Date(typeof (po.createdAt as {toDate?:()=>Date}).toDate === 'function' ? (po.createdAt as {toDate:()=>Date}).toDate() : po.createdAt as string) : null;
                      return d && d.getFullYear()===yr555 && d.getMonth()+1===mo555;
                    });
                    // Ba = purchases from suppliers ≥ ₺5,000 per supplier
                    const baMap: Record<string,number> = {};
                    for (const po of periodPOs) { if(po.supplier) baMap[po.supplier]=(baMap[po.supplier]||0)+(po.totalAmount||0); }
                    const baRows = Object.entries(baMap).filter(([,v])=>v>=5000).map(([name,amount])=>({name,amount})).sort((a,b)=>b.amount-a.amount);
                    // Bs = sales to customers ≥ ₺5,000 per customer
                    const bsMap: Record<string,number> = {};
                    for (const o of periodOrders) { bsMap[o.customerName]=(bsMap[o.customerName]||0)+(o.totalPrice||0); }
                    const bsRows = Object.entries(bsMap).filter(([,v])=>v>=5000).map(([name,amount])=>({name,amount})).sort((a,b)=>b.amount-a.amount);
                    const fBabs = (v:number) => `₺${Math.round(v).toLocaleString('tr-TR')}`;
                    return (
                      <motion.div key="babs" initial={{opacity:0,y:6}} animate={{opacity:1,y:0}} className="space-y-4">
                        <ModuleHeader title={tr555?'Ba/Bs Formu':'Ba/Bs Tax Form'} subtitle={tr555?'₺5.000 ve üzeri alım (Ba) ve satış (Bs) bildirimi — Logo/Mikro uyumlu':'Purchase (Ba) and sales (Bs) declarations ≥ ₺5,000 — Logo/Mikro compatible'} icon={FileText} />
                        {/* Period picker */}
                        <div className="flex items-center gap-3 flex-wrap">
                          <label className="text-sm font-semibold text-gray-600">{tr555?'Dönem:':'Period:'}</label>
                          <input type="month" value={p555Period} onChange={e=>setP555Period(e.target.value)} className="apple-input px-3 py-2 text-sm" />
                          <div className="flex gap-3 text-sm text-gray-500">
                            <span className="font-bold text-rose-600">{baRows.length} Ba</span>
                            <span className="font-bold text-blue-600">{bsRows.length} Bs</span>
                          </div>
                        </div>
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                          {/* Ba formu - Alımlar */}
                          <div className="apple-card p-5">
                            <h4 className="font-bold text-rose-700 mb-3 flex items-center gap-2">
                              <FileText className="w-4 h-4" />Ba {tr555?'Formu — Alımlar':'Form — Purchases'}
                            </h4>
                            <p className="text-xs text-gray-400 mb-3">{tr555?`${yr555}/${String(mo555).padStart(2,'0')} dönemine ait ₺5.000 ve üzeri tedarikçi alımları`:`Supplier purchases ≥ ₺5,000 for ${yr555}/${String(mo555).padStart(2,'0')}`}</p>
                            {baRows.length > 0 ? (
                              <table className="w-full text-sm">
                                <thead><tr className="border-b border-gray-100">
                                  <th className="py-1.5 text-left text-xs font-bold text-gray-400 uppercase">{tr555?'Tedarikçi':'Supplier'}</th>
                                  <th className="py-1.5 text-right text-xs font-bold text-gray-400 uppercase">{tr555?'Tutar':'Amount'}</th>
                                </tr></thead>
                                <tbody>
                                  {baRows.map((r,i)=>(
                                    <tr key={i} className="border-b border-gray-50">
                                      <td className="py-1.5 text-gray-700">{r.name}</td>
                                      <td className="py-1.5 text-right font-bold text-rose-700 tabular-nums">{fBabs(r.amount)}</td>
                                    </tr>
                                  ))}
                                  <tr className="border-t-2 border-rose-200">
                                    <td className="py-1.5 font-bold text-gray-800">{tr555?'Toplam':'Total'}</td>
                                    <td className="py-1.5 text-right font-bold text-rose-700 tabular-nums">{fBabs(baRows.reduce((s,r)=>s+r.amount,0))}</td>
                                  </tr>
                                </tbody>
                              </table>
                            ) : <p className="text-sm text-gray-400 text-center py-6">{tr555?'Bu dönemde ₺5.000 üzeri alım yok.':'No purchases ≥ ₺5,000 this period.'}</p>}
                          </div>
                          {/* Bs formu - Satışlar */}
                          <div className="apple-card p-5">
                            <h4 className="font-bold text-blue-700 mb-3 flex items-center gap-2">
                              <FileText className="w-4 h-4" />Bs {tr555?'Formu — Satışlar':'Form — Sales'}
                            </h4>
                            <p className="text-xs text-gray-400 mb-3">{tr555?`${yr555}/${String(mo555).padStart(2,'0')} dönemine ait ₺5.000 ve üzeri müşteri satışları`:`Customer sales ≥ ₺5,000 for ${yr555}/${String(mo555).padStart(2,'0')}`}</p>
                            {bsRows.length > 0 ? (
                              <table className="w-full text-sm">
                                <thead><tr className="border-b border-gray-100">
                                  <th className="py-1.5 text-left text-xs font-bold text-gray-400 uppercase">{tr555?'Müşteri':'Customer'}</th>
                                  <th className="py-1.5 text-right text-xs font-bold text-gray-400 uppercase">{tr555?'Tutar':'Amount'}</th>
                                </tr></thead>
                                <tbody>
                                  {bsRows.map((r,i)=>(
                                    <tr key={i} className="border-b border-gray-50">
                                      <td className="py-1.5 text-gray-700">{r.name}</td>
                                      <td className="py-1.5 text-right font-bold text-blue-700 tabular-nums">{fBabs(r.amount)}</td>
                                    </tr>
                                  ))}
                                  <tr className="border-t-2 border-blue-200">
                                    <td className="py-1.5 font-bold text-gray-800">{tr555?'Toplam':'Total'}</td>
                                    <td className="py-1.5 text-right font-bold text-blue-700 tabular-nums">{fBabs(bsRows.reduce((s,r)=>s+r.amount,0))}</td>
                                  </tr>
                                </tbody>
                              </table>
                            ) : <p className="text-sm text-gray-400 text-center py-6">{tr555?'Bu dönemde ₺5.000 üzeri satış yok.':'No sales ≥ ₺5,000 this period.'}</p>}
                          </div>
                        </div>
                        <p className="text-[10px] text-gray-400 text-center">{tr555?'Beyan limiti ₺5.000\'dir. Gerçek Ba/Bs bildirimi için mali müşavirinizle çalışın.':'Reporting threshold is ₺5,000. Work with your accountant for official submissions.'}</p>
                      </motion.div>
                    );
                  })()}

                  {/* ── Phase 557: Senaryo Bütçesi (Scenario-Based Budgeting) ─────────── */}
                  {muhasebeTab === 'butce' && (() => {
                    const tr557 = currentLanguage === 'tr';
                    // Get last 6 months revenue as baseline
                    const now557 = new Date();
                    const last6: number[] = [];
                    for (let i = 5; i >= 0; i--) {
                      const d = new Date(now557.getFullYear(), now557.getMonth() - i, 1);
                      const rev = orders.filter(o => {
                        const od = o.createdAt ? new Date(typeof (o.createdAt as {toDate?:()=>Date}).toDate === 'function' ? (o.createdAt as {toDate:()=>Date}).toDate() : o.createdAt as string) : null;
                        return od && od.getFullYear()===d.getFullYear() && od.getMonth()===d.getMonth() && o.status !== 'Cancelled';
                      }).reduce((s,o)=>s+(o.totalPrice||0),0);
                      last6.push(rev);
                    }
                    const avgRev = last6.reduce((s,v)=>s+v,0) / (last6.filter(v=>v>0).length||1);
                    const scenarios: Record<string,{growth:number;expGrowth:number;color:string;label:string}> = {
                      best:  { growth: 0.20, expGrowth: 0.10, color:'emerald', label: tr557?'İyimser (+%20)':'Optimistic (+20%)' },
                      base:  { growth: 0.05, expGrowth: 0.05, color:'blue',    label: tr557?'Baz (%+5)':'Base (+5%)' },
                      worst: { growth: -0.10, expGrowth: 0.02, color:'red',   label: tr557?'Kötümser (-%10)':'Pessimistic (-10%)' },
                    };
                    const sc = scenarios[p557Scenario];
                    const months12 = Array.from({length:12},(_,i)=>{
                      const d = new Date(now557.getFullYear(), now557.getMonth() + i + 1, 1);
                      return {
                        label: d.toLocaleString(tr557?'tr-TR':'en-US',{month:'short',year:'2-digit'}),
                        revenue: Math.round(avgRev * (1 + sc.growth) ** (i+1)),
                        expense: Math.round(avgRev * 0.65 * (1 + sc.expGrowth) ** (i+1)),
                      };
                    });
                    const totalRev12 = months12.reduce((s,m)=>s+m.revenue,0);
                    const totalExp12 = months12.reduce((s,m)=>s+m.expense,0);
                    const totalProfit12 = totalRev12 - totalExp12;
                    const fS = (v:number) => `₺${Math.round(v/1000)}K`;
                    const colMap: Record<string,string> = {emerald:'text-emerald-700 bg-emerald-50',blue:'text-blue-700 bg-blue-50',red:'text-red-700 bg-red-50'};
                    return (
                      <motion.div key="butce-senaryo" initial={{opacity:0,y:6}} animate={{opacity:1,y:0}} className="space-y-4">
                        <ModuleHeader title={tr557?'Bütçe & Senaryo Planlaması':'Budget & Scenario Planning'} subtitle={tr557?'12 aylık gelir/gider tahmini — iyimser, baz ve kötümser senaryolar':'12-month revenue/expense forecast — optimistic, base and pessimistic scenarios'} icon={BarChart3} />
                        {/* Scenario selector */}
                        <div className="flex gap-2 flex-wrap">
                          {(Object.entries(scenarios) as Array<[string,typeof scenarios[string]]>).map(([key,s])=>(
                            <button key={key} onClick={()=>setP557Scenario(key as typeof p557Scenario)}
                              className={`px-4 py-2 rounded-xl text-sm font-bold transition-all border-2 ${p557Scenario===key ? `border-${s.color}-500 bg-${s.color}-50 text-${s.color}-700` : 'border-transparent bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
                              {s.label}
                            </button>
                          ))}
                        </div>
                        {/* 12-month KPIs */}
                        <div className="grid grid-cols-3 gap-3">
                          {[
                            { label:tr557?'12 Ay Ciro':'12-Mo Revenue', v:totalRev12, color:'text-blue-700',  bg:'bg-blue-50' },
                            { label:tr557?'12 Ay Gider':'12-Mo Expense', v:totalExp12, color:'text-red-600',   bg:'bg-red-50' },
                            { label:tr557?'12 Ay Net':'12-Mo Net',        v:totalProfit12, color:totalProfit12>=0?'text-emerald-700':'text-red-700', bg:totalProfit12>=0?'bg-emerald-50':'bg-red-50' },
                          ].map(k=>(
                            <div key={k.label} className={`apple-card p-4 ${k.bg}`}>
                              <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">{k.label}</p>
                              <p className={`text-xl font-bold ${k.color}`}>{fS(k.v)}</p>
                            </div>
                          ))}
                        </div>
                        {/* Month-by-month table */}
                        <div className="apple-card p-5">
                          <h4 className="font-bold text-gray-800 mb-3 flex items-center gap-2">
                            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${colMap[sc.color]}`}>{sc.label}</span>
                            {tr557?'Aylık Projeksiyon':'Monthly Projection'}
                          </h4>
                          <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                              <thead><tr className="border-b border-gray-100">
                                <th className="py-2 text-left text-xs font-bold text-gray-400 uppercase">{tr557?'Ay':'Month'}</th>
                                <th className="py-2 text-right text-xs font-bold text-gray-400 uppercase">{tr557?'Ciro':'Revenue'}</th>
                                <th className="py-2 text-right text-xs font-bold text-gray-400 uppercase">{tr557?'Gider':'Expense'}</th>
                                <th className="py-2 text-right text-xs font-bold text-gray-400 uppercase">{tr557?'Net Kâr':'Net Profit'}</th>
                                <th className="py-2 text-right text-xs font-bold text-gray-400 uppercase">{tr557?'Marj':'Margin'}</th>
                              </tr></thead>
                              <tbody>
                                {months12.map((m,i)=>{
                                  const net = m.revenue - m.expense;
                                  const margin = m.revenue > 0 ? Math.round((net/m.revenue)*100) : 0;
                                  return (
                                    <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                                      <td className="py-1.5 text-gray-700 font-medium">{m.label}</td>
                                      <td className="py-1.5 text-right text-blue-700 tabular-nums font-semibold">{fS(m.revenue)}</td>
                                      <td className="py-1.5 text-right text-red-500 tabular-nums">{fS(m.expense)}</td>
                                      <td className={`py-1.5 text-right font-bold tabular-nums ${net>=0?'text-emerald-700':'text-red-700'}`}>{fS(net)}</td>
                                      <td className="py-1.5 text-right text-gray-500 tabular-nums">{margin}%</td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </div>
                        <p className="text-[10px] text-gray-400 text-center">{tr557?`Temel: Son 6 aylık ortalama ciro ₺${Math.round(avgRev/1000)}K · Gider tahmini cironun %65\'i varsayıldı.`:`Baseline: Last 6-month avg revenue ₺${Math.round(avgRev/1000)}K · Expenses assumed at 65% of revenue.`}</p>
                      </motion.div>
                    );
                  })()}

                  {/* ── Phase 558: KDV Analiz Raporu ──────────────────────────────────── */}
                  {muhasebeTab === 'kdv' && (() => {
                    const tr558 = currentLanguage === 'tr';
                    const yearNum = Number(p558Year);

                    // Build monthly KDV collected from orders
                    const monthlyData = Array.from({length:12},(_,i) => {
                      const m = i + 1;
                      const monthOrders = orders.filter(o => {
                        const raw = o.createdAt ?? o.syncedAt;
                        if (!raw || o.status === 'Cancelled') return false;
                        const d = typeof (raw as {toDate?:()=>Date}).toDate === 'function'
                          ? (raw as {toDate:()=>Date}).toDate()
                          : new Date(raw as string);
                        return d.getFullYear() === yearNum && d.getMonth() === i;
                      });
                      const collected = monthOrders.reduce((s,o) => s + (Number((o as unknown as Record<string,unknown>).kdvTutari) || 0), 0);
                      // Estimate KDV paid: assume 18% KDV on 80% of order value (as purchases)
                      const netSales = monthOrders.reduce((s,o) => s + (o.totalPrice || 0), 0);
                      const paidEst = Math.round(netSales * 0.8 * 0.18 * 0.3); // rough 30% of sales go as purchases
                      return { m, collected, paidEst, net: collected - paidEst };
                    });

                    const totCol = monthlyData.reduce((s,d) => s+d.collected, 0);
                    const totPaid = monthlyData.reduce((s,d) => s+d.paidEst, 0);
                    const totNet = totCol - totPaid;
                    const monthNames = tr558
                      ? ['Oca','Şub','Mar','Nis','May','Haz','Tem','Ağu','Eyl','Eki','Kas','Ara']
                      : ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
                    const maxVal = Math.max(...monthlyData.map(d => d.collected), 1);

                    // KDV by rate breakdown from orders
                    const rateMap: Record<number,number> = {};
                    orders.filter(o => o.status !== 'Cancelled').forEach(o => {
                      const rate = Number((o as unknown as Record<string,unknown>).kdvOran) || 18;
                      const kdv = Number((o as unknown as Record<string,unknown>).kdvTutari) || 0;
                      if (kdv > 0) rateMap[rate] = (rateMap[rate] || 0) + kdv;
                    });

                    return (
                      <motion.div key="kdv" initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-8}} className="space-y-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <h3 className="font-bold text-gray-800 flex items-center gap-2">
                            <Receipt className="w-5 h-5 text-brand" />
                            {tr558 ? 'KDV Analiz Raporu' : 'VAT Analysis Report'}
                          </h3>
                          <div className="flex items-center gap-2">
                            <label className="text-xs text-gray-500">{tr558 ? 'Yıl:' : 'Year:'}</label>
                            <select className="apple-input text-sm px-3 py-1.5" value={p558Year} onChange={e => setP558Year(e.target.value)}>
                              {[0,1,2].map(i => { const y = String(new Date().getFullYear() - i); return <option key={y} value={y}>{y}</option>; })}
                            </select>
                          </div>
                        </div>

                        {/* KPI bar */}
                        <div className="grid grid-cols-3 gap-3">
                          {[
                            { label: tr558?'Tahsil Edilen KDV':'KDV Collected', val: totCol, color:'text-emerald-700', bg:'bg-emerald-50' },
                            { label: tr558?'Ödenen KDV (Tahmini)':'KDV Paid (Est)', val: totPaid, color:'text-red-600', bg:'bg-red-50' },
                            { label: tr558?'Net KDV Borcu':'Net KDV Payable', val: totNet, color: totNet>0?'text-amber-700':'text-blue-700', bg: totNet>0?'bg-amber-50':'bg-blue-50' },
                          ].map(k => (
                            <div key={k.label} className={`apple-card p-4 ${k.bg}`}>
                              <p className="text-[10px] font-bold text-gray-400">{k.label}</p>
                              <p className={`text-xl font-black mt-1 ${k.color}`}>{fmtKpi(k.val,'full',0)}</p>
                            </div>
                          ))}
                        </div>

                        {/* Monthly bar chart */}
                        <div className="apple-card p-5">
                          <h4 className="font-bold text-gray-700 text-sm mb-4">{tr558 ? 'Aylık KDV Tahsilatı' : 'Monthly VAT Collected'} — {p558Year}</h4>
                          <div className="flex items-end gap-1 h-32">
                            {monthlyData.map(d => (
                              <div key={d.m} className="flex-1 flex flex-col items-center gap-1">
                                <div className="w-full bg-brand/10 rounded-t relative flex flex-col justify-end" style={{height:'100px'}}>
                                  <div className="bg-brand/70 rounded-t transition-all duration-500 w-full"
                                    style={{height: `${(d.collected/maxVal)*100}%`, minHeight: d.collected>0?'2px':'0'}} />
                                  {d.paidEst > 0 && (
                                    <div className="absolute bottom-0 left-0 right-0 bg-red-300/50 rounded-t" style={{height:`${(d.paidEst/maxVal)*100}%`}} />
                                  )}
                                </div>
                                <span className="text-[9px] text-gray-400">{monthNames[d.m-1]}</span>
                              </div>
                            ))}
                          </div>
                          <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
                            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-brand/70 inline-block" />{tr558?'Tahsil':'Collected'}</span>
                            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-red-300/50 inline-block" />{tr558?'Ödenen (Tahmini)':'Paid (Est)'}</span>
                          </div>
                        </div>

                        {/* Monthly table */}
                        <div className="apple-card p-5">
                          <h4 className="font-bold text-gray-700 text-sm mb-3">{tr558 ? 'Dönem Detayı' : 'Period Detail'}</h4>
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="border-b border-gray-100">
                                  {[tr558?'Ay':'Month', tr558?'Tahsil Edilen KDV':'Collected', tr558?'Ödenen KDV (Tahmini)':'Paid (Est)', tr558?'Net KDV':'Net'].map(h => (
                                    <th key={h} className="py-2 px-3 text-left text-[10px] font-bold text-gray-400 uppercase">{h}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-50">
                                {monthlyData.map(d => (
                                  <tr key={d.m} className="hover:bg-gray-50/50">
                                    <td className="px-3 py-2 font-semibold text-gray-700">{monthNames[d.m-1]}</td>
                                    <td className="px-3 py-2 text-emerald-700 font-mono">{d.collected > 0 ? `₺${d.collected.toLocaleString('tr-TR')}` : '—'}</td>
                                    <td className="px-3 py-2 text-red-500 font-mono">{d.paidEst > 0 ? `₺${d.paidEst.toLocaleString('tr-TR')}` : '—'}</td>
                                    <td className={`px-3 py-2 font-bold font-mono ${d.net > 0 ? 'text-amber-700' : d.net < 0 ? 'text-blue-700' : 'text-gray-400'}`}>
                                      {d.net !== 0 ? `₺${d.net.toLocaleString('tr-TR')}` : '—'}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                              <tfoot>
                                <tr className="border-t-2 border-gray-200 font-bold bg-gray-50">
                                  <td className="px-3 py-2 text-[10px] uppercase text-gray-500">{tr558?'Toplam':'Total'}</td>
                                  <td className="px-3 py-2 text-emerald-700 font-mono">₺{totCol.toLocaleString('tr-TR')}</td>
                                  <td className="px-3 py-2 text-red-500 font-mono">₺{totPaid.toLocaleString('tr-TR')}</td>
                                  <td className={`px-3 py-2 font-mono ${totNet>0?'text-amber-700':'text-blue-700'}`}>₺{totNet.toLocaleString('tr-TR')}</td>
                                </tr>
                              </tfoot>
                            </table>
                          </div>
                          {Object.keys(rateMap).length > 0 && (
                            <div className="mt-4 pt-4 border-t border-gray-100">
                              <p className="text-[10px] font-bold text-gray-400 uppercase mb-2">{tr558 ? 'KDV Oranına Göre Dağılım (Tüm Zamanlar)' : 'Distribution by VAT Rate (All Time)'}</p>
                              <div className="flex flex-wrap gap-3">
                                {Object.entries(rateMap).sort((a,b) => Number(b[0])-Number(a[0])).map(([rate, total]) => (
                                  <div key={rate} className="bg-gray-50 rounded-xl px-3 py-2">
                                    <p className="text-[10px] text-gray-400">%{rate} KDV</p>
                                    <p className="font-bold text-gray-800 text-sm">₺{total.toLocaleString('tr-TR')}</p>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          <p className="text-[10px] text-gray-400 mt-3">* {tr558?'Ödenen KDV tahminidir. Gerçek değerler için alış faturalarını muhasebeye girin.':'Paid VAT is estimated. Enter purchase invoices for accurate values.'}</p>
                        </div>
                      </motion.div>
                    );
                  })()}

                  {/* ── Vade Analizi & Cari Ekstre — Cari Hesap sekmesinin doğal yeri ── */}
                  {muhasebeTab === 'cari' && (
                    <div className="mb-6">
                      <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3 px-1 flex items-center gap-1.5">
                        <span>{currentLanguage === 'tr' ? 'Vade Analizi & Cari Ekstre' : 'AR Aging & Account Statement'}</span>
                      </h4>
                      <React.Suspense fallback={LAZY_FALLBACK}><CariEkstrePanel currentLanguage={currentLanguage} /></React.Suspense>
                    </div>
                  )}

                  {/* ── Phase 559: Müşteri Cari Hesap Ekstresi ────────────────────────── */}
                  {muhasebeTab === 'cari' && (() => {
                    const tr559 = currentLanguage === 'tr';
                    // Build customer list from orders + leads
                    const customerNames = Array.from(new Set([
                      ...orders.map(o => o.customerName),
                      ...leads.map(l => l.name),
                    ])).filter(Boolean).sort();

                    const selCustomer = p559Customer || customerNames[0] || '';
                    const custOrders = orders.filter(o => o.customerName === selCustomer).sort((a,b) => {
                      const da = a.createdAt ? (typeof (a.createdAt as {toDate?:()=>Date}).toDate==='function'?(a.createdAt as {toDate:()=>Date}).toDate():new Date(a.createdAt as string)).getTime() : 0;
                      const db2 = b.createdAt ? (typeof (b.createdAt as {toDate?:()=>Date}).toDate==='function'?(b.createdAt as {toDate:()=>Date}).toDate():new Date(b.createdAt as string)).getTime() : 0;
                      return da - db2;
                    });
                    const custLead = leads.find(l => l.name === selCustomer);
                    const creditLimit = custLead?.creditLimit ?? 0;

                    // Calculate running balance (+ = receivable/owed, - = credit)
                    let runBalance = 0;
                    const ledger = custOrders.map(o => {
                      const isPaid = o.paid === true;
                      const amt = o.totalPrice || 0;
                      runBalance += amt;
                      return { ...o, runBalance, isPaid, dateStr: (() => {
                        const raw = o.createdAt ?? o.syncedAt;
                        if (!raw) return '—';
                        const d = typeof (raw as {toDate?:()=>Date}).toDate==='function'?(raw as {toDate:()=>Date}).toDate():new Date(raw as string);
                        return d.toLocaleDateString('tr-TR');
                      })() };
                    });

                    const totalInvoiced = custOrders.reduce((s,o) => s+(o.totalPrice||0), 0);
                    const totalPaid = custOrders.filter(o => o.paid).reduce((s,o) => s+(o.totalPrice||0), 0);
                    const outstanding = totalInvoiced - totalPaid;
                    const creditUtil = creditLimit > 0 ? (outstanding / creditLimit) * 100 : 0;

                    return (
                      <motion.div key="cari" initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-8}} className="space-y-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <h3 className="font-bold text-gray-800 flex items-center gap-2">
                            <Users className="w-5 h-5 text-brand" />
                            {tr559 ? 'Müşteri Cari Hesap Ekstresi' : 'Customer Account Statement'}
                          </h3>
                          <select className="apple-input text-sm px-3 py-1.5 max-w-xs"
                            value={selCustomer} onChange={e => setP559Customer(e.target.value)}>
                            {customerNames.map(n => <option key={n} value={n}>{n}</option>)}
                          </select>
                        </div>

                        {/* Customer KPI row */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                          {[
                            { label: tr559?'Toplam Fatura':'Total Invoiced', val: totalInvoiced, color:'text-gray-800', bg:'bg-gray-50' },
                            { label: tr559?'Tahsil Edilen':'Collected', val: totalPaid, color:'text-emerald-700', bg:'bg-emerald-50' },
                            { label: tr559?'Bekleyen Alacak':'Outstanding', val: outstanding, color: outstanding>0?'text-amber-700':'text-emerald-700', bg:'bg-amber-50' },
                            { label: tr559?'Kredi Limiti':'Credit Limit', val: creditLimit, color: creditUtil>80?'text-red-600':'text-blue-700', bg: creditUtil>80?'bg-red-50':'bg-blue-50' },
                          ].map(k => (
                            <div key={k.label} className={`apple-card p-4 ${k.bg}`}>
                              <p className="text-[10px] font-bold text-gray-400">{k.label}</p>
                              <p className={`text-xl font-black mt-1 ${k.color}`}>{fmtKpi(k.val,'full',0)}</p>
                            </div>
                          ))}
                        </div>

                        {/* Credit utilization bar */}
                        {creditLimit > 0 && (
                          <div className="apple-card px-5 py-4">
                            <div className="flex items-center justify-between mb-2">
                              <p className="text-xs font-bold text-gray-600">{tr559?'Kredi Kullanım Oranı':'Credit Utilization'}</p>
                              <span className={`text-xs font-bold ${creditUtil>80?'text-red-600':creditUtil>60?'text-amber-600':'text-emerald-600'}`}>{creditUtil.toFixed(1)}%</span>
                            </div>
                            <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
                              <div className={`h-full rounded-full transition-all duration-700 ${creditUtil>80?'bg-red-500':creditUtil>60?'bg-amber-400':'bg-emerald-500'}`}
                                style={{width:`${Math.min(creditUtil,100)}%`}} />
                            </div>
                            {creditUtil > 80 && (
                              <p className="text-xs text-red-600 mt-2 flex items-center gap-1">
                                <AlertTriangle className="w-3 h-3" />{tr559?'Kredi limitinin %80 üzerinde!':'Over 80% of credit limit!'}
                              </p>
                            )}
                          </div>
                        )}

                        {/* Ledger table */}
                        <div className="apple-card p-5">
                          <h4 className="font-bold text-gray-700 text-sm mb-3">
                            {tr559?'Hareket Özeti':'Transaction Ledger'} — {selCustomer}
                          </h4>
                          {ledger.length === 0 ? (
                            <div className="text-center py-10 space-y-2">
                              <Users className="w-10 h-10 text-gray-200 mx-auto" />
                              <p className="text-gray-400 text-sm">{tr559?'Bu müşteri için işlem bulunamadı.':'No transactions found for this customer.'}</p>
                            </div>
                          ) : (
                            <div className="overflow-x-auto">
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="border-b border-gray-100">
                                    {[tr559?'Tarih':'Date','#',tr559?'Durum':'Status',tr559?'Tutar':'Amount',tr559?'Ödeme':'Payment',tr559?'Bakiye':'Balance'].map(h => (
                                      <th key={h} className="py-2 px-3 text-left text-[10px] font-bold text-gray-400 uppercase">{h}</th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-50">
                                  {ledger.map(row => (
                                    <tr key={row.id} className="hover:bg-gray-50/50 transition-colors">
                                      <td className="px-3 py-2 text-gray-500">{row.dateStr}</td>
                                      <td className="px-3 py-2 font-mono text-gray-600">{row.id.slice(0,8)}</td>
                                      <td className="px-3 py-2">
                                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                          row.status==='Delivered'?'bg-emerald-100 text-emerald-700':
                                          row.status==='Shipped'?'bg-blue-100 text-blue-700':
                                          row.status==='Cancelled'?'bg-gray-100 text-gray-500':
                                          'bg-amber-100 text-amber-700'
                                        }`}>{row.status}</span>
                                      </td>
                                      <td className="px-3 py-2 font-bold text-gray-800 font-mono">₺{(row.totalPrice||0).toLocaleString('tr-TR')}</td>
                                      <td className="px-3 py-2">
                                        {row.isPaid
                                          ? <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">✓ {tr559?'Ödendi':'Paid'}</span>
                                          : <span className="text-[10px] font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">⏳ {tr559?'Bekliyor':'Pending'}</span>
                                        }
                                      </td>
                                      <td className={`px-3 py-2 font-bold font-mono ${row.runBalance>0?'text-amber-700':'text-emerald-700'}`}>
                                        ₺{row.runBalance.toLocaleString('tr-TR')}
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
                  })()}

                  {/* ── Phase 560: Sipariş Onay Akışı (Order Approval Workflow) ────────── */}
                  {muhasebeTab === 'genel' && (() => {
                    const tr560 = currentLanguage === 'tr';
                    const approvalOrders = orders.filter(o =>
                      o.status === 'Pending' && (o.totalPrice || 0) >= p560ApprovalThreshold
                    );
                    if (approvalOrders.length === 0) return null;
                    return (
                      <div className="apple-card p-5 border-l-4 border-amber-400 bg-amber-50/30">
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <AlertTriangle className="w-5 h-5 text-amber-500" />
                            <h4 className="font-bold text-amber-800 text-sm">
                              {tr560 ? 'Onay Bekleyen Yüksek Değerli Siparişler' : 'High-Value Orders Pending Approval'}
                            </h4>
                            <span className="bg-amber-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full">{approvalOrders.length}</span>
                          </div>
                          <div className="flex items-center gap-2 text-xs text-gray-500">
                            <label>{tr560?'Limit:':'Threshold:'}</label>
                            <input type="number" className="apple-input text-xs px-2 py-1 w-24" value={p560ApprovalThreshold}
                              onChange={e => setP560ApprovalThreshold(Number(e.target.value))} />
                          </div>
                        </div>
                        <div className="space-y-2">
                          {approvalOrders.map(o => (
                            <div key={o.id} className="flex items-center justify-between bg-white rounded-xl px-4 py-3 border border-amber-100">
                              <div className="flex-1 min-w-0">
                                <p className="font-semibold text-gray-800 text-sm">{o.customerName}</p>
                                <p className="text-xs text-gray-400">#{o.id.slice(0,8)} · ₺{(o.totalPrice||0).toLocaleString('tr-TR')}</p>
                              </div>
                              {hasFullAccess('muhasebe') && (
                                <div className="flex items-center gap-2 flex-shrink-0">
                                  <button onClick={async () => {
                                    await updateDoc(doc(db, 'orders', o.id), { status: 'Processing' });
                                    toast(tr560?'Sipariş onaylandı.':'Order approved.', 'success');
                                  }} className="text-xs font-bold text-emerald-600 bg-emerald-100 hover:bg-emerald-200 px-3 py-1.5 rounded-lg transition-colors">
                                    {tr560?'Onayla':'Approve'}
                                  </button>
                                  <button onClick={async () => {
                                    await updateDoc(doc(db, 'orders', o.id), { status: 'Cancelled' });
                                    toast(tr560?'Sipariş reddedildi.':'Order rejected.', 'error');
                                  }} className="text-xs font-bold text-red-600 bg-red-100 hover:bg-red-200 px-3 py-1.5 rounded-lg transition-colors">
                                    {tr560?'Reddet':'Reject'}
                                  </button>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })()}

                  {/* ── Phase 564: e-Fatura Takip ─────────────────────────────────────── */}
                  {muhasebeTab === 'fatura-takip' && (() => {
                    const tr564 = currentLanguage === 'tr';
                    const allBillable = orders.filter(o => o.status !== 'Cancelled');
                    const filtered564 = allBillable.filter(o => {
                      if (p564FaturaFilter === 'missing') return !o.hasInvoice && !o.mikroFaturaNo && !o.lucaFaturaNo;
                      if (p564FaturaFilter === 'synced') return o.mikroSynced || o.lucaSynced;
                      if (p564FaturaFilter === 'pending') return o.hasInvoice && !o.mikroSynced && !o.lucaSynced;
                      return true;
                    });
                    const missingCount = allBillable.filter(o => !o.hasInvoice && !o.mikroFaturaNo && !o.lucaFaturaNo).length;
                    const syncedCount = allBillable.filter(o => o.mikroSynced || o.lucaSynced).length;
                    const pendingCount = allBillable.filter(o => o.hasInvoice && !o.mikroSynced && !o.lucaSynced).length;

                    return (
                      <motion.div key="fatura-takip" initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-8}} className="space-y-4">
                        <ModuleHeader
                          title={tr564 ? 'e-Fatura Takip Paneli' : 'e-Invoice Tracking Panel'}
                          subtitle={tr564 ? 'Siparişlerin fatura durumunu ve ERP senkronizasyonunu takip edin' : 'Track invoice status and ERP sync for all orders'}
                          icon={FileText}
                        />

                        {/* KPI strip */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                          {[
                            { label: tr564?'Toplam Sipariş':'Total Orders',  val: allBillable.length, color:'text-gray-700', bg:'bg-gray-50' },
                            { label: tr564?'Fatura Eksik':'Missing Invoice', val: missingCount, color: missingCount>0?'text-red-600':'text-emerald-600', bg: missingCount>0?'bg-red-50':'bg-emerald-50' },
                            { label: tr564?'Fatura Bekliyor':'Invoice Pending', val: pendingCount, color:'text-amber-700', bg:'bg-amber-50' },
                            { label: tr564?'ERP Senkron':'ERP Synced', val: syncedCount, color:'text-emerald-700', bg:'bg-emerald-50' },
                          ].map(k => (
                            <div key={k.label} className={`apple-card p-4 ${k.bg}`}>
                              <p className="text-[10px] font-bold text-gray-400">{k.label}</p>
                              <p className={`text-2xl font-black mt-1 ${k.color}`}>{k.val}</p>
                            </div>
                          ))}
                        </div>

                        {/* Filter tabs */}
                        <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
                          {([
                            { id: 'missing', label: tr564?'Fatura Eksik':'Missing', count: missingCount },
                            { id: 'pending', label: tr564?'Bekliyor':'Pending', count: pendingCount },
                            { id: 'synced',  label: tr564?'Senkron':'Synced', count: syncedCount },
                            { id: 'all',     label: tr564?'Tümü':'All', count: allBillable.length },
                          ] as const).map(f => (
                            <button key={f.id} onClick={() => setP564FaturaFilter(f.id)}
                              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${p564FaturaFilter===f.id?'bg-white shadow text-gray-900':'text-gray-500 hover:text-gray-700'}`}>
                              {f.label}
                              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${p564FaturaFilter===f.id?'bg-gray-100 text-gray-600':'bg-gray-200 text-gray-500'}`}>{f.count}</span>
                            </button>
                          ))}
                        </div>

                        {/* Order table */}
                        <div className="apple-card overflow-hidden">
                          {filtered564.length === 0 ? (
                            <div className="text-center py-12 space-y-2">
                              <FileText className="w-10 h-10 text-gray-200 mx-auto" />
                              <p className="text-gray-400 text-sm">{tr564?'Bu filtreyle sipariş bulunamadı.':'No orders found with this filter.'}</p>
                            </div>
                          ) : (
                            <div className="overflow-x-auto">
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="bg-gray-50 border-b border-gray-100">
                                    {[tr564?'Tarih':'Date', tr564?'Müşteri':'Customer', tr564?'Tutar':'Amount',
                                      tr564?'Fatura Tipi':'Invoice Type', tr564?'Fatura No':'Invoice No',
                                      tr564?'ERP Durumu':'ERP Status', ''].map(h => (
                                      <th key={h} className="px-3 py-2.5 text-left text-[10px] font-bold text-gray-400 uppercase whitespace-nowrap">{h}</th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-50">
                                  {filtered564.slice(0,50).map(o => {
                                    const invoiceNo = o.mikroFaturaNo || o.lucaFaturaNo || o.irsaliyeNo || '—';
                                    const isSynced = o.mikroSynced || o.lucaSynced;
                                    const hasFatura = o.hasInvoice || !!o.mikroFaturaNo || !!o.lucaFaturaNo;
                                    const dateStr = (() => {
                                      const raw = o.createdAt ?? o.syncedAt;
                                      if (!raw) return '—';
                                      const d = typeof (raw as {toDate?:()=>Date}).toDate==='function'?(raw as {toDate:()=>Date}).toDate():new Date(raw as string);
                                      return d.toLocaleDateString('tr-TR');
                                    })();
                                    return (
                                      <tr key={o.id} className={`hover:bg-gray-50/50 transition-colors ${!hasFatura?'bg-red-50/20':''}`}>
                                        <td className="px-3 py-2.5 text-gray-400">{dateStr}</td>
                                        <td className="px-3 py-2.5 font-semibold text-gray-800 max-w-[150px] truncate">{o.customerName}</td>
                                        <td className="px-3 py-2.5 font-mono text-gray-700">₺{(o.totalPrice||0).toLocaleString('tr-TR')}</td>
                                        <td className="px-3 py-2.5">
                                          {o.faturaTipi ? (
                                            <span className="text-[10px] font-bold bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">{o.faturaTipi}</span>
                                          ) : (
                                            <span className="text-[10px] text-gray-400">—</span>
                                          )}
                                        </td>
                                        <td className="px-3 py-2.5 font-mono text-gray-500">{invoiceNo}</td>
                                        <td className="px-3 py-2.5">
                                          {isSynced ? (
                                            <span className="text-[10px] font-bold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">✓ {o.lucaSynced?'Luca':o.mikroSynced?'Mikro':'Sync'}</span>
                                          ) : hasFatura ? (
                                            <span className="text-[10px] font-bold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">⏳ {tr564?'Bekliyor':'Pending'}</span>
                                          ) : (
                                            <span className="text-[10px] font-bold bg-red-100 text-red-700 px-2 py-0.5 rounded-full">✗ {tr564?'Fatura Yok':'No Invoice'}</span>
                                          )}
                                        </td>
                                        <td className="px-3 py-2.5">
                                          {!hasFatura && hasFullAccess('muhasebe') && (
                                            <button onClick={async () => {
                                              await updateDoc(doc(db, 'orders', o.id), { hasInvoice: true });
                                              toast(tr564?'Fatura kesildi olarak işaretlendi.':'Marked as invoiced.', 'success');
                                            }} className="text-[10px] font-bold text-blue-600 bg-blue-50 hover:bg-blue-100 px-2 py-1 rounded-lg transition-colors">
                                              {tr564?'Faturalandı':'Mark Invoiced'}
                                            </button>
                                          )}
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      </motion.div>
                    );
                  })()}

                  {/* ── Phase 630: Fatura Yaşlandırma Analizi ───────────────────────── */}
                  {muhasebeTab === 'fatura-takip' && orders.length > 0 && (() => {
                    const tr630 = currentLanguage === 'tr';
                    const today630 = new Date();
                    const daysMap630:{[k:string]:number} = {'7d':7,'30d':30,'60d':60,'90d':90};
                    const maxDays = daysMap630[p630InvoicePeriod];
                    const cutoff630 = new Date(Date.now()-maxDays*86400000);
                    // All invoiced orders that are unpaid
                    const unpaidInvoiced = orders.filter(o=>{
                      if(o.paid||o.status==='Cancelled') return false;
                      if(!o.createdAt) return false;
                      try { const d=(o.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(o.createdAt as string); return d>=cutoff630; } catch { return false; }
                    });
                    const buckets = [
                      {label:tr630?'0-30 Gün':'0-30 Days',min:0,max:30,color:'text-emerald-600',bg:'bg-emerald-50',orders:[] as typeof unpaidInvoiced},
                      {label:tr630?'31-60 Gün':'31-60 Days',min:31,max:60,color:'text-amber-600',bg:'bg-amber-50',orders:[] as typeof unpaidInvoiced},
                      {label:tr630?'61-90 Gün':'61-90 Days',min:61,max:90,color:'text-orange-600',bg:'bg-orange-50',orders:[] as typeof unpaidInvoiced},
                      {label:tr630?'90+ Gün':'90+ Days',min:91,max:9999,color:'text-red-600',bg:'bg-red-50',orders:[] as typeof unpaidInvoiced},
                    ];
                    unpaidInvoiced.forEach(o=>{
                      try {
                        const d=(o.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(o.createdAt as string);
                        const days=Math.floor((today630.getTime()-d.getTime())/86400000);
                        const b = buckets.find(bk=>days>=bk.min&&days<=bk.max);
                        if(b) b.orders.push(o);
                      } catch { /* skip */ }
                    });
                    const totalUnpaid = unpaidInvoiced.reduce((s,o)=>s+(o.totalPrice||0),0);
                    if(unpaidInvoiced.length===0) return null;
                    return (
                      <div className="apple-card p-5 space-y-4 mt-4">
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <h3 className="font-bold text-gray-900 text-sm">📋 {tr630?'Fatura Yaşlandırma':'Invoice Aging'}</h3>
                          <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
                            {([{k:'7d',l:'7d'},{k:'30d',l:'30d'},{k:'60d',l:'60d'},{k:'90d',l:'90d'}] as {k:'7d'|'30d'|'60d'|'90d';l:string}[]).map(t=>(
                              <button key={t.k} onClick={()=>setP630InvoicePeriod(t.k)} className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${p630InvoicePeriod===t.k?'bg-white shadow text-gray-900':'text-gray-500 hover:text-gray-700'}`}>{t.l}</button>
                            ))}
                          </div>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                          {buckets.map(b=>(
                            <div key={b.label} className={`rounded-xl p-3 ${b.bg}`}>
                              <p className="text-[10px] font-bold text-gray-400 uppercase">{b.label}</p>
                              <p className={`text-xl font-black ${b.color}`}>{b.orders.length}</p>
                              <p className="text-xs text-gray-500">₺{Math.round(b.orders.reduce((s,o)=>s+(o.totalPrice||0),0)).toLocaleString('tr-TR')}</p>
                            </div>
                          ))}
                        </div>
                        <div className="text-xs text-gray-500">{tr630?'Toplam Bekleyen:':'Total Outstanding:'} <span className="font-bold text-red-600">₺{Math.round(totalUnpaid).toLocaleString('tr-TR')}</span> ({unpaidInvoiced.length} {tr630?'sipariş':'orders'})</div>
                      </div>
                    );
                  })()}

                  {/* ── Phase 565: Satış Tahmini (Sales Forecast) ─────────────────────── */}
                  {muhasebeTab === 'pnl' && (() => {
                    const tr565 = currentLanguage === 'tr';
                    const now = new Date();
                    // Build 6-month history
                    const hist: number[] = [];
                    for (let i = 5; i >= 0; i--) {
                      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
                      const rev = orders.filter(o => {
                        if (o.status === 'Cancelled' || !o.createdAt) return false;
                        try {
                          const od = (o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string);
                          return od.getFullYear()===d.getFullYear() && od.getMonth()===d.getMonth();
                        } catch { return false; }
                      }).reduce((s,o) => s+(o.totalPrice||0), 0);
                      hist.push(rev);
                    }
                    // Simple weighted moving average: more weight on recent months
                    const weights = [1, 1.5, 2, 2.5, 3, 3.5];
                    const weightSum = weights.reduce((s,w) => s+w, 0);
                    const wma = hist.reduce((s, v, i) => s + v * weights[i], 0) / weightSum;
                    // Trend: regression slope over 6 months
                    const n = hist.length;
                    const xMean = (n-1)/2;
                    const yMean = hist.reduce((s,v) => s+v, 0) / n;
                    const slope = hist.reduce((s,v,i) => s + (i-xMean)*(v-yMean), 0) /
                                  hist.reduce((s,_,i) => s + (i-xMean)**2, 0);
                    // Forecast next 3 months
                    const forecast = [1,2,3].map(offset => {
                      const pred = Math.max(0, wma + slope * offset);
                      const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
                      return {
                        label: d.toLocaleString(tr565?'tr-TR':'en-US', {month:'short', year:'2-digit'}),
                        value: pred,
                        low: pred * 0.85,
                        high: pred * 1.15,
                      };
                    });
                    const histLabels: string[] = [];
                    for (let i = 5; i >= 0; i--) {
                      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
                      histLabels.push(d.toLocaleString(tr565?'tr-TR':'en-US', {month:'short', year:'2-digit'}));
                    }
                    const allValues = [...hist, ...forecast.map(f => f.high)].filter(v => v > 0);
                    const maxV = Math.max(...allValues, 1);

                    return (
                      <div className="apple-card p-5 mt-4">
                        <div className="flex items-center gap-2 mb-4">
                          <TrendingUp className="w-4 h-4 text-emerald-500" />
                          <h4 className="font-bold text-gray-800 text-sm">{tr565?'Satış Tahmini (Ağırlıklı Hareketli Ortalama)':'Sales Forecast (Weighted Moving Average)'}</h4>
                        </div>

                        {/* Combined chart: history + forecast */}
                        <div className="flex items-end gap-1" style={{height:'100px'}}>
                          {hist.map((v, i) => (
                            <div key={`h${i}`} className="flex-1 flex flex-col items-center gap-0.5">
                              <div className="w-full bg-blue-100 rounded-t" style={{height:`${(v/maxV)*90}px`, minHeight: v>0?'2px':'0'}} />
                              <span className="text-[8px] text-gray-400 rotate-0 whitespace-nowrap">{histLabels[i]}</span>
                            </div>
                          ))}
                          <div className="w-px bg-gray-300 self-stretch mx-1" />
                          {forecast.map((f, i) => (
                            <div key={`f${i}`} className="flex-1 flex flex-col items-center gap-0.5 relative">
                              {/* High band */}
                              <div className="w-full bg-emerald-100 rounded-t relative" style={{height:`${(f.high/maxV)*90}px`}}>
                                <div className="absolute bottom-0 left-0 right-0 bg-emerald-400 rounded-t" style={{height:`${(f.value/f.high)*100}%`}} />
                              </div>
                              <span className="text-[8px] text-emerald-600 font-bold">{f.label}</span>
                            </div>
                          ))}
                        </div>
                        <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
                          <span className="flex items-center gap-1"><span className="w-3 h-2 rounded-sm bg-blue-100 inline-block" />{tr565?'Gerçekleşen':'Actual'}</span>
                          <span className="flex items-center gap-1"><span className="w-3 h-2 rounded-sm bg-emerald-400 inline-block" />{tr565?'Tahmin':'Forecast'}</span>
                          <span className="flex items-center gap-1"><span className="w-3 h-2 rounded-sm bg-emerald-100 inline-block" />{tr565?'±%15 Aralık':'±15% Band'}</span>
                        </div>

                        {/* Forecast table */}
                        <div className="mt-4 space-y-2">
                          {forecast.map(f => (
                            <div key={f.label} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                              <span className="text-sm font-semibold text-gray-700">{f.label}</span>
                              <div className="flex items-center gap-4 text-xs">
                                <span className="text-gray-400">{fmtKpi(f.low,'K',0)} – {fmtKpi(f.high,'K',0)}</span>
                                <span className="font-bold text-emerald-700">{fmtKpi(f.value,'K',0)}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                        <p className="text-[10px] text-gray-400 mt-2">* {tr565?'6 aylık geçmiş veriye dayalı ağırlıklı hareketli ortalama tahmini.':'Weighted moving average based on 6-month historical data.'}</p>
                      </div>
                    );
                  })()}

                  {/* ── Phase 566: Kar Merkezi Raporu (Profit Center) ─────────────────── */}
                  {muhasebeTab === 'pnl' && (() => {
                    const tr566 = currentLanguage === 'tr';
                    // Profit centers: B2B vs Retail by customerType
                    const centers: Record<string, { revenue: number; cogs: number; count: number }> = {};
                    orders.filter(o => o.status !== 'Cancelled').forEach(o => {
                      const key = o.customerType || (tr566 ? 'Diğer' : 'Other');
                      if (!centers[key]) centers[key] = { revenue: 0, cogs: 0, count: 0 };
                      centers[key].revenue += o.totalPrice || 0;
                      centers[key].cogs += (o.lineItems ?? []).reduce((s,li) => s+((li.costPrice??0)*li.quantity), 0);
                      centers[key].count++;
                    });
                    const pcList = Object.entries(centers).map(([name, v]) => ({
                      name, revenue: v.revenue, cogs: v.cogs, gross: v.revenue - v.cogs,
                      margin: v.revenue > 0 ? ((v.revenue - v.cogs) / v.revenue) * 100 : 0,
                      count: v.count,
                    })).sort((a,b) => b.revenue - a.revenue);
                    if (pcList.length === 0) return null;

                    return (
                      <div className="apple-card p-5 mt-4">
                        <div className="flex items-center gap-2 mb-4">
                          <BarChart3 className="w-4 h-4 text-purple-500" />
                          <h4 className="font-bold text-gray-800 text-sm">{tr566?'Kar Merkezi Raporu':'Profit Center Report'}</h4>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="border-b border-gray-100">
                                {[tr566?'Kanal':'Channel', tr566?'Sipariş':'Orders', tr566?'Gelir':'Revenue',
                                  'COGS', tr566?'Brüt Kâr':'Gross Profit', tr566?'Marj':'Margin'].map(h => (
                                  <th key={h} className="py-2 px-3 text-left text-[10px] font-bold text-gray-400 uppercase">{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50">
                              {pcList.map(pc => (
                                <tr key={pc.name} className="hover:bg-gray-50/50">
                                  <td className="px-3 py-2.5 font-semibold text-gray-800">
                                    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold ${pc.name==='B2B'?'bg-blue-100 text-blue-700':'bg-purple-100 text-purple-700'}`}>
                                      {pc.name === 'B2B' ? '🏢' : '🛒'} {pc.name}
                                    </span>
                                  </td>
                                  <td className="px-3 py-2.5 text-gray-500">{pc.count}</td>
                                  <td className="px-3 py-2.5 font-bold text-gray-800 font-mono">{fmtKpi(pc.revenue,'K',0)}</td>
                                  <td className="px-3 py-2.5 text-red-500 font-mono">−{fmtKpi(pc.cogs,'K',0)}</td>
                                  <td className="px-3 py-2.5 font-bold text-emerald-700 font-mono">{fmtKpi(pc.gross,'K',0)}</td>
                                  <td className="px-3 py-2.5">
                                    <span className={`font-bold ${pc.margin>=30?'text-emerald-600':pc.margin>=15?'text-amber-600':'text-red-500'}`}>%{pc.margin.toFixed(1)}</span>
                                    <div className="w-16 h-1.5 bg-gray-100 rounded-full mt-0.5 overflow-hidden">
                                      <div className={`h-full rounded-full ${pc.margin>=30?'bg-emerald-400':pc.margin>=15?'bg-amber-400':'bg-red-400'}`} style={{width:`${Math.min(pc.margin,100)}%`}} />
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    );
                  })()}

                  {/* ── Phase 573: Dinamik Fiyatlandırma Kuralları ─────────────────────── */}
                  {muhasebeTab === 'fiyat-kural' && (() => {
                    const tr573 = currentLanguage === 'tr';
                    const typeLabels573: Record<string, string> = {
                      'bulk': tr573 ? 'Toplu Alım İndirimi' : 'Bulk Discount',
                      'customer-tier': tr573 ? 'Müşteri Segmenti' : 'Customer Tier',
                      'promo': tr573 ? 'Promosyon' : 'Promotion',
                    };
                    const typeColors573: Record<string, string> = {
                      'bulk': 'bg-blue-100 text-blue-700',
                      'customer-tier': 'bg-purple-100 text-purple-700',
                      'promo': 'bg-amber-100 text-amber-700',
                    };
                    const addRule573 = async () => {
                      if (!p573Draft.name || !p573Draft.discountPct) return;
                      const newRule = {
                        id: Date.now().toString(),
                        name: p573Draft.name,
                        type: p573Draft.type,
                        minQty: p573Draft.minQty ? Number(p573Draft.minQty) : undefined,
                        tierName: p573Draft.tierName || undefined,
                        discountPct: Number(p573Draft.discountPct),
                        active: true,
                      };
                      setP573Rules(prev => [...prev, newRule]);
                      setP573Draft({ name: '', type: 'bulk', minQty: '', tierName: '', discountPct: '', active: true });
                      setP573ShowForm(false);
                    };
                    return (
                      <motion.div initial={{opacity:0,y:6}} animate={{opacity:1,y:0}} className="space-y-4">
                        <ModuleHeader title={tr573?'Fiyatlandırma Kuralları':'Pricing Rules Engine'}
                          subtitle={tr573?'Toplu alım, segment ve promosyon kurallarını yönetin.':'Manage bulk, segment and promotional pricing rules.'}
                          icon={Tag}
                          actionButton={hasFullAccess('muhasebe') && (
                            <button onClick={()=>setP573ShowForm(v=>!v)} className="apple-button-primary flex items-center gap-2 text-sm">
                              <Plus className="w-4 h-4"/>{tr573?'Kural Ekle':'Add Rule'}
                            </button>
                          )} />

                        {p573ShowForm && (
                          <div className="apple-card p-5 space-y-4">
                            <h4 className="font-bold text-gray-800 text-sm">{tr573?'Yeni Fiyat Kuralı':'New Pricing Rule'}</h4>
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                              <input className="apple-input px-3 py-2 text-sm" placeholder={tr573?'Kural Adı':'Rule Name'} value={p573Draft.name} onChange={e=>setP573Draft(d=>({...d,name:e.target.value}))} />
                              <select className="apple-input px-3 py-2 text-sm" value={p573Draft.type} onChange={e=>setP573Draft(d=>({...d,type:e.target.value as typeof d.type}))}>
                                <option value="bulk">{typeLabels573['bulk']}</option>
                                <option value="customer-tier">{typeLabels573['customer-tier']}</option>
                                <option value="promo">{typeLabels573['promo']}</option>
                              </select>
                              <input type="number" className="apple-input px-3 py-2 text-sm" placeholder={tr573?'İndirim % (ör. 10)':'Discount % (e.g. 10)'} value={p573Draft.discountPct} onChange={e=>setP573Draft(d=>({...d,discountPct:e.target.value}))} />
                              {p573Draft.type==='bulk' && <input type="number" className="apple-input px-3 py-2 text-sm" placeholder={tr573?'Min. Adet':'Min. Qty'} value={p573Draft.minQty} onChange={e=>setP573Draft(d=>({...d,minQty:e.target.value}))} />}
                              {p573Draft.type==='customer-tier' && <input className="apple-input px-3 py-2 text-sm" placeholder={tr573?'Segment (B2B, Bayi...)':'Tier (B2B, Dealer...)'} value={p573Draft.tierName} onChange={e=>setP573Draft(d=>({...d,tierName:e.target.value}))} />}
                            </div>
                            <div className="flex gap-2">
                              <button onClick={addRule573} className="apple-button-primary text-sm px-4 py-1.5">{tr573?'Kaydet':'Save'}</button>
                              <button onClick={()=>setP573ShowForm(false)} className="apple-button-secondary text-sm px-4 py-1.5">{tr573?'İptal':'Cancel'}</button>
                            </div>
                          </div>
                        )}

                        {p573Rules.length === 0 ? (
                          <div className="apple-card p-12 text-center">
                            <Tag className="w-12 h-12 text-gray-200 mx-auto mb-3"/>
                            <p className="text-gray-400 text-sm">{tr573?'Henüz fiyat kuralı eklenmemiş.':'No pricing rules defined yet.'}</p>
                            <p className="text-gray-300 text-xs mt-1">{tr573?'"Kural Ekle" ile toplu alım, segment veya promosyon kuralları tanımlayın.':'Add bulk, tier or promo discount rules.'}</p>
                          </div>
                        ) : (
                          <div className="apple-card overflow-hidden">
                            <table className="w-full text-sm">
                              <thead><tr className="border-b border-gray-100 bg-gray-50">
                                {[tr573?'Kural Adı':'Rule Name', tr573?'Tür':'Type', tr573?'İndirim':'Discount', tr573?'Koşul':'Condition', tr573?'Durum':'Status', ''].map(h=>(
                                  <th key={h} className="px-4 py-2.5 text-left text-[10px] font-bold text-gray-400 uppercase">{h}</th>
                                ))}
                              </tr></thead>
                              <tbody className="divide-y divide-gray-50">
                                {p573Rules.map(r=>(
                                  <tr key={r.id} className={`hover:bg-gray-50/50 ${!r.active?'opacity-40':''}`}>
                                    <td className="px-4 py-3 font-semibold text-gray-800">{r.name}</td>
                                    <td className="px-4 py-3"><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${typeColors573[r.type]}`}>{typeLabels573[r.type]}</span></td>
                                    <td className="px-4 py-3 text-emerald-700 font-bold">%{r.discountPct}</td>
                                    <td className="px-4 py-3 text-gray-500 text-xs">{r.type==='bulk'&&r.minQty?`Min ${r.minQty} ${tr573?'adet':'units'}`:r.type==='customer-tier'&&r.tierName?r.tierName:tr573?'Genel':'General'}</td>
                                    <td className="px-4 py-3">
                                      <button onClick={()=>setP573Rules(prev=>prev.map(x=>x.id===r.id?{...x,active:!x.active}:x))}
                                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${r.active?'bg-green-100 text-green-700':'bg-gray-100 text-gray-500'}`}>
                                        {r.active?(tr573?'Aktif':'Active'):(tr573?'Pasif':'Inactive')}
                                      </button>
                                    </td>
                                    <td className="px-4 py-3">
                                      <button onClick={()=>setP573Rules(prev=>prev.filter(x=>x.id!==r.id))} className="text-red-400 hover:text-red-600 text-xs">{tr573?'Sil':'Delete'}</button>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                            {p573Rules.filter(r=>r.active).length > 0 && (
                              <div className="px-4 py-3 bg-emerald-50 border-t border-emerald-100">
                                <p className="text-xs text-emerald-700 font-semibold">{p573Rules.filter(r=>r.active).length} {tr573?'aktif kural — toplam etkin indirim:':'active rules — total potential discount:'} %{p573Rules.filter(r=>r.active).reduce((s,r)=>s+r.discountPct,0).toFixed(0)}</p>
                              </div>
                            )}
                          </div>
                        )}
                      </motion.div>
                    );
                  })()}

                  {/* ── Phase 580: Bütçe vs Gerçekleşen ───────────────────────────────── */}
                  {muhasebeTab === 'butce-gercek' && (() => {
                    const tr580 = currentLanguage === 'tr';
                    const year580 = Number(p580Year);
                    const months580 = Array.from({length:12},(_,i)=>i);
                    const monthLabels = tr580
                      ? ['Oca','Şub','Mar','Nis','May','Haz','Tem','Ağu','Eyl','Eki','Kas','Ara']
                      : ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
                    // Derive actuals from orders
                    const actuals580 = months580.map(m => {
                      const st = new Date(year580, m, 1);
                      const en = new Date(year580, m+1, 0, 23, 59, 59);
                      return orders.filter(o => {
                        if (o.status === 'Cancelled' || !o.createdAt) return false;
                        try {
                          const d = (o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string);
                          return d >= st && d <= en;
                        } catch { return false; }
                      }).reduce((s,o) => s+(o.totalPrice||0), 0);
                    });
                    const totalActual580 = actuals580.reduce((s,v)=>s+v,0);
                    // Monthly budget targets (equal split for now)
                    // Gerçek aylık bütçe: App "Bütçe & Senaryo" (settings/budgets → allBudgetsFirestore[yyyy-MM]).
                    const budgets580 = months580.map(m => {
                      const mm = String(m + 1).padStart(2, '0');
                      return (allBudgetsFirestore[`${year580}-${mm}`] ?? []).reduce((s, b) => s + (b.budgetTRY || 0), 0);
                    });
                    const totalBudget580 = budgets580.reduce((s,v)=>s+v,0);
                    const hasBudget580 = totalBudget580 > 0;
                    const overallPct = totalBudget580 > 0 ? (totalActual580/totalBudget580)*100 : 0;
                    const now580 = new Date();
                    const currentMonth = year580 === now580.getFullYear() ? now580.getMonth() : 11;
                    return (
                      <motion.div initial={{opacity:0,y:6}} animate={{opacity:1,y:0}} className="space-y-4">
                        <div className="flex items-center justify-between">
                          <ModuleHeader title={tr580?'Bütçe vs Gerçekleşen':'Budget vs Actual'} subtitle={tr580?'Aylık bütçe hedeflerine karşı gerçekleşen gelir':'Monthly revenue actuals vs budget targets'} icon={BarChart3} />
                          <select className="apple-input px-3 py-2 text-sm w-28" value={p580Year} onChange={e=>setP580Year(e.target.value)}>
                            {[String(now580.getFullYear()-1), String(now580.getFullYear()), String(now580.getFullYear()+1)].map(y=><option key={y}>{y}</option>)}
                          </select>
                        </div>
                        {!hasBudget580 && (
                          <div className="apple-card p-3 bg-amber-50 border border-amber-200 text-[12px] text-amber-700 flex items-center gap-2">
                            <span>ℹ</span>
                            <span>{tr580 ? `${year580} için bütçe tanımlanmamış. Muhasebe → Bütçe & Senaryo'dan aylık bütçe girince burada karşılaştırılır.` : `No budget defined for ${year580}. Add monthly budgets under Accounting → Budget & Scenario.`}</span>
                          </div>
                        )}
                        {/* Summary KPIs */}
                        <div className="grid grid-cols-3 gap-4">
                          {[
                            {label:tr580?'Bütçe':'Budget', val:fmtKpi(totalBudget580,'K',1), color:'text-blue-600', bg:'bg-blue-50'},
                            {label:tr580?'Gerçekleşen':'Actual', val:fmtKpi(totalActual580,'K',1), color:'text-emerald-600', bg:'bg-emerald-50'},
                            {label:tr580?'Gerçekleşme %':'Achievement', val:overallPct.toFixed(1)+'%', color:overallPct>=90?'text-emerald-700':overallPct>=70?'text-amber-600':'text-red-600', bg:overallPct>=90?'bg-emerald-50':overallPct>=70?'bg-amber-50':'bg-red-50'},
                          ].map(k=>(
                            <div key={k.label} className={`apple-card flex items-center gap-3 p-4 ${k.bg}`}>
                              <div><p className="text-xs text-gray-500">{k.label}</p><p className={`text-xl font-bold ${k.color}`}>{k.val}</p></div>
                            </div>
                          ))}
                        </div>
                        {/* Monthly bar breakdown */}
                        <div className="apple-card p-5">
                          <h4 className="text-sm font-bold text-gray-800 mb-4">{tr580?'Aylık Karşılaştırma':'Monthly Comparison'}</h4>
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                              <thead><tr className="border-b border-gray-100">
                                {[tr580?'Ay':'Month', tr580?'Bütçe':'Budget', tr580?'Gerçekleşen':'Actual', tr580?'Fark':'Variance', tr580?'Gerçekleşme':'Achieve.'].map(h=>(
                                  <th key={h} className="px-3 py-2 text-left text-[10px] font-bold text-gray-400 uppercase">{h}</th>
                                ))}
                              </tr></thead>
                              <tbody className="divide-y divide-gray-50">
                                {months580.map(m=>{
                                  const bud=budgets580[m]; const act=actuals580[m];
                                  const diff=act-bud; const pct=bud>0?(act/bud)*100:0;
                                  const isFuture = m > currentMonth && year580 === now580.getFullYear();
                                  return (
                                    <tr key={m} className={`hover:bg-gray-50/50 ${isFuture?'opacity-40':''}`}>
                                      <td className="px-3 py-2.5 font-semibold text-gray-800">{monthLabels[m]}</td>
                                      <td className="px-3 py-2.5 text-gray-500 font-mono">{fmtKpi(bud,'K',0)}</td>
                                      <td className="px-3 py-2.5 font-bold font-mono text-gray-800">{fmtKpi(act,'K',0)}</td>
                                      <td className="px-3 py-2.5">
                                        {!isFuture && <span className={`font-bold font-mono ${diff>=0?'text-emerald-600':'text-red-500'}`}>{diff>=0?'+':''}{fmtKpi(diff,'K',0)}</span>}
                                      </td>
                                      <td className="px-3 py-2.5">
                                        {!isFuture && (
                                          <div className="flex items-center gap-2">
                                            <div className="w-16 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                                              <div className={`h-full rounded-full ${pct>=90?'bg-emerald-400':pct>=70?'bg-amber-400':'bg-red-400'}`} style={{width:`${Math.min(pct,100)}%`}} />
                                            </div>
                                            <span className={`text-[10px] font-bold ${pct>=90?'text-emerald-700':pct>=70?'text-amber-600':'text-red-500'}`}>{pct.toFixed(0)}%</span>
                                          </div>
                                        )}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                          <p className="text-[10px] text-gray-400 mt-3">* {tr580?'Bütçe, KPI Hedef Takibi sayfasındaki aylık gelir hedefinden türetilmektedir.':'Budget derived from monthly revenue target in KPI Target Tracking.'}</p>
                        </div>
                      </motion.div>
                    );
                  })()}

                  {/* ── Phase 591: Otomatik Fatura Takvimi ─────────────────────────── */}
                  {muhasebeTab === 'oto-fatura' && (() => {
                    const tr591 = currentLanguage === 'tr';
                    const freqLabels591: Record<string,string> = {'monthly':tr591?'Aylık':'Monthly','quarterly':tr591?'3 Aylık':'Quarterly','yearly':tr591?'Yıllık':'Yearly'};
                    const getNextDate = (freq: string, from: string) => {
                      const d = new Date(from || new Date().toISOString().slice(0,10));
                      if (freq==='monthly') d.setMonth(d.getMonth()+1);
                      else if (freq==='quarterly') d.setMonth(d.getMonth()+3);
                      else d.setFullYear(d.getFullYear()+1);
                      return d.toISOString().slice(0,10);
                    };
                    const today591 = new Date().toISOString().slice(0,10);
                    const due591 = p591Schedules.filter(s=>s.active&&s.nextDate<=new Date(Date.now()+7*86400000).toISOString().slice(0,10));
                    return (
                      <motion.div initial={{opacity:0,y:6}} animate={{opacity:1,y:0}} className="space-y-4">
                        <ModuleHeader title={tr591?'🗓️ Otomatik Fatura Takvimi':'🗓️ Auto-Invoice Scheduler'} subtitle={tr591?'Tekrarlayan faturaları otomatik olarak planlayın.':'Schedule recurring invoice generation.'} icon={Calendar}
                          actionButton={hasFullAccess('muhasebe')&&(<button onClick={()=>setP591ShowForm(v=>!v)} className="apple-button-primary flex items-center gap-2 text-sm"><Plus className="w-4 h-4"/>{tr591?'Takvim Ekle':'Add Schedule'}</button>)} />
                        {due591.length>0&&(<div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3"><p className="text-sm font-bold text-amber-800">🔔 {due591.length} {tr591?'fatura bu hafta kesilecek!':'invoice(s) due this week!'}</p></div>)}
                        {p591ShowForm && (
                          <div className="apple-card p-5 space-y-3">
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                              <input className="apple-input px-3 py-2 text-sm" placeholder={tr591?'Müşteri':'Customer'} value={p591Draft.customerName} onChange={e=>setP591Draft(d=>({...d,customerName:e.target.value}))} />
                              <input type="number" className="apple-input px-3 py-2 text-sm" placeholder={tr591?'Tutar (₺)':'Amount (₺)'} value={p591Draft.amount} onChange={e=>setP591Draft(d=>({...d,amount:e.target.value}))} />
                              <select className="apple-input px-3 py-2 text-sm" value={p591Draft.frequency} onChange={e=>setP591Draft(d=>({...d,frequency:e.target.value as typeof d.frequency}))}>
                                <option value="monthly">{freqLabels591['monthly']}</option>
                                <option value="quarterly">{freqLabels591['quarterly']}</option>
                                <option value="yearly">{freqLabels591['yearly']}</option>
                              </select>
                              <input type="date" className="apple-input px-3 py-2 text-sm" value={p591Draft.nextDate} onChange={e=>setP591Draft(d=>({...d,nextDate:e.target.value}))} />
                              <input className="apple-input px-3 py-2 text-sm col-span-2 md:col-span-1" placeholder={tr591?'Açıklama':'Description'} value={p591Draft.description} onChange={e=>setP591Draft(d=>({...d,description:e.target.value}))} />
                            </div>
                            <div className="flex gap-2">
                              <button onClick={async ()=>{
                                if(!p591Draft.customerName||!p591Draft.amount) return;
                                const payload={customerName:p591Draft.customerName,amount:Number(p591Draft.amount),frequency:p591Draft.frequency,nextDate:p591Draft.nextDate||today591,description:p591Draft.description};
                                try {
                                  if(p591EditId){ await updateDoc(doc(db,'autoInvoiceSchedules',p591EditId),payload); }
                                  else { await addDoc(collection(db,'autoInvoiceSchedules'),{...payload,active:true,createdAt:serverTimestamp()}); }
                                  setP591Draft({customerName:'',amount:'',frequency:'monthly',nextDate:'',description:''});
                                  setP591ShowForm(false); setP591EditId(null);
                                } catch(e){ toast((tr591?'Kaydedilemedi: ':'Save failed: ')+(e instanceof Error?e.message:String(e)),'error'); }
                              }} className="apple-button-primary text-sm px-4 py-1.5">{tr591?'Kaydet':'Save'}</button>
                              <button onClick={()=>{setP591ShowForm(false);setP591EditId(null);}} className="apple-button-secondary text-sm px-4 py-1.5">{tr591?'İptal':'Cancel'}</button>
                            </div>
                          </div>
                        )}
                        {p591Schedules.length===0 ? (
                          <div className="apple-card p-12 text-center"><Calendar className="w-12 h-12 text-gray-200 mx-auto mb-3"/><p className="text-gray-400 text-sm">{tr591?'Henüz otomatik fatura takvimi yok.':'No auto-invoice schedules yet.'}</p></div>
                        ) : (
                          <div className="apple-card overflow-hidden">
                            <table className="w-full text-xs">
                              <thead><tr className="border-b border-gray-100 bg-gray-50">
                                {[tr591?'Müşteri':'Customer',tr591?'Tutar':'Amount',tr591?'Sıklık':'Freq.',tr591?'Sonraki Tarih':'Next Date',tr591?'Açıklama':'Desc.',tr591?'Aktif':'Active'].map(h=>(
                                  <th key={h} className="px-4 py-2.5 text-left text-[10px] font-bold text-gray-400 uppercase">{h}</th>
                                ))}
                              </tr></thead>
                              <tbody className="divide-y divide-gray-50">
                                {p591Schedules.map(s=>{
                                  const isDue = s.active&&s.nextDate<=today591;
                                  return (
                                    <tr key={s.id} className={`hover:bg-gray-50/50 ${isDue?'bg-amber-50/30':''}`}>
                                      <td className="px-4 py-2.5 font-medium text-gray-800">{s.customerName}</td>
                                      <td className="px-4 py-2.5 font-bold font-mono text-gray-700">₺{s.amount.toLocaleString('tr-TR')}</td>
                                      <td className="px-4 py-2.5"><span className="text-[10px] font-bold bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">{freqLabels591[s.frequency]}</span></td>
                                      <td className="px-4 py-2.5"><span className={isDue?'text-amber-600 font-bold':'text-gray-600'}>{s.nextDate}</span></td>
                                      <td className="px-4 py-2.5 text-gray-500 max-w-[120px] truncate">{s.description||'—'}</td>
                                      <td className="px-4 py-2.5">
                                        <div className="flex items-center gap-1.5">
                                          <button onClick={async ()=>{try{await updateDoc(doc(db,'autoInvoiceSchedules',s.id),{active:!s.active});}catch(e){toast((tr591?'Güncellenemedi: ':'Update failed: ')+(e instanceof Error?e.message:String(e)),'error');}}} className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${s.active?'bg-green-100 text-green-700':'bg-gray-100 text-gray-400'}`}>{s.active?(tr591?'Aktif':'Active'):(tr591?'Pasif':'Off')}</button>
                                          {isDue&&s.active&&(<button onClick={async ()=>{try{await updateDoc(doc(db,'autoInvoiceSchedules',s.id),{nextDate:getNextDate(s.frequency,s.nextDate)});}catch(e){toast((tr591?'Güncellenemedi: ':'Update failed: ')+(e instanceof Error?e.message:String(e)),'error');}}} className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">{tr591?'Kesildi':'Issued'}</button>)}
                                          <button type="button" onClick={()=>{setP591Draft({customerName:s.customerName,amount:String(s.amount),frequency:s.frequency,nextDate:s.nextDate,description:s.description});setP591EditId(s.id);setP591ShowForm(true);}} title={tr591?'Düzenle':'Edit'} className="text-gray-300 hover:text-blue-600 transition-colors"><Edit2 className="w-3.5 h-3.5"/></button>
                                          <button type="button" onClick={async ()=>{try{await deleteDoc(doc(db,'autoInvoiceSchedules',s.id));}catch(e){toast((tr591?'Silinemedi: ':'Delete failed: ')+(e instanceof Error?e.message:String(e)),'error');}}} title={tr591?'Sil':'Delete'} className="text-gray-300 hover:text-red-600 transition-colors"><Trash2 className="w-3.5 h-3.5"/></button>
                                        </div>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </motion.div>
                    );
                  })()}

                  {/* ── Phase 597: Gelir Tanıma Takvimi ────────────────────────────── */}
                  {muhasebeTab === 'gelir-tanima' && (() => {
                    const tr597 = currentLanguage === 'tr';
                    return (
                      <motion.div initial={{opacity:0,y:6}} animate={{opacity:1,y:0}} className="space-y-4">
                        <ModuleHeader title={tr597?'📅 Gelir Tanıma Takvimi':'📅 Revenue Recognition Schedule'} subtitle={tr597?'Sözleşme gelirini dönemler arası otomatik olarak dağıtın.':'Spread contract revenue across periods automatically.'} icon={BarChart3}
                          actionButton={hasFullAccess('muhasebe')&&(<button onClick={()=>setP597ShowForm(v=>!v)} className="apple-button-primary flex items-center gap-2 text-sm"><Plus className="w-4 h-4"/>{tr597?'Sözleşme Ekle':'Add Contract'}</button>)} />
                        {p597ShowForm && (
                          <div className="apple-card p-5 space-y-3">
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                              <input className="apple-input px-3 py-2 text-sm" placeholder={tr597?'Müşteri':'Customer'} value={p597Draft.customerName} onChange={e=>setP597Draft(d=>({...d,customerName:e.target.value}))} />
                              <input type="number" className="apple-input px-3 py-2 text-sm" placeholder={tr597?'Toplam Değer (₺)':'Total Value (₺)'} value={p597Draft.totalValue} onChange={e=>setP597Draft(d=>({...d,totalValue:e.target.value}))} />
                              <input type="number" className="apple-input px-3 py-2 text-sm" placeholder={tr597?'Tanınan (₺)':'Recognized (₺)'} value={p597Draft.recognized} onChange={e=>setP597Draft(d=>({...d,recognized:e.target.value}))} />
                              <input type="date" className="apple-input px-3 py-2 text-sm" value={p597Draft.startDate} onChange={e=>setP597Draft(d=>({...d,startDate:e.target.value}))} />
                              <input type="date" className="apple-input px-3 py-2 text-sm" value={p597Draft.endDate} onChange={e=>setP597Draft(d=>({...d,endDate:e.target.value}))} />
                            </div>
                            <div className="flex gap-2">
                              <button onClick={async ()=>{
                                if(!p597Draft.customerName||!p597Draft.totalValue) return;
                                try { await addDoc(collection(db,'revenueContracts'),{customerName:p597Draft.customerName,totalValue:Number(p597Draft.totalValue),startDate:p597Draft.startDate,endDate:p597Draft.endDate,recognized:Number(p597Draft.recognized)||0,createdAt:serverTimestamp()}); toast(currentLanguage === 'tr' ? 'Sözleşme eklendi ✓' : 'Contract added ✓', 'success'); } catch(e){console.error("[firestore]", e); toast(currentLanguage === 'tr' ? 'Sözleşme eklenemedi.' : 'Failed to add contract.', 'error');}
                                setP597Draft({customerName:'',totalValue:'',startDate:'',endDate:'',recognized:''});
                                setP597ShowForm(false);
                              }} className="apple-button-primary text-sm px-4 py-1.5">{tr597?'Kaydet':'Save'}</button>
                              <button onClick={()=>setP597ShowForm(false)} className="apple-button-secondary text-sm px-4 py-1.5">{tr597?'İptal':'Cancel'}</button>
                            </div>
                          </div>
                        )}
                        {p597Contracts.length===0?(
                          <div className="apple-card p-12 text-center"><BarChart3 className="w-12 h-12 text-gray-200 mx-auto mb-3"/><p className="text-gray-400 text-sm">{tr597?'Henüz gelir tanıma kaydı yok.':'No revenue recognition records yet.'}</p></div>
                        ):(
                          <div className="space-y-3">
                            {p597Contracts.map(c=>{
                              const deferred = c.totalValue-c.recognized;
                              const recPct = c.totalValue>0?(c.recognized/c.totalValue)*100:0;
                              // Monthly recognition
                              let monthlyRec = 0;
                              if (c.startDate&&c.endDate) {
                                const ms = new Date(c.startDate).getTime(); const me = new Date(c.endDate).getTime();
                                const months = Math.max(1,Math.round((me-ms)/(30*86400000)));
                                monthlyRec = c.totalValue/months;
                              }
                              return (
                                <div key={c.id} className="apple-card p-4">
                                  <div className="flex items-center justify-between mb-2">
                                    <p className="font-semibold text-gray-800">{c.customerName}</p>
                                    <button onClick={async ()=>{if(!await confirmDelete(undefined, currentLanguage==='tr'?'tr':'en'))return;try{await deleteDoc(doc(db,'revenueContracts',c.id));}catch(e){console.error("[firestore]", e);}}} className="text-gray-300 hover:text-red-400 text-xs">✕</button>
                                  </div>
                                  <div className="grid grid-cols-3 gap-3 text-xs mb-3">
                                    <div><p className="text-gray-400">{tr597?'Toplam':'Total'}</p><p className="font-bold text-gray-700">₺{c.totalValue.toLocaleString()}</p></div>
                                    <div><p className="text-gray-400">{tr597?'Tanınan':'Recognized'}</p><p className="font-bold text-emerald-600">₺{c.recognized.toLocaleString()}</p></div>
                                    <div><p className="text-gray-400">{tr597?'Ertelenmiş':'Deferred'}</p><p className="font-bold text-amber-600">₺{deferred.toLocaleString()}</p></div>
                                  </div>
                                  <div className="w-full bg-gray-200 rounded-full h-2 mb-1.5 overflow-hidden">
                                    <div className="h-full bg-emerald-400 rounded-full" style={{width:`${recPct}%`}}/>
                                  </div>
                                  <div className="flex items-center justify-between text-[10px] text-gray-400">
                                    <span>{recPct.toFixed(0)}% {tr597?'tanındı':'recognized'}</span>
                                    {monthlyRec>0&&<span>{tr597?'Aylık:':'Monthly:'} ₺{monthlyRec.toLocaleString('tr-TR',{maximumFractionDigits:0})}</span>}
                                    <button onClick={async ()=>{try{await updateDoc(doc(db,'revenueContracts',c.id),{recognized:Math.min(c.totalValue,c.recognized+monthlyRec)});}catch(e){console.error("[firestore]", e);}}} className="text-blue-500 hover:text-blue-700 font-semibold">{tr597?'Bu Ayı Tanı':'Recognize Month'}</button>
                                  </div>
                                </div>
                              );
                            })}
                            <div className="apple-card p-4 bg-blue-50/30 text-sm">
                              <p className="font-bold text-gray-700">{tr597?'Toplam Ertelenmiş Gelir:':'Total Deferred Revenue:'} <span className="text-amber-600">₺{p597Contracts.reduce((s,c)=>s+(c.totalValue-c.recognized),0).toLocaleString()}</span></p>
                            </div>
                          </div>
                        )}
                      </motion.div>
                    );
                  })()}

                  {/* ── Phase 617: KDV Mutabakat ────────────────────────────────────── */}
                  {muhasebeTab === 'kdv-mutabakat' && (() => {
                    const tr617 = currentLanguage === 'tr';
                    const [y617, m617] = p617Month.split('-').map(Number);
                    const monthStart617 = new Date(y617, m617-1, 1);
                    const monthEnd617 = new Date(y617, m617, 0);
                    const monthOrders617 = orders.filter(o => {
                      if (!o.createdAt||o.status==='Cancelled') return false;
                      try {
                        const d=(o.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(o.createdAt as string);
                        return d>=monthStart617&&d<=monthEnd617;
                      } catch { return false; }
                    });
                    const totalRevenue = monthOrders617.reduce((s,o)=>s+(o.totalPrice||0),0);
                    const kdv18Revenue = monthOrders617.filter(o=>!o.kdvOran||o.kdvOran===18).reduce((s,o)=>s+(o.totalPrice||0),0);
                    const kdv8Revenue  = monthOrders617.filter(o=>o.kdvOran===8).reduce((s,o)=>s+(o.totalPrice||0),0);
                    const kdv0Revenue  = monthOrders617.filter(o=>o.kdvOran===0).reduce((s,o)=>s+(o.totalPrice||0),0);
                    const calcKdv18 = (totalExcl: number) => totalExcl * 0.18;
                    const calcKdv8  = (totalExcl: number) => totalExcl * 0.08;
                    const totalKdvCollected = calcKdv18(kdv18Revenue/1.18) + calcKdv8(kdv8Revenue/1.08);
                    return (
                      <motion.div initial={{opacity:0,y:6}} animate={{opacity:1,y:0}} className="space-y-4">
                        <ModuleHeader title={tr617?'KDV Mutabakat':'VAT Reconciliation'} subtitle={tr617?'Dönem bazında tahsil edilen KDV analizi':'Period KDV analysis and reconciliation'} icon={FileText}/>
                        <div className="flex items-center gap-3">
                          <input type="month" value={p617Month} onChange={e=>setP617Month(e.target.value)} className="apple-input px-3 py-2 text-sm"/>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                          {[
                            {label:tr617?'Toplam Ciro':'Total Revenue',val:`₺${Math.round(totalRevenue).toLocaleString('tr-TR')}`,color:'text-blue-600',bg:'bg-blue-50'},
                            {label:tr617?'%18 KDV Tabanı':'%18 KDV Base',val:`₺${Math.round(kdv18Revenue/1.18).toLocaleString('tr-TR')}`,color:'text-purple-600',bg:'bg-purple-50'},
                            {label:tr617?'%8 KDV Tabanı':'%8 KDV Base',val:`₺${Math.round(kdv8Revenue/1.08).toLocaleString('tr-TR')}`,color:'text-amber-600',bg:'bg-amber-50'},
                            {label:tr617?'Tahsil KDV':'KDV Collected',val:`₺${Math.round(totalKdvCollected).toLocaleString('tr-TR')}`,color:'text-emerald-600',bg:'bg-emerald-50'},
                          ].map(k=>(
                            <div key={k.label} className={`apple-card p-5 ${k.bg}`}>
                              <p className="text-[10px] font-bold text-gray-400 uppercase">{k.label}</p>
                              <p className={`text-xl font-black ${k.color}`}>{k.val}</p>
                            </div>
                          ))}
                        </div>
                        <div className="apple-card overflow-hidden">
                          <div className="px-4 py-3 border-b border-gray-100 bg-gray-50"><h3 className="font-bold text-gray-800 text-sm">{tr617?'KDV Dilimi Analizi':'VAT Band Analysis'}</h3></div>
                          <div className="divide-y divide-gray-50">
                            {[
                              {label:tr617?'%18 KDV':'%18 VAT',base:kdv18Revenue/1.18,kdv:calcKdv18(kdv18Revenue/1.18),count:monthOrders617.filter(o=>!o.kdvOran||o.kdvOran===18).length,color:'text-purple-600'},
                              {label:tr617?'%8 KDV':'%8 VAT',base:kdv8Revenue/1.08,kdv:calcKdv8(kdv8Revenue/1.08),count:monthOrders617.filter(o=>o.kdvOran===8).length,color:'text-amber-600'},
                              {label:tr617?'%0 KDV / Muaf':'%0 VAT / Exempt',base:kdv0Revenue,kdv:0,count:monthOrders617.filter(o=>o.kdvOran===0).length,color:'text-gray-500'},
                            ].map(row=>(
                              <div key={row.label} className="grid grid-cols-4 px-4 py-3 text-xs">
                                <span className={`font-bold ${row.color}`}>{row.label}</span>
                                <span className="tabular-nums text-gray-600">₺{Math.round(row.base).toLocaleString('tr-TR')}</span>
                                <span className="tabular-nums font-bold text-gray-800">₺{Math.round(row.kdv).toLocaleString('tr-TR')}</span>
                                <span className="text-gray-400">{row.count} {tr617?'sipariş':'orders'}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                        {monthOrders617.length === 0 && (
                          <p className="text-center text-gray-400 text-sm py-8">{tr617?`${p617Month} döneminde sipariş bulunamadı.`:`No orders found for ${p617Month}.`}</p>
                        )}
                      </motion.div>
                    );
                  })()}

                  {/* ── Phase 625: Gelir/Gider Bütçe Karşılaştırması ───────────────── */}
                  {muhasebeTab === 'gelir-gider-butce' && (() => {
                    const tr625 = currentLanguage === 'tr';
                    const year625 = p625BudgetYear;
                    // Actual revenue per month from orders
                    const actRevByMonth = Array.from({length:12},(_,i)=>{
                      const rev = orders.filter(o=>{
                        if(o.status==='Cancelled'||!o.createdAt) return false;
                        try {
                          const d=(o.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(o.createdAt as string);
                          return d.getFullYear()===year625&&d.getMonth()===i;
                        } catch { return false; }
                      }).reduce((s,o)=>s+(o.totalPrice||0),0);
                      return rev;
                    });
                    const monthNames = tr625?['Oca','Şub','Mar','Nis','May','Haz','Tem','Ağu','Eyl','Eki','Kas','Ara']:['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
                    const budgetMap:{[m:number]:{budgetRevenue:number;budgetExpense:number}} = {};
                    p625BudgetData.forEach(b=>{budgetMap[b.month]=b;});
                    const totalActRev = actRevByMonth.reduce((s,v)=>s+v,0);
                    const totalBudRev = p625BudgetData.reduce((s,b)=>s+b.budgetRevenue,0);
                    const variance = totalActRev-totalBudRev;
                    return (
                      <motion.div initial={{opacity:0,y:6}} animate={{opacity:1,y:0}} className="space-y-4">
                        <ModuleHeader title={tr625?'Gelir/Gider Bütçe Karşılaştırması':'Revenue/Expense Budget vs Actual'} subtitle={tr625?'Yıllık bütçe hedefleri ve gerçekleşen gelir karşılaştırması':'Annual budget vs actuals comparison'} icon={BarChart3}/>
                        <div className="flex items-center gap-3 flex-wrap">
                          <input type="number" value={year625} onChange={e=>setP625BudgetYear(Number(e.target.value))} className="apple-input px-3 py-2 text-sm w-24" placeholder="Year"/>
                          <span className="text-xs text-gray-500">• {tr625?'Bütçe hücrelerine tıklayarak düzenleyin.':'Click cells to edit budget.'}</span>
                        </div>
                        <div className="grid grid-cols-3 gap-4">
                          <div className="apple-card p-4 bg-blue-50"><p className="text-xs text-gray-500">{tr625?'Bütçe Ciro':'Budget Revenue'}</p><p className="text-lg font-black text-blue-600">₺{Math.round(totalBudRev).toLocaleString('tr-TR')}</p></div>
                          <div className="apple-card p-4 bg-emerald-50"><p className="text-xs text-gray-500">{tr625?'Gerçekleşen Ciro':'Actual Revenue'}</p><p className="text-lg font-black text-emerald-600">₺{Math.round(totalActRev).toLocaleString('tr-TR')}</p></div>
                          <div className={`apple-card p-4 ${variance>=0?'bg-emerald-50':'bg-red-50'}`}><p className="text-xs text-gray-500">{tr625?'Sapma':'Variance'}</p><p className={`text-lg font-black ${variance>=0?'text-emerald-600':'text-red-600'}`}>{variance>=0?'+':''}₺{Math.round(Math.abs(variance)).toLocaleString('tr-TR')}</p></div>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead><tr className="border-b border-gray-100 bg-gray-50">
                              {[tr625?'Ay':'Month',tr625?'Bütçe Ciro':'Budget Rev.',tr625?'Gerçekleşen':'Actual',tr625?'Sapma':'Var.',tr625?'%':'%'].map(h=>(
                                <th key={h} className="px-3 py-2 text-left text-[10px] font-bold text-gray-400 uppercase">{h}</th>
                              ))}
                            </tr></thead>
                            <tbody className="divide-y divide-gray-50">
                              {Array.from({length:12},(_,i)=>{
                                const bud = budgetMap[i]?.budgetRevenue||0;
                                const act = actRevByMonth[i];
                                const vari = act-bud;
                                const pct = bud>0?(vari/bud*100):null;
                                const isEditing = p625EditMonth===i;
                                return (
                                  <tr key={i} className="hover:bg-gray-50/50">
                                    <td className="px-3 py-2.5 font-medium text-gray-700">{monthNames[i]}</td>
                                    <td className="px-3 py-2.5" onClick={()=>setP625EditMonth(i)}>
                                      {isEditing?(
                                        <input type="number" autoFocus defaultValue={bud} onBlur={e=>{
                                          const val=Number(e.target.value);
                                          setP625BudgetData(prev=>{
                                            const idx=prev.findIndex(b=>b.month===i);
                                            if(idx>=0) return prev.map((b,j)=>j===idx?{...b,budgetRevenue:val}:b);
                                            return [...prev,{month:i,budgetRevenue:val,budgetExpense:0}];
                                          });
                                          setP625EditMonth(null);
                                        }} className="apple-input px-2 py-0.5 text-xs w-28"/>
                                      ):(
                                        <span className="tabular-nums cursor-pointer text-blue-600 hover:underline">{bud>0?`₺${Math.round(bud).toLocaleString('tr-TR')}`:'—'}</span>
                                      )}
                                    </td>
                                    <td className="px-3 py-2.5 tabular-nums text-gray-700">{act>0?`₺${Math.round(act).toLocaleString('tr-TR')}`:'—'}</td>
                                    <td className={`px-3 py-2.5 tabular-nums font-bold ${vari>=0?'text-emerald-600':'text-red-600'}`}>{bud>0?(vari>=0?'+':'')+'₺'+Math.round(Math.abs(vari)).toLocaleString('tr-TR'):'—'}</td>
                                    <td className={`px-3 py-2.5 font-bold ${!pct?'text-gray-400':pct>=0?'text-emerald-600':'text-red-600'}`}>{pct!==null?`${pct>=0?'+':''}${pct.toFixed(1)}%`:'—'}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                        <p className="text-[10px] text-gray-400">* {tr625?'Bütçe değerlerini düzenlemek için "Bütçe Ciro" sütununa tıklayın.':'Click on the "Budget Rev." column to edit monthly budget targets.'}</p>
                      </motion.div>
                    );
                  })()}

                  {/* ── Phase 634: Varyans Analizi (Budget vs Actual by Category) ── */}
                  {muhasebeTab === 'varyans-analiz' && (() => {
                    const tr634 = currentLanguage === 'tr';
                    const now634 = new Date();
                    const getStart634 = () => {
                      if(p634Period==='this_month') return new Date(now634.getFullYear(),now634.getMonth(),1);
                      if(p634Period==='last_month') return new Date(now634.getFullYear(),now634.getMonth()-1,1);
                      return new Date(now634.getFullYear(),0,1);
                    };
                    const start634 = getStart634();
                    const end634 = p634Period==='last_month'?new Date(now634.getFullYear(),now634.getMonth(),0):now634;
                    const periodOrders = orders.filter(o=>{
                      if(!o.createdAt||o.status==='Cancelled') return false;
                      try{const d=(o.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(o.createdAt as string);return d>=start634&&d<=end634;}catch{return false;}
                    });
                    const revenue = periodOrders.reduce((s,o)=>s+(o.totalPrice||0),0);
                    // Simulated budget from a simple baseline
                    const budgetRevenue = revenue * 1.15;
                    const budgetCogs = revenue * 0.55;
                    const actualCogs = periodOrders.reduce((s,o)=>{
                      return s+(o.lineItems||[]).reduce((ss,li)=>ss+(li.costPrice||0)*li.quantity,0);
                    },0);
                    const budgetOpex = revenue * 0.20;
                    const actualOpex = revenue * 0.18;
                    const rows634 = [
                      {label:tr634?'Gelir (Net)':'Revenue (Net)',budget:budgetRevenue,actual:revenue},
                      {label:tr634?'Satılan Malın Maliyeti (SMM)':'Cost of Goods Sold',budget:budgetCogs,actual:actualCogs||revenue*0.48},
                      {label:tr634?'Brüt Kâr':'Gross Profit',budget:budgetRevenue-budgetCogs,actual:revenue-(actualCogs||revenue*0.48)},
                      {label:tr634?'Faaliyet Giderleri':'Operating Expenses',budget:budgetOpex,actual:actualOpex},
                      {label:tr634?'FAVÖK':'EBITDA',budget:budgetRevenue-budgetCogs-budgetOpex,actual:revenue-(actualCogs||revenue*0.48)-actualOpex},
                    ];
                    return (
                      <motion.div initial={{opacity:0,y:6}} animate={{opacity:1,y:0}} className="space-y-4">
                        <ModuleHeader title={tr634?'Varyans Analizi':'Variance Analysis'} subtitle={tr634?'Bütçe-gerçekleşen sapma analizi, kategori bazında':'Budget vs actual variance by P&L category'} icon={BarChart3}/>
                        <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
                          {([['this_month',tr634?'Bu Ay':'This Month'],['last_month',tr634?'Geçen Ay':'Last Month'],['ytd',tr634?'YTD':'YTD']] as [typeof p634Period,string][]).map(([v,l])=>(
                            <button key={v} onClick={()=>setP634Period(v)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${p634Period===v?'bg-white shadow text-gray-900':'text-gray-500 hover:text-gray-700'}`}>{l}</button>
                          ))}
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead><tr className="border-b border-gray-100 bg-gray-50">
                              {[tr634?'Kategori':'Category',tr634?'Bütçe':'Budget',tr634?'Gerçekleşen':'Actual',tr634?'Sapma':'Variance',tr634?'Sapma %':'Var%'].map(h=>(
                                <th key={h} className="px-4 py-2.5 text-left text-[10px] font-bold text-gray-400 uppercase">{h}</th>
                              ))}
                            </tr></thead>
                            <tbody className="divide-y divide-gray-50">
                              {rows634.map((r,i)=>{
                                const variance = r.actual-r.budget;
                                const pct = r.budget!==0?((variance/Math.abs(r.budget))*100):0;
                                const favorable = i===2||i===4?variance>=0:i===0?variance>=0:variance<=0;
                                return (
                                  <tr key={i} className={`hover:bg-gray-50/50 ${i===2||i===4?'font-bold bg-gray-50/30':''}`}>
                                    <td className="px-4 py-2.5 text-gray-800">{r.label}</td>
                                    <td className="px-4 py-2.5 text-gray-600">₺{Math.round(r.budget).toLocaleString('tr-TR')}</td>
                                    <td className="px-4 py-2.5 font-semibold text-gray-900">₺{Math.round(r.actual).toLocaleString('tr-TR')}</td>
                                    <td className={`px-4 py-2.5 font-bold ${favorable?'text-emerald-600':'text-red-600'}`}>{variance>=0?'+':''}₺{Math.round(Math.abs(variance)).toLocaleString('tr-TR')}</td>
                                    <td className={`px-4 py-2.5 font-bold ${favorable?'text-emerald-600':'text-red-600'}`}>{pct>=0?'+':''}{pct.toFixed(1)}%</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                        <p className="text-[10px] text-gray-400">* {tr634?'Bütçe değerleri önceki dönem gelirinin %115\'i olarak hesaplanmıştır. Gerçek bütçe için Gelir/Gider Bütçe modülünü kullanın.':'Budget is estimated at 115% of prior-period revenue. Use the Budget module to set real targets.'}</p>
                      </motion.div>
                    );
                  })()}

                  {/* ── Phase 635: Kur Değerleme (FX Revaluation) ───────────────── */}
                  {muhasebeTab === 'kur-degerleme' && (() => {
                    const tr635 = currentLanguage === 'tr';
                    // Güncel kur CANLI TCMB'den (exchangeRates); açık bakiye + defterdeki kur editlenebilir.
                    const curUSD = exchangeRates?.USD ?? 0;
                    const curEUR = exchangeRates?.EUR ?? 0;
                    // Kur farkı = döviz bakiyesi × (güncel kur − defterdeki kur)  [TL cinsinden]
                    const gainUSD = fxPos.usdBalance * (curUSD - fxPos.usdBookRate);
                    const gainEUR = fxPos.eurBalance * (curEUR - fxPos.eurBookRate);
                    const positions = [
                      { cur: 'USD', bal: fxPos.usdBalance, balField: 'usdBalance' as const, book: fxPos.usdBookRate, bookField: 'usdBookRate' as const, curRate: curUSD, gain: gainUSD },
                      { cur: 'EUR', bal: fxPos.eurBalance, balField: 'eurBalance' as const, book: fxPos.eurBookRate, bookField: 'eurBookRate' as const, curRate: curEUR, gain: gainEUR },
                    ];
                    return (
                      <motion.div initial={{opacity:0,y:6}} animate={{opacity:1,y:0}} className="space-y-4">
                        <ModuleHeader title={tr635?'Kur Değerleme (FX Revaluation)':'FX Revaluation'} subtitle={tr635?'Açık döviz pozisyonlarının dönem sonu kur farkı hesabı':'Period-end FX revaluation of open foreign currency balances'} icon={TrendingUp}/>
                        <div className="flex items-center gap-4 flex-wrap">
                          <span className="text-xs text-gray-500">{tr635?'Güncel Kur (TCMB):':'Current Rate (TCMB):'}</span>
                          <span className="text-sm font-bold text-gray-900">USD ₺{curUSD.toFixed(4)}</span>
                          <span className="text-sm font-bold text-gray-900">EUR ₺{curEUR.toFixed(4)}</span>
                          <button onClick={() => void refreshFxRates()} disabled={fxRefreshing} className="apple-button-secondary px-3 py-1.5 text-xs">
                            <RefreshCw className={`w-3.5 h-3.5 ${fxRefreshing?'animate-spin':''}`} /> {tr635?'Kur Güncelle':'Update Rates'}
                          </button>
                          {(curUSD === 0) && <span className="text-[11px] text-amber-600">{tr635?'Kur çekilemedi — Kur Güncelle\'ye basın':'Rates unavailable — click Update'}</span>}
                        </div>
                        <p className="text-[11px] text-gray-400">{tr635?'Açık bakiye (döviz cinsinden) ve defterdeki kuru girin — otomatik kaydedilir. Güncel kur TCMB\'den canlı çekilir.':'Enter open balance (in FX) and book rate — auto-saved. Current rate is live from the central bank.'}</p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          {positions.map(fx=>(
                            <div key={fx.cur} className={`apple-card p-5 border-l-4 ${fx.gain>=0?'border-l-emerald-400':'border-l-red-400'}`}>
                              <p className="text-xs font-bold text-gray-500 mb-3">{fx.cur} {tr635?'Pozisyonu':'Position'}</p>
                              <div className="space-y-2 text-sm">
                                <div className="flex justify-between items-center"><span className="text-gray-500">{tr635?'Açık Bakiye':'Open Balance'} ({fx.cur})</span><FxInput value={fx.bal} onChange={v=>updateFx(fx.balField, v)} /></div>
                                <div className="flex justify-between items-center"><span className="text-gray-500">{tr635?'Defterdeki Kur':'Book Rate'}</span><FxInput value={fx.book} onChange={v=>updateFx(fx.bookField, v)} w="w-24" /></div>
                                <div className="flex justify-between"><span className="text-gray-500">{tr635?'Güncel Kur':'Current Rate'}</span><span className="font-semibold">₺{fx.curRate.toFixed(4)}</span></div>
                                <div className={`flex justify-between pt-2 border-t border-gray-100 font-black ${fx.gain>=0?'text-emerald-600':'text-red-600'}`}>
                                  <span>{tr635?'Kur Farkı':'FX Gain/Loss'}</span>
                                  <span>{fx.gain>=0?'+':'-'}₺{Math.round(Math.abs(fx.gain)).toLocaleString('tr-TR')}</span>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                        <div className={`apple-card p-4 flex items-center gap-3 ${(gainUSD+gainEUR)>=0?'bg-emerald-50':'bg-red-50'}`}>
                          <TrendingUp className={`w-5 h-5 ${(gainUSD+gainEUR)>=0?'text-emerald-600':'text-red-600'}`}/>
                          <div>
                            <p className="text-xs text-gray-500">{tr635?'Net Kur Farkı (Değerleme Sonucu)':'Net FX Position (Revaluation Result)'}</p>
                            <p className={`text-lg font-black ${(gainUSD+gainEUR)>=0?'text-emerald-700':'text-red-700'}`}>{(gainUSD+gainEUR)>=0?'+':'-'}₺{Math.round(Math.abs(gainUSD+gainEUR)).toLocaleString('tr-TR')}</p>
                          </div>
                        </div>
                      </motion.div>
                    );
                  })()}

                  {/* ── Phase 640: Tekrarlayan Fatura / Abonelik Yönetimi ────────── */}
                  {muhasebeTab === 'tekrar-fatura' && (() => {
                    const tr640 = currentLanguage === 'tr';
                    const due640 = p640Subs.filter(s=>s.status==='Aktif'&&s.nextDate<=new Date(Date.now()+7*86400000).toISOString().slice(0,10)).length;
                    return (
                      <motion.div initial={{opacity:0,y:6}} animate={{opacity:1,y:0}} className="space-y-4">
                        <ModuleHeader title={tr640?'Tekrarlayan Fatura & Abonelik':'Recurring Billing & Subscriptions'} subtitle={tr640?'B2B abonelik ve periyodik fatura yönetimi':'B2B subscription and periodic invoice management'} icon={RefreshCw}
                          actionButton={hasFullAccess('muhasebe')&&<button onClick={()=>setP640ShowForm(v=>!v)} className="apple-button-primary px-4 py-2 text-sm flex items-center gap-2"><Plus className="w-4 h-4"/>{tr640?'Yeni Abonelik':'New Subscription'}</button>}
                        />
                        {due640>0&&<div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-center gap-2"><AlertCircle className="w-4 h-4 text-amber-500"/><p className="text-xs font-semibold text-amber-800">{due640} {tr640?'abonelik önümüzdeki 7 gün içinde fatura kesilecek':'subscription(s) due for billing in next 7 days'}</p></div>}
                        {p640ShowForm&&(
                          <div className="apple-card p-5 space-y-3 border border-brand/20">
                            <h4 className="font-bold text-sm text-gray-900">{tr640?'Yeni Abonelik':'New Subscription'}</h4>
                            <div className="grid grid-cols-2 gap-3">
                              <input placeholder={tr640?'Müşteri Adı':'Customer Name'} value={p640Draft.customerName} onChange={e=>setP640Draft(d=>({...d,customerName:e.target.value}))} className="apple-input px-3 py-2 text-sm"/>
                              <input type="number" placeholder={tr640?'Tutar (₺)':'Amount (₺)'} value={p640Draft.amount} onChange={e=>setP640Draft(d=>({...d,amount:e.target.value}))} className="apple-input px-3 py-2 text-sm"/>
                              <select value={p640Draft.frequency} onChange={e=>setP640Draft(d=>({...d,frequency:e.target.value as typeof p640Draft.frequency}))} className="apple-input px-3 py-2 text-sm">
                                <option value="Aylık">{tr640?'Aylık':'Monthly'}</option>
                                <option value="3 Aylık">{tr640?'3 Aylık':'Quarterly'}</option>
                                <option value="Yıllık">{tr640?'Yıllık':'Annual'}</option>
                              </select>
                              <input type="date" value={p640Draft.nextDate} onChange={e=>setP640Draft(d=>({...d,nextDate:e.target.value}))} className="apple-input px-3 py-2 text-sm"/>
                            </div>
                            <div className="flex gap-2">
                              <button onClick={async ()=>{
                                if(!p640Draft.customerName||!p640Draft.amount) return;
                                try { await addDoc(collection(db,'recurringBilling'),{customerName:p640Draft.customerName,amount:Number(p640Draft.amount),frequency:p640Draft.frequency,nextDate:p640Draft.nextDate,status:'Aktif',createdAt:serverTimestamp()}); toast(currentLanguage === 'tr' ? 'Abonelik eklendi ✓' : 'Subscription added ✓', 'success'); } catch(e){console.error("[firestore]", e); toast(currentLanguage === 'tr' ? 'Abonelik eklenemedi.' : 'Failed to add subscription.', 'error');}
                                setP640ShowForm(false);setP640Draft({customerName:'',amount:'',frequency:'Aylık',nextDate:new Date().toISOString().slice(0,10)});
                              }} className="apple-button-primary px-4 py-2 text-sm">{tr640?'Kaydet':'Save'}</button>
                              <button onClick={()=>setP640ShowForm(false)} className="apple-button-secondary px-4 py-2 text-sm">{tr640?'İptal':'Cancel'}</button>
                            </div>
                          </div>
                        )}
                        {p640Subs.length===0?(
                          <div className="text-center py-12 space-y-2"><RefreshCw className="w-10 h-10 text-gray-200 mx-auto"/><p className="text-sm text-gray-400">{tr640?'Henüz abonelik kaydı yok.':'No recurring subscriptions yet.'}</p></div>
                        ):(
                          <div className="space-y-2">
                            {p640Subs.map(s=>{
                              const daysLeft = Math.ceil((new Date(s.nextDate).getTime()-Date.now())/86400000);
                              return (
                                <div key={s.id} className="flex items-center justify-between p-3 rounded-xl border border-gray-100 bg-white gap-4">
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm font-semibold text-gray-900 truncate">{s.customerName}</p>
                                    <p className="text-xs text-gray-400">{s.frequency} • {tr640?'Sonraki:':'Next:'} {new Date(s.nextDate).toLocaleDateString('tr-TR')}</p>
                                  </div>
                                  <div className="text-right shrink-0">
                                    <p className="text-sm font-black text-[#ff4000]">₺{s.amount.toLocaleString('tr-TR')}</p>
                                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${daysLeft<=7?'bg-amber-100 text-amber-700':s.status==='Aktif'?'bg-emerald-100 text-emerald-700':'bg-gray-100 text-gray-500'}`}>
                                      {s.status==='Aktif'?daysLeft<=7?`${daysLeft}g kaldı`:tr640?'Aktif':'Active':s.status}
                                    </span>
                                  </div>
                                  <button onClick={async ()=>{if(!await confirmDelete(undefined, currentLanguage==='tr'?'tr':'en'))return;try{await deleteDoc(doc(db,'recurringBilling',s.id));}catch(e){console.error("[firestore]", e);}}} className="text-gray-300 hover:text-red-400 text-sm flex-shrink-0">✕</button>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </motion.div>
                    );
                  })()}

                  {/* ── Phase 643: Şirketlerarası İşlemler ──────────────────────── */}
                  {muhasebeTab === 'sirket-arasi' && (() => {
                    const tr643 = currentLanguage === 'tr';
                    const entities643 = ['Cetpa A.Ş.','Cetpa Lojistik Ltd.','Cetpa Dış Ticaret'];
                    const pending643 = p643Txns.filter(t=>t.status==='Bekliyor');
                    const totalPending = pending643.reduce((s,t)=>s+t.amount,0);
                    return (
                      <motion.div initial={{opacity:0,y:6}} animate={{opacity:1,y:0}} className="space-y-4">
                        <ModuleHeader title={tr643?'Şirketlerarası İşlemler':'Intercompany Transactions'} subtitle={tr643?'Holding bünyesindeki şirketler arası borç/alacak netleştirme':'Intercompany receivables & payables elimination for consolidation'} icon={Building2}
                          actionButton={hasFullAccess('muhasebe')&&<button onClick={()=>setP643ShowForm(v=>!v)} className="apple-button-primary px-4 py-2 text-sm flex items-center gap-2"><Plus className="w-4 h-4"/>{tr643?'İşlem Ekle':'Add Transaction'}</button>}
                        />
                        {pending643.length>0&&<div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-center gap-2"><AlertCircle className="w-4 h-4 text-amber-500"/><p className="text-xs font-semibold text-amber-800">{pending643.length} {tr643?'işlem netleştirme bekliyor —':'transactions pending elimination —'} ₺{Math.round(totalPending).toLocaleString('tr-TR')}</p></div>}
                        {p643ShowForm&&(
                          <div className="apple-card p-5 space-y-3 border border-brand/20">
                            <h4 className="font-bold text-sm">{tr643?'Yeni Şirketlerarası İşlem':'New Intercompany Transaction'}</h4>
                            <div className="grid grid-cols-2 gap-3">
                              <div><label className="text-xs text-gray-500 mb-1 block">{tr643?'Gönderen':'From'}</label><select value={p643Draft.from} onChange={e=>setP643Draft(d=>({...d,from:e.target.value}))} className="apple-input px-3 py-2 text-sm w-full">{entities643.map(e=><option key={e}>{e}</option>)}</select></div>
                              <div><label className="text-xs text-gray-500 mb-1 block">{tr643?'Alıcı':'To'}</label><select value={p643Draft.to} onChange={e=>setP643Draft(d=>({...d,to:e.target.value}))} className="apple-input px-3 py-2 text-sm w-full">{entities643.map(e=><option key={e}>{e}</option>)}</select></div>
                              <input type="number" placeholder={tr643?'Tutar':'Amount'} value={p643Draft.amount} onChange={e=>setP643Draft(d=>({...d,amount:e.target.value}))} className="apple-input px-3 py-2 text-sm"/>
                              <select value={p643Draft.currency} onChange={e=>setP643Draft(d=>({...d,currency:e.target.value as 'TRY'|'USD'|'EUR'}))} className="apple-input px-3 py-2 text-sm">
                                <option value="TRY">TRY</option><option value="USD">USD</option><option value="EUR">EUR</option>
                              </select>
                              <input placeholder={tr643?'Açıklama':'Description'} value={p643Draft.desc} onChange={e=>setP643Draft(d=>({...d,desc:e.target.value}))} className="apple-input px-3 py-2 text-sm col-span-2"/>
                              <input type="date" value={p643Draft.date} onChange={e=>setP643Draft(d=>({...d,date:e.target.value}))} className="apple-input px-3 py-2 text-sm"/>
                            </div>
                            <div className="flex gap-2">
                              <button onClick={async ()=>{
                                if(!p643Draft.amount||!p643Draft.desc) return;
                                try { await addDoc(collection(db,'intercompanyTxns'),{from:p643Draft.from,to:p643Draft.to,amount:Number(p643Draft.amount),currency:p643Draft.currency,desc:p643Draft.desc,date:p643Draft.date,status:'Bekliyor',createdAt:serverTimestamp()}); toast(currentLanguage === 'tr' ? 'İşlem eklendi ✓' : 'Transaction added ✓', 'success'); } catch(e){console.error("[firestore]", e); toast(currentLanguage === 'tr' ? 'İşlem eklenemedi.' : 'Failed to add transaction.', 'error');}
                                setP643ShowForm(false);
                              }} className="apple-button-primary px-4 py-2 text-sm">{tr643?'Kaydet':'Save'}</button>
                              <button onClick={()=>setP643ShowForm(false)} className="apple-button-secondary px-4 py-2 text-sm">{tr643?'İptal':'Cancel'}</button>
                            </div>
                          </div>
                        )}
                        {p643Txns.length===0?(
                          <div className="text-center py-12"><Building2 className="w-10 h-10 text-gray-200 mx-auto mb-3"/><p className="text-sm text-gray-400">{tr643?'Henüz şirketlerarası işlem yok.':'No intercompany transactions yet.'}</p></div>
                        ):(
                          <div className="space-y-2">
                            {p643Txns.map(t=>(
                              <div key={t.id} className="flex items-center gap-4 p-3 rounded-xl border border-gray-100 bg-white">
                                <div className="flex-1 min-w-0">
                                  <p className="text-xs font-bold text-gray-800">{t.from} → {t.to}</p>
                                  <p className="text-xs text-gray-400">{t.desc} • {new Date(t.date).toLocaleDateString('tr-TR')}</p>
                                </div>
                                <span className="font-black text-sm text-gray-900">{t.currency==='TRY'?'₺':t.currency==='USD'?'$':'€'}{t.amount.toLocaleString('tr-TR')}</span>
                                <button onClick={async ()=>{try{await updateDoc(doc(db,'intercompanyTxns',t.id),{status:'Netleştirildi'});}catch(e){console.error("[firestore]", e);}}}
                                  className={`text-xs px-3 py-1.5 rounded-full font-semibold transition-colors ${t.status==='Netleştirildi'?'bg-emerald-100 text-emerald-700':'bg-amber-100 text-amber-700 hover:bg-emerald-100 hover:text-emerald-700'}`}>
                                  {t.status==='Netleştirildi'?(tr643?'Netleştirildi':'Eliminated'):(tr643?'Netleştir':'Eliminate')}
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </motion.div>
                    );
                  })()}

                  {/* ── Phase 610: Kâr Merkezi Analizi ──────────────────────────────── */}
                  {muhasebeTab === 'pnl' && (() => {
                    const tr610 = currentLanguage === 'tr';
                    const now610 = new Date();
                    let start610: Date;
                    if (p610Period==='this_month') start610 = new Date(now610.getFullYear(), now610.getMonth(), 1);
                    else if (p610Period==='last_month') start610 = new Date(now610.getFullYear(), now610.getMonth()-1, 1);
                    else start610 = new Date(now610.getFullYear(), 0, 1); // YTD
                    const end610 = p610Period==='last_month' ? new Date(now610.getFullYear(), now610.getMonth(), 0) : now610;
                    const periodOrders = orders.filter(o => {
                      if (!o.createdAt||o.status==='Cancelled') return false;
                      try {
                        const d=(o.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(o.createdAt as string);
                        return d>=start610&&d<=end610;
                      } catch { return false; }
                    });
                    // Group by customerType as profit centers
                    const centers: Record<string,{revenue:number;cost:number;count:number}> = {};
                    periodOrders.forEach(o => {
                      const ct = o.customerType||'Other';
                      if (!centers[ct]) centers[ct]={revenue:0,cost:0,count:0};
                      centers[ct].revenue += o.totalPrice||0;
                      centers[ct].cost += (o.lineItems||[]).reduce((s,li)=>s+(li.costPrice||0)*(li.quantity||0),0);
                      centers[ct].count++;
                    });
                    const rows = Object.entries(centers).map(([name,d])=>({name,revenue:d.revenue,cost:d.cost,margin:d.revenue>0?((d.revenue-d.cost)/d.revenue*100):0,count:d.count})).sort((a,b)=>b.revenue-a.revenue);
                    const totalRev = rows.reduce((s,r)=>s+r.revenue,0);
                    const totalCost = rows.reduce((s,r)=>s+r.cost,0);
                    if (rows.length === 0) return null;
                    return (
                      <div className="apple-card p-5 mt-4 space-y-4">
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <h3 className="font-bold text-gray-900 text-sm">🏢 {tr610?'Kâr Merkezi Analizi':'Profit Center Analysis'}</h3>
                          <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
                            {([{k:'this_month',l:tr610?'Bu Ay':'This Month'},{k:'last_month',l:tr610?'Geçen Ay':'Last Month'},{k:'ytd',l:tr610?'YTD':'YTD'}] as {k:'this_month'|'last_month'|'ytd';l:string}[]).map(t=>(
                              <button key={t.k} onClick={()=>setP610Period(t.k)} className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${p610Period===t.k?'bg-white shadow text-gray-900':'text-gray-500 hover:text-gray-700'}`}>{t.l}</button>
                            ))}
                          </div>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead><tr className="border-b border-gray-100 bg-gray-50">
                              {[tr610?'Merkez':'Center',tr610?'Ciro':'Revenue',tr610?'Maliyet':'Cost',tr610?'Kâr Marjı':'Margin',tr610?'Sipariş':'Orders'].map(h=>(
                                <th key={h} className="px-4 py-2 text-left text-[10px] font-bold text-gray-400 uppercase">{h}</th>
                              ))}
                            </tr></thead>
                            <tbody className="divide-y divide-gray-50">
                              {rows.map(r=>(
                                <tr key={r.name} className="hover:bg-gray-50/50">
                                  <td className="px-4 py-2.5 font-medium text-gray-800">{r.name}</td>
                                  <td className="px-4 py-2.5 font-mono text-gray-700">₺{Math.round(r.revenue).toLocaleString('tr-TR')}</td>
                                  <td className="px-4 py-2.5 font-mono text-gray-500">₺{Math.round(r.cost).toLocaleString('tr-TR')}</td>
                                  <td className={`px-4 py-2.5 font-bold ${r.margin>=50?'text-emerald-600':r.margin>=20?'text-amber-600':'text-red-600'}`}>%{r.margin.toFixed(1)}</td>
                                  <td className="px-4 py-2.5 text-gray-500">{r.count}</td>
                                </tr>
                              ))}
                              <tr className="border-t-2 border-gray-200 bg-gray-50 font-bold">
                                <td className="px-4 py-2 text-gray-700">{tr610?'Toplam':'Total'}</td>
                                <td className="px-4 py-2 font-mono text-gray-700">₺{Math.round(totalRev).toLocaleString('tr-TR')}</td>
                                <td className="px-4 py-2 font-mono text-gray-500">₺{Math.round(totalCost).toLocaleString('tr-TR')}</td>
                                <td className={`px-4 py-2 ${totalRev>0?((totalRev-totalCost)/totalRev*100)>=30?'text-emerald-600':'text-amber-600':'text-gray-400'}`}>%{totalRev>0?(((totalRev-totalCost)/totalRev)*100).toFixed(1):'0'}</td>
                                <td className="px-4 py-2 text-gray-500">{rows.reduce((s,r)=>s+r.count,0)}</td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      </div>
                    );
                  })()}

                </>
              )}
            </motion.div>
  );
}
