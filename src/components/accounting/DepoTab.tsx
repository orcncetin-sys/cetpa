import { motion, AnimatePresence } from 'motion/react';
import { Search, Plus, Eye, Edit2, Trash2, X, Save } from 'lucide-react';
import { type Warehouse, type WarehouseItem } from '../../types';
import { SortHeader, type AccountingT } from './shared';

type StockForm = { productName: string; sku: string; quantity: number; warehouseId: string; category: string; notes: string };

interface DepoTabProps {
  t: AccountingT;
  currentLanguage: string;
  warehouses: Warehouse[];
  warehouseSearch: string;
  setWarehouseSearch: (v: string) => void;
  depoSortKey: 'productName' | 'sku' | 'quantity' | 'warehouseId';
  depoSortDir: 'asc' | 'desc';
  toggleDepoSort: (key: 'productName' | 'sku' | 'quantity' | 'warehouseId') => void;
  displayedDepo: WarehouseItem[];
  depoDagilimEtiket: (w: WarehouseItem) => string;
  showStockModal: boolean;
  setShowStockModal: (v: boolean) => void;
  editingStock: WarehouseItem | null;
  setEditingStock: (w: WarehouseItem | null) => void;
  stockForm: StockForm;
  setStockForm: React.Dispatch<React.SetStateAction<StockForm>>;
  saveStock: () => void;
  deleteStock: (id: string) => void;
}

export default function DepoTab({
  t, currentLanguage, warehouses, warehouseSearch, setWarehouseSearch,
  depoSortKey, depoSortDir, toggleDepoSort, displayedDepo, depoDagilimEtiket,
  showStockModal, setShowStockModal, editingStock, setEditingStock,
  stockForm, setStockForm, saveStock, deleteStock,
}: DepoTabProps) {
  return (
    <>
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <h3 className="font-semibold text-gray-800">{t.depo}</h3>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5 bg-gray-50 border border-gray-200 rounded-full px-3 py-1.5">
                <Search size={12} className="text-gray-400" />
                <input value={warehouseSearch} onChange={e => setWarehouseSearch(e.target.value)} placeholder={t.product + '...'} className="text-xs outline-none bg-transparent w-32" />
              </div>
              <button onClick={() => { setEditingStock(null); setStockForm({ productName: '', sku: '', quantity: 0, warehouseId: '', category: '', notes: '' }); setShowStockModal(true); }} className="apple-button-primary">
                <Plus size={14} /> {t.add}
              </button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="apple-table">
              <thead>
                <tr className="border-b border-gray-100">
                  <SortHeader
                    label={t.product}
                    sortKey="productName"
                    currentSort={{ key: depoSortKey, direction: depoSortDir }}
                    onSort={(key) => toggleDepoSort(key as 'productName' | 'sku' | 'quantity' | 'warehouseId')}
                  />
                  <SortHeader
                    label="SKU"
                    sortKey="sku"
                    currentSort={{ key: depoSortKey, direction: depoSortDir }}
                    onSort={(key) => toggleDepoSort(key as 'productName' | 'sku' | 'quantity' | 'warehouseId')}
                    className="hidden sm:table-cell"
                  />
                  <SortHeader
                    label={t.quantity}
                    sortKey="quantity"
                    currentSort={{ key: depoSortKey, direction: depoSortDir }}
                    onSort={(key) => toggleDepoSort(key as 'productName' | 'sku' | 'quantity' | 'warehouseId')}
                    className="text-right"
                  />
                  <th className="text-left py-3 px-4 text-[10px] font-bold text-[#86868B] uppercase tracking-wider hidden md:table-cell">{t.location}</th>
                  <th className="text-left py-3 px-4 text-[10px] font-bold text-[#86868B] uppercase tracking-wider hidden lg:table-cell">{t.category}</th>
                  <th className="py-3 px-4"></th>
                </tr>
              </thead>
              <tbody>
                {displayedDepo.length === 0 && (
                  <tr><td colSpan={6} className="text-center py-8 text-gray-400">{t.noRecords}</td></tr>
                )}
                {displayedDepo.map(w => (
                  <tr key={w.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="py-2.5 px-3 font-medium text-gray-800">{w.productName}</td>
                    <td className="py-2.5 px-3 font-mono text-xs text-gray-500 hidden sm:table-cell">{w.sku || '—'}</td>
                    <td className="py-2.5 px-3 text-right font-semibold">{w.quantity}</td>
                    <td className="py-2.5 px-3 text-xs text-gray-500 hidden md:table-cell">{depoDagilimEtiket(w)}</td>
                    <td className="py-2.5 px-3 text-xs text-gray-500 hidden lg:table-cell">{w.category || '—'}</td>
                    <td className="py-2.5 px-3 text-right">
                      <div className="flex justify-end gap-1">
                        <button onClick={() => { setEditingStock(w); setStockForm({ productName: w.productName, sku: w.sku || '', quantity: w.quantity, warehouseId: w.warehouseId || '', category: w.category || '', notes: w.notes || '' }); setShowStockModal(true); }} className="p-1.5 hover:bg-blue-50 text-blue-400 rounded-lg transition-colors text-blue-500 hover:bg-blue-50 hover:text-blue-600"><Eye size={13} /></button>
                        <button onClick={() => { setEditingStock(w); setStockForm({ productName: w.productName, sku: w.sku || '', quantity: w.quantity, warehouseId: w.warehouseId || '', category: w.category || '', notes: w.notes || '' }); setShowStockModal(true); }} className="p-1.5 hover:bg-blue-50 text-blue-400 rounded-lg transition-colors"><Edit2 size={13} /></button>
                        <button onClick={() => deleteStock(w.id)} className="p-1.5 hover:bg-red-50 text-red-400 rounded-lg transition-colors"><Trash2 size={13} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </motion.div>

      {/* STOK / DEPO MODAL */}
      <AnimatePresence>
        {showStockModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowStockModal(false)} />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-white rounded-2xl shadow-2xl w-full max-w-md relative z-10 overflow-hidden">
              <div className="flex items-center justify-between p-5 border-b border-gray-100">
                <h3 className="font-semibold text-gray-800">{t.depo} — {editingStock ? (currentLanguage === 'tr' ? 'Düzenle' : 'Edit') : t.add}</h3>
                <button onClick={() => setShowStockModal(false)} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"><X size={16} /></button>
              </div>
              <div className="p-5 space-y-3 max-h-[70vh] overflow-y-auto">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{t.product}</label>
                  <input type="text" value={stockForm.productName} onChange={e => setStockForm(prev => ({ ...prev, productName: e.target.value }))} placeholder={currentLanguage === 'tr' ? 'Ürün adı' : 'Product name'} className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">SKU</label>
                    <input type="text" value={stockForm.sku} onChange={e => setStockForm(prev => ({ ...prev, sku: e.target.value }))} placeholder="CTP-000.00.00" className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000] font-mono" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{t.quantity}</label>
                    <input type="number" value={stockForm.quantity} onChange={e => setStockForm(prev => ({ ...prev, quantity: Number(e.target.value) }))} placeholder="0" className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{t.location}</label>
                  <select value={stockForm.warehouseId} onChange={e => setStockForm(prev => ({ ...prev, warehouseId: e.target.value }))} className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]">
                    <option value="">{currentLanguage === 'tr' ? '— Depo seçin —' : '— Select warehouse —'}</option>
                    {warehouses.map(wh => (
                      <option key={wh.id} value={wh.id}>{wh.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{currentLanguage === 'tr' ? 'Kategori' : 'Category'}</label>
                  <input type="text" value={stockForm.category} onChange={e => setStockForm(prev => ({ ...prev, category: e.target.value }))} placeholder={currentLanguage === 'tr' ? 'Genel' : 'General'} className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{currentLanguage === 'tr' ? 'Not' : 'Notes'}</label>
                  <input type="text" value={stockForm.notes} onChange={e => setStockForm(prev => ({ ...prev, notes: e.target.value }))} placeholder="..." className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]" />
                </div>
              </div>
              <div className="flex justify-end gap-2 p-5 border-t border-gray-100">
                <button onClick={() => setShowStockModal(false)} className="bg-gray-100 hover:bg-gray-200 rounded-full px-4 py-2 text-sm font-semibold transition-colors">{t.cancel}</button>
                <button onClick={saveStock} className="apple-button-primary"><Save size={14} /> {t.save}</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
