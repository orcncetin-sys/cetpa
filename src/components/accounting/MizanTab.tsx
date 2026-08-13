import { motion } from 'motion/react';
import { TrendingDown, TrendingUp, ArrowUpDown, Wallet, CheckCircle, AlertCircle, Search, Download } from 'lucide-react';
import { SortHeader, formatTRY, exportCSV, type AccountingT } from './shared';

type MizanRow = { hesap: string; borc: number; alacak: number; borcBakiye: number; alacakBakiye: number };
type MizanSortKey = 'hesap' | 'borc' | 'alacak' | 'borcBakiye' | 'alacakBakiye';
type DrillDown = { title: string; rows: { label: string; value: string; sub?: string; badge?: string; badgeColor?: string }[]; total?: string };

interface MizanTabProps {
  t: AccountingT;
  currentLanguage: string;
  mizanRows: MizanRow[];
  mizanTotals: { borc: number; alacak: number; borcBakiye: number; alacakBakiye: number };
  mizanDengeli: boolean;
  hasMikroMizan: boolean;
  kpiCurrency: 'TRY' | 'USD' | 'EUR';
  setKpiCurrency: (c: 'TRY' | 'USD' | 'EUR') => void;
  formatConv: (n: number) => string;
  setDrillDown: (d: DrillDown | null) => void;
  mizanSearch: string;
  setMizanSearch: (v: string) => void;
  mizanSortKey: MizanSortKey;
  mizanSortDir: 'asc' | 'desc';
  toggleMizanSort: (key: MizanSortKey) => void;
  displayedMizan: MizanRow[];
}

export default function MizanTab({
  t, currentLanguage, mizanRows, mizanTotals, mizanDengeli, hasMikroMizan,
  kpiCurrency, setKpiCurrency, formatConv, setDrillDown,
  mizanSearch, setMizanSearch, mizanSortKey, mizanSortDir, toggleMizanSort, displayedMizan,
}: MizanTabProps) {
  const CurrencyPicker = () => (
    <div className="flex items-center gap-0.5 bg-gray-100 rounded-lg p-0.5">
      {(['TRY', 'USD', 'EUR'] as const).map(c => (
        <button key={c} onClick={e => { e.stopPropagation(); setKpiCurrency(c); }}
          className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md transition-all ${kpiCurrency === c ? 'bg-white shadow-sm text-gray-800' : 'text-gray-400 hover:text-gray-600'}`}>
          {c === 'TRY' ? '₺' : c === 'USD' ? '$' : '€'}
        </button>
      ))}
    </div>
  );

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {/* Toplam Borç */}
        <div onClick={() => setDrillDown({ title: currentLanguage === 'tr' ? 'Borç Toplamı — Hesap Detayı' : 'Total Debit — Account Detail', rows: mizanRows.filter(r => r.borc > 0).sort((a, b) => b.borc - a.borc).map(r => ({ label: r.hesap, value: formatConv(r.borc) })), total: formatConv(mizanTotals.borc) })} role="button" tabIndex={0} onKeyDown={e => e.key === 'Enter' && setDrillDown({ title: currentLanguage === 'tr' ? 'Borç Toplamı — Hesap Detayı' : 'Total Debit — Account Detail', rows: mizanRows.filter(r => r.borc > 0).sort((a, b) => b.borc - a.borc).map(r => ({ label: r.hesap, value: formatConv(r.borc) })), total: formatConv(mizanTotals.borc) })} className="apple-card p-4 cursor-pointer flex flex-col justify-between">
          <div className="flex items-center justify-between mb-3">
            <div className="w-8 h-8 rounded-xl bg-red-100 flex items-center justify-center">
              <TrendingDown size={15} className="text-red-600" />
            </div>
            <CurrencyPicker />
          </div>
          <p className="text-xl font-bold text-red-600">{formatConv(mizanTotals.borc)}</p>
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mt-1">{t.totalDebit}</p>
        </div>
        {/* Toplam Alacak */}
        <div onClick={() => setDrillDown({ title: currentLanguage === 'tr' ? 'Alacak Toplamı — Hesap Detayı' : 'Total Credit — Account Detail', rows: mizanRows.filter(r => r.alacak > 0).sort((a, b) => b.alacak - a.alacak).map(r => ({ label: r.hesap, value: formatConv(r.alacak) })), total: formatConv(mizanTotals.alacak) })} role="button" tabIndex={0} onKeyDown={e => e.key === 'Enter' && setDrillDown({ title: currentLanguage === 'tr' ? 'Alacak Toplamı — Hesap Detayı' : 'Total Credit — Account Detail', rows: mizanRows.filter(r => r.alacak > 0).sort((a, b) => b.alacak - a.alacak).map(r => ({ label: r.hesap, value: formatConv(r.alacak) })), total: formatConv(mizanTotals.alacak) })} className="apple-card p-4 cursor-pointer flex flex-col justify-between">
          <div className="flex items-center justify-between mb-3">
            <div className="w-8 h-8 rounded-xl bg-green-100 flex items-center justify-center">
              <TrendingUp size={15} className="text-green-600" />
            </div>
            <CurrencyPicker />
          </div>
          <p className="text-xl font-bold text-green-600">{formatConv(mizanTotals.alacak)}</p>
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mt-1">{t.totalCredit}</p>
        </div>
        {/* Borç Bakiyesi */}
        <div onClick={() => setDrillDown({ title: currentLanguage === 'tr' ? 'Borç Bakiyesi — Hesap Detayı' : 'Debit Balance — Account Detail', rows: mizanRows.filter(r => r.borcBakiye > 0).sort((a, b) => b.borcBakiye - a.borcBakiye).map(r => ({ label: r.hesap, value: formatConv(r.borcBakiye) })), total: formatConv(mizanTotals.borcBakiye) })} role="button" tabIndex={0} onKeyDown={e => e.key === 'Enter' && setDrillDown({ title: currentLanguage === 'tr' ? 'Borç Bakiyesi — Hesap Detayı' : 'Debit Balance — Account Detail', rows: mizanRows.filter(r => r.borcBakiye > 0).sort((a, b) => b.borcBakiye - a.borcBakiye).map(r => ({ label: r.hesap, value: formatConv(r.borcBakiye) })), total: formatConv(mizanTotals.borcBakiye) })} className="apple-card p-4 cursor-pointer flex flex-col justify-between">
          <div className="flex items-center justify-between mb-3">
            <div className="w-8 h-8 rounded-xl bg-red-50 flex items-center justify-center">
              <ArrowUpDown size={15} className="text-red-500" />
            </div>
            <CurrencyPicker />
          </div>
          <p className="text-xl font-bold text-red-500">{formatConv(mizanTotals.borcBakiye)}</p>
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mt-1">{t.debitBalance}</p>
        </div>
        {/* Alacak Bakiyesi */}
        <div onClick={() => setDrillDown({ title: currentLanguage === 'tr' ? 'Alacak Bakiyesi — Hesap Detayı' : 'Credit Balance — Account Detail', rows: mizanRows.filter(r => r.alacakBakiye > 0).sort((a, b) => b.alacakBakiye - a.alacakBakiye).map(r => ({ label: r.hesap, value: formatConv(r.alacakBakiye) })), total: formatConv(mizanTotals.alacakBakiye) })} role="button" tabIndex={0} onKeyDown={e => e.key === 'Enter' && setDrillDown({ title: currentLanguage === 'tr' ? 'Alacak Bakiyesi — Hesap Detayı' : 'Credit Balance — Account Detail', rows: mizanRows.filter(r => r.alacakBakiye > 0).sort((a, b) => b.alacakBakiye - a.alacakBakiye).map(r => ({ label: r.hesap, value: formatConv(r.alacakBakiye) })), total: formatConv(mizanTotals.alacakBakiye) })} className="apple-card p-4 cursor-pointer flex flex-col justify-between">
          <div className="flex items-center justify-between mb-3">
            <div className="w-8 h-8 rounded-xl bg-green-50 flex items-center justify-center">
              <Wallet size={15} className="text-green-500" />
            </div>
            <CurrencyPicker />
          </div>
          <p className="text-xl font-bold text-green-500">{formatConv(mizanTotals.alacakBakiye)}</p>
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mt-1">{t.creditBalance}</p>
        </div>
      </div>
      <div className="apple-card p-4">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <h3 className="font-semibold text-gray-800">{t.trialBalanceTitle}</h3>
            <span className={`flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full ${mizanDengeli ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'}`}>
              {mizanDengeli ? <><CheckCircle size={12} /> {t.balanced}</> : <><AlertCircle size={12} /> {t.notBalanced}</>}
            </span>
            {hasMikroMizan && (
              <span className="text-[10px] font-semibold text-blue-500 bg-blue-50 px-2 py-1 rounded-full">
                {currentLanguage === 'tr' ? 'Mikro faturaları dahil (120/391/153/191/320)' : 'Includes Mikro invoices (120/391/153/191/320)'}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder={currentLanguage === 'en' ? 'Search accounts...' : 'Hesap ara...'}
                value={mizanSearch}
                onChange={e => setMizanSearch(e.target.value)}
                className="apple-input pl-7 pr-3 py-1.5 w-44"
              />
            </div>
            <button
              onClick={() => exportCSV('mizan.csv',
                ['Hesap', 'Borç Toplamı', 'Alacak Toplamı', 'Borç Bakiyesi', 'Alacak Bakiyesi'],
                mizanRows.map(r => [r.hesap, r.borc, r.alacak, r.borcBakiye, r.alacakBakiye])
              )}
              className="apple-button-secondary py-2 px-4 text-sm"
            >
              <Download size={14} /> CSV
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="apple-table">
            <thead>
              <tr className="border-b border-gray-100">
                <SortHeader
                  label={t.accountCode}
                  sortKey="hesap"
                  currentSort={{ key: mizanSortKey, direction: mizanSortDir }}
                  onSort={(key) => toggleMizanSort(key as MizanSortKey)}
                />
                <SortHeader
                  label={t.totalDebit}
                  sortKey="borc"
                  currentSort={{ key: mizanSortKey, direction: mizanSortDir }}
                  onSort={(key) => toggleMizanSort(key as MizanSortKey)}
                  className="text-right"
                />
                <SortHeader
                  label={t.totalCredit}
                  sortKey="alacak"
                  currentSort={{ key: mizanSortKey, direction: mizanSortDir }}
                  onSort={(key) => toggleMizanSort(key as MizanSortKey)}
                  className="text-right"
                />
                <SortHeader
                  label={t.debitBalance}
                  sortKey="borcBakiye"
                  currentSort={{ key: mizanSortKey, direction: mizanSortDir }}
                  onSort={(key) => toggleMizanSort(key as MizanSortKey)}
                  className="text-right hidden sm:table-cell"
                />
                <SortHeader
                  label={t.creditBalance}
                  sortKey="alacakBakiye"
                  currentSort={{ key: mizanSortKey, direction: mizanSortDir }}
                  onSort={(key) => toggleMizanSort(key as MizanSortKey)}
                  className="text-right hidden sm:table-cell"
                />
              </tr>
            </thead>
            <tbody>
              {displayedMizan.length === 0 && (
                <tr><td colSpan={5} className="text-center py-8 text-gray-400">{t.noJournalEntries}</td></tr>
              )}
              {displayedMizan.map((r, i) => (
                <tr key={i} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                  <td className="py-2.5 px-3 text-gray-700 font-medium text-xs">{r.hesap}</td>
                  <td className="py-2.5 px-3 text-right text-red-600 font-semibold">{formatTRY(r.borc)}</td>
                  <td className="py-2.5 px-3 text-right text-green-600 font-semibold">{formatTRY(r.alacak)}</td>
                  <td className="py-2.5 px-3 text-right text-red-500 hidden sm:table-cell">{r.borcBakiye > 0 ? formatTRY(r.borcBakiye) : '-'}</td>
                  <td className="py-2.5 px-3 text-right text-green-500 hidden sm:table-cell">{r.alacakBakiye > 0 ? formatTRY(r.alacakBakiye) : '-'}</td>
                </tr>
              ))}
              {mizanRows.length > 0 && (
                <tr className="bg-gray-50 font-bold border-t-2 border-gray-200">
                  <td className="py-2.5 px-3 text-gray-800">{t.total}</td>
                  <td className="py-2.5 px-3 text-right text-red-700">{formatTRY(mizanTotals.borc)}</td>
                  <td className="py-2.5 px-3 text-right text-green-700">{formatTRY(mizanTotals.alacak)}</td>
                  <td className="py-2.5 px-3 text-right text-red-600 hidden sm:table-cell">{formatTRY(mizanTotals.borcBakiye)}</td>
                  <td className="py-2.5 px-3 text-right text-green-600 hidden sm:table-cell">{formatTRY(mizanTotals.alacakBakiye)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </motion.div>
  );
}
