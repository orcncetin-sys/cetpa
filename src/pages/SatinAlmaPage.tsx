import React, { useState } from 'react';
const CariEkstrePanel = React.lazy(() => import('../components/CariEkstrePanel'));
import { motion, AnimatePresence } from 'motion/react';
import {
  Building2, Plus, Award, ShoppingCart, AlertTriangle, Search, Calendar,
  X, Trash2, Phone, Mail, FileText, Edit2, CheckCircle2, BarChart3,
} from 'lucide-react';
import { db } from '../firebase';
import { doc, updateDoc, addDoc, collection, deleteDoc, serverTimestamp, query, where, onSnapshot } from '../lib/dbClient';
import { cn } from '../lib/utils';
import UnauthorizedView from '../components/UnauthorizedView';
import ReadOnlyBanner from '../components/ReadOnlyBanner';
import ModuleHeader from '../components/ModuleHeader';
import KpiCurrencyToggle from '../components/KpiCurrencyToggle';
import type { Order, InventoryItem, Supplier, Lead } from '../types';
import { useMikroFaturalar } from '../hooks/useMikroFaturalar';
import { useMikroTedarikciler } from '../hooks/useMikroTedarikciler';
import { kurCevir } from '../utils/currency';

const PurchasingModule = React.lazy(() => import('../components/PurchasingModule'));

type PurchasingSubTab = 'pos' | 'suppliers' | 'scorecard' | 'odeme-takvimi' | 'tedarikci-portal' | 'satin-butce' | 'tedarik-risk';

interface Props {
  currentLanguage: 'tr' | 'en';
  canAccess: (tab: string) => boolean;
  hasFullAccess: (tab: string) => boolean;
  user: { email?: string | null; uid?: string; displayName?: string | null } | null;
  userRole: string | null;
  darkMode: boolean;
  orders: Order[];
  inventory: InventoryItem[];
  suppliers: Supplier[];
  companyId: string | null;
  exchangeRates: Record<string, number> | null;
  fmtKpi: (value: number, format?: 'full' | 'K', decimals?: number) => string;
  toast: (msg: string, type?: string) => void;
  setActiveTab: (tab: string) => void;
  kpiCurrency: 'TRY' | 'USD' | 'EUR';
  setKpiCurrency: React.Dispatch<React.SetStateAction<'TRY' | 'USD' | 'EUR'>>;

  purchasingSubTab: PurchasingSubTab;
  setPurchasingSubTab: React.Dispatch<React.SetStateAction<PurchasingSubTab>>;

  apPurchaseOrders: Array<{ id: string; orderNumber: string; supplier: string; totalAmount: number; status: string; expectedDate?: unknown; createdAt?: unknown }>;

  addingSupplier: boolean;
  setAddingSupplier: React.Dispatch<React.SetStateAction<boolean>>;
  editingSupplier: Supplier | null;
  setEditingSupplier: React.Dispatch<React.SetStateAction<Supplier | null>>;
  supplierSearch: string;
  setSupplierSearch: React.Dispatch<React.SetStateAction<string>>;
  newSupplier: Partial<Supplier>;
  setNewSupplier: React.Dispatch<React.SetStateAction<Partial<Supplier>>>;
  vknLookupLoading: boolean;
  vknLookupMsg: { text: string; ok: boolean } | null;
  setVknLookupMsg: React.Dispatch<React.SetStateAction<{ text: string; ok: boolean } | null>>;
  handleVknLookup: () => Promise<void>;
  handleSaveSupplier: () => Promise<void>;
  handleDeleteSupplier: (id: string) => Promise<void>;

  quickPOProduct: { name: string; sku: string } | null;
  setQuickPOProduct: React.Dispatch<React.SetStateAction<{ name: string; sku: string } | null>>;

  p551SelSupplier: string;
  setP551SelSupplier: React.Dispatch<React.SetStateAction<string>>;
  p567Ratings: Record<string, Record<string, number>>;
  saveSupplierRating: (supplierId: string, criteriaKey: string, score: number) => void;
  p578Threshold: number;
  setP578Threshold: React.Dispatch<React.SetStateAction<number>>;

  p608SelProduct: string;
  setP608SelProduct: React.Dispatch<React.SetStateAction<string>>;
  p608Quotes: Array<{ id: string; supplier: string; price: number; leadDays: number; minQty: number; validUntil?: string }>;
  setP608Quotes: React.Dispatch<React.SetStateAction<Array<{ id: string; supplier: string; price: number; leadDays: number; minQty: number; validUntil?: string }>>>;
  p608ShowForm: boolean;
  setP608ShowForm: React.Dispatch<React.SetStateAction<boolean>>;
  p608Draft: { supplier: string; price: string; leadDays: string; minQty: string; validUntil: string };
  setP608Draft: React.Dispatch<React.SetStateAction<{ supplier: string; price: string; leadDays: string; minQty: string; validUntil: string }>>;

  p612Budgets: Array<{ id: string; category: string; allocated: number; spent: number; period: string }>;
  setP612Budgets: React.Dispatch<React.SetStateAction<Array<{ id: string; category: string; allocated: number; spent: number; period: string }>>>;
  p612ShowForm: boolean;
  setP612ShowForm: React.Dispatch<React.SetStateAction<boolean>>;
  p612Draft: { category: string; allocated: string; spent: string; period: string };
  setP612Draft: React.Dispatch<React.SetStateAction<{ category: string; allocated: string; spent: string; period: string }>>;

  p627Risks: Array<{ id: string; supplier: string; riskType: 'Tedarik Kesintisi' | 'Kalite' | 'Fiyat Artışı' | 'Teslimat Gecikmesi' | 'Diğer'; severity: 'Düşük' | 'Orta' | 'Yüksek' | 'Kritik'; probability: number; mitigationPlan?: string; status: 'Aktif' | 'Azaltıldı' | 'Kabul Edildi' }>;
  setP627Risks: React.Dispatch<React.SetStateAction<Array<{ id: string; supplier: string; riskType: 'Tedarik Kesintisi' | 'Kalite' | 'Fiyat Artışı' | 'Teslimat Gecikmesi' | 'Diğer'; severity: 'Düşük' | 'Orta' | 'Yüksek' | 'Kritik'; probability: number; mitigationPlan?: string; status: 'Aktif' | 'Azaltıldı' | 'Kabul Edildi' }>>>;
  p627ShowForm: boolean;
  setP627ShowForm: React.Dispatch<React.SetStateAction<boolean>>;
  p627Draft: { supplier: string; riskType: 'Tedarik Kesintisi' | 'Kalite' | 'Fiyat Artışı' | 'Teslimat Gecikmesi' | 'Diğer'; severity: 'Düşük' | 'Orta' | 'Yüksek' | 'Kritik'; probability: string; mitigationPlan: string };
  setP627Draft: React.Dispatch<React.SetStateAction<{ supplier: string; riskType: 'Tedarik Kesintisi' | 'Kalite' | 'Fiyat Artışı' | 'Teslimat Gecikmesi' | 'Diğer'; severity: 'Düşük' | 'Orta' | 'Yüksek' | 'Kritik'; probability: string; mitigationPlan: string }>>;
}

export default function SatinAlmaPage(props: Props) {
  const {
    currentLanguage, canAccess, hasFullAccess, user, userRole, darkMode,
    orders, inventory, suppliers, companyId, exchangeRates, fmtKpi, toast, setActiveTab,
    kpiCurrency, setKpiCurrency,
    purchasingSubTab, setPurchasingSubTab,
    apPurchaseOrders,
    addingSupplier, setAddingSupplier, editingSupplier, setEditingSupplier,
    supplierSearch, setSupplierSearch, newSupplier, setNewSupplier,
    vknLookupLoading, vknLookupMsg, setVknLookupMsg,
    handleVknLookup, handleSaveSupplier, handleDeleteSupplier,
    quickPOProduct, setQuickPOProduct,
    p551SelSupplier, setP551SelSupplier,
    p567Ratings, saveSupplierRating,
    p578Threshold, setP578Threshold,
    p608SelProduct, setP608SelProduct, p608Quotes, setP608Quotes, p608ShowForm, setP608ShowForm, p608Draft, setP608Draft,
    p612Budgets, setP612Budgets, p612ShowForm, setP612ShowForm, p612Draft, setP612Draft,
    p627Risks, setP627Risks, p627ShowForm, setP627ShowForm, p627Draft, setP627Draft,
  } = props;
  // Kalıcılaştırma (2026-07-21): düzenleme modu kimlikleri
  const [p612EditId, setP612EditId] = React.useState<string | null>(null);
  const [p627EditId, setP627EditId] = React.useState<string | null>(null);
  const [p608EditId, setP608EditId] = React.useState<string | null>(null);

  // Tedarikçi Rehberi Mikro'ya bağlı değildi — `suppliers` yalnız elle
  // girilenleri gösteriyordu (kullanıcı bildirimi 2026-08-17: "mikro bağlı
  // değil, tedarikçiler aslında belli"). AccountingModule.tsx'teki Tedarikçiler
  // sekmesinde aynı boşluk daha önce kapatılmıştı; aynı mantık paylaşılan
  // hook'a çıkarılıp burada da kullanıldı.
  //
  // Kendi `leads` dinleyicisi (App.tsx'in paylaşılan `leads` state'i DEĞİL):
  // App.tsx'teki dinleyici o state'i Admin/Manager dışındaki roller için
  // assignedTo===uid'e KISITLIYOR (CRM pipeline sahipliği amaçlı). Bu
  // ekranın gerçek kullanıcıları (Purchasing/Logistics rolleri, satin-alma
  // full erişiminde) Admin/Manager değil — paylaşılan `leads`'i kullansaydım
  // tedarikçiler onlara neredeyse hep boş görünürdü (code-review bulgusu).
  // rbac.ts: leads read = [Admin,Manager,Sales,Accounting,Purchasing] —
  // Purchasing zaten yetkili, yalnız companyId'ye göre süz, assignedTo'ya değil.
  const [tedarikciLeads, setTedarikciLeads] = React.useState<Lead[]>([]);
  React.useEffect(() => {
    if (!companyId || !canAccess('satin-alma')) return;
    const unsub = onSnapshot(
      query(collection(db, 'leads'), where('companyId', '==', companyId)),
      snap => setTedarikciLeads(snap.docs.map((d: { id: string; data: () => Record<string, unknown> }) => ({ id: d.id, ...d.data() } as Lead))),
      () => setTedarikciLeads([]),
    );
    return () => unsub();
  }, [companyId]);
  const mikroFaturalarSA = useMikroFaturalar(!!user && canAccess('satin-alma'));
  const mikroTedarikciler = useMikroTedarikciler(tedarikciLeads, mikroFaturalarSA, suppliers);
  const allSuppliers = [...suppliers, ...mikroTedarikciler];
  /** Karta tıklanınca açılan tedarikçi cari ekstresi (2026-08-28 isteği:
   *  "tedarikçilerde detaya gidemiyorum karta basınca"). */
  const [acikTedarikci, setAcikTedarikci] = useState<{ ad: string; cariKod?: string } | null>(null);

  return (
            <motion.div key="satin-alma" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
              {!canAccess('satin-alma') ? <UnauthorizedView currentLanguage={currentLanguage} tab={currentLanguage==='tr'?'Satın Alma':'Purchasing'} /> : (
                <>
                  {!hasFullAccess('satin-alma') && <ReadOnlyBanner currentLanguage={currentLanguage} />}

                  {/* ── Sub-tab switcher (hidden on desktop — sidebar handles nav) ── */}
                  <div className="lg:hidden flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
                    {([
                      { key: 'pos',       label: currentLanguage === 'tr' ? 'Satın Alma Siparişleri' : 'Purchase Orders', icon: ShoppingCart },
                      { key: 'suppliers', label: currentLanguage === 'tr' ? 'Tedarikçiler' : 'Suppliers',         icon: Building2     },
                      { key: 'scorecard',       label: currentLanguage === 'tr' ? 'Tedarikçi Skorkartı' : 'Supplier Scorecard', icon: Award },
                      { key: 'odeme-takvimi',  label: currentLanguage === 'tr' ? 'Ödeme Takvimi' : 'Payment Schedule',    icon: Calendar },
                    ] as { key: 'pos' | 'suppliers' | 'scorecard' | 'odeme-takvimi'; label: string; icon: React.ElementType }[]).map(t => (
                      <button key={t.key} onClick={() => setPurchasingSubTab(t.key)}
                        className={cn('flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all',
                          purchasingSubTab === t.key ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700')}>
                        <t.icon className="w-4 h-4" /> {t.label}
                      </button>
                    ))}
                  </div>

                  {/* Purchase Orders */}
                  {purchasingSubTab === 'pos' && (
                    <div className="space-y-4">
                      {/* ── Phase 62: Purchasing Spend Trend ── */}
                      {orders.length > 0 && (() => {
                        // Approximate COGS trend from orders costPrice × quantities
                        const months: { label: string; cost: number }[] = [];
                        const now = new Date();
                        for (let i = 5; i >= 0; i--) {
                          const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
                          const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                          const label = d.toLocaleString(currentLanguage === 'tr' ? 'tr-TR' : 'en-US', { month: 'short' });
                          const cost = orders.filter(o => {
                            const raw = o.createdAt ?? o.syncedAt;
                            if (!raw) return false;
                            const od = typeof (raw as { toDate?: () => Date }).toDate === 'function'
                              ? (raw as { toDate: () => Date }).toDate()
                              : new Date(raw as string | number);
                            return `${od.getFullYear()}-${String(od.getMonth() + 1).padStart(2, '0')}` === key;
                          }).reduce((s, o) => s + (o.lineItems ?? []).reduce((ls, li) => ls + ((li.costPrice ?? 0) * li.quantity), 0), 0);
                          months.push({ label, cost });
                        }
                        const maxCost = Math.max(...months.map(m => m.cost), 1);
                        const totalCost6m = months.reduce((s, m) => s + m.cost, 0);
                        if (totalCost6m === 0) return null;
                        // Kur yoksa TL tutari yabanci sembolle basmak ~38x sisirme demekti
                        // (`exchangeRates?.USD || 1`). kurCevir kur yoksa null doner; null'da
                        // rakam degil '—' gosteriyoruz. TRY yolu aynen korunur.
                        const sym6m = kpiCurrency === 'TRY' ? '₺' : kpiCurrency === 'USD' ? '$' : '€';
                        const cost6m = kpiCurrency === 'TRY' ? totalCost6m : kurCevir(totalCost6m, kpiCurrency, exchangeRates);
                        return (
                          <div className={cn("rounded-2xl border p-5", darkMode ? "bg-white/5 border-white/10" : "bg-white border-gray-100 shadow-sm")}>
                            <div className="flex items-center justify-between mb-4">
                              <h3 className={cn("text-[10px] font-bold uppercase tracking-wider flex items-center gap-2", darkMode ? "text-white/50" : "text-gray-400")}>
                                <BarChart3 className="w-3.5 h-3.5" />
                                {currentLanguage === 'tr' ? '6 Aylık Maliyet Trendi' : '6-Month Cost Trend'}
                              </h3>
                              <div className="flex items-center gap-2">
                                <span className={cn("text-xs font-bold", darkMode ? "text-white/70" : "text-gray-700")}>
                                  {cost6m === null ? '—' : `${sym6m}${cost6m.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}`}
                                </span>
                                <KpiCurrencyToggle kpiCurrency={kpiCurrency} setKpiCurrency={setKpiCurrency} />
                              </div>
                            </div>
                            <div className="flex items-end gap-1.5 h-16">
                              {months.map((m, i) => (
                                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                                  <div
                                    className={cn("w-full rounded-t-md transition-all duration-700", m.cost > 0 ? "bg-emerald-400" : darkMode ? "bg-white/10" : "bg-gray-100")}
                                    style={{ height: `${Math.max((m.cost / maxCost) * 100, m.cost > 0 ? 8 : 4)}%` }}
                                    title={`₺${m.cost.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}`}
                                  />
                                  <span className={cn("text-[9px] font-semibold", darkMode ? "text-white/65" : "text-gray-400")}>{m.label}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })()}
                      <PurchasingModule
                        currentLanguage={currentLanguage}
                        isAuthenticated={!!user && hasFullAccess('satin-alma')}
                        userRole={userRole}
                        inventory={inventory}
                        orders={orders}
                        onNavigate={setActiveTab}
                        exchangeRates={exchangeRates}
                        prefillProduct={quickPOProduct ?? undefined}
                        onPrefillConsumed={() => setQuickPOProduct(null)}
                      />

                      {/* ── Phase 126: 3-Way Match Indicator ── */}
                      {apPurchaseOrders.length > 0 && (() => {
                        type MatchRow = { po: typeof apPurchaseOrders[number]; hasReceipt: boolean; hasInvoice: boolean; matched: boolean };
                        const rows: MatchRow[] = apPurchaseOrders.slice(0, 10).map(po => {
                          const hasReceipt = po.status === 'Teslim Alındı';
                          const hasInvoice = !!(po as Record<string, unknown>).invoiceNo || !!(po as Record<string, unknown>).invoiceDate;
                          return { po, hasReceipt, hasInvoice, matched: hasReceipt && hasInvoice };
                        });
                        const matchedCount = rows.filter(r => r.matched).length;
                        const unmatchedCount = rows.length - matchedCount;
                        return (
                          <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
                            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <span className="text-base">🔗</span>
                                <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '3-Yönlü Eşleştirme (SAS→Teslimat→Fatura)' : '3-Way Match (PO→Receipt→Invoice)'}</h3>
                              </div>
                              <div className="flex items-center gap-2 text-xs">
                                <span className="text-emerald-600 font-bold">{matchedCount} ✓</span>
                                <span className="text-gray-300">·</span>
                                <span className="text-amber-600 font-bold">{unmatchedCount} ⚠️</span>
                              </div>
                            </div>
                            <div className="divide-y divide-gray-50">
                              {rows.map(({ po, hasReceipt, hasInvoice, matched }) => (
                                <div key={po.id} className="flex items-center gap-3 px-5 py-3">
                                  <div className="flex-1 min-w-0">
                                    <p className="text-xs font-bold text-gray-800 truncate">{po.supplier || '—'}</p>
                                    <p className="text-[10px] text-gray-400">{fmtKpi((po.totalAmount || 0),'full',0)}</p>
                                  </div>
                                  <div className="flex items-center gap-1.5 flex-shrink-0">
                                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md ${true ? 'bg-emerald-50 text-emerald-600' : 'bg-gray-100 text-gray-400'}`}>SAS ✓</span>
                                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md ${hasReceipt ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>
                                      {currentLanguage === 'tr' ? 'TESLİMAT' : 'RECEIPT'} {hasReceipt ? '✓' : '○'}
                                    </span>
                                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md ${hasInvoice ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>
                                      {currentLanguage === 'tr' ? 'FATURA' : 'INVOICE'} {hasInvoice ? '✓' : '○'}
                                    </span>
                                    <span className={`text-[9px] font-black px-2 py-0.5 rounded-full ${matched ? 'bg-emerald-500 text-white' : 'bg-gray-100 text-gray-400'}`}>
                                      {matched ? (currentLanguage === 'tr' ? 'EŞLEŞTİ' : 'MATCHED') : (currentLanguage === 'tr' ? 'EKSİK' : 'PENDING')}
                                    </span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  )}

                  {/* ── Phase 29: Supplier Directory ── */}
                  {purchasingSubTab === 'suppliers' && (
                    <div className="space-y-4">
                      <ModuleHeader
                        title={currentLanguage === 'tr' ? 'Tedarikçi Rehberi' : 'Supplier Directory'}
                        subtitle={currentLanguage === 'tr' ? 'Tedarikçi firmalar ve iletişim bilgileri' : 'Supplier companies and contact details'}
                        icon={Building2}
                        actionButton={
                          hasFullAccess('satin-alma') && (
                            <button onClick={() => { setAddingSupplier(true); setNewSupplier({}); }}
                              className="apple-button-primary flex items-center gap-2">
                              <Plus className="w-4 h-4" />
                              {currentLanguage === 'tr' ? 'Yeni Tedarikçi' : 'New Supplier'}
                            </button>
                          )
                        }
                      />

                      {/* Search */}
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                        <input
                          value={supplierSearch}
                          onChange={e => setSupplierSearch(e.target.value)}
                          placeholder={currentLanguage === 'tr' ? 'Tedarikçi ara…' : 'Search suppliers…'}
                          className="apple-input pl-10 w-full"
                        />
                      </div>

                      {/* Supplier Grid */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        {allSuppliers
                          .filter(s => !supplierSearch || s.name.toLowerCase().includes(supplierSearch.toLowerCase()) || (s.company ?? '').toLowerCase().includes(supplierSearch.toLowerCase()))
                          .map(s => {
                            // Mikro'dan türetilen kayıtlar `suppliers` koleksiyonunda yok —
                            // düzenle/sil elle girilenler dışına gösterilmez (id gerçek bir
                            // suppliers dokümanına karşılık gelmeyebilir).
                            const isNative = suppliers.some(x => x.id === s.id);
                            return (
                            <div key={s.id} className="apple-card p-5 space-y-3 group cursor-pointer"
                              onClick={() => setAcikTedarikci({ ad: s.name, cariKod: s.mikroCariKod })}>
                              <div className="flex items-start justify-between gap-2">
                                <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center flex-shrink-0">
                                  <Building2 className="w-5 h-5 text-emerald-600" />
                                </div>
                                {isNative ? (
                                  hasFullAccess('satin-alma') && (
                                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                      <button onClick={e => { e.stopPropagation(); setEditingSupplier(s); setNewSupplier({ ...s }); setAddingSupplier(true); }}
                                        className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-700">
                                        <Edit2 className="w-3.5 h-3.5" />
                                      </button>
                                      <button onClick={e => { e.stopPropagation(); void handleDeleteSupplier(s.id); }}
                                        className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-600">
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </button>
                                    </div>
                                  )
                                ) : (
                                  <span title={currentLanguage==='tr'?'Mikro alış faturalarından/carilerinden türetildi':'Derived from Mikro purchase invoices/accounts'} className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-500">Mikro</span>
                                )}
                              </div>
                              <div>
                                <p className="font-bold text-gray-900 text-sm">{s.name}</p>
                                {s.company && <p className="text-[11px] text-gray-500 mt-0.5">{s.company}</p>}
                              </div>
                              <div className="space-y-1.5 text-[11px] text-gray-500">
                                {s.phone && <p className="flex items-center gap-1.5"><Phone className="w-3 h-3 flex-shrink-0" />{s.phone}</p>}
                                {s.email && <p className="flex items-center gap-1.5 truncate"><Mail className="w-3 h-3 flex-shrink-0" />{s.email}</p>}
                                {s.taxNo && <p className="flex items-center gap-1.5"><FileText className="w-3 h-3 flex-shrink-0" />VKN: {s.taxNo}</p>}
                              </div>
                            </div>
                            );
                          })}
                        {acikTedarikci && (
                          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setAcikTedarikci(null)}>
                            <div className="bg-white rounded-2xl w-full max-w-3xl max-h-[85vh] overflow-y-auto shadow-xl p-5" onClick={e => e.stopPropagation()}>
                              {acikTedarikci.cariKod ? (
                                <React.Suspense fallback={<p className="text-center text-gray-400 text-sm py-8">…</p>}>
                                  <CariEkstrePanel
                                    currentLanguage={currentLanguage}
                                    cariKod={acikTedarikci.cariKod}
                                    customerName={acikTedarikci.ad}
                                  />
                                </React.Suspense>
                              ) : (
                                <p className="text-center text-gray-400 text-sm py-8">
                                  {currentLanguage === 'tr'
                                    ? 'Bu tedarikçinin Mikro cari kodu yok — ekstre yalnız Mikro carisi olan tedarikçilerde açılır.'
                                    : 'This supplier has no Mikro account code.'}
                                </p>
                              )}
                              <button onClick={() => setAcikTedarikci(null)} className="apple-button-secondary w-full text-sm mt-4">
                                {currentLanguage === 'tr' ? 'Kapat' : 'Close'}
                              </button>
                            </div>
                          </div>
                        )}
                        {allSuppliers.length === 0 && (
                          <div className="col-span-full text-center py-16 border-2 border-dashed border-gray-100 rounded-2xl">
                            <Building2 className="w-10 h-10 text-gray-200 mx-auto mb-3" />
                            <p className="text-sm text-gray-400 font-medium">{currentLanguage === 'tr' ? 'Henüz tedarikçi yok' : 'No suppliers yet'}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Add / Edit Supplier Modal */}
                  <AnimatePresence>
                    {addingSupplier && (
                      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
                        onClick={() => { setAddingSupplier(false); setEditingSupplier(null); setNewSupplier({}); }}>
                        <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }}
                          onClick={e => e.stopPropagation()}
                          className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
                          <div className="flex items-center justify-between">
                            <h2 className="font-bold text-lg">
                              {editingSupplier
                                ? (currentLanguage === 'tr' ? 'Tedarikçi Düzenle' : 'Edit Supplier')
                                : (currentLanguage === 'tr' ? 'Yeni Tedarikçi' : 'New Supplier')}
                            </h2>
                            <button onClick={() => { setAddingSupplier(false); setEditingSupplier(null); setNewSupplier({}); setVknLookupMsg(null); }}>
                              <X className="w-5 h-5 text-gray-400" />
                            </button>
                          </div>

                          {/* VKN Lookup */}
                          <div className="space-y-1">
                            <label className="text-[10px] font-bold text-gray-500 uppercase">{currentLanguage === 'tr' ? 'VKN / TCKN (GİB Sorgula)' : 'VKN / TCKN (GİB Lookup)'}</label>
                            <div className="flex gap-2">
                              <input
                                value={(newSupplier as Record<string, string>)['taxNo'] ?? ''}
                                onChange={e => { setNewSupplier(prev => ({ ...prev, taxNo: e.target.value })); setVknLookupMsg(null); }}
                                placeholder="1234567890"
                                maxLength={11}
                                className="apple-input flex-1 font-mono"
                              />
                              <button
                                onClick={() => void handleVknLookup()}
                                disabled={vknLookupLoading}
                                className="px-4 py-2 rounded-xl bg-brand text-white text-xs font-bold hover:bg-orange-500 transition-colors disabled:opacity-50 whitespace-nowrap flex items-center gap-1.5"
                              >
                                {vknLookupLoading ? (
                                  <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin inline-block" />
                                ) : <Search className="w-3.5 h-3.5" />}
                                {currentLanguage === 'tr' ? 'Sorgula' : 'Lookup'}
                              </button>
                            </div>
                            {vknLookupMsg && (
                              <p className={`text-[11px] font-medium mt-1 ${vknLookupMsg.ok ? 'text-emerald-600' : 'text-red-500'}`}>{vknLookupMsg.text}</p>
                            )}
                          </div>

                          {[
                            { key: 'name',      label: currentLanguage === 'tr' ? 'Ad / Ünvan *' : 'Name *',          required: true  },
                            { key: 'company',   label: currentLanguage === 'tr' ? 'Firma' : 'Company',                 required: false },
                            { key: 'email',     label: currentLanguage === 'tr' ? 'E-posta' : 'Email',                 required: false },
                            { key: 'phone',     label: currentLanguage === 'tr' ? 'Telefon' : 'Phone',                 required: false },
                            { key: 'taxOffice', label: currentLanguage === 'tr' ? 'Vergi Dairesi' : 'Tax Office',      required: false },
                            { key: 'address',   label: currentLanguage === 'tr' ? 'Adres' : 'Address',                 required: false },
                            { key: 'notes',     label: currentLanguage === 'tr' ? 'Notlar' : 'Notes',                  required: false },
                          ].map(field => (
                            <div key={field.key} className="space-y-1">
                              <label className="text-[10px] font-bold text-gray-500 uppercase">{field.label}</label>
                              <input
                                value={(newSupplier as Record<string, string>)[field.key] ?? ''}
                                onChange={e => setNewSupplier(prev => ({ ...prev, [field.key]: e.target.value }))}
                                className="apple-input w-full"
                              />
                            </div>
                          ))}
                          <div className="flex gap-2 pt-2">
                            <button onClick={() => { setAddingSupplier(false); setEditingSupplier(null); setNewSupplier({}); setVknLookupMsg(null); }}
                              className="apple-button-secondary flex-1">{currentLanguage === 'tr' ? 'İptal' : 'Cancel'}</button>
                            <button onClick={() => void handleSaveSupplier()}
                              className="apple-button-primary flex-1">{currentLanguage === 'tr' ? 'Kaydet' : 'Save'}</button>
                          </div>
                        </motion.div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* ── Phase 120: Supplier Performance Scorecard ── */}
                  {purchasingSubTab === 'scorecard' && (() => {
                    // Build per-supplier stats from apPurchaseOrders
                    type SupScore = {
                      name: string; totalPOs: number; delivered: number; pending: number;
                      cancelled: number; totalSpend: number; onTimeRate: number; score: number;
                    };
                    const scoremap: Record<string, SupScore> = {};
                    for (const po of apPurchaseOrders) {
                      const name = po.supplier || '—';
                      if (!scoremap[name]) scoremap[name] = { name, totalPOs: 0, delivered: 0, pending: 0, cancelled: 0, totalSpend: 0, onTimeRate: 0, score: 0 };
                      scoremap[name].totalPOs++;
                      scoremap[name].totalSpend += po.totalAmount;
                      if (po.status === 'Teslim Alındı') scoremap[name].delivered++;
                      else if (po.status === 'İptal Edildi') scoremap[name].cancelled++;
                      else scoremap[name].pending++;
                    }
                    const scores: SupScore[] = Object.values(scoremap).map(s => {
                      const deliveryRate = s.totalPOs > 0 ? (s.delivered / s.totalPOs) * 100 : 0;
                      const cancelRate   = s.totalPOs > 0 ? (s.cancelled / s.totalPOs) * 100 : 0;
                      const score = Math.round(Math.max(0, deliveryRate - cancelRate * 0.5));
                      return { ...s, onTimeRate: Math.round(deliveryRate), score };
                    }).sort((a, b) => b.score - a.score);

                    if (scores.length === 0) return (
                      <div className="text-center py-16 bg-white border border-gray-100 rounded-2xl">
                        <Award size={40} className="mx-auto mb-3 text-gray-200" />
                        <p className="text-sm text-gray-400">{currentLanguage === 'tr' ? 'Tedarikçi siparişi bulunmuyor.' : 'No supplier purchase orders found.'}</p>
                      </div>
                    );

                    return (
                      <div className="space-y-4">
                        <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
                          <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
                            <Award size={16} className="text-amber-400" />
                            <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? 'Tedarikçi Performans Skorkartı' : 'Supplier Performance Scorecard'}</h3>
                          </div>
                          <div className="divide-y divide-gray-50">
                            {scores.map((s, i) => (
                              <div key={s.name} className="px-5 py-4">
                                <div className="flex items-center justify-between mb-2">
                                  <div className="flex items-center gap-3">
                                    <span className={`text-sm font-black w-6 ${i === 0 ? 'text-amber-500' : i === 1 ? 'text-gray-400' : i === 2 ? 'text-orange-600' : 'text-gray-300'}`}>
                                      {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`}
                                    </span>
                                    <p className="text-sm font-bold text-gray-800">{s.name}</p>
                                  </div>
                                  <div className="flex items-center gap-4 text-[10px] text-gray-500">
                                    <span>{s.totalPOs} {currentLanguage === 'tr' ? 'sipariş' : 'POs'}</span>
                                    <span>{fmtKpi(s.totalSpend,'full',0)}</span>
                                    <span className={`font-black text-sm ${s.score >= 80 ? 'text-emerald-600' : s.score >= 50 ? 'text-amber-600' : 'text-red-500'}`}>
                                      {s.score}
                                    </span>
                                  </div>
                                </div>
                                {/* Score bar */}
                                <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden mb-1.5">
                                  <div
                                    className={`h-2 rounded-full transition-all duration-700 ${s.score >= 80 ? 'bg-emerald-400' : s.score >= 50 ? 'bg-amber-400' : 'bg-red-400'}`}
                                    style={{ width: `${s.score}%` }}
                                  />
                                </div>
                                {/* Mini stats row */}
                                <div className="flex gap-4 text-[10px]">
                                  <span className="text-emerald-600 font-semibold">{s.delivered} {currentLanguage === 'tr' ? 'teslim' : 'delivered'}</span>
                                  <span className="text-amber-600 font-semibold">{s.pending} {currentLanguage === 'tr' ? 'bekliyor' : 'pending'}</span>
                                  {s.cancelled > 0 && <span className="text-red-500 font-semibold">{s.cancelled} {currentLanguage === 'tr' ? 'iptal' : 'cancelled'}</span>}
                                  <span className="text-gray-400 ml-auto">{s.onTimeRate}% {currentLanguage === 'tr' ? 'teslimat oranı' : 'delivery rate'}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                          <div className="px-5 py-2.5 bg-gray-50 border-t border-gray-100 text-[10px] text-gray-400">
                            {currentLanguage === 'tr'
                              ? 'Skor = Teslimat oranı − (İptal oranı × 0,5). Satın Alma Siparişleri verisine dayanır.'
                              : 'Score = Delivery rate − (Cancel rate × 0.5). Based on Purchase Orders data.'}
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  {/* ── Phase 134: Vendor Payment Schedule ── */}
                  {purchasingSubTab === 'odeme-takvimi' && (() => {
                    const openPOs = apPurchaseOrders.filter(po => !['Teslim Alındı', 'İptal Edildi'].includes(po.status));
                    if (openPOs.length === 0) return (
                      <div className="text-center py-16 bg-white border border-gray-100 rounded-2xl">
                        <CheckCircle2 size={40} className="mx-auto mb-3 text-emerald-200" />
                        <p className="text-sm text-gray-400">{currentLanguage === 'tr' ? 'Bekleyen ödeme yok.' : 'No pending payments.'}</p>
                      </div>
                    );
                    // Group by month using expectedDelivery or createdAt + 30 days
                    type PayGroup = { month: string; pos: typeof openPOs; total: number };
                    const groupMap: Record<string, PayGroup> = {};
                    const now134 = new Date();
                    for (const po of openPOs) {
                      const raw = (po as Record<string, unknown>).expectedDelivery ?? (po as Record<string, unknown>).createdAt;
                      let dueDate: Date;
                      if (raw) {
                        dueDate = typeof (raw as { toDate?: () => Date }).toDate === 'function' ? (raw as { toDate: () => Date }).toDate() : new Date(raw as string | number);
                        // If no expected delivery, add 30 days to creation
                        if (!(po as Record<string, unknown>).expectedDelivery) dueDate = new Date(dueDate.getTime() + 30 * 86400000);
                      } else {
                        dueDate = new Date(now134.getTime() + 30 * 86400000);
                      }
                      const key = `${dueDate.getFullYear()}-${String(dueDate.getMonth() + 1).padStart(2, '0')}`;
                      const label = dueDate.toLocaleString(currentLanguage === 'tr' ? 'tr-TR' : 'en-US', { month: 'long', year: 'numeric' });
                      if (!groupMap[key]) groupMap[key] = { month: label, pos: [], total: 0 };
                      groupMap[key].pos.push(po);
                      groupMap[key].total += po.totalAmount || 0;
                    }
                    const groups = Object.entries(groupMap).sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v);
                    const grandTotal = groups.reduce((s, g) => s + g.total, 0);
                    return (
                      <div className="space-y-4">
                        <ModuleHeader
                          title={currentLanguage === 'tr' ? 'Tedarikçi Ödeme Takvimi' : 'Vendor Payment Schedule'}
                          subtitle={currentLanguage === 'tr' ? `${openPOs.length} açık sipariş · Toplam ₺${grandTotal.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}` : `${openPOs.length} open POs · Total ₺${grandTotal.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}`}
                          icon={Calendar}
                        />
                        {groups.map(g => (
                          <div key={g.month} className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
                            <div className="px-5 py-3 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
                              <span className="text-sm font-bold text-gray-700 capitalize">{g.month}</span>
                              <span className="text-sm font-black text-brand">{fmtKpi(g.total,'full',0)}</span>
                            </div>
                            <div className="divide-y divide-gray-50">
                              {g.pos.map(po => (
                                <div key={po.id} className="flex items-center gap-4 px-5 py-3">
                                  <div className="flex-1 min-w-0">
                                    <p className="text-xs font-bold text-gray-800">{po.supplier || '—'}</p>
                                    <p className="text-[10px] text-gray-400">{po.status}</p>
                                  </div>
                                  <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${
                                    po.status === 'Onaylandı' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                                  }`}>{po.status}</span>
                                  <span className="text-sm font-bold text-gray-800 flex-shrink-0">{fmtKpi((po.totalAmount || 0),'full',0)}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                  {/* ── Phase 153: Supplier Lead Time Analysis ── */}
                  {purchasingSubTab === 'scorecard' && apPurchaseOrders.length > 0 && (() => {
                    // Group POs by supplier and estimate lead time from createdAt → expectedDate
                    type LTStat = { supplier: string; avgDays: number; count: number; onTime: number };
                    const ltMap: Record<string, { days: number[]; onTime: number }> = {};
                    for (const po of apPurchaseOrders) {
                      if (!po.createdAt || !po.expectedDate) continue;
                      try {
                        const created = (po.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(po.createdAt as string);
                        const expected = new Date(po.expectedDate as string);
                        const days = Math.round((expected.getTime() - created.getTime()) / 86400000);
                        if (days <= 0 || days > 365) continue;
                        if (!ltMap[po.supplier]) ltMap[po.supplier] = { days: [], onTime: 0 };
                        ltMap[po.supplier].days.push(days);
                        if (po.status === 'Teslim Alındı') ltMap[po.supplier].onTime++;
                      } catch { /* skip */ }
                    }
                    const stats: LTStat[] = Object.entries(ltMap).map(([sup, v]) => ({
                      supplier: sup,
                      avgDays: Math.round(v.days.reduce((s, d) => s + d, 0) / v.days.length),
                      count: v.days.length,
                      onTime: v.onTime,
                    })).sort((a, b) => a.avgDays - b.avgDays).slice(0, 8);
                    if (stats.length === 0) return null;
                    const maxDays = Math.max(...stats.map(s => s.avgDays), 1);
                    return (
                      <div className="apple-card p-6 mt-4">
                        <h3 className="font-bold text-gray-800 mb-4">{currentLanguage === 'tr' ? '⏱️ Tedarikçi Teslim Süresi Analizi' : '⏱️ Supplier Lead Time Analysis'}</h3>
                        <div className="space-y-3">
                          {stats.map(s => {
                            const w = Math.round((s.avgDays / maxDays) * 100);
                            const cls = s.avgDays <= 7 ? 'bg-emerald-400' : s.avgDays <= 14 ? 'bg-amber-400' : 'bg-red-400';
                            const textCls = s.avgDays <= 7 ? 'text-emerald-600' : s.avgDays <= 14 ? 'text-amber-600' : 'text-red-500';
                            return (
                              <div key={s.supplier}>
                                <div className="flex items-center justify-between mb-1">
                                  <span className="text-xs font-medium text-gray-800 truncate">{s.supplier}</span>
                                  <div className="flex items-center gap-3 shrink-0 ml-2">
                                    <span className="text-[10px] text-gray-400">{s.count} PO</span>
                                    <span className={`text-xs font-bold tabular-nums ${textCls}`}>{s.avgDays}g</span>
                                  </div>
                                </div>
                                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                                  <div className={`h-full rounded-full ${cls}`} style={{ width: `${w}%` }} />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                        <p className="text-[10px] text-gray-400 mt-3">{currentLanguage === 'tr' ? 'Ortalama teslim günü (Oluşturma → Beklenen Tarih)' : 'Avg. lead days (Created → Expected Date)'}</p>
                      </div>
                    );
                  })()}

                  {/* ── Phase 567: Tedarikçi Değerlendirme Matrisi ─────────────────────── */}
                  {purchasingSubTab === 'scorecard' && suppliers.length > 0 && (() => {
                    const tr567 = currentLanguage === 'tr';
                    const criteria = [
                      { key: 'price',    label: tr567?'Fiyat Rekabetçiliği':'Price Competitiveness' },
                      { key: 'quality',  label: tr567?'Ürün Kalitesi':'Product Quality' },
                      { key: 'delivery', label: tr567?'Teslimat Süresi':'Delivery Speed' },
                      { key: 'communication', label: tr567?'İletişim':'Communication' },
                    ];
                    const weights = { price: 0.3, quality: 0.3, delivery: 0.25, communication: 0.15 };

                    const getScore = (supId: string) => {
                      const r = p567Ratings[supId] || {};
                      return criteria.reduce((s, c) => s + (r[c.key] || 0) * (weights[c.key as keyof typeof weights] || 0), 0);
                    };

                    const supList567 = suppliers.slice(0, 10).map(s => ({
                      ...s,
                      score: getScore(s.id),
                      ratings: p567Ratings[s.id] || {},
                    })).sort((a,b) => b.score - a.score);

                    return (
                      <div className="apple-card p-5 mt-4">
                        <div className="flex items-center gap-2 mb-4">
                          <Award className="w-4 h-4 text-amber-500" />
                          <h4 className="font-bold text-gray-800 text-sm">{tr567?'Tedarikçi Değerlendirme Matrisi':'Vendor Evaluation Matrix'}</h4>
                          <span className="text-[10px] text-gray-400">{tr567?'(1-5 puan)':'(1-5 scale)'}</span>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="border-b border-gray-100">
                                <th className="py-2 px-3 text-left text-[10px] font-bold text-gray-400 uppercase">{tr567?'Tedarikçi':'Supplier'}</th>
                                {criteria.map(c => (
                                  <th key={c.key} className="py-2 px-2 text-center text-[10px] font-bold text-gray-400 uppercase whitespace-nowrap">
                                    {c.label}<br/><span className="text-gray-300 font-normal">{tr567?`%${Math.round(weights[c.key as keyof typeof weights]*100)}`:`${Math.round(weights[c.key as keyof typeof weights]*100)}%`}</span>
                                  </th>
                                ))}
                                <th className="py-2 px-3 text-center text-[10px] font-bold text-gray-400 uppercase">{tr567?'Toplam':'Total'}</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50">
                              {supList567.map(sup => (
                                <tr key={sup.id} className="hover:bg-gray-50/50">
                                  <td className="px-3 py-2.5 font-semibold text-gray-800 max-w-[120px] truncate">{sup.name}</td>
                                  {criteria.map(c => (
                                    <td key={c.key} className="px-2 py-2 text-center">
                                      <div className="flex items-center justify-center gap-0.5">
                                        {[1,2,3,4,5].map(star => (
                                          <button key={star}
                                            onClick={() => saveSupplierRating(sup.id, c.key, star)}
                                            className={`text-sm transition-colors ${(sup.ratings[c.key]||0) >= star ? 'text-amber-400' : 'text-gray-200 hover:text-amber-300'}`}>
                                            ★
                                          </button>
                                        ))}
                                      </div>
                                    </td>
                                  ))}
                                  <td className="px-3 py-2.5 text-center">
                                    {sup.score > 0 ? (
                                      <span className={`font-black text-sm ${sup.score>=4?'text-emerald-600':sup.score>=3?'text-amber-600':'text-red-500'}`}>
                                        {sup.score.toFixed(1)}
                                      </span>
                                    ) : <span className="text-gray-300">—</span>}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <p className="text-[10px] text-gray-400 mt-3">{tr567?'Puanlar kalıcı olarak kaydedilir.':'Ratings are saved permanently.'}</p>
                      </div>
                    );
                  })()}

                  {/* ── Phase 163: Purchase Spend Trend by Supplier ── */}
                  {purchasingSubTab === 'suppliers' && apPurchaseOrders.length > 0 && (() => {
                    const supMap: Record<string, number> = {};
                    for (const po of apPurchaseOrders) {
                      if (!po.supplier) continue;
                      supMap[po.supplier] = (supMap[po.supplier] ?? 0) + (po.totalAmount || 0);
                    }
                    const supList = Object.entries(supMap).sort(([,a],[,b]) => b - a).slice(0, 8);
                    if (supList.length === 0) return null;
                    const maxSpend = Math.max(...supList.map(([,v]) => v), 1);
                    const totalSpend = supList.reduce((s, [,v]) => s + v, 0);
                    return (
                      <div className="apple-card p-6 mt-4">
                        <h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? '💳 Tedarikçiye Göre Harcama' : '💳 Spend by Supplier'}</h3>
                        <p className="text-xs text-gray-400 mb-4">{currentLanguage === 'tr' ? `Toplam: ₺${totalSpend.toLocaleString()}` : `Total: ₺${totalSpend.toLocaleString()}`}</p>
                        <div className="space-y-2.5">
                          {supList.map(([sup, spend]) => {
                            const pct = Math.round((spend / totalSpend) * 100);
                            const w = Math.round((spend / maxSpend) * 100);
                            return (
                              <div key={sup}>
                                <div className="flex items-center justify-between mb-1">
                                  <span className="text-xs font-medium text-gray-800 truncate">{sup}</span>
                                  <div className="flex items-center gap-2 shrink-0 ml-2">
                                    <span className="text-[10px] text-gray-400">%{pct}</span>
                                    <span className="text-xs font-bold text-gray-700 tabular-nums">{fmtKpi(spend,'K',1)}</span>
                                  </div>
                                </div>
                                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                                  <div className="h-full bg-blue-400 rounded-full transition-all" style={{ width: `${w}%` }} />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}

                  {/* ── Phase 165: Open Order Aging ── */}
                  {purchasingSubTab === 'pos' && apPurchaseOrders.filter(po => !['Teslim Alındı', 'İptal Edildi'].includes(po.status)).length > 0 && (() => {
                    const now165 = new Date();
                    const openPOs = apPurchaseOrders
                      .filter(po => !['Teslim Alındı', 'İptal Edildi'].includes(po.status) && po.createdAt)
                      .map(po => {
                        let daysOpen = 0;
                        try {
                          const created = (po.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(po.createdAt as string);
                          daysOpen = Math.floor((now165.getTime() - created.getTime()) / 86400000);
                        } catch { /* skip */ }
                        return { ...po, daysOpen };
                      })
                      .sort((a, b) => b.daysOpen - a.daysOpen)
                      .slice(0, 8);
                    if (openPOs.length === 0) return null;
                    const stale = openPOs.filter(p => p.daysOpen > 14).length;
                    return (
                      <div className={`apple-card p-5 ${stale > 0 ? 'border border-amber-100' : ''}`}>
                        <div className="flex items-center justify-between mb-3">
                          <h3 className="font-semibold text-gray-800 text-sm">{currentLanguage === 'tr' ? '⏳ Açık Sipariş Yaşlandırması' : '⏳ Open PO Aging'}</h3>
                          {stale > 0 && <span className="text-xs text-amber-700 font-bold bg-amber-50 px-2 py-0.5 rounded-full">{stale} {currentLanguage==='tr'?'gecikmiş':'>14 days old'}</span>}
                        </div>
                        <div className="space-y-2">
                          {openPOs.map(po => (
                            <div key={po.id} className="flex items-center gap-3 py-1.5 border-b border-gray-50 last:border-0">
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-medium text-gray-800 truncate">{po.supplier} · #{po.orderNumber}</p>
                                <p className="text-[10px] text-gray-400">{po.status}</p>
                              </div>
                              <span className={`text-xs font-bold shrink-0 ${po.daysOpen > 30 ? 'text-red-600' : po.daysOpen > 14 ? 'text-amber-600' : 'text-gray-600'}`}>
                                {po.daysOpen}g
                              </span>
                              <span className="text-xs text-gray-600 tabular-nums shrink-0">{fmtKpi((po.totalAmount||0))}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })()}

                  {/* ── Phase 551: Tedarikçi Portalı ──────────────────────────────────── */}
                  {purchasingSubTab === 'tedarikci-portal' && (() => {
                    const tr551 = currentLanguage === 'tr';
                    // Distinct suppliers from apPurchaseOrders
                    const suppNames = [...new Set(apPurchaseOrders.map(po => po.supplier).filter(Boolean))].sort();
                    const selPOs = p551SelSupplier
                      ? apPurchaseOrders.filter(po => po.supplier === p551SelSupplier)
                      : apPurchaseOrders;
                    const open551   = selPOs.filter(po => !['Teslim Alındı','İptal Edildi'].includes(po.status));
                    const closed551 = selPOs.filter(po => ['Teslim Alındı','İptal Edildi'].includes(po.status));
                    const totalOpen = open551.reduce((s,po) => s+(po.totalAmount||0),0);
                    const fPO = (v:number) => `₺${Math.round(v).toLocaleString('tr-TR')}`;
                    const statusBadge = (s:string) => s==='Onaylandı'?'bg-emerald-100 text-emerald-700':s==='Teslim Alındı'?'bg-blue-100 text-blue-700':s==='İptal Edildi'?'bg-red-100 text-red-700':'bg-orange-100 text-orange-700';
                    return (
                      <motion.div key="tedarikci-portal" initial={{opacity:0,y:6}} animate={{opacity:1,y:0}} className="space-y-4">
                        <ModuleHeader title={tr551?'Tedarikçi Portalı':'Supplier Portal'} subtitle={tr551?'Tedarikçi bazında PO durumları ve bildirim gönderimi':'PO status view and notification dispatch per supplier'} icon={Building2} />
                        {/* Supplier selector */}
                        <div className="flex flex-wrap items-center gap-3">
                          <select value={p551SelSupplier} onChange={e=>setP551SelSupplier(e.target.value)} className="apple-input px-3 py-2 text-sm">
                            <option value="">{tr551?'— Tüm Tedarikçiler —':'— All Suppliers —'}</option>
                            {suppNames.map(s=><option key={s}>{s}</option>)}
                          </select>
                          <div className="flex gap-3 text-sm">
                            <span className="font-bold text-orange-600">{open551.length} {tr551?'açık PO':'open PO'}</span>
                            <span className="text-gray-400">·</span>
                            <span className="font-bold text-gray-600">{fPO(totalOpen)} {tr551?'bakiye':'outstanding'}</span>
                          </div>
                        </div>
                        {/* Per-supplier summary cards */}
                        {!p551SelSupplier && suppNames.length > 0 && (
                          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                            {suppNames.map(sup => {
                              const spoPos = apPurchaseOrders.filter(po=>po.supplier===sup);
                              const sopOpen = spoPos.filter(po=>!['Teslim Alındı','İptal Edildi'].includes(po.status));
                              const sopTotal = sopOpen.reduce((s,po)=>s+(po.totalAmount||0),0);
                              return (
                                <button key={sup} onClick={()=>setP551SelSupplier(sup)} className="apple-card p-4 text-left hover:shadow-md hover:scale-[1.01] transition-all">
                                  <p className="font-semibold text-gray-800 text-sm truncate">{sup}</p>
                                  <p className="text-xs text-gray-400 mt-1">{sopOpen.length} {tr551?'açık PO':'open PO'}</p>
                                  <p className="text-base font-bold text-orange-600 mt-0.5">{fPO(sopTotal)}</p>
                                </button>
                              );
                            })}
                          </div>
                        )}
                        {/* PO table */}
                        <div className="apple-card overflow-hidden">
                          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                            <h4 className="font-bold text-gray-800 text-sm">{p551SelSupplier || (tr551?'Tüm Siparişler':'All Orders')}</h4>
                            {p551SelSupplier && <button onClick={()=>setP551SelSupplier('')} className="text-xs text-brand hover:underline">{tr551?'Tüm Tedarikçiler':'All Suppliers'}</button>}
                          </div>
                          <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                              <thead><tr className="border-b border-gray-100 bg-gray-50/60">
                                <th className="px-4 py-2.5 text-left text-xs font-bold text-gray-400 uppercase">PO #</th>
                                <th className="px-4 py-2.5 text-left text-xs font-bold text-gray-400 uppercase hidden sm:table-cell">{tr551?'Tedarikçi':'Supplier'}</th>
                                <th className="px-4 py-2.5 text-right text-xs font-bold text-gray-400 uppercase">{tr551?'Tutar':'Amount'}</th>
                                <th className="px-4 py-2.5 text-center text-xs font-bold text-gray-400 uppercase">{tr551?'Durum':'Status'}</th>
                              </tr></thead>
                              <tbody>
                                {[...open551, ...closed551].map(po=>(
                                  <tr key={po.id} className="border-b border-gray-50 hover:bg-gray-50">
                                    <td className="px-4 py-2.5 font-medium text-gray-800">#{po.orderNumber}</td>
                                    <td className="px-4 py-2.5 text-gray-500 hidden sm:table-cell">{po.supplier}</td>
                                    <td className="px-4 py-2.5 text-right font-bold tabular-nums text-gray-800">{fPO(po.totalAmount||0)}</td>
                                    <td className="px-4 py-2.5 text-center"><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${statusBadge(po.status)}`}>{po.status}</span></td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          {selPOs.length===0 && <p className="text-center py-8 text-gray-400 text-sm">{tr551?'Bu tedarikçiye ait PO bulunamadı.':'No POs found for this supplier.'}</p>}
                        </div>
                      </motion.div>
                    );
                  })()}
                  {/* ── Phase 578: Satın Alma Onay İş Akışı ────────────────────────────── */}
                  {purchasingSubTab === 'pos' && (() => {
                    const tr578 = currentLanguage === 'tr';
                    const pendingApproval = apPurchaseOrders.filter(po =>
                      po.status === 'Bekliyor Onay' || (po.status === 'Taslak' && (po.totalAmount||0) >= p578Threshold)
                    );
                    if (pendingApproval.length === 0 && !hasFullAccess('satin-alma')) return null;
                    return (
                      <div className="apple-card p-5">
                        <div className="flex items-center justify-between mb-3">
                          <h4 className="font-bold text-sm text-gray-900">{tr578?'✅ Onay İş Akışı':'✅ Approval Workflow'}</h4>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-500">{tr578?'Eşik:':'Threshold:'}</span>
                            <input type="number" value={p578Threshold} onChange={e=>setP578Threshold(Number(e.target.value))} className="apple-input px-2 py-1 text-xs w-24 text-right" />
                            <span className="text-xs text-gray-500">₺</span>
                          </div>
                        </div>
                        {pendingApproval.length === 0 ? (
                          <p className="text-center py-4 text-gray-400 text-xs">{tr578?`₺${p578Threshold.toLocaleString()} ve üzeri onay bekleyen PO yok.`:`No POs awaiting approval above ₺${p578Threshold.toLocaleString()}.`}</p>
                        ) : (
                          <div className="space-y-2">
                            {pendingApproval.map(po => (
                              <div key={po.id} className="flex items-center justify-between bg-amber-50 border border-amber-100 rounded-xl px-4 py-3">
                                <div>
                                  <p className="font-bold text-sm text-gray-800">PO #{po.orderNumber}</p>
                                  <p className="text-xs text-gray-500">{po.supplier} — <span className="font-bold text-amber-700">₺{(po.totalAmount||0).toLocaleString('tr-TR')}</span></p>
                                </div>
                                {hasFullAccess('satin-alma') && (
                                  <div className="flex gap-2">
                                    <button onClick={async()=>{
                                      await updateDoc(doc(db,'purchaseOrders',po.id),{status:'Onaylandı'});
                                      toast(tr578?'PO onaylandı.':'PO approved.','success');
                                    }} className="text-xs font-bold bg-green-100 text-green-700 hover:bg-green-200 px-3 py-1 rounded-full transition-colors">
                                      {tr578?'Onayla':'Approve'}
                                    </button>
                                    <button onClick={async()=>{
                                      await updateDoc(doc(db,'purchaseOrders',po.id),{status:'İptal Edildi'});
                                      toast(tr578?'PO reddedildi.':'PO rejected.','warning');
                                    }} className="text-xs font-bold bg-red-100 text-red-700 hover:bg-red-200 px-3 py-1 rounded-full transition-colors">
                                      {tr578?'Reddet':'Reject'}
                                    </button>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                        <p className="text-[10px] text-gray-400 mt-2">* {tr578?`Eşik tutarının üzerindeki PO'lar onay bekleyen listesine eklenir.`:`POs above the threshold require explicit approval.`}</p>
                      </div>
                    );
                  })()}

                  {/* ── Phase 608: Tedarikçi Fiyat Karşılaştırması ───────────────────── */}
                  {purchasingSubTab === 'suppliers' && (() => {
                    const tr608 = currentLanguage === 'tr';
                    // Distinct product names from inventory for selector
                    const prodNames = [...new Set(inventory.map(i=>i.name).filter(Boolean) as string[])].sort();
                    const filteredQuotes = p608SelProduct ? p608Quotes.filter(q=>q) : p608Quotes;
                    const bestQuote = filteredQuotes.length > 0 ? filteredQuotes.reduce((b,q)=>q.price<b.price?q:b, filteredQuotes[0]) : null;
                    return (
                      <div className="apple-card p-5 space-y-4">
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <h3 className="font-bold text-gray-900 text-sm">⚖️ {tr608?'Tedarikçi Fiyat Karşılaştırması':'Supplier Price Comparison'}</h3>
                          <button onClick={()=>setP608ShowForm(v=>!v)} className="apple-button-secondary text-xs flex items-center gap-1.5">
                            <Plus className="w-3.5 h-3.5"/>{tr608?'Fiyat Teklifi Ekle':'Add Quote'}
                          </button>
                        </div>
                        {/* Product selector */}
                        <div className="flex items-center gap-3 flex-wrap">
                          <select value={p608SelProduct} onChange={e=>setP608SelProduct(e.target.value)} className="apple-input px-3 py-2 text-sm">
                            <option value="">{tr608?'— Ürün Seç —':'— Select Product —'}</option>
                            {prodNames.map(n=><option key={n}>{n}</option>)}
                          </select>
                          {p608SelProduct && <span className="text-xs text-gray-500">{filteredQuotes.length} {tr608?'teklif':'quotes'}</span>}
                        </div>
                        {p608ShowForm && (
                          <div className="bg-gray-50 rounded-xl p-4 space-y-3">
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                              <input className="apple-input" placeholder={tr608?'Tedarikçi':'Supplier'} value={p608Draft.supplier} onChange={e=>setP608Draft(d=>({...d,supplier:e.target.value}))}/>
                              <input type="number" className="apple-input" placeholder={tr608?'Birim Fiyat (₺)':'Unit Price (₺)'} value={p608Draft.price} onChange={e=>setP608Draft(d=>({...d,price:e.target.value}))}/>
                              <input type="number" className="apple-input" placeholder={tr608?'Teslim (gün)':'Lead (days)'} value={p608Draft.leadDays} onChange={e=>setP608Draft(d=>({...d,leadDays:e.target.value}))}/>
                              <input type="number" className="apple-input" placeholder={tr608?'Min. Adet':'Min Qty'} value={p608Draft.minQty} onChange={e=>setP608Draft(d=>({...d,minQty:e.target.value}))}/>
                              <input type="date" className="apple-input" value={p608Draft.validUntil} onChange={e=>setP608Draft(d=>({...d,validUntil:e.target.value}))}/>
                            </div>
                            <button onClick={async ()=>{
                              if(!p608Draft.supplier||!p608Draft.price) return;
                              const payload={supplier:p608Draft.supplier,price:Number(p608Draft.price),leadDays:Number(p608Draft.leadDays)||0,minQty:Number(p608Draft.minQty)||1,validUntil:p608Draft.validUntil||''};
                              try {
                                if(p608EditId){ await updateDoc(doc(db,'rfqQuotes',p608EditId),payload); }
                                else { await addDoc(collection(db,'rfqQuotes'),{...payload,createdAt:serverTimestamp()}); }
                              } catch(e){ toast((tr608?'Kaydedilemedi: ':'Save failed: ')+(e instanceof Error?e.message:String(e)),'error'); return; }
                              setP608EditId(null);
                              setP608Draft({supplier:'',price:'',leadDays:'',minQty:'',validUntil:''});
                              setP608ShowForm(false);
                              toast(tr608?'Teklif eklendi.':'Quote added.','success');
                            }} className="apple-button-primary text-xs px-6">{tr608?'Kaydet':'Save'}</button>
                          </div>
                        )}
                        {bestQuote && (
                          <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 flex items-center gap-3">
                            <span className="text-emerald-600 font-bold text-lg">🏆</span>
                            <div>
                              <p className="text-xs font-bold text-emerald-800">{tr608?'En İyi Fiyat:':'Best Price:'} {bestQuote.supplier}</p>
                              <p className="text-sm font-black text-emerald-700">₺{bestQuote.price.toLocaleString('tr-TR')} · {bestQuote.leadDays}g {tr608?'teslim':'lead'}</p>
                            </div>
                          </div>
                        )}
                        {p608Quotes.length > 0 && (
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                              <thead><tr className="border-b border-gray-100 bg-gray-50">
                                {[tr608?'Tedarikçi':'Supplier',tr608?'Fiyat':'Price',tr608?'Teslim (g)':'Lead (d)',tr608?'Min Adet':'Min Qty',tr608?'Geçerlilik':'Valid Until',''].map(h=>(
                                  <th key={h} className="px-3 py-2 text-left text-[10px] font-bold text-gray-400 uppercase">{h}</th>
                                ))}
                              </tr></thead>
                              <tbody className="divide-y divide-gray-50">
                                {[...p608Quotes].sort((a,b)=>a.price-b.price).map((q,idx)=>(
                                  <tr key={q.id} className={`hover:bg-gray-50/50 ${idx===0?'bg-emerald-50/40':''}`}>
                                    <td className="px-3 py-2.5 font-medium text-gray-800">{q.supplier}{idx===0&&<span className="ml-1.5 text-[9px] bg-emerald-100 text-emerald-700 font-bold px-1.5 py-0.5 rounded-full">BEST</span>}</td>
                                    <td className="px-3 py-2.5 font-bold font-mono text-gray-800">₺{q.price.toLocaleString('tr-TR')}</td>
                                    <td className="px-3 py-2.5 text-gray-500">{q.leadDays}</td>
                                    <td className="px-3 py-2.5 text-gray-500">{q.minQty}</td>
                                    <td className="px-3 py-2.5 text-gray-500">{q.validUntil?new Date(q.validUntil).toLocaleDateString('tr-TR'):'—'}</td>
                                    <td className="px-3 py-2.5">
                                      <div className="flex items-center gap-2">
                                      <button onClick={()=>{setP608Draft({supplier:q.supplier,price:String(q.price),leadDays:String(q.leadDays),minQty:String(q.minQty),validUntil:q.validUntil||''});setP608EditId(q.id);setP608ShowForm(true);}} title={tr608?'Düzenle':'Edit'} className="text-gray-300 hover:text-blue-600 transition-colors"><Edit2 className="w-3.5 h-3.5"/></button>
                                      <button onClick={async ()=>{try{await deleteDoc(doc(db,'rfqQuotes',q.id));}catch(e){toast((tr608?'Silinemedi: ':'Delete failed: ')+(e instanceof Error?e.message:String(e)),'error');}}} className="text-red-400 hover:text-red-600 text-[10px]">✕</button>
                                      </div>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                        {p608Quotes.length === 0 && (
                          <p className="text-center text-gray-400 text-xs py-4">{tr608?'Karşılaştırmak için tedarikçi teklifleri ekleyin.':'Add supplier quotes to compare pricing.'}</p>
                        )}
                      </div>
                    );
                  })()}

                  {/* ── Phase 612: Satın Alma Bütçesi ───────────────────────────────── */}
                  {purchasingSubTab === 'satin-butce' && (() => {
                    const tr612 = currentLanguage === 'tr';
                    const totalAllocated = p612Budgets.reduce((s,b)=>s+b.allocated,0);
                    const totalSpent = p612Budgets.reduce((s,b)=>s+b.spent,0);
                    const utilizationPct = totalAllocated>0?(totalSpent/totalAllocated*100):0;
                    return (
                      <motion.div initial={{opacity:0,y:6}} animate={{opacity:1,y:0}} className="space-y-4">
                        <ModuleHeader title={tr612?'Satın Alma Bütçesi':'Purchase Budget'} subtitle={tr612?'Kategori bazında satın alma bütçesi ve harcama takibi':'Purchase budget tracking by category'} icon={ShoppingCart}
                          actionButton={hasFullAccess('satin-alma')&&(<button onClick={()=>setP612ShowForm(v=>!v)} className="apple-button-primary flex items-center gap-2 text-sm"><Plus className="w-4 h-4"/>{tr612?'Bütçe Ekle':'Add Budget'}</button>)} />
                        {p612ShowForm && (
                          <div className="apple-card p-5 space-y-3">
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                              <input className="apple-input" placeholder={tr612?'Kategori':'Category'} value={p612Draft.category} onChange={e=>setP612Draft(d=>({...d,category:e.target.value}))}/>
                              <input type="number" className="apple-input" placeholder={tr612?'Bütçe (₺)':'Budget (₺)'} value={p612Draft.allocated} onChange={e=>setP612Draft(d=>({...d,allocated:e.target.value}))}/>
                              <input type="number" className="apple-input" placeholder={tr612?'Harcanan (₺)':'Spent (₺)'} value={p612Draft.spent} onChange={e=>setP612Draft(d=>({...d,spent:e.target.value}))}/>
                              <input type="month" className="apple-input" value={p612Draft.period} onChange={e=>setP612Draft(d=>({...d,period:e.target.value}))}/>
                            </div>
                            <button onClick={async ()=>{
                              if(!p612Draft.category||!p612Draft.allocated) return;
                              const payload={category:p612Draft.category,allocated:Number(p612Draft.allocated),spent:Number(p612Draft.spent)||0,period:p612Draft.period};
                              try {
                                if(p612EditId){ await updateDoc(doc(db,'purchaseBudgets',p612EditId),payload); }
                                else { await addDoc(collection(db,'purchaseBudgets'),{...payload,createdAt:serverTimestamp()}); }
                                setP612Draft(d=>({...d,category:'',allocated:'',spent:''}));
                                setP612ShowForm(false); setP612EditId(null);
                                toast(tr612?(p612EditId?'Bütçe güncellendi.':'Bütçe eklendi.'):(p612EditId?'Budget updated.':'Budget added.'),'success');
                              } catch(e){ toast((tr612?'Kaydedilemedi: ':'Save failed: ')+(e instanceof Error?e.message:String(e)),'error'); }
                            }} className="apple-button-primary text-xs px-6">{tr612?'Kaydet':'Save'}</button>
                          </div>
                        )}
                        {p612Budgets.length > 0 && (
                          <>
                            <div className="grid grid-cols-3 gap-4">
                              <div className="apple-card p-4 bg-blue-50"><p className="text-[10px] font-bold text-gray-400 uppercase">{tr612?'Toplam Bütçe':'Total Budget'}</p><p className="text-xl font-black text-blue-600">₺{Math.round(totalAllocated).toLocaleString('tr-TR')}</p></div>
                              <div className="apple-card p-4 bg-amber-50"><p className="text-[10px] font-bold text-gray-400 uppercase">{tr612?'Harcanan':'Spent'}</p><p className="text-xl font-black text-amber-600">₺{Math.round(totalSpent).toLocaleString('tr-TR')}</p></div>
                              <div className={`apple-card p-4 ${utilizationPct>90?'bg-red-50':utilizationPct>70?'bg-orange-50':'bg-emerald-50'}`}><p className="text-[10px] font-bold text-gray-400 uppercase">{tr612?'Kullanım':'Utilization'}</p><p className={`text-xl font-black ${utilizationPct>90?'text-red-600':utilizationPct>70?'text-orange-600':'text-emerald-600'}`}>%{utilizationPct.toFixed(1)}</p></div>
                            </div>
                            <div className="space-y-3">
                              {p612Budgets.map(b=>{
                                const pct = b.allocated>0?(b.spent/b.allocated*100):0;
                                const isOver = pct>100;
                                return (
                                  <div key={b.id} className="apple-card p-4">
                                    <div className="flex items-center justify-between mb-2">
                                      <div><p className="font-semibold text-gray-800 text-sm">{b.category}</p><p className="text-[10px] text-gray-400">{b.period}</p></div>
                                      <div className="flex items-center gap-3">
                                      <div className="text-right">
                                        <p className={`text-sm font-bold ${isOver?'text-red-600':'text-gray-700'}`}>₺{Math.round(b.spent).toLocaleString('tr-TR')} / ₺{Math.round(b.allocated).toLocaleString('tr-TR')}</p>
                                        <p className={`text-xs ${isOver?'text-red-500':'text-gray-400'}`}>%{pct.toFixed(1)}{isOver?' ⚠️':''}</p>
                                      </div>
                                      <button type="button" onClick={()=>{setP612Draft({category:b.category,allocated:String(b.allocated),spent:String(b.spent),period:b.period});setP612EditId(b.id);setP612ShowForm(true);}} title={tr612?'Düzenle':'Edit'} className="text-gray-300 hover:text-blue-600 transition-colors"><Edit2 className="w-3.5 h-3.5"/></button>
                                      <button type="button" onClick={async ()=>{try{await deleteDoc(doc(db,'purchaseBudgets',b.id));}catch(e){toast((tr612?'Silinemedi: ':'Delete failed: ')+(e instanceof Error?e.message:String(e)),'error');}}} title="Sil" className="text-gray-300 hover:text-red-600 transition-colors"><Trash2 className="w-3.5 h-3.5"/></button>
                                      </div>
                                    </div>
                                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                                      <div className={`h-full rounded-full transition-all ${isOver?'bg-red-400':pct>70?'bg-amber-400':'bg-emerald-400'}`} style={{width:`${Math.min(pct,100)}%`}}/>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </>
                        )}
                        {p612Budgets.length === 0 && (
                          <div className="text-center py-12"><ShoppingCart className="w-10 h-10 text-gray-200 mx-auto mb-3"/><p className="text-gray-400 text-sm">{tr612?'Satın alma bütçesi ekleyin.':'Add purchase budgets to track spending.'}</p></div>
                        )}
                      </motion.div>
                    );
                  })()}

                  {/* ── Phase 627: Tedarik Zinciri Riski ────────────────────────── */}
                  {purchasingSubTab === 'tedarik-risk' && (() => {
                    const tr627 = currentLanguage === 'tr';
                    const criticalRisks = p627Risks.filter(r=>r.severity==='Kritik'&&r.status==='Aktif').length;
                    const highRisks = p627Risks.filter(r=>r.severity==='Yüksek'&&r.status==='Aktif').length;
                    const sevColor:{[k:string]:string} = {'Kritik':'bg-red-100 text-red-700','Yüksek':'bg-orange-100 text-orange-700','Orta':'bg-amber-100 text-amber-700','Düşük':'bg-gray-100 text-gray-600'};
                    return (
                      <motion.div initial={{opacity:0,y:6}} animate={{opacity:1,y:0}} className="space-y-4">
                        <ModuleHeader title={tr627?'Tedarik Zinciri Riski':'Supply Chain Risk'} subtitle={tr627?'Tedarikçi bazında risk değerlendirmesi ve azaltma planları':'Supplier-level risk assessment and mitigation plans'} icon={AlertTriangle}
                          actionButton={hasFullAccess('satin-alma')&&(<button onClick={()=>setP627ShowForm(v=>!v)} className="apple-button-primary flex items-center gap-2 text-sm"><Plus className="w-4 h-4"/>{tr627?'Risk Ekle':'Add Risk'}</button>)} />
                        {(criticalRisks>0||highRisks>0)&&(
                          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-center gap-3">
                            <AlertTriangle className="w-4 h-4 text-red-500 shrink-0"/>
                            <p className="text-sm font-bold text-red-700">{criticalRisks} {tr627?'kritik,':''} {highRisks} {tr627?'yüksek risk aktif':'high-severity risks active'}</p>
                          </div>
                        )}
                        {p627ShowForm && (
                          <div className="apple-card p-5 space-y-3">
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                              <input className="apple-input col-span-2 md:col-span-1" placeholder={tr627?'Tedarikçi':'Supplier'} value={p627Draft.supplier} onChange={e=>setP627Draft(d=>({...d,supplier:e.target.value}))}/>
                              <select value={p627Draft.riskType} onChange={e=>setP627Draft(d=>({...d,riskType:e.target.value as typeof d.riskType}))} className="apple-input">
                                {['Tedarik Kesintisi','Kalite','Fiyat Artışı','Teslimat Gecikmesi','Diğer'].map(t=><option key={t}>{t}</option>)}
                              </select>
                              <select value={p627Draft.severity} onChange={e=>setP627Draft(d=>({...d,severity:e.target.value as typeof d.severity}))} className="apple-input">
                                {['Düşük','Orta','Yüksek','Kritik'].map(s=><option key={s}>{s}</option>)}
                              </select>
                              <input type="number" min="0" max="100" className="apple-input" placeholder={tr627?'Olasılık %':'Probability %'} value={p627Draft.probability} onChange={e=>setP627Draft(d=>({...d,probability:e.target.value}))}/>
                              <input className="apple-input col-span-2" placeholder={tr627?'Azaltma Planı':'Mitigation Plan'} value={p627Draft.mitigationPlan} onChange={e=>setP627Draft(d=>({...d,mitigationPlan:e.target.value}))}/>
                            </div>
                            <button onClick={async ()=>{
                              if(!p627Draft.supplier) return;
                              const payload={supplier:p627Draft.supplier,riskType:p627Draft.riskType,severity:p627Draft.severity,probability:Number(p627Draft.probability)||0,mitigationPlan:p627Draft.mitigationPlan||''};
                              try {
                                if(p627EditId){ await updateDoc(doc(db,'supplierRisks',p627EditId),payload); }
                                else { await addDoc(collection(db,'supplierRisks'),{...payload,status:'Aktif',createdAt:serverTimestamp()}); }
                                setP627Draft(d=>({...d,supplier:'',probability:'50',mitigationPlan:''}));
                                setP627ShowForm(false); setP627EditId(null);
                                toast(tr627?(p627EditId?'Risk güncellendi.':'Risk eklendi.'):(p627EditId?'Risk updated.':'Risk added.'),'success');
                              } catch(e){ toast((tr627?'Kaydedilemedi: ':'Save failed: ')+(e instanceof Error?e.message:String(e)),'error'); }
                            }} className="apple-button-primary text-xs px-6">{tr627?'Kaydet':'Save'}</button>
                          </div>
                        )}
                        {p627Risks.length > 0 && (
                          <div className="space-y-2">
                            {[...p627Risks].sort((a,b)=>{const o={Kritik:0,Yüksek:1,Orta:2,Düşük:3};return o[a.severity]-o[b.severity];}).map(r=>{
                              const score = r.probability*(r.severity==='Kritik'?4:r.severity==='Yüksek'?3:r.severity==='Orta'?2:1)/100;
                              return (
                                <div key={r.id} className="flex items-center gap-3 border border-gray-100 rounded-xl px-4 py-3">
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <p className="font-semibold text-gray-800 text-sm">{r.supplier}</p>
                                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${sevColor[r.severity]}`}>{r.severity}</span>
                                      <span className="text-[10px] text-gray-400">{r.riskType}</span>
                                    </div>
                                    {r.mitigationPlan&&<p className="text-xs text-gray-400 mt-0.5 truncate">{r.mitigationPlan}</p>}
                                  </div>
                                  <div className="text-right shrink-0">
                                    <p className="text-xs font-bold text-gray-700">{tr627?'Risk Skoru:':'Score:'} {score.toFixed(2)}</p>
                                    <select value={r.status} onChange={async e=>{try{await updateDoc(doc(db,'supplierRisks',r.id),{status:e.target.value});}catch(err){toast((tr627?'Güncellenemedi: ':'Update failed: ')+(err instanceof Error?err.message:String(err)),'error');}}} className="text-xs border border-gray-200 rounded-lg px-1 py-0.5 mt-1 bg-white">
                                      {['Aktif','Azaltıldı','Kabul Edildi'].map(s=><option key={s}>{s}</option>)}
                                    </select>
                                  </div>
                                  <button type="button" onClick={()=>{setP627Draft({supplier:r.supplier,riskType:r.riskType,severity:r.severity,probability:String(r.probability),mitigationPlan:r.mitigationPlan||''});setP627EditId(r.id);setP627ShowForm(true);}} title={tr627?'Düzenle':'Edit'} className="text-gray-300 hover:text-blue-600 transition-colors shrink-0"><Edit2 className="w-3.5 h-3.5"/></button>
                                  <button type="button" onClick={async ()=>{try{await deleteDoc(doc(db,'supplierRisks',r.id));}catch(e){toast((tr627?'Silinemedi: ':'Delete failed: ')+(e instanceof Error?e.message:String(e)),'error');}}} title="Sil" className="text-gray-300 hover:text-red-600 transition-colors shrink-0"><Trash2 className="w-3.5 h-3.5"/></button>
                                </div>
                              );
                            })}
                          </div>
                        )}
                        {p627Risks.length===0&&<div className="text-center py-10"><AlertTriangle className="w-10 h-10 text-gray-200 mx-auto mb-3"/><p className="text-gray-400 text-sm">{tr627?'Tedarik zinciri riski ekleyin.':'Add supply chain risk assessments.'}</p></div>}
                      </motion.div>
                    );
                  })()}

                </>
              )}
            </motion.div>
  );
}
