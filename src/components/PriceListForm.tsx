import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { X, Save, FileText, Search, Trash2, Tag, Plus, ChevronDown, ChevronUp, Check, PackageSearch } from 'lucide-react';
import { collection, addDoc, updateDoc, doc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { type InventoryItem } from '../types';

interface PriceListItem {
  productId: string;
  name: string;
  sku: string;
  basePrice: number;
  customPrice: number;
}

interface PriceListFormProps {
  isOpen: boolean;
  onClose: () => void;
  onSave?: () => void;
  initialData?: {
    id?: string;
    name?: string;
    description?: string;
    isActive?: boolean;
    items?: PriceListItem[];
  };
  inventory: InventoryItem[];
  t: Record<string, string>;
}

export default function PriceListForm({ isOpen, onClose, onSave, initialData, inventory }: PriceListFormProps) {
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    isActive: true,
    items: [] as PriceListItem[]
  });

  const [searchTerm, setSearchTerm] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (initialData) {
      setFormData(prev => ({
        ...prev,
        ...initialData,
        items: initialData.items || []
      }));
    } else {
      setFormData({ name: '', description: '', isActive: true, items: [] });
    }
    setShowPicker(false);
    setSearchTerm('');
  }, [initialData, isOpen]);

  useEffect(() => {
    if (showPicker) {
      setTimeout(() => searchRef.current?.focus(), 50);
    }
  }, [showPicker]);

  const filteredInventory = inventory.filter(item =>
    (item.name?.toLowerCase() || '').includes(searchTerm.toLowerCase()) ||
    (item.sku?.toLowerCase() || '').includes(searchTerm.toLowerCase())
  );

  const isAdded = (productId: string) => formData.items.some(i => i.productId === productId);

  const addItem = (product: InventoryItem) => {
    if (isAdded(product.id)) {
      // toggle off = remove
      setFormData(fd => ({ ...fd, items: fd.items.filter(i => i.productId !== product.id) }));
      return;
    }
    const basePrice = product.prices?.['Retail'] ?? product.price ?? 0;
    setFormData(fd => ({
      ...fd,
      items: [...fd.items, {
        productId: product.id,
        name: product.name,
        sku: product.sku,
        basePrice,
        customPrice: basePrice,
      }]
    }));
  };

  const removeItem = (productId: string) => {
    setFormData(fd => ({ ...fd, items: fd.items.filter(i => i.productId !== productId) }));
  };

  const updateItemPrice = (productId: string, price: number) => {
    setFormData(fd => ({
      ...fd,
      items: fd.items.map(i => i.productId === productId ? { ...i, customPrice: price } : i)
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name) return;
    setIsSubmitting(true);
    try {
      const data = { ...formData, updatedAt: serverTimestamp() };
      if (initialData?.id) {
        await updateDoc(doc(db, 'priceLists', initialData.id), data);
      } else {
        await addDoc(collection(db, 'priceLists'), { ...data, createdAt: serverTimestamp() });
      }
      onSave?.();
      onClose();
    } catch (error) {
      console.error('Error saving price list:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[92vh] overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div className="p-5 border-b border-gray-100 flex justify-between items-center bg-gray-50/50 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-brand/10 rounded-xl">
              <FileText className="w-5 h-5 text-brand" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900">{initialData?.id ? 'Fiyat Listesini Düzenle' : 'Yeni Fiyat Listesi'}</h2>
              <p className="text-xs text-gray-500">Müşteriye özel fiyatlandırma listesi oluşturun.</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-200 rounded-full transition-colors">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">

          {/* Liste Adı */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Liste Adı</label>
            <input
              required
              type="text"
              value={formData.name}
              onChange={e => setFormData({ ...formData, name: e.target.value })}
              className="apple-input w-full"
              placeholder="Örn: VIP Müşteri Fiyatları"
            />
          </div>

          {/* Açıklama */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Açıklama</label>
            <textarea
              value={formData.description}
              onChange={e => setFormData({ ...formData, description: e.target.value })}
              className="apple-input w-full min-h-[72px] resize-none"
              placeholder="Liste hakkında notlar..."
            />
          </div>

          {/* Product section */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                <Tag size={15} className="text-brand" />
                Listedeki Ürünler
                {formData.items.length > 0 && (
                  <span className="ml-1 bg-brand text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                    {formData.items.length}
                  </span>
                )}
              </h3>
              <button
                type="button"
                onClick={() => setShowPicker(v => !v)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-semibold transition-all ${
                  showPicker
                    ? 'bg-brand text-white shadow-sm'
                    : 'bg-brand/10 text-brand hover:bg-brand/20'
                }`}
              >
                {showPicker ? <ChevronUp size={14} /> : <Plus size={14} />}
                {showPicker ? 'Kapat' : 'Ürün Ekle'}
              </button>
            </div>

            {/* Inline product picker */}
            <AnimatePresence>
              {showPicker && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <div className="border border-gray-100 rounded-2xl overflow-hidden bg-gray-50/50">
                    {/* Search bar */}
                    <div className="p-3 border-b border-gray-100 bg-white">
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <input
                          ref={searchRef}
                          type="text"
                          placeholder="Ürün adı veya SKU ile ara..."
                          value={searchTerm}
                          onChange={e => setSearchTerm(e.target.value)}
                          className="apple-input w-full pl-9 py-2 text-sm"
                        />
                        {searchTerm && (
                          <button onClick={() => setSearchTerm('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500">
                            <X size={14} />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Product list */}
                    <div className="max-h-64 overflow-y-auto divide-y divide-gray-100">
                      {filteredInventory.length === 0 ? (
                        <div className="py-8 text-center">
                          <PackageSearch size={28} className="mx-auto mb-2 text-gray-200" />
                          <p className="text-sm text-gray-400">
                            {inventory.length === 0
                              ? 'Henüz envanterde ürün yok.'
                              : 'Ürün bulunamadı.'}
                          </p>
                        </div>
                      ) : (
                        filteredInventory.map(item => {
                          const added = isAdded(item.id);
                          const price = item.prices?.['Retail'] ?? item.price ?? 0;
                          return (
                            <button
                              key={item.id}
                              type="button"
                              onClick={() => addItem(item)}
                              className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-all hover:bg-white ${
                                added ? 'bg-green-50/70' : ''
                              }`}
                            >
                              {/* Checkbox indicator */}
                              <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-all ${
                                added ? 'bg-green-500 border-green-500' : 'border-gray-200 bg-white'
                              }`}>
                                {added && <Check size={11} className="text-white" strokeWidth={3} />}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className={`text-sm font-semibold truncate ${added ? 'text-green-700' : 'text-gray-900'}`}>{item.name}</p>
                                <p className="text-[10px] text-gray-400">SKU: {item.sku}</p>
                              </div>
                              <span className="text-sm font-bold text-gray-700 flex-shrink-0">
                                ₺{price.toLocaleString('tr-TR')}
                              </span>
                            </button>
                          );
                        })
                      )}
                    </div>

                    {/* Footer hint */}
                    <div className="px-4 py-2 bg-white border-t border-gray-100 flex items-center justify-between">
                      <p className="text-[10px] text-gray-400">
                        {filteredInventory.length} ürün gösteriliyor · {formData.items.length} seçili
                      </p>
                      <button
                        type="button"
                        onClick={() => setShowPicker(false)}
                        className="text-[10px] font-bold text-brand hover:underline"
                      >
                        Tamam →
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Selected items */}
            <div className="space-y-2">
              {formData.items.length === 0 && !showPicker && (
                <div
                  onClick={() => setShowPicker(true)}
                  className="text-center py-10 border-2 border-dashed border-gray-100 rounded-2xl cursor-pointer hover:border-brand/30 hover:bg-brand/5 transition-all group"
                >
                  <Plus className="w-8 h-8 text-gray-200 group-hover:text-brand/40 mx-auto mb-2 transition-colors" />
                  <p className="text-sm text-gray-400 group-hover:text-brand/60 transition-colors">
                    Ürün eklemek için tıklayın
                  </p>
                </div>
              )}
              {formData.items.map(item => (
                <div key={item.productId} className="flex items-center gap-3 p-3 bg-gray-50 rounded-2xl group">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-gray-900 truncate">{item.name}</p>
                    <p className="text-[10px] text-gray-400">SKU: {item.sku} · Liste: ₺{item.basePrice.toLocaleString('tr-TR')}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-[10px] font-bold text-gray-400 hidden sm:block">Özel Fiyat</span>
                    <div className="relative">
                      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-gray-400">₺</span>
                      <input
                        type="number"
                        value={item.customPrice}
                        onChange={e => updateItemPrice(item.productId, Number(e.target.value))}
                        className="apple-input w-28 py-1.5 pl-6 pr-2 text-right text-sm font-bold"
                      />
                    </div>
                    {item.customPrice !== item.basePrice && (
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                        item.customPrice < item.basePrice ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'
                      }`}>
                        {item.customPrice < item.basePrice ? '▼' : '▲'}
                        {Math.abs(Math.round(((item.customPrice - item.basePrice) / item.basePrice) * 100))}%
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => removeItem(item.productId)}
                      className="p-1.5 text-gray-300 hover:text-red-500 transition-colors rounded-lg hover:bg-red-50"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Summary strip when items exist */}
            {formData.items.length > 0 && (
              <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50 rounded-xl text-xs text-gray-500">
                <span>{formData.items.length} ürün seçildi</span>
                <span className="font-bold text-gray-700">
                  Toplam Liste Değeri: ₺{formData.items.reduce((s, i) => s + i.customPrice, 0).toLocaleString('tr-TR')}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-5 border-t border-gray-100 bg-gray-50/50 flex justify-end gap-3 flex-shrink-0">
          <button type="button" onClick={onClose} className="apple-button-secondary px-6">
            İptal
          </button>
          <button
            onClick={handleSubmit}
            disabled={isSubmitting || !formData.name}
            className="apple-button-primary px-8 flex items-center gap-2 disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            {isSubmitting ? 'Kaydediliyor...' : 'Kaydet'}
          </button>
        </div>
      </motion.div>
    </div>,
    document.body
  );
}
