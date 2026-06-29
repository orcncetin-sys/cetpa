import React from 'react';
import { motion } from 'motion/react';
import { X, FileDown } from 'lucide-react';
import { cn } from '../lib/utils';
import type { Lead, Order } from '../types';

interface CustomerStatementModalProps {
  leadId: string;
  onClose: () => void;
  leads: Lead[];
  orders: Order[];
  currentLanguage: 'tr' | 'en';
}

export default function CustomerStatementModal({
  leadId,
  onClose,
  leads,
  orders,
  currentLanguage
}: CustomerStatementModalProps) {
  const stmtLead = leads.find(l => l.id === leadId);
  const stmtOrders = orders.filter(o => o.leadId === leadId || o.customerName === stmtLead?.name);
  const totalRev = stmtOrders.reduce((s, o) => s + (o.totalPrice || 0), 0);
  const paidRev = stmtOrders.filter(o => o.paid).reduce((s, o) => s + (o.totalPrice || 0), 0);
  const unpaidRev = totalRev - paidRev;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between bg-gradient-to-r from-brand/5 to-transparent">
          <div>
            <p className="text-[10px] font-bold text-brand uppercase tracking-widest mb-0.5">
              {currentLanguage === 'tr' ? 'Hesap Ekstresi' : 'Account Statement'}
            </p>
            <h3 className="text-lg font-black text-gray-900">{stmtLead?.name || leadId}</h3>
            {stmtLead?.company && <p className="text-xs text-gray-400">{stmtLead.company}</p>}
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>
        
        {/* KPI strip */}
        <div className="grid grid-cols-3 gap-px bg-gray-100 shrink-0">
          {[
            { label: currentLanguage === 'tr' ? 'Toplam Ciro' : 'Total Revenue', value: totalRev, color: 'text-gray-900' },
            { label: currentLanguage === 'tr' ? 'Tahsil Edilen' : 'Collected', value: paidRev, color: 'text-emerald-600' },
            { label: currentLanguage === 'tr' ? 'Alacak' : 'Outstanding', value: unpaidRev, color: unpaidRev > 0 ? 'text-red-600' : 'text-gray-400' },
          ].map(k => (
            <div key={k.label} className="bg-white px-5 py-4">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">{k.label}</p>
              <p className={cn("text-lg font-black", k.color)}>₺{k.value.toLocaleString('tr-TR', { minimumFractionDigits: 0 })}</p>
            </div>
          ))}
        </div>
        
        {/* Order list */}
        <div className="overflow-y-auto flex-1">
          {stmtOrders.length === 0 ? (
            <div className="flex items-center justify-center h-40 text-gray-400 text-sm">
              {currentLanguage === 'tr' ? 'Sipariş bulunamadı' : 'No orders found'}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="px-5 py-3 text-left text-[10px] font-bold text-gray-400 uppercase tracking-wider">{currentLanguage === 'tr' ? 'Sipariş' : 'Order'}</th>
                  <th className="px-5 py-3 text-left text-[10px] font-bold text-gray-400 uppercase tracking-wider">{currentLanguage === 'tr' ? 'Tarih' : 'Date'}</th>
                  <th className="px-5 py-3 text-left text-[10px] font-bold text-gray-400 uppercase tracking-wider">{currentLanguage === 'tr' ? 'Durum' : 'Status'}</th>
                  <th className="px-5 py-3 text-right text-[10px] font-bold text-gray-400 uppercase tracking-wider">{currentLanguage === 'tr' ? 'Tutar' : 'Amount'}</th>
                  <th className="px-5 py-3 text-center text-[10px] font-bold text-gray-400 uppercase tracking-wider">{currentLanguage === 'tr' ? 'Ödeme' : 'Payment'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {stmtOrders.sort((a, b) => {
                  const ta = a.createdAt ? (typeof (a.createdAt as { toDate?: () => Date }).toDate === 'function' ? (a.createdAt as { toDate: () => Date }).toDate().getTime() : new Date(a.createdAt as string | number).getTime()) : 0;
                  const tb = b.createdAt ? (typeof (b.createdAt as { toDate?: () => Date }).toDate === 'function' ? (b.createdAt as { toDate: () => Date }).toDate().getTime() : new Date(b.createdAt as string | number).getTime()) : 0;
                  return tb - ta;
                }).map(o => {
                  const rawDate = o.createdAt ?? o.syncedAt;
                  const oDate = rawDate ? (typeof (rawDate as { toDate?: () => Date }).toDate === 'function' ? (rawDate as { toDate: () => Date }).toDate() : new Date(rawDate as string | number)) : null;
                  const statusColors: Record<string, string> = { Pending: 'bg-amber-50 text-amber-600', Processing: 'bg-purple-50 text-purple-600', Shipped: 'bg-blue-50 text-blue-600', Delivered: 'bg-emerald-50 text-emerald-600', Cancelled: 'bg-gray-100 text-gray-500' };
                  const statusTR: Record<string, string> = { Pending: 'Bekliyor', Processing: 'Hazırlanıyor', Shipped: 'Kargoda', Delivered: 'Teslim', Cancelled: 'İptal' };
                  return (
                    <tr key={o.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-5 py-3 font-medium text-gray-800">#{o.shopifyOrderId || o.id.slice(-6)}</td>
                      <td className="px-5 py-3 text-gray-500">{oDate?.toLocaleDateString('tr-TR') || '—'}</td>
                      <td className="px-5 py-3">
                        <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full", statusColors[o.status] || 'bg-gray-100 text-gray-500')}>
                          {currentLanguage === 'tr' ? (statusTR[o.status] || o.status) : o.status}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-right font-bold text-gray-900">₺{(o.totalPrice || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2 })}</td>
                      <td className="px-5 py-3 text-center">
                        <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full", o.paid ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-50 text-amber-600')}>
                          {o.paid ? (currentLanguage === 'tr' ? '✓ Ödendi' : '✓ Paid') : (currentLanguage === 'tr' ? '⏳ Bekliyor' : '⏳ Pending')}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        
        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3 bg-gray-50/50">
          <button
            onClick={async () => {
              if (stmtLead) {
                const { exportCustomerStatement } = await import('../utils/pdf');
                exportCustomerStatement(stmtLead, stmtOrders, currentLanguage);
              }
            }}
            className="apple-button-secondary flex items-center gap-2 text-sm"
          >
            <FileDown className="w-4 h-4" />
            {currentLanguage === 'tr' ? 'PDF İndir' : 'Download PDF'}
          </button>
          <button onClick={onClose} className="apple-button-primary text-sm px-5">
            {currentLanguage === 'tr' ? 'Kapat' : 'Close'}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
