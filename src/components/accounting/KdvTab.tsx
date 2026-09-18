import { motion } from 'motion/react';
import { Search, FileText } from 'lucide-react';
import { type JournalEntry } from '../../types';
import { SortHeader, formatTRY, type AccountingT } from './shared';
import { oc } from '../../i18n/ortak';
import { ekranTutari, sayiSirala } from '../../utils/para';
import { type KdvDonemi, type OranKovasi } from '../../utils/muhasebe/kdvBeyan';

type DrillDown = { title: string; rows: { label: string; value: string; sub?: string; badge?: string; badgeColor?: string }[]; total?: string };
type KdvSortKey = 'ay' | 'hesaplanan' | 'indirilecek' | 'odenecek' | 'oran' | 'matrah' | 'kdv';

interface KdvTabProps {
  t: AccountingT;
  currentLanguage: string;
  MONTHS: string[];
  kdvMonth: number;
  setKdvMonth: (v: number) => void;
  kdvYear: number;
  setKdvYear: (v: number) => void;
  hesaplananKDV: number;
  indirilecekKDV: number;
  odenecekKDV: number;
  /** Dönemin tüm KDV hesabı (drill-down listeleri + bilinmeyen/tarihsiz sayaçları) — tek kaynak: utils/muhasebe/kdvBeyan. */
  kdvDonem: KdvDonemi<JournalEntry>;
  setDrillDown: (d: DrillDown | null) => void;
  kdvSearch: string;
  setKdvSearch: (v: string) => void;
  kdvSortBy: KdvSortKey;
  kdvSortDir2: 'asc' | 'desc';
  setKdvSortBy: (v: KdvSortKey) => void;
  setKdvSortDir2: React.Dispatch<React.SetStateAction<'asc' | 'desc'>>;
  // 'karma': Mikro'da hem %10 hem %20'li ürün taşıyan faturalar (code-review
  // bulgusu, task #27) — kdvBeyan bu anahtarı üretiyor, burada da
  // ele alınmalı, aksi halde ekranda "%karma" gibi anlamsız bir etiket çıkar.
  // 'bilinmiyor' anahtarı da gelebilir: journal fişinin kdvOran'ı ya da Mikro faturasının oranı çözülemeyen kayıtlar.
  kdvOranBreakdown: Record<string, OranKovasi>;   // matrah/kdv: Tutar (bilinmeyen sayılır); adet; tutarsiz
  downloadVatDeclaration: () => void;
  downloadVatDeclarationCSV: () => void;
}

export default function KdvTab({
  t, currentLanguage, MONTHS, kdvMonth, setKdvMonth, kdvYear, setKdvYear,
  hesaplananKDV, indirilecekKDV, odenecekKDV, kdvDonem, setDrillDown,
  kdvSearch, setKdvSearch, kdvSortBy, kdvSortDir2, setKdvSortBy, setKdvSortDir2,
  kdvOranBreakdown, downloadVatDeclaration, downloadVatDeclarationCSV,
}: KdvTabProps) {
  const onSort = (key: string) => {
    if (kdvSortBy === key) setKdvSortDir2(d => d === 'asc' ? 'desc' : 'asc');
    else { setKdvSortBy(key as KdvSortKey); setKdvSortDir2('asc'); }
  };
  // Net TÜRETMEDİR: bir taraf bir kayıt bile bilinmiyorsa NaN gelir. Guard'sız bırakılırsa
  // `NaN >= 0` false olur ve bilinmeyen net ekranda yeşil "Devreden" gibi görünür (sahte kesinlik).
  const kdvTutarsiz = kdvDonem.hesaplanan.bilinmeyen + kdvDonem.indirilecek.bilinmeyen;
  const odenecekBilinmiyor = !Number.isFinite(odenecekKDV);
  const tutarsizNotu = (n: number) => currentLanguage === 'tr' ? `${n} kayıt tutarsız` : `${n} records without amount`;
  // Kova etiketi TEK yerde: hem satırda hem arama süzgecinde aynı metin görünür
  // ('%bilinmiyor' diye aranmasın). Türkçe eşleştirme locale-duyarlı küçültmeyle.
  const oranEtiketi = (oran: string) => oran === 'karma' ? oc(currentLanguage).karma : oran === 'bilinmiyor' ? oc(currentLanguage).bilinmiyor : `%${oran}`;

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
      {/* Filters */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 flex flex-wrap gap-3 items-center">
        <span className="text-sm font-medium text-gray-600">{t.period}</span>
        <select value={kdvMonth} onChange={e => setKdvMonth(Number(e.target.value))} className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]">
          {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
        </select>
        <input type="number" value={kdvYear} onChange={e => setKdvYear(Number(e.target.value))} className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000] w-24" />
        {kdvDonem.tarihsiz > 0 && (
          <span className="text-xs text-amber-600">
            {currentLanguage === 'tr'
              ? `${kdvDonem.tarihsiz} tarihsiz KDV kaydı hiçbir döneme dahil değil`
              : `${kdvDonem.tarihsiz} undated VAT records are in no period`}
          </span>
        )}
      </div>
      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <button
          onClick={() => setDrillDown({
            title: t.calculatedVat,
            // Liste KPI ile AYNI süzgeçten gelir (kdvBeyan) — kart ile drill-down ayrışamaz;
            // tutarı bilinmeyen fiş ₺0 değil '—' basar (satır tutarı NaN).
            rows: kdvDonem.hesaplananListesi.map(r => ({ label: r.kayit.alacakHesap, sub: r.kayit.aciklama, value: formatTRY(r.tutar) })),
            total: formatTRY(hesaplananKDV)
          })}
          className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 text-left hover:shadow-md hover:border-gray-200 transition-all cursor-pointer group"
        >
          <div className="text-xs text-gray-500 font-medium mb-1">{t.calculatedVat}</div>
          <div className="text-2xl font-bold text-[#ff4000]">{formatTRY(hesaplananKDV)}</div>
          <div className="text-[10px] text-gray-400 mt-1 group-hover:text-gray-500 transition-colors">391 - Hesaplanan KDV</div>
          {kdvDonem.hesaplanan.bilinmeyen > 0 && <div className="text-[10px] text-amber-600 mt-0.5">{tutarsizNotu(kdvDonem.hesaplanan.bilinmeyen)}</div>}
        </button>
        <button
          onClick={() => setDrillDown({
            title: t.deductibleVat,
            rows: kdvDonem.indirilecekListesi.map(r => ({ label: r.kayit.debitHesap, sub: r.kayit.aciklama, value: formatTRY(r.tutar) })),
            total: formatTRY(indirilecekKDV)
          })}
          className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 text-left hover:shadow-md hover:border-gray-200 transition-all cursor-pointer group"
        >
          <div className="text-xs text-gray-500 font-medium mb-1">{t.deductibleVat}</div>
          <div className="text-2xl font-bold text-blue-600">{formatTRY(indirilecekKDV)}</div>
          <div className="text-[10px] text-gray-400 mt-1 group-hover:text-gray-500 transition-colors">191 - İndirilecek KDV</div>
          {kdvDonem.indirilecek.bilinmeyen > 0 && <div className="text-[10px] text-amber-600 mt-0.5">{tutarsizNotu(kdvDonem.indirilecek.bilinmeyen)}</div>}
        </button>
        <button
          onClick={() => setDrillDown({
            title: t.vatPayable,
            rows: [
              { label: t.calculatedVat, value: formatTRY(hesaplananKDV) },
              { label: t.deductibleVat, value: formatTRY(indirilecekKDV) },
              {
                label: 'Net',
                badge: odenecekBilinmiyor ? oc(currentLanguage).bilinmiyor : odenecekKDV >= 0 ? 'Ödenecek' : 'Devreden',
                badgeColor: odenecekBilinmiyor ? 'bg-gray-100 text-gray-500' : odenecekKDV >= 0 ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-600',
                value: formatTRY(Math.abs(odenecekKDV))
              }
            ]
          })}
          className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 text-left hover:shadow-md hover:border-gray-200 transition-all cursor-pointer group"
        >
          <div className="text-xs text-gray-500 font-medium mb-1">{t.vatPayable}</div>
          <div className={`text-2xl font-bold ${odenecekBilinmiyor ? 'text-gray-400' : odenecekKDV >= 0 ? 'text-red-600' : 'text-green-600'}`}>{formatTRY(odenecekKDV)}</div>
          <div className="text-[10px] text-gray-400 mt-1 group-hover:text-gray-500 transition-colors">
            {odenecekBilinmiyor
              ? (currentLanguage === 'tr' ? `${kdvTutarsiz} kayıt tutarsız — net hesaplanamadı` : `${kdvTutarsiz} records without amount — net not derived`)
              : odenecekKDV >= 0 ? t.vatPayableDesc : t.vatRefundDesc}
          </div>
        </button>
      </div>
      <div className="apple-card p-4">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h3 className="font-semibold text-gray-800">{t.vatBreakdown}</h3>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder={currentLanguage === 'en' ? 'Filter rates...' : 'Oran ara...'}
                value={kdvSearch}
                onChange={e => setKdvSearch(e.target.value)}
                className="apple-input pl-7 pr-3 py-1.5 w-32"
              />
            </div>
            <button onClick={downloadVatDeclaration} className="apple-button-primary py-2 px-4 text-sm">
              <FileText size={14} /> {t.vatDeclaration}
            </button>
            <button onClick={downloadVatDeclarationCSV} className="apple-button-secondary py-2 px-4 text-sm">
              <FileText size={14} /> {currentLanguage === 'tr' ? 'Excel (CSV)' : 'Excel (CSV)'}
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="apple-table">
            <thead>
              <tr className="border-b border-gray-100">
                <SortHeader
                  label={t.vatRate}
                  sortKey="oran"
                  currentSort={{ key: kdvSortBy, direction: kdvSortDir2 }}
                  onSort={onSort}
                />
                <SortHeader
                  label={t.vatBase}
                  sortKey="matrah"
                  currentSort={{ key: kdvSortBy, direction: kdvSortDir2 }}
                  onSort={onSort}
                  className="text-right"
                />
                <SortHeader
                  label={t.vatAmount}
                  sortKey="kdv"
                  currentSort={{ key: kdvSortBy, direction: kdvSortDir2 }}
                  onSort={onSort}
                  className="text-right"
                />
              </tr>
            </thead>
            <tbody>
              {Object.keys(kdvOranBreakdown).length === 0 && (
                <tr><td colSpan={3} className="text-center py-8 text-gray-400">{t.noVatEntries}</td></tr>
              )}
              {Object.entries(kdvOranBreakdown)
                .filter(([oran]) => !kdvSearch || oranEtiketi(oran).toLocaleLowerCase('tr-TR').includes(kdvSearch.toLocaleLowerCase('tr-TR')))
                .sort(([oranA, dataA], [oranB, dataB]) => {
                  const azalan = kdvSortDir2 === 'desc';
                  // 'karma'/'bilinmiyor' Number()'da NaN verir — `sayiSirala` bilinmeyeni iki yönde de
                  // SONA atar (yönü `-` ile çevirme, yoksa bilinmeyenler başa gelir).
                  if (kdvSortBy === 'oran') return sayiSirala(Number(oranA), Number(oranB), azalan);
                  if (kdvSortBy === 'matrah') return sayiSirala(ekranTutari(dataA.matrah), ekranTutari(dataB.matrah), azalan);
                  return sayiSirala(ekranTutari(dataA.kdv), ekranTutari(dataB.kdv), azalan);
                })
                .map(([oran, data]) => (
                  <tr key={oran} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="py-2.5 px-3"><span className="bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full text-xs font-semibold">{oranEtiketi(oran)}</span></td>
                    <td className="py-2.5 px-3 text-right text-gray-700 font-medium">{formatTRY(ekranTutari(data.matrah))}</td>
                    <td className="py-2.5 px-3 text-right font-semibold text-[#ff4000]">
                      {formatTRY(ekranTutari(data.kdv))}
                      {data.tutarsiz > 0 && <span className="block text-[10px] text-amber-600 font-normal">{tutarsizNotu(data.tutarsiz)}</span>}
                    </td>
                  </tr>
                ))
              }
            </tbody>
          </table>
        </div>
      </div>
    </motion.div>
  );
}
