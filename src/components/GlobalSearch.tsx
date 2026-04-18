/**
 * GlobalSearch.tsx — Cmd/Ctrl+K command palette
 *
 * Searches in-memory data (orders, leads, inventory) as the user types.
 * Results are grouped by entity type and support keyboard navigation.
 * Clicking a result fires a callback so AppContent can navigate.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Search, Package, Users, ShoppingCart, X, ArrowRight, Hash, Building2 } from 'lucide-react';
import type { Order, Lead, InventoryItem } from '../types';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SearchResult {
  type:    'order' | 'lead' | 'product';
  id:      string;
  title:   string;
  subtitle: string;
  badge?:  string;
  badgeColor?: string;
  data:    Order | Lead | InventoryItem;
}

interface GlobalSearchProps {
  orders:    Order[];
  leads:     Lead[];
  inventory: InventoryItem[];
  currentLanguage?: string;
  onSelectOrder:   (order: Order)         => void;
  onSelectLead:    (lead: Lead)           => void;
  onSelectProduct: (item: InventoryItem)  => void;
  onClose:         () => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  Pending:    'bg-amber-100 text-amber-700',
  Processing: 'bg-purple-100 text-purple-700',
  Shipped:    'bg-blue-100 text-blue-700',
  Delivered:  'bg-emerald-100 text-emerald-700',
  Cancelled:  'bg-gray-100 text-gray-500',
  New:        'bg-sky-100 text-sky-700',
  Contacted:  'bg-indigo-100 text-indigo-700',
  Qualified:  'bg-violet-100 text-violet-700',
  Closed:     'bg-emerald-100 text-emerald-700',
};

function match(haystack: string, needle: string) {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

function buildResults(
  query: string,
  orders: Order[],
  leads: Lead[],
  inventory: InventoryItem[],
): SearchResult[] {
  if (query.trim().length < 1) return [];
  const q = query.trim();
  const results: SearchResult[] = [];

  // Orders
  for (const o of orders) {
    if (
      match(o.customerName, q) ||
      match(o.shopifyOrderId ?? '', q) ||
      match(o.shippingAddress ?? '', q) ||
      match(o.status, q)
    ) {
      results.push({
        type:       'order',
        id:         o.id,
        title:      o.customerName,
        subtitle:   `#${o.shopifyOrderId ?? o.id.slice(0, 8)} · ₺${o.totalPrice.toLocaleString('tr-TR')}`,
        badge:      o.status,
        badgeColor: STATUS_COLORS[o.status] ?? 'bg-gray-100 text-gray-600',
        data:       o,
      });
      if (results.filter(r => r.type === 'order').length >= 5) break;
    }
  }

  // Leads
  for (const l of leads) {
    if (
      match(l.name, q) ||
      match(l.company, q) ||
      match(l.email ?? '', q) ||
      match(l.phone ?? '', q)
    ) {
      results.push({
        type:       'lead',
        id:         l.id,
        title:      l.name,
        subtitle:   l.company || l.email || '',
        badge:      l.status,
        badgeColor: STATUS_COLORS[l.status] ?? 'bg-gray-100 text-gray-600',
        data:       l,
      });
      if (results.filter(r => r.type === 'lead').length >= 5) break;
    }
  }

  // Products
  for (const item of inventory) {
    if (match(item.name, q) || match(item.sku, q) || match(item.category ?? '', q)) {
      results.push({
        type:     'product',
        id:       item.id,
        title:    item.name,
        subtitle: `SKU: ${item.sku} · ${item.stockLevel ?? 0} adet`,
        badge:    (item.stockLevel ?? 0) <= (item.lowStockThreshold ?? 5) ? 'Düşük Stok' : undefined,
        badgeColor: 'bg-red-100 text-red-600',
        data:     item,
      });
      if (results.filter(r => r.type === 'product').length >= 5) break;
    }
  }

  return results;
}

const TYPE_META = {
  order:   { icon: ShoppingCart, label: { tr: 'Sipariş', en: 'Order' },   color: 'text-blue-500' },
  lead:    { icon: Users,        label: { tr: 'Müşteri Adayı', en: 'Lead' }, color: 'text-purple-500' },
  product: { icon: Package,      label: { tr: 'Ürün', en: 'Product' },    color: 'text-emerald-500' },
};

// ── Main Component ────────────────────────────────────────────────────────────

export default function GlobalSearch({
  orders, leads, inventory,
  currentLanguage = 'tr',
  onSelectOrder, onSelectLead, onSelectProduct, onClose,
}: GlobalSearchProps) {
  const lang = currentLanguage === 'tr';
  const [query,   setQuery]   = useState('');
  const [cursor,  setCursor]  = useState(0);
  const inputRef  = useRef<HTMLInputElement>(null);
  const listRef   = useRef<HTMLDivElement>(null);

  const results = buildResults(query, orders, leads, inventory);

  // Focus input on mount
  useEffect(() => { inputRef.current?.focus(); }, []);

  // Reset cursor when results change
  useEffect(() => { setCursor(0); }, [query]);

  const handleSelect = useCallback((r: SearchResult) => {
    if (r.type === 'order')   onSelectOrder(r.data as Order);
    if (r.type === 'lead')    onSelectLead(r.data as Lead);
    if (r.type === 'product') onSelectProduct(r.data as InventoryItem);
    onClose();
  }, [onSelectOrder, onSelectLead, onSelectProduct, onClose]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor(c => Math.min(c + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor(c => Math.max(c - 1, 0));
    } else if (e.key === 'Enter' && results[cursor]) {
      handleSelect(results[cursor]);
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  // Scroll active item into view
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${cursor}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  // Group results by type for section headers
  const grouped: { type: SearchResult['type']; items: SearchResult[] }[] = [];
  for (const type of ['order', 'lead', 'product'] as SearchResult['type'][]) {
    const items = results.filter(r => r.type === type);
    if (items.length) grouped.push({ type, items });
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[200]"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="fixed top-[12%] left-1/2 -translate-x-1/2 z-[201] w-full max-w-xl px-4">
        <div className="bg-white rounded-2xl shadow-2xl overflow-hidden border border-gray-100">

          {/* Input row */}
          <div className="flex items-center gap-3 px-4 py-3.5 border-b border-gray-100">
            <Search className="w-5 h-5 text-gray-400 flex-shrink-0" />
            <input
              ref={inputRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={lang ? 'Sipariş, müşteri veya ürün ara…' : 'Search orders, leads or products…'}
              className="flex-1 text-sm text-gray-900 placeholder-gray-400 outline-none bg-transparent"
            />
            {query && (
              <button onClick={() => setQuery('')} className="text-gray-300 hover:text-gray-500 transition-colors">
                <X className="w-4 h-4" />
              </button>
            )}
            <kbd className="hidden sm:flex items-center gap-0.5 text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded font-mono">
              Esc
            </kbd>
          </div>

          {/* Results */}
          <div ref={listRef} className="max-h-[60vh] overflow-y-auto">
            {query.length === 0 ? (
              <div className="px-5 py-8 text-center">
                <Hash className="w-8 h-8 text-gray-200 mx-auto mb-2" />
                <p className="text-xs text-gray-400">
                  {lang ? 'Arama yapmak için yazmaya başlayın' : 'Start typing to search'}
                </p>
                <div className="flex items-center justify-center gap-4 mt-4">
                  {([
                    { icon: ShoppingCart, label: lang ? 'Siparişler' : 'Orders', color: 'text-blue-500 bg-blue-50' },
                    { icon: Users,        label: lang ? 'Müşteriler' : 'Leads',  color: 'text-purple-500 bg-purple-50' },
                    { icon: Package,      label: lang ? 'Ürünler' : 'Products',  color: 'text-emerald-500 bg-emerald-50' },
                  ] as const).map(({ icon: Icon, label, color }) => (
                    <div key={label} className="flex flex-col items-center gap-1.5">
                      <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${color}`}>
                        <Icon className="w-4 h-4" />
                      </div>
                      <span className="text-[10px] text-gray-400 font-medium">{label}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : results.length === 0 ? (
              <div className="px-5 py-8 text-center">
                <p className="text-sm text-gray-400">
                  {lang ? `"${query}" için sonuç bulunamadı.` : `No results for "${query}".`}
                </p>
              </div>
            ) : (
              <div className="py-2">
                {grouped.map(({ type, items }) => {
                  const meta = TYPE_META[type];
                  const Icon = meta.icon;
                  return (
                    <div key={type}>
                      {/* Section header */}
                      <div className="flex items-center gap-2 px-4 pt-3 pb-1.5">
                        <Icon className={`w-3.5 h-3.5 ${meta.color}`} />
                        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                          {meta.label[lang ? 'tr' : 'en']}
                        </span>
                      </div>

                      {/* Items */}
                      {items.map(r => {
                        const flatIdx = results.indexOf(r);
                        const isActive = flatIdx === cursor;
                        return (
                          <button
                            key={r.id}
                            data-idx={flatIdx}
                            onClick={() => handleSelect(r)}
                            onMouseEnter={() => setCursor(flatIdx)}
                            className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                              isActive ? 'bg-brand/5' : 'hover:bg-gray-50'
                            }`}
                          >
                            <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${
                              type === 'order'   ? 'bg-blue-50'   :
                              type === 'lead'    ? 'bg-purple-50' : 'bg-emerald-50'
                            }`}>
                              <Icon className={`w-3.5 h-3.5 ${meta.color}`} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-semibold text-gray-900 truncate">{r.title}</p>
                              <p className="text-[11px] text-gray-400 truncate">{r.subtitle}</p>
                            </div>
                            {r.badge && (
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${r.badgeColor}`}>
                                {r.badge}
                              </span>
                            )}
                            {isActive && <ArrowRight className="w-3.5 h-3.5 text-brand flex-shrink-0" />}
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-4 py-2 border-t border-gray-50 flex items-center justify-between">
            <div className="flex items-center gap-3 text-[10px] text-gray-300">
              <span><kbd className="bg-gray-100 px-1 rounded font-mono">↑↓</kbd> {lang ? 'Gezin' : 'Navigate'}</span>
              <span><kbd className="bg-gray-100 px-1 rounded font-mono">↵</kbd> {lang ? 'Aç' : 'Open'}</span>
              <span><kbd className="bg-gray-100 px-1 rounded font-mono">Esc</kbd> {lang ? 'Kapat' : 'Close'}</span>
            </div>
            {results.length > 0 && (
              <span className="text-[10px] text-gray-300">
                {results.length} {lang ? 'sonuç' : 'results'}
              </span>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
