import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { odemeTakipli, gorunenSiparisNo, siparisTarih } from '../utils/siparis';
import { CreditCard, X, CheckCircle2 } from 'lucide-react';
import type { Order } from '../types';
import type { Language } from '../translations';

interface OverduePanelProps {
  isOpen: boolean;
  onClose: () => void;
  orders: Order[];
  currentLanguage: Language;
  onMarkPaid: (order: Order) => void;
}

export default function OverduePanel({
  isOpen,
  onClose,
  orders,
  currentLanguage,
  onMarkPaid
}: OverduePanelProps) {
  if (!isOpen) return null;

  const nowMs538 = Date.now();
  // Yas hesabi paylasilan `siparisTarih` uzerinden (syncedAt -> createdAt -> orderDate).
  // Tarihi cozulemeyen kayit -1 doner ve listenin SONUNA duser; "bugun" varsayilmaz.
  const getAge = (o: Order): number => {
    const d = siparisTarih(o);
    if (!d) return -1;
    return Math.floor((Date.now() - d.getTime()) / 86400000);
  };

  // Mikro faturasindan turetilen siparislerde `paid` alani YOKTUR — tahsilat
  // gercegi Mikro cari hesabinda yasar. Suzgec olmadan bu kayitlar "gecikmis
  // alacak" olarak listeleniyordu: Dashboard rozeti (odemeTakipli'li) 4 derken
  // bu cekmece 359 kayit gosteriyordu (2026-09-04 denetimi).
  const overdueList = orders
    .filter(o => !o.paid && o.status !== 'Cancelled' && odemeTakipli(o))
    .sort((a, b) => getAge(b) - getAge(a));
    
  const totalOwed = overdueList.reduce((s, o) => s + (o.totalPrice ?? (o as any).totalAmount ?? 0), 0);

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[9998] flex items-stretch justify-end">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="flex-1 bg-black/30 backdrop-blur-[2px]"
          onClick={onClose}
        />
        {/* Drawer */}
        <motion.div
          initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
          transition={{ type: 'spring', damping: 28, stiffness: 300 }}
          className="w-full max-w-md bg-white shadow-2xl flex flex-col overflow-hidden"
        >
          {/* Header */}
          <div className="px-6 pt-6 pb-4 border-b border-gray-100 flex items-center gap-3">
            <div className="w-10 h-10 bg-red-100 rounded-2xl flex items-center justify-center shrink-0">
              <CreditCard className="w-5 h-5 text-red-600" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-black text-gray-900">
                {currentLanguage === 'tr' ? 'Vadesi Geçmiş Ödemeler' : 'Overdue Payments'}
              </h3>
              <p className="text-xs text-gray-400">
                {overdueList.length} {currentLanguage === 'tr' ? 'sipariş' : 'orders'} · ₺{totalOwed.toLocaleString('tr-TR', { maximumFractionDigits: 0 })} {currentLanguage === 'tr' ? 'toplam' : 'total'}
              </p>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
              <X className="w-4 h-4 text-gray-400" />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
            {overdueList.length === 0 ? (
              <div className="text-center py-12">
                <CheckCircle2 className="w-12 h-12 text-emerald-300 mx-auto mb-3" />
                <p className="text-gray-400 font-medium">
                  {currentLanguage === 'tr' ? 'Gecikmiş ödeme yok 🎉' : 'No overdue payments 🎉'}
                </p>
              </div>
            ) : overdueList.map(order => {
              const age = getAge(order);
              const isOld = age > 30;
              const amount = order.totalPrice ?? (order as any).totalAmount ?? 0;
              return (
                <div key={order.id} className={`rounded-2xl border p-4 ${isOld ? 'border-red-200 bg-red-50/50' : 'border-gray-200 bg-white'}`}>
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="font-bold text-sm text-gray-900 truncate">{order.customerName}</p>
                        <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-full shrink-0 ${isOld ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                          {age}{currentLanguage === 'tr' ? 'g' : 'd'}
                        </span>
                      </div>
                      <p className="text-[10px] text-gray-400">{gorunenSiparisNo(order)} · {order.status}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-black text-gray-900">₺{amount.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}</p>
                      <button
                        onClick={() => {
                          onClose();
                          onMarkPaid(order);
                        }}
                        className="text-[9px] font-bold text-emerald-600 hover:text-emerald-700 mt-1"
                      >
                        {currentLanguage === 'tr' ? '✓ Ödendi' : '✓ Mark Paid'}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Footer total */}
          {overdueList.length > 0 && (
            <div className="px-6 py-4 border-t border-gray-100 bg-gray-50/80 flex items-center justify-between">
              <span className="text-sm font-bold text-gray-500">{currentLanguage === 'tr' ? 'Toplam Alacak' : 'Total Receivable'}</span>
              <span className="text-lg font-black text-red-600">₺{totalOwed.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}</span>
            </div>
          )}
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
