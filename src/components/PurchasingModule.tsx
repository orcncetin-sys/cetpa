import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ShoppingCart, Plus, Search, CheckCircle, Clock, AlertCircle, Trash2, Edit2, Package, Truck, DollarSign, X, Eye, TrendingUp } from 'lucide-react';
import { collection, query, onSnapshot, addDoc, updateDoc, doc, setDoc, deleteDoc, serverTimestamp, orderBy } from 'firebase/firestore';
import { db } from '../firebase';
import { cn } from '../lib/utils';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';
import ConfirmModal from './ConfirmModal';
import ModuleHeader from './ModuleHeader';
import { logFirestoreError, OperationType } from '../utils/firebase';
import { InventoryItem, Order } from '../types';

const SortHeader: React.FC<{ label: string; sortKey: string; currentSort: { key: string; direction: 'asc' | 'desc' } | null; onSort: (key: string) => void }> = ({ label, sortKey, currentSort, onSort }) => (
  <th 
    className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-wider cursor-pointer hover:text-gray-600 group/header" 
    onClick={() => onSort(sortKey)}
  >
    <div className="flex items-center gap-2">
      {label}
      <TrendingUp className={cn(
        "w-3 h-3 transition-all opacity-0 group-hover/header:opacity-100",
        currentSort?.key === sortKey ? "opacity-100 text-brand" : "text-gray-300",
        currentSort?.key === sortKey && currentSort.direction === 'desc' ? "rotate-180" : ""
      )} />
    </div>
  </th>
);

interface PurchaseOrderItem {
  id: string;
  name: string;
  sku: string;
  quantity: number;
  purchasePrice: number;
  price?: number;
}

interface PurchaseOrder {
  id: string;
  orderNumber: string;
  supplier: string;
  status: 'Taslak' | 'Beklemede' | 'Sipariş Edildi' | 'Teslim Alındı' | 'İptal Edildi';
  items: PurchaseOrderItem[];
  totalAmount: number;
  expectedDate?: string | { toDate?: () => Date };
  createdAt: string | number | Date | { toDate?: () => Date };
  notes?: string;
}

interface PurchasingModuleProps {
  currentLanguage: 'tr' | 'en';
  isAuthenticated: boolean;
  userRole: string | null;
  inventory: InventoryItem[];
  orders: Order[];
  onNavigate?: (tab: string) => void;
  exchangeRates?: Record<string, number> | null;
}

export default function PurchasingModule({ currentLanguage, isAuthenticated, userRole, inventory, onNavigate, exchangeRates }: PurchasingModuleProps) {
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [isAddingOrder, setIsAddingOrder] = useState(false);
  const [editingOrder, setEditingOrder] = useState<PurchaseOrder | null>(null);
  const [viewingOrder, setViewingOrder] = useState<PurchaseOrder | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [kpiCurrency, setKpiCurrency] = useState<'TRY' | 'USD' | 'EUR'>('TRY');
  const [confirmModal, setConfirmModal] = useState<{ isOpen: boolean; title: string; message: string; onConfirm: () => void }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {}
  });
  
  // New Order Form State
  const [newOrder, setNewOrder] = useState({
    supplier: '',
    items: [] as PurchaseOrderItem[],
    notes: '',
    expectedDate: format(new Date(), 'yyyy-MM-dd')
  });
  const [productSearch, setProductSearch] = useState('');

  const handleAddOrderItem = (product: { id: string, name: string, sku: string, price?: number, prices?: Record<string, number> }) => {
    if (newOrder.items.find(i => i.id === product.id)) {
      handleRemoveItem(product.id);
      return;
    }
    const basePrice = product.price || product.prices?.Retail || 0;
    setNewOrder(prev => ({
      ...prev,
      items: [...prev.items, { ...product, quantity: 1, purchasePrice: basePrice * 0.7 }]
    }));
  };

  const handleRemoveItem = (id: string) => {
    setNewOrder(prev => ({
      ...prev,
      items: prev.items.filter(i => i.id !== id)
    }));
  };

  const handleUpdateItem = (id: string, field: string, value: string | number) => {
    setNewOrder(prev => ({
      ...prev,
      items: prev.items.map(i => i.id === id ? { ...i, [field]: value } : i)
    }));
  };

  const calculateTotal = (items: PurchaseOrderItem[]) => {
    return items.reduce((acc, curr) => acc + (curr.purchasePrice * curr.quantity), 0);
  };

  const handleSubmitOrder = async () => {
    if (!newOrder.supplier || newOrder.items.length === 0) {
      alert(currentLanguage === 'tr' ? 'Lütfen tedarikçi ve en az bir ürün seçin.' : 'Please select a supplier and at least one item.');
      return;
    }

    try {
      // Pre-generate doc ref so its ID drives the PO number — no random needed
      const poDocRef = doc(collection(db, 'purchaseOrders'));
      const orderNumber = `PO-${poDocRef.id.slice(0, 8).toUpperCase()}`;
      await setDoc(poDocRef, {
        orderNumber,
        supplier: newOrder.supplier,
        items: newOrder.items,
        status: 'Taslak',
        totalAmount: calculateTotal(newOrder.items),
        expectedDate: newOrder.expectedDate,
        notes: newOrder.notes,
        createdAt: serverTimestamp()
      });
      setIsAddingOrder(false);
      setNewOrder({ supplier: '', items: [], notes: '', expectedDate: format(new Date(), 'yyyy-MM-dd') });
    } catch (error) {
      console.error('Error adding purchase order:', error);
    }
  };

  const handleUpdateOrder = async () => {
    if (!editingOrder) return;
    if (!newOrder.supplier || newOrder.items.length === 0) {
      alert(currentLanguage === 'tr' ? 'Lütfen tedarikçi ve en az bir ürün seçin.' : 'Please select a supplier and at least one item.');
      return;
    }

    try {
      await updateDoc(doc(db, 'purchaseOrders', editingOrder.id), {
        supplier: newOrder.supplier,
        items: newOrder.items,
        totalAmount: calculateTotal(newOrder.items),
        expectedDate: newOrder.expectedDate,
        notes: newOrder.notes,
        updatedAt: serverTimestamp()
      });
      setEditingOrder(null);
      setNewOrder({ supplier: '', items: [], notes: '', expectedDate: format(new Date(), 'yyyy-MM-dd') });
    } catch (error) {
      console.error('Error updating purchase order:', error);
    }
  };

  const handleUpdateStatus = async (orderId: string, newStatus: string) => {
    try {
      await updateDoc(doc(db, 'purchaseOrders', orderId), {
        status: newStatus,
        updatedAt: serverTimestamp()
      });

      // If received, update inventory
      if (newStatus === 'Teslim Alındı') {
        const order = purchaseOrders.find(o => o.id === orderId);
        if (order) {
          for (const item of order.items) {
            const invItem = inventory.find(i => i.id === item.id || i.sku === item.sku);
            if (invItem) {
              await updateDoc(doc(db, 'inventory', invItem.id), {
                stockLevel: (invItem.stockLevel || 0) + Number(item.quantity)
              });
              // Log movement
              await addDoc(collection(db, 'stockMovements'), {
                productId: invItem.id,
                productName: invItem.name,
                type: 'in',
                quantity: Number(item.quantity),
                reason: `Purchase Order #${order.orderNumber}`,
                timestamp: serverTimestamp()
              });
            }
          }
        }
      }
    } catch (error) {
      console.error('Error updating status:', error);
    }
  };

  const handleDeleteOrder = async (id: string) => {
    setConfirmModal({
      isOpen: true,
      title: currentLanguage === 'tr' ? 'Siparişi Sil' : 'Delete Order',
      message: currentLanguage === 'tr' ? 'Bu siparişi silmek istediğinize emin misiniz?' : 'Are you sure you want to delete this order?',
      onConfirm: async () => {
        try {
          await deleteDoc(doc(db, 'purchaseOrders', id));
        } catch (error) {
          logFirestoreError(error, OperationType.DELETE, `purchaseOrders/${id}`);
        }
      }
    });
  };

  useEffect(() => {
    if (!isAuthenticated || !userRole) return;
    const q = query(collection(db, 'purchaseOrders'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const ordersData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as PurchaseOrder[];
      setPurchaseOrders(ordersData);
    }, (error) => {
      logFirestoreError(error, OperationType.LIST, 'purchaseOrders');
    });
    return () => unsubscribe();
  }, [isAuthenticated, userRole]);

  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);

  const handleSort = (key: string) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  const filteredOrders = purchaseOrders.filter(order => {
    const matchesSearch = order.orderNumber.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          order.supplier.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === 'All' || order.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const sortedOrders = [...filteredOrders].sort((a, b) => {
    if (!sortConfig) return 0;
    const { key, direction } = sortConfig;
    let aVal = (a as unknown as Record<string, unknown>)[key];
    let bVal = (b as unknown as Record<string, unknown>)[key];
    
    if (key === 'createdAt') {
      aVal = a.createdAt && typeof (a.createdAt as { toDate?: () => Date }).toDate === 'function' ? (a.createdAt as { toDate: () => Date }).toDate() : (a.createdAt || 0);
      bVal = b.createdAt && typeof (b.createdAt as { toDate?: () => Date }).toDate === 'function' ? (b.createdAt as { toDate: () => Date }).toDate() : (b.createdAt || 0);
    }

    if (aVal < bVal) return direction === 'asc' ? -1 : 1;
    if (aVal > bVal) return direction === 'asc' ? 1 : -1;
    return 0;
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Taslak': return 'bg-gray-100 text-gray-600';
      case 'Beklemede': return 'bg-orange-100 text-orange-600';
      case 'Sipariş Edildi': return 'bg-blue-100 text-blue-600';
      case 'Teslim Alındı': return 'bg-green-100 text-green-600';
      case 'İptal Edildi': return 'bg-red-100 text-red-600';
      default: return 'bg-gray-100 text-gray-600';
    }
  };

  const t = {
    title: currentLanguage === 'tr' ? 'Satınalma Yönetimi' : 'Purchasing Management',
    subtitle: currentLanguage === 'tr' ? 'Tedarikçi siparişlerini ve stok girişlerini yönetin.' : 'Manage supplier orders and stock entries.',
    newOrder: currentLanguage === 'tr' ? 'Yeni Satınalma Emri' : 'New Purchase Order',
    pending: currentLanguage === 'tr' ? 'Bekleyen Siparişler' : 'Pending Orders',
    inTransit: currentLanguage === 'tr' ? 'Yoldaki Ürünler' : 'In Transit',
    monthlyTotal: currentLanguage === 'tr' ? 'Bu Ay Toplam' : 'Monthly Total',
    criticalStock: currentLanguage === 'tr' ? 'Kritik Stok Uyarısı' : 'Critical Stock Alert',
    searchPlaceholder: currentLanguage === 'tr' ? 'Sipariş no veya tedarikçi ara...' : 'Search order no or supplier...',
    noOrders: currentLanguage === 'tr' ? 'Sipariş bulunamadı.' : 'No orders found.',
    orderNo: currentLanguage === 'tr' ? 'Sipariş No' : 'Order No',
    supplier: currentLanguage === 'tr' ? 'Tedarikçi' : 'Supplier',
    date: currentLanguage === 'tr' ? 'Tarih' : 'Date',
    status: currentLanguage === 'tr' ? 'Durum' : 'Status',
    total: currentLanguage === 'tr' ? 'Toplam' : 'Total',
    actions: currentLanguage === 'tr' ? 'İşlemler' : 'Actions',
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <ModuleHeader
        title={t.title}
        subtitle={t.subtitle}
        icon={ShoppingCart}
        actionButton={
          <button
            onClick={() => setIsAddingOrder(true)}
            className="apple-button-primary flex items-center gap-2 justify-center"
          >
            <Plus className="w-4 h-4" />
            {t.newOrder}
          </button>
        }
      />

      {/* Stats */}
      {(() => {
        const totalTRY = purchaseOrders.reduce((acc, curr) => acc + (curr.totalAmount || 0), 0);
        const rate = kpiCurrency === 'USD' ? (exchangeRates?.USD || 1) : kpiCurrency === 'EUR' ? (exchangeRates?.EUR || 1) : 1;
        const convertedTotal = kpiCurrency === 'TRY' ? totalTRY : totalTRY / rate;
        const sym = kpiCurrency === 'TRY' ? '₺' : kpiCurrency === 'USD' ? '$' : '€';
        return (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: t.pending, value: purchaseOrders.filter(o => o.status === 'Beklemede').length, icon: Clock, color: 'text-orange-600', bg: 'bg-orange-50', status: 'Beklemede' },
              { label: t.inTransit, value: purchaseOrders.filter(o => o.status === 'Sipariş Edildi').length, icon: Truck, color: 'text-blue-600', bg: 'bg-blue-50', status: 'Sipariş Edildi' },
              { label: t.criticalStock, value: inventory.filter(i => i.stockLevel <= i.lowStockThreshold).length, icon: AlertCircle, color: 'text-red-600', bg: 'bg-red-50', tab: 'inventory' },
            ].map((stat, i) => (
              <button
                key={i}
                onClick={() => { if (stat.tab && onNavigate) { onNavigate(stat.tab); } else if (stat.status) { setStatusFilter(stat.status); } }}
                className={cn("p-4 rounded-2xl border border-transparent text-left transition-all hover:scale-[1.02] active:scale-[0.98]", stat.bg, "cursor-pointer hover:border-brand/20 shadow-sm")}
              >
                <div className="flex items-center gap-2 mb-1">
                  <stat.icon className={cn("w-4 h-4", stat.color)} />
                  <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">{stat.label}</span>
                </div>
                <p className={cn("text-xl font-black", stat.color)}>{stat.value}</p>
              </button>
            ))}

            {/* Monthly Total — with currency toggle */}
            <div className="p-4 rounded-2xl bg-green-50 shadow-sm text-left">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <DollarSign className="w-4 h-4 text-green-600" />
                  <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">{t.monthlyTotal}</span>
                </div>
                <div className="flex items-center gap-0.5 bg-white/70 rounded-lg p-0.5">
                  {(['TRY', 'USD', 'EUR'] as const).map(c => (
                    <button key={c} onClick={() => setKpiCurrency(c)}
                      className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md transition-all ${kpiCurrency === c ? 'bg-white shadow-sm text-gray-800' : 'text-gray-400 hover:text-gray-600'}`}>
                      {c === 'TRY' ? '₺' : c === 'USD' ? '$' : '€'}
                    </button>
                  ))}
                </div>
              </div>
              <p className="text-xl font-black text-green-600">{sym}{convertedTotal.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}</p>
            </div>
          </div>
        );
      })()}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4 bg-white p-4 rounded-2xl shadow-sm border border-gray-100">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder={t.searchPlaceholder}
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="apple-input w-full pl-10"
          />
        </div>
        <div className="flex gap-2 overflow-x-auto pb-2 sm:pb-0">
          {['All', 'Taslak', 'Beklemede', 'Sipariş Edildi', 'Teslim Alındı', 'İptal Edildi'].map((status) => (
            <button
              key={status}
              onClick={() => setStatusFilter(status)}
              className={cn(
                "px-4 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap",
                statusFilter === status
                  ? "bg-gray-900 text-white"
                  : "bg-gray-100 text-gray-500 hover:bg-gray-200"
              )}
            >
              {status === 'All' ? (currentLanguage === 'tr' ? 'Tümü' : 'All') : status}
            </button>
          ))}
        </div>
      </div>

      {/* Orders List */}
      <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50/50 border-b border-gray-100">
                <SortHeader label={t.orderNo} sortKey="orderNumber" currentSort={sortConfig} onSort={handleSort} />
                <SortHeader label={t.supplier} sortKey="supplier" currentSort={sortConfig} onSort={handleSort} />
                <SortHeader label={t.date} sortKey="createdAt" currentSort={sortConfig} onSort={handleSort} />
                <SortHeader label={t.status} sortKey="status" currentSort={sortConfig} onSort={handleSort} />
                <SortHeader label={t.total} sortKey="totalAmount" currentSort={sortConfig} onSort={handleSort} />
                <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-wider text-right">{t.actions}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {sortedOrders.map((order) => (
                <tr key={order.id} className="hover:bg-gray-50/50 transition-colors group">
                  <td className="px-6 py-4">
                    <span className="text-sm font-bold text-gray-900">#{order.orderNumber}</span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-[10px] font-bold text-gray-500">
                        {(order.supplier || '??').substring(0, 2).toUpperCase()}
                      </div>
                      <span className="text-sm font-medium text-gray-700">{order.supplier}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-xs text-gray-500">
                      {typeof order.createdAt === 'object' && order.createdAt !== null && 'toDate' in order.createdAt && typeof order.createdAt.toDate === 'function' ? format(order.createdAt.toDate(), 'dd MMM yyyy', { locale: currentLanguage === 'tr' ? tr : undefined }) : '-'}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <span className={cn("px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider", getStatusColor(order.status))}>
                      {currentLanguage === 'tr' ? (
                        order.status === 'Taslak' ? 'Taslak' :
                        order.status === 'Beklemede' ? 'Bekliyor' :
                        order.status === 'Sipariş Edildi' ? 'Sipariş Edildi' :
                        order.status === 'Teslim Alındı' ? 'Teslim Alındı' :
                        order.status === 'İptal Edildi' ? 'İptal Edildi' : order.status
                      ) : order.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <span className="text-sm font-bold text-gray-900">₺{order.totalAmount?.toLocaleString()}</span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex justify-end gap-2">
                      {order.status === 'Taslak' && (
                        <button 
                          onClick={() => handleUpdateStatus(order.id, 'Beklemede')}
                          className="p-2 hover:bg-orange-50 rounded-xl text-orange-600 transition-all"
                          title={currentLanguage === 'tr' ? 'Onaya Gönder' : 'Submit for Approval'}
                        >
                          <Clock className="w-4 h-4" />
                        </button>
                      )}
                      {order.status === 'Beklemede' && (
                        <button 
                          onClick={() => handleUpdateStatus(order.id, 'Sipariş Edildi')}
                          className="p-2 hover:bg-blue-50 rounded-xl text-blue-600 transition-all"
                          title={currentLanguage === 'tr' ? 'Sipariş Geçildi' : 'Mark as Ordered'}
                        >
                          <Package className="w-4 h-4" />
                        </button>
                      )}
                      {order.status === 'Sipariş Edildi' && (
                        <button 
                          onClick={() => handleUpdateStatus(order.id, 'Teslim Alındı')}
                          className="p-2 hover:bg-green-50 rounded-xl text-green-600 transition-all"
                          title={currentLanguage === 'tr' ? 'Teslim Alındı' : 'Mark as Received'}
                        >
                          <CheckCircle className="w-4 h-4" />
                        </button>
                      )}
                      <button 
                        onClick={() => {
                          setViewingOrder(order);
                        }}
                        className="p-2 hover:bg-blue-50 rounded-xl text-blue-500 transition-all"
                        title={currentLanguage === 'tr' ? 'İncele' : 'View'}
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                      <button 
                        onClick={() => {
                          setNewOrder({
                            supplier: order.supplier,
                            items: order.items,
                            notes: order.notes || '',
                            expectedDate: typeof order.expectedDate === 'string' ? order.expectedDate : (order.expectedDate && typeof order.expectedDate === 'object' && 'toDate' in order.expectedDate && typeof order.expectedDate.toDate === 'function' ? format(order.expectedDate.toDate(), 'yyyy-MM-dd') : format(new Date(), 'yyyy-MM-dd'))
                          });
                          setEditingOrder(order);
                        }}
                        className="p-2 hover:bg-gray-100 rounded-xl text-gray-500 transition-all"
                        title={currentLanguage === 'tr' ? 'Düzenle' : 'Edit'}
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button 
                        onClick={() => handleDeleteOrder(order.id)}
                        className="p-2 hover:bg-red-50 rounded-xl text-red-500 transition-all"
                        title={currentLanguage === 'tr' ? 'Sil' : 'Delete'}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filteredOrders.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <ShoppingCart className="w-12 h-12 text-gray-100" />
                      <p className="text-sm text-gray-400">{t.noOrders}</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add/Edit/View Order Modal */}
      <AnimatePresence>
        {(isAddingOrder || editingOrder || viewingOrder) && (
          <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white rounded-[2.5rem] shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col"
            >
              {/* Modal Header */}
              <div className="px-8 py-6 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-brand rounded-xl flex items-center justify-center text-white shadow-lg shadow-brand/20">
                    <ShoppingCart className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-[#1D1D1F]">
                      {viewingOrder ? (currentLanguage === 'tr' ? 'Sipariş Detayı' : 'Order Details') : 
                       editingOrder ? (currentLanguage === 'tr' ? 'Siparişi Düzenle' : 'Edit Order') : 
                       t.newOrder}
                    </h2>
                    <p className="text-xs text-[#86868B]">
                      {viewingOrder ? (currentLanguage === 'tr' ? 'Sipariş bilgilerini görüntüleyin' : 'View order details') :
                       editingOrder ? (currentLanguage === 'tr' ? 'Sipariş bilgilerini güncelleyin' : 'Update order details') :
                       (currentLanguage === 'tr' ? 'Yeni bir satınalma talebi oluşturun' : 'Create a new purchase request')}
                    </p>
                  </div>
                </div>
                <button 
                  onClick={() => {
                    setIsAddingOrder(false);
                    setEditingOrder(null);
                    setViewingOrder(null);
                    setNewOrder({ supplier: '', items: [], notes: '', expectedDate: format(new Date(), 'yyyy-MM-dd') });
                  }}
                  className="p-2 hover:bg-gray-100 rounded-full transition-colors text-gray-400 hover:text-gray-600"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-8 space-y-8">
                {/* Supplier & Date */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-[11px] font-bold text-gray-400 uppercase tracking-wider ml-1">{t.supplier}</label>
                    <input
                      type="text"
                      placeholder={currentLanguage === 'tr' ? 'Tedarikçi adı girin...' : 'Enter supplier name...'}
                      value={viewingOrder ? viewingOrder.supplier : newOrder.supplier}
                      onChange={e => setNewOrder(prev => ({ ...prev, supplier: e.target.value }))}
                      disabled={!!viewingOrder}
                      className="apple-input w-full"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[11px] font-bold text-gray-400 uppercase tracking-wider ml-1">{currentLanguage === 'tr' ? 'Beklenen Tarih' : 'Expected Date'}</label>
                    <input
                      type="date"
                      value={viewingOrder ? (typeof viewingOrder.expectedDate === 'string' ? viewingOrder.expectedDate : (viewingOrder.expectedDate && typeof viewingOrder.expectedDate === 'object' && 'toDate' in viewingOrder.expectedDate && typeof viewingOrder.expectedDate.toDate === 'function' ? format(viewingOrder.expectedDate.toDate(), 'yyyy-MM-dd') : '')) : newOrder.expectedDate}
                      onChange={e => setNewOrder(prev => ({ ...prev, expectedDate: e.target.value }))}
                      disabled={!!viewingOrder}
                      className="apple-input w-full"
                    />
                  </div>
                </div>

                {/* Item Selection */}
                {!viewingOrder && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <label className="text-[11px] font-bold text-gray-400 uppercase tracking-wider ml-1">{currentLanguage === 'tr' ? 'Ürünler' : 'Products'}</label>
                      <span className="text-[10px] text-gray-400">{newOrder.items.length} {currentLanguage === 'tr' ? 'kalem seçildi' : 'items selected'}</span>
                    </div>

                    {/* Product Search Bar */}
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <input 
                        type="text" 
                        placeholder={currentLanguage === 'tr' ? 'Ürün ara...' : 'Search products...'}
                        value={productSearch}
                        onChange={e => setProductSearch(e.target.value)}
                        className="apple-input w-full pl-10 py-2.5 text-xs"
                      />
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-h-48 overflow-y-auto p-1 overflow-x-hidden">
                      {inventory.filter(p => !productSearch || p.name.toLowerCase().includes(productSearch.toLowerCase()) || p.sku.toLowerCase().includes(productSearch.toLowerCase())).map(product => (
                        <button
                          key={product.id}
                          onClick={() => handleAddOrderItem(product as any)}
                          className={cn(
                            "flex items-center gap-3 p-3 rounded-2xl border transition-all text-left",
                            newOrder.items.find(i => i.id === product.id)
                              ? "bg-brand/5 border-brand/20"
                              : "bg-white border-gray-100 hover:border-gray-200"
                          )}
                        >
                          <div className="w-10 h-10 rounded-lg bg-gray-50 flex items-center justify-center text-[10px] font-bold text-gray-400 overflow-hidden">
                            {product.image ? <img src={product.image} className="w-full h-full object-cover" /> : product.sku?.substring(0, 2)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-bold text-gray-900 truncate">{product.name}</p>
                            <p className="text-[10px] text-gray-500">SKU: {product.sku} • Stok: {product.stockLevel}</p>
                          </div>
                          {newOrder.items.find(i => i.id === product.id) && (
                            <CheckCircle className="w-4 h-4 text-brand" />
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Selected Items Table */}
                {newOrder.items.length > 0 && (
                  <div className="border border-gray-100 rounded-3xl overflow-hidden">
                    <table className="w-full text-left border-collapse">
                      <thead className="bg-gray-50/50">
                        <tr>
                          <th className="px-4 py-3 text-[10px] font-bold text-gray-400 uppercase tracking-wider">{currentLanguage === 'tr' ? 'Ürün' : 'Product'}</th>
                          <th className="px-4 py-3 text-[10px] font-bold text-gray-400 uppercase tracking-wider w-24">{currentLanguage === 'tr' ? 'Miktar' : 'Qty'}</th>
                          <th className="px-4 py-3 text-[10px] font-bold text-gray-400 uppercase tracking-wider w-32">{currentLanguage === 'tr' ? 'Alış Fiyatı' : 'Cost'}</th>
                          <th className="px-4 py-3 text-[10px] font-bold text-gray-400 uppercase tracking-wider text-right w-32">{t.total}</th>
                          <th className="px-4 py-3 text-[10px] font-bold text-gray-400 uppercase tracking-wider w-12"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {newOrder.items.map(item => (
                          <tr key={item.id}>
                            <td className="px-4 py-3">
                              <p className="text-sm font-medium text-gray-900">{item.name}</p>
                              <p className="text-[10px] text-gray-400">{item.sku}</p>
                            </td>
                            <td className="px-4 py-3">
                              <input
                                type="number"
                                value={item.quantity}
                                onChange={e => handleUpdateItem(item.id, 'quantity', Number(e.target.value))}
                                disabled={!!viewingOrder}
                                className="w-full bg-gray-50 border-none rounded-lg px-2 py-1 text-sm font-bold focus:ring-1 focus:ring-brand disabled:opacity-50"
                              />
                            </td>
                            <td className="px-4 py-3">
                              <div className="relative">
                                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs">₺</span>
                                <input
                                  type="number"
                                  value={item.purchasePrice}
                                  onChange={e => handleUpdateItem(item.id, 'purchasePrice', Number(e.target.value))}
                                  disabled={!!viewingOrder}
                                  className="w-full bg-gray-50 border-none rounded-lg pl-5 pr-2 py-1 text-sm font-bold focus:ring-1 focus:ring-brand disabled:opacity-50"
                                />
                              </div>
                            </td>
                            <td className="px-4 py-3 text-right">
                              <span className="text-sm font-bold text-gray-900">₺{(item.purchasePrice * item.quantity).toLocaleString()}</span>
                            </td>
                            <td className="px-4 py-3 text-right">
                              {!viewingOrder && (
                                <button onClick={() => handleRemoveItem(item.id)} className="text-gray-300 hover:text-red-500 transition-colors">
                                  <X className="w-4 h-4" />
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="bg-gray-50/30">
                        <tr>
                          <td colSpan={3} className="px-4 py-4 text-right text-xs font-bold text-gray-400 uppercase tracking-wider">
                            {currentLanguage === 'tr' ? 'Genel Toplam' : 'Grand Total'}
                          </td>
                          <td className="px-4 py-4 text-right text-lg font-black text-brand">
                            ₺{calculateTotal(newOrder.items).toLocaleString()}
                          </td>
                          <td></td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}

                {/* Notes */}
                <div className="space-y-2">
                  <label className="text-[11px] font-bold text-gray-400 uppercase tracking-wider ml-1">{currentLanguage === 'tr' ? 'Notlar' : 'Notes'}</label>
                  <textarea
                    placeholder={currentLanguage === 'tr' ? 'Sipariş notları...' : 'Order notes...'}
                    value={viewingOrder ? viewingOrder.notes : newOrder.notes}
                    onChange={e => setNewOrder(prev => ({ ...prev, notes: e.target.value }))}
                    disabled={!!viewingOrder}
                    className="apple-input w-full min-h-[100px] resize-none disabled:opacity-50"
                  />
                </div>
              </div>

              {/* Modal Footer */}
              <div className="px-8 py-6 bg-gray-50/50 border-t border-gray-100 flex items-center justify-end gap-3">
                <button
                  onClick={() => {
                    setIsAddingOrder(false);
                    setEditingOrder(null);
                    setViewingOrder(null);
                    setNewOrder({ supplier: '', items: [], notes: '', expectedDate: format(new Date(), 'yyyy-MM-dd') });
                  }}
                  className="apple-button-secondary"
                >
                  {viewingOrder ? (currentLanguage === 'tr' ? 'Kapat' : 'Close') : (currentLanguage === 'tr' ? 'İptal' : 'Cancel')}
                </button>
                {!viewingOrder && (
                  <button
                    onClick={editingOrder ? handleUpdateOrder : handleSubmitOrder}
                    className="apple-button-primary px-12"
                  >
                    {editingOrder 
                      ? (currentLanguage === 'tr' ? 'Güncelle' : 'Update')
                      : (currentLanguage === 'tr' ? 'Siparişi Oluştur' : 'Create Order')}
                  </button>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      {/* Confirm Modal */}
      <ConfirmModal
        isOpen={confirmModal.isOpen}
        onClose={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
        onConfirm={confirmModal.onConfirm}
        title={confirmModal.title}
        message={confirmModal.message}
        confirmText={currentLanguage === 'tr' ? 'Sil' : 'Delete'}
        cancelText={currentLanguage === 'tr' ? 'Vazgeç' : 'Cancel'}
      />
    </div>
  );
}
