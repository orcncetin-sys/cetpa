import { sayiBicimleyici } from '../utils/recharts';
import { odemeTakipli, gorunenSiparisNo, siparisTarih } from '../utils/siparis';
import { gunAnahtari } from '../utils/zaman';
import { siparisDurumEtiketi, sevkiyatDurumEtiketi } from '../utils/durumEtiketi';
import KurUyarisi from '../components/KurUyarisi';
import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ChevronRight, ChevronDown, Users, Package, Truck, TrendingUp, Receipt, List, FileText,
  DollarSign, CheckCircle2, Calendar, BarChart3, AlertTriangle, LayoutDashboard,
  Clock, Wallet, Wrench, Search, Activity, ShieldCheck, Target as TargetIcon,
  ShoppingCart, BookOpen, Plus, History,
} from 'lucide-react';
import { YAxis, XAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area } from 'recharts';
import { db, auth } from '../firebase';
import { doc, collection, addDoc, updateDoc, deleteDoc, setDoc, serverTimestamp, isCollectionReady } from '../lib/dbClient';
import { cn } from '../lib/utils';
import { itemCostTRY } from '../utils/cost';
import { kurCevir } from '../utils/currency';
import { confirmDelete } from '../lib/confirm';
import KpiCurrencyToggle from '../components/KpiCurrencyToggle';
import ModuleHeader from '../components/ModuleHeader';
import DashboardAnalysis from '../components/DashboardAnalysis';
import DateRangePicker from '../components/DateRangePicker';
import SonSenkronRozeti from '../components/SonSenkronRozeti';
import type { Order, Lead, InventoryItem, Shipment } from '../types';
import { useMikroFaturalar } from '../hooks/useMikroFaturalar';
import { useMikroSiparisler } from '../hooks/useMikroSiparisler';

// KUR YEDEGI KALDIRILDI (2026-08-26) — burada `const FX_FALLBACK = { USD: 38,
// EUR: 41 }` duruyordu. Canli kur gelmedigi her an TL tutarlar 2024'ten kalma
// SABIT bir kurla bolunuyor, sonuc da guncel kurmus gibi $/€ ile basiliyordu.
// Ayrica birkac yerde daha eski `|| 1` yedegi vardi: o da ham TL'yi dolar diye
// gosteriyordu (₺40.000 -> "$40.000", ~38x sisik).
//
// Ceviri artik TEK yerde: src/utils/currency.ts -> kurCevir (kur yoksa null).
// Bu sayfa cevrilmis KPI tutarlarini App.tsx'ten gelen `fmtKpi` prop'uyla
// basiyor; o da null'i '—' yapar. CLAUDE.md: guvenilir hesaplanamayan rakam
// yerine yaniltici bir sayi degil '—' goster.

/**
 * DeltaBadge — onceki doneme gore degisim.
 *
 * BIRIM KARISMASI DUZELTILDI (2026-09-04, kullanici bildirdi: "938530.7% nereden
 * geliyor?"): sunucu (`reportsRoutes.ts`) delta'yi MUTLAK FARK olarak gonderiyor
 * — ciroda TL, siparislerde ADET. Rozet ise sonuna dogrudan '%' basiyordu:
 * ₺938.530,7'lik fark ekranda "%938530.7" olarak goruniyordu.
 *
 * Artik yuzde `prev` (onceki donem degeri) ile HESAPLANIR. `prev` yoksa veya 0 ise
 * yuzde tanimsizdir (sifirdan artis sonsuzdur) — o durumda uydurma bir oran yerine
 * mutlak degisim gosterilir. CLAUDE.md: "sahte kesinlik gosterme".
 */
function DeltaBadge({ delta, prev, birim = 'adet' }: {
  delta: number | null | undefined;
  prev?: number | null;
  birim?: 'adet' | 'tutar';
}) {
  if (delta == null || isNaN(delta)) return null;
  const up = delta >= 0;
  const yuzde = (prev != null && prev !== 0 && isFinite(prev)) ? (delta / prev) * 100 : null;
  const mutlak = birim === 'tutar'
    ? `₺${Math.abs(delta).toLocaleString('tr-TR', { maximumFractionDigits: 0 })}`
    : Math.abs(delta).toLocaleString('tr-TR', { maximumFractionDigits: 0 });
  return (
    <span
      className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${up ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-500'}`}
      title={yuzde === null
        ? 'Önceki dönemde karşılaştırılacak veri yok — yüzde hesaplanamıyor, mutlak değişim gösteriliyor.'
        : `Önceki dönem: ${birim === 'tutar' ? '₺' : ''}${(prev ?? 0).toLocaleString('tr-TR', { maximumFractionDigits: 0 })}`}
    >
      {up ? '▲' : '▼'} {yuzde === null ? mutlak : `%${Math.abs(yuzde).toFixed(1)}`}
    </span>
  );
}

interface SummaryData {
  orders: { count: number; prevCount: number; delta: number };
  revenue: { total: number; prev: number; delta: number };
  leads: { total: number; new30: number };
  inventory: { total: number; lowStock: number };
  delivered: number;
}
interface Task595 { id: string; title: string; dueDate: string; assignedTo: string; module: string; priority: 'Düşük' | 'Orta' | 'Yüksek' | 'Kritik'; done: boolean }
interface VergiDeadline { id: string; vergiTuru: string; sonTarih: string; durum: string }
interface RecentItem { type: 'order' | 'lead' | 'product'; id: string; label: string; tab: string }
interface LeaveRequest { id: string; employeeId: string; employeeName: string; type: string; startDate: string; endDate: string; days: number; status: string; reason?: string }

interface Props {
  currentLanguage: 'tr' | 'en';
  currentT: Record<string, string>;
  dashT: Record<string, any>;
  activeTab: string;
  darkMode: boolean;
  kpiCurrency: 'TRY' | 'USD' | 'EUR';
  setKpiCurrency: React.Dispatch<React.SetStateAction<'TRY' | 'USD' | 'EUR'>>;
  orders: Order[];
  leads: Lead[];
  inventory: InventoryItem[];
  shipments: Shipment[];
  filteredOrders: Order[];
  filteredLeads: Lead[];
  exchangeRates: Record<string, number> | null;
  user: { email?: string | null; uid?: string; displayName?: string | null } | null;
  toast: (msg: string, type?: string) => void;
  fmtKpi: (value: number, format?: 'full' | 'K', decimals?: number) => string;
  setActiveTab: (tab: string) => void;

  summaryData: SummaryData | null;
  monthlyTarget: number;
  dateRange: { startDate: string; endDate: string };
  setDateRange: React.Dispatch<React.SetStateAction<{ startDate: string; endDate: string }>>;
  dashClock: Date;
  gibConnected: boolean;
  dashVergiDeadlines: VergiDeadline[];
  recentlyViewed: RecentItem[];
  setRecentlyViewed: React.Dispatch<React.SetStateAction<RecentItem[]>>;
  quickNote: string;
  handleQuickNoteChange: (val: string) => void;
  shipmentsExpanded: boolean;
  setShipmentsExpanded: React.Dispatch<React.SetStateAction<boolean>>;
  isEditingTarget: boolean;
  setIsEditingTarget: React.Dispatch<React.SetStateAction<boolean>>;
  targetDraft: string;
  setTargetDraft: React.Dispatch<React.SetStateAction<string>>;
  saveMonthlyTarget: (monthKey: string, value: number) => void;
  priceOverrides: Array<Record<string, unknown>>;
  leaveRequests: LeaveRequest[];
  p528Dismissed: Set<string>;
  setP528Dismissed: React.Dispatch<React.SetStateAction<Set<string>>>;
  p595Tasks: Task595[];
  p595ShowForm: boolean;
  setP595ShowForm: React.Dispatch<React.SetStateAction<boolean>>;
  p595Draft: { title: string; dueDate: string; assignedTo: string; module: string; priority: 'Düşük' | 'Orta' | 'Yüksek' | 'Kritik' };
  setP595Draft: React.Dispatch<React.SetStateAction<{ title: string; dueDate: string; assignedTo: string; module: string; priority: 'Düşük' | 'Orta' | 'Yüksek' | 'Kritik' }>>;
  setSelectedLead: React.Dispatch<React.SetStateAction<Lead | null>>;
  setCrmTab: (tab: string) => void;
  setSelectedOrder: React.Dispatch<React.SetStateAction<Order | null>>;
  setShowOverduePanel: React.Dispatch<React.SetStateAction<boolean>>;
  setGlobalSearchOpen: React.Dispatch<React.SetStateAction<boolean>>;
}

export default function DashboardPage(props: Props) {
  const {
    currentLanguage, currentT, dashT, activeTab, darkMode, kpiCurrency, setKpiCurrency,
    orders, leads, inventory, shipments, filteredOrders, filteredLeads, exchangeRates,
    user, toast, fmtKpi, setActiveTab,
    summaryData, monthlyTarget, dateRange, setDateRange, dashClock, gibConnected, dashVergiDeadlines,
    recentlyViewed, setRecentlyViewed, quickNote, handleQuickNoteChange,
    shipmentsExpanded, setShipmentsExpanded,
    isEditingTarget, setIsEditingTarget, targetDraft, setTargetDraft, saveMonthlyTarget,
    priceOverrides, leaveRequests, p528Dismissed, setP528Dismissed,
    p595Tasks, p595ShowForm, setP595ShowForm, p595Draft, setP595Draft,
    setSelectedLead, setCrmTab, setSelectedOrder, setShowOverduePanel, setGlobalSearchOpen,
  } = props;

  // ── MİKRO ENTEGRASYONU: Fatura ve Siparişler ──
  const mikroFaturalar = useMikroFaturalar(true);
  const mikroSiparisler = useMikroSiparisler(true);

  // Giden (satış) faturalarını tarih aralığına göre filtrele
  const filteredMikroFaturalar = mikroFaturalar.filter(f => {
    if (f.yon !== 'giden') return false;
    const start = new Date(dateRange.startDate);
    const end = new Date(dateRange.endDate);
    const d = new Date(f.tarih);
    return d >= start && d <= end;
  });

  const totalMikroRevenue = filteredMikroFaturalar.reduce((sum, f) => sum + (f.tutar || 0), 0);
  // ÇİFT SAYIM KORUMASI (2026-09-01): faturadan türetilen siparişler
  // (source:'mikro-fatura') native tarafında DIŞLANIR — aynı fatura hem
  // mikroFaturalar hem orders üzerinden iki kez ciroya girmesin.
  const totalNativeRevenue = filteredOrders
    .filter(o => (o as { source?: string }).source !== 'mikro-fatura')
    .reduce((s, o) => s + (o.totalPrice || o.totalAmount || 0), 0);
  const combinedRevenue = totalNativeRevenue + totalMikroRevenue;
  // 'orders' ve 'mikroFaturalar' SSE ile KADEMELİ akıyor (mikroFaturalar 600+
  // fatura olabiliyor). onSnapshot abone olur olmaz boş diziyle bile tetiklenir;
  // ilk anlık görüntü tam gelene kadar burada okunan toplam bir ARA DEĞERdir.
  // Bu yüzden kart "her bakışta farklı rakam" gösteriyordu — kısmi toplam
  // sessizce nihai sonuç gibi sunuluyordu. Tam gelene kadar yükleniyor gösterilir.
  const revenueReady = isCollectionReady('orders') && isCollectionReady('mikroFaturalar');
  // Aynı arıza sınıfı bu satırdaki diğer 3 karta da (Sipariş/Müşteri Adayı/Envanter)
  // uygulanıyor — hepsi ayni canlı koleksiyonlardan SSE ile besleniyor.
  const ordersCountReady = isCollectionReady('orders');
  const leadsCountReady = isCollectionReady('leads');
  const inventoryCountReady = isCollectionReady('inventory');

  // Mikro siparişlerini Order formatına uyarlayıp grafiklerde kullanmak için birleştir
  const mappedMikroSiparisler = mikroSiparisler.filter(ms => ms.tip === 0).map(ms => ({
    id: ms.id,
    orderNumber: ms.evrakNo,
    customerName: ms.cariKodu,
    totalPrice: ms.tutar,
    status: 'Pending', // Mikro'daki açık siparişler
    createdAt: ms.tarih,
    // syncedAt = MİKRO'NUN TARİHİ, bugün DEĞİL (Faz 1 3/n): eskiden `new Date()` yazılıyordu →
    // her Mikro siparişi Dashboard'da "bugün" görünüp 7 günlük ciro/KPI'ya sızıyordu.
    // OrdersPage aynı eşlemede `ms.tarih` kullanıyor; tarih yoksa siparisTarih null döner.
    syncedAt: ms.tarih,
    source: 'mikro-siparis',   // odemeTakipli ayrımı için (OrdersPage ile aynı düzeltme)
  })) as unknown as Order[];
  
  const combinedOrders = [...orders, ...mappedMikroSiparisler];

  return (
            <motion.div key="dashboard" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-6">
              {/* Welcome */}
              <ModuleHeader
                title={`${(() => {
                  const h = dashClock.getHours();
                  if (currentLanguage === 'tr') return h < 12 ? 'Günaydın' : h < 17 ? 'İyi öğlenler' : 'İyi akşamlar';
                  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
                })()}${user?.displayName ? `, ${user.displayName.split(' ')[0]}` : ''} ${dashClock.getHours() < 12 ? '☀️' : dashClock.getHours() < 17 ? '👋' : '🌙'}`}
                subtitle={dashT.subtitle}
                icon={LayoutDashboard}
                actionButton={
                  <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                    {/* Mikro verisinin tazeliği — gece senkronu sessizce durursa
                        burada görünür. Tıklayınca ERP Hub'a gider. */}
                    <SonSenkronRozeti currentLanguage={currentLanguage} onNavigate={() => setActiveTab('settings')} />
                    <DashboardAnalysis currentLanguage={currentLanguage} data={{
                      orders: filteredOrders, // Analiz modülü için native veriler yeterli olabilir, ancak gerekirse combinedOrders verilir.
                      leads: filteredLeads,
                      inventory: inventory,
                      revenue: combinedRevenue
                    }} />
                    <DateRangePicker
                      startDate={dateRange.startDate}
                      endDate={dateRange.endDate}
                      onStartDateChange={(d) => setDateRange(prev => ({ ...prev, startDate: d }))}
                      onEndDateChange={(d) => setDateRange(prev => ({ ...prev, endDate: d }))}
                      currentLanguage={currentLanguage}
                    />
                    {/* Phase 514: Live clock */}
                    <div className="hidden lg:flex flex-col items-end text-right">
                      <span className="text-sm font-black text-gray-800 tabular-nums">{dashClock.toLocaleTimeString(currentLanguage === 'en' ? 'en-US' : 'tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                      <span className="text-[10px] text-gray-400">{dashClock.toLocaleDateString(currentLanguage === 'en' ? 'en-US' : 'tr-TR', { weekday: 'short', day: 'numeric', month: 'short' })}</span>
                    </div>
                  </div>
                }
              />

              {/* ── Phase 528: Smart Alert Strip ── */}
              {(() => {
                const now528 = Date.now();
                const alerts: { id: string; color: string; icon: string; msg: string }[] = [];

                // Orders stuck in Pending > 3 days (native + mikro)
                const stuckPending = combinedOrders.filter(o => {
                  if (o.status !== 'Pending') return false;
                  const raw = o.createdAt ?? o.syncedAt;
                  if (!raw) return false;
                  const d = typeof (raw as { toDate?: () => Date }).toDate === 'function'
                    ? (raw as { toDate: () => Date }).toDate()
                    : new Date(raw as string | number);
                  return (now528 - d.getTime()) > 3 * 86400000;
                });
                if (stuckPending.length > 0)
                  alerts.push({ id: 'stuckPending', color: 'amber', icon: '⏳',
                    msg: currentLanguage === 'tr'
                      ? `${stuckPending.length} sipariş 3+ gündür bekliyor`
                      : `${stuckPending.length} order${stuckPending.length > 1 ? 's' : ''} pending for 3+ days` });

                // Leads with no activity > 7 days
                const inactiveLeads = leads.filter(l => {
                  if (l.status === 'Closed') return false;
                  const raw = l.updatedAt ?? l.createdAt;
                  if (!raw) return false;
                  const d = typeof (raw as { toDate?: () => Date }).toDate === 'function'
                    ? (raw as { toDate: () => Date }).toDate()
                    : new Date(raw as string | number);
                  return (now528 - d.getTime()) > 7 * 86400000;
                });
                if (inactiveLeads.length > 0)
                  alerts.push({ id: 'inactiveLeads', color: 'blue', icon: '👤',
                    msg: currentLanguage === 'tr'
                      ? `${inactiveLeads.length} aktif aday 7+ gündür güncellenmedi`
                      : `${inactiveLeads.length} active lead${inactiveLeads.length > 1 ? 's' : ''} with no activity in 7+ days` });

                // Critical low stock
                const criticalStock = inventory.filter(i => (i.stockLevel ?? 0) <= 0);
                if (criticalStock.length > 0)
                  alerts.push({ id: 'criticalStock', color: 'red', icon: '📦',
                    msg: currentLanguage === 'tr'
                      ? `${criticalStock.length} ürün stokta kalmadı (sıfır stok)`
                      : `${criticalStock.length} product${criticalStock.length > 1 ? 's' : ''} out of stock` });

                // Unpaid delivered orders
                const unpaidDelivered = orders.filter(o => o.status === 'Delivered' && !o.paid && odemeTakipli(o));
                if (unpaidDelivered.length > 0)
                  alerts.push({ id: 'unpaidDelivered', color: 'rose', icon: '💳',
                    msg: currentLanguage === 'tr'
                      ? `${unpaidDelivered.length} teslim edilmiş sipariş hâlâ ödenmedi`
                      : `${unpaidDelivered.length} delivered order${unpaidDelivered.length > 1 ? 's' : ''} still unpaid` });

                const visible = alerts.filter(a => !p528Dismissed.has(a.id));
                if (visible.length === 0) return null;

                const colorMap: Record<string, string> = {
                  amber: 'bg-amber-50 border-amber-200 text-amber-800',
                  blue:  'bg-blue-50 border-blue-200 text-blue-800',
                  red:   'bg-red-50 border-red-200 text-red-800',
                  rose:  'bg-rose-50 border-rose-200 text-rose-800',
                };
                return (
                  <div className="flex flex-wrap gap-2">
                    {visible.map(alert => (
                      <div key={alert.id} className={cn("flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-medium", colorMap[alert.color] ?? colorMap.amber)}>
                        <span>{alert.icon}</span>
                        <span>{alert.msg}</span>
                        <button
                          onClick={() => setP528Dismissed(prev => new Set([...prev, alert.id]))}
                          className="ml-1 opacity-50 hover:opacity-100 transition-opacity font-bold text-[10px]"
                          title={currentLanguage === 'tr' ? 'Kapat' : 'Dismiss'}
                        >✕</button>
                      </div>
                    ))}
                  </div>
                );
              })()}

              {/* KPI Cards */}
              {(() => {
                return (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {[
                  { label: dashT.total_orders, value: filteredOrders.length, ready: ordersCountReady, icon: Package, color: 'text-blue-500', bg: 'bg-blue-50', sub: `${filteredOrders.filter(o => o.status === 'Pending').length} ${dashT.pending}`, tab: 'orders', delta: summaryData?.orders?.delta, prev: summaryData?.orders?.prevCount },
                  { label: dashT.active_leads, value: filteredLeads.filter(l => !['Closed Won','Closed Lost'].includes(l.status)).length, ready: leadsCountReady, icon: Users, color: 'text-brand', bg: 'bg-brand/10', sub: `${filteredLeads.length} ${dashT.total}`, tab: 'crm', delta: null },
                  { label: dashT.inventory_label, value: inventory.length, ready: inventoryCountReady, icon: List, color: 'text-purple-500', bg: 'bg-purple-50', sub: `${inventory.filter(i => i.stockLevel <= i.lowStockThreshold).length} ${dashT.low_stock}`, tab: 'inventory', delta: null },
                ].map((kpi, i) => (
                  <button key={i} onClick={() => setActiveTab(kpi.tab)}
                    className="apple-card p-4 text-left hover:shadow-md hover:scale-[1.02] transition-all duration-150 cursor-pointer group flex flex-col min-h-[130px]">
                    <div className="flex items-start justify-between mb-2">
                      <div className={`w-9 h-9 rounded-xl ${kpi.bg} flex items-center justify-center`}>
                        <kpi.icon className={`w-4 h-4 ${kpi.color}`} />
                      </div>
                      <DeltaBadge delta={kpi.delta} prev={(kpi as { prev?: number }).prev} />
                    </div>
                    {/* SSE kademeli akarken (özellikle buyuk koleksiyonlarda) bu sayim
                        yukselen bir ARA DEGERdir — tam anlik goruntu gelene kadar
                        yukleniyor gosterilir (bkz. revenueReady yorumu). */}
                    {kpi.ready ? (
                      <p className="text-2xl font-bold mt-auto" style={{color:'var(--text-primary)'}}>{kpi.value}</p>
                    ) : (
                      <p className="text-2xl font-bold mt-auto text-gray-300 animate-pulse">···</p>
                    )}
                    <p className="text-xs font-semibold text-gray-500 mt-1">{kpi.label}</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">{kpi.sub}</p>
                    <p className="text-[10px] text-brand mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5">
                      <ChevronRight className="w-3 h-3" />{currentLanguage === 'tr' ? 'Detaya git' : 'View details'}
                    </p>
                  </button>
                ))}
                {/* Revenue KPI with currency toggle + delta */}
                {(() => {
                  // `symbol` yalnizca YUKLENIYOR gostergesi icin ('$···'); tutarin
                  // kendisi fmtKpi'den gelir (kur yoksa '—', sembolsuz).
                  const symbol = kpiCurrency === 'TRY' ? '₺' : kpiCurrency === 'USD' ? '$' : '€';
                  const revDelta = summaryData?.revenue?.delta;
                  // Tutar dateRange'e göre filtreleniyor ama alt etiket sabit
                  // "Son 30 gün" yazıyordu; delta rozeti de summary'nin 30-günlük
                  // karşılaştırması. Kullanıcı aralığı değiştirince rakam değişip
                  // etiket değişmiyordu (2026-09-03 SS'li bildirim). Etiket artık
                  // gerçek aralığı söyler, 30-günlük delta yalnız varsayılan
                  // aralıkta gösterilir — başka aralıkta yanıltıcı olur.
                  const bugun = new Date();
                  const otuzGunOnce = new Date(); otuzGunOnce.setDate(bugun.getDate() - 30);
                  // gunAnahtari (utils/zaman) YEREL YYYY-MM-DD üretir — toISOString UTC
                  // döndüğü için TR'de 00:00-03:00 arası bir gün kayardı. App.tsx'teki
                  // varsayılan aralık da date-fns format ile yerel gün yazıyor.
                  const araligVarsayilan = dateRange.startDate === gunAnahtari(otuzGunOnce)
                    && dateRange.endDate === gunAnahtari(bugun);
                  // Boş/eksik tarih (kullanıcı date input'u temizleyebilir) '' döner →
                  // eskiden 'undefined.undefined.' basıyordu (2026-09-03 code-review).
                  const trTarih = (iso: string): string => {
                    const [y, a, g] = (iso || '').split('-');
                    return (y && a && g) ? `${g}.${a}.${y}` : '—';
                  };
                  const aralikEtiketi = araligVarsayilan
                    ? (currentLanguage === 'tr' ? 'Son 30 gün' : 'Last 30 days')
                    : `${trTarih(dateRange.startDate)} – ${trTarih(dateRange.endDate)}`;
                  return (
                    <div className="apple-card p-4 text-left group flex flex-col min-h-[130px]">
                      <div className="flex items-center justify-between mb-2">
                        <div className="w-9 h-9 rounded-xl bg-green-50 flex items-center justify-center">
                          <DollarSign className="w-4 h-4 text-green-500" />
                        </div>
                        <div className="flex items-center gap-1.5">
                          {revDelta != null && araligVarsayilan && (
                            <DeltaBadge delta={revDelta} prev={summaryData?.revenue?.prev} birim="tutar" />
                          )}
                          <div className="flex items-center gap-0.5 bg-gray-100 rounded-lg p-0.5">
                            {(['TRY','USD','EUR'] as const).map(c => (
                              <button key={c} onClick={() => setKpiCurrency(c)}
                                className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md transition-all ${kpiCurrency===c ? 'bg-white shadow-sm text-gray-800' : 'text-gray-400 hover:text-gray-600'}`}>
                                {c === 'TRY' ? '₺' : c === 'USD' ? '$' : '€'}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                      {revenueReady ? (
                        <p className="text-2xl font-bold mt-auto" style={{color:'var(--text-primary)'}}>{fmtKpi(combinedRevenue)}</p>
                      ) : (
                        <p className="text-2xl font-bold mt-auto text-gray-300 animate-pulse" title={currentLanguage === 'tr' ? 'Veri yükleniyor…' : 'Loading…'}>{symbol}···</p>
                      )}
                      <p className="text-xs font-semibold text-gray-500 mt-1">{dashT.total_revenue}</p>
                      <p className="text-[10px] text-gray-400 mt-0.5">
                        {aralikEtiketi}
                      </p>
                      {/* Phase 35: 7 GÜNLÜK ciro sparkline — kartın büyük rakamı seçili
                          tarih aralığına, bu mini grafik BİLEREK son 7 güne bakar (kısa
                          vadeli eğilim göstergesi). Farklı pencere olduğu tooltip'te yazar.

                          ÇİFT SAYIM DÜZELTİLDİ (2026-09-04): `orders` HAM okunuyordu ve
                          altında `mikroFaturalar` ayrıca toplanıyordu — Mikro faturasından
                          türetilen siparişler (source:'mikro-fatura') iki kez sayılıyor,
                          çubuklar gerçeğin iki katına çıkıyordu. Kartın büyük rakamı
                          (combinedRevenue) bu korumaya zaten sahipti; sparkline değildi. */}
                      {(() => {
                        const days = Array.from({ length: 7 }, (_, i) => {
                          const d = new Date(); d.setDate(d.getDate() - (6 - i));
                          const dayStr = d.toDateString();

                          // Native revenue for this day
                          const revNative = orders.filter(o => {
                            if (!odemeTakipli(o)) return false;   // mikro türevi aşağıda sayılıyor
                            const od = siparisTarih(o);
                            return od?.toDateString() === dayStr;
                          }).reduce((s, o) => s + (o.totalPrice || 0), 0);
                          
                          // Mikro revenue for this day
                          const revMikro = mikroFaturalar.filter(f => {
                            if (f.yon !== 'giden') return false;
                            const fd = new Date(f.tarih);
                            return fd.toDateString() === dayStr;
                          }).reduce((s, f) => s + (f.tutar || 0), 0);

                          return { day: d.getDate(), rev: revNative + revMikro };
                        });
                        const maxRev = Math.max(...days.map(d => d.rev), 1);
                        return (
                          <div className="flex items-end gap-0.5 mt-2 h-8">
                            {days.map((d, i) => (
                              <div key={i} className="flex-1 flex flex-col justify-end">
                                <div
                                  className="bg-green-400 rounded-sm opacity-60 group-hover:opacity-100 transition-opacity"
                                  style={{ height: `${Math.max((d.rev / maxRev) * 100, 4)}%` }}
                                  title={`${d.day}. gün: ${fmtKpi(d.rev)} — ${currentLanguage === 'tr' ? 'son 7 gün eğilimi' : 'last 7 days trend'}`}
                                />
                              </div>
                            ))}
                          </div>
                        );
                      })()}
                      <button onClick={() => setActiveTab('reports')} className="text-[10px] text-brand mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5">
                        <ChevronRight className="w-3 h-3" />{currentLanguage === 'tr' ? 'Detaya git' : 'View details'}
                      </button>
                    </div>
                  );
                })()}
              </div>
                );
              })()}

              {/* ── Insight strip: revenue trend + alerts + search CTA ── */}
              {(() => {
                const pendingCount   = combinedOrders.filter(o => o.status === 'Pending').length;
                const lowStockCount  = inventory.filter(i => (i.stockLevel ?? 0) <= (i.lowStockThreshold ?? 5)).length;
                const shippedToday   = orders.filter(o => {
                  const d = (o.syncedAt as { toDate?: () => Date })?.toDate?.() ?? new Date(0);
                  return o.status === 'Shipped' && d.toDateString() === new Date().toDateString();
                }).length;
                // ÇİFT FİLTRE DÜZELTİLDİ (2026-09-04): `filteredOrders` zaten seçili
                // tarih aralığına süzülmüştü, üstüne bir de sabit "son 7 gün" penceresi
                // uygulanıyordu — kullanıcı aralığı "bu yıl" yapınca kart yine son 7
                // günü gösteriyor, ama etiketi bunu söylemiyordu. Ayrıca tarih yalnız
                // `syncedAt`ten okunuyordu: Mikro faturasından türetilen siparişlerde o
                // alan YOK, `new Date(0)` yedeğiyle 1970'e düşüp filtreden eleniyorlardı.
                // KAYNAK `orders` (HAM), `filteredOrders` DEĞİL — etiket "aralıktan
                // bağımsız" diyorsa hesap da öyle olmalı. Önceki hâli çift filtreliydi:
                // aralık "bu yıl" iken doğru çalışıyor gibi görünüyor ama aralık "geçen
                // ay" seçilince kart BOŞALIYORDU (kesişim boş), oysa etiket hâlâ
                // "son 7 gün" diyordu (2026-09-04 son kontrol bulgusu).
                //
                // Çift sayım koruması sparkline ile aynı: mikro-fatura türevleri
                // `mikroFaturalar` üzerinden ayrıca sayılıyor.
                const weekRevenue = orders
                  .filter(o => {
                    if (!odemeTakipli(o)) return false;
                    const d = siparisTarih(o);
                    return !!d && (Date.now() - d.getTime()) < 7 * 86400000;
                  })
                  .reduce((s, o) => s + (o.totalPrice || 0), 0)
                  + mikroFaturalar
                      .filter(f => {
                        if (f.yon !== 'giden') return false;
                        const d = new Date(f.tarih);
                        return !isNaN(d.getTime()) && (Date.now() - d.getTime()) < 7 * 86400000;
                      })
                      .reduce((s, f) => s + (f.tutar || 0), 0);

                return (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {/* ── 7-Day Revenue card — with currency toggle ── */}
                    <div
                      onClick={() => setActiveTab('reports')}
                      role="button" tabIndex={0}
                      onKeyDown={e => e.key === 'Enter' && setActiveTab('reports')}
                      className="apple-card p-4 cursor-pointer hover:shadow-md hover:scale-[1.02] transition-all duration-150 group flex flex-col min-h-[130px]"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="w-9 h-9 rounded-xl bg-emerald-50 flex items-center justify-center flex-shrink-0">
                          <TrendingUp className="w-4 h-4 text-emerald-600" />
                        </div>
                        {/* Currency toggle */}
                        <div className="flex items-center gap-0.5 bg-gray-100 rounded-lg p-0.5" onClick={e => e.stopPropagation()}>
                          {(['TRY','USD','EUR'] as const).map(c => (
                            <button key={c} onClick={() => setKpiCurrency(c)}
                              className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md transition-all ${kpiCurrency===c ? 'bg-white shadow-sm text-gray-800' : 'text-gray-400 hover:text-gray-600'}`}>
                              {c === 'TRY' ? '₺' : c === 'USD' ? '$' : '€'}
                            </button>
                          ))}
                        </div>
                      </div>
                      <p className="text-2xl font-bold text-emerald-600 mt-auto">
                        {fmtKpi(weekRevenue)}
                      </p>
                      <p className="text-[10px] font-semibold text-gray-500 truncate mt-1">{currentLanguage === 'tr' ? '7 Günlük Ciro' : '7-Day Revenue'}</p>
                      <p className="text-[10px] text-gray-400"
                        title={currentLanguage === 'tr'
                          ? 'Bu kart seçili tarih aralığından bağımsızdır: her zaman son 7 günü gösterir.'
                          : 'Independent of the selected date range: always the last 7 days.'}>
                        {currentLanguage === 'tr' ? 'Son 7 gün (aralıktan bağımsız)' : 'Last 7 days (range-independent)'}
                      </p>
                    </div>

                    {/* ── Remaining plain cards ── */}
                    {[
                      {
                        icon: Clock,
                        label: currentLanguage === 'tr' ? 'Bekleyen Sipariş' : 'Pending Orders',
                        value: pendingCount,
                        color: pendingCount > 5 ? 'text-amber-600' : 'text-gray-600',
                        bg:   pendingCount > 5 ? 'bg-amber-50' : 'bg-gray-50',
                        sub:  pendingCount > 5 ? (currentLanguage === 'tr' ? '⚠ Acil' : '⚠ Urgent') : (currentLanguage === 'tr' ? 'Normal' : 'Normal'),
                        onClick: () => setActiveTab('orders'),
                      },
                      {
                        icon: AlertTriangle,
                        label: currentLanguage === 'tr' ? 'Düşük Stok' : 'Low Stock',
                        value: lowStockCount,
                        color: lowStockCount > 0 ? 'text-red-600' : 'text-gray-400',
                        bg:   lowStockCount > 0 ? 'bg-red-50' : 'bg-gray-50',
                        sub:  lowStockCount > 0 ? (currentLanguage === 'tr' ? 'Sipariş verilmeli' : 'Reorder needed') : (currentLanguage === 'tr' ? 'Stok yeterli' : 'Stock OK'),
                        onClick: () => setActiveTab('inventory'),
                      },
                      {
                        icon: Truck,
                        label: currentLanguage === 'tr' ? 'Bugün Kargolandı' : 'Shipped Today',
                        value: shippedToday,
                        color: 'text-blue-600',
                        bg:   'bg-blue-50',
                        sub:  currentLanguage === 'tr' ? 'Kargoya verilen' : 'Dispatched',
                        onClick: () => setActiveTab('lojistik'),
                      },
                    ].map((stat, i) => {
                      const Icon = stat.icon;
                      return (
                        <button
                          key={i}
                          onClick={stat.onClick}
                          className="apple-card p-4 text-left hover:shadow-md hover:scale-[1.02] transition-all duration-150 group flex flex-col min-h-[130px]"
                        >
                          <div className={`w-9 h-9 rounded-xl ${stat.bg} flex items-center justify-center mb-2`}>
                            <Icon className={`w-4 h-4 ${stat.color}`} />
                          </div>
                          <p className={`text-2xl font-bold ${stat.color} mt-auto`}>{stat.value}</p>
                          <p className="text-[10px] font-semibold text-gray-500 mt-0.5 truncate">{stat.label}</p>
                          <p className="text-[10px] text-gray-400 truncate">{stat.sub}</p>
                        </button>
                      );
                    })}
                  </div>
                );
              })()}

              {/* ── Phase 90: Smart Insights Strip ── */}
              {(() => {
                const insights: { icon: string; text: string; color: string; bg: string; borderColor: string }[] = [];

                // Insight 1: low-stock products
                const lowStock = inventory.filter(i => (Number(i.stock) || 0) > 0 && (Number(i.stock) || 0) <= (Number(i.minStock) || 5));
                if (lowStock.length > 0) {
                  const top = lowStock.sort((a, b) => (Number(a.stock) || 0) - (Number(b.stock) || 0))[0];
                  insights.push({
                    icon: '📦',
                    text: currentLanguage === 'tr'
                      ? `${top.name} kritik stokta (${top.stock ?? 0} adet kaldı)`
                      : `${top.name} is low in stock (${top.stock ?? 0} left)`,
                    color: 'text-amber-700',
                    bg: 'bg-amber-50',
                    borderColor: 'border-amber-200',
                  });
                }

                // Insight 2: unpaid orders total
                const unpaidOrders = orders.filter(o => !o.paid && o.status !== 'Cancelled' && odemeTakipli(o));
                if (unpaidOrders.length > 0) {
                  const unpaidTotal = unpaidOrders.reduce((s, o) => s + (o.totalPrice ?? 0), 0);
                  insights.push({
                    icon: '💳',
                    text: currentLanguage === 'tr'
                      ? `${unpaidOrders.length} siparişte ${fmtKpi(unpaidTotal)} ödeme bekliyor`
                      : `${unpaidOrders.length} order${unpaidOrders.length > 1 ? 's' : ''} pending payment (${fmtKpi(unpaidTotal)})`,
                    color: 'text-red-700',
                    bg: 'bg-red-50',
                    borderColor: 'border-red-200',
                  });
                }

                // Insight 3: overdue leads (no follow-up in 7+ days with Contacted status)
                const now7 = Date.now();
                const overdueleads = leads.filter(l => {
                  if (l.status === 'Closed') return false;
                  const raw = l.updatedAt ?? l.createdAt;
                  if (!raw) return true;
                  const d = typeof (raw as { toDate?: () => Date }).toDate === 'function'
                    ? (raw as { toDate: () => Date }).toDate()
                    : new Date(raw as string | number);
                  return now7 - d.getTime() > 7 * 86400000;
                });
                if (overdueleads.length > 0) {
                  insights.push({
                    icon: '🎯',
                    text: currentLanguage === 'tr'
                      ? `${overdueleads.length} müşteri adayı 7+ gündür güncellenmedi`
                      : `${overdueleads.length} lead${overdueleads.length > 1 ? 's' : ''} haven't been updated in 7+ days`,
                    color: 'text-purple-700',
                    bg: 'bg-purple-50',
                    borderColor: 'border-purple-200',
                  });
                }

                // Insight 4: top revenue month-over-month rise
                const nowD = new Date();
                const thisMonthRev = orders
                  .filter(o => {
                    const raw = o.syncedAt ?? o.createdAt;
                    if (!raw) return false;
                    const d = typeof (raw as { toDate?: () => Date }).toDate === 'function' ? (raw as { toDate: () => Date }).toDate() : new Date(raw as string | number);
                    return d.getFullYear() === nowD.getFullYear() && d.getMonth() === nowD.getMonth();
                  })
                  .reduce((s, o) => s + (o.totalPrice ?? 0), 0);
                const lastMonthRev = orders
                  .filter(o => {
                    const raw = o.syncedAt ?? o.createdAt;
                    if (!raw) return false;
                    const d = typeof (raw as { toDate?: () => Date }).toDate === 'function' ? (raw as { toDate: () => Date }).toDate() : new Date(raw as string | number);
                    const lm = new Date(nowD.getFullYear(), nowD.getMonth() - 1, 1);
                    return d.getFullYear() === lm.getFullYear() && d.getMonth() === lm.getMonth();
                  })
                  .reduce((s, o) => s + (o.totalPrice ?? 0), 0);
                if (lastMonthRev > 0 && thisMonthRev > lastMonthRev * 1.1) {
                  const pct = Math.round(((thisMonthRev - lastMonthRev) / lastMonthRev) * 100);
                  insights.push({
                    icon: '📈',
                    text: currentLanguage === 'tr'
                      ? `Bu ay gelir geçen aya göre %${pct} artışta`
                      : `Revenue is up ${pct}% vs last month`,
                    color: 'text-emerald-700',
                    bg: 'bg-emerald-50',
                    borderColor: 'border-emerald-200',
                  });
                }

                if (insights.length === 0) return null;

                return (
                  <div className={`rounded-2xl border p-4 ${darkMode ? 'bg-white/5 border-white/10' : 'bg-white border-gray-100 shadow-sm'}`}>
                    <p className={`text-[10px] font-bold uppercase tracking-wider mb-3 flex items-center gap-1.5 ${darkMode ? 'text-white/65' : 'text-gray-400'}`}>
                      ✨ {currentLanguage === 'tr' ? 'Akıllı İçgörüler' : 'Smart Insights'}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {insights.slice(0, 4).map((ins, i) => (
                        <div key={i} className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-medium ${ins.bg} ${ins.borderColor} ${ins.color}`}>
                          <span className="text-sm">{ins.icon}</span>
                          <span>{ins.text}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* ── Phase 543: Upcoming Tax Deadlines Widget ── */}
              {dashVergiDeadlines.length > 0 && (() => {
                const getDays = (sonTarih: string) => Math.ceil((new Date(sonTarih).getTime() - Date.now()) / 86400000);
                return (
                  <div className={cn('rounded-2xl border p-4', darkMode ? 'bg-white/5 border-white/10' : 'bg-amber-50/60 border-amber-200/60')}>
                    <div className="flex items-center justify-between mb-3">
                      <p className={cn('text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5', darkMode ? 'text-white/65' : 'text-amber-700')}>
                        <Receipt className="w-3.5 h-3.5" />
                        {currentLanguage === 'tr' ? 'Yaklaşan Vergi Tarihleri' : 'Upcoming Tax Deadlines'}
                      </p>
                      <button
                        onClick={() => setActiveTab('vergi')}
                        className="text-[10px] font-bold text-amber-600 hover:text-amber-800 transition-colors flex items-center gap-0.5"
                      >
                        {currentLanguage === 'tr' ? 'Tümü' : 'All'} <ChevronRight className="w-3 h-3" />
                      </button>
                    </div>
                    <div className="space-y-2">
                      {dashVergiDeadlines.map(d => {
                        const days = getDays(d.sonTarih);
                        const isUrgent = days <= 7;
                        const isCritical = days <= 2;
                        return (
                          <div
                            key={d.id}
                            className={cn(
                              'flex items-center justify-between px-3 py-2 rounded-xl',
                              isCritical ? 'bg-red-100 border border-red-200' : isUrgent ? 'bg-orange-50 border border-orange-200' : 'bg-white border border-amber-100'
                            )}
                          >
                            <div className="min-w-0">
                              <p className={cn('text-xs font-bold truncate', isCritical ? 'text-red-800' : isUrgent ? 'text-orange-800' : 'text-gray-800')}>{d.vergiTuru}</p>
                              <p className="text-[10px] text-gray-500">{new Date(d.sonTarih).toLocaleDateString('tr-TR')}</p>
                            </div>
                            <span className={cn(
                              'shrink-0 ml-2 text-[10px] font-black px-2 py-0.5 rounded-full',
                              isCritical ? 'bg-red-200 text-red-800' : isUrgent ? 'bg-orange-200 text-orange-800' : 'bg-amber-100 text-amber-700'
                            )}>
                              {days === 0 ? (currentLanguage === 'tr' ? 'Bugün!' : 'Today!') : `${days}g`}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              {/* ── Phase 56: MTD Revenue vs. Last Month ── */}
              {orders.length > 0 && (() => {
                const now = new Date();
                const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
                const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
                const lastMonthEnd   = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
                const getOrderDate = (o: Order): Date => {
                  const raw = o.createdAt ?? o.syncedAt;
                  if (!raw) return new Date(0);
                  return typeof (raw as { toDate?: () => Date }).toDate === 'function'
                    ? (raw as { toDate: () => Date }).toDate()
                    : new Date(raw as string | number);
                };
                const mtdRev  = orders.filter(o => getOrderDate(o) >= thisMonthStart).reduce((s, o) => s + (o.totalPrice || 0), 0);
                const lastRev = orders.filter(o => { const d = getOrderDate(o); return d >= lastMonthStart && d <= lastMonthEnd; }).reduce((s, o) => s + (o.totalPrice || 0), 0);
                const pct = lastRev > 0 ? Math.round(((mtdRev - lastRev) / lastRev) * 100) : null;
                const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
                const dayProgress = Math.round((now.getDate() / daysInMonth) * 100);
                // On-pace projection
                const projectedRev   = dayProgress > 0 ? Math.round(mtdRev * (100 / dayProgress)) : mtdRev;
                return (
                  <div className={cn("rounded-2xl border p-5", darkMode ? "bg-white/5 border-white/10" : "bg-white border-gray-100 shadow-sm")}>
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <h3 className={cn("text-[10px] font-bold uppercase tracking-wider", darkMode ? "text-white/50" : "text-gray-400")}>
                          {currentLanguage === 'tr' ? 'Bu Ay Ciro (MTD)' : 'Revenue MTD'}
                        </h3>
                        <p className={cn("text-xl font-black mt-0.5", darkMode ? "text-white" : "text-gray-900")}>
                          {fmtKpi(mtdRev)}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1.5">
                        {/* Currency toggle — shared kpiCurrency */}
                        <div className="flex items-center gap-0.5 bg-gray-100 rounded-lg p-0.5">
                          {(['TRY','USD','EUR'] as const).map(c => (
                            <button key={c} onClick={() => setKpiCurrency(c)}
                              className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md transition-all ${kpiCurrency===c ? 'bg-white shadow-sm text-gray-800' : 'text-gray-400 hover:text-gray-600'}`}>
                              {c === 'TRY' ? '₺' : c === 'USD' ? '$' : '€'}
                            </button>
                          ))}
                        </div>
                        {pct !== null && (
                          <span className={cn("text-sm font-black px-2 py-1 rounded-xl", pct >= 0 ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600")}>
                            {pct >= 0 ? '▲' : '▼'} {Math.abs(pct)}%
                          </span>
                        )}
                        <p className={cn("text-[10px]", darkMode ? "text-white/65" : "text-gray-400")}>
                          {currentLanguage === 'tr' ? 'Geçen aya göre' : 'vs. last month'}
                        </p>
                      </div>
                    </div>
                    {/* Month progress bar */}
                    <div className="space-y-1">
                      <div className="flex justify-between text-[10px] text-gray-400">
                        <span>{currentLanguage === 'tr' ? 'Ay ilerlemesi' : 'Month progress'}: {dayProgress}%</span>
                        <span>{currentLanguage === 'tr' ? 'Projeksiyon' : 'Projected'}: {fmtKpi(projectedRev)}</span>
                      </div>
                      <div className={cn("h-2 rounded-full overflow-hidden", darkMode ? "bg-white/10" : "bg-gray-100")}>
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-brand to-orange-400 transition-all duration-700"
                          style={{ width: `${dayProgress}%` }}
                        />
                      </div>
                      {lastRev > 0 && (
                        <div className="flex justify-between text-[10px] text-gray-400">
                          <span>{currentLanguage === 'tr' ? 'Geçen ay' : 'Last month'}: {fmtKpi(lastRev)}</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* ── Phase 99: Monthly Sales Target (Satış Hedefi) ── */}
              {(() => {
                const now = new Date();
                const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
                const getOD = (o: Order): Date => {
                  const raw = o.createdAt ?? o.syncedAt;
                  if (!raw) return new Date(0);
                  return typeof (raw as { toDate?: () => Date }).toDate === 'function' ? (raw as { toDate: () => Date }).toDate() : new Date(raw as string | number);
                };
                const mtdRev99 = orders.filter(o => getOD(o) >= thisMonthStart && o.status !== 'Cancelled').reduce((s, o) => s + (o.totalPrice || 0), 0);
                const pct99 = monthlyTarget > 0 ? Math.min(Math.round((mtdRev99 / monthlyTarget) * 100), 200) : 0;
                const barColor99 = pct99 >= 100 ? 'bg-emerald-400' : pct99 >= 70 ? 'bg-brand' : pct99 >= 40 ? 'bg-amber-400' : 'bg-red-400';
                return (
                  <div className={cn("rounded-2xl border p-5", darkMode ? "bg-white/5 border-white/10" : "bg-white border-gray-100 shadow-sm")}>
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <h3 className={cn("text-[10px] font-bold uppercase tracking-wider", darkMode ? "text-white/50" : "text-gray-400")}>
                          {currentLanguage === 'tr' ? 'Bu Ay Satış Hedefi' : 'Monthly Sales Target'}
                        </h3>
                        {isEditingTarget ? (
                          <div className="flex items-center gap-2 mt-1">
                            <input
                              autoFocus
                              type="number"
                              value={targetDraft}
                              onChange={e => setTargetDraft(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === 'Enter') {
                                  const v = Number(targetDraft);
                                  const mk = (() => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}`; })();
                                  saveMonthlyTarget(mk, v);
                                  setIsEditingTarget(false);
                                }
                                if (e.key === 'Escape') setIsEditingTarget(false);
                              }}
                              className="text-sm font-bold bg-gray-100 rounded-lg px-2 py-1 outline-none w-36"
                              placeholder="0"
                            />
                            <button onClick={() => { const v = Number(targetDraft); const mk = (() => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}`; })(); saveMonthlyTarget(mk, v); setIsEditingTarget(false); }}
                              className="text-[10px] bg-brand text-white px-2 py-1 rounded-lg font-bold">{currentLanguage === 'tr' ? 'Kaydet' : 'Save'}</button>
                            <button onClick={() => setIsEditingTarget(false)} className="text-[10px] text-gray-400 hover:text-gray-600">{currentLanguage === 'tr' ? 'İptal' : 'Cancel'}</button>
                          </div>
                        ) : (
                          <button onClick={() => { setTargetDraft(String(monthlyTarget)); setIsEditingTarget(true); }}
                            className="flex items-center gap-1 mt-0.5 group">
                            <p className={cn("text-xl font-black", darkMode ? "text-white" : "text-gray-900")}>
                              {monthlyTarget > 0 ? fmtKpi(monthlyTarget) : (currentLanguage === 'tr' ? 'Hedef belirle…' : 'Set target…')}
                            </p>
                            <span className="text-gray-300 group-hover:text-brand transition-colors text-[10px]">✎</span>
                          </button>
                        )}
                      </div>
                      <div className="text-right">
                        <p className={`text-2xl font-black ${pct99 >= 100 ? 'text-emerald-600' : pct99 >= 70 ? 'text-brand' : pct99 >= 40 ? 'text-amber-600' : 'text-red-500'}`}>{pct99}%</p>
                        <p className={cn("text-[10px]", darkMode ? "text-white/65" : "text-gray-400")}>{fmtKpi(mtdRev99)} {currentLanguage === 'tr' ? 'gerçekleşti' : 'achieved'}</p>
                      </div>
                    </div>
                    <div className={cn("h-2.5 rounded-full overflow-hidden", darkMode ? "bg-white/10" : "bg-gray-100")}>
                      <div className={`h-full rounded-full transition-all duration-700 ${barColor99}`} style={{ width: `${Math.min(pct99, 100)}%` }} />
                    </div>
                    <div className="flex justify-between mt-1.5">
                      <span className={cn("text-[10px]", darkMode ? "text-white/60" : "text-gray-400")}>0</span>
                      {pct99 >= 100 && <span className="text-[10px] font-bold text-emerald-600">🎯 {currentLanguage === 'tr' ? 'Hedefe ulaşıldı!' : 'Target reached!'}</span>}
                      <span className={cn("text-[10px]", darkMode ? "text-white/60" : "text-gray-400")}>{monthlyTarget > 0 ? fmtKpi(monthlyTarget) : '—'}</span>
                    </div>
                  </div>
                );
              })()}

              {/* ── Phase 174: Sales vs Budget – Last 3 Months ── */}
              {monthlyTarget > 0 && orders.length > 0 && (() => {
                const now174 = new Date();
                const months174 = Array.from({ length: 3 }, (_, i) => {
                  const d = new Date(now174.getFullYear(), now174.getMonth() - (2 - i), 1);
                  const label = d.toLocaleDateString(currentLanguage === 'tr' ? 'tr-TR' : 'en-US', { month: 'short' });
                  const mOrders = orders.filter(o => {
                    if (o.status === 'Cancelled') return false;
                    try {
                      const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
                      return od.getFullYear() === d.getFullYear() && od.getMonth() === d.getMonth();
                    } catch { return false; }
                  });
                  const actual = mOrders.reduce((s, o) => s + (o.totalPrice || 0), 0);
                  const pct = monthlyTarget > 0 ? Math.round((actual / monthlyTarget) * 100) : 0;
                  return { label, actual, pct };
                });
                return (
                  <div className={cn("rounded-2xl border p-5", darkMode ? "bg-white/5 border-white/10" : "bg-white border-gray-100 shadow-sm")}>
                    <h3 className={cn("text-[10px] font-bold uppercase tracking-wider mb-3", darkMode ? "text-white/50" : "text-gray-400")}>
                      {currentLanguage === 'tr' ? 'Satış / Bütçe (3 Ay)' : 'Sales vs Budget (3M)'}
                    </h3>
                    <div className="flex items-end gap-4 h-20">
                      {months174.map((m, i) => {
                        const h = Math.min(m.pct, 120);
                        const barCls = m.pct >= 100 ? 'bg-emerald-400' : m.pct >= 70 ? 'bg-amber-400' : 'bg-red-400';
                        return (
                          <div key={i} className="flex-1 flex flex-col items-center gap-1">
                            <div className="w-full flex flex-col justify-end relative" style={{ height: '60px' }}>
                              <div className={`w-full rounded-t-lg transition-all ${barCls}`} style={{ height: `${Math.max(h * 0.5, 4)}%` }} />
                              <div className="absolute bottom-0 w-full border-t-2 border-dashed border-gray-300" style={{ bottom: '50%' }} />
                            </div>
                            <span className="text-[9px] text-gray-400">{m.label}</span>
                            <span className={`text-[9px] font-bold ${m.pct >= 100 ? 'text-emerald-600' : m.pct >= 70 ? 'text-amber-600' : 'text-red-500'}`}>%{m.pct}</span>
                          </div>
                        );
                      })}
                    </div>
                    <p className="text-[10px] text-gray-400 mt-1 text-center">{currentLanguage==='tr'?'Kesikli çizgi = hedef':'Dashed = target'}</p>
                  </div>
                );
              })()}

              {/* ── Phase 42: Financial KPI mini-strip ── */}
              {(() => {
                const aov = filteredOrders.length > 0
                  ? filteredOrders.reduce((s, o) => s + (o.totalPrice || 0), 0) / filteredOrders.length
                  : 0;
                const deliveryRate = orders.length > 0
                  ? Math.round((orders.filter(o => o.status === 'Delivered').length / orders.length) * 100)
                  : 0;
                const leadConvRate = leads.length > 0
                  ? Math.round((leads.filter(l => l.status === 'Closed' || (l.status as string) === 'Closed Won').length / leads.length) * 100)
                  : 0;
                const repeatBuyers = (() => {
                  const custMap: Record<string, number> = {};
                  for (const o of orders) { custMap[o.customerName] = (custMap[o.customerName] ?? 0) + 1; }
                  return Object.values(custMap).filter(c => c > 1).length;
                })();
                return (
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    {/* ── AOV card — with currency toggle ── */}
                    <div onClick={() => setActiveTab('reports')}
                      role="button" tabIndex={0}
                      onKeyDown={e => e.key === 'Enter' && setActiveTab('reports')}
                      className="apple-card p-4 cursor-pointer hover:shadow-md hover:scale-[1.02] transition-all duration-150 group flex flex-col">
                      <div className="flex items-center justify-between mb-2">
                        <div className="w-9 h-9 rounded-xl bg-emerald-50 flex items-center justify-center flex-shrink-0">
                          <DollarSign className="w-4 h-4 text-emerald-600" />
                        </div>
                        <div className="flex items-center gap-0.5 bg-gray-100 rounded-lg p-0.5" onClick={e => e.stopPropagation()}>
                          {(['TRY','USD','EUR'] as const).map(c => (
                            <button key={c} onClick={() => setKpiCurrency(c)}
                              className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md transition-all ${kpiCurrency===c ? 'bg-white shadow-sm text-gray-800' : 'text-gray-400 hover:text-gray-600'}`}>
                              {c === 'TRY' ? '₺' : c === 'USD' ? '$' : '€'}
                            </button>
                          ))}
                        </div>
                      </div>
                      <p className="text-xl font-bold text-emerald-600">
                        {fmtKpi(aov)}
                      </p>
                      <p className="text-[10px] font-semibold text-gray-500 mt-1">{currentLanguage === 'tr' ? 'Ort. Sipariş Değeri' : 'Avg. Order Value'}</p>
                      <p className="text-[10px] text-gray-400">AOV</p>
                    </div>

                    {/* ── Remaining plain KPI cards ── */}
                    {[
                      {
                        label: currentLanguage === 'tr' ? 'Teslimat Oranı' : 'Delivery Rate',
                        value: `${deliveryRate}%`,
                        sub: `${orders.filter(o => o.status === 'Delivered').length} / ${orders.length}`,
                        icon: CheckCircle2, color: deliveryRate > 80 ? 'text-emerald-600' : 'text-amber-600', bg: deliveryRate > 80 ? 'bg-emerald-50' : 'bg-amber-50',
                        onClick: () => setActiveTab('orders'),
                      },
                      {
                        label: currentLanguage === 'tr' ? 'Müşteri Dönüşümü' : 'Lead Conversion',
                        value: `${leadConvRate}%`,
                        sub: `${leads.filter(l => l.status === 'Closed' || (l.status as string) === 'Closed Won').length} ${currentLanguage === 'tr' ? 'kazanıldı' : 'won'}`,
                        icon: TrendingUp, color: leadConvRate > 20 ? 'text-blue-600' : 'text-gray-400', bg: leadConvRate > 20 ? 'bg-blue-50' : 'bg-gray-50',
                        onClick: () => setActiveTab('crm'),
                      },
                      {
                        label: currentLanguage === 'tr' ? 'Tekrar Eden Alıcı' : 'Repeat Buyers',
                        value: repeatBuyers,
                        sub: currentLanguage === 'tr' ? 'birden fazla sipariş' : 'multiple orders',
                        icon: Users, color: 'text-purple-600', bg: 'bg-purple-50',
                        onClick: () => setActiveTab('crm'),
                      },
                    ].map((stat, i) => {
                      const Icon = stat.icon;
                      return (
                        <button key={i} onClick={stat.onClick}
                          className="apple-card p-4 text-left hover:shadow-md hover:scale-[1.02] transition-all duration-150 group flex flex-col">
                          <div className={`w-9 h-9 rounded-xl ${stat.bg} flex items-center justify-center flex-shrink-0 mb-2`}>
                            <Icon className={`w-4 h-4 ${stat.color}`} />
                          </div>
                          <p className={`text-xl font-bold ${stat.color} mt-auto`}>{stat.value}</p>
                          <p className="text-[10px] font-semibold text-gray-500 mt-0.5 truncate">{stat.label}</p>
                          <p className="text-[10px] text-gray-400 truncate">{stat.sub}</p>
                        </button>
                      );
                    })}
                  </div>
                );
              })()}

              {/* ── Phase 124: KPI Alert Thresholds ── */}
              {(() => {
                const alerts125: Array<{ level: 'warn' | 'danger'; icon: string; message: string }> = [];
                // Low stock items
                const lowStockCount = inventory.filter(i => (i.stockLevel ?? 0) <= (i.lowStockThreshold ?? i.minStock ?? 5)).length;
                if (lowStockCount > 0) alerts125.push({ level: 'warn', icon: '📦', message: currentLanguage === 'tr' ? `${lowStockCount} ürün kritik stok seviyesinde` : `${lowStockCount} products at critical stock level` });
                // Overdue payments
                const now125 = Date.now();
                const overdueCount = orders.filter(o => !o.paid && o.status !== 'Cancelled' && odemeTakipli(o) && o.createdAt && (() => {
                  const ts = o.createdAt;
                  if (!ts) return false;
                  const d = typeof (ts as { toDate?: () => Date }).toDate === 'function' ? (ts as { toDate: () => Date }).toDate() : new Date(ts as string);
                  return (now125 - d.getTime()) > 30 * 86400000;
                })()).length;
                if (overdueCount > 0) alerts125.push({ level: 'danger', icon: '💳', message: currentLanguage === 'tr' ? `${overdueCount} siparişin ödemesi 30+ gün gecikmiş` : `${overdueCount} orders have payment overdue 30+ days` });
                // Pending price overrides
                const pendingOverrides = priceOverrides.filter(p => p.status === 'pending').length;
                if (pendingOverrides > 0) alerts125.push({ level: 'warn', icon: '🏷️', message: currentLanguage === 'tr' ? `${pendingOverrides} fiyat onay talebi bekliyor` : `${pendingOverrides} price override requests pending` });
                // Pending leave requests
                const pendingLeaves = leaveRequests.filter(l => l.status === 'pending').length;
                if (pendingLeaves > 0) alerts125.push({ level: 'warn', icon: '📅', message: currentLanguage === 'tr' ? `${pendingLeaves} izin talebi onay bekliyor` : `${pendingLeaves} leave requests awaiting approval` });
                if (alerts125.length === 0) return null;
                return (
                  <div className="space-y-2">
                    {alerts125.map((a, i) => (
                      <div key={i} className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold border ${a.level === 'danger' ? 'bg-red-50 border-red-100 text-red-700' : 'bg-amber-50 border-amber-100 text-amber-700'}`}>
                        <span>{a.icon}</span>
                        <span className="flex-1">{a.message}</span>
                        {/* Phase 538: open overdue panel for payment alerts */}
                        {a.icon === '💳' && (
                          <button
                            onClick={() => setShowOverduePanel(true)}
                            className="text-[10px] font-bold underline underline-offset-2 opacity-80 hover:opacity-100 shrink-0"
                          >
                            {currentLanguage === 'tr' ? 'Tümünü Gör' : 'View All'}
                          </button>
                        )}
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${a.level === 'danger' ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800'}`}>
                          {a.level === 'danger' ? (currentLanguage === 'tr' ? 'Kritik' : 'Critical') : (currentLanguage === 'tr' ? 'Uyarı' : 'Warning')}
                        </span>
                      </div>
                    ))}
                  </div>
                );
              })()}

              {/* ── Phase 130: Daily Cash Position ── */}
              {orders.length > 0 && (() => {
                const today130 = new Date();
                const todayStr = today130.toDateString();
                const todayOrders = orders.filter(o => {
                  const raw = o.createdAt ?? o.syncedAt;
                  if (!raw) return false;
                  const d = typeof (raw as { toDate?: () => Date }).toDate === 'function' ? (raw as { toDate: () => Date }).toDate() : new Date(raw as string | number);
                  return d.toDateString() === todayStr && o.status !== 'Cancelled';
                });
                const todayRevenue = todayOrders.reduce((s, o) => s + (o.totalPrice || 0), 0);
                const todayPaid = todayOrders.filter(o => o.paid).reduce((s, o) => s + (o.totalPrice || 0), 0);
                const totalUnpaid = orders.filter(o => !o.paid && o.status !== 'Cancelled' && odemeTakipli(o)).reduce((s, o) => s + (o.totalPrice || 0), 0);
                return (
                  <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-5">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <span className="text-base">💵</span>
                        <div>
                          <h3 className="text-sm font-bold text-gray-800">{currentLanguage === 'tr' ? 'Günlük Nakit Pozisyonu' : 'Daily Cash Position'}</h3>
                          <p className="text-[10px] text-gray-400">{today130.toLocaleDateString(currentLanguage === 'tr' ? 'tr-TR' : 'en-US', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-2xl font-black text-emerald-600">{fmtKpi(todayPaid)}</p>
                        <p className="text-[10px] text-gray-400">{currentLanguage === 'tr' ? 'bugün tahsil' : 'collected today'}</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      {[
                        { label: currentLanguage === 'tr' ? 'Bugün Ciro' : "Today's Revenue", val: todayRevenue, color: 'text-gray-800' },
                        { label: currentLanguage === 'tr' ? 'Bugün Tahsil' : 'Collected Today', val: todayPaid, color: 'text-emerald-600' },
                        { label: currentLanguage === 'tr' ? 'Toplam Alacak' : 'Total Receivable', val: totalUnpaid, color: 'text-amber-600' },
                      ].map(c => (
                        <div key={c.label} className="text-center bg-gray-50 rounded-xl p-3">
                          <p className={`text-base font-bold ${c.color}`}>{fmtKpi(c.val)}</p>
                          <p className="text-[9px] text-gray-400 leading-tight mt-0.5">{c.label}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* ── Phase 159: Sales Velocity (Revenue per Working Day) ── */}
              {orders.length > 0 && (() => {
                const now159 = new Date();
                // Last 30 days revenue vs prior 30 days
                const d30ago = new Date(now159); d30ago.setDate(d30ago.getDate() - 30);
                const d60ago = new Date(now159); d60ago.setDate(d60ago.getDate() - 60);
                const getOD159 = (o: Order): Date => {
                  const raw = o.createdAt ?? o.syncedAt;
                  if (!raw) return new Date(0);
                  return typeof (raw as { toDate?: () => Date }).toDate === 'function'
                    ? (raw as { toDate: () => Date }).toDate()
                    : new Date(raw as string | number);
                };
                const last30 = orders.filter(o => { const d = getOD159(o); return d >= d30ago && o.status !== 'Cancelled'; });
                const prev30 = orders.filter(o => { const d = getOD159(o); return d >= d60ago && d < d30ago && o.status !== 'Cancelled'; });
                const rev30 = last30.reduce((s, o) => s + (o.totalPrice || 0), 0);
                const revPrev = prev30.reduce((s, o) => s + (o.totalPrice || 0), 0);
                const dailyRev = rev30 / 30;
                const dailyPrev = revPrev / 30;
                const velocityChange = dailyPrev > 0 ? Math.round(((dailyRev - dailyPrev) / dailyPrev) * 100) : null;
                // Weekly sparkline (last 8 weeks)
                const weeks: number[] = Array(8).fill(0);
                for (const o of orders) {
                  if (o.status === 'Cancelled') continue;
                  const d = getOD159(o);
                  const daysAgo = Math.floor((now159.getTime() - d.getTime()) / 86400000);
                  const weekIdx = 7 - Math.floor(daysAgo / 7);
                  if (weekIdx >= 0 && weekIdx < 8) weeks[weekIdx] += o.totalPrice || 0;
                }
                const maxWeek = Math.max(...weeks, 1);
                const s159 = kpiCurrency === 'TRY' ? '₺' : kpiCurrency === 'USD' ? '$' : '€';
                // fmtKpi DEGIL: bu kart tutari her zaman CALISMA ZAMANI yereliyle
                // basiyordu (`toLocaleString(undefined, ...)`). TRY ciktisi birebir
                // ayni kalsin diye o davranis korundu; degisen tek sey, kur yoksa
                // artik uydurma bir kurla bolmek yerine '—' donmesi.
                const f159 = (v: number) => {
                  const cv = kurCevir(v, kpiCurrency, exchangeRates);
                  return cv === null ? '—' : `${s159}${cv.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
                };
                return (
                  <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-5">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <h3 className="text-sm font-bold text-gray-800">{currentLanguage === 'tr' ? '⚡ Satış Hızı' : '⚡ Sales Velocity'}</h3>
                        <p className="text-[10px] text-gray-400">{currentLanguage === 'tr' ? 'Günlük ortalama ciro (son 30 gün)' : 'Avg. daily revenue (last 30 days)'}</p>
                      </div>
                      {velocityChange !== null && (
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${velocityChange >= 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                          {velocityChange >= 0 ? '↑' : '↓'}{Math.abs(velocityChange)}% vs {currentLanguage==='tr'?'önceki 30g':'prev 30d'}
                        </span>
                      )}
                    </div>
                    <p className="text-3xl font-black text-brand mb-3">{f159(dailyRev)}<span className="text-sm font-normal text-gray-400">/{currentLanguage==='tr'?'gün':'day'}</span></p>
                    <div className="flex items-end gap-0.5 h-10">
                      {weeks.map((w, i) => (
                        <div key={i} className="flex-1 flex flex-col justify-end">
                          <div className={`w-full rounded-sm transition-all ${i === 7 ? 'bg-brand' : 'bg-brand/25'}`}
                            style={{ height: `${Math.max(Math.round((w / maxWeek) * 100), 4)}%` }} />
                        </div>
                      ))}
                    </div>
                    <p className="text-[9px] text-gray-400 mt-1 text-right">{currentLanguage==='tr'?'Son 8 hafta':'Last 8 weeks'}</p>
                  </div>
                );
              })()}

              {/* ── Phase 539: Shipments Mini-Widget ── */}
              {shipments.length > 0 && (() => {
                const todayStr539 = new Date().toDateString();
                const inTransit  = shipments.filter(s => s.status === 'In Transit').length;
                const pending539 = shipments.filter(s => s.status === 'Pending').length;
                const delivToday = shipments.filter(s => {
                  if (s.status !== 'Delivered') return false;
                  const raw = (s as unknown as Record<string, unknown>).updatedAt ?? (s as unknown as Record<string, unknown>).date;
                  if (!raw) return false;
                  const d = typeof (raw as { toDate?: () => Date }).toDate === 'function'
                    ? (raw as { toDate: () => Date }).toDate()
                    : new Date(raw as string);
                  return d.toDateString() === todayStr539;
                }).length;
                const recent539 = [...shipments]
                  .sort((a, b) => {
                    const getT = (s: Shipment) => {
                      const raw = (s as unknown as Record<string, unknown>).createdAt;
                      if (!raw) return 0;
                      return typeof (raw as { toDate?: () => Date }).toDate === 'function'
                        ? (raw as { toDate: () => Date }).toDate().getTime()
                        : new Date(raw as string).getTime();
                    };
                    return getT(b) - getT(a);
                  })
                  .slice(0, 5);
                const statusColor539 = (st: string) =>
                  st === 'Delivered' ? 'text-emerald-600 bg-emerald-50' :
                  st === 'In Transit' || st === 'Shipped' ? 'text-blue-600 bg-blue-50' :
                  st === 'Pending' ? 'text-amber-600 bg-amber-50' : 'text-gray-500 bg-gray-50';
                return (
                  <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-5">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <span className="text-base">🚚</span>
                        <div>
                          <h3 className="text-sm font-bold text-gray-800">{currentLanguage === 'tr' ? 'Sevkiyat Durumu' : 'Shipments Overview'}</h3>
                          <p className="text-[10px] text-gray-400">{shipments.length} {currentLanguage === 'tr' ? 'toplam sevkiyat' : 'total shipments'}</p>
                        </div>
                      </div>
                      <button
                        onClick={() => setShipmentsExpanded(e => !e)}
                        className="text-[10px] font-bold text-gray-400 hover:text-brand transition-colors flex items-center gap-1"
                      >
                        {shipmentsExpanded ? (currentLanguage === 'tr' ? 'Gizle' : 'Hide') : (currentLanguage === 'tr' ? 'Detaylar' : 'Details')}
                        <ChevronDown className={cn("w-3 h-3 transition-transform", shipmentsExpanded && "rotate-180")} />
                      </button>
                    </div>
                    <div className="grid grid-cols-3 gap-3 mb-3">
                      {[
                        { label: currentLanguage === 'tr' ? 'Yolda'     : 'In Transit',   value: inTransit,  color: 'text-blue-600',    bg: 'bg-blue-50' },
                        { label: currentLanguage === 'tr' ? 'Bekliyor'  : 'Pending',       value: pending539, color: 'text-amber-600',   bg: 'bg-amber-50' },
                        { label: currentLanguage === 'tr' ? 'Bugün Teslim' : 'Del. Today', value: delivToday, color: 'text-emerald-600', bg: 'bg-emerald-50' },
                      ].map(c => (
                        <div key={c.label} className={`text-center rounded-xl p-3 ${c.bg}`}>
                          <p className={`text-xl font-black ${c.color}`}>{c.value}</p>
                          <p className="text-[9px] text-gray-500 leading-tight mt-0.5">{c.label}</p>
                        </div>
                      ))}
                    </div>
                    {/* Phase 539: Expandable recent shipments list */}
                    {shipmentsExpanded && (
                      <div className="border-t border-gray-100 pt-3 space-y-2">
                        {recent539.map(s => (
                          <div key={s.id} className="flex items-center gap-3 text-xs">
                            <span className={cn("px-2 py-0.5 rounded-full text-[9px] font-bold shrink-0", statusColor539(s.status))}>
                              {s.status}
                            </span>
                            <span className="font-medium text-gray-800 flex-1 truncate">{s.customerName}</span>
                            <span className="text-gray-400 truncate max-w-[120px]">{(s as unknown as Record<string, string>).destination || '—'}</span>
                            <span className="text-gray-400 shrink-0">{(s as unknown as Record<string, string>).cargoFirm || '—'}</span>
                          </div>
                        ))}
                        <button
                          onClick={() => setActiveTab('lojistik')}
                          className="text-[10px] text-brand font-bold flex items-center gap-1 mt-1"
                        >
                          <ChevronRight className="w-3 h-3" />
                          {currentLanguage === 'tr' ? 'Tüm Sevkiyatlar' : 'All Shipments'}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* ── New ERP Module Quick-Status Strip ── */}
              {(() => {
                return (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {/* E-Belge status */}
                    <button onClick={() => setActiveTab('ebelge')} className="apple-card p-4 text-left hover:shadow-md hover:scale-[1.01] transition-all group flex flex-col min-h-[120px]">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="w-7 h-7 rounded-lg bg-indigo-50 flex items-center justify-center flex-shrink-0">
                          <FileText className="w-3.5 h-3.5 text-indigo-600" />
                        </div>
                        <span className="text-xs font-bold text-gray-500 uppercase truncate">{currentLanguage === 'tr' ? 'E-Belge' : 'E-Doc'}</span>
                      </div>
                      <p className="text-xl font-bold text-gray-900 mt-auto">
                        {gibConnected
                          ? (currentLanguage === 'tr' ? 'GIB Bağlı' : 'GIB Connected')
                          : (currentLanguage === 'tr' ? 'GIB Bağlı Değil' : 'GIB Not Connected')}
                      </p>
                      <p className="text-[10px] text-gray-400 mt-0.5 truncate">{currentLanguage === 'tr' ? 'E-Fatura · E-Arşiv · E-İrsaliye' : 'E-Invoice · E-Archive · E-Waybill'}</p>
                      <div className="flex items-center gap-1 mt-1.5">
                        <span className={`w-1.5 h-1.5 rounded-full ${gibConnected ? 'bg-green-500 animate-pulse' : 'bg-red-400'}`} />
                        <span className={`text-[10px] font-semibold ${gibConnected ? 'text-green-600' : 'text-red-500'}`}>
                          {gibConnected ? (currentLanguage === 'tr' ? 'Aktif' : 'Active') : (currentLanguage === 'tr' ? 'Bağlı Değil' : 'Disconnected')}
                        </span>
                      </div>
                    </button>

                    {/* Kasa balance */}
                    <button onClick={() => setActiveTab('muhasebe')} className="apple-card p-4 text-left hover:shadow-md hover:scale-[1.01] transition-all group flex flex-col min-h-[120px]">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="w-7 h-7 rounded-lg bg-emerald-50 flex items-center justify-center flex-shrink-0">
                          <Wallet className="w-3.5 h-3.5 text-emerald-600" />
                        </div>
                        <span className="text-xs font-bold text-gray-500 uppercase truncate">{currentLanguage === 'tr' ? 'Kasa' : 'Cash'}</span>
                      </div>
                      <p className="text-xl font-bold text-gray-900 mt-auto">
                        {currentLanguage === 'tr' ? 'Kasa Yönetimi' : 'Cash Desk'}
                      </p>
                      <p className="text-[10px] text-gray-400 mt-0.5 truncate">{currentLanguage === 'tr' ? 'Günlük kapanış ve hareketler' : 'Daily close and transactions'}</p>
                      <p className="text-[10px] text-brand mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5">
                        <ChevronRight className="w-3 h-3" />{currentLanguage === 'tr' ? 'Kasaya git' : 'Go to cash desk'}
                      </p>
                    </button>

                    {/* Vergi Takvimi — overdue count */}
                    <button onClick={() => setActiveTab('vergi')} className="apple-card p-4 text-left hover:shadow-md hover:scale-[1.01] transition-all group flex flex-col min-h-[120px]">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="w-7 h-7 rounded-lg bg-amber-50 flex items-center justify-center flex-shrink-0">
                          <Receipt className="w-3.5 h-3.5 text-amber-600" />
                        </div>
                        <span className="text-xs font-bold text-gray-500 uppercase truncate">{currentLanguage === 'tr' ? 'Vergi Takvimi' : 'Tax Calendar'}</span>
                      </div>
                      <p className="text-xl font-bold text-gray-900 mt-auto">
                        {currentLanguage === 'tr' ? 'Beyanname Takibi' : 'Declaration Tracking'}
                      </p>
                      <p className="text-[10px] text-gray-400 mt-0.5 truncate">{currentLanguage === 'tr' ? 'KDV · Muhtasar · SGK · Geçici Vergi' : 'VAT · WHT · SGK · Provisional Tax'}</p>
                      <p className="text-[10px] text-brand mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5">
                        <ChevronRight className="w-3 h-3" />{currentLanguage === 'tr' ? 'Takvimi gör' : 'View calendar'}
                      </p>
                    </button>

                    {/* Bakım — upcoming */}
                    <button onClick={() => setActiveTab('bakim')} className="apple-card p-4 text-left hover:shadow-md hover:scale-[1.01] transition-all group flex flex-col min-h-[120px]">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="w-7 h-7 rounded-lg bg-orange-50 flex items-center justify-center flex-shrink-0">
                          <Wrench className="w-3.5 h-3.5 text-orange-600" />
                        </div>
                        <span className="text-xs font-bold text-gray-500 uppercase truncate">{currentLanguage === 'tr' ? 'Bakım' : 'Maintenance'}</span>
                      </div>
                      <p className="text-xl font-bold text-gray-900 mt-auto">
                        {currentLanguage === 'tr' ? 'Ekipman Bakımı' : 'Equipment Maint.'}
                      </p>
                      <p className="text-[10px] text-gray-400 mt-0.5 truncate">{currentLanguage === 'tr' ? 'Önleyici · Düzeltici · Acil iş emirleri' : 'Preventive · Corrective · Emergency orders'}</p>
                      <p className="text-[10px] text-brand mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5">
                        <ChevronRight className="w-3 h-3" />{currentLanguage === 'tr' ? 'İş emirlerine git' : 'View work orders'}
                      </p>
                    </button>
                  </div>
                );
              })()}

              {/* ── Phase 160: Customer Payment Behavior ── */}
              {orders.filter(o => o.paid).length >= 3 && (() => {
                // For paid orders, estimate days to payment (createdAt → updatedAt/paidAt if available, else skip)
                const custPay: Record<string, { name: string; totalPaid: number; totalOrders: number; lateCount: number }> = {};
                for (const o of orders) {
                  if (!o.paid || o.status === 'Cancelled') continue;
                  const name = o.customerName || '—';
                  if (!custPay[name]) custPay[name] = { name, totalPaid: 0, totalOrders: 0, lateCount: 0 };
                  custPay[name].totalPaid += o.totalPrice || 0;
                  custPay[name].totalOrders++;
                  // Simplified late check: if order was old when marked paid (no paidAt field, just heuristic)
                }
                // Also track unpaid customers
                const custUnpaid: Record<string, number> = {};
                for (const o of orders) {
                  if (o.paid || o.status === 'Cancelled' || !odemeTakipli(o)) continue;
                  const name = o.customerName || '—';
                  custUnpaid[name] = (custUnpaid[name] ?? 0) + (o.totalPrice || 0);
                }
                const topPayers = Object.values(custPay).sort((a, b) => b.totalPaid - a.totalPaid).slice(0, 5);
                const topDebtors = Object.entries(custUnpaid).sort(([,a],[,b]) => b - a).slice(0, 5);
                const s160 = kpiCurrency === 'TRY' ? '₺' : kpiCurrency === 'USD' ? '$' : '€';
                // fmtKpi DEGIL — f159 ile ayni gerekce: calisma zamani yereli korunuyor.
                const f160 = (v: number) => {
                  const cv = kurCevir(v, kpiCurrency, exchangeRates);
                  return cv === null ? '—' : `${s160}${cv.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
                };
                return (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-4">
                      <h4 className="text-xs font-bold text-emerald-700 uppercase tracking-wide mb-3">✓ {currentLanguage==='tr'?'En Çok Ödeme Yapanlar':'Top Payers'}</h4>
                      <div className="space-y-2">
                        {topPayers.map((c, i) => (
                          <div key={i} className="flex items-center justify-between">
                            <span className="text-xs text-gray-700 truncate">{c.name}</span>
                            <span className="text-xs font-bold text-emerald-600 shrink-0 ml-2">{f160(c.totalPaid)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="bg-white border border-amber-100 rounded-2xl shadow-sm p-4">
                      <h4 className="text-xs font-bold text-amber-700 uppercase tracking-wide mb-3">⚠ {currentLanguage==='tr'?'Ödenmemiş Alacak':'Outstanding Receivables'}</h4>
                      <div className="space-y-2">
                        {topDebtors.length === 0 ? (
                          <p className="text-xs text-gray-400 text-center py-2">{currentLanguage==='tr'?'Bekleyen alacak yok':'No outstanding receivables'}</p>
                        ) : topDebtors.map(([name, amt], i) => (
                          <div key={i} className="flex items-center justify-between">
                            <span className="text-xs text-gray-700 truncate">{name}</span>
                            <span className="text-xs font-bold text-amber-600 shrink-0 ml-2">{f160(amt)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* ── Phase 103: 6-Month Revenue Bar Chart ── */}
              {orders.length > 0 && (() => {
                const now103 = new Date();
                const months103 = Array.from({ length: 6 }, (_, i) => {
                  const d = new Date(now103.getFullYear(), now103.getMonth() - (5 - i), 1);
                  return { year: d.getFullYear(), month: d.getMonth(), label: d.toLocaleString(currentLanguage === 'tr' ? 'tr-TR' : 'en-US', { month: 'short' }) };
                });
                const getOD103 = (o: Order): Date => {
                  const raw = o.createdAt ?? o.syncedAt;
                  if (!raw) return new Date(0);
                  return typeof (raw as { toDate?: () => Date }).toDate === 'function' ? (raw as { toDate: () => Date }).toDate() : new Date(raw as string | number);
                };
                const data103 = months103.map(m => ({
                  label: m.label,
                  rev: orders.filter(o => { const d = getOD103(o); return d.getFullYear() === m.year && d.getMonth() === m.month && o.status !== 'Cancelled'; }).reduce((s, o) => s + (o.totalPrice || 0), 0),
                }));
                const maxRev103 = Math.max(...data103.map(d => d.rev), 1);
                return (
                  <div className={cn("rounded-2xl border p-5", darkMode ? "bg-white/5 border-white/10" : "bg-white border-gray-100 shadow-sm")}>
                    <div className="flex items-center justify-between mb-4">
                      <h3 className={cn("text-[10px] font-bold uppercase tracking-wider flex items-center gap-2", darkMode ? "text-white/50" : "text-gray-400")}>
                        <BarChart3 className="w-3.5 h-3.5" />
                        {currentLanguage === 'tr' ? 'Son 6 Ay Ciro' : 'Last 6 Months Revenue'}
                      </h3>
                    </div>
                    <div className="flex items-end gap-2 h-28">
                      {data103.map((m, i) => {
                        const h = maxRev103 > 0 ? Math.max((m.rev / maxRev103) * 100, m.rev > 0 ? 4 : 0) : 0;
                        const isCurrentMonth = i === 5;
                        return (
                          <div key={i} className="flex-1 flex flex-col items-center justify-end gap-1">
                            <div
                              title={fmtKpi(m.rev)}
                              className={`w-full rounded-t-lg transition-all duration-700 ${isCurrentMonth ? 'bg-brand' : darkMode ? 'bg-white/20 hover:bg-white/30' : 'bg-gray-200 hover:bg-gray-300'}`}
                              style={{ height: `${h}%`, minHeight: m.rev > 0 ? '4px' : '0' }}
                            />
                            <span className={cn("text-[9px] font-bold", isCurrentMonth ? 'text-brand' : darkMode ? 'text-white/65' : 'text-gray-400')}>{m.label}</span>
                          </div>
                        );
                      })}
                    </div>
                    <div className="flex justify-between mt-2 text-[9px] text-gray-400">
                      <span>0</span>
                      <span>{fmtKpi(maxRev103)}</span>
                    </div>
                  </div>
                );
              })()}

              {/* ── Phase 43: Order Status Segmented Bar ── */}
              {orders.length > 0 && (() => {
                const statusConfig = [
                  { key: 'Pending',    labelTR: 'Bekliyor',   labelEN: 'Pending',    color: 'bg-amber-400',  textColor: 'text-amber-700',  bg: 'bg-amber-50'  },
                  { key: 'Processing', labelTR: 'Hazırlanıyor', labelEN: 'Processing', color: 'bg-purple-400', textColor: 'text-purple-700', bg: 'bg-purple-50' },
                  { key: 'Shipped',    labelTR: 'Kargoda',    labelEN: 'Shipped',    color: 'bg-blue-400',   textColor: 'text-blue-700',   bg: 'bg-blue-50'   },
                  { key: 'Delivered',  labelTR: 'Teslim',     labelEN: 'Delivered',  color: 'bg-emerald-400',textColor: 'text-emerald-700', bg: 'bg-emerald-50'},
                  { key: 'Cancelled',  labelTR: 'İptal',      labelEN: 'Cancelled',  color: 'bg-gray-300',   textColor: 'text-gray-500',   bg: 'bg-gray-50'   },
                ];
                const total = orders.length;
                const counts = statusConfig.map(s => ({ ...s, count: orders.filter(o => o.status === s.key).length }));
                return (
                  <div className={cn("rounded-2xl border p-5 space-y-3", darkMode ? "bg-white/5 border-white/10" : "bg-white border-gray-100 shadow-sm")}>
                    <div className="flex items-center justify-between">
                      <h3 className={cn("text-[10px] font-bold uppercase tracking-wider", darkMode ? "text-white/50" : "text-gray-400")}>
                        {currentLanguage === 'tr' ? 'Sipariş Durumu' : 'Order Status'}
                      </h3>
                      <button onClick={() => setActiveTab('orders')} className="text-[10px] font-semibold text-brand hover:underline">
                        {currentLanguage === 'tr' ? 'Tümünü gör' : 'View all'}
                      </button>
                    </div>
                    {/* Segmented bar */}
                    <div className="flex h-3 rounded-full overflow-hidden gap-0.5">
                      {counts.filter(s => s.count > 0).map(s => (
                        <div
                          key={s.key}
                          className={`${s.color} transition-all duration-700 first:rounded-l-full last:rounded-r-full`}
                          style={{ width: `${(s.count / total) * 100}%` }}
                          title={`${s.key}: ${s.count}`}
                        />
                      ))}
                    </div>
                    {/* Legend */}
                    <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                      {counts.filter(s => s.count > 0).map(s => (
                        <button key={s.key} onClick={() => setActiveTab('orders')} className="flex items-center gap-1.5 group">
                          <span className={`w-2 h-2 rounded-full ${s.color} flex-shrink-0`} />
                          <span className={cn("text-[11px]", darkMode ? "text-white/60" : "text-gray-500")}>
                            {currentLanguage === 'tr' ? s.labelTR : s.labelEN}
                          </span>
                          <span className={cn("text-[11px] font-bold", darkMode ? "text-white/80" : "text-gray-800")}>{s.count}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* ── Phase 79: B2B vs Retail Revenue Split ── */}
              {filteredOrders.length > 0 && (() => {
                // TARİH ARALIĞINA BAĞLANDI (2026-09-04): ham `orders` okunuyordu, yani
                // kart TÜM ZAMANLARIN oranını gösteriyordu — kullanıcı üstteki tarih
                // aralığını daraltsa bile pastanın dilimleri hiç değişmiyordu.
                const b2bRev    = filteredOrders.filter(o => o.customerType === 'B2B').reduce((s, o) => s + (o.totalPrice || 0), 0);
                const retailRev = filteredOrders.filter(o => o.customerType !== 'B2B').reduce((s, o) => s + (o.totalPrice || 0), 0);
                const totalRev  = b2bRev + retailRev;
                if (totalRev === 0) return null;
                const b2bPct    = Math.round((b2bRev    / totalRev) * 100);
                const retailPct = 100 - b2bPct;
                return (
                  <div className={cn("rounded-2xl border p-5", darkMode ? "bg-white/5 border-white/10" : "bg-white border-gray-100 shadow-sm")}>
                    <div className="flex items-center justify-between mb-3">
                      <h3 className={cn("text-[10px] font-bold uppercase tracking-wider", darkMode ? "text-white/50" : "text-gray-400")}>
                        {currentLanguage === 'tr' ? 'B2B vs Perakende Ciro' : 'B2B vs Retail Revenue'}
                      </h3>
                    </div>
                    {/* Split bar */}
                    <div className="flex h-3 rounded-full overflow-hidden gap-0.5 mb-3">
                      {b2bPct > 0 && (
                        <div className="bg-blue-500 transition-all duration-700 rounded-l-full" style={{ width: `${b2bPct}%` }} title={`B2B: ${b2bPct}%`} />
                      )}
                      {retailPct > 0 && (
                        <div className="bg-gray-300 transition-all duration-700 rounded-r-full" style={{ width: `${retailPct}%` }} title={`Retail: ${retailPct}%`} />
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-sm bg-blue-500 flex-shrink-0" />
                        <div>
                          <p className="text-xs font-bold text-blue-700">B2B — {b2bPct}%</p>
                          <p className="text-[10px] text-gray-400">{fmtKpi(b2bRev)}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-sm bg-gray-300 flex-shrink-0" />
                        <div>
                          <p className="text-xs font-bold text-gray-600">{currentLanguage === 'tr' ? 'Perakende' : 'Retail'} — {retailPct}%</p>
                          <p className="text-[10px] text-gray-400">{fmtKpi(retailRev)}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* ── Phase 106: Revenue Donut by Customer Type ── */}
              {orders.length > 0 && (() => {
                type Seg = { label: string; color: string; rev: number };
                const ct106 = (o: Order) => (o.customerType as unknown as string) || '';
                const segs: Seg[] = [
                  { label: 'B2B',                                             color: '#3b82f6', rev: orders.filter(o => ct106(o) === 'B2B').reduce((s, o) => s + (o.totalPrice || 0), 0) },
                  { label: currentLanguage === 'tr' ? 'Bayi' : 'Dealer',      color: '#ff4000', rev: orders.filter(o => ct106(o) === 'Dealer').reduce((s, o) => s + (o.totalPrice || 0), 0) },
                  { label: currentLanguage === 'tr' ? 'Perakende' : 'Retail', color: '#6b7280', rev: orders.filter(o => { const c = ct106(o); return !c || (c !== 'B2B' && c !== 'Dealer'); }).reduce((s, o) => s + (o.totalPrice || 0), 0) },
                ];
                const total106 = segs.reduce((s, seg) => s + seg.rev, 0);
                if (total106 === 0) return null;

                // SVG donut: r=40, circumference=251.3
                const R = 40, C = 2 * Math.PI * R;
                let offset = 0;
                const paths = segs.filter(s => s.rev > 0).map(s => {
                  const pct = s.rev / total106;
                  const dash = pct * C;
                  const gap  = C - dash;
                  const el = { ...s, pct, dash, gap, offset };
                  offset += dash;
                  return el;
                });
                const bigSeg = [...segs].sort((a, b) => b.rev - a.rev)[0];

                return (
                  <div className={cn("rounded-2xl border p-5", darkMode ? "bg-white/5 border-white/10" : "bg-white border-gray-100 shadow-sm")}>
                    <h3 className={cn("text-[10px] font-bold uppercase tracking-wider mb-4", darkMode ? "text-white/50" : "text-gray-400")}>
                      {currentLanguage === 'tr' ? 'Müşteri Tipi Bazında Ciro' : 'Revenue by Customer Type'}
                    </h3>
                    <div className="flex items-center gap-6">
                      {/* Donut */}
                      <div className="relative flex-shrink-0">
                        <svg width="96" height="96" viewBox="0 0 96 96">
                          <circle cx="48" cy="48" r={R} fill="none" stroke="#f3f4f6" strokeWidth="14" />
                          {paths.map((p, i) => (
                            <circle
                              key={i}
                              cx="48" cy="48" r={R}
                              fill="none"
                              stroke={p.color}
                              strokeWidth="14"
                              strokeDasharray={`${p.dash} ${p.gap}`}
                              strokeDashoffset={-p.offset + C * 0.25}
                              className="transition-all duration-700"
                            />
                          ))}
                        </svg>
                        {/* Center label */}
                        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                          <span className="text-[9px] font-bold text-gray-400 leading-none">
                            {bigSeg.label}
                          </span>
                          <span className="text-sm font-black text-gray-900 leading-none mt-0.5">
                            {Math.round((bigSeg.rev / total106) * 100)}%
                          </span>
                        </div>
                      </div>
                      {/* Legend */}
                      <div className="flex-1 space-y-3">
                        {segs.filter(s => s.rev > 0).map((s, i) => {
                          const pct = Math.round((s.rev / total106) * 100);
                          return (
                            <div key={i} className="space-y-1">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-1.5">
                                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: s.color }} />
                                  <span className="text-xs font-semibold text-gray-700">{s.label}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="text-[10px] text-gray-400">{fmtKpi(s.rev)}</span>
                                  <span className="text-[10px] font-black text-gray-600 w-7 text-right">{pct}%</span>
                                </div>
                              </div>
                              <div className="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
                                <div className="h-1.5 rounded-full transition-all duration-700" style={{ width: `${pct}%`, backgroundColor: s.color }} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* ── Phase 124: Customer Segment Profitability ── */}
              {orders.length > 0 && inventory.length > 0 && (() => {
                // Build per-customer-type revenue vs estimated COGS
                type SegProfit = { type: string; revenue: number; cogs: number; margin: number; orderCount: number; avgOrder: number };
                const segMap: Record<string, SegProfit> = {};
                for (const o of orders) {
                  if (o.status === 'Cancelled') continue;
                  const type = o.customerType || 'Retail';
                  if (!segMap[type]) segMap[type] = { type, revenue: 0, cogs: 0, margin: 0, orderCount: 0, avgOrder: 0 };
                  segMap[type].revenue += o.totalPrice || 0;
                  segMap[type].orderCount++;
                  // Estimate COGS from lineItems
                  const cogsCost = (o.lineItems || []).reduce((s, li) => {
                    const inv = inventory.find(i => i.id === li.inventoryId || i.name === li.name);
                    return s + (inv ? itemCostTRY(inv, exchangeRates) : li.price * 0.6) * li.quantity;
                  }, 0);
                  segMap[type].cogs += cogsCost;
                }
                const segs = Object.values(segMap).map(s => ({
                  ...s,
                  margin: s.revenue > 0 ? Math.round(((s.revenue - s.cogs) / s.revenue) * 100) : 0,
                  avgOrder: s.orderCount > 0 ? s.revenue / s.orderCount : 0,
                })).sort((a, b) => b.revenue - a.revenue);
                if (segs.length === 0) return null;
                const colors = { 'B2B': '#3b82f6', 'Retail': '#10b981', 'Dealer': '#f59e0b', 'Other': '#8b5cf6' };
                const maxRev = Math.max(...segs.map(s => s.revenue));
                return (
                  <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
                    <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
                      <span className="text-base">💰</span>
                      <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? 'Segment Kârlılığı' : 'Segment Profitability'}</h3>
                    </div>
                    <div className="divide-y divide-gray-50">
                      {segs.map(s => {
                        const barColor = (colors as Record<string, string>)[s.type] || '#6b7280';
                        return (
                          <div key={s.type} className="px-5 py-4">
                            <div className="flex items-center justify-between mb-1.5">
                              <div className="flex items-center gap-2">
                                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: barColor }} />
                                <p className="text-sm font-bold text-gray-800">{s.type}</p>
                                <span className="text-[10px] text-gray-400">{s.orderCount} {currentLanguage === 'tr' ? 'sipariş' : 'orders'}</span>
                              </div>
                              <div className="flex items-center gap-3 text-xs">
                                <span className="text-gray-500">{fmtKpi(s.revenue,'K',1)}</span>
                                <span className={`font-bold ${s.margin >= 30 ? 'text-emerald-600' : s.margin >= 15 ? 'text-amber-600' : 'text-red-500'}`}>
                                  %{s.margin} {currentLanguage === 'tr' ? 'marj' : 'margin'}
                                </span>
                              </div>
                            </div>
                            <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
                              <div className="h-2 rounded-full transition-all duration-700" style={{ width: `${(s.revenue / maxRev) * 100}%`, backgroundColor: barColor }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="px-5 py-2 bg-gray-50 border-t border-gray-100 text-[10px] text-gray-400">
                      {currentLanguage === 'tr' ? 'Maliyet tahmini: Ürün maliyeti × miktar' : 'COGS estimated from product cost × quantity'}
                    </div>
                  </div>
                );
              })()}

              {/* ⌘K search shortcut banner */}
              <button
                onClick={() => setGlobalSearchOpen(true)}
                className={cn(
                  "w-full flex items-center gap-3 px-4 py-3 rounded-2xl border text-left transition-all hover:shadow-sm group",
                  darkMode ? "bg-white/5 border-white/10 hover:bg-white/8" : "bg-gray-50 border-gray-100 hover:bg-gray-100/80"
                )}
              >
                <Search className="w-4 h-4 text-gray-400" />
                <span className={cn("flex-1 text-sm", darkMode ? "text-white/65" : "text-gray-400")}>
                  {currentLanguage === 'tr' ? 'Sipariş, müşteri veya ürün ara…' : 'Search orders, leads or products…'}
                </span>
                <kbd className="hidden sm:inline text-[10px] text-gray-400 bg-white border border-gray-200 px-1.5 py-0.5 rounded font-mono shadow-sm">⌘K</kbd>
              </button>

              {/* Quick Actions */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-4">{dashT.quick_access}</h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    { label: currentLanguage === 'tr' ? 'Kalite Yönetimi' : 'Quality', tab: 'kalite', icon: Activity, color: '#ff4000' },
                    { label: currentLanguage === 'tr' ? 'Hukuk & Uyum' : 'Legal', tab: 'hukuk', icon: ShieldCheck, color: '#3b82f6' },
                    { label: currentLanguage === 'tr' ? 'Proje Yönetimi' : 'Projects', tab: 'proje', icon: TargetIcon, color: '#8b5cf6' },
                    { label: currentLanguage === 'tr' ? 'Satın Alma' : 'Purchasing', tab: 'satin-alma', icon: ShoppingCart, color: '#10b981' },
                    { label: dashT.new_order, tab: 'orders', icon: Package, color: '#f59e0b' },
                    { label: currentLanguage === 'tr' ? 'Lojistik' : 'Logistics', tab: 'lojistik', icon: Truck, color: '#06b6d4' },
                    { label: currentLanguage === 'en' ? 'Accounting' : 'Muhasebe', tab: 'muhasebe', icon: BookOpen, color: '#ec4899' },
                    { label: dashT.reports, tab: 'reports', icon: BarChart3, color: '#ef4444' },
                  ].map((a, i) => (
                    <button key={i} onClick={() => setActiveTab(a.tab)}
                      className={cn("flex items-center gap-2 p-3 rounded-xl border transition-all text-left", darkMode ? "border-white/10 hover:border-white/20 hover:bg-white/5" : "border-gray-100 hover:border-gray-200 hover:bg-gray-50")}>
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: `${a.color}15` }}>
                        <a.icon className="w-4 h-4" style={{ color: a.color }} />
                      </div>
                      <span className={cn("text-xs font-semibold", darkMode ? "text-white/90" : "text-[#1D1D1F]")}>{a.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* ── Phase 24: Today's Agenda ── */}
              {(() => {
                const toShip = orders.filter(o => o.status === 'Processing');
                const staleLeads = leads.filter(l => {
                  if (l.status === 'Closed') return false;
                  const lastTouch = l.updatedAt
                    ? (typeof (l.updatedAt as { toDate?: () => Date }).toDate === 'function'
                        ? (l.updatedAt as { toDate: () => Date }).toDate()
                        : new Date(l.updatedAt as string | number))
                    : (l.createdAt
                        ? (typeof (l.createdAt as { toDate?: () => Date }).toDate === 'function'
                            ? (l.createdAt as { toDate: () => Date }).toDate()
                            : new Date(l.createdAt as string | number))
                        : null);
                  return lastTouch ? (Date.now() - lastTouch.getTime()) > 30 * 86400000 : false;
                });
                const lowStockItems = inventory.filter(i => (i.stockLevel ?? 0) <= (i.lowStockThreshold ?? 5));
                const agendaItems = [
                  ...toShip.slice(0, 3).map(o => ({
                    key: `ship-${o.id}`,
                    icon: Truck, color: 'text-blue-600' as const, bg: 'bg-blue-50' as const,
                    title: currentLanguage === 'tr' ? `Kargoya ver: ${o.customerName}` : `Ship: ${o.customerName}`,
                    sub: `${gorunenSiparisNo(o)} · ₺${(o.totalPrice || 0).toLocaleString('tr-TR', { maximumFractionDigits: 0 })}`,
                    onClick: () => { setActiveTab('orders'); },
                  })),
                  ...staleLeads.slice(0, 2).map(l => ({
                    key: `lead-${l.id}`,
                    icon: Users, color: 'text-amber-600' as const, bg: 'bg-amber-50' as const,
                    title: currentLanguage === 'tr' ? `Hareketsiz: ${l.name}` : `Stale: ${l.name}`,
                    sub: currentLanguage === 'tr' ? '30+ gündür iletişim yok' : '30+ days no contact',
                    onClick: () => setActiveTab('crm'),
                  })),
                  ...lowStockItems.slice(0, 2).map(i => ({
                    key: `stock-${i.id}`,
                    icon: AlertTriangle, color: 'text-red-600' as const, bg: 'bg-red-50' as const,
                    title: currentLanguage === 'tr' ? `Düşük stok: ${i.name}` : `Low stock: ${i.name}`,
                    sub: `${i.stockLevel ?? 0} / ${i.lowStockThreshold ?? 5} ${currentLanguage === 'tr' ? 'adet' : 'units'}`,
                    onClick: () => setActiveTab('inventory'),
                  })),
                ];
                if (agendaItems.length === 0) return null;
                return (
                  <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider flex items-center gap-2">
                        <Calendar className="w-4 h-4" />
                        {currentLanguage === 'tr' ? 'Bugünün Ajandası' : "Today's Agenda"}
                      </h3>
                      <span className="text-[10px] bg-amber-50 text-amber-600 font-bold px-2 py-0.5 rounded-full">
                        {agendaItems.length} {currentLanguage === 'tr' ? 'eylem' : 'actions'}
                      </span>
                    </div>
                    <div className="space-y-1">
                      {agendaItems.map(item => {
                        const Icon = item.icon;
                        return (
                          <button key={item.key} onClick={item.onClick}
                            className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-gray-50 text-left transition-colors group">
                            <div className={`w-8 h-8 rounded-lg ${item.bg} flex items-center justify-center flex-shrink-0`}>
                              <Icon className={`w-4 h-4 ${item.color}`} />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-semibold text-gray-800 truncate">{item.title}</p>
                              <p className="text-[10px] text-gray-400 truncate">{item.sub}</p>
                            </div>
                            <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-gray-500 flex-shrink-0 transition-colors" />
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              {/* ── Phase 27: Quick Note / Scratchpad ── */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider flex items-center gap-2">
                    <FileText className="w-4 h-4" />
                    {currentLanguage === 'tr' ? 'Hızlı Not' : 'Quick Note'}
                  </h3>
                  {quickNote && (
                    <span className="text-[9px] text-gray-400 font-medium">
                      {currentLanguage === 'tr' ? 'Otomatik kaydediliyor' : 'Auto-saving'}
                    </span>
                  )}
                </div>
                <textarea
                  value={quickNote}
                  onChange={e => handleQuickNoteChange(e.target.value)}
                  rows={4}
                  placeholder={currentLanguage === 'tr' ? 'Hızlı notlarınızı buraya yazın… (otomatik kaydedilir)' : 'Jot something down… (auto-saved locally)'}
                  className="w-full bg-gray-50 rounded-xl px-3 py-2.5 text-sm text-gray-700 placeholder-gray-300 outline-none focus:ring-2 focus:ring-brand/20 resize-none leading-relaxed"
                />
              </div>

              {/* Recent Orders + Low Stock side by side */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider">{dashT.recent_orders}</h3>
                    <button onClick={() => { setActiveTab('crm'); setCrmTab('siparisler'); }} className="text-xs text-brand font-semibold hover:underline">{dashT.see_all}</button>
                  </div>
                  <div className="space-y-2">
                    {filteredOrders.slice(0, 5).map(o => (
                      // TIKLANABILIR SATIR (2026-09-04 kullanici istegi): duz <div>
                      // idi, ne fare ne klavyeyle acilabiliyordu. <button> secildi:
                      // tabIndex/role/onKeyDown elle yazmaya gerek kalmaz, ekran
                      // okuyucu ve Enter/Space kendiliginden calisir.
                      <button key={o.id} type="button"
                        onClick={() => setActiveTab('orders')}
                        title={currentLanguage === 'tr' ? 'Siparişler ekranına git' : 'Go to orders'}
                        className="w-full text-left flex items-center justify-between py-2 border-b border-gray-50 last:border-0 hover:bg-gray-50/70 rounded-lg px-1 -mx-1 transition-colors cursor-pointer">
                        <div>
                          <p className="text-sm font-semibold text-[#1D1D1F]">{o.customerName || currentT.customer}</p>
                          <p className="text-xs text-gray-400">{gorunenSiparisNo(o)}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-bold text-[#1D1D1F]">{fmtKpi(o.totalPrice||o.totalAmount||0)}</p>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${o.status === 'Delivered' ? 'bg-green-100 text-green-700' : o.status === 'Cancelled' ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'}`}>{siparisDurumEtiketi(o.status, currentLanguage)}</span>
                        </div>
                      </button>
                    ))}
                    {filteredOrders.length === 0 && <p className="text-sm text-gray-400 text-center py-4">{dashT.no_orders}</p>}
                  </div>
                </div>

                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider">{dashT.low_stock_alert}</h3>
                    <button onClick={() => setActiveTab('inventory')} className="text-xs text-brand font-semibold hover:underline">{dashT.inventory_link}</button>
                  </div>
                  <div className="space-y-2">
                    {inventory.filter(i => i.stockLevel <= i.lowStockThreshold).slice(0, 5).map(item => (
                      <button key={item.id} type="button"
                        onClick={() => setActiveTab('inventory')}
                        title={currentLanguage === 'tr' ? 'Envanter ekranına git' : 'Go to inventory'}
                        className="w-full text-left flex items-center justify-between py-2 border-b border-gray-50 last:border-0 hover:bg-gray-50/70 rounded-lg px-1 -mx-1 transition-colors cursor-pointer">
                        <div>
                          <p className="text-sm font-semibold text-[#1D1D1F]">{item.name}</p>
                          <p className="text-xs text-gray-400">{item.sku}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-bold text-red-500">{item.stockLevel} {dashT.units}</p>
                          <p className="text-[10px] text-gray-400">Min: {item.lowStockThreshold}</p>
                        </div>
                      </button>
                    ))}
                    {inventory.filter(i => i.stockLevel <= i.lowStockThreshold).length === 0 && (
                      <p className="text-sm text-green-600 text-center py-4 flex items-center justify-center gap-2"><CheckCircle2 className="w-4 h-4" />{dashT.all_in_stock}</p>
                    )}
                  </div>
                </div>
              </div>

              {/* ── Phase 47: Inventory Value Summary ── */}
              {inventory.length > 0 && (() => {
                const costValue   = inventory.reduce((s, i) => s + itemCostTRY(i, exchangeRates) * (i.stockLevel ?? 0), 0);
                const retailValue = inventory.reduce((s, i) => s + (i.prices?.['Retail'] ?? i.price ?? 0) * (i.stockLevel ?? 0), 0);
                const margin      = retailValue > 0 ? Math.round(((retailValue - costValue) / retailValue) * 100) : 0;
                const totalUnits  = inventory.reduce((s, i) => s + (i.stockLevel ?? 0), 0);
                return (
                  <>
                  {/* costValue cevrilemeyen kalemleri DISLIYOR — eksikligi soyle. */}
                  <KurUyarisi inventory={inventory} exchangeRates={exchangeRates} currentLanguage={currentLanguage} className="mb-2" />
                  <div className={cn("rounded-2xl border p-5", darkMode ? "bg-white/5 border-white/10" : "bg-white border-gray-100 shadow-sm")}>
                    <div className="flex items-center justify-between mb-4">
                      <h3 className={cn("text-[10px] font-bold uppercase tracking-wider flex items-center gap-2", darkMode ? "text-white/50" : "text-gray-400")}>
                        <Package className="w-3.5 h-3.5" />
                        {currentLanguage === 'tr' ? 'Stok Değeri Özeti' : 'Inventory Value'}
                      </h3>
                      <button onClick={() => setActiveTab('inventory')} className="text-[10px] font-semibold text-brand hover:underline">
                        {currentLanguage === 'tr' ? 'Stoka git' : 'View inventory'}
                      </button>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      {(() => {
                        return [
                        { label: currentLanguage === 'tr' ? 'Maliyet Değeri' : 'Cost Value',   value: fmtKpi(costValue),   color: 'text-gray-800',    sub: currentLanguage === 'tr' ? 'stok maliyeti' : 'at cost' },
                        { label: currentLanguage === 'tr' ? 'Satış Değeri'  : 'Retail Value',  value: fmtKpi(retailValue),  color: 'text-emerald-700', sub: currentLanguage === 'tr' ? 'tavsiye fiyat' : 'at retail' },
                        { label: currentLanguage === 'tr' ? 'Brüt Marj'     : 'Gross Margin',  value: `${margin}%`,  color: margin >= 30 ? 'text-emerald-600' : margin >= 15 ? 'text-amber-600' : 'text-red-600', sub: currentLanguage === 'tr' ? 'teorik oran' : 'theoretical' },
                        { label: currentLanguage === 'tr' ? 'Toplam Adet'   : 'Total Units',   value: totalUnits.toLocaleString('tr-TR'), color: 'text-blue-700', sub: currentLanguage === 'tr' ? 'stokta' : 'in stock' },
                        ].map((stat, i) => (
                          <div key={i} className={cn("rounded-xl p-3 text-center", darkMode ? "bg-white/5" : "bg-gray-50")}>
                            <p className={`text-lg font-black ${stat.color}`}>{stat.value}</p>
                            <p className={cn("text-[10px] font-bold mt-0.5 truncate", darkMode ? "text-white/50" : "text-gray-500")}>{stat.label}</p>
                            <p className={cn("text-[9px] mt-0.5", darkMode ? "text-white/60" : "text-gray-400")}>{stat.sub}</p>
                          </div>
                        ));
                      })()}
                    </div>
                  </div>
                  </>
                );
              })()}

              {/* ── 6-Month Revenue Trend + Top Products ── */}
              {(() => {
                // Build last-6-month buckets
                const now6 = new Date();
                const months: { key: string; label: string; revenue: number; orders: number }[] = [];
                for (let i = 5; i >= 0; i--) {
                  const d = new Date(now6.getFullYear(), now6.getMonth() - i, 1);
                  const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                  const short = d.toLocaleString(currentLanguage === 'tr' ? 'tr-TR' : 'en-US', { month: 'short' });
                  months.push({ key, label: short, revenue: 0, orders: 0 });
                }
                for (const o of orders) {
                  const raw = o.createdAt;
                  const d = raw
                    ? (typeof raw === 'string' ? new Date(raw) : (raw as { toDate?: () => Date }).toDate?.() ?? new Date())
                    : new Date();
                  const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                  const bucket = months.find(m => m.key === key);
                  if (bucket) { bucket.revenue += o.totalPrice; bucket.orders++; }
                }

                // Top-5 products by order line count
                const productCount: Record<string, { name: string; count: number; revenue: number }> = {};
                for (const o of orders) {
                  for (const li of (o.lineItems || [])) {
                    const k = (li as { sku?: string; name?: string; title?: string }).sku || (li as { name?: string }).name || 'Unknown';
                    productCount[k] = productCount[k] || { name: (li as { name?: string; title?: string }).name || (li as { title?: string }).title || k, count: 0, revenue: 0 };
                    productCount[k].count += (li as { quantity?: number }).quantity || 1;
                    productCount[k].revenue += ((li as { price?: number }).price || 0) * ((li as { quantity?: number }).quantity || 1);
                  }
                }
                const top5 = Object.values(productCount).sort((a, b) => b.revenue - a.revenue).slice(0, 5);
                const maxRevTop = Math.max(...top5.map(p => p.revenue), 1);

                const totalRevAll = months.reduce((s, m) => s + m.revenue, 0);
                const totalOrdAll = months.reduce((s, m) => s + m.orders, 0);

                return (
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                    {/* Trend chart — takes 2 cols */}
                    <div className="lg:col-span-2 bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                      <div className="flex items-center justify-between mb-1">
                        <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider">
                          {currentLanguage === 'tr' ? '6 Aylık Ciro Trendi' : '6-Month Revenue Trend'}
                        </h3>
                        <div className="flex items-center gap-3 text-[10px] text-gray-400">
                          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-brand inline-block" />{currentLanguage === 'tr' ? 'Ciro' : 'Revenue'}</span>
                          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-blue-300 inline-block" />{currentLanguage === 'tr' ? 'Sipariş' : 'Orders'}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-4 mb-3">
                        <div>
                          <p className="text-xl font-bold text-gray-900">{fmtKpi(totalRevAll)}</p>
                          <p className="text-[10px] text-gray-400">{currentLanguage === 'tr' ? '6 ay toplam ciro' : '6-month total revenue'}</p>
                        </div>
                        <div className="w-px h-8 bg-gray-100" />
                        <div>
                          <p className="text-xl font-bold text-blue-600">{totalOrdAll}</p>
                          <p className="text-[10px] text-gray-400">{currentLanguage === 'tr' ? 'toplam sipariş' : 'total orders'}</p>
                        </div>
                      </div>
                      <ResponsiveContainer width="100%" height={160}>
                        <AreaChart data={months} margin={{ top: 0, right: 4, left: -20, bottom: 0 }}>
                          <defs>
                            <linearGradient id="gradRev" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%"  stopColor="#ff4000" stopOpacity={0.18} />
                              <stop offset="95%" stopColor="#ff4000" stopOpacity={0} />
                            </linearGradient>
                            <linearGradient id="gradOrd" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%"  stopColor="#3b82f6" stopOpacity={0.15} />
                              <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                          <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#86868b' }} axisLine={false} tickLine={false} />
                          <YAxis yAxisId="rev" tick={{ fontSize: 9, fill: '#86868b' }} axisLine={false} tickLine={false} tickFormatter={(v: number) => v >= 1000 ? `${(v/1000).toFixed(0)}k` : String(v)} />
                          <YAxis yAxisId="ord" orientation="right" tick={{ fontSize: 9, fill: '#86868b' }} axisLine={false} tickLine={false} />
                          <Tooltip
                            formatter={sayiBicimleyici((value, name) =>
                              name === 'revenue'
                                ? [`₺${value.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}`, currentLanguage === 'tr' ? 'Ciro' : 'Revenue']
                                : [value, currentLanguage === 'tr' ? 'Sipariş' : 'Orders']
                            )}
                            contentStyle={{ fontSize: 11, borderRadius: 10, border: '1px solid #f0f0f0' }}
                          />
                          <Area yAxisId="rev" type="monotone" dataKey="revenue" stroke="#ff4000" strokeWidth={2} fill="url(#gradRev)" dot={{ r: 3, fill: '#ff4000' }} />
                          <Area yAxisId="ord" type="monotone" dataKey="orders"  stroke="#3b82f6" strokeWidth={2} fill="url(#gradOrd)" dot={{ r: 3, fill: '#3b82f6' }} />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>

                    {/* Top products — 1 col */}
                    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                      <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-4">
                        {currentLanguage === 'tr' ? 'En Çok Satan Ürünler' : 'Top Products'}
                      </h3>
                      {top5.length === 0 ? (
                        <p className="text-xs text-gray-400 text-center py-6">{currentLanguage === 'tr' ? 'Sipariş verisi yok' : 'No order data'}</p>
                      ) : (
                        <div className="space-y-3">
                          {top5.map((p, i) => (
                            <div key={i} className="space-y-1">
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-semibold text-gray-700 truncate max-w-[140px]">{p.name}</span>
                                <span className="text-[10px] font-bold text-gray-500">{fmtKpi(p.revenue)}</span>
                              </div>
                              <div className="w-full bg-gray-100 rounded-full h-1.5">
                                <div
                                  className="bg-brand h-1.5 rounded-full transition-all"
                                  style={{ width: `${Math.round((p.revenue / maxRevTop) * 100)}%` }}
                                />
                              </div>
                              <p className="text-[10px] text-gray-400">{p.count} {currentLanguage === 'tr' ? 'adet' : 'units'}</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* Lead Pipeline Funnel */}
              {(() => {
                const STAGES = [
                  { key: 'New',         label: dashT.lead_labels['New'],         bar: 'bg-gray-400',    text: 'text-gray-600',   bg: 'bg-gray-50' },
                  { key: 'Contacted',   label: dashT.lead_labels['Contacted'],   bar: 'bg-blue-500',    text: 'text-blue-700',   bg: 'bg-blue-50' },
                  { key: 'Qualified',   label: dashT.lead_labels['Qualified'],   bar: 'bg-purple-500',  text: 'text-purple-700', bg: 'bg-purple-50' },
                  { key: 'Proposal',    label: dashT.lead_labels['Proposal'],    bar: 'bg-yellow-500',  text: 'text-yellow-700', bg: 'bg-yellow-50' },
                  { key: 'Negotiation', label: dashT.lead_labels['Negotiation'], bar: 'bg-orange-500',  text: 'text-orange-700', bg: 'bg-orange-50' },
                  { key: 'Closed Won',  label: dashT.lead_labels['Closed Won'],  bar: 'bg-green-500',   text: 'text-green-700',  bg: 'bg-green-50' },
                ] as const;
                const counts = STAGES.map(s => leads.filter(l => l.status === s.key).length);
                const maxCount = Math.max(...counts, 1);
                const totalActive = counts.slice(0, 5).reduce((a, b) => a + b, 0);
                const wonRate = totalActive > 0 ? ((counts[5] / (totalActive + counts[5])) * 100).toFixed(0) : '0';
                return (
                  <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider">{dashT.lead_summary}</h3>
                      <span className="text-xs font-bold text-green-600 bg-green-50 px-2.5 py-1 rounded-full">
                        {currentLanguage === 'tr' ? `Win Rate: ${wonRate}%` : `Win Rate: ${wonRate}%`}
                      </span>
                    </div>
                    <div className="space-y-2.5">
                      {STAGES.map((stage, i) => {
                        const count = counts[i];
                        const pct = Math.round((count / maxCount) * 100);
                        const convPct = i > 0 && counts[i - 1] > 0 ? Math.round((count / counts[i - 1]) * 100) : null;
                        return (
                          <div key={stage.key}>
                            <div className="flex items-center gap-3">
                              <span className={`text-[10px] font-bold w-20 flex-shrink-0 ${stage.text}`}>{stage.label}</span>
                              <div className="flex-1 bg-gray-100 rounded-full h-4 overflow-hidden">
                                <div
                                  className={`h-full ${stage.bar} rounded-full transition-all duration-500`}
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                              <span className="text-sm font-bold text-gray-800 w-6 text-right">{count}</span>
                              {convPct !== null && (
                                <span className={`text-[9px] font-bold w-10 text-right ${convPct >= 50 ? 'text-green-500' : 'text-gray-400'}`}>
                                  {convPct}%↓
                                </span>
                              )}
                              {convPct === null && <span className="w-10" />}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="mt-3 pt-3 border-t border-gray-50 flex items-center justify-between text-[10px] text-gray-400">
                      <span>{currentLanguage === 'tr' ? `Toplam: ${leads.length} müşteri adayı` : `Total: ${leads.length} leads`}</span>
                      <button onClick={() => setActiveTab('crm')} className="text-brand font-semibold hover:underline flex items-center gap-0.5">
                        {currentLanguage === 'tr' ? 'CRM\'e git' : 'Open CRM'} <ChevronRight className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                );
              })()}

              {/* ── Phase 51: Upcoming Follow-ups (7-day strip) ── */}
              {(() => {
                const today7 = new Date(); today7.setHours(0, 0, 0, 0);
                const in7 = new Date(today7.getTime() + 7 * 86400000);
                const upcoming = leads
                  .filter(l => {
                    if (!l.nextFollowUpDate) return false;
                    const due = typeof (l.nextFollowUpDate as { toDate?: () => Date }).toDate === 'function'
                      ? (l.nextFollowUpDate as { toDate: () => Date }).toDate()
                      : new Date(l.nextFollowUpDate as unknown as string | number);
                    return due >= today7 && due <= in7;
                  })
                  .sort((a, b) => {
                    const getDate = (x: unknown) => typeof (x as { toDate?: () => Date }).toDate === 'function'
                      ? (x as { toDate: () => Date }).toDate()
                      : new Date(x as string | number);
                    return getDate(a.nextFollowUpDate).getTime() - getDate(b.nextFollowUpDate).getTime();
                  });
                if (upcoming.length === 0) return null;
                return (
                  <div className={cn("rounded-2xl border p-5", darkMode ? "bg-white/5 border-white/10" : "bg-white border-gray-100 shadow-sm")}>
                    <div className="flex items-center justify-between mb-3">
                      <h3 className={cn("text-[10px] font-bold uppercase tracking-wider flex items-center gap-2", darkMode ? "text-white/50" : "text-gray-400")}>
                        <Calendar className="w-3.5 h-3.5" />
                        {currentLanguage === 'tr' ? '7 Günlük Takip Planı' : '7-Day Follow-up Plan'}
                      </h3>
                      <button onClick={() => { setActiveTab('crm'); setCrmTab('leads'); }} className="text-[10px] font-semibold text-brand hover:underline">
                        {currentLanguage === 'tr' ? 'CRM\'e git' : 'Go to CRM'}
                      </button>
                    </div>
                    <div className="space-y-2">
                      {upcoming.slice(0, 5).map(l => {
                        const due = typeof (l.nextFollowUpDate as { toDate?: () => Date }).toDate === 'function'
                          ? (l.nextFollowUpDate as { toDate: () => Date }).toDate()
                          : new Date(l.nextFollowUpDate as unknown as string | number);
                        const daysLeft = Math.round((due.getTime() - today7.getTime()) / 86400000);
                        return (
                          <button key={l.id} onClick={() => { setActiveTab('crm'); setSelectedLead(l); }}
                            className={cn("w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors", darkMode ? "hover:bg-white/5" : "hover:bg-gray-50")}>
                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 text-[10px] font-black ${daysLeft === 0 ? 'bg-amber-100 text-amber-700' : 'bg-blue-50 text-blue-600'}`}>
                              {daysLeft === 0 ? (currentLanguage === 'tr' ? 'BUG' : 'NOW') : `${daysLeft}g`}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className={cn("text-sm font-semibold truncate", darkMode ? "text-white/90" : "text-gray-800")}>{l.name}</p>
                              <p className={cn("text-[10px] truncate", darkMode ? "text-white/65" : "text-gray-400")}>{l.company}</p>
                            </div>
                            <p className={cn("text-[11px] font-bold flex-shrink-0", darkMode ? "text-white/50" : "text-gray-400")}>
                              {due.toLocaleDateString(currentLanguage === 'tr' ? 'tr-TR' : 'en-US', { month: 'short', day: 'numeric' })}
                            </p>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              {/* ── Phase 77: Top Customers by Revenue ── */}
              {orders.length > 0 && (() => {
                const custMap: Record<string, { revenue: number; orders: number }> = {};
                for (const o of orders) {
                  const k = o.customerName;
                  custMap[k] = custMap[k] || { revenue: 0, orders: 0 };
                  custMap[k].revenue += o.totalPrice || 0;
                  custMap[k].orders  += 1;
                }
                const top5 = Object.entries(custMap)
                  .map(([name, d]) => ({ name, ...d }))
                  .sort((a, b) => b.revenue - a.revenue)
                  .slice(0, 5);
                if (top5.length === 0) return null;
                const maxRev = top5[0].revenue;
                return (
                  <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider">
                        {currentLanguage === 'tr' ? 'En Yüksek Cirolu Müşteriler' : 'Top Customers by Revenue'}
                      </h3>
                      <button onClick={() => setActiveTab('reports')} className="text-[10px] font-semibold text-brand hover:underline">
                        {currentLanguage === 'tr' ? 'Raporlara git' : 'Open Reports'}
                      </button>
                    </div>
                    <div className="space-y-3">
                      {top5.map((c, i) => {
                        const pct     = Math.round((c.revenue / maxRev) * 100);
                        const medal   = ['🥇','🥈','🥉','',''][i] || '';
                        return (
                          <div key={c.name} className="space-y-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs font-semibold text-gray-700 truncate flex items-center gap-1.5">
                                {medal && <span className="text-sm leading-none">{medal}</span>}
                                {c.name}
                              </span>
                              <div className="flex items-center gap-2 flex-shrink-0">
                                <span className="text-[10px] text-gray-400">{c.orders} {currentLanguage === 'tr' ? 'sip.' : 'ord.'}</span>
                                <span className="text-[10px] font-bold text-gray-700">
                                  {fmtKpi(c.revenue)}
                                </span>
                              </div>
                            </div>
                            <div className="w-full bg-gray-100 rounded-full h-1.5">
                              <div
                                className={`h-1.5 rounded-full transition-all duration-700 ${i === 0 ? 'bg-brand' : 'bg-gray-300'}`}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              {/* ── Phase 73: Weekday Order Heatmap ── */}
              {orders.length > 0 && (() => {
                const DAYS_TR = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];
                const DAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
                const counts = Array(7).fill(0);
                for (const o of orders) {
                  const raw = o.createdAt ?? o.syncedAt;
                  if (!raw) continue;
                  const d = typeof (raw as { toDate?: () => Date }).toDate === 'function'
                    ? (raw as { toDate: () => Date }).toDate()
                    : new Date(raw as string | number | Date);
                  counts[d.getDay()] += 1;
                }
                const maxC = Math.max(...counts, 1);
                const totalO = counts.reduce((a, b) => a + b, 0);
                const busiest = counts.indexOf(Math.max(...counts));
                return (
                  <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider">
                        {currentLanguage === 'tr' ? 'Haftalık Sipariş Dağılımı' : 'Orders by Weekday'}
                      </h3>
                      <span className="text-[10px] font-bold text-brand bg-brand/10 px-2 py-0.5 rounded-full">
                        {currentLanguage === 'tr' ? `En yoğun: ${DAYS_TR[busiest]}` : `Busiest: ${DAYS_EN[busiest]}`}
                      </span>
                    </div>
                    <div className="flex items-end gap-2">
                      {counts.map((c, i) => {
                        const pct = Math.round((c / maxC) * 100);
                        const isToday = i === new Date().getDay();
                        const isBusiest = i === busiest;
                        return (
                          <div key={i} className="flex-1 flex flex-col items-center gap-1.5">
                            {/* Bar */}
                            <div className="w-full flex items-end justify-center" style={{ height: 64 }}>
                              <div
                                className={`w-full rounded-t-lg transition-all duration-700 ${
                                  isBusiest ? 'bg-brand' : isToday ? 'bg-brand/50' : 'bg-gray-200'
                                }`}
                                style={{ height: `${Math.max(pct, 6)}%` }}
                              />
                            </div>
                            {/* Count */}
                            <span className={`text-[10px] font-bold ${isBusiest ? 'text-brand' : 'text-gray-600'}`}>{c}</span>
                            {/* Day label */}
                            <span className={`text-[9px] font-semibold ${isToday ? 'text-brand' : 'text-gray-400'}`}>
                              {currentLanguage === 'tr' ? DAYS_TR[i] : DAYS_EN[i]}
                              {isToday && <span className="block w-1 h-1 rounded-full bg-brand mx-auto mt-0.5" />}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                    <p className="text-[10px] text-gray-400 mt-3">
                      {currentLanguage === 'tr'
                        ? `${totalO} siparişin haftanın günlerine göre dağılımı`
                        : `Distribution of ${totalO} orders across weekdays`}
                    </p>
                  </div>
                );
              })()}

              {/* ── Phase 38: Recently Viewed ── */}
              {recentlyViewed.length > 0 && (
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                  <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                    <History className="w-4 h-4" />
                    {currentLanguage === 'tr' ? 'Son Görüntülenenler' : 'Recently Viewed'}
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {recentlyViewed.map(item => (
                      <button key={item.id}
                        onClick={() => {
                          setActiveTab(item.tab);
                          if (item.type === 'order') {
                            const o = orders.find(o => o.id === item.id);
                            if (o) setSelectedOrder(o);
                          } else if (item.type === 'lead') {
                            const l = leads.find(l => l.id === item.id);
                            if (l) setSelectedLead(l);
                          }
                        }}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-full text-xs font-medium text-gray-700 transition-colors"
                      >
                        {item.type === 'order' ? <Package className="w-3 h-3 text-blue-400 flex-shrink-0" />
                          : item.type === 'lead' ? <Users className="w-3 h-3 text-brand flex-shrink-0" />
                          : <List className="w-3 h-3 text-purple-400 flex-shrink-0" />}
                        <span className="truncate max-w-[140px]">{item.label}</span>
                      </button>
                    ))}
                    <button onClick={() => {
                      setRecentlyViewed([]);
                      const uid = auth.currentUser?.uid;
                      if (uid) setDoc(doc(db, 'userPrefs', uid), { recentlyViewed: [] }, { merge: true }).catch(() => {});
                    }}
                      className="text-[10px] text-gray-400 hover:text-gray-600 px-2 py-1.5 ml-auto self-center transition-colors">
                      {currentLanguage === 'tr' ? 'Temizle' : 'Clear'}
                    </button>
                  </div>
                </div>
              )}
          {/* ── Phase 595: Görevler & Hatırlatıcılar ─────────────────────── */}
          {activeTab === 'dashboard' && (() => {
            const tr595 = currentLanguage === 'tr';
            const today595 = new Date().toISOString().slice(0,10);
            const overdueTasks = p595Tasks.filter(t => !t.done && t.dueDate < today595);
            const todayTasks = p595Tasks.filter(t => !t.done && t.dueDate === today595);
            const prioColors595: Record<string,string> = {'Kritik':'border-l-red-500 bg-red-50/30','Yüksek':'border-l-orange-400 bg-orange-50/20','Orta':'border-l-amber-300 bg-amber-50/10','Düşük':'border-l-gray-300 bg-gray-50/50'};
            const prioBadge595: Record<string,string> = {'Kritik':'bg-red-100 text-red-700','Yüksek':'bg-orange-100 text-orange-700','Orta':'bg-amber-100 text-amber-700','Düşük':'bg-gray-100 text-gray-500'};
            return (
              <div className="apple-card p-5">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="font-bold text-gray-900 text-sm">{tr595?'📌 Görevler & Hatırlatıcılar':'📌 Tasks & Reminders'}</h3>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {overdueTasks.length>0&&<span className="text-red-500 font-bold">{overdueTasks.length} {tr595?'gecikmiş · ':'overdue · '}</span>}
                      {todayTasks.length>0&&<span className="text-amber-600 font-bold">{todayTasks.length} {tr595?'bugün vadeli · ':'due today · '}</span>}
                      {p595Tasks.filter(t=>!t.done).length} {tr595?'açık görev':'open task(s)'}
                    </p>
                  </div>
                  <button onClick={()=>setP595ShowForm(v=>!v)} className="apple-button-primary flex items-center gap-2 text-sm"><Plus className="w-4 h-4"/>{tr595?'Görev Ekle':'Add Task'}</button>
                </div>
                {p595ShowForm && (
                  <div className="bg-gray-50 rounded-xl p-4 mb-4 space-y-3">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <input className="apple-input px-3 py-2 text-sm col-span-2" placeholder={tr595?'Görev başlığı...':'Task title...'} value={p595Draft.title} onChange={e=>setP595Draft(d=>({...d,title:e.target.value}))} />
                      <input type="date" className="apple-input px-3 py-2 text-sm" value={p595Draft.dueDate} onChange={e=>setP595Draft(d=>({...d,dueDate:e.target.value}))} />
                      <select className="apple-input px-3 py-2 text-sm" value={p595Draft.priority} onChange={e=>setP595Draft(d=>({...d,priority:e.target.value as typeof d.priority}))}>
                        <option value="Düşük">{tr595?'Düşük':'Low'}</option>
                        <option value="Orta">{tr595?'Orta':'Medium'}</option>
                        <option value="Yüksek">{tr595?'Yüksek':'High'}</option>
                        <option value="Kritik">{tr595?'Kritik':'Critical'}</option>
                      </select>
                      <input className="apple-input px-3 py-2 text-sm" placeholder={tr595?'Atanan kişi':'Assigned to'} value={p595Draft.assignedTo} onChange={e=>setP595Draft(d=>({...d,assignedTo:e.target.value}))} />
                      <input className="apple-input px-3 py-2 text-sm" placeholder={tr595?'Modül (ör. CRM, Stok)':'Module (e.g. CRM, Stock)'} value={p595Draft.module} onChange={e=>setP595Draft(d=>({...d,module:e.target.value}))} />
                    </div>
                    <div className="flex gap-2">
                      <button onClick={async ()=>{
                        if(!p595Draft.title) return;
                        try { await addDoc(collection(db,'workflowTasks'),{title:p595Draft.title,dueDate:p595Draft.dueDate||today595,assignedTo:p595Draft.assignedTo,module:p595Draft.module,priority:p595Draft.priority,done:false,createdAt:serverTimestamp()}); toast(currentLanguage === 'tr' ? 'Görev eklendi ✓' : 'Task added ✓', 'success'); } catch(e){console.error("[firestore]", e); toast(currentLanguage === 'tr' ? 'Görev eklenemedi.' : 'Failed to add task.', 'error');}
                        setP595Draft({title:'',dueDate:'',assignedTo:'',module:'',priority:'Orta'});
                        setP595ShowForm(false);
                      }} className="apple-button-primary text-sm px-4 py-1.5">{tr595?'Kaydet':'Save'}</button>
                      <button onClick={()=>setP595ShowForm(false)} className="apple-button-secondary text-sm px-4 py-1.5">{tr595?'İptal':'Cancel'}</button>
                    </div>
                  </div>
                )}
                {p595Tasks.length===0 ? (
                  <p className="text-center py-6 text-gray-400 text-sm">{tr595?'Henüz görev yok. "Görev Ekle" ile başlayın.':'No tasks yet. Click "Add Task" to start.'}</p>
                ) : (
                  <div className="space-y-2">
                    {p595Tasks.filter(t=>!t.done).sort((a,b)=>{
                      const pOrder = {Kritik:0,Yüksek:1,Orta:2,Düşük:3};
                      return (pOrder[a.priority]||3)-(pOrder[b.priority]||3) || a.dueDate.localeCompare(b.dueDate);
                    }).map(t=>(
                      <div key={t.id} className={`flex items-center gap-3 p-3 rounded-xl border border-l-4 ${prioColors595[t.priority]}`}>
                        <button onClick={async ()=>{try{await updateDoc(doc(db,'workflowTasks',t.id),{done:true});}catch(e){console.error("[firestore]", e);}}} className="w-5 h-5 rounded border-2 border-gray-300 hover:border-emerald-500 flex-shrink-0 transition-colors" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-gray-800 truncate">{t.title}</p>
                          <p className="text-xs text-gray-400">
                            {t.dueDate&&<span className={t.dueDate<today595?'text-red-500 font-bold':t.dueDate===today595?'text-amber-600 font-bold':''}>{t.dueDate} · </span>}
                            {t.assignedTo&&<span>{t.assignedTo} · </span>}
                            {t.module&&<span className="text-blue-500">{t.module}</span>}
                          </p>
                        </div>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${prioBadge595[t.priority]}`}>{t.priority}</span>
                        <button onClick={async ()=>{if(!await confirmDelete(undefined, currentLanguage==='tr'?'tr':'en'))return;try{await deleteDoc(doc(db,'workflowTasks',t.id));}catch(e){console.error("[firestore]", e);}}} className="text-gray-300 hover:text-red-400 shrink-0">✕</button>
                      </div>
                    ))}
                    {p595Tasks.filter(t=>t.done).length>0&&(
                      <p className="text-xs text-gray-400 text-center pt-1">✓ {p595Tasks.filter(t=>t.done).length} {tr595?'tamamlanan görev':'completed task(s)'} &nbsp;
                        <button onClick={async ()=>{if(!await confirmDelete(undefined, currentLanguage==='tr'?'tr':'en'))return;p595Tasks.filter(t=>t.done).forEach(t=>deleteDoc(doc(db,'workflowTasks',t.id)));}} className="text-red-400 hover:text-red-600">{tr595?'Temizle':'Clear'}</button>
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })()}

            </motion.div>
  );
}
