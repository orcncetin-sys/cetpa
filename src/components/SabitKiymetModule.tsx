import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Package, Cpu, Monitor, Sofa, Building2, Car, Wrench, HelpCircle,
  Plus, Search, Download, X, Edit2, Trash2, FileText, ChevronUp,
  ChevronDown, User, MapPin, Calendar, TrendingDown, BarChart3,
  CheckCircle, AlertTriangle, Clock, Archive, XCircle
} from 'lucide-react';
import { db } from '../firebase';
import {
  collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot,
  query, orderBy, serverTimestamp
} from 'firebase/firestore';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SabitKiymet {
  id: string;
  barkod: string;
  ad: string;
  kategori: 'Araç' | 'Makine' | 'Ekipman' | 'Bilgisayar' | 'Mobilya' | 'Bina' | 'Diğer';
  marka: string;
  model: string;
  seriNo: string;
  alisTarihi: string;
  alisFiyati: number;
  amortismanYili: number;
  amortismanYontemi: 'Düz Hat' | 'Azalan Bakiye';
  konum: string;
  sorumlu: string;
  durum: 'Aktif' | 'Bakımda' | 'Hurda' | 'Satıldı' | 'Kayıp';
  notlar: string;
}

interface SabitKiymetModuleProps {
  currentLanguage: 'tr' | 'en';
  isAuthenticated: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const cn = (...classes: unknown[]) => classes.filter(Boolean).join(' ');

const formatCurrency = (val: number) =>
  new Intl.NumberFormat('tr-TR', {
    style: 'currency',
    currency: 'TRY',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(val);

const today = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

function calcYillikAmortisman(item: SabitKiymet): number {
  if (item.amortismanYili <= 0) return 0;
  return item.alisFiyati / item.amortismanYili;
}

function calcBirikmisSalinma(item: SabitKiymet): number {
  if (!item.alisTarihi) return 0;
  const alis = new Date(item.alisTarihi);
  const now = today();
  if (isNaN(alis.getTime())) return 0;
  const yilGecen = (now.getTime() - alis.getTime()) / (1000 * 60 * 60 * 24 * 365.25);
  if (yilGecen <= 0) return 0;
  const yil = Math.min(yilGecen, item.amortismanYili);
  if (item.amortismanYontemi === 'Düz Hat') {
    return (item.alisFiyati / item.amortismanYili) * yil;
  }
  // Azalan Bakiye: double-declining balance approximation
  const oran = 2 / item.amortismanYili;
  let kalanDeger = item.alisFiyati;
  let toplam = 0;
  const tamYil = Math.floor(yil);
  for (let i = 0; i < tamYil; i++) {
    const amortisman = kalanDeger * oran;
    toplam += amortisman;
    kalanDeger -= amortisman;
  }
  const kesirYil = yil - tamYil;
  if (kesirYil > 0) {
    toplam += kalanDeger * oran * kesirYil;
  }
  return Math.min(toplam, item.alisFiyati);
}

function calcNetDegerDefter(item: SabitKiymet): number {
  return Math.max(0, item.alisFiyati - calcBirikmisSalinma(item));
}

function calcEkonomikOmurSonu(item: SabitKiymet): string {
  if (!item.alisTarihi) return '-';
  const alis = new Date(item.alisTarihi);
  if (isNaN(alis.getTime())) return '-';
  const omur = new Date(alis);
  omur.setFullYear(omur.getFullYear() + item.amortismanYili);
  return omur.toISOString().split('T')[0];
}

function formatDateTR(str: string): string {
  if (!str) return '-';
  const d = new Date(str);
  if (isNaN(d.getTime())) return str;
  return d.toLocaleDateString('tr-TR');
}

function generateBarkod(existing: SabitKiymet[]): string {
  const year = new Date().getFullYear();
  const prefix = `SK-${year}-`;
  const nums = existing
    .filter(e => e.barkod?.startsWith(prefix))
    .map(e => parseInt(e.barkod.replace(prefix, ''), 10))
    .filter(n => !isNaN(n));
  const next = nums.length > 0 ? Math.max(...nums) + 1 : 1;
  return `${prefix}${String(next).padStart(3, '0')}`;
}

// ─── Translations ─────────────────────────────────────────────────────────────

const T = {
  tr: {
    title: 'Sabit Kıymet / Demirbaş Yönetimi',
    subtitle: 'Varlık takibi, amortisman ve zimmet yönetimi',
    tabVarliklar: 'Varlıklar',
    tabAmortisman: 'Amortisman Takvimi',
    toplamDemirbas: 'Toplam Demirbaş',
    toplamKayitliDeger: 'Toplam Kayıtlı Değer',
    toplamDefterDeger: 'Toplam Defter Değeri',
    birikmisSalinma: 'Birikmiş Amortisman',
    yeniEkle: 'Yeni Demirbaş',
    ara: 'Ad, barkod veya sorumlu ara…',
    tumKategoriler: 'Tüm Kategoriler',
    tumDurumlar: 'Tüm Durumlar',
    barkod: 'Barkod',
    ad: 'Ad',
    kategori: 'Kategori',
    alisTarihi: 'Alış Tarihi',
    alisFiyati: 'Alış Fiyatı',
    yillikAmort: 'Yıllık Amortisman',
    birikmiS: 'Birikmiş',
    netDefter: 'Net Defter Değeri',
    sorumlu: 'Sorumlu',
    durum: 'Durum',
    islemler: 'İşlemler',
    zimmetVer: 'Zimmet Ver',
    kaydet: 'Kaydet',
    iptal: 'İptal',
    sil: 'Sil',
    duzenle: 'Düzenle',
    exportZimmet: 'Zimmet Listesi (CSV)',
    exportAmort: 'Amortisman Raporu (CSV)',
    marka: 'Marka',
    model: 'Model',
    seriNo: 'Seri No',
    amortismanYili: 'Amortisman Yılı',
    amortismanYontemi: 'Amortisman Yöntemi',
    konum: 'Konum',
    notlar: 'Notlar',
    yeniDemirbas: 'Yeni Demirbaş',
    duzenleBaslik: 'Demirbaşı Düzenle',
    silOnayi: 'Bu demirbaşı silmek istediğinize emin misiniz?',
    evet: 'Evet, Sil',
    zimmetBaslik: 'Zimmet Devret',
    zimmetYeniSorumlu: 'Yeni Sorumlu',
    zimmetTarih: 'Devir Tarihi',
    zimmetNot: 'Not',
    zimmetKaydet: 'Zimmeti Kaydet',
    amortTabVarlik: 'Varlık',
    amortTabYil1: 'Yıl 1',
    amortTabYil2: 'Yıl 2',
    amortTabYil3: 'Yıl 3',
    amortTabYil4: 'Yıl 4',
    amortTabYil5: 'Yıl 5',
    amortTabToplam: 'Toplam (5 Yıl)',
    ekonomikOmur: 'Ekonomik Ömür Sonu',
    aktif: 'Aktif',
    bakimda: 'Bakımda',
    hurda: 'Hurda',
    satildi: 'Satıldı',
    kayip: 'Kayıp',
    duzHat: 'Düz Hat',
    azalanBakiye: 'Azalan Bakiye',
    arac: 'Araç',
    makine: 'Makine',
    ekipman: 'Ekipman',
    bilgisayar: 'Bilgisayar',
    mobilya: 'Mobilya',
    bina: 'Bina',
    diger: 'Diğer',
    basarili: 'İşlem başarılı.',
    hata: 'Bir hata oluştu.',
    zorunlu: 'Zorunlu alan',
    adet: 'adet',
    noData: 'Henüz demirbaş kaydı yok.',
    amortNoData: 'Aktif demirbaş kaydı bulunamadı.',
  },
  en: {
    title: 'Fixed Asset Management',
    subtitle: 'Asset tracking, depreciation and assignment management',
    tabVarliklar: 'Assets',
    tabAmortisman: 'Depreciation Schedule',
    toplamDemirbas: 'Total Assets',
    toplamKayitliDeger: 'Total Recorded Value',
    toplamDefterDeger: 'Total Book Value',
    birikmisSalinma: 'Accumulated Depreciation',
    yeniEkle: 'New Asset',
    ara: 'Search by name, barcode or assignee…',
    tumKategoriler: 'All Categories',
    tumDurumlar: 'All Statuses',
    barkod: 'Barcode',
    ad: 'Name',
    kategori: 'Category',
    alisTarihi: 'Purchase Date',
    alisFiyati: 'Purchase Price',
    yillikAmort: 'Annual Depreciation',
    birikmiS: 'Accumulated',
    netDefter: 'Net Book Value',
    sorumlu: 'Assignee',
    durum: 'Status',
    islemler: 'Actions',
    zimmetVer: 'Reassign',
    kaydet: 'Save',
    iptal: 'Cancel',
    sil: 'Delete',
    duzenle: 'Edit',
    exportZimmet: 'Assignment List (CSV)',
    exportAmort: 'Depreciation Report (CSV)',
    marka: 'Brand',
    model: 'Model',
    seriNo: 'Serial No',
    amortismanYili: 'Useful Life (Years)',
    amortismanYontemi: 'Depreciation Method',
    konum: 'Location',
    notlar: 'Notes',
    yeniDemirbas: 'New Asset',
    duzenleBaslik: 'Edit Asset',
    silOnayi: 'Are you sure you want to delete this asset?',
    evet: 'Yes, Delete',
    zimmetBaslik: 'Transfer Assignment',
    zimmetYeniSorumlu: 'New Assignee',
    zimmetTarih: 'Transfer Date',
    zimmetNot: 'Note',
    zimmetKaydet: 'Save Assignment',
    amortTabVarlik: 'Asset',
    amortTabYil1: 'Year 1',
    amortTabYil2: 'Year 2',
    amortTabYil3: 'Year 3',
    amortTabYil4: 'Year 4',
    amortTabYil5: 'Year 5',
    amortTabToplam: 'Total (5 Years)',
    ekonomikOmur: 'Economic Life End',
    aktif: 'Active',
    bakimda: 'In Maintenance',
    hurda: 'Scrap',
    satildi: 'Sold',
    kayip: 'Lost',
    duzHat: 'Straight Line',
    azalanBakiye: 'Declining Balance',
    arac: 'Vehicle',
    makine: 'Machine',
    ekipman: 'Equipment',
    bilgisayar: 'Computer',
    mobilya: 'Furniture',
    bina: 'Building',
    diger: 'Other',
    basarili: 'Operation successful.',
    hata: 'An error occurred.',
    zorunlu: 'Required field',
    adet: 'items',
    noData: 'No assets recorded yet.',
    amortNoData: 'No active assets found.',
  },
} as const;

// ─── Category config ──────────────────────────────────────────────────────────

const KATEGORI_CONFIG: Record<
  SabitKiymet['kategori'],
  { icon: React.ElementType; bg: string; text: string; border: string }
> = {
  Araç: { icon: Car, bg: 'bg-blue-100', text: 'text-blue-700', border: 'border-blue-200' },
  Makine: { icon: Wrench, bg: 'bg-orange-100', text: 'text-orange-700', border: 'border-orange-200' },
  Ekipman: { icon: Package, bg: 'bg-purple-100', text: 'text-purple-700', border: 'border-purple-200' },
  Bilgisayar: { icon: Monitor, bg: 'bg-indigo-100', text: 'text-indigo-700', border: 'border-indigo-200' },
  Mobilya: { icon: Sofa, bg: 'bg-yellow-100', text: 'text-yellow-700', border: 'border-yellow-200' },
  Bina: { icon: Building2, bg: 'bg-gray-100', text: 'text-gray-700', border: 'border-gray-200' },
  Diğer: { icon: HelpCircle, bg: 'bg-slate-100', text: 'text-slate-600', border: 'border-slate-200' },
};

const DURUM_CONFIG: Record<
  SabitKiymet['durum'],
  { icon: React.ElementType; bg: string; text: string }
> = {
  Aktif: { icon: CheckCircle, bg: 'bg-green-100', text: 'text-green-700' },
  Bakımda: { icon: AlertTriangle, bg: 'bg-yellow-100', text: 'text-yellow-700' },
  Hurda: { icon: Archive, bg: 'bg-red-100', text: 'text-red-700' },
  Satıldı: { icon: TrendingDown, bg: 'bg-gray-100', text: 'text-gray-600' },
  Kayıp: { icon: XCircle, bg: 'bg-rose-100', text: 'text-rose-700' },
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatCard({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  color: string;
}) {
  return (
    <motion.div
      className="apple-card p-5 flex items-center gap-4"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className={cn('w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0', color)}>
        <Icon className="w-5 h-5" />
      </div>
      <div className="min-w-0">
        <p className="text-[11px] text-[#86868B] font-medium truncate">{label}</p>
        <p className="text-lg font-bold text-[#1D1D1F] leading-tight truncate">{value}</p>
      </div>
    </motion.div>
  );
}

function SortTh({
  label,
  sortKey,
  current,
  onSort,
}: {
  label: string;
  sortKey: string;
  current: { key: string; dir: 'asc' | 'desc' };
  onSort: (k: string) => void;
}) {
  const active = current.key === sortKey;
  return (
    <th
      onClick={() => onSort(sortKey)}
      className="px-4 py-3 text-left text-[10px] font-bold text-[#86868B] uppercase tracking-wider cursor-pointer hover:bg-gray-50 select-none"
    >
      <span className="flex items-center gap-1">
        {label}
        {active ? (
          current.dir === 'asc' ? (
            <ChevronUp className="w-3 h-3 text-[#ff4000]" />
          ) : (
            <ChevronDown className="w-3 h-3 text-[#ff4000]" />
          )
        ) : (
          <ChevronDown className="w-3 h-3 text-gray-300 group-hover:text-gray-400" />
        )}
      </span>
    </th>
  );
}

function KategoriBadge({ kategori }: { kategori: SabitKiymet['kategori'] }) {
  const cfg = KATEGORI_CONFIG[kategori];
  const Icon = cfg.icon;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border',
        cfg.bg,
        cfg.text,
        cfg.border
      )}
    >
      <Icon className="w-3 h-3" />
      {kategori}
    </span>
  );
}

function DurumBadge({ durum, t }: { durum: SabitKiymet['durum']; t: typeof T['tr'] }) {
  const cfg = DURUM_CONFIG[durum];
  const Icon = cfg.icon;
  const labelMap: Record<SabitKiymet['durum'], string> = {
    Aktif: t.aktif,
    Bakımda: t.bakimda,
    Hurda: t.hurda,
    Satıldı: t.satildi,
    Kayıp: t.kayip,
  };
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium',
        cfg.bg,
        cfg.text
      )}
    >
      <Icon className="w-3 h-3" />
      {labelMap[durum]}
    </span>
  );
}

// ─── Toast ────────────────────────────────────────────────────────────────────

interface ToastState {
  msg: string;
  type: 'success' | 'error';
}

// ─── Empty form ───────────────────────────────────────────────────────────────

const emptyForm = (): Omit<SabitKiymet, 'id'> => ({
  barkod: '',
  ad: '',
  kategori: 'Ekipman',
  marka: '',
  model: '',
  seriNo: '',
  alisTarihi: new Date().toISOString().split('T')[0],
  alisFiyati: 0,
  amortismanYili: 5,
  amortismanYontemi: 'Düz Hat',
  konum: '',
  sorumlu: '',
  durum: 'Aktif',
  notlar: '',
});

// ─── Main Component ───────────────────────────────────────────────────────────

export default function SabitKiymetModule({
  currentLanguage,
  isAuthenticated,
}: SabitKiymetModuleProps) {
  const t = T[currentLanguage] as typeof T['tr'];

  // Data
  const [items, setItems] = useState<SabitKiymet[]>([]);
  const [loading, setLoading] = useState(true);

  // UI state
  const [activeTab, setActiveTab] = useState<'varliklar' | 'amortisman'>('varliklar');
  const [search, setSearch] = useState('');
  const [filterKategori, setFilterKategori] = useState<string>('');
  const [filterDurum, setFilterDurum] = useState<string>('');
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({
    key: 'alisTarihi',
    dir: 'desc',
  });

  // Panel / modal
  const [panelOpen, setPanelOpen] = useState(false);
  const [editItem, setEditItem] = useState<SabitKiymet | null>(null);
  const [form, setForm] = useState<Omit<SabitKiymet, 'id'>>(emptyForm());
  const [formErrors, setFormErrors] = useState<Partial<Record<keyof SabitKiymet, string>>>({});
  const [saving, setSaving] = useState(false);

  // Delete confirm
  const [deleteTarget, setDeleteTarget] = useState<SabitKiymet | null>(null);

  // Zimmet modal
  const [zimmetTarget, setZimmetTarget] = useState<SabitKiymet | null>(null);
  const [zimmetForm, setZimmetForm] = useState({
    yeniSorumlu: '',
    tarih: new Date().toISOString().split('T')[0],
    not: '',
  });
  const [zimmetSaving, setZimmetSaving] = useState(false);

  // Toast
  const [toast, setToast] = useState<ToastState | null>(null);

  const showToast = useCallback((msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  // Firestore subscription
  useEffect(() => {
    if (!isAuthenticated) {
      setLoading(false);
      return;
    }
    const unsub = setTimeout(() => {
      const q = query(collection(db, 'sabitKiymetler'), orderBy('alisTarihi', 'desc'));
      const cancel = onSnapshot(
        q,
        snap => {
          setItems(
            snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<SabitKiymet, 'id'>) }))
          );
          setLoading(false);
        },
        err => {
          console.error('sabitKiymetler snapshot error:', err);
          setLoading(false);
        }
      );
      return cancel;
    }, 0);
    return () => clearTimeout(unsub as unknown as number);
  }, [isAuthenticated]);

  // ─── Computed stats ────────────────────────────────────────────────────────

  const aktifler = items.filter(i => i.durum === 'Aktif');
  const stats = {
    count: aktifler.length,
    kayitliDeger: aktifler.reduce((s, i) => s + (i.alisFiyati || 0), 0),
    defterDeger: aktifler.reduce((s, i) => s + calcNetDegerDefter(i), 0),
    birikmisSalinma: aktifler.reduce((s, i) => s + calcBirikmisSalinma(i), 0),
  };

  // ─── Filtering & sorting ───────────────────────────────────────────────────

  const filtered = items
    .filter(item => {
      const q = search.toLowerCase();
      if (
        q &&
        !item.ad.toLowerCase().includes(q) &&
        !item.barkod.toLowerCase().includes(q) &&
        !item.sorumlu.toLowerCase().includes(q)
      )
        return false;
      if (filterKategori && item.kategori !== filterKategori) return false;
      if (filterDurum && item.durum !== filterDurum) return false;
      return true;
    })
    .sort((a, b) => {
      const k = sort.key as keyof SabitKiymet;
      let va: string | number = '';
      let vb: string | number = '';
      if (k === 'netDeferDeger' as keyof SabitKiymet) {
        va = calcNetDegerDefter(a);
        vb = calcNetDegerDefter(b);
      } else if (k === 'birikmisSalinmaCalc' as keyof SabitKiymet) {
        va = calcBirikmisSalinma(a);
        vb = calcBirikmisSalinma(b);
      } else {
        va = (a[k] as string | number) ?? '';
        vb = (b[k] as string | number) ?? '';
      }
      if (va < vb) return sort.dir === 'asc' ? -1 : 1;
      if (va > vb) return sort.dir === 'asc' ? 1 : -1;
      return 0;
    });

  const handleSort = (key: string) => {
    setSort(prev => ({
      key,
      dir: prev.key === key && prev.dir === 'asc' ? 'desc' : 'asc',
    }));
  };

  // ─── Form handlers ─────────────────────────────────────────────────────────

  const openAdd = () => {
    const draft = emptyForm();
    draft.barkod = generateBarkod(items);
    setForm(draft);
    setEditItem(null);
    setFormErrors({});
    setPanelOpen(true);
  };

  const openEdit = (item: SabitKiymet) => {
    const { id, ...rest } = item;
    setForm({ ...rest });
    setEditItem(item);
    setFormErrors({});
    setPanelOpen(true);
  };

  const closePanel = () => {
    setPanelOpen(false);
    setEditItem(null);
  };

  const validate = (): boolean => {
    const errs: Partial<Record<keyof SabitKiymet, string>> = {};
    if (!form.ad.trim()) errs.ad = t.zorunlu;
    if (!form.barkod.trim()) errs.barkod = t.zorunlu;
    if (!form.alisTarihi) errs.alisTarihi = t.zorunlu;
    if (form.alisFiyati <= 0) errs.alisFiyati = t.zorunlu;
    if (form.amortismanYili <= 0) errs.amortismanYili = t.zorunlu;
    setFormErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      if (editItem) {
        await updateDoc(doc(db, 'sabitKiymetler', editItem.id), {
          ...form,
          updatedAt: serverTimestamp(),
        });
      } else {
        await addDoc(collection(db, 'sabitKiymetler'), {
          ...form,
          createdAt: serverTimestamp(),
        });
      }
      showToast(t.basarili);
      closePanel();
    } catch (err) {
      console.error(err);
      showToast(t.hata, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteDoc(doc(db, 'sabitKiymetler', deleteTarget.id));
      showToast(t.basarili);
    } catch (err) {
      console.error(err);
      showToast(t.hata, 'error');
    } finally {
      setDeleteTarget(null);
    }
  };

  // ─── Zimmet handlers ───────────────────────────────────────────────────────

  const openZimmet = (item: SabitKiymet) => {
    setZimmetTarget(item);
    setZimmetForm({
      yeniSorumlu: item.sorumlu,
      tarih: new Date().toISOString().split('T')[0],
      not: '',
    });
  };

  const handleZimmetKaydet = async () => {
    if (!zimmetTarget || !zimmetForm.yeniSorumlu.trim()) return;
    setZimmetSaving(true);
    try {
      await updateDoc(doc(db, 'sabitKiymetler', zimmetTarget.id), {
        sorumlu: zimmetForm.yeniSorumlu,
        updatedAt: serverTimestamp(),
      });
      showToast(t.basarili);
      setZimmetTarget(null);
    } catch (err) {
      console.error(err);
      showToast(t.hata, 'error');
    } finally {
      setZimmetSaving(false);
    }
  };

  // ─── CSV exports ───────────────────────────────────────────────────────────

  const exportZimmetCSV = () => {
    const header = [t.barkod, t.ad, t.sorumlu, t.konum, t.durum].join(',');
    const rows = items.map(i =>
      [i.barkod, `"${i.ad}"`, `"${i.sorumlu}"`, `"${i.konum}"`, i.durum].join(',')
    );
    downloadCSV([header, ...rows].join('\n'), 'zimmet-listesi.csv');
  };

  const exportAmortCSV = () => {
    const header = [t.barkod, t.ad, t.yillikAmort, t.birikmiS, t.netDefter, t.ekonomikOmur].join(',');
    const rows = items.map(i =>
      [
        i.barkod,
        `"${i.ad}"`,
        calcYillikAmortisman(i).toFixed(2),
        calcBirikmisSalinma(i).toFixed(2),
        calcNetDegerDefter(i).toFixed(2),
        calcEkonomikOmurSonu(i),
      ].join(',')
    );
    downloadCSV([header, ...rows].join('\n'), 'amortisman-raporu.csv');
  };

  const downloadCSV = (content: string, filename: string) => {
    const blob = new Blob(['\uFEFF' + content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ─── Amortisman takvimi (next 5 years from now) ────────────────────────────

  const amortRows = aktifler.map(item => {
    const currentYear = new Date().getFullYear();
    const alis = new Date(item.alisTarihi);
    const yillar: number[] = [];
    let kalanDeger = item.alisFiyati;

    // Calculate accumulated depreciation up to start of current year
    const yilGecen = currentYear - alis.getFullYear();
    if (item.amortismanYontemi === 'Düz Hat') {
      const yillikAmort = item.alisFiyati / item.amortismanYili;
      const depreciatedYears = Math.min(yilGecen, item.amortismanYili);
      kalanDeger = item.alisFiyati - yillikAmort * depreciatedYears;
      for (let i = 0; i < 5; i++) {
        const remaining = Math.max(0, item.amortismanYili - (depreciatedYears + i));
        if (remaining <= 0) {
          yillar.push(0);
        } else {
          yillar.push(Math.min(yillikAmort, kalanDeger));
          kalanDeger = Math.max(0, kalanDeger - yillikAmort);
        }
      }
    } else {
      // Azalan Bakiye
      const oran = 2 / item.amortismanYili;
      const limitedYears = Math.min(yilGecen, item.amortismanYili);
      for (let i = 0; i < limitedYears; i++) {
        kalanDeger -= kalanDeger * oran;
      }
      for (let i = 0; i < 5; i++) {
        const amt = kalanDeger * oran;
        yillar.push(Math.max(0, amt));
        kalanDeger -= amt;
      }
    }

    return { item, yillar };
  });

  // ─── Render ────────────────────────────────────────────────────────────────

  const inputCls = (err?: string) =>
    cn('apple-input w-full px-3 py-2 text-sm', err && 'ring-2 ring-red-400');

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#1D1D1F]">{t.title}</h1>
          <p className="text-sm text-[#86868B] mt-0.5">{t.subtitle}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            className="apple-button-secondary text-sm px-4 py-2 flex items-center gap-2"
            onClick={exportZimmetCSV}
          >
            <Download className="w-4 h-4" />
            {t.exportZimmet}
          </button>
          <button
            className="apple-button-secondary text-sm px-4 py-2 flex items-center gap-2"
            onClick={exportAmortCSV}
          >
            <FileText className="w-4 h-4" />
            {t.exportAmort}
          </button>
          {isAuthenticated && (
            <button
              className="apple-button-primary text-sm px-4 py-2 flex items-center gap-2"
              onClick={openAdd}
            >
              <Plus className="w-4 h-4" />
              {t.yeniEkle}
            </button>
          )}
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={Package}
          label={t.toplamDemirbas}
          value={`${stats.count} ${t.adet}`}
          color="bg-blue-100 text-blue-700"
        />
        <StatCard
          icon={BarChart3}
          label={t.toplamKayitliDeger}
          value={formatCurrency(stats.kayitliDeger)}
          color="bg-green-100 text-green-700"
        />
        <StatCard
          icon={TrendingDown}
          label={t.toplamDefterDeger}
          value={formatCurrency(stats.defterDeger)}
          color="bg-indigo-100 text-indigo-700"
        />
        <StatCard
          icon={Calendar}
          label={t.birikmisSalinma}
          value={formatCurrency(stats.birikmisSalinma)}
          color="bg-orange-100 text-orange-700"
        />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-[#F5F5F7] rounded-xl p-1 w-fit">
        {(['varliklar', 'amortisman'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              'px-4 py-1.5 text-sm font-medium rounded-lg transition-all',
              activeTab === tab
                ? 'bg-white text-[#1D1D1F] shadow-sm'
                : 'text-[#86868B] hover:text-[#1D1D1F]'
            )}
          >
            {tab === 'varliklar' ? t.tabVarliklar : t.tabAmortisman}
          </button>
        ))}
      </div>

      {/* Tab: Varlıklar */}
      {activeTab === 'varliklar' && (
        <motion.div
          className="space-y-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.2 }}
        >
          {/* Filters */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#86868B]" />
              <input
                className="apple-input w-full pl-9 pr-4 py-2 text-sm"
                placeholder={t.ara}
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            <select
              className="apple-input px-3 py-2 text-sm min-w-[160px]"
              value={filterKategori}
              onChange={e => setFilterKategori(e.target.value)}
            >
              <option value="">{t.tumKategoriler}</option>
              {Object.keys(KATEGORI_CONFIG).map(k => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
            <select
              className="apple-input px-3 py-2 text-sm min-w-[140px]"
              value={filterDurum}
              onChange={e => setFilterDurum(e.target.value)}
            >
              <option value="">{t.tumDurumlar}</option>
              {(Object.keys(DURUM_CONFIG) as SabitKiymet['durum'][]).map(d => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>

          {/* Table */}
          <div className="apple-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px]">
                <thead className="bg-[#F5F5F7] border-b border-gray-200">
                  <tr>
                    <SortTh label={t.barkod} sortKey="barkod" current={sort} onSort={handleSort} />
                    <SortTh label={t.ad} sortKey="ad" current={sort} onSort={handleSort} />
                    <SortTh label={t.kategori} sortKey="kategori" current={sort} onSort={handleSort} />
                    <SortTh label={t.alisTarihi} sortKey="alisTarihi" current={sort} onSort={handleSort} />
                    <SortTh label={t.alisFiyati} sortKey="alisFiyati" current={sort} onSort={handleSort} />
                    <SortTh label={t.yillikAmort} sortKey="yillikAmort" current={sort} onSort={handleSort} />
                    <th className="px-4 py-3 text-left text-[10px] font-bold text-[#86868B] uppercase tracking-wider">
                      {t.birikmiS}
                    </th>
                    <th className="px-4 py-3 text-left text-[10px] font-bold text-[#86868B] uppercase tracking-wider">
                      {t.netDefter}
                    </th>
                    <SortTh label={t.sorumlu} sortKey="sorumlu" current={sort} onSort={handleSort} />
                    <SortTh label={t.durum} sortKey="durum" current={sort} onSort={handleSort} />
                    <th className="px-4 py-3 text-left text-[10px] font-bold text-[#86868B] uppercase tracking-wider">
                      {t.islemler}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {loading ? (
                    <tr>
                      <td colSpan={11} className="px-4 py-8 text-center text-sm text-[#86868B]">
                        <div className="flex justify-center">
                          <div className="w-5 h-5 border-2 border-[#ff4000] border-t-transparent rounded-full animate-spin" />
                        </div>
                      </td>
                    </tr>
                  ) : filtered.length === 0 ? (
                    <tr>
                      <td colSpan={11} className="px-4 py-10 text-center text-sm text-[#86868B]">
                        {t.noData}
                      </td>
                    </tr>
                  ) : (
                    filtered.map((item, idx) => {
                      const birikmiS = calcBirikmisSalinma(item);
                      const netDefter = calcNetDegerDefter(item);
                      const yillikAmort = calcYillikAmortisman(item);
                      return (
                        <motion.tr
                          key={item.id}
                          className="hover:bg-[#F5F5F7]/60 transition-colors"
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: idx * 0.03, duration: 0.2 }}
                        >
                          <td className="px-4 py-3 text-xs font-mono text-[#86868B]">{item.barkod}</td>
                          <td className="px-4 py-3">
                            <div className="font-medium text-sm text-[#1D1D1F]">{item.ad}</div>
                            {(item.marka || item.model) && (
                              <div className="text-[11px] text-[#86868B]">
                                {[item.marka, item.model].filter(Boolean).join(' / ')}
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <KategoriBadge kategori={item.kategori} />
                          </td>
                          <td className="px-4 py-3 text-sm text-[#1D1D1F] whitespace-nowrap">
                            {formatDateTR(item.alisTarihi)}
                          </td>
                          <td className="px-4 py-3 text-sm font-medium text-[#1D1D1F] whitespace-nowrap">
                            {formatCurrency(item.alisFiyati)}
                          </td>
                          <td className="px-4 py-3 text-sm text-[#1D1D1F] whitespace-nowrap">
                            {formatCurrency(yillikAmort)}
                          </td>
                          <td className="px-4 py-3 text-sm text-orange-600 whitespace-nowrap">
                            {formatCurrency(birikmiS)}
                          </td>
                          <td className="px-4 py-3 text-sm font-semibold text-green-700 whitespace-nowrap">
                            {formatCurrency(netDefter)}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1.5 text-sm text-[#1D1D1F]">
                              <User className="w-3 h-3 text-[#86868B] flex-shrink-0" />
                              <span className="truncate max-w-[100px]">{item.sorumlu || '-'}</span>
                            </div>
                            {item.konum && (
                              <div className="flex items-center gap-1 text-[11px] text-[#86868B] mt-0.5">
                                <MapPin className="w-2.5 h-2.5 flex-shrink-0" />
                                <span className="truncate max-w-[100px]">{item.konum}</span>
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <DurumBadge durum={item.durum} t={t} />
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1">
                              {isAuthenticated && (
                                <>
                                  <button
                                    className="p-1.5 rounded-lg hover:bg-blue-50 text-[#86868B] hover:text-blue-600 transition-colors"
                                    title={t.zimmetVer}
                                    onClick={() => openZimmet(item)}
                                  >
                                    <User className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    className="p-1.5 rounded-lg hover:bg-[#F5F5F7] text-[#86868B] hover:text-[#1D1D1F] transition-colors"
                                    title={t.duzenle}
                                    onClick={() => openEdit(item)}
                                  >
                                    <Edit2 className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    className="p-1.5 rounded-lg hover:bg-red-50 text-[#86868B] hover:text-red-500 transition-colors"
                                    title={t.sil}
                                    onClick={() => setDeleteTarget(item)}
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </motion.tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </motion.div>
      )}

      {/* Tab: Amortisman Takvimi */}
      {activeTab === 'amortisman' && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.2 }}
        >
          <div className="apple-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px]">
                <thead className="bg-[#F5F5F7] border-b border-gray-200">
                  <tr>
                    <th className="px-4 py-3 text-left text-[10px] font-bold text-[#86868B] uppercase tracking-wider">
                      {t.amortTabVarlik}
                    </th>
                    {[1, 2, 3, 4, 5].map(y => (
                      <th
                        key={y}
                        className="px-4 py-3 text-right text-[10px] font-bold text-[#86868B] uppercase tracking-wider"
                      >
                        {y === 1
                          ? t.amortTabYil1
                          : y === 2
                          ? t.amortTabYil2
                          : y === 3
                          ? t.amortTabYil3
                          : y === 4
                          ? t.amortTabYil4
                          : t.amortTabYil5}
                      </th>
                    ))}
                    <th className="px-4 py-3 text-right text-[10px] font-bold text-[#86868B] uppercase tracking-wider">
                      {t.amortTabToplam}
                    </th>
                    <th className="px-4 py-3 text-right text-[10px] font-bold text-[#86868B] uppercase tracking-wider">
                      {t.ekonomikOmur}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {loading ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-8 text-center">
                        <div className="flex justify-center">
                          <div className="w-5 h-5 border-2 border-[#ff4000] border-t-transparent rounded-full animate-spin" />
                        </div>
                      </td>
                    </tr>
                  ) : amortRows.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-10 text-center text-sm text-[#86868B]">
                        {t.amortNoData}
                      </td>
                    </tr>
                  ) : (
                    amortRows.map(({ item, yillar }, idx) => {
                      const toplam = yillar.reduce((s, v) => s + v, 0);
                      return (
                        <motion.tr
                          key={item.id}
                          className="hover:bg-[#F5F5F7]/60 transition-colors"
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: idx * 0.03, duration: 0.2 }}
                        >
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <KategoriBadge kategori={item.kategori} />
                              <span className="font-medium text-sm text-[#1D1D1F]">{item.ad}</span>
                            </div>
                            <div className="text-[11px] text-[#86868B] mt-0.5 font-mono">{item.barkod}</div>
                          </td>
                          {yillar.map((v, i) => (
                            <td
                              key={i}
                              className={cn(
                                'px-4 py-3 text-right text-sm',
                                v > 0 ? 'text-orange-600 font-medium' : 'text-[#86868B]'
                              )}
                            >
                              {v > 0 ? formatCurrency(v) : '—'}
                            </td>
                          ))}
                          <td className="px-4 py-3 text-right text-sm font-bold text-[#1D1D1F]">
                            {formatCurrency(toplam)}
                          </td>
                          <td className="px-4 py-3 text-right text-sm text-[#86868B] whitespace-nowrap">
                            {formatDateTR(calcEkonomikOmurSonu(item))}
                          </td>
                        </motion.tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </motion.div>
      )}

      {/* ── Add/Edit Panel ── */}
      <AnimatePresence>
        {panelOpen && (
          <>
            <motion.div
              className="fixed inset-0 bg-black/30 z-40"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={closePanel}
            />
            <motion.div
              className="fixed top-0 right-0 h-full w-full max-w-[480px] bg-white z-50 shadow-2xl overflow-y-auto"
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            >
              <div className="sticky top-0 bg-white/90 backdrop-blur border-b border-gray-100 px-6 py-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-[#1D1D1F]">
                  {editItem ? t.duzenleBaslik : t.yeniDemirbas}
                </h2>
                <button
                  className="p-2 rounded-xl hover:bg-[#F5F5F7] transition-colors"
                  onClick={closePanel}
                >
                  <X className="w-5 h-5 text-[#86868B]" />
                </button>
              </div>
              <div className="p-6 space-y-4">
                {/* Barkod */}
                <div>
                  <label className="block text-xs font-medium text-[#86868B] mb-1">{t.barkod}</label>
                  <input
                    className={inputCls(formErrors.barkod)}
                    value={form.barkod}
                    onChange={e => setForm(f => ({ ...f, barkod: e.target.value }))}
                  />
                  {formErrors.barkod && (
                    <p className="text-xs text-red-500 mt-1">{formErrors.barkod}</p>
                  )}
                </div>
                {/* Ad */}
                <div>
                  <label className="block text-xs font-medium text-[#86868B] mb-1">{t.ad} *</label>
                  <input
                    className={inputCls(formErrors.ad)}
                    value={form.ad}
                    onChange={e => setForm(f => ({ ...f, ad: e.target.value }))}
                  />
                  {formErrors.ad && <p className="text-xs text-red-500 mt-1">{formErrors.ad}</p>}
                </div>
                {/* Kategori */}
                <div>
                  <label className="block text-xs font-medium text-[#86868B] mb-1">{t.kategori}</label>
                  <select
                    className="apple-input w-full px-3 py-2 text-sm"
                    value={form.kategori}
                    onChange={e =>
                      setForm(f => ({ ...f, kategori: e.target.value as SabitKiymet['kategori'] }))
                    }
                  >
                    {(Object.keys(KATEGORI_CONFIG) as SabitKiymet['kategori'][]).map(k => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    ))}
                  </select>
                </div>
                {/* Marka / Model */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-[#86868B] mb-1">{t.marka}</label>
                    <input
                      className="apple-input w-full px-3 py-2 text-sm"
                      value={form.marka}
                      onChange={e => setForm(f => ({ ...f, marka: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[#86868B] mb-1">{t.model}</label>
                    <input
                      className="apple-input w-full px-3 py-2 text-sm"
                      value={form.model}
                      onChange={e => setForm(f => ({ ...f, model: e.target.value }))}
                    />
                  </div>
                </div>
                {/* Seri No */}
                <div>
                  <label className="block text-xs font-medium text-[#86868B] mb-1">{t.seriNo}</label>
                  <input
                    className="apple-input w-full px-3 py-2 text-sm"
                    value={form.seriNo}
                    onChange={e => setForm(f => ({ ...f, seriNo: e.target.value }))}
                  />
                </div>
                {/* Alış Tarihi */}
                <div>
                  <label className="block text-xs font-medium text-[#86868B] mb-1">
                    {t.alisTarihi} *
                  </label>
                  <input
                    type="date"
                    className={inputCls(formErrors.alisTarihi)}
                    value={form.alisTarihi}
                    onChange={e => setForm(f => ({ ...f, alisTarihi: e.target.value }))}
                  />
                </div>
                {/* Alış Fiyatı */}
                <div>
                  <label className="block text-xs font-medium text-[#86868B] mb-1">
                    {t.alisFiyati} *
                  </label>
                  <input
                    type="number"
                    min={0}
                    className={inputCls(formErrors.alisFiyati)}
                    value={form.alisFiyati || ''}
                    onChange={e =>
                      setForm(f => ({ ...f, alisFiyati: parseFloat(e.target.value) || 0 }))
                    }
                  />
                  {formErrors.alisFiyati && (
                    <p className="text-xs text-red-500 mt-1">{formErrors.alisFiyati}</p>
                  )}
                </div>
                {/* Amortisman Yılı */}
                <div>
                  <label className="block text-xs font-medium text-[#86868B] mb-1">
                    {t.amortismanYili} *
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={50}
                    className={inputCls(formErrors.amortismanYili)}
                    value={form.amortismanYili || ''}
                    onChange={e =>
                      setForm(f => ({
                        ...f,
                        amortismanYili: parseInt(e.target.value, 10) || 0,
                      }))
                    }
                  />
                </div>
                {/* Amortisman Yöntemi */}
                <div>
                  <label className="block text-xs font-medium text-[#86868B] mb-1">
                    {t.amortismanYontemi}
                  </label>
                  <select
                    className="apple-input w-full px-3 py-2 text-sm"
                    value={form.amortismanYontemi}
                    onChange={e =>
                      setForm(f => ({
                        ...f,
                        amortismanYontemi: e.target.value as SabitKiymet['amortismanYontemi'],
                      }))
                    }
                  >
                    <option value="Düz Hat">{t.duzHat}</option>
                    <option value="Azalan Bakiye">{t.azalanBakiye}</option>
                  </select>
                </div>
                {/* Konum */}
                <div>
                  <label className="block text-xs font-medium text-[#86868B] mb-1">{t.konum}</label>
                  <input
                    className="apple-input w-full px-3 py-2 text-sm"
                    value={form.konum}
                    onChange={e => setForm(f => ({ ...f, konum: e.target.value }))}
                  />
                </div>
                {/* Sorumlu */}
                <div>
                  <label className="block text-xs font-medium text-[#86868B] mb-1">{t.sorumlu}</label>
                  <input
                    className="apple-input w-full px-3 py-2 text-sm"
                    value={form.sorumlu}
                    onChange={e => setForm(f => ({ ...f, sorumlu: e.target.value }))}
                  />
                </div>
                {/* Durum */}
                <div>
                  <label className="block text-xs font-medium text-[#86868B] mb-1">{t.durum}</label>
                  <select
                    className="apple-input w-full px-3 py-2 text-sm"
                    value={form.durum}
                    onChange={e =>
                      setForm(f => ({ ...f, durum: e.target.value as SabitKiymet['durum'] }))
                    }
                  >
                    {(Object.keys(DURUM_CONFIG) as SabitKiymet['durum'][]).map(d => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </div>
                {/* Notlar */}
                <div>
                  <label className="block text-xs font-medium text-[#86868B] mb-1">{t.notlar}</label>
                  <textarea
                    rows={3}
                    className="apple-input w-full px-3 py-2 text-sm resize-none"
                    value={form.notlar}
                    onChange={e => setForm(f => ({ ...f, notlar: e.target.value }))}
                  />
                </div>
                {/* Actions */}
                <div className="flex gap-3 pt-2">
                  <button
                    className="apple-button-secondary flex-1 py-2 text-sm"
                    onClick={closePanel}
                    disabled={saving}
                  >
                    {t.iptal}
                  </button>
                  <button
                    className="apple-button-primary flex-1 py-2 text-sm flex items-center justify-center gap-2"
                    onClick={handleSave}
                    disabled={saving}
                  >
                    {saving ? (
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    ) : null}
                    {t.kaydet}
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ── Delete Confirm Modal ── */}
      <AnimatePresence>
        {deleteTarget && (
          <motion.div
            className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="apple-card w-full max-w-sm p-6 space-y-4"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                  <AlertTriangle className="w-5 h-5 text-red-600" />
                </div>
                <p className="text-sm text-[#1D1D1F] font-medium">{t.silOnayi}</p>
              </div>
              <div className="flex gap-3">
                <button
                  className="apple-button-secondary flex-1 py-2 text-sm"
                  onClick={() => setDeleteTarget(null)}
                >
                  {t.iptal}
                </button>
                <button
                  className="flex-1 py-2 text-sm font-medium bg-red-500 text-white rounded-full hover:bg-red-600 transition-colors"
                  onClick={handleDelete}
                >
                  {t.evet}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Zimmet Modal ── */}
      <AnimatePresence>
        {zimmetTarget && (
          <motion.div
            className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="apple-card w-full max-w-sm p-6 space-y-4"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
            >
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold text-[#1D1D1F]">{t.zimmetBaslik}</h3>
                <button
                  className="p-1.5 rounded-lg hover:bg-[#F5F5F7] transition-colors"
                  onClick={() => setZimmetTarget(null)}
                >
                  <X className="w-4 h-4 text-[#86868B]" />
                </button>
              </div>
              {/* Asset info */}
              <div className="bg-[#F5F5F7] rounded-xl p-3 text-sm space-y-1">
                <div className="font-medium text-[#1D1D1F]">{zimmetTarget.ad}</div>
                <div className="text-[11px] text-[#86868B] font-mono">{zimmetTarget.barkod}</div>
                <div className="flex items-center gap-1 text-[11px] text-[#86868B]">
                  <User className="w-3 h-3" />
                  {t.sorumlu}: {zimmetTarget.sorumlu || '-'}
                </div>
              </div>
              {/* New assignee */}
              <div>
                <label className="block text-xs font-medium text-[#86868B] mb-1">
                  {t.zimmetYeniSorumlu} *
                </label>
                <input
                  className="apple-input w-full px-3 py-2 text-sm"
                  value={zimmetForm.yeniSorumlu}
                  onChange={e =>
                    setZimmetForm(f => ({ ...f, yeniSorumlu: e.target.value }))
                  }
                />
              </div>
              {/* Date */}
              <div>
                <label className="block text-xs font-medium text-[#86868B] mb-1">
                  {t.zimmetTarih}
                </label>
                <input
                  type="date"
                  className="apple-input w-full px-3 py-2 text-sm"
                  value={zimmetForm.tarih}
                  onChange={e => setZimmetForm(f => ({ ...f, tarih: e.target.value }))}
                />
              </div>
              {/* Note */}
              <div>
                <label className="block text-xs font-medium text-[#86868B] mb-1">{t.zimmetNot}</label>
                <input
                  className="apple-input w-full px-3 py-2 text-sm"
                  value={zimmetForm.not}
                  onChange={e => setZimmetForm(f => ({ ...f, not: e.target.value }))}
                />
              </div>
              {/* Actions */}
              <div className="flex gap-3">
                <button
                  className="apple-button-secondary flex-1 py-2 text-sm"
                  onClick={() => setZimmetTarget(null)}
                  disabled={zimmetSaving}
                >
                  {t.iptal}
                </button>
                <button
                  className="apple-button-primary flex-1 py-2 text-sm flex items-center justify-center gap-2"
                  onClick={handleZimmetKaydet}
                  disabled={zimmetSaving || !zimmetForm.yeniSorumlu.trim()}
                >
                  {zimmetSaving ? (
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <User className="w-4 h-4" />
                  )}
                  {t.zimmetKaydet}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Toast ── */}
      <AnimatePresence>
        {toast && (
          <motion.div
            className="fixed bottom-6 right-6 z-[60] flex items-center gap-3 px-4 py-3 rounded-2xl shadow-lg text-sm font-medium text-white"
            style={{
              background: toast.type === 'success' ? '#34C759' : '#FF3B30',
            }}
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
          >
            {toast.type === 'success' ? (
              <CheckCircle className="w-4 h-4 flex-shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            )}
            {toast.msg}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
