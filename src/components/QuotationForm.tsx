import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'motion/react';
import { X, Plus, Trash2, Save, Search, Package, User, DollarSign, Calendar, FileText } from 'lucide-react';
import { collection, addDoc, updateDoc, doc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { formatInCurrency } from '../utils/currency';
import { type Lead, type InventoryItem, type Quotation, type QuotationItem } from '../types';

interface QuotationFormProps {
  isOpen: boolean;
  onClose: () => void;
  leads: Lead[];
  inventory: InventoryItem[];
  t: Record<string, string>;
  initialData?: Quotation;
}

export default function QuotationForm({ isOpen, onClose, leads = [], inventory = [], t = {}, initialData }: QuotationFormProps) {
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [lineItems, setLineItems] = useState<QuotationItem[]>([]);
  const [notes, setNotes] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [status, setStatus] = useState<'Draft' | 'Sent' | 'Accepted' | 'Rejected'>('Draft');
  const [currency, setCurrency] = useState<'TRY' | 'USD' | 'EUR'>('TRY');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [productSearch, setProductSearch] = useState('');

  useEffect(() => {
    if (initialData) {
      const lead = leads.find(l => l.id === initialData.leadId);
      setSelectedLead(lead || null);
      setLineItems(initialData.lineItems || initialData.items || []);
      setNotes(initialData.notes || '');
      setValidUntil((initialData.validUntil as string) || '');
      setStatus((initialData.status as 'Draft' | 'Sent' | 'Accepted' | 'Rejected') || 'Draft');
      setCurrency((initialData.currency as 'TRY' | 'USD' | 'EUR') || 'TRY');
    } else {
      setSelectedLead(null);
      setLineItems([]);
      setNotes('');
      setValidUntil('');
      setStatus('Draft');
      setCurrency('TRY');
    }
  }, [initialData, leads, isOpen]);

  const addLineItem = (product: InventoryItem) => {
    const existing = lineItems.find(item => item.inventoryId === product.id);
    const priceTier = selectedLead?.priceTier || 'Retail';
    const initialPrice = (product.prices as Record<string, number>)?.[priceTier] || product.price || 0;

    if (existing) {
      setLineItems(lineItems.map(item =>
        item.inventoryId === product.id
          ? { ...item, quantity: item.quantity + 1 }
          : item
      ));
    } else {
      setLineItems([...lineItems, {
        id: Math.random().toString(36).substr(2, 9),
        inventoryId: product.id,
        sku: product.sku,
        name: product.name,
        quantity: 1,
        price: initialPrice,
        vatRate: 20
      }]);
    }
  };

  const removeLineItem = (id: string) => {
    setLineItems(lineItems.filter(item => item.id !== id));
  };

  const updateLineItem = (id: string, updates: Partial<QuotationItem>) => {
    setLineItems(lineItems.map(item => item.id === id ? { ...item, ...updates } : item));
  };

  const totalAmount = lineItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  const totalVat = lineItems.reduce((sum, item) => sum + (item.price * item.quantity * (item.vatRate / 100)), 0);
  const grandTotal = totalAmount + totalVat;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedLead || lineItems.length === 0) return;

    setIsSubmitting(true);
    try {
      const quotationData = {
        leadId: selectedLead.id,
        customerName: selectedLead.name,
        customerEmail: selectedLead.email,
        lineItems,
        totalAmount: grandTotal,
        currency,
        notes,
        validUntil,
        status,
        updatedAt: serverTimestamp(),
      };

      if (initialData) {
        await updateDoc(doc(db, 'quotations', initialData.id), quotationData);
      } else {
        await addDoc(collection(db, 'quotations'), {
          ...quotationData,
          createdAt: serverTimestamp(),
        });
      }
      onClose();
    } catch (error) {
      console.error('Error saving quotation:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="bg-white rounded-3xl shadow-2xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col"
      >
        <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
          <div>
            <h2 className="text-xl font-bold text-gray-900">{initialData ? t.edit_quotation : t.new_quotation}</h2>
            <p className="text-sm text-gray-500">{t.quotation_form_desc || 'Teklif detaylarını aşağıdan düzenleyebilirsiniz.'}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-200 rounded-full transition-colors">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* Left Column: Customer & Basic Info */}
            <div className="space-y-6">
              <div className="space-y-2">
                <label className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                  <User className="w-4 h-4 text-brand" /> {t.customer || 'Müşteri'}
                </label>
                <select
                  required
                  value={selectedLead?.id || ''}
                  onChange={(e) => setSelectedLead(leads.find(l => l.id === e.target.value))}
                  className="apple-input w-full"
                >
                  <option value="">{t.select_customer || 'Müşteri Seçin'}</option>
                  {leads.map(lead => (
                    <option key={lead.id} value={lead.id}>{lead.name} {lead.company ? `(${lead.company})` : ''}{lead.priceTier ? ` — ${lead.priceTier}` : ''}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-brand" /> {t.valid_until || 'Geçerlilik Tarihi'}
                  </label>
                  <input
                    type="date"
                    required
                    value={validUntil}
                    onChange={(e) => setValidUntil(e.target.value)}
                    className="apple-input w-full"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                    <DollarSign className="w-4 h-4 text-brand" /> {t.currency || 'Para Birimi'}
                  </label>
                  <select
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value as 'TRY' | 'USD' | 'EUR')}
                    className="apple-input w-full"
                  >
                    <option value="TRY">TRY (₺)</option>
                    <option value="USD">USD ($)</option>
                    <option value="EUR">EUR (€)</option>
                  </select>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                  <FileText className="w-4 h-4 text-brand" /> {t.notes || 'Notlar'}
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="apple-input w-full h-24 resize-none"
                  placeholder={t.quotation_notes_placeholder || 'Teklif ile ilgili notlar...'}
                />
              </div>
            </div>

            {/* Right Column: Product Selection */}
            <div className="space-y-4">
              <label className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                <Package className="w-4 h-4 text-brand" /> {t.add_products || 'Ürün Ekle'}
              </label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  placeholder={t.search_product || 'Ürün ara...'}
                  className="apple-input pl-10 w-full"
                  value={productSearch}
                  onChange={(e) => setProductSearch(e.target.value)}
                />
              </div>
              <div className="border border-gray-100 rounded-2xl max-h-[300px] overflow-y-auto divide-y divide-gray-50 bg-white">
                {inventory.length === 0 ? (
                  <div className="p-8 text-center">
                    <Package className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                    <p className="text-sm text-gray-400 mb-3">{t.no_products || 'Henüz ürün eklenmedi.'}</p>
                    <p className="text-xs text-gray-400">{t.go_to_inventory || 'Ürün eklemek için Envanter modülüne gidin.'}</p>
                  </div>
                ) : (() => {
                  const filtered = inventory.filter(p =>
                    p.name?.toLowerCase().includes(productSearch.toLowerCase()) ||
                    p.sku?.toLowerCase().includes(productSearch.toLowerCase())
                  );
                  return filtered.length === 0 ? (
                    <div className="p-6 text-center text-sm text-gray-400 italic">
                      {t.no_product_found || 'Ürün bulunamadı.'}
                    </div>
                  ) : filtered.map(product => (
                    <div key={product.id} className="p-3 flex items-center justify-between hover:bg-gray-50 transition-colors group">
                      <div>
                        <p className="text-sm font-bold text-gray-900">{product.name}</p>
                        <p className="text-xs text-gray-500">SKU: {product.sku} • Stok: {product.stockLevel}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-bold text-brand">{formatInCurrency((selectedLead?.priceTier ? product.prices?.[selectedLead.priceTier as keyof typeof product.prices] : undefined) ?? product.prices?.['Retail'] ?? product.price ?? 0, currency)}</span>
                        <button
                          type="button"
                          onClick={() => addLineItem(product)}
                          className="p-1.5 bg-gray-100 text-gray-600 rounded-lg hover:bg-brand hover:text-white transition-all"
                        >
                          <Plus className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ));
                })()}
              </div>
            </div>
          </div>

          {/* Line Items Table */}
          <div className="space-y-4">
            <h3 className="text-lg font-bold text-gray-900">{t.quotation_items || 'Teklif İçeriği'}</h3>
            <div className="border border-gray-100 rounded-2xl overflow-hidden">
              <table className="w-full text-left border-collapse">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="p-4 text-xs font-bold text-gray-500 uppercase tracking-wider">{t.product || 'Ürün'}</th>
                    <th className="p-4 text-xs font-bold text-gray-500 uppercase tracking-wider w-24 text-center">{t.quantity || 'Miktar'}</th>
                    <th className="p-4 text-xs font-bold text-gray-500 uppercase tracking-wider w-32 text-right">{t.unit_price || 'Birim Fiyat'}</th>
                    <th className="p-4 text-xs font-bold text-gray-500 uppercase tracking-wider w-24 text-center">{t.vat || 'KDV %'}</th>
                    <th className="p-4 text-xs font-bold text-gray-500 uppercase tracking-wider w-32 text-right">{t.total || 'Toplam'}</th>
                    <th className="p-4 w-16"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {lineItems.map((item) => (
                    <tr key={item.id} className="hover:bg-gray-50/50 transition-colors">
                      <td className="p-4">
                        <p className="text-sm font-bold text-gray-900">{item.name}</p>
                        <p className="text-xs text-gray-500">{item.sku}</p>
                      </td>
                      <td className="p-4">
                        <input
                          type="number"
                          min="1"
                          value={item.quantity}
                          onChange={(e) => updateLineItem(item.id, { quantity: Number(e.target.value) })}
                          className="apple-input w-full text-center py-1 px-2"
                        />
                      </td>
                      <td className="p-4">
                        <input
                          type="number"
                          step="0.01"
                          value={item.price}
                          onChange={(e) => updateLineItem(item.id, { price: Number(e.target.value) })}
                          className="apple-input w-full text-right py-1 px-2"
                        />
                      </td>
                      <td className="p-4">
                        <select
                          value={item.vatRate}
                          onChange={(e) => updateLineItem(item.id, { vatRate: Number(e.target.value) })}
                          className="apple-input w-full text-center py-1 px-2"
                        >
                          <option value="0">0</option>
                          <option value="1">1</option>
                          <option value="10">10</option>
                          <option value="20">20</option>
                        </select>
                      </td>
                      <td className="p-4 text-right">
                        <p className="text-sm font-bold text-gray-900">
                          {formatInCurrency(item.price * item.quantity * (1 + item.vatRate / 100), currency)}
                        </p>
                      </td>
                      <td className="p-4 text-center">
                        <button
                          type="button"
                          onClick={() => removeLineItem(item.id)}
                          className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {lineItems.length === 0 && (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-gray-400 text-sm italic">
                        {t.no_items_added || 'Henüz ürün eklenmedi.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </form>

        <div className="p-6 border-t border-gray-100 bg-gray-50/50 flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="flex gap-8">
            <div className="text-center md:text-left">
              <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">{t.subtotal || 'Ara Toplam'}</p>
              <p className="text-lg font-bold text-gray-900">{formatInCurrency(totalAmount, currency)}</p>
            </div>
            <div className="text-center md:text-left">
              <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">{t.vat_total || 'KDV Toplam'}</p>
              <p className="text-lg font-bold text-gray-900">{formatInCurrency(totalVat, currency)}</p>
            </div>
            <div className="text-center md:text-left">
              <p className="text-xs font-bold text-brand uppercase tracking-wider">{t.grand_total || 'Genel Toplam'}</p>
              <p className="text-2xl font-black text-brand">{formatInCurrency(grandTotal, currency)}</p>
            </div>
          </div>
          <div className="flex gap-3 w-full md:w-auto">
            <button
              type="button"
              onClick={onClose}
              className="apple-button-secondary flex-1 md:flex-none px-8"
            >
              {t.cancel || 'İptal'}
            </button>
            <button
              onClick={handleSubmit}
              disabled={isSubmitting || !selectedLead || lineItems.length === 0}
              className="apple-button-primary flex-1 md:flex-none px-8 flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              {isSubmitting ? (t.saving || 'Kaydediliyor...') : (t.save_quotation || 'Teklifi Kaydet')}
            </button>
          </div>
        </div>
      </motion.div>
    </div>,
    document.body
  );
}

