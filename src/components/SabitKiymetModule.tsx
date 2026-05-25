import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Package, Monitor, Building2, Car, Wrench, HelpCircle,
  Plus, Search, X, Edit2, Trash2, FileText,
  ChevronUp, ChevronDown, User, MapPin, Calendar,
  TrendingDown, BarChart3, CheckCircle, AlertTriangle,
  Archive, ShieldCheck, Sofa, Calculator, RefreshCw,
} from 'lucide-react';
import { db } from '../firebase';
import { byField } from '../utils/fsSort';
import {
  collection, addDoc, updateDoc, deleteDoc, doc,
  onSnapshot, query, serverTimestamp,
} from 'firebase/firestore';

// ─── Types ────────────────────────────────────────────────────────────────────

type Kategori = 'Taşıt' | 'Makine' | 'Bilgisayar' | 'Mobilya' | 'Bina' | 'Diğer';
type AmortYontemi = 'Doğrusal' | 'Azalan Bakiyeler';
type ParaBirimi = 'TRY' | 'USD' | 'EUR';
type VarlikDurum = 'Aktif' | 'Bakımda' | 'Elden Çıkarıldı' | 'Hurdaya Ayrıldı';
type BakimTuru = 'Periyodik' | 'Arıza' | 'Genel';
type SigortaDurum = 'Aktif' | 'Süresi Dolmuş' | 'Yenileniyor';

interface SabitKiymet {
  id: string;
  demirbasNo: string;
  ad: string;
  kategori: Kategori;
  alisTarihi: string;
  alisBedeli: number;
  paraBirimi: ParaBirimi;
  amortYontemi: AmortYontemi;
  faydaliOmur: number; // yıl
  birikmisSalinma: number; // manuel override, 0 = hesaplansın
  departman: string;
  durum: VarlikDurum;
}

interface AmortismanKayit {
  id: string;
  varlikId: string;
  varlikAd: string;
  donem: string; // "2025-Q1" vb.
  yillikAmort: number;
  aylikAmort: number;
  birikmisSalinma: number;
  netDegerDefter: number;
  hesaplamaTarihi: string;
}

interface BakimKayit {
  id: string;
  varlikId: string;
  varlikAd: string;
  bakimTarihi: string;
  bakimTuru: BakimTuru;
  yapilanIslem: string;
  maliyet: number;
  sonrakiBakimTarihi: string;
}

interface SigortaKayit {
  id: string;
  varlikId: string;
  varlikAd: string;
  policeNo: string;
  sigortaSirketi: string;
  baslangicTarihi: string;
  bitisTarihi: string;
  primTutari: number;
  teminatTutari: number;
  durum: SigortaDurum;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const cn = (...classes: unknown[]) => classes.filter(Boolean).join(' ');

const formatTRY = (val: number) =>
  new Intl.NumberFormat('tr-TR', {
    style: 'currency', currency: 'TRY',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(val);

const formatDateTR = (str: string): string => {
  if (!str) return '-';
  const d = new Date(str);
  if (isNaN(d.getTime())) return str;
  return d.toLocaleDateString('tr-TR');
};

function calcYillikAmort(item: SabitKiymet): number {
  if (item.faydaliOmur <= 0) return 0;
  if (item.amortYontemi === 'Doğrusal') {
    return item.alisBedeli / item.faydaliOmur;
  }
  // Azalan Bakiyeler: oran = 2 / ömür, yıllık = (alisBedeli - birikmiş) * oran
  const oran = 2 / item.faydaliOmur;
  const kalanDeger = Math.max(0, item.alisBedeli - calcBirikmisSalinma(item));
  return kalanDeger * oran;
}

function calcBirikmisSalinma(item: SabitKiymet): number {
  if (!item.alisTarihi) return 0;
  const alis = new Date(item.alisTarihi);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  if (isNaN(alis.getTime())) return 0;
  const yilGecen = (now.getTime() - alis.getTime()) / (1000 * 60 * 60 * 24 * 365.25);
  if (yilGecen <= 0) return 0;
  const yilCapped = Math.min(yilGecen, item.faydaliOmur);
  if (item.amortYontemi === 'Doğrusal') {
    return (item.alisBedeli / item.faydaliOmur) * yilCapped;
  }
  // Azalan Bakiyeler DDB
  const oran = 2 / item.faydaliOmur;
  let kalan = item.alisBedeli;
  let toplam = 0;
  const tamYil = Math.floor(yilCapped);
  for (let i = 0; i < tamYil; i++) {
    const a = kalan * oran;
    toplam += a;
    kalan -= a;
  }
  const kesir = yilCapped - tamYil;
  if (kesir > 0) toplam += kalan * oran * kesir;
  return Math.min(toplam, item.alisBedeli);
}

function calcNetDeger(item: SabitKiymet): number {
  return Math.max(0, item.alisBedeli - calcBirikmisSalinma(item));
}

function calcAylikAmort(item: SabitKiymet): number {
  return calcYillikAmort(item) / 12;
}

function generateDemirbasNo(existing: SabitKiymet[]): string {
  const nums = existing
    .filter(e => e.demirbasNo?.startsWith('DMB-'))
    .map(e => parseInt(e.demirbasNo.replace('DMB-', ''), 10))
    .filter(n => !isNaN(n));
  const next = nums.length > 0 ? Math.max(...nums) + 1 : 1;
  return `DMB-${String(next).padStart(4, '0')}`;
}

function daysUntil(dateStr: string): number {
  const d = new Date(dateStr);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.ceil((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

// ─── Config maps ──────────────────────────────────────────────────────────────

const KATEGORI_CFG: Record<Kategori, { icon: React.ElementType; bg: string; text: string; border: string }> = {
  Taşıt:      { icon: Car,        bg: 'bg-blue-100',   text: 'text-blue-700',   border: 'border-blue-200'   },
  Makine:     { icon: Wrench,     bg: 'bg-orange-100', text: 'text-orange-700', border: 'border-orange-200' },
  Bilgisayar: { icon: Monitor,    bg: 'bg-indigo-100', text: 'text-indigo-700', border: 'border-indigo-200' },
  Mobilya:    { icon: Sofa,       bg: 'bg-yellow-100', text: 'text-yellow-700', border: 'border-yellow-200' },
  Bina:       { icon: Building2,  bg: 'bg-gray-100',   text: 'text-gray-700',   border: 'border-gray-200'   },
  Diğer:      { icon: HelpCircle, bg: 'bg-slate-100',  text: 'text-slate-600',  border: 'border-slate-200'  },
};

const DURUM_CFG: Record<VarlikDurum, { bg: string; text: string; dot: string }> = {
  'Aktif':           { bg: 'bg-green-100', text: 'text-green-700', dot: 'bg-green-500'  },
  'Bakımda':         { bg: 'bg-amber-100', text: 'text-amber-700', dot: 'bg-amber-500'  },
  'Elden Çıkarıldı': { bg: 'bg-red-100',   text: 'text-red-700',   dot: 'bg-red-500'    },
  'Hurdaya Ayrıldı': { bg: 'bg-red-100',   text: 'text-red-700',   dot: 'bg-red-500'    },
};

// ─── Bilingual labels ─────────────────────────────────────────────────────────

const LABELS = {
  title:                { tr: 'Sabit Kıymetler / Demirbaşlar',      en: 'Fixed Assets' },
  subtitle:             { tr: 'Varlık kaydı, amortisman ve sigorta yönetimi', en: 'Asset register, depreciation & insurance management' },
  tabVarliklar:         { tr: 'Varlıklar',          en: 'Assets'             },
  tabAmortisman:        { tr: 'Amortisman',          en: 'Depreciation'       },
  tabBakim:             { tr: 'Bakım Geçmişi',       en: 'Maintenance History'},
  tabSigorta:           { tr: 'Sigorta & Belgeler',  en: 'Insurance & Docs'   },
  toplamVarlik:         { tr: 'Toplam Varlık',       en: 'Total Assets'       },
  toplamDegerLabel:     { tr: 'Toplam Defter Değeri',en: 'Total Book Value'   },
  toplamAmort:          { tr: 'Birikmiş Amortisman', en: 'Accumulated Depr.'  },
  yeniVarlik:           { tr: 'Yeni Varlık',         en: 'New Asset'          },
  ara:                  { tr: 'Varlık veya departman ara…', en: 'Search asset or dept…' },
  tumKategoriler:       { tr: 'Tüm Kategoriler',     en: 'All Categories'     },
  tumDurumlar:          { tr: 'Tüm Durumlar',        en: 'All Statuses'       },
  demirbasNo:           { tr: 'Demirbaş No',          en: 'Asset No'           },
  ad:                   { tr: 'Varlık Adı',           en: 'Asset Name'         },
  kategori:             { tr: 'Kategori',             en: 'Category'           },
  alisTarihi:           { tr: 'Alış Tarihi',          en: 'Purchase Date'      },
  alisBedeli:           { tr: 'Alış Bedeli',          en: 'Purchase Value'     },
  paraBirimi:           { tr: 'Para Birimi',          en: 'Currency'           },
  amortYontemi:         { tr: 'Amortisman Yöntemi',  en: 'Depreciation Method'},
  faydaliOmur:          { tr: 'Faydalı Ömür (Yıl)',  en: 'Useful Life (Yrs)'  },
  birikmisSalinma:      { tr: 'Birikmiş Amortisman', en: 'Accum. Depreciation' },
  netDegerDefter:       { tr: 'Net Defter Değeri',    en: 'Net Book Value'     },
  departman:            { tr: 'Departman / Konum',    en: 'Dept / Location'    },
  durum:                { tr: 'Durum',                en: 'Status'             },
  islemler:             { tr: 'İşlemler',             en: 'Actions'            },
  yillikAmort:          { tr: 'Yıllık Amortisman',   en: 'Annual Depr.'       },
  aylikAmort:           { tr: 'Aylık Amortisman',     en: 'Monthly Depr.'      },
  donemHesapla:         { tr: 'Dönem Amortismanı Hesapla', en: 'Calculate Period Depreciation' },
  hesaplandı:           { tr: 'Amortisman kayıtları güncellendi.', en: 'Depreciation entries updated.' },
  varlikAd:             { tr: 'Varlık Adı',           en: 'Asset Name'         },
  bakimTarihi:          { tr: 'Bakım Tarihi',         en: 'Maint. Date'        },
  bakimTuru:            { tr: 'Bakım Türü',           en: 'Maint. Type'        },
  yapilanIslem:         { tr: 'Yapılan İşlem',        en: 'Work Done'          },
  maliyet:              { tr: 'Maliyet',              en: 'Cost'               },
  sonrakiBakim:         { tr: 'Sonraki Bakım',        en: 'Next Service'       },
  yeniBakim:            { tr: 'Yeni Bakım Kaydı',     en: 'New Maintenance'    },
  policeNo:             { tr: 'Poliçe No',             en: 'Policy No'          },
  sigortaSirketi:       { tr: 'Sigorta Şirketi',      en: 'Insurer'            },
  baslangicTarihi:      { tr: 'Başlangıç Tarihi',     en: 'Start Date'         },
  bitisTarihi:          { tr: 'Bitiş Tarihi',         en: 'End Date'           },
  primTutari:           { tr: 'Prim Tutarı',          en: 'Premium'            },
  teminatTutari:        { tr: 'Teminat Tutarı',       en: 'Coverage'           },
  yeniSigorta:          { tr: 'Yeni Sigorta Kaydı',   en: 'New Insurance'      },
  sigortaDurum:         { tr: 'Sigorta Durumu',       en: 'Policy Status'      },
  yakindaVadesi:        { tr: '30 gün içinde sona eriyor', en: 'Expires within 30 days' },
  kaydet:               { tr: 'Kaydet',               en: 'Save'               },
  iptal:                { tr: 'İptal',                en: 'Cancel'             },
  sil:                  { tr: 'Sil',                  en: 'Delete'             },
  duzenle:              { tr: 'Düzenle',              en: 'Edit'               },
  silOnayiMesaj:        { tr: 'Bu kaydı silmek istediğinize emin misiniz?', en: 'Are you sure you want to delete this record?' },
  evetSil:              { tr: 'Evet, Sil',            en: 'Yes, Delete'        },
  zorunlu:              { tr: 'Zorunlu alan',         en: 'Required field'     },
  kayitYok:             { tr: 'Kayıt bulunamadı.',    en: 'No records found.'  },
  basarili:             { tr: 'İşlem başarılı.',      en: 'Operation successful.' },
  hata:                 { tr: 'Bir hata oluştu.',     en: 'An error occurred.' },
  adet:                 { tr: 'adet',                 en: 'items'              },
  dogrusal:             { tr: 'Doğrusal',             en: 'Straight-Line'      },
  azalanBakiyeler:      { tr: 'Azalan Bakiyeler',     en: 'Declining Balance'  },
  aktif:                { tr: 'Aktif',                en: 'Active'             },
  bakimda:              { tr: 'Bakımda',              en: 'In Maintenance'     },
  eldenCikarildi:       { tr: 'Elden Çıkarıldı',      en: 'Disposed'           },
  hurdayaAyrildi:       { tr: 'Hurdaya Ayrıldı',      en: 'Scrapped'           },
  sigAktif:             { tr: 'Aktif',                en: 'Active'             },
  sigSüresiDolmus:      { tr: 'Süresi Dolmuş',        en: 'Expired'            },
  sigYenileniyor:       { tr: 'Yenileniyor',          en: 'Renewing'           },
  periyodik:            { tr: 'Periyodik',            en: 'Periodic'           },
  ariza:                { tr: 'Arıza',                en: 'Breakdown'          },
  genel:                { tr: 'Genel',                en: 'General'            },
  notlar:               { tr: 'Notlar',               en: 'Notes'              },
};

type LabelKey = keyof typeof LABELS;
function t(key: LabelKey, lang: string): string {
  const entry = LABELS[key];
  return (entry as Record<string, string>)[lang === 'tr' ? 'tr' : 'en'] ?? key;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function KategoriBadge({ kategori }: { kategori: Kategori }) {
  const cfg = KATEGORI_CFG[kategori];
  const Icon = cfg.icon;
  return (
    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border', cfg.bg, cfg.text, cfg.border)}>
      <Icon className="w-3 h-3" />{kategori}
    </span>
  );
}

function DurumBadge({ durum }: { durum: VarlikDurum }) {
  const cfg = DURUM_CFG[durum];
  return (
    <span className={cn('inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium', cfg.bg, cfg.text)}>
      <span className={cn('w-1.5 h-1.5 rounded-full', cfg.dot)} />
      {durum}
    </span>
  );
}

function SortTh({ label, sortKey, current, onSort }: {
  label: string;
  sortKey: string;
  current: { key: string; dir: 'asc' | 'desc' };
  onSort: (k: string) => void;
}) {
  const active = current.key === sortKey;
  return (
    <th onClick={() => onSort(sortKey)}
      className="px-4 py-3 text-left text-[10px] font-bold text-[#86868B] uppercase tracking-wider cursor-pointer hover:bg-gray-50 select-none">
      <span className="flex items-center gap-1">
        {label}
        {active
          ? current.dir === 'asc'
            ? <ChevronUp className="w-3 h-3 text-[#ff4000]" />
            : <ChevronDown className="w-3 h-3 text-[#ff4000]" />
          : <ChevronDown className="w-3 h-3 text-gray-300" />}
      </span>
    </th>
  );
}

function StatCard({ icon: Icon, label, value, color }: {
  icon: React.ElementType; label: string; value: string; color: string;
}) {
  return (
    <motion.div className="apple-card p-5 flex items-center gap-4"
      initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
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

// ─── Empty forms ──────────────────────────────────────────────────────────────

const emptyVarlik = (): Omit<SabitKiymet, 'id'> => ({
  demirbasNo: '',
  ad: '',
  kategori: 'Diğer' as Kategori,
  alisTarihi: new Date().toISOString().split('T')[0],
  alisBedeli: 0,
  paraBirimi: 'TRY' as ParaBirimi,
  amortYontemi: 'Doğrusal' as AmortYontemi,
  faydaliOmur: 5,
  birikmisSalinma: 0,
  departman: '',
  durum: 'Aktif' as VarlikDurum,
});

const emptyBakim = (): Omit<BakimKayit, 'id'> => ({
  varlikId: '',
  varlikAd: '',
  bakimTarihi: new Date().toISOString().split('T')[0],
  bakimTuru: 'Periyodik' as BakimTuru,
  yapilanIslem: '',
  maliyet: 0,
  sonrakiBakimTarihi: '',
});

const emptySigorta = (): Omit<SigortaKayit, 'id'> => ({
  varlikId: '',
  varlikAd: '',
  policeNo: '',
  sigortaSirketi: '',
  baslangicTarihi: new Date().toISOString().split('T')[0],
  bitisTarihi: '',
  primTutari: 0,
  teminatTutari: 0,
  durum: 'Aktif' as SigortaDurum,
});

// ─── Main Component ───────────────────────────────────────────────────────────

export default function SabitKiymetModule({
  currentLanguage,
  isAuthenticated,
}: {
  currentLanguage: string;
  isAuthenticated: boolean;
}) {
  const tr = currentLanguage === 'tr';
  const L = (key: LabelKey) => t(key, currentLanguage);

  // ── Data ──────────────────────────────────────────────────────────────────
  const [varliklar, setVarliklar] = useState<SabitKiymet[]>([]);
  const [amortKayitlar, setAmortKayitlar] = useState<AmortismanKayit[]>([]);
  const [bakimlar, setBakimlar] = useState<BakimKayit[]>([]);
  const [sigortalar, setSigortalar] = useState<SigortaKayit[]>([]);
  const [loading, setLoading] = useState(true);

  // ── UI ────────────────────────────────────────────────────────────────────
  type Tab = 'varliklar' | 'amortisman' | 'bakim' | 'sigorta';
  const [activeTab, setActiveTab] = useState<Tab>('varliklar');
  const [search, setSearch] = useState('');
  const [filterKat, setFilterKat] = useState('');
  const [filterDurum, setFilterDurum] = useState('');
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'alisTarihi', dir: 'desc' });

  // ── Modals ────────────────────────────────────────────────────────────────
  const [varlikPanel, setVarlikPanel] = useState(false);
  const [editVarlik, setEditVarlik] = useState<SabitKiymet | null>(null);
  const [varlikForm, setVarlikForm] = useState<Omit<SabitKiymet, 'id'>>(emptyVarlik());
  const [varlikErrors, setVarlikErrors] = useState<Partial<Record<keyof SabitKiymet, string>>>({});

  const [bakimPanel, setBakimPanel] = useState(false);
  const [editBakim, setEditBakim] = useState<BakimKayit | null>(null);
  const [bakimForm, setBakimForm] = useState<Omit<BakimKayit, 'id'>>(emptyBakim());

  const [sigortaPanel, setSigortaPanel] = useState(false);
  const [editSigorta, setEditSigorta] = useState<SigortaKayit | null>(null);
  const [sigortaForm, setSigortaForm] = useState<Omit<SigortaKayit, 'id'>>(emptySigorta());

  const [deleteTarget, setDeleteTarget] = useState<{ id: string; col: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [amortCalcing, setAmortCalcing] = useState(false);

  // ── Toast ─────────────────────────────────────────────────────────────────
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const showToast = useCallback((msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3200);
  }, []);

  // ── Firestore listeners ───────────────────────────────────────────────────
  useEffect(() => {
    if (!isAuthenticated) { setLoading(false); return; }
    const unsubs: (() => void)[] = [];

    const q1 = query(collection(db, 'sabitKiymetler'));
    unsubs.push(onSnapshot(q1, snap => {
      setVarliklar(snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<SabitKiymet, 'id'>) })));
      setLoading(false);
    }, err => { console.error('sabitKiymetler:', err); setLoading(false); }));

    const q2 = query(collection(db, 'amortismanKayitlari'));
    unsubs.push(onSnapshot(q2, snap => {
      setAmortKayitlar(snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<AmortismanKayit, 'id'>) })));
    }, err => console.error('amortismanKayitlari:', err)));

    const q3 = query(collection(db, 'sabitKiymetBakim'));
    unsubs.push(onSnapshot(q3, snap => {
      setBakimlar(snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<BakimKayit, 'id'>) })));
    }, err => console.error('sabitKiymetBakim:', err)));

    const q4 = query(collection(db, 'sabitKiymetSigorta'));
    unsubs.push(onSnapshot(q4, snap => {
      setSigortalar(snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<SigortaKayit, 'id'>) })));
    }, err => console.error('sabitKiymetSigorta:', err)));

    return () => unsubs.forEach(u => u());
  }, [isAuthenticated]);

  // ── KPI stats ─────────────────────────────────────────────────────────────
  const aktifVarliklar = varliklar.filter(v => v.durum === 'Aktif');
  const kpi = {
    count: varliklar.length,
    toplamDeger: aktifVarliklar.reduce((s, v) => s + calcNetDeger(v), 0),
    toplamBirikmiS: aktifVarliklar.reduce((s, v) => s + calcBirikmisSalinma(v), 0),
  };

  // ── Filtering & sorting (Varlıklar) ───────────────────────────────────────
  const filtered = varliklar.filter(v => {
    const q = search.toLowerCase();
    if (q && !v.ad.toLowerCase().includes(q) && !v.demirbasNo.toLowerCase().includes(q) && !v.departman.toLowerCase().includes(q)) return false;
    if (filterKat && v.kategori !== filterKat) return false;
    if (filterDurum && v.durum !== filterDurum) return false;
    return true;
  }).sort((a, b) => {
    const k = sort.key as keyof SabitKiymet;
    const va = (a[k] as string | number) ?? '';
    const vb = (b[k] as string | number) ?? '';
    if (va < vb) return sort.dir === 'asc' ? -1 : 1;
    if (va > vb) return sort.dir === 'asc' ? 1 : -1;
    return 0;
  });

  const handleSort = (key: string) => {
    setSort(prev => ({ key, dir: prev.key === key && prev.dir === 'asc' ? 'desc' : 'asc' }));
  };

  // ── Varlık form handlers ──────────────────────────────────────────────────
  const openAddVarlik = () => {
    const draft = emptyVarlik();
    draft.demirbasNo = generateDemirbasNo(varliklar);
    setVarlikForm(draft);
    setEditVarlik(null);
    setVarlikErrors({});
    setVarlikPanel(true);
  };

  const openEditVarlik = (item: SabitKiymet) => {
    const { id, ...rest } = item;
    setVarlikForm({ ...rest });
    setEditVarlik(item);
    setVarlikErrors({});
    setVarlikPanel(true);
  };

  const validateVarlik = (): boolean => {
    const errs: Partial<Record<keyof SabitKiymet, string>> = {};
    if (!varlikForm.ad.trim()) errs.ad = L('zorunlu');
    if (!varlikForm.demirbasNo.trim()) errs.demirbasNo = L('zorunlu');
    if (!varlikForm.alisTarihi) errs.alisTarihi = L('zorunlu');
    if (varlikForm.alisBedeli <= 0) errs.alisBedeli = L('zorunlu');
    if (varlikForm.faydaliOmur <= 0) errs.faydaliOmur = L('zorunlu');
    setVarlikErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSaveVarlik = async () => {
    if (!validateVarlik()) return;
    setSaving(true);
    try {
      if (editVarlik) {
        await updateDoc(doc(db, 'sabitKiymetler', editVarlik.id), { ...varlikForm, updatedAt: serverTimestamp() });
      } else {
        await addDoc(collection(db, 'sabitKiymetler'), { ...varlikForm, createdAt: serverTimestamp() });
      }
      showToast(L('basarili'));
      setVarlikPanel(false);
    } catch (err) {
      console.error(err);
      showToast(L('hata'), 'error');
    } finally {
      setSaving(false);
    }
  };

  // ── Amortisman hesapla ────────────────────────────────────────────────────
  const handleDonemHesapla = async () => {
    const aktif = varliklar.filter(v => v.durum === 'Aktif');
    if (aktif.length === 0) return;
    setAmortCalcing(true);
    try {
      const now = new Date();
      const donem = `${now.getFullYear()}-Q${Math.ceil((now.getMonth() + 1) / 3)}`;
      await Promise.all(aktif.map(item =>
        addDoc(collection(db, 'amortismanKayitlari'), {
          varlikId: item.id,
          varlikAd: item.ad,
          donem,
          yillikAmort: calcYillikAmort(item),
          aylikAmort: calcAylikAmort(item),
          birikmisSalinma: calcBirikmisSalinma(item),
          netDegerDefter: calcNetDeger(item),
          hesaplamaTarihi: now.toISOString().split('T')[0],
          createdAt: serverTimestamp(),
        })
      ));
      showToast(L('hesaplandı'));
    } catch (err) {
      console.error(err);
      showToast(L('hata'), 'error');
    } finally {
      setAmortCalcing(false);
    }
  };

  // ── Bakım form handlers ───────────────────────────────────────────────────
  const openAddBakim = () => {
    setBakimForm(emptyBakim());
    setEditBakim(null);
    setBakimPanel(true);
  };

  const openEditBakim = (item: BakimKayit) => {
    const { id, ...rest } = item;
    setBakimForm({ ...rest });
    setEditBakim(item);
    setBakimPanel(true);
  };

  const handleSaveBakim = async () => {
    if (!bakimForm.varlikAd.trim() || !bakimForm.bakimTarihi) return;
    setSaving(true);
    try {
      if (editBakim) {
        await updateDoc(doc(db, 'sabitKiymetBakim', editBakim.id), { ...bakimForm, updatedAt: serverTimestamp() });
      } else {
        await addDoc(collection(db, 'sabitKiymetBakim'), { ...bakimForm, createdAt: serverTimestamp() });
      }
      showToast(L('basarili'));
      setBakimPanel(false);
    } catch (err) {
      console.error(err);
      showToast(L('hata'), 'error');
    } finally {
      setSaving(false);
    }
  };

  // ── Sigorta form handlers ─────────────────────────────────────────────────
  const openAddSigorta = () => {
    setSigortaForm(emptySigorta());
    setEditSigorta(null);
    setSigortaPanel(true);
  };

  const openEditSigorta = (item: SigortaKayit) => {
    const { id, ...rest } = item;
    setSigortaForm({ ...rest });
    setEditSigorta(item);
    setSigortaPanel(true);
  };

  const handleSaveSigorta = async () => {
    if (!sigortaForm.varlikAd.trim() || !sigortaForm.policeNo.trim()) return;
    setSaving(true);
    try {
      if (editSigorta) {
        await updateDoc(doc(db, 'sabitKiymetSigorta', editSigorta.id), { ...sigortaForm, updatedAt: serverTimestamp() });
      } else {
        await addDoc(collection(db, 'sabitKiymetSigorta'), { ...sigortaForm, createdAt: serverTimestamp() });
      }
      showToast(L('basarili'));
      setSigortaPanel(false);
    } catch (err) {
      console.error(err);
      showToast(L('hata'), 'error');
    } finally {
      setSaving(false);
    }
  };

  // ── Delete ────────────────────────────────────────────────────────────────
  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteDoc(doc(db, deleteTarget.col, deleteTarget.id));
      showToast(L('basarili'));
    } catch (err) {
      console.error(err);
      showToast(L('hata'), 'error');
    } finally {
      setDeleteTarget(null);
    }
  };

  // ── Helpers ───────────────────────────────────────────────────────────────
  const inputCls = (err?: string) => cn('apple-input w-full px-3 py-2 text-sm', err && 'ring-2 ring-red-400');

  const TABS: { key: Tab; label: string; icon: React.ElementType }[] = [
    { key: 'varliklar',  label: L('tabVarliklar'),  icon: Package   },
    { key: 'amortisman', label: L('tabAmortisman'), icon: TrendingDown },
    { key: 'bakim',      label: L('tabBakim'),      icon: Wrench    },
    { key: 'sigorta',    label: L('tabSigorta'),    icon: ShieldCheck },
  ];

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6 p-6">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#1D1D1F]">{L('title')}</h1>
          <p className="text-sm text-[#86868B] mt-0.5">{L('subtitle')}</p>
        </div>
        {isAuthenticated && activeTab === 'varliklar' && (
          <button className="apple-button-primary text-sm px-4 py-2 flex items-center gap-2" onClick={openAddVarlik}>
            <Plus className="w-4 h-4" />{L('yeniVarlik')}
          </button>
        )}
        {isAuthenticated && activeTab === 'bakim' && (
          <button className="apple-button-primary text-sm px-4 py-2 flex items-center gap-2" onClick={openAddBakim}>
            <Plus className="w-4 h-4" />{L('yeniBakim')}
          </button>
        )}
        {isAuthenticated && activeTab === 'sigorta' && (
          <button className="apple-button-primary text-sm px-4 py-2 flex items-center gap-2" onClick={openAddSigorta}>
            <Plus className="w-4 h-4" />{L('yeniSigorta')}
          </button>
        )}
        {isAuthenticated && activeTab === 'amortisman' && (
          <button
            className="apple-button-primary text-sm px-4 py-2 flex items-center gap-2 disabled:opacity-60"
            onClick={handleDonemHesapla}
            disabled={amortCalcing}
          >
            {amortCalcing
              ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              : <Calculator className="w-4 h-4" />}
            {L('donemHesapla')}
          </button>
        )}
      </div>

      {/* KPI strip — only on Varlıklar tab */}
      {activeTab === 'varliklar' && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatCard icon={Package}    label={L('toplamVarlik')}    value={`${kpi.count} ${L('adet')}`}    color="bg-blue-100 text-blue-700" />
          <StatCard icon={BarChart3}  label={L('toplamDegerLabel')} value={formatTRY(kpi.toplamDeger)}    color="bg-green-100 text-green-700" />
          <StatCard icon={TrendingDown} label={L('toplamAmort')}   value={formatTRY(kpi.toplamBirikmiS)} color="bg-orange-100 text-orange-700" />
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-[#F5F5F7] rounded-xl p-1 w-fit flex-wrap">
        {TABS.map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            className={cn(
              'flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium rounded-lg transition-all',
              activeTab === tab.key ? 'bg-white text-[#1D1D1F] shadow-sm' : 'text-[#86868B] hover:text-[#1D1D1F]'
            )}>
            <tab.icon className="w-3.5 h-3.5" />{tab.label}
          </button>
        ))}
      </div>

      {/* ══════════════════════════ TAB: VARLIKLAR ══════════════════════════ */}
      {activeTab === 'varliklar' && (
        <motion.div className="space-y-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}>
          {/* Filters */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#86868B]" />
              <input className="apple-input w-full pl-9 pr-4 py-2 text-sm" placeholder={L('ara')}
                value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <select className="apple-input px-3 py-2 text-sm min-w-[160px]" value={filterKat} onChange={e => setFilterKat(e.target.value)}>
              <option value="">{L('tumKategoriler')}</option>
              {(Object.keys(KATEGORI_CFG) as Kategori[]).map(k => <option key={k} value={k}>{k}</option>)}
            </select>
            <select className="apple-input px-3 py-2 text-sm min-w-[170px]" value={filterDurum} onChange={e => setFilterDurum(e.target.value)}>
              <option value="">{L('tumDurumlar')}</option>
              {(['Aktif', 'Bakımda', 'Elden Çıkarıldı', 'Hurdaya Ayrıldı'] as VarlikDurum[]).map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>

          {/* Table */}
          <div className="apple-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[960px]">
                <thead className="bg-[#F5F5F7] border-b border-gray-200">
                  <tr>
                    <SortTh label={L('demirbasNo')}    sortKey="demirbasNo"   current={sort} onSort={handleSort} />
                    <SortTh label={L('ad')}             sortKey="ad"           current={sort} onSort={handleSort} />
                    <SortTh label={L('kategori')}       sortKey="kategori"     current={sort} onSort={handleSort} />
                    <SortTh label={L('alisTarihi')}     sortKey="alisTarihi"   current={sort} onSort={handleSort} />
                    <SortTh label={L('alisBedeli')}     sortKey="alisBedeli"   current={sort} onSort={handleSort} />
                    <th className="px-4 py-3 text-left text-[10px] font-bold text-[#86868B] uppercase tracking-wider">{L('birikmisSalinma')}</th>
                    <th className="px-4 py-3 text-left text-[10px] font-bold text-[#86868B] uppercase tracking-wider">{L('netDegerDefter')}</th>
                    <SortTh label={L('departman')}      sortKey="departman"    current={sort} onSort={handleSort} />
                    <SortTh label={L('durum')}          sortKey="durum"        current={sort} onSort={handleSort} />
                    <th className="px-4 py-3 text-left text-[10px] font-bold text-[#86868B] uppercase tracking-wider">{L('islemler')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {loading ? (
                    <tr><td colSpan={10} className="py-8 text-center">
                      <div className="flex justify-center"><div className="w-5 h-5 border-2 border-[#ff4000] border-t-transparent rounded-full animate-spin" /></div>
                    </td></tr>
                  ) : filtered.length === 0 ? (
                    <tr><td colSpan={10} className="py-10 text-center text-sm text-[#86868B]">{L('kayitYok')}</td></tr>
                  ) : filtered.map((item, idx) => (
                    <motion.tr key={item.id} className="hover:bg-[#F5F5F7]/60 transition-colors"
                      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.025, duration: 0.2 }}>
                      <td className="px-4 py-3 text-xs font-mono text-[#86868B]">{item.demirbasNo}</td>
                      <td className="px-4 py-3 font-medium text-sm text-[#1D1D1F]">{item.ad}</td>
                      <td className="px-4 py-3"><KategoriBadge kategori={item.kategori} /></td>
                      <td className="px-4 py-3 text-sm text-[#1D1D1F] whitespace-nowrap">{formatDateTR(item.alisTarihi)}</td>
                      <td className="px-4 py-3 text-sm font-medium text-[#1D1D1F] whitespace-nowrap">
                        {item.paraBirimi !== 'TRY' ? `${item.paraBirimi} ` : ''}{formatTRY(item.alisBedeli).replace('₺', item.paraBirimi === 'TRY' ? '₺' : '')}
                      </td>
                      <td className="px-4 py-3 text-sm text-orange-600 whitespace-nowrap">{formatTRY(calcBirikmisSalinma(item))}</td>
                      <td className="px-4 py-3 text-sm font-semibold text-green-700 whitespace-nowrap">{formatTRY(calcNetDeger(item))}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1 text-sm text-[#1D1D1F]">
                          <MapPin className="w-3 h-3 text-[#86868B] flex-shrink-0" />
                          <span className="truncate max-w-[120px]">{item.departman || '-'}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3"><DurumBadge durum={item.durum} /></td>
                      <td className="px-4 py-3">
                        {isAuthenticated && (
                          <div className="flex items-center gap-1">
                            <button className="p-1.5 rounded-lg hover:bg-[#F5F5F7] text-[#86868B] hover:text-[#1D1D1F] transition-colors" title={L('duzenle')} onClick={() => openEditVarlik(item)}>
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button className="p-1.5 rounded-lg hover:bg-red-50 text-[#86868B] hover:text-red-500 transition-colors" title={L('sil')} onClick={() => setDeleteTarget({ id: item.id, col: 'sabitKiymetler' })}>
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </motion.div>
      )}

      {/* ══════════════════════════ TAB: AMORTİSMAN ══════════════════════════ */}
      {activeTab === 'amortisman' && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}>
          <div className="apple-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[800px]">
                <thead className="bg-[#F5F5F7] border-b border-gray-200">
                  <tr>
                    <th className="px-4 py-3 text-left text-[10px] font-bold text-[#86868B] uppercase tracking-wider">{L('ad')}</th>
                    <th className="px-4 py-3 text-left text-[10px] font-bold text-[#86868B] uppercase tracking-wider">{L('amortYontemi')}</th>
                    <th className="px-4 py-3 text-left text-[10px] font-bold text-[#86868B] uppercase tracking-wider">{L('faydaliOmur')}</th>
                    <th className="px-4 py-3 text-right text-[10px] font-bold text-[#86868B] uppercase tracking-wider">{L('yillikAmort')}</th>
                    <th className="px-4 py-3 text-right text-[10px] font-bold text-[#86868B] uppercase tracking-wider">{L('aylikAmort')}</th>
                    <th className="px-4 py-3 text-right text-[10px] font-bold text-[#86868B] uppercase tracking-wider">{L('birikmisSalinma')}</th>
                    <th className="px-4 py-3 text-right text-[10px] font-bold text-[#86868B] uppercase tracking-wider">{L('netDegerDefter')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {loading ? (
                    <tr><td colSpan={7} className="py-8 text-center">
                      <div className="flex justify-center"><div className="w-5 h-5 border-2 border-[#ff4000] border-t-transparent rounded-full animate-spin" /></div>
                    </td></tr>
                  ) : aktifVarliklar.length === 0 ? (
                    <tr><td colSpan={7} className="py-10 text-center text-sm text-[#86868B]">{L('kayitYok')}</td></tr>
                  ) : aktifVarliklar.map((item, idx) => (
                    <motion.tr key={item.id} className="hover:bg-[#F5F5F7]/60 transition-colors"
                      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.025, duration: 0.2 }}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <KategoriBadge kategori={item.kategori} />
                          <div>
                            <div className="font-medium text-sm text-[#1D1D1F]">{item.ad}</div>
                            <div className="text-[11px] text-[#86868B] font-mono">{item.demirbasNo}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-[#1D1D1F]">
                        {item.amortYontemi === 'Doğrusal' ? L('dogrusal') : L('azalanBakiyeler')}
                      </td>
                      <td className="px-4 py-3 text-sm text-[#1D1D1F]">{item.faydaliOmur} {tr ? 'yıl' : 'yrs'}</td>
                      <td className="px-4 py-3 text-right text-sm font-medium text-orange-600 whitespace-nowrap">{formatTRY(calcYillikAmort(item))}</td>
                      <td className="px-4 py-3 text-right text-sm text-[#1D1D1F] whitespace-nowrap">{formatTRY(calcAylikAmort(item))}</td>
                      <td className="px-4 py-3 text-right text-sm text-orange-700 font-semibold whitespace-nowrap">{formatTRY(calcBirikmisSalinma(item))}</td>
                      <td className="px-4 py-3 text-right text-sm font-bold text-green-700 whitespace-nowrap">{formatTRY(calcNetDeger(item))}</td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Saved depreciation log */}
          {amortKayitlar.length > 0 && (
            <div className="mt-6">
              <h3 className="text-sm font-semibold text-[#1D1D1F] mb-3 flex items-center gap-2">
                <RefreshCw className="w-4 h-4 text-[#86868B]" />
                {tr ? 'Kaydedilmiş Dönem Hesaplamaları' : 'Saved Period Calculations'}
              </h3>
              <div className="apple-card overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px]">
                    <thead className="bg-[#F5F5F7] border-b border-gray-200">
                      <tr>
                        {[L('varlikAd'), tr ? 'Dönem' : 'Period', L('yillikAmort'), L('birikmisSalinma'), L('netDegerDefter'), tr ? 'Tarih' : 'Date'].map((h, i) => (
                          <th key={i} className={cn('px-4 py-3 text-[10px] font-bold text-[#86868B] uppercase tracking-wider', i > 1 ? 'text-right' : 'text-left')}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {amortKayitlar.slice(0, 50).map(k => (
                        <tr key={k.id} className="hover:bg-[#F5F5F7]/60 transition-colors">
                          <td className="px-4 py-2.5 text-sm text-[#1D1D1F]">{k.varlikAd}</td>
                          <td className="px-4 py-2.5 text-xs font-mono text-[#86868B]">{k.donem}</td>
                          <td className="px-4 py-2.5 text-right text-sm text-orange-600">{formatTRY(k.yillikAmort)}</td>
                          <td className="px-4 py-2.5 text-right text-sm text-orange-700 font-medium">{formatTRY(k.birikmisSalinma)}</td>
                          <td className="px-4 py-2.5 text-right text-sm text-green-700 font-semibold">{formatTRY(k.netDegerDefter)}</td>
                          <td className="px-4 py-2.5 text-right text-xs text-[#86868B]">{formatDateTR(k.hesaplamaTarihi)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </motion.div>
      )}

      {/* ══════════════════════════ TAB: BAKIM ══════════════════════════ */}
      {activeTab === 'bakim' && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}>
          <div className="apple-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px]">
                <thead className="bg-[#F5F5F7] border-b border-gray-200">
                  <tr>
                    {[L('varlikAd'), L('bakimTarihi'), L('bakimTuru'), L('yapilanIslem'), L('maliyet'), L('sonrakiBakim'), L('islemler')].map((h, i) => (
                      <th key={i} className="px-4 py-3 text-left text-[10px] font-bold text-[#86868B] uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {loading ? (
                    <tr><td colSpan={7} className="py-8 text-center">
                      <div className="flex justify-center"><div className="w-5 h-5 border-2 border-[#ff4000] border-t-transparent rounded-full animate-spin" /></div>
                    </td></tr>
                  ) : bakimlar.length === 0 ? (
                    <tr><td colSpan={7} className="py-10 text-center text-sm text-[#86868B]">{L('kayitYok')}</td></tr>
                  ) : bakimlar.map((item, idx) => (
                    <motion.tr key={item.id} className="hover:bg-[#F5F5F7]/60 transition-colors"
                      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.025, duration: 0.2 }}>
                      <td className="px-4 py-3 font-medium text-sm text-[#1D1D1F]">{item.varlikAd}</td>
                      <td className="px-4 py-3 text-sm text-[#1D1D1F] whitespace-nowrap">{formatDateTR(item.bakimTarihi)}</td>
                      <td className="px-4 py-3">
                        <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium',
                          item.bakimTuru === 'Periyodik' ? 'bg-blue-100 text-blue-700' :
                          item.bakimTuru === 'Arıza' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-700')}>
                          {item.bakimTuru === 'Periyodik' ? L('periyodik') : item.bakimTuru === 'Arıza' ? L('ariza') : L('genel')}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-[#1D1D1F] max-w-[200px] truncate">{item.yapilanIslem || '-'}</td>
                      <td className="px-4 py-3 text-sm font-medium text-[#1D1D1F] whitespace-nowrap">{formatTRY(item.maliyet)}</td>
                      <td className="px-4 py-3 text-sm text-[#86868B] whitespace-nowrap">{item.sonrakiBakimTarihi ? formatDateTR(item.sonrakiBakimTarihi) : '-'}</td>
                      <td className="px-4 py-3">
                        {isAuthenticated && (
                          <div className="flex items-center gap-1">
                            <button className="p-1.5 rounded-lg hover:bg-[#F5F5F7] text-[#86868B] hover:text-[#1D1D1F] transition-colors" onClick={() => openEditBakim(item)}>
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button className="p-1.5 rounded-lg hover:bg-red-50 text-[#86868B] hover:text-red-500 transition-colors" onClick={() => setDeleteTarget({ id: item.id, col: 'sabitKiymetBakim' })}>
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </motion.div>
      )}

      {/* ══════════════════════════ TAB: SİGORTA ══════════════════════════ */}
      {activeTab === 'sigorta' && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}>
          <div className="apple-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px]">
                <thead className="bg-[#F5F5F7] border-b border-gray-200">
                  <tr>
                    {[L('varlikAd'), L('policeNo'), L('sigortaSirketi'), L('baslangicTarihi'), L('bitisTarihi'), L('primTutari'), L('teminatTutari'), L('sigortaDurum'), L('islemler')].map((h, i) => (
                      <th key={i} className="px-4 py-3 text-left text-[10px] font-bold text-[#86868B] uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {loading ? (
                    <tr><td colSpan={9} className="py-8 text-center">
                      <div className="flex justify-center"><div className="w-5 h-5 border-2 border-[#ff4000] border-t-transparent rounded-full animate-spin" /></div>
                    </td></tr>
                  ) : sigortalar.length === 0 ? (
                    <tr><td colSpan={9} className="py-10 text-center text-sm text-[#86868B]">{L('kayitYok')}</td></tr>
                  ) : sigortalar.map((item, idx) => {
                    const remaining = item.bitisTarihi ? daysUntil(item.bitisTarihi) : null;
                    const expiringSoon = remaining !== null && remaining >= 0 && remaining <= 30;
                    return (
                      <motion.tr key={item.id} className="hover:bg-[#F5F5F7]/60 transition-colors"
                        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.025, duration: 0.2 }}>
                        <td className="px-4 py-3 font-medium text-sm text-[#1D1D1F]">{item.varlikAd}</td>
                        <td className="px-4 py-3 text-xs font-mono text-[#86868B]">{item.policeNo}</td>
                        <td className="px-4 py-3 text-sm text-[#1D1D1F]">{item.sigortaSirketi}</td>
                        <td className="px-4 py-3 text-sm text-[#1D1D1F] whitespace-nowrap">{formatDateTR(item.baslangicTarihi)}</td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-[#1D1D1F]">{formatDateTR(item.bitisTarihi)}</span>
                            {expiringSoon && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-700 border border-amber-200">
                                <AlertTriangle className="w-2.5 h-2.5" />{L('yakindaVadesi')}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm font-medium text-[#1D1D1F] whitespace-nowrap">{formatTRY(item.primTutari)}</td>
                        <td className="px-4 py-3 text-sm font-medium text-green-700 whitespace-nowrap">{formatTRY(item.teminatTutari)}</td>
                        <td className="px-4 py-3">
                          <span className={cn('inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium',
                            item.durum === 'Aktif' ? 'bg-green-100 text-green-700' :
                            item.durum === 'Süresi Dolmuş' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700')}>
                            <span className={cn('w-1.5 h-1.5 rounded-full',
                              item.durum === 'Aktif' ? 'bg-green-500' : item.durum === 'Süresi Dolmuş' ? 'bg-red-500' : 'bg-amber-500')} />
                            {item.durum === 'Aktif' ? L('sigAktif') : item.durum === 'Süresi Dolmuş' ? L('sigSüresiDolmus') : L('sigYenileniyor')}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {isAuthenticated && (
                            <div className="flex items-center gap-1">
                              <button className="p-1.5 rounded-lg hover:bg-[#F5F5F7] text-[#86868B] hover:text-[#1D1D1F] transition-colors" onClick={() => openEditSigorta(item)}>
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                              <button className="p-1.5 rounded-lg hover:bg-red-50 text-[#86868B] hover:text-red-500 transition-colors" onClick={() => setDeleteTarget({ id: item.id, col: 'sabitKiymetSigorta' })}>
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          )}
                        </td>
                      </motion.tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </motion.div>
      )}

      {/* ══════════════════════════ SLIDE PANEL: VARLIK ══════════════════════════ */}
      <AnimatePresence>
        {varlikPanel && (
          <>
            <motion.div className="fixed inset-0 bg-black/30 z-40" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setVarlikPanel(false)} />
            <motion.div className="fixed top-0 right-0 h-full w-full max-w-[500px] bg-white z-50 shadow-2xl overflow-y-auto"
              initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', damping: 30, stiffness: 300 }}>
              <div className="sticky top-0 bg-white/90 backdrop-blur border-b border-gray-100 px-6 py-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-[#1D1D1F]">{editVarlik ? L('duzenle') : L('yeniVarlik')}</h2>
                <button className="p-2 rounded-xl hover:bg-[#F5F5F7] transition-colors" onClick={() => setVarlikPanel(false)}>
                  <X className="w-5 h-5 text-[#86868B]" />
                </button>
              </div>
              <div className="p-6 space-y-4">
                {/* Demirbaş No */}
                <div>
                  <label className="block text-xs font-medium text-[#86868B] mb-1">{L('demirbasNo')}</label>
                  <input className={inputCls(varlikErrors.demirbasNo)} value={varlikForm.demirbasNo}
                    onChange={e => setVarlikForm(f => ({ ...f, demirbasNo: e.target.value }))} />
                  {varlikErrors.demirbasNo && <p className="text-xs text-red-500 mt-1">{varlikErrors.demirbasNo}</p>}
                </div>
                {/* Ad */}
                <div>
                  <label className="block text-xs font-medium text-[#86868B] mb-1">{L('ad')} *</label>
                  <input className={inputCls(varlikErrors.ad)} value={varlikForm.ad}
                    onChange={e => setVarlikForm(f => ({ ...f, ad: e.target.value }))} />
                  {varlikErrors.ad && <p className="text-xs text-red-500 mt-1">{varlikErrors.ad}</p>}
                </div>
                {/* Kategori */}
                <div>
                  <label className="block text-xs font-medium text-[#86868B] mb-1">{L('kategori')}</label>
                  <select className="apple-input w-full px-3 py-2 text-sm" value={varlikForm.kategori}
                    onChange={e => setVarlikForm(f => ({ ...f, kategori: e.target.value as Kategori }))}>
                    {(Object.keys(KATEGORI_CFG) as Kategori[]).map(k => <option key={k} value={k}>{k}</option>)}
                  </select>
                </div>
                {/* Alış Tarihi & Para Birimi */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-[#86868B] mb-1">{L('alisTarihi')} *</label>
                    <input type="date" className={inputCls(varlikErrors.alisTarihi)} value={varlikForm.alisTarihi}
                      onChange={e => setVarlikForm(f => ({ ...f, alisTarihi: e.target.value }))} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[#86868B] mb-1">{L('paraBirimi')}</label>
                    <select className="apple-input w-full px-3 py-2 text-sm" value={varlikForm.paraBirimi}
                      onChange={e => setVarlikForm(f => ({ ...f, paraBirimi: e.target.value as ParaBirimi }))}>
                      <option value="TRY">TRY (₺)</option>
                      <option value="USD">USD ($)</option>
                      <option value="EUR">EUR (€)</option>
                    </select>
                  </div>
                </div>
                {/* Alış Bedeli */}
                <div>
                  <label className="block text-xs font-medium text-[#86868B] mb-1">{L('alisBedeli')} *</label>
                  <input type="number" min={0} className={inputCls(varlikErrors.alisBedeli)} value={varlikForm.alisBedeli || ''}
                    onChange={e => setVarlikForm(f => ({ ...f, alisBedeli: parseFloat(e.target.value) || 0 }))} />
                  {varlikErrors.alisBedeli && <p className="text-xs text-red-500 mt-1">{varlikErrors.alisBedeli}</p>}
                </div>
                {/* Amortisman Yöntemi & Faydalı Ömür */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-[#86868B] mb-1">{L('amortYontemi')}</label>
                    <select className="apple-input w-full px-3 py-2 text-sm" value={varlikForm.amortYontemi}
                      onChange={e => setVarlikForm(f => ({ ...f, amortYontemi: e.target.value as AmortYontemi }))}>
                      <option value="Doğrusal">{L('dogrusal')}</option>
                      <option value="Azalan Bakiyeler">{L('azalanBakiyeler')}</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[#86868B] mb-1">{L('faydaliOmur')} *</label>
                    <input type="number" min={1} max={50} className={inputCls(varlikErrors.faydaliOmur)} value={varlikForm.faydaliOmur || ''}
                      onChange={e => setVarlikForm(f => ({ ...f, faydaliOmur: parseInt(e.target.value, 10) || 0 }))} />
                  </div>
                </div>
                {/* Birikmiş Amortisman override */}
                <div>
                  <label className="block text-xs font-medium text-[#86868B] mb-1">
                    {L('birikmisSalinma')} <span className="text-[10px] font-normal text-[#86868B]">({tr ? '0 = otomatik hesapla' : '0 = auto-calculate'})</span>
                  </label>
                  <input type="number" min={0} className="apple-input w-full px-3 py-2 text-sm" value={varlikForm.birikmisSalinma || ''}
                    onChange={e => setVarlikForm(f => ({ ...f, birikmisSalinma: parseFloat(e.target.value) || 0 }))} />
                </div>
                {/* Net defter değeri (computed) */}
                <div className="bg-[#F5F5F7] rounded-xl p-3">
                  <p className="text-xs text-[#86868B]">{L('netDegerDefter')}</p>
                  <p className="text-lg font-bold text-green-700">
                    {formatTRY(Math.max(0, varlikForm.alisBedeli - (varlikForm.birikmisSalinma || 0)))}
                  </p>
                </div>
                {/* Departman */}
                <div>
                  <label className="block text-xs font-medium text-[#86868B] mb-1">{L('departman')}</label>
                  <input className="apple-input w-full px-3 py-2 text-sm" value={varlikForm.departman}
                    onChange={e => setVarlikForm(f => ({ ...f, departman: e.target.value }))} />
                </div>
                {/* Durum */}
                <div>
                  <label className="block text-xs font-medium text-[#86868B] mb-1">{L('durum')}</label>
                  <select className="apple-input w-full px-3 py-2 text-sm" value={varlikForm.durum}
                    onChange={e => setVarlikForm(f => ({ ...f, durum: e.target.value as VarlikDurum }))}>
                    <option value="Aktif">{L('aktif')}</option>
                    <option value="Bakımda">{L('bakimda')}</option>
                    <option value="Elden Çıkarıldı">{L('eldenCikarildi')}</option>
                    <option value="Hurdaya Ayrıldı">{L('hurdayaAyrildi')}</option>
                  </select>
                </div>
                <div className="flex gap-3 pt-2">
                  <button className="apple-button-secondary flex-1 py-2 text-sm" onClick={() => setVarlikPanel(false)} disabled={saving}>{L('iptal')}</button>
                  <button className="apple-button-primary flex-1 py-2 text-sm flex items-center justify-center gap-2" onClick={handleSaveVarlik} disabled={saving}>
                    {saving && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                    {L('kaydet')}
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ══════════════════════════ SLIDE PANEL: BAKIM ══════════════════════════ */}
      <AnimatePresence>
        {bakimPanel && (
          <>
            <motion.div className="fixed inset-0 bg-black/30 z-40" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setBakimPanel(false)} />
            <motion.div className="fixed top-0 right-0 h-full w-full max-w-[460px] bg-white z-50 shadow-2xl overflow-y-auto"
              initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', damping: 30, stiffness: 300 }}>
              <div className="sticky top-0 bg-white/90 backdrop-blur border-b border-gray-100 px-6 py-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-[#1D1D1F]">{editBakim ? L('duzenle') : L('yeniBakim')}</h2>
                <button className="p-2 rounded-xl hover:bg-[#F5F5F7] transition-colors" onClick={() => setBakimPanel(false)}>
                  <X className="w-5 h-5 text-[#86868B]" />
                </button>
              </div>
              <div className="p-6 space-y-4">
                {/* Varlık Adı */}
                <div>
                  <label className="block text-xs font-medium text-[#86868B] mb-1">{L('varlikAd')} *</label>
                  <select className="apple-input w-full px-3 py-2 text-sm" value={bakimForm.varlikId}
                    onChange={e => {
                      const v = varliklar.find(x => x.id === e.target.value);
                      setBakimForm(f => ({ ...f, varlikId: e.target.value, varlikAd: v?.ad ?? '' }));
                    }}>
                    <option value="">{tr ? '— Seçiniz —' : '— Select —'}</option>
                    {varliklar.map(v => <option key={v.id} value={v.id}>{v.ad} ({v.demirbasNo})</option>)}
                  </select>
                </div>
                {/* Bakım Tarihi */}
                <div>
                  <label className="block text-xs font-medium text-[#86868B] mb-1">{L('bakimTarihi')} *</label>
                  <input type="date" className="apple-input w-full px-3 py-2 text-sm" value={bakimForm.bakimTarihi}
                    onChange={e => setBakimForm(f => ({ ...f, bakimTarihi: e.target.value }))} />
                </div>
                {/* Bakım Türü */}
                <div>
                  <label className="block text-xs font-medium text-[#86868B] mb-1">{L('bakimTuru')}</label>
                  <select className="apple-input w-full px-3 py-2 text-sm" value={bakimForm.bakimTuru}
                    onChange={e => setBakimForm(f => ({ ...f, bakimTuru: e.target.value as BakimTuru }))}>
                    <option value="Periyodik">{L('periyodik')}</option>
                    <option value="Arıza">{L('ariza')}</option>
                    <option value="Genel">{L('genel')}</option>
                  </select>
                </div>
                {/* Yapılan İşlem */}
                <div>
                  <label className="block text-xs font-medium text-[#86868B] mb-1">{L('yapilanIslem')}</label>
                  <textarea rows={3} className="apple-input w-full px-3 py-2 text-sm resize-none" value={bakimForm.yapilanIslem}
                    onChange={e => setBakimForm(f => ({ ...f, yapilanIslem: e.target.value }))} />
                </div>
                {/* Maliyet */}
                <div>
                  <label className="block text-xs font-medium text-[#86868B] mb-1">{L('maliyet')}</label>
                  <input type="number" min={0} className="apple-input w-full px-3 py-2 text-sm" value={bakimForm.maliyet || ''}
                    onChange={e => setBakimForm(f => ({ ...f, maliyet: parseFloat(e.target.value) || 0 }))} />
                </div>
                {/* Sonraki Bakım */}
                <div>
                  <label className="block text-xs font-medium text-[#86868B] mb-1">{L('sonrakiBakim')}</label>
                  <input type="date" className="apple-input w-full px-3 py-2 text-sm" value={bakimForm.sonrakiBakimTarihi}
                    onChange={e => setBakimForm(f => ({ ...f, sonrakiBakimTarihi: e.target.value }))} />
                </div>
                <div className="flex gap-3 pt-2">
                  <button className="apple-button-secondary flex-1 py-2 text-sm" onClick={() => setBakimPanel(false)} disabled={saving}>{L('iptal')}</button>
                  <button className="apple-button-primary flex-1 py-2 text-sm flex items-center justify-center gap-2" onClick={handleSaveBakim} disabled={saving}>
                    {saving && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                    {L('kaydet')}
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ══════════════════════════ SLIDE PANEL: SİGORTA ══════════════════════════ */}
      <AnimatePresence>
        {sigortaPanel && (
          <>
            <motion.div className="fixed inset-0 bg-black/30 z-40" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setSigortaPanel(false)} />
            <motion.div className="fixed top-0 right-0 h-full w-full max-w-[460px] bg-white z-50 shadow-2xl overflow-y-auto"
              initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', damping: 30, stiffness: 300 }}>
              <div className="sticky top-0 bg-white/90 backdrop-blur border-b border-gray-100 px-6 py-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-[#1D1D1F]">{editSigorta ? L('duzenle') : L('yeniSigorta')}</h2>
                <button className="p-2 rounded-xl hover:bg-[#F5F5F7] transition-colors" onClick={() => setSigortaPanel(false)}>
                  <X className="w-5 h-5 text-[#86868B]" />
                </button>
              </div>
              <div className="p-6 space-y-4">
                {/* Varlık */}
                <div>
                  <label className="block text-xs font-medium text-[#86868B] mb-1">{L('varlikAd')} *</label>
                  <select className="apple-input w-full px-3 py-2 text-sm" value={sigortaForm.varlikId}
                    onChange={e => {
                      const v = varliklar.find(x => x.id === e.target.value);
                      setSigortaForm(f => ({ ...f, varlikId: e.target.value, varlikAd: v?.ad ?? '' }));
                    }}>
                    <option value="">{tr ? '— Seçiniz —' : '— Select —'}</option>
                    {varliklar.map(v => <option key={v.id} value={v.id}>{v.ad} ({v.demirbasNo})</option>)}
                  </select>
                </div>
                {/* Poliçe No */}
                <div>
                  <label className="block text-xs font-medium text-[#86868B] mb-1">{L('policeNo')} *</label>
                  <input className="apple-input w-full px-3 py-2 text-sm" value={sigortaForm.policeNo}
                    onChange={e => setSigortaForm(f => ({ ...f, policeNo: e.target.value }))} />
                </div>
                {/* Sigorta Şirketi */}
                <div>
                  <label className="block text-xs font-medium text-[#86868B] mb-1">{L('sigortaSirketi')}</label>
                  <input className="apple-input w-full px-3 py-2 text-sm" value={sigortaForm.sigortaSirketi}
                    onChange={e => setSigortaForm(f => ({ ...f, sigortaSirketi: e.target.value }))} />
                </div>
                {/* Başlangıç & Bitiş */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-[#86868B] mb-1">{L('baslangicTarihi')}</label>
                    <input type="date" className="apple-input w-full px-3 py-2 text-sm" value={sigortaForm.baslangicTarihi}
                      onChange={e => setSigortaForm(f => ({ ...f, baslangicTarihi: e.target.value }))} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[#86868B] mb-1">{L('bitisTarihi')}</label>
                    <input type="date" className="apple-input w-full px-3 py-2 text-sm" value={sigortaForm.bitisTarihi}
                      onChange={e => setSigortaForm(f => ({ ...f, bitisTarihi: e.target.value }))} />
                  </div>
                </div>
                {/* Prim & Teminat */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-[#86868B] mb-1">{L('primTutari')}</label>
                    <input type="number" min={0} className="apple-input w-full px-3 py-2 text-sm" value={sigortaForm.primTutari || ''}
                      onChange={e => setSigortaForm(f => ({ ...f, primTutari: parseFloat(e.target.value) || 0 }))} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[#86868B] mb-1">{L('teminatTutari')}</label>
                    <input type="number" min={0} className="apple-input w-full px-3 py-2 text-sm" value={sigortaForm.teminatTutari || ''}
                      onChange={e => setSigortaForm(f => ({ ...f, teminatTutari: parseFloat(e.target.value) || 0 }))} />
                  </div>
                </div>
                {/* Durum */}
                <div>
                  <label className="block text-xs font-medium text-[#86868B] mb-1">{L('sigortaDurum')}</label>
                  <select className="apple-input w-full px-3 py-2 text-sm" value={sigortaForm.durum}
                    onChange={e => setSigortaForm(f => ({ ...f, durum: e.target.value as SigortaDurum }))}>
                    <option value="Aktif">{L('sigAktif')}</option>
                    <option value="Süresi Dolmuş">{L('sigSüresiDolmus')}</option>
                    <option value="Yenileniyor">{L('sigYenileniyor')}</option>
                  </select>
                </div>
                <div className="flex gap-3 pt-2">
                  <button className="apple-button-secondary flex-1 py-2 text-sm" onClick={() => setSigortaPanel(false)} disabled={saving}>{L('iptal')}</button>
                  <button className="apple-button-primary flex-1 py-2 text-sm flex items-center justify-center gap-2" onClick={handleSaveSigorta} disabled={saving}>
                    {saving && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                    {L('kaydet')}
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ══════════════════════════ DELETE CONFIRM ══════════════════════════ */}
      <AnimatePresence>
        {deleteTarget && (
          <motion.div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div className="apple-card w-full max-w-sm p-6 space-y-4"
              initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                  <AlertTriangle className="w-5 h-5 text-red-600" />
                </div>
                <p className="text-sm text-[#1D1D1F] font-medium">{L('silOnayiMesaj')}</p>
              </div>
              <div className="flex gap-3">
                <button className="apple-button-secondary flex-1 py-2 text-sm" onClick={() => setDeleteTarget(null)}>{L('iptal')}</button>
                <button className="flex-1 py-2 text-sm font-medium bg-red-500 text-white rounded-full hover:bg-red-600 transition-colors" onClick={handleDelete}>{L('evetSil')}</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ══════════════════════════ TOAST ══════════════════════════ */}
      <AnimatePresence>
        {toast && (
          <motion.div
            className="fixed bottom-6 right-6 z-[60] flex items-center gap-3 px-4 py-3 rounded-2xl shadow-lg text-sm font-medium text-white"
            style={{ background: toast.type === 'success' ? '#34C759' : '#FF3B30' }}
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}>
            {toast.type === 'success'
              ? <CheckCircle className="w-4 h-4 flex-shrink-0" />
              : <AlertTriangle className="w-4 h-4 flex-shrink-0" />}
            {toast.msg}
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}
