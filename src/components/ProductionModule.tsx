import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Factory, Play, Pause, CheckCircle2, AlertTriangle, Clock,
  Plus, Search, Trash2, Edit2, Settings, BarChart3,
  TrendingUp, Package, Users, Activity, X, Eye, Wrench, Zap, Target,
  ChevronUp, ChevronDown
} from 'lucide-react';
import ModuleHeader from './ModuleHeader';
import ConfirmModal from './ConfirmModal';
import { cn } from '../lib/utils';
import { db } from '../firebase';
import {
  collection, onSnapshot, addDoc, updateDoc, deleteDoc,
  doc, serverTimestamp, query, orderBy
} from 'firebase/firestore';
import { logFirestoreError, OperationType } from '../utils/firebase';
import { format } from 'date-fns';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell
} from 'recharts';

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────
interface ProductionOrder {
  id: string;
  orderNo: string;
  productName: string;
  quantity: number;
  completedQuantity: number;
  startDate: string;
  endDate: string;
  status: 'Planlandı' | 'Devam Ediyor' | 'Duraklatıldı' | 'Tamamlandı' | 'İptal Edildi';
  priority: 'Yüksek' | 'Orta' | 'Düşük';
  machineId?: string;
  operatorName?: string;
  notes?: string;
  createdAt?: unknown;
}

interface Machine {
  id: string;
  name: string;
  status: 'Çalışıyor' | 'Boşta' | 'Bakımda' | 'Arızalı';
  efficiency: number;
  lastMaintenance: string;
  nextMaintenance?: string;
  type?: string;
}

interface ProductionModuleProps {
  currentLanguage: 'tr' | 'en';
  isAuthenticated: boolean;
}

// ─────────────────────────────────────────────
// Translations
// ─────────────────────────────────────────────
const T = {
  tr: {
    title: 'Üretim Yönetimi',
    subtitle: 'Üretim emirlerini ve makine verimliliğini takip edin.',
    newOrder: 'Yeni Üretim Emri',
    productionOrders: 'Üretim Emirleri',
    machinePark: 'Makine Parkuru',
    analytics: 'Analiz',
    searchPlaceholder: 'Emir no veya ürün ara...',
    orderNo: 'Emir No',
    product: 'Ürün',
    quantity: 'Miktar',
    progress: 'İlerleme',
    status: 'Durum',
    priority: 'Öncelik',
    operator: 'Operatör',
    startDate: 'Başlangıç Tarihi',
    endDate: 'Bitiş Tarihi',
    actions: 'İşlemler',
    edit: 'Düzenle',
    delete: 'Sil',
    save: 'Kaydet',
    cancel: 'İptal',
    close: 'Kapat',
    noOrders: 'Henüz üretim emri bulunmuyor.',
    noMachines: 'Henüz makine kaydı bulunmuyor.',
    addMachine: 'Makine Ekle',
    machineName: 'Makine Adı',
    machineType: 'Makine Tipi',
    machineStatus: 'Makine Durumu',
    lastMaintenance: 'Son Bakım Tarihi',
    nextMaintenance: 'Sonraki Bakım Tarihi',
    efficiency: 'Verimlilik (%)',
    start: 'Başlat',
    pause: 'Duraklat',
    complete: 'Tamamla',
    cancel_order: 'İptal Et',
    confirm_delete: 'Silme Onayı',
    confirm_delete_msg: 'Bu kaydı silmek istediğinizden emin misiniz? Bu işlem geri alınamaz.',
    planlandı: 'Planlandı',
    devamEdiyor: 'Devam Ediyor',
    duraklatıldı: 'Duraklatıldı',
    tamamlandı: 'Tamamlandı',
    iptalEdildi: 'İptal Edildi',
    yuksek: 'Yüksek',
    orta: 'Orta',
    dusuk: 'Düşük',
    calisiyor: 'Çalışıyor',
    bosta: 'Boşta',
    bakimda: 'Bakımda',
    arizali: 'Arızalı',
    totalOrders: 'Toplam Emir',
    completedOrders: 'Tamamlanan',
    inProgressOrders: 'Devam Eden',
    avgCompletion: 'Ort. Tamamlanma',
    machineCount: 'Toplam Makine',
    activeMachines: 'Aktif Makine',
    notes: 'Notlar',
    selectMachine: 'Makine Seçin',
    newMachine: 'Yeni Makine',
    machineEfficiency: 'Verimlilik',
    orderDetails: 'Emir Detayları',
    deleteOrder: 'Üretim Emrini Sil',
    deleteMachine: 'Makineyi Sil',
    productName: 'Ürün Adı',
    completedQty: 'Tamamlanan Miktar',
    addOrder: 'Üretim Emri Ekle',
    editOrder: 'Üretim Emrini Düzenle',
    editMachine: 'Makineyi Düzenle',
    machine: 'Makine',
    sonBakim: 'Son Bakım',
    sonrakiBakim: 'Sonraki Bakım',
    statusDistribution: 'Durum Dağılımı',
    ordersByStatus: 'Emirlere Göre Durum',
    machineStatusDist: 'Makine Durum Dağılımı',
  },
  en: {
    title: 'Production Management',
    subtitle: 'Track production orders and machine efficiency.',
    newOrder: 'New Production Order',
    productionOrders: 'Production Orders',
    machinePark: 'Machine Park',
    analytics: 'Analytics',
    searchPlaceholder: 'Search order no or product...',
    orderNo: 'Order No',
    product: 'Product',
    quantity: 'Quantity',
    progress: 'Progress',
    status: 'Status',
    priority: 'Priority',
    operator: 'Operator',
    startDate: 'Start Date',
    endDate: 'End Date',
    actions: 'Actions',
    edit: 'Edit',
    delete: 'Delete',
    save: 'Save',
    cancel: 'Cancel',
    close: 'Close',
    noOrders: 'No production orders yet.',
    noMachines: 'No machines registered yet.',
    addMachine: 'Add Machine',
    machineName: 'Machine Name',
    machineType: 'Machine Type',
    machineStatus: 'Machine Status',
    lastMaintenance: 'Last Maintenance',
    nextMaintenance: 'Next Maintenance',
    efficiency: 'Efficiency (%)',
    start: 'Start',
    pause: 'Pause',
    complete: 'Complete',
    cancel_order: 'Cancel',
    confirm_delete: 'Confirm Delete',
    confirm_delete_msg: 'Are you sure you want to delete this record? This action cannot be undone.',
    planlandı: 'Planned',
    devamEdiyor: 'In Progress',
    duraklatıldı: 'Paused',
    tamamlandı: 'Completed',
    iptalEdildi: 'Cancelled',
    yuksek: 'High',
    orta: 'Medium',
    dusuk: 'Low',
    calisiyor: 'Running',
    bosta: 'Idle',
    bakimda: 'Maintenance',
    arizali: 'Offline',
    totalOrders: 'Total Orders',
    completedOrders: 'Completed',
    inProgressOrders: 'In Progress',
    avgCompletion: 'Avg. Completion',
    machineCount: 'Total Machines',
    activeMachines: 'Active Machines',
    notes: 'Notes',
    selectMachine: 'Select Machine',
    newMachine: 'New Machine',
    machineEfficiency: 'Efficiency',
    orderDetails: 'Order Details',
    deleteOrder: 'Delete Production Order',
    deleteMachine: 'Delete Machine',
    productName: 'Product Name',
    completedQty: 'Completed Quantity',
    addOrder: 'Add Production Order',
    editOrder: 'Edit Production Order',
    editMachine: 'Edit Machine',
    machine: 'Machine',
    sonBakim: 'Last Maint.',
    sonrakiBakim: 'Next Maint.',
    statusDistribution: 'Status Distribution',
    ordersByStatus: 'Orders by Status',
    machineStatusDist: 'Machine Status Distribution',
  },
} as const;

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────
const CHART_COLORS = ['#ff4000', '#10b981', '#f59e0b', '#ef4444', '#6366f1'];

const STATUS_STYLES: Record<ProductionOrder['status'], string> = {
  'Planlandı': 'bg-gray-500/10 text-gray-500 border border-gray-500/20',
  'Devam Ediyor': 'bg-blue-500/10 text-blue-500 border border-blue-500/20',
  'Duraklatıldı': 'bg-amber-500/10 text-amber-500 border border-amber-500/20',
  'Tamamlandı': 'bg-green-500/10 text-green-500 border border-green-500/20',
  'İptal Edildi': 'bg-red-500/10 text-red-500 border border-red-500/20',
};

const PRIORITY_STYLES: Record<ProductionOrder['priority'], string> = {
  'Yüksek': 'bg-red-500/10 text-red-500 border border-red-500/20',
  'Orta': 'bg-amber-500/10 text-amber-500 border border-amber-500/20',
  'Düşük': 'bg-green-500/10 text-green-500 border border-green-500/20',
};

const MACHINE_STATUS_STYLES: Record<Machine['status'], string> = {
  'Çalışıyor': 'bg-green-500/10 text-green-500 border border-green-500/20',
  'Boşta': 'bg-gray-500/10 text-gray-500 border border-gray-500/20',
  'Bakımda': 'bg-amber-500/10 text-amber-500 border border-amber-500/20',
  'Arızalı': 'bg-red-500/10 text-red-500 border border-red-500/20',
};

// ─────────────────────────────────────────────
// Slide Panel (reusable)
// ─────────────────────────────────────────────
function SlidePanel({
  isOpen,
  onClose,
  title,
  children,
}: {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            key="panel"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 26, stiffness: 260 }}
            className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-[420px] shadow-2xl flex flex-col"
            style={{ background: 'var(--card-bg)', borderLeft: '1px solid var(--card-border)' }}
          >
            <div className="flex items-center justify-between px-6 py-5 border-b" style={{ borderColor: 'var(--card-border)' }}>
              <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{title}</h3>
              <button
                onClick={onClose}
                className="p-2 rounded-xl transition-colors"
                style={{ color: 'var(--text-secondary)' }}
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-5">{children}</div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
function generateOrderNo(): string {
  return 'ÜE-' + Date.now().toString().slice(-6);
}

function safeFormat(dateStr: string): string {
  try {
    if (!dateStr) return '—';
    return format(new Date(dateStr), 'dd.MM.yyyy');
  } catch {
    return dateStr;
  }
}

/** Robust sorting helper */
function sortData<T>(data: T[], key: string, direction: 'asc' | 'desc'): T[] {
  return [...data].sort((a: any, b: any) => {
    let av = a[key];
    let bv = b[key];

    // Handle nulls/undefined
    if (av === null || av === undefined) return direction === 'asc' ? 1 : -1;
    if (bv === null || bv === undefined) return direction === 'asc' ? -1 : 1;

    // Numeric comparison
    if (typeof av === 'number' && typeof bv === 'number') {
      return direction === 'asc' ? av - bv : bv - av;
    }

    // Date comparison (attempt)
    const ad = new Date(av);
    const bd = new Date(bv);
    if (!isNaN(ad.getTime()) && !isNaN(bd.getTime()) && typeof av === 'string' && av.includes('-')) {
      return direction === 'asc' ? ad.getTime() - bd.getTime() : bd.getTime() - ad.getTime();
    }

    // String comparison
    av = String(av).toLowerCase();
    bv = String(bv).toLowerCase();
    if (av < bv) return direction === 'asc' ? -1 : 1;
    if (av > bv) return direction === 'asc' ? 1 : -1;
    return 0;
  });
}

// ─────────────────────────────────────────────
// Default form values
// ─────────────────────────────────────────────
const DEFAULT_ORDER: Omit<ProductionOrder, 'id' | 'createdAt'> = {
  orderNo: '',
  productName: '',
  quantity: 1,
  completedQuantity: 0,
  startDate: '',
  endDate: '',
  status: 'Planlandı',
  priority: 'Orta',
  machineId: '',
  operatorName: '',
  notes: '',
};

const DEFAULT_MACHINE: Omit<Machine, 'id'> = {
  name: '',
  type: '',
  status: 'Boşta',
  efficiency: 100,
  lastMaintenance: '',
  nextMaintenance: '',
};

// ─────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────
export default function ProductionModule({ currentLanguage, isAuthenticated }: ProductionModuleProps) {
  const t = T[currentLanguage] as typeof T['tr'];

  // ── State ──────────────────────────────────
  const [activeTab, setActiveTab] = useState<'orders' | 'machines' | 'analytics'>('orders');
  const [productionOrders, setProductionOrders] = useState<ProductionOrder[]>([]);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [searchTerm, setSearchTerm] = useState('');

  // Order modal
  const [showOrderModal, setShowOrderModal] = useState(false);
  const [editingOrder, setEditingOrder] = useState<ProductionOrder | null>(null);
  const [orderForm, setOrderForm] = useState<Omit<ProductionOrder, 'id' | 'createdAt'>>(DEFAULT_ORDER);
  const [orderSaving, setOrderSaving] = useState(false);

  // Machine modal
  const [showMachineModal, setShowMachineModal] = useState(false);
  const [editingMachine, setEditingMachine] = useState<Machine | null>(null);
  const [machineForm, setMachineForm] = useState<Omit<Machine, 'id'>>(DEFAULT_MACHINE);
  const [machineSaving, setMachineSaving] = useState(false);

  // Delete confirms
  const [deleteOrderId, setDeleteOrderId] = useState<string | null>(null);
  const [deleteMachineId, setDeleteMachineId] = useState<string | null>(null);

  // ── Firestore subscriptions (staggered) ───
  useEffect(() => {
    if (!isAuthenticated) return;
    const unsubs: (() => void)[] = [];

    const t1 = setTimeout(() => {
      const unsub = onSnapshot(
        query(collection(db, 'productionOrders'), orderBy('createdAt', 'desc')),
        (snap) => {
          setProductionOrders(snap.docs.map((d) => ({ id: d.id, ...d.data() } as ProductionOrder)));
        },
        (err) => logFirestoreError(err, OperationType.LIST, 'productionOrders')
      );
      unsubs.push(unsub);
    }, 0);

    const t2 = setTimeout(() => {
      const unsub = onSnapshot(
        collection(db, 'machines'),
        (snap) => {
          setMachines(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Machine)));
        },
        (err) => logFirestoreError(err, OperationType.LIST, 'machines')
      );
      unsubs.push(unsub);
    }, 150);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      unsubs.forEach((u) => u());
    };
  }, [isAuthenticated]);

  const [prodSort, setProdSort] = useState<{key: string; dir: 'asc'|'desc'}>({key: 'orderNo', dir: 'asc'});
  const toggleProdSort = (key: string) => setProdSort(s => ({key, dir: s.key === key && s.dir === 'asc' ? 'desc' : 'asc'}));

  // ── Filtered orders ────────────────────────
  const filteredOrders = sortData(
    productionOrders.filter(o =>
      o.productName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      o.orderNo.toLowerCase().includes(searchTerm.toLowerCase())
    ),
    prodSort.key,
    prodSort.dir
  );

  // ── Order CRUD ─────────────────────────────
  const openAddOrder = useCallback(() => {
    setEditingOrder(null);
    setOrderForm({ ...DEFAULT_ORDER, orderNo: generateOrderNo() });
    setShowOrderModal(true);
  }, []);

  const openEditOrder = useCallback((order: ProductionOrder) => {
    setEditingOrder(order);
    const { id: _id, createdAt: _ca, ...rest } = order;
    setOrderForm(rest);
    setShowOrderModal(true);
  }, []);

  const closeOrderModal = useCallback(() => {
    setShowOrderModal(false);
    setEditingOrder(null);
  }, []);

  const handleOrderSave = useCallback(async () => {
    if (!orderForm.productName.trim() || !orderForm.orderNo.trim()) return;
    setOrderSaving(true);
    try {
      if (editingOrder) {
        await updateDoc(doc(db, 'productionOrders', editingOrder.id), { ...orderForm });
      } else {
        await addDoc(collection(db, 'productionOrders'), { ...orderForm, createdAt: serverTimestamp() });
      }
      closeOrderModal();
    } catch (err) {
      logFirestoreError(err as Error, editingOrder ? OperationType.UPDATE : OperationType.CREATE, 'productionOrders');
    } finally {
      setOrderSaving(false);
    }
  }, [orderForm, editingOrder, closeOrderModal]);

  const handleStatusChange = useCallback(
    async (order: ProductionOrder, newStatus: ProductionOrder['status']) => {
      const updates: Partial<ProductionOrder> = { status: newStatus };
      if (newStatus === 'Tamamlandı') updates.completedQuantity = order.quantity;
      try {
        await updateDoc(doc(db, 'productionOrders', order.id), updates);
      } catch (err) {
        logFirestoreError(err as Error, OperationType.UPDATE, 'productionOrders');
      }
    },
    []
  );

  const handleDeleteOrder = useCallback(async () => {
    if (!deleteOrderId) return;
    try {
      await deleteDoc(doc(db, 'productionOrders', deleteOrderId));
    } catch (err) {
      logFirestoreError(err as Error, OperationType.DELETE, 'productionOrders');
    } finally {
      setDeleteOrderId(null);
    }
  }, [deleteOrderId]);

  // ── Machine CRUD ───────────────────────────
  const openAddMachine = useCallback(() => {
    setEditingMachine(null);
    setMachineForm({ ...DEFAULT_MACHINE });
    setShowMachineModal(true);
  }, []);

  const openEditMachine = useCallback((machine: Machine) => {
    setEditingMachine(machine);
    const { id: _id, ...rest } = machine;
    setMachineForm(rest);
    setShowMachineModal(true);
  }, []);

  const closeMachineModal = useCallback(() => {
    setShowMachineModal(false);
    setEditingMachine(null);
  }, []);

  const handleMachineSave = useCallback(async () => {
    if (!machineForm.name.trim()) return;
    setMachineSaving(true);
    try {
      if (editingMachine) {
        await updateDoc(doc(db, 'machines', editingMachine.id), { ...machineForm });
      } else {
        await addDoc(collection(db, 'machines'), { ...machineForm });
      }
      closeMachineModal();
    } catch (err) {
      logFirestoreError(err as Error, editingMachine ? OperationType.UPDATE : OperationType.CREATE, 'machines');
    } finally {
      setMachineSaving(false);
    }
  }, [machineForm, editingMachine, closeMachineModal]);

  const handleDeleteMachine = useCallback(async () => {
    if (!deleteMachineId) return;
    try {
      await deleteDoc(doc(db, 'machines', deleteMachineId));
    } catch (err) {
      logFirestoreError(err as Error, OperationType.DELETE, 'machines');
    } finally {
      setDeleteMachineId(null);
    }
  }, [deleteMachineId]);

  // ── Analytics data ─────────────────────────
  const statusCounts = (['Planlandı', 'Devam Ediyor', 'Duraklatıldı', 'Tamamlandı', 'İptal Edildi'] as const).map(
    (s) => ({ name: t[s === 'Planlandı' ? 'planlandı' : s === 'Devam Ediyor' ? 'devamEdiyor' : s === 'Duraklatıldı' ? 'duraklatıldı' : s === 'Tamamlandı' ? 'tamamlandı' : 'iptalEdildi'], value: productionOrders.filter((o) => o.status === s).length })
  );

  const machineStatusCounts = (['Çalışıyor', 'Boşta', 'Bakımda', 'Arızalı'] as const).map(
    (s) => ({ name: t[s === 'Çalışıyor' ? 'calisiyor' : s === 'Boşta' ? 'bosta' : s === 'Bakımda' ? 'bakimda' : 'arizali'], value: machines.filter((m) => m.status === s).length })
  );

  const completedCount = productionOrders.filter((o) => o.status === 'Tamamlandı').length;
  const inProgressCount = productionOrders.filter((o) => o.status === 'Devam Ediyor').length;
  const avgCompletion =
    productionOrders.length > 0
      ? Math.round(
          productionOrders.reduce((acc, o) => acc + (o.quantity > 0 ? (o.completedQuantity / o.quantity) * 100 : 0), 0) /
            productionOrders.length
        )
      : 0;
  const activeMachineCount = machines.filter((m) => m.status === 'Çalışıyor' || m.status === 'Boşta').length;

  // ── Helper: machine name lookup ────────────
  const getMachineName = (machineId?: string) => {
    if (!machineId) return '—';
    return machines.find((m) => m.id === machineId)?.name ?? '—';
  };

  // ──────────────────────────────────────────
  // Render
  // ──────────────────────────────────────────
  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
      {/* Header */}
      <ModuleHeader
        title={t.title}
        subtitle={t.subtitle}
        icon={Factory}
        actionButton={
          activeTab === 'orders' ? (
            <button onClick={openAddOrder} className="apple-button-primary flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white">
              <Plus className="w-4 h-4" />
              {t.newOrder}
            </button>
          ) : activeTab === 'machines' ? (
            <button onClick={openAddMachine} className="apple-button-primary flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white">
              <Plus className="w-4 h-4" />
              {t.addMachine}
            </button>
          ) : undefined
        }
      />

      {/* Tab bar */}
      <div className="overflow-x-auto scrollbar-none border-b" style={{ borderColor: 'var(--card-border)' }}>
        <div className="w-max flex items-center gap-0 pb-px">
          {(
            [
              { id: 'orders', label: t.productionOrders, icon: Package },
              { id: 'machines', label: t.machinePark, icon: Settings },
              { id: 'analytics', label: t.analytics, icon: BarChart3 },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'shrink-0 flex items-center gap-2 px-5 py-3 text-sm font-bold transition-all relative whitespace-nowrap',
                activeTab === tab.id ? 'text-brand' : 'text-gray-400 hover:text-brand/60'
              )}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
              {activeTab === tab.id && (
                <motion.div
                  layoutId="activeTabProd"
                  className="absolute bottom-0 left-0 right-0 h-0.5 bg-brand rounded-full"
                />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ─── Tab: Production Orders ─── */}
      {activeTab === 'orders' && (
        <div className="apple-card overflow-hidden">
          {/* Search bar */}
          <div className="p-4 border-b" style={{ borderColor: 'var(--card-border)' }}>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder={t.searchPlaceholder}
                className="apple-input pl-10 w-full"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                style={{ background: 'var(--input-bg)' }}
              />
            </div>
          </div>

          <div className="overflow-x-auto">
            {filteredOrders.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-gray-400">
                <Factory className="w-12 h-12 mb-3 opacity-30" />
                <p className="text-sm">{t.noOrders}</p>
              </div>
            ) : (
              <table className="apple-table">
                <thead>
                  <tr>
                    {[
                      {k:'orderNo', label:t.orderNo, align:''},
                      {k:'productName', label:t.product, align:''},
                      {k:'quantity', label:t.quantity, align:'text-center'},
                    ].map(({k, label, align}) => {
                      const active = prodSort.key === k;
                      return (
                        <th key={k} onClick={() => toggleProdSort(k)} className={`cursor-pointer select-none transition-colors ${align} ${active ? 'text-brand' : 'hover:text-brand/70'}`}>
                          {label} <span className={active ? 'opacity-100' : 'opacity-20'}>{active ? (prodSort.dir === 'asc' ? '↑' : '↓') : '↕'}</span>
                        </th>
                      );
                    })}
                    <th className="text-center" style={{minWidth:140}}>{t.progress}</th>
                    {[
                      {k:'priority', label:t.priority},
                      {k:'status', label:t.status},
                      {k:'machineId', label:t.machine},
                    ].map(({k, label}) => {
                      const active = prodSort.key === k;
                      return (
                        <th key={k} onClick={() => toggleProdSort(k)} className={`cursor-pointer select-none text-center transition-colors ${active ? 'text-brand' : 'hover:text-brand/70'}`}>
                          {label} <span className={active ? 'opacity-100' : 'opacity-20'}>{active ? (prodSort.dir === 'asc' ? '↑' : '↓') : '↕'}</span>
                        </th>
                      );
                    })}
                    <th className="text-center">{t.actions}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOrders.map((order) => {
                    const pct = order.quantity > 0 ? Math.min(100, Math.round((order.completedQuantity / order.quantity) * 100)) : 0;
                    return (
                      <tr key={order.id}>
                        <td className="font-bold text-brand whitespace-nowrap">{order.orderNo}</td>
                        <td className="font-medium">{order.productName}</td>
                        <td className="text-center whitespace-nowrap">
                          {order.completedQuantity} / {order.quantity}
                        </td>
                        <td className="text-center">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 bg-gray-100 h-1.5 rounded-full overflow-hidden">
                              <div
                                className={cn(
                                  'h-full transition-all duration-500',
                                  pct >= 100 ? 'bg-green-500' : pct >= 50 ? 'bg-brand' : 'bg-amber-400'
                                )}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <span className="text-xs text-gray-500 w-8 text-right">{pct}%</span>
                          </div>
                        </td>
                        <td className="text-center">
                          <span className={cn('px-2 py-0.5 rounded-full text-[10px] font-bold uppercase', PRIORITY_STYLES[order.priority])}>
                            {t[order.priority === 'Yüksek' ? 'yuksek' : order.priority === 'Orta' ? 'orta' : 'dusuk']}
                          </span>
                        </td>
                        <td className="text-center">
                          <span className={cn('px-2 py-0.5 rounded-full text-[10px] font-bold uppercase', STATUS_STYLES[order.status])}>
                            {t[order.status === 'Planlandı' ? 'planlandı' : order.status === 'Devam Ediyor' ? 'devamEdiyor' : order.status === 'Duraklatıldı' ? 'duraklatıldı' : order.status === 'Tamamlandı' ? 'tamamlandı' : 'iptalEdildi']}
                          </span>
                        </td>
                        <td className="text-center text-xs text-gray-500 whitespace-nowrap">
                          {getMachineName(order.machineId)}
                        </td>
                        <td className="text-center">
                          <div className="flex items-center justify-center gap-1">
                            {/* Start */}
                            {(order.status === 'Planlandı' || order.status === 'Duraklatıldı') && (
                              <button
                                title={t.start}
                                onClick={() => handleStatusChange(order, 'Devam Ediyor')}
                                className="p-1.5 rounded-lg hover:bg-blue-50 text-blue-500 transition-colors"
                              >
                                <Play className="w-4 h-4" />
                              </button>
                            )}
                            {/* Pause */}
                            {order.status === 'Devam Ediyor' && (
                              <button
                                title={t.pause}
                                onClick={() => handleStatusChange(order, 'Duraklatıldı')}
                                className="p-1.5 rounded-lg hover:bg-amber-50 text-amber-500 transition-colors"
                              >
                                <Pause className="w-4 h-4" />
                              </button>
                            )}
                            {/* Complete */}
                            {(order.status === 'Devam Ediyor' || order.status === 'Duraklatıldı') && (
                              <button
                                title={t.complete}
                                onClick={() => handleStatusChange(order, 'Tamamlandı')}
                                className="p-1.5 rounded-lg hover:bg-green-50 text-green-500 transition-colors"
                              >
                                <CheckCircle2 className="w-4 h-4" />
                              </button>
                            )}
                            {/* Edit */}
                            <button
                              title={t.edit}
                              onClick={() => openEditOrder(order)}
                              className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 transition-colors"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                            {/* Delete */}
                            <button
                              title={t.delete}
                              onClick={() => setDeleteOrderId(order.id)}
                              className="p-1.5 rounded-lg hover:bg-red-50 text-red-400 transition-colors"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ─── Tab: Machine Park ─── */}
      {activeTab === 'machines' && (
        <>
          {machines.length === 0 ? (
            <div className="apple-card flex flex-col items-center justify-center py-20 text-gray-400">
              <Settings className="w-12 h-12 mb-3 opacity-30" />
              <p className="text-sm">{t.noMachines}</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {machines.map((machine) => (
                <motion.div
                  key={machine.id}
                  initial={{ opacity: 0, scale: 0.97 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="apple-card p-5 space-y-4"
                >
                  {/* Card header */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={cn(
                          'w-10 h-10 rounded-xl flex items-center justify-center shrink-0',
                          MACHINE_STATUS_STYLES[machine.status]
                        )}
                      >
                        <Wrench className="w-5 h-5" />
                      </div>
                      <div className="min-w-0">
                        <h4 className="font-bold text-[#1D1D1F] truncate">{machine.name}</h4>
                        {machine.type && <p className="text-xs text-gray-400 truncate">{machine.type}</p>}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => openEditMachine(machine)}
                        className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 transition-colors"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setDeleteMachineId(machine.id)}
                        className="p-1.5 rounded-lg hover:bg-red-50 text-red-400 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Status badge */}
                  <div className="flex items-center justify-between">
                    <span className={cn('px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase', MACHINE_STATUS_STYLES[machine.status])}>
                      {t[machine.status === 'Çalışıyor' ? 'calisiyor' : machine.status === 'Boşta' ? 'bosta' : machine.status === 'Bakımda' ? 'bakimda' : 'arizali']}
                    </span>
                    <span className="text-lg font-bold text-brand">{machine.efficiency}%</span>
                  </div>

                  {/* Efficiency bar */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-[10px] text-gray-400 font-semibold uppercase tracking-wider">
                      <span>{t.machineEfficiency}</span>
                    </div>
                    <div className="w-full bg-gray-100 h-2 rounded-full overflow-hidden">
                      <div
                        className={cn(
                          'h-full transition-all duration-700',
                          machine.efficiency > 80 ? 'bg-green-500' : machine.efficiency > 50 ? 'bg-amber-500' : 'bg-red-500'
                        )}
                        style={{ width: `${machine.efficiency}%` }}
                      />
                    </div>
                  </div>

                  {/* Maintenance dates */}
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="bg-gray-50 rounded-xl p-2.5">
                      <p className="text-gray-400 font-semibold uppercase tracking-wider text-[9px] mb-0.5">{t.sonBakim}</p>
                      <p className="font-medium text-[#1D1D1F]">{safeFormat(machine.lastMaintenance)}</p>
                    </div>
                    {machine.nextMaintenance && (
                      <div className="bg-amber-50 rounded-xl p-2.5">
                        <p className="text-amber-400 font-semibold uppercase tracking-wider text-[9px] mb-0.5">{t.sonrakiBakim}</p>
                        <p className="font-medium text-amber-700">{safeFormat(machine.nextMaintenance)}</p>
                      </div>
                    )}
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ─── Tab: Analytics ─── */}
      {activeTab === 'analytics' && (
        <div className="space-y-6">
          {/* Order stat cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: t.totalOrders, value: productionOrders.length, icon: Package, color: 'text-brand', bg: 'bg-brand/10' },
              { label: t.completedOrders, value: completedCount, icon: CheckCircle2, color: 'text-green-600', bg: 'bg-green-50' },
              { label: t.inProgressOrders, value: inProgressCount, icon: Activity, color: 'text-blue-600', bg: 'bg-blue-50' },
              { label: t.avgCompletion, value: `${avgCompletion}%`, icon: Target, color: 'text-amber-600', bg: 'bg-amber-50' },
            ].map((card) => (
              <div key={card.label} className="apple-card p-5 flex items-center gap-4">
                <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center shrink-0', card.bg)}>
                  <card.icon className={cn('w-5 h-5', card.color)} />
                </div>
                <div>
                  <p className="text-2xl font-bold text-[#1D1D1F]">{card.value}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{card.label}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Machine stat cards */}
          <div className="grid grid-cols-2 gap-4">
            {[
              { label: t.machineCount, value: machines.length, icon: Settings, color: 'text-indigo-600', bg: 'bg-indigo-50' },
              { label: t.activeMachines, value: activeMachineCount, icon: Zap, color: 'text-green-600', bg: 'bg-green-50' },
            ].map((card) => (
              <div key={card.label} className="apple-card p-5 flex items-center gap-4">
                <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center shrink-0', card.bg)}>
                  <card.icon className={cn('w-5 h-5', card.color)} />
                </div>
                <div>
                  <p className="text-2xl font-bold text-[#1D1D1F]">{card.value}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{card.label}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Bar chart: orders by status */}
            <div className="apple-card p-6">
              <h3 className="text-sm font-bold text-[#1D1D1F] mb-4">{t.ordersByStatus}</h3>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={statusCounts} barSize={28}>
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{ borderRadius: 12, border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.1)', fontSize: 12 }}
                  />
                  <Bar dataKey="value" fill="#ff4000" radius={[6, 6, 0, 0]}>
                    {statusCounts.map((_entry, index) => (
                      <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Pie chart: machine status distribution */}
            <div className="apple-card p-6">
              <h3 className="text-sm font-bold text-[#1D1D1F] mb-4">{t.machineStatusDist}</h3>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={machineStatusCounts.filter((d) => d.value > 0)}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={85}
                    paddingAngle={3}
                    dataKey="value"
                    label={(props: { name?: string; percent?: number }) =>
                      `${props.name ?? ''} ${((props.percent ?? 0) * 100).toFixed(0)}%`
                    }
                    labelLine={false}
                  >
                    {machineStatusCounts.filter((d) => d.value > 0).map((_entry, index) => (
                      <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ borderRadius: 12, border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.1)', fontSize: 12 }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {/* ─── Order Modal (Slide Panel) ─── */}
      <SlidePanel
        isOpen={showOrderModal}
        onClose={closeOrderModal}
        title={editingOrder ? t.editOrder : t.addOrder}
      >
        <div className="space-y-4">
          {/* Order No */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1.5">{t.orderNo}</label>
            <input
              type="text"
              className="apple-input w-full"
              value={orderForm.orderNo}
              onChange={(e) => setOrderForm((p) => ({ ...p, orderNo: e.target.value }))}
            />
          </div>

          {/* Product Name */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1.5">{t.productName}</label>
            <input
              type="text"
              className="apple-input w-full"
              value={orderForm.productName}
              onChange={(e) => setOrderForm((p) => ({ ...p, productName: e.target.value }))}
            />
          </div>

          {/* Quantity + Completed */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1.5">{t.quantity}</label>
              <input
                type="number"
                min={1}
                className="apple-input w-full"
                value={orderForm.quantity}
                onChange={(e) => setOrderForm((p) => ({ ...p, quantity: Number(e.target.value) }))}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1.5">{t.completedQty}</label>
              <input
                type="number"
                min={0}
                className="apple-input w-full"
                value={orderForm.completedQuantity}
                onChange={(e) => setOrderForm((p) => ({ ...p, completedQuantity: Number(e.target.value) }))}
              />
            </div>
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1.5">{t.startDate}</label>
              <input
                type="date"
                className="apple-input w-full"
                value={orderForm.startDate}
                onChange={(e) => setOrderForm((p) => ({ ...p, startDate: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1.5">{t.endDate}</label>
              <input
                type="date"
                className="apple-input w-full"
                value={orderForm.endDate}
                onChange={(e) => setOrderForm((p) => ({ ...p, endDate: e.target.value }))}
              />
            </div>
          </div>

          {/* Status + Priority */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1.5">{t.status}</label>
              <select
                className="apple-input w-full"
                value={orderForm.status}
                onChange={(e) => setOrderForm((p) => ({ ...p, status: e.target.value as ProductionOrder['status'] }))}
              >
                <option value="Planlandı">{t.planlandı}</option>
                <option value="Devam Ediyor">{t.devamEdiyor}</option>
                <option value="Duraklatıldı">{t.duraklatıldı}</option>
                <option value="Tamamlandı">{t.tamamlandı}</option>
                <option value="İptal Edildi">{t.iptalEdildi}</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1.5">{t.priority}</label>
              <select
                className="apple-input w-full"
                value={orderForm.priority}
                onChange={(e) => setOrderForm((p) => ({ ...p, priority: e.target.value as ProductionOrder['priority'] }))}
              >
                <option value="Yüksek">{t.yuksek}</option>
                <option value="Orta">{t.orta}</option>
                <option value="Düşük">{t.dusuk}</option>
              </select>
            </div>
          </div>

          {/* Operator */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1.5">{t.operator}</label>
            <input
              type="text"
              className="apple-input w-full"
              value={orderForm.operatorName ?? ''}
              onChange={(e) => setOrderForm((p) => ({ ...p, operatorName: e.target.value }))}
            />
          </div>

          {/* Machine select */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1.5">{t.machine}</label>
            <select
              className="apple-input w-full"
              value={orderForm.machineId ?? ''}
              onChange={(e) => setOrderForm((p) => ({ ...p, machineId: e.target.value }))}
            >
              <option value="">{t.selectMachine}</option>
              {machines.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1.5">{t.notes}</label>
            <textarea
              rows={3}
              className="apple-input w-full resize-none"
              value={orderForm.notes ?? ''}
              onChange={(e) => setOrderForm((p) => ({ ...p, notes: e.target.value }))}
            />
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button onClick={closeOrderModal} className="apple-button-secondary flex-1 py-2.5 text-sm font-semibold">
              {t.cancel}
            </button>
            <button
              onClick={handleOrderSave}
              disabled={orderSaving || !orderForm.productName.trim()}
              className="apple-button-primary flex-1 justify-center py-2.5 text-sm font-semibold disabled:opacity-50"
            >
              {orderSaving ? '...' : t.save}
            </button>
          </div>
        </div>
      </SlidePanel>

      {/* ─── Machine Modal (Slide Panel) ─── */}
      <SlidePanel
        isOpen={showMachineModal}
        onClose={closeMachineModal}
        title={editingMachine ? t.editMachine : t.newMachine}
      >
        <div className="space-y-4">
          {/* Name */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1.5">{t.machineName}</label>
            <input
              type="text"
              className="apple-input w-full"
              value={machineForm.name}
              onChange={(e) => setMachineForm((p) => ({ ...p, name: e.target.value }))}
            />
          </div>

          {/* Type */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1.5">{t.machineType}</label>
            <input
              type="text"
              className="apple-input w-full"
              value={machineForm.type ?? ''}
              onChange={(e) => setMachineForm((p) => ({ ...p, type: e.target.value }))}
            />
          </div>

          {/* Status */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1.5">{t.machineStatus}</label>
            <select
              className="apple-input w-full"
              value={machineForm.status}
              onChange={(e) => setMachineForm((p) => ({ ...p, status: e.target.value as Machine['status'] }))}
            >
              <option value="Çalışıyor">{t.calisiyor}</option>
              <option value="Boşta">{t.bosta}</option>
              <option value="Bakımda">{t.bakimda}</option>
              <option value="Arızalı">{t.arizali}</option>
            </select>
          </div>

          {/* Efficiency */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1.5">{t.efficiency}</label>
            <input
              type="number"
              min={0}
              max={100}
              className="apple-input w-full"
              value={machineForm.efficiency}
              onChange={(e) => setMachineForm((p) => ({ ...p, efficiency: Number(e.target.value) }))}
            />
          </div>

          {/* Maintenance dates */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1.5">{t.lastMaintenance}</label>
              <input
                type="date"
                className="apple-input w-full"
                value={machineForm.lastMaintenance}
                onChange={(e) => setMachineForm((p) => ({ ...p, lastMaintenance: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1.5">{t.nextMaintenance}</label>
              <input
                type="date"
                className="apple-input w-full"
                value={machineForm.nextMaintenance ?? ''}
                onChange={(e) => setMachineForm((p) => ({ ...p, nextMaintenance: e.target.value }))}
              />
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button onClick={closeMachineModal} className="apple-button-secondary flex-1 py-2.5 text-sm font-semibold">
              {t.cancel}
            </button>
            <button
              onClick={handleMachineSave}
              disabled={machineSaving || !machineForm.name.trim()}
              className="apple-button-primary flex-1 justify-center py-2.5 text-sm font-semibold disabled:opacity-50"
            >
              {machineSaving ? '...' : t.save}
            </button>
          </div>
        </div>
      </SlidePanel>

      {/* ─── Delete Confirms ─── */}
      <ConfirmModal
        isOpen={deleteOrderId !== null}
        title={t.deleteOrder}
        message={t.confirm_delete_msg}
        onConfirm={handleDeleteOrder}
        onCancel={() => setDeleteOrderId(null)}
        variant="danger"
        confirmText={t.delete}
      />

      <ConfirmModal
        isOpen={deleteMachineId !== null}
        title={t.deleteMachine}
        message={t.confirm_delete_msg}
        onConfirm={handleDeleteMachine}
        onCancel={() => setDeleteMachineId(null)}
        variant="danger"
        confirmText={t.delete}
      />
    </motion.div>
  );
}
