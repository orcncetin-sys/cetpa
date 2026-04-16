import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Plus, Trash2, Edit2, Download, X, Save, CheckCircle,
  AlertCircle, Building2, TrendingUp, TrendingDown, BarChart3,
  PieChart, FileText, ArrowUpDown, Search, Filter, ChevronDown,
  DollarSign, Target, Activity, Check, RefreshCw
} from 'lucide-react';
import { db } from '../firebase';
import {
  collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot,
  query, orderBy, serverTimestamp
} from 'firebase/firestore';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  PieChart as RechartsPieChart, Pie, Cell, ResponsiveContainer
} from 'recharts';
import ConfirmModal from './ConfirmModal';

// ─── Types ────────────────────────────────────────────────────────────────────

interface MaliyetMerkezi {
  id: string;
  kod: string;
  ad: string;
  departman: string;
  butce: number;
  gerceklesen: number;
  sorumlu: string;
  aktif: boolean;
  aciklama: string;
}

interface MaliyetKalemi {
  id: string;
  merkezId: string;
  merkezAd: string;
  tarih: string;
  kategori: string;
  aciklama: string;
  tutar: number;
  belgeTipi: 'Fatura' | 'Fiş' | 'İç Transfer' | 'Bordro' | 'Diğer';
  belgeNo: string;
  onaylandi: boolean;
}

interface MaliyetMerkeziModuleProps {
  currentLanguage: 'tr' | 'en';
  isAuthenticated: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEPARTMANLAR = ['Satış', 'Pazarlama', 'Üretim', 'İK', 'Lojistik', 'IT', 'Genel'];
const KATEGORILER = ['Personel', 'Kira', 'Elektrik', 'Malzeme', 'Seyahat', 'Pazarlama', 'Diğer'];
const BELGE_TIPLERI: MaliyetKalemi['belgeTipi'][] = ['Fatura', 'Fiş', 'İç Transfer', 'Bordro', 'Diğer'];

const PIE_COLORS = ['#ff4000', '#ff6633', '#ff8c66', '#ffb399', '#ffd9cc', '#cc3200', '#991f00'];

const DEPT_COLORS: Record<string, string> = {
  'Satış': '#ff4000', 'Pazarlama': '#f59e0b', 'Üretim': '#10b981',
  'İK': '#6366f1', 'Lojistik': '#0ea5e9', 'IT': '#8b5cf6', 'Genel': '#64748b',
};

const T = {
  tr: {
    title: 'Maliyet Merkezi Yönetimi',
    tab1: 'Maliyet Merkezleri', tab2: 'Gider Kalemleri', tab3: 'Analiz & Raporlar',
    addCenter: 'Merkez Ekle', addItem: 'Gider Ekle', exportCSV: 'CSV İndir',
    kod: 'Kod', ad: 'Ad', departman: 'Departman', butce: 'Bütçe', gerceklesen: 'Gerçekleşen',
    kalan: 'Kalan', sorumlu: 'Sorumlu', aktif: 'Aktif', aciklama: 'Açıklama',
    tarih: 'Tarih', merkez: 'Merkez', kategori: 'Kategori', tutar: 'Tutar',
    belgeTipi: 'Belge Tipi', belgeNo: 'Belge No', onay: 'Onay', islemler: 'İşlemler',
    onayla: 'Onayla', onayKaldir: 'Onay Kaldır', sil: 'Sil', duzenle: 'Düzenle',
    kaydet: 'Kaydet', iptal: 'İptal', yeniMerkez: 'Yeni Maliyet Merkezi',
    merkeziDuzenle: 'Maliyet Merkezini Düzenle', yeniGider: 'Yeni Gider Kalemi',
    gideriDuzenle: 'Gider Kalemini Düzenle', filtrele: 'Filtrele', tumMerkezler: 'Tüm Merkezler',
    tumKategoriler: 'Tüm Kategoriler', ay: 'Ay', tumAylar: 'Tüm Aylar',
    butceVsGerceklesen: 'Bütçe vs Gerçekleşen (Departman)', kategoriDagilimi: 'Kategori Bazlı Gider Dağılımı',
    en5Gider: 'En Yüksek 5 Gider Kalemi', butceSapmaAnalizi: 'Bütçe Sapma Analizi',
    sapma: 'Sapma', sapmaPct: 'Sapma %', butceDahilinde: 'Bütçe Dahilinde', butceAsimi: 'Bütçe Aşımı',
    silOnay: 'Silmek istediğinize emin misiniz?', silAciklama: 'Bu işlem geri alınamaz.',
    hataBaslik: 'Hata', basariBaslik: 'Başarılı',
    merkezEklendi: 'Maliyet merkezi eklendi.', merkezGuncellendi: 'Maliyet merkezi güncellendi.',
    merkezSilindi: 'Maliyet merkezi silindi.', kalemEklendi: 'Gider kalemi eklendi.',
    kalemGuncellendi: 'Gider kalemi güncellendi.', kalemSilindi: 'Gider kalemi silindi.',
    onaylandi: 'Onaylandı', onaylanmadi: 'Onaylanmadı', arayin: 'Arayın...',
    toplam: 'Toplam', adet: 'adet', yuzde: 'Kullanım',
  },
  en: {
    title: 'Cost Center Management',
    tab1: 'Cost Centers', tab2: 'Expense Items', tab3: 'Analysis & Reports',
    addCenter: 'Add Center', addItem: 'Add Expense', exportCSV: 'Export CSV',
    kod: 'Code', ad: 'Name', departman: 'Department', butce: 'Budget', gerceklesen: 'Actual',
    kalan: 'Remaining', sorumlu: 'Manager', aktif: 'Active', aciklama: 'Description',
    tarih: 'Date', merkez: 'Center', kategori: 'Category', tutar: 'Amount',
    belgeTipi: 'Doc Type', belgeNo: 'Doc No', onay: 'Approval', islemler: 'Actions',
    onayla: 'Approve', onayKaldir: 'Unapprove', sil: 'Delete', duzenle: 'Edit',
    kaydet: 'Save', iptal: 'Cancel', yeniMerkez: 'New Cost Center',
    merkeziDuzenle: 'Edit Cost Center', yeniGider: 'New Expense Item',
    gideriDuzenle: 'Edit Expense Item', filtrele: 'Filter', tumMerkezler: 'All Centers',
    tumKategoriler: 'All Categories', ay: 'Month', tumAylar: 'All Months',
    butceVsGerceklesen: 'Budget vs Actual (Department)', kategoriDagilimi: 'Category Expense Distribution',
    en5Gider: 'Top 5 Expense Items', butceSapmaAnalizi: 'Budget Variance Analysis',
    sapma: 'Variance', sapmaPct: 'Variance %', butceDahilinde: 'Within Budget', butceAsimi: 'Over Budget',
    silOnay: 'Are you sure you want to delete?', silAciklama: 'This action cannot be undone.',
    hataBaslik: 'Error', basariBaslik: 'Success',
    merkezEklendi: 'Cost center added.', merkezGuncellendi: 'Cost center updated.',
    merkezSilindi: 'Cost center deleted.', kalemEklendi: 'Expense item added.',
    kalemGuncellendi: 'Expense item updated.', kalemSilindi: 'Expense item deleted.',
    onaylandi: 'Approved', onaylanmadi: 'Pending', arayin: 'Search...',
    toplam: 'Total', adet: 'items', yuzde: 'Usage',
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const formatTRY = (n: number) =>
  new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 0 }).format(n);

const cn = (...classes: unknown[]) => classes.filter(Boolean).join(' ');

const exportCSVFile = (filename: string, headers: string[], rows: (string | number)[][]) => {
  const bom = '\uFEFF';
  const csv = bom + [headers, ...rows]
    .map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
};

// ─── Toast ────────────────────────────────────────────────────────────────────

interface ToastMsg { id: number; type: 'success' | 'error'; title: string; message: string; }

function Toast({ toasts, onDismiss }: { toasts: ToastMsg[]; onDismiss: (id: number) => void }) {
  return (
    <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none">
      <AnimatePresence>
        {toasts.map(t => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 40 }}
            className={cn(
              'pointer-events-auto flex items-start gap-3 px-4 py-3 rounded-2xl shadow-lg max-w-sm',
              t.type === 'success' ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'
            )}
          >
            {t.type === 'success'
              ? <CheckCircle className="w-5 h-5 text-green-500 shrink-0 mt-0.5" />
              : <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-[#1D1D1F]">{t.title}</p>
              <p className="text-xs text-gray-500">{t.message}</p>
            </div>
            <button onClick={() => onDismiss(t.id)} className="text-gray-400 hover:text-gray-600">
              <X className="w-4 h-4" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

// ─── SortHeader ───────────────────────────────────────────────────────────────

function SortHeader({ label, sortKey, currentSort, onSort }: {
  label: string; sortKey: string;
  currentSort: { key: string; direction: 'asc' | 'desc' };
  onSort: (k: string) => void;
}) {
  const active = currentSort.key === sortKey;
  return (
    <th
      className="px-4 py-3 text-left text-[10px] font-bold text-[#86868B] uppercase tracking-wider cursor-pointer hover:bg-gray-50 transition-colors group"
      onClick={() => onSort(sortKey)}
    >
      <div className="flex items-center gap-1">
        {label}
        <ArrowUpDown className={cn('w-3 h-3 transition-all', active ? 'text-[#ff4000]' : 'text-gray-300 group-hover:text-gray-400')} />
      </div>
    </th>
  );
}

// ─── Progress Bar ─────────────────────────────────────────────────────────────

function BudgetBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  const color = pct > 90 ? '#ef4444' : pct > 75 ? '#f97316' : '#22c55e';
  return (
    <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
      <motion.div
        initial={{ width: 0 }}
        animate={{ width: `${pct}%` }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
        className="h-full rounded-full"
        style={{ backgroundColor: color }}
      />
    </div>
  );
}

// ─── Dept Badge ───────────────────────────────────────────────────────────────

function DeptBadge({ dept }: { dept: string }) {
  const color = DEPT_COLORS[dept] ?? '#64748b';
  return (
    <span
      className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider text-white"
      style={{ backgroundColor: color }}
    >
      {dept}
    </span>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function MaliyetMerkeziModule({ currentLanguage, isAuthenticated }: MaliyetMerkeziModuleProps) {
  const t = T[currentLanguage] as typeof T['tr'];

  // ── State ──
  const [activeTab, setActiveTab] = useState<'merkezler' | 'kalemler' | 'analiz'>('merkezler');
  const [merkezler, setMerkezler] = useState<MaliyetMerkezi[]>([]);
  const [kalemler, setKalemler] = useState<MaliyetKalemi[]>([]);
  const [toasts, setToasts] = useState<ToastMsg[]>([]);

  // Merkez form
  const [showMerkezModal, setShowMerkezModal] = useState(false);
  const [editingMerkez, setEditingMerkez] = useState<MaliyetMerkezi | null>(null);
  const [merkezForm, setMerkezForm] = useState({
    kod: '', ad: '', departman: DEPARTMANLAR[0], butce: '', sorumlu: '', aktif: true, aciklama: '',
  });

  // Kalem form
  const [showKalemModal, setShowKalemModal] = useState(false);
  const [editingKalem, setEditingKalem] = useState<MaliyetKalemi | null>(null);
  const [kalemForm, setKalemForm] = useState({
    merkezId: '', merkezAd: '', tarih: new Date().toISOString().split('T')[0],
    kategori: KATEGORILER[0], aciklama: '', tutar: '',
    belgeTipi: 'Fatura' as MaliyetKalemi['belgeTipi'], belgeNo: '', onaylandi: false,
  });

  // Filters
  const [filterMerkez, setFilterMerkez] = useState('');
  const [filterKategori, setFilterKategori] = useState('');
  const [filterAy, setFilterAy] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  // Sort
  const [kalemSort, setKalemSort] = useState<{ key: string; direction: 'asc' | 'desc' }>({ key: 'tarih', direction: 'desc' });

  // Delete confirm
  const [confirmDelete, setConfirmDelete] = useState<{ type: 'merkez' | 'kalem'; id: string } | null>(null);

  // Analysis month
  const [analizAy, setAnalizAy] = useState<string>('');

  // ── Toast helpers ──
  let toastId = 0;
  const addToast = useCallback((type: 'success' | 'error', title: string, message: string) => {
    const id = ++toastId;
    setToasts(prev => [...prev, { id, type, title, message }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
  }, []);
  const dismissToast = useCallback((id: number) => setToasts(prev => prev.filter(t => t.id !== id)), []);

  // ── Firestore subscriptions ──
  useEffect(() => {
    if (!isAuthenticated) return;
    const unsub1 = onSnapshot(
      query(collection(db, 'maliyetMerkezleri'), orderBy('kod', 'asc')),
      snap => {
        const data = snap.docs.map(d => ({ id: d.id, ...d.data() } as MaliyetMerkezi));
        setMerkezler(data);
      },
      err => addToast('error', t.hataBaslik, err.message)
    );

    const timer = setTimeout(() => {
      const unsub2 = onSnapshot(
        query(collection(db, 'maliyetKalemleri'), orderBy('tarih', 'desc')),
        snap => {
          const data = snap.docs.map(d => ({ id: d.id, ...d.data() } as MaliyetKalemi));
          setKalemler(data);
        },
        err => addToast('error', t.hataBaslik, err.message)
      );
      return unsub2;
    }, 200);

    return () => {
      unsub1();
      clearTimeout(timer);
    };
  }, [isAuthenticated]);

  // ── Computed: actual spend per center ──
  const merkezlerWithActual = merkezler.map(m => ({
    ...m,
    gerceklesen: kalemler.filter(k => k.merkezId === m.id).reduce((sum, k) => sum + k.tutar, 0),
  }));

  // ── Merkez CRUD ──
  const openAddMerkez = () => {
    setEditingMerkez(null);
    setMerkezForm({ kod: '', ad: '', departman: DEPARTMANLAR[0], butce: '', sorumlu: '', aktif: true, aciklama: '' });
    setShowMerkezModal(true);
  };

  const openEditMerkez = (m: MaliyetMerkezi) => {
    setEditingMerkez(m);
    setMerkezForm({ kod: m.kod, ad: m.ad, departman: m.departman, butce: String(m.butce), sorumlu: m.sorumlu, aktif: m.aktif, aciklama: m.aciklama });
    setShowMerkezModal(true);
  };

  const saveMerkez = async () => {
    const payload = {
      kod: merkezForm.kod.trim(),
      ad: merkezForm.ad.trim(),
      departman: merkezForm.departman,
      butce: parseFloat(merkezForm.butce) || 0,
      gerceklesen: 0,
      sorumlu: merkezForm.sorumlu.trim(),
      aktif: merkezForm.aktif,
      aciklama: merkezForm.aciklama.trim(),
    };
    try {
      if (editingMerkez) {
        await updateDoc(doc(db, 'maliyetMerkezleri', editingMerkez.id), { ...payload, updatedAt: serverTimestamp() });
        addToast('success', t.basariBaslik, t.merkezGuncellendi);
      } else {
        await addDoc(collection(db, 'maliyetMerkezleri'), { ...payload, createdAt: serverTimestamp() });
        addToast('success', t.basariBaslik, t.merkezEklendi);
      }
      setShowMerkezModal(false);
    } catch (e: unknown) {
      addToast('error', t.hataBaslik, (e as Error).message);
    }
  };

  const deleteMerkez = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'maliyetMerkezleri', id));
      addToast('success', t.basariBaslik, t.merkezSilindi);
    } catch (e: unknown) {
      addToast('error', t.hataBaslik, (e as Error).message);
    }
  };

  // ── Kalem CRUD ──
  const openAddKalem = () => {
    setEditingKalem(null);
    setKalemForm({
      merkezId: merkezler[0]?.id ?? '',
      merkezAd: merkezler[0]?.ad ?? '',
      tarih: new Date().toISOString().split('T')[0],
      kategori: KATEGORILER[0], aciklama: '', tutar: '',
      belgeTipi: 'Fatura', belgeNo: '', onaylandi: false,
    });
    setShowKalemModal(true);
  };

  const openEditKalem = (k: MaliyetKalemi) => {
    setEditingKalem(k);
    setKalemForm({
      merkezId: k.merkezId, merkezAd: k.merkezAd, tarih: k.tarih,
      kategori: k.kategori, aciklama: k.aciklama, tutar: String(k.tutar),
      belgeTipi: k.belgeTipi, belgeNo: k.belgeNo, onaylandi: k.onaylandi,
    });
    setShowKalemModal(true);
  };

  const saveKalem = async () => {
    const selMerkez = merkezler.find(m => m.id === kalemForm.merkezId);
    const payload = {
      merkezId: kalemForm.merkezId,
      merkezAd: selMerkez?.ad ?? kalemForm.merkezAd,
      tarih: kalemForm.tarih,
      kategori: kalemForm.kategori,
      aciklama: kalemForm.aciklama.trim(),
      tutar: parseFloat(kalemForm.tutar) || 0,
      belgeTipi: kalemForm.belgeTipi,
      belgeNo: kalemForm.belgeNo.trim(),
      onaylandi: kalemForm.onaylandi,
    };
    try {
      if (editingKalem) {
        await updateDoc(doc(db, 'maliyetKalemleri', editingKalem.id), { ...payload, updatedAt: serverTimestamp() });
        addToast('success', t.basariBaslik, t.kalemGuncellendi);
      } else {
        await addDoc(collection(db, 'maliyetKalemleri'), { ...payload, createdAt: serverTimestamp() });
        addToast('success', t.basariBaslik, t.kalemEklendi);
      }
      setShowKalemModal(false);
    } catch (e: unknown) {
      addToast('error', t.hataBaslik, (e as Error).message);
    }
  };

  const deleteKalem = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'maliyetKalemleri', id));
      addToast('success', t.basariBaslik, t.kalemSilindi);
    } catch (e: unknown) {
      addToast('error', t.hataBaslik, (e as Error).message);
    }
  };

  const toggleOnay = async (k: MaliyetKalemi) => {
    try {
      await updateDoc(doc(db, 'maliyetKalemleri', k.id), { onaylandi: !k.onaylandi, updatedAt: serverTimestamp() });
    } catch (e: unknown) {
      addToast('error', t.hataBaslik, (e as Error).message);
    }
  };

  // ── Sort handler ──
  const handleSort = (key: string) => {
    setKalemSort(prev => ({ key, direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc' }));
  };

  // ── Filtered kalemler ──
  const filteredKalemler = kalemler
    .filter(k => !filterMerkez || k.merkezId === filterMerkez)
    .filter(k => !filterKategori || k.kategori === filterKategori)
    .filter(k => !filterAy || k.tarih.startsWith(filterAy))
    .filter(k => !searchQuery || k.aciklama.toLowerCase().includes(searchQuery.toLowerCase()) || k.belgeNo.toLowerCase().includes(searchQuery.toLowerCase()))
    .sort((a, b) => {
      const { key, direction } = kalemSort;
      const rawA = (a as unknown as Record<string, unknown>)[key];
      const rawB = (b as unknown as Record<string, unknown>)[key];
      const va: string = typeof rawA === 'number' ? String(rawA) : typeof rawA === 'string' ? rawA.toLowerCase() : '';
      const vb: string = typeof rawB === 'number' ? String(rawB) : typeof rawB === 'string' ? rawB.toLowerCase() : '';
      const numA = parseFloat(va);
      const numB = parseFloat(vb);
      if (!isNaN(numA) && !isNaN(numB)) {
        return direction === 'asc' ? numA - numB : numB - numA;
      }
      if (va < vb) return direction === 'asc' ? -1 : 1;
      if (va > vb) return direction === 'asc' ? 1 : -1;
      return 0;
    });

  // ── Analysis helpers ──
  const analizKalemler = analizAy ? kalemler.filter(k => k.tarih.startsWith(analizAy)) : kalemler;

  // Dept chart data
  const deptChartData = DEPARTMANLAR.map(dept => {
    const centers = merkezlerWithActual.filter(m => m.departman === dept);
    return {
      dept,
      [t.butce]: centers.reduce((s, m) => s + m.butce, 0),
      [t.gerceklesen]: analizKalemler.filter(k => centers.some(m => m.id === k.merkezId)).reduce((s, k) => s + k.tutar, 0),
    };
  }).filter(d => (d[t.butce] as number) > 0 || (d[t.gerceklesen] as number) > 0);

  // Kategori pie data
  const kategoriTotals = KATEGORILER.map(kat => ({
    name: kat,
    value: analizKalemler.filter(k => k.kategori === kat).reduce((s, k) => s + k.tutar, 0),
  })).filter(k => k.value > 0);

  const totalKategori = kategoriTotals.reduce((s, k) => s + k.value, 0);

  // Top 5 gider
  const top5 = [...analizKalemler].sort((a, b) => b.tutar - a.tutar).slice(0, 5);

  // Sapma analizi
  const sapmaData = merkezlerWithActual.map(m => {
    const sapma = m.gerceklesen - m.butce;
    const sapmaPct = m.butce > 0 ? (sapma / m.butce) * 100 : 0;
    return { ...m, sapma, sapmaPct };
  });

  // Month options for filter
  const monthOptions = Array.from(new Set(kalemler.map(k => k.tarih.substring(0, 7)))).sort().reverse();

  // ── CSV export ──
  const handleExportCSV = () => {
    const headers = [t.tarih, t.merkez, t.kategori, t.aciklama, t.belgeTipi, t.belgeNo, t.tutar, t.onay];
    const rows = filteredKalemler.map(k => [
      k.tarih, k.merkezAd, k.kategori, k.aciklama, k.belgeTipi, k.belgeNo, k.tutar,
      k.onaylandi ? t.onaylandi : t.onaylanmadi,
    ]);
    exportCSVFile(`gider-kalemleri-${new Date().toISOString().split('T')[0]}.csv`, headers, rows);
  };

  // ── Render ──
  return (
    <div className="flex flex-col gap-6 p-6 max-w-full">
      <Toast toasts={toasts} onDismiss={dismissToast} />

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-[#ff4000]/10 flex items-center justify-center">
            <Building2 className="w-5 h-5 text-[#ff4000]" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-[#1D1D1F]">{t.title}</h1>
            <p className="text-xs text-[#86868B]">{merkezlerWithActual.length} {currentLanguage === 'tr' ? 'merkez' : 'centers'} · {kalemler.length} {t.adet}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {activeTab === 'merkezler' && (
            <button className="apple-button-primary" onClick={openAddMerkez}>
              <Plus className="w-4 h-4" /> {t.addCenter}
            </button>
          )}
          {activeTab === 'kalemler' && (
            <>
              <button className="apple-button-secondary" onClick={handleExportCSV}>
                <Download className="w-4 h-4" /> {t.exportCSV}
              </button>
              <button className="apple-button-primary" onClick={openAddKalem}>
                <Plus className="w-4 h-4" /> {t.addItem}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-2xl w-fit">
        {([['merkezler', t.tab1, Building2], ['kalemler', t.tab2, FileText], ['analiz', t.tab3, BarChart3]] as const).map(([tab, label, Icon]) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              'flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold transition-all',
              activeTab === tab ? 'bg-white text-[#1D1D1F] shadow-sm' : 'text-[#86868B] hover:text-[#1D1D1F]'
            )}
          >
            <Icon className="w-3.5 h-3.5" /> {label}
          </button>
        ))}
      </div>

      {/* ── TAB 1: Maliyet Merkezleri ── */}
      <AnimatePresence mode="wait">
        {activeTab === 'merkezler' && (
          <motion.div key="merkezler" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}>
            {merkezlerWithActual.length === 0 ? (
              <div className="apple-card p-12 flex flex-col items-center gap-3 text-center">
                <Building2 className="w-12 h-12 text-gray-200" />
                <p className="text-sm text-[#86868B]">{currentLanguage === 'tr' ? 'Henüz maliyet merkezi eklenmedi.' : 'No cost centers yet.'}</p>
                <button className="apple-button-primary" onClick={openAddMerkez}><Plus className="w-4 h-4" /> {t.addCenter}</button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {merkezlerWithActual.map((m, i) => {
                  const pct = m.butce > 0 ? Math.min((m.gerceklesen / m.butce) * 100, 100) : 0;
                  const kalan = m.butce - m.gerceklesen;
                  return (
                    <motion.div
                      key={m.id}
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.04 }}
                      className="apple-card p-5 flex flex-col gap-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[11px] font-bold text-[#86868B] font-mono">{m.kod}</span>
                            <DeptBadge dept={m.departman} />
                            {!m.aktif && (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-gray-100 text-gray-500 uppercase">
                                {currentLanguage === 'tr' ? 'Pasif' : 'Inactive'}
                              </span>
                            )}
                          </div>
                          <p className="text-base font-bold text-[#1D1D1F] mt-1 truncate">{m.ad}</p>
                          <p className="text-xs text-[#86868B]">{m.sorumlu}</p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button className="p-1.5 rounded-xl hover:bg-gray-100 text-gray-400 hover:text-blue-500 transition-colors" onClick={() => openEditMerkez(m)}>
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button className="p-1.5 rounded-xl hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors" onClick={() => setConfirmDelete({ type: 'merkez', id: m.id })}>
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      <div className="flex flex-col gap-1.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-[#86868B]">{t.yuzde}</span>
                          <span className={cn('font-bold', pct > 90 ? 'text-red-500' : pct > 75 ? 'text-orange-500' : 'text-green-500')}>
                            {pct.toFixed(1)}%
                          </span>
                        </div>
                        <BudgetBar value={m.gerceklesen} max={m.butce} />
                      </div>

                      <div className="grid grid-cols-3 gap-2">
                        <div className="bg-gray-50 rounded-xl p-2 text-center">
                          <p className="text-[10px] text-[#86868B] mb-0.5">{t.butce}</p>
                          <p className="text-xs font-bold text-[#1D1D1F]">{formatTRY(m.butce)}</p>
                        </div>
                        <div className="bg-gray-50 rounded-xl p-2 text-center">
                          <p className="text-[10px] text-[#86868B] mb-0.5">{t.gerceklesen}</p>
                          <p className={cn('text-xs font-bold', pct > 90 ? 'text-red-500' : 'text-[#1D1D1F]')}>{formatTRY(m.gerceklesen)}</p>
                        </div>
                        <div className="bg-gray-50 rounded-xl p-2 text-center">
                          <p className="text-[10px] text-[#86868B] mb-0.5">{t.kalan}</p>
                          <p className={cn('text-xs font-bold', kalan < 0 ? 'text-red-500' : 'text-green-600')}>{formatTRY(kalan)}</p>
                        </div>
                      </div>

                      {m.aciklama && (
                        <p className="text-xs text-[#86868B] border-t border-gray-100 pt-2 truncate">{m.aciklama}</p>
                      )}
                    </motion.div>
                  );
                })}
              </div>
            )}
          </motion.div>
        )}

        {/* ── TAB 2: Gider Kalemleri ── */}
        {activeTab === 'kalemler' && (
          <motion.div key="kalemler" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }} className="flex flex-col gap-4">
            {/* Filters */}
            <div className="apple-card p-4 flex flex-wrap gap-3 items-center">
              <div className="flex items-center gap-2 bg-gray-50 rounded-xl px-3 py-2 flex-1 min-w-40">
                <Search className="w-4 h-4 text-[#86868B]" />
                <input
                  type="text"
                  placeholder={t.arayin}
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="bg-transparent text-sm outline-none flex-1 placeholder:text-gray-400"
                />
              </div>
              <select
                value={filterMerkez}
                onChange={e => setFilterMerkez(e.target.value)}
                className="apple-input text-sm py-2 min-w-36"
              >
                <option value="">{t.tumMerkezler}</option>
                {merkezler.map(m => <option key={m.id} value={m.id}>{m.ad}</option>)}
              </select>
              <select
                value={filterKategori}
                onChange={e => setFilterKategori(e.target.value)}
                className="apple-input text-sm py-2 min-w-36"
              >
                <option value="">{t.tumKategoriler}</option>
                {KATEGORILER.map(k => <option key={k} value={k}>{k}</option>)}
              </select>
              <select
                value={filterAy}
                onChange={e => setFilterAy(e.target.value)}
                className="apple-input text-sm py-2 min-w-32"
              >
                <option value="">{t.tumAylar}</option>
                {monthOptions.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>

            {/* Table */}
            <div className="apple-card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-100">
                    <tr>
                      <SortHeader label={t.tarih} sortKey="tarih" currentSort={kalemSort} onSort={handleSort} />
                      <SortHeader label={t.merkez} sortKey="merkezAd" currentSort={kalemSort} onSort={handleSort} />
                      <SortHeader label={t.kategori} sortKey="kategori" currentSort={kalemSort} onSort={handleSort} />
                      <th className="px-4 py-3 text-left text-[10px] font-bold text-[#86868B] uppercase tracking-wider">{t.aciklama}</th>
                      <th className="px-4 py-3 text-left text-[10px] font-bold text-[#86868B] uppercase tracking-wider">{t.belgeNo}</th>
                      <SortHeader label={t.tutar} sortKey="tutar" currentSort={kalemSort} onSort={handleSort} />
                      <th className="px-4 py-3 text-left text-[10px] font-bold text-[#86868B] uppercase tracking-wider">{t.onay}</th>
                      <th className="px-4 py-3 text-right text-[10px] font-bold text-[#86868B] uppercase tracking-wider">{t.islemler}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {filteredKalemler.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="px-4 py-12 text-center text-sm text-[#86868B]">
                          {currentLanguage === 'tr' ? 'Gider kalemi bulunamadı.' : 'No expense items found.'}
                        </td>
                      </tr>
                    ) : filteredKalemler.map((k, i) => (
                      <motion.tr
                        key={k.id}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: i * 0.02 }}
                        className="hover:bg-gray-50/50 transition-colors"
                      >
                        <td className="px-4 py-3 text-sm font-mono text-[#1D1D1F]">{k.tarih}</td>
                        <td className="px-4 py-3">
                          <span className="text-sm font-medium text-[#1D1D1F]">{k.merkezAd}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="px-2 py-0.5 bg-gray-100 text-[#1D1D1F] rounded-full text-[11px] font-semibold">{k.kategori}</span>
                        </td>
                        <td className="px-4 py-3 text-sm text-[#86868B] max-w-[200px] truncate">{k.aciklama}</td>
                        <td className="px-4 py-3 text-sm font-mono text-[#86868B]">{k.belgeNo || '—'}</td>
                        <td className="px-4 py-3 text-sm font-bold text-[#1D1D1F]">{formatTRY(k.tutar)}</td>
                        <td className="px-4 py-3">
                          <button
                            onClick={() => toggleOnay(k)}
                            className={cn(
                              'flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-bold transition-all',
                              k.onaylandi
                                ? 'bg-green-100 text-green-700 hover:bg-green-200'
                                : 'bg-orange-100 text-orange-700 hover:bg-orange-200'
                            )}
                          >
                            {k.onaylandi ? <Check className="w-3 h-3" /> : <RefreshCw className="w-3 h-3" />}
                            {k.onaylandi ? t.onaylandi : t.onaylanmadi}
                          </button>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1 justify-end">
                            <button className="p-1.5 rounded-xl hover:bg-blue-50 text-gray-400 hover:text-blue-500 transition-colors" onClick={() => openEditKalem(k)}>
                              <Edit2 className="w-4 h-4" />
                            </button>
                            <button className="p-1.5 rounded-xl hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors" onClick={() => setConfirmDelete({ type: 'kalem', id: k.id })}>
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </motion.tr>
                    ))}
                  </tbody>
                  {filteredKalemler.length > 0 && (
                    <tfoot className="bg-gray-50 border-t border-gray-200">
                      <tr>
                        <td colSpan={5} className="px-4 py-3 text-xs font-bold text-[#86868B]">
                          {t.toplam} ({filteredKalemler.length} {t.adet})
                        </td>
                        <td className="px-4 py-3 text-sm font-bold text-[#ff4000]">
                          {formatTRY(filteredKalemler.reduce((s, k) => s + k.tutar, 0))}
                        </td>
                        <td colSpan={2} />
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          </motion.div>
        )}

        {/* ── TAB 3: Analiz ── */}
        {activeTab === 'analiz' && (
          <motion.div key="analiz" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }} className="flex flex-col gap-6">
            {/* Month selector */}
            <div className="flex items-center gap-3">
              <label className="text-sm font-semibold text-[#86868B]">{t.ay}:</label>
              <select
                value={analizAy}
                onChange={e => setAnalizAy(e.target.value)}
                className="apple-input text-sm py-2 min-w-40"
              >
                <option value="">{t.tumAylar}</option>
                {monthOptions.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>

            {/* Dept Bar Chart */}
            <div className="apple-card p-6">
              <h3 className="text-sm font-bold text-[#1D1D1F] mb-4 flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-[#ff4000]" /> {t.butceVsGerceklesen}
              </h3>
              {deptChartData.length === 0 ? (
                <p className="text-sm text-[#86868B] text-center py-8">{currentLanguage === 'tr' ? 'Veri yok.' : 'No data.'}</p>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={deptChartData} margin={{ top: 5, right: 20, bottom: 5, left: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="dept" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `₺${(v / 1000).toFixed(0)}K`} />
                    <Tooltip formatter={(v: number) => formatTRY(v)} />
                    <Legend />
                    <Bar dataKey={t.butce} fill="#e5e7eb" radius={[4, 4, 0, 0]} />
                    <Bar dataKey={t.gerceklesen} fill="#ff4000" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Two-column: Pie + Top 5 */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Kategori Dağılımı */}
              <div className="apple-card p-6">
                <h3 className="text-sm font-bold text-[#1D1D1F] mb-4 flex items-center gap-2">
                  <PieChart className="w-4 h-4 text-[#ff4000]" /> {t.kategoriDagilimi}
                </h3>
                {kategoriTotals.length === 0 ? (
                  <p className="text-sm text-[#86868B] text-center py-8">{currentLanguage === 'tr' ? 'Veri yok.' : 'No data.'}</p>
                ) : (
                  <div className="flex flex-col gap-3">
                    <ResponsiveContainer width="100%" height={160}>
                      <RechartsPieChart>
                        <Pie data={kategoriTotals} cx="50%" cy="50%" innerRadius={45} outerRadius={70} paddingAngle={2} dataKey="value">
                          {kategoriTotals.map((_, idx) => (
                            <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(v: number) => formatTRY(v)} />
                      </RechartsPieChart>
                    </ResponsiveContainer>
                    <div className="flex flex-col gap-1.5">
                      {kategoriTotals.sort((a, b) => b.value - a.value).map((k, idx) => {
                        const pct = totalKategori > 0 ? (k.value / totalKategori) * 100 : 0;
                        return (
                          <div key={k.name} className="flex items-center gap-2">
                            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: PIE_COLORS[idx % PIE_COLORS.length] }} />
                            <span className="text-xs text-[#86868B] flex-1">{k.name}</span>
                            <span className="text-xs font-semibold text-[#1D1D1F]">{formatTRY(k.value)}</span>
                            <span className="text-[10px] text-[#86868B] w-10 text-right">{pct.toFixed(1)}%</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* Top 5 Gider */}
              <div className="apple-card p-6">
                <h3 className="text-sm font-bold text-[#1D1D1F] mb-4 flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-[#ff4000]" /> {t.en5Gider}
                </h3>
                {top5.length === 0 ? (
                  <p className="text-sm text-[#86868B] text-center py-8">{currentLanguage === 'tr' ? 'Veri yok.' : 'No data.'}</p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {top5.map((k, i) => (
                      <motion.div
                        key={k.id}
                        initial={{ opacity: 0, x: -12 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.07 }}
                        className="flex items-center gap-3 p-3 rounded-2xl bg-gray-50 hover:bg-gray-100 transition-colors"
                      >
                        <span className="w-6 h-6 rounded-full bg-[#ff4000]/10 text-[#ff4000] text-xs font-bold flex items-center justify-center shrink-0">
                          {i + 1}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-[#1D1D1F] truncate">{k.aciklama || k.kategori}</p>
                          <p className="text-[11px] text-[#86868B]">{k.merkezAd} · {k.tarih}</p>
                        </div>
                        <span className="text-sm font-bold text-[#ff4000] shrink-0">{formatTRY(k.tutar)}</span>
                      </motion.div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Sapma Analizi */}
            <div className="apple-card p-6">
              <h3 className="text-sm font-bold text-[#1D1D1F] mb-4 flex items-center gap-2">
                <Target className="w-4 h-4 text-[#ff4000]" /> {t.butceSapmaAnalizi}
              </h3>
              {sapmaData.length === 0 ? (
                <p className="text-sm text-[#86868B] text-center py-8">{currentLanguage === 'tr' ? 'Veri yok.' : 'No data.'}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100">
                        <th className="px-3 py-2 text-left text-[10px] font-bold text-[#86868B] uppercase">{t.kod}</th>
                        <th className="px-3 py-2 text-left text-[10px] font-bold text-[#86868B] uppercase">{t.ad}</th>
                        <th className="px-3 py-2 text-left text-[10px] font-bold text-[#86868B] uppercase">{t.departman}</th>
                        <th className="px-3 py-2 text-right text-[10px] font-bold text-[#86868B] uppercase">{t.butce}</th>
                        <th className="px-3 py-2 text-right text-[10px] font-bold text-[#86868B] uppercase">{t.gerceklesen}</th>
                        <th className="px-3 py-2 text-right text-[10px] font-bold text-[#86868B] uppercase">{t.sapma}</th>
                        <th className="px-3 py-2 text-right text-[10px] font-bold text-[#86868B] uppercase">{t.sapmaPct}</th>
                        <th className="px-3 py-2 text-left text-[10px] font-bold text-[#86868B] uppercase">{currentLanguage === 'tr' ? 'Durum' : 'Status'}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {sapmaData.map(m => (
                        <tr key={m.id} className="hover:bg-gray-50 transition-colors">
                          <td className="px-3 py-2.5 text-xs font-mono text-[#86868B]">{m.kod}</td>
                          <td className="px-3 py-2.5 text-sm font-medium text-[#1D1D1F]">{m.ad}</td>
                          <td className="px-3 py-2.5"><DeptBadge dept={m.departman} /></td>
                          <td className="px-3 py-2.5 text-sm text-right font-mono text-[#1D1D1F]">{formatTRY(m.butce)}</td>
                          <td className="px-3 py-2.5 text-sm text-right font-mono text-[#1D1D1F]">{formatTRY(m.gerceklesen)}</td>
                          <td className={cn('px-3 py-2.5 text-sm text-right font-bold font-mono', m.sapma > 0 ? 'text-red-500' : 'text-green-600')}>
                            {m.sapma > 0 ? '+' : ''}{formatTRY(m.sapma)}
                          </td>
                          <td className={cn('px-3 py-2.5 text-sm text-right font-bold', m.sapmaPct > 0 ? 'text-red-500' : 'text-green-600')}>
                            {m.sapmaPct > 0 ? '+' : ''}{m.sapmaPct.toFixed(1)}%
                          </td>
                          <td className="px-3 py-2.5">
                            <span className={cn(
                              'px-2 py-0.5 rounded-full text-[10px] font-bold uppercase',
                              m.sapma > 0 ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
                            )}>
                              {m.sapma > 0 ? t.butceAsimi : t.butceDahilinde}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Merkez Modal ── */}
      <AnimatePresence>
        {showMerkezModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={e => { if (e.target === e.currentTarget) setShowMerkezModal(false); }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden"
            >
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
                <h2 className="text-base font-bold text-[#1D1D1F]">
                  {editingMerkez ? t.merkeziDuzenle : t.yeniMerkez}
                </h2>
                <button onClick={() => setShowMerkezModal(false)} className="p-2 rounded-xl hover:bg-gray-100 text-gray-400 transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="p-6 flex flex-col gap-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-[#86868B] uppercase tracking-wider">{t.kod} *</label>
                    <input className="apple-input" placeholder="MM-001" value={merkezForm.kod} onChange={e => setMerkezForm(p => ({ ...p, kod: e.target.value }))} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-[#86868B] uppercase tracking-wider">{t.departman} *</label>
                    <select className="apple-input" value={merkezForm.departman} onChange={e => setMerkezForm(p => ({ ...p, departman: e.target.value }))}>
                      {DEPARTMANLAR.map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-[#86868B] uppercase tracking-wider">{t.ad} *</label>
                  <input className="apple-input" placeholder={currentLanguage === 'tr' ? 'Merkez adı' : 'Center name'} value={merkezForm.ad} onChange={e => setMerkezForm(p => ({ ...p, ad: e.target.value }))} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-[#86868B] uppercase tracking-wider">{t.butce} (₺) *</label>
                    <input type="number" className="apple-input" placeholder="0" value={merkezForm.butce} onChange={e => setMerkezForm(p => ({ ...p, butce: e.target.value }))} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-[#86868B] uppercase tracking-wider">{t.sorumlu}</label>
                    <input className="apple-input" placeholder={currentLanguage === 'tr' ? 'Ad Soyad' : 'Full Name'} value={merkezForm.sorumlu} onChange={e => setMerkezForm(p => ({ ...p, sorumlu: e.target.value }))} />
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-[#86868B] uppercase tracking-wider">{t.aciklama}</label>
                  <textarea className="apple-input resize-none h-20" value={merkezForm.aciklama} onChange={e => setMerkezForm(p => ({ ...p, aciklama: e.target.value }))} />
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <div
                    onClick={() => setMerkezForm(p => ({ ...p, aktif: !p.aktif }))}
                    className={cn('w-10 h-6 rounded-full transition-colors relative', merkezForm.aktif ? 'bg-[#ff4000]' : 'bg-gray-200')}
                  >
                    <span className={cn('absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform', merkezForm.aktif ? 'translate-x-5' : 'translate-x-1')} />
                  </div>
                  <span className="text-sm text-[#1D1D1F]">{t.aktif}</span>
                </label>
              </div>
              <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-gray-100">
                <button className="apple-button-secondary" onClick={() => setShowMerkezModal(false)}>{t.iptal}</button>
                <button className="apple-button-primary" onClick={saveMerkez} disabled={!merkezForm.kod || !merkezForm.ad}>
                  <Save className="w-4 h-4" /> {t.kaydet}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Kalem Modal ── */}
      <AnimatePresence>
        {showKalemModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={e => { if (e.target === e.currentTarget) setShowKalemModal(false); }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden"
            >
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
                <h2 className="text-base font-bold text-[#1D1D1F]">
                  {editingKalem ? t.gideriDuzenle : t.yeniGider}
                </h2>
                <button onClick={() => setShowKalemModal(false)} className="p-2 rounded-xl hover:bg-gray-100 text-gray-400 transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="p-6 flex flex-col gap-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-[#86868B] uppercase tracking-wider">{t.tarih} *</label>
                    <input type="date" className="apple-input" value={kalemForm.tarih} onChange={e => setKalemForm(p => ({ ...p, tarih: e.target.value }))} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-[#86868B] uppercase tracking-wider">{t.merkez} *</label>
                    <select
                      className="apple-input"
                      value={kalemForm.merkezId}
                      onChange={e => {
                        const sel = merkezler.find(m => m.id === e.target.value);
                        setKalemForm(p => ({ ...p, merkezId: e.target.value, merkezAd: sel?.ad ?? '' }));
                      }}
                    >
                      <option value="">{t.tumMerkezler}</option>
                      {merkezler.map(m => <option key={m.id} value={m.id}>{m.ad}</option>)}
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-[#86868B] uppercase tracking-wider">{t.kategori} *</label>
                    <select className="apple-input" value={kalemForm.kategori} onChange={e => setKalemForm(p => ({ ...p, kategori: e.target.value }))}>
                      {KATEGORILER.map(k => <option key={k} value={k}>{k}</option>)}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-[#86868B] uppercase tracking-wider">{t.tutar} (₺) *</label>
                    <input type="number" className="apple-input" placeholder="0" value={kalemForm.tutar} onChange={e => setKalemForm(p => ({ ...p, tutar: e.target.value }))} />
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-[#86868B] uppercase tracking-wider">{t.aciklama}</label>
                  <input className="apple-input" value={kalemForm.aciklama} onChange={e => setKalemForm(p => ({ ...p, aciklama: e.target.value }))} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-[#86868B] uppercase tracking-wider">{t.belgeTipi}</label>
                    <select className="apple-input" value={kalemForm.belgeTipi} onChange={e => setKalemForm(p => ({ ...p, belgeTipi: e.target.value as MaliyetKalemi['belgeTipi'] }))}>
                      {BELGE_TIPLERI.map(b => <option key={b} value={b}>{b}</option>)}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-[#86868B] uppercase tracking-wider">{t.belgeNo}</label>
                    <input className="apple-input" placeholder="FTR-2026-001" value={kalemForm.belgeNo} onChange={e => setKalemForm(p => ({ ...p, belgeNo: e.target.value }))} />
                  </div>
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <div
                    onClick={() => setKalemForm(p => ({ ...p, onaylandi: !p.onaylandi }))}
                    className={cn('w-10 h-6 rounded-full transition-colors relative', kalemForm.onaylandi ? 'bg-green-500' : 'bg-gray-200')}
                  >
                    <span className={cn('absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform', kalemForm.onaylandi ? 'translate-x-5' : 'translate-x-1')} />
                  </div>
                  <span className="text-sm text-[#1D1D1F]">{t.onaylandi}</span>
                </label>
              </div>
              <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-gray-100">
                <button className="apple-button-secondary" onClick={() => setShowKalemModal(false)}>{t.iptal}</button>
                <button className="apple-button-primary" onClick={saveKalem} disabled={!kalemForm.merkezId || !kalemForm.tutar}>
                  <Save className="w-4 h-4" /> {t.kaydet}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Confirm Delete Modal ── */}
      {confirmDelete && (
        <ConfirmModal
          isOpen={!!confirmDelete}
          title={t.silOnay}
          message={t.silAciklama}
          onConfirm={() => {
            if (confirmDelete.type === 'merkez') deleteMerkez(confirmDelete.id);
            else deleteKalem(confirmDelete.id);
            setConfirmDelete(null);
          }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}
