import { motion } from 'motion/react';
import { eslesir } from '../../utils/arama';
import { confirmAction } from '../../lib/confirm';
import { X, Plus, Search, FileText, Trash2 } from 'lucide-react';
import { doc, deleteDoc } from '../../lib/dbClient';
import { db } from '../../firebase';
import { type MikroFaturaDetayVerisi } from '../MikroFaturaDetay';
import { type MikroFatura } from '../../hooks/useMikroFaturalar';
import { SortHeader, formatTRY, type AccountingT } from './shared';
import { faturaTipiEtiketi } from '../../utils/durumEtiketi';

type InvoiceForm = {
  faturaNo: string; faturaTipi: 'e-fatura' | 'e-arsiv' | 'ihracat';
  customerName: string; customerEmail: string; taxId: string; taxOffice: string;
  address: string; kdvOran: number; date: string; notes: string; orderId: string;
};
type MikroFaturaRow = MikroFatura & { musteri: string };

// Kolon başlıkları invoices alanlarıyla aynı isimde değil (musteri/tarih/oran/
// matrah/tutar) — sıralama tıklaması Mikro satırlarında hiç etki etmiyordu
// (2026-08-17, kullanıcı bildirdi). Statik, bileşen dışında (her render'da
// yeniden ayrılmasın).
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
              <h3 className="font-bold text-lg">{currentLanguage==='tr'?'Fatura Kes':'Create Invoice'}</h3>
              <button onClick={()=>setShowInvoiceModal(false)} className="p-1.5 rounded-lg hover:bg-gray-100"><X className="w-4 h-4"/></button>
            </div>
            {/* Invoice type */}
            <div className="mb-4">
              <label className="text-[10px] font-bold text-gray-500 uppercase mb-1.5 block">{currentLanguage==='tr'?'Fatura Türü':'Invoice Type'}</label>
              <div className="grid grid-cols-3 gap-2">
                {([
                  { v:'e-fatura', l:'e-Fatura', d:currentLanguage==='tr'?'Kayıtlı mükellef':'Registered taxpayer' },
                  { v:'e-arsiv', l:'e-Arşiv', d:currentLanguage==='tr'?'Bireysel / kayıtsız':'Individual / unregistered' },
                  { v:'ihracat', l:currentLanguage==='tr'?'İhracat':'Export', d:currentLanguage==='tr'?'Yurt dışı':'International' },
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
                <div><label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">{currentLanguage==='tr'?'Fatura No':'Invoice No'}</label>
                  <input className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-[#ff4000]" value={invoiceForm.faturaNo} onChange={e=>setInvoiceForm(f=>({...f,faturaNo:e.target.value}))} placeholder="FTR-2026-001" /></div>
                <div><label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">{currentLanguage==='tr'?'Tarih':'Date'}</label>
                  <input type="date" className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-[#ff4000]" value={invoiceForm.date} onChange={e=>setInvoiceForm(f=>({...f,date:e.target.value}))} /></div>
              </div>
              <div><label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">{currentLanguage==='tr'?'Müşteri Adı':'Customer Name'}</label>
                <input className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-[#ff4000]" value={invoiceForm.customerName} onChange={e=>setInvoiceForm(f=>({...f,customerName:e.target.value}))} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">{currentLanguage==='tr'?'Vergi No':'Tax ID'}</label>
                  <input className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-[#ff4000]" value={invoiceForm.taxId} onChange={e=>setInvoiceForm(f=>({...f,taxId:e.target.value}))} /></div>
                <div><label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">{currentLanguage==='tr'?'Vergi Dairesi':'Tax Office'}</label>
                  <input className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-[#ff4000]" value={invoiceForm.taxOffice} onChange={e=>setInvoiceForm(f=>({...f,taxOffice:e.target.value}))} /></div>
              </div>
              <div><label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">{currentLanguage==='tr'?'Adres':'Address'}</label>
                <textarea rows={2} className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-[#ff4000] resize-none" value={invoiceForm.address} onChange={e=>setInvoiceForm(f=>({...f,address:e.target.value}))} /></div>
              <div><label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">KDV %</label>
                <div className="flex gap-2">
                  {[0,1,8,10,18,20].map(r => (
                    <button key={r} type="button" onClick={()=>setInvoiceForm(f=>({...f,kdvOran:r}))}
                      className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-colors ${invoiceForm.kdvOran===r?'bg-[#ff4000] text-white':'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>%{r}</button>
                  ))}
                </div>
              </div>
              {invoiceSource && (
                <div className="bg-gray-50 rounded-xl p-3 text-xs space-y-1">
                  <div className="flex justify-between"><span className="text-gray-500">{currentLanguage==='tr'?'Sipariş':'Order'}:</span><span className="font-semibold">#{(invoiceSource.id as string).slice(0,8)}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">{currentLanguage==='tr'?'Matrah (KDV hariç)':'Net (excl. VAT)'}:</span><span className="font-semibold">₺{((invoiceSource.totalPrice as number||0)/(1+invoiceForm.kdvOran/100)).toLocaleString('tr-TR',{minimumFractionDigits:2,maximumFractionDigits:2})}</span></div>
                  <div className="flex justify-between text-[#ff4000]"><span>KDV %{invoiceForm.kdvOran}:</span><span className="font-semibold">₺{((invoiceSource.totalPrice as number||0)-(invoiceSource.totalPrice as number||0)/(1+invoiceForm.kdvOran/100)).toLocaleString('tr-TR',{minimumFractionDigits:2,maximumFractionDigits:2})}</span></div>
                  <div className="flex justify-between font-bold border-t border-gray-200 pt-1"><span>{currentLanguage==='tr'?'Toplam':'Total'}:</span><span>₺{(invoiceSource.totalPrice as number||0).toLocaleString('tr-TR',{minimumFractionDigits:2,maximumFractionDigits:2})}</span></div>
                </div>
              )}
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={handleCreateInvoice} className="flex-1 bg-[#ff4000] hover:bg-[#cc3200] text-white py-2.5 rounded-xl text-sm font-bold transition-colors">{currentLanguage==='tr'?'Faturayı Kes':'Create Invoice'}</button>
              <button onClick={()=>setShowInvoiceModal(false)} className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 py-2.5 rounded-xl text-sm font-bold transition-colors">{currentLanguage==='tr'?'İptal':'Cancel'}</button>
            </div>
          </div>
        </div>
      )}

      {/* KPI + header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 flex-1 sm:mr-4">
          {/* KPI'lar KAYNAK FİLTRESİNE UYAR — 320 Mikro faturası varken
              "Toplam Fatura 0" göstermek yanlıştı (2026-08-01).
              Cetpa sayıları invoices'tan, Mikro sayısı mikroSatisSatirlari'ndan. */}
          {(() => {
            const cetpaVar = faturaKaynak !== 'mikro';
            const mikroVar = faturaKaynak !== 'cetpa';
            const cetpaAdet = cetpaVar ? invoices.length : 0;
            const mikroAdet = mikroVar ? mikroFaturaSatirlari.length : 0;
            // YÖN KIRILIMI (2026-08-01): "Toplam Tutar" önce satış (giden) ve
            // alış (gelen) faturalarının tutarlarını TOPLUYORDU → "Her Yön"de
            // 148M gibi anlamsız bir birleşik rakam çıkıyordu (kullanıcı
            // haklı olarak reddetti). Satış cirosu ile alış gideri toplanmaz.
            // Cetpa + Mikro-giden = satış tarafı (doğrulanmış); Mikro-gelen =
            // alış tarafı. ⚠️ Alış toplamı cha_cinsi=6 filtresine dayanıyor,
            // henüz portal raporuyla tie-out edilmedi — o yüzden ayrı, satışa
            // karıştırılmadan gösteriliyor.
            const mikroGiden = mikroVar ? mikroFaturaSatirlari.filter(f => f.yon === 'giden') : [];
            const mikroGelen = mikroVar ? mikroFaturaSatirlari.filter(f => f.yon === 'gelen') : [];
            const cetpaToplam = cetpaVar ? invoices.reduce((a, i) => a + ((i.totalPrice as number) || 0), 0) : 0;
            const satisToplam = cetpaToplam + mikroGiden.reduce((a, f) => a + f.tutar, 0);
            const alisToplam  = mikroGelen.reduce((a, f) => a + f.tutar, 0);
            const tutarLabel = faturaYon==='gelen'
              ? (currentLanguage==='tr'?'Alış Tutarı':'Purchases')
              : (currentLanguage==='tr'?'Satış Tutarı':'Sales');
            const tutarValue = faturaYon==='gelen' ? formatTRY(alisToplam) : formatTRY(satisToplam);
            const tutarAlt = faturaYon==='hepsi' && alisToplam > 0
              ? `${currentLanguage==='tr'?'Alış':'Purch.'} ${formatTRY(alisToplam)}`
              : null;
            return [
              { label: currentLanguage==='tr'?'Toplam Fatura':'Total Invoices',
                value: cetpaAdet + mikroAdet,
                alt: mikroAdet && cetpaAdet ? `${cetpaAdet} Cetpa · ${mikroAdet} Mikro`
                  : (faturaYon==='hepsi' && mikroGiden.length && mikroGelen.length
                      ? `${mikroGiden.length} ${currentLanguage==='tr'?'satış':'sales'} · ${mikroGelen.length} ${currentLanguage==='tr'?'alış':'purch.'}`
                      : null),
                color: 'text-[#ff4000]' },
              { label: tutarLabel, value: tutarValue, alt: tutarAlt, color: 'text-green-600' },
              { label: 'e-Fatura / e-Arşiv',
                value: `${cetpaVar ? invoices.filter(i=>i.faturaTipi==='e-fatura').length : 0} / ${cetpaVar ? invoices.filter(i=>i.faturaTipi==='e-arsiv').length : 0}`,
                alt: currentLanguage==='tr'?'yalnız Cetpa':'Cetpa only', color: 'text-purple-600' },
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
            <Plus className="w-4 h-4"/>{currentLanguage==='tr'?'Yeni Fatura':'New Invoice'}
          </button>
        )}
      </div>

      {/* Filter + Search */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:flex-1 sm:w-auto">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none"/>
          <input className="pl-9 w-full bg-white border border-gray-200 rounded-2xl px-4 py-2.5 text-sm outline-none focus:border-[#ff4000]"
            placeholder={currentLanguage==='tr'?'Fatura ara...':'Search invoices...'}
            value={invoiceSearch} onChange={e=>setInvoiceSearch(e.target.value)} />
        </div>
        <div className="flex gap-1 bg-white border border-gray-200 rounded-2xl p-1">
          {(['all','e-fatura','e-arsiv','ihracat'] as const).map(f => (
            <button key={f} onClick={()=>setInvoiceTypeFilter(f)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${invoiceTypeFilter===f?'bg-[#ff4000] text-white':'text-gray-500 hover:text-gray-700'}`}>
              {f==='all'?(currentLanguage==='tr'?'Tümü':'All'):f==='ihracat'?(currentLanguage==='tr'?'İhracat':'Export'):f}
            </button>
          ))}
        </div>
        {/* Kaynak seçici — Cetpa'da kesilen faturalar mı, Mikro'dan çekilenler mi.
            Varsayılan 'cetpa', yani ekran eskisi gibi davranır. */}
        <div className="flex gap-1 bg-white border border-gray-200 rounded-2xl p-1">
          {([
            ['hepsi', currentLanguage==='tr'?'Tümü':'All'],
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
            ['hepsi', currentLanguage==='tr'?'Her Yön':'Both'],
            ['giden', currentLanguage==='tr'?'Giden':'Outgoing'],
            ['gelen', currentLanguage==='tr'?'Gelen':'Incoming'],
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
              <option value="hepsi">{currentLanguage==='tr'?'Tüm Yıllar':'All Years'}</option>
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
                <SortHeader label={currentLanguage==='tr'?'Fatura No':'Invoice No'} sortKey="faturaNo" currentSort={invoiceSort} onSort={k=>setInvoiceSort(p=>({key:k,direction:p.key===k&&p.direction==='asc'?'desc':'asc'}))} />
                <SortHeader label={currentLanguage==='tr'?'Müşteri':'Customer'} sortKey="customerName" currentSort={invoiceSort} onSort={k=>setInvoiceSort(p=>({key:k,direction:p.key===k&&p.direction==='asc'?'desc':'asc'}))} />
                <SortHeader label={currentLanguage==='tr'?'Tür':'Type'} sortKey="faturaTipi" currentSort={invoiceSort} onSort={k=>setInvoiceSort(p=>({key:k,direction:p.key===k&&p.direction==='asc'?'desc':'asc'}))} />
                <SortHeader label={currentLanguage==='tr'?'Tarih':'Date'} sortKey="date" currentSort={invoiceSort} onSort={k=>setInvoiceSort(p=>({key:k,direction:p.key===k&&p.direction==='asc'?'desc':'asc'}))} className="hidden md:table-cell" />
                <SortHeader label="KDV %" sortKey="kdvOran" currentSort={invoiceSort} onSort={k=>setInvoiceSort(p=>({key:k,direction:p.key===k&&p.direction==='asc'?'desc':'asc'}))} className="text-right" />
                <SortHeader label={currentLanguage==='tr'?'Matrah':'Net'} sortKey="kdvHaric" currentSort={invoiceSort} onSort={k=>setInvoiceSort(p=>({key:k,direction:p.key===k&&p.direction==='asc'?'desc':'asc'}))} className="text-right" />
                <SortHeader label={currentLanguage==='tr'?'Toplam':'Total'} sortKey="totalPrice" currentSort={invoiceSort} onSort={k=>setInvoiceSort(p=>({key:k,direction:p.key===k&&p.direction==='asc'?'desc':'asc'}))} className="text-right" />
                <SortHeader label={currentLanguage==='tr'?'Durum':'Status'} sortKey="status" currentSort={invoiceSort} onSort={k=>setInvoiceSort(p=>({key:k,direction:p.key===k&&p.direction==='asc'?'desc':'asc'}))} />
                {isAuthenticated && <th className="px-4 py-3"/>}
              </tr>
            </thead>
            <tbody>
              {invoices
                .filter(inv => invoiceTypeFilter==='all' || inv.faturaTipi===invoiceTypeFilter)
                // Türkçe-duyarlı arama: düz toLowerCase 'IŞIK'ı 'işık' yapıp
                // 'ışık' aramasını sessizce boş döndürüyordu (bkz. utils/arama.ts).
                .filter(inv => eslesir(invoiceSearch, inv.customerName, inv.faturaNo, inv.totalPrice))
                .sort((a, b) => {
                  const av = (a[invoiceSort.key as keyof typeof a] as string | number) ?? '';
                  const bv = (b[invoiceSort.key as keyof typeof b] as string | number) ?? '';
                  if (av < bv) return invoiceSort.direction === 'asc' ? -1 : 1;
                  if (av > bv) return invoiceSort.direction === 'asc' ? 1 : -1;
                  return 0;
                })
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
                      <td className="px-4 py-3 text-right text-gray-600">%{inv.kdvOran as number}</td>
                      <td className="px-4 py-3 text-right text-gray-600">₺{(inv.kdvHaric as number||0).toLocaleString('tr-TR',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
                      <td className="px-4 py-3 text-right font-bold text-[#1D1D1F]">₺{(inv.totalPrice as number||0).toLocaleString('tr-TR',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
                      <td className="px-4 py-3"><span className="text-[10px] font-bold bg-green-100 text-green-600 px-2 py-0.5 rounded-full">{inv.status as string || 'Kesildi'}</span></td>
                      {isAuthenticated && (
                        <td className="px-4 py-3">
                          <button onClick={async () => {
                            const ok = await confirmAction({
                              title: currentLanguage==='tr'?'Faturayı Sil':'Delete Invoice',
                              message: currentLanguage==='tr'?'Faturayı silmek istediğinize emin misiniz? Bu işlem geri alınamaz.':'Are you sure you want to delete this invoice? This cannot be undone.',
                              confirmLabel: currentLanguage==='tr'?'Sil':'Delete',
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
                  gelen tüm satırlar ekranda kalıyordu. */}
              {faturaKaynak !== 'cetpa' && [...mikroFaturaSatirlari]
                .filter(f => eslesir(invoiceSearch, f.musteri, f.faturaNo, f.tutar))
                .sort((a, b) => {
                const key = MIKRO_SORT_KEY[invoiceSort.key];
                if (!key) return 0;
                const av = (a[key] as string | number) ?? '';
                const bv = (b[key] as string | number) ?? '';
                if (av < bv) return invoiceSort.direction === 'asc' ? -1 : 1;
                if (av > bv) return invoiceSort.direction === 'asc' ? 1 : -1;
                return 0;
              }).map(f => (
                <tr key={`mikro-fat-${f.id}`}
                  onClick={() => setFaturaDetay({ ...f, uuid: f.uuid })}
                  title={currentLanguage==='tr'?'Detay ve XML/PDF için tıklayın':'Click for detail and XML/PDF'}
                  className="border-b border-gray-50 hover:bg-blue-50/60 bg-blue-50/20 transition-colors cursor-pointer">
                  <td className="px-4 py-3 font-mono font-semibold text-blue-600 underline decoration-dotted underline-offset-2">{f.faturaNo || '—'}</td>
                  <td className="px-4 py-3">
                    <p className="font-semibold text-[#1D1D1F]">{f.musteri}</p>
                    <p className="text-[10px] text-gray-400">{currentLanguage === 'tr' ? 'Cari: ' : 'Account: '}{f.cariKod}</p>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full uppercase bg-blue-100 text-blue-600">mikro</span>
                    <span className={`ml-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${f.yon === 'gelen' ? 'bg-purple-100 text-purple-600' : 'bg-teal-100 text-teal-700'}`}>
                      {f.yon === 'gelen' ? (currentLanguage==='tr'?'GELEN':'IN') : (currentLanguage==='tr'?'GİDEN':'OUT')}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500 hidden md:table-cell">{f.tarih || '—'}</td>
                  <td className="px-4 py-3 text-right text-gray-600">
                    {f.oranKarma
                      ? <span title={currentLanguage==='tr'?'Faturada birden fazla KDV oranı var (ör. %10 + %20) — matrah/toplam KDV bunları içerir, tek oran gösterilemez':'Multiple VAT rates on this invoice — net/total reflect all rates, a single % cannot be shown'} className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">{currentLanguage==='tr'?'Karma':'Mixed'}</span>
                      : (f.oran !== null ? `%${f.oran}` : '—')}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-600">{f.matrah ? formatTRY(f.matrah) : '—'}</td>
                  <td className="px-4 py-3 text-right font-bold text-[#1D1D1F]">₺{f.tutar.toLocaleString('tr-TR',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
                  <td className="px-4 py-3"><span className="text-[10px] font-bold bg-blue-100 text-blue-600 px-2 py-0.5 rounded-full">{currentLanguage === 'tr' ? 'Mikro' : 'Mikro'}</span></td>
                  {isAuthenticated && <td className="px-4 py-3" />}
                </tr>
              ))}
              {invoices.length===0 && (faturaKaynak === 'cetpa' || mikroFaturaSatirlari.length === 0) && (
                <tr><td colSpan={9} className="text-center py-12 text-gray-400">
                  <FileText className="w-10 h-10 mx-auto mb-2 opacity-20"/>
                  <p className="text-sm">{currentLanguage==='tr'?'Henüz fatura kesilmedi.':'No invoices yet.'}</p>
                  <p className="text-xs mt-1">{currentLanguage==='tr'?'Siparişler listesinden "Fatura Kes" butonunu kullanın.':'Use the "Create Invoice" button from the orders list.'}</p>
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
