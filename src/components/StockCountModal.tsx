import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Search, RefreshCw, CheckCircle2 } from 'lucide-react';
import { updateDoc, doc, serverTimestamp } from '../lib/dbClient';
import { db } from '../firebase';
import type { InventoryItem } from '../types';
import type { Language } from '../translations';
import { cn } from '../lib/utils';

interface StockCountModalProps {
  isOpen: boolean;
  onClose: () => void;
  inventory: InventoryItem[];
  currentLanguage: Language;
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
}

export default function StockCountModal({
  isOpen,
  onClose,
  inventory,
  currentLanguage,
  onSuccess,
  onError
}: StockCountModalProps) {
  const [stockCountDraft, setStockCountDraft] = useState<Record<string, number>>({});
  const [stockCountSaving, setStockCountSaving] = useState(false);
  const [stockCountSearch, setStockCountSearch] = useState('');

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[88vh] flex flex-col overflow-hidden"
        >
          <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between">
            <div>
              <p className="text-[10px] font-bold text-brand uppercase tracking-widest mb-0.5">{currentLanguage === 'tr' ? 'Hızlı Stok Sayımı' : 'Quick Stock Count'}</p>
              <h3 className="text-lg font-black text-gray-900">{currentLanguage === 'tr' ? 'Stok Seviyelerini Güncelle' : 'Update Stock Levels'}</h3>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full transition-colors"><X className="w-5 h-5 text-gray-500" /></button>
          </div>
          {/* Search */}
          <div className="px-6 py-3 border-b border-gray-100">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              <input type="text" value={stockCountSearch} onChange={e => setStockCountSearch(e.target.value)}
                placeholder={currentLanguage === 'tr' ? 'Ürün ara…' : 'Search products…'}
                className="w-full pl-9 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none focus:border-brand"
              />
            </div>
            {Object.keys(stockCountDraft).length > 0 && (
              <p className="text-[10px] text-amber-600 font-bold mt-2">
                ⚠ {Object.keys(stockCountDraft).length} {currentLanguage === 'tr' ? 'üründe değişiklik var' : 'items have pending changes'}
              </p>
            )}
          </div>
          {/* Items */}
          <div className="flex-1 overflow-y-auto divide-y divide-gray-50">
            {inventory
              .filter(i => !stockCountSearch || i.name.toLowerCase().includes(stockCountSearch.toLowerCase()) || (i.sku || '').toLowerCase().includes(stockCountSearch.toLowerCase()))
              .map(item => {
                const current = item.stockLevel ?? 0;
                const draft = stockCountDraft[item.id] ?? current;
                const changed = draft !== current;
                return (
                  <div key={item.id} className={cn("flex items-center gap-4 px-6 py-3", changed ? "bg-amber-50" : "hover:bg-gray-50")}>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-800 truncate">{item.name}</p>
                      <p className="text-[10px] text-gray-400">{item.sku}{item.category ? ` · ${item.category}` : ''}</p>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <span className="text-xs text-gray-400">{currentLanguage === 'tr' ? 'Mevcut:' : 'Current:'} <strong className="text-gray-700">{current}</strong></span>
                      {changed && <span className="text-[10px] font-bold text-amber-600">→ {draft}</span>}
                      <input
                        type="number"
                        min={0}
                        value={draft}
                        onChange={e => {
                          const v = parseInt(e.target.value, 10);
                          setStockCountDraft(prev => {
                            const next = { ...prev };
                            if (!isNaN(v) && v !== current) next[item.id] = v;
                            else delete next[item.id];
                            return next;
                          });
                        }}
                        className="w-20 text-center text-sm font-bold bg-white border border-gray-200 rounded-lg px-2 py-1.5 outline-none focus:border-brand"
                      />
                    </div>
                  </div>
                );
              })}
          </div>
          {/* Footer */}
          <div className="px-6 py-4 border-t border-gray-100 flex justify-between items-center bg-gray-50/50">
            <button onClick={() => setStockCountDraft({})} className="text-xs font-semibold text-gray-500 hover:text-gray-700 transition-colors">
              {currentLanguage === 'tr' ? 'Sıfırla' : 'Reset changes'}
            </button>
            <div className="flex gap-3">
              <button onClick={onClose} className="apple-button-secondary text-sm px-5">
                {currentLanguage === 'tr' ? 'İptal' : 'Cancel'}
              </button>
              <button
                disabled={Object.keys(stockCountDraft).length === 0 || stockCountSaving}
                onClick={async () => {
                  if (Object.keys(stockCountDraft).length === 0) return;
                  setStockCountSaving(true);
                  try {
                    await Promise.all(Object.entries(stockCountDraft).map(([id, qty]) =>
                      updateDoc(doc(db, 'inventory', id), { stockLevel: qty, updatedAt: serverTimestamp() })
                    ));
                    onSuccess(currentLanguage === 'tr' ? `${Object.keys(stockCountDraft).length} ürün güncellendi ✓` : `${Object.keys(stockCountDraft).length} items updated ✓`);
                    setStockCountDraft({});
                    onClose();
                  } catch (e) {
                    console.error("[firestore]", e);
                    onError(currentLanguage === 'tr' ? 'Hata oluştu' : 'Error saving');
                  } finally {
                    setStockCountSaving(false);
                  }
                }}
                className="apple-button-primary text-sm px-5 disabled:opacity-40"
              >
                {stockCountSaving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                {currentLanguage === 'tr' ? `Kaydet (${Object.keys(stockCountDraft).length})` : `Save (${Object.keys(stockCountDraft).length})`}
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
