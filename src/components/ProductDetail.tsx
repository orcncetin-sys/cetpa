import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { X, Edit2, Package, Tag, Layers, DollarSign, History, TrendingUp, AlertCircle } from 'lucide-react';
import { cn } from '../lib/utils';
import ProductForm from './ProductForm';
import { collection, query, where, onSnapshot, orderBy, limit } from 'firebase/firestore';
import { db } from '../firebase';
import { format } from 'date-fns';
import { logFirestoreError, OperationType } from '../utils/firebase';

import { InventoryItem } from '../types';

interface InventoryMovement {
  id: string;
  productId: string;
  productName: string;
  type: 'in' | 'out';
  quantity: number;
  reason: string;
  notes?: string;
  timestamp?: { toDate: () => Date };
  date?: string;
}

interface ProductDetailProps {
  product: InventoryItem;
  onClose: () => void;
}

export default function ProductDetail({ product, onClose }: ProductDetailProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!product) return;

    // Fetch inventory movements for this product
    const q = query(
      collection(db, 'inventoryMovements'),
      where('productId', '==', product.id),
      orderBy('timestamp', 'desc'),
      limit(20)
    );

    const unsub = onSnapshot(q, (snap) => {
      const data = snap.docs.map(docSnap => {
        const d = docSnap.data();
        return {
          id: docSnap.id,
          productId: d.productId ?? '',
          productName: d.productName ?? '',
          type: d.type as 'in' | 'out',
          quantity: d.quantity ?? 0,
          reason: d.reason ?? '',
          notes: d.notes,
          timestamp: d.timestamp,
          date: d.timestamp?.toDate ? format(d.timestamp.toDate(), 'dd.MM.yyyy HH:mm') : '—',
        } as InventoryMovement;
      });
      setMovements(data);
      setLoading(false);
    }, (error) => {
      logFirestoreError(error, OperationType.LIST, 'inventoryMovements');
      setLoading(false);
    });

    return () => unsub();
  }, [product]);

  if (!product) return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="bg-white rounded-3xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col"
      >
        <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-brand/10 rounded-2xl">
              <Package className="w-6 h-6 text-brand" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900">{product.name}</h2>
              <p className="text-sm text-gray-500">SKU: {product.sku}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsEditing(true)}
              className="p-2 hover:bg-gray-200 rounded-full transition-colors text-gray-600"
              title="Düzenle"
            >
              <Edit2 className="w-5 h-5" />
            </button>
            <div className="w-px h-6 bg-gray-200 mx-2" />
            <button onClick={onClose} className="p-2 hover:bg-gray-200 rounded-full transition-colors">
              <X className="w-5 h-5 text-gray-500" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-8 space-y-8">
          {/* Stats Row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: 'Mevcut Stok', value: product.stockLevel, icon: Layers, color: product.stockLevel <= product.lowStockThreshold ? 'text-red-600' : 'text-green-600', bg: product.stockLevel <= product.lowStockThreshold ? 'bg-red-50' : 'bg-green-50' },
              { label: 'Kritik Eşik', value: product.lowStockThreshold, icon: AlertCircle, color: 'text-orange-600', bg: 'bg-orange-50' },
              { label: 'Maliyet', value: `₺${product.costPrice?.toLocaleString()}`, icon: DollarSign, color: 'text-blue-600', bg: 'bg-blue-50' },
              { label: 'Satış Fiyatı', value: `₺${(product.prices?.['Retail'] || product.price || 0).toLocaleString()}`, icon: TrendingUp, color: 'text-brand', bg: 'bg-brand/5' },
            ].map((stat, i) => (
              <div key={i} className={cn("p-4 rounded-2xl border border-transparent transition-all", stat.bg)}>
                <div className="flex items-center gap-2 mb-1">
                  <stat.icon className={cn("w-3.5 h-3.5", stat.color)} />
                  <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">{stat.label}</span>
                </div>
                <p className={cn("text-xl font-black", stat.color)}>{stat.value}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* Details */}
            <div className="space-y-6">
              <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider flex items-center gap-2">
                <Tag className="w-4 h-4" /> Genel Bilgiler
              </h3>
              <div className="space-y-4">
                {[
                  { label: 'Kategori', value: product.category || 'Belirtilmemiş' },
                  { label: 'Konum', value: product.location || 'Ana Depo' },
                  { label: 'Tedarikçi', value: product.supplier || 'Belirtilmemiş' },
                  { label: 'Tedarikçi SKU', value: product.supplierSku || '-' },
                ].map((item, i) => (
                  <div key={i} className="flex justify-between items-center py-2 border-b border-gray-50 last:border-0">
                    <span className="text-sm text-gray-500">{item.label}</span>
                    <span className="text-sm font-bold text-gray-900">{item.value}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Pricing Tiers */}
            <div className="space-y-6">
              <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider flex items-center gap-2">
                <DollarSign className="w-4 h-4" /> Fiyat Katmanları
              </h3>
              <div className="bg-gray-50 rounded-2xl p-4 space-y-3">
                {Object.entries(product.prices || {}).map(([tier, price]: [string, number]) => (
                  <div key={tier} className="flex justify-between items-center">
                    <span className="text-xs font-medium text-gray-600">{tier}</span>
                    <span className="text-sm font-bold text-gray-900">₺{price.toLocaleString()}</span>
                  </div>
                ))}
                {(!product.prices || Object.keys(product.prices).length === 0) && (
                  <p className="text-xs text-gray-400 italic text-center py-2">Fiyat katmanı tanımlanmamış.</p>
                )}
              </div>
            </div>
          </div>

          {/* Recent Movements (Placeholder) */}
          <div className="space-y-4">
            <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider flex items-center gap-2">
              <History className="w-4 h-4" /> Son Hareketler
            </h3>
            <div className="border border-gray-100 rounded-2xl overflow-hidden">
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 font-bold text-gray-500 uppercase text-[10px]">Tarih</th>
                    <th className="px-4 py-3 font-bold text-gray-500 uppercase text-[10px]">Tür</th>
                    <th className="px-4 py-3 font-bold text-gray-500 uppercase text-[10px] text-right">Miktar</th>
                    <th className="px-4 py-3 font-bold text-gray-500 uppercase text-[10px]">Not</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {loading ? (
                    <tr className="text-gray-400 italic">
                      <td colSpan={4} className="px-4 py-8 text-center">Hareket geçmişi yükleniyor...</td>
                    </tr>
                  ) : movements.length === 0 ? (
                    <tr className="text-gray-400 italic">
                      <td colSpan={4} className="px-4 py-8 text-center">Henüz hareket bulunmuyor.</td>
                    </tr>
                  ) : (
                    movements.map((m) => (
                      <tr key={m.id} className="hover:bg-gray-50/50 transition-colors">
                        <td className="px-4 py-3 text-xs text-gray-600">{m.date}</td>
                        <td className="px-4 py-3 text-xs font-medium">
                          <span className={m.type === 'in' ? 'text-green-600' : 'text-red-500'}>
                            {m.type === 'in' ? '▲ Giriş' : '▼ Çıkış'}
                          </span>
                        </td>
                        <td className={`px-4 py-3 text-xs text-right font-bold ${m.type === 'in' ? 'text-green-600' : 'text-red-500'}`}>
                          {m.type === 'in' ? '+' : '-'}{m.quantity}
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-500 truncate max-w-[200px]" title={m.notes || m.reason}>
                          <span className="font-medium text-gray-700">{m.reason}</span>
                          {m.notes && <span className="ml-1 text-gray-400">— {m.notes}</span>}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <AnimatePresence>
          {isEditing && (
            <ProductForm
              isOpen={isEditing}
              onClose={() => setIsEditing(false)}
              initialData={product}
              onSave={() => {
                setIsEditing(false);
                // The parent component will handle the real-time update via onSnapshot
              }}
            />
          )}
        </AnimatePresence>
      </motion.div>
    </div>,
    document.body
  );
}
