import { motion } from 'motion/react';
import { type Order, type Employee } from '../../types';

interface GelirTablosuTabProps {
  currentLanguage: string;
  orders: Order[];
  gelirYear: number;
  setGelirYear: (v: number) => void;
  gelirMonth: number;
  setGelirMonth: (v: number) => void;
  gelirCurrency: 'TRY' | 'USD' | 'EUR';
  setGelirCurrency: (c: 'TRY' | 'USD' | 'EUR') => void;
  exchangeRates: Record<string, number> | undefined;
  employeesProp: Employee[] | undefined;
}

export default function GelirTablosuTab({
  currentLanguage, orders, gelirYear, setGelirYear, gelirMonth, setGelirMonth,
  gelirCurrency, setGelirCurrency, exchangeRates, employeesProp,
}: GelirTablosuTabProps) {
  const gtYear = gelirYear, setGtYear = setGelirYear;
  const gtMonth = gelirMonth, setGtMonth = setGelirMonth;
  const monthNames = currentLanguage === 'tr'
    ? ['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık']
    : ['January','February','March','April','May','June','July','August','September','October','November','December'];

  // Filter orders for selected period
  const periodOrders = orders.filter(o => {
    const raw = (o as unknown as Record<string,unknown>).createdAt;
    const d: Date = raw && typeof (raw as {toDate?:()=>Date}).toDate === 'function'
      ? (raw as {toDate:()=>Date}).toDate()
      : new Date(raw as string);
    return d.getFullYear() === gtYear && d.getMonth() + 1 === gtMonth;
  });

  // Revenue (Satış Gelirleri)
  const brutSatislar = periodOrders.reduce((s, o) => s + o.totalPrice, 0);
  const satisIadeleri = periodOrders.filter(o => o.status === 'Cancelled').reduce((s, o) => s + o.totalPrice, 0);
  const netSatislar = brutSatislar - satisIadeleri;

  // COGS (Satışların Maliyeti)
  const satislarinMaliyeti = periodOrders.reduce((s, o) => {
    return s + (o.lineItems || []).reduce((sc: number, li: {quantity: number; costPrice?: number; inventoryId?: string; sku?: string}) => {
      return sc + (li.costPrice || 0) * li.quantity;
    }, 0);
  }, 0);

  const brutKar = netSatislar - satislarinMaliyeti;
  const brutKarMarji = netSatislar > 0 ? (brutKar / netSatislar * 100) : 0;

  // Operating Expenses (Faaliyet Giderleri)
  const personelGiderleri = (employeesProp || []).filter(e => e.status === 'Aktif').reduce((s, e) => s + (e.salary || 0), 0);
  // Other op expenses approximated from journal entries if available
  const pazarlamaGiderleri = 0; // would come from journal entries
  const genelYonetimGiderleri = 0;
  const toplamFaaliyetGiderleri = personelGiderleri + pazarlamaGiderleri + genelYonetimGiderleri;

  const faaliyetKari = brutKar - toplamFaaliyetGiderleri;
  const faaliyetKarMarji = netSatislar > 0 ? (faaliyetKari / netSatislar * 100) : 0;

  // Financial items
  const finansmanGiderleri = 0;
  const diger = 0;
  const vergionceKar = faaliyetKari + diger - finansmanGiderleri;
  const vergiOrani = 0.20; // %20 kurumlar vergisi
  const vergiKarsıligi = vergionceKar > 0 ? vergionceKar * vergiOrani : 0;
  const netDonemKari = vergionceKar - vergiKarsıligi;

  // Currency conversion
  const rate = gelirCurrency === 'USD' ? (exchangeRates?.USD || 1) : gelirCurrency === 'EUR' ? (exchangeRates?.EUR || 1) : 1;
  const sym = gelirCurrency === 'TRY' ? '₺' : gelirCurrency === 'USD' ? '$' : '€';
  const fmt = (v: number) => `${sym}${(v / rate).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmtPct = (v: number) => `%${v.toFixed(1)}`;

  const rows: { label: string; value: number; indent?: number; bold?: boolean; separator?: boolean; isNeg?: boolean; pct?: number; highlight?: string }[] = [
    { label: currentLanguage === 'tr' ? 'I. BRÜT SATIŞLAR' : 'I. GROSS SALES', value: brutSatislar, bold: true },
    { label: currentLanguage === 'tr' ? '  Satış İadeleri ve İndirimleri (-)' : '  Sales Returns & Discounts (-)', value: -satisIadeleri, indent: 1, isNeg: true },
    { label: currentLanguage === 'tr' ? 'II. NET SATIŞLAR' : 'II. NET SALES', value: netSatislar, bold: true, separator: true, highlight: 'blue' },
    { label: currentLanguage === 'tr' ? 'III. SATIŞLARIN MALİYETİ (-)' : 'III. COST OF GOODS SOLD (-)', value: -satislarinMaliyeti, isNeg: true },
    { label: currentLanguage === 'tr' ? 'IV. BRÜT SATIŞ KÂRI/ZARARI' : 'IV. GROSS PROFIT/LOSS', value: brutKar, bold: true, separator: true, pct: brutKarMarji, highlight: brutKar >= 0 ? 'green' : 'red' },
    { label: currentLanguage === 'tr' ? 'V. FAALİYET GİDERLERİ (-)' : 'V. OPERATING EXPENSES (-)', value: -toplamFaaliyetGiderleri, isNeg: true },
    { label: currentLanguage === 'tr' ? '  Personel Giderleri' : '  Payroll Expenses', value: -personelGiderleri, indent: 1, isNeg: true },
    { label: currentLanguage === 'tr' ? '  Pazarlama, Satış ve Dağıtım Giderleri' : '  Marketing, Sales & Distribution', value: -pazarlamaGiderleri, indent: 1, isNeg: true },
    { label: currentLanguage === 'tr' ? '  Genel Yönetim Giderleri' : '  General & Administrative', value: -genelYonetimGiderleri, indent: 1, isNeg: true },
    { label: currentLanguage === 'tr' ? 'VI. FAALİYET KÂRI/ZARARI (EBIT)' : 'VI. OPERATING PROFIT/LOSS (EBIT)', value: faaliyetKari, bold: true, separator: true, pct: faaliyetKarMarji, highlight: faaliyetKari >= 0 ? 'green' : 'red' },
    { label: currentLanguage === 'tr' ? 'VII. FİNANSMAN GİDERLERİ (-)' : 'VII. FINANCIAL EXPENSES (-)', value: -finansmanGiderleri, isNeg: true },
    { label: currentLanguage === 'tr' ? 'VIII. VERGİ ÖNCESİ KÂR/ZARAR' : 'VIII. PRE-TAX PROFIT/LOSS', value: vergionceKar, bold: true, separator: true, highlight: vergionceKar >= 0 ? 'green' : 'red' },
    { label: currentLanguage === 'tr' ? '  Kurumlar Vergisi Karşılığı (%20)' : '  Corporate Tax Provision (20%)', value: -vergiKarsıligi, indent: 1, isNeg: true },
    { label: currentLanguage === 'tr' ? 'IX. NET DÖNEM KÂRI/ZARARI' : 'IX. NET PERIOD PROFIT/LOSS', value: netDonemKari, bold: true, separator: true, highlight: netDonemKari >= 0 ? 'emerald' : 'red' },
  ];

  const highlightColors: Record<string, string> = {
    blue: '#eff6ff', green: '#f0fdf4', red: '#fef2f2', emerald: '#ecfdf5'
  };
  const textColors: Record<string, string> = {
    blue: '#1d4ed8', green: '#15803d', red: '#b91c1c', emerald: '#065f46'
  };

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
      {/* Header controls */}
      <div className="apple-card p-4 flex flex-wrap gap-3 items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-gray-600">{currentLanguage === 'tr' ? 'Dönem:' : 'Period:'}</span>
          <select
            value={gtMonth}
            onChange={e => setGtMonth(Number(e.target.value))}
            className="apple-input py-2 px-3"
          >
            {monthNames.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
          <input
            type="number"
            value={gtYear}
            onChange={e => setGtYear(Number(e.target.value))}
            className="apple-input py-2 px-3 w-24"
          />
        </div>
        {/* Currency */}
        <div className="flex items-center gap-1">
          {(['TRY','USD','EUR'] as const).map(cur => (
            <button key={cur} onClick={() => setGelirCurrency(cur)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${gelirCurrency === cur ? 'bg-brand text-white' : 'text-gray-500 hover:bg-gray-100'}`}>
              {cur === 'TRY' ? '₺ TRY' : cur === 'USD' ? '$ USD' : '€ EUR'}
            </button>
          ))}
          {exchangeRates && gelirCurrency !== 'TRY' && (
            <span className="ml-2 text-[10px] text-gray-400 font-mono">
              1 {gelirCurrency} = ₺{(gelirCurrency === 'USD' ? exchangeRates.USD : exchangeRates.EUR).toLocaleString('tr-TR', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
            </span>
          )}
        </div>
        {/* Export CSV */}
        <button
          onClick={() => {
            const csvRows = [
              ['Kalem', 'Tutar', 'Marj %'],
              ...rows.map(r => [r.label.trim(), (r.value / rate).toFixed(2), r.pct ? r.pct.toFixed(1) + '%' : ''])
            ];
            const csv = csvRows.map(r => r.map(c => `"${c}"`).join(',')).join('\n');
            const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = `gelir-tablosu-${gtYear}-${String(gtMonth).padStart(2,'0')}.csv`;
            a.click(); URL.revokeObjectURL(url);
          }}
          className="apple-button-secondary px-4 py-2 text-sm flex items-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
          CSV {currentLanguage === 'tr' ? 'İndir' : 'Export'}
        </button>
      </div>

      {/* Income Statement Table */}
      <div className="apple-card overflow-hidden">
        <div className="p-5 border-b border-gray-100">
          <h2 className="font-black text-gray-800 text-lg">{currentLanguage === 'tr' ? 'GELİR TABLOSU' : 'INCOME STATEMENT'}</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            {monthNames[gtMonth - 1]} {gtYear} · {periodOrders.length} {currentLanguage === 'tr' ? 'sipariş' : 'orders'} · {sym === '₺' ? 'TRY' : gelirCurrency}
          </p>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/60">
              <th className="text-left py-3 px-5 text-xs font-bold text-gray-500 uppercase tracking-wide">{currentLanguage === 'tr' ? 'Kalem' : 'Line Item'}</th>
              <th className="text-right py-3 px-5 text-xs font-bold text-gray-500 uppercase tracking-wide">{sym === '₺' ? 'TRY' : gelirCurrency}</th>
              <th className="text-right py-3 px-5 text-xs font-bold text-gray-500 uppercase tracking-wide">{currentLanguage === 'tr' ? 'Marj' : 'Margin'}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr
                key={i}
                className={`border-b border-gray-50 ${row.separator ? 'border-t-2 border-t-gray-200' : ''}`}
                style={{ background: row.highlight ? highlightColors[row.highlight] + '80' : 'transparent' }}
              >
                <td className={`py-2.5 px-5 ${row.bold ? 'font-bold' : 'font-normal'} text-gray-800`} style={{ paddingLeft: row.indent ? `${20 + row.indent * 16}px` : '20px' }}>
                  {row.label}
                </td>
                <td className={`py-2.5 px-5 text-right font-mono ${row.bold ? 'font-bold' : ''}`}
                  style={{ color: row.highlight ? textColors[row.highlight] : row.isNeg && row.value < 0 ? '#b91c1c' : '#111827' }}>
                  {fmt(row.value)}
                </td>
                <td className="py-2.5 px-5 text-right text-xs font-mono text-gray-400">
                  {row.pct !== undefined ? (
                    <span className={`font-bold ${row.pct >= 0 ? 'text-green-600' : 'text-red-500'}`}>{fmtPct(row.pct)}</span>
                  ) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* KPI summary cards */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: currentLanguage === 'tr' ? 'Net Satışlar' : 'Net Sales', value: fmt(netSatislar), color: '#3b82f6' },
          { label: currentLanguage === 'tr' ? 'Brüt Kâr Marjı' : 'Gross Margin', value: fmtPct(brutKarMarji), color: brutKarMarji >= 30 ? '#10b981' : brutKarMarji >= 15 ? '#f59e0b' : '#ef4444' },
          { label: currentLanguage === 'tr' ? 'Faaliyet Kârı' : 'Operating Profit', value: fmt(faaliyetKari), color: faaliyetKari >= 0 ? '#10b981' : '#ef4444' },
          { label: currentLanguage === 'tr' ? 'Net Dönem Kârı' : 'Net Profit', value: fmt(netDonemKari), color: netDonemKari >= 0 ? '#065f46' : '#b91c1c' },
        ].map((kpi, i) => (
          <div key={i} className="apple-card p-4 text-center">
            <div className="text-lg font-black" style={{ color: kpi.color }}>{kpi.value}</div>
            <div className="text-[10px] text-gray-500 mt-1">{kpi.label}</div>
          </div>
        ))}
      </div>

      {periodOrders.length === 0 && (
        <div className="apple-card p-10 text-center text-gray-400 text-sm">
          {currentLanguage === 'tr' ? 'Seçilen dönemde sipariş bulunamadı.' : 'No orders found for the selected period.'}
        </div>
      )}
    </motion.div>
  );
}
