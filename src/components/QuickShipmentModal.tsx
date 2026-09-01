import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Truck, X } from 'lucide-react';
import { collection, addDoc, serverTimestamp } from '../lib/dbClient';
import { db } from '../firebase';
import type { Order } from '../types';
import type { Language } from '../translations';

interface QuickShipmentModalProps {
  order: Order | null;
  onClose: () => void;
  currentLanguage: Language;
  onSuccess: (msg: string) => void;
}

export default function QuickShipmentModal({
  order,
  onClose,
  currentLanguage,
  onSuccess
}: QuickShipmentModalProps) {
  if (!order) return null;

  const today = new Date().toISOString().slice(0, 10);

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden max-h-[90vh] overflow-y-auto"
        >
          <div className="px-6 pt-6 pb-2 flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-100 rounded-2xl flex items-center justify-center shrink-0">
              <Truck className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <h3 className="font-black text-gray-900">{currentLanguage === 'tr' ? 'Hızlı Sevkiyat' : 'Quick Shipment'}</h3>
              <p className="text-xs text-gray-400">#{order.shopifyOrderId || order.id.slice(-6)} · {order.customerName}</p>
            </div>
            <button onClick={onClose} className="ml-auto p-2 hover:bg-gray-100 rounded-full transition-colors"><X className="w-4 h-4 text-gray-400" /></button>
          </div>
          <form
            className="px-6 py-4 space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              try {
                await addDoc(collection(db, 'shipments'), {
                  customerName: order.customerName,
                  orderId: order.id,
                  destination: fd.get('destination') || order.shippingAddress || '',
                  cargoFirm: fd.get('cargoFirm') || '',
                  driver: fd.get('driver') || '',
                  date: fd.get('date') || today,
                  status: 'Pending',
                  trackingNo: fd.get('trackingNo') || order.trackingNumber || '',
                  createdAt: serverTimestamp(),
                });
                onSuccess(currentLanguage === 'tr' ? 'Sevkiyat oluşturuldu ✓' : 'Shipment created ✓');
                onClose();
              } catch (err) { console.error(err); }
            }}
          >
            {[
              { name: 'destination', label: currentLanguage === 'tr' ? 'Adres' : 'Destination', defaultValue: order.shippingAddress || '' },
              { name: 'cargoFirm',   label: currentLanguage === 'tr' ? 'Kargo Firması' : 'Cargo Company', defaultValue: order.cargoCompany || '' },
              { name: 'driver',      label: currentLanguage === 'tr' ? 'Sürücü' : 'Driver', defaultValue: '' },
              { name: 'trackingNo',  label: currentLanguage === 'tr' ? 'Takip No' : 'Tracking No', defaultValue: order.trackingNumber || '' },
              { name: 'date',        label: currentLanguage === 'tr' ? 'Tarih' : 'Date', defaultValue: today, type: 'date' },
            ].map(f => (
              <div key={f.name}>
                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">{f.label}</label>
                <input
                  name={f.name}
                  type={f.type || 'text'}
                  defaultValue={f.defaultValue}
                  className="w-full text-sm bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 outline-none focus:border-brand"
                />
              </div>
            ))}
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={onClose} className="flex-1 apple-button-secondary">{currentLanguage === 'tr' ? 'İptal' : 'Cancel'}</button>
              <button type="submit" className="flex-1 bg-blue-500 hover:bg-blue-600 text-white font-bold py-2.5 rounded-full transition-colors flex items-center justify-center gap-2 text-sm">
                <Truck className="w-4 h-4" />
                {currentLanguage === 'tr' ? 'Sevkiyat Oluştur' : 'Create Shipment'}
              </button>
            </div>
          </form>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
