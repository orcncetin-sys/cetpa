import { motion, AnimatePresence } from 'motion/react';
import { Search, Plus, Eye, Edit2, Trash2, X, Save } from 'lucide-react';
import { type Transfer } from '../../types';
import { SortHeader, type AccountingT } from './shared';
import MikroPushButton from '../MikroPushButton';
import { depoTransferPayload } from '../../services/mikroEvrak';

type TransferForm = { fromWarehouse: string; toWarehouse: string; productName: string; quantity: number; date: string; notes: string; status: Transfer['status'] };

interface TransferTabProps {
  t: AccountingT;
  transferSearch: string;
  setTransferSearch: (v: string) => void;
  transferSortKey: 'productName' | 'quantity' | 'date' | 'status';
  transferSortDir: 'asc' | 'desc';
  toggleTransferSort: (key: 'productName' | 'quantity' | 'date' | 'status') => void;
  displayedTransfers: Transfer[];
  showTransferModal: boolean;
  setShowTransferModal: (v: boolean) => void;
  editingTransfer: Transfer | null;
  setEditingTransfer: (t: Transfer | null) => void;
  transferForm: TransferForm;
  setTransferForm: React.Dispatch<React.SetStateAction<TransferForm>>;
  saveTransfer: () => void;
  deleteTransfer: (id: string) => void;
}

export default function TransferTab({
  t, transferSearch, setTransferSearch, transferSortKey, transferSortDir, toggleTransferSort,
  displayedTransfers, showTransferModal, setShowTransferModal, editingTransfer, setEditingTransfer,
  transferForm, setTransferForm, saveTransfer, deleteTransfer,
}: TransferTabProps) {
  return (
    <>
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <h3 className="font-semibold text-gray-800">{t.transfer}</h3>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5 bg-gray-50 border border-gray-200 rounded-full px-3 py-1.5">
                <Search size={12} className="text-gray-400" />
                <input value={transferSearch} onChange={e => setTransferSearch(e.target.value)} placeholder={t.product + '...'} className="text-xs outline-none bg-transparent w-32" />
              </div>
              <button onClick={() => setShowTransferModal(true)} className="apple-button-primary">
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
                    currentSort={{ key: transferSortKey, direction: transferSortDir }}
                    onSort={(key) => toggleTransferSort(key as 'productName' | 'quantity' | 'date' | 'status')}
                  />
                  <th className="text-left py-3 px-4 text-[10px] font-bold text-[#86868B] uppercase tracking-wider hidden sm:table-cell">{t.fromWarehouse}</th>
                  <th className="text-left py-3 px-4 text-[10px] font-bold text-[#86868B] uppercase tracking-wider hidden sm:table-cell">{t.toWarehouse}</th>
                  <SortHeader
                    label={t.quantity}
                    sortKey="quantity"
                    currentSort={{ key: transferSortKey, direction: transferSortDir }}
                    onSort={(key) => toggleTransferSort(key as 'productName' | 'quantity' | 'date' | 'status')}
                    className="text-right"
                  />
                  <SortHeader
                    label={t.date}
                    sortKey="date"
                    currentSort={{ key: transferSortKey, direction: transferSortDir }}
                    onSort={(key) => toggleTransferSort(key as 'productName' | 'quantity' | 'date' | 'status')}
                    className="hidden md:table-cell"
                  />
                  <SortHeader
                    label={t.status2}
                    sortKey="status"
                    currentSort={{ key: transferSortKey, direction: transferSortDir }}
                    onSort={(key) => toggleTransferSort(key as 'productName' | 'quantity' | 'date' | 'status')}
                    className="text-center"
                  />
                  <th className="py-3 px-4"></th>
                </tr>
              </thead>
              <tbody>
                {displayedTransfers.length === 0 && (
                  <tr><td colSpan={7} className="text-center py-8 text-gray-400">{t.noRecords}</td></tr>
                )}
                {displayedTransfers.map(tr => (
                  <tr key={tr.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="py-2.5 px-3 font-medium text-gray-800">
                      <div className="flex items-center gap-1.5">
                        {tr.productName}
                        <MikroPushButton
                          compact
                          method="DepolarArasiSiparisKaydetV2"
                          entityType="transfer"
                          entityId={tr.id}
                          buildPayload={() => {
                            const depoNo = (s: string) => parseInt((s.match(/\d+/) ?? ['1'])[0], 10);
                            const sku = (tr as unknown as { sku?: string }).sku;
                            if (!sku) return null; // SKU'suz transfer Mikro'ya gidemez
                            return depoTransferPayload({
                              sku,
                              quantity: tr.quantity,
                              fromDepo: depoNo(tr.fromWarehouse),
                              toDepo: depoNo(tr.toWarehouse),
                              date: tr.date,
                              note: tr.notes,
                            });
                          }}
                        />
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-gray-500 hidden sm:table-cell text-xs">{tr.fromWarehouse}</td>
                    <td className="py-2.5 px-3 text-gray-500 hidden sm:table-cell text-xs">{tr.toWarehouse}</td>
                    <td className="py-2.5 px-3 text-right font-semibold">{tr.quantity}</td>
                    <td className="py-2.5 px-3 text-xs text-gray-500 hidden md:table-cell">{tr.date}</td>
                    <td className="py-2.5 px-3 text-center"><span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${tr.status === 'Tamamlandı' ? 'bg-green-100 text-green-600' : tr.status === 'İptal' ? 'bg-red-100 text-red-500' : 'bg-yellow-100 text-yellow-600'}`}>{tr.status}</span></td>
                    <td className="py-2.5 px-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={() => { setEditingTransfer(tr); setTransferForm({ fromWarehouse: tr.fromWarehouse, toWarehouse: tr.toWarehouse, productName: tr.productName, quantity: tr.quantity, date: tr.date, notes: tr.notes || '', status: tr.status }); setShowTransferModal(true); }} className="p-1.5 hover:bg-blue-50 rounded-lg transition-colors text-blue-500"><Eye size={13} /></button>
                        <button onClick={() => { setEditingTransfer(tr); setTransferForm({ fromWarehouse: tr.fromWarehouse, toWarehouse: tr.toWarehouse, productName: tr.productName, quantity: tr.quantity, date: tr.date, notes: tr.notes || '', status: tr.status }); setShowTransferModal(true); }} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors text-gray-500"><Edit2 size={13} /></button>
                        <button onClick={() => deleteTransfer(tr.id)} className="p-1.5 hover:bg-red-50 rounded-lg transition-colors text-red-500"><Trash2 size={13} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </motion.div>

      {/* TRANSFER MODAL */}
      <AnimatePresence>
        {showTransferModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowTransferModal(false)} />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-white rounded-2xl shadow-2xl w-full max-w-md relative z-10 overflow-hidden">
              <div className="flex items-center justify-between p-5 border-b border-gray-100">
                <h3 className="font-semibold text-gray-800">{t.transfer} — {editingTransfer ? t.editAccount : t.add}</h3>
                <button onClick={() => setShowTransferModal(false)} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"><X size={16} /></button>
              </div>
              <div className="p-5 space-y-3 max-h-[70vh] overflow-y-auto">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{t.product}</label>
                  <input type="text" value={transferForm.productName} onChange={e => setTransferForm(prev => ({ ...prev, productName: e.target.value }))} placeholder="Ürün adı" className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{t.fromWarehouse}</label>
                    <input type="text" value={transferForm.fromWarehouse} onChange={e => setTransferForm(prev => ({ ...prev, fromWarehouse: e.target.value }))} placeholder="Depo A" className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{t.toWarehouse}</label>
                    <input type="text" value={transferForm.toWarehouse} onChange={e => setTransferForm(prev => ({ ...prev, toWarehouse: e.target.value }))} placeholder="Depo B" className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{t.quantity}</label>
                    <input type="number" value={transferForm.quantity} onChange={e => setTransferForm(prev => ({ ...prev, quantity: Number(e.target.value) }))} className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{t.date}</label>
                    <input type="date" value={transferForm.date} onChange={e => setTransferForm(prev => ({ ...prev, date: e.target.value }))} className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{t.status2}</label>
                  <select value={transferForm.status} onChange={e => setTransferForm(prev => ({ ...prev, status: e.target.value as Transfer['status'] }))} className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]">
                    <option value="Bekliyor">Bekliyor</option><option value="Tamamlandı">Tamamlandı</option><option value="İptal">İptal</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{t.notes2}</label>
                  <input type="text" value={transferForm.notes} onChange={e => setTransferForm(prev => ({ ...prev, notes: e.target.value }))} placeholder="..." className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]" />
                </div>
              </div>
              <div className="flex justify-end gap-2 p-5 border-t border-gray-100">
                <button onClick={() => setShowTransferModal(false)} className="bg-gray-100 hover:bg-gray-200 rounded-full px-4 py-2 text-sm font-semibold transition-colors">{t.cancel}</button>
                <button onClick={saveTransfer} className="apple-button-primary"><Save size={14} /> {t.save}</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
