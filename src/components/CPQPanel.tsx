/**
 * CPQPanel — Configure-Price-Quote
 * Gap vs competitors: Odoo CPQ, SAP B1 Configurator, HubSpot CPQ, Zoho CPQ
 *
 * Features:
 *  - Product templates with selectable options/attributes (e.g. boyut, renk, malzeme)
 *  - Rules engine: option selection auto-adjusts base price (adder/multiplier)
 *  - BOM auto-generation from selected configuration
 *  - One-click → create quotation with configured line items
 *  - Saved configurations reuse
 */

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Settings, Plus, X, ChevronDown, FileText,
  Layers, Check, Trash2, Edit2
} from 'lucide-react';
import {
  collection, addDoc, updateDoc, deleteDoc, doc,
  onSnapshot, serverTimestamp
} from '../lib/dbClient';
import { db } from '../firebase';
import { sortByCreatedAt } from '../utils/fsSort';
import ModuleHeader from './ModuleHeader';

// ─── Types ─────────────────────────────────────────────────────────────────

interface AttributeOption {
  label: string;        // displayed name
  priceDelta: number;   // added to base price
  priceMultiplier: number; // multiply subtotal after delta (1 = no change)
  sku?: string;
}

interface Attribute {
  name: string;
  required: boolean;
  options: AttributeOption[];
}

interface ProductTemplate {
  id: string;
  name: string;
  description: string;
  basePrice: number;
  currency: string;
  category: string;
  attributes: Attribute[];
  minQty: number;
  createdAt?: unknown;
}

interface ConfiguredItem {
  templateId: string;
  templateName: string;
  selectedOptions: Record<string, string>;  // attributeName → optionLabel
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  sku: string;
}

interface CPQQuote {
  id: string;
  quoteNumber: string;
  customerName: string;
  validUntil: string;
  items: ConfiguredItem[];
  totalAmount: number;
  notes: string;
  status: 'Taslak' | 'Gönderildi' | 'Onaylandı' | 'Reddedildi';
  createdAt?: unknown;
}

interface Props {
  currentLanguage: string;
  isAuthenticated: boolean;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function calcConfiguredPrice(template: ProductTemplate, selectedOptions: Record<string, string>): number {
  let price = template.basePrice;
  template.attributes.forEach(attr => {
    const selected = selectedOptions[attr.name];
    const option = attr.options.find(o => o.label === selected);
    if (option) {
      price += option.priceDelta;
      price *= option.priceMultiplier;
    }
  });
  return Math.round(price * 100) / 100;
}

function buildSku(template: ProductTemplate, selectedOptions: Record<string, string>): string {
  const parts = [template.name.replace(/\s+/g, '-').toUpperCase().slice(0, 6)];
  template.attributes.forEach(attr => {
    const selected = selectedOptions[attr.name];
    const option = attr.options.find(o => o.label === selected);
    if (option?.sku) parts.push(option.sku);
    else if (selected) parts.push(selected.slice(0, 3).toUpperCase());
  });
  return parts.join('-');
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function AttributeEditor({ attr, index, onChange, onDelete }: {
  attr: Attribute;
  index: number;
  onChange: (updated: Attribute) => void;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(true);
  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-gray-50 cursor-pointer" onClick={() => setExpanded(e => !e)}>
        <div className="flex items-center gap-2">
          <ChevronDown className={`w-3.5 h-3.5 text-gray-400 transition-transform ${expanded ? '' : '-rotate-90'}`} />
          <span className="text-sm font-semibold text-gray-700">{attr.name || 'Özellik'}</span>
          <span className="text-xs text-gray-400">{attr.options.length} seçenek</span>
          {attr.required && <span className="text-[10px] bg-red-50 text-red-500 font-bold px-1.5 py-0.5 rounded">Zorunlu</span>}
        </div>
        <button onClick={e => { e.stopPropagation(); onDelete(); }} className="p-1 hover:bg-red-50 rounded-lg">
          <Trash2 className="w-3.5 h-3.5 text-red-400" />
        </button>
      </div>
      {expanded && (
        <div className="p-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <input value={attr.name} onChange={e => onChange({ ...attr, name: e.target.value })}
              placeholder="Özellik adı (ör: Boyut)" className="apple-input px-2 py-1.5 text-xs" />
            <label className="flex items-center gap-2 text-xs text-gray-600">
              <input type="checkbox" checked={attr.required} onChange={e => onChange({ ...attr, required: e.target.checked })} />
              Zorunlu seçim
            </label>
          </div>
          {attr.options.map((opt, oi) => (
            <div key={oi} className="grid grid-cols-12 gap-1.5 items-center bg-gray-50 rounded-lg p-1.5">
              <input value={opt.label} onChange={e => onChange({ ...attr, options: attr.options.map((o, i) => i === oi ? { ...o, label: e.target.value } : o) })}
                placeholder="Etiket" className="col-span-4 apple-input px-2 py-1 text-xs" />
              <div className="col-span-3 flex items-center gap-1">
                <span className="text-[10px] text-gray-400">+₺</span>
                <input type="number" value={opt.priceDelta} onChange={e => onChange({ ...attr, options: attr.options.map((o, i) => i === oi ? { ...o, priceDelta: parseFloat(e.target.value) || 0 } : o) })}
                  className="apple-input px-1.5 py-1 text-xs w-full" />
              </div>
              <div className="col-span-2 flex items-center gap-1">
                <span className="text-[10px] text-gray-400">×</span>
                <input type="number" step="0.01" value={opt.priceMultiplier} onChange={e => onChange({ ...attr, options: attr.options.map((o, i) => i === oi ? { ...o, priceMultiplier: parseFloat(e.target.value) || 1 } : o) })}
                  className="apple-input px-1.5 py-1 text-xs w-full" />
              </div>
              <input value={opt.sku ?? ''} onChange={e => onChange({ ...attr, options: attr.options.map((o, i) => i === oi ? { ...o, sku: e.target.value } : o) })}
                placeholder="SKU" className="col-span-2 apple-input px-1.5 py-1 text-xs" />
              <button onClick={() => onChange({ ...attr, options: attr.options.filter((_, i) => i !== oi) })} className="col-span-1">
                <X className="w-3 h-3 text-red-400" />
              </button>
            </div>
          ))}
          <button onClick={() => onChange({ ...attr, options: [...attr.options, { label: '', priceDelta: 0, priceMultiplier: 1, sku: '' }] })}
            className="text-xs text-brand font-semibold flex items-center gap-1">
            <Plus className="w-3 h-3" /> Seçenek Ekle
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Main component ─────────────────────────────────────────────────────────

export default function CPQPanel({ currentLanguage, isAuthenticated }: Props) {
  const tr = currentLanguage === 'tr';

  const [templates, setTemplates] = useState<ProductTemplate[]>([]);
  const [quotes, setQuotes] = useState<CPQQuote[]>([]);

  // UI state
  const [view, setView] = useState<'templates' | 'configurator' | 'quotes'>('templates');
  const [showTemplateForm, setShowTemplateForm] = useState(false);
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);

  // Configurator
  const [configTemplate, setConfigTemplate] = useState<ProductTemplate | null>(null);
  const [configOptions, setConfigOptions] = useState<Record<string, string>>({});
  const [configQty, setConfigQty] = useState(1);
  const [cartItems, setCartItems] = useState<ConfiguredItem[]>([]);
  const [quoteCustomer, setQuoteCustomer] = useState('');
  const [quoteValidDays, setQuoteValidDays] = useState(30);
  const [quoteNotes, setQuoteNotes] = useState('');

  const emptyTemplate: Omit<ProductTemplate, 'id' | 'createdAt'> = {
    name: '', description: '', basePrice: 0, currency: 'TRY',
    category: '', attributes: [], minQty: 1,
  };
  const [templateDraft, setTemplateDraft] = useState(emptyTemplate);

  // ── Firestore ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const u1 = onSnapshot(collection(db, 'cpqTemplates'), snap => {
      setTemplates(sortByCreatedAt(snap.docs.map(d => ({ id: d.id, ...d.data() } as ProductTemplate))));
    });
    const u2 = onSnapshot(collection(db, 'cpqQuotes'), snap => {
      setQuotes(sortByCreatedAt(snap.docs.map(d => ({ id: d.id, ...d.data() } as CPQQuote))));
    });
    return () => { u1(); u2(); };
  }, []);

  // ── Configured price ──────────────────────────────────────────────────────
  const configuredPrice = configTemplate ? calcConfiguredPrice(configTemplate, configOptions) : 0;

  const addToCart = () => {
    if (!configTemplate) return;
    const item: ConfiguredItem = {
      templateId: configTemplate.id,
      templateName: configTemplate.name,
      selectedOptions: configOptions,
      quantity: configQty,
      unitPrice: configuredPrice,
      totalPrice: configuredPrice * configQty,
      sku: buildSku(configTemplate, configOptions),
    };
    setCartItems(prev => [...prev, item]);
    setConfigTemplate(null);
    setConfigOptions({});
    setConfigQty(1);
    setView('quotes');
  };

  const createQuote = async () => {
    if (!quoteCustomer.trim() || cartItems.length === 0) return;
    const total = cartItems.reduce((s, i) => s + i.totalPrice, 0);
    const validUntil = new Date(Date.now() + quoteValidDays * 86400000).toISOString().slice(0, 10);
    const qNum = `CPQ-${Date.now().toString(36).toUpperCase()}`;
    await addDoc(collection(db, 'cpqQuotes'), {
      quoteNumber: qNum, customerName: quoteCustomer, validUntil,
      items: cartItems, totalAmount: total, notes: quoteNotes,
      status: 'Taslak', createdAt: serverTimestamp(),
    });
    setCartItems([]); setQuoteCustomer(''); setQuoteNotes('');
  };

  const saveTemplate = async () => {
    if (!templateDraft.name.trim()) return;
    if (editingTemplateId) {
      await updateDoc(doc(db, 'cpqTemplates', editingTemplateId), templateDraft);
    } else {
      await addDoc(collection(db, 'cpqTemplates'), { ...templateDraft, createdAt: serverTimestamp() });
    }
    setShowTemplateForm(false);
    setEditingTemplateId(null);
    setTemplateDraft(emptyTemplate);
  };

  const fmtTRY = (v: number) => `₺${v.toLocaleString('tr-TR', { maximumFractionDigits: 2 })}`;

  return (
    <div className="space-y-4">
      <ModuleHeader
        title={tr ? 'CPQ — Yapılandırılabilir Teklif' : 'CPQ — Configure, Price, Quote'}
        subtitle={tr ? 'Seçenekli ürün yapılandırıcı, otomatik fiyatlama ve teklif oluşturma motoru' : 'Product configurator with option-based pricing and quote generation'}
        icon={Settings}
      />

      {/* Tab switcher */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
        {[
          { id: 'templates', label: tr ? 'Ürün Şablonları' : 'Product Templates', icon: Layers },
          { id: 'configurator', label: tr ? 'Yapılandırıcı' : 'Configurator', icon: Settings },
          { id: 'quotes', label: tr ? `Teklifler (${quotes.length})` : `Quotes (${quotes.length})`, icon: FileText },
        ].map(t => (
          <button key={t.id} onClick={() => setView(t.id as typeof view)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all
              ${view === t.id ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
            <t.icon className="w-3.5 h-3.5" />{t.label}
          </button>
        ))}
      </div>

      {/* ── Templates view ─────────────────────────────────────────────── */}
      {view === 'templates' && (
        <div className="space-y-4">
          {isAuthenticated && (
            <button onClick={() => { setShowTemplateForm(true); setEditingTemplateId(null); setTemplateDraft(emptyTemplate); }}
              className="apple-button-primary px-4 py-2 text-sm flex items-center gap-1.5">
              <Plus className="w-3.5 h-3.5" />{tr ? 'Ürün Şablonu Ekle' : 'Add Product Template'}
            </button>
          )}

          <AnimatePresence>
            {showTemplateForm && (
              <motion.div key="tform" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                className="apple-card p-5 border-2 border-brand/20 space-y-4">
                <div className="flex justify-between">
                  <h4 className="font-bold text-gray-800">{tr ? 'Yeni Ürün Şablonu' : 'New Product Template'}</h4>
                  <button onClick={() => setShowTemplateForm(false)}><X className="w-4 h-4 text-gray-400" /></button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <input value={templateDraft.name} onChange={e => setTemplateDraft(d => ({ ...d, name: e.target.value }))}
                    placeholder={tr ? 'Şablon adı' : 'Template name'} className="apple-input px-3 py-2 text-sm" />
                  <input value={templateDraft.category} onChange={e => setTemplateDraft(d => ({ ...d, category: e.target.value }))}
                    placeholder={tr ? 'Kategori' : 'Category'} className="apple-input px-3 py-2 text-sm" />
                  <input type="number" value={templateDraft.basePrice} onChange={e => setTemplateDraft(d => ({ ...d, basePrice: parseFloat(e.target.value) || 0 }))}
                    placeholder={tr ? 'Baz Fiyat (₺)' : 'Base Price (₺)'} className="apple-input px-3 py-2 text-sm" />
                  <input type="number" min={1} value={templateDraft.minQty} onChange={e => setTemplateDraft(d => ({ ...d, minQty: parseInt(e.target.value) || 1 }))}
                    placeholder={tr ? 'Min. Miktar' : 'Min. Qty'} className="apple-input px-3 py-2 text-sm" />
                  <textarea value={templateDraft.description} onChange={e => setTemplateDraft(d => ({ ...d, description: e.target.value }))}
                    placeholder={tr ? 'Açıklama' : 'Description'} className="apple-input px-3 py-2 text-sm md:col-span-2 resize-none" rows={2} />
                </div>

                {/* Attributes */}
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <p className="text-sm font-bold text-gray-700">{tr ? 'Özellikler / Seçenekler' : 'Attributes / Options'}</p>
                    <button onClick={() => setTemplateDraft(d => ({ ...d, attributes: [...d.attributes, { name: '', required: false, options: [] }] }))}
                      className="text-xs text-brand font-semibold flex items-center gap-1">
                      <Plus className="w-3 h-3" />{tr ? 'Özellik Ekle' : 'Add Attribute'}
                    </button>
                  </div>
                  <div className="space-y-2">
                    {templateDraft.attributes.map((attr, i) => (
                      <AttributeEditor key={i} attr={attr} index={i}
                        onChange={updated => setTemplateDraft(d => ({ ...d, attributes: d.attributes.map((a, j) => j === i ? updated : a) }))}
                        onDelete={() => setTemplateDraft(d => ({ ...d, attributes: d.attributes.filter((_, j) => j !== i) }))}
                      />
                    ))}
                  </div>
                </div>

                <div className="flex gap-2">
                  <button onClick={saveTemplate} className="apple-button-primary px-4 py-2 text-sm">
                    {editingTemplateId ? (tr ? 'Güncelle' : 'Update') : (tr ? 'Şablonu Kaydet' : 'Save Template')}
                  </button>
                  <button onClick={() => setShowTemplateForm(false)} className="apple-button-secondary px-4 py-2 text-sm">{tr ? 'İptal' : 'Cancel'}</button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {templates.map(t => (
              <div key={t.id} className="apple-card p-4 space-y-3">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-bold text-gray-900 text-sm">{t.name}</p>
                    {t.category && <p className="text-xs text-gray-400">{t.category}</p>}
                  </div>
                  <p className="font-bold text-brand text-sm">{fmtTRY(t.basePrice)}</p>
                </div>
                {t.description && <p className="text-xs text-gray-500">{t.description}</p>}
                <div className="flex flex-wrap gap-1">
                  {t.attributes.map(a => (
                    <span key={a.name} className="text-[10px] font-semibold px-2 py-0.5 bg-blue-50 text-blue-700 rounded-full">
                      {a.name} ({a.options.length})
                    </span>
                  ))}
                </div>
                <div className="flex gap-2">
                  <button onClick={() => { setConfigTemplate(t); setConfigOptions({}); setConfigQty(t.minQty); setView('configurator'); }}
                    className="flex-1 apple-button-primary px-3 py-1.5 text-xs text-center">
                    {tr ? 'Yapılandır' : 'Configure'}
                  </button>
                  {isAuthenticated && (
                    <>
                      <button onClick={() => { setTemplateDraft({ name: t.name, description: t.description, basePrice: t.basePrice, currency: t.currency, category: t.category, attributes: t.attributes, minQty: t.minQty }); setEditingTemplateId(t.id); setShowTemplateForm(true); }}
                        className="p-1.5 rounded-xl hover:bg-gray-100"><Edit2 className="w-3.5 h-3.5 text-gray-400" /></button>
                      <button onClick={() => deleteDoc(doc(db, 'cpqTemplates', t.id))}
                        className="p-1.5 rounded-xl hover:bg-red-50"><Trash2 className="w-3.5 h-3.5 text-red-400" /></button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>

          {templates.length === 0 && !showTemplateForm && (
            <div className="apple-card p-12 text-center space-y-3">
              <Layers className="w-12 h-12 text-gray-200 mx-auto" />
              <p className="font-semibold text-gray-500">{tr ? 'Henüz ürün şablonu yok' : 'No product templates yet'}</p>
              <p className="text-sm text-gray-400 max-w-sm mx-auto">
                {tr ? 'Özellik seçenekli ürün şablonları oluşturun — boyut, renk, malzeme gibi seçenekler fiyatı otomatik günceller.' : 'Create templates with selectable options — size, color, material — prices update automatically.'}
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── Configurator view ───────────────────────────────────────────── */}
      {view === 'configurator' && (
        <div className="space-y-4">
          {!configTemplate ? (
            <div className="apple-card p-8 text-center space-y-3">
              <Settings className="w-10 h-10 text-gray-200 mx-auto" />
              <p className="text-gray-500 text-sm">{tr ? 'Yapılandırmak için şablon seçin' : 'Select a template to configure'}</p>
              <div className="flex flex-wrap justify-center gap-2">
                {templates.map(t => (
                  <button key={t.id} onClick={() => { setConfigTemplate(t); setConfigOptions({}); setConfigQty(t.minQty); }}
                    className="apple-button-secondary px-4 py-2 text-sm">{t.name}</button>
                ))}
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* Options panel */}
              <div className="lg:col-span-2 space-y-4">
                <div className="apple-card p-4">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <p className="font-bold text-gray-900">{configTemplate.name}</p>
                      <p className="text-xs text-gray-500">{tr ? 'Baz fiyat:' : 'Base price:'} {fmtTRY(configTemplate.basePrice)}</p>
                    </div>
                    <button onClick={() => setConfigTemplate(null)} className="apple-button-secondary px-3 py-1.5 text-xs">{tr ? 'Değiştir' : 'Change'}</button>
                  </div>

                  {configTemplate.attributes.map(attr => (
                    <div key={attr.name} className="mb-4">
                      <p className="text-sm font-semibold text-gray-700 mb-2">
                        {attr.name} {attr.required && <span className="text-red-400 text-xs">*</span>}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {attr.options.map(opt => {
                          const isSelected = configOptions[attr.name] === opt.label;
                          return (
                            <button key={opt.label}
                              onClick={() => setConfigOptions(p => ({ ...p, [attr.name]: opt.label }))}
                              className={`px-3 py-1.5 rounded-xl text-sm font-medium border-2 transition-all ${isSelected ? 'border-brand bg-brand/5 text-brand' : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}>
                              {opt.label}
                              {opt.priceDelta !== 0 && (
                                <span className={`ml-1 text-xs ${opt.priceDelta > 0 ? 'text-brand' : 'text-green-600'}`}>
                                  {opt.priceDelta > 0 ? `+${fmtTRY(opt.priceDelta)}` : fmtTRY(opt.priceDelta)}
                                </span>
                              )}
                              {isSelected && <Check className="inline w-3.5 h-3.5 ml-1" />}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}

                  <div className="flex items-center gap-3 mt-4">
                    <label className="text-sm font-medium text-gray-700">{tr ? 'Miktar' : 'Qty'}</label>
                    <input type="number" value={configQty} min={configTemplate.minQty}
                      onChange={e => setConfigQty(Math.max(configTemplate.minQty, parseInt(e.target.value) || 1))}
                      className="apple-input px-3 py-2 text-sm w-24" />
                  </div>
                </div>
              </div>

              {/* Price summary */}
              <div className="space-y-4">
                <div className="apple-card p-4 space-y-3">
                  <p className="font-bold text-gray-800 text-sm">{tr ? 'Fiyat Özeti' : 'Price Summary'}</p>
                  <div className="space-y-1.5 text-sm">
                    <div className="flex justify-between text-gray-500">
                      <span>{tr ? 'Baz Fiyat' : 'Base Price'}</span>
                      <span>{fmtTRY(configTemplate.basePrice)}</span>
                    </div>
                    {configTemplate.attributes.map(attr => {
                      const opt = attr.options.find(o => o.label === configOptions[attr.name]);
                      if (!opt || opt.priceDelta === 0) return null;
                      return (
                        <div key={attr.name} className="flex justify-between text-gray-500">
                          <span>{attr.name}: {opt.label}</span>
                          <span className={opt.priceDelta > 0 ? 'text-brand' : 'text-green-600'}>
                            {opt.priceDelta > 0 ? '+' : ''}{fmtTRY(opt.priceDelta)}
                          </span>
                        </div>
                      );
                    })}
                    <div className="border-t border-gray-100 pt-2 flex justify-between font-bold text-gray-900">
                      <span>{tr ? 'Birim Fiyat' : 'Unit Price'}</span>
                      <span>{fmtTRY(configuredPrice)}</span>
                    </div>
                    <div className="flex justify-between text-gray-500">
                      <span>{tr ? 'Miktar' : 'Quantity'}</span>
                      <span>{configQty}</span>
                    </div>
                    <div className="bg-brand/5 rounded-xl p-2 flex justify-between font-bold text-brand">
                      <span>{tr ? 'Toplam' : 'Total'}</span>
                      <span>{fmtTRY(configuredPrice * configQty)}</span>
                    </div>
                  </div>
                  {/* SKU preview */}
                  <div className="bg-gray-50 rounded-lg p-2">
                    <p className="text-[10px] text-gray-400 uppercase font-bold mb-0.5">SKU</p>
                    <p className="text-xs font-mono text-gray-700">{buildSku(configTemplate, configOptions)}</p>
                  </div>
                  <button onClick={addToCart} className="w-full apple-button-primary py-2 text-sm">
                    {tr ? 'Teklife Ekle' : 'Add to Quote'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Quotes view ──────────────────────────────────────────────────── */}
      {view === 'quotes' && (
        <div className="space-y-4">
          {/* Cart / build quote */}
          {cartItems.length > 0 && (
            <div className="apple-card p-5 border-2 border-brand/20 space-y-4">
              <h4 className="font-bold text-gray-800">{tr ? 'Teklif Oluştur' : 'Create Quote'}</h4>
              <div className="space-y-2">
                {cartItems.map((item, i) => (
                  <div key={i} className="flex items-center justify-between bg-gray-50 rounded-xl p-3">
                    <div>
                      <p className="font-semibold text-gray-800 text-sm">{item.templateName}</p>
                      <p className="text-xs text-gray-400">
                        {Object.entries(item.selectedOptions).map(([k, v]) => `${k}: ${v}`).join(' • ')}
                      </p>
                      <p className="text-xs text-gray-400">{tr ? 'SKU:' : 'SKU:'} {item.sku}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-gray-900">{fmtTRY(item.totalPrice)}</p>
                      <p className="text-xs text-gray-400">{item.quantity}× {fmtTRY(item.unitPrice)}</p>
                    </div>
                    <button onClick={() => setCartItems(prev => prev.filter((_, j) => j !== i))} className="ml-3 p-1 hover:bg-red-50 rounded-lg">
                      <X className="w-3.5 h-3.5 text-red-400" />
                    </button>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <input value={quoteCustomer} onChange={e => setQuoteCustomer(e.target.value)}
                  placeholder={tr ? 'Müşteri adı' : 'Customer name'} className="apple-input px-3 py-2 text-sm" />
                <div className="flex items-center gap-2">
                  <label className="text-xs text-gray-500 whitespace-nowrap">{tr ? 'Geçerlilik (gün)' : 'Valid days'}</label>
                  <input type="number" value={quoteValidDays} onChange={e => setQuoteValidDays(parseInt(e.target.value) || 30)}
                    className="apple-input px-3 py-2 text-sm w-20" />
                </div>
                <textarea value={quoteNotes} onChange={e => setQuoteNotes(e.target.value)}
                  placeholder={tr ? 'Notlar' : 'Notes'} className="apple-input px-3 py-2 text-sm md:col-span-2 resize-none" rows={2} />
              </div>
              <div className="flex items-center justify-between">
                <p className="font-bold text-gray-900">
                  {tr ? 'Toplam:' : 'Total:'} {fmtTRY(cartItems.reduce((s, i) => s + i.totalPrice, 0))}
                </p>
                <button onClick={createQuote} className="apple-button-primary px-5 py-2 text-sm">
                  {tr ? 'Teklifi Kaydet' : 'Save Quote'}
                </button>
              </div>
            </div>
          )}

          {/* Quote list */}
          <div className="space-y-3">
            {quotes.map(q => (
              <div key={q.id} className="apple-card p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-bold text-gray-900 text-sm">{q.customerName}</p>
                    <p className="text-xs text-gray-500">{q.quoteNumber} • {tr ? 'Geçerlilik:' : 'Valid until:'} {q.validUntil}</p>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {q.items.map((item, i) => (
                        <span key={i} className="text-[10px] bg-gray-100 text-gray-600 font-semibold px-2 py-0.5 rounded-full">
                          {item.templateName} ×{item.quantity}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-brand">{fmtTRY(q.totalAmount)}</p>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                      q.status === 'Onaylandı' ? 'bg-green-100 text-green-700'
                        : q.status === 'Reddedildi' ? 'bg-red-100 text-red-700'
                        : q.status === 'Gönderildi' ? 'bg-blue-100 text-blue-700'
                        : 'bg-gray-100 text-gray-600'
                    }`}>{q.status}</span>
                  </div>
                </div>
                {isAuthenticated && q.status === 'Taslak' && (
                  <div className="flex gap-2 mt-3">
                    <button onClick={() => updateDoc(doc(db, 'cpqQuotes', q.id), { status: 'Gönderildi' })}
                      className="apple-button-secondary px-3 py-1.5 text-xs">{tr ? 'Gönderildi İşaretle' : 'Mark Sent'}</button>
                    <button onClick={() => updateDoc(doc(db, 'cpqQuotes', q.id), { status: 'Onaylandı' })}
                      className="apple-button-primary px-3 py-1.5 text-xs">{tr ? 'Onayla' : 'Approve'}</button>
                  </div>
                )}
              </div>
            ))}
          </div>

          {quotes.length === 0 && cartItems.length === 0 && (
            <div className="apple-card p-12 text-center space-y-3">
              <FileText className="w-12 h-12 text-gray-200 mx-auto" />
              <p className="text-gray-500">{tr ? 'Henüz CPQ teklifi yok' : 'No CPQ quotes yet'}</p>
              <button onClick={() => setView('configurator')} className="apple-button-primary px-5 py-2 text-sm mx-auto flex items-center gap-2">
                <Settings className="w-4 h-4" />{tr ? 'Yapılandırıcıya Git' : 'Go to Configurator'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
