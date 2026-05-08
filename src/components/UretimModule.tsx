/**
 * UretimModule.tsx — Production / Manufacturing ERP Module
 *
 * Firestore collections:
 *   uretimReceteler   — BOM records (reçeteler)
 *   uretimEmirleri    — Production orders
 *   uretimKaliteKontrol — QC records
 *
 * Sub-tabs:
 *   1. Reçeteler / BOM
 *   2. Üretim Emirleri
 *   3. Malzeme İhtiyacı (MRP — read-only, computed)
 *   4. Kalite Kontrol
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Factory, ClipboardList, Package, ShieldCheck, FlaskConical,
  Plus, Trash2, Edit2, X, Search, RefreshCw,
  ChevronDown, ChevronUp, CheckCircle2, AlertTriangle,
  Clock, PlayCircle, PauseCircle, Ban, CheckSquare,
  TrendingUp, Layers, Activity, BarChart3,
} from 'lucide-react';
import { db } from '../firebase';
import {
  collection, onSnapshot, addDoc, updateDoc, deleteDoc,
  doc, serverTimestamp, query, orderBy,
} from 'firebase/firestore';
import { cn } from '../lib/utils';
import { logFirestoreError, OperationType } from '../utils/firebase';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type ReceteDurum = 'Aktif' | 'Revizyon' | 'Arşiv';
type EmirDurum = 'Planlandı' | 'Üretimde' | 'Beklemede' | 'Tamamlandı' | 'İptal';
type KKSonuc = 'Geçti' | 'Kaldı' | 'Şartlı';

interface MalzemeKalemi {
  malzemeAdi: string;
  miktar: number;
  birim: string;
  maliyet: number;
}

interface Recete {
  id: string;
  receteNo: string;
  urunAdi: string;
  birim: string;
  kalemler: MalzemeKalemi[];
  toplamMaliyet: number;
  durum: ReceteDurum;
  createdAt?: unknown;
}

interface UretimEmri {
  id: string;
  emirNo: string;
  urunAdi: string;
  receteNo: string;
  siparisAdedi: number;
  tamamlananAdedi: number;
  planlananBaslangic: string;
  planlananBitis: string;
  durum: EmirDurum;
  notlar: string;
  createdAt?: unknown;
}

interface KaliteKontrol {
  id: string;
  kontrolNo: string;
  uretimEmriNo: string;
  kontrolTarihi: string;
  kontrolEden: string;
  sonuc: KKSonuc;
  notlar: string;
  createdAt?: unknown;
}

interface MRPRow {
  malzeme: string;
  gerekenMiktar: number;
  birim: string;
  receteNo: string;
  emirNo: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants & Helpers
// ─────────────────────────────────────────────────────────────────────────────

const BIRIMLER = ['adet', 'kg', 'g', 'm', 'cm', 'lt', 'm²', 'm³', 'rol', 'kutu', 'palet', 'pk'];

const RECETE_DURUM_STYLES: Record<ReceteDurum, string> = {
  'Aktif':    'bg-green-500/10 text-green-600 border border-green-500/20',
  'Revizyon': 'bg-amber-500/10 text-amber-600 border border-amber-500/20',
  'Arşiv':    'bg-gray-400/10 text-gray-500 border border-gray-400/20',
};

const EMIR_DURUM_STYLES: Record<EmirDurum, string> = {
  'Planlandı':  'bg-blue-500/10 text-blue-600 border border-blue-500/20',
  'Üretimde':   'bg-green-500/10 text-green-600 border border-green-500/20',
  'Beklemede':  'bg-amber-500/10 text-amber-600 border border-amber-500/20',
  'Tamamlandı': 'bg-emerald-500/10 text-emerald-600 border border-emerald-500/20',
  'İptal':      'bg-red-500/10 text-red-500 border border-red-500/20',
};

const KK_SONUC_STYLES: Record<KKSonuc, string> = {
  'Geçti':   'bg-green-500/10 text-green-600 border border-green-500/20',
  'Kaldı':   'bg-red-500/10 text-red-500 border border-red-500/20',
  'Şartlı':  'bg-amber-500/10 text-amber-600 border border-amber-500/20',
};

function padded(n: number, len = 4) {
  return String(n).padStart(len, '0');
}

function genReceteNo(count: number): string {
  return `REC-${padded(count + 1)}`;
}

function genEmirNo(count: number): string {
  return `EM-2026-${padded(count + 1)}`;
}

function genKontrolNo(count: number): string {
  return `KK-${padded(count + 1)}`;
}

function calcToplamMaliyet(kalemler: MalzemeKalemi[]): number {
  return kalemler.reduce((s, k) => s + (k.maliyet * k.miktar || 0), 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// Default form values (proper typed objects — no `as const`)
// ─────────────────────────────────────────────────────────────────────────────

function defaultRecete(): Omit<Recete, 'id' | 'createdAt'> {
  return {
    receteNo: '',
    urunAdi: '',
    birim: 'adet',
    kalemler: [],
    toplamMaliyet: 0,
    durum: 'Aktif' as ReceteDurum,
  };
}

function defaultEmri(): Omit<UretimEmri, 'id' | 'createdAt'> {
  return {
    emirNo: '',
    urunAdi: '',
    receteNo: '',
    siparisAdedi: 1,
    tamamlananAdedi: 0,
    planlananBaslangic: '',
    planlananBitis: '',
    durum: 'Planlandı' as EmirDurum,
    notlar: '',
  };
}

function defaultKK(): Omit<KaliteKontrol, 'id' | 'createdAt'> {
  return {
    kontrolNo: '',
    uretimEmriNo: '',
    kontrolTarihi: '',
    kontrolEden: '',
    sonuc: 'Geçti' as KKSonuc,
    notlar: '',
  };
}

function defaultKalem(): MalzemeKalemi {
  return { malzemeAdi: '', miktar: 1, birim: 'adet', maliyet: 0 };
}

// ─────────────────────────────────────────────────────────────────────────────
// Small reusable sub-components
// ─────────────────────────────────────────────────────────────────────────────

function KPICard({
  label, value, icon: Icon, color, bg,
}: {
  label: string; value: string | number;
  icon: React.ElementType; color: string; bg: string;
}) {
  return (
    <div className="apple-card p-4 flex items-center gap-3">
      <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center shrink-0', bg)}>
        <Icon className={cn('w-4 h-4', color)} />
      </div>
      <div>
        <p className="text-xl font-bold text-[#1D1D1F]">{value}</p>
        <p className="text-[11px] text-gray-400 leading-tight">{label}</p>
      </div>
    </div>
  );
}

function StatusBadge({ label, style }: { label: string; style: string }) {
  return (
    <span className={cn('px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide', style)}>
      {label}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

export default function UretimModule({
  currentLanguage,
  isAuthenticated,
}: {
  currentLanguage: string;
  isAuthenticated: boolean;
}) {
  const tr = currentLanguage === 'tr';

  // ── active sub-tab ────────────────────────────────────────────────────────
  type Tab = 'receteler' | 'emirler' | 'mrp' | 'kalite';
  const [activeTab, setActiveTab] = useState<Tab>('receteler');

  // ── Firestore data ─────────────────────────────────────────────────────────
  const [receteler, setReceteler]   = useState<Recete[]>([]);
  const [emirler,   setEmirler]     = useState<UretimEmri[]>([]);
  const [kaliteKayitlari, setKaliteKayitlari] = useState<KaliteKontrol[]>([]);

  // ── search ─────────────────────────────────────────────────────────────────
  const [receteAra, setReceteAra] = useState('');
  const [emirAra,   setEmirAra]   = useState('');
  const [kkAra,     setKkAra]     = useState('');

  // ── expanded reçete rows ───────────────────────────────────────────────────
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // ── Reçete modal state ─────────────────────────────────────────────────────
  const [showReceteModal, setShowReceteModal] = useState(false);
  const [editingRecete,   setEditingRecete]   = useState<Recete | null>(null);
  const [receteForm,      setReceteForm]      = useState<Omit<Recete, 'id' | 'createdAt'>>(defaultRecete());
  const [receteSaving,    setReceteSaving]    = useState(false);

  // ── Üretim emri modal state ────────────────────────────────────────────────
  const [showEmirModal, setShowEmirModal] = useState(false);
  const [editingEmir,   setEditingEmir]   = useState<UretimEmri | null>(null);
  const [emirForm,      setEmirForm]      = useState<Omit<UretimEmri, 'id' | 'createdAt'>>(defaultEmri());
  const [emirSaving,    setEmirSaving]    = useState(false);

  // ── Kalite modal state ─────────────────────────────────────────────────────
  const [showKKModal, setShowKKModal] = useState(false);
  const [editingKK,   setEditingKK]   = useState<KaliteKontrol | null>(null);
  const [kkForm,      setKkForm]      = useState<Omit<KaliteKontrol, 'id' | 'createdAt'>>(defaultKK());
  const [kkSaving,    setKkSaving]    = useState(false);

  // ─────────────────────────────────────────────────────────────────────────
  // Firestore subscriptions (staggered to avoid connection saturation)
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isAuthenticated) return;
    const unsubs: (() => void)[] = [];

    const t0 = setTimeout(() => {
      const unsub = onSnapshot(
        query(collection(db, 'uretimReceteler'), orderBy('createdAt', 'desc')),
        (snap) => setReceteler(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Recete))),
        (err) => logFirestoreError(err, OperationType.LIST, 'uretimReceteler'),
      );
      unsubs.push(unsub);
    }, 0);

    const t1 = setTimeout(() => {
      const unsub = onSnapshot(
        query(collection(db, 'uretimEmirleri'), orderBy('createdAt', 'desc')),
        (snap) => setEmirler(snap.docs.map((d) => ({ id: d.id, ...d.data() } as UretimEmri))),
        (err) => logFirestoreError(err, OperationType.LIST, 'uretimEmirleri'),
      );
      unsubs.push(unsub);
    }, 120);

    const t2 = setTimeout(() => {
      const unsub = onSnapshot(
        query(collection(db, 'uretimKaliteKontrol'), orderBy('createdAt', 'desc')),
        (snap) => setKaliteKayitlari(snap.docs.map((d) => ({ id: d.id, ...d.data() } as KaliteKontrol))),
        (err) => logFirestoreError(err, OperationType.LIST, 'uretimKaliteKontrol'),
      );
      unsubs.push(unsub);
    }, 240);

    return () => {
      clearTimeout(t0); clearTimeout(t1); clearTimeout(t2);
      unsubs.forEach((u) => u());
    };
  }, [isAuthenticated]);

  // ─────────────────────────────────────────────────────────────────────────
  // MRP computation — derived from active production orders + BOMs
  // ─────────────────────────────────────────────────────────────────────────
  const mrpRows = useMemo<MRPRow[]>(() => {
    const aktifEmirleri = emirler.filter((e) =>
      e.durum === 'Planlandı' || e.durum === 'Üretimde' || e.durum === 'Beklemede'
    );

    const rows: MRPRow[] = [];

    for (const emir of aktifEmirleri) {
      const recete = receteler.find((r) => r.receteNo === emir.receteNo);
      if (!recete) continue;
      const bekleyen = Math.max(0, emir.siparisAdedi - emir.tamamlananAdedi);
      for (const kalem of recete.kalemler) {
        rows.push({
          malzeme:      kalem.malzemeAdi,
          gerekenMiktar: kalem.miktar * bekleyen,
          birim:         kalem.birim,
          receteNo:      recete.receteNo,
          emirNo:        emir.emirNo,
        });
      }
    }

    return rows;
  }, [emirler, receteler]);

  // ─────────────────────────────────────────────────────────────────────────
  // Reçete CRUD
  // ─────────────────────────────────────────────────────────────────────────
  const openNewRecete = useCallback(() => {
    setEditingRecete(null);
    const base = defaultRecete();
    setReceteForm({ ...base, receteNo: genReceteNo(receteler.length) });
    setShowReceteModal(true);
  }, [receteler.length]);

  const openEditRecete = useCallback((r: Recete) => {
    setEditingRecete(r);
    const { id: _id, createdAt: _ca, ...rest } = r;
    setReceteForm(rest);
    setShowReceteModal(true);
  }, []);

  const closeReceteModal = () => { setShowReceteModal(false); setEditingRecete(null); };

  const handleReceteSave = async () => {
    if (!receteForm.urunAdi.trim()) return;
    setReceteSaving(true);
    const payload = { ...receteForm, toplamMaliyet: calcToplamMaliyet(receteForm.kalemler) };
    try {
      if (editingRecete) {
        await updateDoc(doc(db, 'uretimReceteler', editingRecete.id), payload);
      } else {
        await addDoc(collection(db, 'uretimReceteler'), { ...payload, createdAt: serverTimestamp() });
      }
      closeReceteModal();
    } catch (err) {
      logFirestoreError(err, editingRecete ? OperationType.UPDATE : OperationType.CREATE, 'uretimReceteler');
    } finally {
      setReceteSaving(false);
    }
  };

  const handleReceteSil = async (id: string) => {
    if (!window.confirm(tr ? 'Bu reçeteyi silmek istediğinize emin misiniz?' : 'Delete this BOM?')) return;
    await deleteDoc(doc(db, 'uretimReceteler', id)).catch((err) =>
      logFirestoreError(err, OperationType.DELETE, 'uretimReceteler')
    );
  };

  // Kalem helpers
  const addKalem = () =>
    setReceteForm((f) => ({ ...f, kalemler: [...f.kalemler, defaultKalem()] }));

  const updateKalem = (i: number, patch: Partial<MalzemeKalemi>) =>
    setReceteForm((f) => ({
      ...f,
      kalemler: f.kalemler.map((k, idx) => (idx === i ? { ...k, ...patch } : k)),
    }));

  const removeKalem = (i: number) =>
    setReceteForm((f) => ({ ...f, kalemler: f.kalemler.filter((_, idx) => idx !== i) }));

  // ─────────────────────────────────────────────────────────────────────────
  // Üretim Emri CRUD
  // ─────────────────────────────────────────────────────────────────────────
  const openNewEmir = useCallback(() => {
    setEditingEmir(null);
    setEmirForm({ ...defaultEmri(), emirNo: genEmirNo(emirler.length) });
    setShowEmirModal(true);
  }, [emirler.length]);

  const openEditEmir = useCallback((e: UretimEmri) => {
    setEditingEmir(e);
    const { id: _id, createdAt: _ca, ...rest } = e;
    setEmirForm(rest);
    setShowEmirModal(true);
  }, []);

  const closeEmirModal = () => { setShowEmirModal(false); setEditingEmir(null); };

  const handleEmirSave = async () => {
    if (!emirForm.urunAdi.trim()) return;
    setEmirSaving(true);
    try {
      if (editingEmir) {
        await updateDoc(doc(db, 'uretimEmirleri', editingEmir.id), { ...emirForm });
      } else {
        await addDoc(collection(db, 'uretimEmirleri'), { ...emirForm, createdAt: serverTimestamp() });
      }
      closeEmirModal();
    } catch (err) {
      logFirestoreError(err, editingEmir ? OperationType.UPDATE : OperationType.CREATE, 'uretimEmirleri');
    } finally {
      setEmirSaving(false);
    }
  };

  const handleEmirSil = async (id: string) => {
    if (!window.confirm(tr ? 'Bu üretim emrini silmek istediğinize emin misiniz?' : 'Delete this production order?')) return;
    await deleteDoc(doc(db, 'uretimEmirleri', id)).catch((err) =>
      logFirestoreError(err, OperationType.DELETE, 'uretimEmirleri')
    );
  };

  const handleEmirDurumDegistir = async (emir: UretimEmri, yeniDurum: EmirDurum) => {
    const updates: Partial<UretimEmri> = { durum: yeniDurum };
    if (yeniDurum === 'Tamamlandı') updates.tamamlananAdedi = emir.siparisAdedi;
    await updateDoc(doc(db, 'uretimEmirleri', emir.id), updates).catch((err) =>
      logFirestoreError(err, OperationType.UPDATE, 'uretimEmirleri')
    );
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Kalite Kontrol CRUD
  // ─────────────────────────────────────────────────────────────────────────
  const openNewKK = useCallback(() => {
    setEditingKK(null);
    setKkForm({ ...defaultKK(), kontrolNo: genKontrolNo(kaliteKayitlari.length) });
    setShowKKModal(true);
  }, [kaliteKayitlari.length]);

  const openEditKK = useCallback((k: KaliteKontrol) => {
    setEditingKK(k);
    const { id: _id, createdAt: _ca, ...rest } = k;
    setKkForm(rest);
    setShowKKModal(true);
  }, []);

  const closeKKModal = () => { setShowKKModal(false); setEditingKK(null); };

  const handleKKSave = async () => {
    if (!kkForm.kontrolNo.trim()) return;
    setKkSaving(true);
    try {
      if (editingKK) {
        await updateDoc(doc(db, 'uretimKaliteKontrol', editingKK.id), { ...kkForm });
      } else {
        await addDoc(collection(db, 'uretimKaliteKontrol'), { ...kkForm, createdAt: serverTimestamp() });
      }
      closeKKModal();
    } catch (err) {
      logFirestoreError(err, editingKK ? OperationType.UPDATE : OperationType.CREATE, 'uretimKaliteKontrol');
    } finally {
      setKkSaving(false);
    }
  };

  const handleKKSil = async (id: string) => {
    if (!window.confirm(tr ? 'Bu kayıt silinsin mi?' : 'Delete this QC record?')) return;
    await deleteDoc(doc(db, 'uretimKaliteKontrol', id)).catch((err) =>
      logFirestoreError(err, OperationType.DELETE, 'uretimKaliteKontrol')
    );
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Filtered lists
  // ─────────────────────────────────────────────────────────────────────────
  const filteredReceteler = receteler.filter((r) =>
    r.urunAdi.toLowerCase().includes(receteAra.toLowerCase()) ||
    r.receteNo.toLowerCase().includes(receteAra.toLowerCase())
  );

  const filteredEmirler = emirler.filter((e) =>
    e.urunAdi.toLowerCase().includes(emirAra.toLowerCase()) ||
    e.emirNo.toLowerCase().includes(emirAra.toLowerCase())
  );

  const filteredKK = kaliteKayitlari.filter((k) =>
    k.kontrolNo.toLowerCase().includes(kkAra.toLowerCase()) ||
    k.uretimEmriNo.toLowerCase().includes(kkAra.toLowerCase()) ||
    k.kontrolEden.toLowerCase().includes(kkAra.toLowerCase())
  );

  // ─────────────────────────────────────────────────────────────────────────
  // KPI helpers
  // ─────────────────────────────────────────────────────────────────────────
  const aktifReceteSayisi  = receteler.filter((r) => r.durum === 'Aktif').length;
  const aktifEmirSayisi    = emirler.filter((e) => e.durum === 'Üretimde').length;
  const tamamlananEmir     = emirler.filter((e) => e.durum === 'Tamamlandı').length;
  const gectiKK            = kaliteKayitlari.filter((k) => k.sonuc === 'Geçti').length;
  const basarisizKK        = kaliteKayitlari.filter((k) => k.sonuc === 'Kaldı').length;
  const mrpSatirSayisi     = mrpRows.length;

  // ─────────────────────────────────────────────────────────────────────────
  // Tabs definition
  // ─────────────────────────────────────────────────────────────────────────
  const tabs: { id: Tab; labelTr: string; labelEn: string; icon: React.ElementType }[] = [
    { id: 'receteler', labelTr: 'Reçeteler / BOM', labelEn: 'Bills of Materials', icon: ClipboardList },
    { id: 'emirler',   labelTr: 'Üretim Emirleri', labelEn: 'Production Orders',  icon: Factory },
    { id: 'mrp',       labelTr: 'Malzeme İhtiyacı', labelEn: 'Material Req.',     icon: Layers },
    { id: 'kalite',    labelTr: 'Kalite Kontrol',   labelEn: 'Quality Control',   icon: ShieldCheck },
  ];

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">

      {/* ── Module header ───────────────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 bg-brand/10 rounded-2xl flex items-center justify-center">
            <Factory className="w-5 h-5 text-brand" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-[#1D1D1F]">
              {tr ? 'Üretim Yönetimi' : 'Production Management'}
            </h2>
            <p className="text-xs text-gray-400">
              {tr ? 'Reçete, üretim emri, MRP ve kalite kontrol' : 'BOM, production orders, MRP & quality control'}
            </p>
          </div>
        </div>

        {/* Tab-specific primary action */}
        {activeTab === 'receteler' && (
          <button onClick={openNewRecete} className="apple-button-primary flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white">
            <Plus className="w-4 h-4" />
            {tr ? 'Yeni Reçete' : 'New BOM'}
          </button>
        )}
        {activeTab === 'emirler' && (
          <button onClick={openNewEmir} className="apple-button-primary flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white">
            <Plus className="w-4 h-4" />
            {tr ? 'Yeni Üretim Emri' : 'New Production Order'}
          </button>
        )}
        {activeTab === 'kalite' && (
          <button onClick={openNewKK} className="apple-button-primary flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white">
            <Plus className="w-4 h-4" />
            {tr ? 'Yeni Kontrol' : 'New QC Record'}
          </button>
        )}
      </div>

      {/* ── Tab bar ─────────────────────────────────────────────────────── */}
      <div className="overflow-x-auto scrollbar-none border-b border-gray-100">
        <div className="w-max flex items-center gap-0 pb-px">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'shrink-0 flex items-center gap-2 px-5 py-3 text-sm font-bold transition-all relative whitespace-nowrap',
                activeTab === tab.id ? 'text-brand' : 'text-gray-400 hover:text-brand/60'
              )}
            >
              <tab.icon className="w-4 h-4" />
              {tr ? tab.labelTr : tab.labelEn}
              {activeTab === tab.id && (
                <motion.div
                  layoutId="uretimActiveTab"
                  className="absolute bottom-0 left-0 right-0 h-0.5 bg-brand rounded-full"
                />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════
          TAB 1 — Reçeteler / BOM
      ══════════════════════════════════════════════════════════════════ */}
      {activeTab === 'receteler' && (
        <div className="space-y-4">
          {/* KPI strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <KPICard label={tr ? 'Toplam Reçete' : 'Total BOMs'}      value={receteler.length}   icon={ClipboardList} color="text-brand"     bg="bg-brand/10"    />
            <KPICard label={tr ? 'Aktif'         : 'Active'}           value={aktifReceteSayisi}  icon={CheckCircle2}  color="text-green-600" bg="bg-green-50"    />
            <KPICard label={tr ? 'Revizyon'      : 'Revision'}         value={receteler.filter(r=>r.durum==='Revizyon').length} icon={RefreshCw} color="text-amber-600" bg="bg-amber-50" />
            <KPICard label={tr ? 'Arşiv'         : 'Archived'}         value={receteler.filter(r=>r.durum==='Arşiv').length}    icon={BarChart3} color="text-gray-500"  bg="bg-gray-100"  />
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              value={receteAra}
              onChange={(e) => setReceteAra(e.target.value)}
              placeholder={tr ? 'Ürün adı veya reçete no ara…' : 'Search product name or BOM no…'}
              className="apple-input pl-9 w-full text-sm"
            />
          </div>

          {/* List */}
          {filteredReceteler.length === 0 ? (
            <div className="apple-card flex flex-col items-center justify-center py-16 text-gray-400">
              <ClipboardList className="w-10 h-10 mb-3 opacity-20" />
              <p className="text-sm">{tr ? 'Henüz reçete yok.' : 'No BOMs yet.'}</p>
              <button onClick={openNewRecete} className="mt-3 text-brand font-bold text-sm hover:underline">
                {tr ? '+ İlk reçeteyi oluştur' : '+ Create first BOM'}
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredReceteler.map((recete) => {
                const isExp = !!expanded[recete.id];
                return (
                  <div key={recete.id} className="apple-card overflow-hidden">
                    {/* Card row */}
                    <div className="flex items-center gap-3 p-4">
                      <div className="w-9 h-9 bg-brand/10 rounded-xl flex items-center justify-center shrink-0">
                        <ClipboardList className="w-4 h-4 text-brand" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-sm text-[#1D1D1F] truncate">{recete.urunAdi}</span>
                          <span className="text-[10px] font-mono text-gray-400">{recete.receteNo}</span>
                          <StatusBadge label={tr
                            ? recete.durum
                            : recete.durum === 'Aktif' ? 'Active' : recete.durum === 'Revizyon' ? 'Revision' : 'Archived'
                          } style={RECETE_DURUM_STYLES[recete.durum]} />
                        </div>
                        <div className="flex items-center gap-3 text-[11px] text-gray-400 mt-0.5">
                          <span>{recete.kalemler.length} {tr ? 'malzeme' : 'items'}</span>
                          <span>•</span>
                          <span>{tr ? 'Birim:' : 'Unit:'} {recete.birim}</span>
                          <span>•</span>
                          <span className="font-semibold text-gray-600">
                            {tr ? 'Maliyet:' : 'Cost:'} ₺{recete.toplamMaliyet.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button onClick={() => openEditRecete(recete)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 transition-colors"><Edit2 className="w-3.5 h-3.5" /></button>
                        <button onClick={() => handleReceteSil(recete.id)} className="p-1.5 rounded-lg hover:bg-red-50 text-red-400 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                        <button
                          onClick={() => setExpanded((e) => ({ ...e, [recete.id]: !e[recete.id] }))}
                          className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 transition-colors"
                        >
                          {isExp ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </div>

                    {/* Expanded kalemler table */}
                    <AnimatePresence>
                      {isExp && recete.kalemler.length > 0 && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.2 }}
                          className="overflow-hidden"
                        >
                          <div className="border-t border-gray-100 overflow-x-auto">
                            <table className="w-full text-xs">
                              <thead className="bg-gray-50">
                                <tr>
                                  <th className="px-4 py-2 text-left text-[10px] font-bold text-gray-400 uppercase">{tr ? 'Malzeme' : 'Material'}</th>
                                  <th className="px-4 py-2 text-right text-[10px] font-bold text-gray-400 uppercase">{tr ? 'Miktar' : 'Qty'}</th>
                                  <th className="px-4 py-2 text-center text-[10px] font-bold text-gray-400 uppercase">{tr ? 'Birim' : 'Unit'}</th>
                                  <th className="px-4 py-2 text-right text-[10px] font-bold text-gray-400 uppercase">{tr ? 'Birim Maliyet' : 'Unit Cost'}</th>
                                  <th className="px-4 py-2 text-right text-[10px] font-bold text-gray-400 uppercase">{tr ? 'Toplam' : 'Total'}</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-50">
                                {recete.kalemler.map((k, i) => (
                                  <tr key={i} className="hover:bg-gray-50/60">
                                    <td className="px-4 py-2 font-medium text-gray-800">{k.malzemeAdi}</td>
                                    <td className="px-4 py-2 text-right">{k.miktar}</td>
                                    <td className="px-4 py-2 text-center text-gray-500">{k.birim}</td>
                                    <td className="px-4 py-2 text-right text-gray-500">₺{k.maliyet.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}</td>
                                    <td className="px-4 py-2 text-right font-semibold">₺{(k.maliyet * k.miktar).toLocaleString('tr-TR', { minimumFractionDigits: 2 })}</td>
                                  </tr>
                                ))}
                              </tbody>
                              <tfoot className="bg-gray-50">
                                <tr>
                                  <td colSpan={4} className="px-4 py-2 text-right text-[10px] font-bold text-gray-500 uppercase">{tr ? 'Toplam Maliyet' : 'Total Cost'}</td>
                                  <td className="px-4 py-2 text-right font-bold text-brand">₺{recete.toplamMaliyet.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}</td>
                                </tr>
                              </tfoot>
                            </table>
                          </div>
                        </motion.div>
                      )}
                      {isExp && recete.kalemler.length === 0 && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          className="border-t border-gray-100 px-4 py-3 text-center text-xs text-gray-400"
                        >
                          {tr ? 'Bu reçetede malzeme kalemi yok.' : 'No material items in this BOM.'}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          TAB 2 — Üretim Emirleri
      ══════════════════════════════════════════════════════════════════ */}
      {activeTab === 'emirler' && (
        <div className="space-y-4">
          {/* KPI strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <KPICard label={tr ? 'Toplam Emir'   : 'Total Orders'}   value={emirler.length}   icon={Factory}       color="text-brand"      bg="bg-brand/10"    />
            <KPICard label={tr ? 'Üretimde'      : 'In Production'}  value={aktifEmirSayisi}  icon={Activity}      color="text-green-600"  bg="bg-green-50"    />
            <KPICard label={tr ? 'Tamamlandı'    : 'Completed'}      value={tamamlananEmir}   icon={CheckSquare}   color="text-emerald-600" bg="bg-emerald-50"  />
            <KPICard label={tr ? 'Beklemede'     : 'On Hold'}        value={emirler.filter(e=>e.durum==='Beklemede').length} icon={Clock} color="text-amber-600" bg="bg-amber-50" />
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              value={emirAra}
              onChange={(e) => setEmirAra(e.target.value)}
              placeholder={tr ? 'Emir no veya ürün ara…' : 'Search order no or product…'}
              className="apple-input pl-9 w-full text-sm"
            />
          </div>

          {/* Table */}
          <div className="apple-card overflow-hidden">
            {filteredEmirler.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                <Factory className="w-10 h-10 mb-3 opacity-20" />
                <p className="text-sm">{tr ? 'Henüz üretim emri yok.' : 'No production orders yet.'}</p>
                <button onClick={openNewEmir} className="mt-3 text-brand font-bold text-sm hover:underline">
                  {tr ? '+ İlk emri oluştur' : '+ Create first order'}
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 border-b border-gray-100">
                    <tr>
                      {[
                        tr ? 'Emir No'    : 'Order No',
                        tr ? 'Ürün'       : 'Product',
                        tr ? 'Reçete'     : 'BOM',
                        tr ? 'İlerleme'   : 'Progress',
                        tr ? 'Durum'      : 'Status',
                        tr ? 'Planlanan'  : 'Planned',
                        tr ? 'İşlemler'   : 'Actions',
                      ].map((h) => (
                        <th key={h} className="px-4 py-3 text-left font-bold text-[10px] text-gray-400 uppercase whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {filteredEmirler.map((emir) => {
                      const pct = emir.siparisAdedi > 0
                        ? Math.min(100, Math.round((emir.tamamlananAdedi / emir.siparisAdedi) * 100))
                        : 0;
                      return (
                        <tr key={emir.id} className="hover:bg-gray-50/60 transition-colors">
                          <td className="px-4 py-3 font-bold text-brand whitespace-nowrap">{emir.emirNo}</td>
                          <td className="px-4 py-3 font-medium text-gray-800">{emir.urunAdi}</td>
                          <td className="px-4 py-3 font-mono text-gray-500">{emir.receteNo || '—'}</td>
                          <td className="px-4 py-3" style={{ minWidth: 160 }}>
                            <div className="flex items-center gap-2">
                              <div className="flex-1 bg-gray-100 h-1.5 rounded-full overflow-hidden">
                                <div
                                  className={cn(
                                    'h-full transition-all duration-500',
                                    pct >= 100 ? 'bg-emerald-500' : pct >= 50 ? 'bg-brand' : 'bg-amber-400'
                                  )}
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                              <span className="text-[10px] text-gray-500 whitespace-nowrap w-14 text-right">
                                {emir.tamamlananAdedi}/{emir.siparisAdedi} ({pct}%)
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <StatusBadge label={tr ? emir.durum : (
                              emir.durum === 'Planlandı' ? 'Planned' :
                              emir.durum === 'Üretimde' ? 'In Production' :
                              emir.durum === 'Beklemede' ? 'On Hold' :
                              emir.durum === 'Tamamlandı' ? 'Completed' : 'Cancelled'
                            )} style={EMIR_DURUM_STYLES[emir.durum]} />
                          </td>
                          <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                            {emir.planlananBaslangic && emir.planlananBitis
                              ? `${emir.planlananBaslangic} → ${emir.planlananBitis}`
                              : '—'}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1">
                              {/* Start */}
                              {(emir.durum === 'Planlandı' || emir.durum === 'Beklemede') && (
                                <button title={tr ? 'Başlat' : 'Start'} onClick={() => handleEmirDurumDegistir(emir, 'Üretimde')} className="p-1.5 rounded-lg hover:bg-green-50 text-green-500 transition-colors">
                                  <PlayCircle className="w-4 h-4" />
                                </button>
                              )}
                              {/* Hold */}
                              {emir.durum === 'Üretimde' && (
                                <button title={tr ? 'Beklet' : 'Hold'} onClick={() => handleEmirDurumDegistir(emir, 'Beklemede')} className="p-1.5 rounded-lg hover:bg-amber-50 text-amber-500 transition-colors">
                                  <PauseCircle className="w-4 h-4" />
                                </button>
                              )}
                              {/* Complete */}
                              {(emir.durum === 'Üretimde' || emir.durum === 'Beklemede') && (
                                <button title={tr ? 'Tamamla' : 'Complete'} onClick={() => handleEmirDurumDegistir(emir, 'Tamamlandı')} className="p-1.5 rounded-lg hover:bg-emerald-50 text-emerald-500 transition-colors">
                                  <CheckCircle2 className="w-4 h-4" />
                                </button>
                              )}
                              {/* Cancel */}
                              {emir.durum !== 'Tamamlandı' && emir.durum !== 'İptal' && (
                                <button title={tr ? 'İptal' : 'Cancel'} onClick={() => handleEmirDurumDegistir(emir, 'İptal')} className="p-1.5 rounded-lg hover:bg-red-50 text-red-400 transition-colors">
                                  <Ban className="w-4 h-4" />
                                </button>
                              )}
                              <button onClick={() => openEditEmir(emir)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 transition-colors"><Edit2 className="w-3.5 h-3.5" /></button>
                              <button onClick={() => handleEmirSil(emir.id)} className="p-1.5 rounded-lg hover:bg-red-50 text-red-400 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          TAB 3 — Malzeme İhtiyacı (MRP — read-only computed)
      ══════════════════════════════════════════════════════════════════ */}
      {activeTab === 'mrp' && (
        <div className="space-y-4">
          {/* KPI strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <KPICard label={tr ? 'Aktif Emir'      : 'Active Orders'}      value={emirler.filter(e=>e.durum==='Planlandı'||e.durum==='Üretimde'||e.durum==='Beklemede').length} icon={Factory}     color="text-brand"     bg="bg-brand/10"   />
            <KPICard label={tr ? 'MRP Satır Sayısı' : 'MRP Lines'}          value={mrpSatirSayisi}  icon={Layers}      color="text-blue-600"  bg="bg-blue-50"    />
            <KPICard label={tr ? 'Farklı Malzeme'   : 'Unique Materials'}   value={new Set(mrpRows.map(r=>r.malzeme)).size} icon={Package} color="text-indigo-600" bg="bg-indigo-50" />
            <KPICard label={tr ? 'Reçete Sayısı'    : 'BOMs Used'}          value={new Set(mrpRows.map(r=>r.receteNo)).size} icon={ClipboardList} color="text-emerald-600" bg="bg-emerald-50" />
          </div>

          <div className="apple-card overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              <p className="text-xs text-gray-600">
                {tr
                  ? 'Planlandı / Üretimde / Beklemede durumundaki emirlerin reçetelerine göre hesaplanmış malzeme ihtiyacı.'
                  : 'Material requirements computed from BOM data for Planned / In-Production / On-Hold orders.'}
              </p>
            </div>

            {mrpRows.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                <Layers className="w-10 h-10 mb-3 opacity-20" />
                <p className="text-sm">
                  {tr
                    ? 'Aktif emirler için malzeme ihtiyacı bulunamadı.'
                    : 'No material requirements for active orders.'}
                </p>
                <p className="text-xs text-gray-300 mt-1">
                  {tr
                    ? 'Üretim emirleri oluşturun ve reçete no atayın.'
                    : 'Create production orders and assign BOM numbers.'}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 border-b border-gray-100">
                    <tr>
                      {[
                        tr ? 'Malzeme'        : 'Material',
                        tr ? 'Gereken Miktar' : 'Required Qty',
                        tr ? 'Birim'          : 'Unit',
                        tr ? 'Reçete No'      : 'BOM No',
                        tr ? 'Emir No'        : 'Order No',
                      ].map((h) => (
                        <th key={h} className="px-4 py-3 text-left font-bold text-[10px] text-gray-400 uppercase">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {mrpRows.map((row, i) => (
                      <tr key={i} className="hover:bg-gray-50/60 transition-colors">
                        <td className="px-4 py-3 font-medium text-gray-800">{row.malzeme}</td>
                        <td className="px-4 py-3 font-bold text-brand">{row.gerekenMiktar.toLocaleString('tr-TR')}</td>
                        <td className="px-4 py-3 text-gray-500">{row.birim}</td>
                        <td className="px-4 py-3 font-mono text-gray-500">{row.receteNo}</td>
                        <td className="px-4 py-3 font-mono text-blue-600">{row.emirNo}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          TAB 4 — Kalite Kontrol
      ══════════════════════════════════════════════════════════════════ */}
      {activeTab === 'kalite' && (
        <div className="space-y-4">
          {/* KPI strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <KPICard label={tr ? 'Toplam Kontrol' : 'Total QC'}    value={kaliteKayitlari.length} icon={ShieldCheck}   color="text-brand"      bg="bg-brand/10"   />
            <KPICard label={tr ? 'Geçti'          : 'Passed'}      value={gectiKK}                icon={CheckCircle2}  color="text-green-600"  bg="bg-green-50"   />
            <KPICard label={tr ? 'Kaldı'          : 'Failed'}      value={basarisizKK}            icon={AlertTriangle} color="text-red-500"    bg="bg-red-50"     />
            <KPICard label={tr ? 'Şartlı'         : 'Conditional'} value={kaliteKayitlari.filter(k=>k.sonuc==='Şartlı').length} icon={FlaskConical} color="text-amber-600" bg="bg-amber-50" />
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              value={kkAra}
              onChange={(e) => setKkAra(e.target.value)}
              placeholder={tr ? 'Kontrol no, emir no veya kontrolcü ara…' : 'Search control no, order no or inspector…'}
              className="apple-input pl-9 w-full text-sm"
            />
          </div>

          {/* Table */}
          <div className="apple-card overflow-hidden">
            {filteredKK.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                <ShieldCheck className="w-10 h-10 mb-3 opacity-20" />
                <p className="text-sm">{tr ? 'Henüz kalite kontrol kaydı yok.' : 'No QC records yet.'}</p>
                <button onClick={openNewKK} className="mt-3 text-brand font-bold text-sm hover:underline">
                  {tr ? '+ İlk kontrolü ekle' : '+ Add first QC record'}
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 border-b border-gray-100">
                    <tr>
                      {[
                        tr ? 'Kontrol No'   : 'Control No',
                        tr ? 'Üretim Emri'  : 'Production Order',
                        tr ? 'Tarih'        : 'Date',
                        tr ? 'Kontrolcü'    : 'Inspector',
                        tr ? 'Sonuç'        : 'Result',
                        tr ? 'Notlar'       : 'Notes',
                        tr ? 'İşlemler'     : 'Actions',
                      ].map((h) => (
                        <th key={h} className="px-4 py-3 text-left font-bold text-[10px] text-gray-400 uppercase whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {filteredKK.map((kk) => (
                      <tr key={kk.id} className="hover:bg-gray-50/60 transition-colors">
                        <td className="px-4 py-3 font-bold text-brand whitespace-nowrap">{kk.kontrolNo}</td>
                        <td className="px-4 py-3 font-mono text-gray-600">{kk.uretimEmriNo || '—'}</td>
                        <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{kk.kontrolTarihi || '—'}</td>
                        <td className="px-4 py-3 font-medium text-gray-700">{kk.kontrolEden || '—'}</td>
                        <td className="px-4 py-3">
                          <StatusBadge label={tr ? kk.sonuc : (
                            kk.sonuc === 'Geçti' ? 'Passed' : kk.sonuc === 'Kaldı' ? 'Failed' : 'Conditional'
                          )} style={KK_SONUC_STYLES[kk.sonuc]} />
                        </td>
                        <td className="px-4 py-3 text-gray-500 max-w-[200px] truncate">{kk.notlar || '—'}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1">
                            <button onClick={() => openEditKK(kk)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 transition-colors"><Edit2 className="w-3.5 h-3.5" /></button>
                            <button onClick={() => handleKKSil(kk.id)} className="p-1.5 rounded-lg hover:bg-red-50 text-red-400 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          MODAL — Reçete Form
      ══════════════════════════════════════════════════════════════════ */}
      <AnimatePresence>
        {showReceteModal && (
          <>
            <motion.div
              key="recete-backdrop"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
              onClick={closeReceteModal}
            />
            <motion.div
              key="recete-modal"
              initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 26, stiffness: 260 }}
              className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-[500px] bg-white shadow-2xl flex flex-col border-l border-gray-100"
            >
              <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
                <h3 className="text-base font-bold text-[#1D1D1F]">
                  {editingRecete ? (tr ? 'Reçeteyi Düzenle' : 'Edit BOM') : (tr ? 'Yeni Reçete' : 'New BOM')}
                </h3>
                <button onClick={closeReceteModal} className="p-2 rounded-xl text-gray-400 hover:text-gray-600 transition-colors"><X className="w-5 h-5" /></button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-5">
                {/* Basic info */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 mb-1.5">{tr ? 'Reçete No' : 'BOM No'}</label>
                    <input
                      className="apple-input w-full font-mono"
                      value={receteForm.receteNo}
                      onChange={(e) => setReceteForm((f) => ({ ...f, receteNo: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 mb-1.5">{tr ? 'Birim' : 'Unit'}</label>
                    <select
                      className="apple-input w-full"
                      value={receteForm.birim}
                      onChange={(e) => setReceteForm((f) => ({ ...f, birim: e.target.value }))}
                    >
                      {BIRIMLER.map((b) => <option key={b} value={b}>{b}</option>)}
                    </select>
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs font-semibold text-gray-500 mb-1.5">{tr ? 'Ürün Adı *' : 'Product Name *'}</label>
                    <input
                      className="apple-input w-full"
                      value={receteForm.urunAdi}
                      onChange={(e) => setReceteForm((f) => ({ ...f, urunAdi: e.target.value }))}
                      placeholder={tr ? 'Mamul ürün adı' : 'Finished product name'}
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs font-semibold text-gray-500 mb-1.5">{tr ? 'Durum' : 'Status'}</label>
                    <select
                      className="apple-input w-full"
                      value={receteForm.durum}
                      onChange={(e) => setReceteForm((f) => ({ ...f, durum: e.target.value as ReceteDurum }))}
                    >
                      <option value="Aktif">{tr ? 'Aktif' : 'Active'}</option>
                      <option value="Revizyon">{tr ? 'Revizyon' : 'Revision'}</option>
                      <option value="Arşiv">{tr ? 'Arşiv' : 'Archived'}</option>
                    </select>
                  </div>
                </div>

                {/* Kalemler */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-xs font-bold text-gray-600 uppercase">{tr ? 'Malzeme Kalemleri' : 'Material Items'}</h4>
                    <button onClick={addKalem} className="flex items-center gap-1 text-xs text-brand font-bold hover:opacity-80 transition-opacity">
                      <Plus className="w-3.5 h-3.5" /> {tr ? 'Ekle' : 'Add'}
                    </button>
                  </div>

                  {receteForm.kalemler.length === 0 ? (
                    <div className="border border-dashed border-gray-200 rounded-xl p-4 text-center text-xs text-gray-400">
                      {tr ? '"Ekle" butonuna basarak malzeme ekleyin.' : 'Press "Add" to add material items.'}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {receteForm.kalemler.map((kalem, i) => (
                        <div key={i} className="bg-gray-50 rounded-xl p-3 space-y-2 border border-gray-100">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-bold text-gray-400 uppercase">#{i + 1}</span>
                            <button onClick={() => removeKalem(i)} className="text-gray-300 hover:text-red-500 transition-colors"><X className="w-3.5 h-3.5" /></button>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <div className="col-span-2">
                              <label className="text-[10px] font-semibold text-gray-400">{tr ? 'Malzeme Adı' : 'Material Name'}</label>
                              <input
                                className="apple-input w-full mt-0.5 text-xs"
                                value={kalem.malzemeAdi}
                                onChange={(e) => updateKalem(i, { malzemeAdi: e.target.value })}
                                placeholder={tr ? 'Malzeme adı' : 'Material name'}
                              />
                            </div>
                            <div>
                              <label className="text-[10px] font-semibold text-gray-400">{tr ? 'Miktar' : 'Qty'}</label>
                              <input
                                type="number" min={0.001} step={0.001}
                                className="apple-input w-full mt-0.5 text-xs"
                                value={kalem.miktar}
                                onChange={(e) => updateKalem(i, { miktar: parseFloat(e.target.value) || 1 })}
                              />
                            </div>
                            <div>
                              <label className="text-[10px] font-semibold text-gray-400">{tr ? 'Birim' : 'Unit'}</label>
                              <select
                                className="apple-input w-full mt-0.5 text-xs"
                                value={kalem.birim}
                                onChange={(e) => updateKalem(i, { birim: e.target.value })}
                              >
                                {BIRIMLER.map((b) => <option key={b} value={b}>{b}</option>)}
                              </select>
                            </div>
                            <div className="col-span-2">
                              <label className="text-[10px] font-semibold text-gray-400">{tr ? 'Birim Maliyet (₺)' : 'Unit Cost (₺)'}</label>
                              <input
                                type="number" min={0} step={0.01}
                                className="apple-input w-full mt-0.5 text-xs"
                                value={kalem.maliyet}
                                onChange={(e) => updateKalem(i, { maliyet: parseFloat(e.target.value) || 0 })}
                              />
                            </div>
                          </div>
                        </div>
                      ))}

                      {/* Toplam */}
                      <div className="flex justify-end text-sm font-bold text-gray-700 border-t border-gray-100 pt-2">
                        <span className="text-gray-500 font-normal mr-2">{tr ? 'Toplam Maliyet:' : 'Total Cost:'}</span>
                        <span className="text-brand">₺{calcToplamMaliyet(receteForm.kalemler).toLocaleString('tr-TR', { minimumFractionDigits: 2 })}</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="flex gap-3 pt-2 border-t border-gray-100">
                  <button onClick={closeReceteModal} className="apple-button-secondary flex-1 py-2.5 text-sm font-semibold">
                    {tr ? 'İptal' : 'Cancel'}
                  </button>
                  <button
                    onClick={handleReceteSave}
                    disabled={receteSaving || !receteForm.urunAdi.trim()}
                    className="apple-button-primary flex-1 justify-center py-2.5 text-sm font-semibold disabled:opacity-50 flex items-center gap-2"
                  >
                    {receteSaving && <RefreshCw className="w-4 h-4 animate-spin" />}
                    {receteSaving ? (tr ? 'Kaydediliyor…' : 'Saving…') : (tr ? 'Kaydet' : 'Save')}
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ══════════════════════════════════════════════════════════════════
          MODAL — Üretim Emri Form
      ══════════════════════════════════════════════════════════════════ */}
      <AnimatePresence>
        {showEmirModal && (
          <>
            <motion.div
              key="emir-backdrop"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
              onClick={closeEmirModal}
            />
            <motion.div
              key="emir-modal"
              initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 26, stiffness: 260 }}
              className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-[440px] bg-white shadow-2xl flex flex-col border-l border-gray-100"
            >
              <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
                <h3 className="text-base font-bold text-[#1D1D1F]">
                  {editingEmir ? (tr ? 'Emri Düzenle' : 'Edit Order') : (tr ? 'Yeni Üretim Emri' : 'New Production Order')}
                </h3>
                <button onClick={closeEmirModal} className="p-2 rounded-xl text-gray-400 hover:text-gray-600 transition-colors"><X className="w-5 h-5" /></button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 mb-1.5">{tr ? 'Emir No' : 'Order No'}</label>
                    <input className="apple-input w-full font-mono" value={emirForm.emirNo} onChange={(e) => setEmirForm((f) => ({ ...f, emirNo: e.target.value }))} />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 mb-1.5">{tr ? 'Durum' : 'Status'}</label>
                    <select className="apple-input w-full" value={emirForm.durum} onChange={(e) => setEmirForm((f) => ({ ...f, durum: e.target.value as EmirDurum }))}>
                      <option value="Planlandı">{tr ? 'Planlandı' : 'Planned'}</option>
                      <option value="Üretimde">{tr ? 'Üretimde' : 'In Production'}</option>
                      <option value="Beklemede">{tr ? 'Beklemede' : 'On Hold'}</option>
                      <option value="Tamamlandı">{tr ? 'Tamamlandı' : 'Completed'}</option>
                      <option value="İptal">{tr ? 'İptal' : 'Cancelled'}</option>
                    </select>
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs font-semibold text-gray-500 mb-1.5">{tr ? 'Ürün Adı *' : 'Product Name *'}</label>
                    <input className="apple-input w-full" value={emirForm.urunAdi} onChange={(e) => setEmirForm((f) => ({ ...f, urunAdi: e.target.value }))} placeholder={tr ? 'Üretilecek ürün' : 'Product to manufacture'} />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs font-semibold text-gray-500 mb-1.5">{tr ? 'Reçete No' : 'BOM No'}</label>
                    <select className="apple-input w-full" value={emirForm.receteNo} onChange={(e) => setEmirForm((f) => ({ ...f, receteNo: e.target.value }))}>
                      <option value="">{tr ? '— Seçin —' : '— Select —'}</option>
                      {receteler.filter((r) => r.durum === 'Aktif').map((r) => (
                        <option key={r.id} value={r.receteNo}>{r.receteNo} — {r.urunAdi}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 mb-1.5">{tr ? 'Sipariş Adedi' : 'Order Qty'}</label>
                    <input type="number" min={1} className="apple-input w-full" value={emirForm.siparisAdedi} onChange={(e) => setEmirForm((f) => ({ ...f, siparisAdedi: Number(e.target.value) }))} />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 mb-1.5">{tr ? 'Tamamlanan' : 'Completed Qty'}</label>
                    <input type="number" min={0} className="apple-input w-full" value={emirForm.tamamlananAdedi} onChange={(e) => setEmirForm((f) => ({ ...f, tamamlananAdedi: Number(e.target.value) }))} />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 mb-1.5">{tr ? 'Planlanan Başlangıç' : 'Planned Start'}</label>
                    <input type="date" className="apple-input w-full" value={emirForm.planlananBaslangic} onChange={(e) => setEmirForm((f) => ({ ...f, planlananBaslangic: e.target.value }))} />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 mb-1.5">{tr ? 'Planlanan Bitiş' : 'Planned End'}</label>
                    <input type="date" className="apple-input w-full" value={emirForm.planlananBitis} onChange={(e) => setEmirForm((f) => ({ ...f, planlananBitis: e.target.value }))} />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs font-semibold text-gray-500 mb-1.5">{tr ? 'Notlar' : 'Notes'}</label>
                    <textarea rows={3} className="apple-input w-full resize-none" value={emirForm.notlar} onChange={(e) => setEmirForm((f) => ({ ...f, notlar: e.target.value }))} />
                  </div>
                </div>

                <div className="flex gap-3 pt-2 border-t border-gray-100">
                  <button onClick={closeEmirModal} className="apple-button-secondary flex-1 py-2.5 text-sm font-semibold">
                    {tr ? 'İptal' : 'Cancel'}
                  </button>
                  <button
                    onClick={handleEmirSave}
                    disabled={emirSaving || !emirForm.urunAdi.trim()}
                    className="apple-button-primary flex-1 justify-center py-2.5 text-sm font-semibold disabled:opacity-50 flex items-center gap-2"
                  >
                    {emirSaving && <RefreshCw className="w-4 h-4 animate-spin" />}
                    {emirSaving ? (tr ? 'Kaydediliyor…' : 'Saving…') : (tr ? 'Kaydet' : 'Save')}
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ══════════════════════════════════════════════════════════════════
          MODAL — Kalite Kontrol Form
      ══════════════════════════════════════════════════════════════════ */}
      <AnimatePresence>
        {showKKModal && (
          <>
            <motion.div
              key="kk-backdrop"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
              onClick={closeKKModal}
            />
            <motion.div
              key="kk-modal"
              initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 26, stiffness: 260 }}
              className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-[420px] bg-white shadow-2xl flex flex-col border-l border-gray-100"
            >
              <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
                <h3 className="text-base font-bold text-[#1D1D1F]">
                  {editingKK ? (tr ? 'Kontrolü Düzenle' : 'Edit QC Record') : (tr ? 'Yeni Kalite Kontrolü' : 'New QC Record')}
                </h3>
                <button onClick={closeKKModal} className="p-2 rounded-xl text-gray-400 hover:text-gray-600 transition-colors"><X className="w-5 h-5" /></button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 mb-1.5">{tr ? 'Kontrol No *' : 'Control No *'}</label>
                    <input className="apple-input w-full font-mono" value={kkForm.kontrolNo} onChange={(e) => setKkForm((f) => ({ ...f, kontrolNo: e.target.value }))} />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 mb-1.5">{tr ? 'Sonuç' : 'Result'}</label>
                    <select className="apple-input w-full" value={kkForm.sonuc} onChange={(e) => setKkForm((f) => ({ ...f, sonuc: e.target.value as KKSonuc }))}>
                      <option value="Geçti">{tr ? 'Geçti' : 'Passed'}</option>
                      <option value="Kaldı">{tr ? 'Kaldı' : 'Failed'}</option>
                      <option value="Şartlı">{tr ? 'Şartlı' : 'Conditional'}</option>
                    </select>
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs font-semibold text-gray-500 mb-1.5">{tr ? 'Üretim Emri No' : 'Production Order No'}</label>
                    <select className="apple-input w-full" value={kkForm.uretimEmriNo} onChange={(e) => setKkForm((f) => ({ ...f, uretimEmriNo: e.target.value }))}>
                      <option value="">{tr ? '— Seçin —' : '— Select —'}</option>
                      {emirler.map((e) => (
                        <option key={e.id} value={e.emirNo}>{e.emirNo} — {e.urunAdi}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 mb-1.5">{tr ? 'Kontrol Tarihi' : 'Control Date'}</label>
                    <input type="date" className="apple-input w-full" value={kkForm.kontrolTarihi} onChange={(e) => setKkForm((f) => ({ ...f, kontrolTarihi: e.target.value }))} />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 mb-1.5">{tr ? 'Kontrol Eden' : 'Inspector'}</label>
                    <input className="apple-input w-full" value={kkForm.kontrolEden} onChange={(e) => setKkForm((f) => ({ ...f, kontrolEden: e.target.value }))} placeholder={tr ? 'Ad Soyad' : 'Full name'} />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs font-semibold text-gray-500 mb-1.5">{tr ? 'Notlar' : 'Notes'}</label>
                    <textarea rows={4} className="apple-input w-full resize-none" value={kkForm.notlar} onChange={(e) => setKkForm((f) => ({ ...f, notlar: e.target.value }))} />
                  </div>
                </div>

                <div className="flex gap-3 pt-2 border-t border-gray-100">
                  <button onClick={closeKKModal} className="apple-button-secondary flex-1 py-2.5 text-sm font-semibold">
                    {tr ? 'İptal' : 'Cancel'}
                  </button>
                  <button
                    onClick={handleKKSave}
                    disabled={kkSaving || !kkForm.kontrolNo.trim()}
                    className="apple-button-primary flex-1 justify-center py-2.5 text-sm font-semibold disabled:opacity-50 flex items-center gap-2"
                  >
                    {kkSaving && <RefreshCw className="w-4 h-4 animate-spin" />}
                    {kkSaving ? (tr ? 'Kaydediliyor…' : 'Saving…') : (tr ? 'Kaydet' : 'Save')}
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
