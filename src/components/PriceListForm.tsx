import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'motion/react';
import { X, Save, FileText, Search, Trash2, Tag } from 'lucide-react';
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

  useEffect(() => {
    if (initialData) {
      setFormData(prev => ({
        ...prev,
        ...initialData,
        items: initialData.items || []
      }));
    }
  }, [initialData, isOpen]);

  const filteredInventory = inventory.filter(item =>
    item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    item.sku.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const addItem = (product: InventoryItem) => {
    if (formData.items.find(i => i.productId === product.id)) return;
    setFormData({
      ...formData,
      items: [...formData.items, {
        productId: product.id,
        name: product.name,
        sku: product.sku,
        basePrice: product.prices?.['Retail'] || product.price || 0,
        customPrice: product.prices?.['Retail'] || product.price || 0
      }]
    });
  };

  const removeItem = (productId: string) => {
    setFormData({
      ...formData,
      items: formData.items.filter(i => i.productId !== productId)
    });
  };

  const updateItemPrice = (productId: string, price: number) => {
    setFormData({
      ...formData,
      items: formData.items.map(i => i.productId === productId ? { ...i, customPrice: price } : i)
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name) return;
    setIsSubmitting(true);
    try {
      const data = {
        ...formData,
        updatedAt: serverTimestamp(),
      };

      if (initialData?.id) {
        await updateDoc(doc(db, 'priceLists', initialData.id), data);
      } else {
        await addDoc(collection(db, 'priceLists'), {
          ...data,
          createdAt: serverTimestamp(),
        });
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
        className="bg-white rounded-3xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col"
      >
        <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-brand/10 rounded-xl">
              <FileText className="w-5 h-5 text-brand" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900">{initialData ? 'Fiyat Listesini Düzenle' : 'Yeni Fiyat Listesi'}</h2>
              <p className="text-sm text-gray-500">Müşteriye özel fiyatlandırma listesi oluşturun.</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-200 rounded-full transition-colors">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <div className="flex-1 overflow-hidden flex flex-col md:flex-row">
          {/* Left: Form & Items */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6 border-r border-gray-50">
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-bold text-gray-500 uppercase">Liste Adı</label>
                <input
                  required
                  type="text"
                  value={formData.name}
                  onChange={e => setFormData({ ...formData, name: e.target.value })}
                  className="apple-input w-full"
                  placeholder="Örn: VIP Müşteri Fiyatları"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-gray-500 uppercase">Açıklama</label>
                <textarea
                  value={formData.description}
                  onChange={e => setFormData({ ...formData, description: e.target.value })}
                  className="apple-input w-full min-h-[80px]"
                  placeholder="Liste hakkında notlar..."
                />
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="text-sm font-bold text-gray-900">Listedeki Ürünler ({formData.items.length})</h3>
              </div>
              <div className="space-y-2">
                {formData.items.map((item) => (
                  <div key={item.productId} className="flex items-center gap-4 p-3 bg-gray-50 rounded-2xl group">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-gray-900 truncate">{item.name}</p>
                      <p className="text-[10px] text-gray-500">SKU: {item.sku} | Liste: ₺{item.basePrice.toLocaleString()}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold text-gray-400 uppercase">Özel Fiyat:</span>
                      <input
                        type="number"
                        value={item.customPrice}
                        onChange={e => updateItemPrice(item.productId, Number(e.target.value))}
                        className="apple-input w-24 py-1 text-right text-sm"
                      />
                      <button
                        onClick={() => removeItem(item.productId)}
                        className="p-1.5 text-gray-400 hover:text-red-500 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
                {formData.items.length === 0 && (
                  <div className="text-center py-12 border-2 border-dashed border-gray-100 rounded-3xl">
                    <Tag className="w-8 h-8 text-gray-200 mx-auto mb-2" />
                    <p className="text-sm text-gray-400">Henüz ürün eklenmedi.</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right: Inventory Search */}
          <div className="w-full md:w-80 bg-gray-50/50 flex flex-col">
            <div className="p-4 border-b border-gray-100">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Ürün ara..."
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  className="apple-input w-full pl-10 py-2 text-sm"
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {filteredInventory.map((item) => (
                <button
                  key={item.id}
                  onClick={() => addItem(item)}
                  disabled={formData.items.some(i => i.productId === item.id)}
                  className="w-full text-left p-3 rounded-xl hover:bg-white hover:shadow-sm transition-all group disabled:opacity-50"
                >
                  <p className="text-sm font-bold text-gray-900 truncate group-hover:text-brand">{item.name}</p>
                  <div className="flex justify-between items-center mt-1">
                    <span className="text-[10px] text-gray-500">SKU: {item.sku}</span>
                    <span className="text-xs font-bold text-gray-900">₺{(item.prices?.['Retail'] || item.price || 0).toLocaleString()}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>

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
