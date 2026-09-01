import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { RefreshCw, X } from 'lucide-react';
import { collection, addDoc, updateDoc, doc, serverTimestamp } from '../lib/dbClient';
import { db } from '../firebase';
import type { Order } from '../types';
import type { Language } from '../translations';

interface ReturnModalProps {
  order: Order | null;
  onClose: () => void;
  currentLanguage: Language;
  userEmail?: string;
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
}

export default function ReturnModal({
  order,
  onClose,
  currentLanguage,
  userEmail,
  onSuccess,
  onError
}: ReturnModalProps) {
  const [returnReason, setReturnReason] = useState('');
  const [returnItems, setReturnItems] = useState('');
  const [returnAmount, setReturnAmount] = useState<number>(0);
  const [returnSubmitting, setReturnSubmitting] = useState(false);

  if (!order) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden max-h-[90vh] overflow-y-auto"
        >
          <div className="p-5 border-b border-gray-100 flex items-center justify-between bg-orange-50/60">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-orange-100 rounded-xl">
                <RefreshCw className="w-5 h-5 text-orange-600" />
              </div>
              <div>
                <h2 className="text-base font-bold text-gray-900">{currentLanguage === 'tr' ? 'İade Talebi' : 'Return Request'}</h2>
                <p className="text-xs text-gray-500">#{order.shopifyOrderId || order.id.slice(-8)} · {order.customerName}</p>
              </div>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-gray-200 rounded-full transition-colors">
              <X className="w-5 h-5 text-gray-500" />
            </button>
          </div>
          <div className="p-5 space-y-4">
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{currentLanguage === 'tr' ? 'İade Nedeni' : 'Return Reason'}</label>
              <select
                value={returnReason}
                onChange={e => setReturnReason(e.target.value)}
                className="apple-input w-full"
              >
                <option value="">{currentLanguage === 'tr' ? 'Sebep seçin...' : 'Select reason...'}</option>
                {[
                  currentLanguage === 'tr' ? 'Hasarlı ürün' : 'Damaged product',
                  currentLanguage === 'tr' ? 'Yanlış ürün gönderildi' : 'Wrong item shipped',
                  currentLanguage === 'tr' ? 'Müşteri vazgeçti' : 'Customer changed mind',
                  currentLanguage === 'tr' ? 'Kalite sorunu' : 'Quality issue',
                  currentLanguage === 'tr' ? 'Geç teslimat' : 'Late delivery',
                  currentLanguage === 'tr' ? 'Diğer' : 'Other',
                ].map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{currentLanguage === 'tr' ? 'İade Edilecek Ürünler / Açıklama' : 'Items to Return / Description'}</label>
              <textarea
                value={returnItems}
                onChange={e => setReturnItems(e.target.value)}
                className="apple-input w-full min-h-[72px] resize-none"
                placeholder={currentLanguage === 'tr' ? 'Ürün adları, miktarlar...' : 'Product names, quantities...'}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{currentLanguage === 'tr' ? 'İade Tutarı (₺)' : 'Refund Amount (₺)'}</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">₺</span>
                <input
                  type="number"
                  value={returnAmount}
                  onChange={e => setReturnAmount(Number(e.target.value))}
                  className="apple-input w-full pl-7"
                  max={order.totalPrice}
                />
              </div>
              <p className="text-[10px] text-gray-400">{currentLanguage === 'tr' ? 'Maks:' : 'Max:'} ₺{(order.totalPrice || 0).toLocaleString('tr-TR')}</p>
            </div>
          </div>
          <div className="p-5 border-t border-gray-100 flex justify-end gap-3 bg-gray-50/50">
            <button onClick={onClose} className="apple-button-secondary px-6">
              {currentLanguage === 'tr' ? 'İptal' : 'Cancel'}
            </button>
            <button
              disabled={!returnReason || returnSubmitting}
              onClick={async () => {
                if (!returnReason || !order) return;
                // İade tutarı 0 ile sipariş toplamı arasında olmalı (max= sadece UI ipucuydu).
                const maxRet = Number(order.totalPrice) || 0;
                if (returnAmount < 0 || returnAmount > maxRet + 0.01) {
                  onError(currentLanguage === 'tr' ? `İade tutarı 0 ile ₺${maxRet.toLocaleString('tr-TR')} arasında olmalı.` : `Refund must be between 0 and ${maxRet}.`);
                  return;
                }
                setReturnSubmitting(true);
                try {
                  await addDoc(collection(db, 'returns'), {
                    orderId: order.id,
                    orderNumber: order.shopifyOrderId || order.id.slice(-8),
                    customerName: order.customerName,
                    reason: returnReason,
                    items: returnItems,
                    refundAmount: returnAmount,
                    status: 'pending',
                    createdAt: serverTimestamp(),
                    createdBy: userEmail || 'guest',
                  });
                  // Update order status to indicate return pending
                  await updateDoc(doc(db, 'orders', order.id), { hasReturn: true, returnStatus: 'pending' });
                  onSuccess(currentLanguage === 'tr' ? 'İade talebi oluşturuldu.' : 'Return request created.');
                  onClose();
                } catch {
                  onError(currentLanguage === 'tr' ? 'Hata oluştu.' : 'Error.');
                }
                finally { setReturnSubmitting(false); }
              }}
              className="apple-button-primary px-8 flex items-center gap-2 disabled:opacity-50"
            >
              <RefreshCw className="w-4 h-4" />
              {returnSubmitting ? (currentLanguage === 'tr' ? 'Kaydediliyor...' : 'Saving...') : (currentLanguage === 'tr' ? 'İade Talebi Oluştur' : 'Submit Return')}
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
