import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Plus } from 'lucide-react';
import type { Order } from '../types';

interface EditOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  order: Order | null;
  currentT: Record<string, string>;
  onSubmit: (updatedData: Partial<Order>) => Promise<void>;
}

export default function EditOrderModal({
  isOpen,
  onClose,
  order,
  currentT,
  onSubmit
}: EditOrderModalProps) {
  const [formData, setFormData] = useState<Partial<Order>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen && order) {
      setFormData(order);
    }
  }, [isOpen, order]);

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

  if (!isOpen || !order) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} 
        onClick={onClose} 
        className="absolute inset-0 bg-black/40 backdrop-blur-sm" 
      />
      <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }} 
        className="bg-white w-full max-w-lg rounded-2xl shadow-2xl relative z-10 overflow-hidden border border-gray-200 max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-xl font-bold">{currentT.edit_order}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <Plus className="w-6 h-6 rotate-45" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-gray-500 uppercase">{currentT.customer_name}</label>
              <input required value={formData.customerName || ''} onChange={e => setFormData({ ...formData, customerName: e.target.value })}
                className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-brand transition-colors" />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-gray-500 uppercase">{currentT.total_price}</label>
              <input required type="number" step="0.01" value={formData.totalPrice ?? ''} onChange={e => setFormData({ ...formData, totalPrice: parseFloat(e.target.value) })}
                className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-brand transition-colors" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-gray-500 uppercase">{currentT.tracking_number}</label>
              <input value={formData.trackingNumber || ''} onChange={e => setFormData({ ...formData, trackingNumber: e.target.value })}
                className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-brand transition-colors" />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-gray-500 uppercase">{currentT.status}</label>
              <select value={formData.status || 'Pending'} onChange={e => setFormData({ ...formData, status: e.target.value as Order['status'] })}
                className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-brand transition-colors">
                <option value="Pending">{currentT.pending}</option>
                <option value="Processing">{currentT.processing}</option>
                <option value="Shipped">{currentT.shipped}</option>
                <option value="Delivered">{currentT.delivered}</option>
                <option value="Cancelled">{currentT.cancelled}</option>
              </select>
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-gray-500 uppercase">{currentT.shipping_address}</label>
            <textarea value={formData.shippingAddress || ''} onChange={e => setFormData({ ...formData, shippingAddress: e.target.value })} rows={2}
              className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-brand transition-colors resize-none" />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-gray-500 uppercase">{currentT.notes}</label>
            <textarea value={formData.notes || ''} onChange={e => setFormData({ ...formData, notes: e.target.value })} rows={3}
              className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-brand transition-colors resize-none" />
          </div>
          <button type="submit" disabled={isSubmitting} className="apple-button-primary w-full mt-4">
            {isSubmitting ? '...' : currentT.save_changes}
          </button>
        </form>
      </motion.div>
    </div>
  );
}
