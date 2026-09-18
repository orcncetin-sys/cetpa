import { motion } from 'motion/react';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { formatInCurrency, paraYaz } from '../../utils/currency';
import { sayiSirala } from '../../utils/para';
import { cubukYuzdesi } from '../../utils/muhasebe/gelirGider';
import { gunBasi } from '../../utils/zaman';
import { formatTRY, type AccountingT } from './shared';
import { oc } from '../../i18n/ortak';
import { ac } from '../../i18n/accounting';

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
  // `Number.isFinite`, global `isFinite` DEĞİL (CLAUDE.md): global sürüm null/'''i 0'a zorlar.
  if (!kur || !Number.isFinite(kur) || kur <= 0) {
    return oc(currentLanguage).kur_bekleniyor;
  }
  return `1 ${currency} = ${paraYaz(kur)}`;
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
  /** Tutarı bilinmeyen (toplama girmeyen) gelir / gider kaydı adedi — KPI altı not. */
  gelirTutarsiz: number;
  giderTutarsiz: number;
  /** Tarihi çözülemeyen kayıt adedi — hiçbir döneme dahil edilmedi. */
  tarihsiz: number;
}

export default function GelirGiderTab({
  t, currentLanguage, MONTHS, gelirMonth, setGelirMonth, gelirYear, setGelirYear,
  gelirDateFrom, setGelirDateFrom, gelirDateTo, setGelirDateTo, gelirUseRange, setGelirUseRange,
  gelirCurrency, setGelirCurrency, exchangeRates, setDrillDown,
  gelirBreakdown, giderBreakdown, toplamGelir, toplamGider, netKar, monthlyData, maxChartVal,
  gelirTutarsiz, giderTutarsiz, tarihsiz,
}: GelirGiderTabProps) {
  // NaN net ("bir kayıt bile bilinmiyor") `netKar >= 0` kıyasında false döner ve eskiden
  // sessizce 'Zarar' rozeti + kırmızı basardı; nötr gri + '—' + not için ayrı bayrak.
  const netBilinmiyor = !Number.isFinite(netKar);
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
              // `new Date(string)` DEĞİL (zaman.ts): tarih-only string UTC gece yarısına sabitlenir,
              // UTC batısındaki tarayıcıda ay bir gün kayık okunurdu. Hesap katmanı (gelirGider.ts)
              // YEREL gün anahtarı kullanıyor — seçici de aynı takvimde kalmalı. Çözülemezse dokunma.
              const d = gunBasi(e.target.value);
              if (d) {
                setGelirMonth(d.getMonth() + 1);
                setGelirYear(d.getFullYear());
              }
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
      {tarihsiz > 0 && <p className="text-[10px] text-amber-600 px-1">{tarihsiz} {ac(currentLanguage).kayit_tarihsiz_hicbir_doneme_dahil_edilmedi}</p>}
      {/* Currency switcher + KPI Cards */}
      <div className="flex items-center gap-1 apple-card px-3 py-2 w-fit">
        <span className="text-xs text-gray-400 font-medium mr-1">{oc(currentLanguage).para_birimi_2}</span>
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
        <button onClick={() => setDrillDown({ title: ac(currentLanguage).gelir_detayi, rows: Object.entries(gelirBreakdown).sort(([,a],[,b]) => sayiSirala(a, b, true)).map(([hesap,tutar])=>({ label: hesap, value: formatInCurrency(tutar, gelirCurrency, exchangeRates) })), total: formatInCurrency(toplamGelir, gelirCurrency, exchangeRates) })} className="apple-card p-4 text-left cursor-pointer group">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-gray-500 font-medium">{t.totalIncome}</span>
            <TrendingUp size={16} className="text-green-500" />
          </div>
          <div className="text-2xl font-bold text-green-600">
            {formatInCurrency(toplamGelir, gelirCurrency, exchangeRates)}
          </div>
          {gelirTutarsiz > 0 && <p className="text-[10px] text-amber-600">{gelirTutarsiz} {ac(currentLanguage).kayit_tutarsiz_toplama_girmedi}</p>}
          <div className="text-[10px] text-gray-300 mt-1 group-hover:text-gray-400 transition-colors">{ac(currentLanguage).detay_icin_tikla_mikro_satis_faturalari_dahil}</div>
        </button>
        <button onClick={() => setDrillDown({ title: ac(currentLanguage).gider_detayi, rows: Object.entries(giderBreakdown).sort(([,a],[,b]) => sayiSirala(a, b, true)).map(([hesap,tutar])=>({ label: hesap, value: formatInCurrency(tutar, gelirCurrency, exchangeRates) })), total: formatInCurrency(toplamGider, gelirCurrency, exchangeRates) })} className="apple-card p-4 text-left cursor-pointer group">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-gray-500 font-medium">{t.totalExpense}</span>
            <TrendingDown size={16} className="text-red-500" />
          </div>
          <div className="text-2xl font-bold text-red-600">
            {formatInCurrency(toplamGider, gelirCurrency, exchangeRates)}
          </div>
          {giderTutarsiz > 0 && <p className="text-[10px] text-amber-600">{giderTutarsiz} {ac(currentLanguage).kayit_tutarsiz_toplama_girmedi}</p>}
          <div className="text-[10px] text-gray-300 mt-1 group-hover:text-gray-400 transition-colors">{ac(currentLanguage).detay_icin_tikla_yalniz_elle_girilen_kayitlar_mi}</div>
        </button>
        <button onClick={() => setDrillDown({ title: ac(currentLanguage).net_kar_zarar_ozeti, rows: [{ label: ac(currentLanguage).totalIncome, value: formatInCurrency(toplamGelir, gelirCurrency, exchangeRates) }, { label: ac(currentLanguage).totalExpense, value: formatInCurrency(toplamGider, gelirCurrency, exchangeRates) }, { label: 'Net', badge: netBilinmiyor ? '—' : netKar >= 0 ? 'Kâr' : 'Zarar', badgeColor: netBilinmiyor ? 'bg-gray-100 text-gray-500' : netKar >= 0 ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600', value: formatInCurrency(netKar, gelirCurrency, exchangeRates) }] })} className="apple-card p-4 text-left cursor-pointer group">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-gray-500 font-medium">{t.netProfit}</span>
            <span className={`text-base font-black ${netBilinmiyor ? 'text-gray-400' : netKar >= 0 ? 'text-green-500' : 'text-red-500'}`}>
              {gelirCurrency === 'USD' ? '$' : gelirCurrency === 'EUR' ? '€' : '₺'}
            </span>
          </div>
          <div className={`text-2xl font-bold ${netBilinmiyor ? 'text-gray-400' : netKar >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            {formatInCurrency(netKar, gelirCurrency, exchangeRates)}
          </div>
          {netBilinmiyor && <p className="text-[10px] text-amber-600">{ac(currentLanguage).net_hesaplanamadi_tutarsiz_kayit_var}</p>}
          <div className="text-[10px] text-gray-300 mt-1 group-hover:text-gray-400 transition-colors">{oc(currentLanguage).detay_icin_tikla}</div>
        </button>
      </div>
      {/* Bar Chart */}
      <div className="apple-card p-4">
        <h3 className="font-semibold text-gray-800 mb-4">{t.annualChart(gelirYear)}</h3>
        <div className="overflow-x-auto">
          <div className="flex items-end gap-2 min-w-[600px] h-48 px-2">
            {monthlyData.map((d, i) => {
              // Yükseklik hesabı tek kaynakta (utils/muhasebe/gelirGider.cubukYuzdesi): null =
              // o ayın tutarı BİLİNMİYOR. Eskiden `(NaN / tavan) * 100` → `height: "NaN%"` (tarayıcı
              // yok sayar) + `minHeight: 0` çıkıyor, çubuk HİÇ çizilmiyordu; tutarı okunamayan ay
              // hareketsiz ayla aynı görünüyordu. DashboardPage'in 7 günlük eğiliminde verilen
              // karar burada da: gri taban çubuğu + başlıkta '—'.
              const gelirYuzde = cubukYuzdesi(d.gelir, maxChartVal);
              const giderYuzde = cubukYuzdesi(d.gider, maxChartVal);
              return (
              <div key={i} className="flex-1 flex flex-col items-center gap-1">
                <div className="w-full flex items-end justify-center gap-0.5 h-36">
                  <div
                    className={`flex-1 rounded-t-sm transition-all ${gelirYuzde === null ? 'bg-gray-300' : 'bg-green-400'}`}
                    style={{ height: `${gelirYuzde ?? 4}%`, minHeight: gelirYuzde === null || d.gelir > 0 ? 4 : 0 }}
                    title={`${t.income}: ${formatTRY(d.gelir)}`}
                  />
                  <div
                    className={`flex-1 rounded-t-sm transition-all ${giderYuzde === null ? 'bg-gray-300' : 'bg-red-400'}`}
                    style={{ height: `${giderYuzde ?? 4}%`, minHeight: giderYuzde === null || d.gider > 0 ? 4 : 0 }}
                    title={`${t.expense}: ${formatTRY(d.gider)}`}
                  />
                </div>
                <span className="text-[10px] text-gray-500">{d.month.slice(0, 3)}</span>
              </div>
              );
            })}
          </div>
          <div className="flex gap-4 mt-2 justify-center flex-wrap">
            <div className="flex items-center gap-1.5 text-xs text-gray-500"><div className="w-3 h-3 rounded-sm bg-green-400" /> {t.income}</div>
            <div className="flex items-center gap-1.5 text-xs text-gray-500"><div className="w-3 h-3 rounded-sm bg-red-400" /> {t.expense}</div>
            {monthlyData.some(d => !Number.isFinite(d.gelir) || !Number.isFinite(d.gider)) && (
              <div className="flex items-center gap-1.5 text-xs text-gray-500"><div className="w-3 h-3 rounded-sm bg-gray-300" /> {ac(currentLanguage).gri_tutar_bilinmiyor}</div>
            )}
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
