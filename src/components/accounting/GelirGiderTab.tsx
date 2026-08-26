import { motion } from 'motion/react';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { formatInCurrency } from '../../utils/currency';
import { formatTRY, type AccountingT } from './shared';

/**
 * Kur ETİKETİ ("1 USD = ₺41,20"). Kur yoksa RAKAM BASMAZ.
 *
 * ESKİDEN: `(exchangeRates.USD || 0).toLocaleString(...)` — dış koşul yalnız
 * `exchangeRates` nesnesinin varlığına bakıyordu, o nesnede USD/EUR anahtarı
 * eksik ya da 0 olduğunda etiket "1 USD = ₺0,00" yazıyordu. Sıfır bir kur
 * değil, "veri yok" demek; onu rakam olarak basmak sahte kesinlik.
 */
const kurEtiketi = (
  currency: 'USD' | 'EUR',
  exchangeRates: Record<string, number> | undefined,
  currentLanguage: string,
): string => {
  const kur = exchangeRates?.[currency];
  if (!kur || !isFinite(kur) || kur <= 0) {
    return currentLanguage === 'tr' ? 'Kur bekleniyor' : 'Rate pending';
  }
  return `1 ${currency} = ₺${kur.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

type DrillDown = { title: string; rows: { label: string; value: string; sub?: string; badge?: string; badgeColor?: string }[]; total?: string };
type MonthlyDatum = { month: string; gelir: number; gider: number };

interface GelirGiderTabProps {
  t: AccountingT;
  currentLanguage: string;
  MONTHS: string[];
  gelirMonth: number;
  setGelirMonth: (v: number) => void;
  gelirYear: number;
  setGelirYear: (v: number) => void;
  gelirDateFrom: string;
  setGelirDateFrom: (v: string) => void;
  gelirDateTo: string;
  setGelirDateTo: (v: string) => void;
  gelirUseRange: boolean;
  setGelirUseRange: (v: boolean) => void;
  gelirCurrency: 'TRY' | 'USD' | 'EUR';
  setGelirCurrency: (c: 'TRY' | 'USD' | 'EUR') => void;
  exchangeRates: Record<string, number> | undefined;
  setDrillDown: (d: DrillDown | null) => void;
  gelirBreakdown: Record<string, number>;
  giderBreakdown: Record<string, number>;
  toplamGelir: number;
  toplamGider: number;
  netKar: number;
  monthlyData: MonthlyDatum[];
  maxChartVal: number;
}

export default function GelirGiderTab({
  t, currentLanguage, MONTHS, gelirMonth, setGelirMonth, gelirYear, setGelirYear,
  gelirDateFrom, setGelirDateFrom, gelirDateTo, setGelirDateTo, gelirUseRange, setGelirUseRange,
  gelirCurrency, setGelirCurrency, exchangeRates, setDrillDown,
  gelirBreakdown, giderBreakdown, toplamGelir, toplamGider, netKar, monthlyData, maxChartVal,
}: GelirGiderTabProps) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
      {/* Filters */}
      <div className="apple-card p-4 flex flex-wrap gap-3 items-center">
        <span className="text-sm font-medium text-gray-600">{t.period}</span>
        <select value={gelirMonth} onChange={e => { setGelirMonth(Number(e.target.value)); setGelirUseRange(false); }} className="apple-input py-2 px-3">
          {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
        </select>
        <input type="number" value={gelirYear} onChange={e => { setGelirYear(Number(e.target.value)); setGelirUseRange(false); }} className="apple-input py-2 px-3 w-24" />
        <span className="text-gray-300 text-sm">|</span>
        <span className="text-sm font-medium text-gray-600">{currentLanguage === 'en' ? 'Or date range:' : 'Veya tarih aralığı:'}</span>
        <input
          type="date"
          value={gelirDateFrom}
          onChange={e => {
            setGelirDateFrom(e.target.value);
            if (e.target.value) {
              setGelirUseRange(true);
              const d = new Date(e.target.value);
              setGelirMonth(d.getMonth() + 1);
              setGelirYear(d.getFullYear());
            }
          }}
          className="apple-input py-2 px-3"
        />
        <span className="text-gray-400 text-sm">—</span>
        <input
          type="date"
          value={gelirDateTo}
          onChange={e => {
            setGelirDateTo(e.target.value);
            if (e.target.value) setGelirUseRange(true);
          }}
          className="apple-input py-2 px-3"
        />
        {gelirUseRange && (
          <button onClick={() => { setGelirUseRange(false); setGelirDateFrom(''); setGelirDateTo(''); }} className="text-xs font-bold text-brand hover:underline">
            ✕ {currentLanguage === 'en' ? 'Clear range' : 'Aralığı temizle'}
          </button>
        )}
      </div>
      {/* Currency switcher + KPI Cards */}
      <div className="flex items-center gap-1 apple-card px-3 py-2 w-fit">
        <span className="text-xs text-gray-400 font-medium mr-1">{currentLanguage === 'tr' ? 'Para Birimi:' : 'Currency:'}</span>
        {(['TRY', 'USD', 'EUR'] as const).map(cur => (
          <button
            key={cur}
            onClick={() => setGelirCurrency(cur)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${gelirCurrency === cur ? 'bg-brand text-white shadow-sm' : 'text-gray-500 hover:bg-gray-100'}`}
          >
            {cur === 'TRY' ? '₺ TRY' : cur === 'USD' ? '$ USD' : '€ EUR'}
          </button>
        ))}
        {exchangeRates && (
          <span className="ml-2 text-[10px] text-gray-400 font-mono">
            {gelirCurrency === 'TRY' ? 'TCMB' : kurEtiketi(gelirCurrency, exchangeRates, currentLanguage)}
          </span>
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <button onClick={() => setDrillDown({ title: currentLanguage === 'tr' ? 'Gelir Detayı' : 'Income Detail', rows: Object.entries(gelirBreakdown).sort(([,a],[,b])=>(b as number)-(a as number)).map(([hesap,tutar])=>({ label: hesap, value: formatInCurrency(tutar as number, gelirCurrency, exchangeRates) })), total: formatInCurrency(toplamGelir, gelirCurrency, exchangeRates) })} className="apple-card p-4 text-left cursor-pointer group">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-gray-500 font-medium">{t.totalIncome}</span>
            <TrendingUp size={16} className="text-green-500" />
          </div>
          <div className="text-2xl font-bold text-green-600">
            {formatInCurrency(toplamGelir, gelirCurrency, exchangeRates)}
          </div>
          <div className="text-[10px] text-gray-300 mt-1 group-hover:text-gray-400 transition-colors">{currentLanguage === 'tr' ? 'Detay için tıkla · Mikro satış faturaları dahil' : 'Click for details · includes Mikro sales invoices'}</div>
        </button>
        <button onClick={() => setDrillDown({ title: currentLanguage === 'tr' ? 'Gider Detayı' : 'Expense Detail', rows: Object.entries(giderBreakdown).sort(([,a],[,b])=>(b as number)-(a as number)).map(([hesap,tutar])=>({ label: hesap, value: formatInCurrency(tutar as number, gelirCurrency, exchangeRates) })), total: formatInCurrency(toplamGider, gelirCurrency, exchangeRates) })} className="apple-card p-4 text-left cursor-pointer group">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-gray-500 font-medium">{t.totalExpense}</span>
            <TrendingDown size={16} className="text-red-500" />
          </div>
          <div className="text-2xl font-bold text-red-600">
            {formatInCurrency(toplamGider, gelirCurrency, exchangeRates)}
          </div>
          <div className="text-[10px] text-gray-300 mt-1 group-hover:text-gray-400 transition-colors">{currentLanguage === 'tr' ? 'Detay için tıkla · yalnız elle girilen kayıtlar (Mikro alışı stok, gider değil)' : 'Click for details · manual entries only (Mikro purchases post to inventory, not expense)'}</div>
        </button>
        <button onClick={() => setDrillDown({ title: currentLanguage === 'tr' ? 'Net Kâr/Zarar Özeti' : 'Net Profit/Loss Summary', rows: [{ label: currentLanguage === 'tr' ? 'Toplam Gelir' : 'Total Income', value: formatInCurrency(toplamGelir, gelirCurrency, exchangeRates) }, { label: currentLanguage === 'tr' ? 'Toplam Gider' : 'Total Expense', value: formatInCurrency(toplamGider, gelirCurrency, exchangeRates) }, { label: 'Net', badge: netKar >= 0 ? 'Kâr' : 'Zarar', badgeColor: netKar >= 0 ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600', value: formatInCurrency(netKar, gelirCurrency, exchangeRates) }] })} className="apple-card p-4 text-left cursor-pointer group">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-gray-500 font-medium">{t.netProfit}</span>
            <span className={`text-base font-black ${netKar >= 0 ? 'text-green-500' : 'text-red-500'}`}>
              {gelirCurrency === 'USD' ? '$' : gelirCurrency === 'EUR' ? '€' : '₺'}
            </span>
          </div>
          <div className={`text-2xl font-bold ${netKar >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            {formatInCurrency(netKar, gelirCurrency, exchangeRates)}
          </div>
          <div className="text-[10px] text-gray-300 mt-1 group-hover:text-gray-400 transition-colors">{currentLanguage === 'tr' ? 'Detay için tıkla' : 'Click for details'}</div>
        </button>
      </div>
      {/* Bar Chart */}
      <div className="apple-card p-4">
        <h3 className="font-semibold text-gray-800 mb-4">{t.annualChart(gelirYear)}</h3>
        <div className="overflow-x-auto">
          <div className="flex items-end gap-2 min-w-[600px] h-48 px-2">
            {monthlyData.map((d, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-1">
                <div className="w-full flex items-end justify-center gap-0.5 h-36">
                  <div
                    className="flex-1 bg-green-400 rounded-t-sm transition-all"
                    style={{ height: `${maxChartVal > 0 ? (d.gelir / maxChartVal) * 100 : 0}%`, minHeight: d.gelir > 0 ? 4 : 0 }}
                    title={`${t.income}: ${formatTRY(d.gelir)}`}
                  />
                  <div
                    className="flex-1 bg-red-400 rounded-t-sm transition-all"
                    style={{ height: `${maxChartVal > 0 ? (d.gider / maxChartVal) * 100 : 0}%`, minHeight: d.gider > 0 ? 4 : 0 }}
                    title={`${t.expense}: ${formatTRY(d.gider)}`}
                  />
                </div>
                <span className="text-[10px] text-gray-500">{d.month.slice(0, 3)}</span>
              </div>
            ))}
          </div>
          <div className="flex gap-4 mt-2 justify-center">
            <div className="flex items-center gap-1.5 text-xs text-gray-500"><div className="w-3 h-3 rounded-sm bg-green-400" /> {t.income}</div>
            <div className="flex items-center gap-1.5 text-xs text-gray-500"><div className="w-3 h-3 rounded-sm bg-red-400" /> {t.expense}</div>
          </div>
        </div>
      </div>
      {/* Breakdown Tables */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
          <h4 className="font-semibold text-gray-800 mb-3 text-sm">{t.incomeBreakdown}</h4>
          <div className="overflow-x-auto">
            <table className="apple-table">
              <thead><tr className="border-b border-gray-100"><th className="text-left py-1.5 px-2 text-gray-500 font-medium">{t.account}</th><th className="text-right py-1.5 px-2 text-gray-500 font-medium">{t.amount}</th></tr></thead>
              <tbody>
                {Object.entries(gelirBreakdown).length === 0 && <tr><td colSpan={2} className="text-center py-4 text-gray-400 text-xs">{t.noIncomeThisPeriod}</td></tr>}
                {Object.entries(gelirBreakdown).map(([hesap, tutar], i) => (
                  <tr key={i} className="border-b border-gray-50"><td className="py-2 px-2 text-gray-600 text-xs">{hesap}</td><td className="py-2 px-2 text-right font-semibold text-green-600">{formatTRY(tutar)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
          <h4 className="font-semibold text-gray-800 mb-3 text-sm">{t.expenseBreakdown}</h4>
          <div className="overflow-x-auto">
            <table className="apple-table">
              <thead><tr className="border-b border-gray-100"><th className="text-left py-1.5 px-2 text-gray-500 font-medium">{t.account}</th><th className="text-right py-1.5 px-2 text-gray-500 font-medium">{t.amount}</th></tr></thead>
              <tbody>
                {Object.entries(giderBreakdown).length === 0 && <tr><td colSpan={2} className="text-center py-4 text-gray-400 text-xs">{t.noExpenseThisPeriod}</td></tr>}
                {Object.entries(giderBreakdown).map(([hesap, tutar], i) => (
                  <tr key={i} className="border-b border-gray-50"><td className="py-2 px-2 text-gray-600 text-xs">{hesap}</td><td className="py-2 px-2 text-right font-semibold text-red-600">{formatTRY(tutar)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
