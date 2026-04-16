import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Save, Eye, Settings2, Check, FileText,
  Receipt, ClipboardList, Truck, ShoppingCart, CheckCircle, Loader2,
  Trash2, Edit2, RotateCcw
} from 'lucide-react';
import { collection, doc, setDoc, deleteDoc, onSnapshot, query } from 'firebase/firestore';
import { db } from '../firebase';

interface DocumentDesignerProps {
  currentLanguage: 'tr' | 'en';
}

interface DocTemplate {
  id: string;
  docType: string;
  title: string;
  color: string;
  footer: string;
  bankDetails: string;
  showBankDetails: boolean;
  vatRate: number;
  updatedAt?: unknown;
}

const DOC_TYPES = [
  { id: 'fatura',    labelTr: 'Fatura',       labelEn: 'Invoice',       icon: Receipt,       defaultTitle: 'SATIŞ FATURASI' },
  { id: 'teklif',   labelTr: 'Teklif',        labelEn: 'Quotation',     icon: FileText,      defaultTitle: 'FİYAT TEKLİFİ' },
  { id: 'irsaliye', labelTr: 'İrsaliye',      labelEn: 'Delivery Note', icon: Truck,         defaultTitle: 'SEVK İRSALİYESİ' },
  { id: 'siparis',  labelTr: 'Sipariş',       labelEn: 'Order',         icon: ShoppingCart,  defaultTitle: 'SİPARİŞ FORMU' },
  { id: 'makbuz',   labelTr: 'Makbuz',        labelEn: 'Receipt',       icon: ClipboardList, defaultTitle: 'TAHSİLAT MAKBUZU' },
];

const BRAND_COLORS = ['#ff4000', '#007aff', '#34c759', '#5856d6', '#ff2d55', '#ff9500', '#1d1d1f', '#636366'];

const defaultTemplate = (docType: string): DocTemplate => {
  const dt = DOC_TYPES.find(d => d.id === docType);
  return {
    id: docType,
    docType,
    title: dt?.defaultTitle ?? docType.toUpperCase(),
    color: '#ff4000',
    footer: 'Bizi tercih ettiğiniz için teşekkürler.',
    bankDetails: 'TR00 0000 0000 0000 0000 0000 00',
    showBankDetails: true,
    vatRate: 20,
  };
};

export default function DocumentDesigner({ currentLanguage }: DocumentDesignerProps) {
  const [mainTab, setMainTab] = useState<'design' | 'print'>('design');
  const [activeType, setActiveType] = useState('fatura');
  const [templates, setTemplates] = useState<Record<string, DocTemplate>>({});
  const [saving, setSaving] = useState(false);
  const [savedToast, setSavedToast] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  // Current template = saved or default
  const current: DocTemplate = templates[activeType] ?? defaultTemplate(activeType);
  const [draft, setDraft] = useState<DocTemplate>(current);

  // Load all templates from Firestore
  useEffect(() => {
    const unsub = onSnapshot(query(collection(db, 'documentTemplates')), snap => {
      const loaded: Record<string, DocTemplate> = {};
      snap.docs.forEach(d => { loaded[d.id] = { id: d.id, ...d.data() } as DocTemplate; });
      setTemplates(loaded);
    });
    return unsub;
  }, []);

  // Sync draft when switching type or when template loads
  useEffect(() => {
    setDraft(templates[activeType] ?? defaultTemplate(activeType));
  }, [activeType, templates]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await setDoc(doc(db, 'documentTemplates', activeType), {
        ...draft,
        docType: activeType,
        updatedAt: new Date(),
      });
      setSavedToast(true);
      setTimeout(() => setSavedToast(false), 3000);
    } catch (e) {
      console.error('DocumentTemplate save error:', e);
    } finally {
      setSaving(false);
    }
  };

  const isSaved = JSON.stringify(draft) === JSON.stringify(templates[activeType] ?? defaultTemplate(activeType));

  const handleDelete = async (docType: string) => {
    try {
      await deleteDoc(doc(db, 'documentTemplates', docType));
      setDeleteConfirm(null);
      if (activeType === docType) {
        setDraft(defaultTemplate(docType));
      }
    } catch (e) {
      console.error('Delete error:', e);
    }
  };

  const handleReset = () => {
    setDraft(defaultTemplate(activeType));
  };

  const tr = currentLanguage === 'tr';

  return (
    <div className="space-y-5 relative">
      {/* Save toast */}
      <AnimatePresence>
        {savedToast && (
          <motion.div
            initial={{ opacity: 0, y: -16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            className="fixed top-6 right-6 z-[200] bg-green-500 text-white px-5 py-3 rounded-2xl shadow-xl text-sm font-semibold flex items-center gap-2"
          >
            <CheckCircle className="w-4 h-4" />
            {tr ? 'Şablon kaydedildi.' : 'Template saved.'}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Mode Tabs */}
      <div className="flex p-1 bg-gray-100/50 rounded-2xl w-fit mb-4">
        <button
          onClick={() => setMainTab('design')}
          className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-bold transition-all ${
            mainTab === 'design' ? 'bg-white shadow-sm text-brand' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <Edit2 className="w-4 h-4" />
          {tr ? 'Tasarım Editörü' : 'Design Editor'}
        </button>
        <button
          onClick={() => setMainTab('print')}
          className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-bold transition-all ${
            mainTab === 'print' ? 'bg-white shadow-sm text-brand' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <Receipt className="w-4 h-4" />
          {tr ? 'Baskı & Çıktı Merkezi' : 'Print & Output Center'}
        </button>
      </div>

      {mainTab === 'design' ? (
        <>
          {/* Document type selection tabs */}
          <div className="flex gap-2 flex-wrap mb-8">
            {DOC_TYPES.map(dt => {
              const Icon = dt.icon;
              const isSavedType = !!templates[dt.id];
              return (
                <button
                  key={dt.id}
                  onClick={() => setActiveType(dt.id)}
                  className={`flex items-center gap-2 px-6 py-2.5 rounded-2xl text-sm font-bold transition-all border ${
                    activeType === dt.id
                      ? 'bg-brand text-white border-brand shadow-lg'
                      : 'bg-white text-gray-600 border-gray-200 hover:border-brand hover:text-brand'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {tr ? dt.labelTr : dt.labelEn}
                  {isSavedType && (
                    <span className={`w-1.5 h-1.5 rounded-full ${activeType === dt.id ? 'bg-white/70' : 'bg-green-500'}`} />
                  )}
                </button>
              );
            })}
          </div>

          <div className="flex flex-col lg:flex-row gap-6">
            {/* Left: Settings */}
            <div className="w-full lg:w-72 shrink-0 space-y-4">
              <div className="bg-white rounded-3xl p-6 shadow-sm border border-gray-100 space-y-5">
                <div className="flex items-center gap-2">
                  <Settings2 className="w-4 h-4 text-brand" />
                  <h3 className="font-bold text-gray-900 text-sm">
                    {tr ? 'Tasarım Ayarları' : 'Design Settings'}
                  </h3>
                  {!isSaved && (
                    <span className="ml-auto text-[10px] font-bold text-amber-500 bg-amber-50 px-2 py-0.5 rounded-full">
                      {tr ? 'Kaydedilmedi' : 'Unsaved'}
                    </span>
                  )}
                </div>

                {/* Settings fields... */}
                <div>
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest block mb-1.5">
                    {tr ? 'Belge Başlığı' : 'Document Title'}
                  </label>
                  <input
                    type="text"
                    value={draft.title}
                    onChange={e => setDraft({ ...draft, title: e.target.value })}
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-brand"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest block mb-1.5">
                    {tr ? 'Kurumsal Renk' : 'Brand Color'}
                  </label>
                  <div className="flex gap-2 flex-wrap">
                    {BRAND_COLORS.map(c => (
                      <button
                        key={c}
                        onClick={() => setDraft({ ...draft, color: c })}
                        className={`w-8 h-8 rounded-full border-2 transition-transform flex items-center justify-center ${
                          draft.color === c ? 'border-gray-800 scale-110' : 'border-transparent'
                        }`}
                        style={{ backgroundColor: c }}
                      >
                        {draft.color === c && <Check className="w-3.5 h-3.5 text-white drop-shadow" />}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest block mb-1.5">
                    {tr ? 'KDV Oranı (%)' : 'VAT Rate (%)'}
                  </label>
                  <select
                    value={draft.vatRate}
                    onChange={e => setDraft({ ...draft, vatRate: Number(e.target.value) })}
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-brand"
                  >
                    {[0, 1, 10, 20].map(v => <option key={v} value={v}>%{v}</option>)}
                  </select>
                </div>

                <div>
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest block mb-1.5">
                    {tr ? 'Alt Bilgi (Footer)' : 'Footer Text'}
                  </label>
                  <textarea
                    rows={2}
                    value={draft.footer}
                    onChange={e => setDraft({ ...draft, footer: e.target.value })}
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-brand resize-none"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                      {tr ? 'Banka Bilgileri' : 'Bank Details'}
                    </label>
                    <button
                      onClick={() => setDraft({ ...draft, showBankDetails: !draft.showBankDetails })}
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full transition-colors ${
                        draft.showBankDetails ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                      }`}
                    >
                      {draft.showBankDetails ? (tr ? 'Göster' : 'Visible') : (tr ? 'Gizli' : 'Hidden')}
                    </button>
                  </div>
                  {draft.showBankDetails && (
                    <input
                      type="text"
                      value={draft.bankDetails}
                      onChange={e => setDraft({ ...draft, bankDetails: e.target.value })}
                      className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-brand font-mono"
                    />
                  )}
                </div>

                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="w-full bg-brand text-white py-3 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 hover:opacity-90 transition-all shadow-md active:scale-95 disabled:opacity-60"
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  {saving ? (tr ? 'Kaydediliyor...' : 'Saving...') : (tr ? 'Şablonu Kaydet' : 'Save Template')}
                </button>
              </div>

              {/* Saved list... */}
              <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">{tr ? 'Kayıtlı Şablonlar' : 'Saved Templates'}</p>
                <div className="space-y-1.5">
                  {DOC_TYPES.map(dt => {
                    const saved = !!templates[dt.id];
                    const isActive = activeType === dt.id;
                    const Icon = dt.icon;
                    return (
                      <button
                        key={dt.id}
                        onClick={() => setActiveType(dt.id)}
                        className={`w-full flex items-center gap-2 p-2 rounded-xl text-xs font-semibold transition-all ${isActive ? 'bg-brand/5 text-brand border border-brand/10' : 'text-gray-500 hover:bg-gray-50'}`}
                      >
                        <Icon className="w-3.5 h-3.5" />
                        {tr ? dt.labelTr : dt.labelEn}
                        {saved && <span className="ml-auto text-green-500">✓</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Right: Preview */}
            <div className="flex-1 min-h-[600px]">
              <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden flex flex-col h-full">
                <div className="px-5 py-3 border-b border-gray-100 bg-gray-50/50 flex items-center justify-between">
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest flex items-center gap-2">
                    <Eye className="w-3.5 h-3.5" />
                    {tr ? 'Canlı Önizleme' : 'Live Preview'}
                  </span>
                </div>
                <div className="p-8 bg-gray-100/40 overflow-y-auto flex-1 h-[700px]">
                  <DocumentPreview template={draft} />
                </div>
              </div>
            </div>
          </div>
        </>
      ) : (
        <div className="space-y-6">
          {/* Document type selection tabs for Print Center */}
          <div className="flex gap-2 flex-wrap mb-6 bg-white p-2 rounded-2xl border border-gray-100 shadow-sm">
            {DOC_TYPES.map(dt => {
              const Icon = dt.icon;
              const isSavedType = !!templates[dt.id];
              return (
                <button
                  key={dt.id}
                  onClick={() => setActiveType(dt.id)}
                  disabled={!isSavedType}
                  className={`flex items-center gap-3 px-6 py-3 rounded-xl text-sm font-bold transition-all ${
                    activeType === dt.id
                      ? 'bg-brand text-white shadow-lg shadow-brand/20'
                      : isSavedType 
                        ? 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-100' 
                        : 'bg-gray-50 text-gray-300 cursor-not-allowed border border-dashed border-gray-200'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {tr ? dt.labelTr : dt.labelEn}
                  {!isSavedType && <span className="text-[10px] font-medium ml-1">({tr ? 'YOK' : 'EMPTY'})</span>}
                </button>
              );
            })}
          </div>

          {!templates[activeType] ? (
            <div className="flex flex-col items-center justify-center py-20 bg-white rounded-3xl border-2 border-dashed border-gray-200">
              <div className="w-16 h-16 bg-gray-50 rounded-2xl flex items-center justify-center text-gray-300 mb-4">
                <FileText className="w-8 h-8" />
              </div>
              <h3 className="text-gray-900 font-bold mb-1">{tr ? 'Henüz Şablon Kaydedilmemiş' : 'No Template Saved Yet'}</h3>
              <p className="text-gray-400 text-sm mb-6">{tr ? 'Bu evrak türü için henüz bir tasarım kaydetmediniz.' : 'You haven\'t saved a design for this document type yet.'}</p>
              <button 
                onClick={() => setMainTab('design')}
                className="px-6 py-2.5 bg-brand text-white rounded-xl text-sm font-bold transition-all active:scale-95"
              >
                {tr ? 'Tasarım Editörüne Git' : 'Go to Design Editor'}
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
              {/* Left Info & Actions */}
              <div className="lg:col-span-4 space-y-6">
                <div className="bg-white rounded-3xl p-6 border border-gray-100 shadow-sm space-y-6">
                  <div>
                    <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">{tr ? 'EVRAK BİLGİSİ' : 'DOCUMENT INFO'}</h4>
                    <div className="space-y-4">
                      <div className="flex justify-between items-center text-sm">
                        <span className="text-gray-500">{tr ? 'Tür:' : 'Type:'}</span>
                        <span className="font-bold text-gray-900">{tr ? DOC_TYPES.find(d => d.id === activeType)?.labelTr : DOC_TYPES.find(d => d.id === activeType)?.labelEn}</span>
                      </div>
                      <div className="flex justify-between items-center text-sm">
                        <span className="text-gray-500">{tr ? 'Başlık:' : 'Title:'}</span>
                        <span className="font-bold text-gray-900">{templates[activeType].title}</span>
                      </div>
                      <div className="flex justify-between items-center text-sm">
                        <span className="text-gray-500">{tr ? 'KDV Oranı:' : 'VAT Rate:'}</span>
                        <span className="font-bold text-gray-900">%{templates[activeType].vatRate}</span>
                      </div>
                    </div>
                  </div>

                  <hr className="border-gray-50" />

                  <div className="space-y-3">
                    <button 
                      onClick={() => window.print()}
                      className="w-full flex items-center justify-center gap-2 bg-[#1D1D1F] text-white py-4 rounded-2xl font-bold text-sm shadow-xl hover:bg-black transition-all active:scale-95"
                    >
                      <Receipt className="w-4 h-4" />
                      {tr ? 'Çıktı Al / Yazdır' : 'Get Output / Print'}
                    </button>
                    <p className="text-[10px] text-gray-400 text-center px-4 leading-relaxed">
                      {tr ? 'Not: Yazdırma işlemi sırasında tarayıcı ayarlarından "Arka Plan Grafikleri" seçeneğini aktif etmeyi unutmayın.' : 'Note: Don\'t forget to enable "Background Graphics" in the browser settings during the printing process.'}
                    </p>
                  </div>
                </div>

                <div className="bg-blue-50/50 p-5 rounded-2xl border border-blue-100 flex gap-3">
                  <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center text-blue-600 shrink-0">
                    <Edit2 className="w-4 h-4" />
                  </div>
                  <div>
                    <h5 className="text-xs font-bold text-blue-900 mb-1">{tr ? 'Tasarımı Düzenle' : 'Edit Design'}</h5>
                    <p className="text-[10px] text-blue-700/70 mb-2 leading-relaxed">{tr ? 'Bu şablonu beğenmediniz mi? Düzenlemek için editöre dönebilirsiniz.' : 'Don\'t like this template? You can return to the editor to edit it.'}</p>
                    <button 
                      onClick={() => setMainTab('design')}
                      className="text-[10px] font-black text-blue-600 hover:underline"
                    >
                      {tr ? 'DÜZENLE →' : 'EDIT →'}
                    </button>
                  </div>
                </div>
              </div>

              {/* Right: Print Preview Area */}
              <div className="lg:col-span-8 bg-gray-200/50 rounded-3xl p-8 border border-gray-100 shadow-inner overflow-y-auto max-h-[800px] print:p-0 print:bg-white print:max-h-none print:shadow-none print:border-none print:fixed print:inset-0 print:z-[300]">
                <DocumentPreview template={templates[activeType]} />
              </div>
            </div>
          )}
        </div>
      )}

      {/* CSS for print mode */}
      <style>{`
        @media print {
          body * { visibility: hidden; }
          .print-area, .print-area * { visibility: visible; }
          .print-area { position: absolute; left: 0; top: 0; width: 100%; }
        }
      `}</style>
      {/* Delete confirm modal */}
      <AnimatePresence>
        {deleteConfirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 z-[200] flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ scale: 0.95, y: 10 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 10 }}
              className="bg-white rounded-3xl p-6 w-full max-w-sm shadow-2xl"
            >
              <h3 className="font-bold text-gray-900 mb-2">{tr ? 'Şablonu Sil' : 'Delete Template'}</h3>
              <p className="text-sm text-gray-500 mb-5">
                {tr
                  ? `"${DOC_TYPES.find(d => d.id === deleteConfirm)?.labelTr}" şablonunu silmek istediğinize emin misiniz? Bu işlem geri alınamaz.`
                  : `Are you sure you want to delete the "${DOC_TYPES.find(d => d.id === deleteConfirm)?.labelEn}" template? This cannot be undone.`}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => handleDelete(deleteConfirm)}
                  className="flex-1 bg-red-500 hover:bg-red-600 text-white py-2.5 rounded-xl text-sm font-bold transition-colors"
                >
                  {tr ? 'Evet, Sil' : 'Yes, Delete'}
                </button>
                <button
                  onClick={() => setDeleteConfirm(null)}
                  className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 py-2.5 rounded-xl text-sm font-bold transition-colors"
                >
                  {tr ? 'İptal' : 'Cancel'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function DocumentPreview({ template }: { template: DocTemplate }) {
  const docType = DOC_TYPES.find(d => d.id === template.docType);
  const isQuote = template.docType === 'teklif';
  const isDelivery = template.docType === 'irsaliye';
  const isReceipt = template.docType === 'makbuz';

  const subtotal = 7500;
  const vat = subtotal * (template.vatRate / 100);
  const total = subtotal + vat;

  return (
    <div className="bg-white shadow-xl mx-auto w-full max-w-[720px] p-10 flex flex-col text-[13px]" style={{ minHeight: '1010px' }}>
      {/* Header bar */}
      <div className="h-1.5 w-full rounded-full mb-8" style={{ backgroundColor: template.color }} />

      {/* Header row */}
      <div className="flex justify-between items-start mb-10">
        <div
          className="w-28 h-10 bg-gray-100 rounded flex items-center justify-center text-[9px] font-bold text-gray-400 uppercase tracking-widest"
          style={{ borderLeft: `3px solid ${template.color}` }}
        >
          LOGO
        </div>
        <div className="text-right">
          <h1 className="text-xl font-black tracking-wide mb-1" style={{ color: template.color }}>
            {template.title}
          </h1>
          <p className="text-[10px] text-gray-400 font-bold">
            #{template.docType.toUpperCase()}-2026-0001
          </p>
          <p className="text-[10px] text-gray-400 mt-0.5">Tarih: 13.04.2026</p>
          {isQuote && <p className="text-[10px] text-gray-400">Geçerlilik: 27.04.2026</p>}
        </div>
      </div>

      {/* Info grid */}
      {!isReceipt && (
        <div className="grid grid-cols-2 gap-10 mb-10">
          <div>
            <h4 className="text-[9px] font-bold text-gray-400 uppercase tracking-widest mb-2" style={{ color: template.color }}>
              {isDelivery ? 'GÖNDEREN' : 'SATICI / FİRMA'}
            </h4>
            <p className="font-bold text-gray-900">CETPA LOJİSTİK VE TİCARET A.Ş.</p>
            <p className="text-[11px] text-gray-500 leading-relaxed mt-1">
              İkitelli OSB, İMSAN San. Sit. E Blok No:12<br />Başakşehir / İstanbul<br />
              VKN: 1234567890
            </p>
          </div>
          <div>
            <h4 className="text-[9px] font-bold text-gray-400 uppercase tracking-widest mb-2" style={{ color: template.color }}>
              {isDelivery ? 'ALICI / TESLİMAT' : isQuote ? 'TEKLİF VERİLEN' : 'ALICI / MÜŞTERİ'}
            </h4>
            <p className="font-bold text-gray-900">ÖRNEK MÜŞTERİ TİCARET LTD.</p>
            <p className="text-[11px] text-gray-500 leading-relaxed mt-1">
              Altınşehir Mah. Kelebek Sok. No:45<br />Ümraniye / İstanbul<br />
              VKN: 9876543210
            </p>
          </div>
        </div>
      )}

      {isReceipt && (
        <div className="mb-10 p-5 rounded-2xl bg-gray-50">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">TAHSİLAT BİLGİLERİ</p>
          <div className="grid grid-cols-2 gap-4 text-[11px]">
            <div><span className="text-gray-400">Müşteri:</span> <span className="font-bold">ÖRNEK MÜŞTERİ LTD.</span></div>
            <div><span className="text-gray-400">Tarih:</span> <span className="font-bold">13.04.2026</span></div>
            <div><span className="text-gray-400">Ödeme Tipi:</span> <span className="font-bold">Havale/EFT</span></div>
            <div><span className="text-gray-400">Referans:</span> <span className="font-bold">MKB-2026-0001</span></div>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="flex-1 mb-8">
        <table className="w-full text-[11px]">
          <thead>
            <tr style={{ borderBottom: `2px solid ${template.color}` }}>
              <th className="py-2.5 text-left font-bold text-gray-500 uppercase text-[9px] tracking-wider">Ürün / Hizmet</th>
              <th className="py-2.5 text-center font-bold text-gray-500 uppercase text-[9px] tracking-wider w-16">Adet</th>
              {!isDelivery && <th className="py-2.5 text-right font-bold text-gray-500 uppercase text-[9px] tracking-wider w-20">Birim Fiyat</th>}
              {!isDelivery && <th className="py-2.5 text-right font-bold text-gray-500 uppercase text-[9px] tracking-wider w-24">Toplam</th>}
              {isDelivery && <th className="py-2.5 text-left font-bold text-gray-500 uppercase text-[9px] tracking-wider">Lot/Seri No</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {[
              { name: 'Ürün A - Standart Model', desc: 'Ürün kod: SKU-001', qty: 2, price: 1250 },
              { name: 'Ürün B - Premium Model', desc: 'Ürün kod: SKU-002', qty: 3, price: 1500 },
              { name: 'Hizmet C - Kurulum', desc: 'Kurulum ve devreye alma', qty: 1, price: 2500 },
            ].map((item, i) => (
              <tr key={i}>
                <td className="py-3">
                  <p className="font-bold text-gray-900">{item.name}</p>
                  <p className="text-[10px] text-gray-400">{item.desc}</p>
                </td>
                <td className="py-3 text-center text-gray-700">{item.qty}</td>
                {!isDelivery && <td className="py-3 text-right text-gray-700">₺{item.price.toLocaleString('tr-TR')},00</td>}
                {!isDelivery && <td className="py-3 text-right font-bold text-gray-900">₺{(item.qty * item.price).toLocaleString('tr-TR')},00</td>}
                {isDelivery && <td className="py-3 text-gray-500 text-[10px]">LOT-2026-{String(i + 1).padStart(3, '0')}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Totals */}
      {!isDelivery && (
        <div className="flex justify-end mb-8">
          <div className="w-56 space-y-1.5 text-[11px]">
            <div className="flex justify-between">
              <span className="text-gray-400">Ara Toplam:</span>
              <span className="font-bold">₺{subtotal.toLocaleString('tr-TR')},00</span>
            </div>
            {template.vatRate > 0 && (
              <div className="flex justify-between">
                <span className="text-gray-400">KDV (%{template.vatRate}):</span>
                <span className="font-bold">₺{vat.toLocaleString('tr-TR', { maximumFractionDigits: 0 })},00</span>
              </div>
            )}
            <div
              className="flex justify-between p-2.5 rounded-xl text-white font-bold mt-2"
              style={{ backgroundColor: template.color }}
            >
              <span>TOPLAM:</span>
              <span>₺{total.toLocaleString('tr-TR', { maximumFractionDigits: 0 })},00</span>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="border-t border-gray-100 pt-6 mt-auto">
        <div className="grid grid-cols-2 gap-6 text-[10px]">
          <div>
            <h4 className="font-bold text-gray-400 uppercase text-[9px] tracking-wider mb-1">NOTLAR</h4>
            <p className="text-gray-500 leading-relaxed">{template.footer}</p>
          </div>
          {template.showBankDetails && (
            <div className="text-right">
              <h4 className="font-bold text-gray-400 uppercase text-[9px] tracking-wider mb-1">BANKA BİLGİLERİ</h4>
              <p className="text-gray-500 font-mono">{template.bankDetails}</p>
            </div>
          )}
        </div>
        <div className="h-1 rounded-full mt-6" style={{ backgroundColor: template.color, opacity: 0.3 }} />
      </div>
    </div>
  );
}
