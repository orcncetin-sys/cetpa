import { motion, AnimatePresence } from 'motion/react';
import { Download, Search, Plus, Eye, Edit2, Trash2, X, Save, RefreshCw, ArrowRightLeft, AlertCircle, Landmark } from 'lucide-react';
import { type BankAccount, type BankTransaction } from '../../types';
import { SortHeader, formatTRY, type AccountingT } from './shared';
import { paraYaz } from '../../utils/currency';
import { bilinenSayi, sayiSirala } from '../../utils/para';
import { oc } from '../../i18n/ortak';
import { ac } from '../../i18n/accounting';

type DrillDown = { title: string; rows: { label: string; value: string; sub?: string; badge?: string; badgeColor?: string }[]; total?: string };
type BankForm = {
  bankName: string; branch: string; accountHolder: string; accountNumber: string;
  /** `''` = girilmedi (bilinmiyor) — saveBank bilinenSayi ile eler, 0 kaydedilmez. */
  iban: string; currency: 'TRY' | 'USD' | 'EUR'; balance: number | '';
  accountType: 'Vadesiz' | 'Vadeli' | 'Kredi' | 'Kasa' | 'Akreditif (L/C)' | 'Teminat Mektubu';
};

interface BankaTabProps {
  t: AccountingT;
  currentLanguage: string;
  bankAccounts: BankAccount[];
  tryBalance: number;
  usdBalance: number;
  eurBalance: number;
  /** Birim başına bakiyesi bilinmeyen hesap sayısı (bankaHesap.dovizBakiyeleri) — KPI kartı altına not. */
  bakiyeBilinmeyen: Record<'TRY' | 'USD' | 'EUR', number>;
  setDrillDown: (d: DrillDown | null) => void;
  handleBankFileImport: (e: React.ChangeEvent<HTMLInputElement>) => void;
  openAddBank: () => void;
  bankSearch: string;
  setBankSearch: (v: string) => void;
  bankImportStatus: string | null;
  setBankImportStatus: (v: string | null) => void;
  bankSortKey: keyof BankAccount;
  bankSortDir: 'asc' | 'desc';
  toggleBankSort: (key: keyof BankAccount) => void;
  displayedAccounts: BankAccount[];
  openEditBank: (acc: BankAccount) => void;
  deleteBank: (id: string) => void;
  mikroEnabled: boolean;
  mikroConnected: boolean;
  bankTxLastPull: string | null;
  bankTxAutoSync: boolean;
  setBankTxAutoSync: React.Dispatch<React.SetStateAction<boolean>>;
  pullBankTransactions: () => void;
  bankTxPulling: boolean;
  bankTxSearch: string;
  setBankTxSearch: (v: string) => void;
  bankTxFilter: 'all' | 'credit' | 'debit';
  setBankTxFilter: (v: 'all' | 'credit' | 'debit') => void;
  bankTransactions: BankTransaction[];
  bankTxSort: { key: keyof BankTransaction; dir: 'asc' | 'desc' };
  setBankTxSort: React.Dispatch<React.SetStateAction<{ key: keyof BankTransaction; dir: 'asc' | 'desc' }>>;
  showBankModal: boolean;
  setShowBankModal: (v: boolean) => void;
  editingBank: BankAccount | null;
  bankForm: BankForm;
  setBankForm: React.Dispatch<React.SetStateAction<BankForm>>;
  saveBank: () => void;
}

export default function BankaTab({
  t, currentLanguage, bankAccounts, tryBalance, usdBalance, eurBalance, bakiyeBilinmeyen, setDrillDown,
  handleBankFileImport, openAddBank, bankSearch, setBankSearch, bankImportStatus, setBankImportStatus,
  bankSortKey, bankSortDir, toggleBankSort, displayedAccounts, openEditBank, deleteBank,
  mikroEnabled, mikroConnected, bankTxLastPull, bankTxAutoSync, setBankTxAutoSync, pullBankTransactions,
  bankTxPulling, bankTxSearch, setBankTxSearch, bankTxFilter, setBankTxFilter, bankTransactions,
  bankTxSort, setBankTxSort, showBankModal, setShowBankModal, editingBank, bankForm, setBankForm, saveBank,
}: BankaTabProps) {
  // Bakiyesi bilinmeyen hesap toplama girmedi (bankaHesap.dovizBakiyeleri) — kart altına açık not;
  // hiç bilinen yoksa değer zaten '—' basılır (ekranTutari → NaN → paraYaz).
  const bakiyeNotu = (n: number) => n > 0
    ? (currentLanguage === 'tr' ? `${n} hesap tutarsız — toplama girmedi` : `${n} account(s) without balance — excluded from total`)
    : null;
  return (
    <>
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            {
              label: t.tryBalance, value: formatTRY(tryBalance), symbol: '₺', color: 'text-green-600',
              note: bakiyeNotu(bakiyeBilinmeyen.TRY),
              onClick: () => setDrillDown({ title: '₺ TRY Hesaplar', rows: bankAccounts.filter(a => a.currency === 'TRY').map(a => ({ label: a.bankName, sub: `${a.accountType} — ${a.accountHolder}`, value: formatTRY(a.balance) })), total: formatTRY(tryBalance) })
            },
            {
              label: t.usdBalance, value: paraYaz(usdBalance, { birim: 'USD' }), symbol: '$', color: 'text-blue-600',
              note: bakiyeNotu(bakiyeBilinmeyen.USD),
              onClick: () => setDrillDown({ title: '$ USD Hesaplar', rows: bankAccounts.filter(a => a.currency === 'USD').map(a => ({ label: a.bankName, sub: `${a.accountType} — ${a.accountHolder}`, value: paraYaz(a.balance, { birim: 'USD' }) })), total: paraYaz(usdBalance, { birim: 'USD' }) })
            },
            {
              label: t.eurBalance, value: paraYaz(eurBalance, { birim: 'EUR' }), symbol: '€', color: 'text-purple-600',
              note: bakiyeNotu(bakiyeBilinmeyen.EUR),
              onClick: () => setDrillDown({ title: '€ EUR Hesaplar', rows: bankAccounts.filter(a => a.currency === 'EUR').map(a => ({ label: a.bankName, sub: `${a.accountType} — ${a.accountHolder}`, value: paraYaz(a.balance, { birim: 'EUR' }) })), total: paraYaz(eurBalance, { birim: 'EUR' }) })
            },
            {
              label: t.accountCount, value: String(bankAccounts.length), symbol: '#', color: 'text-[#ff4000]',
              note: null,
              onClick: () => setDrillDown({ title: ac(currentLanguage).tum_hesaplar, rows: bankAccounts.map(a => ({ label: a.bankName, sub: `${a.accountHolder} — ${a.accountType}`, badge: a.currency, badgeColor: a.currency === 'TRY' ? 'bg-green-100 text-green-600' : a.currency === 'USD' ? 'bg-blue-100 text-blue-600' : 'bg-purple-100 text-purple-600', value: paraYaz(a.balance, { birim: a.currency }) })) })
            },
          ].map((kpi, i) => (
            <button key={i} onClick={kpi.onClick} className="apple-card p-4 text-left cursor-pointer group">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-gray-500 font-medium">{kpi.label}</span>
                <span className={`text-base font-black ${kpi.color} group-hover:scale-110 transition-transform`}>{kpi.symbol}</span>
              </div>
              <div className={`text-xl font-bold ${kpi.color}`}>{kpi.value}</div>
              {kpi.note && <div className="text-[10px] text-amber-600 mt-1">{kpi.note}</div>}
              <div className="text-[10px] text-gray-300 mt-1 group-hover:text-gray-400 transition-colors">{oc(currentLanguage).detay_icin_tikla}</div>
            </button>
          ))}
        </div>
        <div className="apple-card p-4">
          {/* Row 1: Title + actions */}
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <h3 className="font-semibold text-gray-800">{t.bankCashAccounts}</h3>
            <div className="flex items-center gap-2">
              <label className="apple-button-secondary py-1.5 px-3 text-xs cursor-pointer">
                <Download size={12} />
                {t.importStatement}
                <input type="file" accept=".csv,.pdf" className="hidden" onChange={handleBankFileImport} />
              </label>
              <button onClick={openAddBank} className="apple-button-primary py-1.5 px-3 text-xs">
                <Plus size={14} /> {t.addAccount}
              </button>
            </div>
          </div>
          {/* Row 2: Search bar */}
          <div className="relative mb-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder={t.searchAccounts}
              value={bankSearch}
              onChange={e => setBankSearch(e.target.value)}
              className="apple-input w-full pl-9 py-2"
            />
          </div>
          {bankImportStatus && (
            <div className="mb-3 px-3 py-2 bg-green-50 text-green-700 text-xs rounded-xl font-medium flex items-center justify-between">
              <span>{bankImportStatus}</span>
              <button onClick={() => setBankImportStatus(null)} className="ml-2 text-green-500 hover:text-green-700"><X size={12} /></button>
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="apple-table">
              <thead>
                <tr className="border-b border-gray-100">
                  <SortHeader
                    label={t.bank}
                    sortKey="bankName"
                    currentSort={{ key: bankSortKey, direction: bankSortDir }}
                    onSort={(key) => toggleBankSort(key as keyof BankAccount)}
                  />
                  <SortHeader
                    label={t.accountType}
                    sortKey="accountType"
                    currentSort={{ key: bankSortKey, direction: bankSortDir }}
                    onSort={(key) => toggleBankSort(key as keyof BankAccount)}
                  />
                  <SortHeader
                    label={t.iban}
                    sortKey="iban"
                    currentSort={{ key: bankSortKey, direction: bankSortDir }}
                    onSort={(key) => toggleBankSort(key as keyof BankAccount)}
                    className="hidden sm:table-cell"
                  />
                  <SortHeader
                    label={t.balance}
                    sortKey="balance"
                    currentSort={{ key: bankSortKey, direction: bankSortDir }}
                    onSort={(key) => toggleBankSort(key as keyof BankAccount)}
                    className="text-right"
                  />
                  <SortHeader
                    label={t.currency}
                    sortKey="currency"
                    currentSort={{ key: bankSortKey, direction: bankSortDir }}
                    onSort={(key) => toggleBankSort(key as keyof BankAccount)}
                    className="hidden sm:table-cell"
                  />
                  <th className="text-center py-2 px-3 text-gray-500 font-medium">{t.actions}</th>
                </tr>
              </thead>
              <tbody>
                {displayedAccounts.length === 0 && (
                  <tr><td colSpan={6} className="text-center py-8 text-gray-400">{t.noAccounts}</td></tr>
                )}
                {displayedAccounts.map(acc => (
                  <tr key={acc.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                    <td className="py-2.5 px-3">
                      <div className="font-medium text-gray-800">{acc.bankName}</div>
                      <div className="text-xs text-gray-400">{acc.accountHolder}</div>
                    </td>
                    <td className="py-2.5 px-3 text-gray-600">{acc.accountType}</td>
                    <td className="py-2.5 px-3 text-gray-500 font-mono text-xs hidden sm:table-cell">{acc.iban}</td>
                    <td className="py-2.5 px-3 text-right font-semibold text-gray-800">
                      {paraYaz(acc.balance, { birim: acc.currency })}
                    </td>
                    <td className="py-2.5 px-3 hidden sm:table-cell">
                      <span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full text-xs font-semibold">{acc.currency}</span>
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="flex items-center justify-center gap-2">
                        <button onClick={() => openEditBank(acc)} className="action-btn-view" title={oc(currentLanguage).incele}><Eye size={14} /></button>
                        <button onClick={() => openEditBank(acc)} className="action-btn-edit" title={oc(currentLanguage).duzenle}><Edit2 size={14} /></button>
                        <button onClick={() => deleteBank(acc.id)} className="action-btn-delete"><Trash2 size={14} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Bank Transactions (Auto-Pull) ── */}
        <div className="apple-card p-4">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <div>
              <h3 className="font-semibold text-gray-800">{ac(currentLanguage).banka_hareketleri_2}</h3>
              <p className="text-xs text-gray-400 mt-0.5">
                {mikroEnabled && mikroConnected
                  ? ac(currentLanguage).mikro_erp_uzerinden_otomatik_cekilir
                  : ac(currentLanguage).mikro_entegrasyonu_etkinlestirilerek_otomatik_ce}
                {bankTxLastPull && <span className="ml-2 text-gray-300">· {ac(currentLanguage).son_cekim}: {bankTxLastPull}</span>}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {/* Auto-sync toggle */}
              <button
                onClick={() => setBankTxAutoSync(v => !v)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${bankTxAutoSync ? 'bg-green-50 border-green-200 text-green-700' : 'apple-button-secondary py-1.5 px-3 text-xs'}`}
                title={ac(currentLanguage).otomatik_senkronizasyon}
              >
                <RefreshCw size={12} className={bankTxAutoSync ? 'animate-spin' : ''} />
                {ac(currentLanguage).oto_sync}
                {bankTxAutoSync && <span className="w-1.5 h-1.5 bg-green-500 rounded-full" />}
              </button>
              <button
                onClick={pullBankTransactions}
                disabled={bankTxPulling || !mikroEnabled}
                className="apple-button-primary py-1.5 px-3 text-xs"
              >
                <ArrowRightLeft size={12} className={bankTxPulling ? 'animate-spin' : ''} />
                {bankTxPulling
                  ? (ac(currentLanguage).cekiliyor)
                  : (ac(currentLanguage).simdi_cek)}
              </button>
            </div>
          </div>

          {/* Filter + Search */}
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <div className="relative flex-1 min-w-[160px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
              <input
                type="text"
                placeholder={ac(currentLanguage).hareket_ara}
                value={bankTxSearch}
                onChange={e => setBankTxSearch(e.target.value)}
                className="apple-input w-full pl-8 py-2 text-xs"
              />
            </div>
            <div className="flex gap-1">
              {(['all', 'credit', 'debit'] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setBankTxFilter(f)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${bankTxFilter === f ? 'bg-brand text-white' : 'apple-button-secondary py-1.5'}`}
                >
                  {f === 'all' ? (oc(currentLanguage).tumu) : f === 'credit' ? (ac(currentLanguage).alacak) : (ac(currentLanguage).borc)}
                </button>
              ))}
            </div>
          </div>

          {!mikroEnabled && (
            <div className="flex items-center gap-2 px-4 py-3 bg-orange-50 text-orange-700 text-xs rounded-xl mb-3">
              <AlertCircle size={14} />
              {currentLanguage === 'tr'
                ? 'Otomatik çekim için Entegrasyonlar → Mikro ERP sekmesinden bağlantı kurun.'
                : 'Connect via Integrations → Mikro ERP tab to enable auto-pull.'}
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="apple-table">
              <thead>
                <tr>
                  {([
                    { key: 'date', label: oc(currentLanguage).tarih },
                    { key: 'accountName', label: oc(currentLanguage).hesap },
                    { key: 'description', label: oc(currentLanguage).aciklama },
                    { key: 'type', label: oc(currentLanguage).tur },
                    { key: 'amount', label: oc(currentLanguage).tutar, align: 'right' },
                    { key: 'balance', label: oc(currentLanguage).bakiye, align: 'right' },
                  ] as { key: keyof BankTransaction; label: string; align?: string }[]).map(col => (
                    <th
                      key={col.key}
                      onClick={() => setBankTxSort(s => ({ key: col.key, dir: s.key === col.key && s.dir === 'asc' ? 'desc' : 'asc' }))}
                      className={`cursor-pointer select-none px-4 py-3 text-[10px] font-bold uppercase tracking-wider transition-colors ${col.align === 'right' ? 'text-right' : 'text-left'} ${bankTxSort.key === col.key ? 'text-brand' : 'text-gray-400 hover:text-gray-600'}`}
                    >
                      {col.label}{' '}
                      <span className={bankTxSort.key === col.key ? 'opacity-100' : 'opacity-25'}>
                        {bankTxSort.key === col.key ? (bankTxSort.dir === 'asc' ? '↑' : '↓') : '↕'}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const filtered = bankTransactions
                    .filter(tx =>
                      (bankTxFilter === 'all' || tx.type === bankTxFilter) &&
                      (!bankTxSearch || tx.description.toLowerCase().includes(bankTxSearch.toLowerCase()) || tx.accountName.toLowerCase().includes(bankTxSearch.toLowerCase()) || (tx.reference ?? '').toLowerCase().includes(bankTxSearch.toLowerCase()))
                    )
                    .sort((a, b) => {
                      // Sayısal sütunlarda bilinmeyen (bakiyesi olmayan hareket) 0 sayılmaz, her iki yönde de
                      // sona gider (utils/para.ts sayiSirala); eski `?? ''` artan sıralamada başa diziyordu.
                      if (bankTxSort.key === 'amount' || bankTxSort.key === 'balance') return sayiSirala(a[bankTxSort.key], b[bankTxSort.key], bankTxSort.dir === 'desc');
                      const av = a[bankTxSort.key] ?? '';
                      const bv = b[bankTxSort.key] ?? '';
                      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
                      return bankTxSort.dir === 'asc' ? cmp : -cmp;
                    });
                  if (filtered.length === 0) return (
                    <tr>
                      <td colSpan={6} className="text-center py-10 text-gray-400 text-sm">
                        <div className="flex flex-col items-center gap-2">
                          <Landmark size={28} className="text-gray-300" />
                          <span>
                            {bankTransactions.length === 0
                              ? (ac(currentLanguage).simdi_cek_ile_mikro_dan_hareketleri_cekin)
                              : (ac(currentLanguage).arama_veya_filtre_sonucu_yok)}
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                  return filtered.map(tx => (
                    <tr key={tx.id} className="border-b border-gray-50 hover:bg-gray-50/60 transition-colors">
                      <td className="px-4 py-3 text-sm font-mono text-gray-500 whitespace-nowrap">{tx.date}</td>
                      <td className="px-4 py-3 text-sm text-gray-700">{tx.accountName || '—'}</td>
                      <td className="px-4 py-3 text-sm text-gray-800 max-w-[200px] truncate" title={tx.description}>{tx.description || '—'}</td>
                      <td className="px-4 py-3">
                        <span className={`apple-badge ${tx.type === 'credit' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                          {tx.type === 'credit' ? '↓ ' : '↑ '}
                          {tx.type === 'credit' ? (oc(currentLanguage).alacak) : (oc(currentLanguage).borc)}
                        </span>
                      </td>
                      <td className={`px-4 py-3 text-sm font-semibold text-right whitespace-nowrap ${tx.type === 'credit' ? 'text-green-600' : 'text-red-500'}`}>
                        {tx.type === 'debit' ? '−' : '+'}{paraYaz(tx.amount, { birim: tx.currency })}
                      </td>
                      <td className="px-4 py-3 text-sm text-right text-gray-600 whitespace-nowrap">
                        {paraYaz(tx.balance, { birim: tx.currency })}
                      </td>
                    </tr>
                  ));
                })()}
              </tbody>
            </table>
          </div>
        </div>
      </motion.div>

      {/* BANKA HESABI MODAL */}
      <AnimatePresence>
        {showBankModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowBankModal(false)} />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-white rounded-2xl shadow-2xl w-full max-w-md relative z-10 overflow-hidden">
              <div className="flex items-center justify-between p-5 border-b border-gray-100">
                <h3 className="font-semibold text-gray-800">{ac(currentLanguage).banka_hesabi} — {editingBank ? (oc(currentLanguage).duzenle) : t.add}</h3>
                <button onClick={() => setShowBankModal(false)} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"><X size={16} /></button>
              </div>
              <div className="p-5 space-y-3 max-h-[70vh] overflow-y-auto">
                {[
                  { label: ac(currentLanguage).bankName, key: 'bankName', placeholder: 'Ziraat Bankası' },
                  { label: oc(currentLanguage).sube, key: 'branch', placeholder: 'Merkez' },
                  { label: ac(currentLanguage).accountHolder, key: 'accountHolder', placeholder: 'Cetpa Ltd. Şti.' },
                  { label: ac(currentLanguage).hesap_no, key: 'accountNumber', placeholder: '1234-5678' },
                  { label: 'IBAN', key: 'iban', placeholder: 'TR00 0000 0000 0000 0000 0000 00' },
                ].map(f => (
                  <div key={f.key}>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{f.label}</label>
                    <input type="text" value={bankForm[f.key as keyof typeof bankForm] as string} onChange={e => setBankForm(prev => ({ ...prev, [f.key]: e.target.value }))} placeholder={f.placeholder} className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]" />
                  </div>
                ))}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{oc(currentLanguage).doviz}</label>
                    <select value={bankForm.currency} onChange={e => setBankForm(prev => ({ ...prev, currency: e.target.value as 'TRY' | 'USD' | 'EUR' }))} className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]">
                      {(['TRY', 'USD', 'EUR'] as const).map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{oc(currentLanguage).bakiye}</label>
                    {/* Boş alan 0 DEĞİL bilinmiyordur: '' olarak tutulur, saveBank kaydetmez (eski: Number('') → ₺0) */}
                    <input type="number" value={bankForm.balance} onChange={e => setBankForm(prev => ({ ...prev, balance: bilinenSayi(e.target.value) ? Number(e.target.value) : '' }))} placeholder={ac(currentLanguage).orn_125000} className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{ac(currentLanguage).hesap_tipi}</label>
                  <select value={bankForm.accountType} onChange={e => setBankForm(prev => ({ ...prev, accountType: e.target.value as 'Vadesiz' | 'Vadeli' | 'Kredi' | 'Kasa' | 'Akreditif (L/C)' | 'Teminat Mektubu' }))} className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]">
                    {(['Vadesiz', 'Vadeli', 'Kredi', 'Kasa', 'Akreditif (L/C)', 'Teminat Mektubu'] as const).map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>
              <div className="flex justify-end gap-2 p-5 border-t border-gray-100">
                <button onClick={() => setShowBankModal(false)} className="bg-gray-100 hover:bg-gray-200 rounded-full px-4 py-2 text-sm font-semibold transition-colors">{t.cancel}</button>
                <button onClick={saveBank} className="apple-button-primary"><Save size={14} /> {t.save}</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
