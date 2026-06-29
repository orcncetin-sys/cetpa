import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { CreditCard, X, Check } from 'lucide-react';
import type { Order } from '../types';
import type { Language } from '../translations';

export function cn(...classes: (string | undefined | null | false)[]) {
  return classes.filter(Boolean).join(' ');
}

interface PaymentMethodModalProps {
  order: Order | null;
  currentLanguage: Language;
  onClose: () => void;
  onConfirm: (method: NonNullable<Order['paymentMethod']>) => void;
}

export default function PaymentMethodModal({
  order,
  currentLanguage,
  onClose,
  onConfirm
}: PaymentMethodModalProps) {
  const [method, setMethod] = useState<NonNullable<Order['paymentMethod']>>('cash');

  if (!order) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden"
        >
          <div className="px-6 pt-6 pb-2 flex items-center gap-3">
            <div className="w-10 h-10 bg-emerald-100 rounded-2xl flex items-center justify-center shrink-0">
              <CreditCard className="w-5 h-5 text-emerald-600" />
            </div>
            <div>
              <h3 className="font-black text-gray-900">{currentLanguage === 'tr' ? 'Ödeme Al' : 'Record Payment'}</h3>
              <p className="text-xs text-gray-400">
                #{order.shopifyOrderId || order.id.slice(-6)} · {order.customerName}
                {' · '}₺{(order.totalPrice ?? (order as any).totalAmount ?? 0).toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
              </p>
            </div>
            <button onClick={onClose} className="ml-auto p-2 hover:bg-gray-100 rounded-full transition-colors">
              <X className="w-4 h-4 text-gray-400" />
            </button>
          </div>

          <div className="px-6 py-4">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-3">
              {currentLanguage === 'tr' ? 'Ödeme Yöntemi' : 'Payment Method'}
            </p>
            <div className="grid grid-cols-2 gap-2">
              {([
                { key: 'cash',          icon: '💵', label: currentLanguage === 'tr' ? 'Nakit'    : 'Cash'          },
                { key: 'bank_transfer', icon: '🏦', label: currentLanguage === 'tr' ? 'EFT/Havale' : 'Bank Transfer' },
                { key: 'credit_card',   icon: '💳', label: currentLanguage === 'tr' ? 'Kredi Kartı' : 'Credit Card'  },
                { key: 'check',         icon: '📄', label: currentLanguage === 'tr' ? 'Çek'       : 'Cheque'         },
                { key: 'other',         icon: '🔄', label: currentLanguage === 'tr' ? 'Diğer'     : 'Other'          },
              ] as { key: NonNullable<Order['paymentMethod']>; icon: string; label: string }[]).map(opt => (
                <button
                  key={opt.key}
                  onClick={() => setMethod(opt.key)}
                  className={cn(
                    "flex items-center gap-2.5 px-4 py-3 rounded-2xl border-2 text-sm font-semibold transition-all",
                    method === opt.key
                      ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                      : "border-gray-100 bg-gray-50 text-gray-600 hover:border-emerald-200"
                  )}
                >
                  <span className="text-lg leading-none">{opt.icon}</span>
                  <span className="text-xs">{opt.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="px-6 pb-6 flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 apple-button-secondary"
            >
              {currentLanguage === 'tr' ? 'İptal' : 'Cancel'}
            </button>
            <button
              type="button"
              onClick={() => onConfirm(method)}
              className="flex-1 bg-emerald-500 hover:bg-emerald-600 text-white font-bold py-2.5 rounded-full transition-colors flex items-center justify-center gap-2 text-sm"
            >
              <Check className="w-4 h-4" />
              {currentLanguage === 'tr' ? 'Ödemeyi Onayla' : 'Confirm Payment'}
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
