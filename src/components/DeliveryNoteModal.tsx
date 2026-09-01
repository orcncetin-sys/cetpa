import React from 'react';
import { motion } from 'motion/react';
import { CheckCircle2 } from 'lucide-react';
import type { Order } from '../types';

interface DeliveryNoteModalProps {
  order: Order;
  deliveryNoteText: string;
  setDeliveryNoteText: (text: string) => void;
  onClose: () => void;
  onConfirm: () => void;
  currentLanguage: 'tr' | 'en';
}

export default function DeliveryNoteModal({
  order,
  deliveryNoteText,
  setDeliveryNoteText,
  onClose,
  onConfirm,
  currentLanguage
}: DeliveryNoteModalProps) {
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden max-h-[90vh] overflow-y-auto"
      >
        <div className="px-6 pt-6 pb-2 flex items-center gap-3">
          <div className="w-10 h-10 bg-emerald-100 rounded-2xl flex items-center justify-center shrink-0">
            <CheckCircle2 className="w-5 h-5 text-emerald-600" />
          </div>
          <div>
            <h3 className="font-black text-gray-900">{currentLanguage === 'tr' ? 'Teslim Onayı' : 'Confirm Delivery'}</h3>
            <p className="text-xs text-gray-400">#{order.shopifyOrderId || order.id.slice(-6)} · {order.customerName}</p>
          </div>
        </div>
        <div className="px-6 py-4 space-y-3">
          <p className="text-sm text-gray-600">
            {currentLanguage === 'tr' ? 'Siparişi teslim edildi olarak işaretlemek üzeresiniz. İsterseniz bir teslimat notu ekleyin.' : 'You are about to mark this order as delivered. Optionally add a delivery note.'}
          </p>
          <textarea
            value={deliveryNoteText}
            onChange={e => setDeliveryNoteText(e.target.value)}
            rows={3}
            placeholder={currentLanguage === 'tr' ? 'Teslimat notu (isteğe bağlı)…' : 'Delivery note (optional)…'}
            className="w-full text-sm bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 outline-none focus:ring-2 focus:ring-emerald-200 resize-none"
          />
        </div>
        <div className="px-6 pb-6 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 apple-button-secondary"
          >
            {currentLanguage === 'tr' ? 'İptal' : 'Cancel'}
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 bg-emerald-500 hover:bg-emerald-600 text-white font-bold py-2.5 rounded-full transition-colors flex items-center justify-center gap-2 text-sm"
          >
            <CheckCircle2 className="w-4 h-4" />
            {currentLanguage === 'tr' ? 'Teslim Edildi' : 'Mark Delivered'}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
