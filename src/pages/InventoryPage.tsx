import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Plus, Search, RefreshCw, Package, DollarSign, ChevronDown,
  Calculator, BookOpen, AlertCircle, Trash2, Edit2,
} from 'lucide-react';
import { Tooltip, ResponsiveContainer, PieChart as RePieChart, Pie, Cell } from 'recharts';
import { db } from '../firebase';
import { doc, collection, addDoc, updateDoc, deleteDoc, serverTimestamp } from '../lib/dbClient';
import { cn } from '../lib/utils';
import { itemCostTRY } from '../utils/cost';
import AIInlineNudge from '../components/AIInlineNudge';
import KpiCurrencyToggle from '../components/KpiCurrencyToggle';
import type { LabelItem } from '../components/LabelSheetModal';
import type { InventoryItem, Order, Warehouse, InventoryMovement, Consignment, StockDiscrepancy } from '../types';

const InventoryView = React.lazy(() => import('../components/InventoryView'));

interface Batch579 { id: string; sku: string; productName: string; batchNo: string; expiryDate?: string; qty: number; location?: string; status: 'Aktif' | 'Karantina' | 'Kullanıldı' }
interface Consign588 { id: string; supplierName: string; productName: string; sku: string; qty: number; agreedPrice: number; locationCode?: string; startDate: string; status: 'Depoda' | 'Satıldı' | 'İade Edildi' }
interface CountItem584 { id: string; sku: string; name: string; systemQty: number; countedQty?: number; variance?: number }
interface Warranty642 { id: string; productName: string; sku: string; serialNo: string; customerName: string; purchaseDate: string; warrantyMonths: number; status: 'Aktif' | 'Sona Erdi' | 'Talep Açık' }

interface Props {
  currentLanguage: 'tr' | 'en';
  currentT: Record<string, string>;
  hasFullAccess: (tab: string) => boolean;
  user: { email?: string | null; uid?: string; displayName?: string | null } | null;
  userRole: string | null;
  darkMode: boolean;
  inventory: InventoryItem[];
  inventoryMovements: InventoryMovement[];
  inventoryCategories: string[];
  orders: Order[];
  warehouses: Warehouse[];
  consignments: Consignment[];
  stockDiscrepancies: StockDiscrepancy[];
  exchangeRates: Record<string, number> | null;
  fmtKpi: (value: number, format?: 'full' | 'K', decimals?: number) => string;
  toast: (msg: string, type?: string) => void;
  kpiCurrency: 'TRY' | 'USD' | 'EUR';
  setKpiCurrency: React.Dispatch<React.SetStateAction<'TRY' | 'USD' | 'EUR'>>;
  selectedCategory: string;
  setSelectedCategory: React.Dispatch<React.SetStateAction<string>>;
  setActiveTab: (tab: string) => void;
  setLabelItems: React.Dispatch<React.SetStateAction<LabelItem[] | null>>;
  setQuickPOProduct: React.Dispatch<React.SetStateAction<{ name: string; sku: string } | null>>;
  handleFinalizeCycleCount: () => Promise<void>;
  setShowStockCount: React.Dispatch<React.SetStateAction<boolean>>;
  setStockCountDraft: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  setStockCountSearch: React.Dispatch<React.SetStateAction<string>>;

  p561ShowAll: boolean;
  setP561ShowAll: React.Dispatch<React.SetStateAction<boolean>>;
  p562ShowReservations: boolean;
  setP562ShowReservations: React.Dispatch<React.SetStateAction<boolean>>;
  p568Overhead: number;
  setP568Overhead: React.Dispatch<React.SetStateAction<number>>;
  p568SortBy: 'margin' | 'cost' | 'name';
  setP568SortBy: React.Dispatch<React.SetStateAction<'margin' | 'cost' | 'name'>>;
  p574ValMethod: 'cost' | 'retail' | 'weighted';
  setP574ValMethod: React.Dispatch<React.SetStateAction<'cost' | 'retail' | 'weighted'>>;
  p579Batches: Batch579[];
  setP579Batches: React.Dispatch<React.SetStateAction<Batch579[]>>;
  p579ShowForm: boolean;
  setP579ShowForm: React.Dispatch<React.SetStateAction<boolean>>;
  p579Draft: { sku: string; productName: string; batchNo: string; expiryDate: string; qty: string; location: string };
  setP579Draft: React.Dispatch<React.SetStateAction<{ sku: string; productName: string; batchNo: string; expiryDate: string; qty: string; location: string }>>;
  p579Search: string;
  setP579Search: React.Dispatch<React.SetStateAction<string>>;
  p584CountItems: CountItem584[];
  setP584CountItems: React.Dispatch<React.SetStateAction<CountItem584[]>>;
  p584Active: boolean;
  setP584Active: React.Dispatch<React.SetStateAction<boolean>>;
  p584Finalizing: boolean;
  p584SessionId: string | null;
  setP584SessionId: React.Dispatch<React.SetStateAction<string | null>>;
  p588Consign: Consign588[];
  setP588Consign: React.Dispatch<React.SetStateAction<Consign588[]>>;
  p588ShowForm: boolean;
  setP588ShowForm: React.Dispatch<React.SetStateAction<boolean>>;
  p588Draft: { supplierName: string; productName: string; sku: string; qty: string; agreedPrice: string; locationCode: string; startDate: string };
  setP588Draft: React.Dispatch<React.SetStateAction<{ supplierName: string; productName: string; sku: string; qty: string; agreedPrice: string; locationCode: string; startDate: string }>>;
  p611Period: '30d' | '90d' | '180d';
  setP611Period: React.Dispatch<React.SetStateAction<'30d' | '90d' | '180d'>>;
  p642Warranties: Warranty642[];
  setP642Warranties: React.Dispatch<React.SetStateAction<Warranty642[]>>;
  p642ShowForm: boolean;
  setP642ShowForm: React.Dispatch<React.SetStateAction<boolean>>;
  p642Draft: { productName: string; sku: string; serialNo: string; customerName: string; purchaseDate: string; warrantyMonths: string };
  setP642Draft: React.Dispatch<React.SetStateAction<{ productName: string; sku: string; serialNo: string; customerName: string; purchaseDate: string; warrantyMonths: string }>>;
  p644Horizon: number;
  setP644Horizon: React.Dispatch<React.SetStateAction<number>>;
}

export default function InventoryPage(props: Props) {
  const {
    currentLanguage, currentT, hasFullAccess, user, userRole, darkMode,
    inventory, inventoryMovements, inventoryCategories, orders, warehouses, consignments, stockDiscrepancies,
    exchangeRates, fmtKpi, toast, kpiCurrency, setKpiCurrency,
    selectedCategory, setSelectedCategory, setActiveTab, setLabelItems, setQuickPOProduct, handleFinalizeCycleCount,
    setShowStockCount, setStockCountDraft, setStockCountSearch,
    p561ShowAll, setP561ShowAll, p562ShowReservations, setP562ShowReservations,
    p568Overhead, setP568Overhead, p568SortBy, setP568SortBy, p574ValMethod, setP574ValMethod,
    p579Batches, setP579Batches, p579ShowForm, setP579ShowForm, p579Draft, setP579Draft, p579Search, setP579Search,
    p584CountItems, setP584CountItems, p584Active, setP584Active, p584Finalizing, p584SessionId, setP584SessionId,
    p588Consign, setP588Consign, p588ShowForm, setP588ShowForm, p588Draft, setP588Draft,
    p611Period, setP611Period,
    p642Warranties, setP642Warranties, p642ShowForm, setP642ShowForm, p642Draft, setP642Draft,
    p644Horizon, setP644Horizon,
  } = props;
  // Kalıcılaştırma (2026-07-21): düzenleme modu kimlikleri
  const [p588EditId, setP588EditId] = React.useState<string | null>(null);
  const [p579EditId, setP579EditId] = React.useState<string | null>(null);

  return (
            <motion.div key="inventory" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
              <AIInlineNudge
                context="inventory"
                currentLanguage={currentLanguage}
                data={{ lowStockCount: inventory.filter(i=>(i.stockLevel??0)<=(i.lowStockThreshold??5)).length }}
                onAction={a => { if(a==='go-low-stock') window.scrollTo({top:400,behavior:'smooth'}); }}
              />
              {/* ── Ürün tablosu — sayfanın ana içeriği, en üstte ── */}
              <InventoryView
                inventory={inventory}
                categories={inventoryCategories}
                selectedCategory={selectedCategory}
                setSelectedCategory={setSelectedCategory}
                currentT={currentT}
                currentLanguage={currentLanguage}
                isAuthenticated={!!user}
                userRole={userRole}
                inventoryMovements={inventoryMovements}
                warehouses={warehouses}
                onPrintLabels={setLabelItems}
                onQuickPO={(item) => { setQuickPOProduct(item); setActiveTab('satin-alma'); }}
                exchangeRates={exchangeRates}
                consignments={consignments}
                stockDiscrepancies={stockDiscrepancies}
              />

              {/* ── Phase 94: Inventory KPI Summary Strip ── */}
              {inventory.length > 0 && (() => {
                const totalSKUs    = inventory.length;
                const totalUnits   = inventory.reduce((s, i) => s + (i.stockLevel ?? 0), 0);
                const outOfStock   = inventory.filter(i => (i.stockLevel ?? 0) === 0).length;
                const stockVal     = inventory.reduce((s, i) => s + (i.prices?.['Retail'] ?? i.price ?? 0) * (i.stockLevel ?? 0), 0);
                const costVal      = inventory.reduce((s, i) => s + itemCostTRY(i, exchangeRates) * (i.stockLevel ?? 0), 0);
                const avgMarginPct = stockVal > 0 && costVal > 0
                  ? Math.round(((stockVal - costVal) / stockVal) * 100)
                  : null;
                const p94Rate = kpiCurrency === 'USD' ? (exchangeRates?.USD||1) : kpiCurrency === 'EUR' ? (exchangeRates?.EUR||1) : 1;
                const p94Sym  = kpiCurrency === 'TRY' ? '₺' : kpiCurrency === 'USD' ? '$' : '€';
                const p94Val  = kpiCurrency === 'TRY' ? stockVal : stockVal / p94Rate;
                return (
                  <>
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{currentLanguage === 'tr' ? 'Envanter Özeti' : 'Inventory Summary'}</p>
                    <div className="flex items-center gap-2">
                      {/* Phase 507: Quick Stock Count button */}
                      <button
                        onClick={() => { setStockCountDraft({}); setStockCountSearch(''); setShowStockCount(true); }}
                        className="flex items-center gap-1.5 text-xs font-bold text-gray-500 hover:text-brand bg-white border border-gray-200 hover:border-brand/30 px-3 py-1.5 rounded-full transition-all shadow-sm"
                        title={currentLanguage === 'tr' ? 'Hızlı stok sayımı' : 'Quick stock count'}
                      >
                        <Calculator className="w-3.5 h-3.5" />
                        {currentLanguage === 'tr' ? 'Stok Sayımı' : 'Stock Count'}
                      </button>
                      <KpiCurrencyToggle kpiCurrency={kpiCurrency} setKpiCurrency={setKpiCurrency} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {[
                      { label: currentLanguage === 'tr' ? 'Toplam SKU' : 'Total SKUs',       value: totalSKUs.toString(),  icon: '📋', color: 'text-gray-800',    bg: 'bg-white' },
                      { label: currentLanguage === 'tr' ? 'Stok Değeri' : 'Stock Value',     value: `${p94Sym}${p94Val.toLocaleString('tr-TR',{maximumFractionDigits:0})}`, icon: '💰', color: 'text-blue-700', bg: 'bg-blue-50' },
                      { label: currentLanguage === 'tr' ? 'Stok Dışı' : 'Out of Stock',      value: outOfStock.toString(), icon: '⚠️', color: outOfStock > 0 ? 'text-red-600' : 'text-emerald-700', bg: outOfStock > 0 ? 'bg-red-50' : 'bg-emerald-50' },
                      { label: currentLanguage === 'tr' ? 'Ort. Marj' : 'Avg Margin',        value: avgMarginPct != null ? `${avgMarginPct}%` : `${totalUnits.toLocaleString()} ${currentLanguage==='tr'?'birim':'units'}`, icon: avgMarginPct != null ? '📊' : '📦', color: avgMarginPct != null ? (avgMarginPct >= 40 ? 'text-emerald-700' : avgMarginPct >= 20 ? 'text-amber-700' : 'text-red-600') : 'text-purple-700', bg: 'bg-white' },
                    ].map((s, i) => (
                      <div key={i} className={`rounded-xl border border-gray-100 shadow-sm px-4 py-3 ${s.bg}`}>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-base">{s.icon}</span>
                          <p className={`text-xl font-black ${s.color}`}>{s.value}</p>
                        </div>
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">{s.label}</p>
                      </div>
                    ))}
                  </div>
                  </>
                );
              })()}

              {/* ── Phase 510: Inventory ABC Analysis ── */}
              {inventory.length >= 5 && (() => {
                const sorted510 = [...inventory].sort((a, b) =>
                  ((b.prices?.['Retail'] ?? b.price ?? 0) * (b.stockLevel ?? 0)) - ((a.prices?.['Retail'] ?? a.price ?? 0) * (a.stockLevel ?? 0))
                );
                const totalVal510 = sorted510.reduce((s, i) => s + (i.prices?.['Retail'] ?? i.price ?? 0) * (i.stockLevel ?? 0), 0);
                let cum510 = 0;
                const classes510 = { A: 0, B: 0, C: 0 };
                const classA: string[] = [], classB: string[] = [], classC: string[] = [];
                for (const item of sorted510) {
                  const v = (item.prices?.['Retail'] ?? item.price ?? 0) * (item.stockLevel ?? 0);
                  cum510 += v;
                  const pct = totalVal510 > 0 ? cum510 / totalVal510 : 1;
                  if (pct <= 0.7) { classes510.A++; classA.push(item.name); }
                  else if (pct <= 0.9) { classes510.B++; classB.push(item.name); }
                  else { classes510.C++; classC.push(item.name); }
                }
                const aVal = classA.length / sorted510.length * 100;
                const bVal = classB.length / sorted510.length * 100;
                const cVal = classC.length / sorted510.length * 100;
                return (
                  <div className={cn("rounded-2xl border px-5 py-4", darkMode ? "bg-white/5 border-white/10" : "bg-white border-gray-100 shadow-sm")}>
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                        {currentLanguage === 'tr' ? 'ABC Analizi (Stok Değeri)' : 'ABC Analysis (Stock Value)'}
                      </p>
                      <span className="text-[10px] text-gray-400">{sorted510.length} SKU</span>
                    </div>
                    {/* Stacked bar */}
                    <div className="flex h-3 rounded-full overflow-hidden gap-0.5 mb-3">
                      <div className="bg-emerald-400 rounded-l-full transition-all" style={{ width: `${aVal}%` }} title={`A: ${classes510.A} items`} />
                      <div className="bg-amber-400 transition-all" style={{ width: `${bVal}%` }} title={`B: ${classes510.B} items`} />
                      <div className="bg-gray-300 rounded-r-full transition-all" style={{ width: `${cVal}%` }} title={`C: ${classes510.C} items`} />
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      {[
                        { cls: 'A', count: classes510.A, color: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-100', desc: currentLanguage === 'tr' ? 'Yüksek Değer (İlk %70)' : 'High Value (Top 70%)', top: classA[0] },
                        { cls: 'B', count: classes510.B, color: 'text-amber-700',   bg: 'bg-amber-50',   border: 'border-amber-100',   desc: currentLanguage === 'tr' ? 'Orta Değer (%70-90)'  : 'Mid Value (70-90%)',  top: classB[0] },
                        { cls: 'C', count: classes510.C, color: 'text-gray-500',    bg: 'bg-gray-50',    border: 'border-gray-100',    desc: currentLanguage === 'tr' ? 'Düşük Değer (Son %10)' : 'Low Value (Bottom 10%)', top: classC[0] },
                      ].map(x => (
                        <div key={x.cls} className={cn("rounded-xl border p-3", x.bg, x.border)}>
                          <div className="flex items-center gap-2 mb-1">
                            <span className={cn("text-lg font-black", x.color)}>Sınıf {x.cls}</span>
                            <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded-full", x.bg, x.color)}>{x.count} SKU</span>
                          </div>
                          <p className="text-[10px] text-gray-400">{x.desc}</p>
                          {x.top && <p className="text-[9px] text-gray-500 truncate mt-1 font-medium" title={x.top}>{x.top}</p>}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* ── Phase 75: Inventory Category Distribution ── */}
              {inventory.length > 0 && (() => {
                const catMap: Record<string, { units: number; value: number }> = {};
                for (const item of inventory) {
                  const cat = item.category || (currentLanguage === 'tr' ? 'Diğer' : 'Other');
                  catMap[cat] = catMap[cat] || { units: 0, value: 0 };
                  catMap[cat].units += item.stockLevel ?? 0;
                  catMap[cat].value += (item.prices?.['Retail'] ?? item.price ?? 0) * (item.stockLevel ?? 0);
                }
                const catData = Object.entries(catMap)
                  .map(([name, { units, value }]) => ({ name, units, value }))
                  .sort((a, b) => b.value - a.value)
                  .slice(0, 6);
                if (catData.length < 2) return null;
                const totalVal = catData.reduce((s, c) => s + c.value, 0);
                const PALETTE = ['#ff4000', '#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#6b7280'];
                return (
                  <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider">
                        {currentLanguage === 'tr' ? 'Kategori Dağılımı' : 'Category Distribution'}
                      </h3>
                      <span className="text-[10px] text-gray-400">
                        {currentLanguage === 'tr' ? 'Perakende değerine göre' : 'By retail value'}
                      </span>
                    </div>
                    <div className="flex items-center gap-6">
                      {/* Donut via Recharts */}
                      <div className="flex-shrink-0">
                        <ResponsiveContainer width={120} height={120}>
                          <RePieChart>
                            <Pie
                              data={catData}
                              dataKey="value"
                              nameKey="name"
                              cx="50%"
                              cy="50%"
                              innerRadius={36}
                              outerRadius={54}
                              strokeWidth={2}
                              stroke="#fff"
                            >
                              {catData.map((_, i) => (
                                <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                              ))}
                            </Pie>
                            <Tooltip
                              formatter={(v: number) => [`₺${v.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}`, currentLanguage === 'tr' ? 'Değer' : 'Value']}
                              contentStyle={{ fontSize: 11, borderRadius: 8 }}
                            />
                          </RePieChart>
                        </ResponsiveContainer>
                      </div>
                      {/* Legend */}
                      <div className="flex-1 space-y-1.5 min-w-0">
                        {catData.map((c, i) => {
                          const pct = totalVal > 0 ? Math.round((c.value / totalVal) * 100) : 0;
                          return (
                            <div key={c.name} className="flex items-center gap-2">
                              <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: PALETTE[i % PALETTE.length] }} />
                              <span className="text-xs text-gray-700 truncate flex-1">{c.name}</span>
                              <span className="text-[10px] font-bold text-gray-500 flex-shrink-0">{pct}%</span>
                              <span className="text-[10px] text-gray-400 flex-shrink-0 hidden sm:inline">{c.units} {currentLanguage === 'tr' ? 'ad.' : 'u.'}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* ── Phase 114: Demand Forecasting ── */}
              {inventoryMovements.length > 0 && inventory.length > 0 && (() => {
                const now114 = Date.now();
                const MS_30D = 30 * 24 * 60 * 60 * 1000;
                const MS_60D = 60 * 24 * 60 * 60 * 1000;

                // Build monthly consumption map: productName → [last30, prev30]
                const cons: Record<string, { last30: number; prev30: number }> = {};
                for (const m of inventoryMovements) {
                  if (m.type !== 'out') continue;
                  const ts = (() => {
                    const t = m.timestamp;
                    if (!t) return 0;
                    if (typeof (t as { toDate?: () => Date }).toDate === 'function') return (t as { toDate: () => Date }).toDate().getTime();
                    return new Date(t as string | number).getTime();
                  })();
                  const age = now114 - ts;
                  const key = (m.productId as string | undefined) || m.productName;
                  cons[key] = cons[key] || { last30: 0, prev30: 0 };
                  if (age <= MS_30D) cons[key].last30 += m.quantity;
                  else if (age <= MS_60D) cons[key].prev30 += m.quantity;
                }

                // Build forecasts for all products with movement data
                type Forecast = { item: InventoryItem; last30: number; trend: number; nextMonth: number; weeksLeft: number };
                const forecasts: Forecast[] = [];
                for (const item of inventory) {
                  const key = item.id || item.name;
                  const data = cons[key] ?? cons[item.name];
                  if (!data || data.last30 === 0) continue;
                  const trend   = data.prev30 > 0 ? ((data.last30 - data.prev30) / data.prev30) * 100 : 0;
                  const nextMonth = Math.ceil(data.last30 * (1 + Math.max(trend / 100, -0.3)));
                  const stock   = item.stockLevel ?? 0;
                  const dailyRate = data.last30 / 30;
                  const weeksLeft = dailyRate > 0 ? Math.floor((stock / dailyRate) / 7) : 99;
                  forecasts.push({ item, last30: data.last30, trend, nextMonth, weeksLeft });
                }
                forecasts.sort((a, b) => a.weeksLeft - b.weeksLeft);
                if (forecasts.length === 0) return null;

                const urgent = forecasts.filter(f => f.weeksLeft <= 4);

                return (
                  <div className="bg-white border border-blue-100 rounded-2xl shadow-sm overflow-hidden">
                    <div className="px-5 py-4 border-b border-blue-50 flex items-center justify-between bg-blue-50/40">
                      <div className="flex items-center gap-2">
                        <span className="text-base">🔮</span>
                        <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? 'Talep Tahmini' : 'Demand Forecast'}</h3>
                        {urgent.length > 0 && (
                          <span className="bg-red-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full">
                            {urgent.length} {currentLanguage === 'tr' ? 'acil' : 'urgent'}
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] text-blue-500">{currentLanguage === 'tr' ? '30 günlük harekete göre' : 'Based on 30-day velocity'}</span>
                    </div>
                    <div className="divide-y divide-gray-50 max-h-56 overflow-y-auto">
                      {forecasts.slice(0, 10).map(({ item, last30, trend, nextMonth, weeksLeft }) => {
                        const urgency = weeksLeft <= 1 ? 'text-red-600' : weeksLeft <= 3 ? 'text-amber-600' : 'text-emerald-600';
                        const trendStr = trend > 5 ? `↑${Math.round(trend)}%` : trend < -5 ? `↓${Math.round(Math.abs(trend))}%` : '→';
                        const trendColor = trend > 5 ? 'text-emerald-600' : trend < -5 ? 'text-red-500' : 'text-gray-400';
                        return (
                          <div key={item.id} className="flex items-center gap-4 px-5 py-3">
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-bold text-gray-800 truncate">{item.name}</p>
                              <p className="text-[10px] text-gray-400">
                                {currentLanguage === 'tr' ? `Son 30 gün: ${last30} adet · Sonraki ay tahmini: ${nextMonth} adet` : `Last 30d: ${last30} units · Next month est.: ${nextMonth} units`}
                              </p>
                            </div>
                            <span className={`text-[10px] font-bold flex-shrink-0 ${trendColor}`}>{trendStr}</span>
                            <div className="flex-shrink-0 text-right">
                              <p className={`text-xs font-black ${urgency}`}>
                                {weeksLeft >= 99 ? '∞' : weeksLeft} {currentLanguage === 'tr' ? 'hafta' : 'wk'}
                              </p>
                              <p className="text-[9px] text-gray-400">{currentLanguage === 'tr' ? 'stok ömrü' : 'runway'}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="px-5 py-2.5 bg-gray-50/60 border-t border-gray-100 text-[10px] text-gray-400">
                      {currentLanguage === 'tr'
                        ? `${forecasts.length} ürün analiz edildi · Stok ömrü = mevcut stok ÷ günlük ortalama çıkış`
                        : `${forecasts.length} products analyzed · Runway = current stock ÷ avg daily outbound`}
                    </div>
                  </div>
                );
              })()}

              {/* ── Phase 157: Product Margin Alert Panel ── */}
              {inventory.filter(i => i.costPrice > 0).length > 0 && (() => {
                const threshold157 = 15; // warn below 15% margin
                const lowMarginItems = inventory
                  .filter(i => {
                    const price = i.prices?.['Retail'] ?? i.price ?? 0;
                    const cost = i.costPrice ?? i.cost ?? 0;
                    if (price <= 0 || cost <= 0) return false;
                    const margin = ((price - cost) / price) * 100;
                    return margin < threshold157;
                  })
                  .map(i => {
                    const price = i.prices?.['Retail'] ?? i.price ?? 0;
                    const cost = i.costPrice ?? i.cost ?? 0;
                    return { ...i, margin: Math.round(((price - cost) / price) * 100), price, cost };
                  })
                  .sort((a, b) => a.margin - b.margin)
                  .slice(0, 10);
                if (lowMarginItems.length === 0) return null;
                return (
                  <div className="apple-card p-6 border border-amber-100">
                    <div className="flex items-center gap-2 mb-4">
                      <AlertCircle className="w-4 h-4 text-amber-500" />
                      <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? 'Düşük Marjlı Ürünler' : 'Low Margin Products'}</h3>
                      <span className="ml-auto text-xs text-amber-600 font-semibold bg-amber-50 px-2 py-0.5 rounded-full">
                        {lowMarginItems.length} {currentLanguage==='tr'?'ürün %'+threshold157+' altında':'products below '+threshold157+'%'}
                      </span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-gray-100">
                            <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500">{currentLanguage==='tr'?'Ürün':'Product'}</th>
                            <th className="text-right py-2 px-2 text-xs font-semibold text-gray-500">{currentLanguage==='tr'?'Maliyet':'Cost'}</th>
                            <th className="text-right py-2 px-2 text-xs font-semibold text-gray-500">{currentLanguage==='tr'?'Satış':'Price'}</th>
                            <th className="text-right py-2 px-2 text-xs font-semibold text-gray-500">{currentLanguage==='tr'?'Marj':'Margin'}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                          {lowMarginItems.map(item => (
                            <tr key={item.id} className={item.margin < 0 ? 'bg-red-50/40' : ''}>
                              <td className="py-2 px-2 font-medium text-gray-800 text-xs truncate max-w-[180px]">{item.name}</td>
                              <td className="py-2 px-2 text-right text-xs text-gray-500 tabular-nums">{fmtKpi(item.cost)}</td>
                              <td className="py-2 px-2 text-right text-xs text-gray-700 tabular-nums">{fmtKpi(item.price)}</td>
                              <td className="py-2 px-2 text-right">
                                <span className={`text-xs font-bold tabular-nums ${item.margin < 0 ? 'text-red-600' : item.margin < 10 ? 'text-orange-600' : 'text-amber-600'}`}>
                                  %{item.margin}
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

              {/* ── Phase 561: MRP — Tedarik Öneri Raporu ─────────────────────────── */}
              {(() => {
                const tr561 = currentLanguage === 'tr';
                // Build demand map from open orders (Pending / Processing)
                const demandMap: Record<string, { name: string; demanded: number; stock: number; sku: string }> = {};
                orders.filter(o => o.status === 'Pending' || o.status === 'Processing').forEach(o => {
                  (o.lineItems || []).forEach(li => {
                    const invId = li.inventoryId || li.id;
                    if (!invId) return;
                    if (!demandMap[invId]) {
                      const invItem = inventory.find(i => i.id === invId || i.sku === li.sku);
                      demandMap[invId] = { name: li.name || li.title || '?', demanded: 0, stock: invItem?.stockLevel ?? 0, sku: li.sku || '' };
                    }
                    demandMap[invId].demanded += li.quantity || 0;
                  });
                });
                const suggestions = Object.values(demandMap).filter(d => d.demanded >= d.stock);
                if (suggestions.length === 0) return null;
                const visible = p561ShowAll ? suggestions : suggestions.slice(0,5);
                return (
                  <div className="apple-card p-5 border-l-4 border-blue-400">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <Package className="w-4 h-4 text-blue-500" />
                        <h4 className="font-bold text-blue-800 text-sm">
                          {tr561 ? `MRP — ${suggestions.length} Ürün Satın Alma Önerisi` : `MRP — ${suggestions.length} Purchase Suggestion${suggestions.length>1?'s':''}`}
                        </h4>
                      </div>
                      {suggestions.length > 5 && (
                        <button onClick={() => setP561ShowAll(v => !v)} className="text-xs text-blue-600 font-semibold hover:underline">
                          {p561ShowAll ? (tr561?'Daha az göster':'Show less') : (tr561?'Tümünü göster':'Show all')}
                        </button>
                      )}
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-blue-100">
                            {['SKU', tr561?'Ürün':'Product', tr561?'Stok':'Stock', tr561?'Talep':'Demand', tr561?'Açık':'Shortage', tr561?'Öneri':'Suggestion'].map(h => (
                              <th key={h} className="py-2 px-3 text-left text-[10px] font-bold text-blue-400 uppercase">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-blue-50">
                          {visible.map((s, i) => {
                            const shortage = s.demanded - s.stock;
                            const suggestQty = Math.ceil(shortage * 1.2); // 20% buffer
                            return (
                              <tr key={i} className="hover:bg-blue-50/50">
                                <td className="px-3 py-2 font-mono text-blue-500">{s.sku || '—'}</td>
                                <td className="px-3 py-2 font-semibold text-gray-800 max-w-[180px] truncate">{s.name}</td>
                                <td className="px-3 py-2 text-gray-600">{s.stock}</td>
                                <td className="px-3 py-2 text-amber-700 font-bold">{s.demanded}</td>
                                <td className="px-3 py-2 text-red-600 font-bold">−{shortage}</td>
                                <td className="px-3 py-2">
                                  <button onClick={() => { setQuickPOProduct({ name: s.name, sku: s.sku }); setActiveTab('satin-alma'); }}
                                    className="text-[10px] font-bold text-white bg-blue-500 hover:bg-blue-600 px-2.5 py-1 rounded-lg transition-colors whitespace-nowrap">
                                    + {suggestQty} {tr561?'birim al':'units PO'}
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <p className="text-[10px] text-blue-400 mt-2">{tr561?'Sadece bekleyen ve hazırlanan siparişler dikkate alınmıştır.':'Only Pending and Processing orders included.'}</p>
                  </div>
                );
              })()}

              {/* ── Phase 562: Stok Rezervasyon Özeti ─────────────────────────────── */}
              {(() => {
                const tr562 = currentLanguage === 'tr';
                // Build reservation map: sum quantities from Pending+Processing orders per sku
                const reservedMap: Record<string, { name: string; reserved: number; available: number; sku: string; stockLevel: number }> = {};
                orders.filter(o => o.status === 'Pending' || o.status === 'Processing').forEach(o => {
                  (o.lineItems || []).forEach(li => {
                    const key = li.sku || li.id;
                    if (!key) return;
                    if (!reservedMap[key]) {
                      const inv = inventory.find(i => i.sku === li.sku || i.id === li.inventoryId);
                      const stock = inv?.stockLevel ?? 0;
                      reservedMap[key] = { name: li.name || li.title || '?', reserved: 0, available: stock, sku: key, stockLevel: stock };
                    }
                    reservedMap[key].reserved += li.quantity || 0;
                  });
                });
                const reservations = Object.values(reservedMap).filter(r => r.reserved > 0);
                if (reservations.length === 0) return null;

                return (
                  <div className="apple-card overflow-hidden">
                    <button onClick={() => setP562ShowReservations(v => !v)}
                      className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50/50 transition-colors">
                      <div className="flex items-center gap-2">
                        <BookOpen className="w-4 h-4 text-purple-500" />
                        <h4 className="font-bold text-purple-800 text-sm">
                          {tr562 ? `Stok Rezervasyonları — ${reservations.length} Ürün` : `Stock Reservations — ${reservations.length} Item${reservations.length>1?'s':''}`}
                        </h4>
                      </div>
                      <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${p562ShowReservations?'rotate-180':''}`} />
                    </button>
                    <AnimatePresence>
                      {p562ShowReservations && (
                        <motion.div initial={{height:0,opacity:0}} animate={{height:'auto',opacity:1}} exit={{height:0,opacity:0}} className="overflow-hidden">
                          <div className="overflow-x-auto border-t border-gray-100">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="bg-purple-50 border-b border-purple-100">
                                  {['SKU', tr562?'Ürün':'Product', tr562?'Stok':'Total Stock', tr562?'Rezerve':'Reserved', tr562?'Kullanılabilir':'Available'].map(h => (
                                    <th key={h} className="py-2 px-4 text-left text-[10px] font-bold text-purple-400 uppercase">{h}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-50">
                                {reservations.map((r, i) => {
                                  const avail = r.stockLevel - r.reserved;
                                  return (
                                    <tr key={i} className={`hover:bg-gray-50/50 ${avail < 0 ? 'bg-red-50/30' : ''}`}>
                                      <td className="px-4 py-2.5 font-mono text-gray-500">{r.sku}</td>
                                      <td className="px-4 py-2.5 font-semibold text-gray-800 max-w-[180px] truncate">{r.name}</td>
                                      <td className="px-4 py-2.5 text-gray-600">{r.stockLevel}</td>
                                      <td className="px-4 py-2.5 font-bold text-purple-700">{r.reserved}</td>
                                      <td className="px-4 py-2.5">
                                        <span className={`font-bold ${avail < 0 ? 'text-red-600' : avail === 0 ? 'text-amber-600' : 'text-emerald-700'}`}>
                                          {avail}
                                        </span>
                                        {avail < 0 && <span className="ml-1 text-[9px] font-bold text-white bg-red-500 px-1 py-0.5 rounded">{tr562?'Açık':'OVERSOLD'}</span>}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                          <p className="px-4 pb-3 pt-2 text-[10px] text-gray-400">{tr562?'Bekleyen ve hazırlanan siparişlerden rezervasyon türetilmiştir.':'Reservations derived from Pending and Processing orders.'}</p>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })()}

              {/* ── Phase 568: Ürün Maliyet Kartı ────────────────────────────────── */}
              {inventory.length > 0 && (() => {
                const tr568 = currentLanguage === 'tr';
                const itemsWithCost = inventory
                  .filter(i => (i.costPrice || i.cost || 0) > 0)
                  .map(i => {
                    const cost = i.costPrice || i.cost || 0;
                    const overhead = cost * (p568Overhead / 100);
                    const totalCost = cost + overhead;
                    const price = i.prices?.['Retail'] ?? i.price ?? 0;
                    const margin = price > 0 ? ((price - totalCost) / price) * 100 : 0;
                    const markupPct = totalCost > 0 ? ((price - totalCost) / totalCost) * 100 : 0;
                    return { ...i, cost, overhead, totalCost, price, margin, markupPct };
                  })
                  .sort((a,b) => {
                    if (p568SortBy === 'margin') return a.margin - b.margin;
                    if (p568SortBy === 'cost') return b.totalCost - a.totalCost;
                    return a.name.localeCompare(b.name);
                  });

                if (itemsWithCost.length === 0) return null;
                const avgMargin = itemsWithCost.reduce((s,i) => s+i.margin, 0) / itemsWithCost.length;
                const negativeMargin = itemsWithCost.filter(i => i.margin < 0).length;

                return (
                  <div className="apple-card overflow-hidden">
                    <div className="px-5 py-4 border-b border-gray-100 flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <DollarSign className="w-4 h-4 text-amber-500" />
                        <h4 className="font-bold text-gray-800 text-sm">{tr568?'Ürün Maliyet Analizi':'Product Cost Analysis'}</h4>
                        {negativeMargin > 0 && (
                          <span className="text-[10px] font-bold bg-red-100 text-red-700 px-2 py-0.5 rounded-full">
                            {negativeMargin} {tr568?'ürün negatif marj!':'items negative margin!'}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-1.5 text-xs text-gray-600">
                          <label>{tr568?'Genel Gider %:':'Overhead %:'}</label>
                          <input type="number" min="0" max="100" value={p568Overhead}
                            onChange={e => setP568Overhead(Number(e.target.value))}
                            className="apple-input text-xs px-2 py-1 w-14" />
                        </div>
                        <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
                          {(['margin','cost','name'] as const).map(s => (
                            <button key={s} onClick={() => setP568SortBy(s)}
                              className={`text-[10px] font-bold px-2 py-0.5 rounded-md transition-all ${p568SortBy===s?'bg-white shadow-sm text-gray-800':'text-gray-400'}`}>
                              {s==='margin'?'%'+tr568?'Marj':'Margin':s==='cost'?(tr568?'Maliyet':'Cost'):(tr568?'İsim':'Name')}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                    {/* Avg margin banner */}
                    <div className={`px-5 py-2 text-xs font-semibold flex items-center gap-2 ${avgMargin>=30?'bg-emerald-50 text-emerald-700':avgMargin>=15?'bg-amber-50 text-amber-700':'bg-red-50 text-red-700'}`}>
                      <span>{tr568?'Ortalama Brüt Marj:':'Avg Gross Margin:'}</span>
                      <span className="font-black">%{avgMargin.toFixed(1)}</span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-gray-100 bg-gray-50">
                            {[tr568?'Ürün':'Product', 'SKU', tr568?'Alış Maliyeti':'Purchase Cost',
                              `${tr568?'Genel Gider':'Overhead'} (%${p568Overhead})`,
                              tr568?'Toplam Maliyet':'Total Cost', tr568?'Satış Fiyatı':'Sell Price',
                              tr568?'Brüt Marj':'Gross Margin', tr568?'Markup':'Markup'].map(h => (
                              <th key={h} className="px-3 py-2 text-left text-[10px] font-bold text-gray-400 uppercase whitespace-nowrap">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                          {itemsWithCost.slice(0,20).map(item => (
                            <tr key={item.id} className={`hover:bg-gray-50/50 transition-colors ${item.margin<0?'bg-red-50/20':item.margin<15?'bg-amber-50/20':''}`}>
                              <td className="px-3 py-2.5 font-semibold text-gray-800 max-w-[160px] truncate">{item.name}</td>
                              <td className="px-3 py-2.5 font-mono text-gray-400">{item.sku}</td>
                              <td className="px-3 py-2.5 font-mono text-gray-600">₺{item.cost.toLocaleString('tr-TR')}</td>
                              <td className="px-3 py-2.5 font-mono text-gray-500">₺{item.overhead.toLocaleString('tr-TR',{maximumFractionDigits:0})}</td>
                              <td className="px-3 py-2.5 font-mono font-bold text-gray-700">₺{item.totalCost.toLocaleString('tr-TR',{maximumFractionDigits:0})}</td>
                              <td className="px-3 py-2.5 font-mono text-gray-700">{item.price > 0 ? `₺${item.price.toLocaleString('tr-TR')}` : '—'}</td>
                              <td className="px-3 py-2.5">
                                <span className={`font-black text-sm ${item.margin>=30?'text-emerald-600':item.margin>=15?'text-amber-600':item.margin>=0?'text-orange-500':'text-red-600'}`}>
                                  {item.margin.toFixed(1)}%
                                </span>
                                <div className="w-16 h-1 bg-gray-100 rounded-full mt-0.5 overflow-hidden">
                                  <div className={`h-full rounded-full ${item.margin>=30?'bg-emerald-400':item.margin>=15?'bg-amber-400':'bg-red-400'}`}
                                    style={{width:`${Math.max(0,Math.min(100,item.margin))}%`}} />
                                </div>
                              </td>
                              <td className="px-3 py-2.5 font-mono text-gray-500">{item.price>0?`+${item.markupPct.toFixed(0)}%`:'—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {itemsWithCost.length > 20 && (
                      <p className="px-5 py-2 text-[10px] text-gray-400 border-t border-gray-50">{tr568?`${itemsWithCost.length-20} ürün daha var.`:`${itemsWithCost.length-20} more items.`}</p>
                    )}
                  </div>
                );
              })()}

              {/* ── Phase 574: Stok Değerleme Raporu ──────────────────────────────── */}
              {(() => {
                const tr574 = currentLanguage === 'tr';
                if (inventory.length === 0) return null;
                const methods574 = [
                  { id: 'cost' as const, label: tr574?'Maliyet Fiyatı':'Cost Price' },
                  { id: 'retail' as const, label: tr574?'Perakende Fiyatı':'Retail Price' },
                  { id: 'weighted' as const, label: tr574?'Ağırlıklı Ortalama':'Weighted Average' },
                ];
                const getItemValue = (item: typeof inventory[number]) => {
                  const qty = item.stockLevel || 0;
                  if (p574ValMethod === 'cost') return qty * (item.costPrice || 0);
                  if (p574ValMethod === 'retail') return qty * (item.prices?.['Retail'] || item.price || 0);
                  // weighted: avg of cost and retail
                  const cost = item.costPrice || 0;
                  const retail = item.prices?.['Retail'] || item.price || 0;
                  const avg = retail > 0 ? (cost + retail) / 2 : cost;
                  return qty * avg;
                };
                const catGroups574: Record<string,{count:number;qty:number;value:number}> = {};
                inventory.forEach(item => {
                  const cat = item.category || (tr574?'Genel':'General');
                  if (!catGroups574[cat]) catGroups574[cat] = {count:0,qty:0,value:0};
                  catGroups574[cat].count++;
                  catGroups574[cat].qty += item.stockLevel||0;
                  catGroups574[cat].value += getItemValue(item);
                });
                const catList574 = Object.entries(catGroups574).sort((a,b)=>b[1].value-a[1].value);
                const totalValue574 = catList574.reduce((s,[,v])=>s+v.value,0);
                const lowStockValue = inventory.filter(i=>i.stockLevel<=i.lowStockThreshold).reduce((s,i)=>s+getItemValue(i),0);
                return (
                  <div className="apple-card p-5">
                    <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                      <h3 className="font-bold text-gray-900 text-sm">{tr574?'📦 Stok Değerleme Raporu':'📦 Inventory Valuation Report'}</h3>
                      <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
                        {methods574.map(m=>(
                          <button key={m.id} onClick={()=>setP574ValMethod(m.id)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${p574ValMethod===m.id?'bg-white shadow text-gray-900':'text-gray-500 hover:text-gray-700'}`}>
                            {m.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                      {[
                        {label:tr574?'Toplam Değer':'Total Value', val:`₺${totalValue574.toLocaleString('tr-TR',{maximumFractionDigits:0})}`, color:'text-blue-700'},
                        {label:tr574?'Toplam SKU':'Total SKUs', val:String(inventory.length), color:'text-gray-700'},
                        {label:tr574?'Toplam Stok':'Total Stock', val:inventory.reduce((s,i)=>s+(i.stockLevel||0),0).toLocaleString(), color:'text-gray-700'},
                        {label:tr574?'Düşük Stok Değeri':'Low-Stock Value', val:`₺${lowStockValue.toLocaleString('tr-TR',{maximumFractionDigits:0})}`, color:'text-amber-600'},
                      ].map(k=>(
                        <div key={k.label} className="bg-gray-50 rounded-xl p-3">
                          <p className="text-[10px] text-gray-500 uppercase font-semibold">{k.label}</p>
                          <p className={`text-lg font-bold mt-0.5 ${k.color}`}>{k.val}</p>
                        </div>
                      ))}
                    </div>
                    <div className="space-y-2">
                      {catList574.map(([cat, v])=>{
                        const pct = totalValue574>0?(v.value/totalValue574)*100:0;
                        return (
                          <div key={cat} className="flex items-center gap-3">
                            <span className="text-xs text-gray-700 font-medium w-32 truncate">{cat}</span>
                            <div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden">
                              <div className="h-full bg-blue-400 rounded-full" style={{width:`${pct}%`}} />
                            </div>
                            <span className="text-xs font-bold text-gray-700 w-28 text-right font-mono">₺{v.value.toLocaleString('tr-TR',{maximumFractionDigits:0})}</span>
                            <span className="text-[10px] text-gray-400 w-10 text-right">{pct.toFixed(0)}%</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              {/* ── Phase 579: Lot/Seri No Takibi ────────────────────────────────── */}
              {(() => {
                const tr579 = currentLanguage === 'tr';
                const filteredBatches = p579Batches.filter(b =>
                  !p579Search || b.productName.toLowerCase().includes(p579Search.toLowerCase()) || b.batchNo.toLowerCase().includes(p579Search.toLowerCase()) || b.sku.toLowerCase().includes(p579Search.toLowerCase())
                );
                const statusColors579: Record<string,string> = { 'Aktif': 'bg-green-100 text-green-700', 'Karantina': 'bg-red-100 text-red-700', 'Kullanıldı': 'bg-gray-100 text-gray-500' };
                const today579 = new Date().toISOString().slice(0,10);
                const expiringSoon = p579Batches.filter(b => b.status==='Aktif' && b.expiryDate && b.expiryDate > today579 && b.expiryDate <= new Date(Date.now()+30*86400000).toISOString().slice(0,10));
                const expired = p579Batches.filter(b => b.status==='Aktif' && b.expiryDate && b.expiryDate < today579);
                return (
                  <div className="apple-card p-5">
                    <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                      <h3 className="font-bold text-gray-900 text-sm">{tr579?'🏷️ Lot / Seri No Takibi':'🏷️ Batch / Serial Tracking'}</h3>
                      {hasFullAccess('inventory') && (
                        <button onClick={()=>setP579ShowForm(v=>!v)} className="apple-button-primary flex items-center gap-2 text-sm">
                          <Plus className="w-4 h-4"/>{tr579?'Lot Ekle':'Add Batch'}
                        </button>
                      )}
                    </div>
                    {(expiringSoon.length>0||expired.length>0) && (
                      <div className="flex flex-wrap gap-2 mb-3">
                        {expired.length>0 && <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-xs text-red-700 font-semibold">⚠️ {expired.length} {tr579?'lot süresi dolmuş':'batch(es) expired'}</div>}
                        {expiringSoon.length>0 && <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-xs text-amber-700 font-semibold">🔔 {expiringSoon.length} {tr579?'lot 30 gün içinde sona eriyor':'batch(es) expiring in 30 days'}</div>}
                      </div>
                    )}
                    {p579ShowForm && (
                      <div className="bg-gray-50 rounded-xl p-4 mb-4 space-y-3">
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                          <input className="apple-input px-3 py-2 text-sm" placeholder="SKU" value={p579Draft.sku} onChange={e=>setP579Draft(d=>({...d,sku:e.target.value}))} />
                          <input className="apple-input px-3 py-2 text-sm" placeholder={tr579?'Ürün Adı':'Product Name'} value={p579Draft.productName} onChange={e=>setP579Draft(d=>({...d,productName:e.target.value}))} />
                          <input className="apple-input px-3 py-2 text-sm" placeholder={tr579?'Lot No':'Batch No'} value={p579Draft.batchNo} onChange={e=>setP579Draft(d=>({...d,batchNo:e.target.value}))} />
                          <input type="date" className="apple-input px-3 py-2 text-sm" placeholder={tr579?'SKT':'Expiry'} value={p579Draft.expiryDate} onChange={e=>setP579Draft(d=>({...d,expiryDate:e.target.value}))} />
                          <input type="number" className="apple-input px-3 py-2 text-sm" placeholder={tr579?'Miktar':'Qty'} value={p579Draft.qty} onChange={e=>setP579Draft(d=>({...d,qty:e.target.value}))} />
                          <input className="apple-input px-3 py-2 text-sm" placeholder={tr579?'Lokasyon':'Location'} value={p579Draft.location} onChange={e=>setP579Draft(d=>({...d,location:e.target.value}))} />
                        </div>
                        <div className="flex gap-2">
                          <button onClick={async ()=>{
                            if(!p579Draft.batchNo||!p579Draft.sku) return;
                            const payload={sku:p579Draft.sku,productName:p579Draft.productName,batchNo:p579Draft.batchNo,expiryDate:p579Draft.expiryDate||'',qty:Number(p579Draft.qty)||0,location:p579Draft.location||''};
                            try {
                              if(p579EditId){ await updateDoc(doc(db,'stockBatches',p579EditId),payload); }
                              else { await addDoc(collection(db,'stockBatches'),{...payload,status:'Aktif',createdAt:serverTimestamp()}); }
                              setP579Draft({sku:'',productName:'',batchNo:'',expiryDate:'',qty:'',location:''});
                              setP579ShowForm(false); setP579EditId(null);
                            } catch(e){ toast((tr579?'Kaydedilemedi: ':'Save failed: ')+(e instanceof Error?e.message:String(e)),'error'); }
                          }} className="apple-button-primary text-sm px-4 py-1.5">{tr579?'Kaydet':'Save'}</button>
                          <button onClick={()=>{setP579ShowForm(false);setP579EditId(null);}} className="apple-button-secondary text-sm px-4 py-1.5">{tr579?'İptal':'Cancel'}</button>
                        </div>
                      </div>
                    )}
                    <div className="flex items-center gap-2 mb-3">
                      <Search className="w-4 h-4 text-gray-400"/>
                      <input className="flex-1 apple-input px-3 py-2 text-sm" placeholder={tr579?'SKU, ürün adı veya lot no ile ara...':'Search by SKU, product or batch no...'} value={p579Search} onChange={e=>setP579Search(e.target.value)} />
                    </div>
                    {filteredBatches.length === 0 ? (
                      <div className="text-center py-8">
                        <p className="text-gray-300 text-4xl mb-2">🏷️</p>
                        <p className="text-gray-400 text-sm">{p579Batches.length===0?(tr579?'"Lot Ekle" ile takip başlatın.':'Click "Add Batch" to start tracking.'):(tr579?'Arama sonucu bulunamadı.':'No results found.')}</p>
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead><tr className="border-b border-gray-100 bg-gray-50">
                            {['SKU', tr579?'Ürün':'Product', tr579?'Lot No':'Batch No', tr579?'SKT':'Expiry', tr579?'Miktar':'Qty', tr579?'Lokasyon':'Location', tr579?'Durum':'Status'].map(h=>(
                              <th key={h} className="px-3 py-2 text-left text-[10px] font-bold text-gray-400 uppercase">{h}</th>
                            ))}
                          </tr></thead>
                          <tbody className="divide-y divide-gray-50">
                            {filteredBatches.map(b=>{
                              const isExp = b.expiryDate && b.expiryDate < today579;
                              const isExpSoon = b.expiryDate && !isExp && b.expiryDate <= new Date(Date.now()+30*86400000).toISOString().slice(0,10);
                              return (
                                <tr key={b.id} className={`hover:bg-gray-50/50 ${isExp?'bg-red-50/20':isExpSoon?'bg-amber-50/20':''}`}>
                                  <td className="px-3 py-2.5 font-mono text-gray-500">{b.sku}</td>
                                  <td className="px-3 py-2.5 font-medium text-gray-800 max-w-[140px] truncate">{b.productName||'—'}</td>
                                  <td className="px-3 py-2.5 font-mono font-bold text-gray-700">{b.batchNo}</td>
                                  <td className="px-3 py-2.5"><span className={isExp?'text-red-600 font-bold':isExpSoon?'text-amber-600 font-bold':'text-gray-500'}>{b.expiryDate||'—'}</span></td>
                                  <td className="px-3 py-2.5 font-bold text-gray-700">{b.qty}</td>
                                  <td className="px-3 py-2.5 text-gray-400">{b.location||'—'}</td>
                                  <td className="px-3 py-2.5">
                                    <div className="flex items-center gap-2">
                                    <select value={b.status} onChange={async e=>{try{await updateDoc(doc(db,'stockBatches',b.id),{status:e.target.value});}catch(err){toast((tr579?'Güncellenemedi: ':'Update failed: ')+(err instanceof Error?err.message:String(err)),'error');}}} className={`text-[10px] font-bold px-2 py-0.5 rounded-full border-0 cursor-pointer ${statusColors579[b.status]}`}>
                                      <option value="Aktif">{tr579?'Aktif':'Active'}</option>
                                      <option value="Karantina">{tr579?'Karantina':'Quarantine'}</option>
                                      <option value="Kullanıldı">{tr579?'Kullanıldı':'Used'}</option>
                                    </select>
                                    <button type="button" onClick={()=>{setP579Draft({sku:b.sku,productName:b.productName,batchNo:b.batchNo,expiryDate:b.expiryDate||'',qty:String(b.qty),location:b.location||''});setP579EditId(b.id);setP579ShowForm(true);}} title={tr579?'Düzenle':'Edit'} className="text-gray-300 hover:text-blue-600 transition-colors"><Edit2 className="w-3.5 h-3.5"/></button>
                                    <button type="button" onClick={async ()=>{try{await deleteDoc(doc(db,'stockBatches',b.id));}catch(e){toast((tr579?'Silinemedi: ':'Delete failed: ')+(e instanceof Error?e.message:String(e)),'error');}}} title="Sil" className="text-gray-300 hover:text-red-600 transition-colors"><Trash2 className="w-3.5 h-3.5"/></button>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* ── Phase 584: Fiziksel Sayım (Cycle Count) ──────────────────── */}
              {(() => {
                const tr584 = currentLanguage === 'tr';
                if (!p584Active) return (
                  <div className="apple-card p-5">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="font-bold text-gray-900 text-sm">{tr584?'📊 Fiziksel Sayım (Cycle Count)':'📊 Physical Inventory / Cycle Count'}</h3>
                        <p className="text-xs text-gray-400 mt-1">{tr584?'Sistem stoğunu gerçek sayımla karşılaştırın.':'Compare system quantities to physical count.'}</p>
                      </div>
                      {hasFullAccess('inventory') && (
                        <button onClick={async ()=>{
                          const items=inventory.slice(0,50).map(i=>({id:i.id,sku:i.sku,name:i.name,systemQty:i.stockLevel||0}));
                          setP584CountItems(items.map(i=>({...i,countedQty:undefined,variance:undefined})));
                          setP584Active(true);
                          // KALICI oturum: reload'da devam edebilmek için (2026-07-21)
                          try { const ref=await addDoc(collection(db,'stockCountSessions'),{items,startedAt:serverTimestamp()}); setP584SessionId(ref.id); } catch { /* çevrimdışı — oturum yerel sürer */ }
                        }} className="apple-button-primary text-sm flex items-center gap-2">
                          <RefreshCw className="w-4 h-4"/>{tr584?'Sayım Başlat':'Start Count'}
                        </button>
                      )}
                    </div>
                  </div>
                );
                const counted = p584CountItems.filter(i=>i.countedQty!==undefined);
                const variances = counted.filter(i=>(i.variance||0)!==0);
                return (
                  <div className="apple-card p-5">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h3 className="font-bold text-gray-900 text-sm">{tr584?'📊 Fiziksel Sayım':'📊 Cycle Count'}</h3>
                        <p className="text-xs text-gray-500">{counted.length}/{p584CountItems.length} {tr584?'sayıldı':'counted'} • {variances.length} {tr584?'fark':'variance(s)'}</p>
                      </div>
                      <button disabled={p584Finalizing} onClick={()=>void handleFinalizeCycleCount()} className="apple-button-secondary text-xs px-3 py-1.5 disabled:opacity-40">{p584Finalizing?'…':(tr584?'Sayımı Kapat ve Uygula':'End Count & Apply')}</button>
                    </div>
                    <div className="overflow-y-auto max-h-64">
                      <table className="w-full text-xs">
                        <thead><tr className="border-b border-gray-100 bg-gray-50 sticky top-0">
                          {['SKU', tr584?'Ürün':'Product', tr584?'Sistem':'System', tr584?'Sayım':'Count', tr584?'Fark':'Variance'].map(h=>(
                            <th key={h} className="px-3 py-2 text-left text-[10px] font-bold text-gray-400 uppercase">{h}</th>
                          ))}
                        </tr></thead>
                        <tbody className="divide-y divide-gray-50">
                          {p584CountItems.map(item=>{
                            const v = item.countedQty!==undefined ? item.countedQty-item.systemQty : undefined;
                            return (
                              <tr key={item.id} className={`hover:bg-gray-50/50 ${v!==undefined&&v!==0?'bg-amber-50/30':''}`}>
                                <td className="px-3 py-2 font-mono text-gray-500">{item.sku}</td>
                                <td className="px-3 py-2 text-gray-700 max-w-[150px] truncate">{item.name}</td>
                                <td className="px-3 py-2 font-bold text-gray-600">{item.systemQty}</td>
                                <td className="px-3 py-2">
                                  <input type="number" className="w-16 apple-input px-2 py-0.5 text-xs" placeholder="—" value={item.countedQty??''} onChange={e=>{
                                    const val = e.target.value===''?undefined:Number(e.target.value);
                                    setP584CountItems(prev=>prev.map(x=>x.id===item.id?{...x,countedQty:val,variance:val!==undefined?val-x.systemQty:undefined}:x));
                                  }} onBlur={()=>{
                                    // Oturum kalıcılığı: alan terkinde tüm listeyi kaydet (undefined'lar 0 yazılmasın diye ayıkla)
                                    if(p584SessionId){ void updateDoc(doc(db,'stockCountSessions',p584SessionId),{items:p584CountItems.map(x=>({id:x.id,sku:x.sku,name:x.name,systemQty:x.systemQty,...(x.countedQty!==undefined?{countedQty:x.countedQty,variance:x.variance??0}:{})}))}).catch(()=>{}); }
                                  }} />
                                </td>
                                <td className="px-3 py-2">
                                  {v!==undefined&&<span className={`font-bold ${v>0?'text-emerald-600':v<0?'text-red-600':'text-gray-400'}`}>{v>0?'+':''}{v}</span>}
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

              {/* ── Phase 588: Konsinye Stok Takibi ────────────────────────────── */}
              {(() => {
                const tr588 = currentLanguage === 'tr';
                const statusColors588: Record<string,string> = {'Depoda':'bg-blue-100 text-blue-700','Satıldı':'bg-green-100 text-green-700','İade Edildi':'bg-gray-100 text-gray-500'};
                const totalConsignValue = p588Consign.filter(c=>c.status==='Depoda').reduce((s,c)=>s+c.qty*c.agreedPrice,0);
                return (
                  <div className="apple-card p-5">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h3 className="font-bold text-gray-900 text-sm">{tr588?'🤝 Konsinye Stok':'🤝 Consignment Stock'}</h3>
                        {p588Consign.length>0&&<p className="text-xs text-gray-500 mt-0.5">{tr588?'Depodaki değer:':'Value on hand:'} <span className="font-bold text-blue-600">₺{totalConsignValue.toLocaleString('tr-TR',{maximumFractionDigits:0})}</span></p>}
                      </div>
                      {hasFullAccess('inventory') && (
                        <button onClick={()=>setP588ShowForm(v=>!v)} className="apple-button-primary flex items-center gap-2 text-sm">
                          <Plus className="w-4 h-4"/>{tr588?'Konsinye Ekle':'Add Consignment'}
                        </button>
                      )}
                    </div>
                    {p588ShowForm && (
                      <div className="bg-gray-50 rounded-xl p-4 mb-4 space-y-3">
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                          <input className="apple-input px-3 py-2 text-sm" placeholder={tr588?'Tedarikçi':'Supplier'} value={p588Draft.supplierName} onChange={e=>setP588Draft(d=>({...d,supplierName:e.target.value}))} />
                          <input className="apple-input px-3 py-2 text-sm" placeholder={tr588?'Ürün Adı':'Product'} value={p588Draft.productName} onChange={e=>setP588Draft(d=>({...d,productName:e.target.value}))} />
                          <input className="apple-input px-3 py-2 text-sm" placeholder="SKU" value={p588Draft.sku} onChange={e=>setP588Draft(d=>({...d,sku:e.target.value}))} />
                          <input type="number" className="apple-input px-3 py-2 text-sm" placeholder={tr588?'Miktar':'Qty'} value={p588Draft.qty} onChange={e=>setP588Draft(d=>({...d,qty:e.target.value}))} />
                          <input type="number" className="apple-input px-3 py-2 text-sm" placeholder={tr588?'Anlaşma Fiyatı (₺)':'Agreed Price (₺)'} value={p588Draft.agreedPrice} onChange={e=>setP588Draft(d=>({...d,agreedPrice:e.target.value}))} />
                          <input className="apple-input px-3 py-2 text-sm" placeholder={tr588?'Lokasyon Kodu':'Location Code'} value={p588Draft.locationCode} onChange={e=>setP588Draft(d=>({...d,locationCode:e.target.value}))} />
                        </div>
                        <div className="flex gap-2">
                          <button onClick={async ()=>{
                            if(!p588Draft.supplierName||!p588Draft.productName) return;
                            const payload={supplierName:p588Draft.supplierName,productName:p588Draft.productName,sku:p588Draft.sku,qty:Number(p588Draft.qty)||0,agreedPrice:Number(p588Draft.agreedPrice)||0,locationCode:p588Draft.locationCode||'',startDate:p588Draft.startDate};
                            try {
                              if(p588EditId){ await updateDoc(doc(db,'supplierConsignments',p588EditId),payload); }
                              else { await addDoc(collection(db,'supplierConsignments'),{...payload,status:'Depoda',createdAt:serverTimestamp()}); }
                              setP588Draft({supplierName:'',productName:'',sku:'',qty:'',agreedPrice:'',locationCode:'',startDate:new Date().toISOString().slice(0,10)});
                              setP588ShowForm(false); setP588EditId(null);
                            } catch(e){ toast((tr588?'Kaydedilemedi: ':'Save failed: ')+(e instanceof Error?e.message:String(e)),'error'); }
                          }} className="apple-button-primary text-sm px-4 py-1.5">{tr588?'Kaydet':'Save'}</button>
                          <button onClick={()=>{setP588ShowForm(false);setP588EditId(null);}} className="apple-button-secondary text-sm px-4 py-1.5">{tr588?'İptal':'Cancel'}</button>
                        </div>
                      </div>
                    )}
                    {p588Consign.length===0 ? (
                      <p className="text-center py-6 text-gray-400 text-sm">{tr588?'Henüz konsinye kaydı yok.':'No consignment records yet.'}</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead><tr className="border-b border-gray-100 bg-gray-50">
                            {[tr588?'Tedarikçi':'Supplier', tr588?'Ürün':'Product', 'SKU', tr588?'Miktar':'Qty', tr588?'Değer':'Value', tr588?'Durum':'Status'].map(h=>(
                              <th key={h} className="px-3 py-2 text-left text-[10px] font-bold text-gray-400 uppercase">{h}</th>
                            ))}
                          </tr></thead>
                          <tbody className="divide-y divide-gray-50">
                            {p588Consign.map(c=>(
                              <tr key={c.id} className="hover:bg-gray-50/50">
                                <td className="px-3 py-2.5 font-medium text-gray-800">{c.supplierName}</td>
                                <td className="px-3 py-2.5 text-gray-600">{c.productName}</td>
                                <td className="px-3 py-2.5 font-mono text-gray-500">{c.sku}</td>
                                <td className="px-3 py-2.5 font-bold text-gray-700">{c.qty}</td>
                                <td className="px-3 py-2.5 font-bold font-mono text-blue-700">₺{(c.qty*c.agreedPrice).toLocaleString('tr-TR',{maximumFractionDigits:0})}</td>
                                <td className="px-3 py-2.5">
                                  <div className="flex items-center gap-2">
                                  <select value={c.status} onChange={async e=>{try{await updateDoc(doc(db,'supplierConsignments',c.id),{status:e.target.value});}catch(err){toast((tr588?'Güncellenemedi: ':'Update failed: ')+(err instanceof Error?err.message:String(err)),'error');}}} className={`text-[10px] font-bold px-2 py-0.5 rounded-full border-0 cursor-pointer ${statusColors588[c.status]}`}>
                                    <option>Depoda</option><option>Satıldı</option><option>İade Edildi</option>
                                  </select>
                                  <button type="button" onClick={()=>{setP588Draft({supplierName:c.supplierName,productName:c.productName,sku:c.sku,qty:String(c.qty),agreedPrice:String(c.agreedPrice),locationCode:c.locationCode||'',startDate:c.startDate});setP588EditId(c.id);setP588ShowForm(true);}} title={tr588?'Düzenle':'Edit'} className="text-gray-300 hover:text-blue-600 transition-colors"><Edit2 className="w-3.5 h-3.5"/></button>
                                  <button type="button" onClick={async ()=>{try{await deleteDoc(doc(db,'supplierConsignments',c.id));}catch(e){toast((tr588?'Silinemedi: ':'Delete failed: ')+(e instanceof Error?e.message:String(e)),'error');}}} title="Sil" className="text-gray-300 hover:text-red-600 transition-colors"><Trash2 className="w-3.5 h-3.5"/></button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* ── Phase 611: Stok Devir Hızı ───────────────────────────────── */}
              {inventory.length > 0 && (() => {
                const tr611 = currentLanguage === 'tr';
                const daysMap:{[k:string]:number} = {'30d':30,'90d':90,'180d':180};
                const days611 = daysMap[p611Period];
                const cutoff611 = new Date(Date.now() - days611*86400000);
                const recentOut611 = inventoryMovements.filter(m => {
                  if (m.type!=='out'||!m.timestamp) return false;
                  try { const d=(m.timestamp as {toDate?:()=>Date}).toDate?.()??new Date(m.timestamp as string); return d>=cutoff611; } catch { return false; }
                });
                // Aggregate qty out per product name
                const qtyOut:{[name:string]:number} = {};
                recentOut611.forEach(m=>{ qtyOut[m.productName]=(qtyOut[m.productName]||0)+(m.quantity||0); });
                const rows = inventory.map(item=>{
                  const sold = qtyOut[item.name]||0;
                  const avgStock = (item.stockLevel||0);
                  const turnover = avgStock>0?(sold/avgStock*(365/days611)):0;
                  return {name:item.name,sku:item.sku,stock:item.stockLevel||0,sold,turnover};
                }).filter(r=>r.sold>0||r.stock>0).sort((a,b)=>b.turnover-a.turnover).slice(0,10);
                if (rows.length===0) return null;
                return (
                  <div className="apple-card p-5">
                    <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                      <h3 className="font-bold text-gray-900 text-sm">🔄 {tr611?'Stok Devir Hızı':'Inventory Turnover'}</h3>
                      <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
                        {([{k:'30d',l:tr611?'30g':'30d'},{k:'90d',l:tr611?'90g':'90d'},{k:'180d',l:tr611?'180g':'180d'}] as {k:'30d'|'90d'|'180d';l:string}[]).map(t=>(
                          <button key={t.k} onClick={()=>setP611Period(t.k)} className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${p611Period===t.k?'bg-white shadow text-gray-900':'text-gray-500 hover:text-gray-700'}`}>{t.l}</button>
                        ))}
                      </div>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead><tr className="border-b border-gray-100 bg-gray-50">
                          {[tr611?'Ürün':'Product','SKU',tr611?'Mevcut':'Stock',tr611?`Satış (${p611Period})`:`Sales (${p611Period})`,tr611?'Devir Hızı':'Turnover'].map(h=>(
                            <th key={h} className="px-3 py-2 text-left text-[10px] font-bold text-gray-400 uppercase">{h}</th>
                          ))}
                        </tr></thead>
                        <tbody className="divide-y divide-gray-50">
                          {rows.map(r=>(
                            <tr key={r.sku} className="hover:bg-gray-50/50">
                              <td className="px-3 py-2.5 font-medium text-gray-800 truncate max-w-[160px]">{r.name}</td>
                              <td className="px-3 py-2.5 font-mono text-gray-500">{r.sku}</td>
                              <td className="px-3 py-2.5 text-gray-600">{r.stock}</td>
                              <td className="px-3 py-2.5 text-blue-600 font-bold">{r.sold}</td>
                              <td className={`px-3 py-2.5 font-bold ${r.turnover>=4?'text-emerald-600':r.turnover>=2?'text-amber-600':'text-red-500'}`}>{r.turnover.toFixed(1)}x</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })()}


              {/* ── Phase 642: Garanti Takip ─────────────────────────────────── */}
              {(() => {
                const tr642 = currentLanguage === 'tr';
                const today642 = new Date().toISOString().slice(0,10);
                const getExpiryDate = (w: typeof p642Warranties[0]) => {
                  const d = new Date(w.purchaseDate);
                  d.setMonth(d.getMonth()+w.warrantyMonths);
                  return d.toISOString().slice(0,10);
                };
                const statusCls:{[k:string]:string}={Aktif:'bg-emerald-100 text-emerald-700','Sona Erdi':'bg-gray-100 text-gray-600','Talep Açık':'bg-amber-100 text-amber-700'};
                const expiringSoon = p642Warranties.filter(w=>{const e=getExpiryDate(w);return e>=today642&&e<=new Date(Date.now()+30*86400000).toISOString().slice(0,10)&&w.status==='Aktif';});
                return (
                  <div className="apple-card p-5 space-y-4">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div><h3 className="font-bold text-gray-900 text-sm">🛡️ {tr642?'Garanti Takip':'Warranty Tracking'}</h3>
                      <p className="text-xs text-gray-400">{tr642?'Ürün garanti süreleri ve talep yönetimi':'Product warranty periods and claim management'}</p></div>
                      <button onClick={()=>setP642ShowForm(v=>!v)} className="apple-button-secondary text-xs flex items-center gap-1.5"><Plus className="w-3.5 h-3.5"/>{tr642?'Garanti Ekle':'Add Warranty'}</button>
                    </div>
                    {expiringSoon.length>0&&<div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 text-xs font-semibold text-amber-700">⚠️ {expiringSoon.length} {tr642?'ürün garantisi 30 gün içinde sona eriyor':'product warranty(ies) expiring within 30 days'}</div>}
                    {p642ShowForm && (
                      <div className="bg-gray-50 rounded-xl p-4 space-y-3">
                        <div className="grid grid-cols-2 gap-2">
                          <input className="apple-input" placeholder={tr642?'Ürün Adı':'Product Name'} value={p642Draft.productName} onChange={e=>setP642Draft(d=>({...d,productName:e.target.value}))}/>
                          <input className="apple-input" placeholder="SKU" value={p642Draft.sku} onChange={e=>setP642Draft(d=>({...d,sku:e.target.value}))}/>
                          <input className="apple-input" placeholder={tr642?'Seri No':'Serial No'} value={p642Draft.serialNo} onChange={e=>setP642Draft(d=>({...d,serialNo:e.target.value}))}/>
                          <input className="apple-input" placeholder={tr642?'Müşteri':'Customer'} value={p642Draft.customerName} onChange={e=>setP642Draft(d=>({...d,customerName:e.target.value}))}/>
                          <input type="date" className="apple-input" value={p642Draft.purchaseDate} onChange={e=>setP642Draft(d=>({...d,purchaseDate:e.target.value}))}/>
                          <input type="number" className="apple-input" placeholder={tr642?'Garanti (ay)':'Warranty (months)'} value={p642Draft.warrantyMonths} onChange={e=>setP642Draft(d=>({...d,warrantyMonths:e.target.value}))}/>
                        </div>
                        <div className="flex gap-2">
                          <button onClick={async ()=>{
                            if(!p642Draft.productName) return;
                            try { await addDoc(collection(db,'warranties'),{productName:p642Draft.productName,sku:p642Draft.sku,serialNo:p642Draft.serialNo,customerName:p642Draft.customerName,purchaseDate:p642Draft.purchaseDate,warrantyMonths:Number(p642Draft.warrantyMonths)||12,status:'Aktif',createdAt:serverTimestamp()}); toast(currentLanguage === 'tr' ? 'Garanti kaydedildi ✓' : 'Warranty saved ✓', 'success'); } catch(e){console.error("[firestore]", e); toast(currentLanguage === 'tr' ? 'Garanti kaydedilemedi.' : 'Failed to save warranty.', 'error');}
                            setP642Draft({productName:'',sku:'',serialNo:'',customerName:'',purchaseDate:new Date().toISOString().slice(0,10),warrantyMonths:'12'});
                            setP642ShowForm(false);
                            toast(tr642?'Garanti kaydı oluşturuldu.':'Warranty record created.','success');
                          }} className="apple-button-primary text-xs px-6">{tr642?'Kaydet':'Save'}</button>
                          <button onClick={()=>setP642ShowForm(false)} className="apple-button-secondary text-xs px-4">{tr642?'İptal':'Cancel'}</button>
                        </div>
                      </div>
                    )}
                    {p642Warranties.length > 0 ? (
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead><tr className="border-b border-gray-100 bg-gray-50">
                            {[tr642?'Ürün':'Product','SKU',tr642?'Seri No':'Serial',tr642?'Müşteri':'Customer',tr642?'Satın Alma':'Purchase',tr642?'Bitiş':'Expiry',tr642?'Durum':'Status'].map(h=>(
                              <th key={h} className="px-3 py-2 text-left text-[10px] font-bold text-gray-400 uppercase">{h}</th>
                            ))}
                          </tr></thead>
                          <tbody className="divide-y divide-gray-50">
                            {p642Warranties.map(w=>{
                              const expiry = getExpiryDate(w);
                              const expired = expiry < today642;
                              const autoStatus: typeof w.status = expired?'Sona Erdi':w.status;
                              return (
                                <tr key={w.id} className="hover:bg-gray-50/50">
                                  <td className="px-3 py-2.5 font-semibold text-gray-800">{w.productName}</td>
                                  <td className="px-3 py-2.5 font-mono text-gray-500">{w.sku||'—'}</td>
                                  <td className="px-3 py-2.5 font-mono text-gray-500">{w.serialNo||'—'}</td>
                                  <td className="px-3 py-2.5 text-gray-600">{w.customerName||'—'}</td>
                                  <td className="px-3 py-2.5 text-gray-500">{new Date(w.purchaseDate).toLocaleDateString('tr-TR')}</td>
                                  <td className={`px-3 py-2.5 font-semibold ${expired?'text-red-500':expiry<=new Date(Date.now()+30*86400000).toISOString().slice(0,10)?'text-amber-500':'text-gray-600'}`}>{new Date(expiry).toLocaleDateString('tr-TR')}</td>
                                  <td className="px-3 py-2.5">
                                    <select value={autoStatus} onChange={async e=>{try{await updateDoc(doc(db,'warranties',w.id),{status:e.target.value});}catch(err){console.error(err);}}} className={`text-[10px] font-bold px-2 py-0.5 rounded-full border-0 ${statusCls[autoStatus]}`}>
                                      {['Aktif','Sona Erdi','Talep Açık'].map(s=><option key={s}>{s}</option>)}
                                    </select>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    ) : <p className="text-center text-gray-400 text-xs py-4">{tr642?'Garanti kaydı ekleyin.':'Add warranty records to track product warranties.'}</p>}
                  </div>
                );
              })()}

              {/* ── Phase 644: MRP / Malzeme İhtiyaç Planlaması ─────────────── */}
              {inventory.length > 0 && (() => {
                const tr644 = currentLanguage === 'tr';
                // Determine demand from open orders
                const demandMap:{[sku:string]:{name:string;demand:number}} = {};
                orders.filter(o=>o.status==='Pending'||o.status==='Processing').forEach(o=>{
                  (o.lineItems||[]).forEach(li=>{
                    if(!demandMap[li.sku]) demandMap[li.sku]={name:li.name||li.sku,demand:0};
                    demandMap[li.sku].demand += li.quantity||1;
                  });
                });
                const mrpRows = Object.entries(demandMap).map(([sku,d])=>{
                  const item = inventory.find(i=>i.sku===sku||i.name===d.name);
                  const onHand = item?.stockLevel||0;
                  const reorderPoint = item?.lowStockThreshold||5;
                  const net = onHand - d.demand;
                  const needToProcure = Math.max(0, d.demand - onHand);
                  const status: 'OK'|'Sipariş Ver'|'Kritik' = net >= reorderPoint ? 'OK' : needToProcure > 0 ? 'Sipariş Ver' : 'Kritik';
                  return {sku,name:d.name,demand:d.demand,onHand,reorderPoint,net,needToProcure,status};
                }).sort((a,b)=>b.needToProcure-a.needToProcure);
                const criticalCount = mrpRows.filter(r=>r.status==='Kritik'||r.status==='Sipariş Ver').length;
                const statusCls644:{[k:string]:string}={OK:'bg-emerald-100 text-emerald-700','Sipariş Ver':'bg-amber-100 text-amber-700',Kritik:'bg-red-100 text-red-700'};
                return (
                  <div className="apple-card p-5 space-y-4">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div><h3 className="font-bold text-gray-900 text-sm">🔧 {tr644?'MRP — Malzeme İhtiyaç Planlaması':'MRP — Material Requirements Planning'}</h3>
                      <p className="text-xs text-gray-400">{tr644?'Açık siparişlere göre net malzeme ihtiyacı hesabı':'Net material requirements from open orders'}</p></div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-500">{tr644?'Ufuk:':'Horizon:'}</span>
                        <input type="number" value={p644Horizon} onChange={e=>setP644Horizon(Math.max(1,Number(e.target.value)))} className="apple-input px-2 py-1 text-xs w-14 text-right" />
                        <span className="text-xs text-gray-500">{tr644?'gün':'days'}</span>
                      </div>
                    </div>
                    {criticalCount > 0 && <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-2.5 text-xs font-semibold text-red-700">⚠️ {criticalCount} {tr644?'ürün için tedarik gerekiyor':'product(s) require procurement'}</div>}
                    {mrpRows.length > 0 ? (
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead><tr className="border-b border-gray-100 bg-gray-50">
                            {['SKU',tr644?'Ürün':'Product',tr644?'Talep':'Demand',tr644?'Eldeki':'On Hand',tr644?'Net':'Net',tr644?'Tedarik Et':'Procure',tr644?'Durum':'Status'].map(h=>(
                              <th key={h} className="px-3 py-2 text-left text-[10px] font-bold text-gray-400 uppercase">{h}</th>
                            ))}
                          </tr></thead>
                          <tbody className="divide-y divide-gray-50">
                            {mrpRows.map(r=>(
                              <tr key={r.sku} className={`hover:bg-gray-50/50 ${r.status==='Kritik'?'bg-red-50/20':r.status==='Sipariş Ver'?'bg-amber-50/20':''}`}>
                                <td className="px-3 py-2.5 font-mono text-gray-500">{r.sku}</td>
                                <td className="px-3 py-2.5 font-semibold text-gray-800">{r.name}</td>
                                <td className="px-3 py-2.5 font-bold text-blue-600">{r.demand}</td>
                                <td className="px-3 py-2.5 font-mono text-gray-600">{r.onHand}</td>
                                <td className={`px-3 py-2.5 font-bold ${r.net<0?'text-red-600':'text-emerald-600'}`}>{r.net}</td>
                                <td className="px-3 py-2.5 font-bold text-orange-600">{r.needToProcure > 0 ? r.needToProcure : '—'}</td>
                                <td className="px-3 py-2.5"><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${statusCls644[r.status]}`}>{tr644&&r.status==='OK'?'Yeterli':r.status}</span></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="text-center py-4 space-y-1">
                        <p className="text-gray-400 text-xs">{tr644?`Ufuk dahilindeki açık siparişlere ait talep yok (${p644Horizon} gün).`:`No demand from open orders within the ${p644Horizon}-day horizon.`}</p>
                        <p className="text-[10px] text-gray-300">{tr644?'Planlanmış ve Onaylanmış siparişler dahil edilmektedir.':'Planned and Confirmed orders are included.'}</p>
                      </div>
                    )}
                    <p className="text-[10px] text-gray-400">Ufuk: {tr644?'önümüzdeki':'next'} {p644Horizon} {tr644?'gün':'days'} · {tr644?'son güncelleme:':'as of:'} {new Date().toLocaleDateString('tr-TR')}</p>
                  </div>
                );
              })()}
            </motion.div>
  );
}
