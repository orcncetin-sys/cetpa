import { motion, AnimatePresence } from 'motion/react';
import { Download, Search, Plus, Eye, Edit2, Trash2, X, Save } from 'lucide-react';
import { type Service } from '../../types';
import { SortHeader, formatTRY, exportCSV, type AccountingT } from './shared';

type ServiceForm = { code: string; name: string; type: 'Ürün' | 'Hizmet'; unitPrice: number; vatRate: number; unit: string; notes: string };

interface UrunlerTabProps {
  t: AccountingT;
  services: Service[];
  displayedServisler: Service[];
  serviceSearch: string;
  setServiceSearch: (v: string) => void;
  servisSortKey: 'name' | 'code' | 'unitPrice' | 'vatRate';
  servisSortDir: 'asc' | 'desc';
  toggleServisSort: (key: 'name' | 'code' | 'unitPrice' | 'vatRate') => void;
  showServiceModal: boolean;
  setShowServiceModal: (v: boolean) => void;
  editingService: Service | null;
  setEditingService: (s: Service | null) => void;
  serviceForm: ServiceForm;
  setServiceForm: React.Dispatch<React.SetStateAction<ServiceForm>>;
  saveService: () => void;
  deleteService: (id: string) => void;
}

export default function UrunlerTab({
  t, services, displayedServisler, serviceSearch, setServiceSearch,
  servisSortKey, servisSortDir, toggleServisSort,
  showServiceModal, setShowServiceModal, editingService, setEditingService,
  serviceForm, setServiceForm, saveService, deleteService,
}: UrunlerTabProps) {
  return (
    <>
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <h3 className="font-semibold text-gray-800">{t.urunler}</h3>
            <div className="flex items-center gap-2">
              <button
                onClick={() => exportCSV('urunler.csv',
                  [t.code, t.name, t.type2, t.unitPrice, t.vatRate, t.unit],
                  services.map(s => [s.code, s.name, s.type, s.unitPrice, s.vatRate, s.unit])
                )}
                className="flex items-center gap-1 bg-gray-100 hover:bg-gray-200 rounded-full px-3 py-1.5 text-xs font-semibold"
              >
                <Download size={12} /> CSV
              </button>
              <div className="flex items-center gap-1.5 bg-gray-50 border border-gray-200 rounded-full px-3 py-1.5">
                <Search size={12} className="text-gray-400" />
                <input value={serviceSearch} onChange={e => setServiceSearch(e.target.value)} placeholder={t.name + '...'} className="text-xs outline-none bg-transparent w-32" />
              </div>
              <button onClick={() => setShowServiceModal(true)} className="apple-button-primary">
                <Plus size={14} /> {t.add}
              </button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="apple-table">
              <thead>
                <tr className="border-b border-gray-100">
                  <SortHeader label={t.code} sortKey="code" currentSort={{ key: servisSortKey, direction: servisSortDir }} onSort={(key) => toggleServisSort(key as 'code' | 'name' | 'unitPrice' | 'vatRate')} />
                  <SortHeader label={t.name} sortKey="name" currentSort={{ key: servisSortKey, direction: servisSortDir }} onSort={(key) => toggleServisSort(key as 'code' | 'name' | 'unitPrice' | 'vatRate')} />
                  <th className="text-left py-3 px-4 text-[10px] font-bold text-[#86868B] uppercase tracking-wider hidden sm:table-cell">{t.type2}</th>
                  <SortHeader label={t.unitPrice} sortKey="unitPrice" currentSort={{ key: servisSortKey, direction: servisSortDir }} onSort={(key) => toggleServisSort(key as 'code' | 'name' | 'unitPrice' | 'vatRate')} className="text-right" />
                  <SortHeader label="KDV%" sortKey="vatRate" currentSort={{ key: servisSortKey, direction: servisSortDir }} onSort={(key) => toggleServisSort(key as 'code' | 'name' | 'unitPrice' | 'vatRate')} className="text-center hidden sm:table-cell" />
                  <th className="text-left py-3 px-4 text-[10px] font-bold text-[#86868B] uppercase tracking-wider hidden md:table-cell">{t.unit}</th>
                  <th className="py-3 px-4"></th>
                </tr>
              </thead>
              <tbody>
                {displayedServisler.length === 0 && (
                  <tr><td colSpan={7} className="text-center py-8 text-gray-400">{t.noRecords}</td></tr>
                )}
                {displayedServisler.map(s => (
                  <tr key={s.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="py-2.5 px-3 font-mono text-xs text-gray-600">{s.code}</td>
                    <td className="py-2.5 px-3 font-medium text-gray-800">{s.name}</td>
                    <td className="py-2.5 px-3 hidden sm:table-cell"><span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${s.type === 'Hizmet' ? 'bg-blue-100 text-blue-600' : 'bg-green-100 text-green-600'}`}>{s.type}</span></td>
                    <td className="py-2.5 px-3 text-right font-semibold">{formatTRY(s.unitPrice)}</td>
                    <td className="py-2.5 px-3 text-center text-xs text-gray-500 hidden sm:table-cell">%{s.vatRate}</td>
                    <td className="py-2.5 px-3 text-xs text-gray-500 hidden md:table-cell">{s.unit}</td>
                    <td className="py-2.5 px-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={() => { setEditingService(s); setServiceForm({ code: s.code, name: s.name, type: s.type, unitPrice: s.unitPrice, vatRate: s.vatRate, unit: s.unit, notes: s.notes || '' }); setShowServiceModal(true); }} className="p-1.5 hover:bg-blue-50 rounded-lg transition-colors text-blue-500"><Eye size={13} /></button>
                        <button onClick={() => { setEditingService(s); setServiceForm({ code: s.code, name: s.name, type: s.type, unitPrice: s.unitPrice, vatRate: s.vatRate, unit: s.unit, notes: s.notes || '' }); setShowServiceModal(true); }} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors text-gray-500"><Edit2 size={13} /></button>
                        <button onClick={() => deleteService(s.id)} className="p-1.5 hover:bg-red-50 rounded-lg transition-colors text-red-500"><Trash2 size={13} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </motion.div>

      {/* SERVICE MODAL */}
      <AnimatePresence>
        {showServiceModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowServiceModal(false)} />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-white rounded-2xl shadow-2xl w-full max-w-md relative z-10 overflow-hidden">
              <div className="flex items-center justify-between p-5 border-b border-gray-100">
                <h3 className="font-semibold text-gray-800">{t.urunler} — {editingService ? t.editAccount : t.add}</h3>
                <button onClick={() => setShowServiceModal(false)} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"><X size={16} /></button>
              </div>
              <div className="p-5 space-y-3 max-h-[70vh] overflow-y-auto">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{t.code}</label>
                    <input type="text" value={serviceForm.code} onChange={e => setServiceForm(prev => ({ ...prev, code: e.target.value }))} placeholder="PRD-001" className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{t.type2}</label>
                    <select value={serviceForm.type} onChange={e => setServiceForm(prev => ({ ...prev, type: e.target.value as 'Ürün' | 'Hizmet' }))} className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]">
                      <option value="Ürün">Ürün</option>
                      <option value="Hizmet">Hizmet</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{t.name}</label>
                  <input type="text" value={serviceForm.name} onChange={e => setServiceForm(prev => ({ ...prev, name: e.target.value }))} placeholder="Ürün / Hizmet Adı" className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{t.unitPrice}</label>
                    <input type="number" value={serviceForm.unitPrice} onChange={e => setServiceForm(prev => ({ ...prev, unitPrice: Number(e.target.value) }))} className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">KDV%</label>
                    <select value={serviceForm.vatRate} onChange={e => setServiceForm(prev => ({ ...prev, vatRate: Number(e.target.value) }))} className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]">
                      <option value={0}>%0</option><option value={8}>%8</option><option value={18}>%18</option><option value={20}>%20</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{t.unit}</label>
                  <input type="text" value={serviceForm.unit} onChange={e => setServiceForm(prev => ({ ...prev, unit: e.target.value }))} placeholder="Adet, Kg, Saat..." className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{t.notes2}</label>
                  <input type="text" value={serviceForm.notes} onChange={e => setServiceForm(prev => ({ ...prev, notes: e.target.value }))} placeholder="..." className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]" />
                </div>
              </div>
              <div className="flex justify-end gap-2 p-5 border-t border-gray-100">
                <button onClick={() => setShowServiceModal(false)} className="bg-gray-100 hover:bg-gray-200 rounded-full px-4 py-2 text-sm font-semibold transition-colors">{t.cancel}</button>
                <button onClick={saveService} className="apple-button-primary"><Save size={14} /> {t.save}</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
