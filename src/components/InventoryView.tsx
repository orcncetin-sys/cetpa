/**
 * InventoryView.tsx — Envanter yönetim ekranı
 *
 * App.tsx'ten çıkarıldı. Firestore koleksiyonları:
 *   inventory          — InventoryItem belgeleri
 *   inventoryMovements — Stok hareket logu
 *
 * Props olarak aldığı veriler App.tsx'teki onSnapshot aboneliklerinden gelir.
 */

import React, { useState, useEffect, useRef } from 'react';
import { logAudit } from '../services/auditLog';
import MikroPushButton from './MikroPushButton';
import { stokHareketPayload } from '../services/mikroEvrak';
import { motion, AnimatePresence } from 'motion/react';
import {
  RefreshCw, Search, Upload, Download, ShoppingCart, Plus, Scan,
  AlertTriangle, Copy, Eye, FileText, FileUp, History, CheckCircle2,
  X, Edit2, Trash2, Package,
} from 'lucide-react';
import {
  collection, updateDoc, deleteDoc, doc, serverTimestamp, addDoc, getDocs,
} from '../lib/dbClient';
import { db } from '../firebase';
import { logFirestoreError, OperationType } from '../utils/firebase';
import Papa from 'papaparse';
import {
  exportInventoryCSV,
  exportStockMovementsCSV,
  downloadInventoryImportTemplate,
  type StockMovementRow,
} from '../utils/export';
import { format } from 'date-fns';
import { tr as trLocale } from 'date-fns/locale';
import { cn } from '../lib/utils';

import ProductForm from './ProductForm';
import ProductDetail from './ProductDetail';
import BarcodeScanner from './BarcodeScanner';
import SortHeader from './SortHeader';
import ConfirmModal from './ConfirmModal';
import ModuleHeader from './ModuleHeader';
import { type LabelItem } from './LabelSheetModal';

import { type InventoryItem, type InventoryMovement, type Warehouse } from '../types';

// ── Types ─────────────────────────────────────────────────────────────────────

interface PriceTier {
  'Retail'?: number;
  'B2B Standard'?: number;
  'B2B Premium'?: number;
  'Dealer'?: number;
}

export interface InventoryViewProps {
  inventory: InventoryItem[];
  categories: string[];
  selectedCategory: string;
  setSelectedCategory: (c: string) => void;
  currentT: Record<string, string>;
  currentLanguage: string;
  isAuthenticated?: boolean;
  userRole?: string | null;
  inventoryMovements: InventoryMovement[];
  warehouses: Warehouse[];
  onPrintLabels?: (items: LabelItem[]) => void;
  onQuickPO?: (item: { name: string; sku: string }) => void;
  exchangeRates?: Record<string, number> | null;
}

// ── Component ─────────────────────────────────────────────────────────────────

const InventoryView: React.FC<InventoryViewProps> = ({
  inventory,
  categories,
  selectedCategory,
  setSelectedCategory,
  currentT,
  currentLanguage,
  inventoryMovements,
  warehouses,
  onPrintLabels,
  onQuickPO,
  exchangeRates,
}) => {
  const [isAddingProduct, setIsAddingProduct] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<InventoryItem | null>(null);
  const [editingProduct, setEditingProduct] = useState<InventoryItem | null>(null);
  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' }>({ key: 'name', direction: 'asc' });
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [confirmState, setConfirmState] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    confirmLabel?: string;
    variant?: 'danger' | 'default';
    onConfirm: () => void;
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
  });

  useEffect(() => {
    setMovements(inventoryMovements);
  }, [inventoryMovements]);

  const handleSort = (key: string) => {
    setSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc',
    }));
  };

  const filteredInventory = inventory
    .filter(item => {
      const matchesCategory = selectedCategory === 'all' || item.category === selectedCategory;
      const matchesSearch = item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.sku.toLowerCase().includes(searchTerm.toLowerCase());
      return matchesCategory && matchesSearch;
    })
    .sort((a: InventoryItem, b: InventoryItem) => {
      const aValue = (a as unknown as Record<string, unknown>)[sortConfig.key] ?? '';
      const bValue = (b as unknown as Record<string, unknown>)[sortConfig.key] ?? '';
      if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });

  // ── Duplicate SKU tespiti ───────────────────────────────────────────────────
  const duplicateSkus = (() => {
    const counts = new Map<string, number>();
    for (const i of inventory) {
      const s = (i.sku || '').trim();
      if (s) counts.set(s, (counts.get(s) ?? 0) + 1);
    }
    return [...counts.entries()].filter(([, c]) => c > 1).map(([s]) => s);
  })();

  // ── Pagination — keeps the DOM small with 3000+ SKUs ────────────────────────
  const INV_PAGE_SIZE = 50;
  const [invPage, setInvPage] = useState(0);
  const invPageCount = Math.max(1, Math.ceil(filteredInventory.length / INV_PAGE_SIZE));
  const safeInvPage = Math.min(invPage, invPageCount - 1);
  const pagedInventory = filteredInventory.slice(safeInvPage * INV_PAGE_SIZE, (safeInvPage + 1) * INV_PAGE_SIZE);
  useEffect(() => { setInvPage(0); }, [searchTerm, selectedCategory]);

  const invPaginationControls = invPageCount > 1 ? (
    <div className="flex items-center justify-between px-2 py-3">
      <span className="text-xs text-[#86868B]">
        {filteredInventory.length} {currentLanguage === 'tr' ? 'ürün' : 'items'} · {safeInvPage + 1}/{invPageCount}
      </span>
      <div className="flex gap-2">
        <button
          onClick={() => setInvPage(p => Math.max(0, p - 1))}
          disabled={safeInvPage === 0}
          className="apple-button-secondary px-4 py-1.5 text-xs font-semibold disabled:opacity-40"
        >
          {currentLanguage === 'tr' ? '← Önceki' : '← Prev'}
        </button>
        <button
          onClick={() => setInvPage(p => Math.min(invPageCount - 1, p + 1))}
          disabled={safeInvPage >= invPageCount - 1}
          className="apple-button-secondary px-4 py-1.5 text-xs font-semibold disabled:opacity-40"
        >
          {currentLanguage === 'tr' ? 'Sonraki →' : 'Next →'}
        </button>
      </div>
    </div>
  ) : null;

  const [autoReorderLoading, setAutoReorderLoading] = useState(false);
  const [autoReorderResult, setAutoReorderResult] = useState<string | null>(null);
  // Phase 546: inline notes quick-edit
  const [p546EditingNoteId, setP546EditingNoteId] = useState<string | null>(null);
  const [p546NoteDraft, setP546NoteDraft] = useState('');

  // ── CSV Import state ────────────────────────────────────────────────────────
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importRows, setImportRows] = useState<Record<string, string>[]>([]);
  const [importLoading, setImportLoading] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);
  const importFileRef = useRef<HTMLInputElement>(null);

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        setImportRows(results.data);
        setImportModalOpen(true);
      },
    });
    e.target.value = '';
  };

  const handleConfirmImport = async () => {
    setImportLoading(true);
    let upserted = 0;
    try {
      // Koleksiyonu BİR KEZ çek → SKU haritası (satır başına tam koleksiyon
      // okumak 3000 üründe yüz binlerce gereksiz doküman okuması demekti)
      const snap = await getDocs(collection(db, 'inventory'));
      const bySku = new Map<string, string>(); // sku → doc id
      snap.docs.forEach(d => {
        const s = ((d.data().sku as string) || '').trim();
        if (s && !bySku.has(s)) bySku.set(s, d.id);
      });
      for (const row of importRows) {
        const sku = (row.sku ?? '').trim();
        if (!sku) continue;
        const existingId = bySku.get(sku);
        const payload = {
          sku,
          source: 'csv',
          name: (row.name ?? '').trim(),
          category: (row.category ?? '').trim(),
          stockLevel: Number(row.stockLevel) || 0,
          lowStockThreshold: Number(row.lowStockThreshold) || 5,
          prices: {
            'Retail': Number(row['price_Retail']) || 0,
            'B2B Standard': Number(row['price_B2B Standard']) || 0,
            'B2B Premium': Number(row['price_B2B Premium']) || 0,
            'Dealer': Number(row['price_Dealer']) || 0,
          } as PriceTier,
          supplier: (row.supplier ?? '').trim(),
          warehouseId: (row.warehouseId ?? '').trim(),
          updatedAt: serverTimestamp(),
        };
        if (existingId) {
          await updateDoc(doc(db, 'inventory', existingId), payload);
        } else {
          const newRef = await addDoc(collection(db, 'inventory'), { ...payload, createdAt: serverTimestamp() });
          bySku.set(sku, newRef.id); // CSV içinde tekrar eden SKU duplike oluşturmasın
          logAudit('CSV Ürün Ekleme', `${payload.name ?? payload.sku ?? ''} CSV ile eklendi`);
        }
        upserted++;
      }
      setImportResult(
        currentLanguage === 'tr'
          ? `${upserted} ürün başarıyla içe aktarıldı.`
          : `${upserted} products imported successfully.`,
      );
      setImportModalOpen(false);
      setImportRows([]);
    } catch (err) {
      setImportResult(err instanceof Error ? err.message : 'Hata / Error');
    } finally {
      setImportLoading(false);
    }
  };

  const handleAutoReorder = async () => {
    setAutoReorderLoading(true);
    setAutoReorderResult(null);
    try {
      const r = await fetch('/api/inventory/auto-reorder', { method: 'POST' });
      const d = await r.json() as {
        success: boolean; created: number; lowStockCount: number;
        message?: string; error?: string; items?: string[];
      };
      if (d.success) {
        const msg = d.created === 0
          ? (currentLanguage === 'tr' ? 'Tüm stoklar limitin üzerinde.' : 'All stock levels are above threshold.')
          : `${d.created} ${currentLanguage === 'tr' ? 'taslak SAS oluşturuldu' : 'draft POs created'} (${d.items?.slice(0, 3).join(', ')}${(d.items?.length ?? 0) > 3 ? '…' : ''})`;
        setAutoReorderResult(msg);
      }
    } catch (e) {
      setAutoReorderResult(e instanceof Error ? e.message : 'Hata');
    } finally {
      setAutoReorderLoading(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Row 1: Title + Add button */}
      <ModuleHeader
        title={currentT.inventory}
        subtitle={currentT.inventory_desc}
        icon={Package}
        actionButton={
          <div className="flex items-center gap-2">
            <button
              onClick={() => void handleAutoReorder()}
              disabled={autoReorderLoading}
              className="apple-button-secondary flex items-center gap-2 text-sm"
              title={currentLanguage === 'tr' ? 'Düşük stoklar için taslak SAS oluştur' : 'Create draft POs for low-stock items'}
            >
              {autoReorderLoading
                ? <RefreshCw className="w-4 h-4 animate-spin" />
                : <ShoppingCart className="w-4 h-4" />}
              {currentLanguage === 'tr' ? 'Otomatik SAS' : 'Auto-Reorder'}
            </button>
            <button onClick={() => setIsAddingProduct(true)} className="apple-button-primary flex items-center gap-2">
              <Plus className="w-4 h-4" /> {currentT.add_product}
            </button>
          </div>
        }
      />
      {/* Row 2: Search + Scan + Export */}
      <div className="flex flex-col sm:flex-row gap-3 -mt-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#86868B]" />
          <input
            type="text"
            placeholder={currentT.search}
            className="apple-input pl-10 w-full"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setIsScannerOpen(true)}
            className="apple-button-secondary flex items-center justify-center gap-2"
            title={currentLanguage === 'tr' ? 'Barkod Tara' : 'Scan Barcode'}
          >
            <Scan className="w-4 h-4" />
            <span>{currentLanguage === 'tr' ? 'Barkod Tara' : 'Scan Barcode'}</span>
          </button>
          {/* hidden CSV file picker */}
          <input
            ref={importFileRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={handleImportFile}
          />
          <button
            onClick={() => importFileRef.current?.click()}
            className="apple-button-secondary p-2.5 flex items-center justify-center"
            title={currentLanguage === 'tr' ? 'CSV olarak içe aktar' : 'Import from CSV'}
          >
            <Upload className="w-4 h-4" />
          </button>
          <button
            onClick={() => exportInventoryCSV(inventory, currentLanguage)}
            className="apple-button-secondary p-2.5 flex items-center justify-center"
            title={currentLanguage === 'tr' ? 'CSV olarak dışa aktar' : 'Export as CSV'}
          >
            <Download className="w-4 h-4" />
          </button>
          {onPrintLabels && (
            <button
              onClick={() => {
                const labelData: LabelItem[] = filteredInventory.map(i => ({
                  id: i.id,
                  name: i.name,
                  sku: i.sku,
                  price: (i.prices as PriceTier | undefined)?.['Retail'] ?? (i as unknown as { price?: number }).price ?? 0,
                  unit: (i as unknown as { unit?: string }).unit,
                }));
                onPrintLabels(labelData);
              }}
              className="apple-button-secondary p-2.5 flex items-center justify-center"
              title={currentLanguage === 'tr' ? 'Etiket Yazdır' : 'Print Labels'}
            >
              <FileText className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Auto-reorder result banner */}
      {autoReorderResult && (
        <div className="flex items-center gap-2 text-xs px-4 py-2.5 rounded-xl bg-emerald-50 border border-emerald-100 text-emerald-700">
          <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
          <span>{autoReorderResult}</span>
          <button onClick={() => setAutoReorderResult(null)} className="ml-auto text-emerald-400 hover:text-emerald-600">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* CSV import result banner */}
      {importResult && (
        <div className="flex items-center gap-2 text-xs px-4 py-2.5 rounded-xl bg-blue-50 border border-blue-100 text-blue-700">
          <FileUp className="w-4 h-4 flex-shrink-0" />
          <span>{importResult}</span>
          <button onClick={() => setImportResult(null)} className="ml-auto text-blue-400 hover:text-blue-600">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* ── Phase 31: Low-Stock Watchlist Panel ── */}
      {(() => {
        const critical = inventory.filter(i => (i.stockLevel ?? 0) === 0);
        const warning = inventory.filter(i => (i.stockLevel ?? 0) > 0 && (i.stockLevel ?? 0) <= (i.lowStockThreshold ?? 5));
        if (critical.length === 0 && warning.length === 0) return null;
        return (
          <div className="rounded-2xl border overflow-hidden" style={{ borderColor: critical.length > 0 ? '#fca5a5' : '#fde68a' }}>
            <div className={`px-4 py-3 flex items-center justify-between ${critical.length > 0 ? 'bg-red-50' : 'bg-amber-50'}`}>
              <div className="flex items-center gap-2">
                <AlertTriangle className={`w-4 h-4 ${critical.length > 0 ? 'text-red-500' : 'text-amber-500'}`} />
                <span className={`text-xs font-bold ${critical.length > 0 ? 'text-red-700' : 'text-amber-700'}`}>
                  {currentLanguage === 'tr'
                    ? `${critical.length > 0 ? `${critical.length} kritik (0 stok)` : ''}${critical.length > 0 && warning.length > 0 ? ', ' : ''}${warning.length > 0 ? `${warning.length} uyarı (düşük stok)` : ''}`
                    : `${critical.length > 0 ? `${critical.length} critical (out of stock)` : ''}${critical.length > 0 && warning.length > 0 ? ', ' : ''}${warning.length > 0 ? `${warning.length} low stock warning` : ''}`}
                </span>
              </div>
              <button onClick={() => void handleAutoReorder()} disabled={autoReorderLoading}
                className={`text-[10px] font-bold px-3 py-1 rounded-full transition-colors ${critical.length > 0 ? 'bg-red-100 text-red-700 hover:bg-red-200' : 'bg-amber-100 text-amber-700 hover:bg-amber-200'}`}>
                {autoReorderLoading ? '…' : (currentLanguage === 'tr' ? '⚡ Otomatik SAS' : '⚡ Auto-Reorder')}
              </button>
            </div>
            <div className="bg-white divide-y divide-gray-50 max-h-48 overflow-y-auto">
              {[...critical, ...warning].slice(0, 10).map(item => {
                const pct = item.lowStockThreshold > 0 ? Math.min((item.stockLevel ?? 0) / item.lowStockThreshold, 1) : 0;
                const isCrit = (item.stockLevel ?? 0) === 0;
                return (
                  <div key={item.id} className="flex items-center gap-3 px-4 py-2.5">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-gray-800 truncate">{item.name}</p>
                      <p className="text-[10px] text-gray-400">{item.sku}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <div className="w-20 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full transition-all ${isCrit ? 'bg-red-500' : 'bg-amber-400'}`} style={{ width: `${pct * 100}%` }} />
                      </div>
                      <span className={`text-[10px] font-bold w-10 text-right ${isCrit ? 'text-red-600' : 'text-amber-600'}`}>
                        {item.stockLevel ?? 0}/{item.lowStockThreshold ?? 5}
                      </span>
                      {onQuickPO && (
                        <button
                          onClick={() => onQuickPO({ name: item.name, sku: item.sku })}
                          title={currentLanguage === 'tr' ? 'Satın Alma Talebi Oluştur' : 'Create Purchase Order'}
                          className={`text-[9px] font-bold px-2 py-1 rounded-full transition-colors flex items-center gap-0.5 ${isCrit ? 'bg-red-100 text-red-700 hover:bg-red-200' : 'bg-amber-100 text-amber-700 hover:bg-amber-200'}`}>
                          <ShoppingCart className="w-3 h-3" />
                          {currentLanguage === 'tr' ? 'SAS' : 'PO'}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 107: Smart Reorder Suggestions ── */}
      {movements.length > 0 && (() => {
        const now107 = Date.now();
        const MS_30D = 30 * 24 * 60 * 60 * 1000;
        const consMap: Record<string, number> = {};
        for (const m of movements) {
          if (m.type !== 'out') continue;
          const ts = (() => {
            const t = m.timestamp;
            if (!t) return 0;
            if (typeof (t as { toDate?: () => Date }).toDate === 'function') return (t as { toDate: () => Date }).toDate().getTime();
            return new Date(t as string | number).getTime();
          })();
          if (now107 - ts > MS_30D) continue;
          const key = (m as unknown as { productId?: string }).productId || m.productName;
          consMap[key] = (consMap[key] || 0) + m.quantity;
        }
        type Suggestion = { item: InventoryItem; monthlyOut: number; suggested: number };
        const suggestions: Suggestion[] = [];
        for (const item of inventory) {
          const key = item.id || item.name;
          const monthlyOut = consMap[key] ?? consMap[item.name] ?? 0;
          if (monthlyOut === 0) continue;
          const isLow = (item.stockLevel ?? 0) <= (item.lowStockThreshold ?? 5);
          if (!isLow) continue;
          const suggested = Math.max(Math.ceil(monthlyOut * 2), (item.lowStockThreshold ?? 5) - (item.stockLevel ?? 0));
          suggestions.push({ item, monthlyOut, suggested });
        }
        suggestions.sort((a, b) => b.suggested - a.suggested);
        if (suggestions.length === 0) return null;
        return (
          <div className="rounded-2xl border border-violet-100 bg-violet-50/40 overflow-hidden">
            <div className="px-4 py-3 flex items-center gap-2 bg-violet-50 border-b border-violet-100">
              <span className="text-[11px]">🧠</span>
              <span className="text-xs font-bold text-violet-700">
                {currentLanguage === 'tr' ? 'Akıllı Sipariş Önerileri' : 'Smart Reorder Suggestions'}
              </span>
              <span className="ml-auto text-[10px] text-violet-500">
                {currentLanguage === 'tr' ? 'Son 30 gün tüketimine göre' : 'Based on last 30-day usage'}
              </span>
            </div>
            <div className="divide-y divide-violet-100/60 max-h-44 overflow-y-auto">
              {suggestions.slice(0, 8).map(({ item, monthlyOut, suggested }) => (
                <div key={item.id} className="flex items-center gap-3 px-4 py-2.5 bg-white/50">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-gray-800 truncate">{item.name}</p>
                    <p className="text-[10px] text-gray-400">
                      {currentLanguage === 'tr'
                        ? `Aylık tüketim: ${monthlyOut} adet · Stok: ${item.stockLevel ?? 0}`
                        : `Monthly usage: ${monthlyOut} units · Stock: ${item.stockLevel ?? 0}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <div className="text-right">
                      <p className="text-[10px] text-violet-500 font-bold uppercase">
                        {currentLanguage === 'tr' ? 'Önerilen sipariş' : 'Suggested order'}
                      </p>
                      <p className="text-sm font-black text-violet-700">{suggested} {currentLanguage === 'tr' ? 'adet' : 'units'}</p>
                    </div>
                    {onQuickPO && (
                      <button
                        onClick={() => onQuickPO({ name: item.name, sku: item.sku })}
                        title={currentLanguage === 'tr' ? 'Satın Alma Talebi Oluştur' : 'Create PO'}
                        className="text-[9px] font-bold px-2 py-1 rounded-full bg-violet-100 text-violet-700 hover:bg-violet-200 transition-colors flex items-center gap-0.5">
                        <ShoppingCart className="w-3 h-3" />
                        SAS
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* CSV Import Preview Modal */}
      <AnimatePresence>
        {importModalOpen && (
          <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 16 }}
              className="bg-white rounded-[2rem] shadow-2xl w-full max-w-5xl max-h-[85vh] flex flex-col overflow-hidden"
            >
              {/* header */}
              <div className="px-8 py-5 border-b border-gray-100 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center text-white">
                    <FileUp className="w-4 h-4" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-[#1D1D1F]">
                      {currentLanguage === 'tr' ? 'CSV İçe Aktarma Önizlemesi' : 'CSV Import Preview'}
                    </h2>
                    <p className="text-xs text-[#86868B]">
                      {currentLanguage === 'tr'
                        ? `${importRows.length} satır — SKU eşleşirse güncellenir, yoksa eklenir`
                        : `${importRows.length} rows — existing SKUs will be updated, new ones added`}
                    </p>
                  </div>
                </div>
                <button onClick={() => setImportModalOpen(false)} className="p-2 hover:bg-gray-100 rounded-full text-gray-400">
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* table */}
              <div className="flex-1 overflow-auto p-6">
                <div className="text-xs text-gray-400 mb-3 flex items-center gap-2">
                  <span>{currentLanguage === 'tr' ? 'Şablon indir:' : 'Download template:'}</span>
                  <button
                    onClick={() => downloadInventoryImportTemplate()}
                    className="text-brand font-semibold hover:underline flex items-center gap-1"
                  >
                    <Download className="w-3 h-3" /> CETPA_Envanter_Sablon.csv
                  </button>
                </div>
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-gray-50">
                      {['sku', 'name', 'category', 'stockLevel', 'price_Retail', 'price_B2B Standard', 'supplier'].map(h => (
                        <th key={h} className="px-3 py-2 font-bold text-gray-500 border border-gray-100 whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {importRows.slice(0, 50).map((row, i) => {
                      const exists = inventory.some(inv => inv.sku === (row.sku ?? '').trim());
                      return (
                        <tr key={i} className={exists ? 'bg-amber-50' : 'bg-white'}>
                          {['sku', 'name', 'category', 'stockLevel', 'price_Retail', 'price_B2B Standard', 'supplier'].map(h => (
                            <td key={h} className="px-3 py-1.5 border border-gray-100 text-gray-700 max-w-[140px] truncate">{row[h] ?? ''}</td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {importRows.length > 50 && (
                  <p className="text-xs text-gray-400 mt-2 text-center">
                    {currentLanguage === 'tr' ? `...ve ${importRows.length - 50} satır daha` : `...and ${importRows.length - 50} more rows`}
                  </p>
                )}
                <div className="flex items-center gap-3 mt-4 text-xs text-gray-500">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-sm bg-amber-100 border border-amber-200 inline-block" />
                    {currentLanguage === 'tr' ? 'Mevcut SKU — güncellenecek' : 'Existing SKU — will be updated'}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-sm bg-white border border-gray-200 inline-block" />
                    {currentLanguage === 'tr' ? 'Yeni SKU — eklenecek' : 'New SKU — will be added'}
                  </span>
                </div>
              </div>

              {/* footer */}
              <div className="px-8 py-5 bg-gray-50/50 border-t border-gray-100 flex items-center justify-end gap-3">
                <button onClick={() => setImportModalOpen(false)} className="apple-button-secondary">
                  {currentLanguage === 'tr' ? 'İptal' : 'Cancel'}
                </button>
                <button
                  onClick={() => void handleConfirmImport()}
                  disabled={importLoading}
                  className="apple-button-primary px-10 flex items-center gap-2"
                >
                  {importLoading && <RefreshCw className="w-4 h-4 animate-spin" />}
                  {currentLanguage === 'tr' ? 'İçe Aktar' : 'Import'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Category Filters */}
      <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-none -mx-1 px-1">
        <button
          onClick={() => setSelectedCategory('all')}
          className={cn(
            'px-4 py-2 rounded-full text-xs font-bold transition-all whitespace-nowrap',
            selectedCategory === 'all'
              ? 'bg-brand text-white shadow-md'
              : 'bg-white text-[#86868B] border border-gray-200 hover:border-gray-300',
          )}
        >
          {currentLanguage === 'tr' ? 'Tümü' : 'All'}
        </button>
        {categories.map(cat => (
          <button
            key={cat}
            onClick={() => setSelectedCategory(cat)}
            className={cn(
              'px-4 py-2 rounded-full text-xs font-bold transition-all whitespace-nowrap',
              selectedCategory === cat
                ? 'bg-brand text-white shadow-md'
                : 'bg-white text-[#86868B] border border-gray-200 hover:border-gray-300',
            )}
          >
            {cat}
          </button>
        ))}
      </div>

      <BarcodeScanner
        isOpen={isScannerOpen}
        onClose={() => setIsScannerOpen(false)}
        currentLanguage={currentLanguage as 'tr' | 'en'}
        title={currentLanguage === 'tr' ? 'Ürün Barkodu Tara' : 'Scan Product Barcode'}
        placeholder={currentLanguage === 'tr' ? 'SKU veya barkod girin...' : 'Enter SKU or barcode...'}
        onScan={(barcode) => {
          setSearchTerm(barcode);
          const match = inventory.find(i => i.sku === barcode || i.sku.toLowerCase() === barcode.toLowerCase() || (i as unknown as { barcode?: string }).barcode === barcode);
          if (match) setSelectedProduct(match);
        }}
      />
      <ProductForm
        isOpen={isAddingProduct}
        onClose={() => { setIsAddingProduct(false); setEditingProduct(null); }}
        initialData={editingProduct}
        onSave={() => {
          setIsAddingProduct(false);
          setEditingProduct(null);
        }}
        warehouses={warehouses}
        existingCategories={categories}
        exchangeRates={exchangeRates ?? undefined}
      />
      {selectedProduct && <ProductDetail product={selectedProduct} onClose={() => setSelectedProduct(null)} />}

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-8">
        <div className="xl:col-span-3 space-y-6">
          {/* Duplicate SKU uyarısı */}
          {duplicateSkus.length > 0 && (
            <div className="flex items-start gap-2 px-4 py-3 mb-3 bg-amber-50 border border-amber-200 rounded-xl">
              <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
              <div className="text-xs text-amber-700">
                <b>{duplicateSkus.length}</b> {currentLanguage === 'tr' ? 'SKU birden fazla üründe kullanılıyor:' : 'SKUs are used by multiple products:'}{' '}
                {duplicateSkus.slice(0, 5).map(s => (
                  <button key={s} onClick={() => setSearchTerm(s)} className="font-mono font-bold underline decoration-dotted mr-1.5 hover:text-amber-900">{s}</button>
                ))}
                {duplicateSkus.length > 5 && '…'}
              </div>
            </div>
          )}

          {/* Desktop Table View */}
          <div className="apple-card overflow-hidden hidden md:block border border-gray-100 shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-gray-50/80 border-b border-gray-100">
                    <SortHeader
                      label={`${currentT.product} / SKU`}
                      sortKey="name"
                      currentSort={sortConfig}
                      onSort={handleSort}
                    />
                    <SortHeader
                      label={currentT.category}
                      sortKey="category"
                      currentSort={sortConfig}
                      onSort={handleSort}
                    />
                    <th className="px-6 py-4 text-[11px] font-bold text-[#86868B] uppercase tracking-widest">{currentT.warehouse}</th>
                    <SortHeader
                      label={currentT.stock}
                      sortKey="stockLevel"
                      currentSort={sortConfig}
                      onSort={handleSort}
                    />
                    <SortHeader
                      label={currentT.price}
                      sortKey="price"
                      currentSort={sortConfig}
                      onSort={handleSort}
                    />
                    {/* Phase 59: Cost Price + Margin column */}
                    <th className="px-4 py-4 text-[11px] font-bold text-[#86868B] uppercase tracking-widest hidden xl:table-cell">
                      {currentLanguage === 'tr' ? 'Maliyet / Marj' : 'Cost / Margin'}
                    </th>
                    <th className="px-6 py-4 text-[11px] font-bold text-[#86868B] uppercase tracking-widest">{currentT.status}</th>
                    <th className="px-6 py-4 text-[11px] font-bold text-[#86868B] uppercase tracking-widest text-right">{currentT.actions}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {pagedInventory.map((item) => (
                    <tr key={item.id} className="hover:bg-gray-50/50 transition-colors cursor-pointer group" onClick={() => setSelectedProduct(item)}>
                      <td className="px-6 py-4">
                        <div className="flex flex-col">
                          <span className="text-sm font-bold text-gray-900">{item.name}</span>
                          {/* Phase 52: SKU click-to-copy */}
                          <button
                            className="flex items-center gap-1 w-fit group/sku mt-0.5"
                            onClick={e => { e.stopPropagation(); void navigator.clipboard.writeText(item.sku); }}
                            title={currentT.copy_sku || 'Copy SKU'}
                          >
                            <span className="text-[10px] font-mono text-[#86868B] tracking-wider group-hover/sku:text-brand transition-colors">{item.sku}</span>
                            <Copy className="w-2.5 h-2.5 text-gray-300 group-hover/sku:text-brand opacity-0 group-hover/sku:opacity-100 transition-all" />
                          </button>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className="px-2 py-0.5 bg-gray-100 text-[#86868B] rounded-md text-[10px] font-bold uppercase">
                          {item.category || currentT.unspecified}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-xs font-medium text-gray-600">
                        {(item as unknown as { location?: string }).location || currentT.main_warehouse}
                      </td>
                      <td className="px-6 py-4">
                        {/* Phase 33: Stock mini-gauge */}
                        {(() => {
                          const stock = item.stockLevel ?? 0;
                          const thresh = item.lowStockThreshold ?? 5;
                          const refMax = Math.max(thresh * 4, stock, 20);
                          const pct = Math.min(stock / refMax, 1);
                          const isCrit = stock === 0;
                          const isLow = stock > 0 && stock <= thresh;
                          const barColor = isCrit ? 'bg-red-500' : isLow ? 'bg-amber-400' : 'bg-emerald-400';
                          return (
                            <div className="space-y-1">
                              <div className="flex items-center gap-1.5">
                                <span className={cn('text-sm font-bold', isCrit ? 'text-red-500' : isLow ? 'text-amber-600' : 'text-gray-900')}>
                                  {stock}
                                </span>
                                {(isCrit || isLow) && <AlertTriangle className={`w-3 h-3 ${isCrit ? 'text-red-500' : 'text-amber-500'}`} />}
                              </div>
                              <div className="w-16 h-1 bg-gray-100 rounded-full overflow-hidden">
                                <div className={`h-full ${barColor} rounded-full transition-all`} style={{ width: `${pct * 100}%` }} />
                              </div>
                            </div>
                          );
                        })()}
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-sm font-bold text-gray-900">
                          {((item as unknown as { price?: number }).price ?? (item.prices as PriceTier | undefined)?.['Retail'] ?? 0).toLocaleString()} TL
                        </span>
                      </td>
                      {/* Phase 59: Cost Price + Margin cell */}
                      <td className="px-4 py-4 hidden xl:table-cell">
                        {(() => {
                          const retail = (item as unknown as { price?: number }).price ?? (item.prices as PriceTier | undefined)?.['Retail'] ?? 0;
                          const cost = (item as unknown as { costPrice?: number; cost?: number }).costPrice ?? (item as unknown as { cost?: number }).cost ?? 0;
                          const margin = retail > 0 && cost > 0 ? Math.round(((retail - cost) / retail) * 100) : null;
                          return (
                            <div className="flex flex-col gap-0.5">
                              <span className="text-xs font-semibold text-gray-500">{cost > 0 ? `₺${cost.toLocaleString('tr-TR')}` : '—'}</span>
                              {margin !== null && (
                                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full w-fit ${margin >= 30 ? 'bg-emerald-50 text-emerald-700' : margin >= 15 ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-600'}`}>
                                  %{margin}
                                </span>
                              )}
                            </div>
                          );
                        })()}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-col gap-1">
                          <span className={cn(
                            'px-2 py-1 rounded-full text-[9px] font-bold uppercase tracking-wider w-fit',
                            item.stockLevel <= item.lowStockThreshold ? 'bg-red-50 text-red-600 border border-red-100' : 'bg-green-50 text-green-600 border border-green-100',
                          )}>
                            {item.stockLevel <= item.lowStockThreshold ? currentT.critical : currentT.normal}
                          </span>
                          {/* Phase 531: stock level progress bar */}
                          {(() => {
                            const stock531 = item.stockLevel ?? 0;
                            const thresh531 = item.lowStockThreshold ?? 5;
                            const max531 = Math.max(stock531, thresh531 * 3, 1);
                            const pct531 = Math.min(100, Math.round((stock531 / max531) * 100));
                            const barColor531 = stock531 === 0 ? 'bg-red-500' : stock531 <= thresh531 ? 'bg-amber-400' : 'bg-emerald-400';
                            return (
                              <div className="flex items-center gap-1.5 mt-0.5">
                                <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden max-w-[80px]">
                                  <div className={cn('h-full rounded-full transition-all', barColor531)} style={{ width: `${pct531}%` }} />
                                </div>
                                <span className="text-[9px] text-gray-500 tabular-nums">{stock531}</span>
                              </div>
                            );
                          })()}
                          {/* Phase 66: Last movement date */}
                          {(() => {
                            const lastMov = movements
                              .filter(m => (m as unknown as { productId?: string }).productId === item.id || m.productName === item.name)
                              .sort((a, b) => {
                                const getT = (x: unknown) => {
                                  if (!x) return 0;
                                  if (typeof (x as { toDate?: () => Date }).toDate === 'function') return (x as { toDate: () => Date }).toDate().getTime();
                                  return new Date(x as string | number).getTime();
                                };
                                return getT(b.timestamp) - getT(a.timestamp);
                              })[0];
                            if (!lastMov) return null;
                            const d = typeof (lastMov.timestamp as { toDate?: () => Date }).toDate === 'function'
                              ? (lastMov.timestamp as { toDate: () => Date }).toDate()
                              : new Date(lastMov.timestamp as string | number);
                            const daysAgo = Math.round((Date.now() - d.getTime()) / 86400000);
                            return (
                              <span className="text-[9px] text-gray-400" title={d.toLocaleDateString()}>
                                {daysAgo === 0
                                  ? (currentLanguage === 'tr' ? 'Bugün hareket' : 'Moved today')
                                  : (currentLanguage === 'tr' ? `${daysAgo}g önce` : `${daysAgo}d ago`)}
                              </span>
                            );
                          })()}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          {/* Phase 54: Quick Stock Adjustment */}
                          <button
                            onClick={async (e) => { e.stopPropagation(); const newStock = Math.max(0, (item.stockLevel ?? 0) - 1); await updateDoc(doc(db, 'inventory', item.id), { stockLevel: newStock }); if (newStock !== (item.stockLevel ?? 0)) await addDoc(collection(db, 'inventoryMovements'), { productId: item.id, productName: item.name, sku: item.sku, type: 'out', quantity: 1, note: 'Hızlı düzeltme (-1)', companyId: (item as unknown as { companyId?: string }).companyId ?? null, timestamp: serverTimestamp() }); }}
                            className="p-1.5 rounded-lg hover:bg-red-50 text-gray-300 hover:text-red-500 transition-all font-bold text-xs"
                            title={currentLanguage === 'tr' ? 'Stok azalt' : 'Decrease stock'}
                          >
                            −
                          </button>
                          <button
                            onClick={async (e) => { e.stopPropagation(); const newStock = (item.stockLevel ?? 0) + 1; await updateDoc(doc(db, 'inventory', item.id), { stockLevel: newStock }); await addDoc(collection(db, 'inventoryMovements'), { productId: item.id, productName: item.name, sku: item.sku, type: 'in', quantity: 1, note: 'Hızlı düzeltme (+1)', companyId: (item as unknown as { companyId?: string }).companyId ?? null, timestamp: serverTimestamp() }); }}
                            className="p-1.5 rounded-lg hover:bg-emerald-50 text-gray-300 hover:text-emerald-600 transition-all font-bold text-xs"
                            title={currentLanguage === 'tr' ? 'Stok artır' : 'Increase stock'}
                          >
                            +
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); setSelectedProduct(item); }}
                            className="p-2 rounded-xl hover:bg-blue-50 text-[#86868B] hover:text-blue-600 transition-all"
                            title={currentLanguage === 'tr' ? 'İncele' : 'View'}
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); setEditingProduct(item); setIsAddingProduct(true); }}
                            className="p-2 rounded-xl hover:bg-brand/10 text-[#86868B] hover:text-brand transition-all"
                            title={currentLanguage === 'tr' ? 'Düzenle' : 'Edit'}
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          {/* Phase 546: Inline notes quick-edit */}
                          <div className="relative" onClick={e => e.stopPropagation()}>
                            <button
                              onClick={() => {
                                if (p546EditingNoteId === item.id) {
                                  setP546EditingNoteId(null);
                                } else {
                                  setP546EditingNoteId(item.id);
                                  setP546NoteDraft((item as unknown as Record<string, unknown>).notes as string ?? '');
                                }
                              }}
                              className={cn(
                                'p-2 rounded-xl transition-all',
                                (item as unknown as Record<string, unknown>).notes
                                  ? 'text-amber-500 hover:bg-amber-50'
                                  : 'text-gray-300 hover:bg-gray-50 hover:text-gray-500',
                              )}
                              title={currentLanguage === 'tr' ? 'Not ekle / düzenle' : 'Add / edit note'}
                            >
                              <FileText className="w-4 h-4" />
                            </button>
                            {p546EditingNoteId === item.id && (
                              <div className="absolute right-0 top-full mt-1 z-50 bg-white border border-gray-200 rounded-2xl shadow-2xl p-3 w-64">
                                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">
                                  {currentLanguage === 'tr' ? 'Ürün Notu' : 'Product Note'}
                                </p>
                                <textarea
                                  autoFocus
                                  value={p546NoteDraft}
                                  onChange={e => setP546NoteDraft(e.target.value)}
                                  rows={3}
                                  className="w-full bg-gray-50 border border-gray-100 rounded-xl px-3 py-2 text-xs outline-none focus:border-brand focus:ring-2 focus:ring-brand/10 resize-none"
                                  placeholder={currentLanguage === 'tr' ? 'Ürün hakkında not girin...' : 'Enter a note about this product...'}
                                />
                                <div className="flex gap-2 mt-2">
                                  <button
                                    onClick={async () => {
                                      try {
                                        await updateDoc(doc(db, 'inventory', item.id), { notes: p546NoteDraft });
                                        setAutoReorderResult(currentLanguage === 'tr' ? 'Not kaydedildi ✓' : 'Note saved ✓');
                                        setTimeout(() => setAutoReorderResult(null), 2500);
                                      } catch { /* noop */ }
                                      setP546EditingNoteId(null);
                                    }}
                                    className="flex-1 py-1.5 text-xs font-bold bg-brand text-white rounded-xl hover:bg-brand/90 transition-colors"
                                  >
                                    {currentLanguage === 'tr' ? 'Kaydet' : 'Save'}
                                  </button>
                                  <button
                                    onClick={() => setP546EditingNoteId(null)}
                                    className="px-3 py-1.5 text-xs font-bold text-gray-500 bg-gray-100 rounded-xl hover:bg-gray-200 transition-colors"
                                  >
                                    {currentLanguage === 'tr' ? 'İptal' : 'Cancel'}
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setConfirmState({
                                isOpen: true,
                                title: currentT.confirm_delete,
                                message: currentT.confirm_delete_product || 'Bu ürünü silmek istediğinize emin misiniz?',
                                onConfirm: async () => {
                                  try {
                                    await deleteDoc(doc(db, 'inventory', item.id));
                            logAudit('Ürün Silme', `${item.name} (${item.sku}) silindi`);
                                  } catch (error) {
                                    logFirestoreError(error as Error, OperationType.DELETE, `inventory/${item.id}`);
                                  }
                                },
                              });
                            }}
                            className="p-2 rounded-xl hover:bg-red-50 text-[#86868B] hover:text-red-500 transition-all"
                            title={currentT.delete}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {invPaginationControls}
          </div>

          {/* Mobile Card View */}
          <div className="md:hidden space-y-4">
            {pagedInventory.map((item) => (
              <div key={item.id} className="apple-card p-4 space-y-4" onClick={() => setSelectedProduct(item)}>
                <div className="flex justify-between items-start">
                  <div>
                    <p className="text-sm font-bold">{item.name}</p>
                    <p className="text-xs text-[#86868B]">{item.sku}</p>
                  </div>
                  <span className={cn(
                    'px-2 py-1 rounded-full text-[10px] font-bold uppercase',
                    item.stockLevel <= item.lowStockThreshold ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-600',
                  )}>
                    {item.stockLevel <= item.lowStockThreshold ? currentT.critical : currentT.normal}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-4 pt-4 border-t border-gray-100">
                  <div>
                    <p className="text-[10px] font-bold text-[#86868B] uppercase">{currentT.stock}</p>
                    {/* Phase 39: Mobile stock gauge */}
                    <p className="text-sm font-bold">{item.stockLevel}</p>
                    <div className="w-full h-1.5 bg-gray-100 rounded-full mt-1 overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${(item.stockLevel ?? 0) === 0 ? 'bg-red-500' : (item.stockLevel ?? 0) <= (item.lowStockThreshold ?? 5) ? 'bg-amber-400' : 'bg-emerald-400'}`}
                        style={{ width: `${Math.min(((item.stockLevel ?? 0) / Math.max((item.lowStockThreshold ?? 5) * 4, 1)) * 100, 100)}%` }} />
                    </div>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-[#86868B] uppercase">{currentT.price}</p>
                    <p className="text-sm font-bold">{((item as unknown as { price?: number }).price ?? (item.prices as PriceTier | undefined)?.['Retail'] ?? 0).toLocaleString()} TL</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-[#86868B] uppercase">{currentT.category}</p>
                    <p className="text-xs font-medium">{item.category || currentT.unspecified}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-[#86868B] uppercase">{currentT.warehouse}</p>
                    <p className="text-xs font-medium">{(item as unknown as { location?: string }).location || currentT.main_warehouse}</p>
                  </div>
                </div>
                <div className="flex items-center justify-end gap-2 pt-4 border-t border-gray-100">
                  <button
                    onClick={(e) => { e.stopPropagation(); setSelectedProduct(item); }}
                    className="p-2 rounded-xl bg-blue-50 text-blue-600"
                  >
                    <Eye className="w-4 h-4" />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); setEditingProduct(item); setIsAddingProduct(true); }}
                    className="p-2 rounded-xl bg-brand/10 text-brand"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirmState({
                        isOpen: true,
                        title: currentT.confirm_delete,
                        message: currentT.confirm_delete_product || 'Bu ürünü silmek istediğinize emin misiniz?',
                        onConfirm: async () => {
                          try {
                            await deleteDoc(doc(db, 'inventory', item.id));
                          } catch (error) {
                            logFirestoreError(error as Error, OperationType.DELETE, `inventory/${item.id}`);
                          }
                        },
                      });
                    }}
                    className="p-2 rounded-xl bg-red-50 text-red-500"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
            {invPaginationControls}
          </div>
        </div>

        <div className="xl:col-span-1">
          <div className="apple-card p-6 border border-gray-100 shadow-sm sticky top-24">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-bold flex items-center gap-2">
                <RefreshCw className="w-5 h-5 text-brand" /> {currentT.movements}
              </h3>
              {movements.length > 0 && (
                <button
                  onClick={() => exportStockMovementsCSV(movements as unknown as StockMovementRow[], currentLanguage)}
                  className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                  title={currentLanguage === 'tr' ? 'CSV olarak indir' : 'Download CSV'}
                >
                  <Download className="w-4 h-4" />
                </button>
              )}
            </div>
            <div className="space-y-4">
              {movements.length === 0 ? (
                <div className="py-12 text-center">
                  <div className="w-12 h-12 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-3">
                    <History className="w-6 h-6 text-gray-300" />
                  </div>
                  <p className="text-sm text-gray-400 font-medium">{currentLanguage === 'tr' ? 'Kayıt bulunamadı' : 'No movements found'}</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-50">
                  {movements.map((mov) => (
                    <div key={mov.id} className="py-3 first:pt-0 last:pb-0">
                      <div className="flex items-center justify-between mb-1">
                        <span className={cn(
                          'text-[10px] font-bold uppercase px-1.5 py-0.5 rounded',
                          mov.type === 'in' ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600',
                        )}>
                          {mov.type === 'in' ? (currentLanguage === 'tr' ? 'Giriş' : 'In') : (currentLanguage === 'tr' ? 'Çıkış' : 'Out')}
                        </span>
                        <span className="text-[10px] text-gray-400 font-medium">
                          {mov.timestamp && typeof (mov.timestamp as { toDate?: () => Date }).toDate === 'function' ? format((mov.timestamp as { toDate: () => Date }).toDate(), 'HH:mm') : ''}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-1">
                        <p className="text-xs font-bold text-gray-900 truncate">{mov.productName}</p>
                        <MikroPushButton
                          compact
                          method="DahiliStokHareketKaydetV2"
                          entityType="inventoryMovement"
                          entityId={mov.id}
                          buildPayload={() => {
                            const sku = (mov as unknown as { sku?: string }).sku;
                            if (!sku) return null;
                            return stokHareketPayload({
                              sku,
                              quantity: Number(mov.quantity) || 0,
                              type: mov.type,
                            });
                          }}
                        />
                      </div>
                      <div className="flex items-center justify-between mt-1">
                        <span className="text-[10px] text-gray-500">
                          {mov.timestamp ? format(typeof (mov.timestamp as { toDate?: () => Date }).toDate === 'function' ? (mov.timestamp as { toDate: () => Date }).toDate() : new Date(mov.timestamp as string | number | Date), 'dd MMM yyyy', { locale: currentLanguage === 'tr' ? trLocale : undefined }) : ''}
                        </span>
                        <span className={cn(
                          'text-xs font-bold',
                          mov.type === 'in' ? 'text-green-600' : 'text-red-600',
                        )}>
                          {mov.type === 'in' ? '+' : '-'}{mov.quantity}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      <ConfirmModal
        isOpen={confirmState.isOpen}
        title={confirmState.title}
        message={confirmState.message}
        confirmLabel={confirmState.confirmLabel}
        variant={confirmState.variant}
        onConfirm={() => {
          confirmState.onConfirm();
          setConfirmState(prev => ({ ...prev, isOpen: false }));
        }}
        onCancel={() => setConfirmState(prev => ({ ...prev, isOpen: false }))}
      />
    </div>
  );
};

export default InventoryView;
