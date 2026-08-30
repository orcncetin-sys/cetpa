import { motion, AnimatePresence } from 'motion/react';
import { Download, Search, Plus, Eye, Edit2, Trash2, Upload, X, Save } from 'lucide-react';
import { type Customer } from '../../types';
import { SortHeader, exportCSV, type AccountingT } from './shared';
import CariEkstrePanel from '../CariEkstrePanel';

type CustomerForm = {
  name: string; company: string; email: string; phone: string; address: string;
  taxNo: string; taxOffice: string; notes: string; creditLimit: number; balance: number;
  riskGroup: 'Düşük' | 'Orta' | 'Yüksek';
};
type MusteriSortKey = 'name' | 'company' | 'phone' | 'balance' | 'riskGroup';
type DekontHedef = { cariKod: string; ad: string; bakiye: number; id: string };

interface MusterilerTabProps {
  t: AccountingT;
  currentLanguage: string;
  customers: Customer[];
  displayedMusteriler: Customer[];
  customerSearch: string;
  setCustomerSearch: (v: string) => void;
  musteriSortKey: MusteriSortKey;
  musteriSortDir: 'asc' | 'desc';
  toggleMusteriSort: (key: MusteriSortKey) => void;
  cariRol: (c: Customer) => { label: string; cls: string } | null;
  setDekontHedef: (d: DekontHedef | null) => void;
  showCustomerModal: boolean;
  setShowCustomerModal: (v: boolean) => void;
  editingCustomer: Customer | null;
  setEditingCustomer: (c: Customer | null) => void;
  customerForm: CustomerForm;
  setCustomerForm: React.Dispatch<React.SetStateAction<CustomerForm>>;
  saveCustomer: () => void;
  deleteCustomer: (id: string) => void;
  ekstreMusteri: Customer | null;
  setEkstreMusteri: (c: Customer | null) => void;
}

export default function MusterilerTab({
  t, currentLanguage, customers, displayedMusteriler, customerSearch, setCustomerSearch,
  musteriSortKey, musteriSortDir, toggleMusteriSort, cariRol, setDekontHedef,
  showCustomerModal, setShowCustomerModal, editingCustomer, setEditingCustomer,
  customerForm, setCustomerForm, saveCustomer, deleteCustomer,
  ekstreMusteri, setEkstreMusteri,
}: MusterilerTabProps) {
  return (
    <>
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <h3 className="font-semibold text-gray-800">{t.musteriler}</h3>
            <div className="flex items-center gap-2">
              <button
                onClick={() => exportCSV('musteriler.csv',
                  [t.name, t.company, t.email, t.phone, t.taxNo, t.address],
                  customers.map(c => [c.name, c.company || '', c.email || '', c.phone || '', c.taxNo || '', c.address || ''])
                )}
                className="flex items-center gap-1 bg-gray-100 hover:bg-gray-200 rounded-full px-3 py-1.5 text-xs font-semibold"
              >
                <Download size={12} /> CSV
              </button>
              <div className="flex items-center gap-1.5 bg-gray-50 border border-gray-200 rounded-full px-3 py-1.5">
                <Search size={12} className="text-gray-400" />
                <input value={customerSearch} onChange={e => setCustomerSearch(e.target.value)} placeholder={t.name + '...'} className="text-xs outline-none bg-transparent w-32" />
              </div>
              <button onClick={() => setShowCustomerModal(true)} className="apple-button-primary">
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
                    currentSort={{ key: musteriSortKey, direction: musteriSortDir }}
                    onSort={(key) => toggleMusteriSort(key as MusteriSortKey)}
                  />
                  <SortHeader
                    label={t.company}
                    sortKey="company"
                    currentSort={{ key: musteriSortKey, direction: musteriSortDir }}
                    onSort={(key) => toggleMusteriSort(key as MusteriSortKey)}
                    className="hidden sm:table-cell"
                  />
                  <th className="text-left py-3 px-4 text-[10px] font-bold text-[#86868B] uppercase tracking-wider hidden lg:table-cell">{t.email}</th>
                  <SortHeader
                    label={t.phone}
                    sortKey="phone"
                    currentSort={{ key: musteriSortKey, direction: musteriSortDir }}
                    onSort={(key) => toggleMusteriSort(key as MusteriSortKey)}
                    className="hidden md:table-cell"
                  />
                  <SortHeader
                    label={currentLanguage === 'tr' ? 'Bakiye' : 'Balance'}
                    sortKey="balance"
                    currentSort={{ key: musteriSortKey, direction: musteriSortDir }}
                    onSort={(key) => toggleMusteriSort(key as MusteriSortKey)}
                    className="text-right hidden sm:table-cell"
                  />
                  <SortHeader
                    label={currentLanguage === 'tr' ? 'Risk' : 'Risk'}
                    sortKey="riskGroup"
                    currentSort={{ key: musteriSortKey, direction: musteriSortDir }}
                    onSort={(key) => toggleMusteriSort(key as MusteriSortKey)}
                    className="text-center hidden sm:table-cell"
                  />
                  <th className="py-3 px-4"></th>
                </tr>
              </thead>
              <tbody>
                {displayedMusteriler.length === 0 && (
                  <tr><td colSpan={7} className="text-center py-8 text-gray-400">{t.noRecords}</td></tr>
                )}
                {displayedMusteriler.map(c => (
                  <tr key={c.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="py-2.5 px-3 font-medium text-gray-800">
                      <button onClick={() => setEkstreMusteri(c)} className="text-left hover:text-[#ff4000] hover:underline transition-colors block"
                        title={currentLanguage === 'tr' ? 'Cari ekstre / hareketleri gör' : 'View account statement'}>
                        {c.name}
                      </button>
                      {(() => { const r = cariRol(c); return r ? <span className={`inline-block mt-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded ${r.cls}`}>{r.label}</span> : null; })()}
                    </td>
                    <td className="py-2.5 px-3 text-gray-500 hidden sm:table-cell">{c.company || '—'}</td>
                    <td className="py-2.5 px-3 text-gray-500 hidden lg:table-cell text-xs">{c.email || '—'}</td>
                    <td className="py-2.5 px-3 text-gray-500 hidden md:table-cell text-xs">{c.phone || '—'}</td>
                    <td className="py-2.5 px-3 text-right hidden sm:table-cell">
                      <span className={`text-xs font-bold ${(c.balance || 0) > 0 ? 'text-red-600' : (c.balance || 0) < 0 ? 'text-green-600' : 'text-gray-400'}`}>
                        ₺{(c.balance || 0).toLocaleString('tr-TR', { maximumFractionDigits: 0 })}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-center hidden sm:table-cell">
                      {c.riskGroup ? (
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${c.riskGroup === 'Yüksek' ? 'bg-red-100 text-red-600' : c.riskGroup === 'Orta' ? 'bg-yellow-100 text-yellow-700' : 'bg-green-100 text-green-600'}`}>
                          {c.riskGroup}
                        </span>
                      ) : <span className="text-gray-300 text-xs">—</span>}
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {/* Dekont girişi — 2026-07-30'a kadar burada tek tıkla,
                            HİÇBİR ŞEY SORMADAN, müşterinin TÜM bakiyesi kadar
                            dekont atan bir düğme vardı (açıklama "<ad> bakiye
                            dekontu", evrak tipi tahmini 29). İki kez basmak iki
                            muhasebe kaydı üretiyordu. Artık modal açılıyor:
                            tür/yön/tutar/tarih/açıklama girilir, kayıt sonrası
                            bakiye önizlenir. */}
                        {(() => {
                          const cariKod = (c as unknown as { mikroCariKod?: string; code?: string }).mikroCariKod
                            ?? (c as unknown as { code?: string }).code
                            ?? c.taxNo;
                          if (!cariKod) return null; // cari kod yoksa Mikro'ya gidemez
                          return (
                            <button
                              onClick={() => setDekontHedef({ cariKod, ad: c.name, bakiye: c.balance || 0, id: c.id })}
                              title="Mikro'ya dekont/masraf gir"
                              className="p-2.5 -m-1 hover:bg-gray-100 rounded-lg transition-colors text-gray-600 flex flex-col items-center"
                            >
                              <Upload size={13} />
                              <span className="text-[8px] font-semibold leading-none mt-0.5">Mikro</span>
                            </button>
                          );
                        })()}
                        <button onClick={() => setEkstreMusteri(c)} title={currentLanguage === 'tr' ? 'Cari ekstre / hareketleri' : 'Account statement'} className="p-2.5 -m-1 hover:bg-blue-50 rounded-lg transition-colors text-blue-500"><Eye size={13} /></button>
                        <button onClick={() => { setEditingCustomer(c); setCustomerForm({ name: c.name, company: c.company || '', email: c.email || '', phone: c.phone || '', address: c.address || '', taxNo: c.taxNo || '', taxOffice: c.taxOffice || '', notes: c.notes || '', creditLimit: c.creditLimit || 0, balance: c.balance || 0, riskGroup: c.riskGroup || 'Düşük' }); setShowCustomerModal(true); }} title={currentLanguage === 'tr' ? 'Düzenle' : 'Edit'} className="p-2.5 -m-1 hover:bg-gray-100 rounded-lg transition-colors text-gray-500"><Edit2 size={13} /></button>
                        <button onClick={() => deleteCustomer(c.id)} className="p-2.5 -m-1 hover:bg-red-50 rounded-lg transition-colors text-red-500"><Trash2 size={13} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Cari ekstre / hareket detayı — müşteri adına/göze tıklayınca */}
        {ekstreMusteri && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setEkstreMusteri(null)}>
            <div className="bg-white rounded-2xl w-full max-w-4xl max-h-[88vh] flex flex-col shadow-xl overflow-hidden" onClick={e => e.stopPropagation()}>
              <div className="flex items-start justify-between p-5 border-b border-gray-100 shrink-0">
                <div>
                  <h3 className="font-bold text-[#1D1D1F]">{currentLanguage === 'tr' ? 'Cari Ekstre' : 'Account Statement'}</h3>
                  <p className="text-xs text-gray-500 mt-0.5">{ekstreMusteri.name}</p>
                </div>
                <button onClick={() => setEkstreMusteri(null)} className="p-1 rounded-lg hover:bg-gray-100 text-gray-400"><X size={18} /></button>
              </div>
              <div className="overflow-y-auto flex-1 p-2 sm:p-4">
                {(() => {
                  // Mikro cari kodu varsa gerçek fatura hareketleri gelir; yoksa
                  // (elle eklenmiş müşteri) eski Cetpa orders/aging moduna düşer.
                  const cariKod = (ekstreMusteri as unknown as { mikroCariKod?: string; code?: string }).mikroCariKod
                    || (ekstreMusteri as unknown as { code?: string }).code
                    || ekstreMusteri.taxNo || '';
                  return cariKod
                    ? <CariEkstrePanel currentLanguage={currentLanguage} cariKod={cariKod} balance={ekstreMusteri.balance || 0} customerName={ekstreMusteri.name} />
                    : <CariEkstrePanel currentLanguage={currentLanguage} leadId={ekstreMusteri.id} customerName={ekstreMusteri.name} />;
                })()}
              </div>
            </div>
          </div>
        )}
      </motion.div>

      {/* CUSTOMER MODAL */}
      <AnimatePresence>
        {showCustomerModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowCustomerModal(false)} />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-white rounded-2xl shadow-2xl w-full max-w-md relative z-10 overflow-hidden">
              <div className="flex items-center justify-between p-5 border-b border-gray-100">
                <h3 className="font-semibold text-gray-800">{t.musteriler} — {editingCustomer ? t.editAccount : t.add}</h3>
                <button onClick={() => setShowCustomerModal(false)} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"><X size={16} /></button>
              </div>
              <div className="p-5 space-y-3 max-h-[70vh] overflow-y-auto">
                {[
                  { label: t.name, key: 'name', type: 'text', placeholder: 'Ahmet Yılmaz' },
                  { label: t.company, key: 'company', type: 'text', placeholder: 'ABC Ltd. Şti.' },
                  { label: t.email, key: 'email', type: 'email', placeholder: 'ornek@sirket.com' },
                  { label: t.phone, key: 'phone', type: 'text', placeholder: '+90 555 000 0000' },
                  { label: t.address, key: 'address', type: 'text', placeholder: 'İstanbul, Türkiye' },
                  { label: currentLanguage === 'tr' ? 'Vergi Dairesi' : 'Tax Office', key: 'taxOffice', type: 'text', placeholder: 'Boğaziçi V.D.' },
                  { label: t.taxNo, key: 'taxNo', type: 'text', placeholder: '1234567890' },
                  { label: t.notes2, key: 'notes', type: 'text', placeholder: '...' },
                ].map(f => (
                  <div key={f.key}>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{f.label}</label>
                    <input type={f.type} value={customerForm[f.key as keyof typeof customerForm] as string} onChange={e => setCustomerForm(prev => ({ ...prev, [f.key]: e.target.value }))} placeholder={f.placeholder} className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]" />
                  </div>
                ))}
                {/* Risk & Financial fields */}
                <div className="pt-2 border-t border-gray-100">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-3">{currentLanguage === 'tr' ? 'Finansal & Risk' : 'Financial & Risk'}</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">{currentLanguage === 'tr' ? 'Kredi Limiti (₺)' : 'Credit Limit (₺)'}</label>
                      <input type="number" value={customerForm.creditLimit} onChange={e => setCustomerForm(prev => ({ ...prev, creditLimit: Number(e.target.value) }))} placeholder="500000" className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">{currentLanguage === 'tr' ? 'Açık Bakiye (₺)' : 'Open Balance (₺)'}</label>
                      <input type="number" value={customerForm.balance} onChange={e => setCustomerForm(prev => ({ ...prev, balance: Number(e.target.value) }))} placeholder="0" className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]" />
                    </div>
                  </div>
                  <div className="mt-3">
                    <label className="block text-xs font-medium text-gray-600 mb-1.5">{currentLanguage === 'tr' ? 'Risk Grubu' : 'Risk Group'}</label>
                    <div className="flex gap-2">
                      {(['Düşük', 'Orta', 'Yüksek'] as const).map(g => (
                        <button key={g} type="button"
                          onClick={() => setCustomerForm(prev => ({ ...prev, riskGroup: g }))}
                          className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-all ${customerForm.riskGroup === g
                            ? g === 'Yüksek' ? 'bg-red-500 text-white border-red-500' : g === 'Orta' ? 'bg-yellow-400 text-white border-yellow-400' : 'bg-green-500 text-white border-green-500'
                            : 'bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100'}`}>
                          {g === 'Düşük' ? '🟢' : g === 'Orta' ? '🟡' : '🔴'} {currentLanguage === 'tr' ? g : g === 'Düşük' ? 'Low' : g === 'Orta' ? 'Medium' : 'High'}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex justify-end gap-2 p-5 border-t border-gray-100">
                <button onClick={() => setShowCustomerModal(false)} className="bg-gray-100 hover:bg-gray-200 rounded-full px-4 py-2 text-sm font-semibold transition-colors">{t.cancel}</button>
                <button onClick={saveCustomer} className="apple-button-primary"><Save size={14} /> {t.save}</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
