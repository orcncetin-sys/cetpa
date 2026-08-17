import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Plus, Search, Scan, Package, Trash2, FileText, RefreshCw } from 'lucide-react';
import { cn } from '../lib/utils';
const BarcodeScanner = React.lazy(() => import('./BarcodeScanner'));
import CustomerCombobox from './CustomerCombobox';
import type { Lead, InventoryItem, Order, OrderLineItem } from '../types';

interface AddOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedLead: Lead | null;
  setSelectedLead: (lead: Lead | null) => void;
  leads: Lead[];
  inventory: InventoryItem[];
  branchNames: string[];
  currentLanguage: 'tr' | 'en';
  currentT: Record<string, string>;
  onSubmit: (orderData: Partial<Order>, lineItems: OrderLineItem[], computedTotal: number) => Promise<void>;
  onAddLeadClick: () => void;
  onGoToInventory: () => void;
}

export default function AddOrderModal({
  isOpen,
  onClose,
  selectedLead,
  setSelectedLead,
  leads,
  inventory,
  branchNames,
  currentLanguage,
  currentT,
  onSubmit,
  onAddLeadClick,
  onGoToInventory
}: AddOrderModalProps) {
  const [newOrder, setNewOrder] = useState<Partial<Order>>({ status: 'Pending', shippingAddress: '', faturali: true, kdvOran: 20 });
  const [orderLineItems, setOrderLineItems] = useState<OrderLineItem[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showProductPicker, setShowProductPicker] = useState(false);
  const [productSearch, setProductSearch] = useState('');
  const [isOrderScannerOpen, setIsOrderScannerOpen] = useState(false);

  const computedTotal = orderLineItems.reduce((sum, item) => sum + item.price * item.quantity, 0);

  // Modal kapanınca form durumunu sıfırla — `if (!isOpen) return null` unmount ETMEZ, state aksi halde
  // taşınır ve yeniden açılışta eski sipariş verisi görünür (yanlışlıkla mükerrer sipariş riski).
  useEffect(() => {
    if (!isOpen) {
      setNewOrder({ status: 'Pending', shippingAddress: '', faturali: true, kdvOran: 20 });
      setOrderLineItems([]);
      setProductSearch('');
      setShowProductPicker(false);
    }
  }, [isOpen]);

  // Auto-fill from selectedLead — açılışta (veya seçili lead değişince) müşteri bilgisini doldur
  useEffect(() => {
    if (isOpen && selectedLead) {
      const isEFatura = selectedLead.customerType === 'B2B' || (selectedLead.taxId && selectedLead.taxId.length >= 10);
      setNewOrder(prev => ({
        ...prev,
        customerName: selectedLead.name,
        shippingAddress: selectedLead.company || prev.shippingAddress,
        faturali: true,
        faturaTipi: isEFatura ? 'e-fatura' : 'e-arsiv'
      }));
    }
  }, [isOpen, selectedLead]);

  // Handle adding a line item
  const handleAddLineItem = (item: InventoryItem) => {
    // Automatically set KDV (vatRate) from product if not already set or if explicitly requested
    const vatRate = (item.vatRate as number | undefined) || 20;
    setNewOrder(prev => ({ ...prev, kdvOran: vatRate as number, faturali: true }));

    const existingIndex = orderLineItems.findIndex(i => i.inventoryId === item.id);
    if (existingIndex >= 0) {
      const updated = [...orderLineItems];
      updated[existingIndex].quantity += 1;
      setOrderLineItems(updated);
    } else {
      setOrderLineItems([...orderLineItems, {
        id: crypto.randomUUID(),
        inventoryId: item.id,
        name: item.name,
        title: item.name,
        sku: item.sku,
        price: item.price || (typeof item.prices === 'object' && item.prices ? (item.prices as Record<string, number>).Retail || 0 : 0),
        quantity: 1,
        vatRate: vatRate as number
      }]);
    }
    setProductSearch('');
    setShowProductPicker(false);
  };

  const handleUpdateLineItemPrice = (idx: number, newPrice: number) => {
    const items = [...orderLineItems];
    items[idx].price = newPrice;
    setOrderLineItems(items);
  };

  const handleUpdateLineItemQty = (idx: number, newQty: number) => {
    if (newQty <= 0) {
      setOrderLineItems(orderLineItems.filter((_, i) => i !== idx));
    } else {
      const items = [...orderLineItems];
      items[idx].quantity = newQty;
      setOrderLineItems(items);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await onSubmit(newOrder, orderLineItems, computedTotal);
      onClose(); // form, kapanış effect'inde (isOpen=false) sıfırlanır
    } catch (err) {
      console.error(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onClick={() => { if (!isSubmitting) onClose(); }}
          className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
        <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl relative z-10 overflow-hidden border border-gray-200 max-h-[90vh] flex flex-col">

          {/* Header */}
          <div className="p-6 border-b border-gray-100 flex items-center justify-between shrink-0">
            <div>
              <h3 className="text-xl font-bold">{selectedLead ? `${currentT.new_order} — ${selectedLead.name}` : currentT.create_new_order}</h3>
              <p className="text-xs text-gray-400 mt-0.5">{currentT.products_pulled_from_shopify}</p>
            </div>
            <button onClick={() => { if (!isSubmitting) onClose(); }}
              className="text-gray-400 hover:text-gray-600"><Plus className="w-6 h-6 rotate-45" /></button>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
            <div className="overflow-y-auto flex-1 p-6 space-y-5">

              {/* Resmi / Faturasız toggle */}
              <div className={`rounded-xl border p-3 flex items-center justify-between gap-3 ${newOrder.faturali ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
                <div className="min-w-0">
                  <p className={`text-xs font-bold ${newOrder.faturali ? 'text-emerald-700' : 'text-amber-700'}`}>
                    {newOrder.faturali
                      ? (currentLanguage === 'tr' ? 'Resmi (Faturalı) İşlem' : 'Official (Invoiced) Sale')
                      : (currentLanguage === 'tr' ? 'Faturasız İşlem' : 'Unofficial Sale')}
                  </p>
                  <p className={`text-[11px] mt-0.5 ${newOrder.faturali ? 'text-emerald-600' : 'text-amber-600'}`}>
                    {newOrder.faturali
                      ? (currentLanguage === 'tr' ? 'KDV hesaplanır, yevmiye kaydı atılır ve Mikro\'ya sipariş kaydı gönderilir.' : 'VAT applied, journal entry created, order pushed to Mikro.')
                      : (currentLanguage === 'tr' ? 'Mikro\'ya kayıt GÖNDERİLMEZ — stok yalnızca yerel sistemde düşülür.' : 'NOT sent to Mikro — stock tracked locally only.')}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setNewOrder(prev => ({ ...prev, faturali: !prev.faturali }))}
                  className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${newOrder.faturali ? 'bg-emerald-500' : 'bg-gray-300'}`}
                  aria-label="Resmi işlem"
                >
                  <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${newOrder.faturali ? 'translate-x-5' : 'translate-x-0.5'}`} />
                </button>
              </div>

              {/* Customer */}
              {!selectedLead && (
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-gray-500 uppercase">{currentT.customer_name}</label>
                  <CustomerCombobox
                    leads={leads}
                    value={newOrder.customerName || ''}
                    onChange={text => setNewOrder({ ...newOrder, customerName: text })}
                    onSelect={lead => {
                      const isEFatura = lead.customerType === 'B2B' || (lead.taxId && lead.taxId.length >= 10);
                      setNewOrder({
                        ...newOrder,
                        customerName: lead.name,
                        shippingAddress: lead.company || '',
                        faturali: true,
                        faturaTipi: isEFatura ? 'e-fatura' : 'e-arsiv'
                      });
                      setSelectedLead(lead);
                    }}
                    placeholder={currentLanguage === 'tr' ? 'Müşteri ara veya yaz...' : 'Search or type customer...'}
                    maxResults={8}
                    inputClassName="apple-input pl-9"
                    dropdownMaxHeightClass="max-h-48"
                    renderSecondaryLine={lead => <>{lead.company} • {lead.email}</>}
                    emptyText={currentLanguage === 'tr' ? 'Henüz müşteri yok' : 'No customers yet'}
                    footer={
                      <button type="button"
                        onMouseDown={e => { e.preventDefault(); onClose(); onAddLeadClick(); }}
                        className="w-full text-left px-4 py-2.5 text-xs font-bold text-brand hover:bg-brand/5 flex items-center gap-2">
                        <Plus className="w-3.5 h-3.5" />
                        {currentLanguage === 'tr' ? 'Yeni müşteri adayı ekle' : 'Add new lead'}
                      </button>
                    }
                  />
                </div>
              )}

              {/* Product Picker */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-bold text-gray-500 uppercase">{currentT.products_line_items}</label>
                  <div className="flex items-center gap-3">
                    {orderLineItems.length > 0 && (
                      <button type="button" onClick={() => setOrderLineItems([])}
                        className="text-gray-400 text-[10px] font-bold hover:text-red-500 transition-colors">
                        {currentT.clear_all}
                      </button>
                    )}
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => setIsOrderScannerOpen(true)}
                        className="text-gray-500 text-xs font-bold flex items-center gap-1 hover:text-brand hover:underline transition-colors">
                        <Scan className="w-3.5 h-3.5" /> {currentLanguage === 'tr' ? 'Tara' : 'Scan'}
                      </button>
                      <button type="button" onClick={() => setShowProductPicker(!showProductPicker)}
                        className="text-brand text-xs font-bold flex items-center gap-1 hover:underline">
                        <Plus className="w-3.5 h-3.5" /> {currentT.add_product}
                      </button>
                    </div>
                  </div>
                </div>

                <React.Suspense fallback={null}>
                  <BarcodeScanner
                  isOpen={isOrderScannerOpen}
                  onClose={() => setIsOrderScannerOpen(false)}
                  currentLanguage={currentLanguage}
                  title={currentLanguage === 'tr' ? 'Ürün Barkodu Tara' : 'Scan Product Barcode'}
                  onScan={(barcode) => {
                  const match = inventory.find(i => i.sku === barcode || i.sku.toLowerCase() === barcode.toLowerCase() || (i as unknown as { barcode?: string }).barcode === barcode || i.name.toLowerCase().includes(barcode.toLowerCase()));
                  if (match) handleAddLineItem(match);
                  else setProductSearch(barcode);
                  setShowProductPicker(true);
                  }}
                  />
                </React.Suspense>

                {showProductPicker && (
                  <div className="border border-gray-200 rounded-xl overflow-hidden shadow-lg">
                    <div className="p-3 border-b border-gray-100 bg-gray-50">
                      <div className="flex items-center gap-2">
                        <Search className="w-4 h-4 text-gray-400 shrink-0" />
                        <input autoFocus type="text" placeholder={currentT.search_products} value={productSearch}
                          onChange={e => setProductSearch(e.target.value)}
                          className="flex-1 bg-transparent outline-none text-sm" />
                      </div>
                    </div>
                    <div className="max-h-52 overflow-y-auto">
                      {inventory.length === 0 ? (
                        <div className="p-6 text-center text-sm text-gray-400">
                          <Package className="w-8 h-8 mx-auto mb-2 text-gray-200" />
                          {currentT.no_inventory_synced}{' '}
                          <button type="button" onClick={() => { onClose(); onGoToInventory(); }}
                            className="text-brand font-bold hover:underline">{currentT.go_sync_shopify}</button>
                        </div>
                      ) : (
                        inventory
                          .filter(item => item.name.toLowerCase().includes(productSearch.toLowerCase()) || item.sku.toLowerCase().includes(productSearch.toLowerCase()))
                          .map(item => (
                            <button key={item.id} type="button" onClick={() => handleAddLineItem(item)}
                              className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors text-left border-b border-gray-50 last:border-0">
                              <div>
                                <p className="font-bold text-sm text-[#1D2226]">{item.name}</p>
                                <p className="text-[10px] text-gray-400">{item.sku} • Stock: {item.stockLevel}</p>
                              </div>
                              <div className="text-right shrink-0 ml-4">
                                <p className="font-bold text-sm text-brand">${(item.price || (typeof item.prices === 'object' && item.prices ? (item.prices as Record<string, number>).Retail || 0 : 0)).toFixed(2)}</p>
                                {item.stockLevel <= item.lowStockThreshold && (
                                  <span className="text-[9px] font-bold text-red-500 uppercase">Low Stock</span>
                                )}
                              </div>
                            </button>
                          ))
                      )}
                    </div>
                  </div>
                )}

                {orderLineItems.length > 0 ? (
                  <div className="border border-gray-200 rounded-xl overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 border-b border-gray-100">
                        <tr>
                          <th className="px-4 py-2 text-left text-[10px] font-bold text-gray-500 uppercase">Product</th>
                          <th className="px-4 py-2 text-center text-[10px] font-bold text-gray-500 uppercase">Price</th>
                          <th className="px-4 py-2 text-center text-[10px] font-bold text-gray-500 uppercase">Qty</th>
                          <th className="px-4 py-2 text-right text-[10px] font-bold text-gray-500 uppercase">Total</th>
                          <th className="px-2 py-2"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {orderLineItems.map((item, idx) => (
                          <tr key={idx}>
                            <td className="px-4 py-2.5">
                              <p className="font-bold text-[#1D2226]">{item.title}</p>
                              <p className="text-[10px] text-gray-400">{item.sku}</p>
                            </td>
                            <td className="px-4 py-2.5">
                              <div className="flex items-center justify-center gap-1">
                                <span className="text-gray-400 text-xs">$</span>
                                <input type="number" step="0.01" value={item.price} onChange={e => handleUpdateLineItemPrice(idx, parseFloat(e.target.value) || 0)}
                                  className="w-16 text-center font-bold text-sm bg-gray-50 border border-gray-100 rounded px-1 py-0.5 focus:ring-0" />
                              </div>
                            </td>
                            <td className="px-4 py-2.5">
                              <div className="flex items-center justify-center gap-1">
                                <button type="button" onClick={() => handleUpdateLineItemQty(idx, item.quantity - 1)}
                                  className="w-6 h-6 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center font-bold text-sm leading-none">−</button>
                                <input type="number" value={item.quantity} onChange={e => handleUpdateLineItemQty(idx, parseInt(e.target.value) || 0)}
                                  className="w-10 text-center font-bold text-sm bg-transparent border-none focus:ring-0 p-0" />
                                <button type="button" onClick={() => handleUpdateLineItemQty(idx, item.quantity + 1)}
                                  className="w-6 h-6 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center font-bold text-sm leading-none">+</button>
                              </div>
                            </td>
                            <td className="px-4 py-2.5 text-right font-bold text-[#1D2226]">
                              ${(item.price * item.quantity).toFixed(2)}
                            </td>
                            <td className="px-2 py-2.5">
                              <button type="button" onClick={() => setOrderLineItems(orderLineItems.filter((_, i) => i !== idx))}
                                className="text-gray-300 hover:text-red-500 transition-colors">
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="border-t border-gray-200 bg-gray-50">
                        <tr>
                          <td colSpan={2} className="px-4 py-3 text-sm font-bold text-gray-500">{currentT.order_total}</td>
                          <td className="px-4 py-3 text-right text-lg font-bold text-brand">${computedTotal.toFixed(2)}</td>
                          <td></td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                ) : (
                  <div className="border-2 border-dashed border-gray-100 rounded-xl p-6 text-center text-gray-400 text-sm">
                    <Package className="w-8 h-8 mx-auto mb-2 text-gray-200" />
                    {currentT.no_products_added}
                  </div>
                )}
              </div>

              {/* Status + Address */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-gray-500 uppercase">{currentT.status}</label>
                  <select value={newOrder.status} onChange={e => setNewOrder({ ...newOrder, status: e.target.value as 'Pending' | 'Processing' | 'Shipped' | 'Delivered' | 'Cancelled' })}
                    className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-brand transition-colors">
                    <option value="Pending">{currentT.pending}</option>
                    <option value="Processing">{currentT.processing}</option>
                    <option value="Shipped">{currentT.shipped}</option>
                    <option value="Delivered">{currentT.delivered}</option>
                    <option value="Cancelled">{currentT.cancelled}</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-gray-500 uppercase">{currentT.shipping_address}</label>
                  <input type="text" value={newOrder.shippingAddress || ''} onChange={e => setNewOrder({ ...newOrder, shippingAddress: e.target.value })}
                    className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-brand transition-colors" placeholder={currentT.city_district} />
                </div>
                {branchNames.length > 0 && (
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-gray-500 uppercase">
                      {currentLanguage === 'tr' ? 'Şube' : 'Branch'}
                    </label>
                    <select
                      value={(newOrder as any).subeAdi || ''}
                      onChange={e => setNewOrder({ ...newOrder, subeAdi: e.target.value } as any)}
                      className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-brand transition-colors"
                    >
                      <option value="">{currentLanguage === 'tr' ? '— Şube seç (opsiyonel) —' : '— Select branch (optional) —'}</option>
                      {branchNames.map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </div>
                )}
              </div>

              {/* Fatura / KDV Seçimi */}
              <div className="rounded-xl border border-gray-200 bg-gray-50/50 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-bold text-gray-700">{currentLanguage === 'tr' ? 'Faturalı Satış' : 'Invoice Required'}</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">{currentLanguage === 'tr' ? 'Kapalı = faturasız sevk, KDV yok' : 'Off = shipped without invoice, no VAT'}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setNewOrder(prev => ({ ...prev, faturali: !prev.faturali, kdvOran: !prev.faturali ? 20 : 0 }))}
                    className={cn(
                      'relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none',
                      newOrder.faturali ? 'bg-brand' : 'bg-gray-300'
                    )}
                  >
                    <span className={cn('inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform', newOrder.faturali ? 'translate-x-6' : 'translate-x-1')} />
                  </button>
                </div>
                {newOrder.faturali && (
                  <div className="space-y-3">
                    <div>
                      <label className="text-[10px] font-bold text-gray-500 uppercase mb-1.5 block">{currentLanguage === 'tr' ? 'Fatura Türü' : 'Invoice Type'}</label>
                      <div className="grid grid-cols-3 gap-2">
                        {([
                          { value: 'e-fatura', label: 'e-Fatura', desc: currentLanguage==='tr'?'Kayıtlı mükellef':'Registered taxpayer' },
                          { value: 'e-arsiv', label: 'e-Arşiv', desc: currentLanguage==='tr'?'Kayıtsız / bireysel':'Unregistered / individual' },
                          { value: 'ihracat', label: currentLanguage==='tr'?'İhracat':'Export', desc: currentLanguage==='tr'?'Yurt dışı satış':'International sale' },
                        ] as const).map(type => (
                          <button key={type.value} type="button"
                            onClick={() => setNewOrder(prev => ({ ...prev, faturaTipi: type.value } as any))}
                            className={cn('p-2 rounded-xl border text-left transition-all',
                              (newOrder as any).faturaTipi === type.value ? 'border-brand bg-brand/5' : 'border-gray-200 hover:border-gray-300'
                            )}>
                            <p className={`text-[10px] font-bold ${(newOrder as any).faturaTipi === type.value ? 'text-brand' : 'text-gray-700'}`}>{type.label}</p>
                            <p className="text-[9px] text-gray-400 leading-tight mt-0.5">{type.desc}</p>
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-[10px] font-bold text-gray-500 uppercase">{currentLanguage === 'tr' ? 'KDV Oranı' : 'VAT Rate'}</label>
                        {orderLineItems.length > 0 && (
                          <span className="text-[9px] font-bold text-brand bg-brand/10 px-1.5 py-0.5 rounded-full">
                            ↑ {currentLanguage === 'tr' ? 'üründen otomatik' : 'auto from product'}
                          </span>
                        )}
                      </div>
                      <select
                        value={newOrder.kdvOran ?? 20}
                        onChange={e => setNewOrder(prev => ({ ...prev, kdvOran: Number(e.target.value) }))}
                        className="apple-input w-full mb-2 text-sm font-bold text-gray-700"
                      >
                        {[0, 1, 8, 10, 18, 20].map(rate => (
                          <option key={rate} value={rate}>
                            {'%' + rate + ' KDV' + (rate === 0 ? ' — İstisna/İhracat' : rate === 1 ? ' — Temel Gıda' : rate === 8 ? ' — İndirimli' : rate === 20 ? ' — Genel Oran' : '')}
                          </option>
                        ))}
                      </select>
                      <div className="flex gap-1.5">
                        {[0, 1, 8, 10, 18, 20].map(rate => (
                          <button
                            key={rate}
                            type="button"
                            onClick={() => setNewOrder(prev => ({ ...prev, kdvOran: rate }))}
                            className={cn(
                              'flex-1 py-1 rounded-lg text-[10px] font-bold transition-colors',
                              newOrder.kdvOran === rate ? 'bg-brand text-white shadow-sm' : 'bg-white border border-gray-200 text-gray-500 hover:border-brand hover:text-brand'
                            )}
                          >
                            %{rate}
                          </button>
                        ))}
                      </div>
                    </div>
                    {orderLineItems.length > 0 && (
                      <div className="mt-2 pt-2 border-t border-gray-200 space-y-0.5 text-xs text-gray-500">
                        <div className="flex justify-between">
                          <span>{currentLanguage === 'tr' ? 'Matrah (KDV hariç)' : 'Net (excl. VAT)'}</span>
                          <span className="font-semibold">₺{(computedTotal / (1 + (newOrder.kdvOran || 0) / 100)).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        </div>
                        <div className="flex justify-between text-brand">
                          <span>KDV %{newOrder.kdvOran || 0}</span>
                          <span className="font-semibold">₺{(computedTotal - computedTotal / (1 + (newOrder.kdvOran || 0) / 100)).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        </div>
                        <div className="flex justify-between font-bold text-gray-800 pt-0.5">
                          <span>{currentLanguage === 'tr' ? 'Toplam' : 'Total'}</span>
                          <span>₺{computedTotal.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold text-gray-500 uppercase">{currentT.notes}</label>
                <textarea value={newOrder.notes || ''} onChange={e => setNewOrder({ ...newOrder, notes: e.target.value })} rows={2}
                  className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-brand transition-colors resize-none" placeholder={currentT.add_notes} />
              </div>
            </div>

            {/* Footer */}
            <div className="p-6 border-t border-gray-100 shrink-0 space-y-2">
              {newOrder.faturali ? (
                <div className="flex items-center justify-center gap-2 text-[10px] font-bold text-green-600 bg-green-50 rounded-lg py-1.5">
                  <FileText className="w-3 h-3" />
                  {currentLanguage === 'tr' ? `Faturalı • KDV %${newOrder.kdvOran || 0}` : `Invoiced • VAT %${newOrder.kdvOran || 0}`}
                </div>
              ) : (
                <div className="flex items-center justify-center gap-2 text-[10px] font-bold text-gray-400 bg-gray-50 rounded-lg py-1.5">
                  <FileText className="w-3 h-3" />
                  {currentLanguage === 'tr' ? 'Faturasız sevkiyat — KDV yok' : 'Shipped without invoice — no VAT'}
                </div>
              )}
              {orderLineItems.length > 0 && (
                <p className="text-[11px] text-center text-gray-400 flex items-center justify-center gap-1">
                  <RefreshCw className="w-3 h-3" />
                  {currentT.create_draft_order_shopify}
                </p>
              )}
              <button type="submit" disabled={isSubmitting}
                className="apple-button-primary w-full">
                {isSubmitting ? (
                  <><RefreshCw className="w-4 h-4 animate-spin" /> {currentT.saving_and_pushing}</>
                ) : (
                  <>{currentT.create_order} {orderLineItems.length > 0 && `• $${computedTotal.toFixed(2)}`}</>
                )}
              </button>
            </div>
          </form>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
