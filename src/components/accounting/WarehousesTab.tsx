import { motion, AnimatePresence } from 'motion/react';
import { Plus, Eye, Edit2, Trash2, X, Save, MapPin, User, Home } from 'lucide-react';
import { type Warehouse, type WarehouseItem } from '../../types';
import { formatTRY, type AccountingT } from './shared';
import { oc } from '../../i18n/ortak';
import { depoToplamlari, adetYaz } from '../../utils/muhasebe/depoDeger';
import { ekranTutari, sayiSirala } from '../../utils/para';
import { ac } from '../../i18n/accounting';

type WarehouseForm = { name: string; location: string; manager: string; notes: string };

interface WarehousesTabProps {
  t: AccountingT;
  currentLanguage: string;
  warehouses: Warehouse[];
  depoKalemleriIcin: (whId: string) => Array<WarehouseItem & { quantity: number }>;
  detayDepo: Warehouse | null;
  setDetayDepo: (w: Warehouse | null) => void;
  setEditingWarehouse: (w: Warehouse | null) => void;
  showWarehouseModal: boolean;
  setShowWarehouseModal: (v: boolean) => void;
  editingWarehouse: Warehouse | null;
  warehouseForm: WarehouseForm;
  setWarehouseForm: React.Dispatch<React.SetStateAction<WarehouseForm>>;
  saveWarehouse: () => void;
  deleteWarehouse: (id: string) => void;
}

export default function WarehousesTab({
  t, currentLanguage, warehouses, depoKalemleriIcin, detayDepo, setDetayDepo,
  setEditingWarehouse, showWarehouseModal, setShowWarehouseModal, editingWarehouse,
  warehouseForm, setWarehouseForm, saveWarehouse, deleteWarehouse,
}: WarehousesTabProps) {
  return (
    <>
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <h3 className="font-semibold text-gray-800">{oc(currentLanguage).depo_tanimlari}</h3>
            <button onClick={() => { setEditingWarehouse(null); setWarehouseForm({ name: '', location: '', manager: '', notes: '' }); setShowWarehouseModal(true); }} className="apple-button-primary">
              <Plus size={14} /> {t.add}
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {warehouses.map(w => {
              const depoKalemleri = depoKalemleriIcin(w.id);
              // Hesap tek kaynakta (utils/muhasebe/depoDeger.ts)
              const depoT = depoToplamlari(depoKalemleri);
              return (
              <div key={w.id} onClick={() => setDetayDepo(w)}
                className="bg-gray-50 rounded-2xl p-4 border border-gray-100 relative group cursor-pointer hover:border-[#ff4000]/40 hover:shadow-sm transition-all"
                title={ac(currentLanguage).envanter_detayini_gor}>
                <div className="flex justify-between items-start mb-2">
                  <h4 className="font-bold text-gray-800">{w.name}</h4>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={(e) => { e.stopPropagation(); setDetayDepo(w); }} className="p-1.5 hover:bg-white rounded-lg text-blue-500" title={ac(currentLanguage).envanter_detayi}><Eye size={12} /></button>
                    <button onClick={(e) => { e.stopPropagation(); setEditingWarehouse(w); setWarehouseForm({ name: w.name, location: w.location || '', manager: w.manager || '', notes: w.notes || '' }); setShowWarehouseModal(true); }} className="p-1.5 hover:bg-white rounded-lg text-gray-500"><Edit2 size={12} /></button>
                    <button onClick={(e) => { e.stopPropagation(); deleteWarehouse(w.id); }} className="p-1.5 hover:bg-white rounded-lg text-red-500"><Trash2 size={12} /></button>
                  </div>
                </div>
                <div className="space-y-1 text-xs text-gray-500">
                  <div className="flex items-center gap-1.5"><MapPin size={12} /> {w.location || '—'}</div>
                  <div className="flex items-center gap-1.5"><User size={12} /> {w.manager || '—'}</div>
                </div>
                <div className="mt-3 pt-2 border-t border-gray-100 flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-gray-600">
                    {depoKalemleri.length} {ac(currentLanguage).kalem_2}
                  </span>
                  <span className="text-[11px] text-gray-400"
                    title={depoT.adet.bilinmeyen > 0 ? (currentLanguage === 'tr' ? `${depoT.adet.bilinmeyen} kalemin adedi bilinmiyor — toplama girmedi` : `${depoT.adet.bilinmeyen} items have unknown quantity — excluded from the total`) : undefined}>
                    {adetYaz(ekranTutari(depoT.adet))} {oc(currentLanguage).adet}{depoT.adet.bilinmeyen > 0 ? ' *' : ''}
                  </span>
                </div>
              </div>
              );
            })}
          </div>
        </div>

        {detayDepo && (() => {
          const kalemler = depoKalemleriIcin(detayDepo.id)
            .sort((a, b) => sayiSirala(a.quantity, b.quantity, true)); // azalan; adedi bilinmeyen kalem sona
          // Hesap tek kaynakta (utils/muhasebe/depoDeger.ts). costPrice, WarehouseItem tipinde YOK;
          // DepoKalemi onu yapısal `unknown` alan olarak okur — `as unknown as {...}` cast'i GEREKMEZ.
          const toplam = depoToplamlari(kalemler);
          return (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setDetayDepo(null)}>
              <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-xl" onClick={e => e.stopPropagation()}>
                <div className="flex items-start justify-between p-5 border-b border-gray-100">
                  <div>
                    <h3 className="font-bold text-[#1D1D1F] flex items-center gap-2"><Home size={16} /> {detayDepo.name}</h3>
                    <p className="text-xs text-gray-500 mt-0.5 flex items-center gap-1"><MapPin size={11} /> {detayDepo.location || '—'}</p>
                  </div>
                  <button onClick={() => setDetayDepo(null)} className="p-1 rounded-lg hover:bg-gray-100 text-gray-400"><X size={18} /></button>
                </div>

                <div className="grid grid-cols-3 gap-3 p-5 border-b border-gray-100">
                  <div className="bg-gray-50 rounded-xl p-3 text-center">
                    <p className="text-xl font-bold text-[#1D1D1F]">{kalemler.length}</p>
                    <p className="text-[11px] text-gray-500 mt-0.5">{ac(currentLanguage).kalem_3}</p>
                  </div>
                  <div className="bg-gray-50 rounded-xl p-3 text-center">
                    <p className="text-xl font-bold text-[#1D1D1F]">{adetYaz(ekranTutari(toplam.adet))}</p>
                    <p className="text-[11px] text-gray-500 mt-0.5">{oc(currentLanguage).toplam_adet}{toplam.adet.bilinmeyen > 0 ? (currentLanguage === 'tr' ? ` · ${toplam.adet.bilinmeyen} kalem adetsiz` : ` · ${toplam.adet.bilinmeyen} items without qty`) : ''}</p>
                  </div>
                  <div className="bg-gray-50 rounded-xl p-3 text-center">
                    <p className="text-xl font-bold text-green-600">{formatTRY(ekranTutari(toplam.deger))}</p>
                    <p className="text-[11px] text-gray-500 mt-0.5">{oc(currentLanguage).stok_degeri}{toplam.deger.bilinmeyen > 0 ? (currentLanguage === 'tr' ? ` · ${toplam.deger.bilinmeyen} kalem maliyetsiz` : ` · ${toplam.deger.bilinmeyen} items without cost`) : ''}</p>
                  </div>
                </div>

                <div className="overflow-y-auto flex-1 p-5">
                  {kalemler.length === 0 ? (
                    <div className="py-10 text-center text-sm text-gray-400">
                      {ac(currentLanguage).bu_depoda_kayitli_envanter_yok}
                    </div>
                  ) : (
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-gray-100">
                          <th className="text-left py-2 text-[10px] font-bold text-[#86868B] uppercase tracking-wider">{t.product}</th>
                          <th className="text-left py-2 text-[10px] font-bold text-[#86868B] uppercase tracking-wider hidden sm:table-cell">SKU</th>
                          <th className="text-right py-2 text-[10px] font-bold text-[#86868B] uppercase tracking-wider">{t.quantity}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {kalemler.map(wi => (
                          <tr key={wi.id} className="border-b border-gray-50">
                            <td className="py-2.5 text-sm font-medium text-gray-800">{wi.productName}</td>
                            <td className="py-2.5 font-mono text-xs text-gray-500 hidden sm:table-cell">{wi.sku || '—'}</td>
                            <td className="py-2.5 text-right font-semibold text-sm">{adetYaz(wi.quantity)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </div>
          );
        })()}
      </motion.div>

      {/* DEPO TANIMI MODAL */}
      <AnimatePresence>
        {showWarehouseModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowWarehouseModal(false)} />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-white rounded-2xl shadow-2xl w-full max-w-md relative z-10 overflow-hidden">
              <div className="flex items-center justify-between p-5 border-b border-gray-100">
                <h3 className="font-semibold text-gray-800">{ac(currentLanguage).depo_tanimi} — {editingWarehouse ? (oc(currentLanguage).duzenle) : t.add}</h3>
                <button onClick={() => setShowWarehouseModal(false)} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"><X size={16} /></button>
              </div>
              <div className="p-5 space-y-3 max-h-[70vh] overflow-y-auto">
                {[
                  { label: ac(currentLanguage).depo_adi, key: 'name', placeholder: 'Ana Depo' },
                  { label: t.location, key: 'location', placeholder: 'İstanbul' },
                  { label: ac(currentLanguage).sorumlu, key: 'manager', placeholder: 'Ahmet Yılmaz' },
                  { label: oc(currentLanguage).not, key: 'notes', placeholder: '...' },
                ].map(f => (
                  <div key={f.key}>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{f.label}</label>
                    <input type="text" value={warehouseForm[f.key as keyof typeof warehouseForm] as string} onChange={e => setWarehouseForm(prev => ({ ...prev, [f.key]: e.target.value }))} placeholder={f.placeholder} className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]" />
                  </div>
                ))}
              </div>
              <div className="flex justify-end gap-2 p-5 border-t border-gray-100">
                <button onClick={() => setShowWarehouseModal(false)} className="bg-gray-100 hover:bg-gray-200 rounded-full px-4 py-2 text-sm font-semibold transition-colors">{t.cancel}</button>
                <button onClick={saveWarehouse} className="apple-button-primary"><Save size={14} /> {t.save}</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
