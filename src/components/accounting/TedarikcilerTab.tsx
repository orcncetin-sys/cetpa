import { motion, AnimatePresence } from 'motion/react';
import { Download, Search, Plus, Eye, Edit2, Trash2, X, Save } from 'lucide-react';
import { type Supplier } from '../../types';
import { SortHeader, exportCSV, type AccountingT } from './shared';
import CariEkstrePanel from '../CariEkstrePanel';

type SupplierForm = { name: string; company: string; email: string; phone: string; address: string; taxNo: string; notes: string };
type TedarikciSortKey = 'name' | 'company' | 'phone';

interface TedarikcilerTabProps {
  t: AccountingT;
  currentLanguage: string;
  suppliers: Supplier[];
  displayedTedarikciler: Supplier[];
  supplierSearch: string;
  setSupplierSearch: (v: string) => void;
  tedarikciSortKey: TedarikciSortKey;
  tedarikciSortDir: 'asc' | 'desc';
  toggleTedarikciSort: (key: TedarikciSortKey) => void;
  showSupplierModal: boolean;
  setShowSupplierModal: (v: boolean) => void;
  editingSupplier: Supplier | null;
  setEditingSupplier: (s: Supplier | null) => void;
  supplierForm: SupplierForm;
  setSupplierForm: React.Dispatch<React.SetStateAction<SupplierForm>>;
  saveSupplier: () => void;
  deleteSupplier: (id: string) => void;
  ekstreTedarikci: Supplier | null;
  setEkstreTedarikci: (s: Supplier | null) => void;
}

export default function TedarikcilerTab({
  t, currentLanguage, suppliers, displayedTedarikciler, supplierSearch, setSupplierSearch,
  tedarikciSortKey, tedarikciSortDir, toggleTedarikciSort,
  showSupplierModal, setShowSupplierModal, editingSupplier, setEditingSupplier,
  supplierForm, setSupplierForm, saveSupplier, deleteSupplier,
  ekstreTedarikci, setEkstreTedarikci,
}: TedarikcilerTabProps) {
  return (
    <>
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <h3 className="font-semibold text-gray-800">{t.tedarikciler}</h3>
            <div className="flex items-center gap-2">
              <button
                onClick={() => exportCSV('tedarikciler.csv',
                  [t.name, t.company, t.email, t.phone, t.taxNo, t.address],
                  suppliers.map(s => [s.name, s.company || '', s.email || '', s.phone || '', s.taxNo || '', s.address || ''])
                )}
                className="flex items-center gap-1 bg-gray-100 hover:bg-gray-200 rounded-full px-3 py-1.5 text-xs font-semibold"
              >
                <Download size={12} /> CSV
              </button>
              <div className="flex items-center gap-1.5 bg-gray-50 border border-gray-200 rounded-full px-3 py-1.5">
                <Search size={12} className="text-gray-400" />
                <input value={supplierSearch} onChange={e => setSupplierSearch(e.target.value)} placeholder={t.name + '...'} className="text-xs outline-none bg-transparent w-32" />
              </div>
              <button onClick={() => setShowSupplierModal(true)} className="apple-button-primary">
                <Plus size={14} /> {t.add}
              </button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="apple-table">
              <thead>
                <tr className="border-b border-gray-100">
                  <SortHeader
                    label={t.name}
                    sortKey="name"
                    currentSort={{ key: tedarikciSortKey, direction: tedarikciSortDir }}
                    onSort={(key) => toggleTedarikciSort(key as TedarikciSortKey)}
                  />
                  <SortHeader
                    label={t.company}
                    sortKey="company"
                    currentSort={{ key: tedarikciSortKey, direction: tedarikciSortDir }}
                    onSort={(key) => toggleTedarikciSort(key as TedarikciSortKey)}
                    className="hidden sm:table-cell"
                  />
                  <th className="text-left py-3 px-4 text-[10px] font-bold text-[#86868B] uppercase tracking-wider hidden md:table-cell">{t.email}</th>
                  <SortHeader
                    label={t.phone}
                    sortKey="phone"
                    currentSort={{ key: tedarikciSortKey, direction: tedarikciSortDir }}
                    onSort={(key) => toggleTedarikciSort(key as TedarikciSortKey)}
                    className="hidden sm:table-cell"
                  />
                  <th className="text-left py-3 px-4 text-[10px] font-bold text-[#86868B] uppercase tracking-wider hidden lg:table-cell">{t.taxNo}</th>
                  <th className="py-3 px-4"></th>
                </tr>
              </thead>
              <tbody>
                {displayedTedarikciler.length === 0 && (
                  <tr><td colSpan={6} className="text-center py-8 text-gray-400">{t.noRecords}</td></tr>
                )}
                {displayedTedarikciler.map(s => (
                  <tr key={s.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="py-2.5 px-3 font-medium text-gray-800">{s.name}</td>
                    <td className="py-2.5 px-3 text-gray-500 hidden sm:table-cell">{s.company || '—'}</td>
                    <td className="py-2.5 px-3 text-gray-500 hidden md:table-cell text-xs">{s.email || '—'}</td>
                    <td className="py-2.5 px-3 text-gray-500 hidden sm:table-cell text-xs">{s.phone || '—'}</td>
                    <td className="py-2.5 px-3 text-gray-500 hidden lg:table-cell text-xs">{s.taxNo || '—'}</td>
                    <td className="py-2.5 px-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={() => setEkstreTedarikci(s)} title={currentLanguage === 'tr' ? 'Cari ekstre / hareketleri' : 'Account statement'} className="p-1.5 hover:bg-blue-50 rounded-lg transition-colors text-blue-500"><Eye size={13} /></button>
                        <button onClick={() => { setEditingSupplier(s); setSupplierForm({ name: s.name, company: s.company || '', email: s.email || '', phone: s.phone || '', address: s.address || '', taxNo: s.taxNo || '', notes: s.notes || '' }); setShowSupplierModal(true); }} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors text-gray-500"><Edit2 size={13} /></button>
                        <button onClick={() => deleteSupplier(s.id)} className="p-1.5 hover:bg-red-50 rounded-lg transition-colors text-red-500"><Trash2 size={13} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Cari ekstre / hareket detayı — tedarikçi adına/göze tıklayınca. Mikro'da
            tek cari havuzu olduğundan aynı CariEkstrePanel (mikroCariHareketler,
            cariKod ile) yeniden kullanılıyor — Cariler sekmesindeki desenin aynısı. */}
        {ekstreTedarikci && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setEkstreTedarikci(null)}>
            <div className="bg-white rounded-2xl w-full max-w-4xl max-h-[88vh] flex flex-col shadow-xl overflow-hidden" onClick={e => e.stopPropagation()}>
              <div className="flex items-start justify-between p-5 border-b border-gray-100 shrink-0">
                <div>
                  <h3 className="font-bold text-[#1D1D1F]">{currentLanguage === 'tr' ? 'Cari Ekstre' : 'Account Statement'}</h3>
                  <p className="text-xs text-gray-500 mt-0.5">{ekstreTedarikci.name}</p>
                </div>
                <button onClick={() => setEkstreTedarikci(null)} className="p-1 rounded-lg hover:bg-gray-100 text-gray-400"><X size={18} /></button>
              </div>
              <div className="overflow-y-auto flex-1 p-2 sm:p-4">
                {(() => {
                  const cariKod = ekstreTedarikci.mikroCariKod || ekstreTedarikci.taxNo || '';
                  return cariKod
                    ? <CariEkstrePanel currentLanguage={currentLanguage} cariKod={cariKod} customerName={ekstreTedarikci.name} />
                    : <p className="text-center text-gray-400 text-sm py-8">{currentLanguage === 'tr' ? 'Bu tedarikçi bir Mikro cari koduna bağlı değil (elle eklenmiş).' : 'This supplier is not linked to a Mikro cari code (manually added).'}</p>;
                })()}
              </div>
            </div>
          </div>
        )}
      </motion.div>

      {/* SUPPLIER MODAL */}
      <AnimatePresence>
        {showSupplierModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowSupplierModal(false)} />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-white rounded-2xl shadow-2xl w-full max-w-md relative z-10 overflow-hidden">
              <div className="flex items-center justify-between p-5 border-b border-gray-100">
                <h3 className="font-semibold text-gray-800">{t.tedarikciler} — {editingSupplier ? t.editAccount : t.add}</h3>
                <button onClick={() => setShowSupplierModal(false)} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"><X size={16} /></button>
              </div>
              <div className="p-5 space-y-3 max-h-[70vh] overflow-y-auto">
                {[
                  { label: t.name, key: 'name', type: 'text', placeholder: 'Tedarikçi Adı' },
                  { label: t.company, key: 'company', type: 'text', placeholder: 'XYZ A.Ş.' },
                  { label: t.email, key: 'email', type: 'email', placeholder: 'info@tedarikci.com' },
                  { label: t.phone, key: 'phone', type: 'text', placeholder: '+90 555 000 0000' },
                  { label: t.address, key: 'address', type: 'text', placeholder: 'Ankara, Türkiye' },
                  { label: t.taxNo, key: 'taxNo', type: 'text', placeholder: '9876543210' },
                  { label: t.notes2, key: 'notes', type: 'text', placeholder: '...' },
                ].map(f => (
                  <div key={f.key}>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{f.label}</label>
                    <input type={f.type} value={supplierForm[f.key as keyof typeof supplierForm]} onChange={e => setSupplierForm(prev => ({ ...prev, [f.key]: e.target.value }))} placeholder={f.placeholder} className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]" />
                  </div>
                ))}
              </div>
              <div className="flex justify-end gap-2 p-5 border-t border-gray-100">
                <button onClick={() => setShowSupplierModal(false)} className="bg-gray-100 hover:bg-gray-200 rounded-full px-4 py-2 text-sm font-semibold transition-colors">{t.cancel}</button>
                <button onClick={saveSupplier} className="apple-button-primary"><Save size={14} /> {t.save}</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
