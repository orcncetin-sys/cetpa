import { motion } from 'motion/react';
import { ShoppingCart, TrendingUp, FileText, Calculator, CheckCircle, BarChart3, Search } from 'lucide-react';
import { type Order } from '../../types';
import { type MikroFatura } from '../../hooks/useMikroFaturalar';
import { SortHeader, formatTRY, type AccountingT } from './shared';

type DrillDown = { title: string; rows: { label: string; value: string; sub?: string; badge?: string; badgeColor?: string }[]; total?: string };
type SatisKayit = { customerName?: string; totalPrice?: number; faturali?: boolean; kdvOran?: number; kdvTutari?: number; syncedAt?: { toDate?: () => Date } };
type MikroSatisRow = MikroFatura & { musteri: string };
type SatisSortKey = 'customerName' | 'totalPrice' | 'date' | 'faturali';

interface SatislarTabProps {
  t: AccountingT;
  currentLanguage: string;
  orders: Order[];
  satisKayitlari: SatisKayit[];
  setDrillDown: (d: DrillDown | null) => void;
  formatConv: (n: number) => string;
  kpiCurrency: 'TRY' | 'USD' | 'EUR';
  setKpiCurrency: (c: 'TRY' | 'USD' | 'EUR') => void;
  satisKaynak: 'cetpa' | 'mikro' | 'hepsi';
  setSatisKaynak: (v: 'cetpa' | 'mikro' | 'hepsi') => void;
  mikroSatisToplam: number;
  mikroSatisAdet: number;
  mikroSatisCiro: number;
  mikroSatisKdv: number;
  mikroDahil: boolean;
  mikroSatisSatirlari: MikroSatisRow[];
  satisSearch: string;
  setSatisSearch: (v: string) => void;
  satisYil: string;
  setSatisYil: (v: string) => void;
  satisSortKey: SatisSortKey;
  satisSortDir: 'asc' | 'desc';
  toggleSatisSort: (key: SatisSortKey) => void;
  displayedSatis: Order[];
}

export default function SatislarTab({
  t, currentLanguage, orders, satisKayitlari, setDrillDown, formatConv, kpiCurrency, setKpiCurrency,
  satisKaynak, setSatisKaynak, mikroSatisToplam, mikroSatisAdet, mikroSatisCiro, mikroSatisKdv, mikroDahil,
  mikroSatisSatirlari, satisSearch, setSatisSearch, satisYil, setSatisYil,
  satisSortKey, satisSortDir, toggleSatisSort, displayedSatis,
}: SatislarTabProps) {
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
      {/* KPI Cards Row 1 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {/* Toplam Sipariş — count, no currency toggle */}
        <button onClick={() => setDrillDown({ title: currentLanguage === 'tr' ? 'Tüm Siparişler' : 'All Orders', rows: satisKayitlari.map((o) => ({ label: o.customerName || '—', sub: o.syncedAt?.toDate ? o.syncedAt.toDate().toLocaleDateString('tr-TR') : '', badge: o.faturali ? 'FATURALI' : 'FATURASIZ', badgeColor: o.faturali ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-400', value: formatConv(o.totalPrice || 0) })), total: formatConv(satisKayitlari.reduce((s, o) => s + (o.totalPrice || 0), 0)) })} className="apple-card p-4 text-left cursor-pointer flex flex-col justify-between">
          <div className="flex items-center justify-between mb-3">
            <div className="w-8 h-8 rounded-xl bg-brand/10 flex items-center justify-center">
              <ShoppingCart size={15} className="text-brand" />
            </div>
          </div>
          <p className="text-xl font-bold text-[#ff4000]">{orders.length}</p>
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mt-1">Toplam Sipariş</p>
        </button>
        {/* Toplam Ciro */}
        <div onClick={() => { const byCustomer: Record<string, number> = {}; satisKayitlari.forEach((o) => { const k = o.customerName || '—'; byCustomer[k] = (byCustomer[k] || 0) + (o.totalPrice || 0); }); setDrillDown({ title: currentLanguage === 'tr' ? 'Müşteri Bazlı Ciro' : 'Revenue by Customer', rows: Object.entries(byCustomer).sort(([,a],[,b]) => b - a).map(([name, total]) => ({ label: name, value: formatConv(total) })), total: formatConv(satisKayitlari.reduce((s, o) => s + (o.totalPrice || 0), 0)) }); }} role="button" tabIndex={0} className="apple-card p-4 cursor-pointer flex flex-col justify-between">
          <div className="flex items-center justify-between mb-3">
            <div className="w-8 h-8 rounded-xl bg-green-100 flex items-center justify-center">
              <TrendingUp size={15} className="text-green-600" />
            </div>
            <CurrencyPicker />
          </div>
          {/* Toplam Ciro = Cetpa sipariş cirosu + (kaynak Mikro'yu içeriyorsa) Mikro satış faturaları.
              mikroSatisToplam yalnız 'giden' (satış) faturalarıdır — alış karışmaz. */}
          <p className="text-xl font-bold text-green-600">{formatConv(orders.reduce((s, o) => s + (o.totalPrice || 0), 0) + (satisKaynak !== 'cetpa' ? mikroSatisToplam : 0))}</p>
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mt-1">Toplam Ciro{satisKaynak !== 'cetpa' && mikroSatisToplam > 0 ? (currentLanguage === 'tr' ? ' (Mikro dahil)' : ' (incl. Mikro)') : ''}</p>
        </div>
        {/* Faturalı / Faturasız — count, no currency toggle */}
        <button onClick={() => setDrillDown({ title: currentLanguage === 'tr' ? 'Faturalı Siparişler' : 'Invoiced Orders', rows: satisKayitlari.filter((o) => o.faturali).map((o) => ({ label: o.customerName || '—', sub: o.syncedAt?.toDate ? o.syncedAt.toDate().toLocaleDateString('tr-TR') : '', badge: 'FATURALI', badgeColor: 'bg-green-100 text-green-600', value: formatConv(o.totalPrice || 0) })), total: formatConv(satisKayitlari.filter((o) => o.faturali).reduce((s, o) => s + (o.totalPrice || 0), 0)) })} className="apple-card p-4 text-left cursor-pointer flex flex-col justify-between">
          <div className="flex items-center justify-between mb-3">
            <div className="w-8 h-8 rounded-xl bg-blue-100 flex items-center justify-center">
              <FileText size={15} className="text-blue-600" />
            </div>
          </div>
          <p className="text-xl font-bold text-blue-600">{orders.filter((o) => o.faturali).length + mikroSatisAdet} / {orders.filter((o) => !o.faturali).length}</p>
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mt-1">Faturalı / Faturasız</p>
        </button>
        {/* Toplam KDV — stays TRY */}
        <button onClick={() => { const byRate: Record<string, number> = {}; satisKayitlari.forEach((o) => { if (o.kdvOran !== undefined) { const k = `%${o.kdvOran} KDV`; byRate[k] = (byRate[k] || 0) + (o.kdvTutari || 0); } }); setDrillDown({ title: currentLanguage === 'tr' ? 'KDV Oranlarına Göre' : 'KDV by Rate', rows: Object.entries(byRate).sort(([,a],[,b]) => b - a).map(([rate, tutar]) => ({ label: rate, value: formatTRY(tutar) })), total: formatTRY(satisKayitlari.reduce((s, o) => s + (o.kdvTutari || 0), 0)) }); }} className="apple-card p-4 text-left cursor-pointer flex flex-col justify-between">
          <div className="flex items-center justify-between mb-3">
            <div className="w-8 h-8 rounded-xl bg-purple-100 flex items-center justify-center">
              <Calculator size={15} className="text-purple-600" />
            </div>
          </div>
          <p className="text-xl font-bold text-purple-600">{formatTRY(orders.reduce((s, o) => s + (o.kdvTutari || 0), 0) + mikroSatisKdv)}</p>
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mt-1">Toplam KDV{mikroDahil && mikroSatisKdv > 0 ? (currentLanguage === 'tr' ? ' (Mikro dahil)' : ' (incl. Mikro)') : ''}</p>
        </button>
      </div>
      {/* KPI Cards Row 2 */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {/* Faturalı Ciro */}
        <div onClick={() => setDrillDown({ title: currentLanguage === 'tr' ? 'Faturalı Ciro Detayı' : 'Invoiced Revenue Detail', rows: satisKayitlari.filter((o) => o.faturali).map((o) => ({ label: o.customerName || '—', value: formatConv(o.totalPrice || 0) })), total: formatConv(satisKayitlari.filter((o) => o.faturali).reduce((s, o) => s + (o.totalPrice || 0), 0)) })} role="button" tabIndex={0} className="apple-card p-4 cursor-pointer flex flex-col justify-between">
          <div className="flex items-center justify-between mb-3">
            <div className="w-8 h-8 rounded-xl bg-green-100 flex items-center justify-center">
              <CheckCircle size={15} className="text-green-600" />
            </div>
            <CurrencyPicker />
          </div>
          <p className="text-xl font-bold text-green-600">{formatConv(orders.filter((o) => o.faturali).reduce((s, o) => s + (o.totalPrice || 0), 0) + mikroSatisCiro)}</p>
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mt-1">Faturalı Ciro{mikroDahil && mikroSatisCiro > 0 ? (currentLanguage === 'tr' ? ' (Mikro dahil)' : ' (incl. Mikro)') : ''}</p>
        </div>
        {/* Faturasız Ciro */}
        <div onClick={() => setDrillDown({ title: currentLanguage === 'tr' ? 'Faturasız Ciro Detayı' : 'Non-Invoiced Revenue Detail', rows: satisKayitlari.filter((o) => !o.faturali).map((o) => ({ label: o.customerName || '—', value: formatConv(o.totalPrice || 0) })), total: formatConv(satisKayitlari.filter((o) => !o.faturali).reduce((s, o) => s + (o.totalPrice || 0), 0)) })} role="button" tabIndex={0} className="apple-card p-4 cursor-pointer flex flex-col justify-between">
          <div className="flex items-center justify-between mb-3">
            <div className="w-8 h-8 rounded-xl bg-gray-100 flex items-center justify-center">
              <FileText size={15} className="text-gray-500" />
            </div>
            <CurrencyPicker />
          </div>
          <p className="text-xl font-bold text-gray-600">{formatConv(orders.filter((o) => !o.faturali).reduce((s, o) => s + (o.totalPrice || 0), 0))}</p>
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mt-1">Faturasız Ciro</p>
        </div>
        {/* Ortalama Sipariş */}
        <div onClick={() => setDrillDown({ title: currentLanguage === 'tr' ? 'Ortalama Sipariş Analizi' : 'Avg Order Analysis', rows: satisKayitlari.map((o) => ({ label: o.customerName || '—', value: formatConv(o.totalPrice || 0) })), total: formatConv(satisKayitlari.length > 0 ? satisKayitlari.reduce((s, o) => s + (o.totalPrice || 0), 0) / satisKayitlari.length : 0) })} role="button" tabIndex={0} className="apple-card p-4 cursor-pointer flex flex-col justify-between">
          <div className="flex items-center justify-between mb-3">
            <div className="w-8 h-8 rounded-xl bg-brand/10 flex items-center justify-center">
              <BarChart3 size={15} className="text-brand" />
            </div>
            <CurrencyPicker />
          </div>
          <p className="text-xl font-bold text-[#ff4000]">{formatConv(orders.length > 0 ? orders.reduce((s, o) => s + (o.totalPrice || 0), 0) / orders.length : 0)}</p>
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mt-1">Ortalama Sipariş</p>
        </div>
      </div>
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h3 className="font-semibold text-gray-800">{t.satislar}</h3>
        </div>
        {/* Search + kaynak seçici */}
        <div className="flex items-center gap-3 mb-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder={currentLanguage === 'tr' ? 'Müşteri, tutar veya fatura no ara...' : 'Search customer, amount or invoice no...'}
              value={satisSearch}
              onChange={e => setSatisSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-gray-50 rounded-xl text-sm border-0 outline-none focus:ring-2 focus:ring-[#ff4000]/20"
            />
          </div>
          {/* Yıl kapsamı — GÖRÜNÜR olmalı. Eskiden bu sekme Faturalar sekmesinin
              yıl/yön filtresini sessizce miras alıyordu ve kapsam dışı kalınca
              her şey ₺0,00 görünüyordu. */}
          <select value={satisYil} onChange={e => setSatisYil(e.target.value)}
            className="px-2.5 py-1.5 bg-gray-50 rounded-xl text-xs font-medium border-0 outline-none focus:ring-2 focus:ring-[#ff4000]/20">
            {(() => {
              const buYil = new Date().getFullYear();
              return [...Array(6)].map((_, i) => String(buYil - i));
            })().map(y => <option key={y} value={y}>{y}</option>)}
            <option value="hepsi">{currentLanguage === 'tr' ? 'Tüm yıllar' : 'All years'}</option>
          </select>
          {/* Kaynak seçici — varsayılan 'cetpa', yani ekran eskisi gibi davranır.
              Mikro faturalarını görmek opt-in (2026-07-31 talebi). */}
          <div className="flex gap-1 p-0.5 bg-gray-100 rounded-lg">
            {([
              ['cetpa',  currentLanguage === 'tr' ? `Cetpa (${displayedSatis.length})` : `Cetpa (${displayedSatis.length})`],
              ['mikro',  `Mikro (${mikroSatisSatirlari.length})`],
              ['hepsi',  currentLanguage === 'tr' ? 'Tümü' : 'All'],
            ] as const).map(([k, l]) => (
              <button key={k} onClick={() => setSatisKaynak(k)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${satisKaynak === k ? 'bg-white shadow-sm text-[#1D1D1F]' : 'text-gray-500 hover:text-[#1D1D1F]'}`}>
                {l}
              </button>
            ))}
          </div>
        </div>
        {satisKaynak !== 'cetpa' && mikroSatisSatirlari.length > 0 && (
          <div className="mb-3 px-3 py-2 bg-blue-50 rounded-xl text-xs text-blue-800">
            {currentLanguage === 'tr'
              ? `${mikroSatisSatirlari.length} Mikro satış faturası · toplam ${formatTRY(mikroSatisToplam)}`
              : `${mikroSatisSatirlari.length} Mikro sales invoices · total ${formatTRY(mikroSatisToplam)}`}
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="apple-table">
            <thead>
              <tr className="border-b border-gray-100">
                <SortHeader
                  label={t.customer2}
                  sortKey="customerName"
                  currentSort={{ key: satisSortKey, direction: satisSortDir }}
                  onSort={(key) => toggleSatisSort(key as SatisSortKey)}
                />
                <SortHeader
                  label={t.date}
                  sortKey="date"
                  currentSort={{ key: satisSortKey, direction: satisSortDir }}
                  onSort={(key) => toggleSatisSort(key as SatisSortKey)}
                  className="hidden sm:table-cell"
                />
                <SortHeader
                  label={t.total2}
                  sortKey="totalPrice"
                  currentSort={{ key: satisSortKey, direction: satisSortDir }}
                  onSort={(key) => toggleSatisSort(key as SatisSortKey)}
                  className="text-right"
                />
                <SortHeader
                  label="Fatura"
                  sortKey="faturali"
                  currentSort={{ key: satisSortKey, direction: satisSortDir }}
                  onSort={(key) => toggleSatisSort(key as SatisSortKey)}
                  className="text-center"
                />
                <th className="text-center py-3 px-4 text-[10px] font-bold text-[#86868B] uppercase tracking-wider hidden sm:table-cell">KDV%</th>
              </tr>
            </thead>
            <tbody>
              {satisKaynak !== 'mikro' && displayedSatis.length === 0 && mikroSatisSatirlari.length === 0 &&
                <tr><td colSpan={5} className="text-center py-8 text-gray-400">{t.noRecords}</td></tr>}
              {satisKaynak !== 'mikro' && displayedSatis.map((o) => (
                <tr key={o.id} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="py-2.5 px-3 font-medium text-gray-800">{o.customerName}</td>
                  <td className="py-2.5 px-3 text-gray-500 hidden sm:table-cell text-xs">
                    {(o.syncedAt as { toDate?: () => Date })?.toDate ? (o.syncedAt as { toDate: () => Date }).toDate().toLocaleDateString('tr-TR') : '—'}
                  </td>
                  <td className="py-2.5 px-3 text-right font-semibold">{formatTRY(o.totalPrice || 0)}</td>
                  <td className="py-2.5 px-3 text-center">
                    {o.faturali
                      ? <span className="text-[9px] font-bold bg-green-100 text-green-600 px-1.5 py-0.5 rounded-full">FATURALI</span>
                      : <span className="text-[9px] font-bold bg-gray-100 text-gray-400 px-1.5 py-0.5 rounded-full">FATURASIZ</span>
                    }
                  </td>
                  <td className="py-2.5 px-3 text-center text-xs text-gray-500 hidden sm:table-cell">%{o.kdvOran ?? 0}</td>
                </tr>
              ))}
              {/* Mikro satış faturaları — Cetpa satırlarından rozetle ayrılır.
                  Cetpa'dan Mikro'ya gönderilmiş olanlar mükerrer sayılmasın diye
                  mikroEvrakNo eşleşmesiyle zaten elenmiş durumda. */}
              {satisKaynak !== 'cetpa' && mikroSatisSatirlari.map(f => (
                <tr key={`mikro-${f.id}`} className="border-b border-gray-50 hover:bg-blue-50/40 bg-blue-50/20">
                  <td className="py-2.5 px-3 font-medium text-gray-800">
                    {f.musteri}
                    <span className="ml-1.5 text-[9px] font-bold bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded-full align-middle">MİKRO</span>
                  </td>
                  <td className="py-2.5 px-3 text-gray-500 hidden sm:table-cell text-xs">
                    {f.tarih ? new Date(f.tarih).toLocaleDateString('tr-TR') : '—'}
                  </td>
                  <td className="py-2.5 px-3 text-right font-semibold">{formatTRY(f.tutar)}</td>
                  <td className="py-2.5 px-3 text-center text-xs font-mono text-gray-600">{f.faturaNo || '—'}</td>
                  <td className="py-2.5 px-3 text-center text-xs text-gray-500 hidden sm:table-cell">
                    {f.kdv ? formatTRY(f.kdv) : '—'}{f.oran !== null ? ` (%${f.oran})` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </motion.div>
  );
}
