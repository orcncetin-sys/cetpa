import { motion } from 'motion/react';
import { ShoppingCart, TrendingUp, FileText, Calculator, CheckCircle, BarChart3, Search } from 'lucide-react';
import { type Order } from '../../types';
import { type MikroFatura } from '../../hooks/useMikroFaturalar';
import { SortHeader, formatTRY, type AccountingT } from './shared';
import { tarihYaz } from '../../utils/zaman';
import { oc } from '../../i18n/ortak';
import { mc } from '../../i18n/muhasebe';
import { bilinenSayi, ekranTutari, type Tutar } from '../../utils/para';
import { kirilimSirala, type SatisKpi, type SatisKaydi } from '../../utils/muhasebe/satislar';
import { ac } from '../../i18n/accounting';

type DrillDown = { title: string; rows: { label: string; value: string; sub?: string; badge?: string; badgeColor?: string }[]; total?: string };
type MikroSatisRow = MikroFatura & { musteri: string };
type SatisSortKey = 'customerName' | 'totalPrice' | 'date' | 'faturali' | 'kdvOran';

interface SatislarTabProps {
  t: AccountingT;
  currentLanguage: string;
  satisKayitlari: SatisKaydi[];
  setDrillDown: (d: DrillDown | null) => void;
  formatConv: (n: number) => string;
  kpiCurrency: 'TRY' | 'USD' | 'EUR';
  setKpiCurrency: (c: 'TRY' | 'USD' | 'EUR') => void;
  satisKaynak: 'cetpa' | 'mikro' | 'hepsi';
  setSatisKaynak: (v: 'cetpa' | 'mikro' | 'hepsi') => void;
  /** KPI kartları + drill-down kırılımları — hesap tek kaynakta (utils/muhasebe/satislar.satisKpi). */
  satisOzet: SatisKpi;
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
  t, currentLanguage, satisKayitlari, setDrillDown, formatConv, kpiCurrency, setKpiCurrency,
  satisKaynak, setSatisKaynak, satisOzet, mikroDahil,
  mikroSatisSatirlari, satisSearch, setSatisSearch, satisYil, setSatisYil,
  satisSortKey, satisSortDir, toggleSatisSort, displayedSatis,
}: SatislarTabProps) {
  // Bilinmeyen tutar 0 DEĞİL bilinmiyordur (CLAUDE.md): drill-down satırında '—',
  // kart toplamında `ekranTutari` (hiç bilinen yoksa '—', kısmi toplam + "N kayıt tutarsız").
  const tutarConv = (v: unknown) => formatConv(bilinenSayi(v) ? Number(v) : NaN);
  const notlu = (tut: Tutar, yaz: (n: number) => string) =>
    yaz(ekranTutari(tut)) + (tut.bilinmeyen > 0 ? ` · ${tut.bilinmeyen} ${mc(currentLanguage).kayit_tutarsiz}` : '');
  /** Kart altı "N kayıt tutarsız" notu (MuhasebePage 379 deseni). */
  // Düz fonksiyonlar (bileşen değil): render içinde bileşen tanımlamak her render'da yeniden bağlar.
  const tutarsizNot = (tut: Tutar) => (
    tut.bilinmeyen > 0
      ? <p className="text-[10px] text-amber-600">{tut.bilinmeyen} {mc(currentLanguage).kayit_tutarsiz}</p>
      : null
  );

  const currencyPicker = () => (
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
        <button onClick={() => setDrillDown({ title: oc(currentLanguage).tum_siparisler, rows: satisKayitlari.map((o) => ({ label: o.customerName || '—', sub: o.syncedAt ? tarihYaz(o.syncedAt) : '', badge: o.faturali ? 'FATURALI' : 'FATURASIZ', badgeColor: o.faturali ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-400', value: tutarConv(o.totalPrice) })), total: notlu(satisOzet.ciro, formatConv) })} className="apple-card p-4 text-left cursor-pointer flex flex-col justify-between">
          <div className="flex items-center justify-between mb-3">
            <div className="w-8 h-8 rounded-xl bg-brand/10 flex items-center justify-center">
              <ShoppingCart size={15} className="text-brand" />
            </div>
          </div>
          <p className="text-xl font-bold text-[#ff4000]">{satisOzet.adet}</p>
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mt-1">Toplam Sipariş</p>
        </button>
        {/* Toplam Ciro */}
        <div onClick={() => setDrillDown({ title: ac(currentLanguage).musteri_bazli_ciro, rows: kirilimSirala(satisOzet.musteriKirilimi).map(([name, tut]) => ({ label: name, value: notlu(tut, formatConv) })), total: notlu(satisOzet.ciro, formatConv) })} role="button" tabIndex={0} className="apple-card p-4 cursor-pointer flex flex-col justify-between">
          <div className="flex items-center justify-between mb-3">
            <div className="w-8 h-8 rounded-xl bg-green-100 flex items-center justify-center">
              <TrendingUp size={15} className="text-green-600" />
            </div>
            {currencyPicker()}
          </div>
          {/* Toplam Ciro = Cetpa sipariş cirosu + (kaynak Mikro'yu içeriyorsa) Mikro satış faturaları.
              satisOzet.mikro.ciro yalnız 'giden' (satış) faturalarıdır — alış karışmaz. */}
          <p className="text-xl font-bold text-green-600">{formatConv(ekranTutari(satisOzet.ciro))}</p>
          {tutarsizNot(satisOzet.ciro)}
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mt-1">Toplam Ciro{mikroDahil && satisOzet.mikro.ciro.toplam > 0 ? (oc(currentLanguage).mikro_dahil) : ''}</p>
        </div>
        {/* Faturalı / Faturasız — count, no currency toggle */}
        <button onClick={() => setDrillDown({ title: ac(currentLanguage).faturali_siparisler, rows: satisKayitlari.filter((o) => o.faturali).map((o) => ({ label: o.customerName || '—', sub: o.syncedAt ? tarihYaz(o.syncedAt) : '', badge: 'FATURALI', badgeColor: 'bg-green-100 text-green-600', value: tutarConv(o.totalPrice) })), total: notlu(satisOzet.faturaliCiro, formatConv) })} className="apple-card p-4 text-left cursor-pointer flex flex-col justify-between">
          <div className="flex items-center justify-between mb-3">
            <div className="w-8 h-8 rounded-xl bg-blue-100 flex items-center justify-center">
              <FileText size={15} className="text-blue-600" />
            </div>
          </div>
          <p className="text-xl font-bold text-blue-600">{satisOzet.faturaliAdet} / {satisOzet.faturasizAdet}</p>
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mt-1">Faturalı / Faturasız</p>
        </button>
        {/* Toplam KDV — stays TRY */}
        {/* Kova mantığı tek kaynakta (utils/muhasebe/satislar.kdvOranAnahtari): 'karma' |
            'bilinmiyor' | oran metni. Karma oranlı faturalar (task #27, #18'in devamı):
            oranKarma tek f.oran'a göre kovalanırsa KDV'si yanlış orana yazılır — ayrı kova.
            Oranı bilinmeyen kayıt artık ATLANMIYOR ('bilinmiyor' kovası) → kova toplamı = kart. */}
        <button onClick={() => setDrillDown({ title: ac(currentLanguage).kdv_oranlarina_gore, rows: kirilimSirala(satisOzet.oranKirilimi).map(([k, tut]) => ({ label: k === 'karma' ? oc(currentLanguage).karma : k === 'bilinmiyor' ? oc(currentLanguage).bilinmiyor : `%${k} KDV`, value: notlu(tut, formatTRY) })), total: notlu(satisOzet.kdv, formatTRY) })} className="apple-card p-4 text-left cursor-pointer flex flex-col justify-between">
          <div className="flex items-center justify-between mb-3">
            <div className="w-8 h-8 rounded-xl bg-purple-100 flex items-center justify-center">
              <Calculator size={15} className="text-purple-600" />
            </div>
          </div>
          <p className="text-xl font-bold text-purple-600">{formatTRY(ekranTutari(satisOzet.kdv))}</p>
          {tutarsizNot(satisOzet.kdv)}
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mt-1">Toplam KDV{mikroDahil && satisOzet.mikro.kdv.toplam > 0 ? (oc(currentLanguage).mikro_dahil) : ''}</p>
        </button>
      </div>
      {/* KPI Cards Row 2 */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {/* Faturalı Ciro */}
        <div onClick={() => setDrillDown({ title: ac(currentLanguage).faturali_ciro_detayi, rows: satisKayitlari.filter((o) => o.faturali).map((o) => ({ label: o.customerName || '—', value: tutarConv(o.totalPrice) })), total: notlu(satisOzet.faturaliCiro, formatConv) })} role="button" tabIndex={0} className="apple-card p-4 cursor-pointer flex flex-col justify-between">
          <div className="flex items-center justify-between mb-3">
            <div className="w-8 h-8 rounded-xl bg-green-100 flex items-center justify-center">
              <CheckCircle size={15} className="text-green-600" />
            </div>
            {currencyPicker()}
          </div>
          <p className="text-xl font-bold text-green-600">{formatConv(ekranTutari(satisOzet.faturaliCiro))}</p>
          {tutarsizNot(satisOzet.faturaliCiro)}
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mt-1">Faturalı Ciro{mikroDahil && satisOzet.mikro.ciro.toplam > 0 ? (oc(currentLanguage).mikro_dahil) : ''}</p>
        </div>
        {/* Faturasız Ciro */}
        <div onClick={() => setDrillDown({ title: ac(currentLanguage).faturasiz_ciro_detayi, rows: satisKayitlari.filter((o) => !o.faturali).map((o) => ({ label: o.customerName || '—', value: tutarConv(o.totalPrice) })), total: notlu(satisOzet.faturasizCiro, formatConv) })} role="button" tabIndex={0} className="apple-card p-4 cursor-pointer flex flex-col justify-between">
          <div className="flex items-center justify-between mb-3">
            <div className="w-8 h-8 rounded-xl bg-gray-100 flex items-center justify-center">
              <FileText size={15} className="text-gray-500" />
            </div>
            {currencyPicker()}
          </div>
          <p className="text-xl font-bold text-gray-600">{formatConv(ekranTutari(satisOzet.faturasizCiro))}</p>
          {tutarsizNot(satisOzet.faturasizCiro)}
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mt-1">Faturasız Ciro</p>
        </div>
        {/* Ortalama Sipariş */}
        {/* Ortalama TÜRETİLEN sayıdır (tamTutar kapısı, modülde): adet 0 ya da bir kaydın
            tutarı bile bilinmiyorsa '—' — "₺0 ortalama" sahte kesinliktir. Kart yalnız Cetpa
            siparişlerini, drill-down toplamı Mikro dahil kayıtları ortalar (kaynak paritesi). */}
        <div onClick={() => setDrillDown({ title: ac(currentLanguage).ortalama_siparis_analizi, rows: satisKayitlari.map((o) => ({ label: o.customerName || '—', value: tutarConv(o.totalPrice) })), total: satisOzet.kayitOrtalamasi === null ? '—' : formatConv(satisOzet.kayitOrtalamasi) })} role="button" tabIndex={0} className="apple-card p-4 cursor-pointer flex flex-col justify-between">
          <div className="flex items-center justify-between mb-3">
            <div className="w-8 h-8 rounded-xl bg-brand/10 flex items-center justify-center">
              <BarChart3 size={15} className="text-brand" />
            </div>
            {currencyPicker()}
          </div>
          <p className="text-xl font-bold text-[#ff4000]">{satisOzet.ortalama === null ? '—' : formatConv(satisOzet.ortalama)}</p>
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
              placeholder={ac(currentLanguage).musteri_tutar_veya_fatura_no_ara}
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
            <option value="hepsi">{ac(currentLanguage).tum_yillar_2}</option>
          </select>
          {/* Kaynak seçici — varsayılan 'cetpa', yani ekran eskisi gibi davranır.
              Mikro faturalarını görmek opt-in (2026-07-31 talebi). */}
          <div className="flex gap-1 p-0.5 bg-gray-100 rounded-lg">
            {([
              ['cetpa',  currentLanguage === 'tr' ? `Cetpa (${displayedSatis.length})` : `Cetpa (${displayedSatis.length})`],
              ['mikro',  `Mikro (${mikroSatisSatirlari.length})`],
              ['hepsi',  oc(currentLanguage).tumu],
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
              ? `${mikroSatisSatirlari.length} Mikro satış faturası · toplam ${notlu(satisOzet.mikro.ciro, formatTRY)}`
              : `${mikroSatisSatirlari.length} Mikro sales invoices · total ${notlu(satisOzet.mikro.ciro, formatTRY)}`}
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
                <SortHeader
                  label="KDV%"
                  sortKey="kdvOran"
                  currentSort={{ key: satisSortKey, direction: satisSortDir }}
                  onSort={(key) => toggleSatisSort(key as SatisSortKey)}
                  className="text-center hidden sm:table-cell"
                />
              </tr>
            </thead>
            <tbody>
              {satisKaynak !== 'mikro' && displayedSatis.length === 0 && mikroSatisSatirlari.length === 0 &&
                <tr><td colSpan={5} className="text-center py-8 text-gray-400">{t.noRecords}</td></tr>}
              {satisKaynak !== 'mikro' && displayedSatis.map((o) => (
                <tr key={o.id} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="py-2.5 px-3 font-medium text-gray-800">{o.customerName}</td>
                  <td className="py-2.5 px-3 text-gray-500 hidden sm:table-cell text-xs">
                    {tarihYaz(o.syncedAt)}
                  </td>
                  <td className="py-2.5 px-3 text-right font-semibold">{formatTRY(o.totalPrice)}</td>
                  <td className="py-2.5 px-3 text-center">
                    {o.faturali
                      ? <span className="text-[9px] font-bold bg-green-100 text-green-600 px-1.5 py-0.5 rounded-full">FATURALI</span>
                      : <span className="text-[9px] font-bold bg-gray-100 text-gray-400 px-1.5 py-0.5 rounded-full">FATURASIZ</span>
                    }
                  </td>
                  {/* Oranı bilinmeyen sipariş '%0' değil '—' (sahte kesinlik). */}
                  <td className="py-2.5 px-3 text-center text-xs text-gray-500 hidden sm:table-cell">{bilinenSayi(o.kdvOran) ? `%${o.kdvOran}` : '—'}</td>
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
                    {tarihYaz(f.tarih)}
                  </td>
                  <td className="py-2.5 px-3 text-right font-semibold">{formatTRY(f.tutar)}</td>
                  <td className="py-2.5 px-3 text-center text-xs font-mono text-gray-600">{f.faturaNo || '—'}</td>
                  <td className="py-2.5 px-3 text-center text-xs text-gray-500 hidden sm:table-cell">
                    {/* formatTRY (paraYaz) bilinmeyeni '—' basar; GERÇEK ₺0 KDV (%0 istisna) artık '—' değil ₺0,00. */}
                    {formatTRY(f.kdv)}{f.oranKarma ? (ac(currentLanguage).karma) : (f.oran !== null ? ` (%${f.oran})` : '')}
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
