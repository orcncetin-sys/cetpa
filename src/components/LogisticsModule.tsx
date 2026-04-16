import React, { useState, useEffect } from 'react';
import { Package, Home, ArrowRightLeft, FileUp, FileDown, Truck, Plus, Search, MapPin, X, TrendingUp } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { collection, onSnapshot, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { logFirestoreError, OperationType } from '../utils/firebase';

import { Warehouse, Transfer, Waybill, InventoryItem } from '../types';

const SortHeader: React.FC<{ label: string; sortKey: string; currentSort: { key: string; direction: 'asc' | 'desc' } | null; onSort: (key: string) => void }> = ({ label, sortKey, currentSort, onSort }) => (
  <th 
    className="py-3 px-4 text-xs font-bold text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-50 transition-colors group/header"
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

interface LogisticsModuleProps {
  currentLanguage: 'tr' | 'en';
  isAuthenticated: boolean;
  inventory: InventoryItem[];
  warehouses?: Warehouse[];
}

export default function LogisticsModule({ currentLanguage, isAuthenticated, inventory, warehouses: warehousesProp }: LogisticsModuleProps) {
  const [activeTab, setActiveTab] = useState('urunler');
  const [searchTerm, setSearchTerm] = useState('');
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [showAddWarehouseModal, setShowAddWarehouseModal] = useState(false);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [waybills, setWaybills] = useState<Waybill[]>([]);

  useEffect(() => {
    if (warehousesProp) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setWarehouses(warehousesProp);
    }
  }, [warehousesProp]);

  // Sorting States
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);

  const handleSort = (key: string) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  const getSortedData = <T extends Record<string, any>>(data: T[]) => {
    if (!sortConfig) return data;
    return [...data].sort((a, b) => {
      const aVal = a[sortConfig.key] as string | number;
      const bVal = b[sortConfig.key] as string | number;
      if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
  };
  const [warehouseForm, setWarehouseForm] = useState({ name: '', location: '', manager: '', notes: '' });
  const [transferForm, setTransferForm] = useState({
    productId: '', sourceDepotId: '', targetDepotId: '', quantity: 0
  });
  const [showWaybillModal, setShowWaybillModal] = useState(false);
  const [waybillForm, setWaybillForm] = useState({
    type: 'outgoing', orderId: '', driverName: '', plateNumber: '', notes: ''
  });

  useEffect(() => {
    if (!isAuthenticated) return;
    const unsubTransfers = onSnapshot(collection(db, 'transfers'), snap => {
      setTransfers(snap.docs.map(d => ({ id: d.id, ...d.data() } as Transfer)));
    }, (error) => logFirestoreError(error, OperationType.LIST, 'transfers'));
    const unsubWaybills = onSnapshot(collection(db, 'waybills'), snap => {
      setWaybills(snap.docs.map(d => ({ id: d.id, ...d.data() } as Waybill)));
    }, (error) => logFirestoreError(error, OperationType.LIST, 'waybills'));
    return () => {
      unsubTransfers();
      unsubWaybills();
    };
  }, [isAuthenticated]);

  const handleAddWarehouse = async () => {
    if (!isAuthenticated) return;
    try {
      await addDoc(collection(db, 'warehouses'), { ...warehouseForm, createdAt: serverTimestamp() });
      setShowAddWarehouseModal(false);
      setWarehouseForm({ name: '', location: '', manager: '', notes: '' });
    } catch (error) {
      console.error('Error adding warehouse:', error);
    }
  };

  const handleTransfer = async () => {
    if (!isAuthenticated || !transferForm.productId || !transferForm.sourceDepotId || !transferForm.targetDepotId || transferForm.quantity <= 0) return;
    try {
      // In a real app, we'd use runTransaction to safely deduct from source and add to target.
      // Since inventory items don't have warehouse-specific stock levels in the current schema (just a global stockLevel),
      // we'll just record the transfer. If we wanted to update global stock, we'd do it here.
      // For now, we'll just save the transfer record.
      await addDoc(collection(db, 'transfers'), {
        ...transferForm,
        createdAt: serverTimestamp(),
        status: 'Completed'
      });
      setShowTransferModal(false);
      setTransferForm({ productId: '', sourceDepotId: '', targetDepotId: '', quantity: 0 });
    } catch (error) {
      console.error('Error adding transfer:', error);
    }
  };

  const handleWaybill = async () => {
    if (!isAuthenticated || !waybillForm.orderId || !waybillForm.driverName || !waybillForm.plateNumber) return;
    try {
      await addDoc(collection(db, 'waybills'), {
        ...waybillForm,
        createdAt: serverTimestamp(),
        status: 'In Transit'
      });
      setShowWaybillModal(false);
      setWaybillForm({ type: 'outgoing', orderId: '', driverName: '', plateNumber: '', notes: '' });
    } catch (error) {
      console.error('Error adding waybill:', error);
    }
  };

  const t = {
    title: currentLanguage === 'tr' ? 'Lojistik ve Depo Yönetimi' : 'Logistics & Warehouse Management',
    subtitle: currentLanguage === 'tr' ? 'Stok hareketlerini, depo transferlerini ve sevkiyatları yönetin.' : 'Manage stock movements, warehouse transfers, and shipments.',
    urunler: currentLanguage === 'tr' ? 'Stok' : 'Stock',
    depolar: currentLanguage === 'tr' ? 'Depolar' : 'Warehouses',
    transfer: currentLanguage === 'tr' ? 'Transfer' : 'Transfer',
    gidenIrsaliye: currentLanguage === 'tr' ? 'Giden İrsaliye' : 'Outgoing Waybill',
    gelenIrsaliye: currentLanguage === 'tr' ? 'Gelen İrsaliye' : 'Incoming Waybill',
    newTransfer: currentLanguage === 'tr' ? 'Yeni Transfer' : 'New Transfer',
    newDepo: currentLanguage === 'tr' ? 'Yeni Depo' : 'New Warehouse',
    newWaybill: currentLanguage === 'tr' ? 'Yeni İrsaliye' : 'New Waybill',
    save: currentLanguage === 'tr' ? 'Kaydet' : 'Save',
    cancel: currentLanguage === 'tr' ? 'İptal' : 'Cancel',
  };

  const tabs = [
    { key: 'urunler', label: t.urunler, icon: Package },
    { key: 'depolar', label: t.depolar, icon: Home },
    { key: 'transfer', label: t.transfer, icon: ArrowRightLeft },
    { key: 'giden_irsaliye', label: t.gidenIrsaliye, icon: FileUp },
    { key: 'gelen_irsaliye', label: t.gelenIrsaliye, icon: FileDown },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-gray-900 flex items-center gap-3">
            <div className="p-2 bg-brand/10 rounded-xl text-brand">
              <Truck className="w-6 h-6" />
            </div>
            {t.title}
          </h1>
          <p className="text-sm text-gray-500 mt-1">{t.subtitle}</p>
        </div>
        <div className="flex gap-2">
          {activeTab === 'depolar' && (
            <button onClick={() => setShowAddWarehouseModal(true)} className="apple-button-primary flex items-center gap-2">
              <Plus className="w-4 h-4" /> {t.newDepo}
            </button>
          )}
          {activeTab === 'transfer' && (
            <button onClick={() => setShowTransferModal(true)} className="apple-button-primary flex items-center gap-2">
              <Plus className="w-4 h-4" /> {t.newTransfer}
            </button>
          )}
          {(activeTab === 'giden_irsaliye' || activeTab === 'gelen_irsaliye') && (
            <button onClick={() => { setWaybillForm(prev => ({ ...prev, type: activeTab === 'giden_irsaliye' ? 'outgoing' : 'incoming' })); setShowWaybillModal(true); }} className="apple-button-primary flex items-center gap-2">
              <Plus className="w-4 h-4" /> {t.newWaybill}
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="overflow-x-auto scrollbar-none -mx-3 px-3 sm:-mx-4 sm:px-4">
      <div className="flex gap-1 p-1 bg-white/80 border border-gray-100 rounded-2xl shadow-sm w-max">
        {tabs.map(tab => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                "shrink-0 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap",
                activeTab === tab.key
                  ? "bg-brand text-white shadow-lg shadow-brand/20"
                  : "text-gray-500 hover:text-gray-900 hover:bg-gray-50"
              )}
            >
              <Icon size={14} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>
      </div>

      {/* Content Area */}
      <div className="apple-card p-6 min-h-[400px]">
        <div className="flex items-center justify-between mb-6">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder={currentLanguage === 'tr' ? 'Ara...' : 'Search...'}
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="apple-input w-full pl-10"
            />
          </div>
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
          >
            {activeTab === 'urunler' && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {inventory.filter(i => i.name.toLowerCase().includes(searchTerm.toLowerCase())).map(item => (
                    <button key={item.id} className="apple-card p-4 hover:border-brand/20 transition-all group text-left bg-white cursor-pointer">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-xl bg-gray-50 flex items-center justify-center text-gray-400">
                          {item.image ? <img src={item.image} className="w-full h-full object-cover rounded-xl" /> : <Package className="w-6 h-6" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <h4 className="font-bold text-gray-900 truncate">{item.name}</h4>
                          <p className="text-xs text-gray-500">SKU: {item.sku}</p>
                          <p className="text-xs text-brand font-bold mt-1">
                            {warehouses.find(w => w.id === item.warehouseId)?.name || (currentLanguage === 'tr' ? 'Depo atanmadı' : 'No warehouse assigned')}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-black text-brand">{item.stockLevel}</p>
                          <p className="text-[10px] text-gray-400 uppercase font-bold">{currentLanguage === 'tr' ? 'STOK' : 'STOCK'}</p>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {activeTab === 'depolar' && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {warehouses.map(w => (
                  <button key={w.id} className="apple-card p-4 text-left hover:bg-gray-100 transition-colors cursor-pointer group">
                    <h4 className="font-bold text-gray-900 group-hover:text-brand transition-colors">{w.name}</h4>
                    <p className="text-xs text-gray-500">{w.location}</p>
                    <p className="text-xs text-gray-500 mt-1">{w.manager}</p>
                  </button>
                ))}
              </div>
            )}

            {activeTab === 'transfer' && (
              <div className="space-y-4">
                <div className="flex justify-end">
                  <button onClick={() => setShowTransferModal(true)} className="apple-button-primary flex items-center gap-2">
                    <Plus className="w-4 h-4" /> {t.newTransfer}
                  </button>
                </div>
                {transfers.length === 0 ? (
                  <div className="text-center py-12">
                    <ArrowRightLeft className="w-12 h-12 text-gray-200 mx-auto mb-4" />
                    <p className="text-gray-500">{currentLanguage === 'tr' ? 'Henüz transfer kaydı yok.' : 'No transfer records yet.'}</p>
                  </div>
                ) : (
                  <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
                    <table className="w-full text-left border-collapse text-sm">
                      <thead>
                        <tr className="bg-gray-50/50 border-b border-gray-100">
                          <SortHeader label={currentLanguage === 'tr' ? 'Ürün' : 'Product'} sortKey="productId" currentSort={sortConfig} onSort={handleSort} />
                          <SortHeader label={currentLanguage === 'tr' ? 'Kaynak' : 'Source'} sortKey="sourceDepotId" currentSort={sortConfig} onSort={handleSort} />
                          <SortHeader label={currentLanguage === 'tr' ? 'Hedef' : 'Target'} sortKey="targetDepotId" currentSort={sortConfig} onSort={handleSort} />
                          <SortHeader label={currentLanguage === 'tr' ? 'Miktar' : 'Quantity'} sortKey="quantity" currentSort={sortConfig} onSort={handleSort} />
                          <SortHeader label={currentLanguage === 'tr' ? 'Durum' : 'Status'} sortKey="status" currentSort={sortConfig} onSort={handleSort} />
                        </tr>
                      </thead>
                      <tbody>
                        {getSortedData(transfers).map(tr => {
                          const product = inventory.find(i => i.name === tr.productName);
                          const source = warehouses.find(w => w.name === tr.fromWarehouse);
                          const target = warehouses.find(w => w.name === tr.toWarehouse);
                          return (
                            <tr key={tr.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                              <td className="py-3 px-4 font-medium text-gray-900">{product?.name || tr.productName}</td>
                              <td className="py-3 px-4 text-gray-600">{source?.name || tr.fromWarehouse}</td>
                              <td className="py-3 px-4 text-gray-600">{target?.name || tr.toWarehouse}</td>
                              <td className="py-3 px-4 font-bold text-gray-900">{tr.quantity}</td>
                              <td className="py-3 px-4">
                                <span className="px-2 py-1 bg-green-100 text-green-700 text-xs font-bold rounded-lg">{tr.status}</span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {(activeTab === 'giden_irsaliye' || activeTab === 'gelen_irsaliye') && (
              <div className="space-y-4">
                {waybills.filter(w => w.type === (activeTab === 'giden_irsaliye' ? 'giden' : 'gelen')).length === 0 ? (
                  <div className="text-center py-12">
                    <MapPin className="w-12 h-12 text-gray-200 mx-auto mb-4" />
                    <p className="text-gray-500">{currentLanguage === 'tr' ? 'Henüz irsaliye kaydı yok.' : 'No waybill records yet.'}</p>
                  </div>
                ) : (
                  <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
                    <table className="w-full text-left border-collapse text-sm">
                      <thead>
                        <tr className="bg-gray-50/50 border-b border-gray-100">
                          <SortHeader label={currentLanguage === 'tr' ? 'İrsaliye No' : 'Waybill No'} sortKey="waybillNo" currentSort={sortConfig} onSort={handleSort} />
                          <SortHeader label={currentLanguage === 'tr' ? 'Taraf' : 'Party'} sortKey="party" currentSort={sortConfig} onSort={handleSort} />
                          <SortHeader label={currentLanguage === 'tr' ? 'Tarih' : 'Date'} sortKey="date" currentSort={sortConfig} onSort={handleSort} />
                          <SortHeader label={currentLanguage === 'tr' ? 'Durum' : 'Status'} sortKey="status" currentSort={sortConfig} onSort={handleSort} />
                        </tr>
                      </thead>
                      <tbody>
                        {getSortedData(waybills.filter(w => w.type === (activeTab === 'giden_irsaliye' ? 'giden' : 'gelen'))).map(w => (
                          <tr key={w.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                            <td className="py-3 px-4 font-medium text-gray-900">{w.waybillNo}</td>
                            <td className="py-3 px-4 text-gray-600">{w.party}</td>
                            <td className="py-3 px-4 text-gray-600">{w.date}</td>
                            <td className="py-3 px-4">
                              <span className="px-2 py-1 bg-blue-100 text-blue-700 text-xs font-bold rounded-lg">{w.status}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {showWaybillModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowWaybillModal(false)} />
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-white rounded-3xl shadow-2xl w-full max-w-md relative z-10 overflow-hidden">
            <div className="p-6 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-bold text-gray-800">{t.newWaybill}</h3>
              <button onClick={() => setShowWaybillModal(false)} className="p-2 hover:bg-gray-100 rounded-xl transition-all"><X size={18} /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5">{currentLanguage === 'tr' ? 'Sipariş ID' : 'Order ID'}</label>
                <input type="text" value={waybillForm.orderId} onChange={e => setWaybillForm({...waybillForm, orderId: e.target.value})} className="w-full px-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl outline-none focus:ring-2 focus:ring-[#ff4000]/20 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5">{currentLanguage === 'tr' ? 'Sürücü Adı' : 'Driver Name'}</label>
                <input type="text" value={waybillForm.driverName} onChange={e => setWaybillForm({...waybillForm, driverName: e.target.value})} className="w-full px-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl outline-none focus:ring-2 focus:ring-[#ff4000]/20 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5">{currentLanguage === 'tr' ? 'Araç Plakası' : 'Plate Number'}</label>
                <input type="text" value={waybillForm.plateNumber} onChange={e => setWaybillForm({...waybillForm, plateNumber: e.target.value})} className="w-full px-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl outline-none focus:ring-2 focus:ring-[#ff4000]/20 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5">{currentLanguage === 'tr' ? 'Notlar' : 'Notes'}</label>
                <textarea value={waybillForm.notes} onChange={e => setWaybillForm({...waybillForm, notes: e.target.value})} className="w-full px-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl outline-none focus:ring-2 focus:ring-[#ff4000]/20 text-sm" rows={3} />
              </div>
            </div>
            <div className="p-6 border-t border-gray-100 flex gap-3">
              <button onClick={() => setShowWaybillModal(false)} className="flex-1 py-3 rounded-2xl font-bold text-gray-500 hover:bg-gray-50 transition-all">{t.cancel}</button>
              <button onClick={handleWaybill} className="apple-button-primary flex-1 justify-center py-3 rounded-2xl">{t.save}</button>
            </div>
          </motion.div>
        </div>
      )}
      {showTransferModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowTransferModal(false)} />
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-white rounded-3xl shadow-2xl w-full max-w-md relative z-10 overflow-hidden">
            <div className="p-6 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-bold text-gray-800">{t.newTransfer}</h3>
              <button onClick={() => setShowTransferModal(false)} className="p-2 hover:bg-gray-100 rounded-xl transition-all"><X size={18} /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5">{t.urunler}</label>
                <select value={transferForm.productId} onChange={e => setTransferForm({...transferForm, productId: e.target.value})} className="w-full px-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl outline-none focus:ring-2 focus:ring-[#ff4000]/20 text-sm">
                  <option value="">{currentLanguage === 'tr' ? 'Ürün Seçin' : 'Select Product'}</option>
                  {inventory.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5">{currentLanguage === 'tr' ? 'Kaynak Depo' : 'Source Depot'}</label>
                  <select value={transferForm.sourceDepotId} onChange={e => setTransferForm({...transferForm, sourceDepotId: e.target.value})} className="w-full px-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl outline-none focus:ring-2 focus:ring-[#ff4000]/20 text-sm">
                    <option value="">{currentLanguage === 'tr' ? 'Seçin' : 'Select'}</option>
                    {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5">{currentLanguage === 'tr' ? 'Hedef Depo' : 'Target Depot'}</label>
                  <select value={transferForm.targetDepotId} onChange={e => setTransferForm({...transferForm, targetDepotId: e.target.value})} className="w-full px-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl outline-none focus:ring-2 focus:ring-[#ff4000]/20 text-sm">
                    <option value="">{currentLanguage === 'tr' ? 'Seçin' : 'Select'}</option>
                    {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5">{currentLanguage === 'tr' ? 'Miktar' : 'Quantity'}</label>
                <input type="number" value={transferForm.quantity} onChange={e => setTransferForm({...transferForm, quantity: Number(e.target.value)})} className="w-full px-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl outline-none focus:ring-2 focus:ring-[#ff4000]/20 text-sm" />
              </div>
            </div>
            <div className="p-6 border-t border-gray-100 flex gap-3">
              <button onClick={() => setShowTransferModal(false)} className="flex-1 py-3 rounded-2xl font-bold text-gray-500 hover:bg-gray-50 transition-all">{t.cancel}</button>
              <button onClick={handleTransfer} className="apple-button-primary flex-1 justify-center py-3 rounded-2xl">{t.save}</button>
            </div>
          </motion.div>
        </div>
      )}
      {showAddWarehouseModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowAddWarehouseModal(false)} />
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-white rounded-3xl shadow-2xl w-full max-w-md relative z-10 overflow-hidden">
            <div className="p-6 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-bold text-gray-800">{t.newDepo}</h3>
              <button onClick={() => setShowAddWarehouseModal(false)} className="p-2 hover:bg-gray-100 rounded-xl transition-all"><X size={18} /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5">{currentLanguage === 'tr' ? 'Depo Adı' : 'Warehouse Name'}</label>
                <input type="text" value={warehouseForm.name} onChange={e => setWarehouseForm({...warehouseForm, name: e.target.value})} className="w-full px-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl outline-none focus:ring-2 focus:ring-[#ff4000]/20 text-sm" placeholder={currentLanguage === 'tr' ? 'Depo Adı' : 'Warehouse Name'} />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5">{currentLanguage === 'tr' ? 'Konum' : 'Location'}</label>
                <input type="text" value={warehouseForm.location} onChange={e => setWarehouseForm({...warehouseForm, location: e.target.value})} className="w-full px-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl outline-none focus:ring-2 focus:ring-[#ff4000]/20 text-sm" placeholder={currentLanguage === 'tr' ? 'Konum' : 'Location'} />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5">{currentLanguage === 'tr' ? 'Sorumlu' : 'Manager'}</label>
                <input type="text" value={warehouseForm.manager} onChange={e => setWarehouseForm({...warehouseForm, manager: e.target.value})} className="w-full px-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl outline-none focus:ring-2 focus:ring-[#ff4000]/20 text-sm" placeholder={currentLanguage === 'tr' ? 'Sorumlu' : 'Manager'} />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5">{currentLanguage === 'tr' ? 'Notlar' : 'Notes'}</label>
                <textarea value={warehouseForm.notes} onChange={e => setWarehouseForm({...warehouseForm, notes: e.target.value})} className="w-full px-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl outline-none focus:ring-2 focus:ring-[#ff4000]/20 text-sm" placeholder="..." />
              </div>
            </div>
            <div className="p-6 border-t border-gray-100 flex gap-3">
              <button onClick={() => setShowAddWarehouseModal(false)} className="flex-1 py-3 rounded-2xl font-bold text-gray-500 hover:bg-gray-50 transition-all">{t.cancel}</button>
              <button onClick={handleAddWarehouse} className="apple-button-primary flex-1 justify-center py-3 rounded-2xl">{t.save}</button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
