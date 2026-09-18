import { motion } from 'motion/react';
import { type Order, type Employee } from '../../types';
import { kurCevir, paraYaz, tlYaz } from '../../utils/currency';
import { gelirTablosu } from '../../utils/muhasebe/gelirTablosu';
import { ekranTutari } from '../../utils/para';
import { oc } from '../../i18n/ortak';
import { ac } from '../../i18n/accounting';

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

  // Hesap tek kaynakta (utils/muhasebe/gelirTablosu.ts) — dönem süzgeci, brüt/iade/net satış,
  // SMM, marjlar, personel gideri ve vergi bloğu oradan gelir (açıklama yorumları da taşındı).
  const gt = gelirTablosu(orders, employeesProp, gtYear, gtMonth);
  // Ekran sözleşmesi (para.ts): satır toplamları `ekranTutari` (kısmi toplam + "N kayıt tutarsız"
  // notu; hiç bilinen yoksa NaN → '—'); türetmeler (net/kâr/vergi) NaN → '—'; marjlar null → '—'.
  const brutSatislar = ekranTutari(gt.brutSatis);
  const satisIadeleri = ekranTutari(gt.iade);
  const netSatislar = gt.netSatis;
  const satislarinMaliyeti = ekranTutari(gt.smm);
  const brutKar = gt.brutKar;
  const brutKarMarji = gt.brutKarMarji;          // number | null
  const personelGiderleri = ekranTutari(gt.personel);
  const pazarlamaGiderleri = gt.pazarlama;
  const genelYonetimGiderleri = gt.genelYonetim;
  const toplamFaaliyetGiderleri = ekranTutari(gt.faaliyetGideri);
  const faaliyetKari = gt.faaliyetKari;
  const faaliyetKarMarji = gt.faaliyetKarMarji;  // number | null
  const finansmanGiderleri = gt.finansmanGideri;
  const vergionceKar = gt.vergiOncesiKar;
  const vergiKarsıligi = gt.vergiKarsiligi;
  const netDonemKari = gt.netDonemKari;

  // Currency conversion
  //
  // KUR UYDURMA YOK (2026-08-26). Eskiden `exchangeRates?.USD || 1` vardi: kur
  // gelmemisse butun gelir tablosu TL rakamlariyla kalip basina '$'/'€' konuyordu
  // (~38x sisirilmis bir gelir tablosu). Artik `kurCevir` kur yoksa null doner ve
  // hucre '—' gosterir. TRY secili iken kur hic gerekmez — davranis birebir aynidir.
  const sym = gelirCurrency === 'TRY' ? '₺' : gelirCurrency === 'USD' ? '$' : '€';
  const gecerliKur: number | null = (() => {
    if (gelirCurrency === 'TRY') return null; // TRY icin kur gerekmiyor
    const k = exchangeRates?.[gelirCurrency];
    return typeof k === 'number' && isFinite(k) && k > 0 ? k : null;
  })();
  const kurYok = gelirCurrency !== 'TRY' && gecerliKur === null;
  // Tek kaynak (Faz 2 1/n): tlYaz = kurCevir + paraYaz; kur yoksa '—'.
  const fmt = (v: number) => tlYaz(v, { birim: gelirCurrency, rates: exchangeRates });
  // Marj bilinmiyorsa (ciro ≤ 0 ya da bir taraf bilinmiyor) '%0' DEĞİL '—'.
  const fmtPct = (v: number | null) => v === null ? '—' : `%${v.toFixed(1)}`;

  const rows: { label: string; value: number; indent?: number; bold?: boolean; separator?: boolean; isNeg?: boolean; pct?: number | null; highlight?: string }[] = [
    { label: ac(currentLanguage).i_brut_satislar, value: brutSatislar, bold: true },
    { label: ac(currentLanguage).satis_iadeleri_ve_indirimleri, value: -satisIadeleri, indent: 1, isNeg: true },
    { label: ac(currentLanguage).ii_net_satislar, value: netSatislar, bold: true, separator: true, highlight: 'blue' },
    { label: ac(currentLanguage).iii_satislarin_maliyeti, value: -satislarinMaliyeti, isNeg: true },
    { label: ac(currentLanguage).iv_brut_satis_kari_zarari, value: brutKar, bold: true, separator: true, pct: brutKarMarji, highlight: Number.isFinite(brutKar) ? (brutKar >= 0 ? 'green' : 'red') : undefined },
    { label: ac(currentLanguage).v_faaliyet_giderleri, value: -toplamFaaliyetGiderleri, isNeg: true },
    { label: ac(currentLanguage).personel_giderleri, value: -personelGiderleri, indent: 1, isNeg: true },
    { label: ac(currentLanguage).pazarlama_satis_ve_dagitim_giderleri, value: -pazarlamaGiderleri, indent: 1, isNeg: true },
    { label: ac(currentLanguage).genel_yonetim_giderleri, value: -genelYonetimGiderleri, indent: 1, isNeg: true },
    { label: ac(currentLanguage).vi_faaliyet_kari_zarari_ebit, value: faaliyetKari, bold: true, separator: true, pct: faaliyetKarMarji, highlight: Number.isFinite(faaliyetKari) ? (faaliyetKari >= 0 ? 'green' : 'red') : undefined },
    { label: ac(currentLanguage).vii_finansman_giderleri, value: -finansmanGiderleri, isNeg: true },
    { label: ac(currentLanguage).viii_vergi_oncesi_kar_zarar, value: vergionceKar, bold: true, separator: true, highlight: Number.isFinite(vergionceKar) ? (vergionceKar >= 0 ? 'green' : 'red') : undefined },
    { label: ac(currentLanguage).kurumlar_vergisi_karsiligi_20, value: -vergiKarsıligi, indent: 1, isNeg: true },
    { label: ac(currentLanguage).ix_net_donem_kari_zarari, value: netDonemKari, bold: true, separator: true, highlight: Number.isFinite(netDonemKari) ? (netDonemKari >= 0 ? 'emerald' : 'red') : undefined },
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
          <span className="text-sm font-medium text-gray-600">{oc(currentLanguage).donem_2}</span>
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
          {gecerliKur !== null && (
            <span className="ml-2 text-[10px] text-gray-400 font-mono">
              1 {gelirCurrency} = {paraYaz(gecerliKur)}
            </span>
          )}
          {kurYok && (
            <span className="ml-2 text-[10px] text-amber-600 font-medium">
              {ac(currentLanguage).guncel_kur_alinamadi}
            </span>
          )}
        </div>
        {/* Export CSV */}
        <button
          onClick={() => {
            // Kur yoksa yaniltici bir dosya URETME. Butonun kendisi zaten
            // devre disi; bu yalnizca ikinci bir emniyet kilidi.
            if (kurYok) return;
            const csvRows = [
              ['Kalem', 'Tutar', 'Marj %'],
              ...rows.map(r => {
                const cevrilen = kurCevir(r.value, gelirCurrency, exchangeRates);
                // Marj bilinmiyorsa (null) hücre boş; GERÇEK %0 marj '0.0%' yazar (eski `r.pct ?` 0'ı da yutuyordu).
                return [r.label.trim(), cevrilen === null ? '' : cevrilen.toFixed(2), typeof r.pct === 'number' ? r.pct.toFixed(1) + '%' : ''];
              })
            ];
            const csv = csvRows.map(r => r.map(c => `"${c}"`).join(',')).join('\n');
            const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = `gelir-tablosu-${gtYear}-${String(gtMonth).padStart(2,'0')}.csv`;
            a.click(); URL.revokeObjectURL(url);
          }}
          disabled={kurYok}
          title={kurYok ? (ac(currentLanguage).guncel_kur_alinamadigi_icin_disa_aktarilamiyor) : undefined}
          className="apple-button-secondary px-4 py-2 text-sm flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
          CSV {ac(currentLanguage).indir}
        </button>
      </div>

      {/* Income Statement Table */}
      <div className="apple-card overflow-hidden">
        <div className="p-5 border-b border-gray-100">
          <h2 className="font-black text-gray-800 text-lg">{ac(currentLanguage).gelir_tablosu}</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            {monthNames[gtMonth - 1]} {gtYear} · {gt.siparisSayisi} {oc(currentLanguage).siparis} · {sym === '₺' ? 'TRY' : gelirCurrency}
          </p>
          {/* Kısmi toplam basıldıysa kaç kaydın eksik olduğunu SÖYLE (para.ts ekran sözleşmesi).
              iade.bilinmeyen brutSatis.bilinmeyen'in alt kümesi — ayrıca sayılmaz. */}
          {(gt.brutSatis.bilinmeyen > 0 || gt.smm.bilinmeyen > 0 || gt.personel.bilinmeyen > 0 || gt.tarihsiz > 0) && (
            <p className="text-xs text-amber-600 mt-1">
              {[
                gt.brutSatis.bilinmeyen > 0 ? (currentLanguage === 'tr' ? `${gt.brutSatis.bilinmeyen} sipariş tutarsız` : `${gt.brutSatis.bilinmeyen} orders without amount`) : null,
                gt.smm.bilinmeyen > 0 ? (currentLanguage === 'tr' ? `${gt.smm.bilinmeyen} sipariş maliyetsiz` : `${gt.smm.bilinmeyen} orders without cost`) : null,
                gt.personel.bilinmeyen > 0 ? (currentLanguage === 'tr' ? `${gt.personel.bilinmeyen} personel maaşsız` : `${gt.personel.bilinmeyen} employees without salary`) : null,
                gt.tarihsiz > 0 ? (currentLanguage === 'tr' ? `${gt.tarihsiz} sipariş tarihsiz` : `${gt.tarihsiz} undated orders`) : null,
              ].filter(Boolean).join(' · ')}
            </p>
          )}
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/60">
              <th className="text-left py-3 px-5 text-xs font-bold text-gray-500 uppercase tracking-wide">{ac(currentLanguage).kalem}</th>
              <th className="text-right py-3 px-5 text-xs font-bold text-gray-500 uppercase tracking-wide">{sym === '₺' ? 'TRY' : gelirCurrency}</th>
              <th className="text-right py-3 px-5 text-xs font-bold text-gray-500 uppercase tracking-wide">{oc(currentLanguage).marj}</th>
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
                  {typeof row.pct === 'number' ? (
                    <span className={`font-bold ${row.pct >= 0 ? 'text-green-600' : 'text-red-500'}`}>{fmtPct(row.pct)}</span>
                  ) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* KPI summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: ac(currentLanguage).net_satislar, value: fmt(netSatislar), color: '#3b82f6' },
          // Bilinmeyen (null/NaN) değer 'zarar' kırmızısı ALMAZ — nötr gri.
          { label: ac(currentLanguage).brut_kar_marji, value: fmtPct(brutKarMarji), color: brutKarMarji === null ? '#9ca3af' : brutKarMarji >= 30 ? '#10b981' : brutKarMarji >= 15 ? '#f59e0b' : '#ef4444' },
          { label: ac(currentLanguage).faaliyet_kari, value: fmt(faaliyetKari), color: !Number.isFinite(faaliyetKari) ? '#9ca3af' : faaliyetKari >= 0 ? '#10b981' : '#ef4444' },
          { label: ac(currentLanguage).net_donem_kari, value: fmt(netDonemKari), color: !Number.isFinite(netDonemKari) ? '#9ca3af' : netDonemKari >= 0 ? '#065f46' : '#b91c1c' },
        ].map((kpi, i) => (
          <div key={i} className="apple-card p-4 text-center">
            <div className="text-lg font-black" style={{ color: kpi.color }}>{kpi.value}</div>
            <div className="text-[10px] text-gray-500 mt-1">{kpi.label}</div>
          </div>
        ))}
      </div>

      {gt.siparisSayisi === 0 && (
        <div className="apple-card p-10 text-center text-gray-400 text-sm">
          {ac(currentLanguage).secilen_donemde_siparis_bulunamadi}
        </div>
      )}
    </motion.div>
  );
}
