import { sayiBicimleyici } from '../utils/recharts';
import { gorunenSiparisNo, siparisTutari } from '../utils/siparis';
import { panoCirosu, panoMikroSiparisleri, panoSiparisleri } from '../utils/pano/mikroBirlesim';
import { ekranTutari, sayiSirala } from '../utils/para';
import {
  odemeDavranisi, segmentCirosu, enIyiMusteriler, segmentKarliligi,
  tipSegmenti, donutSegmenti, b2bSegmenti,
} from '../utils/pano/musteriAnaliz';
import { siparisKarliligi } from '../utils/siparisler/siparisKarlilik';
import {
  donemCirosu, ayCirosu, hedefGerceklesme, butceKarsilastir,
  satisHizi, hizDegisimi, haftalikCiro, enBuyukHafta, hedefGirdisi, hedefOnDoldur,
} from '../utils/pano/hedefButce';
import { gunlukCiro, sonNGunToplami, aylikCiro, mtdKarsilastir, donemToplami, olcekTavani } from '../utils/pano/ciroDonem';
import {
  stokDurumu, stokSeviyesi, odenmemisSiparisler, gecikmisOdemeler, bekleyenSiparisler,
  gecikmisAdaylar, aylikCiroDegisimi, finansKpilari, nakitPozisyonu, esikUyarilari,
  huniKazanmaOrani,
} from '../utils/pano/finansKpi';
import { gunAnahtari, zamanDate, zamanMs, ayAnahtari, tarihYaz, bugunAnahtari } from '../utils/zaman';
import { siparisDurumEtiketi } from '../utils/durumEtiketi';
import KurUyarisi from '../components/KurUyarisi';
import {
  stokDegeriOzeti, dusukStokKalemleri, stokEsikYaz, enCokSatanlar,
  durumDagilimi, haftaIciIsiHaritasi, sonSevkiyatlar, PANO_DURUMLARI,
} from '../utils/pano/stokSevkiyat';
import { oranYuzde } from '../utils/siparisler/lojistikKpi';
import { adetYaz } from '../utils/muhasebe/depoDeger';
import React from 'react';
import { motion } from 'motion/react';
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
import { kartMaliyetiTL, kartSatisTL } from '../utils/cost';
import { paraYaz, tlYaz } from '../utils/currency';
import { confirmDelete } from '../lib/confirm';
import ModuleHeader from '../components/ModuleHeader';
import DashboardAnalysis from '../components/DashboardAnalysis';
import DateRangePicker from '../components/DateRangePicker';
import SonSenkronRozeti from '../components/SonSenkronRozeti';
import type { Order, Lead, InventoryItem, Shipment, OrderLineItem } from '../types';
import { useMikroFaturalar } from '../hooks/useMikroFaturalar';
import { useMikroSiparisler } from '../hooks/useMikroSiparisler';
import { oc } from '../i18n/ortak';
import { dc } from '../i18n/dashboard';

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
    ? paraYaz(Math.abs(delta), { ondalik: 0 })
    : Math.abs(delta).toLocaleString('tr-TR', { maximumFractionDigits: 0 });
  return (
    <span
      className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${up ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-500'}`}
      title={yuzde === null
        ? 'Önceki dönemde karşılaştırılacak veri yok — yüzde hesaplanamıyor, mutlak değişim gösteriliyor.'
        : `Önceki dönem: ${birim === 'tutar' ? paraYaz(prev, { ondalik: 0 }) : Number(prev).toLocaleString('tr-TR', { maximumFractionDigits: 0 })}`}
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
    const start = zamanDate(dateRange.startDate);
    const end = zamanDate(dateRange.endDate);
    const d = zamanDate(f.tarih);
    if (!start || !end || !d) return false;
    return d >= start && d <= end;
  });

  // Tutarı okunamayan fatura/sipariş 0 SAYILMAZ, SAYILIR (`Tutar.bilinmeyen`).
  // ÇİFT SAYIM KORUMASI (2026-09-01): Mikro'dan türeyen native sipariş (source 'mikro…')
  // DIŞLANIR — aynı fatura hem mikroFaturalar hem orders üzerinden iki kez ciroya
  // girmesin. Kural + toplama artık TEK YERDE: utils/pano/mikroBirlesim → panoCirosu
  // (sparkline ve 7 günlük şerit de aynı fonksiyonu çağırır; üçü sessizce ayrışamaz).
  const ciro = panoCirosu(filteredOrders, filteredMikroFaturalar);
  const revenueT = ciro.tutar;
  const combinedRevenue = ciro.ekran;   // hiç bilinen yoksa NaN → fmtKpi '—'
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

  // Düşük stok kapısı TEK KAYNAK (Faz 3 5/n): Phase 24 ajandası ile aşağıdaki
  // "Düşük Stok Uyarısı" paneli aynı listeyi okumalı — eskiden biri
  // `(stockLevel ?? 0) <= (lowStockThreshold ?? 5)`, diğeri ham `<=` ile süzüyordu
  // ve stoğu/eşiği bilinmeyen kalemde İKİ EKRAN FARKLI CEVAP veriyordu.
  const dusukStok = React.useMemo(() => dusukStokKalemleri(inventory), [inventory]);

  // Mikro siparişlerini Order biçimine uyarlayıp birleştir (ADDITIVE — EKLE, YERİNE KOYMA).
  // Eşleme kuralı + "tutarı bilinmiyorsa `totalPrice` alanı YAZILMAZ" sözleşmesi tek yerde:
  // utils/pano/mikroBirlesim. Eskiden `totalPrice: ms.tutar` idi ve hook o alanı
  // `Number(d.sip_tutar || 0)` ile üretiyor — tutarı okunamayan Mikro siparişi panoda
  // "bilinen ₺0" oluyordu. Modül HAM `sip_tutar` kolonunu okur, bilinmiyorsa alanı yazmaz
  // (sunucudaki `faturadanSiparis` ile aynı sözleşme) → `siparisTutari` NaN döner, sayılır.
  // `syncedAt` = MİKRO'NUN TARİHİ, bugün DEĞİL (Faz 1 3/n) — modülde korundu.
  const combinedOrders = panoSiparisleri(orders, panoMikroSiparisleri(mikroSiparisler));

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
                      <span className="text-[10px] text-gray-400">{tarihYaz(dashClock, { weekday: 'short', day: 'numeric', month: 'short' }, currentLanguage === 'en' ? 'en' : 'tr')}</span>
                    </div>
                  </div>
                }
              />

              {/* ── Phase 528: Smart Alert Strip ── */}
              {(() => {
                const now528 = Date.now();
                const alerts: { id: string; color: string; icon: string; msg: string }[] = [];

                // Orders stuck in Pending > 3 days (native + mikro)
                const bekleyen528 = bekleyenSiparisler(combinedOrders, { simdi: now528, gun: 3 });
                if (bekleyen528.sayi > 0)
                  alerts.push({ id: 'stuckPending', color: 'amber', icon: '⏳',
                    msg: currentLanguage === 'tr'
                      ? `${bekleyen528.sayi} sipariş 3+ gündür bekliyor`
                      : `${bekleyen528.sayi} order${bekleyen528.sayi > 1 ? 's' : ''} pending for 3+ days` });

                // Leads with no activity > 7 days
                const adaylar528 = gecikmisAdaylar(leads, { simdi: now528, gun: 7 });
                if (adaylar528.sayi > 0)
                  alerts.push({ id: 'inactiveLeads', color: 'blue', icon: '👤',
                    msg: currentLanguage === 'tr'
                      ? `${adaylar528.sayi} aktif aday 7+ gündür güncellenmedi`
                      : `${adaylar528.sayi} active lead${adaylar528.sayi > 1 ? 's' : ''} with no activity in 7+ days` });

                // Critical low stock
                // Stok seviyesi OKUNAMAYAN ürün "sıfır stok" SAYILMAZ (utils/pano/finansKpi):
                // eski `(i.stockLevel ?? 0) <= 0` her tutarsız kaydı KIRMIZI alarma çeviriyordu.
                const stok528 = stokDurumu(inventory);
                if (stok528.tukenen.length > 0)
                  alerts.push({ id: 'criticalStock', color: 'red', icon: '📦',
                    msg: currentLanguage === 'tr'
                      ? `${stok528.tukenen.length} ürün stokta kalmadı (sıfır stok)`
                      : `${stok528.tukenen.length} product${stok528.tukenen.length > 1 ? 's' : ''} out of stock` });
                if (stok528.seviyesiBilinmeyen > 0)
                  alerts.push({ id: 'stokBilinmiyor', color: 'amber', icon: '❔',
                    msg: currentLanguage === 'tr'
                      ? `${stok528.seviyesiBilinmeyen} ürünün stok seviyesi okunamadı — stok durumu bilinmiyor`
                      : `${stok528.seviyesiBilinmeyen} product(s) with unreadable stock level — status unknown` });

                // Unpaid delivered orders
                const teslimOdenmemis528 = odenmemisSiparisler(orders, { durum: 'Delivered' });
                if (teslimOdenmemis528.sayi > 0)
                  alerts.push({ id: 'unpaidDelivered', color: 'rose', icon: '💳',
                    msg: currentLanguage === 'tr'
                      ? `${teslimOdenmemis528.sayi} teslim edilmiş sipariş hâlâ ödenmedi`
                      : `${teslimOdenmemis528.sayi} delivered order${teslimOdenmemis528.sayi > 1 ? 's' : ''} still unpaid` });

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
                          title={dc(currentLanguage).kapat}
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
                  // Düşük stok sayısı TEK KAPIDAN (`dusukStok`): ham `i.stockLevel <= i.lowStockThreshold`
                  // karşılaştırması alanlardan biri bilinmiyorken `undefined <= 5` → false veriyordu,
                  // aşağıdaki uyarı karosu ise aynı kalemi `?? 0` ile "düşük" sayıyordu (2026-09-19
                  // hakem turu: aynı ekranda üç farklı düşük-stok kapısı).
                  { label: dashT.inventory_label, value: inventory.length, ready: inventoryCountReady, icon: List, color: 'text-purple-500', bg: 'bg-purple-50', sub: `${dusukStok.dusuk.length} ${dashT.low_stock}`, tab: 'inventory', delta: null },
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
                      <ChevronRight className="w-3 h-3" />{oc(currentLanguage).detaya_git}
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
                    ? (dc(currentLanguage).son_30_gun)
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
                        <p className="text-2xl font-bold mt-auto text-gray-300 animate-pulse" title={dc(currentLanguage).veri_yukleniyor}>{symbol}···</p>
                      )}
                      <p className="text-xs font-semibold text-gray-500 mt-1">{dashT.total_revenue}</p>
                      <p className="text-[10px] text-gray-400 mt-0.5">
                        {aralikEtiketi}
                      </p>
                      {/* Tutarı okunamayan kayıt varsa rakam KISMİ toplamdır — sessizce eksik göstermek yerine söylenir. */}
                      {revenueReady && revenueT.bilinmeyen > 0 && (
                        <p className="text-[10px] text-amber-600 mt-0.5">
                          {revenueT.bilinmeyen} {dc(currentLanguage).kaydin_tutari_okunamadi_kismi_toplam}
                        </p>
                      )}
                      {/* Phase 35: 7 GÜNLÜK ciro sparkline — kartın büyük rakamı seçili
                          tarih aralığına, bu mini grafik BİLEREK son 7 güne bakar (kısa
                          vadeli eğilim göstergesi). Farklı pencere olduğu tooltip'te yazar.

                          ÇİFT SAYIM DÜZELTİLDİ (2026-09-04): `orders` HAM okunuyordu ve
                          altında `mikroFaturalar` ayrıca toplanıyordu — Mikro faturasından
                          türetilen siparişler (source:'mikro-fatura') iki kez sayılıyor,
                          çubuklar gerçeğin iki katına çıkıyordu. Kartın büyük rakamı
                          (combinedRevenue) bu korumaya zaten sahipti; sparkline değildi. */}
                      {(() => {
                        // Gün kovaları + "tutarı bilinmeyen kayıt 0 sayılmaz, SAYILIR" kuralı
                        // utils/pano/ciroDonem → gunlukCiro'da (testli); o da birleşim kuralını
                        // KPI kartıyla AYNI yere (utils/pano/mikroBirlesim → panoCirosu) devrediyor.
                        // Gün süzgeci orada, kural onun da altında: 2026-09-04'te sparkline korumayı
                        // kaçırdığı için çubuklar gerçeğin iki katına çıkmıştı.
                        const days = gunlukCiro(orders, mikroFaturalar, 7, new Date(), { iptalHaric: false });
                        // Bilinmeyen gün ('—') ölçeğe girmez; alt sınır 1 sıfıra-bölme koruması (para iddiası değil).
                        const maxRev = olcekTavani(days);
                        return (
                          <div className="flex items-end gap-0.5 mt-2 h-8">
                            {days.map((d, i) => (
                              <div key={i} className="flex-1 flex flex-col justify-end">
                                {/* Tutarı hiç bilinmeyen gün: gri taban çubuğu — yüksekliği 0'mış gibi
                                    YEŞİL çizmek "o gün ciro yoktu" demekti (sahte kesinlik). */}
                                <div
                                  className={`rounded-sm opacity-60 group-hover:opacity-100 transition-opacity ${d.grafik !== null ? 'bg-green-400' : 'bg-gray-300'}`}
                                  style={{ height: `${d.grafik !== null ? Math.max((d.grafik / maxRev) * 100, 4) : 4}%` }}
                                  title={`${d.gun}. gün: ${fmtKpi(d.ekran)}${d.tutar.bilinmeyen > 0 ? (currentLanguage === 'tr' ? ` · ${d.tutar.bilinmeyen} kaydın tutarı okunamadı` : ` · ${d.tutar.bilinmeyen} record(s) unpriced`) : ''} — ${dc(currentLanguage).son_7_gun_egilimi}`}
                                />
                              </div>
                            ))}
                          </div>
                        );
                      })()}
                      <button onClick={() => setActiveTab('reports')} className="text-[10px] text-brand mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5">
                        <ChevronRight className="w-3 h-3" />{oc(currentLanguage).detaya_git}
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
                // TEK KAPI (2026-09-19 hakem turu): bu karo eskiden kendi süzgecini kuruyordu
                // (`(i.stockLevel ?? 0) <= (i.lowStockThreshold ?? 5)`), yani Mikro'dan stoğu
                // gelmemiş kartı "stok 0" sayıp "Sipariş verilmeli" diye sayıyordu — aşağıdaki
                // "Düşük Stok Uyarısı" paneli ise aynı kartı listelemeyip "denetlenemedi" diyordu.
                // Kullanıcı aynı ekranda İKİ FARKLI düşük-stok sayısı görüyordu. Kaynak artık
                // `dusukStok` (utils/pano/stokSevkiyat.dusukStokKalemleri, testli).
                const lowStockCount  = dusukStok.dusuk.length;
                // Stoğu ya da eşiği bilinmeyen kalem "düşük" DEĞİL, "denetlenemedi"dir — sayısı
                // karonun alt metnine not düşer (sessizce yutulmaz).
                const stokDenetlenemeyen = dusukStok.stokBilinmeyen.length + dusukStok.esikBilinmeyen.length;
                const bugunKey = bugunAnahtari();
                const shippedToday   = orders.filter(o =>
                  o.status === 'Shipped' && gunAnahtari(o.syncedAt) === bugunKey
                ).length;
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
                // Çift sayım koruması (Mikro türevi native sipariş dışlanır, faturası
                // `mikroFaturalar` üzerinden sayılır) ve "tutarı okunamayan kayıt 0
                // SAYILMAZ, SAYILIR" kuralı sparkline + KPI kartıyla AYNI yerde:
                // utils/pano/mikroBirlesim → panoCirosu. Rakam kısmi kalır, altına
                // "N kaydın tutarı okunamadı" notu düşer.
                //
                // Pencere BU KARTA özel: KAYAN 7×24 saat (`sonNGunToplami`), yukarıdaki
                // sparkline ise TAKVİM günü kovalıyor — ikisi de "son 7 gün" diyor ama
                // rakamları eşit değil. Bilerek ayrı tutuldu (bkz. utils/pano/ciroDonem).
                const weekRevenueT = sonNGunToplami(orders, mikroFaturalar, 7);
                const weekRevenue = ekranTutari(weekRevenueT);

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
                      <p className="text-[10px] font-semibold text-gray-500 truncate mt-1">{dc(currentLanguage)._7_gunluk_ciro}</p>
                      <p className="text-[10px] text-gray-400"
                        title={currentLanguage === 'tr'
                          ? 'Bu kart seçili tarih aralığından bağımsızdır: her zaman son 7 günü gösterir.'
                          : 'Independent of the selected date range: always the last 7 days.'}>
                        {dc(currentLanguage).son_7_gun_araliktan_bagimsiz}
                      </p>
                      {weekRevenueT.bilinmeyen > 0 && (
                        <p className="text-[10px] text-amber-600">
                          {weekRevenueT.bilinmeyen} {dc(currentLanguage).kaydin_tutari_okunamadi}
                        </p>
                      )}
                    </div>

                    {/* ── Remaining plain cards ── */}
                    {[
                      {
                        icon: Clock,
                        label: dc(currentLanguage).bekleyen_siparis,
                        value: pendingCount,
                        color: pendingCount > 5 ? 'text-amber-600' : 'text-gray-600',
                        bg:   pendingCount > 5 ? 'bg-amber-50' : 'bg-gray-50',
                        sub:  pendingCount > 5 ? (dc(currentLanguage).acil) : (currentLanguage === 'tr' ? 'Normal' : 'Normal'),
                        onClick: () => setActiveTab('orders'),
                      },
                      {
                        icon: AlertTriangle,
                        label: oc(currentLanguage).dusuk_stok,
                        value: lowStockCount,
                        color: lowStockCount > 0 ? 'text-red-600' : 'text-gray-400',
                        bg:   lowStockCount > 0 ? 'bg-red-50' : 'bg-gray-50',
                        // "Stok yeterli" ancak DENETLENEBİLEN kalemler için söylenebilir:
                        // stoğu/eşiği bilinmeyen kalem varsa bunu açıkça yazar.
                        sub:  (lowStockCount > 0
                                ? (dc(currentLanguage).siparis_verilmeli)
                                : (dc(currentLanguage).stok_yeterli))
                              + (stokDenetlenemeyen > 0
                                ? (currentLanguage === 'tr' ? ` · ${stokDenetlenemeyen} kalem denetlenemedi` : ` · ${stokDenetlenemeyen} unchecked`)
                                : ''),
                        onClick: () => setActiveTab('inventory'),
                      },
                      {
                        icon: Truck,
                        label: dc(currentLanguage).bugun_kargolandi,
                        value: shippedToday,
                        color: 'text-blue-600',
                        bg:   'bg-blue-50',
                        sub:  dc(currentLanguage).kargoya_verilen,
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
                // KANONİK ALAN (utils/pano/finansKpi): eski kod `i.stock` / `i.minStock` okuyordu —
                // InventoryItem'da o adlar YOK (`stockLevel` / `lowStockThreshold`, types.ts 39/41),
                // bu yüzden bu içgörü bugüne dek HİÇ çalışmadı. `|| 5` uydurma eşiği ve `?? 0` sahte
                // adedi de kalktı: eşiği bilinmeyen ürüne kritik/normal kararı verilmez.
                const stok90 = stokDurumu(inventory);
                const enDusuk90 = stok90.enDusukKritik;
                if (enDusuk90) {
                  insights.push({
                    icon: '📦',
                    text: currentLanguage === 'tr'
                      ? `${enDusuk90.name} kritik stokta (${stokSeviyesi(enDusuk90)} adet kaldı)`
                      : `${enDusuk90.name} is low in stock (${stokSeviyesi(enDusuk90)} left)`,
                    color: 'text-amber-700',
                    bg: 'bg-amber-50',
                    borderColor: 'border-amber-200',
                  });
                }

                // Insight 2: unpaid orders total
                const odenmemis90 = odenmemisSiparisler(orders);
                if (odenmemis90.sayi > 0) {
                  // Tutarı okunamayan sipariş ₺0 SAYILMAZ, SAYILIR — rakam kısmi toplamsa söylenir.
                  const notu90 = odenmemis90.tutar.bilinmeyen > 0
                    ? (currentLanguage === 'tr'
                        ? ` · ${odenmemis90.tutar.bilinmeyen} kaydın tutarı okunamadı (kısmi toplam)`
                        : ` · ${odenmemis90.tutar.bilinmeyen} record(s) unpriced (partial total)`)
                    : '';
                  insights.push({
                    icon: '💳',
                    text: currentLanguage === 'tr'
                      ? `${odenmemis90.sayi} siparişte ${fmtKpi(odenmemis90.ekran)} ödeme bekliyor${notu90}`
                      : `${odenmemis90.sayi} order${odenmemis90.sayi > 1 ? 's' : ''} pending payment (${fmtKpi(odenmemis90.ekran)})${notu90}`,
                    color: 'text-red-700',
                    bg: 'bg-red-50',
                    borderColor: 'border-red-200',
                  });
                }

                // Insight 3: overdue leads (no follow-up in 7+ days with Contacted status)
                // TARİHSİZ ADAY "7+ gündür güncellenmedi" DEMEZ (utils/pano/finansKpi): eski
                // `if (!raw) return true` tarihi hiç olmayan adayı KESİN gecikmiş sayıyordu —
                // aynı sayfadaki Phase 528 şeridi ise onu hiç saymıyordu (iki panel iki cevap).
                // Tarihsiz kayıtlar ayrı sayılır: içgörü şeridi `slice(0, 4)` ile kırpıldığı için
                // not, gecikme içgörüsü varken ona ek olarak yazılır; yoksa kendi rozetini alır.
                const gecikmisAday90 = gecikmisAdaylar(leads, { simdi: Date.now(), gun: 7 });
                const adayNotu90 = gecikmisAday90.tarihsiz > 0
                  ? (currentLanguage === 'tr'
                      ? ` · ${gecikmisAday90.tarihsiz} adayda güncelleme tarihi yok (gecikme hesaplanamıyor)`
                      : ` · ${gecikmisAday90.tarihsiz} lead(s) without an update date (overdue not computable)`)
                  : '';
                if (gecikmisAday90.sayi > 0) {
                  insights.push({
                    icon: '🎯',
                    text: currentLanguage === 'tr'
                      ? `${gecikmisAday90.sayi} müşteri adayı 7+ gündür güncellenmedi${adayNotu90}`
                      : `${gecikmisAday90.sayi} lead${gecikmisAday90.sayi > 1 ? 's' : ''} haven't been updated in 7+ days${adayNotu90}`,
                    color: 'text-purple-700',
                    bg: 'bg-purple-50',
                    borderColor: 'border-purple-200',
                  });
                } else if (gecikmisAday90.tarihsiz > 0) {
                  insights.push({
                    icon: '❔',
                    text: currentLanguage === 'tr'
                      ? `${gecikmisAday90.tarihsiz} müşteri adayında güncelleme tarihi yok — gecikme hesaplanamıyor`
                      : `${gecikmisAday90.tarihsiz} lead(s) without an update date — overdue not computable`,
                    color: 'text-gray-600',
                    bg: 'bg-gray-50',
                    borderColor: 'border-gray-200',
                  });
                }

                // Insight 4: top revenue month-over-month rise
                // TÜRETME KAPISI (utils/pano/finansKpi): iki ayın birinde tek kayıt bile okunamadıysa
                // yüzde ÜRETİLMEZ — eski `?? 0` toplamları kısmi veriden kesin bir artış oranı basıyordu.
                const aylik90 = aylikCiroDegisimi(orders, Date.now());
                if (aylik90.belirginArtis && aylik90.yuzde !== null) {
                  insights.push({
                    icon: '📈',
                    text: currentLanguage === 'tr'
                      ? `Bu ay gelir geçen aya göre %${aylik90.yuzde} artışta`
                      : `Revenue is up ${aylik90.yuzde}% vs last month`,
                    color: 'text-emerald-700',
                    bg: 'bg-emerald-50',
                    borderColor: 'border-emerald-200',
                  });
                }

                if (insights.length === 0) return null;

                return (
                  <div className={`rounded-2xl border p-4 ${darkMode ? 'bg-white/5 border-white/10' : 'bg-white border-gray-100 shadow-sm'}`}>
                    <p className={`text-[10px] font-bold uppercase tracking-wider mb-3 flex items-center gap-1.5 ${darkMode ? 'text-white/65' : 'text-gray-400'}`}>
                      ✨ {dc(currentLanguage).akilli_icgoruler}
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
                const getDays = (sonTarih: string): number | null => {
                  const ms = zamanMs(sonTarih);
                  return ms === null ? null : Math.ceil((ms - Date.now()) / 86400000);
                };
                return (
                  <div className={cn('rounded-2xl border p-4', darkMode ? 'bg-white/5 border-white/10' : 'bg-amber-50/60 border-amber-200/60')}>
                    <div className="flex items-center justify-between mb-3">
                      <p className={cn('text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5', darkMode ? 'text-white/65' : 'text-amber-700')}>
                        <Receipt className="w-3.5 h-3.5" />
                        {dc(currentLanguage).yaklasan_vergi_tarihleri}
                      </p>
                      <button
                        onClick={() => setActiveTab('vergi')}
                        className="text-[10px] font-bold text-amber-600 hover:text-amber-800 transition-colors flex items-center gap-0.5"
                      >
                        {oc(currentLanguage).tumu} <ChevronRight className="w-3 h-3" />
                      </button>
                    </div>
                    <div className="space-y-2">
                      {dashVergiDeadlines.map(d => {
                        const days = getDays(d.sonTarih);
                        const isUrgent = days !== null && days <= 7;
                        const isCritical = days !== null && days <= 2;
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
                              <p className="text-[10px] text-gray-500">{tarihYaz(d.sonTarih)}</p>
                            </div>
                            <span className={cn(
                              'shrink-0 ml-2 text-[10px] font-black px-2 py-0.5 rounded-full',
                              isCritical ? 'bg-red-200 text-red-800' : isUrgent ? 'bg-orange-200 text-orange-800' : 'bg-amber-100 text-amber-700'
                            )}>
                              {days === null ? '—' : days === 0 ? (oc(currentLanguage).bugun_2) : `${days}g`}
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
                // Tutarı okunamayan sipariş ₺0 SAYILMAZ, SAYILIR; sapma rozeti ve ay sonu
                // projeksiyonu TÜRETME kapısından geçer (tek kayıt bile tutarsızsa hesaplanmaz,
                // '—' basılır — eskiden kısmi toplamdan "▲ %25" ve "Projeksiyon ₺X" üretiliyordu).
                // Ay sınırları / yuvarlamalar birebir korundu: utils/pano/ciroDonem → mtdKarsilastir.
                // `iptalHaric: false` PARİTE: bu panel iptal siparişleri bugün ciroya sayıyor
                // (yanındaki Phase 99 Satış Hedefi saymıyor — tutarsızlık açık iş olarak bildirildi).
                const mtd = mtdKarsilastir(orders, new Date(), { iptalHaric: false });
                return (
                  <div className={cn("rounded-2xl border p-5", darkMode ? "bg-white/5 border-white/10" : "bg-white border-gray-100 shadow-sm")}>
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <h3 className={cn("text-[10px] font-bold uppercase tracking-wider", darkMode ? "text-white/50" : "text-gray-400")}>
                          {dc(currentLanguage).bu_ay_ciro_mtd}
                        </h3>
                        <p className={cn("text-xl font-black mt-0.5", darkMode ? "text-white" : "text-gray-900")}>
                          {fmtKpi(mtd.ekran)}
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
                        {/* Rozet TÜRETMEDİR: iki dönemden biri bile tam bilinmiyorsa (ya da geçen ay
                            cirosu 0 ise) çizilmez. Eskiden yalnız rozet gizleniyor, "Geçen aya göre"
                            etiketi rakamsız yetim kalıyordu — kullanıcı karşılaştırmanın
                            hesaplanamadığını değil, ekranın bozulduğunu görüyordu. */}
                        {mtd.yuzde !== null ? (
                          <>
                            <span className={cn("text-sm font-black px-2 py-1 rounded-xl", mtd.yon === 'artis' ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600")}>
                              {mtd.yon === 'artis' ? '▲' : '▼'} {Math.abs(mtd.yuzde)}%
                            </span>
                            <p className={cn("text-[10px]", darkMode ? "text-white/65" : "text-gray-400")}>
                              {dc(currentLanguage).gecen_aya_gore}
                            </p>
                          </>
                        ) : (
                          <p className={cn("text-[10px] text-right", darkMode ? "text-white/65" : "text-gray-400")}>
                            {dc(currentLanguage).gecen_aya_gore_karsilastirma_hesaplanamadi}
                          </p>
                        )}
                      </div>
                    </div>
                    {/* Month progress bar */}
                    <div className="space-y-1">
                      <div className="flex justify-between text-[10px] text-gray-400">
                        <span>{dc(currentLanguage).ay_ilerlemesi}: {mtd.ayIlerlemesi}%</span>
                        <span>{dc(currentLanguage).projeksiyon}: {fmtKpi(mtd.projeksiyon)}</span>
                      </div>
                      <div className={cn("h-2 rounded-full overflow-hidden", darkMode ? "bg-white/10" : "bg-gray-100")}>
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-brand to-orange-400 transition-all duration-700"
                          style={{ width: `${mtd.ayIlerlemesi}%` }}
                        />
                      </div>
                      {/* Geçen ayda HİÇ kayıt yoksa satır çizilmez — '₺0' yazmak "geçen ay ciro
                          yoktu" iddiasıdır. Kayıt VARSA satır çizilir: hepsi tutarsızsa
                          `gecenAyEkran` NaN'dır ve fmtKpi '—' basar (eskiden `bilinen > 0`
                          kapısı bu hâli tümden gizliyordu, kullanıcı hiçbir şey göremiyordu). */}
                      {(mtd.gecenAy.bilinen > 0 || mtd.gecenAy.bilinmeyen > 0) && (
                        <div className="flex justify-between gap-2 text-[10px] text-gray-400">
                          <span>{dc(currentLanguage).gecen_ay}: {fmtKpi(mtd.gecenAyEkran)}</span>
                          {/* Geçen ayın kısmi toplamı da açıkça söylenir — bu sayacı modül zaten
                              döndürüyordu ama sayfa hiç basmıyordu (yarım düzeltme). */}
                          {mtd.gecenAy.bilinmeyen > 0 && (
                            <span className="text-amber-600 text-right">
                              {mtd.gecenAy.bilinmeyen} {dc(currentLanguage).kaydin_tutari_okunamadi_kismi_toplam}
                            </span>
                          )}
                        </div>
                      )}
                      {/* Kısmi toplam açıkça söylenir — sessizce eksik rakam gösterme (CLAUDE.md).
                          Bu ay / geçen ay AYRIK dönemler: iki not aynı kaydı iki kez saymaz. */}
                      {mtd.buAy.bilinmeyen > 0 && (
                        <p className="text-[10px] text-amber-600">
                          {mtd.buAy.bilinmeyen} {dc(currentLanguage).kaydin_tutari_okunamadi_kismi_toplam}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* ── Phase 99: Monthly Sales Target (Satış Hedefi) ── */}
              {(() => {
                const now = new Date();
                const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
                const ay99 = donemCirosu(orders, thisMonthStart);
                const hedef99 = hedefGerceklesme(ay99.ciro, monthlyTarget);
                const pct99 = hedef99.oranYuzde;   // null = hedef yok YA DA ciroda tutarsız kayıt var → '—', çubuk çizilmez
                const barColor99 = pct99 === null ? 'bg-gray-200' : pct99 >= 100 ? 'bg-emerald-400' : pct99 >= 70 ? 'bg-brand' : pct99 >= 40 ? 'bg-amber-400' : 'bg-red-400';
                // FORM KAPISI: `Number('') === 0` / `Number('abc') === NaN` tuzağı — geçersiz hedef DB'ye yazılmaz.
                // Düz fonksiyon (bileşen DEĞİL): render içinde bileşen tanımlanırsa her render'da yeniden bağlanır.
                const hedefKaydet99 = () => {
                  const girdi = hedefGirdisi(targetDraft);
                  if (girdi.durum === 'gecersiz') {
                    toast(dc(currentLanguage).hedefi_yalniz_rakamla_yazin_or_2500000_sifirdan_, 'error');
                    return;
                  }
                  saveMonthlyTarget(bugunAnahtari().slice(0, 7), girdi.durum === 'temizle' ? 0 : girdi.deger);
                  setIsEditingTarget(false);
                };
                return (
                  <div className={cn("rounded-2xl border p-5", darkMode ? "bg-white/5 border-white/10" : "bg-white border-gray-100 shadow-sm")}>
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <h3 className={cn("text-[10px] font-bold uppercase tracking-wider", darkMode ? "text-white/50" : "text-gray-400")}>
                          {dc(currentLanguage).bu_ay_satis_hedefi}
                        </h3>
                        {isEditingTarget ? (
                          <div className="flex items-center gap-2 mt-1">
                            <input
                              autoFocus
                              // `type="number"` DEĞİL: tarayıcı çözemediği metni '' yapar, '' ise "hedefi sil"dir
                              // (bkz. hedefGirdisi). Ham metin kapıya ulaşsın diye düz metin + sayısal klavye.
                              type="text"
                              inputMode="numeric"
                              value={targetDraft}
                              onChange={e => setTargetDraft(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === 'Enter') hedefKaydet99();
                                if (e.key === 'Escape') setIsEditingTarget(false);
                              }}
                              className="text-sm font-bold bg-gray-100 rounded-lg px-2 py-1 outline-none w-36"
                              placeholder="0"
                            />
                            <button onClick={hedefKaydet99}
                              className="text-[10px] bg-brand text-white px-2 py-1 rounded-lg font-bold">{oc(currentLanguage).kaydet}</button>
                            <button onClick={() => setIsEditingTarget(false)} className="text-[10px] text-gray-400 hover:text-gray-600">{oc(currentLanguage).iptal}</button>
                          </div>
                        ) : (
                          <button onClick={() => { setTargetDraft(hedefOnDoldur(hedef99.hedef)); setIsEditingTarget(true); }}
                            className="flex items-center gap-1 mt-0.5 group">
                            <p className={cn("text-xl font-black", darkMode ? "text-white" : "text-gray-900")}>
                              {hedef99.hedef !== null ? fmtKpi(hedef99.hedef) : (dc(currentLanguage).hedef_belirle)}
                            </p>
                            <span className="text-gray-300 group-hover:text-brand transition-colors text-[10px]">✎</span>
                          </button>
                        )}
                      </div>
                      <div className="text-right">
                        <p className={`text-2xl font-black ${pct99 === null ? 'text-gray-400' : pct99 >= 100 ? 'text-emerald-600' : pct99 >= 70 ? 'text-brand' : pct99 >= 40 ? 'text-amber-600' : 'text-red-500'}`}>{pct99 === null ? '—' : `${pct99}%`}</p>
                        <p className={cn("text-[10px]", darkMode ? "text-white/65" : "text-gray-400")}>
                          {fmtKpi(hedef99.ekran)} {dc(currentLanguage).gerceklesti}
                          {hedef99.bilinmeyen > 0 && (currentLanguage === 'tr' ? ` · ${hedef99.bilinmeyen} kayıt tutarsız` : ` · ${hedef99.bilinmeyen} record(s) unpriced`)}
                        </p>
                      </div>
                    </div>
                    <div className={cn("h-2.5 rounded-full overflow-hidden", darkMode ? "bg-white/10" : "bg-gray-100")}>
                      {pct99 !== null && <div className={`h-full rounded-full transition-all duration-700 ${barColor99}`} style={{ width: `${Math.min(pct99, 100)}%` }} />}
                    </div>
                    <div className="flex justify-between mt-1.5">
                      <span className={cn("text-[10px]", darkMode ? "text-white/60" : "text-gray-400")}>0</span>
                      {pct99 !== null && pct99 >= 100 && <span className="text-[10px] font-bold text-emerald-600">🎯 {dc(currentLanguage).hedefe_ulasildi}</span>}
                      <span className={cn("text-[10px]", darkMode ? "text-white/60" : "text-gray-400")}>{hedef99.hedef !== null ? fmtKpi(hedef99.hedef) : '—'}</span>
                    </div>
                  </div>
                );
              })()}

              {/* ── Phase 174: Sales vs Budget – Last 3 Months ── */}
              {monthlyTarget > 0 && orders.length > 0 && (() => {
                const now174 = new Date();
                const months174 = butceKarsilastir(Array.from({ length: 3 }, (_, i) => {
                  const d = new Date(now174.getFullYear(), now174.getMonth() - (2 - i), 1);
                  return {
                    etiket: tarihYaz(d, { month: 'short' }, currentLanguage === 'tr' ? 'tr' : 'en'),
                    // PARİTE: Phase 174 yalnız `createdAt` okur (ayCirosu varsayılanı tarihYedegi=false).
                    ciro: ayCirosu(orders, ayAnahtari(d) ?? '').ciro,
                    hedef: monthlyTarget,   // sayfadaki mevcut davranış: üç aya da İÇİNDE BULUNULAN AYIN hedefi (bkz. açık sorular)
                  };
                }));
                return (
                  <div className={cn("rounded-2xl border p-5", darkMode ? "bg-white/5 border-white/10" : "bg-white border-gray-100 shadow-sm")}>
                    <h3 className={cn("text-[10px] font-bold uppercase tracking-wider mb-3", darkMode ? "text-white/50" : "text-gray-400")}>
                      {dc(currentLanguage).satis_butce_3_ay}
                    </h3>
                    <div className="flex items-end gap-4 h-20">
                      {months174.map((m, i) => {
                        const pct = m.oranYuzde;
                        const h = pct === null ? null : Math.min(pct, 120);
                        const barCls = pct === null ? 'bg-gray-200' : pct >= 100 ? 'bg-emerald-400' : pct >= 70 ? 'bg-amber-400' : 'bg-red-400';
                        return (
                          <div key={i} className="flex-1 flex flex-col items-center gap-1">
                            <div className="w-full flex flex-col justify-end relative" style={{ height: '60px' }}>
                              {h !== null && <div className={`w-full rounded-t-lg transition-all ${barCls}`} style={{ height: `${Math.max(h * 0.5, 4)}%` }} />}
                              <div className="absolute bottom-0 w-full border-t-2 border-dashed border-gray-300" style={{ bottom: '50%' }} />
                            </div>
                            <span className="text-[9px] text-gray-400">{m.etiket}</span>
                            <span className={`text-[9px] font-bold ${pct === null ? 'text-gray-400' : pct >= 100 ? 'text-emerald-600' : pct >= 70 ? 'text-amber-600' : 'text-red-500'}`}
                              title={m.bilinmeyen > 0 ? (currentLanguage === 'tr' ? `${m.bilinmeyen} kaydın tutarı okunamadı` : `${m.bilinmeyen} record(s) unpriced`) : undefined}>
                              {pct === null ? '—' : `%${pct}`}</span>
                          </div>
                        );
                      })}
                    </div>
                    <p className="text-[10px] text-gray-400 mt-1 text-center">{dc(currentLanguage).kesikli_cizgi_hedef}</p>
                  </div>
                );
              })()}

              {/* ── Phase 42: Financial KPI mini-strip ── */}
              {(() => {
                // SAHTE KESİNLİK YOK (utils/pano/finansKpi): AOV'de tutarı okunamayan sipariş paydaya
                // girmez (eski hâli her tutarsız kaydı ₺0'lık sipariş sanıp ortalamayı aşağı çekiyordu);
                // liste boşken oran 0 DEĞİL null ('—'); adı olmayan siparişler "undefined" kovasında
                // birikip sahte "tekrar eden alıcı" üretmez.
                const kpi42 = finansKpilari({ filtreliSiparisler: filteredOrders, siparisler: orders, adaylar: leads });
                const aov = kpi42.aov, teslimat = kpi42.teslimat, donusum = kpi42.donusum, tekrar = kpi42.tekrarAlici;
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
                        {fmtKpi(aov.deger)}
                      </p>
                      {aov.bilinmeyen > 0 && (
                        <p className="text-[10px] text-amber-600 mt-0.5">
                          {aov.bilinmeyen} {dc(currentLanguage).kaydin_tutari_okunamadi_ortalamaya_girmedi}
                        </p>
                      )}
                      <p className="text-[10px] font-semibold text-gray-500 mt-1">{dc(currentLanguage).ort_siparis_degeri}</p>
                      <p className="text-[10px] text-gray-400">AOV</p>
                    </div>

                    {/* ── Remaining plain KPI cards ── */}
                    {[
                      {
                        label: dc(currentLanguage).teslimat_orani,
                        value: teslimat.oran === null ? '—' : `${teslimat.oran}%`,
                        // Durumu okunamayan sipariş paydaya GİRMEZ — payda `orders.length`ten azsa söylenir.
                        sub: teslimat.durumsuz > 0
                          ? `${teslimat.pay} / ${teslimat.payda} · ${teslimat.durumsuz} ${dc(currentLanguage).durumsuz}`
                          : `${teslimat.pay} / ${teslimat.payda}`,
                        icon: CheckCircle2,
                        color: teslimat.oran === null ? 'text-gray-400' : teslimat.oran > 80 ? 'text-emerald-600' : 'text-amber-600',
                        bg: teslimat.oran === null ? 'bg-gray-50' : teslimat.oran > 80 ? 'bg-emerald-50' : 'bg-amber-50',
                        onClick: () => setActiveTab('orders'),
                      },
                      {
                        label: dc(currentLanguage).musteri_donusumu,
                        value: donusum.oran === null ? '—' : `${donusum.oran}%`,
                        sub: donusum.durumsuz > 0
                          ? `${donusum.kazanilan} ${dc(currentLanguage).kazanildi} · ${donusum.durumsuz} ${dc(currentLanguage).durumsuz}`
                          : `${donusum.kazanilan} ${dc(currentLanguage).kazanildi}`,
                        icon: TrendingUp,
                        color: donusum.oran === null ? 'text-gray-400' : donusum.oran > 20 ? 'text-blue-600' : 'text-gray-400',
                        bg: donusum.oran === null ? 'bg-gray-50' : donusum.oran > 20 ? 'bg-blue-50' : 'bg-gray-50',
                        onClick: () => setActiveTab('crm'),
                      },
                      {
                        label: dc(currentLanguage).tekrar_eden_alici,
                        value: tekrar.tekrarEden,
                        sub: tekrar.isimsiz > 0
                          ? (currentLanguage === 'tr' ? `${tekrar.isimsiz} siparişte müşteri adı yok` : `${tekrar.isimsiz} order(s) without customer name`)
                          : (dc(currentLanguage).birden_fazla_siparis),
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
                // SAHTE ALARM YOK (utils/pano/finansKpi): değeri BİLİNMEYEN KPI için uyarı üretilmez
                // ("0 < eşik" diye alarm çalmaz), "veri yok" diye listelenir. Stok seviyesi ya da eşiği
                // okunamayan ürün "kritik stok" SAYILMAZ (eski `(i.stockLevel ?? 0) <= (… ?? 5)`).
                const tr124 = currentLanguage === 'tr';
                const stok124 = stokDurumu(inventory);
                const gecikme124 = gecikmisOdemeler(orders, { simdi: Date.now(), gun: 30 });
                const siniflanamayan124 = stok124.seviyesiBilinmeyen + stok124.esigiBilinmeyen;
                const esik124 = esikUyarilari(
                  {
                    // Hiçbir ürün sınıflandırılamadıysa sayı 0 DEĞİL, BİLİNMİYOR.
                    kritikStok: inventory.length > 0 && siniflanamayan124 === inventory.length ? null : stok124.esikAltinda.length,
                    gecikmisOdeme: gecikme124.sayi,
                    fiyatOnayi: priceOverrides.filter(p => p.status === 'pending').length,
                    izinTalebi: leaveRequests.filter(l => l.status === 'pending').length,
                  },
                  [
                    { id: 'kritikStok',    esik: 0, yon: 'ustunde', seviye: 'uyari'  },
                    { id: 'gecikmisOdeme', esik: 0, yon: 'ustunde', seviye: 'kritik' },
                    { id: 'fiyatOnayi',    esik: 0, yon: 'ustunde', seviye: 'uyari'  },
                    { id: 'izinTalebi',    esik: 0, yon: 'ustunde', seviye: 'uyari'  },
                  ],
                );
                const metin124: Record<string, { icon: string; mesaj: (n: number) => string; etiket: string }> = {
                  kritikStok:    { icon: '📦', etiket: dc(tr124).kritik_stok,     mesaj: n => tr124 ? `${n} ürün kritik stok seviyesinde` : `${n} products at critical stock level` },
                  gecikmisOdeme: { icon: '💳', etiket: dc(tr124).gecikmis_odeme, mesaj: n => tr124 ? `${n} siparişin ödemesi 30+ gün gecikmiş` : `${n} orders have payment overdue 30+ days` },
                  fiyatOnayi:    { icon: '🏷️', etiket: dc(tr124).fiyat_onayi,    mesaj: n => tr124 ? `${n} fiyat onay talebi bekliyor` : `${n} price override requests pending` },
                  izinTalebi:    { icon: '📅', etiket: dc(tr124).izin_talebi,      mesaj: n => tr124 ? `${n} izin talebi onay bekliyor` : `${n} leave requests awaiting approval` },
                };
                const alerts125: Array<{ level: 'warn' | 'danger'; icon: string; message: string }> =
                  esik124.uyarilar.map(u => ({
                    level: (u.seviye === 'kritik' ? 'danger' : 'warn') as 'warn' | 'danger',
                    icon: metin124[u.id].icon,
                    message: metin124[u.id].mesaj(u.deger),
                  }));
                if (esik124.veriYok.length > 0) alerts125.push({ level: 'warn', icon: '❔',
                  message: tr124
                    ? `Veri yok: ${esik124.veriYok.map(id => metin124[id].etiket).join(', ')} — uyarı üretilemedi`
                    : `No data: ${esik124.veriYok.map(id => metin124[id].etiket).join(', ')} — no alert computed` });
                if (siniflanamayan124 > 0 && !esik124.veriYok.includes('kritikStok')) alerts125.push({ level: 'warn', icon: '❔',
                  message: tr124
                    ? `${siniflanamayan124} ürünün stok/eşik bilgisi okunamadı — kritik stok sayısı kısmi`
                    : `${siniflanamayan124} product(s) with unreadable stock/threshold — count is partial` });
                if (gecikme124.tarihsiz > 0) alerts125.push({ level: 'warn', icon: '❔',
                  message: tr124
                    ? `${gecikme124.tarihsiz} ödenmemiş siparişin tarihi okunamadı — gecikme hesaplanamıyor`
                    : `${gecikme124.tarihsiz} unpaid order(s) with unreadable date — overdue not computable` });
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
                            {dc(currentLanguage).tumunu_gor}
                          </button>
                        )}
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${a.level === 'danger' ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800'}`}>
                          {a.level === 'danger' ? (oc(currentLanguage).kritik) : (oc(currentLanguage).uyari)}
                        </span>
                      </div>
                    ))}
                  </div>
                );
              })()}

              {/* ── Phase 130: Daily Cash Position ── */}
              {orders.length > 0 && (() => {
                const today130 = new Date();
                const todayStr = bugunAnahtari(today130);
                // SAHTE ₺0 YOK (utils/pano/finansKpi): tutarı okunamayan sipariş toplama GİRMEZ, SAYILIR;
                // hiç bilinen tutar yoksa kart '—' basar (eski `(o.totalPrice || 0)` kısmi toplamı kesin
                // rakam gibi gösteriyordu). `nakitPozisyonu` günü YEREL 'YYYY-MM-DD' anahtarıyla seçer.
                const nakit130 = nakitPozisyonu(orders, { gun: todayStr });
                // BENZERSİZ sayaç: iki sayacı TOPLAMA — bugünkü ciro ile açık alacak kümeleri
                // kesişir (bugün açılan sipariş çoğu zaman ödenmemiştir) ve tek kayıt "2 kayıt"
                // diye raporlanıyordu (Faz 3 5/n hakem bulgusu).
                const tutarsiz130 = nakit130.tutarsizKayit;
                return (
                  <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-5">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <span className="text-base">💵</span>
                        <div>
                          <h3 className="text-sm font-bold text-gray-800">{dc(currentLanguage).gunluk_nakit_pozisyonu}</h3>
                          <p className="text-[10px] text-gray-400">{tarihYaz(today130, { weekday: 'long', day: 'numeric', month: 'long' }, currentLanguage === 'tr' ? 'tr' : 'en')}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-2xl font-black text-emerald-600">{fmtKpi(nakit130.ekran.bugunTahsil)}</p>
                        <p className="text-[10px] text-gray-400">{dc(currentLanguage).bugun_tahsil}</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      {[
                        { label: dc(currentLanguage).bugun_ciro, val: nakit130.ekran.bugunCiro, color: 'text-gray-800' },
                        { label: dc(currentLanguage).bugun_tahsil_2, val: nakit130.ekran.bugunTahsil, color: 'text-emerald-600' },
                        { label: oc(currentLanguage).toplam_alacak, val: nakit130.ekran.toplamAlacak, color: 'text-amber-600' },
                      ].map(c => (
                        <div key={c.label} className="text-center bg-gray-50 rounded-xl p-3">
                          <p className={`text-base font-bold ${c.color}`}>{fmtKpi(c.val)}</p>
                          <p className="text-[9px] text-gray-400 leading-tight mt-0.5">{c.label}</p>
                        </div>
                      ))}
                    </div>
                    {tutarsiz130 > 0 && (
                      <p className="text-[10px] text-amber-600 mt-2 text-center">
                        {tutarsiz130} {dc(currentLanguage).kaydin_tutari_okunamadi_kismi_toplam}
                      </p>
                    )}
                  </div>
                );
              })()}

              {/* ── Phase 159: Sales Velocity (Revenue per Working Day) ── */}
              {orders.length > 0 && (() => {
                const now159 = new Date();
                // Last 30 days revenue vs prior 30 days
                const d30ago = new Date(now159); d30ago.setDate(d30ago.getDate() - 30);
                const d60ago = new Date(now159); d60ago.setDate(d60ago.getDate() - 60);
                const son30 = donemCirosu(orders, d30ago);
                const onceki30 = donemCirosu(orders, d60ago, d30ago);   // [d60ago, d30ago) — yarı açık, eski koşulun aynısı
                const hiz30 = satisHizi(son30.ciro, 30);                // bölen TAKVİM günü (panel başlığı 'working day' diyor — bkz. açık sorular)
                const velocityChange = hizDegisimi(hiz30.gunluk, satisHizi(onceki30.ciro, 30).gunluk);
                // Weekly sparkline (last 8 weeks)
                const weeks = haftalikCiro(orders, now159);
                const maxWeek = enBuyukHafta(weeks);   // null = hiç bilinen değer yok → çubuk çizilmez ('Math.max(..., 1)' sahte ölçeği kalktı)
                // Tek kaynak (2026-09-05): kur cevirisi + bicim tlYaz'da (kur yoksa '—').
                // Eskiden calisma zamani yereliyle (`toLocaleString(undefined)`) basiyordu;
                // artik birime gore yerel gruplama (TRY -> ₺1.234, USD -> $1,234).
                const f159 = (v: number) => tlYaz(v, { birim: kpiCurrency, rates: exchangeRates, ondalik: 0 });
                return (
                  <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-5">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <h3 className="text-sm font-bold text-gray-800">{dc(currentLanguage).satis_hizi}</h3>
                        <p className="text-[10px] text-gray-400">{dc(currentLanguage).gunluk_ortalama_ciro_son_30_gun}</p>
                      </div>
                      {velocityChange !== null && (
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${velocityChange >= 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                          {velocityChange >= 0 ? '↑' : '↓'}{Math.abs(velocityChange)}% vs {dc(currentLanguage).onceki_30g}
                        </span>
                      )}
                    </div>
                    <p className="text-3xl font-black text-brand mb-3">{hiz30.gunluk === null ? '—' : f159(hiz30.gunluk)}<span className="text-sm font-normal text-gray-400">/{dc(currentLanguage).gun}</span></p>
                    {hiz30.bilinmeyen > 0 && (
                      <p className="text-[10px] text-amber-600 -mt-2 mb-2">
                        {currentLanguage === 'tr' ? `${hiz30.bilinmeyen} siparişin tutarı okunamadı — günlük hız hesaplanamıyor` : `${hiz30.bilinmeyen} order(s) unpriced — daily velocity unavailable`}
                      </p>
                    )}
                    <div className="flex items-end gap-0.5 h-10">
                      {weeks.map((w, i) => (
                        <div key={i} className="flex-1 flex flex-col justify-end">
                          {w.deger !== null && maxWeek !== null && (
                            <div className={`w-full rounded-sm transition-all ${i === 7 ? 'bg-brand' : 'bg-brand/25'}`}
                              style={{ height: `${Math.max(Math.round((w.deger / maxWeek) * 100), 4)}%` }} />
                          )}
                        </div>
                      ))}
                    </div>
                    <p className="text-[9px] text-gray-400 mt-1 text-right">{dc(currentLanguage).son_8_hafta}</p>
                  </div>
                );
              })()}

              {/* ── Phase 539: Shipments Mini-Widget ── */}
              {shipments.length > 0 && (() => {
                const todayStr539 = bugunAnahtari();
                const inTransit  = shipments.filter(s => s.status === 'In Transit').length;
                const pending539 = shipments.filter(s => s.status === 'Pending').length;
                const delivToday = shipments.filter(s => {
                  if (s.status !== 'Delivered') return false;
                  const raw = (s as unknown as Record<string, unknown>).updatedAt ?? (s as unknown as Record<string, unknown>).date;
                  return gunAnahtari(raw) === todayStr539;
                }).length;
                // Tarihi bilinmeyen kayıt epoch (0) DEĞİL: `sayiSirala` onu HER İKİ yönde sona koyar
                // (eski `?? 0` yalnız azalan yönde doğruydu; yön çevrilse sessizce başa geçerdi).
                // `Shipment` tipinde `createdAt` alanı YOK (DB kaydında var, sayfa onu zaten
                // cast'leyerek okuyordu) — `as any` yerine GERÇEK yüzeyi ekleyen bir kesişimle
                // geçiliyor, böylece listenin `id`/`status`/`customerName` alanları tipli kalıyor.
                const recent539 = sonSevkiyatlar<Shipment & { createdAt?: unknown }>(shipments, 5);
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
                          <h3 className="text-sm font-bold text-gray-800">{dc(currentLanguage).sevkiyat_durumu}</h3>
                          <p className="text-[10px] text-gray-400">{shipments.length} {dc(currentLanguage).toplam_sevkiyat}</p>
                        </div>
                      </div>
                      <button
                        onClick={() => setShipmentsExpanded(e => !e)}
                        className="text-[10px] font-bold text-gray-400 hover:text-brand transition-colors flex items-center gap-1"
                      >
                        {shipmentsExpanded ? (oc(currentLanguage).gizle) : (dc(currentLanguage).detaylar)}
                        <ChevronDown className={cn("w-3 h-3 transition-transform", shipmentsExpanded && "rotate-180")} />
                      </button>
                    </div>
                    <div className="grid grid-cols-3 gap-3 mb-3">
                      {[
                        { label: oc(currentLanguage).yolda,   value: inTransit,  color: 'text-blue-600',    bg: 'bg-blue-50' },
                        { label: oc(currentLanguage).bekliyor,       value: pending539, color: 'text-amber-600',   bg: 'bg-amber-50' },
                        { label: dc(currentLanguage).bugun_teslim, value: delivToday, color: 'text-emerald-600', bg: 'bg-emerald-50' },
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
                          {dc(currentLanguage).tum_sevkiyatlar}
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
                        <span className="text-xs font-bold text-gray-500 uppercase truncate">{dc(currentLanguage).e_belge}</span>
                      </div>
                      <p className="text-xl font-bold text-gray-900 mt-auto">
                        {gibConnected
                          ? (dc(currentLanguage).gib_bagli)
                          : (dc(currentLanguage).gib_bagli_degil)}
                      </p>
                      <p className="text-[10px] text-gray-400 mt-0.5 truncate">{dc(currentLanguage).e_fatura_e_arsiv_e_irsaliye}</p>
                      <div className="flex items-center gap-1 mt-1.5">
                        <span className={`w-1.5 h-1.5 rounded-full ${gibConnected ? 'bg-green-500 animate-pulse' : 'bg-red-400'}`} />
                        <span className={`text-[10px] font-semibold ${gibConnected ? 'text-green-600' : 'text-red-500'}`}>
                          {gibConnected ? (oc(currentLanguage).aktif) : (dc(currentLanguage).bagli_degil)}
                        </span>
                      </div>
                    </button>

                    {/* Kasa balance */}
                    <button onClick={() => setActiveTab('muhasebe')} className="apple-card p-4 text-left hover:shadow-md hover:scale-[1.01] transition-all group flex flex-col min-h-[120px]">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="w-7 h-7 rounded-lg bg-emerald-50 flex items-center justify-center flex-shrink-0">
                          <Wallet className="w-3.5 h-3.5 text-emerald-600" />
                        </div>
                        <span className="text-xs font-bold text-gray-500 uppercase truncate">{dc(currentLanguage).kasa}</span>
                      </div>
                      <p className="text-xl font-bold text-gray-900 mt-auto">
                        {dc(currentLanguage).kasa_yonetimi}
                      </p>
                      <p className="text-[10px] text-gray-400 mt-0.5 truncate">{dc(currentLanguage).gunluk_kapanis_ve_hareketler}</p>
                      <p className="text-[10px] text-brand mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5">
                        <ChevronRight className="w-3 h-3" />{dc(currentLanguage).kasaya_git}
                      </p>
                    </button>

                    {/* Vergi Takvimi — overdue count */}
                    <button onClick={() => setActiveTab('vergi')} className="apple-card p-4 text-left hover:shadow-md hover:scale-[1.01] transition-all group flex flex-col min-h-[120px]">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="w-7 h-7 rounded-lg bg-amber-50 flex items-center justify-center flex-shrink-0">
                          <Receipt className="w-3.5 h-3.5 text-amber-600" />
                        </div>
                        <span className="text-xs font-bold text-gray-500 uppercase truncate">{oc(currentLanguage).vergi_takvimi}</span>
                      </div>
                      <p className="text-xl font-bold text-gray-900 mt-auto">
                        {dc(currentLanguage).beyanname_takibi}
                      </p>
                      <p className="text-[10px] text-gray-400 mt-0.5 truncate">{dc(currentLanguage).kdv_muhtasar_sgk_gecici_vergi}</p>
                      <p className="text-[10px] text-brand mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5">
                        <ChevronRight className="w-3 h-3" />{dc(currentLanguage).takvimi_gor}
                      </p>
                    </button>

                    {/* Bakım — upcoming */}
                    <button onClick={() => setActiveTab('bakim')} className="apple-card p-4 text-left hover:shadow-md hover:scale-[1.01] transition-all group flex flex-col min-h-[120px]">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="w-7 h-7 rounded-lg bg-orange-50 flex items-center justify-center flex-shrink-0">
                          <Wrench className="w-3.5 h-3.5 text-orange-600" />
                        </div>
                        <span className="text-xs font-bold text-gray-500 uppercase truncate">{dc(currentLanguage).bakim}</span>
                      </div>
                      <p className="text-xl font-bold text-gray-900 mt-auto">
                        {dc(currentLanguage).ekipman_bakimi}
                      </p>
                      <p className="text-[10px] text-gray-400 mt-0.5 truncate">{dc(currentLanguage).onleyici_duzeltici_acil_is_emirleri}</p>
                      <p className="text-[10px] text-brand mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5">
                        <ChevronRight className="w-3 h-3" />{dc(currentLanguage).is_emirlerine_git}
                      </p>
                    </button>
                  </div>
                );
              })()}

              {/* ── Phase 160: Customer Payment Behavior ── */}
              {orders.filter(o => o.paid).length >= 3 && (() => {
                // SAHTE SIFIR KALDIRILDI (Faz 3 5/n): `+= o.totalPrice || 0` tutarı okunamayan
                // siparişi ₺0 sayıyordu — müşteri "hiç ödememiş" gibi listenin dibine düşüyor,
                // "Ödenmemiş Alacak" kartı da gerçekte olduğundan küçük görünüyordu. Sıralama da
                // `b.totalPaid - a.totalPaid` idi; bilinmeyen artık HER İKİ yönde de sonda.
                // Hesap: src/utils/pano/musteriAnaliz.ts (saf + testli). İptal filtresi ve
                // `odemeTakipli` kapısı modülün İÇİNDE, eski blokla birebir.
                const p160 = odemeDavranisi(orders, 5);
                const topPayers = p160.odeyenler;
                const topDebtors = p160.borclular;
                // Tek kaynak — f159 ile ayni: tlYaz (kur yoksa '—').
                const f160 = (v: number) => tlYaz(v, { birim: kpiCurrency, rates: exchangeRates, ondalik: 0 });
                return (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-4">
                      <h4 className="text-xs font-bold text-emerald-700 uppercase tracking-wide mb-3">✓ {dc(currentLanguage).en_cok_odeme_yapanlar}</h4>
                      <div className="space-y-2">
                        {topPayers.map((c, i) => (
                          <div key={i} className="flex items-center justify-between">
                            <span className="text-xs text-gray-700 truncate">{c.ad ?? '—'}</span>
                            <span className="text-xs font-bold text-emerald-600 shrink-0 ml-2">{f160(c.tutar)}</span>
                          </div>
                        ))}
                        {p160.odeyenTutarsiz > 0 && (
                          <p className="text-[10px] text-gray-400 pt-1">
                            {currentLanguage === 'tr'
                              ? `${p160.odeyenTutarsiz} kaydın tutarı bilinmiyor — toplama dâhil değil.`
                              : `${p160.odeyenTutarsiz} record(s) have no amount — excluded from the total.`}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="bg-white border border-amber-100 rounded-2xl shadow-sm p-4">
                      <h4 className="text-xs font-bold text-amber-700 uppercase tracking-wide mb-3">⚠ {dc(currentLanguage).odenmemis_alacak}</h4>
                      <div className="space-y-2">
                        {topDebtors.length === 0 ? (
                          <p className="text-xs text-gray-400 text-center py-2">{dc(currentLanguage).bekleyen_alacak_yok}</p>
                        ) : topDebtors.map((c, i) => (
                          <div key={i} className="flex items-center justify-between">
                            <span className="text-xs text-gray-700 truncate">{c.ad ?? '—'}</span>
                            <span className="text-xs font-bold text-amber-600 shrink-0 ml-2">{f160(c.tutar)}</span>
                          </div>
                        ))}
                        {p160.borcluTutarsiz > 0 && (
                          <p className="text-[10px] text-gray-400 pt-1">
                            {currentLanguage === 'tr'
                              ? `${p160.borcluTutarsiz} kaydın tutarı bilinmiyor — toplama dâhil değil.`
                              : `${p160.borcluTutarsiz} record(s) have no amount — excluded from the total.`}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* ── Phase 103: 6-Month Revenue Bar Chart ── */}
              {orders.length > 0 && (() => {
                // Tutarı okunamayan sipariş ₺0 SAYILMAZ; bilinmeyen ay ölçeğe girmez (eski
                // `Math.max(...rev, 1)` tek bir NaN'la BÜTÜN çubuk yüksekliklerini NaN yapıyordu).
                // `iptalHaric: true` PARİTE: bu çubuk iptal siparişleri bugün de dışlıyor.
                const data103 = aylikCiro(orders, 6, new Date(), { iptalHaric: true }, currentLanguage === 'tr' ? 'tr' : 'en');
                const maxRev103 = olcekTavani(data103);
                return (
                  <div className={cn("rounded-2xl border p-5", darkMode ? "bg-white/5 border-white/10" : "bg-white border-gray-100 shadow-sm")}>
                    <div className="flex items-center justify-between mb-4">
                      <h3 className={cn("text-[10px] font-bold uppercase tracking-wider flex items-center gap-2", darkMode ? "text-white/50" : "text-gray-400")}>
                        <BarChart3 className="w-3.5 h-3.5" />
                        {dc(currentLanguage).son_6_ay_ciro}
                      </h3>
                    </div>
                    <div className="flex items-end gap-2 h-28">
                      {data103.map((m, i) => {
                        // Tutarı hiç bilinmeyen ay (`grafik === null`): GRİ taban çubuğu — sıfır
                        // yükseklikte marka rengiyle çizmek "o ay ciro yoktu" demekti (sahte
                        // kesinlik; sparkline ile aynı kural). Yerel değişken daraltma içindir.
                        const deger = m.grafik;
                        const h = deger === null ? 4 : Math.max((deger / maxRev103) * 100, deger > 0 ? 4 : 0);
                        const isCurrentMonth = i === 5;
                        return (
                          <div key={i} className="flex-1 flex flex-col items-center justify-end gap-1">
                            <div
                              title={`${fmtKpi(m.ekran)}${m.tutar.bilinmeyen > 0 ? (currentLanguage === 'tr' ? ` · ${m.tutar.bilinmeyen} kaydın tutarı okunamadı` : ` · ${m.tutar.bilinmeyen} record(s) unpriced`) : ''}`}
                              className={`w-full rounded-t-lg transition-all duration-700 ${deger === null ? 'bg-gray-300' : isCurrentMonth ? 'bg-brand' : darkMode ? 'bg-white/20 hover:bg-white/30' : 'bg-gray-200 hover:bg-gray-300'}`}
                              style={{ height: `${h}%`, minHeight: deger === null || deger > 0 ? '4px' : '0' }}
                            />
                            <span className={cn("text-[9px] font-bold", isCurrentMonth ? 'text-brand' : darkMode ? 'text-white/65' : 'text-gray-400')}>{m.etiket}</span>
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
                // Durumu eksik/tanınmayan sipariş eskiden çubuktan SESSİZCE düşüyordu: 5 dilim
                // toplamı %100'e ulaşmıyordu ve kullanıcı eksiği göremiyordu. `diger` onu SAYAR.
                const dagilim43 = durumDagilimi(orders, PANO_DURUMLARI);
                const counts = statusConfig.map(s => ({ ...s, count: dagilim43.sayilar[s.key] }));
                return (
                  <div className={cn("rounded-2xl border p-5 space-y-3", darkMode ? "bg-white/5 border-white/10" : "bg-white border-gray-100 shadow-sm")}>
                    <div className="flex items-center justify-between">
                      <h3 className={cn("text-[10px] font-bold uppercase tracking-wider", darkMode ? "text-white/50" : "text-gray-400")}>
                        {oc(currentLanguage).siparis_durumu}
                      </h3>
                      <button onClick={() => setActiveTab('orders')} className="text-[10px] font-semibold text-brand hover:underline">
                        {dc(currentLanguage).tumunu_gor_2}
                      </button>
                    </div>
                    {/* Segmented bar */}
                    <div className="flex h-3 rounded-full overflow-hidden gap-0.5">
                      {counts.filter(s => s.count > 0).map(s => {
                        const pay = oranYuzde(s.count, dagilim43.toplam);
                        if (pay === null) return null;   // toplam 0 — genişlik UYDURULMAZ
                        return (
                          <div
                            key={s.key}
                            className={`${s.color} transition-all duration-700 first:rounded-l-full last:rounded-r-full`}
                            style={{ width: `${pay}%` }}
                            title={`${s.key}: ${s.count}`}
                          />
                        );
                      })}
                      {dagilim43.diger > 0 && (() => {
                        const pay = oranYuzde(dagilim43.diger, dagilim43.toplam);
                        return pay === null ? null : (
                          <div
                            className="bg-gray-200 transition-all duration-700 last:rounded-r-full"
                            style={{ width: `${pay}%` }}
                            title={currentLanguage === 'tr' ? `Durumu bilinmeyen: ${dagilim43.diger}` : `Unknown status: ${dagilim43.diger}`}
                          />
                        );
                      })()}
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
                      {dagilim43.diger > 0 && (
                        <span className={cn("flex items-center gap-1.5 text-[11px]", darkMode ? "text-white/60" : "text-gray-500")}>
                          <span className="w-2 h-2 rounded-full bg-gray-200 flex-shrink-0" />
                          {dc(currentLanguage).durumu_bilinmeyen}
                          <span className={cn("font-bold", darkMode ? "text-white/80" : "text-gray-800")}>{dagilim43.diger}</span>
                        </span>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* ── Phase 79: B2B vs Retail Revenue Split ── */}
              {filteredOrders.length > 0 && (() => {
                // TARİH ARALIĞINA BAĞLANDI (2026-09-04): ham `orders` okunuyordu, yani
                // kart TÜM ZAMANLARIN oranını gösteriyordu — kullanıcı üstteki tarih
                // aralığını daraltsa bile pastanın dilimleri hiç değişmiyordu.
                // PAY YÜZDESİ TÜRETMEDİR (Faz 3 5/n): tutarı okunamayan tek bir sipariş bile varsa
                // toplam KISMİdir ve ondan çıkarılan "%100 B2B" sahte kesinliktir. `segmentCirosu`
                // (src/utils/pano/musteriAnaliz.ts, testli) o durumda yuzde=null döner → çubuk
                // ÇİZİLMEZ, yerine "N siparişin tutarı bilinmiyor" notu yazılır.
                const s79 = segmentCirosu(filteredOrders, b2bSegmenti, ['B2B', 'Diger']);
                const b2bSeg = s79.segmentler[0], perakendeSeg = s79.segmentler[1];
                const b2bRev = b2bSeg.ciro, retailRev = perakendeSeg.ciro;
                if (s79.toplam === 0) return null;   // gerçek ₺0 — eski davranış
                const b2bPct    = b2bSeg.yuzde === null ? null : Math.round(b2bSeg.yuzde);
                const retailPct = b2bPct === null ? null : 100 - b2bPct;   // eski parite: 100 - b2bPct
                return (
                  <div className={cn("rounded-2xl border p-5", darkMode ? "bg-white/5 border-white/10" : "bg-white border-gray-100 shadow-sm")}>
                    <div className="flex items-center justify-between mb-3">
                      <h3 className={cn("text-[10px] font-bold uppercase tracking-wider", darkMode ? "text-white/50" : "text-gray-400")}>
                        {dc(currentLanguage).b2b_vs_perakende_ciro}
                      </h3>
                    </div>
                    {/* Split bar — yüzde türetilemiyorsa ÇİZİLMEZ (kısmi toplamdan pay çıkmaz) */}
                    {b2bPct !== null && retailPct !== null ? (
                      <div className="flex h-3 rounded-full overflow-hidden gap-0.5 mb-3">
                        {b2bPct > 0 && (
                          <div className="bg-blue-500 transition-all duration-700 rounded-l-full" style={{ width: `${b2bPct}%` }} title={`B2B: ${b2bPct}%`} />
                        )}
                        {retailPct > 0 && (
                          <div className="bg-gray-300 transition-all duration-700 rounded-r-full" style={{ width: `${retailPct}%` }} title={`Retail: ${retailPct}%`} />
                        )}
                      </div>
                    ) : (
                      <p className="text-[10px] text-gray-400 mb-3">
                        {currentLanguage === 'tr'
                          ? `${s79.tutarsiz} siparişin tutarı bilinmiyor — pay yüzdesi hesaplanamıyor.`
                          : `${s79.tutarsiz} order(s) have no amount — share cannot be computed.`}
                      </p>
                    )}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-sm bg-blue-500 flex-shrink-0" />
                        <div>
                          <p className="text-xs font-bold text-blue-700">B2B — {b2bPct === null ? '—' : `${b2bPct}%`}</p>
                          <p className="text-[10px] text-gray-400">{fmtKpi(b2bRev)}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-sm bg-gray-300 flex-shrink-0" />
                        <div>
                          <p className="text-xs font-bold text-gray-600">{oc(currentLanguage).perakende} — {retailPct === null ? '—' : `${retailPct}%`}</p>
                          <p className="text-[10px] text-gray-400">{fmtKpi(retailRev)}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* ── Phase 106: Revenue Donut by Customer Type ── */}
              {orders.length > 0 && (() => {
                const s106 = segmentCirosu(orders, donutSegmenti, ['B2B', 'Dealer', 'Retail']);
                const etiket106: Record<string, { label: string; color: string }> = {
                  B2B:    { label: 'B2B',                          color: '#3b82f6' },
                  Dealer: { label: oc(currentLanguage).bayi,       color: '#ff4000' },
                  Retail: { label: oc(currentLanguage).perakende,  color: '#6b7280' },
                };
                const segs = s106.segmentler.map(s => ({ ...s, ...(etiket106[s.anahtar] ?? { label: s.anahtar, color: '#6b7280' }) }));
                if (s106.toplam === 0) return null;

                // SVG donut: r=40, circumference=251.3. Dilimler PAY YÜZDESİne dayanır; toplam
                // kısmiyse (yuzdelerGecerli false) halka ÇİZİLMEZ — eski kod eksik bir toplamı
                // %100 kabul edip tüm çemberi dolduruyordu.
                const R = 40, C = 2 * Math.PI * R;
                let offset = 0;
                // `flatMap` + erken dönüş, `filter(...).map(s => s.yuzde as number)` yerine:
                // filter callback'i tipi daraltmaz, tip iddiası gerekirdi (CLAUDE.md: gerçek guard).
                const paths = s106.yuzdelerGecerli
                  ? segs.flatMap(s => {
                      if (s.yuzde === null || !(s.ciro > 0)) return [];
                      const pct = s.yuzde / 100;
                      const dash = pct * C;
                      const gap  = C - dash;
                      const el = { ...s, pct, dash, gap, offset };
                      offset += dash;
                      return [el];
                    })
                  : [];
                const bigSeg = s106.enBuyuk;

                return (
                  <div className={cn("rounded-2xl border p-5", darkMode ? "bg-white/5 border-white/10" : "bg-white border-gray-100 shadow-sm")}>
                    <h3 className={cn("text-[10px] font-bold uppercase tracking-wider mb-4", darkMode ? "text-white/50" : "text-gray-400")}>
                      {dc(currentLanguage).musteri_tipi_bazinda_ciro}
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
                            {bigSeg ? (etiket106[bigSeg.anahtar]?.label ?? bigSeg.anahtar) : '—'}
                          </span>
                          <span className="text-sm font-black text-gray-900 leading-none mt-0.5">
                            {bigSeg && bigSeg.yuzde !== null ? `${Math.round(bigSeg.yuzde)}%` : '—'}
                          </span>
                        </div>
                      </div>
                      {/* Legend */}
                      <div className="flex-1 space-y-3">
                        {/* Süzgeç `!Number.isFinite(s.ciro) || s.ciro > 0`: cirosu HİÇ bilinmeyen
                            segment gizlenmez, '—' ile görünür (eski `s.rev > 0` onu ₺0 sanıp
                            gizliyordu — "o segmentten hiç satış yok" demek sahte kesinlikti). */}
                        {segs.filter(s => !Number.isFinite(s.ciro) || s.ciro > 0).map((s, i) => {
                          const pct = s.yuzde === null ? null : Math.round(s.yuzde);
                          return (
                            <div key={i} className="space-y-1">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-1.5">
                                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: s.color }} />
                                  <span className="text-xs font-semibold text-gray-700">{s.label}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="text-[10px] text-gray-400">{fmtKpi(s.ciro)}</span>
                                  <span className="text-[10px] font-black text-gray-600 w-7 text-right">{pct === null ? '—' : `${pct}%`}</span>
                                </div>
                              </div>
                              {pct !== null && (
                                <div className="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
                                  <div className="h-1.5 rounded-full transition-all duration-700" style={{ width: `${pct}%`, backgroundColor: s.color }} />
                                </div>
                              )}
                            </div>
                          );
                        })}
                        {s106.tutarsiz > 0 && (
                          <p className="text-[10px] text-gray-400">
                            {currentLanguage === 'tr'
                              ? `${s106.tutarsiz} siparişin tutarı bilinmiyor — pay yüzdeleri hesaplanamıyor.`
                              : `${s106.tutarsiz} order(s) have no amount — shares cannot be computed.`}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* ── Phase 124: Customer Segment Profitability ── */}
              {orders.length > 0 && inventory.length > 0 && (() => {
                // %60 UYDURMA MALİYET ORANI KALDIRILDI (Faz 3 5/n). Eski satır üç ayrı uydurma
                // taşıyordu: (a) `li.price * 0.6` — maliyeti bilinmeyen kaleme hiçbir veriye
                // dayanmayan sabit oran; (b) `itemCostTRY` kuru çevrilemeyen kalem için 0 döner
                // (cost.ts'te belgeli) → kalem sessizce "bedelsiz" olup marjı şişiriyordu;
                // (c) `revenue > 0 ? … : 0` cirosu bilinmeyen segmente "%0 marj" rozeti veriyordu.
                // Hesap artık src/utils/pano/musteriAnaliz.ts + siparisKarlilik.ts (ikisi de testli).
                const kalemMaliyeti124 = (li: OrderLineItem): number | null => {
                  // BOŞ ANAHTAR EŞLEŞMEZ (stokKartiBul ile aynı kapı): '' === '' olduğu için
                  // serbest satır ("Nakliye bedeli") katalogdaki adsız İLK karta bağlanıp o
                  // ilgisiz kartın maliyetini "bilinen" sayıyordu.
                  const kimlik = li.inventoryId, ad = li.name;
                  const inv = inventory.find(i => (!!kimlik && i.id === kimlik) || (!!ad && i.name === ad));
                  return inv ? kartMaliyetiTL(inv, exchangeRates) : null;   // bilinmiyor → null (0 DEĞİL)
                };
                const k124 = segmentKarliligi(orders, tipSegmenti, o => siparisKarliligi<OrderLineItem>(o, kalemMaliyeti124));
                const segs = k124.segmentler;
                if (segs.length === 0) return null;
                const colors = { 'B2B': '#3b82f6', 'Retail': '#10b981', 'Dealer': '#f59e0b', 'Other': '#8b5cf6' };
                return (
                  <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
                    <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
                      <span className="text-base">💰</span>
                      <h3 className="font-bold text-gray-800">{dc(currentLanguage).segment_karliligi}</h3>
                    </div>
                    <div className="divide-y divide-gray-50">
                      {segs.map(s => {
                        const barColor = (colors as Record<string, string>)[s.anahtar] || '#6b7280';
                        const marj = s.marjYuzde === null ? null : Math.round(s.marjYuzde);
                        return (
                          <div key={s.anahtar} className="px-5 py-4">
                            <div className="flex items-center justify-between mb-1.5">
                              <div className="flex items-center gap-2">
                                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: barColor }} />
                                <p className="text-sm font-bold text-gray-800">{s.anahtar}</p>
                                <span className="text-[10px] text-gray-400">{s.siparisSayisi} {oc(currentLanguage).siparis}</span>
                              </div>
                              <div className="flex items-center gap-3 text-xs">
                                <span className="text-gray-500">{fmtKpi(s.ciro,'K',1)}</span>
                                {marj === null ? (
                                  <span className="font-bold text-gray-400" title={currentLanguage === 'tr'
                                    ? `${s.maliyetsizSiparis} siparişin maliyeti bilinmiyor — marj hesaplanamıyor.`
                                    : `Cost unknown for ${s.maliyetsizSiparis} order(s) — margin cannot be computed.`}>
                                    — {oc(currentLanguage).marj_2}
                                  </span>
                                ) : (
                                  <span className={`font-bold ${marj >= 30 ? 'text-emerald-600' : marj >= 15 ? 'text-amber-600' : 'text-red-500'}`}>
                                    %{marj} {oc(currentLanguage).marj_2}
                                  </span>
                                )}
                              </div>
                            </div>
                            {s.barOrani !== null && (
                              <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
                                <div className="h-2 rounded-full transition-all duration-700" style={{ width: `${s.barOrani}%`, backgroundColor: barColor }} />
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    <div className="px-5 py-2 bg-gray-50 border-t border-gray-100 text-[10px] text-gray-400">
                      {currentLanguage === 'tr'
                        ? 'Maliyet: siparişin kendi kayıtlı maliyeti, yoksa stok kartı × miktar. Bir kalemin maliyeti bilinmiyorsa o segmentin marjı hesaplanmaz.'
                        : 'Cost: the order’s own recorded cost, else stock card × quantity. If any line cost is unknown, that segment’s margin is not computed.'}
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
                  {dc(currentLanguage).siparis_musteri_veya_urun_ara}
                </span>
                <kbd className="hidden sm:inline text-[10px] text-gray-400 bg-white border border-gray-200 px-1.5 py-0.5 rounded font-mono shadow-sm">⌘K</kbd>
              </button>

              {/* Quick Actions */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-4">{dashT.quick_access}</h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    { label: dc(currentLanguage).kalite_yonetimi, tab: 'kalite', icon: Activity, color: '#ff4000' },
                    { label: dc(currentLanguage).hukuk_uyum, tab: 'hukuk', icon: ShieldCheck, color: '#3b82f6' },
                    { label: dc(currentLanguage).proje_yonetimi, tab: 'proje', icon: TargetIcon, color: '#8b5cf6' },
                    { label: oc(currentLanguage).satin_alma, tab: 'satin-alma', icon: ShoppingCart, color: '#10b981' },
                    { label: dashT.new_order, tab: 'orders', icon: Package, color: '#f59e0b' },
                    { label: oc(currentLanguage).lojistik, tab: 'lojistik', icon: Truck, color: '#06b6d4' },
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
                  const lastTouch = zamanMs(l.updatedAt || l.createdAt);
                  return lastTouch !== null && (Date.now() - lastTouch) > 30 * 86400000;
                });
                // `?? 0` stoğu BİLİNMEYEN kalemi 0 sayıp sahte "Düşük stok" eylemi üretiyordu;
                // `?? 5` ise eşiği olmayan kalemi uydurma bir eşikle kıyaslıyordu. İkisi de veri değil.
                // Stoğu/eşiği bilinmeyen kalem AJANDA MADDESİ üretmez (ne yapılacağı bilinmiyor);
                // sayıları "Düşük Stok Uyarısı" panelinde not olarak gösteriliyor.
                const lowStockItems = dusukStok.dusuk;
                const agendaItems = [
                  ...toShip.slice(0, 3).map(o => ({
                    key: `ship-${o.id}`,
                    icon: Truck, color: 'text-blue-600' as const, bg: 'bg-blue-50' as const,
                    title: currentLanguage === 'tr' ? `Kargoya ver: ${o.customerName}` : `Ship: ${o.customerName}`,
                    sub: `${gorunenSiparisNo(o)} · ${paraYaz(o.totalPrice, { ondalik: 0 })}`,
                    onClick: () => { setActiveTab('orders'); },
                  })),
                  ...staleLeads.slice(0, 2).map(l => ({
                    key: `lead-${l.id}`,
                    icon: Users, color: 'text-amber-600' as const, bg: 'bg-amber-50' as const,
                    title: currentLanguage === 'tr' ? `Hareketsiz: ${l.name}` : `Stale: ${l.name}`,
                    sub: dc(currentLanguage)._30_gundur_iletisim_yok,
                    onClick: () => setActiveTab('crm'),
                  })),
                  ...lowStockItems.slice(0, 2).map(i => ({
                    key: `stock-${i.id}`,
                    icon: AlertTriangle, color: 'text-red-600' as const, bg: 'bg-red-50' as const,
                    title: currentLanguage === 'tr' ? `Düşük stok: ${i.name}` : `Low stock: ${i.name}`,
                    sub: `${stokEsikYaz(i)} ${oc(currentLanguage).adet}`,
                    onClick: () => setActiveTab('inventory'),
                  })),
                ];
                if (agendaItems.length === 0) return null;
                return (
                  <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider flex items-center gap-2">
                        <Calendar className="w-4 h-4" />
                        {dc(currentLanguage).bugunun_ajandasi}
                      </h3>
                      <span className="text-[10px] bg-amber-50 text-amber-600 font-bold px-2 py-0.5 rounded-full">
                        {agendaItems.length} {dc(currentLanguage).eylem}
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
                    {dc(currentLanguage).hizli_not}
                  </h3>
                  {quickNote && (
                    <span className="text-[9px] text-gray-400 font-medium">
                      {dc(currentLanguage).otomatik_kaydediliyor}
                    </span>
                  )}
                </div>
                <textarea
                  value={quickNote}
                  onChange={e => handleQuickNoteChange(e.target.value)}
                  rows={4}
                  placeholder={dc(currentLanguage).hizli_notlarinizi_buraya_yazin_otomatik_kaydedil}
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
                        title={dc(currentLanguage).siparisler_ekranina_git}
                        className="w-full text-left flex items-center justify-between py-2 border-b border-gray-50 last:border-0 hover:bg-gray-50/70 rounded-lg px-1 -mx-1 transition-colors cursor-pointer">
                        <div>
                          <p className="text-sm font-semibold text-[#1D1D1F]">{o.customerName || currentT.customer}</p>
                          <p className="text-xs text-gray-400">{gorunenSiparisNo(o)}</p>
                        </div>
                        <div className="text-right">
                          {/* Tutarı bilinmeyen sipariş ₺0 BASILMAZ: Mikro faturasından türetilen
                              kayıtta (source:'mikro-fatura') `totalPrice` alanı BİLEREK yoktur
                              (server/mikro/eslemeFatura.ts). `siparisTutari` NaN döner, `fmtKpi`
                              (→ kisaTutar) onu '—' yapar. Eski `||` zinciri hem bunu ₺0 gösteriyor
                              hem meşru ₺0 tutarı totalAmount'a düşürüyordu. */}
                          <p className="text-sm font-bold text-[#1D1D1F]">{fmtKpi(siparisTutari(o))}</p>
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
                    {/* Ham `i.stockLevel <= i.lowStockThreshold` karşılaştırması undefined'da NaN
                        üretip SESSİZCE false dönüyordu (kalem hiç görünmüyordu) ve hücre
                        "undefined adet" basabiliyordu. Kapı artık Phase 24 ajandasıyla ORTAK. */}
                    {dusukStok.dusuk.slice(0, 5).map(item => (
                      <button key={item.id} type="button"
                        onClick={() => setActiveTab('inventory')}
                        title={dc(currentLanguage).envanter_ekranina_git}
                        className="w-full text-left flex items-center justify-between py-2 border-b border-gray-50 last:border-0 hover:bg-gray-50/70 rounded-lg px-1 -mx-1 transition-colors cursor-pointer">
                        <div>
                          <p className="text-sm font-semibold text-[#1D1D1F]">{item.name}</p>
                          <p className="text-xs text-gray-400">{item.sku}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-bold text-red-500">{adetYaz(item.stockLevel)} {dashT.units}</p>
                          <p className="text-[10px] text-gray-400">Min: {adetYaz(item.lowStockThreshold)}</p>
                        </div>
                      </button>
                    ))}
                    {dusukStok.dusuk.length === 0 && (
                      <p className="text-sm text-green-600 text-center py-4 flex items-center justify-center gap-2"><CheckCircle2 className="w-4 h-4" />{dashT.all_in_stock}</p>
                    )}
                    {/* Ölçülemeyen kalemler SESSİZCE düşmesin — "hepsi stokta" yanlış güven verir */}
                    {(dusukStok.stokBilinmeyen.length > 0 || dusukStok.esikBilinmeyen.length > 0) && (
                      <p className="text-[10px] text-amber-600 mt-2">
                        {currentLanguage === 'tr'
                          ? `${dusukStok.stokBilinmeyen.length} kalemin stoğu, ${dusukStok.esikBilinmeyen.length} kalemin min. eşiği bilinmiyor — bu kalemler denetlenemedi.`
                          : `${dusukStok.stokBilinmeyen.length} item(s) missing stock and ${dusukStok.esikBilinmeyen.length} missing threshold — not checked.`}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* ── Phase 47: Inventory Value Summary ── */}
              {inventory.length > 0 && (() => {
                // `?? 0` üç yerde birden bilinmeyeni 0 sayıyordu (stok, fiyat, maliyet) ve marj
                // TÜRETİLEN sayı olduğu hâlde eksik girdiyle hesaplanıp boş envanterde "%0" basıyordu.
                // `kartMaliyetiTL` bilinmeyen maliyete null döner (itemCostTRY 0 dönüyordu — sessiz eksiltme).
                // SATIŞ tarafı da AÇIK seçiciyle ve KURLA çevrilerek verilir (2026-09-19 delta bulgusu):
                // seçici verilmediğinde modül `finansalOranlar.stokDegeri`ye düşüyor, o da
                // `prices.Retail ?? price` değerini `priceCurrency`ye HİÇ BAKMADAN stokla çarpıyordu.
                // USD fiyatlı kartta maliyet TL'ye çevrili, satış çevrilmemiş olduğu için panel iki
                // para birimini topluyor ve marj eksiye çakılıyordu (₺328.000 maliyete "₺12.000" satış
                // → ≈ −%2633) — üstelik hiçbir girdi "bilinmiyor" olmadığı için '—' kapısı da açılmıyordu.
                // `itemPriceTRY` DOĞRUDAN geçilemez: kur/fiyat yokken 0 döner, yani kalemi sessizce
                // eksiltir; `kartSatisTL` null döner ve kalem `satis.bilinmeyen`e düşüp not basılır.
                const stok47 = stokDegeriOzeti(inventory, {
                  maliyet: i => kartMaliyetiTL(i, exchangeRates),
                  satis: i => kartSatisTL(i, 'Retail', exchangeRates),
                });
                return (
                  <>
                  {/* Maliyet tarafi cevrilemeyen kalemleri DISLIYOR — eksikligi soyle. */}
                  <KurUyarisi inventory={inventory} exchangeRates={exchangeRates} currentLanguage={currentLanguage} className="mb-2" />
                  <div className={cn("rounded-2xl border p-5", darkMode ? "bg-white/5 border-white/10" : "bg-white border-gray-100 shadow-sm")}>
                    <div className="flex items-center justify-between mb-4">
                      <h3 className={cn("text-[10px] font-bold uppercase tracking-wider flex items-center gap-2", darkMode ? "text-white/50" : "text-gray-400")}>
                        <Package className="w-3.5 h-3.5" />
                        {dc(currentLanguage).stok_degeri_ozeti}
                      </h3>
                      <button onClick={() => setActiveTab('inventory')} className="text-[10px] font-semibold text-brand hover:underline">
                        {dc(currentLanguage).stoka_git}
                      </button>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      {(() => {
                        return [
                        { label: dc(currentLanguage).maliyet_degeri,   value: fmtKpi(ekranTutari(stok47.maliyet)),   color: 'text-gray-800',    sub: dc(currentLanguage).stok_maliyeti },
                        { label: dc(currentLanguage).satis_degeri,  value: fmtKpi(ekranTutari(stok47.satis)),  color: 'text-emerald-700', sub: dc(currentLanguage).tavsiye_fiyat },
                        // Marj null iken rozet rengi NÖTR — kırmızı/yeşil boyamak "hesaplandı" izlenimi verir.
                        { label: oc(currentLanguage).brut_marj,
                          value: stok47.marj === null ? '—' : `${stok47.marj}%`,
                          color: stok47.marj === null ? 'text-gray-400'
                               : stok47.marj >= 30 ? 'text-emerald-600' : stok47.marj >= 15 ? 'text-amber-600' : 'text-red-600',
                          sub: dc(currentLanguage).teorik_oran },
                        { label: oc(currentLanguage).toplam_adet,   value: adetYaz(ekranTutari(stok47.adet)), color: 'text-blue-700', sub: dc(currentLanguage).stokta },
                        ].map((stat, i) => (
                          <div key={i} className={cn("rounded-xl p-3 text-center", darkMode ? "bg-white/5" : "bg-gray-50")}>
                            <p className={`text-lg font-black ${stat.color}`}>{stat.value}</p>
                            <p className={cn("text-[10px] font-bold mt-0.5 truncate", darkMode ? "text-white/50" : "text-gray-500")}>{stat.label}</p>
                            <p className={cn("text-[9px] mt-0.5", darkMode ? "text-white/60" : "text-gray-400")}>{stat.sub}</p>
                          </div>
                        ));
                      })()}
                    </div>
                    {(stok47.maliyet.bilinmeyen > 0 || stok47.satis.bilinmeyen > 0 || stok47.adet.bilinmeyen > 0) && (
                      <p className="text-[10px] text-amber-600 mt-2">
                        {currentLanguage === 'tr'
                          ? `${stok47.maliyet.bilinmeyen} kalemin maliyeti, ${stok47.satis.bilinmeyen} kalemin satış fiyatı, ${stok47.adet.bilinmeyen} kalemin stoğu bilinmiyor — bu kalemler toplama dâhil değil, marj hesaplanamıyor.`
                          : `${stok47.maliyet.bilinmeyen} item(s) missing cost, ${stok47.satis.bilinmeyen} missing price, ${stok47.adet.bilinmeyen} missing stock — excluded from totals; margin not computed.`}
                      </p>
                    )}
                  </div>
                  </>
                );
              })()}

              {/* ── 6-Month Revenue Trend + Top Products ── */}
              {(() => {
                // Son 6 ayın kovaları — utils/pano/ciroDonem → aylikCiro (testli).
                // Tarihi çözülemeyen sipariş kovaya girmez (eskiden `?? new Date()` ile BUGÜNe
                // sayılıyordu); tutarı okunamayan sipariş ₺0 sayılmaz — grafik noktası `null` olur,
                // çizgi sıfıra çakılmaz (`bucket.revenue += o.totalPrice` alan yoksa TÜM ayı NaN
                // yapıp recharts alanını komple bozuyordu).
                // BİLİNÇLİ FARK: tarih artık `createdAt ?? syncedAt` (eskiden yalnız `createdAt`) —
                // yanındaki Phase 103 çubuğu o siparişleri zaten sayıyordu, iki grafik aynı ekranda
                // farklı ciro veriyordu. `iptalHaric: false` PARİTE (trend bugün iptali sayıyor).
                const aylar = aylikCiro(orders, 6, new Date(), { iptalHaric: false }, currentLanguage === 'tr' ? 'tr' : 'en');
                const months: { label: string; revenue: number | null; orders: number }[] =
                  aylar.map(a => ({ label: a.etiket, revenue: a.grafik, orders: a.adet }));

                // Top-5 products by order line count
                // `quantity || 1` adedi BİLİNMEYEN satırı 1 adet sayıyordu (uydurma miktar!),
                // `price || 0` ise fiyatsız satırı ₺0 ciro yapıyordu. İkisi de artık SAYILIR.
                // Çubuk oranı (`p.barOrani`) modülden gelir — sayfada ölçek hesabı KALMADI
                // (2026-09-19 hakem turu): buradaki `maxRevTop` KISMİ bir tepeyi ölçek kabul
                // ediyor, `oranYuzde(ekranTutari(p.ciro), maxRevTop)` ise kısmi satır cirosundan
                // çubuk çiziyordu. Fiyatsız satırı olan ÇİMENTO, gerçekte listenin tepesindeyken
                // %67'lik kısa bir çubukla ikinci sırada görünüyordu — üstelik aynı sayfadaki
                // müşteri/segment panelleri (musteriAnaliz) tam tersi kuralı uyguluyordu.
                const top5 = enCokSatanlar(orders, 5);

                const toplamT = donemToplami(aylar);
                const totalRevAll = ekranTutari(toplamT);
                const totalOrdAll = aylar.reduce((s, a) => s + a.adet, 0);

                return (
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                    {/* Trend chart — takes 2 cols */}
                    <div className="lg:col-span-2 bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                      <div className="flex items-center justify-between mb-1">
                        <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider">
                          {dc(currentLanguage)._6_aylik_ciro_trendi}
                        </h3>
                        <div className="flex items-center gap-3 text-[10px] text-gray-400">
                          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-brand inline-block" />{oc(currentLanguage).ciro}</span>
                          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-blue-300 inline-block" />{oc(currentLanguage).siparis_2}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-4 mb-3">
                        <div>
                          <p className="text-xl font-bold text-gray-900">{fmtKpi(totalRevAll)}</p>
                          <p className="text-[10px] text-gray-400">{dc(currentLanguage)._6_ay_toplam_ciro}</p>
                          {/* Kısmi toplam açıkça söylenir — sessizce eksik rakam gösterme (CLAUDE.md). */}
                          {toplamT.bilinmeyen > 0 && (
                            <p className="text-[10px] text-amber-600">
                              {toplamT.bilinmeyen} {dc(currentLanguage).kaydin_tutari_okunamadi_kismi_toplam}
                            </p>
                          )}
                        </div>
                        <div className="w-px h-8 bg-gray-100" />
                        <div>
                          <p className="text-xl font-bold text-blue-600">{totalOrdAll}</p>
                          <p className="text-[10px] text-gray-400">{dc(currentLanguage).toplam_siparis}</p>
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
                                ? [paraYaz(value, { ondalik: 0 }), oc(currentLanguage).ciro]
                                : [value, oc(currentLanguage).siparis_2]
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
                        {dc(currentLanguage).en_cok_satan_urunler}
                      </h3>
                      {top5.length === 0 ? (
                        <p className="text-xs text-gray-400 text-center py-6">{dc(currentLanguage).siparis_verisi_yok}</p>
                      ) : (
                        <div className="space-y-3">
                          {top5.map((p, i) => {
                            // Oran hesaplanamazsa çubuk ÇİZİLMEZ (boş çubuk "%0 ciro" izlenimi
                            // vermesin): satırın kendi cirosu kısmiysa ya da ölçek satırı kısmiysa
                            // modül `null` döner (utils/pano/cubuk).
                            const pay = p.barOrani;
                            return (
                            <div key={p.anahtar ?? `tanimsiz-${i}`} className="space-y-1">
                              <div className="flex items-center justify-between">
                                {/* Eski `'Unknown'` ekrana İngilizce sahte ürün adı basıyordu. */}
                                <span className="text-xs font-semibold text-gray-700 truncate max-w-[140px]">
                                  {p.ad ?? (dc(currentLanguage).tanimsiz_urun)}
                                </span>
                                <span className="text-[10px] font-bold text-gray-500">{fmtKpi(ekranTutari(p.ciro))}</span>
                              </div>
                              <div className="w-full bg-gray-100 rounded-full h-1.5">
                                {pay === null ? null : (
                                  <div
                                    className="bg-brand h-1.5 rounded-full transition-all"
                                    style={{ width: `${Math.round(pay)}%` }}
                                  />
                                )}
                              </div>
                              <p className="text-[10px] text-gray-400">
                                {adetYaz(ekranTutari(p.adet))} {oc(currentLanguage).adet}
                                {p.ciro.bilinmeyen > 0 && (currentLanguage === 'tr'
                                  ? ` · ${p.ciro.bilinmeyen} satır tutarsız`
                                  : ` · ${p.ciro.bilinmeyen} line(s) unpriced`)}
                              </p>
                            </div>
                            );
                          })}
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
                // Oran `finansKpi.huniKazanmaOrani` ile (testli, TEK kural; burada KOPYA YAZILMAZ).
                // Eski satır `totalActive > 0 ? … : '0'` idi: kapı YANLIŞ paydaya bakıyor, bölme
                // ise `totalActive + counts[5]` ile yapılıyordu. Hepsi kapanmış bir huni
                // (aktif 0, 'Closed Won' 4) gerçekte %100 iken rozete "Win Rate: 0%" basılıyor,
                // hiç aday yokken de '—' yerine '0%' yazılıyordu (2026-09-19 delta bulgusu).
                const wonRate = huniKazanmaOrani(counts.slice(0, 5), counts[5]);
                return (
                  <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider">{dashT.lead_summary}</h3>
                      {/* Oran hesaplanamıyorsa (hiç aday yok) rozet '—' basar — "%0" değil. */}
                      <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${wonRate === null ? 'text-gray-400 bg-gray-50' : 'text-green-600 bg-green-50'}`}>
                        {wonRate === null ? 'Win Rate: —' : `Win Rate: ${wonRate}%`}
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
                        {dc(currentLanguage).crm_e_git} <ChevronRight className="w-3 h-3" />
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
                    const due = zamanDate(l.nextFollowUpDate);
                    return !!due && due >= today7 && due <= in7;
                  })
                  // Süzgeçten geçenlerin tarihi çözülmüştür; `sayiSirala` yine de çözülemeyeni epoch (0) saymaz, sona koyar.
                  .sort((a, b) => sayiSirala(zamanMs(a.nextFollowUpDate), zamanMs(b.nextFollowUpDate)));
                if (upcoming.length === 0) return null;
                return (
                  <div className={cn("rounded-2xl border p-5", darkMode ? "bg-white/5 border-white/10" : "bg-white border-gray-100 shadow-sm")}>
                    <div className="flex items-center justify-between mb-3">
                      <h3 className={cn("text-[10px] font-bold uppercase tracking-wider flex items-center gap-2", darkMode ? "text-white/50" : "text-gray-400")}>
                        <Calendar className="w-3.5 h-3.5" />
                        {dc(currentLanguage)._7_gunluk_takip_plani}
                      </h3>
                      <button onClick={() => { setActiveTab('crm'); setCrmTab('leads'); }} className="text-[10px] font-semibold text-brand hover:underline">
                        {dc(currentLanguage).crm_e_git_2}
                      </button>
                    </div>
                    <div className="space-y-2">
                      {upcoming.slice(0, 5).map(l => {
                        const due = zamanDate(l.nextFollowUpDate);
                        if (!due) return null;
                        const daysLeft = Math.round((due.getTime() - today7.getTime()) / 86400000);
                        return (
                          <button key={l.id} onClick={() => { setActiveTab('crm'); setSelectedLead(l); }}
                            className={cn("w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors", darkMode ? "hover:bg-white/5" : "hover:bg-gray-50")}>
                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 text-[10px] font-black ${daysLeft === 0 ? 'bg-amber-100 text-amber-700' : 'bg-blue-50 text-blue-600'}`}>
                              {daysLeft === 0 ? (dc(currentLanguage).bug) : `${daysLeft}g`}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className={cn("text-sm font-semibold truncate", darkMode ? "text-white/90" : "text-gray-800")}>{l.name}</p>
                              <p className={cn("text-[10px] truncate", darkMode ? "text-white/65" : "text-gray-400")}>{l.company}</p>
                            </div>
                            <p className={cn("text-[11px] font-bold flex-shrink-0", darkMode ? "text-white/50" : "text-gray-400")}>
                              {tarihYaz(due, { month: 'short', day: 'numeric' }, currentLanguage === 'tr' ? 'tr' : 'en')}
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
                // SAHTE SIFIR + SAHTE ÖLÇEK KALDIRILDI (Faz 3 5/n): `+= o.totalPrice || 0` tutarı
                // okunamayan siparişi ₺0 sayıyor, `maxRev = top5[0].revenue` ise o ₺0'lı tepe
                // değere göre TÜM çubukları çiziyordu. `custMap[o.customerName]` ayrıca adı
                // olmayan siparişlerden "undefined" adlı sahte bir müşteri üretiyordu.
                // Hesap: src/utils/pano/musteriAnaliz.ts (saf + testli).
                const m77 = enIyiMusteriler(orders, 5);
                const top5 = m77.musteriler;
                if (top5.length === 0) return null;
                return (
                  <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider">
                        {oc(currentLanguage).en_yuksek_cirolu_musteriler}
                      </h3>
                      <button onClick={() => setActiveTab('reports')} className="text-[10px] font-semibold text-brand hover:underline">
                        {dc(currentLanguage).raporlara_git}
                      </button>
                    </div>
                    <div className="space-y-3">
                      {top5.map((c, i) => {
                        const medal   = ['🥇','🥈','🥉','',''][i] || '';
                        return (
                          // `ad` null olabildiği için React anahtarı olamaz; adsız kova TEK
                          // olduğundan sabit anahtar çakışma üretmez.
                          <div key={c.ad ?? '__adsiz'} className="space-y-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs font-semibold text-gray-700 truncate flex items-center gap-1.5">
                                {medal && <span className="text-sm leading-none">{medal}</span>}
                                {c.ad ?? '—'}
                              </span>
                              <div className="flex items-center gap-2 flex-shrink-0">
                                <span className="text-[10px] text-gray-400">{c.siparisSayisi} {oc(currentLanguage).sip}</span>
                                <span className="text-[10px] font-bold text-gray-700">
                                  {fmtKpi(c.ciro)}
                                </span>
                              </div>
                            </div>
                            {c.barOrani !== null && (
                              <div className="w-full bg-gray-100 rounded-full h-1.5">
                                <div
                                  className={`h-1.5 rounded-full transition-all duration-700 ${i === 0 ? 'bg-brand' : 'bg-gray-300'}`}
                                  style={{ width: `${c.barOrani}%` }}
                                />
                              </div>
                            )}
                          </div>
                        );
                      })}
                      {m77.tutarsiz > 0 && (
                        <p className="text-[10px] text-gray-400">
                          {currentLanguage === 'tr'
                            ? `${m77.tutarsiz} siparişin tutarı bilinmiyor — toplama dâhil değil.`
                            : `${m77.tutarsiz} order(s) have no amount — excluded from the total.`}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* ── Phase 73: Weekday Order Heatmap ── */}
              {orders.length > 0 && (() => {
                const DAYS_TR = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];
                const DAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
                // `indexOf(Math.max(...))` tüm tarihler okunamazsa 0 döndürüp rozete "En yoğun: Paz"
                // yazdırıyordu (veri yokken uydurma sonuç). Tarihi çözülemeyen sipariş artık SAYILIR.
                // Tarih seçici varsayılanı `createdAt ?? syncedAt` — sayfayla BİREBİR aynı (parite).
                const isi73 = haftaIciIsiHaritasi(orders);
                const counts = isi73.sayilar;
                const totalO = isi73.toplam;
                const busiest = isi73.enYogunGun;   // null olabilir — rozet o zaman çizilmez
                return (
                  <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider">
                        {dc(currentLanguage).haftalik_siparis_dagilimi}
                      </h3>
                      {/* Türetilen rozet: tek ölçüm bile yoksa ÇİZİLMEZ. */}
                      {busiest !== null && (
                        <span className="text-[10px] font-bold text-brand bg-brand/10 px-2 py-0.5 rounded-full">
                          {currentLanguage === 'tr' ? `En yoğun: ${DAYS_TR[busiest]}` : `Busiest: ${DAYS_EN[busiest]}`}
                        </span>
                      )}
                    </div>
                    <div className="flex items-end gap-2">
                      {counts.map((c, i) => {
                        const pay = oranYuzde(c, isi73.enYuksek);
                        // Hiç ölçüm yoksa (enYuksek 0) her çubuk 6%'lik görsel kütük kalır — eski koddaki
                        // `Math.max(pct, 6)` tabanının aynısı; uydurma bir yükseklik ÜRETİLMEZ.
                        const yukseklik = pay === null ? 6 : Math.max(Math.round(pay), 6);
                        const isToday = i === new Date().getDay();
                        const isBusiest = busiest !== null && i === busiest;
                        return (
                          <div key={i} className="flex-1 flex flex-col items-center gap-1.5">
                            {/* Bar */}
                            <div className="w-full flex items-end justify-center" style={{ height: 64 }}>
                              <div
                                className={`w-full rounded-t-lg transition-all duration-700 ${
                                  isBusiest ? 'bg-brand' : isToday ? 'bg-brand/50' : 'bg-gray-200'
                                }`}
                                style={{ height: `${yukseklik}%` }}
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
                      {isi73.tarihsiz > 0 && (currentLanguage === 'tr'
                        ? ` · ${isi73.tarihsiz} siparişin tarihi okunamadı, dağılıma girmedi`
                        : ` · ${isi73.tarihsiz} order(s) with unreadable date, excluded`)}
                    </p>
                  </div>
                );
              })()}

              {/* ── Phase 38: Recently Viewed ── */}
              {recentlyViewed.length > 0 && (
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                  <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                    <History className="w-4 h-4" />
                    {dc(currentLanguage).son_goruntulenenler}
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
                      {oc(currentLanguage).temizle}
                    </button>
                  </div>
                </div>
              )}
          {/* ── Phase 595: Görevler & Hatırlatıcılar ─────────────────────── */}
          {activeTab === 'dashboard' && (() => {
            const tr595 = currentLanguage === 'tr';
            const today595 = bugunAnahtari();
            const overdueTasks = p595Tasks.filter(t => !t.done && t.dueDate < today595);
            const todayTasks = p595Tasks.filter(t => !t.done && t.dueDate === today595);
            const prioColors595: Record<string,string> = {'Kritik':'border-l-red-500 bg-red-50/30','Yüksek':'border-l-orange-400 bg-orange-50/20','Orta':'border-l-amber-300 bg-amber-50/10','Düşük':'border-l-gray-300 bg-gray-50/50'};
            const prioBadge595: Record<string,string> = {'Kritik':'bg-red-100 text-red-700','Yüksek':'bg-orange-100 text-orange-700','Orta':'bg-amber-100 text-amber-700','Düşük':'bg-gray-100 text-gray-500'};
            return (
              <div className="apple-card p-5">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="font-bold text-gray-900 text-sm">{dc(tr595).gorevler_hatirlaticilar}</h3>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {overdueTasks.length>0&&<span className="text-red-500 font-bold">{overdueTasks.length} {dc(tr595).gecikmis}</span>}
                      {todayTasks.length>0&&<span className="text-amber-600 font-bold">{todayTasks.length} {dc(tr595).bugun_vadeli}</span>}
                      {p595Tasks.filter(t=>!t.done).length} {dc(tr595).acik_gorev}
                    </p>
                  </div>
                  <button onClick={()=>setP595ShowForm(v=>!v)} className="apple-button-primary flex items-center gap-2 text-sm"><Plus className="w-4 h-4"/>{dc(tr595).gorev_ekle}</button>
                </div>
                {p595ShowForm && (
                  <div className="bg-gray-50 rounded-xl p-4 mb-4 space-y-3">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <input className="apple-input px-3 py-2 text-sm col-span-2" placeholder={dc(tr595).gorev_basligi} value={p595Draft.title} onChange={e=>setP595Draft(d=>({...d,title:e.target.value}))} />
                      <input type="date" className="apple-input px-3 py-2 text-sm" value={p595Draft.dueDate} onChange={e=>setP595Draft(d=>({...d,dueDate:e.target.value}))} />
                      <select className="apple-input px-3 py-2 text-sm" value={p595Draft.priority} onChange={e=>setP595Draft(d=>({...d,priority:e.target.value as typeof d.priority}))}>
                        <option value="Düşük">{oc(tr595).dusuk}</option>
                        <option value="Orta">{oc(tr595).orta}</option>
                        <option value="Yüksek">{oc(tr595).yuksek}</option>
                        <option value="Kritik">{oc(tr595).kritik}</option>
                      </select>
                      <input className="apple-input px-3 py-2 text-sm" placeholder={dc(tr595).atanan_kisi} value={p595Draft.assignedTo} onChange={e=>setP595Draft(d=>({...d,assignedTo:e.target.value}))} />
                      <input className="apple-input px-3 py-2 text-sm" placeholder={dc(tr595).modul_or_crm_stok} value={p595Draft.module} onChange={e=>setP595Draft(d=>({...d,module:e.target.value}))} />
                    </div>
                    <div className="flex gap-2">
                      <button onClick={async ()=>{
                        if(!p595Draft.title) return;
                        try { await addDoc(collection(db,'workflowTasks'),{title:p595Draft.title,dueDate:p595Draft.dueDate||today595,assignedTo:p595Draft.assignedTo,module:p595Draft.module,priority:p595Draft.priority,done:false,createdAt:serverTimestamp()}); toast(dc(currentLanguage).gorev_eklendi, 'success'); } catch(e){console.error("[firestore]", e); toast(dc(currentLanguage).gorev_eklenemedi, 'error');}
                        setP595Draft({title:'',dueDate:'',assignedTo:'',module:'',priority:'Orta'});
                        setP595ShowForm(false);
                      }} className="apple-button-primary text-sm px-4 py-1.5">{oc(tr595).kaydet}</button>
                      <button onClick={()=>setP595ShowForm(false)} className="apple-button-secondary text-sm px-4 py-1.5">{oc(tr595).iptal}</button>
                    </div>
                  </div>
                )}
                {p595Tasks.length===0 ? (
                  <p className="text-center py-6 text-gray-400 text-sm">{dc(tr595).henuz_gorev_yok_gorev_ekle_ile_baslayin}</p>
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
                      <p className="text-xs text-gray-400 text-center pt-1">✓ {p595Tasks.filter(t=>t.done).length} {dc(tr595).tamamlanan_gorev} &nbsp;
                        <button onClick={async ()=>{if(!await confirmDelete(undefined, currentLanguage==='tr'?'tr':'en'))return;p595Tasks.filter(t=>t.done).forEach(t=>deleteDoc(doc(db,'workflowTasks',t.id)));}} className="text-red-400 hover:text-red-600">{oc(tr595).temizle}</button>
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
