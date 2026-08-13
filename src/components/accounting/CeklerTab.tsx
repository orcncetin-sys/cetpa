import { motion, AnimatePresence } from 'motion/react';
import { Download, Search, Plus, Eye, Edit2, Trash2, X, Save } from 'lucide-react';
import { type Check } from '../../types';
import { SortHeader, formatTRY, exportCSV, type AccountingT } from './shared';

interface CeklerTabProps {
  t: AccountingT;
  checks: Check[];
  displayedCekler: Check[];
  checkSearch: string;
  setCheckSearch: (v: string) => void;
  cekSortKey: 'checkNo' | 'amount' | 'dueDate' | 'type';
  cekSortDir: 'asc' | 'desc';
  toggleCekSort: (key: 'checkNo' | 'amount' | 'dueDate' | 'type') => void;
  showCheckModal: boolean;
  setShowCheckModal: (v: boolean) => void;
  editingCheck: Check | null;
  setEditingCheck: (c: Check | null) => void;
  checkForm: { checkNo: string; bankName: string; amount: number; dueDate: string; drawer: string; type: Check['type']; status: Check['status'] };
  setCheckForm: React.Dispatch<React.SetStateAction<{ checkNo: string; bankName: string; amount: number; dueDate: string; drawer: string; type: Check['type']; status: Check['status'] }>>;
  saveCheck: () => void;
  deleteCheck: (id: string) => void;
}

export default function CeklerTab({
  t, checks, displayedCekler, checkSearch, setCheckSearch, cekSortKey, cekSortDir, toggleCekSort,
  showCheckModal, setShowCheckModal, editingCheck, setEditingCheck, checkForm, setCheckForm, saveCheck, deleteCheck,
}: CeklerTabProps) {
  return (
    <>
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <h3 className="font-semibold text-gray-800">{t.cekler}</h3>
            <div className="flex items-center gap-2">
              <button
                onClick={() => exportCSV('cekler.csv',
                  [t.checkNo, t.bank2, t.amount2, t.dueDate, t.drawer, t.checkType],
                  checks.map(c => [c.checkNo, c.bankName, c.amount, c.dueDate, c.drawer, c.type])
                )}
                className="flex items-center gap-1 bg-gray-100 hover:bg-gray-200 rounded-full px-3 py-1.5 text-xs font-semibold"
              >
                <Download size={12} /> CSV
              </button>
              <div className="flex items-center gap-1.5 bg-gray-50 border border-gray-200 rounded-full px-3 py-1.5">
                <Search size={12} className="text-gray-400" />
                <input value={checkSearch} onChange={e => setCheckSearch(e.target.value)} placeholder={t.checkNo + '...'} className="text-xs outline-none bg-transparent w-32" />
              </div>
              <button onClick={() => setShowCheckModal(true)} className="apple-button-primary">
                <Plus size={14} /> {t.add}
              </button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="apple-table">
              <thead>
                <tr className="border-b border-gray-100">
                  <SortHeader
                    label={t.checkNo}
                    sortKey="checkNo"
                    currentSort={{ key: cekSortKey, direction: cekSortDir }}
                    onSort={(key) => toggleCekSort(key as 'checkNo' | 'amount' | 'dueDate' | 'type')}
                  />
                  <th className="text-left py-3 px-4 text-[10px] font-bold text-[#86868B] uppercase tracking-wider hidden sm:table-cell">{t.bank2}</th>
                  <SortHeader
                    label={t.amount2}
                    sortKey="amount"
                    currentSort={{ key: cekSortKey, direction: cekSortDir }}
                    onSort={(key) => toggleCekSort(key as 'checkNo' | 'amount' | 'dueDate' | 'type')}
                    className="text-right"
                  />
                  <SortHeader
                    label={t.dueDate}
                    sortKey="dueDate"
                    currentSort={{ key: cekSortKey, direction: cekSortDir }}
                    onSort={(key) => toggleCekSort(key as 'checkNo' | 'amount' | 'dueDate' | 'type')}
                    className="hidden md:table-cell"
                  />
                  <th className="text-left py-3 px-4 text-[10px] font-bold text-[#86868B] uppercase tracking-wider hidden lg:table-cell">{t.drawer}</th>
                  <SortHeader
                    label={t.checkType}
                    sortKey="type"
                    currentSort={{ key: cekSortKey, direction: cekSortDir }}
                    onSort={(key) => toggleCekSort(key as 'checkNo' | 'amount' | 'dueDate' | 'type')}
                    className="text-center"
                  />
                  <th className="py-3 px-4"></th>
                </tr>
              </thead>
              <tbody>
                {displayedCekler.length === 0 && (
                  <tr><td colSpan={7} className="text-center py-8 text-gray-400">{t.noRecords}</td></tr>
                )}
                {displayedCekler.map(c => (
                  <tr key={c.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="py-2.5 px-3 font-mono text-xs text-gray-800">{c.checkNo}</td>
                    <td className="py-2.5 px-3 text-gray-500 hidden sm:table-cell">{c.bankName}</td>
                    <td className="py-2.5 px-3 text-right font-semibold">{formatTRY(c.amount)}</td>
                    <td className="py-2.5 px-3 text-xs text-gray-500 hidden md:table-cell">{c.dueDate}</td>
                    <td className="py-2.5 px-3 text-xs text-gray-500 hidden lg:table-cell">{c.drawer}</td>
                    <td className="py-2.5 px-3 text-center"><span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${c.type === 'Alınan' ? 'bg-green-100 text-green-600' : 'bg-orange-100 text-orange-600'}`}>{c.type}</span></td>
                    <td className="py-2.5 px-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={() => { setEditingCheck(c); setCheckForm({ checkNo: c.checkNo, bankName: c.bankName, amount: c.amount, dueDate: c.dueDate, drawer: c.drawer, type: c.type, status: c.status }); setShowCheckModal(true); }} className="p-1.5 hover:bg-blue-50 rounded-lg transition-colors text-blue-500"><Eye size={13} /></button>
                        <button onClick={() => { setEditingCheck(c); setCheckForm({ checkNo: c.checkNo, bankName: c.bankName, amount: c.amount, dueDate: c.dueDate, drawer: c.drawer, type: c.type, status: c.status }); setShowCheckModal(true); }} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors text-gray-500"><Edit2 size={13} /></button>
                        <button onClick={() => deleteCheck(c.id)} className="p-1.5 hover:bg-red-50 rounded-lg transition-colors text-red-500"><Trash2 size={13} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </motion.div>

      {/* CHECK MODAL */}
      <AnimatePresence>
        {showCheckModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowCheckModal(false)} />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-white rounded-2xl shadow-2xl w-full max-w-md relative z-10 overflow-hidden">
              <div className="flex items-center justify-between p-5 border-b border-gray-100">
                <h3 className="font-semibold text-gray-800">{t.cekler} — {editingCheck ? t.editAccount : t.add}</h3>
                <button onClick={() => setShowCheckModal(false)} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"><X size={16} /></button>
              </div>
              <div className="p-5 space-y-3 max-h-[70vh] overflow-y-auto">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{t.checkNo}</label>
                    <input type="text" value={checkForm.checkNo} onChange={e => setCheckForm(prev => ({ ...prev, checkNo: e.target.value }))} placeholder="ÇEK-001" className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{t.checkType}</label>
                    <select value={checkForm.type} onChange={e => setCheckForm(prev => ({ ...prev, type: e.target.value as Check['type'] }))} className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]">
                      <option value="Alınan">{t.received}</option>
                      <option value="Verilen">{t.given}</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{t.bank2}</label>
                  <input type="text" value={checkForm.bankName} onChange={e => setCheckForm(prev => ({ ...prev, bankName: e.target.value }))} placeholder="Ziraat Bankası" className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{t.amount2}</label>
                    <input type="number" value={checkForm.amount} onChange={e => setCheckForm(prev => ({ ...prev, amount: Number(e.target.value) }))} className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{t.dueDate}</label>
                    <input type="date" value={checkForm.dueDate} onChange={e => setCheckForm(prev => ({ ...prev, dueDate: e.target.value }))} className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{t.drawer}</label>
                  <input type="text" value={checkForm.drawer} onChange={e => setCheckForm(prev => ({ ...prev, drawer: e.target.value }))} placeholder="Lehtar / Borçlu adı" className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]" />
                </div>
              </div>
              <div className="flex justify-end gap-2 p-5 border-t border-gray-100">
                <button onClick={() => setShowCheckModal(false)} className="bg-gray-100 hover:bg-gray-200 rounded-full px-4 py-2 text-sm font-semibold transition-colors">{t.cancel}</button>
                <button onClick={saveCheck} className="apple-button-primary"><Save size={14} /> {t.save}</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
