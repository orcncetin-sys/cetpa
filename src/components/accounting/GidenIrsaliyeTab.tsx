import { motion } from 'motion/react';
import { Search, Plus, Eye, Edit2, Trash2 } from 'lucide-react';
import { type Waybill } from '../../types';
import { SortHeader, formatTRY, type AccountingT } from './shared';

type WaybillForm = {
  waybillNo: string; invoiceNo: string; party: string; date: string;
  items: Waybill['items']; total: number; status: Waybill['status'];
};
type IrsaliyeSortKey = 'waybillNo' | 'party' | 'date' | 'total' | 'status' | 'type';

interface GidenIrsaliyeTabProps {
  t: AccountingT;
  waybillSearch: string;
  setWaybillSearch: (v: string) => void;
  setWaybillType: (v: 'giden' | 'gelen') => void;
  setShowWaybillModal: (v: boolean) => void;
  irsaliyeSortKey: IrsaliyeSortKey;
  irsaliyeSortDir: 'asc' | 'desc';
  toggleIrsaliyeSort: (key: IrsaliyeSortKey) => void;
  makeDisplayedWaybills: (type: 'giden' | 'gelen') => Waybill[];
  setEditingWaybill: (w: Waybill | null) => void;
  setWaybillForm: React.Dispatch<React.SetStateAction<WaybillForm>>;
  deleteWaybill: (id: string) => void;
}

export default function GidenIrsaliyeTab({
  t, waybillSearch, setWaybillSearch, setWaybillType, setShowWaybillModal,
  irsaliyeSortKey, irsaliyeSortDir, toggleIrsaliyeSort, makeDisplayedWaybills,
  setEditingWaybill, setWaybillForm, deleteWaybill,
}: GidenIrsaliyeTabProps) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h3 className="font-semibold text-gray-800">{t.gidenIrsaliye}</h3>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 bg-gray-50 border border-gray-200 rounded-full px-3 py-1.5">
              <Search size={12} className="text-gray-400" />
              <input value={waybillSearch} onChange={e => setWaybillSearch(e.target.value)} placeholder={t.waybillNo + '...'} className="text-xs outline-none bg-transparent w-32" />
            </div>
            <button onClick={() => { setWaybillType('giden'); setShowWaybillModal(true); }} className="apple-button-primary">
              <Plus size={14} /> {t.add}
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="apple-table">
            <thead>
              <tr className="border-b border-gray-100">
                <SortHeader
                  label={t.waybillNo}
                  sortKey="waybillNo"
                  currentSort={{ key: irsaliyeSortKey, direction: irsaliyeSortDir }}
                  onSort={(key) => toggleIrsaliyeSort(key as IrsaliyeSortKey)}
                />
                <SortHeader
                  label={t.customer2}
                  sortKey="party"
                  currentSort={{ key: irsaliyeSortKey, direction: irsaliyeSortDir }}
                  onSort={(key) => toggleIrsaliyeSort(key as IrsaliyeSortKey)}
                  className="hidden sm:table-cell"
                />
                <SortHeader
                  label={t.date}
                  sortKey="date"
                  currentSort={{ key: irsaliyeSortKey, direction: irsaliyeSortDir }}
                  onSort={(key) => toggleIrsaliyeSort(key as IrsaliyeSortKey)}
                  className="hidden md:table-cell"
                />
                <th className="text-left py-3 px-4 text-[10px] font-bold text-[#86868B] uppercase tracking-wider hidden lg:table-cell">{t.product}</th>
                <SortHeader
                  label={t.total2}
                  sortKey="total"
                  currentSort={{ key: irsaliyeSortKey, direction: irsaliyeSortDir }}
                  onSort={(key) => toggleIrsaliyeSort(key as IrsaliyeSortKey)}
                  className="text-right"
                />
                <SortHeader
                  label={t.status2}
                  sortKey="status"
                  currentSort={{ key: irsaliyeSortKey, direction: irsaliyeSortDir }}
                  onSort={(key) => toggleIrsaliyeSort(key as IrsaliyeSortKey)}
                  className="text-center"
                />
                <th className="py-3 px-4"></th>
              </tr>
            </thead>
            <tbody>
              {makeDisplayedWaybills('giden').length === 0 && (
                <tr><td colSpan={7} className="text-center py-8 text-gray-400">{t.noRecords}</td></tr>
              )}
              {makeDisplayedWaybills('giden').map(w => (
                <tr key={w.id} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="py-2.5 px-3 font-mono text-xs text-gray-800">{w.waybillNo}</td>
                  <td className="py-2.5 px-3 text-gray-600 hidden sm:table-cell">{w.party}</td>
                  <td className="py-2.5 px-3 text-xs text-gray-500 hidden md:table-cell">{w.date}</td>
                  <td className="py-2.5 px-3 text-xs text-gray-500 hidden lg:table-cell">{w.items?.map(i => i.productName).join(', ') || '—'}</td>
                  <td className="py-2.5 px-3 text-right font-semibold">{w.total ? formatTRY(w.total) : '—'}</td>
                  <td className="py-2.5 px-3 text-center"><span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${w.status === 'Tamamlandı' ? 'bg-green-100 text-green-600' : w.status === 'İptal' ? 'bg-red-100 text-red-500' : 'bg-yellow-100 text-yellow-600'}`}>{w.status}</span></td>
                  <td className="py-2.5 px-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => { setEditingWaybill(w); setWaybillForm({ waybillNo: w.waybillNo, invoiceNo: w.invoiceNo || '', party: w.party, date: w.date, items: w.items || [], total: w.total || 0, status: w.status }); setWaybillType('giden'); setShowWaybillModal(true); }} className="p-1.5 hover:bg-blue-50 rounded-lg transition-colors text-blue-500"><Eye size={13} /></button>
                      <button onClick={() => { setEditingWaybill(w); setWaybillForm({ waybillNo: w.waybillNo, invoiceNo: w.invoiceNo || '', party: w.party, date: w.date, items: w.items || [], total: w.total || 0, status: w.status }); setWaybillType('giden'); setShowWaybillModal(true); }} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors text-gray-500"><Edit2 size={13} /></button>
                      <button onClick={() => deleteWaybill(w.id)} className="p-1.5 hover:bg-red-50 rounded-lg transition-colors text-red-500"><Trash2 size={13} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </motion.div>
  );
}
