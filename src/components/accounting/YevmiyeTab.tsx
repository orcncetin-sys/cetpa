import { motion, AnimatePresence } from 'motion/react';
import { Download, Search, Plus, Eye, Edit2, Trash2, X, Save } from 'lucide-react';
import { type JournalEntry } from '../../types';
import { formatInCurrency } from '../../utils/currency';
import { SortHeader, exportCSV, HESAP_PLANI, type AccountingT } from './shared';

type JournalForm = {
  date: string; fiş: string; aciklama: string;
  debitHesap: string; alacakHesap: string;
  borc: number; alacak: number; kdvOran: number;
  kategori: JournalEntry['kategori'];
};

interface YevmiyeTabProps {
  t: AccountingT;
  currentLanguage: string;
  journalEntries: JournalEntry[];
  displayedJournal: JournalEntry[];
  journalSearch: string;
  setJournalSearch: (v: string) => void;
  journalSortKey: keyof JournalEntry;
  journalSortDir: 'asc' | 'desc';
  toggleJournalSort: (key: keyof JournalEntry) => void;
  yevmiyeCurrency: 'TRY' | 'USD' | 'EUR';
  setYevmiyeCurrency: (c: 'TRY' | 'USD' | 'EUR') => void;
  exchangeRates: Record<string, number> | undefined;
  openEditJournal: (e: JournalEntry) => void;
  deleteJournal: (id: string) => void;
  showJournalModal: boolean;
  setShowJournalModal: (v: boolean) => void;
  editingJournal: JournalEntry | null;
  journalForm: JournalForm;
  setJournalForm: React.Dispatch<React.SetStateAction<JournalForm>>;
  saveJournal: () => void;
}

export default function YevmiyeTab({
  t, currentLanguage, journalEntries, displayedJournal, journalSearch, setJournalSearch,
  journalSortKey, journalSortDir, toggleJournalSort, yevmiyeCurrency, setYevmiyeCurrency,
  exchangeRates, openEditJournal, deleteJournal, showJournalModal, setShowJournalModal,
  editingJournal, journalForm, setJournalForm, saveJournal,
}: YevmiyeTabProps) {
  return (
    <>
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
        <div className="apple-card p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-800">{t.journalBook}</h3>
            <div className="flex gap-2">
              <button
                onClick={() => exportCSV('yevmiye.csv',
                  [t.date, t.receiptNo, t.description, t.debitAccount, t.creditAccount, t.debit, t.credit, t.vatRate, t.category],
                  journalEntries.map(e => [e.date, e.fiş, e.aciklama, e.debitHesap, e.alacakHesap, e.borc, e.alacak, e.kdvOran ?? 0, e.kategori])
                )}
                className="apple-button-secondary py-2 px-4 text-sm"
              >
                <Download size={14} /> CSV
              </button>
              <button onClick={() => setShowJournalModal(true)} className="apple-button-primary">
                <Plus size={14} /> {t.newEntry}
              </button>
            </div>
          </div>
          <div className="relative mb-3">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder={currentLanguage === 'en' ? 'Search entries...' : 'Kayıt ara...'}
              value={journalSearch}
              onChange={e => setJournalSearch(e.target.value)}
              className="apple-input w-full pl-9 py-2"
            />
          </div>
          <div className="flex items-center gap-1 bg-gray-50 rounded-xl px-3 py-2 mb-3 w-fit">
            <span className="text-xs text-gray-400 font-medium mr-1">{currentLanguage === 'tr' ? 'Para Birimi:' : 'Currency:'}</span>
            {(['TRY', 'USD', 'EUR'] as const).map(cur => (
              <button
                key={cur}
                onClick={() => setYevmiyeCurrency(cur)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${yevmiyeCurrency === cur ? 'bg-brand text-white shadow-sm' : 'text-gray-500 hover:bg-white hover:shadow-sm'}`}
              >
                {cur === 'TRY' ? '₺ TRY' : cur === 'USD' ? '$ USD' : '€ EUR'}
              </button>
            ))}
            {exchangeRates && yevmiyeCurrency !== 'TRY' && (
              <span className="ml-2 text-[10px] text-gray-400 font-mono">
                {yevmiyeCurrency === 'USD' ? `1 USD = ₺${(exchangeRates.USD||0).toLocaleString('tr-TR',{minimumFractionDigits:2,maximumFractionDigits:2})}` : `1 EUR = ₺${(exchangeRates.EUR||0).toLocaleString('tr-TR',{minimumFractionDigits:2,maximumFractionDigits:2})}`}
              </span>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="apple-table">
              <thead>
                <tr className="border-b border-gray-100">
                  <SortHeader
                    label={t.date}
                    sortKey="date"
                    currentSort={{ key: journalSortKey, direction: journalSortDir }}
                    onSort={(key) => toggleJournalSort(key as keyof JournalEntry)}
                  />
                  <th className="text-left py-3 px-4 text-[10px] font-bold text-[#86868B] uppercase tracking-wider hidden sm:table-cell">{t.receiptNo}</th>
                  <th className="text-left py-3 px-4 text-[10px] font-bold text-[#86868B] uppercase tracking-wider">{t.description}</th>
                  <th className="text-left py-3 px-4 text-[10px] font-bold text-[#86868B] uppercase tracking-wider hidden md:table-cell">{t.debitAccount}</th>
                  <th className="text-left py-3 px-4 text-[10px] font-bold text-[#86868B] uppercase tracking-wider hidden md:table-cell">{t.creditAccount}</th>
                  <SortHeader
                    label={`Borç ${yevmiyeCurrency === 'TRY' ? '(₺)' : yevmiyeCurrency === 'USD' ? '($)' : '(€)'}`}
                    sortKey="borc"
                    currentSort={{ key: journalSortKey, direction: journalSortDir }}
                    onSort={(key) => toggleJournalSort(key as keyof JournalEntry)}
                    className="text-right"
                  />
                  <SortHeader
                    label={`Alacak ${yevmiyeCurrency === 'TRY' ? '(₺)' : yevmiyeCurrency === 'USD' ? '($)' : '(€)'}`}
                    sortKey="alacak"
                    currentSort={{ key: journalSortKey, direction: journalSortDir }}
                    onSort={(key) => toggleJournalSort(key as keyof JournalEntry)}
                    className="text-right hidden sm:table-cell"
                  />
                  <th className="text-center py-3 px-4 text-[10px] font-bold text-[#86868B] uppercase tracking-wider hidden sm:table-cell">{t.vatRate}</th>
                  <SortHeader
                    label={t.category}
                    sortKey="kategori"
                    currentSort={{ key: journalSortKey, direction: journalSortDir }}
                    onSort={(key) => toggleJournalSort(key as keyof JournalEntry)}
                    className="hidden lg:table-cell"
                  />
                  <th className="text-center py-3 px-4 text-[10px] font-bold text-[#86868B] uppercase tracking-wider">{t.delete}</th>
                </tr>
              </thead>
              <tbody>
                {displayedJournal.length === 0 && (
                  <tr><td colSpan={10} className="text-center py-8 text-gray-400">{t.noEntries}</td></tr>
                )}
                {displayedJournal.map(e => (
                  <tr key={e.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                    <td className="py-2.5 px-3 text-gray-600 whitespace-nowrap">{e.date}</td>
                    <td className="py-2.5 px-3 text-gray-500 font-mono text-xs hidden sm:table-cell">{e.fiş}</td>
                    <td className="py-2.5 px-3 text-gray-800 max-w-[160px] truncate">
                      <div className="flex items-center gap-2">
                        {e.aciklama}
                        {e.isSynced && (
                          <span className="bg-green-100 text-green-600 text-[8px] font-bold px-1 py-0.5 rounded uppercase tracking-tighter">LUCA</span>
                        )}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-gray-500 text-xs hidden md:table-cell max-w-[140px] truncate">{e.debitHesap}</td>
                    <td className="py-2.5 px-3 text-gray-500 text-xs hidden md:table-cell max-w-[140px] truncate">{e.alacakHesap}</td>
                    <td className="py-2.5 px-3 text-right font-semibold text-gray-800">{formatInCurrency(e.borc, yevmiyeCurrency, exchangeRates)}</td>
                    <td className="py-2.5 px-3 text-right text-gray-600 hidden sm:table-cell">{formatInCurrency(e.alacak, yevmiyeCurrency, exchangeRates)}</td>
                    <td className="py-2.5 px-3 text-center hidden sm:table-cell">
                      <span className="bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full text-xs font-semibold">%{e.kdvOran ?? 0}</span>
                    </td>
                    <td className="py-2.5 px-3 text-gray-500 text-xs hidden lg:table-cell">{e.kategori}</td>
                    <td className="py-2.5 px-3 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <button onClick={() => openEditJournal(e)} className="action-btn-view" title={currentLanguage === 'tr' ? 'İncele' : 'View'}><Eye size={13} /></button>
                        <button onClick={() => openEditJournal(e)} className="action-btn-edit" title={currentLanguage === 'tr' ? 'Düzenle' : 'Edit'}><Edit2 size={13} /></button>
                        <button onClick={() => deleteJournal(e.id)} className="action-btn-delete"><Trash2 size={13} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </motion.div>

      {/* JOURNAL MODAL */}
      <AnimatePresence>
        {showJournalModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowJournalModal(false)} />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-lg relative z-10 overflow-hidden"
            >
              <div className="flex items-center justify-between p-5 border-b border-gray-100">
                <h3 className="font-semibold text-gray-800">{editingJournal ? t.editJournalEntry : t.newJournalEntry}</h3>
                <button onClick={() => setShowJournalModal(false)} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"><X size={16} /></button>
              </div>
              <div className="p-5 space-y-3 max-h-[70vh] overflow-y-auto">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{t.date}</label>
                    <input type="date" value={journalForm.date} onChange={e => setJournalForm(prev => ({ ...prev, date: e.target.value }))} className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{t.receiptDoc}</label>
                    <input type="text" value={journalForm.fiş} onChange={e => setJournalForm(prev => ({ ...prev, fiş: e.target.value }))} placeholder="FŞ-001" className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{t.description}</label>
                  <input type="text" value={journalForm.aciklama} onChange={e => setJournalForm(prev => ({ ...prev, aciklama: e.target.value }))} placeholder={t.descriptionPlaceholder} className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{t.debitAccountLabel}</label>
                  <select value={journalForm.debitHesap} onChange={e => setJournalForm(prev => ({ ...prev, debitHesap: e.target.value }))} className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]">
                    {HESAP_PLANI.map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{t.creditAccountLabel}</label>
                  <select value={journalForm.alacakHesap} onChange={e => setJournalForm(prev => ({ ...prev, alacakHesap: e.target.value }))} className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]">
                    {HESAP_PLANI.map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{t.debitLabel}</label>
                    <input type="number" value={journalForm.borc} onChange={e => setJournalForm(prev => ({ ...prev, borc: Number(e.target.value) }))} className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{t.creditLabel}</label>
                    <input type="number" value={journalForm.alacak} onChange={e => setJournalForm(prev => ({ ...prev, alacak: Number(e.target.value) }))} className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{t.vatRateLabel}</label>
                    <select value={journalForm.kdvOran} onChange={e => setJournalForm(prev => ({ ...prev, kdvOran: Number(e.target.value) }))} className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]">
                      <option value={0}>%0</option><option value={8}>%8</option><option value={18}>%18</option><option value={20}>%20</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{t.categoryLabel}</label>
                    <select value={journalForm.kategori} onChange={e => setJournalForm(prev => ({ ...prev, kategori: e.target.value as 'Satış' | 'Alış' | 'Gider' | 'Tahsilat' | 'Ödeme' | 'Diğer' }))} className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]">
                      <option>Satış</option><option>Alış</option><option>Gider</option><option>Tahsilat</option><option>Ödeme</option><option>Diğer</option>
                    </select>
                  </div>
                </div>
              </div>
              <div className="flex justify-end gap-2 p-5 border-t border-gray-100">
                <button onClick={() => setShowJournalModal(false)} className="bg-gray-100 hover:bg-gray-200 rounded-full px-4 py-2 text-sm font-semibold transition-colors">{t.cancel}</button>
                <button onClick={saveJournal} className="apple-button-primary"><Save size={14} /> {t.save}</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
