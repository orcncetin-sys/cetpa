import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Plus, Search } from 'lucide-react';
import type { Lead, Shipment } from '../types';

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
  const [customerOpen, setCustomerOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setFormData(initialData || { status: 'Pending' });
      setCustomerSearch('');
      setCustomerOpen(false);
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
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              <input
                type="text"
                value={customerSearch}
                placeholder="Müşteri ara..."
                onChange={e => { setCustomerSearch(e.target.value); setCustomerOpen(true); }}
                onFocus={() => setCustomerOpen(true)}
                onBlur={() => setTimeout(() => setCustomerOpen(false), 200)}
                className="w-full pl-9 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm outline-none focus:border-brand transition-colors"
              />
              {customerOpen && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-100 rounded-xl shadow-xl z-20 max-h-44 overflow-y-auto">
                  {leads.filter(l => !customerSearch || l.name.toLowerCase().includes(customerSearch.toLowerCase()) || l.company?.toLowerCase().includes(customerSearch.toLowerCase())).slice(0, 6).map(lead => (
                    <button key={lead.id} type="button"
                      onMouseDown={() => {
                        setFormData({ ...formData, customerName: lead.name, destination: lead.company || '' });
                        setCustomerSearch(lead.name);
                        setCustomerOpen(false);
                      }}
                      className="w-full text-left px-4 py-2.5 hover:bg-gray-50 border-b border-gray-50 last:border-0">
                      <p className="text-sm font-semibold">{lead.name}</p>
                      <p className="text-[11px] text-[#86868B]">{lead.company} • {lead.phone}</p>
                    </button>
                  ))}
                  {leads.length === 0 && <p className="px-4 py-3 text-xs text-[#86868B]">Henüz müşteri yok</p>}
                </div>
              )}
            </div>
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
