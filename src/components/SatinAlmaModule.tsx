import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ShoppingBag, ClipboardList, FileText, Users,
  Plus, X, Search, Edit2, Trash2, CheckCircle,
  Clock, AlertTriangle, XCircle, Package, Building2,
  DollarSign, TrendingUp, ChevronDown
} from 'lucide-react';
import {
  collection, onSnapshot, addDoc, updateDoc, deleteDoc,
  doc, serverTimestamp, query, orderBy
} from 'firebase/firestore';
import { db } from '../firebase';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SatinAlmaTalep {
  id: string;
  talepNo: string;
  talepEden: string;
  urunHizmet: string;
  miktar: number;
  birim: string;
  aciklama: string;
  aciliyet: 'Normal' | 'Acil' | 'Kritik';
  durum: 'Bekliyor' | 'Onaylandı' | 'Reddedildi' | 'Sipariş Verildi';
  createdAt?: any;
}

interface SatinAlmaSiparisKalem {
  urun: string;
  miktar: number;
  birimFiyat: number;
  toplam: number;
}

interface SatinAlmaSiparis {
  id: string;
  poNo: string;
  tedarikci: string;
  kalemler: SatinAlmaSiparisKalem[];
  toplamTutar: number;
  paraBirimi: 'TRY' | 'USD' | 'EUR';
  durum: 'Taslak' | 'Gönderildi' | 'Onaylandı' | 'Teslim Alındı' | 'İptal';
  teslimatTarihi: string;
  notlar: string;
  createdAt?: any;
}

interface SatinAlmaTeklif {
  id: string;
  teklifNo: string;
  tedarikci: string;
  urun: string;
  miktar: number;
  teklifFiyati: number;
  paraBirimi: 'TRY' | 'USD' | 'EUR';
  gecerlilikTarihi: string;
  durum: 'Bekliyor' | 'Kabul' | 'Ret';
  notlar: string;
  createdAt?: any;
}

interface SatinAlmaTedarikci {
  id: string;
  ad: string;
  vergiNo: string;
  yetkiliAd: string;
  email: string;
  telefon: string;
  adres: string;
  odemeVadesi: number;
  toplamSiparisTutari: number;
  paraBirimi: 'TRY' | 'USD' | 'EUR';
  notlar: string;
  createdAt?: any;
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface SatinAlmaModuleProps {
  currentLanguage: string;
  isAuthenticated: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function genPoNo() {
  return `PO-2026-${String(Math.floor(1000 + Math.random() * 9000))}`;
}

function genRfqNo() {
  return `RFQ-2026-${String(Math.floor(1000 + Math.random() * 9000))}`;
}

function genTalepNo() {
  return `TR-${Date.now().toString().slice(-6)}`;
}

const CURRENCY_SYMBOLS: Record<string, string> = { TRY: '₺', USD: '$', EUR: '€' };

function fmtCurrency(amount: number, currency: string) {
  const sym = CURRENCY_SYMBOLS[currency] ?? currency;
  return `${sym}${amount.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  Bekliyor:         'bg-amber-100 text-amber-700',
  Onaylandı:        'bg-green-100 text-green-700',
  Reddedildi:       'bg-red-100 text-red-700',
  'Sipariş Verildi':'bg-blue-100 text-blue-700',
  Taslak:           'bg-gray-100 text-gray-600',
  Gönderildi:       'bg-blue-100 text-blue-700',
  'Teslim Alındı':  'bg-green-100 text-green-700',
  İptal:            'bg-red-100 text-red-700',
  Kabul:            'bg-green-100 text-green-700',
  Ret:              'bg-red-100 text-red-700',
};

function StatusBadge({ durum }: { durum: string }) {
  const cls = STATUS_COLORS[durum] ?? 'bg-gray-100 text-gray-600';
  return (
    <span className={`inline-flex items-center text-xs font-semibold px-2.5 py-0.5 rounded-full ${cls}`}>
      {durum}
    </span>
  );
}

function AciliyetBadge({ aciliyet }: { aciliyet: string }) {
  const map: Record<string, string> = {
    Normal:  'bg-gray-100 text-gray-600',
    Acil:    'bg-amber-100 text-amber-700',
    Kritik:  'bg-red-100 text-red-700',
  };
  return (
    <span className={`inline-flex items-center text-xs font-semibold px-2.5 py-0.5 rounded-full ${map[aciliyet] ?? 'bg-gray-100 text-gray-600'}`}>
      {aciliyet}
    </span>
  );
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="apple-card text-center"
    >
      <div className={`text-2xl font-bold ${color ?? 'text-gray-800'}`}>{value}</div>
      <div className="text-xs text-gray-500 mt-0.5 font-medium">{label}</div>
      {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
    </motion.div>
  );
}

// ─── Modal Wrapper ────────────────────────────────────────────────────────────

function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  if (!open) return null;
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)' }}
          onClick={e => { if (e.target === e.currentTarget) onClose(); }}
        >
          <motion.div
            key="modal-content"
            initial={{ opacity: 0, scale: 0.95, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 16 }}
            transition={{ type: 'spring', stiffness: 300, damping: 28 }}
            className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
              <h2 className="text-lg font-bold text-gray-900">{title}</h2>
              <button
                onClick={onClose}
                className="p-2 rounded-xl hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="px-6 py-5">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ─── Input helpers ────────────────────────────────────────────────────────────

const inputCls = 'apple-input text-sm w-full';
const labelCls = 'text-xs font-semibold text-gray-500 mb-1 block';
const fieldWrap = 'flex flex-col';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className={fieldWrap}>
      <label className={labelCls}>{label}</label>
      {children}
    </div>
  );
}

// ─── Tab bar ──────────────────────────────────────────────────────────────────

interface TabDef { key: string; labelTr: string; labelEn: string; icon: React.ReactNode }

const TABS: TabDef[] = [
  { key: 'talepler',    labelTr: 'Talepler',    labelEn: 'Requests',   icon: <ClipboardList className="w-4 h-4" /> },
  { key: 'siparisler',  labelTr: 'Siparişler',  labelEn: 'Orders',     icon: <ShoppingBag   className="w-4 h-4" /> },
  { key: 'teklifler',   labelTr: 'Teklifler',   labelEn: 'Quotes',     icon: <FileText      className="w-4 h-4" /> },
  { key: 'tedarikciler',labelTr: 'Tedarikçiler',labelEn: 'Suppliers',  icon: <Building2     className="w-4 h-4" /> },
];

// ═══════════════════════════════════════════════════════════════════════════════
// Main component
// ═══════════════════════════════════════════════════════════════════════════════

export default function SatinAlmaModule({ currentLanguage, isAuthenticated }: SatinAlmaModuleProps) {
  const tr = currentLanguage === 'tr';
  const [activeTab, setActiveTab] = useState<string>('talepler');

  // ── Collections state ──────────────────────────────────────────────────────
  const [talepler, setTalepler]         = useState<SatinAlmaTalep[]>([]);
  const [siparisler, setSiparisler]     = useState<SatinAlmaSiparis[]>([]);
  const [teklifler, setTeklifler]       = useState<SatinAlmaTeklif[]>([]);
  const [tedarikciler, setTedarikciler] = useState<SatinAlmaTedarikci[]>([]);

  // ── Search / filter ────────────────────────────────────────────────────────
  const [talepSearch,       setTalepSearch]       = useState('');
  const [siparisSearch,     setSiparisSearch]     = useState('');
  const [teklifSearch,      setTeklifSearch]      = useState('');
  const [tedarikciSearch,   setTedarikciSearch]   = useState('');
  const [talepDurumFilter,  setTalepDurumFilter]  = useState('Tümü');
  const [siparisDurumFilter,setSiparisDurumFilter]= useState('Tümü');
  const [teklifDurumFilter, setTeklifDurumFilter] = useState('Tümü');

  // ── Modal open states ──────────────────────────────────────────────────────
  const [showTalepModal,      setShowTalepModal]      = useState(false);
  const [showSiparisModal,    setShowSiparisModal]    = useState(false);
  const [showTeklifModal,     setShowTeklifModal]     = useState(false);
  const [showTedarikciModal,  setShowTedarikciModal]  = useState(false);

  // ── Edit targets ───────────────────────────────────────────────────────────
  const [editingTalep,      setEditingTalep]      = useState<SatinAlmaTalep | null>(null);
  const [editingSiparis,    setEditingSiparis]    = useState<SatinAlmaSiparis | null>(null);
  const [editingTeklif,     setEditingTeklif]     = useState<SatinAlmaTeklif | null>(null);
  const [editingTedarikci,  setEditingTedarikci]  = useState<SatinAlmaTedarikci | null>(null);

  // ── Form states ────────────────────────────────────────────────────────────
  const emptyTalep = {
    talepNo: '', talepEden: '', urunHizmet: '', miktar: 1, birim: 'Adet',
    aciklama: '', aciliyet: 'Normal' as SatinAlmaTalep['aciliyet'],
    durum: 'Bekliyor' as SatinAlmaTalep['durum'],
  };
  const emptySiparis = {
    poNo: '', tedarikci: '', kalemler: [] as SatinAlmaSiparisKalem[],
    toplamTutar: 0, paraBirimi: 'TRY' as SatinAlmaSiparis['paraBirimi'],
    durum: 'Taslak' as SatinAlmaSiparis['durum'],
    teslimatTarihi: new Date().toISOString().slice(0, 10), notlar: '',
  };
  const emptyTeklif = {
    teklifNo: '', tedarikci: '', urun: '', miktar: 1, teklifFiyati: 0,
    paraBirimi: 'TRY' as SatinAlmaTeklif['paraBirimi'],
    gecerlilikTarihi: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
    durum: 'Bekliyor' as SatinAlmaTeklif['durum'], notlar: '',
  };
  const emptyTedarikci = {
    ad: '', vergiNo: '', yetkiliAd: '', email: '', telefon: '', adres: '',
    odemeVadesi: 30, toplamSiparisTutari: 0,
    paraBirimi: 'TRY' as SatinAlmaTedarikci['paraBirimi'], notlar: '',
  };

  const [talepForm,      setTalepForm]      = useState({ ...emptyTalep });
  const [siparisForm,    setSiparisForm]    = useState({ ...emptySiparis });
  const [teklifForm,     setTeklifForm]     = useState({ ...emptyTeklif });
  const [tedarikciForm,  setTedarikciForm]  = useState({ ...emptyTedarikci });

  // Sipariş kalem editing
  const [siparisKalem, setSiparisKalem] = useState<SatinAlmaSiparisKalem>({ urun: '', miktar: 1, birimFiyat: 0, toplam: 0 });

  // ── Firestore subscriptions ────────────────────────────────────────────────
  useEffect(() => {
    if (!isAuthenticated) return;
    const unsubs = [
      onSnapshot(query(collection(db, 'satinAlmaTalepleri'), orderBy('createdAt', 'desc')), snap =>
        setTalepler(snap.docs.map(d => ({ id: d.id, ...d.data() } as SatinAlmaTalep)))),
      onSnapshot(query(collection(db, 'satinAlmaSiparisleri'), orderBy('createdAt', 'desc')), snap =>
        setSiparisler(snap.docs.map(d => ({ id: d.id, ...d.data() } as SatinAlmaSiparis)))),
      onSnapshot(query(collection(db, 'satinAlmaTeklifleri'), orderBy('createdAt', 'desc')), snap =>
        setTeklifler(snap.docs.map(d => ({ id: d.id, ...d.data() } as SatinAlmaTeklif)))),
      onSnapshot(query(collection(db, 'satinAlmaTedarikci'), orderBy('createdAt', 'desc')), snap =>
        setTedarikciler(snap.docs.map(d => ({ id: d.id, ...d.data() } as SatinAlmaTedarikci)))),
    ];
    return () => unsubs.forEach(u => u());
  }, [isAuthenticated]);

  // ── CRUD: Talepler ─────────────────────────────────────────────────────────
  async function saveTalep() {
    if (!talepForm.talepEden || !talepForm.urunHizmet) return;
    const data = {
      ...talepForm,
      talepNo: talepForm.talepNo || genTalepNo(),
      updatedAt: serverTimestamp(),
    };
    if (editingTalep) {
      await updateDoc(doc(db, 'satinAlmaTalepleri', editingTalep.id), data);
    } else {
      await addDoc(collection(db, 'satinAlmaTalepleri'), { ...data, createdAt: serverTimestamp() });
    }
    setShowTalepModal(false);
    setEditingTalep(null);
    setTalepForm({ ...emptyTalep });
  }

  async function deleteTalep(id: string) {
    if (!confirm(tr ? 'Talep silinsin mi?' : 'Delete this request?')) return;
    await deleteDoc(doc(db, 'satinAlmaTalepleri', id));
  }

  // ── CRUD: Siparişler ───────────────────────────────────────────────────────
  function addKalem() {
    if (!siparisKalem.urun || siparisKalem.miktar <= 0) return;
    const kalem = { ...siparisKalem, toplam: siparisKalem.miktar * siparisKalem.birimFiyat };
    const kalemler = [...siparisForm.kalemler, kalem];
    const toplamTutar = kalemler.reduce((s, k) => s + k.toplam, 0);
    setSiparisForm(prev => ({ ...prev, kalemler, toplamTutar }));
    setSiparisKalem({ urun: '', miktar: 1, birimFiyat: 0, toplam: 0 });
  }

  function removeKalem(idx: number) {
    const kalemler = siparisForm.kalemler.filter((_, i) => i !== idx);
    const toplamTutar = kalemler.reduce((s, k) => s + k.toplam, 0);
    setSiparisForm(prev => ({ ...prev, kalemler, toplamTutar }));
  }

  async function saveSiparis() {
    if (!siparisForm.tedarikci) return;
    const data = {
      ...siparisForm,
      poNo: siparisForm.poNo || genPoNo(),
      updatedAt: serverTimestamp(),
    };
    if (editingSiparis) {
      await updateDoc(doc(db, 'satinAlmaSiparisleri', editingSiparis.id), data);
    } else {
      await addDoc(collection(db, 'satinAlmaSiparisleri'), { ...data, createdAt: serverTimestamp() });
    }
    setShowSiparisModal(false);
    setEditingSiparis(null);
    setSiparisForm({ ...emptySiparis });
    setSiparisKalem({ urun: '', miktar: 1, birimFiyat: 0, toplam: 0 });
  }

  async function deleteSiparis(id: string) {
    if (!confirm(tr ? 'Sipariş silinsin mi?' : 'Delete this order?')) return;
    await deleteDoc(doc(db, 'satinAlmaSiparisleri', id));
  }

  // ── CRUD: Teklifler ────────────────────────────────────────────────────────
  async function saveTeklif() {
    if (!teklifForm.tedarikci || !teklifForm.urun) return;
    const data = {
      ...teklifForm,
      teklifNo: teklifForm.teklifNo || genRfqNo(),
      updatedAt: serverTimestamp(),
    };
    if (editingTeklif) {
      await updateDoc(doc(db, 'satinAlmaTeklifleri', editingTeklif.id), data);
    } else {
      await addDoc(collection(db, 'satinAlmaTeklifleri'), { ...data, createdAt: serverTimestamp() });
    }
    setShowTeklifModal(false);
    setEditingTeklif(null);
    setTeklifForm({ ...emptyTeklif });
  }

  async function deleteTeklif(id: string) {
    if (!confirm(tr ? 'Teklif silinsin mi?' : 'Delete this quote?')) return;
    await deleteDoc(doc(db, 'satinAlmaTeklifleri', id));
  }

  // ── CRUD: Tedarikçiler ─────────────────────────────────────────────────────
  async function saveTedarikci() {
    if (!tedarikciForm.ad) return;
    const data = { ...tedarikciForm, updatedAt: serverTimestamp() };
    if (editingTedarikci) {
      await updateDoc(doc(db, 'satinAlmaTedarikci', editingTedarikci.id), data);
    } else {
      await addDoc(collection(db, 'satinAlmaTedarikci'), { ...data, createdAt: serverTimestamp() });
    }
    setShowTedarikciModal(false);
    setEditingTedarikci(null);
    setTedarikciForm({ ...emptyTedarikci });
  }

  async function deleteTedarikci(id: string) {
    if (!confirm(tr ? 'Tedarikçi silinsin mi?' : 'Delete this supplier?')) return;
    await deleteDoc(doc(db, 'satinAlmaTedarikci', id));
  }

  // ── Filtered lists ─────────────────────────────────────────────────────────
  const filteredTalepler = talepler
    .filter(t => talepDurumFilter === 'Tümü' || t.durum === talepDurumFilter)
    .filter(t => !talepSearch || t.talepEden.toLowerCase().includes(talepSearch.toLowerCase()) || t.urunHizmet.toLowerCase().includes(talepSearch.toLowerCase()) || t.talepNo.toLowerCase().includes(talepSearch.toLowerCase()));

  const filteredSiparisler = siparisler
    .filter(s => siparisDurumFilter === 'Tümü' || s.durum === siparisDurumFilter)
    .filter(s => !siparisSearch || s.tedarikci.toLowerCase().includes(siparisSearch.toLowerCase()) || s.poNo.toLowerCase().includes(siparisSearch.toLowerCase()));

  const filteredTeklifler = teklifler
    .filter(t => teklifDurumFilter === 'Tümü' || t.durum === teklifDurumFilter)
    .filter(t => !teklifSearch || t.tedarikci.toLowerCase().includes(teklifSearch.toLowerCase()) || t.urun.toLowerCase().includes(teklifSearch.toLowerCase()) || t.teklifNo.toLowerCase().includes(teklifSearch.toLowerCase()));

  const filteredTedarikciler = tedarikciler
    .filter(t => !tedarikciSearch || t.ad.toLowerCase().includes(tedarikciSearch.toLowerCase()) || t.vergiNo.includes(tedarikciSearch));

  // ── KPIs ───────────────────────────────────────────────────────────────────
  const talepKpis = {
    toplam:       talepler.length,
    bekliyor:     talepler.filter(t => t.durum === 'Bekliyor').length,
    onaylandi:    talepler.filter(t => t.durum === 'Onaylandı').length,
    acil:         talepler.filter(t => t.aciliyet !== 'Normal').length,
  };

  const siparisKpis = {
    toplam:       siparisler.length,
    acik:         siparisler.filter(s => !['Teslim Alındı', 'İptal'].includes(s.durum)).length,
    teslimAlindi: siparisler.filter(s => s.durum === 'Teslim Alındı').length,
    toplamTutar:  siparisler.reduce((s, o) => s + (o.toplamTutar ?? 0), 0),
  };

  const teklifKpis = {
    toplam:    teklifler.length,
    bekliyor:  teklifler.filter(t => t.durum === 'Bekliyor').length,
    kabul:     teklifler.filter(t => t.durum === 'Kabul').length,
    ret:       teklifler.filter(t => t.durum === 'Ret').length,
  };

  const tedarikciKpis = {
    toplam:     tedarikciler.length,
    toplamCiro: tedarikciler.reduce((s, t) => s + (t.toplamSiparisTutari ?? 0), 0),
  };

  // ══════════════════════════════════════════════════════════════════════════
  // Render
  // ══════════════════════════════════════════════════════════════════════════
  return (
    <div className="space-y-6">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-2xl bg-brand/10 flex items-center justify-center">
          <ShoppingBag className="w-5 h-5 text-brand" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900">
            {tr ? 'Satın Alma Yönetimi' : 'Procurement Management'}
          </h1>
          <p className="text-xs text-gray-400">
            {tr ? 'Talepler · Siparişler · Teklifler · Tedarikçiler' : 'Requests · Orders · Quotes · Suppliers'}
          </p>
        </div>
      </div>

      {/* ── Tabs ───────────────────────────────────────────────────────────── */}
      <div className="flex gap-1 bg-gray-100 rounded-2xl p-1 w-fit flex-wrap">
        {TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-xl transition-all ${
              activeTab === tab.key
                ? 'bg-white shadow-sm text-gray-900'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.icon}
            {tr ? tab.labelTr : tab.labelEn}
          </button>
        ))}
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          TAB: TALEPLER
      ══════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'talepler' && (
        <motion.div key="talepler" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">

          {/* KPIs */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <KpiCard label={tr ? 'Toplam Talep' : 'Total Requests'}  value={talepKpis.toplam}    color="text-gray-800" />
            <KpiCard label={tr ? 'Bekliyor'     : 'Pending'}         value={talepKpis.bekliyor}   color="text-amber-600" />
            <KpiCard label={tr ? 'Onaylandı'    : 'Approved'}        value={talepKpis.onaylandi}  color="text-green-600" />
            <KpiCard label={tr ? 'Acil / Kritik': 'Urgent / Critical'} value={talepKpis.acil}    color="text-red-600" />
          </div>

          {/* Table card */}
          <div className="apple-card p-0 overflow-hidden">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 px-6 py-4 border-b border-gray-100">
              <div className="flex items-center gap-2 flex-1 flex-wrap">
                {/* Search */}
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    className={`${inputCls} pl-9 w-48`}
                    placeholder={tr ? 'Ara…' : 'Search…'}
                    value={talepSearch}
                    onChange={e => setTalepSearch(e.target.value)}
                  />
                </div>
                {/* Durum filter */}
                <div className="relative">
                  <select
                    className={`${inputCls} pr-8 appearance-none`}
                    value={talepDurumFilter}
                    onChange={e => setTalepDurumFilter(e.target.value)}
                  >
                    {['Tümü', 'Bekliyor', 'Onaylandı', 'Reddedildi', 'Sipariş Verildi'].map(d => (
                      <option key={d}>{d}</option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
                </div>
              </div>
              <button
                onClick={() => { setEditingTalep(null); setTalepForm({ ...emptyTalep }); setShowTalepModal(true); }}
                className="apple-button-primary text-sm flex items-center gap-1.5 shrink-0"
              >
                <Plus className="w-4 h-4" />
                {tr ? 'Talep Ekle' : 'New Request'}
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-left">
                    {[
                      tr ? 'Talep No'   : 'Request No',
                      tr ? 'Talep Eden' : 'Requester',
                      tr ? 'Ürün/Hizmet': 'Product/Service',
                      tr ? 'Miktar'     : 'Qty',
                      tr ? 'Aciliyet'   : 'Priority',
                      tr ? 'Durum'      : 'Status',
                      '',
                    ].map(h => (
                      <th key={h} className="px-4 py-3 text-xs font-semibold text-gray-500 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filteredTalepler.map(t => (
                    <tr key={t.id} className="hover:bg-gray-50/50 transition-colors">
                      <td className="px-4 py-3 font-mono text-xs text-gray-500">{t.talepNo}</td>
                      <td className="px-4 py-3 font-medium text-gray-800">{t.talepEden}</td>
                      <td className="px-4 py-3 text-gray-600 max-w-[180px] truncate">{t.urunHizmet}</td>
                      <td className="px-4 py-3 text-gray-600">{t.miktar} {t.birim}</td>
                      <td className="px-4 py-3"><AciliyetBadge aciliyet={t.aciliyet} /></td>
                      <td className="px-4 py-3"><StatusBadge durum={t.durum} /></td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1">
                          <button
                            onClick={() => { setEditingTalep(t); setTalepForm({ talepNo: t.talepNo, talepEden: t.talepEden, urunHizmet: t.urunHizmet, miktar: t.miktar, birim: t.birim, aciklama: t.aciklama, aciliyet: t.aciliyet, durum: t.durum }); setShowTalepModal(true); }}
                            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => deleteTalep(t.id)}
                            className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {filteredTalepler.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-12 text-center text-gray-400 text-sm">
                        {tr ? 'Talep bulunamadı' : 'No requests found'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </motion.div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          TAB: SİPARİŞLER
      ══════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'siparisler' && (
        <motion.div key="siparisler" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">

          {/* KPIs */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <KpiCard label={tr ? 'Toplam Sipariş' : 'Total Orders'}       value={siparisKpis.toplam}        color="text-gray-800" />
            <KpiCard label={tr ? 'Açık Sipariş'   : 'Open Orders'}        value={siparisKpis.acik}          color="text-blue-600" />
            <KpiCard label={tr ? 'Teslim Alındı'  : 'Received'}           value={siparisKpis.teslimAlindi}  color="text-green-600" />
            <KpiCard label={tr ? 'Toplam Tutar'   : 'Total Amount'}       value={`₺${siparisKpis.toplamTutar.toLocaleString('tr-TR')}`} color="text-brand" />
          </div>

          <div className="apple-card p-0 overflow-hidden">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 px-6 py-4 border-b border-gray-100">
              <div className="flex items-center gap-2 flex-wrap">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    className={`${inputCls} pl-9 w-48`}
                    placeholder={tr ? 'PO / Tedarikçi…' : 'PO / Supplier…'}
                    value={siparisSearch}
                    onChange={e => setSiparisSearch(e.target.value)}
                  />
                </div>
                <div className="relative">
                  <select
                    className={`${inputCls} pr-8 appearance-none`}
                    value={siparisDurumFilter}
                    onChange={e => setSiparisDurumFilter(e.target.value)}
                  >
                    {['Tümü', 'Taslak', 'Gönderildi', 'Onaylandı', 'Teslim Alındı', 'İptal'].map(d => (
                      <option key={d}>{d}</option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
                </div>
              </div>
              <button
                onClick={() => { setEditingSiparis(null); setSiparisForm({ ...emptySiparis, poNo: genPoNo() }); setSiparisKalem({ urun: '', miktar: 1, birimFiyat: 0, toplam: 0 }); setShowSiparisModal(true); }}
                className="apple-button-primary text-sm flex items-center gap-1.5 shrink-0"
              >
                <Plus className="w-4 h-4" />
                {tr ? 'Sipariş Oluştur' : 'New Order'}
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-left">
                    {[
                      tr ? 'PO No'        : 'PO No',
                      tr ? 'Tedarikçi'    : 'Supplier',
                      tr ? 'Kalem Sayısı' : 'Items',
                      tr ? 'Toplam'       : 'Total',
                      tr ? 'Para Birimi'  : 'Currency',
                      tr ? 'Teslim Tarihi': 'Delivery Date',
                      tr ? 'Durum'        : 'Status',
                      '',
                    ].map(h => (
                      <th key={h} className="px-4 py-3 text-xs font-semibold text-gray-500 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filteredSiparisler.map(s => (
                    <tr key={s.id} className="hover:bg-gray-50/50 transition-colors">
                      <td className="px-4 py-3 font-mono text-xs text-blue-600 font-semibold">{s.poNo}</td>
                      <td className="px-4 py-3 font-medium text-gray-800">{s.tedarikci}</td>
                      <td className="px-4 py-3 text-gray-600 text-center">{s.kalemler?.length ?? 0}</td>
                      <td className="px-4 py-3 font-semibold text-gray-800">{fmtCurrency(s.toplamTutar ?? 0, s.paraBirimi)}</td>
                      <td className="px-4 py-3 text-gray-500">{s.paraBirimi}</td>
                      <td className="px-4 py-3 text-gray-500">{s.teslimatTarihi || '—'}</td>
                      <td className="px-4 py-3"><StatusBadge durum={s.durum} /></td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1">
                          <button
                            onClick={() => { setEditingSiparis(s); setSiparisForm({ poNo: s.poNo, tedarikci: s.tedarikci, kalemler: s.kalemler ?? [], toplamTutar: s.toplamTutar ?? 0, paraBirimi: s.paraBirimi, durum: s.durum, teslimatTarihi: s.teslimatTarihi, notlar: s.notlar }); setShowSiparisModal(true); }}
                            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => deleteSiparis(s.id)}
                            className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {filteredSiparisler.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-4 py-12 text-center text-gray-400 text-sm">
                        {tr ? 'Sipariş bulunamadı' : 'No orders found'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </motion.div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          TAB: TEKLİFLER
      ══════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'teklifler' && (
        <motion.div key="teklifler" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">

          {/* KPIs */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <KpiCard label={tr ? 'Toplam Teklif' : 'Total Quotes'}   value={teklifKpis.toplam}   color="text-gray-800" />
            <KpiCard label={tr ? 'Bekliyor'      : 'Pending'}        value={teklifKpis.bekliyor} color="text-amber-600" />
            <KpiCard label={tr ? 'Kabul Edildi'  : 'Accepted'}       value={teklifKpis.kabul}    color="text-green-600" />
            <KpiCard label={tr ? 'Reddedildi'    : 'Rejected'}       value={teklifKpis.ret}      color="text-red-600" />
          </div>

          <div className="apple-card p-0 overflow-hidden">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 px-6 py-4 border-b border-gray-100">
              <div className="flex items-center gap-2 flex-wrap">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    className={`${inputCls} pl-9 w-48`}
                    placeholder={tr ? 'Ara…' : 'Search…'}
                    value={teklifSearch}
                    onChange={e => setTeklifSearch(e.target.value)}
                  />
                </div>
                <div className="relative">
                  <select
                    className={`${inputCls} pr-8 appearance-none`}
                    value={teklifDurumFilter}
                    onChange={e => setTeklifDurumFilter(e.target.value)}
                  >
                    {['Tümü', 'Bekliyor', 'Kabul', 'Ret'].map(d => (
                      <option key={d}>{d}</option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
                </div>
              </div>
              <button
                onClick={() => { setEditingTeklif(null); setTeklifForm({ ...emptyTeklif, teklifNo: genRfqNo() }); setShowTeklifModal(true); }}
                className="apple-button-primary text-sm flex items-center gap-1.5 shrink-0"
              >
                <Plus className="w-4 h-4" />
                {tr ? 'Teklif Ekle' : 'New Quote'}
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-left">
                    {[
                      tr ? 'Teklif No'       : 'RFQ No',
                      tr ? 'Tedarikçi'       : 'Supplier',
                      tr ? 'Ürün'            : 'Product',
                      tr ? 'Miktar'          : 'Qty',
                      tr ? 'Teklif Fiyatı'   : 'Quoted Price',
                      tr ? 'Geçerlilik'      : 'Valid Until',
                      tr ? 'Durum'           : 'Status',
                      '',
                    ].map(h => (
                      <th key={h} className="px-4 py-3 text-xs font-semibold text-gray-500 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filteredTeklifler.map(t => (
                    <tr key={t.id} className="hover:bg-gray-50/50 transition-colors">
                      <td className="px-4 py-3 font-mono text-xs text-purple-600 font-semibold">{t.teklifNo}</td>
                      <td className="px-4 py-3 font-medium text-gray-800">{t.tedarikci}</td>
                      <td className="px-4 py-3 text-gray-600 max-w-[160px] truncate">{t.urun}</td>
                      <td className="px-4 py-3 text-gray-600">{t.miktar}</td>
                      <td className="px-4 py-3 font-semibold text-gray-800">{fmtCurrency(t.teklifFiyati ?? 0, t.paraBirimi)}</td>
                      <td className="px-4 py-3 text-gray-500">{t.gecerlilikTarihi || '—'}</td>
                      <td className="px-4 py-3"><StatusBadge durum={t.durum} /></td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1">
                          <button
                            onClick={() => { setEditingTeklif(t); setTeklifForm({ teklifNo: t.teklifNo, tedarikci: t.tedarikci, urun: t.urun, miktar: t.miktar, teklifFiyati: t.teklifFiyati, paraBirimi: t.paraBirimi, gecerlilikTarihi: t.gecerlilikTarihi, durum: t.durum, notlar: t.notlar }); setShowTeklifModal(true); }}
                            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => deleteTeklif(t.id)}
                            className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {filteredTeklifler.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-4 py-12 text-center text-gray-400 text-sm">
                        {tr ? 'Teklif bulunamadı' : 'No quotes found'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </motion.div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          TAB: TEDARİKÇİLER
      ══════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'tedarikciler' && (
        <motion.div key="tedarikciler" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">

          {/* KPIs */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <KpiCard label={tr ? 'Toplam Tedarikçi' : 'Total Suppliers'}  value={tedarikciKpis.toplam}                                       color="text-gray-800" />
            <KpiCard label={tr ? 'Aktif Sipariş'    : 'Active Orders'}    value={siparisler.filter(s => s.durum !== 'İptal').length}           color="text-blue-600" />
            <KpiCard label={tr ? 'Toplam Ciro'      : 'Total Volume'}     value={`₺${tedarikciKpis.toplamCiro.toLocaleString('tr-TR')}`}       color="text-brand" />
          </div>

          <div className="apple-card p-0 overflow-hidden">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 px-6 py-4 border-b border-gray-100">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  className={`${inputCls} pl-9 w-56`}
                  placeholder={tr ? 'Ad veya Vergi No…' : 'Name or Tax ID…'}
                  value={tedarikciSearch}
                  onChange={e => setTedarikciSearch(e.target.value)}
                />
              </div>
              <button
                onClick={() => { setEditingTedarikci(null); setTedarikciForm({ ...emptyTedarikci }); setShowTedarikciModal(true); }}
                className="apple-button-primary text-sm flex items-center gap-1.5 shrink-0"
              >
                <Plus className="w-4 h-4" />
                {tr ? 'Tedarikçi Ekle' : 'Add Supplier'}
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-left">
                    {[
                      tr ? 'Tedarikçi Adı' : 'Supplier Name',
                      tr ? 'Vergi No'      : 'Tax ID',
                      tr ? 'Yetkili'       : 'Contact',
                      tr ? 'E-posta'       : 'Email',
                      tr ? 'Ödeme Vadesi'  : 'Payment Terms',
                      tr ? 'Toplam Ciro'   : 'Total Volume',
                      '',
                    ].map(h => (
                      <th key={h} className="px-4 py-3 text-xs font-semibold text-gray-500 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filteredTedarikciler.map(t => (
                    <tr key={t.id} className="hover:bg-gray-50/50 transition-colors">
                      <td className="px-4 py-3 font-semibold text-gray-800">{t.ad}</td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-500">{t.vergiNo || '—'}</td>
                      <td className="px-4 py-3 text-gray-600">{t.yetkiliAd || '—'}</td>
                      <td className="px-4 py-3 text-gray-500">{t.email || '—'}</td>
                      <td className="px-4 py-3 text-gray-600">{t.odemeVadesi} {tr ? 'gün' : 'days'}</td>
                      <td className="px-4 py-3 font-semibold text-gray-800">{fmtCurrency(t.toplamSiparisTutari ?? 0, t.paraBirimi)}</td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1">
                          <button
                            onClick={() => { setEditingTedarikci(t); setTedarikciForm({ ad: t.ad, vergiNo: t.vergiNo, yetkiliAd: t.yetkiliAd, email: t.email, telefon: t.telefon, adres: t.adres, odemeVadesi: t.odemeVadesi, toplamSiparisTutari: t.toplamSiparisTutari, paraBirimi: t.paraBirimi, notlar: t.notlar }); setShowTedarikciModal(true); }}
                            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => deleteTedarikci(t.id)}
                            className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {filteredTedarikciler.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-12 text-center text-gray-400 text-sm">
                        {tr ? 'Tedarikçi bulunamadı' : 'No suppliers found'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </motion.div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          MODAL: TALEP EKLE / DÜZENLE
      ══════════════════════════════════════════════════════════════════════ */}
      <Modal
        open={showTalepModal}
        onClose={() => { setShowTalepModal(false); setEditingTalep(null); setTalepForm({ ...emptyTalep }); }}
        title={editingTalep ? (tr ? 'Talebi Düzenle' : 'Edit Request') : (tr ? 'Yeni Satın Alma Talebi' : 'New Purchase Request')}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label={tr ? 'Talep Eden *' : 'Requester *'}>
            <input
              className={inputCls}
              value={talepForm.talepEden}
              onChange={e => setTalepForm(p => ({ ...p, talepEden: e.target.value }))}
              placeholder={tr ? 'Ad Soyad' : 'Full Name'}
            />
          </Field>
          <Field label={tr ? 'Ürün / Hizmet *' : 'Product / Service *'}>
            <input
              className={inputCls}
              value={talepForm.urunHizmet}
              onChange={e => setTalepForm(p => ({ ...p, urunHizmet: e.target.value }))}
              placeholder={tr ? 'Ürün veya hizmet adı' : 'Item or service name'}
            />
          </Field>
          <Field label={tr ? 'Miktar *' : 'Quantity *'}>
            <input
              type="number"
              min={1}
              className={inputCls}
              value={talepForm.miktar}
              onChange={e => setTalepForm(p => ({ ...p, miktar: Number(e.target.value) }))}
            />
          </Field>
          <Field label={tr ? 'Birim' : 'Unit'}>
            <input
              className={inputCls}
              value={talepForm.birim}
              onChange={e => setTalepForm(p => ({ ...p, birim: e.target.value }))}
              placeholder="Adet, kg, lt…"
            />
          </Field>
          <Field label={tr ? 'Aciliyet' : 'Priority'}>
            <div className="relative">
              <select
                className={`${inputCls} pr-8 appearance-none`}
                value={talepForm.aciliyet}
                onChange={e => setTalepForm(p => ({ ...p, aciliyet: e.target.value as SatinAlmaTalep['aciliyet'] }))}
              >
                {(['Normal', 'Acil', 'Kritik'] as const).map(v => (
                  <option key={v}>{v}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
            </div>
          </Field>
          <Field label={tr ? 'Durum' : 'Status'}>
            <div className="relative">
              <select
                className={`${inputCls} pr-8 appearance-none`}
                value={talepForm.durum}
                onChange={e => setTalepForm(p => ({ ...p, durum: e.target.value as SatinAlmaTalep['durum'] }))}
              >
                {(['Bekliyor', 'Onaylandı', 'Reddedildi', 'Sipariş Verildi'] as const).map(v => (
                  <option key={v}>{v}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
            </div>
          </Field>
          <div className="sm:col-span-2">
            <Field label={tr ? 'Açıklama' : 'Description'}>
              <textarea
                className={`${inputCls} resize-none`}
                rows={3}
                value={talepForm.aciklama}
                onChange={e => setTalepForm(p => ({ ...p, aciklama: e.target.value }))}
                placeholder={tr ? 'Gereksinim detayları…' : 'Requirement details…'}
              />
            </Field>
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <button
            onClick={() => { setShowTalepModal(false); setEditingTalep(null); setTalepForm({ ...emptyTalep }); }}
            className="apple-button-secondary text-sm"
          >
            {tr ? 'İptal' : 'Cancel'}
          </button>
          <button onClick={saveTalep} className="apple-button-primary text-sm">
            {editingTalep ? (tr ? 'Güncelle' : 'Update') : (tr ? 'Talep Oluştur' : 'Create Request')}
          </button>
        </div>
      </Modal>

      {/* ══════════════════════════════════════════════════════════════════════
          MODAL: SİPARİŞ EKLE / DÜZENLE
      ══════════════════════════════════════════════════════════════════════ */}
      <Modal
        open={showSiparisModal}
        onClose={() => { setShowSiparisModal(false); setEditingSiparis(null); setSiparisForm({ ...emptySiparis }); }}
        title={editingSiparis ? (tr ? 'Siparişi Düzenle' : 'Edit Order') : (tr ? 'Yeni Satın Alma Siparişi' : 'New Purchase Order')}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label={tr ? 'PO Numarası' : 'PO Number'}>
              <input
                className={`${inputCls} font-mono`}
                value={siparisForm.poNo}
                onChange={e => setSiparisForm(p => ({ ...p, poNo: e.target.value }))}
                placeholder="PO-2026-xxxx"
              />
            </Field>
            <Field label={tr ? 'Tedarikçi *' : 'Supplier *'}>
              <div className="relative">
                <select
                  className={`${inputCls} pr-8 appearance-none`}
                  value={siparisForm.tedarikci}
                  onChange={e => setSiparisForm(p => ({ ...p, tedarikci: e.target.value }))}
                >
                  <option value="">{tr ? '— Seçiniz —' : '— Select —'}</option>
                  {tedarikciler.map(t => (
                    <option key={t.id} value={t.ad}>{t.ad}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
              </div>
            </Field>
            <Field label={tr ? 'Para Birimi' : 'Currency'}>
              <div className="relative">
                <select
                  className={`${inputCls} pr-8 appearance-none`}
                  value={siparisForm.paraBirimi}
                  onChange={e => setSiparisForm(p => ({ ...p, paraBirimi: e.target.value as SatinAlmaSiparis['paraBirimi'] }))}
                >
                  {(['TRY', 'USD', 'EUR'] as const).map(c => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
              </div>
            </Field>
            <Field label={tr ? 'Teslim Tarihi' : 'Delivery Date'}>
              <input
                type="date"
                className={inputCls}
                value={siparisForm.teslimatTarihi}
                onChange={e => setSiparisForm(p => ({ ...p, teslimatTarihi: e.target.value }))}
              />
            </Field>
            <Field label={tr ? 'Durum' : 'Status'}>
              <div className="relative">
                <select
                  className={`${inputCls} pr-8 appearance-none`}
                  value={siparisForm.durum}
                  onChange={e => setSiparisForm(p => ({ ...p, durum: e.target.value as SatinAlmaSiparis['durum'] }))}
                >
                  {(['Taslak', 'Gönderildi', 'Onaylandı', 'Teslim Alındı', 'İptal'] as const).map(v => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
              </div>
            </Field>
            <div className="sm:col-span-2">
              <Field label={tr ? 'Notlar' : 'Notes'}>
                <textarea
                  className={`${inputCls} resize-none`}
                  rows={2}
                  value={siparisForm.notlar}
                  onChange={e => setSiparisForm(p => ({ ...p, notlar: e.target.value }))}
                />
              </Field>
            </div>
          </div>

          {/* Kalem ekle */}
          <div className="border border-gray-100 rounded-2xl p-4 space-y-3">
            <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
              <Package className="w-4 h-4 text-gray-400" />
              {tr ? 'Sipariş Kalemleri' : 'Order Line Items'}
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div className="sm:col-span-2">
                <input
                  className={`${inputCls} text-xs`}
                  placeholder={tr ? 'Ürün adı' : 'Product name'}
                  value={siparisKalem.urun}
                  onChange={e => setSiparisKalem(p => ({ ...p, urun: e.target.value }))}
                />
              </div>
              <input
                type="number"
                min={1}
                className={`${inputCls} text-xs`}
                placeholder={tr ? 'Miktar' : 'Qty'}
                value={siparisKalem.miktar || ''}
                onChange={e => setSiparisKalem(p => ({ ...p, miktar: Number(e.target.value) }))}
              />
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">
                  {CURRENCY_SYMBOLS[siparisForm.paraBirimi]}
                </span>
                <input
                  type="number"
                  min={0}
                  className={`${inputCls} text-xs pl-6`}
                  placeholder={tr ? 'Birim fiyat' : 'Unit price'}
                  value={siparisKalem.birimFiyat || ''}
                  onChange={e => setSiparisKalem(p => ({ ...p, birimFiyat: Number(e.target.value) }))}
                />
              </div>
            </div>
            <button
              onClick={addKalem}
              className="apple-button-secondary text-xs flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              {tr ? 'Kalem Ekle' : 'Add Line'}
            </button>

            {siparisForm.kalemler.length > 0 && (
              <div className="space-y-1 mt-2">
                {siparisForm.kalemler.map((k, i) => (
                  <div key={i} className="flex items-center justify-between bg-gray-50 rounded-xl px-3 py-2 text-xs">
                    <span className="font-medium text-gray-700 flex-1 truncate">{k.urun}</span>
                    <span className="text-gray-500 mx-2">{k.miktar} × {fmtCurrency(k.birimFiyat, siparisForm.paraBirimi)}</span>
                    <span className="font-semibold text-gray-800 mr-2">{fmtCurrency(k.toplam, siparisForm.paraBirimi)}</span>
                    <button onClick={() => removeKalem(i)} className="text-red-400 hover:text-red-600">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
                <div className="flex justify-end pt-1">
                  <span className="text-sm font-bold text-gray-800">
                    {tr ? 'Toplam: ' : 'Total: '}
                    {fmtCurrency(siparisForm.toplamTutar, siparisForm.paraBirimi)}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button
            onClick={() => { setShowSiparisModal(false); setEditingSiparis(null); setSiparisForm({ ...emptySiparis }); }}
            className="apple-button-secondary text-sm"
          >
            {tr ? 'İptal' : 'Cancel'}
          </button>
          <button onClick={saveSiparis} className="apple-button-primary text-sm">
            {editingSiparis ? (tr ? 'Güncelle' : 'Update') : (tr ? 'Sipariş Oluştur' : 'Create Order')}
          </button>
        </div>
      </Modal>

      {/* ══════════════════════════════════════════════════════════════════════
          MODAL: TEKLİF EKLE / DÜZENLE
      ══════════════════════════════════════════════════════════════════════ */}
      <Modal
        open={showTeklifModal}
        onClose={() => { setShowTeklifModal(false); setEditingTeklif(null); setTeklifForm({ ...emptyTeklif }); }}
        title={editingTeklif ? (tr ? 'Teklifi Düzenle' : 'Edit Quote') : (tr ? 'Yeni Fiyat Teklifi (RFQ)' : 'New Vendor Quote (RFQ)')}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label={tr ? 'Teklif No' : 'RFQ No'}>
            <input
              className={`${inputCls} font-mono`}
              value={teklifForm.teklifNo}
              onChange={e => setTeklifForm(p => ({ ...p, teklifNo: e.target.value }))}
              placeholder="RFQ-2026-xxxx"
            />
          </Field>
          <Field label={tr ? 'Tedarikçi *' : 'Supplier *'}>
            <div className="relative">
              <select
                className={`${inputCls} pr-8 appearance-none`}
                value={teklifForm.tedarikci}
                onChange={e => setTeklifForm(p => ({ ...p, tedarikci: e.target.value }))}
              >
                <option value="">{tr ? '— Seçiniz —' : '— Select —'}</option>
                {tedarikciler.map(t => (
                  <option key={t.id} value={t.ad}>{t.ad}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
            </div>
          </Field>
          <Field label={tr ? 'Ürün *' : 'Product *'}>
            <input
              className={inputCls}
              value={teklifForm.urun}
              onChange={e => setTeklifForm(p => ({ ...p, urun: e.target.value }))}
              placeholder={tr ? 'Ürün / hizmet adı' : 'Product / service name'}
            />
          </Field>
          <Field label={tr ? 'Miktar' : 'Quantity'}>
            <input
              type="number"
              min={1}
              className={inputCls}
              value={teklifForm.miktar}
              onChange={e => setTeklifForm(p => ({ ...p, miktar: Number(e.target.value) }))}
            />
          </Field>
          <Field label={tr ? 'Para Birimi' : 'Currency'}>
            <div className="relative">
              <select
                className={`${inputCls} pr-8 appearance-none`}
                value={teklifForm.paraBirimi}
                onChange={e => setTeklifForm(p => ({ ...p, paraBirimi: e.target.value as SatinAlmaTeklif['paraBirimi'] }))}
              >
                {(['TRY', 'USD', 'EUR'] as const).map(c => (
                  <option key={c}>{c}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
            </div>
          </Field>
          <Field label={tr ? 'Teklif Fiyatı' : 'Quoted Price'}>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">
                {CURRENCY_SYMBOLS[teklifForm.paraBirimi]}
              </span>
              <input
                type="number"
                min={0}
                step={0.01}
                className={`${inputCls} pl-7`}
                value={teklifForm.teklifFiyati || ''}
                onChange={e => setTeklifForm(p => ({ ...p, teklifFiyati: Number(e.target.value) }))}
              />
            </div>
          </Field>
          <Field label={tr ? 'Geçerlilik Tarihi' : 'Valid Until'}>
            <input
              type="date"
              className={inputCls}
              value={teklifForm.gecerlilikTarihi}
              onChange={e => setTeklifForm(p => ({ ...p, gecerlilikTarihi: e.target.value }))}
            />
          </Field>
          <Field label={tr ? 'Durum' : 'Status'}>
            <div className="relative">
              <select
                className={`${inputCls} pr-8 appearance-none`}
                value={teklifForm.durum}
                onChange={e => setTeklifForm(p => ({ ...p, durum: e.target.value as SatinAlmaTeklif['durum'] }))}
              >
                {(['Bekliyor', 'Kabul', 'Ret'] as const).map(v => (
                  <option key={v}>{v}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
            </div>
          </Field>
          <div className="sm:col-span-2">
            <Field label={tr ? 'Notlar' : 'Notes'}>
              <textarea
                className={`${inputCls} resize-none`}
                rows={2}
                value={teklifForm.notlar}
                onChange={e => setTeklifForm(p => ({ ...p, notlar: e.target.value }))}
              />
            </Field>
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <button
            onClick={() => { setShowTeklifModal(false); setEditingTeklif(null); setTeklifForm({ ...emptyTeklif }); }}
            className="apple-button-secondary text-sm"
          >
            {tr ? 'İptal' : 'Cancel'}
          </button>
          <button onClick={saveTeklif} className="apple-button-primary text-sm">
            {editingTeklif ? (tr ? 'Güncelle' : 'Update') : (tr ? 'Teklif Kaydet' : 'Save Quote')}
          </button>
        </div>
      </Modal>

      {/* ══════════════════════════════════════════════════════════════════════
          MODAL: TEDARİKÇİ EKLE / DÜZENLE
      ══════════════════════════════════════════════════════════════════════ */}
      <Modal
        open={showTedarikciModal}
        onClose={() => { setShowTedarikciModal(false); setEditingTedarikci(null); setTedarikciForm({ ...emptyTedarikci }); }}
        title={editingTedarikci ? (tr ? 'Tedarikçiyi Düzenle' : 'Edit Supplier') : (tr ? 'Yeni Tedarikçi' : 'New Supplier')}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label={tr ? 'Tedarikçi Adı *' : 'Supplier Name *'}>
            <input
              className={inputCls}
              value={tedarikciForm.ad}
              onChange={e => setTedarikciForm(p => ({ ...p, ad: e.target.value }))}
              placeholder={tr ? 'Firma adı' : 'Company name'}
            />
          </Field>
          <Field label={tr ? 'Vergi No' : 'Tax ID'}>
            <input
              className={inputCls}
              value={tedarikciForm.vergiNo}
              onChange={e => setTedarikciForm(p => ({ ...p, vergiNo: e.target.value }))}
              placeholder="1234567890"
            />
          </Field>
          <Field label={tr ? 'Yetkili Adı' : 'Contact Name'}>
            <input
              className={inputCls}
              value={tedarikciForm.yetkiliAd}
              onChange={e => setTedarikciForm(p => ({ ...p, yetkiliAd: e.target.value }))}
              placeholder={tr ? 'Ad Soyad' : 'Full Name'}
            />
          </Field>
          <Field label={tr ? 'E-posta' : 'Email'}>
            <input
              type="email"
              className={inputCls}
              value={tedarikciForm.email}
              onChange={e => setTedarikciForm(p => ({ ...p, email: e.target.value }))}
              placeholder="info@firma.com"
            />
          </Field>
          <Field label={tr ? 'Telefon' : 'Phone'}>
            <input
              className={inputCls}
              value={tedarikciForm.telefon}
              onChange={e => setTedarikciForm(p => ({ ...p, telefon: e.target.value }))}
              placeholder="+90 5xx xxx xx xx"
            />
          </Field>
          <Field label={tr ? 'Ödeme Vadesi (gün)' : 'Payment Terms (days)'}>
            <input
              type="number"
              min={0}
              className={inputCls}
              value={tedarikciForm.odemeVadesi}
              onChange={e => setTedarikciForm(p => ({ ...p, odemeVadesi: Number(e.target.value) }))}
            />
          </Field>
          <Field label={tr ? 'Para Birimi' : 'Currency'}>
            <div className="relative">
              <select
                className={`${inputCls} pr-8 appearance-none`}
                value={tedarikciForm.paraBirimi}
                onChange={e => setTedarikciForm(p => ({ ...p, paraBirimi: e.target.value as SatinAlmaTedarikci['paraBirimi'] }))}
              >
                {(['TRY', 'USD', 'EUR'] as const).map(c => (
                  <option key={c}>{c}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
            </div>
          </Field>
          <Field label={tr ? 'Toplam Sipariş Tutarı' : 'Total Order Volume'}>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">
                {CURRENCY_SYMBOLS[tedarikciForm.paraBirimi]}
              </span>
              <input
                type="number"
                min={0}
                className={`${inputCls} pl-7`}
                value={tedarikciForm.toplamSiparisTutari || ''}
                onChange={e => setTedarikciForm(p => ({ ...p, toplamSiparisTutari: Number(e.target.value) }))}
              />
            </div>
          </Field>
          <div className="sm:col-span-2">
            <Field label={tr ? 'Adres' : 'Address'}>
              <textarea
                className={`${inputCls} resize-none`}
                rows={2}
                value={tedarikciForm.adres}
                onChange={e => setTedarikciForm(p => ({ ...p, adres: e.target.value }))}
              />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label={tr ? 'Notlar' : 'Notes'}>
              <textarea
                className={`${inputCls} resize-none`}
                rows={2}
                value={tedarikciForm.notlar}
                onChange={e => setTedarikciForm(p => ({ ...p, notlar: e.target.value }))}
              />
            </Field>
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <button
            onClick={() => { setShowTedarikciModal(false); setEditingTedarikci(null); setTedarikciForm({ ...emptyTedarikci }); }}
            className="apple-button-secondary text-sm"
          >
            {tr ? 'İptal' : 'Cancel'}
          </button>
          <button onClick={saveTedarikci} className="apple-button-primary text-sm">
            {editingTedarikci ? (tr ? 'Güncelle' : 'Update') : (tr ? 'Tedarikçi Ekle' : 'Add Supplier')}
          </button>
        </div>
      </Modal>

    </div>
  );
}
