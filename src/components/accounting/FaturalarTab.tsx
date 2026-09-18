import { motion } from 'motion/react';
import { eslesir } from '../../utils/arama';
import { confirmAction } from '../../lib/confirm';
import { X, Plus, Search, FileText, Trash2 } from 'lucide-react';
import { doc, deleteDoc } from '../../lib/dbClient';
import { db } from '../../firebase';
import { type MikroFaturaDetayVerisi } from '../MikroFaturaDetay';
import { type MikroFatura } from '../../hooks/useMikroFaturalar';
import { SortHeader } from './shared';
import { faturaTipiEtiketi } from '../../utils/durumEtiketi';
import { paraYaz } from '../../utils/currency';
import { bilinenSayi, ekranTutari } from '../../utils/para';
import { faturaKpi, faturaSatirKarsilastir, faturaTutarlari } from '../../utils/muhasebe/faturalar';
import { oc } from '../../i18n/ortak';
import { ac } from '../../i18n/accounting';

type InvoiceForm = {
  faturaNo: string; faturaTipi: 'e-fatura' | 'e-arsiv' | 'ihracat';
  customerName: string; customerEmail: string; taxId: string; taxOffice: string;
  address: string; kdvOran: number; date: string; notes: string; orderId: string;
  /** Elle girilen toplam (KDV DAHİL) — sipariş bağlı değilken tutarın TEK kaynağı. Dokümana yazılmaz. */
  tutar: string;
};
type MikroFaturaRow = MikroFatura & { musteri: string };

// Kolon başlıkları invoices alanlarıyla aynı isimde değil (musteri/tarih/oran/
// matrah/tutar) — sıralama tıklaması Mikro satırlarında hiç etki etmiyordu
// (2026-08-17, kullanıcı bildirdi). Statik, bileşen dışında (her render'da
// yeniden ayrılmasın). `keyof MikroFaturaRow` bilerek: alan adı değişirse derleyici yakalar.
// KARŞILAŞTIRMA KURALI burada DEĞİL — tek kaynak utils/muhasebe/faturalar.faturaSatirKarsilastir
// (bilinmeyen sayı 0 sayılmaz, her iki yönde sonda; NaN ham `<`/`>` ile sıralamayı bozuyordu).
const MIKRO_SORT_KEY: Record<string, keyof MikroFaturaRow> = {
  faturaNo: 'faturaNo', customerName: 'musteri', date: 'tarih',
  kdvOran: 'oran', kdvHaric: 'matrah', totalPrice: 'tutar', faturaTipi: 'yon',
};

interface FaturalarTabProps {
  currentLanguage: string;
  isAuthenticated: boolean;
  showInvoiceModal: boolean;
  setShowInvoiceModal: (v: boolean) => void;
  invoiceForm: InvoiceForm;
  setInvoiceForm: React.Dispatch<React.SetStateAction<InvoiceForm>>;
  invoiceSource: Record<string, unknown> | null;
  setInvoiceSource: (v: Record<string, unknown> | null) => void;
  handleCreateInvoice: () => void;
  faturaKaynak: 'cetpa' | 'mikro' | 'hepsi';
  setFaturaKaynak: (v: 'cetpa' | 'mikro' | 'hepsi') => void;
  faturaYon: 'hepsi' | 'giden' | 'gelen';
  setFaturaYon: (v: 'hepsi' | 'giden' | 'gelen') => void;
  faturaYil: string;
  setFaturaYil: (v: string) => void;
  mikroFaturalar: MikroFatura[];
  mikroFaturaSatirlari: MikroFaturaRow[];
  invoices: Record<string, unknown>[];
  invoiceSearch: string;
  setInvoiceSearch: (v: string) => void;
  invoiceTypeFilter: 'all' | 'e-fatura' | 'e-arsiv' | 'ihracat';
  setInvoiceTypeFilter: (v: 'all' | 'e-fatura' | 'e-arsiv' | 'ihracat') => void;
  invoiceSort: { key: string; direction: 'asc' | 'desc' };
  setInvoiceSort: React.Dispatch<React.SetStateAction<{ key: string; direction: 'asc' | 'desc' }>>;
  setFaturaDetay: (v: MikroFaturaDetayVerisi | null) => void;
}

export default function FaturalarTab({
  currentLanguage, isAuthenticated, showInvoiceModal, setShowInvoiceModal,
  invoiceForm, setInvoiceForm, invoiceSource, setInvoiceSource, handleCreateInvoice,
  faturaKaynak, setFaturaKaynak, faturaYon, setFaturaYon, faturaYil, setFaturaYil,
  mikroFaturalar, mikroFaturaSatirlari, invoices, invoiceSearch, setInvoiceSearch,
  invoiceTypeFilter, setInvoiceTypeFilter, invoiceSort, setInvoiceSort, setFaturaDetay,
}: FaturalarTabProps) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
      {/* Invoice creation modal */}
      {showInvoiceModal && (
        <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl">
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-bold text-lg">{oc(currentLanguage).fatura_kes}</h3>
              <button onClick={()=>setShowInvoiceModal(false)} className="p-1.5 rounded-lg hover:bg-gray-100"><X className="w-4 h-4"/></button>
            </div>
            {/* Invoice type */}
            <div className="mb-4">
              <label className="text-[10px] font-bold text-gray-500 uppercase mb-1.5 block">{oc(currentLanguage).fatura_turu}</label>
              <div className="grid grid-cols-3 gap-2">
                {([
                  { v:'e-fatura', l:'e-Fatura', d:oc(currentLanguage).kayitli_mukellef },
                  { v:'e-arsiv', l:'e-Arşiv', d:ac(currentLanguage).bireysel_kayitsiz },
                  { v:'ihracat', l:oc(currentLanguage).ihracat, d:ac(currentLanguage).yurt_disi },
                ] as const).map(tp => (
                  <button key={tp.v} type="button" onClick={()=>setInvoiceForm(f=>({...f,faturaTipi:tp.v}))}
                    className={`p-2.5 rounded-xl border text-left transition-all ${invoiceForm.faturaTipi===tp.v?'border-[#ff4000] bg-[#ff4000]/5':'border-gray-200 hover:border-gray-300'}`}>
                    <p className={`text-[11px] font-bold ${invoiceForm.faturaTipi===tp.v?'text-[#ff4000]':'text-gray-700'}`}>{tp.l}</p>
                    <p className="text-[9px] text-gray-400 mt-0.5">{tp.d}</p>
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">{oc(currentLanguage).fatura_no}</label>
                  <input className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-[#ff4000]" value={invoiceForm.faturaNo} onChange={e=>setInvoiceForm(f=>({...f,faturaNo:e.target.value}))} placeholder="FTR-2026-001" /></div>
                <div><label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">{oc(currentLanguage).tarih}</label>
                  <input type="date" className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-[#ff4000]" value={invoiceForm.date} onChange={e=>setInvoiceForm(f=>({...f,date:e.target.value}))} /></div>
              </div>
              <div><label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">{oc(currentLanguage).musteri_adi}</label>
                <input className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-[#ff4000]" value={invoiceForm.customerName} onChange={e=>setInvoiceForm(f=>({...f,customerName:e.target.value}))} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">{ac(currentLanguage).vergi_no}</label>
                  <input className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-[#ff4000]" value={invoiceForm.taxId} onChange={e=>setInvoiceForm(f=>({...f,taxId:e.target.value}))} /></div>
                <div><label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">{oc(currentLanguage).vergi_dairesi}</label>
                  <input className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-[#ff4000]" value={invoiceForm.taxOffice} onChange={e=>setInvoiceForm(f=>({...f,taxOffice:e.target.value}))} /></div>
              </div>
              <div><label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">{oc(currentLanguage).adres}</label>
                <textarea rows={2} className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-[#ff4000] resize-none" value={invoiceForm.address} onChange={e=>setInvoiceForm(f=>({...f,address:e.target.value}))} /></div>
              <div><label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">KDV %</label>
                <div className="flex gap-2">
                  {[0,1,8,10,18,20].map(r => (
                    <button key={r} type="button" onClick={()=>setInvoiceForm(f=>({...f,kdvOran:r}))}
                      className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-colors ${invoiceForm.kdvOran===r?'bg-[#ff4000] text-white':'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>%{r}</button>
                  ))}
                </div>
              </div>
              {/* Toplam — sipariş bağlıysa ondan, değilse elle. `setInvoiceSource` bugüne kadar
                  yalnız null ile çağrıldığı için (2026-09-18 ölçümü) her fatura ₺0 kaydediliyordu;
                  tutar bilinmeden fatura artık KESİLMEZ (AccountingModule.handleCreateInvoice). */}
              {!invoiceSource && (
                <div><label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">{ac(currentLanguage).toplam_kdv_dahil}</label>
                  <input type="number" min="0" step="0.01" inputMode="decimal"
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-[#ff4000]"
                    value={invoiceForm.tutar} onChange={e=>setInvoiceForm(f=>({...f,tutar:e.target.value}))} placeholder="0,00" />
                  {/* `min="0"` tarayıcıda HİÇ zorlanmıyor (modalda <form> yok, buton doğrudan
                      handleCreateInvoice çağırıyor) — eksi tutar uyarısı burada, elemesi
                      faturaTutarlari'nda (2026-09-18). */}
                  {!bilinenSayi(invoiceForm.tutar)
                    ? <p className="text-[10px] text-gray-400 mt-1">{ac(currentLanguage).tutar_girilmeden_fatura_kesilemez}</p>
                    : Number(invoiceForm.tutar) < 0
                      ? <p className="text-[10px] text-red-500 mt-1">{ac(currentLanguage).tutar_eksi_olamaz_fatura_kesilemez}</p>
                      : null}</div>
              )}
              {(() => {
                // Hesap tek kaynakta (utils/muhasebe/faturalar.faturaTutarlari) — kaydedilecek üç alanın aynısı.
                const onizleme = faturaTutarlari(invoiceSource ? invoiceSource.totalPrice : invoiceForm.tutar, invoiceForm.kdvOran);
                if (!onizleme) return null;
                return (
                  <div className="bg-gray-50 rounded-xl p-3 text-xs space-y-1">
                    {!!invoiceSource && <div className="flex justify-between"><span className="text-gray-500">{ac(currentLanguage).siparis}:</span><span className="font-semibold">#{String(invoiceSource.id ?? '').slice(0,8)}</span></div>}
                    <div className="flex justify-between"><span className="text-gray-500">{oc(currentLanguage).matrah_kdv_haric}:</span><span className="font-semibold">{paraYaz(onizleme.kdvHaric)}</span></div>
                    <div className="flex justify-between text-[#ff4000]"><span>KDV %{invoiceForm.kdvOran}:</span><span className="font-semibold">{paraYaz(onizleme.kdvTutari)}</span></div>
                    <div className="flex justify-between font-bold border-t border-gray-200 pt-1"><span>{oc(currentLanguage).toplam}:</span><span>{paraYaz(onizleme.toplam)}</span></div>
                  </div>
                );
              })()}
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={handleCreateInvoice} className="flex-1 bg-[#ff4000] hover:bg-[#cc3200] text-white py-2.5 rounded-xl text-sm font-bold transition-colors">{ac(currentLanguage).faturayi_kes}</button>
              <button onClick={()=>setShowInvoiceModal(false)} className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 py-2.5 rounded-xl text-sm font-bold transition-colors">{oc(currentLanguage).iptal}</button>
            </div>
          </div>
        </div>
      )}

      {/* KPI + header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 flex-1 sm:mr-4">
          {/* Hesap tek kaynakta (utils/muhasebe/faturalar.faturaKpi) — KAYNAK FİLTRESİ
              (2026-08-01) ve YÖN KIRILIMI (satış cirosu ile alış gideri toplanmaz;
              alış toplamı cha_cinsi=6'ya dayanıyor, portal tie-out'u bekliyor)
              gerekçeleri modülde. Bilinmeyen tutar toplama GİRMEZ, SAYILIR. */}
          {(() => {
            const k = faturaKpi(invoices, mikroFaturaSatirlari, { kaynak: faturaKaynak });
            const tutar = faturaYon==='gelen' ? k.alis : k.satis;
            const tutarLabel = faturaYon==='gelen'
              ? (ac(currentLanguage).alis_tutari)
              : (ac(currentLanguage).satis_tutari);
            // Hiç bilinen tutar yoksa ekranTutari NaN → paraYaz '—' (eskiden ₺0,00 basıyordu).
            const tutarValue = paraYaz(ekranTutari(tutar));
            const tutarsizNotu = tutar.bilinmeyen > 0
              ? (currentLanguage==='tr'
                  ? `${tutar.bilinmeyen} kayıt tutarsız — toplama girmedi`
                  : `${tutar.bilinmeyen} records unknown — excluded from total`)
              : null;
            // Eski koşul `alisToplam > 0` idi; tutarı bilinmeyen alış faturası 0 sayıldığı için
            // hepsi bilinmiyorsa alış satırı hiç görünmüyordu — bilinmeyen varken de göster ('—').
            const tutarAlt = faturaYon==='hepsi' && (k.alis.toplam > 0 || k.alis.bilinmeyen > 0)
              ? `${ac(currentLanguage).alis} ${paraYaz(ekranTutari(k.alis))}`
              : null;
            return [
              { label: ac(currentLanguage).toplam_fatura,
                value: k.adet,
                alt: k.mikroAdet && k.cetpaAdet ? `${k.cetpaAdet} Cetpa · ${k.mikroAdet} Mikro`
                  : (faturaYon==='hepsi' && k.mikroGidenAdet && k.mikroGelenAdet
                      ? `${k.mikroGidenAdet} ${ac(currentLanguage).satis} · ${k.mikroGelenAdet} ${ac(currentLanguage).alis_2}`
                      : null),
                color: 'text-[#ff4000]' },
              { label: tutarLabel, value: tutarValue,
                alt: [tutarAlt, tutarsizNotu].filter(Boolean).join(' · ') || null, color: 'text-green-600' },
              { label: 'e-Fatura / e-Arşiv',
                value: `${k.eFaturaAdet} / ${k.eArsivAdet}`,
                alt: ac(currentLanguage).yalniz_cetpa, color: 'text-purple-600' },
            ];
          })().map((k,i)=>(
            <div key={i} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
              <p className={`text-2xl font-bold ${k.color}`}>{k.value}</p>
              <p className="text-xs text-gray-500 mt-1">{k.label}</p>
              {k.alt && <p className="text-[10px] text-gray-400 mt-0.5">{k.alt}</p>}
            </div>
          ))}
        </div>
        {isAuthenticated && (
          <button onClick={()=>{setInvoiceSource(null);setShowInvoiceModal(true);}} className="flex items-center gap-2 bg-[#ff4000] hover:bg-[#cc3200] text-white px-4 py-2.5 rounded-full text-sm font-bold transition-colors shadow-sm shrink-0">
            <Plus className="w-4 h-4"/>{ac(currentLanguage).yeni_fatura}
          </button>
        )}
      </div>

      {/* Filter + Search */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:flex-1 sm:w-auto">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none"/>
          <input className="pl-9 w-full bg-white border border-gray-200 rounded-2xl px-4 py-2.5 text-sm outline-none focus:border-[#ff4000]"
            placeholder={ac(currentLanguage).fatura_ara}
            value={invoiceSearch} onChange={e=>setInvoiceSearch(e.target.value)} />
        </div>
        <div className="flex gap-1 bg-white border border-gray-200 rounded-2xl p-1">
          {(['all','e-fatura','e-arsiv','ihracat'] as const).map(f => (
            <button key={f} onClick={()=>setInvoiceTypeFilter(f)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${invoiceTypeFilter===f?'bg-[#ff4000] text-white':'text-gray-500 hover:text-gray-700'}`}>
              {f==='all'?(oc(currentLanguage).tumu):f==='ihracat'?(oc(currentLanguage).ihracat):f}
            </button>
          ))}
        </div>
        {/* Kaynak seçici — Cetpa'da kesilen faturalar mı, Mikro'dan çekilenler mi.
            Varsayılan 'cetpa', yani ekran eskisi gibi davranır. */}
        <div className="flex gap-1 bg-white border border-gray-200 rounded-2xl p-1">
          {([
            ['hepsi', oc(currentLanguage).tumu],
            ['mikro', `Mikro (${mikroFaturaSatirlari.length})`],
            ['cetpa', `Cetpa (${invoices.length})`],
          ] as const).map(([k,l]) => (
            <button key={k} onClick={()=>setFaturaKaynak(k)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${faturaKaynak===k?'bg-blue-600 text-white':'text-gray-500 hover:text-gray-700'}`}>
              {l}
            </button>
          ))}
        </div>
        {/* Yön — Mikro'da hem giden (satış) hem gelen (alış) fatura var.
            Gelen faturalar 2026-08-01'e kadar hiç gösterilmiyordu. */}
        <div className="flex gap-1 bg-white border border-gray-200 rounded-2xl p-1">
          {([
            ['hepsi', ac(currentLanguage).her_yon],
            ['giden', ac(currentLanguage).giden],
            ['gelen', ac(currentLanguage).gelen],
          ] as const).map(([k,l]) => (
            <button key={k} onClick={()=>setFaturaYon(k)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${faturaYon===k?'bg-teal-600 text-white':'text-gray-500 hover:text-gray-700'}`}>
              {l}
            </button>
          ))}
        </div>
        {/* Yıl filtresi — import tüm yılları çekiyor; varsayılan cari yıl.
            Yıllar mikroFaturalar tarihlerinden türetilir. */}
        {(() => {
          const yillar = Array.from(new Set(
            mikroFaturalar.map(f => (typeof f.tarih === 'string' ? f.tarih.slice(0, 4) : '')).filter(y => /^\d{4}$/.test(y)),
          )).sort((a, b) => b.localeCompare(a));
          if (yillar.length === 0) return null;
          return (
            <select value={faturaYil} onChange={e => setFaturaYil(e.target.value)}
              className="px-3 py-1.5 rounded-2xl text-xs font-bold border border-gray-200 bg-white text-gray-700 outline-none focus:border-[#ff4000]">
              <option value="hepsi">{ac(currentLanguage).tum_yillar}</option>
              {yillar.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          );
        })()}
      </div>

      {/* Invoices table */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/60">
                <SortHeader label={oc(currentLanguage).fatura_no} sortKey="faturaNo" currentSort={invoiceSort} onSort={k=>setInvoiceSort(p=>({key:k,direction:p.key===k&&p.direction==='asc'?'desc':'asc'}))} />
                <SortHeader label={oc(currentLanguage).musteri} sortKey="customerName" currentSort={invoiceSort} onSort={k=>setInvoiceSort(p=>({key:k,direction:p.key===k&&p.direction==='asc'?'desc':'asc'}))} />
                <SortHeader label={oc(currentLanguage).tur} sortKey="faturaTipi" currentSort={invoiceSort} onSort={k=>setInvoiceSort(p=>({key:k,direction:p.key===k&&p.direction==='asc'?'desc':'asc'}))} />
                <SortHeader label={oc(currentLanguage).tarih} sortKey="date" currentSort={invoiceSort} onSort={k=>setInvoiceSort(p=>({key:k,direction:p.key===k&&p.direction==='asc'?'desc':'asc'}))} className="hidden md:table-cell" />
                <SortHeader label="KDV %" sortKey="kdvOran" currentSort={invoiceSort} onSort={k=>setInvoiceSort(p=>({key:k,direction:p.key===k&&p.direction==='asc'?'desc':'asc'}))} className="text-right" />
                <SortHeader label={ac(currentLanguage).matrah} sortKey="kdvHaric" currentSort={invoiceSort} onSort={k=>setInvoiceSort(p=>({key:k,direction:p.key===k&&p.direction==='asc'?'desc':'asc'}))} className="text-right" />
                <SortHeader label={oc(currentLanguage).toplam} sortKey="totalPrice" currentSort={invoiceSort} onSort={k=>setInvoiceSort(p=>({key:k,direction:p.key===k&&p.direction==='asc'?'desc':'asc'}))} className="text-right" />
                <SortHeader label={oc(currentLanguage).durum} sortKey="status" currentSort={invoiceSort} onSort={k=>setInvoiceSort(p=>({key:k,direction:p.key===k&&p.direction==='asc'?'desc':'asc'}))} />
                {isAuthenticated && <th className="px-4 py-3"/>}
              </tr>
            </thead>
            <tbody>
              {invoices
                .filter(inv => invoiceTypeFilter==='all' || inv.faturaTipi===invoiceTypeFilter)
                // Türkçe-duyarlı arama: düz toLowerCase 'IŞIK'ı 'işık' yapıp
                // 'ışık' aramasını sessizce boş döndürüyordu (bkz. utils/arama.ts).
                .filter(inv => eslesir(invoiceSearch, inv.customerName, inv.faturaNo, inv.totalPrice))
                // Sıralama tek kaynakta (utils/muhasebe/faturalar.faturaSatirKarsilastir) — Cetpa
                // dokümanında alan adı kolon adıyla aynı, eşleme gerekmez. Tutarı/oranı olmayan ESKİ
                // fatura 0 sayılıp başa dizilmez, sona gider.
                .sort(faturaSatirKarsilastir(invoiceSort.key, invoiceSort.direction))
                .map(inv => {
                  const tp = inv.faturaTipi as string;
                  const typeColor = tp==='ihracat'?'bg-blue-100 text-blue-600':tp==='e-arsiv'?'bg-purple-100 text-purple-600':'bg-green-100 text-green-600';
                  return (
                    <tr key={inv.id as string} className="border-b border-gray-50 hover:bg-gray-50/60 transition-colors">
                      <td className="px-4 py-3 font-mono font-semibold text-[#ff4000]">{inv.faturaNo as string || `#${(inv.id as string).slice(0,8)}`}</td>
                      <td className="px-4 py-3">
                        <p className="font-semibold text-[#1D1D1F]">{inv.customerName as string}</p>
                        {!!inv.taxId && <p className="text-[10px] text-gray-400">VKN: {inv.taxId as string}</p>}
                      </td>
                      <td className="px-4 py-3"><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${typeColor}`}>{faturaTipiEtiketi(tp, currentLanguage)}</span></td>
                      <td className="px-4 py-3 text-gray-500 hidden md:table-cell">{inv.date as string}</td>
                      {/* Oranı olmayan eski fatura '%undefined' basıyordu (2026-09-18). */}
                      <td className="px-4 py-3 text-right text-gray-600">{bilinenSayi(inv.kdvOran) ? `%${Number(inv.kdvOran)}` : '—'}</td>
                      <td className="px-4 py-3 text-right text-gray-600">{paraYaz(inv.kdvHaric)}</td>
                      <td className="px-4 py-3 text-right font-bold text-[#1D1D1F]">{paraYaz(inv.totalPrice)}</td>
                      <td className="px-4 py-3"><span className="text-[10px] font-bold bg-green-100 text-green-600 px-2 py-0.5 rounded-full">{inv.status as string || 'Kesildi'}</span></td>
                      {isAuthenticated && (
                        <td className="px-4 py-3">
                          <button onClick={async () => {
                            const ok = await confirmAction({
                              title: ac(currentLanguage).faturayi_sil,
                              message: ac(currentLanguage).faturayi_silmek_istediginize_emin_misiniz_bu_isl,
                              confirmLabel: oc(currentLanguage).sil,
                              variant: 'danger',
                            });
                            if (!ok) return;
                            await deleteDoc(doc(db,'invoices',inv.id as string));
                          }} className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors"><Trash2 className="w-3.5 h-3.5"/></button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              {/* Mikro faturaları — Cetpa'da kesilenlerin YANINDA, MİKRO rozetiyle.
                  Bu ekran `invoices` (Cetpa'da kesilen) okuyor; Mikro'dan çekilenler
                  `mikroFaturalar`da duruyordu ve hiç görünmüyordu (2026-07-31).
                  Mevcut mantık değişmedi, kaynak seçici opt-in. */}
              {/* Mikro satırlarında ARAMA HİÇ YOKTU (2026-08-28 kullanıcı bulgusu):
                  kutuya yazınca yalnız Cetpa faturaları süzülüyor, Mikro'dan
                  gelen tüm satırlar ekranda kalıyordu.
                  Tutar metnine YALNIZ bilinen sayı girer: hook bilinmeyeni NaN veriyor
                  (2026-09-18) ve `katla(NaN)` 'nan' üretip aramayla eşleşiyordu. */}
              {faturaKaynak !== 'cetpa' && [...mikroFaturaSatirlari]
                .filter(f => eslesir(invoiceSearch, f.musteri, f.faturaNo, bilinenSayi(f.tutar) ? f.tutar : null))
                // Sıralama tek kaynakta (utils/muhasebe/faturalar.faturaSatirKarsilastir): hook
                // bilinmeyen tutar/kdv/matrahı NaN veriyor (2026-09-18) ve buradaki ham `<`/`>`
                // karşılaştırması NaN'ı "her şeye eşit" sayıp BİLİNEN satırların da sırasını bozuyordu.
                .sort(faturaSatirKarsilastir<MikroFaturaRow>(invoiceSort.key, invoiceSort.direction, MIKRO_SORT_KEY))
                .map(f => (
                <tr key={`mikro-fat-${f.id}`}
                  onClick={() => setFaturaDetay({ ...f, uuid: f.uuid })}
                  title={ac(currentLanguage).detay_ve_xml_pdf_icin_tiklayin}
                  className="border-b border-gray-50 hover:bg-blue-50/60 bg-blue-50/20 transition-colors cursor-pointer">
                  <td className="px-4 py-3 font-mono font-semibold text-blue-600 underline decoration-dotted underline-offset-2">{f.faturaNo || '—'}</td>
                  <td className="px-4 py-3">
                    <p className="font-semibold text-[#1D1D1F]">{f.musteri}</p>
                    <p className="text-[10px] text-gray-400">{ac(currentLanguage).cari}{f.cariKod}</p>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full uppercase bg-blue-100 text-blue-600">mikro</span>
                    <span className={`ml-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${f.yon === 'gelen' ? 'bg-purple-100 text-purple-600' : 'bg-teal-100 text-teal-700'}`}>
                      {f.yon === 'gelen' ? (oc(currentLanguage).gelen) : (oc(currentLanguage).giden)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500 hidden md:table-cell">{f.tarih || '—'}</td>
                  <td className="px-4 py-3 text-right text-gray-600">
                    {f.oranKarma
                      ? <span title={ac(currentLanguage).faturada_birden_fazla_kdv_orani_var_or_10_20_mat} className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">{oc(currentLanguage).karma}</span>
                      : (f.oran !== null ? `%${f.oran}` : '—')}
                  </td>
                  {/* `f.matrah ? … : '—'` idi: hook bilinmeyeni 0'a zorladığı için gerçek ₺0 matrah da
                      gizleniyordu. Hook artık NaN veriyor (2026-09-18) → paraYaz bilinmeyene '—', ₺0'a ₺0,00 basar. */}
                  <td className="px-4 py-3 text-right text-gray-600">{paraYaz(f.matrah)}</td>
                  <td className="px-4 py-3 text-right font-bold text-[#1D1D1F]">{paraYaz(f.tutar)}</td>
                  <td className="px-4 py-3"><span className="text-[10px] font-bold bg-blue-100 text-blue-600 px-2 py-0.5 rounded-full">{currentLanguage === 'tr' ? 'Mikro' : 'Mikro'}</span></td>
                  {isAuthenticated && <td className="px-4 py-3" />}
                </tr>
              ))}
              {invoices.length===0 && (faturaKaynak === 'cetpa' || mikroFaturaSatirlari.length === 0) && (
                <tr><td colSpan={9} className="text-center py-12 text-gray-400">
                  <FileText className="w-10 h-10 mx-auto mb-2 opacity-20"/>
                  <p className="text-sm">{ac(currentLanguage).henuz_fatura_kesilmedi}</p>
                  <p className="text-xs mt-1">{ac(currentLanguage).siparisler_listesinden_fatura_kes_butonunu_kulla}</p>
                  {mikroFaturaSatirlari.length > 0 && (
                    <p className="text-xs mt-2 text-blue-600">
                      {currentLanguage==='tr'
                        ? `Mikro'da ${mikroFaturaSatirlari.length} fatura var — yukarıdaki "Mikro" seçeneğiyle görün.`
                        : `${mikroFaturaSatirlari.length} invoices exist in Mikro — use the "Mikro" filter above.`}
                    </p>
                  )}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </motion.div>
  );
}
