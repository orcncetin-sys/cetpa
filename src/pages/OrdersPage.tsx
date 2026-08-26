import { itemCostTRY } from '../utils/cost';
import React, { useState, useEffect } from 'react';
import { pdfBaslik, pdfAltBilgi, pdfTabloStili } from '../utils/pdfTheme';
import { confirmDelete } from '../lib/confirm';
import { motion, AnimatePresence } from 'motion/react';
import {
  Plus, Search, X, ChevronDown,
  ArrowLeft, Package, TrendingUp,
  Clock, CheckCircle2, AlertTriangle, AlertCircle,
  Truck, MapPin, RefreshCw, Edit2, Trash2,
  Copy, Download,
  FileText, FileDown, FileUp, MessageSquare, GripVertical, Building2, Globe,
  Navigation, Users, Bell, Check, CreditCard,
  ArrowRightLeft, Link, Route, Ship, History, QrCode,
} from 'lucide-react';
import { db, auth } from '../firebase';
import {
  doc, setDoc, addDoc, updateDoc, deleteDoc,
  collection, serverTimestamp, incrementField, onSnapshot, query,
} from '../lib/dbClient';
import { logFirestoreError as handleFirestoreError, OperationType } from '../utils/firebase';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { exportOrdersCSV } from '../utils/export';
import { kurCevir, formatInCurrency } from '../utils/currency';
import { registerTurkishFont } from '../utils/pdfFont';
import AIInlineNudge from '../components/AIInlineNudge';
import ModuleHeader from '../components/ModuleHeader';
import AccountingModule from '../components/AccountingModule';
const CargoTrackingTab = React.lazy(() => import('../components/CargoTrackingTab'));
const LogisticsMapLazy = React.lazy(() => import('../components/LogisticsMap'));
const LogisticsMap = LogisticsMapLazy;
import type { Lead, Order, OrderLineItem, Employee, InventoryItem, RouteStop, Shipment, Warehouse, Vehicle, LocationStock } from '../types';
import LocationQRModal from '../components/LocationQRModal';
import TransferScanPanel from '../components/TransferScanPanel';
import CustomerCombobox from '../components/CustomerCombobox';
import { useMikroSiparisler } from "../hooks/useMikroSiparisler";
import LocationStockReport from '../components/LocationStockReport';

function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }

const SortIcon = ({ col, config }: { col: string; config: { key: string; dir: 'asc' | 'desc' } }) => (
  <span className="inline-flex flex-col ml-0.5 opacity-40">
    <span style={{ fontSize: 8 }}>{config.key === col && config.dir === 'asc' ? '▲' : '▴'}</span>
    <span style={{ fontSize: 8 }}>{config.key === col && config.dir === 'desc' ? '▼' : '▾'}</span>
  </span>
);

// itemCostTRY tek kaynaktan: src/utils/cost.ts (kopyasi 2026-08-26'da kaldirildi).

type TimelineEntry = { action: string; actor: string; ts: number; note?: string };

const ORDER_STATUS_STEPS = [
  { key: 'Pending',    labelTR: 'Sipariş Alındı',  labelEN: 'Received',   icon: Clock        },
  { key: 'Processing', labelTR: 'Hazırlanıyor',     labelEN: 'Processing', icon: Package      },
  { key: 'Shipped',    labelTR: 'Kargoya Verildi',  labelEN: 'Shipped',    icon: Truck        },
  { key: 'Delivered',  labelTR: 'Teslim Edildi',    labelEN: 'Delivered',  icon: CheckCircle2 },
] as const;

function OrderStatusTimeline({ status, lang = 'tr' }: { status: string; lang?: string }) {
  const isTR = lang === 'tr';
  const isCancelled = status === 'Cancelled';
  const activeIdx = Math.max(ORDER_STATUS_STEPS.findIndex(s => s.key === status), 0);
  return (
    <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-4">
        {isTR ? 'Sipariş Durumu' : 'Order Status'}
      </p>
      {isCancelled ? (
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
            <X className="w-5 h-5 text-red-500" />
          </div>
          <div>
            <p className="font-bold text-red-600 text-sm">{isTR ? 'Sipariş İptal Edildi' : 'Order Cancelled'}</p>
            <p className="text-[11px] text-red-400">{isTR ? 'Bu sipariş iptal edilmiştir.' : 'This order has been cancelled.'}</p>
          </div>
        </div>
      ) : (
        <div className="flex items-end">
          {ORDER_STATUS_STEPS.map((step, idx) => {
            const done = activeIdx >= idx;
            const active = activeIdx === idx;
            const Icon = step.icon;
            return (
              <React.Fragment key={step.key}>
                <div className="flex flex-col items-center gap-1.5 flex-shrink-0">
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center transition-all duration-300 ${done ? 'bg-brand text-white' : 'bg-gray-100 text-gray-300'} ${active ? 'ring-4 ring-brand/20 scale-110' : ''}`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <span className={`text-[9px] text-center font-bold leading-tight max-w-[60px] ${done ? 'text-brand' : 'text-gray-300'}`}>
                    {isTR ? step.labelTR : step.labelEN}
                  </span>
                </div>
                {idx < ORDER_STATUS_STEPS.length - 1 && (
                  <div className={`flex-1 h-[3px] mb-[22px] mx-1.5 rounded-full transition-all duration-500 ${activeIdx > idx ? 'bg-brand' : 'bg-gray-100'}`} />
                )}
              </React.Fragment>
            );
          })}
        </div>
      )}
    </div>
  );
}

type DepotKey = 'eski_sanayi' | 'havalimani';
interface Depot { name: string; lat: number; lng: number; }

interface Props {
  selectedOrder: Order | null;
  setSelectedOrder: React.Dispatch<React.SetStateAction<Order | null>>;
  lojistikTab: string;
  setLojistikTab: (tab: string) => void;
  routeStops: RouteStop[];
  isRouteOptimized: boolean;
  selectedDepot: DepotKey;
  setSelectedDepot: (d: DepotKey) => void;
  DEPOTS: Record<DepotKey, Depot>;
  recurringOrders: Array<{ id: string; templateName: string; customerName: string; totalPrice: number; frequency: 'weekly' | 'monthly' | 'quarterly'; nextDue: string; active: boolean }>;
  hasFullAccess: (tab: string) => boolean;
  currentLanguage: 'tr' | 'en';
  currentT: Record<string, string>;
  orders: Order[];
  leads: Lead[];
  inventory: InventoryItem[];
  exchangeRates: Record<string, number> | null;
  employees: Employee[];
  userRole: string;
  user: { email?: string | null; uid?: string; displayName?: string | null } | null;
  kpiCurrency: 'TRY' | 'USD' | 'EUR';
  activeTab: string;
  darkMode: boolean;
  warehouses: Warehouse[];
  vehicles: Vehicle[];
  locationStocks: LocationStock[];
  shipments: Shipment[];
  newOrder: Partial<Order>;
  setNewOrder: React.Dispatch<React.SetStateAction<Partial<Order>>>;
  orderLineItems: OrderLineItem[];
  setOrderLineItems: React.Dispatch<React.SetStateAction<OrderLineItem[]>>;
  handleMikroFatura: (order: Order) => Promise<void>;
  handleIyzicoPaymentLink: (order: Order) => Promise<void>;
  setRouteStops: React.Dispatch<React.SetStateAction<RouteStop[]>>;
  handleBuildRoute: () => void;
  handleClearRoute: () => void;
  handleToggleOrderPaid: (order: Order) => void;
  trackView: (item: { type: 'order' | 'lead' | 'product'; id: string; label: string; tab: string }) => void;
  openConfirm: (opts: { title: string; message: string; confirmLabel?: string; variant?: 'danger' | 'default'; onConfirm: () => void }) => void;
  toast: (msg: string, type?: string) => void;
  setActiveTab: (tab: string) => void;
  setSelectedLead: React.Dispatch<React.SetStateAction<Lead | null>>;
  setIsAddingOrder: React.Dispatch<React.SetStateAction<boolean>>;
  logAuditAction: (action: string, details: string) => Promise<void>;
}

export default function OrdersPage({
  selectedOrder, setSelectedOrder, lojistikTab, setLojistikTab,
  routeStops, isRouteOptimized, selectedDepot, setSelectedDepot, DEPOTS,
  recurringOrders, hasFullAccess, currentLanguage, currentT,
  orders, leads, inventory, exchangeRates, employees,
  userRole, user, kpiCurrency, activeTab, darkMode, warehouses, vehicles, locationStocks, shipments,
  newOrder, setNewOrder, orderLineItems, setOrderLineItems,
  handleMikroFatura, handleIyzicoPaymentLink, setRouteStops, handleBuildRoute, handleClearRoute,
  handleToggleOrderPaid, trackView, openConfirm,
  toast, setActiveTab, setSelectedLead, setIsAddingOrder,
  logAuditAction,
}: Props) {
  const [orderSearch, setOrderSearch] = useState('');
  const [orderSort, setOrderSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'syncedAt', dir: 'desc' });
  const [orderStatusFilter, setOrderStatusFilter] = useState<string>('All');
  const [orderCustomerFilter, setOrderCustomerFilter] = useState<string|null>(null);
  const [orderDateRange, setOrderDateRange] = useState<'all'|'today'|'week'|'month'|'quarter'>('all');
  const [expandedOrderId, setExpandedOrderId] = useState<string|null>(null);
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(new Set());
  const [bulkActionLoading, setBulkActionLoading] = useState(false);
  const [copiedOrderId, setCopiedOrderId] = useState<string|null>(null);
  const [starredOrders, setStarredOrders] = useState<Set<string>>(new Set());
  const [showQuickShipment, setShowQuickShipment] = useState<Order|null>(null);
  const [showInvoiceAging, setShowInvoiceAging] = useState(false);
  const [isEditingOrder, setIsEditingOrder] = useState(false);
  const [editingOrderData, setEditingOrderData] = useState<Partial<Order>>({});
  const [isAddingShipment, setIsAddingShipment] = useState(false);
  const [newShipment, setNewShipment] = useState<Partial<Shipment>>({ status: 'Pending' });
  const [editingShipmentId, setEditingShipmentId] = useState<string|null>(null);
  const [deliveryNoteOrder, setDeliveryNoteOrder] = useState<Order|null>(null);
  const [deliveryNoteText, setDeliveryNoteText] = useState('');
  const [orderNoteText, setOrderNoteText] = useState('');
  const [orderNoteSaved, setOrderNoteSaved] = useState(false);
  const [orderNoteSaving, setOrderNoteSaving] = useState(false);
  const [orderTimeline] = useState<TimelineEntry[]>([]);
  const [faturaLoading] = useState<Record<string, boolean>>({});
  const [iyzicoLinkLoading] = useState<Record<string, boolean>>({});
  const [returnModal, setReturnModal] = useState<{ open: boolean; order: Order | null }>({ open: false, order: null });
  const [returnReason, setReturnReason] = useState('');
  const [returnItems, setReturnItems] = useState<string>('');
  const [returnAmount, setReturnAmount] = useState<number>(0);
  const [showRecurringForm, setShowRecurringForm] = useState(false);
  const [recurringForm, setRecurringForm] = useState({ templateName: '', customerName: '', totalPrice: 0, frequency: 'monthly' as 'weekly' | 'monthly' | 'quarterly', nextDue: '' });
  const [shipmentSort, setShipmentSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'date', dir: 'desc' });
  const [dragIndex, setDragIndex] = useState<number|null>(null);

  // ── MİKRO ENTEGRASYONU ──
  const [orderSourceTab, setOrderSourceTab] = useState<'cetpa' | 'mikro'>('cetpa');
  const mikroSiparisler = useMikroSiparisler(true);
  const mappedMikroSiparisler = mikroSiparisler.filter(ms => ms.tip === 0).map(ms => ({
    id: ms.id,
    orderNumber: ms.evrakNo,
    customerName: ms.cariKodu,
    totalPrice: ms.tutar,
    status: 'Pending',
    createdAt: ms.tarih,
    syncedAt: ms.tarih,
    mikroBelgeNo: ms.belgeNo,
    notes: ms.satirAciklamasi,
    lineItems: []
  })) as unknown as Order[];
  
  const activeOrders = orderSourceTab === 'cetpa' ? orders : mappedMikroSiparisler;

  const [p513Selected, setP513Selected] = useState<string|null>(null);
  const [p554Bins] = useState<Array<{ id: string; warehouseId: string; warehouseName?: string; binCode: string; productSku: string; productName: string; quantity: number; minQty: number; lastCounted?: string; notes?: string }>>([]);
  const [p554AddForm, setP554AddForm] = useState(false);
  const [p554Draft, setP554Draft] = useState({ warehouseId: '', binCode: '', productSku: '', productName: '', quantity: '', minQty: '', notes: '' });
  const [p554Search, setP554Search] = useState('');
  const [p575Returns, setP575Returns] = useState<Array<{id:string;orderId:string;customerName:string;reason:string;status:'Bekliyor'|'Onaylandı'|'Reddedildi'|'Tamamlandı';amount:number;createdAt?:unknown}>>([]);
  const [p575ShowForm, setP575ShowForm] = useState(false);
  const [p575Draft, setP575Draft] = useState({orderId:'',customerName:'',reason:'',amount:''});
  const [p576Period, setP576Period] = useState<'7d'|'30d'|'90d'>('30d');
  const [p583Requests, setP583Requests] = useState<Array<{id:string;customerName:string;productName:string;serialNo?:string;issueDate?:string;warrantyEnd?:string;description:string;status:'Açık'|'İşlemde'|'Kapatıldı';priority:'Düşük'|'Orta'|'Yüksek'}>>([]);
  const [p583ShowForm, setP583ShowForm] = useState(false);
  const [p583Draft, setP583Draft] = useState({customerName:'',productName:'',serialNo:'',warrantyEnd:'',description:'',priority:'Orta' as 'Düşük'|'Orta'|'Yüksek'});
  // Araçlar artık kalıcı (Firestore 'vehicles', vehicles prop). Eski in-memory
  // p593Vehicles kaldırıldı; ekleme/güncelleme/silme Firestore'a yazar.
  const p593Vehicles = vehicles;
  const [p593ShowForm, setP593ShowForm] = useState(false);
  // Depo/araç QR etiket modalı
  const [locationQrModal, setLocationQrModal] = useState<{ type: 'warehouse' | 'vehicle'; id: string; name: string; subtitle?: string } | null>(null);
  const [p593Draft, setP593Draft] = useState({plate:'',driver:'',model:'',status:'Müsait' as 'Müsait'|'Yolda'|'Bakımda'|'Arızalı',lastService:'',nextService:'',km:'',fuel:'Dizel' as 'Benzin'|'Dizel'|'LPG'|'Elektrik'});
  const [p609Tickets, setP609Tickets] = useState<Array<{id:string;customer:string;subject:string;priority:'Düşük'|'Orta'|'Yüksek'|'Kritik';status:'Açık'|'İşlemde'|'Çözüldü'|'Kapatıldı';createdAt:string;resolvedAt?:string;slaHours:number;satisfaction?:1|2|3|4|5}>>([]);
  const [p609ShowForm, setP609ShowForm] = useState(false);
  const [p609Draft, setP609Draft] = useState({customer:'',subject:'',priority:'Orta' as 'Düşük'|'Orta'|'Yüksek'|'Kritik',slaHours:'24'});
  const [p621Demands] = useState<Array<{id:string;productName:string;sku:string;requestedQty:number;requestedBy:string;priority:'Düşük'|'Orta'|'Yüksek';status:'Bekliyor'|'Onaylandı'|'Reddedildi'|'Sipariş Verildi';notes?:string;createdAt:string}>>([]);
  const [p621ShowForm, setP621ShowForm] = useState(false);
  const [p621Draft, setP621Draft] = useState({productName:'',sku:'',requestedQty:'',requestedBy:'',priority:'Orta' as 'Düşük'|'Orta'|'Yüksek',notes:''});
  const [p622Shipments, setP622Shipments] = useState<Array<{id:string;orderRef:string;destination:string;incoterm:'EXW'|'FOB'|'CIF'|'DDP';currency:'USD'|'EUR'|'TRY';value:number;status:'Hazırlanıyor'|'Gümrükte'|'Yolda'|'Teslim Edildi';exportDate:string;customsRef?:string}>>([]);
  const [p622ShowForm, setP622ShowForm] = useState(false);
  const [p622Draft, setP622Draft] = useState({orderRef:'',destination:'',incoterm:'FOB' as 'EXW'|'FOB'|'CIF'|'DDP',currency:'USD' as 'USD'|'EUR'|'TRY',value:'',status:'Hazırlanıyor' as 'Hazırlanıyor'|'Gümrükte'|'Yolda'|'Teslim Edildi',exportDate:new Date().toISOString().slice(0,10),customsRef:''});

  // ── Kalıcılaştırma (2026-07-21): iade/talep/ticket/sevkiyat artık DB'de ────
  // Sayfa yalnız kendi sekmesinde mount olduğu için abonelikler doğal-tembel.
  const [p575EditId, setP575EditId] = useState<string | null>(null);
  const [p583EditId, setP583EditId] = useState<string | null>(null);
  const [p609EditId, setP609EditId] = useState<string | null>(null);
  const [p622EditId, setP622EditId] = useState<string | null>(null);
  useEffect(() => {
    const u: (() => void)[] = [];
    const sub = (col: string, setter: (d: unknown[]) => void) =>
      u.push(onSnapshot(query(collection(db, col)), s => setter(s.docs.map(d => ({ id: d.id, ...d.data() }))), () => {}));
    sub('salesReturns',    (d) => setP575Returns(d as typeof p575Returns));
    sub('serviceRequests', (d) => setP583Requests(d as typeof p583Requests));
    sub('helpdeskTickets', (d) => setP609Tickets(d as typeof p609Tickets));
    sub('exportShipments', (d) => setP622Shipments(d as typeof p622Shipments));
    return () => u.forEach(fn => fn());
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Siralama anahtarini karsilastirilabilir tek bir ilkel degere indirger:
  // Firestore Timestamp -> ms, metin -> kucuk harf, null/undefined -> ''.
  // (Once `let av: unknown` idi; strictNullChecks altinda '<' / '>' unknown'a uygulanamiyor.)
  const sortKeyOf = (raw: unknown): string | number => {
    if (raw && typeof (raw as { toDate?: unknown }).toDate === 'function') {
      return (raw as { toDate: () => Date }).toDate().getTime();
    }
    if (typeof raw === 'string') return raw.toLowerCase();
    if (typeof raw === 'number') return raw;
    if (raw == null) return '';
    // boolean/nesne: JS'in '<' operatorunun bu tipler icin zaten yaptigi metin cevrimi
    return String(raw);
  };

  const sortData = <T,>(arr: T[], key: string, dir: 'asc' | 'desc'): T[] =>
    [...arr].sort((a: T, b: T) => {
      const av = sortKeyOf((a as Record<string, unknown>)[key]);
      const bv = sortKeyOf((b as Record<string, unknown>)[key]);
      if (dir === 'asc') return av < bv ? -1 : av > bv ? 1 : 0;
      return av > bv ? -1 : av < bv ? 1 : 0;
    });

  const toggleSort = (
    current: { key: string; dir: 'asc' | 'desc' },
    key: string,
    setter: (v: { key: string; dir: 'asc' | 'desc' }) => void
  ) => setter({ key, dir: current.key === key && current.dir === 'asc' ? 'desc' : 'asc' });

  // Kur yoksa '—' (2026-08-26). Eskiden 2024'ten kalma SABİT kurlar (USD 32 / EUR 35)
  // kullanılıyordu — sahte kesinlik. TL yolu birebir aynı: çevrilmez, aynen biçimlenir.
  const fmtKpi = (v: number, fmt: 'full' | 'K' = 'full', decimals = 0): string => {
    const cv = kpiCurrency === 'TRY' ? v : kurCevir(v, kpiCurrency, exchangeRates);
    if (cv === null) return '—';  // sembol de basma — "$—" saçma olurdu
    const sym = kpiCurrency === 'USD' ? '$' : kpiCurrency === 'EUR' ? '€' : '₺';
    const locale = kpiCurrency === 'USD' ? 'en-US' : kpiCurrency === 'EUR' ? 'de-DE' : 'tr-TR';
    if (fmt === 'K') return `${sym}${(cv / 1000).toFixed(decimals)}K`;
    return `${sym}${cv.toLocaleString(locale, { maximumFractionDigits: decimals })}`;
  };

  const createNotification = async (title: string, message: string, type: 'info' | 'warning' | 'success' = 'info') => {
    try { await addDoc(collection(db, 'notifications'), { title, message, type, read: false, createdAt: serverTimestamp() }); } catch { /* ignore */ }
  };

  const handleDeleteOrder = async (orderId: string) => {
    try {
      await deleteDoc(doc(db, 'orders', orderId));
      logAuditAction(currentT.order_deletion || 'Order Deleted', orderId);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `orders/${orderId}`);
    }
  };

  // Sevkiyatta stok düş, iptalde geri yükle (idempotent — order.stockApplied flag).
  const applyOrderStock = async (order: Order, direction: 'out' | 'in', reason: string): Promise<string[]> => {
    const basarisiz: string[] = [];  // stoğu GÜNCELLENEMEYEN ürünler (P1)
    for (const li of (order.lineItems || []) as unknown as Array<Record<string, unknown>>) {
      const invId = (li.inventoryId as string) || '';
      const qty = Number(li.quantity) || 0;
      const inv = inventory.find(i => i.id === invId || i.sku === (li.sku as string));
      if (!inv || qty <= 0) continue;
      try {
        await incrementField('inventory', inv.id, 'stockLevel', direction === 'out' ? -qty : qty, 0);
        await addDoc(collection(db, 'inventoryMovements'), {
          type: direction, productId: inv.id, productName: inv.name || (li.name as string) || inv.id,
          quantity: qty, reason, orderId: order.id, timestamp: serverTimestamp(),
        });
      } catch (err) {
        console.error('[applyOrderStock]', err);
        basarisiz.push(inv.name || inv.id);
      }
    }
    return basarisiz;
  };

  const handleUpdateOrderStatus = async (orderId: string, status: Order['status']) => {
    try {
      await updateDoc(doc(db, 'orders', orderId), { status, updatedAt: serverTimestamp(), ...(status === 'Delivered' ? { deliveredAt: serverTimestamp() } : {}) });
      const ord = orders.find(o => o.id === orderId);
      const applied = (ord as unknown as Record<string, unknown> | undefined)?.stockApplied === true;
      // BAYRAK YALNIZ TAM BAŞARIDA (2026-08-22 denetim bulgusu P1→CONFIRMED):
      // eskiden satır hatası yutulup (console.error) bayrak KOŞULSUZ true
      // yapılıyordu — stok hiç düşmemişken sipariş "stok uygulandı" sayılıyor,
      // idempotency bayrağı da yeniden denemeyi sonsuza dek engelliyordu.
      // Kısmi başarıda bayrağı yine set ediyoruz (başarılı satırları ikinci kez
      // düşmemek için) ama kullanıcıya YÜKSEK SESLE hangi satırların düşmediğini
      // söylüyoruz — sessiz yanlış stok, gürültülü eksik stoktan kötüdür.
      if (ord && !applied && (status === 'Shipped' || status === 'Delivered')) {
        const hatalilar = await applyOrderStock(ord, 'out', currentLanguage === 'tr' ? 'Sevkiyat' : 'Shipment');
        await updateDoc(doc(db, 'orders', orderId), { stockApplied: true });
        if (hatalilar.length) createNotification(currentLanguage === 'tr' ? 'Stok Uyarısı' : 'Stock Warning', currentLanguage === 'tr'
          ? `DİKKAT: ${hatalilar.length} ürünün stoğu düşürülemedi: ${hatalilar.join(', ')} — elle düzeltin.`
          : `WARNING: stock not decremented for ${hatalilar.length} item(s): ${hatalilar.join(', ')} — fix manually.`, 'warning');
      } else if (ord && applied && status === 'Cancelled') {
        const hatalilar = await applyOrderStock(ord, 'in', currentLanguage === 'tr' ? 'Sipariş iptali' : 'Order cancelled');
        await updateDoc(doc(db, 'orders', orderId), { stockApplied: false });
        if (hatalilar.length) createNotification(currentLanguage === 'tr' ? 'Stok Uyarısı' : 'Stock Warning', currentLanguage === 'tr'
          ? `DİKKAT: ${hatalilar.length} ürünün stoğu geri yüklenemedi: ${hatalilar.join(', ')} — elle düzeltin.`
          : `WARNING: stock not restored for ${hatalilar.length} item(s): ${hatalilar.join(', ')} — fix manually.`, 'warning');
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `orders/${orderId}`);
    }
  };

  const handleSaveOrderNote = async () => {
    if (!selectedOrder || orderNoteText === (selectedOrder.notes ?? '')) return;
    setOrderNoteSaving(true);
    try {
      await updateDoc(doc(db, 'orders', selectedOrder.id), { notes: orderNoteText, updatedAt: serverTimestamp() });
      setSelectedOrder({ ...selectedOrder, notes: orderNoteText });
      setOrderNoteSaved(true);
      setTimeout(() => setOrderNoteSaved(false), 2000);
    } catch (e) {
      console.error('[handleSaveOrderNote]', e);
      toast(currentLanguage === 'tr' ? 'Not kaydedilemedi.' : 'Could not save note.', 'error');
    } finally { setOrderNoteSaving(false); }
  };

  const handleDeleteShipment = async (shipmentId: string) => {
    if (!await confirmDelete(undefined, currentLanguage === 'tr' ? 'tr' : 'en')) return;
    try { await deleteDoc(doc(db, 'shipments', shipmentId)); }
    catch (error) { handleFirestoreError(error, OperationType.DELETE, `shipments/${shipmentId}`); }
  };

  const handleEditShipment = (shipment: Shipment) => {
    setEditingShipmentId(shipment.id);
    setNewShipment({ ...shipment });
    setIsAddingShipment(true);
  };

  const handleDragStart = (index: number) => setDragIndex(index);
  const handleDragEnd = () => setDragIndex(null);
  const handleDragOver = (e: React.DragEvent, toIndex: number) => {
    e.preventDefault();
    if (dragIndex === null || dragIndex === toIndex) return;
    setRouteStops(prev => {
      const next = [...prev];
      const [moved] = next.splice(dragIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
    setDragIndex(toIndex);
  };

  return (
    <>
      {activeTab === 'orders' && !selectedOrder && (
        <motion.div key="orders-list" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-6">
              <AIInlineNudge
                context="orders"
                currentLanguage={currentLanguage}
                data={{
                  pendingOrderCount: activeOrders.filter(o=>o.status==='Pending').length,
                  topRisk: activeOrders.filter(o=>o.status==='Processing').length > 5
                    ? (currentLanguage==='tr' ? `${activeOrders.filter(o=>o.status==='Processing').length} sipariş işlemde bekliyor` : `${activeOrders.filter(o=>o.status==='Processing').length} orders stuck in processing`)
                    : undefined
                }}
                onAction={() => {}}
              />
              <ModuleHeader
                title={currentT.all_orders}
                subtitle={currentT.manage_orders}
                icon={Package}
                actionButton={
                  <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
                    <div className="relative w-full sm:w-auto">
                      <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input
                        type="text"
                        placeholder={currentT.search_orders}
                        value={orderSearch}
                        onChange={(e) => setOrderSearch(e.target.value)}
                        className="pl-9 pr-4 py-2 bg-white border border-gray-200 rounded-full text-sm outline-none focus:border-brand w-full sm:w-64 transition-all"
                      />
                    </div>
                    {/* Phase 93: Export filtered orders to CSV */}
                    <button
                      onClick={() => {
                        const filtered = activeOrders.filter(o =>
                          (orderStatusFilter === 'All' || o.status === orderStatusFilter) &&
                          (o.customerName.toLowerCase().includes(orderSearch.toLowerCase()) ||
                          (o.shopifyOrderId ?? '').toLowerCase().includes(orderSearch.toLowerCase()) ||
                          (o.shippingAddress ?? '').toLowerCase().includes(orderSearch.toLowerCase()))
                        );
                        exportOrdersCSV(filtered, currentLanguage);
                        toast(
                          currentLanguage === 'tr'
                            ? `${filtered.length} sipariş CSV olarak indirildi`
                            : `${filtered.length} order${filtered.length !== 1 ? 's' : ''} exported to CSV`,
                          'success'
                        );
                      }}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-full border border-gray-200 bg-white hover:bg-gray-50 text-gray-600 text-xs font-semibold transition-colors"
                      title={currentLanguage === 'tr' ? 'Filtrelenmiş siparişleri CSV olarak indir' : 'Export filtered orders as CSV'}
                    >
                      <Download className="w-3.5 h-3.5" />
                      {orderStatusFilter !== 'All'
                        ? `CSV (${activeOrders.filter(o => o.status === orderStatusFilter).length})`
                        : 'CSV'}
                    </button>
                    <button onClick={() => { setSelectedLead(null); setIsAddingOrder(true); }}
                      className="apple-button-primary">
                      <Plus className="w-4 h-4" /> {currentT.new_order}
                    </button>
                  </div>
                }
              />
              <div className="flex gap-2 mb-4 bg-gray-100/50 p-1 rounded-xl w-fit">
                <button
                  onClick={() => setOrderSourceTab('cetpa')}
                  className={clsx("px-4 py-2 rounded-lg text-sm font-semibold transition-all flex items-center gap-2", orderSourceTab === 'cetpa' ? "bg-white text-brand shadow-sm" : "text-gray-500 hover:text-gray-700")}
                >
                  <Package className="w-4 h-4" />
                  {currentLanguage === 'tr' ? 'Cetpa Siparişleri' : 'Cetpa Orders'}
                </button>
                <button
                  onClick={() => setOrderSourceTab('mikro')}
                  className={clsx("px-4 py-2 rounded-lg text-sm font-semibold transition-all flex items-center gap-2", orderSourceTab === 'mikro' ? "bg-white text-brand shadow-sm" : "text-gray-500 hover:text-gray-700")}
                >
                  <RefreshCw className="w-4 h-4" />
                  {currentLanguage === 'tr' ? 'Mikro Siparişleri' : 'Mikro Orders'}
                </button>
              </div>

              {/* ── Phase 522: Order Fulfillment Rate KPI strip ── */}
              {activeOrders.length >= 3 && (() => {
                const total522 = activeOrders.filter(o => o.status !== 'Cancelled').length;
                const delivered522 = activeOrders.filter(o => o.status === 'Delivered').length;
                const pending522 = activeOrders.filter(o => o.status === 'Pending').length;
                const inProgress522 = activeOrders.filter(o => o.status === 'Processing' || o.status === 'Shipped').length;
                const fulfillRate = total522 > 0 ? Math.round((delivered522 / total522) * 100) : 0;
                const unpaidOrders = activeOrders.filter(o => !o.paid && o.status !== 'Cancelled');
                const unpaidTotal = unpaidOrders.reduce((s, o) => s + (o.totalPrice || 0), 0);
                return (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {[
                      { label: currentLanguage === 'tr' ? 'Teslimat Oranı' : 'Fulfillment Rate', value: `${fulfillRate}%`, color: fulfillRate >= 80 ? 'text-emerald-600' : fulfillRate >= 60 ? 'text-amber-600' : 'text-red-600', bg: 'bg-white', sub: `${delivered522} / ${total522}` },
                      { label: currentLanguage === 'tr' ? 'Bekleyen' : 'Pending', value: pending522.toString(), color: pending522 > 0 ? 'text-amber-600' : 'text-gray-400', bg: 'bg-white', sub: null },
                      { label: currentLanguage === 'tr' ? 'Hazırlanıyor/Kargoda' : 'In Progress', value: inProgress522.toString(), color: inProgress522 > 0 ? 'text-blue-600' : 'text-gray-400', bg: 'bg-white', sub: null },
                      { label: currentLanguage === 'tr' ? 'Alacak Toplam' : 'Outstanding', value: `₺${(unpaidTotal/1000).toFixed(1)}K`, color: unpaidTotal > 0 ? 'text-red-600' : 'text-emerald-600', bg: unpaidTotal > 0 ? 'bg-red-50' : 'bg-white',
                        sub: unpaidOrders.length > 0 ? `${unpaidOrders.length} ${currentLanguage==='tr'?'sipariş':'orders'}` : null },
                    ].map((k, i) => (
                      <div key={i} className={cn("rounded-xl border border-gray-100 shadow-sm px-4 py-3", k.bg)}>
                        <p className={cn("text-xl font-black", k.color)}>{k.value}</p>
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mt-0.5">{k.label}</p>
                        {k.sub && <p className="text-[9px] text-gray-400 mt-0.5">{k.sub}</p>}
                      </div>
                    ))}
                  </div>
                );
              })()}

              {/* ── Phase 521: Invoice Aging Alert ── */}
              {(() => {
                const unpaid521 = activeOrders.filter(o => !o.paid && o.status !== 'Cancelled' && (o.createdAt || o.syncedAt));
                if (unpaid521.length === 0) return null;
                const now521 = Date.now();
                const buckets521 = [
                  { label: '0–30', labelTR: '0–30 gün', items: [] as typeof unpaid521 },
                  { label: '31–60', labelTR: '31–60 gün', items: [] as typeof unpaid521 },
                  { label: '61–90', labelTR: '61–90 gün', items: [] as typeof unpaid521 },
                  { label: '90+', labelTR: '90+ gün', items: [] as typeof unpaid521 },
                ];
                for (const o of unpaid521) {
                  const raw = o.createdAt ?? o.syncedAt;
                  const d = typeof (raw as { toDate?: () => Date }).toDate === 'function'
                    ? (raw as { toDate: () => Date }).toDate() : new Date(raw as string | number);
                  const age = Math.floor((now521 - d.getTime()) / 86400000);
                  if (age <= 30) buckets521[0].items.push(o);
                  else if (age <= 60) buckets521[1].items.push(o);
                  else if (age <= 90) buckets521[2].items.push(o);
                  else buckets521[3].items.push(o);
                }
                const hasOld = buckets521[1].items.length + buckets521[2].items.length + buckets521[3].items.length > 0;
                if (!hasOld && !showInvoiceAging) return (
                  <button onClick={() => setShowInvoiceAging(true)}
                    className="text-[10px] font-semibold text-gray-400 hover:text-red-600 transition-colors flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    {unpaid521.length} {currentLanguage === 'tr' ? 'ödenmemiş sipariş — Alacak yaşlandırması görüntüle' : 'unpaid orders — Show aging'}
                  </button>
                );
                return (
                  <div className={cn("rounded-2xl border overflow-hidden", hasOld ? "border-red-200 bg-red-50/30" : "border-gray-200 bg-white")}>
                    <button onClick={() => setShowInvoiceAging(!showInvoiceAging)} className="w-full flex items-center justify-between px-5 py-3 text-left">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className={cn("w-4 h-4", hasOld ? "text-red-500" : "text-amber-400")} />
                        <span className="text-xs font-bold text-gray-800">
                          {currentLanguage === 'tr' ? 'Alacak Yaşlandırma Raporu' : 'Invoice Aging Report'}
                        </span>
                        <span className={cn("text-[10px] font-black px-2 py-0.5 rounded-full", hasOld ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700")}>
                          {unpaid521.length} {currentLanguage === 'tr' ? 'açık' : 'open'}
                        </span>
                      </div>
                      <ChevronDown className={cn("w-4 h-4 text-gray-400 transition-transform", showInvoiceAging && "rotate-180")} />
                    </button>
                    {showInvoiceAging && (
                      <div className="px-5 pb-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
                        {buckets521.map(b => (
                          <div key={b.label} className={cn("rounded-xl border p-3 text-center", b.items.length > 0 ? (b.label === '90+' ? 'bg-red-100 border-red-200' : b.label === '61–90' ? 'bg-orange-50 border-orange-100' : b.label === '31–60' ? 'bg-amber-50 border-amber-100' : 'bg-white border-gray-100') : 'bg-white border-gray-100 opacity-50')}>
                            <p className={cn("text-2xl font-black", b.items.length > 0 && b.label === '90+' ? 'text-red-600' : b.items.length > 0 ? 'text-amber-700' : 'text-gray-300')}>
                              {b.items.length}
                            </p>
                            <p className="text-[10px] font-bold text-gray-400 uppercase mt-0.5">{currentLanguage === 'tr' ? b.labelTR : b.label}</p>
                            <p className="text-[9px] text-gray-500 mt-1">
                              ₺{b.items.reduce((s,o)=>s+(o.totalPrice||0),0).toLocaleString('tr-TR',{maximumFractionDigits:0})}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* ── Bulk action bar (appears when orders are selected) ── */}
              {selectedOrderIds.size > 0 && (
                <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-[#1a3a5c] text-white px-5 py-3 rounded-2xl shadow-2xl border border-white/10">
                  <span className="text-sm font-bold">{selectedOrderIds.size} {currentLanguage === 'tr' ? 'sipariş seçildi' : 'orders selected'}</span>
                  <div className="w-px h-5 bg-white/20" />
                  {(['Processing', 'Shipped', 'Delivered'] as Order['status'][]).map(s => (
                    <button
                      key={s}
                      disabled={bulkActionLoading}
                      onClick={() => openConfirm({
                        title: currentLanguage === 'tr' ? 'Toplu Güncelleme' : 'Bulk Update',
                        message: `${selectedOrderIds.size} ${currentLanguage === 'tr' ? 'siparişin durumunu' : "orders'"} "${s}" ${currentLanguage === 'tr' ? 'olarak güncellensin mi?' : 'status update?'}`,
                        onConfirm: async () => {
                          setBulkActionLoading(true);
                          for (const id of selectedOrderIds) {
                            await handleUpdateOrderStatus(id, s);
                          }
                          setSelectedOrderIds(new Set());
                          setBulkActionLoading(false);
                        },
                      })}
                      className="text-xs font-bold px-3 py-1.5 rounded-xl bg-white/15 hover:bg-white/25 transition-colors disabled:opacity-50"
                    >
                      → {s}
                    </button>
                  ))}
                  <div className="w-px h-5 bg-white/20" />
                  {/* Phase 97: Bulk mark as paid */}
                  <button
                    disabled={bulkActionLoading}
                    onClick={() => openConfirm({
                      title: currentLanguage === 'tr' ? 'Toplu Ödeme Onayla' : 'Bulk Mark Paid',
                      message: `${selectedOrderIds.size} ${currentLanguage === 'tr' ? 'sipariş ödendi olarak işaretlensin mi?' : 'orders marked as paid?'}`,
                      confirmLabel: currentLanguage === 'tr' ? '✓ Ödendi Yap' : '✓ Mark Paid',
                      onConfirm: async () => {
                        setBulkActionLoading(true);
                        const sel = activeOrders.filter(o => selectedOrderIds.has(o.id));
                        for (const o of sel) {
                          if (!o.paid) await handleToggleOrderPaid(o);
                        }
                        setSelectedOrderIds(new Set());
                        setBulkActionLoading(false);
                        toast(
                          currentLanguage === 'tr'
                            ? `${sel.length} sipariş ödendi olarak işaretlendi ✓`
                            : `${sel.length} order${sel.length !== 1 ? 's' : ''} marked as paid ✓`,
                          'success'
                        );
                      },
                    })}
                    className="text-xs font-bold px-3 py-1.5 rounded-xl bg-emerald-500/80 hover:bg-emerald-500 transition-colors disabled:opacity-50 flex items-center gap-1.5"
                  >
                    <CreditCard className="w-3.5 h-3.5" />
                    {currentLanguage === 'tr' ? 'Ödendi' : 'Mark Paid'}
                  </button>
                  <div className="w-px h-5 bg-white/20" />
                  <button
                    onClick={() => {
                      // Bulk PDF export: generate one PDF with all selected orders
                      const sel = activeOrders.filter(o => selectedOrderIds.has(o.id));
                      import('jspdf').then(({ jsPDF }) => {
                        import('jspdf-autotable').then(async ({ default: autoTable }) => {
                          const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
                          await registerTurkishFont(pdf);
                          // Marka basligi + ortak tablo stili (src/utils/pdfTheme.ts).
                          // Bu belge duz metin baslik ve autoTable'in VARSAYILAN
                          // MAVI tablosuyla cikiyordu.
                          const govdeY = pdfBaslik(pdf, {
                            belgeAdi: currentLanguage === 'tr' ? 'SİPARİŞ LİSTESİ' : 'ORDER LIST',
                            meta: new Date().toLocaleDateString('tr-TR'),
                          });
                          autoTable(pdf, {
                            ...pdfTabloStili(),
                            startY: govdeY,
                            head: [['#', currentLanguage==='tr'?'Müşteri':'Customer', currentLanguage==='tr'?'Durum':'Status', currentLanguage==='tr'?'Tutar':'Amount']],
                            // Para 2 ondalik: locale verilse de ondalik verilmezse
                            // tarayici 3 haneye kadar basabiliyor.
                            body: sel.map(o => [o.shopifyOrderId ?? o.id.slice(0,8), o.customerName, o.status,
                              `₺${(Number(o.totalPrice) || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`]),
                          });
                          pdfAltBilgi(pdf);
                          pdf.save(`siparisler_${new Date().toISOString().split('T')[0]}.pdf`);
                        });
                      });
                    }}
                    className="text-xs font-bold px-3 py-1.5 rounded-xl bg-white/15 hover:bg-white/25 transition-colors flex items-center gap-1.5"
                  >
                    <Download className="w-3.5 h-3.5" /> PDF
                  </button>
                  <button
                    onClick={() => setSelectedOrderIds(new Set())}
                    className="p-1.5 rounded-lg hover:bg-white/20 transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}

              {/* ── Phase 119: Recurring Order Templates ── */}
              {(() => {
                const dueToday = recurringOrders.filter(r => r.active && r.nextDue && new Date(r.nextDue) <= new Date());
                return (
                  <div className="space-y-3">
                    {/* Due now alert */}
                    {dueToday.length > 0 && (
                      <div className="flex items-center gap-3 bg-blue-50 border border-blue-100 rounded-2xl px-5 py-3">
                        <RefreshCw size={15} className="text-blue-500 flex-shrink-0" />
                        <p className="text-sm font-semibold text-blue-800">
                          {currentLanguage === 'tr'
                            ? `${dueToday.length} tekrarlayan sipariş bugün/geçmiş vadede.`
                            : `${dueToday.length} recurring order${dueToday.length !== 1 ? 's' : ''} due today or overdue.`}
                        </p>
                      </div>
                    )}

                    <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
                      <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <RefreshCw size={14} className="text-gray-400" />
                          <h3 className="text-sm font-bold text-gray-700">
                            {currentLanguage === 'tr' ? 'Tekrarlayan Siparişler' : 'Recurring Orders'}
                          </h3>
                          {recurringOrders.length > 0 && (
                            <span className="text-[10px] bg-gray-100 text-gray-500 font-bold px-1.5 py-0.5 rounded-full">
                              {recurringOrders.filter(r => r.active).length}
                            </span>
                          )}
                        </div>
                        <button
                          onClick={() => setShowRecurringForm(v => !v)}
                          className="text-[10px] font-bold text-brand hover:underline flex items-center gap-1"
                        >
                          <Plus size={11} />{currentLanguage === 'tr' ? 'Şablon Ekle' : 'Add Template'}
                        </button>
                      </div>

                      {/* Add form */}
                      <AnimatePresence>
                        {showRecurringForm && (
                          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                            <div className="p-4 bg-gray-50 border-b border-gray-100 space-y-3">
                              <div className="grid grid-cols-2 gap-3">
                                <input className="apple-input text-sm" placeholder={currentLanguage === 'tr' ? 'Şablon adı' : 'Template name'}
                                  value={recurringForm.templateName} onChange={e => setRecurringForm(f => ({ ...f, templateName: e.target.value }))} />
                                <input className="apple-input text-sm" placeholder={currentLanguage === 'tr' ? 'Müşteri adı' : 'Customer name'}
                                  value={recurringForm.customerName} onChange={e => setRecurringForm(f => ({ ...f, customerName: e.target.value }))} />
                                <div className="relative">
                                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-gray-400">₺</span>
                                  <input type="number" className="apple-input text-sm pl-6 w-full" placeholder={currentLanguage === 'tr' ? 'Tutar' : 'Amount'}
                                    value={recurringForm.totalPrice || ''} onChange={e => setRecurringForm(f => ({ ...f, totalPrice: Number(e.target.value) }))} />
                                </div>
                                <select className="apple-input text-sm" value={recurringForm.frequency} onChange={e => setRecurringForm(f => ({ ...f, frequency: e.target.value as typeof recurringForm.frequency }))}>
                                  <option value="weekly">{currentLanguage === 'tr' ? 'Haftalık' : 'Weekly'}</option>
                                  <option value="monthly">{currentLanguage === 'tr' ? 'Aylık' : 'Monthly'}</option>
                                  <option value="quarterly">{currentLanguage === 'tr' ? '3 Aylık' : 'Quarterly'}</option>
                                </select>
                              </div>
                              <div className="flex items-center gap-2">
                                <label className="text-xs text-gray-500">{currentLanguage === 'tr' ? 'Sonraki vade:' : 'Next due:'}</label>
                                <input type="date" className="apple-input text-sm" value={recurringForm.nextDue} onChange={e => setRecurringForm(f => ({ ...f, nextDue: e.target.value }))} />
                                <button
                                  disabled={!recurringForm.templateName || !recurringForm.customerName}
                                  onClick={async () => {
                                    if (!recurringForm.templateName) return;
                                    await addDoc(collection(db, 'recurringOrders'), { ...recurringForm, active: true, createdAt: serverTimestamp() });
                                    setRecurringForm({ templateName: '', customerName: '', totalPrice: 0, frequency: 'monthly', nextDue: '' });
                                    setShowRecurringForm(false);
                                    toast(currentLanguage === 'tr' ? 'Şablon eklendi.' : 'Template added.', 'success');
                                  }}
                                  className="apple-button-primary text-xs px-4 ml-auto disabled:opacity-50"
                                >{currentLanguage === 'tr' ? 'Ekle' : 'Add'}</button>
                              </div>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>

                      {recurringOrders.length === 0 ? (
                        <div className="py-8 text-center">
                          <RefreshCw size={28} className="mx-auto mb-2 text-gray-200" />
                          <p className="text-xs text-gray-400">{currentLanguage === 'tr' ? 'Tekrarlayan sipariş şablonu yok.' : 'No recurring order templates.'}</p>
                        </div>
                      ) : (
                        <div className="divide-y divide-gray-50">
                          {recurringOrders.map(r => {
                            const due = r.nextDue ? new Date(r.nextDue) : null;
                            const overdue = due && due <= new Date();
                            return (
                              <div key={r.id} className="flex items-center gap-3 px-5 py-3">
                                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${r.active ? (overdue ? 'bg-red-400' : 'bg-emerald-400') : 'bg-gray-200'}`} />
                                <div className="flex-1 min-w-0">
                                  <p className="text-xs font-bold text-gray-800 truncate">{r.templateName}</p>
                                  <p className="text-[10px] text-gray-400">{r.customerName} · {fmtKpi((r.totalPrice || 0))}</p>
                                </div>
                                <span className="text-[10px] text-gray-500 flex-shrink-0">
                                  {r.frequency === 'weekly' ? (currentLanguage === 'tr' ? 'Haftalık' : 'Weekly')
                                    : r.frequency === 'monthly' ? (currentLanguage === 'tr' ? 'Aylık' : 'Monthly')
                                    : (currentLanguage === 'tr' ? '3 Aylık' : 'Quarterly')}
                                </span>
                                {due && (
                                  <span className={`text-[10px] font-bold flex-shrink-0 ${overdue ? 'text-red-600' : 'text-gray-500'}`}>
                                    {overdue ? '⚠ ' : ''}{due.toLocaleDateString(currentLanguage === 'tr' ? 'tr-TR' : 'en-US', { day: 'numeric', month: 'short' })}
                                  </span>
                                )}
                                <button
                                  onClick={async () => {
                                    await updateDoc(doc(db, 'recurringOrders', r.id), { active: !r.active });
                                  }}
                                  className={`text-[9px] font-bold px-2 py-0.5 rounded-full transition-colors flex-shrink-0 ${r.active ? 'bg-emerald-100 text-emerald-700 hover:bg-red-100 hover:text-red-700' : 'bg-gray-100 text-gray-500 hover:bg-emerald-100 hover:text-emerald-700'}`}
                                >
                                  {r.active ? (currentLanguage === 'tr' ? 'Aktif' : 'Active') : (currentLanguage === 'tr' ? 'Pasif' : 'Paused')}
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* ── Phase 55: Status Filter Chips ── */}
              <div className="flex flex-wrap gap-1.5">
                {(['All', 'Pending', 'Processing', 'Shipped', 'Delivered', 'Cancelled'] as const).map(s => {
                  const count = s === 'All' ? activeOrders.length : activeOrders.filter(o => o.status === s).length;
                  const isActive = orderStatusFilter === s;
                  const chipColors: Record<string, string> = {
                    All:        'bg-gray-900 text-white',
                    Pending:    'bg-amber-500 text-white',
                    Processing: 'bg-purple-500 text-white',
                    Shipped:    'bg-blue-500 text-white',
                    Delivered:  'bg-emerald-500 text-white',
                    Cancelled:  'bg-gray-400 text-white',
                  };
                  const labelTR: Record<string, string> = { All: 'Tümü', Pending: 'Bekliyor', Processing: 'Hazırlanıyor', Shipped: 'Kargoda', Delivered: 'Teslim', Cancelled: 'İptal' };
                  return (
                    <button
                      key={s}
                      onClick={() => setOrderStatusFilter(s)}
                      className={cn(
                        "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-all border",
                        isActive
                          ? `${chipColors[s]} border-transparent shadow-sm`
                          : darkMode
                            ? "bg-white/5 border-white/10 text-white/60 hover:bg-white/10"
                            : "bg-white border-gray-200 text-gray-500 hover:border-gray-300 hover:text-gray-800"
                      )}
                    >
                      {currentLanguage === 'tr' ? labelTR[s] : s}
                      <span className={cn("text-[9px] px-1 py-0.5 rounded-full", isActive ? "bg-white/20" : darkMode ? "bg-white/10" : "bg-gray-100 text-gray-500")}>
                        {count}
                      </span>
                    </button>
                  );
                })}
                {/* Phase 509: Starred filter chip */}
                {starredOrders.size > 0 && (
                  <button
                    onClick={() => setOrderStatusFilter(orderStatusFilter === '__starred__' ? 'All' : '__starred__')}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-all border",
                      orderStatusFilter === '__starred__'
                        ? "bg-amber-400 text-white border-transparent shadow-sm"
                        : darkMode ? "bg-white/5 border-white/10 text-white/60 hover:bg-white/10" : "bg-white border-gray-200 text-gray-500 hover:border-gray-300 hover:text-amber-600"
                    )}
                  >
                    ★ {currentLanguage === 'tr' ? 'Yıldızlı' : 'Starred'}
                    <span className={cn("text-[9px] px-1 py-0.5 rounded-full", orderStatusFilter === '__starred__' ? "bg-white/20" : darkMode ? "bg-white/10" : "bg-gray-100")}>{starredOrders.size}</span>
                  </button>
                )}
              </div>

              {/* Phase 523: Active customer filter chip */}
              {orderCustomerFilter && (
                <div className="flex items-center gap-2 px-3 py-2 bg-brand/10 border border-brand/20 rounded-xl text-xs font-bold text-brand">
                  <Users className="w-3.5 h-3.5 flex-shrink-0" />
                  {orderCustomerFilter}
                  <button onClick={() => setOrderCustomerFilter(null)} className="ml-1 hover:text-red-600 transition-colors"><X className="w-3.5 h-3.5" /></button>
                </div>
              )}

              {/* ── Phase 501: Date Range Quick Filter ── */}
              <div className="flex flex-wrap gap-1.5 items-center">
                <span className={cn("text-[10px] font-semibold uppercase tracking-wider", darkMode ? "text-white/65" : "text-gray-400")}>
                  {currentLanguage === 'tr' ? 'Dönem' : 'Period'}:
                </span>
                {([
                  { v: 'all',     tr: 'Tümü',       en: 'All Time' },
                  { v: 'today',   tr: 'Bugün',       en: 'Today' },
                  { v: 'week',    tr: 'Bu Hafta',    en: 'This Week' },
                  { v: 'month',   tr: 'Bu Ay',       en: 'This Month' },
                  { v: 'quarter', tr: 'Bu Çeyrek',   en: 'This Quarter' },
                ] as { v: 'all'|'today'|'week'|'month'|'quarter'; tr: string; en: string }[]).map(({ v, tr, en }) => (
                  <button key={v} onClick={() => setOrderDateRange(v)}
                    className={cn(
                      "px-3 py-1.5 rounded-full text-xs font-semibold transition-all border",
                      orderDateRange === v
                        ? "bg-brand text-white border-transparent shadow-sm"
                        : darkMode
                          ? "bg-white/5 border-white/10 text-white/60 hover:bg-white/10"
                          : "bg-white border-gray-200 text-gray-500 hover:border-gray-300 hover:text-gray-800"
                    )}>
                    {currentLanguage === 'tr' ? tr : en}
                  </button>
                ))}
              </div>

              {/* ── Phase 70: Order Aging Alert ── */}
              {(() => {
                const now = Date.now();
                const THREE_DAYS = 3 * 86400000;
                const stuckOrders = activeOrders.filter(o => {
                  if (o.status !== 'Pending' && o.status !== 'Processing') return false;
                  const raw = o.createdAt ?? o.syncedAt;
                  if (!raw) return false;
                  const d = typeof (raw as { toDate?: () => Date }).toDate === 'function'
                    ? (raw as { toDate: () => Date }).toDate()
                    : new Date(raw as string | number | Date);
                  return now - d.getTime() > THREE_DAYS;
                });
                if (stuckOrders.length === 0) return null;
                const pendingStuck    = stuckOrders.filter(o => o.status === 'Pending').length;
                const processingStuck = stuckOrders.filter(o => o.status === 'Processing').length;
                return (
                  <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                    <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center flex-shrink-0">
                      <AlertCircle className="w-4 h-4 text-amber-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-amber-800">
                        {currentLanguage === 'tr'
                          ? `${stuckOrders.length} sipariş 3+ gündür bekliyor`
                          : `${stuckOrders.length} order${stuckOrders.length > 1 ? 's' : ''} stuck for 3+ days`}
                      </p>
                      <p className="text-[10px] text-amber-600 mt-0.5">
                        {[
                          pendingStuck    > 0 && `${pendingStuck} Pending`,
                          processingStuck > 0 && `${processingStuck} Processing`,
                        ].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                    <button
                      onClick={() => setOrderStatusFilter('Pending')}
                      className="text-[10px] font-bold text-amber-700 hover:text-amber-900 bg-amber-100 hover:bg-amber-200 px-2.5 py-1 rounded-full transition-colors flex-shrink-0"
                    >
                      {currentLanguage === 'tr' ? 'İncele' : 'Review'}
                    </button>
                  </div>
                );
              })()}

              {/* Desktop Table View */}
              <div className="hidden md:block bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        {/* Select-all checkbox */}
                        <th className="pl-4 py-4 w-8">
                          <input
                            type="checkbox"
                            className="rounded accent-brand cursor-pointer"
                            checked={selectedOrderIds.size > 0 && (() => {
                              const filtered = activeOrders.filter(o =>
                                o.customerName.toLowerCase().includes(orderSearch.toLowerCase()) ||
                                o.shopifyOrderId?.toLowerCase().includes(orderSearch.toLowerCase())
                              );
                              return filtered.every(o => selectedOrderIds.has(o.id));
                            })()}
                            onChange={e => {
                              const filtered = activeOrders.filter(o =>
                                o.customerName.toLowerCase().includes(orderSearch.toLowerCase()) ||
                                o.shopifyOrderId?.toLowerCase().includes(orderSearch.toLowerCase())
                              );
                              if (e.target.checked) {
                                setSelectedOrderIds(new Set(filtered.map(o => o.id)));
                              } else {
                                setSelectedOrderIds(new Set());
                              }
                            }}
                          />
                        </th>
                        <th className="px-6 py-4 font-bold text-gray-500 uppercase text-[10px] tracking-wider">{currentT.order_id}</th>
                        {[
                          { key: 'customerName', label: currentT.customer },
                          { key: 'syncedAt', label: currentT.date },
                          { key: 'status', label: currentT.status },
                        ].map(col => (
                          <th key={col.key}
                            className="px-6 py-4 font-bold text-gray-500 uppercase text-[10px] tracking-wider cursor-pointer select-none group hover:text-brand transition-colors"
                            onClick={() => toggleSort(orderSort, col.key, setOrderSort)}>
                            {col.label}<SortIcon col={col.key} config={orderSort} />
                          </th>
                        ))}
                        <th className="px-6 py-4 font-bold text-gray-500 uppercase text-[10px] tracking-wider text-right cursor-pointer select-none group hover:text-brand transition-colors"
                          onClick={() => toggleSort(orderSort, 'totalPrice', setOrderSort)}>
                          {currentT.total}<SortIcon col="totalPrice" config={orderSort} />
                        </th>
                        <th className="px-6 py-4 font-bold text-gray-500 uppercase text-[10px] tracking-wider text-right">{currentT.actions}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {(() => {
                        const filtered = activeOrders.filter(o => {
                          if (orderStatusFilter === '__starred__' && !starredOrders.has(o.id)) return false;
                          if (orderStatusFilter !== 'All' && orderStatusFilter !== '__starred__' && o.status !== orderStatusFilter) return false;
                          // Phase 523: customer filter
                          if (orderCustomerFilter && o.customerName !== orderCustomerFilter) return false;
                          const q = orderSearch.toLowerCase();
                          if (q && !o.customerName.toLowerCase().includes(q) && !o.shopifyOrderId?.toLowerCase().includes(q) && !o.shippingAddress?.toLowerCase().includes(q)) return false;
                          // Phase 501: date range filter
                          if (orderDateRange !== 'all') {
                            const raw = o.createdAt ?? o.syncedAt;
                            if (raw) {
                              const d = typeof (raw as { toDate?: () => Date }).toDate === 'function'
                                ? (raw as { toDate: () => Date }).toDate()
                                : new Date(raw as string | number | Date);
                              const now = new Date();
                              if (orderDateRange === 'today' && d.toDateString() !== now.toDateString()) return false;
                              if (orderDateRange === 'week') { const ws = new Date(now); ws.setDate(now.getDate() - now.getDay()); ws.setHours(0,0,0,0); if (d < ws) return false; }
                              if (orderDateRange === 'month' && (d.getMonth() !== now.getMonth() || d.getFullYear() !== now.getFullYear())) return false;
                              if (orderDateRange === 'quarter' && (Math.floor(d.getMonth()/3) !== Math.floor(now.getMonth()/3) || d.getFullYear() !== now.getFullYear())) return false;
                            }
                          }
                          return true;
                        });
                        const sorted = sortData(filtered, orderSort.key, orderSort.dir);
                        return sorted.length === 0 ? (
                          <tr><td colSpan={7} className="px-6 py-12 text-center text-gray-500">{currentT.no_orders_found}</td></tr>
                        ) : sorted.map(order => (
                          <React.Fragment key={order.id}>
                          <tr
                            className={cn("hover:bg-gray-50 transition-colors cursor-pointer", selectedOrderIds.has(order.id) && "bg-brand/5")}
                            onClick={() => { setSelectedOrder(order); trackView({ type: 'order', id: order.id, label: `#${order.shopifyOrderId || order.id.slice(-6)} — ${order.customerName}`, tab: 'orders' }); }}
                          >
                            <td className="pl-4 py-4 w-8" onClick={e => e.stopPropagation()}>
                              <input
                                type="checkbox"
                                className="rounded accent-brand cursor-pointer"
                                checked={selectedOrderIds.has(order.id)}
                                onChange={e => {
                                  const next = new Set(selectedOrderIds);
                                  if (e.target.checked) next.add(order.id);
                                  else next.delete(order.id);
                                  setSelectedOrderIds(next);
                                }}
                              />
                            </td>
                            {/* Phase 525: order ID + expand toggle */}
                            <td className="px-6 py-4 font-medium text-[#1D2226]" onClick={e => e.stopPropagation()}>
                              <div className="flex items-center gap-1.5">
                                {/* Phase 530: copy order ID */}
                                <button
                                  onClick={async (e) => {
                                    e.stopPropagation();
                                    await navigator.clipboard.writeText(order.shopifyOrderId || order.id).catch(() => {});
                                    setCopiedOrderId(order.id);
                                    setTimeout(() => setCopiedOrderId(null), 1500);
                                  }}
                                  className="text-gray-400 hover:text-brand transition-colors"
                                  title={currentLanguage === 'tr' ? 'Sipariş ID\'yi kopyala' : 'Copy order ID'}
                                >
                                  {copiedOrderId === order.id
                                    ? <Check className="w-3 h-3 text-emerald-500" />
                                    : <Copy className="w-3 h-3" />}
                                </button>
                                <span className="cursor-pointer" onClick={() => { setSelectedOrder(order); trackView({ type: 'order', id: order.id, label: `#${order.shopifyOrderId || order.id.slice(-6)} — ${order.customerName}`, tab: 'orders' }); }}>
                                  {order.shopifyOrderId}
                                </span>
                                {order.lineItems && order.lineItems.length > 0 && (
                                  <button
                                    onClick={e => { e.stopPropagation(); setExpandedOrderId(expandedOrderId === order.id ? null : order.id); }}
                                    className={cn("ml-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full transition-colors flex items-center gap-0.5",
                                      expandedOrderId === order.id
                                        ? "bg-brand text-white"
                                        : "bg-gray-100 text-gray-500 hover:bg-brand/10 hover:text-brand"
                                    )}
                                    title={expandedOrderId === order.id
                                      ? (currentLanguage === 'tr' ? 'Ürünleri gizle' : 'Hide items')
                                      : (currentLanguage === 'tr' ? 'Ürünleri göster' : 'Show items')}
                                  >
                                    {order.lineItems.length} {currentLanguage === 'tr' ? 'ürün' : 'item' + (order.lineItems.length !== 1 ? 's' : '')}
                                    <ChevronDown className={cn("w-2.5 h-2.5 transition-transform", expandedOrderId === order.id && "rotate-180")} />
                                  </button>
                                )}
                              </div>
                            </td>
                            <td className="px-6 py-4">
                              <div className="flex items-center gap-2">
                                {/* Phase 523: clickable customer name filters to that customer */}
                                <button
                                  onClick={e => { e.stopPropagation(); setOrderCustomerFilter(orderCustomerFilter === order.customerName ? null : order.customerName); }}
                                  className={cn("text-left transition-colors font-medium", orderCustomerFilter === order.customerName ? "text-brand font-bold" : "text-gray-600 hover:text-brand")}
                                  title={currentLanguage === 'tr' ? `Bu müşterinin siparişlerini filtrele` : `Filter orders by this customer`}
                                >
                                  {order.customerName}
                                </button>
                                {/* Phase 46: CustomerType badge */}
                                {order.customerType && (
                                  <span className={cn("text-[9px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0", order.customerType === 'B2B' ? "bg-blue-50 text-blue-600" : "bg-gray-100 text-gray-500")}>
                                    {order.customerType}
                                  </span>
                                )}
                                {/* Phase 78: Notes indicator dot */}
                                {order.notes && (
                                  <span
                                    className="w-4 h-4 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0 cursor-help"
                                    title={order.notes}
                                  >
                                    <FileText className="w-2.5 h-2.5 text-amber-600" />
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-6 py-4 text-gray-500">
                              {order.syncedAt ? (typeof (order.syncedAt as { toDate?: () => Date }).toDate === 'function' ? (order.syncedAt as { toDate: () => Date }).toDate() : new Date(order.syncedAt as unknown as string | number | Date)).toLocaleDateString() : 'Unknown Date'}
                            </td>
                            <td className="px-6 py-4" onClick={(e) => e.stopPropagation()}>
                              {/* Phase 534: days in current status */}
                              {(() => {
                                const raw534 = order.createdAt ?? order.syncedAt;
                                if (!raw534) return null;
                                const d534 = typeof (raw534 as { toDate?: () => Date }).toDate === 'function'
                                  ? (raw534 as { toDate: () => Date }).toDate()
                                  : new Date(raw534 as string | number);
                                const days534 = Math.floor((Date.now() - d534.getTime()) / 86400000);
                                if (days534 < 1) return null;
                                const warn534 = order.status === 'Pending' && days534 > 3;
                                return (
                                  <span className={cn("block text-[8px] font-bold mb-1 px-1.5 py-0.5 rounded-full w-fit",
                                    warn534 ? "bg-red-50 text-red-400" : "bg-gray-100 text-gray-400"
                                  )}>
                                    {days534}{currentLanguage === 'tr' ? 'g' : 'd'}
                                  </span>
                                );
                              })()}
                              <select value={order.status} onChange={(e) => {
                                e.stopPropagation();
                                const newStatus = e.target.value as Order['status'];
                                // Phase 506: delivery note modal
                                if (newStatus === 'Delivered') { setDeliveryNoteOrder(order); setDeliveryNoteText(''); return; }
                                openConfirm({
                                  title: currentT.status,
                                  message: `Update status to "${e.target.value}"?`,
                                  onConfirm: () => handleUpdateOrderStatus(order.id, e.target.value as Order['status'])
                                });
                              }}
                                className={cn("text-[10px] font-bold uppercase px-2 py-1 rounded-full outline-none cursor-pointer appearance-none",
                                  order.status === 'Pending' ? "bg-amber-50 text-amber-600" :
                                    order.status === 'Processing' ? "bg-purple-50 text-purple-600" :
                                      order.status === 'Shipped' ? "bg-blue-50 text-blue-600" :
                                        order.status === 'Delivered' ? "bg-emerald-50 text-emerald-600" : "bg-gray-50 text-gray-600"
                                )}>
                                <option value="Pending">{currentT.pending}</option>
                                <option value="Processing">{currentT.processing}</option>
                                <option value="Shipped">{currentT.shipped}</option>
                                <option value="Delivered">{currentT.delivered}</option>
                                <option value="Cancelled">{currentT.cancelled}</option>
                              </select>
                            </td>
                            <td className="px-6 py-4 text-right font-bold text-[#1D2226]">
                              {/* TL yolu birebir korundu; USD/EUR artık kur yoksa '—' (eskiden `||1` ile
                                  TL tutar '$' ile basılıyordu — ~38× şişkin). Sembol biçimleyicinin içinde. */}
                              <div>{kpiCurrency === 'TRY'
                                ? `₺${order.totalPrice.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                                : formatInCurrency(order.totalPrice, kpiCurrency, exchangeRates ?? undefined)}</div>
                              <div className="flex flex-col items-end gap-0.5 mt-0.5">
                                {order.faturali ? (
                                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${order.faturaTipi==='ihracat' ? 'bg-blue-100 text-blue-600' : order.faturaTipi==='e-arsiv' ? 'bg-purple-100 text-purple-600' : 'bg-green-100 text-green-600'}`}>
                                    {order.faturaTipi ? order.faturaTipi.toUpperCase() : 'e-FATURA'} • KDV%{order.kdvOran ?? 0}
                                  </span>
                                ) : (
                                  <span className="text-[9px] font-bold bg-gray-100 text-gray-400 px-1.5 py-0.5 rounded-full">
                                    {currentLanguage === 'tr' ? 'FATURASIZ' : 'NO INVOICE'}
                                  </span>
                                )}
                                {/* Phase 67: Mikro sync badge */}
                                {order.mikroFaturaNo ? (
                                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-[#1a3a5c]/10 text-[#1a3a5c] inline-flex items-center gap-0.5 max-w-[120px] truncate" title={`Mikro: ${order.mikroFaturaNo}`}>
                                    ✓ {order.mikroFaturaNo}
                                  </span>
                                ) : order.faturali ? (
                                  <span className="text-[9px] text-amber-500 font-medium inline-flex items-center gap-0.5" title={currentLanguage === 'tr' ? 'Mikro\'ya gönderilmedi' : 'Not pushed to Mikro'}>
                                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" />
                                    Mikro
                                  </span>
                                ) : null}
                                {/* Phase 89 + Phase 532 + Phase 535: Payment status badge + method */}
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleToggleOrderPaid(order); }}
                                  title={order.paid ? (currentLanguage === 'tr' ? 'Ödendi — tıkla: ödenmedi yap' : 'Paid — click to mark unpaid') : (currentLanguage === 'tr' ? 'Ödenmedi — tıkla: ödendi yap' : 'Unpaid — click to mark paid')}
                                  className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full transition-colors ${order.paid ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200' : 'bg-amber-50 text-amber-600 hover:bg-amber-100'}`}
                                >
                                  {order.paid ? (currentLanguage === 'tr' ? '✓ Ödendi' : '✓ Paid') : (currentLanguage === 'tr' ? '⏳ Ödenmedi' : '⏳ Unpaid')}
                                </button>
                                {/* Phase 535: payment method micro-badge */}
                                {order.paid && order.paymentMethod && (() => {
                                  const pmLabels: Record<string, string> = {
                                    cash: currentLanguage === 'tr' ? 'Nakit' : 'Cash',
                                    bank_transfer: currentLanguage === 'tr' ? 'EFT' : 'Transfer',
                                    credit_card: currentLanguage === 'tr' ? 'Kart' : 'Card',
                                    check: currentLanguage === 'tr' ? 'Çek' : 'Check',
                                    other: currentLanguage === 'tr' ? 'Diğer' : 'Other',
                                  };
                                  return (
                                    <span className="text-[8px] font-semibold px-1 py-0.5 rounded bg-gray-100 text-gray-500">
                                      {pmLabels[order.paymentMethod] ?? order.paymentMethod}
                                    </span>
                                  );
                                })()}
                              </div>
                            </td>
                            <td className="px-6 py-4 text-right" onClick={(e) => e.stopPropagation()}>
                              <div className="flex items-center justify-end gap-2">
                                {order.status === 'Pending' && (
                                  <button onClick={() => openConfirm({
                                    title: currentT.confirm_approve_title,
                                    message: currentT.confirm_approve_msg,
                                    confirmLabel: currentT.approve,
                                    onConfirm: () => handleUpdateOrderStatus(order.id, 'Processing')
                                  })} className="text-emerald-500 hover:text-emerald-700 transition-colors" title={currentT.approve_order}>
                                    <CheckCircle2 className="w-4 h-4" />
                                  </button>
                                )}
                                {!order.hasInvoice && order.faturali !== false && (
                                  <button
                                    onClick={() => setActiveTab('muhasebe')}
                                    className="text-xs font-bold px-2 py-1 bg-brand/10 text-brand hover:bg-brand hover:text-white rounded-lg transition-all flex items-center gap-1"
                                    title={currentLanguage==='tr'?'Fatura Kes':'Create Invoice'}
                                  >
                                    <FileText className="w-3.5 h-3.5"/>
                                    {currentLanguage==='tr'?'Fatura Kes':'Invoice'}
                                  </button>
                                )}
                                {order.hasInvoice && (
                                  <span className="text-[10px] font-bold px-2 py-0.5 bg-green-100 text-green-600 rounded-full flex items-center gap-0.5">
                                    <CheckCircle2 className="w-3 h-3"/>{currentLanguage==='tr'?'Faturalı':'Invoiced'}
                                  </span>
                                )}
                                {/* Mikro e-Fatura push */}
                                {!order.mikroFaturaNo && order.faturali !== false && (
                                  <button
                                    onClick={(e) => { e.stopPropagation(); void handleMikroFatura(order); }}
                                    disabled={!!faturaLoading[order.id]}
                                    className="text-xs font-bold px-2 py-1 bg-[#1a3a5c]/10 text-[#1a3a5c] hover:bg-[#1a3a5c] hover:text-white rounded-lg transition-all flex items-center gap-1 disabled:opacity-40"
                                    title={currentLanguage==='tr'?'Mikro\'ya e-Fatura gönder':'Push e-Invoice to Mikro'}
                                  >
                                    {faturaLoading[order.id]
                                      ? <RefreshCw className="w-3.5 h-3.5 animate-spin"/>
                                      : <FileUp className="w-3.5 h-3.5"/>}
                                    Mikro
                                  </button>
                                )}
                                {order.mikroFaturaNo && (
                                  <span className="text-[10px] font-bold px-2 py-0.5 bg-[#1a3a5c]/10 text-[#1a3a5c] rounded-full flex items-center gap-0.5" title={order.mikroFaturaNo}>
                                    <CheckCircle2 className="w-3 h-3"/>Mikro
                                  </span>
                                )}
                                {/* Phase 509: Star/Pin order */}
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const next = new Set(starredOrders);
                                    if (next.has(order.id)) next.delete(order.id); else next.add(order.id);
                                    setStarredOrders(next);
                                    const uid = auth.currentUser?.uid;
                                    if (uid) setDoc(doc(db, 'userPrefs', uid), { starredOrders: [...next] }, { merge: true }).catch(() => {});
                                  }}
                                  className={cn("transition-colors", starredOrders.has(order.id) ? "text-amber-400 hover:text-amber-500" : "text-gray-200 hover:text-amber-300")}
                                  title={starredOrders.has(order.id) ? (currentLanguage === 'tr' ? 'Yıldızı kaldır' : 'Unstar') : (currentLanguage === 'tr' ? 'Önemli olarak işaretle' : 'Star order')}
                                >
                                  ★
                                </button>
                                <button onClick={() => openConfirm({
                                  title: currentT.confirm_delete_title,
                                  message: currentT.confirm_delete,
                                  confirmLabel: currentT.delete,
                                  variant: 'danger',
                                  onConfirm: () => handleDeleteOrder(order.id)
                                })} className="text-gray-400 hover:text-red-600 transition-colors" title={currentT.delete_order}>
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </td>
                          </tr>
                          {/* ── Phase 525: Inline line items expand row ── */}
                          {expandedOrderId === order.id && order.lineItems && order.lineItems.length > 0 && (
                            <tr className="bg-gray-50/80">
                              <td colSpan={7} className="px-8 py-3">
                                <div className="rounded-xl border border-gray-200 overflow-hidden bg-white shadow-sm">
                                  <table className="w-full text-xs">
                                    <thead>
                                      <tr className="bg-gray-50 border-b border-gray-100">
                                        <th className="text-left px-4 py-2 text-[10px] font-bold text-gray-400 uppercase tracking-wider">SKU</th>
                                        <th className="text-left px-4 py-2 text-[10px] font-bold text-gray-400 uppercase tracking-wider">{currentLanguage === 'tr' ? 'Ürün' : 'Product'}</th>
                                        <th className="text-right px-4 py-2 text-[10px] font-bold text-gray-400 uppercase tracking-wider">{currentLanguage === 'tr' ? 'Adet' : 'Qty'}</th>
                                        <th className="text-right px-4 py-2 text-[10px] font-bold text-gray-400 uppercase tracking-wider">{currentLanguage === 'tr' ? 'Birim Fiyat' : 'Unit Price'}</th>
                                        <th className="text-right px-4 py-2 text-[10px] font-bold text-gray-400 uppercase tracking-wider">{currentLanguage === 'tr' ? 'Toplam' : 'Total'}</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {order.lineItems.map((li, idx) => (
                                        <tr key={idx} className="border-b border-gray-50 last:border-0">
                                          <td className="px-4 py-2 text-gray-400 font-mono">{li.sku}</td>
                                          <td className="px-4 py-2 text-gray-700 font-medium">{li.title ?? li.name}</td>
                                          <td className="px-4 py-2 text-right text-gray-600">{li.quantity}</td>
                                          <td className="px-4 py-2 text-right text-gray-600">₺{(li.price ?? 0).toLocaleString('tr-TR', { minimumFractionDigits: 2 })}</td>
                                          <td className="px-4 py-2 text-right font-bold text-gray-800">₺{((li.price ?? 0) * li.quantity).toLocaleString('tr-TR', { minimumFractionDigits: 2 })}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                    <tfoot>
                                      <tr className="bg-gray-50">
                                        <td colSpan={4} className="px-4 py-2 text-right text-[10px] font-bold text-gray-500 uppercase tracking-wider">{currentLanguage === 'tr' ? 'Genel Toplam' : 'Grand Total'}</td>
                                        <td className="px-4 py-2 text-right font-black text-brand">₺{order.totalPrice.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}</td>
                                      </tr>
                                    </tfoot>
                                  </table>
                                </div>
                              </td>
                            </tr>
                          )}
                          </React.Fragment>
                        ));
                      })()}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Mobile Card View */}
              <div className="md:hidden space-y-4">
                {sortData(activeOrders.filter(o =>
                  (orderStatusFilter === 'All' || o.status === orderStatusFilter) &&
                  (o.customerName.toLowerCase().includes(orderSearch.toLowerCase()) ||
                  o.shopifyOrderId?.toLowerCase().includes(orderSearch.toLowerCase()) ||
                  o.shippingAddress?.toLowerCase().includes(orderSearch.toLowerCase()))
                ), orderSort.key, orderSort.dir).map(order => (
                  <div key={order.id} className="apple-card p-4 space-y-3" onClick={() => setSelectedOrder(order)}>
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="font-bold text-sm text-[#1D2226]">{order.shopifyOrderId}</p>
                        <p className="text-xs text-gray-500">{order.customerName}</p>
                      </div>
                      <span className={cn("text-[10px] font-bold uppercase px-2 py-1 rounded-full",
                        order.status === 'Pending' ? "bg-amber-50 text-amber-600" :
                          order.status === 'Processing' ? "bg-purple-50 text-purple-600" :
                            order.status === 'Shipped' ? "bg-blue-50 text-blue-600" :
                              order.status === 'Delivered' ? "bg-emerald-50 text-emerald-600" : "bg-gray-50 text-gray-600"
                      )}>
                        {currentT[order.status.toLowerCase()] || order.status}
                      </span>
                    </div>
                    <div className="flex justify-between items-end">
                      <div className="text-xs text-gray-400">
                        {order.syncedAt ? (typeof (order.syncedAt as { toDate?: () => Date }).toDate === 'function' ? (order.syncedAt as { toDate: () => Date }).toDate() : new Date(order.syncedAt as unknown as string | number | Date)).toLocaleDateString() : 'Unknown Date'}
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-brand">{order.totalPrice.toLocaleString()} TL</p>
                        {/* Phase 67: invoice mini-badge on mobile */}
                        <div className="flex items-center justify-end gap-1 mt-0.5">
                          {order.faturali ? (
                            <span className={`text-[8px] font-bold px-1 py-0.5 rounded-full ${order.faturaTipi === 'ihracat' ? 'bg-blue-100 text-blue-600' : order.faturaTipi === 'e-arsiv' ? 'bg-purple-100 text-purple-600' : 'bg-green-100 text-green-600'}`}>
                              {order.faturaTipi ? order.faturaTipi.toUpperCase() : 'e-FTR'}
                            </span>
                          ) : null}
                          {order.mikroFaturaNo ? (
                            <span className="text-[8px] font-bold px-1 py-0.5 rounded-full bg-[#1a3a5c]/10 text-[#1a3a5c]">✓ MKR</span>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
          {/* ── Phase 575: Müşteri İade / Şikayet Yönetimi ────────────────── */}
          {activeTab === 'orders' && !selectedOrder && (() => {
            const tr575 = currentLanguage === 'tr';
            const statusColors575: Record<string,string> = {
              'Bekliyor': 'bg-amber-100 text-amber-700',
              'Onaylandı': 'bg-green-100 text-green-700',
              'Reddedildi': 'bg-red-100 text-red-700',
              'Tamamlandı': 'bg-blue-100 text-blue-700',
            };
            return (
              <div className="apple-card p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-bold text-gray-900 text-sm">{tr575?'↩️ İade & Şikayet Yönetimi':'↩️ Returns & Complaints'}</h3>
                  {hasFullAccess('orders') && (
                    <button onClick={()=>setActiveTab('iade')} className="apple-button-primary flex items-center gap-2 text-sm" title={tr575?'İade & Değişim sayfasında yönet':'Manage on Returns page'}>
                      <Plus className="w-4 h-4"/>{tr575?'İade Talebi':'New Return'}
                    </button>
                  )}
                </div>
                {p575ShowForm && (
                  <div className="bg-gray-50 rounded-xl p-4 mb-4 space-y-3">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <input className="apple-input px-3 py-2 text-sm" placeholder={tr575?'Sipariş ID':'Order ID'} value={p575Draft.orderId} onChange={e=>setP575Draft(d=>({...d,orderId:e.target.value}))} />
                      <input className="apple-input px-3 py-2 text-sm" placeholder={tr575?'Müşteri Adı':'Customer Name'} value={p575Draft.customerName} onChange={e=>setP575Draft(d=>({...d,customerName:e.target.value}))} />
                      <input className="apple-input px-3 py-2 text-sm col-span-2" placeholder={tr575?'İade Nedeni':'Return Reason'} value={p575Draft.reason} onChange={e=>setP575Draft(d=>({...d,reason:e.target.value}))} />
                      <input type="number" className="apple-input px-3 py-2 text-sm" placeholder={tr575?'Tutar (₺)':'Amount (₺)'} value={p575Draft.amount} onChange={e=>setP575Draft(d=>({...d,amount:e.target.value}))} />
                    </div>
                    <div className="flex gap-2">
                      <button onClick={async ()=>{
                        if(!p575Draft.customerName||!p575Draft.reason) return;
                        const payload={orderId:p575Draft.orderId,customerName:p575Draft.customerName,reason:p575Draft.reason,amount:Number(p575Draft.amount)||0};
                        try {
                          if(p575EditId){ await updateDoc(doc(db,'salesReturns',p575EditId),payload); }
                          else { await addDoc(collection(db,'salesReturns'),{...payload,status:'Bekliyor',createdAt:serverTimestamp()}); }
                          setP575Draft({orderId:'',customerName:'',reason:'',amount:''});
                          setP575ShowForm(false); setP575EditId(null);
                          toast(tr575?(p575EditId?'İade güncellendi.':'İade talebi oluşturuldu.'):(p575EditId?'Return updated.':'Return request created.'),'success');
                        } catch(e){ toast((tr575?'Kaydedilemedi: ':'Save failed: ')+(e instanceof Error?e.message:String(e)),'error'); }
                      }} className="apple-button-primary text-sm px-4 py-1.5">{tr575?'Kaydet':'Save'}</button>
                      <button onClick={()=>{setP575ShowForm(false);setP575EditId(null);}} className="apple-button-secondary text-sm px-4 py-1.5">{tr575?'İptal':'Cancel'}</button>
                    </div>
                  </div>
                )}
                {p575Returns.length === 0 ? (
                  <p className="text-center py-6 text-gray-400 text-sm">{tr575?'Henüz iade / şikayet kaydı yok.':'No returns or complaints logged yet.'}</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead><tr className="border-b border-gray-100 bg-gray-50">
                        {[tr575?'Müşteri':'Customer', tr575?'Sipariş ID':'Order ID', tr575?'Neden':'Reason', tr575?'Tutar':'Amount', tr575?'Durum':'Status'].map(h=>(
                          <th key={h} className="px-3 py-2 text-left text-[10px] font-bold text-gray-400 uppercase">{h}</th>
                        ))}
                      </tr></thead>
                      <tbody className="divide-y divide-gray-50">
                        {p575Returns.map(r=>(
                          <tr key={r.id} className="hover:bg-gray-50/50">
                            <td className="px-3 py-2.5 font-medium text-gray-800">{r.customerName}</td>
                            <td className="px-3 py-2.5 font-mono text-gray-500">{r.orderId||'—'}</td>
                            <td className="px-3 py-2.5 text-gray-600 max-w-[200px] truncate">{r.reason}</td>
                            <td className="px-3 py-2.5 font-bold font-mono text-gray-700">{r.amount>0?`₺${r.amount.toLocaleString('tr-TR')}`:'—'}</td>
                            <td className="px-3 py-2.5">
                              <div className="flex items-center gap-2">
                              <select value={r.status} onChange={async e=>{try{await updateDoc(doc(db,'salesReturns',r.id),{status:e.target.value});}catch(err){toast((tr575?'Güncellenemedi: ':'Update failed: ')+(err instanceof Error?err.message:String(err)),'error');}}} className={`text-[10px] font-bold px-2 py-0.5 rounded-full border-0 cursor-pointer ${statusColors575[r.status]}`}>
                                {(['Bekliyor','Onaylandı','Reddedildi','Tamamlandı'] as const).map(s=>(
                                  <option key={s} value={s}>{s}</option>
                                ))}
                              </select>
                              <button type="button" onClick={()=>{setP575Draft({orderId:r.orderId,customerName:r.customerName,reason:r.reason,amount:String(r.amount)});setP575EditId(r.id);setP575ShowForm(true);}} title={tr575?'Düzenle':'Edit'} className="text-gray-300 hover:text-blue-600 transition-colors"><Edit2 className="w-3.5 h-3.5"/></button>
                              <button type="button" onClick={async ()=>{try{await deleteDoc(doc(db,'salesReturns',r.id));}catch(e){toast((tr575?'Silinemedi: ':'Delete failed: ')+(e instanceof Error?e.message:String(e)),'error');}}} title="Sil" className="text-gray-300 hover:text-red-600 transition-colors"><Trash2 className="w-3.5 h-3.5"/></button>
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

          {/* ── Phase 583: Garanti & Servis Talepleri ─────────────────────── */}
          {activeTab === 'orders' && !selectedOrder && (() => {
            const tr583 = currentLanguage === 'tr';
            const statusColors583: Record<string,string> = {'Açık':'bg-red-100 text-red-700','İşlemde':'bg-amber-100 text-amber-700','Kapatıldı':'bg-green-100 text-green-700'};
            const prioColors583: Record<string,string> = {'Yüksek':'bg-red-50 border-l-red-400','Orta':'bg-amber-50 border-l-amber-300','Düşük':'bg-gray-50 border-l-gray-300'};
            return (
              <div className="apple-card p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-bold text-gray-900 text-sm">{tr583?'🔧 Garanti & Servis Talepleri':'🔧 Warranty & Service Requests'}</h3>
                  {hasFullAccess('orders') && (
                    <button onClick={()=>setP583ShowForm(v=>!v)} className="apple-button-primary flex items-center gap-2 text-sm">
                      <Plus className="w-4 h-4"/>{tr583?'Talep Ekle':'New Request'}
                    </button>
                  )}
                </div>
                {p583ShowForm && (
                  <div className="bg-gray-50 rounded-xl p-4 mb-4 space-y-3">
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                      <input className="apple-input px-3 py-2 text-sm" placeholder={tr583?'Müşteri':'Customer'} value={p583Draft.customerName} onChange={e=>setP583Draft(d=>({...d,customerName:e.target.value}))} />
                      <input className="apple-input px-3 py-2 text-sm" placeholder={tr583?'Ürün Adı':'Product'} value={p583Draft.productName} onChange={e=>setP583Draft(d=>({...d,productName:e.target.value}))} />
                      <input className="apple-input px-3 py-2 text-sm" placeholder={tr583?'Seri No':'Serial No'} value={p583Draft.serialNo} onChange={e=>setP583Draft(d=>({...d,serialNo:e.target.value}))} />
                      <input type="date" className="apple-input px-3 py-2 text-sm" placeholder={tr583?'Garanti Bitiş':'Warranty End'} value={p583Draft.warrantyEnd} onChange={e=>setP583Draft(d=>({...d,warrantyEnd:e.target.value}))} />
                      <select className="apple-input px-3 py-2 text-sm" value={p583Draft.priority} onChange={e=>setP583Draft(d=>({...d,priority:e.target.value as 'Düşük'|'Orta'|'Yüksek'}))}>
                        <option value="Düşük">{tr583?'Düşük Öncelik':'Low Priority'}</option>
                        <option value="Orta">{tr583?'Orta Öncelik':'Medium Priority'}</option>
                        <option value="Yüksek">{tr583?'Yüksek Öncelik':'High Priority'}</option>
                      </select>
                      <input className="apple-input px-3 py-2 text-sm col-span-2 md:col-span-1" placeholder={tr583?'Sorun Açıklaması':'Issue Description'} value={p583Draft.description} onChange={e=>setP583Draft(d=>({...d,description:e.target.value}))} />
                    </div>
                    <div className="flex gap-2">
                      <button onClick={async ()=>{
                        if(!p583Draft.customerName||!p583Draft.description) return;
                        const payload={customerName:p583Draft.customerName,productName:p583Draft.productName,serialNo:p583Draft.serialNo||'',warrantyEnd:p583Draft.warrantyEnd||'',description:p583Draft.description,priority:p583Draft.priority};
                        try {
                          if(p583EditId){ await updateDoc(doc(db,'serviceRequests',p583EditId),payload); }
                          else { await addDoc(collection(db,'serviceRequests'),{...payload,issueDate:new Date().toISOString().slice(0,10),status:'Açık',createdAt:serverTimestamp()}); }
                          setP583Draft({customerName:'',productName:'',serialNo:'',warrantyEnd:'',description:'',priority:'Orta'});
                          setP583ShowForm(false); setP583EditId(null);
                          toast(tr583?(p583EditId?'Talep güncellendi.':'Servis talebi oluşturuldu.'):(p583EditId?'Request updated.':'Service request created.'),'success');
                        } catch(e){ toast((tr583?'Kaydedilemedi: ':'Save failed: ')+(e instanceof Error?e.message:String(e)),'error'); }
                      }} className="apple-button-primary text-sm px-4 py-1.5">{tr583?'Kaydet':'Save'}</button>
                      <button onClick={()=>{setP583ShowForm(false);setP583EditId(null);}} className="apple-button-secondary text-sm px-4 py-1.5">{tr583?'İptal':'Cancel'}</button>
                    </div>
                  </div>
                )}
                {p583Requests.length === 0 ? (
                  <p className="text-center py-6 text-gray-400 text-sm">{tr583?'Henüz servis talebi yok.':'No service requests yet.'}</p>
                ) : (
                  <div className="space-y-2">
                    {p583Requests.map(r=>(
                      <div key={r.id} className={`flex items-start justify-between p-3 rounded-xl border border-l-4 ${prioColors583[r.priority]}`}>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-semibold text-gray-800 text-sm">{r.customerName}</p>
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${statusColors583[r.status]}`}>{r.status}</span>
                          </div>
                          <p className="text-xs text-gray-500 mt-0.5">{r.productName} {r.serialNo?`• S/N: ${r.serialNo}`:''} • {r.issueDate}</p>
                          <p className="text-xs text-gray-600 mt-1 line-clamp-1">{r.description}</p>
                        </div>
                        <div className="ml-3 flex items-center gap-2 shrink-0">
                        <select value={r.status} onChange={async e=>{try{await updateDoc(doc(db,'serviceRequests',r.id),{status:e.target.value});}catch(err){toast((tr583?'Güncellenemedi: ':'Update failed: ')+(err instanceof Error?err.message:String(err)),'error');}}} className="text-[10px] font-bold bg-transparent border-0 cursor-pointer">
                          <option>Açık</option><option>İşlemde</option><option>Kapatıldı</option>
                        </select>
                        <button type="button" onClick={()=>{setP583Draft({customerName:r.customerName,productName:r.productName,serialNo:r.serialNo||'',warrantyEnd:r.warrantyEnd||'',description:r.description,priority:r.priority});setP583EditId(r.id);setP583ShowForm(true);}} title={tr583?'Düzenle':'Edit'} className="text-gray-300 hover:text-blue-600 transition-colors"><Edit2 className="w-3.5 h-3.5"/></button>
                        <button type="button" onClick={async ()=>{try{await deleteDoc(doc(db,'serviceRequests',r.id));}catch(e){toast((tr583?'Silinemedi: ':'Delete failed: ')+(e instanceof Error?e.message:String(e)),'error');}}} title="Sil" className="text-gray-300 hover:text-red-600 transition-colors"><Trash2 className="w-3.5 h-3.5"/></button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}

          {/* ── Phase 609: SLA & Müşteri Destek Takibi ────────────────────────── */}
          {activeTab === 'orders' && !selectedOrder && (() => {
            const tr609 = currentLanguage === 'tr';
            const openTickets = p609Tickets.filter(t=>t.status==='Açık'||t.status==='İşlemde');
            const resolvedTickets = p609Tickets.filter(t=>t.status==='Çözüldü'||t.status==='Kapatıldı');
            const avgSatScore = resolvedTickets.filter(t=>t.satisfaction).length>0
              ? (resolvedTickets.filter(t=>t.satisfaction).reduce((s,t)=>s+(t.satisfaction||0),0)/resolvedTickets.filter(t=>t.satisfaction).length).toFixed(1) : '—';
            const slaBreached = p609Tickets.filter(t=>{
              if (t.status==='Kapatıldı'||t.status==='Çözüldü') return false;
              const created = new Date(t.createdAt);
              const hours = (Date.now()-created.getTime())/3600000;
              return hours>t.slaHours;
            }).length;
            const priorityColor:{[k:string]:string} = {'Kritik':'text-red-600 bg-red-50','Yüksek':'text-orange-600 bg-orange-50','Orta':'text-amber-600 bg-amber-50','Düşük':'text-gray-600 bg-gray-50'};
            return (
              <div className="apple-card p-5 space-y-4">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <h3 className="font-bold text-gray-900 text-sm">🎫 {tr609?'SLA & Destek Biletleri':'SLA & Support Tickets'}</h3>
                  <button onClick={()=>setP609ShowForm(v=>!v)} className="apple-button-secondary text-xs flex items-center gap-1.5"><Plus className="w-3.5 h-3.5"/>{tr609?'Bilet Aç':'Open Ticket'}</button>
                </div>
                {p609ShowForm && (
                  <div className="bg-gray-50 rounded-xl p-4 space-y-3">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                      <input className="apple-input col-span-2" placeholder={tr609?'Müşteri':'Customer'} value={p609Draft.customer} onChange={e=>setP609Draft(d=>({...d,customer:e.target.value}))}/>
                      <input className="apple-input col-span-2" placeholder={tr609?'Konu':'Subject'} value={p609Draft.subject} onChange={e=>setP609Draft(d=>({...d,subject:e.target.value}))}/>
                      <select value={p609Draft.priority} onChange={e=>setP609Draft(d=>({...d,priority:e.target.value as typeof d.priority}))} className="apple-input">
                        {['Düşük','Orta','Yüksek','Kritik'].map(p=><option key={p}>{p}</option>)}
                      </select>
                      <input type="number" className="apple-input" placeholder="SLA (h)" value={p609Draft.slaHours} onChange={e=>setP609Draft(d=>({...d,slaHours:e.target.value}))}/>
                    </div>
                    <button onClick={async ()=>{
                      if(!p609Draft.customer||!p609Draft.subject) return;
                      const payload={customer:p609Draft.customer,subject:p609Draft.subject,priority:p609Draft.priority,slaHours:Number(p609Draft.slaHours)||24};
                      try {
                        if(p609EditId){ await updateDoc(doc(db,'helpdeskTickets',p609EditId),payload); }
                        else { await addDoc(collection(db,'helpdeskTickets'),{...payload,status:'Açık',createdAt:new Date().toISOString()}); }
                        setP609Draft({customer:'',subject:'',priority:'Orta',slaHours:'24'});
                        setP609ShowForm(false); setP609EditId(null);
                        toast(tr609?(p609EditId?'Bilet güncellendi.':'Bilet açıldı.'):(p609EditId?'Ticket updated.':'Ticket created.'),'success');
                      } catch(e){ toast((tr609?'Kaydedilemedi: ':'Save failed: ')+(e instanceof Error?e.message:String(e)),'error'); }
                    }} className="apple-button-primary text-xs px-6">{tr609?'Aç':'Create'}</button>
                  </div>
                )}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[
                    {label:tr609?'Açık':'Open',val:openTickets.length,color:'text-blue-600',bg:'bg-blue-50'},
                    {label:tr609?'SLA İhlali':'SLA Breach',val:slaBreached,color:'text-red-600',bg:'bg-red-50'},
                    {label:tr609?'Çözülen':'Resolved',val:resolvedTickets.length,color:'text-emerald-600',bg:'bg-emerald-50'},
                    {label:tr609?'Müşteri Skoru':'Sat. Score',val:avgSatScore,color:'text-amber-600',bg:'bg-amber-50'},
                  ].map(k=>(
                    <div key={k.label} className={`rounded-xl p-3 ${k.bg}`}><p className="text-[10px] font-bold text-gray-400 uppercase">{k.label}</p><p className={`text-xl font-black ${k.color}`}>{k.val}</p></div>
                  ))}
                </div>
                {p609Tickets.length > 0 && (
                  <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                    {[...p609Tickets].sort((a,b)=>{const pr={Kritik:0,Yüksek:1,Orta:2,Düşük:3};return pr[a.priority]-pr[b.priority];}).map(t=>{
                      const hoursOpen = (Date.now()-new Date(t.createdAt).getTime())/3600000;
                      const slaOk = hoursOpen<=t.slaHours||t.status==='Çözüldü'||t.status==='Kapatıldı';
                      return (
                        <div key={t.id} className={`flex items-center gap-3 border rounded-xl px-4 py-2.5 ${slaOk?'border-gray-100':'border-red-200 bg-red-50/30'}`}>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${priorityColor[t.priority]}`}>{t.priority}</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-semibold text-gray-800 truncate">{t.customer} — {t.subject}</p>
                            <p className="text-[10px] text-gray-400">{Math.round(hoursOpen)}h {tr609?'açık':'open'} · SLA: {t.slaHours}h{!slaOk?' ⚠️':''}</p>
                          </div>
                          <select value={t.status} onChange={async e=>{try{await updateDoc(doc(db,'helpdeskTickets',t.id),{status:e.target.value,...(['Çözüldü','Kapatıldı'].includes(e.target.value)?{resolvedAt:new Date().toISOString()}:{})});}catch(err){toast((tr609?'Güncellenemedi: ':'Update failed: ')+(err instanceof Error?err.message:String(err)),'error');}}} className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white shrink-0">
                            {['Açık','İşlemde','Çözüldü','Kapatıldı'].map(s=><option key={s}>{s}</option>)}
                          </select>
                          <button type="button" onClick={()=>{setP609Draft({customer:t.customer,subject:t.subject,priority:t.priority,slaHours:String(t.slaHours)});setP609EditId(t.id);setP609ShowForm(true);}} title={tr609?'Düzenle':'Edit'} className="text-gray-300 hover:text-blue-600 transition-colors shrink-0"><Edit2 className="w-3.5 h-3.5"/></button>
                          <button type="button" onClick={async ()=>{try{await deleteDoc(doc(db,'helpdeskTickets',t.id));}catch(e){toast((tr609?'Silinemedi: ':'Delete failed: ')+(e instanceof Error?e.message:String(e)),'error');}}} title="Sil" className="text-gray-300 hover:text-red-600 transition-colors shrink-0"><Trash2 className="w-3.5 h-3.5"/></button>
                        </div>
                      );
                    })}
                  </div>
                )}
                {p609Tickets.length === 0 && <p className="text-center text-gray-400 text-xs py-4">{tr609?'Henüz destek bileti yok.':'No support tickets yet.'}</p>}
              </div>
            );
          })()}

          {/* ── Phase 621: Talep Yönetimi (Demand Management) ──────────────── */}
          {activeTab === 'orders' && !selectedOrder && (() => {
            const tr621 = currentLanguage === 'tr';
            const statusCls:{[k:string]:string}={Bekliyor:'bg-amber-100 text-amber-700',Onaylandı:'bg-emerald-100 text-emerald-700',Reddedildi:'bg-red-100 text-red-700','Sipariş Verildi':'bg-blue-100 text-blue-700'};
            const pending621 = p621Demands.filter(d=>d.status==='Bekliyor').length;
            return (
              <div className="apple-card p-5 space-y-4">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <h3 className="font-bold text-gray-900 text-sm">📋 {tr621?'Talep Yönetimi':'Demand Management'}</h3>
                  <button onClick={()=>setP621ShowForm(v=>!v)} className="apple-button-secondary text-xs flex items-center gap-1.5"><Plus className="w-3.5 h-3.5"/>{tr621?'Talep Ekle':'Add Request'}</button>
                </div>
                {pending621>0&&<div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 text-xs font-semibold text-amber-700">{pending621} {tr621?'bekleyen talep':'pending request(s)'}</div>}
                {p621ShowForm && (
                  <div className="bg-gray-50 rounded-xl p-4 space-y-3">
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                      <input className="apple-input col-span-2 md:col-span-1" placeholder={tr621?'Ürün Adı':'Product Name'} value={p621Draft.productName} onChange={e=>setP621Draft(d=>({...d,productName:e.target.value}))}/>
                      <input className="apple-input" placeholder="SKU" value={p621Draft.sku} onChange={e=>setP621Draft(d=>({...d,sku:e.target.value}))}/>
                      <input type="number" className="apple-input" placeholder={tr621?'Miktar':'Qty'} value={p621Draft.requestedQty} onChange={e=>setP621Draft(d=>({...d,requestedQty:e.target.value}))}/>
                      <input className="apple-input" placeholder={tr621?'Talep Eden':'Requested By'} value={p621Draft.requestedBy} onChange={e=>setP621Draft(d=>({...d,requestedBy:e.target.value}))}/>
                      <select value={p621Draft.priority} onChange={e=>setP621Draft(d=>({...d,priority:e.target.value as typeof d.priority}))} className="apple-input">
                        {['Düşük','Orta','Yüksek'].map(p=><option key={p}>{p}</option>)}
                      </select>
                      <input className="apple-input col-span-2 md:col-span-1" placeholder={tr621?'Notlar':'Notes'} value={p621Draft.notes} onChange={e=>setP621Draft(d=>({...d,notes:e.target.value}))}/>
                    </div>
                    <button onClick={async ()=>{
                      if(!p621Draft.productName||!p621Draft.requestedQty) return;
                      try { await addDoc(collection(db,'demandRequests'),{productName:p621Draft.productName,sku:p621Draft.sku,requestedQty:Number(p621Draft.requestedQty),requestedBy:p621Draft.requestedBy,priority:p621Draft.priority,status:'Bekliyor',notes:p621Draft.notes||'',createdAt:new Date().toISOString()}); toast(currentLanguage === 'tr' ? 'Talep oluşturuldu ✓' : 'Demand request created ✓', 'success'); } catch(e){console.error("[firestore]", e); toast(currentLanguage === 'tr' ? 'Talep oluşturulamadı.' : 'Failed to create request.', 'error');}
                      setP621Draft(d=>({...d,productName:'',sku:'',requestedQty:'',requestedBy:'',notes:''}));
                      setP621ShowForm(false);
                      toast(tr621?'Talep oluşturuldu.':'Request created.','success');
                    }} className="apple-button-primary text-xs px-6">{tr621?'Oluştur':'Create'}</button>
                  </div>
                )}
                {p621Demands.length > 0 && (
                  <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                    {[...p621Demands].sort((a,b)=>{const pr={Yüksek:0,Orta:1,Düşük:2};return pr[a.priority]-pr[b.priority];}).map(d=>(
                      <div key={d.id} className="flex items-center gap-3 border border-gray-100 rounded-xl px-4 py-2.5">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-gray-800">{d.productName} {d.sku&&<span className="text-gray-400 font-normal">({d.sku})</span>}</p>
                          <p className="text-[10px] text-gray-400">{d.requestedBy} · {d.requestedQty} {tr621?'adet':'units'} · {d.priority}</p>
                        </div>
                        <select value={d.status} onChange={async e=>{try{await updateDoc(doc(db,'demandRequests',d.id),{status:e.target.value});}catch(err){console.error(err);}}} className={`text-[10px] font-bold px-2 py-0.5 rounded-full border-0 shrink-0 ${statusCls[d.status]}`}>
                          {['Bekliyor','Onaylandı','Reddedildi','Sipariş Verildi'].map(s=><option key={s}>{s}</option>)}
                        </select>
                      </div>
                    ))}
                  </div>
                )}
                {p621Demands.length===0&&<p className="text-center text-gray-400 text-xs py-4">{tr621?'Ürün talepleri ekleyin.':'Add product demand requests.'}</p>}
              </div>
            );
          })()}


        </motion.div>
      )}
      {selectedOrder && (
        <motion.div key="order-detail" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-6">
              <div className="flex items-center gap-4 mb-6">
                <button onClick={() => setSelectedOrder(null)} className="text-gray-500 hover:text-gray-900 bg-white p-2 rounded-full shadow-sm border border-gray-200 shrink-0">
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <ModuleHeader
                  title={`Order ${selectedOrder.shopifyOrderId}`}
                  subtitle={`Customer: ${selectedOrder.customerName}`}
                  className="mb-0 w-full"
                  actionButton={
                    <div className="flex gap-2 flex-wrap">
                      {selectedOrder.status === 'Pending' && (
                        <button onClick={() => openConfirm({
                          title: currentT.confirm_approve_title,
                          message: currentT.confirm_approve_msg,
                          confirmLabel: currentT.approve,
                          onConfirm: () => { handleUpdateOrderStatus(selectedOrder.id, 'Processing'); setSelectedOrder({ ...selectedOrder, status: 'Processing' }); }
                        })}
                          className="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 px-4 py-2 rounded-full text-sm font-bold flex items-center gap-2 shadow-sm border border-emerald-200 transition-colors">
                          Approve
                        </button>
                      )}
                      {/* Mikro e-Fatura button in order detail */}
                      {!selectedOrder.mikroFaturaNo && selectedOrder.faturali !== false && (
                        <button
                          onClick={() => void handleMikroFatura(selectedOrder)}
                          disabled={!!faturaLoading[selectedOrder.id]}
                          className="bg-[#1a3a5c]/10 hover:bg-[#1a3a5c] text-[#1a3a5c] hover:text-white px-4 py-2 rounded-full text-sm font-bold flex items-center gap-2 shadow-sm border border-[#1a3a5c]/20 transition-colors disabled:opacity-40"
                        >
                          {faturaLoading[selectedOrder.id] ? <RefreshCw className="w-4 h-4 animate-spin"/> : <FileUp className="w-4 h-4"/>}
                          {currentLanguage === 'tr' ? 'Mikro\'ya Fatura' : 'Push Invoice'}
                        </button>
                      )}
                      {selectedOrder.mikroFaturaNo && (
                        <span className="bg-[#1a3a5c]/10 text-[#1a3a5c] px-4 py-2 rounded-full text-sm font-bold flex items-center gap-2 shadow-sm border border-[#1a3a5c]/20">
                          <CheckCircle2 className="w-4 h-4"/> Mikro: {selectedOrder.mikroFaturaNo}
                        </span>
                      )}
                      {/* iyzico payment link */}
                      {!selectedOrder.iyzicoPaymentUrl ? (
                        <button
                          onClick={() => void handleIyzicoPaymentLink(selectedOrder)}
                          disabled={!!iyzicoLinkLoading[selectedOrder.id]}
                          className="bg-emerald-50 hover:bg-emerald-600 text-emerald-700 hover:text-white px-4 py-2 rounded-full text-sm font-bold flex items-center gap-2 shadow-sm border border-emerald-200 transition-colors disabled:opacity-40"
                        >
                          {iyzicoLinkLoading[selectedOrder.id]
                            ? <RefreshCw className="w-4 h-4 animate-spin"/>
                            : <CreditCard className="w-4 h-4"/>}
                          {currentLanguage === 'tr' ? 'Ödeme Linki' : 'Payment Link'}
                        </button>
                      ) : (
                        <a
                          href={selectedOrder.iyzicoPaymentUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="bg-emerald-50 text-emerald-700 px-4 py-2 rounded-full text-sm font-bold flex items-center gap-2 shadow-sm border border-emerald-200"
                          title={selectedOrder.iyzicoPaymentUrl}
                        >
                          <CheckCircle2 className="w-4 h-4"/> iyzico {selectedOrder.iyzicoSandbox ? '(sandbox)' : ''}
                        </a>
                      )}
                      {/* Phase 504: Clone/Duplicate Order */}
                      <button
                        onClick={() => {
                          const o = selectedOrder;
                          setNewOrder({
                            customerName: o.customerName,
                            customerEmail: o.customerEmail,
                            shippingAddress: o.shippingAddress,
                            status: 'Pending',
                            customerType: o.customerType,
                            cargoCompany: o.cargoCompany,
                            faturali: o.faturali,
                            faturaTipi: o.faturaTipi,
                            kdvOran: o.kdvOran,
                            notes: o.notes,
                            totalPrice: o.totalPrice,
                          });
                          setOrderLineItems((o.lineItems || []).map(li => ({ ...li, id: `${li.id}-clone-${Date.now()}` })));
                          setSelectedLead(leads.find(l => l.id === o.leadId) || null);
                          setIsAddingOrder(true);
                          toast(currentLanguage === 'tr' ? 'Sipariş kopyalandı — düzenleyebilirsiniz' : 'Order cloned — you can now edit it', 'success');
                        }}
                        className="bg-white hover:bg-indigo-50 text-gray-700 hover:text-indigo-700 px-4 py-2 rounded-full text-sm font-bold flex items-center gap-2 shadow-sm border border-gray-200 hover:border-indigo-200 transition-colors"
                        title={currentLanguage === 'tr' ? 'Siparişi klonla (yeni taslak olarak aç)' : 'Clone order as new draft'}
                      >
                        <Copy className="w-4 h-4" />
                        {currentLanguage === 'tr' ? 'Klonla' : 'Clone'}
                      </button>
                      {/* Phase 505: Print Order Receipt PDF */}
                      <button
                        onClick={async () => {
                          const o = selectedOrder;
                          const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
                          const doc505 = new jsPDF({ format: 'a4', unit: 'mm' });
                          await registerTurkishFont(doc505);
                          const W = doc505.internal.pageSize.getWidth();
                          doc505.setFillColor(255, 64, 0);
                          doc505.rect(0, 0, W, 28, 'F');
                          doc505.setTextColor(255, 255, 255);
                          doc505.setFontSize(16); doc505.setFont('Roboto', 'bold');
                          doc505.text('CETPA', 14, 13);
                          doc505.setFontSize(10); doc505.setFont('Roboto', 'normal');
                          doc505.text(currentLanguage === 'tr' ? 'SİPARİŞ FIŞI' : 'ORDER RECEIPT', 14, 21);
                          doc505.setTextColor(80, 80, 80);
                          doc505.setFontSize(9);
                          const rawD = o.createdAt ?? o.syncedAt;
                          const oDate = rawD ? (typeof (rawD as { toDate?: () => Date }).toDate === 'function' ? (rawD as { toDate: () => Date }).toDate() : new Date(rawD as string | number)).toLocaleDateString('tr-TR') : '—';
                          doc505.text(`#${o.shopifyOrderId || o.id.slice(-8)}`, W - 14, 13, { align: 'right' });
                          doc505.text(oDate, W - 14, 21, { align: 'right' });
                          doc505.setTextColor(30, 30, 30);
                          doc505.setFontSize(11); doc505.setFont('Roboto', 'bold');
                          doc505.text(o.customerName, 14, 38);
                          doc505.setFontSize(9); doc505.setFont('Roboto', 'normal');
                          doc505.setTextColor(120, 120, 120);
                          if (o.shippingAddress) doc505.text(o.shippingAddress, 14, 44);
                          if (o.customerEmail) doc505.text(o.customerEmail, 14, 49);
                          const lineItems505 = (o.lineItems || []);
                          if (lineItems505.length > 0) {
                            autoTable(doc505, {
                              startY: 58,
                              head: [[ currentLanguage === 'tr' ? 'Ürün' : 'Product', 'SKU', currentLanguage === 'tr' ? 'Adet' : 'Qty', currentLanguage === 'tr' ? 'Birim Fiyat' : 'Unit Price', currentLanguage === 'tr' ? 'Toplam' : 'Total' ]],
                              body: lineItems505.map(li => [ li.name || li.title || '', li.sku || '', li.quantity, `₺${(li.price || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2 })}`, `₺${((li.price || 0) * li.quantity).toLocaleString('tr-TR', { minimumFractionDigits: 2 })}` ]),
                              styles: { font: 'Roboto', fontSize: 9, cellPadding: 3 },
                              headStyles: { fillColor: [255, 64, 0], textColor: [255, 255, 255], fontStyle: 'bold' },
                              alternateRowStyles: { fillColor: [253, 248, 246] },
                              foot: [[{ content: currentLanguage === 'tr' ? 'TOPLAM' : 'TOTAL', colSpan: 4, styles: { halign: 'right', fontStyle: 'bold' } }, `₺${(o.totalPrice || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2 })}`]],
                              footStyles: { fillColor: [245, 245, 245], fontStyle: 'bold', fontSize: 10 },
                            });
                          } else {
                            const y505 = 58;
                            doc505.setFontSize(10); doc505.setTextColor(30,30,30);
                            doc505.text(`${currentLanguage === 'tr' ? 'Toplam Tutar' : 'Total Amount'}: ₺${(o.totalPrice || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2 })}`, 14, y505);
                          }
                          const finalY505 = (doc505 as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY || 80;
                          doc505.setFontSize(8); doc505.setTextColor(150,150,150);
                          doc505.text(`${currentLanguage === 'tr' ? 'Durum' : 'Status'}: ${o.status} · ${o.paid ? (currentLanguage === 'tr' ? 'Ödendi ✓' : 'Paid ✓') : (currentLanguage === 'tr' ? 'Ödeme Bekleniyor' : 'Payment Pending')}`, 14, finalY505 + 10);
                          doc505.text('CETPA Business Suite — app.cetpa.com.tr', W / 2, finalY505 + 18, { align: 'center' });
                          doc505.save(`receipt-${o.shopifyOrderId || o.id.slice(-8)}.pdf`);
                        }}
                        className="bg-white hover:bg-gray-50 text-gray-700 px-4 py-2 rounded-full text-sm font-bold flex items-center gap-2 shadow-sm border border-gray-200 transition-colors"
                        title={currentLanguage === 'tr' ? 'Sipariş fişi PDF indir' : 'Download order receipt PDF'}
                      >
                        <FileDown className="w-4 h-4" />
                        {currentLanguage === 'tr' ? 'Fiş PDF' : 'Receipt'}
                      </button>
                      {/* Phase 512: Quick Shipment from Order */}
                      <button
                        onClick={() => setShowQuickShipment(selectedOrder)}
                        className="bg-white hover:bg-blue-50 text-gray-700 hover:text-blue-700 px-4 py-2 rounded-full text-sm font-bold flex items-center gap-2 shadow-sm border border-gray-200 hover:border-blue-200 transition-colors"
                        title={currentLanguage === 'tr' ? 'Sevkiyat oluştur' : 'Create shipment'}
                      >
                        <Truck className="w-4 h-4" />
                        {currentLanguage === 'tr' ? 'Sevkiyat' : 'Shipment'}
                      </button>
                      {/* Copy public tracking link */}
                      <button
                        onClick={() => {
                          const url = `${window.location.origin}/?track=${selectedOrder.id}`;
                          navigator.clipboard.writeText(url).then(() =>
                            toast(currentLanguage === 'tr' ? 'Takip linki kopyalandı ✓' : 'Tracking link copied ✓', 'success')
                          ).catch(() => {});
                        }}
                        className="bg-white hover:bg-gray-50 text-gray-700 px-4 py-2 rounded-full text-sm font-bold flex items-center gap-2 shadow-sm border border-gray-200 transition-colors"
                        title={currentLanguage === 'tr' ? 'Müşteri takip linkini kopyala' : 'Copy customer tracking link'}
                      >
                        <Link className="w-4 h-4" />
                        {currentLanguage === 'tr' ? 'Takip Linki' : 'Track Link'}
                      </button>
                      {/* Phase 57: Copy Order Summary (WhatsApp-ready) */}
                      <button
                        onClick={() => {
                          const o = selectedOrder;
                          const trackUrl = `${window.location.origin}/?track=${o.id}`;
                          // Kur yoksa mesajı HİÇ üretme (2026-08-26): eskiden `||1` ile TL tutar '$' ile
                          // basılıyordu (~38× şişkin). '—' de müşteriye giden metne akmamalı.
                          const _waCv = kpiCurrency === 'TRY' ? (o.totalPrice||0) : kurCevir(o.totalPrice||0, kpiCurrency, exchangeRates);
                          if (_waCv === null) {
                            toast(currentLanguage === 'tr'
                              ? 'Kur bilgisi yok — tutar çevrilemediği için özet kopyalanmadı.'
                              : 'Exchange rate unavailable — summary not copied.', 'error');
                            return;
                          }
                          const _waSym  = kpiCurrency === 'TRY' ? '₺' : kpiCurrency === 'USD' ? '$' : '€';
                          const _waAmt  = `${_waSym}${_waCv.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}`;
                          const summary = currentLanguage === 'tr'
                            ? `📦 *Sipariş Özeti*\nSipariş No: #${o.shopifyOrderId || o.id.slice(-6)}\nMüşteri: ${o.customerName}\nDurum: ${o.status}\nTutar: ${_waAmt}\n${o.trackingNumber ? `Kargo Takip: ${o.trackingNumber}\n` : ''}Takip Linki: ${trackUrl}`
                            : `📦 *Order Summary*\nOrder: #${o.shopifyOrderId || o.id.slice(-6)}\nCustomer: ${o.customerName}\nStatus: ${o.status}\nTotal: ${_waAmt}\n${o.trackingNumber ? `Tracking: ${o.trackingNumber}\n` : ''}Link: ${trackUrl}`;
                          navigator.clipboard.writeText(summary).then(() =>
                            toast(currentLanguage === 'tr' ? 'Sipariş özeti kopyalandı ✓' : 'Order summary copied ✓', 'success')
                          ).catch(() => {});
                        }}
                        className="bg-white hover:bg-green-50 text-gray-700 hover:text-green-700 px-4 py-2 rounded-full text-sm font-bold flex items-center gap-2 shadow-sm border border-gray-200 hover:border-green-200 transition-colors"
                        title={currentLanguage === 'tr' ? 'WhatsApp özeti kopyala' : 'Copy summary (WhatsApp-ready)'}
                      >
                        <MessageSquare className="w-4 h-4" />
                        {currentLanguage === 'tr' ? 'Özet Kopyala' : 'Copy Summary'}
                      </button>
                      {/* Phase 511: Payment Reminder copy button */}
                      {!selectedOrder.paid && (
                        <button
                          onClick={() => {
                            const o = selectedOrder;
                            // Ödeme hatırlatması MÜŞTERİYE gider: kur yoksa yanlış tutar (eskiden `||1`
                            // → TL tutar '$' ile, ~38× şişkin) yerine mesajı hiç üretme.
                            const cv = kpiCurrency === 'TRY' ? o.totalPrice : kurCevir(o.totalPrice, kpiCurrency, exchangeRates);
                            if (cv === null) {
                              toast(currentLanguage === 'tr'
                                ? 'Kur bilgisi yok — tutar çevrilemediği için hatırlatma oluşturulmadı.'
                                : 'Exchange rate unavailable — reminder not generated.', 'error');
                              return;
                            }
                            const sym = kpiCurrency === 'TRY' ? '₺' : kpiCurrency === 'USD' ? '$' : '€';
                            const amt = `${sym}${cv.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                            const msg = currentLanguage === 'tr'
                              ? `Sayın ${o.customerName},\n\nSipariş No: #${o.shopifyOrderId || o.id.slice(-6)} için ${amt} tutarındaki ödemeniz henüz tarafımıza ulaşmamıştır.\n\nÖdemenizi en kısa sürede gerçekleştirmenizi rica ederiz.\n\nSaygılarımızla,\nCETPA`
                              : `Dear ${o.customerName},\n\nPayment of ${amt} for Order #${o.shopifyOrderId || o.id.slice(-6)} has not yet been received.\n\nPlease arrange payment at your earliest convenience.\n\nBest regards,\nCETPA`;
                            navigator.clipboard.writeText(msg).then(() =>
                              toast(currentLanguage === 'tr' ? 'Ödeme hatırlatması kopyalandı ✓' : 'Payment reminder copied ✓', 'success')
                            ).catch(() => {});
                          }}
                          className="bg-amber-50 hover:bg-amber-100 text-amber-700 px-4 py-2 rounded-full text-sm font-bold flex items-center gap-2 shadow-sm border border-amber-200 transition-colors"
                          title={currentLanguage === 'tr' ? 'Ödeme hatırlatma mesajını kopyala' : 'Copy payment reminder message'}
                        >
                          <Bell className="w-4 h-4" />
                          {currentLanguage === 'tr' ? 'Hatırlatma' : 'Reminder'}
                        </button>
                      )}
                      {/* Phase 513: Order Profitability popup */}
                      {selectedOrder.lineItems && selectedOrder.lineItems.length > 0 && (() => {
                        const revenue = selectedOrder.totalPrice || 0;
                        const cogs = selectedOrder.lineItems.reduce((s, li) => {
                          const inv = inventory.find(i => i.id === li.inventoryId || i.sku === li.sku);
                          return s + (li.costPrice ?? (inv ? itemCostTRY(inv, exchangeRates) : li.price * 0.6)) * li.quantity;
                        }, 0);
                        const gp = revenue - cogs;
                        const margin = revenue > 0 ? (gp / revenue * 100) : 0;
                        return (
                          <div className="relative">
                            <button
                              onClick={() => setP513Selected(p513Selected === selectedOrder.id ? null : selectedOrder.id)}
                              className={cn(
                                "px-4 py-2 rounded-full text-sm font-bold flex items-center gap-2 shadow-sm border transition-colors",
                                margin >= 30 ? "bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border-emerald-200"
                                  : margin >= 10 ? "bg-amber-50 hover:bg-amber-100 text-amber-700 border-amber-200"
                                  : "bg-red-50 hover:bg-red-100 text-red-700 border-red-200"
                              )}
                              title={currentLanguage === 'tr' ? 'Kâr analizi' : 'Profit analysis'}
                            >
                              <TrendingUp className="w-4 h-4" />
                              {currentLanguage === 'tr' ? `Kâr %${margin.toFixed(1)}` : `Margin ${margin.toFixed(1)}%`}
                            </button>
                            {p513Selected === selectedOrder.id && (
                              <div className="absolute right-0 top-full mt-2 w-72 bg-white rounded-2xl shadow-2xl border border-gray-200 z-50 p-5">
                                <div className="flex items-center justify-between mb-4">
                                  <h4 className="font-bold text-sm">{currentLanguage === 'tr' ? 'Kâr Analizi' : 'Profit Analysis'}</h4>
                                  <button onClick={() => setP513Selected(null)} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
                                </div>
                                <div className="space-y-2.5 text-sm">
                                  <div className="flex justify-between">
                                    <span className="text-gray-500">{currentLanguage === 'tr' ? 'Gelir' : 'Revenue'}</span>
                                    <span className="font-bold text-emerald-600">₺{revenue.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}</span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span className="text-gray-500">{currentLanguage === 'tr' ? 'Maliyet (COGS)' : 'Cost (COGS)'}</span>
                                    <span className="font-bold text-red-500">−₺{cogs.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}</span>
                                  </div>
                                  <div className="h-px bg-gray-100" />
                                  <div className="flex justify-between">
                                    <span className="font-bold">{currentLanguage === 'tr' ? 'Brüt Kâr' : 'Gross Profit'}</span>
                                    <span className={cn("font-black", gp >= 0 ? "text-emerald-600" : "text-red-600")}>₺{gp.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}</span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span className="text-gray-500">{currentLanguage === 'tr' ? 'Kâr Marjı' : 'Margin'}</span>
                                    <span className={cn("font-bold px-2 py-0.5 rounded-full text-xs", margin >= 30 ? "bg-emerald-100 text-emerald-700" : margin >= 10 ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700")}>
                                      %{margin.toFixed(1)}
                                    </span>
                                  </div>
                                  {/* Item-level breakdown */}
                                  {selectedOrder.lineItems!.length > 0 && (
                                    <div className="mt-3 pt-3 border-t border-gray-100 space-y-1.5">
                                      {selectedOrder.lineItems!.map((li, i) => {
                                        const inv2 = inventory.find(x => x.id === li.inventoryId || x.sku === li.sku);
                                        const liCost = (li.costPrice ?? (inv2 ? itemCostTRY(inv2, exchangeRates) : li.price * 0.6)) * li.quantity;
                                        const liRev = li.price * li.quantity;
                                        return (
                                          <div key={i} className="flex justify-between text-[11px]">
                                            <span className="text-gray-500 truncate max-w-[160px]">{li.name} ×{li.quantity}</span>
                                            <span className={liRev >= liCost ? "text-emerald-600 font-semibold" : "text-red-500 font-semibold"}>
                                              ₺{(liRev - liCost).toLocaleString('tr-TR', { minimumFractionDigits: 0 })}
                                            </span>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })()}
                      {/* Phase 112: RMA / Return button */}
                      {selectedOrder.status === 'Delivered' && (
                        <button
                          onClick={() => { setReturnModal({ open: true, order: selectedOrder }); setReturnAmount(selectedOrder.totalPrice || 0); setReturnItems(''); setReturnReason(''); }}
                          className="bg-white hover:bg-orange-50 text-gray-700 hover:text-orange-700 px-4 py-2 rounded-full text-sm font-bold flex items-center gap-2 shadow-sm border border-gray-200 hover:border-orange-200 transition-colors"
                          title={currentLanguage === 'tr' ? 'İade Talebi Oluştur' : 'Create Return Request'}
                        >
                          <RefreshCw className="w-4 h-4" />
                          {currentLanguage === 'tr' ? 'İade' : 'Return'}
                        </button>
                      )}

                      {/* Phase 89: Mark Paid / Unpaid toggle in detail header */}
                      <button
                        onClick={() => handleToggleOrderPaid(selectedOrder)}
                        className={`px-4 py-2 rounded-full text-sm font-bold flex items-center gap-2 shadow-sm border transition-colors ${
                          selectedOrder.paid
                            ? 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border-emerald-200'
                            : 'bg-amber-50 hover:bg-amber-100 text-amber-700 border-amber-200'
                        }`}
                        title={selectedOrder.paid ? (currentLanguage === 'tr' ? 'Ödendi — tıkla: ödenmedi yap' : 'Paid — click to mark unpaid') : (currentLanguage === 'tr' ? 'Bekliyor — tıkla: ödendi yap' : 'Pending — click to mark paid')}
                      >
                        <CreditCard className="w-4 h-4" />
                        {selectedOrder.paid
                          ? (currentLanguage === 'tr' ? '✓ Ödendi' : '✓ Paid')
                          : (currentLanguage === 'tr' ? '⏳ Ödenmedi' : '⏳ Unpaid')}
                      </button>
                      <button onClick={() => openConfirm({
                        title: currentT.confirm_delete_title,
                        message: currentT.confirm_delete,
                        confirmLabel: currentT.edit,
                        onConfirm: () => { setEditingOrderData(selectedOrder); setIsEditingOrder(true); }
                      })} className="bg-white hover:bg-gray-50 text-gray-700 px-4 py-2 rounded-full text-sm font-bold flex items-center gap-2 shadow-sm border border-gray-200 transition-colors">
                        <Edit2 className="w-4 h-4" /> Edit
                      </button>
                      <button onClick={() => openConfirm({
                        title: currentT.confirm_delete_title,
                        message: currentT.confirm_delete,
                        confirmLabel: currentT.delete,
                        variant: 'danger',
                        onConfirm: () => { handleDeleteOrder(selectedOrder.id); setSelectedOrder(null); }
                      })} className="bg-white hover:bg-red-50 text-red-600 px-4 py-2 rounded-full text-sm font-bold flex items-center gap-2 shadow-sm border border-gray-200 transition-colors">
                        <Trash2 className="w-4 h-4" /> Delete
                      </button>
                    </div>
                  }
                />
              </div>

              {/* ── Order Status Timeline (Phase 23) ── */}
              <OrderStatusTimeline status={selectedOrder.status} lang={currentLanguage} />

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="space-y-6">
                  <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
                    <h3 className="font-bold mb-4">{currentT.order_details}</h3>
                    <div className="space-y-4 text-sm">
                      <div>
                        <span className="text-gray-500 block text-[10px] uppercase font-bold mb-1">{currentT.status}</span>
                        <select value={selectedOrder.status} onChange={(e) => openConfirm({
                          title: currentT.status,
                          message: `Update status to "${e.target.value}"?`,
                          onConfirm: () => { handleUpdateOrderStatus(selectedOrder.id, e.target.value as 'Pending' | 'Processing' | 'Shipped' | 'Delivered' | 'Cancelled'); setSelectedOrder({ ...selectedOrder, status: e.target.value as 'Pending' | 'Processing' | 'Shipped' | 'Delivered' | 'Cancelled' }); }
                        })}
                          className="block w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 outline-none focus:border-brand font-medium">
                          <option value="Pending">{currentT.pending}</option>
                          <option value="Processing">{currentT.processing}</option>
                          <option value="Shipped">{currentT.shipped}</option>
                          <option value="Delivered">{currentT.delivered}</option>
                          <option value="Cancelled">{currentT.cancelled}</option>
                        </select>
                      </div>
                      <div>
                        <span className="text-gray-500 block text-[10px] uppercase font-bold">{currentT.total_price}</span>
                        <span className="font-bold text-lg">${selectedOrder.totalPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      </div>
                      <div>
                        <span className="text-gray-500 block text-[10px] uppercase font-bold">{currentT.tracking_number}</span>
                        <span className="font-medium">{selectedOrder.trackingNumber || '--'}</span>
                      </div>
                      <div>
                        <span className="text-gray-500 block text-[10px] uppercase font-bold">{currentT.shipping_address}</span>
                        <span className="font-medium">{selectedOrder.shippingAddress || '--'}</span>
                      </div>
                      <div>
                        <span className="text-gray-500 block text-[10px] uppercase font-bold">{currentT.date}</span>
                        <span className="font-medium">{selectedOrder.syncedAt ? (typeof (selectedOrder.syncedAt as { toDate?: () => Date }).toDate === 'function' ? (selectedOrder.syncedAt as { toDate: () => Date }).toDate() : new Date(selectedOrder.syncedAt as unknown as string | number | Date)).toLocaleString() : currentT.unknown_date}</span>
                      </div>
                      {/* Phase 95: Payment status + estimated delivery in detail grid */}
                      <div>
                        <span className="text-gray-500 block text-[10px] uppercase font-bold">
                          {currentLanguage === 'tr' ? 'Ödeme' : 'Payment'}
                        </span>
                        <button
                          onClick={() => handleToggleOrderPaid(selectedOrder)}
                          className={`mt-0.5 text-xs font-bold px-2.5 py-1 rounded-full transition-colors ${selectedOrder.paid ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200' : 'bg-amber-50 text-amber-600 hover:bg-amber-100'}`}
                        >
                          {selectedOrder.paid ? (currentLanguage === 'tr' ? '✓ Ödendi' : '✓ Paid') : (currentLanguage === 'tr' ? '⏳ Ödenmedi' : '⏳ Unpaid')}
                        </button>
                      </div>
                      {/* estimatedDelivery tipi `unknown`; `x && <jsx>` sonucu unknown olup ReactNode'a atanamiyor -> dogruluk kontrolunu boolean'a indirge */}
                      {!!selectedOrder.estimatedDelivery && (() => {
                        const ed = typeof (selectedOrder.estimatedDelivery as { toDate?: () => Date }).toDate === 'function'
                          ? (selectedOrder.estimatedDelivery as { toDate: () => Date }).toDate()
                          : new Date(selectedOrder.estimatedDelivery as string | number);
                        const isOverdue = ed < new Date() && selectedOrder.status !== 'Delivered' && selectedOrder.status !== 'Cancelled';
                        return (
                          <div>
                            <span className="text-gray-500 block text-[10px] uppercase font-bold">
                              {currentLanguage === 'tr' ? 'Tahmini Teslimat' : 'Est. Delivery'}
                            </span>
                            <span className={`font-medium text-sm flex items-center gap-1.5 mt-0.5 ${isOverdue ? 'text-red-600' : 'text-gray-800'}`}>
                              {isOverdue && <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />}
                              {ed.toLocaleDateString()}
                              {isOverdue && <span className="text-[9px] font-bold bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full">{currentLanguage === 'tr' ? 'GECİKTİ' : 'OVERDUE'}</span>}
                            </span>
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                  {/* Phase 40: Order Quick Note */}
                  <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="font-bold">{currentT.notes}</h3>
                      {orderNoteSaved && <span className="text-[10px] text-emerald-600 font-bold flex items-center gap-1"><CheckCircle2 className="w-3 h-3" />{currentLanguage === 'tr' ? 'Kaydedildi' : 'Saved'}</span>}
                    </div>
                    <textarea
                      value={orderNoteText}
                      onChange={e => { setOrderNoteText(e.target.value); setOrderNoteSaved(false); }}
                      onBlur={() => void handleSaveOrderNote()}
                      rows={4}
                      placeholder={currentT.no_notes_available}
                      className="w-full text-sm text-gray-700 bg-gray-50 rounded-xl px-3 py-2.5 outline-none focus:ring-2 focus:ring-brand/20 resize-none leading-relaxed"
                    />
                    {orderNoteSaving && <p className="text-[10px] text-gray-400 mt-1">{currentLanguage === 'tr' ? 'Kaydediliyor…' : 'Saving…'}</p>}
                  </div>

                  {/* ── Phase 101: Order Activity Timeline ── */}
                  {(() => {
                    const events: TimelineEntry[] = [
                      // creation event from order data
                      ...((() => {
                        const raw = selectedOrder.createdAt ?? selectedOrder.syncedAt;
                        if (!raw) return [] as TimelineEntry[];
                        const ts = typeof (raw as { toDate?: () => Date }).toDate === 'function'
                          ? (raw as { toDate: () => Date }).toDate().getTime()
                          : new Date(raw as string | number).getTime();
                        return [{ action: currentLanguage === 'tr' ? 'Sipariş oluşturuldu' : 'Order created', actor: selectedOrder.customerName || '—', ts }] as TimelineEntry[];
                      })()),
                      // Firestore-stored timeline entries
                      ...orderTimeline,
                    ].sort((a, b) => a.ts - b.ts);

                    if (events.length === 0) return null;
                    return (
                      <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
                        <h3 className="font-bold text-sm mb-4 flex items-center gap-2">
                          <History className="w-4 h-4 text-brand" />
                          {currentLanguage === 'tr' ? 'Sipariş Geçmişi' : 'Order History'}
                        </h3>
                        <div className="relative pl-5">
                          {/* vertical line */}
                          <div className="absolute left-2 top-1.5 bottom-1.5 w-px bg-gray-100" />
                          <div className="space-y-4">
                            {events.map((ev, i) => {
                              const d = new Date(ev.ts);
                              const isLast = i === events.length - 1;
                              return (
                                <div key={i} className="relative flex gap-3 items-start">
                                  <div className={`absolute -left-5 mt-0.5 w-3 h-3 rounded-full border-2 ${isLast ? 'bg-brand border-brand' : 'bg-white border-gray-300'}`} />
                                  <div className="flex-1 min-w-0">
                                    <p className="text-xs font-bold text-gray-800">{ev.action}</p>
                                    <p className="text-[10px] text-gray-400 mt-0.5">
                                      {ev.actor} · {d.toLocaleDateString('tr-TR', { day: '2-digit', month: 'short' })} {d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}
                                    </p>
                                    {ev.note && <p className="text-[10px] text-gray-500 mt-0.5 italic">"{ev.note}"</p>}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                </div>
                <div className="lg:col-span-2 space-y-6">
                  <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
                    <h3 className="font-bold mb-4 flex items-center gap-2">
                      <Package className="w-5 h-5 text-brand" /> {currentT.order_items}
                    </h3>
                    {selectedOrder.lineItems && selectedOrder.lineItems.length > 0 ? (
                      <div className="border border-gray-100 rounded-xl overflow-hidden">
                        <table className="w-full text-sm">
                          <thead className="bg-gray-50 border-b border-gray-100">
                            <tr>
                              <th className="px-4 py-2 text-left text-[10px] font-bold text-gray-500 uppercase">{currentT.product}</th>
                              <th className="px-4 py-2 text-center text-[10px] font-bold text-gray-500 uppercase">{currentT.qty}</th>
                              <th className="px-4 py-2 text-right text-[10px] font-bold text-gray-500 uppercase">{currentT.unit}</th>
                              <th className="px-4 py-2 text-right text-[10px] font-bold text-gray-500 uppercase">{currentT.subtotal}</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-50">
                            {selectedOrder.lineItems.map((item, idx) => (
                              <tr key={idx}>
                                <td className="px-4 py-3">
                                  <p className="font-bold text-[#1D2226]">{item.title}</p>
                                  {item.sku && <p className="text-[10px] text-gray-400">{item.sku}</p>}
                                </td>
                                <td className="px-4 py-3 text-center font-medium">{item.quantity}</td>
                                <td className="px-4 py-3 text-right text-gray-500">₺{(item.price ?? 0).toFixed(2)}</td>
                                <td className="px-4 py-3 text-right font-bold text-[#1D2226]">₺{((item.price ?? 0) * (item.quantity ?? 0)).toFixed(2)}</td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot className="border-t border-gray-200 bg-gray-50">
                            <tr>
                              <td colSpan={3} className="px-4 py-3 font-bold text-gray-500 text-sm">{currentT.total}</td>
                              <td className="px-4 py-3 text-right text-lg font-bold text-brand">
                                ${selectedOrder.lineItems.reduce((s, l) => s + l.price * l.quantity, 0).toFixed(2)}
                              </td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    ) : (
                      <div className="text-center py-12 border-2 border-dashed border-gray-100 rounded-xl">
                        <Package className="w-12 h-12 text-gray-200 mx-auto mb-3" />
                        <p className="text-sm text-gray-500 font-medium">{currentT.no_items_on_order}</p>
                        <p className="text-xs text-gray-400 mt-1">{currentT.product_picker_hint}</p>
                      </div>
                    )}

                    {/* ── Phase 74: Gross Profit Summary ── */}
                    {selectedOrder.lineItems && selectedOrder.lineItems.length > 0 && (() => {
                      const hasCost = selectedOrder.lineItems.some(l => (l.costPrice ?? 0) > 0);
                      if (!hasCost) return null;
                      const revenue  = selectedOrder.lineItems.reduce((s, l) => s + l.price * l.quantity, 0);
                      const cost     = selectedOrder.lineItems.reduce((s, l) => s + ((l.costPrice ?? 0) * l.quantity), 0);
                      const gp       = revenue - cost;
                      const gpPct    = revenue > 0 ? Math.round((gp / revenue) * 100) : 0;
                      const gpColor  = gpPct >= 40 ? 'text-emerald-700' : gpPct >= 20 ? 'text-amber-700' : 'text-red-600';
                      const gpBg     = gpPct >= 40 ? 'bg-emerald-50 border-emerald-100' : gpPct >= 20 ? 'bg-amber-50 border-amber-100' : 'bg-red-50 border-red-100';
                      const barColor = gpPct >= 40 ? 'bg-emerald-400' : gpPct >= 20 ? 'bg-amber-400' : 'bg-red-400';
                      return (
                        <div className={`rounded-xl border px-4 py-3 ${gpBg} mt-3`}>
                          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">
                            {currentLanguage === 'tr' ? 'Tahmini Brüt Kâr' : 'Est. Gross Profit'}
                          </p>
                          <div className="flex items-center justify-between gap-4">
                            <div>
                              <p className={`text-xl font-black ${gpColor}`}>
                                ₺{gp.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </p>
                              <p className="text-[10px] text-gray-500 mt-0.5">
                                {currentLanguage === 'tr' ? 'Maliyet' : 'COGS'}: ₺{cost.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </p>
                            </div>
                            <div className="flex-1 max-w-[120px]">
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-[10px] text-gray-400">{currentLanguage === 'tr' ? 'Marj' : 'Margin'}</span>
                                <span className={`text-sm font-black ${gpColor}`}>{gpPct}%</span>
                              </div>
                              <div className="w-full bg-gray-200 rounded-full h-2">
                                <div className={`${barColor} h-2 rounded-full transition-all duration-700`} style={{ width: `${Math.min(gpPct, 100)}%` }} />
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {/* ── Lojistik & Depo ── */}
          {activeTab === 'lojistik' && (
            <motion.div key="lojistik" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-6">
              <ModuleHeader 
                title={currentLanguage === 'tr' ? 'Lojistik & Depo' : 'Logistics & Warehouse'} 
                subtitle={currentLanguage === 'tr' ? 'Sevkiyatlar, depo yönetimi ve transferler' : 'Shipments, warehouse management and transfers'}
                icon={Truck}
              />
              {/* Lojistik Sub-tabs (hidden on desktop — sidebar handles nav) */}
              <div className="lg:hidden overflow-x-auto scrollbar-none -mx-3 px-3">
                <div className="flex gap-1 p-1 bg-white/80 border border-gray-100 rounded-2xl shadow-sm w-max mb-2">
                  {[
                    { id: 'sevkiyat', label: currentLanguage === 'tr' ? 'Sevkiyatlar' : 'Shipments', icon: Truck },
                    { id: 'kargo_takip', label: currentLanguage === 'tr' ? 'Kargo Takip' : 'Tracking', icon: Navigation },
                    { id: 'depo', label: currentLanguage === 'tr' ? 'Depo' : 'Warehouse', icon: Building2 },
                    { id: 'wms', label: currentLanguage === 'tr' ? 'Bin/Lokasyon' : 'Bin/Location', icon: MapPin },
                    { id: 'transfer', label: currentLanguage === 'tr' ? 'Depolar Arası' : 'Transfer', icon: ArrowRightLeft },
                    { id: 'qr-transfer', label: currentLanguage === 'tr' ? 'QR Transfer' : 'QR Transfer', icon: QrCode },
                    { id: 'arac-takip', label: currentLanguage === 'tr' ? 'Araç Takip' : 'Vehicles', icon: Truck },
                    { id: 'giden_irsaliye', label: currentLanguage === 'tr' ? 'Giden İrsaliye' : 'Outgoing', icon: FileUp },
                    { id: 'gelen_irsaliye', label: currentLanguage === 'tr' ? 'Gelen İrsaliye' : 'Incoming', icon: FileDown },
                  ].map(tab => {
                    const Icon = tab.icon;
                    return (
                      <button key={tab.id} onClick={() => setLojistikTab(tab.id)}
                        className={`shrink-0 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all whitespace-nowrap ${lojistikTab === tab.id ? 'bg-brand text-white shadow-sm' : 'text-[#86868B] hover:text-[#1D1D1F] hover:bg-gray-100'}`}>
                        <Icon size={13} /><span>{tab.label}</span>
                      </button>
                    );
                  })}
                  <div className="w-px h-5 bg-gray-200 self-center mx-0.5 shrink-0" />
                  <button onClick={() => setActiveTab('ihracat')} className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-[#86868B] hover:text-[#1D1D1F] hover:bg-gray-100 transition-all whitespace-nowrap">
                    <Ship size={13} />
                    <span>{currentLanguage === 'tr' ? 'İthalat/İhracat' : 'Import/Export'}</span>
                  </button>
                </div>
              </div>

              {/* ── Kargo Takip ── */}
              {lojistikTab === 'kargo_takip' && (
                <CargoTrackingTab darkMode={darkMode} currentLanguage={currentLanguage} />
              )}
              {/* Lojistik sub-tab: Depo/Transfer/İrsaliye via AccountingModule */}
              {lojistikTab === 'depo' && (
                <AccountingModule key="loj-depo" orders={orders} currentLanguage={currentLanguage} isAuthenticated={!!user} userRole={userRole} exchangeRates={exchangeRates ?? undefined} initialTab="depo" allowedTabs={['depo']} createNotification={createNotification} warehouses={warehouses} employees={employees} />
              )}
              {lojistikTab === 'transfer' && (
                <AccountingModule key="loj-transfer" orders={orders} currentLanguage={currentLanguage} isAuthenticated={!!user} userRole={userRole} exchangeRates={exchangeRates ?? undefined} initialTab="transfer" allowedTabs={['transfer']} createNotification={createNotification} warehouses={warehouses} employees={employees} />
              )}
              {lojistikTab === 'giden_irsaliye' && (
                <AccountingModule key="loj-giden" orders={orders} currentLanguage={currentLanguage} isAuthenticated={!!user} userRole={userRole} exchangeRates={exchangeRates ?? undefined} initialTab="giden_irsaliye" allowedTabs={['giden_irsaliye']} createNotification={createNotification} warehouses={warehouses} employees={employees} />
              )}
              {lojistikTab === 'gelen_irsaliye' && (
                <AccountingModule key="loj-gelen" orders={orders} currentLanguage={currentLanguage} isAuthenticated={!!user} userRole={userRole} exchangeRates={exchangeRates ?? undefined} initialTab="gelen_irsaliye" allowedTabs={['gelen_irsaliye']} createNotification={createNotification} warehouses={warehouses} employees={employees} />
              )}

              {/* ── Phase 554: WMS Bin/Location Management ─────────────────────────── */}
              {lojistikTab === 'wms' && (() => {
                const tr554 = currentLanguage === 'tr';
                const filtered554 = p554Bins.filter(b =>
                  !p554Search || b.binCode.toLowerCase().includes(p554Search.toLowerCase()) ||
                  b.productSku.toLowerCase().includes(p554Search.toLowerCase()) ||
                  b.productName.toLowerCase().includes(p554Search.toLowerCase())
                );
                const warehouseGroups = filtered554.reduce<Record<string,typeof p554Bins>>((acc, b) => {
                  const key = b.warehouseName || b.warehouseId || tr554 ? 'Depo' : 'Warehouse';
                  if (!acc[key]) acc[key] = [];
                  acc[key].push(b);
                  return acc;
                }, {});
                const lowStock = p554Bins.filter(b => b.minQty !== undefined && b.quantity < b.minQty).length;

                return (
                  <motion.div key="wms" initial={{opacity:0,y:10}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-10}} className="space-y-4">
                    <ModuleHeader
                      title={tr554 ? 'Bin / Lokasyon Yönetimi' : 'Bin / Location Management'}
                      subtitle={tr554 ? 'Depo içi raf ve lokasyon bazlı stok takibi' : 'Rack and bin-level stock tracking within warehouses'}
                      icon={MapPin}
                      actionButton={hasFullAccess('lojistik') ? (
                        <button onClick={() => setP554AddForm(v => !v)} className="apple-button-primary px-4 py-2 text-sm flex items-center gap-1.5">
                          <Plus className="w-3.5 h-3.5" />{tr554 ? 'Lokasyon Ekle' : 'Add Location'}
                        </button>
                      ) : undefined}
                    />

                    {/* KPI strip */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      {[
                        { label: tr554 ? 'Toplam Bin' : 'Total Bins',          val: p554Bins.length,   color: 'text-blue-700',    bg: 'bg-blue-50',    icon: MapPin },
                        { label: tr554 ? 'Depolar' : 'Warehouses',             val: Object.keys(warehouseGroups).length, color: 'text-purple-700', bg: 'bg-purple-50', icon: Building2 },
                        { label: tr554 ? 'Düşük Stok Bin' : 'Low Stock Bins',  val: lowStock,          color: lowStock>0?'text-red-600':'text-emerald-600', bg: lowStock>0?'bg-red-50':'bg-emerald-50', icon: AlertTriangle },
                        { label: tr554 ? 'Toplam SKU' : 'Unique SKUs',         val: new Set(p554Bins.map(b => b.productSku).filter(Boolean)).size, color: 'text-amber-700', bg: 'bg-amber-50', icon: Package },
                      ].map(k => (
                        <div key={k.label} className={`apple-card p-4 flex items-center gap-3 ${k.bg}`}>
                          <k.icon className={`w-5 h-5 flex-shrink-0 ${k.color}`} />
                          <div><p className="text-xs text-gray-500">{k.label}</p><p className={`text-2xl font-bold ${k.color}`}>{k.val}</p></div>
                        </div>
                      ))}
                    </div>

                    {/* Add form */}
                    <AnimatePresence>
                      {p554AddForm && (
                        <motion.div initial={{opacity:0,height:0}} animate={{opacity:1,height:'auto'}} exit={{opacity:0,height:0}} className="overflow-hidden">
                          <div className="apple-card p-5 border-l-4 border-brand space-y-3">
                            <h4 className="font-bold text-gray-800 text-sm">{tr554 ? 'Yeni Lokasyon' : 'New Bin Location'}</h4>
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                              <div className="space-y-1">
                                <label className="text-[10px] font-bold text-gray-400 uppercase">{tr554 ? 'Depo' : 'Warehouse'}</label>
                                <select className="apple-input text-sm w-full" value={p554Draft.warehouseId}
                                  onChange={e => {
                                    const wh = warehouses.find(w => w.id === e.target.value);
                                    setP554Draft(d => ({ ...d, warehouseId: e.target.value, warehouseName: wh?.name || '' } as typeof d));
                                  }}>
                                  <option value="">{tr554 ? 'Depo seçin' : 'Select warehouse'}</option>
                                  {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                                </select>
                              </div>
                              <div className="space-y-1">
                                <label className="text-[10px] font-bold text-gray-400 uppercase">{tr554 ? 'Bin Kodu' : 'Bin Code'}</label>
                                <input className="apple-input text-sm w-full" placeholder="A1-03" value={p554Draft.binCode}
                                  onChange={e => setP554Draft(d => ({ ...d, binCode: e.target.value }))} />
                              </div>
                              <div className="space-y-1">
                                <label className="text-[10px] font-bold text-gray-400 uppercase">SKU</label>
                                <input className="apple-input text-sm w-full" placeholder="SKU-001" value={p554Draft.productSku}
                                  onChange={e => setP554Draft(d => ({ ...d, productSku: e.target.value }))} />
                              </div>
                              <div className="space-y-1">
                                <label className="text-[10px] font-bold text-gray-400 uppercase">{tr554 ? 'Ürün Adı' : 'Product Name'}</label>
                                <input className="apple-input text-sm w-full" placeholder={tr554 ? 'Ürün adı' : 'Product name'} value={p554Draft.productName}
                                  onChange={e => setP554Draft(d => ({ ...d, productName: e.target.value }))} />
                              </div>
                              <div className="space-y-1">
                                <label className="text-[10px] font-bold text-gray-400 uppercase">{tr554 ? 'Miktar' : 'Qty'}</label>
                                <input type="number" min="0" className="apple-input text-sm w-full" placeholder="0" value={p554Draft.quantity}
                                  onChange={e => setP554Draft(d => ({ ...d, quantity: e.target.value }))} />
                              </div>
                              <div className="space-y-1">
                                <label className="text-[10px] font-bold text-gray-400 uppercase">{tr554 ? 'Min. Stok' : 'Min Stock'}</label>
                                <input type="number" min="0" className="apple-input text-sm w-full" placeholder="0" value={p554Draft.minQty}
                                  onChange={e => setP554Draft(d => ({ ...d, minQty: e.target.value }))} />
                              </div>
                            </div>
                            <input className="apple-input text-sm w-full" placeholder={tr554 ? 'Not (opsiyonel)' : 'Notes (optional)'} value={p554Draft.notes}
                              onChange={e => setP554Draft(d => ({ ...d, notes: e.target.value }))} />
                            <div className="flex gap-2 justify-end">
                              <button onClick={() => setP554AddForm(false)} className="apple-button-secondary px-4 py-2 text-sm">{tr554 ? 'İptal' : 'Cancel'}</button>
                              <button
                                disabled={!p554Draft.warehouseId || !p554Draft.binCode}
                                onClick={async () => {
                                  const wh = warehouses.find(w => w.id === p554Draft.warehouseId);
                                  await addDoc(collection(db, 'warehouseBins'), {
                                    warehouseId: p554Draft.warehouseId,
                                    warehouseName: wh?.name || '',
                                    binCode: p554Draft.binCode,
                                    productSku: p554Draft.productSku,
                                    productName: p554Draft.productName,
                                    quantity: Number(p554Draft.quantity) || 0,
                                    minQty: p554Draft.minQty ? Number(p554Draft.minQty) : undefined,
                                    notes: p554Draft.notes || undefined,
                                    lastCounted: new Date().toISOString().slice(0,10),
                                    createdAt: serverTimestamp(),
                                  });
                                  setP554Draft({ warehouseId: '', binCode: '', productSku: '', productName: '', quantity: '', minQty: '', notes: '' });
                                  setP554AddForm(false);
                                  toast(tr554 ? 'Lokasyon eklendi.' : 'Location added.', 'success');
                                }}
                                className="apple-button-primary px-5 py-2 text-sm disabled:opacity-50"
                              >{tr554 ? 'Kaydet' : 'Save'}</button>
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {/* Search */}
                    <div className="apple-card p-4">
                      <div className="relative mb-4">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <input className="apple-input pl-9 w-full text-sm" placeholder={tr554 ? 'Bin kodu, SKU veya ürün adı ara…' : 'Search bin code, SKU or product…'}
                          value={p554Search} onChange={e => setP554Search(e.target.value)} />
                      </div>

                      {p554Bins.length === 0 ? (
                        <div className="text-center py-12 space-y-3">
                          <MapPin className="w-10 h-10 text-gray-200 mx-auto" />
                          <p className="text-gray-400 text-sm">{tr554 ? '"Lokasyon Ekle" ile depo içi bin takibine başlayın.' : 'Click "Add Location" to start tracking bin locations.'}</p>
                        </div>
                      ) : (
                        <div className="space-y-4">
                          {Object.entries(warehouseGroups).map(([whName, bins]) => (
                            <div key={whName}>
                              <div className="flex items-center gap-2 mb-2">
                                <Building2 className="w-4 h-4 text-gray-400" />
                                <h4 className="font-bold text-gray-700 text-sm">{whName}</h4>
                                <span className="text-xs text-gray-400">({bins.length} bin)</span>
                              </div>
                              <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                  <thead>
                                    <tr className="border-b border-gray-100">
                                      {[tr554?'Bin Kodu':'Bin Code', 'SKU', tr554?'Ürün':'Product', tr554?'Miktar':'Qty', tr554?'Min':'Min', tr554?'Son Sayım':'Last Count', ''].map(h => (
                                        <th key={h} className="py-2 px-3 text-left text-[10px] font-bold text-gray-400 uppercase">{h}</th>
                                      ))}
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-gray-50">
                                    {bins.map(b => {
                                      const isLow = b.minQty !== undefined && b.quantity < b.minQty;
                                      return (
                                        <tr key={b.id} className={`hover:bg-gray-50/50 transition-colors ${isLow ? 'bg-red-50/30' : ''}`}>
                                          <td className="px-3 py-2.5">
                                            <span className="font-mono font-bold text-gray-800 bg-gray-100 px-2 py-0.5 rounded text-xs">{b.binCode}</span>
                                          </td>
                                          <td className="px-3 py-2.5 font-mono text-xs text-gray-500">{b.productSku || '—'}</td>
                                          <td className="px-3 py-2.5 text-gray-700 max-w-[180px] truncate">{b.productName || '—'}</td>
                                          <td className="px-3 py-2.5">
                                            <span className={`font-bold ${isLow ? 'text-red-600' : 'text-gray-800'}`}>{b.quantity}</span>
                                            {isLow && <span className="ml-1 text-[9px] font-bold text-red-500 bg-red-100 px-1 py-0.5 rounded">LOW</span>}
                                          </td>
                                          <td className="px-3 py-2.5 text-gray-400 text-xs">{b.minQty ?? '—'}</td>
                                          <td className="px-3 py-2.5 text-gray-400 text-xs">{b.lastCounted || '—'}</td>
                                          <td className="px-3 py-2.5">
                                            <button onClick={async () => {
                                              const qty = window.prompt(tr554 ? 'Yeni miktar girin:' : 'Enter new quantity:', String(b.quantity));
                                              if (qty === null) return;
                                              const n = Number(qty);
                                              if (isNaN(n)) return;
                                              await updateDoc(doc(db, 'warehouseBins', b.id), { quantity: n, lastCounted: new Date().toISOString().slice(0,10) });
                                              toast(tr554 ? 'Miktar güncellendi.' : 'Quantity updated.', 'success');
                                            }} className="text-[10px] font-semibold text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 px-2 py-1 rounded-lg transition-colors">
                                              {tr554 ? 'Düzelt' : 'Adjust'}
                                            </button>
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </motion.div>
                );
              })()}

              {/* ── Phase 576: Tedarik Zinciri Performans KPI ─────────────────────── */}
              {lojistikTab === 'tedarik-kpi' && (() => {
                const tr576 = currentLanguage === 'tr';
                const now576 = new Date();
                const daysBack = p576Period === '7d' ? 7 : p576Period === '30d' ? 30 : 90;
                const from576 = new Date(now576.getTime() - daysBack * 86400000);
                const periodOrders = orders.filter(o => {
                  if (!o.createdAt) return false;
                  try {
                    const d = (o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string);
                    return d >= from576 && d <= now576;
                  } catch { return false; }
                });
                const shipped576 = periodOrders.filter(o => o.status === 'Shipped' || o.status === 'Delivered');
                const delivered576 = periodOrders.filter(o => o.status === 'Delivered');
                const cancelled576 = periodOrders.filter(o => o.status === 'Cancelled');
                const onTime576 = delivered576.filter(o => {
                  if (!o.estimatedDelivery) return true;
                  try {
                    const est = new Date(o.estimatedDelivery as string);
                    const del = o.deliveryPhoto ? now576 : est; // approximation
                    return del <= est;
                  } catch { return true; }
                });
                const fillRate = periodOrders.length > 0 ? (shipped576.length / periodOrders.length) * 100 : 0;
                const onTimeRate = delivered576.length > 0 ? (onTime576.length / delivered576.length) * 100 : 0;
                const cancelRate = periodOrders.length > 0 ? (cancelled576.length / periodOrders.length) * 100 : 0;
                // Average order processing time (created → shipped)
                const avgProcessDays = shipped576.length > 0
                  ? shipped576.reduce((s,o) => {
                    if (!o.createdAt) return s;
                    try {
                      const cr = (o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string);
                      return s + (now576.getTime() - cr.getTime()) / 86400000;
                    } catch { return s; }
                  }, 0) / shipped576.length : 0;
                // Low stock ratio
                const lowStockItems = inventory.filter(item => item.stockLevel <= item.lowStockThreshold);
                const lowStockRatio = inventory.length > 0 ? (lowStockItems.length / inventory.length) * 100 : 0;
                const kpis576 = [
                  { label: tr576?'Sipariş Doluluk Oranı':'Order Fill Rate', value: fillRate, unit: '%', good: fillRate >= 90, icon: '📦' },
                  { label: tr576?'Zamanında Teslimat':'On-Time Delivery', value: onTimeRate, unit: '%', good: onTimeRate >= 90, icon: '🚚' },
                  { label: tr576?'İptal Oranı':'Cancellation Rate', value: cancelRate, unit: '%', good: cancelRate <= 5, icon: '❌', invertGood: true },
                  { label: tr576?'Ort. İşlem Süresi':'Avg Processing Time', value: avgProcessDays, unit: tr576?' gün':' days', good: avgProcessDays <= 3, icon: '⏱', invertGood: true },
                  { label: tr576?'Düşük Stok Oranı':'Low Stock Ratio', value: lowStockRatio, unit: '%', good: lowStockRatio <= 10, icon: '⚠️', invertGood: true },
                  { label: tr576?'Aktif Sipariş':'Active Orders', value: periodOrders.filter(o=>['Pending','Processing'].includes(o.status)).length, unit: '', good: true, icon: '📋' },
                ];
                const cargoMap576: Record<string, number> = {};
                periodOrders.forEach(o => {
                  const c = o.cargoCompany || (tr576?'Bilinmiyor':'Unknown');
                  cargoMap576[c] = (cargoMap576[c]||0) + 1;
                });
                const cargos576 = Object.entries(cargoMap576).sort((a,b)=>b[1]-a[1]).slice(0,5);
                return (
                  <motion.div initial={{opacity:0,y:6}} animate={{opacity:1,y:0}} className="space-y-4">
                    <div className="flex items-center justify-between flex-wrap gap-3">
                      <ModuleHeader title={tr576?'Tedarik Zinciri KPI':'Supply Chain KPI'} subtitle={tr576?'Sipariş, teslimat ve stok performans göstergeleri.':'Order, delivery and inventory performance indicators.'} icon={TrendingUp} />
                      <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
                        {(['7d','30d','90d'] as const).map(p=>(
                          <button key={p} onClick={()=>setP576Period(p)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${p576Period===p?'bg-white shadow text-gray-900':'text-gray-500 hover:text-gray-700'}`}>
                            {p==='7d'?tr576?'7 Gün':'7 Days':p==='30d'?tr576?'30 Gün':'30 Days':tr576?'90 Gün':'90 Days'}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                      {kpis576.map(k=>(
                        <div key={k.label} className={`apple-card p-4 ${k.good?'':'border border-red-100'}`}>
                          <p className="text-lg mb-1">{k.icon}</p>
                          <p className="text-xs text-gray-500 font-semibold">{k.label}</p>
                          <p className={`text-2xl font-bold mt-1 ${k.good?'text-emerald-600':'text-red-500'}`}>{typeof k.value==='number'?k.value.toFixed(k.unit===''?0:1):k.value}{k.unit}</p>
                        </div>
                      ))}
                    </div>
                    {cargos576.length > 0 && (
                      <div className="apple-card p-5">
                        <h4 className="font-bold text-sm text-gray-800 mb-3">{tr576?'🚚 Kargo Firması Dağılımı':'🚚 Carrier Distribution'}</h4>
                        <div className="space-y-2">
                          {cargos576.map(([name,cnt])=>{
                            const pct = periodOrders.length>0?(cnt/periodOrders.length)*100:0;
                            return (
                              <div key={name} className="flex items-center gap-3">
                                <span className="text-xs text-gray-600 w-28 truncate font-medium">{name}</span>
                                <div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden">
                                  <div className="h-full bg-brand rounded-full" style={{width:`${pct}%`}} />
                                </div>
                                <span className="text-xs font-bold text-gray-700 w-10 text-right">{cnt}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </motion.div>
                );
              })()}

              {/* ── Phase 593: Araç Filosu Takibi ──────────────────────────────── */}
              {lojistikTab === 'qr-transfer' && (
                <div className="space-y-4">
                  <TransferScanPanel
                    currentLanguage={currentLanguage}
                    inventory={inventory}
                    warehouses={warehouses}
                    vehicles={vehicles}
                    locationStocks={locationStocks}
                    hasFullAccess={hasFullAccess}
                    toast={toast}
                  />
                  <LocationStockReport currentLanguage={currentLanguage} locationStocks={locationStocks} />
                </div>
              )}

              {lojistikTab === 'arac-takip' && (() => {
                const tr593 = currentLanguage === 'tr';
                const statusColors593: Record<string,string> = {'Müsait':'bg-green-100 text-green-700','Yolda':'bg-blue-100 text-blue-700','Bakımda':'bg-amber-100 text-amber-700','Arızalı':'bg-red-100 text-red-700'};
                const today593 = new Date().toISOString().slice(0,10);
                const maintenanceDue = p593Vehicles.filter(v=>v.nextService&&v.nextService<=new Date(Date.now()+7*86400000).toISOString().slice(0,10));
                const stats = {müsait:p593Vehicles.filter(v=>v.status==='Müsait').length, yolda:p593Vehicles.filter(v=>v.status==='Yolda').length, bakimda:p593Vehicles.filter(v=>v.status==='Bakımda'||v.status==='Arızalı').length};
                return (
                  <motion.div initial={{opacity:0,y:6}} animate={{opacity:1,y:0}} className="space-y-4">
                    <ModuleHeader title={tr593?'🚗 Araç Filosu Takibi':'🚗 Vehicle Fleet Tracking'} subtitle={tr593?'Araçların durum, sürücü ve bakım bilgilerini takip edin.':'Track vehicle status, drivers and maintenance schedules.'} icon={Truck}
                      actionButton={hasFullAccess('lojistik')&&(<button onClick={()=>setP593ShowForm(v=>!v)} className="apple-button-primary flex items-center gap-2 text-sm"><Plus className="w-4 h-4"/>{tr593?'Araç Ekle':'Add Vehicle'}</button>)} />
                    <div className="grid grid-cols-3 gap-4">
                      {[{label:tr593?'Müsait':'Available',val:stats.müsait,color:'text-green-700',bg:'bg-green-50'},{label:tr593?'Yolda':'On Route',val:stats.yolda,color:'text-blue-700',bg:'bg-blue-50'},{label:tr593?'Bakım/Arıza':'Maintenance',val:stats.bakimda,color:'text-amber-700',bg:'bg-amber-50'}].map(k=>(
                        <div key={k.label} className={`apple-card p-4 ${k.bg}`}><p className="text-xs text-gray-500">{k.label}</p><p className={`text-2xl font-bold ${k.color}`}>{k.val}</p></div>
                      ))}
                    </div>
                    {maintenanceDue.length>0&&(<div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3"><p className="text-sm font-bold text-amber-800">🔧 {maintenanceDue.length} {tr593?'araç bu hafta bakıma giriyor:':'vehicle(s) due for maintenance:'} {maintenanceDue.map(v=>v.plate).join(', ')}</p></div>)}
                    {p593ShowForm && (
                      <div className="apple-card p-5 space-y-3">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                          <input className="apple-input px-3 py-2 text-sm" placeholder={tr593?'Plaka':'Plate'} value={p593Draft.plate} onChange={e=>setP593Draft(d=>({...d,plate:e.target.value.toUpperCase()}))} />
                          <input className="apple-input px-3 py-2 text-sm" placeholder={tr593?'Sürücü':'Driver'} value={p593Draft.driver} onChange={e=>setP593Draft(d=>({...d,driver:e.target.value}))} />
                          <input className="apple-input px-3 py-2 text-sm" placeholder={tr593?'Marka/Model':'Model'} value={p593Draft.model} onChange={e=>setP593Draft(d=>({...d,model:e.target.value}))} />
                          <select className="apple-input px-3 py-2 text-sm" value={p593Draft.fuel} onChange={e=>setP593Draft(d=>({...d,fuel:e.target.value as typeof d.fuel}))}>
                            {(['Benzin','Dizel','LPG','Elektrik'] as const).map(f=><option key={f}>{f}</option>)}
                          </select>
                          <input type="number" className="apple-input px-3 py-2 text-sm" placeholder="KM" value={p593Draft.km} onChange={e=>setP593Draft(d=>({...d,km:e.target.value}))} />
                          <input type="date" className="apple-input px-3 py-2 text-sm" placeholder={tr593?'Son Bakım':'Last Service'} value={p593Draft.lastService} onChange={e=>setP593Draft(d=>({...d,lastService:e.target.value}))} />
                          <input type="date" className="apple-input px-3 py-2 text-sm" placeholder={tr593?'Sonraki Bakım':'Next Service'} value={p593Draft.nextService} onChange={e=>setP593Draft(d=>({...d,nextService:e.target.value}))} />
                        </div>
                        <div className="flex gap-2">
                          <button onClick={async ()=>{
                            // Plaka boşken eskiden SESSİZCE return ediliyordu: düğme hiçbir
                            // şey yapmıyor, mesaj da çıkmıyordu → "araç ekle çalışmıyor".
                            if(!p593Draft.plate.trim()){ toast(tr593?'Plaka zorunlu.':'Plate is required.','error'); return; }
                            try {
                              await addDoc(collection(db,'vehicles'),{plate:p593Draft.plate.trim(),driver:p593Draft.driver||'',model:p593Draft.model||'',status:p593Draft.status,lastService:p593Draft.lastService||'',nextService:p593Draft.nextService||'',km:Number(p593Draft.km)||0,fuel:p593Draft.fuel,createdAt:serverTimestamp()});
                              setP593Draft({plate:'',driver:'',model:'',status:'Müsait',lastService:'',nextService:'',km:'',fuel:'Dizel'});
                              setP593ShowForm(false);
                            } catch(e){
                              // Sunucunun gerçek mesajını göster (örn. yetki reddi) — genel
                              // metin, RBAC 403'ünü "bilinmeyen hata" gibi gösteriyordu.
                              console.error('[vehicle add]',e);
                              const msg = e instanceof Error && e.message ? e.message : (tr593?'Araç kaydedilemedi.':'Failed to save vehicle.');
                              toast(msg,'error');
                            }
                          }} className="apple-button-primary text-sm px-4 py-1.5">{tr593?'Kaydet':'Save'}</button>
                          <button onClick={()=>setP593ShowForm(false)} className="apple-button-secondary text-sm px-4 py-1.5">{tr593?'İptal':'Cancel'}</button>
                        </div>
                      </div>
                    )}
                    {p593Vehicles.length===0?(
                      <div className="apple-card p-12 text-center"><Truck className="w-12 h-12 text-gray-200 mx-auto mb-3"/><p className="text-gray-400 text-sm">{tr593?'"Araç Ekle" ile filo takibini başlatın.':'Click "Add Vehicle" to start fleet tracking.'}</p></div>
                    ):(
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        {p593Vehicles.map(v=>{
                          const isDue = v.nextService&&v.nextService<=today593;
                          return (
                            <div key={v.id} className={`apple-card p-4 ${isDue?'border border-amber-200':''}`}>
                              <div className="flex items-start justify-between mb-3">
                                <div>
                                  <p className="font-bold text-gray-900 text-sm font-mono">{v.plate}</p>
                                  <p className="text-xs text-gray-500">{v.model} {v.fuel?`• ${v.fuel}`:''}</p>
                                </div>
                                <select value={v.status} onChange={async e=>{ try{ await updateDoc(doc(db,'vehicles',v.id),{status:e.target.value}); }catch(err){ console.error('[vehicle status]',err); } }} className={`text-[10px] font-bold px-2 py-0.5 rounded-full border-0 cursor-pointer ${statusColors593[v.status]}`}>
                                  {(['Müsait','Yolda','Bakımda','Arızalı'] as const).map(s=><option key={s}>{s}</option>)}
                                </select>
                              </div>
                              <div className="grid grid-cols-2 gap-2 text-xs">
                                <div><p className="text-gray-400">{tr593?'Sürücü':'Driver'}</p><p className="font-medium text-gray-700">{v.driver||'—'}</p></div>
                                <div><p className="text-gray-400">KM</p><p className="font-medium text-gray-700">{v.km?.toLocaleString()||'—'}</p></div>
                                {v.nextService&&<div className="col-span-2"><p className="text-gray-400">{tr593?'Sonraki Bakım':'Next Service'}</p><p className={`font-medium ${isDue?'text-amber-600 font-bold':'text-gray-700'}`}>{v.nextService} {isDue?'⚠️':''}</p></div>}
                              </div>
                              <div className="flex items-center gap-2 mt-3 pt-3 border-t border-gray-100">
                                <button onClick={()=>setLocationQrModal({type:'vehicle',id:v.id,name:v.plate,subtitle:v.driver||v.model})} className="flex-1 text-[11px] font-bold px-2 py-1.5 rounded-lg bg-gray-900 text-white hover:bg-gray-700 transition-colors flex items-center justify-center gap-1.5">
                                  <QrCode className="w-3.5 h-3.5" />{tr593?'QR Etiketi':'QR Label'}
                                </button>
                                {hasFullAccess('lojistik')&&(
                                  <button onClick={async()=>{ if(!await confirmDelete(v.plate,currentLanguage))return; try{ await deleteDoc(doc(db,'vehicles',v.id)); }catch(err){ console.error('[vehicle delete]',err); } }} className="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors">
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Depo QR etiketleri — transfer taramasında kaynak/hedef olarak okunur */}
                    <div className="apple-card p-5">
                      <div className="flex items-center gap-2 mb-3">
                        <Building2 className="w-4 h-4 text-brand" />
                        <h4 className="font-bold text-gray-900 text-sm">{tr593?'Depo QR Etiketleri':'Warehouse QR Labels'}</h4>
                      </div>
                      {warehouses.length===0?(
                        <p className="text-xs text-gray-400">{tr593?'Henüz depo tanımlı değil. Muhasebe → Depo bölümünden ekleyin.':'No warehouses yet. Add them under Accounting → Warehouse.'}</p>
                      ):(
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                          {warehouses.map(w=>(
                            <div key={w.id} className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-gray-50">
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-gray-800 truncate">{w.name}</p>
                                {w.location&&<p className="text-[10px] text-gray-400 truncate">{w.location}</p>}
                              </div>
                              <button onClick={()=>setLocationQrModal({type:'warehouse',id:w.id,name:w.name,subtitle:w.location})} className="text-[11px] font-bold px-2.5 py-1 rounded-lg bg-gray-900 text-white hover:bg-gray-700 transition-colors flex items-center gap-1 shrink-0">
                                <QrCode className="w-3 h-3" />QR
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </motion.div>
                );
              })()}

              {/* ── Phase 622: İhracat & Gümrük Takibi ───────────────────────── */}
              {lojistikTab === 'ihracat-gumruk' && (() => {
                const tr622 = currentLanguage === 'tr';
                const statusColor:{[k:string]:string} = {'Hazırlanıyor':'bg-gray-100 text-gray-600','Gümrükte':'bg-amber-100 text-amber-700','Yolda':'bg-blue-100 text-blue-700','Teslim Edildi':'bg-emerald-100 text-emerald-700'};
                const totalValue = p622Shipments.reduce((s,sh)=>s+(sh.value||0),0);
                const inTransit = p622Shipments.filter(sh=>sh.status==='Yolda'||sh.status==='Gümrükte').length;
                return (
                  <motion.div initial={{opacity:0,y:6}} animate={{opacity:1,y:0}} className="space-y-4">
                    <ModuleHeader title={tr622?'İhracat & Gümrük Takibi':'Export & Customs Tracking'} subtitle={tr622?'İhracat sevkiyatları ve gümrük süreçleri':'Export shipments and customs clearance tracking'} icon={Globe}
                      actionButton={hasFullAccess('lojistik')&&(<button onClick={()=>setP622ShowForm(v=>!v)} className="apple-button-primary flex items-center gap-2 text-sm"><Plus className="w-4 h-4"/>{tr622?'Sevkiyat Ekle':'Add Shipment'}</button>)} />
                    <div className="grid grid-cols-3 gap-4">
                      <div className="apple-card p-4 bg-blue-50"><p className="text-xs text-gray-500">{tr622?'Toplam Sevkiyat':'Total Shipments'}</p><p className="text-2xl font-black text-blue-600">{p622Shipments.length}</p></div>
                      <div className="apple-card p-4 bg-amber-50"><p className="text-xs text-gray-500">{tr622?'Yolda/Gümrük':'In Transit'}</p><p className="text-2xl font-black text-amber-600">{inTransit}</p></div>
                      <div className="apple-card p-4 bg-emerald-50"><p className="text-xs text-gray-500">{tr622?'Toplam Değer':'Total Value'}</p><p className="text-lg font-black text-emerald-600">${totalValue.toLocaleString('tr-TR')}</p></div>
                    </div>
                    {p622ShowForm && (
                      <div className="apple-card p-5 space-y-3">
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                          <input className="apple-input" placeholder={tr622?'Sipariş Ref':'Order Ref'} value={p622Draft.orderRef} onChange={e=>setP622Draft(d=>({...d,orderRef:e.target.value}))}/>
                          <input className="apple-input" placeholder={tr622?'Destinasyon':'Destination'} value={p622Draft.destination} onChange={e=>setP622Draft(d=>({...d,destination:e.target.value}))}/>
                          <select value={p622Draft.incoterm} onChange={e=>setP622Draft(d=>({...d,incoterm:e.target.value as typeof d.incoterm}))} className="apple-input">
                            {['EXW','FOB','CIF','DDP'].map(i=><option key={i}>{i}</option>)}
                          </select>
                          <select value={p622Draft.currency} onChange={e=>setP622Draft(d=>({...d,currency:e.target.value as typeof d.currency}))} className="apple-input">
                            {['USD','EUR','TRY'].map(c=><option key={c}>{c}</option>)}
                          </select>
                          <input type="number" className="apple-input" placeholder={tr622?'Değer':'Value'} value={p622Draft.value} onChange={e=>setP622Draft(d=>({...d,value:e.target.value}))}/>
                          <select value={p622Draft.status} onChange={e=>setP622Draft(d=>({...d,status:e.target.value as typeof d.status}))} className="apple-input">
                            {['Hazırlanıyor','Gümrükte','Yolda','Teslim Edildi'].map(s=><option key={s}>{s}</option>)}
                          </select>
                          <input type="date" className="apple-input" value={p622Draft.exportDate} onChange={e=>setP622Draft(d=>({...d,exportDate:e.target.value}))}/>
                          <input className="apple-input" placeholder={tr622?'Gümrük Ref':'Customs Ref'} value={p622Draft.customsRef} onChange={e=>setP622Draft(d=>({...d,customsRef:e.target.value}))}/>
                        </div>
                        <button onClick={async ()=>{
                          if(!p622Draft.orderRef||!p622Draft.destination) return;
                          const payload={orderRef:p622Draft.orderRef,destination:p622Draft.destination,incoterm:p622Draft.incoterm,currency:p622Draft.currency,value:Number(p622Draft.value)||0,status:p622Draft.status,exportDate:p622Draft.exportDate,customsRef:p622Draft.customsRef||''};
                          try {
                            if(p622EditId){ await updateDoc(doc(db,'exportShipments',p622EditId),payload); }
                            else { await addDoc(collection(db,'exportShipments'),{...payload,createdAt:serverTimestamp()}); }
                            setP622Draft(d=>({...d,orderRef:'',destination:'',value:'',customsRef:''}));
                            setP622ShowForm(false); setP622EditId(null);
                            toast(tr622?(p622EditId?'Sevkiyat güncellendi.':'Sevkiyat eklendi.'):(p622EditId?'Shipment updated.':'Shipment added.'),'success');
                          } catch(e){ toast((tr622?'Kaydedilemedi: ':'Save failed: ')+(e instanceof Error?e.message:String(e)),'error'); }
                        }} className="apple-button-primary text-xs px-6">{tr622?'Kaydet':'Save'}</button>
                      </div>
                    )}
                    {p622Shipments.length > 0 && (
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead><tr className="border-b border-gray-100 bg-gray-50">
                            {[tr622?'Ref':'Ref',tr622?'Destinasyon':'Destination','Incoterm',tr622?'Değer':'Value',tr622?'Durum':'Status',tr622?'Tarih':'Date'].map(h=>(
                              <th key={h} className="px-3 py-2 text-left text-[10px] font-bold text-gray-400 uppercase">{h}</th>
                            ))}
                            <th className="px-3 py-2 w-8"></th>
                          </tr></thead>
                          <tbody className="divide-y divide-gray-50">
                            {[...p622Shipments].sort((a,b)=>b.exportDate.localeCompare(a.exportDate)).map(sh=>(
                              <tr key={sh.id} className="hover:bg-gray-50/50">
                                <td className="px-3 py-2.5 font-mono text-gray-700">{sh.orderRef}</td>
                                <td className="px-3 py-2.5 font-medium text-gray-800">{sh.destination}</td>
                                <td className="px-3 py-2.5 text-gray-500">{sh.incoterm}</td>
                                <td className="px-3 py-2.5 font-bold text-gray-700">{sh.currency} {sh.value.toLocaleString('tr-TR')}</td>
                                <td className="px-3 py-2.5"><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${statusColor[sh.status]}`}>{sh.status}</span></td>
                                <td className="px-3 py-2.5 text-gray-500">{new Date(sh.exportDate).toLocaleDateString('tr-TR')}</td>
                                <td className="px-3 py-2.5 text-right"><div className="flex items-center justify-end gap-2">
                                  <button type="button" onClick={()=>{setP622Draft({orderRef:sh.orderRef,destination:sh.destination,incoterm:sh.incoterm,currency:sh.currency,value:String(sh.value),status:sh.status,exportDate:sh.exportDate,customsRef:sh.customsRef||''});setP622EditId(sh.id);setP622ShowForm(true);}} title={tr622?'Düzenle':'Edit'} className="text-gray-300 hover:text-blue-600 transition-colors"><Edit2 className="w-3.5 h-3.5"/></button>
                                  <button type="button" onClick={async ()=>{try{await deleteDoc(doc(db,'exportShipments',sh.id));}catch(e){toast((tr622?'Silinemedi: ':'Delete failed: ')+(e instanceof Error?e.message:String(e)),'error');}}} title="Sil" className="text-gray-300 hover:text-red-600 transition-colors"><Trash2 className="w-3.5 h-3.5"/></button>
                                </div></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                    {p622Shipments.length===0&&<div className="text-center py-10"><Globe className="w-10 h-10 text-gray-200 mx-auto mb-3"/><p className="text-gray-400 text-sm">{tr622?'İhracat sevkiyatı ekleyin.':'Add export shipments to track.'}</p></div>}
                  </motion.div>
                );
              })()}

              {/* Lojistik sub-tab: Sevkiyatlar (existing logistics content) */}
              {lojistikTab === 'sevkiyat' && <>
              {/* ── Phase 60: Today's Shipment Summary ── */}
              {(() => {
                const todayStr = new Date().toDateString();
                const shipped   = orders.filter(o => o.status === 'Shipped');
                const delivered = orders.filter(o => o.status === 'Delivered');
                const todayShipped = orders.filter(o => {
                  if (o.status !== 'Shipped') return false;
                  const raw = o.createdAt ?? o.syncedAt;
                  if (!raw) return false;
                  const d = typeof (raw as { toDate?: () => Date }).toDate === 'function'
                    ? (raw as { toDate: () => Date }).toDate()
                    : new Date(raw as string | number);
                  return d.toDateString() === todayStr;
                });
                const pending = orders.filter(o => o.status === 'Processing');
                const stats = [
                  { label: currentLanguage === 'tr' ? 'Kargoda' : 'In Transit',      value: shipped.length,     color: 'text-blue-700',    bg: 'bg-blue-50',    icon: Truck        },
                  { label: currentLanguage === 'tr' ? 'Bugün Gönderildi' : 'Shipped Today', value: todayShipped.length, color: 'text-purple-700', bg: 'bg-purple-50', icon: Package     },
                  { label: currentLanguage === 'tr' ? 'Hazırlanıyor' : 'Preparing',   value: pending.length,     color: 'text-amber-700',   bg: 'bg-amber-50',   icon: Clock        },
                  { label: currentLanguage === 'tr' ? 'Teslim Edildi' : 'Delivered',  value: delivered.length,   color: 'text-emerald-700', bg: 'bg-emerald-50', icon: CheckCircle2 },
                ];
                return (
                  <div className={cn("rounded-2xl border p-5", darkMode ? "bg-white/5 border-white/10" : "bg-white border-gray-100 shadow-sm")}>
                    <h3 className={cn("text-[10px] font-bold uppercase tracking-wider mb-4 flex items-center gap-2", darkMode ? "text-white/50" : "text-gray-400")}>
                      <Truck className="w-3.5 h-3.5" />
                      {currentLanguage === 'tr' ? 'Sevkiyat Özeti' : 'Shipment Summary'}
                    </h3>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      {stats.map((s, i) => {
                        const Icon = s.icon;
                        return (
                          <div key={i} className={cn("rounded-xl p-4 flex flex-col gap-2", darkMode ? "bg-white/5" : s.bg)}>
                            <Icon className={`w-5 h-5 ${s.color}`} />
                            <p className={`text-2xl font-black ${s.color}`}>{s.value}</p>
                            <p className={cn("text-[10px] font-bold", darkMode ? "text-white/50" : "text-gray-500")}>{s.label}</p>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              {/* ── Phase 108: Delivery SLA Strip ── */}
              {(() => {
                const toTs108 = (val: unknown): number => {
                  if (!val) return 0;
                  if (typeof (val as { toDate?: () => Date }).toDate === 'function') return (val as { toDate: () => Date }).toDate().getTime();
                  return new Date(val as string | number).getTime();
                };
                const SLA_DAYS = 7; // on-time = delivered within 7 days of creation
                const deliveredOrders = orders.filter(o => o.status === 'Delivered');
                if (deliveredOrders.length === 0) return null;

                let onTimeCount = 0, totalDays = 0;
                for (const o of deliveredOrders) {
                  const created = toTs108(o.createdAt ?? o.syncedAt);
                  const synced  = toTs108(o.syncedAt ?? o.createdAt);
                  const days = created && synced ? Math.abs(synced - created) / 86400000 : SLA_DAYS;
                  if (days <= SLA_DAYS) onTimeCount++;
                  totalDays += Math.max(0, days);
                }
                const slaRate   = Math.round((onTimeCount / deliveredOrders.length) * 100);
                const avgDays   = totalDays / deliveredOrders.length;
                const lateCount = deliveredOrders.length - onTimeCount;
                const slaColor  = slaRate >= 80 ? 'text-emerald-600' : slaRate >= 50 ? 'text-amber-600' : 'text-red-500';
                const barColor  = slaRate >= 80 ? 'bg-emerald-400' : slaRate >= 50 ? 'bg-amber-400' : 'bg-red-400';

                return (
                  <div className={cn("rounded-2xl border p-5", darkMode ? "bg-white/5 border-white/10" : "bg-white border-gray-100 shadow-sm")}>
                    <div className="flex items-center justify-between mb-4">
                      <h3 className={cn("text-[10px] font-bold uppercase tracking-wider flex items-center gap-2", darkMode ? "text-white/50" : "text-gray-400")}>
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        {currentLanguage === 'tr' ? 'Teslimat SLA Performansı' : 'Delivery SLA Performance'}
                      </h3>
                      <span className="text-[10px] text-gray-400">
                        {currentLanguage === 'tr' ? `≤${SLA_DAYS} gün = zamanında` : `≤${SLA_DAYS} days = on-time`}
                      </span>
                    </div>
                    {/* SLA bar */}
                    <div className="flex items-center gap-3 mb-4">
                      <div className="flex-1 bg-gray-100 rounded-full h-3 overflow-hidden">
                        <div
                          className={`h-3 rounded-full transition-all duration-700 ${barColor}`}
                          style={{ width: `${slaRate}%` }}
                        />
                      </div>
                      <span className={`text-lg font-black flex-shrink-0 ${slaColor}`}>{slaRate}%</span>
                    </div>
                    {/* Metric grid */}
                    <div className="grid grid-cols-3 gap-3">
                      {[
                        { label: currentLanguage === 'tr' ? 'Zamanında' : 'On-Time',      value: onTimeCount,             color: 'text-emerald-600', bg: 'bg-emerald-50' },
                        { label: currentLanguage === 'tr' ? 'Gecikmeli'  : 'Late',         value: lateCount,               color: 'text-red-500',     bg: 'bg-red-50'     },
                        { label: currentLanguage === 'tr' ? 'Ort. Gün'   : 'Avg Days',     value: avgDays.toFixed(1),      color: 'text-blue-600',    bg: 'bg-blue-50'    },
                      ].map((m, i) => (
                        <div key={i} className={cn("rounded-xl p-3 text-center", darkMode ? "bg-white/5" : m.bg)}>
                          <p className={`text-xl font-black ${m.color}`}>{m.value}</p>
                          <p className={cn("text-[10px] font-bold mt-0.5", darkMode ? "text-white/65" : "text-gray-400")}>{m.label}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* ── Phase 80: Cargo Company Performance ── */}
              {(() => {
                const cargoMap: Record<string, { total: number; delivered: number; inTransit: number }> = {};
                for (const o of orders) {
                  if (!o.cargoCompany) continue;
                  const k = o.cargoCompany;
                  cargoMap[k] = cargoMap[k] || { total: 0, delivered: 0, inTransit: 0 };
                  cargoMap[k].total += 1;
                  if (o.status === 'Delivered') cargoMap[k].delivered += 1;
                  if (o.status === 'Shipped')   cargoMap[k].inTransit += 1;
                }
                const cargoList = Object.entries(cargoMap)
                  .map(([name, d]) => ({ name, ...d, rate: d.total > 0 ? Math.round((d.delivered / d.total) * 100) : 0 }))
                  .sort((a, b) => b.total - a.total)
                  .slice(0, 5);
                if (cargoList.length === 0) return null;
                return (
                  <div className={cn("rounded-2xl border p-5", darkMode ? "bg-white/5 border-white/10" : "bg-white border-gray-100 shadow-sm")}>
                    <h3 className={cn("text-[10px] font-bold uppercase tracking-wider mb-4 flex items-center gap-2", darkMode ? "text-white/50" : "text-gray-400")}>
                      <Truck className="w-3.5 h-3.5" />
                      {currentLanguage === 'tr' ? 'Kargo Firması Performansı' : 'Cargo Company Performance'}
                    </h3>
                    <div className="space-y-3">
                      {cargoList.map(c => (
                        <div key={c.name} className="space-y-1">
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-xs font-semibold text-gray-700 truncate flex-1">{c.name}</span>
                            <div className="flex items-center gap-3 flex-shrink-0 text-[10px]">
                              <span className="text-blue-500 font-bold">{c.inTransit} {currentLanguage === 'tr' ? 'yolda' : 'transit'}</span>
                              <span className="text-emerald-600 font-bold">{c.delivered}/{c.total}</span>
                              <span className={`font-black w-10 text-right ${c.rate >= 80 ? 'text-emerald-600' : c.rate >= 50 ? 'text-amber-600' : 'text-red-500'}`}>{c.rate}%</span>
                            </div>
                          </div>
                          <div className="w-full bg-gray-100 rounded-full h-1.5">
                            <div
                              className={`h-1.5 rounded-full transition-all duration-700 ${c.rate >= 80 ? 'bg-emerald-400' : c.rate >= 50 ? 'bg-amber-400' : 'bg-red-400'}`}
                              style={{ width: `${c.rate}%` }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                    <p className="text-[10px] text-gray-400 mt-3">
                      {currentLanguage === 'tr' ? 'Teslimat başarı oranı (tamamlanan / toplam)' : 'Delivery success rate (completed / total)'}
                    </p>
                  </div>
                );
              })()}

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h2 className="text-xl font-bold">{currentT.logistics_tracking}</h2>
                  <p className="text-sm text-gray-500">{currentT.real_time_status}</p>
                </div>
                <div className="flex gap-2 w-full sm:w-auto">
                  <div className="apple-card px-4 py-2 flex items-center gap-2 text-sm w-full sm:w-auto">
                    <Search className="w-4 h-4 text-gray-400" />
                    <input type="text" placeholder={currentT.search_tracking} className="bg-transparent outline-none w-full sm:w-40" />
                  </div>
                </div>
              </div>

              {/* ── Route Optimizer Panel ── */}
              <div className="apple-card overflow-hidden">
                <div className="p-4 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-gradient-to-r from-brand/5 to-transparent">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 bg-brand rounded-lg flex items-center justify-center shrink-0">
                      <Route className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <h3 className="font-bold text-sm">{currentT.route_optimization}</h3>
                      <div className="flex items-center gap-2 mt-0.5">
                        <p className="text-[11px] text-gray-500">{currentT.start_point}</p>
                        <select
                          value={selectedDepot}
                          onChange={(e) => setSelectedDepot(e.target.value as 'eski_sanayi' | 'havalimani')}
                          className="text-[11px] font-bold text-brand bg-transparent border-none p-0 focus:ring-0 outline-none cursor-pointer"
                        >
                          <option value="eski_sanayi">Antalya (Eski Sanayi)</option>
                          <option value="havalimani">Antalya (Havalimanı)</option>
                        </select>
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {isRouteOptimized && (
                      <button onClick={handleClearRoute} className="apple-button-secondary">
                        {currentT.clear_route_btn}
                      </button>
                    )}
                    <button onClick={handleBuildRoute} className="apple-button-primary">
                      <Navigation className="w-4 h-4" />
                      {isRouteOptimized ? currentT.reoptimize_route_btn : currentT.optimize_route_btn}
                    </button>
                  </div>
                </div>
              </div>

              {/* ── Past Shipments ── */}
              <div className="apple-card overflow-hidden">
                <div className="p-4 border-b border-gray-100 flex items-center justify-between">
                  <h3 className="font-bold text-sm">Geçmiş Sevkiyatlar</h3>
                  <button onClick={() => { setEditingShipmentId(null); setNewShipment({ status: 'Pending' }); setIsAddingShipment(true); }} className="apple-button-primary text-xs py-1.5 px-3">
                    <Plus className="w-3.5 h-3.5" /> Sevkiyat Ekle
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="apple-table">
                    <thead>
                      <tr>
                        {[
                          { key: 'customerName', label: 'Müşteri' },
                          { key: 'destination', label: 'Varış' },
                          { key: 'driver', label: 'Sürücü' },
                          { key: 'cargoFirm', label: 'Kargo' },
                          { key: 'date', label: 'Tarih' },
                          { key: 'status', label: 'Durum' },
                          { key: 'trackingNo', label: 'Takip No' },
                        ].map(col => (
                          <th key={col.key}
                            className="cursor-pointer select-none group hover:text-brand transition-colors whitespace-nowrap"
                            onClick={() => toggleSort(shipmentSort, col.key, setShipmentSort)}>
                            {col.label}<SortIcon col={col.key} config={shipmentSort} />
                          </th>
                        ))}
                        <th className="text-right">İşlemler</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {sortData(shipments, shipmentSort.key, shipmentSort.dir).map(shipment => (
                        <tr key={shipment.id} className="hover:bg-gray-50">
                          <td className="font-bold">{shipment.customerName}</td>
                          <td>{shipment.destination}</td>
                          <td>{shipment.driver}</td>
                          <td>{shipment.cargoFirm}</td>
                          <td>{shipment.date}</td>
                          <td>
                            <span className={`px-2 py-1 rounded-full text-[10px] font-bold ${shipment.status === 'Delivered' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                              {shipment.status}
                            </span>
                          </td>
                          <td className="font-mono text-xs">{shipment.trackingNo}</td>
                          <td className="text-right">
                            <div className="flex gap-2 justify-end">
                              <button onClick={() => handleEditShipment(shipment)} className="action-btn-edit"><Edit2 className="w-4 h-4" /></button>
                              <button onClick={() => handleDeleteShipment(shipment.id)} className="action-btn-delete"><Trash2 className="w-4 h-4" /></button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="apple-card overflow-hidden">
                {isRouteOptimized && routeStops.length > 0 && (
                  <div className="p-4">
                    {/* Summary stats */}
                    <div className="grid grid-cols-3 gap-2 sm:gap-4 mb-4">
                      <div className="bg-gray-50 rounded-lg p-2 sm:p-3 text-center">
                        <p className="text-[9px] sm:text-[10px] text-gray-500 uppercase font-bold">{currentT.total_stops}</p>
                        <p className="text-lg sm:text-xl font-bold text-brand">{routeStops.length}</p>
                      </div>
                      <div className="bg-gray-50 rounded-lg p-2 sm:p-3 text-center">
                        <p className="text-[9px] sm:text-[10px] text-gray-500 uppercase font-bold">{currentT.estimated_time}</p>
                        <p className="text-lg sm:text-xl font-bold text-[#1D2226]">
                          {routeStops.length > 0 ? `${Math.round(routeStops[routeStops.length - 1].estimatedMinutes / 60)}s ${routeStops[routeStops.length - 1].estimatedMinutes % 60}d` : '--'}
                        </p>
                      </div>
                      <div className="bg-gray-50 rounded-lg p-2 sm:p-3 text-center">
                        <p className="text-[9px] sm:text-[10px] text-gray-500 uppercase font-bold">{currentT.algorithm}</p>
                        <p className="text-[10px] sm:text-sm font-bold text-gray-700">{currentT.nearest_neighbor}</p>
                      </div>
                    </div>

                    {/* Drag-and-drop stop list */}
                    <p className="text-[11px] text-gray-400 mb-3 flex items-center gap-1">
                      <GripVertical className="w-3 h-3" /> {currentT.drag_to_reorder}
                    </p>
                    <div className="space-y-2">
                      {/* Depot (start) */}
                      <div className="flex items-center gap-3 p-3 bg-brand/5 border border-brand/20 rounded-lg">
                        <div className="w-7 h-7 bg-brand rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0">D</div>
                        <div className="flex-1 min-w-0">
                          <p className="font-bold text-sm">{currentT.depot} — {DEPOTS[selectedDepot].name}</p>
                          <p className="text-[10px] text-gray-400 truncate">{currentT.starting_point} • {DEPOTS[selectedDepot].lat.toFixed(4)}°N, {DEPOTS[selectedDepot].lng.toFixed(4)}°E</p>
                        </div>
                        <span className="text-[10px] font-bold text-brand shrink-0">00:00</span>
                      </div>

                      {routeStops.map((stop, idx) => (
                        <div
                          key={stop.orderId}
                          draggable
                          onDragStart={() => handleDragStart(idx)}
                          onDragOver={(e) => handleDragOver(e, idx)}
                          onDragEnd={handleDragEnd}
                          className={cn(
                            "flex items-center gap-3 p-3 border rounded-lg cursor-grab active:cursor-grabbing transition-all",
                            dragIndex === idx ? "border-brand bg-brand/5 shadow-md scale-[1.01]" : "border-gray-100 bg-white hover:border-gray-200 hover:shadow-sm"
                          )}
                        >
                          <GripVertical className="w-4 h-4 text-gray-300 shrink-0" />
                          <div className="w-7 h-7 bg-gray-100 rounded-full flex items-center justify-center text-xs font-bold text-gray-600 shrink-0">
                            {stop.sequence}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-bold text-sm truncate">{stop.customerName}</p>
                            <p className="text-[10px] text-gray-400 truncate">{stop.address}</p>
                          </div>
                          <div className="text-right shrink-0">
                            <span className={cn("text-[9px] font-bold uppercase px-1.5 py-0.5 rounded mb-1 block",
                              stop.status === 'Pending' ? "bg-amber-50 text-amber-600" :
                                stop.status === 'Processing' ? "bg-purple-50 text-purple-600" :
                                  stop.status === 'Shipped' ? "bg-blue-50 text-blue-600" :
                                    "bg-emerald-50 text-emerald-600"
                            )}>
                              {currentT[stop.status.toLowerCase()] || stop.status}
                            </span>
                            <p className="text-[10px] font-bold text-brand">
                              +{stop.estimatedMinutes >= 60
                                ? `${Math.floor(stop.estimatedMinutes / 60)}s ${stop.estimatedMinutes % 60}d`
                                : `${stop.estimatedMinutes}d`}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {!isRouteOptimized && (
                  <div className="p-8 text-center text-gray-400">
                    <Route className="w-10 h-10 mx-auto mb-3 text-gray-200" />
                    <p className="text-sm font-medium">{currentLanguage === 'tr' ? 'Tüm aktif siparişler için en verimli teslimat sırasını hesaplamak için "Rotayı Optimize Et"e tıklayın.' : 'Click "Optimize Route" to calculate the most efficient delivery sequence for all active orders.'}</p>
                  </div>
                )}
              </div>

              {/* Map + Shipments */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 order-2 lg:order-1">
                  <React.Suspense fallback={<div className="h-[400px] md:h-[600px] w-full rounded-xl bg-gray-100 flex items-center justify-center"><div className="w-8 h-8 rounded-full border-2 border-[#ff4000] border-t-transparent animate-spin" /></div>}>
                    <LogisticsMap orders={orders} routeStops={routeStops} depot={DEPOTS[selectedDepot]} currentT={currentT} />
                  </React.Suspense>
                </div>
                <div className="apple-card flex flex-col order-1 lg:order-2">
                  <div className="p-4 border-b border-gray-100 flex items-center justify-between">
                    <h3 className="font-bold text-sm">{currentT.active_shipments}</h3>
                    <span className="bg-blue-50 text-blue-600 text-[10px] font-bold px-2 py-0.5 rounded-full">
                      {orders.filter(o => o.status === 'Shipped').length} {currentT.on_the_way}
                    </span>
                  </div>
                  <div className="flex-1 overflow-y-auto max-h-[400px] lg:max-h-[520px] p-2 space-y-2">
                    {orders.length === 0 ? (
                      <div className="p-8 text-center text-gray-400 text-sm">{currentT.no_active_orders_found}</div>
                    ) : (
                      orders.map(order => {
                        const routeStop = routeStops.find(s => s.orderId === order.id);
                        return (
                          <div key={order.id} className="p-3 rounded-lg hover:bg-gray-50 transition-colors border border-transparent hover:border-gray-100 cursor-pointer">
                            <div className="flex justify-between items-start mb-1">
                              <h4 className="font-bold text-xs">{order.customerName}</h4>
                              <span className={cn("text-[9px] font-bold uppercase px-1.5 py-0.5 rounded",
                                order.status === 'Pending' ? "bg-amber-50 text-amber-600" :
                                  order.status === 'Processing' ? "bg-purple-50 text-purple-600" :
                                    order.status === 'Shipped' ? "bg-blue-50 text-blue-600" :
                                      order.status === 'Delivered' ? "bg-emerald-50 text-emerald-600" : "bg-gray-50 text-gray-600"
                              )}>
                                {currentT[order.status.toLowerCase()] || order.status}
                              </span>
                            </div>
                            <p className="text-[10px] text-gray-500">ID: {order.shopifyOrderId}</p>
                            {routeStop && (
                              <p className="text-[10px] font-bold text-brand mt-1">{currentT.stop} #{routeStop.sequence} • ETA +{routeStop.estimatedMinutes}d</p>
                            )}
                            <div className="flex items-center gap-1 mt-2 text-[10px] text-gray-400">
                              <MapPin className="w-3 h-3 shrink-0" />
                              <span className="truncate">{order.shippingAddress}</span>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>
              </>}
        </motion.div>
      )}

      {/* ── İADE MODAL ── */}
      <AnimatePresence>
        {returnModal.open && returnModal.order && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setReturnModal({ open: false, order: null })} />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-white rounded-2xl shadow-2xl w-full max-w-md relative z-10 overflow-hidden">
              <div className="flex items-center justify-between p-5 border-b border-gray-100">
                <h3 className="font-semibold text-gray-800">{currentLanguage === 'tr' ? 'İade Oluştur' : 'Create Return'} — #{returnModal.order.id.slice(0, 6)}</h3>
                <button onClick={() => setReturnModal({ open: false, order: null })} className="p-1.5 rounded-lg hover:bg-gray-100"><X size={16} /></button>
              </div>
              <div className="p-5 space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{currentLanguage === 'tr' ? 'İade Tutarı (₺)' : 'Return Amount (₺)'}</label>
                  <input type="number" className="apple-input w-full text-sm" value={returnAmount || ''} onChange={e => setReturnAmount(Number(e.target.value))} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{currentLanguage === 'tr' ? 'İade Edilen Ürünler' : 'Returned Items'}</label>
                  <input type="text" className="apple-input w-full text-sm" placeholder={currentLanguage === 'tr' ? 'Ürün adları / adet' : 'Item names / qty'} value={returnItems} onChange={e => setReturnItems(e.target.value)} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{currentLanguage === 'tr' ? 'İade Sebebi' : 'Reason'}</label>
                  <textarea className="apple-input w-full text-sm resize-none" rows={3} value={returnReason} onChange={e => setReturnReason(e.target.value)} />
                </div>
              </div>
              <div className="flex justify-end gap-2 p-5 border-t border-gray-100">
                <button onClick={() => setReturnModal({ open: false, order: null })} className="apple-button-secondary text-sm">{currentLanguage === 'tr' ? 'İptal' : 'Cancel'}</button>
                <button
                  disabled={!returnReason.trim()}
                  onClick={async () => {
                    const o = returnModal.order!;
                    // İade tutarı 0 < x ≤ sipariş toplamı olmalı (negatif/aşırı engeli).
                    const maxRet = Number(o.totalPrice) || 0;
                    if (returnAmount <= 0 || returnAmount > maxRet + 0.01) {
                      toast(currentLanguage === 'tr' ? `İade tutarı 0 ile ${maxRet.toLocaleString('tr-TR')} arasında olmalı.` : `Return amount must be between 0 and ${maxRet}.`, 'error');
                      return;
                    }
                    try {
                      await addDoc(collection(db, 'orderReturns'), {
                        orderId: o.id, customerName: o.customerName ?? '', amount: returnAmount,
                        items: returnItems, reason: returnReason, status: 'Pending',
                        companyId: (o as unknown as { companyId?: string }).companyId ?? null,
                        createdAt: serverTimestamp(),
                      });
                      createNotification(currentLanguage === 'tr' ? 'İade Oluşturuldu' : 'Return Created', `#${o.id.slice(0, 6)} — ₺${returnAmount.toLocaleString('tr-TR')}`, 'info');
                      toast(currentLanguage === 'tr' ? 'İade kaydı oluşturuldu.' : 'Return created.', 'success');
                      setReturnModal({ open: false, order: null });
                    } catch { toast(currentLanguage === 'tr' ? 'Hata oluştu.' : 'Error.', 'error'); }
                  }}
                  className="apple-button-primary text-sm disabled:opacity-50"
                >{currentLanguage === 'tr' ? 'İade Oluştur' : 'Create Return'}</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── SEVKİYAT EKLE/DÜZENLE MODAL ── */}
      <AnimatePresence>
        {isAddingShipment && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => { setIsAddingShipment(false); setEditingShipmentId(null); }} />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-white rounded-2xl shadow-2xl w-full max-w-md relative z-10 overflow-hidden">
              <div className="flex items-center justify-between p-5 border-b border-gray-100">
                <h3 className="font-semibold text-gray-800">{editingShipmentId ? (currentLanguage === 'tr' ? 'Sevkiyat Düzenle' : 'Edit Shipment') : (currentLanguage === 'tr' ? 'Yeni Sevkiyat' : 'New Shipment')}</h3>
                <button onClick={() => { setIsAddingShipment(false); setEditingShipmentId(null); }} className="p-1.5 rounded-lg hover:bg-gray-100"><X size={16} /></button>
              </div>
              <div className="p-5 space-y-3 max-h-[70vh] overflow-y-auto">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{currentLanguage === 'tr' ? 'Müşteri' : 'Customer'}</label>
                  <CustomerCombobox
                    leads={leads}
                    value={newShipment.customerName ?? ''}
                    onChange={text => setNewShipment(s => ({ ...s, customerName: text }))}
                    onSelect={lead => setNewShipment(s => ({ ...s, customerName: lead.name }))}
                    placeholder={currentLanguage === 'tr' ? 'Müşteri adı yazın veya seçin...' : 'Type or pick a customer...'}
                    maxResults={20}
                    blurDelayMs={150}
                    showIcon={false}
                    inputClassName="apple-input w-full text-sm"
                    dropdownMaxHeightClass="max-h-56"
                  />
                </div>
                {[
                  { k: 'destination', label: currentLanguage === 'tr' ? 'Varış Noktası' : 'Destination' },
                  { k: 'driver', label: currentLanguage === 'tr' ? 'Sürücü' : 'Driver' },
                  { k: 'cargoFirm', label: currentLanguage === 'tr' ? 'Kargo Firması' : 'Cargo Firm' },
                  { k: 'trackingNo', label: currentLanguage === 'tr' ? 'Takip No' : 'Tracking No' },
                ].map(f => (
                  <div key={f.k}>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{f.label}</label>
                    <input type="text" className="apple-input w-full text-sm" value={(newShipment[f.k as keyof Shipment] as string) ?? ''} onChange={e => setNewShipment(s => ({ ...s, [f.k]: e.target.value }))} />
                  </div>
                ))}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{currentLanguage === 'tr' ? 'Tarih' : 'Date'}</label>
                    <input type="date" className="apple-input w-full text-sm" value={newShipment.date ?? ''} onChange={e => setNewShipment(s => ({ ...s, date: e.target.value }))} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{currentLanguage === 'tr' ? 'Durum' : 'Status'}</label>
                    <select className="apple-input w-full text-sm" value={newShipment.status ?? 'Pending'} onChange={e => setNewShipment(s => ({ ...s, status: e.target.value as Shipment['status'] }))}>
                      {(['Pending', 'In Transit', 'Delivered', 'Cancelled'] as const).map(st => <option key={st} value={st}>{st}</option>)}
                    </select>
                  </div>
                </div>
              </div>
              <div className="flex justify-end gap-2 p-5 border-t border-gray-100">
                <button onClick={() => { setIsAddingShipment(false); setEditingShipmentId(null); }} className="apple-button-secondary text-sm">{currentLanguage === 'tr' ? 'İptal' : 'Cancel'}</button>
                <button
                  disabled={!newShipment.customerName}
                  onClick={async () => {
                    try {
                      if (editingShipmentId) {
                        await updateDoc(doc(db, 'shipments', editingShipmentId), { ...newShipment, updatedAt: serverTimestamp() });
                        toast(currentLanguage === 'tr' ? 'Sevkiyat güncellendi.' : 'Shipment updated.', 'success');
                      } else {
                        await addDoc(collection(db, 'shipments'), { status: 'Pending', ...newShipment, createdAt: serverTimestamp() });
                        toast(currentLanguage === 'tr' ? 'Sevkiyat eklendi.' : 'Shipment added.', 'success');
                      }
                      setIsAddingShipment(false); setEditingShipmentId(null); setNewShipment({ status: 'Pending' });
                    } catch { toast(currentLanguage === 'tr' ? 'Hata oluştu.' : 'Error.', 'error'); }
                  }}
                  className="apple-button-primary text-sm disabled:opacity-50"
                >{currentLanguage === 'tr' ? 'Kaydet' : 'Save'}</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── İRSALİYE (DELIVERY NOTE) MODAL ── */}
      <AnimatePresence>
        {deliveryNoteOrder && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setDeliveryNoteOrder(null)} />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-white rounded-2xl shadow-2xl w-full max-w-md relative z-10 overflow-hidden">
              <div className="flex items-center justify-between p-5 border-b border-gray-100">
                <h3 className="font-semibold text-gray-800">{currentLanguage === 'tr' ? 'İrsaliye / Teslimat Notu' : 'Delivery Note'} — #{deliveryNoteOrder.id.slice(0, 6)}</h3>
                <button onClick={() => setDeliveryNoteOrder(null)} className="p-1.5 rounded-lg hover:bg-gray-100"><X size={16} /></button>
              </div>
              <div className="p-5 space-y-3">
                <p className="text-xs text-gray-500">{currentLanguage === 'tr' ? 'Sipariş teslim edildi olarak işaretlenecek. Teslimat notu ekleyebilirsiniz.' : 'Order will be marked Delivered. You may add a delivery note.'}</p>
                <textarea className="apple-input w-full text-sm resize-none" rows={4} placeholder={currentLanguage === 'tr' ? 'Teslim alan, tarih, not...' : 'Received by, date, note...'} value={deliveryNoteText} onChange={e => setDeliveryNoteText(e.target.value)} />
              </div>
              <div className="flex justify-end gap-2 p-5 border-t border-gray-100">
                <button onClick={() => setDeliveryNoteOrder(null)} className="apple-button-secondary text-sm">{currentLanguage === 'tr' ? 'İptal' : 'Cancel'}</button>
                <button
                  onClick={async () => {
                    const o = deliveryNoteOrder;
                    try {
                      await updateDoc(doc(db, 'orders', o.id), { status: 'Delivered', deliveryNote: deliveryNoteText, deliveredAt: serverTimestamp(), updatedAt: serverTimestamp() });
                      createNotification(currentLanguage === 'tr' ? 'Teslim Edildi' : 'Delivered', `#${o.id.slice(0, 6)}`, 'info');
                      toast(currentLanguage === 'tr' ? 'Teslimat kaydedildi.' : 'Delivery saved.', 'success');
                      setDeliveryNoteOrder(null);
                    } catch { toast(currentLanguage === 'tr' ? 'Hata oluştu.' : 'Error.', 'error'); }
                  }}
                  className="apple-button-primary text-sm"
                >{currentLanguage === 'tr' ? 'Teslim Et' : 'Mark Delivered'}</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── SİPARİŞ DÜZENLE MODAL ── */}
      <AnimatePresence>
        {isEditingOrder && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setIsEditingOrder(false)} />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-white rounded-2xl shadow-2xl w-full max-w-md relative z-10 overflow-hidden">
              <div className="flex items-center justify-between p-5 border-b border-gray-100">
                <h3 className="font-semibold text-gray-800">{currentLanguage === 'tr' ? 'Siparişi Düzenle' : 'Edit Order'}</h3>
                <button onClick={() => setIsEditingOrder(false)} className="p-1.5 rounded-lg hover:bg-gray-100"><X size={16} /></button>
              </div>
              <div className="p-5 space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{currentLanguage === 'tr' ? 'Müşteri' : 'Customer'}</label>
                  <input type="text" className="apple-input w-full text-sm" value={(editingOrderData.customerName as string) ?? ''} onChange={e => setEditingOrderData(d => ({ ...d, customerName: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{currentLanguage === 'tr' ? 'Teslimat Adresi' : 'Shipping Address'}</label>
                  <input type="text" className="apple-input w-full text-sm" value={(editingOrderData.shippingAddress as string) ?? ''} onChange={e => setEditingOrderData(d => ({ ...d, shippingAddress: e.target.value }))} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{currentLanguage === 'tr' ? 'Tutar (₺)' : 'Total (₺)'}</label>
                    <input type="number" className="apple-input w-full text-sm" value={(editingOrderData.totalPrice as number) ?? 0} onChange={e => setEditingOrderData(d => ({ ...d, totalPrice: Number(e.target.value) }))} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{currentLanguage === 'tr' ? 'Durum' : 'Status'}</label>
                    <select className="apple-input w-full text-sm" value={(editingOrderData.status as string) ?? 'Pending'} onChange={e => setEditingOrderData(d => ({ ...d, status: e.target.value as Order['status'] }))}>
                      {(['Pending', 'Processing', 'Shipped', 'Delivered', 'Cancelled'] as const).map(st => <option key={st} value={st}>{st}</option>)}
                    </select>
                  </div>
                </div>
              </div>
              <div className="flex justify-end gap-2 p-5 border-t border-gray-100">
                <button onClick={() => setIsEditingOrder(false)} className="apple-button-secondary text-sm">{currentLanguage === 'tr' ? 'İptal' : 'Cancel'}</button>
                <button
                  onClick={async () => {
                    if (!selectedOrder) return;
                    try {
                      await updateDoc(doc(db, 'orders', selectedOrder.id), { ...editingOrderData, updatedAt: serverTimestamp() });
                      setSelectedOrder({ ...selectedOrder, ...editingOrderData } as Order);
                      toast(currentLanguage === 'tr' ? 'Sipariş güncellendi.' : 'Order updated.', 'success');
                      setIsEditingOrder(false);
                    } catch { toast(currentLanguage === 'tr' ? 'Hata oluştu.' : 'Error.', 'error'); }
                  }}
                  className="apple-button-primary text-sm"
                >{currentLanguage === 'tr' ? 'Kaydet' : 'Save'}</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── HIZLI SEVKİYAT MODAL ── */}
      <AnimatePresence>
        {showQuickShipment && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowQuickShipment(null)} />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-white rounded-2xl shadow-2xl w-full max-w-sm relative z-10 overflow-hidden">
              <div className="flex items-center justify-between p-5 border-b border-gray-100">
                <h3 className="font-semibold text-gray-800">{currentLanguage === 'tr' ? 'Hızlı Sevkiyat' : 'Quick Shipment'}</h3>
                <button onClick={() => setShowQuickShipment(null)} className="p-1.5 rounded-lg hover:bg-gray-100"><X size={16} /></button>
              </div>
              <div className="p-5 space-y-2 text-sm text-gray-600">
                <p>{currentLanguage === 'tr' ? 'Bu siparişten sevkiyat oluşturulsun mu?' : 'Create a shipment from this order?'}</p>
                <p className="font-semibold text-gray-800">{showQuickShipment.customerName} — #{showQuickShipment.id.slice(0, 6)}</p>
                <p className="text-xs text-gray-400">{showQuickShipment.shippingAddress}</p>
              </div>
              <div className="flex justify-end gap-2 p-5 border-t border-gray-100">
                <button onClick={() => setShowQuickShipment(null)} className="apple-button-secondary text-sm">{currentLanguage === 'tr' ? 'İptal' : 'Cancel'}</button>
                <button
                  onClick={async () => {
                    const o = showQuickShipment;
                    try {
                      await addDoc(collection(db, 'shipments'), {
                        customerName: o.customerName ?? '', destination: o.shippingAddress ?? '',
                        driver: '', cargoFirm: '', trackingNo: '', status: 'Pending',
                        date: new Date().toISOString().slice(0, 10), orderId: o.id,
                        companyId: (o as unknown as { companyId?: string }).companyId ?? null,
                        createdAt: serverTimestamp(),
                      });
                      toast(currentLanguage === 'tr' ? 'Sevkiyat oluşturuldu.' : 'Shipment created.', 'success');
                      setShowQuickShipment(null);
                    } catch { toast(currentLanguage === 'tr' ? 'Hata oluştu.' : 'Error.', 'error'); }
                  }}
                  className="apple-button-primary text-sm"
                >{currentLanguage === 'tr' ? 'Oluştur' : 'Create'}</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {locationQrModal && (
        <LocationQRModal
          isOpen={true}
          onClose={() => setLocationQrModal(null)}
          currentLanguage={currentLanguage}
          locationType={locationQrModal.type}
          locationId={locationQrModal.id}
          locationName={locationQrModal.name}
          subtitle={locationQrModal.subtitle}
        />
      )}
    </>
  );
}
