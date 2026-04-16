import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  DollarSign, AlertTriangle, Clock, CheckCircle, Plus, Search, Download,
  X, Edit2, Trash2, CreditCard, TrendingUp, TrendingDown, Calendar,
  Filter, FileText, ChevronRight, ChevronUp, ChevronDown
} from 'lucide-react';
import { db } from '../firebase';
import {
  collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot,
  query, orderBy, serverTimestamp
} from 'firebase/firestore';
import { format, differenceInDays, parseISO, isValid } from 'date-fns';

// ─── Types ────────────────────────────────────────────────────────────────────

interface TahsilatKaydi {
  id: string;
  musteriAdi: string;
  belgeTipi: 'Fatura' | 'İrsaliye' | 'Sözleşme' | 'Diğer';
  belgeNo: string;
  toplamTutar: number;
  tahsilEdilen: number;
  vadeTarihi: string;
  faturaTarihi: string;
  durum: 'Bekliyor' | 'Kısmi Tahsilat' | 'Tahsil Edildi' | 'Gecikmiş';
  notlar: string;
  faizOrani: number;
  currency: 'TRY' | 'USD' | 'EUR';
}

interface TahsilatOdeme {
  id: string;
  kaydiId: string;
  tarih: string;
  tutar: number;
  odemeTipi: 'Nakit' | 'Havale/EFT' | 'Çek' | 'Kredi Kartı' | 'Mahsup';
  notlar: string;
}

interface TahsilatModuleProps {
  currentLanguage: 'tr' | 'en';
  isAuthenticated: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const cn = (...classes: unknown[]) => classes.filter(Boolean).join(' ');

function parseDate(str: string): Date | null {
  if (!str) return null;
  const d = parseISO(str);
  return isValid(d) ? d : null;
}

function calcDurum(
  toplamTutar: number,
  tahsilEdilen: number,
  vadeTarihi: string
): TahsilatKaydi['durum'] {
  const acik = toplamTutar - tahsilEdilen;
  if (acik <= 0) return 'Tahsil Edildi';
  const vade = parseDate(vadeTarihi);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (vade && today > vade) return 'Gecikmiş';
  if (tahsilEdilen > 0) return 'Kısmi Tahsilat';
  return 'Bekliyor';
}

function calcFaiz(acikBakiye: number, faizOrani: number, vadeTarihi: string): number {
  const vade = parseDate(vadeTarihi);
  if (!vade) return 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const gecikme = differenceInDays(today, vade);
  if (gecikme <= 0) return 0;
  return acikBakiye * (faizOrani / 100) * (gecikme / 365);
}

const formatCurrency = (val: number, currency: string = 'TRY') =>
  new Intl.NumberFormat('tr-TR', { style: 'currency', currency: currency, minimumFractionDigits: 2 }).format(val);

const formatDate = (str: string) => {
  const d = parseDate(str);
  return d ? format(d, 'dd.MM.yyyy') : str;
};

// ─── Translations ─────────────────────────────────────────────────────────────

const T = {
  tr: {
    title: 'Tahsilat & Vade Takibi',
    subtitle: 'Alacak ve ödeme takibi',
    acikBakiye: 'Toplam Açık Bakiye',
    gecikmis: 'Gecikmiş Bakiye',
    buAyVadeli: 'Bu Ay Vadeli',
    ortTahsilat: 'Ort. Tahsilat Süresi',
    days: 'gün',
    yaslandirma: 'Yaşlandırma Raporu',
    d030: '0–30 Gün',
    d3160: '31–60 Gün',
    d6190: '61–90 Gün',
    d90p: '90+ Gün',
    records: 'kayıt',
    musteri: 'Müşteri',
    belgeNo: 'Belge No',
    faturaTarihi: 'Fatura Tarihi',
    vadeTarihi: 'Vade Tarihi',
    tutar: 'Tutar',
    tahsilat: 'Tahsilat',
    acik: 'Açık Bakiye',
    gecikFaiz: 'Gecikme Faizi',
    durum: 'Durum',
    islemler: 'İşlemler',
    yeniKayit: 'Yeni Kayıt',
    aramayap: 'Müşteri veya belge no ara…',
    tumDurumlar: 'Tüm Durumlar',
    exportCSV: 'CSV İndir',
    kaydet: 'Kaydet',
    iptal: 'İptal',
    sil: 'Sil',
    tahsilatEkle: 'Tahsilat Ekle',
    tahsilatKaydet: 'Tahsilat Kaydet',
    odemeTipi: 'Ödeme Tipi',
    tarih: 'Tarih',
    notlar: 'Notlar',
    belgeTipi: 'Belge Tipi',
    musteriAdi: 'Müşteri Adı',
    toplamTutar: 'Toplam Tutar',
    faizOrani: 'Gecikme Faiz Oranı (%)',
    kayitDuzenle: 'Kaydı Düzenle',
    yeniTahsilatKaydi: 'Yeni Tahsilat Kaydı',
    odemeKaydet: 'Ödeme Kaydet',
    odemeEkle: 'Ödeme Ekle',
    silOnayi: 'Bu kaydı silmek istediğinize emin misiniz?',
    evet: 'Evet, Sil',
    bekliyor: 'Bekliyor',
    kismiTahsilat: 'Kısmi Tahsilat',
    tahsilEdildi: 'Tahsil Edildi',
    gecikmiş: 'Gecikmiş',
    currency: 'Para Birimi',
  },
  en: {
    title: 'Receivables & Collections',
    subtitle: 'Track receivables and payments',
    acikBakiye: 'Total Open Balance',
    gecikmis: 'Overdue Balance',
    buAyVadeli: 'Due This Month',
    ortTahsilat: 'Avg. Collection Days',
    days: 'days',
    yaslandirma: 'Aging Report',
    d030: '0–30 Days',
    d3160: '31–60 Days',
    d6190: '61–90 Days',
    d90p: '90+ Days',
    records: 'records',
    musteri: 'Customer',
    belgeNo: 'Doc No',
    faturaTarihi: 'Invoice Date',
    vadeTarihi: 'Due Date',
    tutar: 'Amount',
    tahsilat: 'Collected',
    acik: 'Open Balance',
    gecikFaiz: 'Late Interest',
    durum: 'Status',
    islemler: 'Actions',
    yeniKayit: 'New Record',
    aramayap: 'Search customer or doc no…',
    tumDurumlar: 'All Statuses',
    exportCSV: 'Export CSV',
    kaydet: 'Save',
    iptal: 'Cancel',
    sil: 'Delete',
    tahsilatEkle: 'Add Payment',
    tahsilatKaydet: 'Record Payment',
    odemeTipi: 'Payment Type',
    tarih: 'Date',
    notlar: 'Notes',
    belgeTipi: 'Doc Type',
    musteriAdi: 'Customer Name',
    toplamTutar: 'Total Amount',
    faizOrani: 'Late Interest Rate (%)',
    kayitDuzenle: 'Edit Record',
    yeniTahsilatKaydi: 'New Collection Record',
    odemeKaydet: 'Save Payment',
    odemeEkle: 'Add Payment',
    silOnayi: 'Are you sure you want to delete this record?',
    evet: 'Yes, Delete',
    bekliyor: 'Pending',
    kismiTahsilat: 'Partial',
    tahsilEdildi: 'Collected',
    gecikmiş: 'Overdue',
    currency: 'Currency',
  },
} as const;

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatCard({
  icon: Icon,
  label,
  value,
  color,
  sub,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  color: string;
  sub?: string;
}) {
  return (
    <div className="apple-card p-5 flex flex-col gap-3">
      <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center', color)}>
        <Icon className="w-5 h-5 text-white" />
      </div>
      <div>
        <p className="text-[11px] text-[#86868B] font-medium uppercase tracking-wide">{label}</p>
        <p className="text-2xl font-bold text-[#1D1D1F] mt-0.5 leading-tight tracking-tight">{value}</p>
        {sub && <p className="text-[11px] text-[#86868B] mt-1">{sub}</p>}
      </div>
    </div>
  );
}

function CurrencyToggle({ active, onChange }: { active: 'TRY' | 'USD' | 'EUR'; onChange: (c: 'TRY' | 'USD' | 'EUR') => void }) {
  return (
    <div className="flex bg-gray-100 rounded-lg p-0.5">
      {(['TRY', 'USD', 'EUR'] as const).map((c) => (
        <button
          key={c}
          onClick={() => onChange(c)}
          className={cn(
            'px-2 py-1 rounded-md text-[10px] font-bold transition-all',
            active === c ? 'bg-white text-brand shadow-sm' : 'text-gray-400 hover:text-gray-600'
          )}
        >
          {c === 'TRY' ? '₺' : c === 'USD' ? '$' : '€'}
        </button>
      ))}
    </div>
  );
}

function DurumBadge({ durum, t }: { durum: TahsilatKaydi['durum']; t: typeof T['tr'] }) {
  const map: Record<TahsilatKaydi['durum'], { bg: string; text: string; label: string }> = {
    Bekliyor: { bg: 'bg-yellow-100', text: 'text-yellow-800', label: t.bekliyor },
    'Kısmi Tahsilat': { bg: 'bg-blue-100', text: 'text-blue-800', label: t.kismiTahsilat },
    'Tahsil Edildi': { bg: 'bg-green-100', text: 'text-green-800', label: t.tahsilEdildi },
    Gecikmiş: { bg: 'bg-red-100', text: 'text-red-800', label: t.gecikmiş },
  };
  const s = map[durum];
  return (
    <span className={cn('px-2.5 py-1 rounded-full text-[11px] font-semibold', s.bg, s.text)}>
      {s.label}
    </span>
  );
}

function SortHeader({
  label,
  sortKey,
  currentSort,
  onSort,
}: {
  label: string;
  sortKey: string;
  currentSort: { key: string; dir: 'asc' | 'desc' };
  onSort: (k: string) => void;
}) {
  const active = currentSort.key === sortKey;
  return (
    <th
      onClick={() => onSort(sortKey)}
      className="px-4 py-3 text-left text-[10px] font-bold text-[#86868B] uppercase tracking-wider cursor-pointer hover:bg-gray-50 transition-colors"
    >
      <div className="flex items-center gap-1">
        {label}
        <span className="inline-flex flex-col ml-0.5">
          <ChevronUp className={cn('w-2.5 h-2.5 -mb-1', active && currentSort.dir === 'asc' ? 'text-[#ff4000]' : 'text-gray-300')} />
          <ChevronDown className={cn('w-2.5 h-2.5', active && currentSort.dir === 'desc' ? 'text-[#ff4000]' : 'text-gray-300')} />
        </span>
      </div>
    </th>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function TahsilatModule({ currentLanguage, isAuthenticated }: TahsilatModuleProps) {
  const t = T[currentLanguage] as typeof T['tr'];

  // Data
  const [kayitlar, setKayitlar] = useState<TahsilatKaydi[]>([]);
  const [odemeler, setOdemeler] = useState<TahsilatOdeme[]>([]);

  // UI State
  const [search, setSearch] = useState('');
  const [durumFilter, setDurumFilter] = useState<string>('all');
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'vadeTarihi', dir: 'asc' });
  const [activeCurrency, setActiveCurrency] = useState<'TRY' | 'USD' | 'EUR'>('TRY');
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  // Form panel
  const [showForm, setShowForm] = useState(false);
  const [editingKayit, setEditingKayit] = useState<TahsilatKaydi | null>(null);
  const [formData, setFormData] = useState({
    musteriAdi: '',
    belgeTipi: 'Fatura' as TahsilatKaydi['belgeTipi'],
    belgeNo: '',
    toplamTutar: '',
    faturaTarihi: format(new Date(), 'yyyy-MM-dd'),
    vadeTarihi: '',
    faizOrani: '1.5',
    currency: 'TRY' as 'TRY' | 'USD' | 'EUR',
    notlar: '',
  });

  // Payment panel
  const [paymentKaydi, setPaymentKaydi] = useState<TahsilatKaydi | null>(null);
  const [paymentForm, setPaymentForm] = useState({
    tarih: format(new Date(), 'yyyy-MM-dd'),
    tutar: '',
    odemeTipi: 'Havale/EFT' as TahsilatOdeme['odemeTipi'],
    notlar: '',
  });

  // Delete confirm
  const [deleteTarget, setDeleteTarget] = useState<TahsilatKaydi | null>(null);

  // ── Firestore Subscriptions ──────────────────────────────────────────────────

  useEffect(() => {
    const unsub1 = onSnapshot(
      query(collection(db, 'tahsilatKayitlari'), orderBy('faturaTarihi', 'desc')),
      (snap) => {
        setKayitlar(
          snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<TahsilatKaydi, 'id'>) }))
        );
      },
      (err) => console.error('tahsilatKayitlari:', err)
    );

    let unsub2: (() => void) | null = null;
    const t2 = setTimeout(() => {
      unsub2 = onSnapshot(
        query(collection(db, 'tahsilatOdemeleri'), orderBy('tarih', 'desc')),
        (snap) => {
          setOdemeler(
            snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<TahsilatOdeme, 'id'>) }))
          );
        },
        (err) => console.error('tahsilatOdemeleri:', err)
      );
    }, 150);

    return () => {
      unsub1();
      clearTimeout(t2);
      unsub2?.();
    };
  }, []);

  // ── Toast helper ─────────────────────────────────────────────────────────────

  const showToast = useCallback((msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  // ── Derived metrics ───────────────────────────────────────────────────────────

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const acikKayitlar = kayitlar.filter((k) => k.durum !== 'Tahsil Edildi' && (k.currency || 'TRY') === activeCurrency);

  const toplam = acikKayitlar.reduce((s, k) => s + (k.toplamTutar - k.tahsilEdilen), 0);

  const gecikmisBakiye = kayitlar
    .filter((k) => {
      if (k.durum === 'Tahsil Edildi' || (k.currency || 'TRY') !== activeCurrency) return false;
      const vd = parseDate(k.vadeTarihi);
      return vd ? today > vd : false;
    })
    .reduce((s, k) => s + (k.toplamTutar - k.tahsilEdilen), 0);

  const buAyVadeli = (() => {
    const m = today.getMonth();
    const y = today.getFullYear();
    return kayitlar
      .filter((k) => {
        if (k.durum === 'Tahsil Edildi' || (k.currency || 'TRY') !== activeCurrency) return false;
        const vd = parseDate(k.vadeTarihi);
        return vd ? vd.getMonth() === m && vd.getFullYear() === y : false;
      })
      .reduce((s, k) => s + (k.toplamTutar - k.tahsilEdilen), 0);
  })();

  const ortTahsilatSuresi = (() => {
    const completed = kayitlar.filter((k) => k.durum === 'Tahsil Edildi');
    if (!completed.length) return 0;
    const daysArr = completed.map((k) => {
      const ft = parseDate(k.faturaTarihi);
      const kOdemeler = odemeler.filter((o) => o.kaydiId === k.id);
      if (!ft || !kOdemeler.length) return 0;
      const lastOdeme = kOdemeler.sort((a, b) => a.tarih.localeCompare(b.tarih)).at(-1)!;
      const od = parseDate(lastOdeme.tarih);
      return od ? Math.max(0, differenceInDays(od, ft)) : 0;
    });
    return Math.round(daysArr.reduce((s, v) => s + v, 0) / daysArr.length);
  })();

  // Aging buckets
  const aging = (() => {
    const buckets = [
      { label: t.d030, min: 0, max: 30 },
      { label: t.d3160, min: 31, max: 60 },
      { label: t.d6190, min: 61, max: 90 },
      { label: t.d90p, min: 91, max: Infinity },
    ];
    return buckets.map(({ label, min, max }) => {
      const items = kayitlar.filter((k) => {
        if (k.durum === 'Tahsil Edildi' || (k.currency || 'TRY') !== activeCurrency) return false;
        const vd = parseDate(k.vadeTarihi);
        if (!vd) return false;
        const diff = differenceInDays(today, vd);
        if (diff < 0) return false;
        return diff >= min && diff <= max;
      });
      return {
        label,
        count: items.length,
        total: items.reduce((s, k) => s + (k.toplamTutar - k.tahsilEdilen), 0),
      };
    });
  })();

  const maxAgingTotal = Math.max(...aging.map((a) => a.total), 1);

  // ── Filtered & sorted table data ─────────────────────────────────────────────

  const filtered = kayitlar
    .filter((k) => {
      const q = search.toLowerCase();
      if (q && !k.musteriAdi.toLowerCase().includes(q) && !k.belgeNo.toLowerCase().includes(q)) return false;
      if (durumFilter !== 'all' && k.durum !== durumFilter) return false;
      return true;
    })
    .sort((a, b) => {
      let va: string | number = (a as unknown as Record<string, unknown>)[sort.key] as string | number ?? '';
      let vb: string | number = (b as unknown as Record<string, unknown>)[sort.key] as string | number ?? '';
      if (typeof va === 'string' && typeof vb === 'string') {
        return sort.dir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
      }
      return sort.dir === 'asc' ? (va as number) - (vb as number) : (vb as number) - (va as number);
    });

  // ── Sort handler ─────────────────────────────────────────────────────────────

  const handleSort = (key: string) => {
    setSort((prev) => ({
      key,
      dir: prev.key === key && prev.dir === 'asc' ? 'desc' : 'asc',
    }));
  };

  // ── Form handlers ─────────────────────────────────────────────────────────────

  const openNewForm = () => {
    setEditingKayit(null);
    setFormData({
      musteriAdi: '',
      belgeTipi: 'Fatura',
      belgeNo: '',
      toplamTutar: '',
      faturaTarihi: format(new Date(), 'yyyy-MM-dd'),
      vadeTarihi: '',
      faizOrani: '1.5',
      currency: 'TRY',
      notlar: '',
    });
    setShowForm(true);
  };

  const openEditForm = (k: TahsilatKaydi) => {
    setEditingKayit(k);
    setFormData({
      musteriAdi: k.musteriAdi,
      belgeTipi: k.belgeTipi,
      belgeNo: k.belgeNo,
      toplamTutar: String(k.toplamTutar),
      faturaTarihi: k.faturaTarihi,
      vadeTarihi: k.vadeTarihi,
      faizOrani: String(k.faizOrani),
      currency: k.currency || 'TRY',
      notlar: k.notlar,
    });
    setShowForm(true);
  };

  const handleFormSave = async () => {
    try {
      const toplamTutar = parseFloat(formData.toplamTutar) || 0;
      const tahsilEdilen = editingKayit?.tahsilEdilen ?? 0;
      const durum = calcDurum(toplamTutar, tahsilEdilen, formData.vadeTarihi);

      const payload = {
        musteriAdi: formData.musteriAdi.trim(),
        belgeTipi: formData.belgeTipi,
        belgeNo: formData.belgeNo.trim(),
        toplamTutar,
        tahsilEdilen,
        vadeTarihi: formData.vadeTarihi,
        faturaTarihi: formData.faturaTarihi,
        faizOrani: parseFloat(formData.faizOrani) || 0,
        currency: formData.currency,
        notlar: formData.notlar.trim(),
        durum,
      };

      if (editingKayit) {
        await updateDoc(doc(db, 'tahsilatKayitlari', editingKayit.id), payload);
        showToast('Kayıt güncellendi.');
      } else {
        await addDoc(collection(db, 'tahsilatKayitlari'), { ...payload, createdAt: serverTimestamp() });
        showToast('Kayıt eklendi.');
      }
      setShowForm(false);
    } catch (e) {
      console.error(e);
      showToast('Hata oluştu.', 'error');
    }
  };

  // ── Payment handlers ──────────────────────────────────────────────────────────

  const openPaymentForm = (k: TahsilatKaydi) => {
    setPaymentKaydi(k);
    setPaymentForm({
      tarih: format(new Date(), 'yyyy-MM-dd'),
      tutar: '',
      odemeTipi: 'Havale/EFT',
      notlar: '',
    });
  };

  const handlePaymentSave = async () => {
    if (!paymentKaydi) return;
    try {
      const tutar = parseFloat(paymentForm.tutar) || 0;
      if (tutar <= 0) { showToast('Geçerli bir tutar girin.', 'error'); return; }

      await addDoc(collection(db, 'tahsilatOdemeleri'), {
        kaydiId: paymentKaydi.id,
        tarih: paymentForm.tarih,
        tutar,
        odemeTipi: paymentForm.odemeTipi,
        notlar: paymentForm.notlar.trim(),
        createdAt: serverTimestamp(),
      });

      const newTahsilEdilen = paymentKaydi.tahsilEdilen + tutar;
      const durum = calcDurum(paymentKaydi.toplamTutar, newTahsilEdilen, paymentKaydi.vadeTarihi);
      await updateDoc(doc(db, 'tahsilatKayitlari', paymentKaydi.id), {
        tahsilEdilen: newTahsilEdilen,
        durum,
      });

      showToast('Ödeme kaydedildi.');
      setPaymentKaydi(null);
    } catch (e) {
      console.error(e);
      showToast('Hata oluştu.', 'error');
    }
  };

  // ── Delete ────────────────────────────────────────────────────────────────────

  const handleDelete = async (k: TahsilatKaydi) => {
    try {
      await deleteDoc(doc(db, 'tahsilatKayitlari', k.id));
      showToast('Kayıt silindi.');
      setDeleteTarget(null);
    } catch (e) {
      console.error(e);
      showToast('Silinemedi.', 'error');
    }
  };

  // ── CSV Export ────────────────────────────────────────────────────────────────

  const handleExportCSV = () => {
    const headers = [t.musteri, t.belgeNo, t.belgeTipi, t.faturaTarihi, t.vadeTarihi, t.tutar, t.tahsilat, t.acik, t.gecikFaiz, t.durum];
    const rows = filtered.map((k) => {
      const acik = k.toplamTutar - k.tahsilEdilen;
      const faiz = calcFaiz(acik, k.faizOrani, k.vadeTarihi);
      return [
        k.musteriAdi,
        k.belgeNo,
        k.belgeTipi,
        formatDate(k.faturaTarihi),
        formatDate(k.vadeTarihi),
        k.toplamTutar.toFixed(2),
        k.tahsilEdilen.toFixed(2),
        acik.toFixed(2),
        faiz.toFixed(2),
        k.durum,
      ];
    });
    const csv = [headers, ...rows].map((r) => r.join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tahsilat-${format(new Date(), 'yyyyMMdd')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 space-y-6 relative">

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className={cn(
              'fixed top-6 right-6 z-[200] px-5 py-3 rounded-2xl shadow-xl text-sm font-medium text-white flex items-center gap-2',
              toast.type === 'success' ? 'bg-green-500' : 'bg-red-500'
            )}
          >
            {toast.type === 'success' ? <CheckCircle className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
            {toast.msg}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#1D1D1F]">{t.title}</h1>
          <p className="text-sm text-[#86868B] mt-0.5">{t.subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleExportCSV} className="apple-button-secondary flex items-center gap-1.5 text-sm px-4 py-2">
            <Download className="w-4 h-4" />
            {t.exportCSV}
          </button>
          {isAuthenticated && (
            <button onClick={openNewForm} className="apple-button-primary flex items-center gap-1.5 text-sm px-4 py-2">
              <Plus className="w-4 h-4" />
              {t.yeniKayit}
            </button>
          )}
        </div>
      </div>

      {/* Overview cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Toplam Açık Bakiye */}
        <div className="apple-card p-5 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className="w-10 h-10 rounded-xl bg-[#ff4000] flex items-center justify-center">
              <DollarSign className="w-5 h-5 text-white" />
            </div>
            <CurrencyToggle active={activeCurrency} onChange={setActiveCurrency} />
          </div>
          <div>
            <p className="text-[11px] text-[#86868B] font-medium uppercase tracking-wide">{t.acikBakiye}</p>
            <p className="text-2xl font-bold text-[#1D1D1F] mt-0.5 leading-tight tracking-tight">{formatCurrency(toplam, activeCurrency)}</p>
          </div>
        </div>
        {/* Card 2: Gecikmiş Bakiye */}
        <div className="apple-card p-5 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className="w-10 h-10 rounded-xl bg-red-500 flex items-center justify-center">
              <AlertTriangle className="w-5 h-5 text-white" />
            </div>
            <CurrencyToggle active={activeCurrency} onChange={setActiveCurrency} />
          </div>
          <div>
            <p className="text-[11px] text-[#86868B] font-medium uppercase tracking-wide">{t.gecikmis}</p>
            <p className="text-2xl font-bold text-red-500 mt-0.5 leading-tight tracking-tight">{formatCurrency(gecikmisBakiye, activeCurrency)}</p>
          </div>
        </div>
        {/* Card 3: Bu Ay Vadeli */}
        <div className="apple-card p-5 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className="w-10 h-10 rounded-xl bg-blue-500 flex items-center justify-center">
              <Calendar className="w-5 h-5 text-white" />
            </div>
            <CurrencyToggle active={activeCurrency} onChange={setActiveCurrency} />
          </div>
          <div>
            <p className="text-[11px] text-[#86868B] font-medium uppercase tracking-wide">{t.buAyVadeli}</p>
            <p className="text-2xl font-bold text-blue-500 mt-0.5 leading-tight tracking-tight">{formatCurrency(buAyVadeli, activeCurrency)}</p>
          </div>
        </div>
        {/* Card 4: Ort. Tahsilat Süresi (no toggle needed) */}
        <StatCard
          icon={Clock}
          label={t.ortTahsilat}
          value={`${ortTahsilatSuresi}`}
          color="bg-purple-500"
          sub={t.days}
        />
      </div>

      {/* Aging Report */}
      <div className="apple-card p-5">
        <h2 className="text-base font-semibold text-[#1D1D1F] mb-4 flex items-center gap-2">
          <TrendingDown className="w-4 h-4 text-[#ff4000]" />
          {t.yaslandirma}
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {aging.map((bucket, i) => (
            <div key={i} className="bg-gray-50 rounded-2xl p-4">
              <p className="text-[11px] font-bold text-[#86868B] uppercase tracking-wider">{bucket.label}</p>
              <p className="text-xl font-bold text-[#1D1D1F] mt-1">{formatCurrency(bucket.total, activeCurrency)}</p>
              <p className="text-[11px] text-[#86868B] mt-0.5">{bucket.count} {t.records}</p>
              <div className="mt-3 h-2 bg-gray-200 rounded-full overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${(bucket.total / maxAgingTotal) * 100}%` }}
                  transition={{ duration: 0.6, delay: i * 0.1 }}
                  className={cn(
                    'h-full rounded-full',
                    i === 0 ? 'bg-green-400' : i === 1 ? 'bg-yellow-400' : i === 2 ? 'bg-orange-400' : 'bg-red-500'
                  )}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#86868B]" />
          <input
            type="text"
            className="apple-input w-full pl-9 pr-4 py-2.5 text-sm"
            placeholder={t.aramayap}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="relative">
          <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#86868B]" />
          <select
            className="apple-input pl-9 pr-4 py-2.5 text-sm appearance-none cursor-pointer"
            value={durumFilter}
            onChange={(e) => setDurumFilter(e.target.value)}
          >
            <option value="all">{t.tumDurumlar}</option>
            <option value="Bekliyor">{t.bekliyor}</option>
            <option value="Kısmi Tahsilat">{t.kismiTahsilat}</option>
            <option value="Tahsil Edildi">{t.tahsilEdildi}</option>
            <option value="Gecikmiş">{t.gecikmiş}</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="apple-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-gray-100">
                <SortHeader label={t.musteri} sortKey="musteriAdi" currentSort={sort} onSort={handleSort} />
                <SortHeader label={t.belgeNo} sortKey="belgeNo" currentSort={sort} onSort={handleSort} />
                <SortHeader label={t.faturaTarihi} sortKey="faturaTarihi" currentSort={sort} onSort={handleSort} />
                <SortHeader label={t.vadeTarihi} sortKey="vadeTarihi" currentSort={sort} onSort={handleSort} />
                <SortHeader label={t.tutar} sortKey="toplamTutar" currentSort={sort} onSort={handleSort} />
                <SortHeader label={t.tahsilat} sortKey="tahsilEdilen" currentSort={sort} onSort={handleSort} />
                <th className="px-4 py-3 text-left text-[10px] font-bold text-[#86868B] uppercase tracking-wider">{t.acik}</th>
                <th className="px-4 py-3 text-left text-[10px] font-bold text-[#86868B] uppercase tracking-wider">{t.gecikFaiz}</th>
                <SortHeader label={t.durum} sortKey="durum" currentSort={sort} onSort={handleSort} />
                <th className="px-4 py-3 text-center text-[10px] font-bold text-[#86868B] uppercase tracking-wider">{t.islemler}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-12 text-center text-[#86868B] text-sm">
                    <FileText className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    Kayıt bulunamadı.
                  </td>
                </tr>
              )}
              {filtered.map((k, idx) => {
                const acik = k.toplamTutar - k.tahsilEdilen;
                const faiz = calcFaiz(acik, k.faizOrani, k.vadeTarihi);
                const isGecikmis = k.durum === 'Gecikmiş';
                return (
                  <motion.tr
                    key={k.id}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.03 }}
                    className={cn(
                      'border-b border-gray-50 hover:bg-gray-50/60 transition-colors',
                      isGecikmis && 'bg-red-50/30'
                    )}
                  >
                    <td className="px-4 py-3 text-sm font-medium text-[#1D1D1F]">{k.musteriAdi}</td>
                    <td className="px-4 py-3 text-sm text-[#1D1D1F]">
                      <span className="text-[11px] text-[#86868B] mr-1">{k.belgeTipi}</span>
                      {k.belgeNo}
                    </td>
                    <td className="px-4 py-3 text-sm text-[#1D1D1F]">{formatDate(k.faturaTarihi)}</td>
                    <td className={cn('px-4 py-3 text-sm font-medium', isGecikmis ? 'text-red-600' : 'text-[#1D1D1F]')}>
                      {formatDate(k.vadeTarihi)}
                    </td>
                    <td className="px-4 py-3 text-sm text-[#1D1D1F] font-mono">{formatCurrency(k.toplamTutar, k.currency || 'TRY')}</td>
                    <td className="px-4 py-3 text-sm text-green-600 font-medium font-mono">{formatCurrency(k.tahsilEdilen, k.currency || 'TRY')}</td>
                    <td className={cn('px-4 py-3 text-sm font-bold font-mono', acik > 0 ? 'text-[#ff4000]' : 'text-green-600')}>
                      {formatCurrency(acik, k.currency || 'TRY')}
                    </td>
                    <td className="px-4 py-3 text-sm text-orange-600 font-mono">
                      {faiz > 0 ? formatCurrency(faiz, k.currency || 'TRY') : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <DurumBadge durum={k.durum} t={t} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1">
                        {isAuthenticated && k.durum !== 'Tahsil Edildi' && (
                          <button
                            onClick={() => openPaymentForm(k)}
                            className="p-1.5 rounded-lg hover:bg-green-100 text-green-600 transition-colors"
                            title={t.tahsilatEkle}
                          >
                            <CreditCard className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {isAuthenticated && (
                          <button
                            onClick={() => openEditForm(k)}
                            className="p-1.5 rounded-lg hover:bg-blue-100 text-blue-600 transition-colors"
                            title={t.kayitDuzenle}
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {isAuthenticated && (
                          <button
                            onClick={() => setDeleteTarget(k)}
                            className="p-1.5 rounded-lg hover:bg-red-100 text-red-500 transition-colors"
                            title={t.sil}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </motion.tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Add/Edit Form Panel ──────────────────────────────────────────────── */}
      <AnimatePresence>
        {showForm && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/20 backdrop-blur-sm z-[100]"
              onClick={() => setShowForm(false)}
            />
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              className="fixed right-0 top-0 h-full w-full max-w-[480px] bg-white shadow-2xl z-[110] flex flex-col"
            >
              <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
                <h2 className="text-base font-semibold text-[#1D1D1F]">
                  {editingKayit ? t.kayitDuzenle : t.yeniTahsilatKaydi}
                </h2>
                <button onClick={() => setShowForm(false)} className="p-2 rounded-xl hover:bg-gray-100 transition-colors">
                  <X className="w-4 h-4 text-[#86868B]" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
                <div>
                  <label className="block text-[11px] font-semibold text-[#86868B] uppercase tracking-wider mb-1.5">{t.musteriAdi}</label>
                  <input
                    type="text"
                    className="apple-input w-full px-4 py-2.5 text-sm"
                    value={formData.musteriAdi}
                    onChange={(e) => setFormData((f) => ({ ...f, musteriAdi: e.target.value }))}
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-[#86868B] uppercase tracking-wider mb-1.5">{t.belgeTipi}</label>
                    <select
                      className="apple-input w-full px-4 py-2.5 text-sm appearance-none cursor-pointer"
                      value={formData.belgeTipi}
                      onChange={(e) => setFormData((f) => ({ ...f, belgeTipi: e.target.value as TahsilatKaydi['belgeTipi'] }))}
                    >
                      <option>Fatura</option>
                      <option>İrsaliye</option>
                      <option>Sözleşme</option>
                      <option>Diğer</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-[#86868B] uppercase tracking-wider mb-1.5">{t.belgeNo}</label>
                    <input
                      type="text"
                      className="apple-input w-full px-4 py-2.5 text-sm"
                      value={formData.belgeNo}
                      onChange={(e) => setFormData((f) => ({ ...f, belgeNo: e.target.value }))}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-1">
                    <label className="block text-[11px] font-semibold text-[#86868B] uppercase tracking-wider mb-1.5">{t.toplamTutar}</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      className="apple-input w-full px-4 py-2.5 text-sm"
                      value={formData.toplamTutar}
                      onChange={(e) => setFormData((f) => ({ ...f, toplamTutar: e.target.value }))}
                    />
                  </div>
                  <div className="col-span-1">
                    <label className="block text-[11px] font-semibold text-[#86868B] uppercase tracking-wider mb-1.5">{t.currency || 'Para Birimi'}</label>
                    <div className="flex bg-gray-100 rounded-xl p-0.5">
                      {(['TRY', 'USD', 'EUR'] as const).map(c => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => setFormData(f => ({ ...f, currency: c }))}
                          className={cn(
                            'flex-1 py-2 rounded-lg text-xs font-bold transition-all',
                            formData.currency === c ? 'bg-white text-brand shadow-sm' : 'text-gray-400 hover:text-gray-600'
                          )}
                        >
                          {c}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-[#86868B] uppercase tracking-wider mb-1.5">{t.faturaTarihi}</label>
                    <input
                      type="date"
                      className="apple-input w-full px-4 py-2.5 text-sm"
                      value={formData.faturaTarihi}
                      onChange={(e) => setFormData((f) => ({ ...f, faturaTarihi: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-[#86868B] uppercase tracking-wider mb-1.5">{t.vadeTarihi}</label>
                    <input
                      type="date"
                      className="apple-input w-full px-4 py-2.5 text-sm"
                      value={formData.vadeTarihi}
                      onChange={(e) => setFormData((f) => ({ ...f, vadeTarihi: e.target.value }))}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-[#86868B] uppercase tracking-wider mb-1.5">{t.faizOrani}</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    className="apple-input w-full px-4 py-2.5 text-sm"
                    value={formData.faizOrani}
                    onChange={(e) => setFormData((f) => ({ ...f, faizOrani: e.target.value }))}
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-[#86868B] uppercase tracking-wider mb-1.5">{t.notlar}</label>
                  <textarea
                    rows={3}
                    className="apple-input w-full px-4 py-2.5 text-sm resize-none"
                    value={formData.notlar}
                    onChange={(e) => setFormData((f) => ({ ...f, notlar: e.target.value }))}
                  />
                </div>
              </div>

              <div className="px-6 py-4 border-t border-gray-100 flex gap-3">
                <button onClick={() => setShowForm(false)} className="apple-button-secondary flex-1 py-2.5 text-sm">
                  {t.iptal}
                </button>
                <button onClick={handleFormSave} className="apple-button-primary flex-1 py-2.5 text-sm">
                  {t.kaydet}
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ── Payment Form Modal ───────────────────────────────────────────────── */}
      <AnimatePresence>
        {paymentKaydi && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/20 backdrop-blur-sm z-[100]"
              onClick={() => setPaymentKaydi(null)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              className="fixed inset-0 z-[110] flex items-center justify-center p-4"
            >
              <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-base font-semibold text-[#1D1D1F]">{t.odemeEkle}</h2>
                    <p className="text-[12px] text-[#86868B] mt-0.5">{paymentKaydi.musteriAdi} · {paymentKaydi.belgeNo}</p>
                  </div>
                  <button onClick={() => setPaymentKaydi(null)} className="p-2 rounded-xl hover:bg-gray-100 transition-colors">
                    <X className="w-4 h-4 text-[#86868B]" />
                  </button>
                </div>

                <div className="bg-gray-50 rounded-2xl p-3 flex justify-between text-sm">
                  <span className="text-[#86868B]">{t.acik}</span>
                  <span className="font-semibold text-[#ff4000]">
                    {formatCurrency(paymentKaydi.toplamTutar - paymentKaydi.tahsilEdilen)}
                  </span>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-[#86868B] uppercase tracking-wider mb-1.5">{t.tarih}</label>
                  <input
                    type="date"
                    className="apple-input w-full px-4 py-2.5 text-sm"
                    value={paymentForm.tarih}
                    onChange={(e) => setPaymentForm((f) => ({ ...f, tarih: e.target.value }))}
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-[#86868B] uppercase tracking-wider mb-1.5">{t.tutar}</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    className="apple-input w-full px-4 py-2.5 text-sm"
                    value={paymentForm.tutar}
                    onChange={(e) => setPaymentForm((f) => ({ ...f, tutar: e.target.value }))}
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-[#86868B] uppercase tracking-wider mb-1.5">{t.odemeTipi}</label>
                  <select
                    className="apple-input w-full px-4 py-2.5 text-sm appearance-none cursor-pointer"
                    value={paymentForm.odemeTipi}
                    onChange={(e) => setPaymentForm((f) => ({ ...f, odemeTipi: e.target.value as TahsilatOdeme['odemeTipi'] }))}
                  >
                    <option>Nakit</option>
                    <option>Havale/EFT</option>
                    <option>Çek</option>
                    <option>Kredi Kartı</option>
                    <option>Mahsup</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-[#86868B] uppercase tracking-wider mb-1.5">{t.notlar}</label>
                  <input
                    type="text"
                    className="apple-input w-full px-4 py-2.5 text-sm"
                    value={paymentForm.notlar}
                    onChange={(e) => setPaymentForm((f) => ({ ...f, notlar: e.target.value }))}
                  />
                </div>

                <div className="flex gap-3 pt-1">
                  <button onClick={() => setPaymentKaydi(null)} className="apple-button-secondary flex-1 py-2.5 text-sm">
                    {t.iptal}
                  </button>
                  <button onClick={handlePaymentSave} className="apple-button-primary flex-1 py-2.5 text-sm flex items-center justify-center gap-1.5">
                    <CreditCard className="w-4 h-4" />
                    {t.odemeKaydet}
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ── Delete Confirm Modal ─────────────────────────────────────────────── */}
      <AnimatePresence>
        {deleteTarget && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/20 backdrop-blur-sm z-[100]"
              onClick={() => setDeleteTarget(null)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="fixed inset-0 z-[110] flex items-center justify-center p-4"
            >
              <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm p-6 space-y-4 text-center">
                <div className="w-12 h-12 bg-red-100 rounded-2xl flex items-center justify-center mx-auto">
                  <Trash2 className="w-5 h-5 text-red-500" />
                </div>
                <div>
                  <p className="font-semibold text-[#1D1D1F]">{t.silOnayi}</p>
                  <p className="text-sm text-[#86868B] mt-1">{deleteTarget.musteriAdi} · {deleteTarget.belgeNo}</p>
                </div>
                <div className="flex gap-3">
                  <button onClick={() => setDeleteTarget(null)} className="apple-button-secondary flex-1 py-2.5 text-sm">
                    {t.iptal}
                  </button>
                  <button
                    onClick={() => handleDelete(deleteTarget)}
                    className="flex-1 py-2.5 text-sm font-medium rounded-full bg-red-500 text-white hover:bg-red-600 transition-colors"
                  >
                    {t.evet}
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
