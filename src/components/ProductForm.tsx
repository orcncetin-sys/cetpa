import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'motion/react';
import { X, Save, Package, Tag, Layers, MapPin, DollarSign, Barcode } from 'lucide-react';
import { collection, addDoc, updateDoc, doc, serverTimestamp, getDocs, query, where, getDoc } from 'firebase/firestore';
import { db } from '../firebase';

import { InventoryItem, Warehouse } from '../types';

interface ProductFormProps {
  isOpen: boolean;
  onClose: () => void;
  onSave?: () => void;
  initialData?: InventoryItem;
  warehouses?: Warehouse[];
  existingCategories?: string[];
}

export default function ProductForm({ isOpen, onClose, onSave, initialData, warehouses: warehousesProp, existingCategories = [] }: ProductFormProps) {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);

  useEffect(() => {
    if (warehousesProp) {
      setWarehouses(warehousesProp);
    }
  }, [warehousesProp]);

  const [formData, setFormData] = useState({
    name: '',
    sku: '',
    category: '',
    stockLevel: 0,
    lowStockThreshold: 5,
    price: 0,
    costPrice: 0,
    location: '',
    warehouseId: '',
    supplier: '',
    supplierSku: '',
    prices: {
      'Retail': 0,
      'B2B Standard': 0,
      'B2B Premium': 0,
      'Dealer': 0
    }
  });

  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (initialData) {
      setFormData(prev => ({
        ...prev,
        ...initialData,
        prices: {
          ...prev.prices,
          ...(initialData.prices || {})
        }
      }));
    }
  }, [initialData, isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const data = {
        ...formData,
        updatedAt: serverTimestamp(),
      };

      if (initialData?.id) {
        await updateDoc(doc(db, 'inventory', initialData.id), data);

        // Log stock adjustment if quantity changed
        const oldStock = Number(initialData.stockLevel) || 0;
        const newStock = Number(formData.stockLevel) || 0;
        const diff = newStock - oldStock;
        if (diff !== 0) {
          try {
            await addDoc(collection(db, 'inventoryMovements'), {
              productId: initialData.id,
              productName: formData.name,
              type: diff > 0 ? 'in' : 'out',
              quantity: Math.abs(diff),
              reason: 'Manuel Stok Düzeltmesi',
              notes: `${oldStock} → ${newStock}`,
              timestamp: serverTimestamp(),
            });
          } catch { /* non-critical */ }
        }
      } else {
        const newRef = await addDoc(collection(db, 'inventory'), {
          ...data,
          createdAt: serverTimestamp(),
        });

        // Log opening stock movement
        if (formData.stockLevel > 0) {
          try {
            await addDoc(collection(db, 'inventoryMovements'), {
              productId: newRef.id,
              productName: formData.name,
              type: 'in',
              quantity: Number(formData.stockLevel),
              reason: 'Açılış Stoğu',
              notes: 'Ürün oluşturulurken belirlenen başlangıç stok miktarı',
              timestamp: serverTimestamp(),
            });
          } catch { /* non-critical */ }
        }
      }

      // Persist new category to the categories master collection if it's new
      const categoryName = formData.category?.trim();
      if (categoryName && !existingCategories.includes(categoryName)) {
        try {
          const existing = await getDocs(query(collection(db, 'categories'), where('name', '==', categoryName)));
          if (existing.empty) {
            await addDoc(collection(db, 'categories'), { name: categoryName, createdAt: serverTimestamp() });
          }
        } catch {
          // Non-critical — category master list may not be writable for this role
        }
      }

      onSave?.();
      onClose();
    } catch (error) {
      console.error('Error saving product:', error);
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
        className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col"
      >
        <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-brand/10 rounded-xl">
              <Package className="w-5 h-5 text-brand" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900">{initialData ? 'Ürünü Düzenle' : 'Yeni Ürün Ekle'}</h2>
              <p className="text-sm text-gray-500">Envanter bilgilerini aşağıdan yönetebilirsiniz.</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-200 rounded-full transition-colors">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-xs font-bold text-gray-500 uppercase flex items-center gap-2">
                <Tag className="w-3 h-3" /> Ürün Adı
              </label>
              <input
                required
                type="text"
                value={formData.name}
                onChange={e => setFormData({ ...formData, name: e.target.value })}
                className="apple-input w-full"
                placeholder="Örn: iPhone 15 Pro"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-gray-500 uppercase flex items-center gap-2">
                <Barcode className="w-3 h-3" /> SKU / Barkod
              </label>
              <input
                required
                type="text"
                value={formData.sku}
                onChange={e => setFormData({ ...formData, sku: e.target.value })}
                className="apple-input w-full"
                placeholder="Örn: IP15P-BLK-128"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-gray-500 uppercase flex items-center gap-2">
                <Layers className="w-3 h-3" /> Kategori
              </label>
              <input
                type="text"
                list="category-suggestions"
                value={formData.category}
                onChange={e => setFormData({ ...formData, category: e.target.value })}
                className="apple-input w-full"
                placeholder="Kategori adı girin veya seçin"
              />
              {existingCategories.length > 0 && (
                <datalist id="category-suggestions">
                  {existingCategories.map(cat => <option key={cat} value={cat} />)}
                </datalist>
              )}
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-gray-500 uppercase flex items-center gap-2">
                <MapPin className="w-3 h-3" /> Depo
              </label>
              <select
                value={formData.warehouseId}
                onChange={e => setFormData({ ...formData, warehouseId: e.target.value })}
                className="apple-input w-full"
              >
                <option value="">Depo Seçin</option>
                {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-gray-500 uppercase flex items-center gap-2">
                <MapPin className="w-3 h-3" /> Depo Konumu
              </label>
              <input
                type="text"
                value={formData.location}
                onChange={e => setFormData({ ...formData, location: e.target.value })}
                className="apple-input w-full"
                placeholder="Örn: Raf A-12"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-4 border-t border-gray-50">
            <div className="space-y-2">
              <label className="text-xs font-bold text-gray-500 uppercase flex items-center gap-2">
                Stok Miktarı
              </label>
              <input
                required
                type="number"
                value={formData.stockLevel}
                onChange={e => setFormData({ ...formData, stockLevel: Number(e.target.value) })}
                className="apple-input w-full"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-gray-500 uppercase flex items-center gap-2">
                Kritik Eşik
              </label>
              <input
                required
                type="number"
                value={formData.lowStockThreshold}
                onChange={e => setFormData({ ...formData, lowStockThreshold: Number(e.target.value) })}
                className="apple-input w-full"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-gray-500 uppercase flex items-center gap-2">
                <DollarSign className="w-3 h-3" /> Maliyet (TL)
              </label>
              <input
                required
                type="number"
                step="0.01"
                value={formData.costPrice}
                onChange={e => setFormData({ ...formData, costPrice: Number(e.target.value) })}
                className="apple-input w-full"
              />
            </div>
          </div>

          <div className="space-y-4 pt-4 border-t border-gray-50">
            <h3 className="text-sm font-bold text-gray-900">Fiyatlandırma Katmanları</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {Object.entries(formData.prices).map(([tier, price]) => (
                <div key={tier} className="space-y-1.5">
                  <label className="text-[10px] font-bold text-gray-400 uppercase truncate">{tier}</label>
                  <input
                    type="number"
                    step="0.01"
                    value={price}
                    onChange={e => setFormData({
                      ...formData,
                      prices: { ...formData.prices, [tier]: Number(e.target.value) }
                    })}
                    className="apple-input w-full text-sm py-1.5"
                  />
                </div>
              ))}
            </div>
          </div>
        </form>

        <div className="p-6 border-t border-gray-100 bg-gray-50/50 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="apple-button-secondary px-6"
          >
            İptal
          </button>
          <button
            onClick={handleSubmit}
            disabled={isSubmitting}
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
