import { motion, AnimatePresence } from 'motion/react';
import { Plus, X, Save, PieChart } from 'lucide-react';
import { type Budget, type JournalEntry } from '../../types';
import { formatTRY, type AccountingT } from './shared';

type BudgetForm = { category: string; amount: number; period: string };

interface ButceTabProps {
  t: AccountingT;
  currentLanguage: string;
  budgets: Budget[];
  journalEntries: JournalEntry[];
  deleteBudget: (id: string) => void;
  showBudgetModal: boolean;
  setShowBudgetModal: (v: boolean) => void;
  budgetForm: BudgetForm;
  setBudgetForm: React.Dispatch<React.SetStateAction<BudgetForm>>;
  saveBudget: () => void;
}

export default function ButceTab({
  t, currentLanguage, budgets, journalEntries, deleteBudget,
  showBudgetModal, setShowBudgetModal, budgetForm, setBudgetForm, saveBudget,
}: ButceTabProps) {
  return (
    <>
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
        <div className="apple-card p-6">
          <div className="flex items-center justify-between mb-6">
            <h3 className="font-bold text-gray-800">{t.butce}</h3>
            <button onClick={() => setShowBudgetModal(true)} className="apple-button-primary">
              <Plus size={14} /> {t.add}
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="space-y-6">
              {budgets.length === 0 && (
                <div className="text-center py-8 text-gray-400 border-2 border-dashed border-gray-100 rounded-2xl">
                  {t.noRecords}
                </div>
              )}
              {budgets.map(b => {
                const actual = journalEntries
                  .filter(e => e.kategori === b.category && e.date.startsWith(b.period))
                  .reduce((sum, e) => sum + (e.borc || 0), 0);

                const percent = b.amount > 0 ? Math.min(100, Math.round((actual / b.amount) * 100)) : 0;
                const color = percent > 90 ? 'bg-red-500' : percent > 70 ? 'bg-orange-500' : 'bg-blue-500';

                return (
                  <div key={b.id} className="group relative">
                    <div className="flex justify-between text-sm mb-2">
                      <div className="flex flex-col">
                        <span className="font-semibold text-gray-800">{b.category}</span>
                        <span className="text-[10px] text-gray-400 uppercase font-bold">{b.period}</span>
                      </div>
                      <div className="text-right">
                        <span className="font-bold text-gray-800">{formatTRY(actual)}</span>
                        <span className="text-gray-400 mx-1">/</span>
                        <span className="text-gray-500">{formatTRY(b.amount)}</span>
                      </div>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${percent}%` }}
                        className={`h-full ${color}`}
                      />
                    </div>
                    <button
                      onClick={() => deleteBudget(b.id)}
                      className="absolute -right-2 -top-2 p-1 bg-white shadow-sm border border-gray-100 rounded-full text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X size={10} />
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="bg-gray-50 rounded-2xl p-6 flex flex-col justify-center items-center text-center">
              {budgets.length > 0 ? (
                <>
                  {(() => {
                    const totalBudget = budgets.reduce((sum, b) => sum + b.amount, 0);
                    const totalActual = budgets.reduce((sum, b) => {
                      const actual = journalEntries
                        .filter(e => e.kategori === b.category && e.date.startsWith(b.period))
                        .reduce((s, entry) => s + (entry.borc || 0), 0);
                      return sum + actual;
                    }, 0);
                    const totalPercent = totalBudget > 0 ? Math.round((totalActual / totalBudget) * 100) : 0;

                    return (
                      <>
                        <div className="w-32 h-32 rounded-full border-8 border-brand flex flex-col items-center justify-center mb-4 relative">
                          <svg className="absolute inset-0 w-full h-full -rotate-90">
                            <circle
                              cx="64" cy="64" r="56"
                              fill="none" stroke="#f3f4f6" strokeWidth="8"
                            />
                            <circle
                              cx="64" cy="64" r="56"
                              fill="none" stroke="#ff4000" strokeWidth="8"
                              strokeDasharray={351.8}
                              strokeDashoffset={351.8 - (351.8 * Math.min(100, totalPercent)) / 100}
                              strokeLinecap="round"
                            />
                          </svg>
                          <span className="text-2xl font-black text-gray-800 relative z-10">%{totalPercent}</span>
                          <span className="text-[10px] text-gray-500 uppercase font-bold relative z-10">{currentLanguage === 'tr' ? 'Kullanım' : 'Usage'}</span>
                        </div>
                        <h4 className="font-bold text-gray-800">{currentLanguage === 'tr' ? 'Genel Bütçe Durumu' : 'Overall Budget Status'}</h4>
                        <p className="text-xs text-gray-500 mt-1">
                          {currentLanguage === 'tr'
                            ? `Toplam bütçenin %${totalPercent}'i kullanıldı.`
                            : `${totalPercent}% of total budget used.`}
                        </p>
                      </>
                    );
                  })()}
                </>
              ) : (
                <div className="text-gray-400">
                  <PieChart size={48} className="mx-auto mb-4 opacity-20" />
                  <p className="text-sm">{currentLanguage === 'tr' ? 'Henüz bütçe hedefi belirlenmedi.' : 'No budget goals set yet.'}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </motion.div>

      {/* BUDGET MODAL */}
      <AnimatePresence>
        {showBudgetModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowBudgetModal(false)} />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-white rounded-2xl shadow-2xl w-full max-w-md relative z-10 overflow-hidden max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between p-5 border-b border-gray-100">
                <h3 className="font-semibold text-gray-800">Bütçe Hedefi Belirle</h3>
                <button onClick={() => setShowBudgetModal(false)} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"><X size={16} /></button>
              </div>
              <div className="p-5 space-y-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Kategori</label>
                  <select value={budgetForm.category} onChange={e => setBudgetForm(prev => ({ ...prev, category: e.target.value }))} className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-brand">
                    <option value="Satış">Satış</option>
                    <option value="Personel">Personel</option>
                    <option value="Genel Gider">Genel Gider</option>
                    <option value="Pazarlama">Pazarlama</option>
                    <option value="Yatırım">Yatırım</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Hedef Tutar (TRY)</label>
                  <input type="number" value={budgetForm.amount} onChange={e => setBudgetForm(prev => ({ ...prev, amount: Number(e.target.value) }))} className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-brand" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Dönem</label>
                  <input type="month" value={budgetForm.period} onChange={e => setBudgetForm(prev => ({ ...prev, period: e.target.value }))} className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-brand" />
                </div>
              </div>
              <div className="flex justify-end gap-2 p-5 border-t border-gray-100">
                <button onClick={() => setShowBudgetModal(false)} className="bg-gray-100 hover:bg-gray-200 rounded-full px-4 py-2 text-sm font-semibold transition-colors">{t.cancel}</button>
                <button onClick={saveBudget} className="apple-button-primary"><Save size={14} /> {t.save}</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
