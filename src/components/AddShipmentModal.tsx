import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Plus } from 'lucide-react';
import type { Lead, Shipment } from '../types';
import CustomerCombobox from './CustomerCombobox';

interface AddShipmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  leads: Lead[];
  initialData?: Partial<Shipment>;
  onSubmit: (data: Partial<Shipment>) => Promise<void>;
}

export default function AddShipmentModal({
  isOpen,
  onClose,
  leads,
  initialData,
  onSubmit
}: AddShipmentModalProps) {
  const [formData, setFormData] = useState<Partial<Shipment>>({ status: 'Pending' });
  const [customerSearch, setCustomerSearch] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setFormData(initialData || { status: 'Pending' });
      setCustomerSearch('');
    }
  }, [isOpen, initialData]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await onSubmit(formData);
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} 
        onClick={onClose} 
        className="absolute inset-0 bg-black/40 backdrop-blur-sm" 
      />
      <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }} 
        className="bg-white w-full max-w-lg rounded-2xl shadow-2xl relative z-10 overflow-hidden border border-gray-200">
        <div className="p-6 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-xl font-bold">{initialData?.id ? 'Sevkiyatı Düzenle' : 'Sevkiyat Ekle'}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <Plus className="w-6 h-6 rotate-45" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Customer picker with address auto-fill */}
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-gray-500 uppercase">Müşteri Seç</label>
            <CustomerCombobox
              leads={leads}
              value={customerSearch}
              onChange={setCustomerSearch}
              onSelect={lead => {
                setFormData({ ...formData, customerName: lead.name, destination: lead.company || '' });
                setCustomerSearch(lead.name);
              }}
              placeholder="Müşteri ara..."
              maxResults={6}
              blurDelayMs={200}
              inputClassName="w-full pl-9 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm outline-none focus:border-brand transition-colors"
              dropdownMaxHeightClass="max-h-44"
              renderSecondaryLine={lead => <>{lead.company} • {lead.phone}</>}
              emptyText="Henüz müşteri yok"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-gray-500 uppercase">Müşteri Adı</label>
              <input required value={formData.customerName || ''} onChange={e => setFormData({ ...formData, customerName: e.target.value })}
                className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-brand transition-colors" />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-gray-500 uppercase">Varış</label>
              <input required value={formData.destination || ''} onChange={e => setFormData({ ...formData, destination: e.target.value })}
                className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-brand transition-colors" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-gray-500 uppercase">Sürücü</label>
              <input required value={formData.driver || ''} onChange={e => setFormData({ ...formData, driver: e.target.value })}
                className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-brand transition-colors" />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-gray-500 uppercase">Kargo Firması</label>
              <input required value={formData.cargoFirm || ''} onChange={e => setFormData({ ...formData, cargoFirm: e.target.value })}
                className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-brand transition-colors" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-gray-500 uppercase">Tarih</label>
              <input required type="date" value={formData.date || ''} onChange={e => setFormData({ ...formData, date: e.target.value })}
                className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-brand transition-colors" />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-gray-500 uppercase">Durum</label>
              <select value={formData.status} onChange={e => setFormData({ ...formData, status: e.target.value as 'Pending' | 'In Transit' | 'Delivered' | 'Cancelled' })}
                className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-brand transition-colors">
                <option value="Pending">Pending</option>
                <option value="In Transit">In Transit</option>
                <option value="Delivered">Delivered</option>
                <option value="Cancelled">Cancelled</option>
              </select>
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-gray-500 uppercase">Takip No</label>
            <input required value={formData.trackingNo || ''} onChange={e => setFormData({ ...formData, trackingNo: e.target.value })}
              className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-brand transition-colors" />
          </div>
          <button type="submit" disabled={isSubmitting} className="apple-button-primary w-full mt-4">
            {isSubmitting ? 'Kaydediliyor...' : (initialData?.id ? 'Değişiklikleri Kaydet' : 'Sevkiyat Ekle')}
          </button>
        </form>
      </motion.div>
    </div>
  );
}
